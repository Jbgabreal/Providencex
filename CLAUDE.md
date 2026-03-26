# ProvidenceX - Automated Trading Platform

## Architecture
Monorepo (pnpm workspaces) with 3 core services:

| Service | Port | Purpose |
|---------|------|---------|
| `services/trading-engine` | 3020 | Core: strategy signals, execution, risk, backtesting |
| `services/admin-dashboard` | 3001 | Admin UI: journal, decisions, backtests, engine monitor |
| `services/client-portal` | 3002 | User UI: dashboard, settings, copy-trading, admin page |
| `services/mt5-connector` | 3030 | Python bridge to MT5 (runs on local Windows + ngrok) |

**Shared packages:** `packages/shared-types`, `packages/shared-utils`, `packages/shared-config`

## Tech Stack
- **Backend:** Express + TypeScript, PostgreSQL
- **Frontend:** Next.js 14, React 18, TailwindCSS, Radix UI, Recharts
- **Auth:** Privy (client-portal), password-based (admin-dashboard)
- **Hosting:** Railway (trading-engine, admin-dashboard, client-portal, postgres)

## Trading Strategy (ICT/SMC)
**Strategy:** "first_successful_strategy_from_god" — automated ICT/SMC entries on XAUUSD
- H4: LuxAlgo swing structure (len=5) for bias direction
- M15: MSB (Market Structure Break) + Order Block detection
- M1: Entry confirmation via engulfing/displacement candle
- SL: OB edge + buffer | TP: M15 swing target | Min R:R: 1.5x
- Risk: configurable % of balance OR fixed USD amount per trade

## Key Files
| What | Where |
|------|-------|
| Strategy logic | `trading-engine/src/strategy/v2/SMCStrategyV2.ts` |
| ICT entry model | `trading-engine/src/strategy/ict/ICTEntryService.ts` |
| Live execution | `trading-engine/src/multiaccount/AccountExecutionEngine.ts` |
| Risk/position sizing | `trading-engine/src/multiaccount/PerAccountRiskService.ts` |
| Risk config from profile | `trading-engine/src/risk/RiskConfigFromProfile.ts` |
| Backtest runner | `trading-engine/src/backtesting/BacktestRunner.ts` |
| Backtest CLI | `trading-engine/src/backtesting/cli.ts` |
| Candle replay engine | `trading-engine/src/backtesting/CandleReplayEngine.ts` |
| Trade history DB | `trading-engine/src/db/TradeHistoryRepository.ts` |
| Decision logger | `trading-engine/src/utils/DecisionLogger.ts` |
| Journal page | `admin-dashboard/app/journal/page.tsx` |
| Journal API | `admin-dashboard/app/api/journal/route.ts` |
| Client admin page | `client-portal/src/app/(protected)/admin/page.tsx` |
| Trading settings UI | `client-portal/src/components/TradingSettings.tsx` |
| User risk merge | `trading-engine/src/multiaccount/UserAssignmentOrchestrator.ts` |

## Running Locally
```bash
pnpm install                    # Install all deps
pnpm dev                        # Start all services

# Individual services
cd services/trading-engine && pnpm dev      # Port 3020
cd services/admin-dashboard && pnpm dev     # Port 3001
cd services/client-portal && pnpm dev       # Port 3002
```

## Backtesting
```bash
cd services/trading-engine

# Percentage-based risk (default 0.5%)
pnpm backtest --symbol XAUUSD --from 2025-09-01 --to 2026-03-25 -b 500 --data-source deriv

# Fixed USD risk
pnpm backtest --symbol XAUUSD --from 2025-09-01 --to 2026-03-25 -b 500 --risk-usd 50 --data-source deriv

# Custom percentage
pnpm backtest --symbol XAUUSD --from 2025-09-01 --to 2026-03-25 -b 500 --risk-pct 10 --data-source deriv
```

## Railway Deployment
- Auto-deploys on push to `main`
- Manual deploy: `railway service <name> && railway up --detach`
- Env vars: `railway service <name> && railway variables set KEY=VALUE`
- Logs: `railway service <name> && railway logs -n 50`

## Railway URLs
- Admin: `admin-dashboard-production-2539.up.railway.app` (pwd: check ADMIN_PASSWORD env var)
- Client: `client-portal-production-e444.up.railway.app`
- MT5 connector: ngrok tunnel (check MT5_CONNECTOR_URL env var on trading-engine)

## Database
PostgreSQL on Railway. Key tables:
- `executed_trades` — trade history with entry_reason, exit_reason, metadata (JSONB)
- `daily_account_metrics` — daily aggregated stats
- `trade_decisions` — every signal evaluation (trade/skip) with full context
- `strategy_profiles` — strategy configs
- `user_strategy_assignments` — user-to-strategy links with `user_config` (JSONB) for risk settings

## Risk System
User risk flows: Client Portal TradingSettings -> user_config JSONB -> UserAssignmentOrchestrator mergeUserConfig() -> PerAccountRiskService calculatePositionSize()

Supports two modes:
- `risk_mode: 'percentage'` — risk X% of balance per trade (max 10%)
- `risk_mode: 'usd'` — risk fixed $X per trade (max $10,000)

## Rules
- ALWAYS implement admin features on BOTH admin-dashboard AND client-portal /admin page
- ALWAYS backtest before committing strategy changes
- Research ICT concepts thoroughly before modifying strategy logic
- Journal CSV data is bundled in both `admin-dashboard/data/` and `trading-engine/backtests/`
- Cloudinary used for trade screenshot storage (env vars on admin-dashboard Railway service)
