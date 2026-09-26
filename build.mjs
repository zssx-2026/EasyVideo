/* EasyVideo - one-shot build: bundle -> SEA blob -> standalone EXE.
 *
 *   node build.mjs              full build into dist/
 *   node build.mjs --skip-icons skip icon regeneration
 *   node build.mjs --no-sea     stop after the bundle (fast dev check)
 *
 * Steps:
 *   1. regenerate icons and the embedded asset module
 *   2. esbuild the server + all deps into dist/easyvideo.cjs (single file)
 *   3. node --experimental-sea-config -> dist/sea-prep.blob
 *   4. copy node.exe -> dist/EasyVideo.exe and inject the blob with postject
 *
 * The result is a single self-contained executable: no Node install, no
 * node_modules, no loose web files.
 */

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { execFileSync } from 'node:child_process';
import * as esbuild from 'esbuild';
import { writeModule } from './tools/gen-assets.mjs';

const here = path.dirname(url.fileURLToPath(import.meta.url));
const root = here;
const dist = path.join(root, 'dist');
const argv = process.argv.slice(2);
const has = (flag) => argv.includes(flag);

const VERSION = process.env.EV_VERSION || (() => {
  try { return JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version; }
  catch { return '1.0.0'; }
})();

function step(text) { console.log('[build] ' + text); }

function run(cmd, args, opts) {
  execFileSync(cmd, args, Object.assign({ stdio: 'inherit', cwd: root }, opts || {}));
}

async function main() {
  fs.mkdirSync(dist, { recursive: true });

  if (!has('--skip-icons')) {
    step('icons');
    try { run(process.execPath, [path.join(root, 'tools', 'gen-icons.mjs')]); }
    catch (err) { console.log('[build] icon step skipped: ' + err.message); }
  }

  step('embed web assets');
  const built = writeModule();
  console.log('[build]   ' + built.count + ' assets, ' + Math.round(built.raw / 1024) + ' KiB');
  if (built.count === 0) console.log('[build]   WARNING: no web assets found - the EXE will serve nothing');

  step('esbuild bundle');
  const outfile = path.join(dist, 'easyvideo.cjs');
  await esbuild.build({
    entryPoints: [path.join(root, 'src', 'server', 'main.js')],
    outfile,
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'cjs',
    minify: !has('--no-minify'),
    sourcemap: false,
    legalComments: 'none',
    external: [],
    banner: { js: '/* EasyVideo ' + VERSION + ' - bundled ' + new Date().toISOString() + ' */' },
    define: { 'process.env.EV_VERSION': JSON.stringify(VERSION) },
    logLevel: 'info'
  });
  const size = fs.statSync(outfile).size;
  console.log('[build]   ' + path.relative(root, outfile) + '  ' + Math.round(size / 1024) + ' KiB');

  if (has('--no-sea')) { step('done (bundle only)'); return; }

  step('sea blob');
  const seaConfig = {
    main: outfile,
    output: path.join(dist, 'sea-prep.blob'),
    disableExperimentalSEAWarning: true,
    useSnapshot: false,
    useCodeCache: true,
    assets: {}
  };
  fs.writeFileSync(path.join(dist, 'sea-config.json'), JSON.stringify(seaConfig, null, 2), 'utf8');
  run(process.execPath, ['--experimental-sea-config', path.join(dist, 'sea-config.json')]);

  step('inject');
  const exe = path.join(dist, 'EasyVideo.exe');
  // A previous run can leave the exe mapped by a live process; on Windows that
  // makes copyFileSync fail with a bare UNKNOWN error. Retry after deleting.
  let copied = false;
  for (let attempt = 0; attempt < 8 && !copied; attempt++) {
    try {
      fs.rmSync(exe, { force: true });
      fs.copyFileSync(process.execPath, exe);
      copied = true;
    } catch (err) {
      if (attempt === 7) throw err;
      step('copy retry ' + (attempt + 1) + ' (' + err.code + ')');
      await new Promise((r) => setTimeout(r, 700));
    }
  }
  const postject = path.join(root, 'node_modules', 'postject', 'dist', 'cli.js');
  run(process.execPath, [postject, exe, 'NODE_SEA_BLOB', path.join(dist, 'sea-prep.blob'), '--sentinel-fuse', 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2']);

  step('icon + version resource');
  // The icon must be applied with rcedit: patching the PE with GDI+ destroys
  // the executable header and Windows then refuses to launch it.
  const ico = path.join(root, 'assets', 'img', 'icon.ico');
  const rcedit = path.join(root, 'node_modules', 'rcedit', 'bin', 'rcedit-x64.exe');
  if (fs.existsSync(ico) && fs.existsSync(rcedit)) {
    const numeric = (String(VERSION).match(/[0-9]+(?:[.][0-9]+)*/) || ['1.0.0'])[0];
    const quad = (numeric.split('.').concat(['0', '0', '0', '0'])).slice(0, 4).join('.');
    try {
      run(rcedit, [
        exe,
        '--set-icon', ico,
        '--set-version-string', 'ProductName', 'EasyVideo',
        '--set-version-string', 'FileDescription', 'EasyVideo',
        '--set-version-string', 'CompanyName', 'EasyVideo',
        '--set-version-string', 'LegalCopyright', 'EasyVideo',
        '--set-version-string', 'OriginalFilename', 'EasyVideo.exe',
        '--set-file-version', quad,
        '--set-product-version', quad
      ]);
      console.log('[build]   icon + version resource applied (' + quad + ')');
    } catch (err) { console.log('[build]   icon step skipped: ' + err.message); }
  } else {
    console.log('[build]   rcedit or icon.ico missing - exe keeps the default icon');
  }

  const finalSize = fs.statSync(exe).size;
  console.log('[build] EXE ' + path.relative(root, exe) + '  ' + (finalSize / 1048576).toFixed(1) + ' MiB');
}

main().then(
  // esbuild keeps its service process alive, which would hang a build run
  // forever; the EXE is already written by this point, so exit explicitly.
  () => process.exit(0),
  (err) => { console.error('[build] FAILED: ' + (err && err.stack ? err.stack : err)); process.exit(1); }
);
 