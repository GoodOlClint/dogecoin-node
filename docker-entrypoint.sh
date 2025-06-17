#!/bin/bash
set -e

# Create directories if they don't exist
mkdir -p /data /app/logs

echo "Starting web frontend in background..."
cd /app/frontend
which node || echo "Node.js not found in PATH"
ls -la /app/frontend || echo "Frontend directory not found"
npm start &
FRONTEND_PID=$!
echo "Frontend started with PID: $FRONTEND_PID"

# Wait a moment for frontend to start
sleep 5

echo "Starting Dogecoin daemon in foreground..."
exec dogecoind -datadir=/data -disablewallet
