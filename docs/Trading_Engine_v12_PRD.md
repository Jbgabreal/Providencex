Trading Engine v12 — Multi-Account Distributed Executor
Product Requirements Document (PRD)

Version: 12.0
Status: Approved for Implementation
Date: 2025-11-21

1. Overview

Trading Engine v12 introduces the Distributed Execution System, enabling ProvidenceX to:

Run multiple MT5 accounts in parallel

Each account can have:

Independent risk settings

Independent kill switch

Independent SL/TP rules

Independent execution filter settings

Independent symbols

Scale horizontally

1 → 10 → 100 accounts

Each with deterministic execution

Shared market data layer

Shared strategy engine

Distributed MT5 connectors

Core Design
           ┌────────────────────┐
           │    Strategy v2     │   (runs ONCE per tick)
           └─────────┬──────────┘
                     │ RawSignals
      ┌──────────────┴──────────────┐
      │Account Execution Orchestrator│
      └─┬────────────┬──────────────┘
        │            │
    Account A    Account B    ... Account N
   MT5 Connector MT5 Connector   MT5 Connector


Strategy runs once.
Execution happens separately per account.

2. Goals
Primary Goals

Parallel execution across multiple trading accounts

Shared Strategy + Shared Market Data + Per-Account Risk/Execution

Distributed MT5 Connectors

Unified Admin Dashboard for all accounts

High-availability execution pipeline

Secondary Goals

Automatic failover if a connector fails

Automatic spreading of risk across accounts

Unified journaling and trade history

3. Multi-Account Architecture
New directory:

services/trading-engine/src/multiaccount/

Files:

AccountConfig.ts
AccountRegistry.ts
AccountExecutionEngine.ts
DistributedExecutionOrchestrator.ts
PerAccountKillSwitch.ts
PerAccountRiskService.ts
PerAccountExecutionFilter.ts

4. Account Configuration

Each account is defined in:

configs/accounts.json

Example:

[
  {
    "id": "acc1",
    "name": "Main Account",
    "mt5": {
      "baseUrl": "http://localhost:4001",
      "login": 1234567
    },
    "symbols": ["XAUUSD", "US30"],
    "risk": {
      "riskPercent": 1.0,
      "maxDailyLoss": 200,
      "maxWeeklyLoss": 800
    },
    "killSwitch": {
      "enabled": true,
      "dailyDDLimit": 200,
      "weeklyDDLimit": 800
    }
  },
  {
    "id": "acc2",
    "name": "Scaling Account",
    "mt5": {
      "baseUrl": "http://localhost:4002",
      "login": 9123456
    },
    "symbols": ["EURUSD"],
    "risk": {
      "riskPercent": 0.5,
      "maxDailyLoss": 100,
      "maxWeeklyLoss": 500
    },
    "killSwitch": {
      "enabled": true,
      "dailyDDLimit": 100,
      "weeklyDDLimit": 500
    }
  }
]


Accounts can share or differ on:

Symbols

SL/TP rules

Risk parameters

Execution filters

Kill switch

5. Distributed Execution Orchestrator

New component:

DistributedExecutionOrchestrator.ts

Responsibilities:

Receives RawSignal from StrategyService

For each account:

Check account-level kill switch

Check account-level risk

Apply account-specific execution filter

Send trade execution requests to correct MT5 Connector

Aggregates results in a unified response

Persists per-account decision logs

6. Per-Account Risk & Kill Switch
New Components:

PerAccountRiskService.ts

PerAccountKillSwitch.ts

Each account has:

Daily loss tracking

Weekly loss tracking

Losing streak tracking

Exposure tracking

Max concurrent trades

Max allowed risk

Kill Switch triggers independently:

One account paused does NOT affect other accounts

7. Distributed MT5 Connectors

Each MT5 Connector runs on its own port, example:

Account A → MT5 Connector at :4001
Account B → MT5 Connector at :4002
Account C → MT5 Connector at :4003


Trading Engine routes trades to correct connector.

8. Unified Multi-Account Logging

Add new table:

account_trade_decisions
id
account_id
timestamp
symbol
strategy
decision
risk_reason
filter_reason
execution_result
pnl
created_at


Add:

account_live_equity
account_id
timestamp
equity
balance
floating_pnl
drawdown


Add:

account_kill_switch_events
9. Admin Dashboard Updates

Add new tab:

/accounts

Shows:

All accounts

Kill-switch status

Daily/weekly PnL for each account

Live exposure per account

Last 20 trades per account

Add:

/accounts/[id]

Detailed page per account.

10. Acceptance Criteria

Add multiple accounts without restarting engine

Strategy runs ONCE per symbol

Execution runs per account

Kill-switch respects account boundaries

MT5 connectors are fully independent

Dashboard shows unified + per-account reports

Risk is isolated per account

Performance is linear with account count (parallel execution)