/* EasyVideo - assemble the NSIS script from installer/template/part-*.nsi. */
import fs from 'node:fs';
import path from 'node:path';

const BS = String.fromCharCode(92);
const S = String.fromCharCode(39);
const NL = String.fromCharCode(10);

const PARTS = ['part-a.nsi', 'part-b.nsi', 'part-c.nsi', 'part-d.nsi'];
const BOM = String.fromCharCode(0xFEFF);
const KEY = 'Software' + BS + 'EasyVideo' + BS + 'Files';

/** hashes.nsh: version constants plus the EV_WRITE_HASHES macro. */
export function hashesScript(opts) {
  const out = [];
  out.push('; EasyVideo - version and per-file checksums (generated).');
  out.push('!define EV_VERSION ' + S + opts.version + S);
  out.push('!define EV_LABEL ' + S + opts.label + S);
  out.push('!define EV_FILECOUNT ' + S + String(opts.hashes.length) + S);
  out.push('');
  out.push('!macro EV_WRITE_HASHES');
  for (const item of opts.hashes) {
    out.push('  WriteRegStr HKCU ' + S + KEY + S + ' ' + S + item.rel.split('/').join(BS) + S + ' ' + S + item.sha256 + S);
  }
  out.push('!macroend');
  out.push('');
  return out.join(NL);
}

/** Write hashes.nsh and the assembled EasyVideo.nsi. */
export function buildNsi(opts) {
  const chunks = PARTS.map((name) => fs.readFileSync(path.join(opts.templateDir, name), 'utf8'));
  // 模板里的 include 可能带引号，统一按行处理，别依赖某种写法。
  let head = chunks[0].split(NL).filter((line) => line.indexOf('!include hashes.nsh') < 0).join(NL);
  const anchor = head.split(NL).findIndex((line) => line.indexOf('StrFunc.nsh') >= 0);
  const lines = head.split(NL);
  if (anchor >= 0) lines.splice(anchor + 1, 0, '!include hashes.nsh');
  else lines.unshift('!include hashes.nsh');
  head = lines.join(NL);
  head = head.split('EasyVideo-Setup.exe').join(opts.outFileName);
  head = head.split('1.0.0.0').join(opts.quad);
  const script = [head].concat(chunks.slice(1)).join(NL);
  const outDir = path.dirname(opts.outFile);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'hashes.nsh'), String.fromCharCode(0xFEFF) + hashesScript(opts), 'utf8');
  fs.writeFileSync(opts.outFile, String.fromCharCode(0xFEFF) + script, 'utf8');
  return { file: opts.outFile, lines: script.split(NL).length, bytes: script.length, files: opts.hashes.length };
}

export default { buildNsi, hashesScript };
