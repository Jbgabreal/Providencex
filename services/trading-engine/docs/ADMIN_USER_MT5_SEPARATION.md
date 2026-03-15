# Admin/User MT5 Account Separation

## Overview

The trading engine uses a clear separation between **Admin MT5 Account** (for analysis) and **User MT5 Accounts** (for execution).

## Architecture

### 🔍 Admin MT5 Account (`admin_mt5_connector_url`)

**Purpose**: Master account used for all analysis and strategy detection.

**Used by**:
- `PriceFeedClient` - Real-time price feeds
- `OrderFlowService` - Order flow analysis
- `HistoricalBackfillService` - Historical data backfill
- `AvoidWindowManagerService` - Avoid window management
- Strategy detection and confirmation

**Responsibilities**:
- Provide market data (price feeds, candles)
- Analyze market structure
- Detect trade signals
- Confirm trade setups
- Run all trading strategies

**Important**: The admin account **does not execute trades**. It only analyzes and decides when to trade.

### 💰 User MT5 Accounts (`mt5_connector_url`)

**Purpose**: User accounts used ONLY for trade execution and position management.

**Used by**:
- `UserAssignmentOrchestrator` - User account connections
- `AccountExecutionEngine` - Trade execution per user account
- `ExitService` - Position exits (trailing stops, closes)
- `OpenTradesService` - Open position tracking (per user)

**Responsibilities**:
- Execute trades when admin's strategy detects a signal
- Manage open positions (trailing stops, partial closes)
- Track position PnL
- Close positions based on news or other reasons
- Execute trades instantly when signals are confirmed

**Important**: User accounts **do not perform analysis**. They only execute trades based on admin's decisions.

## How It Works

1. **Analysis Phase** (Admin Account):
   - Admin MT5 connector provides real-time price feeds
   - Strategy service analyzes market structure
   - Signals are detected and confirmed
   - Decision is made: TRADE or SKIP

2. **Execution Phase** (User Accounts):
   - If TRADE decision:
     - System executes trade on ALL eligible user accounts
     - Each user account receives the trade signal
     - Trade is executed on user's broker account
   - Position management happens on user accounts:
     - Trailing stops
     - Partial closes
     - News-based exits
     - Structure-based exits

## Configuration

### System Settings

Two settings control this separation:

1. **`admin_mt5_connector_url`**: Admin's MT5 connector URL (for analysis)
   - Set in admin dashboard → Settings page
   - Used by all analysis services
   - Example: `http://localhost:3030`

2. **`mt5_connector_url`**: Default MT5 connector URL for user accounts (for execution)
   - Set in admin dashboard → Settings page
   - Used as fallback when user doesn't provide `baseUrl`
   - Users can override by providing their own `baseUrl` in `connection_meta`

### Environment Variables (Fallback)

If settings are not configured in database:
- `ADMIN_MT5_CONNECTOR_URL` → Used for admin account (falls back to `MT5_CONNECTOR_URL`)
- `MT5_CONNECTOR_URL` → Used for user accounts default

## Settings Page

The admin dashboard Settings page shows:
- **Admin MT5 Account (Analysis)**: Green card explaining admin account usage
- **User MT5 Accounts (Execution)**: Blue card explaining user account usage

Both settings can be edited directly from the Settings page.

## User Account Connection

When a user connects their MT5 account:
1. User provides: `account_number`, `server`, `password`, optional `baseUrl`
2. If `baseUrl` provided: Uses that URL for their account
3. If no `baseUrl`: Uses `mt5_connector_url` from system settings
4. Account is used ONLY for trade execution, not analysis

## Example Flow

```
┌─────────────────────────────────────────────┐
│  Admin MT5 Account (Analysis)              │
│  ─────────────────────────────────────      │
│  1. PriceFeedClient gets real-time prices  │
│  2. StrategyService analyzes market        │
│  3. Signal detected: BUY XAUUSD @ 2650.50  │
│  4. Decision: TRADE ✅                      │
└─────────────────────────────────────────────┘
                    │
                    │ Signal Broadcast
                    ▼
┌─────────────────────────────────────────────┐
│  User MT5 Accounts (Execution)             │
│  ─────────────────────────────────────      │
│  User 1 Account → Execute BUY @ 2650.50    │
│  User 2 Account → Execute BUY @ 2650.50    │
│  User 3 Account → Execute BUY @ 2650.50    │
│                                              │
│  Each user account:                         │
│  - Opens position on their broker           │
│  - Manages trailing stops                   │
│  - Tracks PnL                               │
│  - Closes based on news/structure           │
└─────────────────────────────────────────────┘
```

## Benefits

1. **Scalability**: One admin account analyzes, many user accounts execute
2. **Cost Efficiency**: Admin account doesn't need trading permissions (analysis only)
3. **Flexibility**: Users can use different brokers (via `baseUrl`)
4. **Separation of Concerns**: Analysis logic separate from execution
5. **Real-time Execution**: Instant trade execution on all user accounts

## Important Notes

- Admin account should have **read-only** market data access (no trades needed)
- User accounts need **full trading permissions** (open/close positions)
- Services cache the admin URL for 1 minute (reduces DB queries)
- To change admin URL: Update in Settings page → Restart trading-engine
- User accounts can be added/removed without restart

