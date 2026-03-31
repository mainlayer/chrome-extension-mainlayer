/**
 * EntitlementManager
 *
 * Manages entitlement state in chrome.storage.local with TTL-based caching.
 * Designed to work in both the background service worker and the popup.
 *
 * Cache strategy:
 *   - On cache hit (not expired): return cached value immediately.
 *   - On cache miss or expiry:   fetch from Mainlayer, update cache.
 *   - On network error:          return last known cached state (fail open or fail closed
 *                                per FAIL_CLOSED_ON_ERROR setting).
 */

/**
 * Default cache TTL in milliseconds (15 minutes).
 * Adjust via EntitlementManager options.
 */
const DEFAULT_TTL_MS = 15 * 60 * 1000;

/**
 * When true, a network error causes checkEntitlement to return false (deny access).
 * When false, the last cached state is returned instead (allow if previously granted).
 */
const FAIL_CLOSED_ON_ERROR = false;

const STORAGE_PREFIX = 'ml_entitlement_';

/**
 * @typedef {Object} CachedEntitlement
 * @property {boolean} entitled
 * @property {number}  cachedAt   - Unix timestamp (ms) when this was stored.
 * @property {number}  expiresAt  - Unix timestamp (ms) after which this is stale.
 * @property {string}  [apiExpiresAt] - ISO string from Mainlayer if present.
 */

class EntitlementManager {
  /**
   * @param {import('./mainlayer').MainlayerClient} client - Mainlayer API client instance.
   * @param {Object} [options]
   * @param {number}  [options.ttlMs=900000]          - Cache TTL in milliseconds.
   * @param {boolean} [options.failClosed=false]       - Whether to deny on network error.
   * @param {string}  [options.storagePrefix]          - Prefix for chrome.storage.local keys.
   */
  constructor(client, options = {}) {
    if (!client) throw new Error('EntitlementManager: client is required');
    this.client = client;
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.failClosed = options.failClosed ?? FAIL_CLOSED_ON_ERROR;
    this.prefix = options.storagePrefix ?? STORAGE_PREFIX;
  }

  /**
   * Build the storage key for a given resource + payer combination.
   * @param {string} resourceId
   * @param {string} payerId
   * @returns {string}
   */
  _storageKey(resourceId, payerId) {
    return `${this.prefix}${resourceId}__${payerId}`;
  }

  /**
   * Read a cached entitlement from chrome.storage.local.
   * @param {string} key
   * @returns {Promise<CachedEntitlement|null>}
   */
  async _readCache(key) {
    return new Promise((resolve) => {
      chrome.storage.local.get(key, (result) => {
        if (chrome.runtime.lastError) {
          console.warn('[EntitlementManager] Storage read error:', chrome.runtime.lastError);
          resolve(null);
          return;
        }
        resolve(result[key] || null);
      });
    });
  }

  /**
   * Write a cached entitlement to chrome.storage.local.
   * @param {string} key
   * @param {CachedEntitlement} value
   * @returns {Promise<void>}
   */
  async _writeCache(key, value) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ [key]: value }, () => {
        if (chrome.runtime.lastError) {
          console.warn('[EntitlementManager] Storage write error:', chrome.runtime.lastError);
        }
        resolve();
      });
    });
  }

  /**
   * Remove a cached entitlement from chrome.storage.local.
   * @param {string} resourceId
   * @param {string} payerId
   * @returns {Promise<void>}
   */
  async clearCache(resourceId, payerId) {
    const key = this._storageKey(resourceId, payerId);
    return new Promise((resolve) => {
      chrome.storage.local.remove(key, resolve);
    });
  }

  /**
   * Remove ALL cached entitlements managed by this instance.
   * @returns {Promise<void>}
   */
  async clearAllCache() {
    return new Promise((resolve) => {
      chrome.storage.local.get(null, (items) => {
        const keysToRemove = Object.keys(items).filter((k) =>
          k.startsWith(this.prefix)
        );
        if (keysToRemove.length === 0) {
          resolve();
          return;
        }
        chrome.storage.local.remove(keysToRemove, resolve);
      });
    });
  }

  /**
   * Check whether a user is entitled to a resource.
   * Serves from cache when possible; otherwise calls the Mainlayer API.
   *
   * @param {string} resourceId - The resource/feature to gate.
   * @param {string} payerId    - Stable identifier for the current user.
   * @param {Object} [opts]
   * @param {boolean} [opts.forceRefresh=false] - Skip cache and fetch fresh data.
   * @returns {Promise<boolean>} - true if entitled, false otherwise.
   */
  async checkEntitlement(resourceId, payerId, opts = {}) {
    if (!resourceId) throw new Error('checkEntitlement: resourceId is required');
    if (!payerId) throw new Error('checkEntitlement: payerId is required');

    const key = this._storageKey(resourceId, payerId);
    const now = Date.now();

    // Check cache unless force refresh requested.
    if (!opts.forceRefresh) {
      const cached = await this._readCache(key);
      if (cached && cached.expiresAt > now) {
        console.debug(
          `[EntitlementManager] Cache hit for ${resourceId} (expires in ${Math.round((cached.expiresAt - now) / 1000)}s)`
        );
        return cached.entitled;
      }
    }

    // Cache miss or expired — fetch from Mainlayer.
    try {
      const result = await this.client.checkEntitlement(resourceId, payerId);

      // Determine effective TTL: use API-provided expiry if it's sooner than our TTL.
      let expiresAt = now + this.ttlMs;
      if (result.expiresAt) {
        const apiExpiry = new Date(result.expiresAt).getTime();
        if (apiExpiry < expiresAt) expiresAt = apiExpiry;
      }

      const cacheEntry = {
        entitled: result.entitled,
        cachedAt: now,
        expiresAt,
        apiExpiresAt: result.expiresAt || null,
      };

      await this._writeCache(key, cacheEntry);

      console.debug(
        `[EntitlementManager] Fetched entitlement for ${resourceId}: ${result.entitled}`
      );

      return result.entitled;
    } catch (error) {
      console.error('[EntitlementManager] API error:', error.message);

      // Attempt to use stale cache on error.
      const stale = await this._readCache(key);
      if (stale !== null) {
        console.warn(
          `[EntitlementManager] Using stale cache (${this.failClosed ? 'fail-closed' : 'stale value'})`
        );
        return this.failClosed ? false : stale.entitled;
      }

      // No cache available — apply fail-closed/open policy.
      return this.failClosed ? false : false; // No prior state → deny by default.
    }
  }

  /**
   * Return the full cached entitlement object (useful for debugging or showing expiry info).
   * Returns null if no cache entry exists or it has expired.
   *
   * @param {string} resourceId
   * @param {string} payerId
   * @returns {Promise<CachedEntitlement|null>}
   */
  async getCachedState(resourceId, payerId) {
    const key = this._storageKey(resourceId, payerId);
    const cached = await this._readCache(key);
    if (!cached) return null;
    return cached;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { EntitlementManager };
} else if (typeof globalThis !== 'undefined') {
  globalThis.EntitlementManager = EntitlementManager;
}
