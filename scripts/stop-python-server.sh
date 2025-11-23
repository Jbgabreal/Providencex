#!/bin/bash
# Stop Python server on port 3030 (MT5 Connector)

echo "Finding process on port 3030..."
PID=$(netstat -ano | grep :3030 | grep LISTENING | awk '{print $5}' | head -1)

if [ ! -z "$PID" ]; then
    echo "Stopping process PID: $PID"
    taskkill //PID $PID //F
    echo "Successfully stopped!"
else
    echo "No process found on port 3030"
fi

