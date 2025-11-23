Trading Engine v10 — SMC Strategy v2 (Smart Money Concepts Enhanced)
Product Requirements Document (PRD)

Version: 10.0
Status: Ready for implementation
Author: ProvidenceX Architecture
Date: 2025-11-21

1. Overview

v10 introduces a new and improved Strategy Engine built on an expanded and more robust version of Smart Money Concepts (SMC). SMC v2 provides deeper market structure understanding, increases win rate, reduces false signals, and provides stronger confluence.

SMC v2 includes:

Multi-timeframe structure

Fair Value Gaps

Premium/Discount Zones

SMT Divergence

Trendline Liquidity

Multiple-TF Order Block Confirmation

Entry Refinement (M1)

EQH/EQL sweep confirmation

Volatility filter

Volume Imbalance detection (VI)

Liquidity Maps

Session-based setups

This dramatically increases confluence and filter power.

2. Goals
Primary Goals

Increase signal accuracy

Reduce losing streaks

Provide deeper structural confirmation

Enable more profitable partial entries via refined entry logic

Secondary Goals

Improve backtestability

Enable clean integration with Exit Engine (v9)

Provide a quant-friendly feature set

3. SMC v2 Components (Required)

Below are all components that MUST be implemented.

3.1 Multi-Timeframe Market Structure Engine (HTF + ITF + LTF)

HTF (H1 or H4):

Identify trend direction (bullish, bearish, consolidation)

Detect HTF BOS & CHoCH

Mark HTF premium/discount zones

Identify HTF key OBs

ITF (M15 or M5):

Detect BOS/CHoCH aligned with HTF

Identify intermediate OBs

Sweep detection

LTF (M1 or M5):

Entry refinement

STM divergence

FVG resolution

Structural confirmation

Output:
{
  htfTrend: "bullish" | "bearish" | "range",
  htfPremiumDiscount: "premium" | "discount",
  htfOB: {...},
  itfFlow: "aligned" | "counter" | "neutral",
  itfOB: {...},
  ltfEntry: "valid-refinement" | null
}

3.2 Fair Value Gaps (FVG)

Detect:

HTF FVG

ITF FVG

LTF FVG

Only trade if price imputes into FVG in direction of HTF trend.

Required logic:

FVG type (continuation, reversal)

FVG grade (wide, narrow, nested)

FVG premium/discount location

3.3 Premium / Discount Zones

Compute FIB 0.5 from:

HTF swing high/low (lookback configurable)

Only buy in discount

Only sell in premium

3.4 SMT Divergence (Smart Money Technique Divergence)

SMT uses two correlated assets:

Example:

EURUSD

DXY

Rules:

If EURUSD makes a higher high but DXY doesn’t → bearish SMT divergence

If EURUSD makes lower low but DXY doesn’t → bullish SMT divergence

Required:

Add SMT detection module

Expose SMT status in RawSignal

3.5 Trendline Liquidity (TL Liquidity)

Detect:

2-touch trendline

3-touch confirmation

Liquidity sitting above/below TL

Sweep logic around TL areas

3.6 Order Block v2 (Multi-Timeframe Confirmed OB)

SMC v1 used basic OB detection.
v2 requires:

HTF OB (main)

ITF OB (validation)

LTF OB (entry refinement)

Wick-to-body ratio

Volume imbalance near OB

Entry allowed only if:

HTF OB + ITF OB align

LTF refinement confirmation present

3.7 Liquidity Sweep Model (EQH/EQL)

Detect:

Equal Highs (EQH)

Equal Lows (EQL)

Stop hunts (liquidity sweeps)

Opposing side sweeps as entry confirmation

3.8 Entry Refinement (M1)

Before entering a trade:

Require LTF BOS in direction of HTF trend

Require LTF sweep

Require LTF ref OB

Require FVG fill

3.9 Volume Imbalance (VI)

Detect VI zones:

Thrust candles

Imbalanced bodies

VI should align with OB + FVG

3.10 Session Filters (NY, London)

Filter trades:

Only take entries during chosen sessions

Each symbol has custom mapping

Session filter overrides all other confluences

4. Signal Decision Rule
A valid SMC v2 signal exists only if ALL are true:

HTF trend = bullish/bearish

HTF is in correct PD array (discount for buys / premium for sells)

ITF structure aligns with HTF direction

LTF confirms BOS in entry direction

Liquidity sweep occurred (HTF or LTF)

Valid OB & FVG alignment

SMT divergence (optional but increases score)

Spread & volatility acceptable

Within valid session

No kill switch active

No exposure violation

If all pass → produce EnhancedRawSignal v2
5. New Data Model
EnhancedRawSignal v2:
{
  symbol,
  direction,
  htfTrend,
  premiumDiscount,
  obLevels: { htf, itf, ltf },
  fvgLevels: { htf, itf, ltf },
  smt: { bullish: boolean, bearish: boolean },
  liquiditySweep: { type, level },
  volumeImbalance: { zones: [...] },
  ltfEntryRefinedOB: {...},
  sessionValid: true/false,
  reasons: [...] // list of confluences
}

6. Execution Filter Integration

ExecutionFilter v3 must now consider:

premium/discount violation

weak OB (low score)

no SMT when required

no liquidity sweep

FVG unresolved

volume imbalance absent

volatility too high

7. Backtesting Support

Backtesting v5 must support:

FVG detection

OB v2

SMT divergence

Liquidity models

Session filters

PD arrays

LTF entry refinement

Mock or CSV historical candles must include:

OHLC

Volume

Timestamps

Optional: Use synthetic correlated feed for SMT.

8. Acceptance Criteria

StrategyService v2 must produce valid EnhancedRawSignal v2

Must filter 70–90% of bad entries

Must run < 5ms per symbol

Backtesting results must match live behavior

Admin dashboard must show v2 confluence stack

Execution Filter v3 must consume new v2 signal metadata

9. Future Work (v11+)

Dynamic ML-based scoring

Sentiment filter

Symbol correlation matrix

Auto-parameter optimization