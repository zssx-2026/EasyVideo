/* EasyVideo - views/friends.js
 * 好友：一行一张好友卡，加好友走模态框（refId + kind）。
 */
import { api } from '../api.js';
import { navigate } from '../router.js';
import {
  el, panel, emptyState, openModal, closeModal, confirmDialog, toast,
  avatarNode, field, input, select, b64, fmtAgo
} from '../ui.js';
import { paint, viewHead, btn, iconBtn, loadingRows, errorState } from './kit.js';

const KIND_LABEL = { live: '直播', video: '视频' };

function friendName(row) {
  return row.nickname || row.author || row.title || row.refId || '好友';
}

function friendSub(row) {
  const kind = KIND_LABEL[row.kind] || '好友';
  const parts = [kind];
  if (row.refId) parts.push('ID ' + row.refId);
  if (row.createdAt || row.at) parts.push(fmtAgo(row.createdAt || row.at));
  return parts.join(' · ');
}

/** 优先走真实路由；只有 refId 时退回到搜索路由。 */
function openFriend(row) {
  if (row.author && row.pid) {
    const base = row.kind === 'live' ? '/live/' : '/video/';
    navigate(base + encodeURIComponent(row.author) + '/' + encodeURIComponent(row.pid) + '/');
    return;
  }
  const ref = row.refId || row.pid || '';
  if (!ref) { toast('这条好友记录没有可打开的目标', 'warn'); return; }
  const base = row.kind === 'live' ? '/live/search/' : '/video/search/';
  navigate(base + encodeURIComponent(b64(ref)) + '/');
}

function addFriendModal(onDone) {
  const form = el('<form class="stack" novalidate></form>');
  form.appendChild(field('好友 ID（PID 或昵称）', input({
    name: 'refId', placeholder: '例如 3f9a1c', autocomplete: 'off', required: 'required'
  }), { required: true, hint: '填写对方的 PID 或昵称，便于在搜索结果里定位。' }));
  form.appendChild(field('内容类型', select([
    { value: 'live', label: '直播' },
    { value: 'video', label: '视频' }
  ], { name: 'kind' }), { hint: '决定“观看直播 / 查看视频”按钮打开的页面。' }));

  openModal({
    title: '添加好友',
    body: form,
    initialFocus: 'input[name=refId]',
    actions: [
      { label: '取消', kind: 'ghost', onClick: closeModal },
      {
        label: '添加', kind: 'primary', onClick: async function () {
          const data = Object.fromEntries(new FormData(form));
          const refId = String(data.refId || '').trim();
          if (!refId) { toast('请填写好友 ID', 'warn'); return; }
          try {
            await api.addItem('friends', { refId: refId, kind: data.kind === 'video' ? 'video' : 'live' });
            closeModal();
            toast('好友已添加', 'ok');
            window.dispatchEvent(new Event('ev:counts'));
            if (onDone) await onDone();
          } catch (err) { /* api() 已经提示 */ }
        }
      }
    ]
  });
}

export async function renderFriends() {
  const head = viewHead('好友', '一起看直播、互相推荐视频', [
    btn('添加好友', 'ember-ghost', 'user-plus', function () { addFriendModal(refresh); })
  ]);

  const shell = panel('好友列表', { icon: 'users', subtitle: '好友申请是否可见由隐私设置决定' });
  shell.body.appendChild(loadingRows(4));
  paint([head, shell]);

  async function refresh() {
    try {
      const data = await api.friends();
      const items = (data && data.items) || [];
      shell.body.innerHTML = '';
      if (!items.length) {
        shell.body.appendChild(emptyState({
          icon: 'users', title: '还没有好友',
          line: '加上第一位好友，就能互相看到对方正在放映的直播。',
          action: '添加好友', actionIcon: 'user-plus',
          onAction: function () { addFriendModal(refresh); },
          secondary: '去直播广场', secondaryIcon: 'radio-tower',
          onSecondary: function () { navigate('/live/home/'); }
        }));
        return;
      }
      const grid = el('<div class="grid-auto"></div>');
      for (const row of items) {
        grid.appendChild(friendCard(row, refresh));
      }
      shell.body.appendChild(grid);
    } catch (err) {
      shell.body.innerHTML = '';
      shell.body.appendChild(errorState(err && err.message, refresh));
    }
  }

  await refresh();
}

function friendCard(row, refresh) {
  const node = el('<div class="friend-card"></div>');
  node.appendChild(avatarNode({ nickname: friendName(row), avatar: row.avatar }, 'md'));

  const main = el('<div class="fc-main"><p class="fc-name"></p><p class="fc-sub mono"></p></div>');
  main.querySelector('.fc-name').textContent = friendName(row);
  main.querySelector('.fc-sub').textContent = friendSub(row);
  node.appendChild(main);

  const actions = el('<div class="row-tools"></div>');
  const kind = row.kind === 'video' ? 'video' : 'live';
  actions.appendChild(btn(kind === 'live' ? '观看直播' : '查看视频', 'ghost',
    kind === 'live' ? 'radio-tower' : 'clapperboard', function () { openFriend(row); }));
  actions.appendChild(iconBtn('trash-2', '移除好友', 'danger', async function () {
    const yes = await confirmDialog({
      title: '移除好友', text: '将“' + friendName(row) + '”从好友列表中移除？', okLabel: '移除', danger: true
    });
    if (!yes) return;
    try {
      await api.removeItem('friends', row.id);
      toast('已移除好友', 'ok');
      window.dispatchEvent(new Event('ev:counts'));
      await refresh();
    } catch (err) { /* api() 已经提示 */ }
  }));
  node.appendChild(actions);
  return node;
}
