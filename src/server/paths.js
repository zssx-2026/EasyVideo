/* EasyVideo - path resolution.
 *
 * Layout contract (all values overridable from ./data/settings.json):
 *
 *   <appRoot>            checkout / install directory (also the working dir)
 *   <appRoot>/data       ALL persistent app data (db, media, uploads, models,
 *                        recordings, backups, recycle bin, settings.json)
 *   <appRoot>/log        rolling application logs
 *   <tempRoot>/EasyVideo volatile cache only (segments, thumbnails, scratch)
 *
 * Works in three shapes:
 *   1. dev checkout            (node src/server/main.js)
 *   2. packaged SEA executable (process.execPath is the exe)
 *   3. installed app-image     (exe + app/ resources)
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Directory of this module, in both ESM (import.meta) and the bundled CJS build. */
function moduleDir() {
  try {
    if (typeof __dirname === 'string' && __dirname) return __dirname;
  } catch (err) { /* not CJS */ }
  try { return path.dirname(fileURLToPath(import.meta.url)); } catch (err) { return process.cwd(); }
}

export const IS_SEA = (() => {
  try {
    const sea = process.getBuiltinModule ? process.getBuiltinModule('node:sea') : null;
    return !!sea && typeof sea.isSea === 'function' && sea.isSea();
  } catch { return false; }
})();

function* ancestors(start) {
  let cur = path.resolve(start);
  for (let i = 0; i < 8; i++) {
    yield cur;
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
}

/** Find the directory that owns our resources (src/server, web/, data/). */
export function locateAppRoot() {
  // Release layout: <root>/app/EasyVideo.exe beside <root>/data and <root>/log.
  if (IS_SEA) {
    const exeDir = path.dirname(process.execPath);
    if (path.basename(exeDir).toLowerCase() === 'app') return path.dirname(exeDir);
  }
  const marks = ['src/server/main.js', 'package.json', 'src/web/index.html', 'data'];
  const seeds = [];
  if (IS_SEA) {
    seeds.push(path.dirname(process.execPath));
    seeds.push(process.cwd());
  } else {
    seeds.push(moduleDir());
    seeds.push(process.cwd());
  }
  for (const seed of seeds) {
    for (const dir of ancestors(seed)) {
      if (marks.some((m) => fs.existsSync(path.join(dir, m)))) return dir;
    }
  }
  return IS_SEA ? path.dirname(process.execPath) : process.cwd();
}

/** Volatile cache lives on the roomiest fixed drive unless overridden. */
function pickTempRoot() {
  const override = process.env.EV_TEMP_ROOT;
  if (override) return path.resolve(override);
  if (process.platform === 'win32') {
    const candidates = [];
    for (const letter of ['D', 'E', 'F', 'C']) {
      const drive = letter + ':' + String.fromCharCode(92);
      try {
        const st = fs.statfsSync(drive);
        const free = Number(st.bavail) * Number(st.bsize);
        if (free > 2 * 1024 ** 3) candidates.push({ drive, free });
      } catch { /* drive absent */ }
    }
    candidates.sort((a, b) => b.free - a.free);
    if (candidates.length) return path.join(candidates[0].drive, 'temp');
  }
  return os.tmpdir();
}

export const APP_ROOT = locateAppRoot();
export const TEMP_ROOT = pickTempRoot();

export const PATHS = {
  appRoot: APP_ROOT,
  tempRoot: TEMP_ROOT,
  work: APP_ROOT,
  data: path.join(APP_ROOT, 'data'),
  log: path.join(APP_ROOT, 'log'),
  web: path.join(APP_ROOT, 'src', 'web'),
  program: path.join(APP_ROOT, 'program'),
  plugins: path.join(APP_ROOT, 'program', 'plugins'),
  sourcecode: path.join(APP_ROOT, 'sourcecode'),

  settingsFile: path.join(APP_ROOT, 'data', 'settings.json'),
  database: path.join(APP_ROOT, 'data', 'easyvideo.db.json'),

  media: path.join(APP_ROOT, 'data', 'media'),
  uploads: path.join(APP_ROOT, 'data', 'uploads'),
  recordings: path.join(APP_ROOT, 'data', 'recordings'),
  models: path.join(APP_ROOT, 'data', 'models'),
  avatars: path.join(APP_ROOT, 'data', 'avatars'),
  backup: path.join(APP_ROOT, 'data', 'backup'),
  recycle: path.join(APP_ROOT, 'data', 'recycle'),
  cache: path.join(TEMP_ROOT, 'EasyVideo'),
  segments: path.join(TEMP_ROOT, 'EasyVideo', 'segments'),
  scratch: path.join(TEMP_ROOT, 'EasyVideo', 'scratch')
};

/** Directories that must exist before anything else runs. */
const REQUIRED = [
  'data', 'log', 'media', 'uploads', 'recordings', 'models', 'avatars',
  'backup', 'recycle', 'cache', 'segments', 'scratch',
  'program', 'plugins'
];

export function ensureDirs() {
  for (const key of REQUIRED) {
    try { fs.mkdirSync(PATHS[key], { recursive: true }); } catch { /* best effort */ }
  }
  return PATHS;
}

/** Re-point the mutable paths (data / log / cache) after settings.json loads. */
export function applyPathOverrides(overrides) {
  const o = overrides || {};
  const remap = (base, sub) => (base ? path.join(base, sub) : null);
  if (o.data) {
    PATHS.data = path.resolve(o.data);
    PATHS.settingsFile = path.join(PATHS.data, 'settings.json');
    PATHS.database = path.join(PATHS.data, 'easyvideo.db.json');
    PATHS.media = remap(PATHS.data, 'media');
    PATHS.uploads = remap(PATHS.data, 'uploads');
    PATHS.recordings = remap(PATHS.data, 'recordings');
    PATHS.models = remap(PATHS.data, 'models');
    PATHS.avatars = remap(PATHS.data, 'avatars');
    PATHS.backup = remap(PATHS.data, 'backup');
    PATHS.recycle = remap(PATHS.data, 'recycle');
  }
  if (o.log) PATHS.log = path.resolve(o.log);
  if (o.cache) {
    PATHS.cache = path.resolve(o.cache);
    PATHS.segments = path.join(PATHS.cache, 'segments');
    PATHS.scratch = path.join(PATHS.cache, 'scratch');
  }
  if (o.recordings) PATHS.recordings = path.resolve(o.recordings);
  return PATHS;
}

export const relTo = (p) => path.relative(APP_ROOT, p).split(path.sep).join('/');

export default PATHS;
