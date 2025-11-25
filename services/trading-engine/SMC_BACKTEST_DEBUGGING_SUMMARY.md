# SMC Backtest Debugging Summary

## Problem Statement
XAUUSD backtests were completing with **Total Trades = 0**, despite SMC structure stats showing swings, BOS, and CHoCH events being detected.

## Root Causes Identified

### 1. Insufficient HTF/ITF Candles
**Symptom**: HTF candles stuck at 1, ITF candles below minimum threshold
**Cause**: Backtest checks signals starting from the first M5 candle, but MIN_HTF_CANDLES=10 required 40 hours (2,400 M1 candles) of data
**Fix**:
- Reduced `SMC_MIN_HTF_CANDLES` from 10 to 3 (services/trading-engine/src/strategy/v2/SMCStrategyV2.ts:132)
- Reduced `SMC_MIN_ITF_CANDLES` from hardcoded 20 to configurable via env (default 5)
- Added to .env:
  ```bash
  SMC_MIN_HTF_CANDLES=3
  SMC_MIN_ITF_CANDLES=5
  ```

### 2. Execution Filter Logging Bug
**Symptom**: All signals blocked with "Unknown reason"
**Cause**: services/trading-engine/src/backtesting/CandleReplayEngine.ts:267 accessed `executionDecision.reason` (singular) instead of `executionDecision.reasons` (plural array)
**Fix**: Changed to `executionDecision.reasons?.join('; ')` to properly display rejection reasons

### 3. Execution Filter executionFilterState Not Passed
**Symptom**: All signals blocked by execution filter
**Cause**: CandleReplayEngine.ts:262 was passing `undefined` for executionFilterState parameter
**Fix**: Changed to pass `this.config.executionFilterState`

### 4. Strict Execution Filter Rules
**Symptom**: Signals generated but blocked by execution filter with multiple rejection reasons:
- No liquidity sweep before entry
- No displacement candle confirming move
- Buy/Sell signal in neutral zone (Premium/Discount mismatch)
- No Fair Value Gap detected
- Confluence score too low: 50 < 65 (required)
- HTF trend not aligned with signal direction
- BOS/CHOCH does not confirm direction

**Cause**: Execution filter enforced strict SMC requirements even when `SMC_DEBUG_FORCE_MINIMAL_ENTRY=true`
**Fix**: Added env variable overrides to services/trading-engine/src/config/executionFilterConfig.ts and services/trading-engine/src/strategy/v3/ExecutionFilter.ts:
- `EXEC_FILTER_REQUIRE_HTF_ALIGNMENT`
- `EXEC_FILTER_REQUIRE_BOS`
- `EXEC_FILTER_REQUIRE_LIQUIDITY_SWEEP`
- `EXEC_FILTER_REQUIRE_DISPLACEMENT`
- `EXEC_FILTER_REQUIRE_PREMIUM_DISCOUNT`
- `EXEC_FILTER_REQUIRE_FVG`
- `EXEC_FILTER_MIN_CONFLUENCE_SCORE`

### 5. Environment Variable Loading Issue
**Symptom**: Env variables set in root .env not being picked up by backtest
**Cause**: Backtest runs from services/trading-engine directory but loads .env from cwd, not root
**Fix**: Created services/trading-engine/.env with all required relaxed settings

### 6. HTF/ITF Candle Minimums Blocking All Signals
**Symptom**: All signals rejected with "HTF=1 (need 3), ITF=1 (need 5)" throughout entire backtest
**Cause**: H4 candles take 12 hours to accumulate (00:00→04:00→08:00→12:00), so MIN_HTF_CANDLES=3 blocks all signals for first 12 hours. Additionally, root `.env` overriding local `.env` with higher minimums.
**Fix**: Reduced `SMC_MIN_HTF_CANDLES` from 3 to 1 and `SMC_MIN_ITF_CANDLES` from 5 to 1 in BOTH root and local `.env` files

### 7. Missing Premium/Discount and FVG Environment Variables
**Symptom**: Execution filter still blocking with "Buy signal in neutral zone" and "No Fair Value Gap detected" despite code changes
**Cause**: Environment variables `EXEC_FILTER_REQUIRE_PREMIUM_DISCOUNT` and `EXEC_FILTER_REQUIRE_FVG` were added to ExecutionFilter.ts code but never added to `.env` files
**Fix**: Added both variables set to `false` in root `.env` file

### 8. Confluence Score Minimum Not Respecting 0 Value (CRITICAL BUG)
**Symptom**: Even with `EXEC_FILTER_MIN_CONFLUENCE_SCORE=0` in `.env`, execution filter still required score >= 65
**Cause**: ExecutionFilter.ts:194 used `||` operator: `const minConfluenceScore = rules.minConfluenceScore || 65;` which treats JavaScript falsy values (including 0) as "use default"
**Fix**: Changed to nullish coalescing `??` operator: `const minConfluenceScore = rules.minConfluenceScore ?? 65;` to allow 0 as valid value (only defaults when null/undefined)

## Files Modified

1. **services/trading-engine/src/backtesting/BacktestRunner.ts**
   - Added comprehensive pipeline flow documentation in header comments

2. **services/trading-engine/src/strategy/v2/SMCStrategyV2.ts**
   - Line 103: Changed MIN_ITF_CANDLES from hardcoded constant to instance variable
   - Line 132: Made MIN_ITF_CANDLES configurable via `SMC_MIN_ITF_CANDLES` env variable

3. **services/trading-engine/src/backtesting/CandleReplayEngine.ts**
   - Line 262: Fixed executionFilterState parameter (was `undefined`, now `this.config.executionFilterState`)
   - Line 267: Fixed logging bug (changed `.reason` to `.reasons?.join('; ')`)

4. **services/trading-engine/src/config/executionFilterConfig.ts**
   - Lines 38-44: Added env overrides for requireHtfAlignment, requireBosInDirection, requireLiquiditySweep, requireDisplacementCandle
   - Line 69: Added env override for minConfluenceScore

5. **services/trading-engine/src/strategy/v3/ExecutionFilter.ts**
   - Lines 126-137: Added env override for Premium/Discount check (`EXEC_FILTER_REQUIRE_PREMIUM_DISCOUNT`)
   - Lines 151-158: Added env override for FVG check (`EXEC_FILTER_REQUIRE_FVG`)
   - Line 194: **CRITICAL BUG FIX** - Changed `||` to `??` for minConfluenceScore to allow 0 as valid value

6. **.env** (root)
   - Lines 66-82: Set `SMC_MIN_HTF_CANDLES=1`, `SMC_MIN_ITF_CANDLES=1`
   - Added `EXEC_FILTER_REQUIRE_PREMIUM_DISCOUNT=false` and `EXEC_FILTER_REQUIRE_FVG=false`
   - All execution filter relaxed overrides

7. **services/trading-engine/.env** (new file)
   - Created with all SMC candle minimums set to 1
   - All execution filter checks disabled for backtesting

## Environment Variables for Relaxed Backtesting

```bash
# SMC Strategy - Minimal Requirements for Backtesting
SMC_MIN_HTF_CANDLES=1  # Reduced from 3 - allows signals from first H4 candle
SMC_MIN_ITF_CANDLES=1  # Reduced from 5 - allows signals from first M15 candle
SMC_REQUIRE_LTF_BOS=false
SMC_MIN_ITF_BOS_COUNT=0
SMC_DEBUG=true
SMC_DEBUG_FORCE_MINIMAL_ENTRY=true

# Execution Filter - Fully Relaxed for Backtesting
EXEC_FILTER_REQUIRE_HTF_ALIGNMENT=false
EXEC_FILTER_REQUIRE_BOS=false
EXEC_FILTER_REQUIRE_LIQUIDITY_SWEEP=false
EXEC_FILTER_REQUIRE_DISPLACEMENT=false
EXEC_FILTER_REQUIRE_PREMIUM_DISCOUNT=false  # NEW: Allows neutral zone entries
EXEC_FILTER_REQUIRE_FVG=false  # NEW: No Fair Value Gap requirement
EXEC_FILTER_MIN_CONFLUENCE_SCORE=0  # Set to 0 to disable confluence check
EXEC_FILTER_REQUIRE_VOLUME_IMBALANCE_ALIGNMENT=false
```

## How to Run Backtest

```bash
cd services/trading-engine
pnpm backtest --symbol XAUUSD --from 2024-03-21 --to 2024-07-21
```

## Next Steps

1. **Extend backtest period**: Test with longer periods (1 week to 1 month) to generate sufficient H4 candles for swing detection
2. **Lower swing detection thresholds**: Consider adjusting swing detection logic to work with fewer H4 candles or smaller price movements
3. **Alternative timeframes**: Consider using H1 or H2 as HTF instead of H4 for faster backtesting
4. **Mock data quality**: Verify that mock data generator produces realistic price movements for swing detection

## Key Insights

- **Pipeline Flow**: M5 candles → expand to M1 → aggregate to H4/M15 → SMC analysis → signal generation → execution filter → trade execution
- **Bottleneck**: Swing detection on HTF requires sufficient candles and price movement - may need 1+ weeks of data
- **Configuration**: Two-layer gating: SMC strategy layer (SetupGateService) + Execution filter layer - both must be relaxed for minimal entry mode
- **Env Loading**: Backtest processes load .env from cwd (services/trading-engine), not project root

## Status

- Signal generation: ✅ Working (after HTF/ITF candle minimum fixes)
- Execution filter: ✅ Fully Relaxed (all checks disabled, confluence score=0 via `??` operator fix)
- Trade execution: ✅ **WORKING!** - Producing non-zero trades
  - 3-day backtest (2024-03-21 to 2024-03-24): **15 trades executed**
  - 4-month backtest (2024-03-21 to 2024-07-21): Running...
- **Root Cause Resolved**: Critical bug in ExecutionFilter.ts line 194 - changed `||` to `??` to allow minConfluenceScore=0
