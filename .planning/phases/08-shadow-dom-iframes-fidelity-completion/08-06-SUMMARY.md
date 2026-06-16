---
phase: 08-shadow-dom-iframes-fidelity-completion
plan: 06
subsystem: capture-renderer
tags: [form-values, computed-styles, masking, iframes, shadow-dom, node-test, jsdom]

requires:
  - phase: 07-weakmap-node-identity-semantic-addressing-api
    provides: WeakMap capture identity, nodeIds sidecars, and renderer private nid index
  - phase: 08-shadow-dom-iframes-fidelity-completion
    provides: Plan 08-04 shadow-root observation and Plan 08-05 same-origin frame document roots
provides:
  - Live form value diffs for document, open shadow root, and same-origin iframe controls
  - Renderer application of value, checked, and selected option state through DOM properties
  - Event-driven value masking through the existing capture-side privacy chokepoint
  - Late-added subtree computed styles using curated batched reads and add-op sanitization
affects: [CAPT-05, CAPT-06, 08-07-subtree-recovery, 08-08-adapter-inject-sync]

tech-stack:
  added: []
  patterns:
    - Document/shadow/frame value listener roots with explicit lifecycle cleanup
    - DIFF_OP.VALUE as a narrow form-state mutation
    - collectSubtreeComputedStyles live-read cache applied before add-op sanitization

key-files:
  created:
    - .planning/phases/08-shadow-dom-iframes-fidelity-completion/08-06-SUMMARY.md
  modified:
    - src/capture/index.js
    - src/renderer/diff.js
    - tests/capture-input-values.test.js

key-decisions:
  - "Value diffs are sent as DIFF_OP.VALUE mutations, not full node replacements."
  - "Input/change value payloads use sanitizeForWire('input') so password, maskInputs, and maskInputFn behavior stays capture-side."
  - "Late-added computed styles append to existing inline style attributes, then reuse the existing subtree sanitizer."

patterns-established:
  - "startValueCapture/stopValueCapture own listener lifecycle for document, open shadow roots, and observed same-origin frame documents."
  - "buildValueDiff emits only nid-addressed value, checked, and selectedValues fields."
  - "collectSubtreeComputedStyles reads collectComputedStyleText(el, CURATED_PROPS) once per live added element before clone mutation."

requirements-completed: [CAPT-05, CAPT-06]

duration: 6min
completed: 2026-06-15
---

# Phase 08 Plan 06: Live Values and Added Styles Summary

**Masked live form value diffs plus curated computed styles for late-added DOM subtrees**

## Performance

- **Duration:** 6 min
- **Started:** 2026-06-15T19:22:02Z
- **Completed:** 2026-06-15T19:27:59Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- Added explicit `input`/`change` capture for document controls, open shadow roots, and same-origin iframe documents.
- Added `DIFF_OP.VALUE` renderer handling for `value`, `checked`, and `selectedValues` without rewriting form-control attributes.
- Routed event-driven form values through capture-side `sanitizeForWire('input')`, preserving password masking, `maskInputs`, and `maskInputFn`.
- Added late-added subtree style capture with `collectSubtreeComputedStyles`, using curated computed props and existing add-op sanitization.

## Task Commits

Each task was committed atomically:

1. **Task 1 RED: Capture and apply explicit value diffs iframe coverage** - `b455cf7` (test)
2. **Task 1 GREEN: Capture and apply explicit value diffs** - `2546757` (feat)
3. **Task 2 GREEN: Add batched curated computed styles to add ops** - `61a92e4` (feat)

Plan metadata is committed separately with this summary.

## Files Created/Modified

- `src/capture/index.js` - Value listener lifecycle, `buildValueDiff`, `sanitizeForWire('input')`, frame/shadow listener registration, and added-subtree computed style caching.
- `src/renderer/diff.js` - `DIFF_OP.VALUE` application through DOM properties with existing stale-miss behavior.
- `tests/capture-input-values.test.js` - Same-origin iframe input test changed from a TODO handoff to executable RED coverage.
- `.planning/phases/08-shadow-dom-iframes-fidelity-completion/08-06-SUMMARY.md` - Plan execution summary.

## Decisions Made

- Used capture-phase listeners on accessible root objects so controls inside open shadow roots and same-origin frame documents are observed without relying on MutationObserver value attributes.
- Kept value operations content-free in telemetry and diagnostics; typed values appear only in the mutation payload after masking.
- Appended cached computed declarations to existing inline styles before sanitizer traversal so benign author inline styles continue to pass through.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Preserved existing add-op inline styles while adding computed styles**
- **Found during:** Task 2 verification
- **Issue:** The first computed-style implementation replaced existing `style` attributes on added-node clones, breaking the sanitizer test that pins benign inline style pass-through.
- **Fix:** Switched computed-style application to `appendStyleDeclaration`, preserving existing inline declarations while still adding curated computed styles before `sanitizeForWire('subtree')`.
- **Files modified:** `src/capture/index.js`
- **Verification:** `node --test tests/capture-added-styles.test.js tests/security-sanitize-capture.test.js tests/capture-defenses.test.js`
- **Committed in:** `61a92e4`

**Total deviations:** 1 auto-fixed (1 Rule 1 bug).
**Impact on plan:** The fix preserved existing sanitizer behavior without adding feature scope.

## Issues Encountered

- Task 2 RED tests were already present from the Phase 8 RED-test plan, so no additional Task 2 test-only commit was needed in this execution.

## Verification

```bash
node --test tests/capture-input-values.test.js tests/renderer-value-diff.test.js tests/security-mask.test.js tests/renderer-diff.test.js
node --test tests/capture-added-styles.test.js tests/security-sanitize-capture.test.js tests/capture-defenses.test.js
node --test tests/capture-input-values.test.js tests/renderer-value-diff.test.js tests/capture-added-styles.test.js tests/security-mask.test.js tests/security-sanitize-capture.test.js tests/renderer-diff.test.js tests/capture-defenses.test.js
rg -n "startValueCapture|stopValueCapture|buildValueDiff|DIFF_OP\\.VALUE|selectedValues|safeMaskInput" src/capture/index.js src/renderer/diff.js
rg -n "collectSubtreeComputedStyles|collectComputedStyleText\\(.*CURATED_PROPS|STYLE_DEFAULTS" src/capture/index.js
rg -n "for \\(.*computed\\.length|for .* in .*getComputedStyle|Array\\.from\\(computed" src/capture/index.js
```

Results:

- Task 1 focused gate passed: 41 tests, 41 pass.
- Task 2 focused gate passed: 27 tests, 27 pass.
- Plan-level gate passed: 68 tests, 68 pass.
- Required implementation greps returned matches.
- Forbidden computed-style enumeration grep returned no matches.

## Known Stubs

None. Stub scan hits were existing/default empty arrays/nulls and deliberate blocked-content placeholder terminology, not unresolved implementation stubs.

## Threat Flags

None. New value-diff, event-driven masking, add-op computed style, and sanitizer surfaces are covered by `T-08-21` through `T-08-24`.

## Auth Gates

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Plan 08-07 can build subtree recovery on top of current value/style fidelity. Plan 08-08 must sync the Playwright inject artifact so the classic injected capture bundle carries `DIFF_OP.VALUE` capture and added-node style behavior.

## Orchestrator-Owned State

Per execution prompt, `.planning/STATE.md` and `.planning/ROADMAP.md` were not modified.

## Self-Check: PASSED

- Found `src/capture/index.js`, `src/renderer/diff.js`, `tests/capture-input-values.test.js`, and this summary file.
- Found task commits `b455cf7`, `2546757`, and `61a92e4` in git history.
- Confirmed `.planning/STATE.md` and `.planning/ROADMAP.md` have no working-tree diffs.

---
*Phase: 08-shadow-dom-iframes-fidelity-completion*
*Completed: 2026-06-15*
