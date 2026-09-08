import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/server.js';

describe('freellm-hub', () => {
  const app = createApp();

  it('GET /health returns ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.service).toBe('freellm-hub');
  });

  it('GET /v1/ping returns pong', async () => {
    const res = await request(app).get('/v1/ping');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('pong');
  });

  it('GET /v1/models returns OpenAI-compatible list', async () => {
    const res = await request(app).get('/v1/models');
    expect(res.status).toBe(200);
    expect(res.body.object).toBe('list');
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('GET /unknown returns 404', async () => {
    const res = await request(app).get('/this-does-not-exist');
    expect(res.status).toBe(404);
  });
});
