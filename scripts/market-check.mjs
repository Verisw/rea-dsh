#!/usr/bin/env node
/**
 * market-check.mjs —— 判断这个包在 DSH 插件市场（dsh-plugin-hub）里能不能被看到。
 *
 * 市场的「公开列表」不是一个人工后台，而是三个数据源拼出来的：
 *   1. mirror —— GitHub 搜索 \`topic:dsh-plugin\`（+ 一句 in:name,description），
 *      只取前 3 页 × 100 = 300 条，按 best match 排序；
 *   2. catalog —— 社区总目录 leenkcool/Blue-Whale-Harness 的 repos.txt；
 *   3. seed —— hub 包内自带的离线预置目录。
 * 所以「发布到市场」= 让上面任何一条能命中本仓库，而不是点一个提交按钮。
 *
 * 本脚本只读：本地元数据 + GitHub API + npm registry，输出一份上线前体检。
 * 退出码：0 = 可以上线，1 = 有阻塞项。
 */
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
const REPO = 'Verisw/rea-dsh';
const TOPIC = 'dsh-plugin';
const CATALOG_URL = 'https://raw.githubusercontent.com/leenkcool/Blue-Whale-Harness/main/repos.txt';

let fails = 0;
let warns = 0;
const pass = (title, detail) => { console.log('PASS  ' + title + (detail ? ' — ' + detail : '')); };
const warn = (title, detail) => { warns += 1; console.log('WARN  ' + title + (detail ? ' — ' + detail : '')); };
const fail = (title, detail) => { fails += 1; console.log('FAIL  ' + title + (detail ? ' — ' + detail : '')); };
const info = (title, detail) => { console.log('  ..  ' + title + (detail ? ' — ' + detail : '')); };

/* ---------- 与 dsh-plugin-hub 0.2.4 对齐的展示逻辑（lib/host/github.js） ---------- */

const CATEGORY_GROUPS = {
  agent: ['agent', 'ai-agent', 'agent-skill', 'persona'],
  tool: ['tool', 'command', 'tools', 'cli', 'utility'],
  ui: ['ui', 'web', 'interface', 'frontend', 'client', 'theme', 'visual', 'sidebar', 'panel'],
  data: ['data', 'database', 'sql', 'excel', 'csv', 'pandas', 'dataset', 'analysis', 'export', 'spreadsheet'],
  vision: ['vision', 'image', 'screenshot', 'ocr', 'multimodal', 'media', 'video', 'camera', 'image-gen'],
  docs: ['document', 'doc', 'office', 'word', 'pptx', 'pdf', 'markdown', 'report', 'note', 'typeset', 'docx'],
  memory: ['memory', 'remember', 'recall', 'knowledge', 'knowledge-base', 'vector', 'rag', 'embedding', 'memorize'],
  usage: ['usage', 'token', 'cost', 'pricing', 'analytics', 'quota', 'billing', 'statistics', 'metering'],
  notify: ['notify', 'notification', 'alert', 'message', 'telegram', 'wechat', 'slack', 'dingtalk', 'webhook', 'toast', 'mail'],
  dev: ['dev', 'coding', 'code', 'debug', 'debugger', 'terminal', 'git', 'build', 'lint', 'test', 'compiler', 'ide'],
  chat: ['chat', 'conversation', 'session', 'prompt', 'dialogue', 'history', 'summary'],
  hub: ['hub', 'registry', 'marketplace', 'store', 'catalog', 'index', 'collection', 'aggregator', 'repo'],
};
const CATEGORY_ORDER = ['tool', 'agent', 'ui', 'data', 'vision', 'docs', 'memory', 'usage', 'notify', 'dev', 'chat', 'hub', 'other'];
const CATEGORY_LABELS = {
  tool: '工具', agent: 'Agent', ui: '界面美化', data: '数据处理', vision: '视觉', docs: '文档',
  memory: '记忆', usage: '用量', notify: '通知', dev: '开发', chat: '对话', hub: '商店', other: '其他',
};

function deriveCategories(p, topics) {
  const found = new Set();
  const words = [...(Array.isArray(p.keywords) ? p.keywords.map(String) : []), ...topics].map((w) => w.toLowerCase());
  const joined = words.join(' ');
  for (const [cat, keys] of Object.entries(CATEGORY_GROUPS)) {
    for (const key of keys) {
      if (words.includes(key) || joined.includes(key)) { found.add(cat); break; }
    }
  }
  if (found.size === 0) found.add('other');
  return CATEGORY_ORDER.filter((c) => found.has(c));
}

const IMG_RE = /!\[[^\]]*\]\(<?([^)>]+)>?\)|<img[^>]+src=["']([^"']+)["']/g;

function extractScreenshots(readme) {
  if (!readme) return [];
  const urls = new Set();
  for (const m of readme.matchAll(IMG_RE)) {
    const raw = m[1] || m[2];
    if (!raw) continue;
    urls.add(raw);
    if (urls.size >= 8) break;
  }
  return [...urls];
}

function shortDescription(text) {
  const cleaned = String(text || '').replace(/[#*`_]/g, '').replace(/\s+/g, ' ').trim();
  return cleaned.length > 120 ? cleaned.slice(0, 117) + '…' : cleaned;
}

/* ---------- 环境探测 ---------- */

function tryRun(cmd, args) {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch {
    return null;
  }
}

function findHub() {
  const home = process.env.HOME || '';
  for (const name of ['desktop', 'web', 'headless', 'dsh-tui']) {
    const anchor = join(home, '.dsh/profiles', name, 'node_modules/dsh-plugin-hub/package.json');
    if (existsSync(anchor)) return { profile: name, anchor, lib: join(dirname(anchor), 'lib') };
  }
  return null;
}

/* ---------- 各节检查 ---------- */

function checkPackaging() {
  console.log('== 1. 包形状 ===');
  const patch = pkg.dsh && pkg.dsh.bundle && pkg.dsh.bundle.patch;
  if (typeof patch === 'string') pass('声明了 dsh.bundle.patch', patch);
  else fail('package.json 里没有 dsh.bundle.patch', '市场只认这个字段判断「是不是插件」');
  if (existsSync(join(repoRoot, 'cordis.patch.yml'))) pass('cordis.patch.yml 在包根');
  else fail('缺少 cordis.patch.yml');
  if (pkg.license) pass('许可证', pkg.license);
  else warn('没有 license 字段', '市场会显示「无许可」');
}

function checkStoreMetadata() {
  console.log('== 2. 商店里长什么样 ===');
  const topics = (tryRun('gh', ['api', 'repos/' + REPO + '/topics', '--jq', '.names.join(",")']) || '').split(',').filter(Boolean);
  const cats = deriveCategories(pkg, topics);
  if (pkg.displayName) pass('标题走 displayName', String(pkg.displayName));
  else warn('没有 displayName', '商店会退化成包名 ' + pkg.name);
  pass('分类', cats.map((c) => CATEGORY_LABELS[c] + '(' + c + ')').join(' '));
  const desc = shortDescription(pkg.description);
  pass('列表摘要', desc);
  const readme = existsSync(join(repoRoot, 'README.md')) ? readFileSync(join(repoRoot, 'README.md'), 'utf8') : '';
  const shots = extractScreenshots(readme);
  if (shots.length === 0) info('README 截图', '0 张（详情页截图页为空，可接受）');
  else pass('README 截图', shots.length + ' 张 → ' + shots.map((s) => s.split('/').slice(-1)[0]).join(', '));
  if (readme) pass('README.md 存在', readme.split('\n').length + ' 行');
  else warn('没有 README.md', '详情页会没有介绍');
}

async function checkSecurity() {
  console.log('== 3. 市场安全扫描 ===');
  const hub = findHub();
  if (!hub) { info('未找到 dsh-plugin-hub', '跳过（改用 verify 的静态检查）'); return; }
  try {
    const mod = await import(join(hub.lib, 'host/security-scan.js'));
    const res = mod.scanPlugin(repoRoot, pkg);
    const rules = {};
    for (const f of res.findings || []) rules[f.rule] = (rules[f.rule] || 0) + 1;
    const summary = Object.entries(rules).map(([k, v]) => k + 'x' + v).join(' ');
    if (res.level === 'clean') pass('扫描级别 clean');
    else if (res.level === 'warning') warn('扫描级别 warning', summary + '（不会拦截发布，详情页会显示风险提示）');
    else fail('扫描级别 ' + res.level, summary + '（publish 会直接拒绝）');
    info('扫描器', 'dsh-plugin-hub@' + hub.profile);
  } catch (e) {
    info('扫描器不可用', e instanceof Error ? e.message : String(e));
  }
}

async function checkGithub() {
  console.log('== 4. GitHub 侧 ===');
  const json = tryRun('gh', ['repo', 'view', REPO, '--json', 'visibility,description,repositoryTopics,latestRelease']);
  if (!json) { fail('读不到仓库信息', 'gh 未登录或仓库不存在'); return; }
  const repo = JSON.parse(json);
  const topics = (repo.repositoryTopics || []).map((t) => t.name);
  if (repo.visibility === 'PUBLIC') pass('仓库公开');
  else fail('仓库不是公开的', repo.visibility);
  if (topics.includes(TOPIC)) pass('带发现用的 topic', TOPIC);
  else fail('缺少 topic ' + TOPIC, '市场靠 topic:dsh-plugin 发现仓库');
  if (topics.includes('dsh-plugin')) pass('topic 数量', topics.length + ' 个');
  const rel = repo.latestRelease;
  if (rel && String(rel.tagName || '').replace(/^v/, '') === String(pkg.version)) pass('release 与版本对齐', rel.tagName);
  else if (rel) warn('release 版本与 package.json 不一致', (rel.tagName || '') + ' vs ' + pkg.version);
  else warn('还没有 release', '市场详情页的版本/更新日志会为空');
  if (repo.description) pass('仓库简介', shortDescription(repo.description));
  else warn('仓库没有 description');
}

async function checkDiscovery() {
  console.log('== 5. 市场发现（mirror） ===');
  const token = tryRun('gh', ['auth', 'token']);
  const hub = findHub();
  let hits = null;
  if (hub && token) {
    try {
      const gh = await import(join(hub.lib, 'host/github.js'));
      const client = new gh.GitHubClient(token);
      const res = await client.searchRepos('topic:' + TOPIC, 3, 100);
      hits = (Array.isArray(res) ? res : [...res.values()]).map((h) => h.fullName);
      info('搜索用真 hub 代码', 'dsh-plugin-hub GitHubClient，前 3 页 x 100');
    } catch (e) {
      info('hub 搜索失败', e instanceof Error ? e.message : String(e));
    }
  }
  if (!hits) {
    hits = [];
    for (let page = 1; page <= 3; page += 1) {
      const out = tryRun('gh', ['api', 'search/repositories?q=topic%3A' + TOPIC + '&per_page=100&page=' + page, '--jq', '.items[].full_name']);
      if (!out) break;
      hits.push(...out.split('\n').filter(Boolean));
    }
  }
  if (hits.length === 0) { warn('拿不到搜索结果', '可能被限流'); return; }
  const rank = hits.findIndex((h) => h.toLowerCase() === REPO.toLowerCase());
  if (rank >= 0) pass('已进入市场镜像列表', '第 ' + (rank + 1) + ' / ' + hits.length + ' 位');
  else {
    warn('不在镜像前 ' + hits.length + ' 条里', 'topic:dsh-plugin 命中上万个仓库，0 star 新仓库排不进去');
    info('补救', '走社区总目录（见第 6 节）+ 攒 star，或让用户用 dsh plugin add 直接装');
  }
}

async function checkCatalog() {
  console.log('== 6. 社区总目录（catalog） ===');
  let text = null;
  try {
    const res = await fetch(CATALOG_URL, { signal: AbortSignal.timeout(15000) });
    if (res.ok) text = await res.text();
  } catch { /* ignore */ }
  if (!text) { info('目录不可达', CATALOG_URL); return; }
  const lines = text.split(/\r?\n/).map((l) => l.trim().toLowerCase());
  if (lines.includes(REPO.toLowerCase())) pass('已在 Blue-Whale 总目录', lines.length + ' 条里找到本仓库');
  else warn('不在 Blue-Whale 总目录', '提交 issue 模板 catalog-intake 或 PR 改 repos.txt 即可被收录');
  info('目录规模', lines.filter(Boolean).length + ' 个仓库');
}

async function checkNpm() {
  console.log('== 7. npm ===');
  let meta = null;
  try {
    const res = await fetch('https://registry.npmjs.org/' + encodeURIComponent(pkg.name), { signal: AbortSignal.timeout(10000) });
    if (res.ok) meta = await res.json();
  } catch { /* ignore */ }
  if (meta) pass('npm 上已有该包', (meta['dist-tags'] && meta['dist-tags'].latest) || '?');
  else warn('npm 上没有 ' + pkg.name, '市场只能从 GitHub 克隆安装；发布后 hasNpm=true，装得更快');
}

async function main() {
  console.log('market-check: ' + pkg.name + '@' + pkg.version + '  (' + REPO + ')');
  console.log('');
  checkPackaging();
  checkStoreMetadata();
  await checkSecurity();
  await checkGithub();
  await checkDiscovery();
  await checkCatalog();
  await checkNpm();
  console.log('');
  if (fails > 0) {
    console.log('RESULT: FAIL (' + fails + ' 个阻塞项, ' + warns + ' 个提醒)');
  } else {
    console.log('RESULT: PASS (可以上线, ' + warns + ' 个提醒)');
  }
  process.exit(fails > 0 ? 1 : 0);
}

await main();
