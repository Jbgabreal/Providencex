# SMC Strategy v2 - Complete Strategy Documentation

## Strategy Overview

**Strategy Name:** Smart Money Concepts (SMC) v2 - Multi-Timeframe Confluence System  
**Trading Engine Version:** v14  
**Date:** November 21, 2024  
**Symbol Tested:** XAUUSD (Gold)  
**Timeframe Configuration:** HTF=H1, ITF=M15, LTF=M5  

---

## Backtest Results Summary

### Test Configuration
- **Date Range:** October 21, 2024 to November 21, 2024 (30 days)
- **Symbol:** XAUUSD
- **Initial Balance:** $10,000
- **Strategy:** "low" (low-risk strategy)
- **Data Source:** MT5 live historical data (M1 candles, aggregated to higher timeframes)

### Performance Metrics

| Metric | Value |
|--------|-------|
| **Total Trades** | 52 |
| **Winning Trades** | 16 (30.77%) |
| **Losing Trades** | 36 (69.23%) |
| **Total PnL** | -$2,703.52 |
| **Final Balance** | $7,296.48 |
| **Total Return** | -27.04% |
| **Profit Factor** | 0.80 |
| **Max Drawdown** | $4,064.91 (40.53%) |
| **Max Consecutive Losses** | 8 |
| **Max Consecutive Wins** | 2 |
| **Average Win** | $664.48 |
| **Average Loss** | -$370.42 |
| **Average R:R Ratio** | 1.31 |
| **Expectancy per Trade** | -$51.99 |
| **Average Trade Duration** | 387.88 minutes (~6.5 hours) |

### Key Issues Identified
1. **Low Win Rate (30.77%)** - Strategy needs better entry quality
2. **Negative Expectancy (-$51.99)** - Average loss exceeds average win benefit
3. **High Max Drawdown (40.53%)** - Risk management needs improvement
4. **Long Consecutive Loss Streak (8)** - Entry filters may be too lenient

---

## Core Strategy Components

### 1. Multi-Timeframe Analysis

#### Higher Timeframe (HTF) - H1
- **Purpose:** Determine overall trend direction
- **Requirements:**
  - Minimum 20 candles (preferably 84-100 for robust analysis)
  - Swing high/low detection (lookback: 50 candles)
  - Trend classification: bullish, bearish, or sideways
  - Price-action fallback if no swings detected (0.3% price change threshold)

#### Intermediate Timeframe (ITF) - M15
- **Purpose:** Confirm HTF trend alignment and provide Order Blocks
- **Requirements:**
  - Minimum 50 candles (preferably 100 for robust analysis)
  - BOS (Break of Structure) detection
  - Flow alignment check (must align with HTF or be neutral)
  - **CRITICAL:** ITF Order Block is **REQUIRED** (HTF Order Block is optional)

#### Lower Timeframe (LTF) - M5
- **Purpose:** Entry refinement and precision
- **Requirements:**
  - Minimum 20 candles (preferably 50 for robust analysis)
  - LTF BOS detection (preferred but optional)
  - LTF Order Block confirmation
  - LTF Liquidity Sweep confirmation
  - LTF FVG resolution (optional - contributes to confluence but not required)

---

## Entry Requirements (All Must Pass)

### Required Confluences (Hard Blockers)

1. **HTF Trend Confirmation**
   - HTF trend must be clearly bullish or bearish (no sideways)
   - Swing highs/lows detected (minimum 3 swings for trend classification)
   - Current price aligns with trend direction

2. **Premium/Discount Zone Validation**
   - **Buy trades:** Must be in **discount zone** (price below FIB 0.5)
   - **Sell trades:** Must be in **premium zone** (price above FIB 0.5)
   - Calculated from HTF swing high/low (lookback: 100 candles)

3. **ITF Flow Alignment**
   - ITF trend must align with HTF trend OR be neutral
   - Counter-trend ITF flow blocks the trade

4. **ITF Order Block (REQUIRED)**
   - Must have an unmitigated ITF Order Block in direction of trade
   - Order Block must not be broken by price action
   - **Note:** HTF Order Block is **preferred but optional** (allows more setups)

5. **Liquidity Sweep Confirmation**
   - Must have at least one liquidity sweep (HTF or LTF)
   - Sweep must align with trade direction (equality high for sell, equality low for buy)

6. **Entry Refinement (LTF)**
   - **Required:** LTF Sweep confirmed AND LTF Order Block confirmed
   - **Preferred:** LTF BOS confirmed (contributes to confluence but not hard blocker)
   - **Optional:** LTF FVG resolved (contributes to confluence score)

7. **Session Validation**
   - Must trade during allowed sessions (configurable)
   - Default for "low" strategy: London (3 AM - 11 AM NY time) and NY (8 AM - 4 PM NY time)
   - Configurable via `SMC_LOW_ALLOWED_SESSIONS` env var (e.g., "london,ny,asian")

### Soft Confluences (Score-Based)

These contribute to confluence score but don't block trades:

- HTF Order Block presence (preferred)
- LTF BOS confirmation (preferred)
- LTF FVG resolution (optional)
- SMT Divergence detection (if correlation data available)
- Trendline Liquidity confirmation
- Volume Imbalance alignment with Order Blocks + FVG (soft mode in dev)

---

## Risk Management & Position Sizing

### Stop Loss Calculation
- **Method:** Based on Order Block boundaries
  - Buy trades: Stop Loss = HTF/ITF Order Block low (whichever available, ITF as fallback)
  - Sell trades: Stop Loss = HTF/ITF Order Block high (whichever available, ITF as fallback)
- **Risk per Trade:** 0.5% of account equity (default for "low" strategy)
- **Position Size:** Calculated based on stop loss distance and risk amount

### Take Profit Calculation
- **Risk:Reward Ratio:** Fixed 1:2 (take profit = entry ± 2 × risk distance)
- **Buy trades:** TP = Entry + (2 × Risk)
- **Sell trades:** TP = Entry - (2 × Risk)

### Exposure Limits (Execution Filter v4)
- **Max Concurrent Trades per Symbol:** 2 (XAUUSD)
- **Max Concurrent Trades per Direction:** 1 (max 1 buy OR 1 sell at a time)
- **Max Daily Risk per Symbol:** $200 (XAUUSD)
- **Max Daily Trades per Symbol:** 5 (XAUUSD)
- **Min Minutes Between Trades:** 15 minutes

---

## Execution Filter Rules

### Per-Symbol Configuration (XAUUSD)

```typescript
{
  symbol: 'XAUUSD',
  enabled: true,
  allowedDirections: ['buy', 'sell'],
  
  // Multi-timeframe requirements
  requireHtfAlignment: true,
  allowedHtfTrends: ['bullish', 'bearish'], // No trades in hard range
  
  // Structural confirmations - strict requirements for gold
  requireBosInDirection: true,
  requireLiquiditySweep: true,
  requireDisplacementCandle: true,
  
  // Session windows (in engine timezone - NY time)
  enabledSessions: [
    { label: 'London', startHour: 3, endHour: 11 }, // 3 AM - 11 AM NY time
    { label: 'NY', startHour: 8, endHour: 16 },     // 8 AM - 4 PM NY time
  ],
  
  // Trade frequency limits
  maxTradesPerDay: 5,
  minMinutesBetweenTrades: 15,
  maxConcurrentTradesPerSymbol: 2,
  maxConcurrentTradesPerDirection: 1,
  maxDailyRiskPerSymbol: 200, // Max $200 risk per symbol
  
  // Price/volatility filters
  maxSpreadPips: 50, // XAUUSD-specific spread threshold
  minDistanceFromDailyHighLowPips: 30,
}
```

### Global Exposure Limits
- **Max Concurrent Trades Global:** 8
- **Max Daily Risk Global:** $500
- **Exposure Poll Interval:** 10 seconds

### Volume Imbalance Alignment
- **Mode:** Soft (in dev) - logs warning but doesn't block trade
- **Default:** Hard (in production) - blocks trade if volume imbalance doesn't align with OB + FVG
- **Configurable via:** `EXEC_FILTER_REQUIRE_VOLUME_IMBALANCE_ALIGNMENT` env var

---

## Strategy Parameters & Thresholds

### Symbol-Aware Thresholds

The strategy adjusts thresholds based on symbol price scale:

#### XAUUSD (Gold) - Price ~4000-4100
- **FVG Min Size:** 0.5 (default: 0.0001 for FX pairs)
- **Liquidity Sweep Tolerance:** 0.5 (default: 0.0001)
- **Trendline Tolerance:** 0.5 (default: 0.0001)

#### FX Pairs (EURUSD, GBPUSD) - Price ~1.0-1.3
- **FVG Min Size:** 0.0001
- **Liquidity Sweep Tolerance:** 0.0001
- **Trendline Tolerance:** 0.0001

#### US30 (Index) - Price ~39000-40000
- Uses larger thresholds similar to XAUUSD

### Default Parameters (Optimization-Ready)

```typescript
{
  // Fair Value Gap detection
  fvgMinSize: 0.0001, // Base value, adjusted per symbol
  
  // Order Block detection
  obWickBodyRatioMin: 0.5, // Minimum wick-to-body ratio for OB
  obMinVolumeFactor: 1.5, // Volume factor for OB validation
  obLookbackPeriod: 50, // Candles to look back for OB
  
  // Liquidity Sweep detection
  itfLiquiditySweepTolerance: 0.0001, // Base value, adjusted per symbol
  
  // Market Structure analysis
  htfSwingLookback: 50, // Candles for HTF swing detection
  itfBosSensitivity: 1.0, // BOS detection sensitivity (multiplier)
  ltfRefinementDepth: 20, // LTF lookback for entry refinement
  
  // Premium/Discount zones
  pdLookbackPeriod: 100, // Candles for swing high/low calculation
  
  // Entry Refinement
  ltfSweepRequired: true,
  ltfOBRequired: true,
  ltfBOSPreferred: true, // Not required, but preferred
  ltfFVGResolvedOptional: true, // Optional, contributes to score
}
```

---

## Strategy Logic Flow

### Step-by-Step Entry Process

1. **Candle Collection**
   - Fetch HTF (H1) candles (minimum 20, target 84-100)
   - Fetch ITF (M15) candles (minimum 50, target 100)
   - Fetch LTF (M5) candles (minimum 20, target 50)

2. **HTF Structure Analysis**
   - Detect swing highs/lows (lookback: 50 candles)
   - Classify trend: bullish, bearish, or sideways
   - **Reject if:** HTF trend is sideways or unclear

3. **Premium/Discount Zone Check**
   - Calculate FIB 0.5 from HTF swing high/low
   - Determine current zone: premium, discount, or neutral
   - **Reject if:** Buy in premium OR sell in discount OR neutral

4. **ITF Structure Analysis**
   - Detect BOS events (if any)
   - Classify ITF flow: aligned, neutral, or counter
   - **Reject if:** ITF flow is clearly counter to HTF (neutral is OK)

5. **Order Block Detection (Multi-Timeframe)**
   - Detect Order Blocks on HTF, ITF, LTF
   - Filter for unmitigated Order Blocks
   - **Reject if:** No ITF Order Block found (HTF OB is optional)
   - **Reject if:** Order Blocks not aligned with trade direction

6. **Fair Value Gap Detection**
   - Detect FVGs on HTF, ITF, LTF
   - Check if LTF FVG is resolved (optional but preferred)

7. **Liquidity Sweep Detection**
   - Detect sweeps on HTF and LTF
   - **Reject if:** No sweep confirmed (HTF or LTF)

8. **Volume Imbalance Check**
   - Detect volume imbalance zones on HTF and ITF
   - Check alignment with Order Blocks + FVG
   - **Soft mode:** Logs warning but doesn't block
   - **Hard mode:** Blocks if misaligned

9. **Entry Refinement (LTF)**
   - Check LTF BOS confirmation (preferred)
   - Check LTF Sweep confirmation (required)
   - Check LTF Order Block confirmation (required)
   - Check LTF FVG resolution (optional)
   - **Reject if:** LTF Sweep OR LTF OB missing

10. **Session Validation**
    - Get current trading session (Asian, London, NY)
    - Check against allowed sessions for strategy
    - **Reject if:** Not in allowed sessions

11. **Position Calculation**
    - Entry: Current market price
    - Stop Loss: Order Block boundary (HTF OB if available, else ITF OB)
    - Risk: |Entry - Stop Loss|
    - Take Profit: Entry ± (2 × Risk) [1:2 R:R]

12. **Confluence Score Calculation (0-100)**
    - Factors: HTF trend, PD valid, ITF aligned, LTF BOS, HTF OB (optional), ITF OB (required), LTF OB, Sweep, FVG resolved, VI aligned, SMT, Entry refined, Trendline, Session valid
    - Higher score = stronger setup

---

## Order Block Detection Rules

### Order Block Criteria
- **Wick-to-Body Ratio:** Minimum 0.5 (wick must be at least 50% of body size)
- **Direction:** 
  - Bullish OB: Strong bullish candle with large lower wick
  - Bearish OB: Strong bearish candle with large upper wick
- **Displacement:** Must break previous high (bullish) or low (bearish)
- **Mitigation Check:** Price has not broken through opposite side of OB

### Order Block Alignment
- ITF OB is **REQUIRED**
- HTF OB is **preferred but optional**
- LTF OB is preferred for entry refinement
- All OBs must align with trade direction
- If HTF OB exists, it must overlap or be within 0.1% of ITF OB

---

## Liquidity Sweep Detection

### Sweep Types
- **Equality High (EQH):** Price breaks previous high then reverses down (bearish signal)
- **Equality Low (EQL):** Price breaks previous low then reverses up (bullish signal)

### Sweep Criteria
- **Tolerance:** Symbol-aware (0.5 for XAUUSD, 0.0001 for FX pairs)
- **Lookback:** 50 candles
- **Confirmation:** Price must reverse after the sweep

---

## Fair Value Gap (FVG) Detection

### FVG Criteria
- **Min Size:** Symbol-aware (0.5 for XAUUSD, 0.0001 for FX pairs)
- **Definition:** Gap in price where no candle body touched (3-candle pattern)
- **Validation:** Check if FVG is filled/resolved by subsequent price action
- **LTF FVG Resolution:** Optional but preferred for entry quality

---

## Entry Refinement Service

### Refinement Requirements
- **Required (Hard Blockers):**
  - LTF Liquidity Sweep confirmed
  - LTF Order Block confirmed
  
- **Preferred (Confluence Boosters):**
  - LTF BOS confirmed (contributes to score but not required)
  
- **Optional (Nice-to-Have):**
  - LTF FVG resolved (contributes to score)

### Refinement Logic
```
refined = ltfSweepConfirmed && ltfOBConfirmed
```

Note: LTF BOS and LTF FVG resolution are not hard blockers, allowing more setups to pass.

---

## Premium/Discount Zone Calculation

### Method
1. Find swing high (highest point in last 100 candles)
2. Find swing low (lowest point in last 100 candles)
3. Calculate FIB 0.5 = (swing high + swing low) / 2
4. Compare current price to FIB 0.5:
   - **Premium:** price > FIB 0.5
   - **Discount:** price < FIB 0.5
   - **Neutral:** price ≈ FIB 0.5 (rejects trade)

### Trade Direction Rules
- **Buy trades:** Must be in discount zone (price below FIB 0.5)
- **Sell trades:** Must be in premium zone (price above FIB 0.5)
- **Neutral zone:** Blocks all trades

---

## Session Filter Configuration

### Session Definitions (NY Time)
- **Asian Session:** 18:00 (previous day) - 03:00
- **London Session:** 03:00 - 11:00
- **NY Session:** 08:00 - 16:00

### Default Configuration
- **Low Strategy:** London + NY (configurable via `SMC_LOW_ALLOWED_SESSIONS`)
- **High Strategy:** London + NY (configurable via `SMC_HIGH_ALLOWED_SESSIONS`)

### Environment Variables
```env
SMC_LOW_ALLOWED_SESSIONS=london,ny
SMC_HIGH_ALLOWED_SESSIONS=london,ny
```

Note: 'ny' is automatically mapped to 'newyork' for convenience.

---

## Execution Filter v3 Rules

### Additional Filters Applied

1. **Spread Check**
   - XAUUSD: Max 50 pips spread
   - Must pass spread threshold or trade is blocked

2. **Trade Frequency Limits**
   - Max 5 trades per day (XAUUSD)
   - Minimum 15 minutes between trades
   - Max 2 concurrent trades per symbol
   - Max 1 trade per direction at a time

3. **Exposure Limits**
   - Max $200 daily risk per symbol (XAUUSD)
   - Max $500 daily risk globally
   - Max 8 concurrent trades globally

4. **Daily High/Low Distance**
   - Must be at least 30 pips away from daily high/low (XAUUSD)

5. **News Guardrail Integration**
   - Blocks trades during "avoid" mode windows

---

## Backtest Trade Sample Analysis

From the backtest results, sample trades show:
- **Average Win:** $664.48 (16 wins)
- **Average Loss:** -$370.42 (36 losses)
- **Win Rate:** 30.77%
- **R:R Ratio:** 1.31 (targeted 2.0 but actual was lower)

**Example Winning Trade:**
- Ticket #9: Buy @ 4054.73, Exit @ 4117.93, Profit: +$695.20, Duration: 810 minutes, R:R: 2.00

**Example Losing Trades:**
- Multiple consecutive losses with relatively small losses (-$350 to -$485 range)
- Some trades hit stop loss quickly (15-minute duration)
- Some trades held longer before hitting stop loss (425 minutes)

---

## Known Issues & Areas for Improvement

### 1. Low Win Rate (30.77%)
**Problem:** Strategy is taking trades with insufficient confluence  
**Possible Causes:**
- Entry refinement may be too lenient (missing LTF BOS requirement)
- Premium/Discount zone calculation may need adjustment
- Order Block detection may be finding false positives

### 2. Negative Expectancy (-$51.99)
**Problem:** Average loss exceeds average win benefit  
**Possible Causes:**
- Win rate too low (30.77%)
- Average R:R not reaching target 2.0 (actual: 1.31)
- Position sizing may need adjustment

### 3. High Max Drawdown (40.53%)
**Problem:** Large drawdown suggests poor risk management  
**Possible Causes:**
- Too many consecutive losses (8 in a row)
- Position sizing not adjusting for drawdown
- No correlation filtering between trades

### 4. Long Trade Duration (6.5 hours average)
**Problem:** Trades held too long may indicate poor exit strategy  
**Possible Causes:**
- Fixed 1:2 R:R may not be optimal for XAUUSD volatility
- No trailing stop mechanism
- No time-based exit (some trades held 810+ minutes)

---

## Configuration Environment Variables

```env
# Strategy Configuration
USE_SMCV2=true
SMC_TIMEFRAMES=H1,M15,M5
SMC_LOW_ALLOWED_SESSIONS=london,ny
SMC_HIGH_ALLOWED_SESSIONS=london,ny

# Execution Filter
USE_EXECUTION_FILTER_V3=true
EXEC_FILTER_REQUIRE_VOLUME_IMBALANCE_ALIGNMENT=true
MAX_CONCURRENT_TRADES_GLOBAL=8
MAX_DAILY_RISK_GLOBAL=500

# Risk Management
DEFAULT_LOW_RISK_PER_TRADE=0.5
LOW_RISK_MAX_DAILY_LOSS=1.0
LOW_RISK_MAX_TRADES=2
MAX_SPREAD=0.8

# Debugging
SMC_DEBUG=true
```

---

## Next Steps for ChatGPT Analysis

When sharing this with ChatGPT, ask for:

1. **Win Rate Improvement Strategies**
   - How to increase from 30.77% to 50%+
   - Tighter entry refinement requirements
   - Better confluence scoring thresholds

2. **Expectancy Improvement**
   - How to achieve positive expectancy
   - R:R ratio optimization
   - Position sizing adjustments

3. **Drawdown Reduction**
   - Better risk management rules
   - Correlation filtering
   - Dynamic position sizing based on recent performance

4. **Trade Duration Optimization**
   - Should trailing stops be implemented?
   - Time-based exits?
   - Dynamic TP levels based on volatility?

5. **Parameter Optimization**
   - Which parameters should be tuned first?
   - Symbol-specific parameter sets
   - Walk-forward optimization suggestions

6. **Entry Quality Improvements**
   - Should LTF BOS be made a hard requirement?
   - Should Premium/Discount zone calculation be adjusted?
   - Should Order Block detection be stricter?

---

## Additional Context

- Strategy uses **real MT5 historical data** (not synthetic)
- Candles are aggregated from M1 to higher timeframes (M5, M15, H1)
- 3-month historical backfill is enabled for context
- Strategy runs every tick (1-5 second intervals in production)
- All trades are logged to `trade_decisions` table in PostgreSQL
- Execution Filter uses exposure snapshots from `live_trades` table

---

**Document Generated:** November 21, 2024  
**Last Backtest:** backtest_1763786320630  
**Strategy Version:** SMC v2 (Trading Engine v14)

