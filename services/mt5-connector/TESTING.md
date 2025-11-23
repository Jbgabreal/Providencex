# MT5 Connector Testing Guide

This guide shows how to test the MT5 Connector with the new SL/TP handling for market orders.

## Prerequisites

1. **MT5 Terminal must be running** and logged in
2. **Algo Trading must be enabled** in MT5 (Toolbar button should be green)
3. **MT5 Connector service must be running**:
   ```bash
   cd services/mt5-connector
   pnpm dev
   # OR
   python -m uvicorn src.main:app --host 0.0.0.0 --port 3030 --reload
   ```

## Test Scenarios

### 1. Market Order WITHOUT SL/TP (Naked Order)

**Expected:** Order executes with `sl=0, tp=0`

**Request:**
```bash
curl -X POST http://localhost:3030/api/v1/trades/open \
  -H "Content-Type: application/json" \
  -d '{
    "symbol": "EURUSD",
    "direction": "sell",
    "order_kind": "market",
    "lot_size": 0.10,
    "strategy": "low"
  }'
```

**Expected Log Output:**
```
[ORDER_KIND=market] EURUSD: No SL/TP requested, sending naked market order
```

---

### 2. Market Order WITH Valid SL/TP

**Expected:** SL/TP adjusted to respect broker min stop distance

**Request:**
```bash
curl -X POST http://localhost:3030/api/v1/trades/open \
  -H "Content-Type: application/json" \
  -d '{
    "symbol": "EURUSD",
    "direction": "sell",
    "order_kind": "market",
    "lot_size": 0.10,
    "stop_loss": 1.1550,
    "take_profit": 1.1500,
    "strategy": "low"
  }'
```

**Expected Log Output:**
```
[ORDER_KIND=market] EURUSD: direction=sell, entry_price=1.1524, min_stop_dist=0.0001, sl=1.1550, tp=1.1500
```

---

### 3. Market Order WITH Invalid SL/TP (Wrong Side)

**Expected:** SL/TP ignored with warning, order executes without stops

**Example: BUY order with SL above entry (wrong side)**
```bash
curl -X POST http://localhost:3030/api/v1/trades/open \
  -H "Content-Type: application/json" \
  -d '{
    "symbol": "EURUSD",
    "direction": "buy",
    "order_kind": "market",
    "lot_size": 0.10,
    "stop_loss": 1.1600,
    "take_profit": 1.1400,
    "strategy": "low"
  }'
```

**Expected Log Output:**
```
Stop loss ignored: requested=1.1600 is >= entry_price=1.15263 for BUY order
Take profit ignored: requested=1.1400 is <= entry_price=1.15263 for BUY order
[ORDER_KIND=market] EURUSD: direction=buy, entry_price=1.15263, min_stop_dist=0.0001, sl=None, tp=None
```

---

### 4. Market Order WITH SL/TP Too Close (Auto-Adjusted)

**Expected:** SL/TP adjusted to respect min_stop_distance

**Request:**
```bash
curl -X POST http://localhost:3030/api/v1/trades/open \
  -H "Content-Type: application/json" \
  -d '{
    "symbol": "XAUUSD",
    "direction": "sell",
    "order_kind": "market",
    "lot_size": 0.10,
    "stop_loss": 4080.50,
    "take_profit": 4079.50,
    "strategy": "low"
  }'
```

**Expected Log Output:**
```
Stop loss adjusted: requested=4080.50, adjusted=4080.45 (min_stop_distance=0.05)
Take profit adjusted: requested=4079.50, adjusted=4079.55 (min_stop_distance=0.05)
[ORDER_KIND=market] GOLD: direction=sell, entry_price=4080.00, min_stop_dist=0.05, sl=4080.45, tp=4079.55
```

---

### 5. Market Order WITH Invalid Stops Error (10016) - Retry Test

**Expected:** Automatic retry without SL/TP if initial request fails with 10016

**Request (with very close SL/TP that might trigger 10016):**
```bash
curl -X POST http://localhost:3030/api/v1/trades/open \
  -H "Content-Type: application/json" \
  -d '{
    "symbol": "EURUSD",
    "direction": "sell",
    "order_kind": "market",
    "lot_size": 0.10,
    "stop_loss": 1.15241,
    "take_profit": 1.15239,
    "strategy": "low"
  }'
```

**Expected Log Output (if 10016 occurs):**
```
[RETRY_NO_STOPS] Invalid stops (10016) for EURUSD: retrying without SL/TP
[RETRY_SUCCESS] EURUSD: Order executed successfully after retry without SL/TP
```

---

### 6. Pending Order WITHOUT SL/TP (Expected Behavior)

**Expected:** Order executes without SL/TP (unchanged)

**Request:**
```bash
curl -X POST http://localhost:3030/api/v1/trades/open \
  -H "Content-Type: application/json" \
  -d '{
    "symbol": "EURUSD",
    "direction": "buy",
    "order_kind": "limit",
    "entry_price": 1.1500,
    "lot_size": 0.10,
    "strategy": "low"
  }'
```

**Expected Log Output:**
```
[ORDER_KIND=limit] EURUSD: Pending orders run without SL/TP for now
```

---

## Python Testing Script

You can also use this Python script to test:

```python
import requests
import json

BASE_URL = "http://localhost:3030"

def test_market_order_with_sl_tp():
    """Test market order with SL/TP"""
    url = f"{BASE_URL}/api/v1/trades/open"
    payload = {
        "symbol": "EURUSD",
        "direction": "sell",
        "order_kind": "market",
        "lot_size": 0.10,
        "stop_loss": 1.1550,
        "take_profit": 1.1500,
        "strategy": "low"
    }
    
    response = requests.post(url, json=payload)
    print(f"Status: {response.status_code}")
    print(f"Response: {json.dumps(response.json(), indent=2)}")
    return response.json()

def test_market_order_without_sl_tp():
    """Test naked market order"""
    url = f"{BASE_URL}/api/v1/trades/open"
    payload = {
        "symbol": "EURUSD",
        "direction": "sell",
        "order_kind": "market",
        "lot_size": 0.10,
        "strategy": "low"
    }
    
    response = requests.post(url, json=payload)
    print(f"Status: {response.status_code}")
    print(f"Response: {json.dumps(response.json(), indent=2)}")
    return response.json()

def test_invalid_sl_tp():
    """Test market order with SL/TP on wrong side"""
    url = f"{BASE_URL}/api/v1/trades/open"
    payload = {
        "symbol": "EURUSD",
        "direction": "buy",
        "order_kind": "market",
        "lot_size": 0.10,
        "stop_loss": 1.1600,  # Wrong side (should be < entry for BUY)
        "take_profit": 1.1400,  # Wrong side (should be > entry for BUY)
        "strategy": "low"
    }
    
    response = requests.post(url, json=payload)
    print(f"Status: {response.status_code}")
    print(f"Response: {json.dumps(response.json(), indent=2)}")
    return response.json()

if __name__ == "__main__":
    print("=== Test 1: Market Order WITH SL/TP ===")
    test_market_order_with_sl_tp()
    
    print("\n=== Test 2: Market Order WITHOUT SL/TP ===")
    test_market_order_without_sl_tp()
    
    print("\n=== Test 3: Market Order WITH Invalid SL/TP ===")
    test_invalid_sl_tp()
```

---

## Checking Logs

While testing, watch the MT5 Connector logs for:

1. **SL/TP Adjustment Messages:**
   - `Stop loss adjusted: requested=X, adjusted=Y`
   - `Take profit adjusted: requested=X, adjusted=Y`

2. **Directional Sanity Warnings:**
   - `Stop loss ignored: requested=X is >= entry_price=Y for BUY order`
   - `Take profit ignored: requested=X is <= entry_price=Y for SELL order`

3. **Naked Order Messages:**
   - `[ORDER_KIND=market] ... No SL/TP requested, sending naked market order`

4. **Retry Messages (if 10016 occurs):**
   - `[RETRY_NO_STOPS] Invalid stops (10016) for ...: retrying without SL/TP`
   - `[RETRY_SUCCESS] ... Order executed successfully after retry without SL/TP`

5. **Success Messages:**
   - Trade execution success with ticket number

---

## Quick Test Commands

### Test 1: Naked Market Order
```bash
curl -X POST http://localhost:3030/api/v1/trades/open -H "Content-Type: application/json" -d '{"symbol":"EURUSD","direction":"sell","order_kind":"market","lot_size":0.10,"strategy":"low"}'
```

### Test 2: Market Order with SL/TP
```bash
curl -X POST http://localhost:3030/api/v1/trades/open -H "Content-Type: application/json" -d '{"symbol":"EURUSD","direction":"sell","order_kind":"market","lot_size":0.10,"stop_loss":1.1550,"take_profit":1.1500,"strategy":"low"}'
```

### Test 3: Market Order with Wrong-Side SL/TP
```bash
curl -X POST http://localhost:3030/api/v1/trades/open -H "Content-Type: application/json" -d '{"symbol":"EURUSD","direction":"buy","order_kind":"market","lot_size":0.10,"stop_loss":1.1600,"take_profit":1.1400,"strategy":"low"}'
```

---

## What to Verify

✅ **Market orders WITHOUT SL/TP:**
- Execute successfully
- Log shows "No SL/TP requested, sending naked market order"
- Order appears in MT5 with sl=0, tp=0

✅ **Market orders WITH valid SL/TP:**
- SL/TP adjusted if too close to entry
- Directional sanity enforced
- Order executes with adjusted SL/TP

✅ **Market orders WITH invalid SL/TP:**
- Wrong-side SL/TP are ignored (warnings in logs)
- Order executes without ignored stops

✅ **Invalid stops error (10016):**
- Automatic retry without SL/TP
- Success message if retry succeeds

✅ **Pending orders:**
- Execute without SL/TP (unchanged behavior)

---

## Troubleshooting

**If orders fail:**
1. Check MT5 Terminal is running and logged in
2. Verify "Algo Trading" is enabled (green button in toolbar)
3. Check symbol is available in Market Watch
4. Review logs for specific error messages

**Common Issues:**
- `10027`: AutoTrading disabled → Enable in MT5
- `10030`: Unsupported filling mode → Should retry automatically
- `10014`: Invalid volume → Volume normalization should handle this
- `10016`: Invalid stops → Should retry without stops automatically



