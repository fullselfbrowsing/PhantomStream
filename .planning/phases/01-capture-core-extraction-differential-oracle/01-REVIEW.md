---
phase: 01-capture-core-extraction-differential-oracle
reviewed: 2026-06-10T09:26:40Z
depth: standard
files_reviewed: 14
files_reviewed_list:
  - .github/workflows/ci.yml
  - src/capture/README.md
  - src/capture/index.js
  - tests/capture-defenses.test.js
  - tests/capture-lifecycle.test.js
  - tests/capture-purity.test.js
  - tests/capture-skip.test.js
  - tests/capture-watchdog.test.js
  - tests/differential/divergence-ledger.js
  - tests/differential/harness.js
  - tests/differential/normalize.js
  - tests/differential/oracle.test.js
  - tests/differential/scenarios/pause-resume.js
  - package.json
findings:
  critical: 0
  warning: 0
  info: 6
  total: 6
status: clean
---

# Phase 1: Code Review Report (iteration 3 — FINAL re-review)

**Reviewed:** 2026-06-10T09:26:40Z
**Depth:** standard
**Files Reviewed:** 14
**Status:** clean

## Summary

Final-iteration re-review after the iteration-2 fix pass (commits 4954893,
4625553, 5210957). All three iteration-2 Warnings are verified **fixed and
complete**, with no regressions introduced. No new Critical or Warning
findings. The remaining six Info items (IN-01..IN-06) are the accepted
out-of-scope backlog and are re-listed below unchanged — none escalated, none
resolved, none new.

**WR-01 (iter 2) — VERIFIED FIXED.** Predicate exception containment is now
complete at both seams. `skipElementWithAncestors`
(`src/capture/index.js:248-266`) wraps each `hostSkipElement(node)` call in
try/catch — errors route to the injected logger and the element is treated as
not-skipped, exactly the prescribed semantics. The new `safeSkipElement`
helper (`src/capture/index.js:277-284`) guards the serializer's direct-check
seam (`:627`). A grep audit proves **no unguarded predicate invocation
remains**: the only raw `skipElement(`/`hostSkipElement(` calls in `src/` are
inside the two guarded helpers; all five capture-path sites (`:627`, `:635`,
`:880`, `:884`, `:893`) route through them. Empirically probed beyond the
committed tests with an **always-throwing** predicate (worst case): `start()`
does not throw, the snapshot is still emitted with page content, the mutation
batch still flows (no batch loss at the `flushMutations` swap point), and
every predicate error reaches the logger. The no-host-predicate path
short-circuits before any try/catch, and the full oracle matrix stays green —
wire-identical for non-throwing predicates, so reference parity is untouched.

**WR-02 (iter 2) — VERIFIED FIXED.** `tests/capture-skip.test.js` (new, 3
tests) commits exactly the prescribed coverage, traced line-by-line against
the implementation: (1) a root-only predicate (`el.id === 'host-overlay'`)
excludes the whole subtree from the snapshot html with **no** `data-fsb-nid`
stamped on any live element of the skipped subtree, while tracked content is
captured and stamped; (2) all three mutation types (attribute on a
descendant, characterData on a deep text node, childList on the skipped root)
inside the skipped subtree emit zero diff ops while tracked content still
streams — pinning the differ's three ancestor-inclusive skip sites and the
serializer's descendant-skip `continue`, which were dead code in the
committed suite before; (3) a throwing predicate is contained — logged via
the injected logger, `start()` does not throw, the contained-error element
streams as not-skipped, and the batch carrying both the poison op and an
innocent op is emitted intact (the exact iteration-2 batch-loss shape). The
file follows the suite's established globals-swap/teardown discipline
(try/finally, stop-before-restore, presence-aware restoration) and is
process-isolated under `node --test`'s per-file processes; it is also
purity-gate-neutral. A future revert of the ancestor walk or a differ skip
site now fails committed tests instead of passing 47/47 silently.

**WR-03 (iter 2) — VERIFIED FIXED and load-bearing.** The flipped
pause-resume test now asserts the during-pause mutation never reaches the
extracted wire (`tests/differential/oracle.test.js:252-265`). Proven by probe
against real captured streams: driving the extracted side through the
pause-resume scenario with a **broken (no-op) pause**, (a) `compareStreams`
with the full ledger still returns green — the D1 clause-(a)/(b) blind spot
the iteration-2 review documented, (b) the pre-existing `postResume` count
assertion alone still passes (count 1), and (c) the new `leaked` filter finds
exactly the leaked `MUTATIONS(SESSION_1)` message carrying the
`'during-pause'` attr op — so `assert.equal(leaked.length, 0)` is the one
check that hard-fails the regression. The filter operates on identity-
canonicalized payloads whose mutation ops are untouched by canonicalization,
and `DIFF_OP.ATTR === 'attr'` matches the literal the differ emits. The
iteration-2 fix explicitly scoped the closure to this assertion (ledger-
predicate tightening was optional); with the assertion committed, the
declared exit-bar property — "paused mutations must NOT appear on the wire" —
is enforced by the differential suite itself.

**Regression check:** full suite passes 50/50 via `npm test` on Node v24.x
(47 prior tests + the 3 new skip-contract tests). The purity gate, transport-
containment, lifecycle, watchdog, and defense tests are unaffected by the new
code (no `chrome.*`/`FSB` references introduced; suite green). The CI
workflow, lockfile (`package-lock.json` present for `npm ci` + `cache: npm`),
and test script are unchanged from their iteration-1-verified state.
Intentional parity quirks (chars-as-bytes truncation budget, stop-path flush
asymmetry, on* sanitization gap owned by Phase 3, resume-no-resnapshot D1)
were not re-litigated per 01-CONTEXT.md.

Verification performed beyond reading: line-level diff audit of all three fix
commits; full-suite run (50/50); grep audit of every predicate call site in
`src/`; two throwaway probes (not committed, deleted after run) — a broken-
pause mutant driven end-to-end through the real harness/normalize/ledger
pipeline proving the new assertion trips where the ledger and the prior
assertion do not, and an always-throwing-predicate capture proving
containment end-to-end (no throw from `start()`, snapshot + mutation batch
intact, errors logged).

## Info

Accepted out-of-scope backlog (IN-01..IN-06, carried from iterations 1-2;
all still present, none escalated):

### IN-01: Dead import — `RELAY_PER_MESSAGE_LIMIT_BYTES` imported only to be `void`ed

**File:** `src/capture/index.js:38, 53`
**Issue:** Still present. The constant is imported and immediately discarded
with `void`; the "keep in sync" rationale is already structurally guaranteed
in `src/protocol/constants.js` where `SNAPSHOT_BUDGET_BYTES` derives from it.
**Fix:** Remove the import and the `void` statement; keep the comment.

### IN-02: Purity-gate comment stripper truncates executable code on lines containing `//` inside string literals

**File:** `tests/capture-purity.test.js:31`
**Issue:** Still present. `/\/\/.*$/gm` treats the `//` in
`'http://www.w3.org/1999/xlink'` (`src/capture/index.js:685, 687`) as a
comment start; a hypothetical `chrome.*`/`FSB` reference later on such a line
would escape the gate.
**Fix:** Narrow the pattern (e.g. `/(^|[^:"'])\/\/.*$/gm`) or document the
known hole next to the regex.

### IN-03: Dialog relay keeps emitting after stop() — parity-faithful but undocumented in the standalone contract

**File:** `src/capture/index.js:434-460` (listeners never removed,
`dialogRelayActive` never reset), `:1200-1206` (`stop()`)
**Issue:** Still present. After `stop()`, the page-level interceptor and both
`document` listeners stay live, so native dialogs continue emitting
`STREAM.DIALOG` stamped with the stale session identity. Matches the
reference; `src/capture/README.md` describes `stop()` without mentioning the
residual channel.
**Fix:** One README line, or queue teardown for the Phase 3 cleanup pass.

### IN-04: `resume()` before any `start()` streams with empty identity

**File:** `src/capture/index.js:1228-1233`
**Issue:** Still present. `resume()` on a never-started capture arms the
observer and scroll tracker and emits messages with `streamSessionId: ''` /
`snapshotId: 0`, which `isCurrentStream` accepts for backward compatibility.
**Fix:** Guard `if (!streamSessionId) return;` (or a logger warning) at the
top of `resume()` — wire-invisible for the documented start-first contract.

### IN-05: skipElement docs do not disclose clone-vs-live application — identity/live-state predicates silently diverge between snapshot and diff paths

**File:** `src/capture/README.md:29`; `src/capture/index.js:187-195`
**Issue:** Still present. The serializer calls the predicate on **detached
clone** elements (`:627`, `:635`) while the differ calls it on **live**
elements — a predicate relying on object identity, `el.isConnected`, or
computed state matches in one path but not the other. The documented example
(`el.id === 'my-overlay'`) is safe; the constraint is not stated.
**Fix:** One sentence in the README row and the `CaptureOptions` JSDoc: the
predicate must rely only on attributes/structure preserved by `cloneNode`.

### IN-06: Test script's residual portability constraints — Windows cmd.exe and fixed two-level globs

**File:** `package.json:12`
**Issue:** Still present (no change required for the declared platform
matrix). (a) On Windows + Node 20, npm scripts run under cmd.exe which does
not expand globs; (b) the explicit two-level globs will silently omit any
future test file nested deeper than `tests/differential/`.
**Fix:** Optional breadcrumb in the README Environment section noting the
POSIX-shell assumption; extend the glob list if a deeper test directory is
ever added.

---

_Reviewed: 2026-06-10T09:26:40Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
