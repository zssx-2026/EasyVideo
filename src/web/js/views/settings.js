/* EasyVideo - views/settings.js
 * 应用设置：运行状态、路径、传输模式、日志、模型遥测、维护。
 */
import { api, request } from '../api.js';
import { state, bootstrap } from '../store.js';
import {
  el, icon, field, input, select, panel, stat, meter, toast, copyText,
  fmtBytes, fmtDate, fmtPct, switchControl
} from '../ui.js';
import { paint, viewHead, btn, iconBtn, errorState, loadingRows, sectionHead, tel } from './kit.js';
import { themePanel, componentsPanel } from './theme-panel.js';
import { githubPanel } from './github-panel.js';

const MODE_NOTE = {
  SERVER: 'SERVER：由服务器统一分发数据包。',
  P2P: 'P2P：单对多，主机上行带宽要求极高，观看人数多时延迟升高。',
  BT: 'BT：主机把不同数据片分发到随机观众，观众之间互相转发，理论上人越多越快。'
};

function pathRow(label, value) {
  const row = el('<tr><td class="p-key mono"></td><td class="p-val mono"></td><td class="p-act"></td></tr>');
  row.querySelector('.p-key').textContent = label;
  row.querySelector('.p-val').textContent = value || '—';
  const copy = iconBtn('copy', '复制路径', '', async () => {
    const ok = await copyText(value || '');
    toast(ok ? '已复制：' + value : '复制失败，请手动选择', ok ? 'ok' : 'warn');
  });
  row.querySelector('.p-act').appendChild(copy);
  return row;
}

export async function renderSettings() {
  const view = document.getElementById('view');
  if (view) paint(loadingRows(8));

  let health = null;
  try { health = await api.health(); } catch (err) { health = null; }

  const paths = state.paths || {};
  const transport = state.transport || {};
  const appSettings = state.settings || {};

  const head = viewHead('应用设置', '所有数据都在 data/ 目录，日志在 log/ 目录。');

  /* ---- 运行状态 ---- */
  const run = panel('运行状态', { icon: 'activity' });
  const runStats = el('<div class="stat-row"></div>');
  if (health) {
    runStats.appendChild(stat('运行时长', Math.floor((health.uptimeSec || 0) / 60) + ' 分钟'));
    runStats.appendChild(stat('进程号', health.pid));
    runStats.appendChild(stat('Node', health.node));
    runStats.appendChild(stat('内存', health.memoryMB + ' MB'));
    runStats.appendChild(stat('连接数', (health.hub && health.hub.peers) || 0));
    runStats.appendChild(stat('流', (health.transport && health.transport.streams) || 0));
  } else {
    runStats.appendChild(stat('运行状态', '无法读取 /api/health'));
  }
  run.body.appendChild(runStats);
  const modeStrip = el('<div class="telemetry-strip"></div>');
  modeStrip.appendChild(tel('MODES', (transport.modes || []).join(' / ')));
  modeStrip.appendChild(tel('SEGMENT', fmtBytes(transport.segmentBytes || 0)));
  modeStrip.appendChild(tel('PEERS', transport.peers || 0));
  run.body.appendChild(modeStrip);
  run.body.appendChild(btn('立即备份', 'ghost', 'hard-drive', async () => {
    try { const r = await api.backup(); toast(r.file ? ('备份完成：' + r.file) : '备份完成', 'ok'); }
    catch (err) { toast('备份失败：' + err.message, 'err'); }
  }));

  /* ---- 路径 ---- */
  const pathPanel = panel('数据与日志路径', { icon: 'folder', subtitle: '数据保存在程序目录的 data/，日志保存在 log/。' });
  const table = el('<table class="path-table"></table>');
  const tbody = el('<tbody></tbody>');
  const rows = [
    ['数据目录 data/', paths.data],
    ['日志目录 log/', paths.log],
    ['临时缓存', paths.cache],
    ['媒体库', paths.media],
    ['录制目录', appSettings.recordDir || paths.recordings],
    ['备份目录', paths.backup],
    ['回收站', paths.recycle]
  ];
  for (const row of rows) tbody.appendChild(pathRow(row[0], row[1]));
  table.appendChild(tbody);
  pathPanel.body.appendChild(table);

  /* ---- 传输 ---- */
  const transportPanel = panel('传输模式', { icon: 'network', subtitle: '默认模式用于新建直播房间。' });
  const modeSelect = select([
    { value: 'SERVER', label: 'SERVER 服务器分发' },
    { value: 'P2P', label: 'P2P 单对多' },
    { value: 'BT', label: 'BT 分片共享（推荐）' }
  ], { value: appSettings.defaultMode || 'BT' });
  modeSelect.addEventListener('change', async () => {
    try { await api.patchSettings({ defaultMode: modeSelect.value }); toast('默认传输模式已更新', 'ok'); }
    catch (err) { toast('保存失败：' + err.message, 'err'); }
  });
  transportPanel.body.appendChild(field('默认传输模式', modeSelect));

  const estimate = el('<div class="stat-row"></div>');
  const viewers = input({ type: 'number', value: '10', min: '1' });
  const bitrate = input({ type: 'number', value: '6000', min: '100' });
  const recalc = async () => {
    estimate.innerHTML = '';
    try {
      const r = await api.transportPlan(Number(viewers.value) || 1, Number(bitrate.value) || 0);
      const plan = r.plan || {};
      estimate.appendChild(stat('SERVER 上行', plan.SERVER.toFixed(1) + ' Mbps'));
      estimate.appendChild(stat('P2P 上行', plan.P2P.toFixed(1) + ' Mbps'));
      estimate.appendChild(stat('BT 上行', plan.BT.toFixed(1) + ' Mbps'));
    } catch (err) { estimate.appendChild(stat('估算', '失败')); }
  };
  viewers.addEventListener('change', recalc);
  bitrate.addEventListener('change', recalc);
  const calcRow = el('<div class="form-grid"></div>');
  calcRow.appendChild(field('观看人数', viewers));
  calcRow.appendChild(field('码率 kbps', bitrate));
  transportPanel.body.appendChild(calcRow);
  transportPanel.body.appendChild(estimate);
  const notes = el('<div class="stack-tight"></div>');
  for (const key of ['P2P', 'BT', 'SERVER']) {
    const line = el('<p class="dim"></p>');
    line.textContent = MODE_NOTE[key];
    notes.appendChild(line);
  }
  transportPanel.body.appendChild(notes);
  recalc();

  /* ---- 日志 ---- */
  const logPanel = panel('运行日志', { icon: 'terminal', subtitle: '日志文件写在 log/ 目录，最多保留 14 天。' });
  const logBox = el('<pre class="mono ll-path"></pre>');
  logBox.textContent = '读取中…';
  logPanel.body.appendChild(logBox);
  const loadLog = async () => {
    try {
      const r = await request('/logs/tail?n=200');
      logBox.textContent = (r.lines || []).join(String.fromCharCode(10)) || '（还没有日志）';
    } catch (err) { logBox.textContent = '读取日志失败：' + err.message; }
  };
  const logTools = el('<div class="row"></div>');
  logTools.appendChild(btn('刷新', 'ghost', 'refresh-cw', loadLog));
  logTools.appendChild(btn('打开日志目录', 'ghost', 'external-link', async () => {
    try { await request('/logs/open', { method: 'POST' }); } catch (err) { /* ignore */ }
  }));
  logPanel.body.appendChild(logTools);
  loadLog();

  /* ---- 模型 ---- */
  const modelPanel = panel('本机搜索模型', { icon: 'sparkles', subtitle: '跟随你的搜索即时训练，直播与视频各一个。' });
  try {
    const s = await api.searchStats();
    for (const key of ['live', 'video']) {
      const info = (s.stats && s.stats[key]) || {};
      const row = el('<div class="stack-tight"></div>');
      const title = el('<p class="dim"></p>');
      title.textContent = (key === 'live' ? '直播搜索模型' : '视频搜索模型');
      row.appendChild(title);
      row.appendChild(meter(info.utilization || 0, fmtPct(info.utilization || 0)));
      const stats = el('<div class="stat-row"></div>');
      stats.appendChild(stat('参数', String(info.parameters || 0)));
      stats.appendChild(stat('预算', String(info.parameterBudget || 0)));
      stats.appendChild(stat('样本', String(info.samples || 0)));
      row.appendChild(stats);
      modelPanel.body.appendChild(row);
    }
  } catch (err) {
    modelPanel.body.appendChild(el('<p class="dim">模型统计不可用。</p>'));
  }

  /* ---- 导出 / 导入 ---- */
  const io = panel('设置导出与导入', { icon: 'sliders-horizontal' });
  const ioRow = el('<div class="row"></div>');
  ioRow.appendChild(btn('导出设置', 'ghost', 'download', () => {
    window.open(api.exportSettingsUrl(true), '_blank');
  }));
  const fileInput = input({ type: 'file', accept: '.json,application/json' });
  fileInput.className = 'input';
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const payload = JSON.parse(text);
      await api.importSettings(payload, true);
      toast('设置已导入', 'ok');
      await bootstrap();
      window.dispatchEvent(new Event('ev:topbar'));
    } catch (err) { toast('导入失败：' + err.message, 'err'); }
    fileInput.value = '';
  });
  ioRow.appendChild(btn('导入设置', 'ghost', 'upload', () => fileInput.click()));
  ioRow.appendChild(fileInput);
  io.body.appendChild(ioRow);

  /* ---- 上传加速（uploadtool 里的开源加速器）---- */
  const up = panel('上传加速', { icon: 'cloud-upload', subtitle: '复用 uploadtool/ 里的 FastGithub / Steam++，无窗口后台运行。' });
  let upState = { enabled: false, autostart: false, headless: true, accelerator: null };
  let upInfo = { items: [] };
  try {
    const r = await api.uploader();
    upState = r.state || upState;
    upInfo = r.available || upInfo;
  } catch (err) { /* 加速器接口不可用 */ }
  const upList = el('<div class="stack-tight"></div>');
  for (const acc of upInfo.items || []) {
    const line = el('<p class="dim"></p>');
    line.textContent = (acc.present ? '可用 · ' : '未找到 · ') + acc.label + (acc.file ? '  ' + acc.file : '');
    upList.appendChild(line);
  }
  if (!(upInfo.items || []).length) {
    const hint = el('<p class="dim"></p>');
    hint.textContent = '把 FastGithub 或 Steam++ 放进 uploadtool/ 后即可在此启用。';
    upList.appendChild(hint);
  }
  up.body.appendChild(upList);
  up.body.appendChild(switchControl({ label: '启用上传加速', checked: !!upState.enabled, onChange: async (v) => {
    try { await api.configureUploader({ enabled: v, autostart: upState.autostart, headless: upState.headless, accelerator: upState.accelerator }); toast(v ? '已启用上传加速' : '已停用上传加速', 'ok'); } catch (err) { toast('操作失败：' + err.message, 'err'); }
  } }));
  up.body.appendChild(switchControl({ label: '开机自动后台上传', checked: !!upState.autostart, onChange: async (v) => {
    try { await api.configureUploader({ enabled: upState.enabled, autostart: v, headless: upState.headless, accelerator: upState.accelerator }); toast(v ? '已开启开机自启' : '已关闭开机自启', 'ok'); } catch (err) { toast('操作失败：' + err.message, 'err'); }
  } }));
  up.body.appendChild(switchControl({ label: '无窗口后台运行', checked: upState.headless !== false, onChange: async (v) => {
    try { await api.configureUploader({ enabled: upState.enabled, autostart: upState.autostart, headless: v, accelerator: upState.accelerator }); } catch (err) { /* ignore */ }
  } }));
  up.body.appendChild(btn('立即启动加速器', 'ghost', 'play', async () => {
    try { const r = await api.startUploader(upState.accelerator); toast(r.result && r.result.started ? '加速器已启动' : '加速器未启动', r.result && r.result.started ? 'ok' : 'warn'); } catch (err) { toast('启动失败：' + err.message, 'err'); }
  }));

  /* ---- 转码（内置 FFMPEG 调用）---- */
  const tc = panel('转码与画质梯度', { icon: 'clapperboard', subtitle: '调用本机 ffmpeg 生成 360P~4K 梯度，观看页可直接切换。' });
  let ff = null;
  try { ff = await api.ffmpeg(); } catch (err) { ff = null; }
  if (ff) {
    const strip = el('<div class="telemetry-strip"></div>');
    strip.appendChild(tel('FFMPEG', ff.available ? '已就绪' : '未安装'));
    strip.appendChild(tel('任务', (ff.running || 0) + ' / ' + (ff.total || 0)));
    tc.body.appendChild(strip);
    const hint = el('<p class="dim mono"></p>');
    hint.textContent = ff.ffmpeg || (ff.installHint || '');
    tc.body.appendChild(hint);
    const grid2 = el('<div class="chip-row"></div>');
    for (const q of ff.ladder || []) grid2.appendChild(chip(q.label, {}));
    tc.body.appendChild(grid2);
  } else {
    const hint = el('<p class="dim"></p>');
    hint.textContent = '转码接口不可用。';
    tc.body.appendChild(hint);
  }
  tc.body.appendChild(btn('重新检测 ffmpeg', 'ghost', 'refresh-cw', async () => {
    try { const r = await api.refreshFfmpeg(); toast(r.available ? 'ffmpeg 已就绪' : '仍未找到 ffmpeg', r.available ? 'ok' : 'warn'); renderSettings(); } catch (err) { toast('检测失败：' + err.message, 'err'); }
  }));

  const th = await themePanel(api, renderSettings);
  const comp = await componentsPanel(api, renderSettings);
  const gh = await githubPanel(renderSettings);

  paint([head, run, pathPanel, transportPanel, up, tc, logPanel, modelPanel, io, th, comp, gh]);
}

export default { renderSettings };
