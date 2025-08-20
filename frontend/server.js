const express = require('express');
const axios = require('axios');
const cors = require('cors');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');
const winston = require('winston');
const DogecoinWatchdog = require('./watchdog');

// Configure Winston logger
const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json()
    ),
    defaultMeta: { service: 'dogecoin-monitor' },
    transports: [
        // Write all logs to console in development
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.colorize(),
                winston.format.simple(),
                winston.format.printf(({ level, message, timestamp, stack }) => {
                    return `${timestamp} [${level}]: ${stack || message}`;
                })
            )
        }),
        // Write all logs to a combined log file
        new winston.transports.File({ 
            filename: '/app/logs/combined.log',
            maxsize: 10 * 1024 * 1024, // 10MB
            maxFiles: 5
        }),
        // Write error logs to a separate file
        new winston.transports.File({ 
            filename: '/app/logs/error.log', 
            level: 'error',
            maxsize: 10 * 1024 * 1024, // 10MB
            maxFiles: 5
        })
    ]
});

// Create logs directory if it doesn't exist
if (!fs.existsSync('/app/logs')) {
    fs.mkdirSync('/app/logs', { recursive: true });
}

const app = express();
const PORT = process.env.PORT || 3000;

// Log application startup
logger.info('Starting Dogecoin Node Monitor', {
    port: PORT,
    nodeEnv: process.env.NODE_ENV || 'development',
    logLevel: process.env.LOG_LEVEL || 'info'
});

// Dogecoin RPC configuration
const RPC_CONFIG = {
    host: process.env.DOGECOIN_RPC_HOST || 'localhost',
    port: process.env.DOGECOIN_RPC_PORT || 22555,
    cookiePath: process.env.DOGECOIN_COOKIE_PATH || '/data/.cookie'
};

const rpcUrl = `http://${RPC_CONFIG.host}:${RPC_CONFIG.port}`;

logger.info('RPC Configuration', {
    host: RPC_CONFIG.host,
    port: RPC_CONFIG.port,
    cookiePath: RPC_CONFIG.cookiePath,
    rpcUrl: rpcUrl
});

// Function to read RPC cookie
function getRPCAuth() {
    try {
        if (fs.existsSync(RPC_CONFIG.cookiePath)) {
            const cookie = fs.readFileSync(RPC_CONFIG.cookiePath, 'utf8').trim();
            const [username, password] = cookie.split(':');
            logger.debug('RPC cookie authentication loaded', { username: username });
            return { username, password };
        } else {
            logger.warn('RPC cookie file not found, using fallback credentials', {
                cookiePath: RPC_CONFIG.cookiePath
            });
            return {
                username: process.env.DOGECOIN_RPC_USER || 'dogecoin',
                password: process.env.DOGECOIN_RPC_PASS || 'SecureDogePassword123!'
            };
        }
    } catch (error) {
        logger.error('Error reading RPC cookie', { 
            error: error.message,
            cookiePath: RPC_CONFIG.cookiePath
        });
        return {
            username: process.env.DOGECOIN_RPC_USER || 'dogecoin',
            password: process.env.DOGECOIN_RPC_PASS || 'SecureDogePassword123!'
        };
    }
}

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Enhanced request logging middleware
app.use((req, res, next) => {
    const start = Date.now();
    
    // Log the incoming request
    logger.info('Incoming request', {
        method: req.method,
        url: req.url,
        userAgent: req.get('User-Agent'),
        ip: req.ip,
        timestamp: new Date().toISOString()
    });
    
    // Log the response when it finishes
    res.on('finish', () => {
        const duration = Date.now() - start;
        logger.info('Request completed', {
            method: req.method,
            url: req.url,
            statusCode: res.statusCode,
            duration: `${duration}ms`,
            timestamp: new Date().toISOString()
        });
    });
    
    next();
});

// Initialize Dogecoin Watchdog with dynamic RPC auth
const watchdogConfig = {
    host: RPC_CONFIG.host,
    port: RPC_CONFIG.port,
    // Pass a function to get auth dynamically
    getAuth: getRPCAuth
};

const watchdog = new DogecoinWatchdog(watchdogConfig, logger);

// Start watchdog monitoring
setTimeout(async () => {
    try {
        await watchdog.startMonitoring();
        logger.info('🔍 Dogecoin security watchdog activated');
    } catch (error) {
        logger.error('Failed to start watchdog:', error);
    }
}, 10000); // Wait 10 seconds for node to be ready

// RPC call helper function with improved error handling and logging
async function rpcCall(method, params = []) {
    const startTime = Date.now();
    
    try {
        logger.debug('Making RPC call', { 
            method: method, 
            params: params,
            rpcUrl: rpcUrl
        });
        
        const auth = getRPCAuth();
        const response = await axios.post(rpcUrl, {
            jsonrpc: '1.0',
            id: 'dogecoin-monitor',
            method: method,
            params: params
        }, {
            auth: {
                username: auth.username,
                password: auth.password
            },
            headers: {
                'Content-Type': 'application/json'
            },
            timeout: 10000 // 10 second timeout
        });
        
        const duration = Date.now() - startTime;
        logger.debug('RPC call successful', { 
            method: method, 
            duration: `${duration}ms`,
            responseSize: JSON.stringify(response.data).length
        });
        
        return response.data.result;
    } catch (error) {
        const duration = Date.now() - startTime;
        logger.error('RPC call failed', { 
            method: method,
            params: params,
            duration: `${duration}ms`,
            error: error.message,
            status: error.response && error.response.status,
            statusText: error.response && error.response.statusText
        });
        throw new Error(`RPC ${method} failed: ${error.message}`);
    }
}

// Unified API endpoint with better error handling and logging
app.get('/api/info', async (req, res) => {
    const startTime = Date.now();
    logger.info('API request: /api/info', { ip: req.ip });
    
    try {
        const [blockchain, network, mempool] = await Promise.all([
            rpcCall('getblockchaininfo'),
            rpcCall('getnetworkinfo'),
            rpcCall('getmempoolinfo')
        ]);
        
        const responseData = {
            blockchain,
            network,
            mempool,
            timestamp: new Date().toISOString()
        };
        
        const duration = Date.now() - startTime;
        logger.info('API response: /api/info successful', { 
            duration: `${duration}ms`,
            blockHeight: blockchain.blocks,
            connections: network.connections,
            mempoolSize: mempool.size
        });
        
        res.json(responseData);
    } catch (error) {
        const duration = Date.now() - startTime;
        logger.error('API error: /api/info failed', { 
            duration: `${duration}ms`,
            error: error.message,
            ip: req.ip
        });
        res.status(500).json({ 
            error: 'Failed to fetch node information',
            details: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

app.get('/api/peers', async (req, res) => {
    logger.info('API request: /api/peers', { ip: req.ip });
    try {
        const peers = await rpcCall('getpeerinfo');
        logger.info('API response: /api/peers successful', { peerCount: peers.length });
        res.json(peers);
    } catch (error) {
        logger.error('API error: /api/peers failed', { error: error.message, ip: req.ip });
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/blocks/:count?', async (req, res) => {
    const count = parseInt(req.params.count) || 10;
    logger.info('API request: /api/blocks', { ip: req.ip, count: count });
    try {
        const bestBlockHash = await rpcCall('getbestblockhash');
        const blocks = [];
        
        let currentHash = bestBlockHash;
        for (let i = 0; i < count && currentHash; i++) {
            const block = await rpcCall('getblock', [currentHash]);
            blocks.push(block);
            currentHash = block.previousblockhash;
        }
        
        res.json(blocks);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/mempool', async (req, res) => {
    try {
        const mempool = await rpcCall('getrawmempool');
        const mempoolInfo = await rpcCall('getmempoolinfo');
        
        res.json({
            transactions: mempool.slice(0, 50), // Limit to 50 recent transactions
            info: mempoolInfo
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/wallet', async (req, res) => {
    try {
        const walletInfo = await rpcCall('getwalletinfo');
        const balance = await rpcCall('getbalance');
        
        res.json({
            info: walletInfo,
            balance: balance
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Simple diagnostic endpoint with logging
app.get('/api/status', async (req, res) => {
    const startTime = Date.now();
    logger.info('API request: /api/status', { ip: req.ip });
    
    try {
        const info = await rpcCall('getblockchaininfo');
        const networkInfo = await rpcCall('getnetworkinfo');
        
        const responseData = {
            status: 'OK',
            timestamp: new Date().toISOString(),
            rpc_connected: true,
            current_block: info.blocks,
            connections: networkInfo.connections,
            server_uptime: process.uptime()
        };
        
        const duration = Date.now() - startTime;
        logger.info('API response: /api/status successful', { 
            duration: `${duration}ms`,
            blockHeight: info.blocks,
            connections: networkInfo.connections,
            uptime: process.uptime()
        });
        
        res.json(responseData);
    } catch (error) {
        const duration = Date.now() - startTime;
        logger.error('API error: /api/status failed', { 
            duration: `${duration}ms`,
            error: error.message,
            ip: req.ip
        });
        res.status(500).json({ 
            status: 'ERROR',
            timestamp: new Date().toISOString(),
            rpc_connected: false,
            error: error.message 
        });
    }
});

// Health check endpoint for monitoring and Docker health checks
app.get('/api/health', async (req, res) => {
    try {
        // Quick health check - just verify we can reach the Dogecoin RPC
        const info = await rpcCall('getblockchaininfo');
        
        res.json({
            status: 'healthy',
            timestamp: new Date().toISOString(),
            dogecoin: {
                connected: true,
                blocks: info.blocks,
                version: info.version || 'unknown'
            },
            uptime: process.uptime()
        });
    } catch (error) {
        logger.error('Health check failed', { error: error.message });
        res.status(503).json({
            status: 'unhealthy',
            timestamp: new Date().toISOString(),
            error: error.message,
            uptime: process.uptime()
        });
    }
});

// Watchdog API Endpoints

// Get watchdog status and recent alerts
app.get('/api/watchdog/status', async (req, res) => {
    try {
        const status = watchdog.getStatus();
        res.json({
            success: true,
            data: status,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error('Watchdog status request failed', { error: error.message });
        res.status(500).json({
            success: false,
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Get all alerts with pagination
app.get('/api/watchdog/alerts', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 50;
        const alerts = watchdog.getAlerts(limit);
        
        res.json({
            success: true,
            data: {
                alerts,
                total: alerts.length,
                limit
            },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error('Watchdog alerts request failed', { error: error.message });
        res.status(500).json({
            success: false,
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Acknowledge an alert
app.post('/api/watchdog/alerts/:alertId/acknowledge', async (req, res) => {
    try {
        const alertId = parseFloat(req.params.alertId);
        const success = watchdog.acknowledgeAlert(alertId);
        
        if (success) {
            res.json({
                success: true,
                message: 'Alert acknowledged',
                timestamp: new Date().toISOString()
            });
        } else {
            res.status(404).json({
                success: false,
                error: 'Alert not found',
                timestamp: new Date().toISOString()
            });
        }
    } catch (error) {
        logger.error('Alert acknowledgment failed', { error: error.message });
        res.status(500).json({
            success: false,
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Get watchdog metrics and trends
app.get('/api/watchdog/metrics', async (req, res) => {
    try {
        const metrics = watchdog.getMetrics();
        res.json({
            success: true,
            data: metrics,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error('Watchdog metrics request failed', { error: error.message });
        res.status(500).json({
            success: false,
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Start/stop watchdog monitoring
app.post('/api/watchdog/control', async (req, res) => {
    try {
        const action = req.body.action;
        
        if (action === 'start') {
            await watchdog.startMonitoring();
            res.json({
                success: true,
                message: 'Watchdog monitoring started',
                timestamp: new Date().toISOString()
            });
        } else if (action === 'stop') {
            watchdog.stopMonitoring();
            res.json({
                success: true,
                message: 'Watchdog monitoring stopped',
                timestamp: new Date().toISOString()
            });
        } else {
            res.status(400).json({
                success: false,
                error: 'Invalid action. Use "start" or "stop"',
                timestamp: new Date().toISOString()
            });
        }
    } catch (error) {
        logger.error('Watchdog control failed', { error: error.message });
        res.status(500).json({
            success: false,
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// WebSocket server for real-time updates with logging
const server = require('http').createServer(app);
const wss = new WebSocket.Server({ server });

let activeConnections = 0;

wss.on('connection', (ws, req) => {
    activeConnections++;
    const clientIp = req.connection.remoteAddress;
    
    logger.info('WebSocket client connected', { 
        clientIp: clientIp,
        activeConnections: activeConnections
    });
    
    // Send periodic updates
    const interval = setInterval(async () => {
        try {
            const info = await rpcCall('getblockchaininfo');
            const networkInfo = await rpcCall('getnetworkinfo');
            const mempoolInfo = await rpcCall('getmempoolinfo');
            const watchdogStatus = watchdog.getStatus();
            
            const updateData = {
                type: 'update',
                data: {
                    blockchain: info,
                    network: networkInfo,
                    mempool: mempoolInfo,
                    watchdog: {
                        isMonitoring: watchdogStatus.isMonitoring,
                        alertCount: watchdogStatus.alertCount,
                        recentAlerts: watchdogStatus.recentAlerts.slice(0, 5), // Only send 5 most recent
                        status: watchdogStatus.recentAlerts.length > 0 && 
                               watchdogStatus.recentAlerts.some(a => !a.acknowledged && a.severity === 'CRITICAL') 
                               ? 'CRITICAL_ALERT' : 'OK'
                    },
                    timestamp: new Date().toISOString()
                }
            };
            
            ws.send(JSON.stringify(updateData));
            
            logger.debug('WebSocket update sent', { 
                clientIp: clientIp,
                blockHeight: info.blocks,
                connections: networkInfo.connections
            });
            
        } catch (error) {
            logger.error('Error sending WebSocket update', { 
                clientIp: clientIp,
                error: error.message
            });
        }
    }, 5000); // Update every 5 seconds
    
    ws.on('close', () => {
        activeConnections--;
        logger.info('WebSocket client disconnected', { 
            clientIp: clientIp,
            activeConnections: activeConnections
        });
        clearInterval(interval);
    });
    
    ws.on('error', (error) => {
        logger.error('WebSocket error', { 
            clientIp: clientIp,
            error: error.message
        });
    });
});

// Enhanced server startup with logging
server.listen(PORT, () => {
    logger.info('Dogecoin Node Monitor started successfully', {
        port: PORT,
        rpcUrl: rpcUrl,
        nodeEnv: process.env.NODE_ENV || 'development'
    });
});

// Handle graceful shutdown
process.on('SIGINT', () => {
    logger.info('Received SIGINT, shutting down gracefully');
    watchdog.stopMonitoring();
    server.close(() => {
        logger.info('Server closed');
        process.exit(0);
    });
});

process.on('SIGTERM', () => {
    logger.info('Received SIGTERM, shutting down gracefully');
    watchdog.stopMonitoring();
    server.close(() => {
        logger.info('Server closed');
        process.exit(0);
    });
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
    logger.error('Uncaught Exception', { 
        error: error.message,
        stack: error.stack
    });
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Rejection', { 
        reason: reason,
        promise: promise
    });
});
