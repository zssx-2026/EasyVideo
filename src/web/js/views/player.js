/* EasyVideo - views/player.js
 *
 * 观看页：视频与直播共用同一套外壳（直播只是把视频换成实时流）。
 *
 * 布局对应 prompt.txt 第 98~109 行：顶部导航、自定义播放控件、
 * 高能进度条、整排控件（画质/帧率/码率/倍速/字幕/音量/设置/画中画/全屏）、
 * 三连、推荐、评论。
 */
import { api, request } from '../api.js';
import { state, rememberPlayback } from '../store.js';
import { navigate } from '../router.js';
import { realtime } from '../app.js';
import * as playback from '../playback.js';
import {
  el, icon, input, textarea, select, switchControl, panel, stat, toast,
  copyText, emptyState, confirmDialog, mdSafe, tagChip,
  fmtDate, fmtAgo, fmtDuration, fmtBitrate, fmtPct
} from '../ui.js';
import {
  paint, viewHead, btn, iconBtn, errorState, loadingRows, tel, videoCard, addDisposer
} from './kit.js';

const QUALITY_LADDER = ['360P', '480P', '720P', '1080P', '2K', '4K'];
const COMMENT_PAGE = 30;

function pad(n) { return String(n).padStart(2, '0'); }

function clock(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return (h ? h + ':' + pad(m) : String(m)) + ':' + pad(r);
}

function sourceOf(part) {
  const p = part || {};
  if (p.url) return p.url;
  if (p.stored) return api.mediaUrl(p.stored);
  if (p.name) return api.mediaUrl(p.name);
  return '';
}

/* ------------------------------------------------------------- watch top */

function watchTop() {
  const top = el('<div class="watch-top"></div>');
  const nav = el('<div class="watch-nav"></div>');
  const links = [['主页', '/home/'], ['直播', '/live/home/'], ['视频', '/video/home/'], ['投稿', '/video/release/']];
  for (const pair of links) {
    const node = el('<button type="button" class="watch-nav-item"></button>');
    node.textContent = pair[0];
    node.addEventListener('click', function () { navigate(pair[1]); });
    nav.appendChild(node);
  }
  top.appendChild(nav);
  const tools = el('<div class="watch-tools"></div>');
  const quick = [['稍后再看', 'bookmark', '/home/later/'], ['历史记录', 'history', '/home/history/'], ['收藏', 'star', '/home/favorites/']];
  for (const pair of quick) {
    const node = el('<button type="button" class="watch-tool"></button>');
    node.innerHTML = icon(pair[1]) + '<span></span>';
    node.querySelector('span').textContent = pair[0];
    node.addEventListener('click', function () { navigate(pair[2]); });
    tools.appendChild(node);
  }
  const who = el('<button type="button" class="watch-me"></button>');
  const acc = state.account || {};
  if (acc.avatar) {
    const img = el('<img alt="" class="watch-me-avatar" />');
    img.src = acc.avatar;
    who.appendChild(img);
  } else {
    who.textContent = String(acc.nickname || '我').slice(0, 1);
  }
  who.addEventListener('click', function () { navigate('/home/myself/'); });
  tools.appendChild(who);
  top.appendChild(tools);
  return top;
}

/* ----------------------------------------------------------------- trio */

function trioBar(refId, initial, onLearn) {
  const counts = Object.assign({ like: 0, favorite: 0, share: 0, views: 0 }, initial || {});
  const row = el('<div class="watch-trio"></div>');
  const spec = [['like', '点赞', 'heart'], ['favorite', '收藏', 'star'], ['share', '转发', 'share-2']];
  const nodes = {};
  for (const s of spec) {
    const node = el('<button type="button" class="trio-btn"></button>');
    node.innerHTML = icon(s[2]) + '<span class="trio-label"></span><span class="trio-count mono"></span>';
    node.querySelector('.trio-label').textContent = s[1];
    node.querySelector('.trio-count').textContent = String(counts[s[0]] || 0);
    node.addEventListener('click', async function () {
      node.classList.toggle('is-on');
      const on = node.classList.contains('is-on');
      try {
        const r = await api.react(refId, s[0], on ? 1 : -1);
        const next = (r && r.counts) || counts;
        node.querySelector('.trio-count').textContent = String(next[s[0]] || 0);
        if (on && s[0] !== 'share' && onLearn) onLearn(s[0] === 'favorite' ? 4 : 5);
      } catch (err) {
        node.classList.toggle('is-on');
        toast('操作失败：' + err.message, 'err');
      }
    });
    nodes[s[0]] = node;
    row.appendChild(node);
  }
  row.nodes = nodes;
  return row;
}

/* -------------------------------------------------------------- comments */

function commentBlock(refId, kind) {
  const box = el('<div class="stack"></div>');
  const head = el('<div class="row row-between"></div>');
  const title = el('<h3 class="cm-title"></h3>');
  const count = el('<span class="cm-count mono"></span>');
  title.textContent = '评论';
  head.appendChild(title);
  head.appendChild(count);
  box.appendChild(head);

  const compose = el('<div class="cm-compose"></div>');
  const area = textarea({ rows: '3', placeholder: '发一条评论…' });
  const send = btn('发表评论', 'primary', 'send', async function () {
    const text = area.value.trim();
    if (!text) { toast('评论不能为空', 'warn'); return; }
    send.disabled = true;
    try {
      await api.comment(refId, text, kind);
      area.value = '';
      toast('评论已发表', 'ok');
      draw();
    } catch (err) { toast('发表失败：' + err.message, 'err'); }
    finally { send.disabled = false; }
  });
  compose.appendChild(area);
  const composeFoot = el('<div class="row row-end"></div>');
  composeFoot.appendChild(send);
  compose.appendChild(composeFoot);
  box.appendChild(compose);

  const list = el('<div class="cm-list"></div>');
  box.appendChild(list);

  async function draw() {
    list.innerHTML = '';
    list.appendChild(loadingRows(3));
    let items = [];
    try { const r = await api.comments(refId, COMMENT_PAGE); items = r.items || []; }
    catch (err) { items = []; }
    count.textContent = items.length + ' 条';
    list.innerHTML = '';
    if (!items.length) {
      list.appendChild(emptyState({ icon: 'message-circle', title: '还没有评论', line: '说点什么，让作者知道你在看。' }));
      return;
    }
    const mine = (state.account && state.account.id) || null;
    for (const row of items) {
      const node = el('<div class="cm-row"><div class="cm-avatar"></div><div class="cm-body"><div class="cm-meta"><span class="cm-who"></span><span class="cm-at mono"></span></div><p class="cm-text"></p><div class="cm-acts"></div></div></div>');
      node.querySelector('.cm-avatar').textContent = String(row.author || '?').slice(0, 1).toUpperCase();
      node.querySelector('.cm-who').textContent = row.author || '本机用户';
      node.querySelector('.cm-at').textContent = fmtAgo(row.at);
      node.querySelector('.cm-text').textContent = row.text;
      const acts = node.querySelector('.cm-acts');
      const like = el('<button type="button" class="cm-act"></button>');
      like.innerHTML = icon('heart') + '<span>' + (row.likes || 0) + '</span>';
      like.addEventListener('click', async function () {
        try {
          const r = await api.likeComment(refId, row.id);
          like.querySelector('span').textContent = String((r.comment && r.comment.likes) || 0);
        } catch (err) { /* quiet */ }
      });
      acts.appendChild(like);
      if (mine && row.accountId === mine) {
        const del = el('<button type="button" class="cm-act is-danger"></button>');
        del.innerHTML = icon('trash-2') + '<span>删除</span>';
        del.addEventListener('click', async function () {
          const ok = await confirmDialog({ title: '删除评论', text: '删除后无法恢复。', okLabel: '删除', danger: true });
          if (!ok) return;
          try { await api.deleteComment(refId, row.id); toast('已删除', 'ok'); draw(); }
          catch (err) { toast('删除失败：' + err.message, 'err'); }
        });
        acts.appendChild(del);
      }
      list.appendChild(node);
    }
  }

  draw();
  box.redraw = draw;
  return box;
}

/* ------------------------------------------------------------ drawer */

function settingsDrawer(onChange) {
  const box = el('<div class="watch-drawer"></div>');
  const s = playback.get();
  const quick = el('<div class="stack"></div>');
  const toggles = [
    ['singleLoop', '单集循环'], ['autoPlayLive', '自动开播'], ['mirrorV', '垂直镜像'],
    ['mirrorH', '横向镜像'], ['highEnergy', '高能进度条'], ['volumeLevel', '音量均衡'],
    ['hideFrame', '隐藏边框'], ['lightsOff', '关灯模式'], ['eyeCare', '护眼模式']
  ];
  for (const pair of toggles) {
    quick.appendChild(switchControl({
      label: pair[1], checked: !!s[pair[0]],
      onChange: function (v) { playback.set(pair[0], v); onChange(); }
    }));
  }
  const quickPanel = panel('开关', { icon: 'sliders-horizontal' });
  quickPanel.body.appendChild(quick);
  box.appendChild(quickPanel);

  const morePanel = panel('更多设置', { icon: 'settings' });
  const more = el('<div class="form-grid"></div>');
  function picker(label, list, value, key) {
    const node = select(list.map((p) => ({ value: String(p[0]), label: p[1] })), { value: String(value) });
    node.addEventListener('change', function () { playback.set(key, node.value); onChange(); });
    const field = el('<div class="field"></div>');
    const lab = el('<label class="field-label"></label>');
    lab.textContent = label;
    field.appendChild(lab);
    field.appendChild(node);
    more.appendChild(field);
  }
  picker('播放方式', playback.PLAY_MODES, s.playMode, 'playMode');
  picker('画面比例', playback.ASPECTS, s.aspect, 'aspect');
  picker('视频编码器', playback.VIDEO_CODECS, s.videoCodec, 'videoCodec');
  picker('音频编码器', playback.AUDIO_CODECS, s.audioCodec, 'audioCodec');
  morePanel.body.appendChild(more);
  box.appendChild(morePanel);

  const foot = el('<div class="row row-end"></div>');
  foot.appendChild(btn('恢复默认', 'ghost', 'rotate-ccw', function () {
    playback.reset();
    toast('已恢复默认设置', 'ok');
    onChange();
  }));
  box.appendChild(foot);
  return box;
}

/* ==================================================================== */

export async function renderPlayer(nick, pid, secret) {
  paint(loadingRows(6));
  let data;
  try { data = await api.video(nick, pid); }
  catch (err) {
    paint([
      viewHead('观看', decodeURIComponent(nick || '')),
      errorState(err.message || '视频不存在', function () { navigate('/video/home/'); })
    ]);
    return;
  }

  const video = data.video || {};
  const parts = Array.isArray(data.parts) ? data.parts : [];
  if (secret) video.secret = true;

  let counts = { like: 0, favorite: 0, share: 0, views: 0 };
  try { const r = await api.reactions(video.id); counts = r.counts || counts; } catch (err) { /* first view */ }

  let related = [];
  try { const r = await api.recommend('video', 8, [video.id]); related = r.items || []; }
  catch (err) { related = []; }

  const top = watchTop();
  const shell = el('<div class="watch-stage-shell"></div>');
  const stage = el('<div class="watch-stage"></div>');
  const media = document.createElement('video');
  media.controls = false;
  media.preload = 'metadata';
  media.playsInline = true;
  media.className = 'watch-video';
  stage.appendChild(media);
  shell.appendChild(stage);

  if (video.secret) {
    const lock = el('<div class="watch-badge"></div>');
    lock.innerHTML = icon('lock') + '<span>私密视频</span>';
    stage.appendChild(lock);
  }

  const control = el('<div class="watch-control"></div>');
  const energy = el('<canvas class="watch-energy" height="28"></canvas>');
  const bar = el('<div class="watch-bar"></div>');
  const played = el('<div class="watch-played"></div>');
  const hover = el('<div class="watch-hover"></div>');
  bar.appendChild(played);
  bar.appendChild(hover);
  control.appendChild(energy);
  control.appendChild(bar);

  const row = el('<div class="watch-row"></div>');
  const left = el('<div class="watch-left"></div>');
  const right = el('<div class="watch-right"></div>');
  row.appendChild(left);
  row.appendChild(right);
  control.appendChild(row);
  shell.appendChild(control);

  const playlist = el('<div class="playlist"></div>');
  const items = [];
  let index = 0;

  function applyLook() {
    const s = playback.get();
    media.style.transform = playback.videoTransform();
    media.style.filter = playback.videoFilter();
    media.style.objectFit = 'contain';
    if (s.aspect !== 'auto') media.style.aspectRatio = s.aspect.replace(':', ' / ');
    media.loop = !!s.singleLoop;
    media.playbackRate = Number(s.speed) || 1;
    media.volume = Math.max(0, Math.min(1, Number(s.volume) || 1));
  }

  function play(at) {
    const part = parts[at];
    if (!part) return;
    index = at;
    const src = sourceOf(part);
    if (src) media.src = src;
    for (let i = 0; i < items.length; i++) items[i].classList.toggle('is-playing', i === at);
    rememberPlayback({ kind: 'video', pid: video.pid, title: video.title, author: video.author, index: at });
    if (video.id) {
      api.learn(video, 1).catch(function () {});
      api.react(video.id, 'views', 1).catch(function () {});
    }
    applyLook();
    media.play().catch(function () {});
  }

  function toggle() {
    if (media.paused) media.play().catch(function () {});
    else media.pause();
  }

  const prevBtn = iconBtn('skip-back', '上一集', '', function () { play(Math.max(0, index - 1)); });
  const playBtn = iconBtn('pause', '播放/暂停', 'primary', function () { toggle(); });
  const nextBtn = iconBtn('skip-forward', '下一集', '', function () { play(Math.min(parts.length - 1, index + 1)); });
  left.appendChild(prevBtn);
  left.appendChild(playBtn);
  left.appendChild(nextBtn);
  const timeLabel = el('<span class="watch-time mono"></span>');
  left.appendChild(timeLabel);

  /* 画质：原画 + 已渲染的清晰度梯度 */
  const qualitySelect = select([{ value: 'auto', label: '原画' }], { value: playback.get('quality') });
  const qualityWrap = el('<div class="watch-pick"></div>');
  qualityWrap.appendChild(qualitySelect);
  right.appendChild(qualityWrap);
  qualitySelect.dataset.rungs = '[]';

  async function loadQualities() {
    try {
      const r = await request('/qualities/' + encodeURIComponent(video.id), { quiet: true });
      const rungs = (r && r.rungs) || [];
      qualitySelect.innerHTML = '';
      const first = el('<option></option>');
      first.value = 'auto';
      first.textContent = '原画';
      qualitySelect.appendChild(first);
      for (const q of QUALITY_LADDER) {
        const hit = rungs.find(function (x) { return x.label === q; });
        const node = el('<option></option>');
        node.value = q;
        node.textContent = q + (hit ? '' : '（未渲染）');
        qualitySelect.appendChild(node);
      }
      qualitySelect.value = playback.get('quality');
      qualitySelect.dataset.rungs = JSON.stringify(rungs);
    } catch (err) { /* ladder unavailable */ }
  }
  qualitySelect.addEventListener('change', function () {
    playback.set('quality', qualitySelect.value);
    let rungs = [];
    try { rungs = JSON.parse(qualitySelect.dataset.rungs || '[]'); } catch (err) { rungs = []; }
    const hit = rungs.find(function (x) { return x.label === qualitySelect.value; });
    if (hit) {
      const at = media.currentTime;
      media.src = hit.url;
      media.addEventListener('loadedmetadata', function once() {
        media.removeEventListener('loadedmetadata', once);
        media.currentTime = at;
      }, { once: true });
    }
    toast(qualitySelect.value === 'auto' ? '画质：原画' : '画质：' + qualitySelect.value, 'ok');
  });

  function miniSelect(label, list, value, apply) {
    const node = select(list, { value: String(value) });
    node.title = label;
    node.addEventListener('change', function () { apply(node.value); });
    right.appendChild(node);
    return node;
  }

  miniSelect('帧率', playback.FPS_CHOICES.map(function (f) { return { value: String(f), label: f ? f + 'fps' : '原帧率' }; }), playback.get('fps'), function (v) { playback.set('fps', Number(v) || 0); toast('帧率：' + (v === '0' ? '原帧率' : v + 'fps'), 'ok'); });
  miniSelect('码率', playback.BITRATES.map(function (p) { return { value: p[0], label: p[1] }; }), playback.get('bitrate'), function (v) { playback.set('bitrate', v); toast('码率档位：' + v, 'ok'); });
  miniSelect('倍速', playback.SPEEDS.map(function (x) { return { value: String(x), label: x + 'x' }; }), playback.get('speed'), function (v) { playback.set('speed', Number(v) || 1); applyLook(); });
  miniSelect('字幕', playback.SUBTITLES.map(function (p) { return { value: p[0], label: p[1] }; }), playback.get('subtitle'), function (v) { playback.set('subtitle', v); toast('字幕：' + v, 'ok'); });

  const volume = input({ type: 'range', min: '0', max: '2', step: '0.05', value: String(playback.get('volume')) });
  volume.className = 'watch-volume';
  volume.addEventListener('input', function () {
    playback.set('volume', Number(volume.value) || 0);
    applyLook();
  });
  right.appendChild(volume);

  const drawer = settingsDrawer(function () { applyLook(); drawEnergy(); });
  drawer.style.display = 'none';
  right.appendChild(iconBtn('settings', '设置', '', function () {
    const open = drawer.style.display === 'none';
    drawer.style.display = open ? '' : 'none';
  }));
  right.appendChild(iconBtn('picture-in-picture-2', '画中画', '', function () {
    if (media.requestPictureInPicture) media.requestPictureInPicture().catch(function () { toast('画中画不可用', 'warn'); });
    else toast('画中画不可用', 'warn');
  }));
  right.appendChild(iconBtn('maximize-2', '网页全屏', '', function () {
    document.body.classList.toggle('is-theater');
    shell.classList.toggle('is-wide');
  }));
  right.appendChild(iconBtn('maximize', '全屏', '', function () {
    if (document.fullscreenElement) document.exitFullscreen();
    else shell.requestFullscreen().catch(function () { toast('全屏不可用', 'warn'); });
  }));

  shell.appendChild(drawer);

  function seekFromEvent(ev) {
    const rect = bar.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (ev.clientX - rect.left) / Math.max(1, rect.width)));
    if (Number.isFinite(media.duration) && media.duration > 0) media.currentTime = ratio * media.duration;
  }
  bar.addEventListener('click', seekFromEvent);
  bar.addEventListener('mousemove', function (ev) {
    const rect = bar.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (ev.clientX - rect.left) / Math.max(1, rect.width)));
    hover.style.left = (ratio * 100) + '%';
  });

  function drawEnergy() {
    const s = playback.get();
    energy.style.display = s.highEnergy ? '' : 'none';
    if (!s.highEnergy) return;
    const rect = energy.getBoundingClientRect();
    const w = Math.max(160, Math.round(rect.width || 640));
    if (energy.width !== w) energy.width = w;
    const g = energy.getContext('2d');
    if (!g) return;
    g.clearRect(0, 0, energy.width, energy.height);
    const bars = 160;
    const progress = (Number.isFinite(media.duration) && media.duration > 0) ? media.currentTime / media.duration : 0;
    for (let i = 0; i < bars; i++) {
      const t = i / bars;
      const wave = 0.35 + 0.65 * Math.abs(Math.sin(t * 9.2) * Math.cos(t * 3.4));
      const h = Math.max(3, wave * energy.height);
      g.fillStyle = t <= progress ? 'rgba(255,106,61,0.85)' : 'rgba(255,255,255,0.16)';
      g.fillRect((i / bars) * energy.width, energy.height - h, Math.max(2, energy.width / bars - 2), h);
    }
  }

  function syncTime() {
    const dur = Number.isFinite(media.duration) ? media.duration : 0;
    timeLabel.textContent = clock(media.currentTime) + ' / ' + clock(dur);
    played.style.width = (dur > 0 ? (media.currentTime / dur) * 100 : 0) + '%';
  }

  media.addEventListener('timeupdate', function () { syncTime(); drawEnergy(); });
  media.addEventListener('loadedmetadata', function () { syncTime(); drawEnergy(); });
  media.addEventListener('play', function () { playBtn.innerHTML = icon('pause'); });
  media.addEventListener('pause', function () { playBtn.innerHTML = icon('play'); });
  media.addEventListener('ended', function () {
    const s = playback.get();
    if (s.singleLoop) { media.currentTime = 0; media.play().catch(function () {}); return; }
    if (s.playMode === 'next' && index < parts.length - 1) { play(index + 1); return; }
    if (s.playMode === 'rest') toast('本集结束，休息一下', 'ok');
  });

  const offPlayback = playback.subscribe(function () { applyLook(); drawEnergy(); });
  addDisposer(function () { offPlayback(); });
  const onResize = function () { drawEnergy(); };
  window.addEventListener('resize', onResize);
  addDisposer(function () { window.removeEventListener('resize', onResize); });

  const onKey = function (ev) {
    const tag = String((ev.target && ev.target.tagName) || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
    const step = Number(playback.get('seekStep')) || 5;
    if (ev.code === 'Space') { ev.preventDefault(); toggle(); }
    else if (ev.ctrlKey && ev.key === 'ArrowLeft') { ev.preventDefault(); play(Math.max(0, index - 1)); }
    else if (ev.ctrlKey && ev.key === 'ArrowRight') { ev.preventDefault(); play(Math.min(parts.length - 1, index + 1)); }
    else if (ev.key === 'ArrowLeft') { media.currentTime = Math.max(0, media.currentTime - step); }
    else if (ev.key === 'ArrowRight') { media.currentTime = Math.min(media.duration || 0, media.currentTime + step); }
  };
  window.addEventListener('keydown', onKey);
  addDisposer(function () { window.removeEventListener('keydown', onKey); });

  /* --- 简介 + 作者 --- */
  const intro = el('<div class="watch-intro"></div>');
  const introMain = el('<div class="watch-intro-main"></div>');
  const title = el('<h1 class="watch-title"></h1>');
  title.textContent = video.title || '未命名视频';
  introMain.appendChild(title);
  const meta = el('<div class="telemetry-strip"></div>');
  meta.appendChild(tel('播放', String(video.views || counts.views || 0)));
  meta.appendChild(tel('时长', fmtDuration(video.durationSec || 0)));
  meta.appendChild(tel('分辨率', video.resolution || '—'));
  meta.appendChild(tel('帧率', (video.fps || 30) + 'fps'));
  meta.appendChild(tel('码率', fmtBitrate(video.bitrateKbps || 0)));
  meta.appendChild(tel('发布', fmtDate(video.createdAt)));
  introMain.appendChild(meta);
  const blurb = el('<div class="watch-blurb md"></div>');
  blurb.innerHTML = mdSafe(video.blurb || '作者还没有写简介。');
  introMain.appendChild(blurb);
  const chipRow = el('<div class="chip-row"></div>');
  if (video.collection) chipRow.appendChild(tagChip(video.collection));
  for (const tag of video.tags || []) chipRow.appendChild(tagChip(tag));
  introMain.appendChild(chipRow);
  intro.appendChild(introMain);

  const author = el('<div class="watch-author"></div>');
  const aAvatar = el('<div class="watch-author-avatar"></div>');
  if (video.avatar) {
    const img = el('<img alt="" />');
    img.src = video.avatar;
    aAvatar.appendChild(img);
  } else {
    aAvatar.textContent = String(video.author || '?').slice(0, 1).toUpperCase();
  }
  const aBody = el('<div class="watch-author-body"></div>');
  const aName = el('<p class="watch-author-name"></p>');
  aName.textContent = video.author || '匿名作者';
  const aSub = el('<p class="dim"></p>');
  aSub.textContent = (parts.length || 1) + ' 个分段' + (video.collection ? ' · 合集 ' + video.collection : '');
  aBody.appendChild(aName);
  aBody.appendChild(aSub);
  author.appendChild(aAvatar);
  author.appendChild(aBody);
  intro.appendChild(author);

  /* --- 三连 + 合集 + 推荐 --- */
  const trio = trioBar(video.id, counts, function (weight) { api.learn(video, weight).catch(function () {}); });
  trio.nodes.share.addEventListener('click', async function () {
    const link = video.ev || ('ev://video/' + (video.secret ? 'secret/' : '') + encodeURIComponent(video.author || '') + '/' + video.pid);
    const ok = await copyText(link);
    toast(ok ? ('已复制：' + link) : '复制失败，请手动复制', ok ? 'ok' : 'warn');
  });

  const aside = el('<div class="watch-aside"></div>');
  const listPanel = panel('合集', { icon: 'video' });
  listPanel.actions.appendChild(btn('下一集', 'ghost', 'chevron-right', function () { play(Math.min(parts.length - 1, index + 1)); }));
  parts.forEach(function (part, at) {
    const node = el('<button type="button" class="playlist-item"><span class="pl-index mono"></span><span class="pl-name"></span></button>');
    node.querySelector('.pl-index').textContent = String(at + 1).padStart(2, '0');
    node.querySelector('.pl-name').textContent = part.name || ('第 ' + (at + 1) + ' 段');
    node.addEventListener('click', function () { play(at); });
    items.push(node);
    playlist.appendChild(node);
  });
  if (!parts.length) {
    playlist.appendChild(emptyState({ icon: 'file-video', title: '没有可播放的分段', line: '这个视频还没有上传文件。' }));
  }
  listPanel.body.appendChild(playlist);
  aside.appendChild(listPanel);

  const recPanel = panel('推荐其他内容', { icon: 'sparkles' });
  const recGrid = el('<div class="watch-rec"></div>');
  function drawRelated(list) {
    recGrid.innerHTML = '';
    if (!list.length) {
      recGrid.appendChild(emptyState({ icon: 'sparkles', title: '暂时没有推荐', line: '多看几个视频，推荐就会长出来。' }));
      return;
    }
    for (const card of list.slice(0, 8)) {
      const node = videoCard(card);
      node.addEventListener('click', function () { api.learn(card, 1).catch(function () {}); });
      recGrid.appendChild(node);
    }
  }
  drawRelated(related);
  recPanel.actions.appendChild(btn('换一批', 'ghost', 'refresh-cw', async function () {
    try {
      const r = await api.recommend('video', 8, [video.id]);
      drawRelated(r.items || []);
      toast('已换一批', 'ok');
    } catch (err) { toast('推荐失败：' + err.message, 'err'); }
  }));
  recPanel.body.appendChild(recGrid);
  aside.appendChild(recPanel);

  const comments = commentBlock(video.id, 'video');

  const body = el('<div class="watch-body"></div>');
  const main = el('<div class="watch-main"></div>');
  main.appendChild(intro);
  main.appendChild(trio);
  main.appendChild(comments);
  body.appendChild(main);
  body.appendChild(aside);

  paint([top, shell, body]);
  applyLook();
  loadQualities();
  if (parts.length) play(0);
  syncTime();
  requestAnimationFrame(drawEnergy);
}


/* ==================================================================== live */

/**
 * 直播间。prompt.txt 第 109 行：直播只是把视频换成实时流。
 * 因此这里复用同一套观看外壳，只是数据来自 /api/live/:nick/:pid，
 * 弹幕接到 WebSocket 的 chat 帧，右侧显示传输遥测。
 */
export async function renderWatchLive(nick, pid, secret) {
  paint(loadingRows(6));
  let data;
  try { data = await api.room(nick, pid); }
  catch (err) {
    paint([
      viewHead('直播间', decodeURIComponent(nick || '')),
      errorState(err.message || '直播间不存在', function () { navigate('/live/home/'); })
    ]);
    return;
  }

  const room = data.room || {};
  if (secret) room.secret = true;
  const isSelf = !!(state.account && room.authorId === state.account.id);

  const top = watchTop();
  const shell = el('<div class="watch-stage-shell"></div>');
  const stage = el('<div class="watch-stage"></div>');
  const media = document.createElement('video');
  media.controls = false;
  media.autoplay = true;
  media.playsInline = true;
  media.className = 'watch-video';
  stage.appendChild(media);
  const offline = el('<div class="stage-offline"></div>');
  offline.innerHTML = icon('radio-tower');
  const line = el('<p></p>');
  line.textContent = '主播还没有推送画面。';
  offline.appendChild(line);
  stage.appendChild(offline);
  shell.appendChild(stage);

  const control = el('<div class="watch-control"></div>');
  const hud = el('<div class="telemetry-strip"></div>');
  hud.appendChild(tel('MODE', room.mode));
  hud.appendChild(tel('PID', room.pid));
  hud.appendChild(tel('RES', room.resolution));
  hud.appendChild(tel('FPS', room.fps));
  hud.appendChild(tel('BR', fmtBitrate(room.bitrateKbps)));
  hud.appendChild(tel('VIEWERS', room.viewers || 0));
  control.appendChild(hud);
  shell.appendChild(control);

  const body = el('<div class="watch-body"></div>');
  const main = el('<div class="watch-main"></div>');
  const head = viewHead(room.title || '直播间', (room.author || '') + ' · ' + (room.mode || '') + ' · ' + fmtAgo(room.startedAt));
  const blurb = el('<div class="watch-blurb md"></div>');
  blurb.innerHTML = mdSafe(room.blurb || '主播还没有写简介。');
  main.appendChild(blurb);

  const chatPanel = panel('弹幕与聊天', { icon: 'message-circle' });
  const chatLog = el('<div class="chat-log"></div>');
  chatPanel.body.appendChild(chatLog);
  const compose = el('<div class="chat-compose"></div>');
  const chatInput = input({ placeholder: '说点什么…' });
  const send = btn('发送', 'ember-ghost', 'send', function () { doSend(); });
  chatInput.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); doSend(); } });
  compose.appendChild(chatInput);
  compose.appendChild(send);
  chatPanel.body.appendChild(compose);
  main.appendChild(chatPanel);

  const aside = el('<div class="watch-aside"></div>');
  const statsPanel = panel('传输遥测', { icon: 'activity' });
  const statsRow = el('<div class="stat-row"></div>');
  statsPanel.body.appendChild(statsRow);
  aside.appendChild(statsPanel);

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
        navigate('/live/home/');
      } catch (err) { toast('结束失败：' + err.message, 'err'); }
    }));
  }

  body.appendChild(main);
  body.appendChild(aside);
  paint([top, head, shell, body, actions]);

  function appendChat(name, text, at, self) {
    const node = el('<div class="chat-line"><span class="chat-who mono"></span><span class="chat-text"></span><span class="chat-at mono"></span></div>');
    if (self) node.classList.add('is-self');
    node.querySelector('.chat-who').textContent = name || '匿名';
    node.querySelector('.chat-text').textContent = text;
    node.querySelector('.chat-at').textContent = at ? new Date(at).toTimeString().slice(0, 5) : '';
    chatLog.appendChild(node);
    chatLog.scrollTop = chatLog.scrollHeight;
    while (chatLog.children.length > 200) chatLog.removeChild(chatLog.firstChild);
  }

  let streamId = null;
  try {
    const joined = await api.joinLive(room.id);
    streamId = joined.streamId;
    realtime.send({ t: 'join', streamId: streamId });
    if (joined.url) media.src = joined.url;
    if (playback.get('autoPlayLive')) media.play().catch(function () {});
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

  async function refreshSwarm() {
    if (!streamId) return;
    try {
      const r = await api.swarm(streamId);
      const swarm = r.swarm || {};
      statsRow.innerHTML = '';
      statsRow.appendChild(stat('观众', String(swarm.viewers || 0)));
      statsRow.appendChild(stat('分片', String(swarm.segments || 0)));
      statsRow.appendChild(stat('覆盖率', fmtPct(swarm.coverage || 0)));
      statsRow.appendChild(stat('主机上行', fmtPct(swarm.originUplinkShare || 0)));
    } catch (err) { /* stream may have ended */ }
  }
  refreshSwarm();
  const timer = setInterval(refreshSwarm, 3000);
  addDisposer(function () { clearInterval(timer); });
}

export default { renderPlayer, renderWatchLive };
