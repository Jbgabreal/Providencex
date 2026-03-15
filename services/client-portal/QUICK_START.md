# Quick Start Guide

## 1. Install Dependencies

```bash
cd services/client-portal
pnpm install
```

Or from root:
```bash
pnpm --filter @providencex/client-portal install
```

## 2. Add Environment Variables to Root `.env`

Add these to your root `.env` file:

```env
NEXT_PUBLIC_PRIVY_APP_ID=your_privy_app_id_here
NEXT_PUBLIC_BACKEND_BASE_URL=http://localhost:3020
NEXT_PUBLIC_DEV_MODE=true
```

## 3. Start the Client Portal

### From Root:
```bash
pnpm --filter @providencex/client-portal dev
```

### Or from services/client-portal directory:
```bash
cd services/client-portal
pnpm dev
```

## 4. Access the Portal

Open: **http://localhost:3002**

## Port Configuration

- **Client Portal**: Port 3002 (avoids conflict with API Gateway on 3000)
- **Admin Dashboard**: Port 3001
- **API Gateway**: Port 3000
- **Trading Engine**: Port 3020

## Troubleshooting

### "Missing required environment variable"
- Make sure variables are in the **root** `.env` file
- Variable names are case-sensitive
- No extra spaces around `=`

### "next is not recognized"
- Run `pnpm install` first

### "Failed to fetch" errors
- Check Trading Engine is running on port 3020
- Verify `NEXT_PUBLIC_BACKEND_BASE_URL` in root `.env`

