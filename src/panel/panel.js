const inspectedTabId = chrome.devtools.inspectedWindow.tabId;

const failuresListEl = document.getElementById('failures-list');
const failuresListInnerEl = document.getElementById('failures-list-inner');
const failureDetailsEl = document.getElementById('failure-details');
const summaryCountTextEl = document.getElementById('summary-count-text');
const summaryWcagTextEl = document.getElementById('summary-wcag-text');
const scanBtn = document.getElementById('scan-btn');
const mainContainerEl = document.getElementById('main-container');
const bpToggleBtn = document.getElementById('bp-toggle-btn');
const exportCsvBtn = document.getElementById('export-csv-btn');

const scanViewEl = document.getElementById('scan-view');
const settingsViewEl = document.getElementById('settings-view');
const settingsBtn = document.getElementById('settings-btn');
const settingsBackBtn = document.getElementById('settings-back-btn');
const versionExtensionEl = document.getElementById('version-extension');
const versionAxeEl = document.getElementById('version-axe');
const themeSelectEl = document.getElementById('theme-select');
const wcagSelectEl = document.getElementById('wcag-select');
const bpEnableEl = document.getElementById('bp-enable');
const bpDisableEl = document.getElementById('bp-disable');

let currentFailures = [];
let selectedIndex = null;
let highlightedNodeKey = null; // identifies the element currently highlighted on the page
let hasScanned = false; // distinguishes "not yet scanned" from "scanned, zero issues"

// Display order for severities (most to least severe)
const IMPACT_ORDER = { critical: 0, serious: 1, moderate: 2, minor: 3 };

// Placeholder until axe-core's version can be read dynamically (it's installed via npm)
const AXE_CORE_VERSION = '4.10.3';

// Each WCAG level cumulatively includes all lower levels/versions, per axe-core's tag semantics
const WCAG_TAG_SETS = {
  wcag2a: ['wcag2a'],
  wcag2aa: ['wcag2a', 'wcag2aa'],
  wcag2aaa: ['wcag2a', 'wcag2aa', 'wcag2aaa'],
  wcag21a: ['wcag2a', 'wcag21a'],
  wcag21aa: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'],
  wcag21aaa: ['wcag2a', 'wcag2aa', 'wcag2aaa', 'wcag21a', 'wcag21aa'],
  wcag22a: ['wcag2a', 'wcag21a', 'wcag22a'],
  wcag22aa: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22a', 'wcag22aa'],
  wcag22aaa: ['wcag2a', 'wcag2aa', 'wcag2aaa', 'wcag21a', 'wcag21aa', 'wcag22a', 'wcag22aa']
};

// Human-readable labels for the toolbar recap, kept in sync with WCAG_TAG_SETS's keys
const WCAG_STANDARD_LABELS = {
  wcag2a: 'WCAG 2.0 A',
  wcag2aa: 'WCAG 2.0 AA',
  wcag2aaa: 'WCAG 2.0 AAA',
  wcag21a: 'WCAG 2.1 A',
  wcag21aa: 'WCAG 2.1 AA',
  wcag21aaa: 'WCAG 2.1 AAA',
  wcag22a: 'WCAG 2.2 A',
  wcag22aa: 'WCAG 2.2 AA',
  wcag22aaa: 'WCAG 2.2 AAA'
};

const DEFAULT_SETTINGS = {
  theme: 'system',
  bestPractices: true,
  wcagStandard: 'wcag22aa'
};

let currentSettings = { ...DEFAULT_SETTINGS };

// Inline SVG icons (inherit color via currentColor)
const ICON_TARGET = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="3"/><line x1="12" y1="1" x2="12" y2="4"/><line x1="12" y1="20" x2="12" y2="23"/><line x1="1" y1="12" x2="4" y2="12"/><line x1="20" y1="12" x2="23" y2="12"/></svg>`;
const ICON_CODE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>`;

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

// Lightweight syntax highlighting for an HTML snippet (already escapeHtml'd),
// similar in spirit to axe's own element preview: tag names, attribute names,
// and quoted attribute values each get their own color.
function highlightHtmlSnippet(rawHtml) {
  const escaped = escapeHtml(rawHtml);

  // Matches an opening or closing tag: &lt;/?tagname ...attrs.../?&gt;
  return escaped.replace(
    /(&lt;\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[^&]*?)?)(\/?&gt;)/g,
    (whole, open, tagName, attrsPart, close) => {
      const highlightedAttrs = attrsPart.replace(
        /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(=)(&quot;.*?&quot;|&#39;.*?&#39;)/g,
        (m, attrName, eq, attrValue) =>
          `<span class="tok-attr">${attrName}</span><span class="tok-punct">${eq}</span><span class="tok-string">${attrValue}</span>`
      );
      return `<span class="tok-punct">${open}</span><span class="tok-tag">${tagName}</span>${highlightedAttrs}<span class="tok-punct">${close}</span>`;
    }
  );
}

// Failures actually shown, after applying the best-practices display filter.
// Rendering (and node-index-based click handlers) always operates on this list,
// never on the raw currentFailures, so indices stay consistent.
function getVisibleFailures() {
  if (currentSettings.bestPractices) return currentFailures;
  return currentFailures.filter(
    (v) => !(Array.isArray(v.tags) && v.tags.includes('best-practice'))
  );
}

function renderFailuresList() {
  // Keep currentFailures sorted by severity (most to least severe); this only
  // needs to happen once per scan, but re-sorting here is cheap and keeps this
  // function self-contained regardless of how it's triggered (scan or filter toggle).
  currentFailures.sort((a, b) => (IMPACT_ORDER[a.impact] ?? 99) - (IMPACT_ORDER[b.impact] ?? 99));

  const visible = getVisibleFailures();

  if (!hasScanned) {
    failuresListInnerEl.innerHTML = '<div class="empty-state">Ready to scan</div>';
    updateLayout();
    return;
  }

  if (!visible.length) {
    const hiddenCount = currentFailures.length - visible.length;
    failuresListInnerEl.innerHTML = hiddenCount > 0
      ? `<div class="empty-state">${hiddenCount} best practice${hiddenCount > 1 ? 's' : ''} hidden</div>`
      : '<div class="empty-state">No issues found! 🎉</div>';
    updateLayout();
    return;
  }

  const failuresMap = visible
    .map((failure, i) => {
      const impact = failure.impact || 'minor';
      const nodeCount = failure.nodes?.length || 0;
      const isBestPractice = Array.isArray(failure.tags) && failure.tags.includes('best-practice');
      const bestPracticeTag = isBestPractice ? '<span class="best-practice-tag">Best practice</span>' : '';
      return `
        <li class="failure-item" data-index="${i}">
          <h2 class="failure-title">
            <button class="failure-btn" aria-current="false">
              ${escapeHtml(failure.help || failure.id)}
            </button>
          </h2>
          <span class="badge badge-${impact}">${escapeHtml(impact)}</span>
          ${bestPracticeTag}
          <small style="display:block;color:var(--text-secondary);">
            ${nodeCount} issue${nodeCount > 1 ? 's' : ''}
          </small>
        </li>
      `;
    })
    .join('');

  failuresListInnerEl.innerHTML = `<ul class="issues-list">${failuresMap}</ul>`;

  failuresListEl.querySelectorAll('.failure-item').forEach((el) => {
    const btn = el.querySelector('.failure-btn');
    const index = Number(el.dataset.index);

    btn.addEventListener('click', () => {
      selectFailure(index);
    });
  });

  updateLayout();
}
// issues) and the two-column state (at least one visible issue). The results
// bar (Scan, Best practices, summary) is always visible, before and after
// scanning, so it needs no show/hide handling here.
function updateLayout() {
  const visible = getVisibleFailures();
  const showTwoColumns = hasScanned && visible.length > 0;

  mainContainerEl.classList.toggle('is-single-column', !showTwoColumns);
  failureDetailsEl.classList.toggle('is-hidden', !showTwoColumns);
}

function selectFailure(index) {
  selectedIndex = index;

  failuresListEl.querySelectorAll('.failure-item').forEach((el) => {
    const isSelected = Number(el.dataset.index) === index;
    el.classList.toggle('selected', isSelected);
    const btn = el.querySelector('.failure-btn');
    if (btn) {
      btn.setAttribute('aria-current', isSelected ? 'true' : 'false');
    }
  });

  // Switching rules: any previous highlight no longer matches what's shown
  if (highlightedNodeKey) {
    clearPageHighlight().catch((e) => console.error(e));
    highlightedNodeKey = null;
  }

  const failure = getVisibleFailures()[index];
  renderFailureDetails(failure);
}

function renderFailureDetails(failure) {
  failureDetailsEl.scrollTop = 0;

  if (!failure) {
    failureDetailsEl.innerHTML = '<div class="empty-state">Select a rule from the list to see details.</div>';
    return;
  }

  const nodesHtml = (failure.nodes || [])
    .map((node, i) => {
      const nodeKey = nodeKeyFor(failure, i);
      const isHighlighted = highlightedNodeKey === nodeKey;
      const htmlSnippet = node.html || '';

      const dataMessageHtml = buildDataMessage(node);

      return `
        <li class="node-card${isHighlighted ? ' is-highlighted' : ''}" data-node-index="${i}">
          <h3 class="visually-hidden">
            Issue ${i + 1}
            ${isHighlighted ? '<span class="visually-hidden"> highlighted</span>' : ''}
          </h3>
          <pre class="node-card-html"><code>${highlightHtmlSnippet(htmlSnippet)}</code></pre>
          <div class="node-card-actions">
            <button type="button" class="node-action-btn node-action-target${isHighlighted ? ' is-active' : ''}" data-action="target" data-node-index="${i}" aria-pressed="${isHighlighted}">
              ${ICON_TARGET}
              Highlight
              <span class="visually-hidden"> issue ${i + 1}</span>
            </button>
            <button type="button" class="node-action-btn node-action-code" data-action="code" data-node-index="${i}">
              ${ICON_CODE}
              Inspect
              <span class="visually-hidden"> issue ${i + 1}</span>
            </button>
          </div>
          ${dataMessageHtml}
        </li>
      `;
    })
    .join('');

  failureDetailsEl.innerHTML = `
    <div class="detail-header">
      <h2 class="detail-title">${escapeHtml(failure.help)}</h2>
      <p style="color:var(--text-secondary);margin:8px 0;">${escapeHtml(failure.description)}</p>
      ${failure.helpUrl ? `<a href="${escapeHtml(failure.helpUrl)}" target="_blank" rel="noopener noreferrer">Learn more<span class="visually-hidden"> about this rule</span></a>` : ''}
    </div>
    <div class="node-list">
      <ul class="issues-list">${nodesHtml}</ul>
    </div >
  `;

  failureDetailsEl.querySelectorAll('.node-action-target').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const nodeIndex = Number(btn.dataset.nodeIndex);
      const node = failure.nodes[nodeIndex];
      toggleHighlight(failure, nodeIndex, node);
    });
  });

  failureDetailsEl.querySelectorAll('.node-action-code').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const nodeIndex = Number(btn.dataset.nodeIndex);
      const node = failure.nodes[nodeIndex];
      openInElementsPanel(node);
    });
  });
}

// axe-core check IDs whose fail/incomplete message interpolates ${data.X}
// values (hex colors, ARIA attribute names, pixel sizes, etc.) — i.e. checks
// whose "message" carries concrete, element-specific values beyond the
// generic rule description. Identified by inspecting axe-core's own
// checks metadata (messages.fail / messages.incomplete containing
// "${data").
//
// presentational-role is deliberately excluded even though its own message
// does interpolate ${data.role}: it's reused as a generic accessible-name
// fallback check inside many unrelated rules (button-name, image-alt,
// link-name, ...), so surfacing its message there is misleading — it only
// belongs to rules actually about presentational role handling.
const CHECKS_WITH_DATA_MESSAGE = new Set([
  'color-contrast', 'color-contrast-enhanced', 'link-in-text-block',
  'target-size', 'target-offset',
  'aria-allowed-attr', 'aria-unsupported-attr', 'aria-valid-attr',
  'aria-valid-attr-value', 'aria-required-attr', 'aria-no-deprecated-attr',
  'aria-prohibited-attr', 'aria-conditional-attr', 'aria-errormessage',
  'has-global-aria-attribute',
  'aria-allowed-role', 'abstractrole', 'invalidrole', 'deprecatedrole',
  'unsupportedrole', 'landmark-is-top-level',
  'aria-required-children', 'aria-required-parent', 'only-dlitems',
  'only-listitems',
  'duplicate-id', 'duplicate-id-active', 'duplicate-id-aria',
  'avoid-inline-spacing', 'important-letter-spacing', 'important-line-height',
  'important-word-spacing',
  'meta-viewport', 'no-implicit-explicit-label'
]);

// Finds the first sub-check on this node (across any/all/none) whose id is
// in CHECKS_WITH_DATA_MESSAGE, and returns its axe-generated message —
// the same string axe already composed with the concrete data values
// (hex codes, attribute lists, pixel sizes, ...) substituted in.
function findDataMessage(node) {
  const subChecks = [
    ...(node.any || []),
    ...(node.all || []),
    ...(node.none || [])
  ];
  const match = subChecks.find((check) => CHECKS_WITH_DATA_MESSAGE.has(check.id));
  return match ? match.message : null;
}

function buildDataMessage(node) {
  const message = findDataMessage(node);
  if (!message) return '';

  return `<p class="node-data-message">${escapeHtml(message)}</p>`;
}

// Builds a stable key identifying a specific node (rule + index)
function nodeKeyFor(failure, nodeIndex) {
  return `${failure.id}::${nodeIndex}`;
}

async function toggleHighlight(failure, nodeIndex, node) {
  const nodeKey = nodeKeyFor(failure, nodeIndex);
  const target = Array.isArray(node.target) ? node.target : [node.target];
  const turningOn = highlightedNodeKey !== nodeKey;

  try {
    if (turningOn) {
      // Clear any existing highlight first (only one at a time)
      await clearPageHighlight();
      await chrome.scripting.executeScript({
        target: { tabId: inspectedTabId },
        func: highlightElementInPage,
        args: [target]
      });
      highlightedNodeKey = nodeKey;
    } else {
      await clearPageHighlight();
      highlightedNodeKey = null;
    }
  } catch (error) {
    console.error('Unable to highlight the element:', error);
  }

  // Update the visual state of the relevant card and button
  failureDetailsEl.querySelectorAll('.node-card').forEach((cardEl) => {
    const isThisOne = Number(cardEl.dataset.nodeIndex) === nodeIndex;
    const isActive = isThisOne && turningOn;
    cardEl.classList.toggle('is-highlighted', isActive);

    const btn = cardEl.querySelector('.node-action-target');
    if (btn) {
      btn.classList.toggle('is-active', isActive);
      btn.ariaPressed = isActive ? 'true' : 'false';
    }

    const heading = cardEl.querySelector('h3.visually-hidden');
    if (heading) {
      heading.innerHTML = heading.innerHTML.replace(/ highlighted$/, '') + (isActive ? ' highlighted' : '');
    }
  });
}

async function openInElementsPanel(node) {
  const target = Array.isArray(node.target) ? node.target : [node.target];
  const selector = target[target.length - 1];
  // Escape quotes so it can be safely injected into an eval string
  const safeSelector = selector.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

  const expression = `
    (function() {
      const el = document.querySelector('${safeSelector}');
      if (el) { inspect(el); return true; }
      return false;
    })()
  `;

  chrome.devtools.inspectedWindow.eval(expression, (result, isException) => {
    if (isException || !result) {
      console.error('Unable to open the element in the Elements panel:', isException || 'element not found');
    }
  });
}

async function clearPageHighlight() {
  await chrome.scripting.executeScript({
    target: { tabId: inspectedTabId },
    func: clearHighlightInPage
  });
}

// --- Functions injected into the inspected page ---
// (must be self-contained: no access to panel-scope variables)

function highlightElementInPage(selectors) {
  const OVERLAY_ID = '__flax_a11y_overlay__';
  const STYLE_ID = '__flax_a11y_style__';

  // Clear any previous highlight first
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

  // Inject the max-priority overlay style once
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${OVERLAY_ID} {
        position: fixed;
        pointer-events: none;
        border: 2px solid #d93025;
        border-radius: 2px;
        /* Stacked shadows fading outward simulate a soft glow around the
           border, without any solid fill covering the element itself. */
        box-shadow:
          0 0 0 2px rgba(217, 48, 37, 0.35),
          0 0 6px 4px rgba(217, 48, 37, 0.22),
          0 0 14px 8px rgba(217, 48, 37, 0.10);
        z-index: 2147483647; /* max value, sits above any local stacking context */
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

  // Keep the overlay glued to the element on scroll/resize
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

function countTotalIssues() {
  return getVisibleFailures().reduce((sum, v) => sum + (v.nodes?.length || 0), 0);
}

// Rule-level count of best-practice failures currently hidden by the display
// filter (as opposed to countTotalIssues(), which counts nodes within the
// visible/non-best-practice failures only).
function countHiddenBestPracticeIssues() {
  if (currentSettings.bestPractices) return 0;
  return currentFailures.filter(
    (v) => Array.isArray(v.tags) && v.tags.includes('best-practice')
  ).length;
}

// Builds the "X issues" / "0 issue" summary count text from the current
// visible failures. Shared by the post-scan and post-filter-toggle paths.
// When best practices are hidden and at least one was found, appends a
// visually-hidden note so screen reader users aren't left assuming "0
// issues" means the page has none at all.
function buildIssueCountText() {
  const totalIssues = countTotalIssues();
  const baseText = `${totalIssues} issue${totalIssues > 1 ? 's' : ''}`;

  const hiddenBpCount = countHiddenBestPracticeIssues();
  if (hiddenBpCount === 0) return baseText;

  const hiddenNote = `${hiddenBpCount} best practice${hiddenBpCount > 1 ? 's' : ''} hidden`;
  return `${escapeHtml(baseText)}<span class="visually-hidden">, ${escapeHtml(hiddenNote)}</span>`;
}

// Updates the "X issues | WCAG ..." summary. The count segment (weight 400)
// and the "| WCAG ..." segment (weight 300) are separate spans so panel.css
// can style each independently; the separator lives with the WCAG segment
// since it always renders, while the count segment is empty pre-scan.
// countHtml may contain markup (e.g. a visually-hidden note appended by
// buildIssueCountText), so it's set via innerHTML rather than textContent.
function setSummary(countHtml) {
  summaryCountTextEl.innerHTML = countHtml || '';
  updateWcagLevelText();
}

// Shows a spinning indicator + "Scanning" in place of the usual count text,
// used instead of setSummary() while a scan is in progress.
function setSummaryScanning() {
  summaryCountTextEl.innerHTML = '<span class="summary-spinner" aria-hidden="true"></span>Scanning';
  updateWcagLevelText();
}

// True while a scan is in flight; used to ignore repeat clicks on Scan
// without disabling the button (disabling it would drop keyboard focus).
let isScanningNow = false;

function setScanning(isScanning) {
  isScanningNow = isScanning;
  scanBtn.setAttribute('aria-disabled', String(isScanning));
  scanBtn.classList.toggle('is-loading', isScanning);
  mainContainerEl.setAttribute('aria-busy', String(isScanning));
}

async function runAxeScan() {
  if (isScanningNow) return;

  setScanning(true);
  setSummaryScanning();

  try {
    // 1. Inject axe-core using the correct path
    await chrome.scripting.executeScript({
      target: { tabId: inspectedTabId },
      files: ['lib/axe.min.js']
    });

    // 2. Run axe.run() in the inspected page, using the current Settings
    const runOptions = buildAxeRunOptions();

    const results = await chrome.scripting.executeScript({
      target: { tabId: inspectedTabId },
      func: (options) => {
        return new Promise((resolve, reject) => {
          if (typeof axe === 'undefined') {
            return reject(new Error('axe-core is not available in the page context.'));
          }
          axe.run(options, (err, results) => {
            if (err) reject(err);
            else resolve(results);
          });
        });
      },
      args: [runOptions]
    });

    const axeResults = results[0].result;
    console.log('Scan results:', axeResults);

    currentFailures = axeResults.violations || [];
    selectedIndex = null;
    highlightedNodeKey = null;
    hasScanned = true;

    renderFailuresList();
    renderFailureDetails(null);

    setSummary(buildIssueCountText());

  } catch (error) {
    console.error('Unable to run axe-core:', error);
    setSummary('Error while scanning. See console.');
    mainContainerEl.classList.add('is-single-column');
    failureDetailsEl.classList.add('is-hidden');
    failuresListInnerEl.innerHTML = `<div class="empty-state">Error: ${escapeHtml(error.message)}</div>`;
  } finally {
    setScanning(false);
    exportCsvBtn.disabled = !hasScanned || countTotalIssues() === 0;
  }
}

// ===================== CSV export =====================

// Wraps a value for safe inclusion in a CSV field (RFC 4180-style):
// doubles internal quotes and wraps in quotes whenever the value contains
// a comma, quote, or line break.
function csvField(value) {
  const str = String(value ?? '');
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function exportFailuresAsCsv() {
  const visible = getVisibleFailures();

  const header = ['Impact', 'Rule ID', 'Rule', 'Description', 'Best Practice', 'Element HTML', 'Selector'];
  const rows = [header];

  visible.forEach((failure) => {
    const isBestPractice = Array.isArray(failure.tags) && failure.tags.includes('best-practice');
    const nodes = failure.nodes && failure.nodes.length ? failure.nodes : [null];

    nodes.forEach((node) => {
      const target = node ? (Array.isArray(node.target) ? node.target : [node.target]) : [];
      rows.push([
        failure.impact || '',
        failure.id || '',
        failure.help || '',
        failure.description || '',
        isBestPractice ? 'Yes' : 'No',
        node?.html || '',
        target.join(' > ')
      ]);
    });
  });

  const csvContent = rows.map((row) => row.map(csvField).join(',')).join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  const timestamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  link.download = `flax-report-${timestamp}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// ===================== Settings =====================

function buildAxeRunOptions() {
  // Best-practice rules are always included in the scan itself; whether they're
  // shown afterwards is purely a display filter (see getVisibleFailures/currentSettings.bestPractices).
  const tags = [
    ...(WCAG_TAG_SETS[currentSettings.wcagStandard] || WCAG_TAG_SETS.wcag22aa),
    'best-practice'
  ];
  return { runOnly: { type: 'tag', values: tags } };
}

function applyTheme(theme) {
  document.documentElement.classList.remove('theme-light', 'theme-dark');
  if (theme === 'light') {
    document.documentElement.classList.add('theme-light');
  } else if (theme === 'dark') {
    document.documentElement.classList.add('theme-dark');
  }
  // 'system' → no override class, falls back to the prefers-color-scheme media query
}

function applySettingsToForm() {
  themeSelectEl.value = currentSettings.theme;
  wcagSelectEl.value = currentSettings.wcagStandard;
  bpEnableEl.checked = currentSettings.bestPractices;
  bpDisableEl.checked = !currentSettings.bestPractices;
  applyTheme(currentSettings.theme);
  updateWcagLevelText();
  updateBpToggleButton();
}

// Keeps the secondary toolbar's toggle button in sync with currentSettings.bestPractices,
// which is the single source of truth shared with the Settings radio buttons.
function updateBpToggleButton() {
  if (!bpToggleBtn) return;
  bpToggleBtn.setAttribute('aria-pressed', String(currentSettings.bestPractices));
}

// Applies a new bestPractices display-filter value from either toggle
// (Settings radios or the secondary toolbar button), keeping both in sync.
function setBestPracticesVisible(visible) {
  currentSettings.bestPractices = visible;
  bpEnableEl.checked = visible;
  bpDisableEl.checked = !visible;
  updateBpToggleButton();
  saveSettings();

  // A non-best-practice rule stays visible in both filter states, so if one
  // is currently selected, keep it selected after re-filtering by looking it
  // up by id rather than by its (filter-dependent) index. Only reset when the
  // previously selected rule was itself a best-practice rule now being hidden.
  const previouslySelected = selectedIndex !== null ? getVisibleFailures()[selectedIndex] : null;

  renderFailuresList();

  const newVisible = getVisibleFailures();
  const restoredIndex = previouslySelected
    ? newVisible.findIndex((f) => f.id === previouslySelected.id)
    : -1;

  if (restoredIndex !== -1) {
    selectFailure(restoredIndex);
  } else {
    selectedIndex = null;
    if (highlightedNodeKey) {
      clearPageHighlight().catch((e) => console.error(e));
      highlightedNodeKey = null;
    }
    renderFailureDetails(null);
  }

  if (hasScanned) {
    setSummary(buildIssueCountText());
  }
}

function updateWcagLevelText() {
  if (!summaryWcagTextEl) return;
  const label = WCAG_STANDARD_LABELS[currentSettings.wcagStandard] || currentSettings.wcagStandard;
  const hasCountText = summaryCountTextEl.textContent.trim().length > 0;
  summaryWcagTextEl.textContent = hasCountText ? `| ${label}` : label;
}

async function loadSettings() {
  try {
    const stored = await chrome.storage.local.get('flaxA11ySettings');
    currentSettings = { ...DEFAULT_SETTINGS, ...(stored.flaxA11ySettings || {}) };
  } catch (error) {
    console.error('Unable to load settings, using defaults:', error);
    currentSettings = { ...DEFAULT_SETTINGS };
  }
  applySettingsToForm();
  renderFailuresList();
}

async function saveSettings() {
  try {
    await chrome.storage.local.set({ flaxA11ySettings: currentSettings });
  } catch (error) {
    console.error('Unable to save settings:', error);
  }
}

function showSettingsView() {
  scanViewEl.classList.add('is-hidden');
  settingsViewEl.classList.remove('is-hidden');
  settingsBackBtn.focus();
}

function showScanView() {
  settingsViewEl.classList.add('is-hidden');
  scanViewEl.classList.remove('is-hidden');
  settingsBtn.focus();
}

function populateVersions() {
  try {
    const manifest = chrome.runtime.getManifest();
    versionExtensionEl.textContent = `v${manifest.version}`;
  } catch (error) {
    versionExtensionEl.textContent = '—';
  }
  // TODO: read axe-core's version dynamically (currently hardcoded, installed via npm)
  versionAxeEl.textContent = `v${AXE_CORE_VERSION}`;
}

settingsBtn?.addEventListener('click', showSettingsView);
settingsBackBtn?.addEventListener('click', showScanView);

themeSelectEl?.addEventListener('change', () => {
  currentSettings.theme = themeSelectEl.value;
  applyTheme(currentSettings.theme);
  saveSettings();
});

wcagSelectEl?.addEventListener('change', () => {
  currentSettings.wcagStandard = wcagSelectEl.value;
  updateWcagLevelText();
  saveSettings();
});

[bpEnableEl, bpDisableEl].forEach((radio) => {
  radio?.addEventListener('change', () => {
    setBestPracticesVisible(bpEnableEl.checked);
  });
});

bpToggleBtn?.addEventListener('click', () => {
  setBestPracticesVisible(!currentSettings.bestPractices);
});

exportCsvBtn?.addEventListener('click', exportFailuresAsCsv);

populateVersions();
loadSettings();

scanBtn?.addEventListener('click', runAxeScan);