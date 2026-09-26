/* EasyVideo - views/myself.js
 * 个人主页：档案头 + 计数条 + 菜单列表（账号与数据都在这里）。
 */
import { api } from '../api.js';
import { state, bootstrap } from '../store.js';
import { navigate } from '../router.js';
import {
  el, panel, emptyState, openModal, closeModal, confirmDialog, toast,
  avatarNode, field, input, select, fmtBytes
} from '../ui.js';
import { paint, viewHead, btn, iconBtn, loadingRows, errorState } from './kit.js';

/** 账号数据变了：重建顶栏、刷新计数、重画当前页。 */
async function reload() {
  await bootstrap();
  window.dispatchEvent(new Event('ev:topbar'));
  window.dispatchEvent(new Event('ev:counts'));
  if (location.hash.indexOf('/home/myself') === 0) await renderMyself();
}

function menuItem(o) {
  const node = el('<button type="button" class="menu-item"><span class="mi-glyph"></span>'
    + '<span class="mi-text"><span class="mi-title"></span><span class="mi-sub mono"></span></span>'
    + '<span class="mi-arrow"></span></button>');
  node.querySelector('.mi-glyph').innerHTML = o.icon;
  node.querySelector('.mi-title').textContent = o.title;
  node.querySelector('.mi-sub').textContent = o.sub || '';
  node.querySelector('.mi-arrow').innerHTML = o.arrow || '';
  if (o.danger) node.classList.add('is-danger');
  node.addEventListener('click', o.onClick);
  return node;
}

/* --------------------------------------------------------------- 导出/导入 */

function exportSettings() {
  const url = api.exportSettingsUrl(true);
  const link = el('<a download="easyvideo-settings.json"></a>');
  link.href = url;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
  toast('设置文件已开始下载', 'ok');
}

function importSettings() {
  const form = el('<form class="stack" novalidate></form>');
  const file = input({ type: 'file', accept: '.json,application/json', name: 'payload' });
  form.appendChild(field('设置文件', file, { required: true, hint: '选择之前导出的 easyvideo-settings.json。' }));
  const merge = el('<label class="check"><input type="checkbox" class="check-input" checked>'
    + '<span class="check-mark"></span><span class="check-label">同时合并好友与收藏等社交数据</span></label>');
  form.appendChild(merge);

  openModal({
    title: '导入设置',
    body: form,
    initialFocus: 'input[type=file]',
    actions: [
      { label: '取消', kind: 'ghost', onClick: closeModal },
      {
        label: '导入', kind: 'primary', onClick: async function () {
          const picked = file.files && file.files[0];
          if (!picked) { toast('请先选择一个设置文件', 'warn'); return; }
          try {
            const text = await picked.text();
            let payload = null;
            try { payload = JSON.parse(text); } catch (err) { toast('文件不是有效的 JSON', 'err'); return; }
            await api.importSettings(payload, merge.querySelector('input').checked);
            closeModal();
            toast('设置已导入', 'ok');
            await reload();
          } catch (err) { /* api() 已经提示 */ }
        }
      }
    ]
  });
}

/* ------------------------------------------------------------- 账号相关弹窗 */

function addAccount(onDone) {
  const form = el('<form class="stack" novalidate></form>');
  form.appendChild(field('昵称', input({ name: 'nickname', autocomplete: 'off', required: 'required' }),
    { required: true, hint: '显示在直播与视频的作者位置。' }));
  form.appendChild(field('账号名', input({ name: 'username', class: 'input mono', autocomplete: 'off' }),
    { hint: '用于登录；留空由服务端自动生成。' }));
  form.appendChild(field('密码', input({ name: 'password', type: 'password', autocomplete: 'new-password' }),
    { hint: '留空则该账号只能在本机免密使用。' }));
  form.appendChild(field('性别', select([
    { value: 'undisclosed', label: '不透露' },
    { value: 'male', label: '男' },
    { value: 'female', label: '女' }
  ], { name: 'gender' })));

  openModal({
    title: '添加账号',
    body: form,
    initialFocus: 'input[name=nickname]',
    actions: [
      { label: '取消', kind: 'ghost', onClick: closeModal },
      {
        label: '创建', kind: 'primary', onClick: async function () {
          const data = Object.fromEntries(new FormData(form));
          if (!String(data.nickname || '').trim()) { toast('请填写昵称', 'warn'); return; }
          try {
            await api.createAccount(data);
            closeModal();
            toast('账号已创建并切换', 'ok');
            if (onDone) await onDone();
          } catch (err) { /* api() 已经提示 */ }
        }
      }
    ]
  });
}

async function switchAccount(onDone) {
  const body = el('<div class="stack"></div>');
  const list = el('<div class="menu-list"></div>');
  body.appendChild(list);
  openModal({ title: '账号切换', body: body, actions: [{ label: '关闭', kind: 'ghost', onClick: closeModal }] });

  try {
    const data = await api.accounts();
    const accounts = (data && data.accounts) || state.accounts || [];
    const current = (data && data.current) || (state.account && state.account.id);
    list.innerHTML = '';
    if (!accounts.length) {
      list.appendChild(el('<p class="dim">还没有账号，先添加一个。</p>'));
      return;
    }
    for (const acc of accounts) {
      const isCurrent = acc.id === current;
      const item = el('<button type="button" class="menu-item"><span class="mi-text">'
        + '<span class="mi-title"></span><span class="mi-sub mono"></span></span>'
        + '<span class="mi-arrow"></span></button>');
      item.insertBefore(avatarNode(acc, 'sm'), item.firstChild);
      item.querySelector('.mi-title').textContent = acc.nickname || '账号';
      item.querySelector('.mi-sub').textContent = acc.guest ? '本机访客' : (acc.username || String(acc.id).slice(0, 14));
      item.querySelector('.mi-arrow').innerHTML = isCurrent ? '<span class="chip chip-static chip-ok">当前</span>' : '';
      if (isCurrent) item.classList.add('is-current');
      item.addEventListener('click', async function () {
        if (isCurrent) { closeModal(); return; }
        try {
          await api.switchAccount(acc.id);
          closeModal();
          toast('已切换账号', 'ok');
          if (onDone) await onDone();
        } catch (err) { /* api() 已经提示 */ }
      });
      list.appendChild(item);
    }
  } catch (err) {
    list.innerHTML = '';
    list.appendChild(emptyState({ icon: 'triangle-alert', title: '无法读取账号列表', line: err && err.message ? err.message : '请稍后重试。' }));
  }
}

async function deleteAccount(acc, onDone) {
  const yes = await confirmDialog({
    title: '注销账号',
    text: '将永久删除“' + (acc.nickname || '当前账号') + '”及其隐私设置、导出配置。此操作不可撤销。',
    okLabel: '注销', danger: true
  });
  if (!yes) return;
  try {
    await api.deleteAccount(acc.id);
    toast('账号已注销', 'ok');
    if (onDone) await onDone();
  } catch (err) { /* api() 已经提示 */ }
}

/* ------------------------------------------------------------------ 页面 */

export async function renderMyself() {
  const head = viewHead('个人主页', '账号、资料与本地数据都从这里进入');

  const shell = panel('我的账号', { icon: 'user-round' });
  shell.body.appendChild(loadingRows(3));
  paint([head, shell]);

  try {
    const data = await api.me();
    const account = (data && data.account) || state.account || {};
    const counters = (data && data.counters) || {};

    shell.body.innerHTML = '';
    shell.body.appendChild(profileHead(account, counters));
    shell.body.appendChild(counterStrip(counters));
    shell.body.appendChild(menuList(account));
  } catch (err) {
    shell.body.innerHTML = '';
    shell.body.appendChild(errorState(err && err.message, renderMyself));
  }
}

function profileHead(account, counters) {
  const node = el('<div class="profile-head"></div>');
  const open = function () { navigate('/home/mydata/'); };
  node.tabIndex = 0;
  node.setAttribute('role', 'button');
  node.title = '编辑个人信息';

  const avatar = avatarNode(account, 'lg');
  avatar.addEventListener('click', open);
  node.appendChild(avatar);

  const text = el('<div class="ph-text"><h2></h2><p class="ph-sub"></p></div>');
  text.querySelector('h2').textContent = account.nickname || '本机用户';
  text.querySelector('.ph-sub').textContent = account.guest
    ? '本机访客账号 · 点击编辑资料'
    : (account.username || '已登录') + ' · 点击编辑资料';
  text.addEventListener('click', open);
  node.appendChild(text);

  const actions = el('<div class="ph-actions"></div>');
  actions.appendChild(btn('编辑资料', 'primary', 'pencil', open));
  actions.appendChild(btn('隐私设置', 'ghost', 'shield', function () { navigate('/home/privacy/'); }));
  node.appendChild(actions);

  node.addEventListener('keydown', function (ev) {
    if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); open(); }
  });
  return node;
}

function counterStrip(counters) {
  const strip = el('<div class="stat-counters"></div>');
  const rows = [
    ['粉丝数', counters.fans, true],
    ['视频数', counters.videos, false],
    ['直播数', counters.lives, false],
    ['关注数', counters.following, false]
  ];
  for (const row of rows) {
    const node = el('<div class="counter"><span class="c-v mono"></span><span class="c-k"></span></div>');
    if (row[2]) node.classList.add('is-ember');
    node.querySelector('.c-v').textContent = String(Number(row[1]) || 0);
    node.querySelector('.c-k').textContent = row[0];
    strip.appendChild(node);
  }
  return strip;
}

function menuList(account) {
  const list = el('<div class="menu-list"></div>');

  list.appendChild(menuItem({
    icon: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><use href="#ic-user-round"></use></svg>',
    title: '个人信息', sub: '昵称 · 姓名 · 生日 · 偏好',
    arrow: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><use href="#ic-chevron-right"></use></svg>',
    onClick: function () { navigate('/home/mydata/'); }
  }));

  list.appendChild(menuItem({
    icon: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><use href="#ic-shield"></use></svg>',
    title: '隐私设置', sub: '主页公开信息 · 日志 · 在线状态',
    arrow: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><use href="#ic-chevron-right"></use></svg>',
    onClick: function () { navigate('/home/privacy/'); }
  }));

  list.appendChild(menuItem({
    icon: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><use href="#ic-download"></use></svg>',
    title: '导出设置', sub: 'settings.json（含本机排序模型）',
    arrow: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><use href="#ic-download"></use></svg>',
    onClick: exportSettings
  }));

  list.appendChild(menuItem({
    icon: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><use href="#ic-upload"></use></svg>',
    title: '导入设置', sub: '从 JSON 文件恢复配置',
    arrow: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><use href="#ic-upload"></use></svg>',
    onClick: importSettings
  }));

  list.appendChild(menuItem({
    icon: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><use href="#ic-user-plus"></use></svg>',
    title: '添加账号', sub: '在本机新建一个账号并切换过去',
    arrow: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><use href="#ic-plus"></use></svg>',
    onClick: function () { addAccount(reload); }
  }));

  list.appendChild(menuItem({
    icon: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><use href="#ic-repeat"></use></svg>',
    title: '账号切换', sub: '在已保存的账号之间切换',
    arrow: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><use href="#ic-chevron-right"></use></svg>',
    onClick: function () { switchAccount(reload); }
  }));

  list.appendChild(menuItem({
    icon: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><use href="#ic-log-out"></use></svg>',
    title: '注销账号', sub: '永久删除当前账号与本机数据',
    arrow: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><use href="#ic-chevron-right"></use></svg>',
    danger: true,
    onClick: function () { deleteAccount(account, reload); }
  }));

  return list;
}
