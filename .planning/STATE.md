---
gsd_state_version: 1.0
milestone: v2.0
milestone_name: Asset & Media Streaming
status: executing
stopped_at: Completed 13-02-PLAN.md
last_updated: "2026-06-21T03:44:23.357Z"
last_activity: 2026-06-21 -- Phase 13 Plan 02 complete (capture media[] baseline + STREAM.MEDIA tracker)
progress:
  total_phases: 15
  completed_phases: 11
  total_plans: 64
  completed_plans: 62
  percent: 73
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-06-19)

**Core value:** A live, trustworthy, low-bandwidth, semantically addressable mirror of a real browser tab — capture → relay → render → remote-control must work end-to-end as a standalone framework.
**Current focus:** Phase 13 — Video/Audio URL + Playback Sync

## Current Position

Phase: 13 (Video/Audio URL + Playback Sync) — EXECUTING
Plan: 3 of 4
Status: Ready to execute
Last activity: 2026-06-21

**v2.0 phase order:** 12 → 13 → 14 → 15

- Phase 12: Static Assets by Reference (ASST-01..05, MSEC-01, MSEC-02)
- Phase 13: Video/Audio URL + Playback Sync (MEDIA-01..05, MWIRE-01, MWIRE-02)
- Phase 14: Adaptive Streaming + Adapter Discovery + Fallback (MADPT-01..04) — research-phase likely
- Phase 15: Media Security, Masking, Threat Model & Docs (MSEC-03, MSEC-04) — research-phase likely

## Performance Metrics

**Velocity:**

- Total plans completed: 57 (across v1.0 Phases 1–10; Phase 11 verified in FSB repo)
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

Last session: 2026-06-21T03:41:03.713Z
Stopped at: Completed 13-02-PLAN.md
Resume file: None
