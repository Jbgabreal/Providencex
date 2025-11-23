# Database Setup Guide

ProvidenceX uses PostgreSQL for all services. You can use **Supabase** (recommended) or any PostgreSQL database.

## Option 1: Supabase (Recommended)

### Step 1: Create a Supabase Project

1. Go to [supabase.com](https://supabase.com) and sign in
2. Click **"New Project"**
3. Fill in:
   - **Name**: `providencex` (or your preferred name)
   - **Database Password**: Choose a strong password (save this!)
   - **Region**: Choose closest to you
4. Click **"Create new project"** and wait for it to provision (~2 minutes)

### Step 2: Get Your Connection String

**Important**: If you see a warning "Not IPv4 compatible", you **must** use the Connection Pooler instead (see below).

#### Option A: Direct Connection (IPv6 networks only)

1. In your Supabase project dashboard, go to **Settings** → **Database**
2. Scroll down to **Connection string** section
3. Select **"URI"** tab
4. If you see "Not IPv4 compatible" warning, **skip this** and use Option B instead
5. Copy the connection string. It will look like:
   ```
   postgresql://postgres:[YOUR-PASSWORD]@db.xxxxx.supabase.co:5432/postgres
   ```
6. Replace `[YOUR-PASSWORD]` with the password you set when creating the project

#### Option B: Connection Pooler (Recommended for IPv4 networks)

**Use this if you see "Not IPv4 compatible" warning!**

1. In your Supabase project dashboard, go to **Settings** → **Database**
2. Scroll down to **Connection string** section
3. Click the **"Connection Pooling"** tab
4. Select **Mode**: `Transaction` (recommended)
5. Select **Source**: `Primary Database`
6. Copy the connection string. It will look like:
   ```
   postgresql://postgres:[YOUR-PASSWORD]@pooler.supabase.com:6543/postgres
   ```
   Note: Port is **6543** (not 5432) and hostname is **pooler.supabase.com**
7. Replace `[YOUR-PASSWORD]` with the password you set when creating the project

### Step 3: Configure Your .env File

Add the connection string to your `.env` file in the project root:

```bash
DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@db.xxxxx.supabase.co:5432/postgres
```

**Important**: The connection string uses SSL by default, which is already handled in the code.

### Step 4: Auto-Schema Creation

The news-guardrail service will **automatically create the required tables** when it starts:

```bash
pnpm --filter @providencex/news-guardrail dev
```

You'll see a log message: `"Database schema initialized"`

The following table will be created:
- `daily_news_windows` - Stores daily news avoid windows

### Step 5: Verify in Supabase

1. Go to **Table Editor** in your Supabase dashboard
2. You should see the `daily_news_windows` table
3. The schema includes:
   - `id` (serial primary key)
   - `date` (date, unique)
   - `avoid_windows` (jsonb)
   - `created_at` (timestamp)
   - `updated_at` (timestamp)

## Option 2: Local PostgreSQL

If you prefer a local database:

### Install PostgreSQL

**Windows:**
- Download from [postgresql.org](https://www.postgresql.org/download/windows/)
- Or use Chocolatey: `choco install postgresql`

**macOS:**
```bash
brew install postgresql
brew services start postgresql
```

**Linux (Ubuntu/Debian):**
```bash
sudo apt install postgresql postgresql-contrib
sudo systemctl start postgresql
```

### Create Database

```bash
# Connect to PostgreSQL
psql -U postgres

# Create database
CREATE DATABASE providencex;

# Exit
\q
```

### Configure .env

```bash
DATABASE_URL=postgresql://postgres:your_password@localhost:5432/providencex
```

## Option 3: Other PostgreSQL Hosting

You can use any PostgreSQL provider:
- **Railway**: [railway.app](https://railway.app)
- **Neon**: [neon.tech](https://neon.tech)
- **Render**: [render.com](https://render.com)
- **ElephantSQL**: [elephantsql.com](https://elephantsql.com)

Just copy their connection string to your `.env` file.

## SSL Configuration

The code automatically handles SSL:
- **Supabase/Cloud databases**: SSL enabled automatically
- **Localhost**: SSL disabled automatically

This is handled in `services/news-guardrail/src/db/client.ts`:
```typescript
ssl: config.databaseUrl.includes('localhost') ? false : { rejectUnauthorized: false }
```

## Testing Your Connection

You can test your database connection by starting the news-guardrail service:

```bash
pnpm --filter @providencex/news-guardrail dev
```

Look for:
- ✅ `Database schema initialized` - Success!
- ❌ Connection errors - Check your `DATABASE_URL`

## Manual Schema Creation (Optional)

If you want to manually create the schema (automatic on startup), you can run:

```sql
CREATE TABLE IF NOT EXISTS daily_news_windows (
  id SERIAL PRIMARY KEY,
  date DATE NOT NULL UNIQUE,
  avoid_windows JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_daily_news_windows_date ON daily_news_windows(date);
```

You can run this in:
- **Supabase**: SQL Editor in the dashboard
- **Local**: `psql $DATABASE_URL -f services/news-guardrail/src/db/schema.sql`

## Troubleshooting

### "Connection refused" or "Connection timeout"
- Check your `DATABASE_URL` is correct
- For Supabase: Ensure you replaced `[YOUR-PASSWORD]` with your actual password
- Check if your IP is allowed (Supabase firewall)

### "SSL required"
- Supabase requires SSL - the code handles this automatically
- If you see this error, check the connection string format

### "Relation does not exist"
- The schema should auto-create on startup
- Try restarting the news-guardrail service
- Or manually run the schema SQL (see above)

### Supabase Connection Pooling (Production)

For production, consider using Supabase's connection pooler:
1. Go to **Settings** → **Database** → **Connection Pooling**
2. Use the pooled connection string (port 6543 instead of 5432)
3. It looks like: `postgresql://postgres:...@pooler.supabase.com:6543/postgres`

