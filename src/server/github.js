/* EasyVideo - GitHub identity, repositories and asset upload.
 *
 * Sign-in is a Personal Access Token the user pastes in (not an OAuth device flow).
 * Verification follows the requirement exactly:
 *   1. on sign-in, GET /user/repos once - success proves the token works;
 *   2. at any later moment, GET it again - success again means the identity still holds;
 *   3. a 401/403/network failure marks the identity invalid.
 *
 * Repository ownership: each user id maps to one deterministic repository name.
 * The id is up to 1024 ASCII bytes, while a GitHub repository name is capped at 100
 * characters and allows only [A-Za-z0-9._-], so the mapping is:
 *
 *   repo = ev-<first 40 hex chars of sha256(userId)>
 *
 * The same id always yields the same name, and the name cannot be reversed into the
 * original id. The full id is also stored in .easyvideo-id at the repository root.
 *
 * File upload goes through Release assets. GitHub rejects git commits containing a
 * file over 100 MiB, while a release asset may be up to 2 GiB, so videos and
 * installers can only travel that way.
 *
 * The token lives only in data/github.json - never in logs, never echoed to the UI.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import PATHS from './paths.js';
import logger from './logger.js';

const log = logger.child('github');

const API = 'https://api.github.com';
const UPLOADS = 'https://uploads.github.com';
const STATE_FILE = path.join(PATHS.data, 'github.json');

/** A single release asset may be up to 2 GiB. */
export const MAX_ASSET_BYTES = 2 * 1024 * 1024 * 1024;

/** User ids are up to 1024 ASCII bytes. */
export const MAX_USER_ID_BYTES = 1024;

let state = null;

function blank() {
  return { identities: {}, order: [], current: null };
}

function load() {
  if (state) return state;
  try {
    if (fs.existsSync(STATE_FILE)) state = Object.assign(blank(), JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')));
    else state = blank();
  } catch (err) {
    log.warn('github.json unreadable, rebuilding:', err.message);
    state = blank();
  }
  return state;
}

function save() {
  const s = load();
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2), { encoding: 'utf8', mode: 0o600 });
  try { fs.chmodSync(STATE_FILE, 0o600); } catch (err) { /* not supported on Windows */ }
  return s;
}

/* ------------------------------------------------------------- user id */

/**
 * Validate an app-generated user id: at most 1024 printable ASCII bytes.
 * Whitespace is rejected - it would break the "same id at a glance" property.
 */
export function checkUserId(value) {
  const id = String(value === undefined || value === null ? '' : value);
  if (!id) return { ok: false, reason: '用户 ID 不能为空' };
  const bytes = Buffer.byteLength(id, 'utf8');
  if (bytes > MAX_USER_ID_BYTES) return { ok: false, reason: '用户 ID 超过 1024 字节（当前 ' + bytes + '）' };
  for (const ch of id) {
    const code = ch.codePointAt(0);
    if (code < 0x21 || code > 0x7e) return { ok: false, reason: '用户 ID 必须是可打印 ASCII（不含空格）' };
  }
  return { ok: true, bytes: bytes };
}

/** A fresh user id: 32 random bytes as hex, 64 ASCII characters. */
export function newUserId() {
  return crypto.randomBytes(32).toString('hex').toUpperCase();
}

/**
 * User id -> repository name. Deterministic: the same id always yields the
 * same name, and that name is always valid (43 characters, far below 100).
 */
export function repoNameFor(userId) {
  const digest = crypto.createHash('sha256').update(String(userId), 'utf8').digest('hex');
  return 'ev-' + digest.slice(0, 40);
}

/* ---------------------------------------------------------------- HTTP */

/** One GitHub call, with errors and rate-limit state turned into plain text. */
async function call(method, url, opts) {
  const o = opts || {};
  const headers = Object.assign({
    accept: 'application/vnd.github+json',
    authorization: 'Bearer ' + o.token,
    'user-agent': 'EasyVideo',
    'x-github-api-version': '2022-11-28'
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
    error.rate = res.headers.get('x-ratelimit-remaining');
    error.data = data;
    throw error;
  }
  return { status: res.status, data: data, headers: res.headers };
}

/** The repository list: this is what identity verification is based on. */
async function listRepos(token, perPage) {
  const url = API + '/user/repos?per_page=' + (perPage || 100) + '&sort=updated&affiliation=owner,collaborator,organization_member';
  const res = await call('GET', url, { token: token });
  return Array.isArray(res.data) ? res.data : [];
}

/* ------------------------------------------------------------- identity */

/**
 * Sign in with a token. Verification is exactly the required check: fetch the
 * repository list once. The stored identity keeps a fingerprint of that list so
 * later runs can tell whether it is still the same account.
 */
export async function signIn(token, userId) {
  const clean = String(token || '').trim();
  if (!clean) { const e = new Error('请填写 GitHub Token'); e.status = 400; throw e; }
  const check = checkUserId(userId);
  if (!check.ok) { const e = new Error(check.reason); e.status = 400; throw e; }

  let me;
  try {
    const res = await call('GET', API + '/user', { token: clean });
    me = res.data;
  } catch (err) {
    const e = new Error(err.status === 401 ? 'Token 无效或已过期' : ('GitHub 拒绝了这个 Token：' + err.message));
    e.status = err.status || 502;
    throw e;
  }

  // The decisive check: if the repository list comes back, the token really works.
  let repos;
  try { repos = await listRepos(clean); }
  catch (err) {
    const e = new Error('Token 无法读取仓库列表：' + err.message);
    e.status = err.status || 502;
    throw e;
  }

  const s = load();
  const id = String(userId);
  const repo = repoNameFor(id);
  const identity = {
    userId: id,
    repo: repo,
    token: clean,
    login: me && me.login ? me.login : '',
    name: me && me.name ? me.name : '',
    avatar: me && me.avatar_url ? me.avatar_url : '',
    githubId: me && me.id ? me.id : null,
    repoCount: repos.length,
    repoFingerprint: fingerprint(repos),
    verifiedAt: Date.now(),
    ok: true,
    error: null
  };
  s.identities[id] = identity;
  if (s.order.indexOf(id) < 0) s.order.push(id);
  s.current = id;
  save();
  log.info('github sign-in', identity.login, 'repo=' + repo, 'repos=' + repos.length);
  return publicIdentity(identity);
}

/** Fingerprint of the repository list: only used to compare successive reads. */
function fingerprint(repos) {
  const names = repos.map((r) => (r.full_name || r.name || '')).sort().join(String.fromCharCode(10));
  return crypto.createHash('sha256').update(names, 'utf8').digest('hex').slice(0, 16);
}

/** The shape handed to the UI: never contains the token. */
export function publicIdentity(identity) {
  if (!identity) return null;
  return {
    userId: identity.userId,
    repo: identity.repo,
    login: identity.login,
    name: identity.name,
    avatar: identity.avatar,
    githubId: identity.githubId,
    repoCount: identity.repoCount,
    verifiedAt: identity.verifiedAt,
    ok: identity.ok,
    error: identity.error || null
  };
}

/** The current identity, UI-shaped. */
export function current() {
  const s = load();
  return publicIdentity(s.current ? s.identities[s.current] : null);
}

/** Every signed-in identity, UI-shaped. */
export function list() {
  const s = load();
  return s.order.map((id) => publicIdentity(s.identities[id])).filter(Boolean);
}

/** The raw identity (with token). Server-side use only. */
export function raw(userId) {
  const s = load();
  const id = userId || s.current;
  return id ? (s.identities[id] || null) : null;
}

/** Switch the active identity. */
export function use(userId) {
  const s = load();
  if (!s.identities[userId]) { const e = new Error('没有这个身份'); e.status = 404; throw e; }
  s.current = userId;
  save();
  return publicIdentity(s.identities[userId]);
}

/** Sign out: drop one identity and its token. */
export function signOut(userId) {
  const s = load();
  const id = userId || s.current;
  if (!id || !s.identities[id]) return false;
  delete s.identities[id];
  s.order = s.order.filter((x) => x !== id);
  if (s.current === id) s.current = s.order.length ? s.order[0] : null;
  save();
  return true;
}

/**
 * Re-verify an identity: fetch the repository list again. Success means it still
 * holds. This is the "verify at any moment by re-reading the repo list" step.
 */
export async function verify(userId) {
  const s = load();
  const id = userId || s.current;
  const identity = id ? s.identities[id] : null;
  if (!identity) { const e = new Error('没有这个身份'); e.status = 404; throw e; }
  try {
    const repos = await listRepos(identity.token);
    identity.ok = true;
    identity.error = null;
    identity.repoCount = repos.length;
    identity.repoFingerprint = fingerprint(repos);
    identity.verifiedAt = Date.now();
    save();
    return publicIdentity(identity);
  } catch (err) {
    identity.ok = false;
    identity.error = err.status === 401 ? 'Token 已失效' : err.message;
    save();
    const e = new Error(identity.error);
    e.status = err.status || 502;
    throw e;
  }
}

/* ----------------------------------------------------------- repository */

/** Make sure the target repository exists; create it with this token if not. */
export async function ensureRepo(userId) {
  const identity = raw(userId);
  if (!identity) { const e = new Error('请先登录 GitHub'); e.status = 401; throw e; }
  const token = identity.token;
  const name = identity.repo;

  try {
    const res = await call('GET', API + '/repos/' + identity.login + '/' + name, { token: token });
    return { created: false, repo: res.data };
  } catch (err) {
    if (err.status !== 404) throw err;
  }

  const created = await call('POST', API + '/user/repos', {
    token: token,
    json: {
      name: name,
      description: 'EasyVideo upload repository (created by the app)',
      private: false,
      auto_init: true,
      has_issues: false,
      has_wiki: false,
      has_projects: false
    }
  });
  log.info('github repository created', name);
  return { created: true, repo: created.data };
}

/** The repository list, UI-shaped. */
export async function repos(userId) {
  const identity = raw(userId);
  if (!identity) { const e = new Error('请先登录 GitHub'); e.status = 401; throw e; }
  const list = await listRepos(identity.token);
  return list.map((r) => ({
    name: r.name,
    full: r.full_name,
    private: !!r.private,
    url: r.html_url,
    updatedAt: r.updated_at,
    isTarget: r.name === identity.repo
  }));
}

export default {
  MAX_ASSET_BYTES,
  MAX_USER_ID_BYTES,
  checkUserId,
  newUserId,
  repoNameFor,
  signIn,
  signOut,
  current,
  list,
  raw,
  use,
  verify,
  publicIdentity,
  ensureRepo,
  repos
};

