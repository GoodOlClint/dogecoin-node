/**
 * Error Handling Middleware
 * Centralized error handling for the application
 */

const { createChildLogger } = require('../utils/logger');
const { RPCError } = require('../services/rpc');

const logger = createChildLogger({ service: 'error-middleware' });

/**
 * Global error handler middleware
 * Must be used as the last middleware in the chain
 */
const errorHandler = (err, req, res) => {
    // Log the error with context
    logger.error('Unhandled error in request', {
        error: err.message,
        stack: err.stack,
        method: req.method,
        url: req.url,
        ip: req.ip,
        userAgent: req.get('User-Agent')
    });

    // Don't leak error details in production
    const isDevelopment = process.env.NODE_ENV === 'development';

    // Handle specific error types
    if (err instanceof RPCError) {
        return res.status(503).json({
            error: 'RPC_ERROR',
            message: 'Dogecoin node communication error',
            details: isDevelopment ? err.message : null,
            code: err.code,
            method: err.method,
            timestamp: new Date().toISOString()
        });
    }

    // Handle validation errors
    if (err.name === 'ValidationError') {
        return res.status(400).json({
            error: 'VALIDATION_ERROR',
            message: 'Request validation failed',
            details: isDevelopment ? err.message : null,
            timestamp: new Date().toISOString()
        });
    }

    // Handle syntax errors (malformed JSON, etc.)
    if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
        return res.status(400).json({
            error: 'SYNTAX_ERROR',
            message: 'Malformed request body',
            details: isDevelopment ? err.message : null,
            timestamp: new Date().toISOString()
        });
    }

    // Handle timeout errors
    if (err.code === 'ETIMEDOUT' || err.code === 'ECONNRESET') {
        return res.status(504).json({
            error: 'TIMEOUT_ERROR',
            message: 'Request timeout',
            details: isDevelopment ? err.message : null,
            timestamp: new Date().toISOString()
        });
    }

    // Default error response
    res.status(err.status || 500).json({
        error: 'INTERNAL_SERVER_ERROR',
        message: isDevelopment ? err.message : 'An unexpected error occurred',
        details: isDevelopment ? err.stack : null,
        timestamp: new Date().toISOString()
    });
};

/**
 * 404 Not Found handler
 * Should be used before the global error handler
 */
const notFoundHandler = (req, res) => {
    logger.warn('Route not found', {
        method: req.method,
        url: req.url,
        ip: req.ip,
        userAgent: req.get('User-Agent')
    });

    res.status(404).json({
        error: 'NOT_FOUND',
        message: `Route ${req.method} ${req.url} not found`,
        timestamp: new Date().toISOString()
    });
};

/**
 * Async wrapper to handle async route errors
 * Wraps async route handlers to ensure errors are caught
 */
const asyncHandler = (fn) => {
    return (req, res, next) => {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
};

/**
 * Request timeout middleware
 * Prevents requests from hanging indefinitely
 */
const requestTimeout = (timeoutMs = 30000) => {
    return (req, res, next) => {
        const timeout = setTimeout(() => {
            if (!res.headersSent) {
                logger.warn('Request timeout', {
                    method: req.method,
                    url: req.url,
                    timeout: timeoutMs
                });

                res.status(408).json({
                    error: 'REQUEST_TIMEOUT',
                    message: `Request timeout after ${timeoutMs}ms`,
                    timestamp: new Date().toISOString()
                });
            }
        }, timeoutMs);

        // Clear timeout on response
        res.on('finish', () => {
            clearTimeout(timeout);
        });

        next();
    };
};

module.exports = {
    errorHandler,
    notFoundHandler,
    asyncHandler,
    requestTimeout
};
