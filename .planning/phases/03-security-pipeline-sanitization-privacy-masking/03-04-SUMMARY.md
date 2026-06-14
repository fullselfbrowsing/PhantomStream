---
phase: 03-security-pipeline-sanitization-privacy-masking
plan: 04
subsystem: security-testing
tags: [differential-oracle, sanitization, privacy-masking, ledger, tdd]

# Dependency graph
requires:
  - phase: 03-security-pipeline-sanitization-privacy-masking
    provides: 03-01 capture-side sanitizeForWire chokepoint
  - phase: 03-security-pipeline-sanitization-privacy-masking
    provides: 03-03 always-on password masking before transport
provides:
  - frozen sanitize-corpus differential fixture with snapshot hostile rows
  - sanitize-divergence scenario exercising post-snapshot hostile attr mutations
  - D7-capture-sanitization mismatch ledger entry scoped to sanitize-divergence
  - oracle matrix, direction checks, zero-consultation exclusion, and empty-ledger load-bearing test
affects: [03-05 SECURITY.md, differential-oracle, SEC-01, SEC-03]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - scenario-guard-first mismatch ledger predicate
    - same-index sanitization divergence predicate for snapshot and mutation messages
    - belt-and-braces oracle direction checks for declared security divergences

key-files:
  created:
    - tests/differential/fixtures/sanitize-corpus.html
    - tests/differential/scenarios/sanitize-divergence.js
  modified:
    - tests/differential/divergence-ledger.js
    - tests/differential/oracle.test.js

key-decisions:
  - "D7 remains one mismatch-kind ledger entry covering both snapshot sanitization/masking and post-snapshot attr-op sanitization."
  - "D7 only applies to same-index SNAPSHOT or MUTATIONS mismatches after the sanitize-divergence scenario guard."
  - "Oracle direction checks prove the reference carries hostile/password content and the extracted stream strips, neutralizes, or masks it."

patterns-established:
  - "A deliberate security divergence must land as fixture + scenario + ledger + load-bearing empty-ledger test."
  - "Zero-consultation assertions exclude only the scenarios with declared mismatch entries."

requirements-completed: [SEC-01, SEC-03]

# Metrics
duration: 6 min
completed: 2026-06-14
---

# Phase 3 Plan 04: D7 Differential Oracle Summary

**D7 capture-side sanitization divergence fixture, scenario, ledger entry, and load-bearing oracle checks for SEC-01/SEC-03**

## Performance

- **Duration:** 6 min
- **Started:** 2026-06-14T00:57:18Z
- **Completed:** 2026-06-14T01:03:42Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- Added `sanitize-corpus.html` with hostile snapshot rows plus always-on password plaintext for the reference side to carry and the extracted side to strip/mask.
- Added `sanitize-divergence.js` to drive post-snapshot `onclick`, `href="javascript:..."`, and benign class mutations in one deterministic batch.
- Added `D7-capture-sanitization` with a scenario guard first and exact same-index SNAPSHOT/MUTATIONS predicates.
- Wired the oracle matrix, D7 direction checks, zero-consultation exclusion, empty-ledger load-bearing test, and stale-entry coverage.

## Task Commits

Each task was committed atomically:

1. **Task 1: sanitize fixture and scenario** - `e831a18` (feat)
2. **Task 2 RED: failing D7 oracle coverage** - `6b7c6e1` (test)
3. **Task 2 GREEN: D7 ledger implementation** - `7167890` (feat)

_TDD note: RED failed as expected with `UNDECLARED DIVERGENCE sanitize-corpus.html/sanitize-divergence at message 1`; GREEN made the focused oracle and full suite pass._

## Files Created/Modified

- `tests/differential/fixtures/sanitize-corpus.html` - Frozen hostile corpus fixture with on* attrs, javascript: URLs, srcdoc iframe, object/embed, SVG xlink, hostile CSS, password value, and mutation targets.
- `tests/differential/scenarios/sanitize-divergence.js` - Scenario that keeps D7 real by exercising post-snapshot hostile attr mutations plus a benign comparator anchor.
- `tests/differential/divergence-ledger.js` - D7 mismatch entry and helper predicates for strict snapshot/mutation sanitization shapes.
- `tests/differential/oracle.test.js` - Matrix entry, D7 branch, direction checks, zero-consultation exclusion, and empty-ledger load-bearing test.

## Decisions Made

- D7 is a single mismatch entry, not separate snapshot and mutation entries, because the phase decision is one capture-side sanitization/masking divergence.
- The D7 mutation predicate requires the sanitize scenario's benign class anchor on both sides, so it does not excuse arbitrary attr mismatches.
- Existing stale-entry detection remains unchanged; D7 is proven by matching during the normal flipped matrix run.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## Known Stubs

None. Stub-pattern scan found only intentional neutralized empty-string assertions and existing identity-placeholder terminology; no unfinished placeholder data flow was introduced.

## Verification

- `node --test tests/differential/oracle.test.js` - pass, 34/34 tests.
- `npm test` - pass, 190/190 tests.
- `grep -c "D7-capture-sanitization" tests/differential/divergence-ledger.js tests/differential/oracle.test.js` - one match in each file.
- `grep -A 3 "appliesTo" tests/differential/divergence-ledger.js | grep -c "sanitize-divergence"` - `1`.
- Zero-consultation assertion message includes `pause-resume/text-childlist/sanitize-divergence`.

## TDD Gate Compliance

- RED gate present: `6b7c6e1` adds failing D7 oracle coverage.
- GREEN gate present after RED: `7167890` adds the D7 ledger entry and passes verification.
- No refactor commit was needed.

## Threat Flags

None. This plan adds test-only fixtures, scenarios, and oracle ledger coverage for the existing capture-to-reference trust boundary; it introduces no new endpoint, auth path, file access pattern, or schema surface.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

D7 is declared, exhibited, scoped, load-bearing, and stale-entry protected. Plan 03-05 can document the security contract against working SEC-01/SEC-03 oracle coverage.

---
*Phase: 03-security-pipeline-sanitization-privacy-masking*
*Completed: 2026-06-14*

## Self-Check: PASSED

- Files verified: `.planning/phases/03-security-pipeline-sanitization-privacy-masking/03-04-SUMMARY.md`, `tests/differential/fixtures/sanitize-corpus.html`, `tests/differential/scenarios/sanitize-divergence.js`.
- Commits verified: `e831a18`, `6b7c6e1`, `7167890`.
- Required verification already passed: `node --test tests/differential/oracle.test.js` and `npm test`.
