# FreeLLM Hub v2 — 设计文档

> 推倒重来版本。本文档是 v2 的"施工图"，包含信息架构、数据模型、API、路由算法、模块拆分、技术选型与开发路线。
> 阅读顺序：**先看 §1（信息架构 / 页面树）→ §2（核心概念）→ §3（数据模型）→ §4（路由算法）→ §6（开发路线）**。其余按需查阅。

---

## 目录

- [§1. 信息架构 / Dashboard 页面树](#1-信息架构--dashboard-页面树)
- [§2. 核心概念（领域模型）](#2-核心概念领域模型)
- [§3. SQLite 数据模型](#3-sqlite-数据模型)
- [§4. 核心路由算法（关键）](#4-核心路由算法关键)
- [§5. API 设计](#5-api-设计)
- [§6. 多协议适配层](#6-多协议适配层)
- [§7. UI 设计语言](#7-ui-设计语言)
- [§8. 模块拆分 / 项目结构](#8-模块拆分--项目结构)
- [§9. 技术选型](#9-技术选型)
- [§10. 安全](#10-安全)
- [§11. 部署 / 运维](#11-部署--运维)
- [§12. 开发路线图（MVP → v1.0）](#12-开发路线图mvp--v10)
- [§13. 风险点 & 取舍](#13-风险点--取舍)
- [§14. 借鉴来源 & 致谢](#14-借鉴来源--致谢)

---

## §1. 信息架构 / Dashboard 页面树

### 1.1 顶层结构 — 三块分离

把 Dashboard 严格分成 **"使用面"** 和 **"管理面"** 两个独立入口，不再像 v1 那样把聊天、模型、Provider、Hub Key 混在同一个 Tab 切换系统里。

```
┌────────────────────────────────────────────────────────────┐
│  Top Bar:  [FreeLLM Hub]  · [⚡ Playground]  · [⚙ 管理] · 用户│
└────────────────────────────────────────────────────────────┘
            │                              │
            ▼                              ▼
        使用面（公网入口）           管理面（admin 密码）
        /playground                  /admin/*
        /v1/chat/completions ...
```

**为什么这样分**：
- 使用面是高频交互（聊天、试模型、看用量），管理面是低频配置。
- v1 最大的混乱就是**"4 个 Tab 全是平级切换，但心智上是 2 类事"**。分裂成两个独立路由立刻清晰 10 倍。

### 1.2 使用面 — `/playground`

> 这是日常 90% 时间的去处。设计目标是"进去就能用，不迷路"。

**单页布局**（不分子 Tab，所有信息一目了然）：

```
┌─────────────────────────────────────────────────────────────┐
│  Header:  🟢 状态  ·  🌐 当前请求域名  ·  🔑 当前 Hub Key     │
├─────────────────────────────────────────────────────────────┤
│  模型选择区（折叠，默认收起）                                  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ 当前选择:  [minimax / M3 ▾]                          │  │
│  │ ├─ 状态: 🟢 健康 (3/4 渠道可用)                      │  │
│  │ ├─ 优先顺序: minimax/M3 → openrouter/M3 → ...        │  │
│  │ └─ 每日剩余:  ~72% (聚合估算)                         │  │
│  └──────────────────────────────────────────────────────┘  │
├─────────────────────────────────────────────────────────────┤
│  聊天区                                                      │
│  ┌─────────────────┐  ┌────────────────────────────────┐   │
│  │ 历史会话列表     │  │ 消息流（SSE 流式）             │   │
│  │ · 会话 A        │  │  [user] 你好                   │   │
│  │ · 会话 B        │  │  [assistant] 你好！...         │   │
│  │ + 新会话         │  │  ▍ (流式输出中...)             │   │
│  └─────────────────┘  └────────────────────────────────┘   │
│                          [输入框......................] [发送] │
├─────────────────────────────────────────────────────────────┤
│  Footer:  本次请求：1.2s · 124 tokens · 走 minimax/A1       │
└─────────────────────────────────────────────────────────────┘
```

**核心交互**：
- 点模型选择器 → 弹一个**有上下文的搜索框**：输入 `m3` 看哪些渠道声称有 M3；输入 `minimax` 看 minimax 所有模型。
- 每个候选渠道**实时显示健康度**（绿/黄/红/灰）。
- 发送前显示**预计路由**：走哪个 Key、该 Key 当前状态。
- 发送后 Footer 显示**实际走的路径**和**耗时/token**。

**特点**：
- 单一滚动页面，**不分子 Tab**。
- 模型选择器是中心、聊天是默认焦点。
- 历史上让人头疼的"我现在到底在调哪个 Key"——Footer 直接显示。

### 1.3 管理面 — `/admin/*`

> 目标是"5 分钟配完一个 Provider，10 分钟管完所有"。所有 admin 页面都在密码保护下。

**左侧导航固定 4 项**（不是 Tab，是导航）：

```
⚙ 总览 (Dashboard)
🔌 渠道 (Channels)
   ├─ /admin/channels            渠道列表（含 Keys 折叠展开）
   ├─ /admin/channels/new        单条新增
   └─ /admin/channels/import     批量导入（JSON）
🤖 模型 (Models)
   ├─ /admin/models              模型视图（跨渠道聚合）
   └─ /admin/models/mapping      模型重定向
📊 用量 (Usage)
   ├─ /admin/usage/realtime      实时面板
   ├─ /admin/usage/historical    历史聚合
   └─ /admin/usage/by-key        按 Key 看
🔑 访问 (Access)
   ├─ /admin/access/hub-keys     Hub Key 管理（多 Key 命名/撤销/重生成）
   ├─ /admin/access/settings     站点设置（密码、域名、HTTPS）
   └─ /admin/access/audit        审计日志
```

#### 1.3.1 渠道列表（最关键一页）

> 解决"一个 Provider 下多个 Key 怎么管"的核心场景。

**布局**：每个 Provider 一张卡片，卡片内展开看该 Provider 下所有 Key。

```
┌──────────────────────────────────────────────────────────────┐
│  minimax                                      [+ 添加 Key]   │
│  ──────────────────────────────────────────────────────      │
│  📡 base: https://api.minimax.chat/v1                         │
│  🧪 协议: OpenAI 兼容    🔄 上次探测: 2 分钟前                │
│  📊 已探测到 12 个模型    [查看 →]                            │
│                                                              │
│  ▼ Keys (3)                                                  │
│  ┌──────────────────────────────────────────────────────┐    │
│  │ 🔑 A1 - 主力账号     🟢 健康                         │    │
│  │    标签: [主力] [免费]                               │    │
│  │    配额: 剩 72% (日)   ·   速度: 1.2s avg            │    │
│  │    最后调用: 1m 前 ✅ 1.2s                           │    │
│  │    30天: ✅ 1,234 · ❌ 3 · 成功率 99.7%              │    │
│  │    [🧪 测试] [⏸ 禁用] [🗑 删除]                     │    │
│  ├──────────────────────────────────────────────────────┤    │
│  │ 🔑 A2 - 备用账号     🟡 警告                         │    │
│  │    标签: [备用]                                     │    │
│  │    配额: 剩 18% (日)   ·   速度: 1.5s avg            │    │
│  │    最后调用: 15m 前 ✅ 1.5s                          │    │
│  │    30天: ✅ 234 · ❌ 5 · 成功率 97.9%               │    │
│  │    [🧪 测试] [⏸ 禁用] [🗑 删除]                     │    │
│  ├──────────────────────────────────────────────────────┤    │
│  │ 🔑 A3 - 全新          ⚪ 未激活                       │    │
│  │    [▶ 启用] [🗑 删除]                               │    │
│  └──────────────────────────────────────────────────────┘    │
│  整体: 1 健康 / 1 警告 / 1 备用  ·  [🧪 全部测试] [🔄 重新探测]│
└──────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────┐
│  openrouter                                    [+ 添加 Key]   │
│  ...                                                          │
└──────────────────────────────────────────────────────────────┘
```

**这个页面是 v2 的"主屏"**——你加 Key、删 Key、查状态全在这里。

**特点**：
- **按 Provider 分组**（不是按单 Key 一长列）——对应用户的心智模型
- **多 Key 一目了然**：哪些活跃、哪些快没额度
- **每 Key 一行可独立操作**
- **状态颜色化**：🟢🟡🔴⚪ 对应 健康/警告/失败/未激活
- **探测按钮**：一键重新拉 `/v1/models` 看支持哪些
- **每 Key 都给一个"🧪 测试"按钮**（不只是看状态，要发真实请求验证）—— **从 new-api 学的**
- **每 Key 显示"最近一次调用结果"**（✅成功 / ❌失败 + 错误码 + 时间）—— **从你反馈来**

#### 1.3.1.1 申请引导流（来自 freellmapi 的"一键跳转 + 自动获取"）

> 这是你特别说"挺好"的部分。保留并加强。

**入口**：admin 页面顶部固定一个按钮 `[+ 添加 Provider]`，点开后**不是表单**，而是**卡片网格**：

```
┌──────────────────────────────────────────────────────────────────────┐
│  添加 Provider                                                       │
│  ─────────────────────────────────────────────────────               │
│  🟢 免费  🟡 免费额度  🔴 付费  🌏 国内  [搜索框........]            │
│                                                                      │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐      │
│  │ 🟢 Google Gemini │  │ 🟢 Groq          │  │ 🟢 Cerebras     │      │
│  │ ⚡ 速度极快      │  │ ⚡ 速度极快      │  │ ⚡ 速度极快      │      │
│  │ 15 RPM · 1500 RPD│  │ 30 RPM · 14400 RPD│  │ 30 RPM · 7200 RPD│     │
│  │ 30+ 免费模型     │  │ Llama 3.3 70B 等 │  │ Llama 3.3 70B 等 │      │
│  │ [👉 申请] [使用] │  │ [👉 申请] [使用] │  │ [👉 申请] [使用] │      │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘      │
│  ...                                                                  │
└──────────────────────────────────────────────────────────────────────┘
```

- 卡片数据来自内置 `seed-providers.ts`（常见 30+ Provider 预设），**不依赖外网目录**
- `[👉 申请]` 按钮直接 `window.open(provider.signup_url)` 跳到官方申请页
- `[使用]` 按钮 → 自动填好 baseUrl/apiPath/modelsPath/protocol，**用户只需填 API Key 即可**
- **不试图"自动获取" Key**（OAuth 流程各家不一、且需要用户授权，**不替用户做决定**）
  - freellmapi 的"自动获取"实际是用户**复制粘贴**进 Hub，我们同样支持：申请页打开 → 用户复制 Key → 回来粘贴 → 一键"使用"

#### 1.3.2 批量导入（JSON）

兼容三套格式（v1 已经做的，保留）：

```json
// 格式 A：v2 自家导出
{
  "version": 2,
  "channels": [
    {
      "provider": "minimax",
      "baseUrl": "https://api.minimax.chat/v1",
      "apiPath": "/chat/completions",
      "modelsPath": "/models",
      "protocol": "openai",
      "keys": [
        { "label": "A1-主力", "apiKey": "sk-xxx", "tags": ["主力"] },
        { "label": "A2-备用", "apiKey": "sk-yyy", "tags": ["备用"] }
      ]
    }
  ]
}

// 格式 B：freellmapi 风格
[{ "platform": "minimax", "apiKey": "sk-xxx", "baseUrl": "..." }]

// 格式 C：one-api 风格的单条
{ "name": "minimax", "type": 2, "key": "sk-xxx", "base_url": "..." }
```

导入时**先预览**（哪些会新建、哪些会覆盖、哪些格式识别不出），确认后再写入。

#### 1.3.3 模型视图 — 跨渠道聚合

```
┌──────────────────────────────────────────────────────────────┐
│  M3                                                           │
│  ────────────────────────────────────────────────────         │
│  来源: minimax · openrouter · 自建代理                        │
│  聚合状态: 🟢 健康 (3/4 候选可用)                             │
│  30 天统计: 请求 1,234 · 成功率 99.2% · 平均 1.3s            │
│                                                              │
│  优先顺序（可拖拽）:                                          │
│  ┌────────────────────────────────────────────────────┐      │
│  │ #1 minimax / A1 / M3           🟢  可用  [测速]    │      │
│  │    最后调用: 2m 前 ✅ 1.2s                          │      │
│  │    30天: ✅ 612 次 · ❌ 0 次 · 平均 1.2s           │      │
│  │    配额: 日 72% · 周 88%                          │      │
│  ├────────────────────────────────────────────────────┤      │
│  │ #2 openrouter / B2 / anthropic/claude-3.5  🟢      │      │
│  │    最后调用: 5m 前 ✅ 1.4s                          │      │
│  │    30天: ✅ 234 次 · ❌ 1 次 · 平均 1.4s           │      │
│  │    配额: 日 88% · 周 91%                          │      │
│  ├────────────────────────────────────────────────────┤      │
│  │ #3 minimax / A2 / M3           🟡 警告  [测速]    │      │
│  │    最后调用: 1h 前 ✅ 1.5s                          │      │
│  │    30天: ✅ 156 次 · ❌ 3 次 · 平均 1.5s           │      │
│  │    配额: 日 18% (⚠ 即将耗尽)                       │      │
│  ├────────────────────────────────────────────────────┤      │
│  │ #4 自建代理 / local1 / M3       🔴 失败  [测速]    │      │
│  │    最后调用: 2h 前 ❌ 502 Bad Gateway                │      │
│  │    30天: ✅ 12 次 · ❌ 8 次 · 平均 0.3s            │      │
│  └────────────────────────────────────────────────────┘      │
│                                                              │
│  [🧪 批量测速]  [📊 30天图表]  [➕ 添加候选]  [📋 复制 cURL]   │
└──────────────────────────────────────────────────────────────┘
```

**这是 v2 的"杀手锏页面"**——直接解决你说的两个痛点：

### ✅ 痛点 1: "对单个模型测速" — 每个候选都有 `[测速]` 按钮
- 点 `[测速]` → 弹出测速小窗 → 发一个固定的 `你好` 请求给该候选 → 显示 **TTFT（首 token 时间）/ 总耗时 / tokens / 状态码**
- `[🧪 批量测速]` → 一次性测所有候选 → 列表实时更新速度
- **测速结果自动更新该候选的 `avg_latency_ms`**，影响路由排序
- 测速时**流式 + 非流式**两种都可选（测 TTFT 必须流式）
- 测速数据**和真实调用数据合并统计**（不是分开两套指标，避免"测速漂亮但实际很慢"）

### ✅ 痛点 2: "看不到模型有没有调用成功" — 每行都显示最近 + 30天统计
- **最后调用**：`2m 前 ✅ 1.2s` 或 `1h 前 ❌ 502 Bad Gateway`
- **30天统计**：✅ 成功次数 / ❌ 失败次数 / 平均耗时
- **失败详情**（点 ❌ 次数展开）：最近 5 条失败记录 + 错误码 + 错误信息
- **`[📊 30天图表]`** → 简单折线图（成功率 + 延迟）

**其他不变特性**：
- 一个 `M3` 名字对应多个候选来源
- 拖拽排序就是**手动调优先级**
- **聚合状态**：只要有一个 🟢，模型名 `M3` 就 🟢；全 🔴 才是 🔴

#### 1.3.3.1 测速结果展示（弹窗）

```
┌──────────────────────────────────────────────┐
│  测速: minimax / A1 / M3            [关闭]   │
│  ─────────────────────────────────────       │
│  流式: ☑ (测首 token)                         │
│  Prompt: 你好，请用一句话介绍你自己            │
│                                              │
│  [▶ 开始测速]                                │
│                                              │
│  ─── 测速结果（最近 3 次） ───                │
│  ✅ 1.18s · TTFT 0.32s · 78 tokens · 200 OK  │
│  ✅ 1.21s · TTFT 0.35s · 78 tokens · 200 OK  │
│  ✅ 1.15s · TTFT 0.30s · 78 tokens · 200 OK  │
│                                              │
│  ─── 历史 5 次 ───                           │
│  1.18s · 1.21s · 1.15s · 1.25s · 1.19s        │
│  平均 1.20s · 标准差 0.04s                   │
└──────────────────────────────────────────────┘
```

#### 1.3.4 模型重定向

```json
// 用户请求 gpt-4o → 自动改写到 minimax/M3
{
  "mappings": [
    { "from": "gpt-4o",   "to": "M3" },
    { "from": "claude-3.5", "to": "minimax/M3" }
  ]
}
```

#### 1.3.5 Hub Key 管理 — 你的多设备多 Agent 解决方案

> **场景**：你有多台电脑、多部手机、装不同 Agent（Cline / Hermes / Harness / ChatBox ...），每个都要 API Key。
> **痛点**：散落各处不好管理，泄漏了不知道改哪个。
> **解决**：在 Hub 集中管理，按设备命名，一键撤销 / 一键重生成。

**列表页 `/admin/access/hub-keys`**：

```
┌──────────────────────────────────────────────────────────────────────┐
│  Hub Keys — 给 Agent 工具用的访问凭证                            [+ 新建]│
│  ─────────────────────────────────────────────────────               │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │ 📱 iPhone-Hermes           🟢 启用  [📋 复制] [⏸ 禁用] [🔄 重生成] [🗑 删除]│
│  │    fh_a3f2...b9c1    创建于 2024-12-01  ·  最后用: 2m 前        │   │
│  │    30天: 234 请求 · 成功率 100% · 1.2M tokens                  │   │
│  ├──────────────────────────────────────────────────────────────┤   │
│  │ 💻 Office-Mac-Cline         🟢 启用  [📋 复制] [⏸ 禁用] [🔄 重生成] [🗑 删除]│
│  │    fh_7e81...4d22    创建于 2024-12-05  ·  最后用: 5m 前        │   │
│  │    30天: 1,234 请求 · 成功率 99.5% · 5.6M tokens               │   │
│  ├──────────────────────────────────────────────────────────────┤   │
│  │ 📱 Android-ChatBox          🟢 启用  [📋 复制] [⏸ 禁用] [🔄 重生成] [🗑 删除]│
│  │    fh_2b94...8f03    创建于 2024-12-10  ·  最后用: 1h 前        │   │
│  │    30天: 89 请求 · 成功率 98.9% · 234k tokens                  │   │
│  ├──────────────────────────────────────────────────────────────┤   │
│  │ 🤖 Coding-Agent-NAS         ⚪ 禁用  [📋 复制] [▶ 启用] [🔄 重生成] [🗑 删除]│
│  │    fh_5c11...a7e9    创建于 2024-11-20  ·  最后用: 30d 前       │   │
│  │    30天: 0 请求                                              │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                      │
│  提示: 每个设备用一个 Key，泄漏一个不影响其他。点 [🔄 重生成] 可换新 Key。│
└──────────────────────────────────────────────────────────────────────┘
```

**新建 Hub Key 流程**：

```
1. 点 [+ 新建] 弹出表单：
   · 名称 (必填): "iPhone-Hermes"    ← 建议格式: 设备-工具
   · 备注 (可选): "主用手机 / 出差用"
   · 速率限制 (可选): 默认不限
   · 过期时间 (可选): 默认永不过期
2. 提交 → 生成 fh_<64hex>
3. 弹出**一次性展示窗口**（关掉就再也看不到完整 Key）：
   ┌────────────────────────────────────────────┐
   │  🎉 已创建 Hub Key                            │
   │  ────────────────────────────              │
   │  名称: iPhone-Hermes                        │
   │  Key:  fh_a3f2e8b9c1d4f5e6... (完整 67 字符)│
   │                                            │
   │  ⚠️ 这是唯一一次显示完整 Key，请立即复制！  │
   │                                            │
   │  📋 一键复制    [📱 显示二维码]             │
   │                                            │
   │  [知道了，去 Agent 工具里粘贴]              │
   └────────────────────────────────────────────┘
4. 用户在 iPhone 的 Hermes Agent 设置里粘进去
5. 完成
```

**关键功能**：

| 功能 | 行为 | 用例 |
|---|---|---|
| **新建** | 生成 64 位随机 hex，前缀 `fh_`，明文只显示一次 | 新设备接入 |
| **复制** | 把明文 Key 复制到剪贴板（如果忘了，只能重生成） | 在设备上粘贴 |
| **二维码** | 显示完整 Key 的二维码 | 手机扫码配对（不用手输） |
| **禁用** | Key 立即失效，设备上请求返回 401 | 设备暂时不用 |
| **启用** | 恢复 Key | 设备重新启用 |
| **🔄 重生成** | 旧 Key 立即失效 + 生成新 Key 显示一次 | **泄漏场景**：一键换新 |
| **🗑 删除** | 永久删除（连带该 Key 的 usage 历史） | 设备淘汰 |

**`/v1/...` 鉴权时的友好错误**：

```
// Hub Key 被禁用
401 {"error":{"message":"Hub Key 已被禁用 (iPhone-Hermes). 在 Hub 后台启用。","code":"hub_key_disabled"}}

// Hub Key 错误
401 {"error":{"message":"Hub Key 无效。请检查是否拼写错误。","code":"hub_key_invalid"}}

// Hub Key 已删除
401 {"error":{"message":"Hub Key 已被删除。请在 Hub 后台创建新的。","code":"hub_key_not_found"}}
```

**`usage_logs` 关联**：
- 每条请求日志带 `hub_key_id`
- 模型视图的统计可以**按 Hub Key 维度拆分**（哪个设备烧了多少）

**多设备零散的 API Key 集中管理的工作流**（解决你 Q4 的根本痛点）：

```
场景: 你有 5 个设备 5 个不同 Agent
┌────────────────────────────────────────────────────────────┐
│ 之前 (散落):                                                │
│   iPhone Hermes   里存了 sk-abc123                          │
│   Office Mac Cline 里存了 sk-def456                         │
│   ... 各管各的, 泄漏了要每个去换                             │
│                                                            │
│ 之后 (Hub 集中):                                            │
│   Hub 上加 5 个 Provider / 10 个 Key, 全加密存              │
│   生成 5 个 Hub Key:                                       │
│     fh_aaa... → 粘到 iPhone Hermes                          │
│     fh_bbb... → 粘到 Office Mac Cline                       │
│     fh_ccc... → 粘到 Android ChatBox                        │
│     fh_ddd... → 粘到 NAS Coding Agent                       │
│     fh_eee... → 粘到备用设备                                │
│   设备上只存 Hub Key (不存上游 sk-xxx)                      │
│   泄漏 fh_aaa → 删 fh_aaa + 新建 fh_fff 给 iPhone, 其他无感│
│   想换上游 Key → 在 Hub 后台换 (设备端无感)                 │
└────────────────────────────────────────────────────────────┘
```

### 1.4 总览页（Dashboard 首页）

```
┌──────────────────────────────────────────────────────────────┐
│  欢迎回来 👋                            [复制 Hub URL 按钮]   │
├──────────────────────────────────────────────────────────────┤
│  卡片1: 渠道总览                                              │
│  总渠道: 12   健康: 10   警告: 1   失败: 1                    │
│                                                              │
│  卡片2: 24h 用量                                              │
│  请求数: 1,234   Tokens: 4.2M   错误率: 0.3%                 │
│  走过的渠道 Top 3: minimax/A1 (60%), openrouter/B2 (30%)...   │
│                                                              │
│  卡片3: 待办（自动）                                          │
│  ⚠ minimax/A2 今日额度剩 18%，明天可能挂                     │
│  ⚠ openrouter/B2 最近 1h 错误率 12%                           │
│                                                              │
│  卡片4: 5 分钟入门（首次访问）                                 │
│  [1. 添加你的第一个 Provider]                                 │
│  [2. 创建 Hub Key]                                           │
│  [3. 把 base URL 填到你的 Agent 工具里]                       │
└──────────────────────────────────────────────────────────────┘
```

---

## §2. 核心概念（领域模型）

### 2.1 五个一等公民

| 概念 | 定义 | 示例 |
|---|---|---|
| **Provider** | 上游服务厂商（一种"协议+域名"的归类） | minimax, openrouter, 自建 ollama |
| **Channel** | 一个 Provider 下的**一个完整接入点**（含 base url + 协议 + 多个 Keys） | "minimax 渠道（含 3 个 Key）" |
| **Key** | 上游账号的具体 API Key，是**真正的额度单位** | minimax/A1, minimax/A2 |
| **VirtualModel** | 对外暴露的模型名（"逻辑模型"） | `M3`, `gpt-4o`（被重定向后） |
| **ModelCandidate** | VirtualModel 下面的一个具体候选 | `M3` → minimax/A1:M3, openrouter/B2:M3 |

**心智模型**（用一句话）：
> **Channel = 一个上游的接入点**；**Key = Channel 下的一个账号**；**VirtualModel = 客户端看到的名字**；**ModelCandidate = VirtualModel 背后一个具体的 (Key, upstream-model) 对**。

### 2.2 模型名约定

**对外（客户端可见）**：
- `M3` — VirtualModel，自动从候选池里挑
- `minimax/M3` — 显式指定走 minimax 渠道的 M3 模型（绕过候选池路由）
- `minimax/A1/M3` — 显式指定 minimax 渠道的 A1 Key（**强制走指定 Key**，用于调试）

**路由优先级**（从高到低）：
1. **显式指定 Key**（`provider/key/model`）— **强制**，不做 failover
2. **显式指定 Provider**（`provider/model`）— 在该 Provider 内做 Key failover
3. **逻辑模型名**（`M3`）— 在所有候选里做策略路由（详见 §4）

### 2.3 三种"耗尽"语义

> 这是用户最容易混淆的地方，必须在 UI 和文档里讲清楚。

| 错误码 | 含义 | 自动行为 |
|---|---|---|
| **401** | Key 失效（账号被封/Key 错误） | **永久标记 Key 为 🔴 失败**，不再尝试（除非手动重置） |
| **402 / `insufficient_quota` / `quota_exceeded`** | **Token 额度耗尽** | **临时标记 Key 为 ⚪ quota-exhausted**，**进入冷却**，定时探测恢复 |
| **429** | 速率限制（RPM/RPD） | **临时冷却**（分钟级），到期自动恢复 |
| **5xx** | 上游服务异常 | **短期冷却**（秒级），重试 + failover |
| **400** | 客户端请求错误 | **不重试**，直接返回给客户端 |
| **网络超时** | TCP/SSL 失败 | **短期冷却**，重试 + failover |

**关键区分**：
- **402 是"长时间耗尽"**——今天/这月都用完了，明天/下月可能恢复 → **小时级冷却 + 定时探测**
- **429 是"短时间内爆了"**——几秒/几分钟后恢复 → **分钟级冷却**
- **401 是"永久死了"**——除非用户手动重置，否则永远不用

---

## §3. SQLite 数据模型

### 3.1 表结构

```sql
-- 站点设置（KV 表，存管理员账号、加密主密钥、域名等）
-- 注意：管理员账号密码用 argon2 哈希存，**不是明文**
CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
-- 典型 key:
--   'admin_users'        -> JSON: [{"id":1,"username":"zhibin","password_hash":"$argon2id$...","created_at":...}]
--   'km_key_enc'         -> 主加密密钥（被 OS keychain 包裹，可选用）
--   'public_url'         -> 用户配置的公网 URL
--   'setup_completed'    -> '1' 表示已注册过管理员
--   'rate_limit_window'  -> 速率限制窗口（分钟）

-- 上游 Provider 定义
CREATE TABLE providers (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL UNIQUE,         -- 'minimax', 'openrouter', 'custom-ollama'
  display_name  TEXT,                          -- UI 上显示的友好名
  base_url      TEXT NOT NULL,                 -- 上游根地址
  protocol      TEXT NOT NULL DEFAULT 'openai',-- 'openai' | 'anthropic' | 'gemini' | 'ollama' | 'custom'
  api_path      TEXT NOT NULL DEFAULT '/chat/completions',
  models_path   TEXT NOT NULL DEFAULT '/models',
  extra_config  TEXT,                          -- JSON: 各协议特殊字段（如 anthropic 版本）
  signup_url    TEXT,                          -- 该 Provider 的申请 Key 链接（UI 展示）
  notes         TEXT,
  enabled       INTEGER NOT NULL DEFAULT 1,
  created_at    INTEGER NOT NULL,              -- unix ms
  updated_at    INTEGER NOT NULL
);

-- Channel = 一个 Provider 下的完整接入点
-- 一个 Channel 至少一个 Key；同 Channel 多 Key 用于轮询/降级
CREATE TABLE channels (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  provider_id  INTEGER NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  label        TEXT,                            -- '主力', '备用-A', 用户备注
  enabled      INTEGER NOT NULL DEFAULT 1,
  weight       INTEGER NOT NULL DEFAULT 1,      -- 路由权重（数值越大越优先）
  priority     INTEGER NOT NULL DEFAULT 0,      -- 拖拽排序的 priority（同 provider 内）
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);

-- Key = Channel 下的一个上游账号
-- 关键：api_key_enc 是 AES-256-GCM 加密的密文
CREATE TABLE keys (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id      INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  label           TEXT,                          -- 'A1-主力账号'
  api_key_enc     BLOB NOT NULL,                 -- 加密的 API Key
  api_key_hint    TEXT,                          -- 明文末 4 位（用于 UI 识别，'sk-...xyz1'）
  enabled         INTEGER NOT NULL DEFAULT 1,
  tags            TEXT,                          -- JSON 数组: ['主力','免费']
  -- 健康状态
  status          TEXT NOT NULL DEFAULT 'unknown',-- 'healthy' | 'warning' | 'failed' | 'quota_exhausted' | 'cooldown' | 'disabled' | 'unknown'
  status_reason   TEXT,                          -- 状态原因（'quota_exhausted: daily' / '401 invalid_key' ...）
  status_since    INTEGER,                       -- 状态变更时间
  -- 速率跟踪
  rpm_used        INTEGER NOT NULL DEFAULT 0,
  rpd_used        INTEGER NOT NULL DEFAULT 0,
  tpm_used        INTEGER NOT NULL DEFAULT 0,
  tpd_used        INTEGER NOT NULL DEFAULT 0,
  window_reset_at INTEGER,                       -- 速率窗口重置时间
  -- 度量
  avg_latency_ms  INTEGER,                       -- 滑动平均延迟
  success_count   INTEGER NOT NULL DEFAULT 0,
  failure_count   INTEGER NOT NULL DEFAULT 0,
  last_used_at    INTEGER,
  last_probe_at   INTEGER,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
CREATE INDEX idx_keys_channel ON keys(channel_id);
CREATE INDEX idx_keys_status  ON keys(status);

-- 探测缓存：每个 Key 探测到的模型列表
CREATE TABLE discovered_models (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  key_id       INTEGER NOT NULL REFERENCES keys(id) ON DELETE CASCADE,
  upstream_id  TEXT NOT NULL,                    -- 上游真实模型 id 'minimax-M3'
  discovered_at INTEGER NOT NULL,
  UNIQUE(key_id, upstream_id)
);

-- 逻辑模型 (VirtualModel) — 对外暴露的"友好模型名"
CREATE TABLE virtual_models (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT NOT NULL UNIQUE,             -- 'M3', 'gpt-4o'
  display_name TEXT,
  description  TEXT,
  enabled      INTEGER NOT NULL DEFAULT 1,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);

-- ModelCandidate — VirtualModel 下的一个具体候选
-- (key_id, upstream_model_id) 决定唯一候选
CREATE TABLE model_candidates (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  virtual_model_id  INTEGER NOT NULL REFERENCES virtual_models(id) ON DELETE CASCADE,
  key_id            INTEGER NOT NULL REFERENCES keys(id) ON DELETE CASCADE,
  upstream_model    TEXT NOT NULL,                -- 该 Key 下游对应的模型名 'M3'
  priority          INTEGER NOT NULL DEFAULT 0,   -- 拖拽排序
  weight            INTEGER NOT NULL DEFAULT 1,
  enabled           INTEGER NOT NULL DEFAULT 1,
  pinned            INTEGER NOT NULL DEFAULT 0,   -- 1=锁死（用于调试，跳过策略路由）
  created_at        INTEGER NOT NULL,
  UNIQUE(virtual_model_id, key_id, upstream_model)
);

-- 模型重定向：客户端请求 from，自动改写到 to（to 可能是 virtual_model 名或 provider/model）
CREATE TABLE model_mappings (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  from_model  TEXT NOT NULL UNIQUE,               -- 'gpt-4o'
  to_model    TEXT NOT NULL,                      -- 'M3' 或 'minimax/M3'
  enabled     INTEGER NOT NULL DEFAULT 1,
  created_at  INTEGER NOT NULL
);

-- Hub Key — 客户端访问的 bearer
CREATE TABLE hub_keys (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  key_hash        TEXT NOT NULL UNIQUE,           -- 存 SHA256(prefix+secret)，原 key 不入库
  key_prefix      TEXT NOT NULL,                  -- 明文前 12 位用于识别 'fh_abc12345'
  name            TEXT NOT NULL,                  -- 'phone-default', 'laptop-coding'
  enabled         INTEGER NOT NULL DEFAULT 1,
  rate_limit_rpm  INTEGER,                        -- 该 Key 的速率上限（null=不限）
  expires_at      INTEGER,
  last_used_at    INTEGER,
  created_at      INTEGER NOT NULL
);

-- 用量日志（细粒度，按请求）
CREATE TABLE usage_logs (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  hub_key_id        INTEGER REFERENCES hub_keys(id),
  virtual_model_id  INTEGER REFERENCES virtual_models(id),
  candidate_id      INTEGER REFERENCES model_candidates(id),
  key_id            INTEGER REFERENCES keys(id),
  provider_name     TEXT,                          -- 反范式，便于查询
  request_model     TEXT,                          -- 客户端原始请求的 model 字段
  routed_model      TEXT,                          -- 实际走的 upstream model
  prompt_tokens     INTEGER,
  completion_tokens INTEGER,
  total_tokens      INTEGER,
  latency_ms        INTEGER,
  status            TEXT NOT NULL,                 -- 'success' | 'error'
  error_code        INTEGER,
  error_type        TEXT,                          -- 'rate_limit' | 'quota' | 'auth' | 'upstream' | 'client'
  error_message     TEXT,
  stream            INTEGER NOT NULL DEFAULT 0,
  created_at        INTEGER NOT NULL
);
CREATE INDEX idx_usage_created   ON usage_logs(created_at);
CREATE INDEX idx_usage_key       ON usage_logs(key_id, created_at);
CREATE INDEX idx_usage_hub       ON usage_logs(hub_key_id, created_at);

-- 用量聚合（按 Key 按天）— 后台定时汇总，避免每次查实时聚合全表
CREATE TABLE usage_daily (
  key_id            INTEGER NOT NULL,
  day               TEXT NOT NULL,                -- 'YYYY-MM-DD'
  requests          INTEGER NOT NULL DEFAULT 0,
  successes         INTEGER NOT NULL DEFAULT 0,
  failures          INTEGER NOT NULL DEFAULT 0,
  prompt_tokens     INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens      INTEGER NOT NULL DEFAULT 0,
  avg_latency_ms    INTEGER,
  PRIMARY KEY (key_id, day)
);

-- 审计日志
CREATE TABLE audit_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  actor       TEXT,                              -- 'admin' | 'system' | 'hub_key:<id>'
  action      TEXT NOT NULL,                     -- 'channel.create' / 'key.delete' ...
  target_type TEXT,
  target_id   TEXT,
  meta        TEXT,                              -- JSON
  created_at  INTEGER NOT NULL
);
```

### 3.2 加密策略

- **主密钥 (KEK)**：从 `HUB_MASTER_KEY` 环境变量或首次启动时随机生成存 `settings.km_key_enc`（被 OS keychain 包裹——可选用 `keytar` / `secret-tool`）。
- **API Key 加密**：每条记录随机 IV，AES-256-GCM 加密，输出 `iv || ciphertext || tag`，存 `keys.api_key_enc`。
- **永远不存明文 Key**，UI 上**只显示 hint**（首 4 位 + 末 4 位）。

---

## §4. 核心路由算法（关键）

### 4.1 路由目标

> 给定一个请求 `(hub_key, request_model, payload, headers)`，选出一个具体的 `(key, upstream_model)` 对，并把请求转发过去；如果失败，按策略**自动 failover**。

### 4.2 路由决策树

```
请求进来
   │
   ▼
   解析 model 字段 ── 是不是 'provider/key/model' 三段式？
   │                      │
   │                     yes → 强制锁定该 Key，不做 failover（除非显式 allow_failover=1）
   │                      │
   │                      ▼
   │                   直接转发 → 出错返回 5xx
   │
   ▼ no
   是不是 'provider/model' 两段式？
   │                      │
   │                     yes → 在该 provider 下做 Key 池选（用 KeyPoolSelector）
   │                      │
   │                      ▼
   │                   KeyPoolSelector 选出 (key, upstream_model) → 失败在同 provider 内 failover
   │
   ▼ no
   是纯 model 名（如 'M3'）
   │                      │
   │                     yes → 在 virtual_models 找到该名字
   │                      │
   │                      ▼
   │                   CandidateSelector 选 best candidate
   │                      │
   │                      ▼
   │                   选出 (candidate, key, upstream_model) → 失败后切换到该 virtual_model 的下一个 candidate
   │
   ▼ 都没找到
   返回 404 'model not found'
```

### 4.3 KeyPoolSelector — Channel 内 Key 选择

> 用于 "同 Provider 内多 Key 轮询"。

**输入**：一组同 Channel 的 Keys（已 filter 掉 disabled / failed）
**输出**：一个 (key, score)，score 越高越优先

**评分公式**（越高越优先）：

```
score = 1000
      + speed_score           # 0~200, 速度越快分越高（基于 avg_latency_ms）
      + reliability_score     # 0~300, 成功率越高分越高
      - quota_penalty         # 0~500, 剩余额度越少分越低（接近耗尽时大幅扣分）
      - cooldown_penalty      # 如果在冷却期，大幅扣分（实际为负无穷 → 跳过）
      + weight_boost          # 用户手动权重，0~100
```

**特殊规则**：
- 状态为 `quota_exhausted` 或 `failed` 的 Key → **直接跳过**（score 设为 -Infinity）
- 状态为 `cooldown` 的 Key → 跳过直到 `cooldown_until` 过期
- 状态为 `warning` 的 Key → 不跳过，但 `quota_penalty` 拉高

**关于"额度耗尽"的处理**：

```
quota_penalty  = 500 * (1 - remaining_ratio)
remaining_ratio = max(0, 1 - tpd_used / tpd_limit)  # 来自上次探测或主动查询
```

我们**假设**每个上游 Key 有日额度（`tpd_limit`），但不一定能直接拿到；可以通过：
1. **主动查询**：调上游 `GET /v1/usage`（部分 Provider 支持）
2. **被动推断**：根据 `usage_logs` 里的 402 错误 → 把 Key 标 `quota_exhausted`
3. **用户手动**：UI 上有个"剩 18%"按钮让用户标

### 4.4 CandidateSelector — 跨 Channel 选候选

> 用于 "M3 这种逻辑模型，从哪些 (key, model) 里挑"。

**输入**：virtual_model 的所有 enabled candidates
**输出**：best candidate

**评分公式**（和 KeyPool 类似，但加上 "freshness" 维度）：

```
score = 1000
      + speed_score                # 同上
      + reliability_score          # 同上
      + freshness_bonus            # 0~100, 最近 1h 用得少的加分（避免单 Key 烧光）
      - quota_penalty              # 同上
      + priority_boost             # 用户拖拽排序的位置，第一名 +200，第二 +100...
```

**freshness_bonus** 关键算法：

```
# 计算每个 candidate 最近 N 分钟的 token 消耗占比
# 消耗比例越低 → bonus 越高 → 鼓励"用得少"的 candidate

freshness_bonus = 100 * (1 - candidate.usage_ratio_recent)
```

效果：刚加的 Key 自然被偏好；用爆的 Key 自然被冷却。

### 4.5 Failover 引擎

> 这是"自动切换"的核心。

**Failover 触发条件**（**满足任一即触发**）：
- HTTP 401 → 永久标 Key 为 `failed`，**跳到下一个 candidate**（同 virtual_model 继续）
- HTTP 402 / `insufficient_quota` → 标 Key 为 `quota_exhausted`，**跳下一个**
- HTTP 429 → 标 Key 为 `cooldown`（分钟级），**跳下一个**
- HTTP 5xx / 网络错误 → **立即重试一次同一个 Key**（瞬时错误），失败再跳下一个
- 4xx（非 401/402/429）→ **不重试**，直接返回（这是客户端错误，重试无意义）

**Failover 终止条件**：
- 所有 candidate 试完都没成功 → 返回最后一次的错误（或汇总错误）
- 请求总耗时超过 `wall_clock_budget`（默认 60s）→ 返回 `gateway_timeout`
- 已经重试同一个 Key **超过 1 次**（同请求内）→ 跳下一个
- 已经在 virtual_model 内 failover **超过 N 次**（默认 5）→ 抛出 `exhausted_candidates` 错误

**Failover 期间如何处理流式（SSE）**：
- 第一个 candidate 的流**还没开始**（没发出任何 chunk）→ 静默切换到下一个
- 第一个 candidate 的流**已经开始**（至少发出 1 chunk）→ **不再切换**，把当前流跑完（不能给客户端半个 + 半个，HTTP 协议上做不到）
- 这一点必须在文档里写清楚：流式响应**不保证跨 candidate 续接**

### 4.6 评分学习（可选模块）

> v2.0 可选实现：基于 Thompson Sampling 让"哪个 candidate 真的好"自己学出来。

简化为：每个 candidate 维护一个 (α, β) 分布，每次 success α++，每次 fail β++。选 candidate 时从 Beta(α, β) 采样一个分。这个机制在 freellmapi 里被验证有效，但实现起来有调试成本，**v2.0 不上，v3.0 再说**。v2.0 用上面的"加权评分 + freshness"就够。

---

## §5. API 设计

### 5.1 路由总览

```
/                                → 302 → /playground
/playground                      → 使用面 SPA（单页应用）
/playground/assets/*             → 静态资源

/admin                           → 302 → /admin/dashboard
/admin/login                     → admin 登录页
/admin/dashboard                 → 总览
/admin/channels                  → 渠道列表
/admin/channels/new              → 新建渠道
/admin/channels/import           → 批量导入
/admin/channels/:id              → 渠道详情（编辑/Keys）
/admin/models                    → 模型视图
/admin/models/mapping            → 模型重定向
/admin/usage/realtime            → 实时面板
/admin/usage/historical          → 历史
/admin/usage/by-key              → 按 Key
/admin/access/hub-keys           → Hub Key 管理
/admin/access/settings           → 站点设置
/admin/access/audit              → 审计日志

# === 客户端 API（OpenAI 兼容 + 扩展） ===

POST  /v1/chat/completions         OpenAI 兼容聊天（含 SSE 流式）
POST  /v1/completions              旧式 completions
POST  /v1/embeddings               Embeddings
POST  /v1/images/generations       图像生成
POST  /v1/audio/speech             TTS
POST  /v1/audio/transcriptions     STT
GET   /v1/models                   模型列表（聚合自所有 candidates）
POST  /v1/responses                OpenAI Responses API (Codex 客户端用)
GET   /v1/health                   简单健康

# === Anthropic 兼容（让 Claude Code / Hermes Agent 用） ===
POST  /v1/messages                 Anthropic Messages API

# === 管理 API（需要 admin session cookie） ===

GET    /api/admin/providers                  列表
POST   /api/admin/providers                  新建
PATCH  /api/admin/providers/:id              修改
DELETE /api/admin/providers/:id              删除
POST   /api/admin/providers/:id/probe        探测该 provider 的所有 keys

GET    /api/admin/channels                   列表（含 keys 摘要）
POST   /api/admin/channels                   新建
PATCH  /api/admin/channels/:id
DELETE /api/admin/channels/:id

GET    /api/admin/keys                       列表
POST   /api/admin/keys                       新建
PATCH  /api/admin/keys/:id                   改 label/enabled/tags
DELETE /api/admin/keys/:id
POST   /api/admin/keys/:id/test              测试连通
POST   /api/admin/keys/:id/probe-models      重新探测可用模型
POST   /api/admin/keys/bulk-import           JSON 批量导入

GET    /api/admin/virtual-models             列表（含 candidates）
POST   /api/admin/virtual-models
PATCH  /api/admin/virtual-models/:id
DELETE /api/admin/virtual-models/:id
POST   /api/admin/virtual-models/:id/candidates   加 candidate
PATCH  /api/admin/candidates/:id             调优先级/启用
DELETE /api/admin/candidates/:id

GET    /api/admin/model-mappings
POST   /api/admin/model-mappings
DELETE /api/admin/model-mappings/:id

GET    /api/admin/hub-keys                   Hub Key 列表
POST   /api/admin/hub-keys                   创建
DELETE /api/admin/hub-keys/:id

GET    /api/admin/usage/summary?range=24h    聚合
GET    /api/admin/usage/by-key?range=24h
GET    /api/admin/usage/logs?limit=100       明细

GET    /api/admin/audit-logs
GET    /api/admin/settings
PATCH  /api/admin/settings

POST   /api/admin/auth/login                 admin 登录
POST   /api/admin/auth/logout
```

### 5.2 关键响应格式

**`GET /v1/models` 响应**：

```json
{
  "object": "list",
  "data": [
    {
      "id": "M3",
      "object": "model",
      "created": 1735000000,
      "owned_by": "minimax",
      "candidates": [
        { "key": "minimax/A1", "upstream": "M3", "status": "healthy", "score": 1234 },
        { "key": "openrouter/B2", "upstream": "anthropic/claude-3.5", "status": "healthy", "score": 1180 }
      ]
    },
    {
      "id": "minimax/M3",
      "object": "model",
      "created": 1735000000,
      "owned_by": "minimax"
    }
  ]
}
```

**错误响应**（继承 OpenAI 格式）：

```json
{
  "error": {
    "message": "All candidates for model 'M3' failed",
    "type": "gateway_exhausted",
    "code": "all_candidates_exhausted",
    "details": [
      { "key": "minimax/A1", "code": 401, "error": "invalid_api_key" },
      { "key": "openrouter/B2", "code": 429, "error": "rate_limited" }
    ]
  }
}
```

---

## §6. 多协议适配层

### 6.1 当前支持

| 协议 | 端点 | Adapter 模块 | 备注 |
|---|---|---|---|
| **OpenAI Chat Completions** | `/v1/chat/completions` | `adapters/openai.ts` | 95% Agent 工具用这个 |
| **OpenAI Responses** | `/v1/responses` | `adapters/openai-responses.ts` | Codex CLI 必需 |
| **Anthropic Messages** | `/v1/messages` | `adapters/anthropic.ts` | Claude Code / Hermes Agent |
| **Ollama** | `/api/chat` 等 | `adapters/ollama.ts` | 本地模型 + 兼容 Ollama 的远端 |

### 6.2 Provider 协议标识

`providers.protocol` 字段标识上游协议：
- `openai` — 默认（90% 的厂商走这个）
- `anthropic` — Claude 直连
- `gemini` — Google Gemini 原生
- `ollama` — Ollama 兼容
- `custom` — 用户自定义（透传，需要用户在 settings 写详细 mapping）

### 6.3 请求转换

> **关键原则**：用户发给 Hub 的请求是**以 Hub 支持的协议**发的（OpenAI 格式），Hub 内部**按需转换**给上游。

```
OpenAI request (client) ─┐
Anthropic request (client) ─┼─→ 内部 Canonical Request ─→ 上游协议 (per key.protocol)
                         │
Ollama request (client) ─┘
```

**Canonical Request**（内部统一格式）：

```typescript
{
  model: string,
  messages: Array<{ role, content, name?, tool_call_id?, tool_calls? }>,
  tools?: Array<{ type: 'function', function: {...} }>,
  tool_choice?: any,
  temperature?: number,
  max_tokens?: number,
  stream: boolean,
  // ... 透传其他 OpenAI 字段
}
```

每个 Adapter 负责：
- **Request**: Canonical → 目标协议
- **Response**: 目标协议 → Canonical
- **Stream**: 把目标协议的 SSE 事件 → 统一 SSE 事件

---

## §7. UI 设计语言

### 7.1 视觉原则

- **极简暗色主题**（沿用 v1 风格，已经验证不刺眼）
- **不堆装饰**：图标用 emoji 即可，不引图标库
- **状态用颜色，不用文字**（🟢🟡🔴⚪）
- **数字尽量少**：能不展示就不展示，必要时用单数字大字号

### 7.2 交互原则

- **三步原则**：任何操作不超过三次点击就能完成
- **危险操作二次确认**：删除 Key、删除 Channel、批量禁用
- **撤销比确认好**：能 undo 的就 undo（v2.0 MVP 不上，v3.0 上）
- **键盘可达**：所有 button 可 Tab，Enter 提交

### 7.3 不做的事

- ❌ 不用 React/Vue/Svelte 单页框架（服务端渲染 + HTMX 局部刷新）
- ❌ 不用图标库（emoji 够用）
- ❌ 不用 CSS 框架（手写 CSS，~200 行基础样式）
- ❌ 不用 Tailwind（class 爆炸）
- ❌ 不用 toast 库（一个 `<div id="toast">` 就够）

---

## §8. 模块拆分 / 项目结构

```
freellm-hub-v2/
├── package.json
├── tsconfig.json
├── docker-compose.yml
├── Dockerfile
├── .env.example
├── README.md
├── src/
│   ├── server.ts                 # 入口
│   ├── app.ts                    # Fastify 实例 + 插件注册
│   │
│   ├── config/
│   │   ├── env.ts                # 环境变量
│   │   └── defaults.ts
│   │
│   ├── db/
│   │   ├── connection.ts         # better-sqlite3 单例
│   │   ├── migrations/
│   │   │   ├── 001_init.sql
│   │   │   ├── 002_*.sql
│   │   │   └── runner.ts         # 启动时跑 migrations
│   │   └── repos/                # 每个实体一个 repo
│   │       ├── providers.ts
│   │       ├── channels.ts
│   │       ├── keys.ts
│   │       ├── virtualModels.ts
│   │       ├── modelMappings.ts
│   │       ├── hubKeys.ts
│   │       ├── usageLogs.ts
│   │       └── auditLogs.ts
│   │
│   ├── crypto/
│   │   ├── kek.ts                # 主密钥管理
│   │   └── apiKeyCrypto.ts       # AES-256-GCM
│   │
│   ├── auth/
│   │   ├── adminAuth.ts          # admin 密码 + session
│   │   ├── hubKeyAuth.ts         # Hub Key 校验
│   │   └── rateLimit.ts
│   │
│   ├── routing/                  # 核心路由引擎
│   │   ├── resolver.ts           # 解析 model 字段 → 决策树
│   │   ├── keyPoolSelector.ts    # §4.3
│   │   ├── candidateSelector.ts  # §4.4
│   │   ├── scorer.ts             # 评分公式
│   │   ├── failover.ts           # §4.5
│   │   └── budget.ts             # wall-clock budget
│   │
│   ├── adapters/                 # §6 协议适配
│   │   ├── types.ts              # Canonical request/response 类型
│   │   ├── openai.ts             # OpenAI Chat Completions
│   │   ├── openaiResponses.ts    # OpenAI Responses
│   │   ├── anthropic.ts          # Anthropic Messages
│   │   ├── ollama.ts             # Ollama
│   │   └── client.ts             # 通用 HTTP 客户端（含重试/超时）
│   │
│   ├── providers/                # 上游探测
│   │   ├── prober.ts             # 调 /v1/models 探测
│   │   └── quotaChecker.ts       # 主动查 quota
│   │
│   ├── services/                 # 业务编排
│   │   ├── chatService.ts        # chat/completions 主流程
│   │   ├── probeService.ts       # 后台定时探测
│   │   ├── keyHealthService.ts   # 维护 Key 状态
│   │   ├── usageService.ts       # 写 usage_logs + 聚合
│   │   └── importExport.ts       # 导入/导出
│   │
│   ├── http/                     # HTTP 路由（Fastify）
│   │   ├── client/               # 客户端 API（OpenAI 兼容）
│   │   │   ├── chat.ts
│   │   │   ├── completions.ts
│   │   │   ├── embeddings.ts
│   │   │   ├── models.ts
│   │   │   └── images.ts
│   │   ├── admin/                # 管理 API
│   │   │   ├── auth.ts
│   │   │   ├── providers.ts
│   │   │   ├── channels.ts
│   │   │   ├── keys.ts
│   │   │   ├── virtualModels.ts
│   │   │   ├── candidates.ts
│   │   │   ├── modelMappings.ts
│   │   │   ├── hubKeys.ts
│   │   │   ├── usage.ts
│   │   │   ├── settings.ts
│   │   │   └── audit.ts
│   │   └── web/                  # 服务端渲染页面
│   │       ├── playground.ts     # /playground
│   │       └── admin/            # /admin/*
│   │
│   ├── views/                    # 服务端渲染模板
│   │   ├── layout.html
│   │   ├── playground/
│   │   └── admin/
│   │
│   ├── public/                   # 静态资源
│   │   ├── css/
│   │   ├── js/
│   │   └── htmx.min.js
│   │
│   └── util/
│       ├── logger.ts
│       ├── errors.ts
│       └── time.ts
│
├── test/
│   ├── unit/
│   └── integration/
│
└── scripts/
    ├── migrate.ts
    └── seed-providers.ts          # 内置一些常见 Provider 预设
```

### 8.1 模块依赖图

```
http (路由层) ─→ services (业务) ─→ routing (算法) ─→ adapters (协议) ─→ client (HTTP)
                                  ├→ db/repos
                                  ├→ crypto
                                  ├→ auth
                                  └→ providers
```

**严格分层**：上层只能调用下层，反之不行。

---

## §9. 技术选型

| 决策 | 选择 | 理由 |
|---|---|---|
| **运行时** | Node.js 20+ LTS | 单语言全栈（前后端 + 服务端渲染） |
| **语言** | TypeScript（严格模式） | 自带类型、IDE 提示、少 Runtime bug |
| **HTTP 框架** | **Fastify** | 性能好、内建 schema 校验、插件清晰、TypeScript 友好 |
| **模板引擎** | **@kitajs/html**（TypeScript-native JSX） 或 **EJS** | 选 Kitajs 路线：TS 写模板、类型安全；选 EJS：传统简单 |
| **局部刷新** | **HTMX** | 1.9k stars、零构建、原生 HTML 属性 |
| **交互 JS** | **Alpine.js**（按需） | 18k stars、零构建、补 HTMX 不足的客户端状态 |
| **DB** | **better-sqlite3** | 同步 API、速度快、TS 类型好、零依赖 |
| **加密** | Node 内置 `crypto` | 不用库；AES-256-GCM 直接调 |
| **HTTP 客户端** | **undici** | Node 内置、快、支持 HTTP/2、流式好 |
| **密码哈希** | **argon2** | OWASP 推荐 |
| **session** | Fastify session 插件 | 简单够用 |
| **测试** | **Vitest** | 快、ESM 友好、API 跟 Jest 一样 |
| **Lint/Format** | **ESLint + Prettier** | 标配 |
| **容器** | 多阶段 Dockerfile + docker-compose | 一键起 |
| **监控** | 内置 `/health` + 结构化日志 | MVP 不上 Prometheus |

### 9.1 不用 / 谨慎使用的

- ❌ **Express**：Fastify 更现代、性能更好
- ❌ **TypeORM / Prisma**：better-sqlite3 直 SQL 够用，ORM 反而拖累
- ❌ **Redis**：单用户用不上
- ❌ **MySQL/PG**：SQLite 撑得住
- ❌ **Nginx**：内置静态资源服务够用，需要 HTTPS 时用 Caddy 简单点
- ❌ **Next.js / Nuxt**：太重

---

## §10. 安全

### 10.1 首次启动注册流

> **安装后第一件事**：打开 Web 页面 → 注册第一个管理员账号 → 自动登录 → 进入后台。
> **不要预设 admin/123456 那种弱密码默认值**（参考 v1 教训：很多人忘记改密码 → 被扫）。

**启动逻辑**：

```
1. docker compose up -d
2. 浏览器访问 http://nas-ip:3030
3. 检测到 settings 表里 admin_count = 0
   → 自动重定向到 /setup
   → 显示"创建你的管理员账号"表单
     · 用户名（≥3 字符，唯一）
     · 密码（≥10 字符，必须含字母+数字）
     · 确认密码
4. 提交 → argon2 哈希存 settings.admin_users（JSON 数组）
        → 自动登录该用户 → 跳 /admin/dashboard
5. 之后 settings.admin_count > 0
   → 任何人访问都跳 /admin/login
```

**支持的账号数**：1-N（v2 MVP 支持 1 个，预留扩展到多个管理员）

**为什么不要预设密码**：
- 飞牛 OS 暴露公网，攻击者**第一个试的就是 admin/123456**
- 注册流让用户**自己设一个强密码** + 强密码校验在客户端就拦
- 注册后用户名密码都是用户自己记得的，不会忘

**忘记密码怎么办**（v2.0 MVP 不做，v3.0 再说）：
- 选项 A：控制台打印一次性重置链接（参考 freellmapi）
- 选项 B：保留 KEK 的前提下，删除 users 表让重新注册（清空所有数据）

### 10.2 鉴权层级（最终版）

| 层 | 凭据 | 用途 | 存储 |
|---|---|---|---|
| **管理员账号** | 用户名 + 密码（argon2 哈希） | 管 dashboard | settings.admin_users (JSON) |
| **Hub Key** | `fh_<64hex>` 字符串，**SHA256 哈希入库** | 客户端调 `/v1/...` | hub_keys 表 |
| **Admin Session** | Cookie（HttpOnly + SameSite=Strict） | admin 操作 | 内存 + cookie |

### 10.3 其他安全措施

| 威胁 | 缓解措施 |
|---|---|
| **公网被扫到登录页** | 限速（每 IP 3 分钟最多 5 次登录失败 → 临时封禁 15 分钟） |
| **API Key 明文泄露** | AES-256-GCM 加密 + UI 永不显示明文 |
| **Hub Key 泄露** | 用户可一键撤销 + 单独 usage 跟踪便于发现异常 + **可重新生成** |
| **CSRF** | admin 后台用 SameSite=Strict cookie + 关键操作二次确认 |
| **XSS** | 模板引擎默认 escape；UI 不用 `innerHTML` |
| **SQL 注入** | 全用 prepared statement（better-sqlite3 强制） |
| **资源耗尽** | 请求体大小限制（默认 10MB）、wall-clock budget、并发数限制 |
| **敏感日志** | API Key 永远不写日志；usage 日志只存 hint 不存 key |
| **密码弱** | 注册时强制 ≥10 字符 + 含字母+数字，客户端拦截 |

---

## §11. 部署 / 运维

### 11.1 一键启动（飞牛 OS / Linux NAS / 任何 Docker 环境）

```bash
# 第一次：创建配置目录
mkdir -p ~/freellm-hub && cd ~/freellm-hub
curl -fsSL https://raw.githubusercontent.com/你的用户名/freellm-hub-v2/main/docker-compose.yml -o docker-compose.yml
docker compose up -d
# 浏览器打开 http://nas-ip:3030
# → 自动跳到 /setup → 注册第一个管理员账号 → 进后台
```

**注意**：v2 **不需要预先设管理员密码**。环境变量里**不放任何密码**（包括 ADMIN_PASSWORD），密码完全由注册流产生。
环境变量只放**非敏感配置**（端口、域名等）。

### 11.2 配置文件（`docker-compose.yml`）

```yaml
services:
  hub:
    image: ghcr.io/你的用户名/freellm-hub-v2:latest
    container_name: freellm-hub
    restart: unless-stopped
    ports:
      - "3030:3030"     # 飞牛 OS 暴露这个端口
    volumes:
      - ./data:/app/data       # SQLite + 加密密钥 + 日志（务必备份！）
    environment:
      - HUB_PORT=3030
      - HUB_PUBLIC_URL=        # 可选：你的公网域名，UI 用来生成"复制 Hub URL"按钮
      # 例如: - HUB_PUBLIC_URL=https://hub.your-domain.com
      - TZ=Asia/Shanghai
```

**关键**：
- 没有任何密码环境变量
- `./data` 目录必须备份（加密密钥 + SQLite + 上游 API Key 都在里面）
- 飞牛 OS 套 HTTPS 之后，外面用 `https://hub.your-domain.com` 访问

### 11.3 飞牛 OS HTTPS 配置（外部处理，不在 Hub 范围）

用户在飞牛 OS 控制台操作：
1. 控制台 → 系统设置 → 安全 → 证书
2. 申请 Let's Encrypt 证书（或导入自签 / Cloudflare Origin）
3. 反向代理：把 `hub.your-domain.com:443` 转到 `127.0.0.1:3030`

Hub 这边**什么都不用做**，只听 3030 端口 HTTP 即可。

**为什么 Hub 不内置 HTTPS**：
- 飞牛 OS 已经提供了证书管理界面
- 重复造轮子会增加维护负担
- 把 HTTPS 交给 OS 层面，Hub 只管业务

### 11.4 备份

- **`./data/hub.db`** — 单文件，**最重要**（含所有上游 Key 加密数据 + Hub Key 哈希 + 用量日志）
- **`./data/master.key`** — 主加密密钥（如果丢了这个，**所有上游 Key 都解不开**，必须重新输入！）
- 建议：飞牛 OS 自带的"同步到云端"任务，每天备份 `./data` 整个目录
- 提供 admin UI 上的"下载加密备份"按钮（下载的是 zip 含 db + master.key，加密保护）

### 11.5 升级

```bash
cd ~/freellm-hub
docker compose pull
docker compose up -d
# DB migration 启动时自动跑
```

---



## §12. 开发路线图（MVP → v1.0）

### Phase 0: 脚手架（1 周）
- [x] 设计文档
- [ ] 项目初始化（TS + Fastify + better-sqlite3 + Docker）
- [ ] DB migration 系统
- [ ] 加密模块（AES-256-GCM + 主密钥管理）
- [ ] **【核心】首次启动注册流**：检测无 admin → 跳 /setup → 注册 + 自动登录
- [ ] admin 登录 + session（argon2 哈希）

### Phase 1: MVP — 单 Channel 单 Key + 多 Hub Key（2 周）
- [ ] Provider / Channel / Key 三个表的 CRUD
- [ ] admin 渠道列表页（**§1.3.1 那个核心页面**）
- [ ] 探测 `/v1/models` 写 `discovered_models`
- [ ] OpenAI 兼容 `/v1/chat/completions`（单 Key 透传）
- [ ] `/v1/models` 返回探测到的所有模型
- [ ] **【核心】多 Hub Key 完整实现**（§1.3.5）：
  - 创建 / 命名 / 列表 / 禁用 / 启用 / **🔄 重生成** / 🗑 删除
  - 一次性明文展示 + 二维码
  - usage 关联到 hub_key_id
  - 友好错误消息
- [ ] 基础 usage 写日志

**🎯 验收**：用户能注册账号 → 加一个 Key → 创建多个 Hub Key（每个设备一个）→ 用 OpenAI SDK 调通 `chat/completions` → 泄漏一个 Key 一键重生成不影响其他。

### Phase 2: 路由 + Failover（2 周）
- [x] **§4 路由算法完整实现**（resolver + keyPool + candidate + failover）
- [x] Key 健康状态机（§2.3）
- [x] 后台定时探测任务
- [ ] VirtualModel + Candidate 实体 + admin 页
- [ ] "拖拽排序"实现（HTMX + 服务端持久化）
- [ ] 模型重定向
- [ ] **【核心】测速模块**：单 Key 测速 + 候选测速（§1.3.1.1）
  - 测速 API: `POST /api/admin/keys/:id/benchmark` / `POST /api/admin/candidates/:id/benchmark`
  - 测速结果入库（`usage_logs.benchmark = 1`）+ 更新 `keys.avg_latency_ms` / `model_candidates.avg_latency_ms`
  - 测速弹窗 UI（§1.3.3.1）
- [ ] **【核心】调用结果可见性**：每 Key / 每候选的"最后调用"和"30天统计"
  - 数据来源：`usage_logs` + `usage_daily` 聚合
  - UI 已在 §1.3.1 / §1.3.3 体现

**🎯 Phase 2 验收（路由 + Failover 部分）**：minimax 有 2 个 Key，minimax 配额耗尽后自动切到 openrouter。✅ **E2E 已验证**（test/e2e/integration.test.ts）：mock upstream 第一次 401 → 自动切到 A2 → 200 + "ok from key 2"；usage_logs 记录 A1 error 401 + A2 success；cooldowns 写 A1 5min heuristic。

**Phase 2 路由算法实现细节**：参见 `docs/PHASE2_DESIGN.md`（cooldown 4 source / escalation ladder / local endpoint 例外 / 三层 skip / 错误码分类）。

### Phase 3: 多协议（2 周）
- [x] **Anthropic `/v1/messages` 兼容** (Phase 3.A)
  - 入站: Anthropic request (含 system / content blocks) → OpenAI request
  - 出站: OpenAI response → Anthropic response (含 stop_reason 映射 / usage 转换)
  - 流式: OpenAI SSE → Anthropic SSE 事件流 (message_start / content_block_start / content_block_delta / content_block_stop / message_delta / message_stop)
  - 错误: 401/403/404/429/529 等 → Anthropic error type
  - 鉴权: 同时支持 `x-api-key` (Claude Code 默认) 和 `Authorization: Bearer`
- [x] **Anthropic tool_use 完整双向** (Phase 3.A.2)
  - tools 数组 + tool_choice 入站转 OpenAI tools/function
  - assistant tool_use content blocks → OpenAI tool_calls (含 id 保真, arguments JSON 字符串)
  - user tool_result content blocks → OpenAI role:tool 消息
  - 非流式响应: tool_calls → Anthropic tool_use blocks
  - 流式响应: tool_calls delta 状态机 → Anthropic content_block_start (tool_use) + 多个 input_json_delta + content_block_stop
  - 多轮: 完整支持 user → assistant(tool_use) → user(tool_result) → assistant(final) 透传到 OpenAI
- [ ] OpenAI Responses 兼容
- [ ] Ollama 兼容
- [ ] 多 Provider 协议支持

**🎯 Phase 3.A 验收（Anthropic 部分）**：
- Claude Code 配置 `ANTHROPIC_BASE_URL=http://hub:3030` + `ANTHROPIC_API_KEY=<hub key>` 能用
- ✅ E2E 已验证（test/e2e/anthropic.test.ts + test/e2e/anthropicTools.test.ts）：
  - 401 failover + Anthropic 响应格式
  - 8 个 SSE 事件 (text 流式)
  - 10+ 个 SSE 事件 (tool_use 流式, 含 input_json_delta 拼装成完整 JSON)
  - 多轮 tool_use → tool_result → final answer 透传

### Phase 4: 使用面（1 周）
- [ ] `/playground` 页面（聊天 + 模型选择 + 实时状态）
- [ ] 客户端 SSE 流式渲染

**🎯 验收**：浏览器里能选模型、聊天、看 Footer 路由信息。

### Phase 5: 用量 + 收尾（1 周）
- [ ] 实时面板 + 历史聚合
- [ ] 审计日志
- [ ] 导入/导出完整实现
- [ ] 文档（README + 中文用户指南）
- [ ] Docker Hub / GHCR 发布
- [ ] 第一次 GitHub Release

**🎯 验收**：能发布 v0.1.0 到 GitHub。

### 总计：~9 周

> 这是一个**单人工作量**估算，按每周 10-15 小时有效开发算。

---

## §13. 风险点 & 取舍

| 风险 | 严重度 | 缓解 |
|---|---|---|
| **Key 轮询/降级逻辑 Bug** | 🔴 高 | 大量单元测试覆盖 §4 各种边界（空池、单 Key 全死、配额耗尽、4xx 不重试） |
| **流式响应中途切换** | 🟡 中 | 文档明示"已开始流的请求不切换"；UI 上显示"流式模式已锁定" |
| **AES 密钥丢失 = Key 全丢** | 🟡 中 | 文档强调 `HUB_MASTER_KEY` 必须备份；提供 KEK 重置流程（需要重新输入所有明文 Key） |
| **Provider 接口经常变** | 🟡 中 | Adapter 隔离，单独文件；`providers.protocol` 字段灵活切换 |
| **SSE 转发性能** | 🟡 中 | 用 undici 流式，零拷贝；Fastify 默认是异步非阻塞 |
| **免费 Key 经常挂** | 🟢 低 | 状态机 + 冷却 + 定时探测是核心 |
| **跨设备 Hub Key 同步** | 🟢 低 | 不用同步，每个设备自己建；用户复制一次即可 |
| **UI 越改越乱（v1 教训）** | 🟡 中 | 严格按 §1 信息架构；**任何新增页面都要先更新文档** |

### 取舍

- **不做多租户**：你一个人用，加多租户会复杂化数据模型、鉴权、UI 80%
- **不做支付/分销**：同上
- **不做模型训练/微调 UI**：不是这个工具的目标
- **不做移动端 App**：playground 响应式就够；要 App 后续单独做
- **不做插件系统**：v1 引入插件只会让核心代码变烂

---

## §14. 借鉴来源 & 致谢

| 来源 | 取了什么 | 文件/章节 |
|---|---|---|
| [songquanpeng/one-api](https://github.com/songquanpeng/one-api) | 渠道/Key 数据模型、负载均衡、Anthropic/多协议支持思路、**单 Key 测速按钮** | §2, §6, §1.3.1 |
| [tashfeenahmed/freellmapi](https://github.com/tashfeenahmed/freellmapi) | Provider 聚合心智、JSON 导入格式、动态路由、加密 SQLite、Thompson sampling 思路、**Provider 申请引导卡片网格** | §1.3.1.1, §3, §4 |
| 当前 freellm-hub (v1) | UI 暗色风格、AES-256-GCM 加密策略、v0.1.0 起步 | §7 |
| [LiteLLM](https://github.com/BerriAI/litellm) | 协议适配层抽象的灵感 | §6 |
| **用户反馈（v2 设计阶段）** | **必须同时具备：① freellmapi 的"申请引导" + ② new-api 的"单 Key 测速" + ③ 调用结果可见性** | §1.3.1, §1.3.3 |

---

## 附录 A：开放问题（开发时决策）

开发过程中会持续冒出来，先记下来：

1. **quota 查询**：哪些上游 Provider 提供 `/v1/usage`？需要逐家研究
2. **Anthropic 消息 → OpenAI 消息的 tool_use 转换**：细节很多，开发时再处理
3. **Ollama adapter**：要不要兼容 Ollama 自己的 `/api/chat` JSON 格式？还是只兼容 OpenAI 协议？
4. **HTMX 调试**：用 htmx 写拖拽排序略麻烦，备选是 Alpine.js 接管
5. **国际化**：UI 先做中文，要不要英文？v1.0 出后再议
6. **测速的 prompt 默认值**：内置什么 prompt？建议：`"用一句话介绍你自己"` + 测流式（拿 TTFT） + 测非流式（拿总耗时）
7. **测速频率**：除了用户手动测，要不要后台定时测？建议 v1 不上，v2 加（每小时一次）
8. **测速算不算 quota**：测速是真实请求，要消耗上游额度。v1 上限频：每个 Key 每 10 分钟最多 5 次测速

---

## 附录 B：已确认的设计决策

| 决策 | 结论 | 来源 |
|---|---|---|
| 借鉴 freellmapi 的 Provider 申请引导卡片网格 | ✅ 保留并加强（§1.3.1.1） | 用户反馈 |
| new-api 风格的单 Key 测速 | ✅ 必须有（§1.3.3.1） | 用户反馈 |
| 调用结果可见性（最后调用 + 30天统计） | ✅ 必须有（§1.3.1, §1.3.3） | 用户反馈 |
| 自动获取 Key（OAuth） | ❌ 不做，让用户复制粘贴 | 设计判断 |
| 框架、语言、数据库 | Node.js + TS + Fastify + SQLite | 默认 |
| UI 形态 | 服务端渲染 + HTMX | 默认 |
| **首次启动注册流**（不预设 admin 密码） | ✅ 必须有（§10.1） | Q5 |
| **多 Hub Key + 命名 + 撤销 + 重生成** | ✅ 完整实现（§1.3.5） | Q4 |
| **Hub 是设备无关的统一 API Key 仓库** | ✅ 设备只存 Hub Key，上游 Key 都在 Hub 加密 | Q4 |
| **部署在飞牛 OS Docker + 外部 HTTPS** | ✅ Hub 不内置 HTTPS，听 3030 HTTP 即可（§11） | Q1 |
| **v1 数据迁移** | ❌ 不做（推倒重来） | Q1 |

---

**文档结束。** 下一步：等用户确认方向后，按 §12 路线图开干 Phase 0。
