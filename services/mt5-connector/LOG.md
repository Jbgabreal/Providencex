# MT5 Connector Service Log

This file tracks major changes and implementation decisions for the MT5 Connector service.

## 2025-11-20

### Production Cleanup: Standardized Response Format & Volume Validation

Finalized production-grade response structure and volume handling for MT5 Connector API.

**Changes:**
- **Standardized Error Responses**: All error paths now return structured format with `error_code`, `error_message`, and `context` fields:
  - Uses helper function `_make_error_response()` for consistency
  - Includes MT5 error codes when available, local codes for validation errors
  - Context always includes `symbol`, `direction`, `order_kind`, `volume` (when available)
- **Standardized Success Responses**: All success paths return full context via `_make_success_response()`:
  - Returns `ticket`, `symbol` (broker symbol), `volume` (normalized), `price` (entry), `direction`, `order_kind`
  - Applies to both normal success path and retry success path (after INVALID_STOPS retry)
- **Volume Validation Enhancement**: Updated `_normalize_volume()` to reject volumes below `volume_min` instead of silently forcing:
  - Returns error if requested volume < `volume_min` before manipulation
  - Returns error if rounded volume < `volume_min` after step alignment
  - Rejects volumes significantly over `volume_max` (>10% over), clamps if slightly over
  - All volume validation errors use standardized error response format
- **Retry Logic Comments**: Updated comments to reflect current behavior:
  - Both market and pending orders support SL/TP (using `_adjust_stop_loss_take_profit()`)
  - Retry without stops only happens on MT5 INVALID_STOPS (10016) error
  - Removed outdated references to market orders always using `sl=0, tp=0`

**Impact:**
- All API responses now follow consistent structure for easier client integration
- Volume validation is stricter and more transparent (no silent corrections)
- Error responses provide full context for debugging
- Success responses include all relevant trade details

**Backward Compatibility:**
- No breaking changes to API endpoint signatures (`POST /api/v1/trades/open` still accepts same request format)
- Response structure is enhanced but clients can still check `success` field as before
- New fields in responses are additive (existing clients continue to work)

### Production Cleanup: Removed TEST MODE and Demo Caps

### Production Cleanup: Removed TEST MODE and Demo Caps

Removed TEST MODE / demo safety hacks. MT5 Connector now:

- Always applies SL/TP when provided (with validation and adjustment) for both market and pending orders.
- Uses volume normalization based purely on broker symbol parameters (removed hard-coded MAX_TEST_VOLUME cap).
- Keeps dynamic filling mode fallback.
- Retries once without SL/TP on 10016 errors.

**Changes:**
- Removed `MAX_TEST_VOLUME = 0.10` hard-coded cap - now respects broker's `volume_max` only
- Enabled SL/TP handling for pending orders (limit/stop) - previously they were always sent without SL/TP
- All order types (market, limit, stop) now use the same SL/TP adjustment logic
- Naked orders (sl=0, tp=0) only occur when user explicitly doesn't provide SL/TP in request

**Impact:**
- Production-ready volume handling - no artificial limits
- Consistent SL/TP behavior across all order types
- Better risk management for pending orders

### Market Orders: Re-enabled Safe SL/TP Handling

Re-enabled safe SL/TP handling for market orders using broker min stop distance and directional checks. Added retry without stops on MT5 INVALID_STOPS (10016). Pending orders still run without SL/TP for now.

**Changes:**
- Updated `_adjust_stop_loss_take_profit()` helper to enforce directional sanity:
  - BUY orders: SL must be < entry_price, TP must be > entry_price
  - SELL orders: SL must be > entry_price, TP must be < entry_price
  - SL/TP on wrong side are ignored (set to None) with warning log
- Market orders now use SL/TP adjustment:
  - If both SL/TP are None: Sends naked market order (sl=0, tp=0)
  - If at least one is provided: Adjusts using helper to respect min_stop_distance
- Retry logic for INVALID_STOPS (10016):
  - Market orders: Retry once with sl=0, tp=0 if initial request fails
  - Logs retry attempt and result clearly
- Pending orders (limit/stop): Still run without SL/TP (unchanged)

**Implementation Details:**
- SL/TP adjustment respects `trade_stops_level * point` as minimum distance
- Logs show when SL/TP are adjusted, ignored, or when naked orders are sent
- Retry only happens once to avoid infinite loops
- Clear logging distinguishes market vs pending orders

**Impact:**
- Market orders can now execute with safe SL/TP that respect broker constraints
- Orders with invalid SL/TP values are automatically adjusted or retried
- Pending orders remain unchanged (no SL/TP for now)
- All other functionality preserved (volume normalization, symbol mapping, filling modes)

### Market Orders: Temporarily Disabled SL/TP (TEST MODE)

Temporarily disabled SL/TP for market orders (sl=0.0, tp=0.0) to validate execution path.

**Changes:**
- Market orders (`order_kind='market'`) now always send `sl=0.0` and `tp=0.0` to MT5
- Skipped `_adjust_stop_loss_take_profit()` for market orders
- Added clear logging: `[ORDER_KIND=market] ... TEST MODE – sending order without SL/TP (sl=0, tp=0)`
- Simplified retry logic for market orders (no retry needed since SL/TP already 0)

**Rationale:**
- MT5 was rejecting orders with "Invalid 'sl' argument" errors even after adjustment
- Disabling SL/TP allows validation of core execution path
- Will reintroduce broker-safe SL/TP handling later

**Impact:**
- Market orders execute without SL/TP validation errors
- Pending orders still use SL/TP adjustment logic (unchanged)
- All other functionality preserved (volume normalization, symbol mapping, filling modes)

### Market and Pending Order Support

Added support for market execution and pending orders (limit/stop) via `order_kind` field with proper MT5 type mapping.

**Changes:**
- Added `order_kind: Literal['market', 'limit', 'stop']` field to `OpenTradeRequest` model
- Extended `TradeRequest` type in shared-types to include `order_kind: OrderKind`
- Updated Trading Engine `ExecutionService` to populate `order_kind: 'market'` (default for now)

**Implementation Details:**
- **Market Orders** (`order_kind='market'`):
  - Uses live Bid/Ask prices from MT5
  - Maps to `ORDER_TYPE_BUY` or `ORDER_TYPE_SELL`
  - Uses `TRADE_ACTION_DEAL` for immediate execution
  - Requires filling mode (RETURN/IOC/FOK)

- **Pending Orders** (`order_kind='limit'` or `'stop'`):
  - Uses `entry_price` from request
  - Maps to appropriate MT5 order types:
    - `BUY_LIMIT`: `ORDER_TYPE_BUY_LIMIT` (price < current ask)
    - `BUY_STOP`: `ORDER_TYPE_BUY_STOP` (price > current ask)
    - `SELL_LIMIT`: `ORDER_TYPE_SELL_LIMIT` (price > current bid)
    - `SELL_STOP`: `ORDER_TYPE_SELL_STOP` (price < current bid)
  - Uses `TRADE_ACTION_PENDING` for pending order placement
  - Validates pending order conditions (e.g., BUY_LIMIT must have price < ask)

**SL/TP Adjustment:**
- Added `_adjust_stop_loss_take_profit()` helper method
- Respects broker's minimum stop distance (`trade_stops_level`)
- Adjusts SL/TP based on entry price (live Bid/Ask for market, pending price for limit/stop)
- Logs adjustments when SL/TP is modified

**Error Handling:**
- Retry logic for invalid stops (10016): Retries once without SL/TP if initial attempt fails
- Clear validation errors for invalid pending order prices
- Proper error messages with full `result._asdict()` details

**Impact:**
- Trading Engine can now send market or pending orders
- MT5 Connector correctly maps to appropriate MT5 order types
- Better SL/TP handling with automatic adjustments
- Improved error messages for debugging

### Volume Normalization Implementation

Added robust volume normalization to handle broker constraints and prevent invalid volume errors (10014).

**Changes:**
- Added `_normalize_volume()` helper method that:
  - Clamps volume between broker's `volume_min` and `volume_max`
  - Applies a safety cap of 0.10 lots for v1 testing
  - Snaps volume to the nearest multiple of `volume_step`
  - Ensures final volume is never below minimum

**Implementation Details:**
- Volume normalization happens before building the trade request
- Logs show both requested and normalized volumes
- Symbol volume constraints (min/max/step) are logged for debugging
- Error 10014 (Invalid volume) is handled specially and returns immediately without retrying filling modes
- All error responses now include `details` from `result._asdict()` for better debugging

**Impact:**
- Prevents sending thousands of lots (always capped at 0.10 for v1)
- Makes the connector robust to large volume requests from the Trading Engine
- Provides clear logging for volume adjustments

