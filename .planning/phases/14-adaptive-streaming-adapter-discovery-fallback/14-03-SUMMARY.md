---
phase: 14-adaptive-streaming-adapter-discovery-fallback
plan: 03
subsystem: renderer
tags: [renderer, media, mse, hls, dash, adaptive, media-hint, overlays, poster, state-c, live, jsdom, testing]

# Dependency graph
requires:
  - phase: 14-adaptive-streaming-adapter-discovery-fallback (plan 01)
    provides: "STREAM.MEDIA_HINT='ext:dom-media-hint' op + MediaHintPayload typedef (the dispatch case this plan adds) + isCurrentStream (the hint staleness guard, accepts an empty-identity hint) + classifyManifest (the player's hls/dash branch detector)"
  - phase: 14-adaptive-streaming-adapter-discovery-fallback (plan 02)
    provides: "createMediaPlayer(deps) -> { attach, degrade, destroy, destroyAll } -- the parent-realm decision-tree player this plan constructs in createViewer; the media-unavailable overlay + CSP media-src blob: the degrade sink uses"
  - phase: 14-adaptive-streaming-adapter-discovery-fallback (plan 04)
    provides: "both adapters emit STREAM.MEDIA_HINT (page- or element-scoped, identity-stamped) -- the real producer this renderer wiring consumes"
  - phase: 13-video-audio-url-playback-sync
    provides: "handleMedia/applyMediaAction (the rejoin-edge live branch reused verbatim) + ensurePlaying + resolveNidRect + safeInvokeMediaHook + gateAssetUrl/gateAsset (the fail-closed re-gate) + mediaFirstBind.clear (the new-identity reset site) + the registered-but-never-shown renderMediaPoster (State-C caption this plan finally drives)"
provides:
  - "src/renderer/index.js: createMediaPlayer(deps) constructed in createViewer (parent realm; sandbox unchanged) with contained onMediaUnavailable + showOverlay/resolveNidRect/ensurePlaying/gateAsset deps"
  - "handleMediaHint dispatch (case STREAM.MEDIA_HINT): streaming+identity gate -> RE-GATE manifestUrl (V12/SSRF defense in depth) -> element-scope immediate bind / page-scope most-recent-wins store"
  - "page->element correlation: pendingHints (most-recent-wins per kind) + maybeConsumePageHint -- an MSE-opaque (source-less) element consumes the latest page hint on play; idempotent per nid per generation"
  - "mediaPlayer.destroyAll() + pendingHints/hintBoundNids clear on a new stream identity in handleSnapshot (Pattern 2 teardown; no orphaned players / object-URL leak)"
  - "playerFactory + onMediaUnavailable createViewer config keys (config-callback family, function-or-ignored, contained)"
  - "the Phase-13 State-C media-poster caption WIRED from handleMedia poster-mode (shown IFF no surviving poster) -- 13-UI-REVIEW Fix 1 BLOCKER closed"
affects: [14-05-packaging, 15-media-security]

# Tech tracking
tech-stack:
  added: []  # zero new runtime deps; dependencies stays { ws: 8.21.0 }; package:smoke exit 0 with hls.js absent; no top-level hls.js import in index.js (it imports only createMediaPlayer)
  patterns:
    - "Dispatch twin + re-gate at the consumer: a new STREAM.* op routes to a handler that re-applies the SAME fail-closed gate the producer used (defense in depth -- the hint is attacker-influenced); a blocked origin degrades to poster, never fetched"
    - "Best-effort page->element correlation via a most-recent-wins pendingHints store consumed on play by a source-less element -- never block on perfect correlation; idempotent per element per generation (hintBoundNids)"
    - "Pattern 2 consumed: mediaPlayer.destroyAll() on the new-identity snapshot reset (alongside mediaFirstBind.clear()) tears down every parent-realm player + revokes object URLs before the document swap"
    - "Contained host-callback family: onMediaUnavailable wrapped in the same safeInvokeMediaHook containment as onMediaBlocked -- a throwing host hook is logger-trapped, never rethrown (double-contained with media-player.js's own sink)"
    - "Dead-code closure via a single drive site: the State-C media-poster caption (registered Plan-13 era, never show()n) is driven from one handleMedia branch -- shown IFF el has no surviving poster, else null-hidden"

key-files:
  created: []
  modified:
    - src/renderer/index.js
    - tests/renderer-media.test.js
    - tests/media-reconcile.test.js

key-decisions:
  - "page-hint correlation: an element is the consumer iff it is MSE-opaque (no surviving `src` attr, empty currentSrc, no child `source[src]`) -- mediaElementHasNoSource() reads are all guarded; an unknowable element is conservatively NOT a consumer"
  - "pendingHints keyed by kind (hls|dash) with most-recent-wins per kind; consumption picks the most-recently-stored across kinds (storedAt) and deletes it so one page hint maps to one consumer"
  - "scope defaulting: payload.scope is authoritative ('element'|'page'); when absent, presence of payload.nid implies element scope else page scope (tolerant of a thin producer)"
  - "onMediaUnavailable double-containment: wrapped at the index.js call site (safeInvokeMediaHook, the onMediaBlocked family) AND inside media-player.js's degrade sink -- intentional defense in depth, harmless"
  - "State-C wire lives in handleMedia's poster-mode early-return (not a new handler) per 13-UI-REVIEW Fix 1 + the plan <state_c_wire_spec>; 'off' mode still renders nothing; the poster-survival check is el.getAttribute('poster') AFTER gateFragmentMedia ran on the snapshot"
  - "Live reuse is ASSERTED, not re-implemented: media-reconcile pins live:true -> rejoin-edge with NO absolute toTime, and renderer tests prove applyMediaAction seeks seekable.end (live edge) only under seekable.length>0 and never to the payload absolute time -- no new live sync code (MADPT-04)"

patterns-established:
  - "Re-gate-at-the-consumer: every adapter-originated URL is re-gated through the same fail-closed gate at the viewer before any use (T-14-10 SSRF defense in depth)"
  - "Most-recent-wins page-hint store consumed on play by a source-less element (best-effort correlation; idempotent per generation)"
  - "Pattern 2 (teardown on new identity) consumed in the renderer: destroyAll() on the snapshot reset so a re-snapshot never orphans a parent-realm player / leaks an object URL"

requirements-completed: [MADPT-02, MADPT-03, MADPT-04]

# Metrics
duration: 6min
completed: 2026-06-21
---

# Phase 14 Plan 03: Renderer Adaptive-Player Wiring + State-C Caption Summary

**Wired the parent-realm adaptive player into the live viewer end-to-end: `createMediaPlayer(deps)` is constructed in `createViewer`, a new `STREAM.MEDIA_HINT` dispatch case routes to `handleMediaHint` (streaming+identity gate -> RE-GATE the `manifestUrl` through the same fail-closed `gateAsset` -> element-scope immediate bind or page-scope most-recent-wins store consumed by an MSE-opaque element on play), every live player is `destroyAll()`-torn-down on a new-identity snapshot, live manifests provably REUSE the Phase-13 `rejoin-edge` branch (no absolute seek, no new sync code), the `playerFactory`/`onMediaUnavailable` config keys are live and contained, and — closing the Phase-13 UI-review BLOCKER — the registered-but-dead State-C `media-poster` caption is finally driven from `handleMedia` (shown iff no surviving poster). Full suite 659/659, differential oracle 48/48 unchanged, `package:smoke` exit 0 with hls.js absent, `dependencies` still `{ ws }`.**

## Performance

- **Duration:** ~6 min
- **Started:** 2026-06-21T11:37:18Z
- **Completed:** 2026-06-21T11:43:00Z
- **Tasks:** 3 (all TDD: RED test -> GREEN impl per task)
- **Files modified:** 3 (0 created, 3 modified)
- **Tests:** 640 -> 659 (+19: +10 hint dispatch/config, +5 destroyAll & live-reuse, +4 State-C caption)

## Accomplishments

- **STREAM.MEDIA_HINT consumption (MADPT-02):** added `case STREAM.MEDIA_HINT: handleMediaHint(payload)` directly after the `STREAM.MEDIA` case (old viewers still hit the dispatch `default` and ignore the op). `handleMediaHint` staleness-guards via `isCurrentStream`, drops hints in poster/off mode, **re-gates `manifestUrl` through `gateAsset(url,'media')` BEFORE any use** (a blocked origin -> `mediaPlayer.degrade(target,'no-manifest')`, never fetched — T-14-10/V12 SSRF defense in depth), then element-scope binds immediately (resolvable + MSE-opaque element -> `mediaPlayer.attach(el, manifestUrl, {nid,kind,contentType})`) or page-scope stores into a most-recent-wins-per-kind `pendingHints` map.
- **Best-effort page->element correlation:** `maybeConsumePageHint(el, nid)` (called from `handleMedia`) consumes the most-recent stored page hint when a source-less (`mediaElementHasNoSource`) element next plays — idempotent per nid per generation (`hintBoundNids`), the consumed hint is deleted so one page hint maps to one consumer. Never blocks on perfect correlation (locked).
- **Player teardown on re-snapshot (Pattern 2 / Pitfall 2):** `mediaPlayer.destroyAll()` runs in `handleSnapshot` alongside `mediaFirstBind.clear()`, tearing down every parent-realm player (revoking object URLs, freeing buffers) and clearing `pendingHints`/`hintBoundNids` BEFORE the new mirror document replaces the prior child elements — no orphaned players / object-URL leak across snapshots.
- **Live reuse asserted, not rebuilt (MADPT-04):** `media-reconcile.test.js` pins `live:true` large-drift -> `rejoin-edge` carrying **no absolute `toTime`**; `renderer-media.test.js` proves `applyMediaAction` seeks `seekable.end(seekable.length-1)` (the live edge) ONLY under `seekable.length > 0` and **never** to the payload's absolute `currentTime`, with an empty `seekable` holding. No new live sync path was introduced — the Phase-13 branch is reused verbatim.
- **Config keys (the config-callback family, NOT the throwing `on()` allowlist):** `playerFactory` (function or ignored) is the host HLS/DASH/Shaka seam; `onMediaUnavailable(nid,reason)` is the degrade-reason callback, **double-contained** — wrapped at the call site in `safeInvokeMediaHook` (the `onMediaBlocked` family) and again inside `media-player.js`'s degrade sink — so a throwing host hook can never wedge the mirror. A viewer with neither key still works (Phase-13 progressive path intact).
- **Phase-13 State-C caption WIRED (closes 13-UI-REVIEW Fix 1 BLOCKER):** `handleMedia`'s poster-mode early-return now drives the registered-but-never-`show()`n `media-poster` caption — in `poster` mode it shows `'Media (poster only)'` IFF the element has **no** surviving `poster` attribute (after `gateFragmentMedia`), else hides it; `off` mode renders nothing. `grep "show('media-poster'" src/renderer/index.js` now returns the call site (the dead-code gap is closed).

## Task Commits

Each task committed atomically (TDD: RED test + GREEN impl folded into one feat commit each, since the new behavior extends already-tracked source/test files):

1. **Task 1: createMediaPlayer wiring + STREAM.MEDIA_HINT dispatch + page-hint store/consume + config keys** — `65ca315` (feat)
2. **Task 2: destroyAll() on re-snapshot + assert live rejoin-edge reuse (no absolute seek)** — `ce54582` (feat)
3. **Task 3: wire the Phase-13 State-C media-poster caption (close UI-review Fix 1)** — `92bb6fb` (feat)

**Plan metadata:** (final commit) `docs(14-03): complete renderer adaptive-player wiring plan`

## Files Created/Modified

- `src/renderer/index.js` — imported `createMediaPlayer`; added `playerFactory`/`onMediaUnavailable` config; constructed `mediaPlayer` after overlays (parent-realm deps: `doc`, `win`, `gateAsset`, contained `onMediaUnavailable`, `showOverlay`, `resolveNidRect`, `ensurePlaying`); added the `STREAM.MEDIA_HINT` dispatch case + `handleMediaHint` + `maybeConsumePageHint` + `mediaElementHasNoSource` + `bindAdaptiveHint` + the `pendingHints`/`hintBoundNids` state; added `mediaPlayer.destroyAll()` + hint clears in `handleSnapshot`; wired the State-C `media-poster` caption into the `handleMedia` poster-mode branch. (+224 lines)
- `tests/renderer-media.test.js` — +19 tests: a `recordingPlayerFactory` helper, hint dispatch (element/page bind, staleness drop, blocked-origin degrade, most-recent-wins, poster no-op, old-viewer-ignores), config-key acceptance + non-function-ignored graceful absence, destroyAll-on-re-snapshot (+ idempotent bare re-snapshot), live-edge seek under the `seekable.length>0` guard (+ empty-seekable hold), State-C caption (posterless->shown, poster->hidden, off->nothing, poster-appears->hide). (+455 lines)
- `tests/media-reconcile.test.js` — +1 test: the adaptive-live REUSE assertion (`live:true` large drift -> `rejoin-edge` with no absolute `toTime`). (+17 lines)

## Decisions Made

- **MSE-opaque consumer predicate:** an element consumes a page hint only when `mediaElementHasNoSource(el)` — no surviving `src` attribute, empty `currentSrc`, no child `source[src]` — with all reads guarded (an unknowable element is conservatively not a consumer). This is the viewer half of the "page hint matched on play" locked decision.
- **`pendingHints` keyed by kind, most-recent-wins:** storing per-kind lets a later HLS hint supersede an earlier one; consumption picks the most-recently-stored across kinds (`storedAt`) and deletes it (one hint -> one consumer).
- **`scope` defaulting is producer-tolerant:** `payload.scope` is authoritative; when absent, a present `nid` implies element scope, else page scope (the 14-04 adapters always set `scope`, but the viewer tolerates a thin producer).
- **`onMediaUnavailable` is double-contained** (call-site `safeInvokeMediaHook` + the player's degrade sink) — intentional defense in depth, harmless, matching the `onMediaBlocked` precedent.
- **State-C wire is one branch in `handleMedia`** (not a new handler) per 13-UI-REVIEW Fix 1 + the plan's `<state_c_wire_spec>`; poster survival is `el.getAttribute('poster')` after the snapshot's `gateFragmentMedia` ran; `off` mode still renders nothing.
- **Live handling is asserted reuse, not new code** (MADPT-04): the reconciler `rejoin-edge` branch and `applyMediaAction`'s `seekable.length>0`-guarded live-edge seek are pinned by tests; the adaptive player just binds the live manifest.

## Deviations from Plan

None — plan executed exactly as written.

The three tasks, file set, `<hint_consumption_spec>`, `<state_c_wire_spec>`, the `<interfaces>` anchors, and the threat-register mitigations (T-14-10 re-gate, T-14-11 staleness, T-14-06 destroyAll, T-14-12 contained host callback, T-14-13 old-viewer-ignores) were implemented verbatim. Rules 1–4 did not fire: no bugs, missing-critical-functionality, blocking issues, or architectural decisions arose. No authentication gates. **No packages were installed** — `dependencies` stays `{ ws: 8.21.0 }`, no top-level hls.js import leaked into `index.js` (it imports only `createMediaPlayer`, which keeps hls.js behind its dynamic import), and `package:smoke` exits 0 with hls.js absent.

## Issues Encountered

One self-inflicted **test-harness** issue (not an implementation bug), caught and fixed during the Task-1 GREEN run: the initial `createViewer accepts ...` test created two viewers on a single `setupEnv()` `env`, so the second viewer's iframe/transport shadowed the first and `env.document.querySelector('iframe')` resolved the wrong element (the existing suite uses one fresh `env` per test). Split it into two tests (each with a fresh `env`), which also improved coverage by adding the explicit non-function-ignored graceful-absence assertion the behavior spec calls for. All other RED phases failed exactly as expected (no dispatch case / no `destroyAll` / no State-C `show`) and all GREEN implementations passed on the first run after the harness fix. Node v25.x is the live runtime (CLAUDE.md notes v24.x; no behavioral difference for `node:test`).

## Known Stubs

None. `handleMediaHint`, the `pendingHints`/`maybeConsumePageHint` correlation, `destroyAll()` teardown, the live-reuse assertions, and the State-C caption wire are all real, tested logic — not placeholders. The only `new Map()`/`new Set()` additions (`pendingHints`, `hintBoundNids`) are live correlation state, not UI-bound stubs. The live cross-realm MSE proof (a real `MediaSource` blob bound to an in-iframe `<video>` with hls.js `attachMedia`, live-edge sync, segment fetch, DRM degrade observed in Chrome) remains the milestone's **documented deferred UAT** (the FSB browser runs tabs hidden -> Chrome suspends media decode; jsdom has no MSE timeline) — exercised here through the Plan-02 stub seams and the never-break poster fallback, per the tracked STATE.md Phase-14 blocker. That is a deferral, not a stub.

## Threat Flags

None. The plan's `<threat_model>` register is satisfied and proven by the new tests, with no NEW security surface beyond the declared register (no new network endpoint, no auth path, no schema change at a trust boundary; the capture wire is byte-unchanged — differential oracle 48/48):
- **T-14-10 (V12/SSRF — handleMediaHint fetching an attacker manifest):** mitigated — `handleMediaHint` re-gates `manifestUrl` with `gateAsset` (https-only + private-range deny, fail-closed) BEFORE binding; a blocked origin -> `degrade('no-manifest')`, never fetched (the `http://10.0.0.5/...` blocked-origin test).
- **T-14-11 (stale/late hint binds the wrong media):** mitigated — `isCurrentStream(payload, active)` drops mismatched identity (the `STALE/999` test); `pendingHints` is cleared on every new snapshot identity.
- **T-14-06 (orphaned parent object-URLs / dead-element players across re-snapshots):** mitigated — `mediaPlayer.destroyAll()` on every new-identity snapshot before the document swap (the two-snapshot destroy test).
- **T-14-12 (throwing host `onMediaUnavailable`/`playerFactory`):** mitigated — `onMediaUnavailable` is invoked through `safeInvokeMediaHook` (logger-trapped, never rethrown) AND the player's degrade sink; a throwing `playerFactory` is contained by media-player.js. The mirror keeps updating.
- **T-14-13 (old viewers crash on STREAM.MEDIA_HINT):** mitigated — the dispatch `default` silently ignores the op (the old-viewer-ignores test; no error logged); envelope/relay byte-unchanged.
- **T-14-SC (installs):** mitigated — this plan installed nothing; `dependencies` stays `{ ws }`; `package:smoke` exit 0 with hls.js absent.

## Next Phase Readiness

- **Adaptive is observable end-to-end:** both 14-04 adapters emit `STREAM.MEDIA_HINT` and the viewer now consumes it (re-gate -> element/page bind), degrades unmirrorable media to poster with a reason, and reuses the Phase-13 live-edge sync. The Phase-13 State-C UI-review BLOCKER is closed.
- **Plan 14-05 (packaging)** is the remaining Phase-14 slice — it adds hls.js under `peerDependencies` + `peerDependenciesMeta.optional` (NOT `dependencies`). This plan deliberately left hls.js uninstalled; `package:smoke` already proves the renderer (incl. the new `createMediaPlayer` wiring) imports clean without it.
- **Phase 15 (media security)** inherits the documented parent-realm object-URL teardown surface (T-14-06) and the re-gated hint surface (T-14-10) for the full MSEC-04 threat model + MSEC-03 masking vocabulary.
- The cross-realm MSE-binding spike (STATE.md blocker) is unaffected by this renderer wiring — it lives behind the player's feature-detection + poster fallback and is the tracked deferred UAT.
- Full suite **659/659** green (baseline 640 + 19); differential oracle **48/48** unchanged; `package:smoke` exit 0 (hls.js absent); `dependencies` = `{ ws: 8.21.0 }`; sandbox stays exactly `allow-same-origin`; no top-level hls.js import in `index.js`.

## Self-Check: PASSED

- FOUND: `src/renderer/index.js` (createMediaPlayer construction; `handleMediaHint` + `gateAsset(manifestUrl,...)` re-gate; `pendingHints` + `maybeConsumePageHint`; `mediaPlayer.destroyAll()` in handleSnapshot; State-C `overlays.show('media-poster', ...)` call site @ lines 1819/1821)
- FOUND: `tests/renderer-media.test.js` (47 tests; +19 new across hint dispatch, destroyAll/live-reuse, State-C)
- FOUND: `tests/media-reconcile.test.js` (34 tests; +1 adaptive-live-reuse assertion)
- FOUND commit `65ca315` (Task 1), `ce54582` (Task 2), `92bb6fb` (Task 3)
- Full suite 659/659; differential oracle 48/48; plan files (renderer-media + media-reconcile) 81/81; `package:smoke` exit 0 with hls.js absent; `dependencies` = `{ ws: 8.21.0 }`; no top-level hls.js import in `index.js`; sandbox exactly `allow-same-origin`; `grep show('media-poster' src/renderer/index.js` returns the new call site (UI-review Fix 1 closed)

---
*Phase: 14-adaptive-streaming-adapter-discovery-fallback*
*Completed: 2026-06-21*
