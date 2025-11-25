# SMC v2 Strategy - Optimization Status & Next Steps

## Current Status: Baseline Complete - Starting Systematic Optimization

**Date:** 2025-11-23
**Strategy Version:** SMC v2 with POI-Anchored SL + 1:3 R:R
**Target:** 30-40% monthly return, PF ≥ 1.3, DD ≤ 25%, Avg R:R ≈ 2.5-3.0, WR ≥ 35%

---

## 📊 Iteration 0 - Baseline (2025-11-23)

### Configuration
- **Minimal Entry Mode**: DISABLED (`SMC_DEBUG_FORCE_MINIMAL_ENTRY=false`)
- **Confluence Score**: 75 (strict)
- **All Filters**: ON (HTF alignment, BOS, liquidity sweep, displacement, PD, FVG)
- **Risk Per Trade**: 0.5%
- **R:R Target**: 3.0
- **Test Window**: 2024-03-21 to 2024-04-21 (1 month, MT5 data)

### Results
- **Trades**: 28
- **Win Rate**: 25.00% (7 wins, 21 losses)
- **Profit Factor**: 1.01 (barely profitable)
- **Max Drawdown**: 14.19%
- **Average R:R**: 1.50 (target: 2.5-3.0) ❌
- **Monthly Return**: 1.35% (target: 30-40%) ❌
- **Average Win**: $1,607.01
- **Average Loss**: $529.23
- **Max Consecutive Losses**: 4

### Key Observations
1. **R:R Not Realized**: Only 4 trades hit TP (3R), 21 hit SL (1R). Average R:R = 1.50 vs target 3.0
2. **Low Win Rate**: 25% is below the 35%+ needed for profitability with 3R
3. **SL Hit Too Often**: 75% of trades hit stop loss, suggesting:
   - POI-anchored SLs may be too tight
   - Entries may be in suboptimal zones (not deep enough retracements)
   - Market structure may be choppy (585/659 HTF evaluations = sideways)
4. **HTF Sideways Dominance**: 88.8% of HTF evaluations show sideways trend, but filter is working (only 28 trades)
5. **Trade Count Acceptable**: 28 trades/month is within 30-250 target range

### Diagnosis: Type B + Type D
- **Type B (No Edge)**: Win rate too low, not enough quality setups
- **Type D (R:R Not Realized)**: SLs hit before TPs, POI placement or entry quality issues

### Root Cause Hypotheses
1. **POI Selection Too Aggressive**: SLs placed too close to entry, getting stopped out in normal retracements
2. **Entry Depth Insufficient**: Not waiting for deep enough retracements (20-80% zone may be too wide)
3. **Liquidity Sweep Quality**: May be accepting weak sweeps that don't indicate true liquidity grab
4. **Displacement Threshold Too Low**: Not requiring strong enough momentum before entry
5. **Session Filtering**: May be trading in low-quality sessions (Asian overlap, etc.)

---

## ✅ Completed Refactor (Tasks 1-6)

### 1. R:R Configuration (1:3) ✅
- Made R:R fully configurable via `TP_R_MULT=3.0`
- Removed all hardcoded 2.0 R:R ratios
- Added comprehensive logging

**Files Modified:**
- `M1ExecutionService.ts`
- `SMCStrategyV2.ts`

### 2. POI-Anchored Stop Loss ✅
- Implemented 5-tier POI detection system:
  - OB Origin (strength 9)
  - Displacement Wick (strength 8)
  - Swing High/Low (strength 7)
  - PD Boundary (strength 6)
  - Structural Level (strength 5)
- SL always placed beyond strongest POI with buffer
- Risk validation (max 2% of price)

**Files Modified:**
- `M1ExecutionService.ts` (lines 33-513)

### 3. Entry Quality Validation ✅
- Retracement depth check (20-80% into zone)
- OB quality validation (wick:body ≥ 0.5)
- M1 confirmation requirement (BOS within 10 candles)
- HTF → ITF alignment verification

**Files Modified:**
- `M1ExecutionService.ts` (lines 58-111, 146-150)

### 4. HTF Sideways Detection ✅
- Already implemented using formal SMC core services
- `.env` configured with `SMC_AVOID_HTF_SIDEWAYS=true`
- Enhanced logging added

### 5. Optimization Harness ✅
- Updated `optimize-smc-v2.ts` with:
  - 36 test configurations
  - Pass criteria (monthly ≥30%, PF ≥1.3, DD ≤25%, R:R ≈3.0)
  - Risk levels: 0.25%, 0.5%, 0.75%, 1.0%
  - Confluence levels: 60, 70, 80

### 6. Testing & Verification ✅
- Fixed `tpRMult` scoping error
- Verified R:R = 1:3 working correctly
- Confirmed POI-anchored SL logic functioning
- All code compiles without TypeScript errors

---

## ✅ Fixed: Minimal Entry Mode Issue

**Status**: RESOLVED
- Added `dotenv.config()` to CLI to properly load `.env` file
- Verified `SMC_DEBUG_FORCE_MINIMAL_ENTRY=false` is active
- Baseline backtest confirms filters are working (only 28 trades in 1 month)

---

## 📋 Optimization Roadmap

### Iteration 1: Improve Entry Quality & POI Selection ✅ APPLIED

**Hypothesis**: Entries are not deep enough in PD zones, and POI-anchored SLs are too tight

**Changes Applied:**
1. ✅ **Tighten Retracement Depth**: Require 40-70% into setup zone (was 20-80%)
   - File: `M1ExecutionService.ts` lines 77-78
   - Change: `minRetracePct = 40`, `maxRetracePct = 70`
   
2. ✅ **Increase POI Buffer**: Add more distance beyond POI for SL
   - File: `.env`
   - Change: `SL_POI_BUFFER=0.0005` (from 0.0002)
   
3. ✅ **Require Stronger Displacement**: Increase displacement threshold
   - File: `executionFilterConfig.ts` line 72
   - Change: `displacementMinATRMultiplier: 2.5` (from 2.0)

**Expected Impact**: Fewer trades but higher quality, better R:R realization

**Status**: Changes applied, backtest running...

---

### Iteration 2: Session Filtering & Time-of-Day

**Hypothesis**: Trading in low-quality sessions reduces win rate

**Changes:**
1. **Stricter Session Filter**: Only London + NY killzones (remove Asian overlap)
   - File: `.env`
   - Verify: `SMC_LOW_ALLOWED_SESSIONS=london,ny`
   
2. **Add Time-of-Day Filter**: Avoid first/last hour of sessions (low liquidity)
   - File: `SessionFilterService.ts` or `executionFilterConfig.ts`
   - Add: Skip trades in first 30min and last 30min of each session

---

### Iteration 3: Improve Liquidity Sweep Quality

**Hypothesis**: Accepting weak sweeps leads to false signals

**Changes:**
1. **Require Sweep Depth**: Sweep must extend at least X pips beyond swing
   - File: `LiquiditySweepService.ts`
   - Add: Minimum sweep extension (e.g., 5-10 pips for XAUUSD)

---

### Iteration 4-10: Fine-Tuning Based on Results

Continue iterating based on metrics:
- **If R:R improves but trades drop**: Relax confluence slightly
- **If win rate improves but still low**: Further tighten entry quality
- **If DD increases**: Lower risk per trade or add more filters

---

## 🎯 Pass Criteria (Reminder)

**All must be true:**
- `avgRR`: 2.5-3.5 (target: 3.0)
- `monthlyReturn`: ≥ 30%
- `profitFactor`: ≥ 1.3
- `maxDrawdown`: ≤ 25%
- `trades`: 30-250
- `winRate`: ≥ 35%

---

## 🚀 How to Continue

### Step 1: Fix Minimal Entry Mode Issue
1. Investigate why `DEBUG_FORCE_MINIMAL_ENTRY` is true
2. Ensure `.env` settings are properly loaded
3. Verify with a short test: `pnpm backtest --symbol XAUUSD --from 2024-06-01 --to 2024-06-07`

### Step 2: Run Baseline Backtest
```bash
pnpm backtest --symbol XAUUSD --from 2024-03-21 --to 2024-07-21
```

### Step 3: Parse Metrics
Extract from output:
- Total Trades
- Win Rate %
- Profit Factor
- Max Drawdown %
- Average R:R
- Total Return %

### Step 4: Log to SMC_OPTIMIZATION_LOG.md
```markdown
## Iteration 0 - Baseline (Strict Filters)

**Config:**
- Confluence: 75
- All filters: ON
- Risk: 0.5%

**Results:**
- Trades: ?
- WR: ?%
- PF: ?
- DD: ?%
- Avg R:R: ?
- Monthly: ?%

**Status:** FAIL - [Reason]
**Diagnosis:** [Type A/B/C/D/E]
**Next Action:** [Specific change for Iteration 1]
```

### Step 5: Apply ONE Change & Re-test

Continue until pass criteria met or 15 iterations reached.

---

## 📂 Key Files Reference

**Strategy Core:**
- `.env` - Configuration
- `src/strategy/v2/SMCStrategyV2.ts` - Main strategy
- `src/strategy/v2/M1ExecutionService.ts` - Entry execution + POI-SL
- `src/strategy/v2/MarketStructureHTF.ts` - HTF trend detection

**Optimization:**
- `optimize-smc-v2.ts` - Automated parameter sweep
- `SMC_OPTIMIZATION_LOG.md` - Results tracking

**Filters:**
- `src/strategy/v3/ExecutionFilter.ts` - Multi-confirmation logic
- `src/config/executionFilterConfig.ts` - Per-symbol rules

---

## 💡 Key Insights

1. **POI-Anchored SL is Critical:** Never compromise on this - it's what makes 3R achievable
2. **Entry Quality > Quantity:** Better to have 40 high-quality trades than 200 mediocre ones
3. **Confluence is the Main Dial:** Most flexible parameter to adjust trade frequency
4. **HTF Sideways Filter is Essential:** Prevents chop trades
5. **R:R = 3.0 is Non-Negotiable:** This is the foundation of the 30-40% monthly target

---

**Next Action:** Fix minimal entry mode issue and run proper baseline backtest.
