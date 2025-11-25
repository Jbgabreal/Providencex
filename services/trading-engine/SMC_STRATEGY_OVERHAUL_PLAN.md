# SMC Strategy Overhaul - Implementation Plan

## Current Issues Identified

### 1. CHoCH Detection = 0 Despite Many BOS Events
**Problem:** Logs show CHoCH=0 while BOS counts are in tens/hundreds
**Root Cause Analysis Needed:**
- CHoCH state machine may not be initializing correctly
- Anchor swing detection may be failing
- BOS events may not be breaking anchor swings properly

### 2. ITF Trend Always "Sideways"
**Problem:** ITF trend bias is almost always "sideways"
**Root Cause:** 
- TrendService `minSwingPairs` may be too strict (requires 2 pairs for ITF)
- HH-HL/LL-LH pattern detection may not be working correctly
- PD array confirmation may be too strict

### 3. Swing Detection Issues
**Current:** Uses pivot-based detection but may not be optimal
**Needed:** Configurable pivotLeft/pivotRight parameters

### 4. Risk Management Missing
**Problem:** No stop-loss/take-profit calculation
**Needed:** SL at opposite side of OB/FVG, TP at next liquidity pool or R:R target

### 5. Entry Logic Too Loose
**Problem:** Large negative PnL (3 wins out of 17 trades, -25% return)
**Needed:** Stricter entry conditions with proper confluence

## Implementation Strategy

### Phase 1: Fix Core Services (Priority 1)

#### 1.1 Fix Swing Detection
- ✅ Already uses pivot-based method (good)
- 🔧 **Action:** Make pivotLeft/pivotRight configurable via env vars
- 🔧 **Action:** Add validation to ensure sufficient candles

#### 1.2 Fix BOS Detection  
- ✅ Already has strictClose option (good)
- 🔧 **Action:** Add relaxed mode option (wick break + confirming close)
- 🔧 **Action:** Ensure BOS events are properly logged

#### 1.3 Fix CHoCH Detection
- 🔧 **Action:** Debug why CHoCH = 0 despite BOS events
- 🔧 **Action:** Fix state machine initialization
- 🔧 **Action:** Ensure anchor swing is properly set/updated
- 🔧 **Action:** Add comprehensive logging

#### 1.4 Fix Trend Bias Determination
- 🔧 **Action:** Reduce minSwingPairs for ITF (currently 2, may need 1)
- 🔧 **Action:** Fix HH-HL/LL-LH pattern detection
- 🔧 **Action:** Improve PD array overlay logic
- 🔧 **Action:** Add fallback for limited candles

### Phase 2: Enhance Multi-Timeframe Alignment (Priority 2)

#### 2.1 HTF Bias Determination
- ✅ HTFBiasService exists
- 🔧 **Action:** Verify it's working correctly
- 🔧 **Action:** Ensure proper PD array integration

#### 2.2 ITF Structure Alignment
- ✅ ITFBiasService exists  
- 🔧 **Action:** Fix ITF trend detection (currently always sideways)
- 🔧 **Action:** Ensure ITF structure aligns with HTF bias

#### 2.3 LTF Entry Refinement
- ✅ EntryRefinementService exists
- 🔧 **Action:** Enhance with OB/FVG/MB confluence
- 🔧 **Action:** Add liquidity sweep detection
- 🔧 **Action:** Require LTF CHoCH/BOS in HTF/ITF direction

### Phase 3: Risk Management (Priority 3)

#### 3.1 Stop-Loss Calculation
- 🔧 **Action:** Calculate SL at opposite side of OB/FVG
- 🔧 **Action:** Fallback to recent LTF swing
- 🔧 **Action:** Add minimum SL distance validation

#### 3.2 Take-Profit Calculation
- 🔧 **Action:** Target next HTF liquidity pool
- 🔧 **Action:** Minimum 1:1 R:R ratio
- 🔧 **Action:** Configurable R:R multiplier (1-3x)

#### 3.3 Trade Management
- 🔧 **Action:** One trade per session per pair
- 🔧 **Action:** Daily loss limit enforcement
- 🔧 **Action:** Position sizing based on risk

### Phase 4: Code Architecture & Testing (Priority 4)

#### 4.1 Refactor for Stateless Services
- 🔧 **Action:** Remove global state from services
- 🔧 **Action:** Make each service independent (inputs → outputs)
- 🔧 **Action:** Clear separation of concerns

#### 4.2 Add Configuration
- 🔧 **Action:** Create SMC v2 config file
- 🔧 **Action:** Expose pivot periods, BOS strictness, CHoCH requirements
- 🔧 **Action:** Risk-reward parameters

#### 4.3 Add Logging & Metrics
- 🔧 **Action:** Log BOS count, CHoCH count, valid setups
- 🔧 **Action:** Track false positives/negatives
- 🔧 **Action:** Add performance metrics

## Files to Modify/Create

### Core Services (Fix)
1. `src/strategy/v2/smc-core/SwingService.ts` - Already good, just add config
2. `src/strategy/v2/smc-core/BosService.ts` - Add relaxed mode
3. `src/strategy/v2/smc-core/ChochService.ts` - **FIX CHoCH = 0 ISSUE**
4. `src/strategy/v2/smc-core/TrendService.ts` - **FIX ITF ALWAYS SIDEWAYS**

### Market Structure Services (Enhance)
5. `src/strategy/v2/MarketStructureHTF.ts` - Verify/fix
6. `src/strategy/v2/MarketStructureITF.ts` - **FIX TREND DETECTION**
7. `src/strategy/v2/MarketStructureLTF.ts` - Enhance entry logic

### Strategy Orchestrator (Refactor)
8. `src/strategy/v2/SMCStrategyV2.ts` - Enhance entry logic, add risk management

### Configuration (Create)
9. `src/config/smcV2Config.ts` - New config file with all parameters

### Risk Management (Create)
10. `src/strategy/v2/RiskManagementService.ts` - New service for SL/TP calculation

## Immediate Action Items

1. **Debug CHoCH = 0 Issue** (Critical)
   - Add detailed logging to ChochService
   - Verify state machine is initializing
   - Check anchor swing assignment

2. **Fix ITF Trend Detection** (Critical)
   - Reduce minSwingPairs from 2 to 1 for ITF
   - Fix pattern detection logic
   - Add fallback for sideways detection

3. **Add Risk Management** (High Priority)
   - Implement SL calculation service
   - Implement TP calculation service
   - Integrate into entry logic

Let me start with the most critical issues first.

