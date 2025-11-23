Trading Engine v13 — Machine Learning Alpha + Regime Detection Layer
Product Requirements Document (PRD)

Version: 13.0
Status: Approved
Date: 2025-11-21

1. Overview

v13 introduces the ML Alpha Layer, which converts ProvidenceX into a multi-model quantitative engine.

Instead of relying purely on SMC signals, the system will now include:

1. Market Regime Detection

Detects regimes such as:

Trending (up / down)

Ranging

High volatility

Low volatility

Reversal zones

High-impact news regime

Liquidity trap regime

Momentum acceleration/decay

2. ML Probability Model

Uses engineered features + candle data to predict:

Probability of win

Expected R:R

Expected SL hit probability

Expected TP hit probability

Expected move distance in the next N minutes

3. Hybrid Decision Engine

Trade only when:

SMC signal AND

ML Alpha threshold met AND

Regime is favorable

Example:

BOS + OB + Liquidity sweep
AND
P(win) > 0.62
AND
Regime == trending_down

4. Full ML Integration into Backtesting & Dashboard

The engine logs:

ML probabilities

Regime classification

ML override reasons

ML-filtered skip reasons

2. Goals
Primary Goals

✔ Market regime classifier
✔ ML alpha model to score signals
✔ Hybrid Engine: SMC + ML + Risk + Kill Switch
✔ ML logging
✔ Backtesting support
✔ Dashboard visualization

Secondary Goals

✔ Export features for model retraining
✔ Pluggable ML models (swap model without code change)
✔ Enable reinforcement learning via historical replay

3. Architecture Additions
New module:

services/trading-engine/src/ml/

Files:

FeatureBuilder.ts
RegimeDetector.ts
MLModelInterface.ts
MLModelLightGBM.ts
MLModelONNX.ts
MLDecisionService.ts
FeatureStore.ts

4. Feature Builder (FeatureBuilder.ts)

Build engineered features from:

CandleStore

PriceFeedClient

SMC metadata

Volatility metrics

Spread metrics

Volume features

Regime labels

Feature set includes:

ATR, RSI, OB distance, BOS confirmation score,
Volatility compression score,
Range height,
Session time (encoded),
HTF trend,
LTF trend,
Distance to liquidity high/low,
Candle body %,
Candle wick asymmetry,
Price displacement strength,
Previous signal outcomes (rolling)


Features are passed into ML models per tick.

5. Regime Detector (RegimeDetector.ts)

Outputs one regime from:

trending_up
trending_down
ranging
volatile_expansion
volatile_contraction
news_regime
liquidity_grab
trend_reversal_zone


Methods:

detectUsingCandlePatterns()

detectUsingVolatility()

detectUsingSMC()

detectUsingTime()

detectUsingHTF()

Regime influences risk, execution, and filters.

6. ML Models
MLModelInterface.ts

Unified interface:

loadModel()
predict(features)
getMetadata()

MLModelLightGBM.ts

Load .txt or .pkl model (LightGBM booster).

MLModelONNX.ts

Load .onnx ML models.

Model output:
interface MLSignalScore {
    probabilityWin: number
    probabilitySL: number
    probabilityTP: number
    expectedMove: number
    confidence: number
}

7. MLDecisionService (MLDecisionService.ts)

Merges ML predictions & SMC signal:

Decision logic:

If no SMC signal → skip

If MLScore.confidence < threshold → skip

If Regime incompatible with direction → skip

If P(win) < minWinProbability → skip

If expectedMove < requiredDistance → skip

Returns:

mlPass: boolean

mlReasons: string[]

mlScore: MLSignalScore

regime: RegimeType

8. ML Integration Into Decision Engine

Modify processTradingDecision() flow:

Current:
Signal → Guardrail → Risk → Execution Filter → Execution → Log

v13:
Signal → Regime Detector → FeatureBuilder → MLDecision → Risk → Execution Filter → Execution → Log


ML layer sits after signal and before risk.

9. Logging Requirements

Add to trade_decisions:

ml_pass boolean
ml_score JSONB
ml_reasons JSONB
regime VARCHAR
features JSONB  (optional)


Add to backtests:

ml_pass

ml_score

regime

feature snapshot

Add to live_trades:

ml_score

regime

10. Backtesting Integration

Modify BacktestRunner:

Build features for each candle

Run regime detector

Call MLDecisionService

Log features + ML score

Trade only if ML + SMC both pass

Backtesting gains ML accuracy metrics:

AUC

Brier score

Win-rate per feature bucket

Feature importance (LightGBM)

11. Admin Dashboard Additions

New pages:

/alpha
/features
/regimes
/ml-trade-analysis


New charts:

Regime heatmap

ML predicted win probability curve

Feature distribution histograms

ML-filtered trades

ML overrides

12. Configuration

Add:

configs/ml.json:

{
  "enabled": true,
  "modelType": "lightgbm",
  "modelPath": "./ml_models/v13_model.txt",
  "minWinProbability": 0.60,
  "minConfidence": 0.40,
  "minExpectedMove": 0.5,
  "debug": true
}

13. Acceptance Criteria

ML model loads at startup

Regime detection functional

MLDecisionService filters trades correctly

Logging added for ML layer

Backtester runs ML integration

Dashboard shows regime & ML metrics

System stable under CPU load