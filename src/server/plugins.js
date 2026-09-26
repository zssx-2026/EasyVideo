/* EasyVideo - plugin host with a built-in ZSTD container.
 *
 * A plugin adds API routes, UI panels and event hooks to a running EasyVideo.
 * Two on-disk shapes are supported:
 *
 *   program/plugins/<name>.evp                     zstd(JSON) single-file package
 *   program/plugins/<name>/plugin.json + main.js   loose directory
 *
 * The .evp container is written with node:zlib, which has native ZSTD since
 * Node 22 - so the app reads real ZSTD packages with no native module and no
 * external tool. gzip / brotli / plain JSON are accepted as fallbacks.
 *
 * Package JSON shape:
 *   { "name": "hello", "version": "1.0.0", "description": "...",
 *     "author": "...", "main": "<javascript source>", "permissions": ["routes"] }
 *
 * Plugin source is evaluated with (api, module, exports, console) in scope and
 * only ever reaches the server through api:
 *
 *   api.get('/hello', function (ctx, req, res) { res.json({ ok: true }); });
 *   api.panel({ id: 'hello', title: 'Hello', icon: 'sparkles' });
 *   api.on('video.publish', function (payload) { ... });
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import PATHS from './paths.js';
import logger from './logger.js';

const log = logger.child('plugins');

export const PLUGIN_DIRS = () => [
  path.join(PATHS.program, 'plugins'),
  path.join(PATHS.appRoot, 'program', 'plugins'),
  path.join(PATHS.appRoot, 'src', 'server', 'plugins')
];

const loaded = new Map();

function readJsonFile(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (err) { return null; }
}

export function decodePackage(buf) {
  const attempts = [];
  if (typeof zlib.zstdDecompressSync === 'function') attempts.push(() => zlib.zstdDecompressSync(buf));
  attempts.push(() => zlib.gunzipSync(buf));
  attempts.push(() => zlib.brotliDecompressSync(buf));
  attempts.push(() => buf);
  for (const decode of attempts) {
    try {
      const raw = decode();
      const text = Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw);
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === 'object') return parsed;
    } catch (err) { /* try the next codec */ }
  }
  return null;
}

export function encodePackage(obj) {
  const raw = Buffer.from(JSON.stringify(obj, null, 2), 'utf8');
  if (typeof zlib.zstdCompressSync === 'function') return { buffer: zlib.zstdCompressSync(raw), codec: 'zstd' };
  return { buffer: zlib.gzipSync(raw, { level: 9 }), codec: 'gzip' };
}

function makeApi(record, register) {
  const base = '/api/plugin/' + record.name;
  return {
    name: record.name,
    version: record.version,
    base: base,
    get: (p, h) => register('GET', base + p, h),
    post: (p, h) => register('POST', base + p, h),
    put: (p, h) => register('PUT', base + p, h),
    del: (p, h) => register('DELETE', base + p, h),
    on: (event, handler) => { record.hooks.push({ event: String(event), handler: handler }); },
    panel: (panel) => { record.panels.push(Object.assign({ plugin: record.name }, panel || {})); },
    log: (...args) => log.info('[' + record.name + ']', ...args)
  };
}

function runPlugin(record, source, register) {
  const api = makeApi(record, register);
  const module = { exports: {} };
  const sandboxConsole = {
    log: (...a) => log.info('[' + record.name + ']', ...a),
    warn: (...a) => log.warn('[' + record.name + ']', ...a),
    error: (...a) => log.error('[' + record.name + ']', ...a)
  };
  const body = String(source || '') + String.fromCharCode(10) + '//# sourceURL=ev-plugin-' + record.name + '.js';
  const fn = new Function('api', 'module', 'exports', 'console', body);
  fn(api, module, module.exports, sandboxConsole);
  if (typeof module.exports === 'function') module.exports(api);
  else if (module.exports && typeof module.exports.install === 'function') module.exports.install(api);
}

/** Discover and load every plugin; a broken plugin is reported, never hidden. */
export function loadPlugins(registerRoute) {
  const report = [];
  const seen = new Set();
  for (const dir of PLUGIN_DIRS()) {
    if (!fs.existsSync(dir)) continue;
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (err) { continue; }
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      let manifest = null;
      let source = null;
      try {
        if (entry.isFile() && /[.](evp|evz|json)$/i.test(entry.name)) {
          const parsed = decodePackage(fs.readFileSync(abs));
          if (parsed) { manifest = parsed; source = parsed.main || ''; }
        } else if (entry.isDirectory()) {
          const meta = readJsonFile(path.join(abs, 'plugin.json'));
          if (meta) {
            manifest = meta;
            const mainFile = path.join(abs, meta.main || 'main.js');
            source = fs.existsSync(mainFile) ? fs.readFileSync(mainFile, 'utf8') : '';
          }
        }
      } catch (err) {
        report.push({ name: entry.name, ok: false, error: err.message });
        continue;
      }
      if (!manifest || !manifest.name) continue;
      if (seen.has(manifest.name)) continue;
      seen.add(manifest.name);

      const record = {
        name: manifest.name,
        version: manifest.version || '0.0.0',
        description: manifest.description || '',
        author: manifest.author || '',
        permissions: manifest.permissions || ['routes'],
        file: abs,
        kind: entry.isDirectory() ? 'directory' : 'package',
        loadedAt: Date.now(),
        routes: [],
        panels: [],
        hooks: [],
        ok: true,
        error: null
      };
      try {
        runPlugin(record, source || '', (method, pattern, handler) => {
          registerRoute(method, pattern, handler);
          record.routes.push(method + ' ' + pattern);
        });
      } catch (err) {
        record.ok = false;
        record.error = err && err.message ? err.message : String(err);
        log.warn('plugin failed:', record.name, record.error);
      }
      loaded.set(record.name, record);
      report.push({ name: record.name, ok: record.ok, error: record.error, routes: record.routes.length, panels: record.panels.length });
    }
  }
  if (report.length) log.info('plugins:', report.map((r) => r.name + (r.ok ? '' : '(failed)')).join(', '));
  return report;
}

export function pluginList() {
  return [...loaded.values()].map((p) => ({
    name: p.name, version: p.version, description: p.description, author: p.author,
    kind: p.kind, ok: p.ok, error: p.error, routes: p.routes, panels: p.panels,
    permissions: p.permissions, file: p.file, loadedAt: p.loadedAt
  }));
}

export function pluginPanels() {
  const out = [];
  for (const p of loaded.values()) for (const panel of p.panels) out.push(panel);
  return out;
}

export function emit(event, payload) {
  let n = 0;
  for (const p of loaded.values()) {
    for (const hook of p.hooks) {
      if (hook.event !== event) continue;
      try { hook.handler(payload); n++; } catch (err) { log.warn('hook failed', p.name, err.message); }
    }
  }
  return n;
}

export function installPackage(buf, fileName) {
  const manifest = decodePackage(buf);
  if (!manifest || !manifest.name) throw new Error('not a valid plugin package (expected a zstd/gzip JSON payload with a name field)');
  const dir = path.join(PATHS.program, 'plugins');
  fs.mkdirSync(dir, { recursive: true });
  const safe = String(manifest.name).replace(/[^A-Za-z0-9_.-]/g, '_');
  const target = path.join(dir, safe + '.evp');
  fs.writeFileSync(target, buf);
  log.info('plugin installed:', safe, 'from', fileName || 'upload');
  // List it immediately, flagged pending: its routes appear after a restart.
  loaded.set(safe, {
    name: safe, version: manifest.version || '0.0.0',
    description: manifest.description || '', author: manifest.author || '',
    permissions: manifest.permissions || ['routes'], file: target, kind: 'package',
    loadedAt: Date.now(), routes: [], panels: [], hooks: [],
    ok: false, error: 'restart-required', pending: true
  });
  return { manifest, file: target };
}

export function removePlugin(name) {
  const record = loaded.get(name);
  const dir = path.join(PATHS.program, 'plugins');
  const candidates = [record ? record.file : null, path.join(dir, name + '.evp'), path.join(dir, name)].filter(Boolean);
  let removed = null;
  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) {
        if (fs.statSync(c).isDirectory()) fs.rmSync(c, { recursive: true, force: true });
        else fs.rmSync(c, { force: true });
        removed = c;
      }
    } catch (err) { /* keep trying */ }
  }
  loaded.delete(name);
  return removed;
}

export function pluginStats() {
  const list = pluginList();
  return {
    count: list.length,
    ok: list.filter((p) => p.ok).length,
    failed: list.filter((p) => !p.ok).length,
    routes: list.reduce((n, p) => n + p.routes.length, 0),
    panels: pluginPanels().length,
    zstd: typeof zlib.zstdCompressSync === 'function',
    dirs: PLUGIN_DIRS()
  };
}

export default { loadPlugins, pluginList, pluginPanels, pluginStats, installPackage, removePlugin, decodePackage, encodePackage, emit, PLUGIN_DIRS };
