#!/usr/bin/env node
/**
 * Ask the host itself what each installed profile resolves to.
 *
 *   node scripts/check-profiles.mjs            # every profile under ~/.dsh/profiles
 *   node scripts/check-profiles.mjs web        # only the named ones
 *   DSH_HOME=/tmp/alt node scripts/check-profiles.mjs
 *
 * This is the end-to-end check that "npm run verify" cannot do, because verify
 * stays offline and machine independent. Here we load the real
 * "@deepseek-ai/dsh-app-boot" from the installed host and call
 * loadProfileDirectory(binName, dir, installAnchor) exactly like the surfaces
 * do at boot, then assert that this package contributes a live "preset-reverse"
 * row. It catches the failure modes that only exist on a real machine:
 * a stale node_modules link, a bundle missing from dsh.profile.bundles, a
 * peer-version skip, or a machine path that no longer resolves.
 *
 * Exit codes: 0 = every profile that lists the bundle composes, 1 = at least
 * one does not, 2 = nothing to check (no host or no profiles).
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const bundleName = pkg.name;
const expectedRows = pkg.dsh?.preset?.id ? 1 : 1; // one preset row per profile

const dshHome = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
const profilesRoot = path.join(dshHome, 'profiles');

const anchors = [
  process.env.DSH_INSTALL_DIR && path.join(process.env.DSH_INSTALL_DIR, 'package.json'),
  '/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/package.json',
  '/usr/local/lib/node_modules/@deepseek-ai/dsh/package.json',
  '/usr/lib/node_modules/@deepseek-ai/dsh/package.json',
].filter((candidate) => candidate && fs.existsSync(candidate));

let boot = null;
let anchor = null;
for (const candidate of anchors) {
  try {
    boot = createRequire(candidate)('@deepseek-ai/dsh-app-boot');
    anchor = candidate;
    break;
  } catch {}
}

if (!boot?.loadProfileDirectory) {
  console.error('check-profiles: cannot load @deepseek-ai/dsh-app-boot from an installed dsh.');
  console.error('                set DSH_INSTALL_DIR to the dsh package directory, or skip this check.');
  process.exit(2);
}

const hostVersion = (() => {
  try {
    return JSON.parse(fs.readFileSync(anchor, 'utf8')).version;
  } catch {
    return 'unknown';
  }
})();

const only = process.argv.slice(2).filter((arg) => !arg.startsWith('-'));
const profiles = fs.existsSync(profilesRoot)
  ? fs
      .readdirSync(profilesRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .filter((dir) => fs.existsSync(path.join(profilesRoot, dir, 'package.json')))
      .filter((dir) => only.length === 0 || only.includes(dir))
      .sort()
  : [];

if (profiles.length === 0) {
  console.error('check-profiles: no profiles under ' + profilesRoot);
  process.exit(2);
}

console.log('host ' + hostVersion + ' (' + anchor + ')');
let failed = 0;
let checked = 0;

for (const dir of profiles) {
  const profileDir = path.join(profilesRoot, dir);
  const profilePkg = JSON.parse(fs.readFileSync(path.join(profileDir, 'package.json'), 'utf8'));
  const bundles = profilePkg.dsh?.profile?.bundles ?? [];

  if (!bundles.includes(bundleName)) {
    console.log('SKIP  ' + dir + ' — not installed there (dsh plugin --profile ' + dir + ' add ' + bundleName + ')');
    continue;
  }

  checked += 1;
  let loaded;
  try {
    loaded = boot.loadProfileDirectory('dsh', profileDir, anchor);
  } catch (error) {
    failed += 1;
    console.log('FAIL  ' + dir + ' — profile did not load: ' + String(error && error.message));
    continue;
  }

  const skipped = loaded.skippedBundles ?? [];
  if (skipped.some((entry) => entry.packageName === bundleName)) {
    failed += 1;
    const reason = skipped.find((entry) => entry.packageName === bundleName)?.reason ?? '';
    console.log('FAIL  ' + dir + ' — bundle skipped: ' + String(reason).split('\n')[0]);
    continue;
  }

  const rows = loaded.layers.flatMap((layer) =>
    (layer.patches ?? []).flatMap((patch) => (Array.isArray(patch.insert) ? patch.insert : [])),
  );
  const ours = rows.filter((row) => row?.id === 'preset-reverse');
  const preset = ours[0]?.config;

  if (ours.length !== expectedRows) {
    failed += 1;
    console.log('FAIL  ' + dir + ' — expected ' + expectedRows + ' preset-reverse row, found ' + ours.length);
    continue;
  }
  if (!preset || preset.id !== 'reverse' || !Array.isArray(preset.plugins)) {
    failed += 1;
    console.log('FAIL  ' + dir + ' — preset row is malformed: ' + JSON.stringify(preset).slice(0, 120));
    continue;
  }
  if (ours[0].name !== '@deepseek-ai/dsh-agent-preset') {
    failed += 1;
    console.log('FAIL  ' + dir + ' — row points at ' + String(ours[0].name));
    continue;
  }

  const layerNames = loaded.layers.map((layer) => layer.packageName);
  const index = layerNames.indexOf(bundleName);
  console.log(
    'PASS  ' +
      dir +
      ' — preset reverse / ' +
      preset.plugins.length +
      ' plugin rows, layer ' +
      (index + 1) +
      '/' +
      layerNames.length +
      ', ' +
      skipped.length +
      ' unrelated skip(s)',
  );
}

if (checked === 0) {
  console.log('');
  console.log('nothing installed — run: node scripts/install.mjs --all');
  process.exit(2);
}

console.log('');
console.log(failed === 0 ? 'RESULT PASS — ' + checked + ' profile(s) compose' : 'RESULT FAIL — ' + failed + ' profile(s)');
process.exit(failed === 0 ? 0 : 1);
