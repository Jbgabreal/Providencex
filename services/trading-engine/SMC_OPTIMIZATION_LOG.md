# SMC v2 Strategy Optimization Log

## Overview

This log tracks optimization runs for the SMC v2 strategy targeting:
- **Risk:Reward**: 1:3 (TP_R_MULT = 3.0)
- **Target Monthly Return**: 30-40%
- **Target 4-Month Return**: 120-160%
- **Min Profit Factor**: ≥1.3
- **Max Drawdown**: ≤25%
- **Min Trade Count**: 30-200 trades
- **Min Win Rate**: ≥35% (with 3R, even 35% WR is profitable)

## Test Window
- **Symbol**: XAUUSD
- **Period**: 2024-03-21 to 2024-07-21 (4 months)

## Parameter Grid
- **R:R Multiplier**: 3.0 (fixed)
- **Confluence Thresholds**: 60, 70, 80
- **Risk Per Trade**: 0.25%, 0.5%, 0.75%, 1.0%
- **Filter Combinations**:
  - **All**: HTF + BOS + Sweep + Displacement + PD + FVG
  - **No_Sweep**: HTF + BOS + Displacement + PD + FVG
  - **Core_Plus**: HTF + BOS + PD + FVG

## Scoring System (0-100)
- Monthly Return: 0-40 points
- Profit Factor: 0-20 points
- Drawdown: 0-20 points
- Trade Count: 0-10 points
- Win Rate: 0-10 points

---

## Optimization Results (3.0 R:R Target)

| Run | RR | Conf | Risk% | Filters | Trades | WR% | PF | DD% | Avg R:R | Mon% | Score | Status |
|-----|-------|------|-------|---------|--------|-----|----|----|---------|------|-------|--------|
| 0 | 3.0 | 75 | 0.5% | All | 28 | 25.0% | 1.01 | 14.19% | 1.50 | 1.35% | 25 | ❌ FAIL |
| 1 | 3.0 | 75 | 0.5% | All+ | 28 | 25.0% | 1.01 | 14.19% | 1.50 | 1.35% | 25 | ❌ FAIL |

### Iteration 0 Details (Baseline - 2024-03-21 to 2024-04-21)
- **Config**: Strict filters, confluence=75, all requirements ON
- **Key Metrics**:
  - Win Rate: 25% (7 wins / 21 losses)
  - Only 4 trades hit 3R TP, 21 hit 1R SL
  - Average R:R = 1.50 (target: 2.5-3.0)
  - Monthly return: 1.35% (target: 30-40%)
- **Diagnosis**: Type B (No Edge) + Type D (R:R Not Realized)
- **Root Causes**:
  1. POI-anchored SLs too tight (hitting in normal retracements)
  2. Entry depth insufficient (20-80% zone too wide)
  3. Displacement threshold too low (weak momentum accepted)
- **Next Action**: Iteration 1 - Improve entry quality & POI selection

### Iteration 1 Details (2024-03-21 to 2024-04-21)
- **Config Changes**:
  - Retracement depth: 40-70% (was 20-80%)
  - POI buffer: 0.0005 (was 0.0002)
  - Displacement threshold: 2.5x ATR (was 2.0x)
  - Minimum risk distance: 0.5 (new check)
- **Results**: IDENTICAL to Iteration 0
  - Same 28 trades, same metrics
  - All trades already met new criteria
- **Diagnosis**: Changes didn't filter any trades - bottleneck is elsewhere
- **Root Cause**: The 28 trades that pass are already high-quality by these metrics. The issue is:
  1. SLs being hit (21/28 = 75%) suggests POI selection or market structure issues
  2. Only 4/28 trades hit 3R TP (14%) - R:R not being realized
  3. Average R:R = 1.50 instead of 3.0 target
- **Next Action**: Iteration 2 - Focus on POI quality and entry timing (session filters, stronger confirmation)

---

## Production Candidates

_Top configurations meeting all pass criteria will be listed here after optimization runs._

### Candidate 1: TBD
- **Config**: RR=3.0, Conf=?, Risk=?%, Filters=?
- **Results**: ? trades, ?% WR, ?% monthly, PF=?, DD=?%
- **Rationale**: TBD

### Candidate 2: TBD
- **Config**: RR=3.0, Conf=?, Risk=?%, Filters=?
- **Results**: ? trades, ?% WR, ?% monthly, PF=?, DD=?%
- **Rationale**: TBD

---

## Notes

_Date: Generated 2025-01-23_

Optimization harness updated with:
1. ✅ 1:3 R:R ratio (TP_R_MULT=3.0)
2. ✅ POI-anchored stop loss logic
3. ✅ Enhanced entry quality validation
4. ✅ HTF sideways detection enabled
5. ✅ High-quality entry filters (OB wick ratio ≥0.7, FVG size ≥1.5x)
6. ✅ Comprehensive pass criteria validation

Run optimization with: npx tsx optimize-smc-v2.ts
