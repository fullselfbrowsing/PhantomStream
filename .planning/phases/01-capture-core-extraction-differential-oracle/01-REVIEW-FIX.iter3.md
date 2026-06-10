---
phase: 01-capture-core-extraction-differential-oracle
fixed_at: 2026-06-10T11:25:00Z
review_path: .planning/phases/01-capture-core-extraction-differential-oracle/01-REVIEW.md
iteration: 2
findings_in_scope: 3
fixed: 3
skipped: 0
status: all_fixed
---

# Phase 1: Code Review Fix Report

**Fixed at:** 2026-06-10T11:25:00Z
**Source review:** .planning/phases/01-capture-core-extraction-differential-oracle/01-REVIEW.md
**Iteration:** 2

**Summary:**
- Findings in scope: 3 (fix_scope: critical_warning — IN-01 through IN-06 excluded)
- Fixed: 3
- Skipped: 0

The full suite was run after every fix. Baseline before fixes: 47/47 pass.
After WR-02 (which adds three tests): 50/50 pass. Final state: 50/50 pass on
Node v24.x. Parity-only constraint honored: the single change to
`src/capture/index.js` (WR-01) is exception containment around the host
`skipElement` predicate — wire-identical for every non-throwing predicate and
for the oracle's no-predicate default path, and the differential oracle stayed
green throughout. WR-02 and WR-03 are test-only commits.

## Fixed Issues

### WR-01: A throwing host `skipElement` predicate silently loses entire mutation batches and breaks the documented "only the factory may throw" contract

**Files modified:** `src/capture/index.js`
**Commit:** 4954893
**Applied fix:** Added try/catch containment inside the
`skipElementWithAncestors` walk exactly per the review suggestion: a throwing
predicate call is routed to the injected logger
(`'[DOM Stream] skipElement predicate failed'`) and the element is treated as
not-skipped (`return false`), so one bad predicate call can never crash
`start()` mid-serialization or lose a whole mutation batch in the rAF flush.
The one remaining direct call site (the serializer's own-element check,
formerly `skipElement(cl)`) was routed through a new exception-contained
helper `safeSkipElement` with the same containment contract — the
direct-check→`toRemove` / ancestor-check→`continue` two-step structure that
mirrors the reference is preserved unchanged. This matches the containment
style of the module's other two host seams (transport `safeSend`,
`overlayProvider`), restoring the documented "factory-time validation is the
only place the capture may throw" contract.

**Verification:** `node --check` clean; full suite 47/47 (then 50/50 after
WR-02) — containment is wire-invisible for non-throwing predicates, so oracle
parity held. The WR-02 test file's throwing-predicate test was additionally
run against the pre-fix core and FAILS there (batch lost, nothing logged),
proving the fix is load-bearing.

### WR-02: The ancestor-inclusive `skipElement` contract has zero committed test coverage — the new walk is dead code in the committed suite

**Files modified:** `tests/capture-skip.test.js` (new file)
**Commit:** 4625553
**Applied fix:** Committed a dedicated test file (the review's suggested
`tests/capture-skip.test.js` option) following the committed lifecycle-test
patterns (locally duplicated jsdom env setup/teardown, audited-globals swap,
settle cadence). Three tests pin the exact checklist from the finding:

1. **Snapshot exclusion + no nid stamping:** a ROOT-ONLY predicate
   (`el.id === 'host-overlay'`) excludes the subtree root, its descendants,
   and their text from the snapshot html; no `data-fsb-nid` is stamped on any
   live element of the skipped subtree; tracked content is captured and
   nid-stamped.
2. **Differ suppression + tracked content still streams:** attribute,
   characterData, and childList mutations inside the skipped subtree emit
   zero diff ops; a subsequent tracked-content mutation streams exactly one
   batch carrying the expected attr op and no leaked skipped-subtree op.
3. **Throwing predicate containment (pins WR-01):** a predicate that throws
   on a specific element never escapes `start()`, routes errors to the
   injected logger on both the serialization and diff paths, treats the
   element as not-skipped (still nid-stamped and streaming), and the batch
   containing both the poison op and an innocent op is emitted intact.

The file matches the `tests/*.test.js` glob in the npm test script, so it is
picked up automatically (suite count 47 → 50).

**Verification:** all three tests pass against the fixed core; run against
the pre-WR-01 core, tests 1–2 pass (the ancestor-inclusive behavior they pin
predates this iteration) and test 3 fails — exactly the load-bearing split
expected.

### WR-03: Tightened D1 predicate still silently absorbs a broken-pause regression — proven oracle blind spot in the exit-bar scenario

**Files modified:** `tests/differential/oracle.test.js`
**Commit:** 5210957
**Applied fix:** Added the review's suggested pause-containment assertion to
the flipped pause-resume matrix test, immediately after the existing
belt-and-braces post-resume assertion: the extracted stream must contain ZERO
MUTATIONS messages carrying an attr op with `val === 'during-pause'` (the
scenario's "missed by design / must NOT appear on the wire" mutation). The
optional refStream mirror and clause-(b) bounding were not taken — per the
review, the direct absence check is sufficient and simpler.

**Verification:** full suite 50/50 green. Load-bearing probe (not committed):
`pause()` was temporarily broken to leave the mutation observer connected —
the flipped pause-resume test then fails loudly with
`AssertionError: paused mutations never appear on the extracted wire (1 !== 0)`
while it previously compared green through D1 clauses (a)/(b) and satisfied
the existing post-resume assertion, exactly the blind spot the reviewer
proved. The probe edit was reverted before commit.

## Skipped Issues

None — all in-scope findings were fixed.

---

_Fixed: 2026-06-10T11:25:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 2_
