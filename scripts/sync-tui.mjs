#!/usr/bin/env node
/**
 * Regenerate tui/agent.cordis.yml from the plugins list in cordis.patch.yml.
 *
 * The desktop mount and the dsh-tui mount must describe the same composition.
 * Keeping two hand-maintained copies is how they drift, so the patch file is
 * the single source of truth and this script projects it into the entry-list
 * shape that dsh-tui's include row consumes.
 *
 * The projection is textual on purpose: it carries the comments from the patch
 * file across verbatim, and verify.mjs re-parses both files and deep-compares
 * them, so a broken projection fails the build instead of shipping quietly.
 *
 *   node scripts/sync-tui.mjs           # rewrite tui/agent.cordis.yml
 *   node scripts/sync-tui.mjs --check   # exit 1 if it is out of date
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const PATCH = join(root, 'cordis.patch.yml');
const TARGET = join(root, 'tui', 'agent.cordis.yml');

const HEADER = ["# GENERATED FILE — do not edit. Source of truth: cordis.patch.yml.","# Regenerate with `npm run sync:tui`; `npm run verify` fails if this file drifts.","#","# The `reverse` agent preset for dsh-tui: the same plugin composition the","# desktop bundle mounts, expressed as a bare entry list because that is what","# an include row consumes.","#","# HOW THIS FILE IS MOUNTED. The preset is a declaration row in the profile","# patch (`~/.dsh/profiles/dsh-tui/cordis.patch.yml`, row id `preset-reverse`,","# plugin `@deepseek-ai/dsh-agent-preset`); its `config.plugins` carries one","# `@deepseek-ai/cordis-plugin-include` row pointing at this file. The legacy","# directory roster (`~/.dsh/.agent-presets/<id>/agent.cordis.yml`,","# `@deepseek-ai/dsh-agent-presets`) is NOT mounted on hosts whose patch disables","# that row whenever `@deepseek-ai/dsh-agent-preset-registry` resolves — the","# registry 'neither scans directories nor accepts preset paths'. A directory","# preset is therefore inert there; see docs/architecture.md.","#","# A service row here MUST sit inside a group carrying an `isolate` realm.","# Without one it publishes into the root realm, where it is process-global:","# another preset publishing the same name collides, and a host reader would","# resolve one preset's instance for every session. `true` means an","# entry-local realm — this mount's own private instance, apart from every","# other preset's. A shared label does NOT pool instances; `provide()` throws","# on the second registration under the same realm symbol."].join('\n') + '\n';

const lines = readFileSync(PATCH, 'utf8').split('\n');
const start = lines.findIndex((line) => line === '        plugins:');
if (start === -1) {
  console.error('sync-tui: cordis.patch.yml has no "        plugins:" line to project.');
  process.exit(1);
}

const INDENT = '          ';
const rows = [];
for (const line of lines.slice(start + 1)) {
  if (line.trim() === '') { rows.push(''); continue; }
  if (!line.startsWith(INDENT)) {
    console.error('sync-tui: unexpected indentation in the plugins list: ' + JSON.stringify(line));
    process.exit(1);
  }
  rows.push(line.slice(INDENT.length));
}

while (rows.length > 0 && rows[rows.length - 1] === '') rows.pop();
if (rows.length === 0) {
  console.error('sync-tui: the plugins list is empty.');
  process.exit(1);
}

const next = HEADER + '\n' + rows.join('\n') + '\n';
const check = process.argv.includes('--check');

let current = null;
try { current = readFileSync(TARGET, 'utf8'); } catch {}

if (check) {
  if (current !== next) {
    console.error('sync-tui: tui/agent.cordis.yml is out of date — run npm run sync:tui');
    process.exit(1);
  }
  console.log('sync-tui: tui/agent.cordis.yml is in sync.');
  process.exit(0);
}

writeFileSync(TARGET, next);
const rowCount = rows.filter((line) => line.startsWith('- id: ')).length;
console.log('sync-tui: wrote tui/agent.cordis.yml (' + rowCount + ' top-level rows)');
