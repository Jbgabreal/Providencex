# Client Portal - Root .env Setup

## Add These Variables to Your Root `.env` File

Add the following variables to your **root `.env` file** (located at the project root, not in `services/client-portal/`):

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

## How It Works

The client portal's `next.config.js` automatically:
1. Loads variables from the root `.env` file using `dotenv`
2. Makes them available to Next.js via the `env` config section
3. Exposes them as `process.env.NEXT_PUBLIC_*` in the browser

## Alternative: Reuse Existing Variables

If you already have `TRADING_ENGINE_URL` in your root `.env`, you can reference it:

```env
# Existing variable
TRADING_ENGINE_URL=http://localhost:3020

# Client Portal will use this automatically if NEXT_PUBLIC_BACKEND_BASE_URL is not set
# Or you can explicitly set:
NEXT_PUBLIC_BACKEND_BASE_URL=${TRADING_ENGINE_URL}
```

## Example Root .env File

Your root `.env` file should look something like this:

```env
# ... your existing variables ...

# Database
DATABASE_URL=postgres://user:password@localhost:5432/providencex

# Trading Engine
TRADING_ENGINE_PORT=3020
TRADING_ENGINE_URL=http://localhost:3020

# MT5 Connector
MT5_CONNECTOR_URL=http://localhost:3030

# ... other service variables ...

# ============================================
# Client Portal
# ============================================
NEXT_PUBLIC_PRIVY_APP_ID=clxxxxxxxxxxxxx
NEXT_PUBLIC_BACKEND_BASE_URL=http://localhost:3020
NEXT_PUBLIC_DEV_MODE=true
```

## Notes

- Variables prefixed with `NEXT_PUBLIC_` are exposed to the browser
- Other variables (without `NEXT_PUBLIC_`) are server-only
- The client portal will automatically load from root `.env` when Next.js starts
- No need for a separate `.env.local` file in `services/client-portal/`

## Verifying Setup

After adding the variables:

1. Restart the Next.js dev server if it's running
2. Check that variables are loaded (they'll be in `process.env.NEXT_PUBLIC_*`)
3. If you see "Missing required environment variable" errors, double-check:
   - Variables are in the **root** `.env` file
   - Variable names are exactly as shown (case-sensitive)
   - No extra spaces around the `=` sign

