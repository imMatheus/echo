# Echo REST API

Base path: `/api/v1`. All bodies are JSON. All resource JSON uses camelCase and matches the types in `@echo/shared`.

## Authentication

Two authentication mechanisms — memory, scope, organization, audit, and stats endpoints accept either unless noted:

1. **Session cookie** (`echo_session`, httpOnly) — set by `POST /auth/login` or `POST /auth/signup`. Used by the dashboard.
2. **API key** — `Authorization: Bearer eck_...` header. Keys are created in the dashboard and act as the user who created them. Used by the MCP server, the stdio bridge, and any integration.

Deployment note: this version does not verify email ownership. Because organization members are selected from existing accounts by email address, keep public signup disabled for shared/org deployments until a trusted identity-verification layer is added.

Errors always look like:

```json
{ "error": { "code": "forbidden", "message": "You do not have access to this scope" } }
```

Codes: `unauthorized` (401), `forbidden` (403), `not_found` (404), `validation_error` (400), `conflict` (409), `rate_limited` (429), `signup_disabled` (403), `internal_error` (500).

## Meta

- `GET /api/v1/meta` → `ServerMeta` — public. `{ name, version, signupEnabled, embeddings: {provider, model} | null }`
- `GET /api/v1/health` → `{ ok: true, db: true }` — public.

## Auth

- `POST /auth/signup` `{ email, password, name }` → `{ user }` + sets session cookie. 403 `signup_disabled` when `DISABLE_SIGNUP=true`.
- `POST /auth/login` `{ email, password }` → `{ user }` + sets session cookie.
- `POST /auth/logout` → `{ ok: true }` + clears cookie.
- `GET /auth/me` → `MeResponse` `{ user, personalScopeId }`.

## Memories

- `GET /memories` → `ListMemoriesResponse` `{ memories, total }`
  - Query params (all optional): `scopeId`, `q` (substring filter), `kind`, `sensitivity`, `sourceApp`, `tag`, `limit` (default 50, max 200), `offset` (max 100,000).
  - Returns memories from every scope the caller can read (or just `scopeId` if given). Expired and deleted memories are excluded.
- `POST /memories` `CreateMemoryRequest` → `{ memory }`
  - `content` required; `scopeId` defaults to the caller's personal scope.
- `POST /memories/search` `SearchMemoriesRequest` `{ query, scopeIds?, limit? }` → `SearchMemoriesResponse` `{ results, mode }`
  - Hybrid semantic + full-text search when an embedding provider is configured (`mode: "hybrid"`), Postgres full-text only otherwise (`mode: "fts"`). Results are ranked by reciprocal-rank fusion and include `score` and `similarity`.
- `GET /memories/:id` → `{ memory }`
- `PATCH /memories/:id` `UpdateMemoryRequest` → `{ memory }` — allowed for the memory's creator or a scope manager. Editing `content` re-embeds.
- `DELETE /memories/:id` → `{ ok: true }` — immediate permanent deletion; same permission as PATCH.

## Scopes

- `GET /scopes` → `{ scopes: ScopeWithAccess[] }` — everything the caller can read: their personal scope, org scopes of orgs they belong to, and workspace/team/project scopes they're a member of (org owners/admins see all scopes in their org).
- `POST /scopes` `CreateScopeRequest` `{ orgId, type: workspace|team|project, name }` → `{ scope }` — org admin/owner only. Creator is added as a scope member.
- `DELETE /scopes/:id` → `{ ok: true }` — org admin/owner only; `organization` and `personal` scopes cannot be deleted. Deletes the scope's memories.
- `GET /scopes/:id/members` → `{ members: ScopeMember[] }`
- `POST /scopes/:id/members` `{ email }` → `{ member }` — org admin/owner only; user must already be an org member.
- `DELETE /scopes/:id/members/:userId` → `{ ok: true }` — org admin/owner only.

## Organizations

- `GET /orgs` → `{ orgs: OrganizationWithRole[] }`
- `POST /orgs` `{ name }` → `{ org }` — creator becomes `owner`; an `organization`-type scope is auto-created.
- `GET /orgs/:id` → `{ org, role }`
- `PATCH /orgs/:id` `{ name }` → `{ org }` — admin/owner.
- `GET /orgs/:id/members` → `{ members: OrgMember[] }` — any member.
- `POST /orgs/:id/members` `{ email, role? }` → `{ member }` — admin/owner. The user must already have an Echo account (v1 has no email invites).
- `PATCH /orgs/:id/members/:userId` `{ role }` → `{ member }` — owner only for granting/revoking `owner`; admin+ otherwise. The last owner cannot be demoted.
- `DELETE /orgs/:id/members/:userId` → `{ ok: true }` — admin/owner, or yourself (leave). The last owner cannot be removed.
- `GET /orgs/:id/audit?limit&offset&action` → `AuditListResponse` — admin/owner only; offset max 100,000. Org-scoped events only; personal memories never appear here.

## API keys

- Credential-management endpoints require a dashboard session cookie; bearer API keys cannot list, mint, or revoke credentials.
- `GET /api-keys` → `{ keys: ApiKeyInfo[] }`
- `POST /api-keys` `{ name, sourceApp? }` → `CreateApiKeyResponse` `{ key, secret }` — `secret` is returned exactly once.
- `DELETE /api-keys/:id` → `{ ok: true }` — revoke (kept for audit history).

## Audit (personal)

- `GET /audit?limit&offset&action` → `AuditListResponse` — events where the caller is the actor; offset max 100,000.

## Usage stats

- `GET /stats?range` → `StatsResponse` — home-dashboard numbers. `range` is `24h`, `7d`, `30d` (default), or `90d`. Memory counts cover every scope the caller can read (same boundary as `GET /scopes`); activity counts cover events where the caller is the actor (same boundary as `GET /audit`). The 24h range buckets by hour (ISO instants), the rest by UTC day (`YYYY-MM-DD`); `buckets` lists every bucket in the range so clients don't compute date math.

Note on connected-app read auditing: `memory.recall` and `memory.list` events are written to the API-key owner's audit trail with their filters. When a read returns org-scoped memories, additional per-org events contain only result counts and memory ids—never recall queries or list filters, which can contain personal information.

## MCP

- `POST /mcp` — Streamable HTTP MCP endpoint (stateless). Authenticate with `Authorization: Bearer eck_...`.
- Tools: `remember_context`, `recall_context`, `list_context`, `forget_context`, `list_scopes`.
- Clients that only support stdio can use the locally built bridge in `packages/mcp-bridge`; it is not currently published to npm.
