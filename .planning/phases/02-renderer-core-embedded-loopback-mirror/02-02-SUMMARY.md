---
phase: 02-renderer-core-embedded-loopback-mirror
plan: 02
subsystem: renderer
tags: [overlays, registry, dialog-mirroring, view-04, view-06, wire-protocol, parity]

# Dependency graph
requires:
  - phase: 01-capture-core-extraction-differential-oracle
    provides: createCapture with overlayProvider seam, STREAM protocol constants, differential oracle proving capture wire parity
provides:
  - src/renderer/overlays.js -- host-document overlay layer + kind-keyed registry (registerOverlay seam) + glow/progress/dialog parity built-ins + mapRectToHost coordinate mapping + OVERLAY_CSS injected-style string
  - Capture overlay pass-through (E1) -- broadcastOverlayState forwards every overlayProvider key as an overlay kind; glow/progress default null; identity keys stamped last; reference wire shape byte-identical with no provider
  - Wire-shape pin tests (tests/capture-overlay-forward.test.js) and registry/built-in behavior tests (tests/renderer-overlays.test.js)
affects: [02-03 createViewer (consumes createOverlays/OVERLAY_CSS/mapRectToHost), 02-05 loopback demo, 02-06 demo verification]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - One Map for every overlay kind -- built-ins pre-registered through the same registry custom kinds use (zero special-cased dispatch, extension seam proven by construction)
    - safeRenderOverlay containment wrapper copying the capture core's safeSkipElement shape (throwing renderFn routed to logger, kind loop continues)
    - Uniform null-payload contract -- every renderFn (built-in or custom) receives null to hide/clear, which doubles as the new-snapshot reset path
    - Identity-keys-last payload assembly on the capture side so provider keys can never spoof stream identity

key-files:
  created:
    - src/renderer/overlays.js
    - tests/renderer-overlays.test.js
    - tests/capture-overlay-forward.test.js
  modified:
    - src/capture/index.js
    - src/capture/README.md

key-decisions:
  - "Glow renders only when state==='active' AND an anchor rect resolved -- the registry path resolves rects before dispatch, so a missing/stale anchor hides the rect instead of positioning it at NaN (reference computed coords inline and could not hit this case)"
  - "resetOverlays dispatches (null, null, layer) through EVERY registered renderFn -- built-ins hide on null, custom kinds clear their DOM -- one reset contract instead of special-casing built-ins (D-13 parity preserved)"
  - "nid anchor resolution wins over numeric x/y/w/h with no coordinate fallback when the nid is stale (priority semantics per 02-RESEARCH Pattern 5; renderFn decides what a null anchor means)"
  - "Throwing overlayProvider resets the payload to {} before defaulting, so a getter-trap provider that throws mid-copy can never leak partial keys (same wire result as the reference's swallow, strictly more robust)"
  - "Capture edit documented as extension entry E1 in src/capture/README.md, NOT as a differential-ledger divergence -- the ledger is the Phase 1 reference-parity record and the edit is wire-invisible without a provider"

patterns-established:
  - "renderFn(payload, anchorRect, layer) is the public overlay extension contract: raw payload (custom renderFns own their escaping, T-02-05), host-document rect or null, layer element for DOM writes"
  - "OVERLAY_CSS as a single exported string -- viewer chrome styles travel as one injected <style>, no external stylesheet (zero-dependency constraint)"

requirements-completed: [VIEW-04]
requirements-partial: [VIEW-06 (dialog-card half delivered; scroll-mirroring half lands with createViewer in plan 02-03)]

# Metrics
duration: 14min
completed: 2026-06-11
---

# Phase 2 Plan 02: Overlay Channel + Dialog Card Summary

**Extensible overlay channel: host-document layer with a kind-keyed registry (glow + progress as pre-registered built-ins with 02-UI-SPEC parity visuals), reference-parity dialog card with textContent-only rendering and inline-SVG icons, plus the oracle-safe capture edit forwarding every overlayProvider key onto the STREAM.OVERLAY wire**

## Performance

- **Duration:** ~14 min
- **Started:** 2026-06-11T17:03:05Z
- **Completed:** 2026-06-11T17:17:00Z
- **Tasks:** 2 (both executed as TDD: RED -> GREEN)
- **Files modified:** 5 (3 created, 2 modified)

## Accomplishments

- **VIEW-04 extension seam proven by construction:** glow and progress dispatch through the exact same `Map` that `register(kind, renderFn)` writes to -- there is no special-cased built-in path. A test-registered custom kind (`badge`) receives `(payloadValue, mappedAnchorRect, layer)`, with nid resolution taking priority over numeric coords.
- **Parity visuals locked:** OVERLAY_CSS carries the exact 02-UI-SPEC values (glow `2px solid #f59e0b` / `0 0 12px rgba(245, 158, 11, 0.6)` shadow with reduced-motion-guarded 100ms transitions; dialog card `#1e1e2e` / `1px #333` / `12px` radius / `24px` padding; progress pill `rgba(0,0,0,0.75)` scrim). Coordinate mapping is the verbatim dashboard.js:3381-3384 formula, pinned by pure-math tests.
- **Dialog card parity (dialog half of VIEW-06):** capitalized type label (default `Alert`), message via `textContent` NEVER innerHTML (T-02-04, pinned by a literal-text test asserting zero element children for a `<b>hi</b>` message), icon-by-type as inline SVGs, `flex`/`none` show-hide, and the reference's `payload.dialog || payload` fallback.
- **Forward-compatible dispatch:** unknown overlay kinds are logged (`[Renderer] unknown overlay kind ignored`) and skipped -- the kind loop continues, never throws (T-02-07). Throwing custom renderFns are contained by `safeRenderOverlay` (capture-core containment shape).
- **Capture pass-through (Task 2, E1):** `broadcastOverlayState` now copies every own enumerable provider key into the payload, defaults `glow`/`progress` to null, and stamps `streamSessionId`/`snapshotId` LAST so a hostile provider returning `{streamSessionId: 'attacker'}` can never spoof identity (T-02-06, pinned by test).
- **Differential oracle re-proven green:** full `npm test` 67/67 with the capture edit in place -- with no provider the wire payload is exactly `{glow: null, progress: null, streamSessionId, snapshotId}` (key set asserted as exactly 4 keys).

## Task Commits

| Task | Phase | Commit | Description |
| ---- | ----- | ------ | ----------- |
| 1 | RED | `ba25c62` | test(02-02): failing tests for overlay layer, registry, built-ins (13 tests) |
| 1 | GREEN | `63c3cf0` | feat(02-02): overlay layer, kind registry, parity built-ins (458 lines) |
| 2 | RED | `a539a05` | test(02-02): failing wire-shape tests for overlay key forwarding (4 tests) |
| 2 | GREEN | `8c3603d` | feat(02-02): forward all overlayProvider keys on the OVERLAY wire (oracle-safe) |

## Verification

- `node --test tests/renderer-overlays.test.js` -- 13/13 pass (plan floor: 10)
- `node --test tests/capture-overlay-forward.test.js` -- 4/4 pass (plan floor: 4)
- `npm test` -- 67/67 pass including all `tests/differential/*.test.js` oracle pairs (capture edit wire-safe)
- Acceptance greps: `ps-overlay-` x17 (>= 7), `dash-preview` x0, `fa-solid` x0, `<svg` x3 (>= 3), all five parity colors (#f59e0b, #1e1e2e, #333, #888, #e0e0e0) in OVERLAY_CSS, innerHTML confined to SVG icon construction, dialog message via textContent
- `grep -i overlay src/capture/README.md` matches the new E1 extension entry

## TDD Gate Compliance

Both tasks followed RED -> GREEN with commits in order: `test(...)` commit precedes its `feat(...)` commit for each task (ba25c62 -> 63c3cf0; a539a05 -> 8c3603d). No refactor commits needed. Task 2's RED run failed exactly on the two forwarding behaviors (custom keys dropped by the pre-edit code) while the two oracle-protection invariants passed before AND after the edit -- the wire shape with no provider never changed.

## Deviations from Plan

None - plan executed exactly as written.

## Known Stubs

None. All rendered paths are wired to real data; no placeholder text, hardcoded-empty UI values, or unwired components were introduced.

## Threat Flags

None beyond the plan's threat model. T-02-04 (textContent-only dialog/progress text), T-02-05 (custom renderFn escaping contract documented in `register()` JSDoc), T-02-06 (identity keys stamped last), and T-02-07 (containment + unknown-kind skip) are all implemented and pinned by tests. No new network endpoints, auth paths, file access, or schema changes.

## Next Phase Readiness

- Plan 02-03's `createViewer` can now consume `createOverlays({document, logger})`, append `handle.layer` into the viewer root, inject `OVERLAY_CSS`, route STREAM.OVERLAY -> `handleOverlayMessage(payload, {scale, resolveNidRect})`, STREAM.DIALOG -> `handleDialogMessage`, and call `resetOverlays()` on each new snapshot.
- Custom overlay kinds now flow end-to-end on the wire: an embedded-SDK host's `overlayProvider` keys reach the viewer's registry untouched.

## Self-Check: PASSED

All 6 claimed files exist on disk; all 4 task commits (ba25c62, 63c3cf0, a539a05, 8c3603d) present in git log.
