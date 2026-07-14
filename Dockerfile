FROM oven/bun:1.3-alpine AS build
WORKDIR /app

COPY bun.lock package.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/mcp-bridge/package.json packages/mcp-bridge/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN bun install --frozen-lockfile

COPY . .
RUN bun run build
RUN rm -rf node_modules apps/server/node_modules apps/web/node_modules packages/shared/node_modules packages/mcp-bridge/node_modules \
  && bun install --production --frozen-lockfile --ignore-scripts

FROM oven/bun:1.3-alpine
ENV NODE_ENV=production
WORKDIR /app

COPY --from=build /app/package.json ./package.json
COPY --from=build /app/tsconfig.base.json ./tsconfig.base.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/apps/server/package.json ./apps/server/package.json
COPY --from=build /app/apps/server/tsconfig.json ./apps/server/tsconfig.json
COPY --from=build /app/apps/server/node_modules ./apps/server/node_modules
COPY --from=build /app/apps/server/src ./apps/server/src
COPY --from=build /app/apps/server/drizzle ./apps/server/drizzle
COPY --from=build /app/apps/web/dist ./apps/web/dist

EXPOSE 3246
USER bun
CMD ["bun", "apps/server/src/index.ts"]
