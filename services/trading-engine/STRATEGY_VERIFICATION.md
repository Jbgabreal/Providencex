# Strategy Verification: Backtest vs Live Engine

## ✅ CONFIRMED: Both Use the Same ICT Strategy

### Backtest Configuration
- **Strategy**: ICT Model (H4→M15→M1)
- **Data Source**: MT5 Historical Data
- **Risk:Reward**: 1:3 (from `SMC_RISK_REWARD=3`)
- **Environment**: Root `.env` file

### Live Demo Account Configuration
- **Strategy**: ICT Model (H4→M15→M1) ✅
- **Data Source**: Live MT5 Demo Account
- **Risk:Reward**: 1:3 (from `SMC_RISK_REWARD=3`) ✅
- **Environment**: Root `.env` file ✅

## Verification Evidence

### From Live Engine Logs:
```
Line 881: [SMCStrategyV2] ✅ ICT Model ENABLED - Using strict H4→M15→M1 ICT pipeline
Line 885: [StrategyService] ICT Model ENABLED - Using H4 for bias, M15 for setup, M1 for entry
Line 907: SMC timeframes: HTF=H4, LTF=M1
```

### From Backtest Logs:
```
Line 397: ICT Model: ✅ ENABLED
Line 410: HTF (H4): ... (showing H4 timeframe)
```

## Current Status

### Live Engine Status
- ✅ ICT Strategy: **ENABLED**
- ✅ MT5 Connection: **Connected** (http://localhost:3030)
- ⚠️ Current Blocking: News guardrail is blocking trades (Core PPI m/m event)
- ✅ Ready to Trade: When guardrail allows, trades will execute automatically

## How to Monitor Live Performance

### 1. Check Strategy Configuration
Visit: `http://localhost:3020/strategy-config`

This endpoint shows:
- Current strategy (ICT vs SMC v2)
- Timeframes (H4/M15/M1)
- Risk:Reward ratio
- Debug settings

### 2. Monitor Trade Decisions
Check logs for:
- `[DecisionLogger]` entries showing trade decisions
- `[ICT]` prefixed logs when ICT pipeline runs
- Trades will show as `EXECUTE` when all conditions are met

### 3. View Open Trades
The live engine uses the MT5 demo account and will:
- Execute trades automatically when ICT conditions are met
- Use the same SL/TP logic as backtest (SL under/above M1 OB, TP at 1:3 R:R)
- Log all decisions to the database

## Key Differences: Backtest vs Live

| Aspect | Backtest | Live Demo Account |
|--------|----------|-------------------|
| **Data** | Historical MT5 data | Real-time MT5 data |
| **Execution** | Simulated | Real orders via MT5 |
| **Speed** | Fast (replays past) | Real-time (waits for new candles) |
| **Slippage** | None | May have slippage |
| **Spread** | Historical | Current live spread |

## Next Steps

1. **Wait for Trade Conditions**: The engine will automatically trade when:
   - H4 bias is clear (bullish/bearish)
   - M15 setup zone is detected (displacement + FVG/OB)
   - M1 entry refinement confirms (CHoCH + refined OB)
   - News guardrail allows trading

2. **Monitor Performance**: Check:
   - Admin dashboard for PnL tracking
   - Database for trade history
   - Logs for detailed ICT pipeline execution

3. **Verify Configuration**: Use the `/strategy-config` endpoint to confirm settings match backtest

## Summary

**YES** - The live demo account is using the **exact same ICT strategy** as the backtest. When conditions are met and the news guardrail allows, trades will execute automatically on your demo account.


