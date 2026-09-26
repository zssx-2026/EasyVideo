/* EasyVideo - views/mydata.js
 * 个人信息：头像、昵称、姓名、性别、生日、偏好。每一栏都可以直接改，改完保存。
 */
import { api } from '../api.js';
import {
  el, icon, field, input, panel, radio, toast, avatarField, fmtDate, emptyState
} from '../ui.js';
import { paint, viewHead, btn, errorState, loadingRows, sectionHead } from './kit.js';

const GENDERS = [['male', '男'], ['female', '女'], ['undisclosed', '不透露']];

function pad(n) { return String(n).padStart(2, '0'); }

/** 生日彩蛋：生日当天打开这一页会安静地祝一句生日快乐。 */
function isBirthdayToday(value) {
  const text = String(value || '');
  if (text.length < 10) return false;
  const now = new Date();
  return text.slice(5, 10) === (pad(now.getMonth() + 1) + '-' + pad(now.getDate()));
}

/** 0~N 条文本偏好的小编辑器：满了就收起“添加”。 */
function prefEditor(opts) {
  const o = opts || {};
  const host = el('<div class="stack-tight"></div>');
  const items = Array.isArray(o.values) ? o.values.slice(0, o.max) : [];
  const emit = () => {
    if (o.onChange) o.onChange(items.map((v) => String(v).trim()).filter(Boolean));
  };
  const draw = () => {
    host.innerHTML = '';
    items.forEach((value, index) => {
      const row = el('<div class="row"></div>');
      const box = input({ value: value, placeholder: o.placeholder || '输入内容' });
      box.addEventListener('input', () => { items[index] = box.value; emit(); });
      const del = el('<button type="button" class="icon-btn" aria-label="移除"></button>');
      del.innerHTML = icon('x');
      del.addEventListener('click', () => { items.splice(index, 1); draw(); emit(); });
      row.appendChild(box);
      row.appendChild(del);
      host.appendChild(row);
    });
    if (items.length < o.max) {
      const add = el('<button type="button" class="btn btn-ghost btn-sm"></button>');
      add.innerHTML = icon('plus') + '<span>添加</span>';
      add.addEventListener('click', () => { items.push(''); draw(); });
      host.appendChild(add);
    }
  };
  draw();
  return host;
}

export async function renderMyData() {
  const view = document.getElementById('view');
  if (view) paint(loadingRows(6));

  let data;
  try { data = await api.me(); }
  catch (err) { paint(errorState(err.message, renderMyData)); return; }

  const account = data.account || {};
  const draft = {
    nickname: account.nickname || '',
    name: account.name || '',
    gender: account.gender || 'undisclosed',
    birthday: account.birthday || '',
    avatar: account.avatar || ''
  };
  const prefs = account.preferences || { favorite: '', liked: [], loved: [] };
  const state0 = {
    favorite: prefs.favorite ? [prefs.favorite] : [],
    liked: Array.isArray(prefs.liked) ? prefs.liked.slice(0, 2) : [],
    loved: Array.isArray(prefs.loved) ? prefs.loved.slice(0, 3) : []
  };

  const head = viewHead('个人信息', '这些内容决定别人在主页上看到什么。', [
    btn('返回我的', 'ghost', 'chevron-left', () => { location.hash = '#/home/myself/'; })
  ]);

  const form = el('<div class="form-grid"></div>');

  const avatarBox = el('<div class="stack"></div>');
  avatarBox.appendChild(avatarField(account, (value) => { draft.avatar = value; }));
  form.appendChild(field('头像', avatarBox, { hint: '点击更改：支持图片链接或本机路径' }));

  const nick = input({ value: draft.nickname, placeholder: '昵称' });
  nick.addEventListener('input', () => { draft.nickname = nick.value; });
  form.appendChild(field('昵称', nick, { required: true, hint: '点击即可更改' }));

  const nameBox = input({ value: draft.name, placeholder: '真实姓名（可选）' });
  nameBox.addEventListener('input', () => { draft.name = nameBox.value; });
  form.appendChild(field('姓名', nameBox, { hint: '仅在你允许时公开' }));

  const genderRow = el('<div class="radio-group"></div>');
  for (const pair of GENDERS) {
    const node = radio('ev-gender', pair[0], pair[1], draft.gender === pair[0], (value) => { draft.gender = value; });
    genderRow.appendChild(node);
  }
  form.appendChild(field('性别', genderRow));

  const birth = input({ type: 'date', value: draft.birthday });
  birth.addEventListener('change', () => { draft.birthday = birth.value; });
  const birthBox = el('<div class="stack-tight"></div>');
  birthBox.appendChild(birth);
  if (isBirthdayToday(draft.birthday)) {
    const wish = el('<p class="dim"></p>');
    wish.textContent = '生日快乐！';
    birthBox.appendChild(wish);
  }
  form.appendChild(field('生日', birthBox, { hint: '生日时间有彩蛋' }));

  form.appendChild(field('最喜欢的', prefEditor({
    values: state0.favorite, max: 1, placeholder: '0~1 种',
    onChange: (list) => { state0.favorite = list; }
  }), { hint: '0~1 种最喜欢的' }));

  form.appendChild(field('比较喜欢的', prefEditor({
    values: state0.liked, max: 2, placeholder: '0~2 种',
    onChange: (list) => { state0.liked = list; }
  }), { hint: '0~2 种比较喜欢的' }));

  form.appendChild(field('喜欢的', prefEditor({
    values: state0.loved, max: 3, placeholder: '0~3 种',
    onChange: (list) => { state0.loved = list; }
  }), { hint: '0~3 种喜欢的' }));

  const body = panel('资料', { icon: 'user-round', subtitle: '改完点保存，主页立刻更新。' });
  body.body.appendChild(form);

  const save = btn('保存', 'primary', 'circle-check', async () => {
    if (!draft.nickname.trim()) { toast('昵称不能为空', 'warn'); return; }
    save.disabled = true;
    try {
      await api.patchMe({
        nickname: draft.nickname.trim(),
        name: draft.name,
        gender: draft.gender,
        birthday: draft.birthday,
        avatar: draft.avatar || null,
        preferences: {
          favorite: (state0.favorite[0] || ''),
          liked: state0.liked.slice(0, 2),
          loved: state0.loved.slice(0, 3)
        }
      });
      toast('个人信息已保存', 'ok');
      window.dispatchEvent(new Event('ev:topbar'));
      renderMyData();
    } catch (err) {
      toast('保存失败：' + err.message, 'err');
    } finally { save.disabled = false; }
  });

  const foot = el('<div class="row row-end"></div>');
  foot.appendChild(btn('隐私设置', 'ghost', 'shield', () => { location.hash = '#/home/privacy/'; }));
  foot.appendChild(save);

  paint([head, body, foot]);
}

export default { renderMyData };
