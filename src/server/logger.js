/* EasyVideo - file + console logger. Writes to <appRoot>/log/easyvideo-YYYY-MM-DD.log */
import fs from 'node:fs';
import path from 'node:path';
import PATHS from './paths.js';

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3, trace: 4 };

function stamp(d) {
  const p = (n, w) => String(n).padStart(w, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1, 2) + '-' + p(d.getDate(), 2) + ' ' +
    p(d.getHours(), 2) + ':' + p(d.getMinutes(), 2) + ':' + p(d.getSeconds(), 2) + '.' + p(d.getMilliseconds(), 3);
}

const dayKey = (d) => d.toISOString().slice(0, 10);

class Logger {
  constructor() {
    this.level = 'info';
    this.toConsole = true;
    this.maxFiles = 14;
    this.stream = null;
    this.currentDay = null;
    this.bytes = 0;
    this.maxBytes = 8 * 1024 * 1024;
  }

  configure(opts) {
    const o = opts || {};
    if (o.level) this.level = String(o.level);
    if (o.toConsole !== undefined) this.toConsole = !!o.toConsole;
    if (o.maxFiles) this.maxFiles = Number(o.maxFiles);
    return this;
  }

  filePath(day) {
    return path.join(PATHS.log, 'easyvideo-' + (day || dayKey(new Date())) + '.log');
  }

  open() {
    const day = dayKey(new Date());
    if (this.stream && this.currentDay === day && this.bytes < this.maxBytes) return this.stream;
    if (this.stream) { try { this.stream.end(); } catch { /* ignore */ } this.stream = null; }
    try {
      fs.mkdirSync(PATHS.log, { recursive: true });
      const file = this.filePath(day);
      try { this.bytes = fs.statSync(file).size; } catch { this.bytes = 0; }
      if (this.bytes >= this.maxBytes) {
        try { fs.renameSync(file, path.join(PATHS.log, 'easyvideo-' + day + '-' + Date.now() + '.log')); } catch { /* ignore */ }
        this.bytes = 0;
      }
      this.stream = fs.createWriteStream(file, { flags: 'a' });
      this.stream.on('error', () => { this.stream = null; });
      this.currentDay = day;
      this.prune();
      return this.stream;
    } catch {
      this.stream = null;
      return null;
    }
  }

  prune() {
    try {
      const files = fs.readdirSync(PATHS.log).filter((f) => f.startsWith('easyvideo-') && f.endsWith('.log')).sort();
      while (files.length > this.maxFiles) {
        const victim = files.shift();
        try { fs.rmSync(path.join(PATHS.log, victim), { force: true }); } catch { /* ignore */ }
      }
    } catch { /* ignore */ }
  }

  write(level, args) {
    if (LEVELS[level] > (LEVELS[this.level] === undefined ? 2 : LEVELS[this.level])) return;
    const text = args.map((a) => {
      if (a instanceof Error) return a.stack || a.message;
      if (typeof a === 'string') return a;
      try { return JSON.stringify(a); } catch { return String(a); }
    }).join(' ');
    const line = '[' + stamp(new Date()) + '] [' + level.toUpperCase() + '] ' + text + String.fromCharCode(10);
    const s = this.open();
    if (s) { try { s.write(line); this.bytes += Buffer.byteLength(line); } catch { /* ignore */ } }
    if (this.toConsole) {
      const sink = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
      sink('[' + new Date().toISOString().slice(11, 23) + ']', ...args);
    }
  }

  error(...a) { this.write('error', a); }
  warn(...a) { this.write('warn', a); }
  info(...a) { this.write('info', a); }
  debug(...a) { this.write('debug', a); }

  child(tag) {
    const self = this;
    const prefix = '[' + tag + '] ';
    return {
      error: (...a) => self.error(prefix, ...a),
      warn: (...a) => self.warn(prefix, ...a),
      info: (...a) => self.info(prefix, ...a),
      debug: (...a) => self.debug(prefix, ...a)
    };
  }

  /** Last n lines of today's log, for the in-app log viewer. */
  tail(n) {
    const want = Math.max(1, Math.min(5000, Number(n) || 200));
    try {
      const file = this.filePath();
      if (!fs.existsSync(file)) return [];
      const text = fs.readFileSync(file, 'utf8');
      return text.split(String.fromCharCode(10)).filter(Boolean).slice(-want);
    } catch { return []; }
  }

  listFiles() {
    try {
      return fs.readdirSync(PATHS.log).filter((f) => f.endsWith('.log')).map((f) => {
        const st = fs.statSync(path.join(PATHS.log, f));
        return { name: f, size: st.size, at: st.mtimeMs };
      }).sort((a, b) => b.at - a.at);
    } catch { return []; }
  }

  close() {
    if (this.stream) { try { this.stream.end(); } catch { /* ignore */ } this.stream = null; }
  }
}

export const logger = new Logger();
export default logger;
