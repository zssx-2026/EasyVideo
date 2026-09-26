/* EasyVideo - GitHub 登录与上传面板。
 *
 * 每个用户用自己的 GitHub 账户登录。Token 只提交一次，服务端保管，界面上
 * 没有任何显示明文的入口，也不回显输入框内容。
 *
 * 身份校验按需求：登录时拉一次仓库列表，之后随时可以再拉一次比对。
 * 上传走 Release 资产，单文件上限 2 GiB。
 */
import { api } from '../api.js';
import { el, field, input, panel, toast, confirmDialog, fmtAgo, stat } from '../ui.js';
import { btn } from './kit.js';

/** 用户 ID 太长，只露头尾。 */
function shortId(id) {
  const s = String(id || '');
  if (s.length <= 16) return s || '—';
  return s.slice(0, 8) + '…' + s.slice(-8);
}

/** 未登录时的表单。 */
function signInForm(refresh) {
  const box = el('<div class="stack"></div>');
  const note = el('<p class="dim"></p>');
  note.textContent = '用你自己的 GitHub 账户登录。Token 只提交一次，之后由服务端保管，界面上不会显示明文。';
  box.appendChild(note);
  const token = input({ type: 'password', placeholder: 'ghp_... 或 github_pat_...', autocomplete: 'off', spellcheck: 'false' });
  token.setAttribute('aria-label', 'GitHub Token');
  box.appendChild(field('GitHub Token', token, { required: true, hint: '需要 repo 权限' }));
  const row = el('<div class="row"></div>');
  const go = btn('登录 GitHub', 'primary', 'log-in', async function () {
    const value = token.value.trim();
    if (!value) { toast('请先填写 Token', 'warn'); return; }
    go.disabled = true;
    try {
      const r = await api.githubSignIn(value);
      token.value = '';
      toast('已登录：' + ((r.identity && r.identity.login) || 'GitHub'), 'ok');
      if (refresh) refresh();
    } catch (err) { toast('登录失败：' + err.message, 'err'); }
    finally { go.disabled = false; }
  });
  row.appendChild(go);
  row.appendChild(btn('获取 Token', 'ghost', 'external-link', function () {
    window.open('https://github.com/settings/tokens/new?scopes=repo,workflow,gist,read:org&description=EasyVideo', '_blank', 'noopener');
  }));
  box.appendChild(row);
  return box;
}

/** 已登录时的概览。 */
function identityView(data, refresh) {
  const box = el('<div class="stack"></div>');
  const me = data.current || {};
  const head = el('<div class="row row-between"></div>');
  const label = el('<div class="stack-tight"></div>');
  const name = el('<b></b>');
  name.textContent = me.login || 'GitHub';
  const sub = el('<span class="dim mono"></span>');
  sub.textContent = me.repo || '';
  label.appendChild(name);
  label.appendChild(sub);
  head.appendChild(label);
  const tools = el('<div class="row"></div>');
  tools.appendChild(btn('重新校验', 'ghost', 'refresh-cw', async function () {
    try {
      const r = await api.githubVerify();
      toast('身份有效，可见仓库 ' + ((r.identity && r.identity.repoCount) || 0) + ' 个', 'ok');
      if (refresh) refresh();
    } catch (err) { toast('校验失败：' + err.message, 'err'); }
  }));
  tools.appendChild(btn('退出登录', 'danger', 'log-out', async function () {
    const ok = await confirmDialog({ title: '退出 GitHub', text: 'Token 会从本机删除，需要重新登录才能上传。', okLabel: '退出', danger: true });
    if (!ok) return;
    try {
      await api.githubSignOut(me.userId);
      toast('已退出', 'ok');
      if (refresh) refresh();
    } catch (err) { toast('退出失败：' + err.message, 'err'); }
  }));
  head.appendChild(tools);
  box.appendChild(head);
  const stats = el('<div class="stat-row"></div>');
  stats.appendChild(stat('可见仓库', String(me.repoCount || 0)));
  stats.appendChild(stat('上传仓库', me.repo || '—'));
  stats.appendChild(stat('上次校验', me.verifiedAt ? fmtAgo(me.verifiedAt) : '—'));
  box.appendChild(stats);
  const idLine = el('<p class="dim mono"></p>');
  idLine.textContent = '用户 ID ' + shortId(me.userId);
  box.appendChild(idLine);
  return box;
}
/** 上传一行：选文件 + 进度条。 */
function uploadRow(onDone) {
  const box = el("<div class=\"stack\"></div>");
  const picker = document.createElement('input');
  picker.type = 'file';
  picker.className = 'input';
  box.appendChild(picker);
  const bar = document.createElement('progress');
  bar.max = 100;
  bar.value = 0;
  bar.className = 'progress';
  bar.style.display = 'none';
  box.appendChild(bar);
  const note = el("<p class=\"dim\"></p>");
  note.textContent = "文件会作为 Release 资产上传到你的仓库，单文件上限 2 GiB。";
  box.appendChild(note);  const go = btn('上传到 GitHub', 'primary', 'cloud-upload', async function () {
    const file = picker.files && picker.files[0];
    if (!file) { toast('请先选择文件', 'warn'); return; }
    go.disabled = true;
    bar.style.display = '';
    bar.value = 0;
    try {
      const r = await api.githubUpload(file, null, function (sent, total) {
        bar.value = total ? Math.round((sent / total) * 100) : 0;
      });
      toast('上传完成：' + ((r.job && r.job.name) || file.name), 'ok');
      picker.value = '';
      if (onDone) onDone();
    } catch (err) { toast('上传失败：' + err.message, 'err'); }
    finally { go.disabled = false; }
  });
  box.appendChild(go);
  return box;
}

export async function githubPanel(refresh) {
  const card = panel('GitHub 登录', { icon: 'globe' });
  const body = el("<div class=\"stack\"></div>");
  card.body.appendChild(body);
  let data = null;
  try { data = await api.github(); } catch (err) { data = null; }
  const again = function () { if (refresh) refresh(); };
  body.appendChild(data && data.current ? identityView(data, again) : signInForm(again));
  if (data && data.current) body.appendChild(uploadRow(again));
  return card;
}
