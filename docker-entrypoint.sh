#!/bin/bash
set -e

# Create directories if they don't exist
mkdir -p /data /app/logs

# Set secure permissions
chmod 700 /data
chmod 755 /app/logs

# Function to log with timestamp
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"
}

# Function to wait for dogecoind to be ready
wait_for_dogecoin() {
    local max_attempts=60  # 5 minutes max
    local attempt=1
    
    log "Waiting for Dogecoin daemon to be ready..."
    
    while [ $attempt -le $max_attempts ]; do
        if dogecoin-cli -datadir=/data getblockchaininfo >/dev/null 2>&1; then
            log "Dogecoin daemon is ready!"
            return 0
        fi
        
        if [ $((attempt % 10)) -eq 0 ]; then
            log "Still waiting for Dogecoin daemon... (attempt $attempt/$max_attempts)"
        fi
        
        sleep 5
        attempt=$((attempt + 1))
    done
    
    log "ERROR: Dogecoin daemon failed to start within 5 minutes"
    return 1
}

# Function to handle graceful shutdown
cleanup() {
    log "Received shutdown signal, stopping services..."
    
    if [ -n "$FRONTEND_PID" ] && kill -0 $FRONTEND_PID 2>/dev/null; then
        log "Stopping frontend (PID: $FRONTEND_PID)..."
        kill -TERM $FRONTEND_PID
        wait $FRONTEND_PID 2>/dev/null || true
    fi
    
    if [ -n "$DOGECOIND_PID" ] && kill -0 $DOGECOIND_PID 2>/dev/null; then
        log "Stopping Dogecoin daemon (PID: $DOGECOIND_PID)..."
        dogecoin-cli -datadir=/data stop || kill -TERM $DOGECOIND_PID
        wait $DOGECOIND_PID 2>/dev/null || true
    fi
    
    log "Shutdown complete"
    exit 0
}

# Set up signal handlers
trap cleanup SIGTERM SIGINT

log "Starting Dogecoin Node Monitor..."

# Start Dogecoin daemon in background with logging
log "Starting Dogecoin daemon..."
dogecoind -datadir=/data -disablewallet \
    -printtoconsole=1 \
    -daemon \
    -pid=/data/dogecoind.pid > /app/logs/dogecoind.log 2>&1 &

DOGECOIND_PID=$!
log "Dogecoin daemon started with PID: $DOGECOIND_PID"

# Wait for Dogecoin daemon to be ready
if ! wait_for_dogecoin; then
    log "Failed to start Dogecoin daemon, exiting..."
    exit 1
fi

# Start the web frontend
log "Starting web frontend..."
cd /app/frontend
node server.js > /app/logs/frontend.log 2>&1 &
FRONTEND_PID=$!
log "Frontend started with PID: $FRONTEND_PID"

# Wait a moment for frontend to initialize
sleep 3

log "All services started successfully"
log "Dogecoin daemon PID: $DOGECOIND_PID"
log "Frontend PID: $FRONTEND_PID"
log "Logs available at:"
log "  - Dogecoin: /app/logs/dogecoind.log"
log "  - Frontend: /app/logs/frontend.log"

# Wait for processes to exit
wait
