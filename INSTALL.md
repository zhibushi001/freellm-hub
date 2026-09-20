# FreeLLM Hub v2 安装指南

第一次安装 FreeLLM Hub v2？请从这里开始。本指南面向全新安装场景，确保你从一个干净状态启动，不踩到老数据残留的坑。

## 目录

- [前置要求](#前置要求)
- [方式 A: Docker 快速安装（推荐）](#方式-a-docker-快速安装推荐)
- [方式 B: docker-compose 安装](#方式-b-docker-compose-安装)
- [方式 C: 从源码构建并安装](#方式-c-从源码构建并安装)
- [首次初始化](#首次初始化)
- [升级到新版本](#升级到新版本)
- [常见安装问题](#常见安装问题)
- [完全卸载](#完全卸载)

---

## 前置要求

- **Docker**: 20.10+ （多阶段构建需要 BuildKit，大多数现代版本已默认开启）
- **内存**: 1GB+ 可用
- **磁盘**: 1GB+ 可用（SQLite + 自动备份）
- **端口**: 3303（或自定义，参考 [配置说明](#配置说明)）

**不需要**：Node.js、数据库、npm、构建工具 —— 镜像已经包含一切。

---

## 方式 A: Docker 快速安装（推荐）

适合：个人开发者、小团队、测试环境

### 步骤 1: 拉取镜像

```bash
docker pull freellm-hub-v2:v2.0.0
```

如果你想用最新版（不推荐生产环境）：
```bash
docker pull freellm-hub-v2:latest
```

### 步骤 2: 创建唯一的数据 volume

**⚠️ 这一步很关键**：用唯一命名的 volume，避免和别人/老部署的数据冲突。

```bash
# 推荐: 用机器名 + 日期作后缀
docker volume create freellm-hub-data-$(hostname)-$(date +%Y%m%d)

# 或者简单点
docker volume create freellm-hub-data-prod
```

为什么不能用 `freellm-hub-data`？  
→ 如果这台机器上**以前部署过** FreeLLM Hub（或别人用过同名 volume），Docker 会挂载旧数据，新安装会被污染。

### 步骤 3: 启动容器

```bash
docker run -d \
  --name freellm-hub \
  --restart unless-stopped \
  -p 3303:3030 \
  -v freellm-hub-data-prod:/app/data \
  -e TZ=Asia/Shanghai \
  freellm-hub-v2:v2.0.0
```

参数说明：
| 参数 | 含义 |
|---|---|
| `-d` | 后台运行 |
| `--name freellm-hub` | 容器名（用于后续管理命令） |
| `--restart unless-stopped` | 开机自启（除非手动 `docker stop`） |
| `-p 3303:3030` | 宿主机 3303 端口 → 容器 3030 端口 |
| `-v freellm-hub-data-prod:/app/data` | 挂载数据 volume 到容器内 `/app/data` |
| `-e TZ=Asia/Shanghai` | 设置时区（影响日志和定时任务） |

### 步骤 4: 验证

```bash
# 等待 10 秒让服务完全启动
sleep 10

# 健康检查
curl http://localhost:3303/health
# 预期输出: {"status":"ok","service":"freellm-hub","version":"0.1.0","db":"sqlite",...}

# Docker 健康检查状态
docker inspect --format='{{.State.Health.Status}}' freellm-hub
# 预期输出: healthy
```

### 步骤 5: 进入首次初始化

打开浏览器访问 `http://localhost:3303/setup`，按提示创建管理员账号。

✅ **完成！** 接下来可以：
- 访问 `http://localhost:3303/admin/dashboard` 进入后台
- 在 `渠道管理` 添加第一个 Provider
- 在 `Hub Keys` 创建客户端 Key
- 调用 `/v1/chat/completions` 测试

---

## 方式 B: docker-compose 安装

适合：生产环境、需要多服务编排

### 步骤 1: 创建项目目录

```bash
mkdir -p ~/freellm-hub && cd ~/freellm-hub
```

### 步骤 2: 创建 docker-compose.yml

```yaml
services:
  hub:
    image: freellm-hub-v2:v2.0.0
    container_name: freellm-hub
    restart: unless-stopped
    ports:
      - "3303:3030"
    volumes:
      - ./data:/app/data   # bind mount, 数据持久化在 ./data 目录
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

### 步骤 3: 启动

```bash
docker compose up -d
docker compose ps   # 应该看到 State = healthy
```

**优势**：
- 数据存储在 `./data` 目录（bind mount），可以用 `tar`、`rsync` 备份，比 named volume 更可控
- 配置集中在一个文件，方便多机部署

---

## 方式 C: 从源码构建并安装

适合：定制开发、CI/CD 流水线、需要离线构建

### 步骤 1: 克隆源码

```bash
git clone <repo-url> freellm-hub-v2
cd freellm-hub-v2
```

### 步骤 2: 构建镜像

```bash
# 前端依赖安装（仅开发机需要）
cd freellm-hub-client && npm install && cd ..

# 后端依赖安装 + 构建
npm install

# Docker 镜像构建
docker build -t my-freellm-hub:custom .
```

> ⚠️ 如果 `npm install` 因网络问题失败，参考 [常见安装问题](#常见安装问题)。

### 步骤 3: 启动

参考 [方式 A 步骤 2-5](#方式-a-docker-快速安装推荐)，把镜像名换成 `my-freellm-hub:custom`。

---

## 首次初始化

启动容器后访问 `http://localhost:3303/setup`，填写：

- **用户名**: 3-32 字符，仅字母数字下划线连字符
- **密码**: 至少 10 字符，必须含字母和数字

提交后自动登录进入后台。

> ⚠️ **请牢记管理员密码**。忘记密码需要手动改数据库（参考 `DEPLOY.md` 的故障排查章节）。

---

## 配置说明

通过环境变量配置（`docker run -e KEY=VALUE` 或 `docker-compose.yml` 的 `environment`）。

| 变量 | 默认 | 说明 |
|---|---|---|
| `HUB_PORT` | `3030` | 容器内监听端口（一般不用改） |
| `HUB_HOST` | `0.0.0.0` | 监听地址（一般不用改） |
| `HUB_PUBLIC_URL` | 空 | 对外公开 URL（留空则用请求 host） |
| `HUB_DATA_DIR` | `./data` | 数据目录（一般不用改） |
| `TZ` | `Asia/Shanghai` | 时区 |
| `NODE_ENV` | `production` | 运行环境 |
| `LOG_LEVEL` | `info` | 日志级别：`trace` / `debug` / `info` / `warn` / `error` |
| `HUB_MAX_BACKUPS` | `7` | 数据库备份最大保留数 |
| `HUB_BACKUP_RETENTION_DAYS` | `30` | 备份保留天数 |
| `HUB_LOG_RETENTION_DAYS` | `90` | 日志清理保留天数 |

完整配置说明见 `DEPLOY.md`。

---

## 升级到新版本

⚠️ **升级前请阅读 `DEPLOY.md` 的"升级"章节**，这里只给最简步骤：

```bash
# 1. 备份当前数据
docker exec freellm-hub sh -c 'cp /app/data/hub.db /app/data/hub.db.before-upgrade' 2>/dev/null
docker run --rm -v freellm-hub-data-prod:/data -v $(pwd):/backup alpine cp /data/hub.db /backup/hub.db.$(date +%Y%m%d)

# 2. 拉取新版本
docker pull freellm-hub-v2:v2.1.0

# 3. 重启容器（数据 volume 保持不变）
docker stop freellm-hub && docker rm freellm-hub
docker run -d --name freellm-hub --restart unless-stopped \
  -p 3303:3030 -v freellm-hub-data-prod:/app/data \
  -e TZ=Asia/Shanghai freellm-hub-v2:v2.1.0

# 4. 验证
curl http://localhost:3303/health
docker logs --tail 50 freellm-hub | grep -E "migration|error"
```

**首次启动会自动执行数据库迁移**（最多 26 个 migration 文件）。旧版本 session 不兼容，所有 admin 会被强制退出，重新登录即可。

---

## 常见安装问题

### 1. Docker 构建时 `npm install` 失败 (`EALLOWREMOTE`)

**症状**：`npm error code EALLOWREMOTE - Refusing to fetch @xxx`

**原因**：当前 npm 镜像源（npmmirror / 阿里云）不允许下载新包。

**解决**：
```bash
# 方式 A: 切换到官方源（需外网）
npm install --registry=https://registry.npmjs.org

# 方式 B: 先在本地装好, 让 Dockerfile 直接 COPY 本地 node_modules
npm install
docker build -t my-freellm-hub:custom .
```

### 2. 端口 3303 已被占用

```bash
# 找占用进程
lsof -i :3303

# 或换端口启动
docker run -d ... -p 8333:3030 ...
# 访问 http://localhost:8333
```

### 3. Docker 健康检查一直 unhealthy

**症状**：`docker inspect freellm-hub --format='{{.State.Health.Status}}'` 返回 `unhealthy`

**原因**：通常是 `chainguard/node:latest` 极简镜像无 `curl`，且某些自定义 Dockerfile 用了 `curl` 做 healthcheck。

**解决**：镜像内置的 healthcheck 已用 Node http 调用，不需要 `curl`。如你自定义了 Dockerfile，请把 healthcheck 改成：
```dockerfile
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3030/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"
```

### 4. 启动后 `/setup` 报 "管理员已存在"

**原因**：你挂载的 volume 不是空的（用了别人用过的 volume 名）。

**解决**：
```bash
# 1. 停容器
docker stop freellm-hub && docker rm freellm-hub

# 2. 删旧 volume
docker volume rm freellm-hub-data-prod

# 3. 创建新 volume
docker volume create freellm-hub-data-prod-$(date +%Y%m%d)

# 4. 重新启动
docker run -d ... -v freellm-hub-data-prod-$(date +%Y%m%d):/app/data ...
```

### 5. 容器启动后立即退出

```bash
# 看错误日志
docker logs freellm-hub

# 常见原因:
# - 端口被占用 (见问题 2)
# - 数据 volume 权限不对 (data/ 目录需要 node 用户可写)
# - 内存不足 (free -m 检查)
```

### 6. 数据丢失 / 想迁移到新机器

```bash
# 在旧机器: 备份数据目录
docker run --rm -v freellm-hub-data-prod:/data -v $(pwd):/backup alpine \
  tar czf /backup/hub-data-$(date +%Y%m%d).tar.gz -C /data .

# 在新机器: 创建 volume 并导入
docker volume create freellm-hub-data-prod
docker run --rm -v freellm-hub-data-prod:/data -v $(pwd):/backup alpine \
  tar xzf /backup/hub-data-YYYYMMDD.tar.gz -C /data

# 启动容器 (使用恢复的数据)
docker run -d ... -v freellm-hub-data-prod:/app/data ...
```

**⚠️ 必须备份整个 volume**：包含 `hub.db` + `master.key` + `session.secret` + `backups/`。如果用 docker-compose 的 bind mount，整个 `./data` 目录拷过去就行。

---

## 完全卸载

⚠️ **以下操作会删除所有数据**，请先备份！

```bash
# 1. 停容器
docker stop freellm-hub

# 2. 删容器
docker rm freellm-hub

# 3. 删数据 volume (named volume)
docker volume rm freellm-hub-data-prod

# 或者删数据目录 (bind mount)
rm -rf ./data

# 4. 删镜像 (可选)
docker rmi freellm-hub-v2:v2.0.0
```

---

## 下一步

安装完成后：
1. 📖 阅读 [DEPLOY.md](./DEPLOY.md) 了解反代、备份、监控等运维事项
2. 📜 阅读 [CHANGELOG.md](./CHANGELOG.md) 了解版本变更
3. 🔐 在后台 `/admin/profile` 修改默认设置
4. 🚀 在 `/admin/channels` 添加第一个 Provider，开始使用

---

## 获取帮助

- 文档: 本目录的 `DEPLOY.md`、`CHANGELOG.md`
- 后台接口列表: `GET /api-docs`（需登录后访问）
- 代码: 仓库 `src/` 目录
- 作者主页: [https://www.zhibushi.com](https://www.zhibushi.com)
