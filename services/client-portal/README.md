# ProvidenceX Client Portal

Production-ready Next.js + TypeScript SaaS client portal for ProvidenceX trading platform.

## Features

- **Authentication**: Privy integration with email login
- **MT5 Account Management**: Connect, pause, resume, disconnect MT5 accounts
- **Strategy Selection**: Browse and assign trading strategies with performance metrics
- **Analytics Dashboard**: Real-time PnL, equity curves, trade history
- **Protected Routes**: Secure access with auth guards
- **Modern UI**: Clean SaaS-style interface with TailwindCSS

## Setup

### 1. Environment Variables

Add these variables to your **root `.env` file** (at the project root):

```env
# Client Portal Configuration
NEXT_PUBLIC_PRIVY_APP_ID=your_privy_app_id_here
NEXT_PUBLIC_BACKEND_BASE_URL=http://localhost:3020
NEXT_PUBLIC_DEV_MODE=true
```

**Note**: The client portal automatically loads from the root `.env` file. See `ENV_VARIABLES.md` for details.

### 2. Install Dependencies

```bash
cd services/client-portal
pnpm install
```

### 3. Run Development Server

```bash
pnpm dev
```

The portal will be available at: http://localhost:3002

## Project Structure

```
services/client-portal/
├── src/
│   ├── app/                    # Next.js App Router
│   │   ├── (protected)/       # Protected routes with Shell layout
│   │   │   ├── dashboard/
│   │   │   ├── accounts/
│   │   │   ├── strategies/
│   │   │   ├── activity/
│   │   │   └── settings/
│   │   ├── login/             # Public login page
│   │   └── layout.tsx         # Root layout with providers
│   ├── components/            # React components
│   │   └── Layout/            # Shell layout with sidebar
│   ├── config/                # Configuration
│   ├── context/               # React contexts (Auth)
│   ├── hooks/                 # React Query hooks
│   ├── lib/                   # Utilities (API client)
│   ├── providers/             # Provider components
│   └── types/                 # TypeScript types
├── package.json
├── tailwind.config.ts
└── tsconfig.json
```

## API Integration

The portal integrates with the trading-engine backend:

- `/api/user/mt5-accounts` - MT5 account management
- `/api/user/strategies` - Strategy catalog with performance
- `/api/user/strategy-assignments` - Strategy assignment management
- `/api/user/analytics/*` - Trading analytics and history

## Authentication Flow

1. User logs in via Privy (email)
2. Privy access token is stored and attached to all API requests
3. Protected routes check authentication status
4. 401 responses automatically redirect to login

## Development

### Build

```bash
pnpm build
```

### Start Production Server

```bash
pnpm start
```

## Tech Stack

- **Next.js 14** (App Router)
- **TypeScript**
- **TailwindCSS**
- **React Query** (TanStack Query)
- **Privy** (Authentication)
- **Axios** (HTTP client)
- **Recharts** (Charts)

