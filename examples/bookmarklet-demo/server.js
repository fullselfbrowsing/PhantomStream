// Local-only PhantomStream bookmarklet demo server.

import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createBookmarkletLoaderSource,
  createBookmarkletSource,
} from '../../src/adapters/bookmarklet.js';
import { createRelay, createWebSocketRelayBackend } from '../../src/relay/index.js';

const ROOT = resolve(fileURLToPath(new URL('../../', import.meta.url)));
const DEMO_DIR = resolve(fileURLToPath(new URL('./', import.meta.url)));
const HOST = '127.0.0.1';
const DEFAULT_PORT = 8646;
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

/**
 * Start the local bookmarklet demo server.
 *
 * @param {{host?: string, port?: number, roomKey?: string, logger?: Object}} [options]
 * @returns {Promise<{
 *   host: string,
 *   port: number,
 *   sourceUrl: string,
 *   viewerUrl: string,
 *   sourceWsUrl: string,
 *   viewerWsUrl: string,
 *   bookmarklet: string,
 *   roomKey: string,
 *   roomKeyPrefix: string,
 *   server: import('node:http').Server,
 *   relay: ReturnType<typeof createRelay>,
 *   backend: ReturnType<typeof createWebSocketRelayBackend>,
 *   close: () => Promise<void>
 * }>}
 */
export async function startBookmarkletDemoServer(options = {}) {
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
    var handle = createBookmarkletDemoServerHandle({ logger: options.logger });
    try {
      await listen(handle.server, host, port);
      var address = handle.server.address();
      var actualPort = typeof address === 'object' && address ? address.port : port;
      var urls = buildBookmarkletDemoUrls({ host, port: actualPort, roomKey });
      var bookmarklet = createBookmarkletSource({
        scriptUrl: urls.loaderUrl,
        wsUrl: urls.sourceWsUrl,
        roomKey
      });
      return Object.assign({
        host,
        port: actualPort,
        roomKey,
        roomKeyPrefix: roomKey.slice(0, 8),
        sourceUrl: urls.sourceUrl,
        viewerUrl: urls.viewerUrl,
        sourceWsUrl: urls.sourceWsUrl,
        viewerWsUrl: urls.viewerWsUrl,
        bookmarklet,
      }, handle);
    } catch (err) {
      lastError = err;
      await closeHandle(handle);
      if (!err || err.code !== 'EADDRINUSE' || requestedPort === 0) break;
    }
  }

  throw lastError || new Error('demo-server-start-failed');
}

function createBookmarkletDemoServerHandle(options) {
  var logger = options.logger || {};
  var relay = createRelay({ logger });
  var server = createServer(handleBookmarkletRequest);
  var backend = createWebSocketRelayBackend({
    server,
    relay,
    path: '/ws',
    logger
  });
  var closed = false;

  async function close() {
    if (closed) return;
    closed = true;
    await closeHandle({ server, backend, relay });
  }

  return { server, relay, backend, close };
}

async function handleBookmarkletRequest(req, res) {
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

  if (pathname === '/bookmarklet/source') {
    await serveDemoAsset(req, res, 'source.html');
    return;
  }
  if (pathname === '/bookmarklet/viewer') {
    await serveDemoAsset(req, res, 'viewer.html');
    return;
  }
  if (pathname === '/bookmarklet/demo.css') {
    await serveDemoAsset(req, res, 'demo.css');
    return;
  }
  if (pathname === '/bookmarklet/loader.js') {
    sendJavaScript(req, res, createBookmarkletLoaderSource());
    return;
  }

  await handleStaticRequest(req, res, pathname);
}

async function serveDemoAsset(req, res, filename) {
  var filePath = resolve(DEMO_DIR, filename);
  try {
    var stats = await stat(filePath);
    if (stats.isFile()) {
      await serveFile(req, res, filePath);
      return;
    }
  } catch { /* 404 below */ }
  sendText(res, 404, 'not found');
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
    await serveFile(req, res, filePath);
  } catch {
    sendText(res, 404, 'not found');
  }
}

function sendJavaScript(req, res, source) {
  res.writeHead(200, {
    'content-type': 'text/javascript; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
  });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  res.end(source);
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

function buildBookmarkletDemoUrls(options) {
  var base = 'http://' + options.host + ':' + options.port;
  var sourceWsUrl = buildWsUrl(options, 'source');
  var viewerWsUrl = buildWsUrl(options, 'viewer');
  return {
    sourceUrl: buildPageUrl(base, '/bookmarklet/source', options.roomKey, sourceWsUrl),
    viewerUrl: buildPageUrl(base, '/bookmarklet/viewer', options.roomKey, viewerWsUrl),
    loaderUrl: new URL('/bookmarklet/loader.js', base).toString(),
    sourceWsUrl,
    viewerWsUrl
  };
}

function buildWsUrl(options, role) {
  var url = new URL('ws://' + options.host + ':' + options.port + '/ws');
  url.searchParams.set('room', options.roomKey);
  url.searchParams.set('role', role);
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

async function closeHandle(handle) {
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
