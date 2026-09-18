// background.js
//
// Firefox restricts which WebExtension APIs are exposed inside a DevTools
// panel context: only chrome.devtools.* is guaranteed available there.
// chrome.scripting, chrome.storage, and chrome.runtime.getManifest() are
// NOT accessible from panel.js on Firefox (they are on Chrome, which is why
// this split wasn't needed before). This background script acts as a relay:
// panel.js sends it a message, it calls the real API (which IS available
// here), and returns the result.
//
// Functions that need to run inside the inspected page (highlight overlay)
// can't be passed as serialized closures across sendMessage, so they're
// defined here directly and referenced by message type instead.

const browserAPI = typeof browser !== 'undefined' ? browser : chrome;

// --- Functions injected into the inspected page ---
// (must be self-contained: no access to background/panel-scope variables)

function highlightElementInPage(selectors) {
  const OVERLAY_ID = '__flax_a11y_overlay__';
  const STYLE_ID = '__flax_a11y_style__';

  document.getElementById(OVERLAY_ID)?.remove();
  if (window.__flaxA11yCleanup) {
    window.__flaxA11yCleanup();
    window.__flaxA11yCleanup = null;
  }

  let el = null;
  try {
    const selector = Array.isArray(selectors) ? selectors[selectors.length - 1] : selectors;
    el = document.querySelector(selector);
  } catch (e) {
    // invalid selector, ignore
  }

  if (!el) return;

  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${OVERLAY_ID} {
        position: fixed;
        pointer-events: none;
        border: 2px solid #d93025;
        border-radius: 2px;
        box-shadow:
          0 0 0 2px rgba(217, 48, 37, 0.35),
          0 0 6px 4px rgba(217, 48, 37, 0.22),
          0 0 14px 8px rgba(217, 48, 37, 0.10);
        z-index: 2147483647;
        transition: all 80ms ease-out;
      }
    `;
    document.documentElement.appendChild(style);
  }

  const overlay = document.createElement('div');
  overlay.id = OVERLAY_ID;
  document.documentElement.appendChild(overlay);

  function positionOverlay() {
    const rect = el.getBoundingClientRect();
    overlay.style.top = `${rect.top}px`;
    overlay.style.left = `${rect.left}px`;
    overlay.style.width = `${rect.width}px`;
    overlay.style.height = `${rect.height}px`;
  }

  positionOverlay();
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });

  const onScrollOrResize = () => positionOverlay();
  window.addEventListener('scroll', onScrollOrResize, true);
  window.addEventListener('resize', onScrollOrResize);

  window.__flaxA11yCleanup = () => {
    window.removeEventListener('scroll', onScrollOrResize, true);
    window.removeEventListener('resize', onScrollOrResize);
    document.getElementById(OVERLAY_ID)?.remove();
  };
}

function clearHighlightInPage() {
  const OVERLAY_ID = '__flax_a11y_overlay__';
  if (window.__flaxA11yCleanup) {
    window.__flaxA11yCleanup();
    window.__flaxA11yCleanup = null;
  } else {
    document.getElementById(OVERLAY_ID)?.remove();
  }
}

// axe.run() wrapped as a page-context function, same as before.
function runAxeInPage(options) {
  return new Promise((resolve, reject) => {
    if (typeof axe === 'undefined') {
      return reject(new Error('axe-core is not available in the page context.'));
    }
    axe.run(options, (err, results) => {
      if (err) reject(err);
      else resolve(results);
    });
  });
}

// --- Message relay ---
// panel.js can't call scripting/storage/runtime.getManifest directly on
// Firefox, so it sends { type, ...payload } messages here instead.

browserAPI.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message).then(sendResponse).catch((error) => {
    sendResponse({ error: error?.message || String(error) });
  });
  return true; // keep the message channel open for the async response
});

async function handleMessage(message) {
  switch (message?.type) {
    case 'INJECT_AXE':
      await browserAPI.scripting.executeScript({
        target: { tabId: message.tabId },
        files: ['lib/axe.min.js']
      });
      return { ok: true };

    case 'RUN_AXE_SCAN': {
      const results = await browserAPI.scripting.executeScript({
        target: { tabId: message.tabId },
        func: runAxeInPage,
        args: [message.options]
      });
      return { result: results[0].result };
    }

    case 'HIGHLIGHT_ELEMENT':
      await browserAPI.scripting.executeScript({
        target: { tabId: message.tabId },
        func: highlightElementInPage,
        args: [message.target]
      });
      return { ok: true };

    case 'CLEAR_HIGHLIGHT':
      await browserAPI.scripting.executeScript({
        target: { tabId: message.tabId },
        func: clearHighlightInPage
      });
      return { ok: true };

    case 'STORAGE_GET': {
      const stored = await browserAPI.storage.local.get(message.key);
      return { value: stored[message.key] };
    }

    case 'STORAGE_SET':
      await browserAPI.storage.local.set(message.items);
      return { ok: true };

    case 'GET_MANIFEST':
      return { manifest: browserAPI.runtime.getManifest() };

    default:
      throw new Error(`Unknown message type: ${message?.type}`);
  }
}