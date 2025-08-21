/**
 * Dogecoin RPC Service
 * Handles all communication with the Dogecoin node
 */

const axios = require('axios');
const fs = require('fs');
const config = require('../config');
const { createChildLogger } = require('../utils/logger');

/**
 * Custom RPC Error class
 */
class RPCError extends Error {
    constructor(message, code, method) {
        super(message);
        this.name = 'RPCError';
        this.code = code;
        this.method = method;
    }
}

class DogecoinRPCService {
    constructor() {
        this.logger = createChildLogger({ service: 'rpc' });
        this.rpcUrl = `http://${config.rpc.host}:${config.rpc.port}`;
    }

    /**
     * Reads RPC authentication credentials from cookie file
     * @returns {Object} Authentication credentials
     */
    getRPCAuth() {
        try {
            if (fs.existsSync(config.rpc.cookiePath)) {
                const cookie = fs.readFileSync(config.rpc.cookiePath, 'utf8').trim();
                const [username, password] = cookie.split(':');
                this.logger.debug('RPC cookie authentication loaded', { username });
                return { username, password };
            } else {
                this.logger.warn('RPC cookie file not found, using fallback credentials', {
                    cookiePath: config.rpc.cookiePath
                });

                // Require environment variables for security
                const username = process.env.DOGECOIN_RPC_USER;
                const password = process.env.DOGECOIN_RPC_PASS;

                if (!username || !password) {
                    throw new Error('RPC credentials not found. Set DOGECOIN_RPC_USER and DOGECOIN_RPC_PASS environment variables or ensure cookie file exists.');
                }

                return { username, password };
            }
        } catch (error) {
            this.logger.error('Error reading RPC cookie', {
                error: error.message,
                cookiePath: config.rpc.cookiePath
            });
            throw new Error(`Failed to get RPC authentication: ${error.message}`);
        }
    }

    /**
     * Makes an RPC call to the Dogecoin node
     * @param {string} method - RPC method name
     * @param {Array} params - Method parameters
     * @param {number} timeout - Request timeout in milliseconds
     * @returns {Promise<*>} RPC call result
     */
    async call(method, params = [], timeout = config.rpc.timeout) {
        const auth = this.getRPCAuth();
        const requestId = Math.random().toString(36).substring(2, 15);

        const payload = {
            jsonrpc: '1.0',
            id: requestId,
            method,
            params
        };

        this.logger.debug('Making RPC call', { method, params: params.length });

        try {
            const response = await axios.post(this.rpcUrl, payload, {
                auth,
                timeout,
                headers: {
                    'Content-Type': 'application/json'
                }
            });

            if (response.data.error) {
                throw new RPCError(response.data.error.message, response.data.error.code, method);
            }

            this.logger.debug('RPC call successful', { method, requestId });
            return response.data.result;
        } catch (error) {
            if (error instanceof RPCError) {
                throw error;
            }

            // Handle axios errors
            if (error.code === 'ECONNREFUSED') {
                throw new RPCError('Connection refused - Dogecoin node may not be running', -1, method);
            }

            if (error.response?.status === 401) {
                throw new RPCError('Authentication failed - check RPC credentials', 401, method);
            }

            if (error.response?.status === 500) {
                throw new RPCError('Internal server error - node may be starting up', 500, method);
            }

            if (error.code === 'ENOTFOUND') {
                throw new RPCError(`Host not found: ${config.rpc.host}`, -2, method);
            }

            if (error.code === 'ETIMEDOUT') {
                throw new RPCError('Request timeout', -3, method);
            }

            this.logger.error('RPC call failed', {
                method,
                error: error.message,
                status: error.response?.status,
                code: error.code
            });

            throw new RPCError(`RPC call failed: ${error.message}`, -99, method);
        }
    }

    /**
     * Makes an RPC call with retry logic
     * @param {string} method - RPC method name
     * @param {Array} params - Method parameters
     * @param {number} maxRetries - Maximum number of retries
     * @param {number} retryDelay - Delay between retries in milliseconds
     * @returns {Promise<*>} RPC call result
     */
    async callWithRetry(method, params = [], maxRetries = config.rpc.maxRetries, retryDelay = config.rpc.retryDelay) {
        let lastError;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                return await this.call(method, params);
            } catch (error) {
                lastError = error;

                if (attempt === maxRetries) {
                    this.logger.error('RPC call failed after all retries', {
                        method,
                        attempts: maxRetries,
                        lastError: error.message
                    });
                    throw error;
                }

                // Don't retry authentication errors
                if (error.code === 401) {
                    throw error;
                }

                this.logger.warn('RPC call failed, retrying', {
                    method,
                    attempt,
                    maxRetries,
                    error: error.message,
                    retryIn: retryDelay
                });

                await new Promise(resolve => setTimeout(resolve, retryDelay));
            }
        }

        throw lastError;
    }

    /**
     * Tests the RPC connection
     * @returns {Promise<boolean>} True if connection is successful
     */
    async testConnection() {
        try {
            await this.call('getblockchaininfo');
            return true;
        } catch (error) {
            this.logger.error('RPC connection test failed', { error: error.message });
            return false;
        }
    }

    /**
     * Gets basic node information
     * @returns {Promise<Object>} Node information
     */
    async getNodeInfo() {
        const [blockchainInfo, networkInfo, mempoolInfo] = await Promise.all([
            this.call('getblockchaininfo'),
            this.call('getnetworkinfo'),
            this.call('getmempoolinfo')
        ]);

        return {
            blockchain: blockchainInfo,
            network: networkInfo,
            mempool: mempoolInfo,
            timestamp: new Date().toISOString()
        };
    }

    /**
     * Gets chain tips information (for detecting reorganizations)
     * @returns {Promise<Array>} Array of chain tip objects
     */
    async getChainTips() {
        try {
            return await this.call('getchaintips');
        } catch (error) {
            this.logger.warn('Could not get chain tips', { error: error.message });
            return [];
        }
    }

    /**
     * Gets mempool information
     * @returns {Promise<Object>} Mempool information
     */
    async getMempoolInfo() {
        return await this.call('getmempoolinfo');
    }

    /**
     * Gets network hash rate
     * @returns {Promise<number>} Network hash rate in hashes per second
     */
    async getNetworkHashPS(blocks = 120) {
        return await this.call('getnetworkhashps', [blocks]);
    }
}

module.exports = {
    DogecoinRPCService,
    RPCError
};
