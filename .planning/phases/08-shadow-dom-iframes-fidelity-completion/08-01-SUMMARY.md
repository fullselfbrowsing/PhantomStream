---
phase: 08-shadow-dom-iframes-fidelity-completion
plan: 01
subsystem: testing
tags: [node-test, jsdom, shadow-dom, iframe, weakmap-identity]

requires:
  - phase: 07-weakmap-node-identity-semantic-addressing-api
    provides: WeakMap-backed capture identity, nodeIds sidecars, and renderer private nid index
provides:
  - RED capture and renderer contracts for CAPT-08 open shadow DOM fidelity
  - RED capture and renderer contracts for CAPT-09 same-origin and cross-origin iframe fidelity
affects: [08-04-shadow-dom-implementation, 08-05-iframe-implementation, CAPT-08, CAPT-09]

tech-stack:
  added: []
  patterns: [local jsdom capture harness, manual renderer srcdoc glue, recording transport assertions]

key-files:
  created:
    - tests/capture-shadow-dom.test.js
    - tests/renderer-shadow-dom.test.js
    - tests/capture-iframe.test.js
    - tests/renderer-iframe.test.js
  modified: []

key-decisions:
  - "Wave 0 remains RED-only: production implementation is intentionally deferred to later Phase 8 plans."
  - "Closed shadow roots are excluded; tests target open shadow roots only per D-03."
  - "Cross-origin iframe tests use content-free placeholders and do not attempt any origin bypass."

patterns-established:
  - "Shadow DOM RED tests assert structured shadowRoots sidecars keyed by hostNid, not flattened light DOM."
  - "Iframe RED tests assert frames sidecars and inert renderer srcdoc installation without allow-scripts."

requirements-completed: [CAPT-08, CAPT-09]

duration: 7min
completed: 2026-06-15
---

# Phase 08 Plan 01: Shadow DOM and Iframe RED Tests Summary

**Executable RED contracts for Phase 8 shadowRoots and frames payloads, pinned to Phase 7 sidecar identity**

## Performance

- **Duration:** 7 min
- **Started:** 2026-06-15T18:39:29Z
- **Completed:** 2026-06-15T18:46:18Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- Added capture-side shadow DOM RED tests for `shadowRoots`, `hostNid`, `slotAssignment`, shadow descendant `nodeIds`, and shadow-aware mutation ops.
- Added renderer-side shadow DOM RED tests for real `attachShadow` reconstruction, shadow fragment sanitization, private nid indexing, and geometry-only `resolveNode`.
- Added capture-side iframe RED tests for same-origin `frames` payloads, frame descendant identity, and cross-origin content-free placeholders.
- Added renderer-side iframe RED tests for inert same-origin nested `srcdoc`, no `allow-scripts`, frame nid resolution, and cross-origin labeled regions.

## Task Commits

Each task was committed atomically:

1. **Task 1: Add RED shadow DOM capture and renderer tests** - `9cceaba` (test)
2. **Task 2: Add RED same-origin and cross-origin iframe tests** - `a22a798` (test)

**Plan metadata:** final docs commit for this summary.

## Files Created/Modified

- `tests/capture-shadow-dom.test.js` - RED capture contracts for open shadow root snapshot sidecars, slots, shadow identity, and shadow mutation streaming.
- `tests/renderer-shadow-dom.test.js` - RED renderer contracts for shadow root reconstruction, sanitization, and private identity indexing.
- `tests/capture-iframe.test.js` - RED capture contracts for same-origin frame serialization and cross-origin content-free metadata.
- `tests/renderer-iframe.test.js` - RED renderer contracts for inert nested frame reconstruction and cross-origin placeholder rendering.

## Decisions Made

- Kept this plan RED-only because the plan explicitly requires tests that fail until later Phase 8 implementation plans land.
- Did not add closed shadow root assertions; D-03 says closed roots are not introspectable.
- Modeled cross-origin behavior with a throwing `contentDocument` getter and leak checks against the full transport payload.

## Verification

Both focused RED commands passed by proving the new tests fail against the current implementation:

```bash
set +e; node --test tests/capture-shadow-dom.test.js tests/renderer-shadow-dom.test.js; code=$?; test "$code" -ne 0
set +e; node --test tests/capture-iframe.test.js tests/renderer-iframe.test.js; code=$?; test "$code" -ne 0
```

Acceptance greps also passed:

```bash
rg -n "shadowRoots|hostNid|slotAssignment|attachShadow|resolveNode|DIFF_OP\\.SHADOW_ROOT" tests/capture-shadow-dom.test.js tests/renderer-shadow-dom.test.js
rg -n "frames|frameNid|same-origin|cross-origin|allow-scripts|contentDocument" tests/capture-iframe.test.js tests/renderer-iframe.test.js
```

## TDD Gate Compliance

This plan used RED-only TDD tasks by design. GREEN implementation commits are intentionally absent because the plan success criteria require no production source changes and expect the tests to fail until Plans 08-04 and 08-05.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- HEAD advanced during execution because parallel executors committed other Phase 8 RED-test work. No conflicts occurred, and this plan staged/committed only its four owned test files.
- `.planning/STATE.md` and `.planning/ROADMAP.md` were not modified because the parallel execution instruction says the orchestrator owns those files.

## Known Stubs

None. Stub scan found the word `placeholder` only in cross-origin iframe placeholder contract assertions, not in stubbed implementation code.

## Auth Gates

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Plans 08-04 and 08-05 can now implement the shadow DOM and iframe protocol extensions against explicit failing tests. The tests also pin the Phase 7 identity model so implementations cannot fall back to live `data-fsb-nid` attributes or selector-based resolution.

## Self-Check: PASSED

- Found all four created test files and this summary file.
- Found task commits `9cceaba` and `a22a798` in git history.
- Confirmed `.planning/STATE.md` and `.planning/ROADMAP.md` have no diffs from this plan.

---
*Phase: 08-shadow-dom-iframes-fidelity-completion*
*Completed: 2026-06-15*
