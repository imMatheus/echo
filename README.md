# Echo — the open context layer for AI apps

Echo is an open-source, self-hostable memory layer that lets AI tools — Claude, ChatGPT, Cursor, Gemini, Grok, and anything else that speaks [MCP](https://modelcontextprotocol.io) — share user-approved context. Tell one assistant something once; every assistant you connect can recall it, within the scopes you allow.

```
  Claude Code ─┐                       ┌────────────────────────────┐
  Claude.ai ───┤    MCP (HTTP or      │  Echo server               │
  Cursor ──────┼──  stdio bridge) ──▶ │  · REST API + MCP endpoint │──▶ Postgres + pgvector
  ChatGPT ─────┤                      │  · scoped access control   │
  anything ────┘                      │  · audit log · dashboard   │
                                      └────────────────────────────┘
```

## Why

Every AI app builds its own memory silo. Your preferences live in ChatGPT, your codebase conventions in Cursor, your team's BigQuery table meanings nowhere at all. Echo is a single, model-agnostic, user-controlled context store:

- **Structured memories, not chat logs** — each memory records its scope, source app, confidence, explicit-vs-inferred provenance, sensitivity, and optional expiry.
- **Scoped access control** — `personal`, `organization`, `workspace`, `team`, and `project` scopes. Personal memories are never visible to coworkers or org admins. Org memories are shared only with members.
- **Audit everything** — every write, and every read made by a connected app, is logged with actor, app, and scope.
- **Semantic recall** — Postgres + pgvector hybrid search (vector + full-text, reciprocal-rank fusion). Embedding providers are pluggable (OpenAI, Voyage, Ollama) and optional — with none configured, search falls back to full-text and everything still works offline.
- **Open source, one-command deploy** — the same codebase runs self-hosted (Docker Compose) or as a hosted multi-tenant service.

## Quickstart (self-hosted)

Requirements: Docker with the compose plugin.

```bash
git clone <your-fork-or-this-repo> echo && cd echo
docker compose up -d --build
```

Open http://localhost:3246, sign up (the first account is yours — set `DISABLE_SIGNUP=true` afterwards if it's a private instance), create an API key under **API Keys**, then follow the **Connect** page to wire up your AI apps.

To enable semantic search, put a provider in `.env` (see `.env.example`) and restart:

```bash
EMBEDDINGS_PROVIDER=openai
OPENAI_API_KEY=sk-...
```

## Connecting AI apps

Create an API key in the dashboard first. The key authenticates as you and tags each app's writes for provenance (name it after the app: "claude-code", "cursor", ...).

**Claude Code**

```bash
claude mcp add --transport http echo http://localhost:3246/mcp \
  --header "Authorization: Bearer eck_..."
```

**Claude Desktop, Cursor, or any stdio-only MCP client**

```json
{
  "mcpServers": {
    "echo": {
      "command": "npx",
      "args": ["-y", "echo-context-mcp"],
      "env": { "ECHO_URL": "http://localhost:3246", "ECHO_API_KEY": "eck_..." }
    }
  }
}
```

**Any remote-MCP client** — point it at `POST /mcp` with the `Authorization: Bearer eck_...` header.

### MCP tools

| Tool | What it does |
| --- | --- |
| `remember_context` | Store a memory (explicit or inferred, with confidence, tags, sensitivity, expiry) |
| `recall_context` | Hybrid semantic search across every scope you can read |
| `list_context` | Browse memories chronologically |
| `forget_context` | Delete a memory by id |
| `list_scopes` | List accessible scopes, for deciding where shared knowledge belongs |

## The memory model

```jsonc
{
  "content": "BigQuery table analytics.events_v3 is the canonical event stream; _v2 is deprecated",
  "scopeId": "…",            // personal | organization | workspace | team | project scope
  "kind": "explicit",        // explicit (user asked) vs inferred (model deduced)
  "confidence": 1,           // 0..1
  "sensitivity": "normal",   // low | normal | high
  "sourceApp": "claude-code",// which app wrote it
  "tags": ["bigquery", "analytics"],
  "expiresAt": null,         // optional auto-expiry
  "createdBy": "…",          // user provenance
  "embeddingModel": "openai:text-embedding-3-small"
}
```

**Privacy boundaries.** Personal scopes are visible only to their owner — not to coworkers, not to org admins. Org-owned scopes are visible to org members (workspace/team/project scopes to their members plus org admins). Org audit logs contain only org-scoped events, and recall queries are never written to org audit rows — only result counts and memory ids.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | `postgres://echo:echo@localhost:5433/echo` | Postgres with pgvector |
| `PORT` / `HOST` | `3246` / `0.0.0.0` | Listen address |
| `APP_URL` | — | Public URL; https enables Secure cookies |
| `TRUST_PROXY` | `false` | Behind a reverse proxy |
| `DISABLE_SIGNUP` | `false` | Lock down a private instance |
| `EMBEDDINGS_PROVIDER` | `none` | `none` \| `openai` \| `voyage` \| `ollama` |
| `EMBEDDINGS_MODEL` | provider default | Override the embedding model |
| `OPENAI_API_KEY` / `VOYAGE_API_KEY` / `OLLAMA_URL` | — | Provider credentials |
| `SESSION_TTL_DAYS` | `30` | Dashboard session lifetime |
| `STATIC_DIR` | auto | Where the built dashboard lives |

Switching embedding providers is safe at any time: memories remember which model embedded them, vector search only matches vectors from the active model, and full-text search covers the rest. Re-save a memory to re-embed it with the new provider.

## Development

```bash
bun install
docker compose -f docker-compose.dev.yml up -d   # pgvector on localhost:5433
bun run --filter @echo/shared build
bun run dev                                       # server :3246 + vite dev server :5173
```

Open http://localhost:5173 (the dev dashboard proxies `/api` and `/mcp` to the server). Run tests with `bun run test`, typecheck with `bun run typecheck`, production build with `bun run build`.

### Repository layout

```
apps/server         Fastify API, MCP endpoint, migrations, access control, audit
apps/web            React dashboard (memories, orgs, API keys, audit, connect)
packages/shared     Types shared by server, dashboard, and integrations
packages/mcp-bridge echo-context-mcp — stdio bridge for local-only MCP clients
docs/API.md         Full REST API reference
```

### Architecture notes

- **Thin MCP layer** — MCP tools call the exact same core functions as the REST routes, so scoping rules and audit logging cannot diverge between paths.
- **Stateless MCP endpoint** — each `POST /mcp` builds a fresh server/transport pair; no session affinity, horizontal scaling is trivial.
- **Dimension-agnostic vectors** — the `embedding` column is an untyped `vector`, so any provider/dimension works without a schema change; rows are filtered by `embedding_model` before distance comparison.
- **Soft deletes** — deleted and expired memories vanish from every query immediately and are purged permanently after 30 days.

## Hosted vs self-hosted

Both run this exact codebase. A hosted deployment is just this server with signups enabled behind TLS; a private instance sets `DISABLE_SIGNUP=true` after provisioning accounts. There is no feature gate between the two.

## License

[MIT](LICENSE)
