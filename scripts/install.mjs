#!/usr/bin/env node
/**
 * Link this checkout into one or more dsh profiles as a bundle.
 *
 *   node scripts/install.mjs                     # list the profiles it can see
 *   node scripts/install.mjs --profile desktop    # install into one profile
 *   node scripts/install.mjs --profile web --profile headless
 *   node scripts/install.mjs --all               # every profile that exists
 *   node scripts/install.mjs --all --uninstall   # remove
 *
 * For each target profile it does two things, both idempotent:
 *   1. symlink <profile>/node_modules/<pkg> -> this repo root
 *   2. append <pkg> to dsh.profile.bundles in the profile's package.json
 *
 * The bundle patch is applied at boot: restart the owning surface afterwards
 * (desktop app, "dsh web", "dsh", or dsh-tui).
 *
 * Existing profiles on a default install: desktop (Electron app + web GUI),
 * web ("dsh web"), headless ("dsh -p"), dsh-tui ("dsh-tui"). A profile that
 * does not exist yet is created by its own surface first, not by this script:
 * "dsh plugin --profile <name> ..." initializes it from the profile template.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const argv = process.argv.slice(2);
const uninstall = argv.includes('--uninstall');
const all = argv.includes('--all');

/** @returns {string[]} values of every --profile flag, in order */
function requestedProfiles() {
  const out = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--profile' || arg === '-p') {
      const value = argv[i + 1];
      if (!value || value.startsWith('-')) {
        console.error('install: --profile needs a name, e.g. --profile web');
        process.exit(2);
      }
      out.push(value);
      i += 1;
    } else if (arg.startsWith('--profile=')) {
      out.push(arg.slice('--profile='.length));
    } else if (!['--all', '--uninstall', '--help', '-h'].includes(arg)) {
      console.error('install: unknown argument ' + arg);
      process.exit(2);
    }
  }
  return out;
}

const repoRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
const name = pkg.name;

const dshHome = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
const profilesRoot = path.join(dshHome, 'profiles');

/** @returns {string[]} profile directories that already carry a package.json */
function existingProfiles() {
  if (!fs.existsSync(profilesRoot)) return [];
  return fs
    .readdirSync(profilesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((dir) => fs.existsSync(path.join(profilesRoot, dir, 'package.json')))
    .sort();
}

function describeProfile(dir) {
  const file = path.join(profilesRoot, dir, 'package.json');
  try {
    const profilePkg = JSON.parse(fs.readFileSync(file, 'utf8'));
    const bundles = profilePkg.dsh?.profile?.bundles ?? [];
    return bundles.includes(name) ? 'installed' : 'not installed';
  } catch {
    return 'unreadable package.json';
  }
}

function surface(dir) {
  return (
    {
      desktop: 'quit and reopen the DeepSeek Harness app',
      web: 'restart "dsh web"',
      headless: 'each "dsh -p" run picks it up',
      'dsh-tui': 'restart dsh-tui',
    }[dir] ?? 'restart that surface'
  );
}

/** @returns {boolean} true when the profile now lists the bundle we want */
function apply(dir) {
  const profileDir = path.join(profilesRoot, dir);
  const profilePkgPath = path.join(profileDir, 'package.json');
  const linkPath = path.join(profileDir, 'node_modules', name);

  if (!fs.existsSync(profilePkgPath)) {
    console.error('install: no profile at ' + profileDir);
    console.error('         create it first: dsh plugin --profile ' + dir + ' add <package>');
    return false;
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
      console.log('  unlinked ' + linkPath);
    } else {
      console.log('  no link at ' + linkPath);
    }
    if (bundles.includes(name)) {
      profilePkg.dsh.profile.bundles = bundles.filter((entry) => entry !== name);
      changed = true;
      console.log('  removed ' + name + ' from dsh.profile.bundles');
    } else {
      console.log('  dsh.profile.bundles already clean');
    }
  } else {
    fs.mkdirSync(path.dirname(linkPath), { recursive: true });
    const existing = fs.lstatSync(linkPath, { throwIfNoEntry: false });
    if (!existing) {
      fs.symlinkSync(repoRoot, linkPath, 'dir');
      console.log('  linked ' + linkPath + ' -> ' + repoRoot);
    } else {
      const current = existing.isSymbolicLink()
        ? path.resolve(path.dirname(linkPath), fs.readlinkSync(linkPath))
        : null;
      if (current === repoRoot) {
        console.log('  link already correct');
      } else {
        // unlink the link itself: rmSync({recursive}) can leave a directory symlink behind
        if (existing.isSymbolicLink()) fs.unlinkSync(linkPath);
        else fs.rmSync(linkPath, { recursive: true, force: true });
        fs.symlinkSync(repoRoot, linkPath, 'dir');
        console.log('  relinked ' + linkPath + ' -> ' + repoRoot);
      }
    }
    if (bundles.includes(name)) {
      console.log('  dsh.profile.bundles already lists ' + name);
    } else {
      bundles.push(name);
      changed = true;
      console.log('  added ' + name + ' to dsh.profile.bundles');
    }
  }

  // A profile patch that also inserts the same preset id would mount it twice.
  const profilePatch = path.join(profileDir, 'cordis.patch.yml');
  if (!uninstall && fs.existsSync(profilePatch)) {
    const text = fs.readFileSync(profilePatch, 'utf8');
    if (/^\s*(?:-\s*)?id:\s*preset-reverse\s*$/m.test(text)) {
      console.warn('  warning: this profile also inserts preset-reverse in ' + profilePatch);
      console.warn('           two live sources for one preset id: remove one, or expect a duplicate row');
    }
  }

  if (changed) {
    fs.writeFileSync(profilePkgPath, JSON.stringify(profilePkg, null, 2) + '\n');
    console.log('  wrote ' + profilePkgPath);
  } else {
    console.log('  profile already up to date');
  }
  console.log('  next: ' + surface(dir));
  return true;
}

if (argv.includes('--help') || argv.includes('-h')) {
  console.log('usage: node scripts/install.mjs [--profile <name>]... [--all] [--uninstall]');
  process.exit(0);
}

const requested = requestedProfiles();
const known = existingProfiles();

if (!requested.length && !all) {
  console.log('profiles under ' + profilesRoot + ':');
  if (!known.length) console.log('  (none yet - run a dsh surface once)');
  for (const dir of known) console.log('  ' + dir.padEnd(10) + describeProfile(dir));
  console.log('');
  console.log('usage: node scripts/install.mjs --profile <name> [--profile <name>]... | --all [--uninstall]');
  process.exit(0);
}

const targets = all ? known : requested;
let failures = 0;
for (const dir of targets) {
  console.log((uninstall ? 'uninstall ' : 'install ') + dir);
  if (apply(dir) === false) failures += 1;
}

if (failures) {
  console.error('install: ' + failures + ' profile(s) failed');
  process.exit(1);
}
