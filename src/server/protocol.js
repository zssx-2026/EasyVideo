/* EasyVideo - ev:// URL scheme: registration, parsing, dispatch.
 *
 *   ev://live/<nick>/<pid>              a live room
 *   ev://video/<nick>/<pid>             a video
 *   ev://live/secret/<nick>/<pid>       a friends-only live room
 *   ev://video/secret/<nick>/<pid>      a friends-only video
 *   ev://search/<base64>                a search (never surfaced in the UI)
 *   ev://live/search/<base64>           a live-scoped search
 *   ev://video/search/<base64>          a video-scoped search
 */

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import PATHS, { IS_SEA } from './paths.js';
import logger from './logger.js';

const log = logger.child('protocol');

export const SCHEME = 'ev';

/** Absolute path of the executable that should answer ev:// links. */
export function handlerCommand() {
  if (IS_SEA) return process.execPath;
  const local = path.join(PATHS.appRoot, 'EasyVideo.exe');
  if (fs.existsSync(local)) return local;
  return process.execPath;
}

const quote = (p) => '"' + p + '"';

/**
 * Register ev:// under HKCU (no admin needed).
 * Windows only; on other platforms this is a no-op that reports unsupported.
 */
export function registerProtocol() {
  if (process.platform !== 'win32') return Promise.resolve({ ok: false, reason: 'unsupported-platform' });
  const exe = handlerCommand();
  const cmd = quote(exe) + ' "%1"';
  const args = [
    ['add', 'HKCU\\Software\\Classes\\ev', '/ve', '/d', 'URL:EasyVideo Protocol', '/f'],
    ['add', 'HKCU\\Software\\Classes\\ev', '/v', 'URL Protocol', '/d', '', '/f'],
    ['add', 'HKCU\\Software\\Classes\\ev\\DefaultIcon', '/ve', '/d', quote(exe) + ',0', '/f'],
    ['add', 'HKCU\\Software\\Classes\\ev\\shell\\open\\command', '/ve', '/d', cmd, '/f']
  ];
  return new Promise((resolve) => {
    let i = 0;
    const step = () => {
      if (i >= args.length) { log.info('ev:// registered ->', exe); resolve({ ok: true, exe, command: cmd }); return; }
      execFile('reg.exe', args[i++], { windowsHide: true }, (err) => {
        if (err) { log.warn('reg failed:', err.message); resolve({ ok: false, reason: err.message }); return; }
        step();
      });
    };
    step();
  });
}

export function isRegistered() {
  if (process.platform !== 'win32') return Promise.resolve(false);
  return new Promise((resolve) => {
    execFile('reg.exe', ['query', 'HKCU\\Software\\Classes\\ev\\shell\\open\\command', '/ve'],
      { windowsHide: true }, (err, stdout) => resolve(!err && /EasyVideo/i.test(String(stdout))));
  });
}

export function unregisterProtocol() {
  if (process.platform !== 'win32') return Promise.resolve(false);
  return new Promise((resolve) => {
    execFile('reg.exe', ['delete', 'HKCU\\Software\\Classes\\ev', '/f'], { windowsHide: true },
      () => resolve(true));
  });
}

/**
 * Parse an ev:// URL into a route the SPA understands.
 * Returns null when the URL is not ours.
 */
export function parse(url) {
  if (!url) return null;
  const text = String(url).trim().replace(/^"|"$/g, '');
  if (!/^ev:\/\//i.test(text)) return null;
  const rest = text.slice('ev://'.length);
  const hashIdx = rest.indexOf('#');
  const clean = hashIdx >= 0 ? rest.slice(0, hashIdx) : rest;
  const qIdx = clean.indexOf('?');
  const pathPart = qIdx >= 0 ? clean.slice(0, qIdx) : clean;
  const query = qIdx >= 0 ? clean.slice(qIdx + 1) : '';
  const segs = pathPart.split('/').filter(Boolean).map((s) => decodeURIComponent(s));

  const out = { kind: 'home', route: '/home/', segments: segs, query };
  if (!segs.length) return out;

  const scope = segs[0].toLowerCase();
  if (scope === 'search') {
    // ev://search/<base64> or ev://search?=...&kind=live|video
    const b64 = segs[1] || '';
    out.kind = 'search';
    out.scope = 'all';
    out.term = decodeTerm(b64 || query);
    out.route = '/search/' + encodeURIComponent(b64 || '');
    return out;
  }

  if (scope === 'live' || scope === 'video') {
    out.kind = scope;
    let rest2 = segs.slice(1);
    if (rest2[0] && rest2[0].toLowerCase() === 'secret') { out.secret = true; rest2 = rest2.slice(1); }
    if (rest2[0] && rest2[0].toLowerCase() === 'search') {
      const b64 = rest2[1] || '';
      out.kind = 'search';
      out.scope = scope;
      out.term = decodeTerm(b64 || query);
      out.route = '/' + scope + '/search/' + encodeURIComponent(b64 || '');
      return out;
    }
    if (rest2[0] && rest2[0].toLowerCase() === 'home') {
      out.route = '/' + scope + '/home/';
      return out;
    }
    if (rest2[0] && rest2[0].toLowerCase() === 'newlive') {
      out.kind = 'live';
      out.route = '/live/newlive/';
      return out;
    }
    if (rest2[0] && rest2[0].toLowerCase() === 'release') {
      out.kind = 'video';
      out.route = '/video/release/';
      return out;
    }
    if (rest2[0] && rest2[0].toLowerCase() === 'draft') {
      out.kind = 'video';
      out.route = '/video/draft/' + (rest2[1] || 'new') + '/';
      return out;
    }
    const nick = rest2[0] || '';
    const pid = rest2[1] || '';
    out.nick = nick;
    out.pid = pid;
    out.route = (out.secret ? '/' + scope + '/secret/' : '/' + scope + '/') +
      encodeURIComponent(nick) + '/' + encodeURIComponent(pid) + '/';
    return out;
  }

  if (scope === 'home' || scope === 'myself' || scope === 'privacy' || scope === 'mydata' || scope === 'settings') {
    out.kind = 'home';
    out.route = '/home/' + (segs[1] ? segs[1] + '/' : '');
    return out;
  }

  out.route = '/' + segs.join('/') + '/';
  return out;
}

function decodeTerm(raw) {
  if (!raw) return '';
  try { return Buffer.from(String(raw), 'base64').toString('utf8'); } catch { return String(raw); }
}

export const encodeSearch = (term) => Buffer.from(String(term || ''), 'utf8').toString('base64');
export const searchUrl = (term, scope) =>
  'ev://' + (scope && scope !== 'all' ? scope + '/' : '') + 'search/' + encodeSearch(term);

export default { SCHEME, registerProtocol, unregisterProtocol, isRegistered, parse, encodeSearch, searchUrl, handlerCommand };
