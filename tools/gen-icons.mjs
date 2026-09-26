/* EasyVideo - icon factory.
 *
 * Source of truth for every raster asset we ship:
 *   assets/img/icon-*.png   app / window / installer icons
 *   assets/img/icon.ico     multi-size Windows icon (PNG-compressed entries)
 *   assets/img/tray-*.png   tray states: idle | live | offline
 *
 * The app mark is authored here as SVG (a clapperboard with a play glyph on an
 * ember gradient) and rasterised with sharp. Glyph geometry is borrowed from
 * lucide (ISC licensed) - see assets/icons/LICENSE.
 */

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import sharp from 'sharp';

const here = path.dirname(url.fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const lucideDir = path.join(root, 'temp', 'icons', 'package', 'icons');
const outImg = path.join(root, 'assets', 'img');
const outIcons = path.join(root, 'assets', 'icons');

const EMBER = ['#ff9d4d', '#ff6a3d', '#d9410f'];

function lucide(name) {
  const file = path.join(lucideDir, name + '.svg');
  if (!fs.existsSync(file)) return null;
  const svg = fs.readFileSync(file, 'utf8');
  const inner = svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>[\s\S]*$/, '');
  return inner.trim();
}

function gradientDefs(id) {
  return '<defs>' +
    '<linearGradient id="' + id + '" x1="0" y1="0" x2="1" y2="1">' +
      '<stop offset="0" stop-color="' + EMBER[0] + '"/>' +
      '<stop offset="0.52" stop-color="' + EMBER[1] + '"/>' +
      '<stop offset="1" stop-color="' + EMBER[2] + '"/>' +
    '</linearGradient>' +
    '<linearGradient id="' + id + 'sheen" x1="0" y1="0" x2="0.4" y2="1">' +
      '<stop offset="0" stop-color="#ffffff" stop-opacity="0.22"/>' +
      '<stop offset="0.6" stop-color="#ffffff" stop-opacity="0"/>' +
    '</linearGradient>' +
    '<clipPath id="boardClip"><rect x="96" y="104" width="320" height="304" rx="40"/></clipPath>' +
  '</defs>';
}

/** The EasyVideo mark: clapperboard body, hinged clapper top, play glyph. */
function markSvg(opts) {
  const o = opts || {};
  const size = o.size || 512;
  const pad = o.pad === undefined ? 26 : o.pad;
  const id = 'ev';
  const stroke = o.stroke || ('url(#' + id + ')');
  const tile = o.tile === false ? '' :
    '<rect x="' + pad + '" y="' + pad + '" width="' + (512 - pad * 2) + '" height="' + (512 - pad * 2) + '" rx="118" fill="#0d0f14"/>' +
    '<rect x="' + pad + '" y="' + pad + '" width="' + (512 - pad * 2) + '" height="' + (512 - pad * 2) + '" rx="118" fill="url(#' + id + ')" opacity="0.13"/>' +
    '<rect x="' + (pad + 5) + '" y="' + (pad + 5) + '" width="' + (512 - pad * 2 - 10) + '" height="' + (512 - pad * 2 - 10) + '" rx="113" fill="none" stroke="url(#' + id + ')" stroke-width="5" opacity="0.55"/>';
  return '<svg xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + size + '" viewBox="0 0 512 512">' +
    gradientDefs(id) +
    tile +
    '<g clip-path="url(#boardClip)">' +
      '<rect x="96" y="104" width="320" height="112" fill="' + stroke + '" opacity="0.92"/>' +
      '<g stroke="#0d0f14" stroke-width="14" opacity="0.85">' +
        '<line x1="150" y1="104" x2="112" y2="216"/>' +
        '<line x1="238" y1="104" x2="200" y2="216"/>' +
        '<line x1="326" y1="104" x2="288" y2="216"/>' +
        '<line x1="414" y1="104" x2="376" y2="216"/>' +
      '</g>' +
    '</g>' +
    '<rect x="96" y="104" width="320" height="304" rx="40" fill="none" stroke="' + stroke + '" stroke-width="20"/>' +
    '<path d="M222 250 L326 312 L222 374 Z" fill="' + stroke + '" stroke="' + stroke + '" stroke-width="18" stroke-linejoin="round"/>' +
  '</svg>';
}

/** Tray glyphs: flat, single-colour, readable at 16px. */
function traySvg(state) {
  const color = state === 'live' ? '#ff6a3d' : state === 'offline' ? '#7d8695' : state === 'error' ? '#f0b429' : '#c8d0dc';
  const accent = state === 'live' ? '#ffb066' : color;
  return '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">' +
    '<rect x="8" y="14" width="48" height="14" fill="' + accent + '"/>' +
    '<g stroke="#0d0f14" stroke-width="3">' +
      '<line x1="16" y1="14" x2="10" y2="28"/>' +
      '<line x1="30" y1="14" x2="24" y2="28"/>' +
      '<line x1="44" y1="14" x2="38" y2="28"/>' +
      '<line x1="58" y1="14" x2="52" y2="28"/>' +
    '</g>' +
    '<rect x="8" y="14" width="48" height="42" rx="8" fill="none" stroke="' + color + '" stroke-width="4"/>' +
    '<path d="M27 28 L41 36 L27 44 Z" fill="' + color + '"/>' +
    (state === 'live' ? '<circle cx="52" cy="50" r="6" fill="#ff3b30"/>' : '') +
    (state === 'error' ? '<path d="M14 52 L28 38" stroke="#f0b429" stroke-width="5"/>' : '') +
  '</svg>';
}

async function png(svg, size) {
  return sharp(Buffer.from(svg), { density: 384 }).resize(size, size, { fit: 'contain' }).png({ compressionLevel: 9 }).toBuffer();
}

/** ICO container with PNG-compressed entries (Vista+). */
function ico(entries) {
  const head = Buffer.alloc(6);
  head.writeUInt16LE(0, 0);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(entries.length, 4);
  const dir = Buffer.alloc(16 * entries.length);
  let offset = 6 + dir.length;
  entries.forEach((e, i) => {
    const b = i * 16;
    dir.writeUInt8(e.size >= 256 ? 0 : e.size, b);
    dir.writeUInt8(e.size >= 256 ? 0 : e.size, b + 1);
    dir.writeUInt8(0, b + 2);
    dir.writeUInt8(0, b + 3);
    dir.writeUInt16LE(1, b + 4);
    dir.writeUInt16LE(32, b + 6);
    dir.writeUInt32LE(e.data.length, b + 8);
    dir.writeUInt32LE(offset, b + 12);
    offset += e.data.length;
  });
  return Buffer.concat([head, dir, ...entries.map((e) => e.data)]);
}

const UI_ICONS = [
  'clapperboard', 'radio-tower', 'circle-play', 'play', 'pause', 'video', 'cast', 'signal',
  'antenna', 'tv', 'monitor-play', 'satellite-dish', 'podcast', 'waves', 'rss', 'activity',
  'house', 'search', 'plus', 'history', 'bookmark', 'star', 'users', 'user', 'settings', 'shield',
  'upload', 'link', 'folder', 'file-video', 'drafting-compass', 'pencil', 'trash-2', 'download',
  'cloud-upload', 'log-out', 'user-plus', 'repeat', 'chevron-right', 'chevron-left', 'x', 'check',
  'eye', 'eye-off', 'heart', 'message-circle', 'share-2', 'clock', 'hard-drive', 'gauge', 'wifi',
  'wifi-off', 'server', 'network', 'layers', 'sparkles', 'wand-sparkles', 'bug', 'terminal',
  'refresh-cw', 'power', 'external-link', 'info', 'triangle-alert', 'circle-check', 'loader-circle',
  'copy', 'scissors', 'grip-vertical', 'panel-right', 'filter', 'sliders-horizontal', 'cake',
  'calendar', 'user-round', 'star-half', 'flame', 'lock', 'globe', 'monitor', 'camera', 'mic'
];

async function main() {
  fs.mkdirSync(outImg, { recursive: true });
  fs.mkdirSync(outIcons, { recursive: true });
  const written = [];

  // app mark
  const master = markSvg({ size: 512 });
  for (const size of [16, 24, 32, 48, 64, 128, 256, 512]) {
    const buf = await png(master, size);
    const file = path.join(outImg, 'icon-' + size + '.png');
    fs.writeFileSync(file, buf);
    written.push(file);
  }
  const icoSizes = [16, 24, 32, 48, 64, 128, 256];
  const entries = [];
  for (const size of icoSizes) {
    entries.push({ size, data: await png(master, size) });
  }
  fs.writeFileSync(path.join(outImg, 'icon.ico'), ico(entries));
  written.push(path.join(outImg, 'icon.ico'));

  // tray states
  for (const state of ['idle', 'live', 'offline', 'error']) {
    for (const size of [16, 24, 32]) {
      const file = path.join(outImg, 'tray-' + state + '-' + size + '.png');
      fs.writeFileSync(file, await png(traySvg(state), size));
      written.push(file);
    }
  }

  // UI icon set (lucide, restyled to currentColor)
  let copied = 0;
  for (const name of UI_ICONS) {
    const inner = lucide(name);
    if (!inner) { console.log('  ! lucide icon missing:', name); continue; }
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" ' +
      'fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">' +
      inner + '</svg>';
    fs.writeFileSync(path.join(outIcons, name + '.svg'), svg, 'utf8');
    copied++;
  }

  const lic = path.join(lucideDir, '..', 'LICENSE');
  if (fs.existsSync(lic)) fs.copyFileSync(lic, path.join(outIcons, 'LICENSE'));

  console.log('icons: ' + written.length + ' raster assets, ' + copied + ' ui icons');
  for (const f of written) console.log('  ' + path.relative(root, f));
}

main().catch((err) => { console.error(err); process.exit(1); });
