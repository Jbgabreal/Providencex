# ProvidenceX Client Portal - Setup Guide

## Quick Start

### 1. Install Dependencies

```bash
cd services/client-portal
pnpm install
```

### 2. Configure Environment Variables

**Add these variables to your root `.env` file** (at the project root, not in `services/client-portal/`):

```env
# Client Portal Configuration
NEXT_PUBLIC_PRIVY_APP_ID=your_privy_app_id_here
NEXT_PUBLIC_BACKEND_BASE_URL=http://localhost:3020
NEXT_PUBLIC_DEV_MODE=true
```

**Note**: The client portal automatically loads from the root `.env` file. See `ROOT_ENV_SETUP.md` for details.

### 3. Get Privy App ID

1. Go to [Privy Dashboard](https://dashboard.privy.io/)
2. Create a new app or select existing app
3. Copy your App ID
4. Add it to your root `.env` file as `NEXT_PUBLIC_PRIVY_APP_ID`

### 4. Start Development Server

```bash
pnpm dev
```

The portal will be available at: **http://localhost:3002**

## Architecture

### Authentication Flow

1. User logs in via Privy (email)
2. Privy access token is stored in `AuthContext`
3. Token is attached to all API requests via `apiClient` interceptor
4. Protected routes check authentication via `AuthGuard`
5. 401 responses automatically redirect to `/login`

### API Integration

All API calls go through:
- **Base URL**: `NEXT_PUBLIC_BACKEND_BASE_URL` (default: http://localhost:3020)
- **Auth Header**: `Authorization: Bearer <privy_token>`
- **Dev Headers**: In dev mode, also sends `x-user-id` and `x-user-role`

### Key Features

✅ **MT5 Account Management**
- Connect MT5 accounts with account number, server, and connector URL
- Pause/resume/disconnect accounts
- Status badges (Connected, Paused, Disconnected)

✅ **Strategy Selection**
- Browse available strategies with performance metrics
- Risk tier badges (Low, Medium, High)
- Assign strategies to MT5 accounts
- Manage active assignments (pause/resume/stop)

✅ **Analytics Dashboard**
- Real-time PnL summary cards
- Equity curve chart
- Open positions table
- Win rate and profit factor metrics

✅ **Trade Activity**
- Filter by MT5 account and strategy
- Open positions view
- Trade history with entry/exit prices
- PnL tracking

## Project Structure

```
services/client-portal/
├── src/
│   ├── app/                    # Next.js App Router
│   │   ├── (protected)/       # Protected routes
│   │   │   ├── dashboard/     # Analytics dashboard
│   │   │   ├── accounts/      # MT5 account management
│   │   │   ├── strategies/    # Strategy selection & assignment
│   │   │   ├── activity/      # Trade history & positions
│   │   │   ├── settings/      # User settings
│   │   │   └── layout.tsx     # Shell layout wrapper
│   │   ├── login/             # Public login page
│   │   ├── layout.tsx         # Root layout with providers
│   │   ├── page.tsx           # Redirects to /dashboard
│   │   └── globals.css        # Global styles
│   ├── components/
│   │   ├── AuthGuard.tsx      # Route protection
│   │   └── Layout/
│   │       └── Shell.tsx      # Main app shell (sidebar + topbar)
│   ├── config/
│   │   └── env.ts             # Environment configuration
│   ├── context/
│   │   └── AuthContext.tsx    # Authentication context
│   ├── hooks/                 # React Query hooks
│   │   ├── useMt5Accounts.ts
│   │   ├── useStrategies.ts
│   │   ├── useStrategyAssignments.ts
│   │   └── useAnalytics.ts
│   ├── lib/
│   │   ├── apiClient.ts       # Axios instance with interceptors
│   │   └── authTokenSingleton.ts  # Token storage for API client
│   ├── providers/
│   │   ├── PrivyProviderWrapper.tsx
│   │   └── ReactQueryProvider.tsx
│   └── types/
│       └── api.ts             # API type definitions
├── package.json
├── tailwind.config.ts
├── tsconfig.json
└── README.md
```

## Backend API Endpoints Used

### Authentication
- All endpoints require `Authorization: Bearer <token>` header
- In dev mode, also sends `x-user-id` and `x-user-role` headers

### MT5 Accounts
- `GET /api/user/mt5-accounts` - List user's MT5 accounts
- `POST /api/user/mt5-accounts` - Create new MT5 account
- `POST /api/user/mt5-accounts/:id/pause` - Pause account
- `POST /api/user/mt5-accounts/:id/resume` - Resume account
- `POST /api/user/mt5-accounts/:id/disconnect` - Disconnect account

### Strategies
- `GET /api/user/strategies` - List available strategies
- `GET /api/user/strategies/:key` - Get strategy details
- `GET /api/user/strategies/:key/performance` - Get performance history

### Strategy Assignments
- `GET /api/user/strategy-assignments` - List user's assignments
- `POST /api/user/strategy-assignments` - Create assignment
- `POST /api/user/strategy-assignments/:id/pause` - Pause assignment
- `POST /api/user/strategy-assignments/:id/resume` - Resume assignment
- `POST /api/user/strategy-assignments/:id/stop` - Stop assignment

### Analytics
- `GET /api/user/analytics/summary` - Get analytics summary
- `GET /api/user/analytics/trades` - Get trade history
- `GET /api/user/analytics/open-positions` - Get open positions
- `GET /api/user/analytics/equity-curve` - Get equity curve data

## Development

### Build for Production

```bash
pnpm build
```

### Start Production Server

```bash
pnpm start
```

### Type Checking

TypeScript is configured with strict mode. The project should compile without errors.

## Troubleshooting

### "Missing required environment variable"

Make sure `.env.local` exists and has all required variables:
- `NEXT_PUBLIC_PRIVY_APP_ID`
- `NEXT_PUBLIC_BACKEND_BASE_URL`

### "Failed to fetch" errors

1. Check that the trading-engine backend is running on port 3020
2. Verify `NEXT_PUBLIC_BACKEND_BASE_URL` matches the backend URL
3. Check browser console for CORS errors
4. Ensure backend has CORS enabled for localhost:3002

### Authentication not working

1. Verify Privy App ID is correct
2. Check Privy dashboard for app configuration
3. Ensure email login is enabled in Privy app settings
4. Check browser console for Privy errors

### 401 Unauthorized errors

1. Check that Privy token is being generated (browser console)
2. Verify backend accepts Privy tokens
3. In dev mode, ensure `x-user-id` header is being sent
4. Check backend authentication middleware logs

## Next Steps

### Production Deployment

1. Set up environment variables in hosting platform
2. Configure Privy app for production domain
3. Update CORS settings in trading-engine backend
4. Set up proper JWT exchange endpoint (replace direct Privy token usage)

### Future Enhancements

- [ ] Real-time trade updates via WebSocket
- [ ] Advanced filtering and search
- [ ] Export trade data (CSV/JSON)
- [ ] Email notifications
- [ ] Mobile-responsive improvements
- [ ] Dark mode toggle
- [ ] Performance optimization
- [ ] Error boundary components
- [ ] Loading skeleton components

