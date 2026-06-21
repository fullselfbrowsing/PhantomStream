---
phase: 14-adaptive-streaming-adapter-discovery-fallback
plan: 02
subsystem: renderer
tags: [renderer, media, mse, hls, adaptive, overlays, csp, fallback, drm, jsdom, testing]

# Dependency graph
requires:
  - phase: 14-adaptive-streaming-adapter-discovery-fallback
    provides: "STREAM.MEDIA_HINT op + MediaHintPayload typedef (Plan 03 dispatch); classifyManifest({url}) HLS/DASH/null classifier (the player's hls/dash branch detector); the renderer-media-player.test.js Wave-0 harness + installStubMediaSource/stubVideoEl stubs these tests extend"
  - phase: 13-video-audio-url-playback-sync
    provides: "renderMediaPoster (the media-unavailable clone source) + the overlay register/show/safeRenderOverlay seam; the CSP_META media-src directive (Phase-13 boundary this plan flips to add blob:); ensurePlaying / gateAssetUrl / resolveNidRect the player's deps wrap; the onMediaBlocked config-callback family the onMediaUnavailable hook mirrors"
provides:
  - "src/renderer/media-player.js — createMediaPlayer(deps) + attach() decision tree (native-HLS-first -> host playerFactory -> optional lazy hls.js -> degrade-to-poster), tryLazyImportHls (dynamic import only), the single degrade(nid,reason) sink, per-nid registry + destroy/destroyAll. The one net-new Phase-14 capability; Plan 03 wires it into the dispatch loop."
  - "the media-unavailable overlay (renderMediaUnavailable) — the passive degrade-reason caption (the fourth media affordance), reason-as-data-attribute, textContent-only, null-hides"
  - "CSP media-src `http: https: data: blob:` — the only Phase-14 CSP edit (the parent-realm MSE object-URL play permission); default-src 'none' / no script-src / no connect-src retained; sandbox allow-same-origin unchanged"
affects: [14-03-renderer-player-wiring, 14-04-fallback, 14-05-packaging, 15-media-security]

# Tech tracking
tech-stack:
  added: []  # zero new runtime deps; dependencies stays { ws: 8.21.0 }. hls.js stays UNINSTALLED (referenced only via the guarded dynamic import; packaging as an optional peerDependency is Plan 14-05).
  patterns:
    - "Decision-tree player behind feature-detection + try/catch containment: every branch (gate/native/factory/lazy-hls/dash) routes failure to a single degrade(reason) sink; attach() never rethrows (the never-break contract, Pattern 1)"
    - "Dynamic-import-only optional dependency: hls.js is referenced ONLY via `await import('hls.js')` inside a try/catch function (tryLazyImportHls), never a top-level import -- keeps the renderer importable with hls.js absent (package:smoke green, zero-hard-dep intact)"
    - "Per-nid player registry with destroy/destroyAll: parent-realm object-URL + adapter teardown on degrade and on re-snapshot (Pattern 2 -- teardown on new identity, consumed in Plan 03)"
    - "Passive overlay clone: the media-unavailable caption is a near-clone of renderMediaPoster (textContent-only, pointer-events none, no accent); the reason rides a data- attribute via setAttribute, never markup -- the innerHTML sink allowlist is unchanged"
    - "TEST SEAM via dependency injection: a tryLazyImportHls dep override + a stub win carrying MediaSource + a controllable-canPlayType video stub + a fake playerFactory exercise every branch in jsdom with zero installed players"

key-files:
  created:
    - src/renderer/media-player.js
  modified:
    - src/renderer/overlays.js
    - src/renderer/snapshot.js
    - tests/renderer-media-player.test.js
    - tests/renderer-media.test.js
    - tests/renderer-media-csp.test.js
    - tests/renderer-snapshot.test.js

key-decisions:
  - "Wired the internal lazy-hls adapter now (not docs-only) -- it IS a PlayerAdapter, dynamic-import-guarded, and the degrade('no-player')-when-absent test proves graceful absence (14-RESEARCH Open Question 3 recommendation). Keeps the just-`npm i hls.js` path while staying zero-hard-dep."
  - "attach() is synchronous for the native/factory/no-MSE/dash/no-manifest branches (so a non-awaiting caller still observes the degrade) and returns a Promise ONLY for the async lazy-hls branch. The Plan-03 dispatch can fire-and-forget; tests await only the lazy paths."
  - "deps carry an injectable tryLazyImportHls override (TEST SEAM) defaulting to the real dynamic-import helper -- the suite drives both the hls.js-absent (null) and stub-Hls paths in jsdom without installing any player."
  - "The media-unavailable overlay reuses zIndex 24 + the poster-caption CSS parity values (rgba(0,0,0,0.75)/#e0e0e0/600 13px system-ui) with NO amber accent; reason via data-ps-reason (setAttribute) so the innerHTML allowlist (overlays.js: 4) is byte-unchanged (T-14-09)."
  - "Flipped the Phase-13 CSP boundary in BOTH pinning locations (renderer-media-csp.test.js AND renderer-snapshot.test.js) -- the second file's CSP_CONTENT verbatim pin + 'no blob: yet' assertion were equally Phase-13 markers (comments said 'that is Phase 14's MSE add') and had to move with the source edit."

patterns-established:
  - "Pattern 1 (One degrade sink, every branch contained): the whole adaptive surface is try/catch-wrapped to a single degrade(reason) -> onMediaUnavailable + media-unavailable overlay + poster fallback. attach() never throws."
  - "Pattern: dynamic-import-only optional peer -- the renderer imports cleanly with the optional dep absent; the lazy import returns null and the code degrades. Proven by package:smoke (exit 0, hls.js uninstalled)."
  - "Pattern 2 (Teardown on new identity): per-nid registry + destroyAll() so Plan 03 can revoke parent object URLs and detach players before a re-snapshot replaces the child elements."

requirements-completed: [MADPT-01, MADPT-03]

# Metrics
duration: 14min
completed: 2026-06-21
---

# Phase 14 Plan 02: Parent-Realm Adaptive Media Player + Fallback Taxonomy + CSP blob: Summary

**Built the one genuinely net-new Phase-14 capability — a renderer-owned PARENT-REALM `createMediaPlayer` whose `attach()` runs native-HLS-first -> host `playerFactory` -> optional lazy `import('hls.js')` -> degrade-to-poster behind feature-detection and full try/catch containment, with every unmirrorable path (no-manifest/no-player/mse-opaque/drm) funnelled through a single `degrade(nid,reason)` sink (onMediaUnavailable + the new passive `media-unavailable` overlay) — added the `media-src blob:` CSP edit (flipping the Phase-13 boundary in both pin locations), all stub-tested in isolation; full suite 624/624, differential oracle 48/48 unchanged, `dependencies` still `{ ws }`.**

## Performance

- **Duration:** ~14 min
- **Tasks:** 3 (all TDD: RED test -> GREEN impl per task)
- **Files:** 6 (1 created, 5 modified)
- **Tests:** 601 -> 624 (+23: +18 player decision-tree, +5 media-unavailable overlay; the CSP/snapshot pins flipped in place)

## Accomplishments

- **`src/renderer/media-player.js` (NEW, 350 lines)** — `createMediaPlayer(deps)` exposing `attach(videoEl, manifestUrl, ctx)`, `degrade(nid, reason)`, `destroy(nid)`, `destroyAll()`. `attach()` implements the `<decision_tree>` VERBATIM: (1) `gateAsset` blocked -> `degrade('no-manifest')`; (2) native-HLS (`classifyManifest === 'hls'` AND `canPlayType('application/vnd.apple.mpegurl') in {'probably','maybe'}`) -> set child `videoEl.src` directly, NO MSE/library, return `{kind:'native'}`; (3) host `playerFactory(ctx).attach(...)` with `onError -> degrade`; (4) optional lazy hls.js (HLS only, no factory): feature-detect `ManagedMediaSource||MediaSource`, `await tryLazyImportHls()`, `loadSource()` THEN `attachMedia()`; (5) DASH no-factory -> `degrade('no-player')`; (6) unhandled -> `degrade('no-manifest')`. The whole body is try/catch-contained -> `degrade('mse-opaque')` on any throw; **never rethrows**.
- **`tryLazyImportHls()`** — the dynamic-`import('hls.js')`-in-a-function helper, try/catch -> null. The ONLY hls.js reference is this dynamic import (no top-level import), so the renderer stays importable with hls.js absent (`package:smoke` exit 0). A `deps.tryLazyImportHls` override is the test seam.
- **The single `degrade(nid, reason)` sink** — tears down the live player for nid (host/lazy `player.destroy()`, then `removeAttribute('src')` + `load()` on the inert child, all guarded), shows `media-unavailable` over `resolveNidRect(nid)`, keeps the poster, and invokes `onMediaUnavailable(nid, reason)` through a contained `safeInvokeMediaHook` (logger-trapped, never rethrown). Per-nid `Map` registry; `destroyAll()` for Plan 03's re-snapshot reset.
- **DRM (T-14-05):** `emeEnabled` is never passed true; the child `'encrypted'` event (one-shot listener) AND an hls.js fatal `KEY_SYSTEM_ERROR` both route to `degrade('drm')`. A fatal non-DRM hls error -> `degrade('mse-opaque')`; a non-fatal error is ignored.
- **`media-unavailable` overlay** — `renderMediaUnavailable(value, anchorRect)` registered as the fourth media affordance: a passive near-clone of `renderMediaPoster` (centered `textContent='Media unavailable'`, `zIndex 24`, `pointer-events:none`, no accent, no activation; null hides). The four reason codes ride `data-ps-reason` via `setAttribute` — diagnostic only, never markup. `.ps-overlay-media-unavailable` CSS reuses the poster-caption parity values; no amber accent. The `innerHTML` sink allowlist (overlays.js: 4) is unchanged (T-14-09).
- **CSP `media-src ... blob:`** — the single source edit in `snapshot.js` `CSP_META` (`media-src http: https: data:` -> `media-src http: https: data: blob:`) lets the inert in-iframe `<video>` PLAY the parent-minted MediaSource object URL. `default-src 'none'` retained; NO `script-src`; NO `connect-src` (Pitfall 5 — the iframe fetches nothing in the MSE path); `blob:` is media-src ONLY (not img-src); sandbox stays exactly `allow-same-origin`.

## Task Commits

Each task committed atomically (TDD: RED test + GREEN impl folded into one feat commit each, since the new behavior extends already-tracked test files):

1. **Task 1: media-player.js decision tree + degrade sink + 18 stub-driven tests** — `ef005a4` (feat)
2. **Task 2: media-unavailable overlay (clone of renderMediaPoster) + 5 tests** — `a222e21` (feat)
3. **Task 3: CSP media-src gains blob: + flip the dedicated CSP test** — `6e9912e` (feat)
4. **Rule 1 fix: flip the second CSP exact-string pin (renderer-snapshot.test.js)** — `6e1641e` (test)

**Plan metadata:** (final commit) `docs(14-02): complete adaptive media-player + fallback + CSP blob: plan`

## Files Created/Modified

- `src/renderer/media-player.js` — NEW. The full parent-realm decision-tree player (see Accomplishments). One top-level `import { classifyManifest }`; the dynamic `import('hls.js')` lives inside `tryLazyImportHls`.
- `src/renderer/overlays.js` — added `renderMediaUnavailable` + its `register('media-unavailable', ...)` call (next to the three existing media affordances), the `mediaUnavailableEl` state var, and the `.ps-overlay-media-unavailable` `OVERLAY_CSS` rule.
- `src/renderer/snapshot.js` — `CSP_META` media-src gains `blob:` (the single CSP edit); the adjacent comment records it as the Phase-14 MSE object-URL add and the no-connect-src/no-script-src rationale.
- `tests/renderer-media-player.test.js` — extended the Wave-0 scaffold with 18 decision-tree tests (native src-set + no-MSE-mint, fall-through on empty canPlayType, factory attach/destroy + DASH-via-factory, lazy-hls absent -> no-player, load-then-attach order, emeEnabled-never-true, mse-opaque on no-MSE, dash-no-factory, no-manifest blocked + unclassifiable, drm via encrypted event + KEY_SYSTEM_ERROR, fatal-vs-nonfatal hls error, throwing-factory containment, degrade teardown, destroyAll, hls.js-absent import). 19/19 green (incl. the original Wave-0 placeholder).
- `tests/renderer-media.test.js` — added 5 media-unavailable overlay tests (passive textContent caption, reason-as-data-attribute, null-hides, hostile-string-no-innerHTML, CSS parity).
- `tests/renderer-media-csp.test.js` — flipped the Phase-13 boundary: media-src must carry `blob:` (was: asserts blob: absent), blob: scoped to media-src not img-src, + a no-connect-src assertion.
- `tests/renderer-snapshot.test.js` — flipped the second CSP pin (the `CSP_CONTENT` verbatim-meta pin + the `no blob: yet` assertion) to the Phase-14 shape + no-connect-src (the Rule 1 fix).

## Decisions Made

- **Wired the internal lazy-hls adapter now** (14-RESEARCH Open Question 3) — it is a real `PlayerAdapter`, dynamic-import-guarded; the `degrade('no-player')`-when-absent test proves graceful absence. Users get the `npm i hls.js` path while the package stays zero-hard-dep.
- **`attach()` is sync for the non-lazy branches, async only for lazy-hls** — so the Plan-03 dispatch can fire-and-forget and a non-awaiting test still observes a synchronous degrade; only the lazy path returns a Promise.
- **TEST SEAM: an injectable `tryLazyImportHls` dep** (defaulting to the real dynamic import) — drives both the absent (null) and stub-Hls paths in jsdom with zero installed players, keeping the suite `node --test`-runnable.
- **media-unavailable: text-only + reason-as-data-attribute** — so the `innerHTML` allowlist count stays at 4 (no new sink); CSS parity with the poster caption, no amber accent (it is passive, not actionable).
- **Flipped BOTH CSP pin locations** — the `renderer-snapshot.test.js` `CSP_CONTENT` pin and `no-blob` assertion were equally Phase-13 boundary markers and had to move with the source (Rule 1).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Flipped the second CSP exact-string pin in renderer-snapshot.test.js**
- **Found during:** Task 3 verification (full-suite run after the media-src edit)
- **Issue:** The plan named `tests/renderer-media-csp.test.js` as the CSP boundary test, but `tests/renderer-snapshot.test.js` independently pins the EXACT CSP string in a `CSP_CONTENT` constant (a verbatim-meta position test) and asserts `!html.includes('blob:')`. The Task-3 source edit broke both (2 failures) — they were a second Phase-13 boundary location (their own comments said "no blob: -- Phase 14" / "that is Phase 14's MSE add").
- **Fix:** Updated `CSP_CONTENT` to `media-src http: https: data: blob:` and flipped the `no blob: yet` assertion to require blob: in media-src (scoped, not img-src) + a no-connect-src assertion (Pitfall 5) — the same flip the dedicated CSP test got. This is the intended Phase-13->14 boundary move, applied to the second pin.
- **Files modified:** `tests/renderer-snapshot.test.js`
- **Commit:** `6e1641e`

No other deviations. The decision tree, degrade sink, overlay, and CSP edit were implemented per the `<decision_tree>` and `<interfaces>` verbatim. Rules 2/3/4 did not fire. No packages were installed (`dependencies` stays `{ ws: 8.21.0 }`; hls.js is referenced only via the guarded dynamic import).

## Issues Encountered

None blocking. The TDD RED phases failed as expected (module-not-found for the player; unregistered overlay kind + missing CSS for the overlay; the unflipped blob: assertion for CSP). All GREEN implementations passed; the only follow-on was the in-scope second-pin flip above. Node v25.x is the live runtime (CLAUDE.md notes v24.x; no behavioral difference for `node:test`).

## Known Stubs

None. `media-player.js` is fully implemented (the decision tree, degrade sink, registry, DRM detection, and teardown are all real, tested logic — not placeholders); the `media-unavailable` overlay is fully wired; the CSP edit is real. The only `=[]` in the module is a local accumulator in `destroyAll`, not a UI-bound stub.

The live cross-realm MSE proof (A1/A5 — a real `MediaSource` blob bound to an in-iframe `<video>` with hls.js `attachMedia`) is a **documented deferred UAT** (the FSB browser runs tabs hidden -> Chrome suspends media decode; jsdom has no MSE), exercised here with stubs (`installStubMediaSource`, stub `Hls`, stub `canPlayType`). This is the milestone's tracked deferral (STATE.md Phase-14 blocker), not a masking stub — the poster fallback is the never-break safety net regardless of the spike outcome.

## Threat Flags

None. The plan's `<threat_model>` (T-14-04 parent-realm-only player + unchanged sandbox; T-14-05 emeEnabled-false DRM degrade via encrypted + KEY_SYSTEM_ERROR; T-14-06 parent object-URL teardown via destroy/destroyAll; T-14-07 try/catch containment / attach never throws; T-14-08 blob:-only CSP, no connect-src/script-src; T-14-09 textContent-only overlay, reason-as-data-attribute) is satisfied by Tasks 1-3 and proven by the new tests. No NEW security surface beyond the declared register: no new network endpoint, no auth path, no schema change at a trust boundary. The capture wire is byte-unchanged (renderer-only slice) — differential oracle 48/48. The full parent-realm object-URL threat model (MSEC-04) and the masking vocabulary (MSEC-03) remain Phase 15, as scoped.

## Next Phase Readiness

- **Plan 03 (renderer wiring)** can now import `createMediaPlayer` and inject the live deps (`doc`/`win` from the iframe, `gateAssetUrl` as `gateAsset`, `resolveNidRect`, `ensurePlaying`, the `overlays.show` as `showOverlay`, and new `playerFactory`/`onMediaUnavailable` config keys). It adds the `STREAM.MEDIA_HINT` dispatch + `pendingHints` correlation, calls `attach()` on an MSE-opaque element's first play, and calls `destroyAll()` alongside `mediaFirstBind.clear()` on re-snapshot (Pattern 2 hook is ready).
- **Plan 04 (fallback)** has the `media-unavailable` overlay + the four reason codes wired; any further fallback nuance extends `degrade`.
- **Plan 05 (packaging)** is the one that adds hls.js under `peerDependencies` + `peerDependenciesMeta.optional` (NOT `dependencies`) — this plan deliberately left it uninstalled; `package:smoke` already proves the renderer imports clean without it.
- Full suite **624/624** green (baseline 601 + 23); differential oracle **48/48** unchanged; `package:smoke` exit 0 with hls.js absent; `dependencies` = `{ ws: 8.21.0 }`.

## Self-Check: PASSED

- FOUND: `src/renderer/media-player.js` (createMediaPlayer + attach decision tree + tryLazyImportHls @ dynamic import line 93 + degrade sink; 350 lines)
- FOUND: `src/renderer/overlays.js` (renderMediaUnavailable + register('media-unavailable') + .ps-overlay-media-unavailable CSS)
- FOUND: `src/renderer/snapshot.js` (CSP_META media-src `http: https: data: blob:`)
- FOUND: `tests/renderer-media-player.test.js` (19 green), `tests/renderer-media.test.js` (media-unavailable suite), `tests/renderer-media-csp.test.js` + `tests/renderer-snapshot.test.js` (flipped CSP pins)
- FOUND commit `ef005a4` (Task 1), `a222e21` (Task 2), `6e9912e` (Task 3), `6e1641e` (Rule 1 fix)
- Full suite 624/624; differential oracle 48/48; package:smoke exit 0; `dependencies` = `{ ws: 8.21.0 }`; no top-level hls.js import; innerHTML allowlist (overlays.js: 4) unchanged

---
*Phase: 14-adaptive-streaming-adapter-discovery-fallback*
*Completed: 2026-06-21*
