/* EasyVideo - archive reader (tar / tar.zst / tar.gz / brotli).
 *
 * Theme packages and plugin packages are zstd-compressed tar archives, so this
 * module implements just enough USTAR: regular files, directories and GNU long
 * names. Path traversal is refused outright.
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const BS = String.fromCharCode(92);

/** Try every codec node ships; an unknown buffer comes back untouched. */
export function inflate(buf) {
  const tries = [];
  if (typeof zlib.zstdDecompressSync === "function") tries.push(() => zlib.zstdDecompressSync(buf));
  tries.push(() => zlib.gunzipSync(buf));
  tries.push(() => zlib.brotliDecompressSync(buf));
  for (const run of tries) {
    try { return run(); } catch (err) { /* next codec */ }
  }
  return buf;
}

function textOf(buf) {
  let out = "";
  for (const b of buf) { if (b === 0) break; out += String.fromCharCode(b); }
  return out;
}

function octalOf(buf) {
  const t = textOf(buf).trim();
  if (!t) return 0;
  const n = parseInt(t, 8);
  return Number.isFinite(n) ? n : 0;
}

function safeJoin(base, rel) {
  let clean = String(rel || "");
  while (clean.indexOf("./") === 0) clean = clean.slice(2);
  clean = clean.split(BS).join("/");
  if (!clean || clean.indexOf("..") >= 0) return null;
  const target = path.join(base, clean.split("/").join(path.sep));
  if (!target.startsWith(base)) return null;
  return target;
}

/** Extract a tar buffer into dir; returns the number of files written. */
export function untar(buf, dir) {
  const tar = inflate(buf);
  fs.mkdirSync(dir, { recursive: true });
  let offset = 0;
  let files = 0;
  let longName = null;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header[0] === 0) break;
    let name = textOf(header.subarray(0, 100));
    const prefix = textOf(header.subarray(345, 500));
    const size = octalOf(header.subarray(124, 136));
    const type = String.fromCharCode(header[156] || 48);
    offset += 512;
    const data = tar.subarray(offset, offset + size);
    offset += Math.ceil(size / 512) * 512;
    if (type === "L") { longName = textOf(data); continue; }
    if (longName) { name = longName; longName = null; }
    if (prefix && name.indexOf("/") < 0) name = prefix + "/" + name;
    if (!name) continue;
    const target = safeJoin(dir, name);
    if (!target) continue;
    if (type === "5") { fs.mkdirSync(target, { recursive: true }); continue; }
    if (type !== "0" && type !== "") continue;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, data);
    files++;
  }
  return files;
}

export default { inflate, untar };
