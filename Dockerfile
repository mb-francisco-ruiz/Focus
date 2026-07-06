# Focus API server (apps/server) — deployed to Railway.
FROM node:22-slim
RUN corepack enable
WORKDIR /app

# Manifests first for layer caching; every workspace package.json must be
# present for a frozen-lockfile install.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/ai/package.json packages/ai/
COPY apps/server/package.json apps/server/
COPY apps/desktop/package.json apps/desktop/
RUN pnpm install --frozen-lockfile --filter "@focus/server..."

COPY packages ./packages
COPY apps/server ./apps/server
RUN pnpm --filter @focus/shared build && pnpm --filter @focus/ai build && pnpm --filter @focus/server build

ENV NODE_ENV=production
CMD ["node", "apps/server/dist/index.js"]
