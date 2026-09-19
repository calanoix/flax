#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { execSync } = require('child_process');

const ROOT_DIR = path.join(__dirname, '..');
const PANEL_JS_PATH = path.join(ROOT_DIR, 'src', 'panel', 'panel.js');
const MANIFEST_JSON_PATH = path.join(ROOT_DIR, 'src', 'manifest.json');
const PACKAGE_JSON_PATH = path.join(ROOT_DIR, 'package.json');
const AXE_MIN_SOURCE_PATH = path.join(ROOT_DIR, 'node_modules', 'axe-core', 'axe.min.js');
const AXE_MIN_DEST_PATH = path.join(ROOT_DIR, 'src', 'lib', 'axe.min.js');

const SET_NAME = 'CHECKS_WITH_DATA_MESSAGE';
const AXE_VERSION_CONST_NAME = 'AXE_CORE_VERSION';

// Excluded on purpose, independently of axe-core's version: 'presentational-role'
// interpolates ${data.role} in its own message, but it's reused as a generic
// accessible-name fallback check inside many unrelated rules (button-name,
// image-alt, link-name, ...), so surfacing its message there is misleading.
// This exclusion is a design decision, not something axe-core's metadata can tell us,
// so it's kept here rather than derived.
const EXCLUDED_CHECKS = new Set([
  'presentational-role'
]);

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function ask(question) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });
}

async function promptYesNo(question) {
  const answer = await ask(`${question} (Y/n) `);
  return answer.toLowerCase() !== 'n';
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, data) {
  // Preserve trailing newline convention (2-space indent, newline at EOF)
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

// ---------------------------------------------------------------------------
// Step 1: npm upgrade axe-core
// ---------------------------------------------------------------------------

function stepUpgradeAxeCore() {
  console.log('\n=== Step 1: npm upgrade axe-core ===\n');
  execSync('npm upgrade axe-core', { cwd: ROOT_DIR, stdio: 'inherit' });
}

// ---------------------------------------------------------------------------
// Step 2: copy the freshly installed axe.min.js into src/lib
// ---------------------------------------------------------------------------

function stepCopyAxeMin() {
  console.log('\n=== Step 2: copy axe.min.js into src/lib ===\n');

  if (!fs.existsSync(AXE_MIN_SOURCE_PATH)) {
    console.error(`⚠️  File not found: ${path.relative(ROOT_DIR, AXE_MIN_SOURCE_PATH)}, skipped.`);
    return;
  }

  fs.mkdirSync(path.dirname(AXE_MIN_DEST_PATH), { recursive: true });
  fs.copyFileSync(AXE_MIN_SOURCE_PATH, AXE_MIN_DEST_PATH);
  console.log(`✅ ${path.relative(ROOT_DIR, AXE_MIN_SOURCE_PATH)} → ${path.relative(ROOT_DIR, AXE_MIN_DEST_PATH)}`);
}

// ---------------------------------------------------------------------------
// Step 3: detect checks whose fail/incomplete message interpolates ${data...}
// (this is the original script's logic, unchanged)
// ---------------------------------------------------------------------------

function stringifyMessage(msg) {
  if (!msg) return '';
  if (typeof msg === 'string') return msg;
  if (typeof msg === 'function') return msg.toString();
  if (typeof msg === 'object') return JSON.stringify(msg);
  return String(msg);
}

// Reads panel.js and extracts the current contents of the `const CHECKS_WITH_DATA_MESSAGE
// = new Set([ ... ]);` declaration, along with the exact source span (start/end offsets)
// so we can later replace just that span in place, preserving everything else
// (comments, formatting) around it.
function readCurrentSetFromPanel(source) {
  const declRegex = new RegExp(`const\\s+${SET_NAME}\\s*=\\s*new Set\\(\\[([\\s\\S]*?)\\]\\)\\s*;`);
  const match = declRegex.exec(source);

  if (!match) {
    console.error(`Could not find "const ${SET_NAME} = new Set([...]);" in ${PANEL_JS_PATH}`);
    process.exit(1);
  }

  const idsRaw = match[1];
  const ids = [...idsRaw.matchAll(/'([^']+)'/g)].map((m) => m[1]);

  return {
    ids: new Set(ids),
    matchStart: match.index,
    matchEnd: match.index + match[0].length
  };
}

// Detects axe-core check IDs whose fail/incomplete message interpolates a
// ${data...} placeholder (either ${data.xxx} or the bare ${data} form).
function detectChecksWithDataMessage(axe) {
  const detected = new Set();
  const dataChecks = axe._audit?.data?.checks || {};
  const dataPlaceholderRegex = /\$\{data\b/;

  Object.entries(dataChecks).forEach(([checkId, checkData]) => {
    const failMsg = stringifyMessage(checkData?.messages?.fail);
    const incompleteMsg = stringifyMessage(checkData?.messages?.incomplete);

    const usesData = dataPlaceholderRegex.test(failMsg) || dataPlaceholderRegex.test(incompleteMsg);

    if (usesData && !EXCLUDED_CHECKS.has(checkId)) {
      detected.add(checkId);
    }
  });

  return detected;
}

// Formats a Set of check IDs the same way the existing panel.js declaration
// is formatted: quoted, comma-separated, wrapped at a reasonable width.
function formatIdsAsSetLiteral(ids) {
  const sorted = [...ids].sort();
  const quoted = sorted.map((id) => `'${id}'`);

  const lines = [];
  let currentLine = '  ';
  quoted.forEach((token, i) => {
    const withComma = token + (i < quoted.length - 1 ? ',' : '');
    if (currentLine.length + withComma.length + 1 > 80 && currentLine.trim().length > 0) {
      lines.push(currentLine.trimEnd());
      currentLine = '  ';
    }
    currentLine += withComma + ' ';
  });
  if (currentLine.trim().length > 0) lines.push(currentLine.trimEnd());

  return `const ${SET_NAME} = new Set([\n${lines.join('\n')}\n]);`;
}

async function stepCheckDataMessages() {
  console.log('\n=== Step 3: checking checks with a ${data...} message ===\n');

  // require() axe-core fresh, after the potential upgrade in step 1
  delete require.cache[require.resolve('axe-core')];
  const axe = require('axe-core');

  const source = fs.readFileSync(PANEL_JS_PATH, 'utf8');
  const panelInfo = readCurrentSetFromPanel(source);
  const detectedChecks = detectChecksWithDataMessage(axe);

  console.log(`axe-core v${axe.version}`);
  console.log(`Comparing against ${SET_NAME} in ${path.relative(ROOT_DIR, PANEL_JS_PATH)}\n`);

  const missingInCode = [...detectedChecks].filter((id) => !panelInfo.ids.has(id));
  const removedFromAxe = [...panelInfo.ids].filter((id) => !detectedChecks.has(id) && !EXCLUDED_CHECKS.has(id));

  if (missingInCode.length === 0 && removedFromAxe.length === 0) {
    console.log(`✅ ${SET_NAME} is already up to date with this axe-core version.`);
    return;
  }

  if (missingInCode.length > 0) {
    console.log('⚠️  New checks detected to ADD to the set:');
    missingInCode.forEach((id) => console.log(`  + '${id}'`));
    console.log('');
  }

  if (removedFromAxe.length > 0) {
    console.log('ℹ️  Checks present in the set but ABSENT/CHANGED in axe-core:');
    removedFromAxe.forEach((id) => console.log(`  - '${id}'`));
    console.log('');
  }

  const proceed = await promptYesNo(`Update ${SET_NAME} in panel.js?`);

  if (!proceed) {
    console.log('No changes made.');
    return;
  }

  const newDeclaration = formatIdsAsSetLiteral(detectedChecks);
  const updatedSource =
    source.slice(0, panelInfo.matchStart) +
    newDeclaration +
    source.slice(panelInfo.matchEnd);

  fs.writeFileSync(PANEL_JS_PATH, updatedSource, 'utf8');
  console.log(`✅ ${path.relative(ROOT_DIR, PANEL_JS_PATH)} updated.`);
}

// ---------------------------------------------------------------------------
// Step 4: bump flax's own version in src/manifest.json and package.json
// ---------------------------------------------------------------------------

async function stepBumpFlaxVersion() {
  console.log('\n=== Step 4: flax version ===\n');

  const manifest = readJson(MANIFEST_JSON_PATH);
  const pkg = readJson(PACKAGE_JSON_PATH);

  const currentVersion = manifest.version;
  const newVersion = await ask(`Enter new version (current ${currentVersion}): `);

  if (!newVersion) {
    console.log('No version entered, step skipped.');
    return;
  }

  manifest.version = newVersion;
  pkg.version = newVersion;

  writeJson(MANIFEST_JSON_PATH, manifest);
  writeJson(PACKAGE_JSON_PATH, pkg);

  console.log(`✅ flax version updated: ${currentVersion} → ${newVersion}`);
}

// ---------------------------------------------------------------------------
// Step 5: sync axe-core's version into package.json (dependencies) and panel.js
// ---------------------------------------------------------------------------

function getInstalledAxeCoreVersion() {
  delete require.cache[require.resolve('axe-core')];
  const axe = require('axe-core');
  return axe.version;
}

async function stepSyncAxeCoreVersion() {
  console.log('\n=== Step 5: axe-core version ===\n');

  const installedVersion = getInstalledAxeCoreVersion();
  const pkg = readJson(PACKAGE_JSON_PATH);
  const currentDepVersion = pkg.dependencies?.['axe-core'];

  console.log(`Installed axe-core version: ${installedVersion}`);
  console.log(`Current version in package.json: ${currentDepVersion || '(missing)'}`);

  if (pkg.dependencies && pkg.dependencies['axe-core'] !== undefined) {
    pkg.dependencies['axe-core'] = `^${installedVersion}`;
    writeJson(PACKAGE_JSON_PATH, pkg);
    console.log(`✅ package.json updated (axe-core -> ^${installedVersion})`);
  } else {
    console.log('⚠️  No "axe-core" dependency found in package.json, skipped.');
  }

  const source = fs.readFileSync(PANEL_JS_PATH, 'utf8');
  const versionRegex = new RegExp(`(const\\s+${AXE_VERSION_CONST_NAME}\\s*=\\s*')[^']*(')`);

  if (!versionRegex.test(source)) {
    console.error(`⚠️  Could not find "const ${AXE_VERSION_CONST_NAME} = '...'" in ${PANEL_JS_PATH}, skipped.`);
    return;
  }

  const updatedSource = source.replace(versionRegex, `$1${installedVersion}$2`);
  fs.writeFileSync(PANEL_JS_PATH, updatedSource, 'utf8');
  console.log(`✅ ${path.relative(ROOT_DIR, PANEL_JS_PATH)} updated (${AXE_VERSION_CONST_NAME} = '${installedVersion}')`);
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

async function main() {
  console.log('=== flax: axe-core update ===');

  if (await promptYesNo('\nStep 1/5 — Run "npm upgrade axe-core"?')) {
    stepUpgradeAxeCore();
  } else {
    console.log('Step skipped.');
  }

  if (await promptYesNo('\nStep 2/5 — Copy axe.min.js into src/lib?')) {
    stepCopyAxeMin();
  } else {
    console.log('Step skipped.');
  }

  if (await promptYesNo('\nStep 3/5 — Check checks with a ${data...} message?')) {
    await stepCheckDataMessages();
  } else {
    console.log('Step skipped.');
  }

  if (await promptYesNo('\nStep 4/5 — Update the flax version?')) {
    await stepBumpFlaxVersion();
  } else {
    console.log('Step skipped.');
  }

  if (await promptYesNo('\nStep 5/5 — Sync the axe-core version (package.json + panel.js)?')) {
    await stepSyncAxeCoreVersion();
  } else {
    console.log('Step skipped.');
  }

  console.log('\n=== Done ===\n');
  rl.close();
}

main().catch((err) => {
  console.error(err);
  rl.close();
  process.exit(1);
});