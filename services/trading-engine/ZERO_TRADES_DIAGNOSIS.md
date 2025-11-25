# Zero Trades Diagnosis

## Problem
Backtest shows **0 trades** despite:
- ✅ 2899 evaluations completed
- ✅ SMC stats calculated (swings, BOS, CHoCH detected)
- ✅ Market data loaded correctly

## Root Cause Analysis

### Issue: No Signal Generation Logs
Looking at the logs, there are **NO** "Signal GENERATED" or "Signal REJECTED" messages. This means either:

1. **Signals are not being generated at all** (strategy logic too strict)
2. **Guardrail is blocking before signal generation**
3. **Logging is not working** (but other logs work, so unlikely)

### Most Likely Cause
The strategy's `generateSignal()` method is returning `null` for all 2899 evaluations, meaning **no signals meet the strategy's criteria**.

## How to Diagnose

### Step 1: Enable Debug Logging
```bash
$env:BACKTEST_DEBUG="true"; pnpm --filter @providencex/trading-engine backtest --symbol XAUUSD --from 2024-05-01 --to 2024-05-07 --data-source mt5
```

This will show:
- Every signal generation attempt
- Why signals are being rejected
- Strategy rejection reasons

### Step 2: Check SMC v2 Status
Check if SMC v2 is enabled:
```bash
echo $env:USE_SMC_V2
```

If SMC v2 is enabled, signals might require stricter conditions.

### Step 3: Use Relaxed Filters
```bash
$env:BACKTEST_RELAXED_FILTERS="true"; pnpm --filter @providencex/trading-engine backtest --symbol XAUUSD --from 2024-05-01 --to 2024-05-07 --data-source mt5
```

If this still produces 0 trades, the issue is in **strategy signal generation**, not execution filters.

## Expected Output

With debug enabled, you should see:
```
[Replay] XAUUSD: Processing candle @ 2024-05-01T00:00:00.000Z, price=2345.67, calling generateSignal...
[Replay] XAUUSD @ 2024-05-01T00:00:00.000Z: ❌ Signal REJECTED by Strategy - <reason>
```

If you see **no** "Processing candle" messages, then guardrail is blocking before signal generation.

## Next Steps

1. **Run with BACKTEST_DEBUG=true** - See what's actually happening
2. **Check strategy configuration** - Maybe signals need specific conditions
3. **Review SMC v2 requirements** - If enabled, check what conditions it needs
4. **Consider relaxing strategy filters** - Not just execution filters

## Files to Check

- `services/trading-engine/src/services/StrategyService.ts` - Signal generation logic
- `services/trading-engine/src/strategy/v2/SMCStrategyV2.ts` - If SMC v2 is enabled
- `services/trading-engine/src/config/index.ts` - Check `useSMCV2` flag

