/* EasyVideo - views/library.js
 * 首页、历史记录、稍后再看、收藏、全局搜索。
 */
import { api } from '../api.js';
import { readResume } from '../store.js';
import { navigate } from '../router.js';
import { el, toast, emptyState, confirmDialog, unb64 } from '../ui.js';
import {
  paint, viewHead, btn, iconBtn, errorState, loadingCards, loadingRows,
  sectionHead, liveGrid, videoGrid, historyRow, tel
} from './kit.js';

/* --------------------------------------------------------------- 首页 */

function resumeRow(entry) {
  const live = entry.kind === 'live';
  const node = el('<div class="history-row" role="button" tabindex="0">' +
    '<span class="h-when mono"></span>' +
    '<div class="h-main"><p class="h-title"></p><p class="h-sub"></p></div>' +
    '<div class="row-tools"></div></div>');
  node.querySelector('.h-when').textContent = live ? '直播' : '视频';
  node.querySelector('.h-title').textContent = entry.title || '未命名';
  node.querySelector('.h-sub').textContent = entry.author || '继续观看';
  const open = () => {
    const base = live ? '/live/' : '/video/';
    navigate(base + encodeURIComponent(entry.author || '') + '/' + encodeURIComponent(entry.pid || '') + '/');
  };
  node.addEventListener('click', open);
  node.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); open(); } });
  return node;
}

export async function renderHome() {
  paint(loadingCards(4));
  const resume = readResume();
  let live = [];
  let videos = [];
  try { const r = await api.live(); live = (r.items || []).slice(0, 6); } catch (err) { live = []; }
  try { const r = await api.videos(); videos = (r.items || []).slice(0, 8); } catch (err) { videos = []; }

  const head = viewHead('首页', '继续观看、正在直播与最新视频。', [
    btn('开播', 'primary', 'radio-tower', () => navigate('/live/newlive/')),
    btn('发布视频', 'ghost', 'cloud-upload', () => navigate('/video/draft/new/'))
  ]);

  const blocks = [head];

  const resumePanel = el('<section class="panel panel-flush"></section>');
  resumePanel.appendChild(sectionHead('继续观看', { note: resume.length ? '从上次停下的地方继续' : '' }));
  if (resume.length) {
    const list = el('<div class="stack-tight"></div>');
    for (const entry of resume.slice(0, 6)) list.appendChild(resumeRow(entry));
    resumePanel.appendChild(list);
  } else {
    resumePanel.appendChild(emptyState({
      icon: 'play', title: '还没有观看记录',
      line: '打开任意一个直播间或视频，这里就会记住进度。',
      action: '去直播广场', actionIcon: 'radio-tower',
      onAction: () => navigate('/live/home/')
    }));
  }
  blocks.push(resumePanel);

  const livePanel = el('<section class="panel panel-flush"></section>');
  livePanel.appendChild(sectionHead('正在直播', {
    note: live.length + ' 个房间',
    tools: [btn('全部直播', 'ghost', 'chevron-right', () => navigate('/live/home/'))]
  }));
  if (live.length) livePanel.appendChild(liveGrid(live, { featured: true, limit: 6 }));
  else livePanel.appendChild(emptyState({
    icon: 'radio-tower', title: '现在没有直播',
    line: '你可以成为第一个开播的人。',
    action: '新建直播房间', actionIcon: 'plus',
    onAction: () => navigate('/live/newlive/')
  }));
  blocks.push(livePanel);

  const videoPanel = el('<section class="panel panel-flush"></section>');
  videoPanel.appendChild(sectionHead('最新视频', {
    note: videos.length + ' 个作品',
    tools: [btn('全部视频', 'ghost', 'chevron-right', () => navigate('/video/home/'))]
  }));
  if (videos.length) videoPanel.appendChild(videoGrid(videos, { limit: 8 }));
  else videoPanel.appendChild(emptyState({
    icon: 'clapperboard', title: '还没有视频',
    line: '发布一个视频，它会出现在这里。',
    action: '发布视频', actionIcon: 'cloud-upload',
    onAction: () => navigate('/video/release/')
  }));
  blocks.push(videoPanel);

  paint(blocks);
}

/* ------------------------------------------------- 历史 / 稍后 / 收藏 */

const LIBRARY = {
  history: { title: '观看历史', sub: '最近看过的直播和视频。', kind: 'history', icon: 'history' },
  later: { title: '稍后观看', sub: '留到有空再看。', kind: 'later', icon: 'bookmark' },
  favorites: { title: '我的收藏', sub: '你标记过的内容。', kind: 'favorites', icon: 'star' }
};

function libraryView(which) {
  const meta = LIBRARY[which];
  return async function render() {
    paint(loadingRows(5));
    let items = [];
    try {
      const r = await api[meta.kind]();
      items = r.items || [];
    } catch (err) { paint(errorState(err.message, () => render())); return; }

    const head = viewHead(meta.title, meta.sub, [
      btn('返回首页', 'ghost', 'house', () => navigate('/home/'))
    ]);

    if (!items.length) {
      paint([head, emptyState({
        icon: meta.icon,
        title: '这里还是空的',
        line: '看过或收藏的内容会自动出现在这里。',
        action: '去直播广场', actionIcon: 'radio-tower',
        onAction: () => navigate('/live/home/')
      })]);
      return;
    }

    const list = el('<div class="panel panel-flush"></div>');
    const clear = btn('清空', 'ghost', 'trash-2', async () => {
      const ok = await confirmDialog({
        title: '清空' + meta.title, text: '这一操作会移除全部记录，无法恢复。',
        okLabel: '清空', danger: true
      });
      if (!ok) return;
      try { await api.clearItems(meta.kind); toast('已清空', 'ok'); render(); }
      catch (err) { toast('清空失败：' + err.message, 'err'); }
    });
    list.appendChild(sectionHead(meta.title, { note: items.length + ' 条', tools: [clear] }));
    for (const row of items) {
      const del = iconBtn('trash-2', '移除', '', async () => {
        try {
          await api.removeItem(meta.kind, row.id);
          toast('已移除', 'ok');
          render();
        } catch (err) { toast('移除失败：' + err.message, 'err'); }
      });
      list.appendChild(historyRow(row, { tools: [del] }));
    }
    paint([head, list]);
  };
}

export const renderHistory = libraryView('history');
export const renderLater = libraryView('later');
export const renderFavorites = libraryView('favorites');

/* ----------------------------------------------------------- 全局搜索 */

export async function renderGlobalSearch(params) {
  const raw = params && params.term ? params.term : '';
  const term = unb64(raw);
  const head = viewHead('全局搜索', term ? ('关键词：' + term) : '请输入关键词', [
    btn('返回首页', 'ghost', 'house', () => navigate('/home/'))
  ]);

  if (!term) {
    paint([head, emptyState({
      icon: 'search', title: '想找什么？',
      line: '在上方输入关键词，可以同时搜索直播和视频。',
      action: '直播广场', actionIcon: 'radio-tower',
      onAction: () => navigate('/live/home/')
    })]);
    return;
  }

  paint(loadingCards(4));
  let live = [];
  let videos = [];
  try {
    const results = await Promise.all([
      api.search('live', term).catch(() => ({ items: [] })),
      api.search('video', term).catch(() => ({ items: [] }))
    ]);
    live = results[0].items || [];
    videos = results[1].items || [];
  } catch (err) { /* both branches already caught */ }

  const blocks = [head];
  const total = live.length + videos.length;
  const summary = el('<div class="telemetry-strip"></div>');
  summary.appendChild(tel('LIVE', live.length));
  summary.appendChild(tel('VIDEO', videos.length));
  summary.appendChild(tel('TOTAL', total));
  blocks.push(summary);

  if (!total) {
    blocks.push(emptyState({
      icon: 'search', title: '没有找到相关内容',
      line: '换个关键词试试，或者到直播广场逛逛。',
      action: '直播广场', actionIcon: 'radio-tower',
      onAction: () => navigate('/live/home/')
    }));
    paint(blocks);
    return;
  }

  const split = el('<div class="split-2"></div>');
  if (live.length) {
    const box = el('<section class="panel panel-flush"></section>');
    box.appendChild(sectionHead('直播', { note: live.length + ' 个结果' }));
    const grid = liveGrid(live, { featured: false, limit: 12 });
    grid.addEventListener('click', (ev) => {
      const card = ev.target.closest('.live-card');
      if (!card) return;
      const index = Array.prototype.indexOf.call(grid.children, card);
      const hit = live[index];
      if (hit && hit.id) api.feedback({ kind: 'live', query: term, docId: hit.id, label: 1 }).catch(() => {});
    }, true);
    box.appendChild(grid);
    split.appendChild(box);
  }
  if (videos.length) {
    const box = el('<section class="panel panel-flush"></section>');
    box.appendChild(sectionHead('视频', { note: videos.length + ' 个结果' }));
    const grid = videoGrid(videos, { limit: 12 });
    grid.addEventListener('click', (ev) => {
      const card = ev.target.closest('.video-card');
      if (!card) return;
      const index = Array.prototype.indexOf.call(grid.children, card);
      const hit = videos[index];
      if (hit && hit.id) api.feedback({ kind: 'video', query: term, docId: hit.id, label: 1 }).catch(() => {});
    }, true);
    box.appendChild(grid);
    split.appendChild(box);
  }
  blocks.push(split);
  paint(blocks);
}

export default { renderHome, renderHistory, renderLater, renderFavorites, renderGlobalSearch };
