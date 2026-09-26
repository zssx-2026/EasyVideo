/* EasyVideo - upload arbitrary files to the user GitHub repository.
 *
 * Every user uploads through this module. The file is streamed to disk first,
 * then pushed as a Release asset of that user repository. Git commits are not
 * used: GitHub rejects a commit containing a file over 100 MiB, while a release
 * asset may be 2 GiB.
 *
 * Progress lives in memory and is surfaced through the API so the UI can draw a
 * bar without polling GitHub.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import PATHS from './paths.js';
import logger from './logger.js';
import * as github from './github.js';

const log = logger.child('upload');

const API = 'https://api.github.com';
const UPLOADS = 'https://uploads.github.com';

const jobs = new Map();
const order = [];

function remember(job) {
  jobs.set(job.id, job);
  order.unshift(job.id);
  while (order.length > 60) { const drop = order.pop(); jobs.delete(drop); }
  return job;
}

export function jobList(limit) {
  return order.slice(0, limit || 20).map((id) => jobs.get(id)).filter(Boolean);
}

export function jobById(id) { return jobs.get(id) || null; }

export function stagingDir() { return path.join(PATHS.cache, 'github-uploads'); }

function stamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return String(d.getFullYear()) + pad(d.getMonth() + 1) + pad(d.getDate());
}

/** One GitHub call, with the same error shaping as github.js. */
async function call(method, url, opts) {
  const o = opts || {};
  const headers = Object.assign({
    accept: 'application/vnd.github+json',
    authorization: 'Bearer ' + o.token,
    'user-agent': 'EasyVideo'
  }, o.headers || {});
  if (o.json !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(url, {
    method: method,
    headers: headers,
    body: o.json !== undefined ? JSON.stringify(o.json) : o.body
  });
  const text = await res.text();
  let data = null;
  if (text) { try { data = JSON.parse(text); } catch (err) { data = text; } }
  if (!res.ok) {
    const why = (data && data.message) || ('HTTP ' + res.status);
    const error = new Error(why);
    error.status = res.status;
    throw error;
  }
  return data;
}

/** Find or create the release that will hold the asset. */
async function ensureRelease(identity, tag, title, notes) {
  const base = API + '/repos/' + identity.login + '/' + identity.repo;
  try {
    return await call('GET', base + '/releases/tags/' + encodeURIComponent(tag), { token: identity.token });
  } catch (err) {
    if (err.status !== 404) throw err;
  }
  return call('POST', base + '/releases', {
    token: identity.token,
    json: {
      tag_name: tag,
      name: title,
      body: notes || '',
      draft: false,
      prerelease: false
    }
  });
}

/** Compute sha256 of a file without loading it whole. */
function hashFile(file) {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.allocUnsafe(1024 * 1024);
  try {
    for (;;) {
      const read = fs.readSync(fd, buf, 0, buf.length, null);
      if (!read) break;
      hash.update(buf.subarray(0, read));
    }
  } finally { fs.closeSync(fd); }
  return hash.digest('hex');
}

/**
 * Push one file as a release asset. Returns the asset record.
 * The body is read from disk as a stream so a multi-gigabyte file never
 * sits in memory.
 */
async function putAsset(identity, release, file, name) {
  const size = fs.statSync(file).size;
  const endpoint = UPLOADS + '/repos/' + identity.login + '/' + identity.repo
    + '/releases/' + release.id + '/assets?name=' + encodeURIComponent(name);
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      accept: 'application/vnd.github+json',
      authorization: 'Bearer ' + identity.token,
      'content-type': 'application/octet-stream',
      'content-length': String(size),
      'user-agent': 'EasyVideo'
    },
    body: fs.createReadStream(file),
    duplex: 'half'
  });
  const text = await res.text();
  let data = null;
  if (text) { try { data = JSON.parse(text); } catch (err) { data = text; } }
  if (!res.ok) {
    const why = (data && data.message) || ('HTTP ' + res.status);
    const error = new Error(why);
    error.status = res.status;
    throw error;
  }
  return data;
}

/**
 * Stage an incoming request body to disk. Never buffers, so a user can push a
 * file far beyond the 2 GiB Buffer ceiling.
 */
export async function stage(req, originalName) {
  const dir = stagingDir();
  fs.mkdirSync(dir, { recursive: true });
  const safe = String(originalName || 'upload.bin').replace(/[^A-Za-z0-9_.-]/g, '_');
  const id = crypto.randomBytes(8).toString('hex');
  const file = path.join(dir, Date.now().toString(36) + '-' + id + '-' + safe);
  const out = fs.createWriteStream(file);
  let bytes = 0;
  try {
    for await (const chunk of req) {
      bytes += chunk.length;
      if (bytes > github.MAX_ASSET_BYTES) { const e = new Error('文件超过 2 GiB 的 Release 资产上限'); e.status = 413; throw e; }
      if (!out.write(chunk)) await new Promise(function (r) { out.once('drain', r); });
    }
    await new Promise(function (r) { out.end(r); });
  } catch (err) {
    try { out.destroy(); } catch (e) { /* ignore */ }
    try { fs.rmSync(file, { force: true }); } catch (e) { /* ignore */ }
    throw err;
  }
  return { file: file, bytes: bytes, name: safe };
}

/**
 * The whole upload: stage -> ensure repo -> ensure release -> put asset.
 * Returns the finished job record.
 */
export async function push(staged, opts) {
  const o = opts || {};
  const identity = github.raw(o.userId);
  if (!identity) { const e = new Error('请先登录 GitHub'); e.status = 401; throw e; }
  if (!identity.ok) { const e = new Error('GitHub 身份已失效，请重新登录'); e.status = 401; throw e; }

  const job = remember({
    id: crypto.randomBytes(6).toString('hex'),
    name: staged.name,
    bytes: staged.bytes,
    sent: 0,
    phase: 'repo',
    ok: false,
    error: null,
    repo: identity.repo,
    login: identity.login,
    tag: null,
    url: null,
    sha256: null,
    startedAt: Date.now(),
    finishedAt: null
  });

  try {
    job.phase = 'repo';
    await github.ensureRepo(o.userId);

    job.phase = 'hash';
    job.sha256 = hashFile(staged.file);

    job.phase = 'release';
    const tag = 'upload-' + stamp() + '-' + job.id;
    const notes = ['EasyVideo 上传', '', '文件：' + staged.name, '大小：' + staged.bytes + ' 字节', 'SHA-256：' + job.sha256].join(String.fromCharCode(10));
    const release = await ensureRelease(identity, tag, 'EasyVideo 上传 ' + staged.name, notes);
    job.tag = tag;

    job.phase = 'upload';
    const asset = await putAsset(identity, release, staged.file, staged.name);
    job.sent = staged.bytes;
    job.url = asset && asset.browser_download_url ? asset.browser_download_url : null;
    job.phase = 'done';
    job.ok = true;
    job.finishedAt = Date.now();
    log.info('github upload ok', staged.name, staged.bytes, '->', identity.repo);
    return job;
  } catch (err) {
    job.phase = 'failed';
    job.ok = false;
    job.error = err.message;
    job.finishedAt = Date.now();
    log.warn('github upload failed', staged.name, err.message);
    throw err;
  } finally {
    try { fs.rmSync(staged.file, { force: true }); } catch (err) { /* ignore */ }
  }
}

export default {
  stagingDir,
  stage,
  push,
  jobList,
  jobById
};

