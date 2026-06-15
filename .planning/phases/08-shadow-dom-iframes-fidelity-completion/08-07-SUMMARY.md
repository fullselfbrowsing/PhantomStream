---
phase: 08-shadow-dom-iframes-fidelity-completion
plan: 07
subsystem: capture-renderer
tags: [subtree-recovery, truncation, shadow-dom, iframes, sanitizer, node-test, jsdom]

requires:
  - phase: 07-weakmap-node-identity-semantic-addressing-api
    provides: WeakMap capture identity, nodeIds sidecars, and renderer private nid index
  - phase: 08-shadow-dom-iframes-fidelity-completion
    provides: Plan 08-04 shadow-root sidecars, Plan 08-05 frame sidecars, and Plan 08-06 added-subtree style/value fidelity
provides:
  - Requestable truncated snapshot markers that preserve dropped root nids
  - Capture-side CONTROL.SUBTREE_REQUEST handling with sanitized STREAM.SUBTREE_RESPONSE payloads
  - Renderer-side requestSubtree latching and sanitized replacement of truncated markers
  - Loopback coverage proving targeted recovery without a full replacement snapshot
affects: [CAPT-11, 08-08-adapter-inject-sync, renderer-identity, truncation-recovery]

tech-stack:
  added: []
  patterns:
    - CONTROL.SUBTREE_REQUEST to STREAM.SUBTREE_RESPONSE request/response flow
    - Per-nid pending request latches with requestId matching
    - Reuse of processAddedNode and renderer sanitizeFragment for subtree recovery

key-files:
  created:
    - .planning/phases/08-shadow-dom-iframes-fidelity-completion/08-07-SUMMARY.md
  modified:
    - src/capture/index.js
    - src/renderer/index.js
    - tests/capture-subtree-fetch.test.js
    - tests/renderer-subtree-fetch.test.js
    - tests/renderer-loopback.test.js
    - tests/renderer-viewer.test.js

key-decisions:
  - "Subtree recovery is explicit and latched; diff.js stale-miss resync behavior remains unchanged."
  - "Capture subtree responses reuse processAddedNode so masking, sanitization, style, shadowRoots, frames, and nodeIds follow the add-op policy."
  - "Renderer accepts only matching in-flight requestId/nid responses before mutating a truncated marker."

patterns-established:
  - "Snapshot truncation replaces dropped clone roots with data-phantomstream-truncated markers while preserving the dropped root nid in nodeIds."
  - "requestSubtree returns a concrete requestId or null for invalid, missing, or latch-blocked nids."
  - "STREAM.SUBTREE_RESPONSE is parsed into a template, sanitized, imported, indexed, then receives shadow/frame sidecars."

requirements-completed: [CAPT-11]

duration: 9min
completed: 2026-06-15
---

# Phase 08 Plan 07: Truncated Subtree Recovery Summary

**Bounded on-demand subtree recovery with sanitized capture responses and latched renderer installation**

## Performance

- **Duration:** 9 min
- **Started:** 2026-06-15T19:31:39Z
- **Completed:** 2026-06-15T19:41:05Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments

- Added mirror-only truncation markers using `data-phantomstream-truncated="true"` while keeping the dropped root nid requestable through `nodeIds`.
- Added capture `handleControl(CONTROL.SUBTREE_REQUEST, payload)` with stale/gone/skipped/blocked/untracked content-free statuses.
- Added renderer `requestSubtree()` with per-nid latching, requestId matching, staleness checks, and sanitized replacement of truncated markers.
- Added loopback recovery coverage proving targeted subtree recovery does not trigger a full snapshot.

## Task Commits

Each task was committed atomically:

1. **Task 1 RED: Capture subtree recovery coverage** - `a4213b3` (test)
2. **Task 1 GREEN: Capture subtree request responses** - `dd1e7d2` (feat)
3. **Task 2 RED: Renderer subtree recovery coverage** - `3bf7870` (test)
4. **Task 2 GREEN: Renderer request/response installation** - `b95d963` (feat)

Plan metadata is committed separately with this summary.

## Files Created/Modified

- `src/capture/index.js` - Truncated marker replacement, `serializeRequestedSubtree`, and `handleControl` for `CONTROL.SUBTREE_REQUEST`.
- `src/renderer/index.js` - `requestSubtree`, pending request latches, `STREAM.SUBTREE_RESPONSE` dispatch, and sanitized marker replacement.
- `tests/capture-subtree-fetch.test.js` - Capture RED coverage for requestable markers, sanitized ok responses, and content-free misses.
- `tests/renderer-subtree-fetch.test.js` - Renderer RED coverage for requestId returns, latching, stale/miss clearing, sanitizer, and indexing.
- `tests/renderer-loopback.test.js` - End-to-end targeted recovery over the loopback transport without a full snapshot.
- `tests/renderer-viewer.test.js` - Viewer handle contract updated to include `requestSubtree`.
- `.planning/phases/08-shadow-dom-iframes-fidelity-completion/08-07-SUMMARY.md` - Plan execution summary.

## Decisions Made

- Kept subtree fetch explicit. The optional `diff.js` auto-request hook was not needed because CAPT-11 is satisfied through host/viewer calls to `requestSubtree`, and existing stale-miss resync behavior remains intact.
- Returned `untracked` for nids never present in capture state, distinct from `gone` for previously tracked but detached nodes.
- Cleared renderer subtree latches on matching stale and miss responses, but mutated the mirror only for current `status: 'ok'` responses tied to an in-flight request.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Tightened capture RED coverage for requestable markers and untracked misses**
- **Found during:** Task 1 RED setup
- **Issue:** Existing tests covered `handleControl` but did not pin truncation marker identity preservation and expected a never-tracked nid to report `gone`.
- **Fix:** Added the truncation marker test and corrected the untracked miss expectation to match the plan.
- **Files modified:** `tests/capture-subtree-fetch.test.js`
- **Verification:** Capture RED failed before implementation and passed after `dd1e7d2`.
- **Committed in:** `a4213b3`

**2. [Rule 2 - Missing Critical] Updated renderer public handle contract for requestSubtree**
- **Found during:** Task 2 RED setup
- **Issue:** `tests/renderer-viewer.test.js` pinned the old exact handle surface and would reject the planned public `requestSubtree` API.
- **Fix:** Updated the handle-shape assertion and type checks to include `requestSubtree`.
- **Files modified:** `tests/renderer-viewer.test.js`
- **Verification:** Renderer RED failed before implementation and passed after `b95d963`.
- **Committed in:** `3bf7870`

**3. [Rule 1 - Bug] Narrowed marker removal assertions to the requested marker**
- **Found during:** Task 2 implementation verification
- **Issue:** Renderer tests asserted no truncated markers remained, but the latch test fixture intentionally includes multiple markers so unrelated markers can remain.
- **Fix:** Changed assertions to prove only the requested marker count decreases and the requested placeholder is removed.
- **Files modified:** `tests/renderer-subtree-fetch.test.js`, `tests/renderer-loopback.test.js`
- **Verification:** `node --test tests/renderer-subtree-fetch.test.js tests/renderer-loopback.test.js tests/security-sanitize-render.test.js tests/renderer-viewer.test.js`
- **Committed in:** `3bf7870`

**Total deviations:** 3 auto-fixed (2 Rule 2 missing critical coverage updates, 1 Rule 1 test bug).
**Impact on plan:** All fixes tightened planned CAPT-11 behavior without adding feature scope.

## Issues Encountered

- `src/renderer/diff.js` did not require changes. The plan made the automatic stale/truncated miss hook optional, and explicit `requestSubtree()` coverage satisfied the bounded recovery requirement while preserving existing resync thresholds.

## Verification

```bash
node --test tests/capture-subtree-fetch.test.js tests/security-sanitize-capture.test.js tests/capture-defenses.test.js
node --test tests/renderer-subtree-fetch.test.js tests/renderer-loopback.test.js tests/security-sanitize-render.test.js tests/renderer-viewer.test.js
node --test tests/capture-subtree-fetch.test.js tests/renderer-subtree-fetch.test.js tests/renderer-loopback.test.js tests/security-sanitize-capture.test.js tests/security-sanitize-render.test.js tests/capture-defenses.test.js
rg -n "handleControl|serializeRequestedSubtree|SUBTREE_REQUEST|SUBTREE_RESPONSE|data-phantomstream-truncated" src/capture/index.js
rg -n "requestSubtree|pendingSubtreeRequests|handleSubtreeResponse|SUBTREE_RESPONSE|data-phantomstream-truncated" src/renderer/index.js src/renderer/diff.js
```

Results:

- Task 1 focused gate passed: 26 tests, 26 pass.
- Task 2 focused gate passed: 57 tests, 57 pass.
- Plan-level gate passed: 64 tests, 64 pass.
- Required implementation greps returned matches.

## Known Stubs

None. Stub scan hits were intentional placeholder terminology, normal empty/default state initialization, or existing test harness cleanup values.

## Threat Flags

None. New viewer control, capture live-DOM serialization, staleness checks, and renderer insertion surfaces are covered by `T-08-25` through `T-08-28`.

## Auth Gates

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Plan 08-08 can sync checked-in injected artifacts with the new capture `handleControl` and renderer `requestSubtree` behavior. CAPT-11 now has focused capture, renderer, and loopback coverage.

## Orchestrator-Owned State

Per execution prompt, `.planning/STATE.md` and `.planning/ROADMAP.md` were not modified.

## Self-Check: PASSED

- Found `src/capture/index.js`, `src/renderer/index.js`, `tests/capture-subtree-fetch.test.js`, `tests/renderer-subtree-fetch.test.js`, `tests/renderer-loopback.test.js`, `tests/renderer-viewer.test.js`, and this summary file.
- Found task commits `a4213b3`, `dd1e7d2`, `3bf7870`, and `b95d963` in git history.
- Confirmed `.planning/STATE.md` and `.planning/ROADMAP.md` have no working-tree diffs.

---
*Phase: 08-shadow-dom-iframes-fidelity-completion*
*Completed: 2026-06-15*
