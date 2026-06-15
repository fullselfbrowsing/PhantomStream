---
phase: 04-relay-ws-transport-two-tab-demo
plan: 04
subsystem: demo
tags: [cli, demo, websocket, relay, viewer-health, fsb-checkpoint]

# Dependency graph
requires:
  - phase: 04-relay-ws-transport-two-tab-demo
    provides: relay core and ws backend from 04-01
  - phase: 04-relay-ws-transport-two-tab-demo
    provides: browser WebSocket transport from 04-02
  - phase: 04-relay-ws-transport-two-tab-demo
    provides: viewer lifecycle and health events from 04-03
provides:
  - Local-only `phantom-stream demo` CLI with deterministic source/viewer URL output
  - Two-tab source/viewer demo pages wired through the bundled relay
  - Compact viewer lifecycle and content-free health UI driven by `viewer.on('state'|'health')`
  - FSB-verified live mutation mirror, dialog path, and relay-stop lifecycle retention
affects: [phase-05, packaging, demo, relay, transport, viewer-health]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Local-only HTTP/static demo server with bundled WebSocket relay backend
    - Cache-busted browser module URLs plus no-store static responses for iterative demo verification
    - FSB browser checkpoint with timestamped lifecycle event recording

key-files:
  created:
    - bin/phantom-stream.js
    - examples/two-tab-demo/server.js
    - examples/two-tab-demo/source.html
    - examples/two-tab-demo/viewer.html
    - examples/two-tab-demo/demo.css
    - examples/two-tab-demo/source.js
    - examples/two-tab-demo/viewer.js
    - tests/demo-cli.test.js
  modified:
    - package.json
    - package-lock.json
    - src/transport/websocket.js
    - tests/websocket-transport.test.js

key-decisions:
  - "The demo binds only to 127.0.0.1, prints generated room URLs, and keeps the relay raw/stateless."
  - "Mirrored content in the demo only flows through `createCapture`, `createWebSocketTransport`, and `createViewer`; the demo does not manually render mirrored HTML."
  - "Viewer health UI exposes counters/timestamps only and keeps mirrored page text inside the sandboxed mirror frame."
  - "Demo static assets are served with `cache-control: no-store` and module query versions so browser checkpoints exercise current code."

patterns-established:
  - "`startDemoServer()` returns source/viewer URLs, room metadata, server, relay/backend handles, and a clean `close()` helper."
  - "`phantom-stream demo --no-open` is deterministic for automation and prints the same URL shape used by browser verification."
  - "Browser relay-stop validation records viewer state event timestamps when tool latency can miss a short visual stale interval."

requirements-completed: [PKG-01, VIEW-02]

# Metrics
duration: 70 min
completed: 2026-06-15
---

# Phase 04 Plan 04: Two-Tab CLI Demo Summary

**Local-only CLI demo proving source tab -> relay -> viewer tab mirroring with lifecycle and health UI in a real browser**

## Performance

- **Duration:** 70 min
- **Completed:** 2026-06-15T06:34:29Z
- **Tasks:** 3 completed
- **Files modified:** 12

## Accomplishments

- Added `bin/phantom-stream.js demo` and package metadata for the `phantom-stream` binary.
- Added `startDemoServer()` with strict 127.0.0.1 binding, generated room keys, safe static serving, `/ws` relay backend wiring, and clean shutdown.
- Added source and viewer demo pages with the required controls, status strip, health row, responsive mirror stage, WebSocket transport wiring, and viewer lifecycle/health subscriptions.
- Completed FSB browser verification for live mirroring, source mutations, dialog handling, health counters, and relay shutdown retaining the last frame.

## Task Commits

1. **Task 1 RED: Demo CLI/server tests** - `ffa0ea2` (test)
2. **Task 1 GREEN: CLI and local relay server** - `58977d3` (feat)
3. **Task 2 RED: Two-tab smoke/static tests** - `3781618` (test)
4. **Task 2 GREEN: Source/viewer demo pages** - `8db2f90` (feat)
5. **Browser fix: Native compression stream draining** - `38991bb` (fix)
6. **Browser fix: MessageEvent data getter decode** - `92b9c55` (fix)
7. **Browser fix: Observable demo stale state** - `d45b939` (fix)
8. **Browser fix: Demo asset refresh hardening** - `efe3b64` (fix)

## Files Created/Modified

- `bin/phantom-stream.js` - ESM package binary with `demo`, `--port`, `--no-open`, help, and deterministic URL output.
- `examples/two-tab-demo/server.js` - Local-only HTTP/static server plus bundled relay backend and `startDemoServer()`.
- `examples/two-tab-demo/source.html` / `source.js` - Capture-side tab shell, controls, auto-mutate loop, dialog trigger, and WebSocket capture wiring.
- `examples/two-tab-demo/viewer.html` / `viewer.js` - Viewer shell, mirror stage, lifecycle badge, health counters, and `createViewer` event wiring.
- `examples/two-tab-demo/demo.css` - UI contract styles, fixed mirror aspect ratio, status colors, and responsive dimensions.
- `tests/demo-cli.test.js` - CLI, static safety, page shell, CSS contract, and browser module wiring coverage.
- `src/transport/websocket.js` / `tests/websocket-transport.test.js` - Browser checkpoint fixes for native stream draining and browser `MessageEvent.data` decoding.
- `package.json` / `package-lock.json` - Binary and demo script metadata.

## Decisions Made

- Kept the demo as a usable tool surface rather than a landing page.
- Served static files from the repo root with decode-before-resolve traversal checks and no directory listings.
- Used `viewer.js?v=04-demo` and `source.js?v=04-demo` plus no-store headers because FSB verification exposed stale browser module caching during iterative fixes.
- Used timestamped viewer state events for the relay-stop checkpoint because FSB command latency can arrive after the short visual stale interval.

## Deviations from Plan

### Auto-fixed Issues

**1. Native `CompressionStream('deflate-raw')` could deadlock on large snapshots**
- **Found during:** FSB live mirror checkpoint.
- **Issue:** The browser source queued the first compressed snapshot and never delivered it because the native stream readable side was not drained concurrently.
- **Fix:** Added `readAllBytes()` and concurrent readable draining for native compression/decompression.
- **Verification:** `node --test tests/websocket-transport.test.js tests/protocol.test.js -x`; later `npm test` full suite.
- **Committed in:** `38991bb`

**2. Browser `MessageEvent.data` was not decoded**
- **Found during:** FSB live mirror checkpoint after relay frames were proven valid with a Node sampler.
- **Issue:** The transport used `hasOwnProperty('data')`; browser `MessageEvent.data` is an inherited getter, so the decoder saw `[object MessageEvent]`.
- **Fix:** Switched message normalization to `'data' in event` and added a regression test.
- **Verification:** `node --test tests/websocket-transport.test.js tests/protocol.test.js -x`; later `npm test` full suite.
- **Committed in:** `92b9c55`

**3. Demo stale state was hard to observe with browser-tool latency**
- **Found during:** FSB relay-stop checkpoint.
- **Issue:** The library default stale window was short enough that FSB often observed only the final disconnected state.
- **Fix:** Set the demo viewer `disconnectDelayMs` to 4000 ms, then used a state-event recorder to capture exact transitions.
- **Verification:** Renderer health/viewer tests and FSB timestamped event log.
- **Committed in:** `d45b939`, `efe3b64`

**Total deviations:** 3 auto-fixed.

## Issues Encountered

None unresolved. The final FSB lifecycle evidence showed `live -> stale -> disconnected` with the last frame retained.

## Known Stubs

None.

## Verification

- `node --test tests/demo-cli.test.js -x` - PASS, 8/8 tests.
- `node --test tests/renderer-health-events.test.js tests/renderer-viewer.test.js -x` - PASS, 28/28 tests.
- `npm test` - PASS, 251/251 tests.
- FSB browser checkpoint, Google Chrome:
  - Room `0881e7e3...`: viewer opened first, source opened second, viewer reached `Live`, relay `open`, snapshots/mutations advanced, and errors stayed `0`.
  - Source `Add row`, `Remove row`, and `Edit text` reflected in the viewer mirror.
  - `Show dialog` recorded the dialog open/closed path while the viewer stayed usable.
  - Room `59b3f5ce...`: viewer loaded `viewer.js?v=04-demo`, reached `Live`, relay `open`, frames `5`, snapshots `1`, mutations `2`, errors `0`.
  - After stopping the relay, the recorded viewer state events were `live` at `0 ms`, `stale` at `3408 ms`, and `disconnected` at `8397 ms`; the iframe still contained the last source rows and errors stayed `0`.

## User Setup Required

None - run `node bin/phantom-stream.js demo --no-open` or `npm run demo` locally.

## Next Phase Readiness

Ready for Phase 05. PKG-01 now has a local end-to-end networked demo surface, and VIEW-02 is observable through the viewer lifecycle/health UI in a real browser.

## Self-Check: PASSED

- Found all created key files and final summary.
- Found task/fix commits in git history: `ffa0ea2`, `58977d3`, `3781618`, `8db2f90`, `38991bb`, `92b9c55`, `d45b939`, `efe3b64`.
- Verified final full suite: `npm test` PASS, 251/251 tests.

---
*Phase: 04-relay-ws-transport-two-tab-demo*
*Completed: 2026-06-15*
