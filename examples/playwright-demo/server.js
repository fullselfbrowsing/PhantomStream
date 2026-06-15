// Local-only PhantomStream Playwright demo server.
//
// The server keeps Phase 04's local relay boundary intact while adding an
// optional Playwright driver process as the source endpoint for the room.

import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import WebSocket from 'ws';

import { createPlaywrightAdapter } from '../../src/adapters/playwright.js';
import { createRelay, createWebSocketRelayBackend } from '../../src/relay/index.js';
import { createWebSocketTransport } from '../../src/transport/websocket.js';

const ROOT = resolve(fileURLToPath(new URL('../../', import.meta.url)));
const DEMO_DIR = resolve(fileURLToPath(new URL('./', import.meta.url)));
const HOST = '127.0.0.1';
const DEFAULT_PORT = 8644;
const DEFAULT_PORT_ATTEMPTS = 20;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.map': 'application/json'
};

const FALLBACK_VIEWER_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>PhantomStream Playwright Demo Viewer</title>
<link rel="stylesheet" href="/playwright/demo.css">
</head>
<body>
<main class="playwright-shell">
  <h1>PhantomStream Playwright demo</h1>
  <p>Waiting for driven page UI assets.</p>
</main>
</body>
</html>
`;

const FALLBACK_FIXTURE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>PhantomStream Playwright Fixture</title>
<link rel="stylesheet" href="/playwright/demo.css">
</head>
<body>
<main class="fixture-shell">
  <h1>Playwright driven fixture</h1>
  <button type="button" id="driver-tick">Driver tick <span id="driver-count">0</span></button>
  <button type="button" id="click-target">Click target <span id="click-count">0</span></button>
  <label>Remote text <input id="remote-text" autocomplete="off"></label>
  <p id="remote-text-echo">0 chars</p>
</main>
<script>
(function () {
  var driverCount = document.getElementById('driver-count');
  var clickCount = document.getElementById('click-count');
  var input = document.getElementById('remote-text');
  var echo = document.getElementById('remote-text-echo');
  document.getElementById('driver-tick').addEventListener('click', function () {
    driverCount.textContent = String(Number(driverCount.textContent || '0') + 1);
  });
  document.getElementById('click-target').addEventListener('click', function () {
    clickCount.textContent = String(Number(clickCount.textContent || '0') + 1);
  });
  input.addEventListener('input', function () {
    echo.textContent = String(input.value.length) + ' chars';
  });
})();
</script>
</body>
</html>
`;

const FALLBACK_CSS = `* { box-sizing: border-box; }
body {
  background: #0f1117;
  color: #e0e0e0;
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  font-size: 15px;
  line-height: 1.5;
  padding: 24px;
}
button, input {
  min-height: 36px;
  border-radius: 6px;
}
.playwright-shell,
.fixture-shell {
  display: grid;
  gap: 16px;
  max-width: 720px;
}
`;

/**
 * Build local Playwright demo URLs for a bound server and room.
 *
 * @param {{host?: string, port: number, roomKey: string}} options
 * @returns {{viewerUrl: string, drivenPageUrl: string, wsUrl: string, viewerWsUrl: string}}
 */
export function buildPlaywrightDemoUrls(options) {
  var host = options.host || HOST;
  var port = Number(options.port);
  var roomKey = options.roomKey;
  var base = 'http://' + host + ':' + port;
  var sourceWsUrl = buildWsUrl({ host, port, roomKey, role: 'source' });
  var viewerWsUrl = buildWsUrl({ host, port, roomKey, role: 'viewer' });

  return {
    viewerUrl: buildPageUrl(base, '/playwright/viewer', roomKey, viewerWsUrl),
    drivenPageUrl: buildPageUrl(base, '/playwright/fixture', roomKey, sourceWsUrl),
    wsUrl: sourceWsUrl,
    viewerWsUrl: viewerWsUrl
  };
}

/**
 * Start the local Playwright demo server.
 *
 * @param {{
 *   host?: string,
 *   port?: number,
 *   roomKey?: string,
 *   launchDriver?: boolean,
 *   headed?: boolean,
 *   logger?: Object
 * }} [options]
 * @returns {Promise<{
 *   host: string,
 *   port: number,
 *   viewerUrl: string,
 *   drivenPageUrl: string,
 *   wsUrl: string,
 *   viewerWsUrl: string,
 *   roomKey: string,
 *   roomKeyPrefix: string,
 *   server: import('node:http').Server,
 *   relay: ReturnType<typeof createRelay>,
 *   backend: ReturnType<typeof createWebSocketRelayBackend>,
 *   driver?: { close: () => Promise<void> },
 *   close: () => Promise<void>
 * }>}
 */
export async function startPlaywrightDemoServer(options = {}) {
  var host = options.host || HOST;
  if (host !== HOST) throw new Error('demo-host-local-only');

  var requestedPort = options.port == null ? DEFAULT_PORT : Number(options.port);
  if (!Number.isInteger(requestedPort) || requestedPort < 0 || requestedPort > 65535) {
    throw new Error('demo-port-invalid');
  }

  var roomKey = typeof options.roomKey === 'string' && options.roomKey
    ? options.roomKey
    : randomBytes(16).toString('hex');
  var attempts = requestedPort === 0 ? 1 : DEFAULT_PORT_ATTEMPTS;
  var lastError = null;

  for (var i = 0; i < attempts; i++) {
    var port = requestedPort === 0 ? 0 : requestedPort + i;
    var handle = createPlaywrightDemoServerHandle({ logger: options.logger });
    try {
      await listen(handle.server, host, port);
      var address = handle.server.address();
      var actualPort = typeof address === 'object' && address ? address.port : port;
      var urls = buildPlaywrightDemoUrls({ host, port: actualPort, roomKey });
      var result = Object.assign({
        host,
        port: actualPort,
        roomKey,
        roomKeyPrefix: roomKey.slice(0, 8),
        viewerUrl: urls.viewerUrl,
        drivenPageUrl: urls.drivenPageUrl,
        wsUrl: urls.wsUrl,
        viewerWsUrl: urls.viewerWsUrl,
      }, handle);

      if (options.launchDriver) {
        result.driver = await launchPlaywrightDriver({
          drivenPageUrl: result.drivenPageUrl,
          wsUrl: result.wsUrl,
          headed: !!options.headed,
          logger: options.logger
        });
        handle.driver = result.driver;
      }

      return result;
    } catch (err) {
      lastError = err;
      await closeHandle(handle);
      if (!err || err.code !== 'EADDRINUSE' || requestedPort === 0) break;
    }
  }

  throw lastError || new Error('demo-server-start-failed');
}

function createPlaywrightDemoServerHandle(options) {
  var logger = options.logger || {};
  var relay = createRelay({ logger });
  var server = createServer(handlePlaywrightRequest);
  var backend = createWebSocketRelayBackend({
    server,
    relay,
    path: '/ws',
    logger
  });
  var closed = false;
  var handle = { server, relay, backend, driver: null, close };

  async function close() {
    if (closed) return;
    closed = true;
    await closeHandle(handle);
  }

  return handle;
}

async function handlePlaywrightRequest(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendText(res, 405, 'method not allowed');
    return;
  }

  var pathname;
  try {
    pathname = decodeURIComponent(String(req.url || '/').split('?')[0]);
  } catch {
    sendText(res, 400, 'bad request');
    return;
  }

  if (pathname === '/playwright/viewer') {
    await serveDemoAsset(req, res, 'viewer.html', FALLBACK_VIEWER_HTML, 'text/html; charset=utf-8');
    return;
  }
  if (pathname === '/playwright/fixture') {
    await serveDemoAsset(req, res, 'fixture.html', FALLBACK_FIXTURE_HTML, 'text/html; charset=utf-8');
    return;
  }
  if (pathname === '/playwright/demo.css') {
    await serveDemoAsset(req, res, 'demo.css', FALLBACK_CSS, 'text/css; charset=utf-8');
    return;
  }

  await handleStaticRequest(req, res, pathname);
}

async function serveDemoAsset(req, res, filename, fallback, contentType) {
  var filePath = resolve(DEMO_DIR, filename);
  try {
    var stats = await stat(filePath);
    if (stats.isFile()) {
      await serveFile(req, res, filePath, stats);
      return;
    }
  } catch { /* fallback below */ }

  res.writeHead(200, {
    'content-type': contentType,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
  });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  res.end(fallback);
}

async function handleStaticRequest(req, res, pathname) {
  var filePath = resolve(ROOT, '.' + pathname);
  if (filePath !== ROOT && !filePath.startsWith(ROOT + sep)) {
    sendText(res, 403, 'forbidden');
    return;
  }

  try {
    var stats = await stat(filePath);
    if (!stats.isFile()) {
      sendText(res, 404, 'not found');
      return;
    }
    await serveFile(req, res, filePath, stats);
  } catch {
    sendText(res, 404, 'not found');
  }
}

async function serveFile(req, res, filePath) {
  res.writeHead(200, {
    'content-type': MIME[extname(filePath)] || 'application/octet-stream',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
  });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  var stream = createReadStream(filePath);
  stream.on('error', function () { res.destroy(); });
  stream.pipe(res);
}

function sendText(res, statusCode, text) {
  res.writeHead(statusCode, {
    'content-type': 'text/plain; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
  });
  res.end(text);
}

function buildWsUrl(options) {
  var url = new URL('ws://' + options.host + ':' + options.port + '/ws');
  url.searchParams.set('room', options.roomKey);
  url.searchParams.set('role', options.role);
  return url.toString();
}

function buildPageUrl(base, pathname, roomKey, wsUrl) {
  var url = new URL(pathname, base);
  url.searchParams.set('room', roomKey);
  url.searchParams.set('ws', wsUrl);
  return url.toString();
}

function listen(server, host, port) {
  return new Promise(function (resolveListen, rejectListen) {
    function cleanup() {
      server.off('error', onError);
      server.off('listening', onListening);
    }
    function onError(err) {
      cleanup();
      rejectListen(err);
    }
    function onListening() {
      cleanup();
      resolveListen();
    }
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
}

async function launchPlaywrightDriver(options) {
  var browser = null;
  var context = null;
  var page = null;
  var transport = null;
  var adapter = null;
  var loop = null;

  async function close() {
    if (loop && typeof loop.close === 'function') await loop.close();
    if (adapter && typeof adapter.dispose === 'function') adapter.dispose();
    if (transport && typeof transport.close === 'function') transport.close();
    if (page && typeof page.isClosed === 'function' && !page.isClosed()) await page.close();
    if (context && typeof context.close === 'function') await context.close();
    if (browser && typeof browser.close === 'function') await browser.close();
  }

  try {
    var playwright = await import('playwright');
    browser = await playwright.chromium.launch({
      headless: options.headed ? false : true
    });
    context = await browser.newContext();
    page = await context.newPage();

    transport = createWebSocketTransport({
      url: options.wsUrl,
      role: 'source',
      WebSocket: WebSocket,
      logger: options.logger
    });
    await waitForTransportOpen(transport, 4000);

    adapter = createPlaywrightAdapter({
      page,
      transport,
      authorizeControl: function (request) {
        return !!(request && request.authorizationMode === 'approve');
      },
      logger: options.logger
    });
    await adapter.install();
    await page.goto(options.drivenPageUrl, { waitUntil: 'domcontentloaded' });
    loop = startDriverLoop(page, options.logger);

    return {
      browser,
      page,
      close
    };
  } catch (err) {
    await close();
    throw err;
  }
}

function waitForTransportOpen(transport, timeoutMs) {
  return new Promise(function (resolveOpen, rejectOpen) {
    var done = false;
    var unsubscribe = null;
    var timer = setTimeout(function () {
      finish(new Error('playwright-demo-transport-timeout'));
    }, timeoutMs);

    function finish(err) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (typeof unsubscribe === 'function') unsubscribe();
      if (err) rejectOpen(err);
      else resolveOpen();
    }

    unsubscribe = transport.onStatus(function (status) {
      if (status.state === 'open') finish(null);
      else if (status.state === 'error') finish(new Error(status.reason || 'playwright-demo-transport-error'));
    });
  });
}

function startDriverLoop(page, logger) {
  var stopped = false;
  var running = false;
  var tick = 0;
  var timer = setInterval(run, 1200);

  function safeLog(message, detail) {
    try {
      if (logger && typeof logger.warn === 'function') logger.warn(message, detail);
    } catch (e) { /* logging must not affect demo driver */ }
  }

  async function run() {
    if (stopped || running) return;
    running = true;
    tick += 1;
    try {
      await page.locator('#driver-tick').click({ timeout: 500 });
      await page.locator('#remote-text').fill('driver tick ' + tick, { timeout: 500 });
    } catch (err) {
      safeLog('[PlaywrightDemo] driver tick skipped', { reason: 'driver-target-missing' });
    } finally {
      running = false;
    }
  }

  run();

  return {
    close: async function closeDriverLoop() {
      stopped = true;
      clearInterval(timer);
      while (running) {
        await new Promise(function (resolveDelay) { setTimeout(resolveDelay, 10); });
      }
    }
  };
}

async function closeHandle(handle) {
  if (handle.driver && typeof handle.driver.close === 'function') {
    try {
      await handle.driver.close();
    } catch (err) {
      if (!isExpectedCloseError(err)) throw err;
    }
  }
  if (handle.backend && typeof handle.backend.close === 'function') {
    try {
      await handle.backend.close();
    } catch (err) {
      if (!isExpectedCloseError(err)) throw err;
    }
  }
  if (handle.server && handle.server.listening) {
    await new Promise(function (resolveClose, rejectClose) {
      handle.server.close(function (err) {
        if (err) rejectClose(err);
        else resolveClose();
      });
    });
  }
  if (handle.relay && typeof handle.relay.clear === 'function') {
    handle.relay.clear();
  }
}

function isExpectedCloseError(err) {
  var message = err && err.message ? err.message : '';
  return /not running|closed/i.test(message);
}
