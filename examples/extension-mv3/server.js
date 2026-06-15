// Local-only PhantomStream Chromium MV3 extension demo server.
//
// The server provides deterministic source/viewer pages, a bundled WebSocket
// relay, and a generated unpacked extension fixture for manual browser loading.

import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { getBrowserInjectSource } from '../../src/adapters/browser-inject.js';
import { createRelay, createWebSocketRelayBackend } from '../../src/relay/index.js';

const ROOT = resolve(fileURLToPath(new URL('../../', import.meta.url)));
const DEMO_DIR = resolve(fileURLToPath(new URL('./', import.meta.url)));
const HOST = '127.0.0.1';
const DEFAULT_PORT = 8645;
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
 * Start the local MV3 extension demo server.
 *
 * @param {{host?: string, port?: number, roomKey?: string, logger?: Object}} [options]
 * @returns {Promise<{
 *   host: string,
 *   port: number,
 *   sourceUrl: string,
 *   viewerUrl: string,
 *   sourceWsUrl: string,
 *   viewerWsUrl: string,
 *   extensionDir: string,
 *   roomKey: string,
 *   roomKeyPrefix: string,
 *   server: import('node:http').Server,
 *   relay: ReturnType<typeof createRelay>,
 *   backend: ReturnType<typeof createWebSocketRelayBackend>,
 *   close: () => Promise<void>
 * }>}
 */
export async function startExtensionDemoServer(options = {}) {
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
    var handle = await createExtensionDemoServerHandle({ logger: options.logger });
    try {
      await listen(handle.server, host, port);
      var address = handle.server.address();
      var actualPort = typeof address === 'object' && address ? address.port : port;
      var urls = buildExtensionDemoUrls({ host, port: actualPort, roomKey });
      return Object.assign({
        host,
        port: actualPort,
        roomKey,
        roomKeyPrefix: roomKey.slice(0, 8),
        sourceUrl: urls.sourceUrl,
        viewerUrl: urls.viewerUrl,
        sourceWsUrl: urls.sourceWsUrl,
        viewerWsUrl: urls.viewerWsUrl,
      }, handle);
    } catch (err) {
      lastError = err;
      await closeHandle(handle);
      if (!err || err.code !== 'EADDRINUSE' || requestedPort === 0) break;
    }
  }

  throw lastError || new Error('demo-server-start-failed');
}

async function createExtensionDemoServerHandle(options) {
  var logger = options.logger || {};
  var relay = createRelay({ logger });
  var server = createServer(handleExtensionRequest);
  var backend = createWebSocketRelayBackend({
    server,
    relay,
    path: '/ws',
    logger
  });
  var extensionDir = await createExtensionFixture();
  var closed = false;

  async function close() {
    if (closed) return;
    closed = true;
    await closeHandle({ server, backend, relay, extensionDir });
  }

  return { server, relay, backend, extensionDir, close };
}

async function createExtensionFixture() {
  var extensionDir = await mkdtemp(join(tmpdir(), 'phantomstream-extension-mv3-'));
  var manifest = {
    manifest_version: 3,
    name: 'PhantomStream MV3 Demo',
    version: '0.1.0',
    permissions: ["alarms", "storage", "scripting", "activeTab"],
    background: { service_worker: 'service-worker.js', type: 'module' },
    host_permissions: ['http://127.0.0.1/*'],
    content_scripts: [{
      matches: ['http://127.0.0.1/*'],
      js: ['content-script.js'],
      run_at: 'document_idle'
    }]
  };

  await Promise.all([
    writeFile(join(extensionDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8'),
    writeFile(join(extensionDir, 'service-worker.js'), createServiceWorkerSource(), 'utf8'),
    writeFile(join(extensionDir, 'content-script.js'), createContentScriptSource(), 'utf8')
  ]);
  return extensionDir;
}

function createServiceWorkerSource() {
  return [
    "const PHANTOMSTREAM_WATCHDOG_ALARM = 'phantomstream-watchdog';",
    "const PHANTOMSTREAM_SESSION_KEY = 'phantomstream:mv3-session';",
    "const CONTROL_START = 'dash:dom-stream-start';",
    "const sockets = new Map();",
    "function getSocket(wsUrl){var socket=sockets.get(wsUrl);if(socket&&socket.readyState<=1)return socket;socket=new WebSocket(wsUrl);sockets.set(wsUrl,socket);return socket;}",
    "function sendFrame(wsUrl,type,payload){if(!wsUrl)return;var socket=getSocket(wsUrl);var frame=JSON.stringify({type:type,payload:payload||{},ts:Date.now()});if(socket.readyState===1){socket.send(frame);return;}socket.addEventListener('open',function sendWhenOpen(){try{socket.send(frame);}catch(e){}},{once:true});}",
    "async function persistIntent(wsUrl,tabId){await chrome.storage.session.set({[PHANTOMSTREAM_SESSION_KEY]:{roomKey:null,wsUrl:wsUrl||null,tabId:typeof tabId==='number'?tabId:null,streamingActive:true,lifecycleIntent:CONTROL_START,pendingResnapshotReason:null,updatedAt:Date.now()}});}",
    "chrome.runtime.onMessage.addListener(function(request,sender){if(!request||request.type!=='phantomstream:bridge'||!request.message)return;var tabId=sender&&sender.tab?sender.tab.id:null;persistIntent(request.wsUrl,tabId).catch(function(){});sendFrame(request.wsUrl,request.message.type,request.message.payload||{});return true;});",
    "chrome.alarms.create(PHANTOMSTREAM_WATCHDOG_ALARM,{periodInMinutes:1});",
    "chrome.alarms.onAlarm.addListener(async function(alarm){if(!alarm||alarm.name!==PHANTOMSTREAM_WATCHDOG_ALARM)return;var out=await chrome.storage.session.get(PHANTOMSTREAM_SESSION_KEY);var state=out&&out[PHANTOMSTREAM_SESSION_KEY];if(!state||!state.streamingActive||typeof state.tabId!=='number')return;state.pendingResnapshotReason='mv3-watchdog-resnapshot';state.updatedAt=Date.now();await chrome.storage.session.set({[PHANTOMSTREAM_SESSION_KEY]:state});chrome.tabs.sendMessage(state.tabId,{type:'phantomstream:control',message:{type:CONTROL_START,payload:{reason:'mv3-watchdog-resnapshot'}}}).catch(function(){});});",
    ''
  ].join('\n');
}

function createContentScriptSource() {
  return [
    '(function(){',
    'var wsUrl=new URL(window.location.href).searchParams.get("ws");',
    'window.__phantomStreamBridge=function(msg){try{var result=chrome.runtime.sendMessage({type:"phantomstream:bridge",message:msg,wsUrl:wsUrl});if(result&&typeof result.catch==="function")result.catch(function(){});}catch(e){}};',
    'var source=', JSON.stringify(getBrowserInjectSource()), ';',
    'var script=document.createElement("script");',
    'script.text=source;',
    '(document.documentElement||document.head||document.body).appendChild(script);',
    'if(script.parentNode)script.parentNode.removeChild(script);',
    '}());',
    ''
  ].join('');
}

async function handleExtensionRequest(req, res) {
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

  if (pathname === '/extension/source') {
    await serveDemoAsset(req, res, 'source.html', 'text/html; charset=utf-8');
    return;
  }
  if (pathname === '/extension/viewer') {
    await serveDemoAsset(req, res, 'viewer.html', 'text/html; charset=utf-8');
    return;
  }
  if (pathname === '/extension/demo.css') {
    await serveDemoAsset(req, res, 'demo.css', 'text/css; charset=utf-8');
    return;
  }

  await handleStaticRequest(req, res, pathname);
}

async function serveDemoAsset(req, res, filename, contentType) {
  var filePath = resolve(DEMO_DIR, filename);
  try {
    var stats = await stat(filePath);
    if (stats.isFile()) {
      await serveFile(req, res, filePath);
      return;
    }
  } catch { /* 404 below */ }
  sendText(res, 404, 'not found', contentType);
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

function sendText(res, statusCode, text, contentType) {
  res.writeHead(statusCode, {
    'content-type': contentType || 'text/plain; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
  });
  res.end(text);
}

function buildExtensionDemoUrls(options) {
  var base = 'http://' + options.host + ':' + options.port;
  var sourceWsUrl = buildWsUrl(options, 'source');
  var viewerWsUrl = buildWsUrl(options, 'viewer');
  return {
    sourceUrl: buildPageUrl(base, '/extension/source', options.roomKey, sourceWsUrl),
    viewerUrl: buildPageUrl(base, '/extension/viewer', options.roomKey, viewerWsUrl),
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
  if (handle.extensionDir) {
    await rm(handle.extensionDir, { recursive: true, force: true });
  }
}

function isExpectedCloseError(err) {
  var message = err && err.message ? err.message : '';
  return /not running|closed/i.test(message);
}
