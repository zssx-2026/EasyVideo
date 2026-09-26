/* EasyVideo - FFmpeg bridge and watch-page transcoding ladder.
 *
 * Two jobs live here:
 *
 *   1. Locate a usable ffmpeg/ffprobe. The packaged EXE ships none, so the
 *      resolver looks at program/ffmpeg, the app root, PATH, then the usual
 *      winget / scoop / chocolatey install points. Nothing is bundled and no
 *      download happens without the user asking.
 *
 *   2. Turn a source video into the qualities the watch page offers
 *      (360P / 480P / 720P / 1080P / 2K / 4K) with the encoder the user picked
 *      (AV1 / H.264 / H.265 / H.266 / AMF / NVIDIA / AOM AV1 / SVT-AV1 / soft).
 *      A ladder render is a long job, so it runs detached and reports through
 *      data/transcodes.json, which the settings and watch pages poll.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import PATHS from './paths.js';
import logger from './logger.js';
import { readJson, writeJsonAtomic, uid, now } from './util.js';
import * as components from './components.js';

const log = logger.child('ffmpeg');
const STATE_FILE = () => path.join(PATHS.data, 'transcodes.json');

/* ------------------------------------------------------------- discovery */

const EXE = process.platform === 'win32' ? '.exe' : '';

function candidateDirs() {
  const dirs = [
    path.join(PATHS.program, 'ffmpeg'),
    path.join(PATHS.program, 'ffmpeg', 'bin'),
    path.join(PATHS.appRoot, 'ffmpeg'),
    path.join(PATHS.appRoot, 'ffmpeg', 'bin'),
    path.join(PATHS.appRoot, 'tools', 'ffmpeg')
  ];
  if (process.env.LOCALAPPDATA) {
    dirs.push(path.join(process.env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links'));
    dirs.push(path.join(process.env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Packages'));
  }
  if (process.env.ProgramData) {
    dirs.push(path.join(process.env.ProgramData, 'chocolatey', 'bin'));
  }
  if (process.env.USERPROFILE) {
    dirs.push(path.join(process.env.USERPROFILE, 'scoop', 'shims'));
  }
  return dirs;
}

function findInDirs(name) {
  for (const dir of candidateDirs()) {
    const direct = path.join(dir, name + EXE);
    try { if (fs.existsSync(direct) && fs.statSync(direct).isFile()) return direct; } catch (err) { /* keep looking */ }
    try {
      if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) continue;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const nested = path.join(dir, entry.name, 'bin', name + EXE);
        try { if (fs.existsSync(nested)) return nested; } catch (err) { /* next */ }
      }
    } catch (err) { /* unreadable dir */ }
  }
  return null;
}

let cached = null;

/** Resolve ffmpeg/ffprobe once and memoise the answer. */
export function locate(refresh) {
  if (cached && !refresh) return cached;
  const bundled = components.ffmpegPaths();
  if (bundled.ffmpeg) {
    cached = { ffmpeg: bundled.ffmpeg, ffprobe: bundled.ffprobe, source: 'component' };
    log.info('ffmpeg from component:', bundled.ffmpeg);
    return cached;
  }
  const found = { ffmpeg: findInDirs('ffmpeg'), ffprobe: findInDirs('ffprobe'), source: 'scan' };
  if (!found.ffmpeg) {
    const fromPath = process.env.PATH || '';
    for (const part of fromPath.split(path.delimiter)) {
      if (!part) continue;
      const guess = path.join(part, 'ffmpeg' + EXE);
      try { if (fs.existsSync(guess)) { found.ffmpeg = guess; break; } } catch (err) { /* next */ }
    }
  }
  if (found.ffmpeg) found.source = 'found';
  cached = found;
  log.info('ffmpeg:', found.ffmpeg || '(not found)', '| ffprobe:', found.ffprobe || '(not found)');
  return found;
}

export function available() {
  const found = locate();
  return { ok: !!found.ffmpeg, ffmpeg: found.ffmpeg, ffprobe: found.ffprobe, installHint: installHint() };
}

function installHint() {
  return [
    'ffmpeg 未找到。任选一种方式安装后再试：',
    '  winget install Gyan.FFmpeg',
    '  choco install ffmpeg',
    '  scoop install ffmpeg',
    '或把 ffmpeg.exe / ffprobe.exe 放进 ' + path.join(PATHS.program, 'ffmpeg') + '。'
  ].join(String.fromCharCode(10));
}

/* ------------------------------------------------------------ encoders */

/** Quality ladder: label -> long edge in pixels. Source is never upscaled. */
export const LADDER = [
  { label: '360P', short: 360, kbps: 800 },
  { label: '480P', short: 480, kbps: 1400 },
  { label: '720P', short: 720, kbps: 2800 },
  { label: '1080P', short: 1080, kbps: 5000 },
  { label: '2K', short: 1440, kbps: 9000 },
  { label: '4K', short: 2160, kbps: 20000 }
];

export const BITRATE_FACTOR = {
  lowest: 0.35, low: 0.6, mid: 0.85, high: 1, ultra: 1.5, lossless: 2.4
};

/** Encoder table: label -> { args, software } */
export const ENCODERS = {
  auto: { args: ['-c:v', 'libx264', '-preset', 'medium'], software: true, label: '自动（软件 H.264）' },
  h264: { args: ['-c:v', 'libx264', '-preset', 'medium'], software: true, label: 'H.264' },
  h265: { args: ['-c:v', 'libx265', '-preset', 'medium'], software: true, label: 'H.265' },
  h266: { args: ['-c:v', 'libvvenc'], software: true, label: 'H.266' },
  av1: { args: ['-c:v', 'libaom-av1', '-cpu-used', '4'], software: true, label: 'AV1（AOM）' },
  aom: { args: ['-c:v', 'libaom-av1', '-cpu-used', '4'], software: true, label: 'AOM AV1' },
  svt: { args: ['-c:v', 'libsvtav1', '-preset', '7'], software: true, label: 'SVT-AV1' },
  amf: { args: ['-c:v', 'h264_amf', '-quality', 'balanced'], software: false, label: 'AMD AMF' },
  nvenc: { args: ['-c:v', 'h264_nvenc', '-preset', 'p5'], software: false, label: 'NVIDIA NVENC' },
  sw: { args: ['-c:v', 'libx264', '-preset', 'medium'], software: true, label: '软件' }
};

export const AUDIO_ARGS = {
  aac: ['-c:a', 'aac', '-b:a', '160k'],
  alac: ['-c:a', 'alac'],
  flac: ['-c:a', 'flac'],
  opus: ['-c:a', 'libopus', '-b:a', '128k'],
  pcm: ['-c:a', 'pcm_s16le']
};

export function encoderFor(key) {
  return ENCODERS[key] || ENCODERS.auto;
}

export function bitrateFactor(key) {
  const f = BITRATE_FACTOR[key];
  return typeof f === 'number' ? f : 1;
}

/** Target long edge for a ladder entry, never above the source height. */
export function targetHeight(short, sourceHeight) {
  const src = Number(sourceHeight) || 0;
  if (!src) return short;
  return Math.min(short, src);
}

/** Scale + bitrate argument list for one ladder rung. */
export function rungArgs(rung, sourceHeight, opts) {
  const o = opts || {};
  const height = targetHeight(rung.short, sourceHeight);
  const factor = bitrateFactor(o.bitrate);
  const kbps = Math.max(160, Math.round(rung.kbps * factor));
  const encoder = encoderFor(o.videoCodec);
  const audio = AUDIO_ARGS[o.audioCodec] || AUDIO_ARGS.aac;
  const args = [
    '-vf', 'scale=-2:' + height,
    '-b:v', kbps + 'k',
    '-maxrate', Math.round(kbps * 1.35) + 'k',
    '-bufsize', Math.round(kbps * 2.5) + 'k'
  ];
  if (o.fps) args.push('-r', String(o.fps));
  if (o.volumeLevel) args.push('-af', 'loudnorm=I=-16:TP=-1.5:LRA=11');
  return { height, kbps, args: args.concat(encoder.args, audio) };
}

/* -------------------------------------------------------------- probing */

/** Probe a media file with ffprobe; resolves { width, height, durationSec, fps, codec }. */
export function probe(file) {
  const found = locate();
  return new Promise((resolve) => {
    if (!found.ffprobe) { resolve(null); return; }
    const args = ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,r_frame_rate,codec_name,duration', '-of', 'json', file];
    execFile(found.ffprobe, args, { timeout: 20000, windowsHide: true }, (err, stdout) => {
      if (err) { resolve(null); return; }
      try {
        const parsed = JSON.parse(stdout);
        const stream = (parsed.streams && parsed.streams[0]) || {};
        const rate = String(stream.r_frame_rate || '30/1').split('/');
        const fps = rate.length === 2 ? Math.round(Number(rate[0]) / Math.max(1, Number(rate[1]))) : 30;
        resolve({
          width: Number(stream.width) || 0, height: Number(stream.height) || 0,
          durationSec: Math.round(Number(stream.duration) || 0),
          fps: fps || 30, codec: stream.codec_name || ''
        });
      } catch (e) { resolve(null); }
    });
  });
}

/* ------------------------------------------------------------- job store */

function blankState() {
  return { version: 1, jobs: [] };
}

function readState() {
  const raw = readJson(STATE_FILE(), null);
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.jobs)) return blankState();
  return raw;
}

function writeState(state) {
  state.jobs = state.jobs.slice(-200);
  writeJsonAtomic(STATE_FILE(), state);
  return state;
}

export function jobs() {
  const state = readState();
  const live = state.jobs.filter((j) => j.status === 'running');
  for (const job of live) {
    if (!job.pid) continue;
    try { process.kill(job.pid, 0); } catch (err) {
      job.status = 'stale';
      job.finishedAt = job.finishedAt || now();
    }
  }
  return state.jobs.slice().sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
}

export function jobById(id) {
  return jobs().find((j) => j.id === id) || null;
}

export function cancelJob(id) {
  const state = readState();
  const job = state.jobs.find((j) => j.id === id);
  if (!job) return false;
  try { if (job.pid) process.kill(job.pid); } catch (err) { /* already gone */ }
  job.status = 'cancelled';
  job.finishedAt = now();
  writeState(state);
  return true;
}

/* ------------------------------------------------------------ job start */

/**
 * Render a ladder from a local source file. Returns the job record. The render
 * itself is detached: ffmpeg writes each rung next to the source in
 * data/media/renders/<jobId>/ and progress is polled from the filesystem.
 */
export function renderLadder(input, opts) {
  const o = opts || {};
  const found = locate();
  if (!found.ffmpeg) throw new Error('ffmpeg 未安装：' + installHint());
  if (!input || !fs.existsSync(input)) throw new Error('找不到源文件：' + input);

  const state = readState();
  const job = {
    id: uid('job'),
    kind: 'ladder',
    status: 'running',
    input: input,
    sourceHeight: Number(o.sourceHeight) || 0,
    videoCodec: o.videoCodec || 'auto',
    audioCodec: o.audioCodec || 'aac',
    bitrate: o.bitrate || 'high',
    fps: Number(o.fps) || 0,
    volumeLevel: !!o.volumeLevel,
    rungs: [],
    outDir: path.join(PATHS.media, 'renders', ''),
    startedAt: now(),
    finishedAt: null,
    log: [],
    pid: null
  };
  job.outDir = path.join(PATHS.media, 'renders', job.id);
  fs.mkdirSync(job.outDir, { recursive: true });

  const wanted = Array.isArray(o.rungs) && o.rungs.length ? o.rungs : LADDER;
  job.rungs = wanted.map((r) => ({ label: r.label, short: r.short, file: null, status: 'pending' }));

  state.jobs.push(job);
  writeState(state);

  // One detached ffmpeg per rung, started sequentially by a tiny shell step.
  const script = [];
  for (let i = 0; i < wanted.length; i++) {
    const rung = wanted[i];
    const plan = rungArgs(rung, job.sourceHeight, job);
    const out = path.join(job.outDir, rung.label + '.mp4');
    job.rungs[i].file = out;
    const args = ['-y', '-i', input, '-vf', 'scale=-2:' + plan.height].concat(
      plan.args.slice(2),
      ['-movflags', '+faststart', out]
    );
    script.push({ index: i, file: out, args: args });
  }
  writeState(state);

  // Spawn a small node helper so the parent stays responsive.
  const helper = path.join(PATHS.scratch, 'render-' + job.id + '.mjs');
  const helperSrc = [
    'import { spawn } from ' + JSON.stringify('node:child_process') + ';',
    'import fs from ' + JSON.stringify('node:fs') + ';',
    'const ffmpeg = ' + JSON.stringify(found.ffmpeg) + ';',
    'const steps = ' + JSON.stringify(script) + ';',
    'const stateFile = ' + JSON.stringify(STATE_FILE()) + ';',
    'const jobId = ' + JSON.stringify(job.id) + ';',
    'function patch(fn) {',
    '  const raw = JSON.parse(fs.readFileSync(stateFile, "utf8"));',
    '  const job = raw.jobs.find(function (j) { return j.id === jobId; });',
    '  if (job) fn(job);',
    '  fs.writeFileSync(stateFile, JSON.stringify(raw, null, 2), "utf8");',
    '}',
    'patch(function (job) { job.pid = process.pid; });',
    '(async function () {',
    '  for (const step of steps) {',
    '    patch(function (job) { job.rungs[step.index].status = "running"; job.log.push("start " + step.index); });',
    '    const code = await new Promise(function (resolve) {',
    '      const child = spawn(ffmpeg, step.args, { stdio: "ignore", windowsHide: true });',
    '      child.on("exit", resolve);',
    '      child.on("error", function () { resolve(-1); });',
    '    });',
    '    const size = fs.existsSync(step.file) ? fs.statSync(step.file).size : 0;',
    '    patch(function (job) {',
    '      job.rungs[step.index].status = code === 0 && size > 0 ? "done" : "failed";',
    '      job.rungs[step.index].bytes = size;',
    '      job.log.push((code === 0 ? "done " : "fail ") + step.index);',
    '    });',
    '  }',
    '  patch(function (job) { job.status = "done"; job.finishedAt = Date.now(); });',
    '})();',
    ''
  ].join(String.fromCharCode(10));
  fs.writeFileSync(helper, helperSrc, 'utf8');

  const child = spawn(process.execPath, [helper], { detached: true, stdio: 'ignore', windowsHide: true });
  child.unref();
  log.info('ladder job', job.id, 'started for', path.basename(input));
  return job;
}

export function summary() {
  const found = locate();
  const list = jobs();
  return {
    available: !!found.ffmpeg,
    ffmpeg: found.ffmpeg,
    ffprobe: found.ffprobe,
    installHint: found.ffmpeg ? null : installHint(),
    encoders: Object.keys(ENCODERS).map((k) => ({ key: k, label: ENCODERS[k].label, software: ENCODERS[k].software })),
    ladder: LADDER,
    bitrates: BITRATE_FACTOR,
    running: list.filter((j) => j.status === 'running').length,
    total: list.length
  };
}

export default { locate, available, probe, LADDER, ENCODERS, encoderFor, rungArgs, renderLadder, jobs, jobById, cancelJob, summary, targetHeight, bitrateFactor };
