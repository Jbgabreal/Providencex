# ProvidenceX

> **God-aligned, risk-first wealth automation platform** (trading + farming + portfolios)

ProvidenceX is a microservices-based backend platform for automated trading, portfolio management, and farming investment cycles.

## Architecture

This is a **monorepo** containing multiple microservices:

- **news-guardrail** - Daily news risk scanner (ScreenshotOne + OpenAI Vision)
- **trading-engine** - Algorithmic trading engine (SMC + Order Block strategies)
- **mt5-connector** - MT5/MT4 broker integration bridge
- **portfolio-engine** - Investment products and portfolio management
- **farming-engine** - Farming investment cycle management
- **api-gateway** - Single entry point for frontend/external clients

See `docs/ProvidenceX_Full_System_Architecture_and_Master_Prompt.md` for the complete architecture documentation.

## Prerequisites

- Node.js >= 18.0.0
- pnpm >= 8.0.0
- PostgreSQL database
- OpenAI API key
- ScreenshotOne API key (for news-guardrail)

## Setup

### 1. Install Dependencies

```bash
pnpm install
```

### 2. Configure Environment Variables

Copy `.env.example` to `.env` and fill in your values:

```bash
# Copy the example file
cp .env.example .env

# Edit .env with your actual values
```

Required variables:
- `DATABASE_URL` - PostgreSQL connection string
- `OPENAI_API_KEY` - OpenAI API key
- `SCREENSHOTONE_ACCESS_KEY` - ScreenshotOne API key

### 3. Initialize Database

The news-guardrail service will automatically create its database schema on startup. For manual setup:

```bash
# Connect to your PostgreSQL database
psql $DATABASE_URL

# Run the schema (optional - auto-created on startup)
\i services/news-guardrail/src/db/schema.sql
```

### 4. Build Shared Packages

```bash
pnpm --filter './packages/*' build
```

### 5. Start Services

**Option A: Start all services in parallel (development)**

```bash
pnpm dev
```

**Option B: Start services individually**

```bash
# News Guardrail
cd services/news-guardrail
pnpm dev

# Trading Engine
cd services/trading-engine
pnpm dev

# MT5 Connector
cd services/mt5-connector
pnpm dev

# Portfolio Engine
cd services/portfolio-engine
pnpm dev

# Farming Engine
cd services/farming-engine
pnpm dev

# API Gateway
cd services/api-gateway
pnpm dev
```

## Service Ports (Default)

- News Guardrail: `3010`
- Trading Engine: `3020`
- MT5 Connector: `3030`
- Admin Dashboard: `3001` (Next.js)
- Portfolio Engine: `3040`
- Farming Engine: `3050`
- API Gateway: `3000`

## Admin Dashboard

A read-only admin monitoring dashboard is available for the Trading Engine:

- **Overview**: Daily metrics, trades by symbol/strategy, top skip reasons
- **Decisions**: Table of recent trade decisions with filters and pagination
- **Exposure**: Real-time exposure snapshot per symbol and globally (auto-refresh every 10s)
- **Backtests**: History of backtest runs with performance metrics

**Run the dashboard:**
```bash
cd services/admin-dashboard
pnpm install
pnpm dev
```

Dashboard runs on: http://localhost:3001

**Environment Variable:**
```env
NEXT_PUBLIC_TRADING_ENGINE_BASE_URL=http://localhost:3020
```

See [Admin Dashboard README](services/admin-dashboard/README.md) for details.

## Testing Endpoints

### News Guardrail

```bash
# Check if trading is safe
curl http://localhost:3010/can-i-trade-now

# Get today's news map
curl http://localhost:3010/news-map/today

# Manually trigger news scan (dev)
curl -X POST http://localhost:3010/admin/trigger-scan
```

### Trading Engine

```bash
# Health check
curl http://localhost:3020/health

# Simulate signal (test endpoint)
curl -X POST http://localhost:3020/simulate-signal \
  -H "Content-Type: application/json" \
  -d '{"symbol": "XAUUSD"}'
```

### MT5 Connector

```bash
# Health check
curl http://localhost:3030/health

# Open trade (example - currently stubbed)
curl -X POST http://localhost:3030/api/v1/trades/open \
  -H "Content-Type: application/json" \
  -d '{
    "symbol": "XAUUSD",
    "direction": "BUY",
    "entry_type": "MARKET",
    "lot_size": 0.01,
    "stop_loss_price": 2000,
    "take_profit_price": 2100,
    "strategy_id": "smc_v1"
  }'
```

## Project Structure

```
providencex/
├── services/          # Microservices
│   ├── news-guardrail/
│   ├── trading-engine/
│   ├── mt5-connector/
│   ├── admin-dashboard/  # Admin monitoring dashboard (Next.js)
│   ├── portfolio-engine/
│   ├── farming-engine/
│   └── api-gateway/
├── packages/          # Shared packages
│   ├── shared-types/  # TypeScript types
│   ├── shared-utils/  # Utility functions
│   └── shared-config/ # Configuration loaders
├── docs/              # Documentation
│   ├── ProvidenceX_Full_System_Architecture_and_Master_Prompt.md
│   └── ProvidenceX_News_Guardrail_Master_Prompt_and_PRD.md
├── LOG.md             # Build log
├── package.json       # Monorepo config
├── pnpm-workspace.yaml
└── tsconfig.base.json
```

## Development

### Building

```bash
# Build all packages and services
pnpm build

# Build specific package
pnpm --filter @providencex/shared-types build

# Build specific service
pnpm --filter @providencex/news-guardrail build
```

### Adding Dependencies

```bash
# Add to a specific service/package
pnpm --filter @providencex/news-guardrail add express

# Add to root (dev dependencies)
pnpm add -D -w typescript
```

## Implementation Status

### ✅ Phase 1 - Complete
- [x] Monorepo structure
- [x] Shared packages
- [x] News Guardrail (full implementation)

### 🚧 Phase 2 - In Progress
- [x] Trading Engine skeleton
- [x] MT5 Connector skeleton
- [ ] Full strategy implementation
- [ ] Real MT5 integration

### 📋 Phase 3 - Planned
- [ ] Portfolio Engine implementation
- [ ] Farming Engine implementation
- [ ] API Gateway with auth
- [ ] Full integration testing

## Notes

- **News Guardrail**: Fully implemented with cron job, database, and all endpoints
- **Trading Engine**: Service structure complete, strategy logic stubbed (TODOs)
- **MT5 Connector**: Endpoints ready, MT5 integration stubbed (TODOs)
- **Other services**: Basic scaffolding, implementation pending

## License

[Your License Here]

