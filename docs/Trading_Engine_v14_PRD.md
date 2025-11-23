Trading Engine v14 — PRD
Order Flow + Smart Tape Engine

1. Overview

v14 introduces real-time order flow analytics and a Smart Tape Engine to improve trade timing, refine SMC entries, and reduce false signals.

Order Flow gives the engine the ability to “read the tape” like professional traders:

Who is aggressive? Buyers or sellers

Are big players absorbing or pushing?

Is liquidity being taken or provided?

Are we trading into exhaustion or trend continuation?

This sits between v10 (SMC v2) and v11 (Optimization)** and directly powers:

Execution filter enhancements

Smart entry refinement

Risk model improvements

2. Core Components
2.1 MT5 Connector Enhancements

Add a new endpoint:

GET /api/v1/order-flow/{symbol}

Returns aggregated order flow for the last N seconds:

{
  "symbol": "XAUUSD",
  "timestamp": "2025-11-21T14:00:00Z",
  "bid_volume": 812.5,
  "ask_volume": 943.2,
  "delta": 130.7,
  "delta_sign": "buying_pressure",
  "imbalance_buy_pct": 63.2,
  "imbalance_sell_pct": 36.8,
  "large_orders": [
      { "volume": 25.0, "side": "buy", "price": 2649.02 },
      { "volume": 30.0, "side": "sell", "price": 2648.10 }
  ]
}


Actual MT5 Data:

Tick volume → convert to aggressive buy/sell

Bid/Ask volume differences

Large order detection = tick size * 20× usual tick

Connector stores rolling 1-minute tick data in memory to compute order flow.

2.2 Trading Engine Component: OrderFlowService

New service:

Responsibilities:

Poll MT5 Connector /order-flow/{symbol} every 1 second

Maintain rolling window:

1s, 5s, 15s, 60s intervals

Compute:

Volume delta

Cumulative delta (CVD)

Delta momentum

Order book imbalance

Buy/Sell pressure ranking

Large order detection summary

Absorption vs. initiative aggression

Data structure:
interface OrderFlowSnapshot {
  timestamp: string;
  symbol: string;
  delta1s: number;
  delta5s: number;
  delta15s: number;
  cvd: number;
  buyPressureScore: number;   // 0–100
  sellPressureScore: number;  // 0–100
  orderImbalance: number;     // -100..100
  largeBuyOrders: number;
  largeSellOrders: number;
  absorptionBuy: boolean;
  absorptionSell: boolean;
}

2.3 ExecutionFilter v4.5 — Order Flow Constraints

Add new filter conditions:

Condition 1 — No Trade Against Strong Delta

If delta15s opposes the trade direction by more than threshold → SKIP

Condition 2 — Avoid Reversal Exhaustion

If delta collapses after a spike → SKIP

Condition 3 — Confirm Trend Continuation

Require delta15s to agree with the SMC trend

Condition 4 — Large Opposing Orders

If a cluster of large orders is detected against us → SKIP

Condition 5 — Absorption Detection

Absorption against our entry → SKIP

New reasons in logs:

"orderflow_delta_conflict"

"orderflow_absorption_detected"

"orderflow_large_orders_against"

"orderflow_exhaustion"

"orderflow_no_buy_pressure"

"orderflow_no_sell_pressure"

2.4 Smart Entry Refinement

Before executing a market order:

Add requirement:

Wait for a micro-confirmation (1–3 ticks):

For buy:

ask volume > bid volume

delta1s > 0

no large sell orders

For sell:

bid volume > ask volume

delta1s < 0

no large buy orders

If 3 checks fail in 3 seconds → SKIP execution.

2.5 Admin Dashboard Enhancements

Add pages:

Order Flow Monitor

Live delta graph

1s/5s/15s CVD chart

Large order stream (tape)

Inside Decisions Table:

Add columns:

delta15s

buyPressureScore

orderImbalance

largeOrdersAgainst

Exposure + Order Flow Fusion

Highlight “conflict zones”

2.6 Database Changes

Add table:

orderflow_snapshots
CREATE TABLE orderflow_snapshots (
  id SERIAL PRIMARY KEY,
  symbol VARCHAR(20),
  timestamp TIMESTAMPTZ,
  delta1s DOUBLE PRECISION,
  delta5s DOUBLE PRECISION,
  delta15s DOUBLE PRECISION,
  cvd DOUBLE PRECISION,
  buy_pressure DOUBLE PRECISION,
  sell_pressure DOUBLE PRECISION,
  order_imbalance DOUBLE PRECISION,
  large_buy_orders INT,
  large_sell_orders INT
);


Stored every 1 minute.

2.7 Kill Switch Integration

If order flow shows:

extreme conflicting deltas

repetitive exhaustion patterns

high-frequency large orders against trend

Kill switch sets:

kill_switch_reason = "orderflow_risk"
kill_switch_active = true