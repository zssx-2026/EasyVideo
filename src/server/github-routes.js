/* EasyVideo - GitHub endpoints.
 *
 *   GET    /api/github                  current identity + every signed-in one
 *   POST   /api/github/signin           { token, userId? } -> sign in
 *   POST   /api/github/verify           re-read the repo list to re-verify
 *   POST   /api/github/use              { userId } switch the active identity
 *   DELETE /api/github/:userId          sign out
 *   GET    /api/github/repos            repository list (the verification read)
 *   POST   /api/github/repo             ensure the target repository exists
 *   POST   /api/github/upload           raw body -> release asset
 *   GET    /api/github/uploads          upload jobs
 *   POST   /api/github/userid/new       mint a fresh user id
 */
import crypto from 'node:crypto';
import * as github from './github.js';
import * as upload from './github-upload.js';

export function mountGithub(R, H) {
  R.get('/api/github', H(async (ctx, req, res) => {
    res.json({
      ok: true,
      current: github.current(),
      identities: github.list(),
      pending: upload.jobList(10)
    });
  }));

  R.post('/api/github/userid/new', H(async (ctx, req, res) => {
    const id = github.newUserId();
    res.json({ ok: true, userId: id, repo: github.repoNameFor(id), bytes: Buffer.byteLength(id, 'utf8') });
  }));

  R.post('/api/github/signin', H(async (ctx, req, res) => {
    const body = ctx.body || {};
    const userId = body.userId || github.newUserId();
    const identity = await github.signIn(body.token, userId);
    res.json({ ok: true, identity: identity, userId: userId });
  }));

  R.post('/api/github/verify', H(async (ctx, req, res) => {
    const body = ctx.body || {};
    const identity = await github.verify(body.userId);
    res.json({ ok: true, identity: identity });
  }));

  R.post('/api/github/use', H(async (ctx, req, res) => {
    const identity = github.use((ctx.body || {}).userId);
    res.json({ ok: true, identity: identity });
  }));

  R.del('/api/github/:userId', H(async (ctx, req, res, p) => {
    const gone = github.signOut(p.userId);
    if (!gone) { const e = new Error('没有这个身份'); e.status = 404; throw e; }
    res.json({ ok: true, current: github.current() });
  }));

  R.get('/api/github/repos', H(async (ctx, req, res) => {
    const list = await github.repos(ctx.query.get('userId'));
    res.json({ ok: true, items: list, count: list.length });
  }));

  R.post('/api/github/repo', H(async (ctx, req, res) => {
    const out = await github.ensureRepo((ctx.body || {}).userId);
    res.json({ ok: true, created: out.created, repo: { name: out.repo.name, url: out.repo.html_url, private: !!out.repo.private } });
  }));

  /* Raw body -> release asset. Streaming: no buffering, no size ceiling but 2 GiB. */
  R.streamPost('/api/github/upload', H(async (ctx, req, res) => {
    const identity = github.raw(ctx.query.get('userId'));
    if (!identity) { const e = new Error('请先登录 GitHub'); e.status = 401; throw e; }
    const name = ctx.query.get('name') || 'upload.bin';
    const staged = await upload.stage(req, name);
    const job = await upload.push(staged, { userId: ctx.query.get('userId') });
    res.json({ ok: true, job: job });
  }));

  R.get('/api/github/uploads', H(async (ctx, req, res) => {
    const limit = Number(ctx.query.get('limit')) || 20;
    res.json({ ok: true, items: upload.jobList(limit) });
  }));

  R.get('/api/github/uploads/:id', H(async (ctx, req, res, p) => {
    const job = upload.jobById(p.id);
    if (!job) { const e = new Error('没有这个上传任务'); e.status = 404; throw e; }
    res.json({ ok: true, job: job });
  }));

  return R;
}

export default { mountGithub };

