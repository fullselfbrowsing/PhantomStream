import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { startDemoServer } from '../examples/two-tab-demo/server.js';

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

async function withDemoServer(fn) {
  const demo = await startDemoServer({ host: '127.0.0.1', port: 0 });
  try {
    return await fn(demo);
  } finally {
    await demo.close();
  }
}

test('startDemoServer binds 127.0.0.1 and returns paired room URLs', async () => {
  await withDemoServer(async function (demo) {
    const address = demo.server.address();
    assert.equal(address.address, '127.0.0.1');
    assert.equal(address.port, new URL(demo.sourceUrl).port);
    assert.equal(address.port, new URL(demo.viewerUrl).port);
    assert.match(demo.roomKey, /^[a-f0-9]{32}$/);
    assert.equal(demo.roomKeyPrefix, demo.roomKey.slice(0, 8));

    const source = new URL(demo.sourceUrl);
    const viewer = new URL(demo.viewerUrl);
    assert.equal(source.hostname, '127.0.0.1');
    assert.equal(viewer.hostname, '127.0.0.1');
    assert.equal(source.searchParams.get('room'), demo.roomKey);
    assert.equal(viewer.searchParams.get('room'), demo.roomKey);

    const sourceWs = new URL(source.searchParams.get('ws'));
    const viewerWs = new URL(viewer.searchParams.get('ws'));
    assert.equal(sourceWs.hostname, '127.0.0.1');
    assert.equal(viewerWs.hostname, '127.0.0.1');
    assert.equal(sourceWs.pathname, '/ws');
    assert.equal(viewerWs.pathname, '/ws');
    assert.equal(sourceWs.searchParams.get('room'), demo.roomKey);
    assert.equal(viewerWs.searchParams.get('room'), demo.roomKey);
    assert.equal(sourceWs.searchParams.get('role'), 'source');
    assert.equal(viewerWs.searchParams.get('role'), 'viewer');
  });
});

test('demo static server serves strict MIME types and rejects unsafe paths', async () => {
  const tempDir = await mkdtemp(join(ROOT, '.tmp-demo-server-'));
  try {
    await writeFile(join(tempDir, 'style.css'), 'body { color: white; }\n', 'utf8');
    await withDemoServer(async function (demo) {
      const port = demo.server.address().port;

      const html = await get('/examples/loopback-mirror.html', port);
      assert.equal(html.statusCode, 200);
      assert.equal(html.headers['content-type'], 'text/html; charset=utf-8');

      const js = await get('/examples/loopback-transport.js', port);
      assert.equal(js.statusCode, 200);
      assert.equal(js.headers['content-type'], 'text/javascript; charset=utf-8');

      const css = await get('/' + tempDir.slice(ROOT.length + 1) + '/style.css', port);
      assert.equal(css.statusCode, 200);
      assert.equal(css.headers['content-type'], 'text/css; charset=utf-8');

      const malformed = await get('/%E0%A4%A', port);
      assert.equal(malformed.statusCode, 400);

      const traversal = await get('/%2e%2e/package.json', port);
      assert.equal(traversal.statusCode, 403);

      const directory = await get('/examples/', port);
      assert.equal(directory.statusCode, 404);
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('CLI help prints usage without starting the demo server', () => {
  const result = spawnSync(process.execPath, [BIN, 'demo', '--help'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Usage: phantom-stream demo/);
  assert.doesNotMatch(result.stdout, /PhantomStream demo running on 127\.0\.0\.1/);
});

test('CLI demo prints deterministic source viewer and room lines', async () => {
  const child = spawn(process.execPath, [BIN, 'demo', '--port', '0', '--no-open'], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';

  try {
    await new Promise(function (resolveOutput, rejectOutput) {
      const timer = setTimeout(function () {
        rejectOutput(new Error('demo-cli-output-timeout'));
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
          rejectOutput(new Error('demo-cli-exited-' + code + ': ' + stderr));
        }
      });
    });
  } finally {
    child.kill('SIGINT');
    await new Promise(function (resolveClose) {
      child.on('close', function () { resolveClose(); });
    });
  }

  assert.match(stdout, /PhantomStream demo running on 127\.0\.0\.1/);
  assert.match(stdout, /Source tab: http:\/\/127\.0\.0\.1:\d+\/examples\/two-tab-demo\/source\.html\?room=/);
  assert.match(stdout, /Viewer tab: http:\/\/127\.0\.0\.1:\d+\/examples\/two-tab-demo\/viewer\.html\?room=/);
  assert.match(stdout, /Room: [a-f0-9]{8}/);
});

test('package metadata exposes the phantom-stream binary', async () => {
  const pkg = JSON.parse((await import('node:fs/promises')).readFile
    ? await (await import('node:fs/promises')).readFile(join(ROOT, 'package.json'), 'utf8')
    : '{}');
  assert.equal(pkg.bin['phantom-stream'], './bin/phantom-stream.js');
});
