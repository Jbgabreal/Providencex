# SMC Detection Logic - Bug Report

## Investigation Summary

Per user request, I performed a thorough investigation of the SMC detection logic to verify correctness of:
- Fair Value Gap (FVG) detection
- Order Block (OB) detection
- HTF/ITF candle counting and aggregation
- Structural Swing detection
- BOS/CHoCH detection algorithms

## Bugs Found

### Bug #1: FairValueGapService - Potential Loop Boundary Issue
**File**: `services/trading-engine/src/strategy/v2/FairValueGapService.ts`
**Line**: 38
**Severity**: Low (potential edge case)

**Current Code**:
```typescript
for (let i = 1; i < recent.length - 2; i++) {
  const candle1 = recent[i - 1];
  const candle2 = recent[i];
  const candle3 = recent[i + 1];

  // Bullish FVG: Candle 1 high < Candle 3 low
  if (candle1.high < candle3.low) {
    // Creates FVG...
  }
  // Bearish FVG: Candle 1 low > Candle 3 high
  if (candle1.low > candle3.high) {
    // Creates FVG...
  }
}
```

**Issue**:
The loop condition `i < recent.length - 2` means the loop stops at `i = recent.length - 3`, so the last candle3 accessed is at index `recent.length - 2`. This misses the last possible FVG pattern in the array.

**Impact**:
May miss detecting the most recent FVG if it occurs at the end of the candle array. For a 3-candle pattern, we should be able to check up to `recent[length-3]`, `recent[length-2]`, `recent[length-1]`.

**Expected Fix**:
```typescript
// Should be: i < recent.length - 1 (not length - 2)
for (let i = 1; i < recent.length - 1; i++) {
  const candle1 = recent[i - 1];
  const candle2 = recent[i];
  const candle3 = recent[i + 1];
  // ...
}
```

**Verification**:
- When `i = 1`: candle1=recent[0], candle2=recent[1], candle3=recent[2] ✓
- When `i = recent.length - 2`: candle1=recent[length-3], candle2=recent[length-2], candle3=recent[length-1] ✓

---

### Bug #2: OrderBlockServiceV2 - Incorrect Bearish Upper Wick Calculation
**File**: `services/trading-engine/src/strategy/v2/OrderBlockServiceV2.ts`
**Line**: 65
**Severity**: HIGH (incorrect calculation)

**Current Code**:
```typescript
// Bearish Order Block: strong bearish candle with large upper wick
if (trend === 'bearish' && candle.close < candle.open) {
  const body = Math.abs(candle.close - candle.open);
  const upperWick = candle.high - candle.open;  // BUG: Wrong for bearish candles!
  const wickToBodyRatio = body > 0 ? upperWick / body : 0;

  if (wickToBodyRatio >= OB_MIN_WICK_TO_BODY_RATIO) {
    // Create bearish OB...
  }
}
```

**Issue**:
For a bearish candle (close < open):
- Candle structure: `high --- open --- close --- low`
- Upper wick extends from **close to high**, NOT from open to high
- Current code uses `candle.high - candle.open` which calculates (upper wick + body)

**Correct Candle Anatomy**:
```
Bullish Candle:         Bearish Candle:
high ----              high ----
         |                      |  <- Upper Wick
       close                  open
         |                      |  <- Body
       open                   close
         |                      |  <- Lower Wick
low  ----              low  ----
```

**Impact**:
- Bearish Order Blocks are being detected with inflated upper wick measurements
- This causes false positives for bearish OBs with large wicks
- May explain why OB detection wasn't working correctly

**Expected Fix**:
```typescript
// Bearish Order Block: strong bearish candle with large upper wick
if (trend === 'bearish' && candle.close < candle.open) {
  const body = Math.abs(candle.close - candle.open);
  const upperWick = candle.high - candle.close;  // FIXED: For bearish, wick is from close to high
  const wickToBodyRatio = body > 0 ? upperWick / body : 0;

  if (wickToBodyRatio >= OB_MIN_WICK_TO_BODY_RATIO) {
    // Create bearish OB...
  }
}
```

**Note**: Need to check if the bullish OB calculation (line 50-60) has the same issue. For bullish candles (close > open), lower wick should be `candle.open - candle.low`, NOT `candle.close - candle.low`.

---

## Services Verified as Correct

### ✓ StructuralSwingService.ts
**File**: `services/trading-engine/src/strategy/v2/smc-core/StructuralSwingService.ts`
**Status**: Correct
**Verification**: 3-impulse rule for structural swing detection is correctly implemented with proper documentation.

### ✓ BosService.ts
**File**: `services/trading-engine/src/strategy/v2/smc-core/BosService.ts`
**Status**: Correct
**Verification**:
- Bullish BOS correctly checks if candle breaks above swing high
- Bearish BOS correctly checks if candle breaks below swing low
- Deduplication logic prefers most recent broken swing
- strictClose parameter correctly implemented

### ✓ ChochService.ts
**File**: `services/trading-engine/src/strategy/v2/smc-core/ChochService.ts`
**Status**: Correct
**Verification**:
- State machine approach correctly tracks structural bias
- Anchor swing logic correctly identifies last HL for bullish, last LH for bearish
- CHoCH detection correctly identifies when opposite-direction BOS breaks anchor
- State transitions are correct

### ✓ CandleAggregator.ts
**File**: `services/trading-engine/src/services/CandleAggregator.ts`
**Status**: Correct
**Verification**:
- M1-to-timeframe mapping is correct (M5=5, M15=15, H1=60, H4=240)
- Time window grouping correctly rounds to timeframe boundaries
- H4 windows correctly use 4-hour boundaries (00:00, 04:00, 08:00, 12:00, 16:00, 20:00)
- OHLCV aggregation is correct (open=first, close=last, high=max, low=min, volume=sum)

---

## Next Steps

1. **Fix Bug #1** - FVG loop boundary condition
2. **Fix Bug #2** - Order Block bearish upper wick calculation (HIGH PRIORITY)
3. **Verify Bullish OB** - Check if bullish OB has similar lower wick bug
4. **Test with fixes** - Run backtest with corrected logic and production validation settings
5. **Compare results** - Verify that trades are generated with correctly detected SMC attributes

---

## Root Cause Analysis

The previous "fixes" (relaxing all validation checks via environment variables) were hiding these bugs:
- By setting `EXEC_FILTER_REQUIRE_FVG=false`, we bypassed FVG detection entirely
- Order Block detection bugs weren't caught because OB requirements were disabled
- Setting `EXEC_FILTER_MIN_CONFLUENCE_SCORE=0` allowed trades through without proper structural confirmation

**The real issue**: SMC attributes weren't being detected correctly due to bugs in the detection logic, not because the validation rules were too strict.

**User's insight was correct**: "the logic for some of the SMC attribute are not correct, that is why we were not meeting the production variable"
