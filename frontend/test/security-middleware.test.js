const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// These middleware functions don't make network calls, so we can require them directly.
const { validateInput, securityHeaders } = require('../src/middleware/security');

/**
 * Creates a mock Express request
 */
function mockRequest(overrides = {}) {
    return {
        query: {},
        body: {},
        params: {},
        method: 'GET',
        path: '/',
        ip: '127.0.0.1',
        get: (header) => {
            const headers = { 'User-Agent': 'test-agent', 'Content-Length': '0', ...overrides.headers };
            return headers[header];
        },
        ...overrides
    };
}

/**
 * Creates a mock Express response
 */
function mockResponse() {
    const res = {
        statusCode: 200,
        headers: {},
        body: null,
        status(code) { res.statusCode = code; return res; },
        json(data) { res.body = data; return res; },
        setHeader(key, value) { res.headers[key] = value; return res; }
    };
    return res;
}

describe('validateInput middleware', () => {
    it('allows normal query parameters', (_, done) => {
        const req = mockRequest({ query: { limit: '50', severity: 'HIGH' } });
        const res = mockResponse();
        validateInput(req, res, () => { done(); });
    });

    it('allows normal body parameters', (_, done) => {
        const req = mockRequest({ body: { method: 'getblockchaininfo', params: [] } });
        const res = mockResponse();
        validateInput(req, res, () => { done(); });
    });

    it('blocks script injection in query parameters', () => {
        const req = mockRequest({ query: { search: '<script>alert(1)</script>' } });
        const res = mockResponse();
        let nextCalled = false;
        validateInput(req, res, () => { nextCalled = true; });
        assert.equal(nextCalled, false);
        assert.equal(res.statusCode, 400);
        assert.equal(res.body.error, 'INVALID_INPUT');
    });

    it('blocks javascript: protocol in query parameters', () => {
        // eslint-disable-next-line no-script-url
        const req = mockRequest({ query: { url: 'javascript:alert(1)' } });
        const res = mockResponse();
        let nextCalled = false;
        validateInput(req, res, () => { nextCalled = true; });
        assert.equal(nextCalled, false);
        assert.equal(res.statusCode, 400);
    });

    it('blocks SQL injection patterns', () => {
        const req = mockRequest({ query: { id: "' UNION SELECT * FROM users--" } });
        const res = mockResponse();
        let nextCalled = false;
        validateInput(req, res, () => { nextCalled = true; });
        assert.equal(nextCalled, false);
        assert.equal(res.statusCode, 400);
    });

    it('blocks shell injection with ||', () => {
        const req = mockRequest({ query: { cmd: 'test || rm -rf /' } });
        const res = mockResponse();
        let nextCalled = false;
        validateInput(req, res, () => { nextCalled = true; });
        assert.equal(nextCalled, false);
        assert.equal(res.statusCode, 400);
    });

    it('blocks backtick shell injection', () => {
        const req = mockRequest({ query: { val: '`cat /etc/passwd`' } });
        const res = mockResponse();
        let nextCalled = false;
        validateInput(req, res, () => { nextCalled = true; });
        assert.equal(nextCalled, false);
        assert.equal(res.statusCode, 400);
    });

    it('blocks injection in body parameters', () => {
        const req = mockRequest({ body: { name: '<script>steal()</script>' } });
        const res = mockResponse();
        let nextCalled = false;
        validateInput(req, res, () => { nextCalled = true; });
        assert.equal(nextCalled, false);
        assert.equal(res.statusCode, 400);
    });

    it('blocks injection in nested objects', () => {
        const req = mockRequest({
            body: { outer: { inner: '<script>xss</script>' } }
        });
        const res = mockResponse();
        let nextCalled = false;
        validateInput(req, res, () => { nextCalled = true; });
        assert.equal(nextCalled, false);
        assert.equal(res.statusCode, 400);
    });

    it('rejects excessively long body inputs', () => {
        const req = mockRequest({ body: { data: 'x'.repeat(10001) } });
        const res = mockResponse();
        let nextCalled = false;
        validateInput(req, res, () => { nextCalled = true; });
        assert.equal(nextCalled, false);
        assert.equal(res.statusCode, 400);
        assert.equal(res.body.error, 'INPUT_TOO_LONG');
    });

    it('allows inputs at exactly the max length', (_, done) => {
        const req = mockRequest({ body: { data: 'x'.repeat(10000) } });
        const res = mockResponse();
        validateInput(req, res, () => { done(); });
    });

    it('allows valid block hashes', (_, done) => {
        const req = mockRequest({
            query: { hash: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2' }
        });
        const res = mockResponse();
        validateInput(req, res, () => { done(); });
    });

    it('allows numeric strings (block heights, counts)', (_, done) => {
        const req = mockRequest({ query: { height: '5000000', count: '10' } });
        const res = mockResponse();
        validateInput(req, res, () => { done(); });
    });
});

describe('securityHeaders middleware', () => {
    it('sets X-Frame-Options to DENY', (_, done) => {
        const req = mockRequest({ path: '/api/info' });
        const res = mockResponse();
        securityHeaders(req, res, () => {
            assert.equal(res.headers['X-Frame-Options'], 'DENY');
            done();
        });
    });

    it('sets X-Content-Type-Options to nosniff', (_, done) => {
        const req = mockRequest({ path: '/api/info' });
        const res = mockResponse();
        securityHeaders(req, res, () => {
            assert.equal(res.headers['X-Content-Type-Options'], 'nosniff');
            done();
        });
    });

    it('sets X-XSS-Protection', (_, done) => {
        const req = mockRequest({ path: '/api/info' });
        const res = mockResponse();
        securityHeaders(req, res, () => {
            assert.equal(res.headers['X-XSS-Protection'], '1; mode=block');
            done();
        });
    });

    it('sets Referrer-Policy', (_, done) => {
        const req = mockRequest({ path: '/api/info' });
        const res = mockResponse();
        securityHeaders(req, res, () => {
            assert.equal(res.headers['Referrer-Policy'], 'strict-origin-when-cross-origin');
            done();
        });
    });

    it('sets CSP for HTML files', (_, done) => {
        const req = mockRequest({ path: '/index.html' });
        const res = mockResponse();
        securityHeaders(req, res, () => {
            assert.ok(res.headers['Content-Security-Policy']);
            assert.ok(res.headers['Content-Security-Policy'].includes("default-src 'self'"));
            assert.ok(res.headers['Content-Security-Policy'].includes("object-src 'none'"));
            done();
        });
    });

    it('sets CSP for root path', (_, done) => {
        const req = mockRequest({ path: '/' });
        const res = mockResponse();
        securityHeaders(req, res, () => {
            assert.ok(res.headers['Content-Security-Policy']);
            done();
        });
    });

    it('does not set CSP for API endpoints', (_, done) => {
        const req = mockRequest({ path: '/api/health' });
        const res = mockResponse();
        securityHeaders(req, res, () => {
            assert.equal(res.headers['Content-Security-Policy'], undefined);
            done();
        });
    });
});
