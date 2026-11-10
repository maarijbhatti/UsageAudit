FROM node:24.14.1-bookworm-slim AS build
WORKDIR /app
RUN npm install -g pnpm@12.18.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY apps/worker/package.json ./apps/worker/
COPY packages/billing-core/package.json ./packages/billing-core/
COPY packages/config/package.json ./packages/config/
COPY packages/provider-adapters/package.json ./packages/provider-adapters/
COPY packages/shared-types/package.json ./packages/shared-types/
RUN --mount=type=cache,id=usageaudit-pnpm,target=/root/.local/share/pnpm/store pnpm install --frozen-lockfile
COPY . .
RUN pnpm build
FROM node:24.14.1-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
ENV HOST=0.0.0.0
COPY --from=build --chown=node:node /app /app
RUN mkdir -p /app/.local/uploads && chown -R node:node /app/.local
USER node
EXPOSE 3000 4000
CMD ["node", "dist/apps/api/src/main.js"]
