/* EasyVideo - durable JSON store with backups and a recycle bin. */
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import PATHS, { ensureDirs } from './paths.js';
import { readJson, writeJsonAtomic, moveToRecycle, uid, now, log } from './util.js';

const DB_FILE = () => path.join(PATHS.data, 'easyvideo.db.json');
const DB_BAK = () => path.join(PATHS.data, 'easyvideo.db.bak.json');

export function blankDb() {
  return {
    version: 1,
    createdAt: now(),
    currentAccountId: null,
    accounts: {},
    liveRooms: [],
    videos: [],
    drafts: [],
    collections: [],
    history: [],
    watchLater: [],
    favorites: [],
    friends: [],
    follows: [],
    comments: [],
    settings: {},
    privacy: {},
    counters: { live: 0, video: 0, draft: 0 }
  };
}

class Store extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(0);
    this.db = blankDb();
    this.dirty = false;
    this.flushTimer = null;
    this.backupTimer = null;
  }

  load() {
    ensureDirs();
    const loaded = readJson(DB_FILE(), null);
    if (loaded && typeof loaded === 'object') {
      this.db = Object.assign(blankDb(), loaded);
    } else {
      const bak = readJson(DB_BAK(), null);
      this.db = bak && typeof bak === 'object' ? Object.assign(blankDb(), bak) : blankDb();
      if (bak) log('store: primary db unreadable, restored from backup');
    }
    this.emit('loaded', this.db);
    return this.db;
  }

  touch(reason) {
    this.dirty = true;
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => { this.flushTimer = null; this.flush(reason || 'auto'); }, 400);
    if (this.flushTimer.unref) this.flushTimer.unref();
  }

  flush(reason) {
    if (!this.dirty) return false;
    try {
      const file = DB_FILE();
      if (fs.existsSync(file)) { try { fs.copyFileSync(file, DB_BAK()); } catch (e) { /* ignore */ } }
      writeJsonAtomic(file, this.db);
      this.dirty = false;
      this.emit('flushed', reason);
      return true;
    } catch (err) {
      log('store: flush failed:', err.message);
      return false;
    }
  }

  backup(label) {
    try {
      fs.mkdirSync(PATHS.backup, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const dest = path.join(PATHS.backup, 'easyvideo-' + stamp + (label ? '-' + label : '') + '.json');
      fs.writeFileSync(dest, JSON.stringify(this.db, null, 2), 'utf8');
      const files = fs.readdirSync(PATHS.backup).filter((f) => f.endsWith('.json')).sort();
      while (files.length > 20) {
        const victim = files.shift();
        moveToRecycle(path.join(PATHS.backup, victim), PATHS.recycle, 'backup-' + victim);
      }
      return dest;
    } catch (err) { log('store: backup failed:', err.message); return null; }
  }

  startBackupTimer(minutes) {
    const ms = Math.max(1, Number(minutes) || 30) * 60000;
    if (this.backupTimer) clearInterval(this.backupTimer);
    this.backupTimer = setInterval(() => { this.flush('timer'); this.backup('auto'); }, ms);
    if (this.backupTimer.unref) this.backupTimer.unref();
  }

  list(coll, filter) {
    const arr = Array.isArray(this.db[coll]) ? this.db[coll] : [];
    return filter ? arr.filter(filter) : arr;
  }

  find(coll, predicate) {
    return this.list(coll).find(predicate) || null;
  }

  insert(coll, record) {
    const rec = Object.assign({ id: uid(coll.slice(0, 3)), createdAt: now(), updatedAt: now() }, record);
    this.db[coll].unshift(rec);
    this.touch('insert:' + coll);
    this.emit('change', { coll, op: 'insert', record: rec });
    return rec;
  }

  update(coll, id, patch) {
    const rec = this.find(coll, (r) => r.id === id);
    if (!rec) return null;
    Object.assign(rec, patch, { updatedAt: now() });
    this.touch('update:' + coll);
    this.emit('change', { coll, op: 'update', record: rec });
    return rec;
  }

  remove(coll, id, soft) {
    const arr = this.db[coll];
    const idx = arr.findIndex((r) => r.id === id);
    if (idx < 0) return null;
    const rec = arr[idx];
    if (soft) { rec.deletedAt = now(); this.touch('soft-delete:' + coll); }
    else { arr.splice(idx, 1); this.touch('delete:' + coll); }
    this.emit('change', { coll, op: 'delete', record: rec });
    return rec;
  }

  nextSeq(key) {
    this.db.counters[key] = (this.db.counters[key] || 0) + 1;
    return this.db.counters[key];
  }

  close() {
    if (this.flushTimer) { clearTimeout(this.flushTimer); this.flushTimer = null; }
    this.flush('shutdown');
  }
}

export const store = new Store();
export default store;
