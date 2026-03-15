FROM node:20-slim AS base
RUN corepack enable && corepack prepare pnpm@8.15.0 --activate
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/ packages/
COPY services/api-gateway/ services/api-gateway/

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @providencex/shared-types build && \
    pnpm --filter @providencex/shared-utils build && \
    pnpm --filter @providencex/shared-config build && \
    pnpm --filter @providencex/api-gateway build

EXPOSE 3000
CMD ["node", "services/api-gateway/dist/index.js"]
