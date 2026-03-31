/**
 * background.js — Service Worker
 *
 * Handles:
 *   - Entitlement checks via Mainlayer API (with caching via chrome.storage.local)
 *   - Payment flow initiation (opens a new tab to the Mainlayer payment URL)
 *   - Messages from popup.js and content.js
 *
 * Message API (chrome.runtime.sendMessage):
 *
 *   { type: 'CHECK_ENTITLEMENT', resourceId, payerId, forceRefresh? }
 *     -> { entitled: boolean, error?: string }
 *
 *   { type: 'INITIATE_PAYMENT', resourceId, payerId }
 *     -> { paymentUrl: string, sessionId: string, error?: string }
 *
 *   { type: 'GET_PAYER_ID' }
 *     -> { payerId: string }
 *
 *   { type: 'CLEAR_ENTITLEMENT_CACHE', resourceId?, payerId? }
 *     -> { success: boolean }
 */

importScripts('src/mainlayer.js', 'src/entitlement-manager.js');

// ---------------------------------------------------------------------------
// Configuration
// Replace RESOURCE_ID with the resource you created in the Mainlayer dashboard.
// ---------------------------------------------------------------------------
const RESOURCE_ID = 'YOUR_RESOURCE_ID';

/**
 * Get or create a stable payer ID for this browser/user.
 * Uses the Chrome extension install ID so it persists across sessions.
 * You can also prompt users to log in and use their account ID instead.
 *
 * @returns {Promise<string>}
 */
async function getPayerId() {
  return new Promise((resolve) => {
    chrome.storage.local.get('ml_payer_id', async (result) => {
      if (result.ml_payer_id) {
        resolve(result.ml_payer_id);
        return;
      }
      // Use the extension's unique installation ID as a stable payer identifier.
      chrome.instanceID
        ? chrome.instanceID.getID((id) => {
            const payerId = `ext_${id}`;
            chrome.storage.local.set({ ml_payer_id: payerId });
            resolve(payerId);
          })
        : // Fallback: generate a random UUID and persist it.
          (async () => {
            const uuid = crypto.randomUUID();
            const payerId = `ext_${uuid}`;
            chrome.storage.local.set({ ml_payer_id: payerId });
            resolve(payerId);
          })();
    });
  });
}

/**
 * Get the Mainlayer API key from extension storage.
 * Users set this via the extension's options page.
 *
 * @returns {Promise<string|null>}
 */
async function getApiKey() {
  return new Promise((resolve) => {
    chrome.storage.local.get('ml_api_key', (result) => {
      resolve(result.ml_api_key || null);
    });
  });
}

/**
 * Build a MainlayerClient + EntitlementManager pair.
 * Returns null if no API key is configured.
 *
 * @returns {Promise<{client: MainlayerClient, manager: EntitlementManager}|null>}
 */
async function buildClients() {
  const apiKey = await getApiKey();
  if (!apiKey) {
    console.warn('[background] No Mainlayer API key configured.');
    return null;
  }
  const client = new MainlayerClient(apiKey);
  const manager = new EntitlementManager(client, {
    ttlMs: 15 * 60 * 1000, // 15 minutes
    failClosed: false,
  });
  return { client, manager };
}

// ---------------------------------------------------------------------------
// Message handler
// ---------------------------------------------------------------------------
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then(sendResponse)
    .catch((err) => {
      console.error('[background] Unhandled error in message handler:', err);
      sendResponse({ error: err.message || 'Unknown error' });
    });

  // Return true to indicate we'll respond asynchronously.
  return true;
});

/**
 * Route incoming messages to the appropriate handler.
 *
 * @param {Object} message
 * @param {chrome.runtime.MessageSender} sender
 * @returns {Promise<Object>}
 */
async function handleMessage(message, sender) {
  switch (message.type) {
    case 'CHECK_ENTITLEMENT':
      return handleCheckEntitlement(message);

    case 'INITIATE_PAYMENT':
      return handleInitiatePayment(message);

    case 'GET_PAYER_ID':
      return handleGetPayerId();

    case 'CLEAR_ENTITLEMENT_CACHE':
      return handleClearCache(message);

    default:
      return { error: `Unknown message type: ${message.type}` };
  }
}

/**
 * Handle CHECK_ENTITLEMENT messages.
 */
async function handleCheckEntitlement(message) {
  const { resourceId = RESOURCE_ID, payerId: overridePayerId, forceRefresh = false } = message;

  const payerId = overridePayerId || (await getPayerId());
  const clients = await buildClients();

  if (!clients) {
    return {
      entitled: false,
      error: 'Mainlayer API key not configured. Please open extension options.',
    };
  }

  try {
    const entitled = await clients.manager.checkEntitlement(resourceId, payerId, {
      forceRefresh,
    });
    return { entitled, payerId };
  } catch (err) {
    console.error('[background] checkEntitlement error:', err);
    return { entitled: false, error: err.message };
  }
}

/**
 * Handle INITIATE_PAYMENT messages.
 * Creates a Mainlayer payment session and opens the payment URL in a new tab.
 */
async function handleInitiatePayment(message) {
  const { resourceId = RESOURCE_ID, payerId: overridePayerId } = message;

  const payerId = overridePayerId || (await getPayerId());
  const clients = await buildClients();

  if (!clients) {
    return {
      error: 'Mainlayer API key not configured. Please open extension options.',
    };
  }

  try {
    const session = await clients.client.createPaymentSession(resourceId, payerId);

    // Open the payment page in a new tab.
    chrome.tabs.create({ url: session.paymentUrl });

    // Watch for the tab to close (payment completed or user cancelled).
    listenForPaymentCompletion(session.sessionId, resourceId, payerId, clients.manager);

    return { paymentUrl: session.paymentUrl, sessionId: session.sessionId };
  } catch (err) {
    console.error('[background] createPaymentSession error:', err);
    return { error: err.message };
  }
}

/**
 * After payment, watch for the user to close the payment tab, then re-check entitlement
 * and notify the popup.
 *
 * @param {string} sessionId
 * @param {string} resourceId
 * @param {string} payerId
 * @param {EntitlementManager} manager
 */
function listenForPaymentCompletion(sessionId, resourceId, payerId, manager) {
  const checkDelay = 3000; // Wait 3s after tab close before re-checking.

  chrome.tabs.onUpdated.addListener(async function listener(tabId, changeInfo, tab) {
    // Look for the payment success redirect (Mainlayer appends ?payment=success).
    if (
      changeInfo.status === 'complete' &&
      tab.url &&
      tab.url.includes('payment=success')
    ) {
      chrome.tabs.onUpdated.removeListener(listener);

      // Give the payment processor a moment to confirm.
      await sleep(checkDelay);

      const entitled = await manager.checkEntitlement(resourceId, payerId, {
        forceRefresh: true,
      });

      // Notify any open popup about the updated entitlement.
      chrome.runtime.sendMessage({
        type: 'ENTITLEMENT_UPDATED',
        entitled,
        resourceId,
        payerId,
      }).catch(() => {
        // Popup may be closed — that's fine.
      });
    }
  });
}

/**
 * Handle GET_PAYER_ID messages.
 */
async function handleGetPayerId() {
  const payerId = await getPayerId();
  return { payerId };
}

/**
 * Handle CLEAR_ENTITLEMENT_CACHE messages.
 */
async function handleClearCache(message) {
  const clients = await buildClients();
  if (!clients) return { success: false, error: 'No API key configured' };

  try {
    if (message.resourceId && message.payerId) {
      await clients.manager.clearCache(message.resourceId, message.payerId);
    } else {
      await clients.manager.clearAllCache();
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Extension install / update handler
// ---------------------------------------------------------------------------
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('[background] Extension installed. Welcome to My Premium Extension!');
    // Open the options page so users can enter their Mainlayer API key.
    chrome.runtime.openOptionsPage?.();
  } else if (details.reason === 'update') {
    console.log(`[background] Extension updated to version ${chrome.runtime.getManifest().version}`);
  }
});
