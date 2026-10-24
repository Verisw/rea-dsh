#!/usr/bin/env node
/**
 * One command, no questions asked.
 *
 *   npm run setup                  # 检查环境 -> 装进所有 profile -> 校验 -> 告诉你重启什么
 *   npm run setup -- --check       # 只看状态，不动任何文件
 *   npm run setup -- --write-env   # 顺便把分析引擎路径写进 shell 配置（带标记块，幂等）
 *   npm run setup -- --warm        # 预热：下 REA 包 + 生成工具清单缓存（之后宿主启动零引擎）
 *   npm run setup -- --uninstall   # 从所有 profile 卸掉
 *   npm run setup -- --dry-run     # 只说要做会什么
 *
 * 它自己不改 profile 的账本：安装/卸载一律交给 scripts/install.mjs（同一套幂等逻辑），
 * 校验交给 scripts/verify.mjs 与 scripts/check-profiles.mjs。这个脚本只负责
 * 「按顺序跑完，并用人话告诉你下一步动哪个界面」。
 *
 * 两种安装来源，自动判断：
 *   - 在 git checkout 里跑（有 .git）-> 软链进 profile，改代码即时生效
 *   - 从 npm 包或 npx 里跑       -> 调 dsh plugin --profile <p> add <包名@版本>
 */

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const argv = process.argv.slice(2);
const has = (flag) => argv.includes(flag);
const valueOf = (flag, fallback) => {
  const index = argv.indexOf(flag);
  if (index === -1) return fallback;
  const next = argv[index + 1];
  return next && !next.startsWith('-') ? next : fallback;
};

const repoRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
const dshHome = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
const profilesRoot = path.join(dshHome, 'profiles');

const dryRun = has('--dry-run');
const checkOnly = has('--check');
const uninstall = has('--uninstall');
const writeEnv = has('--write-env');
const warm = has('--warm');

const line = (text) => process.stdout.write(text + '\n');
const head = (text) => line('\n== ' + text + ' ' + '='.repeat(Math.max(0, 64 - text.length)));
const ok = (text) => line('  ok   ' + text);
const warn = (text) => line('  warn ' + text);
const info = (text) => line('  ..   ' + text);
const fail = (text) => line('  FAIL ' + text);

let problems = 0;

function run(command, args, options = {}) {
  if (dryRun) {
    info('would run: ' + command + ' ' + args.join(' '));
    return { status: 0, skipped: true };
  }
  const result = spawnSync(command, args, { stdio: 'inherit', cwd: repoRoot, ...options });
  return { status: result.status ?? 1 };
}

function capture(command, args, options = {}) {
  return spawnSync(command, args, { encoding: 'utf8', cwd: repoRoot, ...options });
}

function dirs() {
  if (!fs.existsSync(profilesRoot)) return [];
  return fs
    .readdirSync(profilesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((dir) => fs.existsSync(path.join(profilesRoot, dir, 'package.json')))
    .sort();
}

function installedIn(dir) {
  try {
    const profilePkg = JSON.parse(fs.readFileSync(path.join(profilesRoot, dir, 'package.json'), 'utf8'));
    return (profilePkg.dsh?.profile?.bundles ?? []).includes(pkg.name);
  } catch {
    return false;
  }
}

const surface = {
  desktop: '桌面 App：完全退出再打开（Cmd+Q，不是关窗口）',
  web: 'dsh web：重启那个命令 / 那个进程',
  headless: 'headless：下次 dsh -p 自动带上，无需操作',
  'dsh-tui': 'dsh-tui：退出重开',
};

// ── 0. 运行环境 ─────────────────────────────────────────────────────────────
head('运行环境');

const nodeMajor = Number(process.versions.node.split('.')[0]);
if (nodeMajor >= 20) ok('node ' + process.versions.node);
else {
  fail('node ' + process.versions.node + '，需要 >= 20.16');
  problems += 1;
}

/** 装在这里的那个 dsh 包（"dsh --version" 不打印版本，只能读 package.json） */
function hostPackage() {
  const candidates = [];
  try {
    const which = capture('which', ['dsh']).stdout.trim();
    if (which) {
      let dir = path.dirname(fs.realpathSync(which));
      for (let depth = 0; depth < 6; depth += 1) {
        if (fs.existsSync(path.join(dir, 'package.json'))) { candidates.push(path.join(dir, 'package.json')); break; }
        dir = path.dirname(dir);
      }
    }
  } catch {}
  candidates.push(
    process.env.DSH_INSTALL_DIR && path.join(process.env.DSH_INSTALL_DIR, 'package.json'),
    '/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/package.json',
    '/usr/local/lib/node_modules/@deepseek-ai/dsh/package.json',
    '/usr/lib/node_modules/@deepseek-ai/dsh/package.json',
  );
  for (const candidate of candidates.filter(Boolean)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(candidate, 'utf8'));
      if (parsed.name === '@deepseek-ai/dsh') return { file: candidate, version: parsed.version };
    } catch {}
  }
  return null;
}

const isCheckout = fs.existsSync(path.join(repoRoot, '.git'));
const host = hostPackage();

// `dsh` 的入口是 `if (import.meta.main) await runCli()`（lib/bin.js 末尾）。Node 23.x 与
// 24.2 之前的版本没有这个属性，CLI 什么都不做却返回 0 —— 看着装成功，实际没装。它跑在
// PATH 上的 node 里（shebang `#!/usr/bin/env node`），跟我们这一层 node 未必是同一个，
// 所以判据只能用行为：`dsh --version` 到底有没有吐出东西。
const nodeOnPath = capture('node', ['--version']).stdout.trim();
const hasDshCli = capture('dsh', ['--version']).stdout.trim().length > 0;
if (host) ok('dsh ' + host.version + '  (' + host.file + ')');
else warn('PATH 上没有 dsh 命令（软链方式仍然可用；dsh plugin 方式不可用）');
if (host && !hasDshCli) {
  warn('`dsh --version` 什么都不打印：它跑在缺 import.meta.main 的 Node 上（PATH 上是 ' + (nodeOnPath || '未知') + '）');
  line('       dsh plugin 会静默退出、exit 0 却什么都没装。换 Node >= 22.18 / >= 24，或改用 checkout 软链方式。');
}

if (isCheckout) ok('来源：git checkout ' + repoRoot + ' -> 软链安装，改代码即时生效');
else ok('来源：安装包 ' + repoRoot + ' -> 用 dsh plugin 安装 ' + pkg.name + '@' + pkg.version);

// ── 1. profile 现状 ────────────────────────────────────────────────────────
head('profile');

const found = dirs();
if (found.length === 0) {
  fail('在 ' + profilesRoot + ' 下没找到任何 profile');
  line('       先用你想用的界面跑一次（桌面 App / dsh web / dsh -p / dsh-tui），再回来跑这个脚本。');
  process.exit(1);
}

for (const dir of found) ok(dir.padEnd(9) + (installedIn(dir) ? '已装' : '未装'));

// ── 2. 安装 / 卸载 ─────────────────────────────────────────────────────────
if (checkOnly) {
  head('跳过安装（--check）');
} else if (uninstall) {
  head('卸载');
  const args = isCheckout ? ['scripts/install.mjs', '--all', '--uninstall'] : null;
  if (args) {
    if (run(process.execPath, args).status !== 0) { fail('install.mjs --uninstall 失败'); problems += 1; }
  } else if (!dryRun) {
    for (const dir of found) {
      if (!installedIn(dir)) continue;
      const result = run('dsh', ['plugin', '--profile', dir, 'remove', pkg.name]);
      if (result.status !== 0) { fail('dsh plugin --profile ' + dir + ' remove 失败'); problems += 1; }
    }
  }
} else {
  head('安装');
  if (isCheckout) {
    if (run(process.execPath, ['scripts/install.mjs', '--all']).status !== 0) {
      fail('install.mjs --all 失败');
      problems += 1;
    }
  } else if (!hasDshCli) {
    fail('不在 checkout 里，又没法用 dsh CLI：装不了。');
    line(host
      ? '       原因：`dsh --version` 没有输出，CLI 在 PATH 上的 ' + (nodeOnPath || '未知') + ' 里空转。换 Node >= 22.18 / >= 24 再跑。'
      : '       原因：PATH 上没有 dsh。手动装：dsh plugin --profile <name> add ' + pkg.name + '。');
    problems += 1;
  } else if (!dryRun) {
    for (const dir of found) {
      if (installedIn(dir)) { ok(dir + ' 已装，跳过'); continue; }
      const result = run('dsh', ['plugin', '--profile', dir, 'add', pkg.name + '@' + pkg.version]);
      if (result.status !== 0) { fail('dsh plugin --profile ' + dir + ' add 失败'); problems += 1; continue; }
      // 返回 0 不等于装上了：CLI 空转、或这个包名在 registry 上还不存在，都是 0。
      if (!installedIn(dir)) {
        fail('dsh plugin --profile ' + dir + ' add 返回 0，但 profile 里没有 ' + pkg.name);
        line('       多半是包名还没发布（' + pkg.name + '@' + pkg.version + ' 取不到），或那层 node 缺 import.meta.main。');
        problems += 1;
        continue;
      }
      ok(dir + ' 装上');
    }
  }
}

// ── 3. 分析引擎 ────────────────────────────────────────────────────────────
head('分析引擎（不配也能用，只是少了对应工具）');

const env = {};
const exists = (file) => Boolean(file) && fs.existsSync(file);

const hopper = process.env.HOPPER_LAUNCHER_PATH
  || (process.platform === 'darwin'
    ? path.join(os.homedir(), 'Applications/Hopper Disassembler.app/Contents/MacOS/hopper')
    : '');
if (exists(hopper)) ok('Hopper  ' + hopper);
else warn('Hopper  没找到（macOS 默认位置 ~/Applications/Hopper Disassembler.app），只影响 Hopper 那批工具');
if (!process.env.HOPPER_LAUNCHER_PATH && exists(hopper)) env.HOPPER_LAUNCHER_PATH = hopper;

const ghidraCandidates = [
  process.env.GHIDRA_INSTALL_DIR,
  ...(fs.existsSync(path.join(os.homedir(), 'Tools'))
    ? fs.readdirSync(path.join(os.homedir(), 'Tools')).filter((name) => /^ghidra_/i.test(name)).sort().reverse()
        .map((name) => path.join(os.homedir(), 'Tools', name))
    : []),
  '/opt/ghidra',
  '/Applications/ghidra',
].filter(Boolean);
const ghidra = ghidraCandidates.find((candidate) => exists(candidate) && fs.existsSync(path.join(candidate, 'support')));
if (ghidra) {
  ok('Ghidra  ' + ghidra);
  if (!process.env.GHIDRA_INSTALL_DIR) env.GHIDRA_INSTALL_DIR = ghidra;
  if (!/12\.1\.4/.test(path.basename(ghidra))) warn('         REA 认的是 12.1.4，这个是 ' + path.basename(ghidra));
} else warn('Ghidra  没找到（GHIDRA_INSTALL_DIR 未设置），Ghidra 那批工具不会出现');

/** JVM 大版本号；拿不到就是 0 */
function javaMajor(launcher) {
  const result = capture(launcher, ['-version']);
  const text = (result.stderr || '') + (result.stdout || '');
  const match = /version "(\d+)/.exec(text);
  return match ? Number(match[1]) : 0;
}

const javaCandidates = [
  process.env.JAVA_HOME,
  '/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home',
  '/opt/homebrew/opt/openjdk/libexec/openjdk.jdk/Contents/Home',
  ...(fs.existsSync('/Library/Java/JavaVirtualMachines')
    ? fs.readdirSync('/Library/Java/JavaVirtualMachines').sort().reverse()
        .map((name) => path.join('/Library/Java/JavaVirtualMachines', name, 'Contents/Home'))
    : []),
].filter((candidate) => exists(candidate));

const usableHome = javaCandidates.find((home) => javaMajor(path.join(home, 'bin/java')) >= 21);
const pathJava = javaMajor('java');

if (usableHome) {
  const major = javaMajor(path.join(usableHome, 'bin/java'));
  ok('JAVA_HOME ' + usableHome + '  (Java ' + major + ')');
  if (process.env.JAVA_HOME !== usableHome) env.JAVA_HOME = usableHome;
} else if (pathJava >= 21) {
  ok('PATH 上的 java ' + pathJava + '（Ghidra 够用，JAVA_HOME 可以不设）');
} else if (pathJava > 0) {
  warn('PATH 上的 java 是 ' + pathJava + '，Ghidra 要 21+（brew install openjdk@21 后重跑本脚本）');
} else {
  warn('没找到 java，Ghidra 起不来（brew install openjdk@21）');
}

if (process.env.REA_IDA_MCP_CONFIG) ok('IDA     ' + process.env.REA_IDA_MCP_CONFIG);
else warn('IDA     未配 REA_IDA_MCP_CONFIG，只影响 IDA 那批工具');

if (Object.keys(env).length > 0) {
  const snippet = Object.entries(env).map(([key, value]) => 'export ' + key + '="' + value + '"').join('\n');
  line('');
  line('  建议加进 shell 配置（脚本探测到的路径）：');
  for (const raw of snippet.split('\n')) line('    ' + raw);

  if (writeEnv) {
    const shellFile = process.env.SHELL && process.env.SHELL.includes('zsh')
      ? path.join(os.homedir(), '.zshrc')
      : path.join(os.homedir(), '.bashrc');
    const begin = '# >>> dsh-rea-reverse-preset >>>';
    const end = '# <<< dsh-rea-reverse-preset <<<';
    const block = begin + '\n' + snippet + '\n' + end;
    const current = fs.existsSync(shellFile) ? fs.readFileSync(shellFile, 'utf8') : '';
    const pattern = new RegExp(begin + '[\\s\\S]*?' + end);
    const next = pattern.test(current) ? current.replace(pattern, block) : current + (current.endsWith('\n') || current === '' ? '' : '\n') + '\n' + block + '\n';
    if (dryRun) info('would update ' + shellFile);
    else if (next !== current) {
      fs.writeFileSync(shellFile, next);
      ok('已写入 ' + shellFile + '（标记块，可重复执行）');
    } else ok(shellFile + ' 已是最新');
  } else {
    info('想自动写入：npm run setup -- --write-env');
  }
}

// ── 4. 预热 REA ────────────────────────────────────────────────────────────

// Walks the supervisor through one handshake. Two things fall out of it: the
// npx cache gets the REA tarball, and the supervisor writes the manifest that
// lets a later host boot register all 139 tools without starting REA at all.
function warmManifest(spec) {
  const proxy = path.join(repoRoot, 'scripts', 'rea-lazy.mjs');
  const child = spawn(process.execPath, [proxy], {
    env: { ...process.env, REA_MCP_SPEC: spec, REA_LAZY_IDLE_MS: '0' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  return new Promise((resolve) => {
    let buffer = '';
    let settled = false;
    const pending = new Map();
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { child.kill('SIGTERM'); } catch { /* already gone */ }
      resolve(result);
    };
    const timer = setTimeout(() => finish({ error: '超时 180 s' }), 180000);
    child.on('error', (error) => finish({ error: String(error.message || error) }));
    child.stderr.on('data', (chunk) => {
      const text = String(chunk).trim();
      if (text) text.split('\n').forEach((l) => info(l.replace(/^\[rea-lazy\] /, '')));
    });
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      let index;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);
        if (!line) continue;
        let message;
        try { message = JSON.parse(line); } catch { continue; }
        const waiter = pending.get(message.id);
        if (waiter) { pending.delete(message.id); waiter(message); }
      }
    });
    const call = (message) => new Promise((res) => { pending.set(message.id, res); child.stdin.write(JSON.stringify(message) + '\n'); });
    (async () => {
      try {
        await call({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'setup', version: '0' } } });
        child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
        const list = await call({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
        finish({ count: list.result?.tools?.length ?? 0 });
      } catch (error) {
        finish({ error: String(error.message || error) });
      }
    })();
  });
}

if (warm) {
  head('预热 REA（首次要下包，可能一两分钟）');
  const spec = process.env.REA_MCP_SPEC || 'rea-agents@6.3.0';
  const started = Date.now();
  const warmed = dryRun ? { skipped: true } : await warmManifest(spec);
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  if (warmed.skipped) info('would warm ' + spec);
  else if (warmed.error) warn('预热没成功（' + seconds + ' s）：' + warmed.error + ' ——检查网络或代理；模式仍然可选，只是没有 REA 工具');
  else ok('拿到 ' + warmed.count + ' 个工具，清单已缓存（' + seconds + ' s）——之后宿主启动不再拉起 REA，第一次真正用到工具才起');
}

// ── 5. 校验 ────────────────────────────────────────────────────────────────
head('校验');
if (!checkOnly && !uninstall) {
  if (run(process.execPath, ['scripts/verify.mjs']).status !== 0) { fail('verify 没过'); problems += 1; }
}
if (!uninstall) {
  if (run(process.execPath, ['scripts/check-profiles.mjs']).status !== 0) {
    fail('profile 装载校验没过（看上面哪一行 FAIL）');
    problems += 1;
  }
}

// ── 6. 下一步 ──────────────────────────────────────────────────────────────
head('接下来');

if (uninstall) {
  line('  已卸载。重启你用过的界面即可（桌面 App 要完全退出再打开）。');
} else {
  const targets = found.filter((dir) => installedIn(dir) || dryRun);
  if (targets.length === 0) line('  没有装上的 profile，检查上面的报错。');
  for (const dir of targets) line('  - ' + (surface[dir] ?? dir + '：重启该界面'));
  line('');
  line('  重启后：/preset -> 逆向工程模式（或 /preset reverse），然后 /mcp 看一眼 REA 是否起来。');
  line('  已有对话历史的会话不能切 preset，新开一个会话。');
}

line('');
line(problems === 0 ? '完成，没有需要你处理的问题。' : '完成，但有 ' + problems + ' 个问题（见上面的 FAIL）。');
process.exit(problems === 0 ? 0 : 1);
