# Downloading Historical Data from XM Global for Backtesting

This guide explains how to download historical data from your XM Global MT5 account and store it in Postgres for backtesting.

## Prerequisites

1. **MT5 Terminal** connected to XM Global
2. **MT5 Connector** service running (`pnpm --filter @providencex/mt5-connector dev`)
3. **PostgreSQL** database configured
4. **DATABASE_URL** environment variable set

## Step 1: Download History in MT5 Terminal

Before you can download data programmatically, you need to ensure MT5 terminal has the historical data downloaded locally.

### Method 1: Download via MT5 Terminal (Recommended)

1. Open **MetaTrader 5** terminal
2. Go to **Tools** → **History Center** (or press `F2`)
3. In the left panel, find your symbol (e.g., **XAUUSD**)
4. Right-click on **XAUUSD** → **Download**
5. Select the date range you need (e.g., from 2024-01-01 to 2024-12-31)
6. Select **M1** (1-minute) timeframe
7. Click **Download**
8. Wait for the download to complete

**Note**: XM Global typically provides:
- **M1 data**: Last 1-3 months (varies by broker)
- **M5/M15/H1/H4 data**: Longer history available (up to 1-2 years)

### Method 2: Request Extended History from XM Global

If you need data older than what's available in History Center:

1. Contact XM Global support
2. Request historical data for your symbols
3. They may provide CSV files or extended download access

## Step 2: Download Data to Postgres

Once MT5 terminal has the data, use the download script to store it in Postgres:

### Basic Usage

```bash
# Download last 90 days of M1 data
pnpm --filter @providencex/trading-engine download-history --symbol XAUUSD --days 90 --timeframe M1

# Download specific date range
pnpm --filter @providencex/trading-engine download-history --symbol XAUUSD --from 2024-01-01 --to 2024-12-31 --timeframe M1
```

### Download Multiple Symbols

```bash
# Download XAUUSD
pnpm --filter @providencex/trading-engine download-history --symbol XAUUSD --days 365 --timeframe M1

# Download EURUSD
pnpm --filter @providencex/trading-engine download-history --symbol EURUSD --days 365 --timeframe M1

# Download GBPUSD
pnpm --filter @providencex/trading-engine download-history --symbol GBPUSD --days 365 --timeframe M1

# Download US30
pnpm --filter @providencex/trading-engine download-history --symbol US30 --days 365 --timeframe M1
```

### Download Different Timeframes

```bash
# M1 (1-minute) - Most detailed, largest dataset
pnpm --filter @providencex/trading-engine download-history --symbol XAUUSD --days 90 --timeframe M1

# M5 (5-minute) - Smaller dataset, still good for backtesting
pnpm --filter @providencex/trading-engine download-history --symbol XAUUSD --days 180 --timeframe M5

# H1 (1-hour) - Even smaller, good for longer backtests
pnpm --filter @providencex/trading-engine download-history --symbol XAUUSD --days 365 --timeframe H1
```

## Step 3: Verify Data

Check what data you have stored:

```sql
-- Connect to your database
psql $DATABASE_URL

-- Check data for a symbol
SELECT 
  symbol,
  timeframe,
  COUNT(*) as candle_count,
  MIN(timestamp) as earliest,
  MAX(timestamp) as latest
FROM historical_candles
WHERE symbol = 'XAUUSD' AND timeframe = 'M1'
GROUP BY symbol, timeframe;
```

## Step 4: Run Backtests with Postgres Data

Once data is stored, use the `postgres` data source for backtesting:

```bash
# Backtest using Postgres data
pnpm --filter @providencex/trading-engine backtest \
  --symbol XAUUSD \
  --from 2024-02-01 \
  --to 2024-02-07 \
  --data-source postgres
```

## Troubleshooting

### "No historical data returned from MT5"

**Cause**: MT5 terminal doesn't have the requested data downloaded.

**Solution**:
1. Open MT5 terminal
2. Go to Tools → History Center
3. Download the required date range for your symbol
4. Try the download script again

### "MT5 connector error"

**Cause**: MT5 Connector service is not running or not connected to MT5.

**Solution**:
1. Ensure MT5 terminal is running and logged in
2. Start MT5 Connector: `pnpm --filter @providencex/mt5-connector dev`
3. Check connection: `curl http://localhost:3030/health`

### "Database connection failed"

**Cause**: DATABASE_URL not configured or database not accessible.

**Solution**:
1. Check `.env` file has `DATABASE_URL` set
2. Verify database is running and accessible
3. Test connection: `psql $DATABASE_URL -c "SELECT 1"`

## Tips

1. **Start with smaller date ranges**: Download 30-90 days first to test, then expand
2. **M1 data is large**: 1 year of M1 data = ~525,600 candles per symbol
3. **Use M5 for longer backtests**: M5 has 5x fewer candles but still good quality
4. **Download during off-hours**: Large downloads can take time
5. **Check MT5 terminal logs**: If downloads fail, check MT5 terminal for errors

## Data Storage

Data is stored in the `historical_candles` table with:
- **Unique constraint**: `(symbol, timeframe, timestamp)` - prevents duplicates
- **Automatic updates**: If you re-download, existing candles are updated
- **Indexed**: Fast queries by symbol, timeframe, and date range

## Example: Complete Workflow

```bash
# 1. Download last 3 months of M1 data for XAUUSD
pnpm --filter @providencex/trading-engine download-history \
  --symbol XAUUSD \
  --days 90 \
  --timeframe M1

# 2. Verify data was stored
psql $DATABASE_URL -c "SELECT COUNT(*) FROM historical_candles WHERE symbol='XAUUSD' AND timeframe='M1'"

# 3. Run backtest using Postgres data
pnpm --filter @providencex/trading-engine backtest \
  --symbol XAUUSD \
  --from 2024-11-01 \
  --to 2024-11-07 \
  --data-source postgres
```

## Limitations

- **MT5 terminal history**: Limited by what XM Global provides (typically 1-3 months for M1)
- **Download speed**: Depends on MT5 terminal and network connection
- **Storage**: Large datasets require significant database storage
- **Timeframe availability**: M1 has shortest history, higher timeframes have longer history

For older data (beyond MT5 terminal limits), consider:
- Using third-party data providers
- Purchasing historical data
- Using CSV imports if you have data files

