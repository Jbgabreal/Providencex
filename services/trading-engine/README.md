# Trading Engine v2

The Trading Engine is the algorithmic brain of ProvidenceX, responsible for:
- Real-time market data feed from MT5 Connector (v2)
- Building 1-minute OHLC candles from tick data (v2)
- Analyzing market structure using SMC (Smart Money Concepts) v1
- Checking News Guardrail for trading safety
- Applying conservative risk controls
- Executing trades via MT5 Connector
- Logging all decisions for transparency

## Features

### Strategy Logic (SMC v1)
- **HTF Trend Detection**: Identifies bullish/bearish/sideways trends on H1 timeframe
- **LTF Structure**: Detects BOS/CHoCH on M5 timeframe aligned with HTF trend
- **Order Block Identification**: Finds last opposite candle before structure break
- **Liquidity Sweep Detection**: Confirms price swept previous swing before entry

### Risk Management
- **Two Strategy Profiles**:
  - **Low Risk**: 0.5% per trade, max 2 trades/day, max 1% daily loss
  - **High Risk Conservative**: 1.5% per trade, max 4 trades/day, max 3% daily loss
- **Guardrail-Aware**: Adjusts risk based on news event risk scores
- **Daily Limits**: Enforces daily loss caps and trade count limits

### Market Data Layer (v2)

The Trading Engine v2 introduces a real-time market data layer that replaces mock price data with live feeds from the MT5 Connector.

#### Components

- **PriceFeedClient**: Polls MT5 Connector `/api/v1/price/{symbol}` at configurable intervals (default: 1 second)
  - Emits tick events for subscribed symbols via EventEmitter
  - Handles network errors gracefully with retry logic
  - Supports multiple symbols simultaneously

- **CandleBuilder**: Aggregates ticks into 1-minute OHLC candles
  - Detects minute boundary transitions automatically
  - Updates high/low/close as ticks arrive within the same minute
  - Closes candles on minute boundaries and pushes them to CandleStore

- **CandleStore**: In-memory storage for candles per symbol
  - Maintains rolling window of recent candles (configurable max, default: 1000 per symbol)
  - Fast access to latest candles for strategy analysis
  - Uses `maxCandlesPerSymbol` from `MarketDataConfig`

#### Configuration

Market data configuration is managed via `MarketDataConfig` in `@providencex/shared-config`:

- `symbols`: List of symbols to track (default: XAUUSD, EURUSD, GBPUSD, US30)
- `feedIntervalSec`: Polling interval in seconds (default: 1)
- `maxCandlesPerSymbol`: Maximum candles to keep per symbol (default: 1000)

See [Trading Engine v2 PRD](../docs/Trading_Engine_v2_PRD.md) for detailed specification.

### Integration
- **News Guardrail**: Checks trading safety before every trade
- **MT5 Connector**: Sends trade instructions for execution and fetches live prices
- **Decision Logging**: Records every decision for audit and transparency

### Execution Filter v3

Trading Engine v3 introduces a **multi-confirmation execution filter** that adds additional quality gates before trade execution. This ensures the system trades **less but higher-quality setups**.

**Key Features:**
- **Multi-timeframe Alignment**: Enforces HTF trend alignment and BOS/CHOCH confirmation
- **Structural Confirmations**: Requires liquidity sweep and displacement candle for valid setups
- **Session Filters**: Only trades during configured trading windows (e.g., London, NY sessions)
- **Frequency Limits**: Per-symbol/strategy max trades per day, cooldown periods, and concurrent trade limits
- **Enhanced Risk Filters**: Additional spread checks and distance from daily high/low validation

**Configuration:**
- Per-symbol rules defined in `src/config/executionFilterConfig.ts`
- Feature flag: `USE_EXECUTION_FILTER_V3` (default: `true`)
- All rules are configurable per symbol and strategy

**Decision Logging:**
- v3 filter reasons are logged in `execution_filter_reasons` field
- Both SKIP and TRADE decisions include v3 metadata for analysis

For detailed specification, see [Trading Engine v3 PRD](../docs/Trading_Engine_v3_PRD.md).

### Execution Filter v4 — Exposure & Concurrency

Trading Engine v4 adds **real-time exposure and open trades awareness** to the execution filter, ensuring the system never opens trades blindly when limits are already reached.

**Key Features:**
- **Open Trades Awareness**: Continuously polls MT5 Connector for current open positions
- **Per-Symbol Limits**: Enforces max concurrent trades per symbol and per direction (buy/sell)
- **Global Limits**: Enforces max concurrent trades across all symbols
- **Risk Exposure Caps**: Limits based on estimated risk per symbol and globally
- **Real-Time Updates**: Exposure snapshots update every 10 seconds (configurable)

**Configuration:**
- Per-symbol exposure rules in `src/config/executionFilterConfig.ts`:
  - `maxConcurrentTradesPerDirection`: Max trades per direction per symbol (default: 1)
  - `maxDailyRiskPerSymbol`: Max risk amount per symbol in account currency (e.g., $200)
- Global limits:
  - `maxConcurrentTradesGlobal`: Max trades across all symbols (default: 8)
  - `maxDailyRiskGlobal`: Max total risk across all symbols (default: $500)
  - `exposurePollIntervalSec`: How often to poll MT5 for open positions (default: 10)

**How Exposure-Based SKIPs Appear:**
- When exposure limits are hit, trades are SKIPPED with reasons like:
  - `"Max concurrent trades per symbol reached for XAUUSD: 2 >= 2"`
  - `"Max concurrent buy trades reached for EURUSD: 1 >= 1"`
  - `"Max global concurrent trades reached: 8 >= 8"`
  - `"Max daily risk for XAUUSD reached: 205.50 >= 200"`
- All exposure-based reasons are logged in `execution_filter_reasons` field
- Decision logs include full exposure context for debugging

**Status Endpoint:**
- `GET /api/v1/status/exposure`: Returns current exposure snapshot for all symbols and global totals
- Useful for monitoring and debugging exposure limits
- Returns real-time data from OpenTradesService

**Example Response:**
```json
{
  "success": true,
  "symbols": [
    {
      "symbol": "XAUUSD",
      "longCount": 1,
      "shortCount": 1,
      "totalCount": 2,
      "estimatedRiskAmount": 150.0,
      "lastUpdated": "2025-11-20T20:55:30Z"
    }
  ],
  "global": {
    "totalOpenTrades": 3,
    "totalEstimatedRiskAmount": 260.0,
    "lastUpdated": "2025-11-20T20:55:30Z"
  }
}
```

**Backward Compatibility:**
- If v4 exposure fields are not configured, behavior is identical to v3
- OpenTradesService runs in background but doesn't affect decisions if no rules are set
- All v4 fields are optional and default to "not enforced" when undefined

For detailed specification, see [Trading Engine v4 PRD](../docs/Trading_Engine_v4_PRD.md).

### Trading Engine v5 — Backtesting & Simulation Framework

Trading Engine v5 introduces a complete **backtesting and simulation framework** that allows ProvidenceX to replay historical candles through the exact same strategy pipeline used in production. This enables strategy validation, performance analysis, and configuration optimization before enabling changes live.

**Key Features:**
- **Historical Data Loading**: Supports CSV files, Postgres databases, and mock data generation
- **Candle Replay Engine**: Replays historical candles through StrategyService → SignalConverter v3 → ExecutionFilter v3 & v4 → RiskService
- **Simulated Execution**: Simulates order execution, SL/TP hits, spread, and slippage via `SimulatedMT5Adapter`
- **Exposure Simulation**: Full v4 exposure and concurrency limit simulation
- **Performance Metrics**: Calculates win rate, profit factor, drawdown, expectancy, and more
- **Result Storage**: Saves results to disk (JSON/CSV) and database (Postgres)

**Architecture:**
- `BacktestRunner`: Main orchestrator that coordinates the backtest
- `HistoricalDataLoader`: Loads historical candles from various sources
- `CandleReplayEngine`: Processes each candle through the strategy pipeline
- `SimulatedMT5Adapter`: Simulates MT5 Connector for trade execution
- `SimulatedRiskService`: Simulates risk management constraints
- `BacktestResultStore`: Persists results to Postgres

**Usage:**

```bash
# Run backtest with default settings (mock data)
pnpm backtest --symbol XAUUSD

# Run backtest with custom date range
pnpm backtest --symbol XAUUSD --from 2024-01-01 --to 2024-12-31

# Run backtest with CSV data
pnpm backtest --symbol XAUUSD --data-source csv --csv-path ./data/xauusd.csv

# Run backtest with multiple strategies
pnpm backtest --symbol XAUUSD --strategy low,high

# Run backtest with multiple symbols
pnpm backtest --symbol XAUUSD,EURUSD,GBPUSD

# Run backtest with custom initial balance
pnpm backtest --symbol XAUUSD --initial-balance 50000
```

**CLI Options:**
- `--symbol, -s <SYMBOL>`: Trading symbol(s) (comma-separated for multiple)
- `--strategy <STRATEGY>`: Strategy to test: `low`, `high`, or `low,high` (default: `low`)
- `--from, -f <DATE>`: Start date in YYYY-MM-DD format (default: `2024-01-01`)
- `--to, -t <DATE>`: End date in YYYY-MM-DD format (default: `2024-12-31`)
- `--data-source <SOURCE>`: Data source: `csv`, `postgres`, or `mock` (default: `mock`)
- `--csv-path <PATH>`: Path to CSV file (required if `--data-source=csv`)
- `--initial-balance, -b <AMOUNT>`: Initial account balance (default: `10000`)
- `--output-dir, -o <DIR>`: Output directory (default: `./backtests/run_<timestamp>`)
- `--help, -h`: Show help message

**Output:**

Results are saved to:
- `./backtests/run_<timestamp>/summary.json` - Summary statistics and configuration
- `./backtests/run_<timestamp>/trades.csv` - All trades in CSV format
- `./backtests/run_<timestamp>/equity.json` - Equity curve data points

Results are also stored in Postgres:
- `backtest_runs` - Run metadata and statistics
- `backtest_trades` - All individual trades
- `backtest_equity` - Equity curve points

**Performance Metrics:**

The backtest calculates comprehensive performance metrics:
- **Trade Counts**: Total trades, winning trades, losing trades
- **Win Rate**: Percentage of profitable trades
- **PnL Metrics**: Total PnL, gross profit, gross loss, profit factor
- **Risk Metrics**: Max drawdown (absolute and percentage), max consecutive losses/wins
- **Trade Metrics**: Average win/loss, average R:R, expectancy, average trade duration
- **Per-Symbol Stats**: PnL, win rate, and trade count per symbol
- **Per-Strategy Stats**: PnL, win rate, and trade count per strategy

**Integration:**

The backtesting framework:
- Reuses existing production code (StrategyService, ExecutionFilter, SignalConverter)
- Is fully isolated from the live engine (no shared state)
- Is deterministic (same inputs → same outputs)
- Supports all v2-v4 features (market data, execution filters, exposure limits)

**Limitations:**

- Currently supports M5 timeframe (1-minute and H1 aggregation coming in future versions)
- Mock data generation is simplified (for testing only)
- Contract sizes and pip values are simplified approximations
- Real-time tick data is not yet supported (uses candle OHLC only)

For detailed specification, see [Trading Engine v5 PRD](../docs/Trading_Engine_v5_PRD.md).

## Setup

### Prerequisites
- Node.js >= 18.0.0
- pnpm >= 8.0.0
- PostgreSQL (optional, for decision logging)
- News Guardrail service running
- MT5 Connector service running

### Installation

```bash
# Install dependencies (from monorepo root)
pnpm install

# Build shared packages
pnpm --filter './packages/*' build
```

### Configuration

Create a `.env` file in the `services/trading-engine/` directory (or use root `.env`):

```bash
# Service Port
TRADING_ENGINE_PORT=3020

# External Service URLs
NEWS_GUARDRAIL_URL=http://localhost:3010
MT5_CONNECTOR_URL=http://localhost:3030

# Risk Limits - Low Risk Strategy
LOW_RISK_MAX_DAILY_LOSS=1.0
LOW_RISK_MAX_TRADES=2

# Risk Limits - High Risk Strategy
HIGH_RISK_MAX_DAILY_LOSS=3.0
HIGH_RISK_MAX_TRADES=4

# Risk Per Trade (percent of equity)
DEFAULT_LOW_RISK_PER_TRADE=0.5
DEFAULT_HIGH_RISK_PER_TRADE=1.5

# Market Constraints
MAX_SPREAD=0.8

# Strategy Configuration
SMC_TIMEFRAMES=H1,M5

# Market Data Layer (v2)
MARKET_FEED_INTERVAL_SEC=1          # Polling interval for price feed (seconds)
MARKET_SYMBOLS=XAUUSD,EURUSD,GBPUSD  # Symbols to track for price feed

# Tick Loop
TICK_INTERVAL_SECONDS=60

# Database (Optional - for logging)
DATABASE_URL=postgresql://user:password@host:5432/providencex

# Mock Account Equity (for v1 testing)
MOCK_ACCOUNT_EQUITY=10000
```

See `.env.example` for all available options.

### Running the Service

**Development mode** (with hot reload):
```bash
pnpm --filter @providencex/trading-engine dev
```

**Production mode**:
```bash
# Build first
pnpm --filter @providencex/trading-engine build

# Then start
pnpm --filter @providencex/trading-engine start
```

Or from the service directory:
```bash
cd services/trading-engine
pnpm dev
```

## API Endpoints

### `GET /health`

Health check endpoint.

**Response**:
```json
{
  "status": "ok",
  "service": "trading-engine"
}
```

**Example**:
```bash
curl http://localhost:3020/health
```

### `POST /simulate-signal`

Simulate a trade decision flow for testing/debugging.

**Request Body**:
```json
{
  "symbol": "XAUUSD",      // Optional, defaults to XAUUSD
  "strategy": "low",        // Optional, "low" or "high", defaults to "low"
  "execute": false          // Optional, set to true to actually execute trade
}
```

**Response**:
```json
{
  "symbol": "XAUUSD",
  "strategy": "low",
  "timestamp": "2025-11-19T12:00:00.000Z",
  "guardrail": {
    "can_trade": true,
    "mode": "normal",
    "reason": "Normal mode: No active avoid windows",
    "active_windows": []
  },
  "signal": {
    "direction": "buy",
    "entry": 2650.0,
    "stopLoss": 2645.0,
    "takeProfit": 2660.0,
    "reason": "SMC v1: bullish HTF trend, BOS on LTF..."
  },
  "risk_check": {
    "allowed": true,
    "adjusted_risk_percent": 0.5
  },
  "position_size": {
    "lot_size": 0.01,
    "risk_percent": 0.5,
    "stop_loss_pips": 5.0
  },
  "execution": {
    "success": true,
    "ticket": "SIM-1234567890"
  },
  "decision": "trade",
  "final_reason": "Trade would be executed successfully"
}
```

**Example**:
```bash
# Simulate (without executing)
curl -X POST http://localhost:3020/simulate-signal \
  -H "Content-Type: application/json" \
  -d '{"symbol": "XAUUSD", "strategy": "low"}'

# Actually execute trade
curl -X POST http://localhost:3020/simulate-signal \
  -H "Content-Type: application/json" \
  -d '{"symbol": "XAUUSD", "strategy": "low", "execute": true}'
```

## How It Works

### Tick Loop

The engine runs a tick loop every `TICK_INTERVAL_SECONDS` (default: 60 seconds):

1. **For each configured symbol**:
   - Fetch recent candles (H1 and M5)
   - Generate trade signal using SMC v1 logic
   - If no signal → log and skip

2. **If signal exists**:
   - Check News Guardrail (with strategy parameter)
   - If blocked → log and skip
   - Check risk constraints (daily limits, position sizing)
   - If risk disallows → log and skip
   - Calculate lot size based on risk
   - Execute trade via MT5 Connector
   - Log full decision (signal, guardrail, risk, execution)

### Decision Flow

```
Tick Loop Starts
  ↓
For Each Symbol:
  ├─ Get HTF Candles (H1)
  ├─ Determine HTF Trend
  ├─ Get LTF Candles (M5)
  ├─ Detect BOS/CHoCH
  ├─ Identify Order Block
  ├─ Check Liquidity Sweep
  │
  ├─ If No Signal → Log "skip: no signal" → Continue
  │
  └─ If Signal Found:
      ├─ Check Guardrail → If blocked → Log "skip: guardrail blocked" → Continue
      ├─ Check Spread → If too wide → Log "skip: spread too wide" → Continue
      ├─ Check Risk Limits → If exceeded → Log "skip: risk limits" → Continue
      ├─ Calculate Position Size
      ├─ Execute Trade → Log "trade" with full details
      └─ Update Daily Stats
```

## Decision Logging

Every tick and every decision is logged to:
- **Console**: Real-time visibility
- **Database** (if `DATABASE_URL` configured): Persistent audit trail

Decision logs include:
- Timestamp, symbol, strategy
- Guardrail mode and reason
- Signal reason (if found)
- Risk check result
- Execution result (if trade executed)
- Full trade request details

## Strategy Profiles

### Low Risk (Capital Preservation)
- Risk per trade: 0.5% of equity
- Max daily loss: 1% of equity
- Max trades per day: 2
- Blocks trading if any window has `risk_score ≥ 30`
- Blocks if upcoming window with `risk_score ≥ 70` within 45 minutes

### High Risk Conservative
- Risk per trade: 1.5% of equity (reduced to 0.5% in reduced mode)
- Max daily loss: 3% of equity
- Max trades per day: 4
- Reduced mode if active window `risk_score` in [50, 79]
- Hard block if `risk_score ≥ 80`
- Hard block if upcoming window with `risk_score ≥ 90` within 30 minutes

## Trading Engine v2 – Market Data Layer

### Overview
Trading Engine v2 introduces a real-time market data layer that replaces mock price data with live feeds from the MT5 Connector.

### Components

**PriceFeedClient:**
- Polls MT5 Connector `GET /api/v1/price/{symbol}` at configurable intervals (default: 1 second)
- Handles network errors gracefully with retry logic (exponential backoff)
- Emits `tick` events for each price update
- Tracks latest tick per symbol for fast access

**CandleBuilder:**
- Subscribes to tick stream from PriceFeedClient
- Aggregates ticks into 1-minute OHLC candles
- Updates current candle (H/L/C) as ticks arrive within the same minute
- Finalizes and closes candles on minute boundaries

**CandleStore:**
- In-memory storage for candles per symbol
- Maintains rolling window (default: last 1000 candles per symbol)
- Provides fast access to latest candles for strategy analysis
- Methods: `getLatestCandle()`, `getCandles(limit)`

### Configuration
- `MARKET_FEED_INTERVAL_SEC`: Polling interval in seconds (default: 1)
- `MARKET_SYMBOLS`: Comma-separated list of symbols to track (default: XAUUSD,EURUSD,GBPUSD)
- `MT5_CONNECTOR_URL`: Base URL for MT5 Connector (default: http://localhost:3030)

### Usage
The market data layer is automatically initialized when the Trading Engine starts:
- PriceFeedClient starts polling immediately
- CandleBuilder processes each tick and builds candles
- ExecutionService can access latest tick/candle for trade context

**Example in ExecutionService:**
```typescript
const latestTick = priceFeed.getLatestTick(symbol);
const latestCandle = candleStore.getLatestCandle(symbol);
// Use for logging, validation, or trade decisions
```

### Error Handling
- Network errors are logged but don't crash the engine
- Retries with exponential backoff (max 3 attempts)
- If all retries fail, skips that polling cycle and continues
- Trading continues with last known price if feed is temporarily unavailable

## Development Notes

### Market Data Service (Legacy)
The legacy `MarketDataService` still exists for backward compatibility but is now supplemented by the real-time market data layer. Strategy services can use either source, but v2 components prefer the real-time feed.

### MT5 Connector Integration
The engine sends `TradeRequest` to MT5 Connector:
- If connector is down or returns error → logs error, does not retry
- Fails safely (no trade executed if connector unavailable)

### News Guardrail Integration
Calls `GET {NEWS_GUARDRAIL_URL}/can-i-trade-now?strategy={low|high}`:
- Returns mode: `normal`, `reduced`, or `blocked`
- If guardrail is down → defaults to `blocked` (fail-safe)

## Troubleshooting

### Service won't start
- Check that News Guardrail and MT5 Connector are running
- Verify environment variables are set correctly
- Check port 3020 is not already in use

### No trades being executed
- Check guardrail status: `curl http://localhost:3010/can-i-trade-now`
- Check tick loop is running (logs should show "Tick loop started")
- Check signal generation (try `/simulate-signal` endpoint)
- Check risk limits haven't been exceeded
- Check daily stats aren't blocking trades

### Database logging not working
- Verify `DATABASE_URL` is set correctly
- Check database connection (table will be created automatically)
- If database is unavailable, logs will fall back to console only

## Testing

1. **Health check**:
   ```bash
   curl http://localhost:3020/health
   ```

2. **Simulate signal**:
   ```bash
   curl -X POST http://localhost:3020/simulate-signal \
     -H "Content-Type: application/json" \
     -d '{"symbol": "XAUUSD", "strategy": "low"}'
   ```

3. **Check logs**: Watch console output for tick loop activity and decisions

4. **Check decision logs** (if using database):
   ```sql
   SELECT * FROM trade_decisions 
   ORDER BY timestamp DESC 
   LIMIT 20;
   ```

## Admin Dashboard v1

The Trading Engine now exposes admin API endpoints for monitoring and dashboard use.

### Admin API Endpoints

- `GET /api/v1/admin/decisions` - Returns recent trade decisions with filters and pagination
  - Query params: `symbol`, `strategy`, `decision`, `limit`, `offset`, `from`, `to`
  - Response: `AdminDecisionsResponse` with data array and pagination info

- `GET /api/v1/admin/metrics/daily` - Returns daily aggregate metrics
  - Query params: `date` (optional, defaults to today)
  - Response: `DailyMetricsResponse` with totals, trades by symbol/strategy, top skip reasons

- `GET /api/v1/status/exposure` - Returns real-time exposure snapshot (v4)
  - Response: `ExposureStatusResponse` with per-symbol and global exposure

- `GET /api/v1/admin/backtests` - Returns recent backtest runs (v5)
  - Query params: `symbol`, `strategy`, `limit`
  - Response: `BacktestRunsResponse` with backtest summaries

### Admin Dashboard

A Next.js admin dashboard is available at `services/admin-dashboard/`:

**Pages:**
- `/` - Overview: Daily metrics, trades by symbol/strategy, top skip reasons
- `/decisions` - Recent trade decisions with filters and pagination
- `/exposure` - Real-time exposure snapshot (auto-refresh every 10s)
- `/backtests` - Backtest run history

**Run the dashboard:**
```bash
cd services/admin-dashboard
pnpm install
pnpm dev
```

Dashboard runs on: http://localhost:3010

**Environment Variable:**
```env
NEXT_PUBLIC_TRADING_ENGINE_BASE_URL=http://localhost:3020
```

For more details, see [Admin Dashboard README](../admin-dashboard/README.md).

## Next Steps (Future Enhancements)

- [ ] Integrate real broker price feed
- [ ] Add position management (track open trades)
- [ ] Implement trade exit logic
- [x] Add backtesting capabilities (v5)
- [x] Add admin dashboard (v1)
- [ ] Implement additional strategies (SMC v2, etc.)
- [ ] Add real-time PnL tracking
- [ ] Add performance metrics dashboard

