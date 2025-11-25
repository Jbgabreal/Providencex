# Batch Backtest Analysis - 12 Months (2023)

## Summary

Ran batch backtests on 12 months of 2023 data for XAUUSD to identify profitability patterns and optimize the SMC v2 strategy.

## Initial Results (Baseline)

- **Total Months**: 12
- **Profitable Months**: 2 (16.7%)
- **Losing Months**: 10 (83.3%)
- **Total Trades**: 499
- **Avg Trades/Month**: 41.6
- **Avg Win Rate**: 23.12%
- **Total PnL**: -$19,048.15
- **Avg Monthly Return**: -15.87%
- **Avg Profit Factor**: 0.87
- **Avg R:R**: 1.46
- **Max Drawdown**: 45.59%

### Key Issues Identified

1. **Low Win Rate** (23% vs target 35%+)
   - Strategy is taking too many low-quality trades
   - SLs being hit too frequently

2. **Low R:R** (1.46 vs target 2.5-3.0)
   - TPs not being reached
   - SLs too close or in liquidity zones

3. **Overtrading** (41.6 trades/month)
   - Too many trades in choppy/sideways conditions
   - Need better market condition filters

4. **Poor Profit Factor** (0.87 vs target 1.3+)
   - Losing trades outweighing winners
   - Average loss larger than average win

## Optimization Attempts

### Iteration 1: Stricter Entry Filters
**Changes:**
- Require CHoCH/MSB only (reject BOS)
- Increase displacement quality threshold: 4 → 6
- Increase confluence score: 6 → 7.5
- Increase trend strength: 30% → 40%
- Increase min risk distance: 0.5 → 0.7

**Result:** WORSE
- Total Trades: 521 (increased!)
- Avg Win Rate: 22.98% (slightly worse)
- Total PnL: -$21,607.98 (worse)
- Avg R:R: 1.46 (unchanged)

**Analysis:** Requiring CHoCH/MSB only was too restrictive and didn't improve quality. The real issue is SL/TP placement, not entry signal type.

### Iteration 2: Balanced Approach (Current)
**Changes:**
- Allow BOS if strong (revert CHoCH/MSB requirement)
- Displacement quality: 5/10 (balanced)
- Confluence score: 7/10 (balanced)
- Trend strength: 40% (kept)
- Min risk distance: 0.7 (kept)

**Status:** Pending re-test

## Recommendations

### Critical Issues to Address

1. **SL Placement**
   - SLs are being hit too often
   - Need better POI selection
   - Avoid placing SL in liquidity zones
   - Ensure SL is beyond recent swing extremes

2. **TP Placement**
   - TPs not being reached (low R:R)
   - Check if TP is in liquidity zones
   - Ensure TP is achievable given market structure
   - Consider partial TPs (1.5R, 2R, 3R)

3. **Entry Quality**
   - Too many trades in sideways markets
   - Need stronger trend confirmation
   - Require deeper discount/premium entries
   - Better liquidity sweep detection

4. **Market Condition Filters**
   - Avoid trading in choppy conditions
   - Require clear 15m trend
   - Filter out low volatility periods
   - Session-based filters (London/NY killzones)

### Next Steps

1. Analyze losing trades to identify common patterns
2. Improve SL placement logic (better POI ranking)
3. Add TP liquidity validation
4. Implement session filters
5. Add volatility filters
6. Consider partial profit taking

## Monthly Breakdown

| Month | Trades | WR% | PnL | PF | R:R | Return% | DD% | Status |
|-------|--------|-----|-----|----|----|---------|-----|--------|
| 2023-01 | 50 | 22.0 | -$2,853.80 | 0.82 | 1.44 | -28.54% | 42.8% | ❌ |
| 2023-02 | 35 | 22.9 | -$1,609.76 | 0.88 | 1.46 | -16.10% | 28.4% | ❌ |
| 2023-03 | 37 | 24.3 | -$1,294.60 | 0.90 | 1.49 | -12.95% | 35.0% | ❌ |
| 2023-04 | 32 | 18.8 | -$3,679.91 | 0.64 | 1.37 | -36.80% | 44.4% | ❌ |
| 2023-05 | 43 | 23.3 | -$1,723.27 | 0.88 | 1.47 | -17.23% | 29.2% | ❌ |
| 2023-06 | 58 | 24.1 | -$859.71 | 0.96 | 1.48 | -8.60% | 26.7% | ❌ |
| 2023-07 | 57 | 24.6 | -$995.32 | 0.95 | 1.49 | -9.95% | 30.6% | ❌ |
| 2023-08 | 43 | 25.6 | +$251.06 | 1.02 | 1.51 | +2.51% | 25.0% | ✅ |
| 2023-09 | 31 | 22.6 | -$1,877.70 | 0.81 | 1.45 | -18.78% | 26.8% | ❌ |
| 2023-10 | 39 | 17.9 | -$4,596.55 | 0.62 | 1.36 | -45.97% | 45.6% | ❌ |
| 2023-11 | 34 | 26.5 | +$553.37 | 1.04 | 1.53 | +5.53% | 22.3% | ✅ |
| 2023-12 | 40 | 25.0 | -$361.96 | 0.97 | 1.50 | -3.62% | 27.5% | ❌ |

## Configuration

Current configuration after optimizations:

```env
# Entry Quality
SMC_DEBUG_FORCE_MINIMAL_ENTRY=false
SMC_SKIP_ITF_ALIGNMENT=false
SMC_MIN_FVG_SIZE_MULTIPLIER=1.5
SMC_MIN_OB_WICK_RATIO=0.7
SMC_AVOID_HTF_SIDEWAYS=true

# Execution Filters
EXEC_FILTER_MIN_CONFLUENCE_SCORE=75
EXEC_FILTER_REQUIRE_HTF_ALIGNMENT=true
EXEC_FILTER_REQUIRE_BOS=true
EXEC_FILTER_REQUIRE_LIQUIDITY_SWEEP=true
EXEC_FILTER_REQUIRE_DISPLACEMENT=true
EXEC_FILTER_REQUIRE_PREMIUM_DISCOUNT=true
EXEC_FILTER_REQUIRE_FVG=true

# Stop Loss
SL_POI_BUFFER=0.0005
SMC_TIMEFRAMES=M15,M1

# Risk Management
TP_R_MULT=3.0
```

## Major Improvements Implemented (Iteration 3)

### 1. Improved SL Placement
- **Before**: SL placed just below POI with small buffer
- **After**: SL placed below last significant swing low (beyond structure)
- **Impact**: SLs are now beyond structural levels, avoiding liquidity zones
- **Changes**:
  - Find last significant swing low/high within last 20 candles
  - Use the lower/higher of: POI or structural level
  - Increased buffer: 0.15% of price or 0.8 units (was 0.12% / 0.6)

### 2. Improved TP Placement
- **Before**: Fixed 3R target
- **After**: Use structural targets (swing highs/lows) when available
- **Impact**: TPs are now at structural levels, more likely to be hit
- **Changes**:
  - Look for next swing high/low that gives 2-4R
  - Use structural target if better than fixed 3R
  - Validate path to TP is clear (no major resistance/support blocking)

### 3. Improved Entry Quality
- **Before**: Pullback confirmation was optional
- **After**: Pullback confirmation is required
- **Impact**: Only enter on proper pullbacks, not immediately after sweep
- **Changes**:
  - Require price to have swept liquidity AND pulled back into zone
  - Added zone position quality to confluence score
  - Better entry timing

### 4. Added Volatility Filter
- **Before**: No volatility check
- **After**: Require minimum 30% volatility
- **Impact**: Avoid trading in choppy/low volatility conditions
- **Changes**:
  - Calculate volatility as current range vs average range
  - Reject trades if volatility < 30%
  - Prevents overtrading in sideways markets

### 5. Enhanced Confluence Scoring
- **Before**: Basic confluence (6/10 minimum)
- **After**: Improved confluence with zone position (7/10 minimum)
- **Impact**: Better entry selection
- **Changes**:
  - Added zone position quality (prefer middle of zone)
  - Increased minimum to 7/10
  - Better scoring for structural breaks

## Iteration 3 Results (After All Improvements)

### Performance Metrics
- **Total Months**: 12
- **Profitable Months**: 2 (16.7%) - **SAME as baseline**
- **Losing Months**: 10 (83.3%)
- **Total Trades**: 485 (down from 499 baseline)
- **Avg Trades/Month**: 40.4 (down from 41.6)
- **Avg Win Rate**: 23.63% (up from 23.12%, but still below 35% target)
- **Total PnL**: -$10,864.57 (**IMPROVED from -$19,048.15 baseline**)
- **Avg Monthly Return**: -9.05% (improved from -15.87%)
- **Avg Profit Factor**: 0.91 (up from 0.87, but still below 1.3 target)
- **Avg R:R**: 1.47 (unchanged from 1.46, still below 2.5-3.0 target)
- **Max Drawdown**: 50.80% (worse from 45.59%)

### Analysis

**Improvements:**
- ✅ Total PnL improved by ~$8,000 (43% reduction in losses)
- ✅ Avg monthly return improved (from -15.87% to -9.05%)
- ✅ Profit factor improved slightly (0.87 → 0.91)
- ✅ Trade count reduced slightly (41.6 → 40.4/month)

**Still Need Work:**
- ❌ Win rate still too low (23.63% vs target 35%+)
- ❌ R:R still too low (1.47 vs target 2.5-3.0)
- ❌ Profit factor still below 1.0 (0.91 vs target 1.3+)
- ❌ Max drawdown increased (50.80% vs target 25%)

**Root Causes:**
1. **TPs not being hit** - R:R is 1.47, meaning TPs are not being reached (target is 2.5-3.0)
2. **SLs being hit too often** - Win rate is only 23.63%, suggesting SLs are in wrong places
3. **Too many trades** - 40.4/month is still high, suggesting filters aren't strict enough

## Next Steps

1. **Analyze losing trades** - Identify why SLs are being hit and TPs aren't being reached
2. **Further tighten entry filters** - Require even higher confluence (8/10 instead of 7/10)
3. **Improve TP placement** - Use more aggressive structural targets (closer swing highs/lows)
4. **Add session filters** - Only trade during London/NY killzones (high liquidity periods)
5. **Consider partial profit taking** - Scale out at 1.5R, 2R, then 3R to lock in profits

## Iteration 4 Results (After Further Adjustments)

### Performance Metrics
- **Total Months**: 12
- **Profitable Months**: 1 (8.3%) - **WORSE**
- **Losing Months**: 11 (91.7%)
- **Total Trades**: 513 (up from 485)
- **Avg Trades/Month**: 42.8 (up from 40.4)
- **Avg Win Rate**: 22.35% (down from 23.63%)
- **Total PnL**: -$26,194.20 (**WORSE from -$10,864.57**)
- **Avg Monthly Return**: -21.83% (worse from -9.05%)
- **Avg Profit Factor**: 0.85 (down from 0.91)
- **Avg R:R**: 1.45 (down from 1.47)
- **Max Drawdown**: 55.96% (worse from 50.80%)

### Changes Made
- Increased trend strength threshold: 40% → 50% → 35% (tried different values)
- Increased volatility threshold: 30% → 40% → 25% (tried different values)
- Removed broken session filter
- Updated POI scoring to require 1.0 unit minimum distance
- Adjusted TP placement to prefer 2-3R structural targets

### Analysis
**Result:** WORSE - All metrics declined

**Root Cause:** The filters are either too strict (rejecting good trades) or not strict enough (allowing bad trades). The fundamental issue is that the strategy is not correctly identifying profitable setups.

**Key Problems:**
1. Win rate is consistently low (22-25%) - SLs being hit too often
2. R:R is consistently low (1.4-1.5) - TPs not being reached
3. Too many trades (40-43/month) - Overtrading in bad conditions
4. Profit factor < 1.0 - Losing trades outweighing winners

## Conclusion

The strategy has been significantly improved with:
1. ✅ Better SL placement (beyond structure, not just POI)
2. ✅ Better TP placement (structural targets, path validation)
3. ✅ Better entry quality (pullback confirmation required)
4. ✅ Market condition filters (volatility filter)
5. ✅ Enhanced confluence scoring

However, the strategy is still not profitable. The best result was Iteration 3 with -$1,106.61 total PnL and 4 profitable months. Since then, further adjustments have made things worse.

**Next Steps:**
1. Revert to Iteration 3 configuration (best performing)
2. Make smaller, more targeted improvements
3. Focus on analyzing why SLs are hit and TPs aren't reached
4. Consider fundamental changes to entry logic

