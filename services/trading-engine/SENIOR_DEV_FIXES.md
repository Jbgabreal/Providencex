# Senior Dev Backtest Determinism Fixes

## Problem
Backtest results were non-deterministic - same inputs produced different results each run.

## Root Cause Analysis
1. **Candle Expansion**: Higher-timeframe candles (M5, M15) were expanded into multiple identical M1 candles, causing synthetic price data
2. **Map Iteration Order**: Maps were iterated without deterministic ordering
3. **Non-M1 Data**: System was loading M5/M15 data and expanding it instead of using real M1 data

## Senior Dev Approach - Fix Root Cause

### ✅ Fix 1: Always Load Real M1 Data from MT5
- **Changed**: Force `loadTimeframe = 'M1'` in BacktestRunner
- **Impact**: Uses actual MT5 M1 price data, not synthetic expanded candles
- **Location**: `BacktestRunner.ts` line ~131

```typescript
const loadTimeframe = 'M1'; // Force M1 for deterministic backtesting
const candles = await this.dataLoader.loadCandles(symbol, startDate, endDate, loadTimeframe);
```

### ✅ Fix 2: Remove Candle Expansion for M1
- **Changed**: CandleReplayEngine detects M1 data and uses it directly
- **Impact**: No synthetic candle creation, uses real price action
- **Location**: `CandleReplayEngine.ts` line ~129

```typescript
if (tfMinutes === 1) {
  // Already M1 - use directly (deterministic, real data)
  const marketDataCandle = { /* use historicalCandle directly */ };
  this.candleStore.addCandle(marketDataCandle);
  return; // Early return - no expansion
}
```

### ✅ Fix 3: Deterministic Sorting
- **Changed**: Sort symbols before Map iteration, then sort candles by timestamp + symbol
- **Impact**: Ensures identical processing order every run
- **Location**: `BacktestRunner.ts` line ~153

```typescript
const sortedSymbols = Array.from(allCandles.keys()).sort(); // Deterministic order
sortedCandles.sort((a, b) => {
  const timeDiff = a.candle.timestamp - b.candle.timestamp;
  if (timeDiff !== 0) return timeDiff;
  return a.symbol.localeCompare(b.symbol); // Tie-breaker
});
```

### ✅ Fix 4: Verify M1 Data
- **Added**: Validation to ensure loaded data is actually M1 (~1 minute intervals)
- **Impact**: Catches data source issues early
- **Location**: `BacktestRunner.ts` line ~145

## Testing Strategy

### Test 1: Deterministic Run
```bash
# Run same backtest twice, compare results
pnpm --filter @providencex/trading-engine backtest \
  --symbol XAUUSD \
  --from 2024-05-01 \
  --to 2024-05-07 \
  --data-source mt5 > run1.json

pnpm --filter @providencex/trading-engine backtest \
  --symbol XAUUSD \
  --from 2024-05-01 \
  --to 2024-05-07 \
  --data-source mt5 > run2.json

# Results should be IDENTICAL
diff run1.json run2.json
```

### Test 2: M1 Data Verification
Check logs for:
```
✅ Verified M1 data: X candles with ~1min intervals
```

If you see warnings about non-M1 intervals, the data source isn't providing true M1 data.

## Benefits

1. **Deterministic Results**: Same inputs = same outputs, every time
2. **Real Price Action**: Uses actual MT5 M1 data, not synthetic
3. **Accurate Backtesting**: Reflects real market behavior
4. **Reliable Optimization**: Optimizer can trust backtest results

## Next Steps

1. ✅ Force M1 loading
2. ✅ Remove expansion for M1
3. ✅ Deterministic sorting
4. ⏳ Test with real MT5 data source
5. ⏳ Verify identical results on multiple runs

## Notes

- **Postgres data source**: If using Postgres, ensure you're storing/loading M1 data
- **MT5 data source**: Should now load M1 directly via `/api/v1/history?timeframe=M1`
- **Fallback**: If non-M1 data somehow gets through, expansion still works but logs a warning

