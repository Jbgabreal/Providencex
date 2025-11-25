# Optimizer Flow Diagram

## Visual Flow

```
┌─────────────────────────────────────────────────────────────┐
│                    INITIALIZATION                            │
├─────────────────────────────────────────────────────────────┤
│ 1. Parse CLI args (--from, --to, --symbol, --data-source)   │
│ 2. Load OpenAI API key & DATABASE_URL                        │
│ 3. Load previous change log                                  │
│ 4. Create optimization directory                             │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│              OPTIMIZATION LOOP (3 iterations max)            │
└─────────────────────────────────────────────────────────────┘
                            │
            ┌───────────────┴───────────────┐
            │                               │
    ┌───────▼────────┐             ┌───────▼────────┐
    │  ITERATION 1   │             │  ITERATION 2+  │
    └───────┬────────┘             └───────┬────────┘
            │                               │
            ▼                               ▼
    ┌───────────────┐              ┌───────────────┐
    │ Run Backtest  │              │ Run Backtest  │
    │ - Load M1 data│              │ - With new    │
    │ - Process     │              │   config      │
    │   candles     │              │ - Process     │
    │ - Generate    │              │   candles     │
    │   trades      │              │ - Generate    │
    │ - Calculate   │              │   trades      │
    │   metrics     │              │ - Calculate   │
    └───────┬───────┘              │   metrics     │
            │                      └───────┬───────┘
            │                               │
            ▼                               ▼
    ┌───────────────┐              ┌───────────────┐
    │ Extract       │              │ Compare with  │
    │ Results       │              │ Previous      │
    │ - totalTrades │              │ Results       │
    │ - winRate     │              │ - Check if    │
    │ - totalPnL    │              │   improved    │
    │ - profitFactor│              │ - Revert if   │
    │ - etc.        │              │   worsened    │
    └───────┬───────┘              └───────┬───────┘
            │                               │
            └───────────────┬───────────────┘
                            │
                            ▼
                    ┌───────────────┐
                    │ Check         │
                    │ Profitability │
                    │ - PF ≥ 1.3    │
                    │ - DD ≤ 25%    │
                    │ - R:R ≥ 2.5   │
                    │ - WR ≥ 35%    │
                    │ - Return > 0% │
                    └───────┬───────┘
                            │
            ┌───────────────┴───────────────┐
            │                               │
            ▼                               ▼
    ┌───────────────┐              ┌───────────────┐
    │  PROFITABLE   │              │ NOT PROFITABLE│
    │  ✅ STOP      │              │  → AI Analysis│
    └───────────────┘              └───────┬───────┘
                                           │
                                           ▼
                                    ┌───────────────┐
                                    │ AI Analysis   │
                                    │ - Read        │
                                    │   strategy    │
                                    │   code        │
                                    │ - Read config │
                                    │ - Send to     │
                                    │   OpenAI      │
                                    │ - Get         │
                                    │   suggestions │
                                    └───────┬───────┘
                                            │
                                            ▼
                                    ┌───────────────┐
                                    │ Apply         │
                                    │ Suggestions   │
                                    │ - Update .env │
                                    │ - Log code    │
                                    │   changes     │
                                    │ - Save to     │
                                    │   change log  │
                                    └───────┬───────┘
                                            │
                                            ▼
                                    ┌───────────────┐
                                    │ Next          │
                                    │ Iteration     │
                                    │ (if not max)  │
                                    └───────┬───────┘
                                            │
                            ┌───────────────┴───────────────┐
                            │                               │
                            ▼                               ▼
                    ┌───────────────┐              ┌───────────────┐
                    │ Max           │              │ Continue      │
                    │ Iterations    │              │ to Iteration  │
                    │ Reached?      │              │ 2/3           │
                    │ → STOP        │              │               │
                    └───────────────┘              └───────────────┘
                            │
                            ▼
                    ┌───────────────┐
                    │ Final Summary │
                    │ - Total       │
                    │   iterations  │
                    │ - Final       │
                    │   results     │
                    │ - Changes     │
                    │   applied     │
                    └───────────────┘
```

## Step-by-Step Flow for Each Iteration

### Phase 1: Run Backtest (2-5 minutes)
```
┌─────────────────────────────────────────────┐
│ 1. Load historical M1 data from MT5         │
│ 2. Initialize strategy services             │
│ 3. Process each candle sequentially         │
│ 4. Generate signals                        │
│ 5. Execute trades (via SimulatedMT5)       │
│ 6. Update positions                        │
│ 7. Calculate final stats                   │
└─────────────────────────────────────────────┘
```

### Phase 2: Extract & Display Results (< 1 second)
```
┌─────────────────────────────────────────────┐
│ 1. Parse BacktestResult object              │
│ 2. Extract stats.stats properties           │
│ 3. Convert to BacktestResults format        │
│ 4. Save to JSON file                        │
│ 5. Display metrics                          │
└─────────────────────────────────────────────┘
```

### Phase 3: Check Profitability (< 1 second)
```
┌─────────────────────────────────────────────┐
│ If ALL criteria met:                        │
│   ✅ Profit Factor ≥ 1.3                    │
│   ✅ Max Drawdown ≤ 25%                     │
│   ✅ Avg R:R ≥ 2.5                          │
│   ✅ Win Rate ≥ 35%                         │
│   ✅ Total Return > 0%                      │
│ → BREAK (optimization successful)           │
│                                             │
│ Else:                                       │
│ → Continue to AI Analysis                   │
└─────────────────────────────────────────────┘
```

### Phase 4: AI Analysis (30-60 seconds)
```
┌─────────────────────────────────────────────┐
│ 1. Read strategy code files                 │
│    - SMCStrategyV2.ts                       │
│    - M1ExecutionService.ts                  │
│    - .env (relevant lines)                  │
│                                             │
│ 2. Build prompt with:                       │
│    - Backtest results                       │
│    - Strategy code                          │
│    - Current config                         │
│    - Previous changes (if any)              │
│                                             │
│ 3. Send to OpenAI API                       │
│                                             │
│ 4. Parse AI response:                       │
│    - Identify issues                        │
│    - Extract suggestions                    │
│    - Format as changes                      │
└─────────────────────────────────────────────┘
```

### Phase 5: Apply Suggestions (< 1 second)
```
┌─────────────────────────────────────────────┐
│ For each suggestion:                        │
│                                             │
│ 1. ENV Variable Change:                     │
│    - Update .env file                       │
│    - Format: KEY=value                      │
│                                             │
│ 2. Code Change:                             │
│    - Log suggestion                         │
│    - Mark for manual review                 │
│    - DON'T auto-apply                       │
│                                             │
│ 3. Save to change log                       │
└─────────────────────────────────────────────┘
```

## Example Execution Log

```
[OPTIMIZER] 🔄 STARTING OPTIMIZATION LOOP
[OPTIMIZER] Max iterations: 3

═══════════════════════════════════════════════════════
ITERATION 1/3
═══════════════════════════════════════════════════════

🚀 Starting backtest...
[OPTIMIZER] 🚀 STARTING BACKTEST (Iteration 1/3)
[BacktestRunner] Loading M1 candles from mt5...
[BacktestRunner] Loaded 1379 M1 candles for XAUUSD
[BacktestRunner] Starting candle replay: 1379 candles to process
[BacktestRunner] Progress: 100/1379 candles (7.3%) - 2 trades
[BacktestRunner] Progress: 500/1379 candles (36.3%) - 8 trades
[BacktestRunner] Progress: 1000/1379 candles (72.5%) - 12 trades
[BacktestRunner] Progress: 1379/1379 candles (100%) - 15 trades

✅ Results extracted successfully!
  Trades: 15
  Win Rate: 40.00%
  Total PnL: -$250.00
  Profit Factor: 0.75
  Avg R:R: 2.1
  Max Drawdown: 18.50%
  Total Return: -2.50%

📊 Checking profitability criteria...
  Profit Factor: 0.75 (target: ≥1.3) - ❌
  Max Drawdown: 18.50% (target: ≤25%) - ✅
  Avg R:R: 2.1 (target: ≥2.5) - ❌
  Win Rate: 40.00% (target: ≥35%) - ✅
  Total Return: -2.50% (target: >0%) - ❌

⚠️  Strategy is NOT profitable yet. Continuing to AI analysis...

📖 Reading strategy logic...
🤖 Analyzing with AI...
  - Win rate is acceptable but could be improved
  - Profit factor too low - many small losses
  - Risk:Reward ratio below target
  - Suggestion: Increase min confluence score from 30 to 35

📝 Applying suggestions...
  ✅ Updated: SMC_MIN_CONFLUENCE_SCORE = 30 → 35

═══════════════════════════════════════════════════════
ITERATION 2/3
═══════════════════════════════════════════════════════

🚀 Starting backtest...
[OPTIMIZER] 🚀 STARTING BACKTEST (Iteration 2/3)
... (backtest runs with new config)
✅ Results extracted successfully!
  Trades: 12
  Win Rate: 42.50%
  Total PnL: -$150.00
  Profit Factor: 0.85
  Avg R:R: 2.3
  Max Drawdown: 16.00%
  Total Return: -1.50%

📈 Comparison with previous iteration:
  Trades: 15 → 12 (-3)
  Win Rate: 40.00% → 42.50% (+2.50%)
  Total PnL: -$250.00 → -$150.00 (+$100.00)
  Profit Factor: 0.75 → 0.85 (+0.10)

📊 Checking profitability...
⚠️  Still not profitable, continuing...

... (AI analysis continues)
```

This is what the optimizer should do step by step!

