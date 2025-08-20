#!/bin/bash
set -e

# Create directories if they don't exist (should already exist from Dockerfile)
mkdir -p /data /app/logs

# Set secure permissions
chmod 700 /data
chmod 755 /app/logs

echo "Starting web frontend in background..."
cd /app/frontend
node server.js &
FRONTEND_PID=$!
echo "Frontend started with PID: $FRONTEND_PID"

# Wait a moment for frontend to start
sleep 5

echo "Starting Dogecoin daemon in foreground..."
exec dogecoind -datadir=/data -disablewallet
