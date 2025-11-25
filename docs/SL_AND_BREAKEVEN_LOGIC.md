# Stop Loss and Break-Even Logic Documentation

## Current Implementation

### 1. Stop Loss Calculation (Strategy Layer)

**Location:** `services/trading-engine/src/strategy/v2/`

#### M1ExecutionService.ts
- Calculates SL based on structural levels (POI, swing lows/highs)
- Uses buffer: `structuralLevel - slBuffer - extraBuffer`
- Minimum risk distance check: `minRiskDistance = 1.0` (for XAUUSD)
- Validates SL is not in liquidity zones

#### RiskManagementService.ts
- Calculates SL from Order Blocks, FVG, or swing levels
- Has percentage-based minimum: `minStopLossDistance = entryPrice * 0.0001` (0.01% default)
- Adjusts SL if below minimum, but this is NOT broker-specific

**Issue:** Strategy doesn't know broker's actual minimum stop distance (`trade_stops_level`)

### 2. Stop Loss Adjustment (MT5 Connector)

**Location:** `services/mt5-connector/src/mt5_client.py`

#### `_adjust_stop_loss_take_profit()` method
- Adjusts SL/TP to respect broker's `trade_stops_level` (minimum stop distance in points)
- For BUY: Ensures SL is at least `min_stop_distance` below entry
- For SELL: Ensures SL is at least `min_stop_distance` above entry
- Logs warning if adjustment is made

#### Current Problem:
1. Adjustment happens, but if MT5 still rejects with retcode `10016` (INVALID_STOPS), we retry WITHOUT SL/TP
2. This results in trades opening with empty SL column in MT5 terminal
3. No safety buffer - we adjust to exact minimum, which may still be rejected

### 3. Break-Even Logic

**Location:** `services/trading-engine/src/services/ExitService.ts`

#### `applyBreakEven()` method
- Moves SL to entry price when profit >= 1R (or configured trigger)
- Trigger: `break_even_trigger` (defaults to 1R in pips)
- Uses `TRADE_ACTION_SLTP` to modify existing position

**Issue:** No check for broker minimum when moving SL to entry - could fail if entry is too close to current price

## Proposed Fix

### 1. Ensure SL Always Meets Broker Minimum

**Changes to `mt5_client.py`:**

1. **Add safety buffer to `_adjust_stop_loss_take_profit`:**
   - Instead of adjusting to exact minimum, add 10-20% buffer
   - Example: If minimum is 10 points, adjust to 12 points

2. **Fail trade if SL cannot be set:**
   - If adjusted SL would be invalid (wrong side of entry), return error
   - Never retry without SL/TP - fail the trade instead
   - Log clear error: "Cannot set valid SL: adjusted SL would be on wrong side of entry"

3. **Validate before sending:**
   - Double-check adjusted SL meets minimum before `order_send`
   - If validation fails, return error immediately

### 2. Break-Even with Broker Minimum

**Changes to `ExitService.ts`:**

1. **Check broker minimum before break-even:**
   - Query MT5 for `trade_stops_level` for the symbol
   - Calculate minimum distance: `min_distance = trade_stops_level * point`
   - If entry price is within minimum distance of current price, don't set break-even
   - Log: "Break-even skipped: entry too close to current price (minimum distance required)"

2. **Alternative: Set break-even with buffer:**
   - Instead of exact entry price, set SL to `entry_price ± min_distance`
   - For BUY: `entry_price - min_distance`
   - For SELL: `entry_price + min_distance`

### 3. Strategy Layer Enhancement (Future)

**Consider fetching broker minimum in strategy:**
- Add API endpoint to get symbol info (including `trade_stops_level`)
- Use this in strategy to ensure SL calculation respects broker minimum
- Fail signal generation if SL cannot meet minimum

## Implementation Priority

1. **High Priority:** Fix MT5 connector to never send without SL
2. **High Priority:** Add safety buffer to SL adjustment
3. **Medium Priority:** Fix break-even to respect broker minimum
4. **Low Priority:** Strategy layer broker minimum awareness

