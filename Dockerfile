FROM node:22-alpine AS build
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate
WORKDIR /app

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/mcp-bridge/package.json packages/mcp-bridge/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm -r build
RUN pnpm install --prod --frozen-lockfile --ignore-scripts

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app

COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/apps/server/package.json ./apps/server/package.json
COPY --from=build /app/apps/server/node_modules ./apps/server/node_modules
COPY --from=build /app/apps/server/dist ./apps/server/dist
COPY --from=build /app/apps/server/migrations ./apps/server/migrations
COPY --from=build /app/apps/web/dist ./apps/web/dist

EXPOSE 3246
USER node
CMD ["node", "apps/server/dist/index.js"]
