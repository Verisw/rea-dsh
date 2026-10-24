#!/usr/bin/env node
/**
 * Lazy, idle-stopping supervisor for the REA MCP server.
 *
 * dsh's mcp-client connects a stdio MCP server eagerly and holds it for the
 * whole life of the plugin. REA is heavy — an `npx` + `node` pair whose
 * tools/list payload is ~1.9 MB — so keeping it alive from host boot, whether
 * or not a reverse-engineering session exists, is pure waste.
 *
 * This proxy speaks MCP on stdin/stdout and sits between the host and REA:
 *
 *   cold      answers initialize / tools/list / prompts/list from a cached
 *             manifest, so the host registers the full tool set with REA not
 *             running at all;
 *   first use on the first real request (tools/call and friends) it spawns
 *             REA, replays the handshake, flushes queued requests, and
 *             refreshes the manifest;
 *   idle      after REA_LAZY_IDLE_MS without traffic it stops REA and goes
 *             back to cold; the next call warms it again.
 *
 * Environment:
 *   REA_LAZY_MODE      lazy (default) | eager (spawn at startup, old behaviour)
 *   REA_LAZY_IDLE_MS   idle window before stopping REA; 0 disables stopping
 *   REA_LAZY_CACHE     manifest path; default <dsh home>/cache/dsh-rea-reverse-preset/
 *   REA_MCP_SPEC       REA package spec; default rea-agents@6.3.0
 *
 * Wire protocol: newline-delimited JSON-RPC 2.0 (MCP stdio transport).
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import process from 'node:process';

const SPEC = process.env.REA_MCP_SPEC || 'rea-agents@6.3.0';
const EAGER = process.env.REA_LAZY_MODE === 'eager';
const IDLE_MS = parseIdle(process.env.REA_LAZY_IDLE_MS);
const CACHE = process.env.REA_LAZY_CACHE || defaultCachePath();
const STARTUP_TIMEOUT_MS = 120000;
const SUPPORTED_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05', '2024-10-07'];
const LIST_METHODS = new Set(['tools/list', 'prompts/list', 'resources/list', 'resources/templates/list']);

function parseIdle(raw) {
  if (raw === undefined || raw === '') return 10 * 60 * 1000;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : 10 * 60 * 1000;
}

function defaultCachePath() {
  const home = process.env.DSH_HOME
    || (process.env.HOME ? path.join(process.env.HOME, '.dsh') : path.join(os.tmpdir(), '.dsh'));
  return path.join(home, 'cache', 'dsh-rea-reverse-preset', 'manifest-' + slug(SPEC) + '.json');
}

function slug(value) {
  return value.replace(/[^A-Za-z0-9._-]+/g, '_');
}

function log(message) {
  try {
    process.stderr.write('[rea-lazy] ' + message + '\n');
  } catch {
    /* stderr gone: the host closed us */
  }
}

/** Cached manifest: lets the host list tools while REA is not running. */
let manifest = readManifest();
let child;
let generation = 0;
let starting;
let idleTimer;
/** childId -> clientId for forwarded client requests. */
const forwarded = new Map();
/** childId -> { resolve, reject, timer } for our own requests. */
const waiting = new Map();
let nextChildId = 1;
/** Client messages waiting for a child that is still starting. */
let queue = [];
let lastInitializeParams;

function readManifest() {
  try {
    const parsed = JSON.parse(fs.readFileSync(CACHE, 'utf8'));
    if (!parsed || !Array.isArray(parsed.tools)) return undefined;
    if (parsed.spec !== SPEC) {
      log('manifest in ' + CACHE + ' was built for ' + parsed.spec + '; rebuilding for ' + SPEC);
      return undefined;
    }
    return parsed;
  } catch {
    return undefined;
  }
}

function writeManifest(next) {
  manifest = { spec: SPEC, builtAt: new Date().toISOString(), ...next };
  try {
    fs.mkdirSync(path.dirname(CACHE), { recursive: true });
    const tmp = CACHE + '.' + process.pid + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(manifest));
    fs.renameSync(tmp, CACHE);
    log('manifest: ' + manifest.tools.length + ' tools -> ' + CACHE);
  } catch (error) {
    log('manifest write failed: ' + String((error && error.message) || error));
  }
}

function emit(message) {
  process.stdout.write(JSON.stringify(message) + '\n');
}

function replyError(id, message) {
  emit({ jsonrpc: '2.0', id, error: { code: -32000, message } });
}

//#region child lifecycle
function startChild() {
  if (child) return Promise.resolve();
  if (starting) return starting;
  const mine = ++generation;
  const startedAt = Date.now();
  log('starting REA (' + SPEC + ')');
  // `detached` puts REA in its own process group. Without it, `npx` is the only
  // process we hold a handle to, and a SIGTERM to the wrapper leaves the real
  // `rea mcp` child orphaned — a resident engine that outlives the host, which
  // is the exact behaviour this supervisor exists to prevent.
  const proc = spawn('npx', ['--prefer-offline', '-y', SPEC, 'mcp'], {
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  });
  child = proc;
  let buffer = '';
  proc.stdout.on('data', (chunk) => {
    buffer += chunk.toString();
    let index;
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      if (line.trim()) handleChildLine(line);
    }
  });
  proc.stderr.on('data', (chunk) => {
    const text = chunk.toString().trimEnd();
    if (text) process.stderr.write(text.split('\n').map((line) => '[rea] ' + line).join('\n') + '\n');
  });
  proc.on('error', (error) => {
    log('spawn failed: ' + String((error && error.message) || error));
  });
  proc.on('exit', (code, signal) => {
    const current = child === proc;
    if (current) child = undefined;
    if (mine === generation) {
      log('REA exited (code ' + code + ', signal ' + signal + ') after ' + Math.round((Date.now() - startedAt) / 1000) + 's');
      settleAll('REA stopped');
      drain(null, 'REA is not running');
    }
  });

  const version = pickVersion(lastInitializeParams && lastInitializeParams.protocolVersion);
  starting = (async () => {
    const initId = nextChildId++;
    const init = await ask(proc, initId, {
      jsonrpc: '2.0',
      id: initId,
      method: 'initialize',
      params: {
        protocolVersion: version,
        capabilities: {},
        clientInfo: { name: 'dsh-rea-lazy', version: '1.0.0' },
      },
    });
    send(proc, { jsonrpc: '2.0', method: 'notifications/initialized', params: {} });
    const tools = await listAll(proc, 'tools/list', 'tools');
    const prompts = await listAll(proc, 'prompts/list', 'prompts', true);
    const previous = manifest || {};
    writeManifest({
      protocolVersion: (init && init.result && init.result.protocolVersion) || version,
      capabilities: (init && init.result && init.result.capabilities) || previous.capabilities,
      serverInfo: (init && init.result && init.result.serverInfo) || previous.serverInfo,
      tools,
      prompts,
    });
    log('REA ready in ' + ((Date.now() - startedAt) / 1000).toFixed(1) + 's');
    starting = undefined;
    idleNow();
    drain(proc);
  })().catch((error) => {
    starting = undefined;
    log('startup failed: ' + String((error && error.message) || error));
    stopChild('startup failed');
    drain(null, 'REA failed to start');
  });
  return starting;
}

function handleChildLine(line) {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  if (message.id !== undefined && waiting.has(message.id)) {
    const waiter = waiting.get(message.id);
    waiting.delete(message.id);
    clearTimeout(waiter.timer);
    waiter.resolve(message);
    return;
  }
  if (message.id !== undefined && forwarded.has(message.id)) {
    const clientId = forwarded.get(message.id);
    forwarded.delete(message.id);
    if (message.method === 'tools/list' && message.result && Array.isArray(message.result.tools)) {
      writeManifest({ ...(manifest || {}), tools: message.result.tools, prompts: manifest && manifest.prompts });
    }
    emit({ ...message, id: clientId });
    touch();
    return;
  }
  if (message.id === undefined) {
    // Server notifications (tools/list_changed, progress, logging).
    emit(message);
    touch();
  }
}

function ask(proc, id, message) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      waiting.delete(id);
      reject(new Error(message.method + ' timed out'));
    }, STARTUP_TIMEOUT_MS);
    timer.unref();
    waiting.set(id, { resolve, reject, timer });
    send(proc, message);
  });
}

function listAll(proc, method, key, optional = false) {
  return (async () => {
    const collected = [];
    let cursor;
    for (;;) {
      const id = nextChildId++;
      const params = cursor ? { cursor } : {};
      let message;
      try {
        message = await ask(proc, id, { jsonrpc: '2.0', id, method, params });
      } catch (error) {
        if (optional) return collected;
        throw error;
      }
      if (message.error) {
        if (optional) return collected;
        throw new Error(method + ' failed: ' + JSON.stringify(message.error));
      }
      const result = message.result || {};
      if (Array.isArray(result[key])) collected.push(...result[key]);
      if (!result.nextCursor) return collected;
      cursor = result.nextCursor;
    }
  })();
}

function send(proc, message) {
  try {
    proc.stdin.write(JSON.stringify(message) + '\n');
  } catch (error) {
    log('write to REA failed: ' + String((error && error.message) || error));
  }
}

// Signals the whole process group when the child owns one (POSIX, spawned
// detached), so `npx` and the REA process it started go down together.
function signalTree(proc, signal) {
  if (!proc || !proc.pid) return;
  if (process.platform !== 'win32') {
    try {
      process.kill(-proc.pid, signal);
      return;
    } catch {
      /* not a group leader any more; fall through */
    }
  }
  try {
    proc.kill(signal);
  } catch {
    /* already gone */
  }
}

function stopChild(reason) {
  clearTimeout(idleTimer);
  const victim = child;
  child = undefined;
  generation += 1;
  settleAll(reason);
  if (!victim) return;
  try {
    victim.stdin.end();
  } catch {
    /* already gone */
  }
  signalTree(victim, 'SIGTERM');
  const force = setTimeout(() => {
    signalTree(victim, 'SIGKILL');
  }, 3000);
  force.unref();
}

function settleAll(reason) {
  for (const [id, waiter] of waiting) {
    clearTimeout(waiter.timer);
    waiter.reject(new Error(reason));
    waiting.delete(id);
  }
}

function drain(proc, reason) {
  const pending = queue;
  queue = [];
  if (!pending.length) return;
  if (!proc) {
    for (const message of pending) replyError(message.id, 'rea-lazy: ' + reason + '; retry the call to restart REA');
    return;
  }
  for (const message of pending) forward(proc, message);
}

function forward(proc, message) {
  const childId = nextChildId++;
  forwarded.set(childId, message.id);
  send(proc, { ...message, id: childId });
  touch();
}
//#endregion

//#region idle
function idleNow() {
  clearTimeout(idleTimer);
  if (IDLE_MS === 0 || !child || forwarded.size > 0) return;
  idleTimer = setTimeout(() => {
    if (!child || forwarded.size > 0) return;
    log('idle for ' + Math.round(IDLE_MS / 1000) + 's — stopping REA (next tool call restarts it)');
    stopChild('idle timeout');
  }, IDLE_MS);
  idleTimer.unref();
}

function touch() {
  if (child) idleNow();
}
//#endregion

//#region client side
function pickVersion(requested) {
  if (typeof requested === 'string' && SUPPORTED_VERSIONS.includes(requested)) return requested;
  return (manifest && manifest.protocolVersion) || SUPPORTED_VERSIONS[0];
}

/** Answer a list method from the cached manifest, or undefined when we cannot. */
function fromCache(method) {
  if (!manifest) return undefined;
  switch (method) {
    case 'tools/list':
      return { tools: manifest.tools };
    case 'prompts/list':
      return { prompts: manifest.prompts || [] };
    case 'resources/list':
      return { resources: [] };
    case 'resources/templates/list':
      return { resourceTemplates: [] };
    default:
      return undefined;
  }
}

async function handle(message) {
  const hasId = message.id !== undefined && message.id !== null;
  const method = typeof message.method === 'string' ? message.method : undefined;

  if (method === 'initialize') {
    lastInitializeParams = message.params || {};
    const cached = manifest && {
      protocolVersion: pickVersion(lastInitializeParams.protocolVersion),
      capabilities: manifest.capabilities || { tools: { listChanged: true } },
      serverInfo: manifest.serverInfo || { name: 'rea', version: 'cached' },
    };
    if (cached) {
      log('initialize answered from manifest (REA not started)');
      emit({ jsonrpc: '2.0', id: message.id, result: cached });
      return;
    }
    await warmOrFail(message);
    return;
  }

  if (method && LIST_METHODS.has(method) && !(message.params && message.params.cursor)) {
    const cached = fromCache(method);
    if (cached) {
      log(method + ' answered from manifest');
      emit({ jsonrpc: '2.0', id: message.id, result: cached });
      return;
    }
  }

  if (!hasId) {
    // Client notification (initialized, cancelled, progress): best effort.
    if (child) send(child, message);
    return;
  }

  if (!child || starting) {
    // Never forward into a child that has not finished its handshake yet.
    queue.push(message);
    if (!starting) await startChild();
    return;
  }
  forward(child, message);
}

async function warmOrFail(message) {
  queue.push(message);
  try {
    await startChild();
  } catch (error) {
    const pending = queue;
    queue = [];
    for (const item of pending) replyError(item.id, 'rea-lazy: failed to start REA: ' + String((error && error.message) || error));
  }
}

const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
lines.on('line', (line) => {
  const text = line.trim();
  if (!text) return;
  let message;
  try {
    message = JSON.parse(text);
  } catch {
    log('ignoring non-JSON line from host');
    return;
  }
  handle(message).catch((error) => {
    log('handler error: ' + String((error && error.message) || error));
    if (message && message.id !== undefined) replyError(message.id, 'rea-lazy: ' + String((error && error.message) || error));
  });
});

lines.on('close', () => {
  log('host closed stdin — shutting down');
  stopChild('host closed stdin');
  process.exit(0);
});

for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
  process.on(signal, () => {
    stopChild(signal);
    process.exit(0);
  });
}

process.on('exit', () => stopChild('proxy exit'));

if (EAGER) startChild().catch(() => {});
else log('mode lazy (idle ' + (IDLE_MS === 0 ? 'never stop' : Math.round(IDLE_MS / 1000) + 's') + ', spec ' + SPEC + ')');
//#endregion
