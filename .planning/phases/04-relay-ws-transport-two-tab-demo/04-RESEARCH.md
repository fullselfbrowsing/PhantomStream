# Phase 04: Relay, WS Transport & Two-Tab Demo - Research

**Researched:** 2026-06-14 CDT  
**Domain:** Plain JS ESM relay, WebSocket transport, async compression, viewer health events, local two-tab demo  
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

All bullets in this section are copied verbatim from `.planning/phases/04-relay-ws-transport-two-tab-demo/04-CONTEXT.md`; treat the block as locked planning input. [VERIFIED: 04-CONTEXT.md]

### Locked Decisions

## Implementation Decisions

### Discussion Mode
- **D-01:** The interactive question UI was unavailable in this Conductor mode, so the recommended Phase 4 scope was selected under the GSD fallback: demo experience, relay pairing/state, codec compatibility, viewer health events, and verification.
- **D-02:** Treat the decisions below as conservative defaults for planning. They should be implemented unless research finds a concrete blocker, in which case the planner must call out the deviation explicitly.

### Two-Tab Demo Experience
- **D-03:** `npx phantom-stream demo` should start a local-only demo server plus bundled relay, then print two explicit URLs: a source/capture tab and a viewer tab. Browser auto-open may be added behind an option if cheap, but the deterministic default is printed URLs.
- **D-04:** The demo should reuse the loopback demo's proven wiring shape: viewer subscribes first, capture starts second, and control messages can request a fresh snapshot. The networked demo replaces the in-page loopback transport with a WebSocket transport.
- **D-05:** Bind demo services to `127.0.0.1` only. Use stable default ports with "next free port" fallback, and always print the actual URLs.
- **D-06:** Use a generated local room key in the URLs so the source and viewer join the same relay room without adding a full auth system.
- **D-07:** The demo UI should be the usable experience, not a landing page: source tab controls/mutates a small page; viewer tab shows the mirror and a compact connection/health status. It should visibly support the kill-relay checkpoint from the roadmap.

### Relay and WebSocket Transport
- **D-08:** Keep the relay core transport-agnostic. The WebSocket backend is the reference implementation, isolated behind the backend seam.
- **D-09:** Preserve the reference relay's raw fan-out behavior: source/capture clients and viewer clients join a room; frames route to the opposite side without relay-side payload transformation.
- **D-10:** Support fan-out to multiple viewers because it falls out naturally from the reference design, but the Phase 4 demo and exit criteria prove one source and one viewer.
- **D-11:** Enforce the 1 MiB per-message cap before delivery. Oversize diagnostics must include at least room id/key prefix, sender role, classified message type, byte size, cap, and whether the frame looked like a compressed envelope.
- **D-12:** Retain the reference backpressure defense: if a viewer/socket send buffer is over the configured backpressure limit, drop that frame for that client and count/log the drop instead of growing an unbounded queue.
- **D-13:** Relay diagnostics stay in-memory and testable in this phase. A public admin endpoint/dashboard is deferred unless the implementation needs a tiny local-only endpoint for the demo.

### Compression and Ordering
- **D-14:** Default outbound compression should use native `CompressionStream('deflate-raw')` / matching inflate when available, with plain JSON fallback for small or uncompressed messages.
- **D-15:** Decoding must remain backward-compatible with FSB's shipped LZ-string envelope `{ _lz: true, d: string }`. Plain JSON must continue to decode without any codec.
- **D-16:** Do not use WebSocket `permessage-deflate` or any stateful per-connection compression. PhantomStream frames remain independently decodable so relay fan-out and reconnect recovery stay robust.
- **D-17:** Async encoding must not reorder sends. The WebSocket transport should own a per-connection FIFO send queue; `transport.send(type, payload)` remains fire-and-forget for capture/viewer code, and optional `flush()` resolves after the ordered queue drains.
- **D-18:** The codec seam should make the native deflate path testable without losing the existing LZ-compatible decoder. If native compression is unavailable, fallback behavior should be explicit and logged at debug/diagnostic level rather than silent.

### Viewer Lifecycle and Health Events
- **D-19:** Extend the viewer handle with `on()` while preserving existing `detach`, `destroy`, and `registerOverlay` behavior. The existing "exact handle shape" tests should be updated intentionally.
- **D-20:** Use a compact event surface: `viewer.on('state', handler)` for lifecycle state changes and `viewer.on('health', handler)` for stream/transport telemetry. Return an unsubscribe function from `on()`.
- **D-21:** State names are exactly the roadmap names: `connecting`, `live`, `stale`, `disconnected`.
- **D-22:** State transition intent: start at `connecting`; become `live` on the first accepted snapshot/frame; become `stale` when the last frame is retained but freshness is suspect (miss threshold, resync pending, relay close/reconnect); become `disconnected` when the transport is closed beyond the short reconnect/stale window. Killing the relay mid-stream must make these transitions observable in the demo.
- **D-23:** Health telemetry should expose counters and timestamps, not payload contents: last frame/snapshot/mutation times, received/sent counts by type, stale mutation misses, apply failures, resync pending, sanitizer strip counters where already available, and transport drops/errors where available.
- **D-24:** The viewer library should expose events but not impose product chrome. The demo may display badges/status text; host applications own their own UI.

### Packaging and CLI
- **D-25:** Add a package binary named `phantom-stream` with a `demo` subcommand. Keep package publishing decisions for Phase 10; this phase only needs the local/dev command path and package metadata ready enough for `npx`-style execution.
- **D-26:** Add package exports for the relay/WebSocket transport surfaces as needed. Keep capture, renderer, and protocol import paths stable.
- **D-27:** It is acceptable for the Node WebSocket backend/demo command to depend on a proven WebSocket package such as `ws`, isolated to the relay backend/demo. Do not add dependencies to browser-injected capture code.

### Verification
- **D-28:** Automated tests must cover relay routing, cap/oversize diagnostics, backpressure drops, codec fallback/decode behavior, async send ordering, viewer `on()` state/health subscriptions, and CLI/demo server startup.
- **D-29:** Browser verification is required for the demo. Use the FSB/browser-style checkpoint established in Phase 3: launch the demo, open source and viewer tabs, prove live mutation mirroring, then kill/stop the relay and observe `live -> stale -> disconnected`.
- **D-30:** Keep the full `npm test` suite green and add focused tests rather than broad rewrites.

### Claude's Discretion

### the agent's Discretion
- Exact port numbers and CLI flag names beyond the default `demo` subcommand.
- Exact local room-key format and URL path/query names.
- Exact relay module split, as long as the core/backend seam is clear and testable.
- Exact event payload field names for health telemetry, provided they are documented and contain no mirrored page contents.
- Whether demo browser auto-open is offered as an optional flag.

### Deferred Ideas (OUT OF SCOPE)

## Deferred Ideas

- Remote control through the mirror belongs to Phase 5.
- Playwright/CDP agent demo belongs to Phase 5.
- Extension/bookmarklet adapters belong to Phase 6.
- Node identity public API belongs to Phase 7.
- Npm publishing, quickstart polish, and final package invocation details belong to Phase 10.
- FSB swap-in verification belongs to Phase 11.
- Relay admin dashboards/endpoints and multi-viewer scale-out documentation are future polish unless a minimal local diagnostic endpoint is needed for this phase's tests.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| RELY-01 | Relay is transport-agnostic with pluggable backends; a self-hostable WebSocket reference implementation ships with per-message size cap and oversize diagnostics. | Use a pure relay core plus `ws` backend; enforce `RELAY_PER_MESSAGE_LIMIT_BYTES` before fan-out and record in-memory diagnostics. [VERIFIED: .planning/REQUIREMENTS.md] [VERIFIED: src/protocol/constants.js] [CITED: https://github.com/websockets/ws/blob/master/doc/ws.md] |
| RELY-02 | Compression envelope uses native `CompressionStream('deflate-raw')` by default with lz-string-compatible decode for FSB backward compatibility; async codec preserves message ordering. | Add async native deflate encode/decode functions plus legacy `_lz` decode; put all async encoding behind a per-connection FIFO queue and expose `flush()`. [VERIFIED: .planning/REQUIREMENTS.md] [VERIFIED: src/protocol/envelope.js] [CITED: https://nodejs.org/api/webstreams.html] [CITED: https://compression.spec.whatwg.org/] |
| PKG-01 | `npx phantom-stream demo` works end-to-end: capture a page in one tab, mirror it live in another through the bundled relay. | Add package `bin`, local-only demo server, source/viewer pages, browser WebSocket transport, generated room key, and browser kill-relay verification. [VERIFIED: .planning/REQUIREMENTS.md] [VERIFIED: examples/serve.js] [VERIFIED: 04-UI-SPEC.md] |
| VIEW-02 | Host can subscribe to lifecycle/connection-state events and stream-health telemetry via `on()`. | Extend `createViewer` handle with `on('state'|'health')`, preserve existing methods, and map snapshot, resync, transport status, counters, and sanitizer counters into payloads with no mirrored page content. [VERIFIED: .planning/REQUIREMENTS.md] [VERIFIED: src/renderer/index.js] [VERIFIED: docs/SECURITY.md] |
</phase_requirements>

## Summary

Phase 04 should be planned as a narrow networked extraction, not a rewrite: keep capture and renderer code dependency-free, put `ws` only in the Node relay/backend/demo layer, and adapt the Phase 2 loopback wiring into two tabs joined by a generated local room key. [VERIFIED: CLAUDE.md] [VERIFIED: 04-CONTEXT.md] [VERIFIED: examples/loopback-transport.js]

The relay should be a pure room fan-out core with adapter methods for backend sockets; the WebSocket backend should perform upgrade/path/role validation, use `perMessageDeflate: false`, enforce the protocol 1 MiB cap before delivery, and preserve raw frame fan-out. [VERIFIED: src/relay/README.md] [VERIFIED: src/protocol/constants.js] [CITED: https://github.com/websockets/ws/blob/master/doc/ws.md]

The biggest planning hazard is send ordering: native `CompressionStream` is async, while `createCapture` and `createViewer` call `transport.send()` fire-and-forget. Put native deflate work inside the WebSocket transport's FIFO queue and make `flush()` the deterministic drain point. [VERIFIED: src/capture/index.js] [VERIFIED: src/renderer/index.js] [CITED: https://nodejs.org/api/webstreams.html]

**Primary recommendation:** Build four scoped surfaces: `src/relay/*`, `src/transport/websocket.js`, viewer `on()` events, and `bin/phantom-stream.js demo` plus two demo HTML pages. [VERIFIED: 04-CONTEXT.md] [VERIFIED: src/relay/README.md]

## Project Constraints (from CLAUDE.md)

- New framework code uses plain JavaScript ESM with JSDoc, named exports, explicit `.js` imports, and no runtime library build step. [VERIFIED: CLAUDE.md]
- Capture core must remain injectable as plain script logic and must not gain runtime dependencies from the relay/demo work. [VERIFIED: CLAUDE.md] [VERIFIED: src/capture/index.js]
- Protocol code stays dependency-free; codecs are injected or native-runtime based. [VERIFIED: CLAUDE.md] [VERIFIED: src/protocol/envelope.js]
- Security is non-negotiable: render attacker-influenced HTML only through `createViewer`, retain capture/render sanitization, and keep the iframe sandbox exactly `allow-same-origin` with no `allow-scripts`. [VERIFIED: CLAUDE.md] [VERIFIED: docs/SECURITY.md] [VERIFIED: src/renderer/index.js]
- Performance lessons must not regress: rAF mutation delivery, single-pass layout reads, whole-subtree truncation, and identity-stamped stale rejection remain unchanged. [VERIFIED: CLAUDE.md] [VERIFIED: docs/DESIGN-HISTORY.md] [VERIFIED: src/capture/index.js]
- Tests use Node's built-in `node:test` plus `assert`; full suite is `npm test`. [VERIFIED: package.json] [VERIFIED: tests/]
- Project-local skills are absent; `.claude` exists but no `.claude/skills/*/SKILL.md` or `.agents/skills/*/SKILL.md` files were found. [VERIFIED: find .claude .agents -maxdepth 3]

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|--------------|----------------|-----------|
| Relay room routing, cap enforcement, backpressure drops, diagnostics | API / Backend | Protocol | The relay owns socket admission and raw frame fan-out; cap values come from shared protocol constants. [VERIFIED: src/relay/README.md] [VERIFIED: src/protocol/constants.js] |
| Browser source/viewer WebSocket transport | Browser / Client | API / Backend | Browser tabs own `WebSocket`, native compression, message queues, and status events; relay only forwards frames. [VERIFIED: 04-CONTEXT.md] [CITED: https://developer.mozilla.org/en-US/docs/Web/API/WebSocket/bufferedAmount] |
| Node WebSocket backend/demo server | API / Backend | CDN / Static | The CLI serves local HTML/JS and upgrades `/ws` connections through `ws`; static path safety follows `examples/serve.js`. [VERIFIED: examples/serve.js] [CITED: https://github.com/websockets/ws/blob/master/doc/ws.md] |
| Compression envelope encode/decode | Browser / Client | API / Backend | Encoding/decoding happens at endpoints so relay fan-out stays raw and frames stay independently decodable. [VERIFIED: 04-CONTEXT.md] [VERIFIED: src/protocol/envelope.js] |
| Viewer lifecycle and health events | Browser / Client | Transport | `createViewer` owns rendering and stream counters; transport supplies connection status and drop/error counters. [VERIFIED: src/renderer/index.js] [VERIFIED: 04-CONTEXT.md] |
| Demo connection/health UI | Browser / Client | API / Backend | UI chrome belongs to demo pages, while viewer library emits events only. [VERIFIED: 04-UI-SPEC.md] |

## Standard Stack

### Core

| Library / Runtime | Version | Purpose | Why Standard |
|-------------------|---------|---------|--------------|
| Plain JS ESM + JSDoc | Native Node/browser ESM | Source modules, package exports, browser demo imports | Existing project standard; avoids a runtime build step for injectable capture/viewer code. [VERIFIED: CLAUDE.md] [VERIFIED: package.json] |
| `ws` | 8.21.0, npm modified 2026-05-22T17:59:59.582Z | Node WebSocket server/backend and optional Node client transport tests | Current registry version; official docs cover `WebSocketServer`, `noServer`, `perMessageDeflate`, and `bufferedAmount`. [VERIFIED: npm registry] [CITED: https://github.com/websockets/ws/blob/master/doc/ws.md] |
| Browser `WebSocket` | Runtime API | Browser source/viewer transport | Native browser API; `bufferedAmount` exposes queued bytes for health/backpressure telemetry. [CITED: https://developer.mozilla.org/en-US/docs/Web/API/WebSocket/bufferedAmount] |
| `CompressionStream` / `DecompressionStream` | Node v24.14.1 available; `deflate-raw` accepted locally | Native endpoint compression/decompression | WHATWG Compression API supports `deflate-raw`; Node docs list `deflate-raw` support in current web streams. [VERIFIED: node runtime probe] [CITED: https://compression.spec.whatwg.org/] [CITED: https://nodejs.org/api/webstreams.html] |
| Existing `src/protocol` | Local | Message types, stream identity, relay cap, legacy LZ envelope | Already tested and exported; phase should extend/wrap rather than replace. [VERIFIED: src/protocol/messages.js] [VERIFIED: src/protocol/constants.js] [VERIFIED: tests/protocol.test.js] |

### Supporting

| Library / Runtime | Version | Purpose | When to Use |
|-------------------|---------|---------|-------------|
| `jsdom` | 29.1.1, npm modified 2026-04-30T08:52:48.629Z | Unit tests for viewer/capture/CLI HTML behavior | Already installed and used by existing tests; use for viewer `on()` tests and static page assertions, not for real WebSocket browser proof. [VERIFIED: npm registry] [VERIFIED: package-lock.json] |
| Node `node:test` / `node:assert/strict` | Node v24.14.1 | Test framework | Existing suite standard; no Jest/Vitest migration. [VERIFIED: package.json] [VERIFIED: tests/] |
| Node `http`, `fs`, `path`, `url`, `crypto` | Node v24.14.1 | Local demo server, path safety, room key generation | Built-ins are enough for CLI/server except WebSocket. [VERIFIED: examples/serve.js] [VERIFIED: node runtime] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `ws` backend | Node built-in WebSocket client only | Node has a client-side global in modern releases, but not a built-in WebSocket server API equivalent to `ws.WebSocketServer`; use `ws` for server/backend. [CITED: https://nodejs.org/api/webstreams.html] [CITED: https://github.com/websockets/ws/blob/master/doc/ws.md] |
| Native endpoint deflate | WebSocket `permessage-deflate` | Reject: locked decision requires independently decodable frames and no stateful per-connection compression; `ws` docs expose `perMessageDeflate: false`. [VERIFIED: 04-CONTEXT.md] [CITED: https://github.com/websockets/ws/blob/master/doc/ws.md] |
| A relay admin dashboard | In-memory diagnostics plus optional local JSON endpoint | Phase defers public admin UI; tests can read relay diagnostics directly. [VERIFIED: 04-CONTEXT.md] |
| CLI framework (`commander`, `yargs`) | Minimal manual parser | Phase needs one subcommand and a few flags; adding a CLI dependency would not reduce material complexity. [ASSUMED] |

**Installation:**

```bash
npm install ws@8.21.0
```

**Version verification:** `npm view ws version time.modified --json` returned `8.21.0` and `2026-05-22T17:59:59.582Z`; `npm view jsdom version time.modified --json` returned `29.1.1` and `2026-04-30T08:52:48.629Z`. [VERIFIED: npm registry]

## Architecture Patterns

### System Architecture Diagram

```text
CLI: phantom-stream demo
  |
  v
Local HTTP server on 127.0.0.1
  |-- serves /demo/source?room=<key>  --> Browser source tab
  |                                      createCapture({ transport: wsSource })
  |                                      source controls mutate DOM
  |
  |-- serves /demo/viewer?room=<key>  --> Browser viewer tab
  |                                      createViewer({ transport: wsViewer })
  |                                      viewer.on('state'|'health') updates demo chrome
  |
  `-- upgrades /ws?room=<key>&role=source|viewer
         |
         v
      WebSocket backend (ws, perMessageDeflate:false)
         |
         v
      Relay core room map
        - validate role and room
        - classify frame type without payload transform
        - enforce 1 MiB cap before delivery
        - drop per-client backpressure overflow
        - append in-memory diagnostics
         |
         +--> source -> viewer raw fan-out
         |
         `--> viewer -> source control raw fan-out
```

This flow preserves source/viewer endpoint responsibility for encode/decode and leaves the relay as raw routing plus safety controls. [VERIFIED: 04-CONTEXT.md] [VERIFIED: src/relay/README.md] [VERIFIED: reference/server/ws-handler.js]

### Recommended Project Structure

```text
bin/
  phantom-stream.js           # package bin; routes `demo`
src/
  relay/
    index.js                  # public exports
    relay.js                  # pure room routing and diagnostics
    limits.js                 # cap/backpressure/classification helpers
    backends/
      ws.js                   # ws WebSocketServer adapter
  transport/
    websocket.js              # browser/Node endpoint transport + FIFO codec queue
examples/
  two-tab-demo/
    source.html               # source tab UI
    viewer.html               # viewer tab UI
    demo.css                  # plain CSS matching 04-UI-SPEC
    source.js                 # createCapture wiring
    viewer.js                 # createViewer wiring
    server.js                 # local-only demo server helper, imported by CLI
tests/
  relay-core.test.js
  relay-ws-backend.test.js
  websocket-transport.test.js
  renderer-health-events.test.js
  demo-cli.test.js
```

Keep package exports stable for existing subpaths and add new subpaths for relay/transport only. [VERIFIED: package.json] [VERIFIED: 04-CONTEXT.md]

### Pattern 1: Pure Relay Core With Socket Adapter

**What:** `createRelay()` manages rooms and accepts socket-like objects with `send(raw)`, `readyState`, `bufferedAmount`, and metadata; the WebSocket backend translates `ws` events into core calls. [VERIFIED: src/relay/README.md] [VERIFIED: reference/server/ws-handler.js]

**When to use:** All relay behavior except HTTP upgrade and `ws` object construction. [VERIFIED: src/relay/README.md]

**Example:**

```javascript
// Source: src/relay/README.md + reference/server/ws-handler.js
import { RELAY_PER_MESSAGE_LIMIT_BYTES } from '../protocol/constants.js';

export function createRelay(options) {
  var cfg = options || {};
  var rooms = new Map();
  var diagnostics = new Map();
  var capBytes = cfg.capBytes || RELAY_PER_MESSAGE_LIMIT_BYTES;

  function connect(client) {
    var room = getOrCreateRoom(rooms, client.roomId);
    room[client.role === 'source' ? 'sources' : 'viewers'].add(client);
    return function disconnect() {
      room.sources.delete(client);
      room.viewers.delete(client);
    };
  }

  function receive(sender, raw) {
    var check = classifyAndCheckLimit(raw, capBytes);
    if (!check.ok) {
      recordOversize(diagnostics, sender, check);
      return { deliveredCount: 0, droppedCount: 1 };
    }
    var room = rooms.get(sender.roomId);
    var targets = sender.role === 'source' ? room.viewers : room.sources;
    return sendToTargets(diagnostics, sender, targets, raw, check.type);
  }

  return { connect, receive, diagnostics: function () { return diagnostics; } };
}
```

### Pattern 2: Cap Before Delivery, Classify Without Transforming

**What:** Measure raw wire bytes first, parse only enough JSON to classify `type` or envelope marker, and never decompress or mutate payloads at the relay. [VERIFIED: 04-CONTEXT.md] [VERIFIED: src/protocol/envelope.js]

**When to use:** Relay inbound message handling before fan-out. [VERIFIED: 04-CONTEXT.md]

**Example:**

```javascript
// Source: RELY-01 + src/protocol/constants.js
export function classifyWireFrame(raw) {
  var text = typeof raw === 'string' ? raw : raw.toString();
  var parsed = null;
  try { parsed = JSON.parse(text); } catch (err) {}
  return {
    byteSize: Buffer.byteLength(text, 'utf8'),
    type: parsed && typeof parsed.type === 'string'
      ? parsed.type
      : (parsed && parsed._lz === true ? 'lz-envelope'
        : (parsed && parsed._ps === 'deflate-raw' ? 'deflate-raw-envelope' : 'unknown')),
    compressed: !!(parsed && (parsed._lz === true || parsed._ps === 'deflate-raw'))
  };
}
```

### Pattern 3: Async Native Deflate Behind FIFO `send()`

**What:** `send(type, payload)` appends work to a per-connection promise chain and returns immediately; `flush()` returns the current chain. [VERIFIED: 04-CONTEXT.md] [VERIFIED: src/capture/index.js] [VERIFIED: src/renderer/index.js]

**When to use:** Browser and Node endpoint transports where encoding can be async. [CITED: https://nodejs.org/api/webstreams.html]

**Example:**

```javascript
// Source: examples/loopback-transport.js ordering precedent + CompressionStream docs
export function createQueuedWebSocketTransport(ws, codec, logger) {
  var queue = Promise.resolve();
  var closed = false;

  function send(type, payload) {
    var msg = { type: type, payload: payload, ts: Date.now() };
    queue = queue.then(async function () {
      if (closed || ws.readyState !== WebSocket.OPEN) return;
      var wire = await codec.encode(msg);
      ws.send(wire);
    }).catch(function (err) {
      if (logger && logger.error) logger.error('[WS transport] send failed', err);
    });
  }

  function flush() {
    return queue;
  }

  return { send: send, flush: flush };
}
```

### Pattern 4: Endpoint Codec Preserves Plain JSON and Legacy LZ Decode

**What:** Add an async native deflate envelope such as `{ _ps: 'deflate-raw', d: '<base64>' }`, while retaining current plain JSON and `{ _lz: true, d }` decoder behavior. [VERIFIED: src/protocol/envelope.js] [VERIFIED: 04-CONTEXT.md]

**When to use:** `src/transport/websocket.js` encode/decode and protocol tests. [VERIFIED: tests/protocol.test.js]

**Example:**

```javascript
// Source: WHATWG Compression spec + existing src/protocol/envelope.js shape
export async function encodeDeflateRawEnvelope(msg, thresholdBytes) {
  var json = JSON.stringify(msg);
  if (json.length <= (thresholdBytes || 1024) || !canUseNativeDeflateRaw()) {
    return json;
  }
  var bytes = new TextEncoder().encode(json);
  var compressed = await readAllBytes(
    new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'))
  );
  if (compressed.byteLength >= bytes.byteLength) return json;
  return JSON.stringify({ _ps: 'deflate-raw', d: bytesToBase64(compressed) });
}
```

### Pattern 5: Viewer Events Are Library Events, Demo UI Is Host Chrome

**What:** `createViewer()` owns a tiny internal event emitter and returns `on(event, handler)`; the demo listens and renders badges/status strips outside the viewer root. [VERIFIED: 04-CONTEXT.md] [VERIFIED: 04-UI-SPEC.md] [VERIFIED: src/renderer/index.js]

**When to use:** VIEW-02 implementation and demo page wiring. [VERIFIED: .planning/REQUIREMENTS.md]

**Example:**

```javascript
// Source: 04-CONTEXT.md D-19 through D-24
var listeners = { state: new Set(), health: new Set() };

function emit(event, payload) {
  listeners[event].forEach(function (handler) {
    try { handler(payload); } catch (err) { logger.error('[Renderer] event handler failed', err); }
  });
}

function on(event, handler) {
  if (!listeners[event] || typeof handler !== 'function') {
    throw new Error('viewer-event-unsupported');
  }
  listeners[event].add(handler);
  return function unsubscribe() { listeners[event].delete(handler); };
}
```

### Anti-Patterns to Avoid

- **Assuming the copied reference file enforces the cap:** `reference/server/ws-handler.js` has diagnostics and backpressure logic, but `rg` found no 1 MiB cap enforcement in that file; implement cap from `src/protocol/constants.js`. [VERIFIED: reference/server/ws-handler.js] [VERIFIED: rg 1048576/RELAY_PER_MESSAGE/oversize]
- **Putting compression in the relay:** It violates raw fan-out, complicates multi-viewer delivery, and breaks independently decodable endpoint frames. [VERIFIED: 04-CONTEXT.md]
- **Awaiting compression directly in capture/viewer code:** It would change fire-and-forget transport semantics and can reorder messages if multiple sends race. [VERIFIED: src/capture/index.js] [VERIFIED: src/renderer/index.js]
- **Letting demo pages render wire payloads manually:** The Phase 3 contract requires `createViewer` for mirrored content rendering. [VERIFIED: docs/SECURITY.md]
- **Adding browser-injected dependencies:** Browser capture/viewer/demo modules must remain native ESM and use platform APIs. [VERIFIED: CLAUDE.md] [VERIFIED: package.json]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| WebSocket server protocol | Custom HTTP upgrade/framing | `ws@8.21.0` `WebSocketServer` | `ws` already implements upgrade handling, ready states, sends, `bufferedAmount`, `noServer`, and compression controls. [VERIFIED: npm registry] [CITED: https://github.com/websockets/ws/blob/master/doc/ws.md] |
| Deflate algorithm | Manual DEFLATE, pako, zlib wrappers in browser code | Native `CompressionStream('deflate-raw')` / `DecompressionStream('deflate-raw')` with fallback | Native API is available in current Node runtime and standardized for browser endpoints. [VERIFIED: node runtime probe] [CITED: https://compression.spec.whatwg.org/] |
| Per-connection compression | WebSocket `permessage-deflate` | Endpoint envelope compression | Locked decision rejects stateful per-connection compression; `ws` allows disabling it. [VERIFIED: 04-CONTEXT.md] [CITED: https://github.com/websockets/ws/blob/master/doc/ws.md] |
| HTML safety in demo | Manual mirror DOM injection | Existing `createViewer` and sanitizer pipeline | Viewer sandbox/CSP/sanitization are already the security contract. [VERIFIED: docs/SECURITY.md] |
| Static file path safety | Naive URL-to-path serving | Adapt `examples/serve.js` guards | Existing server decodes before resolving, forbids traversal, avoids directory listings, and serves ESM MIME correctly. [VERIFIED: examples/serve.js] |

**Key insight:** The difficult parts are ordering, safety boundaries, and failure observability; the relay itself should stay boring raw fan-out plus limits. [VERIFIED: docs/DESIGN-HISTORY.md] [VERIFIED: 04-CONTEXT.md]

## Common Pitfalls

### Pitfall 1: Reference Cap Blind Spot
**What goes wrong:** Planner copies `reference/server/ws-handler.js` expecting a cap, but the copied file does not implement `RELAY_PER_MESSAGE_LIMIT_BYTES` checks. [VERIFIED: reference/server/ws-handler.js]  
**Why it happens:** Project docs describe the shipped relay behavior, while the file currently only shows room diagnostics and backpressure drops. [VERIFIED: docs/ARCHITECTURE.md] [VERIFIED: reference/server/ws-handler.js]  
**How to avoid:** Add `src/relay/limits.js` tests first and enforce `Buffer.byteLength(raw, 'utf8') <= RELAY_PER_MESSAGE_LIMIT_BYTES` before fan-out. [VERIFIED: src/protocol/constants.js]  
**Warning signs:** Oversize test sees any target `send()` call or diagnostics omit byte size/cap/compressed classification. [VERIFIED: 04-CONTEXT.md]

### Pitfall 2: Async Compression Reorders Frames
**What goes wrong:** Snapshot, mutations, scroll, and overlays can arrive out of order when multiple `CompressionStream` jobs resolve in a different order than `send()` calls. [VERIFIED: 04-CONTEXT.md]  
**Why it happens:** `CompressionStream` is stream/promise based, while existing transports are fire-and-forget. [CITED: https://nodejs.org/api/webstreams.html] [VERIFIED: src/capture/index.js]  
**How to avoid:** Implement a per-transport FIFO promise chain and test with deliberately delayed codec calls. [VERIFIED: examples/loopback-transport.js]  
**Warning signs:** A test sends A/B/C with B's codec delayed and receives A/C/B. [ASSUMED]

### Pitfall 3: New Native Envelope Breaks Legacy LZ Decode
**What goes wrong:** Extending `decodeEnvelope()` carelessly can make plain JSON or `{ _lz, d }` fail. [VERIFIED: src/protocol/envelope.js]  
**Why it happens:** Existing decode is sync and LZ-specific; native deflate decode is async. [VERIFIED: src/protocol/envelope.js] [CITED: https://nodejs.org/api/webstreams.html]  
**How to avoid:** Add async codec functions beside the sync LZ/plain helpers, and keep existing protocol tests untouched except adding new cases. [VERIFIED: tests/protocol.test.js]  
**Warning signs:** `plain messages decode without a codec` or `compressed envelope without a codec fails loud` tests regress. [VERIFIED: tests/protocol.test.js]

### Pitfall 4: Viewer Cannot Observe Relay Death Without Transport Status
**What goes wrong:** `createViewer` emits `live` on snapshot but never transitions to `stale`/`disconnected` when the WebSocket closes. [VERIFIED: src/renderer/index.js]  
**Why it happens:** Current viewer transport contract has only `send()` and `onMessage()`. [VERIFIED: src/renderer/index.js]  
**How to avoid:** Add an optional transport status subscription, e.g. `transport.onStatus(handler)`, and map close/reconnect to viewer `state` and `health` events. [ASSUMED]  
**Warning signs:** Kill-relay browser checkpoint only updates demo WebSocket chrome, not `viewer.on('state')`. [VERIFIED: 04-CONTEXT.md]

### Pitfall 5: Demo Works Only In One Tab Order
**What goes wrong:** Opening source before viewer loses the first snapshot; opening viewer before source loses the first control start. [VERIFIED: examples/loopback-transport.js] [VERIFIED: 04-CONTEXT.md]  
**Why it happens:** The relay is raw fan-out and intentionally does not buffer frames. [VERIFIED: reference/server/ws-handler.js]  
**How to avoid:** Have source auto-start on open and also handle `CONTROL.START`; have viewer send `CONTROL.START` on open and on resync. The browser verification should open viewer first, then source, matching the locked wiring shape. [VERIFIED: 04-CONTEXT.md] [ASSUMED]  
**Warning signs:** Refreshing either tab leaves the viewer stuck at `connecting` until a manual refresh. [ASSUMED]

## Code Examples

Verified patterns from local source and official docs:

### WebSocket Backend With `perMessageDeflate: false`

```javascript
// Source: ws docs + examples/serve.js local HTTP pattern
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';

var server = createServer(handleDemoRequest);
var wss = new WebSocketServer({
  server: server,
  path: '/ws',
  perMessageDeflate: false,
  maxPayload: RELAY_PER_MESSAGE_LIMIT_BYTES + 1024
});

wss.on('connection', function (socket, request) {
  var client = parseRelayClient(request.url);
  var disconnect = relay.connect({ socket: socket, roomId: client.roomId, role: client.role });
  socket.on('message', function (data) {
    relay.receive({ roomId: client.roomId, role: client.role, socket: socket }, data.toString());
  });
  socket.on('close', disconnect);
  socket.on('error', function () {});
});
```

### Viewer Event Health Snapshot

```javascript
// Source: src/renderer/index.js counters + 04-CONTEXT.md health contract
function healthSnapshot(extra) {
  return Object.assign({
    state: publicState,
    lastFrameAt: lastFrameAt,
    lastSnapshotAt: lastSnapshotAt,
    lastMutationAt: lastMutationAt,
    receivedByType: copyObject(receivedByType),
    sentByType: copyObject(sentByType),
    staleMisses: counters.staleMisses,
    applyFailures: counters.applyFailures,
    resyncPending: resyncPending,
    sanitizer: copyObject(sanitizeCounters)
  }, extra || {});
}
```

### Demo Source Control Glue

```javascript
// Source: examples/loopback-mirror.html control glue adapted to WebSocket transport
transport.onMessage(function (type) {
  if (type === CONTROL.START) capture.start();
  else if (type === CONTROL.STOP) capture.stop();
  else if (type === CONTROL.PAUSE) capture.pause();
  else if (type === CONTROL.RESUME) capture.resume();
});

transport.onStatus(function (status) {
  updateSourceStatus(status);
  if (status.state === 'open') capture.start();
});
```

## State of the Art

| Old Approach | Current Approach | When Changed / Verified | Impact |
|--------------|------------------|--------------------------|--------|
| LZ-string outbound envelope only | Native `CompressionStream('deflate-raw')` outbound by default, legacy `_lz` decode retained | `CompressionStream` `deflate-raw` supported in current Node runtime; WHATWG spec lists `deflate-raw`. [VERIFIED: node runtime probe] [CITED: https://compression.spec.whatwg.org/] | New endpoint code can compress without bundling LZ for the demo, while FSB `_lz` frames still decode. |
| WebSocket permessage-deflate as transport compression | Endpoint-owned stateless envelopes | Locked in Phase 04; `ws` supports disabling permessage-deflate. [VERIFIED: 04-CONTEXT.md] [CITED: https://github.com/websockets/ws/blob/master/doc/ws.md] | Bad frames cannot corrupt a per-connection compression context; relay can remain raw fan-out. |
| Viewer internal `waiting|streaming` gate only | Public `connecting|live|stale|disconnected` events plus health payloads | Phase 04 VIEW-02. [VERIFIED: .planning/REQUIREMENTS.md] | Host apps and demo UI can observe lifecycle without viewer-owned chrome. |
| One-page loopback demo | Two-tab source/viewer over local relay | Phase 04 PKG-01. [VERIFIED: .planning/ROADMAP.md] | Proves network transport and kill-relay lifecycle while keeping remote control deferred. |

**Deprecated/outdated:**
- `permessage-deflate` for PhantomStream frame compression: rejected for this project because frames must stay independently decodable and relay-compatible. [VERIFIED: 04-CONTEXT.md]
- Manual mirror rendering in demo pages: rejected by Phase 3 security contract. [VERIFIED: docs/SECURITY.md]

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | A minimal manual CLI argument parser is preferable to adding a CLI dependency for one `demo` subcommand. | Standard Stack | Low: planner could add a tiny dependency, but it would add package surface outside current style. |
| A2 | `transport.onStatus(handler)` is the cleanest optional hook for giving `createViewer` relay/WebSocket close/reconnect state. | Common Pitfalls / Architecture Patterns | Medium: if the planner chooses synthetic `STREAM.STATE` messages instead, tests and docs must still prove `viewer.on('state')` observes relay death. |
| A3 | Browser verification will open viewer first, then source, matching the loopback ordering contract. | Common Pitfalls / Validation Architecture | Low: source auto-start plus viewer resync should make either order recover, but the checkpoint should test the canonical order. |

## Open Questions

1. **Native deflate envelope marker**
   - What we know: Plain JSON and legacy `{ _lz, d }` are locked; native deflate needs a distinct self-identifying marker. [VERIFIED: 04-CONTEXT.md] [VERIFIED: src/protocol/envelope.js]
   - What's unclear: The exact marker name is not locked. [VERIFIED: 04-CONTEXT.md]
   - Recommendation: Use `{ _ps: 'deflate-raw', d: base64 }` so legacy `_lz` decoding remains unambiguous. [ASSUMED]

2. **Exact local npx invocation before publish**
   - What we know: `package.json` is scoped as `@fullselfbrowsing/phantom-stream` and currently has no `bin`; Phase 04 locks a `phantom-stream demo` binary path and defers publishing details. [VERIFIED: package.json] [VERIFIED: 04-CONTEXT.md]
   - What's unclear: Whether pre-publish validation must literally run `npx phantom-stream demo` or can use `node bin/phantom-stream.js demo` plus package bin tests. [ASSUMED]
   - Recommendation: Implement `bin.phantom-stream`, test the bin script directly in Phase 04, and leave public npm invocation exactness to Phase 10 unless the planner has a cheap local `npm exec` proof. [ASSUMED]

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Node.js | CLI, relay, tests, native compression | ✓ | v24.14.1 | None needed. [VERIFIED: node --version] |
| npm / npx | install and bin smoke tests | ✓ | 11.11.0 | None needed. [VERIFIED: npm --version] |
| `ws` package | Node WebSocket backend | ✗ currently not installed | Current 8.21.0 | Install with `npm install ws@8.21.0`. [VERIFIED: npm list --depth=0] [VERIFIED: npm registry] |
| `jsdom` | Existing unit tests | ✓ | 29.1.1 | None needed. [VERIFIED: npm list --depth=0] |
| Native `CompressionStream('deflate-raw')` | Node transport tests | ✓ | Node v24.14.1 accepted constructor | Fallback to plain JSON and log diagnostic if unavailable. [VERIFIED: node runtime probe] |
| Google Chrome app | Browser demo verification | ✓ | App present at `/Applications/Google Chrome.app`; CLI version command not found | Use Codex Browser plugin or macOS app for manual checkpoint. [VERIFIED: filesystem probe] |

**Missing dependencies with no fallback:**
- None for planning; `ws` must be added during implementation. [VERIFIED: npm list --depth=0]

**Missing dependencies with fallback:**
- `ws` missing locally; install as a runtime dependency isolated to relay/demo. [VERIFIED: npm list --depth=0] [VERIFIED: 04-CONTEXT.md]

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Node built-in `node:test` on Node v24.14.1. [VERIFIED: package.json] [VERIFIED: node --version] |
| Config file | none; scripts live in `package.json`. [VERIFIED: package.json] |
| Quick run command | `node --test tests/relay-core.test.js tests/websocket-transport.test.js tests/renderer-health-events.test.js tests/demo-cli.test.js` [ASSUMED] |
| Full suite command | `npm test` [VERIFIED: package.json] |

### Phase Requirements -> Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| RELY-01 | Relay routes source->viewer and viewer->source by room/role without same-side echo. | unit | `node --test tests/relay-core.test.js -x` | ❌ Wave 0 |
| RELY-01 | Relay rejects oversize frames and records diagnostics with room prefix, role, type, size, cap, compressed flag. | unit | `node --test tests/relay-core.test.js -x` | ❌ Wave 0 |
| RELY-01 | Relay drops frames for clients over backpressure limit and counts/logs drops. | unit | `node --test tests/relay-core.test.js -x` | ❌ Wave 0 |
| RELY-02 | Native deflate encode/decode round-trips, plain JSON decodes without codec, legacy `_lz` decodes with injected LZ codec. | unit | `node --test tests/websocket-transport.test.js tests/protocol.test.js -x` | ❌ Wave 0 / ✅ existing protocol |
| RELY-02 | Async codec preserves FIFO send order and `flush()` resolves after all sends. | unit | `node --test tests/websocket-transport.test.js -x` | ❌ Wave 0 |
| VIEW-02 | `viewer.on('state')` emits `connecting`, `live`, `stale`, `disconnected`; unsubscribe works; handle includes existing methods. | unit | `node --test tests/renderer-health-events.test.js tests/renderer-viewer.test.js -x` | ❌ Wave 0 / ✅ existing viewer tests |
| VIEW-02 | `viewer.on('health')` exposes counters/timestamps but not HTML/text payload content. | unit | `node --test tests/renderer-health-events.test.js -x` | ❌ Wave 0 |
| PKG-01 | CLI demo server binds `127.0.0.1`, prints source/viewer URLs and room prefix, serves ESM with safe paths. | integration | `node --test tests/demo-cli.test.js -x` | ❌ Wave 0 |
| PKG-01 | Browser opens viewer and source, sees live mutation mirror, then relay kill produces `live -> stale -> disconnected`. | browser/manual | `npm run demo -- --no-open`, open printed URLs, mutate, stop process | ❌ Wave 0 manual checkpoint |

### Sampling Rate

- **Per task commit:** focused `node --test` command for the touched module. [VERIFIED: package.json]
- **Per wave merge:** `npm test`. [VERIFIED: package.json]
- **Phase gate:** Full suite green plus browser kill-relay checkpoint before `/gsd-verify-work`. [VERIFIED: 04-CONTEXT.md]

### Wave 0 Gaps

- [ ] `tests/relay-core.test.js` - covers RELY-01 routing, cap diagnostics, backpressure, room cleanup. [VERIFIED: tests/ missing file]
- [ ] `tests/relay-ws-backend.test.js` - covers `ws` backend admission/path/role validation and `perMessageDeflate:false`. [VERIFIED: tests/ missing file]
- [ ] `tests/websocket-transport.test.js` - covers native codec fallback, legacy `_lz` decode, FIFO ordering, `flush()`, close/status events. [VERIFIED: tests/ missing file]
- [ ] `tests/renderer-health-events.test.js` - covers VIEW-02 event payloads and lifecycle transitions. [VERIFIED: tests/ missing file]
- [ ] `tests/demo-cli.test.js` - covers package bin route, local bind, URL printing, static path safety, startup/shutdown. [VERIFIED: tests/ missing file]
- [ ] Browser checkpoint script or manual verification note in phase verification artifact. [VERIFIED: 04-CONTEXT.md]

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|------------------|
| V2 Authentication | no for full auth; yes for local room pairing | Use generated local room key only for demo pairing; do not claim full auth. [VERIFIED: 04-CONTEXT.md] |
| V3 Session Management | no | No login/session cookies in Phase 04. [VERIFIED: 04-CONTEXT.md] |
| V4 Access Control | yes | Validate `role=source|viewer`, require room key, route only opposite-side frames, and reject invalid upgrade paths. [VERIFIED: src/relay/README.md] |
| V5 Input Validation | yes | Validate query params, cap raw bytes, classify JSON safely, reject traversal in static server. [VERIFIED: examples/serve.js] [VERIFIED: src/protocol/constants.js] |
| V6 Cryptography | yes for randomness only | Use `crypto.randomBytes` or browser `crypto.getRandomValues` for room keys; do not hand-roll randomness or crypto. [ASSUMED] |

### Known Threat Patterns for Phase 04 Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Viewer XSS from mirrored page content | Elevation of privilege | Keep all mirror rendering inside `createViewer`, retain sandbox exactly `allow-same-origin`, retain capture/render sanitizers. [VERIFIED: docs/SECURITY.md] |
| Drive-by local WebSocket access from another local page | Spoofing / Information disclosure | Bind to `127.0.0.1`, use unguessable room key, validate role/path, and consider same-origin `Origin` check for demo WebSocket upgrades. [VERIFIED: 04-CONTEXT.md] [ASSUMED] |
| Relay memory exhaustion by large frames | Denial of service | Enforce `RELAY_PER_MESSAGE_LIMIT_BYTES` before delivery and set `ws` `maxPayload` near the protocol cap. [VERIFIED: src/protocol/constants.js] [CITED: https://github.com/websockets/ws/blob/master/doc/ws.md] |
| Slow/wedged viewer socket | Denial of service | Drop frames to clients whose `bufferedAmount` exceeds 16 MiB and count/log the drop. [VERIFIED: reference/server/ws-handler.js] |
| Health telemetry leaks mirrored page content | Information disclosure | Health payloads contain counters/timestamps/types only, never payload HTML/text/URLs beyond demo room/transport status. [VERIFIED: 04-CONTEXT.md] |
| Static server path traversal | Tampering / Information disclosure | Reuse decode-before-resolve root-prefix guard from `examples/serve.js`. [VERIFIED: examples/serve.js] |

## Sources

### Primary (HIGH confidence)

- `.planning/phases/04-relay-ws-transport-two-tab-demo/04-CONTEXT.md` - locked Phase 04 decisions, deferred scope, verification requirements.
- `.planning/phases/04-relay-ws-transport-two-tab-demo/04-UI-SPEC.md` - two-tab UI, status state names, terminal output contract.
- `.planning/REQUIREMENTS.md` - RELY-01, RELY-02, PKG-01, VIEW-02.
- `.planning/ROADMAP.md` - Phase 04 goal and success criteria.
- `.planning/STATE.md` - Phase 04 async CompressionStream send-ordering concern.
- `.planning/PROJECT.md` and `CLAUDE.md` - project constraints, stack, GSD rules, no project-local skills.
- `docs/ARCHITECTURE.md`, `docs/DESIGN-HISTORY.md`, `docs/SECURITY.md` - relay/capture/renderer/security provenance.
- `src/protocol/constants.js`, `src/protocol/messages.js`, `src/protocol/envelope.js` - protocol constants, message types, legacy envelope behavior.
- `src/capture/index.js`, `src/renderer/index.js` - transport contracts, optional flush, current viewer lifecycle internals.
- `examples/loopback-transport.js`, `examples/loopback-mirror.html`, `examples/serve.js` - ordering, demo, and static server precedents.
- `reference/server/ws-handler.js`, `reference/extension/ws-client.js`, `reference/dashboard/dashboard.js` - FSB reference behavior.
- `npm view ws version time.modified --json` - `ws@8.21.0`, modified 2026-05-22T17:59:59.582Z.
- Context7 `/websockets/ws` docs - `WebSocketServer`, `perMessageDeflate`, `bufferedAmount`, `noServer`.
- Context7 `/nodejs/node` docs - `CompressionStream` / `DecompressionStream` `deflate-raw` support.

### Secondary (MEDIUM confidence)

- https://github.com/websockets/ws/blob/master/doc/ws.md - official `ws` API details.
- https://github.com/websockets/ws - official README for client/server examples and disabling client permessage-deflate.
- https://nodejs.org/api/webstreams.html - Node Web Streams and CompressionStream docs.
- https://developer.mozilla.org/en-US/docs/Web/API/CompressionStream/CompressionStream - browser constructor and `deflate-raw` meaning.
- https://developer.mozilla.org/en-US/docs/Web/API/WebSocket/bufferedAmount - browser `bufferedAmount` semantics.
- https://compression.spec.whatwg.org/ - WHATWG Compression Standard supported formats.

### Tertiary (LOW confidence)

- None used as authoritative sources.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - current npm versions verified, official/Context7 docs checked, local runtime probed.
- Architecture: HIGH - constrained by existing source and locked Phase 04 decisions.
- Pitfalls: HIGH for cap/order/security findings verified in local files; MEDIUM for transport status hook shape because exact API name remains planner discretion.

**Research date:** 2026-06-14 CDT  
**Valid until:** 2026-07-14 for stack versions; re-run `npm view ws version` before implementation if planning slips.
