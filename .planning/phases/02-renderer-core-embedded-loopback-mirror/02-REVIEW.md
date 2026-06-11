---
phase: 02-renderer-core-embedded-loopback-mirror
reviewed: 2026-06-11T21:14:46Z
depth: standard
files_reviewed: 16
files_reviewed_list:
  - examples/loopback-mirror.html
  - examples/loopback-transport.js
  - examples/serve.js
  - src/capture/README.md
  - src/capture/index.js
  - src/renderer/README.md
  - src/renderer/diff.js
  - src/renderer/index.js
  - src/renderer/overlays.js
  - src/renderer/snapshot.js
  - tests/renderer-diff.test.js
  - tests/renderer-loopback.test.js
  - tests/renderer-snapshot.test.js
  - tests/differential/divergence-ledger.js
  - tests/differential/oracle.test.js
  - tests/differential/scenarios/text-childlist.js
findings:
  critical: 0
  warning: 0
  info: 6
  total: 6
status: clean
---

# Phase 2: Code Review Report (iteration 2 — fix verification)

**Reviewed:** 2026-06-11T21:14:46Z
**Depth:** standard
**Files Reviewed:** 16
**Status:** clean (info-only backlog remains)

## Summary

Re-review after the iteration-1 fix pass (CR-01, WR-01, WR-02, WR-03). All
four fixes were verified as correct and complete — three by executable probe,
all four against their pinned tests — and no new Critical or Warning defects
were found. Full suite re-run during review: **130/130 pass**
(`node --test tests/*.test.js tests/differential/*.test.js`).

### Fix verification

**CR-01 (mixed-content flattening) — FIXED, verified by test + fresh probe.**
The gate at `src/capture/index.js:974`
(`if (sawBareTextNode && !m.target.firstElementChild)`) closes BOTH
iteration-1 probe shapes, and both are now pinned end-to-end:

- Shape A (`appendChild(textNode)` into a mixed container) — pinned at
  `tests/renderer-loopback.test.js:469`: zero wire signal, mirrored span
  survives intact.
- Shape B (`innerHTML = 'hello <b>world</b>'`) — pinned at
  `tests/renderer-loopback.test.js:522`: the `<b>` add op applies, no
  flattening text op is ever emitted for the mixed target.

Beyond the pinned shapes, the gate was probed against the two intra-batch
interleavings where the target's element-children state CHANGES between the
mutation and the flush (the gate reads the flush-time live DOM, so these are
the only places it could mis-decide):

- **Mixed → empty inside one batch** (`box.appendChild(text)` then
  `box.removeChild(span)`): the gate sees empty and EMITS. Probe-verified
  convergent: the text op carries the flush-time live text, the mirror ends
  byte-identical to the live target, and the trailing `rm` for the
  already-flattened span lands as a *counted, warned* stale miss (feeds the
  self-heal threshold — conservative direction, never silent). See IN-05.
- **Empty → mixed inside one batch** (`box.textContent = 'x'` then
  `box.appendChild(em)`): the gate sees mixed and SUPPRESSES. Probe-verified:
  the `em` add op applies, mirror structure intact, residual is text-only
  drift — exactly the documented residual class.

There is **no remaining shape where mixed-content drift is silent AND
unaccounted**: every suppression path is the documented residual (text drift,
structure intact — `src/capture/README.md` entry E2 and the D6 ledger
rationale at `tests/differential/divergence-ledger.js:162-173` both document
it), and every emission path is convergent with the live DOM. The D6 ledger
predicate (extracted-only trailing MUTATIONS of pure text ops) still matches
the text-only `text-childlist` scenario, the empty-ledger negative control
(`oracle.test.js:360`) keeps D6 load-bearing, and stale-entry detection keeps
it from going decorative.

**WR-01 (serve.js crash) — FIXED, verified by probe.**
`examples/serve.js:73-77` rejects non-files (404, covers FIFO/socket/device
hang), and `:87` attaches the stream `'error'` handler before `pipe`
(`res.destroy()` — headers already sent, abort the socket). Re-ran the exact
iteration-1 crash probe: a mode-000 file now yields an aborted socket
(`UND_ERR_SOCKET` client-side), the process survives, and the very next
request serves 200. Traversal guard unchanged and still effective.

**WR-02 (silent add-op parse drop) — FIXED.**
`src/renderer/diff.js:103-117`: a div-context parse drop now emits a dedicated
`logger.warn` naming the real cause AND counts through `recordStaleMiss`, so
the ≥ 3 threshold self-heals via `CONTROL.START`. Pinned by
`tests/renderer-diff.test.js:133` (single drop counted, third accumulated drop
fires `stale-mutation-parent`). The queued proper fix (template-context
parsing) is recorded in `src/renderer/README.md` "Behavioral changes queued
for Phase 3+" as required.

**WR-03 (raw viewportWidth interpolation) — FIXED.**
`src/renderer/snapshot.js:104` coerces via `parseInt(p.viewportWidth, 10) ||
1920`; the file-header insertion inventory (`:18-28`) now lists all five
wire-value insertion points including this one. Pinned by
`tests/renderer-snapshot.test.js:60` with both a leading-digit breakout probe
and a fully non-numeric fallback probe. parseInt edge cases checked: `0`,
negative, `'0x10'`, non-string — none produce markup breakout.

No regressions introduced by any of the four fixes were found.

## Info

Accepted backlog — out of fix scope. IN-01 through IN-04 are re-listed
unchanged from iteration 1 (still present, still contained); IN-05 and IN-06
are new observations from this pass, both below Warning severity.

### IN-01: Dialog `type` flows into prototype-chain lookup and an uncoerced `charAt` call

**File:** `src/renderer/overlays.js:411` and `src/renderer/overlays.js:427-428`
**Issue:** `ICON_SVG[type] || ICON_SVG.alert` resolves prototype members for
`type: 'constructor'` (garbage native-function text, not exploitable); a
non-string truthy `type` throws at `type.charAt(0)` — contained by
`createViewer`'s dispatch wrapper, uncontained for direct `createOverlays`
consumers.
**Fix:** `var type = String(dialog.type || 'alert');` plus a
`hasOwnProperty` guard (or `Object.create(null)` for `ICON_SVG`).

### IN-02: ResizeObserver resolved from the importing realm, not the host window

**File:** `src/renderer/index.js:467`
**Issue:** Factory derives `doc`/`win` from `container.ownerDocument` but the
resize wiring checks the bare global `typeof ResizeObserver`; in a
multi-window host the observer binds to (or is missed in) the wrong realm.
**Fix:** `if (win && typeof win.ResizeObserver === 'function') { resizeObserver = new win.ResizeObserver(...); }`

### IN-03: Null mirror document drops mutation batches with zero accounting

**File:** `src/renderer/diff.js:70`
**Issue:** `if (!doc || !doc.body) return;` silently discards the batch — no
counter, log, or resync path. Reference parity; reachable post-onload.
**Fix:** At minimum `logger.warn('[Renderer] mutation batch skipped: no mirror document')`;
consider counting toward `applyFailures`.

### IN-04: Loopback fan-out lets one throwing handler starve later subscribers

**File:** `examples/loopback-transport.js:44-46` (duplicated at `tests/renderer-loopback.test.js:135-139`)
**Issue:** `handlers.forEach(function (h) { h(type, payload); })` — a throwing
handler aborts delivery to every later subscriber for that message and
surfaces as an unhandled microtask error. The viewer's dispatch is wrapped;
the demo's `onControl` glue and host-added handlers are not.
**Fix:** Per-handler try/catch with a `console.error`.

### IN-05: E2 text op can inflate the stale-miss counter when a later record in the same batch removes an element the flatten already consumed

**File:** `src/capture/index.js:974-985` (emission) / `src/renderer/diff.js:127-134` (where the miss lands)
**Issue:** New observation from the CR-01 edge probe (not a regression of the
fix — a property of E2 itself). When one rAF batch contains a bare-text
record on a target FOLLOWED by an element-removal record on the same target
(e.g. `box.appendChild(text)` then `box.removeChild(span)`), the emitted op
order is `[text(box), rm(span)]`: the flatten removes the mirrored span
first, so the `rm` records a stale miss. Probe-verified: end state is fully
convergent (mirror equals live), and the miss is counted and warned — the
only cost is accounting noise that biases TOWARD self-heal (three such
batches trigger an unnecessary but harmless re-snapshot). Below Warning
because there is no drift, no silence, and the failure direction is
conservative.
**Fix (optional, if resync churn ever shows up):** order childList-derived
text ops after all rm ops for the same flush, or skip the `rm` stale-miss
count when the target's parent was flattened earlier in the same batch.

### IN-06: serve.js `stat` follows symlinks — a symlink inside the repo escapes the ROOT-prefix guard

**File:** `examples/serve.js:59-67`
**Issue:** The ROOT containment check runs on the lexically resolved path,
and `stat`/`createReadStream` follow symlinks, so a symlink committed or
created inside the repo tree pointing outside ROOT would serve out-of-root
content. Consistent with the accepted dev-demo posture (localhost-only,
T-02-16/T-02-17; an actor able to plant symlinks in the working tree already
has local file access), so Info-tier backlog, not a gate item.
**Fix:** `const real = await realpath(filePath);` and re-check
`real === ROOT || real.startsWith(ROOT + sep)` before streaming.

---

## Verification notes

- Full suite re-run during review: **130/130 pass**.
- WR-01 re-probed with the iteration-1 crash reproduction (mode-000 file
  after successful `stat`): aborted socket, process alive, subsequent
  requests served. Probe artifacts removed.
- CR-01 gate probed end-to-end (capture core → `applyMutations` in jsdom)
  against both intra-batch interleavings not covered by the pinned shape-A/B
  tests; both convergent or documented-residual (details above, IN-05).
- D6 ledger entry re-checked post-gate: predicate still matches the
  text-only `text-childlist` scenario; empty-ledger negative control and
  stale-entry detection both still load-bearing.
- Documented residuals honored as accepted scope and not re-flagged:
  mixed-content text drift (README E2 + D6 rationale), raw
  `inlineStyles`/`payload.html` (Phase 3 SEC-01/SEC-02), `on*` survival,
  div-context parsing (now tracked in the Phase 3+ queue), reference-parity
  quirks (R11 dialog identity nesting, `viewportHeight || 1080` asymmetry).

_Reviewed: 2026-06-11T21:14:46Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
