# Client Portal Environment Variables

## Required Variables for Root `.env` File

Add these variables to your root `.env` file (at the project root, not in `services/client-portal/`):

```env
# ============================================
# Client Portal Configuration
# ============================================

# Privy Authentication App ID
# Get this from https://dashboard.privy.io/
NEXT_PUBLIC_PRIVY_APP_ID=your_privy_app_id_here

# Backend API URL (Trading Engine)
# Can use existing TRADING_ENGINE_URL or set explicitly
NEXT_PUBLIC_BACKEND_BASE_URL=http://localhost:3020

# Dev Mode (enables x-user-id header for AUTH_DEV_MODE compatibility)
# Set to 'true' for local development
NEXT_PUBLIC_DEV_MODE=true
```

## Alternative: Use Existing Trading Engine URL

If you already have `TRADING_ENGINE_URL` in your root `.env`, the client portal will use it as a fallback:

```env
# Existing variable (can be reused)
TRADING_ENGINE_URL=http://localhost:3020

# Client Portal will use TRADING_ENGINE_URL if NEXT_PUBLIC_BACKEND_BASE_URL is not set
```

## Complete Example

Your root `.env` file should include:

```env
# ... existing variables ...

# Client Portal
NEXT_PUBLIC_PRIVY_APP_ID=clxxxxxxxxxxxxx
NEXT_PUBLIC_BACKEND_BASE_URL=http://localhost:3020
NEXT_PUBLIC_DEV_MODE=true

# Or reuse existing:
# NEXT_PUBLIC_BACKEND_BASE_URL=${TRADING_ENGINE_URL}
```

## How It Works

The client portal's `next.config.js` automatically:
1. Loads variables from the root `.env` file (monorepo root)
2. Makes them available to Next.js via the `env` config
3. Exposes them as `process.env.NEXT_PUBLIC_*` in the browser

**Note**: Next.js only exposes variables prefixed with `NEXT_PUBLIC_` to the browser. Other variables are server-only.

