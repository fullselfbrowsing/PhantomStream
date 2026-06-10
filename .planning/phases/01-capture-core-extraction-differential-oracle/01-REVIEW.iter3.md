---
phase: 01-capture-core-extraction-differential-oracle
reviewed: 2026-06-10T09:09:47Z
depth: standard
files_reviewed: 24
files_reviewed_list:
  - .github/workflows/ci.yml
  - src/capture/README.md
  - src/capture/index.js
  - tests/capture-defenses.test.js
  - tests/capture-lifecycle.test.js
  - tests/capture-purity.test.js
  - tests/capture-watchdog.test.js
  - tests/differential/divergence-ledger.js
  - tests/differential/fixtures/basic.html
  - tests/differential/fixtures/canvas.html
  - tests/differential/fixtures/dialog.html
  - tests/differential/fixtures/generate-truncation-overflow.js
  - tests/differential/fixtures/heavy-realistic.html
  - tests/differential/harness.js
  - tests/differential/normalize.js
  - tests/differential/oracle.test.js
  - tests/differential/scenarios/basic-mutations.js
  - tests/differential/scenarios/dialog.js
  - tests/differential/scenarios/mutation-burst.js
  - tests/differential/scenarios/pause-resume.js
  - tests/differential/scenarios/scroll.js
  - tests/differential/scenarios/snapshot-only.js
  - tests/differential/scenarios/structural-ops.js
  - package.json
findings:
  critical: 0
  warning: 3
  info: 6
  total: 9
status: issues_found
---

# Phase 1: Code Review Report (iteration 2 — re-review after fixes)

**Reviewed:** 2026-06-10T09:09:47Z
**Depth:** standard
**Files Reviewed:** 24
**Status:** issues_found

## Summary

Re-reviewed the phase after the iteration-1 fix pass (commits 9db86b2, 47389f7,
4f283f9, e2c2213). All four prior Critical/Warning findings are verified
**fixed**:

- **CR-01 (iter 1) — VERIFIED FIXED, empirically on Node 20.** A real Node
  v20.19.0 binary was downloaded and the exact command npm runs
  (`sh -c 'node --test tests/*.test.js tests/differential/*.test.js'`) exits 0
  with 47/47 passing. The shell expands both globs to the six concrete test
  files before node sees them, so the script is Node-version-independent on
  POSIX shells; `npm test` on Node v24.14.1 also passes 47/47. The expansion
  covers exactly the six existing `*.test.js` files and cannot pick up
  `reference/tests/`. The committed lockfile satisfies CI's `npm ci` +
  `cache: npm`.
- **WR-01 (iter 1) — VERIFIED FIXED.** `skipElementWithAncestors`
  (`src/capture/index.js:248-256`) restores the reference's `closest()`
  containment: the serializer's direct-check→`toRemove` /
  ancestor-check→`continue` structure (lines 598-608) mirrors
  `reference/extension/dom-stream.js:416-424`, and the differ's three skip
  sites (lines 851, 855, 864) match the reference's three `isFsbOverlay` call
  sites (661, 665, 674). The no-host-predicate path short-circuits before any
  walk, so the default path is wire-identical. JSDoc and README both document
  the ancestor-inclusive contract.
- **WR-02 (iter 1) — VERIFIED FIXED for the resume-regression shapes.** The
  tightened D1 predicate requires fresh reference identity on every excused
  shape, restricts trailing ref-only messages to OVERLAY/MUTATIONS, and
  restricts the type-mismatch clause to ref SNAPSHOT/OVERLAY vs ext MUTATIONS
  continuing SESSION_1. The new broken-resume regression test was traced and
  is correct (a trailing ref SNAPSHOT now hard-fails). A residual blind spot
  remains for a different lifecycle regression — see WR-03 below, proven by
  probe.
- **WR-03 (iter 1) — VERIFIED FIXED and complete.** Zero occurrences of
  `fsbNid` remain anywhere in `src/`; all five differ sites read through
  `getAttribute(NID_ATTR)` with wire-equivalent null/absent semantics
  (verified: `getAttribute` null vs `dataset` undefined are both falsy at the
  `continue` guards, string values identical when present).

This re-review found **no Critical issues** and three new Warnings, all
clustered around the fixes' residual edges: the expanded host-predicate call
surface has no exception containment (proven to silently lose whole mutation
batches), the restored ancestor-inclusive contract has zero committed test
coverage, and the tightened D1 ledger still silently absorbs a broken-pause
regression (proven by probe: the leak compares green AND passes the new
belt-and-braces assertion). Prior Info findings IN-01..IN-04 were out of fix
scope and remain present; they are re-reported below plus two new Info items.

Verification performed beyond reading: full suite via `npm test` on Node
v24.14.1 (47/47); exact test command on a real Node v20.19.0 binary (47/47,
exit 0); line-level diff audit of all four fix commits against the reference
implementation's corresponding regions; two throwaway probes (not committed)
reproducing the WR-01 batch-loss and WR-03 oracle-blind-spot failure modes
end-to-end.

## Warnings

### WR-01: A throwing host `skipElement` predicate silently loses entire mutation batches and breaks the documented "only the factory may throw" contract

**File:** `src/capture/index.js:248-256` (unguarded predicate invocation in the walk), `:598`, `:606` (serializer), `:851-856`, `:864` (differ); violated contract at `src/capture/index.js:178-180` and `src/capture/README.md:26`; batch loss mechanics at `src/capture/index.js:936-939`

**Issue:** Follow-up to the iteration-1 WR-01 fix. The ancestor-inclusive walk
now invokes the host predicate on **every element plus its full ancestor
chain** (clone chain in the serializer, live chain up to `<html>` in the
differ) — a much larger and less predictable input surface than the old
per-element call — yet the invocation has no exception containment. This is
asymmetric with the module's other two host seams: `overlayProvider` errors
are swallowed (lines 1163-1171) and transport errors are routed to the logger
(lines 266-277), both per D-07.

Empirically reproduced with a realistic predicate bug
(`el.className.includes('host-overlay')` — `className` is an
`SVGAnimatedString` on SVG elements, so `.includes` is not a function once the
walk reaches an `<svg>` ancestor):

1. `start()` **throws to the host** mid-serialization, violating the
   documented contract "factory-time validation is the only place the capture
   may throw."
2. In the differ, a batch containing one mutation inside an SVG subtree and
   one innocent mutation on a plain `<div>` emitted **zero** MUTATIONS
   messages: `flushMutations` swaps `pendingMutations` out (line 936-937)
   before `processMutationBatch` throws, so the whole batch — innocent ops
   included — is lost. **`logger.error` was called zero times**; the throw
   escapes into the rAF callback (muted virtual console in jsdom; an uncaught
   page-context error in a real browser). On an SVG-heavy page this makes the
   mutation stream chronically lossy with no diagnostics.

**Fix:** Contain predicate errors at the single chokepoint, mirroring the
overlayProvider seam (wire-identical for non-throwing predicates, so oracle
parity is untouched):

```js
function skipElementWithAncestors(el) {
  if (!hostSkipElement) return false;
  var node = el;
  while (node) {
    try {
      if (hostSkipElement(node)) return true;
    } catch (e) {
      logger.error('[DOM Stream] skipElement predicate failed', e);
      return false; // treat as not-skipped; never crash the capture path
    }
    node = node.parentElement;
  }
  return false;
}
```

and wrap the one remaining direct `skipElement(cl)` call at line 598 the same
way (or route it through the guarded helper).

### WR-02: The ancestor-inclusive `skipElement` contract has zero committed test coverage — the new walk is dead code in the committed suite

**File:** `src/capture/index.js:248-256`, `:606`, `:851-856`, `:864` (untested branches); promised contract at `src/capture/README.md:29`

**Issue:** `skipElement` appears nowhere in `tests/` (verified by search). The
differential oracle's harness constructs the extracted side without a
predicate (`tests/differential/harness.js:233-239`), and
`skipElementWithAncestors` returns before the walk when no host predicate is
supplied — so **no committed test ever executes the ancestor walk, the
serializer's descendant-skip `continue`, or the differ's three
ancestor-inclusive skip sites**. The iteration-1 fix report itself states the
verifying jsdom probe was "throwaway... (not committed)." Meanwhile the README
now promises the behavior in bold ("Applied **ancestor-inclusively**...
excludes its whole subtree"). This codebase's own bar is explicit — the
transport contract notes "Enforced by test..., not just convention"
(`src/capture/README.md:44-45`) — and a future refactor that drops the
serializer `continue` or reverts a differ site to the non-inclusive form would
pass 47/47 while re-opening the original WR-01 host-UI wire leak.

**Fix:** Commit a unit test (e.g. in `tests/capture-lifecycle.test.js` or a
new `tests/capture-skip.test.js`) that creates a capture with a root-only
predicate (`el.id === 'host-overlay'`) over a fixture containing a host-UI
subtree, and asserts: (1) the subtree is absent from the snapshot html, (2) no
`data-fsb-nid` is stamped on live host-UI descendants, (3) attribute/text/
childList mutations inside the subtree emit no diff ops, and (4) tracked
content still streams. This is exactly the uncommitted probe's check list.

### WR-03: Tightened D1 predicate still silently absorbs a broken-pause regression — proven oracle blind spot in the exit-bar scenario

**File:** `tests/differential/divergence-ledger.js:110-132` (clauses a and b); belt-and-braces guard at `tests/differential/oracle.test.js:243-250`

**Issue:** Follow-up to the iteration-1 WR-02 fix, which closed the
broken-**resume** shapes. A broken-**pause** shape remains invisible: if
`pause()` fails to disconnect the observer, the during-pause mutation leaks
onto the extracted wire as an extra MUTATIONS(SESSION_1) message. Empirically
proven by probe against the real captured streams: the leaky pair aligns as
ref SNAPSHOT(S2) vs ext MUTATIONS(during, S1) → excused by clause (b); ref
OVERLAY(S2) vs ext MUTATIONS(after, S1) → excused by clause (b) again; ref
MUTATIONS(after, S2) trailing → excused by clause (a). `compareStreams`
returns green with only D1 matched, **and the new belt-and-braces assertion
also passes** (it requires exactly one after-resume MUTATIONS, which still
exists — it never asserts the during-pause mutation is absent, despite the
scenario documenting "must NOT appear on the wire,"
`tests/differential/scenarios/pause-resume.js:28-29`). The regression is
currently caught only by `tests/capture-lifecycle.test.js:196` ("no messages
while paused"), i.e. the differential oracle — the declared phase exit bar —
proves less about pause than it appears to.

**Fix:** One added assertion in the flipped pause-resume test closes it:

```js
// Pause containment: the during-pause mutation must never reach the wire.
const leaked = extStream.filter((msg) => msg.type === STREAM.MUTATIONS
  && Array.isArray(msg.payload.mutations)
  && msg.payload.mutations.some((op) => op.op === DIFF_OP.ATTR && op.val === 'during-pause'));
assert.equal(leaked.length, 0, 'paused mutations never appear on the extracted wire');
```

(Optionally mirror it for `refStream` in the ref-vs-ref pair; clause (b) of
the predicate could additionally be bounded to a single match per run, but the
assertion above is sufficient and simpler.)

## Info

### IN-01: Dead import — `RELAY_PER_MESSAGE_LIMIT_BYTES` imported only to be `void`ed (re-report from iteration 1)

**File:** `src/capture/index.js:38, 53`
**Issue:** Still present; out of iteration-1 fix scope. The constant is
imported and immediately discarded with `void`. The "keep in sync" rationale
is already structurally guaranteed in `src/protocol/constants.js`, where
`SNAPSHOT_BUDGET_BYTES` is derived from it.
**Fix:** Remove the import and the `void` statement; keep the explanatory comment.

### IN-02: Purity-gate comment stripper truncates executable code on lines containing `//` inside string literals (re-report from iteration 1)

**File:** `tests/capture-purity.test.js:31`
**Issue:** Still present. `/\/\/.*$/gm` treats the `//` in
`'http://www.w3.org/1999/xlink'` (`src/capture/index.js:656, 658`) as a
comment start and deletes the rest of those executable lines from the scanned
text; a hypothetical `chrome.*`/`FSB` reference later on such a line would
escape the gate.
**Fix:** Narrow the pattern (e.g. `/(^|[^:"'])\/\/.*$/gm`) or document the
known hole next to the regex.

### IN-03: Dialog relay keeps emitting after stop() — parity-faithful but undocumented in the standalone contract (re-report from iteration 1)

**File:** `src/capture/index.js:354-432` (listeners never removed, `dialogRelayActive` never reset), `:1171-1177` (`stop()`)
**Issue:** Still present. After `stop()`, the page-level interceptor and both
`document` listeners stay live, so native dialogs continue emitting
`STREAM.DIALOG` messages stamped with the stale session identity. Matches the
reference byte-for-byte, but `src/capture/README.md:53` describes `stop()`
without mentioning the residual channel.
**Fix:** One README line ("the dialog relay remains installed for the lifetime
of the page"), or queue teardown for the Phase 3 cleanup pass.

### IN-04: `resume()` before any `start()` streams with empty identity (re-report from iteration 1)

**File:** `src/capture/index.js:1199-1204`
**Issue:** Still present. Calling `resume()` on a never-started capture arms
the observer and scroll tracker and emits messages with
`streamSessionId: ''` / `snapshotId: 0`, which `isCurrentStream` accepts for
backward compatibility.
**Fix:** Guard `if (!streamSessionId) return;` (or a logger warning) at the
top of `resume()` — wire-invisible for the documented start-first contract.

### IN-05: skipElement docs no longer disclose clone-vs-live application — identity/live-state predicates silently diverge between snapshot and diff paths

**File:** `src/capture/README.md:29`; `src/capture/index.js:187-195`
**Issue:** The pre-fix README row stated "Applied to clone elements during
serialization and to mutation targets during diffing"; the rewritten row
dropped that disclosure. The serializer calls the predicate on **detached
clone** elements (line 598/606) while the differ calls it on **live**
elements — so a predicate relying on object identity (`el === myOverlayRoot`),
`el.isConnected`, or computed state matches in one path but not the other
(e.g. the overlay root would be captured in the snapshot yet have its
mutations dropped). The documented example (`el.id === 'my-overlay'`) is safe;
the constraint itself is no longer stated anywhere.
**Fix:** Restore one sentence in the README row and the `CaptureOptions`
JSDoc: "the predicate must rely only on attributes/structure preserved by
`cloneNode` — it is called on detached clones during serialization and on
live elements during diffing."

### IN-06: Test script's residual portability constraints — Windows cmd.exe and fixed two-level globs

**File:** `package.json:12`
**Issue:** The CR-01 fix is correct for the declared platforms (verified on
darwin and the exact ubuntu-CI semantics with a real Node 20.19.0 binary).
Two residual constraints worth a breadcrumb: (a) on Windows, npm scripts run
under cmd.exe, which does not expand globs — Node 21+ self-globs the literal
patterns, but Node 20 + Windows would fail with "Could not find"; (b) the
explicit two-level globs will silently omit any future test file nested
deeper than `tests/differential/` (e.g. a hypothetical
`tests/differential/scenarios/foo.test.js`).
**Fix:** No code change required for the declared platform matrix. Consider a
short comment in the README's Environment section noting POSIX-shell
assumption, and remember to extend the glob list if a deeper test directory
is ever added.

---

_Reviewed: 2026-06-10T09:09:47Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
