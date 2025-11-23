# ProvidenceX — Trading Engine v2 PRD

**Service Name:** `trading-engine`  
**Location:** `/services/trading-engine` in monorepo  
**Version:** v2  
**Status:** Implementation ready  
**Primary Goals:**
- Replace mock/deterministic price data with real-time market feed from MT5 Connector
- Build 1-minute OHLC candles from tick data
- Provide clean API for accessing latest tick and candle data
- Support strategy logic with real market structure analysis

---

## 1. Overview

### 1.1 Purpose

Trading Engine v2 introduces a **real-time market data layer** that replaces the mock price data used in v1. This enables:

- **Real-time price feed** from MT5 Connector via HTTP polling
- **Tick aggregation** into 1-minute candles using OHLC logic
- **In-memory candle store** for fast access by strategy modules
- **Foundation for future enhancements** (multi-timeframe, persistence, analytics)

### 1.2 Relationship to Other Services

**MT5 Connector:**
- Provides live price ticks via `GET /api/v1/price/{symbol}`
- Trading Engine polls this endpoint at configurable intervals

**News Guardrail:**
- Unchanged — Trading Engine still checks news windows before trading
- Market data layer operates independently of guardrail checks

**SMC Strategy (v1):**
- Uses candle data from the market data layer instead of mock data
- Strategy logic remains the same, but operates on real OHLC candles

**Future Services (v3+):**
- Portfolio Engine will consume market data for position management
- Risk Engine can analyze real-time spreads and volatility
- Analytics can build historical patterns from stored candles

---

## 2. Scope (v2)

### 2.1 In-Scope

- **Real-time price feed client** (HTTP polling from MT5 Connector)
- **Tick collector** and 1-second tick stream per symbol
- **1-minute candle builder** per symbol with OHLC aggregation
- **In-memory candle store** (per symbol, rolling window, e.g., last 1000 bars)
- **Basic API in code** to:
  - Get latest tick for a symbol
  - Get latest N candles for a symbol
- **Integration with ExecutionService** to use real prices for trade decisions
- **Symbol resolution** (handles broker-specific names via MT5 Connector)

### 2.2 Out-of-Scope (Future v3+)

- **Persistence to database** (candles stay in-memory for v2)
- **Advanced analytics** (indicators, patterns, backtesting)
- **Multi-timeframe candles** beyond 1-minute (M1 only for v2)
- **External data sources** (non-MT5 feeds, historical data providers)
- **WebSocket/streaming** connections (HTTP polling only for v2)
- **Tick-level storage** (only candles are stored)

---

## 3. Data Model

### 3.1 Tick

Represents a single price update from the broker.

```typescript
interface Tick {
  symbol: string;        // Canonical symbol (e.g., "XAUUSD")
  bid: number;          // Bid price
  ask: number;          // Ask price
  mid: number;          // Mid price ((bid + ask) / 2)
  time: Date;           // Timestamp (ISO format)
}
```

**Source:** MT5 Connector `GET /api/v1/price/{symbol}` response mapped to Tick object.

### 3.2 Candle (1-Minute)

Represents OHLC aggregation over a 1-minute window.

```typescript
interface Candle {
  symbol: string;       // Canonical symbol (e.g., "XAUUSD")
  timeframe: 'M1';      // Timeframe identifier (M1 = 1 minute)
  open: number;         // Opening price (first tick of the minute)
  high: number;         // Highest price (max of high prices in the minute)
  low: number;          // Lowest price (min of low prices in the minute)
  close: number;        // Closing price (last tick of the minute)
  volume: number;       // Tick count for now (can be trade volume in future)
  startTime: Date;      // Start of candle window (minute boundary)
  endTime: Date;        // End of candle window (next minute boundary)
}
```

**Aggregation Rules:**
- `open`: First `mid` price of the minute
- `high`: Maximum `mid` price in the minute
- `low`: Minimum `mid` price in the minute
- `close`: Last `mid` price of the minute
- `volume`: Count of ticks received in the minute

---

## 4. Components

### 4.1 PriceFeedClient

**Purpose:** Polls MT5 Connector for live price ticks.

**Responsibilities:**
- HTTP polling of `GET /api/v1/price/{symbol}` at configurable intervals (default: 1 second)
- Symbol registration (track multiple symbols)
- Error handling and retry logic for network failures
- Tick emission via EventEmitter or callback pattern

**Configuration:**
- `mt5ConnectorUrl`: Base URL for MT5 Connector (e.g., `http://localhost:3030`)
- `pollIntervalSeconds`: Polling interval in seconds (default: 1)
- `symbols`: Array of symbols to track (e.g., `['XAUUSD', 'EURUSD', 'GBPUSD']`)

**Methods:**
```typescript
class PriceFeedClient {
  constructor(config: PriceFeedConfig)
  start(): void
  stop(): void
  registerSymbol(symbol: string): void
  unregisterSymbol(symbol: string): void
  getLatestTick(symbol: string): Tick | undefined
  on(event: 'tick', callback: (tick: Tick) => void): void
}
```

**Error Handling:**
- Log warnings on network errors (don't crash the engine)
- Retry with exponential backoff (max 3 retries per symbol)
- If all retries fail, skip that polling cycle and continue

### 4.2 CandleBuilder

**Purpose:** Aggregates ticks into 1-minute OHLC candles.

**Responsibilities:**
- Subscribe to tick stream from PriceFeedClient
- Maintain "current" candle per symbol
- Update O/H/L/C as ticks arrive within the same minute
- Detect minute boundary transitions
- Close current candle and start new candle on boundary

**Logic:**
```
For each tick:
  1. Determine which minute the tick belongs to (based on tick.time)
  2. If minute changed:
     - Finalize previous candle (if exists)
     - Push to CandleStore
     - Initialize new candle with tick.mid as open
  3. Else (same minute):
     - Update high = max(high, tick.mid)
     - Update low = min(low, tick.mid)
     - Update close = tick.mid
     - Increment volume (tick count)
```

**Methods:**
```typescript
class CandleBuilder {
  constructor(candleStore: CandleStore)
  processTick(tick: Tick): void
  getCurrentCandle(symbol: string): Candle | undefined
}
```

### 4.3 CandleStore

**Purpose:** In-memory storage for candles per symbol.

**Responsibilities:**
- Store candles in a Map structure: `Map<symbol, Candle[]>`
- Maintain rolling window (keep last N candles, e.g., 1000)
- Provide fast access to latest candles

**Storage:**
- Key: Symbol string (e.g., "XAUUSD")
- Value: Array of candles (sorted by time, newest last)

**Methods:**
```typescript
class CandleStore {
  constructor(maxCandlesPerSymbol?: number) // default: 1000
  addCandle(candle: Candle): void
  getLatestCandle(symbol: string): Candle | undefined
  getCandles(symbol: string, limit: number): Candle[]
  getAllCandles(symbol: string): Candle[]
  clear(symbol?: string): void // Clear all or specific symbol
}
```

**Rolling Window:**
- When adding a candle, if the array exceeds `maxCandlesPerSymbol`, remove the oldest candle
- This keeps memory usage bounded while maintaining recent history

---

## 5. API / Interfaces (Code-Level)

### 5.1 TypeScript Interfaces

**Tick Interface:**
```typescript
// services/trading-engine/src/marketData/types.ts
export interface Tick {
  symbol: string;
  bid: number;
  ask: number;
  mid: number;
  time: Date;
}
```

**Candle Interface:**
```typescript
// services/trading-engine/src/marketData/types.ts
export interface Candle {
  symbol: string;
  timeframe: 'M1';
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  startTime: Date;
  endTime: Date;
}
```

### 5.2 Public Classes

**PriceFeedClient:**
```typescript
// services/trading-engine/src/marketData/PriceFeedClient.ts
export class PriceFeedClient {
  constructor(config: {
    mt5ConnectorUrl: string;
    pollIntervalSeconds: number;
    symbols: string[];
  });
  
  start(): void;
  stop(): void;
  registerSymbol(symbol: string): void;
  unregisterSymbol(symbol: string): void;
  getLatestTick(symbol: string): Tick | undefined;
  on(event: 'tick', handler: (tick: Tick) => void): void;
  off(event: 'tick', handler: (tick: Tick) => void): void;
}
```

**CandleBuilder:**
```typescript
// services/trading-engine/src/marketData/CandleBuilder.ts
export class CandleBuilder {
  constructor(candleStore: CandleStore);
  processTick(tick: Tick): void;
  getCurrentCandle(symbol: string): Candle | undefined;
}
```

**CandleStore:**
```typescript
// services/trading-engine/src/marketData/CandleStore.ts
export class CandleStore {
  constructor(maxCandlesPerSymbol?: number);
  addCandle(candle: Candle): void;
  getLatestCandle(symbol: string): Candle | undefined;
  getCandles(symbol: string, limit: number): Candle[];
  getAllCandles(symbol: string): Candle[];
  clear(symbol?: string): void;
}
```

### 5.3 Integration with Existing Services

**ExecutionService:**
```typescript
// services/trading-engine/src/services/ExecutionService.ts
import { CandleStore } from '../marketData/CandleStore';
import { PriceFeedClient } from '../marketData/PriceFeedClient';

class ExecutionService {
  constructor(
    private candleStore: CandleStore,
    private priceFeed: PriceFeedClient,
    // ... other dependencies
  ) {}
  
  async openTrade(signal: TradeSignal): Promise<ExecutionResult> {
    // Use real price from latest tick
    const latestTick = this.priceFeed.getLatestTick(signal.symbol);
    if (!latestTick) {
      logger.warn(`No price data for ${signal.symbol}, aborting trade`);
      return { success: false, error: 'No price data available' };
    }
    
    // Or use latest candle for context
    const latestCandle = this.candleStore.getLatestCandle(signal.symbol);
    logger.info(`Opening trade at price ${latestTick.bid}/${latestTick.ask}, candle close: ${latestCandle?.close}`);
    
    // ... rest of trade execution logic
  }
}
```

**StrategyService:**
```typescript
// services/trading-engine/src/services/StrategyService.ts
import { CandleStore } from '../marketData/CandleStore';

class StrategyService {
  constructor(private candleStore: CandleStore) {}
  
  generateSignal(symbol: string): TradeSignal | null {
    // Get recent candles for analysis
    const candles = this.candleStore.getCandles(symbol, 100);
    if (candles.length < 20) {
      return null; // Not enough data
    }
    
    // Analyze real OHLC candles for SMC signals
    // ... strategy logic
  }
}
```

---

## 6. Configuration

### 6.1 Environment Variables

Add to `.env` (root of monorepo):

```bash
# MT5 Connector URL for price feed
MT5_CONNECTOR_URL=http://localhost:3030

# Market data polling interval (seconds)
MARKET_FEED_INTERVAL_SEC=1

# Symbols to track (comma-separated)
MARKET_SYMBOLS=XAUUSD,EURUSD,GBPUSD
```

### 6.2 Configuration Module

Update `services/trading-engine/src/config/index.ts`:

```typescript
export interface TradingEngineConfig {
  // ... existing fields ...
  
  // Market Data
  mt5ConnectorUrl: string;
  marketFeedIntervalSeconds: number;
  marketSymbols: string[];
}

export function getConfig(): TradingEngineConfig {
  return {
    // ... existing config ...
    
    // Market Data
    mt5ConnectorUrl: process.env.MT5_CONNECTOR_URL || 'http://localhost:3030',
    marketFeedIntervalSeconds: parseInt(process.env.MARKET_FEED_INTERVAL_SEC || '1', 10),
    marketSymbols: (process.env.MARKET_SYMBOLS || 'XAUUSD,EURUSD,GBPUSD').split(',').map(s => s.trim()),
  };
}
```

---

## 7. Implementation Details

### 7.1 File Structure

```
services/trading-engine/src/
├── marketData/
│   ├── types.ts              # Tick, Candle interfaces
│   ├── PriceFeedClient.ts    # HTTP polling client
│   ├── CandleBuilder.ts      # Tick-to-candle aggregation
│   ├── CandleStore.ts        # In-memory candle storage
│   └── index.ts              # Exports
├── services/
│   ├── ExecutionService.ts   # Updated to use market data
│   └── StrategyService.ts    # Updated to use candle store
├── config/
│   └── index.ts              # Updated with market data config
└── server.ts                 # Bootstrap and wire components
```

### 7.2 Bootstrap Flow

```typescript
// services/trading-engine/src/server.ts

async function bootstrap() {
  const config = getConfig();
  
  // Initialize market data layer
  const candleStore = new CandleStore(1000); // Keep last 1000 candles per symbol
  const candleBuilder = new CandleBuilder(candleStore);
  const priceFeed = new PriceFeedClient({
    mt5ConnectorUrl: config.mt5ConnectorUrl,
    pollIntervalSeconds: config.marketFeedIntervalSeconds,
    symbols: config.marketSymbols,
  });
  
  // Wire tick stream to candle builder
  priceFeed.on('tick', (tick) => {
    candleBuilder.processTick(tick);
  });
  
  // Start price feed
  priceFeed.start();
  
  logger.info(`Market data layer started. Tracking symbols: ${config.marketSymbols.join(', ')}`);
  
  // Initialize other services with market data dependencies
  const executionService = new ExecutionService(candleStore, priceFeed, /* ... */);
  const strategyService = new StrategyService(candleStore);
  
  // ... rest of bootstrap
}
```

### 7.3 Error Handling

- **Network errors:** Log warning, skip polling cycle, continue
- **Missing price data:** Log warning, strategy/execution can handle gracefully
- **Invalid candle data:** Skip invalid ticks, don't crash
- **MT5 Connector unavailable:** Retry with exponential backoff, log errors

---

## 8. Acceptance Criteria

### 8.1 Price Feed

✅ For a configured symbol like `XAUUSD`:
- PriceFeedClient calls `GET /api/v1/price/XAUUSD` every second
- Tick objects are produced and logged (at debug level)
- Network errors are handled gracefully without crashing the engine

### 8.2 Candle Building

✅ For tracked symbols:
- CandleBuilder receives ticks and builds 1-minute OHLC candles
- Candles are finalized on minute boundaries
- O/H/L/C values are correctly aggregated from tick.mid prices
- Volume is tracked as tick count per minute

### 8.3 Candle Storage

✅ CandleStore can:
- Return latest candle for a symbol: `getLatestCandle('XAUUSD')`
- Return last N candles: `getCandles('XAUUSD', 100)`
- Maintain rolling window (removes oldest candles when limit exceeded)

### 8.4 Integration

✅ Trading Engine codebase can:
- Import and use market data layer from ExecutionService and StrategyService
- Access latest tick/candle when making trading decisions
- Handle cases where price data is temporarily unavailable

### 8.5 Logging

✅ Logs show:
- When price feed starts and which symbols are tracked
- When candles are closed (symbol, OHLC, startTime)
- Errors and warnings for network issues or missing data

---

## 9. Future Enhancements (v3+)

- **Persistence:** Store candles to database for historical analysis
- **Multi-timeframe:** Build M5, M15, H1, H4, D1 candles from M1 base
- **WebSocket streaming:** Replace HTTP polling with real-time WebSocket feed
- **Historical data loading:** Backfill candles from historical data provider
- **Advanced analytics:** Technical indicators, pattern recognition, backtesting
- **Tick storage:** Store raw ticks for high-frequency analysis
- **External feeds:** Support non-MT5 data sources (e.g., TradingView, other brokers)

---

## 10. Dependencies

- **MT5 Connector:** Must provide `GET /api/v1/price/{symbol}` endpoint
- **Node.js:** HTTP client (axios or node-fetch)
- **EventEmitter:** Built-in Node.js EventEmitter for tick stream
- **TypeScript:** Type definitions for interfaces

---

## 11. Testing

- **Unit tests:** PriceFeedClient, CandleBuilder, CandleStore logic
- **Integration tests:** Full flow from HTTP request → tick → candle → storage
- **Error scenarios:** Network failures, missing symbols, invalid data
- **Performance:** Verify polling doesn't block main trading loop

---

## 12. Rollout Plan

1. **Phase 1:** Implement PriceFeedClient, CandleBuilder, CandleStore (this PRD)
2. **Phase 2:** Wire into Trading Engine bootstrap
3. **Phase 3:** Update ExecutionService to use market data
4. **Phase 4:** Update StrategyService to use real candles
5. **Phase 5:** Remove mock data from MarketDataService (or deprecate)

---

**Document Version:** 1.0  
**Last Updated:** 2025-11-20  
**Status:** Ready for Implementation

