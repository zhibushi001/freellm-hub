/**
 * Fastify 应用实例
 */
import Fastify, { FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import session from '@fastify/session';
import formbody from '@fastify/formbody';
import fastifyStatic from '@fastify/static';
import cors from '@fastify/cors';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { renderPage } from './http/admin/layout.js';

import { config } from './config/env.js';
import { hasAnyAdmin, authenticate, createFirstAdmin } from './auth/adminAuth.js';
import { SqliteSessionStore } from './auth/sessionStore.js';
import { registerChannelAdminRoutes } from './http/admin/channels.js';
import { registerModelRouteAdminRoutes } from './http/admin/routes.js';
import { registerHubKeyAdminRoutes } from './http/admin/hubKeys.js';
import { registerCacheAdminRoutes } from './http/admin/cache.js';
import { registerGuardrailsAdminRoutes } from './http/admin/guardrails.js';
import { registerFallbackAdminRoutes } from './http/admin/fallback.js';
import { registerRequestTrackingAdminRoutes } from './http/admin/requestTracking.js';
import { registerUsageAdminRoutes } from './http/admin/usage.js';
import { registerTagsAdminRoutes } from './http/admin/tags.js';
import { registerChatAdminRoutes } from './http/admin/chat.js';
import { registerApiTestAdminRoutes } from './http/admin/apiTest.js';
import { registerVirtualModelAdminRoutes } from './http/admin/virtualModels.js';
import { registerModelMappingAdminRoutes } from './http/admin/modelMappings.js';
import { registerClientRoutes } from './http/client/chat.js';
import { registerAnthropicClientRoutes } from './http/client/anthropic.js';
import { registerEmbeddingsRoutes } from './http/client/embeddings.js';
import { registerImageRoutes } from './http/client/images.js';
import { registerAudioRoutes } from './http/client/audio.js';
import { registerVideoRoutes } from './http/client/video.js';
import { responsesRoutes } from './http/client/responses.js';
import { probeAllKeys, probeKey } from './services/probeService.js';
import { benchmarkKey, benchmarkAll } from './services/benchmark.js';
import { registerReactApp } from './react-app.js';
import { registerReactCompatRoutes } from './react-compat.js';


import { inflightGetAll } from './services/inflightTracker.js';
import { listProvidersForAdmin } from './db/repos/providers.js';
import { getDiscoveredModelsForKey } from './db/repos/discoveredModels.js';
import { getKey, listKeys, listKeysByChannel } from './db/repos/keys.js';
import { listChannels } from './db/repos/channels.js';
import { listHubKeys } from './db/repos/hubKeys.js';
import { getDb } from './db/connection.js';
import { getAllSettings, setSetting } from './db/repos/settings.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

declare module 'fastify' {
  interface Session {
    adminId?: number;
    adminUsername?: string;
  }
}

// Session 密钥持久化
function getOrCreateSessionSecret(): string {
  const file = config.sessionSecretPath;
  if (existsSync(file)) {
    return readFileSync(file, 'utf8');
  }
  const secret = randomBytes(32).toString('hex');
  writeFileSync(file, secret, { mode: 0o600 });
  return secret;
}

export async function buildApp(): Promise<FastifyInstance> {
  // 算 dist mtime 作为 build hash (用于 cache-busting CSS/JS)
  try {
    const { statSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const __filename = fileURLToPath(import.meta.url);
    const st = statSync(__filename);
    (globalThis as any).__BUILD_HASH__ = Math.floor(st.mtimeMs).toString(36);
  } catch {
    (globalThis as any).__BUILD_HASH__ = Date.now().toString(36);
  }
  const app: FastifyInstance = Fastify({
    logger: {
      level: config.log.level,
      transport:
        config.env === 'development'
          ? {
              target: 'pino-pretty',
              options: { colorize: true, translateTime: 'SYS:HH:MM:ss.l' },
            }
          : undefined,
    },
    trustProxy: true,
    bodyLimit: 10 * 1024 * 1024, // 10MB
  });

  await app.register(cookie);
  await app.register(session, {
    secret: getOrCreateSessionSecret(),
    cookieName: 'hub_session',
    store: new SqliteSessionStore(),
    cookie: {
      secure: false, // 飞牛 OS 套 HTTPS, 这里监听 HTTP
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    },
    saveUninitialized: false,
  });

  await app.register(formbody);

  // CORS: 客户端 API (/v1/*) 允许跨域, 方便 SDK / 浏览器直连
  await app.register(cors, {
    origin: true, // 反射请求的 Origin (比 * 更友好, 支持带凭证)
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'x-api-key', 'anthropic-version', 'anthropic-beta'],
  });

  // 静态资源
  const publicDir = join(__dirname, 'public');
  await app.register(fastifyStatic, {
    root: publicDir,
    prefix: '/static/',
  });

  // 全局 preHandler: 检查 setup 状态
  app.addHook('preHandler', async (req, reply) => {
    const url = req.url;
    // 跳过静态资源、健康检查、setup 路径
    if (
      url.startsWith('/static/') ||
      url === '/health' ||
      url.startsWith('/setup') ||
      url.startsWith('/api/setup') ||
      url.startsWith('/api/admin/auth/') ||
      url === '/favicon.ico'
    ) {
      return;
    }

    // 还没注册管理员 → 全部跳到 /setup
    if (!hasAnyAdmin()) {
      if (url.startsWith('/api/')) {
        return reply.code(503).send({ error: 'setup_required', message: '请先在 /setup 注册管理员' });
      }
      return reply.redirect('/setup');
    }

    // React SPA handles admin routing - don't redirect
    // Only redirect legacy HTML admin pages
    const isReactRoute = url.startsWith('/admin/') && !url.endsWith('.html');
    if (!isReactRoute && url.startsWith('/admin') && !req.session.adminId) {
      return reply.redirect('/login');
    }
  });

  // 健康检查
  app.get('/health', async () => ({
    status: 'ok',
    service: 'freellm-hub',
    version: '0.1.0',
    db: 'sqlite',
    timestamp: new Date().toISOString(),
  }));

  // API 文档
  app.get('/api-docs', async () => {
    return {
      service: 'FreeLLM Hub',
      version: '0.1.0',
      base_url: '/v1',
      endpoints: [
        {
          method: 'GET',
          path: '/v1/models',
          description: '获取可用模型列表',
          auth: 'Hub Key',
        },
        {
          method: 'POST',
          path: '/v1/chat/completions',
          description: 'OpenAI 兼容聊天接口',
          auth: 'Hub Key',
          body: {
            model: 'string (必填)',
            messages: 'array (必填)',
            max_tokens: 'number (可选)',
            temperature: 'number (可选)',
            stream: 'boolean (可选)',
          },
        },
        {
          method: 'POST',
          path: '/v1/responses',
          description: 'OpenAI Responses API',
          auth: 'Hub Key',
        },
        {
          method: 'POST',
          path: '/v1/messages',
          description: 'Anthropic Messages API',
          auth: 'Hub Key',
        },
        {
          method: 'POST',
          path: '/v1/embeddings',
          description: '嵌入模型 API (OpenAI 兼容)',
          auth: 'Hub Key',
          body: {
            model: 'string (必填)',
            input: 'string | array (必填)',
            encoding_format: 'string (可选)',
            dimensions: 'number (可选)',
          },
        },
        {
          method: 'POST',
          path: '/v1/images/generations',
          description: '图片生成 API (文生图)',
          auth: 'Hub Key',
          body: {
            model: 'string (必填, 如 agnes-image-2.5-flash)',
            prompt: 'string (必填)',
            n: 'number (可选, 数量)',
            size: 'string (可选, 如 1024x1024)',
            style: 'string (可选)',
          },
        },
        {
          method: 'POST',
          path: '/v1/images/edits',
          description: '图片编辑 API (图生图)',
          auth: 'Hub Key',
          body: {
            model: 'string (必填)',
            image: 'string (必填, base64 或 URL)',
            mask: 'string (可选)',
            prompt: 'string (可选)',
          },
        },
        {
          method: 'GET',
          path: '/v1/images/models',
          description: '获取支持的图片生成模型',
          auth: 'Hub Key',
        },
        {
          method: 'POST',
          path: '/v1/videos/generations',
          description: '视频生成 API (文生视频)',
          auth: 'Hub Key',
          body: {
            model: 'string (必填, 如 agnes-video-2.5 或 MiniMax-M3)',
            prompt: 'string (必填)',
            duration: 'number (可选, 秒)',
            resolution: 'string (可选, 如 720p)',
            aspect_ratio: 'string (可选, 如 16:9)',
            seed: 'number (可选)',
          },
        },
        {
          method: 'POST',
          path: '/v1/videos/edits',
          description: '视频编辑 API (图生视频)',
          auth: 'Hub Key',
          body: {
            model: 'string (必填)',
            video: 'string (可选)',
            prompt: 'string (必填)',
          },
        },
        {
          method: 'GET',
          path: '/v1/videos/models',
          description: '获取支持的视频生成模型',
          auth: 'Hub Key',
        },
        {
          method: 'GET',
          path: '/v1/health',
          description: '健康检查',
          auth: '无',
        },
      ],
      admin_api: {
        description: '管理 API（需要 Admin 登录）',
        endpoints: [
          '/api/admin/dashboard',
          '/api/admin/channels',
          '/api/admin/channels/:id/test',
          '/api/admin/channels/:id/probe',
          '/api/admin/model-routes',
          '/api/admin/hub-keys',
          '/api/admin/cache/stats',
          '/api/admin/cache/cleanup',
          '/api/admin/cache/enable',
          '/api/admin/guardrails',
          '/api/admin/fallback',
          '/api/admin/requests/stats',
          '/api/admin/requests',
          '/api/admin/auth/login',
        ],
      },
      features: {
        cache: '响应缓存（可配置 TTL）',
        guardrails: '内容护栏（输入/输出过滤）',
        fallback: '模型回退配置',
        embeddings: '嵌入模型支持',
        request_tracking: '请求追踪（含重试记录）',
        playground: '在线测试场',
      },
      usage: {
        description: '使用示例',
        curl: `curl -X POST http://localhost:3303/v1/chat/completions \\
  -H "Authorization: Bearer your-hub-key" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"sensenova-6.8-flash-lite","messages":[{"role":"user","content":"你好"}]}'`,
      },
    };
  });

  // 根路径：暂跳到 setup 或 /admin/dashboard
  app.get('/', async (req, reply) => {
    if (!hasAnyAdmin()) return reply.redirect('/setup');
    if (req.session.adminId) return reply.redirect('/admin/dashboard');
    return reply.redirect('/login');
  });

  // 注册 / 登录路由
  await registerAuthRoutes(app);
  await registerChannelAdminRoutes(app);
  await registerModelRouteAdminRoutes(app);
  await registerHubKeyAdminRoutes(app);
  await registerCacheAdminRoutes(app);
  await registerGuardrailsAdminRoutes(app);
  await registerFallbackAdminRoutes(app);
  await registerRequestTrackingAdminRoutes(app);
  await registerUsageAdminRoutes(app);
  await registerTagsAdminRoutes(app);
  await registerChatAdminRoutes(app);
  await registerApiTestAdminRoutes(app);
  await registerVirtualModelAdminRoutes(app);
  await registerModelMappingAdminRoutes(app);
  await registerAdminApiRoutes(app);  // Phase 4.A: JSON API for Admin UI
  await registerClientRoutes(app);
  await registerAnthropicClientRoutes(app);
  await registerEmbeddingsRoutes(app);
  await registerAudioRoutes(app);
  await registerVideoRoutes(app);  // 图片 + 视频生成 (统一路由)
  registerReactApp(app);
  registerReactCompatRoutes(app);  // Phase 3.A: Anthropic /v1/messages
  await responsesRoutes(app);  // Phase 3.B: OpenAI Responses /v1/responses

  // 探测 API (admin 触发)
  app.post('/api/admin/probe/:keyId', async (req, reply) => {
    const keyId = parseInt((req.params as any).keyId, 10);
    const key = getKey(keyId);
    if (!key) return reply.code(404).send({ ok: false, error: 'Key not found' });
    const result = await probeKey(keyId);
    return reply.send({ ...result });
  });
  app.post('/api/admin/probe-all', async (req, reply) => {
    const results = await probeAllKeys();
    return reply.send({ ok: true, results });
  });

  // ═══ 数据库备份管理 ═══
  app.get('/api/admin/backup', async (req, reply) => {
    if (!(req.session as any).adminId) return reply.code(401).send({ ok: false, error: 'unauthorized' });
    const { listBackups } = await import('./services/backupService.js');
    const backups = listBackups();
    return reply.send({ ok: true, backups, max_backups: parseInt(process.env.HUB_MAX_BACKUPS || '7') });
  });

  app.post('/api/admin/backup', async (req, reply) => {
    if (!(req.session as any).adminId) return reply.code(401).send({ ok: false, error: 'unauthorized' });
    const { backupDatabase, pruneBackups } = await import('./services/backupService.js');
    const { basename } = await import('node:path');
    try {
      const path = backupDatabase();
      const pruned = pruneBackups();
      return reply.send({ ok: true, path: basename(path), pruned });
    } catch (e: any) {
      return reply.code(500).send({ ok: false, error: e.message });
    }
  });

  // ═══ 全局错误处理 ═══
  // setNotFoundHandler: fastify 默认行为是返回通用 JSON, 已有默认 handler;
  // 实际框架已注册 not-found 处理, 这里仅统一 error handler.
  // (跳过 setNotFoundHandler 避免 "already set" 错误)

  app.setErrorHandler(async (err: any, req, reply) => {
    const status = err.statusCode || 500;
    if (status >= 500) {
      app.log.error({ err, url: req.url, method: req.method }, 'Unhandled server error');
    }
    return reply.code(status).send({
      error: status >= 500 ? 'server_error' : (err.code || 'error'),
      message: status >= 500 ? '内部错误，请稍后重试' : err.message,
    });
  });

  return app;
}

// ============================================
// 认证路由 (注册 + 登录 + 登出)
// ============================================
async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  // GET /setup - 注册页
  app.get('/setup', async (req, reply) => {
    if (hasAnyAdmin()) {
      return reply.redirect('/login');
    }
    return reply.type('text/html; charset=utf-8').header('cache-control', 'no-cache, no-store, must-revalidate').send(renderSetupPage());
  });

  // POST /api/setup - 创建管理员
  app.post('/api/setup', async (req, reply) => {
    if (hasAnyAdmin()) {
      return reply.code(409).send({ ok: false, error: '已存在管理员' });
    }
    const body = req.body as { username?: string; password?: string; password2?: string };
    const username = (body.username ?? '').trim();
    const password = body.password ?? '';
    const password2 = body.password2 ?? '';

    if (!username || !password) {
      return reply.code(400).send({ ok: false, error: '用户名和密码必填' });
    }
    if (password !== password2) {
      return reply.code(400).send({ ok: false, error: '两次密码不一致' });
    }
    try {
      const user = await createFirstAdmin({ username, password });
      req.session.adminId = user.id;
      req.session.adminUsername = user.username;
      return reply.send({ ok: true, redirect: '/admin/dashboard' });
    } catch (e: any) {
      return reply.code(400).send({ ok: false, error: e.message });
    }
  });

  // POST /api/admin/auth/login (限速)
  app.post(
    '/api/admin/auth/login',
    {
      config: {
        rateLimit: {
          max: config.rateLimit.loginMax,
          timeWindow: config.rateLimit.windowMs,
        },
      },
    },
    async (req, reply) => {
      const body = req.body as { username?: string; password?: string };
      const username = (body.username ?? '').trim();
      const password = body.password ?? '';
      if (!username || !password) {
        return reply.code(400).send({ ok: false, error: '请输入用户名和密码' });
      }
      const user = await authenticate(username, password);
      if (!user) {
        return reply.code(401).send({ ok: false, error: '用户名或密码错误' });
      }
      req.session.adminId = user.id;
      req.session.adminUsername = user.username;
      return reply.send({ ok: true, redirect: '/admin/dashboard' });
    },
  );

  // POST /api/admin/auth/logout
  app.post('/api/admin/auth/logout', async (req, reply) => {
    await new Promise<void>((resolve) => req.session.destroy(() => resolve()));
    return reply.send({ ok: true });
  });

  // Phase 5: Admin 改自己的密码 / 用户名
  app.post('/api/admin/auth/profile', async (req, reply) => {
    const adminId = (req.session as any).adminId;
    const adminUsername = (req.session as any).adminUsername;
    if (!adminId) return reply.code(401).send({ ok: false, error: '未登录' });
    const body = (req.body ?? {}) as { old_password?: string; new_password?: string; new_username?: string };
    try {
      const { changePassword, updateUsername } = await import('./auth/adminAuth.js');
      if (body.new_password) {
        if (!body.old_password) return reply.code(400).send({ ok: false, error: '改密码必须提供旧密码' });
        await changePassword({
          userId: adminId,
          oldPassword: body.old_password,
          newPassword: body.new_password,
        });
      }
      if (body.new_username && body.new_username !== adminUsername) {
        const updated = updateUsername({ userId: adminId, newUsername: body.new_username });
        (req.session as any).adminUsername = updated.username;
      }
      return reply.send({ ok: true, username: (req.session as any).adminUsername });
    } catch (e: any) {
      return reply.code(400).send({ ok: false, error: e.message });
    }
  });

  // GET /api/admin/auth/me (查当前用户)
  app.get('/api/admin/auth/me', async (req, reply) => {
    const adminId = (req.session as any).adminId;
    const adminUsername = (req.session as any).adminUsername;
    if (!adminId) return reply.code(401).send({ ok: false, error: '未登录' });
    return reply.send({ ok: true, username: adminUsername });
  });

  // Phase 5: Profile page (改密码 / 用户名) - React SPA 处理
}

// ============================================
// Phase 4.A: Admin JSON API (供前端 fetch 调用)
// ============================================
async function registerAdminApiRoutes(app: FastifyInstance): Promise<void> {
  const requireAdmin = async (req: any, reply: any) => {
    if (!req.session?.adminId) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
  };

  // 总览数据
  app.get('/api/admin/dashboard', { preHandler: requireAdmin }, async (_req, reply) => {
    const channels = listChannels();
    const allKeys = listKeys();
    const hubKeys = listHubKeys();
    const db = getDb();
    const last24h = db.prepare(`
      SELECT
        COUNT(*) AS total_requests,
        SUM(CASE WHEN status='success' THEN 1 ELSE 0 END) AS successes,
        SUM(CASE WHEN status='error' THEN 1 ELSE 0 END) AS errors,
        COALESCE(SUM(prompt_tokens), 0) AS input_tokens,
        COALESCE(SUM(completion_tokens), 0) AS output_tokens
      FROM usage_logs
      WHERE created_at >= (strftime('%s', 'now') * 1000 - 86400000)
    `).get() as any;
    return reply.send({
      channelCount: channels.length,
      keyCount: allKeys.length,
      enabledKeyCount: allKeys.filter((k) => k.enabled).length,
      hubKeyCount: hubKeys.length,
      enabledHubKeyCount: hubKeys.filter((k) => k.enabled).length,
      last24h: {
        total_requests: last24h?.total_requests ?? 0,
        successes: last24h?.successes ?? 0,
        errors: last24h?.errors ?? 0,
        input_tokens: last24h?.input_tokens ?? 0,
        output_tokens: last24h?.output_tokens ?? 0,
      },
    });
  });

  // 24h 小时级请求数 (dashboard 柱状图)
  app.get('/api/admin/dashboard/24h-bars', { preHandler: requireAdmin }, async (_req, reply) => {
    const db = getDb();
    const rows = db.prepare(`
      SELECT
        (created_at / 3600000) AS hour_bucket,
        COUNT(*) AS total,
        SUM(CASE WHEN status='success' THEN 1 ELSE 0 END) AS ok,
        SUM(CASE WHEN status='error' THEN 1 ELSE 0 END) AS err
      FROM usage_logs
      WHERE created_at >= ((strftime('%s','now') * 1000) - 86400000)
      GROUP BY hour_bucket
      ORDER BY hour_bucket
    `).all() as any[];
    const buckets: Array<{ hour: string; total: number; ok: number; err: number }> = [];
    const now = Date.now();
    for (let i = 23; i >= 0; i--) {
      const bucketStart = Math.floor(now / 3600000) - i;
      const match = rows.find((r: any) => r.hour_bucket === bucketStart);
      const d = new Date(bucketStart * 3600000);
      buckets.push({
        hour: String(d.getHours()).padStart(2, '0') + ':00',
        total: match?.total ?? 0,
        ok: match?.ok ?? 0,
        err: match?.err ?? 0,
      });
    }
    return reply.send({ ok: true, buckets });
  });

  // 完整 channels + keys JSON (前端渲染用)
  app.get('/api/admin/channels/list', { preHandler: requireAdmin }, async (_req, reply) => {
    const channels = listChannels();
    const keysByChannel: Record<number, any[]> = {};
    for (const c of channels) {
      keysByChannel[c.id] = listKeysByChannel(c.id).map((k) => {
        // 不返回解密后的 api_key (前端不显示明文)
        const { api_key_enc: _api_key_enc, ...rest } = k as any;
        return rest;
      });
    }
    return reply.send({ channels, keysByChannel });
  });

  // 30 天每日趋势
  app.get('/api/admin/usage/trend', { preHandler: requireAdmin }, async (req, reply) => {
    const days = Math.min(90, Math.max(1, parseInt((req.query as any).days ?? '7', 10)));
    const db = getDb();
    const rows = db.prepare(`
      SELECT
        date(created_at / 1000, 'unixepoch') AS day,
        COUNT(*) AS total,
        SUM(CASE WHEN status='success' THEN 1 ELSE 0 END) AS successes,
        SUM(CASE WHEN status='error' THEN 1 ELSE 0 END) AS errors,
        COALESCE(SUM(prompt_tokens + completion_tokens), 0) AS total_tokens,
        ROUND(AVG(latency_ms), 0) AS avg_latency_ms
      FROM usage_logs
      WHERE created_at >= (strftime('%s', 'now') * 1000 - (? * 86400000))
      GROUP BY day
      ORDER BY day ASC
    `).all(days) as any[];
    return reply.send({ days, data: rows });
  });

  // 单 key 30 天
  app.get('/api/admin/keys/:id/usage', { preHandler: requireAdmin }, async (req, reply) => {
    const keyId = parseInt((req.params as any).id, 10);
    const days = Math.min(90, Math.max(1, parseInt((req.query as any).days ?? '7', 10)));
    const db = getDb();
    const rows = db.prepare(`
      SELECT
        date(created_at / 1000, 'unixepoch') AS day,
        COUNT(*) AS total,
        SUM(CASE WHEN status='success' THEN 1 ELSE 0 END) AS successes,
        SUM(CASE WHEN status='error' THEN 1 ELSE 0 END) AS errors,
        COALESCE(SUM(prompt_tokens + completion_tokens), 0) AS total_tokens,
        ROUND(AVG(latency_ms), 0) AS avg_latency_ms
      FROM usage_logs
      WHERE key_id = ? AND created_at >= (strftime('%s', 'now') * 1000 - (? * 86400000))
      GROUP BY day
      ORDER BY day ASC
    `).all(keyId, days) as any[];
    return reply.send({ keyId, days, data: rows });
  });

  // 单 key 当前 cooldown 状态
  app.get('/api/admin/keys/:id/health', { preHandler: requireAdmin }, async (req, reply) => {
    const keyId = parseInt((req.params as any).id, 10);
    const key = getKey(keyId);
    if (!key) return reply.code(404).send({ error: 'key not found' });
    const db = getDb();
    const cooldowns = db.prepare(`
      SELECT upstream_model, reason, recoverable, started_at, expires_at
      FROM cooldowns
      WHERE key_id = ? AND started_at >= (strftime('%s', 'now') - 86400)
      ORDER BY started_at DESC
      LIMIT 20
    `).all(keyId) as any[];
    return reply.send({
      keyId,
      enabled: key.enabled,
      cooldowns: cooldowns.map((c) => ({
        ...c,
        remaining_ms: c.expires_at ? Math.max(0, c.expires_at * 1000 - Date.now()) : 0,
      })),
    });
  });

  // Phase 4.B: Benchmark
  app.post('/api/admin/benchmark/:keyId', { preHandler: requireAdmin }, async (req, reply) => {
    const keyId = parseInt((req.params as any).keyId, 10);
    const body = (req.body ?? {}) as { model?: string; samples?: number };
    const result = await benchmarkKey(keyId, {
      model: body.model,
      samples: body.samples ? Math.min(20, Math.max(1, body.samples)) : 5,
    });
    return reply.send(result);
  });
  app.post('/api/admin/benchmark-all', { preHandler: requireAdmin }, async (req, reply) => {
    const body = (req.body ?? {}) as { model?: string; samples?: number };
    const results = await benchmarkAll({
      model: body.model,
      samples: body.samples ? Math.min(20, Math.max(1, body.samples)) : 5,
    });
    return reply.send({ ok: true, results });
  });

  // Phase 4.C: 当前 in-flight 请求
  app.get('/api/admin/inflight', { preHandler: requireAdmin }, async (_req, reply) => {
    return reply.send({ items: inflightGetAll() });
  });

  // Phase 5: 预置 Provider 列表 (下拉用, 含免费/收费分类)
  app.get('/api/admin/providers', { preHandler: requireAdmin }, async (_req, reply) => {
    const providers = listProvidersForAdmin();
    return reply.send({ providers });
  });

  // Phase 5: 路由策略设置 (凸组合评分 + 策略预设)
  app.get('/api/admin/settings/routing', { preHandler: requireAdmin }, async (_req, reply) => {
    const settings = getAllSettings();
    return reply.send({ strategy: settings['routing_strategy'] ?? 'balanced' });
  });
  app.post('/api/admin/settings/routing', { preHandler: requireAdmin }, async (req, reply) => {
    const body = (req.body ?? {}) as { strategy?: string };
    const valid = ['priority', 'balanced', 'smartest', 'fastest', 'reliable'];
    if (!body.strategy || !valid.includes(body.strategy)) {
      return reply.code(400).send({ ok: false, error: 'invalid strategy' });
    }
    setSetting('routing_strategy', body.strategy);
    return reply.send({ ok: true, strategy: body.strategy });
  });

  // Phase 5: 某 key 的已发现模型 (从上游 /v1/models 拉的)
  app.get('/api/admin/keys/:id/models', { preHandler: requireAdmin }, async (req, reply) => {
    const keyId = parseInt((req.params as any).id, 10);
    if (!getKey(keyId)) return reply.code(404).send({ ok: false, error: 'Key not found' });
    const models = getDiscoveredModelsForKey(keyId);
    return reply.send({ keyId, models });
  });

  // Phase 5: Channel test (newapi 风格: 不走 failover, 用第一个 key 调一次 chat)
  app.post('/api/admin/channels/:id/test', { preHandler: requireAdmin }, async (req, reply) => {
    const { testChannel } = await import('./services/channelTestService.js');
    const result = await testChannel(req, reply);
    return result;
  });

  // Phase 5: Channel 详情 (含 model_mapping 等 newapi 字段)
  app.get('/api/admin/channels/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const channelId = parseInt((req.params as any).id, 10);
    const { getChannelFull } = await import('./services/channelTestService.js');
    return reply.send(getChannelFull(channelId));
  });

  // Phase 5: Channel 更新 (改 newapi 字段)
  app.put('/api/admin/channels/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const channelId = parseInt((req.params as any).id, 10);
    const { updateChannelSettings } = await import('./services/channelTestService.js');
    const result = updateChannelSettings(channelId, req.body as any);
    if (!result) return reply.code(404).send({ ok: false, error: 'Channel not found' });
    return reply.send({ ok: true, channel: result });
  });

}

// ============================================
// HTML 渲染 (内联最小化版本, 后续会拆成模板)
// ============================================
function renderSetupPage(): string {
  return renderPage({
    title: '初始化',
    showNav: false,
    body: `
        <div class="auth-box-logo">
          <span class="auth-box-icon">🔱</span>
        </div>
        <h1>欢迎使用 FreeLLM Hub</h1>
        <p class="auth-box-desc">第一次启动, 请创建你的管理员账号.</p>
        <div id="err" class="err" style="display:none"></div>
        <form id="setup-form">
          <div class="form-row">
            <label>用户名</label>
            <input name="username" required minlength="3" maxlength="32" pattern="[a-zA-Z0-9_-]+"
                   placeholder="3-32 字符, 仅字母数字_-">
          </div>
          <div class="form-row">
            <label>密码</label>
            <input name="password" type="password" required minlength="10"
                   placeholder="至少 10 字符, 必须含字母和数字">
          </div>
          <div class="form-row">
            <label>确认密码</label>
            <input name="password2" type="password" required minlength="10">
          </div>
          <button type="submit" class="btn primary" id="submit-btn">创建账号并进入</button>
        </form>`,
    scripts: `
window.Form.bind('#setup-form', {
  url: '/api/setup',
  btnText: '创建账号并进入',
  busyText: '创建中...',
  successRedirect: (data) => data.redirect || '/admin/dashboard',
});`,
  });
}

