# CRITICAL BUG FIX: Zero Trades Issue

## Root Cause Identified

**The problem:** When processing M1 candles, the `processCandle()` method was returning early (line 152), **before** reaching the signal generation code. This meant that **ALL M1 candles were being processed, but signals were NEVER being generated**.

## The Bug

```typescript
// BEFORE (BROKEN):
if (tfMinutes === 1) {
  // Add M1 candle to store
  this.candleStore.addCandle(marketDataCandle);
  return; // ❌ EARLY RETURN - Never reaches signal generation!
}

// Signal generation code below (never executed for M1 candles)
const signal = await this.strategyService.generateSignal(symbol);
```

## The Fix

```typescript
// AFTER (FIXED):
if (tfMinutes === 1) {
  // Add M1 candle to store
  this.candleStore.addCandle(marketDataCandle);
  // ✅ NO EARLY RETURN - Continue to signal generation below
} else {
  // Handle higher-timeframe candles...
}

// Signal generation code below (NOW EXECUTED for M1 candles)
const signal = await this.strategyService.generateSignal(symbol);
```

## Impact

- **Before:** 0 trades because signals were never generated
- **After:** Signals will be generated for every M1 candle, allowing trades to execute

## Additional Fixes Applied

1. **Guardrail logging:** Added logging when guardrail blocks trades (first 20 blocks)
2. **Signal attempt tracking:** Track and log signal generation attempts vs rejections
3. **Better diagnostics:** Log rejection reasons from strategy

## Testing

Run the backtest again:

```bash
pnpm --filter @providencex/trading-engine backtest \
  --symbol XAUUSD \
  --from 2024-05-01 \
  --to 2024-05-30 \
  --data-source mt5
```

You should now see:
- ✅ Signal generation attempts logged
- ✅ Signal rejections with reasons (if strategy rejects)
- ✅ Actual trades executed (if signals pass filters)

