/**
 * Watchdog API Routes for Security Monitoring
 */

const express = require('express');
const { createChildLogger } = require('../utils/logger');

const router = express.Router();
const logger = createChildLogger({ service: 'watchdog-routes' });

/**
 * Watchdog service instance (will be injected)
 */
let watchdogService = null;

/**
 * Initialize the watchdog service
 * @param {DogecoinWatchdog} watchdog - Watchdog service instance
 */
const initializeWatchdog = (watchdog) => {
    watchdogService = watchdog;
    logger.info('Watchdog service initialized in routes');
};

/**
 * Middleware to ensure watchdog service is available
 */
const requireWatchdog = (req, res, next) => {
    if (!watchdogService) {
        return res.status(503).json({
            error: 'SERVICE_UNAVAILABLE',
            message: 'Watchdog service is not initialized'
        });
    }
    next();
};

/**
 * Error handler for watchdog routes
 */
const handleWatchdogError = (res, error, operation) => {
    logger.error(`${operation} failed`, { error: error.message });
    
    return res.status(500).json({
        error: 'WATCHDOG_ERROR',
        message: error.message,
        operation
    });
};

/**
 * GET /api/watchdog/status
 * Returns current watchdog status and overview
 */
router.get('/status', requireWatchdog, (req, res) => {
    try {
        const status = watchdogService.getStatus();
        
        res.json({
            status: 'success',
            timestamp: new Date().toISOString(),
            data: status
        });
    } catch (error) {
        handleWatchdogError(res, error, 'Status retrieval');
    }
});

/**
 * GET /api/watchdog/metrics
 * Returns comprehensive watchdog metrics
 */
router.get('/metrics', requireWatchdog, (req, res) => {
    try {
        const metrics = watchdogService.getMetrics();
        
        res.json({
            status: 'success',
            timestamp: new Date().toISOString(),
            data: metrics
        });
    } catch (error) {
        handleWatchdogError(res, error, 'Metrics retrieval');
    }
});

/**
 * GET /api/watchdog/alerts
 * Returns security alerts with optional filtering
 */
router.get('/alerts', requireWatchdog, (req, res) => {
    try {
        const { limit = 50, severity, acknowledged } = req.query;
        
        let alerts = watchdogService.getRecentAlerts(parseInt(limit));
        
        // Filter by severity if specified
        if (severity) {
            const validSeverities = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
            if (validSeverities.includes(severity.toUpperCase())) {
                alerts = alerts.filter(alert => alert.severity === severity.toUpperCase());
            }
        }
        
        // Filter by acknowledged status if specified
        if (acknowledged !== undefined) {
            const isAcknowledged = acknowledged === 'true';
            alerts = alerts.filter(alert => alert.acknowledged === isAcknowledged);
        }
        
        res.json({
            status: 'success',
            timestamp: new Date().toISOString(),
            filters: { limit: parseInt(limit), severity, acknowledged },
            data: {
                count: alerts.length,
                alerts
            }
        });
    } catch (error) {
        handleWatchdogError(res, error, 'Alerts retrieval');
    }
});

/**
 * POST /api/watchdog/alerts/:alertId/acknowledge
 * Acknowledges a specific alert
 */
router.post('/alerts/:alertId/acknowledge', requireWatchdog, (req, res) => {
    try {
        const { alertId } = req.params;
        
        if (!alertId) {
            return res.status(400).json({
                error: 'INVALID_PARAMETER',
                message: 'Alert ID is required'
            });
        }
        
        const acknowledged = watchdogService.acknowledgeAlert(alertId);
        
        if (acknowledged) {
            res.json({
                status: 'success',
                timestamp: new Date().toISOString(),
                message: 'Alert acknowledged successfully',
                alertId
            });
        } else {
            res.status(404).json({
                error: 'ALERT_NOT_FOUND',
                message: 'Alert not found',
                alertId
            });
        }
    } catch (error) {
        handleWatchdogError(res, error, `Alert acknowledgment for ID: ${req.params.alertId}`);
    }
});

/**
 * POST /api/watchdog/start
 * Starts the watchdog monitoring
 */
router.post('/start', requireWatchdog, async (req, res) => {
    try {
        if (watchdogService.isMonitoring) {
            return res.status(409).json({
                error: 'ALREADY_MONITORING',
                message: 'Watchdog is already monitoring'
            });
        }
        
        await watchdogService.startMonitoring();
        
        res.json({
            status: 'success',
            timestamp: new Date().toISOString(),
            message: 'Watchdog monitoring started'
        });
    } catch (error) {
        handleWatchdogError(res, error, 'Watchdog start');
    }
});

/**
 * POST /api/watchdog/stop
 * Stops the watchdog monitoring
 */
router.post('/stop', requireWatchdog, (req, res) => {
    try {
        if (!watchdogService.isMonitoring) {
            return res.status(409).json({
                error: 'NOT_MONITORING',
                message: 'Watchdog is not currently monitoring'
            });
        }
        
        watchdogService.stopMonitoring();
        
        res.json({
            status: 'success',
            timestamp: new Date().toISOString(),
            message: 'Watchdog monitoring stopped'
        });
    } catch (error) {
        handleWatchdogError(res, error, 'Watchdog stop');
    }
});

/**
 * POST /api/watchdog/recalculate-baselines
 * Recalculates network baselines for anomaly detection
 */
router.post('/recalculate-baselines', requireWatchdog, async (req, res) => {
    try {
        if (!watchdogService.isMonitoring) {
            return res.status(409).json({
                error: 'NOT_MONITORING',
                message: 'Watchdog must be monitoring to recalculate baselines'
            });
        }
        
        await watchdogService.calculateBaselines();
        
        const status = watchdogService.getStatus();
        
        res.json({
            status: 'success',
            timestamp: new Date().toISOString(),
            message: 'Baselines recalculated successfully',
            data: {
                baselines: status.baselines
            }
        });
    } catch (error) {
        handleWatchdogError(res, error, 'Baseline recalculation');
    }
});

/**
 * GET /api/watchdog/configuration
 * Returns current watchdog configuration and thresholds
 */
router.get('/configuration', requireWatchdog, (req, res) => {
    try {
        const status = watchdogService.getStatus();
        
        res.json({
            status: 'success',
            timestamp: new Date().toISOString(),
            data: {
                thresholds: status.thresholds,
                baselines: status.baselines,
                isMonitoring: status.isMonitoring
            }
        });
    } catch (error) {
        handleWatchdogError(res, error, 'Configuration retrieval');
    }
});

/**
 * GET /api/watchdog/health
 * Returns watchdog service health
 */
router.get('/health', requireWatchdog, (req, res) => {
    try {
        const status = watchdogService.getStatus();
        const isHealthy = watchdogService.isMonitoring && status.status !== 'OFFLINE';
        
        res.json({
            status: 'success',
            timestamp: new Date().toISOString(),
            data: {
                healthy: isHealthy,
                monitoring: watchdogService.isMonitoring,
                overallStatus: status.status,
                lastUpdate: status.lastUpdate
            }
        });
    } catch (error) {
        handleWatchdogError(res, error, 'Health check');
    }
});

/**
 * GET /api/watchdog/alerts/summary
 * Returns alert summary statistics
 */
router.get('/alerts/summary', requireWatchdog, (req, res) => {
    try {
        const allAlerts = watchdogService.getRecentAlerts(1000);
        
        const summary = {
            total: allAlerts.length,
            bySeverity: {
                CRITICAL: allAlerts.filter(a => a.severity === 'CRITICAL').length,
                HIGH: allAlerts.filter(a => a.severity === 'HIGH').length,
                MEDIUM: allAlerts.filter(a => a.severity === 'MEDIUM').length,
                LOW: allAlerts.filter(a => a.severity === 'LOW').length
            },
            byStatus: {
                acknowledged: allAlerts.filter(a => a.acknowledged).length,
                unacknowledged: allAlerts.filter(a => !a.acknowledged).length
            },
            byType: {}
        };
        
        // Count by alert type
        allAlerts.forEach(alert => {
            summary.byType[alert.type] = (summary.byType[alert.type] || 0) + 1;
        });
        
        res.json({
            status: 'success',
            timestamp: new Date().toISOString(),
            data: summary
        });
    } catch (error) {
        handleWatchdogError(res, error, 'Alert summary retrieval');
    }
});

module.exports = {
    router,
    initializeWatchdog
};
