# Optimizer Debug Guide

## Current Issue: 0 Iterations Completed

The optimizer shows "Total iterations: 0" immediately after starting.

## Diagnostic Steps

### 1. Check Loop Entry
Look for these logs at the start:
```
[OPTIMIZER] 🔄 STARTING OPTIMIZATION LOOP
[OPTIMIZER] Max iterations: 3
[OPTIMIZER] ENTERING ITERATION LOOP - Iteration 1/3
```

If you don't see these, the loop isn't starting.

### 2. Check Backtest Execution
Look for:
```
[OPTIMIZER] 🚀 STARTING BACKTEST (Iteration 1/3)
[OPTIMIZER] ⏳ Awaiting backtest (with 15min timeout)...
```

If you don't see these, `runBacktest()` isn't being called.

### 3. Check Results
Look for:
- `✅ BACKTEST AWAIT COMPLETED!` - Backtest finished
- `✅ Results received!` - Results extracted successfully
- `❌ Results is NULL!` - Backtest returned null
- `❌ EXCEPTION:` - Exception during backtest

### 4. Common Issues

#### Issue: Backtest Times Out
**Symptoms:** See timeout error after 15 minutes
**Fix:** Reduce date range or increase timeout

#### Issue: Backtest Returns Null
**Symptoms:** See "Results is NULL" immediately
**Possible Causes:**
- `runner.run()` throws exception (caught in runBacktest catch block)
- Results don't have `stats` property
- Results structure doesn't match expected format

**Debug:** Check logs for:
- `❌ Error during backtest execution:`
- `❌ Backtest results missing stats object!`

#### Issue: Loop Doesn't Enter
**Symptoms:** "OPTIMIZATION COMPLETE!" appears immediately
**Possible Causes:**
- `maxIterations` is 0 (should be 3)
- Loop condition fails immediately
- Exception before loop starts

## Quick Fix Test

Run with minimal date range to ensure backtest completes:
```bash
pnpm --filter @providencex/trading-engine optimize-single \
  --from 2024-05-01 \
  --to 2024-05-01 \
  --symbol XAUUSD \
  --data-source mt5
```

This should complete quickly and help identify where it's failing.

## Expected Flow

1. ✅ Loop starts (iteration 1/3)
2. ✅ Backtest starts
3. ✅ Backtest completes (or times out)
4. ✅ Results extracted
5. ✅ Results saved to `previousResults[]`
6. ✅ Loop continues to iteration 2/3
7. ✅ Repeat until profitable or max iterations

If step 3-4 fails, iteration is skipped with `continue`, and `previousResults` stays empty.

