# Starting Client Portal and Admin Dashboard from Root

Yes! You can start both dashboards from the root directory using pnpm filter commands.

## Start Individual Services

### Client Portal (Port 3002)
```bash
pnpm --filter @providencex/client-portal dev
```

### Admin Dashboard (Port 3001)
```bash
pnpm --filter @providencex/admin-dashboard dev
```

## Start Both Dashboards Together

```bash
pnpm --filter '@providencex/client-portal' --filter '@providencex/admin-dashboard' --parallel dev
```

## Start All Services (Including Dashboards)

The root `package.json` already has a script to start all services:

```bash
pnpm dev
```

This will start:
- ✅ All backend services (trading-engine, mt5-connector, news-guardrail, etc.)
- ✅ API Gateway (port 3000)
- ✅ Admin Dashboard (port 3001)
- ✅ Client Portal (port 3002)

## Service Ports

| Service | Port | URL |
|---------|------|-----|
| API Gateway | 3000 | http://localhost:3000 |
| Admin Dashboard | 3001 | http://localhost:3001 |
| Client Portal | 3002 | http://localhost:3002 |
| Trading Engine | 3020 | http://localhost:3020 |
| MT5 Connector | 3030 | http://localhost:3030 |

## Example: Start Client Portal Only

From the root directory:
```bash
pnpm --filter @providencex/client-portal dev
```

Then open: http://localhost:3002

