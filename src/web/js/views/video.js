/* EasyVideo - views/video.js
 * 视频库与视频搜索：16:9 卡片 + 时长角标 + 合集/私密筛选。
 */
import { api } from '../api.js';
import { navigate } from '../router.js';
import {
  el, icon, input, chip, toast, emptyState, b64, unb64
} from '../ui.js';
import { paint, viewHead, btn, loadingCards, errorState, videoGrid } from './kit.js';

const FILTERS = [['all', '全部'], ['collection', '合集'], ['secret', '私密']];

function applyFilter(items, filter) {
  if (filter === 'collection') return items.filter((card) => card.collection);
  if (filter === 'secret') return items.filter((card) => card.secret);
  return items;
}

function toolbar(term, onSearch, extra) {
  const box = el('<div class="row"></div>');
  const search = input({ type: 'search', value: term || '', placeholder: '搜索视频标题、简介或作者' });
  const submit = () => onSearch(search.value.trim());
  search.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); submit(); } });
  box.appendChild(search);
  box.appendChild(btn('搜索', 'ember-ghost', 'search', submit));
  for (const node of extra || []) box.appendChild(node);
  return box;
}

function learn(kind, query, card) {
  if (card && card.id) api.feedback({ kind: kind, query: query, docId: card.id, label: 1 }).catch(function () {});
}

export async function renderVideoHome() {
  paint(loadingCards(6));
  let items = [];
  try { const r = await api.videos(); items = r.items || []; }
  catch (err) { paint(errorState(err.message, renderVideoHome)); return; }

  const viewState = { filter: 'all' };
  const list = el('<div class="stack"></div>');

  const draw = () => {
    list.innerHTML = '';
    const rows = applyFilter(items, viewState.filter);
    if (!rows.length) {
      list.appendChild(emptyState({
        icon: 'clapperboard',
        title: '还没有视频',
        line: '发布第一个视频，或者把草稿发布出来。',
        action: '发布视频',
        actionIcon: 'cloud-upload',
        onAction: () => navigate('/video/release/')
      }));
      return;
    }
    const grid = videoGrid(rows, { limit: 30 });
    grid.addEventListener('click', (ev) => {
      const card = ev.target.closest('.video-card');
      if (!card) return;
      const index = Array.prototype.indexOf.call(grid.children, card);
      learn('video', '', rows[index]);
    }, true);
    list.appendChild(grid);
  };

  const filters = el('<div class="chip-row"></div>');
  for (const pair of FILTERS) {
    const node = chip(pair[1], {
      tone: viewState.filter === pair[0] ? 'ok' : null,
      onClick: () => {
        viewState.filter = pair[0];
        for (const other of filters.querySelectorAll('.chip')) other.classList.remove('chip-ok');
        node.classList.add('chip-ok');
        draw();
      }
    });
    filters.appendChild(node);
  }

  const head = viewHead('视频库', '本机发布与收藏的视频。', [
    btn('发布视频', 'primary', 'cloud-upload', () => navigate('/video/release/'))
  ]);
  paint([
    head,
    toolbar('', (term) => { if (term) navigate('/video/search/' + encodeURIComponent(b64(term)) + '/'); }),
    filters,
    list
  ]);
  draw();
}

export async function renderVideoSearch(term) {
  const query = unb64(term);
  paint(loadingCards(4));
  let items = [];
  try { const r = await api.search('video', query); items = r.items || []; }
  catch (err) { paint(errorState(err.message, () => renderVideoSearch(term))); return; }

  const head = viewHead('视频搜索', query ? ('关键词：' + query) : '请输入关键词', [
    btn('返回视频库', 'ghost', 'chevron-left', () => navigate('/video/home/'))
  ]);

  if (!items.length) {
    paint([head, emptyState({
      icon: 'search', title: '没有匹配的视频',
      line: '换个关键词试试，或者到视频库浏览全部内容。',
      action: '视频库', actionIcon: 'clapperboard', onAction: () => navigate('/video/home/')
    })]);
    return;
  }

  const grid = videoGrid(items, { limit: 40 });
  grid.addEventListener('click', (ev) => {
    const card = ev.target.closest('.video-card');
    if (!card) return;
    const index = Array.prototype.indexOf.call(grid.children, card);
    learn('video', query, items[index]);
  }, true);

  paint([head, grid]);
}

export default { renderVideoHome, renderVideoSearch };
