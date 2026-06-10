---
phase: 01-capture-core-extraction-differential-oracle
plan: 04
subsystem: testing
tags: [differential-testing, equivalence, divergence-ledger, transport-seam, loopback]

# Dependency graph
requires:
  - phase: 01-capture-core-extraction-differential-oracle
    plan: 03
    provides: src/capture/index.js createCapture behind the injected Transport seam (purity gate green)
provides:
  - Reference-vs-EXTRACTED structural op-stream equivalence proven on the full 10-pair fixture x scenario matrix (phase success criterion 1, complete)
  - createExtractedSide harness loader -- second JSDOM via the shared config factory, 12 audited globals swapped onto globalThis and restored unconditionally, flush-less loopback transport (phase success criterion 2 proven end-to-end)
  - normalizeExtracted -- loopback records to canonical {type, payload} with READY normalized to {} and unknown types failing loud
  - Finalized divergence ledger -- D1-resume-no-resnapshot (the ONLY mismatch entry, scenario-guarded) + D2/D3/D4/D5 documented-mappings
  - Stale-entry detection -- every mismatch-kind ledger entry must match a real divergence per run; D1 scope test proves the divergence is real (empty ledger throws)
  - Ref-vs-ref mode retained as the permanent harness self-test, ordered FIRST in the file
affects: [01-05 defense-tests, phase-3 sanitization, phase-6 fsb-adapter, phase-11 fsb-swap-in]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Record-then-swap ambient globals -- prior value AND presence captured per name; restore deletes names that did not exist instead of leaving undefined residue (Pitfall 8)
    - Single buildFixtureDom construction site for BOTH oracle sides (url, pretendToBeVisual, runScripts, virtualConsole, patchRects) so cross-instance drift is structurally impossible (Pitfall 6)
    - Ledger predicates parse canonicalized identity ordinals (SESSION_n/SNAPSHOT_n) -- fresh-vs-continued session structure is the D1 signal ordinal canonicalization deliberately preserves
    - Module-level matched-id Set accumulated across sequential node:test tests, consumed by the last-in-file stale-entry test

key-files:
  created: []
  modified:
    - tests/differential/harness.js
    - tests/differential/normalize.js
    - tests/differential/divergence-ledger.js
    - tests/differential/oracle.test.js

key-decisions:
  - "Extracted side gets a no-op logger (mirroring the reference side's FSB logger stub): identical quiet test conditions on both sides; wire-invisible since only transport.send output is compared"
  - "Raw (unbound) assignment of jsdom window functions onto globalThis verified safe empirically -- jsdom 29 window functions are own-property closures, so bare requestAnimationFrame/cancelAnimationFrame calls from the core work without binding"
  - "normalizeExtracted validates types against Object.values(STREAM) and throws unknown-extracted-type -- a corrupted loopback record fails loud instead of sliding into comparison"
  - "D1 case (c) implemented as ordinal comparison (ref ordinal > ext ordinal for session or snapshot) rather than hardcoded SESSION_2-vs-SESSION_1 so the entry covers any post-resume alignment the two extra reference messages can produce"

patterns-established:
  - "Flipped-pair capture: reference side runs to FULL completion before the extracted side is constructed, so the globalThis swap window never overlaps a live reference side (Pitfall 10)"
  - "documented-mapping ledger entries carry appliesTo() { return false; } -- never consulted by ledgerCovers, exempt from stale-entry detection, present purely as the machine-readable source for human divergence docs (D-03)"

requirements-completed: [CAPT-04, CAPT-01]

# Metrics
duration: 14min
completed: 2026-06-10
---

# Phase 1 Plan 04: Oracle Flip + Divergence Ledger Summary

**Differential oracle flipped to reference-vs-extracted and GREEN on all 10 fixture x scenario pairs through a flush-less loopback transport, with D1-resume-no-resnapshot as the single scenario-guarded mismatch entry, D2-D5 documented-mappings, a load-bearing D1 scope test (empty ledger throws), and stale-entry detection -- 37/37 full suite with the reference byte-identical**

## Performance

- **Duration:** ~14 min
- **Started:** 2026-06-10T04:37:00Z
- **Completed:** 2026-06-10T04:50:56Z
- **Tasks:** 2 (both executed as TDD: RED -> GREEN)
- **Files modified:** 4

## Accomplishments

- The phase exit bar is met: the extracted `src/capture/index.js` core emits a normalized stream **deep-equal to the unmodified FSB reference** on every matrix pair -- basic x [basic-mutations, mutation-burst, structural-ops, scroll, pause-resume], heavy-realistic x [snapshot-only, structural-ops], truncation-overflow x snapshot-only (patchRects), canvas x snapshot-only, dialog x dialog (dangerously)
- Nine of ten flipped pairs compare with **zero ledger consultations** (asserted per pair); only pause-resume consults the ledger, and only entry D1 matches -- the divergence surface is exactly as declared
- The Transport seam is proven end-to-end with a loopback that deliberately has NO flush property, exercising the optional-flush no-op default (CAPT-01's "emits through any injected Transport, proven with a loopback transport")
- D1 is provably load-bearing, not decorative: the same pause-resume stream pair that passes with the ledger throws `UNDECLARED DIVERGENCE basic.html/pause-resume at message 4` with an empty ledger (the reference's post-resume fresh-session SNAPSHOT)
- Stale-entry detection runs last in the file and asserts the accumulated matched-id set covers every mismatch-kind entry -- a dead ledger entry can never silently linger
- Globals discipline holds: the 12 audited ambient globals (window, document, Node, NodeFilter, MutationObserver, requestAnimationFrame, cancelAnimationFrame, CustomEvent, ShadowRoot, location, getComputedStyle, URL) are swapped per extracted side and restored unconditionally in a finally (presence-aware: previously-absent names are deleted, not left undefined); full suite (8 protocol + 27 oracle + 2 purity) green twice consecutively after the flipped runs
- Flipped truncation guard (truncated === true + equal missingDescendants on BOTH implementations) and flipped dialog guard (>= 1 dialog message on BOTH implementations) prevent identical-but-empty false confidence in the extracted core's defenses
- `reference/extension/dom-stream.js` remains byte-identical (frozen spec); `src/capture/index.js` needed ZERO fixes -- the Plan 01-03 extraction passed the full oracle on its first flipped run

## Task Commits

Each task was committed atomically (TDD: RED then GREEN):

1. **Task 1: Extracted-side harness loader + first flipped pair (RED)** - `76254f5` (test)
2. **Task 1: Extracted-side harness loader + first flipped pair (GREEN)** - `1b05ea4` (feat)
3. **Task 2: Full-matrix flip + meta-tests (RED)** - `f0d78ca` (test)
4. **Task 2: Divergence ledger finalization (GREEN)** - `a81dfe1` (feat)

_No REFACTOR commits: both GREEN implementations needed no cleanup pass._

## TDD Gate Compliance

Both tasks (`tdd="true"`) followed the gate sequence:

- Task 1: `test(01-04)` commit `76254f5` (RED -- oracle.test.js failed on the missing `createExtractedSide` export, exit 1 verified) precedes `feat(01-04)` commit `1b05ea4` (GREEN -- 14/14 oracle, 24/24 full suite)
- Task 2: `test(01-04)` commit `f0d78ca` (RED -- 25/27: flipped pause-resume failed `UNDECLARED DIVERGENCE at message 4` against the still-empty ledger, and stale-entry detection failed on zero mismatch entries) precedes `feat(01-04)` commit `a81dfe1` (GREEN -- 37/37 full suite)

## Files Created/Modified

- `tests/differential/harness.js` - `buildFixtureDom` shared factory extracted as the single JSDOM construction site for both sides; `createExtractedSide` (record-then-swap of the 12 audited globals, flush-less loopback transport, createCapture import, identical surface shape as the reference side, unconditional finally restore at close(), construction-failure restore path); header and runScenario JSDoc updated for dual-side use
- `tests/differential/normalize.js` - `normalizeExtracted` added: protocol-typed loopback records pass through with READY normalized to {} on both sides; unknown types throw `unknown-extracted-type`; `normalizeReference` verified already rest-spread (no manufactured `staleFlushCount: undefined` possible -- no fix needed)
- `tests/differential/divergence-ledger.js` - DIVERGENCES finalized: D1-resume-no-resnapshot (kind mismatch; scenario-guarded appliesTo permitting ref-only trailing, shifted-index type, and fresh-vs-continued identity-ordinal mismatch shapes; affectedMessages SNAPSHOT + OVERLAY + MUTATIONS) plus D2 envelope shape, D3 ready timing, D4 ping probe dropped, D5 request-overlay dropped (kind documented-mapping); module JSDoc documents kind semantics, stale-entry exemption, and the docs-derive-from-ledger direction (D-03); `placeholderOrdinal` helper parses canonicalized identity placeholders
- `tests/differential/oracle.test.js` - Dual-mode: ref-vs-ref matrix + guards + negative control retained FIRST; flipped matrix loop over all 10 pairs with memoized `captureFlippedPair` and per-scenario ledger-consultation assertions; flipped truncation + dialog guards; D1 scope test (empty ledger throws); stale-entry detection last in file; header rewritten for dual-mode

## Decisions Made

- **No-op logger for the extracted side:** the plan's literal call was `createCapture({ transport: loopback })`, which would use the default console-backed logger and spray ~100 lines of capture lifecycle logs into test output across 11 flipped runs. Passing `logger: { info() {}, warn() {}, error() {} }` mirrors the reference side's no-op FSB logger stub -- symmetric quiet test conditions, wire-invisible (only `transport.send` output is compared)
- **Unbound global assignment verified before use:** an empirical spike confirmed jsdom 29 window functions (requestAnimationFrame, cancelAnimationFrame, getComputedStyle) are own-property closures that work called bare off globalThis, and per-window constructors (MutationObserver, CustomEvent, URL) work detached -- so the harness assigns raw `win[name]` values per RESEARCH Pattern 2 with no binding layer
- **D1 case (c) as ordinal comparison, not hardcoded placeholders:** `refOrdinal > extOrdinal` for session or snapshot identity covers any alignment the reference's two extra post-resume messages can produce, instead of brittle SESSION_2/SESSION_1 string equality (in the current scenario shape only cases (a) and (b) actually fire -- the extra messages shift indices so same-type/different-identity alignments never occur -- but the predicate stays robust to scenario cadence changes)
- **normalizeExtracted validates types:** a Set of `Object.values(STREAM)` guards comparison from corrupted loopback records, symmetric with normalizeReference's unknown-action throw

## Deviations from Plan

None - plan executed exactly as written. (The no-op logger and predicate-robustness choices above fall inside the plan's discretionary implementation gaps; no scope, behavior, or file-set changes. `normalizeReference` required no fix -- Plan 01-01 already shipped the rest-spread mapping the plan asked to verify.)

## Known Stubs

None. The `appliesTo() { return false; }` bodies on D2-D5 are by-design, not stubs: documented-mapping entries are never consulted by `ledgerCovers` (the module JSDoc documents this), and they exist as the machine-readable source for human divergence docs per D-03.

## Threat Flags

None -- no new security-relevant surface. The dialog fixture under `runScripts: 'dangerously'` is unchanged from Plan 01-02 (T-01-01 mitigation intact); the sanitization gap remains preserved identically on both sides by design (T-01-03 accepted, Phase 3 SEC-01 owns the fix); no new packages installed (T-01-SC).

## Issues Encountered

- **Worktree base hash mismatch at spawn:** the orchestrator prompt specified base commit `16e76fb6852b...`, which does not exist; the real wave-3 tracking commit is `16e76fb948ba...` (same short prefix, "docs(phase-1): update tracking after wave 3"). Resolved by resetting to the verified full hash matching the intended short prefix and commit message. No impact on plan execution.
- None during the plan itself -- the extraction from Plan 01-03 passed the full flipped matrix on the first run with zero parity fixes needed.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Plan 01-05 (defense tests) has everything it needs: `createExtractedSide` exercises the loopback/optional-flush path, the globals swap-and-restore recipe is proven, and the fake-Date watchdog recipe applies via the same globalThis mechanism
- CAPT-04 is fully satisfied (ref-vs-extracted equivalence machine-checked end-to-end); CAPT-01's "emits through any injected Transport, proven with a loopback transport" is satisfied (REQUIREMENTS.md untouched -- orchestrator owns shared-artifact writes post-wave)
- Phase 11 (FSB swap-in) inherits a machine-checked wire-compatibility guarantee: every intentional divergence from the shipped FSB behavior is one of five ledger entries, with exactly one (D1) producing runtime differences, scoped to resume semantics
- Human-readable divergence documentation (when written) must derive from `tests/differential/divergence-ledger.js` -- the module JSDoc records this direction (D-03)

## Self-Check: PASSED

- All 4 modified files verified present on disk
- All 4 task commits verified in git log (76254f5, 1b05ea4, f0d78ca, a81dfe1)
- npm test: 37/37 green twice consecutively (8 protocol + 27 oracle + 2 purity); process exits cleanly
- Acceptance greps: createCapture imported from ../../src/capture/index.js; loopback has send and no flush; finally-based restore present; no unconditional staleFlushCount assignment; exactly one kind:'mismatch' entry with id D1-resume-no-resnapshot; OVERLAY in D1 affectedMessages; scenarioName guard present; 4x kind:'documented-mapping'; empty-ledger assertion present; stale-entry test last in file
- `git diff --exit-code -- reference/extension/dom-stream.js` exits 0 (frozen spec byte-identical); `src/capture/` untouched

---
*Phase: 01-capture-core-extraction-differential-oracle*
*Completed: 2026-06-10*
