/**
 * React 前端集成模块
 * 服务 React SPA 静态文件并处理客户端路由
 */
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fastifyStatic from '@fastify/static';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export function registerReactApp(app: FastifyInstance): void {
  const adminDir = join(__dirname, 'public/admin');

  if (!existsSync(adminDir)) {
    console.warn('[react-app] admin dir not found:', adminDir);
    return;
  }

  // Serve React static files with /admin/static/ prefix
  app.register(fastifyStatic, {
    root: join(adminDir),
    prefix: '/admin/static/',
    decorateReply: false,
  });

  // Serve React assets from /assets/ prefix (for CSS/JS)
  if (existsSync(join(adminDir, 'assets'))) {
    app.register(fastifyStatic, {
      root: join(adminDir, 'assets'),
      prefix: '/assets/',
      decorateReply: false,
    });
  }

  // Read index.html once at startup
  const indexPath = join(adminDir, 'index.html');
  const indexHtml = existsSync(indexPath) ? readFileSync(indexPath, 'utf-8') : null;

  function serveReactApp(reply: FastifyReply) {
    if (!indexHtml) {
      return reply.code(500).send({ error: 'React SPA not built' });
    }
    return reply
      .type('text/html; charset=utf-8')
      .header('cache-control', 'no-cache, no-store, must-revalidate')
      .send(indexHtml);
  }

  // Register explicit routes for ALL admin pages BEFORE the 404 handler
  // This ensures Fastify matches these routes directly
  const adminPages = [
    '/login',
    '/admin',
    '/admin/dashboard',
    '/admin/channels',
    '/admin/routes',
    '/admin/hub-keys',
    '/admin/usage',
    '/admin/profile',
  ];

  for (const page of adminPages) {
    app.get(page, async (_req, reply) => serveReactApp(reply));
  }

  // Catch-all for any other /admin/* routes (SPA client-side routing)
  app.setNotFoundHandler(async (req: FastifyRequest, reply: FastifyReply) => {
    const url = req.url.split('?')[0]; // strip query params

    if (url.startsWith('/admin/') && !url.startsWith('/admin/static/')) {
      return serveReactApp(reply);
    }

    return reply.code(404).send({ error: 'Not Found' });
  });
}
