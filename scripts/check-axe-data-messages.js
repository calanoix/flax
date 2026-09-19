const fs = require('fs');
const path = require('path');
const readline = require('readline');
const axe = require('axe-core');

const PANEL_JS_PATH = path.join(__dirname, '..', 'src', 'panel', 'panel.js');
const SET_NAME = 'CHECKS_WITH_DATA_MESSAGE';

// Excluded on purpose, independently of axe-core's version: 'presentational-role'
// interpolates ${data.role} in its own message, but it's reused as a generic
// accessible-name fallback check inside many unrelated rules (button-name,
// image-alt, link-name, ...), so surfacing its message there is misleading.
// This exclusion is a design decision, not something axe-core's metadata can tell us,
// so it's kept here rather than derived.
const EXCLUDED_CHECKS = new Set([
  'presentational-role'
]);

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
function readCurrentSetFromPanel() {
  let source;
  try {
    source = fs.readFileSync(PANEL_JS_PATH, 'utf8');
  } catch (error) {
    console.error(`Could not read ${PANEL_JS_PATH}: ${error.message}`);
    process.exit(1);
  }

  const declRegex = new RegExp(`const\\s+${SET_NAME}\\s*=\\s*new Set\\(\\[([\\s\\S]*?)\\]\\)\\s*;`);
  const match = declRegex.exec(source);

  if (!match) {
    console.error(`Could not find "const ${SET_NAME} = new Set([...]);" in ${PANEL_JS_PATH}`);
    process.exit(1);
  }

  const idsRaw = match[1];
  const ids = [...idsRaw.matchAll(/'([^']+)'/g)].map((m) => m[1]);

  return {
    source,
    ids: new Set(ids),
    matchStart: match.index,
    matchEnd: match.index + match[0].length
  };
}

// Detects axe-core check IDs whose fail/incomplete message interpolates a
// ${data...} placeholder (either ${data.xxx} or the bare ${data} form).
function detectChecksWithDataMessage() {
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

function updatePanelFile(panelInfo, newIds) {
  const newDeclaration = formatIdsAsSetLiteral(newIds);
  const updatedSource =
    panelInfo.source.slice(0, panelInfo.matchStart) +
    newDeclaration +
    panelInfo.source.slice(panelInfo.matchEnd);

  fs.writeFileSync(PANEL_JS_PATH, updatedSource, 'utf8');
}

function promptYesNo(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === 'y');
    });
  });
}

async function main() {
  const panelInfo = readCurrentSetFromPanel();
  const detectedChecks = detectChecksWithDataMessage();

  console.log(`\n=== axe-core v${axe.version} analysis ===\n`);
  console.log(`Comparing against ${SET_NAME} in ${path.relative(process.cwd(), PANEL_JS_PATH)}\n`);

  const missingInCode = [...detectedChecks].filter((id) => !panelInfo.ids.has(id));
  const removedFromAxe = [...panelInfo.ids].filter((id) => !detectedChecks.has(id) && !EXCLUDED_CHECKS.has(id));

  if (missingInCode.length === 0 && removedFromAxe.length === 0) {
    console.log(`✅ ${SET_NAME} is fully up to date with this axe-core version.`);
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

  const proceed = await promptYesNo(`Update ${SET_NAME} in panel.js accordingly? (y/N) `);

  if (!proceed) {
    console.log('No changes made.');
    return;
  }

  updatePanelFile(panelInfo, detectedChecks);
  console.log(`✅ ${path.relative(process.cwd(), PANEL_JS_PATH)} updated.`);
}

main();