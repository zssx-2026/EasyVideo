/* EasyVideo - recommend.js
 *
 * 推荐引擎 + 评论 + 点赞/收藏/转发计数。
 *
 * 算法（对应 prompt.txt 第 125~128 行）：
 *   1. 每个账号维护一份 标签 -> 权重 的画像；
 *   2. 看过 / 点赞 / 收藏 / 搜索点击 都会抬升该内容标签的权重；
 *   3. 推荐时把候选内容的标签权重求和成概率，再按概率随机抽样，
 *      所以每次刷新顺序都不同，且越符合口味的内容越容易排在前面。
 *
 * 持久化刻意独立于数据库：data/social.json，避免与 store 的写入节奏耦合。
 */
import path from 'node:path';
import PATHS from './paths.js';
import logger from './logger.js';
import { readJson, writeJsonAtomic, uid } from './util.js';

const log = logger.child('recommend');
const FILE = path.join(PATHS.data, 'social.json');
const DECAY = 0.94;          // 每次学习时旧权重的衰减，保证口味会漂移
const MAX_TAGS = 14;         // 单个内容最多取多少个标签
const MAX_WEIGHT = 64;       // 单标签权重上限

const STOP = {
  the: 1, and: 1, for: 1, with: 1, this: 1, that: 1, from: 1, you: 1, are: 1,
  的: 1, 了: 1, 是: 1, 在: 1, 和: 1, 我: 1, 有: 1, 就: 1, 不: 1, 也: 1,
  视频: 1, 直播: 1, 房间: 1, 官方: 1, 测试: 1, 分享: 1, 合集: 1, 简介: 1,
  关注: 1, 欢迎: 1, 一个: 1, 什么: 1, 怎么: 1, 这个: 1, 我们: 1, 可以: 1,
  video: 1, live: 1, room: 1, test: 1, easyvideo: 1, new: 1, part: 1,
  http: 1, https: 1, www: 1, com: 1, mp4: 1, mkv: 1, avi: 1, mov: 1,
  投稿: 1, 主页: 1, 更多: 1, 全部: 1, 最新: 1, 推荐: 1, 播放: 1, 观看: 1
};

const state = {
  tags: {},        // accountId -> { tag: weight }
  seen: {},        // accountId -> { refId: at }
  comments: [],    // { id, kind, refId, accountId, author, text, at, likes }
  reactions: {},   // refId -> { like, favorite, share, views }
  loaded: false,
  dirty: false,
  timer: null
};

/* ------------------------------------------------------------- persistence */

function load() {
  if (state.loaded) return;
  state.loaded = true;
  const raw = readJson(FILE, null);
  if (!raw || typeof raw !== 'object') return;
  if (raw.tags && typeof raw.tags === 'object') state.tags = raw.tags;
  if (raw.seen && typeof raw.seen === 'object') state.seen = raw.seen;
  if (Array.isArray(raw.comments)) state.comments = raw.comments;
  if (raw.reactions && typeof raw.reactions === 'object') state.reactions = raw.reactions;
}

export function save(force) {
  load();
  if (!state.dirty && !force) return false;
  state.dirty = false;
  try {
    writeJsonAtomic(FILE, {
      version: 1,
      savedAt: Date.now(),
      tags: state.tags,
      seen: state.seen,
      comments: state.comments.slice(-4000),
      reactions: state.reactions
    });
    return true;
  } catch (err) {
    log.warn('save failed:', err.message);
    return false;
  }
}

function schedule() {
  state.dirty = true;
  if (state.timer) return;
  state.timer = setTimeout(() => { state.timer = null; save(); }, 1200);
  if (state.timer && state.timer.unref) state.timer.unref();
}

/* ------------------------------------------------------------- tokenizing */

function isWordChar(code) {
  if (code >= 48 && code <= 57) return true;   // 0-9
  if (code >= 65 && code <= 90) return true;   // A-Z
  if (code >= 97 && code <= 122) return true;  // a-z
  if (code > 127) return true;                 // CJK 及其他非 ASCII 文字
  return false;
}

/** 把任意文本切成词元：不使用正则，避免转义问题。 */
export function tokenize(text) {
  const out = [];
  const src = String(text == null ? '' : text).toLowerCase();
  let buf = '';
  for (let i = 0; i < src.length; i++) {
    const ch = src.charAt(i);
    if (isWordChar(ch.charCodeAt(0))) {
      buf += ch;
      continue;
    }
    if (buf) { out.push(buf); buf = ''; }
  }
  if (buf) out.push(buf);
  const kept = [];
  for (const token of out) {
    if (token.length < 2 && !(token.charCodeAt(0) > 127)) continue;
    if (STOP[token]) continue;
    if (kept.indexOf(token) < 0) kept.push(token);
  }
  return kept;
}

/** 内容标签：标题 + 简介 + 作者 + 显式标签 + 合集名。 */
export function tagsOf(item) {
  const it = item || {};
  const parts = [it.title, it.blurb, it.author, it.collection, it.roomName, it.query];
  const explicit = Array.isArray(it.tags) ? it.tags : [];
  for (const tag of explicit) parts.push(tag);
  const out = [];
  for (const part of parts) {
    for (const token of tokenize(part)) {
      if (out.indexOf(token) < 0) out.push(token);
      if (out.length >= MAX_TAGS) return out;
    }
  }
  return out;
}

/* ----------------------------------------------------------- user profile */

function profileOf(accountId, create) {
  load();
  const key = String(accountId || 'local');
  if (!state.tags[key]) {
    if (!create) return null;
    state.tags[key] = {};
  }
  return state.tags[key];
}

/**
 * 学习一次行为。weight 建议值：
 *   1 看过，2 搜索点击，3 收藏/稍后，5 点赞，0.5 负反馈。
 */
export function learn(accountId, item, weight) {
  const profile = profileOf(accountId, true);
  const bump = Number(weight) || 1;
  for (const tag of tagsOf(item)) {
    const next = (profile[tag] || 0) * DECAY + bump;
    profile[tag] = Math.min(MAX_WEIGHT, next);
  }
  const key = String(accountId || 'local');
  if (item && item.id) {
    if (!state.seen[key]) state.seen[key] = {};
    state.seen[key][String(item.id)] = Date.now();
  }
  schedule();
  return { tags: Object.keys(profile).length };
}

/** 最近看过的内容 id，避免推荐立刻重复自己。 */
function recentlySeen(accountId) {
  load();
  const seen = state.seen[String(accountId || 'local')] || {};
  const now = Date.now();
  const out = {};
  for (const id of Object.keys(seen)) {
    if (now - seen[id] < 1000 * 60 * 60 * 6) out[id] = true;
  }
  return out;
}

export function profile(accountId) {
  const p = profileOf(accountId, false) || {};
  const rows = Object.keys(p).map((tag) => ({ tag: tag, weight: Number(p[tag].toFixed(3)) }));
  rows.sort((a, b) => b.weight - a.weight);
  return { tags: rows.slice(0, 60), total: rows.length };
}

export function forget(accountId) {
  load();
  delete state.tags[String(accountId || 'local')];
  delete state.seen[String(accountId || 'local')];
  schedule();
  return true;
}

/* ------------------------------------------------------------ recommend */

function scoreOf(profileMap, item) {
  let score = 0;
  for (const tag of tagsOf(item)) {
    const w = profileMap[tag];
    if (w) score += w;
  }
  return score;
}

/**
 * 概率推荐：
 *   1. 每个候选内容按标签权重求和得到 score；
 *   2. 把 score 变成正数（+1 基线，保证冷启动也有机会）；
 *   3. 按权重轮盘赌抽样，逐个不放回地抽出 limit 个。
 * 结果既符合口味，又保留随机性 —— 刷新一次顺序就变。
 */
export function recommend(items, opts) {
  const o = opts || {};
  const list = Array.isArray(items) ? items.slice() : [];
  const limit = Math.max(1, Math.min(Number(o.limit) || 12, list.length || 1));
  const accountId = o.accountId || 'local';
  const profileMap = profileOf(accountId, false) || {};
  const seen = recentlySeen(accountId);
  const exclude = o.exclude || {};

  const pool = [];
  for (const item of list) {
    const id = String((item && item.id) || '');
    if (id && exclude[id]) continue;
    const fresh = id && seen[id] ? 0.35 : 1;   // 最近看过降权，但不彻底隐藏
    const score = scoreOf(profileMap, item);
    const weight = (1 + score * (o.temperature || 1)) * fresh;
    pool.push({ item: item, weight: weight, score: Number(score.toFixed(3)) });
  }
  if (!pool.length) return [];

  const picked = [];
  const bag = pool.slice();
  const take = Math.min(limit, bag.length);
  for (let n = 0; n < take; n++) {
    let total = 0;
    for (const row of bag) total += row.weight;
    let roll = Math.random() * total;
    let index = 0;
    for (let i = 0; i < bag.length; i++) {
      roll -= bag[i].weight;
      if (roll <= 0) { index = i; break; }
      index = i;
    }
    const row = bag.splice(index, 1)[0];
    row.rank = n + 1;
    picked.push(row);
  }
  return picked;
}

/** 只要排好序的内容列表，便于直接塞进卡片网格。 */
export function recommendItems(items, opts) {
  return recommend(items, opts).map((row) => row.item);
}

/* ------------------------------------------------------------- reactions */

function bucketOf(refId, create) {
  load();
  const key = String(refId || '');
  if (!key) return null;
  if (!state.reactions[key]) {
    if (!create) return null;
    state.reactions[key] = { like: 0, favorite: 0, share: 0, views: 0 };
  }
  return state.reactions[key];
}

const REACTIONS = { like: 1, favorite: 1, share: 1, views: 1 };

export function react(refId, kind, delta) {
  if (!REACTIONS[kind]) throw new Error('unknown reaction: ' + kind);
  const bucket = bucketOf(refId, true);
  bucket[kind] = Math.max(0, Math.round(bucket[kind] + (Number(delta) || 1)));
  schedule();
  return bucket;
}

export function counts(refId) {
  const bucket = bucketOf(refId, false) || { like: 0, favorite: 0, share: 0, views: 0 };
  return { like: bucket.like, favorite: bucket.favorite, share: bucket.share, views: bucket.views };
}

/** 批量取计数，用于卡片和播放页。 */
export function countsFor(items) {
  const out = {};
  for (const item of items || []) {
    const id = String((item && item.id) || '');
    if (id) out[id] = counts(id);
  }
  return out;
}

/* -------------------------------------------------------------- comments */

export function addComment(input) {
  load();
  const row = {
    id: uid('c'),
    kind: String((input && input.kind) || 'video'),
    refId: String((input && input.refId) || ''),
    accountId: String((input && input.accountId) || 'local'),
    author: String((input && input.author) || '本机用户'),
    text: String((input && input.text) || '').slice(0, 2000),
    at: Date.now(),
    likes: 0
  };
  if (!row.text.trim()) throw new Error('评论内容不能为空');
  state.comments.push(row);
  schedule();
  return row;
}

export function listComments(refId, limit) {
  load();
  const key = String(refId || '');
  const rows = state.comments.filter((c) => c.refId === key);
  rows.sort((a, b) => b.at - a.at);
  return rows.slice(0, Math.max(1, Math.min(Number(limit) || 50, 200)));
}

export function likeComment(id) {
  load();
  for (const c of state.comments) {
    if (c.id !== id) continue;
    c.likes = (c.likes || 0) + 1;
    schedule();
    return c;
  }
  throw new Error('评论不存在');
}

export function removeComment(id, accountId) {
  load();
  const before = state.comments.length;
  state.comments = state.comments.filter((c) => {
    if (c.id !== id) return true;
    if (accountId && c.accountId !== String(accountId)) return true;
    return false;
  });
  if (state.comments.length !== before) { schedule(); return true; }
  return false;
}

export function commentStats() {
  load();
  return { comments: state.comments.length, reactions: Object.keys(state.reactions).length, profiles: Object.keys(state.tags).length };
}

export default {
  tokenize, tagsOf, learn, profile, forget, recommend, recommendItems,
  react, counts, countsFor, addComment, listComments, likeComment, removeComment,
  commentStats, save
};
