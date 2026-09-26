/* EasyVideo - release packaging.
 *
 *   node tools/package.mjs
 *
 * 产物布局：
 *   app/EasyVideo.exe            自包含 SEA 可执行文件
 *   app/README.txt app/version.json
 *   data/ log/ program/ sourcecode/
 *   installer/build/             NSIS 中间产物（payload、hashes.nsh、.nsi）
 *   installer/EasyVideo-<label>-Setup.exe
 *
 * 每个文件的 SHA-256 在打包时算出并写进 hashes.nsh，安装时落到
 * HKCU/Software/EasyVideo/Files，供“修复”与校验使用。
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { buildNsi } from './installer-nsi.mjs';

const here = path.dirname(url.fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const appDir = path.join(root, 'app');
const installerDir = path.join(root, 'installer');
const buildDir = path.join(installerDir, 'build');
const payloadDir = path.join(buildDir, 'payload');
const distExe = path.join(root, 'dist', 'EasyVideo.exe');
const appExe = path.join(appDir, 'EasyVideo.exe');

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const VERSION = process.env.EV_VERSION || pkg.version || '1.0.0';
const LABEL = process.env.EV_LABEL || ('v' + String(VERSION).replace('-', ''));
const QUAD = (String(VERSION).match(/[0-9]+([.][0-9]+)*/) || ['1.0.0'])[0].split('.');
while (QUAD.length < 4) QUAD.push('0');
const VI = QUAD.slice(0, 4).join('.');

function step(text) { console.log('[package] ' + text); }

function findMakensis() {
  const candidates = ['C:/Program Files (x86)/NSIS/makensis.exe', 'C:/Program Files/NSIS/makensis.exe'];
  for (const c of candidates) { if (fs.existsSync(c)) return c; }
  return null;
}

/** 递归列出目录里的所有文件（POSIX 相对路径）。 */
function walk(dir, base, out) {
  const prefix = base || '';
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const rel = prefix ? prefix + '/' + entry.name : entry.name;
    if (entry.isDirectory()) walk(full, rel, out);
    else if (entry.isFile()) out.push({ full: full, rel: rel });
  }
  return out;
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

/** 短暂自旋，避开“目标被占用”的复制竞态（只用在打包脚本里）。 */
function pause(ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) { /* spin */ }
}

function copyWithRetry(from, to) {
  for (let attempt = 0; attempt < 8; attempt++) {
    try { fs.copyFileSync(from, to); return; }
    catch (err) {
      try { fs.rmSync(to, { force: true }); } catch (e) { /* next */ }
      if (attempt === 7) throw err;
      pause(700);
    }
  }
}

function stageApp() {
  if (!fs.existsSync(distExe)) throw new Error('dist/EasyVideo.exe 不存在，请先运行 node build.mjs');
  fs.mkdirSync(appDir, { recursive: true });
  copyWithRetry(distExe, appExe);
  step('app/EasyVideo.exe  ' + (fs.statSync(appExe).size / 1048576).toFixed(1) + ' MiB');

  const readme = [
    'EasyVideo ' + LABEL,
    '',
    '流式直播与视频应用（P2P / BT / SERVER 三种传输模式）。',
    '',
    '启动：双击 app/EasyVideo.exe',
    '访问：http://localhost:13750/',
    '协议：ev://live/<昵称>/<PID>   ev://video/<昵称>/<PID>',
    '',
    '命令行：',
    '  EasyVideo.exe -b     后台启动（不打开浏览器）',
    '  EasyVideo.exe -br    后台启动，稍后自动打开界面',
    '  EasyVideo.exe -nob   启动但不打开浏览器',
    '  ev                   安装时勾选 PATH 注册后，可在任意位置启动',
    '',
    '数据目录：../data/    日志目录：../log/',
    '组件目录：../program/（ffmpeg、aria2、7z、node、zstd）',
    '插件目录：../program/plugins/（.zst / .evp 包）',
    '临时缓存：%TEMP%/EasyVideo/',
    ''
  ].join(String.fromCharCode(10));
  fs.writeFileSync(path.join(appDir, 'README.txt'), readme, 'utf8');

  for (const rel of ['data', 'log', 'program', 'program/plugins', 'sourcecode']) {
    fs.mkdirSync(path.join(root, rel), { recursive: true });
  }
  step('data/ log/ program/ program/plugins/ sourcecode/ ready');
}

/** installer/build/payload —— 安装时先解到缓存的就是这一份。 */
function stagePayload() {
  fs.rmSync(payloadDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(payloadDir, 'app'), { recursive: true });
  fs.copyFileSync(appExe, path.join(payloadDir, 'app', 'EasyVideo.exe'));
  fs.copyFileSync(path.join(appDir, 'README.txt'), path.join(payloadDir, 'app', 'README.txt'));

  // ev.cmd 装在 <install>/bin，作为 `ev` 命令；由这里生成，避免在 NSIS 里拼引号。
  const binDir = path.join(payloadDir, 'bin');
  fs.mkdirSync(binDir, { recursive: true });
  const evCmd = [
    '@echo off',
    'setlocal',
    'set "EVEXE=%~dp0..\\app\\EasyVideo.exe"',
    'if not exist "%EVEXE%" (',
    '  echo EasyVideo 未找到: %EVEXE%',
    '  exit /b 1',
    ')',
    'start "" "%EVEXE%" %*',
    'exit /b 0',
    ''
  ].join(String.fromCharCode(13) + String.fromCharCode(10));
  fs.writeFileSync(path.join(binDir, 'ev.cmd'), evCmd, 'utf8');
  step('ev.cmd staged');

  const programSrc = path.join(root, 'program');
  if (fs.existsSync(programSrc)) {
    const files = walk(programSrc, '', []);
    for (const item of files) {
      const target = path.join(payloadDir, 'program', item.rel.split('/').join(path.sep));
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(item.full, target);
    }
    step('payload: app/ + program/ (' + files.length + ' 个文件)');
  } else {
    step('payload: app/ only —— program/ 为空，运行 tools/fetch-components.mjs 可补齐');
  }
}

function payloadHashes() {
  const files = walk(payloadDir, '', []);
  return files.map((f) => ({ rel: f.rel, sha256: sha256(f.full), bytes: fs.statSync(f.full).size }));
}

function writeManifest(hashes) {
  fs.mkdirSync(appDir, { recursive: true });
  fs.mkdirSync(installerDir, { recursive: true });
  const programDir = path.join(root, 'program');
  const manifest = {
    app: 'EasyVideo',
    version: VERSION,
    label: LABEL,
    builtAt: new Date().toISOString(),
    port: 13750,
    executable: 'app/EasyVideo.exe',
    dataDir: 'data',
    logDir: 'log',
    programDir: 'program',
    pluginsDir: 'program/plugins',
    sourceDir: 'sourcecode',
    protocols: ['ev'],
    transport: ['SERVER', 'P2P', 'BT'],
    flags: [
      { flag: '-b', meaning: '后台启动，不打开浏览器' },
      { flag: '-br', meaning: '后台启动，延迟后打开界面' },
      { flag: '-nob', meaning: '启动但不打开浏览器' }
    ],
    components: fs.existsSync(programDir)
      ? fs.readdirSync(programDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)
      : [],
    files: hashes
  };
  fs.writeFileSync(path.join(appDir, 'version.json'), JSON.stringify(manifest, null, 2), 'utf8');
  fs.writeFileSync(path.join(installerDir, 'version.json'), JSON.stringify(manifest, null, 2), 'utf8');
  step('version.json written (' + hashes.length + ' 个文件哈希)');
}

function buildInstaller(hashes) {
  fs.mkdirSync(buildDir, { recursive: true });
  // 图标与 payload 都要和 .nsi 同目录：NSIS 的相对路径以脚本位置为准。
  fs.copyFileSync(path.join(root, 'assets', 'img', 'icon.ico'), path.join(buildDir, 'icon.ico'));
  const nsiPath = path.join(buildDir, 'EasyVideo.nsi');
  const info = buildNsi({
    label: LABEL,
    version: VERSION,
    quad: VI,
    outFile: nsiPath,
    outFileName: 'EasyVideo-' + LABEL + '-Setup.exe',
    templateDir: path.join(installerDir, 'template'),
    hashes: hashes
  });
  step('installer/build/EasyVideo.nsi  ' + info.lines + ' 行 / ' + info.files + ' 个哈希');

  const makensis = findMakensis();
  if (!makensis) {
    step('makensis 未找到 —— 未安装 NSIS，.nsi 已就绪可手动编译');
    return null;
  }
  const target = path.join(buildDir, 'EasyVideo-' + LABEL + '-Setup.exe');
  const result = execFileSync(makensis, ['/V2', nsiPath], { cwd: buildDir, encoding: 'utf8' });
  if (result) process.stdout.write(result);
  if (!fs.existsSync(target)) throw new Error('makensis 结束但 ' + target + ' 不存在');
  // 交付物放 installer/ 根目录，中间产物留在 installer/build/。
  const shipping = path.join(installerDir, 'EasyVideo-' + LABEL + '-Setup.exe');
  fs.copyFileSync(target, shipping);
  step('installer/EasyVideo-' + LABEL + '-Setup.exe  ' + (fs.statSync(shipping).size / 1048576).toFixed(1) + ' MiB');
  return shipping;
}

stageApp();
stagePayload();
const hashes = payloadHashes();
writeManifest(hashes);
const built = buildInstaller(hashes);
console.log('[package] done: ' + LABEL + (built ? '' : ' (installer not compiled)'));
