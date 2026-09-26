#!/usr/bin/env node
/* EasyVideo release helper.
 *
 *   node tools/release.mjs --repo=owner/name              draft release
 *   node tools/release.mjs --repo=owner/name --publish    publish it
 *   node tools/release.mjs --dry-run                      local checks only
 *
 * Auth: a logged-in gh CLI, or GH_TOKEN / GITHUB_TOKEN with repo scope.
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const has = (n) => argv.indexOf(n) >= 0;
function opt(name, fallback) {
  const pre = name + '=';
  for (const a of argv) if (a.indexOf(pre) === 0) return a.slice(pre.length);
  return fallback;
}
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const VERSION = opt('--version', process.env.EV_VERSION || pkg.version || '1.0.0');
const LABEL = opt('--label', process.env.EV_LABEL || ('v' + String(VERSION).replace('-', '')));
const DRY = has('--dry-run');
const PUBLISH = has('--publish');
const step = (t) => console.log('[release] ' + t);
function fail(t) { console.error('[release] ' + t); process.exit(1); }

function findGh() {
  try { execFileSync('gh', ['--version'], { stdio: 'ignore' }); return 'gh'; }
  catch (err) { return null; }
}
function git(args, extra) {
  return execFileSync('git', args, Object.assign({ cwd: root, encoding: 'utf8' }, extra || {}));
}
function inferRepo() {
  try {
    const url = git(['remote', 'get-url', 'origin']).trim();
    const m = url.match(/github[.]com[:/]([^/]+)[/]([^/.]+?)(?:[.]git)?$/);
    return m ? m[1] + '/' + m[2] : null;
  } catch (err) { return null; }
}

async function api(method, endpoint, body, token) {
  const res = await fetch('https://api.github.com' + endpoint, {
    method: method,
    headers: {
      accept: 'application/vnd.github+json',
      authorization: 'Bearer ' + token,
      'user-agent': 'EasyVideo-release',
      'content-type': 'application/json'
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let data = text;
  try { data = text ? JSON.parse(text) : null; } catch (err) { /* keep raw */ }
  if (!res.ok) {
    const why = data && data.message ? data.message : ('HTTP ' + res.status);
    throw new Error(method + ' ' + endpoint + ' -> ' + why);
  }
  return data;
}

async function uploadAsset(token, repo, releaseId, file) {
  const name = path.basename(file);
  const url = 'https://uploads.github.com/repos/' + repo + '/releases/' + releaseId + '/assets?name=' + encodeURIComponent(name);
  const res = await fetch(url, {
    method: 'POST',
    headers: { authorization: 'Bearer ' + token, 'content-type': 'application/octet-stream', 'user-agent': 'EasyVideo-release' },
    body: fs.readFileSync(file)
  });
  if (!res.ok) fail('upload failed for ' + name + ': HTTP ' + res.status);
  step('uploaded ' + name);
}

function collectArtifacts() {
  const setup = path.join(root, 'installer', 'EasyVideo-' + LABEL + '-Setup.exe');
  const exe = path.join(root, 'app', 'EasyVideo.exe');
  const files = [];
  for (const f of [setup, exe]) {
    if (!fs.existsSync(f)) fail('missing artifact: ' + path.relative(root, f) + ' - run node build.mjs and node tools/package.mjs first');
    files.push(f);
    step(path.basename(f) + '  ' + (fs.statSync(f).size / 1048576).toFixed(2) + ' MiB');
  }
  const sums = files.map(function (f) {
    const sha = crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
    return sha + '  ' + path.basename(f);
  });
  const sumsFile = path.join(root, 'installer', 'SHA256SUMS-' + LABEL + '.txt');
  fs.writeFileSync(sumsFile, sums.join(String.fromCharCode(10)) + String.fromCharCode(10), 'utf8');
  files.push(sumsFile);
  step('wrote ' + path.basename(sumsFile));
  return files;
}

async function main() {
  const files = collectArtifacts();

  const notes = path.join(root, 'RELEASE.md');
  if (!fs.existsSync(notes)) fail('RELEASE.md is missing');

  const repo = opt('--repo', process.env.EV_REPO || inferRepo());
  if (!repo) fail('no target repo: pass --repo=owner/name, set EV_REPO, or add a git origin remote');
  step('repo ' + repo);

  if (DRY) { step('dry-run: skipping every remote call'); return; }

  const gh = findGh();
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '';
  if (!gh && !token) fail('no credentials: run gh auth login, or export GH_TOKEN / GITHUB_TOKEN with repo scope');

  try { git(['rev-parse', '--git-dir']); }
  catch (err) { step('git init'); git(['init', '-b', 'main']); }

  if (gh) {
    step('create repo with gh (an existing repo is fine)');
    try {
      execFileSync(gh, ['repo', 'create', repo, '--public', '--source', root, '--remote', 'origin', '--description', 'EasyVideo - streaming live and video app'], { cwd: root, stdio: 'inherit' });
    } catch (err) { step('repo create skipped'); }
  } else {
    step('create repo over the REST API');
    const parts = repo.split('/');
    try {
      const me = await api('GET', '/user', null, token);
      const endpoint = me && me.login === parts[0] ? '/user/repos' : '/orgs/' + parts[0] + '/repos';
      await api('POST', endpoint, { name: parts[1], description: 'EasyVideo - streaming live and video app', private: false, auto_init: false }, token);
      step('repo created');
    } catch (err) { step('repo create skipped: ' + err.message); }
  }

  step('commit and push');
  git(['add', '-A']);
  try { git(['commit', '-m', 'EasyVideo ' + LABEL], { stdio: 'ignore' }); }
  catch (err) { step('nothing to commit'); }
  try { git(['tag', '-a', LABEL, '-m', 'EasyVideo ' + LABEL], { stdio: 'ignore' }); }
  catch (err) { step('tag already exists'); }
  try { git(['remote', 'get-url', 'origin'], { stdio: 'ignore' }); }
  catch (err) { git(['remote', 'add', 'origin', 'https://github.com/' + repo + '.git']); }
  git(['push', '-u', 'origin', 'HEAD']);
  git(['push', 'origin', LABEL]);
  step('pushed ' + LABEL);

  step('create release' + (PUBLISH ? '' : ' (draft)'));
  const title = 'EasyVideo ' + LABEL;
  if (gh) {
    const args = ['release', 'create', LABEL, '--repo', repo, '--title', title, '--notes-file', notes];
    if (!PUBLISH) args.push('--draft');
    for (const f of files) args.push(f);
    execFileSync(gh, args, { cwd: root, stdio: 'inherit' });
  } else {
    const body = fs.readFileSync(notes, 'utf8');
    const release = await api('POST', '/repos/' + repo + '/releases', { tag_name: LABEL, name: title, body: body, draft: !PUBLISH, prerelease: /pre/i.test(LABEL) }, token);
    for (const f of files) await uploadAsset(token, repo, release.id, f);
  }

  step('done: https://github.com/' + repo + '/releases/tag/' + LABEL);
}

main().catch(function (err) { console.error('[release] FAILED: ' + (err && err.message ? err.message : err)); process.exit(1); });

