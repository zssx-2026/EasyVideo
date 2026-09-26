/* EasyVideo - views/drafts.js
 * 发布视频（草稿箱）与草稿编辑：上传 / 本地链接 两种来源。
 */
import { api } from '../api.js';
import { state } from '../store.js';
import { navigate } from '../router.js';
import {
  el, icon, field, input, textarea, select, radio, switchControl, checkbox,
  panel, chip, tagChip, toast, emptyState, confirmDialog, mdSafe, fmtBytes,
  fmtAgo, fmtDuration, b64, unb64, avatarNode
} from '../ui.js';
import { paint, viewHead, btn, iconBtn, errorState, loadingRows, listRow, sectionHead } from './kit.js';

const RESOLUTIONS = ['3840x2160', '2560x1440', '1920x1080', '1280x720', '854x480'];
const FPS = ['24', '30', '60', '120'];

function pid6() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 6; i++) out += chars.charAt(Math.floor(Math.random() * chars.length));
  return out;
}

function isUrl(text) { return /^https?:/i.test(String(text || '').trim()); }

function isPath(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  if (/^[a-zA-Z]:[\/]/.test(t)) return true;
  if (t.charCodeAt(0) === 92) return true;
  return t.charAt(0) === '/';
}

function classifyLine(line) {
  const text = String(line || '').trim();
  if (!text) return null;
  if (isUrl(text)) {
    return { kind: 'link', name: text.split('/').pop() || 'video', url: text };
  }
  if (isPath(text)) {
    const parts = text.split(/[\/]/);
    return { kind: 'local', name: parts[parts.length - 1] || 'video', path: text };
  }
  return { kind: 'bad', name: text };
}

export async function renderRelease() {
  paint(loadingRows(5));
  let items = [];
  try { const r = await api.drafts(); items = r.items || []; }
  catch (err) { paint(errorState(err.message, renderRelease)); return; }

  const head = viewHead('发布视频', '草稿箱里的内容只有你自己能看到。', [
    btn('新建草稿', 'primary', 'plus', () => navigate('/video/draft/new/'))
  ]);

  if (!items.length) {
    paint([head, emptyState({
      icon: 'drafting-compass', title: '草稿箱是空的',
      line: '新建一个草稿，把视频文件、标题和简介准备好再发布。',
      action: '新建草稿', actionIcon: 'plus', onAction: () => navigate('/video/draft/new/')
    })]);
    return;
  }

  const list = el('<div class="draft-list"></div>');
  for (const draft of items) {
    const tools = [];
    tools.push(iconBtn('pencil', '编辑草稿', '', () => navigate('/video/draft/' + b64(draft.name) + '/')));
    tools.push(iconBtn('upload', '立即发布', '', async () => {
      const ok = await confirmDialog({ title: '发布草稿', text: '确认发布「' + (draft.name || '') + '」？', okLabel: '发布' });
      if (!ok) return;
      try { await api.publishDraft(draft.id); toast('已发布', 'ok'); renderRelease(); }
      catch (err) { toast('发布失败：' + err.message, 'err'); }
    }));
    tools.push(iconBtn('trash-2', '删除草稿', 'danger', async () => {
      const ok = await confirmDialog({ title: '删除草稿', text: '删除后无法恢复：' + (draft.name || ''), okLabel: '删除', danger: true });
      if (!ok) return;
      try { await api.deleteDraft(draft.id); toast('草稿已删除', 'ok'); renderRelease(); }
      catch (err) { toast('删除失败：' + err.message, 'err'); }
    }));
    list.appendChild(listRow({
      icon: 'file-video',
      title: draft.name || '未命名草稿',
      sub: draft.title || '还没有标题',
      meta: ((draft.files || []).length || 0) + ' 个文件 · ' + fmtAgo(draft.createdAt),
      tools: tools,
      onOpen: () => navigate('/video/draft/' + b64(draft.name) + '/')
    }));
  }

  paint([head, list]);
}

/* --------------------------------------------------------------- the form */

function buildForm(draft) {
  const d = draft || {};
  const model = {
    name: d.name || '',
    title: d.title || '',
    blurb: d.blurb || '',
    feedback: d.feedback !== false,
    pidMode: d.pid ? 'manual' : 'auto',
    pid: d.pid || pid6(),
    source: d.source === 'link' || d.source === 'local' ? d.source : 'upload',
    files: Array.isArray(d.files) ? d.files.slice() : [],
    collection: d.collection || '',
    resolution: d.resolution || '1920x1080',
    bitrateKbps: d.bitrateKbps || 6000,
    fps: d.fps || 30,
    secret: !!d.secret,
    secretScope: d.secretScope || 'friends'
  };
  const node = el('<div class="stack"></div>');

  /* 基本信息 */
  const basics = panel('基本信息', { icon: 'info' });
  const basicsGrid = el('<div class="form-grid"></div>');

  const nameInput = input({ value: model.name, placeholder: '草稿名' });
  nameInput.addEventListener('input', () => { model.name = nameInput.value; });
  basicsGrid.appendChild(field('草稿名', nameInput, { required: true }));

  const titleInput = input({ value: model.title, placeholder: '视频标题' });
  titleInput.addEventListener('input', () => { model.title = titleInput.value; });
  basicsGrid.appendChild(field('视频标题', titleInput, { required: true }));

  const pidRow = el('<div class="pid-row"></div>');
  const pidValue = input({ value: model.pid, readonly: 'readonly' });
  pidValue.className = 'input mono input-sm';
  pidValue.addEventListener('input', () => { model.pid = pidValue.value.toUpperCase(); });
  const autoBtn = chip('自动生成', { onClick: () => {} });
  const manualBtn = chip('手动填写', { onClick: () => {} });
  const reroll = iconBtn('refresh-cw', '重新生成', '', () => {
    model.pid = pid6();
    pidValue.value = model.pid;
  });
  const syncPid = () => {
    autoBtn.classList.toggle('chip-ok', model.pidMode === 'auto');
    manualBtn.classList.toggle('chip-ok', model.pidMode === 'manual');
    pidValue.readOnly = model.pidMode === 'auto';
    reroll.style.display = model.pidMode === 'auto' ? '' : 'none';
  };
  autoBtn.addEventListener('click', () => { model.pidMode = 'auto'; model.pid = pid6(); pidValue.value = model.pid; syncPid(); });
  manualBtn.addEventListener('click', () => { model.pidMode = 'manual'; syncPid(); pidValue.focus(); });
  pidRow.appendChild(pidValue);
  pidRow.appendChild(autoBtn);
  pidRow.appendChild(manualBtn);
  pidRow.appendChild(reroll);
  basicsGrid.appendChild(field('PID', pidRow, { hint: '发布后路径为 /video/昵称/PID' }));
  syncPid();

  const fb = switchControl({ label: '反馈流量', checked: model.feedback, onChange: (v) => { model.feedback = v; } });
  basicsGrid.appendChild(field('反馈流量', fb, { hint: '开启后会把观看情况反馈给搜索模型' }));
  basics.appendChild(basicsGrid);

  /* 简介 */
  const blurbPanel = panel('视频简介', { icon: 'file-video', subtitle: '支持 Markdown：标题、加粗、斜体、代码、链接、列表。' });
  const blurbArea = textarea({ placeholder: '# 标题&#10;- 要点', rows: '8' });
  blurbArea.value = model.blurb;
  const preview = el('<div class="md-preview"></div>');
  preview.style.display = 'none';
  const renderPreview = () => { preview.innerHTML = mdSafe(blurbArea.value); };
  blurbArea.addEventListener('input', () => { model.blurb = blurbArea.value; if (preview.style.display !== 'none') renderPreview(); });
  const togglePreview = btn('预览', 'ghost', 'eye', () => {
    const on = preview.style.display === 'none';
    preview.style.display = on ? '' : 'none';
    if (on) renderPreview();
  });
  blurbPanel.body.appendChild(blurbArea);
  blurbPanel.body.appendChild(togglePreview);
  blurbPanel.body.appendChild(preview);

  /* 视频文件 */
  const filesPanel = panel('视频文件', { icon: 'upload', subtitle: '多个文件会组成一个合集。' });
  const switchRow = el('<div class="source-switch"></div>');
  const sources = [['upload', '上传'], ['link', '本地链接'], ['local', '本机路径']];
  const sourceChips = {};
  const uploadBox = el('<div class="stack"></div>');
  const linkBox = el('<div class="stack"></div>');
  const fileList = el('<div class="stack-tight"></div>');

  const drawFiles = () => {
    fileList.innerHTML = '';
    model.files.forEach((file, index) => {
      const row = el('<div class="file-row"><span class="fc-name"></span><span class="fc-sub mono"></span><span class="fc-main"></span></div>');
      row.querySelector('.fc-name').textContent = file.name || ('片段 ' + (index + 1));
      row.querySelector('.fc-sub').textContent = file.kind === 'link' ? '外部链接' : file.kind === 'local' ? '本机文件' : (file.stored ? '已上传' : '待上传');
      const del = iconBtn('trash-2', '移除', '', () => { model.files.splice(index, 1); drawFiles(); });
      row.querySelector('.fc-main').appendChild(del);
      fileList.appendChild(row);
    });
    if (!model.files.length) {
      const hint = el('<p class="dim"></p>');
      hint.textContent = '还没有添加视频文件。';
      fileList.appendChild(hint);
    }
  };

  const pick = input({ type: 'file', accept: 'video/*', multiple: 'multiple' });
  pick.className = 'input input-sm';
  const zone = el('<div class="dropzone"><p class="dz-main"></p><p class="dz-sub"></p><div class="dz-actions"></div></div>');
  zone.querySelector('.dz-main').textContent = '把视频文件拖到这里';
  zone.querySelector('.dz-sub').textContent = '或者点击选择文件，支持多选（合集）';
  zone.querySelector('.dz-actions').appendChild(pick);

  const doUpload = async (files) => {
    for (const file of Array.from(files || [])) {
      const row = el('<div class="file-row"><span class="fc-name"></span><span class="fr-bar"><span class="fr-bar-fill"></span></span></div>');
      row.querySelector('.fc-name').textContent = file.name;
      const bar = row.querySelector('.fr-bar-fill');
      fileList.appendChild(row);
      try {
        const rec = await api.upload(file, 'media', (ratio) => { bar.style.width = Math.round(ratio * 100) + '%'; });
        model.files.push({ kind: 'upload', name: rec.name, stored: rec.stored, size: rec.size });
        row.remove();
        toast('已上传：' + rec.name, 'ok');
        drawFiles();
      } catch (err) {
        row.remove();
        toast('上传失败：' + err.message, 'err');
      }
    }
  };
  pick.addEventListener('change', () => { doUpload(pick.files); pick.value = ''; });
  zone.addEventListener('dragover', (ev) => { ev.preventDefault(); zone.classList.add('is-over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('is-over'));
  zone.addEventListener('drop', (ev) => {
    ev.preventDefault();
    zone.classList.remove('is-over');
    doUpload(ev.dataTransfer && ev.dataTransfer.files);
  });
  uploadBox.appendChild(zone);

  const linkArea = textarea({ rows: '6', placeholder: '每行一个地址：https://… 或 D:\videos\a.mp4' });
  const chipRow = el('<div class="chip-row"></div>');
  const parsed = () => String(linkArea.value || '').split(String.fromCharCode(10)).map(classifyLine).filter(Boolean);
  const applyLinks = () => {
    chipRow.innerHTML = '';
    const rows = parsed();
    for (const row of rows) {
      chipRow.appendChild(tagChip(row.name + ' · ' + (row.kind === 'link' ? '外部链接' : row.kind === 'local' ? '本机文件' : '无法识别'),
        row.kind === 'bad' ? 'warn' : row.kind === 'link' ? 'mono' : 'ok'));
    }
    model.files = rows.filter((row) => row.kind !== 'bad');
    drawFiles();
  };
  linkArea.addEventListener('input', applyLinks);
  linkBox.appendChild(linkArea);
  linkBox.appendChild(chipRow);

  const syncSource = () => {
    for (const key of Object.keys(sourceChips)) sourceChips[key].classList.toggle('chip-ok', model.source === key);
    const uploading = model.source === 'upload';
    const linking = model.source === 'link';
    const local = model.source === 'local';
    uploadBox.style.display = uploading ? '' : 'none';
    linkBox.style.display = uploading ? 'none' : '';
    linkArea.placeholder = local
      ? '每行一个本机绝对路径：D:\videos\a.mp4'
      : '每行一个链接或本机路径：https://… 或 D:\videos\a.mp4';
    applyLinks();
  };
  for (const pair of sources) {
    const node = chip(pair[1], { onClick: () => { model.source = pair[0]; syncSource(); } });
    sourceChips[pair[0]] = node;
    switchRow.appendChild(node);
  }
  filesPanel.body.appendChild(switchRow);
  filesPanel.body.appendChild(uploadBox);
  filesPanel.body.appendChild(linkBox);
  filesPanel.body.appendChild(sectionHead('已添加', { note: '合集顺序即播放顺序' }));
  filesPanel.body.appendChild(fileList);
  syncSource();

  /* 规格 */
  const spec = panel('规格与可见性', { icon: 'sliders-horizontal' });
  const specGrid = el('<div class="form-grid"></div>');
  const coll = input({ value: model.collection, placeholder: '合集名（可选）' });
  coll.addEventListener('input', () => { model.collection = coll.value; });
  specGrid.appendChild(field('合集', coll));

  const resSelect = select(RESOLUTIONS.map((r) => ({ value: r, label: r })), { value: model.resolution });
  resSelect.addEventListener('change', () => { model.resolution = resSelect.value; });
  specGrid.appendChild(field('分辨率', resSelect, { required: true }));

  const br = input({ type: 'number', value: String(model.bitrateKbps), min: '100' });
  br.addEventListener('input', () => { model.bitrateKbps = Number(br.value) || 0; });
  specGrid.appendChild(field('码率 kbps', br, { required: true }));

  const fpsSelect = select(FPS.map((f) => ({ value: f, label: f + ' fps' })), { value: String(model.fps) });
  fpsSelect.addEventListener('change', () => { model.fps = Number(fpsSelect.value) || 30; });
  specGrid.appendChild(field('帧率', fpsSelect, { required: true }));

  const secretBox = checkbox('私密视频', model.secret, (checked) => {
    model.secret = checked;
    scopeRow.style.display = checked ? '' : 'none';
  });
  const scopeRow = el('<div class="radio-group"></div>');
  scopeRow.appendChild(radio('ev-vsec', 'friends', '仅好友可观看', model.secretScope === 'friends', (v) => { model.secretScope = v; }));
  scopeRow.appendChild(radio('ev-vsec', 'self', '仅自己可观看', model.secretScope === 'self', (v) => { model.secretScope = v; }));
  scopeRow.style.display = model.secret ? '' : 'none';
  specGrid.appendChild(secretBox);
  specGrid.appendChild(scopeRow);
  spec.body.appendChild(specGrid);

  node.appendChild(basics);
  node.appendChild(blurbPanel);
  node.appendChild(filesPanel);
  node.appendChild(spec);
  node.model = model;
  return node;
}

function validate(model) {
  if (!String(model.name || '').trim()) return '请填写草稿名';
  if (!String(model.title || '').trim()) return '请填写视频标题';
  if (!String(model.blurb || '').trim()) return '请填写视频简介';
  if (!model.files.length) return '请至少添加一个视频文件';
  if (!model.resolution) return '请选择分辨率';
  if (!model.bitrateKbps) return '请填写码率';
  if (!model.fps) return '请选择帧率';
  return null;
}

function payload(model) {
  return {
    name: model.name.trim(),
    title: model.title.trim(),
    blurb: model.blurb,
    feedback: !!model.feedback,
    pid: model.pidMode === 'manual' ? model.pid.trim() : undefined,
    source: model.source,
    files: model.files,
    collection: model.collection,
    resolution: model.resolution,
    bitrateKbps: Number(model.bitrateKbps) || 0,
    fps: Number(model.fps) || 30,
    secret: !!model.secret,
    secretScope: model.secretScope
  };
}

export async function renderDraftNew() {
  const head = viewHead('新建草稿', '填完可以保存为草稿，也可以直接发布。', [
    btn('返回草稿箱', 'ghost', 'chevron-left', () => navigate('/video/release/'))
  ]);
  const form = buildForm(null);
  const foot = el('<div class="row row-end"></div>');
  foot.appendChild(btn('保存草稿', 'ghost', 'drafting-compass', async () => {
    const model = form.model;
    if (!String(model.name || '').trim()) { toast('请填写草稿名', 'warn'); return; }
    try { await api.createDraft(payload(model)); toast('草稿已保存', 'ok'); navigate('/video/release/'); }
    catch (err) { toast('保存失败：' + err.message, 'err'); }
  }));
  foot.appendChild(btn('发布视频', 'primary', 'cloud-upload', async () => {
    const model = form.model;
    const bad = validate(model);
    if (bad) { toast(bad, 'warn'); return; }
    try {
      const r = await api.createVideo(payload(model));
      toast('视频已发布', 'ok');
      const nick = (state.account && state.account.nickname) || '';
      navigate('/video/' + encodeURIComponent(nick) + '/' + (r.video ? r.video.pid : '') + '/');
    } catch (err) { toast('发布失败：' + err.message, 'err'); }
  }));
  paint([head, form, foot]);
}

export async function renderDraftEdit(name) {
  paint(loadingRows(6));
  const draftName = unb64(name);
  let draft = null;
  try {
    const r = await api.drafts();
    draft = (r.items || []).find((d) => d.name === draftName || b64(d.name) === name) || null;
    if (!draft) { const one = await api.draft(name); draft = one.draft || null; }
  } catch (err) { /* handled below */ }
  if (!draft) {
    paint([viewHead('编辑草稿', draftName), errorState('找不到这个草稿', () => navigate('/video/release/'))]);
    return;
  }

  const head = viewHead('编辑草稿', draft.name || '', [
    btn('返回草稿箱', 'ghost', 'chevron-left', () => navigate('/video/release/'))
  ]);
  const form = buildForm(draft);
  const foot = el('<div class="row row-end"></div>');
  foot.appendChild(btn('保存草稿', 'ghost', 'drafting-compass', async () => {
    try { await api.patchDraft(draft.id, payload(form.model)); toast('草稿已保存', 'ok'); navigate('/video/release/'); }
    catch (err) { toast('保存失败：' + err.message, 'err'); }
  }));
  foot.appendChild(btn('发布视频', 'primary', 'cloud-upload', async () => {
    const bad = validate(form.model);
    if (bad) { toast(bad, 'warn'); return; }
    try {
      await api.patchDraft(draft.id, payload(form.model));
      const r = await api.publishDraft(draft.id);
      toast('视频已发布', 'ok');
      navigate(r.path || '/video/release/');
    } catch (err) { toast('发布失败：' + err.message, 'err'); }
  }));
  paint([head, form, foot]);
}

export default { renderRelease, renderDraftNew, renderDraftEdit };
