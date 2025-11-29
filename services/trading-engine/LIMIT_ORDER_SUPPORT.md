# Limit Order Support

## Overview

The trading engine now supports **limit orders** and **stop orders** in addition to market orders. This ensures that Stop Loss (SL) and Take Profit (TP) are always set correctly relative to a known entry price.

## Order Types Supported

### 1. **Market Orders** (Default)
- Executes immediately at current market price
- Used when entry price is very close to current price
- SL/TP are set relative to execution price (may need adjustment)

### 2. **Limit Orders**
- **Buy Limit**: Entry price below current ask
- **Sell Limit**: Entry price above current bid
- SL/TP are set relative to the known entry price (more precise)

### 3. **Stop Orders**
- **Buy Stop**: Entry price above current ask (breakout)
- **Sell Stop**: Entry price below current bid (breakdown)
- SL/TP are set relative to the known entry price

### 4. **Stop-Limit Orders** (Future)
- Buy Stop Limit / Sell Stop Limit
- Not yet implemented in MT5 connector
- Will be added in a future update

## Automatic Order Type Selection

The system automatically selects the appropriate order type based on the entry price relative to current market price:

```
For BUY signals:
- entry < current_ask → Buy Limit
- entry > current_ask → Buy Stop
- entry ≈ current_ask → Market Order

For SELL signals:
- entry > current_bid → Sell Limit
- entry < current_bid → Sell Stop
- entry ≈ current_bid → Market Order
```

## Manual Override

You can manually specify the order type in the `TradeSignal`:

```typescript
const signal: TradeSignal = {
  symbol: 'XAUUSD',
  direction: 'buy',
  entry: 4129.82,
  stopLoss: 4120.82,
  takeProfit: 4156.91,
  orderKind: 'limit', // Explicitly use limit order
  reason: 'ICT setup',
};
```

## Benefits

1. **Precise SL/TP**: With limit orders, the entry price is known upfront, so SL/TP are always set correctly
2. **No Price Slippage**: Limit orders execute at your specified price (or better)
3. **Better Risk Management**: SL/TP are calculated relative to the exact entry price
4. **Flexibility**: Can use market orders for immediate execution or limit orders for precision

## Example

**Scenario**: ICT strategy detects a buy setup at 4129.82, with SL at 4120.82 and TP at 4156.91.

**Current Market Price**: 4132.00 (ask)

**Automatic Selection**: 
- Entry (4129.82) < Current Ask (4132.00) → **Buy Limit Order**

**Result**:
- Order placed as Buy Limit at 4129.82
- SL set at 4120.82 (9.00 below entry)
- TP set at 4156.91 (27.09 above entry)
- All parameters are set correctly relative to the known entry price

## Configuration

No configuration needed - the system automatically selects the best order type. You can override by setting `orderKind` in the `TradeSignal` if needed.

## Notes

- Limit orders may not fill if price doesn't reach the entry level
- Stop orders trigger when price breaks through the entry level
- Market orders execute immediately but may have slight price slippage
- All order types support SL/TP parameters

