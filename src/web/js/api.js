/* EasyVideo - api.js
 * The single network seam. Every request in the app goes through request().
 * It owns: the x-ev-account header, JSON envelopes, error toasts, the global
 * busy counter, uploads with progress, and the WebSocket hub connection.
 */

import { toast, setBusy } from './ui.js';

export const ORIGIN = location.origin;

const BASE = ORIGIN + '/api';

let accountId = null;

export function setAccountId(id) { accountId = id || null; }

export const getAccountId = () => accountId;

export class ApiError extends Error {
  constructor(message, status, payload) {
    super(message);
    this.name = 'ApiError';
    this.status = status || 0;
    this.payload = payload || null;
  }
}

/** Normalise a payload into a plain string message. */
function messageOf(payload, status) {
  if (payload && typeof payload === 'object') {
    if (payload.error) return String(payload.error);
    if (payload.message) return String(payload.message);
  }
  if (typeof payload === 'string' && payload.trim()) return payload.trim().slice(0, 300);
  return 'HTTP ' + status;
}

/**
 * One fetch helper for the whole app.
 *   opts.method   GET/POST/PATCH/DELETE
 *   opts.body     JSON-serialisable payload (or a raw BodyInit via opts.raw)
 *   opts.raw      send opts.body verbatim (uploads)
 *   opts.quiet    suppress the error toast
 *   opts.silent   suppress the global busy meter
 *   opts.timeout  ms, default 30000
 */
export async function request(path, opts) {
  const o = opts || {};
  const method = (o.method || 'GET').toUpperCase();
  const url = path.startsWith('http') ? path : BASE + path;
  const headers = Object.assign({}, o.headers || {});
  let body;
  if (o.body !== undefined && o.body !== null) {
    if (o.raw) { body = o.body; }
    else { headers['content-type'] = 'application/json'; body = JSON.stringify(o.body); }
  }
  if (accountId) headers['x-ev-account'] = accountId;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), o.timeout || 30000);
  if (!o.silent) setBusy(1);
  try {
    const res = await fetch(url, { method, headers, body, signal: controller.signal, credentials: 'same-origin' });
    const text = await res.text();
    let data = null;
    if (text) { try { data = JSON.parse(text); } catch { data = text; } }
    if (!res.ok) throw new ApiError(messageOf(data, res.status), res.status, data);
    if (data && typeof data === 'object' && data.ok === false) throw new ApiError(messageOf(data, res.status), res.status, data);
    return data;
  } catch (err) {
    let failure = err;
    if (err && err.name === 'AbortError') failure = new ApiError('请求超时，请稍后重试', 0, null);
    else if (!(err instanceof ApiError)) failure = new ApiError('无法连接服务器：' + (err && err.message ? err.message : '网络错误'), 0, null);
    if (!o.quiet) toast(failure.message, 'err');
    throw failure;
  } finally {
    clearTimeout(timer);
    if (!o.silent) setBusy(-1);
  }
}

const q = (params) => {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) {
    if (v === undefined || v === null || v === '') continue;
    sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? '?' + s : '';
};

/*
 * GitHub 上传用 XHR 而不是 fetch：只有 XHR 能报上传进度。
 * 这里同样绕开 JSON —— 文件按原始字节发过去。
 */
function uploadWithProgress(file, userId, onProgress) {
  return new Promise(function (resolve, reject) {
    const xhr = new XMLHttpRequest();
    const url = BASE + '/github/upload?name=' + encodeURIComponent(file.name) + q({ userId: userId });
    xhr.open('POST', url, true);
    xhr.setRequestHeader('content-type', 'application/octet-stream');
    if (accountId) xhr.setRequestHeader('x-ev-account', accountId);
    xhr.upload.onprogress = function (ev) {
      if (ev.lengthComputable && onProgress) onProgress(ev.loaded, ev.total);
    };
    xhr.onload = function () {
      let data = null;
      try { data = xhr.responseText ? JSON.parse(xhr.responseText) : null; } catch (err) { data = xhr.responseText; }
      if (xhr.status >= 200 && xhr.status < 300 && data && data.ok) { resolve(data); return; }
      const message = (data && (data.error || data.message)) || ('HTTP ' + xhr.status);
      reject(new ApiError(message, xhr.status, data));
    };
    xhr.onerror = function () { reject(new ApiError('上传失败：网络错误', 0, null)); };
    xhr.send(file);
  });
}
/* ------------------------------------------------------------- endpoints */

export const api = {
  bootstrap: () => request('/bootstrap'),

  accounts: () => request('/accounts'),
  createAccount: (body) => request('/accounts', { method: 'POST', body }),
  switchAccount: (id) => request('/accounts/' + encodeURIComponent(id) + '/switch', { method: 'POST' }),
  login: (body) => request('/accounts/login', { method: 'POST', body }),
  deleteAccount: (id) => request('/accounts/' + encodeURIComponent(id), { method: 'DELETE' }),

  me: () => request('/me'),
  patchMe: (body) => request('/me', { method: 'PATCH', body }),
  privacy: () => request('/me/privacy'),
  patchPrivacy: (body) => request('/me/privacy', { method: 'PATCH', body }),

  settings: () => request('/settings'),
  patchSettings: (body) => request('/settings', { method: 'PATCH', body }),
  exportSettingsUrl: (models) => BASE + '/settings/export' + q({ download: 1, models: models ? 1 : 0 }),
  exportSettings: (models) => request('/settings/export' + q({ models: models ? 1 : 0 })),
  importSettings: (payload, mergeSocial) => request('/settings/import', { method: 'POST', body: { payload, mergeSocial: mergeSocial !== false } }),

  live: (params) => request('/live' + q(params)),
  createLive: (body) => request('/live', { method: 'POST', body }),
  room: (nick, pid) => request('/live/' + encodeURIComponent(nick) + '/' + encodeURIComponent(pid)),
  endLive: (id) => request('/live/' + encodeURIComponent(id) + '/end', { method: 'POST' }),
  joinLive: (id) => request('/live/' + encodeURIComponent(id) + '/join', { method: 'POST' }),

  videos: (params) => request('/videos' + q(params)),
  createVideo: (body) => request('/videos', { method: 'POST', body }),
  video: (nick, pid) => request('/video/' + encodeURIComponent(nick) + '/' + encodeURIComponent(pid)),
  deleteVideo: (id) => request('/video/' + encodeURIComponent(id), { method: 'DELETE' }),

  drafts: () => request('/drafts'),
  createDraft: (body) => request('/drafts', { method: 'POST', body }),
  draft: (id) => request('/drafts/' + encodeURIComponent(id)),
  patchDraft: (id, body) => request('/drafts/' + encodeURIComponent(id), { method: 'PATCH', body }),
  deleteDraft: (id) => request('/drafts/' + encodeURIComponent(id), { method: 'DELETE' }),
  publishDraft: (id) => request('/drafts/' + encodeURIComponent(id) + '/publish', { method: 'POST' }),

  history: (params) => request('/history' + q(params)),
  later: (params) => request('/later' + q(params)),
  favorites: (params) => request('/favorites' + q(params)),
  friends: (params) => request('/friends' + q(params)),
  addItem: (kind, body) => request('/' + kind, { method: 'POST', body }),
  removeItem: (kind, id, all) => request('/' + kind + '/' + encodeURIComponent(id || 'all') + q(all ? { all: 1 } : null), { method: 'DELETE' }),
  clearItems: (kind) => request('/' + kind + '/all' + q({ all: 1 }), { method: 'DELETE' }),

  search: (kind, term) => request('/search' + q({ kind, q: term })),
  feedback: (body) => request('/search/feedback', { method: 'POST', body, quiet: true }),
  searchStats: () => request('/search/stats'),

  transport: () => request('/transport'),
  transportPlan: (viewers, bitrateKbps) => request('/transport/plan', { method: 'POST', body: { viewers, bitrateKbps } }),
  swarm: (streamId) => request('/transport/' + encodeURIComponent(streamId) + '/stats', { quiet: true }),
  segmentUrl: (streamId, index) => BASE + '/transport/segment/' + encodeURIComponent(streamId) + '/' + index,

  /** Raw-body upload with real progress. Returns the server file record. */
  upload: (file, dir, onProgress) => new Promise((resolve, reject) => {
    const url = BASE + '/upload' + q({ name: file.name, dir: dir || 'media' });
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url, true);
    xhr.setRequestHeader('content-type', 'application/octet-stream');
    if (accountId) xhr.setRequestHeader('x-ev-account', accountId);
    xhr.upload.onprogress = (ev) => { if (onProgress && ev.lengthComputable) onProgress(ev.loaded / ev.total, ev.loaded, ev.total); };
    xhr.onload = () => {
      let data = null;
      try { data = JSON.parse(xhr.responseText); } catch { data = null; }
      if (xhr.status >= 200 && xhr.status < 300 && data && data.ok) resolve(data.file);
      else { const msg = data && data.error ? data.error : 'HTTP ' + xhr.status; toast('上传失败：' + msg, 'err'); reject(new ApiError(msg, xhr.status, data)); }
    };
    xhr.onerror = () => { toast('上传失败：网络错误', 'err'); reject(new ApiError('网络错误', 0, null)); };
    xhr.send(file);
  }),

  runningApps: (term) => request('/apps/running' + q({ q: term }), { quiet: true }),
  appStatus: (image) => request('/apps/status' + q({ image }), { quiet: true }),
  knownApps: () => request('/apps/known', { quiet: true }),

  recordings: () => request('/recordings'),
  finalizeRecording: (body) => request('/recordings/finalize', { method: 'POST', body }),

  health: () => request('/health', { quiet: true }),
  backup: () => request('/maintenance/backup', { method: 'POST' }),


  /* ---- recommend / reactions / comments -------------------------------- */

  recommend: (kind, limit, exclude) => request('/recommend' + q({ kind: kind || 'video', limit: limit || 12, exclude: (exclude || []).join(',') }), { quiet: true }),
  recommendProfile: () => request('/recommend/profile', { quiet: true }),
  learn: (item, weight) => request('/recommend/learn', { method: 'POST', body: { item: item, weight: weight == null ? 1 : weight }, quiet: true }),
  forgetTaste: () => request('/recommend/forget', { method: 'POST', quiet: true }),

  reactions: (refId) => request('/reactions/' + encodeURIComponent(refId), { quiet: true }),
  react: (refId, kind, delta) => request('/reactions/' + encodeURIComponent(refId), { method: 'POST', body: { kind: kind, delta: delta == null ? 1 : delta }, quiet: true }),

  comments: (refId, limit) => request('/comments/' + encodeURIComponent(refId) + q({ limit: limit || 50 }), { quiet: true }),
  comment: (refId, text, kind) => request('/comments/' + encodeURIComponent(refId), { method: 'POST', body: { text: text, kind: kind || 'video' } }),
  likeComment: (refId, id) => request('/comments/' + encodeURIComponent(refId) + '/' + encodeURIComponent(id) + '/like', { method: 'POST', quiet: true }),
  deleteComment: (refId, id) => request('/comments/' + encodeURIComponent(refId) + '/' + encodeURIComponent(id), { method: 'DELETE' }),

  socialStats: () => request('/social/stats', { quiet: true }),

  /* ---- upload acceleration --------------------------------------------- */

  uploader: () => request('/uploader', { quiet: true }),
  configureUploader: (body) => request('/uploader/configure', { method: 'POST', body }),
  startUploader: (accelerator) => request('/uploader/start', { method: 'POST', body: { accelerator } }),
  stopUploader: (accelerator) => request('/uploader/stop', { method: 'POST', body: { accelerator } }),
  uploadPlan: (bytes) => request('/uploader/plan' + q({ bytes }), { quiet: true }),

  /* ---- transcoding ----------------------------------------------------- */

  ffmpeg: () => request('/ffmpeg', { quiet: true }),
  refreshFfmpeg: () => request('/ffmpeg/refresh', { method: 'POST', quiet: true }),
  ffmpegJobs: () => request('/ffmpeg/jobs', { quiet: true }),
  renderLadder: (body) => request('/ffmpeg/jobs', { method: 'POST', body }),
  cancelRender: (id) => request('/ffmpeg/jobs/' + encodeURIComponent(id), { method: 'DELETE' }),
  qualities: (videoId) => request('/qualities/' + encodeURIComponent(videoId), { quiet: true }),


  /* ---- plugins --------------------------------------------------------- */

  plugins: () => request('/plugins', { quiet: true }),
  pluginDirs: () => request('/plugins/dirs', { quiet: true }),
  deletePlugin: (name) => request('/plugins/' + encodeURIComponent(name), { method: 'DELETE' }),
  /** Build a .evp download URL for a plugin package object. */
  pluginBuildUrl: () => BASE + '/plugins/build',
  installPlugin: (file, onProgress) => new Promise((resolve, reject) => {
    const url = BASE + '/plugins/install' + q({ name: file.name });
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url, true);
    xhr.setRequestHeader('content-type', 'application/octet-stream');
    if (accountId) xhr.setRequestHeader('x-ev-account', accountId);
    xhr.upload.onprogress = (ev) => { if (onProgress && ev.lengthComputable) onProgress(ev.loaded / ev.total); };
    xhr.onload = () => {
      let data = null;
      try { data = JSON.parse(xhr.responseText); } catch (e) { data = null; }
      if (xhr.status >= 200 && xhr.status < 300 && data && data.ok) resolve(data);
      else { const msg = (data && data.error) || ('HTTP ' + xhr.status); toast('插件安装失败：' + msg, 'err'); reject(new ApiError(msg, xhr.status, data)); }
    };
    xhr.onerror = () => { toast('插件安装失败：网络错误', 'err'); reject(new ApiError('网络错误', 0, null)); };
    xhr.send(file);
  }),

  /** Stream a data URL / blob into the page as a download. */
  downloadPlugin: async (pkg, fileName) => {
    const res = await fetch(BASE + '/plugins/build', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: (pkg && pkg.name) || 'plugin', package: pkg })
    });
    if (!res.ok) throw new ApiError('打包失败 HTTP ' + res.status, res.status, null);
    return { blob: await res.blob(), codec: res.headers.get('x-ev-codec') || 'zstd', name: fileName || ((pkg && pkg.name) || 'plugin') + '.evp' };
  },
  /* 主题（可调界面主题 + 主题包）与自带组件 */
  /* ---- GitHub ---- */
  github: () => request('/github'),
  githubNewUserId: () => request('/github/userid/new', { method: 'POST' }),
  githubSignIn: (token, userId) => request('/github/signin', { method: 'POST', body: { token: token, userId: userId } }),
  githubVerify: (userId) => request('/github/verify', { method: 'POST', body: { userId: userId } }),
  githubUse: (userId) => request('/github/use', { method: 'POST', body: { userId: userId } }),
  githubSignOut: (userId) => request('/github/' + encodeURIComponent(userId), { method: 'DELETE' }),
  githubRepos: (userId) => request('/github/repos' + q({ userId: userId })),
  githubRepo: (userId) => request('/github/repo', { method: 'POST', body: { userId: userId } }),
  githubUploads: (limit) => request('/github/uploads' + q({ limit: limit })),
  githubUpload: (file, userId, onProgress) => uploadWithProgress(file, userId, onProgress),

  themes: () => request('/themes'),
  themeCssUrl: () => ORIGIN + '/api/themes/css',
  setTheme: (body) => request('/themes/configure', { method: 'POST', body }),
  removeTheme: (id) => request('/themes/' + encodeURIComponent(id), { method: 'DELETE' }),
  installTheme: async (file) => {
    const res = await fetch(BASE + '/themes/install?name=' + encodeURIComponent(file.name), {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: file
    });
    if (!res.ok) throw new ApiError('主题安装失败 HTTP ' + res.status, res.status, null);
    return res.json();
  },
  components: () => request('/components'),
  refreshComponents: () => request('/components/refresh', { method: 'POST' }),
  mediaUrl: (stored) => ORIGIN + '/media/' + encodeURIComponent(stored),
  iconUrl: (name) => '/assets/icons/' + name + '.svg'
};

/* ----------------------------------------------------------- websocket */

/**
 * Thin WebSocket wrapper for /ws. Reconnects with capped backoff, queues
 * frames until open, and keeps a rolling log for the swarm panel.
 */
export class Realtime {
  constructor(handlers) {
    this.handlers = handlers || {};
    this.socket = null;
    this.queue = [];
    this.peerId = null;
    this.attempt = 0;
    this.closedByUs = false;
    this.timer = 0;
    this.log = [];
  }

  note(line) {
    this.log.push({ at: Date.now(), line });
    if (this.log.length > 200) this.log.shift();
    if (this.handlers.onLog) this.handlers.onLog(line);
  }

  connect(name, account) {
    this.closedByUs = false;
    const wsProto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const qs = new URLSearchParams();
    if (this.peerId) qs.set('peer', this.peerId);
    qs.set('name', name || '本机用户');
    if (account) qs.set('account', account);
    const url = wsProto + '//' + location.host + '/ws?' + qs.toString();
    this.note('连接 ' + url);
    try { this.socket = new WebSocket(url); }
    catch (err) { this.note('WebSocket 创建失败：' + err.message); this.scheduleReconnect(name, account); return; }
    const sock = this.socket;
    sock.onopen = () => {
      this.attempt = 0;
      this.note('已连接');
      const pending = this.queue.splice(0);
      for (const frame of pending) this.send(frame);
      if (this.handlers.onOpen) this.handlers.onOpen();
    };
    sock.onmessage = (ev) => {
      let frame = null;
      try { frame = JSON.parse(ev.data); } catch { return; }
      if (frame && frame.t === 'hello') { this.peerId = frame.peerId; this.note('握手 peer=' + frame.peerId + ' 模式=' + (frame.modes || []).join('/')); }
      if (frame && (frame.t === 'seg-offer' || frame.t === 'provider' || frame.t === 'have')) this.note(frame.t + ' index=' + frame.index + (frame.peerId ? ' peer=' + String(frame.peerId).slice(0, 6) : '') + (frame.url ? ' url=origin' : ''));
      if (this.handlers.onFrame) this.handlers.onFrame(frame);
    };
    sock.onclose = () => {
      this.socket = null;
      this.note('连接已断开');
      if (this.handlers.onClose) this.handlers.onClose();
      if (!this.closedByUs) this.scheduleReconnect(name, account);
    };
    sock.onerror = () => { this.note('连接错误'); };
  }

  scheduleReconnect(name, account) {
    clearTimeout(this.timer);
    this.attempt += 1;
    const delay = Math.min(8000, 600 * Math.pow(1.6, this.attempt));
    this.timer = setTimeout(() => this.connect(name, account), delay);
  }

  send(frame) {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      try { this.socket.send(JSON.stringify(frame)); return true; } catch { return false; }
    }
    if (this.queue.length < 40) this.queue.push(frame);
    return false;
  }

  close() {
    this.closedByUs = true;
    clearTimeout(this.timer);
    if (this.socket) { try { this.socket.close(); } catch { /* already gone */ } }
    this.socket = null;
  }

  get connected() { return !!this.socket && this.socket.readyState === WebSocket.OPEN; }
}

export default api;
