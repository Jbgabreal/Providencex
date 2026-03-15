FROM node:20-slim AS base
RUN corepack enable && corepack prepare pnpm@8.15.0 --activate
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/ packages/
COPY services/admin-dashboard/ services/admin-dashboard/

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @providencex/admin-dashboard build

EXPOSE 3001
CMD ["pnpm", "--filter", "@providencex/admin-dashboard", "start"]
