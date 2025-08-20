/**
 * Application Configuration
 * Centralized configuration management with environment variable support
 */

const config = {
    // Server Configuration
    server: {
        port: process.env.PORT || 3000,
        host: process.env.HOST || '0.0.0.0',
        logLevel: process.env.LOG_LEVEL || 'info',
        nodeEnv: process.env.NODE_ENV || 'development'
    },

    // Dogecoin RPC Configuration
    rpc: {
        host: process.env.DOGECOIN_RPC_HOST || 'localhost',
        port: parseInt(process.env.DOGECOIN_RPC_PORT) || 22555,
        cookiePath: process.env.DOGECOIN_COOKIE_PATH || '/data/.cookie',
        timeout: parseInt(process.env.RPC_TIMEOUT) || 30000,
        maxRetries: parseInt(process.env.RPC_MAX_RETRIES) || 10,
        retryDelay: parseInt(process.env.RPC_RETRY_DELAY) || 3000
    },

    // Logging configuration
    logging: {
        level: process.env.LOG_LEVEL || 'info',
        dir: process.env.LOG_DIR || (process.env.NODE_ENV === 'production' ? '/app/logs' : './logs'),
        maxSize: parseInt(process.env.LOG_MAX_SIZE) || 10 * 1024 * 1024, // 10MB
        maxFiles: parseInt(process.env.LOG_MAX_FILES) || 5
    },

    // Watchdog Configuration
    watchdog: {
        enabled: process.env.WATCHDOG_ENABLED !== 'false',
        startupDelay: parseInt(process.env.WATCHDOG_STARTUP_DELAY) || 10000,
        monitoringInterval: parseInt(process.env.WATCHDOG_INTERVAL) || 30000,
        maxBaselineRetries: parseInt(process.env.WATCHDOG_MAX_RETRIES) || 10,
        baselineRetryDelay: parseInt(process.env.WATCHDOG_RETRY_DELAY) || 3000,
        
        // Security thresholds
        thresholds: {
            hashRateSpike: parseFloat(process.env.WATCHDOG_HASH_SPIKE) || 5.0,
            hashRateDrop: parseFloat(process.env.WATCHDOG_HASH_DROP) || 0.3,
            blockTimeAnomaly: parseFloat(process.env.WATCHDOG_BLOCK_TIME) || 3.0,
            difficultySpike: parseFloat(process.env.WATCHDOG_DIFFICULTY) || 3.0,
            mempoolFlood: parseInt(process.env.WATCHDOG_MEMPOOL) || 10000,
            lowNodeCount: parseInt(process.env.WATCHDOG_NODE_COUNT) || 50,
            orphanBlockThreshold: parseInt(process.env.WATCHDOG_ORPHAN) || 5
        }
    },

    // WebSocket Configuration
    websocket: {
        heartbeatInterval: parseInt(process.env.WS_HEARTBEAT) || 30000,
        maxConnections: parseInt(process.env.WS_MAX_CONNECTIONS) || 100
    },

    // Rate Limiting
    rateLimit: {
        windowMs: parseInt(process.env.RATE_LIMIT_WINDOW) || 15 * 60 * 1000, // 15 minutes
        maxRequests: parseInt(process.env.RATE_LIMIT_MAX) || 100
    },

    // CORS Configuration
    cors: {
        origin: process.env.CORS_ORIGIN || '*',
        credentials: process.env.CORS_CREDENTIALS === 'true'
    }
};

/**
 * Validates the configuration
 * @throws {Error} If configuration is invalid
 */
function validateConfig() {
    const required = [
        'server.port',
        'rpc.host',
        'rpc.port'
    ];

    for (const key of required) {
        const value = key.split('.').reduce((obj, k) => obj?.[k], config);
        if (value === undefined || value === null) {
            throw new Error(`Required configuration missing: ${key}`);
        }
    }

    // Validate port ranges
    if (config.server.port < 1 || config.server.port > 65535) {
        throw new Error('Server port must be between 1 and 65535');
    }

    if (config.rpc.port < 1 || config.rpc.port > 65535) {
        throw new Error('RPC port must be between 1 and 65535');
    }
}

// Validate on load
validateConfig();

module.exports = config;
