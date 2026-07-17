# Deploy: Vercel (dashboard) + Cloud Run (server)

Echo's dashboard and API are separate deployments. The Vite dashboard goes to Vercel; the Fastify API and MCP endpoint go to Google Cloud Run. They talk cross-origin, so the server allows exactly one browser origin (`WEB_ORIGIN`).

## Local development

```bash
cp apps/server/.env.example apps/server/.env
cp apps/web/.env.example apps/web/.env
docker compose --env-file apps/server/.env -f docker-compose.dev.yml up -d
bun install
bun run dev
```

Server on `http://localhost:8080`, dashboard on `http://localhost:5173`.

## Server → Cloud Run

[apps/server/Dockerfile](../apps/server/Dockerfile) builds the server only. It must build with the **repository root as the build context** — it copies the workspace lockfile and `packages/shared`, which live above `apps/server`. The Cloud Run console's "Dockerfile" option uses the Dockerfile's own directory as the context and can't reach those files.

Deploy with a **Cloud Build trigger** on the repository (Configuration → Type = "Cloud Build configuration file"), whose Build step builds from the repo root with the subdirectory Dockerfile:

```bash
docker build -t IMAGE -f apps/server/Dockerfile .
```

The trailing `.` is the build context (the repo root); the default `apps/server` context fails at `COPY bun.lock`. The trigger then pushes the image and runs `gcloud run services update` to roll it out.

That Deploy step only swaps the image on an **existing** service — so create the `echo-server` service once first (public, since the dashboard and MCP clients call it directly, and with the env vars below), then let the trigger take over:

```bash
gcloud run deploy echo-server --image REGION-docker.pkg.dev/PROJECT/REPO/echo-server:latest \
  --region REGION --allow-unauthenticated
```

Cloud Run injects `PORT`; do not set it.

Set these on the service — store the secrets in Secret Manager:

```text
# Secrets
DATABASE_URL=postgresql://.../...   # PlanetScale direct connection (port 5432, NOT pooled 6432)
AUTH_TOKEN_SECRET=<unique 32+ character value>
RESEND_API_KEY=re_...

# Environment
APP_URL=https://app.example.com     # your Vercel dashboard URL (used for CORS, origin validation, email links, and Secure cookies)
TRUST_PROXY=true
COOKIE_SAME_SITE=lax                 # use `none` if the Vercel and Cloud Run domains share no parent domain
EMAIL_PROVIDER=resend
EMAIL_FROM=Echo <auth@example.com>
```

Two Cloud Run correctness notes:

- **CPU always allocated + minimum instances 1.** Echo delivers queued emails, retries failures, and runs hourly cleanup from in-process timers; request-based billing throttles the CPU between requests and scale-to-zero stops the timers entirely.
- **Cap maximum instances** conservatively — each instance opens a pool of up to 10 database connections.

`DATABASE_URL` must be PlanetScale's **direct** connection string (port `5432`): boot-time migrations hold a session advisory lock, which the pooled PgBouncer port (`6432`) cannot support. `sslrootcert=system` in the URL is handled automatically.

## Dashboard → Vercel

Create a Vercel project with **Root Directory** set to `apps/web`. The committed [vercel.json](../apps/web/vercel.json) installs from the monorepo root, builds the shared package and Vite app, and serves the SPA. Set one environment variable to the public Cloud Run URL:

```text
VITE_SERVER_URL=https://<your-cloud-run-service-url>
```

This value is public and compiled into the browser bundle — never put secrets in a `VITE_` variable.
