/* EasyVideo - system tray icon.
 *
 * A hidden PowerShell/WinForms process owns the NotifyIcon and talks a line
 * protocol over stdio, so the app ships a tray with no native module and no
 * compiler on the build machine. Tray commands are surfaced to the rest of the
 * server through an EventEmitter: 'open', 'live', 'video', 'copyurl', 'logs',
 * 'data', 'quit'.
 */

import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import zlib from 'node:zlib';
import PATHS from './paths.js';
import { EMBEDDED } from './assets.generated.js';
import logger from './logger.js';

const log = logger.child('tray');
const here = (() => {
  try { if (typeof __dirname === 'string' && __dirname) return __dirname; } catch (err) { /* not CJS */ }
  try { return path.dirname(url.fileURLToPath(import.meta.url)); } catch (err) { return process.cwd(); }
})();

/**
 * Write one embedded asset into the cache dir so an external process (the
 * PowerShell tray host) can load it. The packaged EXE has no loose files.
 */
function extract(key, name) {
  try {
    const entry = EMBEDDED && EMBEDDED[key];
    if (!entry) return null;
    const dir = path.join(PATHS.cache, 'runtime');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, name);
    const raw = Buffer.from(entry.data, 'base64');
    const body = entry.gz ? zlib.gunzipSync(raw) : raw;
    // PowerShell 5.1 reads a BOM-less .ps1 as ANSI, which mangles the
    // Chinese labels and turns the whole script into a parse error.
    const out = /[.]ps1$/i.test(name)
      ? Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), body])
      : body;
    fs.writeFileSync(file, out);
    return file;
  } catch (err) { return null; }
}

export class Tray extends EventEmitter {
  constructor() {
    super();
    this.proc = null;
    this.ready = false;
    this.state = 'idle';
    this.url = 'http://localhost:13750/';
    this.available = process.platform === 'win32';
  }

  iconFile(state) {
    const name = 'tray-' + (state || this.state) + '-32.png';
    const candidates = [
      path.join(PATHS.appRoot, 'assets', 'img', name),
      path.join(PATHS.appRoot, 'app', 'assets', 'img', name),
      path.join(here, '..', '..', 'assets', 'img', name)
    ];
    for (const c of candidates) if (fs.existsSync(c)) return c;
    return extract('assets/img/' + name, name);
  }

  scriptFile() {
    const candidates = [
      path.join(PATHS.appRoot, 'src', 'server', 'tray.ps1'),
      path.join(PATHS.appRoot, 'app', 'tray.ps1'),
      path.join(here, 'tray.ps1')
    ];
    for (const c of candidates) if (fs.existsSync(c)) return c;
    return extract('server/tray.ps1', 'tray.ps1');
  }

  start(opts) {
    if (!this.available) { log.info('tray skipped (non-windows)'); return false; }
    if (this.proc) return true;
    const script = this.scriptFile();
    const icon = this.iconFile('idle');
    if (!script || !icon) { log.warn('tray assets missing; tray disabled'); this.available = false; return false; }
    const shell = process.env.SystemRoot
      ? path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
      : 'powershell.exe';
    const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script,
      '-IconPath', icon, '-Title', (opts && opts.title) || 'EasyVideo', '-Tip', (opts && opts.tip) || 'EasyVideo'];
    try {
      this.proc = spawn(shell, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (err) {
      log.warn('tray spawn failed:', err.message);
      this.proc = null;
      this.available = false;
      return false;
    }
    this.proc.stdout.setEncoding('utf8');
    this.proc.stdout.on('data', (chunk) => {
      for (const line of String(chunk).split(/\r?\n/)) {
        const text = line.trim();
        if (!text) continue;
        if (text === 'READY') { this.ready = true; log.info('tray ready'); this.emit('ready'); continue; }
        if (text.startsWith('MENU ')) { this.emit('command', text.slice(5).trim()); continue; }
        if (text === 'CLICK' || text === 'DOUBLE') { this.emit('command', 'open'); continue; }
        if (text === 'QUIT') { this.emit('command', 'quit'); continue; }
      }
    });
    this.proc.stderr.setEncoding('utf8');
    this.proc.stderr.on('data', (c) => { const t = String(c).trim(); if (t) log.warn('tray:', t); });
    this.proc.on('exit', (code) => { log.info('tray exited', code); this.proc = null; this.ready = false; });
    return true;
  }

  send(line) {
    if (!this.proc || !this.proc.stdin.writable) return false;
    try { this.proc.stdin.write(line + String.fromCharCode(10)); return true; }
    catch { return false; }
  }

  setState(state) {
    this.state = state;
    const icon = this.iconFile(state);
    if (icon) this.send('ICON ' + icon);
    this.send('TIP EasyVideo - ' + describe(state));
  }

  balloon(text) { this.send('BALLOON ' + String(text || '').replace(/[|\r\n]/g, ' ')); }

  setUrl(u) { this.url = u; }

  stop() {
    if (!this.proc) return;
    this.send('EXIT');
    const proc = this.proc;
    setTimeout(() => { try { proc.kill(); } catch { /* already gone */ } }, 1200);
  }
}

function describe(state) {
  if (state === 'live') return '正在直播';
  if (state === 'offline') return '未连接';
  if (state === 'error') return '需要处理';
  return '就绪';
}

export const tray = new Tray();
export default tray;
