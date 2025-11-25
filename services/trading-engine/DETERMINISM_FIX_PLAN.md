# Backtest Determinism Fix Plan

## Problem Summary
Backtest results vary between runs with identical inputs, indicating non-deterministic behavior.

## Root Cause Analysis

After investigation, the likely causes are:

1. **Map/Set Iteration Order** - While JavaScript Maps maintain insertion order, if multiple Maps are iterated and their order varies, results could differ
2. **Strategy State** - Strategy service might have internal state that isn't properly reset between runs
3. **Floating Point Precision** - Comparison operations might vary based on calculation order
4. **Async Race Conditions** - Any unawaited promises or concurrent operations could cause timing-dependent results

## Immediate Diagnostic Steps

### Step 1: Add Deterministic Logging
Add logging to capture:
- Every trade decision (entry/exit)
- Signal generation results
- Strategy state at key points
- Candle processing order

### Step 2: Run Deterministic Test
```bash
# Run backtest twice with same parameters
pnpm --filter @providencex/trading-engine backtest --symbol XAUUSD --from 2024-05-01 --to 2024-05-07 --data-source postgres > run1.log
pnpm --filter @providencex/trading-engine backtest --symbol XAUUSD --from 2024-05-01 --to 2024-05-07 --data-source postgres > run2.log

# Compare results
diff run1.log run2.log
```

### Step 3: Identify First Divergence
Compare the logs to find:
- First point where results differ
- What decision was made differently
- What input data led to that decision

## Recommended Fixes (Priority Order)

### Priority 1: Ensure Complete State Reset
Add explicit reset methods and call at start of each backtest:
- CandleStore.clear()
- StrategyService.reset() 
- MarketDataService.reset()
- All Map/Set state cleared

### Priority 2: Use Deterministic Sorting
Ensure all iterations are sorted before processing:
- Sort candles by timestamp (already done ✓)
- Sort trades by timestamp before processing
- Sort positions by ticket ID before iteration

### Priority 3: Fix Floating Point Comparisons
Use epsilon-based comparisons for all price calculations:
```typescript
const EPSILON = 0.0001;
function equals(a: number, b: number): boolean {
  return Math.abs(a - b) < EPSILON;
}
```

### Priority 4: Eliminate Async Race Conditions
Ensure all async operations are properly awaited and ordered deterministically.

## Testing Strategy

1. **Deterministic Test**: Run same backtest 5 times, verify identical results
2. **Logging Test**: Enable comprehensive logging, compare logs between runs
3. **Incremental Test**: Run with small date ranges, identify first divergence

## Status

- ✅ Identified potential causes
- ⏳ Need to add diagnostic logging
- ⏳ Need to verify state reset
- ⏳ Need to run deterministic tests

## Next Action

Add comprehensive logging to track every decision point and identify where results first diverge.

