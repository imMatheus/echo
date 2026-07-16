# Deploy the web and server separately

Echo's dashboard and API are separate deployments. The Vite dashboard is deployed to Vercel; the Fastify API and MCP endpoint are deployed to Google Cloud Run from the server-only Docker image. No Vercel rewrite or shared static bundle is used.

## Local development

Copy [apps/server/.env.example](../apps/server/.env.example) to `apps/server/.env` and [apps/web/.env.example](../apps/web/.env.example) to `apps/web/.env`. The server file holds database and private server settings; the web file holds only the public `VITE_SERVER_URL`.

```bash
cp apps/server/.env.example apps/server/.env
cp apps/web/.env.example apps/web/.env
docker compose --env-file apps/server/.env -f docker-compose.dev.yml up -d
bun run dev
```

This starts exactly one Fastify server at `http://localhost:8080` and one Vite server at `http://localhost:5173`. To run either process alone, use `bun run dev:server` or `bun run dev:web`.

## Vercel web deployment

Create a Vercel project with **Root Directory** set to `apps/web`. The committed [vercel.json](../apps/web/vercel.json) installs from the monorepo root, builds the shared package and Vite app, publishes `dist`, and preserves React SPA deep links.

Set this Vercel environment variable for every environment:

```text
VITE_SERVER_URL=https://api.example.com
```

Use the public Cloud Run URL or, preferably, a custom API domain. This value is public and compiled into the browser bundle; never put secrets in a `VITE_` variable.

## Cloud Run server deployment

[apps/server/Dockerfile](../apps/server/Dockerfile) builds the Fastify server, its migrations, and the shared package; it does not include web source or a web bundle. It listens on `0.0.0.0` and honors Cloud Run's injected `PORT` value (default `8080`).

Build and publish a Linux `amd64` image from the repository root using your preferred CI or container registry workflow:

```bash
docker buildx build --platform linux/amd64 \
  -f apps/server/Dockerfile \
  -t REGION-docker.pkg.dev/PROJECT_ID/REPOSITORY/echo-server:TAG \
  --push .
```

In the Google Cloud Console, create a Cloud Run service from that image. Make the service public because the browser dashboard and MCP clients call it directly. Cloud Run supplies `PORT`; do not configure it manually.

Set these runtime values on the Cloud Run service:

```text
# Secrets
DATABASE_URL=postgresql://.../...
AUTH_TOKEN_SECRET=<unique 32+ character value>
RESEND_API_KEY=re_...

# Regular environment variables
TRUST_PROXY=true
APP_URL=https://app.example.com
WEB_ORIGIN=https://app.example.com
COOKIE_SAME_SITE=lax
EMAIL_PROVIDER=resend
EMAIL_FROM=Echo <auth@example.com>
```

`DATABASE_URL` is the sole database connection setting. Echo passes it through unchanged for both application traffic and migrations. For PlanetScale Postgres, use the **direct** connection string (port `5432`), not the pooled PgBouncer one (port `6432`): each starting instance serializes migrations with a session advisory lock, which transaction pooling cannot hold. Store credentials such as `DATABASE_URL`, `AUTH_TOKEN_SECRET`, embedding-provider keys, and `RESEND_API_KEY` in Secret Manager, then expose them to the Cloud Run service as environment variables.

Configure the service with **CPU always allocated** (instance-based billing) and **minimum instances: 1**. Echo delivers queued verification and password-reset emails, retries failures, and runs hourly cleanup sweeps from in-process timers; with request-based billing Cloud Run throttles the CPU between requests and those timers stall, and scale-to-zero stops them entirely. Also cap **maximum instances** conservatively (each instance opens a pool of up to 10 direct database connections).

For reliable dashboard sessions, use custom domains under one parent domain, such as `app.example.com` on Vercel and `api.example.com` on Cloud Run. Keep `COOKIE_SAME_SITE=lax` in that case. If the Vercel and Cloud Run domains are unrelated, use `COOKIE_SAME_SITE=none`; browsers can still block third-party cookies, so a shared parent domain is strongly recommended.
