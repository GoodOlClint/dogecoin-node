/**
 * Peer Enrichment Service
 * Provides DNS resolution and geolocation for peer IP addresses
 */

const dns = require('dns').promises;
const geoip = require('geoip-lite');
const { createChildLogger } = require('../utils/logger');

class PeerEnrichmentService {
    constructor() {
        this.logger = createChildLogger({ service: 'peer-enrichment' });
        this.dnsCache = new Map();
        this.geoCache = new Map();
        this.cacheTimeout = 1000 * 60 * 60; // 1 hour cache
    }

    /**
     * Enriches peer data with DNS resolution and geolocation
     * @param {Array} peers - Array of peer objects from Dogecoin RPC
     * @returns {Promise<Array>} Enhanced peer objects
     */
    async enrichPeers(peers) {
        if (!peers || !Array.isArray(peers)) {
            return [];
        }

        this.logger.debug(`Enriching ${peers.length} peers with DNS and geo data`);

        const enrichedPeers = await Promise.all(
            peers.map(async(peer) => {
                try {
                    const enrichedPeer = { ...peer };
                    const ipAddress = this.extractIPAddress(peer.addr);

                    if (ipAddress) {
                        // Add DNS resolution (non-blocking)
                        enrichedPeer.dns = await this.resolveDNS(ipAddress);

                        // Add geolocation
                        enrichedPeer.geo = this.getGeolocation(ipAddress);
                    }

                    return enrichedPeer;
                } catch (error) {
                    this.logger.warn(`Failed to enrich peer ${peer.addr}`, { error: error.message });
                    return peer; // Return original peer if enrichment fails
                }
            })
        );

        this.logger.debug(`Successfully enriched ${enrichedPeers.length} peers`);
        return enrichedPeers;
    }

    /**
     * Extracts IP address from peer address string
     * @param {string} peerAddr - Peer address (e.g., "192.168.1.1:22556")
     * @returns {string|null} IP address or null if invalid
     */
    extractIPAddress(peerAddr) {
        try {
            // Handle IPv6 addresses in brackets [::1]:22556
            if (peerAddr.startsWith('[')) {
                const match = peerAddr.match(/^\[([^\]]+)\]/);
                return match ? match[1] : null;
            }

            // Handle IPv4 addresses 192.168.1.1:22556
            const parts = peerAddr.split(':');
            if (parts.length >= 2) {
                return parts[0];
            }

            return null;
        } catch (error) {
            this.logger.warn(`Invalid peer address format: ${peerAddr}`, { error: error.message });
            return null;
        }
    }

    /**
     * Resolves DNS name for IP address with caching
     * @param {string} ipAddress - IP address to resolve
     * @returns {Promise<string|null>} DNS name or null if resolution fails
     */
    async resolveDNS(ipAddress) {
        try {
            // Check cache first
            const cacheKey = `dns:${ipAddress}`;
            const cached = this.getCachedValue(cacheKey);
            if (cached !== null) {
                return cached;
            }

            // Skip private/local IP addresses
            if (this.isPrivateIP(ipAddress)) {
                const result = 'Private Network';
                this.setCachedValue(cacheKey, result);
                return result;
            }

            // Perform reverse DNS lookup with timeout
            const hostnames = await Promise.race([
                dns.reverse(ipAddress),
                new Promise((_, reject) => setTimeout(() => reject(new Error('DNS timeout')), 3000))
            ]);

            const hostname = hostnames && hostnames.length > 0 ? hostnames[0] : null;
            this.setCachedValue(cacheKey, hostname);

            this.logger.debug(`DNS resolved: ${ipAddress} -> ${hostname}`);
            return hostname;
        } catch (error) {
            // Cache null result to avoid repeated lookups
            this.setCachedValue(`dns:${ipAddress}`, null);
            this.logger.debug(`DNS resolution failed for ${ipAddress}: ${error.message}`);
            return null;
        }
    }

    /**
     * Gets geolocation information for IP address
     * @param {string} ipAddress - IP address to geolocate
     * @returns {Object|null} Geolocation data or null
     */
    getGeolocation(ipAddress) {
        try {
            // Check cache first
            const cacheKey = `geo:${ipAddress}`;
            const cached = this.getCachedValue(cacheKey);
            if (cached !== null) {
                return cached;
            }

            // Skip private/local IP addresses
            if (this.isPrivateIP(ipAddress)) {
                const result = {
                    country: 'Private',
                    region: 'Local Network',
                    city: 'Private',
                    flag: '🏠'
                };
                this.setCachedValue(cacheKey, result);
                return result;
            }

            // Perform geolocation lookup
            const geo = geoip.lookup(ipAddress);
            if (geo) {
                const result = {
                    country: geo.country,
                    region: geo.region,
                    city: geo.city,
                    timezone: geo.timezone,
                    flag: this.getCountryFlag(geo.country),
                    coords: geo.ll ? `${geo.ll[0]}, ${geo.ll[1]}` : null
                };

                this.setCachedValue(cacheKey, result);
                this.logger.debug(`Geolocation found: ${ipAddress} -> ${geo.country}, ${geo.city}`);
                return result;
            }

            // Cache null result
            this.setCachedValue(cacheKey, null);
            return null;
        } catch (error) {
            this.logger.warn(`Geolocation failed for ${ipAddress}`, { error: error.message });
            this.setCachedValue(`geo:${ipAddress}`, null);
            return null;
        }
    }

    /**
     * Checks if IP address is private/local
     * @param {string} ipAddress - IP address to check
     * @returns {boolean} True if private/local
     */
    isPrivateIP(ipAddress) {
        // IPv4 private ranges
        if (ipAddress.match(/^10\./)) {
return true;
}
        if (ipAddress.match(/^192\.168\./)) {
return true;
}
        if (ipAddress.match(/^172\.(1[6-9]|2[0-9]|3[0-1])\./)) {
return true;
}
        if (ipAddress.match(/^127\./)) {
return true;
}
        if (ipAddress.match(/^169\.254\./)) {
return true;
}

        // IPv6 private ranges
        if (ipAddress.startsWith('::1')) {
return true;
}
        if (ipAddress.startsWith('fc')) {
return true;
}
        if (ipAddress.startsWith('fd')) {
return true;
}
        if (ipAddress.startsWith('fe80')) {
return true;
}

        return false;
    }

    /**
     * Gets country flag emoji for country code
     * @param {string} countryCode - Two-letter country code
     * @returns {string} Flag emoji or default
     */
    getCountryFlag(countryCode) {
        if (!countryCode || countryCode.length !== 2) {
            return '🌍';
        }

        const flagMap = {
            US: '🇺🇸', CN: '🇨🇳', DE: '🇩🇪', JP: '🇯🇵', GB: '🇬🇧',
            FR: '🇫🇷', KR: '🇰🇷', CA: '🇨🇦', IT: '🇮🇹', ES: '🇪🇸',
            AU: '🇦🇺', BR: '🇧🇷', IN: '🇮🇳', RU: '🇷🇺', NL: '🇳🇱',
            SE: '🇸🇪', NO: '🇳🇴', CH: '🇨🇭', AT: '🇦🇹', FI: '🇫🇮',
            DK: '🇩🇰', BE: '🇧🇪', PL: '🇵🇱', CZ: '🇨🇿', SG: '🇸🇬'
        };

        return flagMap[countryCode.toUpperCase()] || '🌍';
    }

    /**
     * Gets cached value if not expired
     * @param {string} key - Cache key
     * @returns {any|null} Cached value or null if expired/missing
     */
    getCachedValue(key) {
        const cached = this.dnsCache.get(key) || this.geoCache.get(key);
        if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
            return cached.value;
        }
        return null;
    }

    /**
     * Sets cached value with timestamp
     * @param {string} key - Cache key
     * @param {any} value - Value to cache
     */
    setCachedValue(key, value) {
        const cacheEntry = {
            value,
            timestamp: Date.now()
        };

        if (key.startsWith('dns:')) {
            this.dnsCache.set(key, cacheEntry);
        } else if (key.startsWith('geo:')) {
            this.geoCache.set(key, cacheEntry);
        }
    }

    /**
     * Clears expired cache entries
     */
    clearExpiredCache() {
        const now = Date.now();

        for (const [key, entry] of this.dnsCache.entries()) {
            if (now - entry.timestamp >= this.cacheTimeout) {
                this.dnsCache.delete(key);
            }
        }

        for (const [key, entry] of this.geoCache.entries()) {
            if (now - entry.timestamp >= this.cacheTimeout) {
                this.geoCache.delete(key);
            }
        }
    }

    /**
     * Gets cache statistics
     * @returns {Object} Cache statistics
     */
    getCacheStats() {
        return {
            dnsEntries: this.dnsCache.size,
            geoEntries: this.geoCache.size,
            totalEntries: this.dnsCache.size + this.geoCache.size
        };
    }
}

module.exports = PeerEnrichmentService;
