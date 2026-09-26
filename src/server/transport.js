/* EasyVideo - streaming transport core.
 *
 * Three modes share one contract: a *stream* is an ordered list of fixed-size
 * segments identified by (streamId, index). A peer either serves segments from
 * disk (origin) or fetches them from the swarm. The mode only changes WHO is
 * asked for a segment and HOW the request travels:
 *
 *   SERVER  one authoritative origin (an EasyVideo host on the LAN/WAN) serves
 *           every segment over HTTP. Lowest CPU, needs one fat uplink.
 *   P2P     single-producer mesh: the origin pushes every segment to every
 *           viewer over a WebRTC-style data channel. Uplink cost is O(viewers).
 *   BT      swarm: the origin seeds segment 0..k and every viewer that holds a
 *           segment re-serves it. Uplink cost per viewer approaches O(1) and
 *           throughput grows with the swarm.
 *
 * Signalling rides the app's own WebSocket hub, so no external tracker is
 * needed; if a room sets one, TRACKER URLs are advertised to peers as fallback.
 */

import { EventEmitter } from 'node:events';
import { uid, now, sha256, log, clamp } from './util.js';

export const SEGMENT_BYTES = 256 * 1024; // 256 KiB per segment
export const MODES = ['SERVER', 'P2P', 'BT'];

/** Peers we know about, keyed by peerId. */
const peers = new Map();
/** Live streams, keyed by streamId. */
const streams = new Map();

export function registerPeer(peerId, socket, meta) {
  const existing = peers.get(peerId);
  if (existing) {
    existing.socket = socket;
    existing.meta = Object.assign(existing.meta, meta || {});
    existing.lastSeen = now();
    return existing;
  }
  const peer = {
    id: peerId,
    socket,
    meta: meta || {},
    joinedAt: now(),
    lastSeen: now(),
    /** streams this peer is publishing */
    publishing: new Set(),
    /** streamId -> Set(segment index) this peer can serve */
    has: new Map(),
    /** measured stats */
    stats: { sent: 0, received: 0, rttMs: 0, upstreamKbps: 0 }
  };
  peers.set(peerId, peer);
  return peer;
}

export function dropPeer(peerId) {
  const peer = peers.get(peerId);
  if (!peer) return;
  peers.delete(peerId);
  for (const stream of streams.values()) {
    stream.viewers.delete(peerId);
    stream.publishers.delete(peerId);
  }
}

export function peerList() {
  return [...peers.values()].map((p) => ({
    id: p.id,
    name: p.meta.name || p.id.slice(0, 6),
    publishing: [...p.publishing],
    stats: p.stats,
    lastSeen: p.lastSeen
  }));
}

/**
 * Announce a stream. mode drives the scheduler used by consumers.
 * opts: { mode, roomId, ownerId, title, segmentCount, bitrateKbps, serverUrl }
 */
export function openStream(opts) {
  const stream = {
    id: opts.id || uid('str'),
    mode: MODES.includes(opts.mode) ? opts.mode : 'P2P',
    roomId: opts.roomId || null,
    ownerId: opts.ownerId || null,
    title: opts.title || '',
    segmentCount: Number(opts.segmentCount) || 0,
    bitrateKbps: Number(opts.bitrateKbps) || 0,
    serverUrl: opts.serverUrl || null,
    trackers: opts.trackers || [],
    createdAt: now(),
    startedAt: now(),
    endedAt: null,
    viewers: new Set(),
    publishers: new Set(),
    /** segment index -> { sha, size, holders:Set(peerId), at } */
    segments: new Map(),
    events: new EventEmitter()
  };
  streams.set(stream.id, stream);
  log('stream open', stream.id, stream.mode, 'room=' + (stream.roomId || '-'));
  return stream;
}

export function getStream(id) { return streams.get(id) || null; }

export function closeStream(id, reason) {
  const s = streams.get(id);
  if (!s) return null;
  s.endedAt = now();
  s.endReason = reason || 'closed';
  s.events.emit('closed', s.endReason);
  streams.delete(id);
  log('stream close', id, s.endReason);
  return s;
}

export function liveStreams() {
  return [...streams.values()].map((s) => ({
    id: s.id, mode: s.mode, roomId: s.roomId, title: s.title,
    viewers: s.viewers.size, publishers: s.publishers.size,
    segmentCount: s.segments.size, bitrateKbps: s.bitrateKbps,
    startedAt: s.startedAt, serverUrl: s.serverUrl
  }));
}

/** Origin side: publish a segment into the swarm. */
export function publishSegment(streamId, index, buffer) {
  const stream = streams.get(streamId);
  if (!stream) return null;
  const rec = {
    index: Number(index),
    sha: sha256(buffer),
    size: buffer.length,
    holders: new Set([stream.ownerId].filter(Boolean)),
    at: now()
  };
  stream.segments.set(rec.index, rec);
  stream.segmentCount = Math.max(stream.segmentCount, rec.index + 1);
  stream.events.emit('segment', rec);

  // BT: everyone who has it may now serve it; P2P: only the origin serves.
  const offer = { t: 'seg-offer', streamId, index: rec.index, sha: rec.sha, size: rec.size };
  for (const viewerId of stream.viewers) {
    if (stream.mode === 'BT' || viewerId !== stream.ownerId) sendTo(viewerId, offer);
  }
  return rec;
}

export function markHolder(streamId, peerId, index) {
  const stream = streams.get(streamId);
  if (!stream) return;
  const rec = stream.segments.get(Number(index));
  if (!rec) return;
  rec.holders.add(peerId);
  const peer = peers.get(peerId);
  if (peer) {
    if (!peer.has.has(streamId)) peer.has.set(streamId, new Set());
    peer.has.get(streamId).add(Number(index));
  }
}

export function sendTo(peerId, payload) {
  const peer = peers.get(peerId);
  if (!peer || !peer.socket) return false;
  try {
    peer.socket.send(JSON.stringify(payload));
    return true;
  } catch (err) {
    log('sendTo failed', peerId, err.message);
    return false;
  }
}

export function broadcast(payload, filter) {
  let n = 0;
  for (const peer of peers.values()) {
    if (filter && !filter(peer)) continue;
    if (sendTo(peer.id, payload)) n++;
  }
  return n;
}

/**
 * Pick who to ask for a missing segment.
 *  SERVER : the configured origin only.
 *  P2P    : the origin (mesh producer).
 *  BT     : rarest-first among holders, preferring peers with headroom.
 */
export function selectProvider(stream, index, excludePeerId) {
  if (stream.mode === 'SERVER') return { kind: 'server', url: stream.serverUrl };
  const rec = stream.segments.get(Number(index));
  const candidates = rec
    ? [...rec.holders].filter((p) => p && p !== excludePeerId && peers.has(p))
    : [];
  if (stream.mode === 'P2P' || candidates.length === 0) {
    return stream.ownerId ? { kind: 'peer', peerId: stream.ownerId } : { kind: 'server', url: stream.serverUrl };
  }
  candidates.sort((a, b) => {
    const pa = peers.get(a); const pb = peers.get(b);
    return (pa ? pa.stats.sent : Infinity) - (pb ? pb.stats.sent : Infinity);
  });
  return { kind: 'peer', peerId: candidates[0] };
}

/** Swarm health snapshot used by the UI. */
export function swarmStats(streamId) {
  const s = streams.get(streamId);
  if (!s) return null;
  const perPeer = [];
  for (const pid of s.viewers) {
    const p = peers.get(pid);
    perPeer.push({
      id: pid,
      name: p ? (p.meta.name || pid.slice(0, 6)) : pid.slice(0, 6),
      segments: p && p.has.has(streamId) ? p.has.get(streamId).size : 0,
      sent: p ? p.stats.sent : 0,
      received: p ? p.stats.received : 0
    });
  }
  const coverage = s.segments.size === 0 ? 0 : clamp(
    perPeer.reduce((acc, p) => acc + p.segments, 0) / (s.segments.size * Math.max(1, perPeer.length)), 0, 1);
  return {
    id: s.id, mode: s.mode, viewers: perPeer.length,
    segments: s.segments.size, coverage, peers: perPeer,
    /** P2P uplink is O(viewers); BT uplink is O(1) after the first few peers. */
    originUplinkShare: s.mode === 'P2P' ? 1 : s.mode === 'BT' ? clamp(2 / Math.max(2, perPeer.length), 0, 1) : 0
  };
}

/** Estimate the origin uplink a room needs, in Mbps. */
export function uplinkEstimate(mode, bitrateKbps, viewers) {
  const br = Number(bitrateKbps) || 0;
  const n = Math.max(1, Number(viewers) || 1);
  if (mode === 'SERVER') return br * n / 1000;
  if (mode === 'P2P') return br * n / 1000;
  return br * Math.min(n, 3) / 1000; // BT: fan-out is shared by the swarm
}

export function transportSummary() {
  return {
    modes: MODES,
    segmentBytes: SEGMENT_BYTES,
    peers: peers.size,
    streams: streams.size,
    live: liveStreams()
  };
}

export default {
  SEGMENT_BYTES, MODES, registerPeer, dropPeer, peerList, openStream, getStream,
  closeStream, liveStreams, publishSegment, markHolder, sendTo, broadcast,
  selectProvider, swarmStats, uplinkEstimate, transportSummary
};
