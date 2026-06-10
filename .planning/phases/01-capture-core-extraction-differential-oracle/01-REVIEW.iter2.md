---
phase: 01-capture-core-extraction-differential-oracle
reviewed: 2026-06-10T05:08:09Z
depth: standard
files_reviewed: 23
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
findings:
  critical: 1
  warning: 3
  info: 4
  total: 8
status: issues_found
---

# Phase 1: Code Review Report

**Reviewed:** 2026-06-10T05:08:09Z
**Depth:** standard
**Files Reviewed:** 23
**Status:** issues_found

## Summary

Reviewed the Phase 1 capture-core extraction (`src/capture/index.js`), its four unit-test
suites, the full differential-oracle infrastructure (harness, normalize, divergence ledger,
oracle, 7 scenarios, 5 fixtures + generator), and the CI workflow.

Verification performed beyond reading:

- Line-by-line comparison of `src/capture/index.js` against
  `reference/extension/dom-stream.js`. The extraction is faithful: constants
  (`STYLE_DEFAULTS`, `CURATED_PROPS`, `SHELL_PROPS`, `URL_ATTRS`), the serializer
  (TreeWalker pairing, iframe/canvas branches, truncation passes 1/2), the differ, scroll
  tracker, and watchdog match the reference, with seams applied only where declared
  (transport, logger, overlayProvider, skipElement). Known reference quirks
  (chars-vs-bytes budget, stop-path flush without `staleFlushCount`, shell-only `on*`
  stripping) are preserved and documented per the parity-only decision — not flagged.
- Full test suite executed on Node v24.14.1: 46/46 pass.
- The committed 1.27 MB `truncation-overflow.html` fixture was rebuilt in memory from
  `generate-truncation-overflow.js` and is byte-identical (sha256
  `f5acb875...42ef7d8b` on both).
- `npm ci` dry-run succeeds against the committed lockfile; `actions/checkout@v6` and
  `actions/setup-node@v6` both exist upstream.
- **The `npm test` glob was executed against an actual Node v20.19.0 binary and fails
  (exit 1)** — this breaks the CI matrix's Node 20 leg on every push (CR-01).

One Critical finding (CI is structurally red on a claimed-supported engine), three
Warnings (an undocumented `skipElement` contract requirement with a host-UI wire-leak
consequence, an over-broad D1 ledger predicate that blinds the oracle inside the
pause-resume scenario, and a hardcoded `dataset.fsbNid` coupling that defeats the
`NID_ATTR` single-source-of-truth), and four Info items.

## Critical Issues

### CR-01: Node 20 CI matrix leg can never pass — `node --test` glob pattern is unsupported on Node 20

**File:** `.github/workflows/ci.yml:18` (matrix `node-version: [20, 22, 24]`) and `:26` (`npm test`); root cause in `package.json:12` (`"test": "node --test \"tests/**/*.test.js\""`)

**Issue:** Glob-pattern positional arguments to `node --test` were introduced in Node 21
and are not available on any Node 20.x release. Verified empirically against a real
Node v20.19.0 binary in this repo:

```
$ node --test "tests/**/*.test.js"
Could not find '/.../tests/**/*.test.js'
(exit code 1)
```

The CI workflow runs this exact command on the `node-version: 20` matrix leg
(setup-node resolves `20` to latest 20.x), so **every push and every PR fails CI**. This
directly contradicts the documented engine floor (`src/capture/README.md:99`: "Running
the test suite requires Node >= 20.19") and the workflow's own comment about the
"jsdom 29 engine floor matrix" (`ci.yml:17`). Note also the matrix never ran green —
treating CI as evidence of parity on Node 20 would be false confidence.

**Fix:** Use directory mode, which recursively discovers `*.test.js` on Node 20/22/24
identically (verified on v20.19.0: 46/46 pass):

```json
"scripts": {
  "test": "node --test tests/"
}
```

(Alternative: drop Node 20 from the matrix — but that contradicts the documented
README/jsdom engine floor, so fixing the script is the correct direction.)

## Warnings

### WR-01: `skipElement` drops the reference's ancestor-inclusive skip semantics — undocumented contract requirement; root-only predicates leak host UI onto the wire

**File:** `src/capture/index.js:569` (serializer), `src/capture/index.js:813-826` (differ); contract docs at `src/capture/README.md:29` and `src/capture/index.js:187-189`

**Issue:** The reference excluded host-overlay subtrees with two checks: a direct
`hasAttribute('data-fsb-overlay')` (→ remove) plus an ancestor-inclusive
`el.closest('[data-fsb-overlay]')` (→ skip descendants **without nid assignment**;
`reference/extension/dom-stream.js:266-276, 416-424`). The extraction collapses this to a
single per-element `skipElement(cl)` call. The planning artifact (01-03-SUMMARY.md)
acknowledges the host predicate must "handle containment itself" — but **neither the
README nor the JSDoc states this**. The published contract reads only "predicate marking
elements the host wants excluded from capture (its own UI)", which a host author will
naturally satisfy with a root-matching predicate (e.g. `el.id === 'my-overlay'`).

With a root-only predicate, behavior diverges from the reference in two concrete ways:

1. `serializeDOM` (line 569) removes only the overlay root from the clone, but the loop
   still processes the overlay's descendants: `assignNodeId(orig, cl)` (line 590) stamps
   `data-fsb-nid` onto **live host-UI descendants** and advances `nextNodeId`, drifting
   the nid sequence relative to the reference.
2. `processMutationBatch` (lines 813-826) then sees those nid-stamped host-UI elements as
   tracked targets: attribute/text/childList mutations inside the host's own UI are
   serialized and emitted as diff ops — host UI content (which the host explicitly asked
   to exclude) leaks over the transport, addressed at nids the viewer never received in
   the snapshot.

**Fix:** Either (a) document the requirement explicitly in both the README table row and
the `CaptureOptions.skipElement` JSDoc — "the predicate MUST return true for descendants
of skipped elements as well (ancestor-inclusive, like `closest`)" — or, more robustly,
(b) restore containment in the core so host predicates stay simple, e.g. in the
serializer loop:

```js
if (skipElement(cl)) { toRemove.push(cl); continue; }
// reference parity: descendants of a skipped subtree are skipped too,
// with NO nid assignment
if (cl.closest && toRemove.length && toRemove.indexOf(cl.closest('*')) /* ancestor check */) ...
```

(simplest faithful form: track skipped clone roots in a Set and `continue` when
`cl.closest` resolves inside one; mirror with an ancestor walk in
`processMutationBatch`). Option (b) is wire-identical for ancestor-inclusive predicates
and for the default predicate, so it does not disturb oracle parity.

### WR-02: D1 ledger predicate excuses any type mismatch and any trailing reference message throughout pause-resume — oracle blind spot in its own exit-bar scenario

**File:** `tests/differential/divergence-ledger.js:92-98` (clauses a and b of `appliesTo`)

**Issue:** Within the `pause-resume` scenario, clause (a) covers **every** case where the
reference stream has a trailing message the extracted stream lacks, and clause (b) covers
**every** same-index type mismatch. That is broader than D1's actual shape (exactly one
extra SNAPSHOT + one extra forced OVERLAY after resume, plus the resulting 2-index
shift). Consequence: a genuine extraction regression confined to pause-resume — e.g.
`resume()` failing to re-arm the observer so the post-resume MUTATIONS message never
emits, or the extracted side emitting the wrong message type after resume — produces
mismatches that D1 silently absorbs, and the differential oracle (the declared phase exit
bar) stays green. The regression would currently be caught only by
`tests/capture-lifecycle.test.js`, i.e. the oracle's coverage of this scenario is weaker
than it appears.

**Fix:** Tighten the predicate to D1's known shape. For example: clause (b) should accept
only `refMsg.type ∈ {SNAPSHOT, OVERLAY}` (the two known reference-extra messages), and
clause (a) should accept at most two trailing reference messages of those types. As a
belt-and-braces guard, the oracle's pause-resume test could additionally assert the
extracted stream contains a post-resume MUTATIONS message carrying `SESSION_1` identity
(the thing D1 says must still happen).

### WR-03: Node identity read via hardcoded `dataset.fsbNid` in five places defeats the `NID_ATTR` single source of truth

**File:** `src/capture/index.js:828, 833, 848, 854, 874`

**Issue:** Serialization paths consistently use the imported protocol constant
(`NID_ATTR`, lines 305-308, 598, 680, 689, 709, 727), but the entire differ reads node
identity through `m.target.dataset.fsbNid` — a hardcoded camelCase mirror of
`'data-fsb-nid'` with no compile-time or runtime link to the constant.
`src/protocol/messages.js:46-51` presents `NID_ATTR` as the canonical key ("Every diff
op ... addresses nodes by this key"). If that constant is ever changed (it is the
published knob), the failure mode is silent and total: every `dataset.fsbNid` read
returns `undefined`, all four diff-op paths hit their `continue` guards ("not tracked"),
and the mutation stream goes permanently empty with zero errors — snapshots keep working,
making the breakage hard to attribute. This is a parity-faithful port of the reference's
own inconsistency, but in the reference both spellings were file-local literals; the
extraction made one of them an imported cross-module constant, creating the desync trap.

**Fix:** Wire-identical refactor — read through the constant:

```js
var targetNid = (m.target.getAttribute && m.target.getAttribute(NID_ATTR)) || null;
```

or derive the dataset key once from `NID_ATTR`:

```js
var NID_DATASET_KEY = NID_ATTR.slice(5).replace(/-([a-z])/g, function (_, c) { return c.toUpperCase(); }); // 'fsbNid'
```

Either form emits byte-identical diffs today (same attribute), so oracle parity is
unaffected.

## Info

### IN-01: Dead import — `RELAY_PER_MESSAGE_LIMIT_BYTES` imported only to be `void`ed

**File:** `src/capture/index.js:38, 53`
**Issue:** The constant is imported and immediately discarded with `void`. The stated
"keep in sync" rationale is already structurally guaranteed inside
`src/protocol/constants.js`, where `SNAPSHOT_BUDGET_BYTES` is derived from it.
**Fix:** Remove the import and the `void` statement; keep the explanatory comment on
`SNAPSHOT_BUDGET_BYTES` if desired.

### IN-02: Purity-gate comment stripper truncates executable code on lines containing `//` inside string literals

**File:** `tests/capture-purity.test.js:31`
**Issue:** `/\/\/.*$/gm` treats the `//` in
`'http://www.w3.org/1999/xlink'` (`src/capture/index.js:620, 622`) as a comment start and
deletes the rest of those executable lines from the scanned text. A hypothetical
`chrome.*`/`FSB` reference appearing later on such a line would escape the gate.
**Fix:** Narrow the pattern to not fire after a URL scheme (e.g.
`/(^|[^:"'])\/\/.*$/gm`) or strip strings before comments; alternatively document the
known hole next to the regex.

### IN-03: Dialog relay keeps emitting after stop() (parity-faithful, but undocumented in the standalone contract)

**File:** `src/capture/index.js:377-403` (listeners never removed, `dialogRelayActive` never reset), `:1130-1136` (`stop()`)
**Issue:** After `stop()`, the page-level interceptor and the two `document` listeners
remain live, so native dialogs continue to emit `STREAM.DIALOG` messages stamped with the
stale (stopped) session identity. This matches the reference byte-for-byte, so it is not
an extraction bug — but `src/capture/README.md:53` describes `stop()` as halting
observers without mentioning this residual channel, and a standalone-framework host has
no FSB context to infer it from.
**Fix:** Add one line to the README's `stop()` bullet ("the dialog relay remains
installed for the lifetime of the page"), or queue listener teardown for the Phase 3
sanitization/cleanup pass.

### IN-04: `resume()` before any `start()` streams with empty identity

**File:** `src/capture/index.js:1158-1163`
**Issue:** Calling `resume()` on a never-started capture arms the observer and scroll
tracker and emits messages with `streamSessionId: ''` / `snapshotId: 0`.
`isCurrentStream` accepts empty-identity messages for backward compatibility, so a viewer
would apply diffs that have no corresponding snapshot.
**Fix:** Cheap guard: `if (!streamSessionId) return;` (or route a logger warning) at the
top of `resume()` — wire-invisible for the documented start-first contract.

---

_Reviewed: 2026-06-10T05:08:09Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
