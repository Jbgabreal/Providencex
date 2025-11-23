# ProvidenceX — MT5 Connector v1 PRD (Python + MetaTrader5 + FastAPI)

## 1. Overview
The MT5 Connector v1 is a lightweight microservice responsible for:
- Executing trades in MetaTrader 5 on behalf of the ProvidenceX Trading Engine.
- Providing a unified REST API for sending trade orders.
- Managing the connection to the MT5 terminal via the official MetaTrader5 Python library.
- Returning execution results (success/failure + ticket ID).

This service does **NOT** handle market data yet (candles, ticks, spreads).  
Market data will be added in v2.

---

## 2. Goals
### Primary goals
1. Accept trade orders from Trading Engine (`open` & `close`).
2. Execute the orders in MT5 using Python's MetaTrader5 package.
3. Return:
   - success: true/false
   - ticket id
   - error message on failure
4. Log all trades and errors.

### Non-goals (future versions)
- Candle data streaming
- Tick-level feed
- Account metrics (balance, margin, etc.)
- ZeroMQ bridge
- Advanced execution (multiple partial orders)

---

## 3. Architecture

```
+-------------------+      HTTP POST       +-----------------------+
| ProvidenceX       | -------------------> | MT5 Connector (FastAPI)|
| Trading Engine    |                      |  - Executes trades     |
| ExecutionService  | <------------------- |  - Returns ticket      |
+-------------------+      JSON Result     +-----------------------+
                                             |
                                             | Python API
                                             v
                                      MetaTrader5 Terminal
```

### Key Dependencies
- Python 3.10+
- FastAPI
- Uvicorn
- MetaTrader5 official package
- Pydantic

---

## 4. Endpoints

### 4.1 `POST /api/v1/trades/open`
Opens a new market order.

**Request:**
```json
{
  "symbol": "XAUUSD",
  "direction": "buy",
  "lot_size": 0.10,
  "entry_price": 0, 
  "stop_loss": 1985.00,
  "take_profit": 2005.00,
  "strategy": "low"
}
```

**Response (Success):**
```json
{
  "success": true,
  "ticket": 1234567
}
```

**Response (Failure):**
```json
{
  "success": false,
  "error": "OrderSend failed: TRADE_RETCODE_REQUOTE"
}
```

---

### 4.2 `POST /api/v1/trades/close`
Closes an existing position.

**Request:**
```json
{
  "ticket": 1234567
}
```

**Response:**
```json
{
  "success": true
}
```

---

## 5. Python Implementation (FastAPI + MetaTrader5)

### main.py
```python
import MetaTrader5 as mt5
from fastapi import FastAPI
from pydantic import BaseModel
import uvicorn

class OpenTrade(BaseModel):
    symbol: str
    direction: str
    lot_size: float
    entry_price: float = 0
    stop_loss: float
    take_profit: float
    strategy: str

class CloseTrade(BaseModel):
    ticket: int

app = FastAPI(title="MT5 Connector v1")

mt5.initialize()

def send_order_open(data: OpenTrade):
    order_type = mt5.ORDER_TYPE_BUY if data.direction == "buy" else mt5.ORDER_TYPE_SELL

    tick = mt5.symbol_info_tick(data.symbol)
    price = tick.ask if data.direction == "buy" else tick.bid

    request = {
        "action": mt5.TRADE_ACTION_DEAL,
        "symbol": data.symbol,
        "volume": data.lot_size,
        "type": order_type,
        "price": price,
        "sl": data.stop_loss,
        "tp": data.take_profit,
        "magic": 123456,
        "comment": f"ProvidenceX-{data.strategy}",
        "type_filling": mt5.ORDER_FILLING_FOK
    }

    result = mt5.order_send(request)

    if result.retcode != mt5.TRADE_RETCODE_DONE:
        return {"success": False, "error": f"OrderSend failed: {result.retcode} ({result._asdict()})"}

    return {"success": True, "ticket": result.order}

def send_order_close(ticket: int):
    positions = mt5.positions_get(ticket=ticket)
    if not positions:
        return {"success": False, "error": "Position not found"}

    pos = positions[0]
    action_type = mt5.ORDER_TYPE_SELL if pos.type == 0 else mt5.ORDER_TYPE_BUY
    tick = mt5.symbol_info_tick(pos.symbol)
    price = tick.bid if pos.type == 0 else tick.ask

    request = {
        "action": mt5.TRADE_ACTION_DEAL,
        "symbol": pos.symbol,
        "volume": pos.volume,
        "type": action_type,
        "position": ticket,
        "price": price,
        "magic": 123456,
        "comment": "ProvidenceX-close"
    }

    result = mt5.order_send(request)

    if result.retcode != mt5.TRADE_RETCODE_DONE:
        return {"success": False, "error": f"Close failed: {result.retcode}"}

    return {"success": True}

@app.post("/api/v1/trades/open")
def open_trade(data: OpenTrade):
    return send_order_open(data)

@app.post("/api/v1/trades/close")
def close_trade(data: CloseTrade):
    return send_order_close(data.ticket)

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=3030)
```

---

## 6. Connecting ExecutionService to MT5 Connector

Set this in Trading Engine `.env`:

```
MT5_CONNECTOR_URL=http://localhost:3030
```

The ExecutionService will automatically send trade requests to the connector.

---

## 7. Setup Instructions

### Install:
```
pip install MetaTrader5 fastapi uvicorn pydantic
```

### Run:
```
python main.py
```

### Test:
```
curl -X POST http://localhost:3030/api/v1/trades/open   -H "Content-Type: application/json"   -d '{"symbol":"XAUUSD","direction":"buy","lot_size":0.1,
       "stop_loss":1985,"take_profit":2005,"strategy":"low"}'
```

---

## 8. Future v2
- Market data feed
- ZeroMQ support
- Account stats endpoint
- Modify/partial close orders
- Error retry logic

