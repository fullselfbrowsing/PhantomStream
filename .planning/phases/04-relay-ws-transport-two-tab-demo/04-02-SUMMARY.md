---
phase: 04-relay-ws-transport-two-tab-demo
plan: 02
subsystem: transport
tags: [websocket, compression, deflate-raw, lz, fifo, health]

# Dependency graph
requires:
  - phase: 04-relay-ws-transport-two-tab-demo
    provides: relay core and ws backend from 04-01
provides:
  - Browser WebSocket transport for capture and viewer fire-and-forget contracts
  - Native deflate-raw endpoint envelope with plain JSON fallback
  - Legacy FSB `_lz` decode compatibility through injected LZ codec
  - FIFO send queue, deterministic flush, receive fan-out, and status/health telemetry
affects: [04-03-viewer-health-events, 04-04-two-tab-demo, transport, relay]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Endpoint-owned native deflate-raw envelopes with legacy LZ decode compatibility
    - Promise-tail FIFO queues for async encode/send and receive/decode ordering
    - Content-free health/status snapshots for transport observability

key-files:
  created:
    - src/transport/websocket.js
    - tests/websocket-transport.test.js
  modified:
    - package.json

key-decisions:
  - "Native endpoint compression uses `{ _ps: 'deflate-raw', d }`, while legacy `{ _lz, d }` remains decode-only through an injected LZ codec."
  - "WebSocket transport send and receive paths both serialize async codec work through per-connection promise queues."
  - "Transport health/status telemetry exposes counters, timestamps, drops, and error codes only; mirrored payload content is omitted."

patterns-established:
  - "`./transport/websocket` package subpath exports `createWebSocketTransport`, `encodeWireMessage`, and `decodeWireMessage`."
  - "`send(type, payload)` stays fire-and-forget; `flush()` is the deterministic drain point."
  - "`onMessage` and `onStatus` both return unsubscribe functions and contain handler failures."

requirements-completed: [RELY-02]

# Metrics
duration: 8 min
completed: 2026-06-15
---

# Phase 04 Plan 02: Endpoint WebSocket Transport Summary

**Endpoint WebSocket transport with native deflate-raw envelopes, legacy LZ decode, FIFO async sends, ordered receives, and content-free health/status telemetry**

## Performance

- **Duration:** 8 min
- **Started:** 2026-06-15T05:31:46Z
- **Completed:** 2026-06-15T05:40:14Z
- **Tasks:** 2 completed
- **Files modified:** 3

## Accomplishments

- Added `src/transport/websocket.js` with `encodeWireMessage`, `decodeWireMessage`, and `createWebSocketTransport`.
- Added backward-compatible decode for plain JSON, legacy FSB `{ _lz, d }`, and native `{ _ps: 'deflate-raw', d }` envelopes.
- Added send FIFO, `flush()` drain semantics, receive fan-out, status subscriptions, and health counters that omit mirrored page content.

## Task Commits

Each task was committed atomically, with TDD RED/GREEN commits:

1. **Task 1 RED: Codec seam and backward-compatible decode tests** - `882060f` (test)
2. **Task 1 GREEN: Codec helpers and package export** - `e47b8db` (feat)
3. **Task 2 RED: WebSocket transport behavior tests** - `8245239` (test)
4. **Task 2 GREEN: WebSocket transport queue/status/health implementation** - `a0ca113` (feat)

**Plan metadata:** recorded in the final docs commit for this plan.

## Files Created/Modified

- `src/transport/websocket.js` - Browser-compatible WebSocket transport, native deflate codec seam, legacy LZ-compatible decode, FIFO queues, status events, and health snapshots.
- `tests/websocket-transport.test.js` - RELY-02 codec, decode, FIFO, flush, receive fan-out, lifecycle status, and content-free health coverage.
- `package.json` - Adds the `./transport/websocket` subpath export while preserving existing exports.

## Decisions Made

- Native deflate is endpoint-owned and self-identifying through `_ps: "deflate-raw"` so the relay can keep raw fan-out.
- Legacy `_lz` remains decode-only in this transport layer to preserve FSB interoperability without adding an LZ runtime dependency.
- Health/status objects intentionally carry only counters, timestamps, buffered amount, drops, and error codes.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Queued receive-side async decode to preserve inbound order**
- **Found during:** Task 2 (WebSocket transport FIFO, flush, receive, and status events)
- **Issue:** The first implementation decoded inbound WebSocket messages independently. A later legacy/plain frame could fan out before an earlier native deflate frame whose async decode had not finished.
- **Fix:** Added a receive-side promise queue mirroring the send FIFO so inbound frames decode and fan out in socket arrival order.
- **Files modified:** `src/transport/websocket.js`
- **Verification:** `node --test tests/websocket-transport.test.js -x`; full plan-level verification also passed.
- **Committed in:** `a0ca113`

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** The fix strengthens RELY-02 ordering guarantees without changing the public transport contract.

## Issues Encountered

None unresolved. Expected RED checks failed before implementation; the Task 2 receive-order bug was fixed before the GREEN commit.

## Known Stubs

None. Stub scan found only intentional empty local collections used for counters, handlers, and test recorders.

## Verification

- `node --test tests/websocket-transport.test.js tests/protocol.test.js -x` - PASS, 22/22 tests.
- `node --test tests/websocket-transport.test.js -x && npm test` - PASS, transport 14/14 tests and full suite 232/232 tests.
- Acceptance greps - PASS: `_ps`/`deflate-raw` and `_lz` present in implementation/tests, `perMessageDeflate` absent, package subpath export present, `createWebSocketTransport` exported, and health tests JSON-stringify payloads to assert content keys are omitted.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Ready for 04-03. The viewer can consume `transport.onStatus()` and `getHealth()` to build host-facing lifecycle and health events without changing capture/viewer fire-and-forget send call sites.

## Self-Check: PASSED

- Found created key files: `src/transport/websocket.js`, `tests/websocket-transport.test.js`, and this summary.
- Found task commits in git history: `882060f`, `e47b8db`, `8245239`, `a0ca113`.
- Verified `.planning/config.json` remains unstaged and unmodified by this executor.

---
*Phase: 04-relay-ws-transport-two-tab-demo*
*Completed: 2026-06-15*
