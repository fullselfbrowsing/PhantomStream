---
phase: 02-renderer-core-embedded-loopback-mirror
verified: 2026-06-11T21:25:00Z
status: human_needed
score: 26/27 must-haves verified
overrides_applied: 0
human_verification:
  - test: "Real-browser scroll follow: run `npm run example:loopback`, open the demo in Chrome, add enough rows to make the page scroll, then scroll the page"
    expected: "The mirror smoothly follows the captured scroll position; scrolling inside the mirror itself feeds nothing back"
    why_human: "jsdom's scrollTo is a no-op — CI pins store+dispatch only; the executed 02-06 real-browser checkpoint's evidence table does not include a scroll-follow check"
  - test: "Glow/progress overlay visuals: drive an overlayProvider returning a glow rect (or use the console handle `window.__phantomstream`) and observe the overlay layer in the demo"
    expected: "Amber glow rect (2px #f59e0b border, soft shadow) and progress pill render anchored over the corresponding mirrored node, scaling with the mirror"
    why_human: "02-06-SUMMARY deviation note states glow-overlay visuals were not exercised live; positioning math and CSS are test-pinned but visual anchoring in a painted browser cannot be grep-verified"
  - test: "Dialog log-line affordance: in the demo click 'Show dialog' and dismiss the native alert"
    expected: "Footer log appends 'dialog mirrored: alert open → closed' after dismissal (the mirrored card itself is not paintable during a same-page alert — by design, Pitfall 3)"
    why_human: "02-06-SUMMARY deviation note states the dialog-card visual was not exercised live; the log line is the demo's visible proof and needs one human click"
  - test: "MVP-mode goal format decision: phase has `mode: mvp` but the ROADMAP goal is not a User Story (user-story.validate → false) and no PLAN carries one"
    expected: "Either run `/gsd mvp-phase 2` to reformat the goal, or accept verification against the roadmap success criteria (Phase-1 precedent: format note, proceed)"
    why_human: "Process decision, not a codebase property — verifier proceeded against the 5 explicit ROADMAP success criteria per the Phase 1 precedent"
deferred:
  - truth: "Mirrored content fully sanitized (raw inline styles </style> breakout, on* attributes surviving capture)"
    addressed_in: "Phase 3"
    evidence: "Phase 3 goal: 'Mirrored content is safe to render and masked content never leaves the captured page' (SEC-01/SEC-02/SEC-03); Phase 2 criterion 3 itself states 'full security contract lands in Phase 3'; gaps ledgered in src/renderer/README.md 'queued for Phase 3+' section"
  - truth: "Dialog identity-nesting quirk (top-level isCurrentStream always accepts dialogs) resolved for multi-stream contexts"
    addressed_in: "Phase 4 (networked transport)"
    evidence: "Ledger entry R11 in src/renderer/README.md and plan 02-03 threat T-02-11: 'loopback has a single stream; revisit at Phase 4 (networked)'"
---

# Phase 2: Renderer Core + Embedded Loopback Mirror — Verification Report

**Phase Goal (ROADMAP):** A page can mirror itself live — capture core plus embeddable viewer running end-to-end in one page with zero infrastructure
**Phase Mode:** mvp
**Verified:** 2026-06-11T21:25:00Z
**Status:** human_needed (all automated must-haves verified; 3 visual confirmations + 1 process decision remain)
**Re-verification:** No — initial verification

> Format note: the phase carries `**Mode:** mvp` (as do all 13 roadmap phases — a milestone-wide marker), but the Goal line is not in User Story format (`user-story.validate` → false: missing "As a", "I want to", "so that", trailing period) and, unlike Phase 1, no PLAN in this phase carries a user-story-formatted goal. Per the Phase 1 verification precedent, verification proceeded against the ROADMAP's 5 explicit Success Criteria (the roadmap contract). A User Flow Coverage table was not fabricated from a non-story goal; the demo walk-through items appear under Human Verification instead. Consider `/gsd mvp-phase 2` for consistency.

## Goal Achievement

### Observable Truths — ROADMAP Success Criteria (the contract)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| R1 | Host can call `createViewer({ container, transport })` in any plain HTML page and get a live, viewport-adaptively scaled mirror | ✓ VERIFIED | `src/renderer/index.js:128` factory (540 lines); auto-attach root + iframe + overlay layer; `computeScale` (line 101) + `transform: scale()` (line 289) + `typeof ResizeObserver` guard (line 467); package export `"./renderer"` live-import-checked (`createViewer: function`); 19 viewer tests in 130/130 green; real-browser checkpoint observed `transform: scale(0.318…)` letterboxed |
| R2 | First-party page importing capture + viewer directly (embedded-SDK adapter, direct loopback transport) shows a live mirror tracking DOM mutations in real time — first end-to-end proof | ✓ VERIFIED | `tests/renderer-loopback.test.js` (888 lines, 14 e2e tests): one snapshot, live add mirrored, text edit mirrored, bare text-node childList mirrored (D6 fix), recursion guard both paths; `examples/loopback-mirror.html:243-245` native ESM imports of `../src/renderer/index.js` + `../src/capture/index.js`; wiring order transport→viewer→capture→onControl→start (lines 329-359); real-browser checkpoint: 33+ nid nodes in `contentDocument`, 15/15 rows byte-identical at settle |
| R3 | Viewer iframe created with `sandbox="allow-same-origin"` only, asserted at creation | ✓ VERIFIED | `src/renderer/index.js:182-185`: setAttribute → read-back → token-list assertion → throws `'viewer-sandbox-invalid'`; test pins token list at exactly length 1; demo page never sets sandbox (regex check passed); live DOM inspection in the executed checkpoint confirmed the exact attribute |
| R4 | Scroll position and native `alert`/`confirm`/`prompt` dialogs mirrored with reference parity | ✓ VERIFIED (code+CI; real-browser visual → human item) | Capture: `STREAM.SCROLL` emission (`src/capture/index.js:1169-1171`), alert/confirm/prompt monkey-patch → `STREAM.DIALOG` (lines 384-461). Viewer: `handleScroll` stores-first + smooth `scrollTo` + once-per-batch re-apply (`src/renderer/index.js:371-389`); dialog card capitalized label / textContent-only / flex-none (`src/renderer/overlays.js:418-429`); e2e dialog open/close test green. jsdom cannot observe actual scrolling — flagged for human |
| R5 | Action-glow and progress overlays render anchored to mirrored nodes; hosts can send custom DOM-anchored overlays through the documented, extensible overlay message type | ✓ VERIFIED (code+CI; visual → human item) | Built-ins pre-registered through the SAME registry (`src/renderer/overlays.js:372-373`); positioning math pinned (45px/60px test, `tests/renderer-overlays.test.js:175-176`); `broadcastOverlayState` forwards every provider key, identity keys last (`src/capture/index.js`); e2e: `badge` kind capture→wire→`registerOverlay` renderFn with payload + mapped anchorRect + layer; unknown kinds warn-logged; contract documented in `src/renderer/README.md` overlay section; differential oracle green with the capture edit |

**Roadmap contract: 5/5 criteria verified at the codebase/CI level.**

### Observable Truths — Plan must_haves (merged, deduplicated)

| # | Truth (plan) | Status | Evidence |
|---|-------------|--------|----------|
| T1 | `buildSnapshotHtml` returns exact reference srcdoc string (02-01) | ✓ VERIFIED | `src/renderer/snapshot.js` (109 lines, 3 exports, pure); parity reset CSS present verbatim; 11 string-pinning tests green |
| T2 | `applyMutations` applies add/rm/attr/text vs ANY injected Document, miss accounting + thresholds (02-01) | ✓ VERIFIED | `src/renderer/diff.js` (188 lines); NID_ATTR imported from protocol (line 29), never the literal; 12 tests against `createHTMLDocument` targets |
| T3 | One bad op never aborts the batch (02-01) | ✓ VERIFIED | Per-op try/catch containment; pinned by test (next op applies after a throwing op) |
| T4 | Glow/progress are built-ins through the SAME registry hosts use (02-02) | ✓ VERIFIED | `overlays.js:372-373` `register('glow'/'progress', …)` through the single Map; no special-case dispatch path |
| T5 | Unknown overlay kinds logged and ignored, never thrown (02-02) | ✓ VERIFIED | `overlays.js:396` `'[Renderer] unknown overlay kind ignored'`; e2e `sparkles` test |
| T6 | Dialog card parity: capitalized label, textContent-only, icon by type, flex/none (02-02) | ✓ VERIFIED | `overlays.js:428-429`; literal-text test (`<b>hi</b>` renders as text); 3 inline SVG icons, zero `fa-solid` |
| T7 | Capture forwards EVERY overlayProvider key; no provider → wire shape unchanged, oracle green (02-02) | ✓ VERIFIED | `broadcastOverlayState` read in full: key copy, glow/progress null defaults, identity LAST; 4 wire-shape tests; oracle green in 130/130 |
| T8 | createViewer auto-attaches, returns exactly `{ detach, destroy, registerOverlay }` (02-03) | ✓ VERIFIED | Handle return read at `index.js:530-534`; idempotent detach/destroy test |
| T9 | Snapshot adopts identity, resets counters/overlays; stale MUTATIONS/SCROLL/OVERLAY rejected via isCurrentStream (02-03) | ✓ VERIFIED | `isCurrentStream` gates at lines 359/378/398/415; stale-rejection test |
| T10 | ≥3 stale misses / ≥2 failures → exactly ONE latched CONTROL.START; latch releases on next snapshot (02-03) | ✓ VERIFIED | `index.js:254-265` latch + `safeSend(CONTROL.START, {trigger:'preview-resync'…})`; full latch-cycle test + e2e round-trip |
| T11 | src/renderer/ zero FSB/chrome/dashboard references (02-03) | ✓ VERIFIED | `tests/renderer-purity.test.js` green (6 forbidden patterns, comment-stripped, anti-vacuous module-split pin) |
| T12 | Attribute-based skipElement recursion guard: no viewer DOM in snapshot, no srcdoc echo (02-04) | ✓ VERIFIED | Two e2e tests (snapshot path + diff path); live checkpoint: zero `<iframe>`/`[data-phantomstream-ui]` inside the mirror |
| T13 | Stale-miss → CONTROL.START → capture restart → fresh-identity snapshot recovery, end-to-end (02-04) | ✓ VERIFIED | e2e test with pre-resync marker proving srcdoc replacement; start count stays 1 per generation |
| T14 | Custom overlay kind via handle.registerOverlay receives payload e2e; dialog mirrors via STREAM.DIALOG (02-04) | ✓ VERIFIED | e2e badge test (payload `text:'agent'` + anchorRect + layer); dialog flex/none e2e |
| T15 | src/renderer/README.md documents viewer contract + every intentional divergence (02-04) | ✓ VERIFIED | 298 lines; ledger R1–R12; recursion-guard predicate verbatim; sandbox contract; Phase 3+ queued-gaps section |
| T16 | `npm run example:loopback` starts zero-dep localhost server, prints demo URL (02-05) | ✓ VERIFIED (static + executed-checkpoint curl) | `package.json` script; `serve.js` node:-builtins-only (lines 22-26), `127.0.0.1:8642` (lines 31-32), prints URL on listen; checkpoint curl evidence: 200s, MIME correct |
| T17 | Demo implements the locked 02-UI-SPEC contract (copy, controls, motion) (02-05) | ✓ VERIFIED | Contract-string check script passed (15 locked strings incl. all 5 button labels, prefers-reduced-motion, #f59e0b, no sandbox override) |
| T18 | text/javascript MIME, traversal rejected, localhost-only bind (02-05) | ✓ VERIFIED (static) | `serve.js`: decodeURIComponent-before-resolve (line 52), ROOT-prefix guard (line 60), `isFile()` rejection (line 73), stream error handler (line 87, WR-01 fix); executed-checkpoint curl: traversal probes 403/400 |
| T19 | Renderer importable as `@fullselfbrowsing/phantom-stream/renderer` (02-05) | ✓ VERIFIED | Live import executed: all 8 surface exports resolve as functions/string |
| T20 | Full suite green before human verification (02-06) | ✓ VERIFIED | `npm test` executed by verifier: **130/130 pass**, 0 fail (includes differential oracle + all 6 renderer test files) |
| T21 | Human verified the demo in a real Chromium: mutation tracking, scaling, scroll follow, dialog log-line, no mirror-of-mirror (02-06) | ? UNCERTAIN | Checkpoint EXECUTED (orchestrator-driven Chrome): mirror render, sandbox, structural+text mutations (15/15 identical), recursion guard, scaling, badge, footer string, server guards — all evidenced in 02-06-SUMMARY. NOT evidenced: scroll follow, dialog log-line, glow/progress visuals (deviation note confirms). Residue routed to Human Verification below |

**Score: 26/27 (5 roadmap criteria + 21 of 22 distinct plan truths verified; T21 partially evidenced → human items)**

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/renderer/snapshot.js` | Pure builder, 3 exports, ≥60 lines | ✓ VERIFIED | 109 lines; pure (no document./window.); wired into index.js srcdoc write |
| `src/renderer/diff.js` | applyMutations, ≥60 lines | ✓ VERIFIED | 188 lines; NID_ATTR import; wired into MUTATIONS handler |
| `src/renderer/overlays.js` | createOverlays/mapRectToHost/OVERLAY_CSS, ≥150 lines | ✓ VERIFIED | 458 lines; wired into createViewer (layer + CSS injection + dispatch) |
| `src/renderer/index.js` | createViewer/computeScale, ≥200 lines | ✓ VERIFIED | 540 lines; barrel re-exports; package "./renderer" export target |
| `src/renderer/README.md` | Contract + divergence ledger | ✓ VERIFIED | 298 lines, R1–R12 ledger, queued-gaps section |
| `tests/renderer-snapshot.test.js` / `renderer-diff.test.js` / `renderer-overlays.test.js` / `renderer-viewer.test.js` / `renderer-purity.test.js` | Unit/contract tests | ✓ VERIFIED | 172/361/453/652/90 lines; all green in 130/130 |
| `tests/renderer-loopback.test.js` | E2E proof, ≥150 lines | ✓ VERIFIED | 888 lines, 14 tests incl. CR-01 regression shapes |
| `tests/capture-overlay-forward.test.js` | Wire-shape pins | ✓ VERIFIED | 232 lines, 4 tests |
| `examples/loopback-transport.js` | createLoopbackTransport | ✓ VERIFIED | 65 lines; export live-import-checked |
| `examples/serve.js` | Dep-free static server | ✓ VERIFIED | 97 lines; node: builtins only; syntax-checked |
| `examples/loopback-mirror.html` | First-light demo, ≥150 lines | ✓ VERIFIED | 369 lines; contract strings verified |
| `package.json` | "./renderer" export + example:loopback script | ✓ VERIFIED | Both present and functional |

### Key Link Verification

The `gsd-sdk query verify.key-links` runs reported 5 pattern misses; **all 5 were false negatives** (SDK regex-escaping artifacts) — each link manually re-verified with direct grep:

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| src/renderer/diff.js | src/protocol/messages.js | NID_ATTR import | ✓ WIRED | `diff.js:29` `import { DIFF_OP, NID_ATTR } from '../protocol/messages.js'` |
| tests/renderer-diff.test.js | createHTMLDocument | jsdom-safe Document target | ✓ WIRED | Pattern found; zero `srcdoc` in file |
| src/capture/index.js | STREAM.OVERLAY wire | broadcastOverlayState pass-through | ✓ WIRED | `capture/index.js:1249` `safeSend(STREAM.OVERLAY, payload)` |
| src/renderer/index.js | snapshot.js / diff.js / protocol | buildSnapshotHtml → srcdoc; applyMutations fresh contentDocument; isCurrentStream | ✓ WIRED | All imports + call sites confirmed |
| src/renderer/index.js | transport.send | latched CONTROL.START resync | ✓ WIRED | `index.js:265` `safeSend(CONTROL.START, …)` |
| tests/renderer-loopback.test.js | iframe.contentDocument | open/write/close srcdoc glue | ✓ WIRED | Lines 261-263 with jsdom-limitation citation |
| loopback glue | capture.start() | onControl(CONTROL.START) | ✓ WIRED | Test line 229 + demo line 351 |
| examples/loopback-mirror.html | src/renderer + src/capture | native ESM imports | ✓ WIRED | Lines 243-245 |
| examples/loopback-mirror.html | recursion guard | data-phantomstream-ui skipElement | ✓ WIRED | Attribute predicate present |
| package.json | examples/serve.js | example:loopback script | ✓ WIRED | Script entry confirmed |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| viewer iframe srcdoc | `buildSnapshotHtml(payload)` | live capture serializeDOM via transport | Yes — e2e asserts nid-stamped source rows in srcdoc; live checkpoint: 33+ nodes in contentDocument | ✓ FLOWING |
| mirror document updates | `applyMutations(contentDocument, payload.mutations, …)` | live MutationObserver diffs via transport | Yes — e2e: live add/text edits appear in glued mirror; 15/15 rows identical live | ✓ FLOWING |
| overlay layer | registry dispatch payload | capture `broadcastOverlayState` (provider keys forwarded) | Yes — e2e: badge payload reaches renderFn with mapped rect | ✓ FLOWING |
| dialog card | `payload.dialog` | capture alert/confirm/prompt monkey-patch → STREAM.DIALOG | Yes — interceptor exists (capture:384-461); viewer path e2e-proven (interceptor itself untestable in jsdom without runScripts) | ✓ FLOWING |
| mirror scroll | `lastScroll` ← STREAM.SCROLL | capture scroll tracker (window.scrollX/Y) | Yes at wire level; visual follow unverifiable in jsdom | ✓ FLOWING (visual → human) |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Full suite incl. oracle + all renderer tests | `npm test` | 130 pass / 0 fail | ✓ PASS |
| Renderer package export | `import('@fullselfbrowsing/phantom-stream/renderer')` | createViewer/computeScale/createOverlays/buildSnapshotHtml/applyMutations all functions | ✓ PASS |
| Example modules valid | `node --check` serve.js + loopback-transport.js; live import of createLoopbackTransport | All exit 0 | ✓ PASS |
| Demo contract strings | 15 locked UI-SPEC strings + no-sandbox-override regex | "demo contract strings OK" | ✓ PASS |
| Server boot / curl | — | SKIPPED (verifier does not start servers; static security greps + executed-checkpoint curl evidence substitute) | ? SKIP |

### Probe Execution

No `scripts/*/tests/probe-*.sh` probes exist in this repository and no phase document declares any — SKIPPED (not applicable).

### Requirements Coverage

| Requirement | Source Plans | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| VIEW-01 | 02-01, 02-03, 02-05, 02-06 | Framework-agnostic `createViewer({container, transport})` with viewport-adaptive scaling | ✓ SATISFIED | R1 evidence; live import check; scaling observed in real browser |
| VIEW-04 | 02-02, 02-04, 02-06 | Documented, extensible overlay channel; glow/progress built-ins; custom DOM-anchored overlays | ✓ SATISFIED | R5 evidence; e2e capture→wire→registry proof; README contract |
| VIEW-06 | 02-02, 02-03, 02-04, 02-06 | Scroll + native dialog mirroring (reference parity) | ✓ SATISFIED (code+CI; visuals → human items) | R4 evidence; both capture emitters + both viewer handlers wired and tested |
| ADPT-04 | 02-04, 02-05, 02-06 | Embedded-SDK adapter — first-party page imports and runs capture directly | ✓ SATISFIED | Demo page native ESM imports; loopback e2e in CI; package exports |

**Orphaned requirements:** none — REQUIREMENTS.md maps exactly these 4 IDs to Phase 2 (lines 129/132/134/140), and all 4 are claimed by plan frontmatter.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| — | — | No TBD/FIXME/XXX/TODO/HACK/placeholder markers in any phase-modified file | — | — |
| src/renderer/snapshot.js | (raw html/inlineStyles insertion) | Raw attacker-influenced HTML into srcdoc | ℹ️ Info | NOT a stub — parity-locked Phase-3 chokepoint (T-02-01/T-02-12 accepted in plan threat models; ledgered in README queued-gaps; deferred to Phase 3 per roadmap) |
| examples/serve.js | — | No automated test file for the demo server | ℹ️ Info | Example-only code; WR-01 crash fix probe-verified per 02-REVIEW-FIX.iter2; acceptance curls executed at 02-05/02-06 |

All 23 summary-claimed commits verified present in git (TDD pairs, checkpoint-fix trio 5e986a7/ae4d798/6e6642b, review-fix quartet f4705fc/c40253d/8da3dd7/d5ebb7f). Post-fix re-review (02-REVIEW.md): `critical: 0, warning: 0, status: clean`.

### Human Verification Required

#### 1. Real-browser scroll follow

**Test:** `npm run example:loopback`, open the demo in Chrome, add many rows so the page scrolls, scroll the page.
**Expected:** Mirror smoothly follows the captured scroll position; scrolling inside the mirror feeds nothing back.
**Why human:** jsdom scrollTo is a no-op; the executed real-browser checkpoint's evidence table omits this check.

#### 2. Glow/progress overlay visuals

**Test:** Drive a glow/progress payload (via an overlayProvider or the `window.__phantomstream` console handle) and observe the overlay layer.
**Expected:** Amber glow rect and progress pill render anchored over the corresponding mirrored node, scaling with the mirror.
**Why human:** 02-06-SUMMARY deviation note: glow visuals not exercised live; CSS/positioning are test-pinned, painted anchoring is not.

#### 3. Dialog log-line affordance

**Test:** Click "Show dialog" in the demo; dismiss the native alert.
**Expected:** Footer log appends "dialog mirrored: alert open → closed" (mirrored card not paintable during same-page alert — by design).
**Why human:** 02-06-SUMMARY deviation note: dialog-card visual not exercised live; the log line is the demo's visible proof.

#### 4. MVP-mode goal format decision

**Test:** Decide whether to run `/gsd mvp-phase 2` to reformat the phase goal as a User Story, or accept verification against the roadmap success criteria.
**Expected:** Consistent mode/goal pairing going forward (all 13 phases carry `Mode: mvp` with non-story goals).
**Why human:** Process decision; verifier followed the Phase 1 precedent (format note + proceed against the roadmap contract).

### Gaps Summary

No gaps. All 5 roadmap success criteria and all plan must-have truths are verified in the codebase at the automated level: the embeddable viewer factory with the asserted `allow-same-origin`-only sandbox, the first end-to-end loopback proof (CI-pinned in 14 e2e tests and exercised live in a real Chrome where it caught and fixed a real fidelity bug, D6), reference-parity scroll/dialog channels, and the documented extensible overlay registry with capture-side pass-through proven oracle-safe. The remaining items are inherently visual real-browser confirmations (scroll follow, glow/progress visuals, dialog log-line) plus one process decision about the MVP-mode goal format — none of which indicate missing or stubbed implementation.

---

_Verified: 2026-06-11T21:25:00Z_
_Verifier: Claude (gsd-verifier)_
