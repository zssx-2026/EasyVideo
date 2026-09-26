/* EasyVideo - app.js
 * Application shell: the fixed left icon rail, the topbar, the route table and
 * the boot sequence. This is the only module index.html loads.
 */

import { api, Realtime } from './api.js';
import { state, subscribe, bootstrap, refreshCounts } from './store.js';
import { route, startRouter, navigate, bindLinkDelegate, dispatch } from './router.js';
import {
  loadIcons, ICON_NAMES, icon, el, toast, qs, openModal, closeModal,
  avatarNode, setBusy, b64
} from './ui.js';

import { renderHome, renderHistory, renderLater, renderFavorites, renderGlobalSearch } from './views/library.js';
import { renderLiveHome, renderNewLive, renderLiveSearch } from './views/live.js';
import { renderVideoHome, renderVideoSearch } from './views/video.js';
import { renderRelease, renderDraftNew, renderDraftEdit } from './views/drafts.js';
import { renderPlayer, renderWatchLive } from './views/player.js';
import { applyTheme } from './views/theme-panel.js';

/* 启动即应用已保存的主题。 */
try { applyTheme(); } catch (err) { /* 主题不可用也不阻塞启动 */ }
import { renderFriends } from './views/friends.js';
import { renderMyself } from './views/myself.js';
import { renderMyData } from './views/mydata.js';
import { renderPrivacy } from './views/privacy.js';
import { renderSettings } from './views/settings.js';
import { renderDiscover } from './views/discover.js';

/* ------------------------------------------------------------------- rail */

const RAIL = [
  { id: 'live', label: '直播', ic: 'radio-tower', path: '/live/home/', count: 'live' },
  { id: 'video', label: '视频', ic: 'clapperboard', path: '/video/home/', count: 'video' },
  { id: 'history', label: '历史记录', ic: 'history', path: '/home/history/', count: 'history' },
  { id: 'later', label: '稍后再看', ic: 'bookmark', path: '/home/later/', count: 'later' },
  { id: 'favorites', label: '收藏', ic: 'star', path: '/home/favorites/', count: 'favorites' },
  { id: 'friends', label: '好友', ic: 'users', path: '/home/friends/', count: 'friends' }
];

const RAIL_FOOT = [
  { id: 'myself', label: '我的', ic: 'user-round', path: '/home/myself/', count: null },
  { id: 'settings', label: '设置', ic: 'settings', path: '/home/settings/', count: null }
];

function railButton(item) {
  const node = el('<button type="button" class="rail-item" role="tab" aria-selected="false">' +
    icon(item.ic) + '<span class="rail-label"></span>' +
    (item.count ? '<span class="rail-count mono" data-count="' + item.count + '">0</span>' : '') +
    '</button>');
  node.querySelector('.rail-label').textContent = item.label;
  node.dataset.rail = item.id;
  node.title = item.label;
  node.addEventListener('click', () => navigate(item.path));
  return node;
}

function buildRail() {
  const nav = qs('#rail-nav');
  const foot = qs('#rail-foot');
  const glyph = qs('#rail-mark-glyph');
  if (glyph) glyph.innerHTML = icon('clapperboard');
  if (nav) nav.innerHTML = '';
  if (foot) foot.innerHTML = '';
  for (const item of RAIL) if (nav) nav.appendChild(railButton(item));
  for (const item of RAIL_FOOT) if (foot) foot.appendChild(railButton(item));
}

function activeRailId(path) {
  if (path.startsWith('/live/')) return 'live';
  if (path.startsWith('/video/release') || path.startsWith('/video/draft')) return 'video';
  if (path.startsWith('/video/')) return 'video';
  if (path.startsWith('/home/history')) return 'history';
  if (path.startsWith('/home/later')) return 'later';
  if (path.startsWith('/home/favorites')) return 'favorites';
  if (path.startsWith('/home/friends')) return 'friends';
  if (path.startsWith('/home/myself')) return 'myself';
  if (path.startsWith('/home/settings') || path.startsWith('/home/privacy') || path.startsWith('/home/mydata')) return 'settings';
  return 'home';
}

/** Active item: ember left bar + warm glow, plus a roving tabindex so the rail
 *  is fully keyboard navigable (arrow keys move, Enter activates). */
function syncRail(current) {
  const path = current && current.path ? current.path : '/home/';
  const want = activeRailId(path);
  const items = Array.from(document.querySelectorAll('.rail-item'));
  for (const node of items) {
    const on = node.dataset.rail === want;
    node.classList.toggle('is-active', on);
    node.setAttribute('aria-selected', on ? 'true' : 'false');
    node.tabIndex = on ? 0 : -1;
  }
}

function syncRailCounts() {
  const counts = state.counts || {};
  for (const node of document.querySelectorAll('.rail-count')) {
    const value = Number(counts[node.dataset.count] || 0);
    node.textContent = value > 99 ? '99+' : String(value);
    node.hidden = value <= 0;
  }
}

function railKeyNav(ev) {
  if (ev.key !== 'ArrowDown' && ev.key !== 'ArrowUp') return;
  const items = Array.from(document.querySelectorAll('.rail-item'));
  const idx = items.indexOf(document.activeElement);
  if (idx < 0) return;
  ev.preventDefault();
  const next = items[(idx + (ev.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length];
  next.focus();
}

/* ---------------------------------------------------------------- topbar */

const TITLES = [
  ['/live/newlive/', '新建直播房间', '直播 · 开播'],
  ['/live/secret/', '私密直播', '直播 · 仅受邀可见'],
  ['/live/search/', '直播搜索', '直播 · 搜索结果'],
  ['/live/home/', '直播广场', '直播 · 正在放映'],
  ['/live/', '直播间', '直播 · 播放中'],
  ['/video/release/', '草稿箱', '视频 · 未发布的草稿'],
  ['/video/draft/new/', '新建草稿', '视频 · 新建'],
  ['/video/draft/', '编辑草稿', '视频 · 草稿'],
  ['/video/secret/', '私密视频', '视频 · 仅受邀可见'],
  ['/video/search/', '视频搜索', '视频 · 搜索结果'],
  ['/video/home/', '视频库', '视频 · 全部作品'],
  ['/video/', '视频播放', '视频 · 播放中'],
  ['/home/history/', '观看历史', '我的 · 历史'],
  ['/home/later/', '稍后观看', '我的 · 稍后'],
  ['/home/favorites/', '我的收藏', '我的 · 收藏'],
  ['/home/friends/', '好友', '我的 · 好友'],
  ['/home/myself/', '个人主页', '我的 · 资料'],
  ['/home/mydata/', '个人信息', '我的 · 编辑资料'],
  ['/home/privacy/', '隐私设置', '我的 · 隐私'],
  ['/home/settings/', '应用设置', '设置 · 路径与传输'],
  ['/search/', '全局搜索', '搜索 · 全部内容']
];

function setTitleFor(path) {
  let title = '首页';
  let crumb = 'EasyVideo · 继续观看';
  for (const row of TITLES) {
    if (path.startsWith(row[0])) { title = row[1]; crumb = row[2]; break; }
  }
  const t = qs('#page-title');
  const c = qs('#page-crumb');
  if (t) t.textContent = title;
  if (c) c.textContent = crumb;
  document.title = title + ' · EasyVideo';
}

function whoChip() {
  const acc = state.account || {};
  const node = el('<button type="button" class="who" title="账号与切换">' +
    '<span class="who-text"><span class="who-name"></span><span class="who-sub"></span></span></button>');
  node.querySelector('.who-name').textContent = acc.nickname || '本机用户';
  node.querySelector('.who-sub').textContent = acc.guest ? '本机访客账号' : (acc.username || '已登录');
  node.insertBefore(avatarNode(acc, 'sm'), node.firstChild);
  node.addEventListener('click', openAccountSwitcher);
  return node;
}

export function buildTopbar() {
  const tools = qs('#topbar-tools');
  if (!tools) return;
  tools.innerHTML = '';
  const liveBtn = el('<button type="button" class="btn btn-ember-ghost btn-sm">' + icon('radio-tower') + '<span>开播</span></button>');
  liveBtn.addEventListener('click', () => navigate('/live/newlive/'));
  const upBtn = el('<button type="button" class="btn btn-ghost btn-sm">' + icon('cloud-upload') + '<span>发布视频</span></button>');
  upBtn.addEventListener('click', () => navigate('/video/draft/new/'));
  const accBtn = el('<button type="button" class="icon-btn" title="账号" aria-label="账号与切换">' + icon('panel-right') + '</button>');
  accBtn.addEventListener('click', openAccountSwitcher);
  tools.appendChild(liveBtn);
  tools.appendChild(upBtn);
  tools.appendChild(whoChip());
  tools.appendChild(accBtn);
}

/* -------------------------------------------------------- account switch */

export function openAccountSwitcher() {
  const body = el('<div class="stack"></div>');
  const list = el('<div class="menu-list"></div>');
  const accounts = state.accounts || [];
  if (!accounts.length) body.appendChild(el('<p class="dim">还没有账号，先添加一个。</p>'));
  for (const acc of accounts) {
    const current = !!(state.account && acc.id === state.account.id);
    const item = el('<button type="button" class="menu-item">' +
      '<span class="mi-text"><span class="mi-title"></span><span class="mi-sub mono"></span></span>' +
      '<span class="mi-arrow">' + icon(current ? 'circle-check' : 'chevron-right') + '</span></button>');
    if (current) item.classList.add('is-current');
    item.insertBefore(avatarNode(acc, 'sm'), item.firstChild);
    item.querySelector('.mi-title').textContent = acc.nickname || '账号';
    item.querySelector('.mi-sub').textContent = acc.guest ? '本机访客' : (acc.username || String(acc.id).slice(0, 12));
    item.addEventListener('click', async () => {
      if (current) { closeModal(); return; }
      try {
        await api.switchAccount(acc.id);
        closeModal();
        await bootstrap();
        buildTopbar();
        syncRailCounts();
        dispatch();
        toast('已切换账号', 'ok');
      } catch { /* the fetch helper already toasted */ }
    });
    list.appendChild(item);
  }
  body.appendChild(list);

  const addBtn = el('<button type="button" class="btn btn-ember-ghost btn-block">' + icon('user-plus') + '<span>添加账号</span></button>');
  addBtn.addEventListener('click', () => { closeModal(); openAddAccount(); });
  body.appendChild(addBtn);

  const loginBtn = el('<button type="button" class="btn btn-ghost btn-block">' + icon('log-out') + '<span>使用账号名登录</span></button>');
  loginBtn.addEventListener('click', () => { closeModal(); openLogin(); });
  body.appendChild(loginBtn);

  openModal({
    title: '账号',
    body,
    actions: [
      { label: '个人信息', kind: 'ghost', onClick: () => { closeModal(); navigate('/home/mydata/'); } },
      { label: '关闭', kind: 'ghost', onClick: closeModal }
    ]
  });
}

export function openAddAccount() {
  const form = el('<form class="stack" novalidate></form>');
  form.innerHTML =
    '<label class="field"><span class="field-label">昵称<b class="req">*</b></span><span class="field-control"><input class="input" name="nickname" required autocomplete="off"></span></label>' +
    '<label class="field"><span class="field-label">账号名</span><span class="field-control"><input class="input mono" name="username" autocomplete="off"></span><span class="field-hint">用于登录，留空自动生成</span></label>' +
    '<label class="field"><span class="field-label">密码</span><span class="field-control"><input class="input" type="password" name="password" autocomplete="new-password"></span></label>' +
    '<label class="field"><span class="field-label">性别</span><span class="field-control"><select class="select" name="gender"><option value="undisclosed">不透露</option><option value="male">男</option><option value="female">女</option></select></span></label>';
  openModal({
    title: '添加账号',
    body: form,
    actions: [
      { label: '取消', kind: 'ghost', onClick: closeModal },
      {
        label: '创建', kind: 'primary', onClick: async () => {
          const data = Object.fromEntries(new FormData(form));
          if (!data.nickname) { toast('请填写昵称', 'warn'); return; }
          try {
            await api.createAccount(data);
            closeModal();
            await bootstrap();
            buildTopbar();
            syncRailCounts();
            dispatch();
            toast('账号已创建', 'ok');
          } catch { /* toasted */ }
        }
      }
    ]
  });
  const first = form.querySelector('input[name=nickname]');
  if (first) first.focus();
}

function openLogin() {
  const form = el('<form class="stack" novalidate></form>');
  form.innerHTML =
    '<label class="field"><span class="field-label">账号名<b class="req">*</b></span><span class="field-control"><input class="input mono" name="username" autocomplete="username"></span></label>' +
    '<label class="field"><span class="field-label">密码<b class="req">*</b></span><span class="field-control"><input class="input" type="password" name="password" autocomplete="current-password"></span></label>';
  openModal({
    title: '账号登录',
    body: form,
    actions: [
      { label: '取消', kind: 'ghost', onClick: closeModal },
      {
        label: '登录', kind: 'primary', onClick: async () => {
          const data = Object.fromEntries(new FormData(form));
          if (!data.username || !data.password) { toast('请填写账号名与密码', 'warn'); return; }
          try {
            await api.login(data);
            closeModal();
            await bootstrap();
            buildTopbar();
            syncRailCounts();
            dispatch();
            toast('登录成功', 'ok');
          } catch { /* toasted */ }
        }
      }
    ]
  });
}

/* -------------------------------------------------------------- realtime */

/** One shared hub connection for the whole app; views subscribe to frames. */
export const realtime = new Realtime({});

/* ---------------------------------------------------------------- routes */

function register() {
  route('/discover/', () => renderDiscover());
route('/home/', () => renderHome());
  route('/home/history/', () => renderHistory());
  route('/home/later/', () => renderLater());
  route('/home/favorites/', () => renderFavorites());
  route('/home/friends/', () => renderFriends());
  route('/home/myself/', () => renderMyself());
  route('/home/mydata/', () => renderMyData());
  route('/home/privacy/', () => renderPrivacy());
  route('/home/settings/', () => renderSettings());

  route('/live/home/', () => renderLiveHome());
  route('/live/newlive/', () => renderNewLive());
  route('/live/secret/:nick/:pid/', (p) => renderWatchLive(p.nick, p.pid, true));
  route('/live/search/:term/', (p) => renderLiveSearch(p.term));
  route('/live/:nick/:pid/', (p) => renderWatchLive(p.nick, p.pid, false));

  route('/video/home/', () => renderVideoHome());
  route('/video/release/', () => renderRelease());
  route('/video/draft/new/', () => renderDraftNew());
  route('/video/draft/:name/', (p) => renderDraftEdit(p.name));
  route('/video/secret/:nick/:pid/', (p) => renderPlayer(p.nick, p.pid, true));
  route('/video/search/:term/', (p) => renderVideoSearch(p.term));
  route('/video/:nick/:pid/', (p) => renderPlayer(p.nick, p.pid, false));

  route('/search/:term/', (p) => renderGlobalSearch(p.term));
}

/* ------------------------------------------------------------------ boot */

async function boot() {
  buildRail();
  bindLinkDelegate();
  document.addEventListener('keydown', railKeyNav);

  const form = qs('#global-search');
  if (form) {
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const term = qs('#global-q').value.trim();
      if (!term) { toast('请输入搜索内容', 'warn'); return; }
      navigate('/search/' + encodeURIComponent(b64(term)) + '/');
    });
  }

  register();

  /* The sprite has to exist before the first view renders an icon, so it is
     awaited here. loadIcons never rejects: a missing icon degrades to text. */
  setBusy(1);
  try { await loadIcons(ICON_NAMES); } catch { /* degraded, not broken */ }

  try { await bootstrap(); }
  catch { toast('无法连接 EasyVideo 服务，请确认服务已启动', 'err'); }
  finally { setBusy(-1); }

  buildTopbar();
  syncRailCounts();

  subscribe(() => syncRailCounts());
  window.addEventListener('ev:counts', () => { refreshCounts(); });
  window.addEventListener('ev:topbar', () => buildTopbar());

  startRouter((current) => {
    syncRail(current);
    setTitleFor(current.path);
    const view = qs('#view');
    if (view) view.scrollTop = 0;
  });

  realtime.connect((state.account && state.account.nickname) || '本机用户', state.account ? state.account.id : null);
}

boot();

export { buildRail, syncRail, syncRailCounts, setTitleFor };
