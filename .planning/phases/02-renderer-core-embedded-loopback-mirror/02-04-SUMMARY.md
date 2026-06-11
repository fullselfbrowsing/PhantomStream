---
phase: 02-renderer-core-embedded-loopback-mirror
plan: 04
subsystem: renderer
tags: [loopback, e2e, recursion-guard, resync, dialog, custom-overlays, divergence-ledger, adpt-04, view-04, view-06]

# Dependency graph
requires:
  - phase: 02-renderer-core-embedded-loopback-mirror
    provides: "02-03: createViewer({container, transport}) with the data-phantomstream-ui marker, latched CONTROL.START resync, registerOverlay handle seam"
  - phase: 02-renderer-core-embedded-loopback-mirror
    provides: "02-02: createOverlays built-ins + capture overlayProvider key forwarding (E1)"
  - phase: 01-capture-core-extraction-differential-oracle
    provides: "createCapture with ancestor-inclusive skipElement, src/protocol STREAM/CONTROL/NID_ATTR/isCurrentStream"
provides:
  - "tests/renderer-loopback.test.js — phase success criterion 2 as an executable CI test: capture + viewer in ONE jsdom page over a loopback transport (10 tests)"
  - "End-to-end recursion-guard proof: snapshot contains no viewer DOM / no nested iframe; srcdoc writes never echo as mutations"
  - "End-to-end recovery proof: 3 stale misses -> exactly one latched CONTROL.START -> glue restarts capture -> fresh-identity snapshot -> post-resync mutation applies"
  - "End-to-end VIEW-04 proof: capture overlayProvider custom kind -> wire -> registerOverlay renderFn (payload + scale-mapped anchorRect + layer)"
  - "src/renderer/README.md — viewer contract docs + divergence ledger R1-R12 + Phase 3+ queued-gaps section"
affects: [02-05 loopback demo (same wiring pattern), 02-06 demo verification, phase-3 sanitization chokepoints, phase-4 WS transport]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Loopback transport (02-RESEARCH Pattern 1): Set-based fan-out + queueMicrotask hop implementing both Transport ends; settle()'s 20ms tail drains the hops"
    - "Srcdoc write-glue for jsdom e2e: cd.open()/write(iframe.srcdoc)/close(), re-run after every re-snapshot"
    - "No-await window between createViewer and capture.start(): jsdom's one-shot about:blank load must fire AFTER the first snapshot's microtask delivery"
    - "Second capture.start() as the deterministic streaming-state overlay-broadcast trigger (broadcastOverlayState's only call site is start(force))"

key-files:
  created:
    - tests/renderer-loopback.test.js
  modified:
    - src/renderer/README.md

key-decisions:
  - "Custom-overlay e2e uses a second capture.start() as the broadcast trigger: the first start's OVERLAY message always lands while the viewer is 'waiting' (microtasks precede the about:blank load task) and is gated off per Pitfall 4 parity — the restart broadcasts while streaming (state persists across re-snapshots, 02-03 decision)"
  - "Resync test plants a pre-resync marker element so the recovery snapshot is string-distinguishable from generation 1 (same DOM would re-serialize to an identical srcdoc)"
  - "Divergence ledger numbered R1-R12 including the 02-03-queued persistent-load-listener entry (jsdom 29 never delivers per-snapshot iframe.onload; srcdoc writes never re-fire load)"

requirements-completed: [ADPT-04, VIEW-04, VIEW-06]

# Metrics
duration: ~14min
completed: 2026-06-11
---

# Phase 2 Plan 04: Loopback E2E + Renderer Divergence Ledger Summary

**First end-to-end proof of the framework, in CI forever: capture + viewer in ONE jsdom page over a queueMicrotask loopback — live mutation mirroring through the srcdoc write-glue, both recursion-guard paths pinned, the latched CONTROL.START recovery round-trip proven, dialog + custom-overlay channels flowing capture-to-registry — plus the renderer README with the R1-R12 divergence ledger and the Phase 3+ accepted-gaps queue.**

## Performance

- **Duration:** ~14 min
- **Started:** 2026-06-11T17:37:36Z
- **Completed:** 2026-06-11T17:51:03Z
- **Tasks:** 3/3
- **Files modified:** 2 (1 created, 1 modified)

## Accomplishments

- **Phase success criterion 2 is now executable and CI-enforced:** full wiring (loopback transport -> createViewer -> createCapture with the attribute-based skipElement predicate -> onControl glue -> start) produces exactly one snapshot whose srcdoc carries the nid-stamped source rows; a live DOM add and a characterData edit in the source pane both appear in the glued mirror document.
- **Recursion guard proven on BOTH paths (threat T-02-13):** the snapshot contains no `data-phantomstream-ui`, no `<iframe`, no `ps-overlay-` chrome; an explicit srcdoc echo-probe write produces zero mutation traffic while a tracked attr op still flows in exactly one batch with no viewer leakage.
- **Recovery proven end-to-end in one page:** three MUTATIONS batches stamped with the current identity but unresolvable parentNids drive exactly ONE latched `CONTROL.START` (`trigger: 'preview-resync'`, `reason: 'stale-mutation-parent'`); the glue restarts the capture; a second snapshot with a different streamSessionId replaces the srcdoc (proven via a pre-resync marker element only the recovery snapshot contains); after re-glue, a subsequent valid mutation applies — and the start count stays 1.
- **VIEW-04 end-to-end:** a `badge` kind configured on the capture `overlayProvider` and registered via `handle.registerOverlay` before start arrives at the renderFn with the provider payload (`text: 'agent'`), the scale-mapped anchorRect (`{top:6, left:5, width:10, height:8}` under the jsdom 0x0-container clamp), and the layer element; the null reset-contract call is also pinned. An unregistered `sparkles` kind is warn-logged and ignored with built-ins unaffected.
- **Dialog half of VIEW-06 end-to-end (threat T-02-14):** `STREAM.DIALOG` injected through the capture end renders backdrop `flex` / type label `Alert` / literal message `saved!` via the textContent path, hides on `closed`, and is reset to hidden by the recovery snapshot of a REAL resync round-trip.
- **Renderer README rewritten (threat T-02-15):** capture-README-mirrored structure with provenance, options table, ViewerTransport contract + loopback wiring example, handle semantics, the overlay channel contract (kind dispatch, anchor priority, null reset, escaping ownership), the copy-pasteable recursion-guard predicate with the clone-vs-live warning, the R1-R12 divergence ledger, the Phase 3+ queued-gaps section (raw inline-styles breakout, on* survival, pre-onload drop, per-op querySelector), and the environment section (sandbox contract asserted at creation; jsdom srcdoc write-glue pattern).
- Full suite green: 121/121 (111 prior + 10 new), differential oracle included — zero regressions.

## Task Commits

1. **Task 1: Loopback e2e — core mirror path + recursion guard + resync round-trip** - `241bccd` (test) — 6 tests
2. **Task 2: Loopback e2e — dialog + custom overlay channels** - `8df8883` (test) — 4 tests
3. **Task 3: Renderer README + divergence ledger** - `8d9b8f7` (docs)

## Files Created/Modified

- `tests/renderer-loopback.test.js` (710 lines) — locally-duplicated helpers (AUDITED_GLOBALS swap with presence-aware restore, settle cadence, viewer-destroy/capture-stop-first teardown), the Pattern-1 loopback transport (Set fan-out + queueMicrotask hop), the srcdoc write-glue with the jsdom-limitation citation, and 10 e2e tests
- `src/renderer/README.md` (287 lines) — viewer contract + divergence ledger, replacing the Phase-0 extraction-pending stub

## TDD Gate Compliance

Both tdd-flagged tasks are **test-only deliverables** — the e2e test file IS the artifact (`<files>` contains only `tests/renderer-loopback.test.js`); the behavior under test was implemented and committed in plans 02-01..02-03. The RED/GREEN split therefore collapses: all 10 tests passed on first run against the existing implementation, which is the expected "feature already exists" outcome for an integration-proof plan, and each task produced a single `test(...)` commit with no `feat(...)` counterpart. The assertions are non-vacuous (exact batch/latch counts, glued-document content lookups by live-stamped nid, srcdoc replacement distinguishable via the marker element) — they fail if any wired component regresses.

## Decisions Made

- **Second `capture.start()` as the deterministic overlay-broadcast trigger:** `broadcastOverlayState` has exactly one call site in the capture core — `start(force=true)`. The first start's OVERLAY message is always delivered while the viewer is still `waiting` (loopback microtasks run before the iframe's about:blank load task) and is gated off (Pitfall 4 parity), so the test reaches streaming first and restarts — the second broadcast dispatches through the registry. This is the plan's instructed path ("read src/capture/index.js broadcast call sites to pick the deterministic trigger"), not a deviation.
- **No-await wiring window documented in the helper:** jsdom fires the iframe load exactly once; any `await` between `createViewer` and `capture.start()` lets the about:blank load fire with no pending snapshot, leaving the viewer waiting forever. The wiring helper comments this trap for future test authors.
- **Pre-resync marker for srcdoc-replacement proof:** an unchanged DOM re-serializes to a string-identical srcdoc across generations, so the test diverges the live DOM via a diff-delivered marker before provoking resync — only the recovery snapshot can contain it.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None. All 10 tests passed on the first run (see TDD Gate Compliance for why that is the expected outcome here).

## Known Stubs

None. The tests exercise live wiring end-to-end; the README documents shipped behavior only.

## Threat Flags

None beyond the plan's threat model. T-02-13 (recursion-guard e2e on both paths), T-02-14 (literal-text dialog message pinned end-to-end), and T-02-15 (Phase-3 gaps explicitly ledgered in the README's queued section) are all delivered as specified. No new network endpoints, auth paths, file access, or schema changes — this plan adds only a test file and documentation.

## Orchestrator Notes

- REQUIREMENTS.md not touched (shared orchestrator artifact in this parallel wave): ADPT-04, VIEW-04, VIEW-06 are complete per this plan's frontmatter — mark centrally after merge.
- The 02-03-queued ledger item (persistent load listener) is now recorded as README entry R12.

## Next Phase Readiness

- Plan 02-05's demo page can copy the wiring pattern verbatim: loopback transport, viewer-before-capture order, the attribute-based skipElement predicate, CONTROL.START glue (all shown in the README's transport section).
- Phase 3 owns the two ledgered sanitization chokepoints (`buildSnapshotHtml` inline-style insertion, on*-attribute survival); the README's queued section is the pickup list.
- Phase 4's WS transport implements the documented ViewerTransport interface unchanged.

## Self-Check: PASSED

- `tests/renderer-loopback.test.js` — FOUND
- `src/renderer/README.md` — FOUND (divergence x4, registerOverlay x4, data-phantomstream-ui x3, 12 R-entries)
- Commit `241bccd` — FOUND
- Commit `8df8883` — FOUND
- Commit `8d9b8f7` — FOUND
- `node --test tests/renderer-loopback.test.js` — 10/10 pass
- `npm test` — 121/121 pass
