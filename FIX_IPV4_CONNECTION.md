# Fix IPv4 Connection Issue

## Problem
You're seeing "Not IPv4 compatible" warning in Supabase. This means your network/Windows system uses IPv4, but the direct database connection only supports IPv6.

## Solution: Use Connection Pooler

1. **In Supabase Dashboard:**
   - Go to your project → **Settings** → **Database**
   - Click the **"Connection Pooling"** tab (NOT "Connection String")
   
2. **Select these options:**
   - **Mode**: `Transaction` (recommended) or `Session`
   - **Source**: `Primary Database`
   
3. **Copy the connection string** - it will look like:
   ```
   postgresql://postgres:[YOUR-PASSWORD]@pooler.supabase.com:6543/postgres
   ```
   Notice: 
   - Hostname: `pooler.supabase.com` (not `db.xxxxx.supabase.co`)
   - Port: `6543` (not `5432`)

4. **Update your `.env` file:**
   ```bash
   DATABASE_URL=postgresql://postgres:Providencex!123456@pooler.supabase.com:6543/postgres
   ```
   (Replace `Providencex!123456` with your actual password)

5. **Test the connection:**
   ```bash
   pnpm test-db
   ```

6. **Start your service:**
   ```bash
   pnpm --filter @providencex/news-guardrail dev
   ```

## Why This Works

The Connection Pooler uses IPv4-compatible hostnames (`pooler.supabase.com`) that work on all networks, while the direct connection (`db.xxxxx.supabase.co`) is IPv6-only.

