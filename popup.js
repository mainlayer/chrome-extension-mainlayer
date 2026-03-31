/**
 * popup.js — Extension popup controller
 *
 * Responsibilities:
 *   1. Request entitlement status from the background service worker.
 *   2. Render the correct UI: free features (always), premium features (if entitled),
 *      or the upgrade prompt (if not entitled).
 *   3. Wire up free-feature and premium-feature action buttons.
 *   4. Initiate the Mainlayer payment flow when the user clicks "Upgrade".
 *   5. React to ENTITLEMENT_UPDATED messages from the background (post-payment).
 */

'use strict';

// ---------------------------------------------------------------------------
// DOM references
// ---------------------------------------------------------------------------
const entitlementBadge = document.getElementById('entitlementBadge');
const badgeLabel = document.getElementById('badgeLabel');

const premiumLoading = document.getElementById('premiumLoading');
const premiumUnlocked = document.getElementById('premiumUnlocked');
const premiumLocked = document.getElementById('premiumLocked');
const premiumError = document.getElementById('premiumError');
const errorMsg = document.getElementById('errorMsg');

const outputArea = document.getElementById('outputArea');
const outputTitle = document.getElementById('outputTitle');
const outputContent = document.getElementById('outputContent');

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let currentEntitlement = null; // true | false | null (unknown)

// ---------------------------------------------------------------------------
// Initialise
// ---------------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  bindButtons();
  listenForEntitlementUpdates();
  checkEntitlement();
});

// ---------------------------------------------------------------------------
// Entitlement check
// ---------------------------------------------------------------------------
async function checkEntitlement(forceRefresh = false) {
  showPremiumState('loading');
  setBadge('checking');

  try {
    const response = await sendMessage({ type: 'CHECK_ENTITLEMENT', forceRefresh });

    if (response.error && !response.entitled) {
      showPremiumState('error', response.error);
      setBadge('error');
      return;
    }

    currentEntitlement = Boolean(response.entitled);
    showPremiumState(currentEntitlement ? 'unlocked' : 'locked');
    setBadge(currentEntitlement ? 'entitled' : 'not-entitled');
  } catch (err) {
    showPremiumState('error', 'Could not reach the extension background. Please reload.');
    setBadge('error');
  }
}

// ---------------------------------------------------------------------------
// UI state helpers
// ---------------------------------------------------------------------------
function showPremiumState(state, message) {
  premiumLoading.classList.add('hidden');
  premiumUnlocked.classList.add('hidden');
  premiumLocked.classList.add('hidden');
  premiumError.classList.add('hidden');

  switch (state) {
    case 'loading':
      premiumLoading.classList.remove('hidden');
      break;
    case 'unlocked':
      premiumUnlocked.classList.remove('hidden');
      break;
    case 'locked':
      premiumLocked.classList.remove('hidden');
      break;
    case 'error':
      premiumError.classList.remove('hidden');
      if (message) errorMsg.textContent = message;
      break;
  }
}

function setBadge(state) {
  entitlementBadge.className = 'entitlement-badge';
  switch (state) {
    case 'checking':
      badgeLabel.textContent = 'Checking...';
      break;
    case 'entitled':
      entitlementBadge.classList.add('entitled');
      badgeLabel.textContent = 'Pro';
      break;
    case 'not-entitled':
      entitlementBadge.classList.add('not-entitled');
      badgeLabel.textContent = 'Free';
      break;
    default:
      badgeLabel.textContent = 'Error';
  }
}

// ---------------------------------------------------------------------------
// Output area
// ---------------------------------------------------------------------------
function showOutput(title, content) {
  outputTitle.textContent = title;
  outputContent.textContent = content;
  outputArea.classList.remove('hidden');
}

function hideOutput() {
  outputArea.classList.add('hidden');
  outputContent.textContent = '';
}

// ---------------------------------------------------------------------------
// Button wiring
// ---------------------------------------------------------------------------
function bindButtons() {
  // --- Free features ---
  document.getElementById('btnPageAnalysis').addEventListener('click', runPageAnalysis);
  document.getElementById('btnHighlight').addEventListener('click', runHighlight);

  // --- Premium features ---
  document.getElementById('btnAiSummary').addEventListener('click', runAiSummary);
  document.getElementById('btnExport').addEventListener('click', runExport);
  document.getElementById('btnAutoFill').addEventListener('click', runAutoFill);

  // --- Upgrade ---
  document.getElementById('btnUpgrade').addEventListener('click', initiatePayment);

  // --- Retry entitlement check ---
  document.getElementById('btnRetry').addEventListener('click', () => checkEntitlement(true));

  // --- Refresh status (footer) ---
  document.getElementById('btnRefreshStatus').addEventListener('click', () => checkEntitlement(true));

  // --- Close output ---
  document.getElementById('btnCloseOutput').addEventListener('click', hideOutput);
}

// ---------------------------------------------------------------------------
// Free feature handlers
// ---------------------------------------------------------------------------
async function runPageAnalysis() {
  const btn = document.getElementById('btnPageAnalysis');
  btn.disabled = true;
  btn.textContent = 'Running...';

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => ({
        title: document.title,
        url: window.location.href,
        wordCount: document.body.innerText.trim().split(/\s+/).filter(Boolean).length,
        headings: document.querySelectorAll('h1,h2,h3').length,
        links: document.querySelectorAll('a[href]').length,
        images: document.querySelectorAll('img').length,
      }),
    });

    const data = results[0].result;
    showOutput('Page Analysis', [
      `Title:    ${data.title}`,
      `Words:    ${data.wordCount.toLocaleString()}`,
      `Headings: ${data.headings}`,
      `Links:    ${data.links}`,
      `Images:   ${data.images}`,
    ].join('\n'));
  } catch (err) {
    showOutput('Page Analysis', `Error: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Run';
  }
}

async function runHighlight() {
  const btn = document.getElementById('btnHighlight');
  btn.disabled = true;
  btn.textContent = 'Running...';

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0 || selection.toString().trim() === '') {
          return { highlighted: false, text: '' };
        }
        const range = selection.getRangeAt(0);
        const mark = document.createElement('mark');
        mark.style.cssText = 'background: #fde68a; color: inherit; border-radius: 2px; padding: 0 1px;';
        range.surroundContents(mark);
        return { highlighted: true, text: selection.toString().slice(0, 80) };
      },
    });

    const result = results[0].result;
    if (result.highlighted) {
      showOutput('Highlight', `Highlighted: "${result.text}${result.text.length >= 80 ? '...' : ''}"`);
    } else {
      showOutput('Highlight', 'Select some text on the page first, then click Run.');
    }
  } catch (err) {
    showOutput('Highlight', `Error: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Run';
  }
}

// ---------------------------------------------------------------------------
// Premium feature handlers
// ---------------------------------------------------------------------------
async function runAiSummary() {
  if (!currentEntitlement) return;

  const btn = document.getElementById('btnAiSummary');
  btn.disabled = true;
  btn.textContent = 'Summarising...';

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => document.body.innerText.trim().slice(0, 2000),
    });

    const text = results[0].result;

    // TODO: Replace with a real AI summarisation call to your backend.
    // For the template we show the first two sentences as a placeholder.
    const sentences = text.replace(/\s+/g, ' ').split(/(?<=[.?!])\s+/);
    const preview = sentences.slice(0, 2).join(' ');

    showOutput(
      'AI Summary (preview)',
      preview
        ? `${preview}\n\n[Connect your AI backend to generate full summaries.]`
        : 'No readable text found on this page.'
    );
  } catch (err) {
    showOutput('AI Summary', `Error: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Run';
  }
}

async function runExport() {
  if (!currentEntitlement) return;

  const btn = document.getElementById('btnExport');
  btn.disabled = true;
  btn.textContent = 'Exporting...';

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => ({
        title: document.title,
        url: window.location.href,
        text: document.body.innerText.trim().slice(0, 5000),
        exportedAt: new Date().toISOString(),
      }),
    });

    const data = results[0].result;
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    await chrome.downloads.download({
      url,
      filename: `export-${Date.now()}.json`,
      saveAs: false,
    });

    showOutput('Export', 'Page exported as JSON. Check your Downloads folder.');
  } catch (err) {
    showOutput('Export', `Error: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Run';
  }
}

async function runAutoFill() {
  if (!currentEntitlement) return;

  const btn = document.getElementById('btnAutoFill');
  btn.disabled = true;
  btn.textContent = 'Scanning...';

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const inputs = Array.from(
          document.querySelectorAll('input:not([type=hidden]):not([type=submit]):not([type=button])')
        );
        return inputs.map((el) => ({
          type: el.type || 'text',
          name: el.name || el.id || el.placeholder || '',
          label: el.labels?.[0]?.textContent?.trim() || '',
        }));
      },
    });

    const fields = results[0].result;
    if (fields.length === 0) {
      showOutput('Auto Fill', 'No fillable form fields found on this page.');
    } else {
      showOutput(
        'Auto Fill',
        `Found ${fields.length} field(s):\n` +
          fields
            .slice(0, 8)
            .map((f) => `  [${f.type}] ${f.label || f.name || '(unnamed)'}`)
            .join('\n') +
          (fields.length > 8 ? `\n  ...and ${fields.length - 8} more` : '') +
          '\n\n[Connect your data store to auto-fill these fields.]'
      );
    }
  } catch (err) {
    showOutput('Auto Fill', `Error: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Run';
  }
}

// ---------------------------------------------------------------------------
// Payment flow
// ---------------------------------------------------------------------------
async function initiatePayment() {
  const btn = document.getElementById('btnUpgrade');
  btn.disabled = true;
  btn.textContent = 'Opening payment...';

  try {
    const response = await sendMessage({ type: 'INITIATE_PAYMENT' });

    if (response.error) {
      alert(`Could not initiate payment: ${response.error}`);
      return;
    }

    // Payment tab has been opened by the background. Show feedback.
    btn.textContent = 'Waiting for payment...';

    // The background will send ENTITLEMENT_UPDATED when done.
    // We keep the button disabled until we hear back.
  } catch (err) {
    alert(`Payment error: ${err.message}`);
    btn.disabled = false;
    btn.textContent = 'Upgrade Now →';
  }
}

// ---------------------------------------------------------------------------
// Listen for post-payment entitlement updates from background
// ---------------------------------------------------------------------------
function listenForEntitlementUpdates() {
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'ENTITLEMENT_UPDATED') {
      currentEntitlement = Boolean(message.entitled);
      showPremiumState(currentEntitlement ? 'unlocked' : 'locked');
      setBadge(currentEntitlement ? 'entitled' : 'not-entitled');

      if (currentEntitlement) {
        showOutput('Access Granted', 'Your premium features are now unlocked. Enjoy!');
      }

      // Re-enable upgrade button in case payment failed.
      const btn = document.getElementById('btnUpgrade');
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Upgrade Now →';
      }
    }
  });
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------
function sendMessage(message) {
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
