# Backtest Non-Determinism Analysis

## Problem
Backtest results vary between runs with identical inputs, indicating non-deterministic behavior.

## Potential Root Causes Identified

### 1. **Candle Expansion Logic Issue** (Likely)
Location: `CandleReplayEngine.ts` lines 132-150

When processing higher-timeframe candles (M5, M15, etc.), they are expanded into multiple M1 candles with **identical OHLC values**:

```typescript
for (let i = 0; i < tfMinutes; i++) {
  const marketDataCandle: MarketDataCandle = {
    symbol,
    timeframe: 'M1',
    open: historicalCandle.open,    // SAME for all expanded candles
    high: historicalCandle.high,    // SAME for all expanded candles
    low: historicalCandle.low,      // SAME for all expanded candles
    close: historicalCandle.close,  // SAME for all expanded candles
    // ...
  };
  this.candleStore.addCandle(marketDataCandle);
}
```

**Problem**: If you have 1 M5 candle, it creates 5 M1 candles with identical prices. This could cause:
- Strategy to see the same "price action" multiple times
- Non-deterministic behavior if strategy state depends on candle count or iteration order

### 2. **Map Iteration Order** (Unlikely - Maps are insertion-ordered)
Maps in JavaScript maintain insertion order, so this should be deterministic. However, if multiple Maps are iterated, their order could vary if insertion order differs.

### 3. **Floating Point Precision** (Possible)
Floating point comparisons could vary based on calculation order. Need to check:
- Stop loss/take profit calculations
- Entry/exit price calculations
- Risk calculations

### 4. **Async Race Conditions** (Possible but unlikely)
If there are any unawaited promises or race conditions in signal generation, results could vary.

### 5. **Shared State Between Runs** (Critical to check)
Need to verify:
- CandleStore is properly reset between runs
- StrategyService state is reset
- MarketDataService state is reset
- All Maps/Sets are cleared between runs

## Recommended Fixes

### Priority 1: Fix Candle Expansion
Instead of creating multiple identical M1 candles, use interpolation to create realistic price action:

```typescript
// Interpolate OHLC across expanded candles
const priceChange = (historicalCandle.close - historicalCandle.open) / tfMinutes;
const highRange = historicalCandle.high - Math.max(historicalCandle.open, historicalCandle.close);
const lowRange = Math.min(historicalCandle.open, historicalCandle.close) - historicalCandle.low;

for (let i = 0; i < tfMinutes; i++) {
  const progress = i / (tfMinutes - 1); // 0 to 1
  const basePrice = historicalCandle.open + (priceChange * progress);
  
  const marketDataCandle: MarketDataCandle = {
    open: i === 0 ? historicalCandle.open : basePrice,
    high: basePrice + (highRange * (1 - Math.abs(progress - 0.5) * 2)), // Peak at middle
    low: basePrice - (lowRange * (1 - Math.abs(progress - 0.5) * 2)),
    close: i === tfMinutes - 1 ? historicalCandle.close : basePrice + priceChange,
    // ...
  };
}
```

### Priority 2: Ensure Complete State Reset
Add explicit reset/clear methods and call them at the start of each backtest:

```typescript
// At start of BacktestRunner.run()
this.candleStore.clear();
this.strategyService.reset(); // Need to add this
this.marketDataService.reset(); // Need to add this
```

### Priority 3: Use Deterministic Comparison Functions
For floating point comparisons, use epsilon-based comparisons:

```typescript
function compareFloats(a: number, b: number, epsilon = 0.0001): number {
  const diff = a - b;
  if (Math.abs(diff) < epsilon) return 0;
  return diff > 0 ? 1 : -1;
}
```

## Testing Strategy

1. **Run backtest twice** with same parameters
2. **Log every trade decision** (entry/exit prices, signals, etc.)
3. **Compare logs** to find first divergence point
4. **Add seed/version tracking** to identify which code path differs

## Next Steps

1. Add comprehensive logging to track every decision
2. Fix candle expansion to use interpolation
3. Add explicit state reset methods
4. Run deterministic tests to verify fixes

