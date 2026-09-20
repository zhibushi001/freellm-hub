# FreeLLM Hub v2 — 用户指南

> 给"我不懂开发但我想用起来"的你写的。

## 目录

- [零、这是干嘛的](#零这是干嘛的)
- [一、安装（飞牛 OS）](#一安装飞牛-os)
- [二、首次启动：注册管理员](#二首次启动注册管理员)
- [三、添加你的第一个 Provider](#三添加你的第一个-provider)
- [四、创建 Hub Key](#四创建-hub-key)
- [五、配置你的 Agent 工具](#五配置你的-agent-工具)
- [六、HTTPS（公网访问）](#六https公网访问)
- [七、备份](#七备份)
- [八、常见问题](#八常见问题)

---

## 零、这是干嘛的

想象你同时有：

- minimax 的 3 个账号（3 个 API Key）
- OpenRouter 的 2 个账号
- 自建了一台 Mac mini 跑 Ollama

你的手机装了 Hermes Agent，电脑装了 Cline，平板装了 ChatBox。**每个都要分别填一堆 API Key**，换个设备就头大。

**FreeLLM Hub 帮你把这一堆 Key 集中到一个地方，每个设备只需要填 1 个 Hub Key**。换 Key？改 Hub 后台就行，设备端零感知。

**还免费送：**

- 同 Key 失败自动切下一个
- 速度慢的自动避开，用快的
- Token 额度耗尽自动暂停那个 Key，用别的
- 哪个 Key 烧了多少 / 哪些模型调用成功过 / 哪些挂了 — 一目了然

---

## 一、安装（飞牛 OS）

**前置**：飞牛 OS 已经启用 Docker（fnOS 自带）。

### 1. 创建数据目录

打开飞牛 OS 的 SSH（控制台 → 系统设置 → 终端 → 启用 SSH），然后：

```bash
mkdir -p /vol1/1000/docker/freellm-hub
cd /vol1/1000/docker/freellm-hub
```

> 路径可以自己定，但要确保**这个目录在硬盘上**，不要放内存盘。

### 2. 创建 docker-compose.yml

```bash
curl -fsSL https://raw.githubusercontent.com/zhibushi001/freellm-hub-v2/main/docker-compose.yml -o docker-compose.yml
```

如果命令下载失败（国内 GitHub 偶尔抽风），手动创建文件，内容见本仓库 [`docker-compose.yml`](../docker-compose.yml)。

### 3. 启动

```bash
docker compose up -d
```

等待 10-30 秒，看到 `Container freellm-hub Started` 即可。

### 4. 检查状态

```bash
docker compose ps
docker compose logs -f --tail=50
```

看到 `FreeLLM Hub v2 listening on http://0.0.0.0:3030` 说明 OK。

---

## 二、首次启动：注册管理员

**打开浏览器**，访问：

```
http://你的飞牛IP:3030
```

> 飞牛 IP 怎么看：控制台 → 系统设置 → 网络，能看到内网 IP（比如 `192.168.1.100`）。

**会自动跳到注册页**（这是 v2 的核心设计 —— 没有默认 admin/123456，要你自己设密码）。

填写：
- **用户名**：3-32 字符，字母数字下划线（建议用你的常用昵称）
- **密码**：至少 10 字符，必须含字母 + 数字（**不要用生日、123456 这类弱密码**，虽然它会拦截）
- **确认密码**

点 **"创建账号并进入"** → 自动登录 → 进入后台。

> **密码忘了怎么办**：v0.1 暂时不支持密码重置（计划在 v0.2 加）。**请一定记住**，或写在密码管理器里。

---

## 三、添加你的第一个 Provider

进入后台后：

1. 点 **"+ 添加 Provider"** 按钮
2. 看到一堆**卡片**（Google Gemini / Groq / Cerebras / minimax / OpenRouter ...）
3. 找到你要的那个（比如 minimax），点 **[👉 申请]** 跳到 minimax 官网申请 API Key
4. 拿到 Key 后回来点 **[使用]** → 表单**自动填好** base URL 等 → 你**只贴 Key**
5. 点 **"添加"** → 完成

> 如果列表里没有你要的服务，可以点页面最下方的 **"自定义 Provider"**，手填所有字段。

---

## 四、创建 Hub Key

> Hub Key 是给你**设备 + Agent 工具**用的访问凭证。**一个设备一个 Key**，方便管理。

1. 进入后台 → 左侧导航 → **访问** → **Hub Keys**
2. 点 **+ 新建**
3. 填名称：**iPhone-Hermes** / **Office-Mac-Cline** / **NAS-Coding-Agent**（自己起名，建议格式：设备-工具）
4. 提交 → 弹出**一次性展示窗口**（关掉就再也看不到完整 Key）
5. **点"复制"**（或"显示二维码"手机扫码）

> **重要**：现在就粘到你设备上！关掉窗口后只能重生成。

---

## 五、配置你的 Agent 工具

每个 Agent 工具配置都差不多，**就两个值**：

| 项 | 值 |
|---|---|
| **Base URL** | `http://你的飞牛IP:3030/v1` |
| **API Key** | 刚才复制的 Hub Key（`fh_...`） |

### 5.1 Cline (VSCode 插件)

设置 → Cline → API Provider 选 **OpenAI Compatible**：
- Base URL: `http://192.168.1.100:3030/v1`
- API Key: `fh_a3f2e8b9c1...`
- Model ID: 填 Hub 里有的模型，比如 `minimax/M3`

### 5.2 DeepSeek Harness (本项目)

见 DeepSeek Harness 文档，配置 OpenAI 兼容模式时同样填这两个。

### 5.3 Hermes Agent

设置里找 Provider 配置，按 OpenAI 兼容填。

### 5.4 ChatBox / ChatGPT-Next-Web 等

设置 → 自定义 API 端点，填 Base URL + API Key。

---

## 六、HTTPS（公网访问）

> ⚠️ 强烈建议：如果你要从公网访问，**必须**配 HTTPS。否则你的 Hub Key 在网络上裸奔。

飞牛 OS 自带证书管理（**v0.1 阶段推荐先用 Cloudflare Tunnel，最简单**）：

### 6.1 Cloudflare Tunnel（最简单，5 分钟搞定）

1. 注册 [Cloudflare](https://cloudflare.com)，把**你的域名**（必须托管在 Cloudflare）加进去
2. 控制台 → Zero Trust → Networks → Tunnels → **Create a tunnel**
3. 类型选 **Cloudflared**
4. 名字叫 `freellm-hub`
5. 装一个 Cloudflared 到你的飞牛（飞牛应用中心一般有，没有就用 SSH 装）
6. 配置 Public Hostname：
   - Subdomain: `hub` (你想要的名字)
   - Domain: `你的域名.com`
   - Service: `http://localhost:3030`
7. 保存 → 等待 1 分钟

访问 `https://hub.你的域名.com` 就能用，全自动 HTTPS。

### 6.2 飞牛 OS 自带证书（进阶）

控制台 → 系统设置 → 安全 → 证书 → 申请 Let's Encrypt → 反向代理到 `127.0.0.1:3030`。

Hub 这边**什么都不用做**。

---

## 七、备份

> **最重要的两个文件**（都在 `data/` 目录下）：
> - `data/hub.db` — 你的所有配置、加密的 Key、Hub Key 哈希、调用记录
> - `data/master.key` — 主加密密钥。**丢了这个 = 所有上游 API Key 都解不开，必须重新输入！**

**建议每天 cron 备份整个 `data/` 目录**。最简单的做法：

```bash
# 在飞牛 OS 控制台设置"计划任务", 每天 3 点跑:
tar czf /vol1/1000/backup/freellm-hub-$(date +\%F).tar.gz /vol1/1000/docker/freellm-hub/data
```

把备份传到云盘 / 另一块硬盘。

Hub 后台也会提供"下载加密备份"按钮（一键下载 zip）。

---

## 八、常见问题

**Q: 启动后访问 502 / 连接拒绝？**
A: 等 10-30 秒再试。`docker compose logs -f` 看输出。

**Q: 注册时提示"密码太弱"？**
A: 必须 ≥10 字符 + 含字母 + 含数字。试试 `MyHub2024!Secure`

**Q: 添加 Provider 后测试失败？**
A: 大概率是 Key 错或 base URL 错。点 Provider 卡片上的 **"测试"** 按钮看具体错误。

**Q: Agent 工具报 401？**
A: Hub Key 错 / 被禁用 / 已删除。在 Hub 后台 → 访问 → Hub Keys 看状态。

**Q: Agent 工具报 404 model not found？**
A: 客户端请求的 model 名 Hub 里没注册。先在 Hub 后台加一个 Virtual Model（Phase 2 上线后才有完整 UI；Phase 1 暂时手动加）。

**Q: 公网访问不安全吗？**
A: 必须套 HTTPS（见 §六），否则 Hub Key 会泄露。套上 HTTPS 后：
- 通信加密 ✓
- 仍要靠密码强（≥10 字符）防爆破
- Hub 后台登录失败 5 次/3 分钟 临时封 IP

**Q: 数据能从 v1 迁过来吗？**
A: **v0.1 不做**。推倒重来。手动加几个 Key 也就 5 分钟。

**Q: 升级版本怎么升？**
```bash
cd /vol1/1000/docker/freellm-hub
docker compose pull
docker compose up -d
```
DB migration 启动时自动跑，不会丢数据。

---

## 九、高级用法

### 9.1 多协议接入 (Phase 3)

Hub 同时支持 **3 种协议**，同一个 Hub Key 通吃:

| 协议 | 路径 | 用途 |
|---|---|---|
| OpenAI Chat Completions | `/v1/chat/completions` | Cline / ChatBox / DSH / Hermes / 通用 |
| OpenAI Responses | `/v1/responses` | Codex CLI / Agents SDK 2024-09+ |
| Anthropic Messages | `/v1/messages` | Claude Code / Hermes Agent (Anthropic 模式) |

**Claude Code 用 hub 跑工具调用**:
```bash
export ANTHROPIC_BASE_URL=http://your-hub:3030
export ANTHROPIC_API_KEY=<hub-key>
# 工具调用 (Bash/Read/Edit) 自动透传
```

### 9.2 Admin Web UI (Phase 4.A)

打开 `http://your-hub:3030/admin/`，登录后看到 4 个标签:

- **总览 (Dashboard)**: Channel / Key / Hub Key 数, 24h 请求量 / 成功率 / tokens
- **Channels**: 加/删 Channel, 加/删 Key, 探活
- **Hub Keys**: 客户端用的 API Key, 可撤销/重新生成
- **用量统计**: 7/14/30/90 天每日趋势 (请求/成功/错误/成功率/总 tokens/平均延迟)

### 9.3 测速 / 健康评分 (Phase 4.B)

```bash
# 单 key 测速 (默认 5 samples)
curl -X POST http://your-hub:3030/api/admin/benchmark/1 \
  -H "Cookie: $COOKIE" -H "content-type: application/json" \
  -d '{"samples": 10, "model": "gpt-4o-mini"}'

# 全部 enabled key 测速
curl -X POST http://your-hub:3030/api/admin/benchmark-all \
  -H "Cookie: $COOKIE" -H "content-type: application/json" \
  -d '{"samples": 5}'
```

返回:
```json
{
  "keyId": 1, "samples": 5, "successes": 5, "errors": 0,
  "successRate": 1.0,
  "avgLatencyMs": 320, "p50LatencyMs": 100, "p95LatencyMs": 280,
  "totalTokens": 65, "score": 95
}
```

**Score 算法**: success 60% + p95 latency 30% + avg latency 10%. 0-100.

### 9.4 限流感知路由 (Phase 4.C)

Hub 主动跟踪每个 (key, model) 的 in-flight 请求数。同一 key 已有 in-flight 时, **自动降权 1/(1+n)**, 让空闲 key 优先。

观察 in-flight:
```bash
curl http://your-hub:3030/api/admin/inflight -H "Cookie: $COOKIE"
# {"items":[{"keyId":1,"model":"gpt-4o-mini","count":3,"lastStartedAt":...}]}
```

**解决的场景**:
- 上游 OpenAI 限制 RPM (e.g. 60/min), 多个 Agent 同时用, hub 不感知会触发 429
- 启用 in-flight 跟踪后, hub 主动 spread 到多个 key

