FROM node:24.14.1-bookworm-slim AS build
WORKDIR /app
RUN npm install -g pnpm@12.18.0
COPY . .
RUN pnpm install --frozen-lockfile && pnpm build
FROM node:24.14.1-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
ENV HOST=0.0.0.0
COPY --from=build --chown=node:node /app /app
RUN mkdir -p /app/.local/uploads && chown -R node:node /app/.local
USER node
EXPOSE 3000 4000
CMD ["node", "dist/apps/api/src/main.js"]
