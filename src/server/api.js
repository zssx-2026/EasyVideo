/* EasyVideo - domain API. Every route answers JSON under /api. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import PATHS from './paths.js';
import store from './store.js';
import { hub } from './hub.js';
import * as transport from './transport.js';
import * as ingest from './ingest.js';
import * as search from './search.js';
import { runningApps, appStatus, KNOWN_APPS } from './apps.js';
import { mimeFor } from './http.js';
import logger from './logger.js';
import {
  uid, pid6, pidOk, pidPath, pidFromPath, b64, unb64, hashPassword, verifyPassword, now, log,
  safeName, formatRecordingName, moveToRecycle, clamp
} from './util.js';

const MAX_JSON = 8 * 1024 * 1024;
const MAX_UPLOAD = 4 * 1024 * 1024 * 1024; // 4 GiB per file

/* ------------------------------------------------------------------ helpers */

function ensureAccount(db) {
  let acc = db.currentAccountId ? db.accounts[db.currentAccountId] : null;
  if (acc) return acc;
  acc = createAccount(db, { nickname: '本机用户', name: '', guest: true });
  db.currentAccountId = acc.id;
  store.touch('bootstrap-account');
  return acc;
}

function createAccount(db, input) {
  const id = uid('acc');
  const pwd = input.password ? hashPassword(input.password) : null;
  const account = {
    id,
    nickname: input.nickname || '新账号',
    username: input.username || ('user' + crypto.randomBytes(3).toString('hex')),
    name: input.name || '',
    gender: input.gender || 'undisclosed',
    birthday: input.birthday || '',
    preferences: { favorite: input.favorite || '', liked: [], loved: [] },
    avatar: input.avatar || null,
    guest: !!input.guest,
    salt: pwd ? pwd.salt : null,
    hash: pwd ? pwd.hash : null,
    createdAt: now(),
    stats: { fans: 0, videos: 0, lives: 0, following: 0 },
    privacy: defaultPrivacy()
  };
  db.accounts[id] = account;
  db.privacy[id] = account.privacy;
  db.settings[id] = defaultSettings(account);
  store.touch('account-create');
  return account;
}

function defaultPrivacy() {
  return {
    uploadLogs: false,
    analytics: false,
    showOnline: true,
    allowFriendRequests: true,
    allowStrangerMessages: false,
    searchableByPid: false,
    publicProfile: {
      avatar: true, nickname: true, fans: true, following: false,
      live: true, favorites: false, history: false, later: false,
      name: false, gender: false, birthday: false, preferences: false
    },
    publicItems: { favorites: false, history: false, later: false, live: true }
  };
}

function defaultSettings(account) {
  return {
    theme: 'midnight',
    accent: 'ember',
    language: 'zh-CN',
    playerVolume: 0.8,
    autoplay: true,
    defaultMode: 'BT',
    defaultQuality: 'source',
    bandwidthCapMbps: 0,
    recordDir: PATHS.recordings,
    recordTemplate: '%CCYY-%MM-%DD_%HH-%mm-%SS_%UN',
    recordFormat: 'mp4',
    captureApp: '',
    showDanmaku: true,
    danmakuWindow: false,
    homeRegion: 'auto',
    autoUpdate: false,
    accountId: account ? account.id : null
  };
}

function publicAccount(acc, viewerIsSelf) {
  const p = acc.privacy || defaultPrivacy();
  const pub = p.publicProfile || {};
  const out = { id: acc.id, nickname: acc.nickname, avatar: acc.avatar, guest: !!acc.guest, stats: acc.stats };
  if (viewerIsSelf) {
    return Object.assign(out, {
      username: acc.username, name: acc.name, gender: acc.gender,
      birthday: acc.birthday, preferences: acc.preferences, privacy: p
    });
  }
  if (pub.name) out.name = acc.name;
  if (pub.gender) out.gender = acc.gender;
  if (pub.birthday) out.birthday = acc.birthday;
  if (pub.preferences) out.preferences = acc.preferences;
  if (!pub.fans) delete out.stats;
  return out;
}

function self(ctx) { return ctx.account; }

function myColl(ctx, coll) {
  return store.list(coll).filter((r) => r.accountId === ctx.account.id && !r.deletedAt);
}

function cardLive(room) {
  const stream = transport.getStream(room.streamId);
  return {
    id: room.id, kind: 'live', pid: room.pid, title: room.title, blurb: room.blurb,
    author: room.nickname, authorId: room.accountId, cover: room.cover || null,
    mode: room.mode, resolution: room.resolution, fps: room.fps, bitrateKbps: room.bitrateKbps,
    secret: !!room.secret, viewers: stream ? stream.viewers.size : (room.viewers || 0),
    startedAt: room.startedAt, endedAt: room.endedAt, status: room.status,
    // 未开播（黑屏/垫片）时 status 仍是 live，但 publisher 为空。
    published: !!(stream && stream.publisherAt),
    standby: room.standby || 'black',
    replay: !!room.replay, tags: room.tags || [],
    path: livePath(room), url: liveUrl(room)
  };
}

function cardVideo(video) {
  return {
    id: video.id, kind: 'video', pid: video.pid, title: video.title, blurb: video.blurb,
    author: video.nickname, authorId: video.accountId, cover: video.cover || null,
    resolution: video.resolution, fps: video.fps, bitrateKbps: video.bitrateKbps,
    durationSec: video.durationSec || 0, views: video.views || 0, secret: !!video.secret,
    collection: video.collection || '', parts: (video.files || []).length,
    createdAt: video.createdAt, tags: video.tags || [], path: videoPath(video), url: videoUrl(video), draft: !!video.draft
  };
}

/** 站内路径：PID 走 base64url，昵称走常规编码。 */
const livePath = (room) => (room.secret ? '/live/secret/' : '/live/')
  + encodeURIComponent(room.nickname) + '/' + pidPath(room.pid) + '/';

const videoPath = (video) => (video.secret ? '/video/secret/' : '/video/')
  + encodeURIComponent(video.nickname) + '/' + pidPath(video.pid) + '/';

const liveUrl = (room) => 'ev://live/' + (room.secret ? 'secret/' : '')
  + encodeURIComponent(room.nickname) + '/' + pidPath(room.pid);

const videoUrl = (video) => 'ev://video/' + (video.secret ? 'secret/' : '')
  + encodeURIComponent(video.nickname) + '/' + pidPath(video.pid);

function normalizeSource(raw) {
  const s = String(raw || 'upload').toLowerCase();
  if (s === 'link' || s === 'url' || s === 'external') return 'link';
  if (s === 'local' || s === 'path' || s === 'file') return 'local';
  return 'upload';
}

function classifyEntry(value) {
  const text = String(value == null ? '' : value).trim();
  if (!text) return null;
  if (text.startsWith('http:') || text.startsWith('https:')) return { kind: 'link', url: text };
  const drive = text.length > 2 && text[1] === ':' && (text[2] === '/' || text.charCodeAt(2) === 92);
  if (drive || text.startsWith('//') || text.startsWith('/')) return { kind: 'local', path: text };
  if (/^[a-zA-Z]:[\/]/.test(text) || text.startsWith('\\') || text.startsWith('/')) return { kind: 'local', path: text };
  return null;
}

/** Coerce the client's file list into one canonical shape per source mode. */
function normalizeFiles(source, raw) {
  const list = Array.isArray(raw) ? raw : [];
  const out = [];
  for (const item of list) {
    if (item && typeof item === 'object') {
      const kind = item.kind || (item.url ? 'link' : item.path ? 'local' : 'upload');
      out.push({
        name: safeName(item.name || item.title || 'video', 'video'),
        kind,
        stored: item.stored || null,
        size: Number(item.size) || 0,
        url: item.url || null,
        path: item.path || null,
        mime: item.mime || null
      });
      continue;
    }
    const cls = classifyEntry(item);
    if (cls) {
      const base = cls.url || cls.path;
      const name = safeName(base.split(/[\/]/).pop() || 'video', 'video');
      out.push({ name, kind: cls.kind, stored: null, size: 0, url: cls.url || null, path: cls.path || null, mime: null });
    }
  }
  return out;
}

/** Describe one part of a video so the player can resolve where to read it from. */
function partOf(video, file, index) {
  const kind = file.kind || (file.url ? 'link' : file.path ? 'local' : 'upload');
  const part = { index: index + 1, name: file.name || ('part' + (index + 1)), kind };
  if (kind === 'link') { part.url = file.url; part.external = true; return part; }
  if (kind === 'local') { part.path = file.path; part.url = '/api/media/local/' + video.id + '/' + (index + 1); part.external = false; return part; }
  part.stored = file.stored;
  part.url = '/media/' + encodeURIComponent(file.stored || file.name);
  part.external = false;
  return part;
}

function requireFields(body, fields) {
  const missing = fields.filter((f) => body[f] === undefined || body[f] === null || body[f] === '');
  if (missing.length) { const e = new Error('缺少必填项: ' + missing.join(', ')); e.status = 400; throw e; }
}

function slug(text) { return safeName(String(text || '').slice(0, 64), 'item'); }

/* ------------------------------------------------------------------- router */

export function mount(router) {
  const R = router;
  // The HTTP kernel calls every handler as (ctx, req, res, params).
  const H = (fn) => async (ctx, req, res, params) => {
    try { await fn(ctx, req, res, params || {}); }
    catch (err) { res.fail(err, err.status || 500); }
  };

  /* ---- bootstrap ------------------------------------------------------- */
  R.get('/api/bootstrap', H(async (ctx, req, res) => {
    const db = store.db;
    const acc = ensureAccount(db);
    const live = store.list('liveRooms').filter((r) => r.status === 'live' && !r.deletedAt);
    const videos = store.list('videos').filter((v) => !v.deletedAt);
    res.json({
      ok: true,
      account: publicAccount(acc, true),
      accounts: Object.values(db.accounts).map((a) => publicAccount(a, a.id === acc.id)),
      counts: {
        live: live.length, video: videos.length, history: myColl(ctx, 'history').length,
        later: myColl(ctx, 'watchLater').length, favorites: myColl(ctx, 'favorites').length,
        friends: myColl(ctx, 'friends').length, drafts: store.list('drafts').filter((d) => d.accountId === acc.id && !d.deletedAt).length
      },
      settings: db.settings[acc.id] || defaultSettings(acc),
      privacy: acc.privacy || defaultPrivacy(),
      transport: transport.transportSummary(),
      hub: hub.stats(),
      paths: { cache: PATHS.cache, recycle: PATHS.recycle, backup: PATHS.backup, media: PATHS.media, recordings: PATHS.recordings }
    });
  }));

  /* ---- accounts -------------------------------------------------------- */
  R.get('/api/accounts', H(async (ctx, req, res) => {
    const db = store.db;
    res.json({ ok: true, current: db.currentAccountId, accounts: Object.values(db.accounts).map((a) => publicAccount(a, a.id === db.currentAccountId)) });
  }));

  R.post('/api/accounts', H(async (ctx, req, res) => {
    requireFields(ctx.body, ['nickname']);
    const db = store.db;
    if (ctx.body.username && Object.values(db.accounts).some((a) => a.username === ctx.body.username)) {
      const e = new Error('账号名已存在'); e.status = 409; throw e;
    }
    const acc = createAccount(db, ctx.body);
    db.currentAccountId = acc.id;
    store.touch('account-add');
    res.json({ ok: true, account: publicAccount(acc, true) });
  }));

  R.post('/api/accounts/:id/switch', H(async (ctx, req, res, p) => {
    const db = store.db;
    if (!db.accounts[p.id]) { const e = new Error('账号不存在'); e.status = 404; throw e; }
    db.currentAccountId = p.id;
    store.touch('account-switch');
    res.json({ ok: true, account: publicAccount(db.accounts[p.id], true) });
  }));

  R.post('/api/accounts/login', H(async (ctx, req, res) => {
    requireFields(ctx.body, ['username', 'password']);
    const db = store.db;
    const acc = Object.values(db.accounts).find((a) => a.username === ctx.body.username);
    if (!acc || !acc.hash) { const e = new Error('账号不存在或未设置密码'); e.status = 401; throw e; }
    if (!verifyPassword(ctx.body.password, acc.salt, acc.hash)) { const e = new Error('密码错误'); e.status = 401; throw e; }
    db.currentAccountId = acc.id;
    store.touch('account-login');
    res.json({ ok: true, account: publicAccount(acc, true) });
  }));

  R.del('/api/accounts/:id', H(async (ctx, req, res, p) => {
    const db = store.db;
    const acc = db.accounts[p.id];
    if (!acc) { const e = new Error('账号不存在'); e.status = 404; throw e; }
    delete db.accounts[p.id];
    delete db.privacy[p.id];
    delete db.settings[p.id];
    if (db.currentAccountId === p.id) db.currentAccountId = Object.keys(db.accounts)[0] || null;
    store.touch('account-delete');
    log('account 注销:', acc.nickname);
    res.json({ ok: true, current: db.currentAccountId });
  }));

  /* ---- profile / privacy ---------------------------------------------- */
  R.get('/api/me', H(async (ctx, req, res) => {
    const acc = ctx.account;
    res.json({
      ok: true, account: publicAccount(acc, true), privacy: acc.privacy,
      settings: store.db.settings[acc.id] || defaultSettings(acc),
      counters: {
        fans: acc.stats.fans || 0,
        videos: store.list('videos').filter((v) => v.accountId === acc.id && !v.deletedAt).length,
        lives: store.list('liveRooms').filter((l) => l.accountId === acc.id).length,
        following: myColl(ctx, 'friends').length
      }
    });
  }));

  R.patch('/api/me', H(async (ctx, req, res) => {
    const acc = ctx.account;
    const patch = ctx.body || {};
    for (const key of ['nickname', 'name', 'gender', 'birthday', 'avatar']) {
      if (patch[key] !== undefined) acc[key] = patch[key];
    }
    if (patch.gender && !['male', 'female', 'undisclosed'].includes(patch.gender)) {
      const e = new Error('性别取值必须为 male / female / undisclosed'); e.status = 400; throw e;
    }
    if (patch.preferences) {
      const prefs = patch.preferences;
      const liked = Array.isArray(prefs.liked) ? prefs.liked.slice(0, 2) : [];
      const loved = Array.isArray(prefs.loved) ? prefs.loved.slice(0, 3) : [];
      acc.preferences = {
        favorite: prefs.favorite ? [prefs.favorite].flat().slice(0, 1).join('') : (prefs.favorite || ''),
        liked, loved
      };
    }
    store.touch('profile-update');
    res.json({ ok: true, account: publicAccount(acc, true) });
  }));

  R.get('/api/me/privacy', H(async (ctx, req, res) => {
    res.json({ ok: true, privacy: ctx.account.privacy || defaultPrivacy() });
  }));

  R.patch('/api/me/privacy', H(async (ctx, req, res) => {
    const acc = ctx.account;
    const p = Object.assign(defaultPrivacy(), acc.privacy || {});
    const body = ctx.body || {};
    for (const key of ['uploadLogs', 'analytics', 'showOnline', 'allowFriendRequests', 'allowStrangerMessages', 'searchableByPid']) {
      if (body[key] !== undefined) p[key] = !!body[key];
    }
    if (body.publicProfile) p.publicProfile = Object.assign(p.publicProfile, body.publicProfile);
    if (body.publicItems) p.publicItems = Object.assign(p.publicItems, body.publicItems);
    acc.privacy = p;
    store.db.privacy[acc.id] = p;
    store.touch('privacy-update');
    res.json({ ok: true, privacy: p });
  }));

  /* ---- settings + export / import -------------------------------------- */
  R.get('/api/settings', H(async (ctx, req, res) => {
    res.json({ ok: true, settings: store.db.settings[ctx.account.id] || defaultSettings(ctx.account) });
  }));

  R.patch('/api/settings', H(async (ctx, req, res) => {
    const id = ctx.account.id;
    const cur = store.db.settings[id] || defaultSettings(ctx.account);
    store.db.settings[id] = Object.assign(cur, ctx.body || {});
    store.touch('settings-update');
    res.json({ ok: true, settings: store.db.settings[id] });
  }));

  R.get('/api/settings/export', H(async (ctx, req, res) => {
    const acc = ctx.account;
    const payload = {
      format: 'easyvideo-settings',
      version: 1,
      exportedAt: new Date().toISOString(),
      account: publicAccount(acc, true),
      privacy: acc.privacy,
      settings: store.db.settings[acc.id] || defaultSettings(acc),
      social: {
        friends: myColl(ctx, 'friends'), favorites: myColl(ctx, 'favorites'),
        watchLater: myColl(ctx, 'watchLater'), history: myColl(ctx, 'history')
      },
      models: ctx.query.get('models') === '1' ? search.exportModels() : undefined
    };
    const buf = Buffer.from(JSON.stringify(payload, null, 2), 'utf8');
    if (ctx.query.get('download') === '1') res.stream(buf, 'application/json', 'easyvideo-settings.json');
    else res.json({ ok: true, payload });
  }));

  R.post('/api/settings/import', H(async (ctx, req, res) => {
    const data = ctx.body && ctx.body.payload ? ctx.body.payload : ctx.body;
    if (!data || data.format !== 'easyvideo-settings') { const e = new Error('不是有效的 EasyVideo 设置文件'); e.status = 400; throw e; }
    const acc = ctx.account;
    if (data.settings) store.db.settings[acc.id] = Object.assign(defaultSettings(acc), data.settings);
    if (data.privacy) { acc.privacy = Object.assign(defaultPrivacy(), data.privacy); store.db.privacy[acc.id] = acc.privacy; }
    if (data.account) {
      for (const k of ['nickname', 'name', 'gender', 'birthday', 'avatar']) if (data.account[k] !== undefined) acc[k] = data.account[k];
      if (data.account.preferences) acc.preferences = data.account.preferences;
    }
    if (ctx.body.mergeSocial !== false && data.social) {
      for (const [coll, rows] of Object.entries(data.social)) {
        for (const row of rows || []) {
          const exists = myColl(ctx, coll).some((r) => r.refId === row.refId && r.kind === row.kind);
          if (!exists) store.insert(coll, Object.assign({}, row, { id: undefined, accountId: acc.id, imported: true }));
        }
      }
    }
    if (data.models) search.importModels(data.models);
    store.touch('settings-import');
    res.json({ ok: true, settings: store.db.settings[acc.id] });
  }));

  /* ---- live rooms ------------------------------------------------------ */
  R.get('/api/live', H(async (ctx, req, res) => {
    const q = ctx.query.get('q') || '';
    const includeEnded = ctx.query.get('ended') === '1';
    let rooms = store.list('liveRooms').filter((r) => !r.deletedAt);
    if (!includeEnded) rooms = rooms.filter((r) => r.status === 'live' || r.replay);
    rooms = rooms.filter((r) => !r.secret || r.accountId === ctx.account.id);
    const cards = rooms.map(cardLive);
    const ranked = q ? search.rank('live', q, cards) : cards;
    if (q) store.insert('history', { accountId: ctx.account.id, kind: 'search-live', refId: null, query: q, title: q });
    res.json({ ok: true, items: ranked, query: q });
  }));

  R.post('/api/live', H(async (ctx, req, res) => {
    requireFields(ctx.body, ['title', 'mode', 'resolution', 'fps', 'bitrateKbps', 'blurb']);
    const acc = ctx.account;
    const body = ctx.body;
    if (!['SERVER', 'P2P', 'BT'].includes(body.mode)) { const e = new Error('传输模式必须为 SERVER / P2P / BT'); e.status = 400; throw e; }
    if (body.mode === 'SERVER' && !body.serverIp) { const e = new Error('SERVER 模式需要填写服务器 IP'); e.status = 400; throw e; }
    const pid = body.pid || pid6();
    if (store.list('liveRooms').some((r) => r.pid === pid && r.status === 'live')) { const e = new Error('PID 已被占用'); e.status = 409; throw e; }
    const stream = transport.openStream({
      mode: body.mode, ownerId: acc.id, title: body.title,
      bitrateKbps: Number(body.bitrateKbps) || 0, serverUrl: body.serverIp ? 'http://' + body.serverIp + ':' + (body.serverPort || 13750) : null,
      trackers: body.trackers || []
    });
    const room = store.insert('liveRooms', {
      accountId: acc.id, nickname: acc.nickname, pid, title: body.title, blurb: body.blurb,
      roomName: body.roomName || body.title, mode: body.mode, serverIp: body.serverIp || '',
      resolution: body.resolution, fps: Number(body.fps) || 30, bitrateKbps: Number(body.bitrateKbps) || 0,
      duration: body.duration || 'permanent', durationMinutes: Number(body.durationMinutes) || 0,
      app: body.app || '', limit: Number(body.limit) || 0, secret: !!body.secret,
      secretScope: body.secretScope || 'friends', showDanmaku: !!body.showDanmaku, replay: !!body.replay,
      record: body.record || null, tags: body.tags || [], cover: body.cover || null,
      streamId: stream.id, status: 'live', startedAt: now(), viewers: 0
    });
    store.db.counters.live = (store.db.counters.live || 0) + 1;
    acc.stats.lives = (acc.stats.lives || 0) + 1;
    log('live room created', room.pid, room.mode, 'path=/live/' + room.nickname + '/' + room.pid);
    res.json({ ok: true, room: cardLive(room), path: '/live/' + encodeURIComponent(room.nickname) + '/' + room.pid, ev: liveUrl(room) });
  }));

  R.get('/api/live/:nick/:pid', H(async (ctx, req, res, p) => {
    const room = store.list('liveRooms').find((r) => r.pid === p.pid && r.nickname === p.nick);
    if (!room) { const e = new Error('直播间不存在'); e.status = 404; throw e; }
    const stream = transport.getStream(room.streamId);
    store.insert('history', { accountId: ctx.account.id, kind: 'live', refId: room.id, title: room.title, author: room.nickname });
    res.json({
      ok: true, room: cardLive(room),
      swarm: stream ? transport.swarmStats(stream.id) : null,
      secret: room.secret ? { scope: room.secretScope } : null
    });
  }));

  R.post('/api/live/:id/end', H(async (ctx, req, res, p) => {
    const room = store.list('liveRooms').find((r) => r.id === p.id);
    if (!room) { const e = new Error('直播间不存在'); e.status = 404; throw e; }
    if (room.accountId !== ctx.account.id) { const e = new Error('只有主播可以结束直播'); e.status = 403; throw e; }
    // 结束是幂等的：重复点击直接返回当前状态，而不是再关一次流。
    if (room.status === 'ended') { res.json({ ok: true, room: cardLive(room), recording: null, already: true }); return; }
    room.status = 'ended';
    room.endedAt = now();
    room.publishing = false;
    transport.closeStream(room.streamId, 'host-ended');
    let recording = null;
    if (room.replay && room.record && room.record.savePath) {
      recording = finalizeRecording(ctx, room);
    }
    store.touch('live-end');
    res.json({ ok: true, room: cardLive(room), recording });
  }));

  /* 主播：真正开始推流（之前只是把房间建好）。 */
  R.post('/api/live/:id/start', H(async (ctx, req, res, p) => {
    const room = store.list('liveRooms').find((r) => r.id === p.id);
    if (!room) { const e = new Error('直播间不存在'); e.status = 404; throw e; }
    if (room.accountId !== ctx.account.id) { const e = new Error('只有主播可以开播'); e.status = 403; throw e; }
    if (room.status === 'ended') { const e = new Error('直播已结束，请新建房间'); e.status = 409; throw e; }
    let stream = transport.getStream(room.streamId);
    // 结束后流会被关掉，重新开播需要一条新流。
    if (!stream) {
      stream = transport.openStream({ mode: room.mode, roomId: room.id, ownerId: room.accountId, title: room.title, bitrateKbps: room.bitrateKbps });
      room.streamId = stream.id;
    }
    room.status = 'live';
    room.publishing = true;
    room.publishedAt = now();
    stream.publisherAt = now();
    store.touch('live-start');
    log('live started', room.pid);
    res.json({ ok: true, room: cardLive(room), streamId: stream.id });
  }));

  /* 未开播时观众看到什么：black（黑屏）或 standby（循环垫片视频）。 */
  R.post('/api/live/:id/standby', H(async (ctx, req, res, p) => {
    const room = store.list('liveRooms').find((r) => r.id === p.id);
    if (!room) { const e = new Error('直播间不存在'); e.status = 404; throw e; }
    if (room.accountId !== ctx.account.id) { const e = new Error('只有主播可以设置未开播画面'); e.status = 403; throw e; }
    const mode = ctx.body && ctx.body.mode === 'video' ? 'video' : 'black';
    room.standby = mode;
    room.standbyFile = (ctx.body && ctx.body.stored) || room.standbyFile || null;
    store.touch('live-standby');
    res.json({ ok: true, room: cardLive(room) });
  }));

  /* 删除直播间：主播可以彻底移除（回收站里留一份）。 */
  R.del('/api/live/:id', H(async (ctx, req, res, p) => {
    const room = store.list('liveRooms').find((r) => r.id === p.id);
    if (!room) { const e = new Error('直播间不存在'); e.status = 404; throw e; }
    if (room.accountId !== ctx.account.id) { const e = new Error('无权删除'); e.status = 403; throw e; }
    transport.closeStream(room.streamId, 'deleted');
    store.remove('liveRooms', room.id, true);
    store.touch('live-delete');
    res.json({ ok: true });
  }));

  R.post('/api/live/:id/join', H(async (ctx, req, res, p) => {
    const room = store.list('liveRooms').find((r) => r.id === p.id);
    if (!room) { const e = new Error('直播间不存在'); e.status = 404; throw e; }
    const stream = transport.getStream(room.streamId);
    if (!stream) { const e = new Error('直播已结束'); e.status = 410; throw e; }
    if (room.limit > 0 && stream.viewers.size >= room.limit) { const e = new Error('房间人数已满'); e.status = 403; throw e; }
    if (room.secret && room.secretScope === 'self' && room.accountId !== ctx.account.id) {
      const e = new Error('私密房间仅自己可加入'); e.status = 403; throw e;
    }
    room.viewers = stream.viewers.size;
    res.json({ ok: true, streamId: stream.id, mode: stream.mode, segmentBytes: transport.SEGMENT_BYTES });
  }));

  /* ---- videos ---------------------------------------------------------- */
  R.get('/api/videos', H(async (ctx, req, res) => {
    const q = ctx.query.get('q') || '';
    let videos = store.list('videos').filter((v) => !v.deletedAt && !v.draft);
    videos = videos.filter((v) => !v.secret || v.accountId === ctx.account.id);
    const cards = videos.map(cardVideo);
    const ranked = q ? search.rank('video', q, cards) : cards;
    if (q) store.insert('history', { accountId: ctx.account.id, kind: 'search-video', refId: null, query: q, title: q });
    res.json({ ok: true, items: ranked, query: q });
  }));

  R.post('/api/videos', H(async (ctx, req, res) => {
    requireFields(ctx.body, ['title', 'blurb', 'files', 'resolution', 'bitrateKbps', 'fps']);
    const acc = ctx.account;
    const body = ctx.body;
    const pid = body.pid || pid6();
    const source = normalizeSource(body.source);
    const files = normalizeFiles(source, body.files);
    if (!files.length) { const e = new Error('至少需要一个视频文件'); e.status = 400; throw e; }
    const video = store.insert('videos', {
      accountId: acc.id, nickname: acc.nickname, pid, title: body.title, blurb: body.blurb,
      source, files, collection: body.collection || '', resolution: body.resolution,
      bitrateKbps: Number(body.bitrateKbps) || 0, fps: Number(body.fps) || 30,
      feedback: body.feedback !== false, secret: !!body.secret, secretScope: body.secretScope || 'friends',
      tags: body.tags || [], cover: body.cover || null, durationSec: Number(body.durationSec) || 0,
      draft: false, views: 0, publishedAt: now()
    });
    store.db.counters.video = (store.db.counters.video || 0) + 1;
    acc.stats.videos = (acc.stats.videos || 0) + 1;
    if (body.collection) {
      let coll = store.list('collections').find((c) => c.name === body.collection && c.accountId === acc.id);
      if (!coll) coll = store.insert('collections', { accountId: acc.id, name: body.collection, items: [] });
      coll.items = (coll.items || []).concat([video.id]);
    }
    log('video published', video.pid, 'path=/video/' + video.nickname + '/' + video.pid);
    res.json({ ok: true, video: cardVideo(video), path: '/video/' + encodeURIComponent(video.nickname) + '/' + video.pid, ev: videoUrl(video) });
  }));

  R.get('/api/video/:nick/:pid', H(async (ctx, req, res, p) => {
    const video = store.list('videos').find((v) => v.pid === p.pid && v.nickname === p.nick && !v.deletedAt);
    if (!video) { const e = new Error('视频不存在'); e.status = 404; throw e; }
    video.views = (video.views || 0) + 1;
    store.insert('history', { accountId: ctx.account.id, kind: 'video', refId: video.id, title: video.title, author: video.nickname });
    store.touch('video-view');
    const parts = (video.files || []).map((f, i) => partOf(video, f, i));
    res.json({ ok: true, video: cardVideo(video), parts });
  }));

  R.del('/api/video/:id', H(async (ctx, req, res, p) => {
    const video = store.list('videos').find((v) => v.id === p.id);
    if (!video) { const e = new Error('视频不存在'); e.status = 404; throw e; }
    if (video.accountId !== ctx.account.id) { const e = new Error('无权删除'); e.status = 403; throw e; }
    moveToRecycle(path.join(PATHS.media, video.pid), PATHS.recycle, 'video-' + video.pid);
    store.remove('videos', p.id, true);
    res.json({ ok: true });
  }));

  /* ---- drafts ---------------------------------------------------------- */
  R.get('/api/drafts', H(async (ctx, req, res) => {
    const drafts = store.list('drafts').filter((d) => d.accountId === ctx.account.id && !d.deletedAt);
    res.json({ ok: true, items: drafts.map((d) => Object.assign({}, d, { path: '/video/draft/' + b64(d.name) })) });
  }));

  R.post('/api/drafts', H(async (ctx, req, res) => {
    requireFields(ctx.body, ['name', 'title', 'blurb']);
    const src = normalizeSource(ctx.body.source);
    const files = normalizeFiles(src, ctx.body.files);
    const draft = store.insert('drafts', Object.assign({
      accountId: ctx.account.id, nickname: ctx.account.nickname, feedback: true, source: src, files,
      resolution: '1920x1080', bitrateKbps: 6000, fps: 30, secret: false, secretScope: 'friends'
    }, ctx.body));
    res.json({ ok: true, draft, path: '/video/draft/' + b64(draft.name) });
  }));

  R.get('/api/drafts/:id', H(async (ctx, req, res, p) => {
    const draft = store.list('drafts').find((d) => d.id === p.id || b64(d.name) === p.id);
    if (!draft) { const e = new Error('草稿不存在'); e.status = 404; throw e; }
    res.json({ ok: true, draft });
  }));

  R.patch('/api/drafts/:id', H(async (ctx, req, res, p) => {
    const draft = store.list('drafts').find((d) => d.id === p.id);
    if (!draft) { const e = new Error('草稿不存在'); e.status = 404; throw e; }
    res.json({ ok: true, draft: store.update('drafts', draft.id, ctx.body || {}) });
  }));

  R.del('/api/drafts/:id', H(async (ctx, req, res, p) => {
    store.remove('drafts', p.id, true);
    res.json({ ok: true });
  }));

  R.post('/api/drafts/:id/publish', H(async (ctx, req, res, p) => {
    const draft = store.list('drafts').find((d) => d.id === p.id);
    if (!draft) { const e = new Error('草稿不存在'); e.status = 404; throw e; }
    if (!draft.files || !draft.files.length) { const e = new Error('草稿没有视频文件'); e.status = 400; throw e; }
    const video = store.insert('videos', Object.assign({}, draft, {
      id: undefined, draft: false, views: 0, publishedAt: now(), pid: draft.pid || pid6()
    }));
    store.remove('drafts', draft.id, true);
    res.json({ ok: true, video: cardVideo(video), path: '/video/' + encodeURIComponent(video.nickname) + '/' + video.pid });
  }));

  /* ---- library: history / later / favorites / friends ------------------ */
  const libraryRoutes = [
    ['history', 'history'], ['later', 'watchLater'], ['favorites', 'favorites'], ['friends', 'friends']
  ];
  for (const [route, coll] of libraryRoutes) {
    R.get('/api/' + route, H(async (ctx, req, res) => {
      const q = ctx.query.get('q') || '';
      let rows = myColl(ctx, coll);
      if (q) rows = rows.filter((r) => JSON.stringify(r).toLowerCase().includes(q.toLowerCase()));
      res.json({ ok: true, items: rows, collection: coll });
    }));
    R.post('/api/' + route, H(async (ctx, req, res) => {
      const rec = store.insert(coll, Object.assign({ accountId: ctx.account.id }, ctx.body || {}));
      res.json({ ok: true, item: rec });
    }));
    R.del('/api/' + route + '/:id', H(async (ctx, req, res, p) => {
      if (ctx.query.get('all') === '1') {
        for (const r of myColl(ctx, coll)) store.remove(coll, r.id, true);
      } else store.remove(coll, p.id, true);
      res.json({ ok: true });
    }));
  }

  /* ---- search + learning ---------------------------------------------- */
  R.get('/api/search', H(async (ctx, req, res) => {
    const kind = ctx.query.get('kind') === 'video' ? 'video' : 'live';
    const q = ctx.query.get('q') || '';
    if (!q) { res.json({ ok: true, items: [], query: q, kind }); return; }
    const source = kind === 'live'
      ? store.list('liveRooms').filter((r) => !r.deletedAt).map(cardLive)
      : store.list('videos').filter((v) => !v.deletedAt && !v.draft).map(cardVideo);
    const items = search.rank(kind, q, source);
    store.insert('history', { accountId: ctx.account.id, kind: 'search-' + kind, query: q, title: q });
    res.json({ ok: true, items, query: q, kind });
  }));

  R.post('/api/search/feedback', H(async (ctx, req, res) => {
    const body = ctx.body || {};
    const kind = body.kind === 'video' ? 'video' : 'live';
    const label = body.label === undefined ? 1 : (body.label ? 1 : 0);
    let doc = null;
    if (body.docId) {
      const coll = kind === 'live' ? 'liveRooms' : 'videos';
      const rec = store.list(coll).find((r) => r.id === body.docId);
      if (rec) doc = kind === 'live' ? cardLive(rec) : cardVideo(rec);
    }
    if (!doc && body.doc) doc = body.doc;
    if (!doc) { const e = new Error('缺少训练样本'); e.status = 400; throw e; }
    search.train(kind, body.query || '', doc, label);
    store.touch('search-train');
    res.json({ ok: true, stats: search.rankerFor(kind).stats() });
  }));

  R.get('/api/search/stats', H(async (ctx, req, res) => {
    res.json({ ok: true, stats: search.searchStats() });
  }));

  /* ---- transport / swarm ---------------------------------------------- */
  R.get('/api/transport', H(async (ctx, req, res) => {
    res.json({ ok: true, transport: transport.transportSummary(), hub: hub.stats() });
  }));

  R.get('/api/transport/:streamId/stats', H(async (ctx, req, res, p) => {
    const stats = transport.swarmStats(p.streamId);
    if (!stats) { const e = new Error('流不存在'); e.status = 404; throw e; }
    res.json({ ok: true, swarm: stats });
  }));

  R.post('/api/transport/plan', H(async (ctx, req, res) => {
    const body = ctx.body || {};
    const viewers = Number(body.viewers) || 1;
    const bitrate = Number(body.bitrateKbps) || 0;
    res.json({
      ok: true,
      plan: {
        SERVER: transport.uplinkEstimate('SERVER', bitrate, viewers),
        P2P: transport.uplinkEstimate('P2P', bitrate, viewers),
        BT: transport.uplinkEstimate('BT', bitrate, viewers)
      },
      note: 'P2P 单对多：主机上行 = 码率 x 观众数；BT 分片共享：主机上行约为 3 倍码率后趋于平坦。'
    });
  }));

  /* 切片：主机 POST 推流，观众 GET 拉流。三种模式共用。 */
  R.get('/api/transport/segment/:streamId/:index', H(async (ctx, req, res, p) => {
    const stream = transport.getStream(p.streamId);
    if (!stream) { const e = new Error('直播已结束'); e.status = 410; throw e; }
    const buf = ingest.readSegment(p.streamId, p.index);
    if (!buf) { const e = new Error('分片尚未生成'); e.status = 404; throw e; }
    res.buffer(buf, 'application/octet-stream', { 'cache-control': 'public, max-age=15' });
  }));

  /* 主播推流：原始字节直接写盘，不经过 JSON。 */
  R.streamPost('/api/transport/segment/:streamId/:index', H(async (ctx, req, res, p) => {
    const stream = transport.getStream(p.streamId);
    if (!stream) { const e = new Error('直播已结束'); e.status = 410; throw e; }
    if (stream.ownerId && ctx.account && stream.ownerId !== ctx.account.id) {
      const e = new Error('只有主播可以推流'); e.status = 403; throw e;
    }
    const declared = Number(req.headers['content-length'] || 0);
    if (declared > ingest.MAX_SEGMENT_BYTES) { const e = new Error('切片过大'); e.status = 413; throw e; }
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > ingest.MAX_SEGMENT_BYTES) { const e = new Error('切片过大'); e.status = 413; throw e; }
      chunks.push(chunk);
    }
    const info = ingest.writeSegment(p.streamId, p.index, Buffer.concat(chunks));
    res.json({ ok: true, index: info.index, bytes: info.bytes, total: info.total });
  }));

  /* 观众拉流批次：一次给若干片，省往返。 */
  R.get('/api/transport/segments/:streamId', H(async (ctx, req, res, p) => {
    const stream = transport.getStream(p.streamId);
    if (!stream) { const e = new Error('直播已结束'); e.status = 410; throw e; }
    const idx = ingest.segmentIndex(p.streamId);
    res.json({ ok: true, streamId: p.streamId, mode: stream.mode, count: idx.count, first: idx.first, last: idx.last, recent: idx.recent, published: !!stream.publisherAt });
  }));

  /* ---- uploads + media ------------------------------------------------- */
  R.post('/api/upload', H(async (ctx, req, res) => {
    const name = safeName(ctx.query.get('name') || 'upload.bin', 'upload.bin');
    const buf = ctx.rawBody || Buffer.alloc(0);
    if (buf.length > MAX_UPLOAD) { const e = new Error('文件过大'); e.status = 413; throw e; }
    const dir = ctx.query.get('dir') === 'recordings' ? PATHS.recordings : PATHS.media;
    fs.mkdirSync(dir, { recursive: true });
    const stored = Date.now().toString(36) + '-' + crypto.randomBytes(4).toString('hex') + '-' + name;
    fs.writeFileSync(path.join(dir, stored), buf);
    res.json({ ok: true, file: { name, stored, size: buf.length, path: path.join(dir, stored), url: '/media/' + encodeURIComponent(stored) } });
  }));

  R.get('/media/:name', H(async (ctx, req, res, p) => {
    const file = path.join(PATHS.media, safeName(p.name, 'x'));
    if (!file.startsWith(PATHS.media) || !fs.existsSync(file)) { const e = new Error('媒体不存在'); e.status = 404; throw e; }
    const stat = fs.statSync(file);
    const range = req.headers.range;
    if (range) {
      const m = /bytes=(\d*)-(\d*)/.exec(range);
      const start = m && m[1] ? Number(m[1]) : 0;
      const end = m && m[2] ? Number(m[2]) : stat.size - 1;
      res.status(206).header('content-range', 'bytes ' + start + '-' + end + '/' + stat.size);
      res.status(206).header('accept-ranges', 'bytes');
      res.status(206).header('content-length', String(end - start + 1));
      res.status(206).header('content-type', 'video/mp4');
      res.sent = true;
      res.res.writeHead(206, { 'content-range': 'bytes ' + start + '-' + end + '/' + stat.size, 'accept-ranges': 'bytes', 'content-length': String(end - start + 1), 'content-type': 'video/mp4' });
      fs.createReadStream(file, { start, end }).pipe(res.res);
      return;
    }
    res.buffer(fs.readFileSync(file), 'video/mp4', { 'accept-ranges': 'bytes' });
  }));

  /* ---- capture apps (running only) ------------------------------------ */
  /* Local / external media: 本地链接 videos never get copied into data/media, so the
     server proxies the bytes (with Range support) from wherever they actually live. */
  R.get('/api/media/local/:videoId/:index', H(async (ctx, req, res, p) => {
    const video = store.list('videos').find((v) => v.id === p.videoId) || store.list('drafts').find((d) => d.id === p.videoId);
    if (!video) { const e = new Error('视频不存在'); e.status = 404; throw e; }
    const file = (video.files || [])[Number(p.index) - 1];
    if (!file) { const e = new Error('分段不存在'); e.status = 404; throw e; }
    const kind = file.kind || (file.url ? 'link' : 'local');
    if (kind === 'link' && file.url) { res.status(302).header('location', file.url); res.res.writeHead(302, { location: file.url }); res.res.end(); return; }
    const local = path.resolve(String(file.path || ''));
    if (!local || !fs.existsSync(local)) { const e = new Error('本机文件不存在: ' + local); e.status = 404; throw e; }
    const stat = fs.statSync(local);
    const mime = mimeFor(local);
    const range = req.headers.range;
    if (range) {
      const m = /bytes=(d*)-(d*)/.exec(range);
      const start = m && m[1] ? Number(m[1]) : 0;
      const end = m && m[2] ? Number(m[2]) : stat.size - 1;
      res.sent = true;
      res.res.writeHead(206, { 'content-range': 'bytes ' + start + '-' + end + '/' + stat.size, 'accept-ranges': 'bytes', 'content-length': String(end - start + 1), 'content-type': mime });
      fs.createReadStream(local, { start, end }).pipe(res.res);
      return;
    }
    res.sent = true;
    res.res.writeHead(200, { 'content-type': mime, 'content-length': stat.size, 'accept-ranges': 'bytes' });
    fs.createReadStream(local).pipe(res.res);
  }));

  R.get('/api/apps/running', H(async (ctx, req, res) => {
    const list = await runningApps(ctx.query.get('q') || '');
    res.json({ ok: true, items: list, onlyRunning: true });
  }));

  R.get('/api/apps/status', H(async (ctx, req, res) => {
    res.json({ ok: true, status: await appStatus(ctx.query.get('image') || '') });
  }));

  R.get('/api/apps/known', H(async (ctx, req, res) => {
    res.json({ ok: true, items: KNOWN_APPS });
  }));

  /* ---- recordings ------------------------------------------------------ */
  R.post('/api/recordings/finalize', H(async (ctx, req, res) => {
    requireFields(ctx.body, ['source']);
    const result = finalizeRecording(ctx, {
      nickname: ctx.account.nickname,
      title: ctx.body.title || 'live',
      record: ctx.body
    });
    res.json({ ok: true, recording: result });
  }));

  R.get('/api/recordings', H(async (ctx, req, res) => {
    fs.mkdirSync(PATHS.recordings, { recursive: true });
    const items = fs.readdirSync(PATHS.recordings).map((name) => {
      const st = fs.statSync(path.join(PATHS.recordings, name));
      return { name, size: st.size, at: st.mtimeMs };
    }).sort((a, b) => b.at - a.at);
    res.json({ ok: true, items, dir: PATHS.recordings });
  }));

  /* ---- maintenance ----------------------------------------------------- */
  /* ---- logs (settings page tails these) ------------------------------- */
  R.get('/api/logs/tail', H(async (ctx, req, res) => {
    const n = Number(ctx.query.get('n')) || 200;
    res.json({ ok: true, lines: logger.tail(n), dir: PATHS.log, files: logger.listFiles() });
  }));

  R.get('/api/logs/files', H(async (ctx, req, res) => {
    res.json({ ok: true, dir: PATHS.log, files: logger.listFiles() });
  }));

  R.post('/api/logs/open', H(async (ctx, req, res) => {
    const { spawn } = await import('node:child_process');
    try { spawn('explorer.exe', [PATHS.log], { detached: true, stdio: 'ignore' }).unref(); } catch (err) { /* ignore */ }
    res.json({ ok: true, dir: PATHS.log });
  }));

  R.get('/api/health', H(async (ctx, req, res) => {
    res.json({
      ok: true, uptimeSec: Math.round(process.uptime()), pid: process.pid,
      node: process.version, memoryMB: Math.round(process.memoryUsage().rss / 1048576),
      hub: hub.stats(), transport: transport.transportSummary()
    });
  }));

  R.post('/api/maintenance/backup', H(async (ctx, req, res) => {
    res.json({ ok: true, file: store.backup('manual') });
  }));

  return R;
}

/** Rename + move a finished recording according to the room's replay settings. */
function finalizeRecording(ctx, room) {
  try {
    const rec = room.record || {};
    const template = rec.template || rec.naming || '%CCYY-%MM-%DD_%HH-%mm-%SS_%UN';
    const index = store.db.counters.live || 1;
    const base = formatRecordingName(template, { date: new Date(), index, username: room.nickname || 'user' });
    const format = String(rec.format || 'mp4').replace(/^\./, '');
    const dir = rec.savePath || PATHS.recordings;
    fs.mkdirSync(dir, { recursive: true });
    const target = path.join(dir, base + '.' + format);
    let moved = false;
    if (rec.source && fs.existsSync(rec.source)) {
      fs.renameSync(rec.source, target);
      moved = true;
    } else {
      fs.writeFileSync(target, '');
    }
    log('recording finalised ->', target);
    return { name: path.basename(target), path: target, moved, template, format, at: now() };
  } catch (err) {
    log('finalizeRecording failed:', err.message);
    return { error: err.message };
  }
}

export default { mount };
