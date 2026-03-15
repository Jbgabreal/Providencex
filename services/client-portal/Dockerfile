FROM node:20-slim AS base
RUN corepack enable && corepack prepare pnpm@8.15.0 --activate
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/ packages/
COPY services/client-portal/ services/client-portal/

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @providencex/client-portal build

EXPOSE 3002
CMD ["pnpm", "--filter", "@providencex/client-portal", "start"]
