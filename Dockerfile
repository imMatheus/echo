# syntax=docker/dockerfile:1.4

ARG BUN_VERSION=1.3.9

FROM oven/bun:${BUN_VERSION}-alpine AS base
WORKDIR /app

FROM base AS manifests
COPY bun.lock package.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/mcp-bridge/package.json packages/mcp-bridge/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/

FROM manifests AS development-dependencies
RUN --mount=type=cache,id=echo-bun-cache,target=/root/.bun/install/cache,sharing=locked \
  bun install --frozen-lockfile \
  --filter @echo/shared --filter @echo/server --filter @echo/web

FROM development-dependencies AS build
COPY packages/shared/src packages/shared/src
COPY packages/shared/tsconfig.json packages/shared/tsconfig.json
COPY apps/server/src apps/server/src
COPY apps/server/test apps/server/test
COPY apps/server/drizzle apps/server/drizzle
COPY apps/server/tsconfig.json apps/server/tsconfig.json
COPY apps/web/src apps/web/src
COPY apps/web/index.html apps/web/index.html
COPY apps/web/tsconfig.json apps/web/tsconfig.json
COPY apps/web/vite.config.ts apps/web/vite.config.ts
RUN bun run --filter @echo/shared build \
  && bun run --filter @echo/server --filter @echo/web build

FROM manifests AS production-dependencies
RUN --mount=type=cache,id=echo-bun-cache,target=/root/.bun/install/cache,sharing=locked \
  bun install --production --frozen-lockfile --ignore-scripts \
  --filter @echo/shared --filter @echo/server

FROM base AS runtime
ENV NODE_ENV=production \
  HOST=0.0.0.0 \
  PORT=3246 \
  STATIC_DIR=/app/apps/web/dist

COPY --from=manifests /app/package.json ./package.json
COPY --from=manifests /app/tsconfig.base.json ./tsconfig.base.json
COPY --from=production-dependencies /app/node_modules ./node_modules
COPY --from=build /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/apps/server/package.json ./apps/server/package.json
COPY --from=build /app/apps/server/tsconfig.json ./apps/server/tsconfig.json
COPY --from=production-dependencies /app/apps/server/node_modules ./apps/server/node_modules
COPY --from=build /app/apps/server/src ./apps/server/src
COPY --from=build /app/apps/server/drizzle ./apps/server/drizzle
COPY --from=build /app/apps/web/dist ./apps/web/dist

EXPOSE 3246
STOPSIGNAL SIGTERM
USER bun
CMD ["bun", "apps/server/src/index.ts"]
