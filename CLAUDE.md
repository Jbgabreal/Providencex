# ProvidenceX - Automated Trading Platform

## Architecture
Monorepo (pnpm workspaces) with 8 services:

| Service | Port | Purpose | Status |
|---------|------|---------|--------|
| `services/trading-engine` | 3020 | Core: strategy, execution, risk, backtesting, copy-trading, billing | Active |
| `services/admin-dashboard` | 3001 | Admin UI: journal, decisions, backtests, engine monitor | Active |
| `services/client-portal` | 3002 | User UI: dashboard, settings, copy-trading, admin page | Active |
| `services/mt5-connector` | 3030 | Python FastAPI bridge to MetaTrader 5 (local Windows + ngrok) | Active |
| `services/api-gateway` | 3000 | Express proxy routing to all services | Active |
| `services/news-guardrail` | 3010 | News event scanning, avoid windows (OpenAI + cron) | Active |
| `services/portfolio-engine` | 3040 | Portfolio management | Scaffolded |
| `services/farming-engine` | 3050 | Yield generation | Scaffolded |

**Shared packages:**
- `packages/shared-types` — TypeScript interfaces (signals, trades, orders, news)
- `packages/shared-utils` — Logger, DateTime (Luxon), custom errors
- `packages/shared-config` — Config loaders for all services

## Tech Stack
- **Backend:** Express + TypeScript, PostgreSQL, Vitest
- **Frontend:** Next.js 14, React 18, TailwindCSS, Radix UI, Recharts, React Query
- **Auth:** Privy (client-portal), password-based (admin-dashboard)
- **Brokers:** MT5 (XM Global) + Deriv (WebSocket)
- **Hosting:** Railway (all services + postgres), Docker
- **Storage:** Cloudinary (trade screenshots)

## Trading Strategy (ICT/SMC)
**Strategy profile:** `first_successful_strategy_from_god`
- **H4:** LuxAlgo swing structure (len=5) → bias direction (bullish/bearish)
- **M15:** MSB (Market Structure Break) + Order Block detection + FVG
- **M1:** Entry confirmation via engulfing/displacement candle
- **SL:** OB edge + buffer (`SL_POI_BUFFER`) | **TP:** M15 swing target (`TP_R_MULT`)
- **Min R:R:** 1.5x | **Risk:** configurable % or fixed USD per trade

**Execution filters (v3):** liquidity sweep, FVG, volume imbalance, premium/discount zone, HTF alignment, BOS, displacement, spread check, confluence score

## Key Files

### Strategy & Execution
| What | Where |
|------|-------|
| SMC Strategy v2 | `trading-engine/src/strategy/v2/SMCStrategyV2.ts` |
| ICT entry model | `trading-engine/src/strategy/ict/ICTEntryService.ts` |
| Execution filter | `trading-engine/src/strategy/v3/ExecutionFilter.ts` |
| Strategy registry | `trading-engine/src/strategies/StrategyRegistry.ts` |
| Strategy adapter | `trading-engine/src/strategies/StrategyAdapter.ts` |
| Live execution | `trading-engine/src/multiaccount/AccountExecutionEngine.ts` |
| Account orchestrator | `trading-engine/src/multiaccount/UserAssignmentOrchestrator.ts` |
| Decision logger | `trading-engine/src/utils/DecisionLogger.ts` |

### Risk & Position Sizing
| What | Where |
|------|-------|
| Per-account risk | `trading-engine/src/multiaccount/PerAccountRiskService.ts` |
| Risk config builder | `trading-engine/src/risk/RiskConfigFromProfile.ts` |
| Kill switch | `trading-engine/src/multiaccount/PerAccountKillSwitch.ts` |
| Open trades tracker | `trading-engine/src/services/OpenTradesService.ts` |
| Exit service | `trading-engine/src/services/ExitService.ts` |
| Loss streak filter | `trading-engine/src/services/LossStreakFilterService.ts` |

### Backtesting
| What | Where |
|------|-------|
| Backtest CLI | `trading-engine/src/backtesting/cli.ts` |
| Backtest runner | `trading-engine/src/backtesting/BacktestRunner.ts` |
| Candle replay | `trading-engine/src/backtesting/CandleReplayEngine.ts` |
| Simulated MT5 | `trading-engine/src/backtesting/SimulatedMT5Adapter.ts` |
| Simulated risk | `trading-engine/src/backtesting/SimulatedRiskService.ts` |
| Data loader | `trading-engine/src/backtesting/HistoricalDataLoader.ts` |
| Backtest types | `trading-engine/src/backtesting/types.ts` |

### Copy-Trading
| What | Where |
|------|-------|
| Orchestrator | `trading-engine/src/copytrading/CopyTradingOrchestrator.ts` |
| Repository | `trading-engine/src/copytrading/CopyTradingRepository.ts` |
| Risk service | `trading-engine/src/copytrading/CopyTradingRiskService.ts` |
| Update propagator | `trading-engine/src/copytrading/CopyTradingUpdatePropagator.ts` |
| Safety guard | `trading-engine/src/copytrading/SafetyGuardService.ts` |
| Signal ingestion | `trading-engine/src/ingestion/` (Telegram/Discord/webhooks) |

### Database & Data
| What | Where |
|------|-------|
| Trade history repo | `trading-engine/src/db/TradeHistoryRepository.ts` |
| Tenant/user repo | `trading-engine/src/db/TenantRepository.ts` |
| Admin repo | `trading-engine/src/admin/AdminRepository.ts` |
| Migrations (v7-v31) | `trading-engine/src/db/migrations/` |

### Frontend
| What | Where |
|------|-------|
| Journal page | `admin-dashboard/app/journal/page.tsx` |
| Journal API | `admin-dashboard/app/api/journal/route.ts` |
| Screenshot API | `admin-dashboard/app/api/journal/screenshots/route.ts` |
| Client admin page | `client-portal/src/app/(protected)/admin/page.tsx` |
| Trading settings | `client-portal/src/components/TradingSettings.tsx` |
| Admin hooks | `client-portal/src/hooks/useAdmin.ts` |
| Journal hooks | `client-portal/src/hooks/useJournal.ts` |

## API Routes (Trading Engine)

### Admin
- `GET /api/v1/admin/metrics/daily` — daily metrics
- `GET /api/v1/admin/decisions` — trade decision log
- `GET /api/v1/admin/exposure` — symbol exposure
- `GET /api/v1/admin/backtests` — backtest results
- `GET /api/v1/admin/engine-status` — engine + feed status
- `POST /api/admin/ops/*` — admin operations (mentors, billing, reviews)
- `*/api/admin/strategy-profiles/*` — strategy profile CRUD

### User
- `GET /api/user/analytics/trades` — trade history
- `GET /api/user/analytics/open-positions` — live positions
- `GET /api/user/analytics/summary` — summary stats
- `GET /api/user/analytics/equity-curve` — equity curve
- `*/api/user/copy-trading/*` — follower subscription management
- `*/api/user/mentor/*` — mentor signal publishing
- `*/api/user/shadow/*` — shadow/simulation mode

### Public
- `GET /api/public/mentors/*` — mentor marketplace
- `GET /api/public/marketplace/*` — leaderboard, badges, reviews

### Business
- `*/api/billing/*` — crypto billing & subscriptions (Free/$29.99/$79.99)
- `*/api/referrals/*` — referral program
- `*/api/notifications/*` — in-app notifications

## Database (PostgreSQL, 31 migrations)
**Core trading:** `executed_trades`, `daily_account_metrics`, `trade_decisions`, `order_events`
**Users & accounts:** `users`, `mt5_accounts`, `strategy_profiles`, `user_strategy_assignments`
**Copy-trading:** `mentor_profiles`, `mentor_signals`, `mentor_signal_updates`, `follower_subscriptions`, `copied_trades`
**Business:** `platform_plans`, `platform_subscriptions`, `mentor_plans`, `referral_profiles`, `referral_commissions`
**Signal import:** `import_signal_sources`, `imported_messages`, `imported_signal_candidates`
**Other:** `news_windows`, `kill_switch_events`, `optimization_runs`, `optimization_results`, `admin_action_logs`

## Running Locally
```bash
pnpm install                    # Install all deps
pnpm dev                        # Start all services in parallel
pnpm test                       # Run all tests (Vitest)
pnpm migrate                    # Run DB migrations
```

## Backtesting
```bash
cd services/trading-engine

# Default (0.5% risk)
pnpm backtest --symbol XAUUSD --from 2025-09-01 --to 2026-03-25 -b 500 --data-source deriv

# Fixed USD risk
pnpm backtest --symbol XAUUSD -b 500 --risk-usd 50 --data-source deriv --from 2025-09-01 --to 2026-03-25

# Custom percentage
pnpm backtest --symbol XAUUSD -b 500 --risk-pct 10 --data-source deriv --from 2025-09-01 --to 2026-03-25

# Output: ./backtests/run_<timestamp>/ → summary.json, trades.csv, equity.json
```

## Optimization Tools
```bash
cd services/trading-engine
pnpm optimize           # AI-powered parameter optimization
pnpm batch-backtest     # Batch backtest multiple configs
pnpm download-history   # Fetch candle history from MT5/Deriv
```

## Railway
- Auto-deploys on push to `main`
- `railway service <name> && railway up --detach` — manual deploy
- `railway service <name> && railway variables set KEY=VALUE` — env vars
- `railway service <name> && railway logs -n 50` — view logs

**URLs:**
- Admin: `admin-dashboard-production-2539.up.railway.app`
- Client: `client-portal-production-e444.up.railway.app`
- MT5: ngrok tunnel (check `MT5_CONNECTOR_URL` env var on trading-engine)

## Risk System
**Flow:** TradingSettings UI → `user_config` JSONB → `UserAssignmentOrchestrator.mergeUserConfig()` → `PerAccountRiskService.calculatePositionSize()`

- `risk_mode: 'percentage'` — X% of balance per trade (max 10%)
- `risk_mode: 'usd'` — fixed $X per trade (max $10,000)

**Guardrail modes:** normal (full risk), reduced (50% risk), blocked (no trades)

**Exit strategies:** break-even, trailing stop, partial close, structure break, time-based, commission-based

## Key Environment Variables
**Core:** `DATABASE_URL`, `PX_TIMEZONE`, `MT5_CONNECTOR_URL`
**Strategy:** `USE_SMC_V2`, `USE_ICT_MODEL`, `ICT_DEBUG`, `SMC_RISK_REWARD`, `TP_R_MULT`, `SL_POI_BUFFER`
**Exec filters:** `EXEC_FILTER_REQUIRE_LIQUIDITY_SWEEP`, `EXEC_FILTER_REQUIRE_FVG`, `EXEC_FILTER_REQUIRE_DISPLACEMENT`, `EXEC_FILTER_MIN_CONFLUENCE_SCORE`
**Risk:** `LOW_RISK_MAX_DAILY_LOSS`, `LOW_RISK_MAX_TRADES`, `PER_ACCOUNT_MAX_SPREAD_PIPS`
**Auth:** `PRIVY_APP_ID`, `ADMIN_PASSWORD`, `AUTH_DEV_MODE`
**Market:** `MARKET_FEED_INTERVAL_SEC`, `MARKET_SYMBOLS`
**Cloudinary:** `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`

## Rules
- ALWAYS implement admin features on BOTH admin-dashboard AND client-portal /admin page
- ALWAYS backtest before committing strategy changes
- Research ICT concepts thoroughly before modifying strategy logic — don't guess
- Journal CSV bundled in `admin-dashboard/data/` and `trading-engine/backtests/`
- Backtest benchmark: $500 start, $50/trade fixed risk, Sep-Mar → $27,635 (3.58 PF, 41.4% WR)
