/* EasyVideo - views/kit.js
 * Shared view toolkit: paint/dispose lifecycle, section heads, the FEATURED
 * live card (2 columns, 21:9), the 16:9 video card and the library rows.
 */
import {
  el, icon, esc, tagChip, fmtDuration, fmtAgo, fmtBitrate, skeleton, emptyState, toast, pidEncode
} from '../ui.js';
import { navigate } from '../router.js';
export { listRow, stat, meter, tagChip } from '../ui.js';

/* ------------------------------------------------------------- lifecycle */

const disposers = [];

/** Views register timers / realtime handlers here so a route change is clean. */
export function addDisposer(fn) {
  if (typeof fn === 'function') disposers.push(fn);
}

export function disposeView() {
  while (disposers.length) {
    const fn = disposers.pop();
    try { fn(); } catch (err) { console.warn('view disposer failed', err); }
  }
}

export function host() { return document.getElementById('view'); }

/** Replace the view body. Disposing first keeps the app leak-free. */
export function paint(nodes) {
  disposeView();
  const v = host();
  if (!v) return;
  v.innerHTML = '';
  const list = Array.isArray(nodes) ? nodes : [nodes];
  for (const node of list) if (node) v.appendChild(node);
  v.scrollTop = 0;
}

export function isImageSrc(value) {
  const s = String(value || '');
  return s.indexOf('http://') === 0 || s.indexOf('https://') === 0
    || s.charAt(0) === '/' || s.indexOf('data:image') === 0;
}

export function btn(label, kind, iconName, onClick) {
  const node = el('<button type="button" class="btn btn-' + (kind || 'ghost') + '"></button>');
  if (iconName) node.innerHTML = icon(iconName);
  const text = el('<span></span>');
  text.textContent = label;
  node.appendChild(text);
  if (onClick) node.addEventListener('click', onClick);
  return node;
}

export function iconBtn(name, label, kind, onClick) {
  const node = el('<button type="button" class="icon-btn ' + (kind || '')
    + '" title="' + esc(label) + '" aria-label="' + esc(label) + '">' + icon(name) + '</button>');
  if (onClick) node.addEventListener('click', onClick);
  return node;
}

export function viewHead(title, sub, actions) {
  const node = el('<div class="view-head"><div class="vh-text"><h2></h2><p class="vh-sub"></p></div>'
    + '<div class="vh-actions"></div></div>');
  node.querySelector('h2').textContent = title || '';
  node.querySelector('.vh-sub').textContent = sub || '';
  const box = node.querySelector('.vh-actions');
  for (const action of actions || []) if (action) box.appendChild(action);
  return node;
}

export function sectionHead(title, opts) {
  const o = opts || {};
  const node = el('<div class="section-head"><h3></h3><span class="section-note"></span>'
    + '<div class="section-tools"></div></div>');
  const h = node.querySelector('h3');
  if (o.mark) {
    const mark = el('<span class="section-mark"></span>');
    mark.textContent = o.mark;
    h.appendChild(mark);
  }
  const text = el('<span></span>');
  text.textContent = title || '';
  h.appendChild(text);
  node.querySelector('.section-note').textContent = o.note || '';
  const tools = node.querySelector('.section-tools');
  for (const tool of o.tools || []) if (tool) tools.appendChild(tool);
  return node;
}

/** One telemetry reading - the ONLY place signal-cyan is allowed. */
export function tel(k, v) {
  const node = el('<span class="tel"><span class="tel-k"></span><span class="tel-v"></span></span>');
  node.querySelector('.tel-k').textContent = k;
  node.querySelector('.tel-v').textContent = (v === undefined || v === null || v === '') ? '-' : String(v);
  return node;
}

export function loadingCards(n) { return skeleton(n || 4, 'cards'); }
export function loadingRows(n) { return skeleton(n || 5, 'rows'); }

export function errorState(message, onRetry) {
  return emptyState({
    icon: 'triangle-alert',
    title: '加载失败',
    line: message || '无法获取数据，请稍后重试。',
    action: '重试',
    actionIcon: 'refresh-cw',
    onAction: onRetry || function () { navigate('//home/'.replace('//', '/')); }
  });
}

/* --------------------------------------------------------------- posters */

export function posterBox(card, cls) {
  const box = el('<div class="' + cls + '"></div>');
  if (isImageSrc(card.cover)) {
    const img = el('<img alt="">');
    img.src = String(card.cover);
    img.alt = card.title || '';
    img.addEventListener('error', function () { img.remove(); });
    box.appendChild(img);
  } else {
    const letter = el('<span class="poster-letter mono"></span>');
    const title = String(card.title || 'EV').trim();
    letter.textContent = (title.charAt(0) || 'E').toUpperCase();
    box.appendChild(letter);
  }
  return box;
}

export function liveRoute(card) {
  if (card && card.path) return card.path;
  const base = card && card.secret ? '/live/secret/' : '/live/';
  return base + encodeURIComponent((card && card.author) || '') + '/' + pidEncode((card && card.pid) || '') + '/';
}

export function videoRoute(card) {
  if (card && card.path) return card.path;
  const base = card && card.secret ? '/video/secret/' : '/video/';
  return base + encodeURIComponent((card && card.author) || '') + '/' + pidEncode((card && card.pid) || '') + '/';
}

/* ------------------------------------------------------------ live cards */

export function liveCard(card, opts) {
  const o = opts || {};
  const node = el('<button type="button" class="live-card"></button>');
  if (o.featured) node.classList.add('is-featured');
  node.title = card.title || '';

  const box = posterBox(card, 'live-poster');
  box.appendChild(el('<span class="badge-live"><span class="pulse"></span>LIVE</span>'));
  if (card.secret) {
    box.appendChild(el('<span class="badge-corner secret">' + icon('lock') + '<span>私密</span></span>'));
  } else {
    const corner = el('<span class="badge-corner">' + icon('users') + '<span class="mono"></span></span>');
    corner.querySelector('span.mono').textContent = String(card.viewers || 0);
    box.appendChild(corner);
  }
  node.appendChild(box);

  const body = el('<div class="live-body"><p class="live-title"></p><p class="live-blurb"></p>'
    + '<div class="live-foot"><span class="mono lf-author"></span><span class="dot-sep"></span>'
    + '<span class="lf-time"></span></div></div>');
  body.querySelector('.live-title').textContent = card.title || '未命名直播';
  body.querySelector('.live-blurb').textContent = card.blurb || '主播还没有写简介。';
  body.querySelector('.lf-author').textContent = card.author || '匿名';
  body.querySelector('.lf-time').textContent = card.status === 'ended'
    ? ('已结束 · ' + fmtAgo(card.endedAt || card.startedAt))
    : fmtAgo(card.startedAt);
  node.appendChild(body);

  const strip = el('<div class="telemetry-strip"></div>');
  strip.appendChild(tel('MODE', card.mode));
  strip.appendChild(tel('RES', card.resolution));
  strip.appendChild(tel('FPS', card.fps));
  strip.appendChild(tel('BR', fmtBitrate(card.bitrateKbps)));
  node.appendChild(strip);

  node.addEventListener('click', function () { navigate(liveRoute(card)); });
  return node;
}

/* ----------------------------------------------------------- video cards */

export function videoCard(card) {
  const node = el('<button type="button" class="video-card"></button>');
  node.title = card.title || '';

  const thumb = posterBox(card, 'video-thumb');
  const dur = el('<span class="badge-duration mono"></span>');
  dur.textContent = fmtDuration(card.durationSec || 0);
  thumb.appendChild(dur);
  if (card.secret) thumb.appendChild(el('<span class="badge-corner secret">' + icon('lock') + '<span>私密</span></span>'));
  node.appendChild(thumb);

  const meta = el('<div class="video-meta"><p class="v-title"></p><p class="v-sub"></p>'
    + '<div class="chip-row"></div></div>');
  meta.querySelector('.v-title').textContent = card.title || '未命名视频';
  const sub = meta.querySelector('.v-sub');
  const parts = el('<span class="mono"></span>');
  parts.textContent = String(card.parts || 1) + ' 段';
  sub.appendChild(parts);
  const author = el('<span></span>');
  author.textContent = card.author || '匿名';
  sub.appendChild(author);
  const views = el('<span></span>');
  views.textContent = String(card.views || 0) + ' 次播放';
  sub.appendChild(views);
  const when = el('<span></span>');
  when.textContent = fmtAgo(card.createdAt);
  sub.appendChild(when);
  const chips = meta.querySelector('.chip-row');
  if (card.collection) chips.appendChild(tagChip(card.collection));
  for (const tag of (card.tags || []).slice(0, 3)) chips.appendChild(tagChip(tag));
  node.appendChild(meta);

  node.addEventListener('click', function () { navigate(videoRoute(card)); });
  return node;
}

/* --------------------------------------------------------------- grids */

export function liveGrid(items, opts) {
  const o = opts || {};
  const grid = el('<div class="live-grid"></div>');
  const list = (items || []).slice(0, o.limit || 24);
  for (let i = 0; i < list.length; i++) {
    grid.appendChild(liveCard(list[i], { featured: o.featured !== false && i === 0 }));
  }
  return grid;
}

export function videoGrid(items, opts) {
  const o = opts || {};
  const grid = el('<div class="video-grid"></div>');
  const list = (items || []).slice(0, o.limit || 24);
  for (const card of list) grid.appendChild(videoCard(card));
  return grid;
}

/* -------------------------------------------------------- library rows */

export function rowRoute(row) {
  if (row.route) return row.route;
  const live = row.kind === 'live' || row.kind === 'search-live';
  if (row.pid && row.author) {
    return (live ? '/live/' : '/video/') + encodeURIComponent(row.author) + '/' + encodeURIComponent(row.pid) + '/';
  }
  return null;
}

export function historyRow(row, opts) {
  const o = opts || {};
  const node = el('<div class="history-row" role="button" tabindex="0"><span class="h-when mono"></span>'
    + '<div class="h-main"><p class="h-title"></p><p class="h-sub"></p></div>'
    + '<div class="row-tools"></div></div>');
  node.querySelector('.h-when').textContent = fmtAgo(row.createdAt || row.at);
  node.querySelector('.h-title').textContent = row.title || row.query || '未命名记录';
  const live = row.kind === 'live' || row.kind === 'search-live';
  node.querySelector('.h-sub').textContent = row.author
    ? (row.author + ' · ' + (live ? '直播' : '视频'))
    : (row.kind || '记录');
  const tools = node.querySelector('.row-tools');
  for (const tool of o.tools || []) if (tool) tools.appendChild(tool);
  const route = rowRoute(row);
  const open = function (ev) {
    if (ev.target.closest('.row-tools')) return;
    if (route) navigate(route);
    else toast('这条记录没有可打开的目标', 'warn');
  };
  node.addEventListener('click', open);
  node.addEventListener('keydown', function (ev) {
    if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); open(ev); }
  });
  return node;
}

export function gridOf(nodes, cls) {
  const grid = el('<div class="' + (cls || 'grid-auto') + '"></div>');
  for (const node of nodes || []) if (node) grid.appendChild(node);
  return grid;
}