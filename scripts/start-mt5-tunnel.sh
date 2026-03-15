#!/bin/bash
# Start MT5 connector + ngrok tunnel in one command
#
# Usage: ./scripts/start-mt5-tunnel.sh

DOMAIN="inbond-undisputatiously-arlena.ngrok-free.dev"
MT5_DIR="$(dirname "$0")/../services/mt5-connector"

# Kill any existing processes
taskkill //F //IM ngrok.exe 2>/dev/null
taskkill //F //IM python.exe 2>/dev/null
sleep 2

echo "========================================="
echo "  ProvidenceX MT5 Connector"
echo "========================================="
echo ""

# Start MT5 connector in background
echo "[1/2] Starting MT5 connector on port 3030..."
cd "$MT5_DIR"
python src/main.py &
MT5_PID=$!
sleep 3

# Check if MT5 connector started
if ! curl -s http://localhost:3030/health > /dev/null 2>&1; then
  echo "ERROR: MT5 connector failed to start. Is MetaTrader 5 running?"
  kill $MT5_PID 2>/dev/null
  exit 1
fi
echo "  MT5 connector running (PID: $MT5_PID)"
echo ""

# Start ngrok tunnel
echo "[2/2] Starting tunnel..."
echo "  URL: https://$DOMAIN"
echo ""
echo "========================================="
echo "  LIVE - Trading engine can reach MT5"
echo "  Press Ctrl+C to stop everything"
echo "========================================="
echo ""

ngrok http 3030 --domain "$DOMAIN"

# Cleanup on exit
echo "Shutting down..."
kill $MT5_PID 2>/dev/null
