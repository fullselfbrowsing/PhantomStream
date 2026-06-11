---
phase: 02-renderer-core-embedded-loopback-mirror
fixed_at: 2026-06-11T19:05:00Z
review_path: .planning/phases/02-renderer-core-embedded-loopback-mirror/02-REVIEW.md
iteration: 1
findings_in_scope: 4
fixed: 4
skipped: 0
status: all_fixed
---

# Phase 2: Code Review Fix Report

**Fixed at:** 2026-06-11T19:05:00Z
**Source review:** .planning/phases/02-renderer-core-embedded-loopback-mirror/02-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 4 (1 critical, 3 warnings; fix_scope: critical_warning — the 4 Info findings were not touched)
- Fixed: 4
- Skipped: 0
- Test suite: 126/126 baseline → **130/130** after fixes (every fix commit left `npm test` fully green; the D6 ledger entry and `text-childlist` oracle scenario stayed green and load-bearing throughout)

## Fixed Issues

### CR-01: E2 text op flattens mixed-content targets, destroying live mirrored elements

**Status:** fixed: requires human verification (logic-bearing gate condition — see note)
**Files modified:** `src/capture/index.js`, `tests/renderer-loopback.test.js`, `src/capture/README.md`, `tests/differential/divergence-ledger.js`
**Commit:** f4705fc
**Applied fix:** Gated the E2 text-op emission on `sawBareTextNode && !m.target.firstElementChild` — the flattening `{op:'text'}` op is suppressed whenever the live target still has element children at flush time. The `textContent = '...'` shape (D6) keeps emitting (its element children were just removed, so the live read is null); mixed-content shapes revert to the reference's drop behavior (text drift, structure intact — strictly better than structural destruction). Added two end-to-end loopback regression tests pinning BOTH reviewer-probed shapes: (a) `mixed.appendChild(textNode)` on a mixed-content element — zero wire signal, mirrored `<span>` survives intact; (b) `rich.innerHTML = 'hello <b>world</b>'` — the `<b>` reaches the mirror and is never destroyed, no flattening text op for the target on the wire. Documented the residual gap (accepted mixed-content text drift, recoverable by snapshot/resync) in the E2 README entry and the D6 ledger rationale. The D6 predicate itself was NOT changed: the oracle fixture's `#intro` target is text-only, so the gate does not alter the divergence shape — verified by the stale-entry detection staying green (D6 still matches per run).

**Verification note:** The gate is a logic change, so per policy it is flagged for human confirmation — however, semantic correctness is pinned beyond syntax by the two new end-to-end regression tests (exact reviewer probe shapes), the pre-existing text-only loopback rows, the `text-childlist` oracle scenario, and D6 stale-entry detection, all green at 130/130. The human check reduces to confirming `!m.target.firstElementChild` (live read at flush time) is the intended gate.

### WR-01: One request can crash the demo server (unhandled read-stream error)

**Files modified:** `examples/serve.js`
**Commit:** c40253d
**Applied fix:** Added `stats.isFile()` rejection (404) after directory resolution so FIFOs/sockets cannot hang the response, and attached an `'error'` handler to the read stream (`stream.on('error', () => res.destroy())`) — headers are already sent at that point, so the socket is aborted instead of attempting a 500 body. Probe-verified in the worktree: a mode-000 file now aborts that one request (`curl` exit, http=000) while the **process survives**; normal files still serve 200 with correct MIME; directory-without-index still 404s. Pre-fix this exact probe was the reviewer's confirmed full-process `EACCES` crash.

### WR-02: Add-op parse-drop is silent — context-dependent elements vanish from the mirror with no self-heal signal

**Files modified:** `src/renderer/diff.js`, `tests/renderer-diff.test.js`, `src/renderer/README.md`
**Commit:** 8da3dd7
**Applied fix:** Took the counting fix (not the `<template>` rewrite, per the conservative option): when `m.html` parses to no element in the div context, the applier now emits a dedicated `logger.warn` naming the real cause and counts the drop through `recordStaleMiss(DIFF_OP.ADD, m.parentNid)`, so the ≥ 3 stale-miss threshold drives the existing `CONTROL.START` resync self-heal. Added a unit test pinning the behavior (jsdom-verified `<tr>`/`<td>`/`<tbody>` drops; one drop = 1 stale miss + dedicated warn, third accumulated miss fires `'stale-mutation-parent'` resync). Added the gap to `src/renderer/README.md` "Behavioral changes queued for Phase 3+" with the `<template>`-context parse as the queued proper fix. Note: the review listed `<option>` among dropped elements — empirically jsdom's div context DOES parse `<option>` (HTML "in body" insertion mode inserts it), so the test uses only verified-dropping tags.

### WR-03: `viewportWidth` interpolated raw into srcdoc markup — undocumented injection point in the future sanitizer chokepoint

**Files modified:** `src/renderer/snapshot.js`, `tests/renderer-snapshot.test.js`
**Commit:** d5ebb7f
**Applied fix:** Coerced at the insertion site: `(parseInt(p.viewportWidth, 10) || 1920)` — wire values can no longer break out of the meta attribute (numeric prefix survives; entirely non-numeric input falls back to 1920). Replaced the header's incomplete raw-insertion note with an explicit 5-entry wire-value insertion-point inventory (inlineStyles RAW, payload.html RAW, stylesheet hrefs quote-escaped, shell attrs escapeAttribute-escaped, viewportWidth numerically coerced) marked as the list the Phase 3 sanitization chokepoint audits, and updated the `buildSnapshotHtml` JSDoc to match. Added a test pinning both coercion paths (leading-digit breakout probe → numeric prefix only, no markup in the head; non-numeric probe → 1920 default, no `<script>` in the head). Note: the srcdoc contains only a width insertion — there is no height interpolation in `snapshot.js` (the `|| 1080` lives in `index.js` `updateScale`, which is scale math, not markup), so no height coercion was needed.

## Skipped Issues

None — all in-scope findings were fixed. The 4 Info findings (IN-01 through IN-04) were out of scope per `fix_scope: critical_warning` and were not touched.

---

_Fixed: 2026-06-11T19:05:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
