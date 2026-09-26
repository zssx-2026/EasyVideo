/* EasyVideo - ./data/settings.json: the single human-editable settings file.
 *
 * Standalone on purpose (no imports from util/logger) so it can be loaded
 * before the logger and the store exist. Every mutation is written atomically
 * and immediately, so the file on disk is always the truth.
 */

import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import PATHS, { APP_ROOT, TEMP_ROOT, applyPathOverrides } from './paths.js';

export const DEFAULT_SETTINGS = {
  version: 1,
  app: {
    name: 'EasyVideo',
    port: 13750,
    host: '127.0.0.1',
    autoOpenBrowser: true,
    registerEvProtocol: true,
    singleInstance: true,
    tray: true,
    minimizeToTray: true,
    closeToTray: true,
    startMinimized: false,
    logLevel: 'info',
    logToConsole: true,
    logMaxFiles: 14,
    backupEveryMinutes: 30,
    backupKeep: 20
  },
  paths: {
    data: null,
    log: null,
    cache: null
  },
  transport: {
    defaultMode: 'BT',
    segmentBytes: 262144,
    maxUploadPeers: 12,
    trackerUrls: []
  },
  currentAccountId: null,
  accounts: {},
  privacy: {}
};

function deepMerge(base, patch) {
  const out = Array.isArray(base) ? base.slice() : Object.assign({}, base);
  for (const [k, v] of Object.entries(patch || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && base && typeof base[k] === 'object' && !Array.isArray(base[k])) {
      out[k] = deepMerge(base[k], v);
    } else if (v !== undefined) {
      out[k] = v;
    }
  }
  return out;
}

class Config extends EventEmitter {
  constructor() {
    super();
    this.file = PATHS.settingsFile;
    this.data = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
    this.loaded = false;
  }

  load() {
    let raw = null;
    try { raw = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { raw = null; }
    this.data = deepMerge(DEFAULT_SETTINGS, raw || {});
    this.loaded = true;
    // settings.json may itself relocate data/ and log/ - apply before anyone reads them.
    if (this.data.paths && (this.data.paths.data || this.data.paths.log || this.data.paths.cache)) {
      applyPathOverrides(this.data.paths);
      this.file = PATHS.settingsFile;
    }
    if (!fs.existsSync(this.file)) this.save();
    this.emit('loaded', this.data);
    return this.data;
  }

  save() {
    const dir = path.dirname(this.file);
    try { fs.mkdirSync(dir, { recursive: true }); } catch { /* ignore */ }
    const tmp = path.join(dir, '.' + path.basename(this.file) + '.' + process.pid + '.tmp');
    try {
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8');
      fs.renameSync(tmp, this.file);
      this.emit('saved', this.data);
      return true;
    } catch (err) {
      try { fs.rmSync(tmp, { force: true }); } catch { /* ignore */ }
      return false;
    }
  }

  get(section, key, fallback) {
    if (key === undefined) return this.data[section];
    const sec = this.data[section];
    if (!sec || sec[key] === undefined) return fallback;
    return sec[key];
  }

  set(section, key, value) {
    if (!this.data[section] || typeof this.data[section] !== 'object') this.data[section] = {};
    if (key === undefined) this.data[section] = value;
    else this.data[section][key] = value;
    this.save();
    return this.data[section];
  }

  merge(section, patch) {
    this.data[section] = deepMerge(this.data[section] || {}, patch || {});
    this.save();
    return this.data[section];
  }

  /* ---- per-account settings + privacy ---- */

  accountSettings(accountId, fallback) {
    if (!accountId) return fallback || null;
    const all = this.data.accounts || {};
    if (!all[accountId]) all[accountId] = {};
    return Object.assign(all[accountId], fallback || {});
  }

  setAccountSettings(accountId, patch) {
    if (!accountId) return null;
    const all = this.data.accounts || (this.data.accounts = {});
    all[accountId] = deepMerge(all[accountId] || {}, patch || {});
    this.save();
    return all[accountId];
  }

  accountPrivacy(accountId, fallback) {
    if (!accountId) return fallback || null;
    const all = this.data.privacy || {};
    if (!all[accountId]) all[accountId] = {};
    return Object.assign(all[accountId], fallback || {});
  }

  setAccountPrivacy(accountId, patch) {
    if (!accountId) return null;
    const all = this.data.privacy || (this.data.privacy = {});
    all[accountId] = deepMerge(all[accountId] || {}, patch || {});
    this.save();
    return all[accountId];
  }

  /** Absolute paths actually in use, for the settings screen. */
  describe() {
    return {
      file: this.file,
      appRoot: APP_ROOT,
      tempRoot: TEMP_ROOT,
      data: PATHS.data,
      log: PATHS.log,
      cache: PATHS.cache,
      media: PATHS.media,
      uploads: PATHS.uploads,
      recordings: PATHS.recordings,
      models: PATHS.models,
      backup: PATHS.backup,
      recycle: PATHS.recycle
    };
  }
}

export const config = new Config();
export default config;
