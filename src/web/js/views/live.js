/* EasyVideo - views/live.js
 * 直播广场、直播搜索、新建直播房间、直播间。
 * 直播广场第一张卡占两列作为主视觉；表单里“直播软件”只列出此刻正在运行的进程。
 */
import { api } from '../api.js';
import { state } from '../store.js';
import { navigate } from '../router.js';
import { realtime } from '../app.js';
import {
  el, icon, iconButton, field, input, textarea, select, radio, checkbox,
  chip, tagChip, panel, stat, meter, fmtBitrate, fmtPct, fmtAgo, fmtDuration,
  formatTemplate, TEMPLATE_TOKENS, toast, skeleton, emptyState, notFound,
  confirmDialog, copyText, b64, unb64
} from '../ui.js';
import {
  paint, viewHead, btn, iconBtn, errorState, loadingCards, sectionHead, tel,
  liveGrid, addDisposer, posterBox, liveRoute
} from './kit.js';

const MODES = ['P2P', 'BT', 'SERVER'];
const MODE_TEXT = {
  P2P: 'P2P：单对多，主机上行带宽要求极高，观看人数多时延迟升高。',
  BT: 'BT：主机把不同数据分片发给随机观众，观众之间互相转发，理论上人越多越快。',
  SERVER: 'SERVER：由服务器统一分发数据包。'
};
const PID_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ23456789';
const DEFAULT_TEMPLATE = '%CCYY-%MM-%DD_%HH-%mm-%SS_%UN';
const RESOLUTIONS = ['3840x2160', '2560x1440', '1920x1080', '1280x720', '854x480'];
const FPS_LIST = ['24', '30', '60', '120'];

/* ---------------------------------------------------------------- helpers */

function genPid() {
  const buf = new Uint8Array(6);
  if (window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(buf);
  else for (let i = 0; i < 6; i++) buf[i] = Math.floor(Math.random() * 256);
  let out = '';
  for (let i = 0; i < 6; i++) out += PID_CHARS.charAt(buf[i] % PID_CHARS.length);
  return out;
}

function validPid(value) {
  const text = String(value || '').toUpperCase();
  if (text.length !== 6) return false;
  for (let i = 0; i < 6; i++) if (PID_CHARS.indexOf(text.charAt(i)) < 0) return false;
  return true;
}

function roomPath(card) {
  const c = card || {};
  if (c.path) return c.path;
  const base = c.secret ? '/live/secret/' : '/live/';
  return base + encodeURIComponent(c.author || '') + '/' + encodeURIComponent(c.pid || '') + '/';
}

/** 只列出此刻正在运行的软件：服务器端只返回运行中的进程。 */
function runningAppSelect(selected, onChange) {
  const box = el('<div class="row"></div>');
  const sel = select([{ value: '', label: '正在检测…' }], { value: selected || '' });
  const manual = input({ value: selected || '', placeholder: '或直接填写进程名' });
  manual.style.display = 'none';
  const refresh = iconBtn('refresh-cw', '重新检测运行中的软件', '', function () { load(); });
  let showAll = false;
  const toggle = chip('手动填写', { onClick: function () {
    const on = manual.style.display === 'none';
    manual.style.display = on ? '' : 'none';
    sel.style.display = on ? 'none' : '';
    toggle.classList.toggle('chip-ok', on);
  } });
  const allChip = chip('显示全部进程', { onClick: function () {
    showAll = !showAll;
    allChip.classList.toggle('chip-ok', showAll);
    load();
  } });
  const hint = el('<p class="field-hint"></p>');

  function emit() { if (onChange) onChange(manual.style.display === 'none' ? sel.value : manual.value); }
  sel.addEventListener('change', emit);
  manual.addEventListener('input', emit);

  /** 录制软件优先列在前面；默认只列这些，避免上百个系统进程淹没列表。 */
  function isCapture(app) {
    return app.known === true || app.capture === true;
  }

  async function load() {
    sel.disabled = true;
    try {
      const r = await api.runningApps('');
      const all = r.items || [];
      const capture = all.filter(isCapture);
      const rest = all.filter(function (a) { return !isCapture(a); });
      const items = showAll ? capture.concat(rest) : capture;
      sel.innerHTML = '';
      const first = el('<option value=""></option>');
      first.value = '';
      first.textContent = capture.length ? ('选择正在运行的软件（检测到 ' + capture.length + ' 个）') : '没有检测到正在运行的录制软件';
      sel.appendChild(first);
      if (!items.length) {
        const none = el('<option value="" disabled></option>');
        none.textContent = showAll ? '（没有检测到任何进程）' : '（勾选“显示全部进程”可列出所有运行中的程序）';
        sel.appendChild(none);
      } else {
        const group = el('<optgroup label="正在运行"></optgroup>');
        for (const app of items) {
          const o = el('<option></option>');
          o.value = app.image;
          o.textContent = app.label + '  ·  ' + app.image + (app.instances > 1 ? '  ×' + app.instances : '') + (app.pid ? '  pid ' + app.pid : '');
          group.appendChild(o);
        }
        sel.appendChild(group);
      }
      if (selected) sel.value = selected;
      hint.textContent = capture.length
        ? ('只列出此刻真正在运行的软件；检测到 ' + capture.map(function (a) { return a.label; }).join('、') + '。')
        : '没有检测到 OBS、Streamlabs、Bandicam 等录制软件；先打开它们再点右侧刷新。';
    } catch (err) {
      hint.textContent = '读取运行中的软件失败：' + (err && err.message ? err.message : '未知错误');
    } finally {
      sel.disabled = false;
    }
  }
  load();

  box.appendChild(sel);
  box.appendChild(manual);
  box.appendChild(refresh);
  box.appendChild(toggle);
  box.appendChild(allChip);
  const wrap = el('<div class="stack-tight"></div>');
  wrap.appendChild(box);
  wrap.appendChild(hint);
  wrap.loadApps = load;
  return wrap;
}

/* -------------------------------------------------------------- 直播广场 */

export async function renderLiveHome() {
  const head = viewHead('直播广场', '正在放映的房间，第一个作为主视觉。', [
    btn('新建直播房间', 'primary', 'radio-tower', function () { navigate('/live/newlive/'); })
  ]);

  const searchBox = input({ type: 'search', placeholder: '搜索直播间标题、简介或作者' });
  const searchRow = el('<div class="row"></div>');
  searchRow.appendChild(searchBox);
  searchRow.appendChild(btn('搜索', 'ember-ghost', 'search', function () {
    const term = searchBox.value.trim();
    if (!term) { toast('请输入搜索内容', 'warn'); return; }
    navigate('/live/search/' + encodeURIComponent(b64(term)) + '/');
  }));

  const shell = panel('正在直播', { icon: 'radio-tower' });
  shell.body.appendChild(loadingCards(4));
  paint([head, searchRow, shell]);

  try {
    const data = await api.live({});
    const items = (data && data.items) || [];
    shell.body.innerHTML = '';
    if (!items.length) {
      shell.body.appendChild(emptyState({
        icon: 'radio-tower', title: '现在没有直播',
        line: '你可以成为第一个开播的人。',
        action: '新建直播房间', actionIcon: 'plus',
        onAction: function () { navigate('/live/newlive/'); }
      }));
      return;
    }
    shell.body.appendChild(liveGrid(items, { featured: true, limit: 24 }));
  } catch (err) {
    shell.body.innerHTML = '';
    shell.body.appendChild(errorState(err && err.message, renderLiveHome));
  }
}

export async function renderLiveSearch(params) {
  const term = unb64(params && params.term ? params.term : '');
  const head = viewHead('直播搜索', '关键词：' + term, [
    btn('返回直播广场', 'ghost', 'chevron-left', function () { navigate('/live/home/'); })
  ]);
  paint(loadingCards(4));

  let items = [];
  try {
    const r = await api.search('live', term);
    items = (r.items || []);
  } catch (err) {
    paint([head, errorState(err && err.message, function () { renderLiveSearch(params); })]);
    return;
  }

  if (!items.length) {
    paint([head, emptyState({
      icon: 'search', title: '没有匹配的直播',
      line: '换个关键词试试，或者去直播广场看全部房间。',
      action: '直播广场', actionIcon: 'radio-tower',
      onAction: function () { navigate('/live/home/'); }
    })]);
    return;
  }

  const grid = liveGrid(items, { featured: true, limit: 24 });
  grid.addEventListener('click', function (ev) {
    const card = ev.target.closest('.live-card');
    if (!card) return;
    const index = Array.prototype.indexOf.call(grid.children, card);
    const hit = items[index];
    if (hit && hit.id) api.feedback({ kind: 'live', query: term, docId: hit.id, label: 1 }).catch(function () {});
  }, true);
  paint([head, grid]);
}

/* ------------------------------------------------------------ 新建直播间 */

export async function renderNewLive() {
  const account = state.account || {};
  const model = {
    roomName: '', title: '', blurb: '',
    pidMode: 'auto', pid: genPid(),
    duration: 'permanent', durationMinutes: 120,
    app: '', resolution: '1920x1080', resolutionCustom: '',
    fps: '30', fpsCustom: '',
    mode: 'BT', serverIp: '', serverPort: 13750,
    limit: 0, bitrateKbps: 6000,
    showDanmaku: true, secret: false, secretScope: 'friends',
    replay: false,
    recordApp: '', savePath: '', template: DEFAULT_TEMPLATE, format: 'mp4', source: ''
  };

  const head = viewHead('新建直播房间', '带 * 的为必填项。', [
    btn('返回直播广场', 'ghost', 'chevron-left', function () { navigate('/live/home/'); })
  ]);

  /* --- 基本信息 --- */
  const basics = panel('房间', { icon: 'radio-tower' });
  const grid = el('<div class="form-grid"></div>');

  const roomName = input({ value: model.roomName, placeholder: '房间名称' });
  roomName.addEventListener('input', function () { model.roomName = roomName.value; });
  grid.appendChild(field('房间名称', roomName, { required: true }));

  const title = input({ value: model.title, placeholder: '标题' });
  title.addEventListener('input', function () { model.title = title.value; });
  grid.appendChild(field('标题', title, { required: true }));

  const pidBox = el('<div class="pid-row"></div>');
  const pidValue = input({ value: model.pid, placeholder: '6 位 PID' });
  pidValue.className = 'input mono input-sm';
  pidValue.addEventListener('input', function () { model.pid = pidValue.value.toUpperCase(); });
  const autoChip = chip('自动生成', {});
  const manualChip = chip('手动填写', {});
  const reroll = iconBtn('refresh-cw', '重新生成 PID', '', function () {
    model.pid = genPid(); pidValue.value = model.pid;
  });
  function syncPid() {
    autoChip.classList.toggle('chip-ok', model.pidMode === 'auto');
    manualChip.classList.toggle('chip-ok', model.pidMode === 'manual');
    pidValue.readOnly = model.pidMode === 'auto';
    reroll.style.display = model.pidMode === 'auto' ? '' : 'none';
  }
  autoChip.addEventListener('click', function () {
    model.pidMode = 'auto'; model.pid = genPid(); pidValue.value = model.pid; syncPid();
  });
  manualChip.addEventListener('click', function () { model.pidMode = 'manual'; syncPid(); pidValue.focus(); });
  pidBox.appendChild(pidValue); pidBox.appendChild(autoChip); pidBox.appendChild(manualChip); pidBox.appendChild(reroll);
  syncPid();
  grid.appendChild(field('PID', pidBox, { hint: '房间路径为 /live/昵称/PID' }));

  const durationBox = el('<div class="stack-tight"></div>');
  const durationRow = el('<div class="radio-group"></div>');
  const minutes = input({ type: 'number', value: String(model.durationMinutes), min: '1' });
  minutes.style.display = 'none';
  minutes.addEventListener('input', function () { model.durationMinutes = Number(minutes.value) || 0; });
  durationRow.appendChild(radio('ev-duration', 'permanent', '永久', true, function () {
    model.duration = 'permanent'; minutes.style.display = 'none';
  }));
  durationRow.appendChild(radio('ev-duration', 'custom', '自定义', false, function () {
    model.duration = 'custom'; minutes.style.display = ''; minutes.focus();
  }));
  durationBox.appendChild(durationRow);
  durationBox.appendChild(minutes);
  grid.appendChild(field('持续时长', durationBox, { required: true }));

  const appSelect = runningAppSelect('', function (value) { model.app = value; });
  grid.appendChild(field('直播软件', appSelect, { required: true, hint: '例如 OBS：只列出正在运行的软件' }));

  const resSelect = select(RESOLUTIONS.map(function (r) { return { value: r, label: r }; }).concat([{ value: 'custom', label: '自定义' }]), { value: model.resolution });
  const resCustom = input({ placeholder: '例如 1600x900' });
  resCustom.style.display = 'none';
  resCustom.addEventListener('input', function () { model.resolutionCustom = resCustom.value; });
  resSelect.addEventListener('change', function () {
    model.resolution = resSelect.value;
    resCustom.style.display = resSelect.value === 'custom' ? '' : 'none';
  });
  const resBox = el('<div class="stack-tight"></div>');
  resBox.appendChild(resSelect); resBox.appendChild(resCustom);
  grid.appendChild(field('分辨率', resBox, { required: true }));

  const fpsSelect = select(FPS_LIST.map(function (f) { return { value: f, label: f + ' fps' }; }).concat([{ value: 'custom', label: '自定义' }]), { value: model.fps });
  const fpsCustom = input({ type: 'number', placeholder: '例如 144' });
  fpsCustom.style.display = 'none';
  fpsCustom.addEventListener('input', function () { model.fpsCustom = fpsCustom.value; });
  fpsSelect.addEventListener('change', function () {
    model.fps = fpsSelect.value;
    fpsCustom.style.display = fpsSelect.value === 'custom' ? '' : 'none';
  });
  const fpsBox = el('<div class="stack-tight"></div>');
  fpsBox.appendChild(fpsSelect); fpsBox.appendChild(fpsCustom);
  grid.appendChild(field('帧率', fpsBox, { required: true }));

  const limitInput = input({ type: 'number', value: '0', min: '0' });
  limitInput.addEventListener('input', function () { model.limit = Number(limitInput.value) || 0; });
  grid.appendChild(field('房间人数限制', limitInput, { hint: '0 表示不限' }));

  const bitrate = input({ type: 'number', value: String(model.bitrateKbps), min: '100' });
  bitrate.addEventListener('input', function () { model.bitrateKbps = Number(bitrate.value) || 0; estimate(); });
  grid.appendChild(field('码率 kbps', bitrate, { required: true }));

  const blurb = textarea({ rows: '5', placeholder: '简介' });
  blurb.addEventListener('input', function () { model.blurb = blurb.value; });
  const blurbField = field('简介', blurb, { required: true });
  blurbField.className = 'field span-2';
  grid.appendChild(blurbField);

  basics.body.appendChild(grid);

  /* --- 传输模式 --- */
  const transport = panel('传输模式', { icon: 'network' });
  const modeRow = el('<div class="radio-group"></div>');
  const serverBox = el('<div class="form-grid"></div>');
  const serverIp = input({ placeholder: '服务器 IP，例如 192.168.1.10' });
  const serverPort = input({ type: 'number', value: '13750' });
  serverIp.addEventListener('input', function () { model.serverIp = serverIp.value; });
  serverPort.addEventListener('input', function () { model.serverPort = Number(serverPort.value) || 13750; });
  serverBox.appendChild(field('服务器IP', serverIp, { required: true }));
  serverBox.appendChild(field('端口', serverPort));
  serverBox.style.display = 'none';
  for (const mode of MODES) {
    modeRow.appendChild(radio('ev-mode', mode, mode, mode === model.mode, function (value) {
      model.mode = value;
      serverBox.style.display = value === 'SERVER' ? '' : 'none';
      estimate();
    }));
  }
  transport.body.appendChild(modeRow);
  transport.body.appendChild(serverBox);
  const estimateRow = el('<div class="stat-row"></div>');
  const modeNotes = el('<div class="stack-tight"></div>');
  for (const key of MODES) {
    const line = el('<p class="dim"></p>');
    line.textContent = MODE_TEXT[key];
    modeNotes.appendChild(line);
  }
  transport.body.appendChild(estimateRow);
  transport.body.appendChild(modeNotes);

  let estimateTimer = 0;
  function estimate() {
    clearTimeout(estimateTimer);
    estimateTimer = setTimeout(async function () {
      estimateRow.innerHTML = '';
      try {
        const br = model.bitrateKbps || 6000;
        const r = await api.transportPlan(10, br);
        const plan = r.plan || {};
        estimateRow.appendChild(stat('SERVER 上行', (plan.SERVER || 0).toFixed(1) + ' Mbps'));
        estimateRow.appendChild(stat('P2P 上行', (plan.P2P || 0).toFixed(1) + ' Mbps'));
        estimateRow.appendChild(stat('BT 上行', (plan.BT || 0).toFixed(1) + ' Mbps'));
      } catch (err) { /* 静默 */ }
    }, 260);
  }
  estimate();

  /* --- 可见性与回放 --- */
  const extra = panel('弹幕、私密与回放', { icon: 'shield' });
  const extraGrid = el('<div class="form-grid"></div>');

  extraGrid.appendChild(checkbox('显示指定弹幕浮窗', true, function (v) { model.showDanmaku = v; }));

  const secretScope = el('<div class="radio-group"></div>');
  secretScope.appendChild(radio('ev-secret', 'friends', '仅好友能加入', true, function (v) { model.secretScope = v; }));
  secretScope.appendChild(radio('ev-secret', 'self', '仅自己', false, function (v) { model.secretScope = v; }));
  secretScope.style.display = 'none';
  extraGrid.appendChild(checkbox('私密房间', false, function (v) {
    model.secret = v;
    secretScope.style.display = v ? '' : 'none';
  }));
  extraGrid.appendChild(secretScope);
  extra.body.appendChild(extraGrid);

  const replayWrap = el('<div class="stack"></div>');
  const replayBody = el('<div class="stack-tight"></div>');
  replayBody.style.maxHeight = '0';
  replayBody.style.overflow = 'hidden';
  replayBody.setAttribute('aria-hidden', 'true');
  replayWrap.appendChild(checkbox('启用回放', false, function (v) {
    model.replay = v;
    replayBody.style.maxHeight = v ? '520px' : '0';
    replayBody.setAttribute('aria-hidden', v ? 'false' : 'true');
    replayBody.classList.toggle('is-open', v);
  }));
  replayWrap.appendChild(replayBody);

  const recordApp = runningAppSelect('', function (v) { model.recordApp = v; });
  replayBody.appendChild(field('使用应用', recordApp, { required: true }));

  const savePath = input({ value: (state.settings && state.settings.recordDir) || '', placeholder: '录制保存路径' });
  savePath.addEventListener('input', function () { model.savePath = savePath.value; });
  replayBody.appendChild(field('保存路径', savePath, { required: true, hint: '录制完成后会自动重命名并移动到该目录' }));

  const template = input({ value: model.template });
  const tokenRow = el('<div class="chip-row"></div>');
  const preview = el('<p class="field-hint mono"></p>');
  function refreshPreview() {
    preview.textContent = '预览：' + formatTemplate(template.value, { username: account.nickname || 'user' }) + '.' + model.format;
  }
  template.addEventListener('input', function () { model.template = template.value; refreshPreview(); });
  for (const token of TEMPLATE_TOKENS) {
    tokenRow.appendChild(chip(token, { title: '插入 ' + token, onClick: function () {
      template.value = template.value + token;
      model.template = template.value;
      refreshPreview();
      template.focus();
    } }));
  }
  const templateBox = el('<div class="stack-tight"></div>');
  templateBox.appendChild(template);
  templateBox.appendChild(tokenRow);
  templateBox.appendChild(preview);
  replayBody.appendChild(field('命名方式', templateBox, { required: true }));
  refreshPreview();

  const format = select([
    { value: 'mp4', label: 'MP4' }, { value: 'mkv', label: 'MKV' },
    { value: 'flv', label: 'FLV' }, { value: 'ts', label: 'TS' }
  ], { value: model.format });
  format.addEventListener('change', function () { model.format = format.value; refreshPreview(); });
  replayBody.appendChild(field('保存格式', format, { required: true }));

  extra.body.appendChild(replayWrap);

  /* --- 提交 --- */
  const foot = el('<div class="row row-end"></div>');
  const submit = btn('创建房间', 'primary', 'radio-tower', async function () {
    if (!model.roomName.trim()) { toast('请填写房间名称', 'warn'); return; }
    if (!model.title.trim()) { toast('请填写标题', 'warn'); return; }
    if (!model.blurb.trim()) { toast('请填写简介', 'warn'); return; }
    if (!model.app) { toast('请选择直播软件（只列出正在运行的软件）', 'warn'); return; }
    if (model.duration === 'custom' && !model.durationMinutes) { toast('请填写自定义时长', 'warn'); return; }
    if (model.mode === 'SERVER' && !model.serverIp.trim()) { toast('SERVER 模式需要填写服务器 IP', 'warn'); return; }
    if (model.pidMode === 'manual' && !validPid(model.pid)) { toast('PID 需要 6 位（A-Z、2-9）', 'warn'); return; }
    if (model.replay && !model.savePath.trim()) { toast('启用回放需要填写保存路径', 'warn'); return; }

    const resolution = model.resolution === 'custom' ? model.resolutionCustom : model.resolution;
    const fps = model.fps === 'custom' ? Number(model.fpsCustom) || 30 : Number(model.fps) || 30;
    const payload = {
      roomName: model.roomName.trim(), title: model.title.trim(), blurb: model.blurb,
      mode: model.mode, resolution, fps,
      bitrateKbps: model.bitrateKbps,
      duration: model.duration, durationMinutes: model.durationMinutes,
      app: model.app, limit: model.limit,
      serverIp: model.serverIp, serverPort: model.serverPort,
      showDanmaku: model.showDanmaku, secret: model.secret, secretScope: model.secretScope,
      replay: model.replay
    };
    if (model.pidMode === 'manual') payload.pid = model.pid;
    if (model.replay) {
      payload.record = {
        app: model.recordApp || model.app,
        savePath: model.savePath.trim(),
        template: model.template,
        format: model.format,
        source: model.source
      };
    }
    submit.disabled = true;
    try {
      const r = await api.createLive(payload);
      toast('房间已创建', 'ok');
      window.dispatchEvent(new Event('ev:counts'));
      navigate(r.path || roomPath(r.room || {}));
    } catch (err) {
      toast('创建失败：' + err.message, 'err');
    } finally { submit.disabled = false; }
  });
  foot.appendChild(btn('取消', 'ghost', 'x', function () { navigate('/live/home/'); }));
  foot.appendChild(submit);

  paint([head, basics, transport, extra, foot]);
}

/* -------------------------------------------------------------- 直播间 */

export async function renderLiveRoom(nick, pid, secret) {
  paint(loadingCards(3));
  let data;
  try { data = await api.room(nick, pid); }
  catch (err) {
    paint([viewHead('直播间', decodeURIComponent(nick || '')), errorState(err && err.message, function () { navigate('/live/home/'); })]);
    return;
  }

  const room = data.room || {};
  const isSelf = state.account && room.authorId === state.account.id;

  const head = viewHead(room.title || '直播间', (room.author || '') + ' · ' + (room.mode || '') + ' · ' + fmtAgo(room.startedAt), [
    btn('直播广场', 'ghost', 'chevron-left', function () { navigate('/live/home/'); })
  ]);

  const layout = el('<div class="split-2"></div>');

  /* 舞台 */
  const stagePanel = el('<section class="panel panel-flush"></section>');
  const stage = el('<div class="stage"></div>');
  const media = document.createElement('video');
  media.controls = true;
  media.autoplay = true;
  media.playsInline = true;
  media.className = 'stage-video';
  stage.appendChild(media);
  const offline = el('<div class="stage-offline"></div>');
  offline.innerHTML = icon('radio-tower');
  const offLine = el('<p></p>');
  offLine.textContent = '主播还没有推送画面。';
  offline.appendChild(offLine);
  stage.appendChild(offline);
  stagePanel.appendChild(stage);

  const titleChip = el('<div class="stage-title-chip"></div>');
  titleChip.innerHTML = icon(room.secret ? 'lock' : 'radio-tower') + '<span></span>';
  titleChip.querySelector('span').textContent = room.secret ? '私密房间' : (room.mode + ' · ' + (room.resolution || ''));
  stagePanel.appendChild(titleChip);

  const hud = el('<div class="stage-hud"></div>');
  hud.appendChild(tel('MODE', room.mode));
  hud.appendChild(tel('PID', room.pid));
  hud.appendChild(tel('RES', room.resolution));
  hud.appendChild(tel('FPS', room.fps));
  hud.appendChild(tel('BR', fmtBitrate(room.bitrateKbps)));
  stagePanel.appendChild(hud);

  const swarmRow = el('<div class="stat-row"></div>');
  stagePanel.appendChild(swarmRow);

  layout.appendChild(stagePanel);

  /* 聊天 */
  const chatPanel = el('<section class="panel panel-flush"></section>');
  chatPanel.appendChild(sectionHead('弹幕与聊天', { mark: 'LIVE' }));
  const chatLog = el('<div class="chat-log"></div>');
  chatPanel.appendChild(chatLog);
  const compose = el('<div class="chat-compose"></div>');
  const chatInput = input({ placeholder: '说点什么…' });
  const send = btn('发送', 'ember-ghost', 'message-circle', function () { doSend(); });
  chatInput.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); doSend(); } });
  compose.appendChild(chatInput);
  compose.appendChild(send);
  chatPanel.appendChild(compose);
  layout.appendChild(chatPanel);

  function appendChat(name, text, at, self) {
    const line = el('<div class="chat-line"><span class="chat-who mono"></span><span class="chat-text"></span><span class="chat-at mono"></span></div>');
    if (self) line.classList.add('is-self');
    line.querySelector('.chat-who').textContent = name || '匿名';
    line.querySelector('.chat-text').textContent = text;
    line.querySelector('.chat-at').textContent = at ? new Date(at).toTimeString().slice(0, 5) : '';
    chatLog.appendChild(line);
    chatLog.scrollTop = chatLog.scrollHeight;
    while (chatLog.children.length > 200) chatLog.removeChild(chatLog.firstChild);
  }

  let streamId = null;
  try {
    const joined = await api.joinLive(room.id);
    streamId = joined.streamId;
    realtime.send({ t: 'join', streamId: streamId });
  } catch (err) {
    if (!room.secret) toast('加入直播失败：' + err.message, 'warn');
  }

  function doSend() {
    const text = chatInput.value.trim();
    if (!text) return;
    if (streamId) realtime.send({ t: 'chat', streamId: streamId, text: text });
    appendChat((state.account && state.account.nickname) || '我', text, Date.now(), true);
    chatInput.value = '';
  }

  /* 房间 HUD：每 3 秒刷新一次 swarm 统计。 */
  async function refreshSwarm() {
    if (!streamId) return;
    try {
      const r = await api.swarm(streamId);
      const swarm = r.swarm || {};
      swarmRow.innerHTML = '';
      swarmRow.appendChild(stat('观众', swarm.viewers || 0));
      swarmRow.appendChild(stat('分片', swarm.segments || 0));
      swarmRow.appendChild(stat('覆盖率', fmtPct(swarm.coverage || 0)));
      swarmRow.appendChild(stat('主机上行占比', fmtPct(swarm.originUplinkShare || 0)));
      const list = (swarm.peers || []).slice(0, 6);
      if (list.length) {
        const strip = el('<div class="telemetry-strip"></div>');
        for (const peer of list) strip.appendChild(tel(peer.name || peer.id.slice(0, 6), peer.segments || 0));
        swarmRow.appendChild(strip);
      }
    } catch (err) { /* 流可能已结束 */ }
  }
  refreshSwarm();
  const timer = setInterval(refreshSwarm, 3000);
  addDisposer(function () { clearInterval(timer); });

  /* 主播操作 */
  const actions = el('<div class="row row-end"></div>');
  actions.appendChild(btn('复制房间链接', 'ghost', 'link', async function () {
    const link = room.ev || ('ev://live/' + (room.secret ? 'secret/' : '') + encodeURIComponent(room.author || '') + '/' + room.pid);
    const ok = await copyText(link);
    toast(ok ? ('已复制：' + link) : '复制失败', ok ? 'ok' : 'warn');
  }));
  if (isSelf) {
    actions.appendChild(btn('结束直播', 'danger', 'power', async function () {
      const ok = await confirmDialog({ title: '结束直播', text: '结束后观众将无法继续观看。', okLabel: '结束', danger: true });
      if (!ok) return;
      try {
        const r = await api.endLive(room.id);
        toast(r.recording && r.recording.name ? ('已结束，回放：' + r.recording.name) : '直播已结束', 'ok');
        window.dispatchEvent(new Event('ev:counts'));
        navigate('/live/home/');
      } catch (err) { toast('结束失败：' + err.message, 'err'); }
    }));
  }

  paint([head, layout, actions]);
}

/* ----------------------------------------------------------------- export */

export default { renderLiveHome, renderNewLive, renderLiveRoom, renderLiveSearch };
