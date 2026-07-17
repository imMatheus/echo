# Echo — the open context layer for AI apps

Echo is an open-source, self-hostable memory layer that lets AI tools — Claude, ChatGPT, Cursor, Gemini, Grok, and anything else that speaks [MCP](https://modelcontextprotocol.io) — share user-approved context. Tell one assistant something once; every assistant you connect can recall it, within the scopes you allow.

```
  Claude Code ─┐                       ┌────────────────────────────┐
  Claude.ai ───┤                       │  Echo server               │
  Cursor ──────┼──  MCP over HTTP ──▶  │  · REST API + MCP endpoint │──▶ Postgres + pgvector
  ChatGPT ─────┤    (bearer token)     │  · scoped access control   │
  anything ────┘                       │  · audit log · dashboard   │
                                       └────────────────────────────┘
```

## Why

Every AI app builds its own memory silo. Your preferences live in ChatGPT, your codebase conventions in Cursor, your team's BigQuery table meanings nowhere at all. Echo is a single, model-agnostic, user-controlled context store:

- **Structured memories, not chat logs** — each memory records its scope, source app, confidence, explicit-vs-inferred provenance, sensitivity, and optional expiry.
- **Scoped access control** — `personal`, `organization`, `workspace`, `team`, and `project` scopes. Personal memories are never visible to coworkers or org owners. Org memories are shared only with members.
- **Audit everything** — every write, and every read made by a connected app, is logged with actor, app, and scope.
- **Semantic recall** — Postgres + pgvector hybrid search (vector + full-text, reciprocal-rank fusion). Embedding providers are pluggable (OpenAI, Voyage, Ollama) and optional — with none configured, search falls back to full-text and everything still works offline.
- **Open source, one-command deploy** — run the private/self-hosted build with Docker Compose. Public multi-tenant deployment needs the identity hardening described below.

## Quickstart (self-hosted)

Requirements: Docker with the compose plugin, and [Bun](https://bun.sh) for the dashboard.

```bash
git clone <your-fork-or-this-repo> echo && cd echo
cp apps/server/.env.example apps/server/.env
cp apps/web/.env.example apps/web/.env
docker compose --env-file apps/server/.env up -d --build
bun install
bun run dev:web
```

Compose runs only the API at `http://localhost:8080`; Vite runs the dashboard separately at `http://localhost:5173`. The default `console` email provider prints its verification link in `docker compose logs app`; production deployments should configure Resend before enabling signup. Create an API key under **API Keys**, then follow the **Connect** page to wire up your AI apps.

To enable semantic search, set a provider in `apps/server/.env` and restart:

```bash
EMBEDDINGS_PROVIDER=openai
OPENAI_API_KEY=sk-...
```

### Production email

Echo keeps email delivery behind a provider interface and ships with `console` and `resend` adapters. For Resend, verify a sending domain and set:

```bash
APP_URL=https://echo.example.com
EMAIL_PROVIDER=resend
EMAIL_FROM=Echo <auth@mail.example.com>
RESEND_API_KEY=re_...
AUTH_TOKEN_SECRET=<a unique value from: openssl rand -base64 48>
```

`APP_URL` is the browser URL embedded in email links: use `http://localhost:5173` for Vite development or your public HTTPS dashboard URL in production. Resend requires both `APP_URL` and a unique `AUTH_TOKEN_SECRET`.

Signup requires one-time email verification. Password-reset links expire after one hour, revoke every existing dashboard session when used, and trigger a password-change notification. Verification links expire after 24 hours. Delivery uses a transactional database outbox with retries and provider idempotency.

## Connecting AI apps

Create an API key in the dashboard first. The key authenticates as you and tags each app's writes for provenance (name it after the app: "claude-code", "cursor", ...).

**Claude Code**

```bash
claude mcp add --transport http echo http://localhost:8080/mcp \
  --header "Authorization: Bearer eck_..."
```

**Cursor** — add to `.cursor/mcp.json` (or `~/.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "echo": {
      "url": "http://localhost:8080/mcp",
      "headers": { "Authorization": "Bearer eck_..." }
    }
  }
}
```

**Any other MCP client** — point it at `POST /mcp` with the `Authorization: Bearer eck_...` header. The dashboard's **Connect** page has ready-to-paste snippets for Claude Desktop, Devin, Codex, ChatGPT, and more.

### MCP tools

| Tool               | What it does                                                                      |
| ------------------ | --------------------------------------------------------------------------------- |
| `remember_context` | Store a memory (explicit or inferred, with confidence, tags, sensitivity, expiry) |
| `recall_context`   | Hybrid semantic search across every scope you can read                            |
| `list_context`     | Browse memories chronologically                                                   |
| `forget_context`   | Delete a memory by id                                                             |
| `list_scopes`      | List accessible scopes, for deciding where shared knowledge belongs               |

## The memory model

```jsonc
{
  "content": "BigQuery table analytics.events_v3 is the canonical event stream; _v2 is deprecated",
  "scopeId": "…", // personal | organization | workspace | team | project scope
  "kind": "explicit", // explicit (user asked) vs inferred (model deduced)
  "confidence": 1, // 0..1
  "sensitivity": "normal", // low | normal | high
  "sourceApp": "claude-code", // which app wrote it
  "tags": ["bigquery", "analytics"],
  "expiresAt": null, // optional auto-expiry
  "createdBy": "…", // user provenance
  "embeddingModel": "openai:text-embedding-3-small",
}
```

**Privacy boundaries.** Personal scopes are visible only to their owner — not to coworkers, not to org owners. Org-owned scopes are visible to org members (workspace/team/project scopes to their members plus org owners). Org audit logs contain only org-scoped events, and recall queries are never written to org audit rows — only result counts and memory ids.

## Configuration

| Variable                                           | Default                            | Purpose                                                                                                                                 |
| -------------------------------------------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                                     | empty: local Postgres              | The only database connection setting. Empty uses the local Docker database; set it to any external PostgreSQL URL to use that database. |
| `PORT` / `HOST`                                    | `8080` / `0.0.0.0`                 | Listen address                                                                                                                          |
| `APP_URL`                                          | —                                  | Public URL; https enables Secure cookies                                                                                                |
| `TRUST_PROXY`                                      | `false`                            | Behind a reverse proxy                                                                                                                  |
| `BIND_ADDRESS`                                     | `127.0.0.1`                        | Host interface published by Docker Compose                                                                                              |
| `WEB_ORIGIN`                                       | `http://localhost:5173`            | The one browser origin allowed to make credentialed API requests                                                                        |
| `COOKIE_SAME_SITE`                                 | `lax`                              | Session-cookie policy; use `none` only for HTTPS cross-site deployments                                                                 |
| `DISABLE_SIGNUP`                                   | `false`                            | Lock down a private instance                                                                                                            |
| `EMAIL_PROVIDER`                                   | `console`                          | `console` for local logs or `resend` for production delivery                                                                            |
| `EMAIL_FROM` / `EMAIL_REPLY_TO`                    | `Echo <onboarding@resend.dev>` / — | Transactional email sender and optional reply address                                                                                   |
| `RESEND_API_KEY`                                   | —                                  | Resend delivery credential                                                                                                              |
| `AUTH_TOKEN_SECRET`                                | development-only default           | Derives recoverable outbox tokens; production HTTPS deployments require a unique 32+ character value                                    |
| `EMBEDDINGS_PROVIDER`                              | `none`                             | `none` \| `openai` \| `voyage` \| `ollama`                                                                                              |
| `EMBEDDINGS_MODEL`                                 | provider default                   | Override the embedding model                                                                                                            |
| `OPENAI_BASE_URL`                                  | `https://api.openai.com/v1`        | Optional OpenAI-compatible API base URL                                                                                                 |
| `OPENAI_API_KEY` / `VOYAGE_API_KEY` / `OLLAMA_URL` | —                                  | Provider credentials                                                                                                                    |
| `SESSION_TTL_DAYS`                                 | `30`                               | Dashboard session lifetime                                                                                                              |
| `STATIC_DIR`                                       | auto                               | Optional legacy path for serving a dashboard from the API process; split deployments do not use it                                      |

All server settings belong in `apps/server/.env`. The only web setting belongs in `apps/web/.env`: `VITE_SERVER_URL`. Leave `DATABASE_URL` empty for the local Docker database. Set it once to an external PostgreSQL connection string when deploying or when you want local development to use that provider; every server path uses the same value.

### PlanetScale Postgres

Echo supports PlanetScale **Postgres** (not a PlanetScale Vitess/MySQL database). Copy its **direct** PostgreSQL connection URL (port `5432`) into `DATABASE_URL` — not the pooled PgBouncer URL (port `6432`): Echo serializes boot-time migrations with a session advisory lock, which transaction pooling cannot hold. Echo passes the URL through unchanged for both application traffic and migrations; there is no provider-specific database environment variable.

For separate Vercel dashboard and Cloud Run server deployments, see [the deployment guide](docs/deploy-vercel-cloud-run.md).

Switching embedding providers is safe at any time: memories remember which model embedded them, vector search only matches vectors from the active model, and full-text search covers the rest. Re-save a memory to re-embed it with the new provider.

## Development

```bash
bun install
cp apps/server/.env.example apps/server/.env
cp apps/web/.env.example apps/web/.env
docker compose --env-file apps/server/.env -f docker-compose.dev.yml up -d   # pgvector on localhost:5433
bun run dev                                       # server :8080 + vite dev server :5173
```

Open http://localhost:5173. The dashboard uses `VITE_SERVER_URL` (default: `http://localhost:8080`) to call the separate server. Run tests with `bun run test`, typecheck with `bun run typecheck`, production build with `bun run build`.

### Repository layout

```
apps/server         Fastify API, MCP endpoint, Drizzle schema + migrations, access control, audit
apps/server/drizzle Generated SQL migrations, applied on boot before resumable concurrent index maintenance
apps/web            React dashboard (memories, orgs, API keys, audit, connect)
packages/shared     Types shared by server, dashboard, and integrations
docs/API.md         Full REST API reference
```

### Architecture notes

- **Thin MCP layer** — MCP tools call the exact same core functions as the REST routes, so scoping rules and audit logging cannot diverge between paths.
- **Stateless MCP endpoint** — each `POST /mcp` builds a fresh server/transport pair; no session affinity, horizontal scaling is trivial.
- **Dimension-agnostic vectors, with a scaling tradeoff** — the `embedding` column is an untyped `vector`, so providers and dimensions can change without a schema migration. Each row records its generated dimension, and recall only compares compatible vectors for the active model; full-text search still covers incompatible legacy rows. That flexibility prevents a fixed-dimension HNSW/IVFFlat index: vector ranking is currently an exact scan over accessible rows. Large deployments should move to model/dimension-specific indexed storage rather than treating this as free scalability.
- **Deletion and expiry** — an explicit deletion permanently removes the memory row immediately. Expired memories vanish from queries immediately and are purged by the retention sweep after 30 days.
- **Drizzle ORM** — the schema lives in `apps/server/src/db/schema.ts`; core queries use the Drizzle query builder, while the hybrid vector/full-text recall stays hand-written SQL run through Drizzle's `sql` executor. Generate migrations from the server package (`cd apps/server && bun run db:generate -- --name <slug>`) so Drizzle writes to `apps/server/drizzle`, then apply them automatically on server start or explicitly with `bun run --filter @echo/server db:migrate`. Use this project migrator instead of calling `drizzle-kit migrate` directly because it also runs resumable cleanup batches, rolling-deploy write guards, and PostgreSQL concurrent-index phases that cannot live inside Drizzle's transaction.

## Hosted vs self-hosted

The same application code can run privately or behind a hosted control plane. Public signup is safe only after a production email provider and HTTPS `APP_URL` are configured. Organization membership is granted only to existing verified accounts; Echo still does not send organization invitations, so invite workflows remain a separate hosted-control-plane concern. Private instances can set `DISABLE_SIGNUP=true` after provisioning their users.

## License

[MIT](LICENSE)
