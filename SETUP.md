# ProvidenceX Setup Guide

## Quick Start

1. **Install pnpm** (if not already installed):
   ```bash
   npm install -g pnpm
   ```

2. **Install dependencies**:
   ```bash
   pnpm install
   ```

3. **Create `.env` file** in the root directory:
   ```bash
   # Copy this template and fill in your values
   DATABASE_URL=postgres://user:password@host:5432/providencex
   PX_TIMEZONE=America/New_York
   OPENAI_API_KEY=sk-...
   SCREENSHOTONE_ACCESS_KEY=...
   NEWS_GUARDRAIL_PORT=3010
   TRADING_ENGINE_PORT=3020
   MT5_CONNECTOR_PORT=3030
   PORTFOLIO_ENGINE_PORT=3040
   FARMING_ENGINE_PORT=3050
   API_GATEWAY_PORT=3000
   NEWS_GUARDRAIL_URL=http://localhost:3010
   TRADING_ENGINE_URL=http://localhost:3020
   MT5_CONNECTOR_URL=http://localhost:3030
   PORTFOLIO_ENGINE_URL=http://localhost:3040
   FARMING_ENGINE_URL=http://localhost:3050
   ```

4. **Build shared packages**:
   ```bash
   pnpm --filter './packages/*' build
   ```

5. **Start services**:
   ```bash
   # Start all services in parallel
   pnpm dev
   
   # Or start individually:
   pnpm --filter @providencex/news-guardrail dev
   pnpm --filter @providencex/trading-engine dev
   # etc.
   ```

## Database Setup

The news-guardrail service will automatically create its database schema on first startup. 

For manual setup:
```sql
CREATE TABLE IF NOT EXISTS daily_news_windows (
  id SERIAL PRIMARY KEY,
  date DATE NOT NULL UNIQUE,
  avoid_windows JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_daily_news_windows_date ON daily_news_windows(date);
```

## Testing

Once services are running, test the endpoints:

```bash
# News Guardrail
curl http://localhost:3010/health
curl http://localhost:3010/can-i-trade-now

# Trading Engine
curl http://localhost:3020/health

# MT5 Connector
curl http://localhost:3030/health
```

## Troubleshooting

### "Cannot find module '@providencex/shared-*'"

Make sure you've built the shared packages:
```bash
pnpm --filter './packages/*' build
```

### Database connection errors

Verify your `DATABASE_URL` is correct and the database is accessible:
```bash
psql $DATABASE_URL -c "SELECT 1;"
```

### Port already in use

Change the port in your `.env` file or stop the service using that port.

