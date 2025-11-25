# Backtest Debugging Guide

## Problem: 0 Trades Generated

If your backtest shows 0 trades but lots of evaluations, signals are likely being blocked by filters.

## Quick Fix: Use Relaxed Filters

Set environment variable to use relaxed execution filters:

```bash
BACKTEST_RELAXED_FILTERS=true pnpm --filter @providencex/trading-engine backtest \
  --symbol XAUUSD \
  --from 2024-05-01 \
  --to 2024-05-07 \
  --data-source mt5
```

This will:
- ✅ Disable strict requirements (BOS, liquidity sweep, displacement)
- ✅ Allow trades in all sessions (24/7)
- ✅ Remove confluence score requirements
- ✅ Remove spread limits
- ✅ Allow unlimited trades per day

## Enable Debug Logging

To see what's blocking trades:

```bash
BACKTEST_DEBUG=true pnpm --filter @providencex/trading-engine backtest \
  --symbol XAUUSD \
  --from 2024-05-01 \
  --to 2024-05-07 \
  --data-source mt5
```

This will log:
- Every signal generation attempt
- Every signal rejection reason
- Every execution filter block reason
- Every risk check block reason

## Production Filters (Strict)

Default execution filter for XAUUSD requires:
- ✅ HTF alignment
- ✅ BOS in direction
- ✅ Liquidity sweep
- ✅ Displacement candle (2.5x ATR)
- ✅ London/NY sessions only
- ✅ Min confluence score: 30
- ✅ Max spread: 50 pips

## Backtest Filters (Relaxed)

Relaxed filters for backtesting:
- ❌ HTF alignment: Not required
- ❌ BOS: Not required
- ❌ Liquidity sweep: Not required
- ❌ Displacement: Not required
- ❌ Session windows: All day (24/7)
- ❌ Confluence score: 0 (no minimum)
- ❌ Spread limit: 999 pips (no limit)

## Diagnosing 0 Trades

1. **Run with relaxed filters first** - If you get trades, filters are the issue
2. **Enable debug logging** - See exactly what's being blocked
3. **Check signal generation** - See if signals are even being created
4. **Gradually re-enable filters** - Find which filter is blocking everything

## Next Steps

1. Run backtest with `BACKTEST_RELAXED_FILTERS=true`
2. If you get trades → filters are too strict, tune them
3. If still 0 trades → signals aren't being generated, check strategy logic

