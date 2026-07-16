# Smoke tests

End-to-end checks against a running server (no test framework, just node).

```bash
# terminal 1: database + server
docker compose --env-file apps/server/.env -f docker-compose.dev.yml up -d
bun run build && bun run start

# terminal 2: full API/MCP/privacy/concurrency suite (74 assertions)
node scripts/smoke.mjs # defaults to http://127.0.0.1:8080
```

To exercise the pgvector hybrid-search path without a real embedding provider:

```bash
node scripts/mock-embeddings.mjs &   # OpenAI-compatible mock on :9999
PORT=3247 EMBEDDINGS_PROVIDER=openai OPENAI_API_KEY=test \
  OPENAI_BASE_URL=http://127.0.0.1:9999 bun apps/server/src/index.ts &
node scripts/smoke-vector.mjs        # 12 hybrid-search + revocation-race checks, targets :3247
```

Set `ECHO_BASE_URL` for either smoke script when the server uses another origin,
for example `ECHO_BASE_URL=http://127.0.0.1:43247 node scripts/smoke.mjs`.
