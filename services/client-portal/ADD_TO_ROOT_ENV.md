# Add These Variables to Your Root `.env` File

Copy and paste these lines into your **root `.env` file** (located at the project root):

```env
# ============================================
# Client Portal Configuration
# ============================================
NEXT_PUBLIC_PRIVY_APP_ID=your_privy_app_id_here
NEXT_PUBLIC_BACKEND_BASE_URL=http://localhost:3020
NEXT_PUBLIC_DEV_MODE=true
```

## Quick Setup

1. Open your root `.env` file (at the project root)
2. Add the 3 variables above
3. Replace `your_privy_app_id_here` with your actual Privy App ID from https://dashboard.privy.io/
4. Save the file
5. Restart the client portal if it's running

## Notes

- The client portal automatically loads from the root `.env` file (no separate `.env.local` needed)
- If `NEXT_PUBLIC_BACKEND_BASE_URL` is not set, it will use `TRADING_ENGINE_URL` as a fallback
- All variables prefixed with `NEXT_PUBLIC_` are exposed to the browser

That's it! 🚀

