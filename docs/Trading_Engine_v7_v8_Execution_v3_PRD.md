# ProvidenceX — Trading Engine v7/v8 + Execution v3

## Part 1 — PRD

### 0. Context

Current ProvidenceX state (as of 2025-11-20):

- News Guardrail: ✅ live, real data, `/can-i-trade-now`
- Trading Engine v1–v5: ✅
  - v1: SMC v1 strategy, tick loop, DecisionLogger
  - v2: Market data (PriceFeedClient, CandleBuilder, CandleStore)
  - v3: ExecutionFilter (multi-timeframe & SMC confirmations)
  - v4: Exposure (OpenTradesService + `/status/exposure`)
  - v5: Backtesting framework
- Admin Dashboard: ✅ overview, decisions, exposure, backtests
- MT5 Connector: ✅ real execution, `/price`, `/open-positions`
- DB: `trade_decisions`, `daily_news_windows`, `backtest_*`, etc.

**Gaps:**

- No persistent **live PnL tracking** (trade-level & equity curve)
- No **PnL-based kill switch**
- No full **order lifecycle** tracking from MT5 events

This PRD defines:

- **Trading Engine v7** — Live PnL Tracking
- **Trading Engine v8** — PnL-based Kill Switch
- **Execution v3** — Order Lifecycle Tracking

All new features must be:

- Safe by default (if something fails → engine continues but falls back conservatively)
- Backward compatible (existing flows continue to work)
- Observable via DB + Admin Dashboard

---

## 1. Trading Engine v7 — Live PnL Tracking

### 1.1 Goals

1. Track **realized PnL** per trade from live trading.
2. Maintain **live equity curve** (balance, equity, drawdown).
3. Provide data to dashboard and kill-switch logic.
4. Use MT5 as the **single source of truth** for financial results.

### 1.2 Data Model

#### 1.2.1 `live_trades` table

New table to store **closed live trades** (1 row per completed trade).

```sql
CREATE TABLE IF NOT EXISTS live_trades (
  id                BIGSERIAL PRIMARY KEY,
  mt5_ticket        BIGINT NOT NULL,
  mt5_position_id   BIGINT,                     -- if different from ticket
  symbol            VARCHAR(20) NOT NULL,
  strategy          VARCHAR(32),                -- e.g. 'low', 'high'
  direction         VARCHAR(4) NOT NULL,        -- 'buy' | 'sell'
  volume            DOUBLE PRECISION NOT NULL,  -- lots
  entry_time        TIMESTAMPTZ NOT NULL,
  exit_time         TIMESTAMPTZ NOT NULL,
  entry_price       DOUBLE PRECISION NOT NULL,
  exit_price        DOUBLE PRECISION NOT NULL,
  sl_price          DOUBLE PRECISION,
  tp_price          DOUBLE PRECISION,
  commission        DOUBLE PRECISION DEFAULT 0,
  swap              DOUBLE PRECISION DEFAULT 0,
  profit_gross      DOUBLE PRECISION NOT NULL,  -- before commission/swap
  profit_net        DOUBLE PRECISION NOT NULL,  -- after commission/swap
  magic_number      BIGINT,
  comment           TEXT,
  closed_reason     VARCHAR(32),                -- 'tp', 'sl', 'manual', 'partial', 'breakeven', 'unknown'
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_live_trades_symbol_time
  ON live_trades(symbol, exit_time);

CREATE INDEX IF NOT EXISTS idx_live_trades_strategy_time
  ON live_trades(strategy, exit_time);
1.2.2 live_equity table
Stores equity/balance snapshots over time.

sql
Copy code
CREATE TABLE IF NOT EXISTS live_equity (
  id                  BIGSERIAL PRIMARY KEY,
  timestamp           TIMESTAMPTZ NOT NULL,
  balance             DOUBLE PRECISION NOT NULL,
  equity              DOUBLE PRECISION NOT NULL,
  floating_pnl        DOUBLE PRECISION NOT NULL,
  closed_pnl_today    DOUBLE PRECISION NOT NULL,
  closed_pnl_week     DOUBLE PRECISION NOT NULL,
  max_drawdown_abs    DOUBLE PRECISION NOT NULL,
  max_drawdown_pct    DOUBLE PRECISION NOT NULL,
  comment             TEXT,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_live_equity_timestamp
  ON live_equity(timestamp);
Note: closed_pnl_today/week and drawdowns can be computed at write time using live_trades plus previous live_equity rows.

1.3 MT5 Connector Extensions (supporting v7 & v6)
We need MT5 Connector to provide account summary and completed deal info.

1.3.1 New endpoint: GET /api/v1/account-summary
Response (example):

json
Copy code
{
  "success": true,
  "balance": 10000.00,
  "equity": 10050.25,
  "margin": 120.10,
  "free_margin": 9930.15,
  "margin_level": 8360.1,
  "currency": "USD"
}
This is used for:

live_equity snapshots

kill-switch trigger thresholds (PnL & drawdown)

1.3.2 Order events support
Details in Section 3 (Execution v3). v7 will consume these events.

1.4 Engine Logic — Live PnL
1.4.1 New Service: LivePnlService
Responsibilities:

Listen to order lifecycle events (see Section 3).

For each trade closure event:

Compute realized profit_gross, profit_net (or get from MT5 event).

Insert row into live_trades.

Periodically (e.g. every LIVE_EQUITY_SNAPSHOT_INTERVAL_SEC, default 60s):

Query account-summary from MT5 Connector.

Compute:

closed_pnl_today (sum profit_net from live_trades for today).

closed_pnl_week (sum for current ISO week).

max_drawdown_abs and % (based on equity history).

Insert new row into live_equity.

Configuration (via environment or shared-config):

ts
Copy code
export interface LivePnlConfig {
  equitySnapshotIntervalSec: number;   // default: 60
  timezone: string;                    // e.g. 'America/New_York'
}
1.4.2 Integration Points
Initialize LivePnlService on Trading Engine startup.

Ensure shutdown awaits its timers/intervals.

Service must tolerate:

Temporary MT5/DB errors (retry/backoff, log, but do not crash engine).

1.5 Admin API Extensions
New endpoints on Trading Engine:

GET /api/v1/admin/live-trades

Pagination + filters (symbol, strategy, date range).

GET /api/v1/admin/live-equity

Returns latest N points or date range.

Admin dashboard can use these in future (out of scope for this PRD, but endpoints must be ready).

2. Trading Engine v8 — PnL-Based Kill Switch
2.1 Goals
Automatically pause trading when risk limits are breached.

Record kill-switch activations and reasons in DB.

Ensure behavior is deterministic and transparent (logs + dashboard).

2.2 Kill Switch Conditions
The kill switch can trigger if any of these are true:

Daily drawdown limit breached

Equity drawdown from today’s high > configured amount or %

Weekly drawdown limit breached

Too many losing trades in a row

Max daily trades exceeded

Max weekly trades exceeded

Spread > configured max at decision time

Exposure too high, based on v4 exposure snapshot

MT5 Connector unhealthy (e.g. repeated failures from /price or /open-positions)

2.3 Configuration
Extend shared config with KillSwitchConfig:

ts
Copy code
export interface KillSwitchConfig {
  enabled: boolean;

  dailyMaxLossCurrency?: number;      // e.g. 300
  dailyMaxLossPercent?: number;       // e.g. 3 (of starting equity)
  weeklyMaxLossCurrency?: number;
  weeklyMaxLossPercent?: number;

  maxLosingStreak?: number;           // e.g. 5
  maxDailyTrades?: number;            // total trades
  maxWeeklyTrades?: number;

  maxSpreadPoints?: number;           // per symbol or global default
  maxExposureRiskCurrency?: number;   // combined estimated risk (from v4)

  autoResumeNextDay: boolean;         // reset at daily session boundary
  autoResumeNextWeek: boolean;        // reset at week boundary
}
This may be made per-symbol in future, but v8 can start global (with optional symbol overrides).

2.4 Data Model
Extend trade_decisions:

sql
Copy code
ALTER TABLE trade_decisions
  ADD COLUMN IF NOT EXISTS kill_switch_active boolean,
  ADD COLUMN IF NOT EXISTS kill_switch_reasons jsonb;
Kill-switch state should also be stored in memory and persisted:

New table: kill_switch_events

sql
Copy code
CREATE TABLE IF NOT EXISTS kill_switch_events (
  id              BIGSERIAL PRIMARY KEY,
  timestamp       TIMESTAMPTZ NOT NULL,
  scope           VARCHAR(32) NOT NULL,     -- 'global' | 'symbol' | 'strategy'
  symbol          VARCHAR(20),
  strategy        VARCHAR(32),
  active          BOOLEAN NOT NULL,
  reasons         JSONB NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
Each time kill switch toggles (activated / cleared), insert a row.

2.5 Engine Logic — KillSwitchService
2.5.1 New service: KillSwitchService
Responsibilities:

Maintain in-memory state:

ts
Copy code
interface KillSwitchState {
  active: boolean;
  reasons: string[];
  activatedAt?: Date;
  scope: 'global'; // (future: 'symbol'/'strategy')
}
On each decision cycle:

Aggregate data from:

live_equity / live_trades → daily/weekly PnL and losing streak

DecisionLogger / trade_decisions → #trades per day/week

OpenTradesService → exposure

Latest tick from PriceFeedClient → spread

Evaluate configured thresholds.

If kill conditions met and not already active:

Set active = true.

Persist kill_switch_events row (active = true).

Log WARN with reasons.

If autoResumeNextDay/Week and boundary crossed:

Clear state, persist kill_switch_events (active = false).

2.5.2 Integration into decision pipeline
In the main decision loop (after:

News guardrail check

Strategy signal

RiskService evaluation

v3 ExecutionFilter

v4 exposure check

…add):

ts
Copy code
const killResult = await killSwitchService.evaluate({
  symbol,
  strategy,
  latestTick,
  exposureSnapshot,
  now
});

if (killResult.blocked) {
  decision = 'skip';
  // Append reasons to risk_reason OR dedicated kill_switch_reasons field
}
trade_decisions.kill_switch_active = killResult.active

trade_decisions.kill_switch_reasons = array of reasons when blocked

2.5.3 Admin API
GET /api/v1/admin/kill-switch

Returns current state + reasons.

POST /api/v1/admin/kill-switch/reset

Manual override: clear kill-switch state (with optional reason).

(Implementation can be simple, but routes should exist.)

3. Execution v3 — Order Lifecycle Tracking
3.1 Goals
Track every stage of every order, from signal to SL/TP/close.

Use MT5 Connector as event source, via webhook.

Feed v7 PnL tracking from these events.

3.2 Event Model
3.2.1 Webhook endpoint
Trading Engine exposes:

POST /api/v1/order-events

MT5 Connector will call this whenever something relevant happens.

3.2.2 Event payload
Example:

json
Copy code
{
  "source": "mt5-connector",
  "event_type": "position_closed",
  "timestamp": "2025-11-21T15:30:12.345Z",
  "ticket": 12345678,
  "position_id": 12345678,
  "symbol": "XAUUSD",
  "direction": "sell",
  "volume": 0.10,
  "entry_time": "2025-11-21T14:00:00.000Z",
  "exit_time": "2025-11-21T15:30:12.000Z",
  "entry_price": 2650.0,
  "exit_price": 2645.5,
  "sl_price": 2652.0,
  "tp_price": 2644.0,
  "commission": -2.50,
  "swap": -0.10,
  "profit": 45.40,
  "reason": "tp",               // 'tp', 'sl', 'manual', 'partial', 'breakeven', 'unknown'
  "comment": "ProvidenceX",
  "magic_number": 123456,
  "raw": { ... }                 // raw MT5 data for debugging (optional)
}
event_type values:

order_sent – engine requested open

order_rejected – MT5 rejected order

position_opened

position_modified

position_closed

sl_hit

tp_hit

partial_close

error

For v7 PnL we primarily need position_closed events (with profit).

3.3 Data Model
3.3.1 order_events table
sql
Copy code
CREATE TABLE IF NOT EXISTS order_events (
  id             BIGSERIAL PRIMARY KEY,
  mt5_ticket     BIGINT NOT NULL,
  position_id    BIGINT,
  symbol         VARCHAR(20) NOT NULL,
  event_type     VARCHAR(32) NOT NULL,
  direction      VARCHAR(4),
  volume         DOUBLE PRECISION,
  timestamp      TIMESTAMPTZ NOT NULL,
  entry_time     TIMESTAMPTZ,
  exit_time      TIMESTAMPTZ,
  entry_price    DOUBLE PRECISION,
  exit_price     DOUBLE PRECISION,
  sl_price       DOUBLE PRECISION,
  tp_price       DOUBLE PRECISION,
  commission     DOUBLE PRECISION,
  swap           DOUBLE PRECISION,
  profit         DOUBLE PRECISION,
  reason         VARCHAR(32),
  magic_number   BIGINT,
  comment        TEXT,
  raw            JSONB,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_order_events_ticket
  ON order_events(mt5_ticket);

CREATE INDEX IF NOT EXISTS idx_order_events_symbol_time
  ON order_events(symbol, timestamp);
3.4 Engine Logic — OrderEventService
New service in Trading Engine:

Responsibilities:

Own the /api/v1/order-events handler.

Validate and normalize event payload.

Insert into order_events.

Notify LivePnlService of relevant events, e.g.:

On position_closed:

Create live_trades row.

Update live_equity snapshot (or schedule immediate update).

Log errors but never crash the engine on bad payloads.

3.5 MT5 Connector Responsibilities
Read config TRADING_ENGINE_ORDER_WEBHOOK_URL.

For each relevant MT5 event (order/position changes):

Construct event payload.

POST to Trading Engine.

Retry with backoff if Trading Engine temporarily unavailable.

If webhook fails consistently:

Log errors clearly (but do NOT block MT5 operations).

The exact mapping from MT5 structures → payload fields will be implemented in Python, but must follow the JSON shape above.

4. Non-Functional Requirements
Backward compatible

If MT5 webhook is not configured → engine still trades, live PnL & order_events simply remain empty.

If live_equity or live_trades tables are missing → engine should log errors and continue, not crash.

Kill switch must be enabled: false by default until configuration is explicitly turned on.

Logging

All new services must use existing logger utilities.

Log key transitions:

kill switch activation / reset

order event received & stored

live trade inserted

equity snapshot written

Testing

Add unit tests for KillSwitchService, LivePnlService, and OrderEventService where feasible.

Add at least one integration test that simulates:

A trade decision → MT5 “position_closed” event → live_trades row → kill switch condition.

Documentation

Update services/trading-engine/README.md with:

v7 Live PnL description

v8 Kill Switch description

Execution v3 order events

Add/extend docs/Trading_Engine_v7_v8_Execution_v3_PRD.md with this PRD content (or reference)