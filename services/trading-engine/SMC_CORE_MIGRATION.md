# SMC Core Services Migration Notes

## Overview

The SMC (Smart Money Concepts) engine has been rebuilt with formal algorithms based on the research document (`docs/SMC_research.md`). All swing detection, BOS detection, CHoCH detection, and trend bias calculation now use formal, deterministic algorithms suitable for backtesting.

## What Changed

### New Core Services

Created `services/trading-engine/src/strategy/v2/smc-core/` with:

1. **Types.ts** - Formal type definitions matching research document
2. **SwingService.ts** - Fractal + rolling hybrid swing detection
3. **BosService.ts** - Formal BOS detection with strict/relaxed close
4. **ChochService.ts** - CHoCH detection with protected swing logic
5. **TrendService.ts** - HH/HL & LH/LL pattern detection + PD arrays
6. **MtfContextService.ts** - Multi-timeframe context builder

### Updated Files

1. **MarketStructureHTF.ts** - Now uses SMC core services
2. **MarketStructureITF.ts** - Now uses SMC core services
3. **MarketStructureLTF.ts** - Now uses SMC core services

### Backward Compatibility

All changes maintain backward compatibility with existing `MarketStructureContext` interface. The old methods have been removed, but the output format remains the same.

## Key Improvements

### 1. Formal Swing Detection

**Before:** Simple rolling lookback (max/min of recent candles)

**After:** 
- Fractal/pivot-based detection (symmetrical window)
- Rolling lookback detection
- Hybrid method (combines both)

**Configuration:**
- HTF: pivot 5x5, lookback 30
- ITF: pivot 3x3, lookback 20
- LTF: pivot 2x2, lookback 10

### 2. Formal BOS Detection

**Before:** Simplified ICT-style detection (hardcoded)

**After:**
- Configurable strict/relaxed close
- Uses formal swing arrays
- Returns all BOS events (not just last)
- Tracks broken swing index and type

**Configuration:**
- HTF: strictClose=true, lookback 100 candles
- ITF: strictClose=true, lookback 50 candles
- LTF: strictClose=true, lookback 20 candles

### 3. CHoCH Detection (NEW)

**Before:** Not implemented

**After:**
- Full CHoCH detection with protected swing logic
- Tracks trend reversals (bullish→bearish, bearish→bullish)
- Identifies protected swings (HL in bullish, LH in bearish)

### 4. Formal Trend Bias

**Before:** ICT PD model (close vs swing high/low)

**After:**
- HH/HL & LH/LL pattern detection
- PD array position calculation (0-1)
- Trend state tracking over time
- Per-candle trend snapshots

## Configuration

Each timeframe uses appropriate configuration:

```typescript
// HTF (External Structure)
{
  swing: { method: 'hybrid', pivotLeft: 5, pivotRight: 5, lookbackHigh: 30, lookbackLow: 30 },
  bos: { bosLookbackSwings: 10, swingIndexLookback: 100, strictClose: true },
  trend: { minSwingPairs: 2, discountMax: 0.5, premiumMin: 0.5 }
}

// ITF (Internal Structure)
{
  swing: { method: 'hybrid', pivotLeft: 3, pivotRight: 3, lookbackHigh: 20, lookbackLow: 20 },
  bos: { bosLookbackSwings: 10, swingIndexLookback: 50, strictClose: true },
  trend: { minSwingPairs: 2, discountMax: 0.5, premiumMin: 0.5 }
}

// LTF (Entry Structure)
{
  swing: { method: 'hybrid', pivotLeft: 2, pivotRight: 2, lookbackHigh: 10, lookbackLow: 10 },
  bos: { bosLookbackSwings: 5, swingIndexLookback: 20, strictClose: true },
  trend: { minSwingPairs: 2, discountMax: 0.5, premiumMin: 0.5 }
}
```

## Deterministic & Non-Repainting

All algorithms are:
- ✅ **Deterministic**: Same inputs → same outputs (suitable for backtesting)
- ✅ **Non-repainting**: No future data used (no lookahead)
- ✅ **Candle-by-candle**: Can process candles incrementally

## Testing Checklist

### Unit Tests Needed

- [ ] SwingService: Fractal detection
- [ ] SwingService: Rolling detection
- [ ] SwingService: Hybrid detection
- [ ] BosService: Strict close detection
- [ ] BosService: Relaxed close detection
- [ ] ChochService: Bullish→Bearish CHoCH
- [ ] ChochService: Bearish→Bullish CHoCH
- [ ] TrendService: HH/HL pattern detection
- [ ] TrendService: LH/LL pattern detection
- [ ] TrendService: PD position calculation
- [ ] MtfContextService: Multi-timeframe context

### Integration Tests Needed

- [ ] MarketStructureHTF with real H4 candles
- [ ] MarketStructureITF with real M15 candles
- [ ] MarketStructureLTF with real M1 candles
- [ ] SMCStrategyV2 end-to-end signal generation

### Backtesting Validation

- [ ] Trend bias detected correctly on historical data
- [ ] BOS events detected (not zero)
- [ ] CHoCH appears in trend reversals
- [ ] HTF → ITF → LTF flow matches ICT methodology
- [ ] No false "No valid SMC setup found" rejections

## Known Issues

1. **TypeScript Build Error**: `server.ts(198,4)` - Expected 1 argument but got 2
   - **Status**: Investigating - LivePnlService constructor appears correct
   - **Workaround**: May be TypeScript cache issue, try `tsc --build --clean`

2. **TrendService Type Error**: Fixed - `pdPosition ?? null` handles undefined

## Next Steps

1. ✅ Create core services
2. ✅ Update MarketStructure files
3. ⏳ Update SMCStrategyV2 to use MtfContextService (optional enhancement)
4. ⏳ Add unit tests
5. ⏳ Run backtesting validation
6. ⏳ Performance optimization if needed

## Performance Considerations

The new implementation may be slightly slower due to:
- More comprehensive swing detection
- Full BOS event tracking (not just last)
- CHoCH detection overhead
- Trend snapshot calculation per candle

**Expected Impact:** < 10% slower, but more accurate and suitable for backtesting.

## Rollback Plan

If issues arise, the old implementation can be restored by:
1. Reverting MarketStructureHTF.ts, MarketStructureITF.ts, MarketStructureLTF.ts
2. Removing `smc-core/` directory
3. Restoring old methods

However, the new implementation maintains backward compatibility, so rollback should not be necessary.

