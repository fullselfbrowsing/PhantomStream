import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { request } from 'node:http';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { startPlaywrightDemoServer } from '../examples/playwright-demo/server.js';

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

async function withPlaywrightDemoServer(fn) {
  const demo = await startPlaywrightDemoServer({
    host: '127.0.0.1',
    port: 0,
    launchDriver: false,
  });
  try {
    return await fn(demo);
  } finally {
    await demo.close();
  }
}

test('startPlaywrightDemoServer binds 127.0.0.1 and returns actual bound URLs', async () => {
  await withPlaywrightDemoServer(async function (demo) {
    const address = demo.server.address();
    assert.equal(address.address, '127.0.0.1');
    assert.equal(String(address.port), new URL(demo.viewerUrl).port);
    assert.equal(String(address.port), new URL(demo.drivenPageUrl).port);
    assert.match(demo.roomKey, /^[a-f0-9]{32}$/);
    assert.equal(demo.roomKeyPrefix, demo.roomKey.slice(0, 8));

    const viewer = new URL(demo.viewerUrl);
    const driven = new URL(demo.drivenPageUrl);
    assert.equal(viewer.hostname, '127.0.0.1');
    assert.equal(driven.hostname, '127.0.0.1');
    assert.equal(viewer.pathname, '/playwright/viewer');
    assert.equal(driven.pathname, '/playwright/fixture');
    assert.equal(viewer.searchParams.get('room'), demo.roomKey);
    assert.equal(driven.searchParams.get('room'), demo.roomKey);
    assert.equal(viewer.searchParams.get('ws'), demo.viewerWsUrl);
    assert.equal(driven.searchParams.get('ws'), demo.wsUrl);

    const sourceWs = new URL(demo.wsUrl);
    const viewerWs = new URL(demo.viewerWsUrl);
    assert.equal(sourceWs.protocol, 'ws:');
    assert.equal(viewerWs.protocol, 'ws:');
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

test('Playwright demo server rejects non-local hosts', async () => {
  await assert.rejects(
    startPlaywrightDemoServer({ host: '0.0.0.0', port: 0, launchDriver: false }),
    /demo-host-local-only/
  );
});

test('Playwright demo static assets are served no-store', async () => {
  await withPlaywrightDemoServer(async function (demo) {
    const port = demo.server.address().port;

    const viewer = await get('/playwright/viewer', port);
    assert.equal(viewer.statusCode, 200);
    assert.equal(viewer.headers['content-type'], 'text/html; charset=utf-8');
    assert.equal(viewer.headers['cache-control'], 'no-store');

    const fixture = await get('/playwright/fixture', port);
    assert.equal(fixture.statusCode, 200);
    assert.equal(fixture.headers['content-type'], 'text/html; charset=utf-8');
    assert.equal(fixture.headers['cache-control'], 'no-store');

    const css = await get('/playwright/demo.css', port);
    assert.equal(css.statusCode, 200);
    assert.equal(css.headers['content-type'], 'text/css; charset=utf-8');
    assert.equal(css.headers['cache-control'], 'no-store');
  });
});

test('CLI playwright-demo prints local viewer driven page room and default-deny lines', async () => {
  const child = spawn(process.execPath, [BIN, 'playwright-demo', '--port', '0', '--no-open'], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';

  try {
    await new Promise(function (resolveOutput, rejectOutput) {
      const timer = setTimeout(function () {
        rejectOutput(new Error('playwright-demo-cli-output-timeout'));
      }, 4000);

      child.stdout.on('data', function (chunk) {
        stdout += chunk.toString('utf8');
        if (/Control: default-deny/.test(stdout)) {
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
        if (!/Control: default-deny/.test(stdout)) {
          clearTimeout(timer);
          rejectOutput(new Error('playwright-demo-cli-exited-' + code + ': ' + stderr));
        }
      });
    });
  } finally {
    child.kill('SIGINT');
    await new Promise(function (resolveClose) {
      child.on('close', function () { resolveClose(); });
    });
  }

  assert.match(stdout, /PhantomStream Playwright demo running on 127\.0\.0\.1/);
  assert.match(stdout, /Viewer: http:\/\/127\.0\.0\.1:\d+\/playwright\/viewer\?room=/);
  assert.match(stdout, /Driven page: http:\/\/127\.0\.0\.1:\d+\/playwright\/fixture\?room=/);
  assert.match(stdout, /Room: [a-f0-9]{8}\.\.\./);
  assert.match(stdout, /Control: default-deny/);
});

test('CLI help includes Playwright demo flags', () => {
  const result = spawnSync(process.execPath, [BIN, 'playwright-demo', '--help'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /playwright-demo/);
  assert.match(result.stdout, /--port/);
  assert.match(result.stdout, /--drive/);
  assert.match(result.stdout, /--headed/);
  assert.match(result.stdout, /--no-open/);
});

test('package metadata exposes demo:playwright script', async () => {
  const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts['demo:playwright'], 'node bin/phantom-stream.js playwright-demo');
});
