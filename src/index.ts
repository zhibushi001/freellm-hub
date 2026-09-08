import { createApp } from './server.js';
import { env } from './env.js';

const app = createApp();

app.listen(env.port, env.host, () => {
  console.log(`[freellm-hub] listening on http://${env.host}:${env.port}`);
  console.log(`[freellm-hub] env: ${env.nodeEnv}`);
  console.log(`[freellm-hub] health: http://${env.host}:${env.port}/health`);
  console.log(`[freellm-hub] v1:    http://${env.host}:${env.port}/v1/ping`);
});
