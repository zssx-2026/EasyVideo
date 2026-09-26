import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const root = "D:/dev/DeepSeekHarnessWorkspace/EasyVideo";
const NL = String.fromCharCode(10);
const out = [];
function walk(d, acc) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const full = path.join(d, e.name);
    if (e.isDirectory()) walk(full, acc);
    else if (e.name.endsWith('.js') || e.name.endsWith('.mjs')) acc.push(full);
  }
  return acc;
}
const files = walk(path.join(root, 'src'), []).concat(walk(path.join(root, 'tools'), []));
out.push('检查文件数: ' + files.length);
let bad = 0;
for (const f of files) {
  try {
    execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' });
  } catch (err) {
    bad++;
    out.push('FAIL ' + path.relative(root, f));
  }
}
out.push('语法失败: ' + bad);
const exe = path.join(root, 'app', 'EasyVideo.exe');
out.push('app/EasyVideo.exe: ' + (fs.existsSync(exe) ? (fs.statSync(exe).size / 1048576).toFixed(2) + ' MiB' : 'MISSING'));
const setup = path.join(root, 'installer', 'EasyVideo-v1.0.0pre1-Setup.exe');
out.push('installer: ' + (fs.existsSync(setup) ? (fs.statSync(setup).size / 1048576).toFixed(2) + ' MiB' : 'MISSING'));
out.push('program: ' + fs.readdirSync(path.join(root, 'program')).join(' '));
fs.mkdirSync(path.join(root, 'temp'), { recursive: true });
fs.writeFileSync(path.join(root, 'temp', 'health.txt'), out.join(NL), 'utf8');
console.log('written ' + out.length + ' lines');