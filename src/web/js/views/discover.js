/* EasyVideo - views/discover.js
 *
 * 推荐流 + 插件面板。
 *
 * 推荐按 prompt.txt 的算法：服务端对每个用户维护 标签->权重 的画像，
 * 把候选内容的标签权重求和成概率后加权随机抽样，所以每次刷新顺序都变。
 * 这里只负责展示、刷新，以及把“看过/点赞/收藏”回灌给画像。
 */
import { api } from '../api.js';
import { navigate } from '../router.js';
import { el, toast, chip, tagChip, panel, stat, emptyState, confirmDialog } from '../ui.js';
import { paint, viewHead, btn, iconBtn, errorState, loadingCards, sectionHead, liveGrid, videoGrid, tel } from './kit.js';

const KINDS = [['video', '视频'], ['live', '直播']];

/** 把一次“打开内容”回灌给画像，权重越大越能改变推荐。 */
export function remember(card, weight) {
  if (!card) return;
  api.learn(card, weight == null ? 1 : weight).catch(function () {});
  if (card.id) api.react(card.id, 'views', 1).catch(function () {});
}

export async function renderDiscover() {
  paint(loadingCards(6));
  const view = { kind: 'video', items: [], profile: null, stats: null };

  let pluginsInfo = null;
  try { pluginsInfo = await api.plugins(); } catch (err) { pluginsInfo = null; }

  const head = viewHead('推荐', '按你的标签权重随机推荐，刷新一次顺序就会变。', [
    btn('换一批', 'primary', 'refresh-cw', function () { load(true); }),
    btn('直播广场', 'ghost', 'radio-tower', function () { navigate('/live/home/'); })
  ]);

  const toolbar = el('<div class="chip-row"></div>');
  for (const pair of KINDS) {
    const node = chip(pair[1], { onClick: function () { view.kind = pair[0]; syncChips(); load(true); } });
    node.dataset.kind = pair[0];
    toolbar.appendChild(node);
  }

  const profilePanel = panel('你的口味画像', { icon: 'sparkles', subtitle: '权重来自你看过、点赞、收藏和搜索点击的内容。' });
  const profileStrip = el('<div class="telemetry-strip"></div>');
  profilePanel.body.appendChild(profileStrip);
  const tagRow = el('<div class="chip-row"></div>');
  profilePanel.body.appendChild(tagRow);
  profilePanel.actions.appendChild(btn('清空画像', 'ghost', 'trash-2', async function () {
    const ok = await confirmDialog({ title: '清空口味画像', text: '清空后推荐会退回随机，随后重新学习。', okLabel: '清空', danger: true });
    if (!ok) return;
    try { await api.forgetTaste(); toast('画像已清空', 'ok'); load(true); }
    catch (err) { toast('操作失败：' + err.message, 'err'); }
  }));

  const shell = panel('为你挑选', { icon: 'sparkles' });
  shell.body.appendChild(loadingCards(4));

  const pluginPanel = panel('插件', { icon: 'sparkles', subtitle: '把 .evp（zstd 打包的 JSON）放进 program/plugins/ 即可扩展。' });
  const pluginList = el('<div class="stack-tight"></div>');
  pluginPanel.body.appendChild(pluginList);

  paint([head, toolbar, profilePanel, shell, pluginPanel]);

  function syncChips() {
    for (const node of toolbar.children) node.classList.toggle('chip-ok', node.dataset.kind === view.kind);
  }

  function drawProfile(profile, stats) {
    profileStrip.innerHTML = '';
    tagRow.innerHTML = '';
    const tags = (profile && profile.tags) || [];
    profileStrip.appendChild(tel('TAGS', tags.length));
    profileStrip.appendChild(tel('SAMPLES', (stats && stats.comments) || 0));
    profileStrip.appendChild(tel('REACTIONS', (stats && stats.reactions) || 0));
    if (!tags.length) {
      const hint = el('<p class="dim"></p>');
      hint.textContent = '还没有足够的行为，先随便看看，画像会自动长出来。';
      tagRow.appendChild(hint);
      return;
    }
    const top = tags[0] ? tags[0].weight : 1;
    for (const row of tags.slice(0, 18)) {
      tagRow.appendChild(tagChip(row.tag + ' · ' + row.weight.toFixed(1), row.weight >= top * 0.6 ? 'ok' : 'mono'));
    }
  }

  function drawPlugins(info) {
    pluginList.innerHTML = '';
    if (!info) {
      pluginList.appendChild(emptyState({ icon: 'sparkles', title: '插件接口不可用', line: '重新启动应用后再试。' }));
      return;
    }
    const stats2 = info.stats || {};
    const strip = el('<div class="stat-row"></div>');
    strip.appendChild(stat('已加载', String(stats2.count || 0)));
    strip.appendChild(stat('正常', String(stats2.ok || 0)));
    strip.appendChild(stat('失败', String(stats2.failed || 0)));
    strip.appendChild(stat('路由', String(stats2.routes || 0)));
    strip.appendChild(stat('面板', String(stats2.panels || 0)));
    pluginList.appendChild(strip);
    const zline = el('<p class="dim mono"></p>');
    zline.textContent = 'ZSTD ' + (stats2.zstd ? '可用' : '不可用') + ' · ' + ((stats2.dirs || []).join('  '));
    pluginList.appendChild(zline);
    const items = info.items || [];
    if (!items.length) {
      const hint = el('<p class="dim"></p>');
      hint.textContent = '还没有安装任何插件。';
      pluginList.appendChild(hint);
      return;
    }
    for (const p of items) {
      const row = el('<div class="history-row"><span class="h-when mono"></span><div class="h-main"><p class="h-title"></p><p class="h-sub"></p></div><div class="row-tools"></div></div>');
      row.querySelector('.h-when').textContent = p.version || '—';
      row.querySelector('.h-title').textContent = p.name + (p.ok ? '' : '（加载失败）');
      row.querySelector('.h-sub').textContent = (p.description || p.kind || '') + (p.error ? ' · ' + p.error : '');
      row.querySelector('.row-tools').appendChild(iconBtn('trash-2', '删除插件', 'danger', async function () {
        const ok = await confirmDialog({ title: '删除插件', text: '删除 ' + p.name + '？', okLabel: '删除', danger: true });
        if (!ok) return;
        try { await api.deletePlugin(p.name); toast('已删除，重启后生效', 'ok'); load(false); }
        catch (err) { toast('删除失败：' + err.message, 'err'); }
      }));
      pluginList.appendChild(row);
    }
  }

  async function load(force) {
    shell.body.innerHTML = '';
    shell.body.appendChild(loadingCards(view.kind === 'live' ? 3 : 6));
    try {
      const r = await api.recommend(view.kind, 24);
      view.items = r.items || [];
      view.profile = r.profile || null;
      drawProfile(view.profile, view.stats);
      shell.body.innerHTML = '';
      if (!view.items.length) {
        shell.body.appendChild(emptyState({
          icon: view.kind === 'live' ? 'radio-tower' : 'clapperboard',
          title: view.kind === 'live' ? '现在没有直播' : '还没有视频',
          line: '先去发布内容，推荐才会有素材。',
          action: view.kind === 'live' ? '新建直播房间' : '发布视频',
          actionIcon: 'plus',
          onAction: function () { navigate(view.kind === 'live' ? '/live/newlive/' : '/video/release/'); }
        }));
        return;
      }
      const grid = view.kind === 'live' ? liveGrid(view.items, { featured: true, limit: 24 }) : videoGrid(view.items, { limit: 24 });
      grid.addEventListener('click', function (ev) {
        const selector = view.kind === 'live' ? '.live-card' : '.video-card';
        const card = ev.target.closest(selector);
        if (!card) return;
        const index = Array.prototype.indexOf.call(grid.children, card);
        remember(view.items[index], 3);
      }, true);
      shell.body.appendChild(grid);
      if (force) toast('已换一批', 'ok');
    } catch (err) {
      shell.body.innerHTML = '';
      shell.body.appendChild(errorState(err.message, function () { load(false); }));
    }
  }

  syncChips();
  drawProfile(null, null);
  drawPlugins(pluginsInfo);
  try { view.stats = await api.socialStats(); } catch (err) { view.stats = null; }
  load(false);
}

export default { renderDiscover, remember };
