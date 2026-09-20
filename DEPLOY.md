# FreeLLM Hub v2 部署文档

统一 LLM API 网关，OpenAI / Anthropic 兼容，支持多 Provider 路由、故障转移、虚拟模型、缓存、护栏、限流。

---

## 系统要求

- Docker 20.10+ (多阶段构建需要 BuildKit)
- 1 核 CPU / 1GB RAM 起步 (生产建议 2 核 / 2GB+)
- 1GB+ 磁盘 (SQLite + 自动备份)
- 端口 3030 (容器内) → 任意宿主机端口

## 快速部署

```bash
# 1. 拉取镜像
docker pull freellm-hub-v2:v2.0.0

# 2. 启动 (首次会自动初始化)
docker run -d \
  --name freellm-hub \
  --restart unless-stopped \
  -p 3303:3030 \
  -v freellm-hub-data:/app/data \
  -e TZ=Asia/Shanghai \
  freellm-hub-v2:v2.0.0

# 3. 验证
curl http://localhost:3303/health
# {"status":"ok","service":"freellm-hub","version":"0.1.0","db":"sqlite",...}

# 4. 首次初始化: 访问 http://localhost:3303/setup 创建管理员账号
```

## 配置

### 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `HUB_PORT` | `3030` | 监听端口 |
| `HUB_HOST` | `0.0.0.0` | 监听地址 |
| `HUB_PUBLIC_URL` | (空) | 对外公开 URL (留空则使用请求的 host) |
| `HUB_DATA_DIR` | `./data` | 数据目录 (SQLite + 密钥 + session) |
| `TZ` | `Asia/Shanghai` | 时区 (影响日志和定时任务) |
| `NODE_ENV` | `production` | 运行环境 |
| `LOG_LEVEL` | `info` | 日志级别: `trace`/`debug`/`info`/`warn`/`error` |
| `HUB_MAX_BACKUPS` | `7` | 数据库备份最大保留数 |
| `HUB_BACKUP_RETENTION_DAYS` | `30` | 备份保留天数 |
| `HUB_LOG_RETENTION_DAYS` | `90` | 日志保留天数 |

### docker-compose 模板

```yaml
services:
  hub:
    image: freellm-hub-v2:v2.0.0
    container_name: freellm-hub
    restart: unless-stopped
    ports:
      - "3303:3030"
    volumes:
      - ./data:/app/data
    environment:
      - HUB_PORT=3030
      - HUB_HOST=0.0.0.0
      - TZ=Asia/Shanghai
      - NODE_ENV=production
      - LOG_LEVEL=info
    healthcheck:
      test: ["CMD", "node", "-e", "require('http').get('http://localhost:3030/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 10s
```

## 数据目录结构

```
data/
├── hub.db              # SQLite 数据库 (渠道、Key、日志等)
├── hub.db-shm          # WAL 共享内存
├── hub.db-wal          # WAL 日志
├── master.key          # API Key 加密主密钥 (丢失 = 密钥不可恢复)
├── session.secret      # Session 签名密钥 (重启不退出登录)
└── backups/            # 自动备份目录 (最多 7 份)
    ├── hub-2026-09-19T02-31-53.db
    └── hub-2026-09-19T02-32-27.db
```

**⚠️ 备份 `data/` 整个目录**，不仅是 `hub.db`。`master.key` 和 `session.secret` 必须一起备份，否则：
- 丢失 `master.key` → 所有渠道 Key 不可解密
- 丢失 `session.secret` → 所有 admin 需重新登录

## 备份与恢复

### 自动备份

- 每天 00:00 左右 (启动后 24h) 自动 VACUUM INTO 备份到 `data/backups/`
- 最多保留 7 份 / 30 天
- 备份过程不中断服务

### 手动触发备份

```bash
# 方式 1: API (需先登录后台)
curl -X POST -H "Cookie: hub_session=..." http://localhost:3303/api/admin/backup

# 方式 2: 直接调用 VACUUM INTO
docker exec freellm-hub sh -c \
  'sqlite3 /app/data/hub.db "VACUUM INTO '\''/app/data/backups/manual-$(date +%Y-%m-%d).db'\''"'
# (容器内无 sqlite3 时改用 node 脚本)
```

### 查看备份列表

```bash
curl -H "Cookie: hub_session=..." http://localhost:3303/api/admin/backup
# 返回: {"ok":true,"backups":[{"name":"hub-...db","size":868352,"mtime":"..."}], "max_backups":7}
```

### 恢复步骤

```bash
# 1. 停止容器
docker stop freellm-hub

# 2. 备份当前 db (以防万一)
cp data/hub.db data/hub.db.before-restore

# 3. 用备份替换 db (注意保留 master.key 和 session.secret!)
cp data/backups/hub-2026-09-19T02-31-53.db data/hub.db

# 4. 重启容器
docker start freellm-hub

# 5. 验证
curl http://localhost:3303/health
docker logs freellm-hub | tail -20
```

### 验证恢复演练

```bash
# 把备份拷到临时目录, 启动测试容器
mkdir /tmp/restore-test
cp data/backups/hub-2026-09-19T02-31-53.db /tmp/restore-test/hub.db
docker run -d --name restore-test -p 3304:3030 -v /tmp/restore-test:/app/data freellm-hub-v2:v2.0.0
sleep 5
curl http://localhost:3304/health
# 数据正常 → 恢复成功
docker stop restore-test && docker rm restore-test
```

## 反向代理

### Nginx

```nginx
server {
    listen 443 ssl http2;
    server_name hub.example.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    # 后台 + API 都走同一个域
    location / {
        proxy_pass http://127.0.0.1:3303;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_http_version 1.1;
        proxy_read_timeout 600s;  # 长请求 (视频生成等)
        proxy_send_timeout 600s;
        client_max_body_size 10m;
    }
}
```

### Caddy

```
hub.example.com {
    reverse_proxy 127.0.0.1:3303
    request_body {
        max_size 10MB
    }
}
```

## 升级

```bash
# 1. 拉取新版
docker pull freellm-hub-v2:v2.0.1

# 2. 备份当前数据 (以防回滚)
cp -r data/ data.bak.v2.0.0/

# 3. 停止旧容器
docker stop freellm-hub

# 4. 启动新版本 (data volume 不动)
docker run -d \
  --name freellm-hub \
  --restart unless-stopped \
  -p 3303:3030 \
  -v freellm-hub-data:/app/data \
  -e TZ=Asia/Shanghai \
  freellm-hub-v2:v2.0.1

# 5. 验证
curl http://localhost:3303/health
docker logs freellm-hub | tail -30
# 检查是否有 migration applied 日志
```

**首次启动会自动执行数据库迁移** (26 个 migration 文件)。从旧版本升级会自动跳过已执行的迁移。

### 回滚

```bash
docker stop freellm-hub
docker rm freellm-hub
docker run -d \
  --name freellm-hub \
  --restart unless-stopped \
  -p 3303:3030 \
  -v freellm-hub-data:/app/data \
  freellm-hub-v2:v2.0.0
```

数据库 schema 是向后兼容的: 新版本的 migration 不会在旧版本上运行 (旧版本启动后 memory 中没有新 migration 的代码)，回滚到旧版本后数据库正常。

## 监控

### 健康检查

```bash
# Docker 内置
docker inspect --format='{{.State.Health.Status}}' freellm-hub
# 输出: healthy / unhealthy / starting

# 手动
curl -fsS http://localhost:3303/health
```

### 日志

```bash
# 实时跟踪
docker logs -f freellm-hub

# 最近 100 行
docker logs --tail 100 freellm-hub

# 按时间过滤
docker logs --since 1h freellm-hub
```

**⚠️ 当前实现只输出到 stdout/stderr**。如果担心 docker 日志撑爆磁盘，建议:
- 配置 docker daemon 日志轮转 (`/etc/docker/daemon.json` 的 `log-driver` 选项)
- 或在反向代理层收集访问日志

### 关键日志关键字

| 关键字 | 含义 |
|---|---|
| `Background jobs started` | 后台任务正常启动 |
| `Health check done` | 健康检查一轮完成 |
| `Database backup created` | 备份成功 |
| `Old logs cleaned` | 日志清理成功 |
| `Cooldown cleared by probe` | 冷却被探测解除 |
| `Graceful shutdown` | 优雅停机过程 |
| `Unhandled server error` | 5xx 未捕获错误 (需关注) |
| `EALLOWREMOTE` | npm 包下载被镜像源拒绝 (构建问题) |

## 性能调优

### 缓存

- 启用响应缓存 (默认 TTL 300s) 可显著降低重复请求的上游费用
- 高频固定 prompt 场景建议启用 (如评测、回归测试)

### 连接数

- 默认每个 upstream 请求独立 fetch (单线程异步)
- 高并发场景建议部署多实例 + 反代负载均衡

### 数据库

- SQLite WAL 模式已启用 (并发读 + 单写)
- 写入瓶颈场景 (大量 usage_logs) 会自动触发清理任务
- 高频写入场景 (>1000 req/s) 建议迁移到外部数据库

## 故障排查

### 健康检查不通过

```bash
docker logs freellm-hub --tail 50
docker exec freellm-hub sh -c 'node -e "require(\"http\").get(\"http://localhost:3030/health\",r=>console.log(r.statusCode)).on(\"error\",e=>console.log(e.message))"'
```

### 上游 5xx 频发

```bash
# 看总览页的"健康 key 比例"
# 看"用量统计 → 错误分析"定位失败原因

# 看 cooldown 状态
docker exec freellm-hub sh -c 'node -e "const db=require(\"node:sqlite\");const d=new db.DatabaseSync(\"/app/data/hub.db\");console.log(d.prepare(\"SELECT * FROM key_cooldowns WHERE expires_at > ?\").all(Date.now()))"'
```

### 数据库锁死

```bash
# SQLite WAL 模式 + busy_timeout=5000 通常会自动恢复
# 极端情况: 重启容器
docker restart freellm-hub
```

### 备份失败

- 看日志 `Database backup failed` 后面的错误
- 最常见: 磁盘空间不足 (`data/backups/` 写不进去)
- 次常见: 文件权限 (`node` 用户无写权限)

### 升级后 admin 登录失败

如果 session.secret 不兼容，所有 admin 会被强制退出。重新登录即可。session.secret 不会因为升级丢失 (因为它在 `data/` volume 里)。

## 安全建议

1. **不要把 3303 端口直接暴露到公网** —— 必须通过反向代理 + HTTPS
2. **定期更换 admin 密码** —— 在后台 `/admin/profile` 修改
3. **Hub Key 设置合理 allowed_models** —— 避免一个 Key 能调用所有模型
4. **启用内容护栏** —— 在 `/admin/guardrails` 配置关键词拦截
5. **定期审查使用日志** —— 在 `/admin/usage` 查看异常调用
6. **备份 data/ 目录到异地** —— 异地容灾

## 版本对应

| 镜像 tag | Git/代码 | 发布日期 |
|---|---|---|
| `freellm-hub-v2:latest` | 跟随 main 分支最新 | - |
| `freellm-hub-v2:stable` | 锁定稳定版 | - |
| `freellm-hub-v2:v2.0.0` | 锁定 v2.0.0 | 2026-09-19 |

## 支持

- 文档: 本目录的 `CHANGELOG.md`
- 接口: 后台 `/api-docs` (列出所有端点)
- 代码: 仓库 `src/` 目录
- 作者主页: [https://www.zhibushi.com](https://www.zhibushi.com)

## 许可证

(根据项目实际许可证填写)
