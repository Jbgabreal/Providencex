# Troubleshooting Guide

## Database Connection Issues

### Error: `getaddrinfo ENOTFOUND db.xxxxx.supabase.co`

This means your computer cannot resolve the Supabase hostname. Common causes:

#### 1. **Supabase Project is Paused** (Most Common)

Free-tier Supabase projects pause after 7 days of inactivity. You need to **restore** it:

1. Go to [supabase.com/dashboard](https://supabase.com/dashboard)
2. Find your project
3. If it shows "Paused", click **"Restore"** or **"Resume"**
4. Wait 1-2 minutes for it to come back online
5. Try connecting again

#### 2. **Verify Connection String in Supabase Dashboard**

1. Go to your Supabase project dashboard
2. Navigate to **Settings** → **Database**
3. Scroll to **Connection string** section
4. Make sure you're copying from the **"URI"** tab (not Session mode)
5. The format should be:
   ```
   postgresql://postgres:[YOUR-PASSWORD]@db.xxxxx.supabase.co:5432/postgres
   ```
6. Copy the **exact** connection string and update your `.env` file

#### 3. **Check Project Status**

- In Supabase dashboard, check if your project shows any errors
- Verify the project region is accessible from your location
- Try accessing the Supabase dashboard API URL to confirm the project exists

#### 4. **Test Connection Manually**

You can test the connection string using `psql` (if installed):

```bash
# On Windows (if you have psql installed)
psql "postgresql://postgres:YOUR_PASSWORD@db.xxxxx.supabase.co:5432/postgres"

# Or use the Supabase dashboard SQL Editor to verify the database works
```

#### 5. **Network/Firewall Issues**

- Check if your firewall is blocking outbound connections to port 5432
- Try from a different network (mobile hotspot) to rule out ISP issues
- Check if corporate VPN/firewall is blocking Supabase

### Error: `password authentication failed`

- Verify your database password in Supabase dashboard
- Reset the password: **Settings** → **Database** → **Reset database password**
- Update the password in your `.env` file

### Error: `connection timeout`

- Check if the Supabase project is running (not paused)
- Verify the connection string hostname is correct
- Try using the **Connection Pooler** URL instead (port 6543)

## Quick Fix Checklist

- [ ] Is your Supabase project **active** (not paused)?
- [ ] Did you copy the connection string from **Settings** → **Database** → **URI** tab?
- [ ] Is the password correct in the connection string?
- [ ] Is the `.env` file in the **root directory** (not in `services/`)?
- [ ] Have you restarted the service after updating `.env`?

## Alternative: Use Connection Pooler

For better reliability, use Supabase's connection pooler:

1. Go to **Settings** → **Database** → **Connection Pooling**
2. Copy the **Transaction** mode connection string
3. It uses port **6543** instead of 5432
4. Update your `.env`:
   ```
   DATABASE_URL=postgresql://postgres:[PASSWORD]@pooler.supabase.com:6543/postgres
   ```

