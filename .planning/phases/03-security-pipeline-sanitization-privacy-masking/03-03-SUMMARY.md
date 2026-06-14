---
phase: 03-security-pipeline-sanitization-privacy-masking
plan: 03
subsystem: security
tags: [privacy-masking, rrweb, capture, blockSelector, maskInputs, password-masking]

# Dependency graph
requires:
  - phase: 03-security-pipeline-sanitization-privacy-masking
    provides: 03-01 sanitizeForWire capture-side chokepoint and masking seams
provides:
  - rrweb-compatible capture-side masking config on createCapture
  - maskTextSelector and maskTextFn masking across snapshot, characterData, E2 text-childlist, and add-op paths
  - blockSelector dimension placeholders with rr_width, rr_height, and nid only
  - blocked-subtree mutation suppression for attr, text, and childList records
  - always-on password value masking plus maskInputs and fail-closed maskInputFn
  - explicit T-03-26 side-channel masking boundary comment
affects: [03-05 SECURITY.md, phase-8 CAPT-05 typed-text, renderer consumers of DIFF_OP.ADD/ATTR/TEXT]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - selector validation at factory time with Error('invalid-mask-selector')
    - fail-closed custom mask functions falling back to default asterisk masking
    - live-node ancestry checks for detached add-op clone masking
    - batched live rect reads before blocked snapshot placeholder writes
    - capture-side privacy guarantees enforced before transport.send

key-files:
  created:
    - tests/security-mask.test.js
  modified:
    - src/capture/index.js

key-decisions:
  - "Masking stays capture-side only; createViewer remains untouched."
  - "Blocked elements are mirrored as a div placeholder carrying only rr_width, rr_height, and data-fsb-nid."
  - "Password input values are always masked, independent of maskInputs."
  - "Dialog and overlay string side channels remain accepted residual T-03-26 because selectors have no owner element there."

patterns-established:
  - "Privacy masking is implemented inside sanitizeForWire dispatch shapes, not as a second serializer path."
  - "blockSelector uses self-match for placeholders and ancestor-inclusive matching for mutation suppression."
  - "maskInputFn/maskTextFn errors are logged and default-masked so raw values never leak."

requirements-completed: [SEC-03]

# Metrics
duration: 5min
completed: 2026-06-14
---

# Phase 3 Plan 03: Privacy Masking Summary

**rrweb-compatible capture-side privacy masking with blockSelector placeholders, maskTextSelector, always-on password masking, maskInputs, and fail-closed custom mask functions across snapshot/add/attr/text paths**

## Performance

- **Duration:** 5 min continuation (recovered RED commits were already merged)
- **Started:** 2026-06-14T00:46:29Z
- **Completed:** 2026-06-14T00:51:59Z
- **Tasks:** 2 TDD tasks
- **Files modified:** 2

## Accomplishments

- Added `maskTextSelector` / `maskTextFn` masking through the `sanitizeForWire('text')`, `element`, and `subtree` shapes so snapshot text, characterData, E2 text-childlist, and add-op HTML are masked before transport.
- Added `blockSelector` placeholders that carry `rr_width`, `rr_height`, and `data-fsb-nid` only; blocked attributes, children, and text are absent from snapshot and add-op wire payloads.
- Suppressed attr, text, and childList mutation records on or inside blocked subtrees while preserving tracked sibling traffic.
- Added always-on password value masking, `maskInputs` coverage for input/textarea value surfaces, and fail-closed `maskInputFn` fallback behavior.
- Dispositioned dialog/overlay string side channels in code with a grep-able `T-03-26` comment.

## Task Commits

Each task was committed atomically:

1. **Task 1 RED: text masking suite** - `2f46873` (test)
2. **Task 1 GREEN: maskTextSelector/maskTextFn implementation** - `9767182` (feat)
3. **Task 2 RED: blockSelector + maskInputs/password suite** - `62e62cb` (test)
4. **Task 2 GREEN: blockSelector placeholders + input/password masking** - `da86b40` (feat)

_Continuation note: recovered branch `worktree-agent-aca4a7e1b632a8c5a` supplied the first three commits; this run completed Task 2 GREEN._

## Files Created/Modified

- `tests/security-mask.test.js` - 19-test SEC-03 behavioral suite covering text masking, blocked placeholders, blocked mutation suppression, password masking, maskInputs, custom mask functions, invalid selectors, and wire-wide no-leak scans.
- `src/capture/index.js` - `createCapture` privacy config seam, selector predicates, fail-closed mask helpers, blocked placeholder helpers, snapshot/add-op placeholder routing, input/password masking in sanitizer dispatch, and blocked-subtree differ guards.

## Decisions Made

- Masking remains capture-side only; no viewer API or render-time masking was added.
- Blocked roots are still nid-stamped so the viewer can address/remove the placeholder, but blocked descendants are not serialized.
- Password masking is non-configurable and applies even when `maskInputs` is false.
- `maskInputs` intentionally does not mask select option display text; that accepted residual remains tracked for SECURITY.md.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- Task 2 started from a recovered RED state with 10 passing and 9 failing `tests/security-mask.test.js` rows. The GREEN implementation made the full 19-test masking suite pass without weakening tests.

## Known Stubs

None. Stub-pattern scan found only intended blocked-element placeholder terminology and ordinary empty-array/null initializers; no unfinished placeholder data flows block SEC-03.

## Verification

- `node --test tests/security-mask.test.js` - pass, 19/19 tests.
- `npm test` - pass, 187/187 tests.
- `grep -c "invalid-mask-selector" src/capture/index.js` - `4`.
- `grep -c "T-03-26" src/capture/index.js` - `2`.
- `grep -c "rr_width" src/capture/index.js` - `2`.

## TDD Gate Compliance

- RED gate present before Task 1 GREEN: `2f46873` -> `9767182`.
- RED gate present before Task 2 GREEN: `62e62cb` -> `da86b40`.
- No refactor commit was needed; tests remained green after GREEN.

## Threat Flags

None. This plan modifies the existing capture-side serialization trust boundary covered by SEC-03 and introduces no new endpoint, auth path, file access, or schema surface.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

SEC-03 is complete. Plan 03-05 can document the masking contract and accepted residuals (`T-03-18`, `T-03-26`) against working code and tests.

---
*Phase: 03-security-pipeline-sanitization-privacy-masking*
*Completed: 2026-06-14*

## Self-Check: PASSED

- Files verified: `.planning/phases/03-security-pipeline-sanitization-privacy-masking/03-03-SUMMARY.md`, `src/capture/index.js`, `tests/security-mask.test.js`.
- Commits verified: `2f46873`, `9767182`, `62e62cb`, `da86b40`.
- Focused suite re-run: `node --test tests/security-mask.test.js` passed 19/19.
