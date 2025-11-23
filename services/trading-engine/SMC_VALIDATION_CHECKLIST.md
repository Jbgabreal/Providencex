# SMC Core Services Validation Checklist

## Pre-Validation Setup

- [ ] Ensure TypeScript compiles without errors
- [ ] Ensure all imports resolve correctly
- [ ] Ensure no circular dependencies

## 1. Swing Detection Validation

### Test Cases

- [ ] **Fractal Detection**: Verify swing highs/lows detected with symmetrical pivot window
  - Test with known swing points on historical data
  - Verify no repainting (swing confirmed only after pivotRight bars)
  
- [ ] **Rolling Detection**: Verify rolling lookback detects swings correctly
  - Test with known swing points
  - Verify swings update as new candles arrive
  
- [ ] **Hybrid Detection**: Verify hybrid method combines both approaches
  - Test that historical swings use fractal (more reliable)
  - Test that recent swings use rolling (faster)

### Expected Results

- HTF: Should detect major swing points (5-10 swings per 50 candles)
- ITF: Should detect intermediate swings (10-20 swings per 50 candles)
- LTF: Should detect minor swings (20-40 swings per 50 candles)

## 2. BOS Detection Validation

### Test Cases

- [ ] **Strict Close BOS**: Verify bullish BOS requires `close > swingHigh`
  - Test on known bullish breakouts
  - Verify wick-only breaks are rejected
  
- [ ] **Strict Close BOS**: Verify bearish BOS requires `close < swingLow`
  - Test on known bearish breakouts
  - Verify wick-only breaks are rejected
  
- [ ] **BOS Event Tracking**: Verify all BOS events are tracked (not just last)
  - Test with multiple BOS events in sequence
  - Verify each BOS has correct brokenSwingIndex

### Expected Results

- BOS events should be detected on real chart breakouts
- BOS count should be > 0 on trending markets
- BOS should align with HTF trend direction

## 3. CHoCH Detection Validation

### Test Cases

- [ ] **Bullish→Bearish CHoCH**: Verify CHoCH when bearish BOS breaks last HL
  - Test on known trend reversals from bullish to bearish
  - Verify protected swing (last HL) is correctly identified
  
- [ ] **Bearish→Bullish CHoCH**: Verify CHoCH when bullish BOS breaks last LH
  - Test on known trend reversals from bearish to bullish
  - Verify protected swing (last LH) is correctly identified
  
- [ ] **CHoCH Timing**: Verify CHoCH occurs at correct candle index
  - Compare with manual chart analysis
  - Verify CHoCH index matches BOS index

### Expected Results

- CHoCH should appear in trend reversals
- CHoCH count should be < BOS count (CHoCH is subset of BOS)
- CHoCH should align with visual chart analysis

## 4. Trend Bias Validation

### Test Cases

- [ ] **HH/HL Pattern**: Verify bullish trend detected with higher highs and higher lows
  - Test on known uptrends
  - Verify trend = 'bullish' when pattern confirmed
  
- [ ] **LH/LL Pattern**: Verify bearish trend detected with lower highs and lower lows
  - Test on known downtrends
  - Verify trend = 'bearish' when pattern confirmed
  
- [ ] **PD Position**: Verify PD position calculated correctly (0-1)
  - Test at swing low (should be ~0)
  - Test at swing high (should be ~1)
  - Test at midpoint (should be ~0.5)
  
- [ ] **Trend Snapshots**: Verify trend state tracked per candle
  - Test that trend changes are captured
  - Verify trend snapshots array length = candles array length

### Expected Results

- Trend should match visual chart analysis
- PD position should reflect price location in range
- Trend changes should be detected promptly

## 5. Multi-Timeframe Validation

### Test Cases

- [ ] **HTF Analysis**: Verify HTF structure analysis works
  - Test with H4 candles
  - Verify swings, BOS, CHoCH, trend all detected
  
- [ ] **ITF Analysis**: Verify ITF structure analysis works
  - Test with M15 candles
  - Verify alignment with HTF trend
  
- [ ] **LTF Analysis**: Verify LTF structure analysis works
  - Test with M1 candles
  - Verify entry refinement signals
  
- [ ] **Time Mapping**: Verify LTF time maps to ITF/HTF correctly
  - Test timestamp alignment
  - Verify no timezone issues

### Expected Results

- HTF trend should be stable (changes infrequently)
- ITF should align with HTF (or be neutral)
- LTF should provide entry signals aligned with HTF/ITF

## 6. Integration Validation

### Test Cases

- [ ] **MarketStructureHTF**: Verify analyzeStructure() returns valid context
  - Test with real H4 candles
  - Verify all fields populated correctly
  
- [ ] **MarketStructureITF**: Verify analyzeStructure() returns valid context
  - Test with real M15 candles
  - Verify alignment with HTF trend
  
- [ ] **MarketStructureLTF**: Verify analyzeStructure() returns valid context
  - Test with real M1 candles
  - Verify entry signals generated
  
- [ ] **SMCStrategyV2**: Verify generateEnhancedSignal() works end-to-end
  - Test with real market data
  - Verify signals generated when conditions met
  - Verify no false rejections

### Expected Results

- All structure analyses should complete without errors
- Signals should be generated on valid setups
- No "No valid SMC setup found" on clearly valid setups

## 7. Backtesting Validation

### Test Cases

- [ ] **Historical Data**: Run backtest on 1 month of data
  - Verify no errors
  - Verify signals generated
  
- [ ] **Trend Detection**: Verify trend detected correctly on historical data
  - Compare with manual chart analysis
  - Verify trend changes detected at correct times
  
- [ ] **BOS Detection**: Verify BOS detected on historical breakouts
  - Count BOS events per symbol
  - Verify BOS count > 0 for trending periods
  
- [ ] **CHoCH Detection**: Verify CHoCH detected on trend reversals
  - Count CHoCH events per symbol
  - Verify CHoCH aligns with visual reversals

### Expected Results

- Backtest should complete without errors
- Trend bias should be detected correctly
- BOS should be detected (not zero)
- CHoCH should appear in reversals
- HTF → ITF → LTF flow should match ICT methodology

## 8. Performance Validation

### Test Cases

- [ ] **Swing Detection Speed**: Measure time for 1000 candles
  - Should complete in < 100ms
  
- [ ] **BOS Detection Speed**: Measure time for 1000 candles
  - Should complete in < 50ms
  
- [ ] **Full Analysis Speed**: Measure time for HTF+ITF+LTF analysis
  - Should complete in < 500ms
  
- [ ] **Memory Usage**: Monitor memory during backtest
  - Should not exceed reasonable limits

### Expected Results

- All operations should complete in reasonable time
- Memory usage should be stable
- No memory leaks

## 9. Edge Cases

### Test Cases

- [ ] **Empty Candles**: Verify handles empty array gracefully
- [ ] **Single Candle**: Verify handles single candle
- [ ] **Few Candles**: Verify handles < 10 candles
- [ ] **No Swings**: Verify handles markets with no clear swings
- [ ] **Sideways Market**: Verify handles sideways/choppy markets
- [ ] **Gap Data**: Verify handles missing candles (gaps)

### Expected Results

- All edge cases should be handled gracefully
- No crashes or errors
- Appropriate fallback behavior

## 10. Symbol-Specific Validation

### Test Cases

- [ ] **XAUUSD**: Verify works correctly for gold
  - Test with H4/M15/M1 candles
  - Verify swings detected correctly
  
- [ ] **EURUSD**: Verify works correctly for FX
  - Test with H4/M15/M1 candles
  - Verify swings detected correctly
  
- [ ] **US30**: Verify works correctly for index
  - Test with H4/M15/M1 candles
  - Verify swings detected correctly

### Expected Results

- All symbols should work correctly
- No symbol-specific errors
- Appropriate swing detection for each symbol's volatility

## Validation Report Template

```
Date: ___________
Tester: ___________

Swing Detection: [ ] PASS [ ] FAIL
BOS Detection: [ ] PASS [ ] FAIL
CHoCH Detection: [ ] PASS [ ] FAIL
Trend Bias: [ ] PASS [ ] FAIL
Multi-Timeframe: [ ] PASS [ ] FAIL
Integration: [ ] PASS [ ] FAIL
Backtesting: [ ] PASS [ ] FAIL
Performance: [ ] PASS [ ] FAIL
Edge Cases: [ ] PASS [ ] FAIL
Symbol-Specific: [ ] PASS [ ] FAIL

Issues Found:
1. 
2. 
3. 

Notes:
```

