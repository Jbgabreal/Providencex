# ProvidenceX — 3-Month Historical Backfill for SMC

## 1. Context

The trading engine is now wired to **real MT5 data**:

- **PriceFeedClient**: polls MT5 every 1s via `mt5-connector` (`/api/v1/price/{symbol}` or equivalent).
- **CandleBuilder**: builds **M1 candles** from live ticks.
- **CandleStore**: stores M1 candles in memory for each symbol.
- **MarketDataService**: aggregates M1 candles into **M5 / M15 / H1** using `CandleAggregator`.
- **StrategyService / SMCStrategyV2**: consumes multi-timeframe candles from `MarketDataService`.
- **OrderFlowService**: uses real order flow from MT5 via `mt5-connector`.
- **ExitService / OpenTrades / LivePnl**: use real MT5 positions and Postgres.

Right now, the system:

- Uses **real data going forward**, but  
- **Has no historical candle backfill** on startup (SMC only “sees” structure from the moment the engine started).

For proper Smart Money Concepts (SMC) trading, we need **past 3 months of structure** to be available in `CandleStore` and `MarketDataService` from the moment the engine starts.

---

## 2. Goal

Implement a **3-month historical backfill** pipeline so that, on startup:

- For each configured symbol (e.g. `XAUUSD, EURUSD, GBPUSD, US30`):
  - The engine loads approximately **90 days of historical M1 candles** from MT5.
  - These candles are pushed into `CandleStore`.
  - `MarketDataService` can immediately aggregate to **M5 / M15 / H1**, so SMC has a **real HTF/ITF/LTF structure** from day one.

We are **not** building a full PnL backtester here; we are building:

> “Historical Market Structure Warm-Up” — so SMC has enough lookback to make sane decisions in live mode.

---

## 3. Requirements

### R1 — Historical Depth

- Default historical depth: **90 days (3 months)**.
- Configurable via env, e.g.:

  - `HISTORICAL_BACKFILL_ENABLED=true`
  - `HISTORICAL_BACKFILL_DAYS=90` (integer, days)

- Historical timeframe for backfill:
  - **M1** candles only.
  - Higher timeframes (M5/M15/H1) continue to be aggregated using the existing `CandleAggregator`.

### R2 — Data Source

- Historical candles must come from the **MT5 terminal** (via the existing Python `mt5-connector`), not from any mock.
- Add a **new MT5 history endpoint** in `mt5-connector` to fetch historical M1 data for a symbol and date range.

Example REST shape (final shape up to you, but keep it simple):

- `GET /api/v1/history?symbol=XAUUSD&timeframe=M1&days=90`

Or `POST` with JSON body — whichever fits current FastAPI pattern.

### R3 — Integration With CandleStore / MarketDataService

- New service in trading engine: `HistoricalBackfillService` that:

  - On startup, for each symbol:
    - Calls MT5 history endpoint.
    - Converts returned OHLCV/time into the internal candle type expected by `CandleStore`.
    - Inserts candles in **ascending timestamp order** into `CandleStore`.

- `MarketDataService` **should not need major changes** because it already knows how to:
  - Pull M1 from `CandleStore`.
  - Aggregate to M5/M15/H1 through `CandleAggregator`.

### R4 — Safety, Performance, and Resilience

- Backfill must **never crash** the trading engine.
  - If MT5 history fetch fails, log at `ERROR` level and continue with whatever candles we have.
  - If partial data is returned, use it and log a warning.
- Backfill should be **bounded** by `CandleStore`’s max per symbol.
  - If history length exceeds the configured max, **keep the most recent candles** and drop the oldest (or let `CandleStore` enforce its own capacity).
- Do **not block the whole process forever** waiting for history.
  - It’s OK if the first few minutes of SMC decisions are still in “shallow history” mode as data is filling in.
  - SMC already skips when there is not enough structure; that safety can remain.

### R5 — Observability

Add clear logging:

- At startup:
  - `"[HistoricalBackfill] Starting 90-day M1 backfill for symbols: ..."`
- Per symbol:
  - Progress logs: how many candles fetched, how many inserted.
  - Error logs when MT5 or the HTTP call fails.
  - Final summary: `"[HistoricalBackfill] Completed for XAUUSD: N candles loaded (range: 2024-08-21T...Z → 2024-11-21T...Z)"`

Use existing logger utilities and naming patterns.

---

## 4. Architecture & Design

### 4.1 New History Endpoint in mt5-connector

**File:** `services/mt5-connector/src/main.py` (or equivalent FastAPI main module)

**Add:**

- A new endpoint: `/api/v1/history`
- It should:

  1. Accept query parameters or a request body with:

     - `symbol` (string, required)
     - `timeframe` (string, default `"M1"` for now)
     - Either:
       - `days` (int, default from env, e.g. 90), **OR**
       - `start` and `end` (ISO8601 timestamps)

  2. Compute the requested time window:

     - If `days` is set:
       - `end = now (broker time)`  
       - `start = end - days`

  3. Translate `timeframe` to MT5 enum (e.g. `mt5.TIMEFRAME_M1`).
  4. Use MT5 API (`copy_rates_range` or `copy_rates_from_pos`) to fetch OHLCV data.
  5. Return JSON array of candles with structure like:

     ```json
     [
       {
         "time": "2024-08-21T10:00:00Z",
         "open": 4065.12,
         "high": 4066.25,
         "low": 4064.90,
         "close": 4065.87,
         "volume": 123
       },
       ...
     ]
     ```

  6. Error handling:
     - For MT5 connection errors / invalid symbol:
       - Return HTTP 502 with a JSON body containing `error` and `details`.
     - For empty result (no history in range):
       - Return HTTP 200 with an **empty array**.

Make sure to reuse the **existing MT5 client initialization and connection logic** (don’t re-implement from scratch).

### 4.2 HistoricalBackfillService in trading engine

**New file:**  
`services/trading-engine/src/services/HistoricalBackfillService.ts`

**Responsibilities:**

- On engine startup:

  - For each tracked symbol (same symbol list the `PriceFeedClient` uses):
    - Call `mt5-connector` history endpoint.
    - Map the JSON candles into `CandleStore` candle type.
    - Insert into `CandleStore` in ascending timestamp order.

- Should be initialised with:

  - HTTP client (Axios instance).
  - `CandleStore` reference.
  - Config: `mt5BaseUrl`, `backfillEnabled`, `backfillDays`.

**Pseudocode shape (for you to implement in real TS):**

```ts
export class HistoricalBackfillService {
  constructor(
    private readonly candleStore: CandleStore,
    private readonly config: {
      mt5BaseUrl: string;
      symbols: string[];
      backfillEnabled: boolean;
      backfillDays: number;
    }
  ) {}

  async backfillAll(): Promise<void> {
    if (!this.config.backfillEnabled) {
      logger.info('[HistoricalBackfill] Disabled via config');
      return;
    }

    logger.info(
      `[HistoricalBackfill] Starting backfill: ${this.config.backfillDays} days, symbols=${this.config.symbols.join(', ')}`
    );

    for (const symbol of this.config.symbols) {
      await this.backfillSymbol(symbol);
    }

    logger.info('[HistoricalBackfill] Backfill completed for all symbols');
  }

  private async backfillSymbol(symbol: string): Promise<void> {
    try {
      logger.info(
        `[HistoricalBackfill] Fetching history for ${symbol} (${this.config.backfillDays} days)`
      );

      // HTTP GET /api/v1/history?symbol=...&timeframe=M1&days=...
      // Map response to internal candles and insert into CandleStore
    } catch (err) {
      logger.error(
        `[HistoricalBackfill] Failed to backfill ${symbol}`,
        { error: err }
      );
    }
  }
}
4.3 Wiring HistoricalBackfillService Into Startup
File(s):

services/trading-engine/src/index.ts

Or central bootstrap file where CandleStore, CandleBuilder, MarketDataService, and StrategyService are initialized.

Steps:

Identify where the symbol list is configured
(used by PriceFeedClient and OrderFlowService — reuse that).

Instantiate HistoricalBackfillService after:

CandleStore is created.

PriceFeedClient and CandleBuilder are wired.

Call await historicalBackfillService.backfillAll() before or right after starting the main tick loop.

It’s acceptable if the tick loop starts in parallel, but make sure we don’t block startup forever.

Log start and completion so you can see in your console when backfill finishes.

4.4 Edge Cases & Behaviour
Weekend / closed market:

MT5 might still have historical data; no special handling required.

Partial history:

If MT5 only has 40 days available, that’s fine — load what you get and log a warning.

CandleStore capacity:

If CandleStore has a max candle capacity per symbol, and history exceeds that:

Keep most recent candles (e.g., last N M1 candles).

SMC behaviour:

SMC should automatically benefit from richer structure.

No SMC code changes are required if it already uses MarketDataService.getRecentCandles(...).

