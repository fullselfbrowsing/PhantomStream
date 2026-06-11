---
phase: 02-renderer-core-embedded-loopback-mirror
plan: 01
subsystem: renderer
tags: [renderer, snapshot, diff, parity, srcdoc, nid, tdd]

# Dependency graph
requires:
  - phase: 01-capture-core-extraction-differential-oracle
    provides: src/protocol/messages.js (NID_ATTR, DIFF_OP, SnapshotPayload typedef) and the jsdom test conventions (local setupEnv duplication, VirtualConsole)
provides:
  - Pure snapshot HTML builder (escapeAttribute, buildShellAttributeString, buildSnapshotHtml) producing the exact reference srcdoc wrapper
  - Document-parameterized diff applier (applyMutations) with parity miss accounting and resync thresholds
  - 23 unit tests pinning both contracts (11 snapshot, 12 diff)
affects: [02-03 createViewer wiring, 02-04 renderer README divergence ledger, phase-3 sanitization chokepoints]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Document-parameterized seam (jsdom 29 never parses srcdoc; unit targets are createHTMLDocument documents)
    - Injected hooks object ({ logger, requestResync }) keeps the resync latch out of the pure applier

key-files:
  created:
    - src/renderer/snapshot.js
    - src/renderer/diff.js
    - tests/renderer-snapshot.test.js
    - tests/renderer-diff.test.js
  modified: []

key-decisions:
  - "Stale-miss resync reason collapses to 'stale-mutation-parent' for all four op types (plan contract; the reference fed two event labels into one counter)"
  - "diff.js switches on DIFF_OP.* constants instead of the reference's op string literals (Shared Pattern 2: protocol imports, never redefinitions)"
  - "renderer-diff tests duplicate setupEnv locally but omit the globals swap: applyMutations dereferences only the injected Document, which is the seam under test"

patterns-established:
  - "Pure transform + injected Document: renderer logic provable in jsdom without an iframe"
  - "Counters mutated in place ({ staleMisses, applyFailures }); caller resets per snapshot and owns the latch"

requirements-completed: [VIEW-01]

# Metrics
duration: ~12min
completed: 2026-06-11
---

# Phase 2 Plan 01: Snapshot Builder + Diff Applier Summary

**Reference-parity srcdoc builder and Document-parameterized add/rm/attr/text diff applier extracted from dashboard.js as pure modules, pinned by 23 unit tests with parity resync thresholds (3 stale misses / 2 apply failures / batch fail immediate).**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-06-11T17:03:50Z
- **Completed:** 2026-06-11T17:15:30Z
- **Tasks:** 2/2
- **Files modified:** 4 created

## Accomplishments

- `buildSnapshotHtml(payload)` reproduces the reference srcdoc assembly byte-for-byte in structure: doctype + shell attrs, charset meta, viewport meta (`width=1920` default), stylesheet links with only double quotes escaped, RAW inline styles, the exact 02-UI-SPEC parity reset CSS, RAW body html
- `buildShellAttributeString` verbatim port keeps the security-relevant drops (style key, on*-prefixed names, the `/^[a-z][a-z0-9_:.~-]*$/` name filter, null/undefined values) — threat T-02-02 mitigation pinned by tests
- `applyMutations(doc, mutations, counters, hooks)` applies all four op types against ANY injected Document with per-op failure containment: one bad op never aborts the batch
- Parity thresholds verified by tests: >=3 stale misses fire `requestResync('stale-mutation-parent')`, >=2 apply failures fire `'dom-mutation-apply-failed'`, a whole-batch failure fires `'dom-mutation-batch-failed'` immediately
- Full suite green: 73/73 tests (50 pre-existing + differential oracle + 23 new), zero regressions

## Task Commits

Each task was committed atomically (TDD: RED test commit, then GREEN feat commit):

1. **Task 1: Port the pure snapshot HTML builder** - `0b6eb85` (test, RED) + `467fc06` (feat, GREEN)
2. **Task 2: Port the Document-parameterized diff applier** - `941c25e` (test, RED) + `7704764` (feat, GREEN)

No refactor commits — both ports are behaviorally verbatim by design; nothing to clean up post-GREEN.

## Files Created/Modified

- `src/renderer/snapshot.js` - Pure ESM module (zero DOM access): `escapeAttribute`, `buildShellAttributeString`, `buildSnapshotHtml`; ports dashboard.js:2671-2694 and :2785-2800
- `src/renderer/diff.js` - `applyMutations` Document-parameterized applier; ports dashboard.js:3209-3356 with FSB transport-event calls dropped in favor of `[Renderer]`-prefixed `hooks.logger.warn` + counters
- `tests/renderer-snapshot.test.js` - 11 pure string-assertion tests (no JSDOM) pinning the builder output, escaping rules, and the raw-insertion parity pins
- `tests/renderer-diff.test.js` - 12 jsdom tests against `createHTMLDocument` targets pinning ops, counters, thresholds, containment, and NID_ATTR addressing

## Decisions Made

- Stale-miss resync reason is `'stale-mutation-parent'` for all op types per the plan contract (acceptance requires each reason string exactly once in diff.js); the reference's separate `stale-mutation-target` label was an FSB diagnostics distinction feeding the same counter
- diff.js switch cases use `DIFF_OP.ADD/REMOVE/ATTR/TEXT` rather than the reference's `'add'/'rm'/'attr'/'text'` literals — Shared Pattern 2 (protocol imports, never redefinitions)
- `hooks`/`counters` get defensive `||` defaulting per the cross-runtime style so a missing hook degrades to a no-op rather than throwing inside the message loop

## Deviations from Plan

None - plan executed exactly as written. One documented simplification within task scope: `tests/renderer-diff.test.js` duplicates the setupEnv/teardown helpers locally per the parallel-safe convention but omits the AUDITED_GLOBALS swap from the capture-skip recipe, because `applyMutations` dereferences no ambient globals — the injected-Document seam is precisely what the tests prove. The file-top comment records this.

## Issues Encountered

None. The only mid-task correction: the diff.js file-top provenance comment initially mentioned the reference's parent/target stale-miss label pair by their literal strings, which violated the "each resync reason appears exactly once" acceptance criterion; reworded before the GREEN commit.

## Known Stubs

None — both modules are fully implemented with no placeholder values or unwired data paths. The RAW insertion of `inlineStyles` and `payload.html` in `buildSnapshotHtml` is not a stub: it is the parity-locked behavior (threat register T-02-01/T-02-03, disposition accept-this-phase), with the sanitization chokepoint owned by Phase 3 (SEC-01/SEC-02) and documented in the module's provenance comment.

## Next Phase Readiness

- Plan 02-03 (`createViewer`) can wire both contracts as-is: `buildSnapshotHtml` for the iframe srcdoc write, `applyMutations` with the viewer-owned resync latch injected as `hooks.requestResync`
- Counters reset-per-snapshot and the resync latch remain createViewer responsibilities (explicitly out of diff.js scope, per the plan's division of responsibility)
- Plan 02-04's divergence ledger should record: FSB transport-event drops, the single stale-miss reason collapse, and the Pitfall-9 raw-style parity pin

## Self-Check: PASSED

- `src/renderer/snapshot.js` — FOUND
- `src/renderer/diff.js` — FOUND
- `tests/renderer-snapshot.test.js` — FOUND
- `tests/renderer-diff.test.js` — FOUND
- Commit `0b6eb85` — FOUND
- Commit `467fc06` — FOUND
- Commit `941c25e` — FOUND
- Commit `7704764` — FOUND
- `node --test tests/renderer-snapshot.test.js tests/renderer-diff.test.js` — 23/23 pass
- `npm test` — 73/73 pass
