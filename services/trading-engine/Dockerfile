FROM node:20-slim AS base
RUN corepack enable && corepack prepare pnpm@8.15.0 --activate
WORKDIR /app

# Copy workspace root files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Copy shared packages
COPY packages/ packages/

# Copy this service
COPY services/trading-engine/ services/trading-engine/

# Install all dependencies
RUN pnpm install --frozen-lockfile

# Build shared packages first, then this service
RUN pnpm --filter @providencex/shared-types build && \
    pnpm --filter @providencex/shared-utils build && \
    pnpm --filter @providencex/shared-config build && \
    pnpm --filter @providencex/trading-engine build

EXPOSE 3020
CMD ["node", "services/trading-engine/dist/index.js"]
