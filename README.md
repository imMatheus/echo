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
- **Open source, one-command deploy** — run the private/self-hosted build with Docker Compose. Public multi-tenant deployment needs the identity hardening described below.

## Quickstart (self-hosted)

Requirements: Docker with the compose plugin.

```bash
git clone <your-fork-or-this-repo> echo && cd echo
docker compose up -d --build
```

Compose binds Echo to `127.0.0.1` by default. Open http://localhost:3246, create the initial account, then set `DISABLE_SIGNUP=true` before exposing a private instance through a reverse proxy or by setting `BIND_ADDRESS=0.0.0.0`. Create an API key under **API Keys**, then follow the **Connect** page to wire up your AI apps.

> **Deployment warning:** this version does not verify email ownership. Organization membership is granted to an existing account by email address, so public signups create an unsafe identity boundary for shared/org data. Keep public signups disabled for shared use until email verification or an external trusted identity layer is in place.

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

The stdio bridge is not published to npm yet. Build the reviewed local source instead of running an unclaimed package name:

```bash
bun install
bun run --filter echo-context-mcp build
```

Then configure the client (Node.js 20 or newer) with the absolute path to the built file:

```json
{
  "mcpServers": {
    "echo": {
      "command": "node",
      "args": ["/absolute/path/to/echo/packages/mcp-bridge/dist/index.js"],
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
| `DATABASE_URL` | `postgres://echo:echo@localhost:5433/echo` outside Compose | Database URL used when the server runs directly on the host |
| `ECHO_DATABASE_URL` | `postgres://echo:echo@db:5432/echo` in Compose | Compose-only database URL override; percent-encode reserved characters in its password component |
| `POSTGRES_PASSWORD` | `echo` | Raw password used by the Compose Postgres service |
| `PORT` / `HOST` | `3246` / `0.0.0.0` | Listen address |
| `APP_URL` | — | Public URL; https enables Secure cookies |
| `TRUST_PROXY` | `false` | Behind a reverse proxy |
| `BIND_ADDRESS` | `127.0.0.1` | Host interface published by Docker Compose |
| `DISABLE_SIGNUP` | `false` | Lock down a private instance |
| `EMBEDDINGS_PROVIDER` | `none` | `none` \| `openai` \| `voyage` \| `ollama` |
| `EMBEDDINGS_MODEL` | provider default | Override the embedding model |
| `OPENAI_BASE_URL` | `https://api.openai.com/v1` | Optional OpenAI-compatible API base URL |
| `OPENAI_API_KEY` / `VOYAGE_API_KEY` / `OLLAMA_URL` | — | Provider credentials |
| `SESSION_TTL_DAYS` | `30` | Dashboard session lifetime |
| `STATIC_DIR` | auto | Where the built dashboard lives |

When changing the Compose password, set both variables. For example, use the raw `POSTGRES_PASSWORD=p@ss/word` for Postgres and `ECHO_DATABASE_URL=postgres://echo:p%40ss%2Fword@db:5432/echo` for the app. The separate name prevents a host-development `DATABASE_URL` from accidentally pointing the app container at its own loopback interface. With no overrides, Compose keeps the matching `echo` defaults.

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
apps/server         Fastify API, MCP endpoint, Drizzle schema + migrations, access control, audit
apps/server/drizzle Generated SQL migrations, applied on boot before resumable concurrent index maintenance
apps/web            React dashboard (memories, orgs, API keys, audit, connect)
packages/shared     Types shared by server, dashboard, and integrations
packages/mcp-bridge echo-context-mcp — stdio bridge for local-only MCP clients
docs/API.md         Full REST API reference
```

### Architecture notes

- **Thin MCP layer** — MCP tools call the exact same core functions as the REST routes, so scoping rules and audit logging cannot diverge between paths.
- **Stateless MCP endpoint** — each `POST /mcp` builds a fresh server/transport pair; no session affinity, horizontal scaling is trivial.
- **Dimension-agnostic vectors, with a scaling tradeoff** — the `embedding` column is an untyped `vector`, so providers and dimensions can change without a schema migration. Each row records its generated dimension, and recall only compares compatible vectors for the active model; full-text search still covers incompatible legacy rows. That flexibility prevents a fixed-dimension HNSW/IVFFlat index: vector ranking is currently an exact scan over accessible rows. Large deployments should move to model/dimension-specific indexed storage rather than treating this as free scalability.
- **Deletion and expiry** — an explicit deletion permanently removes the memory row immediately. Expired memories vanish from queries immediately and are purged by the retention sweep after 30 days.
- **Drizzle ORM** — the schema lives in `apps/server/src/db/schema.ts`; core queries use the Drizzle query builder, while the hybrid vector/full-text recall stays hand-written SQL run through Drizzle's `sql` executor. Generate migrations from the server package (`cd apps/server && bun run db:generate -- --name <slug>`) so Drizzle writes to `apps/server/drizzle`, then apply them automatically on server start or explicitly with `bun run --filter @echo/server db:migrate`. Use this project migrator instead of calling `drizzle-kit migrate` directly because it also runs resumable cleanup batches, rolling-deploy write guards, and PostgreSQL concurrent-index phases that cannot live inside Drizzle's transaction.

## Hosted vs self-hosted

The same application code can run privately or behind a hosted control plane, but the current build is appropriate only for a private instance or a single trusted identity domain. It has no email verification or invitation proof, while organization membership is assigned by account email. Keep `DISABLE_SIGNUP=true` after provisioning trusted accounts; do not expose open signup for shared/org use until a verified identity layer exists.

## License

[MIT](LICENSE)
