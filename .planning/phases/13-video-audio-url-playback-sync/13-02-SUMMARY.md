---
phase: 13-video-audio-url-playback-sync
plan: 02
subsystem: capture
tags: [capture, media-sync, video, audio, snapshot-baseline, stream-media, side-channel, throttle, esm, jsdoc]

# Dependency graph
requires:
  - phase: 13-video-audio-url-playback-sync
    plan: 01
    provides: "STREAM.MEDIA op, MEDIA_SYNC_THROTTLE_MS constant, MediaBaselineEntry/MediaSyncPayload typedefs (duration|live encoding) this slice produces"
  - phase: 07-weakmap-identity
    provides: "ensureNodeId/getTrackedNodeId nid addressing + streamSessionId/currentSnapshotId identity stamps every STREAM.MEDIA payload carries"
  - phase: 12-static-assets-by-reference
    provides: "the DIFF_OP.VALUE side-channel-property-by-nid precedent the media[] baseline mirrors"
provides:
  - "serializeDOM media[] snapshot baseline -- one MediaBaselineEntry per live <video>/<audio>, nid-keyed, added ONLY when media elements exist"
  - "startMediaTracker()/stopMediaTracker() -- scroll-twin lifecycle, per-element media listeners (events do not bubble)"
  - "sendMediaState(el, eventName) -- nid-addressed, identity-stamped, sentAt-stamped STREAM.MEDIA emit with duration|live finite check"
  - "added-node listener attach + removed-node detach for mutation-inserted/removed media; teardown on stop()/pause()"
  - "tests/capture-media.test.js -- baseline shape, byte-identity, Infinity->null encoding, discrete-immediacy, throttle window, paused-suppression, added-node, teardown"
affects: [13-03-renderer-media-driver, 13-04-media-uat, phase-14-adaptive-streaming]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Per-element media listeners (NOT delegated) because media events do not bubble -- explicit attach/detach with a Map+records bookkeeping pair mirroring valueListenerRoots"
    - "media[] snapshot baseline as a side-channel array keyed by nid (DIFF_OP.VALUE precedent) -- never serialized into payload.html, preserving differential-oracle byte-identity + the Phase 7 capture-no-mutation invariant"
    - "media[] key added ONLY when >=1 media element exists, so media-free fixtures stay byte-identical to the FSB reference (no differential-ledger entry needed yet)"
    - "scroll-twin throttle: per-element lastMediaSend gate at MEDIA_SYNC_THROTTLE_MS for the playing-only timeupdate heartbeat; discrete transitions bypass the throttle"

key-files:
  created:
    - tests/capture-media.test.js
  modified:
    - src/capture/index.js

key-decisions:
  - "media[] is added to snapshotPayload ONLY when trackedMedia.length > 0 -- an always-present empty media:[] broke the differential oracle (the FSB reference emits no such key); gating on element presence restores byte-identity (RESEARCH A4 / Pitfall 7)"
  - "Per-element listeners over document-level capture-phase delegation: media events do not bubble (RESEARCH Pitfall 3); a Map(element -> {handlers, lastMediaSend}) + records array makes added-node coverage and teardown explicit and leak-free"
  - "Removed-node detach runs BEFORE the wire-drop short-circuit in the removal loop, so a tracked media element can never emit after leaving the live DOM even if its subtree is wire-dropped"
  - "Both tasks landed as single feat commits (test + impl together) -- one tightly-coupled capture slice, new code (no refactor), mirroring the Plan 13-01 squashed-TDD precedent"

patterns-established:
  - "startMediaTracker/stopMediaTracker are armed/torn down at exactly the startScrollTracker/stopScrollTracker sites (start re-arm, start arm, stop, pause, resume) -- the media channel is a documented structural twin of the scroll channel"
  - "sendMediaState assigns identity LAST is unnecessary here (payload built in one literal) but duration|live is appended after the literal so the finite check is the single source of the live signal on both baseline and wire paths"

requirements-completed: [MEDIA-02, MEDIA-04, MWIRE-01]

# Metrics
duration: 11min
completed: 2026-06-21
---

# Phase 13 Plan 02: Capture Media Baseline + STREAM.MEDIA Emission Summary

**The source-side half of the media-sync pipeline: serializeDOM now appends a nid-keyed `media[]` playback-state baseline (Infinity->null-safe), and a scroll-twin `startMediaTracker` attaches per-element listeners that emit nid-addressed, identity-stamped `STREAM.MEDIA` messages immediately on discrete events plus a throttled playing-only `timeupdate` heartbeat -- all without mutating the page or baking media state into the serialized HTML.**

## Performance

- **Duration:** ~11 min
- **Completed:** 2026-06-21
- **Tasks:** 2
- **Files modified:** 2 (1 created, 1 modified)

## Accomplishments
- **media[] snapshot baseline (MEDIA-02, MEDIA-04):** `buildMediaBaselineEntry(el)` reads a live `<video>/<audio>`'s `currentTime/paused/muted/volume/playbackRate/loop/ended` keyed by `ensureNodeId(el)`, with `duration` sent only when finite and `live:true` otherwise (closes the JSON `Infinity->null` trap). `serializeDOM` appends `snapshotPayload.media` ONLY when at least one media element exists, so media-free fixtures stay byte-identical to the FSB reference.
- **STREAM.MEDIA tracker (MWIRE-01):** `startMediaTracker()`/`stopMediaTracker()` are the structural twin of the scroll tracker. `sendMediaState(el, eventName)` builds a nid-addressed, identity-stamped (`streamSessionId`/`snapshotId`), `sentAt`-stamped payload (same finite `duration|live` check). The seven discrete transitions (`play/pause/seeked/ratechange/ended/volumechange/loadedmetadata`) emit one message immediately; `timeupdate` returns early while paused, then throttles at `MEDIA_SYNC_THROTTLE_MS` via a per-element `lastMediaSend` gate.
- **Added-node + teardown coverage:** the mutation added-node loop calls `attachMediaListenersUnder(added)` (root + descendants) so a mutation-inserted `<video>` AND `<audio>` are tracked; the removed-node loop calls `detachMediaListenersUnder(removed)` before any wire-drop short-circuit; `start()` re-arm, `stop()`, and `pause()` all tear listeners down. Media events do not bubble, so listeners are strictly per-element (no delegated handler).
- **No media bytes on the wire (T-13-05):** every emission is small nid-addressed playback state (numbers/booleans/event name); no `src`, no blob, no media bytes ever enter `safeSend`.
- **Tests:** `tests/capture-media.test.js` (jsdom + `Object.defineProperty` property stubs + a manual `Date.now` clock for the throttle window + MutationObserver-driven added/removed nodes) -- 10 test cases covering all five must-have truths. Full suite green at 546 (was 536; +10), differential oracle byte-identity preserved, capture-purity intact.

## Task Commits

Each task was committed atomically:

1. **Task 1: media[] snapshot baseline in serializeDOM (Infinity->null-safe, clone-clean)** - `3fa3c2c` (feat)
2. **Task 2: startMediaTracker/stopMediaTracker -- per-element listeners, immediate events + throttled heartbeat** - `70589f2` (feat)

**Plan metadata:** (this commit) (docs: complete plan)

_TDD note: both tasks were executed test-first (RED: capture-media.test.js fails on the missing `payload.media` / on the absent tracker emissions; GREEN: implement). Because each task is one tightly-coupled capture slice of new code (no refactor needed), each landed as a single feat commit carrying both its tests and its implementation -- the Plan 13-01 squashed-TDD precedent._

## Files Created/Modified
- `tests/capture-media.test.js` (created) - 10 jsdom tests: Task 1 baseline shape / byte-unchanged html+DOM / finite-vs-Infinity encoding; Task 2 discrete-event immediacy + identity/sentAt stamping / live-encoding on the wire / timeupdate throttle window / paused suppression / added `<video>`+`<audio>` / stop+pause+removal teardown.
- `src/capture/index.js` (modified) - imported `MEDIA_SYNC_THROTTLE_MS`; added `collectTrackedMediaElements()` + `buildMediaBaselineEntry()` (Task 1) and `sendMediaState()` + `attachMediaListeners()`/`detachMediaListeners()` + `attachMediaListenersUnder()`/`detachMediaListenersUnder()` + `startMediaTracker()`/`stopMediaTracker()` (Task 2); media-tracker bookkeeping state (`mediaTrackingActive`, `mediaTracked` Map, `mediaTrackedRecords`); `serializeDOM` media[] append (gated on presence); lifecycle hooks in `start()`/`stop()`/`pause()`/`resume()`; added-node attach + removed-node detach hooks in the mutation loop.

## Decisions Made
- **media[] gated on element presence.** The first implementation always set `snapshotPayload.media` (to `[]` when empty), which broke the differential oracle on every media-free fixture (the FSB reference emits no `media` key, so an empty array is an extracted-only divergence). Gating on `trackedMedia.length > 0` restores byte-identity and matches the plan's own contract ("only populated when media elements exist", RESEARCH A4 / Pitfall 7). The differential-ledger entry + media fixture remain a Plan 13-04 concern, exactly as planned.
- **Per-element listeners, not delegation.** Media events (`play/pause/seeked/timeupdate/...`) do not bubble (RESEARCH Pitfall 3), so the value-tracker's document-level delegated pattern would silently catch nothing. A `Map(element -> {handlers, lastMediaSend})` plus a `mediaTrackedRecords` iteration array (mirroring `valueListenerRoots`/`valueListenerRecords`) makes per-element attach, added-node coverage, and teardown explicit and leak-free.
- **Removal detach precedes wire-drop short-circuit.** `detachMediaListenersUnder(removed)` runs at the top of the element branch in the removed-node loop, before `wireDroppedWithAncestors`/`getTrackedNodeId` guards can `continue`, guaranteeing a removed media element's listeners are always released and it can never emit post-removal.
- **Throttle stamp is per-element.** Each tracked element carries its own `lastMediaSend`, so multiple media elements throttle independently and a hot `timeupdate` loop on one cannot starve another (T-13-06 DoS bound).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] media[] must be gated on media-element presence to preserve differential-oracle byte-identity**
- **Found during:** Task 1 (regression run of `tests/differential/oracle.test.js` after the first GREEN)
- **Issue:** The initial `snapshotPayload.media = collectTrackedMediaElements().map(...)` always added a `media` key (an empty `[]` on media-free pages). The FSB reference emits no such key, so the differential oracle's extracted-vs-reference comparison diverged on the SNAPSHOT message for 10 existing media-free fixtures/scenarios (`basic.html`, `heavy-realistic.html`, `canvas.html`, `dialog.html`, ...). This is precisely the RESEARCH A4 / Pitfall 7 stale-baseline trap and contradicted the plan's own "only populated when media elements exist" wording.
- **Fix:** Guarded the assignment with `if (trackedMedia.length > 0)` so a media-free page emits no `media` key at all.
- **Files modified:** `src/capture/index.js` (the `serializeDOM` media[] append)
- **Commit:** `3fa3c2c` (the fix landed within the Task 1 commit, before it was committed -- caught and resolved during the same RED/GREEN cycle)
- **Verification:** `tests/differential/oracle.test.js` 45/45, full suite 546/546.

This is the only deviation. It is a strengthening to honor the plan's explicit byte-identity verification clause, not a scope change.

## Issues Encountered
The differential-oracle divergence above was the only issue; it was caught immediately by running the oracle in the Task 1 regression set and resolved in one fix (no fix-attempt loop). RED states were the expected failures (Task 1: missing `payload.media`; Task 2: no tracker emissions); both resolved on their GREEN implementations.

## User Setup Required
None - no external service configuration. This plan adds capture glue (a snapshot baseline array + per-element event listeners) and tests; no env vars, no installs (zero packages, per threat register T-13-SC), no service registrations.

## Threat Mitigations Applied
- **T-13-04 (Tampering: media[] baked into HTML clone):** media state is read from the LIVE element and written only to `snapshotPayload.media`; a test asserts `payload.html` and the live element `outerHTML` are byte-unchanged by `serializeDOM` (Phase 7 no-mutation invariant + differential-oracle HTML byte-identity, both green).
- **T-13-05 (Info Disclosure: media bytes on the relay):** `sendMediaState` emits only nid-addressed playback STATE (numbers/booleans/event name); no `src`/blob/media bytes ever enter `safeSend`. The low-bandwidth core value is preserved by construction.
- **T-13-06 (DoS: unthrottled timeupdate):** `timeupdate` is throttled at `MEDIA_SYNC_THROTTLE_MS` and only fires while playing; discrete transitions are bounded one-per-DOM-event; per-element `lastMediaSend` prevents a hot loop. A test proves two timeupdates inside the window send one, a third past it sends another.
- **T-13-07 (Spoofing: late frames from a prior session):** every payload is stamped with the current `streamSessionId` + `snapshotId` for the renderer's `isCurrentStream` guard (Plan 03).
- **T-13-SC (npm installs):** zero packages added.

## Next Phase Readiness
- **Ready for Plan 13-03 (renderer driver):** the wire now carries real `STREAM.MEDIA` traffic and a real snapshot `media[]` baseline. `handleMedia(payload)` can resolve the nid, feed the payload to `reconcileMediaDrift` (Plan 01), and apply the action cross-realm. Every payload field the renderer needs (`event`, `currentTime`, `paused`, `playbackRate`, `duration|live`, `sentAt`, identity stamps) is present and tested.
- **Ready for Plan 13-04 (oracle slice / UAT):** a `media-playback-sync` fixture that instantiates `<video>`/`<audio>` will now make capture emit `media[]` + `STREAM.MEDIA`, producing the extracted-only divergence the D27 differential-ledger entry pins -- which is exactly where the plan deferred it (RESEARCH A4 stale-entry discipline). Real autoplay-policy/seek-on-live behavior is the documented Playwright UAT concern (jsdom has no media timeline).
- No blockers. The throttle cadence is the shared `MEDIA_SYNC_THROTTLE_MS` constant, tunable against the v2.1 evaluation harness per the STATE.md Phase 13 concern.

---
*Phase: 13-video-audio-url-playback-sync*
*Completed: 2026-06-21*

## Self-Check: PASSED

- FOUND: tests/capture-media.test.js
- FOUND: .planning/phases/13-video-audio-url-playback-sync/13-02-SUMMARY.md
- FOUND commit: 3fa3c2c (Task 1)
- FOUND commit: 70589f2 (Task 2)
- FOUND artifact symbol: startMediaTracker in src/capture/index.js
