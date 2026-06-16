---
phase: 04-relay-ws-transport-two-tab-demo
plan: 01
subsystem: relay
tags: [relay, websocket, ws, diagnostics, backpressure]

# Dependency graph
requires:
  - phase: 03-security-pipeline
    provides: capture/render security gate required before networked mirroring
provides:
  - Transport-agnostic room relay with source/viewer raw opposite-side fan-out
  - Relay byte-cap classification and structured oversize diagnostics
  - Per-client backpressure drop defense with bounded in-memory diagnostics
  - Self-hostable ws reference backend with admission validation and disabled permessage-deflate
affects: [04-02-websocket-transport, 04-04-two-tab-demo, relay, transport]

# Tech tracking
tech-stack:
  added: [ws@8.21.0]
  patterns:
    - Transport-agnostic relay core with backend adapters
    - Raw frame fan-out with endpoint-owned compression/decompression
    - Bounded in-memory relay diagnostics

key-files:
  created:
    - src/relay/limits.js
    - src/relay/relay.js
    - src/relay/backends/ws.js
    - tests/relay-core.test.js
    - tests/relay-ws-backend.test.js
  modified:
    - package.json
    - package-lock.json
    - src/relay/index.js

key-decisions:
  - "Relay fan-out remains raw and transport-agnostic; payload transform/compression stays at endpoints."
  - "The ws backend validates path, room, and role before room attachment and disables permessage-deflate."
  - "Oversize and backpressure failures stay in bounded in-memory diagnostics for this phase."

patterns-established:
  - "Relay core API: addClient/removeClient/receive/getDiagnostics/getRoomSnapshot/clear."
  - "Backend seam: adapters pass raw strings to relay.receive and keep routing/cap decisions out of socket code."

requirements-completed: [RELY-01]

# Metrics
duration: 7 min
completed: 2026-06-15
---

# Phase 04 Plan 01: Relay Core, ws Backend, Package Dependency, and Relay Safety Tests Summary

**Transport-agnostic room relay with ws reference backend enforcing raw fan-out, 1 MiB cap diagnostics, and per-client backpressure drops**

## Performance

- **Duration:** 7 min
- **Started:** 2026-06-15T05:18:15Z
- **Completed:** 2026-06-15T05:26:10Z
- **Tasks:** 2 completed
- **Files modified:** 8

## Accomplishments

- Added `createRelay()` with source/viewer room joins, raw opposite-side fan-out, same-side isolation, room cleanup, and bounded diagnostics.
- Added relay frame classification and byte-cap checks using `RELAY_PER_MESSAGE_LIMIT_BYTES`, including legacy `_lz` and native `_ps: "deflate-raw"` envelope detection without decompression.
- Installed exact `ws@8.21.0` and added `createWebSocketRelayBackend()` with `/ws` admission validation, local ping/pong handling, `perMessageDeflate: false`, and max payload aligned just above the relay cap.

## Task Commits

Each task was committed atomically:

1. **Task 1: Relay core, limits, diagnostics, and routing tests** - `627a52e` (feat)
2. **Task 2: ws backend admission, package dependency, and exports** - `4661f8b` (feat)

**Plan metadata:** recorded in the final docs commit for this plan.

## Files Created/Modified

- `src/relay/limits.js` - Classifies raw relay frames and checks byte size against the protocol cap.
- `src/relay/relay.js` - Provides the transport-agnostic relay core, diagnostics, and backpressure handling.
- `src/relay/backends/ws.js` - Provides the `ws` backend adapter bound to a Node HTTP server.
- `src/relay/index.js` - Re-exports limits, relay core, and ws backend.
- `tests/relay-core.test.js` - Covers RELY-01 core routing, cap diagnostics, backpressure, malformed frames, compressed envelope classification, and room cleanup.
- `tests/relay-ws-backend.test.js` - Covers backend admission, real WebSocket raw relay, same-role isolation, ping/pong, oversize diagnostics, and `perMessageDeflate: false`.
- `package.json` - Adds `ws@8.21.0` and the `./relay` package export while preserving existing exports.
- `package-lock.json` - Locks the exact `ws@8.21.0` runtime dependency.

## Decisions Made

- Relay frame payloads are never decoded, decompressed, rewritten, or buffered by the relay; only lightweight JSON classification is used for diagnostics.
- Invalid WebSocket clients are closed with policy violation before relay room attachment, while non-`/ws` paths are rejected by the `ws` server path gate.
- The backend sets `maxPayload` to `RELAY_PER_MESSAGE_LIMIT_BYTES + 1024` so the relay core, not `ws`, records oversize diagnostics for frames just over the protocol cap.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None. The expected RED checks failed before implementation because the relay modules and `ws` dependency did not exist yet, then passed after implementation.

## Known Stubs

None. Stub scan found only intentional empty collections/default option objects in tests and relay internals.

## Verification

- `node --test tests/relay-core.test.js -x` - PASS, 7/7 tests.
- `node --test tests/relay-ws-backend.test.js tests/relay-core.test.js -x` - PASS, 13/13 tests.
- `npm test` - PASS, 218/218 tests.
- `npm ls ws --depth=0` - PASS, `ws@8.21.0`.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Ready for 04-02. The relay core and backend seam are available through `./relay`, so the endpoint WebSocket transport can connect source/viewer clients without adding routing or compression behavior to the relay.

## Self-Check: PASSED

- Found all created key files: relay limits/core/backend, relay core test, backend test, and this summary.
- Found task commits in git history: `627a52e`, `4661f8b`.

---
*Phase: 04-relay-ws-transport-two-tab-demo*
*Completed: 2026-06-15*
