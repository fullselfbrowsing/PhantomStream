---
phase: 13-video-audio-url-playback-sync
plan: 04
subsystem: differential-oracle
tags: [differential-oracle, divergence-ledger, media-sync, stream-media, snapshot-baseline, fixture, scenario, stale-entry-discipline, single-predicate, esm]

# Dependency graph
requires:
  - phase: 13-video-audio-url-playback-sync
    plan: 01
    provides: "STREAM.MEDIA op + STREAM.SNAPSHOT type strings the D27 predicate keys on"
  - phase: 13-video-audio-url-playback-sync
    plan: 02
    provides: "the extracted capture's media[] snapshot baseline + STREAM.MEDIA emission the fixture deterministically fires"
  - phase: 12-static-assets-by-reference
    provides: "the D26 single-predicate / entry-plus-firing-fixture stale-entry discipline this slice follows"
provides:
  - "tests/differential/fixtures/media-playback-sync.html -- a <video> + <audio> present at snapshot time so the extracted serializeDOM emits a non-empty payload.media baseline"
  - "tests/differential/scenarios/media-playback-sync.js -- beforeStart defineProperty-stubs paused=false/currentTime/finite-duration on both elements (both sides); run dispatches play then a past-throttle timeupdate"
  - "D27-media-playback-sync ledger entry -- single scenario-pinned predicate covering Shape A (trailing STREAM.MEDIA) AND Shape B (media[]-only SNAPSHOT)"
  - "oracle MATRIX registration + flipped-mode D27 branch + media-playback-sync empty-ledger load-bearing test"
affects: [phase-14-adaptive-streaming, phase-15-media-security]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Entry + deterministically-firing fixture land together (D26 stale-entry discipline): the D27 predicate only matches the media surface the extracted core actually emits, and the media-playback-sync fixture/scenario guarantees that surface materializes -- so D27 fires (not stale) on every oracle run"
    - "Single appliesTo predicate covering two divergence shapes (D26 precedent): compareStreams returns the FIRST ledger match, so the trailing-STREAM.MEDIA shape and the media[]-only-SNAPSHOT shape must be one predicate, never two same-index entries (the second could never fire and would fail stale detection)"
    - "Object.defineProperty injection on BOTH sides (static-assets currentSrc trick): paused=false is load-bearing (unlocks the extracted tracker's playing-only timeupdate heartbeat); finite duration drives the VOD baseline shape; harmless on the reference (no media tracker reads them)"

key-files:
  created:
    - tests/differential/fixtures/media-playback-sync.html
    - tests/differential/scenarios/media-playback-sync.js
  modified:
    - tests/differential/divergence-ledger.js
    - tests/differential/oracle.test.js

key-decisions:
  - "D27 cites MEDIA-02/MWIRE-01, NOT MEDIA-03: the reconciler (MEDIA-03) runs renderer-side and produces no wire message, so it is exercised by Plan 01's pure reconciler unit tests -- not this oracle divergence. The oracle only evidences the SNAPSHOT media[] field (MEDIA-02) and the trailing STREAM.MEDIA shape (MWIRE-01)"
  - "Single predicate, two shapes: Shape A (refMsg undefined, extMsg.type === STREAM.MEDIA) and Shape B (both SNAPSHOT, extracted payload.media non-empty, reference none) are folded into one appliesTo per the D26 discipline -- a second entry would be stale-flagged because compareStreams stops at the first match"
  - "No normalize.js change needed: normalizeExtracted passes payload.media through untouched, so the SNAPSHOT diverges on the media key naturally -- unlike D26 (whose markers lived inside payload.html), media[] is a new top-level field the comparator's deepStrictEqual already sees"
  - "paused=false stub is the load-bearing one: the extracted tracker's timeupdate handler returns early while el.paused, and jsdom reports an unloaded element as paused. Without the stub the heartbeat (Shape A's second message) would never fire; the finite-duration stub makes the baseline carry duration (VOD) not live:true"

patterns-established:
  - "media-playback-sync flipped branch asserts D27 fires + matched.size === 1 + belt-and-braces on both shapes (extracted media[] present / reference absent; extracted STREAM.MEDIA play + timeupdate present / reference zero) -- the exact static-assets/D26 branch shape"
  - "Task 1 lands the fixture+scenario+registration and PROVES the divergence by the oracle hard-failing UNDECLARED DIVERGENCE; Task 2 lands the D27 entry that declares the exact shape and restores green -- the two land in immediate succession per the entry-plus-firing-fixture rule"

requirements-completed: [MEDIA-02, MWIRE-01]

# Metrics
duration: 9min
completed: 2026-06-21
---

# Phase 13 Plan 04: Media-Playback-Sync Oracle Slice + D27 Ledger Entry Summary

**The oracle-discipline slice: a media-playback-sync fixture + scenario that deterministically drives a real `<video>`/`<audio>` so the extracted core emits a `media[]` baseline and `STREAM.MEDIA` messages the FSB reference does not, plus a single scenario-pinned D27 ledger entry that declares exactly that extracted-only divergence -- keeping the differential oracle green (48/48) now that Plan 02 ships media capture, with D27 firing and not flagged stale.**

## Performance

- **Duration:** ~9 min
- **Completed:** 2026-06-21
- **Tasks:** 2
- **Files modified:** 4 (2 created, 2 modified)

## Accomplishments

- **media-playback-sync fixture + scenario (Task 1):** `media-playback-sync.html` carries a `<video id="media-vid" src="https://cdn.fixture.test/clip.mp4">` and an `<audio id="media-aud" src="https://cdn.fixture.test/clip.mp3">` present at snapshot time, so the extracted `serializeDOM` emits a non-empty `payload.media` baseline (the FSB reference emits no `media[]` field). `media-playback-sync.js` `beforeStart`-stubs `paused=false`/`currentTime=5`/`duration=30` on both elements on BOTH sides via `Object.defineProperty` (the static-assets `currentSrc`-injection trick -- harmless on the reference, load-bearing on the extracted side), and `run` dispatches a discrete `play` then, past `MEDIA_SYNC_THROTTLE_MS` (300 ms > 250 ms), a `timeupdate` heartbeat -- exercising the immediate + throttled `STREAM.MEDIA` emit paths. Registered in the oracle MATRIX exactly as static-assets/scroll are.
- **Divergence proven REAL before declaring it (Task 1):** with the fixture registered but no ledger entry, the oracle hard-failed `UNDECLARED DIVERGENCE media-playback-sync.html/media-playback-sync at message 1` -- the extracted SNAPSHOT carrying `media[]` (finite `duration: 30`, `paused: false`, `currentTime: 5` for both elements) the reference lacks -- confirming the fixture deterministically fires the divergence (the D26 entry-plus-firing-fixture proof).
- **D27 ledger entry, single predicate, two shapes (Task 2):** `D27-media-playback-sync` (kind `mismatch`, `affectedScenarios: ['media-playback-sync']`, `affectedMessages: [STREAM.SNAPSHOT, STREAM.MEDIA]`) copies the D26 structure. One `appliesTo(refMsg, extMsg, scenarioName)` returns false unless the scenario is `media-playback-sync`, then matches Shape A (extracted-only trailing `STREAM.MEDIA`: `refMsg === undefined && extMsg.type === STREAM.MEDIA`) and Shape B (same-index SNAPSHOT where only the extracted `payload.media` is a non-empty array). Kept to ONE predicate per the D26 discipline (`compareStreams` returns the first match, so a second same-index entry could never fire and would fail stale detection).
- **Rationale scoped to MEDIA-02/MWIRE-01 (Task 2):** the entry's rationale names the `media[]` baseline (MEDIA-02) and the `STREAM.MEDIA` side channel (MWIRE-01) as the intentional extracted-only divergences, and explicitly excludes MEDIA-03 (the pure reconciler runs renderer-side and emits no wire message -- it is covered by Plan 01's reconciler unit tests). CONTEXT-locked: media state travels side-channel-by-nid like `DIFF_OP.VALUE`, never baked into the HTML clone.
- **Oracle stays green with D27 firing, not stale:** the flipped-mode `media-playback-sync` branch asserts D27 fires and is the only entry consulted (`matched.size === 1`), with belt-and-braces direct assertions on both shapes; the empty-ledger load-bearing test proves D27 is the thing permitting the divergence; the final stale-entry detector (`every declared mismatch divergence matched at least one real divergence`) passes -- D27 is NOT stale, and no prior ledger entry regressed.
- **No comparator gap, no envelope/relay touch:** `normalize.js` needed no change -- `normalizeExtracted` passes `payload.media` through untouched, so the SNAPSHOT diverges on the new top-level `media` key naturally (unlike D26, whose markers lived inside `payload.html`). Envelope and relay are byte-unchanged.

## Task Commits

Each task was committed atomically:

1. **Task 1: media-playback-sync fixture + scenario firing the extracted-only media divergence** - `78a4d19` (test)
2. **Task 2: D27 ledger entry declaring the exact media divergence (single predicate, D26 discipline)** - `43e04c3` (test)

**Plan metadata:** (this commit) (docs: complete plan)

## Files Created/Modified

- `tests/differential/fixtures/media-playback-sync.html` (created) - snapshot-time `<video>` + `<audio>` so the extracted `media[]` baseline is non-empty; absolutified src URLs ride identically on both sides (no divergence there).
- `tests/differential/scenarios/media-playback-sync.js` (created) - `beforeStart` defineProperty-stubs `paused=false`/`currentTime`/finite `duration` on both media elements (both sides); `run` dispatches `play` then a past-throttle (300 ms) `timeupdate`.
- `tests/differential/divergence-ledger.js` (modified) - added the `D27-media-playback-sync` mismatch entry after D26 (single `appliesTo` predicate covering Shape A + Shape B).
- `tests/differential/oracle.test.js` (modified) - imported the scenario; added the MATRIX entry; added the flipped-mode `media-playback-sync` branch (D27 fires, `matched.size === 1`, both-shape belt-and-braces); added the `media-playback-sync` empty-ledger load-bearing test.

## Decisions Made

- **D27 cites MEDIA-02/MWIRE-01, not MEDIA-03.** The plan and RESEARCH are explicit: the reconciler (MEDIA-03) is renderer-side and emits no wire message, so it cannot be an oracle divergence -- it is exercised by Plan 01's pure `media-reconcile` unit tests. The oracle only evidences the SNAPSHOT `media[]` field (MEDIA-02) and the trailing `STREAM.MEDIA` shape (MWIRE-01); the rationale says so to keep the entry honest.
- **One predicate, two shapes.** `compareStreams` returns the FIRST ledger match and stops, so Shape A (trailing `STREAM.MEDIA`) and Shape B (`media[]`-only SNAPSHOT) MUST be one predicate. A second same-index entry would never be reached and would fail stale-entry detection -- the exact D26 lesson (STATE.md `[Phase 12-02]`).
- **`paused=false` is the load-bearing stub.** The extracted tracker's `timeupdate` handler returns early while `el.paused`, and jsdom reports an unloaded media element as `paused === true`. Without the stub, the `timeupdate` heartbeat (Shape A's second message) would never fire. The finite-`duration` stub makes the baseline carry `duration` (VOD) rather than `live:true` (the Infinity->null path), so Shape B is the finite-duration baseline the predicate and the branch assertions claim.
- **No normalize.js change.** `payload.media` is a NEW top-level snapshot field that `normalizeExtracted` passes through untouched, so the SNAPSHOT comparison's `deepStrictEqual` already diverges on the `media` key -- the RESEARCH normalize.js caveat is satisfied without code (D26 did not change the normalizer either, but for a different reason: its markers lived in `html`).

## Deviations from Plan

None - plan executed exactly as written. Task 1 landed the fixture + scenario + MATRIX registration and PROVED the divergence by the oracle hard-failing `UNDECLARED DIVERGENCE` (the plan's stated proof-of-divergence step); Task 2 landed the D27 entry + assertions and restored the oracle to green with D27 firing and not stale. The two tasks landed in immediate succession, honoring the entry-plus-firing-fixture rule (the brief inter-commit window where Task 1's MATRIX entry is undeclared is the documented proof, not a defect).

## Issues Encountered

None. The jsdom probe (run before authoring) confirmed `Object.defineProperty` works on `paused`/`currentTime`/`duration` for both `<video>` and `<audio>`, dispatched `play`/`timeupdate` events reach per-element listeners, and `querySelectorAll('video, audio')` returns 2 -- so the fixture/scenario fired the divergence on the first oracle run with no iteration. The Task 1 hard-failure was the intended proof, not a bug. D27 restored green on the first run.

## Threat Mitigations Applied

- **T-13-14 (Tampering: oracle blind to media divergence):** the scenario-pinned D27 entry + the deterministically-firing media fixture make every extracted-only media divergence an explicit, reviewed ledger declaration; an undeclared media divergence still hard-fails the oracle (proven by the empty-ledger load-bearing test).
- **T-13-15 (Repudiation: silent stale entry):** entry + firing fixture landed together; single predicate per the D26 discipline; the stale-entry detector confirms D27 fires on the media-playback-sync scenario (`every declared mismatch divergence matched at least one real divergence` passes).
- **T-13-SC (npm installs):** zero packages added (test fixtures/scenarios + a ledger entry only).

## User Setup Required

None - no external service configuration, no env vars, no installs. This plan adds test-only differential-oracle artifacts (a fixture, a scenario, a ledger entry, and oracle wiring); no production code, no envelope/relay change.

## Next Phase Readiness

- **Phase 13 oracle discipline complete:** the differential oracle is green (48/48) with the full media surface (Plan 01 protocol + reconciler, Plan 02 capture, Plan 03 renderer) declared by D27. The full suite is 580/580.
- **Ready for Phase 14 (adaptive streaming):** when adaptive playback adds new wire surface (HLS/DASH manifest hints, `blob:` in `media-src`), the established pattern is a new scenario-pinned ledger entry + a deterministically-firing fixture, landed together, single predicate -- exactly this slice's shape.
- **Documented Playwright UAT remains deferred** (real autoplay-policy / seek-on-live / `seekable.end` throwing / real media fetch -- jsdom has no media timeline), matching the Phase 12-03 / Phase 6 UAT-deferral precedent. The oracle covers the message-stream divergence; the UAT covers real-browser playback behavior.
- No blockers.

---
*Phase: 13-video-audio-url-playback-sync*
*Completed: 2026-06-21*

## Self-Check: PASSED

- FOUND: tests/differential/fixtures/media-playback-sync.html
- FOUND: tests/differential/scenarios/media-playback-sync.js
- FOUND: .planning/phases/13-video-audio-url-playback-sync/13-04-SUMMARY.md
- FOUND commit: 78a4d19 (Task 1)
- FOUND commit: 43e04c3 (Task 2)
- FOUND: D27-media-playback-sync entry in tests/differential/divergence-ledger.js
- FOUND: media-playback-sync registered in tests/differential/oracle.test.js
- Oracle 48/48 green; full suite 580/580 green; D27 fires and is not flagged stale
