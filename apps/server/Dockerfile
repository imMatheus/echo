# Server only (API + MCP). The dashboard deploys separately to Vercel.
#
# BUILD CONTEXT MUST BE THE REPOSITORY ROOT — this Dockerfile copies the
# workspace lockfile and packages/shared, which live above apps/server:
#   docker build -f apps/server/Dockerfile .
# (run from the repo root, note the trailing ".").

FROM oven/bun:1-slim
WORKDIR /app

# Install production dependencies. Bun workspaces validate the frozen lockfile
# against every package manifest, so all four are copied even though the filter
# only installs what the server needs.
COPY package.json bun.lock tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/mcp-bridge/package.json packages/mcp-bridge/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN bun install --frozen-lockfile --production --filter @echo/shared --filter @echo/server

# Bun runs the TypeScript directly — no build step. @echo/shared is consumed
# from source, so its src is copied alongside the server's.
COPY packages/shared/src packages/shared/src
COPY apps/server/tsconfig.json apps/server/
COPY apps/server/src apps/server/src
COPY apps/server/drizzle apps/server/drizzle

ENV NODE_ENV=production \
  HOST=0.0.0.0 \
  PORT=8080

EXPOSE 8080
USER bun
CMD ["bun", "apps/server/src/index.ts"]
