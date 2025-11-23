# MT5 Connector v1

The MT5 Connector is a Python microservice that provides a REST API for executing trades in MetaTrader 5 on behalf of the ProvidenceX Trading Engine.

## Features

- **FastAPI REST API** for trade execution
- **MetaTrader 5 Integration** using the official Python library
- **Automatic Connection Management** - initializes MT5 on demand
- **Comprehensive Logging** - all operations and errors are logged
- **Error Handling** - detailed error messages with MT5 error codes

## Endpoints

### `GET /health`

Health check endpoint that returns service status and MT5 connection status.

**Response:**
```json
{
  "status": "ok",
  "mt5_connection": true
}
```

### `POST /api/v1/trades/open`

Opens a new market order in MT5.

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
  "ticket": 1234567,
  "mt5_ticket": 1234567
}
```

**Response (Error):**
```json
{
  "success": false,
  "error": "OrderSend failed: TRADE_RETCODE_REQUOTE (code: 10004)"
}
```

### `POST /api/v1/trades/close`

Closes an existing position by ticket ID.

**Request:**
```json
{
  "ticket": 1234567,
  "reason": "Take profit reached"
}
```

**Response:**
```json
{
  "success": true
}
```

## Setup

### Prerequisites

- Python 3.10 or higher (Python 3.13+ recommended for best compatibility)
- MetaTrader 5 installed on the system
- MT5 account credentials (login, password, server)
- Python package manager (pip)

### Installation

**IMPORTANT:** Python dependencies must be installed before the service can start.

1. **Install Python dependencies:**

```bash
cd services/mt5-connector
pip install -r requirements.txt
```

Or using a virtual environment (recommended):

```bash
cd services/mt5-connector
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install -r requirements.txt
```

**Note:** If you're using `pnpm run dev` from the root, make sure Python dependencies are installed first, or the MT5 Connector will fail to start.

**Quick Install:**
```bash
cd services/mt5-connector
pnpm install-deps  # Or: pip install -r requirements.txt
```

2. **Configure environment variables:**

Add the following to your **root `.env` file** (not in the service directory):

```bash
# MT5 Connection Credentials
MT5_LOGIN=12345678
MT5_PASSWORD=yourpass
MT5_SERVER=Deriv-Demo

# Optional: Path to MT5 terminal
MT5_PATH="C:\\Program Files\\MetaTrader 5\\terminal64.exe"

# FastAPI Port
FASTAPI_PORT=3030
```

**Note:** The service loads `.env` from the monorepo root, not from `services/mt5-connector/`.

### Running the Service

**Development mode** (with auto-reload):

```bash
cd services/mt5-connector
python -m uvicorn src.main:app --host 0.0.0.0 --port 3030 --reload
```

**Production mode:**

```bash
cd services/mt5-connector
python -m uvicorn src.main:app --host 0.0.0.0 --port 3030
```

Or run directly:

```bash
cd services/mt5-connector
python src/main.py
```

## Testing

### Health Check

```bash
curl http://localhost:3030/health
```

### Open a Trade

```bash
curl -X POST http://localhost:3030/api/v1/trades/open \
  -H "Content-Type: application/json" \
  -d '{
    "symbol": "XAUUSD",
    "direction": "buy",
    "lot_size": 0.10,
    "stop_loss": 1985.00,
    "take_profit": 2005.00,
    "strategy": "low"
  }'
```

### Close a Trade

```bash
curl -X POST http://localhost:3030/api/v1/trades/close \
  -H "Content-Type: application/json" \
  -d '{
    "ticket": 1234567,
    "reason": "Manual close"
  }'
```

## Integration with Trading Engine

The Trading Engine's `ExecutionService` automatically calls this connector when trades are executed.

The Trading Engine sends requests in this format:

```typescript
{
  symbol: string,
  direction: "BUY" | "SELL",  // Converted to "buy"/"sell" in connector
  entry_type: "MARKET",
  entry_price: number,
  lot_size: number,
  stop_loss_price: number,
  take_profit_price: number,
  strategy_id: string
}
```

The connector maps this to:

```json
{
  "symbol": "...",
  "direction": "buy" | "sell",
  "lot_size": ...,
  "entry_price": 0,  // Market orders use current price
  "stop_loss": ...,
  "take_profit": ...,
  "strategy": "..."
}
```

## Architecture

### File Structure

```
services/mt5-connector/
├── src/
│   ├── main.py          # FastAPI app with endpoints
│   ├── mt5_client.py    # MT5 connection and trade execution
│   ├── models.py        # Pydantic request/response models
│   ├── config.py        # Configuration loader
│   └── utils.py         # Logging utilities
├── requirements.txt     # Python dependencies
├── .env.example        # Environment variable template
└── README.md           # This file
```

### Key Components

- **`MT5Client`**: Encapsulates all MT5 operations (connection, validation, trade execution)
- **FastAPI Endpoints**: REST API layer that validates requests and calls MT5Client
- **Pydantic Models**: Request/response validation and serialization
- **Configuration**: Loads credentials from environment variables

## Error Handling

The service provides detailed error messages:

- **Connection Errors**: Returned with HTTP 500
- **Validation Errors**: Returned with HTTP 400 (invalid symbol, lot size, etc.)
- **Position Not Found**: Returned with HTTP 404
- **MT5 Errors**: Include MT5 error codes and descriptions

All errors are logged with full context for debugging.

## Logging

Structured logging is provided for:

- MT5 connection status
- Trade execution attempts
- Success/failure with ticket IDs
- MT5 error codes and messages
- All operations include relevant context (symbol, direction, lot size, etc.)

Logs are output to stdout in the format:
```
YYYY-MM-DD HH:MM:SS - MT5Connector - LEVEL - message
```

## Troubleshooting

### MT5 Connection Issues

1. **Verify MT5 is installed**: The service needs MetaTrader 5 to be installed on the system
2. **Check credentials**: Ensure `MT5_LOGIN`, `MT5_PASSWORD`, and `MT5_SERVER` are correct
3. **Set MT5_PATH**: If MT5 is in a non-standard location, set `MT5_PATH` in `.env`
4. **Check MT5 terminal**: Ensure the MT5 terminal can be launched manually

### Common MT5 Error Codes

- `10004` (TRADE_RETCODE_REQUOTE): Price changed, retry with new price
- `10006` (TRADE_RETCODE_REJECT): Order rejected by broker
- `10007` (TRADE_RETCODE_CANCEL): Order cancelled
- `10014` (TRADE_RETCODE_INVALID_VOLUME): Invalid lot size

See [MT5 documentation](https://www.mql5.com/en/docs/constants/tradingconstants/returncodes) for full error code list.

### Service Won't Start

1. Check Python version: `python --version` (must be 3.10+)
2. Verify dependencies: `pip list | grep MetaTrader5`
3. Check port availability: `netstat -an | grep 3030`
4. Review logs for initialization errors

## Future Enhancements (v2)

- Market data streaming (candles, ticks)
- Account metrics endpoint (balance, margin, equity)
- ZeroMQ support for high-frequency data
- Advanced execution (partial fills, modify orders)
- Automatic retry logic for transient errors

