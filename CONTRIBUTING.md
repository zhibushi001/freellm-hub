# Contributing to FreeLLM Hub

欢迎贡献！无论是 bug 报告、新功能、文档改进还是 PR，都欢迎。

## 快速开始

```bash
# 1. Fork & clone
git clone https://github.com/<your-username>/freellm-hub-v2.git
cd freellm-hub-v2

# 2. 装依赖 (前后端)
npm install
cd freellm-hub-client && npm install && cd ..

# 3. 启动后端 dev server
npm run dev
# → http://localhost:3030

# 4. 启动前端 dev server (另一个终端)
cd freellm-hub-client
npm run dev
# → http://localhost:5173 (vite dev server)
```

## 项目结构

```
freellm-hub-v2/
├── src/                    # 后端 (Fastify + TypeScript)
│   ├── auth/              # 鉴权 (admin / hub key)
│   ├── config/            # 环境变量
│   ├── crypto/            # AES 加密、KEK
│   ├── db/                # SQLite schema + repos
│   ├── http/              # API 路由 (admin + client)
│   │   ├── admin/        # 管理 API (需 session)
│   │   └── client/       # /v1/* 客户端 API
│   ├── providers/         # 上游 Provider 适配器
│   ├── routing/           # 路由算法 (failover)
│   ├── services/          # 业务服务
│   └── util/              # 工具
├── freellm-hub-client/    # 前端 (React + Vite)
│   └── src/
│       ├── api.ts         # 后端 API 客户端
│       ├── components/    # Layout 等
│       └── pages/         # 14 个页面
├── test/                   # 测试
│   ├── unit/              # 单元测试
│   └── e2e/               # 端到端测试
├── scripts/                # 构建脚本
├── docs/                   # 设计文档
├── Dockerfile              # 镜像构建
├── docker-compose.yml      # 部署模板
└── CHANGELOG.md            # 变更记录
```

## 开发约定

### TypeScript

- 后端 + 前端都用 TypeScript 严格模式
- 不要使用 `any` —— 用 `unknown` + 类型守卫
- 公开 API 用 `interface`，内部用 `type`

### 提交规范

使用 [Conventional Commits](https://www.conventionalcommits.org/)：

```
feat: 新增内容
fix: 修 bug
docs: 只改文档
refactor: 重构（既不修 bug 也不加功能）
perf: 性能优化
test: 加测试
chore: 杂项（依赖、配置等）
```

示例：
```
feat: add OpenAI Responses API streaming
fix: prevent hub key from being created with empty name
docs: update INSTALL.md with Docker compose example
```

### 分支策略

- `main` — 稳定分支，与最新 release 同步
- `develop` — 开发分支，所有 PR 提到这里
- `feature/xxx` — 功能分支
- `fix/xxx` — bug 修复分支

### 提 PR 流程

1. Fork 仓库
2. 在 `develop` 上创建分支 `feature/your-feature`
3. 提交代码（按 Conventional Commits）
4. 跑测试：`npm test`
5. 确保本地 build 通过：`npm run build`
6. 提 PR 到 `develop`，写清楚：
   - 这个 PR 解决什么问题
   - 怎么测试
   - 截图（如涉及 UI）

## 添加新的 Provider

Provider 适配器是这套系统最常被扩展的部分。流程：

### 1. 在 `src/providers/` 新建文件

参考现有的 `openai.ts`、`anthropic.ts`、`minimax.ts` 模板。

```ts
// src/providers/my-provider.ts
import { ProviderAdapter } from './types.js';

export const myProvider: ProviderAdapter = {
  name: 'my-provider',

  supportsModel(model: string): boolean {
    return model.startsWith('my-') || model.includes('mymodel');
  },

  // 构造上游 HTTP 请求
  buildRequest(req, apiKey, baseUrl) {
    return {
      url: `${baseUrl}/v1/chat/completions`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ /* OpenAI 兼容格式 */ }),
    };
  },

  // 解析响应（统一成 OpenAI 格式）
  parseResponse(res) {
    return {
      choices: [...],
      usage: {...},
    };
  },
};
```

### 2. 在 `src/providers/index.ts` 注册

```ts
import { myProvider } from './my-provider.js';
export const providers = [..., myProvider];
```

### 3. 在前端 `freellm-hub-client/src/api.ts` 的 Provider 列表加上

```ts
{ id: 'my-provider', name: 'My Provider', base_url: '...', protocol: 'openai', ... }
```

### 4. 加测试

```ts
// test/unit/my-provider.test.ts
import { test } from 'node:test';
import assert from 'node:assert';
import { myProvider } from '../../src/providers/my-provider.js';

test('supportsModel', () => {
  assert.ok(myProvider.supportsModel('my-cool-model'));
  assert.ok(!myProvider.supportsModel('gpt-4'));
});
```

## 添加新的 Client API

参照 `src/http/client/` 下的现有路由：

1. 新建 `src/http/client/my-api.ts`
2. 在 `src/app.ts` 注册
3. 加测试

## 报告 Bug

提 issue 时请包含：

- FreeLLM Hub 版本（`docker inspect freellm-hub --format='{{.Image}}'`）
- Node 版本（`node -v`）
- Docker 版本（`docker -v`）
- 复现步骤
- 预期 vs 实际
- 相关日志（`docker logs freellm-hub --tail 200`）

## 提功能请求

先开 issue 讨论，避免直接 PR 大改动。可以的描述：

- 解决了什么问题
- 目标用户
- 备选方案
- 愿意自己实现吗

## 联系方式

- GitHub Issues: 主要沟通渠道
- 紧急安全漏洞：见 [SECURITY.md](./SECURITY.md)

## 许可证

贡献的代码同样按 MIT 许可证发布。
