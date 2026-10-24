#!/usr/bin/env node
/**
 * Link this checkout into the desktop profile as a dsh bundle.
 *
 *   node scripts/install-desktop.mjs              # install
 *   node scripts/install-desktop.mjs --uninstall  # remove
 *
 * It does two things, both idempotent:
 *   1. symlink ~/.dsh/profiles/desktop/node_modules/<pkg> -> this repo root
 *   2. append <pkg> to dsh.profile.bundles in the profile's package.json
 *
 * The bundle patch is applied at boot, so restart dsh afterwards.
 */

import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const uninstall = process.argv.includes('--uninstall');
const repoRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
const name = pkg.name;

const dshHome = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
const profileDir = path.join(dshHome, 'profiles', 'desktop');
const profilePkgPath = path.join(profileDir, 'package.json');
const linkPath = path.join(profileDir, 'node_modules', name);

if (!fs.existsSync(profilePkgPath)) {
  console.error('install-desktop: no desktop profile at ' + profileDir);
  console.error('                 run dsh once, or pass DSH_HOME=/path/to/.dsh');
  process.exit(1);
}

const profilePkg = JSON.parse(fs.readFileSync(profilePkgPath, 'utf8'));
profilePkg.dsh ??= {};
profilePkg.dsh.profile ??= {};
const bundles = (profilePkg.dsh.profile.bundles ??= []);

let changed = false;

if (uninstall) {
  const existing = fs.lstatSync(linkPath, { throwIfNoEntry: false });
  if (existing) {
    if (existing.isSymbolicLink()) fs.unlinkSync(linkPath);
    else fs.rmSync(linkPath, { recursive: true, force: true });
    console.log('unlinked ' + linkPath);
  }
  const before = bundles.length;
  profilePkg.dsh.profile.bundles = bundles.filter((entry) => entry !== name);
  if (profilePkg.dsh.profile.bundles.length !== before) {
    changed = true;
    console.log('removed ' + name + ' from dsh.profile.bundles');
  }
} else {
  fs.mkdirSync(path.dirname(linkPath), { recursive: true });
  const existing = fs.lstatSync(linkPath, { throwIfNoEntry: false });
  if (existing) {
    const current = existing.isSymbolicLink() ? path.resolve(path.dirname(linkPath), fs.readlinkSync(linkPath)) : null;
    if (current === repoRoot) console.log('link already correct: ' + linkPath);
    else {
      // unlink the link itself: rmSync({recursive}) can leave a directory symlink in place
      if (existing.isSymbolicLink()) fs.unlinkSync(linkPath);
      else fs.rmSync(linkPath, { recursive: true, force: true });
      fs.symlinkSync(repoRoot, linkPath, 'dir');
      console.log('relinked ' + linkPath + ' -> ' + repoRoot);
    }
  } else {
    fs.symlinkSync(repoRoot, linkPath, 'dir');
    console.log('linked ' + linkPath + ' -> ' + repoRoot);
  }
  if (!bundles.includes(name)) {
    bundles.push(name);
    changed = true;
    console.log('added ' + name + ' to dsh.profile.bundles');
  }
}

if (changed) {
  fs.writeFileSync(profilePkgPath, JSON.stringify(profilePkg, null, 2) + '\n');
  console.log('wrote ' + profilePkgPath);
} else {
  console.log('profile already up to date: ' + profilePkgPath);
}

console.log(uninstall ? 'restart dsh to drop the preset.' : 'restart dsh to pick the preset up.');
