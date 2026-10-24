#!/usr/bin/env node
// 发布前的自检：tag 与 version 对齐、CHANGELOG 有对应条目、包名版本还没被占。
//
// 为什么需要它：npm 的不可变发布意味着「版本号错了只能发下一个版本」。
// 把 tag 与 version 的对齐放在 CI 里做，比发错之后再 deprecate 便宜得多。

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const changelog = readFileSync(join(root, 'CHANGELOG.md'), 'utf8');
const verifyRegistry = process.argv.includes('--verify-registry');

let failed = 0;
const ok = (m) => console.log('PASS  ' + m);
const fail = (m, hint) => {
  failed += 1;
  console.log('FAIL  ' + m);
  if (hint) console.log('      ' + hint);
};

const tag = process.env.GITHUB_REF_NAME || '';
if (tag.startsWith('v')) {
  if (tag === 'v' + pkg.version) ok('tag ' + tag + ' matches version ' + pkg.version);
  else fail('tag ' + tag + ' does not match version ' + pkg.version, 'tag 与 package.json version 必须一致，否则发出去的号会错');
} else {
  ok('not a tag run (ref ' + (tag || 'none') + ') — version check skipped');
}

if (pkg.version.includes('-')) {
  if (changelog.includes(pkg.version)) ok('CHANGELOG mentions the prerelease ' + pkg.version);
  else fail('CHANGELOG has no entry for ' + pkg.version);
} else if (new RegExp('^##\\s*\\[?' + pkg.version.replace(/\./g, '\\.') + '\\b', 'm').test(changelog)) {
  ok('CHANGELOG has a section for ' + pkg.version);
} else {
  fail('CHANGELOG has no "## ' + pkg.version + '" section', '发布说明写在 CHANGELOG.md，release notes 直接引用它');
}

if (!pkg.private && pkg.name) ok('package is publishable (' + pkg.name + '@' + pkg.version + ')');
else fail('package is private or has no name');

const npm = (args) => {
  try {
    return execFileSync('npm', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (err) {
    return { error: String(err.stderr || err.message).trim() };
  }
};

if (verifyRegistry) {
  const out = npm(['view', pkg.name + '@' + pkg.version, 'version', '--json']);
  if (typeof out === 'string' && out.replace(/"/g, '') === pkg.version) {
    ok('registry serves ' + pkg.name + '@' + pkg.version);
  } else {
    fail('registry does not serve ' + pkg.name + '@' + pkg.version, typeof out === 'string' ? out : out.error);
  }
} else {
  const out = npm(['view', pkg.name, 'version', '--json']);
  if (typeof out === 'string' && out.replace(/"/g, '') === pkg.version) {
    console.log('WARN  ' + pkg.name + '@' + pkg.version + ' already exists on the registry');
  } else if (typeof out === 'string') {
    ok('name is taken, next free version is above ' + out.replace(/"/g, '') + ' — this publish is a new version');
  } else {
    ok('name is free on the registry — first publish');
  }
}

console.log('');
if (failed > 0) {
  console.log('RESULT: FAIL (' + failed + ' failed)');
  process.exit(1);
}
console.log('RESULT: PASS');
