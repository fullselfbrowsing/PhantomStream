---
phase: 08-shadow-dom-iframes-fidelity-completion
plan: 09
subsystem: documentation-testing
tags: [shadow-dom, iframes, differential-oracle, security, playwright, node-test]

requires:
  - phase: 08-shadow-dom-iframes-fidelity-completion
    provides: Phase 8 shadowRoots, frames, value diffs, added styles, subtree recovery, and Playwright inject sync
provides:
  - Completed Phase 8 capture, renderer, architecture, security, and design-history documentation
  - Scenario-pinned differential oracle coverage for Phase 8 add styles, shadow/frame sidecars, value/shadow mutations, and subtree markers
  - Final green Phase 8 focused gate and green full `npm test`
affects: [CAPT-05, CAPT-06, CAPT-08, CAPT-09, CAPT-11, differential-oracle, security-static-gates]

tech-stack:
  added: []
  patterns:
    - Scenario-pinned D24 ledger predicates for Phase 8-only protocol divergence
    - Empty-sidecar normalization only for absent-vs-empty shadowRoots/frames fields
    - Renderer static sink allowlists pinned to sanitized template parse sites

key-files:
  created:
    - tests/differential/fixtures/phase8-fidelity.html
    - tests/differential/scenarios/phase8-protocol-extensions.js
    - .planning/phases/08-shadow-dom-iframes-fidelity-completion/08-09-SUMMARY.md
  modified:
    - src/capture/README.md
    - src/renderer/README.md
    - docs/ARCHITECTURE.md
    - docs/SECURITY.md
    - docs/DESIGN-HISTORY.md
    - tests/differential/normalize.js
    - tests/differential/divergence-ledger.js
    - tests/differential/oracle.test.js
    - tests/differential/harness.js
    - src/renderer/diff.js
    - tests/security-chokepoint-purity.test.js
    - tests/semantic-addressing.test.js

key-decisions:
  - "Full CSSOM capture remains Phase 9; Phase 8 docs describe only curated computed styles for add ops."
  - "D24 oracle allowances are mismatch-kind, scenario-pinned, and shape-pinned rather than broad normalization."
  - "Renderer template sinks for Phase 8 shadow/subtree HTML are allowed only where followed by sanitizeFragment."

patterns-established:
  - "Differential scenarios can define beforeStart(side) to install fixture state before capture.start()."
  - "Empty Phase 8 sidecars normalize only when extracted emits [] and the reference has no field."

requirements-completed: [CAPT-05, CAPT-06, CAPT-08, CAPT-09, CAPT-11]

duration: 39min
completed: 2026-06-15
---

# Phase 08 Plan 09: Documentation, Oracle, and Final Verification Summary

**Phase 8 fidelity behavior documented, D24 oracle allowances pinned to focused scenarios, and the complete test suite green**

## Performance

- **Duration:** 39 min
- **Started:** 2026-06-15T19:31:00Z
- **Completed:** 2026-06-15T20:10:22Z
- **Tasks:** 2
- **Files modified:** 14

## Accomplishments

- Updated capture, renderer, architecture, security, and design-history docs for open shadow roots, same-origin/cross-origin iframe policy, value diffs, curated add-op styles, subtree recovery, and `handleControl` / `requestSubtree`.
- Kept remaining limits explicit: closed shadow roots, cross-origin iframe content, media streams, and full CSSOM stylesheet-centric capture.
- Added a focused Phase 8 differential fixture/scenario plus narrow D24 ledger entries for add-op styles, truncation markers, non-empty shadow/frame sidecars, and live value/shadow mutations.
- Ran the final focused Phase 8 gate and full `npm test` successfully.

## Task Commits

Each task was committed atomically:

1. **Task 1: Update docs and differential oracle discipline** - `4d3c0c7` (docs)
2. **Task 2: Run the final Phase 8 automated gate** - `91b688a` (test)

Plan metadata is committed separately with this summary.

## Files Created/Modified

- `src/capture/README.md` - Documents Phase 8 capture surfaces and `handleControl(CONTROL.SUBTREE_REQUEST)`.
- `src/renderer/README.md` - Documents shadow/frame reconstruction, `DIFF_OP.VALUE`, `requestSubtree`, and `STREAM.SUBTREE_RESPONSE`.
- `docs/ARCHITECTURE.md` - Revises completed limitations and keeps CSSOM/closed-root/cross-origin/media limits explicit.
- `docs/SECURITY.md` - Documents new sanitization, masking, CSP, and sandbox boundaries.
- `docs/DESIGN-HISTORY.md` - Records curated batched add-op styles rather than full-property enumeration.
- `tests/differential/*` - Adds Phase 8 fixture/scenario, before-start harness hook, empty sidecar normalization, and D24 ledger entries.
- `tests/security-chokepoint-purity.test.js` - Pins sanitized Phase 8 template parse sinks.
- `tests/semantic-addressing.test.js` - Updates handle contract for `requestSubtree`.

## Decisions Made

- Normalized only absent-vs-empty `shadowRoots` / `frames` sidecars; non-empty sidecars remain real ledgered divergence.
- Used mismatch-kind D24 entries for Phase 8 intentional divergence so stale-entry detection proves each entry is exercised.
- Left `package.json` and `package-lock.json` unchanged; Playwright was not bumped.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Updated renderer static sink allowlist for Phase 8 template parsers**
- **Found during:** Task 1 verification
- **Issue:** `tests/security-chokepoint-purity.test.js` still allowed only the pre-Phase-8 renderer template sinks, failing on sanitized shadow/subtree template parsing.
- **Fix:** Pinned the exact Phase 8 `p.html` template parse sites in `diff.js` and `index.js`, and updated the adjacent `diff.js` comment.
- **Files modified:** `src/renderer/diff.js`, `tests/security-chokepoint-purity.test.js`
- **Verification:** `node --test tests/differential/oracle.test.js tests/node-identity-static.test.js tests/security-chokepoint-purity.test.js`
- **Committed in:** `4d3c0c7`

**2. [Rule 1 - Bug] Updated obsolete semantic handle assertion for requestSubtree**
- **Found during:** Task 2 full-suite verification
- **Issue:** `tests/semantic-addressing.test.js` still pinned the Phase 7 viewer handle and rejected the planned Phase 8 `requestSubtree` API.
- **Fix:** Added `requestSubtree` to the expected public handle keys.
- **Files modified:** `tests/semantic-addressing.test.js`
- **Verification:** `npm test`
- **Committed in:** `91b688a`

**Total deviations:** 2 auto-fixed (1 blocking static-gate update, 1 obsolete test assertion).
**Impact on plan:** Both fixes aligned existing gates with completed Phase 8 behavior without adding product scope.

## Issues Encountered

- The pre-existing oracle matrix failed after Phase 8 because empty `shadowRoots` / `frames` arrays were emitted on otherwise unchanged snapshots/add ops. This was handled as structural normalization only for empty arrays, while non-empty Phase 8 payloads remain ledgered.
- Add-op computed styles are an intentional Phase 8 divergence from the FSB reference; the D24 add-style predicate only matches batches that become reference-equivalent after removing extracted `style` attributes from add-op HTML.

## Verification

```bash
rg -n "shadow root|iframe|value diff|requestSubtree|subtree" src/capture/README.md src/renderer/README.md docs/ARCHITECTURE.md docs/SECURITY.md docs/DESIGN-HISTORY.md
rg -n "closed shadow|cross-origin iframe content|CSSOM" docs/ARCHITECTURE.md docs/SECURITY.md
node --test tests/differential/oracle.test.js tests/node-identity-static.test.js tests/security-chokepoint-purity.test.js
node --test tests/capture-shadow-dom.test.js tests/renderer-shadow-dom.test.js tests/capture-iframe.test.js tests/renderer-iframe.test.js tests/capture-input-values.test.js tests/renderer-value-diff.test.js tests/capture-added-styles.test.js tests/capture-subtree-fetch.test.js tests/renderer-subtree-fetch.test.js tests/playwright-fidelity-phase8.test.js
npm test
rg -n "allow-scripts|querySelector\\('\\[data-fsb-nid|data-fsb-nid" src/capture/index.js src/renderer/index.js src/renderer/diff.js src/adapters/playwright-inject.js
```

Results:

- Task 1 focused gate passed: 47 tests, 47 pass.
- Phase 8 focused gate passed: 37 tests, 37 pass.
- Full suite passed: 368 tests, 368 pass.
- Package files were not changed.
- Static identity/sandbox grep returned no matches.

## Known Stubs

None. Stub scan hits were intentional placeholder terminology for blocked, cross-origin, or truncated regions and existing identity-placeholder oracle wording.

## Threat Flags

None. The plan modified docs/tests and updated static gates for already-planned Phase 8 trust boundaries; no new runtime network, auth, file, or schema surface was introduced.

## Auth Gates

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Phase 8 is ready for orchestration-level completion. Phase 9 can plan CSSOM stylesheet-centric capture with explicit knowledge that Phase 8 intentionally stayed on curated computed styles for add ops.

## Orchestrator-Owned State

Per execution prompt, `.planning/STATE.md` and `.planning/ROADMAP.md` were not modified.

## Self-Check: PASSED

- Found `.planning/phases/08-shadow-dom-iframes-fidelity-completion/08-09-SUMMARY.md`.
- Found task commits `4d3c0c7` and `91b688a` in git history.
- Confirmed `.planning/STATE.md` and `.planning/ROADMAP.md` have no working-tree diffs.

---
*Phase: 08-shadow-dom-iframes-fidelity-completion*
*Completed: 2026-06-15*
