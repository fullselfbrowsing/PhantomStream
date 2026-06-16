---
phase: 04-relay-ws-transport-two-tab-demo
plan: 03
subsystem: renderer
tags: [renderer, viewer-events, lifecycle, health, telemetry]

# Dependency graph
requires:
  - phase: 04-relay-ws-transport-two-tab-demo
    provides: WebSocket transport status and health telemetry from 04-02
provides:
  - Viewer handle event API with `viewer.on('state'|'health')`
  - Public lifecycle states `connecting`, `live`, `stale`, and `disconnected`
  - Privacy-bounded health snapshots with counters, timestamps, sanitizer counters, and transport diagnostics
affects: [04-04-two-tab-demo, renderer, transport, demo]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Host-facing viewer event emitter with immediate delivery and unsubscribe
    - Content-free health snapshot assembled from whitelisted counters and transport fields
    - Optional transport.onStatus integration with stale-to-disconnected mapping

key-files:
  created:
    - tests/renderer-health-events.test.js
  modified:
    - src/renderer/index.js
    - src/renderer/README.md
    - tests/renderer-viewer.test.js

key-decisions:
  - "Viewer lifecycle and health events stay library events only; visible UI chrome remains host/demo-owned."
  - "Health snapshots whitelist counters, timestamps, sanitizer counters, and transport diagnostics instead of copying payload or status objects wholesale."

patterns-established:
  - "`viewer.on('state'|'health', handler)` immediately delivers the current event snapshot and returns an unsubscribe function."
  - "Transport status `closed` maps to `stale` immediately and `disconnected` after `disconnectDelayMs` while preserving the last rendered frame."
  - "Health telemetry exposes type counters and timestamps only; privacy tests reject `html`, `text`, `payload`, `url`, and `title` keys."

requirements-completed: [VIEW-02]

# Metrics
duration: 9 min
completed: 2026-06-15
---

# Phase 04 Plan 03: Viewer State and Health Events Summary

**Viewer host event API with lifecycle state transitions and privacy-bounded stream health telemetry for the two-tab demo**

## Performance

- **Duration:** 9 min
- **Started:** 2026-06-15T05:45:57Z
- **Completed:** 2026-06-15T05:55:26Z
- **Tasks:** 2 completed
- **Files modified:** 4

## Accomplishments

- Added `viewer.on('state', handler)` with immediate `connecting`, `live` on accepted frames, `stale` on resync/transport trouble, and delayed `disconnected` for closed transports.
- Added `viewer.on('health', handler)` with received/sent type counters, frame timestamps, stale/apply counters, sanitizer counters, resync latch state, and whitelisted transport telemetry.
- Updated renderer docs and exact handle-shape tests so the public handle is intentionally `{ detach, destroy, registerOverlay, on }`.

## Task Commits

Each task used RED/GREEN TDD commits:

1. **Task 1 RED: Viewer state event tests and handle-shape update** - `aa82edc` (test)
2. **Task 1 GREEN: Viewer state events and transport status mapping** - `be4ab3f` (feat)
3. **Task 2 RED: Viewer health telemetry and privacy tests** - `0a63ece` (test)
4. **Task 2 GREEN: Health telemetry implementation and renderer docs** - `7fcf1dc` (feat)

**Plan metadata:** recorded in the final docs commit for this plan.

## Files Created/Modified

- `tests/renderer-health-events.test.js` - Covers lifecycle events, transport status mapping, health counters, privacy assertions, and unsubscribe behavior.
- `tests/renderer-viewer.test.js` - Updates the pinned viewer handle shape to include `on`.
- `src/renderer/index.js` - Adds state/health event emitters, transport status subscription cleanup, lifecycle mapping, and whitelisted health snapshots.
- `src/renderer/README.md` - Documents `viewer.on('state'|'health')`, unsubscribe semantics, event names, health fields, and the telemetry privacy boundary.

## Decisions Made

- Viewer events remain a host-facing library surface only; the renderer still adds no badges, banners, or visible product chrome.
- Health telemetry is assembled from explicit safe fields instead of copying raw payloads or arbitrary transport status objects.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None. The expected RED checks failed before implementation because `viewer.on('health')` was not yet supported, then passed after the GREEN implementation.

## Known Stubs

None. Stub scan found only existing comments mentioning the host waiting placeholder and intentional empty counters/lists used for event listeners, telemetry maps, and tests.

## Verification

- `node --test tests/renderer-health-events.test.js tests/renderer-viewer.test.js -x` - PASS, 28/28 tests.
- `npm test` - PASS, 241/241 tests.
- `grep -c "on: on" src/renderer/index.js` - PASS, returned `1`.
- `grep -c "connecting\\|live\\|stale\\|disconnected" tests/renderer-health-events.test.js` - PASS, returned `14`.
- `grep -c "viewer.on('state'\\|viewer.on('health'" src/renderer/README.md` - PASS, returned `2`.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Ready for 04-04. The two-tab demo can subscribe to `state` and `health` to render its own compact connection/health UI and can observe relay shutdown as `live -> stale -> disconnected` without viewer-owned chrome.

## Self-Check: PASSED

- Found created/modified key files: `tests/renderer-health-events.test.js`, `src/renderer/index.js`, `src/renderer/README.md`, `tests/renderer-viewer.test.js`, and this summary.
- Found task commits in git history: `aa82edc`, `be4ab3f`, `0a63ece`, `7fcf1dc`.
- Verified `.planning/config.json` remains unstaged and unmodified by this executor.

---
*Phase: 04-relay-ws-transport-two-tab-demo*
*Completed: 2026-06-15*
