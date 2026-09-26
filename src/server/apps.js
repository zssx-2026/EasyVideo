/* EasyVideo - running-process detection (Windows / POSIX).
 *
 * The "使用应用" (capture app) pickers only ever list applications that are
 * running RIGHT NOW - the spec is explicit that we detect running apps only,
 * never a catalog of installed ones.
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Well-known capture / streaming tools we recognise by image name. */
const KNOWN = [
  { image: 'obs64.exe', label: 'OBS Studio' },
  { image: 'obs32.exe', label: 'OBS Studio (32-bit)' },
  { image: 'streamlabs obs.exe', label: 'Streamlabs Desktop' },
  { image: 'obs-browser-page.exe', label: 'OBS Browser Source' },
  { image: 'xsplit.core.exe', label: 'XSplit Broadcaster' },
  { image: 'xsplit.gamecaster.exe', label: 'XSplit Gamecaster' },
  { image: 'vmix64.exe', label: 'vMix' },
  { image: 'vmix.exe', label: 'vMix' },
  { image: 'bandicam.exe', label: 'Bandicam' },
  { image: 'fraps.exe', label: 'Fraps' },
  { image: 'action.exe', label: 'Mirillis Action!' },
  { image: 'camtasia.exe', label: 'Camtasia' },
  { image: 'screenpresso.exe', label: 'Screenpresso' },
  { image: 'sharex.exe', label: 'ShareX' },
  { image: 'ffmpeg.exe', label: 'FFmpeg' },
  { image: 'ffplay.exe', label: 'FFplay' },
  { image: 'vlc.exe', label: 'VLC media player' },
  { image: 'mpv.exe', label: 'mpv' },
  { image: 'potplayer.exe', label: 'PotPlayer' },
  { image: 'chrome.exe', label: 'Google Chrome' },
  { image: 'msedge.exe', label: 'Microsoft Edge' },
  { image: 'firefox.exe', label: 'Mozilla Firefox' },
  { image: 'zoom.exe', label: 'Zoom' },
  { image: 'teams.exe', label: 'Microsoft Teams' },
  { image: 'discord.exe', label: 'Discord' },
  { image: 'audacity.exe', label: 'Audacity' },
  { image: 'handbrake.exe', label: 'HandBrake' },
  { image: 'prism.exe', label: 'Prism Live Studio' },
  { image: 'nvcontainer.exe', label: 'NVIDIA Container' },
  { image: 'amfencoder.exe', label: 'AMD AMF Encoder' },
  { image: 'gamebar.exe', label: 'Xbox Game Bar' },
  { image: 'gamebarpresencewriter.exe', label: 'Xbox Game Bar Presence Writer' },
  { image: 'obs-virtualcam.exe', label: 'OBS Virtual Camera' }
];

const KNOWN_MAP = new Map(KNOWN.map((k) => [k.image, k.label]));

function win32List() {
  return new Promise((resolve) => {
    execFile('tasklist', ['/fo', 'csv', '/nh'], { windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => {
      if (err || !stdout) return resolve([]);
      const out = [];
      for (const line of stdout.split(/\r?\n/)) {
        if (!line.trim()) continue;
        const m = line.match(/^"([^"]+)","(\d+)"/);
        if (!m) continue;
        const image = m[1].toLowerCase();
        if (!image.endsWith('.exe')) continue;
        out.push({ image, label: KNOWN_MAP.get(image) || m[1].replace(/\.exe$/i, ''), pid: Number(m[2]) });
      }
      resolve(out);
    });
  });
}

function posixList() {
  return new Promise((resolve) => {
    execFile('ps', ['-eo', 'comm='], { maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
      if (err || !stdout) return resolve([]);
      const out = [];
      for (const raw of stdout.split('\n')) {
        const name = raw.trim();
        if (!name) continue;
        out.push({ image: name.toLowerCase(), label: KNOWN_MAP.get(name.toLowerCase() + '.exe') || name, pid: 0 });
      }
      resolve(out);
    });
  });
}

/** Deduplicate by image name, keep the lowest pid as the representative. */
export async function runningApps(filter) {
  const raw = os.platform() === 'win32' ? await win32List() : await posixList();
  const byImage = new Map();
  for (const app of raw) {
    if (app.image === 'easyvideo.exe' || app.image === 'easyvideo') continue;
    const prev = byImage.get(app.image);
    if (!prev) byImage.set(app.image, Object.assign({}, app, { instances: 1, known: KNOWN_MAP.has(app.image) }));
    else prev.instances++;
  }
  let list = [...byImage.values()];
  const needle = String(filter || '').trim().toLowerCase();
  if (needle) {
    list = list.filter((a) => a.label.toLowerCase().includes(needle) || a.image.includes(needle));
  }
  // Known capture tools float to the top, then alphabetical.
  list.sort((a, b) => (Number(b.known) - Number(a.known)) || a.label.localeCompare(b.label));
  return list;
}

/** Heuristic for "is <app> currently recording?" - file-handle-free best effort. */
export async function appStatus(image) {
  const list = await runningApps(image);
  const hit = list.find((a) => a.image === String(image || '').toLowerCase());
  return { running: !!hit, app: hit || null };
}

export const KNOWN_APPS = KNOWN;
export default { runningApps, appStatus, KNOWN_APPS };
