/* EasyVideo - server bootstrap.
 *
 * Responsibilities, in order:
 *   1. load ./data/settings.json (creates it on first run)
 *   2. open ./log/ and start logging
 *   3. single-instance guard
 *   4. HTTP + WebSocket server on the configured port (default 13750)
 *   5. register ev:// and route incoming protocol URLs
 *   6. system tray icon
 *   7. graceful shutdown
 *
 * Everything persistent lives under ./data/, everything volatile under the
 * cache root, every log line under ./log/.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile, spawn } from 'node:child_process';
import PATHS, { ensureDirs, APP_ROOT } from './paths.js';
import config from './config.js';
import logger from './logger.js';
import store from './store.js';
import { Router, Response, readBody, readJson, serveAsset } from './http.js';
import { hub } from './hub.js';
import { mount } from './api.js';
import { mountSocial } from './social.js';
import { mountTranscode } from './transcode-routes.js';
import { mountThemes } from './theme-routes.js';
import { mountGithub } from './github-routes.js';
import * as uploader from './uploader.js';
import * as plugins from './plugins.js';
import * as protocol from './protocol.js';
import { tray } from './tray.js';
import * as search from './search.js';
import * as transport from './transport.js';

const argv = process.argv.slice(1);
const flags = new Set(argv.filter((a) => a.startsWith('-')));

/* 启动开关：
 *   -b    后台启动（不打开浏览器）
 *   -br   后台启动，延迟片刻后打开应用（默认 1500ms，可用 --open-delay=NNNN 调整）
 *   -nob  不打开浏览器（托盘照常）
 * 长写形式 --background / --open-delayed / --no-browser 等价。 */
const flagSet = new Set();
for (const raw of flags) {
  const name = String(raw).split('=')[0].toLowerCase();
  flagSet.add(name);
  if (name === '-b' || name === '--background') flagSet.add('--background');
  if (name === '-br' || name === '--open-delayed') { flagSet.add('--background'); flagSet.add('--open-delayed'); }
  if (name === '-nob' || name === '--no-browser') flagSet.add('--no-browser');
  if (name === '-nt' || name === '--no-tray') flagSet.add('--no-tray');
}
function flag(name) { return flagSet.has(name); }
function flagValue(name, fallback) {
  for (const raw of flags) {
    const text = String(raw);
    if (text.indexOf(name + '=') === 0) return text.slice(name.length + 1);
  }
  return fallback;
}
const OPEN_DELAY_MS = Math.max(0, Number(flagValue('--open-delay', 1500)) || 1500);
const protocolArg = argv.find((a) => String(a).replace(/^"|"$/g, '').toLowerCase().startsWith('ev://'));

ensureDirs();
config.load();
ensureDirs();

logger.configure({
  level: config.get('app', 'logLevel', 'info'),
  toConsole: config.get('app', 'logToConsole', true),
  maxFiles: config.get('app', 'logMaxFiles', 14)
});
const log = logger.child('main');

log.info('EasyVideo', 'v' + (config.data.version || 1), 'node', process.version);
log.info('appRoot', APP_ROOT);
log.info('data', PATHS.data);
log.info('log', PATHS.log);
log.info('cache', PATHS.cache);

store.load();
store.startBackupTimer(config.get('app', 'backupEveryMinutes', 30));
search.importModels(store.db.searchModels || null);

/* ---------------------------------------------------- single instance ---- */

const LOCK_FILE = path.join(PATHS.data, 'easyvideo.lock');

function acquireLock() {
  if (!config.get('app', 'singleInstance', true)) return true;
  try {
    if (fs.existsSync(LOCK_FILE)) {
      const prev = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8'));
      if (prev && prev.pid && prev.pid !== process.pid) {
        let alive = false;
        try { process.kill(prev.pid, 0); alive = true; } catch { alive = false; }
        if (alive) {
          log.warn('another instance is running (pid ' + prev.pid + '); handing off the URL');
          return { ok: false, pid: prev.pid, url: prev.url };
        }
      }
    }
  } catch { /* stale or unreadable lock: take it */ }
  return { ok: true };
}

function writeLock(url) {
  try { fs.writeFileSync(LOCK_FILE, JSON.stringify({ pid: process.pid, url, at: Date.now() }), 'utf8'); }
  catch { /* ignore */ }
}

function releaseLock() {
  try {
    const cur = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8'));
    if (cur && cur.pid === process.pid) fs.rmSync(LOCK_FILE, { force: true });
  } catch { /* ignore */ }
}

/* ------------------------------------------------------------- browser --- */

function openExternal(target) {
  try {
    if (process.platform === 'win32') {
      spawn('cmd', ['/c', 'start', '', target], { detached: true, windowsHide: true, stdio: 'ignore' }).unref();
    } else if (process.platform === 'darwin') {
      spawn('open', [target], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn('xdg-open', [target], { detached: true, stdio: 'ignore' }).unref();
    }
    return true;
  } catch (err) { log.warn('open failed:', err.message); return false; }
}

function openPath(dir) { openExternal(dir); }

/* -------------------------------------------------------------- server --- */

const router = new Router();


mount(router);

/* Social surface: recommendations, reactions, comments, plugins. */
mountSocial(router, (fn) => async (ctx, req, res, params) => {
  try { await fn(ctx, req, res, params || {}); }
  catch (err) { res.fail(err, err.status || 500); }
}, {
  store: store,
  currentAccount: (db) => {
    const acc = (db.currentAccountId && db.accounts[db.currentAccountId]) || Object.values(db.accounts)[0];
    return acc || { id: "local", nickname: "本机用户" };
  }
});

/* Transcoding: ffmpeg discovery, probing and the quality ladder. */
mountTranscode(router, (fn) => async (ctx, req, res, params) => {
  try { await fn(ctx, req, res, params || {}); }
  catch (err) { res.fail(err, err.status || 500); }
}, { store: store });

/* Themes and the bundled-component inventory. */
mountThemes(router, (fn) => async (ctx, req, res, params) => {
  try { await fn(ctx, req, res, params || {}); }
  catch (err) { res.fail(err, err.status || 500); }
});

/* GitHub identity, repositories and asset upload. */
mountGithub(router, (fn) => async (ctx, req, res, params) => {
  try { await fn(ctx, req, res, params || {}); }
  catch (err) { res.fail(err, err.status || 500); }
});

/* Honour the upload-accelerator autostart flag without blocking boot. */
uploader.autostart();

/* Plugins may register their own /api/plugin/<name>/* routes. */
plugins.loadPlugins((method, pattern, handler) => {
  router.add(method, pattern, async (ctx, req, res, params) => {
    try { await handler(ctx, req, res, params || {}); }
    catch (err) { res.fail(err, err.status || 500); }
  });
});

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
  const method = (req.method || 'GET').toUpperCase();
  const R = new Response(res);

  if (method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  try {
    const hit = router.match(method, url.pathname);
    if (hit) {
      const accountId = req.headers['x-ev-account'] || store.db.currentAccountId;
      const account = (accountId && store.db.accounts[accountId]) || null;
      let rawBody = null;
      let body = {};
      // 流式路由自己读 req：上传的文件可能远超 2 GiB 的 Buffer 上限。
      if (!hit.route.stream && (method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE')) {
        rawBody = await readBody(req);
        const ctype = String(req.headers['content-type'] || '');
        if (rawBody && rawBody.length && ctype.includes('json')) {
          try { body = JSON.parse(rawBody.toString('utf8')); }
          catch { R.json({ ok: false, error: 'invalid JSON body' }, 400); return; }
        } else if (rawBody && rawBody.length && (ctype.includes('form-urlencoded'))) {
          body = Object.fromEntries(new URLSearchParams(rawBody.toString('utf8')));
        }
      }
      const ctx = { query: url.searchParams, url, req, res: R, account, body, rawBody, headers: req.headers };
      await hit.route.handler(ctx, req, R, hit.params);
      return;
    }

    if (url.pathname.startsWith('/api/')) { R.json({ ok: false, error: 'no such endpoint', path: url.pathname }, 404); return; }

    // static assets, then SPA fallback so every route below loads the shell
    let assetPath = url.pathname;
    if (assetPath.endsWith('/')) assetPath += 'index.html';
    if (serveAsset(R, assetPath)) return;
    if (serveAsset(R, url.pathname)) return;
    if (serveAsset(R, '/index.html')) return;
    R.json({ ok: false, error: 'not found', path: url.pathname }, 404);
  } catch (err) {
    R.fail(err, err.status || 500);
  }
});

hub.attach(server);

/* ---------------------------------------------------------------- start -- */

const PORT = Number(process.env.EV_PORT || config.get('app', 'port', 13750));
const HOST = String(process.env.EV_HOST || config.get('app', 'host', '127.0.0.1'));
const baseUrl = 'http://localhost:' + PORT + '/';

function pendingProtocolRoute() {
  if (!protocolArg) return null;
  const parsed = protocol.parse(protocolArg);
  return parsed ? parsed.route : null;
}

const lock = acquireLock();
if (lock && lock.ok === false) {
  const target = pendingProtocolRoute();
  const url = (lock.url || baseUrl) + (target ? '#' + target : '');
  log.info('forwarding to running instance:', url);
  openExternal(url);
  setTimeout(() => process.exit(0), 400);
} else {
  startServer();
}

function startServer() {
  server.on('error', (err) => {
    log.error('server error:', err.message);
    if (err.code === 'EADDRINUSE') {
      log.error('port ' + PORT + ' is busy; another EasyVideo or an unrelated app owns it');
      tray.setState('error');
      tray.balloon('端口 ' + PORT + ' 被占用，请修改 data/settings.json 中的 app.port');
    }
  });

  server.listen(PORT, HOST, async () => {
    const url = 'http://' + HOST + ':' + PORT + '/';
    writeLock(url);
    log.info('listening on', url);
    tray.setUrl(url);

    if (config.get('app', 'registerEvProtocol', true) && !flag('--no-protocol')) {
      const r = await protocol.registerProtocol();
      log.info('ev:// registration:', r.ok ? 'ok' : 'skipped (' + r.reason + ')');
    }

    if (config.get('app', 'tray', true) && !flag('--no-tray')) {
      tray.start({ title: 'EasyVideo', tip: 'EasyVideo - 流式直播与视频' });
      tray.on('command', (cmd) => {
        log.info('tray command:', cmd);
        if (cmd === 'open') openExternal(tray.url);
        else if (cmd === 'live') openExternal(tray.url + '#/live/home/');
        else if (cmd === 'video') openExternal(tray.url + '#/video/home/');
        else if (cmd === 'copyurl') {
          const ps = 'Set-Clipboard -Value "' + tray.url + '"';
          execFile('powershell.exe', ['-NoProfile', '-Command', ps], { windowsHide: true }, () => {});
          tray.balloon('已复制: ' + tray.url);
        } else if (cmd === 'logs') openPath(PATHS.log);
        else if (cmd === 'data') openPath(PATHS.data);
        else if (cmd === 'quit') shutdown('tray');
      });
    }

    const target = pendingProtocolRoute();
    if (target) log.info('protocol route:', target);
    // -b 后台启动；-br 后台启动并延迟打开；-nob 不打开浏览器。
    const noBrowser = flag('--background') || flag('--no-browser') || flag('--no-window') || flag('--silent');
    const wantBrowser = config.get('app', 'autoOpenBrowser', true) && !noBrowser;
    const openUrl = url + (target ? '#' + target : '');
    if (wantBrowser && flag('--open-delayed') && OPEN_DELAY_MS > 0) {
      setTimeout(function () { openExternal(openUrl); }, OPEN_DELAY_MS);
      log.info('browser opens in', OPEN_DELAY_MS + 'ms');
    } else if (wantBrowser) {
      openExternal(openUrl);
    }
    log.info('EasyVideo ready', 'mode=' + transport.MODES.join('/'), 'accounts=' + Object.keys(store.db.accounts).length);
  });
}

/* --------------------------------------------------------------- stop ---- */

let stopping = false;
function shutdown(why) {
  if (stopping) return;
  stopping = true;
  log.info('shutting down (' + why + ')');
  try { store.db.searchModels = search.exportModels(); store.touch('shutdown'); store.flush('shutdown'); } catch { /* ignore */ }
  try { store.backup('shutdown'); } catch { /* ignore */ }
  try { store.close(); } catch { /* ignore */ }
  try { tray.stop(); } catch { /* ignore */ }
  releaseLock();
  server.close(() => { logger.close(); process.exit(0); });
  setTimeout(() => { logger.close(); process.exit(0); }, 2500).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('uncaughtException', (err) => { log.error('uncaught:', err.stack || err.message); });
process.on('unhandledRejection', (err) => { log.error('unhandled rejection:', err && err.message ? err.message : String(err)); });

export { server, shutdown };
