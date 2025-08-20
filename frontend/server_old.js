/**
 * Dogecoin Node Monitoring Server
 * Enhanced with modular architecture for maintainability
 */

const express = require('express');
const cors = require('cors');
const WebSocket = require('ws');
const path = require('path');
const http = require('http');

// Import modular components
const config = require('./src/config');
const { logger, createChildLogger } = require('./src/utils/logger');
const { DogecoinRPCService } = require('./src/services/rpc');
const DogecoinWatchdog = require('./src/services/watchdog');

// Import routes
const apiRoutes = require('./src/routes/api');
const { router: watchdogRoutes, initializeWatchdog } = require('./src/routes/watchdog');

// Import middleware
const { 
    errorHandler, 
    notFoundHandler, 
    asyncHandler, 
    requestTimeout 
} = require('./src/middleware/errorHandler');
const { 
    securityHeaders, 
    validateInput, 
    requestLogger, 
    corsHandler, 
    healthCheckBypass 
} = require('./src/middleware/security');

// Create child logger for server
const serverLogger = createChildLogger({ service: 'server' });

const app = express();
const PORT = process.env.PORT || 3000;

// Log application startup
logger.info('Starting Dogecoin Node Monitor', {
    port: PORT,
    nodeEnv: process.env.NODE_ENV || 'development',
    logLevel: process.env.LOG_LEVEL || 'info'
});

/**
 * Application State and Services
 */
const app = express();
const server = http.createServer(app);

// Initialize services
let rpcService;
let watchdog;
let wss; // WebSocket server

/**
 * Initialize Application Services
 */
async function initializeServices() {
    try {
        serverLogger.info('🚀 Initializing services...');

        // Initialize RPC service
        rpcService = new DogecoinRPCService();
        
        // Test RPC connection
        const isConnected = await rpcService.testConnection();
        if (!isConnected) {
            serverLogger.warn('⚠️ Dogecoin RPC connection test failed, continuing anyway...');
        } else {
            serverLogger.info('✅ Dogecoin RPC connection established');
        }

        // Initialize watchdog service
        watchdog = new DogecoinWatchdog(rpcService);
        
        // Initialize watchdog routes with the service
        initializeWatchdog(watchdog);

        serverLogger.info('✅ All services initialized successfully');
        return true;

    } catch (error) {
        serverLogger.error('❌ Failed to initialize services', { error: error.message });
        throw error;
    }
}

/**
 * Configure Express Application
 */
function configureApp() {
    serverLogger.info('🔧 Configuring Express application...');

    // Trust proxy for accurate IP addresses
    app.set('trust proxy', true);

    // Request timeout
    app.use(requestTimeout(config.server.requestTimeout));

    // Security headers
    app.use(securityHeaders);

    // CORS handling
    app.use(corsHandler);

    // Request logging
    app.use(requestLogger);

    // Input validation
    app.use(validateInput);

    // Rate limiting with health check bypass
    app.use(healthCheckBypass);

    // Parse JSON bodies
    app.use(express.json({ limit: '1mb' }));
    app.use(express.urlencoded({ extended: true, limit: '1mb' }));

    // Serve static files
    app.use(express.static(path.join(__dirname, 'public')));

    serverLogger.info('✅ Express application configured');
}
    
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
