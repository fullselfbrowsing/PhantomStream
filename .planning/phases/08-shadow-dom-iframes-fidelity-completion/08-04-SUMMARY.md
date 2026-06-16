---
phase: 08-shadow-dom-iframes-fidelity-completion
plan: 04
subsystem: capture-renderer
tags: [shadow-dom, node-test, jsdom, weakmap-identity, sanitizer, protocol]

requires:
  - phase: 07-weakmap-node-identity-semantic-addressing-api
    provides: WeakMap capture identity, nodeIds sidecars, and renderer private nid index
provides:
  - Phase 8 protocol constants and JSDoc contracts for shadow roots, values, frames, and subtree recovery
  - Open shadow root snapshot sidecars keyed by host nid
  - Shadow-root mutation streaming through observed open roots
  - Renderer reconstruction of sanitized real open shadow roots with private identity indexing
affects: [CAPT-08, CAPT-05, CAPT-11, 08-05-iframe-implementation, 08-06-value-style-implementation, 08-07-subtree-recovery]

tech-stack:
  added: []
  patterns:
    - Host-nid-tied shadowRoots sidecars
    - Open ShadowRoot observation through the existing rAF mutation batcher
    - Renderer installShadowRoot identity hook with sanitize-before-import

key-files:
  created:
    - .planning/phases/08-shadow-dom-iframes-fidelity-completion/08-04-SUMMARY.md
  modified:
    - src/protocol/messages.js
    - tests/protocol.test.js
    - src/capture/index.js
    - src/renderer/index.js
    - src/renderer/diff.js

key-decisions:
  - "Shadow content is transported as structured shadowRoots sidecars tied to host nids, not flattened into light DOM HTML."
  - "Shadow-root internal mutations stream as host-scoped shadow-root replacement ops so identity stays sidecar-based."
  - "Renderer shadow reconstruction runs sanitizeFragment before import and indexes shadow descendants only after installation."

patterns-established:
  - "collectShadowRootPayloads serializes open roots and extends collection into nested shadow roots through parent shadow nodeIds."
  - "applyMutations handles DIFF_OP.SHADOW_ROOT without a selector fallback and can use viewer-owned installShadowRoot hooks."

requirements-completed: [CAPT-08, CAPT-05, CAPT-11]

duration: 9min
completed: 2026-06-15
---

# Phase 08 Plan 04: Shadow DOM Fidelity Summary

**Open shadow DOM mirroring with host-nid sidecars, observed shadow mutations, sanitized reconstruction, and private renderer identity indexing**

## Performance

- **Duration:** 9 min
- **Started:** 2026-06-15T18:51:11Z
- **Completed:** 2026-06-15T18:59:37Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments

- Added Phase 8 wire constants for value diffs, shadow-root ops, subtree requests, and subtree responses, plus JSDoc payload typedefs for shadow roots, frames, values, and subtree recovery.
- Implemented capture-side open shadow root serialization as `shadowRoots[]` sidecars keyed by `hostNid`, with shadow descendant `nodeIds` and slot metadata.
- Added deliberate open shadow root observation and `DIFF_OP.SHADOW_ROOT` mutation emission through the existing rAF-batched stream.
- Implemented renderer-side real `attachShadow({ mode: 'open' })` reconstruction, shadow fragment sanitization, and private Map indexing for shadow descendant nids.

## Task Commits

Each task was committed atomically:

1. **Task 1: Add Phase 8 protocol constants and payload typedefs** - `f72f99e` (feat)
2. **Task 2: Implement open shadow root capture, reconstruction, and shadow-aware diffs** - `4a48344` (feat)

Plan metadata is committed separately with this summary.

## Files Created/Modified

- `src/protocol/messages.js` - Phase 8 `CONTROL`, `STREAM`, and `DIFF_OP` constants plus payload typedefs.
- `tests/protocol.test.js` - Protocol export assertions for the new Phase 8 constants.
- `src/capture/index.js` - Open shadow root serialization, sidecar collection, shadow root observation, attachShadow wrapping, and shadow-root mutation ops.
- `src/renderer/index.js` - Snapshot and mutation-time shadow root installation through the viewer-owned identity index.
- `src/renderer/diff.js` - `DIFF_OP.SHADOW_ROOT` application and add-op shadow sidecar installation without selector fallback.

## Decisions Made

- Used whole-shadow-root replacement ops for observed shadow root changes in this plan. This matches the RED contract and keeps shadow internal mutations host-scoped until later plans add more granular sidecars if needed.
- Kept closed shadow roots out of the payload. The implementation only serializes roots where `host.shadowRoot` exposes an open root.
- Added protocol assertions to `tests/protocol.test.js` even though runtime RED tests already referenced some constants, so Task 1 has a direct green protocol gate.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Avoided non-clonable ShadowRoot serialization**
- **Found during:** Task 2 verification
- **Issue:** `ShadowRoot.cloneNode(true)` throws `NotSupportedError` in jsdom, failing all capture shadow tests before assertions could run.
- **Fix:** Clone shadow root child nodes individually into a detached container before sanitization and sidecar pairing.
- **Files modified:** `src/capture/index.js`
- **Verification:** `node --test tests/capture-shadow-dom.test.js`
- **Committed in:** `4a48344`

**2. [Rule 2 - Missing Critical] Preserved nested open shadow root discovery**
- **Found during:** Task 2 review
- **Issue:** Nested shadow hosts inside a parent shadow tree have host ids in the parent shadow sidecar, not in the light-DOM `nodeIds` sidecar.
- **Fix:** Extended the allowed host-id set with each serialized shadow payload's `nodeIds` before recursively collecting nested open roots.
- **Files modified:** `src/capture/index.js`
- **Verification:** Focused Task 2 test gate passed after the adjustment.
- **Committed in:** `4a48344`

**Total deviations:** 2 auto-fixed (1 bug, 1 missing critical).
**Impact on plan:** Both fixes support the planned open shadow DOM fidelity contract without adding new feature scope.

## Issues Encountered

- Direct `applyMutations` tests expected `DIFF_OP.SHADOW_ROOT` to work with only the existing identity hooks. `diff.js` now has a safe direct-install path and still lets `createViewer` provide its own `installShadowRoot` hook.

## Verification

```bash
node --test tests/protocol.test.js
set +e; node --test tests/capture-shadow-dom.test.js tests/renderer-shadow-dom.test.js; code=$?; test "$code" -ne 0
node --test tests/capture-shadow-dom.test.js tests/renderer-shadow-dom.test.js tests/renderer-diff.test.js tests/node-identity-static.test.js tests/security-sanitize-render.test.js
rg -n "shadowRoots|serializeOpenShadowRoot|installShadowRoots|DIFF_OP\\.SHADOW_ROOT|attachShadow" src/capture/index.js src/renderer/index.js src/renderer/diff.js
rg -n "assignedNodes\\(|querySelector\\('\\[data-fsb-nid|NID_ATTR" src/capture/index.js src/renderer/index.js src/renderer/diff.js
```

Results:

- Protocol constants test passed.
- Task 1 RED guard passed before runtime implementation: shadow runtime tests failed only for missing behavior.
- Task 2 focused test gate passed: 41 tests, 41 pass.
- Required implementation grep returned matches.
- Forbidden selector/identity grep returned no matches.

## Known Stubs

None. Stub scan hits were existing placeholder terminology for blocked elements/frame placeholder labels, not unimplemented UI or data stubs.

## Threat Flags

None. New shadow serialization, observation, sanitization, and renderer identity surfaces are covered by the plan threat model (`T-08-13` through `T-08-16`).

## Auth Gates

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Plan 08-05 can build iframe fidelity on the same structured sidecar pattern. Plans 08-06 and 08-07 can rely on `DIFF_OP.VALUE`, `CONTROL.SUBTREE_REQUEST`, and `STREAM.SUBTREE_RESPONSE` now being present in the protocol.

## Self-Check: PASSED

- Found modified source/test files and this summary file.
- Found task commits `f72f99e` and `4a48344` in git history.
- Confirmed `.planning/STATE.md` and `.planning/ROADMAP.md` have no working-tree diffs.

---
*Phase: 08-shadow-dom-iframes-fidelity-completion*
*Completed: 2026-06-15*
