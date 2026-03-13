const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { DogecoinRPCService, RPCError } = require('../src/services/rpc');

describe('RPCError', () => {
    it('creates error with correct properties', () => {
        const err = new RPCError('test message', -1, 'getblockchaininfo');
        assert.equal(err.message, 'test message');
        assert.equal(err.code, -1);
        assert.equal(err.method, 'getblockchaininfo');
        assert.equal(err.name, 'RPCError');
        assert.ok(err instanceof Error);
    });
});

describe('DogecoinRPCService', () => {
    let service;
    let tmpCookieDir;
    let tmpCookiePath;

    // We'll use a temp cookie file and override the config path
    // by creating the file at the config's expected location
    const config = require('../src/config');

    beforeEach(() => {
        service = new DogecoinRPCService();

        // Create a temp directory for the cookie file
        tmpCookieDir = fs.mkdtempSync(path.join(os.tmpdir(), 'doge-test-'));
        tmpCookiePath = path.join(tmpCookieDir, '.cookie');
    });

    afterEach(() => {
        try { fs.unlinkSync(tmpCookiePath); } catch { /* ignore */ }
        try { fs.rmdirSync(tmpCookieDir); } catch { /* ignore */ }
    });

    describe('getRPCAuth', () => {
        it('reads credentials from cookie file when it exists', () => {
            // Override the config cookie path temporarily
            const origPath = config.rpc.cookiePath;
            config.rpc.cookiePath = tmpCookiePath;
            fs.writeFileSync(tmpCookiePath, '__cookie__:randompassword123');

            try {
                const auth = service.getRPCAuth();
                assert.equal(auth.username, '__cookie__');
                assert.equal(auth.password, 'randompassword123');
            } finally {
                config.rpc.cookiePath = origPath;
            }
        });

        it('trims whitespace from cookie file', () => {
            const origPath = config.rpc.cookiePath;
            config.rpc.cookiePath = tmpCookiePath;
            fs.writeFileSync(tmpCookiePath, '  user:pass  \n');

            try {
                const auth = service.getRPCAuth();
                assert.equal(auth.username, 'user');
                assert.equal(auth.password, 'pass');
            } finally {
                config.rpc.cookiePath = origPath;
            }
        });

        it('falls back to environment variables when cookie file missing', () => {
            // Point config to nonexistent file
            const origPath = config.rpc.cookiePath;
            config.rpc.cookiePath = '/tmp/nonexistent-cookie-file-12345';

            const origUser = process.env.DOGECOIN_RPC_USER;
            const origPass = process.env.DOGECOIN_RPC_PASS;
            process.env.DOGECOIN_RPC_USER = 'envuser';
            process.env.DOGECOIN_RPC_PASS = 'envpass';

            try {
                const auth = service.getRPCAuth();
                assert.equal(auth.username, 'envuser');
                assert.equal(auth.password, 'envpass');
            } finally {
                config.rpc.cookiePath = origPath;
                if (origUser !== undefined) process.env.DOGECOIN_RPC_USER = origUser;
                else delete process.env.DOGECOIN_RPC_USER;
                if (origPass !== undefined) process.env.DOGECOIN_RPC_PASS = origPass;
                else delete process.env.DOGECOIN_RPC_PASS;
            }
        });

        it('throws when neither cookie nor env vars available', () => {
            const origPath = config.rpc.cookiePath;
            config.rpc.cookiePath = '/tmp/nonexistent-cookie-file-12345';

            const origUser = process.env.DOGECOIN_RPC_USER;
            const origPass = process.env.DOGECOIN_RPC_PASS;
            delete process.env.DOGECOIN_RPC_USER;
            delete process.env.DOGECOIN_RPC_PASS;

            try {
                assert.throws(() => service.getRPCAuth(), /Failed to get RPC authentication/);
            } finally {
                config.rpc.cookiePath = origPath;
                if (origUser !== undefined) process.env.DOGECOIN_RPC_USER = origUser;
                if (origPass !== undefined) process.env.DOGECOIN_RPC_PASS = origPass;
            }
        });
    });

    describe('call (error paths — no live node)', () => {
        it('throws RPCError when node is not running', async () => {
            // Provide auth via env vars so the call can proceed to the network stage
            const origUser = process.env.DOGECOIN_RPC_USER;
            const origPass = process.env.DOGECOIN_RPC_PASS;
            process.env.DOGECOIN_RPC_USER = 'testuser';
            process.env.DOGECOIN_RPC_PASS = 'testpass';

            // Point config to nonexistent cookie so it uses env vars
            const origPath = config.rpc.cookiePath;
            config.rpc.cookiePath = '/tmp/nonexistent-cookie-file-12345';

            try {
                await assert.rejects(
                    () => service.call('getblockchaininfo', [], 1000),
                    (err) => {
                        assert.ok(err instanceof RPCError);
                        // Connection refused or similar network error
                        assert.ok([-1, -2, -3, -99].includes(err.code), `Unexpected error code: ${err.code}`);
                        return true;
                    }
                );
            } finally {
                config.rpc.cookiePath = origPath;
                if (origUser !== undefined) process.env.DOGECOIN_RPC_USER = origUser;
                else delete process.env.DOGECOIN_RPC_USER;
                if (origPass !== undefined) process.env.DOGECOIN_RPC_PASS = origPass;
                else delete process.env.DOGECOIN_RPC_PASS;
            }
        });
    });

    describe('callWithRetry (error paths)', () => {
        it('gives up after max retries on persistent failure', async () => {
            const origUser = process.env.DOGECOIN_RPC_USER;
            const origPass = process.env.DOGECOIN_RPC_PASS;
            process.env.DOGECOIN_RPC_USER = 'testuser';
            process.env.DOGECOIN_RPC_PASS = 'testpass';

            const origPath = config.rpc.cookiePath;
            config.rpc.cookiePath = '/tmp/nonexistent-cookie-file-12345';

            try {
                const start = Date.now();
                await assert.rejects(
                    () => service.callWithRetry('getblockchaininfo', [], 2, 50),
                    (err) => {
                        assert.ok(err instanceof RPCError);
                        return true;
                    }
                );
                const elapsed = Date.now() - start;
                // Should have waited at least ~50ms for one retry delay
                assert.ok(elapsed >= 30, `Expected at least 30ms elapsed, got ${elapsed}ms`);
            } finally {
                config.rpc.cookiePath = origPath;
                if (origUser !== undefined) process.env.DOGECOIN_RPC_USER = origUser;
                else delete process.env.DOGECOIN_RPC_USER;
                if (origPass !== undefined) process.env.DOGECOIN_RPC_PASS = origPass;
                else delete process.env.DOGECOIN_RPC_PASS;
            }
        });
    });

    describe('testConnection', () => {
        it('returns false when node is not running', async () => {
            const origUser = process.env.DOGECOIN_RPC_USER;
            const origPass = process.env.DOGECOIN_RPC_PASS;
            process.env.DOGECOIN_RPC_USER = 'testuser';
            process.env.DOGECOIN_RPC_PASS = 'testpass';

            const origPath = config.rpc.cookiePath;
            config.rpc.cookiePath = '/tmp/nonexistent-cookie-file-12345';

            try {
                const result = await service.testConnection();
                assert.equal(result, false);
            } finally {
                config.rpc.cookiePath = origPath;
                if (origUser !== undefined) process.env.DOGECOIN_RPC_USER = origUser;
                else delete process.env.DOGECOIN_RPC_USER;
                if (origPass !== undefined) process.env.DOGECOIN_RPC_PASS = origPass;
                else delete process.env.DOGECOIN_RPC_PASS;
            }
        });
    });
});
