FROM node:20-slim AS base
RUN corepack enable && corepack prepare pnpm@8.15.0 --activate
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/ packages/
COPY services/client-portal/ services/client-portal/

RUN pnpm install --frozen-lockfile

# Next.js needs NEXT_PUBLIC_ vars at build time
ARG NEXT_PUBLIC_PRIVY_APP_ID
ARG NEXT_PUBLIC_BACKEND_BASE_URL
ARG NEXT_PUBLIC_DEV_MODE
ENV NEXT_PUBLIC_PRIVY_APP_ID=$NEXT_PUBLIC_PRIVY_APP_ID
ENV NEXT_PUBLIC_BACKEND_BASE_URL=$NEXT_PUBLIC_BACKEND_BASE_URL
ENV NEXT_PUBLIC_DEV_MODE=$NEXT_PUBLIC_DEV_MODE

RUN pnpm --filter @providencex/client-portal build

EXPOSE 3002
CMD ["pnpm", "--filter", "@providencex/client-portal", "start"]
