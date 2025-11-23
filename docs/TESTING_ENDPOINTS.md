# Testing Endpoints - Trading Engine v4 & MT5 Connector

## Trading Engine Endpoints (Port 3020)

### 1. Health Check
```bash
curl -X GET http://localhost:3020/health
```

### 2. Exposure Status (v4) ⭐ NEW
Get current exposure snapshot for all symbols and global totals:
```bash
curl -X GET http://localhost:3020/api/v1/status/exposure
```

**Expected Response:**
```json
{
  "success": true,
  "symbols": [
    {
      "symbol": "XAUUSD",
      "longCount": 1,
      "shortCount": 0,
      "totalCount": 1,
      "estimatedRiskAmount": 75.0,
      "lastUpdated": "2025-11-20T21:30:00.000Z"
    }
  ],
  "global": {
    "totalOpenTrades": 1,
    "totalEstimatedRiskAmount": 75.0,
    "lastUpdated": "2025-11-20T21:30:00.000Z"
  }
}
```

### 3. Simulate Signal
Test trade decision flow:
```bash
# Simulate without executing
curl -X POST http://localhost:3020/simulate-signal \
  -H "Content-Type: application/json" \
  -d '{
    "symbol": "XAUUSD",
    "strategy": "low"
  }'

# Simulate and execute (if all checks pass)
curl -X POST http://localhost:3020/simulate-signal \
  -H "Content-Type: application/json" \
  -d '{
    "symbol": "XAUUSD",
    "strategy": "low",
    "execute": true
  }'
```

---

## MT5 Connector Endpoints (Port 3030)

### 1. Health Check
```bash
curl -X GET http://localhost:3030/health
```

### 2. Open Positions (v4) ⭐ NEW
Get all currently open positions from MT5:
```bash
curl -X GET http://localhost:3030/api/v1/open-positions
```

**Expected Response:**
```json
{
  "success": true,
  "positions": [
    {
      "symbol": "XAUUSD",
      "ticket": 12345678,
      "direction": "buy",
      "volume": 0.1,
      "open_price": 2650.5,
      "sl": 2645.0,
      "tp": 2665.0,
      "open_time": "2025-11-20T20:55:00Z"
    }
  ]
}
```

**Empty Response (no open trades):**
```json
{
  "success": true,
  "positions": []
}
```

### 3. Get Price for Symbol
```bash
curl -X GET http://localhost:3030/api/v1/price/XAUUSD
```

### 4. List Available Symbols
```bash
curl -X GET http://localhost:3030/api/v1/symbols
```

### 5. Open Trade
```bash
curl -X POST http://localhost:3030/api/v1/trades/open \
  -H "Content-Type: application/json" \
  -d '{
    "symbol": "XAUUSD",
    "direction": "buy",
    "order_kind": "market",
    "lot_size": 0.10,
    "stop_loss": 2645.0,
    "take_profit": 2665.0,
    "strategy": "low"
  }'
```

### 6. Close Trade
```bash
curl -X POST http://localhost:3030/api/v1/trades/close \
  -H "Content-Type: application/json" \
  -d '{
    "ticket": 12345678,
    "reason": "Manual close"
  }'
```

---

## Testing v4 Exposure Features

### Test Scenario 1: Check Current Exposure
```bash
# 1. Check current open positions
curl -X GET http://localhost:3030/api/v1/open-positions

# 2. Check Trading Engine exposure status
curl -X GET http://localhost:3020/api/v1/status/exposure
```

### Test Scenario 2: Verify Exposure Limits Block Trades

1. **Set a tight limit** in `executionFilterConfig.ts`:
   ```typescript
   XAUUSD: {
     maxConcurrentTradesPerSymbol: 1,
     // ... other config
   }
   ```

2. **Open one trade** manually in MT5 terminal

3. **Try to simulate a signal**:
   ```bash
   curl -X POST http://localhost:3020/simulate-signal \
     -H "Content-Type: application/json" \
     -d '{
       "symbol": "XAUUSD",
       "strategy": "low",
       "execute": true
     }'
   ```

4. **Expected**: Trade should be SKIPPED with reason like:
   ```
   "execution_filter_reasons": [
     "Max concurrent trades per symbol reached for XAUUSD: 1 >= 1"
   ]
   ```

### Test Scenario 3: Monitor Exposure in Real-Time

```bash
# Watch exposure change as trades open/close
watch -n 2 'curl -s http://localhost:3020/api/v1/status/exposure | jq'
```

Or on Windows (PowerShell):
```powershell
while ($true) {
  curl http://localhost:3020/api/v1/status/exposure | ConvertFrom-Json | ConvertTo-Json -Depth 10
  Start-Sleep -Seconds 2
}
```

---

## Postman Collection Import

You can create a Postman collection with these endpoints:

**Trading Engine Collection:**
- Base URL: `http://localhost:3020`
- Endpoints:
  - `GET /health`
  - `GET /api/v1/status/exposure`
  - `POST /simulate-signal`

**MT5 Connector Collection:**
- Base URL: `http://localhost:3030`
- Endpoints:
  - `GET /health`
  - `GET /api/v1/open-positions`
  - `GET /api/v1/price/{symbol}`
  - `GET /api/v1/symbols`
  - `POST /api/v1/trades/open`
  - `POST /api/v1/trades/close`

---

## Quick Test Commands (All-in-One)

```bash
# 1. Check services are running
curl http://localhost:3020/health
curl http://localhost:3030/health

# 2. Check current exposure
curl http://localhost:3020/api/v1/status/exposure

# 3. Check MT5 open positions
curl http://localhost:3030/api/v1/open-positions

# 4. Get current price
curl http://localhost:3030/api/v1/price/XAUUSD
```

---

## Troubleshooting

### Error: Connection refused
- Make sure Trading Engine is running: `pnpm --filter @providencex/trading-engine dev`
- Make sure MT5 Connector is running: `pnpm --filter @providencex/mt5-connector dev`

### Error: Empty positions array
- This is normal if you have no open trades in MT5
- Open a trade manually in MT5 terminal, then check again

### Error: Exposure shows 0 trades
- Wait ~10 seconds (polling interval) after opening a trade
- Check MT5 Connector logs for errors
- Verify MT5 is connected: `curl http://localhost:3030/health`


