# Trading Engine Change Log

## [2025-11-20] Admin Dashboard v1 + Admin API Implementation

**Added:**
- Admin API endpoints for dashboard monitoring:
  - `GET /api/v1/admin/decisions` - Recent trade decisions with filters and pagination
  - `GET /api/v1/admin/metrics/daily` - Daily aggregate metrics
  - `GET /api/v1/admin/backtests` - Backtest run history
  - `GET /api/v1/status/exposure` - Real-time exposure snapshot (existing v4 endpoint)
- Admin API types in `src/admin/types.ts`
- Admin routes in `src/admin/routes.ts`
- CORS middleware for admin dashboard access
- Database query logic for admin endpoints (reads from `trade_decisions` and `backtest_runs` tables)

**Admin Dashboard:**
- Next.js dashboard app at `services/admin-dashboard/`
- Overview page (`/`) - Daily metrics and summary
- Decisions page (`/decisions`) - Recent trade decisions table with filters
- Exposure page (`/exposure`) - Real-time exposure snapshot (auto-refresh every 10s)
- Backtests page (`/backtests`) - Backtest run history

**Documentation:**
- Updated `services/trading-engine/README.md` with Admin Dashboard section
- Added `services/admin-dashboard/README.md` with setup and usage instructions
- Updated root `README.md` with Admin Dashboard overview

---

## [2025-11-20] Trading Engine v5 Backtesting Implementation

**Added:**
- Complete backtesting and simulation framework
- Historical data loader (CSV, Postgres, mock)
- Simulated MT5 adapter for trade execution
- Simulated risk service for constraints
- Candle replay engine for strategy pipeline replay
- Backtest runner orchestrator
- Backtest result store (Postgres)
- CLI entry point (`pnpm backtest`)
- Unit test scaffolds

**Details:**
- Reuses existing production code (StrategyService, ExecutionFilter, SignalConverter)
- Full v3 & v4 integration (execution filters and exposure limits)
- Comprehensive statistics (win rate, profit factor, drawdown, expectancy)
- Results saved to disk (JSON/CSV) and database (Postgres)

---

## [2025-11-20] Trading Engine v4 Exposure & Concurrency Implementation

**Added:**
- OpenTradesService for real-time open positions tracking
- v4 exposure and concurrency limits in ExecutionFilter
- `/api/v1/status/exposure` endpoint for monitoring
- Per-symbol and global exposure snapshots
- Max concurrent trades (per symbol, per direction, global)
- Max daily risk limits (per symbol, global)

**Details:**
- Polls MT5 Connector `/api/v1/open-positions` every 10 seconds
- Calculates estimated risk based on stop loss distance
- Maintains in-memory snapshots per symbol
- Gracefully handles MT5 Connector unavailability

---

## [2025-11-20] Trading Engine v3 Execution Filter Implementation

**Added:**
- v3 Execution Filter module (`src/strategy/v3/`)
- Multi-confirmation layer before trade execution
- ExecutionFilterState for querying database and MT5
- SignalConverter for v2 to v3 signal transformation
- Execution filter configuration per symbol
- Decision logging with execution filter metadata

**Details:**
- Filters for: HTF trend alignment, BOS/CHOCH, liquidity sweep, displacement, session windows, spread, trade frequency, cooldown
- Feature flag: `USE_EXECUTION_FILTER_V3` (default: true)
- All decisions logged with `execution_filter_action` and `execution_filter_reasons`

---

## [2025-11-20] Trading Engine v2 Market Data Layer Implementation

**Added:**
- Market data layer (`src/marketData/`)
- PriceFeedClient for polling MT5 Connector
- CandleBuilder for aggregating ticks into 1-minute candles
- CandleStore for in-memory candle storage
- Real-time price feed integration

**Details:**
- Polls MT5 Connector `/api/v1/price/{symbol}` every 1 second
- Builds 1-minute OHLC candles from tick data
- Maintains rolling window of last 1000 candles per symbol
- Handles network errors gracefully with retry logic

---

## [2025-11-20] Trading Engine v1 Initial Implementation

**Added:**
- Core Trading Engine service
- SMC v1 strategy logic
- News Guardrail integration
- Risk management
- MT5 Connector integration
- Decision logging (console + Postgres)
- Health and simulate-signal endpoints

**Details:**
- Strategy: HTF trend detection, LTF structure, Order Blocks, liquidity sweeps
- Risk: Two profiles (low/high) with daily limits
- Guardrail: Adjusts risk based on news event risk scores
- Logging: All decisions logged with full context
