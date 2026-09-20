# Changelog

所有本项目的显著变更都记录在此。格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [v2.0.0] - 2026-09-19

首个正式发布版。从内测版 (v1.x) 演进而来，包含完整功能集与生产化加固。

### 核心网关功能

- **多 Provider 路由**: OpenAI / Anthropic / Gemini / Mistral / DeepSeek / Moonshot / 智谱 / 硅基流动 / 商汤 / Agnes / MiniMax / Cohere 等统一接入
- **故障转移 (Fallback)**: 主模型 → 备用模型链，支持顺序 / 加权 / 优先级三种策略，可配置最大重试次数与间隔
- **Cooldown 机制**: 上游 429/5xx 自动冷却，1 分钟探测早恢复，避免雪崩
- **全局降级 (Degradation)**: 实时计算健康 key 比例，自动进入 / 退出降级状态
- **请求追踪**: 每次请求写入 `usage_logs` + `request_attempts`，完整记录重试链

### 模型路由

- **模型映射**: 请求模型名 → 上游模型名，支持链式映射 (A→B→C)，实时预览解析结果
- **虚拟模型**: 一个虚拟模型挂多个上游候选 (Key + 模型 + 优先级 + 权重 + 置顶)
- **模型路由**: 按请求模型配置 channel 列表 (顺序 = failover 顺序)

### 安全 & 权限

- **Admin 鉴权**: bcrypt 密码哈希 + SQLite session 存储，7 天过期
- **Hub Key 鉴权**: API Key 加密存储 (`AES-256-GCM` + master key)
- **Per-Channel-Key 模型白名单**: 每个上游 Key 可限定服务哪些模型
- **Per-Hub-Key 模型白名单**: 每个客户端 Key 可限定调用哪些模型
- **内容护栏 (Guardrails)**: 输入 / 输出过滤、关键词拦截、PII 检测、长度限制
- **登录限流**: 5 次 / 3 分钟 (配置可调)

### 性能与稳定性

- **响应缓存**: 相同 (model + messages) 命中后直接返回，可配置 TTL
- **Hub Key 鉴权在配额检查之前**: 拒绝的请求不消耗上游 quota
- **故障 Key 自动隔离**: 上游错误自动封禁 (heuristic vs authoritative)
- **请求级超时**: 所有上游调用 `AbortSignal.timeout()` 强制超时
- **优雅停机**: SIGTERM/SIGINT → 停后台任务 → 关 HTTP → 关 DB
- **全局错误处理**: 5xx 记录日志 + 返回通用错误，避免泄露内部信息

### 多模态

- **文生图 / 图生图**: OpenAI / Agnes / MiniMax / DeepSeek / Stability 等
- **文生视频 / 图生视频**: MiniMax (Hailuo 2.3) / Agnes (v2.0/2.5)
- **视频任务轮询**: `GET /v1/videos/tasks/:taskId` 查询异步任务状态 + 取回结果
- **语音合成 (TTS) / 语音转文字 (STT)**: 通过 `/v1/audio/*`
- **Embeddings**: 统一的向量嵌入接口

### 管理后台

完整的 React SPA (14 个页面)，全部移动端适配、暗色模式、代码分割懒加载：

| 页面 | 路由 | 功能 |
|---|---|---|
| 总览 | `/admin/dashboard` | 系统状态、24h 请求趋势、路由策略 |
| 渠道管理 | `/admin/channels` | 渠道 CRUD、Key CRUD、批量操作、模型测速、Probe |
| 模型路由 | `/admin/routes` | 路由规则 CRUD |
| 虚拟模型 | `/admin/virtual-models` | 虚拟模型 + 候选管理 |
| 模型映射 | `/admin/mappings` | 模型别名映射 + 链式预览 |
| Hub Keys | `/admin/hub-keys` | 客户端 Key 管理 + 模型白名单 |
| 故障转移 | `/admin/fallback` | 主备模型链配置 |
| 用量统计 | `/admin/usage` | 总览 / 模型统计 / 渠道统计 / 错误分析 / 日志明细 |
| 内容护栏 | `/admin/guardrails` | 过滤规则配置 |
| 响应缓存 | `/admin/cache` | 缓存开关 + 命中率 + 清理 |
| 测试场 | `/admin/playground` | 多轮对话 |
| 聊天 | `/admin/chat` | 多对话管理 |
| API 测试 | `/admin/api` | 全部 `/v1/*` 接口在线测试 |
| 个人资料 | `/admin/profile` | 修改密码 |

### 部署运维

- **Docker**: 单镜像部署，多阶段构建 (client-builder → builder → production)
- **数据持久化**: `data/` volume 挂载 (SQLite + master key + session secret)
- **数据库自动备份**: VACUUM INTO 每天备份一次，最多保留 7 份 / 30 天
- **日志自动清理**: 每天清理 90 天前的 `usage_logs` / `media_tasks` / `request_attempts`
- **健康检查**: Docker 内置 healthcheck (基于 Node http 调用)
- **运维接口**: `GET /api/admin/backup` 列备份、`POST /api/admin/backup` 立即触发
- **CORS**: `/v1/*` 允许跨域 (Origin 反射 + 凭证支持)
- **环境变量**: 所有配置集中在 `src/config/env.ts`

### 客户端 API

完整的 OpenAI 兼容 + Anthropic 兼容 + Responses API：

| 端点 | 兼容性 |
|---|---|
| `POST /v1/chat/completions` | OpenAI |
| `POST /v1/messages` | Anthropic |
| `POST /v1/responses` | OpenAI Responses |
| `POST /v1/embeddings` | OpenAI |
| `POST /v1/images/generations` | OpenAI |
| `POST /v1/images/edits` | OpenAI |
| `POST /v1/audio/speech` | OpenAI TTS |
| `POST /v1/audio/transcriptions` | OpenAI Whisper |
| `POST /v1/videos/generations` | 自定义 (MiniMax / Agnes) |
| `POST /v1/videos/edits` | 自定义 (MiniMax / Agnes) |
| `GET /v1/videos/tasks/:taskId` | 视频任务轮询 |
| `GET /v1/models` | OpenAI |

### 已知限制

- **MiniMax API**: 旧版 `sk-cp-` key 无任务查询权限，提示 `2013 access denied` (上游限制，非代码问题)
- **Agnes 免费层**: 限流较严 (429 rate_limit_exceeded)
- **API 文档**: 无内置 OpenAPI/Swagger，需参考此 CHANGELOG 或源码

### 升级说明

从 v1.x 升级：
1. 备份现有 `data/` 目录
2. 拉取新镜像 `freellm-hub-v2:v2.0.0`
3. 启动容器并挂载 `data/` volume
4. 首次启动会自动执行数据库迁移 (26 个 migration 文件)
5. 旧的 session secret 不兼容，所有 admin 需重新登录

### 镜像标签

- `freellm-hub-v2:latest` - 始终指向最新稳定版
- `freellm-hub-v2:stable` - 锁定为最后一个经过验证的稳定版
- `freellm-hub-v2:v2.0.0` - 锁定 v2.0.0 版本 (当前发布版)
