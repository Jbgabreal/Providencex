# Admin Dashboard v1

Read-only admin monitoring dashboard for ProvidenceX Trading Engine.

## Features

- **Overview**: Daily metrics, trades by symbol/strategy, top skip reasons
- **Decisions**: Table of recent trade decisions with filters and pagination
- **Exposure**: Real-time exposure snapshot per symbol and globally
- **Backtests**: History of backtest runs with performance metrics

## Setup

### Environment Variables

Create a `.env.local` file in `services/admin-dashboard/`:

```env
NEXT_PUBLIC_TRADING_ENGINE_BASE_URL=http://localhost:3020
```

Or set it in the root `.env` file:

```env
NEXT_PUBLIC_TRADING_ENGINE_BASE_URL=http://localhost:3020
```

### Install Dependencies

```bash
pnpm install
```

### Run Development Server

```bash
pnpm dev
```

The dashboard will be available at: http://localhost:3010

## Usage

### Overview Page (`/`)

Displays:
- Summary cards: Total decisions, trades, skips, date
- Trades by symbol table
- Trades by strategy table
- Top skip reasons list

Data source: `GET /api/v1/admin/metrics/daily`

### Decisions Page (`/decisions`)

Features:
- Filter by symbol, strategy, decision type
- Pagination (25/50/100/200 per page)
- Table showing: Time, Symbol, Strategy, Decision, Direction, Reasons

Data source: `GET /api/v1/admin/decisions`

### Exposure Page (`/exposure`)

Features:
- Auto-refresh every 10 seconds
- Global summary cards: Total open trades, Total estimated risk
- Symbol exposure table: Long/Short positions, Estimated risk per symbol

Data source: `GET /api/v1/status/exposure`

### Backtests Page (`/backtests`)

Features:
- Filter by symbol and strategy
- Table showing: Created at, Symbol, Strategy, Date range, Win rate, Profit factor, Max drawdown, Total trades, Return %

Data source: `GET /api/v1/admin/backtests`

## API Endpoints

The dashboard consumes the following Trading Engine endpoints:

- `GET /api/v1/admin/decisions` - Recent trade decisions
- `GET /api/v1/admin/metrics/daily` - Daily aggregate metrics
- `GET /api/v1/status/exposure` - Real-time exposure snapshot
- `GET /api/v1/admin/backtests` - Backtest run history

## Development

### Project Structure

```
services/admin-dashboard/
├── app/
│   ├── layout.tsx          # Root layout with navigation
│   ├── page.tsx            # Overview page
│   ├── decisions/
│   │   └── page.tsx        # Decisions page
│   ├── exposure/
│   │   └── page.tsx        # Exposure page
│   ├── backtests/
│   │   └── page.tsx        # Backtests page
│   └── globals.css         # Global styles
├── types.ts                # TypeScript types
├── package.json
├── tsconfig.json
├── next.config.js
├── tailwind.config.ts
└── README.md
```

### Tech Stack

- **Next.js 14** (App Router)
- **TypeScript**
- **Tailwind CSS**
- **React 18**

### Building

```bash
pnpm build
pnpm start
```

## Troubleshooting

### Dashboard shows "Error: Failed to fetch"

- Ensure Trading Engine is running on port 3020
- Check `NEXT_PUBLIC_TRADING_ENGINE_BASE_URL` is set correctly
- Check CORS settings (if Trading Engine blocks cross-origin requests, add CORS middleware)

### No data showing

- Ensure Trading Engine has generated trade decisions (let it run for a bit)
- Check database connection in Trading Engine logs
- Verify endpoints are accessible: `curl http://localhost:3020/api/v1/admin/metrics/daily`

### Exposure shows "Exposure unavailable"

- Ensure OpenTradesService is running in Trading Engine
- Check MT5 Connector is accessible
- Verify `/api/v1/status/exposure` endpoint returns data

## Future Enhancements

- Authentication & authorization
- Real-time updates via WebSockets
- Charts for performance visualization
- Export data to CSV/JSON
- Alerting when exposure exceeds thresholds


