# Fix for Missing Environment Variable Error

## The Error

You're seeing:
```
Missing required environment variable: NEXT_PUBLIC_PRIVY_APP_ID
```

## Quick Fix

Add this to your **root `.env` file** (not in `services/client-portal/`):

```env
# ============================================
# Client Portal Configuration
# ============================================

# Privy Authentication App ID
# Get this from https://dashboard.privy.io/
# For now, you can use a placeholder if you don't have one yet
NEXT_PUBLIC_PRIVY_APP_ID=placeholder-for-now

# Backend API URL
NEXT_PUBLIC_BACKEND_BASE_URL=http://localhost:3020

# Dev Mode
NEXT_PUBLIC_DEV_MODE=true
```

## Steps

1. **Open your root `.env` file** (at `C:\Users\gabri\project\ProvidenceX\.env`)

2. **Add the three variables above**

3. **Restart the dev server:**
   ```bash
   # Stop current server (Ctrl+C), then:
   pnpm --filter @providencex/client-portal dev
   ```

## Getting a Real Privy App ID (Optional for now)

1. Go to https://dashboard.privy.io/
2. Sign up or log in
3. Create a new app
4. Copy the App ID
5. Replace `placeholder-for-now` in your `.env` file

**Note**: For local development/testing, you can use a placeholder value temporarily. The app won't be able to authenticate users, but it will at least load.

## After Adding Variables

The app should now load at http://localhost:3002

