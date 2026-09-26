/* EasyVideo - social surface: recommendations, reactions, comments, plugins.
 *
 * Mounted from api.js so the domain router stays readable:
 *
 *   mountSocial(R, H, deps)
 *
 * R is the Router, H wraps a handler so thrown errors become JSON failures,
 * and deps carries the few things this module needs from the domain layer
 * (store, the account resolver, the recommender and the plugin host).
 *
 * Endpoints
 *   GET    /api/recommend?kind=video|live&limit&exclude
 *   GET    /api/recommend/profile
 *   POST   /api/recommend/learn        { item, weight }
 *   POST   /api/recommend/forget
 *   GET    /api/reactions/:refId
 *   POST   /api/reactions/:refId       { kind, delta }
 *   GET    /api/comments/:refId
 *   POST   /api/comments/:refId        { text, kind }
 *   POST   /api/comments/:refId/:id/like
 *   DELETE /api/comments/:refId/:id
 *   GET    /api/plugins
 *   GET    /api/plugins/dirs
 *   POST   /api/plugins/install        (raw .evp body)
 *   POST   /api/plugins/build          { package } -> .evp download
 *   DELETE /api/plugins/:name
 *   GET    /api/social/stats
 */
import zlib from 'node:zlib';
import * as recommend from './recommend.js';
import * as plugins from './plugins.js';
import { safeName } from './util.js';
import * as uploader from './uploader.js';

/** Public shape of a live room card. */
function liveCard(room) {
  const r = room || {};
  return {
    id: r.id, kind: 'live', pid: r.pid, title: r.title || r.roomName || '',
    roomName: r.roomName || '', blurb: r.blurb || '', author: r.author || '',
    authorId: r.authorId || null, avatar: r.avatar || null,
    mode: r.mode || 'BT', resolution: r.resolution || '', fps: r.fps || 30,
    bitrateKbps: r.bitrateKbps || 0, viewers: r.viewers || 0,
    secret: !!r.secret, startedAt: r.startedAt || r.createdAt || null,
    tags: r.tags || [], collection: r.collection || ''
  };
}

/** Public shape of a video card. */
function videoCard(video) {
  const v = video || {};
  return {
    id: v.id, kind: 'video', pid: v.pid, title: v.title || '', blurb: v.blurb || '',
    author: v.author || '', authorId: v.authorId || null, avatar: v.avatar || null,
    collection: v.collection || '', resolution: v.resolution || '',
    fps: v.fps || 30, bitrateKbps: v.bitrateKbps || 0, durationSec: v.durationSec || 0,
    views: v.views || 0, secret: !!v.secret, createdAt: v.createdAt || null,
    files: Array.isArray(v.files) ? v.files.length : 0, tags: v.tags || []
  };
}

export function mountSocial(R, H, deps) {
  const store = deps.store;
  const currentAccount = deps.currentAccount;
  const accountIdOf = (ctx) => ((ctx.account && ctx.account.id) || 'local');

  /* ---- recommendation ------------------------------------------------- */

  R.get('/api/recommend', H(async (ctx, req, res, params) => {
    const kind = String(ctx.query.get('kind') || 'video');
    const limit = Number(ctx.query.get('limit') || 12);
    const exclude = {};
    const not = String(ctx.query.get('exclude') || '');
    if (not) for (const id of not.split(',')) if (id) exclude[id] = true;
    const pool = kind === 'live'
      ? store.list('liveRooms').filter((r) => r.status === 'live' && !r.deletedAt).map(liveCard)
      : store.list('videos').filter((v) => !v.deletedAt).map(videoCard);
    const accountId = accountIdOf(ctx);
    const picked = recommend.recommend(pool, { accountId: accountId, limit: limit, exclude: exclude });
    res.json({
      ok: true, kind: kind, total: pool.length,
      items: picked.map((row) => Object.assign({}, row.item, {
        score: row.score, rank: row.rank, counts: recommend.counts(row.item.id)
      })),
      profile: recommend.profile(accountId)
    });
  }));

  R.get('/api/recommend/profile', H(async (ctx, req, res, params) => {
    res.json({ ok: true, profile: recommend.profile(accountIdOf(ctx)) });
  }));

  R.post('/api/recommend/learn', H(async (ctx, req, res, params) => {
    const body = ctx.body || {};
    const weight = Number(body.weight) || 1;
    const accountId = accountIdOf(ctx);
    const info = recommend.learn(accountId, body.item || body, weight);
    res.json({ ok: true, learned: info, profile: recommend.profile(accountId) });
  }));

  R.post('/api/recommend/forget', H(async (ctx, req, res, params) => {
    recommend.forget(accountIdOf(ctx));
    res.json({ ok: true });
  }));

  /* ---- reactions ------------------------------------------------------ */

  R.get('/api/reactions/:refId', H(async (ctx, req, res, params) => {
    res.json({ ok: true, counts: recommend.counts(params.refId) });
  }));

  R.post('/api/reactions/:refId', H(async (ctx, req, res, params) => {
    const body = ctx.body || {};
    const kind = String(body.kind || 'like');
    const delta = Number(body.delta);
    const counts = recommend.react(params.refId, kind, Number.isFinite(delta) ? delta : 1);
    res.json({ ok: true, counts: counts });
  }));

  /* ---- comments ------------------------------------------------------- */

  R.get('/api/comments/:refId', H(async (ctx, req, res, params) => {
    const items = recommend.listComments(params.refId, Number(ctx.query.get('limit') || 50));
    res.json({ ok: true, items: items, total: items.length });
  }));

  R.post('/api/comments/:refId', H(async (ctx, req, res, params) => {
    const body = ctx.body || {};
    const acc = currentAccount(store.db);
    const row = recommend.addComment({
      kind: body.kind || 'video', refId: params.refId,
      accountId: acc.id, author: acc.nickname, text: body.text
    });
    res.json({ ok: true, comment: row });
  }));

  R.post('/api/comments/:refId/:id/like', H(async (ctx, req, res, params) => {
    res.json({ ok: true, comment: recommend.likeComment(params.id) });
  }));

  R.del('/api/comments/:refId/:id', H(async (ctx, req, res, params) => {
    const acc = currentAccount(store.db);
    const done = recommend.removeComment(params.id, acc.id);
    if (!done) throw Object.assign(new Error('评论不存在或无权删除'), { status: 404 });
    res.json({ ok: true });
  }));

  /* ---- plugins -------------------------------------------------------- */

  R.get('/api/plugins', H(async (ctx, req, res, params) => {
    res.json({ ok: true, items: plugins.pluginList(), stats: plugins.pluginStats(), panels: plugins.pluginPanels() });
  }));

  R.get('/api/plugins/dirs', H(async (ctx, req, res, params) => {
    res.json({ ok: true, dirs: plugins.PLUGIN_DIRS(), zstd: typeof zlib.zstdCompressSync === 'function' });
  }));

  R.post('/api/plugins/install', H(async (ctx, req, res, params) => {
    if (!ctx.rawBody || !ctx.rawBody.length) throw Object.assign(new Error('缺少插件包内容'), { status: 400 });
    const info = plugins.installPackage(ctx.rawBody, ctx.query.get('name') || 'upload.evp');
    res.json({ ok: true, manifest: info.manifest, file: info.file, reload: 'restart-required' });
  }));

  R.post('/api/plugins/build', H(async (ctx, req, res, params) => {
    const body = ctx.body || {};
    const packed = plugins.encodePackage(body.package || body);
    const name = safeName(body.name || 'plugin', 'plugin') + '.evp';
    res.buffer(packed.buffer, 'application/octet-stream', {
      'x-ev-codec': packed.codec,
      'content-disposition': 'attachment; filename=' + JSON.stringify(name)
    });
  }));

  R.del('/api/plugins/:name', H(async (ctx, req, res, params) => {
    const removed = plugins.removePlugin(params.name);
    if (!removed) throw Object.assign(new Error('插件不存在'), { status: 404 });
    res.json({ ok: true, removed: removed });
  }));

  /* ---- upload acceleration (uploadtool/FastGithub, Steam++) ------------ */

  R.get('/api/uploader', H(async (ctx, req, res, params) => {
    res.json({ ok: true, available: uploader.available(), state: uploader.state(), running: uploader.isRunning() });
  }));

  R.post('/api/uploader/configure', H(async (ctx, req, res, params) => {
    const body = ctx.body || {};
    const next = uploader.configure({
      enabled: !!body.enabled,
      autostart: !!body.autostart,
      headless: body.headless !== false,
      accelerator: body.accelerator || null
    });
    res.json({ ok: true, state: next, available: uploader.available() });
  }));

  R.post('/api/uploader/start', H(async (ctx, req, res, params) => {
    const body = ctx.body || {};
    res.json({ ok: true, result: uploader.start(body.accelerator || undefined), available: uploader.available() });
  }));

  R.post('/api/uploader/stop', H(async (ctx, req, res, params) => {
    const body = ctx.body || {};
    res.json({ ok: true, result: uploader.stop(body.accelerator || undefined) });
  }));

  R.get('/api/uploader/plan', H(async (ctx, req, res, params) => {
    res.json({ ok: true, plan: uploader.uploadPlan(Number(ctx.query.get('bytes') || 0)) });
  }));

  R.get('/api/social/stats', H(async (ctx, req, res, params) => {
    res.json({ ok: true, stats: recommend.commentStats(), plugins: plugins.pluginStats() });
  }));

  return R;
}

export default { mountSocial };
