/**
 * Security Middleware
 * Implements security best practices and protections
 */

const rateLimit = require('express-rate-limit');
const { createChildLogger } = require('../utils/logger');

const logger = createChildLogger({ service: 'security-middleware' });

/**
 * Rate limiting configuration
 */
const createRateLimiter = (options = {}) => {
    const defaults = {
        windowMs: 15 * 60 * 1000, // 15 minutes
        max: 500, // increased from 100 to 500 requests per windowMs
        message: {
            error: 'RATE_LIMITED',
            message: 'Too many requests from this IP, please try again later',
            timestamp: new Date().toISOString()
        },
        standardHeaders: true,
        legacyHeaders: false,
        handler: (req, res) => {
            logger.warn('Rate limit exceeded', {
                ip: req.ip,
                userAgent: req.get('User-Agent'),
                url: req.url
            });
            
            res.status(429).json(options.message || defaults.message);
        }
    };

    return rateLimit({ ...defaults, ...options });
};

/**
 * General API rate limiter
 */
const apiRateLimit = createRateLimiter({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 500, // increased from 100 to 500 requests per window
    trustProxy: 1, // Trust first proxy (Docker network)
    message: {
        error: 'RATE_LIMITED',
        message: 'Too many API requests, please try again later',
        timestamp: new Date().toISOString()
    }
});

/**
 * Strict rate limiter for sensitive operations
 */
const strictRateLimit = createRateLimiter({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10, // 10 requests per window
    trustProxy: false, // Explicitly set for security
    message: {
        error: 'RATE_LIMITED',
        message: 'Too many requests for this operation, please try again later',
        timestamp: new Date().toISOString()
    }
});

/**
 * Security headers middleware
 * Adds security-related HTTP headers
 */
const securityHeaders = (req, res, next) => {
    // Prevent clickjacking
    res.setHeader('X-Frame-Options', 'DENY');
    
    // Prevent MIME type sniffing
    res.setHeader('X-Content-Type-Options', 'nosniff');
    
    // Enable XSS protection
    res.setHeader('X-XSS-Protection', '1; mode=block');
    
    // Referrer policy
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    
    // Content Security Policy for static files
    if (req.path.endsWith('.html') || req.path === '/') {
        res.setHeader('Content-Security-Policy', [
            "default-src 'self'",
            "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' data:",
            "connect-src 'self' ws: wss:",
            "font-src 'self'",
            "object-src 'none'",
            "base-uri 'self'",
            "form-action 'self'"
        ].join('; '));
    }
    
    next();
};

/**
 * Input validation middleware
 * Basic input sanitization and validation
 */
const validateInput = (req, res, next) => {
    // Check for common injection patterns in query parameters
    const suspiciousPatterns = [
        /(<script|<\/script)/i,
        /(javascript:|data:)/i,
        /(union.*select|select.*from)/i,
        /(drop|delete|insert|update).*table/i,
        /(\|\||&&|\$\(|\`)/
    ];

    const checkForSuspiciousContent = (obj, path = '') => {
        for (const [key, value] of Object.entries(obj)) {
            const currentPath = path ? `${path}.${key}` : key;
            
            if (typeof value === 'string') {
                for (const pattern of suspiciousPatterns) {
                    if (pattern.test(value)) {
                        logger.warn('Suspicious input detected', {
                            path: currentPath,
                            value: value.substring(0, 50) + '...', // Limit logged value length
                            pattern: pattern.toString(),
                            ip: req.ip,
                            userAgent: req.get('User-Agent')?.substring(0, 200) // Limit UA length
                        });
                        
                        return res.status(400).json({
                            error: 'INVALID_INPUT',
                            message: 'Invalid characters detected in input',
                            field: currentPath,
                            timestamp: new Date().toISOString()
                        });
                    }
                }
            } else if (typeof value === 'object' && value !== null) {
                const result = checkForSuspiciousContent(value, currentPath);
                if (result) return result;
            }
        }
        return null;
    };

    // Check query parameters
    if (req.query && Object.keys(req.query).length > 0) {
        const result = checkForSuspiciousContent(req.query);
        if (result) return result;
    }

    // Check body parameters
    if (req.body && typeof req.body === 'object') {
        const result = checkForSuspiciousContent(req.body);
        if (result) return result;
    }

    // Check for excessively long inputs
    const maxLength = 10000;
    const checkLength = (obj) => {
        for (const [key, value] of Object.entries(obj)) {
            if (typeof value === 'string' && value.length > maxLength) {
                logger.warn('Excessively long input detected', {
                    field: key,
                    length: value.length,
                    maxLength,
                    ip: req.ip
                });
                
                return res.status(400).json({
                    error: 'INPUT_TOO_LONG',
                    message: `Input too long for field: ${key}`,
                    maxLength,
                    timestamp: new Date().toISOString()
                });
            }
        }
        return null;
    };

    if (req.body && typeof req.body === 'object') {
        const result = checkLength(req.body);
        if (result) return result;
    }

    next();
};

/**
 * Request logging middleware
 * Logs incoming requests for security monitoring
 */
const requestLogger = (req, res, next) => {
    const startTime = Date.now();
    
    // Log request
    logger.info('Incoming request', {
        method: req.method,
        url: req.url,
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        contentLength: req.get('Content-Length'),
        timestamp: new Date().toISOString()
    });

    // Log response when finished
    res.on('finish', () => {
        const duration = Date.now() - startTime;
        
        logger.info('Request completed', {
            method: req.method,
            url: req.url,
            statusCode: res.statusCode,
            duration: `${duration}ms`,
            ip: req.ip,
            timestamp: new Date().toISOString()
        });
    });

    next();
};

/**
 * CORS configuration middleware
 * Handles Cross-Origin Resource Sharing
 */
const corsHandler = (req, res, next) => {
    // Allow requests from the same origin by default
    const origin = req.get('Origin');
    
    // For development, allow localhost
    if (process.env.NODE_ENV === 'development') {
        res.setHeader('Access-Control-Allow-Origin', origin || '*');
    } else {
        // In production, be more restrictive
        const allowedOrigins = process.env.ALLOWED_ORIGINS 
            ? process.env.ALLOWED_ORIGINS.split(',')
            : [];
            
        if (origin && allowedOrigins.includes(origin)) {
            res.setHeader('Access-Control-Allow-Origin', origin);
        }
    }
    
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Max-Age', '86400'); // 24 hours
    
    // Handle preflight requests
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    
    next();
};

/**
 * Health check bypass middleware
 * Allows health checks to bypass rate limiting
 */
const healthCheckBypass = (req, res, next) => {
    if (req.path === '/api/health' && req.method === 'GET') {
        // Skip rate limiting for health checks
        return next();
    }
    
    // Apply rate limiting for other requests
    apiRateLimit(req, res, next);
};

module.exports = {
    apiRateLimit,
    strictRateLimit,
    securityHeaders,
    validateInput,
    requestLogger,
    corsHandler,
    healthCheckBypass,
    createRateLimiter
};
