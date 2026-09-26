/* EasyVideo - upload acceleration.
 *
 * 上传加速：复用用户自己放进 uploadtool/ 的开源加速器（FastGithub、
 * Steam++ / Watt Toolkit），无窗口后台运行，可设置开机自动后台上传。
 *
 * 本模块只启动用户已经放好的程序，绝不自行下载，也不修改二进制；
 * 隐藏窗口靠 spawn 的 windowsHide + detached，而不是补丁。
 *
 *   uploadtool/Fastgithub/fastgithub.exe     FastGithub 无窗口主程序（MIT）
 *   uploadtool/Fastgithub/FastGithub.UI.exe 其窗口前端
 *   uploadtool/SteamTools/Steam++.exe        Steam++ / Watt Toolkit（GPL-3.0）
 *
 * 状态写在 data/uploader.json，重启后仍然记得选择；
 * 开机自启由应用自身实现：启动时若 autostart 打开且存在加速器，静默拉起一次。
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import PATHS from './paths.js';
import logger from './logger.js';
import { readJson, writeJsonAtomic } from './util.js';

const log = logger.child('uploader');
const STATE = () => path.join(PATHS.data, 'uploader.json');

/** 已知加速器，按优先级排列。 */
export const ACCELERATORS = [
  { id: 'fastgithub', label: 'FastGithub', dirs: ['uploadtool/Fastgithub'], exe: 'fastgithub.exe', args: [] },
  { id: 'fastgithub-ui', label: 'FastGithub UI', dirs: ['uploadtool/Fastgithub'], exe: 'FastGithub.UI.exe', args: [] },
  { id: 'steampp', label: 'Steam++ / Watt Toolkit', dirs: ['uploadtool/SteamTools', 'uploadtool/Steam++'], exe: 'Steam++.exe', args: ['-silence'] }
];

const running = new Map();

function blank() {
  return { version: 1, enabled: false, accelerator: null, autostart: false, headless: true, lastStart: null, lastError: null };
}

export function state() {
  const raw = readJson(STATE(), null);
  if (!raw || typeof raw !== 'object') return blank();
  return Object.assign(blank(), raw);
}

function save(patch) {
  const next = Object.assign(state(), patch || {});
  writeJsonAtomic(STATE(), next);
  return next;
}

/** 找到加速器可执行文件的绝对路径，找不到返回 null。 */
export function locate(id) {
  for (const acc of ACCELERATORS) {
    if (id && acc.id !== id) continue;
    for (const dir of acc.dirs) {
      const abs = path.join(PATHS.appRoot, dir.split('/').join(path.sep), acc.exe);
      try {
        if (fs.existsSync(abs) && fs.statSync(abs).isFile()) return { accelerator: acc, file: abs, dir: path.dirname(abs) };
      } catch (err) { /* keep looking */ }
    }
  }
  return null;
}

export function available() {
  const items = ACCELERATORS.map(function (acc) {
    const hit = locate(acc.id);
    return { id: acc.id, label: acc.label, present: !!hit, file: hit ? hit.file : null, running: running.has(acc.id) };
  });
  return { items: items, any: items.some(function (x) { return x.present; }) };
}

export function isRunning() {
  return [...running.keys()];
}

/** 无窗口启动加速器。 */
export function start(id) {
  const hit = locate(id || state().accelerator || undefined);
  if (!hit) throw new Error('uploadtool 里没有找到可用的加速器');
  if (running.has(hit.accelerator.id)) return { started: false, already: true, id: hit.accelerator.id, file: hit.file };
  const cfg = state();
  const args = cfg.headless ? hit.accelerator.args : [];
  const child = spawn(hit.file, args, { cwd: hit.dir, detached: true, stdio: 'ignore', windowsHide: true });
  child.unref();
  running.set(hit.accelerator.id, { pid: child.pid, file: hit.file, at: Date.now() });
  if (child.pid) child.on('exit', function () { running.delete(hit.accelerator.id); });
  save({ accelerator: hit.accelerator.id, lastStart: Date.now(), lastError: null, enabled: true });
  log.info('accelerator started:', hit.accelerator.id, 'pid', child.pid);
  return { started: true, id: hit.accelerator.id, file: hit.file, pid: child.pid, args: args };
}

/** 停止由我们启动的加速器。 */
export function stop(id) {
  const key = id || state().accelerator;
  const live = running.get(key);
  if (!live) return { stopped: false, reason: 'not-running' };
  try { process.kill(live.pid); } catch (err) { /* already gone */ }
  running.delete(key);
  save({ enabled: false });
  log.info('accelerator stopped:', key);
  return { stopped: true, id: key };
}

export function configure(patch) {
  const next = save(patch || {});
  if (next.enabled && !running.size) {
    try { start(next.accelerator || undefined); } catch (err) { save({ lastError: err.message }); }
  }
  if (!next.enabled && running.size) stop();
  return Object.assign(next, { running: isRunning() });
}

/** 启动时调用一次：遵守 autostart，且不阻塞启动流程。 */
export function autostart() {
  const cfg = state();
  if (!cfg.autostart) return { skipped: 'autostart-off' };
  try {
    const r = start(cfg.accelerator || undefined);
    return { autostarted: true, id: r.id };
  } catch (err) {
    save({ lastError: err.message });
    return { autostarted: false, error: err.message };
  }
}

/** 发布表单用的上传预估。 */
export function uploadPlan(fileBytes) {
  const bytes = Number(fileBytes) || 0;
  const mb = bytes / 1048576;
  const cfg = state();
  return {
    bytes: bytes,
    megabytes: Number(mb.toFixed(2)),
    accelerator: cfg.accelerator,
    acceleratorRunning: running.size > 0,
    autostart: !!cfg.autostart,
    estimateSec: Math.max(1, Math.round(mb / 6)),
    note: running.size > 0 ? '加速器已在后台运行，上传会走加速通道。' : '未启动加速器；大文件建议先在设置里开启。'
  };
}

export default { ACCELERATORS, state, available, locate, start, stop, configure, autostart, isRunning, uploadPlan };
