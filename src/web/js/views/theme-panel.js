/* EasyVideo - 界面主题与自带组件面板。
 * 主题走 /api/themes*，组件走 /api/components。
 */
import { el, field, select, panel, toast } from '../ui.js';
import { btn, tel } from './kit.js';

/** 把 /api/themes/css 挂到 head；切换主题时换掉 query 触发重载。 */
export function applyTheme() {
  let link = document.getElementById('ev-theme');
  if (!link) {
    link = document.createElement('link');
    link.id = 'ev-theme';
    link.rel = 'stylesheet';
    document.head.appendChild(link);
  }
  link.href = '/api/themes/css?t=' + Date.now();
}

function dim(text) {
  const p = el('<p></p>');
  p.classList.add('dim');
  p.textContent = text;
  return p;
}

export async function themePanel(api, reload) {
  const card = panel('界面主题', { icon: 'sliders-horizontal' });
  let data = null;
  try { data = await api.themes(); } catch (err) { data = null; }
  if (!data || !data.current) {
    card.body.appendChild(dim('主题接口不可用。'));
    return card;
  }
  const options = (data.list || []).map((t) => ({ value: t.id, label: t.label + (t.kind === 'package' ? ' · 主题包' : '') }));
  const picker = select(options, { value: data.current.id });
  picker.addEventListener('change', async () => {
    try { await api.setTheme({ active: picker.value }); applyTheme(); toast('主题已切换', 'ok'); }
    catch (err) { toast('切换失败：' + err.message, 'err'); }
  });
  card.body.appendChild(field('主题', picker));
  const colours = el('<div></div>');
  colours.classList.add('theme-colors');
  for (const key of ['--bg', '--panel', '--ember', '--text']) {
    const hex = (data.current.vars || {})[key] || '#000000';
    const swatch = el('<label><span></span><em></em></label>');
    swatch.classList.add('theme-swatch');
    swatch.querySelector('span').style.background = hex;
    swatch.querySelector('em').textContent = key;
    const pick = document.createElement('input');
    pick.type = 'color';
    pick.value = /^#[0-9a-fA-F]{6}$/.test(hex) ? hex : '#3d8bfd';
    pick.addEventListener('change', async () => {
      try { await api.setTheme({ overrides: { [key]: pick.value } }); applyTheme(); toast('颜色已更新', 'ok'); }
      catch (err) { toast('更新失败：' + err.message, 'err'); }
    });
    swatch.appendChild(pick);
    colours.appendChild(swatch);
  }
  card.body.appendChild(colours);
  if (data.current.background) card.body.appendChild(dim('当前主题使用自定义背景图。'));
  const file = document.createElement('input');
  file.type = 'file';
  file.accept = '.zst,.zstd,.evt';
  file.style.display = 'none';
  file.addEventListener('change', async () => {
    const picked = file.files && file.files[0];
    file.value = '';
    if (!picked) return;
    try { await api.installTheme(picked); applyTheme(); toast('主题包已安装：' + picked.name, 'ok'); if (reload) reload(); }
    catch (err) { toast('安装失败：' + err.message, 'err'); }
  });
  card.body.appendChild(file);
  card.body.appendChild(btn('安装主题包（.zst）', 'ghost', 'upload', () => file.click()));
  return card;
}

export async function componentsPanel(api, reload) {
  const card = panel('自带组件', { icon: 'layers' });
  let data = null;
  try { data = await api.components(); } catch (err) { data = null; }
  if (!data || !data.items) {
    card.body.appendChild(dim('组件清单不可用。'));
    return card;
  }
  card.body.appendChild(tel('已就绪', data.present + ' / ' + data.total));
  card.body.appendChild(tel('组件目录', data.program || ''));
  const list = el('<div></div>');
  list.classList.add('comp-list');
  for (const item of data.items) {
    const row = el('<div><b></b><span></span></div>');
    row.classList.add('comp-row');
    row.querySelector('b').textContent = item.label + (item.present ? '' : '（缺失）');
    row.querySelector('span').textContent = item.present ? item.purpose : '未找到，放入 ' + item.dir;
    if (!item.present) row.classList.add('is-missing');
    list.appendChild(row);
  }
  card.body.appendChild(list);
  card.body.appendChild(btn('重新扫描组件', 'ghost', 'refresh-cw', async () => {
    try { const r = await api.refreshComponents(); toast('已扫描：' + r.present + '/' + r.total, 'ok'); if (reload) reload(); }
    catch (err) { toast('扫描失败：' + err.message, 'err'); }
  }));
  return card;
}
