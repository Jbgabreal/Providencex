# SMC Strategy - 3.0 R:R Implementation & Analysis

## Objective
Achieve 30-40% monthly return with 1:3 risk:reward ratio (TP_R_MULT = 3.0)

## Code Changes Made

### 1. M1ExecutionService.ts (Line 34-37)
**Before:**
```typescript
constructor(riskRewardRatio: number = 2.0) {
  this.ltfStructure = new MarketStructureLTF(20);
  this.riskRewardRatio = riskRewardRatio;
}
```

**After:**
```typescript
constructor(riskRewardRatio: number = 3.0) {
  this.ltfStructure = new MarketStructureLTF(20);
  this.riskRewardRatio = riskRewardRatio;
  logger.info(`[M1ExecutionService] Initialized with R:R ratio: ${riskRewardRatio}`);
}
```

### 2. SMCStrategyV2.ts (Line 275-278)
**Before:**
```typescript
this.m1ExecutionService = new M1ExecutionService(2.0); // 2R risk:reward
```

**After:**
```typescript
// Read R:R ratio from environment (default 3.0 for 1:3 risk:reward)
const tpRMult = parseFloat(process.env.TP_R_MULT || '3.0');
this.m1ExecutionService = new M1ExecutionService(tpRMult);
logger.info(`[SMCStrategyV2] Using TP_R_MULT=${tpRMult} (1:${tpRMult} risk:reward)`);
```

### 3. .env Configuration
```bash
# Risk:Reward Configuration (1:3 target = 30-40% monthly growth)
TP_R_MULT=3.0
```

## ❌ CRITICAL ISSUE: R:R Target Not Achieved

### Validation Test Results (1 Month: 2024-03-21 to 2024-04-21)
```
Configuration: TP_R_MULT=3.0, CONFLUENCE=70, All filters enabled

Total Trades: 65
Win Rate: 32.31%
Average R:R: 1.32  ← TARGET WAS 3.0!
Profit Factor: 0.94
Max Drawdown: 21.51%
Total Return: -11.43%
Monthly Return: -11.43%
```

### Problem Analysis

**What's Happening:**
- We SET take profit at 3R (3× the risk)
- But stops are getting hit BEFORE price reaches TP
- Actual achieved R:R is only 1.32

**Why This Matters:**
```
With 32% Win Rate:
- At 1.32 R:R: Expectancy = 0.32 × 1.32 - 0.68 × 1 = -0.26 (LOSING)
- At 3.0 R:R:  Expectancy = 0.32 × 3.0 - 0.68 × 1 = +0.28 (WINNING)
```

**Root Causes:**
1. **Stop Loss Too Tight**: SL is placed too close to entry relative to XAUUSD volatility
   - Current: SL based on M1 swing lows/highs inside M15 zone
   - May need wider buffer or ATR-based stops

2. **Poor Entry Timing**: Entering at suboptimal price levels
   - May be entering too early (before pullback completes)
   - Or entering into immediate resistance/support

3. **Market Conditions**: 82% HTF sideways (ranging market)
   - Strategy designed for trending markets
   - Ranging conditions cause whipsaws at stops

4. **Displacement/Sweep Requirements**: May be forcing entries on weak setups
   - All filters enabled might be too restrictive
   - Finding setups in choppy conditions

## Proposed Solutions

### Option 1: Widen Stop Loss Buffer
Modify `M1ExecutionService.ts` stop loss calculation:

**Current (Line 219-220):**
```typescript
const stopLoss = relevantLows.length > 0
  ? relevantLows[relevantLows.length - 1] - 0.0001 // Small buffer
```

**Proposed:**
```typescript
const stopLoss = relevantLows.length > 0
  ? relevantLows[relevantLows.length - 1] - (atr * 0.5) // ATR-based buffer
```

### Option 2: Partial Take Profit Strategy
Add partial TP at 1.5R, move SL to breakeven:
- Take 50% profit at 1.5R
- Move SL to breakeven
- Let remaining 50% run to 3R

### Option 3: Relax Confluence Requirements
Test lower confluence scores (40, 50) to find better entry setups:
- May get more trades with better timing
- Trade quality might improve with more options

### Option 4: Trailing Stop Loss
Implement trailing stop that locks in profits:
- Once trade reaches 1R, trail stop at 0.5R
- Once reaches 2R, trail at 1R
- Protects profits while allowing runner

## Next Steps

1. **Run Optimization Grid** with current settings to establish baseline
   - Test confluence: [60, 70, 80]
   - Test risk per trade: [0.25, 0.5, 0.75]
   - Test filter combinations

2. **Analyze Trade Patterns**
   - Sample 20 losing trades
   - Identify common failure modes
   - Check if stops are consistently getting hit

3. **Implement Solution** (likely Option 1 + Option 4)
   - ATR-based stop buffer
   - Trailing stop mechanism
   - Re-test with same grid

4. **Out-of-Sample Validation**
   - Test best config on different date range
   - Verify not overfitted

## Current Status

✅ R:R configuration system implemented
✅ Optimization harness v2 created with proper pass criteria
⚠️ Strategy achieving only 1.32 R:R (not 3.0 target)
📋 Next: Run optimization grid, then implement stop loss improvements

## Commands to Run

### Single Test
```bash
cd services/trading-engine
pnpm backtest --symbol XAUUSD --from 2024-03-21 --to 2024-07-21
```

### Full Optimization
```bash
cd services/trading-engine
tsx optimize-smc-v2.ts
```

### Check Logs
```bash
tail -f backtests/run_backtest_*/summary.txt
```
