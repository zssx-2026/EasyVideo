/* EasyVideo - small shared helpers. */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { logger } from './logger.js';

export const now = () => Date.now();

export function uid(prefix) {
  const s = crypto.randomBytes(9).toString('base64url');
  return (prefix ? prefix + '_' : '') + s;
}

/** PID: any-length printable ASCII, max 64, no path separators. */
const PID_BAD = new Set(['/', '\\', ' ', '?', '#', '%']);

export function pidOk(value) {
  const text = String(value === undefined || value === null ? '' : value);
  if (!text || text.length > 64) return false;
  for (const ch of text) {
    const code = ch.codePointAt(0);
    if (code < 0x21 || code > 0x7e) return false;
    if (PID_BAD.has(ch)) return false;
  }
  return true;
}

/** Auto PID: 8 chars, no look-alike letters. */
export function pid6() {
  const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  const b = crypto.randomBytes(8);
  let out = '';
  for (let i = 0; i < 8; i++) out += alphabet[b[i] % alphabet.length];
  return out;
}

/** PIDs travel in URLs as base64url, so no escaping is ever needed. */
export function pidPath(pid) {
  return Buffer.from(String(pid === undefined || pid === null ? '' : pid), 'utf8').toString('base64url');
}

/**
 * Decode a PID from a URL segment. Anything that round-trips as printable
 * ASCII is accepted verbatim, so old unencoded links keep working.
 */
export function pidFromPath(token) {
  const text = String(token === undefined || token === null ? '' : token);
  if (!text) return '';
  try {
    const decoded = Buffer.from(text, 'base64url').toString('utf8');
    if (decoded && pidOk(decoded)) return decoded;
  } catch (err) { /* not base64 at all */ }
  return pidOk(text) ? text : '';
}



export const b64 = (s) => Buffer.from(String(s), 'utf8').toString('base64');
export const unb64 = (s) => Buffer.from(String(s), 'base64').toString('utf8');
export const b64u = (s) => Buffer.from(String(s), 'utf8').toString('base64url');
export const unb64u = (s) => Buffer.from(String(s), 'base64url').toString('utf8');

export function hashPassword(password, salt) {
  const s = salt || crypto.randomBytes(16).toString('hex');
  const h = crypto.scryptSync(String(password), s, 32, { N: 16384, r: 8, p: 1 }).toString('hex');
  return { salt: s, hash: h };
}

export function verifyPassword(password, salt, expected) {
  try {
    const h = crypto.scryptSync(String(password), salt, 32, { N: 16384, r: 8, p: 1 }).toString('hex');
    return crypto.timingSafeEqual(Buffer.from(h, 'hex'), Buffer.from(expected, 'hex'));
  } catch { return false; }
}

export const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

export function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

export function writeJsonAtomic(file, value) {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, '.' + path.basename(file) + '.' + process.pid + '.tmp');
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
  try { fs.renameSync(tmp, file); }
  catch { try { fs.rmSync(file, { force: true }); } catch (e) { /* ignore */ } fs.renameSync(tmp, file); }
}

export function moveToRecycle(file, recycleRoot, tag) {
  try {
    if (!fs.existsSync(file)) return null;
    fs.mkdirSync(recycleRoot, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const dest = path.join(recycleRoot, stamp + '__' + (tag || path.basename(file)));
    fs.renameSync(file, dest);
    return dest;
  } catch { return null; }
}

const BAD = String.fromCharCode(92) + '/:*?<>|';

export function safeName(name, fallback) {
  const src = String(name == null ? '' : name);
  let out = '';
  for (const ch of src) {
    const c = ch.codePointAt(0);
    if (c < 32 || c === 127) continue;
    out += BAD.includes(ch) ? '_' : ch;
  }
  out = out.trim();
  return out || (fallback || 'untitled');
}

const PAD = (n, wdt) => String(Math.abs(n)).padStart(wdt, '0');

function isoWeek(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t - yearStart) / 86400000 + 1) / 7);
}

function tzOffset(d) {
  const m = -d.getTimezoneOffset();
  const sign = m >= 0 ? '+' : '-';
  return sign + PAD(Math.floor(Math.abs(m) / 60), 2) + PAD(Math.abs(m) % 60, 2);
}

/** Recording file-name template: %CCYY %MM %DD %WW %HH %mm %SS %NUM %UN %P %Z */
export function formatRecordingName(template, ctx) {
  const c = ctx || {};
  const d = c.date instanceof Date ? c.date : new Date();
  const h24 = d.getHours();
  const map = {
    '%CCYY': String(d.getFullYear()),
    '%YY': PAD(d.getFullYear() % 100, 2),
    '%MM': PAD(d.getMonth() + 1, 2),
    '%DD': PAD(d.getDate(), 2),
    '%WW': PAD(isoWeek(d), 2),
    '%HH': PAD(h24, 2),
    '%hh': PAD(((h24 + 11) % 12) + 1, 2),
    '%mm': PAD(d.getMinutes(), 2),
    '%SS': PAD(d.getSeconds(), 2),
    '%NUM': PAD(Number(c.index) || 1, 3),
    '%UN': safeName(c.username || 'user', 'user'),
    '%P': h24 < 12 ? 'AM' : 'PM',
    '%Z': tzOffset(d)
  };
  let out = String(template || '%CCYY-%MM-%DD_%HH-%mm-%SS');
  for (const k of Object.keys(map)) out = out.split(k).join(map[k]);
  return safeName(out, 'recording');
}

export function log(...args) {
  logger.info(...args);
}

export function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
