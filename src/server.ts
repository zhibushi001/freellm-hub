import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import { env } from './env.js';
import { getDb } from './db/index.js';
import { modelsRouter } from './routes/v1/models.js';
import { pingRouter } from './routes/v1/ping.js';
import { chatRouter } from './routes/v1/chat.js';
import { providersRouter } from './routes/api/providers.js';

export const createApp = (): Express => {
  const app = express();

  // Initialize DB (creates schema on first run)
  getDb();

  // Middleware
  app.use(cors());
  app.use(express.json({ limit: '4mb' }));

  // Static dashboard (public/index.html at /)
  app.use(express.static('public'));

  // Request logging (minimal)
  app.use((req, _res, next) => {
    if (env.logLevel === 'debug') {
      console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
    }
    next();
  });

  // Health
  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      service: 'freellm-hub',
      version: '0.1.0',
      mode: 'm1-chat',
      db: 'sqlite',
      timestamp: new Date().toISOString(),
    });
  });

  // OpenAI-compatible routes
  app.use('/v1', pingRouter);
  app.use('/v1', modelsRouter);
  app.use('/v1', chatRouter);

  // Management API
  app.use('/api', providersRouter);

  // 404
  app.use((_req, res) => {
    res.status(404).json({ error: { message: 'Not Found', type: 'invalid_request_error' } });
  });

  // Error handler
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[error]', err.message);
    res.status(500).json({
      error: { message: 'Internal Server Error', type: 'server_error', detail: err.message },
    });
  });

  return app;
};
