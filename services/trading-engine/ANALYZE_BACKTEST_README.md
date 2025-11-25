# Backtest Analysis Tool

Simple tool to send backtest results to OpenAI for improvement suggestions.

## Usage

### Analyze latest backtest:
```bash
pnpm analyze-backtest
```

### Analyze specific backtest run:
```bash
pnpm analyze-backtest --run-id backtest_1764029615374
```

## What it does

1. **Loads backtest results** from the specified (or latest) backtest run
2. **Reads strategy code** (SMCStrategyV2.ts, StrategyService.ts, executionFilterConfig.ts)
3. **Reads configuration** (.env, config files)
4. **Sends to OpenAI** for analysis with:
   - Backtest performance metrics
   - Strategy implementation code
   - Configuration settings
5. **Saves analysis** to `backtests/analysis/ai_analysis_[run_id]_[timestamp].md`

## Requirements

- `OPENAI_API_KEY` environment variable must be set in `.env`
- A backtest must have been run first

## Output

The tool will:
- Display the AI analysis in the console
- Save a markdown file with the analysis
- Provide specific, actionable suggestions for improvement

## Example Output

The AI will provide:
- **DIAGNOSIS**: Brief summary of main issues
- **ROOT CAUSES**: Detailed explanation of why the strategy is failing
- **SUGGESTIONS**: Specific changes to files/configuration with explanations

