const browserAPI = typeof browser !== 'undefined' ? browser : chrome;
const inspectedTabId = browserAPI.devtools.inspectedWindow.tabId;

const failuresListEl = document.getElementById('failures-list');
const failuresListInnerEl = document.getElementById('failures-list-inner');
const failureDetailsEl = document.getElementById('failure-details');
const summaryCountTextEl = document.getElementById('summary-count-text');
const summaryWcagTextEl = document.getElementById('summary-wcag-text');
const scanBtn = document.getElementById('scan-btn');
const resultsContainerEl = document.getElementById('results-container');
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
const AXE_CORE_VERSION = '4.14.0';

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

// ===================== DOM helpers =====================
// All rendering builds DOM nodes (no innerHTML): strings passed as children
// always become text nodes, so page-derived data from axe results (HTML
// snippets, selectors, messages) can never be interpreted as markup.

// h('div', { class: 'x', 'aria-pressed': 'false' }, 'text', childNode, [more])
// Attributes with null/undefined/false values are skipped; pass 'false' as a
// string for ARIA attributes that must be present with a false value.
function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === null || value === undefined || value === false) continue;
    el.setAttribute(key, value === true ? '' : String(value));
  }
  el.append(...flattenChildren(children));
  return el;
}

function flattenChildren(children) {
  return children
    .flat(Infinity)
    .filter((c) => c !== null && c !== undefined && c !== false && c !== '');
}

const SVG_NS = 'http://www.w3.org/2000/svg';

// Builds an inline SVG icon (inherits color via currentColor)
function createIcon(svgAttrs, shapes) {
  const svgEl = document.createElementNS(SVG_NS, 'svg');
  const baseAttrs = {
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '2',
    'stroke-linecap': 'round',
    ...svgAttrs
  };
  for (const [key, value] of Object.entries(baseAttrs)) svgEl.setAttribute(key, value);
  for (const [tag, attrs] of shapes) {
    const shapeEl = document.createElementNS(SVG_NS, tag);
    for (const [key, value] of Object.entries(attrs)) shapeEl.setAttribute(key, String(value));
    svgEl.append(shapeEl);
  }
  return svgEl;
}

const iconTarget = () => createIcon({}, [
  ['circle', { cx: 12, cy: 12, r: 7 }],
  ['circle', { cx: 12, cy: 12, r: 3 }],
  ['line', { x1: 12, y1: 1, x2: 12, y2: 4 }],
  ['line', { x1: 12, y1: 20, x2: 12, y2: 23 }],
  ['line', { x1: 1, y1: 12, x2: 4, y2: 12 }],
  ['line', { x1: 20, y1: 12, x2: 23, y2: 12 }]
]);

const iconCode = () => createIcon({ 'stroke-linejoin': 'round' }, [
  ['polyline', { points: '16 18 22 12 16 6' }],
  ['polyline', { points: '8 6 2 12 8 18' }]
]);

function emptyState(text) {
  return h('div', { class: 'empty-state' }, text);
}

// Only http(s) links from axe metadata are rendered as links
function safeHttpUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : null;
  } catch {
    return null;
  }
}

const tok = (type, text) => h('span', { class: `tok-${type}` }, text);

// Lightweight syntax highlighting for an HTML snippet, similar in spirit to
// axe's own element preview: tag names, attribute names, and quoted attribute
// values each get their own color. Works on the raw snippet and returns a
// DocumentFragment of text nodes and token spans.
function highlightHtmlSnippet(rawHtml) {
  const fragment = document.createDocumentFragment();
  const tagRe = /(<\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[^>]*?)?)(\/?>)/g;
  let lastIndex = 0;

  for (const match of rawHtml.matchAll(tagRe)) {
    const [whole, open, tagName, attrsPart, close] = match;
    fragment.append(
      rawHtml.slice(lastIndex, match.index),
      tok('punct', open),
      tok('tag', tagName),
      ...highlightAttrs(attrsPart),
      tok('punct', close)
    );
    lastIndex = match.index + whole.length;
  }
  fragment.append(rawHtml.slice(lastIndex));
  return fragment;
}

function highlightAttrs(attrsPart) {
  const parts = [];
  const attrRe = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(=)("[^"]*"|'[^']*')/g;
  let lastIndex = 0;

  for (const match of attrsPart.matchAll(attrRe)) {
    const [whole, attrName, eq, attrValue] = match;
    parts.push(
      attrsPart.slice(lastIndex, match.index),
      tok('attr', attrName),
      tok('punct', eq),
      tok('string', attrValue)
    );
    lastIndex = match.index + whole.length;
  }
  parts.push(attrsPart.slice(lastIndex));
  return parts;
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
    failuresListInnerEl.replaceChildren(emptyState('Ready to scan'));
    updateLayout();
    return;
  }

  if (!visible.length) {
    const hiddenCount = currentFailures.length - visible.length;
    failuresListInnerEl.replaceChildren(emptyState(
      hiddenCount > 0
        ? `${hiddenCount} best practice${hiddenCount > 1 ? 's' : ''} hidden`
        : 'No issues found! 🎉'
    ));
    updateLayout();
    return;
  }

  const items = visible.map((failure, i) => {
    const impact = failure.impact || 'minor';
    const nodeCount = failure.nodes?.length || 0;
    const isBestPractice = Array.isArray(failure.tags) && failure.tags.includes('best-practice');

    const btn = h('button', { class: 'failure-btn', 'aria-current': 'false' }, failure.help || failure.id);
    btn.addEventListener('click', () => {
      selectFailure(i);
    });

    return h('li', { class: 'failure-item', 'data-index': i },
      h('h2', { class: 'failure-title' }, btn),
      h('span', { class: `badge badge-${impact}` }, impact),
      isBestPractice && h('span', { class: 'best-practice-tag' }, 'Best practice'),
      h('small', { style: 'display:block;color:var(--text-secondary);' },
        `${nodeCount} issue${nodeCount > 1 ? 's' : ''}`
      )
    );
  });

  failuresListInnerEl.replaceChildren(h('ul', { class: 'issues-list' }, items));

  updateLayout();
}
// issues) and the two-column state (at least one visible issue). The results
// bar (Scan, Best practices, summary) is always visible, before and after
// scanning, so it needs no show/hide handling here.
function updateLayout() {
  const visible = getVisibleFailures();
  const showTwoColumns = hasScanned && visible.length > 0;

  resultsContainerEl.classList.toggle('is-single-column', !showTwoColumns);
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

function issueHeadingText(nodeIndex, isHighlighted) {
  return `Issue ${nodeIndex + 1}${isHighlighted ? ' highlighted' : ''}`;
}

function renderFailureDetails(failure) {
  failureDetailsEl.scrollTop = 0;

  if (!failure) {
    failureDetailsEl.replaceChildren(emptyState('Select a rule from the list to see details.'));
    return;
  }

  const nodeItems = (failure.nodes || []).map((node, i) => {
    const nodeKey = nodeKeyFor(failure, i);
    const isHighlighted = highlightedNodeKey === nodeKey;

    const targetBtn = h('button', {
      type: 'button',
      class: `node-action-btn node-action-target${isHighlighted ? ' is-active' : ''}`,
      'data-action': 'target',
      'data-node-index': i,
      'aria-pressed': String(isHighlighted)
    },
      iconTarget(),
      ' Highlight',
      h('span', { class: 'visually-hidden' }, ` issue ${i + 1}`)
    );
    targetBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleHighlight(failure, i, node);
    });

    const codeBtn = h('button', {
      type: 'button',
      class: 'node-action-btn node-action-code',
      'data-action': 'code',
      'data-node-index': i
    },
      iconCode(),
      ' Inspect',
      h('span', { class: 'visually-hidden' }, ` issue ${i + 1}`)
    );
    codeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openInElementsPanel(node);
    });

    return h('li', { class: `node-card${isHighlighted ? ' is-highlighted' : ''}`, 'data-node-index': i },
      h('h3', { class: 'visually-hidden' }, issueHeadingText(i, isHighlighted)),
      h('pre', { class: 'node-card-html' }, h('code', null, highlightHtmlSnippet(node.html || ''))),
      h('div', { class: 'node-card-actions' }, targetBtn, codeBtn),
      buildDataMessage(node)
    );
  });

  const helpUrl = safeHttpUrl(failure.helpUrl);

  failureDetailsEl.replaceChildren(
    h('div', { class: 'detail-header' },
      h('h2', { class: 'detail-title' }, failure.help),
      h('p', { style: 'color:var(--text-secondary);margin:8px 0;' }, failure.description),
      helpUrl && h('a', { href: helpUrl, target: '_blank', rel: 'noopener noreferrer' },
        'Learn more',
        h('span', { class: 'visually-hidden' }, ' about this rule')
      )
    ),
    h('div', { class: 'node-list' }, h('ul', { class: 'issues-list' }, nodeItems))
  );
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
  'abstractrole', 'aria-allowed-attr', 'aria-allowed-attr-elm',
  'aria-allowed-role', 'aria-conditional-attr', 'aria-errormessage',
  'aria-no-deprecated-attr', 'aria-prohibited-attr', 'aria-required-attr',
  'aria-required-children', 'aria-required-parent', 'aria-unsupported-attr',
  'aria-valid-attr', 'aria-valid-attr-value', 'avoid-inline-spacing',
  'color-contrast', 'color-contrast-enhanced', 'deprecatedrole',
  'duplicate-id', 'duplicate-id-active', 'duplicate-id-aria',
  'important-letter-spacing', 'important-line-height',
  'important-word-spacing', 'invalidrole', 'landmark-is-top-level',
  'link-in-text-block', 'meta-viewport', 'no-implicit-explicit-label',
  'only-dlitems', 'only-listitems', 'target-offset', 'target-size',
  'unsupportedrole'
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
  if (!message) return null;

  return h('p', { class: 'node-data-message' }, message);
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
      await browserAPI.runtime.sendMessage({
        type: 'HIGHLIGHT_ELEMENT',
        tabId: inspectedTabId,
        target
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
      heading.textContent = issueHeadingText(Number(cardEl.dataset.nodeIndex), isActive);
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

  browserAPI.devtools.inspectedWindow.eval(expression, (result, isException) => {
    if (isException || !result) {
      console.error('Unable to open the element in the Elements panel:', isException || 'element not found');
    }
  });
}

async function clearPageHighlight() {
  await browserAPI.runtime.sendMessage({
    type: 'CLEAR_HIGHLIGHT',
    tabId: inspectedTabId
  });
}

// Note: the highlight/clear-highlight page-injected functions used to live
// here. Firefox doesn't expose chrome.scripting to the DevTools panel
// context, so all scripting.executeScript calls (and the functions they
// inject) now live in background.js; panel.js reaches them via
// browserAPI.runtime.sendMessage(...). See background.js for the injected
// function bodies.

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

// Builds the "X issues" / "0 issue" summary count content from the current
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
  return [baseText, h('span', { class: 'visually-hidden' }, `, ${hiddenNote}`)];
}

// Updates the "X issues | WCAG ..." summary. The count segment (weight 400)
// and the "| WCAG ..." segment (weight 300) are separate spans so panel.css
// can style each independently; the separator lives with the WCAG segment
// since it always renders, while the count segment is empty pre-scan.
// content is a string, a node, or an array of both (e.g. the visually-hidden
// note appended by buildIssueCountText).
function setSummary(content) {
  summaryCountTextEl.replaceChildren(...flattenChildren([content]));
  updateWcagLevelText();
}

// Shows a spinning indicator + "Scanning" in place of the usual count text,
// used instead of setSummary() while a scan is in progress.
function setSummaryScanning() {
  summaryCountTextEl.replaceChildren(
    h('span', { class: 'summary-spinner', 'aria-hidden': 'true' }),
    'Scanning'
  );
  updateWcagLevelText();
}

// True while a scan is in flight; used to ignore repeat clicks on Scan
// without disabling the button (disabling it would drop keyboard focus).
let isScanningNow = false;

function setScanning(isScanning) {
  isScanningNow = isScanning;
  scanBtn.setAttribute('aria-disabled', String(isScanning));
  scanBtn.classList.toggle('is-loading', isScanning);
  resultsContainerEl.setAttribute('aria-busy', String(isScanning));
}

async function runAxeScan() {
  if (isScanningNow) return;

  setScanning(true);
  setSummaryScanning();

  try {
    // 1. Inject axe-core using the correct path
    await browserAPI.runtime.sendMessage({
      type: 'INJECT_AXE',
      tabId: inspectedTabId
    });

    // 2. Run axe.run() in the inspected page, using the current Settings
    const runOptions = buildAxeRunOptions();

    const scanResponse = await browserAPI.runtime.sendMessage({
      type: 'RUN_AXE_SCAN',
      tabId: inspectedTabId,
      options: runOptions
    });
    if (scanResponse?.error) throw new Error(scanResponse.error);

    const axeResults = scanResponse.result;
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
    resultsContainerEl.classList.add('is-single-column');
    failureDetailsEl.classList.add('is-hidden');
    failuresListInnerEl.replaceChildren(emptyState(`Error: ${error.message}`));
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
    const stored = await browserAPI.runtime.sendMessage({
      type: 'STORAGE_GET',
      key: 'flaxA11ySettings'
    });
    currentSettings = { ...DEFAULT_SETTINGS, ...(stored?.value || {}) };
  } catch (error) {
    console.error('Unable to load settings, using defaults:', error);
    currentSettings = { ...DEFAULT_SETTINGS };
  }
  applySettingsToForm();
  renderFailuresList();
}

async function saveSettings() {
  try {
    await browserAPI.runtime.sendMessage({
      type: 'STORAGE_SET',
      items: { flaxA11ySettings: currentSettings }
    });
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

async function populateVersions() {
  try {
    const { manifest } = await browserAPI.runtime.sendMessage({ type: 'GET_MANIFEST' });
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