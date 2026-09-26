/* EasyVideo - end-to-end acceptance suite.
 *
 * Boots a real server on a scratch port, then drives the two product
 * lifecycles and every HTTP/WebSocket surface through their public contracts:
 *
 *   A  bootstrap + accounts
 *   B  live:   create -> list -> open -> join -> WS(join/chat/publish/have/want)
 *              -> swarm -> end -> replay recording finalised
 *   C  video:  upload -> publish(upload) -> open -> parts -> Range
 *              -> publish(local) -> local streaming -> publish(link)
 *   D  drafts: create -> patch -> publish
 *   E  library: history / later / favorites / friends CRUD
 *   F  search: rank, feedback, stats
 *   G  transport: plan + swarm
 *   H  accounts: add / switch / login / delete
 *   I  me + privacy + settings (export / import)
 *   J  apps / recordings / logs / health / backup
 *   K  every SPA route serves the shell; unknown API returns 404 JSON
 *
 * Writes temp/e2e.txt and exits non-zero when anything failed.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = 'D:/dev/DeepSeekHarnessWorkspace/EasyVideo';
const PORT = 14000 + Math.floor(Math.random() * 2000);
const BASE = 'http://127.0.0.1:' + PORT;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
let failures = 0;
let checks = 0;
let accountId = null;

function log(line) { results.push(line); }
function ok(name, extra) { checks++; log('PASS  ' + name + (extra === undefined ? '' : '  [' + extra + ']')); }
function bad(name, why) { checks++; failures++; log('FAIL  ' + name + '  -> ' + why); }
function section(t) { log(''); log('== ' + t + ' =='); }

async function req(method, url, body, opts) {
  const o = opts || {};
  const headers = Object.assign({}, o.headers || {});
  if (accountId) headers['x-ev-account'] = accountId;
  let payload;
  if (body !== undefined && body !== null) {
    if (o.raw) { payload = body; headers['content-type'] = 'application/octet-stream'; }
    else { payload = JSON.stringify(body); headers['content-type'] = 'application/json'; }
  }
  const res = await fetch(BASE + url, { method, headers, body: payload });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (e) { json = null; }
  return { status: res.status, text, json, headers: res.headers };
}

async function expectOk(name, method, url, body, opts) {
  try {
    const r = await req(method, url, body, opts);
    if (!r.json || r.json.ok !== true) {
      bad(name, method + ' ' + url + ' -> ' + r.status + ' ' + r.text.slice(0, 140));
      return null;
    }
    ok(name, r.status);
    return r.json;
  } catch (err) { bad(name, err.message); return null; }
}

function expect(name, condition, detail) {
  if (condition) ok(name, detail); else bad(name, detail || 'condition false');
}

/* ------------------------------------------------------------- websocket */

function wsProbe(streamId) {
  return new Promise((resolve) => {
    const frames = [];
    let ws;
    const done = () => { try { ws.close(); } catch (e) { /* closed */ } resolve(frames); };
    try {
      ws = new WebSocket('ws://127.0.0.1:' + PORT + '/ws?peer=e2e-peer&name=E2E');
    } catch (err) { resolve([{ t: 'error', error: err.message }]); return; }
    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({ t: 'ping' }));
      ws.send(JSON.stringify({ t: 'join', streamId }));
      ws.send(JSON.stringify({ t: 'publish', streamId }));
      ws.send(JSON.stringify({ t: 'chat', streamId, text: 'e2e hello' }));
      ws.send(JSON.stringify({ t: 'have', streamId, index: 0 }));
      ws.send(JSON.stringify({ t: 'want', streamId, index: 0 }));
      ws.send(JSON.stringify({ t: 'stat', stats: { sent: 1, received: 2 } }));
    });
    ws.addEventListener('message', (ev) => {
      try { frames.push(JSON.parse(String(ev.data))); } catch (e) { /* ignore */ }
    });
    ws.addEventListener('error', () => done());
    setTimeout(done, 2500);
  });
}

/* ------------------------------------------------------------------ main */

const child = spawn(process.execPath, [path.join(root, 'src', 'server', 'main.js'), '--no-tray', '--no-window', '--silent'], {
  cwd: root,
  env: Object.assign({}, process.env, { EV_PORT: String(PORT), EV_HOST: '127.0.0.1' }),
  stdio: 'ignore'
});

async function waitReady() {
  for (let i = 0; i < 60; i++) {
    try { const r = await req('GET', '/api/health'); if (r.status === 200) return true; } catch (e) { /* not yet */ }
    await sleep(400);
  }
  return false;
}

try {
  if (!(await waitReady())) throw new Error('server never became ready on port ' + PORT);
  log('EasyVideo E2E - port ' + PORT + ' - ' + new Date().toISOString());

  /* ---------------------------------------------------------------- A */
  section('A  bootstrap + accounts');
  const boot = await expectOk('GET /api/bootstrap', 'GET', '/api/bootstrap');
  if (boot && boot.account) { accountId = boot.account.id; }
  expect('bootstrap exposes account', !!(boot && boot.account && boot.account.nickname), boot && boot.account && boot.account.nickname);
  expect('bootstrap exposes transport modes', !!(boot && boot.transport && boot.transport.modes && boot.transport.modes.length === 3), boot && boot.transport && boot.transport.modes.join('/'));
  expect('bootstrap exposes paths', !!(boot && boot.paths && boot.paths.data), boot && boot.paths && boot.paths.data);
  expect('bootstrap counts present', !!(boot && boot.counts), JSON.stringify(boot && boot.counts));
  await expectOk('GET /api/accounts', 'GET', '/api/accounts');

  /* ---------------------------------------------------------------- B */
  section('B  live lifecycle');
  const roomRes = await expectOk('POST /api/live (create BT room)', 'POST', '/api/live', {
    roomName: 'E2E 测试房间', title: 'E2E 直播标题', blurb: 'E2E 直播简介',
    mode: 'BT', resolution: '1280x720', fps: 30, bitrateKbps: 2500,
    duration: 'permanent', app: 'obs64.exe', limit: 0,
    showDanmaku: true, secret: false, replay: true,
    record: { app: 'obs64.exe', savePath: path.join(root, 'data', 'recordings'), template: '%CCYY-%MM-%DD_%HH-%mm-%SS_%UN', format: 'mp4' }
  });
  const room = roomRes && roomRes.room;
  expect('room returned with pid', !!(room && room.pid), room && room.pid);
  expect('room ev:// url built', !!(roomRes && roomRes.ev && roomRes.ev.indexOf('ev://live/') === 0), roomRes && roomRes.ev);
  expect('room path built', !!(roomRes && roomRes.path), roomRes && roomRes.path);

  const liveList = await expectOk('GET /api/live', 'GET', '/api/live');
  expect('created room listed', !!(liveList && liveList.items.some((x) => x.id === room.id)), liveList && liveList.items.length + ' rooms');

  const roomOpen = await expectOk('GET /api/live/:nick/:pid', 'GET', '/api/live/' + encodeURIComponent(room.author) + '/' + encodeURIComponent(room.pid));
  expect('room detail returns swarm block', !!(roomOpen && 'swarm' in roomOpen), roomOpen && typeof roomOpen.swarm);

  const join = await expectOk('POST /api/live/:id/join', 'POST', '/api/live/' + room.id + '/join');
  const streamId = join && join.streamId;
  expect('join returns streamId', !!streamId, streamId);
  expect('join reports BT mode', !!(join && join.mode === 'BT'), join && join.mode);

  const frames = await wsProbe(streamId);
  const types = frames.map((f) => f.t);
  expect('WS hello received', types.indexOf('hello') >= 0, types.join(','));
  expect('WS pong received', types.indexOf('pong') >= 0, types.join(','));
  expect('WS room membership received', types.indexOf('room') >= 0, types.join(','));
  expect('WS chat broadcast received', types.indexOf('chat') >= 0, types.join(','));
  expect('WS provider answer received', types.indexOf('provider') >= 0, types.join(','));

  const swarm = await expectOk('GET /api/transport/:streamId/stats', 'GET', '/api/transport/' + encodeURIComponent(streamId) + '/stats');
  expect('swarm stats shaped', !!(swarm && swarm.swarm && typeof swarm.swarm.viewers === 'number'), swarm && swarm.swarm && JSON.stringify({ viewers: swarm.swarm.viewers, segments: swarm.swarm.segments }));

  /* replay: create a fake capture file so finalizeRecording has something to rename */
  const capturePath = path.join(root, 'data', 'recordings', 'e2e-capture.tmp');
  fs.writeFileSync(capturePath, 'e2e recording payload', 'utf8');

  const ended = await expectOk('POST /api/live/:id/end', 'POST', '/api/live/' + room.id + '/end');
  expect('end marks room ended', !!(ended && ended.room && ended.room.status === 'ended'), ended && ended.room && ended.room.status);

  /* second room exercising SERVER + P2P provider selection and replay rename */
  const serverRoom = await expectOk('POST /api/live (create SERVER room)', 'POST', '/api/live', {
    roomName: 'E2E server room', title: 'E2E server title', blurb: 'E2E server blurb',
    mode: 'SERVER', serverIp: '127.0.0.1', serverPort: PORT,
    resolution: '1920x1080', fps: 60, bitrateKbps: 6000, blurb2: 'x'
  });
  expect('SERVER room requires/accepts serverIp', !!(serverRoom && serverRoom.room && serverRoom.room.mode === 'SERVER'), serverRoom && serverRoom.room && serverRoom.room.mode);
  const serverJoin = await expectOk('POST /api/live/:id/join (SERVER)', 'POST', '/api/live/' + serverRoom.room.id + '/join');
  const sFrames = await wsProbe(serverJoin.streamId);
  expect('SERVER provider points at the origin url', sFrames.some((f) => f.t === 'provider' && typeof f.url === 'string'), JSON.stringify(sFrames.filter((f) => f.t === 'provider')[0] || null));
  const rec = await expectOk('POST /api/live/:id/end (replay + rename)', 'POST', '/api/live/' + serverRoom.room.id + '/end');
  expect('recording finalised into data/recordings', !!(rec && rec.recording && rec.recording.name), rec && JSON.stringify(rec.recording || null));

  const p2pRoom = await expectOk('POST /api/live (create P2P room)', 'POST', '/api/live', {
    roomName: 'E2E p2p room', title: 'E2E p2p title', blurb: 'E2E p2p blurb',
    mode: 'P2P', resolution: '1280x720', fps: 30, bitrateKbps: 3000
  });
  expect('P2P room created', !!(p2pRoom && p2pRoom.room), p2pRoom && p2pRoom.room && p2pRoom.room.mode);

  const endedList = await expectOk('GET /api/live?ended=1', 'GET', '/api/live?ended=1');
  expect('ended rooms still listed with ended=1', !!(endedList && endedList.items.length >= 1), endedList && endedList.items.length + ' rooms');

  const searchLive = await expectOk('GET /api/live?q=E2E', 'GET', '/api/live?q=E2E');
  expect('live search ranks results', !!(searchLive && searchLive.items.length >= 1), searchLive && searchLive.items.length + ' hits');

  /* ---------------------------------------------------------------- C */
  section('C  video lifecycle (upload / local / link)');
  const fixture = Buffer.from('E2E-FAKE-MP4-PAYLOAD-'.repeat(400), 'utf8');
  const up = await expectOk('POST /api/upload', 'POST', '/api/upload?name=e2e-clip.mp4&dir=media', fixture, { raw: true });
  const stored = up && up.file && up.file.stored;
  expect('upload returns stored name', !!stored, stored);
  expect('upload returns byte size', !!(up && up.file && up.file.size === fixture.length), up && up.file && up.file.size + ' vs ' + fixture.length);

  const vidUp = await expectOk('POST /api/videos (source=upload)', 'POST', '/api/videos', {
    title: 'E2E 上传视频', blurb: '# E2E 上传来源 多段合集',
    source: 'upload', files: [{ kind: 'upload', name: 'e2e-clip.mp4', stored, size: fixture.length }],
    collection: 'E2E 合集', resolution: '1920x1080', bitrateKbps: 6000, fps: 30,
    feedback: true, secret: false, secretScope: 'friends'
  });
  const vid = vidUp && vidUp.video;
  expect('uploaded video published', !!(vid && vid.pid), vid && vid.pid);
  expect('video ev:// url built', !!(vidUp && vidUp.ev && vidUp.ev.indexOf('ev://video/') === 0), vidUp && vidUp.ev);

  const vidOpen = await expectOk('GET /api/video/:nick/:pid', 'GET', '/api/video/' + encodeURIComponent(vid.author) + '/' + encodeURIComponent(vid.pid));
  const parts = (vidOpen && vidOpen.parts) || [];
  expect('video parts resolved', parts.length === 1 && parts[0].kind === 'upload' && parts[0].external === false, JSON.stringify(parts));

  if (parts[0] && parts[0].url) {
    const full = await fetch(BASE + parts[0].url);
    const fullBuf = Buffer.from(await full.arrayBuffer());
    expect('GET ' + parts[0].url + ' streams the uploaded bytes', full.status === 200 && fullBuf.length === fixture.length, full.status + ' ' + fullBuf.length + 'B');
    const ranged = await fetch(BASE + parts[0].url, { headers: { Range: 'bytes=0-15' } });
    const rBuf = Buffer.from(await ranged.arrayBuffer());
    expect('Range request returns 206 + 16 bytes', ranged.status === 206 && rBuf.length === 16, ranged.status + ' ' + rBuf.length + 'B');
  } else { bad('video part url present', 'no part url'); }

  const localFixture = path.join(root, 'data', 'media', 'e2e-local-source.mp4');
  fs.writeFileSync(localFixture, Buffer.from('LOCAL-E2E-'.repeat(300), 'utf8'));
  const vidLocal = await expectOk('POST /api/videos (source=local)', 'POST', '/api/videos', {
    title: 'E2E 本地链接视频', blurb: '本机文件来源',
    source: 'local', files: [{ kind: 'local', name: 'e2e-local-source.mp4', path: localFixture }],
    resolution: '1280x720', bitrateKbps: 3000, fps: 30, feedback: true
  });
  const localVideo = vidLocal && vidLocal.video;
  const localOpen = await expectOk('GET /api/video/:nick/:pid (local)', 'GET', '/api/video/' + encodeURIComponent(localVideo.author) + '/' + encodeURIComponent(localVideo.pid));
  const localPart = (localOpen && localOpen.parts && localOpen.parts[0]) || null;
  expect('local part marked kind=local', !!(localPart && localPart.kind === 'local'), JSON.stringify(localPart));
  if (localPart && localPart.url) {
    const res = await fetch(BASE + localPart.url, { headers: { Range: 'bytes=0-9' } });
    const buf = Buffer.from(await res.arrayBuffer());
    expect('local media proxied with Range', res.status === 206 && buf.length === 10, res.status + ' ' + buf.length + 'B');
  } else { bad('local part url present', 'no url'); }

  const vidLink = await expectOk('POST /api/videos (source=link)', 'POST', '/api/videos', {
    title: 'E2E 外链视频', blurb: '外部链接来源',
    source: 'link', files: [{ kind: 'link', name: 'remote.mp4', url: 'https://example.com/remote.mp4' }],
    resolution: '1280x720', bitrateKbps: 3000, fps: 30
  });
  const linkVideo = vidLink && vidLink.video;
  const linkOpen = await expectOk('GET /api/video/:nick/:pid (link)', 'GET', '/api/video/' + encodeURIComponent(linkVideo.author) + '/' + encodeURIComponent(linkVideo.pid));
  const linkPart = (linkOpen && linkOpen.parts && linkOpen.parts[0]) || null;
  expect('link part marked external', !!(linkPart && linkPart.external === true && linkPart.url === 'https://example.com/remote.mp4'), JSON.stringify(linkPart));

  const vidList = await expectOk('GET /api/videos', 'GET', '/api/videos');
  expect('videos listed (3+ published)', !!(vidList && vidList.items.length >= 3), vidList && vidList.items.length + ' videos');
  const vidSearch = await expectOk('GET /api/videos?q=E2E', 'GET', '/api/videos?q=E2E');
  expect('video search ranks results', !!(vidSearch && vidSearch.items.length >= 1), vidSearch && vidSearch.items.length + ' hits');

  /* ---------------------------------------------------------------- D */
  section('D  drafts lifecycle');
  const draftRes = await expectOk('POST /api/drafts', 'POST', '/api/drafts', {
    name: 'E2E 草稿', title: 'E2E 草稿标题', blurb: '草稿简介', feedback: true,
    source: 'upload', files: [{ kind: 'upload', name: 'e2e-clip.mp4', stored, size: fixture.length }],
    resolution: '1920x1080', bitrateKbps: 6000, fps: 30
  });
  const draft = draftRes && draftRes.draft;
  expect('draft created', !!(draft && draft.id), draft && draft.id);
  const draftList = await expectOk('GET /api/drafts', 'GET', '/api/drafts');
  expect('draft listed', !!(draftList && draftList.items.some((d) => d.id === draft.id)), draftList && draftList.items.length + ' drafts');
  await expectOk('PATCH /api/drafts/:id', 'PATCH', '/api/drafts/' + draft.id, { title: 'E2E 草稿标题（已改）' });
  const published = await expectOk('POST /api/drafts/:id/publish', 'POST', '/api/drafts/' + draft.id + '/publish');
  expect('published draft becomes a video', !!(published && published.video && published.video.pid), published && published.path);
  const afterPublish = await expectOk('GET /api/drafts (after publish)', 'GET', '/api/drafts');
  expect('published draft removed from drafts', !!(afterPublish && !afterPublish.items.some((d) => d.id === draft.id)), afterPublish && afterPublish.items.length + ' drafts');

  /* ---------------------------------------------------------------- E */
  section('E  library CRUD (history / later / favorites / friends)');
  for (const coll of ['history', 'later', 'favorites', 'friends']) {
    const added = await expectOk('POST /api/' + coll, 'POST', '/api/' + coll, {
      refId: vid.id, kind: 'video', title: 'E2E 收藏目标', author: vid.author, url: vidUp.ev
    });
    const item = added && added.item;
    const listed = await expectOk('GET /api/' + coll, 'GET', '/api/' + coll);
    expect('item visible in ' + coll, !!(listed && item && listed.items.some((x) => x.id === item.id)), listed && listed.items.length + ' rows');
    if (item) await expectOk('DELETE /api/' + coll + '/:id', 'DELETE', '/api/' + coll + '/' + item.id);
  }
  await expectOk('POST /api/later (before clear-all)', 'POST', '/api/later', { refId: vid.id, kind: 'video', title: 'x' });
  await expectOk('DELETE /api/later/all?all=1', 'DELETE', '/api/later/all?all=1');
  const cleared = await expectOk('GET /api/later (after clear)', 'GET', '/api/later');
  expect('clear-all emptied the list', !!(cleared && cleared.items.length === 0), cleared && cleared.items.length);

  /* ---------------------------------------------------------------- F */
  section('F  search + on-device ranker');
  await expectOk('GET /api/search?kind=live', 'GET', '/api/search?kind=live&q=E2E');
  await expectOk('GET /api/search?kind=video', 'GET', '/api/search?kind=video&q=E2E');
  const fb1 = await expectOk('POST /api/search/feedback (positive)', 'POST', '/api/search/feedback', { kind: 'video', query: 'E2E', docId: vid.id, label: 1 });
  expect('feedback returns live ranker stats', !!(fb1 && fb1.stats && fb1.stats.parameters > 0), fb1 && JSON.stringify({ params: fb1.stats && fb1.stats.parameters, samples: fb1.stats && fb1.stats.samples }));
  await expectOk('POST /api/search/feedback (negative)', 'POST', '/api/search/feedback', { kind: 'live', query: 'E2E', docId: room.id, label: 0 });
  const stats = await expectOk('GET /api/search/stats', 'GET', '/api/search/stats');
  expect('two rankers reported', !!(stats && stats.stats.live && stats.stats.video), stats && JSON.stringify({ live: stats.stats.live.samples, video: stats.stats.video.samples }));
  expect('ranker budget is 64M parameters', !!(stats && stats.stats.live.parameterBudget === 67108864), stats && stats.stats.live.parameterBudget);

  /* ---------------------------------------------------------------- G */
  section('G  transport');
  const tr = await expectOk('GET /api/transport', 'GET', '/api/transport');
  expect('transport summary lists three modes', !!(tr && tr.transport.modes.length === 3), tr && tr.transport.modes.join('/'));
  const plan = await expectOk('POST /api/transport/plan', 'POST', '/api/transport/plan', { viewers: 10, bitrateKbps: 6000 });
  expect('plan returns 3 uplink numbers', !!(plan && plan.plan && plan.plan.P2P > plan.plan.BT), plan && JSON.stringify(plan.plan));

  /* ---------------------------------------------------------------- H */
  section('H  accounts');
  const acc = await expectOk('POST /api/accounts', 'POST', '/api/accounts', { nickname: 'E2E 账号', username: 'e2e_user_' + Date.now(), password: 'e2e-secret', gender: 'undisclosed' });
  const newAcc = acc && acc.account;
  expect('new account is current', !!(newAcc && newAcc.id === (acc.account.id)), newAcc && newAcc.nickname);
  await expectOk('POST /api/accounts/:id/switch (back)', 'POST', '/api/accounts/' + accountId + '/switch');
  const login = await expectOk('POST /api/accounts/login', 'POST', '/api/accounts/login', { username: newAcc.username, password: 'e2e-secret' });
  expect('login with password succeeds', !!(login && login.account), login && login.account && login.account.nickname);
  await expectOk('POST /api/accounts/:id/switch (main)', 'POST', '/api/accounts/' + accountId + '/switch');
  await expectOk('DELETE /api/accounts/:id', 'DELETE', '/api/accounts/' + newAcc.id);
  await expectOk('POST /api/accounts/login (wrong password) rejects', 'POST', '/api/accounts/login', { username: newAcc.username, password: 'nope' });

  /* ---------------------------------------------------------------- I */
  section('I  profile / privacy / settings');
  await expectOk('GET /api/me', 'GET', '/api/me');
  const me = await expectOk('PATCH /api/me', 'PATCH', '/api/me', { name: 'E2E 姓名', gender: 'undisclosed', birthday: '1990-01-01', preferences: { favorite: '咖啡', liked: ['音乐'], loved: ['电影', '代码', '夜景'] } });
  expect('preferences limited to 1/2/3', !!(me && me.account.preferences && me.account.preferences.loved.length === 3), me && JSON.stringify(me.account.preferences));
  await expectOk('GET /api/me/privacy', 'GET', '/api/me/privacy');
  const priv = await expectOk('PATCH /api/me/privacy', 'PATCH', '/api/me/privacy', { uploadLogs: false, publicProfile: { fans: true, name: true } });
  expect('privacy publicProfile persisted', !!(priv && priv.privacy.publicProfile.name === true), priv && JSON.stringify(priv.privacy.publicProfile));
  await expectOk('GET /api/settings', 'GET', '/api/settings');
  await expectOk('PATCH /api/settings', 'PATCH', '/api/settings', { defaultMode: 'BT', showDanmaku: true });
  const exp = await expectOk('GET /api/settings/export', 'GET', '/api/settings/export?models=1');
  expect('export contains a settings envelope', !!(exp && exp.payload && exp.payload.format === 'easyvideo-settings'), exp && exp.payload && exp.payload.format);
  expect('export carries the trained models', !!(exp && exp.payload.models && exp.payload.models.video), exp && !!exp.payload.models);
  if (exp && exp.payload) await expectOk('POST /api/settings/import', 'POST', '/api/settings/import', { payload: exp.payload, mergeSocial: false });

  /* ---------------------------------------------------------------- J */
  section('J  apps / recordings / logs / health / maintenance');
  const apps = await expectOk('GET /api/apps/running', 'GET', '/api/apps/running');
  expect('running-apps list is running-only', !!(apps && apps.onlyRunning === true), apps && apps.items.length + ' processes');
  await expectOk('GET /api/apps/running?q=obs', 'GET', '/api/apps/running?q=obs');
  await expectOk('GET /api/apps/status', 'GET', '/api/apps/status?image=obs64.exe');
  await expectOk('GET /api/apps/known', 'GET', '/api/apps/known');
  const recs = await expectOk('GET /api/recordings', 'GET', '/api/recordings');
  expect('recordings dir listed', !!(recs && Array.isArray(recs.items)), recs && recs.items.length + ' files');
  const logs = await expectOk('GET /api/logs/tail', 'GET', '/api/logs/tail?n=50');
  expect('log tail returns lines', !!(logs && Array.isArray(logs.lines) && logs.lines.length > 0), logs && logs.lines.length + ' lines');
  await expectOk('GET /api/logs/files', 'GET', '/api/logs/files');
  const health = await expectOk('GET /api/health', 'GET', '/api/health');
  expect('health reports hub + transport', !!(health && health.hub && health.transport), health && JSON.stringify({ peers: health.hub.peers, streams: health.transport.streams }));
  await expectOk('POST /api/maintenance/backup', 'POST', '/api/maintenance/backup');

  /* ---------------------------------------------------------------- K */
  section('K  SPA routes + 404 handling');
  const routes = ['/', '/home/', '/home/myself/', '/home/mydata/', '/home/privacy/', '/home/settings/',
    '/home/history/', '/home/later/', '/home/favorites/', '/home/friends/',
    '/live/home/', '/live/newlive/', '/video/home/', '/video/release/', '/video/draft/new/',
    '/live/E2E/' + room.pid + '/', '/video/' + encodeURIComponent(vid.author) + '/' + vid.pid + '/'];
  for (const p of routes) {
    const res = await fetch(BASE + p);
    const text = await res.text();
    const shell = res.status === 200 && text.includes('rail-nav');
    if (shell) ok('route ' + p + ' serves the SPA shell'); else bad('route ' + p, res.status + ' ' + text.slice(0, 80));
  }
  const missing = await req('GET', '/api/does-not-exist');
  expect('unknown API route answers 404 JSON', missing.status === 404 && !!missing.json && missing.json.ok === false, missing.status + ' ' + missing.text.slice(0, 60));

  /* ------------------------------------------------------------ summary */
  section('SUMMARY');
  log('checks=' + checks + ' failures=' + failures);
} catch (err) {
  failures++;
  log('FATAL ' + (err && err.stack ? err.stack : err));
} finally {
  try { child.kill(); } catch (e) { /* gone */ }
  await sleep(400);
  fs.writeFileSync(path.join(root, 'temp', 'e2e.txt'), results.join(String.fromCharCode(10)), 'utf8');
  console.log('E2E checks=' + checks + ' failures=' + failures + ' -> temp/e2e.txt');
  process.exit(failures === 0 ? 0 : 1);
}
