/* EasyVideo - store.js
 * A very small observable state container: one object, one subscribe(), no
 * diffing library. Views read from it and re-render on change.
 */

import { api, setAccountId } from './api.js';

const listeners = new Set();

export const state = {
  ready: false,
  account: null,
  accounts: [],
  counts: { live: 0, video: 0, history: 0, later: 0, favorites: 0, friends: 0, drafts: 0 },
  settings: null,
  privacy: null,
  transport: null,
  hub: null,
  paths: null,
  counters: null,
  liveCache: [],
  videoCache: []
};

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function notify(patch) {
  if (patch) Object.assign(state, patch);
  for (const fn of listeners) {
    try { fn(state); } catch (err) { console.warn('store listener failed', err); }
  }
}

/** Load /api/bootstrap into state. Safe to call repeatedly. */
export async function bootstrap() {
  const data = await api.bootstrap();
  setAccountId(data.account ? data.account.id : null);
  notify({
    account: data.account || null,
    accounts: data.accounts || [],
    counts: Object.assign({}, state.counts, data.counts || {}),
    settings: data.settings || null,
    privacy: data.privacy || null,
    transport: data.transport || null,
    hub: data.hub || null,
    paths: data.paths || null,
    ready: true
  });
  return data;
}

export async function refreshMe() {
  const data = await api.me();
  notify({
    account: data.account || state.account,
    privacy: data.privacy || state.privacy,
    settings: data.settings || state.settings,
    counters: data.counters || null
  });
  return data;
}

export async function refreshCounts() {
  try {
    const data = await api.bootstrap();
    setAccountId(data.account ? data.account.id : null);
    notify({
      counts: Object.assign({}, state.counts, data.counts || {}),
      account: data.account || state.account,
      accounts: data.accounts || state.accounts,
      transport: data.transport || state.transport,
      hub: data.hub || state.hub,
      settings: data.settings || state.settings,
      privacy: data.privacy || state.privacy
    });
  } catch { /* offline is fine - keep the last known counters */ }
}

/* ---- local resume list: makes '#/home/' continue-watching honest ---- */

const RESUME_KEY = 'ev.resume.v1';

export function rememberPlayback(entry) {
  try {
    const rows = readResume().filter((r) => !(r.kind === entry.kind && r.pid === entry.pid));
    rows.unshift(Object.assign({ at: Date.now() }, entry));
    localStorage.setItem(RESUME_KEY, JSON.stringify(rows.slice(0, 12)));
  } catch { /* private mode: ignore */ }
}

export function readResume() {
  try {
    const raw = JSON.parse(localStorage.getItem(RESUME_KEY) || '[]');
    return Array.isArray(raw) ? raw : [];
  } catch { return []; }
}

export function clearResume() {
  try { localStorage.removeItem(RESUME_KEY); } catch { /* ignore */ }
}

export default { state, subscribe, notify, bootstrap, refreshMe, refreshCounts };
