const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// The watchdog service accepts an RPC service via constructor injection,
// so we can test it with a mock RPC service without needing module mocking.
const DogecoinWatchdog = require('../src/services/watchdog');

/**
 * Creates a mock RPC service for testing.
 */
function createMockRPC(overrides = {}) {
    return {
        call: async (method) => {
            throw new Error(`Unmocked RPC call: ${method}`);
        },
        testConnection: async () => true,
        getNodeInfo: async () => ({
            blockchain: { blocks: 5000000, headers: 5000000, difficulty: 10000, bestblockhash: 'abc123' },
            network: { version: 1140700, connections: 20, networkhashps: 500e12 },
            mempool: { size: 50, bytes: 10000 }
        }),
        getChainTips: async () => [],
        getMempoolInfo: async () => ({ size: 50, bytes: 10000 }),
        getNetworkHashPS: async () => 500e12,
        ...overrides
    };
}

describe('DogecoinWatchdog', () => {

    describe('calculateHashRate', () => {
        it('converts difficulty to TH/s correctly', () => {
            const watchdog = new DogecoinWatchdog(createMockRPC());
            const result = watchdog.calculateHashRate(10000);
            const expected = (10000 * Math.pow(2, 32) / 60) / Math.pow(10, 12);
            assert.equal(result, expected);
        });

        it('returns 0 for zero difficulty', () => {
            const watchdog = new DogecoinWatchdog(createMockRPC());
            assert.equal(watchdog.calculateHashRate(0), 0);
        });

        it('handles very large difficulty values', () => {
            const watchdog = new DogecoinWatchdog(createMockRPC());
            const result = watchdog.calculateHashRate(1e15);
            assert.ok(result > 0);
            assert.ok(Number.isFinite(result));
        });
    });

    describe('calculateAverage', () => {
        it('returns average of numeric array', () => {
            const watchdog = new DogecoinWatchdog(createMockRPC());
            assert.equal(watchdog.calculateAverage([10, 20, 30]), 20);
        });

        it('returns 0 for empty array', () => {
            const watchdog = new DogecoinWatchdog(createMockRPC());
            assert.equal(watchdog.calculateAverage([]), 0);
        });

        it('handles single element', () => {
            const watchdog = new DogecoinWatchdog(createMockRPC());
            assert.equal(watchdog.calculateAverage([42]), 42);
        });
    });

    describe('calculateTrend', () => {
        it('returns positive trend for increasing values', () => {
            const watchdog = new DogecoinWatchdog(createMockRPC());
            const dataPoints = [
                { value: 100, timestamp: '2024-01-01' },
                { value: 150, timestamp: '2024-01-02' }
            ];
            assert.equal(watchdog.calculateTrend(dataPoints), 50);
        });

        it('returns negative trend for decreasing values', () => {
            const watchdog = new DogecoinWatchdog(createMockRPC());
            const dataPoints = [
                { value: 200, timestamp: '2024-01-01' },
                { value: 100, timestamp: '2024-01-02' }
            ];
            assert.equal(watchdog.calculateTrend(dataPoints), -50);
        });

        it('returns 0 for fewer than 2 data points', () => {
            const watchdog = new DogecoinWatchdog(createMockRPC());
            assert.equal(watchdog.calculateTrend([]), 0);
            assert.equal(watchdog.calculateTrend([{ value: 100 }]), 0);
        });

        it('uses only the last 10 data points', () => {
            const watchdog = new DogecoinWatchdog(createMockRPC());
            const dataPoints = Array.from({ length: 20 }, (_, i) => ({
                value: i + 1,
                timestamp: `2024-01-${i + 1}`
            }));
            const expected = ((20 - 11) / 11) * 100;
            assert.ok(Math.abs(watchdog.calculateTrend(dataPoints) - expected) < 0.001);
        });
    });

    describe('checkLowNodeCount', () => {
        it('creates alert when node count below threshold', () => {
            const watchdog = new DogecoinWatchdog(createMockRPC());
            watchdog.checkLowNodeCount(3);
            assert.equal(watchdog.alerts.length, 1);
            assert.equal(watchdog.alerts[0].type, 'LOW_NODE_COUNT');
            assert.equal(watchdog.alerts[0].severity, 'MEDIUM');
        });

        it('does not alert when node count meets threshold', () => {
            const watchdog = new DogecoinWatchdog(createMockRPC());
            watchdog.checkLowNodeCount(5);
            assert.equal(watchdog.alerts.length, 0);
        });

        it('does not alert when node count exceeds threshold', () => {
            const watchdog = new DogecoinWatchdog(createMockRPC());
            watchdog.checkLowNodeCount(100);
            assert.equal(watchdog.alerts.length, 0);
        });
    });

    describe('checkMempoolFlooding', () => {
        it('creates alert when mempool exceeds threshold', () => {
            const watchdog = new DogecoinWatchdog(createMockRPC());
            watchdog.checkMempoolFlooding(15000);
            assert.equal(watchdog.alerts.length, 1);
            assert.equal(watchdog.alerts[0].type, 'MEMPOOL_FLOOD');
            assert.equal(watchdog.alerts[0].severity, 'HIGH');
        });

        it('does not alert when mempool is normal', () => {
            const watchdog = new DogecoinWatchdog(createMockRPC());
            watchdog.checkMempoolFlooding(500);
            assert.equal(watchdog.alerts.length, 0);
        });

        it('does not alert at exact threshold', () => {
            const watchdog = new DogecoinWatchdog(createMockRPC());
            watchdog.checkMempoolFlooding(10000);
            assert.equal(watchdog.alerts.length, 0);
        });
    });

    describe('checkHashRateAnomalies', () => {
        it('creates CRITICAL alert on hash rate spike', () => {
            const watchdog = new DogecoinWatchdog(createMockRPC());
            watchdog.baselines.avgHashRate = watchdog.calculateHashRate(1000);
            watchdog.checkHashRateAnomalies(6000);
            assert.equal(watchdog.alerts.length, 1);
            assert.equal(watchdog.alerts[0].type, 'HASH_RATE_SPIKE');
            assert.equal(watchdog.alerts[0].severity, 'CRITICAL');
        });

        it('creates HIGH alert on hash rate drop', () => {
            const watchdog = new DogecoinWatchdog(createMockRPC());
            watchdog.baselines.avgHashRate = watchdog.calculateHashRate(10000);
            watchdog.checkHashRateAnomalies(2000);
            assert.equal(watchdog.alerts.length, 1);
            assert.equal(watchdog.alerts[0].type, 'HASH_RATE_DROP');
            assert.equal(watchdog.alerts[0].severity, 'HIGH');
        });

        it('does not alert within normal range', () => {
            const watchdog = new DogecoinWatchdog(createMockRPC());
            watchdog.baselines.avgHashRate = watchdog.calculateHashRate(10000);
            watchdog.checkHashRateAnomalies(15000);
            assert.equal(watchdog.alerts.length, 0);
        });

        it('skips check when no baseline exists', () => {
            const watchdog = new DogecoinWatchdog(createMockRPC());
            watchdog.baselines.avgHashRate = null;
            watchdog.checkHashRateAnomalies(10000);
            assert.equal(watchdog.alerts.length, 0);
        });
    });

    describe('checkDifficultySpikes', () => {
        it('creates alert on difficulty spike', () => {
            const watchdog = new DogecoinWatchdog(createMockRPC());
            watchdog.baselines.avgDifficulty = 1000;
            watchdog.checkDifficultySpikes(4000);
            assert.equal(watchdog.alerts.length, 1);
            assert.equal(watchdog.alerts[0].type, 'DIFFICULTY_SPIKE');
            assert.equal(watchdog.alerts[0].severity, 'HIGH');
        });

        it('does not alert within normal range', () => {
            const watchdog = new DogecoinWatchdog(createMockRPC());
            watchdog.baselines.avgDifficulty = 1000;
            watchdog.checkDifficultySpikes(2500);
            assert.equal(watchdog.alerts.length, 0);
        });
    });

    describe('checkForDeepReorgs', () => {
        it('creates CRITICAL alert on deep reorganization (6+ blocks)', async () => {
            const mockRPC = createMockRPC({
                getChainTips: async () => [
                    { status: 'active', branchlen: 0 },
                    { status: 'valid-fork', branchlen: 8 }
                ]
            });
            const watchdog = new DogecoinWatchdog(mockRPC);
            await watchdog.checkForDeepReorgs();
            const alert = watchdog.alerts.find(a => a.type === 'DEEP_REORGANIZATION');
            assert.ok(alert, 'Should create DEEP_REORGANIZATION alert');
            assert.equal(alert.severity, 'CRITICAL');
        });

        it('creates HIGH alert on frequent shallow reorgs', async () => {
            const mockRPC = createMockRPC({
                getChainTips: async () => [
                    { status: 'valid-fork', branchlen: 3 },
                    { status: 'valid-fork', branchlen: 2 },
                    { status: 'valid-fork', branchlen: 4 }
                ]
            });
            const watchdog = new DogecoinWatchdog(mockRPC);
            await watchdog.checkForDeepReorgs();
            const alert = watchdog.alerts.find(a => a.type === 'FREQUENT_REORGANIZATIONS');
            assert.ok(alert, 'Should create FREQUENT_REORGANIZATIONS alert');
            assert.equal(alert.severity, 'HIGH');
        });

        it('does not alert on normal chain tips', async () => {
            const mockRPC = createMockRPC({
                getChainTips: async () => [
                    { status: 'active', branchlen: 0 },
                    { status: 'valid-fork', branchlen: 1 }
                ]
            });
            const watchdog = new DogecoinWatchdog(mockRPC);
            await watchdog.checkForDeepReorgs();
            assert.equal(watchdog.alerts.length, 0);
        });

        it('handles RPC failure gracefully', async () => {
            const mockRPC = createMockRPC({
                getChainTips: async () => { throw new Error('RPC timeout'); }
            });
            const watchdog = new DogecoinWatchdog(mockRPC);
            await watchdog.checkForDeepReorgs();
            assert.equal(watchdog.alerts.length, 0);
        });
    });

    describe('createAlert', () => {
        it('adds alert to the front of the list', () => {
            const watchdog = new DogecoinWatchdog(createMockRPC());
            watchdog.createAlert('TYPE_A', 'HIGH', 'First alert');
            watchdog.createAlert('TYPE_B', 'CRITICAL', 'Second alert');
            assert.equal(watchdog.alerts.length, 2);
            assert.equal(watchdog.alerts[0].type, 'TYPE_B');
            assert.equal(watchdog.alerts[1].type, 'TYPE_A');
        });

        it('generates unique alert IDs', () => {
            const watchdog = new DogecoinWatchdog(createMockRPC());
            watchdog.createAlert('TYPE_A', 'HIGH', 'Alert 1');
            watchdog.createAlert('TYPE_A', 'HIGH', 'Alert 2');
            assert.notEqual(watchdog.alerts[0].id, watchdog.alerts[1].id);
        });

        it('caps alerts at 1000', () => {
            const watchdog = new DogecoinWatchdog(createMockRPC());
            for (let i = 0; i < 1050; i++) {
                watchdog.createAlert('TYPE', 'LOW', `Alert ${i}`);
            }
            assert.equal(watchdog.alerts.length, 1000);
        });

        it('emits alert event', () => {
            const watchdog = new DogecoinWatchdog(createMockRPC());
            let emittedAlert = null;
            watchdog.on('alert', (alert) => { emittedAlert = alert; });

            watchdog.createAlert('TYPE_A', 'HIGH', 'Test alert', { key: 'value' });
            assert.ok(emittedAlert);
            assert.equal(emittedAlert.type, 'TYPE_A');
            assert.equal(emittedAlert.severity, 'HIGH');
            assert.equal(emittedAlert.data.key, 'value');
            assert.equal(emittedAlert.acknowledged, false);
        });
    });

    describe('acknowledgeAlert', () => {
        it('marks alert as acknowledged', () => {
            const watchdog = new DogecoinWatchdog(createMockRPC());
            watchdog.createAlert('TYPE_A', 'HIGH', 'Test');
            assert.equal(watchdog.acknowledgeAlert(watchdog.alerts[0].id), true);
            assert.equal(watchdog.alerts[0].acknowledged, true);
        });

        it('returns false for non-existent alert', () => {
            const watchdog = new DogecoinWatchdog(createMockRPC());
            assert.equal(watchdog.acknowledgeAlert('nonexistent_id'), false);
        });

        it('emits alertAcknowledged event', () => {
            const watchdog = new DogecoinWatchdog(createMockRPC());
            watchdog.createAlert('TYPE_A', 'HIGH', 'Test');
            let emitted = false;
            watchdog.on('alertAcknowledged', () => { emitted = true; });
            watchdog.acknowledgeAlert(watchdog.alerts[0].id);
            assert.ok(emitted);
        });
    });

    describe('getOverallStatus', () => {
        it('returns OFFLINE when not monitoring', () => {
            const watchdog = new DogecoinWatchdog(createMockRPC());
            assert.equal(watchdog.getOverallStatus(), 'OFFLINE');
        });

        it('returns SECURE when monitoring with no alerts', () => {
            const watchdog = new DogecoinWatchdog(createMockRPC());
            watchdog.isMonitoring = true;
            assert.equal(watchdog.getOverallStatus(), 'SECURE');
        });

        it('returns CRITICAL_ALERT with unacknowledged critical alerts', () => {
            const watchdog = new DogecoinWatchdog(createMockRPC());
            watchdog.isMonitoring = true;
            watchdog.createAlert('TEST', 'CRITICAL', 'Critical issue');
            assert.equal(watchdog.getOverallStatus(), 'CRITICAL_ALERT');
        });

        it('returns SECURE when critical alerts are acknowledged', () => {
            const watchdog = new DogecoinWatchdog(createMockRPC());
            watchdog.isMonitoring = true;
            watchdog.createAlert('TEST', 'CRITICAL', 'Critical issue');
            watchdog.acknowledgeAlert(watchdog.alerts[0].id);
            assert.equal(watchdog.getOverallStatus(), 'SECURE');
        });

        it('returns correct priority order for mixed severities', () => {
            const watchdog = new DogecoinWatchdog(createMockRPC());
            watchdog.isMonitoring = true;
            watchdog.createAlert('A', 'MEDIUM', 'Medium');
            assert.equal(watchdog.getOverallStatus(), 'MEDIUM_ALERT');
            watchdog.createAlert('B', 'HIGH', 'High');
            assert.equal(watchdog.getOverallStatus(), 'HIGH_ALERT');
            watchdog.createAlert('C', 'CRITICAL', 'Critical');
            assert.equal(watchdog.getOverallStatus(), 'CRITICAL_ALERT');
        });
    });

    describe('updateMetrics', () => {
        it('appends metrics from current data', () => {
            const watchdog = new DogecoinWatchdog(createMockRPC());
            watchdog.updateMetrics({
                blockchain: { difficulty: 10000 },
                mempool: { size: 100 },
                peers: [{ addr: '1.2.3.4:22556' }, { addr: '5.6.7.8:22556' }],
                timestamp: new Date().toISOString()
            });
            assert.equal(watchdog.metrics.hashRate.length, 1);
            assert.equal(watchdog.metrics.networkNodes[0].value, 2);
        });

        it('caps metrics at 100 data points', () => {
            const watchdog = new DogecoinWatchdog(createMockRPC());
            for (let i = 0; i < 110; i++) {
                watchdog.updateMetrics({
                    blockchain: { difficulty: i },
                    mempool: { size: i },
                    peers: [],
                    timestamp: new Date().toISOString()
                });
            }
            assert.equal(watchdog.metrics.hashRate.length, 100);
        });
    });

    describe('getStatus', () => {
        it('returns complete status object', () => {
            const watchdog = new DogecoinWatchdog(createMockRPC());
            const status = watchdog.getStatus();
            assert.ok('isMonitoring' in status);
            assert.ok('status' in status);
            assert.ok('alertCount' in status);
            assert.ok('recentAlerts' in status);
            assert.ok('baselines' in status);
            assert.ok('thresholds' in status);
            assert.ok('lastUpdate' in status);
        });
    });
});
