# ProvidenceX

> Automated trading platform powered by institutional-grade ICT strategies with multi-broker support.

## Live URLs (Railway)

| Service | URL |
|---------|-----|
| Client Portal | https://client-portal-production-e444.up.railway.app |
| Admin Dashboard | https://admin-dashboard-production-2539.up.railway.app |
| Trading Engine API | https://trading-engine-production-dd29.up.railway.app |
| API Gateway | https://api-gateway-production-43e6.up.railway.app |

## Architecture

```
Client Portal (Next.js) ──→ Trading Engine (Node.js) ──→ Broker Adapters
Admin Dashboard (Next.js)        │                           ├── MT5 (via ngrok tunnel)
                                 │                           └── Deriv (WebSocket API)
                           News Guardrail
                                 │
                            PostgreSQL (Railway)
```

### Services

| Service | Port | Description |
|---------|------|-------------|
| **client-portal** | 3002 | User-facing app: onboarding, trading settings, dashboard |
| **admin-dashboard** | 3001 | Admin monitoring: metrics, decisions, exposure |
| **api-gateway** | 3000 | Proxy to all backend services |
| **trading-engine** | 3020 | Core: ICT strategy, risk management, trade execution |
| **news-guardrail** | 3010 | News event scanner, blocks trading during high-impact events |
| **mt5-connector** | 3030 | Python/FastAPI bridge to MetaTrader 5 terminal (local only) |

### Broker Support (Hybrid Model)

- **MetaTrader 5** — Any MT5 broker (XM, IC Markets, FXTM, etc.) via local connector + ngrok tunnel
- **Deriv** — Direct WebSocket API integration, no local software needed

## Quick Start (Local Development)

```bash
# Install dependencies
pnpm install

# Build shared packages
pnpm --filter './packages/*' build

# Start all services
pnpm dev
```

## MT5 Connector (Required for MT5 Brokers)

The MT5 connector runs on your Windows machine (requires MetaTrader 5 terminal).

**One command to start connector + tunnel:**

```bash
pnpm mt5:tunnel
```

This starts the Python MT5 connector, connects to your MetaTrader 5 terminal, and opens a tunnel at:
```
https://inbond-undisputatiously-arlena.ngrok-free.dev
```

**Prerequisites:**
- MetaTrader 5 terminal installed and running
- Python with `MetaTrader5` package installed
- ngrok installed and authenticated
- MT5 credentials in `.env` (MT5_LOGIN, MT5_PASSWORD, MT5_SERVER)

**Stop:** Press `Ctrl+C`

## Database Migrations

```bash
# Run all migrations against DATABASE_URL
pnpm migrate
```

Migrations are tracked in a `_migrations` table. Running the command multiple times is safe — already-applied migrations are skipped.

## Deploy to Railway

```bash
# Deploy all services
pnpm deploy

# Deploy a single service
railway up --service trading-engine --detach
```

## Environment Variables

### Required (all services)

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `PX_TIMEZONE` | Timezone (default: America/New_York) |

### Trading Engine

| Variable | Description |
|----------|-------------|
| `MT5_CONNECTOR_URL` | MT5 connector URL (ngrok static domain) |
| `NEWS_GUARDRAIL_URL` | News guardrail internal URL |
| `PRIVY_APP_ID` | Privy authentication app ID |
| `USE_ICT_MODEL` | Enable ICT strategy (true/false) |
| `DERIV_APP_ID` | ProvidenceX Deriv App ID (default: 32Irfb5O7IuciwD02q5J1) |

### Client Portal

| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_PRIVY_APP_ID` | Privy app ID (build-time) |
| `NEXT_PUBLIC_BACKEND_BASE_URL` | Trading engine public URL (build-time) |

### MT5 Connector (local .env)

| Variable | Description |
|----------|-------------|
| `MT5_LOGIN` | MT5 account number |
| `MT5_PASSWORD` | MT5 account password |
| `MT5_SERVER` | MT5 broker server name |
| `MT5_PATH` | Path to MT5 terminal executable |

## User Flow

1. **Sign up** via Privy (email) on the client portal
2. **Onboarding wizard**: Connect MT5 or Deriv account → Select strategy → Start trading
3. **Trading settings**: Risk per trade (% or USD), max consecutive losses, session selection (Asian/London/NY)
4. **Dashboard**: Active strategy status, pause/resume, close positions, equity curve
5. **Strategies page**: ICT Sweep & Shift with backtest stats, "How It Works" explanation

## Project Structure

```
providencex/
├── services/
│   ├── client-portal/       # User app (Next.js + Privy auth)
│   ├── admin-dashboard/     # Admin monitoring (Next.js)
│   ├── api-gateway/         # Proxy (Express)
│   ├── trading-engine/      # Core engine (Express + strategy pipeline)
│   ├── news-guardrail/      # News scanner (Express + OpenAI)
│   └── mt5-connector/       # MT5 bridge (Python/FastAPI)
├── packages/
│   ├── shared-types/        # TypeScript types
│   ├── shared-utils/        # Utility functions
│   └── shared-config/       # Configuration loaders
├── scripts/
│   ├── start-mt5-tunnel.sh  # MT5 connector + ngrok tunnel
│   └── migrate.ts           # Database migration runner
└── tsconfig.base.json
```

## ICT Strategy (Sweep & Shift)

The core trading strategy based on ICT (Inner Circle Trader) concepts:

1. **Identify Liquidity** — Finds key highs/lows where stop losses cluster
2. **Wait for Sweep** — Price runs past a key level, trapping retail traders
3. **Confirm Shift** — BOS/CHoCH confirms smart money has reversed
4. **Enter at OTE** — Entry on opposing candle in the 62-79% Fibonacci zone

Backtest results: **85.7% win rate, 6.0 profit factor, 137% return** on XAUUSD M5.

## License

Proprietary — All rights reserved.
