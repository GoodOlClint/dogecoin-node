# Production Readiness Review — Dogecoin Node Monitor

**Date:** 2026-03-13
**Scope:** Full codebase review covering maintainability, security, code quality, documentation, testing, and CI/CD.

---

## Summary

| Category | Status | Finding Count |
|----------|--------|---------------|
| Language version & standards | FIXED | 2 |
| Dependencies | FIXED | 2 |
| Security | FIXED | 5 |
| Code quality & fragility | FIXED | 7 |
| Structure & separation | GOOD | 2 |
| Documentation | NEEDS WORK | 5 |
| Tests | FIXED | 1 |
| CI/CD | FIXED | 2 |

---

## Prioritized Findings

### Tier 1 — Fix before any public release or production use (ALL COMPLETE)

#### 1.1 Express error handler will never execute -- FIXED

**File:** `frontend/src/middleware/errorHandler.js:15`
**Problem:** The global error handler has the signature `(err, req, res)` — three parameters. Express identifies error-handling middleware by its four-parameter signature `(err, req, res, next)`. Without the `next` parameter, Express treats this as regular middleware and skips it for error handling.
**Why it matters:** Unhandled errors in routes will crash the process or produce raw stack traces to clients instead of the structured JSON error responses this middleware is designed to return.
**Fix:** Change the signature to `(err, req, res, _next)` (underscore prefix since `next` is unused in the body). The same applies to `notFoundHandler` on line 84, which uses `(req, res)` — acceptable for a 404 catch-all but should be verified it's not intended as error middleware.

```js
// Before
const errorHandler = (err, req, res) => {

// After
const errorHandler = (err, req, res, _next) => {
```

#### 1.2 Hardcoded default RPC credentials in production compose file -- FIXED

**File:** `docker-compose.prod.yml:15-16`
**Problem:** The file contains `DOGECOIN_RPCUSER=dogeuser` and `DOGECOIN_RPCPASSWORD=dogepass123`. This file is named `.prod.yml` and tracked in git, giving the appearance that these are usable production values.
**Why it matters:** Users may deploy this file as-is with weak, publicly-known credentials. Anyone with network access to the RPC port (22555, also exposed on line 10) could authenticate and issue RPC commands.
**Fix:** Replace hardcoded values with environment variable references using Docker Compose variable substitution. Add a `.env.example` file documenting required variables.

```yaml
environment:
  - DOGECOIN_RPCUSER=${DOGECOIN_RPCUSER:?Set RPC username}
  - DOGECOIN_RPCPASSWORD=${DOGECOIN_RPCPASSWORD:?Set RPC password}
```

#### 1.3 No test suite exists -- FIXED

**Problem:** The project has zero unit tests, zero integration tests, no test framework configured, and no `test` script in `package.json`.
**Why it matters:** There is no automated way to verify that changes don't break existing functionality. The watchdog threat detection logic, RPC retry behavior, and API input validation are all complex enough to harbor latent bugs.
**Fix:** Add a test framework (Jest or Node's built-in test runner) and write tests for the three highest-value areas:

1. **RPC service** (`src/services/rpc.js`): Test cookie auth parsing, env var fallback, retry logic with max attempts, error classification (connection refused, auth failure, timeout).
2. **Watchdog threat detection** (`src/services/watchdog.js`): Test threshold comparisons for hash rate spikes/drops, difficulty spikes, mempool flooding, deep reorg detection. These are pure logic tests that don't need a live node.
3. **API input validation** (`src/routes/api.js`): Test parameter validation for block count bounds, block hash format, RPC method whitelist rejection.

#### 1.4 `trust proxy` set to `true` allows IP spoofing -- FIXED

**File:** `frontend/server.js:88`
**Problem:** `app.set('trust proxy', true)` tells Express to trust all `X-Forwarded-For` headers from any source. An attacker can send arbitrary `X-Forwarded-For` values to bypass rate limiting (which keys on `req.ip`).
**Why it matters:** Rate limiting becomes ineffective since any client can rotate their apparent IP by changing the header.
**Fix:** Set `trust proxy` to a specific value matching your deployment:

```js
// Behind one reverse proxy (most common)
app.set('trust proxy', 1);

// Or restrict to loopback
app.set('trust proxy', 'loopback');
```

#### 1.5 WebSocket endpoint has no authentication -- FIXED

**File:** `frontend/server.js:176-329`
**Problem:** Any client can connect to the `/websocket` endpoint and receive all watchdog alerts, node status, and metrics. There is no token, API key, or session validation.
**Why it matters:** In a production deployment, security alert data (including detailed attack analysis with block hashes and recommendations) would be exposed to unauthenticated clients. The `acknowledge_alert` message type also allows any anonymous client to silence security alerts.
**Fix:** Add token-based authentication on WebSocket upgrade. At minimum, validate a query parameter or header token before allowing the connection:

```js
wss.on('connection', (ws, req) => {
    const token = new URL(req.url, 'http://localhost').searchParams.get('token');
    if (!token || !isValidToken(token)) {
        ws.close(1008, 'Unauthorized');
        return;
    }
    // ... existing logic
});
```

---

### Tier 2 — Fix before considering the project maintainable by others (7/8 COMPLETE)

#### 2.1 Delete deprecated `frontend/watchdog.js` -- FIXED

**File:** `frontend/watchdog.js` (509 lines)
**Problem:** This is the old watchdog implementation, fully superseded by `frontend/src/services/watchdog.js`. It is not imported anywhere but remains in the repository.
**Why it matters:** Contributors may not know which file is canonical. The old file uses a different RPC client pattern (direct `axios` calls vs. the `DogecoinRPCService` class) which could cause confusion.
**Fix:** Delete `frontend/watchdog.js`.

#### 2.2 Remove unused `cors` dependency -- FIXED

**File:** `frontend/package.json:17`
**Problem:** The `cors` package is listed as a production dependency but is never imported or used anywhere in the codebase. The project implements its own CORS handler in `src/middleware/security.js:236-274`.
**Why it matters:** Unnecessary dependency adds attack surface and maintenance burden.
**Fix:** `npm uninstall cors`.

#### 2.3 Unbounded cache growth in peer enrichment service -- FIXED

**File:** `frontend/src/services/peerEnrichment.js:13-14`
**Problem:** The `dnsCache` and `geoCache` Maps grow without bound. The `clearExpiredCache()` method exists (line 270) but is never called — there is no periodic cleanup, and entries are only overwritten when the same IP is looked up again after expiry.
**Why it matters:** Over days or weeks of continuous operation, the cache will accumulate entries for every unique peer IP ever seen. With Dogecoin's peer rotation, this can grow to thousands of entries consuming memory.
**Fix:** Add a periodic cleanup interval in the constructor and a maximum cache size:

```js
constructor() {
    // ... existing code
    this.maxCacheSize = 1000;
    setInterval(() => this.clearExpiredCache(), this.cacheTimeout);
}
```

#### 2.4 Pin Docker base image to Node 22 LTS -- FIXED

**Files:** `Dockerfile:50, 58`
**Problem:** The Dockerfile uses `node:25-alpine` and `node:25-bookworm-slim`. Node 25 is a current (odd-numbered) release, not an LTS release. It will reach end-of-life quickly and won't receive long-term security patches.
**Why it matters:** Production containers should use LTS releases for security patch guarantees. Node 22 is the active LTS (supported until April 2027).
**Fix:** Change both base images to `node:22-alpine` and `node:22-bookworm-slim`.

#### 2.5 Add environment variable documentation and CONTRIBUTING guide

**Files:** Missing `CONTRIBUTING.md`, incomplete `README.md`
**Problem:** The README lists Docker run commands but does not document any of the ~30 environment variables that configure the application (RPC settings, watchdog thresholds, rate limits, CORS, logging). The CONTRIBUTING section is a single line.
**Why it matters:** New contributors or operators cannot configure the application without reading source code. Watchdog thresholds are security-critical parameters that users should be able to tune.
**Fix:** Add an environment variable reference table to the README. Create a `CONTRIBUTING.md` covering development setup, project structure, and how to run the application locally.

#### 2.6 Rate limit error response uses static timestamp -- FIXED

**File:** `frontend/src/middleware/security.js:21, 48`
**Problem:** The `timestamp` in the rate limit response message is set to `new Date().toISOString()` at module load time — not when the rate limit is actually triggered. Every rate-limited response will show the same timestamp (when the server started).
**Why it matters:** Misleading timestamps in error responses make debugging difficult.
**Fix:** Move the timestamp generation into the `handler` function, or remove it from the static `message` object and add it in the handler.

#### 2.7 Duplicate RPC service instances -- FIXED

**Files:** `frontend/server.js:57` and `frontend/src/routes/api.js:20-25`
**Problem:** `server.js` creates `rpcService = new DogecoinRPCService()` on line 57, but `api.js` creates its own independent instance via `initializeRPC()` on first request. The server's instance is used for the watchdog; the route's instance is used for API calls.
**Why it matters:** Two independent RPC clients read the cookie file separately and maintain separate connection state. If one detects an auth failure, the other won't know. This also wastes resources.
**Fix:** Pass the RPC service instance from `server.js` into the API router, similar to how the watchdog is injected into watchdog routes.

#### 2.8 Add test script and basic test framework -- FIXED (Tier 1)

**File:** `frontend/package.json`
**Problem:** No `test` script defined in package.json. Running `npm test` fails with an error.
**Fix:** Add Jest or use Node's built-in test runner (`node --test`):

```json
"scripts": {
    "test": "node --test",
    "test:coverage": "node --test --experimental-test-coverage"
}
```

---

### Tier 3 — Quality improvements (4/7 COMPLETE)

#### 3.1 `console.log` in production watchdog code -- FIXED

**File:** `frontend/src/services/watchdog.js:664`
**Problem:** `console.log(\`🚨 ALERT: ${message}\`)` is called for every alert alongside the Winston logger on the previous line. In production, this bypasses log levels, formatting, and rotation.
**Fix:** Remove the `console.log` line — the `logger.warn` on line 663 already handles alert logging.

#### 3.2 No API documentation

**Problem:** The REST API has 12+ endpoints and the WebSocket supports multiple message types, but none of this is documented outside the source code JSDoc comments.
**Fix:** Add an OpenAPI/Swagger spec, or at minimum an `API.md` document listing endpoints, methods, parameters, and response shapes.

#### 3.3 No CHANGELOG

**Problem:** No `CHANGELOG.md` exists. Release history is only available through git log and GitHub releases.
**Fix:** Create a `CHANGELOG.md` following Keep a Changelog format. Going forward, update it with each release.

#### 3.4 Sequential block fetching in API route -- FIXED

**File:** `frontend/src/routes/api.js:255-263`
**Problem:** The `/api/blocks/:count` endpoint fetches blocks sequentially in a `for` loop — each block requires two RPC calls (`getblockhash` + `getblock`), making a request for 100 blocks issue 200 sequential RPC calls.
**Fix:** Batch the block hash requests or use `Promise.all` with a concurrency limit to parallelize fetching (e.g., 10 at a time).

#### 3.5 Unused `asyncHandler` utility -- FIXED (removed)

**File:** `frontend/src/middleware/errorHandler.js:103-107`
**Problem:** `asyncHandler` is defined and exported but never imported or used by any route. All async route handlers are written inline without wrapping.
**Fix:** Either use it consistently across all async routes (recommended — it prevents unhandled promise rejections from crashing the server) or remove it.

#### 3.6 Document TLS/reverse proxy requirements

**Problem:** The server runs HTTP only (no TLS). This is acceptable behind a reverse proxy, but nowhere in the README or docker-compose configuration is this mentioned. Users may deploy the dashboard directly on the internet without encryption.
**Fix:** Add a "Production Deployment" section to the README documenting that a reverse proxy (nginx, Traefik, Caddy) with TLS is required for production use. Provide an example nginx configuration.

#### 3.7 Add ESLint and tests to publish workflow -- FIXED

**File:** `.github/workflows/docker-publish.yml`
**Problem:** ESLint is only run in the `security-scan.yml` workflow, not in the main publish workflow. Code with lint errors can be published to Docker Hub.
**Fix:** Add a lint step before the Docker build in the publish workflow.

---

## What Is Already Good

These patterns and decisions are done well and should be preserved:

- **Defense-in-depth security middleware** (`src/middleware/security.js`): Rate limiting, security headers, input validation, and CORS are layered independently. The health check bypass for rate limiting is a thoughtful touch.

- **RPC method whitelisting** (`src/routes/api.js:382-395`): The generic `/api/rpc` endpoint restricts callable methods to 12 read-only operations. Dangerous methods like `sendtoaddress` or `stop` are not exposed.

- **Cookie-based RPC authentication** (`src/services/rpc.js:33-62`): The RPC service properly prioritizes Dogecoin's auto-generated cookie file over environment variables, and throws a clear error if neither is available.

- **Comprehensive CI/CD security scanning** (`.github/workflows/security-scan.yml`): Nine scanning tools (npm audit, CodeQL, Semgrep, TruffleHog, Hadolint, Trivy, ESLint, license checker, code duplication) provide thorough coverage across dependency, static analysis, secret detection, and container scanning.

- **Non-root Docker user with gosu** (`Dockerfile:104-107`, `docker-entrypoint.sh:17-19`): The container starts as root only to fix volume permissions, then drops to the unprivileged `dogecoin` user via `gosu`. This follows Docker security best practices.

- **Modular service architecture**: Clean separation between config, middleware, routes, services, and utilities. The watchdog uses EventEmitter for loose coupling with the WebSocket broadcast layer.

- **Graceful shutdown handling**: Both `server.js:440-471` and `docker-entrypoint.sh:48-65` properly handle SIGTERM/SIGINT, closing WebSocket connections, stopping the watchdog, and shutting down the Dogecoin daemon in order.

- **Environment-driven configuration with validation** (`src/config/index.js`): All settings have sensible defaults and are overridable via environment variables. Port ranges are validated at startup.

- **Dependabot configuration** (`.github/dependabot.yml`): Automated weekly updates for npm, Docker, and GitHub Actions dependencies with grouping for minor/patch versions.

- **Clean security posture**: `npm audit` reports 0 vulnerabilities. ESLint passes with no errors. No sensitive files found in git history. `.gitignore` covers common secret patterns.

- **Good JSDoc documentation**: All backend modules have descriptive JSDoc comments on classes, methods, parameters, and return values. This is above average for a project of this size.

- **Watchdog threat detection design** (`src/services/watchdog.js`): The 51% attack detection uses multiple independent signals (deep reorgs, hashrate surges, block timing patterns, mempool volatility) and includes clear analysis messages with recommendations. Skipping checks during initial block download prevents false positives.
