/**
 * Dogecoin Node Monitoring Server
 * Enhanced with modular architecture for maintainability
 */

const express = require('express');
const WebSocket = require('ws');
const path = require('path');
const http = require('http');

// Import modular components
const config = require('./src/config');
const { createChildLogger } = require('./src/utils/logger');
const { DogecoinRPCService } = require('./src/services/rpc');
const DogecoinWatchdog = require('./src/services/watchdog');

// Import routes
const apiRoutes = require('./src/routes/api');
const { router: watchdogRoutes, initializeWatchdog } = require('./src/routes/watchdog');

// Import middleware
const {
    errorHandler,
    notFoundHandler,
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

/**
 * Application State and Services
 */
const app = express();
const server = http.createServer(app);

// Services
let rpcService;
let watchdog;
let wss; // WebSocket server

/**
 * Initialize Application Services
 */
const initializeServices = async () => {
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
const configureApp = () => {
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

/**
 * Configure Routes
 */
const configureRoutes = () => {
    serverLogger.info('🛣️ Configuring routes...');

    // API routes
    app.use('/api', apiRoutes);
    app.use('/api/watchdog', watchdogRoutes);

    // Health check endpoint (bypass rate limiting)
    app.get('/health', (req, res) => {
        // Determine watchdog status
        let watchdogStatus = 'not_initialized';
        if (watchdog) {
            watchdogStatus = watchdog.isMonitoring ? 'monitoring' : 'initialized';
        }

        res.json({
            status: 'healthy',
            timestamp: new Date().toISOString(),
            services: {
                rpc: rpcService ? 'initialized' : 'not_initialized',
                watchdog: watchdogStatus
            }
        });
    });

    // WebSocket endpoint info
    app.get('/api/websocket/info', (req, res) => {
        res.json({
            endpoint: '/websocket',
            protocol: 'ws',
            description: 'Real-time updates for node status and alerts'
        });
    });

    // Catch-all middleware for SPA routing (Express 5.x compatible)
    app.use((req, res, next) => {
        if (req.method === 'GET' && !req.path.startsWith('/api') && !req.path.startsWith('/websocket')) {
            res.sendFile(path.join(__dirname, 'public', 'index.html'));
        } else {
            next();
        }
    });

    // 404 handler
    app.use(notFoundHandler);

    // Global error handler (must be last)
    app.use(errorHandler);

    serverLogger.info('✅ Routes configured');
}

/**
 * Initialize WebSocket Server
 */
const initializeWebSocket = () => {
    serverLogger.info('🔌 Initializing WebSocket server...');

    wss = new WebSocket.Server({
        server,
        path: '/websocket',
        clientTracking: true
    });

    wss.on('connection', (ws, req) => {
        const clientId = `client_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
        ws.clientId = clientId;

        serverLogger.info('📱 WebSocket client connected', {
            clientId,
            ip: req.socket.remoteAddress,
            userAgent: req.headers['user-agent']
        });

        // Send initial status
        if (watchdog) {
            try {
                const status = watchdog.getStatus();
                ws.send(JSON.stringify({
                    type: 'initial_status',
                    data: status,
                    timestamp: new Date().toISOString()
                }));
            } catch (error) {
                serverLogger.error('Failed to send initial status', { error: error.message, clientId });
            }
        }

        // Handle client messages
        ws.on('message', async(message) => {
            try {
                const data = JSON.parse(message);
                serverLogger.debug('WebSocket message received', {
                    clientId,
                    type: data.type,
                    data: data.data
                });

                switch (data.type) {
                    case 'subscribe':
                        ws.subscriptions = data.subscriptions || ['alerts', 'status', 'metrics'];
                        ws.send(JSON.stringify({
                            type: 'subscription_confirmed',
                            subscriptions: ws.subscriptions,
                            timestamp: new Date().toISOString()
                        }));
                        break;

                    case 'get_status':
                        if (watchdog) {
                            const status = watchdog.getStatus();
                            ws.send(JSON.stringify({
                                type: 'status_update',
                                data: status,
                                timestamp: new Date().toISOString()
                            }));
                        }
                        break;

                    case 'get_metrics':
                        if (watchdog) {
                            const metrics = watchdog.getMetrics();
                            ws.send(JSON.stringify({
                                type: 'metrics_update',
                                data: metrics,
                                timestamp: new Date().toISOString()
                            }));
                        }
                        break;

                    case 'acknowledge_alert':
                        if (watchdog && data.alertId) {
                            const acknowledged = watchdog.acknowledgeAlert(data.alertId);
                            ws.send(JSON.stringify({
                                type: 'alert_acknowledged',
                                alertId: data.alertId,
                                success: acknowledged,
                                timestamp: new Date().toISOString()
                            }));
                        }
                        break;

                    default:
                        ws.send(JSON.stringify({
                            type: 'error',
                            message: `Unknown message type: ${data.type}`,
                            timestamp: new Date().toISOString()
                        }));
                }
            } catch (error) {
                serverLogger.error('WebSocket message handling error', {
                    error: error.message,
                    clientId,
                    message: message.toString()
                });

                ws.send(JSON.stringify({
                    type: 'error',
                    message: 'Invalid message format',
                    timestamp: new Date().toISOString()
                }));
            }
        });

        // Handle connection close
        ws.on('close', (code, reason) => {
            serverLogger.info('📱 WebSocket client disconnected', {
                clientId,
                code,
                reason: reason.toString()
            });
        });

        // Handle errors
        ws.on('error', (error) => {
            serverLogger.error('WebSocket error', {
                error: error.message,
                clientId
            });
        });

        // Keep connection alive
        ws.isAlive = true;
        ws.on('pong', () => {
            ws.isAlive = true;
        });
    });

    // Ping clients periodically
    const pingInterval = setInterval(() => {
        wss.clients.forEach((ws) => {
            if (ws.isAlive === false) {
                serverLogger.info('Terminating inactive WebSocket connection', {
                    clientId: ws.clientId
                });
                return ws.terminate();
            }

            ws.isAlive = false;
            ws.ping();
        });
    }, 30000); // 30 seconds

    wss.on('close', () => {
        clearInterval(pingInterval);
    });

    serverLogger.info('✅ WebSocket server initialized');
}

/**
 * Broadcast message to WebSocket clients
 */
const broadcastToClients = (type, data) => {
    if (!wss) {
return;
}

    const message = JSON.stringify({
        type,
        data,
        timestamp: new Date().toISOString()
    });

    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            // Check if client is subscribed to this type
            if (!client.subscriptions || client.subscriptions.includes(type) || client.subscriptions.includes('all')) {
                try {
                    client.send(message);
                } catch (error) {
                    serverLogger.error('Failed to send WebSocket message', {
                        error: error.message,
                        clientId: client.clientId,
                        type
                    });
                }
            }
        }
    });
}

/**
 * Setup Watchdog Event Handlers
 */
const setupWatchdogHandlers = () => {
    if (!watchdog) {
return;
}

    serverLogger.info('🔍 Setting up watchdog event handlers...');

    // Broadcast watchdog updates to WebSocket clients
    watchdog.on('update', (data) => {
        broadcastToClients('watchdog_update', data);
    });

    watchdog.on('alert', (alert) => {
        serverLogger.warn('🚨 Watchdog alert', {
            type: alert.type,
            severity: alert.severity,
            message: alert.message
        });

        broadcastToClients('new_alert', alert);
    });

    watchdog.on('started', () => {
        serverLogger.info('🔍 Watchdog monitoring started');
        broadcastToClients('watchdog_started', {
            message: 'Security monitoring activated',
            timestamp: new Date().toISOString()
        });
    });

    watchdog.on('stopped', () => {
        serverLogger.info('🛑 Watchdog monitoring stopped');
        broadcastToClients('watchdog_stopped', {
            message: 'Security monitoring deactivated',
            timestamp: new Date().toISOString()
        });
    });

    watchdog.on('error', (error) => {
        serverLogger.error('❌ Watchdog error', { error: error.message });
        broadcastToClients('watchdog_error', {
            message: error.message,
            timestamp: new Date().toISOString()
        });
    });

    serverLogger.info('✅ Watchdog event handlers configured');
}

/**
 * Start Watchdog Monitoring
 */
const startWatchdog = async () => {
    if (!watchdog) {
        serverLogger.warn('⚠️ Watchdog service not initialized, skipping monitoring start');
        return;
    }

    try {
        // Wait for Dogecoin node to be ready
        await new Promise(resolve => setTimeout(resolve, config.watchdog.startupDelay));

        serverLogger.info('🔍 Starting watchdog monitoring...');
        await watchdog.startMonitoring();
        serverLogger.info('✅ Watchdog monitoring started successfully');
    } catch (error) {
        serverLogger.error('❌ Failed to start watchdog monitoring', { error: error.message });
        // Continue running without watchdog
    }
}

/**
 * Graceful Shutdown Handler
 */
const setupGracefulShutdown = () => {
    const shutdown = async(signal) => {
        serverLogger.info(`🛑 Received ${signal}, starting graceful shutdown...`);

        // Stop accepting new connections
        server.close(() => {
            serverLogger.info('✅ HTTP server closed');
        });

        // Close WebSocket connections
        if (wss) {
            wss.clients.forEach((client) => {
                client.close(1001, 'Server shutting down');
            });
            wss.close(() => {
                serverLogger.info('✅ WebSocket server closed');
            });
        }

        // Stop watchdog
        if (watchdog?.isMonitoring) {
            watchdog.stopMonitoring();
            serverLogger.info('✅ Watchdog monitoring stopped');
        }

        serverLogger.info('✅ Graceful shutdown completed');
        process.exit(0);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
}

/**
 * Main Application Startup
 */
const startServer = async () => {
    try {
        serverLogger.info('🚀 Starting Dogecoin Node Monitoring Server...');
        serverLogger.info('📋 Configuration loaded', {
            port: config.server.port,
            environment: config.env,
            rpcHost: config.rpc.host,
            rpcPort: config.rpc.port
        });

        // Initialize services
        await initializeServices();

        // Configure Express
        configureApp();

        // Configure routes
        configureRoutes();

        // Initialize WebSocket
        initializeWebSocket();

        // Setup watchdog handlers
        setupWatchdogHandlers();

        // Setup graceful shutdown
        setupGracefulShutdown();

        // Start HTTP server
        server.listen(config.server.port, '0.0.0.0', () => {
            serverLogger.info('🌐 Server started successfully', {
                port: config.server.port,
                host: '0.0.0.0',
                environment: config.env,
                pid: process.pid
            });
        });

        // Start watchdog monitoring (delayed)
        startWatchdog();
    } catch (error) {
        serverLogger.error('❌ Failed to start server', { error: error.message });
        process.exit(1);
    }
}

// Start the server
if (require.main === module) {
    startServer();
}

module.exports = { app, server };
