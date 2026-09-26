/* EasyVideo - 组件（完全自包含的依赖）。
 *
 * prompt.txt 第 142 行：成品 App 与组件分别放在 /EasyVideo/program/ 与
 * /EasyVideo/program/plugins/。所有依赖以组件形式自带，不再依赖系统 PATH：
 *
 *   program/ffmpeg/ffmpeg.exe   转码（FFmpeg, LGPL/GPL）
 *   program/ffmpeg/ffprobe.exe  媒体探测
 *   program/aria2/aria2c.exe    多连接下载（aria2, GPL-2.0）
 *   program/7zip/7z.exe         压缩与解压（7-Zip, LGPL）
 *   program/node/node.exe       独立运行时（Node.js, MIT）
 *   program/zstd/zstd.exe       插件与主题包解压（Zstandard, BSD-3）
 *
 * 这里只做“发现 + 版本 + 路径”，运行时零外联；下载由 tools/fetch-components.mjs
 * 用开源渠道（winget / 官方发布页）完成。
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import PATHS from './paths.js';

/** 每个组件：目录、可执行文件、版本参数、许可与上游地址。 */
export const CATALOG = [
  { id: 'ffmpeg', label: 'FFmpeg', dir: 'ffmpeg', exe: 'ffmpeg.exe', versionArg: '-version', license: 'LGPL/GPL', home: 'https://ffmpeg.org/', purpose: '画质梯度转码、实时渲染' },
  { id: 'ffprobe', label: 'FFprobe', dir: 'ffmpeg', exe: 'ffprobe.exe', versionArg: '-version', license: 'LGPL/GPL', home: 'https://ffmpeg.org/', purpose: '媒体元数据探测' },
  { id: 'aria2', label: 'aria2', dir: 'aria2', exe: 'aria2c.exe', versionArg: '--version', license: 'GPL-2.0', home: 'https://aria2.github.io/', purpose: '多连接上传下载加速' },
  { id: '7zip', label: '7-Zip', dir: '7zip', exe: '7za.exe', versionArg: '', license: 'LGPL', home: 'https://7-zip.org/', purpose: '压缩包解压与打包' },
  { id: 'node', label: 'Node.js', dir: 'node', exe: 'node.exe', versionArg: '-v', license: 'MIT', home: 'https://nodejs.org/', purpose: '独立运行时（插件宿主）' },
  { id: 'zstd', label: 'Zstandard', dir: 'zstd', exe: 'zstd.exe', versionArg: '--version', license: 'BSD-3', home: 'https://facebook.github.io/zstd/', purpose: '插件与主题包（.zst）解压' }
];

const found = new Map();

/** 组件的搜索根：program/ 与 program/plugins/。 */
export function roots() {
  return [PATHS.program, PATHS.plugins].filter(Boolean);
}

function probe(exe, arg) {
  return new Promise(function (resolve) {
    if (!arg) { resolve(null); return; }
    try {
      execFile(exe, [arg], { windowsHide: true, timeout: 6000 }, function (err, stdout) {
        if (err && !stdout) { resolve(null); return; }
        const text = String(stdout || '').split(String.fromCharCode(10))[0].trim();
        resolve(text.slice(0, 90) || null);
      });
    } catch (err) { resolve(null); }
  });
}

/** 找一次并缓存：id -> 绝对路径。 */
export function locate(refresh) {
  if (found.size && !refresh) return found;
  found.clear();
  for (const item of CATALOG) {
    for (const base of roots()) {
      const dir = path.join(base, item.dir);
      const exe = path.join(dir, item.exe);
      try {
        if (fs.existsSync(exe) && fs.statSync(exe).isFile()) { found.set(item.id, exe); break; }
      } catch (err) { /* keep looking */ }
    }
  }
  return found;
}

export function exePath(id) { return locate().get(id) || null; }
export function dirOf(id) { const e = exePath(id); return e ? path.dirname(e) : null; }
export function has(id) { return !!exePath(id); }

/** 一次完整的组件巡检。 */
export async function scan(refresh) {
  const map = locate(refresh);
  const items = [];
  let present = 0;
  for (const item of CATALOG) {
    const exe = map.get(item.id) || null;
    if (exe) present++;
    items.push({ id: item.id, label: item.label, purpose: item.purpose, license: item.license, home: item.home, present: !!exe, file: exe, dir: exe ? path.dirname(exe) : path.join(PATHS.program, item.dir) });
  }
  return { items: items, present: present, total: CATALOG.length, roots: roots(), program: PATHS.program, plugins: PATHS.plugins, complete: present === CATALOG.length };
}

/** 与 ffmpeg.js 对接：它可以直接用这里的路径。 */
export function ffmpegPaths() {
  return { ffmpeg: exePath('ffmpeg'), ffprobe: exePath('ffprobe') };
}

/** 启动时把缺失组件写进日志。 */
export function describe() {
  const missing = CATALOG.filter(function (c) { return !exePath(c.id); }).map(function (c) { return c.id; });
  return { present: CATALOG.length - missing.length, total: CATALOG.length, missing: missing };
}

export default { CATALOG, locate, exePath, dirOf, has, scan, ffmpegPaths, describe, roots };
