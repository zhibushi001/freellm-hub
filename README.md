# freellm-hub

Unified OpenAI-compatible gateway for free LLM providers.

## Goals

- ✅ OpenAI-compatible `/v1/chat/completions`, `/v1/models`, `/v1/embeddings`
- ✅ Encrypted at-rest key storage (AES-256-GCM)
- ✅ Smart routing with automatic failover across providers
- ✅ Per-key model discovery (which models can a given key actually use)
- ✅ Copyable API keys (unlike one-api/new-api)
- ✅ Built-in presets for Chinese providers (SenseNova, Zhipu, Moonshot, DeepSeek) + international (Groq, Cerebras, Mistral, etc.)
- 🟡 Web dashboard for management (planned)
- 🟡 Multi-user / quota (planned, optional)

## Inspired by

- [tashfeenahmed/freellmapi](https://github.com/tashfeenahmed/freellmapi) — easy config, free aggregation, copyable keys
- [songquanpeng/one-api](https://github.com/songquanpeng/one-api) & forks (new-api) — full feature set, per-key model view
- [open-free-llm-api/awesome-freellm-apis](https://github.com/open-free-llm-api/awesome-freellm-apis) — provider catalog

This is a **personal project** for experimentation. Not affiliated with any of the above.

## Stack

- TypeScript + Node.js 20+ + Express
- SQLite (planned) for metadata + encrypted key storage
- React (planned) for dashboard
- Docker for deployment

## Development

```bash
# Dev mode with hot reload (recommended for editing)
docker compose -f docker-compose.dev.yml up

# Production
docker compose up -d --build
```

Endpoints:
- `http://localhost:3030/health` — health check
- `http://localhost:3030/v1/ping` — API ping
- `http://localhost:3030/v1/models` — list models (stub for now)

## Status

- [x] **M0** Project scaffold (this commit) — Express server, /health, /v1/ping, /v1/models stub
- [ ] **M1** Real OpenAI-compatible endpoint with 1-2 providers
- [ ] **M2** Dashboard UI
- [ ] **M3** Key management with copy-out + per-key model view
- [ ] **M4** Chinese provider presets
- [ ] **M5** Polish + CI
