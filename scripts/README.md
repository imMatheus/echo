# Smoke tests

End-to-end checks against a running server (no test framework, just node).

```bash
# terminal 1: database + server
docker compose -f docker-compose.dev.yml up -d
pnpm build && node apps/server/dist/index.js

# terminal 2: full API/MCP/privacy suite (51 assertions) against :3246
node scripts/smoke.mjs
```

To exercise the pgvector hybrid-search path without a real embedding provider:

```bash
node scripts/mock-embeddings.mjs &   # OpenAI-compatible mock on :9999
PORT=3247 EMBEDDINGS_PROVIDER=openai OPENAI_API_KEY=test \
  OPENAI_BASE_URL=http://localhost:9999 node apps/server/dist/index.js &
node scripts/smoke-vector.mjs        # targets :3247
```
