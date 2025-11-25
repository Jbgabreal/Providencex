# Optimizer Fix: 0 Iterations Issue

## Problem
The optimizer completes immediately with "Total iterations: 0", meaning no backtests are actually being executed.

## Root Cause
The optimization loop is running, but all iterations are returning `null` results from `runBacktest()`, causing them to be skipped with `continue`. This results in:
- Loop executes iterations 1, 2, 3
- Each iteration calls `runBacktest()`
- Each `runBacktest()` returns `null` (results don't match expected structure or exception caught)
- Each iteration does `continue` (skips rest of iteration)
- `previousResults` array stays empty
- Completion message shows "Total iterations: 0"

## Fixes Applied

### 1. Enhanced Logging
- Added logging at loop entry to confirm iterations are starting
- Added logging when results are null to show why iterations are skipped
- Added warning when all iterations fail
- Added success logging when results are received

### 2. Better Error Handling
- Improved null result detection and logging
- Clear messages about why iterations are being skipped

## Next Steps to Debug

1. **Check if backtest is actually running:**
   - Look for "STARTING BACKTEST" messages
   - Check if backtest completes or times out
   - Verify `runBacktest()` is being called

2. **Check why results are null:**
   - Is `runner.run()` returning a result?
   - Does the result have a `stats` property?
   - Is an exception being caught?

3. **Verify backtest results structure:**
   - The optimizer expects `results.stats` to exist
   - Check what `BacktestRunner.run()` actually returns

## Quick Test

Run with a very short date range to ensure backtest completes:
```bash
pnpm --filter @providencex/trading-engine optimize-single \
  --from 2024-05-01 \
  --to 2024-05-01 \
  --symbol XAUUSD \
  --data-source mt5
```

Watch for:
- "ENTERING ITERATION LOOP" messages (confirms loop runs)
- "STARTING BACKTEST" messages (confirms backtest starts)
- "RESULTS IS NULL" messages (shows why it fails)

