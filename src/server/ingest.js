/* EasyVideo - 直播切片存储（主机推流 / 观众拉流共用）。
 *
 * 主机把编码后的切片 POST 到 /api/transport/segment/:streamId/:index，观众 GET 同一路径。
 * 三种模式共用这套切片，区别只在谁转发：SERVER 由主机直接给，P2P 推给每个观众，
 * BT 谁有谁发。切片落在缓存目录，房间结束或删除时清掉。
 */
import fs from 'node:fs';
import path from 'node:path';
import PATHS from './paths.js';
import logger from './logger.js';
import * as transport from './transport.js';

const log = logger.child('ingest');

/** 单片上限：8 MiB 足够 4K 两秒，也挡得住恶意大包。 */
export const MAX_SEGMENT_BYTES = 8 * 1024 * 1024;

/** 每个流最多留这么多片，超出从头丢，缓存占用有上界。 */
export const MAX_SEGMENTS_PER_STREAM = 900;

/** 一次最多取几片，避免观众一口气要 900 片。 */
export const BATCH_LIMIT = 8;

function safeId(value) {
  return String(value === undefined || value === null ? '' : value).replace(/[^A-Za-z0-9_-]/g, '_');
}

export function segmentDir(streamId) {
  return path.join(PATHS.cache, 'segments', safeId(streamId));
}

export function segmentFile(streamId, index) {
  const n = Math.max(0, Math.floor(Number(index) || 0));
  return path.join(segmentDir(streamId), n + '.bin');
}

/** 把流上的切片序号集合准备好。 */
function track(streamId) {
  const stream = transport.getStream(streamId);
  if (!stream) return null;
  if (!stream.segmentSet) stream.segmentSet = new Set();
  return stream;
}

/** 写入一片，返回 { index, bytes, total }。 */
export function writeSegment(streamId, index, buffer) {
  const stream = track(streamId);
  if (!stream) { const e = new Error('直播已结束'); e.status = 410; throw e; }
  if (!buffer || !buffer.length) { const e = new Error('切片为空'); e.status = 400; throw e; }
  if (buffer.length > MAX_SEGMENT_BYTES) { const e = new Error('切片过大'); e.status = 413; throw e; }
  const n = Number(index);
  if (!Number.isFinite(n) || n < 0) { const e = new Error('切片序号无效'); e.status = 400; throw e; }
  fs.mkdirSync(segmentDir(streamId), { recursive: true });
  fs.writeFileSync(segmentFile(streamId, n), buffer);
  stream.segmentSet.add(n);
  stream.publisherAt = Date.now();
  stream.segmentCount = Math.max(stream.segmentCount || 0, n + 1);
  // 也喂给 transport，P2P/BT 的 have/want 调度才有片可指。
  try { transport.publishSegment(streamId, n, buffer); } catch (err) { log.warn('publishSegment failed:', err.message); }
  // 只留最近的一段，磁盘占用有上界。
  while (stream.segmentSet.size > MAX_SEGMENTS_PER_STREAM) {
    const oldest = Math.min.apply(null, [...stream.segmentSet]);
    stream.segmentSet.delete(oldest);
    try { fs.rmSync(segmentFile(streamId, oldest), { force: true }); } catch (err) { /* ignore */ }
  }
  return { index: n, bytes: buffer.length, total: stream.segmentSet.size };
}

/** 读一片，没有就返回 null。 */
export function readSegment(streamId, index) {
  const file = segmentFile(streamId, index);
  try { return fs.existsSync(file) ? fs.readFileSync(file) : null; } catch (err) { return null; }
}

/** 缓存里已有的切片序号，升序。 */
export function segmentIndex(streamId) {
  const dir = segmentDir(streamId);
  let onDisk = [];
  try {
    if (fs.existsSync(dir)) {
      onDisk = fs.readdirSync(dir).filter((f) => f.endsWith('.bin'))
        .map((f) => Number(f.slice(0, -4))).filter((n) => Number.isFinite(n));
    }
  } catch (err) { /* ignore */ }
  const stream = transport.getStream(streamId);
  const tracked = stream && stream.segmentSet ? [...stream.segmentSet] : [];
  const all = [...new Set(onDisk.concat(tracked))].sort((a, b) => a - b);
  return {
    count: all.length,
    first: all.length ? all[0] : null,
    last: all.length ? all[all.length - 1] : null,
    recent: all.slice(-40)
  };
}

/** 房间结束 / 删除时清理。 */
export function clearStream(streamId) {
  try { fs.rmSync(segmentDir(streamId), { recursive: true, force: true }); return true; }
  catch (err) { return false; }
}

export default {
  MAX_SEGMENT_BYTES, MAX_SEGMENTS_PER_STREAM, BATCH_LIMIT,
  segmentDir, segmentFile, writeSegment, readSegment, segmentIndex, clearStream
};
