/**
 * API Routes for Dogecoin Node Health and Basic Information
 */

const express = require('express');
const { createChildLogger } = require('../utils/logger');
const { DogecoinRPCService, RPCError } = require('../services/rpc');

const router = express.Router();
const logger = createChildLogger({ service: 'api-routes' });

/**
 * Initialize RPC service
 */
let rpcService;
const initializeRPC = () => {
    if (!rpcService) {
        rpcService = new DogecoinRPCService();
    }
    return rpcService;
};

/**
 * Error handler for API routes
 */
const handleAPIError = (res, error, operation) => {
    logger.error(`${operation} failed`, { error: error.message });
    
    if (error instanceof RPCError) {
        return res.status(503).json({
            error: 'RPC_ERROR',
            message: `Dogecoin node error: ${error.message}`,
            code: error.code,
            method: error.method
        });
    }
    
    return res.status(500).json({
        error: 'INTERNAL_ERROR',
        message: error.message
    });
};

/**
 * GET /api/health
 * Returns basic health status of the Dogecoin node
 */
router.get('/health', async (req, res) => {
    try {
        const rpc = initializeRPC();
        const isHealthy = await rpc.testConnection();
        
        if (isHealthy) {
            res.json({
                status: 'healthy',
                timestamp: new Date().toISOString(),
                service: 'dogecoin-node'
            });
        } else {
            res.status(503).json({
                status: 'unhealthy',
                timestamp: new Date().toISOString(),
                service: 'dogecoin-node',
                error: 'Connection test failed'
            });
        }
    } catch (error) {
        handleAPIError(res, error, 'Health check');
    }
});

/**
 * GET /api/status
 * Returns comprehensive status of the Dogecoin node
 */
router.get('/status', async (req, res) => {
    try {
        const rpc = initializeRPC();
        const nodeInfo = await rpc.getNodeInfo();
        
        res.json({
            status: 'success',
            timestamp: new Date().toISOString(),
            data: nodeInfo
        });
    } catch (error) {
        handleAPIError(res, error, 'Status check');
    }
});

/**
 * GET /api/blockchain/info
 * Returns blockchain information
 */
router.get('/blockchain/info', async (req, res) => {
    try {
        const rpc = initializeRPC();
        const blockchainInfo = await rpc.call('getblockchaininfo');
        
        res.json({
            status: 'success',
            timestamp: new Date().toISOString(),
            data: blockchainInfo
        });
    } catch (error) {
        handleAPIError(res, error, 'Blockchain info retrieval');
    }
});

/**
 * GET /api/network/info
 * Returns network information
 */
router.get('/network/info', async (req, res) => {
    try {
        const rpc = initializeRPC();
        const networkInfo = await rpc.call('getnetworkinfo');
        
        res.json({
            status: 'success',
            timestamp: new Date().toISOString(),
            data: networkInfo
        });
    } catch (error) {
        handleAPIError(res, error, 'Network info retrieval');
    }
});

/**
 * GET /api/mempool/info
 * Returns mempool information
 */
router.get('/mempool/info', async (req, res) => {
    try {
        const rpc = initializeRPC();
        const mempoolInfo = await rpc.call('getmempoolinfo');
        
        res.json({
            status: 'success',
            timestamp: new Date().toISOString(),
            data: mempoolInfo
        });
    } catch (error) {
        handleAPIError(res, error, 'Mempool info retrieval');
    }
});

/**
 * GET /api/peers
 * Returns peer connection information
 */
router.get('/peers', async (req, res) => {
    try {
        const rpc = initializeRPC();
        const peerInfo = await rpc.call('getpeerinfo');
        
        res.json({
            status: 'success',
            timestamp: new Date().toISOString(),
            data: {
                count: peerInfo.length,
                peers: peerInfo
            }
        });
    } catch (error) {
        handleAPIError(res, error, 'Peer info retrieval');
    }
});

/**
 * GET /api/block/:hash
 * Returns information about a specific block
 */
router.get('/block/:hash', async (req, res) => {
    try {
        const { hash } = req.params;
        
        if (!hash || typeof hash !== 'string') {
            return res.status(400).json({
                error: 'INVALID_PARAMETER',
                message: 'Block hash is required and must be a string'
            });
        }
        
        const rpc = initializeRPC();
        const blockInfo = await rpc.call('getblock', [hash]);
        
        res.json({
            status: 'success',
            timestamp: new Date().toISOString(),
            data: blockInfo
        });
    } catch (error) {
        handleAPIError(res, error, `Block retrieval for hash: ${req.params.hash}`);
    }
});

/**
 * GET /api/block/height/:height
 * Returns information about a block at specific height
 */
router.get('/block/height/:height', async (req, res) => {
    try {
        const height = parseInt(req.params.height);
        
        if (isNaN(height) || height < 0) {
            return res.status(400).json({
                error: 'INVALID_PARAMETER',
                message: 'Block height must be a valid non-negative number'
            });
        }
        
        const rpc = initializeRPC();
        const blockHash = await rpc.call('getblockhash', [height]);
        const blockInfo = await rpc.call('getblock', [blockHash]);
        
        res.json({
            status: 'success',
            timestamp: new Date().toISOString(),
            data: blockInfo
        });
    } catch (error) {
        handleAPIError(res, error, `Block retrieval for height: ${req.params.height}`);
    }
});

/**
 * GET /api/transaction/:txid
 * Returns information about a specific transaction
 */
router.get('/transaction/:txid', async (req, res) => {
    try {
        const { txid } = req.params;
        
        if (!txid || typeof txid !== 'string') {
            return res.status(400).json({
                error: 'INVALID_PARAMETER',
                message: 'Transaction ID is required and must be a string'
            });
        }
        
        const rpc = initializeRPC();
        const txInfo = await rpc.call('getrawtransaction', [txid, true]);
        
        res.json({
            status: 'success',
            timestamp: new Date().toISOString(),
            data: txInfo
        });
    } catch (error) {
        handleAPIError(res, error, `Transaction retrieval for txid: ${req.params.txid}`);
    }
});

/**
 * POST /api/rpc
 * Generic RPC call endpoint (with security restrictions)
 */
router.post('/rpc', async (req, res) => {
    try {
        const { method, params = [] } = req.body;
        
        if (!method || typeof method !== 'string') {
            return res.status(400).json({
                error: 'INVALID_PARAMETER',
                message: 'RPC method is required and must be a string'
            });
        }
        
        // Whitelist of allowed RPC methods for security
        const allowedMethods = [
            'getblockchaininfo',
            'getnetworkinfo',
            'getmempoolinfo',
            'getpeerinfo',
            'getblock',
            'getblockhash',
            'getrawtransaction',
            'getbestblockhash',
            'getblockcount',
            'getdifficulty',
            'gettxout',
            'validateaddress'
        ];
        
        if (!allowedMethods.includes(method)) {
            return res.status(403).json({
                error: 'FORBIDDEN_METHOD',
                message: `RPC method '${method}' is not allowed via API`,
                allowedMethods
            });
        }
        
        const rpc = initializeRPC();
        const result = await rpc.call(method, params);
        
        res.json({
            status: 'success',
            timestamp: new Date().toISOString(),
            method,
            params,
            data: result
        });
    } catch (error) {
        handleAPIError(res, error, `RPC call: ${req.body.method}`);
    }
});

module.exports = router;
