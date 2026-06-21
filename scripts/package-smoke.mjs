import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const PACKAGE_JSON = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'));

let tarballPath = null;
let tempDir = null;

try {
  tempDir = await mkdtemp(join(tmpdir(), 'phantom-stream-package-'));
  const packed = await run('npm', ['pack', '--json', '--pack-destination', tempDir], { cwd: ROOT });
  const packEntries = JSON.parse(packed.stdout);
  if (!Array.isArray(packEntries) || !packEntries[0] || !packEntries[0].filename) {
    throw new Error('npm-pack-json-missing-filename');
  }

  const metadata = packEntries[0];
  tarballPath = resolve(tempDir, metadata.filename);
  assertPackedFiles(metadata.files || []);

  await run('npm', ['init', '-y'], { cwd: tempDir });
  await run('npm', ['install', tarballPath], { cwd: tempDir });

  // Zero-hard-dependency proof (Phase 14-05 / MADPT-01) — runs FIRST, before the broad
  // subpath loop below, so a renderer regression is attributed by THIS named check rather
  // than surfacing as a generic ERR_MODULE_NOT_FOUND buried among the other subpaths. The
  // temp sandbox installs ONLY PhantomStream + its hard deps ({ ws }); hls.js is an OPTIONAL
  // peerDependency and is NOT installed here. Importing the `./renderer` subpath must still
  // succeed — it does only because src/renderer/media-player.js references hls.js via a
  // dynamic `import('hls.js')` inside tryLazyImportHls(), never a top-level import. A
  // regression (a top-level `import 'hls.js'` anywhere reachable from `./renderer`) throws
  // ERR_MODULE_NOT_FOUND, which this step turns into a clear, attributable
  // `zero-hard-dep-violation` failure. Do NOT install hls.js in this sandbox — its ABSENCE
  // is the proof.
  await assertHlsNotInstalled(tempDir);
  await run(process.execPath, ['--input-type=module', '-e', buildZeroHardDepRendererCheckSource()], {
    cwd: tempDir,
  });

  await run(process.execPath, ['--input-type=module', '-e', buildImportCheckSource()], {
    cwd: tempDir,
  });
  await run(process.execPath, ['node_modules/.bin/phantom-stream', '--help'], {
    cwd: tempDir,
  });
} finally {
  if (tarballPath) await rm(tarballPath, { force: true });
  if (tempDir) await rm(tempDir, { force: true, recursive: true });
}

function assertPackedFiles(files) {
  const packedPaths = new Set(files.map(function (entry) {
    return 'package/' + String(entry.path || '').replace(/\\/g, '/');
  }));

  for (const required of [
    'package/src/index.js',
    'package/dist/types/index.d.ts',
    'package/bin/phantom-stream.js',
    'package/README.md',
    'package/LICENSE',
  ]) {
    if (!packedPaths.has(required)) {
      throw new Error('packed-file-missing:' + required);
    }
  }

  for (const forbidden of [
    'package/.planning/',
    'package/reference/',
    'package/tests/',
    'package/.context/',
  ]) {
    for (const packedPath of packedPaths) {
      if (packedPath === forbidden.slice(0, -1) || packedPath.startsWith(forbidden)) {
        throw new Error('packed-file-forbidden:' + packedPath);
      }
    }
  }
}

function buildImportCheckSource() {
  const specifiers = Object.keys(PACKAGE_JSON.exports || {}).map(function (key) {
    return key === '.'
      ? PACKAGE_JSON.name
      : PACKAGE_JSON.name + '/' + key.slice(2);
  });

  return specifiers.map(function (specifier) {
    return 'await import(' + JSON.stringify(specifier) + ');';
  }).join('\n');
}

// Hard-fail if hls.js somehow got installed into the smoke sandbox: its ABSENCE is the
// load-bearing proof of the zero-hard-dependency guarantee. A present hls.js would let a
// regressed top-level import pass silently, defeating buildZeroHardDepRendererCheckSource().
async function assertHlsNotInstalled(dir) {
  try {
    await readFile(join(dir, 'node_modules', 'hls.js', 'package.json'), 'utf8');
  } catch {
    return; // expected path: hls.js is not installed
  }
  throw new Error(
    'zero-hard-dep-smoke-misconfigured: hls.js is installed in the smoke sandbox — ' +
      'it must stay ABSENT so the ./renderer import proves the dynamic-import-only contract',
  );
}

// Focused, NAMED zero-hard-dep assertion: import ONLY the `./renderer` subpath in the
// hls.js-absent sandbox and translate any failure into an attributable message. This is the
// single most important packaging guarantee of Phase 14 (the renderer's hls.js import is
// dynamic-only); see the call site for the full rationale.
function buildZeroHardDepRendererCheckSource() {
  const rendererSpecifier = PACKAGE_JSON.name + '/renderer';
  return [
    'try {',
    '  await import(' + JSON.stringify(rendererSpecifier) + ');',
    '} catch (error) {',
    '  const detail = (error && error.message) ? error.message : String(error);',
    '  throw new Error(',
    '    "zero-hard-dep-violation: ' + rendererSpecifier + ' requires hls.js to import — " +',
    '    "hls.js must be referenced via a dynamic import(\'hls.js\') only, never a top-level import " +',
    '    "(hls.js is an OPTIONAL peerDependency and is NOT installed here). Underlying error: " + detail',
    '  );',
    '}',
  ].join('\n');
}

function run(command, args, options = {}) {
  return new Promise(function (resolveRun, rejectRun) {
    const child = spawn(command, args, {
      cwd: options.cwd || ROOT,
      env: Object.assign({}, process.env, options.env || {}),
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', function (chunk) {
      stdout += chunk;
    });
    child.stderr.on('data', function (chunk) {
      stderr += chunk;
    });
    child.on('error', rejectRun);
    child.on('close', function (code, signal) {
      if (code === 0) {
        resolveRun({ stdout, stderr });
        return;
      }
      const error = new Error([
        'command-failed:' + command + ' ' + args.join(' '),
        'exit=' + code,
        signal ? 'signal=' + signal : '',
        stdout,
        stderr,
      ].filter(Boolean).join('\n'));
      rejectRun(error);
    });
  });
}
