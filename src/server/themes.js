/* EasyVideo - 主题系统（可调主题 + 主题包）。
 *
 * 内置若干主题；另有 .zst 主题包（package.json + settings.json +
 * background/ + maincolor/）。这里把主题装配成一段 CSS 变量覆盖，
 * 前端启动后拉取写入 <style>，因此不需要重新构建前端。
 */
import fs from 'node:fs';
import path from 'node:path';
import PATHS from './paths.js';
import logger from './logger.js';
import { readJson, writeJsonAtomic, safeName } from './util.js';
import { untar } from './archive.js';

const log = logger.child('theme');
const STATE = () => path.join(PATHS.data, 'theme.json');
const DIR = () => path.join(PATHS.data, 'themes');

export const BUILTIN = {
  obs: { label: 'OBS 深灰', dark: true, vars: { '--bg': '#1b1d21', '--bg-2': '#232629', '--bg-3': '#2b2f33', '--panel': '#232629', '--line': '#34383d', '--text': '#e6e8ea', '--text-2': '#c3c7cc', '--dim': '#8a9096', '--ember': '#3d8bfd', '--ember-2': '#5ea0ff', '--ember-dim': 'rgba(61,139,253,0.14)' } },
  cinema: { label: '放映厅', dark: true, vars: { '--bg': '#0d0f14', '--bg-2': '#141821', '--bg-3': '#1b2130', '--panel': '#141821', '--line': '#2a3243', '--text': '#e8ecf3', '--text-2': '#c8cede', '--dim': '#8b93a5', '--ember': '#ff6a3d', '--ember-2': '#ff9d4d', '--ember-dim': 'rgba(255,106,61,0.14)' } },
  bilibili: { label: 'B 站粉', dark: true, vars: { '--bg': '#17181c', '--bg-2': '#1f2126', '--bg-3': '#282b31', '--panel': '#1f2126', '--line': '#34373d', '--text': '#e9eaee', '--text-2': '#c6c8cf', '--dim': '#8b8e97', '--ember': '#fb7299', '--ember-2': '#ff9cb6', '--ember-dim': 'rgba(251,114,153,0.15)' } },
  paper: { label: '浅色纸白', dark: false, vars: { '--bg': '#f2f3f5', '--bg-2': '#ffffff', '--bg-3': '#e9ebef', '--panel': '#ffffff', '--line': '#d8dbe1', '--text': '#1f2329', '--text-2': '#4c5159', '--dim': '#8a8f98', '--ember': '#2f6fd0', '--ember-2': '#4a86e0', '--ember-dim': 'rgba(47,111,208,0.12)' } },
  contrast: { label: '高对比', dark: true, vars: { '--bg': '#000000', '--bg-2': '#0d0d0d', '--bg-3': '#161616', '--panel': '#0d0d0d', '--line': '#3a3a3a', '--text': '#ffffff', '--text-2': '#e2e2e2', '--dim': '#a0a0a0', '--ember': '#ffd400', '--ember-2': '#ffe45c', '--ember-dim': 'rgba(255,212,0,0.16)' } }
};

export function state() {
  const raw = readJson(STATE(), null);
  const base = { version: 1, active: 'obs', custom: {}, overrides: {}, background: null, backgroundNextSec: 0 };
  if (!raw || typeof raw !== 'object') return base;
  return Object.assign(base, raw);
}

function save(patch) {
  const next = Object.assign(state(), patch || {});
  writeJsonAtomic(STATE(), next);
  return next;
}

export function list() {
  const cfg = state();
  const out = [];
  for (const key of Object.keys(BUILTIN)) out.push({ id: key, label: BUILTIN[key].label, dark: BUILTIN[key].dark, vars: BUILTIN[key].vars, kind: 'builtin' });
  for (const key of Object.keys(cfg.custom || {})) {
    const it = cfg.custom[key];
    out.push({ id: key, label: it.label || key, dark: it.dark !== false, vars: it.vars || {}, kind: 'package', version: it.version || '', introduction: it.introduction || '' });
  }
  return out;
}

export function current() {
  const cfg = state();
  const all = list();
  const hit = all.find((t) => t.id === cfg.active) || all[0];
  return {
    id: hit.id, label: hit.label, dark: hit.dark,
    vars: Object.assign({}, hit.vars, cfg.overrides || {}),
    background: cfg.background || null,
    backgroundNextSec: Number(cfg.backgroundNextSec) || 0,
    all: all.map((t) => ({ id: t.id, label: t.label, dark: t.dark, kind: t.kind }))
  };
}

export function configure(patch) {
  const p = patch || {};
  const next = {};
  if (p.active) next.active = String(p.active);
  if (p.background !== undefined) next.background = p.background || null;
  if (p.backgroundNextSec !== undefined) next.backgroundNextSec = Number(p.backgroundNextSec) || 0;
  if (p.overrides && typeof p.overrides === 'object') {
    const merged = Object.assign({}, state().overrides || {});
    for (const key of Object.keys(p.overrides)) { if (p.overrides[key]) merged[key] = String(p.overrides[key]); else delete merged[key]; }
    next.overrides = merged;
  }
  const saved = save(next);
  log.info('theme ->', saved.active);
  return current();
}

export function css() {
  const cur = current();
  const DQ = String.fromCharCode(34);
  const lines = [':root {'];
  for (const key of Object.keys(cur.vars)) lines.push('  ' + key + ': ' + cur.vars[key] + ';');
  lines.push('}');
  if (cur.background) {
    lines.push('body { background-image: url(' + DQ + cur.background + DQ + '); background-size: cover; background-attachment: fixed; background-position: center; }');
    lines.push('body::before { content: ' + DQ + DQ + '; position: fixed; inset: 0; background: var(--bg); opacity: 0.82; pointer-events: none; z-index: -1; }');
  }
  if (cur.dark === false) lines.push('body { color-scheme: light; }');
  return lines.join(String.fromCharCode(10));
}

function findManifest(dir) {
  const direct = path.join(dir, 'package.json');
  if (fs.existsSync(direct)) return { dir: dir, file: direct };
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const nested = path.join(dir, entry.name, 'package.json');
    if (fs.existsSync(nested)) return { dir: path.join(dir, entry.name), file: nested };
  }
  return null;
}

function hexFromName(file) {
  const name = path.basename(file).replace(/[.]png$/i, '');
  const m = name.match(/^#?([0-9a-fA-F]{6})$/);
  return m ? '#' + m[1].toLowerCase() : null;
}

function collectMainColors(dir) {
  const out = [];
  const mc = path.join(dir, 'maincolor');
  try {
    if (!fs.existsSync(mc)) return out;
    for (const file of fs.readdirSync(mc).sort()) {
      if (!/[.]png$/i.test(file)) continue;
      const hex = hexFromName(file);
      if (hex) out.push(hex);
    }
  } catch (err) { /* ignore */ }
  return out;
}

function collectBackgrounds(dir) {
  const out = [];
  const bg = path.join(dir, 'background');
  try {
    if (!fs.existsSync(bg)) return out;
    for (const file of fs.readdirSync(bg).sort()) {
      if (!/[.](png|jpg|jpeg|webp|gif)$/i.test(file)) continue;
      out.push('/api/themes/file/' + encodeURIComponent(file));
    }
  } catch (err) { /* ignore */ }
  return out;
}

export function installPackage(bufferOrPath, fileName) {
  const buf = Buffer.isBuffer(bufferOrPath) ? bufferOrPath : fs.readFileSync(bufferOrPath);
  const base = safeName(String(fileName || 'theme').replace(/[.](zst|zip|evt)$/i, ''), 'theme');
  fs.mkdirSync(DIR(), { recursive: true });
  const dir = path.join(DIR(), base + '-' + Date.now().toString(36));
  const files = untar(buf, dir);
  const hit = findManifest(dir);
  if (!hit) throw new Error('主题包缺少 package.json');
  const manifest = readJson(hit.file, null) || {};
  const settings = readJson(path.join(hit.dir, 'settings.json'), null) || {};
  const colours = collectMainColors(hit.dir);
  const backgrounds = collectBackgrounds(hit.dir);
  const id = safeName(manifest.name || base, 'theme');
  const vars = {};
  if (colours[0]) { vars['--ember'] = colours[0]; vars['--ember-2'] = colours[1] || colours[0]; }
  if (Array.isArray(settings.maincolor)) {
    if (settings.maincolor[0]) vars['--ember'] = String(settings.maincolor[0]);
    if (settings.maincolor[1]) vars['--ember-2'] = String(settings.maincolor[1]);
  }
  const cfg = state();
  const custom = Object.assign({}, cfg.custom || {});
  custom[id] = {
    label: manifest.name || id, version: manifest.version || '',
    introduction: manifest.introduction || '', releases: manifest.releases || '',
    vars: vars, dark: settings.dark !== false, backgrounds: backgrounds,
    backgroundNextSec: Number(settings.background_next_sec) || 0,
    dir: hit.dir, installedAt: Date.now()
  };
  save({ custom: custom, active: id, background: backgrounds[0] || null, backgroundNextSec: Number(settings.background_next_sec) || 0 });
  log.info('theme installed:', id, files + ' files');
  return { id: id, manifest: manifest, files: files, backgrounds: backgrounds.length, colours: colours.length };
}

export function packageFile(name) {
  const cfg = state();
  const item = (cfg.custom || {})[cfg.active];
  if (!item || !item.dir) return null;
  const safe = safeName(String(name || ''), 'file.png');
  for (const sub of ['background', '']) {
    const file = path.join(item.dir, sub, safe);
    try { if (fs.existsSync(file) && fs.statSync(file).isFile()) return file; } catch (err) { /* next */ }
  }
  return null;
}

export function removePackage(id) {
  const cfg = state();
  const custom = Object.assign({}, cfg.custom || {});
  const item = custom[id];
  if (!item) return false;
  delete custom[id];
  const next = { custom: custom };
  if (cfg.active === id) next.active = 'obs';
  save(next);
  try { if (item.dir) fs.rmSync(item.dir, { recursive: true, force: true }); } catch (err) { /* ignore */ }
  return true;
}

export default { BUILTIN, list, current, configure, css, installPackage, packageFile, removePackage, state };
