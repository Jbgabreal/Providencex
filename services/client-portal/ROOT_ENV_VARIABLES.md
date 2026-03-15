# Client Portal Environment Variables

## Add to Root `.env` File

Add these variables to your **root `.env` file** (located at the project root):

```env
# ============================================
# Client Portal Configuration
# ============================================

# Privy Authentication App ID
# Get this from: https://dashboard.privy.io/
NEXT_PUBLIC_PRIVY_APP_ID=your_privy_app_id_here

# Backend API URL (Trading Engine)
# Can reuse existing TRADING_ENGINE_URL if set
NEXT_PUBLIC_BACKEND_BASE_URL=http://localhost:3020

# Dev Mode (enables x-user-id header for AUTH_DEV_MODE compatibility)
NEXT_PUBLIC_DEV_MODE=true
```

## How It Works

The client portal's `next.config.js` automatically:
1. Loads variables from the root `.env` file using `dotenv`
2. Makes them available to Next.js via the `env` config
3. Exposes them to the browser as `process.env.NEXT_PUBLIC_*`

## Integration with Existing Variables

The client portal will automatically use `TRADING_ENGINE_URL` if `NEXT_PUBLIC_BACKEND_BASE_URL` is not set:

```env
# Existing variable (already in root .env)
TRADING_ENGINE_URL=http://localhost:3020

# Client Portal will use TRADING_ENGINE_URL as fallback
# Or set explicitly:
NEXT_PUBLIC_BACKEND_BASE_URL=${TRADING_ENGINE_URL}
```

## Quick Copy-Paste

Just add these 3 lines to your root `.env` file:

```env
NEXT_PUBLIC_PRIVY_APP_ID=your_privy_app_id_here
NEXT_PUBLIC_BACKEND_BASE_URL=http://localhost:3020
NEXT_PUBLIC_DEV_MODE=true
```

That's it! The client portal will automatically load these when you run `pnpm dev`.

