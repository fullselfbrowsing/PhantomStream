---
gsd_state_version: 1.0
milestone: v2.0
milestone_name: Asset & Media Streaming
status: executing
stopped_at: Completed 15-02-PLAN.md
last_updated: "2026-06-21T19:13:08.391Z"
last_activity: "2026-06-21 -- 15-02 complete: MSEC-04 no-referrer meta + omit-credentials posture shipped (renderer srcdoc)"
progress:
  total_phases: 15
  completed_phases: 13
  total_plans: 73
  completed_plans: 71
  percent: 87
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-06-19)

**Core value:** A live, trustworthy, low-bandwidth, semantically addressable mirror of a real browser tab — capture → relay → render → remote-control must work end-to-end as a standalone framework.
**Current focus:** Phase 15 — Media Security, Masking, Threat Model & Docs

## Current Position

Phase: 15 (Media Security, Masking, Threat Model & Docs) — EXECUTING
Plan: 3 of 4
Status: 15-02 complete (MSEC-04 renderer no-referrer meta + omit-credentials posture); ready for 15-03
Last activity: 2026-06-21 -- 15-02 complete: MSEC-04 no-referrer meta + omit-credentials posture shipped

**v2.0 phase order:** 12 → 13 → 14 → 15

- Phase 12: Static Assets by Reference (ASST-01..05, MSEC-01, MSEC-02)
- Phase 13: Video/Audio URL + Playback Sync (MEDIA-01..05, MWIRE-01, MWIRE-02)
- Phase 14: Adaptive Streaming + Adapter Discovery + Fallback (MADPT-01..04) — research-phase likely
- Phase 15: Media Security, Masking, Threat Model & Docs (MSEC-03, MSEC-04) — research-phase likely

## Performance Metrics

**Velocity:**

- Total plans completed: 66 (across v1.0 Phases 1–10; Phase 11 verified in FSB repo)
- Average duration: -
- Total execution time: 0 hours

**By Phase (v1.0):**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 1 | 5 | - | - |
| 2 | 6 | - | - |
| 03 | 5 | - | - |
| 04 | 4 | - | - |
| 05 | 6 | - | - |
| 07 | 4 | - | - |
| 08 | 9 | - | - |
| 09 | 8 | - | - |
| 10 | 5 | - | - |
| 13 | 4 | - | - |
| 14 | 5 | - | - |

**Recent Trend:**

- Last 5 plans: -
- Trend: -

*Updated after each plan completion*
| Phase 03 P03 | 5min | 2 tasks | 2 files |
| Phase 03 P04 | 6 min | 2 tasks | 4 files |
| Phase 04 P01 | 7 min | 2 tasks | 8 files |
| Phase 04 P02 | 8 min | 2 tasks | 3 files |
| Phase 04 P03 | 9 min | 2 tasks | 4 files |
| Phase 04 P04 | 70 min | 3 tasks | 12 files |
| Phase 05 P01 | 6min | 2 tasks | 5 files |
| Phase 05 P02 | 9 min | 2 tasks | 6 files |
| Phase 05 P03 | 4 min | 2 tasks | 4 files |
| Phase 05 P04 | 9 min | 2 tasks | 5 files |
| Phase 05 P05 | 9 min | 2 tasks | 6 files |
| Phase 05 P06 | 23 min | 3 tasks | 5 files |
| Phase 06 P01 | 8 min | 2 tasks | 5 files |
| Phase 06 P02 | 18 min | 2 tasks | 2 files |
| Phase 06 P04 | 13 min | 2 tasks | 2 files |
| Phase 06 P03 | 20 min | 3 tasks | 7 files |
| Phase 06 P05 | 17 min | 3 tasks | 7 files |
| Phase 07 P01 | 20 min | 3 tasks | 11 files |
| Phase 07 P02 | 14 min | 3 tasks | 8 files |
| Phase 07 P03 | 7min | 3 tasks | 6 files |
| Phase 07 P04 | 9min | 4 tasks | 6 files |
| Phase 09 | 2h 20min | 8 plans | 32 files |
| Phase 10 planning | 25min | 5 plans | 9 files |
| Phase 10 P01 | 8min | 1 task | 1 file |
| Phase 10 P02 | 12min | 2 tasks | 8 files |
| Phase 10 P03 | 20min | 2 tasks | 4 files |
| Phase 10 P04 | 18min | 2 tasks | 6 files |
| Phase 10 P05 | 20min | 2 tasks | 4 files |
| Phase 12 P12-01 | 14min | 2 tasks | 6 files |
| Phase 12 P12-02 | 38min | 2 tasks tasks | 5 files files |
| Phase 12 P12-03 | 42min | 3 tasks | 8 files |
| Phase 13 P01 | 9min | 2 tasks | 6 files |
| Phase 13 P02 | 11min | 2 tasks | 2 files |
| Phase 13 P03 | 38min | 3 tasks | 8 files |
| Phase 13 P04 | 9min | 2 tasks | 4 files |
| Phase 14 P01 | 18min | 3 tasks | 4 files |
| Phase 14 P02 | 14min | 3 tasks | 6 files |
| Phase 14 P04 | 11min | 2 tasks | 4 files |
| Phase 14 P03 | 6min | 3 tasks | 3 files |
| Phase 14 P05 | 4min | 2 tasks | 3 files |
| Phase 15 P01 | 33min | 3 tasks | 3 files |
| Phase 15 P02 | 6min | 1 task | 3 files |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current (v2.0) work:

- [Roadmap v2.0]: v2.0 is a strict capability chain A→B→C→D (Phases 12→13→14→15); media rides the existing pipeline — the relay and envelope are NEVER touched (STREAM.MEDIA is one new type string + typedef + constant; old viewers ignore the unknown type by construction).
- [Roadmap v2.0]: Media is mirrored by URL reference, not by value — the wire carries URLs + small playback state; the viewer fetches bytes from the source/CDN. Never stream media bytes over the relay (detonates the 1 MiB cap and the low-bandwidth core value).
- [Roadmap v2.0]: Player code never lives in the no-`allow-scripts` srcdoc iframe. Native progressive playback uses the inert in-iframe element driven cross-realm from the parent; adaptive players (hls.js/dash.js) run in the PARENT realm and bind MSE to the in-iframe element. Adding `allow-scripts` would be a catastrophic XSS regression.
- [Roadmap v2.0]: Security is THREADED, not trailing. The viewer-fetch threat model, CSP scope, fail-closed origin policy hook, and `mediaMode` are DECIDED in Phases 12–13 (static images are already a viewer-fetch surface) and COMPLETED/threat-modeled/tested in Phase 15 — Phase 15 does not begin security work.
- [Roadmap v2.0]: hls.js is the only justified runtime add — optional `peerDependency`, lazy-imported viewer-side only (native HLS via `canPlayType` first). Do NOT bundle dash.js/shaka (host-provided-player seam only); no URL library; no media-byte inlining.
- [Roadmap v2.0]: The drift reconciler is a pure, configurable, jsdom-unit-testable function (jsdom has no real media timeline). True playback / native-HLS / CDP manifest discovery / signed-URL/CORS/mixed-content outcomes / bandwidth are exercised in the real-Chrome/Playwright UAT.
- [Roadmap v2.0]: Adapters own manifest discovery (CDP `Network`, extension `webRequest`) and push hints in opt-in via the `fetchStylesheet` precedent; the capture core never sniffs the network and degrades gracefully when no adapter supplies hints.
- [Roadmap v2.0]: Phases 14 and 15 likely need `/gsd:plan-phase --research-phase` (cross-realm MSE binding feasibility / whether the child needs `connect-src` / manifest→element correlation for 14; parent-realm object-URL blast radius + default origin/private-IP denylist for 15). Phases 12–13 use established patterns.
- [Roadmap v2.0]: Evaluation harness (EVAL-*) and research paper (PAPR-*) deferred to milestone v2.1 (provisional Phases 16–17); the old v1.0 "Phase 12 Evaluation / Phase 13 Research Paper" entries are relocated there, superseded by the v2.0 media phases.

- [Phase 12-01]: RED Wave-0 scaffolds use dynamic `import()` inside test bodies so missing exports/modules fail as named per-test failures (not link/load/syntax errors), satisfying both the parse-check verify and the plan's "failing tests, not a syntax error" contract. Full suite excluding the 3 scaffolds is green (416/416); the 3 scaffolds are intentionally RED (30 tests) until Plans 12-02/12-03 land.
- [Phase 12-01]: SC#1 (no image bytes traverse the relay) and ASST-05 (confirm-only CSP — img-src present, default-src 'none', NO script-src, NO media-src) are pinned by automated tests from the first commit; `CSP_META` in `src/renderer/snapshot.js` left byte-unchanged (string assertion; real CSP enforcement is Playwright UAT, may be deferred).

Earlier v1.0 decisions are retained in PROJECT.md Key Decisions and the prior phase summaries.

- [Phase 12-02]: D26 only, no D27: the static-assets fixture surfaces ONE same-index SNAPSHOT mismatch (clone-only data-ps-currentsrc pin + blob-degrade + oversized-degrade all in the html field); compareStreams compares the whole message and ledgerCovers returns the first match, so a second D27 entry could never fire and would fail stale-entry detection. D26's predicate recognizes the combined extracted-only divergence (data-ps-currentsrc OR data-ps-asset-unavailable present in ext, absent in ref).
- [Phase 12-02]: ASST-03 (clone-only data-ps-currentsrc variant pin) and ASST-04 (blob:/oversized-data: -> dimensioned data-ps-asset-unavailable placeholder; small data: byte-identical, ASSET_DATA_URI_MAX_BYTES=256 KiB) are capture-complete at all 4 serialization sites; the live page is never mutated (clone-only; the added-node wireClone is the trap). Capture-degrade suite + differential oracle (firing D26) GREEN; renderer fetch-gate/mediaMode/CSP remain Plan 12-03.
- [Phase 12-03]: Viewer-side-fetch security model is GREEN. classifyAssetOrigin (src/renderer/asset-policy.js) is a PURE fail-closed https-only + private-range classifier (denies localhost/127/10/172.16.0.0-12 incl. /12 boundary/192.168/169.254/::1/fc00::-7/.local/unqualified; parse-error blocks), exported for Phase-15 reuse. gateAssetUrl(url, ctx) precedence: mediaMode 'off' blocks all -> allowAssetOrigins host widen -> classifier deny authoritative -> assetOriginPolicy hook fail-closed (throw OR non-true blocks) -> posture allow. mediaMode default 'reference' (off|poster|reference; invalid throws at factory time). Gate runs PRE-write at all 4 sites: snapshot at the STRING layer (Pitfall 1 -- parser fetches during parse, before post-parse scrub) + diff ADD/ATTR + subtree; blocked -> data-ps-asset-unavailable="blocked-origin" placeholder. ASST-03 currentSrc pin (effective src = data-ps-currentsrc, srcset/sizes neutralized) viewer-side. Sandbox token + CSP_META byte-unchanged (no script-src, no media-src -- media-src is Phase 13); no allow-scripts literal.
- [Phase 12-03]: VERIFIED jsdom/URL realities baked into the implementation: Node's WHATWG URL does NOT strip IPv6 brackets (new URL('https://[::1]/').hostname === '[::1]') -- isPrivateOrLocalHost strips them before its IPv6 checks; .local routes to 'unqualified-host' not 'private-host'. createViewer gained a host-driven API (mount alias + optional no-op transport + handleSnapshot on the handle, envelope-or-bare-payload tolerant) while the wire-driven cfg.container path keeps transport REQUIRED. Placeholders carry NO live identity attr (positional nid pairing preserved -- Phase 7). Playwright asset UAT DEFERRED (jsdom never parses srcdoc/enforces CSP/fetches) per the project UAT-deferral precedent.
- [Phase ?]: [Phase 13-01]: STREAM.MEDIA='ext:dom-media' (scroll-twin op) + MEDIA_SYNC_THROTTLE_MS=250 + MediaBaselineEntry/MediaSyncPayload typedefs (duration|live mutually exclusive, Infinity->null fix); envelope+relay byte-unchanged, STREAM.MEDIA round-trips raw under the 1 MiB cap.
- [Phase ?]: [Phase 13-01]: reconcileMediaDrift is a pure zero-import fn in src/protocol/media-reconcile.js (hold|pause|nudge|seek|rejoin-edge); 0.25s hold band, +/-5%-capped sign-correct nudge, hard-seek clamps to [0,duration], explicit-seeked short-circuit, live branch before duration math; no field ever NaN (6561-case hostile sweep). No D27 ledger entry yet (lands with 13-02 capture fixture).
- [Phase ?]: [Phase 13-02]: serializeDOM appends a nid-keyed media[] playback baseline ONLY when >=1 <video>/<audio> exists (media-free fixtures stay byte-identical to the FSB reference; differential-ledger entry deferred to 13-04); duration sent only when finite, live:true otherwise (Infinity->null trap).
- [Phase ?]: [Phase 13-02]: startMediaTracker is a scroll-twin armed/torn at the startScrollTracker sites; media events do not bubble so listeners are PER-ELEMENT (Map+records), with added-node attach + removed-node detach; STREAM.MEDIA discrete events emit immediately, timeupdate throttled at MEDIA_SYNC_THROTTLE_MS and playing-only; every payload nid-addressed + identity-stamped + sentAt-stamped; no media bytes on the wire.
- [Phase 13-03]: media-src http: https: data: added to CSP_META (twin of img-src, NO blob: -- Phase 14; default-src 'none'/no script-src retained). gateSnapshotAssets generalized (findImgTagEnd->findTagEnd, a unified <img>/<video>/<source> pre-parse scan via nextAssetOpener) so <video src>/<video poster>/<source src> to a blocked origin are neutralized to the dimensioned placeholder at the STRING layer before the parser prefetches (Pitfall 5 SSRF fix); gateFragmentMedia is post-parse defense-in-depth + poster-mode source strip.
- [Phase 13-03]: handleMedia (case STREAM.MEDIA; default already ignores it for old viewers) staleness-guards via isCurrentStream, resolves the nid, runs reconcileMediaDrift, and drives the inert in-iframe element cross-realm from the PARENT realm via applyMediaAction (seeking-hold, readyState>=1 seek gate, seekable.length rejoin guard). ensurePlaying: muted=true before first play; if (p !== undefined && typeof p.catch === 'function') jsdom guard; NotAllowedError -> media-blocked affordance + onMediaBlocked(nid) CONFIG callback (assetOriginPolicy-hook family, contained-not-rethrown), never wedges. Unmute trigger: el.muted && payload.muted===false in reference -> show media-unmute (onActivate sets muted=false+volume then hides). poster/off: no driver, no affordance (source already gate-neutralized). Snapshot media[] baseline applied once per nid on first bind (readyState-gated) then reconciler owns it (Pitfall 7). Sandbox stays EXACTLY allow-same-origin. No D27 ledger entry (renderer-only slice; the media-playback-sync fixture + D27 land in 13-04). Full suite 577/577.
- [Phase 13-04]: D27-media-playback-sync ledger entry + a deterministically-firing media-playback-sync fixture/scenario keep the differential oracle green (48/48, was 45) now that capture emits media[] + STREAM.MEDIA; full suite 580/580 (was 577). ONE appliesTo predicate covers BOTH Shape A (extracted-only trailing STREAM.MEDIA; refMsg undefined, extMsg.type === STREAM.MEDIA) and Shape B (same-index SNAPSHOT where only the extracted payload.media is non-empty) per the D26 single-predicate discipline -- compareStreams returns the first match, so a second same-index entry would be stale-flagged. Cites MEDIA-02/MWIRE-01, NOT MEDIA-03 (the renderer-side reconciler emits no wire message; it is covered by Plan 01's pure unit tests). normalize.js unchanged -- normalizeExtracted passes payload.media through, so the SNAPSHOT diverges on the new top-level media key naturally (D26 needed no normalizer change either, but because its markers lived in payload.html). The beforeStart paused=false defineProperty stub on BOTH sides is load-bearing (the extracted tracker's timeupdate heartbeat returns early while el.paused, and jsdom reports an unloaded element as paused); the finite-duration stub drives the VOD baseline (not live:true). Task 1 proved the divergence by the oracle hard-failing UNDECLARED DIVERGENCE; Task 2 landed D27 and restored green with D27 firing and not stale (the stale-entry detector passes). Envelope/relay untouched.

- [Phase 14-01]: STREAM.MEDIA_HINT='ext:dom-media-hint' (twin of STREAM.MEDIA) + MediaHintPayload typedef (nid?/scope/manifestUrl/kind/contentType?/identity-stamped) added to src/protocol/messages.js; collision-free in Object.values(STREAM) (A2) + raw-round-trips under the 1 MiB cap; constants.js untouched (op needs none); index.js barrel already re-exports it. Both adapters' Object.keys(STREAM) allow-sets (playwright.js:78, extension.js:21) auto-include it, so MEDIA_HINT is relayable with NO adapter edit -- only Plan 02 emission code is new. Old viewers ignore the unknown type (renderer dispatch default); envelope/relay byte-unchanged.
- [Phase 14-01]: classifyManifest({url, contentType}) is a pure exported 'hls'|'dash'|null classifier (content-type-first -- the robust signal for extensionless/signed CDN URLs -- then .m3u8/.mpd path extension; URL-OR-content-type, either independently sufficient). HLS token set: application/vnd.apple.mpegurl + x-mpegurl + audio[-x]/mpegurl; DASH: application/dash+xml. manifestPathOf wraps new URL() in try/catch with a regex query/hash strip so a malformed/hostile url never throws (T-14-03). Two Wave-0 scaffolds created green: tests/media-hint-filter.test.js (9 filter tests) + tests/renderer-media-player.test.js (1 harness placeholder, installStubMediaSource + stubVideoEl, NO media-player.js import until Plan 02). Full suite 601/601 (was 588); differential oracle 48/48 UNCHANGED -- no D-ledger entry (the hint originates in the adapter, not src/capture/; A4 confirmed). dependencies stays { ws: 8.21.0 }.
- [Phase ?]: [Phase 14-02]: createMediaPlayer attach() runs native-HLS-first -> host playerFactory -> optional lazy import('hls.js') -> degrade-to-poster, all try/catch-contained to a single degrade(nid,reason) sink; attach() never rethrows. hls.js referenced ONLY via a guarded dynamic import (no top-level import) so the renderer stays importable with hls.js absent (package:smoke exit 0; dependencies stays { ws }). Wired the internal lazy-hls adapter now (graceful-absence proven by degrade('no-player')-when-null).
- [Phase ?]: [Phase 14-02]: media-unavailable overlay is a passive textContent-only clone of renderMediaPoster (reason via data-ps-reason setAttribute, never markup -> innerHTML allowlist unchanged at 4). CSP media-src gains blob: ONLY (default-src 'none'/no script-src/no connect-src retained; sandbox allow-same-origin unchanged). DRM (encrypted event + hls.js KEY_SYSTEM_ERROR) -> degrade('drm'); emeEnabled never true. Full suite 624/624; differential oracle 48/48; live cross-realm MSE proof is the documented deferred UAT (poster is the never-break net).
- [Phase ?]: [Phase 14-04]: Both adapters surface manifest URLs by opt-in network observation (Playwright page.on('response')+CDP Network.responseReceived; extension chrome.webRequest.onCompleted), off by default; classifyManifest filters .m3u8/.mpd by URL-OR-content-type; correlation best-effort via an injectable resolveActiveMediaNid hook (single-active -> element scope, ambiguous -> page scope); identity snooped off forwarded STREAM frames; emitted via transport.send(STREAM.MEDIA_HINT) with NO allowlist edit; validateChrome requires chrome.webRequest ONLY when opted in and degrades gracefully when absent. dependencies stays { ws }; differential oracle 48/48; full suite 640/640.
- [Phase ?]: [Phase 14-03]: STREAM.MEDIA_HINT wired into the renderer dispatch -> handleMediaHint re-gates manifestUrl through the SAME fail-closed gateAsset BEFORE binding (V12/SSRF defense in depth; blocked origin -> degrade('no-manifest'), never fetched); element-scope binds immediately, page-scope stores most-recent-wins-per-kind in pendingHints consumed by an MSE-opaque (source-less) element on play (best-effort correlation, idempotent per generation); old viewers ignore the unknown op via the dispatch default.
- [Phase ?]: [Phase 14-03]: createMediaPlayer constructed in createViewer (parent realm; sandbox stays exactly allow-same-origin); playerFactory + onMediaUnavailable are the config-callback family (function-or-ignored), onMediaUnavailable double-contained (safeInvokeMediaHook + the player degrade sink). mediaPlayer.destroyAll() on a new-identity snapshot (Pattern 2) tears down every parent-realm player before the document swap (no orphaned players / object-URL leak).
- [Phase ?]: [Phase 14-03]: Live handling is ASSERTED reuse, not new code (MADPT-04) -- media-reconcile pins live:true -> rejoin-edge with NO absolute toTime, and applyMediaAction seeks seekable.end (live edge) ONLY under seekable.length>0, never to the payload absolute time. Closed the Phase-13 UI-review Fix 1 BLOCKER: the registered-but-dead State-C media-poster caption is now driven from handleMedia poster-mode (shown IFF no surviving poster). Full suite 659/659, oracle 48/48, package:smoke exit 0 with hls.js absent, dependencies stays { ws }.
- [Phase ?]: [Phase 14-05]: hls.js declared ONLY as an OPTIONAL peerDependency ({ hls.js: >=1.5.0 } + peerDependenciesMeta.optional:true) -- npm neither auto-installs nor warns when absent; dependencies stays exactly { ws: 8.21.0 }, hls.js never a hard/dev dep, node_modules/hls.js absent. Zero-hard-dep PROVEN by package:smoke importing ./renderer in an hls.js-absent sandbox (resolves only because the hls.js import is dynamic-only, Plan 02); a named zero-hard-dep-violation smoke assertion (before the broad subpath loop) + a package-publish deps-shape guard catch any future top-level-import/hard-dep leak (T-14-17/T-14-18). publint 'All good!', attw exit 0, full suite 660/660, oracle 48/48. MADPT-01 fully closed; Phase 14 complete.
- [Phase ?]: [Phase 15-01]: MSEC-03 capture masking spine shipped -- 3 host options (maskMediaSelector factory-validated, maskAssetUrls token/PII strip, maskAssetUrlFn fail-closed-to-BLOCK redactor) routed through ONE new 'asset-url'/'media-url' sanitizeForWire dispatch wrapping a PURE maskAssetUrlForWire helper + documented TOKEN_PARAM_DENYLIST (AWS SigV4/SigV2, GCP, Azure SAS, generic; case-insensitive exact-name OR x-amz-/x-goog- prefix). Off-by-default returns the ORIGINAL url string when nothing stripped (Pitfall 1: never URL.toString()) so the wire stays byte-identical (oracle 48/48, NO new ledger entry). maskMediaWithAncestors ORed into BOTH media-tracker skip guards + the blockSelector placeholder path -> masked <video>/<audio> emits no STREAM.MEDIA and degrades to the dimension-only placeholder (A3: plain block placeholder, no 'masked' reason). Zero new deps; full suite 689/689.
- [Phase 15-02]: MSEC-04 viewer-fetch leakage control shipped -- ONE document-level <meta name="referrer" content="no-referrer"> injected IMMEDIATELY after CSP_META (before charset/viewport/first stylesheet link/payload <img>) at BOTH src/renderer/snapshot.js return sites (buildSnapshotHtml :673 + container-less buildFramePlaceholderHtml :690), so the mirrored page URL (token-bearing) never leaks in a Referer header to third-party CDNs on any parser- or CSS-initiated fetch (img/video/source/poster/background-image/font). One document meta beats per-element referrerpolicy (covers CSS-initiated fetches none could reach). NO crossorigin added -- allow-same-origin sandbox + no crossorigin already omits credentials; forcing anonymous would break non-CORS assets (locked); the test asserts indexOf('crossorigin')===-1 on the srcdoc (the 3 source hits are comment-only). CSP_META BYTE-UNCHANGED (default-src 'none', media-src ... blob:, img-src no-blob, no script-src, no connect-src). renderer-media-csp.test.js +6 pins (present/exactly-one/ordered-after-CSP-and-before-charset+first-link+first-img/no-crossorigin/container-less); renderer-snapshot.test.js CSP-first verbatim pin updated to <head>+CSP+referrer+charset (Rule 1: the meta displaced a sibling adjacency assertion -- intent preserved). Live referrer/credential suppression is the deferred real-browser UAT (A2); string contract unit-pinned. Renderer-only edit -> NO wire impact, oracle 48/48 unchanged, NO new ledger entry; zero new deps; full suite 696/696.

### Pending Todos

None yet.

### Blockers/Concerns

- [Phase 14]: Cross-realm MSE binding feasibility is the milestone's only genuinely uncertain area — creating `MediaSource` in the parent and binding its object URL to an in-iframe `<video>`, with hls.js running in the parent and `attachMedia`-ing the iframe element, is sound in principle but unproven across browsers. Spike in Playwright early in Phase 14; if blocked, the fallback is poster + "media not mirrorable" (already the graceful-absence path), so the milestone is not at risk — only the adaptive differentiator is.
- [Phase 14]: Whether the child iframe needs `connect-src` (vs the parent doing all segment fetches) must be verified empirically; keep `default-src 'none'`/no `script-src` regardless.
- [Phase 13]: Drift-tolerance thresholds (~0.25–0.5s hold band, large-drift hard-seek) are practice-based starting points — design the reconciler as a pure function so the numbers are configurable and table-tested, not baked in; tune later against the v2.1 evaluation harness.
- [Phase 15]: The conservative default origin policy (https-only, block `localhost`/link-local/private ranges) needs a concrete denylist and host-override surface settled during Phase 15 planning.
- [Milestone v2.1]: Baseline-fairness protocol details and the semantic-fidelity metric definition need a dedicated research pass before harness implementation (carried forward from v1.0).
- [Phase 11]: RESOLVED 2026-06-16 — FSB swap-in verified in the FSB repo against `@full-self-browsing/phantom-stream@0.1.0`; API frozen at 1.0. No in-repo plans (FSB code stays in the FSB repo).
- [Phase 10]: RESOLVED 2026-06-16 — `@full-self-browsing/phantom-stream@0.1.0` published to npm (public) under the existing `@full-self-browsing` org and confirmed installable.

## Deferred Items

Items acknowledged and carried forward:

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| Milestone v2.1 | Evaluation corpus/harness (EVAL-01..06) + system-track paper (PAPR-01,02) | Deferred to v2.1 (provisional Phases 16–17) | 2026-06-19 |
| Phase 06 UAT | Real MV3 watchdog service-worker eviction/recovery browser evidence | Deferred by user | 2026-06-15 |
| Phase 06 UAT | Real bookmarklet policy/CSP blocked-injection browser evidence | Deferred by user | 2026-06-15 |

## Session Continuity

Last session: 2026-06-21T19:05:40.923Z
Stopped at: Completed 15-01-PLAN.md
Resume file: None
