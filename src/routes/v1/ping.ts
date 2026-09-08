import { Router } from 'express';

export const pingRouter = Router();

pingRouter.get('/ping', (_req, res) => {
  res.json({ status: 'pong', timestamp: new Date().toISOString() });
});
