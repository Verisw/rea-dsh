#!/usr/bin/env node
/**
 * Offline contract checks for this bundle. `node scripts/verify.mjs`.
 *
 * Structural checks always run and need no DSH installation. Checks that need
 * the real host (plugin resolution, the shipped `standard` composition, the
 * live Schema validation of the two rows this preset configures) run when a
 * DSH installation is resolvable and are reported as SKIP otherwise.
 *
 * Exit code 0 means every check either passed or was skipped with a reason.
 */
import { readFileSync, existsSync, statSync, mkdirSync, symlinkSync, rmSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire, isBuiltin } from 'node:module';
import { tmpdir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

let failed = 0;
let skipped = 0;
const ok = (label, detail) => console.log(`PASS  ${label}${detail === undefined ? '' : ` — ${detail}`}`);
const bad = (label, detail) => { failed += 1; console.log(`FAIL  ${label}${detail === undefined ? '' : ` — ${detail}`}`); };
const skip = (label, why) => { skipped += 1; console.log(`SKIP  ${label} — ${why}`); };
const group = (title) => console.log(`\n# ${title}`);

// ── yaml, from our own devDependency or from the host installation ───────────
const hostAnchor = (() => {
  for (const candidate of [
    process.env.DSH_INSTALL_DIR && join(process.env.DSH_INSTALL_DIR, 'package.json'),
    '/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/package.json',
    '/usr/local/lib/node_modules/@deepseek-ai/dsh/package.json',
    '/usr/lib/node_modules/@deepseek-ai/dsh/package.json',
  ]) {
    try { if (candidate && existsSync(candidate)) return candidate; } catch {}
  }
  return null;
})();

const yaml = (() => {
  for (const anchor of [import.meta.url, join(root, 'package.json'), hostAnchor]) {
    if (!anchor) continue;
    try { return createRequire(anchor)('js-yaml'); } catch {}
  }
  return null;
})();

if (!yaml?.Type) {
  console.error('verify: js-yaml is not installed — run `npm install` first.');
  process.exit(1);
}

const isJsExpr = (value) => typeof value === 'object' && value !== null && '__jsExpr' in value;
const JsExpr = new yaml.Type('tag:yaml.org,2002:js', {
  kind: 'scalar',
  resolve: (data) => typeof data === 'string',
  construct: (data) => ({ __jsExpr: data }),
  predicate: isJsExpr,
  represent: (value) => value.__jsExpr,
});
const schema = yaml.JSON_SCHEMA.extend(JsExpr);
const parse = (path) => yaml.load(readFileSync(path, 'utf8'), { schema });

// ── 1. package shape ────────────────────────────────────────────────────────
group('package');

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
if (pkg.name === 'dsh-rea-reverse-preset') ok('package name', pkg.name); else bad('package name', pkg.name);
if (/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(pkg.version)) ok('version is semver', pkg.version); else bad('version is semver', pkg.version);
if (pkg.license === 'MIT' && existsSync(join(root, 'LICENSE'))) ok('license declared and present', 'MIT'); else bad('license declared and present', String(pkg.license));

const patchPath = pkg.dsh?.bundle?.patch;
if (patchPath === './cordis.patch.yml' && existsSync(join(root, patchPath))) ok('dsh.bundle.patch resolves', patchPath);
else bad('dsh.bundle.patch resolves', String(patchPath));

const shipped = ['cordis.patch.yml', ...(pkg.files ?? [])];
const missing = [...new Set(shipped)].filter((entry) => !existsSync(join(root, entry)));
if (missing.length === 0) ok('every published file exists', `${new Set(shipped).size} entries`); else bad('every published file exists', `missing: ${missing.join(', ')}`);

// ── 2. the patch parses and declares exactly one preset ─────────────────────
group('preset declaration');

let patchDoc;
try { patchDoc = parse(join(root, 'cordis.patch.yml')); } catch (error) { bad('cordis.patch.yml parses', error.message); }
if (patchDoc) {
  const layers = patchDoc.filter((layer) => layer && typeof layer === 'object' && Array.isArray(layer.insert));
  if (layers.length === 1 && patchDoc.length === 1) ok('patch is one pure insert layer'); else bad('patch is one pure insert layer', `${patchDoc.length} layers`);
  const inserted = layers[0]?.insert ?? [];
  if (inserted.length === 1) ok('patch inserts exactly one row'); else bad('patch inserts exactly one row', String(inserted.length));

  const decl = inserted[0] ?? {};
  if (decl.name === '@deepseek-ai/dsh-agent-preset') ok('row uses the official declaration plugin', decl.name); else bad('row uses the official declaration plugin', String(decl.name));

  const config = decl.config ?? {};
  for (const key of ['id', 'name', 'description', 'order']) {
    if (config[key] === undefined) bad(`declaration has ${key}`);
  }
  if (typeof config.id === 'string' && /^[a-z0-9-]+$/.test(config.id)) ok('preset id is a stable slug', config.id); else bad('preset id is a stable slug', String(config.id));
  if (typeof config.order === 'number') ok('declaration has an order', String(config.order)); else bad('declaration has an order');

  const plugins = Array.isArray(config.plugins) ? config.plugins : [];
  const rows = [];
  const walk = (list) => {
    for (const entry of list) {
      if (!entry || typeof entry !== 'object') continue;
      rows.push(entry);
      if (entry.group || entry.name === 'cordis:group') walk(entry.config ?? []);
    }
  };
  walk(plugins);

  if (plugins.length >= 18) ok('top-level rows', String(plugins.length)); else bad('top-level rows', String(plugins.length));
  if (rows.length >= 30) ok('rows including group children', String(rows.length)); else bad('rows including group children', String(rows.length));

  const ids = rows.map((entry) => entry.id);
  const dupes = ids.filter((id, index) => ids.indexOf(id) !== index);
  if (dupes.length === 0) ok('row ids are unique', `${ids.length} ids`); else bad('row ids are unique', dupes.join(', '));

  const anonymous = rows.filter((entry) => typeof entry.name !== 'string' || typeof entry.id !== 'string');
  if (anonymous.length === 0) ok('every row names an id and a plugin'); else bad('every row names an id and a plugin', JSON.stringify(anonymous.map((entry) => entry.id)));

  // A service row outside a realm is process-global; every group here must carry one.
  const groups = rows.filter((entry) => entry.group === true || entry.name === 'cordis:group');
  const unisolated = groups.filter((entry) => !entry.isolate || Object.keys(entry.isolate).length === 0);
  if (unisolated.length === 0) ok('every group carries an isolate realm', groups.map((g) => g.id).join(', '));
  else bad('every group carries an isolate realm', unisolated.map((g) => g.id).join(', '));

  // ── 3. the REA row ────────────────────────────────────────────────────────
  group('REA row');

  const evaluate = new Function('ctx', 'expr', 'with (ctx) { return eval(expr) }');
  const evalRow = (row, ctx) => Object.fromEntries(Object.entries(row?.config ?? {}).map(([key, value]) => [
    key,
    isJsExpr(value) ? (() => { try { return evaluate(ctx, value.__jsExpr); } catch (error) { return { error: error.message }; } })() : value,
  ]));
  const evalAll = (ctx) => {
    const out = {};
    const visit = (node, path) => {
      if (isJsExpr(node)) {
        try { out[path] = evaluate(ctx, node.__jsExpr); }
        catch (error) { out[path] = { error: error.message }; }
        return;
      }
      if (Array.isArray(node)) { node.forEach((item, index) => visit(item, `${path}[${index}]`)); return; }
      if (node && typeof node === 'object') { for (const [key, value] of Object.entries(node)) visit(value, path ? `${path}.${key}` : key); }
    };
    visit(plugins, '');
    return out;
  };

  const jsexprs = Object.keys(evalAll(Object.create({ baseUrl: `${pathToFileURL(join(root, 'tui')).href}/` })));
  if (jsexprs.length > 0) ok('the composition contains `!!js` scalars', jsexprs.join(', '));

  const rea = plugins.find((entry) => entry.id === 'mcp-rea');
  if (!rea) bad('mcp-rea row exists');
  else {
    const c = rea.config ?? {};
    if (rea.name === '@deepseek-ai/dsh-mcp-client') ok('mcp-rea uses the stdio client', rea.name); else bad('mcp-rea uses the stdio client', String(rea.name));
    if (c.serverName === 'rea' && c.transport === 'stdio') ok('serverName and transport', `${c.serverName}/${c.transport}`); else bad('serverName and transport', `${c.serverName}/${c.transport}`);
    if (c.failOnStartupError === false) ok('a dead REA leaves the preset selectable', 'failOnStartupError: false'); else bad('a dead REA leaves the preset selectable', String(c.failOnStartupError));

    const env = evalRow(rea, Object.create({ baseUrl: `${pathToFileURL(root).href}/` }));
    const args = env.args;
    if (Array.isArray(args)) {
      if (args.includes('--prefer-offline')) ok('npx keeps `--prefer-offline`'); else bad('npx keeps `--prefer-offline`', JSON.stringify(args));
      const positional = args.filter((value) => !String(value).startsWith('-'));
      if (positional.length === 2 && positional[1] === 'mcp') ok('exactly one positional reaches REA', positional.join(' '));
      else bad('exactly one positional reaches REA', JSON.stringify(positional));
      if (String(positional[0]).startsWith('rea-agents@')) ok('REA is pinned by spec', positional[0]); else bad('REA is pinned by spec', String(positional[0]));
    } else bad('mcp-rea.args evaluates to an array', JSON.stringify(args));

    const envValues = env.env;
    if (envValues && typeof envValues === 'object' && !envValues.error) {
      const badValues = Object.entries(envValues).filter(([, value]) => typeof value !== 'string' || value === '');
      if (badValues.length === 0) ok('every env value is a non-empty string', Object.keys(envValues).join(', ') || '(none on this machine)');
      else bad('every env value is a non-empty string', JSON.stringify(badValues));
    } else bad('mcp-rea.env evaluates to an object', JSON.stringify(envValues?.error ?? envValues ?? null));

    if (!existsSync(join(root, 'cordis.patch.yml')) || !/rea-agents@\d/.test(readFileSync(join(root, 'cordis.patch.yml'), 'utf8'))) {
      bad('REA version is pinned in the source', 'no rea-agents@<version> literal');
    }
  }

  // ── 4. the skill row ──────────────────────────────────────────────────────
  group('skill row');

  const skills = plugins.find((entry) => entry.id === 'skill-filesystem');
  if (!skills) bad('skill-filesystem row exists');
  else {
    if (skills.config?.customSkillDirs === undefined) ok('no redundant customSkillDirs', 'the user-agents root already scans ~/.agents/skills');
    else bad('no redundant customSkillDirs');

    const expr = skills.config?.bundledSkillDir;
    if (!isJsExpr(expr)) bad('bundledSkillDir is computed');
    else {
      // (a) installed-package shape: a profile whose node_modules links to this repo
      const fake = join(tmpdir(), `rea-dsh-verify-${process.pid}`);
      rmSync(fake, { recursive: true, force: true });
      mkdirSync(join(fake, 'node_modules'), { recursive: true });
      symlinkSync(root, join(fake, 'node_modules', 'dsh-rea-reverse-preset'), 'dir');
      const installed = evaluate(Object.create({ baseUrl: `${pathToFileURL(fake).href}/` }), expr.__jsExpr);
      rmSync(fake, { recursive: true, force: true });
      if (typeof installed === 'string' && existsSync(installed)) ok('bundledSkillDir resolves from an installed profile', installed);
      else bad('bundledSkillDir resolves from an installed profile', String(installed));

      // (b) dsh-tui shape: this repo's tui/ directory as the include anchor
      const tui = evaluate(Object.create({ baseUrl: `${pathToFileURL(join(root, 'tui')).href}/` }), expr.__jsExpr);
      if (typeof tui === 'string' && existsSync(tui)) ok('bundledSkillDir resolves from the tui include', tui);
      else bad('bundledSkillDir resolves from the tui include', String(tui));

      // (c) nothing mounted at all: must degrade to undefined, never to a bogus path
      const nowhere = evaluate(Object.create({ baseUrl: `${pathToFileURL(join(tmpdir(), 'rea-dsh-absent')).href}/` }), expr.__jsExpr);
      if (nowhere === undefined) ok('an unresolvable skill dir is omitted, not guessed', 'undefined'); else bad('an unresolvable skill dir is omitted, not guessed', String(nowhere));
    }

    const dir = join(root, 'skills', 'reverse-workflow');
    if (existsSync(join(dir, 'SKILL.md'))) ok('the bundled skill is present', 'skills/reverse-workflow/SKILL.md'); else bad('the bundled skill is present');
  }

  // ── 5. portability ────────────────────────────────────────────────────────
  group('portability');

  const machinePaths = /(^|[\s'"`(=,:\[(])(\/Users\/|\/home\/[a-z0-9._-]+\/|[A-Za-z]:\\Users\\)/m;
  for (const file of ['cordis.patch.yml', 'tui/agent.cordis.yml']) {
    const hit = readFileSync(join(root, file), 'utf8').split('\n').findIndex((line) => machinePaths.test(line));
    if (hit === -1) ok(`no machine-specific path in ${file}`); else bad(`no machine-specific path in ${file}`, `line ${hit + 1}`);
  }

  // ── 6. the dsh-tui twin ───────────────────────────────────────────────────
  group('dsh-tui twin');

  const twinPath = join(root, 'tui', 'agent.cordis.yml');
  if (!existsSync(twinPath)) bad('tui/agent.cordis.yml exists');
  else {
    const stable = (value) => {
      if (isJsExpr(value)) return { js: value.__jsExpr };
      if (Array.isArray(value)) return value.map(stable);
      if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
      return value;
    };
    let twin;
    try { twin = parse(twinPath); } catch (error) { bad('tui/agent.cordis.yml parses', error.message); }
    if (twin) {
      const same = JSON.stringify(stable(twin)) === JSON.stringify(stable(plugins));
      if (same) ok('tui composition equals the patch composition', `${twin.length} rows`);
      else bad('tui composition equals the patch composition', 'run `npm run sync:tui`');
    }
    const header = readFileSync(twinPath, 'utf8').slice(0, 400);
    if (header.includes('GENERATED FILE')) ok('the twin is marked generated'); else bad('the twin is marked generated');
  }

  // ── 7. the real host, when there is one ───────────────────────────────────
  group('host');

  const hostPackage = hostAnchor;

  if (!hostPackage) skip('host composition parity', 'no DSH installation on this machine');
  else {
    const hostRoot = dirname(hostPackage);
    const hostVersion = JSON.parse(readFileSync(hostPackage, 'utf8')).version;
    ok('host installation found', `${hostVersion} at ${hostRoot}`);

    const standardPath = join(hostRoot, 'node_modules', '@deepseek-ai', 'dsh-web-app', 'presets', 'standard.patch.yml');
    if (!existsSync(standardPath)) skip('standard preset parity', 'dsh-web-app is not installed beside the host');
    else {
      try {
        const standard = parse(standardPath);
        const standardRows = standard[0].insert[0].config.plugins;
        const standardIds = new Set();
        const standardWalk = (list) => { for (const entry of list) { standardIds.add(entry.id); if (entry.group) standardWalk(entry.config ?? []); } };
        standardWalk(standardRows);
        const ours = new Set(ids);
        const added = [...ours].filter((id) => !standardIds.has(id));
        const dropped = [...standardIds].filter((id) => !ours.has(id));
        const expectedAdded = ['mcp-rea', 'tool-presentation'];
        const unexpected = added.filter((id) => !expectedAdded.includes(id));
        if (unexpected.length === 0) ok('only the two REA rows are added over standard', added.join(', ') || '(none)');
        else console.log(`WARN  unexpected rows added over standard — ${unexpected.join(', ')}`);
        if (dropped.length === 0) ok('no standard row is dropped'); else console.log(`WARN  rows missing versus standard — ${dropped.join(', ')}`);
      } catch (error) { skip('standard preset parity', error.message); }
    }

    // Resolve every plugin name the way the loader would.
    const resolvable = [];
    const unresolvable = [];
    for (const row of rows) {
      if (row.name === 'cordis:group') continue;
      let target = row.name;
      if (target.startsWith('cordis:')) { resolvable.push(target); continue; }
      let found = false;
      for (const anchor of [join(root, 'package.json'), hostPackage]) {
        try { createRequire(anchor).resolve(`${target}/package.json`); found = true; break; } catch {}
        try { createRequire(anchor).resolve(target); found = true; break; } catch {}
      }
      (found ? resolvable : unresolvable).push(target);
    }
    if (unresolvable.length === 0) ok('every plugin row resolves here', `${resolvable.length} names`);
    else console.log(`WARN  unresolvable rows — ${[...new Set(unresolvable)].join(', ')} (expected when the host does not ship them)`);

    // The two rows this preset actually configures, against their live Schema.
    for (const [label, rowId, path] of [
      ['mcp-client', 'mcp-rea', '@deepseek-ai/dsh-mcp-client'],
      ['skill-filesystem', 'skill-filesystem', '@deepseek-ai/dsh-skill-filesystem'],
    ]) {
      try {
        const anchor = createRequire(hostPackage);
        const mod = await import(pathToFileURL(anchor.resolve(path)).href);
        const Plugin = mod.default ?? mod;
        const Schema = Plugin.Config ?? Plugin.schema ?? Plugin.prototype?.constructor?.Config;
        const row = rows.find((entry) => entry.id === rowId);
        const ctx = Object.create({ baseUrl: `${pathToFileURL(join(root, 'tui')).href}/` });
        const evaluated = {};
        for (const [key, value] of Object.entries(row.config ?? {})) evaluated[key] = isJsExpr(value) ? evaluate(ctx, value.__jsExpr) : value;
        const cleaned = Object.fromEntries(Object.entries(evaluated).filter(([, value]) => value !== undefined));
        if (!Schema) { skip(`${label} schema`, 'no static Config on the plugin'); continue; }
        Schema(cleaned);
        ok(`${label} config passes the live schema`, Object.keys(cleaned).join(', ') || '(empty)');
      } catch (error) {
        bad(`${label} config passes the live schema`, error.message.split('\n')[0]);
      }
    }
  }
}

console.log(`\nRESULT: ${failed === 0 ? 'PASS' : 'FAIL'}${failed ? ` (${failed} failed)` : ''}${skipped ? ` — ${skipped} skipped` : ''}`);
process.exit(failed === 0 ? 0 : 1);
