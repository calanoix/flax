// Builds one ZIP per store from src/, adapting manifest.json for each:
//   dist/flax-<version>-chromium.zip  → Chrome, Edge, Opera
//   dist/flax-<version>-firefox.zip   → Firefox (AMO)
//
// Usage (from the project root): node build.mjs
// Requires the `zip` or `bsdtar` command.

import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname);
const SRC = join(ROOT, 'src');
const DIST = join(ROOT, 'dist');

const baseManifest = JSON.parse(readFileSync(join(SRC, 'manifest.json'), 'utf8'));
const { version } = baseManifest;

const targets = {
  // Chromium stores: service worker only, no Firefox-specific keys
  // (Edge rejects background.scripts in MV3).
  chromium(manifest) {
    manifest.background = { service_worker: manifest.background.service_worker };
    delete manifest.browser_specific_settings;
    return manifest;
  },

  // Firefox: background scripts only (service_worker is unsupported there)
  firefox(manifest) {
    const worker = manifest.background.service_worker;
    manifest.background = { scripts: manifest.background.scripts ?? [worker] };
    manifest.browser_specific_settings = {
      ...manifest.browser_specific_settings,
      // No DevTools on Firefox for Android; this only silences AMO's warning
      // about data_collection_permissions needing Android 142+.
      gecko_android: { strict_min_version: '142.0' }
    };
    return manifest;
  }
};

rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST);

for (const [name, transform] of Object.entries(targets)) {
  const outDir = join(DIST, name);
  cpSync(SRC, outDir, {
    recursive: true,
    filter: (path) => !path.endsWith('.DS_Store')
  });

  const manifest = transform(structuredClone(baseManifest));
  writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

  const zipPath = join(DIST, `flax-${version}-${name}.zip`);
  createZip(outDir, zipPath);
  console.log(`✓ ${zipPath}`);
}

// Zips the folder's contents (not the folder) so manifest.json sits at the root.
// Uses `zip` if installed, otherwise `bsdtar` (libarchive, present on Arch-based systems).
function createZip(dir, zipPath) {
  const entries = readdirSync(dir);
  try {
    execFileSync('zip', ['-r', '-q', zipPath, ...entries], { cwd: dir, stdio: 'pipe' });
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    execFileSync('bsdtar', ['--format', 'zip', '-cf', zipPath, ...entries], { cwd: dir });
  }
}