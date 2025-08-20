const winston = require('winston');
const axios = require('axios');

class DogecoinWatchdog {
    constructor(rpcConfig, logger) {
        this.rpc = rpcConfig;
        this.logger = logger;
        this.alerts = [];
        this.metrics = {
            hashRate: [],
            difficulty: [],
            blockTimes: [],
            networkNodes: [],
            mempool: [],
            orphanBlocks: 0
        };
        
        // Attack detection thresholds
        this.thresholds = {
            hashRateSpike: 5.0,      // 5x normal hash rate increase
            hashRateDrop: 0.3,       // 70% hash rate drop
            blockTimeAnomaly: 3.0,   // 3x normal block time variance
            difficultySpike: 3.0,    // 3x difficulty increase
            mempoolFlood: 10000,     // 10k+ pending transactions
            lowNodeCount: 50,        // Fewer than 50 nodes
            orphanBlockThreshold: 5   // 5+ orphan blocks in window
        };
        
        // Historical baselines (updated dynamically)
        this.baselines = {
            avgHashRate: null,
            avgBlockTime: 60, // 1 minute for Dogecoin
            avgDifficulty: null,
            avgMempoolSize: null
        };
        
        this.isMonitoring = false;
        this.monitoringInterval = null;
    }

    async startMonitoring() {
        if (this.isMonitoring) return;
        
        this.logger.info('🔍 Starting Dogecoin network watchdog...');
        this.isMonitoring = true;
        
        // Initial baseline calculation
        await this.calculateBaselines();
        
        // Start monitoring loop - check every 30 seconds
        this.monitoringInterval = setInterval(async () => {
            try {
                await this.performSecurityChecks();
            } catch (error) {
                this.logger.error('Watchdog monitoring error:', error);
            }
        }, 30000);
        
        this.logger.info('✅ Dogecoin network watchdog started');
    }

    stopMonitoring() {
        if (!this.isMonitoring) return;
        
        this.isMonitoring = false;
        if (this.monitoringInterval) {
            clearInterval(this.monitoringInterval);
            this.monitoringInterval = null;
        }
        
        this.logger.info('🛑 Dogecoin network watchdog stopped');
    }

    async calculateBaselines() {
        try {
            this.logger.info('📊 Calculating network baselines...');
            
            // Wait for node to be ready with retry logic
            let retries = 0;
            const maxRetries = 10;
            let nodeReady = false;
            
            while (!nodeReady && retries < maxRetries) {
                try {
                    await this.rpcCall('getblockchaininfo');
                    nodeReady = true;
                } catch (error) {
                    retries++;
                    this.logger.info(`Waiting for Dogecoin node to be ready... (attempt ${retries}/${maxRetries})`);
                    await new Promise(resolve => setTimeout(resolve, 3000)); // Wait 3 seconds
                }
            }
            
            if (!nodeReady) {
                throw new Error('Dogecoin node not ready after maximum retries');
            }
            
            // Get blockchain info for difficulty and hash rate
            const blockchainInfo = await this.rpcCall('getblockchaininfo');
            const networkInfo = await this.rpcCall('getnetworkinfo');
            const mempoolInfo = await this.rpcCall('getmempoolinfo');
            
            // Calculate network hash rate from difficulty
            const hashRate = this.calculateHashRate(blockchainInfo.difficulty);
            
            // Get recent block times
            const recentBlocks = await this.rpcCall('getblockcount');
            const blockTimes = await this.getRecentBlockTimes(recentBlocks, 100);
            
            this.baselines = {
                avgHashRate: hashRate,
                avgBlockTime: this.calculateAverage(blockTimes),
                avgDifficulty: blockchainInfo.difficulty,
                avgMempoolSize: mempoolInfo.size
            };
            
            this.logger.info('📈 Baselines calculated:', this.baselines);
            
        } catch (error) {
            this.logger.error('Failed to calculate baselines:', error.message);
            // Don't throw here to allow monitoring to continue
        }
    }

    async performSecurityChecks() {
        const timestamp = new Date();
        const checks = [];
        
        try {
            // Gather current network state
            const [blockchainInfo, networkInfo, mempoolInfo, peerInfo] = await Promise.all([
                this.rpcCall('getblockchaininfo'),
                this.rpcCall('getnetworkinfo'),
                this.rpcCall('getmempoolinfo'),
                this.rpcCall('getpeerinfo')
            ]);

            // 1. Hash Rate Monitoring
            const currentHashRate = this.calculateHashRate(blockchainInfo.difficulty);
            checks.push(await this.checkHashRateAnomaly(currentHashRate, timestamp));

            // 2. Difficulty Monitoring  
            checks.push(await this.checkDifficultyAnomaly(blockchainInfo.difficulty, timestamp));

            // 3. Block Time Monitoring
            checks.push(await this.checkBlockTimeAnomaly(blockchainInfo.blocks, timestamp));

            // 4. Mempool Monitoring
            checks.push(await this.checkMempoolAnomaly(mempoolInfo, timestamp));

            // 5. Network Node Monitoring
            checks.push(await this.checkNetworkNodeAnomaly(networkInfo.connections, peerInfo, timestamp));

            // 6. Orphan Block Monitoring
            checks.push(await this.checkOrphanBlocks(blockchainInfo.blocks, timestamp));

            // 7. Fork Detection
            checks.push(await this.checkForForks(blockchainInfo, timestamp));

            // Process alerts
            const activeAlerts = checks.filter(check => check.alert);
            if (activeAlerts.length > 0) {
                this.processAlerts(activeAlerts, timestamp);
            }

            // Update metrics
            this.updateMetrics(currentHashRate, blockchainInfo.difficulty, mempoolInfo, timestamp);

        } catch (error) {
            this.logger.error('Security check failed:', error);
            this.addAlert('SYSTEM_ERROR', 'CRITICAL', 'Watchdog system error: ' + error.message, timestamp);
        }
    }

    async checkHashRateAnomaly(currentHashRate, timestamp) {
        if (!this.baselines.avgHashRate) return { alert: false };

        const ratio = currentHashRate / this.baselines.avgHashRate;
        
        if (ratio >= this.thresholds.hashRateSpike) {
            return {
                alert: true,
                type: 'HASH_RATE_SPIKE',
                severity: 'CRITICAL',
                message: `⚠️ HASH RATE SPIKE DETECTED! Current: ${this.formatHashRate(currentHashRate)}, Baseline: ${this.formatHashRate(this.baselines.avgHashRate)}, Ratio: ${ratio.toFixed(2)}x`,
                data: { currentHashRate, baselineHashRate: this.baselines.avgHashRate, ratio }
            };
        }
        
        if (ratio <= this.thresholds.hashRateDrop) {
            return {
                alert: true,
                type: 'HASH_RATE_DROP',
                severity: 'HIGH',
                message: `⚠️ HASH RATE DROP DETECTED! Current: ${this.formatHashRate(currentHashRate)}, Baseline: ${this.formatHashRate(this.baselines.avgHashRate)}, Ratio: ${ratio.toFixed(2)}x`,
                data: { currentHashRate, baselineHashRate: this.baselines.avgHashRate, ratio }
            };
        }

        return { alert: false };
    }

    async checkDifficultyAnomaly(currentDifficulty, timestamp) {
        if (!this.baselines.avgDifficulty) return { alert: false };

        const ratio = currentDifficulty / this.baselines.avgDifficulty;
        
        if (ratio >= this.thresholds.difficultySpike) {
            return {
                alert: true,
                type: 'DIFFICULTY_SPIKE',
                severity: 'HIGH',
                message: `⚠️ DIFFICULTY SPIKE DETECTED! Current: ${currentDifficulty.toFixed(2)}, Baseline: ${this.baselines.avgDifficulty.toFixed(2)}, Ratio: ${ratio.toFixed(2)}x`,
                data: { currentDifficulty, baselineDifficulty: this.baselines.avgDifficulty, ratio }
            };
        }

        return { alert: false };
    }

    async checkBlockTimeAnomaly(currentBlock, timestamp) {
        try {
            // Get last 10 blocks for recent timing analysis
            const recentBlockTimes = await this.getRecentBlockTimes(currentBlock, 10);
            const avgRecentBlockTime = this.calculateAverage(recentBlockTimes);
            
            const ratio = Math.abs(avgRecentBlockTime - this.baselines.avgBlockTime) / this.baselines.avgBlockTime;
            
            if (ratio >= this.thresholds.blockTimeAnomaly) {
                return {
                    alert: true,
                    type: 'BLOCK_TIME_ANOMALY',
                    severity: 'MEDIUM',
                    message: `⚠️ BLOCK TIME ANOMALY! Recent avg: ${avgRecentBlockTime.toFixed(1)}s, Normal: ${this.baselines.avgBlockTime.toFixed(1)}s`,
                    data: { recentBlockTime: avgRecentBlockTime, normalBlockTime: this.baselines.avgBlockTime, ratio }
                };
            }
        } catch (error) {
            this.logger.error('Block time check failed:', error);
        }

        return { alert: false };
    }

    async checkMempoolAnomaly(mempoolInfo, timestamp) {
        if (mempoolInfo.size >= this.thresholds.mempoolFlood) {
            return {
                alert: true,
                type: 'MEMPOOL_FLOOD',
                severity: 'HIGH',
                message: `⚠️ MEMPOOL FLOOD DETECTED! ${mempoolInfo.size} pending transactions (threshold: ${this.thresholds.mempoolFlood})`,
                data: { mempoolSize: mempoolInfo.size, threshold: this.thresholds.mempoolFlood }
            };
        }

        return { alert: false };
    }

    async checkNetworkNodeAnomaly(connections, peerInfo, timestamp) {
        if (connections < this.thresholds.lowNodeCount) {
            return {
                alert: true,
                type: 'LOW_NODE_COUNT',
                severity: 'MEDIUM',
                message: `⚠️ LOW NODE COUNT! Only ${connections} connections (threshold: ${this.thresholds.lowNodeCount})`,
                data: { connections, threshold: this.thresholds.lowNodeCount }
            };
        }

        // Check for suspicious peer patterns
        const suspiciousPeers = this.analyzePeerPatterns(peerInfo);
        if (suspiciousPeers.length > 0) {
            return {
                alert: true,
                type: 'SUSPICIOUS_PEERS',
                severity: 'HIGH',
                message: `⚠️ SUSPICIOUS PEER ACTIVITY! ${suspiciousPeers.length} suspicious connections detected`,
                data: { suspiciousPeers }
            };
        }

        return { alert: false };
    }

    async checkOrphanBlocks(currentBlock, timestamp) {
        // This would require more sophisticated tracking of orphan blocks
        // For now, we'll implement a placeholder
        return { alert: false };
    }

    async checkForForks(blockchainInfo, timestamp) {
        // Check if we're behind other nodes (potential fork indicator)
        if (blockchainInfo.headers > blockchainInfo.blocks + 5) {
            return {
                alert: true,
                type: 'POTENTIAL_FORK',
                severity: 'HIGH',
                message: `⚠️ POTENTIAL FORK! Headers: ${blockchainInfo.headers}, Blocks: ${blockchainInfo.blocks}`,
                data: { headers: blockchainInfo.headers, blocks: blockchainInfo.blocks }
            };
        }

        return { alert: false };
    }

    analyzePeerPatterns(peerInfo) {
        const suspicious = [];
        
        // Look for peers with suspicious characteristics
        peerInfo.forEach(peer => {
            // Multiple connections from same subnet
            // High byte ratios (potential attack traffic)
            // Very new connections with high activity
            
            if (peer.bytessent > 1000000 && peer.bytesrecv < 100000) {
                suspicious.push({
                    addr: peer.addr,
                    reason: 'High outbound, low inbound traffic',
                    bytessent: peer.bytessent,
                    bytesrecv: peer.bytesrecv
                });
            }
        });
        
        return suspicious;
    }

    processAlerts(alerts, timestamp) {
        alerts.forEach(alert => {
            this.addAlert(alert.type, alert.severity, alert.message, timestamp, alert.data);
        });
    }

    addAlert(type, severity, message, timestamp, data = null) {
        const alert = {
            id: Date.now() + Math.random(),
            type,
            severity,
            message,
            timestamp,
            data,
            acknowledged: false
        };
        
        this.alerts.unshift(alert);
        
        // Keep only last 100 alerts
        if (this.alerts.length > 100) {
            this.alerts = this.alerts.slice(0, 100);
        }
        
        this.logger.warn(`WATCHDOG ALERT [${severity}] ${type}: ${message}`);
        
        // TODO: Add external notification (webhook, email, etc.)
        this.notifyExternal(alert);
    }

    async notifyExternal(alert) {
        // Placeholder for external notifications
        // Could send to Discord, Slack, email, etc.
        console.log(`🚨 ALERT: ${alert.message}`);
    }

    updateMetrics(hashRate, difficulty, mempoolInfo, timestamp) {
        // Update rolling metrics for trending analysis
        this.metrics.hashRate.push({ value: hashRate, timestamp });
        this.metrics.difficulty.push({ value: difficulty, timestamp });
        this.metrics.mempool.push({ value: mempoolInfo.size, timestamp });
        
        // Keep only last 1000 data points
        Object.keys(this.metrics).forEach(key => {
            if (Array.isArray(this.metrics[key]) && this.metrics[key].length > 1000) {
                this.metrics[key] = this.metrics[key].slice(-1000);
            }
        });
    }

    // Utility methods
    calculateHashRate(difficulty) {
        // Dogecoin hash rate calculation: difficulty * 2^32 / 60 (target block time)
        return (difficulty * Math.pow(2, 32)) / 60;
    }

    formatHashRate(hashRate) {
        if (hashRate >= 1e12) return `${(hashRate / 1e12).toFixed(2)} TH/s`;
        if (hashRate >= 1e9) return `${(hashRate / 1e9).toFixed(2)} GH/s`;
        if (hashRate >= 1e6) return `${(hashRate / 1e6).toFixed(2)} MH/s`;
        return `${hashRate.toFixed(2)} H/s`;
    }

    async getRecentBlockTimes(currentBlock, count) {
        const blockTimes = [];
        
        for (let i = 0; i < count - 1; i++) {
            try {
                const blockHash1 = await this.rpcCall('getblockhash', [currentBlock - i]);
                const blockHash2 = await this.rpcCall('getblockhash', [currentBlock - i - 1]);
                
                const block1 = await this.rpcCall('getblock', [blockHash1]);
                const block2 = await this.rpcCall('getblock', [blockHash2]);
                
                blockTimes.push(block1.time - block2.time);
            } catch (error) {
                this.logger.error(`Failed to get block time for block ${currentBlock - i}:`, error);
            }
        }
        
        return blockTimes;
    }

    calculateAverage(values) {
        if (!values.length) return 0;
        return values.reduce((sum, val) => sum + val, 0) / values.length;
    }

    async rpcCall(method, params = []) {
        try {
            // Get current authentication credentials
            const auth = this.rpc.getAuth ? this.rpc.getAuth() : {
                username: this.rpc.user,
                password: this.rpc.password
            };
            
            const response = await axios.post(`http://localhost:${this.rpc.port}`, {
                jsonrpc: '1.0',
                id: 'watchdog',
                method: method,
                params: params
            }, {
                auth: {
                    username: auth.username,
                    password: auth.password
                },
                timeout: 30000
            });

            if (response.data.error) {
                throw new Error(`RPC Error: ${response.data.error.message}`);
            }

            return response.data.result;
        } catch (error) {
            this.logger.error(`RPC call ${method} failed:`, error.message);
            throw error;
        }
    }

    // Public API methods
    getStatus() {
        return {
            isMonitoring: this.isMonitoring,
            alertCount: this.alerts.length,
            recentAlerts: this.alerts.slice(0, 10),
            baselines: this.baselines,
            thresholds: this.thresholds
        };
    }

    getAlerts(limit = 50) {
        return this.alerts.slice(0, limit);
    }

    acknowledgeAlert(alertId) {
        const alert = this.alerts.find(a => a.id === alertId);
        if (alert) {
            alert.acknowledged = true;
            this.logger.info(`Alert acknowledged: ${alert.type}`);
            return true;
        }
        return false;
    }

    getMetrics() {
        return {
            ...this.metrics,
            summary: {
                currentHashRate: this.metrics.hashRate.length > 0 ? this.metrics.hashRate[this.metrics.hashRate.length - 1].value : null,
                hashRateTrend: this.calculateTrend(this.metrics.hashRate),
                difficultyTrend: this.calculateTrend(this.metrics.difficulty)
            }
        };
    }

    calculateTrend(dataPoints) {
        if (dataPoints.length < 2) return 0;
        
        const recent = dataPoints.slice(-10);
        const first = recent[0].value;
        const last = recent[recent.length - 1].value;
        
        return ((last - first) / first) * 100; // Percentage change
    }
}

module.exports = DogecoinWatchdog;
