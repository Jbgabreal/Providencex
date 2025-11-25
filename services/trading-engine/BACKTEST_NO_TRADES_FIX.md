# Fix: Backtest Shows 0 Trades

## Problem
Backtest runs successfully (2899 evaluations) but generates 0 trades.

## Root Cause
Execution filters are **too strict** and blocking all signals:
- ✅ HTF alignment required
- ✅ BOS in direction required  
- ✅ Liquidity sweep required
- ✅ Displacement candle (2.5x ATR) required
- ✅ Session windows only (London/NY)
- ✅ Min confluence score: 30

## Quick Fix: Use Relaxed Filters

### Option 1: Set Environment Variable (Easiest)
```bash
BACKTEST_RELAXED_FILTERS=true pnpm --filter @providencex/trading-engine backtest \
  --symbol XAUUSD \
  --from 2024-05-01 \
  --to 2024-05-30 \
  --data-source mt5
```

### Option 2: Disable Specific Filters via Env Vars
```bash
EXEC_FILTER_REQUIRE_BOS=false \
EXEC_FILTER_REQUIRE_LIQUIDITY_SWEEP=false \
EXEC_FILTER_REQUIRE_DISPLACEMENT=false \
EXEC_FILTER_REQUIRE_HTF_ALIGNMENT=false \
pnpm --filter @providencex/trading-engine backtest \
  --symbol XAUUSD \
  --from 2024-05-01 \
  --to 2024-05-30 \
  --data-source mt5
```

### Option 3: Enable Debug to See What's Blocking
```bash
BACKTEST_DEBUG=true pnpm --filter @providencex/trading-engine backtest \
  --symbol XAUUSD \
  --from 2024-05-01 \
  --to 2024-05-30 \
  --data-source mt5
```

This will log:
- Every signal generation attempt
- Why signals are being blocked
- Execution filter rejection reasons

## What Changed

1. ✅ **Forced M1 data loading** - Always uses real M1 candles from MT5
2. ✅ **Created relaxed filter config** - `backtestExecutionFilterConfig.ts`
3. ✅ **Added signal statistics** - Track signals generated vs blocked
4. ✅ **Better logging** - See exactly what's blocking trades

## Next Steps

1. Run with `BACKTEST_RELAXED_FILTERS=true` to verify signals are generated
2. If you get trades → gradually re-enable filters to find the blocker
3. If still 0 trades → check strategy logic (signals may not be generated at all)

## Files Modified

- `BacktestRunner.ts` - Force M1 loading, deterministic sorting
- `CandleReplayEngine.ts` - Use relaxed filters, track signal stats
- `backtestExecutionFilterConfig.ts` - NEW: Relaxed filter config

