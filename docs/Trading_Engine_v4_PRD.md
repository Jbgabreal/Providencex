# Trading Engine v4 — Real-Time Exposure & Open Trades Aware Risk Layer (PRD)

## 1. Overview

### Goal
Trading Engine v4 makes the system aware of live open trades and real-time risk exposure, so the engine never opens trades blindly. It will:

- Query MT5 Connector for current open positions
- Enforce per-symbol and global trade limits
- Enforce exposure caps (risk per symbol / per day)
- Log clear reasons when trades are blocked due to exposure

This builds directly on:

- v2 Market Data (ticks/candles)
- v3 Execution Filter (session, structure, frequency, spread, etc.)

v4 = Exposure & Open Trades Integration Layer.

## 2. Current State (Before v4)

### ExecutionFilterState
- Connects to Postgres for daily trade count / last trade timestamp.
- Has TODO for open trades integration.

### ExecutionFilter
- Enforces sessions, frequency, spread, distance from daily high/low, etc.
- Uses ExecutionFilterConfig for per-symbol rules.

### DecisionLogger
- Logs execution_filter_action and execution_filter_reasons.

### MT5 Connector
- Is running and handling real trades.
- Trading Engine talks to it via HTTP (MT5 Connector URL in config).

### Gap
Trading Engine does not currently:

- Know how many open trades exist per symbol / strategy.
- Aggregate current exposure per symbol / overall.
- Block trades when exposure is already high / limits hit.

## 3. Scope of v4

### 3.1 In Scope

**Open trades awareness**
- Query the MT5 Connector for current open positions.
- Maintain a light in-memory view of open trades needed for v4 rules.

**Exposure & concurrency rules**
- Per-symbol max concurrent trades (per direction + total).
- Global max concurrent trades across all symbols.
- Per-symbol max daily risk based on SL distance and volume.
- Optional global max daily risk cap.

**Execution Filter integration**
- Extend ExecutionFilter to use open-trades/exposure info before approving a trade.
- If rule fails, return SKIP + structured reasons (e.g., "Max concurrent trades reached for XAUUSD").

**Logging & observability**
- Extend DecisionLogger to include exposure-related reasons.
- Add a lightweight status endpoint for exposure & open-trade view.

**Configuration**
- Extend ExecutionFilterConfig with exposure and concurrency fields.
- Defaults chosen to be conservative and backward compatible.

### 3.2 Out of Scope

- Full backtesting (this is v5).
- PnL analytics & dashboards (basic placeholders allowed, but full reporting is future work).
- Complex portfolio optimization.

## 4. High-Level Design

### 4.1 New Concepts

**Open Trade (from MT5 Connector)**
```typescript
{
  symbol: string;
  ticket: number;
  direction: 'buy' | 'sell';
  volume: number;
  open_price: number;
  sl?: number | null;
  tp?: number | null;
  open_time: string | Date;
}
```

**Exposure Snapshot**
```typescript
{
  symbol: string;
  longCount: number;
  shortCount: number;
  totalCount: number;
  estimatedRiskAmount: number; // Sum of max loss per trade based on SL
  lastUpdated: Date;
}
```

**Global Exposure**
```typescript
{
  totalOpenTrades: number;
  totalEstimatedRiskAmount: number; // Optional
}
```

### 4.2 Data Flow (Per Tick)

1. Strategy generates TradeSignal (v1 / v2 logic).
2. v3 Execution Filter is applied (sessions, structure, spread, etc.).
3. **v4 Exposure & Open Trades Check (new)**:
   - Query cached OpenTradesSnapshot for symbol + global.
   - Evaluate:
     - maxConcurrentTradesPerSymbol
     - maxConcurrentTradesGlobal
     - maxDailyRiskPerSymbol
     - (optional) maxDailyRiskGlobal
   - If any rule fails → SKIP with execution_filter_reason(s).
4. If pass:
   - Trade proceeds to MT5 execution.

## 5. Components & Changes

### 5.1 OpenTradesService (NEW)

**Location:** `services/trading-engine/src/services/OpenTradesService.ts`

**Responsibilities:**
- Poll MT5 Connector for open trades on a short interval (e.g. 5–10s).
- Maintain an in-memory Map<string, ExposureSnapshot> keyed by symbol.
- Provide read-only methods for other components.

**API:**
```typescript
class OpenTradesService {
  constructor(config: { mt5BaseUrl: string; pollIntervalSec?: number });
  
  start(): void;
  stop(): void;
  
  getSnapshotForSymbol(symbol: string): ExposureSnapshot | null;
  getGlobalSnapshot(): GlobalSnapshot;
}
```

**Behavior:**
- Uses an internal timer to call `GET /api/v1/open-positions`.
- Translates broker symbol names to standard names if needed.
- Calculates estimatedRiskAmount per trade:
  - If SL is present: `Math.abs(openPrice - sl) * volume`
  - Otherwise: `defaultRiskEstimate` (configurable fallback, e.g., 50–100 units)

**Errors:**
- On HTTP errors, logs them but does not crash.
- Keeps last known snapshot if MT5 temporarily unavailable.

**Dependency:**
- MT5 Connector exposes endpoint: `GET /api/v1/open-positions`
- Returns array of open position objects.

### 5.2 ExecutionFilterConfig Extension

**File:** `services/trading-engine/src/strategy/v3/types.ts`

Add fields:
```typescript
export interface SymbolExecutionRules {
  // ... existing v3 fields ...
  
  // v4 — exposure / concurrency
  maxConcurrentTradesPerDirection?: number;  // default: 1–2
  maxDailyRiskPerSymbol?: number;            // account currency; optional
}

export interface ExecutionFilterConfig {
  // ... existing fields ...
  
  // v4 Global limits
  maxConcurrentTradesGlobal?: number;        // default: 5–10
  maxDailyRiskGlobal?: number;               // account currency; optional
  exposurePollIntervalSec?: number;          // default: 10
}
```

### 5.3 ExecutionFilter Enhancements

**File:** `services/trading-engine/src/strategy/v3/ExecutionFilter.ts`

**Changes:**
- Inject OpenTradesService (optional parameter for backward compatibility).
- In the main `evaluate()` method, after existing v3 checks pass, run v4 checks:
  - Per-symbol concurrent trades (from real-time snapshot)
  - Per-direction concurrent trades
  - Global concurrent trades
  - Per-symbol daily risk
  - Global daily risk
- If any v4 rule fails, add reason to reasons array.
- Return SKIP if reasons.length > 0.

### 5.4 DecisionLogger Updates

Ensure that when v4 exposure rules cause a skip, the reasons appear in:
- `execution_filter_action = 'SKIP'`
- `execution_filter_reasons` includes all exposure messages

### 5.5 Status Endpoint (Optional but Recommended)

**File:** `services/trading-engine/src/server.ts`

Add endpoint:
```
GET /api/v1/status/exposure
```

Returns:
```json
{
  "success": true,
  "symbols": [
    {
      "symbol": "XAUUSD",
      "longCount": 1,
      "shortCount": 2,
      "totalCount": 3,
      "estimatedRiskAmount": 150.0,
      "lastUpdated": "2025-11-20T20:55:30Z"
    }
  ],
  "global": {
    "totalOpenTrades": 5,
    "totalEstimatedRiskAmount": 260.0,
    "lastUpdated": "2025-11-20T20:55:30Z"
  }
}
```

## 6. Config & Defaults

**File:** `services/trading-engine/src/config/executionFilterConfig.ts`

Example v4 config:
```typescript
XAUUSD: {
  // existing v3 fields...
  maxTradesPerDay: 5,
  minCooldownMinutesBetweenTrades: 15,
  // v4
  maxConcurrentTradesPerSymbol: 2,
  maxConcurrentTradesPerDirection: 1,
  maxDailyRiskPerSymbol: 200, // e.g. $200
},
// Global
maxConcurrentTradesGlobal: 8,
maxDailyRiskGlobal: 500,
exposurePollIntervalSec: 10,
```

If any field is omitted → rule is simply not enforced.

## 7. Acceptance Criteria

### Open trades awareness
- When there are N open XAUUSD trades in MT5, `OpenTradesService.getSnapshotForSymbol('XAUUSD')` reports `totalCount === N`.
- Global snapshot aggregates across all symbols.

### Exposure-based skipping
- When `maxConcurrentTradesPerSymbol = 1` and one XAUUSD trade is already open:
  - Next valid signal for XAUUSD → SKIP.
  - Decision log shows reason mentioning "Max concurrent trades per symbol reached".

### Global concurrency limit
- When `maxConcurrentTradesGlobal = 3` and 3 trades are already open:
  - Any new symbol/strategy attempt → SKIP with appropriate reason.

### Daily risk limit per symbol
- When `maxDailyRiskPerSymbol = 100` and current estimated risk is >= 100:
  - New trade for that symbol is skipped.

### Backward compatibility
- When no v4 fields are set in config:
  - Behavior is identical to v3 (no exposure rules applied).

### Resilience
- If MT5 Connector is temporarily down:
  - Engine continues running.
  - Last known snapshots are used temporarily; errors are logged but no crash.
  - Optionally: conservative fallback (e.g., treat unknown state as "no new trades").

## 8. Documentation

- Add `docs/Trading_Engine_v4_PRD.md` (this doc).
- Update `services/trading-engine/README.md`:
  - Add "Execution Filter v4 — Exposure & Concurrency" section.
  - Explain config fields and status endpoint.
