---
phase: 04-relay-ws-transport-two-tab-demo
verified: 2026-06-15T06:56:19Z
status: passed
score: 22/22 must-haves verified
overrides_applied: 0
code_review:
  status: clean
  reviewed: 2026-06-15T06:48:55Z
  findings:
    critical: 0
    warning: 0
    info: 0
  evidence: "04-REVIEW.md reports clean after commit 5ac1edb fixed the expanded compression envelope warning; npm test passed 252/252."
test_evidence:
  - command: "node --test tests/relay-core.test.js tests/relay-ws-backend.test.js tests/websocket-transport.test.js tests/renderer-health-events.test.js tests/demo-cli.test.js -x"
    result: "PASS, 47/47 tests"
  - command: "npm test"
    result: "PASS, 252/252 tests"
  - command: "npm ls ws --depth=0"
    result: "PASS, ws@8.21.0"
  - command: "npx --no-install phantom-stream demo --help"
    result: "PASS, usage printed without starting server"
browser_checkpoint:
  status: passed
  evidence: "FSB browser checkpoint supplied by orchestrator: viewer opened first, source opened second, live mirroring worked, source mutations reflected, relay shutdown emitted live at 0 ms, stale at 3408 ms, disconnected at 8397 ms, last iframe frame retained, errors 0."
---

# Phase 04: Relay, WS Transport & Two-Tab Demo Verification Report

**Phase Goal:** The mirror works across the network - `npx phantom-stream demo` captures a page in one tab and mirrors it live in another through the bundled relay
**Verified:** 2026-06-15T06:56:19Z
**Status:** passed
**Re-verification:** No - initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `npx phantom-stream demo` works end-to-end: bundled relay starts, one tab captures, another tab mirrors live | VERIFIED | `package.json:8` exposes the `phantom-stream` bin; `bin/phantom-stream.js:31` starts `startDemoServer`; `npx --no-install phantom-stream demo --help` passed; FSB browser checkpoint confirmed live mirroring. |
| 2 | Relay core is transport-agnostic with pluggable backends; ws backend enforces 1 MiB cap and oversize diagnostics | VERIFIED | `src/relay/relay.js:43` exports pure `createRelay`; `src/relay/backends/ws.js:53` disables permessage-deflate and `:54` sets `maxPayload`; relay cap enforcement uses `checkRelayFrameLimit` at `src/relay/relay.js:112`. |
| 3 | Wire compression defaults to native `CompressionStream('deflate-raw')`, keeps `_lz` decode, and preserves async send ordering | VERIFIED | `src/transport/websocket.js:10` defines `deflate-raw`, `:198`/`:233` export encode/decode, `:249` delegates legacy `_lz` to `decodeEnvelope`, `:350`/`:428` use send FIFO; tests cover native fallback, `_lz`, FIFO, and `flush()`. |
| 4 | Viewer host receives `connecting`/`live`/`stale`/`disconnected` and stream-health telemetry via `on()` | VERIFIED | `src/renderer/index.js:427` implements `on`; `:402-423` gates exact lifecycle states and delayed disconnected; `:355-369` builds content-free health snapshots; demo consumes these at `examples/two-tab-demo/viewer.js:88` and `:95`. |
| 5 | Source and viewer clients join the same generated room and only opposite-side clients receive frames | VERIFIED | `examples/two-tab-demo/server.js:61` generates room key, `:170-171` puts same room into source/viewer URLs; relay chooses opposite targets in `src/relay/relay.js:129`; tests verify source->viewer and viewer->source isolation. |
| 6 | Relay fan-out preserves raw frame bytes and does not decode, decompress, rewrite, or buffer payloads | VERIFIED | `src/relay/relay.js:215` sends `options.raw` unchanged; `src/relay/limits.js:13-31` only classifies JSON/envelope shape for diagnostics; relay tests assert byte-identical receipt. |
| 7 | Oversize frames are rejected before delivery with room, role, type, byte-size, cap, and compressed-envelope diagnostics | VERIFIED | `src/relay/limits.js:65-95` returns structured `message-too-large`; `src/relay/relay.js:118-125` records it before fan-out; tests assert diagnostics fields. |
| 8 | Clients over backpressure limit drop frames for that client only and increment diagnostics | VERIFIED | `src/relay/relay.js:199-219` skips only wedged target and records `backpressure-drop`; focused relay test confirms healthy target still receives. |
| 9 | The WebSocket backend is isolated behind the relay seam, validates room and role, and disables permessage-deflate | VERIFIED | `src/relay/backends/ws.js:53` has `perMessageDeflate: false`; `:67-82` validates admission before `relay.addClient`; `:91` passes raw string to `relay.receive`. |
| 10 | Browser endpoints encode outbound frames with native deflate-raw when available and useful; small or expanded frames remain plain JSON | VERIFIED | `src/transport/websocket.js:198-223` encodes with native deflate and falls back when below threshold or envelope is not smaller; regression test covers expanded envelope fallback. |
| 11 | Plain JSON, native deflate envelopes, and legacy FSB `{ _lz: true, d }` envelopes decode at endpoints | VERIFIED | `src/transport/websocket.js:249-279` handles `_lz`, plain JSON, and `_ps: deflate-raw`; tests cover all three inbound shapes. |
| 12 | Async encoding cannot reorder sends; `flush()` resolves only after FIFO drains | VERIFIED | `src/transport/websocket.js:350`, `:428-465` implement send queue and flush; tests deliberately delay B and assert A/B/C order. |
| 13 | Transport errors and malformed envelopes emit status/health events and never throw through capture/viewer code | VERIFIED | `src/transport/websocket.js:407-414` routes encode diagnostics to status, `:491-497` records decode errors, `:512-520` contains message decode failures; tests assert structured errors and status emissions. |
| 14 | Viewer hosts can subscribe with `viewer.on('state', handler)` and receive `connecting`, `live`, `stale`, and `disconnected` | VERIFIED | `src/renderer/index.js:427-439` immediately emits current state and unsubscribes; renderer tests assert all lifecycle states and invalid event rejection. |
| 15 | Viewer hosts can subscribe with `viewer.on('health', handler)` and receive counters/timestamps/transport telemetry with no mirrored page content | VERIFIED | `src/renderer/index.js:355-369` whitelists health fields; `sanitizeTransportStatus` at `:316-333` strips status to safe telemetry; tests stringify and recursively reject `html`, `text`, `payload`, `url`, `title`. |
| 16 | Viewer handle keeps `detach`, `destroy`, and `registerOverlay` while adding `on` | VERIFIED | `src/renderer/index.js:817-822` returns exactly four handle methods; `tests/renderer-viewer.test.js:257-273` pins exact shape. |
| 17 | Transport close/reconnect signals make relay shutdown observable as stale and then disconnected | VERIFIED | `src/renderer/index.js:491-497` maps `closed` to stale plus delayed disconnected; `examples/two-tab-demo/viewer.js:46` uses 4000 ms demo delay; FSB checkpoint recorded live -> stale -> disconnected. |
| 18 | `node bin/phantom-stream.js demo` starts a 127.0.0.1-only demo server plus bundled relay and prints source/viewer URLs with generated room key | VERIFIED | `bin/phantom-stream.js:90-93` prints required lines; `examples/two-tab-demo/server.js:50-80` binds local server and returns URLs; `server.js:93-99` wires bundled relay/backend. |
| 19 | Opening viewer first and source second produces a live mirror through the relay | VERIFIED | Browser checkpoint supplied by orchestrator confirmed viewer first/source second reached Live with frames, snapshots, mutations, and errors 0. |
| 20 | Source tab mutates a small page with Add row, Remove row, Edit text, Show dialog, and Auto-mutate controls | VERIFIED | `examples/two-tab-demo/source.html:47-51` defines all five controls; `source.js:56-86` implements row mutations; `source.js:196-205` wires dialog and auto-mutate. |
| 21 | Viewer tab displays the mirror plus compact lifecycle and health status from `viewer.on('state'|'health')` | VERIFIED | `examples/two-tab-demo/viewer.html:20-48` defines lifecycle/health fields; `viewer.js:88-108` updates UI from `viewer.on` events. |
| 22 | Stopping the demo process makes viewer transition live -> stale -> disconnected while retaining the last frame | VERIFIED | FSB checkpoint supplied by orchestrator recorded live at 0 ms, stale at 3408 ms, disconnected at 8397 ms, iframe frame retained, errors 0; renderer tests also assert frame retention on stale misses. |

**Score:** 22/22 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/relay/relay.js` | Transport-agnostic relay core | VERIFIED | `createRelay`, raw opposite-side fan-out, diagnostics, cap and backpressure handling present. |
| `src/relay/limits.js` | Frame classification and cap checks | VERIFIED | `classifyRelayFrame` and `checkRelayFrameLimit` implemented with compressed-envelope detection. |
| `src/relay/backends/ws.js` | ws backend adapter | VERIFIED | Validates `/ws`, room, role; local ping/pong; `perMessageDeflate: false`; raw `relay.receive`. |
| `src/relay/index.js` | Relay public export barrel | VERIFIED | Exports limits, relay core, and ws backend. |
| `src/transport/websocket.js` | Browser WebSocket transport | VERIFIED | Codec helpers, FIFO send/receive queues, `flush`, `onMessage`, `onStatus`, health snapshots. |
| `src/renderer/index.js` | Viewer event API and telemetry | VERIFIED | Adds `viewer.on`, lifecycle mapping, health snapshots, transport status integration. |
| `src/renderer/README.md` | Event contract docs | VERIFIED | Documents `viewer.on('state'|'health')`, event names, fields, privacy boundary. |
| `bin/phantom-stream.js` | Package binary and demo subcommand | VERIFIED | Parses `demo`, `--port`, `--no-open`, prints deterministic URLs. |
| `examples/two-tab-demo/server.js` | Local-only demo server and relay | VERIFIED | Binds 127.0.0.1, generates room key, serves static safely, starts relay backend, closes cleanly. |
| `examples/two-tab-demo/source.html` | Source tab shell | VERIFIED | Contains required title, controls, status strip, module script. |
| `examples/two-tab-demo/viewer.html` | Viewer tab shell | VERIFIED | Contains mirror stage, lifecycle and health fields, module script. |
| `examples/two-tab-demo/source.js` | Capture-side demo wiring | VERIFIED | Uses `createCapture` and `createWebSocketTransport`, skipElement guard, source controls, auto-mutate. |
| `examples/two-tab-demo/viewer.js` | Viewer-side demo wiring | VERIFIED | Uses `createViewer`, transport, `viewer.on('state')`, `viewer.on('health')`, sends `CONTROL.START` on open. |
| `examples/two-tab-demo/demo.css` | Demo UI contract | VERIFIED | Includes stage aspect ratio, responsive heights, required colors and status styling. |
| `tests/relay-core.test.js` | RELY-01 relay core coverage | VERIFIED | Passed in focused and full test runs. |
| `tests/relay-ws-backend.test.js` | ws backend coverage | VERIFIED | Passed in focused and full test runs. |
| `tests/websocket-transport.test.js` | RELY-02 transport coverage | VERIFIED | Passed in focused and full test runs. |
| `tests/renderer-health-events.test.js` | VIEW-02 lifecycle/health coverage | VERIFIED | Passed in focused and full test runs. |
| `tests/demo-cli.test.js` | PKG-01 CLI/demo coverage | VERIFIED | Passed in focused and full test runs. |
| `package.json` / `package-lock.json` | bin, exports, ws dependency | VERIFIED | Bin present, relay and transport subpath exports present, exact `ws@8.21.0`; `npm ls ws --depth=0` passed. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/relay/relay.js` | `src/protocol/constants.js` | `RELAY_PER_MESSAGE_LIMIT_BYTES` import | VERIFIED | Found at `src/relay/relay.js:7`, used as default cap at `:46`. |
| `src/relay/relay.js` | `src/relay/limits.js` | `checkRelayFrameLimit` import | VERIFIED | Found at `src/relay/relay.js:8`, called at `:112`. |
| `src/relay/backends/ws.js` | `src/relay/relay.js` | Backend passes raw message strings to `relay.receive` | VERIFIED | Manual check found `relay.receive({ roomId, role, socket, raw })` at `src/relay/backends/ws.js:91`; gsd-tools regex produced a false negative. |
| `package.json` | `src/relay/index.js` | `./relay` export | VERIFIED | `package.json:14` maps `./relay` to `./src/relay/index.js`. |
| `src/transport/websocket.js` | `src/protocol/envelope.js` | Legacy `_lz` decode | VERIFIED | `decodeEnvelope` imported at `src/transport/websocket.js:8` and used at `:250`. |
| `src/renderer/index.js` | `transport.onStatus` | Optional status subscription | VERIFIED | `src/renderer/index.js:720-721` subscribes when available. |
| `bin/phantom-stream.js` | `examples/two-tab-demo/server.js` | imports `startDemoServer` | VERIFIED | Import at `bin/phantom-stream.js:3`, called at `:31`. |
| `examples/two-tab-demo/source.js` | `src/capture/index.js` | `createCapture` with WebSocket transport and skip guard | VERIFIED | Imports at `source.js:1-2`, capture constructed at `:107-112`. |
| `examples/two-tab-demo/viewer.js` | `src/renderer/index.js` | `createViewer` and `viewer.on('state'|'health')` | VERIFIED | `createViewer` imported at `viewer.js:1`, constructed at `:42-47`, event subscriptions at `:88` and `:95`; gsd-tools regex produced a false negative. |
| `examples/two-tab-demo/server.js` | `src/relay/index.js` | Demo server starts bundled relay/backend | VERIFIED | Import at `server.js:14`; `createRelay` and `createWebSocketRelayBackend` called at `:93-99`. |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `bin/phantom-stream.js` | `demo.sourceUrl`, `demo.viewerUrl`, `demo.roomKeyPrefix` | `startDemoServer()` | Yes - generated by server handle and printed by CLI | FLOWING |
| `examples/two-tab-demo/server.js` | room key and ws URLs | `randomBytes(16)` plus `buildDemoUrls()` | Yes - actual URL params share one generated room key | FLOWING |
| `examples/two-tab-demo/source.js` | stream frames | DOM controls plus `createCapture({ transport })` | Yes - capture sends snapshot/mutation/control responses over WebSocket transport | FLOWING |
| `src/transport/websocket.js` | outbound/inbound frames | WebSocket constructor and encode/decode helpers | Yes - sends encoded wire frames, decodes inbound frames, updates health | FLOWING |
| `src/relay/backends/ws.js` | raw relay frames | WebSocket `message` events | Yes - normalizes message data to string and calls relay core | FLOWING |
| `src/relay/relay.js` | room fan-out | room maps populated by backend admission | Yes - source targets viewers and viewer targets sources, raw bytes forwarded | FLOWING |
| `examples/two-tab-demo/viewer.js` | lifecycle and health UI | `viewer.on('state')`, `viewer.on('health')`, transport status | Yes - updates lifecycle badge, last frame, frame/snapshot/mutation/drop/error counters | FLOWING |
| `src/renderer/index.js` | mirror frame and health events | decoded `STREAM.*` messages via transport.onMessage | Yes - snapshot renders `srcdoc`, mutations apply, state/health listeners are notified | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Focused Phase 04 tests pass | `node --test tests/relay-core.test.js tests/relay-ws-backend.test.js tests/websocket-transport.test.js tests/renderer-health-events.test.js tests/demo-cli.test.js -x` | 47/47 pass | PASS |
| Full suite remains green | `npm test` | 252/252 pass | PASS |
| Exact ws dependency installed | `npm ls ws --depth=0` | `ws@8.21.0` | PASS |
| Local npx-style bin resolves | `npx --no-install phantom-stream demo --help` | Usage printed without starting server | PASS |
| Relay exports available | `node -e "import('./src/relay/index.js')..."` | `createRelay`, `createWebSocketRelayBackend`, `checkRelayFrameLimit` are functions | PASS |
| Transport exports available | `node -e "import('./src/transport/websocket.js')..."` | `createWebSocketTransport`, `encodeWireMessage`, `decodeWireMessage` are functions | PASS |
| Bundled demo server relays raw frame between real WebSocket source/viewer clients | Node spot-check using `startDemoServer({ host:'127.0.0.1', port:0 })` and `ws` clients | `{"host":"127.0.0.1","roomPrefix":"verifyro","delivered":true}` | PASS |
| Real browser two-tab mirroring and relay kill lifecycle | Orchestrator FSB browser checkpoint | Live mirror worked; relay shutdown events `live` 0 ms, `stale` 3408 ms, `disconnected` 8397 ms; last frame retained; errors 0 | PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| RELY-01 | `04-01-PLAN.md` | Relay is transport-agnostic with pluggable backends; self-hostable WebSocket reference implementation with per-message cap and oversize diagnostics | SATISFIED | `src/relay/*` and `tests/relay-core.test.js`/`tests/relay-ws-backend.test.js`; focused tests pass. |
| RELY-02 | `04-02-PLAN.md` | Native deflate envelope by default, lz-string-compatible decode, async codec preserves ordering | SATISFIED | `src/transport/websocket.js`; `tests/websocket-transport.test.js`; focused and full tests pass. |
| VIEW-02 | `04-03-PLAN.md`, `04-04-PLAN.md` | Host can subscribe to lifecycle/connection-state events and stream-health telemetry via `on()` | SATISFIED | `src/renderer/index.js`, renderer README, demo viewer wiring, renderer health tests, browser checkpoint lifecycle evidence. |
| PKG-01 | `04-04-PLAN.md` | `npx phantom-stream demo` works end-to-end: source tab captured, viewer tab mirrors live through bundled relay | SATISFIED | Package bin, local-only demo server, source/viewer pages, demo CLI tests, npx-style help spot-check, bundled WebSocket spot-check, FSB browser checkpoint. |

No orphaned Phase 4 requirement IDs were found in `.planning/REQUIREMENTS.md`; the four mapped IDs are all present in plan frontmatter and verified above.

### Code Review Status

| Review Artifact | Status | Findings | Evidence |
|-----------------|--------|----------|----------|
| `04-REVIEW.md` | clean | 0 critical, 0 warning, 0 info | Review at 2026-06-15T06:48:55Z covered 20 files. Previous expanded-compression-envelope warning was fixed by commit `5ac1edb`; final review notes `npm test` 252/252. |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| none | - | - | - | No blocking stub/placeholder patterns found. Grep hits were intended CLI `console.log` output, comments mentioning the host waiting placeholder, helper `return null` paths, and initial empty counters/lists that are populated by real data flow. |

### Human Verification Required

None remaining. The normally human/browser-only checks were already completed by the orchestrator's FSB browser checkpoint and are recorded in the behavioral evidence above.

### Gaps Summary

No gaps found. The phase goal is achieved: the CLI demo starts a local bundled relay, source and viewer tabs communicate through generated room URLs, frames flow through endpoint WebSocket transports and the raw relay, the viewer renders live updates, and relay shutdown is observable through `live -> stale -> disconnected` while retaining the last frame.

---

_Verified: 2026-06-15T06:56:19Z_
_Verifier: Codex (gsd-verifier)_
