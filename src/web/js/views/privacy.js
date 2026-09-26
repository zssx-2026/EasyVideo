/* EasyVideo - views/privacy.js
 * 隐私设置 + 设置主页公开信息。
 */
import { api } from '../api.js';
import {
  el, field, panel, switchControl, checkbox, toast
} from '../ui.js';
import { paint, viewHead, btn, errorState, loadingRows } from './kit.js';

const PUBLIC_FIELDS = [
  ['avatar', '头像'], ['nickname', '昵称'], ['fans', '粉丝数'], ['following', '关注数'],
  ['live', '直播'], ['favorites', '收藏'], ['history', '历史记录'], ['later', '稍后再看'],
  ['name', '姓名'], ['gender', '性别'], ['birthday', '生日'], ['preferences', '偏好']
];

const PRIVATE_SWITCHES = [
  ['uploadLogs', '不要上传日志到服务器', '关闭后本机日志只留在 data/ 目录里。'],
  ['analytics', '使用情况分析', '允许统计本机功能使用频率，用于改进体验。'],
  ['showOnline', '显示在线状态', '关闭后好友看不到你在线。'],
  ['allowFriendRequests', '允许好友申请', '关闭后只有已互为好友的人能联系你。'],
  ['allowStrangerMessages', '允许陌生人私信', '默认关闭。'],
  ['searchableByPid', '允许通过 PID 搜索到我', '关闭后只能通过昵称找到你的房间和视频。']
];

const PUBLIC_ITEMS = [
  ['live', '直播'], ['favorites', '收藏'], ['history', '历史记录'], ['later', '稍后再看']
];

export async function renderPrivacy() {
  const view = document.getElementById('view');
  if (view) paint(loadingRows(8));

  let data;
  try { data = await api.privacy(); }
  catch (err) { paint(errorState(err.message, renderPrivacy)); return; }

  const current = data.privacy || {};
  const draft = {
    uploadLogs: !!current.uploadLogs,
    analytics: !!current.analytics,
    showOnline: current.showOnline !== false,
    allowFriendRequests: current.allowFriendRequests !== false,
    allowStrangerMessages: !!current.allowStrangerMessages,
    searchableByPid: !!current.searchableByPid,
    publicProfile: Object.assign({}, current.publicProfile || {}),
    publicItems: Object.assign({}, current.publicItems || {})
  };

  const head = viewHead('隐私设置', '哪些内容能被别人看到，全部由你决定。', [
    btn('我的主页', 'ghost', 'user-round', () => { location.hash = '#/home/myself/'; })
  ]);

  const profile = panel('设置主页公开信息', { icon: 'eye', subtitle: '勾选后，这些内容会出现在你的公开主页上。' });
  const grid = el('<div class="form-grid"></div>');
  for (const pair of PUBLIC_FIELDS) {
    const node = checkbox(pair[1], draft.publicProfile[pair[0]] !== false, (checked) => {
      draft.publicProfile[pair[0]] = checked;
    }, { name: pair[0] });
    grid.appendChild(node);
  }
  profile.body.appendChild(grid);

  const items = panel('主页列表可见性', { icon: 'layers', subtitle: '列表类内容可以单独控制。' });
  const itemRow = el('<div class="form-grid"></div>');
  for (const pair of PUBLIC_ITEMS) {
    itemRow.appendChild(checkbox(pair[1], !!draft.publicItems[pair[0]], (checked) => {
      draft.publicItems[pair[0]] = checked;
    }, { name: pair[0] }));
  }
  items.body.appendChild(itemRow);

  const other = panel('其他隐私信息', { icon: 'shield' });
  const otherList = el('<div class="stack"></div>');
  for (const row of PRIVATE_SWITCHES) {
    const node = switchControl({
      label: row[1], checked: !!draft[row[0]], name: row[0],
      onChange: (checked) => { draft[row[0]] = checked; }
    });
    const box = el('<div class="stack-tight"></div>');
    box.appendChild(node);
    const hint = el('<span class="field-hint"></span>');
    hint.textContent = row[2];
    box.appendChild(hint);
    otherList.appendChild(box);
  }
  other.body.appendChild(otherList);

  const save = btn('保存隐私设置', 'primary', 'circle-check', async () => {
    save.disabled = true;
    try {
      await api.patchPrivacy(draft);
      toast('隐私设置已保存', 'ok');
    } catch (err) {
      toast('保存失败：' + err.message, 'err');
    } finally { save.disabled = false; }
  });

  const foot = el('<div class="row row-end"></div>');
  foot.appendChild(btn('返回', 'ghost', 'chevron-left', () => { location.hash = '#/home/myself/'; }));
  foot.appendChild(save);

  paint([head, profile, items, other, foot]);
}

export default { renderPrivacy };
