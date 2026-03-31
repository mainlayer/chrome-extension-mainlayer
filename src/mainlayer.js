/**
 * Mainlayer API Client for Chrome Extensions
 *
 * Mainlayer is the payments layer for AI agents and browser extensions.
 * Use this client to check user entitlements and gate premium features.
 *
 * Base URL: https://api.mainlayer.fr
 * Auth:     Authorization: Bearer <api_key>
 */

const MAINLAYER_BASE_URL = 'https://api.mainlayer.fr';

class MainlayerError extends Error {
  constructor(message, statusCode, body) {
    super(message);
    this.name = 'MainlayerError';
    this.statusCode = statusCode;
    this.body = body;
  }
}

class MainlayerClient {
  /**
   * @param {string} apiKey - Your Mainlayer API key (set via extension options, not hardcoded)
   */
  constructor(apiKey) {
    if (!apiKey || typeof apiKey !== 'string' || apiKey.trim() === '') {
      throw new Error('MainlayerClient: apiKey is required');
    }
    this.apiKey = apiKey;
    this.baseUrl = MAINLAYER_BASE_URL;
  }

  /**
   * Build common request headers.
   * @returns {Record<string, string>}
   */
  _headers() {
    return {
      'Authorization': `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
      'X-Client': 'chrome-extension/1.0.0',
    };
  }

  /**
   * Internal fetch wrapper with error handling.
   * @param {string} path
   * @param {RequestInit} [options]
   * @returns {Promise<any>}
   */
  async _request(path, options = {}) {
    const url = `${this.baseUrl}${path}`;
    let response;

    try {
      response = await fetch(url, {
        ...options,
        headers: {
          ...this._headers(),
          ...(options.headers || {}),
        },
      });
    } catch (networkError) {
      throw new MainlayerError(
        `Network error reaching Mainlayer: ${networkError.message}`,
        0,
        null
      );
    }

    let body;
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      body = await response.json();
    } else {
      body = await response.text();
    }

    if (!response.ok) {
      const message =
        (body && body.error) ||
        (body && body.message) ||
        `Mainlayer API error: ${response.status}`;
      throw new MainlayerError(message, response.status, body);
    }

    return body;
  }

  /**
   * Check whether a user (identified by payerId) has access to a resource.
   *
   * @param {string} resourceId  - The resource/feature ID you defined in the Mainlayer dashboard.
   * @param {string} payerId     - A stable identifier for the current user (e.g. a hashed email,
   *                               extension install ID, or anything else that does not change).
   * @returns {Promise<EntitlementResult>}
   *
   * @typedef {Object} EntitlementResult
   * @property {boolean} entitled        - Whether the user has access.
   * @property {string}  resourceId      - The resource that was checked.
   * @property {string}  payerId         - The payer that was checked.
   * @property {string}  [expiresAt]     - ISO timestamp when the entitlement expires (if applicable).
   * @property {Object}  [paymentInfo]   - Additional payment details returned by Mainlayer.
   */
  async checkEntitlement(resourceId, payerId) {
    if (!resourceId) throw new Error('checkEntitlement: resourceId is required');
    if (!payerId) throw new Error('checkEntitlement: payerId is required');

    const body = await this._request('/entitlements/check', {
      method: 'POST',
      body: JSON.stringify({ resourceId, payerId }),
    });

    return {
      entitled: Boolean(body.entitled),
      resourceId: body.resourceId || resourceId,
      payerId: body.payerId || payerId,
      expiresAt: body.expiresAt || null,
      paymentInfo: body.paymentInfo || null,
    };
  }

  /**
   * Discover the payment details for a resource (price, currency, description).
   * Use this to show users what they'll be paying for before initiating payment.
   *
   * @param {string} resourceId - The resource ID to look up.
   * @returns {Promise<ResourceDetails>}
   *
   * @typedef {Object} ResourceDetails
   * @property {string} resourceId
   * @property {string} name
   * @property {string} description
   * @property {number} price        - Price in the smallest unit of the currency (e.g. cents).
   * @property {string} currency     - ISO 4217 currency code (e.g. "USD").
   * @property {string} [billingType] - "one_time" | "subscription"
   */
  async discover(resourceId) {
    if (!resourceId) throw new Error('discover: resourceId is required');

    const body = await this._request(`/resources/${encodeURIComponent(resourceId)}`);
    return body;
  }

  /**
   * Initiate a payment session for a resource.
   * Returns a URL the user should be directed to in order to complete payment.
   *
   * @param {string} resourceId
   * @param {string} payerId
   * @param {string} [successUrl] - Where to redirect after successful payment.
   * @param {string} [cancelUrl]  - Where to redirect if the user cancels.
   * @returns {Promise<PaymentSession>}
   *
   * @typedef {Object} PaymentSession
   * @property {string} sessionId
   * @property {string} paymentUrl - Open this URL in a tab to complete payment.
   * @property {string} [expiresAt]
   */
  async createPaymentSession(resourceId, payerId, successUrl, cancelUrl) {
    if (!resourceId) throw new Error('createPaymentSession: resourceId is required');
    if (!payerId) throw new Error('createPaymentSession: payerId is required');

    const payload = { resourceId, payerId };
    if (successUrl) payload.successUrl = successUrl;
    if (cancelUrl) payload.cancelUrl = cancelUrl;

    const body = await this._request('/payments/sessions', {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    return {
      sessionId: body.sessionId,
      paymentUrl: body.paymentUrl,
      expiresAt: body.expiresAt || null,
    };
  }
}

// Export for use both as an ES module (bundled) and as a plain script.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { MainlayerClient, MainlayerError };
} else if (typeof globalThis !== 'undefined') {
  globalThis.MainlayerClient = MainlayerClient;
  globalThis.MainlayerError = MainlayerError;
}
