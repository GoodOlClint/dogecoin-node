/**
 * Centralized Logging Service
 * Provides consistent logging across the application
 */

const winston = require('winston');
const path = require('path');
const fs = require('fs');
const config = require('../config');

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

    // File transports (only in production or when explicitly enabled)
    if (config.server.nodeEnv === 'production' || process.env.ENABLE_FILE_LOGGING === 'true') {
        // Combined log
        transports.push(
            new winston.transports.File({
                filename: path.join(config.logging.dir, 'combined.log'),
                maxsize: config.logging.maxSize,
                maxFiles: config.logging.maxFiles,
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
                filename: path.join(config.logging.dir, 'error.log'),
                level: 'error',
                maxsize: config.logging.maxSize,
                maxFiles: config.logging.maxFiles,
                format: winston.format.combine(
                    winston.format.timestamp(),
                    winston.format.errors({ stack: true }),
                    winston.format.json()
                )
            })
        );
    }

    return winston.createLogger({
        level: config.server.logLevel,
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
            ...(config.server.nodeEnv === 'production' ? [
                new winston.transports.File({
                    filename: path.join(config.logging.dir, 'exceptions.log')
                })
            ] : [])
        ],
        rejectionHandlers: [
            new winston.transports.Console(),
            ...(config.server.nodeEnv === 'production' ? [
                new winston.transports.File({
                    filename: path.join(config.logging.dir, 'rejections.log')
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
        nodeEnv: config.server.nodeEnv,
        port: config.server.port,
        logLevel: config.server.logLevel,
        rpcHost: config.rpc.host,
        rpcPort: config.rpc.port,
        watchdogEnabled: config.watchdog.enabled
    });
}

// Create the main logger instance
const logger = createLogger();

module.exports = {
    logger,
    createChildLogger,
    logStartup
};
