/**
 * Centralized Logging Service
 * Provides consistent logging across the application
 */

const winston = require('winston');
const path = require('path');
const fs = require('fs');

/**
 * Creates the main application logger with proper configuration
 * @returns {winston.Logger} Configured logger instance
 */
function createLogger() {
    // Determine log directory based on environment
    const logDir = process.env.LOG_DIR || (
        process.env.NODE_ENV === 'production' ? '/app/logs' : './logs'
    );
    
    // Create logs directory if it doesn't exist
    if (!fs.existsSync(logDir)) {
        try {
            fs.mkdirSync(logDir, { recursive: true });
        } catch (error) {
            console.warn(`Warning: Could not create log directory ${logDir}, using console only:`, error.message);
        }
    }

    const transports = [];

    // Console transport (always enabled)
    transports.push(
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.colorize({ all: true }),
                winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
                winston.format.printf(({ timestamp, level, message, service, ...meta }) => {
                    const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
                    const serviceStr = service ? `[${service}] ` : '';
                    return `${timestamp} ${level}: ${serviceStr}${message}${metaStr}`;
                })
            )
        })
    );

    // File transports (enabled in production or when explicitly requested)
    const nodeEnv = process.env.NODE_ENV || 'development';
    if (nodeEnv === 'production' || process.env.ENABLE_FILE_LOGGING === 'true') {
        // Combined log
        // Combined log
        transports.push(
            new winston.transports.File({
                filename: path.join(logDir, 'combined.log'),
                maxsize: 10485760, // 10MB
                maxFiles: 5,
                format: winston.format.combine(
                    winston.format.timestamp(),
                    winston.format.errors({ stack: true }),
                    winston.format.json()
                )
            })
        );

        // Error log
        transports.push(
            new winston.transports.File({
                filename: path.join(logDir, 'error.log'),
                level: 'error',
                maxsize: 10485760, // 10MB
                maxFiles: 5,
                format: winston.format.combine(
                    winston.format.timestamp(),
                    winston.format.errors({ stack: true }),
                    winston.format.json()
                )
            })
        );
    }

    return winston.createLogger({
        level: process.env.LOG_LEVEL || 'info',
        format: winston.format.combine(
            winston.format.timestamp(),
            winston.format.errors({ stack: true }),
            winston.format.json()
        ),
        defaultMeta: { service: 'dogecoin-monitor' },
        transports,
        // Handle uncaught exceptions and rejections
        exceptionHandlers: [
            new winston.transports.Console(),
            ...(nodeEnv === 'production' ? [
                new winston.transports.File({
                    filename: path.join(logDir, 'exceptions.log')
                })
            ] : [])
        ],
        rejectionHandlers: [
            new winston.transports.Console(),
            ...(nodeEnv === 'production' ? [
                new winston.transports.File({
                    filename: path.join(logDir, 'rejections.log')
                })
            ] : [])
        ]
    });
}

/**
 * Creates a child logger with additional context
 * @param {Object} context - Additional context for the logger
 * @returns {winston.Logger} Child logger instance
 */
function createChildLogger(context = {}) {
    return logger.child(context);
}

/**
 * Logs application startup information
 */
function logStartup() {
    logger.info('Starting Dogecoin Node Monitor', {
        version: require('../../package.json').version,
        nodeEnv: process.env.NODE_ENV || 'development',
        port: process.env.PORT || 3000,
        logLevel: process.env.LOG_LEVEL || 'info',
        rpcHost: process.env.RPC_HOST || 'localhost',
        rpcPort: process.env.RPC_PORT || 22555,
        watchdogEnabled: process.env.WATCHDOG_ENABLED !== 'false'
    });
}

// Create the main logger instance
const logger = createLogger();

module.exports = {
    logger,
    createChildLogger,
    logStartup
};
