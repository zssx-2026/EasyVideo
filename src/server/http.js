import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import PATHS, { IS_SEA } from './paths.js';
import { log } from './util.js';
import { EMBEDDED as EMBEDDED_ASSETS } from './assets.generated.js';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.m3u8': 'application/vnd.apple.mpegurl',
  '.ts': 'video/mp2t',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8'
};

export const mimeFor = (file) => MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';

/** Bake-time asset table (tools/gen-assets.mjs). Static import keeps the bundle CJS-safe. */
let embedded = null;
try {
  embedded = EMBEDDED_ASSETS || null;
} catch {
  embedded = null;
}

export function setEmbeddedAssets(table) { embedded = table; }

function embeddedRead(urlPath) {
  if (!embedded) return null;
  const key = urlPath.replace(/^\/+/, '') || 'index.html';
  const entry = embedded[key] || embedded[key + '/index.html'];
  if (!entry) return null;
  const raw = Buffer.from(entry.data, 'base64');
  return { buffer: entry.gz ? zlib.gunzipSync(raw) : raw, mime: entry.mime || mimeFor(key) };
}

export function readAsset(urlPath) {
  const clean = path.normalize(urlPath).replace(/^([.]{2}[\/\\])+/, '');
  const disk = path.join(PATHS.web, clean);
  if (disk.startsWith(PATHS.web) && fs.existsSync(disk) && fs.statSync(disk).isFile()) {
    return { buffer: fs.readFileSync(disk), mime: mimeFor(disk), source: 'disk' };
  }
  const emb = embeddedRead(urlPath);
  if (emb) return Object.assign(emb, { source: 'embedded' });
  return null;
}

export class Response {
  constructor(res) {
    this.res = res;
    this.sent = false;
    res.setHeader('X-Powered-By', 'EasyVideo');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'content-type,x-ev-account');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  }
  status(code) { this.res.statusCode = code; return this; }
  header(k, v) { this.res.setHeader(k, v); return this; }
  json(value, code) {
    if (this.sent) return;
    this.sent = true;
    const body = Buffer.from(JSON.stringify(value), 'utf8');
    this.res.writeHead(code || this.res.statusCode || 200, {
      'content-type': 'application/json; charset=utf-8',
      'content-length': body.length,
      'cache-control': 'no-store'
    });
    this.res.end(body);
  }
  text(value, code) {
    if (this.sent) return;
    this.sent = true;
    const body = Buffer.from(String(value), 'utf8');
    this.res.writeHead(code || 200, { 'content-type': 'text/plain; charset=utf-8', 'content-length': body.length });
    this.res.end(body);
  }
  buffer(buf, mime, extra) {
    if (this.sent) return;
    this.sent = true;
    this.res.writeHead(200, Object.assign({
      'content-type': mime || 'application/octet-stream',
      'content-length': buf.length
    }, extra || {}));
    this.res.end(buf);
  }
  notFound(msg) { this.json({ ok: false, error: msg || 'not found' }, 404); }
  fail(err, code) {
    const message = err && err.message ? err.message : String(err);
    log('http error:', message);
    this.json({ ok: false, error: message }, code || 500);
  }
  stream(buffer, mime, filename) {
    if (this.sent) return;
    this.sent = true;
    this.res.writeHead(200, {
      'content-type': mime || 'application/octet-stream',
      'content-length': buffer.length,
      'content-disposition': 'attachment; filename="' + encodeURIComponent(filename || 'download.bin') + '"'
    });
    this.res.end(buffer);
  }
}

/** Tiny trie-free router: exact paths plus :param segments. */
export class Router {
  constructor() { this.routes = []; }
  add(method, pattern, handler) {
    const parts = pattern.split('/').filter(Boolean);
    const route = { method: method.toUpperCase(), parts, handler, pattern, stream: false };
    this.routes.push(route);
    return route;
  }
  get(p, h) { return this.add('GET', p, h); }
  post(p, h) { return this.add('POST', p, h); }
  put(p, h) { return this.add('PUT', p, h); }
  patch(p, h) { return this.add('PATCH', p, h); }

  /**
   * Like post(), but the body is NOT buffered: the handler reads req itself.
   * Required for uploads, which routinely exceed the 2 GiB Buffer ceiling.
   */
  streamPost(p, h) { return this.stream('POST', p, h); }

  stream(method, pattern, handler) {
    const route = this.add(method, pattern, handler);
    if (route) route.stream = true;
    return route;
  }

  del(p, h) { return this.add('DELETE', p, h); }
  any(p, h) { return this.add('*', p, h); }

  match(method, pathname) {
    const segs = pathname.split('/').filter(Boolean);
    for (const route of this.routes) {
      if (route.method !== '*' && route.method !== method) continue;
      if (route.parts.length !== segs.length) continue;
      const params = {};
      let ok = true;
      for (let i = 0; i < route.parts.length; i++) {
        const p = route.parts[i];
        if (p.startsWith(':')) params[p.slice(1)] = decodeURIComponent(segs[i]);
        else if (p !== segs[i]) { ok = false; break; }
      }
      if (ok) return { route, params };
    }
    return null;
  }
}

/**
 * Node cannot build a single Buffer larger than 2 GiB - 1, so anything that
 * might be bigger has to stream to disk instead (see /api/upload).
 */
export const MAX_BUFFERED_BYTES = 512 * 1024 * 1024;

export class BodyTooLarge extends Error {
  constructor(size, cap) {
    super('请求体过大：' + (size / 1048576).toFixed(0) + ' MiB，上限 ' + (cap / 1048576).toFixed(0) + ' MiB');
    this.name = 'BodyTooLarge';
    this.status = 413;
  }
}

export async function readBody(req, limitBytes) {
  const declared = Number(req.headers['content-length'] || 0);
  const cap = Math.min(limitBytes || MAX_BUFFERED_BYTES, MAX_BUFFERED_BYTES);
  if (declared > cap) throw new BodyTooLarge(declared, cap);
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > cap) throw new BodyTooLarge(size, cap);
    chunks.push(chunk);
  }
  if (!chunks.length) return null;
  return Buffer.concat(chunks);
}

/**
 * Stream a request body straight to disk. Never buffers, so uploads are not
 * limited by the 2 GiB Buffer ceiling.
 * Returns { bytes, sha256 }.
 */
export async function pipeBodyToFile(req, file, capBytes) {
  const cap = Number(capBytes) || Infinity;
  const declared = Number(req.headers['content-length'] || 0);
  if (declared && declared > cap) { const e = new Error('文件过大'); e.status = 413; throw e; }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const hash = crypto.createHash('sha256');
  const out = fs.createWriteStream(file);
  let bytes = 0;
  try {
    for await (const chunk of req) {
      bytes += chunk.length;
      if (bytes > cap) { const e = new Error('文件过大'); e.status = 413; throw e; }
      hash.update(chunk);
      if (!out.write(chunk)) await new Promise(function (r) { out.once('drain', r); });
    }
    await new Promise(function (r) { out.end(r); });
  } catch (err) {
    try { out.destroy(); } catch (e) { /* ignore */ }
    try { fs.rmSync(file, { force: true }); } catch (e) { /* ignore */ }
    throw err;
  }
  return { bytes: bytes, sha256: hash.digest('hex') };
}

export async function readJson(req, limitBytes) {
  const buf = await readBody(req, limitBytes || 4 * 1024 * 1024);
  if (!buf) return {};
  try { return JSON.parse(buf.toString('utf8')); } catch { throw new Error('invalid JSON body'); }
}

export function serveAsset(res, urlPath) {
  const asset = readAsset(urlPath);
  if (!asset) return false;
  const etag = '"' + asset.buffer.length.toString(16) + '-' + asset.mime.length.toString(16) + '"';
  const headers = { 'cache-control': 'no-cache', etag };
  if (/[.](js|css|html)$/.test(urlPath)) headers['cache-control'] = 'no-store';
  res.buffer(asset.buffer, asset.mime, headers);
  return true;
}

export const seaInfo = () => ({ isSea: IS_SEA, embedded: embedded ? Object.keys(embedded).length : 0 });

export default { Router, Response, readJson, readBody, serveAsset, readAsset, mimeFor, seaInfo, setEmbeddedAssets };
