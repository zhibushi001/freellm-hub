import { Router } from 'express';

export const modelsRouter = Router();

// OpenAI-compatible /v1/models endpoint
// M0 returns a stub list; M1 will return real models from configured providers
modelsRouter.get('/models', (_req, res) => {
  res.json({
    object: 'list',
    data: [
      {
        id: 'stub-model',
        object: 'model',
        created: Math.floor(Date.now() / 1000),
        owned_by: 'freellm-hub',
      },
    ],
  });
});
