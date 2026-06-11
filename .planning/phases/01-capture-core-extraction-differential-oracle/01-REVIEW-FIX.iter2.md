---
phase: 01-capture-core-extraction-differential-oracle
fixed_at: 2026-06-10T08:56:52Z
review_path: .planning/phases/01-capture-core-extraction-differential-oracle/01-REVIEW.md
iteration: 1
findings_in_scope: 4
fixed: 4
skipped: 0
status: all_fixed
---

# Phase 1: Code Review Fix Report

**Fixed at:** 2026-06-10T08:56:52Z
**Source review:** .planning/phases/01-capture-core-extraction-differential-oracle/01-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 4 (fix_scope: critical_warning — IN-01 through IN-04 excluded)
- Fixed: 4
- Skipped: 0

The full suite was run after every fix. Baseline before fixes: 46/46 pass.
After WR-02 (which adds one test): 47/47 pass. Final state: 47/47 pass on
Node v24.14.1. Parity-only constraint honored: every change to
`src/capture/index.js` is wire-identical for the oracle's default-predicate
scenarios, and the differential oracle stayed green throughout.

## Fixed Issues

### CR-01: Node 20 CI matrix leg can never pass — `node --test` glob pattern is unsupported on Node 20

**Files modified:** `package.json`
**Commit:** 9db86b2
**Applied fix:** Changed the test script from `node --test "tests/**/*.test.js"`
(node-side glob, Node 21+ only) to
`node --test tests/*.test.js tests/differential/*.test.js`.

**Adaptation from review suggestion:** the reviewer's proposed
`node --test tests/` (directory mode) was verified to FAIL on the local
Node v24.14.1 (`Error: Cannot find module '.../tests'` — Node 21+ treats
positional args as glob patterns and tries to execute the matched directory
as a module), so it would have broken the Node 22/24 matrix legs while fixing
the Node 20 leg. The applied form uses shell glob expansion instead: the
shell (sh on ubuntu CI and darwin dev) expands both globs to the six concrete
test-file paths before node runs, which every Node version with `--test`
accepts. Verified 46/46 on Node v24.14.1; the expansion covers exactly the
six existing test files and can never pick up `reference/tests/`. No Node 20
binary was available locally — the Node 20 leg relies on explicit-file-path
semantics (supported since `--test` was introduced in Node 18) and should be
confirmed by the next CI run.

### WR-01: `skipElement` drops the reference's ancestor-inclusive skip semantics

**Files modified:** `src/capture/index.js`, `src/capture/README.md`
**Commit:** 47389f7
**Applied fix:** Option (b) from the review — restored containment in the
core so root-only host predicates work like the reference's
`closest('[data-fsb-overlay]')` handling:

- Added `skipElementWithAncestors(el)` to the factory closure: walks
  `el` and its `parentElement` chain calling the host predicate; returns
  false immediately (no walk, no predicate call) when the host supplied no
  predicate, so the default path is wire- and perf-identical to before.
- Serializer: after the existing direct `skipElement(cl)` check (root →
  `toRemove`), descendants of a skipped root now `continue` with NO node-id
  assignment — mirroring reference `dom-stream.js:416-424` structure exactly.
- Differ (`processMutationBatch`): the three skip sites (element target,
  text-node parent, added node) now use the ancestor-inclusive form,
  mirroring the reference's `isFsbOverlay` call sites.
- Documented the ancestor-inclusive contract in the `CaptureOptions.skipElement`
  JSDoc and the README option-table row.

**Verification beyond the suite:** oracle scenarios don't exercise
`skipElement`, so a throwaway jsdom probe (not committed) verified the
restored contract with a root-only predicate (`el.id === 'my-overlay'`):
skipped subtree absent from the snapshot, no `data-fsb-nid` stamped on live
host-UI descendants, no diff leakage for attribute/text/childList mutations
inside the skipped subtree, and tracked content still captured and streamed.
All 5 checks passed; full suite 46/46 after the change.

### WR-02: D1 ledger predicate excuses any type mismatch and any trailing reference message throughout pause-resume

**Files modified:** `tests/differential/divergence-ledger.js`, `tests/differential/oracle.test.js`
**Commit:** 4f283f9
**Applied fix:** Tightened `D1-resume-no-resnapshot.appliesTo` to D1's exact
empirically-confirmed shape (healthy mismatches are: index k — ref
SNAPSHOT(fresh identity) vs ext MUTATIONS(SESSION_1); then ref-only trailing
OVERLAY(fresh) and MUTATIONS(fresh)):

- All excused shapes now require the reference message to carry the FRESH
  post-resume identity (placeholder ordinal >= 2) — a ref message still on
  SESSION_1/SNAPSHOT_1 is never a D1 artifact and is never excused.
- Clause (a) (ref-only trailing): only `OVERLAY` or `MUTATIONS` types. A
  trailing `SNAPSHOT` means the extracted side failed to emit its post-resume
  MUTATIONS (e.g. observers not re-armed) and now hard-fails.
- Clause (b) (type mismatch): only ref `SNAPSHOT`/`OVERLAY` (fresh identity)
  aligned against ext `MUTATIONS` that continues the ORIGINAL session
  (SESSION_1/SNAPSHOT_1). Wrong extracted message types after resume now
  hard-fail.
- Clause (c) (same-type fresh-vs-continued identity) kept as the documented
  D-02 signal.
- Oracle additions: (1) belt-and-braces assertion in the flipped pause-resume
  test that the extracted stream carries exactly one post-resume MUTATIONS
  (SESSION_1, `data-phase="after-resume"` attr op); (2) new test proving a
  synthesized broken resume (post-resume MUTATIONS removed from the extracted
  stream) throws UNDECLARED DIVERGENCE — placed before the stale-entry test,
  which must remain last.

**Verification beyond the suite:** throwaway probes (not committed) confirmed
the healthy pair still matches D1 (stale-entry detection green), and that
three regression shapes now fail loudly: missing post-resume MUTATIONS,
wrong message type after resume, and the extracted side wrongly minting a
fresh SESSION_2 identity. Suite: 47/47.

### WR-03: Node identity read via hardcoded `dataset.fsbNid` in five places

**Files modified:** `src/capture/index.js`
**Commit:** e2c2213
**Applied fix:** All five differ sites (`parentNid`, `beforeNid`, removed-node
`nid`, `targetNid`, `textNid`) now read through the imported protocol
constant: `el.getAttribute ? el.getAttribute(NID_ATTR) : null` (with the
`|| null` shape preserved on `beforeNid`). Zero occurrences of
`dataset.fsbNid` remain in `src/capture/index.js`. Wire-identical today
(same attribute, same string values, absent reads are falsy in both forms);
the oracle stayed green (47/47), confirming byte-identical diffs.

## Commits

| Finding | Commit | Files |
|---------|--------|-------|
| CR-01 | 9db86b2 | package.json |
| WR-01 | 47389f7 | src/capture/index.js, src/capture/README.md |
| WR-02 | 4f283f9 | tests/differential/divergence-ledger.js, tests/differential/oracle.test.js |
| WR-03 | e2c2213 | src/capture/index.js |

---

_Fixed: 2026-06-10T08:56:52Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
