# Security Policy

## 支持版本

| 版本 | 支持状态 |
|---|---|
| v2.0.x | ✅ 积极维护 |
| v1.x | ❌ 不再维护 |

## 报告漏洞

**请勿** 在公开 GitHub issue 中报告安全漏洞。

发送邮件到：`security@freellm-hub.example.com`（占位，请替换成你的实际邮箱）

请包含：

- 漏洞描述
- 复现步骤
- 影响范围
- 建议的修复方案（如果有）

我们会在 48 小时内确认收到，并在 7 天内给出处理计划。

## 安全特性

FreeLLM Hub v2 内置以下安全措施：

### 数据加密
- **API Key 加密存储**: 所有上游 Provider API Key 使用 AES-256-GCM 加密，密钥通过 PBKDF2 派生自 `master.key` 文件
- **管理员密码**: bcrypt 哈希，salt rounds = 12
- **Hub Key 存储**: SHA-256 哈希，不存明文
- **Session Secret**: 64 字节随机密钥，签名防篡改

### 访问控制
- **Admin 鉴权**: 基于 cookie session + CSRF 防护
- **Hub Key 鉴权**: 基于 `Authorization: Bearer fh_...` header
- **登录限流**: 5 次 / 3 分钟（可配置）
- **Per-Key 模型白名单**: Hub Key 和 Channel Key 都可限定可调用的模型
- **权限拒绝在配额检查之前**: 拒绝的请求不消耗上游 quota

### 传输安全
- **TLS 推荐**: 反向代理层强制 HTTPS（生产环境必做）
- **Cookie secure flag**: 部署在 HTTPS 后面时应设为 `true`
- **CORS**: `/v1/*` 允许跨域 + 凭证；admin API 同源访问

### 内容安全
- **护栏系统**: 输入/输出过滤、关键词拦截、PII 检测、长度限制
- **日志脱敏**: API Key 在日志中显示为前缀 + `•••••`

## 推荐部署实践

1. **不要把 3303 端口直接暴露到公网** —— 必须通过反向代理 + HTTPS
2. **定期更换 admin 密码**
3. **定期审查 Hub Key** —— 删除不再使用的，启用 allowed_models 限制
4. **启用内容护栏** —— 至少开启 PII 检测
5. **定期审查使用日志** —— 检测异常调用模式
6. **异地备份 `data/` 目录** —— 包含 `master.key`，请加密后传输
7. **限制 Docker 网络访问** —— 用 iptables / ufw 限制 3303 端口只对内网开放

## 已知限制

- **本地流量不加密**: 默认配置假设部署在反代后面。反代负责 TLS。
- **`master.key` 不可恢复**: 丢失后所有上游 API Key 都不可解密，必须重新输入。
- **Session secret 不可恢复**: 丢失后所有 admin 会被强制退出。

## 披露时间线

1. 收到漏洞报告（48 小时内确认）
2. 评估严重性 + 制定修复计划（7 天内）
3. 修复 + 测试（视严重性 1-30 天）
4. 发布补丁版本
5. 在 CHANGELOG 中致谢（如果报告者愿意）

## 历史漏洞

目前无已公开披露的安全漏洞。
