---
phase: 08-shadow-dom-iframes-fidelity-completion
plan: 03
subsystem: testing
tags: [node-test, jsdom, playwright, shadow-dom, iframes, subtree-fetch]

requires:
  - phase: 07-weakmap-node-identity-semantic-addressing-api
    provides: WeakMap capture identity, nodeIds sidecars, and renderer private nid index
provides:
  - RED capture and renderer tests for bounded on-demand subtree recovery
  - RED browser-backed Chromium smoke for shadow slots, iframe origin policy, and real form events
affects: [phase-08, CAPT-11, CAPT-08, CAPT-09, CAPT-05]

tech-stack:
  added: []
  patterns:
    - node:test jsdom RED fixtures for planned request/response contracts
    - Playwright headless Chromium smoke through the checked-in inject artifact

key-files:
  created:
    - tests/capture-subtree-fetch.test.js
    - tests/renderer-subtree-fetch.test.js
    - tests/playwright-fidelity-phase8.test.js
  modified: []

key-decisions:
  - "Subtree RED coverage pins CONTROL.SUBTREE_REQUEST and STREAM.SUBTREE_RESPONSE to the planned wire names before implementation."
  - "The browser smoke exercises src/adapters/playwright-inject.js in real Chromium rather than relying on jsdom for shadow, iframe, and input/change fidelity."

patterns-established:
  - "RED subtree tests assert constants and public APIs first, then pin sanitizer, staleness, latching, and nodeIds behavior for later implementation plans."
  - "Browser smoke captures real platform behavior through the checked-in inject artifact and validates future Phase 8 sidecars/value frames from wire messages."

requirements-completed: [CAPT-11, CAPT-08, CAPT-09, CAPT-05]

duration: 6min
completed: 2026-06-15
---

# Phase 08 Plan 03: RED Subtree Fetch and Playwright Fidelity Summary

**RED coverage for targeted subtree recovery plus real Chromium smoke for shadow slots, iframe policy, and live form value drift**

## Performance

- **Duration:** 6 min
- **Started:** 2026-06-15T18:40:23Z
- **Completed:** 2026-06-15T18:46:40Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- Added capture-side RED tests for `CONTROL.SUBTREE_REQUEST` handling, sanitized `STREAM.SUBTREE_RESPONSE` payloads, current identity, and content-free stale/gone/skipped/blocked misses.
- Added renderer-side RED tests for `viewer.requestSubtree(nid)` request latching, current response installation, stale response ignoring, sanitizer-before-import behavior, and `nodeIds` indexing.
- Added a headless Chromium RED smoke that exercises the checked-in Playwright inject artifact for real open shadow slots, same-origin/inaccessible iframe behavior, and actual `input`/`change` events.

## Task Commits

Each task was committed atomically:

1. **Task 1: Add RED subtree fetch capture and renderer tests** - `766457c` (test)
2. **Task 2: Add RED Playwright fidelity smoke for Phase 8** - `55123e5` (test)

Plan metadata is committed separately with this summary.

## Files Created/Modified

- `tests/capture-subtree-fetch.test.js` - RED capture coverage for planned subtree request handling, sanitized response payloads, staleness, and miss statuses.
- `tests/renderer-subtree-fetch.test.js` - RED renderer coverage for request latching, placeholder replacement, stale response latch clearing, and response-side identity indexing.
- `tests/playwright-fidelity-phase8.test.js` - RED browser smoke using Playwright-managed Chromium and the checked-in inject artifact.

## Decisions Made

- Used the planned `CONTROL.SUBTREE_REQUEST` / `STREAM.SUBTREE_RESPONSE` names exactly so protocol implementation in 08-04/08-07 has a concrete failing contract.
- Kept the browser smoke wire-level and artifact-backed. The current repo has a checked-in capture inject artifact but no checked-in browser viewer bundle, so the smoke validates real browser capture surfaces now and leaves final render pass-through to later implementation plans.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None. The failures observed are the intended RED failures:

- Subtree tests fail because `CONTROL.SUBTREE_REQUEST`, `STREAM.SUBTREE_RESPONSE`, `capture.handleControl`, and `viewer.requestSubtree` are not implemented yet.
- Playwright smoke fails because current snapshots do not carry `shadowRoots` or `frames`, and Chromium `input`/`change` events do not emit value frames yet.

## Verification

- `set +e; node --test tests/capture-subtree-fetch.test.js tests/renderer-subtree-fetch.test.js; code=$?; test "$code" -ne 0` - PASS, command returned 0 because the focused tests fail against missing planned subtree behavior.
- `set +e; node --test tests/playwright-fidelity-phase8.test.js; code=$?; test "$code" -ne 0` - PASS, command returned 0 because the browser smoke fails against missing Phase 8 fidelity behavior.
- `rg -n "SUBTREE_REQUEST|SUBTREE_RESPONSE|requestSubtree|requestId|data-phantomstream-truncated|status" tests/capture-subtree-fetch.test.js tests/renderer-subtree-fetch.test.js` - PASS.
- `rg -n "chromium|attachShadow|iframe|input|change|select|checkbox|radio" tests/playwright-fidelity-phase8.test.js` - PASS.

## Known Stubs

None. The `placeholder` strings found by the stub scan are intentional test fixture markers for truncated subtree recovery and inaccessible frame assertions.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Wave 0 RED coverage for Plan 08-03 is ready. CAPT-11, CAPT-08, CAPT-09, and CAPT-05 remain implementation-pending; later Phase 8 plans should make these tests pass without changing their intended contracts.

## Self-Check: PASSED

- Found created files: `tests/capture-subtree-fetch.test.js`, `tests/renderer-subtree-fetch.test.js`, `tests/playwright-fidelity-phase8.test.js`, and this summary.
- Found task commits: `766457c` and `55123e5`.
- No tracked file deletions were introduced by task commits.

---
*Phase: 08-shadow-dom-iframes-fidelity-completion*
*Completed: 2026-06-15*
