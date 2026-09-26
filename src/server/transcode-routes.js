/* EasyVideo - transcoding routes.
 *
 *   GET    /api/ffmpeg                resolver + encoder ladder + job counts
 *   POST   /api/ffmpeg/refresh        re-scan for ffmpeg
 *   POST   /api/ffmpeg/probe          { file } or { videoId } -> stream metadata
 *   GET    /api/ffmpeg/jobs           all ladder jobs
 *   GET    /api/ffmpeg/jobs/:id       one job
 *   POST   /api/ffmpeg/jobs           { videoId | file, rungs, codec... } -> job
 *   DELETE /api/ffmpeg/jobs/:id       cancel
 *   GET    /api/qualities/:videoId    which ladder rungs already exist on disk
 */
import fs from 'node:fs';
import path from 'node:path';
import * as ffmpeg from './ffmpeg.js';
import PATHS from './paths.js';

/** Resolve a stored file name to an absolute path inside data/media. */
function mediaFile(name) {
  const raw = String(name || '');
  let safe = '';
  for (const ch of raw) if (ch !== '/' && ch !== String.fromCharCode(92)) safe += ch;
  if (!safe) return null;
  const abs = path.join(PATHS.media, safe);
  try { return fs.existsSync(abs) ? abs : null; } catch (err) { return null; }
}

/** Source file of a published video: first part that lives on disk. */
function sourceOf(store, videoId) {
  const video = store.find('videos', videoId);
  if (!video) return { video: null, file: null };
  for (const part of video.files || []) {
    const candidate = part.stored || part.name;
    const abs = candidate ? mediaFile(candidate) : null;
    if (abs) return { video: video, file: abs };
  }
  return { video: video, file: null };
}

/** Which rungs exist under data/media/renders/<jobId>/<label>.mp4. */
function rungsFor(videoId) {
  const dir = path.join(PATHS.media, 'renders');
  const out = [];
  try {
    if (!fs.existsSync(dir)) return out;
    for (const job of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!job.isDirectory()) continue;
      const jobDir = path.join(dir, job.name);
      for (const file of fs.readdirSync(jobDir)) {
        if (!file.endsWith('.mp4')) continue;
        const abs = path.join(jobDir, file);
        let size = 0;
        try { size = fs.statSync(abs).size; } catch (err) { size = 0; }
        if (!size) continue;
        out.push({
          label: file.slice(0, -4), file: abs, size: size, jobId: job.name,
          url: '/media/renders/' + job.name + '/' + file
        });
      }
    }
  } catch (err) { /* unreadable render dir */ }
  return out;
}

export function mountTranscode(R, H, deps) {
  const store = deps.store;

  R.get('/api/ffmpeg', H(async (ctx, req, res) => {
    res.json(Object.assign({ ok: true }, ffmpeg.summary()));
  }));

  R.post('/api/ffmpeg/refresh', H(async (ctx, req, res) => {
    ffmpeg.locate(true);
    res.json(Object.assign({ ok: true }, ffmpeg.summary()));
  }));

  R.post('/api/ffmpeg/probe', H(async (ctx, req, res) => {
    const body = ctx.body || {};
    let file = body.file ? mediaFile(body.file) : null;
    let video = null;
    if (!file && body.videoId) {
      const found = sourceOf(store, body.videoId);
      file = found.file;
      video = found.video;
    }
    if (!file) throw Object.assign(new Error('find no media file'), { status: 404 });
    const info = await ffmpeg.probe(file);
    if (!info) throw Object.assign(new Error('ffprobe unavailable'), { status: 503 });
    res.json({
      ok: true, file: path.basename(file), info: info,
      video: video ? { id: video.id, pid: video.pid, title: video.title } : null,
      rungs: rungsFor(video ? video.id : null)
    });
  }));

  R.get('/api/ffmpeg/jobs', H(async (ctx, req, res) => {
    res.json({ ok: true, items: ffmpeg.jobs() });
  }));

  R.get('/api/ffmpeg/jobs/:id', H(async (ctx, req, res) => {
    const job = ffmpeg.jobById(req.params.id);
    if (!job) throw Object.assign(new Error('no such job'), { status: 404 });
    res.json({ ok: true, job: job });
  }));

  R.post('/api/ffmpeg/jobs', H(async (ctx, req, res) => {
    const body = ctx.body || {};
    let file = body.file ? mediaFile(body.file) : null;
    let video = null;
    if (!file && body.videoId) {
      const found = sourceOf(store, body.videoId);
      file = found.file;
      video = found.video;
    }
    if (!file) throw Object.assign(new Error('find no source video'), { status: 404 });
    const wanted = Array.isArray(body.rungs) && body.rungs.length
      ? ffmpeg.LADDER.filter((r) => body.rungs.indexOf(r.label) >= 0)
      : ffmpeg.LADDER;
    const job = ffmpeg.renderLadder(file, {
      sourceHeight: body.sourceHeight || (video ? video.height : 0) || 0,
      videoCodec: body.videoCodec || 'auto',
      audioCodec: body.audioCodec || 'aac',
      bitrate: body.bitrate || 'high',
      fps: body.fps || 0,
      volumeLevel: !!body.volumeLevel,
      rungs: wanted
    });
    res.json({ ok: true, job: job, video: video ? { id: video.id, pid: video.pid } : null });
  }));

  R.del('/api/ffmpeg/jobs/:id', H(async (ctx, req, res) => {
    const done = ffmpeg.cancelJob(req.params.id);
    if (!done) throw Object.assign(new Error('no such job'), { status: 404 });
    res.json({ ok: true });
  }));

  R.get('/api/qualities/:videoId', H(async (ctx, req, res) => {
    const found = sourceOf(store, req.params.videoId);
    if (!found.video) throw Object.assign(new Error('no such video'), { status: 404 });
    res.json({
      ok: true,
      videoId: found.video.id,
      original: found.file ? { file: path.basename(found.file), url: '/media/' + encodeURIComponent(path.basename(found.file)) } : null,
      rungs: rungsFor(found.video.id)
    });
  }));

  return R;
}

export default { mountTranscode };
