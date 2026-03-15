#!/bin/bash
# Start MT5 connector tunnel with ProvidenceX static ngrok domain
#
# Usage: ./scripts/start-mt5-tunnel.sh
#
# Prerequisites:
#   - ngrok installed and authenticated
#   - MT5 connector running on localhost:3030
#   - MetaTrader 5 terminal running

DOMAIN="inbond-undisputatiously-arlena.ngrok-free.dev"

# Kill any existing ngrok
taskkill //F //IM ngrok.exe 2>/dev/null
sleep 2

echo "Starting MT5 connector tunnel..."
echo "Domain: https://$DOMAIN"
echo ""

# Start ngrok with static domain
ngrok http 3030 --domain "$DOMAIN"
