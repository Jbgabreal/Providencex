# ProvidenceX — Trading Engine v1 PRD

**Service Name:** `trading-engine`  
**Location:** `/services/trading-engine` in monorepo  
**Version:** v1  
**Status:** Ready for implementation via Cursor  
**Primary Goals:**  
- Generate valid trade setups using SMC v1 logic  
- Use News Guardrail to avoid high-risk windows  
- Apply conservative risk controls  
- Send trade instructions to MT5 Connector  
- Log every decision for transparency  

---

## 1. Overview

The Trading Engine determines when a valid trade exists and when to send a trade instruction to the MT5 Connector.

It must:

1. Analyze market structure (SMC)
2. Respect news-based avoid windows (from News Guardrail)
3. Apply risk constraints (daily loss limits, trade limits, max exposure)
4. When allowed → create a TradeRequest
5. Send to MT5 Connector, wait for confirmation
6. Record every decision (for audit + transparency)

This version is purposely conservative.

**Symbols (supported in v1):**

- `XAUUSD` (primary)
- `EURUSD`
- `GBPUSD`
- `US30`

**Timeframes (v1):**

- HTF (Higher Timeframe): `H1`  
- LTF (Lower Timeframe): `M5`

---

## 2. Strategy Logic (SMC v1)

This is a simplified but powerful Smart Money Concepts framework.

The strategy must detect:

### 2.1 HTF Trend Direction (`H1`)

The engine must classify market trend using:

- HH/HL structure for bullish  
- LH/LL structure for bearish  
- Consolidation if unclear  

Result stored as:

```ts
type TrendDirection = "bullish" | "bearish" | "sideways";
```

### 2.2 LTF Confirmation (`M5`)

On lower timeframe:

- Identify CHoCH or BOS aligned with HTF trend  
- Identify Order Block (OB) that caused the break:
  - Bullish: last down candle before breakout  
  - Bearish: last up candle before breakout  

### 2.3 Liquidity Sweep Check

Before the OB revisit:

- Engine checks if price swept liquidity above/below previous swing.

### 2.4 Entry Trigger

Entry is valid when **all** are true:

| Requirement     | Description                                 |
|-----------------|---------------------------------------------|
| HTF trend       | Clear bullish or bearish                    |
| BOS/CHoCH       | LTF confirms direction                      |
| OB found        | Valid, fresh, unmitigated OB                |
| Liquidity sweep | Sweep of previous swing before entry        |
| Spread acceptable | Spread below configured maximum           |
| No avoid window active | News Guardrail approval              |

### 2.5 Stop Loss & Take Profit

Use structure-based SL:

- Bullish: SL at OB low  
- Bearish: SL at OB high  

TP options:

1. Fixed RR 1:2 (default for v1)  
2. (Future) Next major HTF swing  
3. (Future) Configurable RR per strategy  

### 2.6 Position Sizing

Use risk parameter (default 1% per trade), but modify by strategy.

#### 2.6.1 Low-Risk Strategy (Capital Preservation)

- Max risk per trade: **0.5%** of account equity  
- Max losses per day: **2**  
- Max trades per day: **2**  
- No trades during any window where `risk_score ≥ 30`  
- No trades if a window with `risk_score ≥ 70` starts within the next 45 minutes

#### 2.6.2 High-Risk but Conservative Strategy

- Max risk per trade: **1–1.5%** of account equity (configurable)  
- Reduced-risk mode if current or upcoming window has `risk_score` in `[50, 79]`:
  - Risk per trade reduced to **0.5%**  
- Hard block if:
  - Active window has `risk_score ≥ 80`, or  
  - A window with `risk_score ≥ 90` starts within the next 30 minutes  

---

## 3. Guardrail Integration

The Trading Engine must call the News Guardrail API before placing any trade:

```http
GET /can-i-trade-now?strategy={low|high}
```

Expected response shape (example):

```ts
{
  can_trade: boolean;
  mode: "normal" | "reduced" | "blocked";
  active_windows: NewsWindow[];
  reason_summary: string;
}
```

### 3.1 Engine Behavior by Mode

- `blocked` → **Do not trade.**  
- `reduced` → Trade only if signal is very clean; reduce risk per trade.  
- `normal` → Trade if strategy conditions and risk rules permit.

The Trading Engine must **log the guardrail decision** with each trade decision, even when skipping a trade.

---

## 4. Architecture

### 4.1 Folder Structure

```text
services/trading-engine/
  ├─ src/
  │   ├─ server.ts
  │   ├─ routes/
  │   │   ├─ health.ts
  │   │   ├─ simulateSignal.ts
  │   ├─ services/
  │   │   ├─ MarketDataService.ts
  │   │   ├─ StrategyService.ts
  │   │   ├─ RiskService.ts
  │   │   ├─ GuardrailService.ts
  │   │   ├─ ExecutionService.ts
  │   ├─ utils/
  │   ├─ types/
  │   └─ config/
  ├─ test/
  ├─ LOG.md
  ├─ README.md
```

---

## 5. Core Modules

### 5.1 MarketDataService

**Responsibility:** Provide OHLC data per symbol and timeframe.

v1 options (choose simplest to implement fast):

- Use a synthetic/hardcoded data feed for development.  
- Provide a method like:

```ts
getRecentCandles(symbol: string, timeframe: Timeframe, limit: number): Promise<Candle[]>;
```

Types:

```ts
type Timeframe = "M1" | "M5" | "M15" | "H1" | "H4";

interface Candle {
  timestamp: string; // ISO
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}
```

### 5.2 StrategyService

Implements SMC v1 logic. Core responsibilities:

- Determine HTF market structure and trend.  
- On LTF, detect BOS/CHoCH events.  
- Identify and validate order blocks.  
- Confirm liquidity sweeps before OB entry.  
- Generate trade signals when all conditions align.

API:

```ts
interface TradeSignal {
  symbol: string;
  direction: "buy" | "sell";
  entry: number;
  stopLoss: number;
  takeProfit: number;
  reason: string;      // explanation of pattern
  meta?: Record<string, any>;
}

class StrategyService {
  generateSignal(symbol: string): Promise<TradeSignal | null>;
}
```

If conditions are not clean, return `null`.

### 5.3 GuardrailService

Thin client around News Guardrail API.

```ts
interface GuardrailDecision {
  can_trade: boolean;
  mode: "normal" | "reduced" | "blocked";
  active_windows: NewsWindow[];
  reason_summary: string;
}

class GuardrailService {
  async getDecision(strategy: "low" | "high"): Promise<GuardrailDecision>;
}
```

### 5.4 RiskService

Handles risk constraints per strategy:

- Daily loss cap  
- Max trades per day  
- Position sizing  

Key methods:

```ts
interface RiskContext {
  strategy: "low" | "high";
  account_equity: number;
  today_realized_pnl: number;
  trades_taken_today: number;
}

class RiskService {
  getPositionSize(riskContext: RiskContext, stopLossPips: number): number;
  canTakeNewTrade(riskContext: RiskContext): { allowed: boolean; reason?: string };
}
```

In reduced mode, RiskService must apply lower risk percentage automatically.

### 5.5 ExecutionService

Sends trade instructions to MT5 Connector.

```ts
interface ExecutionResult {
  success: boolean;
  ticket?: string | number;
  error?: string;
}

class ExecutionService {
  async openTrade(signal: TradeSignal, lotSize: number, strategy: "low" | "high"): Promise<ExecutionResult>;
}
```

This service:

- Builds `TradeRequest` payload.  
- Calls `POST {MT5_CONNECTOR_URL}/api/v1/trades/open`.  
- Logs success or failure.

---

## 6. Endpoints

### 6.1 `GET /health`

- Returns `{ status: "ok", service: "trading-engine" }`

### 6.2 `POST /simulate-signal`

Debug/testing endpoint. Accepts a payload overriding:

- `symbol`  
- `strategy` (`low` or `high`)  
- Optional fake candles/market state  

Flows through:

- GuardrailService  
- RiskService  
- StrategyService (or mocked logic)  
- ExecutionService (can be stubbed in dev mode)

---

## 7. Decision Loop (Tick Engine)

A tick or cron job will periodically (e.g. every 30–60 seconds):

1. For each configured symbol:
   - Fetch recent candles from MarketDataService.
   - Ask StrategyService for a `TradeSignal` (if any).

2. If `TradeSignal` exists:
   - Call GuardrailService for selected strategy.  
   - If `can_trade = false` or `mode = "blocked"` → log & skip.  
   - If allowed:
     - Use RiskService to confirm trade and compute lot size.  
     - If `canTakeNewTrade` = false → log & skip.  
     - Else → call ExecutionService to send trade.

3. Log the decision, including:
   - Symbol, strategy, guardrail mode, signal reason, decision (`trade` or `skip`).

This tick engine can be implemented inside `server.ts` using `setInterval` for v1, or `node-cron`.

---

## 8. Data Models

### 8.1 TradeDecisionLog

```ts
interface TradeDecisionLog {
  id?: string;
  timestamp: string;
  symbol: string;
  strategy: "low" | "high";
  guardrail_mode: "normal" | "reduced" | "blocked";
  guardrail_reason: string;
  decision: "trade" | "skip";
  risk_reason?: string;
  signal_reason?: string;
  risk_score?: number | null; // from active window, if any
  trade_request?: {
    direction: "buy" | "sell";
    entry: number;
    stopLoss: number;
    takeProfit: number;
    lotSize: number;
  } | null;
  execution_result?: {
    success: boolean;
    ticket?: string | number;
    error?: string;
  } | null;
}
```

v1 can store logs in:

- A simple Postgres table, or  
- A file-based logger (JSON lines).

---

## 9. Fail-Safe Rules (Mandatory)

The Trading Engine **must** enforce:

1. If News Guardrail returns `can_trade = false` → **do not trade.**  
2. If active `risk_score ≥ 80` (from any window) → **block trading** regardless of strategy.  
3. If `today_realized_pnl <= -max_daily_loss` for that strategy → **stop trading for the day**.  
4. If `trades_taken_today >= max_trades_per_day` → **stop opening new trades**.  
5. If spread (once integrated) > `MAX_SPREAD` → skip trade.  
6. If there is no clear HTF trend (`sideways`) → skip trade.  
7. If OB is invalid/mitigated → skip trade.  
8. All errors from MT5 Connector must be caught and logged; do not retry blindly in tight loops.

---

## 10. Environment Variables

Example `.env` entries:

```bash
PORT=3020

NEWS_GUARDRAIL_URL=http://news-guardrail:3010
MT5_CONNECTOR_URL=http://mt5-connector:3030

LOW_RISK_MAX_DAILY_LOSS=1.0        # percent of equity
LOW_RISK_MAX_TRADES=2

HIGH_RISK_MAX_DAILY_LOSS=3.0       # percent of equity
HIGH_RISK_MAX_TRADES=4

DEFAULT_LOW_RISK_PER_TRADE=0.5     # percent
DEFAULT_HIGH_RISK_PER_TRADE=1.5    # percent

MAX_SPREAD=0.8                     # example value for FX/gold
SMC_TIMEFRAMES=H1,M5
TICK_INTERVAL_SECONDS=60
```

The `config` module should expose these in a typed way.

---

## 11. Acceptance Criteria (for v1)

The Trading Engine v1 is considered complete when:

1. The folder and module structure matches this PRD.  
2. Service starts with `pnpm --filter trading-engine dev` and `/health` works.  
3. `GuardrailService` successfully calls the News Guardrail API and handles different `mode`s.  
4. `StrategyService` implements deterministic SMC v1 logic (even if using mock candles).  
5. `RiskService` correctly enforces per-strategy limits and computes position size.  
6. `ExecutionService` correctly builds and sends `TradeRequest` to MT5 Connector (can be stubbed or use a mock endpoint in dev).  
7. The tick loop runs on an interval and logs decisions even when skipping trades.  
8. `TradeDecisionLog` entries are created for each evaluated symbol on each tick.  
9. README explains how to configure env, start the service, and run a simple simulation.  
10. `LOG.md` for the trading-engine service is updated with implementation steps and decisions.
