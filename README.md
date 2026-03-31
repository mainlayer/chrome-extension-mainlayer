# chrome-extension-mainlayer

Production-ready Chrome extension template with Mainlayer premium paywall. Gate features with one-time payment, instant entitlement checks, and 15-minute cache with smart fallback.

## Quick Start

```bash
# Clone and install
git clone https://github.com/mainlayer/chrome-extension-mainlayer.git
cd chrome-extension-mainlayer

# Set your Mainlayer API key in options
# (Open chrome://extensions → click on this extension → Options)
```

## Installation

### For Development

1. Clone this repository
2. Open `chrome://extensions/`
3. Enable "Developer mode" (top right)
4. Click "Load unpacked" and select this directory
5. Click the extension icon, then "Options" to set your API key

### For Distribution

1. Set up Chrome Web Store developer account
2. Create extension package with proper icons (16x16, 48x48, 128x128)
3. Upload to Chrome Web Store
4. Users install from store automatically

## Configuration

The extension requires your Mainlayer API key and resource IDs. These are configured in the Options page.

**Steps:**

1. Click the extension icon → "Options"
2. Enter your Mainlayer API key (from dashboard)
3. Enter resource IDs for free and premium features
4. Save settings

**Don't hardcode credentials** — always use chrome.storage.local

## Architecture

```
.
├── manifest.json          # Extension metadata (Manifest v3)
├── popup.html             # Popup UI
├── popup.js               # Popup controller
├── popup.css              # Popup styling
├── background.js          # Service worker (background logic)
├── content.js             # Content script (page interaction)
├── src/
│   ├── mainlayer.js       # Mainlayer API client
│   └── entitlement-manager.js # Cache + entitlement logic
├── options.html           # Settings page (for API key)
├── options.js             # Settings controller
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

### Core Components

- **popup.js** — Popup UI controller. Checks entitlement, renders UI, handles actions.
- **background.js** — Service worker. Long-lived, handles messages, background refresh.
- **entitlement-manager.js** — Smart cache with 15-minute TTL. Falls back to stale cache on network error.
- **mainlayer.js** — Low-level API client (no dependencies).

## Features

- **Instant Entitlement Check** — Pop-up shows free/premium UI in milliseconds
- **Smart Caching** — 15-minute cache with automatic refresh
- **Graceful Degradation** — Works offline with last-known entitlement state
- **One-Time Payment** — No recurring billing, instant access
- **Feature Gating** — Separate UI for free vs premium features
- **No External Dependencies** — Vanilla JS, small bundle size
- **Dark Theme UI** — Accessible, modern components
- **Manifest v3 Compliant** — Future-proof, secure

## Usage

### Basic Flow

1. **User opens popup** → `popup.js` requests entitlement check
2. **Background checks cache** → 15-minute TTL
3. **Cache hit** → Render UI instantly
4. **Cache miss** → Fetch from Mainlayer, update cache
5. **User clicks "Upgrade"** → Open Mainlayer payment page
6. **Payment confirmed** → Background receives webhook notification
7. **Cache refreshed** → Next popup check shows premium features

### Adding New Features

Edit `popup.html` to add feature items:

```html
<div class="feature-item premium unlocked">
  <div class="feature-icon">⭐</div>
  <div class="feature-content">
    <p class="feature-name">Advanced Search</p>
    <p class="feature-desc">Search across your entire history.</p>
  </div>
  <button class="btn btn-primary btn-sm" id="btnAdvancedSearch">Run</button>
</div>
```

Wire it up in `popup.js`:

```javascript
document.getElementById('btnAdvancedSearch').addEventListener('click', async () => {
  const result = await sendMessage({ type: 'RUN_ADVANCED_SEARCH' });
  showOutput('Advanced Search Results', result);
});
```

### Accessing in Content Scripts

Content scripts can also request entitlement via messages:

```javascript
// In content.js
chrome.runtime.sendMessage(
  { type: 'CHECK_ENTITLEMENT' },
  (response) => {
    if (response.entitled) {
      // Show premium features
    }
  }
);
```

## API Reference

### MainlayerClient

Instantiate in background.js:

```javascript
const client = new MainlayerClient(apiKey);
```

**Methods:**

- `checkEntitlement(resourceId, payerId)` — Returns `{ entitled, expiresAt }`
- `discover(resourceId)` — Get price, currency, description
- `createPaymentSession(resourceId, payerId)` — Returns `{ sessionId, paymentUrl }`

### EntitlementManager

High-level cache manager:

```javascript
const manager = new EntitlementManager(client, { ttlMs: 15 * 60 * 1000 });
```

**Methods:**

- `checkEntitlement(resourceId, payerId, opts)` — Smart cache + fallback
- `getCachedState(resourceId, payerId)` — Get cache entry with expiry
- `clearCache(resourceId, payerId)` — Clear one cache entry
- `clearAllCache()` — Clear all cached entitlements

**Options:**

```javascript
{
  ttlMs: 15 * 60 * 1000,      // 15-minute cache TTL
  failClosed: false,            // Deny on network error (default: allow)
  storagePrefix: 'ml_entitlement_'
}
```

## Deployment

### Prerequisites

- Chrome Web Store developer account ($5 one-time fee)
- Mainlayer API key and resource IDs configured
- Extension icons (16x16, 48x48, 128x128 PNG)

### Steps

```bash
# 1. Create package
zip -r chrome-extension.zip . \
  --exclude '*.git*' \
  --exclude 'node_modules/*' \
  --exclude '.env*'

# 2. Upload to Chrome Web Store
# https://chrome.google.com/webstore/developer/dashboard

# 3. Wait for review (usually 1-3 hours)

# 4. Users can install from:
# https://chrome.google.com/webstore/detail/YOUR_EXTENSION_ID
```

## Manifest v3 Details

Key security features:

- No remote script injection
- Content Security Policy (CSP) headers
- Secure message passing between scripts
- No eval() or innerHTML for untrusted content
- Storage limited to chrome.storage.local

Permissions used:

- `storage` — Save API key and cache in chrome.storage.local
- `activeTab` — Interact with current tab (if using content script)
- `host_permissions` — Call https://api.mainlayer.fr only

## Troubleshooting

### "Could not reach the extension background"

The service worker crashed. Reload the extension:

1. Go to `chrome://extensions/`
2. Find the extension
3. Click the reload icon

### API Key Not Found

Ensure you've set the API key in the Options page:

1. Click extension icon → "Options"
2. Enter your Mainlayer API key
3. Click "Save"

### Cache Not Clearing

Cache is stored in `chrome.storage.local`. To clear:

```javascript
// In DevTools console
chrome.storage.local.clear(() => console.log('Cleared'));
```

### Payment Flow Not Working

1. Check that `resourceId` is correct in Options
2. Verify API key has permission to create payment sessions
3. Test with `createPaymentSession` in DevTools

## Development

### Local Testing

```bash
# 1. Load unpacked extension (chrome://extensions/)
# 2. Make changes to source files
# 3. Click "Reload" button on extension tile
# 4. Test in popup or on a web page
```

### Debugging

Use Chrome DevTools:

```javascript
// In popup.js or background.js console:
chrome.storage.local.get(null, console.log); // View all storage

// In popup console:
await sendMessage({ type: 'CHECK_ENTITLEMENT', forceRefresh: true });

// In background console:
chrome.storage.local.clear(() => console.log('Cache cleared'));
```

## File Size

Expected bundle sizes:

- `popup.html` + `popup.js` + `popup.css` → ~15 KB
- `src/mainlayer.js` → ~5 KB
- `src/entitlement-manager.js` → ~8 KB
- Total (uncompressed) → ~28 KB
- Total (zipped) → ~8 KB

## Support

- **Docs**: https://docs.mainlayer.fr
- **Issues**: Report on GitHub
- **Contact**: support@mainlayer.fr

## License

MIT
