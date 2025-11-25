# AI-Powered Strategy Optimizer

This tool uses OpenAI to automatically analyze backtest results, suggest improvements, and iterate until the strategy is profitable.

## Setup

1. **Install dependencies:**
   ```bash
   cd services/trading-engine
   pnpm install
   ```

2. **Set OpenAI API Key:**
   Add to your `.env` file:
   ```env
   OPENAI_API_KEY=your_openai_api_key_here
   OPENAI_MODEL=gpt-4-turbo-preview  # Optional, defaults to gpt-4-turbo-preview
   AI_OPTIMIZER_MAX_ITERATIONS=10    # Optional, defaults to 10
   ```

## Usage

### Basic Usage
```bash
pnpm ai-optimize --symbol XAUUSD --data-source postgres --year 2023
```

### Options
- `--symbol`: Trading symbol (default: XAUUSD)
- `--data-source`: Data source - `postgres` or `mt5` (default: postgres)
- `--year`: Year to backtest (default: 2023)

### Example
```bash
# Optimize XAUUSD strategy using PostgreSQL data for 2023
pnpm ai-optimize --symbol XAUUSD --data-source postgres --year 2023

# Optimize using MT5 data
pnpm ai-optimize --symbol XAUUSD --data-source mt5 --year 2023
```

## How It Works

1. **Runs Batch Backtest**: Executes 12 monthly backtests for the specified year
2. **Analyzes Results**: Sends results to OpenAI with:
   - Current strategy code context
   - Configuration settings
   - Performance metrics
   - Monthly breakdown
3. **Gets AI Suggestions**: OpenAI provides:
   - Diagnosis of the main problem
   - Root causes
   - Specific, actionable suggestions (code changes, config changes)
   - Expected impact
4. **Applies Changes**: Automatically updates `.env` config variables
5. **Iterates**: Re-runs backtest with new configuration
6. **Stops When Profitable**: Continues until target metrics are met or max iterations reached

## Target Metrics

The optimizer aims to achieve:
- **Profit Factor**: ≥ 1.3
- **Max Drawdown**: ≤ 25%
- **Avg R:R**: ≥ 2.5
- **Win Rate**: ≥ 35%
- **Profitable Months**: ≥ 6/12 (50%+)

## Output

Results are saved in `backtests/ai_optimizer/`:
- `iteration_N_timestamp.json`: Backtest results for each iteration
- `analysis_N_timestamp.json`: AI analysis and suggestions for each iteration

## Example Output

```
ITERATION 1/10
================================================================================

📊 CURRENT RESULTS
--------------------------------------------------------------------------------
Total PnL: $-19,048.15
Avg Profit Factor: 0.87 (target: 1.3+)
Avg Win Rate: 23.12% (target: 35%+)
Avg R:R: 1.46 (target: 2.5+)
Max Drawdown: 45.59% (target: <25%)
Profitable Months: 2/12 (target: 6+)

🤖 AI ANALYSIS
--------------------------------------------------------------------------------
Diagnosis: Low win rate and poor R:R suggest SLs are being hit too often and TPs aren't being reached.

Root Causes:
  1. SLs placed too close to entry (tight stops)
  2. TPs placed in liquidity zones
  3. Overtrading in choppy markets
  4. Entry quality filters not strict enough

Suggestions:
  1. [HIGH] SL Placement: Increase minimum risk distance to 1.0 units
     Reasoning: Current 0.7 units is too tight, causing premature SL hits
  2. [HIGH] TP Placement: Use structural targets (2-3R) instead of fixed 3R
     Reasoning: Structural targets are more likely to be hit
  3. [MEDIUM] Market Filters: Increase volatility threshold to 30%
     Reasoning: Avoid trading in low volatility (choppy) conditions

Expected Impact: Win rate should improve to 28-30%, R:R to 1.8-2.0

✅ Iteration 1 complete. Continuing to next iteration...
```

## Manual Code Changes

The tool automatically applies config changes (`.env` variables), but code changes require manual review. The AI will suggest specific code changes with file paths and function names. Review the analysis files and apply code changes manually.

## Tips

1. **Start with Good Baseline**: Run a manual backtest first to understand current performance
2. **Review AI Suggestions**: Check the analysis files to understand the reasoning
3. **Apply Code Changes Carefully**: Some suggestions may require careful implementation
4. **Monitor Progress**: Watch how metrics improve (or don't) across iterations
5. **Stop Early if Needed**: If results are getting worse, stop and review

## Troubleshooting

### "OPENAI_API_KEY environment variable is required"
- Make sure you've added `OPENAI_API_KEY` to your `.env` file
- Restart your terminal/IDE after adding the variable

### "No response from OpenAI"
- Check your API key is valid
- Check your OpenAI account has credits
- Try a different model (set `OPENAI_MODEL=gpt-4` in `.env`)

### Results Getting Worse
- The AI might suggest changes that don't work
- Review the analysis files to understand what changed
- Consider reverting to a previous iteration's configuration

## Cost Estimation

Each iteration uses:
- ~1-2 API calls to OpenAI (analysis + potential follow-up)
- ~$0.01-0.03 per iteration (using gpt-4-turbo-preview)
- 10 iterations ≈ $0.10-0.30

## Limitations

1. **Code Changes**: Only config changes are applied automatically. Code changes require manual review.
2. **Token Limits**: Large codebases may exceed token limits. The tool only includes first 500 lines of key files.
3. **Iteration Limit**: Defaults to 10 iterations. Adjust with `AI_OPTIMIZER_MAX_ITERATIONS`.
4. **No Guarantee**: AI suggestions may not always improve results. Review and validate changes.


