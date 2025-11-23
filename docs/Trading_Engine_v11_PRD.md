Trading Engine v11 — Hyperparameter Optimization & Walk-Forward Framework
Product Requirements Document (PRD)

Version: 11.0
Status: Ready for implementation
Author: ProvidenceX Architecture
Date: 2025-11-21

1. Overview

Trading Engine v11 introduces a Quant Optimization Layer that transforms ProvidenceX from a rule-based engine to a research-driven, data-driven optimization system.

This upgrade enables:

Parameter sweeps

Grid search

Bayesian optimization

Walk-forward optimization

Genetic algorithms (optional extension)

Multi-run parallel testing

Multi-symbol optimization

Automatic best parameter selection

Performance scoring

This layer sits above Backtesting v5 and Strategy v10.

2. Goals
Primary Goals

Optimize SMC v2 strategy parameters

Discover best-performing combinations of:

OB sensitivity

FVG depth thresholds

Liquidity sweep criteria

Session windows

SMT divergence weight

Risk parameters

Volatility filters

Automate walk-forward analysis

Enable out-of-sample validation

Ensure reproducible quant research

Secondary Goals

Full integration with dashboard

Persist optimization runs in Postgres

Allow distributed compute later (v12)

3. Optimization Modes
3.1 Grid Search (Deterministic)

Try every combination from parameter grid.

Example grid:

ob_sensitivity: [0.4, 0.5, 0.6]
fvg_min_size: [1, 2, 3]
sweep_strength: [0.6, 0.8, 1.0]
session: ["ny", "ldn"]


Total combinations = 3 * 3 * 3 * 2 = 54 backtest runs.

3.2 Random Search

Random combinations sampled from ranges.

Good for large parameter spaces.

3.3 Bayesian Optimization (Smart)

Uses:

Hyperparameters

Prior runs

Bayesian inference

Acquisition functions (EI, UCB)

Goal: converge faster on best parameters.

3.4 Walk-Forward Optimization

Industry standard.

Steps:

Select In-Sample Range (IS)

Select Out-of-Sample Range (OOS)

Optimize on IS

Validate on OOS

Roll window forward

Repeat

Result: walk-forward performance report + best stable parameters.

3.5 Genetic Algorithm (Optional)

Chromosomes = parameter sets
Fitness = Sharpe / PF
Operations: crossover, mutation, selection

4. Optimization Engine Architecture
New directory:

services/trading-engine/src/optimization/

Contains:

OptimizerEngine.ts
GridSearchOptimizer.ts
RandomSearchOptimizer.ts
BayesOptimizer.ts
WalkForwardOptimizer.ts
GAOptimizer.ts (optional)
OptimizationTypes.ts
OptimizationConfig.ts
OptimizerRunner.ts
OptimizerResultStore.ts

5. Optimization Parameters (Full Spec)

Each SMC v2 subsystem exposes tunable parameters:

5.1 HTF Structure

swingLookback: 10–40

trendWeight: 0.5–1.0

5.2 ITF Structure

bosSensitivity: 0.5–1.0

liquiditySweepTolerance: 0.3–0.8

5.3 LTF Refinement

refinementDepth: 1–4

entryRetracePct: 10–60

5.4 FVG

minSize: 1–5 pips

fillTolerancePct: 10–50

5.5 Order Block v2

minVolumeFactor: 1.0–3.0

wickBodyRatioMin: 0.2–0.6

5.6 SMT Divergence

smtWeight: 0–1.0

confirmSMT: boolean

5.7 Volatility Filters

ATR multiplier: 1.0–3.0

5.8 Sessions

allowed sessions: [NY, LDN, ASIA]

sessionStart/End

5.9 Risk

RR targets

SL tolerance

Max loss allowed

All parameters belong to a strategy configuration object, versioned as:

SMC_V2_ParamSet

6. Optimization Metrics

Each run must compute:

Profitability:

Win Rate

Total Net Profit

Profit Factor

Expectancy

Avg Winner / Avg Loser

Max Drawdown

Recovery Factor

Stability:

Sharpe Ratio

Sortino Ratio

Trade frequency

Losing streak distribution

Robustness:

Out-of-sample performance

Parameter stability

Sensitivity scoring

7. Optimizer Runner API

Create CLI:

pnpm optimize --symbol XAUUSD --method grid --config ./configs/smc_v2_params.json


Options:

--method grid|random|bayes|walkforward
--symbol XAUUSD,EURUSD
--from 2023-01-01
--to 2025-01-01
--out-of-sample
--population (for GA)
--trials (for bayes/random)
--export-csv
--save-db

8. Database Schema

New tables:

optimization_runs
id
method
symbol
param_set JSONB
in_sample_range
out_sample_range
created_at

optimization_results
run_id FK
metrics JSONB
best_param_set JSONB
equity_curve JSONB

9. Dashboard Additions

Dashboard gets new tab: Optimization

Pages:

/optimization/runs

Table of completed optimization jobs

Filter by symbol, date, method

/optimization/[id]

Best parameters

Equity curves

Heatmaps of parameter sweeps

Walk-forward report

10. Acceptance Criteria

Must run 100+ backtests in batch mode

Must save results to DB

Must allow export to CSV/JSON

Compatible with SMC v2

Walk-forward stability >= 60% required

Must support multi-symbol runs

Execution time per run < 2 seconds (optimization layer only; backtest is separate)