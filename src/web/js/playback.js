/* EasyVideo - playback preferences.
 *
 * One small observable store for every knob on the watch page: looping,
 * auto-start, mirrors, playback mode, aspect, codecs, volume levelling,
 * letterbox, lights-off and eye-care. Persisted in localStorage so the choice
 * survives a reload, and readable from any view through get()/subscribe().
 */

const KEY = 'ev.playback.v1';

export const DEFAULTS = {
  singleLoop: false, autoPlayLive: true, mirrorV: false, mirrorH: false,
  hideFrame: false, lightsOff: false, eyeCare: false, volumeLevel: false,
  highEnergy: true, danmaku: true, autoNext: true,
  playMode: 'pause', aspect: 'auto', videoCodec: 'auto', audioCodec: 'aac',
  quality: 'auto', fps: 0, bitrate: 'high', speed: 1, subtitle: 'off',
  volume: 1, seekStep: 5, longPressSpeed: 3
};

export const PLAY_MODES = [['pause', '播完暂停'], ['next', '自动切集'], ['rest', '播完休息']];
export const ASPECTS = [['auto', '默认'], ['4:3', '4:3'], ['16:9', '16:9']];
export const VIDEO_CODECS = [
  ['auto', '自动'], ['av1', 'AV1'], ['h264', 'H.264'], ['h265', 'H.265'], ['h266', 'H.266'],
  ['amf', 'AMF'], ['nvenc', 'NVIDIA'], ['aom', 'AOM AV1'], ['svt', 'SVT-AV1'], ['sw', '软件']
];
export const AUDIO_CODECS = [['aac', 'AAC'], ['alac', 'ALAC'], ['flac', 'FLAC'], ['opus', 'OPUS'], ['pcm', 'PCM']];
export const QUALITIES = ['auto', '360P', '480P', '720P', '1080P', '2K', '4K'];
export const FPS_CHOICES = [0, 10, 24, 30, 60, 120];
export const BITRATES = [
  ['lowest', '极低'], ['low', '低'], ['mid', '中等'], ['high', '高'], ['ultra', '极高'], ['lossless', '无损']
];
export const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];
export const SUBTITLES = [['off', '关闭'], ['zh', '中文'], ['en', '英文'], ['auto', '智能']];

let state = Object.assign({}, DEFAULTS);
const listeners = new Set();

function load() {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return;
    const saved = JSON.parse(raw);
    if (saved && typeof saved === 'object') state = Object.assign({}, DEFAULTS, saved);
  } catch (err) { /* first run or storage disabled */ }
}

function persist() {
  try { window.localStorage.setItem(KEY, JSON.stringify(state)); } catch (err) { /* ignore */ }
}

function emit() {
  for (const fn of listeners) { try { fn(state); } catch (err) { /* listener error */ } }
}

export function get(key) {
  return key === undefined ? Object.assign({}, state) : state[key];
}

/** set('speed', 2) or set({ speed: 2, mirrorH: true }) */
export function set(keyOrPatch, value) {
  const patch = (typeof keyOrPatch === 'string') ? { } : (keyOrPatch || {});
  if (typeof keyOrPatch === 'string') patch[keyOrPatch] = value;
  let changed = false;
  for (const k of Object.keys(patch)) {
    if (state[k] === patch[k]) continue;
    state[k] = patch[k];
    changed = true;
  }
  if (!changed) return Object.assign({}, state);
  persist();
  emit();
  return Object.assign({}, state);
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function reset() {
  state = Object.assign({}, DEFAULTS);
  persist();
  emit();
  return Object.assign({}, state);
}

/** CSS transform for the current mirror choices. */
export function videoTransform() {
  const bits = [];
  if (state.mirrorH) bits.push('scaleX(-1)');
  if (state.mirrorV) bits.push('scaleY(-1)');
  return bits.length ? bits.join(' ') : 'none';
}

/** CSS filter for eye-care and lights-off. */
export function videoFilter() {
  const bits = [];
  if (state.eyeCare) bits.push('sepia(0.22) saturate(0.92) brightness(0.98)');
  if (state.lightsOff) bits.push('brightness(1.04) contrast(1.02)');
  return bits.length ? bits.join(' ') : 'none';
}

function labelOf(list, key, fallback) {
  for (const pair of list) if (pair[0] === key) return pair[1];
  return fallback;
}

/** Human labels for the telemetry strip on the watch page. */
export function describe() {
  return {
    quality: state.quality === 'auto' ? '原画' : state.quality,
    fps: state.fps ? state.fps + 'fps' : '原帧率',
    bitrate: labelOf(BITRATES, state.bitrate, '高'),
    speed: state.speed === 1 ? '1x' : state.speed + 'x',
    subtitle: labelOf(SUBTITLES, state.subtitle, '关闭'),
    volume: Math.round(state.volume * 100) + '%'
  };
}

load();

export const playback = { KEY, get, set, subscribe, reset, describe, videoTransform, videoFilter, DEFAULTS };
export default playback;
