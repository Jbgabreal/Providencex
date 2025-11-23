ProvidenceX — Trading Engine v5
Backtesting & Simulation Framework PRD + Cursor Implementation Prompt

Date: 2025-11-20
Owner: ProvidenceX Trading Architecture
Version: v5 (New)

1. Overview

Trading Engine v5 introduces a complete backtesting + simulation framework that allows ProvidenceX to:

Replay historical candles through the exact same strategy pipeline used in production
(StrategyService → SignalConverter v3 → ExecutionFilter v3 & v4 → RiskService).

Simulate order execution, SL/TP hits, exposure, daily statistics, and equity curve.

Compare performance across instruments, timeframes, configurations, and risk settings.

Validate strategy changes before enabling them live.

This closes the loop between:

Live engine (v2–v4) ↔ Historical engine (v5)

So any strategy upgrade can be evaluated offline before enabling in real trading.

2. Backtesting Goals

v5 must answer the following questions:

2.1 Core questions

“What would the last 12 months of our strategy have done?”

“Which symbols perform best?”

“Which risk settings are optimal?”

“How often does the strategy lose?”

“What market conditions cause most drawdowns?”

2.2 Operational questions

“If we tighten/loosen v3 filters, what changes?”

“If we change v4 exposure limits, do we overtrade or undertrade?”

“Should we run the engine on XAU only?”

“What happens if spread is increased (simulating live slippage)?”

3. Required Components (High-Level Architecture)
+------------------------------------------------+
| Trading Engine v5 Backtest Runner              |
|                                                |
|  - Historical candle loader                    |
|  - Tick/Candle replay engine                   |
|  - StrategyService (unchanged)                 |
|  - SignalConverter v3 (unchanged)              |
|  - ExecutionFilter v3 (unchanged)              |
|  - ExecutionFilter v4 (exposure simulation)    |
|  - SimulatedRiskService                        |
|  - SimulatedMT5Adapter                         |
|                                                |
+------------------------------------------------+
                     |
                     v
+------------------------------------------------+
| Backtest Result Store                          |
| - Summary stats                                |
| - Trade list                                   |
| - Equity curve                                 |
+------------------------------------------------+

4. Functional Requirements
4.1 BacktestRunner Service (New)

Runs as a standalone module:
packages/backtest-runner/ or services/trading-engine/src/backtesting/

Inputs:

symbol(s)

strategies: low, high, or both

timeframe: LTF timeframe (default M5)

historical data source

account config (initial balance, risk per trade)

v3 configuration overrides

v4 exposure overrides

Outputs:

JSON summary

CSV of all trades

Equity curve

Backtest run metadata stored in Postgres

Must support command:

pnpm backtest --symbol XAUUSD --start 2024-01-01 --end 2024-12-31

4.2 Historical Data Loader

Supports:

CSV OHLCV files

Postgres historical_candles table

API data (optional)

Must normalize into:

interface HistoricalCandle {
  symbol: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  timestamp: number; // epoch millis
}

4.3 Candle Replay Engine

For each candle:

Feed candle to CandleStore

Trigger StrategyService.generateSignal()

Convert to RawSignal v3

Run ExecutionFilter v3

Simulate exposure with v4 logic

If pass → open a simulated position via SimulatedMT5Adapter

Check SL/TP hits candle-by-candle

Update equity curve

5. Simulated MT5 Adapter (New)

Replacement for MT5Connector inside backtests.

Implements:

Methods:
openTrade(params): SimulatedTrade
closeTrade(ticket): void
getOpenPositions(): SimulatedPosition[]

Simulates:

Entry at candle open (default)

SL/TP hits intrabar

Spread/slippage (configurable)

Lot size rules identical to MT5Connector

Stores:
interface SimulatedPosition {
  ticket: number;
  symbol: string;
  volume: number;
  entryPrice: number;
  sl: number | null;
  tp: number | null;
  direction: "buy" | "sell";
  openTime: number;
  closeTime?: number;
  closePrice?: number;
  profit?: number;
}

6. Backtest Result Store

Tables:

Table: backtest_runs

id

config_json

start_time

end_time

runtime_ms

stats_json

Table: backtest_trades

run_id

symbol

direction

entry/exit price

SL/TP

profit

duration

Table: backtest_equity

run_id

timestamp

balance

7. Performance Metrics Required

Win rate

Max consecutive losses

Max drawdown

Average R:R

Profit factor

Sharpe ratio (optional)

Per-symbol PnL

Total PnL

Number of trades

Average trade duration

Expectancy

8. User Interface (CLI)

Examples:

pnpm backtest:xau
pnpm backtest --symbol GBPUSD --from 2024-01-01 --to 2024-04-01
pnpm backtest:all


Outputs rendered to:

/backtests/run_<timestamp>/
    summary.json
    trades.csv
    equity.json

9. Nonfunctional Requirements

Must NOT affect live engine (no shared state).

Must be deterministic (same inputs → same outputs).

Must reuse existing production logic without modification.

Must run a 1-year backtest under 60 seconds for 1 symbol.

Must run multi-symbol under 3 minutes.

10. Dependencies

Trading Engine v2 market data types

StrategyService v1

SignalConverter v3

ExecutionFilter v3 & v4

MT5 risk model

11. Acceptance Criteria

Runs on historical data without errors

Produces identical decisions to live engine for same candles

Can simulate thousands of trades

Provides full statistical analysis

CLI triggers backtests easily

Reports saved to disk + DB