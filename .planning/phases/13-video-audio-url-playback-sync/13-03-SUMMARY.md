---
phase: 13-video-audio-url-playback-sync
plan: 03
subsystem: ui
tags: [renderer, media-sync, video, audio, autoplay, csp, ssrf, overlays, drift-reconciler, cross-realm, esm]

# Dependency graph
requires:
  - phase: 13-video-audio-url-playback-sync
    plan: 01
    provides: "reconcileMediaDrift + DEFAULT_MEDIA_RECONCILE_CONFIG (hold|pause|nudge|seek|rejoin-edge), STREAM.MEDIA op, isCurrentStream staleness guard"
  - phase: 13-video-audio-url-playback-sync
    plan: 02
    provides: "the STREAM.MEDIA wire payload (nid + currentTime/paused/muted/volume/playbackRate/loop/duration|live/ended + sentAt + identity) and the snapshot media[] baseline this driver consumes"
  - phase: 12-static-assets-by-reference
    provides: "gateAssetUrl/classifyAssetOrigin fail-closed origin gate + the string-layer gateSnapshotAssets/gateFragmentAssets + mediaMode posture this slice extends to media"
provides:
  - "media-src http: https: data: in CSP_META (twin of img-src, no blob:); default-src 'none' + no script-src retained"
  - "generalized string-layer gateSnapshotAssets covering <img>/<video>/<source> (src+poster) pre-parse, plus gateFragmentMedia post-parse defense-in-depth + poster-mode source neutralization"
  - "three media affordance renderFns (media-blocked scrim+button, media-unmute pill, media-poster caption) registered through the overlay registry + an overlays.show(kind,payload,ctx) seam"
  - "handleMedia: streaming+staleness gated, reconciler-driven parent-realm cross-realm playback driver (.play()/.pause()/.currentTime=) with seeking/readyState/seekable guards"
  - "autoplay-correct ensurePlaying (muted default, play()-undefined guard, NotAllowedError -> affordance + onMediaBlocked config callback) + the unmute trigger + the snapshot media[] first-bind baseline"
affects: [13-04-media-uat, phase-14-adaptive-streaming, phase-15-media-security-masking]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Cross-realm parent-driven playback: the inert in-iframe element (sandbox allow-same-origin, NO allow-scripts) is driven by the parent realm calling methods on it; no player code in the mirror"
    - "Renderer-state-driven affordances (NOT wire-driven): overlays.show(kind,payload,ctx) drives the media affordances as a function of local play() outcome / muted mismatch / mediaMode (13-UI-SPEC Motion)"
    - "String-layer media URL neutralization pre-parse (a unified <img>/<video>/<source> scan) because the browser prefetches <video src>/poster during srcdoc parse -- a post-parse scrub is too late (Pitfall 5)"
    - "onMediaBlocked as a config-callback (assetOriginPolicy-hook family), NOT on() which throws on non-state/health names; hook errors contained to the logger"
    - "Snapshot media[] baseline applied once per nid on first bind then control passes to the reconciler (Pitfall 7 -- no re-snapshot playback jump)"

key-files:
  created:
    - tests/renderer-media-csp.test.js
    - tests/renderer-media.test.js
  modified:
    - src/renderer/snapshot.js
    - src/renderer/overlays.js
    - src/renderer/index.js
    - tests/renderer-snapshot.test.js
    - tests/security-chokepoint-purity.test.js
    - tests/semantic-addressing.test.js

key-decisions:
  - "findImgTagEnd generalized to findTagEnd (tag-agnostic quote-aware scanner); gateSnapshotAssets rewritten as a unified left-to-right scan over <img>/<video>/<source> via nextAssetOpener so a blocked media URL is neutralized at the string layer before parse"
  - "gateOneMediaTag fails the whole <video>/<source> to the dimensioned placeholder if EITHER src OR (video) poster is blocked -- the same fail-closed posture as the <img> path; reuses attrsBlobIsUnreliable/readTagAttr/assetUnavailablePlaceholderTag"
  - "Added an overlays.show(kind,payload,ctx) seam (ctx.anchorRect pre-resolved by the renderer) because the media affordances are renderer-state-driven, not STREAM.OVERLAY-driven; null payload hides (the existing reset contract)"
  - "handleMedia is a no-op driver in mediaMode poster/off (the Task 1 gate already neutralized the source); affordances are surfaced only in reference mode"
  - "Snapshot media[] baseline applied in the post-parse load handler (after nids are paired), readyState-gated, once per nid; then the reconciler owns steady state"
  - "No D27 differential-oracle ledger entry this plan (the renderer emits nothing to the oracle; capture's media[]/STREAM.MEDIA divergence + the media-playback-sync fixture land in Plan 13-04, per the stale-entry discipline)"

patterns-established:
  - "Media driver decision flow: streaming+isCurrentStream gate -> poster/off short-circuit -> resolveIndexedNode -> build localState -> reconcileMediaDrift -> applyMediaAction (seeking-hold, readyState>=1 seek gate, seekable.length rejoin guard) -> evaluateUnmuteTrigger"
  - "ensurePlaying: muted=true before first play; if (p !== undefined && typeof p.catch === 'function') guard; NotAllowedError -> showBlockedPlayAffordance + safeInvokeMediaHook(onMediaBlocked); any other rejection defers to the Phase 12 load-error placeholder"
  - "Every media affordance writes label text via textContent; the ONLY innerHTML is the static MEDIA_GLYPH inline-SVG constants (the ICON_SVG precedent); interactive controls set pointer-events:auto, the layer stays pointer-events:none"

requirements-completed: [MEDIA-01, MEDIA-05, MWIRE-01]

# Metrics
duration: 38min
completed: 2026-06-21
---

# Phase 13 Plan 03: Renderer Media Driver + Autoplay + CSP/SSRF Gate Summary

**The renderer slice that plays a mirrored `<video>`/`<audio>` in lockstep: `handleMedia` runs the pure reconciler and drives the inert in-iframe element cross-realm from the parent realm (muted-autoplay-correct, never wedging on a blocked play), plus the `media-src` CSP add, the load-bearing pre-parse string-layer media URL gate (the SSRF fix), the three blocked-play/unmute/poster affordances, and the `mediaMode` poster/reference split.**

## Performance

- **Duration:** ~38 min
- **Started:** 2026-06-21
- **Completed:** 2026-06-21
- **Tasks:** 3
- **Files modified:** 8 (2 created, 6 modified)

## Accomplishments
- **Pre-parse SSRF gate + CSP (MEDIA-01, Task 1):** added `media-src http: https: data:` to `CSP_META` (no `blob:`; `default-src 'none'` and no `script-src` retained), generalized `findImgTagEnd -> findTagEnd`, and rewrote `gateSnapshotAssets` as a unified `<img>/<video>/<source>` scan so a blocked `<video src>`/`poster`/`<source src>` is neutralized to the dimensioned blocked-origin placeholder at the STRING layer BEFORE the srcdoc parser can prefetch it (closes Pitfall 5). Added `gateFragmentMedia` as post-parse defense-in-depth + poster-mode source neutralization.
- **Media affordances (MEDIA-05, Task 2):** three renderFns registered through the existing overlay registry -- `media-blocked` (scrim clipped to the rect + a >=44x44 amber play button, `role=button`/`tabindex=0`/`aria-label`, Enter/Space+click), `media-unmute` (bottom-left pill, "Unmute" via textContent), `media-poster` (passive caption) -- plus an `overlays.show(kind,payload,ctx)` seam. All text via `textContent`; the only `innerHTML` is the two static `MEDIA_GLYPH` SVGs.
- **Parent-realm playback driver (MEDIA-01/05, MWIRE-01, Task 3):** `case STREAM.MEDIA -> handleMedia` (the default already ignores it for old viewers). `handleMedia` staleness-guards via `isCurrentStream`, resolves the nid, runs `reconcileMediaDrift`, and applies the action on the in-iframe element via `applyMediaAction` (seeking-hold Pitfall 6, `readyState>=1` seek gate, `seekable.length` rejoin guard Pitfall 4). `ensurePlaying` sets `muted=true` before the first play, guards `play()`'s return (`if (p !== undefined && typeof p.catch === 'function')`), and on `NotAllowedError` shows the blocked-play affordance + invokes `onMediaBlocked(nid)` (config callback, contained-not-rethrown) without wedging.
- **Unmute trigger + first-bind baseline (Task 3):** after `ensurePlaying`, when `el.muted === true && payload.muted === false` in `reference` mode the `media-unmute` affordance is shown (onActivate sets `muted=false` + restores `volume`, then hides); a still-muted source hides it; poster mode never shows it. The snapshot `media[]` baseline is applied once per nid on first bind (readyState-gated) then defers to the reconciler (Pitfall 7).
- **Sandbox + suite:** the iframe sandbox token stays exactly `allow-same-origin` (asserted); no `allow-scripts` literal anywhere in `src/renderer/`. Full suite green at 577/577 (baseline 546 + 31 new media tests), differential oracle 45/45 byte-identity preserved.

## Task Commits

Each task was committed atomically:

1. **Task 1: media-src CSP add + string-layer <video>/<source>/poster gate** - `9cca62e` (feat)
2. **Task 2: media affordance renderFns (blocked-play/unmute/poster) in overlay registry** - `cd40cb0` (feat)
3. **Task 3: handleMedia dispatch + parent-realm playback driver + autoplay/unmute** - `35eabb8` (feat), with `fc6d101` (feat: snapshot media[] first-bind baseline) completing the same task's Pitfall-7 behavior bullet

**Plan metadata:** (this commit) (docs: complete plan)

_TDD note: each task was executed test-first (RED: new test file asserts the missing CSP/gate/affordance/driver behavior; GREEN: implement). The reconciler + capture glue already shipped (Plans 01/02), so this slice is renderer wiring + its tests; each task landed as a single feat commit carrying both its tests and its implementation (the 13-01/13-02 squashed-TDD precedent). Task 3's baseline split into a second focused feat commit because it is a self-contained snapshot-path behavior._

## Files Created/Modified
- `src/renderer/snapshot.js` (modified) - `media-src` in `CSP_META`; `findImgTagEnd -> findTagEnd`; `VIDEO_OPEN_RE`/`SOURCE_OPEN_RE` + `gateOneMediaTag` + `nextAssetOpener`; `gateSnapshotAssets` rewritten as a unified three-tag pre-parse scan.
- `src/renderer/overlays.js` (modified) - `MEDIA_GLYPH` (play triangle, muted speaker) inline-SVG constants; `ps-overlay-media-*` CSS (13-UI-SPEC parity values); `media-blocked`/`media-unmute`/`media-poster` renderFns + `wireActivation`/`safeActivate`/`anchorAffordance` helpers; `show(kind,payload,ctx)` added to the handle.
- `src/renderer/index.js` (modified) - import `reconcileMediaDrift`/`DEFAULT_MEDIA_RECONCILE_CONFIG`; `onMediaBlocked`/`mediaReconcileConfig` config read; `gateFragmentMedia` (Task 1); `case STREAM.MEDIA`; `handleMedia` + `applyMediaAction` + `ensurePlaying` + `showBlockedPlayAffordance` + `safeInvokeMediaHook` + `evaluateUnmuteTrigger` + `applyMediaBaseline` + `mediaFirstBind` bookkeeping.
- `tests/renderer-media-csp.test.js` (created) - 9 string-assertion tests: `media-src` present/no `blob:`, `default-src`/no `script-src` retained, blocked video src/poster/source neutralized pre-parse, allowed pass, quote-aware tag-split, `<img>` gate unregressed.
- `tests/renderer-media.test.js` (created) - 22 jsdom tests: overlay registry/visual/a11y/pointer-events/textContent contract (Task 2); `handleMedia` dispatch, stubbed-element driver, pause/seek, muted-default + `play()`-undefined guard, `NotAllowedError` affordance + `onMediaBlocked` (+throwing-hook contained), unmute show-then-activate, poster no-op, seeking/readyState/seekable guards, staleness, old-viewer-ignores, sandbox token, first-bind baseline (Task 3).
- `tests/renderer-snapshot.test.js` (modified) - updated the two Phase-12 CSP pins from the media-src-deferred contract to the Phase-13 contract (`media-src` present, no `blob:`).
- `tests/security-chokepoint-purity.test.js` (modified) - bumped the `overlays.js` innerHTML-sink allowlist 2 -> 4 (the two new static `MEDIA_GLYPH` glyph writes) + updated the explanatory message.
- `tests/semantic-addressing.test.js` (modified) - narrowed the remote-control dispatch guard so the local affordance `click`/`keydown` activation (which never forwards over the wire) is permitted while input-forwarding listeners stay forbidden.

## Decisions Made
- **Unified pre-parse media scan.** `gateSnapshotAssets` now advances to the nearest of `<img>`/`<video>`/`<source>` at each cursor (`nextAssetOpener`) and gates that tag; nesting (`<source>` inside `<video>`) is handled because each opener is an independent match. The `<img>` path (currentSrc pin + srcset) is unchanged; `<video>`/`<source>` go through `gateOneMediaTag` (src + video poster), failing the whole tag to the placeholder if either is blocked.
- **overlays.show seam.** The media affordances are renderer-state-driven (per 13-UI-SPEC Motion, they appear/disappear as a function of local `play()` outcome / muted mismatch / mediaMode), not `STREAM.OVERLAY`-driven, so a dedicated `show(kind, payload, ctx)` method (with the renderer pre-resolving `ctx.anchorRect` via `resolveNidRect`) is the clean seam. A null payload reuses the universal hide/reset contract.
- **onMediaBlocked is a config callback.** Delivered in the `assetOriginPolicy`-hook family (read at factory time, contained to the logger), NOT via `on()` -- which throws on non-`state`/`health` names (verified in `src/renderer/index.js`). This matches the UI-SPEC State A "delivery mechanism" note.
- **mediaMode poster/off short-circuit.** `handleMedia` runs no driver and surfaces no affordance outside `reference` mode; the Task 1 string + fragment gates already neutralize the source so zero media bytes are fetched in poster mode (13-RESEARCH Open Q3).
- **No D27 ledger entry this plan.** This is a renderer-only slice; the oracle compares the EXTRACTED (capture) stream, which this plan does not touch. The media-playback-sync fixture + the D27 entry land together in Plan 13-04 (the stale-entry discipline -- D26/13-01/13-02 precedent). Differential oracle stays green at 45/45.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Phase-12 CSP pins were stale after the planned media-src add**
- **Found during:** Task 1 (full-suite regression after the `CSP_META` change)
- **Issue:** Two `tests/renderer-snapshot.test.js` tests pinned the byte-exact Phase-12 CSP string and explicitly asserted "media-src is intentionally absent" / "defers media-src". The plan-mandated `media-src` add (CONTEXT/RESEARCH/plan all require it) invalidated those stale assertions.
- **Fix:** Updated the `CSP_CONTENT` pin and the second test to the Phase-13 contract: `media-src http: https: data:` present, `default-src 'none'` + no `script-src` retained, and a new assertion that no `blob:` is added (the Phase-14 boundary).
- **Files modified:** `tests/renderer-snapshot.test.js`
- **Verification:** Full suite 577/577.
- **Committed in:** `9cca62e` (Task 1 commit)

**2. [Rule 2 - Missing Critical] innerHTML-sink allowlist had to admit the two new static glyph writes**
- **Found during:** Task 2 (full-suite regression after adding the affordances)
- **Issue:** `tests/security-chokepoint-purity.test.js` audits the exact count of `innerHTML =` sinks per renderer file (a security chokepoint guard). Adding `mediaBlockedBtn.innerHTML = MEDIA_GLYPH.play` and `icon.innerHTML = MEDIA_GLYPH.mutedSpeaker` raised `overlays.js` from 2 to 4 sinks.
- **Fix:** Bumped the allowlist to `overlays.js: 4` with a comment documenting that all four are STATIC inline-SVG glyph constants (the sanctioned zero-dependency icon pattern; no payload-derived string is ever assigned via innerHTML), and updated the assertion message to name `MEDIA_GLYPH`. The security invariant is preserved -- a renderer-media test asserts no payload-derived markup is ever injected.
- **Files modified:** `tests/security-chokepoint-purity.test.js`
- **Verification:** Both guard tests green; the no-injection renderer-media test green.
- **Committed in:** `cd40cb0` (Task 2 commit)

**3. [Rule 1 - Bug] Semantic-addressing remote-control guard over-broadly banned all click listeners**
- **Found during:** Task 2 (full-suite regression)
- **Issue:** A Phase-07 test (`semantic addressing does not expand renderer remote-control dispatch behavior`) blanket-forbade any `addEventListener('click', ...)` in the renderer to keep the reverse remote-control surface from expanding. The UI-SPEC-mandated affordance activation adds local `click`/`keydown` listeners that drive the in-iframe element and NEVER forward over the wire.
- **Fix:** Narrowed the guard to the input-FORWARDING event names that actually represent remote control (`type`/`scroll`/pointer/mouse) and added a stronger assertion that NO renderer DOM listener reaches `transport.send`/`safeSend` (the affordances are local-only). The real guarantee (no remote-control expansion) is preserved and tightened.
- **Files modified:** `tests/semantic-addressing.test.js`
- **Verification:** The guard test green; the new wire-forwarding regex does not false-positive on existing renderer code.
- **Committed in:** `cd40cb0` (Task 2 commit)

---

**Total deviations:** 3 auto-fixed (2 stale-test-contract bugs, 1 over-broad security guard narrowed).
**Impact on plan:** All three are test-contract corrections forced by the plan's own mandated changes (the media-src add and the first interactive overlays); each preserves or strengthens the original security/contract guarantee. No production scope creep.

## Issues Encountered
- The 44x44 hit-target floor lived only in the CSS class, so the jsdom test (which reads inline `style.minWidth`) saw it empty; fixed by also setting `minWidth`/`minHeight` inline on the play button so the floor holds regardless of CSS delivery (13-UI-SPEC hard contract). Caught and resolved within the Task 2 RED/GREEN cycle, no fix-attempt loop.

## User Setup Required
None - no external service configuration required. This plan adds renderer glue (CSP directive, a string-layer URL gate, three overlay renderFns, the playback driver) and tests; no env vars, no installs (zero packages, per threat register T-13-SC), no service registrations.

## Threat Mitigations Applied
- **T-13-08 (viewer-side SSRF via media URLs):** `<video src>`/`poster`/`<source src>` to a blocked origin are neutralized at the STRING layer (`gateSnapshotAssets`) BEFORE the srcdoc parser can prefetch (Pitfall 5); `gateFragmentMedia` re-asserts post-parse; `media-src` is the CSP backstop. The shipped `classifyAssetOrigin` fail-closed denylist is the classifier.
- **T-13-09 (tracking-pixel / live-viewer confirmation):** the origin gate + `mediaMode` posture -- `poster` strips `<video/source src>` (no media GET), `off` blocks all -- so the GET never issues for a blocked origin.
- **T-13-10 / sandbox (script execution in the mirror):** the iframe sandbox stays EXACTLY `allow-same-origin` (asserted at `src/renderer/index.js`); no `allow-scripts`/`allow-autoplay`; all playback is parent-realm drive; `default-src 'none'` keeps no `script-src`.
- **T-13-11 (mXSS via media markup):** media URLs are rewritten as TYPED attribute values in the markup-about-to-emit (the quote-aware string gate), never serialize-sanitized-DOM-then-reparse; affordance text via `textContent`; only static inline-SVG uses `innerHTML`.
- **T-13-12 (onMediaBlocked hook DoS / wedged mirror):** the hook is wrapped in try/catch -> logger, never rethrown; a blocked `play()` shows the affordance and the rest of the mirror keeps updating (tested: a subsequent pause still drives the element).
- **T-13-13 (oversized data: media):** `media-src data:` is for small poster data URIs only (Phase 12 caps inline image bytes); media BYTES are never inlined (reference-only); no `blob:` this phase; relay 1 MiB cap untouched.

## Next Phase Readiness
- **Ready for Plan 13-04 (oracle slice / UAT):** the renderer now plays a mirrored video in lockstep cross-realm and never wedges on a blocked play. A `media-playback-sync` fixture instantiating `<video>`/`<audio>` will make capture emit `media[]` + `STREAM.MEDIA` (the extracted-only divergence the D27 ledger entry pins -- exactly where the plan deferred it). The real-Chrome muted-autoplay / `seekable.end`-throws / true-seek behavior is the documented Playwright UAT (jsdom has no media timeline; the muted-default + affordance design is correct regardless -- Open Q1 RESOLVED).
- **Ready for Phase 14 (adaptive streaming):** the `media-src` add deliberately omits `blob:` (the Phase-14 MSE concern); the sandbox token and the parent-realm-drive pattern are the seam the parent-realm `hls.js` MSE binding will extend.
- No blockers. The reconciler tolerances are a config field (`mediaReconcileConfig`, default-merged), tunable against the v2.1 evaluation harness per the STATE.md Phase 13 concern.

---
*Phase: 13-video-audio-url-playback-sync*
*Completed: 2026-06-21*

## Self-Check: PASSED

- FOUND: src/renderer/snapshot.js
- FOUND: src/renderer/overlays.js
- FOUND: src/renderer/index.js
- FOUND: tests/renderer-media-csp.test.js
- FOUND: tests/renderer-media.test.js
- FOUND: .planning/phases/13-video-audio-url-playback-sync/13-03-SUMMARY.md
- FOUND commit: 9cca62e (Task 1)
- FOUND commit: cd40cb0 (Task 2)
- FOUND commit: 35eabb8 (Task 3)
- FOUND commit: fc6d101 (Task 3 baseline)
