import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { request } from 'node:http';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { startBookmarkletDemoServer } from '../examples/bookmarklet-demo/server.js';

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

async function withBookmarkletDemoServer(fn) {
  const demo = await startBookmarkletDemoServer({
    host: '127.0.0.1',
    port: 0,
  });
  try {
    return await fn(demo);
  } finally {
    await demo.close();
  }
}

test('startBookmarkletDemoServer binds local host and returns bookmarklet demo contract', async () => {
  await withBookmarkletDemoServer(async function (demo) {
    const address = demo.server.address();
    assert.equal(address.address, '127.0.0.1');
    assert.equal(String(address.port), new URL(demo.sourceUrl).port);
    assert.equal(String(address.port), new URL(demo.viewerUrl).port);
    assert.match(demo.roomKey, /^[a-f0-9]{32}$/);
    assert.equal(demo.roomKeyPrefix, demo.roomKey.slice(0, 8));
    assert.equal(demo.sourceWsUrl, new URL(demo.sourceUrl).searchParams.get('ws'));
    assert.equal(demo.viewerWsUrl, new URL(demo.viewerUrl).searchParams.get('ws'));
    assert.equal(demo.bookmarklet.startsWith('javascript:(()=>{'), true);
    assert.equal(demo.bookmarklet.includes(encodeURIComponent(demo.sourceWsUrl)), true);
  });
});

test('bookmarklet demo server rejects non-local hosts', async () => {
  await assert.rejects(
    startBookmarkletDemoServer({ host: '0.0.0.0', port: 0 }),
    /demo-host-local-only/
  );
});

test('bookmarklet demo static routes are served no-store', async () => {
  await withBookmarkletDemoServer(async function (demo) {
    const port = demo.server.address().port;

    const source = await get('/bookmarklet/source', port);
    assert.equal(source.statusCode, 200);
    assert.equal(source.headers['content-type'], 'text/html; charset=utf-8');
    assert.equal(source.headers['cache-control'], 'no-store');
    assert.match(source.body, /Add row/);
    assert.match(source.body, /Edit text/);
    assert.match(source.body, /Bookmarklet status/);

    const viewer = await get('/bookmarklet/viewer', port);
    assert.equal(viewer.statusCode, 200);
    assert.equal(viewer.headers['content-type'], 'text/html; charset=utf-8');
    assert.equal(viewer.headers['cache-control'], 'no-store');
    assert.match(viewer.body, /createViewer/);
    assert.match(viewer.body, /createWebSocketTransport/);

    const loader = await get('/bookmarklet/loader.js', port);
    assert.equal(loader.statusCode, 200);
    assert.equal(loader.headers['content-type'], 'text/javascript; charset=utf-8');
    assert.equal(loader.headers['cache-control'], 'no-store');
    assert.match(loader.body, /window\.__phantomStreamBridge/);
  });
});

test('CLI bookmarklet-demo prints local URLs bookmarklet and room', async () => {
  const child = spawn(process.execPath, [BIN, 'bookmarklet-demo', '--port', '0', '--no-open'], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';

  try {
    await new Promise(function (resolveOutput, rejectOutput) {
      const timer = setTimeout(function () {
        rejectOutput(new Error('bookmarklet-demo-cli-output-timeout'));
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
          rejectOutput(new Error('bookmarklet-demo-cli-exited-' + code + ': ' + stderr));
        }
      });
    });
  } finally {
    child.kill('SIGINT');
    await new Promise(function (resolveClose) {
      child.on('close', function () { resolveClose(); });
    });
  }

  assert.match(stdout, /PhantomStream bookmarklet demo running on 127\.0\.0\.1/);
  assert.match(stdout, /Source page: http:\/\/127\.0\.0\.1:\d+\/bookmarklet\/source\?room=/);
  assert.match(stdout, /Viewer: http:\/\/127\.0\.0\.1:\d+\/bookmarklet\/viewer\?room=/);
  assert.match(stdout, /Bookmarklet: javascript:\(\(\)=>\{/);
  assert.match(stdout, /Room: [a-f0-9]{8}\.\.\./);
});
