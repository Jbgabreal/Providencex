# Environment Variable Debugging

## The Problem

Next.js detected `.env.local` (you see "- Environments: .env.local" in logs), but variables aren't in the client bundle.

## Root Cause

Next.js automatically embeds `NEXT_PUBLIC_*` variables from `.env.local` files **at BUILD TIME**. If the bundle was built before the variables existed, they won't be embedded.

## Solution

### 1. Verify `.env.local` exists and is correct

Location: `services/client-portal/.env.local`

Must contain:
```
NEXT_PUBLIC_PRIVY_APP_ID=cmiq9pha40325k00cp6eu9hpf
NEXT_PUBLIC_BACKEND_BASE_URL=http://localhost:3020
NEXT_PUBLIC_DEV_MODE=true
```

### 2. COMPLETE Clean Restart

1. **Stop the server completely** (Ctrl+C, wait for full stop)

2. **Delete the entire `.next` folder**:
   ```powershell
   cd services/client-portal
   Remove-Item -Recurse -Force .next
   ```

3. **Restart**:
   ```powershell
   cd ../..
   pnpm --filter @providencex/client-portal dev
   ```

4. **Wait for full compilation** (30-60 seconds)

5. **Hard refresh browser** (Ctrl+Shift+R or Ctrl+F5)

## Why Manual Loading Doesn't Work

- Next.js automatically loads `.env.local` files
- We don't need to manually load them in `next.config.js`
- The `env` config in `next.config.js` is for SERVER-side variables or overrides
- Client-side `NEXT_PUBLIC_*` variables are automatically embedded from `.env.local`

## Verification

After restart, check browser console:
- Should NOT see "Missing required environment variable" error
- `process.env.NEXT_PUBLIC_PRIVY_APP_ID` should be defined in client code

