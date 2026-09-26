/* EasyVideo - ui.js
 * Tiny DOM/UX toolkit: icon sprite, toasts, busy meter, modal, safe markdown,
 * formatters and the designed empty state. No framework, no dependencies.
 *
 * Icon strategy: the 81 line icons ship as individual SVGs under
 * /assets/icons/<name>.svg. At boot we fetch that fixed list ONCE, fold every
 * file into a single hidden <svg> sprite of <symbol id="ic-NAME">, and render
 * icons as <svg class="ic"><use href="#ic-NAME"></use></svg>.
 */

/* ------------------------------------------------------------------ icons */

export const ICON_NAMES = [
  'clapperboard','radio-tower','circle-play','play','pause','video','cast','signal',
  'antenna','tv','monitor-play','satellite-dish','podcast','waves','rss','activity',
  'house','search','plus','history','bookmark','star','users','user','settings',
  'shield','upload','link','folder','file-video','drafting-compass','pencil','trash-2',
  'download','cloud-upload','log-out','user-plus','repeat','chevron-right','chevron-left',
  'x','check','eye','eye-off','heart','message-circle','share-2','clock','hard-drive',
  'gauge','wifi','wifi-off','server','network','layers','sparkles','wand-sparkles',
  'bug','terminal','refresh-cw','power','external-link','info','triangle-alert',
  'circle-check','loader-circle','copy','scissors','grip-vertical','panel-right',
  'filter','sliders-horizontal','cake','calendar','user-round','star-half','flame',
  'lock','globe','monitor','camera','mic'
];

const spriteNames = new Set();
let spritePromise = null;

function parseIcon(text) {
  const open = /<svg[^>]*>/i.exec(text);
  if (!open) return null;
  const viewBox = /viewBox="([^"]+)"/i.exec(open[0]);
  const inner = text.slice(open.index + open[0].length).replace(/</svg>[sS]*$/i, '').trim();
  if (!inner) return null;
  return { viewBox: viewBox ? viewBox[1] : '0 0 24 24', inner };
}

/** Fetch the icon set once and bake it into a single hidden sprite. */
export function loadIcons(names) {
  if (spritePromise) return spritePromise;
  const list = Array.isArray(names) && names.length ? names : ICON_NAMES;
  spritePromise = (async () => {
    const results = await Promise.all(list.map(async (name) => {
      try {
        const res = await fetch('/assets/icons/' + name + '.svg', { cache: 'force-cache' });
        if (!res.ok) return null;
        return { name, svg: parseIcon(await res.text()) };
      } catch { return null; }
    }));
    const host = document.createElement('div');
    host.id = 'ev-sprite';
    host.setAttribute('aria-hidden', 'true');
    host.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none';
    const parts = ['<svg xmlns="http://www.w3.org/2000/svg" style="display:none">'];
    for (const item of results) {
      if (!item || !item.svg) continue;
      spriteNames.add(item.name);
      parts.push('<symbol id="ic-' + item.name + '" viewBox="' + item.svg.viewBox + '">' + item.svg.inner + '</symbol>');
    }
    parts.push('</svg>');
    host.innerHTML = parts.join('');
    document.body.appendChild(host);
    return spriteNames;
  })();
  return spritePromise;
}

/** Icon markup. Falls back to 'info' for a name that has no sprite symbol. */
export function icon(name, cls) {
  const safe = spriteNames.has(name) ? name : (spriteNames.has('info') ? 'info' : name);
  return '<svg class="ic ' + (cls || '') + '" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><use href="#ic-' + safe + '"></use></svg>';
}

/* -------------------------------------------------------------------- dom */

export function el(html) {
  const t = document.createElement('template');
  t.innerHTML = String(html).trim();
  return t.content.firstElementChild;
}

export function frag(html) {
  const t = document.createElement('template');
  t.innerHTML = String(html);
  return t.content;
}

export const qs = (sel, scope) => (scope || document).querySelector(sel);
export const qsa = (sel, scope) => Array.from((scope || document).querySelectorAll(sel));

export function esc(value) {
  return String(value === undefined || value === null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* ----------------------------------------------------------------- toasts */

let toastHost = null;

function ensureToastHost() {
  if (toastHost && document.body.contains(toastHost)) return toastHost;
  toastHost = el('<div id="toasts" class="toast-host" role="status" aria-live="polite" aria-atomic="false"></div>');
  document.body.appendChild(toastHost);
  return toastHost;
}

const TOAST_ICON = { info: 'info', ok: 'circle-check', warn: 'triangle-alert', err: 'bug' };

/** Accessible toast. Never throws, never blocks. */
export function toast(message, kind, ttl) {
  const k = TOAST_ICON[kind] ? kind : 'info';
  const host = ensureToastHost();
  const node = el('<div class="toast toast-' + k + '" role="alert">' +
    icon(TOAST_ICON[k], 'toast-ic') +
    '<span class="toast-text"></span>' +
    '<button type="button" class="toast-x" aria-label="关闭提示">' + icon('x') + '</button>' +
    '</div>');
  node.querySelector('.toast-text').textContent = String(message);
  const kill = () => { node.classList.add('out'); setTimeout(() => node.remove(), 200); };
  node.querySelector('.toast-x').addEventListener('click', kill);
  host.appendChild(node);
  const ms = typeof ttl === 'number' ? ttl : (k === 'err' ? 7000 : 4200);
  setTimeout(kill, ms);
  return node;
}

/* ------------------------------------------------------- busy / skeletons */

let busyCount = 0;
let busyWatchdog = 0;

function busyBar() {
  let bar = document.getElementById('busybar');
  if (!bar) {
    bar = el('<div id="busybar" class="busybar" role="progressbar" aria-label="加载中"></div>');
    document.body.appendChild(bar);
  }
  return bar;
}

/** Global loading state. Every caller increments before and decrements after,
 *  so the indicator can never spin forever: a 30s watchdog resets it. */
export function setBusy(delta) {
  busyCount = Math.max(0, busyCount + (delta || 1));
  const on = busyCount > 0;
  const bar = busyBar();
  bar.classList.toggle('on', on);
  document.documentElement.classList.toggle('is-busy', on);
  if (on) {
    clearTimeout(busyWatchdog);
    busyWatchdog = setTimeout(() => {
      if (busyCount > 0) {
        busyCount = 0;
        bar.classList.remove('on');
        document.documentElement.classList.remove('is-busy');
        toast('加载超时，已重置状态', 'warn');
      }
    }, 30000);
  } else {
    clearTimeout(busyWatchdog);
  }
  return busyCount;
}

export const isBusy = () => busyCount > 0;

/** Shimmer placeholders while a view is loading. */
export function skeleton(lines, kind) {
  if (kind === 'cards') {
    let out = '<div class="sk-grid">';
    for (let i = 0; i < (lines || 4); i++) out += '<div class="sk-card"><div class="sk-poster"></div><div class="sk-line w70"></div><div class="sk-line w40"></div></div>';
    return el(out + '</div>');
  }
  if (kind === 'rows') {
    let out = '<div class="sk-rows">';
    for (let i = 0; i < (lines || 5); i++) out += '<div class="sk-row"><div class="sk-line w50"></div><div class="sk-line w20"></div></div>';
    return el(out + '</div>');
  }
  let out = '<div class="sk-block">';
  for (let i = 0; i < (lines || 4); i++) out += '<div class="sk-line w' + (i % 3 === 0 ? '90' : i % 3 === 1 ? '60' : '75') + '"></div>';
  return el(out + '</div>');
}

/* ------------------------------------------------------------- empty state */

/** A designed empty state: inline glyph, one explanatory line, primary action. */
export function emptyState(opts) {
  const o = opts || {};
  const node = el('<div class="empty">' +
    '<div class="empty-glyph">' + icon(o.icon || 'drafting-compass') + '</div>' +
    '<p class="empty-title"></p>' +
    '<p class="empty-line"></p>' +
    '<div class="empty-actions"></div>' +
    '</div>');
  node.querySelector('.empty-title').textContent = o.title || '这里还空着';
  node.querySelector('.empty-line').textContent = o.line || '还没有内容。';
  const actions = node.querySelector('.empty-actions');
  if (o.action) {
    const btn = el('<button type="button" class="btn btn-primary">' + icon(o.actionIcon || 'plus') + '<span></span></button>');
    btn.querySelector('span').textContent = o.action;
    btn.addEventListener('click', o.onAction || (() => {}));
    actions.appendChild(btn);
  }
  if (o.secondary) {
    const btn = el('<button type="button" class="btn btn-ghost">' + icon(o.secondaryIcon || 'refresh-cw') + '<span></span></button>');
    btn.querySelector('span').textContent = o.secondary;
    btn.addEventListener('click', o.onSecondary || (() => {}));
    actions.appendChild(btn);
  }
  return node;
}

/* ------------------------------------------------------------------ modal */

let openModalNode = null;
let lastFocus = null;

function onModalKey(ev) {
  if (ev.key === 'Escape' && openModalNode) { ev.preventDefault(); closeModal(); }
  if (ev.key === 'Tab' && openModalNode) {
    const items = qsa('button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])', openModalNode)
      .filter((n) => !n.disabled && n.offsetParent !== null);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last.focus(); }
    else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); }
  }
}

/** Escape closes, focus is trapped, focus returns to the opener. */
export function openModal(opts) {
  const o = opts || {};
  closeModal();
  lastFocus = document.activeElement;
  const wrap = el('<div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">' +
    '<div class="modal-card' + (o.wide ? ' modal-wide' : '') + '">' +
      '<header class="modal-hd"><h2 id="modal-title"></h2>' +
      '<button type="button" class="icon-btn modal-x" aria-label="关闭">' + icon('x') + '</button></header>' +
      '<div class="modal-bd"></div>' +
      '<footer class="modal-ft"></footer>' +
    '</div></div>');
  wrap.querySelector('#modal-title').textContent = o.title || '';
  const body = wrap.querySelector('.modal-bd');
  if (o.body instanceof Node) body.appendChild(o.body); else body.innerHTML = o.body || '';
  const ft = wrap.querySelector('.modal-ft');
  const actions = o.actions || [{ label: '关闭', kind: 'ghost', onClick: closeModal }];
  for (const a of actions) {
    const btn = el('<button type="button" class="btn btn-' + (a.kind || 'ghost') + '"></button>');
    btn.textContent = a.label;
    btn.addEventListener('click', () => { if (a.onClick) a.onClick(wrap); else closeModal(); });
    ft.appendChild(btn);
  }
  wrap.querySelector('.modal-x').addEventListener('click', closeModal);
  wrap.addEventListener('mousedown', (ev) => { if (ev.target === wrap) closeModal(); });
  document.body.appendChild(wrap);
  document.body.classList.add('has-modal');
  openModalNode = wrap.querySelector('.modal-card');
  document.addEventListener('keydown', onModalKey);
  requestAnimationFrame(() => wrap.classList.add('in'));
  const focusTarget = o.initialFocus ? body.querySelector(o.initialFocus) : qsa('button,input,select,textarea', body)[0];
  if (focusTarget) focusTarget.focus();
  else wrap.querySelector('.modal-x').focus();
  return wrap;
}

export function closeModal() {
  const wrap = document.querySelector('.modal');
  if (wrap) { wrap.remove(); document.body.classList.remove('has-modal'); }
  openModalNode = null;
  document.removeEventListener('keydown', onModalKey);
  if (lastFocus && lastFocus.focus) { try { lastFocus.focus(); } catch { /* gone */ } }
  lastFocus = null;
}

/** Promise-based confirm built on the same modal. */
export function confirmDialog(opts) {
  const o = opts || {};
  return new Promise((resolve) => {
    openModal({
      title: o.title || '确认操作',
      body: '<p class="modal-text">' + esc(o.text || '确定要继续吗？') + '</p>',
      actions: [
        { label: o.cancelLabel || '取消', kind: 'ghost', onClick: () => { closeModal(); resolve(false); } },
        { label: o.okLabel || '确定', kind: o.danger ? 'danger' : 'primary', onClick: () => { closeModal(); resolve(true); } }
      ]
    });
  });
}

/* -------------------------------------------------------------- markdown */

/** Render a tiny SAFE markdown subset. The raw input is HTML-escaped first, so
 *  nothing a user types can ever become markup. Supported: # ## ###, **bold**,
 *  *italic*, `code`, [text](http link), - and * lists, 1. lists, > quote, ---.
 *  Implemented with plain string scanning so there are no regex escapes to lose. */
function safeHref(href) {
  const h = String(href || "").trim();
  if (h.indexOf("http://") === 0 || h.indexOf("https://") === 0) return h;
  if (h.charAt(0) === "/" || h.charAt(0) === "#") return h;
  return null;
}

function inlineMd(text, tick, star) {
  const DQ = String.fromCharCode(34);
  let out = "";
  let i = 0;
  while (i < text.length) {
    const ch = text.charAt(i);
    if (ch === tick) {
      const end = text.indexOf(tick, i + 1);
      if (end > i) { out += "<code>" + text.slice(i + 1, end) + "</code>"; i = end + 1; continue; }
    }
    if (ch === star && text.charAt(i + 1) === star) {
      const end = text.indexOf(star + star, i + 2);
      if (end > i + 1) { out += "<strong>" + text.slice(i + 2, end) + "</strong>"; i = end + 2; continue; }
    }
    if (ch === star) {
      const end = text.indexOf(star, i + 1);
      if (end > i + 1) { out += "<em>" + text.slice(i + 1, end) + "</em>"; i = end + 1; continue; }
    }
    if (ch === "[") {
      const labelEnd = text.indexOf("](", i + 1);
      if (labelEnd > i) {
        const hrefEnd = text.indexOf(")", labelEnd + 2);
        if (hrefEnd > labelEnd + 2) {
          const label = text.slice(i + 1, labelEnd);
          const href = safeHref(text.slice(labelEnd + 2, hrefEnd));
          if (href) {
            out += "<a href=" + DQ + href + DQ + " target=" + DQ + "_blank" + DQ +
              " rel=" + DQ + "noopener noreferrer" + DQ + ">" + label + "</a>";
            i = hrefEnd + 1;
            continue;
          }
        }
      }
    }
    out += ch;
    i++;
  }
  return out;
}

function isRule(line) {
  if (line.length < 3) return false;
  const first = line.charAt(0);
  if (first !== "-" && first !== "*") return false;
  for (let i = 1; i < line.length; i++) if (line.charAt(i) !== first) return false;
  return true;
}

function headingLevel(line) {
  let n = 0;
  while (n < line.length && line.charAt(n) === "#") n++;
  if (n === 0 || n > 3) return 0;
  if (line.charAt(n) !== " ") return 0;
  return n;
}

function orderedIndex(line) {
  let n = 0;
  while (n < line.length && line.charAt(n) >= "0" && line.charAt(n) <= "9") n++;
  if (n === 0 || n >= line.length) return -1;
  const mark = line.charAt(n);
  if (mark !== "." && mark !== ")") return -1;
  if (line.charAt(n + 1) !== " ") return -1;
  return n;
}

export function mdSafe(src) {
  const DQ = String.fromCharCode(34);
  const tick = String.fromCharCode(96);
  const star = String.fromCharCode(42);
  const escaped = esc(src);
  const lines = escaped.split(String.fromCharCode(10));
  const out = [];
  let listOpen = null;
  const closeList = () => { if (listOpen) { out.push("</" + listOpen + ">"); listOpen = null; } };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { closeList(); continue; }
    const level = headingLevel(line);
    if (level) {
      closeList();
      const tag = "h" + (level + 1);
      out.push("<" + tag + ">" + inlineMd(line.slice(level + 1), tick, star) + "</" + tag + ">");
      continue;
    }
    if (isRule(line)) { closeList(); out.push("<hr>"); continue; }
    if (line.indexOf("&gt; ") === 0) {
      closeList();
      out.push("<blockquote>" + inlineMd(line.slice(5), tick, star) + "</blockquote>");
      continue;
    }
    if (line.indexOf("- ") === 0 || line.indexOf(star + " ") === 0) {
      if (listOpen !== "ul") { closeList(); out.push("<ul>"); listOpen = "ul"; }
      out.push("<li>" + inlineMd(line.slice(2), tick, star) + "</li>");
      continue;
    }
    const oi = orderedIndex(line);
    if (oi > 0) {
      if (listOpen !== "ol") { closeList(); out.push("<ol>"); listOpen = "ol"; }
      out.push("<li>" + inlineMd(line.slice(oi + 2), tick, star) + "</li>");
      continue;
    }
    closeList();
    out.push("<p>" + inlineMd(line, tick, star) + "</p>");
  }
  closeList();
  return out.join(DQ + DQ) || ('<p class=' + DQ + 'dim' + DQ + '>（没有内容）</p>');
}

/* ------------------------------------------------------------ formatters */

export function fmtBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return n + ' B';
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024; let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return v.toFixed(v < 10 ? 1 : 0) + ' ' + units[i];
}

export function fmtDuration(sec) {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); const ss = s % 60;
  const p = (x) => String(x).padStart(2, '0');
  return h ? h + ':' + p(m) + ':' + p(ss) : m + ':' + p(ss);
}

export function fmtDate(ms) {
  const n = Number(ms) || 0;
  if (!n) return '—';
  const d = new Date(n);
  const p = (x) => String(x).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}

export function fmtAgo(ms) {
  const n = Number(ms) || 0;
  if (!n) return '—';
  const diff = Date.now() - n;
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return Math.floor(diff / 60000) + ' 分钟前';
  if (diff < 86400000) return Math.floor(diff / 3600000) + ' 小时前';
  if (diff < 2592000000) return Math.floor(diff / 86400000) + ' 天前';
  return fmtDate(n);
}

export function fmtBitrate(kbps) {
  const n = Number(kbps) || 0;
  return n >= 1000 ? (n / 1000).toFixed(n % 1000 === 0 ? 0 : 1) + ' Mbps' : n + ' kbps';
}

export function fmtPct(v) { return Math.round((Number(v) || 0) * 100) + '%'; }

/* base64 helpers that survive non-ASCII (btoa alone would throw). */
/**
 * PID 在 URL 里一律是 base64url：任意长度的 ASCII PID 都能安全地放进路径。
 * 旧的未编码链接仍然能读，服务端会先当作明文再尝试解码。
 */
export function pidEncode(pid) {
  const text = String(pid === undefined || pid === null ? '' : pid);
  if (!text) return '';
  try {
    return btoa(unescape(encodeURIComponent(text))).replace(/[+]/g, '-').replace(/[/]/g, '_').replace(/=+$/, '');
  } catch (err) { return encodeURIComponent(text); }
}

export function pidDecode(token) {
  const text = String(token === undefined || token === null ? '' : token);
  if (!text) return '';
  try {
    const pad = text.length % 4 ? '='.repeat(4 - (text.length % 4)) : '';
    const raw = atob(text.replace(/[-]/g, '+').replace(/[_]/g, '/') + pad);
    const decoded = decodeURIComponent(escape(raw));
    if (decoded) return decoded;
  } catch (err) { /* 不是 base64，按明文 */ }
  try { return decodeURIComponent(text); } catch (err) { return text; }
}

export function b64(text) {
  const bytes = new TextEncoder().encode(String(text));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export function unb64(text) {
  try {
    const bin = atob(String(text).replace(/-/g, '+').replace(/_/g, '/'));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  } catch { return ''; }
}

/** Recording name template preview - mirrors the server formatter exactly. */
export function formatTemplate(tpl, ctx) {
  const c = ctx || {};
  const d = c.date instanceof Date ? c.date : new Date();
  const p = (n, w) => String(Math.abs(n)).padStart(w, '0');
  const isoWeek = (dt) => {
    const t = new Date(Date.UTC(dt.getFullYear(), dt.getMonth(), dt.getDate()));
    const day = t.getUTCDay() || 7;
    t.setUTCDate(t.getUTCDate() + 4 - day);
    const ys = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
    return Math.ceil(((t - ys) / 86400000 + 1) / 7);
  };
  const h24 = d.getHours();
  const off = -d.getTimezoneOffset();
  const map = {
    '%CCYY': String(d.getFullYear()),
    '%YY': p(d.getFullYear() % 100, 2),
    '%MM': p(d.getMonth() + 1, 2),
    '%DD': p(d.getDate(), 2),
    '%WW': p(isoWeek(d), 2),
    '%HH': p(h24, 2),
    '%hh': p(((h24 + 11) % 12) + 1, 2),
    '%mm': p(d.getMinutes(), 2),
    '%SS': p(d.getSeconds(), 2),
    '%NUM': p(Number(c.index) || 1, 3),
    '%UN': String(c.username || 'user'),
    '%P': h24 < 12 ? 'AM' : 'PM',
    '%Z': (off >= 0 ? '+' : '-') + p(Math.floor(Math.abs(off) / 60), 2) + p(Math.abs(off) % 60, 2)
  };
  let out = String(tpl || '%CCYY-%MM-%DD_%HH-%mm-%SS');
  for (const key of Object.keys(map)) out = out.split(key).join(map[key]);
  return out || 'recording';
}

export const TEMPLATE_TOKENS = ['%CCYY', '%MM', '%DD', '%WW', '%HH', '%mm', '%SS', '%NUM', '%UN', '%P', '%Z'];

/* ----------------------------------------------------------------- misc */

export function debounce(fn, ms) {
  let t = 0;
  return function debounced() {
    const args = arguments; const self = this;
    clearTimeout(t);
    t = setTimeout(() => fn.apply(self, args), ms || 220);
  };
}

/** Clipboard with a graceful fallback for non-secure contexts. */
export async function copyText(text) {
  const value = String(text === undefined || text === null ? '' : text);
  try {
    if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(value); return true; }
  } catch { /* fall through */ }
  try {
    const ta = el('<textarea class="copy-shim" aria-hidden="true"></textarea>');
    ta.value = value;
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch { return false; }
}

/* ---- avatars --------------------------------------------------------- */

export function initialsOf(account) {
  const src = String((account && (account.nickname || account.name || account.username)) || 'EV').trim();
  const chars = Array.from(src);
  if (!chars.length) return 'EV';
  if (chars.length === 1) return chars[0].toUpperCase();
  return (chars[0] + chars[1]).toUpperCase();
}

/** Avatar: real image when the account has one, initials otherwise. */
export function avatarNode(account, size) {
  const cls = 'avatar' + (size ? ' avatar-' + size : '');
  const node = el('<span class="' + cls + '"></span>');
  const src = account && account.avatar;
  if (src && /^(https?:|\/|data:image)/i.test(String(src))) {
    const img = el('<img alt="">');
    img.src = String(src);
    img.alt = (account && account.nickname) || '头像';
    img.addEventListener('error', () => { img.remove(); node.textContent = initialsOf(account); });
    node.appendChild(img);
  } else {
    node.textContent = initialsOf(account);
  }
  return node;
}

/** Avatar picker row: shows the current avatar and lets the user paste a path/URL. */
export function avatarField(account, onChange) {
  const row = el('<div class="row"></div>');
  row.appendChild(avatarNode(account, 'lg'));
  const stack = el('<div class="stack"></div>');
  const box = input({ placeholder: '图片路径或 https:// 链接', value: (account && account.avatar) || '' });
  box.setAttribute('aria-label', '头像地址');
  box.addEventListener('input', () => { if (onChange) onChange(box.value.trim()); });
  const hint = el('<span class="field-hint">支持 http(s) 链接或本机绝对路径；留空则使用昵称首字。​</span>');
  stack.appendChild(box);
  stack.appendChild(hint);
  row.appendChild(stack);
  return row;
}

/* ---- small composite widgets ---------------------------------------- */

/** Labeled form row. pass required=true to render the required star. */
export function field(label, control, opts) {
  const o = opts || {};
  const node = el('<label class="field' + (o.inline ? ' field-inline' : '') + '">' +
    '<span class="field-label"></span><span class="field-control"></span>' +
    (o.hint ? '<span class="field-hint"></span>' : '') + '</label>');
  node.querySelector('.field-label').innerHTML = esc(label) + (o.required ? '<b class="req" aria-hidden="true">*</b>' : '');
  node.querySelector('.field-control').appendChild(control);
  if (o.hint) node.querySelector('.field-hint').textContent = o.hint;
  if (o.id && control.id) node.setAttribute('for', control.id);
  return node;
}

export function input(attrs) {
  const a = Object.assign({ type: 'text', class: 'input' }, attrs || {});
  const node = document.createElement('input');
  for (const [k, v] of Object.entries(a)) {
    if (k === 'class') node.className = v; else if (v !== undefined && v !== null) node.setAttribute(k, v);
  }
  return node;
}

export function textarea(attrs) {
  const a = Object.assign({ class: 'textarea' }, attrs || {});
  const node = document.createElement('textarea');
  for (const [k, v] of Object.entries(a)) {
    if (k === 'class') node.className = v; else if (k === 'text') node.textContent = v; else if (v !== undefined && v !== null) node.setAttribute(k, v);
  }
  if (a.text) node.value = a.text;
  return node;
}

export function select(options, attrs) {
  const a = Object.assign({ class: 'select' }, attrs || {});
  const wanted = a.value;
  const node = document.createElement('select');
  for (const [k, v] of Object.entries(a)) {
    if (k === 'class') node.className = v;
    else if (k === 'value') continue; // <select> 的 value 只能作为属性设置，见下
    else if (v !== undefined && v !== null) node.setAttribute(k, v);
  }
  for (const opt of options || []) {
    const o = document.createElement('option');
    o.value = String(opt.value === undefined ? opt : opt.value);
    o.textContent = String(opt.label === undefined ? opt : opt.label);
    if (opt.disabled) o.disabled = true;
    node.appendChild(o);
  }
  // setAttribute('value') 对 <select> 无效，必须等选项都在了再设属性。
  if (wanted !== undefined && wanted !== null) node.value = String(wanted);
  return node;
}

export function button(label, kind, iconName) {
  const node = el('<button type="button" class="btn btn-' + (kind || 'ghost') + '">' + (iconName ? icon(iconName) : '') + '<span></span></button>');
  node.querySelector('span').textContent = label;
  return node;
}

export function iconButton(name, label, kind) {
  const node = el('<button type="button" class="icon-btn ' + (kind || '') + '" title="' + esc(label) + '" aria-label="' + esc(label) + '">' + icon(name) + '</button>');
  return node;
}

/** On/off switch with a real checkbox input under the hood. */
export function switchControl(opts) {
  const o = opts || {};
  const wrap = el('<span class="switch"><input type="checkbox" class="switch-input"><span class="switch-track" aria-hidden="true"><span class="switch-knob"></span></span><span class="switch-label"></span></span>');
  const box = wrap.querySelector('input');
  box.checked = !!o.checked;
  if (o.id) box.id = o.id;
  if (o.name) box.name = o.name;
  wrap.querySelector('.switch-label').textContent = o.label || '';
  if (o.onChange) box.addEventListener('change', () => o.onChange(box.checked, box));
  wrap.getValue = () => box.checked;
  wrap.setValue = (v) => { box.checked = !!v; };
  wrap.input = box;
  return wrap;
}

export function checkbox(label, checked, onChange, attrs) {
  const a = attrs || {};
  const node = el('<label class="check"><input type="checkbox" class="check-input">' + icon('check', 'check-mark') + '<span class="check-label"></span></label>');
  const box = node.querySelector('input');
  box.checked = !!checked;
  if (a.id) box.id = a.id;
  if (a.name) box.name = a.name;
  if (a.value !== undefined) box.value = a.value;
  node.querySelector('.check-label').textContent = label;
  if (onChange) box.addEventListener('change', () => onChange(box.checked, box));
  node.input = box;
  return node;
}

export function radio(name, value, label, checked, onChange) {
  const node = el('<label class="radio"><input type="radio" class="radio-input"><span class="radio-dot" aria-hidden="true"></span><span class="radio-label"></span></label>');
  const box = node.querySelector('input');
  box.name = name; box.value = value; box.checked = !!checked;
  node.querySelector('.radio-label').textContent = label;
  if (onChange) box.addEventListener('change', () => { if (box.checked) onChange(value); });
  node.input = box;
  return node;
}

export function chip(label, opts) {
  const o = opts || {};
  const node = el('<button type="button" class="chip' + (o.tone ? ' chip-' + o.tone : '') + '"></button>');
  if (o.icon) node.innerHTML = icon(o.icon);
  node.appendChild(document.createTextNode(label));
  if (o.onClick) node.addEventListener('click', o.onClick);
  if (o.title) node.title = o.title;
  if (o.static) { node.disabled = true; node.classList.add('chip-static'); }
  return node;
}

export function tagChip(label, tone) {
  const node = el('<span class="chip chip-static' + (tone ? ' chip-' + tone : '') + '"></span>');
  node.textContent = label;
  return node;
}

/** Section shell used by every view: optional header actions + body. */
export function panel(title, opts) {
  const o = opts || {};
  const node = el('<section class="panel' + (o.className ? ' ' + o.className : '') + '">' +
    '<header class="panel-hd"><div class="panel-tt"><h2></h2></div><div class="panel-actions"></div></header>' +
    '<div class="panel-bd"></div></section>');
  node.querySelector('h2').innerHTML = (o.icon ? icon(o.icon, 'panel-ic') : '') + esc(title || '');
  if (o.subtitle) {
    const sub = el('<p class="panel-sub"></p>');
    sub.textContent = o.subtitle;
    node.querySelector('.panel-tt').appendChild(sub);
  }
  node.body = node.querySelector('.panel-bd');
  node.actions = node.querySelector('.panel-actions');
  return node;
}

/** Small metric block used across telemetry strips. */
export function stat(label, value, opts) {
  const o = opts || {};
  const node = el('<div class="stat' + (o.tone ? ' stat-' + o.tone : '') + '"><span class="stat-k"></span><span class="stat-v mono"></span></div>');
  node.querySelector('.stat-k').textContent = label;
  node.querySelector('.stat-v').textContent = value === undefined || value === null ? '—' : String(value);
  if (o.title) node.title = o.title;
  return node;
}

export function meter(value, label) {
  const pct = Math.max(0, Math.min(1, Number(value) || 0));
  const node = el('<div class="meter" role="img"><div class="meter-track"><div class="meter-fill"></div></div><span class="meter-label mono"></span></div>');
  node.querySelector('.meter-fill').style.width = (pct * 100).toFixed(1) + '%';
  node.querySelector('.meter-label').textContent = label === undefined ? Math.round(pct * 100) + '%' : label;
  node.setAttribute('aria-label', (label === undefined ? Math.round(pct * 100) + '%' : label));
  return node;
}

/** Render a clickable row: used by drafts (a list, never cards) and settings. */
export function listRow(opts) {
  const o = opts || {};
  const node = el('<div class="list-row" tabindex="0" role="button">' +
    '<div class="row-glyph">' + icon(o.icon || 'file-video') + '</div>' +
    '<div class="row-main"><p class="row-title"></p><p class="row-sub"></p></div>' +
    '<div class="row-meta mono"></div>' +
    '<div class="row-tools"></div></div>');
  node.querySelector('.row-title').textContent = o.title || '';
  node.querySelector('.row-sub').textContent = o.sub || '';
  node.querySelector('.row-meta').textContent = o.meta || '';
  for (const t of o.tools || []) node.querySelector('.row-tools').appendChild(t);
  const activate = (ev) => {
    if (ev.target.closest('.row-tools')) return;
    if (o.onOpen) o.onOpen(ev);
  };
  node.addEventListener('click', activate);
  node.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); activate(ev); } });
  return node;
}

/** Shown when a route or record is missing. */
export function notFound(title, line, action, onAction) {
  return emptyState({ icon: 'triangle-alert', title: title || '没有找到内容', line: line || '它可能已被删除或链接有误。', action, onAction });
}
