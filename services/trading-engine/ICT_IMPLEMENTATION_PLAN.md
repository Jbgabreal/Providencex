# ICT Model Implementation Plan

## Overview

Complete replacement of SMC v2 entry logic with strict ICT (Inner Circle Trader) model:
- H4 (Bias TF) → M15 (Setup TF) → M1 (Entry TF)

## Current Status

✅ Created:
- `ICTEntryService.ts` - Main ICT entry service (needs fixes)
- `ICTH4BiasService.ts` - H4 3-candle pivot bias detection

🔄 In Progress:
- Fixing M15 setup zone detection logic
- Updating timeframe configuration (H4 instead of M15 for HTF)
- Integrating ICT service into SMCStrategyV2

## Required Changes

### 1. Update Timeframe Configuration

**Current**: HTF=M15, ITF=M15, LTF=M1  
**Required**: HTF=H4, ITF=M15, LTF=M1

Update `SMCStrategyV2.ts`:
```typescript
htfTimeframe: config.htfTimeframe || 'H4', // Changed from 'M15'
itfTimeframe: config.itfTimeframe || 'M15',
ltfTimeframe: config.ltfTimeframe || 'M1',
```

### 2. Fix M15 Setup Zone Detection

**Issues to Fix**:
- Need to detect CHoCH on M15 (not use H4 structure service)
- Displacement detection logic needs improvement
- FVG should be created AFTER displacement (during the leg)
- OB should be BEFORE displacement (the zone we're returning to)

**ICT Rules for M15 Setup**:
- Bullish setup requires: Bearish CHoCH → Displacement leg → Bearish FVG → Return to demand OB
- Bearish setup requires: Bullish CHoCH → Displacement leg → Bullish FVG → Return to supply OB

### 3. Fix M1 Entry Refinement

**Current Issues**:
- Need to ensure M1 CHoCH detection works
- Entry price calculation needs to use limit order logic (OB open or 50% FVG)
- SL should be under/above M1 OB (not refined OB necessarily)

### 4. Update SL/TP Calculation

**Current**: Uses various logic  
**Required**: 
- SL: Under M1 OB for buys, above M1 OB for sells
- TP: SL × risk-reward ratio (default 1:3, configurable via SMC_RISK_REWARD)

### 5. Integration into SMCStrategyV2

**Approach**:
- Create new method: `generateICTSignal()` 
- Can be called instead of current `generateSignal()` when ICT mode enabled
- Or replace `generateSignal()` entirely if ICT is always enabled

### 6. Remove Old Confluence Logic

**To Remove**:
- Volume imbalance scoring
- Confluence score computations
- Multi-OB alignment logic
- LTF BOS optional requirements
- Old entry refinement service calls

## Implementation Steps

### Step 1: Fix ICTEntryService
- [ ] Fix M15 setup zone detection (CHoCH, displacement, FVG, OB logic)
- [ ] Fix M1 entry refinement (CHoCH detection, OB refinement)
- [ ] Fix SL/TP calculation
- [ ] Add comprehensive logging

### Step 2: Update Timeframes
- [ ] Change HTF default to 'H4'
- [ ] Update candle loading logic for H4
- [ ] Update minimum candle requirements

### Step 3: Integrate ICT Service
- [ ] Add ICTEntryService to SMCStrategyV2
- [ ] Create `generateICTSignal()` method
- [ ] Replace or add alongside current `generateSignal()`

### Step 4: Remove Old Logic
- [ ] Remove volume imbalance scoring
- [ ] Remove confluence score computations
- [ ] Remove old entry refinement calls
- [ ] Clean up unused services if needed

### Step 5: Testing
- [ ] Run backtest
- [ ] Verify ICT logs
- [ ] Check setup/entry counts
- [ ] Verify SL/TP placement

## Key Files to Modify

1. `SMCStrategyV2.ts` - Main integration point
2. `ICTEntryService.ts` - Fix logic
3. `ICTH4BiasService.ts` - Already created, may need tweaks
4. Remove/update: `EntryRefinementService.ts` usage

## Next Immediate Actions

1. Fix M15 setup zone detection in ICTEntryService
2. Fix M1 entry refinement logic
3. Update timeframe configuration to H4
4. Integrate into SMCStrategyV2

