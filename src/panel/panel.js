const inspectedTabId = chrome.devtools.inspectedWindow.tabId;

const violationsListEl = document.getElementById('violations-list');
const violationsListInnerEl = document.getElementById('violations-list-inner');
const violationDetailsEl = document.getElementById('violation-details');
const summaryTextEl = document.getElementById('summary-text');
const scanBtn = document.getElementById('scan-btn');
const mainContainerEl = document.getElementById('main-container');
const resultsToolbarEl = document.getElementById('results-toolbar');
const bpToggleBtn = document.getElementById('bp-toggle-btn');
const exportCsvBtn = document.getElementById('export-csv-btn');

const scanViewEl = document.getElementById('scan-view');
const settingsViewEl = document.getElementById('settings-view');
const settingsBtn = document.getElementById('settings-btn');
const settingsBackBtn = document.getElementById('settings-back-btn');
const versionExtensionEl = document.getElementById('version-extension');
const versionAxeEl = document.getElementById('version-axe');
const wcagLevelTextEl = document.getElementById('wcag-level-text');
const themeSelectEl = document.getElementById('theme-select');
const wcagSelectEl = document.getElementById('wcag-select');
const bpEnableEl = document.getElementById('bp-enable');
const bpDisableEl = document.getElementById('bp-disable');

let currentViolations = [];
let selectedIndex = null;
let highlightedNodeKey = null; // identifies the element currently highlighted on the page
let hasScanned = false; // distinguishes "not yet scanned" from "scanned, zero issues"

// --- Responsive stacked layout (<350px): sidebar height measurement ---
// See the comment above the @container rule in panel.css for why this can't
// be pure CSS: .sidebar has overflow-y: auto, and browsers don't agree on
// what min-content means for a scrollable flex/grid item. Instead, we
// measure the sidebar content's real (unclamped) height here and feed it
// into a CSS variable that the grid-template-rows clamp() consumes.
//
// We observe #violations-list-inner (the content wrapper), not #violations-list
// (.sidebar) itself: once the stacked grid clamps .sidebar's row to
// --sidebar-stack-height, .sidebar's own box stops changing size when its
// content changes — that's the whole point of the clamp — so a
// ResizeObserver on .sidebar would go silent right when we need it most.
// The inner wrapper is never height-constrained, so its natural size always
// reflects the true content height, scanned or not, filtered or not.
function updateSidebarStackHeight() {
  const height = violationsListInnerEl.scrollHeight;
  violationsListEl.style.setProperty('--sidebar-stack-height', `${height}px`);
}

const sidebarResizeObserver = new ResizeObserver(() => updateSidebarStackHeight());
sidebarResizeObserver.observe(violationsListInnerEl);

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
  wcagStandard: 'wcag21aa'
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

// Violations actually shown, after applying the best-practices display filter.
// Rendering (and node-index-based click handlers) always operates on this list,
// never on the raw currentViolations, so indices stay consistent.
function getVisibleViolations() {
  if (currentSettings.bestPractices) return currentViolations;
  return currentViolations.filter(
    (v) => !(Array.isArray(v.tags) && v.tags.includes('best-practice'))
  );
}

function renderViolationsList() {
  // Keep currentViolations sorted by severity (most to least severe); this only
  // needs to happen once per scan, but re-sorting here is cheap and keeps this
  // function self-contained regardless of how it's triggered (scan or filter toggle).
  currentViolations.sort((a, b) => (IMPACT_ORDER[a.impact] ?? 99) - (IMPACT_ORDER[b.impact] ?? 99));

  const visible = getVisibleViolations();

  if (!hasScanned) {
    violationsListInnerEl.innerHTML = '<div class="empty-state">Ready to scan</div>';
    updateLayout();
    return;
  }

  if (!visible.length) {
    violationsListInnerEl.innerHTML = '<div class="empty-state">No issues found</div>';
    updateLayout();
    return;
  }

  violationsListInnerEl.innerHTML = visible
    .map((violation, i) => {
      const impact = violation.impact || 'minor';
      const nodeCount = violation.nodes?.length || 0;
      const isBestPractice = Array.isArray(violation.tags) && violation.tags.includes('best-practice');
      const bestPracticeTag = isBestPractice ? '<span class="best-practice-tag">Best practice</span>' : '';
      return `
        <div class="violation-item" data-index="${i}">
          <span class="badge badge-${impact}">${escapeHtml(impact)}</span>
          <span class="violation-item-text">
            ${bestPracticeTag}
            ${escapeHtml(violation.help || violation.id)}
            <small style="display:block;color:var(--text-secondary);">
              ${nodeCount} element${nodeCount > 1 ? 's' : ''}
            </small>
          </span>
        </div>
      `;
    })
    .join('');

  violationsListEl.querySelectorAll('.violation-item').forEach((el) => {
    el.addEventListener('click', () => {
      const index = Number(el.dataset.index);
      selectViolation(index);
    });
  });

  updateLayout();
}
// issues) and the two-column state (at least one visible issue), and shows
// or hides the secondary results toolbar accordingly.
function updateLayout() {
  const visible = getVisibleViolations();
  const showTwoColumns = hasScanned && visible.length > 0;

  mainContainerEl.classList.toggle('is-single-column', !showTwoColumns);
  violationDetailsEl.classList.toggle('is-hidden', !showTwoColumns);
  resultsToolbarEl.classList.toggle('is-hidden', !hasScanned);
}

function selectViolation(index) {
  selectedIndex = index;

  violationsListEl.querySelectorAll('.violation-item').forEach((el) => {
    el.classList.toggle('selected', Number(el.dataset.index) === index);
  });

  // Switching rules: any previous highlight no longer matches what's shown
  if (highlightedNodeKey) {
    clearPageHighlight().catch((e) => console.error(e));
    highlightedNodeKey = null;
  }

  const violation = getVisibleViolations()[index];
  renderViolationDetails(violation);
}

function renderViolationDetails(violation) {
  if (!violation) {
    violationDetailsEl.innerHTML = '<div class="empty-state">Select a rule from the list to see details.</div>';
    return;
  }

  const nodesHtml = (violation.nodes || [])
    .map((node, i) => {
      const nodeKey = nodeKeyFor(violation, i);
      const isHighlighted = highlightedNodeKey === nodeKey;
      const htmlSnippet = node.html || '';

      return `
        <div class="node-card${isHighlighted ? ' is-highlighted' : ''}" data-node-index="${i}">
          <pre class="node-card-html"><code>${highlightHtmlSnippet(htmlSnippet)}</code></pre>
          <div class="node-card-actions">
            <button type="button" class="node-action-btn node-action-target${isHighlighted ? ' is-active' : ''}" data-action="target" data-node-index="${i}" title="Highlight the element on the page">
              ${ICON_TARGET}
              ${isHighlighted ? 'Remove' : 'Locate'}
            </button>
            <button type="button" class="node-action-btn node-action-code" data-action="code" data-node-index="${i}" title="Open in the Elements panel">
              ${ICON_CODE}
              Inspect
            </button>
          </div>
        </div>
      `;
    })
    .join('');

  violationDetailsEl.innerHTML = `
    <div class="detail-header">
      <h2 class="detail-title">${escapeHtml(violation.help)}</h2>
      <p style="color:var(--text-secondary);margin:8px 0 0 0;">${escapeHtml(violation.description)}</p>
      ${violation.helpUrl ? `<p style="margin:6px 0 0 0;"><a href="${escapeHtml(violation.helpUrl)}" target="_blank" rel="noopener noreferrer">Learn more</a></p>` : ''}
    </div>
    <div class="node-list">
      ${nodesHtml || '<div class="empty-state">No elements associated.</div>'}
    </div>
  `;

  violationDetailsEl.querySelectorAll('.node-action-target').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const nodeIndex = Number(btn.dataset.nodeIndex);
      const node = violation.nodes[nodeIndex];
      toggleHighlight(violation, nodeIndex, node);
    });
  });

  violationDetailsEl.querySelectorAll('.node-action-code').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const nodeIndex = Number(btn.dataset.nodeIndex);
      const node = violation.nodes[nodeIndex];
      openInElementsPanel(node);
    });
  });
}

// Builds a stable key identifying a specific node (rule + index)
function nodeKeyFor(violation, nodeIndex) {
  return `${violation.id}::${nodeIndex}`;
}

async function toggleHighlight(violation, nodeIndex, node) {
  const nodeKey = nodeKeyFor(violation, nodeIndex);
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
  violationDetailsEl.querySelectorAll('.node-card').forEach((cardEl) => {
    const isThisOne = Number(cardEl.dataset.nodeIndex) === nodeIndex;
    const isActive = isThisOne && turningOn;
    cardEl.classList.toggle('is-highlighted', isActive);

    const btn = cardEl.querySelector('.node-action-target');
    if (btn) {
      btn.classList.toggle('is-active', isActive);
      btn.innerHTML = `${ICON_TARGET}${isActive ? 'Remove' : 'Locate'}`;
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
  return getVisibleViolations().reduce((sum, v) => sum + (v.nodes?.length || 0), 0);
}

function setSummary(text) {
  summaryTextEl.textContent = text;
}

function setScanning(isScanning) {
  scanBtn.disabled = isScanning;
  scanBtn.classList.toggle('is-loading', isScanning);
}

async function runAxeAudit() {
  setScanning(true);
  setSummary('Scanning…');
  resultsToolbarEl.classList.add('is-hidden');

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
    console.log('Audit results:', axeResults);

    currentViolations = axeResults.violations || [];
    selectedIndex = null;
    highlightedNodeKey = null;
    hasScanned = true;

    renderViolationsList();
    renderViolationDetails(null);

    const totalIssues = countTotalIssues();
    setSummary(totalIssues === 0
      ? 'No issues found'
      : `${totalIssues} issue${totalIssues > 1 ? 's' : ''} found`);

  } catch (error) {
    console.error('Unable to run axe-core:', error);
    setSummary('Error while scanning. See console.');
    resultsToolbarEl.classList.add('is-hidden');
    mainContainerEl.classList.add('is-single-column');
    violationDetailsEl.classList.add('is-hidden');
    violationsListInnerEl.innerHTML = `<div class="empty-state">Error: ${escapeHtml(error.message)}</div>`;
  } finally {
    setScanning(false);
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

function exportViolationsAsCsv() {
  const visible = getVisibleViolations();

  const header = ['Impact', 'Rule ID', 'Rule', 'Description', 'Best Practice', 'Element HTML', 'Selector'];
  const rows = [header];

  visible.forEach((violation) => {
    const isBestPractice = Array.isArray(violation.tags) && violation.tags.includes('best-practice');
    const nodes = violation.nodes && violation.nodes.length ? violation.nodes : [null];

    nodes.forEach((node) => {
      const target = node ? (Array.isArray(node.target) ? node.target : [node.target]) : [];
      rows.push([
        violation.impact || '',
        violation.id || '',
        violation.help || '',
        violation.description || '',
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
  link.download = `flax-a11y-report-${timestamp}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// ===================== Settings =====================

function buildAxeRunOptions() {
  // Best-practice rules are always included in the scan itself; whether they're
  // shown afterwards is purely a display filter (see getVisibleViolations/currentSettings.bestPractices).
  const tags = [
    ...(WCAG_TAG_SETS[currentSettings.wcagStandard] || WCAG_TAG_SETS.wcag21aa),
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

  // The visible list is being re-filtered, so any previous selection/highlight
  // index may no longer point to the same rule — reset both to stay consistent.
  selectedIndex = null;
  if (highlightedNodeKey) {
    clearPageHighlight().catch((e) => console.error(e));
    highlightedNodeKey = null;
  }
  renderViolationDetails(null);

  renderViolationsList();
  const totalIssues = countTotalIssues();
  if (hasScanned) {
    setSummary(totalIssues === 0
      ? 'No issues found'
      : `${totalIssues} issue${totalIssues > 1 ? 's' : ''} found`);
  }
}

function updateWcagLevelText() {
  if (!wcagLevelTextEl) return;
  wcagLevelTextEl.textContent = WCAG_STANDARD_LABELS[currentSettings.wcagStandard] || currentSettings.wcagStandard;
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
  renderViolationsList();
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
}

function showScanView() {
  settingsViewEl.classList.add('is-hidden');
  scanViewEl.classList.remove('is-hidden');
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

exportCsvBtn?.addEventListener('click', exportViolationsAsCsv);

populateVersions();
loadSettings();

scanBtn?.addEventListener('click', runAxeAudit);