/* EasyVideo - 组件下载器（自包含依赖的来源）。
 *
 *   node tools/fetch-components.mjs          下载缺的组件
 *   node tools/fetch-components.mjs --list   只看状态
 *   node tools/fetch-components.mjs --only=ffmpeg,aria2
 *   node tools/fetch-components.mjs --force
 *
 * prompt.txt 第 142 行：成品 App 与组件分别放在 /EasyVideo/program/ 与
 * /EasyVideo/program/plugins/。依赖全部以组件形式自带，不依赖系统 PATH。
 *
 * 组件来自上游官方发布页，脚本不改写任何内容：
 *   ffmpeg   https://www.gyan.dev/ffmpeg/builds/       LGPL/GPL
 *   aria2    https://github.com/aria2/aria2/releases   GPL-2.0
 *   7-Zip    https://www.7-zip.org/a/                  LGPL
 *   node     https://nodejs.org/dist/                  MIT
 *   zstd     https://github.com/facebook/zstd/releases BSD-3
 *
 * 摆放位置（src/server/components.js 会自动发现）：
 *   program/ffmpeg/ffmpeg.exe + ffprobe.exe
 *   program/aria2/aria2c.exe
 *   program/7zip/7z.exe + 7z.dll
 *   program/node/node.exe
 *   program/zstd/zstd.exe
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const program = path.join(root, 'program');
const cache = path.join(os.tmpdir(), 'EasyVideo', 'components');

const COMPONENTS = [
  {
    id: 'ffmpeg', dir: 'ffmpeg', label: 'FFmpeg', license: 'LGPL/GPL',
    home: 'https://ffmpeg.org/', files: ['ffmpeg.exe', 'ffprobe.exe'],
    url: 'https://registry.npmmirror.com/-/binary/ffmpeg-builds/v8.0.3/ffmpeg-8.0.3-win32-x64-gpl.tar.xz',
    note: '从 tar.xz 里取 bin/ffmpeg.exe 与 bin/ffprobe.exe'
  },
  {
    id: 'aria2', dir: 'aria2', label: 'aria2', license: 'GPL-2.0',
    home: 'https://aria2.github.io/', files: ['aria2c.exe'],
    url: 'https://gh-proxy.com/https://github.com/aria2/aria2/releases/download/release-1.37.0/aria2-1.37.0-win-64bit-build1.zip',
    note: '取压缩包里的 aria2c.exe'
  },
  {
    id: '7zip', dir: '7zip', label: '7-Zip', license: 'LGPL',
    home: 'https://7-zip.org/', files: ['7za.exe'],
    url: 'https://registry.npmmirror.com/7zip-bin/-/7zip-bin-5.2.0.tgz',
    note: '7zip-bin 里的 7za 独立版'
  },
  {
    id: 'node', dir: 'node', label: 'Node.js', license: 'MIT',
    home: 'https://nodejs.org/', files: ['node.exe'],
    url: 'https://cdn.npmmirror.com/binaries/node/v22.11.0/node-v22.11.0-win-x64.zip',
    note: '插件宿主用的独立运行时'
  },
  {
    id: 'zstd', dir: 'zstd', label: 'Zstandard', license: 'BSD-3',
    home: 'https://facebook.github.io/zstd/', files: ['zstd.exe'],
    url: 'https://ghproxy.net/https://github.com/facebook/zstd/releases/download/v1.5.6/zstd-v1.5.6-win64.zip',
    note: '插件与主题包（.zst）的解压器；node 自带 zstd 时可选'
  }
];

function present(item) {
  const dir = path.join(program, item.dir);
  return item.files.every((f) => fs.existsSync(path.join(dir, f)));
}

function status() {
  const rows = COMPONENTS.map((item) => ({
    id: item.id, label: item.label, license: item.license, home: item.home,
    dir: path.join(program, item.dir), files: item.files, present: present(item), note: item.note
  }));
  return { rows: rows, present: rows.filter((r) => r.present).length, total: rows.length, program: program };
}

async function download(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  const res = await fetch(from, { redirect: 'follow' });
  if (!res.ok) throw new Error(from + ' -> HTTP ' + res.status);
  const total = Number(res.headers.get('content-length') || 0);
  const chunks = [];
  let got = 0;
  for await (const chunk of res.body) {
    chunks.push(chunk);
    got += chunk.length;
    process.stdout.write('  ' + (got / 1048576).toFixed(1) + ' MiB' + (total ? ' / ' + (total / 1048576).toFixed(1) + ' MiB' : '') + '   ' + String.fromCharCode(13));
  }
  process.stdout.write(String.fromCharCode(10));
  const body = Buffer.concat(chunks);
  fs.writeFileSync(to, body);
  return body.length;
}

function extract(archive, into) {
  fs.mkdirSync(into, { recursive: true });
  const a = 'C:/Program Files/7-Zip/7z.exe';
  const b = 'C:/Program Files (x86)/7-Zip/7z.exe';
  const tool = fs.existsSync(a) ? a : (fs.existsSync(b) ? b : null);
  if (tool) {
    execFileSync(tool, ['x', archive, '-o' + into, '-y'], { stdio: 'ignore' });
    return true;
  }
  try {
    execFileSync('tar', ['-xf', archive, '-C', into], { stdio: 'ignore' });
    return true;
  } catch (err) { return false; }
}

function findFile(dir, name) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isFile() && entry.name.toLowerCase() === name.toLowerCase()) return full;
    if (entry.isDirectory()) { const hit = findFile(full, name); if (hit) return hit; }
  }
  return null;
}

async function install(item, opts) {
  const target = path.join(program, item.dir);
  if (present(item) && !opts.force) { console.log('  ' + item.id + ': 已就绪'); return true; }
  fs.mkdirSync(target, { recursive: true });
  const archive = path.join(cache, item.id + path.extname(new URL(item.url).pathname));
  if (!fs.existsSync(archive) || opts.force) {
    console.log('  ' + item.id + ': 下载 ' + item.url);
    await download(item.url, archive);
  }
  const staging = path.join(cache, item.id + '-x');
  fs.rmSync(staging, { recursive: true, force: true });
  if (!extract(archive, staging)) {
    console.log('  ' + item.id + ': 无法解压，请手动放置 —— ' + item.note);
    return false;
  }
  let copied = 0;
  for (const name of item.files) {
    const hit = findFile(staging, name);
    if (!hit) { console.log('  ' + item.id + ': 缺少 ' + name); continue; }
    fs.copyFileSync(hit, path.join(target, name));
    copied++;
  }
  console.log('  ' + item.id + ': ' + copied + '/' + item.files.length + ' 个文件就位');
  return copied === item.files.length;
}

async function main() {
  const argv = process.argv.slice(2);
  const opts = { force: argv.includes('--force'), list: argv.includes('--list'), only: null };
  const onlyArg = argv.find((a) => a.indexOf('--only=') === 0);
  if (onlyArg) opts.only = onlyArg.slice(7).split(',').map((s) => s.trim()).filter(Boolean);
  const info = status();
  console.log('组件目录: ' + info.program);
  for (const row of info.rows) {
    console.log('  [' + (row.present ? 'x' : ' ') + '] ' + row.id.padEnd(8) + ' ' + row.label.padEnd(12) + ' ' + row.license.padEnd(9) + ' ' + row.home);
  }
  console.log('已就绪 ' + info.present + ' / ' + info.total);
  if (opts.list) return;
  const todo = info.rows.filter((r) => !r.present && (!opts.only || opts.only.includes(r.id)));
  if (!todo.length) { console.log('没有需要下载的组件。'); return; }
  let ok = 0;
  for (const row of todo) {
    const item = COMPONENTS.find((c) => c.id === row.id);
    try { if (await install(item, opts)) ok++; }
    catch (err) { console.log('  ' + item.id + ': 失败 —— ' + err.message); }
  }
  console.log('完成 ' + ok + ' / ' + todo.length + '；重新运行 node tools/package.mjs 即可打进安装包。');
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
