/* EasyVideo - workspace doctor: syntax-check every source file, verify the path
 * contract, and list what the web client is still missing. Writes temp/doctor.txt. */

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const out = [];
const push = (s) => out.push(s);

function walk(dir, acc) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (err) { return acc; }
  for (const e of entries) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) walk(abs, acc);
    else if (e.name.endsWith('.js') || e.name.endsWith('.mjs')) acc.push(abs);
  }
  return acc;
}

/* 1. syntax check */
const serverFiles = walk(path.join(root, 'src', 'server'), []);
const webFiles = walk(path.join(root, 'src', 'web'), []);
const toolFiles = walk(path.join(root, 'tools'), []);
const all = serverFiles.concat(webFiles, toolFiles);
let bad = 0;
push('=== SYNTAX (' + all.length + ' files) ===');
for (const f of all) {
  const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
  const rel = path.relative(root, f).split(path.sep).join('/');
  if (r.status !== 0) { bad++; push('FAIL ' + rel); push('     ' + String(r.stderr).split(String.fromCharCode(10)).slice(0, 3).join(' | ')); }
  else push('ok   ' + rel);
}
push('syntax failures: ' + bad);

/* 2. view modules the shell imports */
const wanted = ['library', 'live', 'video', 'drafts', 'player', 'friends', 'myself', 'mydata', 'privacy', 'settings'];
push('');
push('=== VIEW MODULES ===');
for (const name of wanted) {
  const f = path.join(root, 'src', 'web', 'js', 'views', name + '.js');
  push((fs.existsSync(f) ? 'present ' : 'MISSING ') + name + '.js' + (fs.existsSync(f) ? ' (' + fs.statSync(f).size + ' B)' : ''));
}

/* 3. path contract */
push('');
push('=== PATHS ===');
try {
  const mod = await import(url.pathToFileURL(path.join(root, 'src', 'server', 'paths.js')).href);
  push('appRoot  ' + mod.APP_ROOT);
  push('data     ' + mod.PATHS.data);
  push('log      ' + mod.PATHS.log);
  push('cache    ' + mod.PATHS.cache);
  push('media    ' + mod.PATHS.media);
} catch (err) { push('paths import FAILED: ' + err.message); }

/* 4. release artefacts */
push('');
push('=== RELEASE ===');
for (const rel of ['dist/EasyVideo.exe', 'app/EasyVideo.exe', 'installer']) {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) { push('absent   ' + rel); continue; }
  const st = fs.statSync(abs);
  push('present  ' + rel + (st.isFile() ? '  ' + (st.size / 1048576).toFixed(1) + ' MiB' : '/'));
}

push('');
push('generated ' + new Date().toISOString());
// temp/ 是可清理的运行目录，报告前先确保它存在。
fs.mkdirSync(path.join(root, 'temp'), { recursive: true });
fs.writeFileSync(path.join(root, 'temp', 'doctor.txt'), out.join(String.fromCharCode(10)), 'utf8');
console.log('doctor written, failures=' + bad);
