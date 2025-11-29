# Stop Loss Fallback Mechanism

## Overview
Added intelligent fallback mechanism for Stop Loss calculation when refined M1 Order Block is missing. Instead of rejecting the trade, the system now uses the setup zone's support/resistance levels as the point of interest.

## Fallback Logic

### Primary Method: Refined M1 OB
When a refined M1 Order Block is available:
- **Bullish (BUY)**: SL = `refinedOB.low - buffer`
- **Bearish (SELL)**: SL = `refinedOB.high + buffer`

### Fallback Method: Swing Support/Resistance Below/Above OB
When refined M1 OB is missing, find the nearest swing point below/above the setup zone:

- **Bullish (BUY)**: 
  - Find nearest **swing low** BELOW the setup zone (support level)
  - SL = `nearestSwingLow - buffer`
  - Uses the highest swing low below the zone (nearest support)
  
- **Bearish (SELL)**:
  - Find nearest **swing high** ABOVE the setup zone (resistance level)
  - SL = `nearestSwingHigh + buffer`
  - Uses the lowest swing high above the zone (nearest resistance)

**Last Resort**: If no swing points found:
- BUY: Use `zoneLow - buffer`
- SELL: Use `zoneHigh + buffer`

## Buffer Calculation

Buffers are symbol-aware to ensure proper distance:

- **XAUUSD/GOLD**: Minimum $1.0 buffer
- **Forex pairs (EURUSD, GBPUSD, etc.)**: Minimum 0.0001 (1 pip)
- **Other symbols**: 10% of zone size or minimum buffer, whichever is larger

## Entry Price Fallback

When refined OB is missing, entry price also uses fallback:

1. **If FVG exists**: Use FVG midpoint (50% of FVG)
2. **If M15 OB exists**: Use OB edge based on direction
   - Bullish: OB low
   - Bearish: OB high
3. **Last resort**: Use setup zone midpoint

## Validation

The system validates that:
- SL is > 0
- SL is at least `minBuffer` distance from entry
- SL is in correct direction (below entry for BUY, above entry for SELL)

If validation fails, the trade is rejected.

## Benefits

1. **Safety**: Always ensures SL is set, preventing unprotected trades
2. **Flexibility**: Allows trades even when M1 OB is not detected
3. **Risk Management**: Uses structure-based levels (support/resistance) for SL placement
4. **Logging**: Clear logging when fallback is used for debugging

## Example

### Bullish Setup (BUY)
```
Setup Zone: [4125.98, 4133.31] (FVG)
Refined OB: Missing
M15 Swing Lows: [4120.50, 4115.25, 4110.00]
Entry Price: 4129.65 (FVG midpoint)
Nearest Support: 4120.50 (highest swing low below zone)
Stop Loss: 4119.50 (support 4120.50 - $1.00 buffer)
```

### Bearish Setup (SELL)
```
Setup Zone: [1.1550, 1.1560] (OB)
Refined OB: Missing
M15 Swing Highs: [1.1570, 1.1585, 1.1600]
Entry Price: 1.1560 (OB high)
Nearest Resistance: 1.1570 (lowest swing high above zone)
Stop Loss: 1.1571 (resistance 1.1570 + 0.0001 buffer)
```

## Logging

When fallback is used, you'll see:
```
[ICT] XAUUSD: Using fallback SL from setup zone (refined OB not available). 
SL=4124.98, Zone=[4125.98, 4133.31]
```

This helps identify when fallback mechanism is active vs. primary OB-based calculation.

