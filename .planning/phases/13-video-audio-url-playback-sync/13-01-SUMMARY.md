---
phase: 13-video-audio-url-playback-sync
plan: 01
subsystem: api
tags: [protocol, media-sync, video, audio, drift-reconciler, esm, jsdoc, rrweb]

# Dependency graph
requires:
  - phase: 12-static-assets-by-reference
    provides: "viewer-side-fetch security model (gateAssetUrl/classifyAssetOrigin), mediaMode posture, the side-channel-property-state precedent"
  - phase: 07-weakmap-identity
    provides: "nid identity addressing and isCurrentStream staleness guard that MediaSyncPayload stamps for"
provides:
  - "STREAM.MEDIA = 'ext:dom-media' op (scroll-twin) in the STREAM namespace"
  - "MEDIA_SYNC_THROTTLE_MS = 250 heartbeat-cadence constant"
  - "MediaBaselineEntry + MediaSyncPayload typedefs (duration|live, mutually exclusive; sentAt latency stamp; identity stamps)"
  - "src/protocol/media-reconcile.js: pure zero-import reconcileMediaDrift + DEFAULT_MEDIA_RECONCILE_CONFIG"
  - "Protocol barrel re-export of the reconciler; envelope round-trip + 1 MiB-cap assertions for STREAM.MEDIA"
affects: [13-02-capture-media-baseline, 13-03-renderer-media-driver, 13-04-media-uat, phase-14-adaptive-streaming]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pure, zero-dependency drift reconciler in src/protocol/ (plain-object I/O, no DOM, caller-supplied clock) -- jsdom-unit-testable by construction"
    - "rrweb interpolation formula (currentTime + rate*elapsed) extended with a tolerance band + bounded rate-nudge + live-edge rejoin"
    - "Infinity->null JSON trap fix via duration|live mutual exclusion encoded in the typedef"

key-files:
  created:
    - src/protocol/media-reconcile.js
    - tests/media-reconcile.test.js
  modified:
    - src/protocol/messages.js
    - src/protocol/constants.js
    - src/protocol/index.js
    - tests/protocol.test.js

key-decisions:
  - "Reconciler lives in src/protocol/media-reconcile.js (shared, zero-dep) rather than src/renderer/, per the discretion clause -- keeps it pure and lets capture self-check later"
  - "STREAM.MEDIA = 'ext:dom-media' (follows the ext:dom-* namespace; verified collision-free, Assumption A2)"
  - "No D27 differential-oracle ledger entry added: this plan emits no capture-side STREAM.MEDIA/media[], so a ledger entry would go stale and fail stale-detection (RESEARCH A4) -- it lands with Plan 13-02's capture fixture"
  - "Robust NaN guarding beyond the plan skeleton: incomplete-remote guard also rejects non-finite currentTime/sentAt; mergeConfig accepts only finite overrides -- proven by a 6561-case hostile-input sweep"

patterns-established:
  - "Drift reconciler decision order (RESEARCH Pattern 1): merge cfg -> incomplete guard -> explicit seeked short-circuit -> paused/rate-0 -> latency-comp expected (elapsed>=0) -> live branch before duration math -> loop-wrap -> hold band (revertRate) -> sign-correct bounded nudge (baseRate) -> hard-seek (clamp toTime)"
  - "Every reconciler test asserts no returned numeric field is NaN, including a hostile-input sweep over NaN/Infinity/null/undefined"

requirements-completed: [MWIRE-01, MWIRE-02, MEDIA-03]

# Metrics
duration: 9min
completed: 2026-06-20
---

# Phase 13 Plan 01: Media Wire + Drift Reconciler Spine Summary

**The STREAM.MEDIA wire op + MEDIA_SYNC_THROTTLE_MS + media typedefs, plus the phase's core deliverable: a pure zero-import `reconcileMediaDrift` that returns a NaN-free hold/pause/nudge/seek/rejoin-edge action for every decision-tree branch and edge-trap row.**

## Performance

- **Duration:** ~9 min
- **Started:** 2026-06-20T22:16:00-05:00 (after planning commit 34e37a2)
- **Completed:** 2026-06-20T22:25:00-05:00
- **Tasks:** 2
- **Files modified:** 6 (2 created, 4 modified)

## Accomplishments
- Added `STREAM.MEDIA = 'ext:dom-media'` (scroll-twin op) + `MEDIA_SYNC_THROTTLE_MS = 250` with a unit/derivation comment, plus `MediaBaselineEntry`/`MediaSyncPayload` typedefs that encode `duration|live` as mutually exclusive (the Infinity->null JSON trap fix).
- Proved the wire contract is backward-compatible: `STREAM.MEDIA` round-trips raw (plain and compressed) through the unchanged envelope, and a near-cap (~1 MiB - 4 KiB) payload survives intact -- envelope.js and the relay are byte-unchanged.
- Built `src/protocol/media-reconcile.js`: a pure, zero-import reconciler implementing the RESEARCH Pattern 1 decision tree exactly, with the rrweb `currentTime + rate*((now-sentAt)/1000)` latency-compensation oracle, a 0.25 s hold band, a sign-correct +/-5%-capped rate nudge, a hard-seek with `[0, duration]` clamping, an explicit-`seeked` short-circuit, loop-wrap detection, and a live branch taken before any duration arithmetic.
- 33 reconciler table tests (one per behavior bullet + one per NaN/edge-trap row) plus a 6561-case hostile-input sweep, every test asserting no returned field is NaN. Full suite green at 536/536 (was 498; +38 new), no regression.

## Task Commits

Each task was committed atomically:

1. **Task 1: STREAM.MEDIA op, MEDIA_SYNC_THROTTLE_MS, media typedefs, protocol/envelope assertions** - `c9f6fd4` (feat)
2. **Task 2: Pure reconcileMediaDrift + DEFAULT_MEDIA_RECONCILE_CONFIG + full table tests** - `4527686` (feat)

**Plan metadata:** (this commit) (docs: complete plan)

_TDD note: both tasks were executed test-first (RED: extend protocol.test.js / new media-reconcile.test.js fail on the missing export/module; GREEN: implement). Because the two tasks are one tightly-coupled wire+logic slice and the new code is pure (no refactor needed), each task landed as a single squashed feat commit carrying both its tests and its implementation rather than separate test/feat commits._

## Files Created/Modified
- `src/protocol/media-reconcile.js` (created) - Pure zero-import `reconcileMediaDrift(local, remote, now, config)` + `DEFAULT_MEDIA_RECONCILE_CONFIG`; private `mergeConfig`/`clampToDuration`/`isLoopWrap`/`isFiniteNum` helpers (var-style for cross-runtime parity).
- `tests/media-reconcile.test.js` (created) - 33 table tests covering hold/nudge/seek/live/loop-wrap/paused/latency-comp/explicit-seek + every NaN/edge-trap row + a hostile-input sweep.
- `src/protocol/messages.js` (modified) - `STREAM.MEDIA` op + `MediaBaselineEntry`/`MediaSyncPayload` typedefs.
- `src/protocol/constants.js` (modified) - `MEDIA_SYNC_THROTTLE_MS = 250` next to `SCROLL_THROTTLE_MS`, with unit/derivation comment.
- `src/protocol/index.js` (modified) - barrel re-export of `./media-reconcile.js`.
- `tests/protocol.test.js` (modified) - asserts `STREAM.MEDIA` exported/namespaced/collision-free, `MEDIA_SYNC_THROTTLE_MS === 250`, media typedefs present, envelope raw round-trip, and the 1 MiB-cap survival.

## Decisions Made
- **Reconciler home:** `src/protocol/media-reconcile.js` (not `src/renderer/`). Both are pure-testable; protocol keeps it shared and zero-dep by construction (RESEARCH recommendation; discretion clause).
- **Op value:** `STREAM.MEDIA = 'ext:dom-media'` in the `ext:dom-*` namespace; a protocol test asserts it is collision-free against every other `STREAM` value (Assumption A2).
- **No differential-oracle ledger entry this plan.** The FSB reference emits no media surface, but the divergence only materializes once a fixture instantiates media and capture emits `STREAM.MEDIA`/`media[]` -- which is Plan 13-02. Adding a D27 entry now would go stale and FAIL the stale-entry detector (RESEARCH Assumption A4 / the D26 lesson). The full suite (including `differential/oracle.test.js`) stays green at 536/536, confirming none is needed yet.
- **Hardened NaN guarding beyond the skeleton.** The plan's incomplete-remote guard checked `currentTime == null` and `typeof sentAt !== 'number'`; I extended it to reject non-finite `currentTime`/`sentAt` (NaN passes both original checks), and `mergeConfig` accepts only finite overrides. This makes "no returned field is ever NaN" true even under fully hostile input, verified by the sweep.

## Deviations from Plan

None - plan executed exactly as written. The hardened NaN guarding above is a strengthening of the plan's own NaN-safety requirement ("assert NO result field is NaN in any case"), not a scope change: it uses the same guard locations the skeleton specifies, just with finite-number checks instead of null/typeof checks so the explicit edge-trap rows (NaN local, Infinity/NaN duration, missing fields) and the hostile sweep all pass.

## Issues Encountered
None. RED states were the expected module-load failures (missing `MEDIA_SYNC_THROTTLE_MS` export for Task 1; missing `media-reconcile.js` module for Task 2); both resolved on the GREEN implementation. No fix-attempt loops.

## User Setup Required
None - no external service configuration required. This plan adds protocol constants, typedefs, and a pure function; no env vars, no installs (zero packages, per the threat register T-13-SC), no service registrations.

## Next Phase Readiness
- **Ready for Plan 13-02 (capture media baseline + emit):** `STREAM.MEDIA`, `MEDIA_SYNC_THROTTLE_MS`, and the `MediaSyncPayload`/`MediaBaselineEntry` shapes are exported and pinned; capture's `startMediaTracker()` and snapshot `media[]` can target them directly. The D27 ledger entry + `media-playback-sync` fixture land there (together, per the stale-entry discipline).
- **Ready for Plan 13-03 (renderer driver):** `reconcileMediaDrift` is exported from the barrel and returns the documented action shapes; the renderer's `handleMedia` can call it and apply hold/pause/nudge/seek/rejoin-edge. The jsdom `play()`-returns-undefined guard and the `seekable.end` length guard are renderer-plan concerns (the reconciler stays element-free).
- No blockers. The reconciler thresholds are config fields (default-merged), satisfying the STATE.md Phase 13 concern that drift tolerances be tunable against the v2.1 evaluation harness.

---
*Phase: 13-video-audio-url-playback-sync*
*Completed: 2026-06-20*

## Self-Check: PASSED

- FOUND: src/protocol/media-reconcile.js
- FOUND: tests/media-reconcile.test.js
- FOUND: .planning/phases/13-video-audio-url-playback-sync/13-01-SUMMARY.md
- FOUND commit: c9f6fd4 (Task 1)
- FOUND commit: 4527686 (Task 2)
