import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { request } from 'node:http';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { startExtensionDemoServer } from '../examples/extension-mv3/server.js';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const BIN = join(ROOT, 'bin/phantom-stream.js');

async function get(pathname, port) {
  return new Promise(function (resolveRequest, rejectRequest) {
    const req = request({
      host: '127.0.0.1',
      port,
      path: pathname,
      method: 'GET',
    }, function (res) {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', function (chunk) { body += chunk; });
      res.on('end', function () {
        resolveRequest({
          statusCode: res.statusCode,
          headers: res.headers,
          body,
        });
      });
    });
    req.on('error', rejectRequest);
    req.end();
  });
}

async function withExtensionDemoServer(fn) {
  const demo = await startExtensionDemoServer({
    host: '127.0.0.1',
    port: 0,
  });
  try {
    return await fn(demo);
  } finally {
    await demo.close();
  }
}

test('startExtensionDemoServer binds local host and returns extension demo contract', async () => {
  await withExtensionDemoServer(async function (demo) {
    const address = demo.server.address();
    assert.equal(address.address, '127.0.0.1');
    assert.equal(String(address.port), new URL(demo.sourceUrl).port);
    assert.equal(String(address.port), new URL(demo.viewerUrl).port);
    assert.match(demo.roomKey, /^[a-f0-9]{32}$/);
    assert.equal(demo.roomKeyPrefix, demo.roomKey.slice(0, 8));
    assert.equal(demo.sourceWsUrl, new URL(demo.sourceUrl).searchParams.get('ws'));
    assert.equal(demo.viewerWsUrl, new URL(demo.viewerUrl).searchParams.get('ws'));
    assert.match(demo.extensionDir, /phantomstream-extension-mv3-/);

    const manifest = JSON.parse(await readFile(join(demo.extensionDir, 'manifest.json'), 'utf8'));
    assert.equal(manifest.manifest_version, 3);
    assert.deepEqual(manifest.permissions, ['alarms', 'storage', 'scripting', 'activeTab']);
    assert.deepEqual(manifest.background, { service_worker: 'service-worker.js', type: 'module' });
    assert.deepEqual(manifest.host_permissions, ['http://127.0.0.1/*']);

    const serviceWorker = await readFile(join(demo.extensionDir, 'service-worker.js'), 'utf8');
    const contentScript = await readFile(join(demo.extensionDir, 'content-script.js'), 'utf8');
    assert.match(serviceWorker, /phantomstream-watchdog/);
    assert.match(serviceWorker, /mv3-watchdog-resnapshot/);
    assert.match(contentScript, /window\.__phantomStreamBridge/);
    assert.match(contentScript, /window\.postMessage/);
    assert.match(contentScript, /chrome\.runtime\.sendMessage/);
  });
});

test('extension demo server rejects non-local hosts', async () => {
  await assert.rejects(
    startExtensionDemoServer({ host: '0.0.0.0', port: 0 }),
    /demo-host-local-only/
  );
});

test('extension demo static pages are served no-store', async () => {
  await withExtensionDemoServer(async function (demo) {
    const port = demo.server.address().port;

    const source = await get('/extension/source', port);
    assert.equal(source.statusCode, 200);
    assert.equal(source.headers['content-type'], 'text/html; charset=utf-8');
    assert.equal(source.headers['cache-control'], 'no-store');
    assert.match(source.body, /PhantomStream Extension MV3 Source/);

    const viewer = await get('/extension/viewer', port);
    assert.equal(viewer.statusCode, 200);
    assert.equal(viewer.headers['content-type'], 'text/html; charset=utf-8');
    assert.equal(viewer.headers['cache-control'], 'no-store');
    assert.match(viewer.body, /PhantomStream Extension MV3 Viewer/);
  });
});

test('CLI extension-demo prints local URLs extension directory and room', async () => {
  const child = spawn(process.execPath, [BIN, 'extension-demo', '--port', '0', '--no-open'], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';

  try {
    await new Promise(function (resolveOutput, rejectOutput) {
      const timer = setTimeout(function () {
        rejectOutput(new Error('extension-demo-cli-output-timeout'));
      }, 4000);

      child.stdout.on('data', function (chunk) {
        stdout += chunk.toString('utf8');
        if (/Room:/.test(stdout)) {
          clearTimeout(timer);
          resolveOutput();
        }
      });
      child.stderr.on('data', function (chunk) {
        stderr += chunk.toString('utf8');
      });
      child.on('error', function (err) {
        clearTimeout(timer);
        rejectOutput(err);
      });
      child.on('exit', function (code) {
        if (!/Room:/.test(stdout)) {
          clearTimeout(timer);
          rejectOutput(new Error('extension-demo-cli-exited-' + code + ': ' + stderr));
        }
      });
    });
  } finally {
    child.kill('SIGINT');
    await new Promise(function (resolveClose) {
      child.on('close', function () { resolveClose(); });
    });
  }

  assert.match(stdout, /PhantomStream extension demo running on 127\.0\.0\.1/);
  assert.match(stdout, /Extension directory: .+phantomstream-extension-mv3-/);
  assert.match(stdout, /Source page: http:\/\/127\.0\.0\.1:\d+\/extension\/source\?room=/);
  assert.match(stdout, /Viewer: http:\/\/127\.0\.0\.1:\d+\/extension\/viewer\?room=/);
  assert.match(stdout, /Room: [a-f0-9]{8}\.\.\./);
});
