# Phase 04: Relay, WS Transport & Two-Tab Demo - Pattern Map

**Mapped:** 2026-06-14 23:35 CDT  
**Files analyzed:** 21  
**Analogs found:** 21 / 21  
**Project-local skills:** none found under `.claude/skills/` or `.agents/skills/`

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `package.json` | config | request-response | `package.json` | exact |
| `package-lock.json` | config | batch | `package-lock.json` | exact-mechanical |
| `bin/phantom-stream.js` | utility | request-response | `examples/serve.js` | role-match |
| `src/relay/index.js` | route | request-response | `src/protocol/index.js` + `src/relay/README.md` | role-match |
| `src/relay/relay.js` | service | request-response | `reference/server/ws-handler.js` | exact |
| `src/relay/limits.js` | utility | transform | `src/protocol/constants.js` + `src/protocol/envelope.js` | role-match |
| `src/relay/backends/ws.js` | service | event-driven | `reference/server/ws-handler.js` | exact |
| `src/transport/websocket.js` | service | streaming | `examples/loopback-transport.js` + `reference/extension/ws-client.js` | exact |
| `src/renderer/index.js` | component | event-driven | `src/renderer/index.js` | exact |
| `tests/renderer-viewer.test.js` | test | request-response | `tests/renderer-viewer.test.js` | exact |
| `examples/two-tab-demo/source.html` | component | event-driven | `examples/loopback-mirror.html` | exact |
| `examples/two-tab-demo/viewer.html` | component | streaming | `examples/loopback-mirror.html` | exact |
| `examples/two-tab-demo/demo.css` | component | transform | `examples/loopback-mirror.html` | exact |
| `examples/two-tab-demo/source.js` | utility | event-driven | `examples/loopback-mirror.html` | exact |
| `examples/two-tab-demo/viewer.js` | utility | event-driven | `examples/loopback-mirror.html` | exact |
| `examples/two-tab-demo/server.js` | service | file-I/O | `examples/serve.js` | exact |
| `tests/relay-core.test.js` | test | request-response | `reference/server/ws-handler.js` + `tests/protocol.test.js` | role-match |
| `tests/relay-ws-backend.test.js` | test | event-driven | `reference/server/ws-handler.js` + `examples/serve.js` | role-match |
| `tests/websocket-transport.test.js` | test | streaming | `tests/protocol.test.js` + `examples/loopback-transport.js` | role-match |
| `tests/renderer-health-events.test.js` | test | event-driven | `tests/renderer-viewer.test.js` | exact |
| `tests/demo-cli.test.js` | test | file-I/O | `examples/serve.js` + `tests/renderer-loopback.test.js` | role-match |

## Pattern Assignments

### `package.json` (config, request-response)

**Analog:** `package.json`

**Existing package surface** (lines 1-15):
```json
{
  "name": "@fullselfbrowsing/phantom-stream",
  "version": "0.1.0",
  "description": "DOM-native live browser mirroring: snapshot + MutationObserver diff streaming with stable node identity, compressed transport, and bidirectional remote control.",
  "type": "module",
  "main": "src/protocol/index.js",
  "exports": {
    "./protocol": "./src/protocol/index.js",
    "./capture": "./src/capture/index.js",
    "./renderer": "./src/renderer/index.js"
  },
  "scripts": {
    "test": "node --test tests/*.test.js tests/differential/*.test.js",
    "example:loopback": "node examples/serve.js"
  },
```

**Pattern to copy:** keep existing `type: "module"`, named subpath exports, and `node --test` script style. Add `bin.phantom-stream`, preserve current `./protocol`, `./capture`, `./renderer` exports, and add relay/transport exports without moving existing entry points. Add `ws` as a runtime dependency, not a browser-injected dependency.

---

### `package-lock.json` (config, batch)

**Analog:** `package-lock.json`

**Lockfile root pattern** (lines 1-14):
```json
{
  "name": "@fullselfbrowsing/phantom-stream",
  "version": "0.1.0",
  "lockfileVersion": 3,
  "requires": true,
  "packages": {
    "": {
      "name": "@fullselfbrowsing/phantom-stream",
      "version": "0.1.0",
      "license": "MIT",
      "devDependencies": {
        "jsdom": "^29.1.1"
      }
    },
```

**Pattern to copy:** do not hand-edit except through npm. Implementation should run `npm install ws@8.21.0` or equivalent so root `dependencies` and `node_modules/ws` entries are generated consistently with lockfile v3.

---

### `bin/phantom-stream.js` (utility, request-response)

**Analog:** `examples/serve.js`

**Imports and local bind pattern** (lines 22-32):
```javascript
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const HOST = '127.0.0.1'; // localhost only (T-02-17)
const PORT = 8642;
```

**Terminal output precedent** (lines 95-97):
```javascript
server.listen(PORT, HOST, () => {
  console.log(`loopback demo: http://localhost:${PORT}/examples/loopback-mirror.html`);
});
```

**Pattern to copy:** make the bin an ESM executable with a tiny manual subcommand parser. For `demo`, import `examples/two-tab-demo/server.js`, bind only `127.0.0.1`, and print actual bound URLs. Do not add a CLI framework for one subcommand.

---

### `src/relay/index.js` (route, request-response)

**Analog:** `src/protocol/index.js`, `src/relay/README.md`

**Barrel pattern** (`src/protocol/index.js` inferred from project convention):
```javascript
export * from './constants.js';
export * from './messages.js';
export * from './envelope.js';
```

**Planned relay split** (`src/relay/README.md` lines 10-15):
```text
relay.js        message routing: capture host <-> N viewers, per-stream addressing
limits.js       per-message size enforcement + oversize classification (envelope-aware)
backends/ws.js  WebSocket backend (reference behavior)
index.js        createRelay({ backend, limits })
```

**Pattern to copy:** expose named exports only, with explicit `.js` extensions. Re-export `relay.js`, `limits.js`, and `backends/ws.js`; do not create a default export.

---

### `src/relay/relay.js` (service, request-response)

**Analog:** `reference/server/ws-handler.js`

**Diagnostics shape** (lines 23-50):
```javascript
function getOrCreateRoomDiagnostics(hashKey) {
  if (!roomDiagnostics.has(hashKey)) {
    roomDiagnostics.set(hashKey, {
      events: [],
      receivedByType: {},
      deliveredByType: {},
      droppedByType: {},
      lastClose: null
    });
  }

  return roomDiagnostics.get(hashKey);
}

function pushRoomDiagnosticEvent(hashKey, details) {
  const diagnostics = getOrCreateRoomDiagnostics(hashKey);
  const entry = Object.assign({ ts: Date.now() }, details || {});
  diagnostics.events.push(entry);
  if (diagnostics.events.length > ROOM_DIAGNOSTIC_LIMIT) {
    diagnostics.events.shift();
  }
  return entry;
}
```

**Backpressure and send fan-out** (lines 80-145):
```javascript
function sendToClients(hashKey, clients, data, messageType, direction) {
  const type = messageType || 'unknown';
  let targetCount = 0;
  let deliveredCount = 0;
  let droppedCount = 0;

  for (const client of clients) {
    targetCount += 1;
    if (client.readyState !== WebSocket.OPEN) {
      droppedCount += 1;
      continue;
    }

    if (typeof client.bufferedAmount === 'number'
        && client.bufferedAmount > BACKPRESSURE_BUFFER_LIMIT_BYTES) {
      backpressureDroppedCount += 1;
      droppedCount += 1;
      pushRoomDiagnosticEvent(hashKey, {
        event: 'backpressure-drop',
        direction,
        type,
        bufferedAmount: client.bufferedAmount,
        limitBytes: BACKPRESSURE_BUFFER_LIMIT_BYTES
      });
      continue;
    }

    try {
      client.send(data);
      deliveredCount += 1;
    } catch {
      droppedCount += 1;
    }
  }

  incrementRoomCounter(hashKey, 'deliveredByType', type, deliveredCount);
  incrementRoomCounter(hashKey, 'droppedByType', type, droppedCount);
```

**Raw opposite-side routing** (lines 316-328):
```javascript
function relayToRoom(hashKey, senderWs, rawMessage, messageType) {
  const room = rooms.get(hashKey);
  const direction = senderWs._fsbRole === 'extension'
    ? 'extension->dashboard'
    : 'dashboard->extension';
  if (!room) return recordMissingRoomDelivery(hashKey, messageType, direction);
  const targets = senderWs._fsbRole === 'extension' ? room.dashboards : room.extensions;
  return sendToClients(hashKey, targets, rawMessage, messageType, direction);
}
```

**Pattern to copy:** port this to ESM and transport-agnostic `source`/`viewer` roles. Keep room sets, in-memory diagnostics, ring buffer, raw frame fan-out, opposite-side routing, room cleanup, and no relay-side payload transformation. Add cap enforcement before `sendToTargets()`.

---

### `src/relay/limits.js` (utility, transform)

**Analogs:** `src/protocol/constants.js`, `src/protocol/envelope.js`

**Shared cap constant** (`src/protocol/constants.js` lines 5-10):
```javascript
/**
 * Hard per-message size cap enforced by the relay (bytes).
 * Capture-side snapshot truncation budgets derive from this value.
 */
export const RELAY_PER_MESSAGE_LIMIT_BYTES = 1048576; // 1 MiB
```

**Envelope classifier pattern** (`src/protocol/envelope.js` lines 68-75):
```javascript
/**
 * Is this decoded wire object a compressed envelope (vs. a plain message)?
 * Useful for relay-side diagnostics that classify traffic without decoding.
 * @param {Object} obj
 */
export function isCompressedEnvelope(obj) {
  return !!obj && obj._lz === true && typeof obj.d === 'string';
}
```

**Decode error style** (`src/protocol/envelope.js` lines 44-65):
```javascript
export function decodeEnvelope(raw, lz) {
  var outer;
  try {
    outer = JSON.parse(raw);
  } catch (e) {
    return { ok: false, error: 'json-parse-failed' };
  }
  if (!outer || outer._lz !== true || typeof outer.d !== 'string') {
    return { ok: true, msg: outer };
  }
  if (!lz || typeof lz.decompressFromBase64 !== 'function') {
    return { ok: false, error: 'decompress-unavailable' };
  }
```

**Pattern to copy:** return structured `{ ok, ... }` results for classification/limit checks. Parse JSON only enough to classify `type`, `_lz`, and future native deflate markers; do not decompress in relay. Use lowercase hyphen error strings like `message-too-large` and include `byteSize`, `capBytes`, `type`, `compressed`, `role`, and room prefix in diagnostics.

---

### `src/relay/backends/ws.js` (service, event-driven)

**Analog:** `reference/server/ws-handler.js`

**Connection setup and room-state diagnostics** (lines 206-231):
```javascript
function setupWSHandler(wss) {
  wss.on('connection', (ws, request, { hashKey, role }) => {
    const keyPrefix = hashKey.substring(0, 8);
    console.log(`[WS] ${role} connected | hashKey=${keyPrefix}`);
    addClient(hashKey, ws, role);
    recordRoomConnectionEvent(hashKey, 'connected', role, null, '');
    const room = rooms.get(hashKey);
    const extCount = room ? room.extensions.size : 0;
    const dashCount = room ? room.dashboards.size : 0;
    console.log(`[WS] Room ${keyPrefix}...: ${extCount} ext, ${dashCount} dash`);

    const presentRoles = [];
    if (extCount > 0) presentRoles.push('ext');
    if (dashCount > 0) presentRoles.push('dash');
    console.log(`[WS] room-state | roles=${presentRoles.join(',')} hashKey=${keyPrefix}`);

    if (role === 'extension') {
      broadcast(hashKey, 'dashboards', {
        type: 'ext:status', payload: { online: true }, ts: Date.now()
      });
    }
```

**Message/close/error handling** (lines 244-286):
```javascript
ws.on('message', (data) => {
  let msg;
  try {
    msg = JSON.parse(data);
  } catch {
    pushRoomDiagnosticEvent(hashKey, {
      event: 'malformed-json',
      role,
      hashKey
    });
    return;
  }

  const messageType = typeof msg.type === 'string'
    ? msg.type
    : (msg && msg._lz ? 'compressed-envelope' : 'unknown');

  if (messageType === 'ping') {
    ws.send(JSON.stringify({ type: 'pong', ts: Date.now() }));
    return; // Do NOT relay pings
  }

  incrementRoomCounter(hashKey, 'receivedByType', messageType, 1);
  const result = relayToRoom(hashKey, ws, data.toString(), messageType);
  console.log(`[WS] ${role}->${role === 'extension' ? 'dashboard' : 'extension'} room=${hashKey.substring(0, 8)} type=${messageType} delivered=${result?.deliveredCount || 0} dropped=${result?.droppedCount || 0}`);
});

ws.on('close', (closeCode, closeReason) => {
  console.log(`[WS] ${role} disconnected, hashKey: ${hashKey.substring(0, 8)}...`);
  recordRoomConnectionEvent(hashKey, 'closed', role, closeCode, closeReason);
  removeClient(hashKey, ws);
```

**Pattern to copy:** wrap `ws.WebSocketServer` behind a backend factory. Validate path, room key, and `role=source|viewer`; set `perMessageDeflate: false`; wire `message`, `close`, and `error`; turn ping into local pong; pass raw frame strings to relay core.

---

### `src/transport/websocket.js` (service, streaming)

**Analogs:** `examples/loopback-transport.js`, `reference/extension/ws-client.js`, `reference/dashboard/dashboard.js`

**Transport contract and FIFO precedent** (`examples/loopback-transport.js` lines 19-47):
```javascript
/**
 * Create a loopback transport pair for one-page capture -> viewer mirroring.
 *
 * @returns {{
 *   captureTransport: { send: (type: string, payload: Object) => void },
 *   viewerTransport: {
 *     send: (type: string, payload: Object) => void,
 *     onMessage: (handler: (type: string, payload: Object) => void) => (() => void)
 *   },
 *   onControl: (handler: (type: string, payload: Object) => void) => (() => void)
 * }}
 */
export function createLoopbackTransport() {
  var toViewer = new Set(); // ext:* handlers (viewer subscribes)
  var toHost = new Set();   // dash:* handlers (host glue subscribes)

  function fanOut(handlers, type, payload) {
    queueMicrotask(function () {
      handlers.forEach(function (h) { h(type, payload); });
    });
  }
```

**Legacy LZ decode behavior** (`reference/extension/ws-client.js` lines 807-839):
```javascript
this.ws.onmessage = (event) => {
  try {
    var raw = JSON.parse(event.data);
    if (raw && raw._lz === true && typeof raw.d === 'string') {
      if (typeof LZString === 'undefined') {
        recordFSBTransportFailure('decompress-unavailable', {
          target: 'inbound',
          type: '_lz',
          tabId: getCurrentTransportTabId(),
          error: 'LZString not loaded (importScripts may have failed at background.js:37)',
          len: raw.d.length
        });
        return;
      }
      var decoded = LZString.decompressFromBase64(raw.d);
      if (!decoded) {
        recordFSBTransportFailure('decompress-failed', {
          target: 'inbound',
          type: '_lz',
          tabId: getCurrentTransportTabId(),
          error: 'LZString.decompressFromBase64 returned null/empty',
          len: raw.d.length
        });
        return;
      }
      raw = JSON.parse(decoded);
    }
    this._handleMessage(raw);
```

**Outbound compression/send behavior** (`reference/extension/ws-client.js` lines 889-924):
```javascript
send(type, payload) {
  if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
    recordFSBTransportFailure('message-send-failed', {
      type: type,
      target: 'relay',
      tabId: getCurrentTransportTabId(),
      readyState: this.ws ? this.ws.readyState : 'missing',
      error: 'WebSocket not open'
    });
    return false;
  }

  try {
    var raw = JSON.stringify({ type, payload, ts: Date.now() });
    if (raw.length > 1024 && typeof LZString !== 'undefined') {
      var compressed = LZString.compressToBase64(raw);
      if (compressed.length < raw.length) {
        this.ws.send(JSON.stringify({ _lz: true, d: compressed }));
        recordFSBTransportCount('sentByType', type);
        return true;
      }
    }
    this.ws.send(raw);
    recordFSBTransportCount('sentByType', type);
    return true;
```

**Browser dashboard status/decode analog** (`reference/dashboard/dashboard.js` lines 3592-3644):
```javascript
function connectWS() {
  disconnectWS();
  var proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  var wsUrl = proto + '//' + location.host + '/ws?key=' +
    encodeURIComponent(hashKey) + '&role=dashboard';

  ws = new WebSocket(wsUrl);
  setWsState('reconnecting');

  ws.onopen = function () {
    wsReconnectDelay = 0;
    setWsState('connected');
    if (wsPingTimer) clearInterval(wsPingTimer);
    wsPingTimer = setInterval(function () {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'ping', ts: Date.now() }));
      }
    }, 20000);
    scheduleStreamRecovery('ws-open');
  };

  ws.onmessage = function (event) {
    try {
      var envelope = JSON.parse(event.data);
      var msg;
      if (envelope._lz && envelope.d && typeof LZString !== 'undefined') {
        var decompressed = LZString.decompressFromBase64(envelope.d);
```

**Pattern to copy:** expose `createWebSocketTransport({ url, role, WebSocket, logger, codec })`. `send(type, payload)` must remain fire-and-forget and append async encoding to a FIFO promise chain. `flush()` returns that chain. Provide `onMessage(handler)` and an optional `onStatus(handler)` returning unsubscribe functions. Decode plain JSON, legacy `_lz`, and native deflate envelopes at endpoints only; emit status/health counters, not mirrored content.

---

### `src/renderer/index.js` (component, event-driven)

**Analog:** `src/renderer/index.js`

**Transport contract to extend** (lines 43-56):
```javascript
/**
 * The host-injected viewer transport. Mirrors the capture Transport's
 * fire-and-forget send contract and adds the receive side; Phase 4's
 * WebSocket transport implements this same interface by encoding/decoding
 * envelopes, so the viewer never changes.
 *
 * @typedef {Object} ViewerTransport
 * @property {(type: string, payload: Object) => void} send
 * @property {(handler: (type: string, payload: Object) => void) => (() => void)} onMessage
 */
```

**Factory validation/error containment** (lines 129-145):
```javascript
export function createViewer(options) {
  var cfg = options || {};

  var container = cfg.container;
  if (!container || typeof container.appendChild !== 'function') {
    throw new Error('viewer-container-required');
  }
  var transport = cfg.transport;
  if (!transport || typeof transport.send !== 'function'
      || typeof transport.onMessage !== 'function') {
    throw new Error('viewer-transport-required');
  }
  var logger = cfg.logger || {
    info: function () { console.info.apply(console, arguments); },
    warn: function () { console.warn.apply(console, arguments); },
    error: function () { console.error.apply(console, arguments); }
  };
```

**Current state/counter seams** (lines 244-263):
```javascript
var viewerState = 'waiting'; // 'waiting' | 'streaming' minimal gate
var active = { streamSessionId: '', snapshotId: 0 };
var lastScroll = { x: 0, y: 0 };
var counters = { staleMisses: 0, applyFailures: 0 };
var sanitizeCounters = {
  strippedHandlers: 0, blockedUrls: 0, droppedSubtrees: 0, cssScrubs: 0
};
var resyncPending = false; // latch: at most one resync in flight per generation
var lastSnapshotPayload = null;
var scaleState = computeScale(1920, 1080, container.clientWidth, container.clientHeight);
var detached = false;
var destroyed = false;
```

**Dispatch containment** (lines 453-486):
```javascript
function dispatch(type, payload) {
  if (detached) return;
  try {
    switch (type) {
      case STREAM.SNAPSHOT:
        handleSnapshot(payload);
        break;
      case STREAM.MUTATIONS:
        handleMutations(payload);
        break;
      case STREAM.SCROLL:
        handleScroll(payload);
        break;
      case STREAM.OVERLAY:
        handleOverlay(payload);
        break;
      case STREAM.DIALOG:
        handleDialog(payload);
        break;
      default:
        break;
    }
  } catch (err) {
    logger.error('[Renderer] message handler failed', type, err);
  }
}
```

**Handle shape to preserve/extend** (lines 569-573):
```javascript
return {
  detach: detach,
  destroy: destroy,
  registerOverlay: registerOverlay
};
```

**Pattern to copy:** add a small internal emitter and return `on` beside the existing methods. Initialize public lifecycle to `connecting`; emit `live` on first accepted snapshot/frame; emit `stale` for resync pending, stale threshold, or transport close/reconnect; emit `disconnected` after the short stale window. Health snapshots should be derived from existing `counters`, `sanitizeCounters`, `resyncPending`, `last*At`, and transport status counters.

---

### `tests/renderer-viewer.test.js` (test, request-response)

**Analog:** `tests/renderer-viewer.test.js`

**Imports and local helper pattern** (lines 29-39):
```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM, VirtualConsole } from 'jsdom';
import {
  createViewer,
  computeScale,
  buildSnapshotHtml,
  OVERLAY_CSS,
} from '../src/renderer/index.js';
import { STREAM, CONTROL, DIFF_OP, NID_ATTR } from '../src/protocol/messages.js';
```

**Recording transport stub** (lines 74-99):
```javascript
function createRecordingTransport() {
  const api = {
    sent: [],
    handler: null,
    unsubscribeCount: 0,
    send(type, payload) {
      api.sent.push({ type, payload });
    },
    onMessage(h) {
      api.handler = h;
      return function unsubscribe() {
        api.unsubscribeCount += 1;
        api.handler = null;
      };
    },
    emit(type, payload) {
      if (api.handler) api.handler(type, payload);
    },
  };
  return api;
}
```

**Pinned handle test to update intentionally** (lines 257-274):
```javascript
test('handle has exactly detach, destroy, and registerOverlay functions', () => {
  const env = setupEnv();
  try {
    const transport = createRecordingTransport();
    env.viewer = createViewer({
      container: env.container,
      transport,
      logger: silentLogger(),
    });
    assert.deepEqual(
      Object.keys(env.viewer).sort(),
      ['destroy', 'detach', 'registerOverlay'],
      'handle surface is locked to exactly three members'
    );
```

**Pattern to copy:** update this exact-handle assertion to `['destroy', 'detach', 'on', 'registerOverlay']`, and keep local helpers duplicated. Do not introduce shared test harness imports.

---

### `examples/two-tab-demo/source.html` (component, event-driven)

**Analog:** `examples/loopback-mirror.html`

**HTML shell and header pattern** (lines 1-13, 195-223):
```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>PhantomStream — Loopback Mirror</title>
<!--
  PhantomStream "first light" demo: one page mirroring itself live through
  an in-page loopback transport. Zero network, zero servers, zero deps —
  capture and viewer are imported directly as native ES modules
-->
```

```html
<header>
  <div class="header-row">
    <h1>PhantomStream — Loopback Mirror</h1>
    <span class="badge" id="badge"><span class="badge-dot"></span><span id="badge-label">LIVE</span></span>
  </div>
  <p class="subtitle">A page mirroring itself live. No network, no server — one document, two DOMs.</p>
</header>

<main class="panes">
  <section class="pane">
    <div class="pane-header">SOURCE</div>
    <div class="controls">
      <button type="button" class="btn-primary" id="btn-add">Add row</button>
      <button type="button" class="btn-secondary" id="btn-remove">Remove row</button>
      <button type="button" class="btn-secondary" id="btn-edit">Edit text</button>
      <button type="button" class="btn-secondary" id="btn-dialog">Show dialog</button>
      <button type="button" class="btn-secondary" id="btn-auto" aria-pressed="true">Auto-mutate</button>
    </div>
    <ul class="rows" id="rows"></ul>
  </section>
```

**Pattern to copy:** split into a source-only page, link `demo.css`, use title/copy from `04-UI-SPEC`, include status strip fields for room prefix, relay state, sent frame count, and last send time. Do not make a landing page.

---

### `examples/two-tab-demo/viewer.html` (component, streaming)

**Analog:** `examples/loopback-mirror.html`

**Mirror stage pattern** (lines 225-233):
```html
<section class="pane">
  <div class="pane-header">MIRROR</div>
  <div class="stage" id="mirror-stage">
    <div class="empty-state">
      <h2>Waiting for first snapshot…</h2>
      <p>The mirror appears as soon as capture sends its first frame.</p>
    </div>
  </div>
</section>
```

**Pattern to copy:** viewer page owns status badge, health counters, empty state, and stage chrome. The library `createViewer` owns only the mirror root/iframe/overlays. Keep last frame visible on stale/disconnected; do not add a blocking overlay.

---

### `examples/two-tab-demo/demo.css` (component, transform)

**Analog:** `examples/loopback-mirror.html`

**Shared shell/CSS pattern** (lines 15-26, 50-77, 88-130, 153-168):
```css
* { box-sizing: border-box; }
body {
  background: #0f1117;
  color: #e0e0e0;
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  font-size: 15px;
  line-height: 1.5;
  padding: 24px;
  max-width: 1200px;
  margin: 0 auto;
}
```

```css
.badge {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 600;
  line-height: 1.2;
  text-transform: uppercase;
  letter-spacing: 1px;
}
```

```css
.pane {
  background: #1e1e2e;
  border: 1px solid #333;
  border-radius: 12px;
  padding: 16px;
}
```

```css
.stage {
  position: relative;
  aspect-ratio: 16 / 10;
  min-height: 200px;
}
.empty-state {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
```

**Pattern to copy:** use the approved Phase 4 UI contract values, not the Phase 2 stage height verbatim. Stage must be `aspect-ratio: 16 / 10`, `min-height: 280px`, `height: min(72vh, 720px)`, dark background, `1px` border, `12px` radius, and mobile min-height `220px`.

---

### `examples/two-tab-demo/source.js` (utility, event-driven)

**Analog:** `examples/loopback-mirror.html`

**Imports and source controls** (lines 241-245, 268-319):
```javascript
import { createLoopbackTransport } from './loopback-transport.js';
import { createViewer } from '../src/renderer/index.js';
import { createCapture } from '../src/capture/index.js';
import { CONTROL } from '../src/protocol/messages.js';
```

```javascript
function addRow() {
  rowCount += 1;
  const li = document.createElement('li');
  li.textContent = 'Row ' + rowCount + ' — ' + randomWord();
  rowsList.appendChild(li);
}

function removeRow() {
  if (rowsList.lastElementChild) rowsList.removeChild(rowsList.lastElementChild);
}

function editRow() {
  const rows = rowsList.children;
  if (!rows.length) return;
  const target = rows[Math.floor(Math.random() * rows.length)];
  const label = target.textContent.split(' — ')[0];
  target.textContent = label + ' — ' + randomWord();
}

function setAutoMutate(on) {
  if (on && autoTimer === null) {
    autoTimer = setInterval(randomMutation, 1000);
  } else if (!on && autoTimer !== null) {
    clearInterval(autoTimer);
    autoTimer = null;
  }
  document.getElementById('btn-auto').setAttribute('aria-pressed', String(on));
```

**Control glue pattern** (lines 340-359):
```javascript
const capture = createCapture({
  transport: transport.captureTransport,
  skipElement: (el) => !!(el.getAttribute && el.getAttribute('data-phantomstream-ui'))
});

transport.onControl((type) => {
  if (type === CONTROL.START) capture.start();
  else if (type === CONTROL.STOP) capture.stop();
  else if (type === CONTROL.PAUSE) capture.pause();
  else if (type === CONTROL.RESUME) capture.resume();
  logLine('control: ' + type);
});

capture.start();
```

**Pattern to copy:** replace loopback transport with `createWebSocketTransport({ role: 'source', room, url })`; subscribe to viewer/control messages with `onMessage`; start capture on `open` and on `CONTROL.START`; keep `skipElement` for any demo chrome if source page contains host UI.

---

### `examples/two-tab-demo/viewer.js` (utility, event-driven)

**Analog:** `examples/loopback-mirror.html`

**Viewer-first wiring order** (lines 327-365):
```javascript
// ---- wiring (order is load-bearing — loopback has no buffering) ---------
// 1. Transport: both ends of the in-page channel.
const transport = createLoopbackTransport();

// 2. Viewer FIRST: it subscribes and auto-attaches its DOM (stamped with
//    the data-phantomstream-ui marker) BEFORE capture serializes the page.
const viewer = createViewer({
  container: document.getElementById('mirror-stage'),
  transport: transport.viewerTransport
});

// 3. Capture, with the recursion guard...
```

**Pattern to copy:** viewer tab creates WebSocket transport first, then `createViewer({ container, transport })`, then subscribes to `viewer.on('state')`, `viewer.on('health')`, and `transport.onStatus()` to update demo chrome. On open, send `CONTROL.START` through viewer transport to request a fresh snapshot.

---

### `examples/two-tab-demo/server.js` (service, file-I/O)

**Analog:** `examples/serve.js`

**Path safety and MIME pattern** (lines 34-93):
```javascript
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', // required for ESM module scripts
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.map': 'application/json'
};

const server = createServer(async (req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(req.url.split('?')[0]);
  } catch {
    res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('bad request');
    return;
  }

  let filePath = resolve(ROOT, '.' + pathname);
  if (filePath !== ROOT && !filePath.startsWith(ROOT + sep)) {
    res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('forbidden');
    return;
  }
```

**Stream error containment** (lines 79-88):
```javascript
res.writeHead(200, {
  'content-type': MIME[extname(filePath)] || 'application/octet-stream'
});
const stream = createReadStream(filePath);
stream.on('error', () => res.destroy());
stream.pipe(res);
```

**Pattern to copy:** export a `startDemoServer(options)` helper instead of listening at module top-level. Preserve decode-before-resolve path safety, no directory listings, ESM MIME, and `127.0.0.1` bind. Attach the WebSocket backend to the same HTTP server or return both handles for shutdown tests.

---

### `tests/relay-core.test.js` (test, request-response)

**Analogs:** `reference/server/ws-handler.js`, `tests/protocol.test.js`

**Test imports style** (`tests/protocol.test.js` lines 1-11):
```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  encodeEnvelope,
  decodeEnvelope,
  isCompressedEnvelope,
  isCurrentStream,
  createStreamSessionId,
  SNAPSHOT_BUDGET_BYTES,
  RELAY_PER_MESSAGE_LIMIT_BYTES,
} from '../src/protocol/index.js';
```

**Room cleanup and exports to test** (`reference/server/ws-handler.js` lines 303-367):
```javascript
function removeClient(hashKey, ws) {
  const room = rooms.get(hashKey);
  if (!room) return;
  room.extensions.delete(ws);
  room.dashboards.delete(ws);
  if (room.extensions.size === 0 && room.dashboards.size === 0) {
    rooms.delete(hashKey);
  }
}

module.exports = {
  setupWSHandler,
  broadcastToRoom,
  getRoomDiagnostics,
  rooms,
  sendToClients,
  getBackpressureDroppedCount,
  _resetBackpressureDroppedCount,
  BACKPRESSURE_BUFFER_LIMIT_BYTES
};
```

**Pattern to copy:** create fake socket objects with `send(raw)`, `readyState`, and `bufferedAmount`. Assert source-to-viewer fan-out, viewer-to-source control fan-out, no same-side echo, room cleanup, oversize rejection before delivery, and backpressure drop counters.

---

### `tests/relay-ws-backend.test.js` (test, event-driven)

**Analogs:** `reference/server/ws-handler.js`, `examples/serve.js`

**Backend connection/message analog** (`reference/server/ws-handler.js` lines 206-286): use the connection, message, close, and error excerpts listed under `src/relay/backends/ws.js`.

**Static server local bind analog** (`examples/serve.js` lines 30-32, 95-97):
```javascript
const HOST = '127.0.0.1'; // localhost only (T-02-17)
const PORT = 8642;

server.listen(PORT, HOST, () => {
  console.log(`loopback demo: http://localhost:${PORT}/examples/loopback-mirror.html`);
});
```

**Pattern to copy:** spin up a real HTTP server on `127.0.0.1` with port `0`, attach the WS backend, connect `WebSocket` clients from Node or `ws`, and assert path/role/room validation plus raw relay. If inspecting `ws` options, assert `perMessageDeflate: false` through behavior or backend factory options.

---

### `tests/websocket-transport.test.js` (test, streaming)

**Analogs:** `tests/protocol.test.js`, `examples/loopback-transport.js`, `tests/capture-lifecycle.test.js`

**Fake codec pattern** (`tests/protocol.test.js` lines 13-17):
```javascript
const fakeLz = {
  compressToBase64: (s) => Buffer.from(s, 'utf8').toString('base64'),
  decompressFromBase64: (s) => Buffer.from(s, 'base64').toString('utf8'),
};
```

**Optional flush test pattern** (`tests/capture-lifecycle.test.js` lines 272-296):
```javascript
test('async transport flush rejections route to the injected logger', async () => {
  const env = setupEnv(BODY_HTML);
  try {
    const errors = [];
    const recordingLogger = {
      info() {},
      warn() {},
      error(...args) { errors.push(args); },
    };
    const transport = {
      send() {},
      flush() { return Promise.reject(new Error('flush-down')); },
    };
    env.capture = createCapture({ transport, logger: recordingLogger });

    env.capture.start();
    env.capture.stop();
    await Promise.resolve();

    assert.ok(
      errors.some((args) => String(args[0]) === '[DOM Stream] transport flush failed'
```

**Pattern to copy:** use fake WebSocket objects and deliberately delayed async codec promises to prove FIFO. Assert `send()` returns immediately, `flush()` drains, plain JSON decodes without codec, `_lz` decodes with injected codec, native deflate envelope round-trips when available, and decode failures emit status/error counters without throwing.

---

### `tests/renderer-health-events.test.js` (test, event-driven)

**Analog:** `tests/renderer-viewer.test.js`

**JSDOM setup pattern** (lines 40-72):
```javascript
function setupEnv() {
  const dom = new JSDOM(
    '<!DOCTYPE html><html><head><title>viewer fixture</title></head><body>'
      + '<div id="host"></div></body></html>',
    {
      url: 'https://fixture.test/page',
      pretendToBeVisual: true,
      virtualConsole: new VirtualConsole(),
    }
  );
  const w = dom.window;
  const env = {
    dom,
    window: w,
    document: w.document,
    container: w.document.getElementById('host'),
    viewer: null,
    teardown() {
      try {
        if (env.viewer) env.viewer.destroy();
      } catch (e) { /* already destroyed */ }
      env.viewer = null;
      w.close();
    },
  };
  return env;
}
```

**Snapshot helper pattern** (lines 115-135):
```javascript
function snapshotPayload(overrides) {
  return Object.assign(
    {
      html: '<div ' + NID_ATTR + '="1">hello</div>',
      stylesheets: [],
      inlineStyles: [],
      htmlAttrs: {},
      bodyAttrs: {},
      htmlStyle: '',
      bodyStyle: '',
      scrollX: 0,
      scrollY: 0,
      viewportWidth: 1920,
      viewportHeight: 1080,
      streamSessionId: 'stream_a_b',
      snapshotId: 111,
    },
    overrides || {}
  );
}
```

**Pattern to copy:** extend the recording transport with `onStatus(handler)` and `emitStatus(status)`. Assert immediate or first emitted `connecting`, `live` on snapshot, `stale` on resync pending/status close, `disconnected` after close threshold, unsubscribe behavior, health counters/timestamps, and no payload HTML/text in health objects.

---

### `tests/demo-cli.test.js` (test, file-I/O)

**Analogs:** `examples/serve.js`, `tests/renderer-loopback.test.js`

**Path-safety server assertions to adapt** (`examples/serve.js` lines 46-93): use the static server excerpt listed under `examples/two-tab-demo/server.js`.

**Local full wiring discipline** (`tests/renderer-loopback.test.js` lines 166-233):
```javascript
/**
 * Full loopback wiring in the Pattern 4 ORDER (the loopback has no
 * buffering, so the viewer must exist -- subscribed and skip-marked --
 * before the first snapshot is sent):
 *   transport -> recorders -> createViewer -> createCapture(skipElement)
 *   -> onControl glue (CONTROL.START -> capture.start(): the resync
 *   round-trip).
 */
function wireLoopback(env, opts = {}) {
  const transport = createLoopbackTransport();

  const received = [];
  transport.viewerTransport.onMessage((type, payload) => {
    received.push({ type, payload });
  });
  const controls = [];
  transport.onControl((type, payload) => {
    controls.push({ type, payload });
  });

  const viewer = createViewer({
    container: env.document.getElementById('mirror-container'),
    transport: transport.viewerTransport,
    logger: opts.viewerLogger || silentLogger(),
  });
```

**Pattern to copy:** import `startDemoServer()` directly for deterministic tests, use port `0`, assert `address().address === '127.0.0.1'`, fetch source/viewer HTML/JS/CSS, verify forbidden traversal returns 403/400/404, and test the bin script prints the required source/viewer/room lines. Keep browser kill-relay verification separate from unit test if it needs the Browser plugin/manual checkpoint.

## Shared Patterns

### ESM, JSDoc, Named Exports
**Source:** `CLAUDE.md`, `src/renderer/index.js`, `src/capture/index.js`  
**Apply to:** all new `src/**` and `examples/two-tab-demo/*.js` files

```javascript
import { STREAM, CONTROL, NID_ATTR, isCurrentStream } from '../protocol/messages.js';

export function createViewer(options) {
  var cfg = options || {};
  // factory-time validation only
}
```

Use explicit `.js` extensions, named exports, 2-space indentation, single quotes, and no runtime build step. Prefer `var` inside browser/runtime-shared factory closures to match capture/renderer style.

### Transport Error Containment
**Source:** `src/capture/index.js` lines 535-574 and `src/renderer/index.js` lines 265-283  
**Apply to:** `src/transport/websocket.js`, `src/renderer/index.js`, demo source/viewer glue

```javascript
function safeSend(type, payload) {
  try {
    var result = transport.send(type, payload);
    if (result && typeof result.catch === 'function') {
      result.catch(function (err) {
        logger.error('[DOM Stream] transport send failed', err);
      });
    }
  } catch (err) {
    logger.error('[DOM Stream] transport send failed', err);
  }
}
```

After factory creation, transport failures should route to logger/status events and never throw through capture or viewer paths.

### Relay Limits and Backpressure
**Source:** `src/protocol/constants.js` lines 5-10 and `reference/server/ws-handler.js` lines 5-17, 93-111  
**Apply to:** `src/relay/limits.js`, `src/relay/relay.js`, `src/relay/backends/ws.js`, relay tests

```javascript
const BACKPRESSURE_BUFFER_LIMIT_BYTES = 16 * 1024 * 1024; // 16 MiB

if (typeof client.bufferedAmount === 'number'
    && client.bufferedAmount > BACKPRESSURE_BUFFER_LIMIT_BYTES) {
  backpressureDroppedCount += 1;
  droppedCount += 1;
  pushRoomDiagnosticEvent(hashKey, {
    event: 'backpressure-drop',
    direction,
    type,
    bufferedAmount: client.bufferedAmount,
    limitBytes: BACKPRESSURE_BUFFER_LIMIT_BYTES
  });
  continue;
}
```

Enforce the 1 MiB cap before delivery; then apply the 16 MiB per-client bufferedAmount drop defense during fan-out.

### Endpoint Compression, Not Relay Compression
**Source:** `src/protocol/envelope.js` lines 27-34, `reference/extension/ws-client.js` lines 901-923  
**Apply to:** `src/transport/websocket.js`, `tests/websocket-transport.test.js`

```javascript
export function encodeEnvelope(msg, lz, thresholdBytes) {
  var json = JSON.stringify(msg);
  var threshold = thresholdBytes || 0;
  if (!lz || typeof lz.compressToBase64 !== 'function' || json.length <= threshold) {
    return json;
  }
  return JSON.stringify({ _lz: true, d: lz.compressToBase64(json) });
}
```

Native deflate should live beside this endpoint behavior as an async codec path. The relay must keep raw fan-out and only classify envelopes for diagnostics.

### Viewer Security Boundary
**Source:** `src/renderer/index.js` lines 177-187 and `tests/renderer-purity.test.js` lines 80-84  
**Apply to:** `src/renderer/index.js`, demo viewer page, renderer event tests

```javascript
iframe.setAttribute('sandbox', 'allow-same-origin');
var sandboxTokens = (iframe.getAttribute('sandbox') || '').trim().split(/\s+/);
if (sandboxTokens.length !== 1 || sandboxTokens[0] !== 'allow-same-origin') {
  throw new Error('viewer-sandbox-invalid');
}
```

Do not put WebSocket logic in `src/renderer/**`; keep it in `src/transport/websocket.js`. Demo pages must render mirrored content through `createViewer`, not manual DOM injection.

### Test Style
**Source:** `tests/renderer-loopback.test.js` lines 17-21, `tests/renderer-viewer.test.js` lines 21-27  
**Apply to:** all new tests

```javascript
// All helpers are deliberately duplicated locally (parallel-safe convention
// per tests/capture-skip.test.js: this file imports nothing from any shared
// test harness).
```

Use `node:test`, `node:assert/strict`, local fake transports/sockets, `try/finally(env.teardown)`, and no shared harness imports unless the repo introduces one explicitly.

### Demo UI Boundary
**Source:** `04-UI-SPEC.md` lines 37, 118-132, 137-178  
**Apply to:** `examples/two-tab-demo/source.html`, `viewer.html`, `demo.css`, `source.js`, `viewer.js`

The viewer library emits lifecycle/health events only. All visible badges, status strips, logs, room labels, and health rows belong to the demo host pages. CLI output must include:

```text
PhantomStream demo running on 127.0.0.1
Source tab: {sourceUrl}
Viewer tab: {viewerUrl}
Room: {roomKeyPrefix}…
```

## No Analog Found

All planned files have a close analog. `package-lock.json` is mechanical rather than semantic; update it through npm instead of hand-copying code patterns.

## Metadata

**Analog search scope:** `src/`, `examples/`, `tests/`, `reference/`, `docs/`, phase artifacts  
**Primary files read:** `CLAUDE.md`, `04-CONTEXT.md`, `04-RESEARCH.md`, `04-UI-SPEC.md`, `package.json`, `package-lock.json`, `src/relay/README.md`, `src/protocol/*`, `src/capture/index.js`, `src/renderer/index.js`, `examples/serve.js`, `examples/loopback-transport.js`, `examples/loopback-mirror.html`, `reference/server/ws-handler.js`, `reference/extension/ws-client.js`, `reference/dashboard/dashboard.js`, existing tests  
**Files scanned:** 70+ tracked repo files via `rg --files` plus targeted `rg` searches  
**Pattern extraction date:** 2026-06-14 23:35 CDT
