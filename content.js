/**
 * content.js — Content Script
 *
 * Runs in the context of every web page (see manifest.json content_scripts).
 *
 * Responsibilities:
 *   - Example of receiving messages from popup.js or background.js to manipulate the page.
 *   - Premium feature gating: only execute premium DOM operations after confirming
 *     entitlement via the background service worker.
 *
 * Pattern: content scripts should NOT call the Mainlayer API directly.
 * Instead, send a message to the background, which manages caching and auth.
 */

'use strict';

// ---------------------------------------------------------------------------
// Message listener
// ---------------------------------------------------------------------------
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message)
    .then(sendResponse)
    .catch((err) => sendResponse({ error: err.message }));

  // Return true to indicate async response.
  return true;
});

async function handleMessage(message) {
  switch (message.action) {
    case 'HIGHLIGHT_SELECTION':
      return highlightSelection(message.color);

    case 'INJECT_PREMIUM_BANNER':
      return injectPremiumBanner(message.text);

    case 'REMOVE_BANNERS':
      return removeBanners();

    case 'GET_PAGE_INFO':
      return getPageInfo();

    default:
      return { error: `Unknown action: ${message.action}` };
  }
}

// ---------------------------------------------------------------------------
// Free feature: highlight selected text
// ---------------------------------------------------------------------------
function highlightSelection(color = '#fde68a') {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.toString().trim() === '') {
    return { success: false, reason: 'No text selected' };
  }

  try {
    const range = selection.getRangeAt(0);
    const mark = document.createElement('mark');
    mark.dataset.mlHighlight = 'true';
    mark.style.cssText = [
      `background: ${color}`,
      'color: inherit',
      'border-radius: 2px',
      'padding: 0 1px',
    ].join('; ');
    range.surroundContents(mark);
    selection.removeAllRanges();
    return { success: true, text: mark.textContent.slice(0, 100) };
  } catch (err) {
    return { success: false, reason: err.message };
  }
}

// ---------------------------------------------------------------------------
// Premium feature: inject a banner at the top of the page
// ---------------------------------------------------------------------------
async function injectPremiumBanner(text) {
  // Guard: ask the background to confirm entitlement before modifying the DOM.
  const check = await sendToBackground({ type: 'CHECK_ENTITLEMENT' });
  if (!check.entitled) {
    return { success: false, reason: 'Not entitled' };
  }

  // Remove any existing banner first.
  removeBanners();

  const banner = document.createElement('div');
  banner.dataset.mlBanner = 'true';
  banner.style.cssText = [
    'position: fixed',
    'top: 0',
    'left: 0',
    'right: 0',
    'z-index: 2147483647',
    'background: #4f46e5',
    'color: white',
    'font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    'font-size: 13px',
    'font-weight: 500',
    'padding: 8px 16px',
    'display: flex',
    'align-items: center',
    'justify-content: space-between',
    'box-shadow: 0 2px 8px rgba(0,0,0,0.2)',
  ].join('; ');

  const messageEl = document.createElement('span');
  messageEl.textContent = text || 'My Premium Extension is active on this page.';

  const closeBtn = document.createElement('button');
  closeBtn.textContent = '×';
  closeBtn.style.cssText = [
    'background: none',
    'border: none',
    'color: white',
    'font-size: 18px',
    'cursor: pointer',
    'line-height: 1',
    'padding: 0 4px',
    'opacity: 0.8',
  ].join('; ');
  closeBtn.addEventListener('click', () => banner.remove());

  banner.appendChild(messageEl);
  banner.appendChild(closeBtn);
  document.body.prepend(banner);

  return { success: true };
}

// ---------------------------------------------------------------------------
// Utility: remove all injected banners
// ---------------------------------------------------------------------------
function removeBanners() {
  document.querySelectorAll('[data-ml-banner]').forEach((el) => el.remove());
  return { success: true };
}

// ---------------------------------------------------------------------------
// Utility: collect basic page info (used by popup page analysis)
// ---------------------------------------------------------------------------
function getPageInfo() {
  return {
    title: document.title,
    url: window.location.href,
    wordCount: document.body.innerText.trim().split(/\s+/).filter(Boolean).length,
    headings: document.querySelectorAll('h1, h2, h3').length,
    links: document.querySelectorAll('a[href]').length,
    images: document.querySelectorAll('img').length,
  };
}

// ---------------------------------------------------------------------------
// Helper: send a message to the background service worker
// ---------------------------------------------------------------------------
function sendToBackground(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(response || {});
    });
  });
}

// ---------------------------------------------------------------------------
// Observe URL changes in SPAs (optional: re-run page-level hooks on navigation)
// ---------------------------------------------------------------------------
let lastUrl = window.location.href;
const urlObserver = new MutationObserver(() => {
  if (window.location.href !== lastUrl) {
    lastUrl = window.location.href;
    // Notify background that the user navigated to a new page.
    sendToBackground({ type: 'PAGE_NAVIGATED', url: lastUrl }).catch(() => {});
  }
});

urlObserver.observe(document.documentElement, { subtree: true, childList: true });
