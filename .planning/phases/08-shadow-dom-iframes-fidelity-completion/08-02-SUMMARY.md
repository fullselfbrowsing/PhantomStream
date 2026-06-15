---
phase: 08-shadow-dom-iframes-fidelity-completion
plan: 02
subsystem: testing
tags: [node-test, jsdom, capture, renderer, red-tests, form-values, computed-styles]

# Dependency graph
requires:
  - phase: 07-weakmap-node-identity-semantic-addressing-api
    provides: WeakMap capture identity, nodeIds sidecars, and renderer identity hooks used by the RED fixtures
provides:
  - RED capture coverage for CAPT-05 event-driven form value diffs and masking
  - RED renderer coverage for DIFF_OP.VALUE property application and stale-miss handling
  - RED capture coverage for CAPT-06 computed styles on late-added add-op subtrees
affects: [08-04-protocol-contracts, 08-06-live-value-diffs-and-added-styles, phase-08-verification]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Local node:test + jsdom global-swap fixtures
    - Recording transports for STREAM.MUTATIONS assertions
    - Renderer identity hook fixtures copied from renderer diff tests
    - getComputedStyle stubs that reject broad computed-style enumeration

key-files:
  created:
    - tests/capture-input-values.test.js
    - tests/renderer-value-diff.test.js
    - tests/capture-added-styles.test.js
  modified: []

key-decisions:
  - "Kept Wave 0 RED-only: no production source changes were made."
  - "Value-op tests reference DIFF_OP.VALUE but fall back to the literal 'value' so failures stay behavioral before the protocol constant exists."

patterns-established:
  - "RED value fixtures scan whole transport payloads for masked input leaks."
  - "RED added-style fixtures require one getComputedStyle read per live added element and no all-property enumeration."

requirements-completed: [CAPT-05, CAPT-06]

# Metrics
duration: 6 min
completed: 2026-06-15
---

# Phase 08 Plan 02: RED Form Value and Added Style Tests Summary

**RED coverage for live form value mirroring and late-added computed style serialization, with privacy and performance guardrails pinned before implementation**

## Performance

- **Duration:** 6 min
- **Started:** 2026-06-15T18:39:54Z
- **Completed:** 2026-06-15T18:46:08Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- Added capture RED tests for property-only `input`/`change` value drift across input, textarea, select, checkbox, radio, password, `maskInputs`, and `maskInputFn`.
- Added renderer RED tests for the planned value op applying DOM properties rather than unsafe attributes, including stale nid resync behavior.
- Added capture RED tests for computed styles on late-added nodes, descendant preorder sidecars, sanitizer reuse, and bounded curated style reads.

## Task Commits

Each task was committed atomically:

1. **Task 1: Add RED live form value capture and renderer value-op tests** - `4dff0f5` (`test`)
2. **Task 2: Add RED late-added computed style tests** - `2cd0f6d` (`test`)

**Plan metadata:** committed after summary self-check.

## Files Created/Modified

- `tests/capture-input-values.test.js` - RED capture fixtures for event-driven value diffs and masking.
- `tests/renderer-value-diff.test.js` - RED renderer fixtures for `DIFF_OP.VALUE` property application and stale misses.
- `tests/capture-added-styles.test.js` - RED capture fixtures for add-op computed styles, sanitizer reuse, and style read guardrails.

## Decisions Made

- Used a RED-only test plan exactly as specified; GREEN implementation remains for later Phase 8 plans.
- Used the literal `'value'` as a fallback beside `DIFF_OP.VALUE` in tests so the current absence of the protocol constant does not turn the RED run into an import/syntax failure.

## Verification

Focused RED commands:

```bash
set +e; node --test tests/capture-input-values.test.js tests/renderer-value-diff.test.js; code=$?; test "$code" -ne 0
set +e; node --test tests/capture-added-styles.test.js; code=$?; test "$code" -ne 0
```

Results:

- Value RED command: PASS wrapper result, with `node --test` exiting `1` for missing value-op behavior.
- Added-style RED command: PASS wrapper result, with `node --test` exiting `1` for missing computed-style add-op behavior.
- Acceptance file checks and required greps passed.

Observed failure reasons were behavioral:

- Capture emits no event-driven value diffs for live form property changes.
- Renderer does not apply value ops or count stale value-op nids.
- Added-node add ops do not carry computed styles.
- Added-node style reads are not performed for live subtree elements.

## Deviations from Plan

None - plan executed exactly as written.

**Total deviations:** 0 auto-fixed.
**Impact on plan:** No scope creep; all changes are test-only RED coverage.

## Issues Encountered

None. The focused tests fail for expected missing Phase 8 behavior, not syntax or import errors.

## Known Stubs

None. Stub-pattern scan found one intentional empty password value in a test fixture (`value=""`), not a production/UI data stub.

## Threat Flags

None. This plan added test coverage only; it introduced no new runtime endpoints, auth paths, file access, or schema surfaces.

## TDD Gate Compliance

This is a Wave 0 RED-only plan. The task commits are intentionally `test(08-02)` commits; GREEN implementation is deferred to later Phase 8 plans (`08-04` and `08-06`) as stated in the plan.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Ready for implementation plans to add the value protocol constant/op handling and late-added computed style capture. The RED fixtures now pin privacy masking, renderer property mutation, sidecar ordering, CSS sanitizer reuse, and no broad computed-style enumeration.

## Self-Check: PASSED

- Found created files: `tests/capture-input-values.test.js`, `tests/renderer-value-diff.test.js`, `tests/capture-added-styles.test.js`, and this summary.
- Found task commits: `4dff0f5` and `2cd0f6d`.
- Confirmed `.planning/STATE.md`, `.planning/ROADMAP.md`, and `.planning/REQUIREMENTS.md` were not modified.

---
*Phase: 08-shadow-dom-iframes-fidelity-completion*
*Completed: 2026-06-15*
