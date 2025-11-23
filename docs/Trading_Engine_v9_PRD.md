Trading Engine v9 — Exit Engine (Dynamic SL/TP, Break-Even, Partial Closes)
Product Requirements Document (PRD)

Version: 9.0
Status: Ready for implementation
Author: ProvidenceX System Architect
Date: 2025-11-21

1. Overview

Trading Engine v9 introduces a dedicated Exit Engine that manages all post-entry trade lifecycle decisions such as:

Dynamic stop loss movement

Break-even logic

Partial profit-taking

Trailing SL

Early exit based on structure

Time-based exits

Swap/commission aware exits

Forced exits (risk, volatility, kill-switch escalation)

This moves ProvidenceX from “entry-driven trading” to fully autonomous lifecycle trading, enabling hedge-fund-level control.

2. Goals
Primary Objectives

Improve win rate and expectancy using dynamic exits

Manage trades independently from signal generation

Reduce drawdowns

Capture more profits via partial closes and trailing stops

Improve stability for prop-firm style risk management

Secondary Objectives

Add complete visibility through order lifecycle events

Improve monitoring via Admin Dashboard

Make Backtesting v5 fully compatible with exit logic

3. Requirements Breakdown
3.1 New Service: ExitService

A long-running service inside trading-engine that executes every 2 seconds.

Responsibilities:

Poll MT5 Connector for real open positions

Evaluate per-position exit rules

Decide and send:

SL modification

TP modification

Partial close

Break-even move

Full exit (close order)

Publish lifecycle events to:

order_events table

live_trades table

live_equity table

Functional Behavior:

For each open position:

A) Break-even Rule

Triggered when profit > X pips:

Move SL → entry price

Emit break_even_set event

B) Partial Close Rule

Triggered when price hits TP1:

Close % of position

Move SL → break-even or structure

Emit partial_close event

C) Trailing Stop Rule

Modes:

ATR-based

Fixed pip trail

Structure-based

Volatility adaptive

Event: trail_sl_move

D) Opposite Structure Exit

If LTF breaks BOS against the trade → close early
Event: auto_exit_structure_break

E) Time-based Exit

If position has been open longer than max_time:

Close the entire position
Event: time_exit

F) Commission & Swap Aware Exit

If swap+commission exceeds expected reward:

Close position early
Event: commission_exit

G) Kill-Switch Override

If kill-switch state = active:

Close all open positions

Stop all new entries
Event: kill_switch_forced_exit

3.2 Required MT5 Connector Additions
New Endpoints

POST /api/v1/trades/modify

Modify SL or TP of an open trade

POST /api/v1/trades/partial-close

Close X% of volume from open trade

New Events Emitted

sl_modified

tp_modified

partial_close

break_even_set

trail_sl_move

auto_exit

auto_exit_structure_break

commission_exit

time_exit

3.3 Database Additions
New table: exit_plans

Stores exit configuration per trade entry.

exit_plan_id (UUID)
decision_id (FK)
symbol
entry_price
tp1, tp2, tp3
stop_loss_initial
break_even_trigger
partial_close_percent
trail_mode (enum)
trail_value
time_limit_seconds
created_at

New events in order_events

Add event types listed above.

3.4 Admin Dashboard Additions
A) New “Open Trades” Page

Current SL/TP levels

Floating PnL

Time in trade

Exit status

Partial close history

B) Trade Lifecycle Timeline (Drill-down)

Shows:

Entry

BE move

Partial closes

Trail moves

Final exit

C) Exit Configuration Visualization

Per trade breakdown.

4. Backward Compatibility

Engine continues supporting static SL/TP if no exit plan provided

v7, v8, and v3 systems work unchanged

Backtesting v5 needs minimal updates (ExitService simulation)

5. Configurations
ExitEngineConfig
exitTickIntervalSec = 2
breakEvenEnabled = true
partialCloseEnabled = true
trailingEnabled = true
structureExitEnabled = true
timeExitEnabled = true
commissionExitEnabled = true

6. Architecture Flow
Entry → Exit Engine → MT5 → Order Events → Live PnL → Dashboard
7. Acceptance Criteria

Full/partial exits logged correctly

No duplicate exit actions

No SL modifications faster than broker rate limits

No runaway trailing loops

All events visible in dashboard

Backtesting v5 supports simulated exit logic