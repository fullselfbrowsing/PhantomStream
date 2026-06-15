<!-- refreshed: 2026-06-09 -->
# Architecture

**Analysis Date:** 2026-06-09

## System Overview

PhantomStream mirrors a live browser tab to a remote viewer by streaming the page as
structured DOM data rather than pixels. The system has two architectural views:

1. **Reference implementation** — verbatim FSB source under `reference/`, the shipped
   production system (milestone v0.9.9.1 + phases 211, 276).
2. **Target framework** — the standalone extraction in progress under `src/`. Protocol,
   capture, renderer, and the RELY-01 relay core/ws backend are implemented as ESM
   package surfaces.

```text
page (content script)     extension SW           relay server          viewer (dashboard)
reference/extension/      reference/extension/   reference/server/     reference/dashboard/
dom-stream.js       →     background.js      →   ws-handler.js    →    dashboard.js
                          ws-client.js

snapshot + rAF-batched    LZ envelope,           fan-out,              decompress, iframe
diffs, scroll, overlay,   session stamps,        1 MiB/msg cap,        srcdoc render,
dialogs, watchdog #1      watchdog #2,           backpressure drop     nid-addressed diff
                          remote-control CDP                           apply, remote ctrl
```

## Four-Stage Pipeline

### Stage 1: Capture (`reference/extension/dom-stream.js`)

Runs in the browser tab as a Chrome MV3 content script. Responsible for:

- **Snapshot** (`serializeDOM`) — clones `document.body`, walks original + clone in
  parallel via two `TreeWalker` instances to read live state without triggering extra
  layout flushes, inlines ~85 curated computed CSS properties (`CURATED_PROPS`), strips
  scripts/overlays, absolutifies all URLs, converts canvases to data-URL `<img>` elements,
  stamps every element with `data-fsb-nid`.
- **Truncation** — performs a single read-pass over the live DOM to build a `Map` of
  `nid → getBoundingClientRect().top`, then drops whole subtrees whose top exceeds 3×
  viewport height; second pass drops remaining subtrees if still over 80% of the 1 MiB
  relay cap.
- **Incremental diffs** (`MutationObserver` on `document.body`) — batches mutations and
  flushes them on `requestAnimationFrame` to match the page paint cadence. Produces four
  op types: `add`, `rm`, `attr`, `text`.
- **Watchdog #1** — a 500 ms `setTimeout` chain (not `setInterval`) that force-flushes a
  stuck mutation queue after 5 s of no drain and increments `staleFlushCount`.
- **Side channels** — scroll (throttled 200 ms), overlay state (throttled 500 ms), native
  dialog interception via a page-injected monkey-patch script that emits `CustomEvent`s.
- **Lifecycle messages** received from background: `domStreamStart`, `domStreamStop`,
  `domStreamPause`, `domStreamResume`, `pingDomStream` (readiness probe).
- **Module registration** — on load, sends `domStreamReady` to background; registers
  `FSB.domStream` namespace.

**Key state** (all module-scoped):
- `streaming: boolean` — whether observers are active
- `streamSessionId: string` — minted by `beginStreamSession()` as `stream_<ts36>_<rand>`
- `currentSnapshotId: number` — `Date.now()` at session start
- `nextNodeId: number` — monotonically increasing counter reset per snapshot
- `pendingMutations: MutationRecord[]` — accumulated since last rAF flush
- `watchdogTimer: TimeoutId` — content-script self-watchdog

### Stage 2: Transport / Host (`reference/extension/ws-client.js` + `reference/extension/background.dom-stream-relay.excerpt.js`)

The Chrome MV3 service worker (background) has two responsibilities:

**Relay excerpt (`background.dom-stream-relay.excerpt.js`):**
- Receives `chrome.runtime.sendMessage` calls from the content script.
- Arms the `chrome.alarms` watchdog on every mutation dispatch.
- Forwards snapshot, mutations, scroll, overlay, dialog payloads to the relay server via
  `fsbWebSocket.send(type, payload)`.
- On `domStreamReady`, calls `_onDomStreamReady` to re-arm any parked pending intent.

**`FSBWebSocket` class (`ws-client.js`):**
- Maintains a persistent WebSocket to the relay server with 20 s keepalive pings and
  exponential backoff reconnection (first retry immediate, then 1 s → 2 s → 4 s → 30 s cap).
- **Compression** — payloads > 1 KB are LZ-string compressed; only if compressed < raw.
  Envelope format: `{ _lz: true, d: "<base64>" }`. Stateless per-frame — no sliding-window
  compression (PITFALLS.md P9: stateful deflate requires reconnect to recover from bad frames).
- **Inbound message routing** (`_handleMessage`) — switches on `msg.type`:
  - `dash:dom-stream-start` → `_handleDashboardStreamStart`: resolve stream candidate tab,
    inject content scripts, probe `pingDomStream` readiness, forward `domStreamStart`.
    Parks payload in `_pendingStreamStart` if probe times out (5 s budget); re-armed on
    `domStreamReady` from background.
  - `dash:dom-stream-stop/pause/resume` → `_forwardToContentScript`.
  - `dash:remote-control-start/stop` → `handleRemoteControlStart/Stop` (bare functions).
  - `dash:remote-click/key/scroll` → CDP dispatch via `executeCDPToolDirect` /
    `chrome.debugger.sendCommand`.
  - `dash:navigate` / `dash:navigate-history` → `chrome.tabs.update` / `goBack` /
    `goForward` / `reload`.

**Watchdog #2** (`background.watchdog-alarm.excerpt.js`):
- `chrome.alarms` alarm named `fsb-domstream-watchdog` at 1-minute period.
- On fire, sends `ext:request-snapshot` to the dashboard if `_streamingActive` is true.
- Survives MV3 service-worker eviction.

**Session identity** — `streamSessionId` + `snapshotId` stamp every message. The viewer
tracks the active identity and rejects stale messages (stale-message guard in
`isCurrentStream` — implemented in `src/protocol/messages.js`).

### Stage 3: Relay (`reference/server/ws-handler.js`)

A thin Node.js WebSocket fan-out server. Written in CommonJS; 367 lines.

- **Room model** — `rooms: Map<hashKey, { extensions: Set<ws>, dashboards: Set<ws> }>`.
  Extension and dashboard clients join the same hashKey-keyed room; the hashKey is a
  shared QR-pair secret minted server-side.
- **Fan-out** (`relayToRoom`) — raw message bytes are forwarded verbatim from extension to
  all dashboards (or vice versa). No deserialization — the relay is envelope-transparent.
- **Per-message cap** — 1 MiB (`RELAY_PER_MESSAGE_LIMIT_BYTES`). Oversized messages are
  classified by envelope type for diagnostics (compressed envelope detected by `_lz: true`
  shape).
- **Backpressure drop** — if `client.bufferedAmount > 16 MiB`, the frame is dropped and
  `backpressureDroppedCount` is incremented rather than OOM'ing the Node process.
- **Connection lifecycle** — on extension connect, broadcasts `ext:status { online: true }`
  to dashboards. On extension disconnect, broadcasts `ext:status { online: false }`. `ping`
  messages are consumed locally (not relayed); server responds with `pong`.
- **Diagnostics** — per-room ring buffer of 100 events (`receivedByType`, `deliveredByType`,
  `droppedByType`, connection events) exposed via `getRoomDiagnostics(hashKey)`.

### Stage 4: Renderer (`reference/dashboard/dashboard.js`)

Runs in the browser at `full-selfbrowsing.com/dashboard`. ~4 096 lines; the stream-relevant
parts are roughly lines 2700–3960.

- **Snapshot render** (`handleDOMSnapshot`):
  - Rebuilds a full HTML document: `<!DOCTYPE html><html ...><head>` with stylesheet
    `<link>` tags, inline `<style>` blocks, shell attributes/styles for `<html>` and
    `<body>`, then `<body>` with the captured innerHTML.
  - Writes to `previewIframe.srcdoc` (sandboxed iframe). On iframe load: calls
    `updatePreviewScale()`, scrolls to the captured position.
  - Detects stream replacement (mismatched `streamSessionId` / `snapshotId` / `tabId`) and
    resets overlay + scroll state.
- **Diff apply** (`handleDOMMutations`):
  - Each op resolves its target via `doc.querySelector('[data-fsb-nid="…"]')`.
  - Miss accounting: `staleMutationCount` increments on each missed nid lookup; after 3
    consecutive misses, `requestPreviewResync` triggers a fresh `dash:dom-stream-start`.
- **Layout modes**: `inline`, `maximized`, `pip` (drag-to-reposition), `fullscreen`
  (mouse-tracked exit overlay). Scale math adapts per mode.
- **Overlays**: glow rect (action highlight), progress card, dialog cards — positioned in
  mirror coordinate space.
- **Remote control**: pointer/keyboard/scroll events on the preview iframe are captured,
  coordinate-reverse-mapped from stage scale, and sent to the relay as `dash:remote-click`,
  `dash:remote-key`, `dash:remote-scroll`.
- **State machine** (`previewState`): `hidden | loading | streaming | disconnected |
  frozen-disconnect | frozen-complete | error`.

## Reverse Remote-Control Path

```text
viewer (dashboard)             relay                  extension SW          real tab
                  → dash:remote-control-start →    handleRemoteControlStart()
                                                   _broadcastRemoteControlState()
                  ← ext:remote-control-state ←

pointer event on mirror        relay                  background SW         CDP
  (coordinate reverse-map)
                  → dash:remote-click{x,y} →       handleRemoteClick()
                                                   chrome.debugger.sendCommand
                                                   Input.dispatchMouseEvent

                  → dash:remote-key{type,key} →    handleRemoteKey()
                                                   chrome.debugger.sendCommand
                                                   Input.dispatchKeyEvent

                  → dash:remote-scroll{x,y,δ} →   handleRemoteScroll()
                                                   executeCDPToolDirect(cdpScrollAt)

                  → dash:navigate{url} →           handleRemoteNavigate()
                                                   chrome.tabs.update()
                  ← ext:navigate-result ←
```

## Target Framework Architecture (`src/`)

The standalone extraction splits the reference along clean abstraction boundaries:

### Implemented: `src/protocol/`

The only complete module. Pure ESM, dependency-free, runtime-agnostic.

| File | Exports |
|------|---------|
| `src/protocol/constants.js` | Numeric constants: `RELAY_PER_MESSAGE_LIMIT_BYTES`, `SNAPSHOT_BUDGET_BYTES`, throttle values, watchdog intervals |
| `src/protocol/messages.js` | Message type namespaces (`CONTROL`, `STREAM`, `DIFF_OP`), `NID_ATTR`, `SnapshotPayload` typedef, `createStreamSessionId()`, `isCurrentStream()` |
| `src/protocol/envelope.js` | `encodeEnvelope()`, `decodeEnvelope()`, `isCompressedEnvelope()` — LZ codec injected by caller |
| `src/protocol/index.js` | Re-exports all of the above |

### Planned: `src/capture/`

Extraction of `reference/extension/dom-stream.js`. Primary abstractions to inject:
- `Transport` interface (`send(type, payload)`) to replace `chrome.runtime.sendMessage`
- Options object `{ logger, overlayProvider, skipElement(el) }` to replace `window.FSB`

Planned module split: `serializer.js`, `differ.js`, `side-channels.js`, `session.js`,
`index.js` → `createCapture({ transport, options }) -> { start, stop, pause, resume }`

### Implemented: `src/relay/`

Transport-agnostic relay extraction from `reference/server/ws-handler.js`, with a Node
`ws` reference backend.

| File | Exports |
|------|---------|
| `src/relay/limits.js` | `classifyRelayFrame()`, `checkRelayFrameLimit()` |
| `src/relay/relay.js` | `createRelay()`, `BACKPRESSURE_BUFFER_LIMIT_BYTES` |
| `src/relay/backends/ws.js` | `createWebSocketRelayBackend()` |
| `src/relay/index.js` | Re-exports all relay surfaces for package `./relay` |

The relay core routes raw source/viewer frames to the opposite role, enforces
`RELAY_PER_MESSAGE_LIMIT_BYTES` before delivery, drops frames for targets over the
16 MiB backpressure limit, and stores bounded in-memory diagnostics. The `ws` backend
validates `/ws?room=<key>&role=source|viewer`, disables `perMessageDeflate`, handles
local ping/pong, and delegates all routing/limit decisions to the relay core.

### Planned: `src/renderer/`

Extraction of viewer code from `reference/dashboard/dashboard.js` (~lines 2700–3960).

Planned module split: `snapshot-renderer.js`, `diff-applier.js`, `overlays.js`,
`remote-control.js`, `layout.js`,
`index.js` → `createViewer({ container, transport }) -> { attach, detach }`

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| Capture | Snapshot + diffs + side channels | `reference/extension/dom-stream.js` |
| Transport host | SW relay, compression, remote-control CDP | `reference/extension/ws-client.js` |
| Background relay | content-script → WS forwarding, watchdog #2 arm | `reference/extension/background.dom-stream-relay.excerpt.js` |
| SW watchdog alarm | Safety net for wedged content script | `reference/extension/background.watchdog-alarm.excerpt.js` |
| LZ-string codec | Compression library (vendored) | `reference/extension/lz-string.min.js` |
| Relay server | WS fan-out, size cap, backpressure drop | `reference/server/ws-handler.js` |
| Renderer/viewer | Snapshot render, diff apply, overlays, RC | `reference/dashboard/dashboard.js` |
| Protocol constants | Shared numeric constants | `src/protocol/constants.js` |
| Protocol messages | Wire types, nid attr, session ID, staleness guard | `src/protocol/messages.js` |
| Protocol envelope | LZ encode/decode | `src/protocol/envelope.js` |
| Relay core | Raw room fan-out, cap checks, diagnostics, backpressure drops | `src/relay/relay.js`, `src/relay/limits.js` |
| WebSocket backend | Node `ws` admission and socket lifecycle adapter | `src/relay/backends/ws.js` |

## Data Flow

### Forward Path (Capture → Viewer)

1. Page DOM mutates → `MutationObserver` accumulates records (`dom-stream.js:~784`)
2. `requestAnimationFrame` fires → `flushMutations()` → `processMutationBatch()`
3. `chrome.runtime.sendMessage({ action: 'domStreamMutations', ... })` to SW
4. Background switch case → `fsbWebSocket.send('ext:dom-mutations', ...)` (`background.dom-stream-relay.excerpt.js:34`)
5. `FSBWebSocket.send()` — LZ-compress if > 1 KB → `ws.send(JSON)` to relay (`ws-client.js:~910`)
6. Relay `relayToRoom()` → `sendToClients()` → raw bytes forwarded to all dashboards (`ws-handler.js:321`)
7. Dashboard `ws.onmessage` → LZ-decompress if `_lz` envelope → `handleDOMMutations()` (`dashboard.js:~3209`)
8. `doc.querySelector('[data-fsb-nid="…"]')` → apply `add`/`rm`/`attr`/`text` op

### Session Start Path

1. Dashboard sends `dash:dom-stream-start` → relay → extension SW
2. `_handleDashboardStreamStart()` resolves stream candidate tab (`_resolveStreamCandidate`)
3. Injects content scripts via `chrome.scripting.executeScript`
4. Polls `pingDomStream` every 200 ms until `{ ready: true }` (5 s budget)
5. Forwards `domStreamStart` to content script → `dom-stream.js` `domStreamStart` case
6. `beginStreamSession()` → `serializeDOM()` → `chrome.runtime.sendMessage({ action: 'domStreamSnapshot' })`
7. Background → `fsbWebSocket.send('ext:dom-snapshot', ...)` → relay → dashboard
8. `handleDOMSnapshot()` rebuilds full HTML document → `previewIframe.srcdoc`

### Recovery Path (Watchdog)

1. SW watchdog alarm fires (`fsb-domstream-watchdog`) OR content-script watchdog force-flushes
2. `fsbWebSocket.send('ext:request-snapshot', { reason: 'sw-watchdog-tick' })` → relay → dashboard
3. Dashboard `requestPreviewResync()` → re-issues `dash:dom-stream-start`

## Key Abstractions

**Node Identity (`data-fsb-nid`):**
- Attribute stamped on every captured element by `assignNodeId()` in the content script
- Applied to both the live DOM element and the serialized clone in parallel
- Every diff op, overlay rect coordinate, and remote-control action addresses nodes by nid
- `NID_ATTR = 'data-fsb-nid'` in `src/protocol/messages.js`
- Known limitation: visible to the page's own selectors/observers (WeakMap scheme deferred)

**LZ Compression Envelope:**
- Self-identifying: `{ _lz: true, d: "<base64>" }` — receivers detect by shape
- Stateless per-frame (no sliding window) — bad frame cannot corrupt subsequent frames
- Threshold: > 1 KB in the extension SW; threshold configurable in `encodeEnvelope()`
- ~90%+ reduction on 100 KB+ snapshots
- `src/protocol/envelope.js` is the canonical implementation

**Stream Session Identity:**
- `streamSessionId = 'stream_<ts36>_<rand>'` minted per session by `beginStreamSession()`
- `snapshotId = Date.now()` minted per snapshot
- Both stamped on every message type
- `isCurrentStream(msg, active)` in `src/protocol/messages.js` is the staleness guard
- Viewer rejects messages with mismatched identity — prevents late diffs from prior page
  corrupting the mirror

**Room-Keyed Fan-out:**
- Each `hashKey` (QR-pair secret) identifies a room with one `extensions` Set and one
  `dashboards` Set
- Messages relay verbatim (raw bytes forwarded, no deserialization at relay layer)
- Multi-viewer fan-out is architecturally free — dashboards is a Set, not a single ref

## Entry Points

**Capture start** (`reference/extension/dom-stream.js` — `chrome.runtime.onMessage`, `domStreamStart` case):
- Invoked by `_handleDashboardStreamStart` → `_forwardToContentScript('domStreamStart')`
- Triggers: `beginStreamSession`, `serializeDOM`, `startMutationStream`, `startScrollTracker`

**Module load auto-start** (`reference/extension/dom-stream.js` line 1109):
- On load, sends `domStreamReady` to background
- Background re-arms any `_pendingStreamStart` payload parked during the readiness probe

**WS connect** (`reference/extension/ws-client.js` `FSBWebSocket.connect()`):
- Triggered by background.js initialization
- Auto-registers with server if no `serverHashKey` in `chrome.storage.local`

**Relay server** (`reference/server/ws-handler.js` `setupWSHandler(wss)`):
- Called after upgrade authentication in server.js
- Parameters `{ hashKey, role }` set by server-side auth before connection reaches handler

**Protocol module** (`src/protocol/index.js`):
- ESM entry point for the standalone framework
- Exported at `package.json` `"./protocol"` path

## Architectural Constraints

- **Threading:** Single-threaded event loop at each stage. Content script runs in the tab
  renderer process; service worker runs in a separate Chrome background process; relay runs
  in a Node.js single-thread process; dashboard runs in the viewer browser tab.
- **MV3 constraints:** Service worker can be evicted at any time; all persistent state is
  in `chrome.storage.local` or `chrome.alarms` (the watchdog). No long-lived background
  page.
- **Compression:** LZ-string is stateless per-frame by design. Do NOT replace with
  permessage-deflate (RFC 7692) — sliding-window corruption on any bad frame requires
  full WebSocket reconnect.
- **Size cap:** `RELAY_PER_MESSAGE_LIMIT_BYTES = 1048576` (1 MiB) is a protocol constant
  shared between capture (truncation budget at 80%) and relay (hard drop). Both must stay
  in sync — `src/protocol/constants.js` is the single source of truth for the framework.
- **Global state in reference:** `dom-stream.js` uses IIFE module scope; `ws-client.js`
  uses `globalThis.__fsbWsInstance` to expose the active WebSocket for bare-function handlers.
- **nid stamping mutates the observed page:** `data-fsb-nid` is visible to page selectors;
  known limitation, WeakMap scheme deferred to future work.

## Anti-Patterns

### Computed styles on added nodes

**What happens:** `processAddedNode` in `reference/extension/dom-stream.js` (line 620)
assigns nids and absolutifies URLs but does not capture computed styles for elements added
after the initial snapshot.

**Why it's wrong:** Post-snapshot nodes render inconsistently with snapshot-era siblings
because their styles depend entirely on cascaded stylesheets rather than the inlined
computed values that snapshot-era elements carry.

**Do this instead:** Apply the same `captureComputedStyles` pass that `serializeDOM` does,
either inline in `processAddedNode` or via a utility function. Tracked in
`reference/planning/` and `docs/ARCHITECTURE.md §6 gap #2`.

### `on*` attribute sanitization gap

**What happens:** `serializeShellAttributes` in `reference/extension/dom-stream.js`
strips `on*` attributes from `<html>` and `<body>` shells, but the main element pass
and `processAddedNode` do not strip them.

**Why it's wrong:** The viewer iframe receives elements with live event-handler attributes;
if the sandbox grants `allow-scripts`, these could execute.

**Do this instead:** Sanitize `on*` attributes and `javascript:` href values in all
serialization paths. The sandbox `allow-scripts` must be absent regardless. See
`src/renderer/README.md` hard requirements and `docs/ARCHITECTURE.md §6 gap #5`.

## Error Handling

**Strategy:** Fail-silent with telemetry. Every `chrome.runtime.sendMessage` call has a
`.catch()` handler that calls `rateLimitedWarn`; every CDP dispatch is wrapped in
try/catch; every relay send guards on `ws.readyState === OPEN`.

**Patterns:**
- Content script: catch blocks around all `chrome.*` APIs; extension context invalidation
  is a normal failure mode during SW eviction.
- WS client: `recordFSBTransportFailure` accumulates a bounded ring buffer of failures
  surfaced in the diagnostics object at `globalThis.__FSBTransportDiagnostics`.
- Relay server: per-room diagnostic ring buffer (100 events) at `roomDiagnostics`; errors
  during `client.send()` increment `droppedCount` but do not throw.
- Dashboard: `recordDashboardTransportEvent` / `recordDashboardTransportError` ring buffer;
  `staleMutationCount >= 3` triggers automatic resync (`requestPreviewResync`).

## Cross-Cutting Concerns

**Logging:** `FSB.logger` (FSB namespace in content script); `console.log/warn` prefixed
with `[FSB WS]`, `[FSB RC]`, `[FSB NAV]`, `[WS]` in service worker and relay.

**Validation:** Payload validation at remote-control handlers (guard on `_remoteControlActive`,
`Number.isFinite` checks on coordinates). Relay validates JSON parse, rejects pings
without relaying.

**Session identity / staleness:** `isCurrentStream()` in `src/protocol/messages.js`.
Applied at the viewer (`shouldAcceptPreviewMessage` in `dashboard.js`) and should be applied
at the relay in the standalone version.

---

*Architecture analysis: 2026-06-09*
