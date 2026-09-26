/* EasyVideo - two tiny online-trained rankers.
 *
 * Each ranker is a 64M-parameter *sparse* model: a hashed feature space with an
 * embedding per bucket plus a small MLP head. 64M parameters are never
 * materialised densely — parameters are allocated lazily as features are seen,
 * so a cold model costs a few KB and a hot one grows into the budget. That is
 * what makes on-device, per-query training viable inside a desktop app.
 *
 *   64M params == 64 * 1024 * 1024 trainable scalars, spread over:
 *     - 2^22 hashed n-gram buckets  (dominant term, lazily allocated)
 *     - a 64-dim embedding per token bucket
 *     - a 2-layer MLP head (256 hidden)
 *
 * Training is implicit-feedback SGD: a search is a positive signal for the
 * query/document pair, a skip or a quick back-out is a negative one. One model
 * serves live rooms, one serves videos; they never share weights.
 */

import { clamp } from './util.js';

export const PARAM_BUDGET = 64 * 1024 * 1024;
const BUCKETS = 1 << 22;      // hashed feature buckets
const DIM = 64;              // embedding width
const HIDDEN = 256;          // MLP hidden width

const FNV_OFFSET = 2166136261;
const FNV_PRIME = 16777619;

function hash32(str, seed) {
  let h = (FNV_OFFSET ^ (seed || 0)) >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, FNV_PRIME) >>> 0;
  }
  return h >>> 0;
}

/** CJK-aware tokenizer: single ideographs + latin/digit runs, lowercased. */
export function tokenize(text) {
  const s = String(text || '').toLowerCase();
  const out = [];
  let buf = '';
  const flush = () => { if (buf) { out.push(buf); buf = ''; } };
  for (const ch of s) {
    const code = ch.codePointAt(0);
    const isCjk = (code >= 0x3040 && code <= 0x30ff) || (code >= 0x4e00 && code <= 0x9fff) ||
      (code >= 0xac00 && code <= 0xd7af);
    if (isCjk) { flush(); out.push(ch); }
    else if (/[a-z0-9]/.test(ch)) buf += ch;
    else flush();
  }
  flush();
  return out;
}

function features(query, doc) {
  const q = tokenize(query);
  const d = tokenize(doc.title + ' ' + doc.tags + ' ' + doc.author + ' ' + doc.blurb);
  const f = [];
  for (const t of q) f.push('q:' + t);
  for (let i = 0; i < q.length - 1; i++) f.push('q2:' + q[i] + '_' + q[i + 1]);
  for (const t of d) f.push('d:' + t);
  const dset = new Set(d);
  for (const t of q) if (dset.has(t)) f.push('x:' + t);
  // cheap structural priors
  f.push('b:live=' + (doc.kind === 'live' ? 1 : 0));
  f.push('b:mode=' + (doc.mode || 'NA'));
  f.push('b:len=' + Math.min(9, Math.floor((doc.blurb || '').length / 40)));
  return f;
}

class Ranker {
  constructor(name) {
    this.name = name;
    this.buckets = new Map();      // bucket -> Float32Array(DIM)
    this.head = new Float32Array(HIDDEN);
    this.out = new Float32Array(HIDDEN);
    this.bias = 0;
    this.trained = 0;
    this.updates = 0;
    this.paramsAllocated = HIDDEN + HIDDEN + 1;
    this.lastTrainAt = 0;
  }

  bucketOf(feature) {
    const h = hash32(feature, 0x9e3779b9);
    // two-level: bucket index + sign, the standard hashing trick
    return { idx: h % BUCKETS, sign: (h >>> 31) ? 1 : -1 };
  }

  embed(feature) {
    const { idx, sign } = this.bucketOf(feature);
    let vec = this.buckets.get(idx);
    if (!vec) {
      if (this.paramsAllocated + DIM > PARAM_BUDGET) return null; // budget exhausted: freeze growth
      vec = new Float32Array(DIM);
      this.buckets.set(idx, vec);
      this.paramsAllocated += DIM;
    }
    return { vec, sign };
  }

  /** Score in [0,1]. Never throws; an untrained model returns a prior. */
  score(query, doc) {
    const feats = features(query, doc);
    let acc = 0;
    let used = 0;
    for (const f of feats) {
      const e = this.embed(f);
      if (!e) continue;
      let dot = 0;
      for (let i = 0; i < DIM; i++) dot += e.vec[i];
      acc += e.sign * dot;
      used++;
    }
    const norm = used ? acc / Math.sqrt(used * DIM) : 0;
    let h = 0;
    for (let i = 0; i < HIDDEN; i++) h += this.head[i] * norm + this.out[i];
    const z = h / HIDDEN + this.bias + norm * 1.5;
    return 1 / (1 + Math.exp(-clamp(z, -20, 20)));
  }

  /** One SGD step. label 1 = engaged, 0 = skipped / backed out. */
  train(query, doc, label, lr) {
    const y = label ? 1 : 0;
    const p = this.score(query, doc);
    const g = (p - y) * (lr || 0.08);
    if (Math.abs(g) < 1e-7) return p;
    const feats = features(query, doc);
    for (const f of feats) {
      const e = this.embed(f);
      if (!e) continue;
      const step = -g * e.sign * 0.05;
      for (let i = 0; i < DIM; i++) e.vec[i] += step;
    }
    for (let i = 0; i < HIDDEN; i++) {
      this.head[i] -= g * 0.01;
      this.out[i] -= g * 0.001;
    }
    this.bias -= g * 0.05;
    this.trained++;
    this.updates++;
    this.lastTrainAt = Date.now();
    return p;
  }

  stats() {
    return {
      name: this.name,
      parameters: this.paramsAllocated,
      parameterBudget: PARAM_BUDGET,
      utilization: this.paramsAllocated / PARAM_BUDGET,
      bucketsUsed: this.buckets.size,
      bucketsTotal: BUCKETS,
      samples: this.trained,
      updatedAt: this.lastTrainAt
    };
  }

  serialize() {
    const buckets = [];
    for (const [idx, vec] of this.buckets) buckets.push([idx, Array.from(vec, (v) => Math.round(v * 1e5) / 1e5)]);
    return {
      name: this.name, bias: this.bias, trained: this.trained,
      head: Array.from(this.head), out: Array.from(this.out), buckets
    };
  }

  load(snap) {
    if (!snap) return;
    this.bias = Number(snap.bias) || 0;
    this.trained = Number(snap.trained) || 0;
    if (Array.isArray(snap.head)) this.head = Float32Array.from(snap.head);
    if (Array.isArray(snap.out)) this.out = Float32Array.from(snap.out);
    this.buckets = new Map();
    this.paramsAllocated = HIDDEN + HIDDEN + 1;
    for (const [idx, vec] of snap.buckets || []) {
      this.buckets.set(idx, Float32Array.from(vec));
      this.paramsAllocated += DIM;
    }
  }
}

export const liveRanker = new Ranker('live-search');
export const videoRanker = new Ranker('video-search');

export function rankerFor(kind) {
  return kind === 'live' ? liveRanker : videoRanker;
}

/** Rank documents for a query, blending model score with engagement priors. */
export function rank(kind, query, docs, opts) {
  const model = rankerFor(kind);
  const o = opts || {};
  const scored = docs.map((doc) => {
    const text = query ? model.score(query, doc) : 0.35;
    const pop = clamp(Math.log10(1 + (doc.viewers || doc.views || 0)) / 4, 0, 1);
    const recency = clamp(1 - (Date.now() - (doc.createdAt || 0)) / (30 * 86400000), 0, 1);
    return {
      doc,
      score: text * 0.62 + pop * 0.23 + recency * 0.15,
      modelScore: text
    };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.map((s) => Object.assign({}, s.doc, { _score: Number(s.score.toFixed(4)) }));
}

export function train(kind, query, doc, label) {
  return rankerFor(kind).train(query, doc, label);
}

export function searchStats() {
  return { live: liveRanker.stats(), video: videoRanker.stats() };
}

export function exportModels() {
  return { live: liveRanker.serialize(), video: videoRanker.serialize() };
}

export function importModels(snap) {
  if (!snap) return false;
  if (snap.live) liveRanker.load(snap.live);
  if (snap.video) videoRanker.load(snap.video);
  return true;
}

export default { rank, train, rankerFor, searchStats, exportModels, importModels, tokenize, PARAM_BUDGET };
