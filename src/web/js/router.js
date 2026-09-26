/* EasyVideo - router.js
 * Hash router. Routes are declared as segment patterns and matched in order,
 * so /live/secret/:nick/:pid/ wins over /live/:nick/:pid/. Every route path
 * ends in a trailing slash; anything unknown falls back to #/home/.
 */

const routes = [];
let current = null;
let onNav = null;

/** Register a route: pattern('/live/secret/:nick/:pid/'). */
export function route(pattern, handler, meta) {
  const parts = pattern.split('/').filter(Boolean);
  routes.push({ pattern, parts, handler, meta: meta || {} });
}

/** Build a hash href, encoding every segment. */
export function href(pattern, params) {
  let out = pattern;
  for (const [k, v] of Object.entries(params || {})) out = out.replace(':' + k, encodeURIComponent(String(v)));
  return '#' + out;
}

export function navigate(path, replace) {
  const target = '#' + String(path || '/home/').replace(/^#?/, '');
  if (location.hash === target) { handle(); return; }
  if (replace) location.replace(target);
  else location.hash = target;
}

function normalise(hash) {
  let path = String(hash || '').replace(/^#/, '');
  if (!path || path === '/') path = '/home/';
  if (!path.startsWith('/')) path = '/' + path;
  if (!path.endsWith('/')) path += '/';
  return path;
}

function match(path) {
  const segs = path.split('/').filter(Boolean);
  for (const r of routes) {
    if (r.parts.length !== segs.length) continue;
    const params = {};
    let ok = true;
    for (let i = 0; i < r.parts.length; i++) {
      const p = r.parts[i];
      if (p.startsWith(':')) params[p.slice(1)] = decodeURIComponent(segs[i]);
      else if (p !== segs[i]) { ok = false; break; }
    }
    if (ok) return { route: r, params, path };
  }
  return null;
}

export function currentRoute() { return current; }

export async function dispatch() { return handle(); }

async function handle() {
  const path = normalise(location.hash);
  const hit = match(path);
  const target = hit || match('/home/');
  current = { path, pattern: target.route.pattern, params: target.params, meta: target.route.meta };
  if (onNav) onNav(current);
  try {
    await target.route.handler(target.params, current);
  } catch (err) {
    console.error('route handler failed', err);
    const host = document.getElementById('view');
    if (host) host.innerHTML = '<div class="view-error">页面渲染失败：' + String(err && err.message ? err.message : err) + '</div>';
  }
}

/** Start listening. navHook runs before each handler (rail highlighting). */
export function startRouter(navHook) {
  onNav = navHook || null;
  window.addEventListener('hashchange', handle);
  handle();
}

/** Intercept in-app clicks on [data-href] elements anywhere in the document. */
export function bindLinkDelegate() {
  document.addEventListener('click', (ev) => {
    const link = ev.target.closest('a[href^="#/"], [data-href]');
    if (!link) return;
    const raw = link.getAttribute('data-href') || link.getAttribute('href') || '';
    if (!raw.startsWith('#')) return;
    ev.preventDefault();
    navigate(raw.slice(1));
  });
}

export default { route, href, navigate, startRouter, bindLinkDelegate, currentRoute };
