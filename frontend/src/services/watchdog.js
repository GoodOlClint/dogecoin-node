/**
 * Dogecoin Security Watchdog Service
 * Monitors the Dogecoin network for security threats and anomalies
 */

const EventEmitter = require('events');
const config = require('../config');
const { createChildLogger } = require('../utils/logger');
const { DogecoinRPCService, RPCError } = require('./rpc');

class DogecoinWatchdog extends EventEmitter {
    constructor(rpcService = null) {
        super();
        
        this.rpc = rpcService || new DogecoinRPCService();
        this.logger = createChildLogger({ service: 'watchdog' });
        
        // State management
        this.isMonitoring = false;
        this.monitoringInterval = null;
        this.alerts = [];
        this.metrics = this.initializeMetrics();
        this.baselines = this.initializeBaselines();
        this.thresholds = config.watchdog.thresholds;
        
        // Bind methods to preserve context
        this.performSecurityChecks = this.performSecurityChecks.bind(this);
    }

    /**
     * Initializes the metrics storage structure
     * @returns {Object} Initial metrics object
     */
    initializeMetrics() {
        return {
            hashRate: [],
            difficulty: [],
            blockTimes: [],
            networkNodes: [],
            mempool: [],
            orphanBlocks: 0
        };
    }

    /**
     * Initializes the baselines structure
     * @returns {Object} Initial baselines object
     */
    initializeBaselines() {
        return {
            avgHashRate: null,
            avgBlockTime: 60, // 1 minute for Dogecoin
            avgDifficulty: null,
            avgMempoolSize: null,
            lastCalculated: null
        };
    }

    /**
     * Starts the security monitoring
     * @returns {Promise<void>}
     */
    async startMonitoring() {
        if (this.isMonitoring) {
            this.logger.warn('Watchdog already monitoring');
            return;
        }

        if (!config.watchdog.enabled) {
            this.logger.info('Watchdog disabled in configuration');
            return;
        }

        this.logger.info('🔍 Starting Dogecoin network watchdog...');
        this.isMonitoring = true;

        try {
            // Calculate initial baselines
            await this.calculateBaselines();

            // Start monitoring loop
            this.monitoringInterval = setInterval(
                this.performSecurityChecks,
                config.watchdog.monitoringInterval
            );

            this.logger.info('✅ Dogecoin network watchdog started');
            this.emit('started');

        } catch (error) {
            this.logger.error('Failed to start watchdog', { error: error.message });
            this.isMonitoring = false;
            this.emit('error', error);
            throw error;
        }
    }

    /**
     * Stops the security monitoring
     */
    stopMonitoring() {
        if (!this.isMonitoring) {
            this.logger.warn('Watchdog not currently monitoring');
            return;
        }

        this.isMonitoring = false;
        
        if (this.monitoringInterval) {
            clearInterval(this.monitoringInterval);
            this.monitoringInterval = null;
        }

        this.logger.info('🛑 Dogecoin network watchdog stopped');
        this.emit('stopped');
    }

    /**
     * Calculates network baselines for anomaly detection
     * @returns {Promise<void>}
     */
    async calculateBaselines() {
        this.logger.info('📊 Calculating network baselines...');

        try {
            // Wait for node to be ready
            await this.waitForNodeReady();

            // Get current network state
            const nodeInfo = await this.rpc.getNodeInfo();
            const peerInfo = await this.rpc.call('getpeerinfo');

            // Calculate hash rate from difficulty
            const hashRate = this.calculateHashRate(nodeInfo.blockchain.difficulty);

            // Get recent block times
            const blockTimes = await this.getRecentBlockTimes(nodeInfo.blockchain.blocks, 100);

            // Update baselines
            this.baselines = {
                avgHashRate: hashRate,
                avgBlockTime: this.calculateAverage(blockTimes),
                avgDifficulty: nodeInfo.blockchain.difficulty,
                avgMempoolSize: nodeInfo.mempool.size,
                lastCalculated: new Date().toISOString()
            };

            this.logger.info('📈 Baselines calculated', this.baselines);

        } catch (error) {
            this.logger.error('Failed to calculate baselines', { error: error.message });
            // Don't throw here to allow monitoring to continue with default values
        }
    }

    /**
     * Waits for the Dogecoin node to be ready
     * @returns {Promise<void>}
     */
    async waitForNodeReady() {
        const maxRetries = config.watchdog.maxBaselineRetries;
        const retryDelay = config.watchdog.baselineRetryDelay;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                await this.rpc.call('getblockchaininfo');
                this.logger.debug('Node is ready');
                return;
            } catch (error) {
                if (attempt === maxRetries) {
                    throw new Error(`Dogecoin node not ready after ${maxRetries} attempts`);
                }

                this.logger.info(`Waiting for Dogecoin node to be ready... (attempt ${attempt}/${maxRetries})`);
                await new Promise(resolve => setTimeout(resolve, retryDelay));
            }
        }
    }

    /**
     * Performs comprehensive security checks
     * @returns {Promise<void>}
     */
    async performSecurityChecks() {
        if (!this.isMonitoring) return;

        try {
            this.logger.debug('Performing security checks...');

            // Gather current network data
            const [blockchainInfo, networkInfo, mempoolInfo, peerInfo] = await Promise.all([
                this.rpc.call('getblockchaininfo'),
                this.rpc.call('getnetworkinfo'),
                this.rpc.call('getmempoolinfo'),
                this.rpc.call('getpeerinfo')
            ]);

            const currentData = {
                blockchain: blockchainInfo,
                network: networkInfo,
                mempool: mempoolInfo,
                peers: peerInfo,
                timestamp: new Date().toISOString()
            };

            // Update metrics
            this.updateMetrics(currentData);

            // Perform security analysis
            await this.analyzeSecurityThreats(currentData);

            // Emit update event
            this.emit('update', {
                status: this.getOverallStatus(),
                metrics: this.getRecentMetrics(),
                alerts: this.getRecentAlerts()
            });

        } catch (error) {
            if (error instanceof RPCError) {
                this.createAlert('SYSTEM_ERROR', 'CRITICAL', `Watchdog system error: ${error.message}`, {
                    method: error.method,
                    code: error.code
                });
            } else {
                this.logger.error('Security check failed', { error: error.message });
                this.createAlert('SYSTEM_ERROR', 'CRITICAL', `Watchdog system error: ${error.message}`);
            }
        }
    }

    /**
     * Updates metrics with current data
     * @param {Object} currentData - Current network data
     */
    updateMetrics(currentData) {
        const maxDataPoints = 100; // Keep last 100 data points

        // Update hash rate
        const hashRate = this.calculateHashRate(currentData.blockchain.difficulty);
        this.metrics.hashRate.push({
            value: hashRate,
            timestamp: currentData.timestamp
        });
        this.metrics.hashRate = this.metrics.hashRate.slice(-maxDataPoints);

        // Update difficulty
        this.metrics.difficulty.push({
            value: currentData.blockchain.difficulty,
            timestamp: currentData.timestamp
        });
        this.metrics.difficulty = this.metrics.difficulty.slice(-maxDataPoints);

        // Update mempool
        this.metrics.mempool.push({
            value: currentData.mempool.size,
            timestamp: currentData.timestamp
        });
        this.metrics.mempool = this.metrics.mempool.slice(-maxDataPoints);

        // Update network nodes
        this.metrics.networkNodes.push({
            value: currentData.peers.length,
            timestamp: currentData.timestamp
        });
        this.metrics.networkNodes = this.metrics.networkNodes.slice(-maxDataPoints);
    }

    /**
     * Analyzes current data for security threats
     * @param {Object} currentData - Current network data
     * @returns {Promise<void>}
     */
    async analyzeSecurityThreats(currentData) {
        // Check for low node count
        this.checkLowNodeCount(currentData.peers.length);

        // Check for mempool flooding
        this.checkMempoolFlooding(currentData.mempool.size);

        // Check hash rate anomalies
        if (this.baselines.avgHashRate) {
            this.checkHashRateAnomalies(currentData.blockchain.difficulty);
        }

        // Check difficulty spikes
        if (this.baselines.avgDifficulty) {
            this.checkDifficultySpikes(currentData.blockchain.difficulty);
        }

        // Check for potential 51% attacks
        await this.check51PercentAttack(currentData);
    }

    /**
     * Checks for low node count
     * @param {number} nodeCount - Current node count
     */
    checkLowNodeCount(nodeCount) {
        if (nodeCount < this.thresholds.lowNodeCount) {
            this.createAlert(
                'LOW_NODE_COUNT',
                'MEDIUM',
                `⚠️ LOW NODE COUNT! Only ${nodeCount} connections (threshold: ${this.thresholds.lowNodeCount})`,
                { nodeCount, threshold: this.thresholds.lowNodeCount }
            );
        }
    }

    /**
     * Checks for mempool flooding attacks
     * @param {number} mempoolSize - Current mempool size
     */
    checkMempoolFlooding(mempoolSize) {
        if (mempoolSize > this.thresholds.mempoolFlood) {
            this.createAlert(
                'MEMPOOL_FLOOD',
                'HIGH',
                `🚨 MEMPOOL FLOODING DETECTED! ${mempoolSize} pending transactions (threshold: ${this.thresholds.mempoolFlood})`,
                { mempoolSize, threshold: this.thresholds.mempoolFlood }
            );
        }
    }

    /**
     * Checks for hash rate anomalies
     * @param {number} currentDifficulty - Current network difficulty
     */
    checkHashRateAnomalies(currentDifficulty) {
        const currentHashRate = this.calculateHashRate(currentDifficulty);
        const baselineHashRate = this.baselines.avgHashRate;

        const ratio = currentHashRate / baselineHashRate;

        if (ratio > this.thresholds.hashRateSpike) {
            this.createAlert(
                'HASH_RATE_SPIKE',
                'CRITICAL',
                `🚨 MASSIVE HASH RATE SPIKE! ${ratio.toFixed(2)}x increase detected (${currentHashRate.toFixed(2)} TH/s vs ${baselineHashRate.toFixed(2)} TH/s baseline)`,
                {
                    currentHashRate,
                    baselineHashRate,
                    ratio,
                    threshold: this.thresholds.hashRateSpike
                }
            );
        } else if (ratio < this.thresholds.hashRateDrop) {
            this.createAlert(
                'HASH_RATE_DROP',
                'HIGH',
                `⚠️ SIGNIFICANT HASH RATE DROP! ${(ratio * 100).toFixed(1)}% of baseline (${currentHashRate.toFixed(2)} TH/s vs ${baselineHashRate.toFixed(2)} TH/s baseline)`,
                {
                    currentHashRate,
                    baselineHashRate,
                    ratio,
                    threshold: this.thresholds.hashRateDrop
                }
            );
        }
    }

    /**
     * Checks for difficulty spikes
     * @param {number} currentDifficulty - Current network difficulty
     */
    checkDifficultySpikes(currentDifficulty) {
        const baselineDifficulty = this.baselines.avgDifficulty;
        const ratio = currentDifficulty / baselineDifficulty;

        if (ratio > this.thresholds.difficultySpike) {
            this.createAlert(
                'DIFFICULTY_SPIKE',
                'HIGH',
                `⚠️ DIFFICULTY SPIKE DETECTED! ${ratio.toFixed(2)}x increase (${currentDifficulty.toFixed(2)} vs ${baselineDifficulty.toFixed(2)} baseline)`,
                {
                    currentDifficulty,
                    baselineDifficulty,
                    ratio,
                    threshold: this.thresholds.difficultySpike
                }
            );
        }
    }

    /**
     * Checks for potential 51% attacks
     * @param {Object} currentData - Current network data
     * @returns {Promise<void>}
     */
    async check51PercentAttack(currentData) {
        try {
            // Get recent blocks for analysis
            const recentBlocks = await this.getRecentBlocks(currentData.blockchain.blocks, 10);
            
            // Analyze block time distribution
            const blockTimes = recentBlocks.map((block, index) => {
                if (index === 0) return null;
                return block.time - recentBlocks[index - 1].time;
            }).filter(time => time !== null);

            const avgBlockTime = this.calculateAverage(blockTimes);
            const expectedBlockTime = this.baselines.avgBlockTime;

            if (avgBlockTime < expectedBlockTime * 0.5) {
                this.createAlert(
                    'RAPID_BLOCK_GENERATION',
                    'CRITICAL',
                    `🚨 RAPID BLOCK GENERATION! Potential 51% attack - blocks generated ${expectedBlockTime / avgBlockTime}x faster than normal`,
                    {
                        avgBlockTime,
                        expectedBlockTime,
                        recentBlocks: recentBlocks.length,
                        suspiciousRatio: expectedBlockTime / avgBlockTime
                    }
                );
            }

        } catch (error) {
            this.logger.error('Failed to check for 51% attack', { error: error.message });
        }
    }

    /**
     * Creates a new security alert
     * @param {string} type - Alert type
     * @param {string} severity - Alert severity (LOW, MEDIUM, HIGH, CRITICAL)
     * @param {string} message - Alert message
     * @param {Object} data - Additional alert data
     */
    createAlert(type, severity, message, data = {}) {
        const alert = {
            id: this.generateAlertId(),
            type,
            severity,
            message,
            data,
            timestamp: new Date().toISOString(),
            acknowledged: false
        };

        this.alerts.unshift(alert);
        this.alerts = this.alerts.slice(0, 1000); // Keep last 1000 alerts

        this.logger.warn(`WATCHDOG ALERT [${severity}] ${type}: ${message}`);
        console.log(`🚨 ALERT: ${message}`);

        this.emit('alert', alert);
    }

    /**
     * Generates a unique alert ID
     * @returns {string} Unique alert ID
     */
    generateAlertId() {
        return `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Calculates hash rate from difficulty
     * @param {number} difficulty - Network difficulty
     * @returns {number} Hash rate in TH/s
     */
    calculateHashRate(difficulty) {
        // Dogecoin hash rate calculation
        const hashesPerSecond = difficulty * Math.pow(2, 32) / 60;
        return hashesPerSecond / Math.pow(10, 12); // Convert to TH/s
    }

    /**
     * Gets recent block times
     * @param {number} currentBlock - Current block height
     * @param {number} count - Number of blocks to analyze
     * @returns {Promise<Array>} Array of block times
     */
    async getRecentBlockTimes(currentBlock, count) {
        const blockTimes = [];
        
        for (let i = 0; i < Math.min(count, 10); i++) { // Limit to prevent too many RPC calls
            try {
                const blockHash1 = await this.rpc.call('getblockhash', [currentBlock - i]);
                const blockHash2 = await this.rpc.call('getblockhash', [currentBlock - i - 1]);
                
                const block1 = await this.rpc.call('getblock', [blockHash1]);
                const block2 = await this.rpc.call('getblock', [blockHash2]);
                
                blockTimes.push(block1.time - block2.time);
            } catch (error) {
                this.logger.error('Failed to get block time', { blockHeight: currentBlock - i, error: error.message });
                break;
            }
        }
        
        return blockTimes;
    }

    /**
     * Gets recent blocks for analysis
     * @param {number} currentBlock - Current block height
     * @param {number} count - Number of blocks to retrieve
     * @returns {Promise<Array>} Array of block data
     */
    async getRecentBlocks(currentBlock, count) {
        const blocks = [];
        
        for (let i = 0; i < Math.min(count, 10); i++) {
            try {
                const blockHash = await this.rpc.call('getblockhash', [currentBlock - i]);
                const block = await this.rpc.call('getblock', [blockHash]);
                blocks.push(block);
            } catch (error) {
                this.logger.error('Failed to get block', { blockHeight: currentBlock - i, error: error.message });
                break;
            }
        }
        
        return blocks;
    }

    /**
     * Calculates average of an array of numbers
     * @param {Array<number>} values - Array of numbers
     * @returns {number} Average value
     */
    calculateAverage(values) {
        if (!values.length) return 0;
        return values.reduce((sum, val) => sum + val, 0) / values.length;
    }

    /**
     * Gets the overall security status
     * @returns {string} Overall status
     */
    getOverallStatus() {
        if (!this.isMonitoring) return 'OFFLINE';
        
        const recentAlerts = this.getRecentAlerts(10);
        const criticalAlerts = recentAlerts.filter(a => a.severity === 'CRITICAL' && !a.acknowledged);
        
        if (criticalAlerts.length > 0) return 'CRITICAL_ALERT';
        
        const highAlerts = recentAlerts.filter(a => a.severity === 'HIGH' && !a.acknowledged);
        if (highAlerts.length > 0) return 'HIGH_ALERT';
        
        const mediumAlerts = recentAlerts.filter(a => a.severity === 'MEDIUM' && !a.acknowledged);
        if (mediumAlerts.length > 0) return 'MEDIUM_ALERT';
        
        return 'SECURE';
    }

    /**
     * Gets recent alerts
     * @param {number} limit - Maximum number of alerts to return
     * @returns {Array} Recent alerts
     */
    getRecentAlerts(limit = 50) {
        return this.alerts.slice(0, limit);
    }

    /**
     * Gets recent metrics for dashboard display
     * @returns {Object} Recent metrics
     */
    getRecentMetrics() {
        const getRecent = (arr, count = 10) => arr.slice(-count);
        
        return {
            hashRate: getRecent(this.metrics.hashRate),
            difficulty: getRecent(this.metrics.difficulty),
            mempool: getRecent(this.metrics.mempool),
            networkNodes: getRecent(this.metrics.networkNodes),
            summary: {
                currentHashRate: this.metrics.hashRate.length > 0 
                    ? this.metrics.hashRate[this.metrics.hashRate.length - 1].value 
                    : null,
                hashRateTrend: this.calculateTrend(this.metrics.hashRate),
                difficultyTrend: this.calculateTrend(this.metrics.difficulty)
            }
        };
    }

    /**
     * Calculates trend for metrics
     * @param {Array} dataPoints - Array of data points with value and timestamp
     * @returns {number} Trend percentage
     */
    calculateTrend(dataPoints) {
        if (dataPoints.length < 2) return 0;
        
        const recent = dataPoints.slice(-10);
        const first = recent[0].value;
        const last = recent[recent.length - 1].value;
        
        return ((last - first) / first) * 100;
    }

    /**
     * Acknowledges an alert
     * @param {string} alertId - Alert ID to acknowledge
     * @returns {boolean} True if alert was found and acknowledged
     */
    acknowledgeAlert(alertId) {
        const alert = this.alerts.find(a => a.id === alertId);
        if (alert) {
            alert.acknowledged = true;
            this.logger.info(`Alert acknowledged: ${alert.type}`);
            this.emit('alertAcknowledged', alert);
            return true;
        }
        return false;
    }

    /**
     * Gets current watchdog status
     * @returns {Object} Watchdog status
     */
    getStatus() {
        return {
            isMonitoring: this.isMonitoring,
            status: this.getOverallStatus(),
            alertCount: this.alerts.length,
            recentAlerts: this.getRecentAlerts(10),
            baselines: this.baselines,
            thresholds: this.thresholds,
            lastUpdate: new Date().toISOString()
        };
    }

    /**
     * Gets all watchdog metrics
     * @returns {Object} All metrics and status
     */
    getMetrics() {
        return {
            ...this.getRecentMetrics(),
            status: this.getStatus()
        };
    }
}

module.exports = DogecoinWatchdog;
