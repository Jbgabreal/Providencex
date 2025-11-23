# ProvidenceX — Admin Monitoring Dashboard v1

## 1. Context & Goals

We now have:

- MT5 Connector with standardized responses and SL/TP handling
- Trading Engine v2 (market data)
- Trading Engine v3 (execution filter — SMC alignment, sessions, spread, frequency)
- Trading Engine v4 (exposure guardrail + OpenTradesService + /status/exposure)
- Trading Engine v5 (backtesting & simulation framework)

The next step is to give operations and strategy owners a **read-only admin dashboard** to:

1. See **live engine behaviour** in human-friendly form.
2. Inspect **recent trade decisions** and why trades were taken or skipped.
3. Monitor **current exposure** per symbol and globally.
4. (Optional v1.5) View **backtest runs** and results from the v5 framework.

> Important: **All data for the dashboard must come from the database or stable APIs** (no purely in-memory state).  
> - Decisions: `trade_decisions` table  
> - Exposure: `/api/v1/status/exposure` (which itself is based on MT5 + config)  
> - Backtests: `backtest_runs`, `backtest_trades`, `backtest_equity` tables

This doc defines **Admin Dashboard v1** and the backend APIs it needs.

---

## 2. Scope & Non-Scope

### In Scope (v1)

- A **read-only web dashboard** (Next.js app) for internal admin users.
- Three main views:
  1. **Overview**: high-level daily stats & health.
  2. **Decisions**: table of recent `trade_decisions`.
  3. **Exposure**: view of current exposure from `/api/v1/status/exposure`.
- Optional but nice: a basic **Backtests** list page (reading v5 tables).
- New backend **admin endpoints** exposed by the Trading Engine service:
  - `/api/v1/admin/decisions`
  - `/api/v1/admin/metrics/daily`
  - `/api/v1/status/exposure` (already exists, just reuse)
  - `/api/v1/admin/backtests` (read from v5 tables)

### Out of Scope (v1)

- Authentication/authorization (assume internal/VPN for now or basic auth stub).
- Modifying any trading parameters (no write actions).
- Editing strategies, risk limits, or execution filter config.
- Fancy charts for now (simple line/bar charts are enough, no complex analytics).

---

## 3. High-Level Architecture

### 3.1 Components

1. **Admin Dashboard Frontend**
   - A new **Next.js app** in the monorepo:
     - `services/admin-dashboard`  
   - TypeScript, App Router.
   - Tailwind + shadcn/ui for layout and components.
   - Read-only; consumes JSON APIs from the Trading Engine service.

2. **Trading Engine Admin API**
   - New endpoints added to `services/trading-engine` (Node/Express or existing HTTP server).
   - Queries **Postgres** (same DB used by `DecisionLogger` and v5 backtesting).
   - Returns JSON responses for:
     - Recent decisions
     - Daily metrics
     - Exposure snapshot
     - Backtest runs (v5)

3. **Database**
   - Use existing tables:
     - `trade_decisions` (v2/v3/v4)
     - `backtest_runs`, `backtest_trades`, `backtest_equity` (v5)
   - No schema changes are strictly necessary for v1.
   - If useful, we can add a **view** or query for daily aggregates, but v1 can compute on the fly.

---

## 4. Data Sources

### 4.1 Trade Decisions (`trade_decisions`)

Already exists and is populated by `DecisionLogger`.

Key fields (not exhaustive, just what dashboard needs):

- `id` (PK)
- `created_at`
- `symbol`
- `strategy` (low/high)
- `decision` (TRADE / SKIP)
- `guardrail_mode`
- `guardrail_reason`
- `risk_reason`
- `execution_filter_action` (e.g., TRADE / SKIP / null)
- `execution_filter_reasons`
- `entry_price`
- `sl`
- `tp`
- `direction` (buy/sell)
- `raw_signal_json` (optional raw SMC/HTF/LTF metadata)

### 4.2 Exposure Snapshot (`/api/v1/status/exposure`)

Already implemented in v4:

- Per-symbol exposure:
  - symbol
  - longPositionsCount
  - shortPositionsCount
  - estimatedRiskPerDirection
  - totalEstimatedRisk
- Global exposure:
  - totalOpenTrades
  - totalEstimatedRisk

Dashboard will **call this endpoint periodically** (e.g. every 10–15 sec) and render the results.

### 4.3 Backtests (v5 tables)

For optional Backtests page:

- `backtest_runs`:
  - `id`
  - `symbol`
  - `strategy`
  - `from_date`
  - `to_date`
  - `win_rate`
  - `profit_factor`
  - `max_drawdown`
  - `total_trades`
  - `created_at`
- `backtest_trades`, `backtest_equity` (for future details view; v1 only needs summary list).

---

## 5. Backend API Design (Trading Engine)

Add admin endpoints under `services/trading-engine/src/server.ts` (or equivalent).

### 5.1 GET `/api/v1/admin/decisions`

**Purpose:**  
Return recent trade decisions with filters & pagination.

**Query params:**

- `symbol?: string` — e.g. `XAUUSD`
- `strategy?: string` — `low` or `high`
- `decision?: string` — `TRADE` or `SKIP`
- `limit?: number` — default 50, max 500
- `offset?: number` — default 0
- `from?: string` — ISO date/time filter (optional)
- `to?: string` — ISO date/time filter (optional)

**Response:**

```ts
type AdminDecision = {
  id: number;
  created_at: string;
  symbol: string;
  strategy: string;
  decision: 'TRADE' | 'SKIP';
  direction: 'buy' | 'sell' | null;
  guardrail_mode: string | null;
  guardrail_reason: string | null;
  risk_reason: string | null;
  execution_filter_action: string | null;
  execution_filter_reasons: string | null;
  entry_price: number | null;
  sl: number | null;
  tp: number | null;
};

type AdminDecisionsResponse = {
  data: AdminDecision[];
  pagination: {
    limit: number;
    offset: number;
    total?: number; // optional for now
  };
};
5.2 GET /api/v1/admin/metrics/daily
Purpose:
Provide daily aggregate metrics for the Overview page.

Query params:

date?: string — ISO date; default = today (trading engine server date).

Response (example):

ts
Copy code
type DailyMetricsResponse = {
  date: string; // YYYY-MM-DD
  total_decisions: number;
  total_trades: number;
  total_skips: number;
  trades_by_symbol: {
    [symbol: string]: {
      trades: number;
      skips: number;
    };
  };
  trades_by_strategy: {
    [strategy: string]: {
      trades: number;
      skips: number;
    };
  };
  top_skip_reasons: {
    reason: string; // combined guardrail/risk/execution reason
    count: number;
  }[];
  last_updated: string; // ISO
};
Implementation: single SQL query (or a few) aggregating trade_decisions for the given day.

5.3 GET /api/v1/status/exposure (already exists)
No change — just document & ensure response is stable, e.g.:

ts
Copy code
type SymbolExposure = {
  symbol: string;
  longPositions: number;
  shortPositions: number;
  estimatedRiskLong: number;
  estimatedRiskShort: number;
  totalEstimatedRisk: number;
};

type ExposureStatusResponse = {
  symbols: SymbolExposure[];
  global: {
    totalOpenTrades: number;
    totalEstimatedRisk: number;
  };
  lastUpdated: string; // ISO
};
If needed, wrap existing response to this shape without breaking current callers.

5.4 GET /api/v1/admin/backtests (optional v1)
Purpose:
List recent backtest runs for inspection.

Query params:

symbol?: string

strategy?: string

limit?: number (default 20, max 100)

Response:

ts
Copy code
type BacktestRunSummary = {
  id: number;
  symbol: string;
  strategy: string;
  from_date: string;
  to_date: string;
  win_rate: number;
  profit_factor: number;
  max_drawdown: number;
  total_trades: number;
  created_at: string;
};

type BacktestRunsResponse = {
  data: BacktestRunSummary[];
};
6. Admin Dashboard Frontend (Next.js)
6.1 Project Setup
Create new app:

Path: services/admin-dashboard

Tech:

Next.js (App Router, TypeScript)

Tailwind CSS

shadcn/ui components (Card, Table, Badge, Tabs)

Simple config for Trading Engine base URL:

NEXT_PUBLIC_TRADING_ENGINE_BASE_URL (e.g. http://localhost:3020)

6.2 Pages
6.2.1 / — Overview
Sections:

Top summary cards

Today’s date

Total trades vs skips

Number of symbols with activity

Last decision timestamp

Trades by symbol

Simple table:

Symbol | Trades | Skips

Trades by strategy

Table:

Strategy | Trades | Skips

Top skip reasons

List of reasons from top_skip_reasons (guardrail/risk/execution_filter) with counts.

Data source:

GET /api/v1/admin/metrics/daily

6.2.2 /decisions — Recent Decisions
Features:

Table with:

Time

Symbol

Strategy

Decision (TRADE/SKIP) with colored badge

Direction

Guardrail reason

Risk reason

Execution filter reasons

Filters:

Symbol (dropdown)

Strategy (low/high)

Decision (TRADE/SKIP)

Date range (basic: today / last 24h / last 7d)

Pagination:

limit / offset via query params, simple Previous / Next controls.

Data source:

GET /api/v1/admin/decisions

6.2.3 /exposure — Exposure Snapshot
Features:

Global card:

Total open trades

Total estimated risk

Symbol table:

Symbol

Long positions

Short positions

Estimated risk long

Estimated risk short

Total estimated risk

Auto-refresh every 10–15 seconds (client-side polling).

Data source:

GET /api/v1/status/exposure

6.2.4 /backtests — Backtest Runs (optional v1)
Features:

Table:

Created at

Symbol

Strategy

Date range

Win rate

Profit factor

Max drawdown

Total trades

Data source:

GET /api/v1/admin/backtests

7. Non-Functional Requirements
Read-only: no mutation of trading behaviour from this dashboard.

Resilient: UI should handle API errors gracefully (show message, allow retry).

Lightweight: no heavy charts dependencies; simple tables & numeric cards are fine.

Performance:

API calls should be indexed for trade_decisions (indexes on created_at, symbol, strategy).

Limit rows returned (max 500) to avoid huge responses.

8. Future Extensions
Per-strategy performance charts (integrating v5 backtests and live PnL).

Alerting/notifications when exposure exceeds thresholds.

Authentication + roles (viewer, quant, ops).