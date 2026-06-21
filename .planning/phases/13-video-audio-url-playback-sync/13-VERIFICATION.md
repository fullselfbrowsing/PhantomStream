---
phase: 13-video-audio-url-playback-sync
verified: 2026-06-21T00:00:00Z
status: human_needed
score: 7/7 must-haves verified
mode: mvp
overrides_applied: 0
re_verification:
  previous_status: none
  note: initial verification (no prior VERIFICATION.md)
human_verification:
  - test: "Muted programmatic autoplay actually starts in an allow-same-origin srcdoc iframe (and an unmuted source shows the unmute affordance)"
    expected: "Real Chrome: load the two-tab/loopback demo with a muted <video>; playback starts in the viewer without a gesture; an unmuted source surfaces the amber Unmute pill which, on click, unmutes + restores volume"
    why_human: "jsdom does not implement real play()/autoplay policy; the driver logic and unmute trigger are unit-verified but real-browser autoplay can only be observed in Chrome (13-VALIDATION Manual-Only; RESEARCH Open Question 1)"
  - test: "Rejected play() shows the click-to-play affordance and resumes on a real user click"
    expected: "Real Chrome: block autoplay (unmuted, no gesture); the media-blocked scrim + amber play button appears over the element and a real click starts playback; mirror never wedges"
    why_human: "Autoplay rejection (NotAllowedError) only occurs in a real browser; jsdom stubs the rejection but cannot exercise the real user-gesture re-play path"
  - test: "Live stream seekable.end(0) no-throw + rejoin-edge on a real live <video>"
    expected: "Real Chrome: an HLS-less live <video> (infinite/NaN duration); the live-rejoin guard never throws IndexSizeError and rejoins the edge on large drift"
    why_human: "jsdom's seekable.end is lenient; real browsers throw IndexSizeError when the range is empty — the seekable.length>0 guard is unit-verified but the real-throw boundary needs Chrome"
  - test: "Real-timeline drift converges under rate-nudge / hard-seek"
    expected: "Real Chrome: induce drift; small drift converges via the bounded ±5% rate-nudge and large drift hard-seeks to the clamped expected position"
    why_human: "jsdom has no advancing media timeline; the reconciler decision tree is exhaustively unit-tested but real convergence behavior needs a live timeline"
---

# Phase 13: Video/Audio URL + Playback Sync — Verification Report

**Phase Goal:** The defining v2.0 capability — progressive `<video>`/`<audio>` play in the viewer from the source URL with drift-corrected playback sync (play/pause/seek/rate) over a new throttled `STREAM.MEDIA` side channel, autoplay-policy-correct, with the relay and envelope untouched and old viewers safely ignoring the new type.
**Verified:** 2026-06-21T00:00:00Z
**Status:** human_needed
**Mode:** mvp (phase goal is a user story; all 4 plans share it)
**Re-verification:** No — initial verification

## Goal Achievement

This is an MVP-mode phase: the goal is the user story shared across all four plans —
"mirror a `<video>`/`<audio>` element's playback (play/pause/seek/rate) from the captured
tab over a new throttled side channel with drift-corrected sync, so the viewer plays the
source media in lockstep without the bytes crossing the relay and without wedging on
autoplay policy." The five ROADMAP Success Criteria are the testable outcome clauses.

### User Flow Coverage (MVP outcome trace)

| Flow step | Expected | Evidence in codebase | Status |
|-----------|----------|----------------------|--------|
| Source media state is captured | snapshot `media[]` baseline + per-element listeners on `<video>`/`<audio>` | `src/capture/index.js` `buildMediaBaselineEntry` (4681), `collectTrackedMediaElements` (4648), `startMediaTracker` (4839); append gated on non-empty (3774) | ✓ VERIFIED |
| Playback events stream over STREAM.MEDIA | discrete events flush immediately; `timeupdate` throttled 250ms playing-only | `sendMediaState`+`attachMediaListeners` (4707/4738); discrete list (4756); throttle `MEDIA_SYNC_THROTTLE_MS` | ✓ VERIFIED |
| Drift is reconciled purely | hold/nudge/seek/rejoin-edge action, no NaN, no DOM | `src/protocol/media-reconcile.js` (188 lines, 0 imports); 33 table tests green | ✓ VERIFIED |
| Viewer drives the in-iframe element cross-realm | parent-realm `.play()/.pause()/.currentTime=`; element never scripted | `handleMedia` (1744)→`applyMediaAction` (1688); sandbox exactly `allow-same-origin` (530) | ✓ VERIFIED (auto) / real playback → human |
| Autoplay-correct, never wedges | muted-default, blocked-play affordance + `onMediaBlocked`, unmute affordance | `ensurePlaying` (1658) muted+guard+NotAllowedError; `evaluateUnmuteTrigger` (1778) | ✓ VERIFIED (auto) / real autoplay → human |
| Bytes never cross the relay | only nid-addressed state on the wire; envelope/relay untouched | `envelope.js` + `ws-handler.js` byte-unchanged (last commit `ab4152e`); no "media" token in either | ✓ VERIFIED |
| Old viewers ignore the new type | dispatch `default: break` swallows STREAM.MEDIA | `dispatch` switch (1839); test "unknown wire type ... silently ignored" (renderer-media:312) | ✓ VERIFIED |

### Observable Truths (ROADMAP Success Criteria + merged PLAN must_haves)

| #  | Truth | Status | Evidence |
| -- | ----- | ------ | -------- |
| 1 | SC1: progressive `<video>`/`<audio>` play cross-realm from the parent, bytes from source URL, no player code in the no-`allow-scripts` sandbox | ✓ VERIFIED | Parent-realm driver `applyMediaAction` (index.js:1688) calls `.play()/.pause()/.currentTime=`/`.playbackRate=` on the resolved in-iframe element; sandbox set+asserted exactly `allow-same-origin` (index.js:530-533); `grep allow-scripts src/renderer/` finds only forbidding comments/asserts/README — no `setAttribute` with it. Real muted-autoplay start → human item 1. |
| 2 | SC2: initial media state captured as baseline; play/pause/seek/ratechange apply with drift-corrected interpolation, hard-seek only on large/explicit, never per-message | ✓ VERIFIED | `media[]` baseline (capture:3774) carries currentTime/paused/muted/volume/playbackRate/loop/duration|live/ended; reconciler hold band ≤0.25s (media-reconcile:175), nudge (0.25,1.0] (180), hard-seek >1.0 (187), explicit `seeked` short-circuit (127). Hard-seek is reconciler-decided, never per-message. |
| 3 | SC3: STREAM.MEDIA nid-addressed + identity-stamped within raw-relay + 1 MiB cap; envelope-backward-compatible (old viewers ignore); relay + envelope unchanged | ✓ VERIFIED | `STREAM.MEDIA='ext:dom-media'` (messages.js:25); `sendMediaState` stamps nid+sentAt+streamSessionId+snapshotId (capture:4708-4721); `envelope.js`/`ws-handler.js` last touched only by extraction commit `ab4152e` (no phase-13 edit), zero "media" references; old-viewer-ignores test green (renderer-media:312); protocol.test round-trip + 1 MiB cap green. |
| 4 | SC4 / MWIRE-02: drift reconciler is a pure, configurable, jsdom-unit-testable function; `Infinity` duration → no NaN | ✓ VERIFIED | `media-reconcile.js` zero imports (grep import/require = 0), no DOM/element, caller passes `now`; `duration|live` split closes Infinity→null; 33 table tests (incl. NaN/edge-trap rows) green; live branch taken before any duration arithmetic (151). |
| 5 | SC5 / MEDIA-05: viewer honors autoplay policy — muted-autoplay default + observable affordance on rejected `play()` — mirror never wedges | ✓ VERIFIED (auto) | `ensurePlaying` sets `muted=true` before first play (1660), `if (p !== undefined && typeof p.catch === 'function')` guard (1667), NotAllowedError → `showBlockedPlayAffordance` + `safeInvokeMediaHook(onMediaBlocked)` (1669-1672); throwing hook caught→logged (1614-1620). Real autoplay-block observation → human item 2. |
| 6 | MEDIA-04: `<audio>` mirrored by the identical URL + playback-state model as `<video>` | ✓ VERIFIED | `collectTrackedMediaElements` queries `video, audio` (4651); `attachMediaListeners` accepts both (4742); fixture has both (`media-vid`, `media-aud`); capture-media added-node test covers both. |
| 7 | MWIRE-01 (differential discipline): the oracle stays green; D27 scenario-pinned ledger entry declares the exact extracted-only media divergence; not stale | ✓ VERIFIED | `D27-media-playback-sync` (divergence-ledger:664) single predicate covering Shape A (trailing STREAM.MEDIA, 705) + Shape B (media[]-only SNAPSHOT, 713-719) scenario-guarded (700); oracle.test 48/48 green incl. "every declared mismatch matched a real divergence" (D27 not stale) and an EMPTY-ledger negative test proving the fixture fires. |

**Score:** 7/7 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
| -------- | -------- | ------ | ------- |
| `src/protocol/media-reconcile.js` | Pure reconciler + DEFAULT_MEDIA_RECONCILE_CONFIG, ≥60 lines, 0 imports | ✓ VERIFIED | 188 lines; exports both; zero imports; wired via barrel + renderer import |
| `src/protocol/messages.js` | STREAM.MEDIA op + MediaSyncPayload/MediaBaselineEntry typedefs | ✓ VERIFIED | `MEDIA:'ext:dom-media'` (25); both typedefs complete (180-230) |
| `src/protocol/constants.js` | MEDIA_SYNC_THROTTLE_MS=250 | ✓ VERIFIED | line 42 with unit/derivation comment |
| `src/protocol/index.js` | barrel re-exports media-reconcile.js | ✓ VERIFIED | `export * from './media-reconcile.js'` (5) |
| `src/capture/index.js` | startMediaTracker/stopMediaTracker + media[] baseline + per-element listeners + skip-gating + truncation prune | ✓ VERIFIED | All present + lifecycle-wired (start/stop/pause/resume); WR-01 skip predicate (4658/4749); WR-02 prune (2832/2858/3785) |
| `src/renderer/snapshot.js` | media-src CSP + string-layer gate over <video>/<source>/poster, mode-aware (CR-01) | ✓ VERIFIED | CSP `media-src http: https: data:` no blob (548); `gateOneMediaTag` distinct kinds + poster-strip (351); WR-03 `</video>` consume (484) |
| `src/renderer/overlays.js` | media-blocked / media-unmute / media-poster renderFns + CSS + glyphs | ✓ VERIFIED | three `register(...)` kinds; `ps-overlay-media-*` CSS (140+); `MEDIA_GLYPH` static SVG (227) |
| `src/renderer/index.js` | handleMedia + parent-realm driver + onMediaBlocked + unmute + mediaMode poster gate | ✓ VERIFIED | `case STREAM.MEDIA` (1863); `handleMedia` (1744); reconciler import+call (43/1761); poster-mode `gateAssetUrl` block (164) |
| `tests/media-reconcile.test.js` | reconciler table tests | ✓ VERIFIED | 33 tests green |
| `tests/capture-media.test.js` | baseline/throttle/added-node tests | ✓ VERIFIED | 12 tests green |
| `tests/renderer-media.test.js` | driver/affordance/autoplay/mediaMode/staleness/backward-compat | ✓ VERIFIED | 24 tests green incl. CR-01 string-layer poster assertion |
| `tests/renderer-media-csp.test.js` | media-src CSP + pre-parse gating | ✓ VERIFIED | 12 tests green incl. WR-03 tags |
| `tests/differential/fixtures/media-playback-sync.html` | <video>+<audio> at snapshot time | ✓ VERIFIED | `media-vid`/`media-aud` (20-21) |
| `tests/differential/scenarios/media-playback-sync.js` | beforeStart stubs + play/timeupdate run | ✓ VERIFIED | registered; oracle executes it |
| `tests/differential/divergence-ledger.js` | D27 single-predicate entry | ✓ VERIFIED | D27 present, scenario-pinned, not stale |

### Key Link Verification

| From | To | Via | Status | Details |
| ---- | -- | --- | ------ | ------- |
| `src/protocol/index.js` | `media-reconcile.js` | barrel re-export | ✓ WIRED | line 5 |
| `tests/media-reconcile.test.js` | `media-reconcile.js` | direct import | ✓ WIRED | 33 tests import + call |
| `src/renderer/index.js` | `media-reconcile.js` | import + call per message | ✓ WIRED | import (43), call in handleMedia (1761) |
| `src/renderer/index.js` dispatch | `handleMedia` | `case STREAM.MEDIA` | ✓ WIRED | 1863; default branch (1869) ignores for old viewers |
| `src/capture/index.js` | `STREAM.MEDIA` | `safeSend` on each event | ✓ WIRED | `sendMediaState`→`safeSend(STREAM.MEDIA, payload)` (4724) |
| `startMediaTracker()` | start/resume; teardown stop/pause | armed/torn down next to scroll tracker | ✓ WIRED | start:4947, resume:4992, stop:4960, pause:4974, re-inject guard:4937 |
| renderer media driver | `gateAssetUrl` | mediaMode poster/reference posture | ✓ WIRED | poster-mode-media block (165); per-viewer `gateAsset` (349) |
| D27.appliesTo | STREAM.MEDIA + SNAPSHOT media[] | scenario-pinned predicate | ✓ WIRED | 696-723, single predicate, oracle confirms not stale |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
| -------- | ------------- | ------ | ------------------ | ------ |
| `handleMedia` driver | `localState`/`payload` | live in-iframe element props + decoded STREAM.MEDIA payload from capture | Yes — capture `sendMediaState` emits real element props on real DOM events; reconciler consumes them | ✓ FLOWING |
| `media[]` baseline | `snapshotPayload.media` | `collectTrackedMediaElements().map(buildMediaBaselineEntry)` reading live `<video>/<audio>` | Yes — read from live DOM, omitted when none present | ✓ FLOWING |
| D27 oracle divergence | `extMsg.payload.media` / trailing STREAM.MEDIA | extracted core driving the real fixture `<video>/<audio>` | Yes — fixture instantiates media; EMPTY-ledger negative test proves the divergence fires | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| -------- | ------- | ------ | ------ |
| Reconciler is pure (zero imports) | `grep -cE '^(import|.*require)' src/protocol/media-reconcile.js` | 0 | ✓ PASS |
| Envelope byte-unchanged in phase 13 | `git log --oneline -- src/protocol/envelope.js` | only `ab4152e` (extraction) | ✓ PASS |
| Relay byte-unchanged in phase 13 | `git log --oneline -- reference/server/ws-handler.js` | only `ab4152e` | ✓ PASS |
| No "media" special-casing in envelope/relay | `grep -i media envelope.js ws-handler.js` | no matches | ✓ PASS |
| Sandbox exactly allow-same-origin, no allow-scripts | `grep allow-scripts src/renderer/` | only comments/asserts/README | ✓ PASS |
| Reconciler table suite | `node --test tests/media-reconcile.test.js` | 33/33 pass | ✓ PASS |
| Capture media suite | `node --test tests/capture-media.test.js` | 12/12 pass | ✓ PASS |
| Renderer media suite | `node --test tests/renderer-media.test.js` | 24/24 pass | ✓ PASS |
| Renderer media CSP suite | `node --test tests/renderer-media-csp.test.js` | 12/12 pass | ✓ PASS |
| Differential oracle (D27 + stale detector) | `node --test tests/differential/oracle.test.js` | 48/48 pass | ✓ PASS |
| Full suite | `npm test` | 588 pass / 0 fail | ✓ PASS |

### Probe Execution

No probe scripts declared for this phase (no `scripts/*/tests/probe-*.sh`; not a migration/tooling phase). Verification is test-suite-based per 13-VALIDATION.md. N/A.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
| ----------- | ----------- | ----------- | ------ | -------- |
| MEDIA-01 | 13-03 | Progressive `<video>` plays in the viewer, bytes from source URL, never via relay | ✓ SATISFIED | Cross-realm driver + media-src CSP + by-reference gate; no media bytes on wire (only state). Real playback → human. |
| MEDIA-02 | 13-02, 13-04 | Initial media state captured in snapshot baseline | ✓ SATISFIED | `media[]` baseline with full field set; D27 oracle entry; capture-media tests |
| MEDIA-03 | 13-01 | Playback changes apply with drift-corrected interpolation, hard-seek only on large drift | ✓ SATISFIED | reconciler hold/nudge/seek bands; explicit-seek short-circuit; 33 tests |
| MEDIA-04 | 13-02 | `<audio>` mirrored by identical URL + state model as video | ✓ SATISFIED | `video, audio` query; identical entry shape; both in fixture + added-node tests |
| MEDIA-05 | 13-03 | Autoplay-correct (muted default + affordance on rejection); never wedges | ✓ SATISFIED (auto) | muted-default + NotAllowedError affordance + onMediaBlocked + unmute trigger; real autoplay → human |
| MWIRE-01 | 13-01, 13-02, 13-03, 13-04 | STREAM.MEDIA nid-addressed throttled op, envelope-backward-compat, relay/envelope untouched | ✓ SATISFIED | op + typedefs; identity stamps; old-viewer-ignores; envelope/relay byte-unchanged; D27 |
| MWIRE-02 | 13-01 | Drift reconciler is pure, configurable, jsdom-unit-testable | ✓ SATISFIED | zero-import pure function; configurable defaults; 33 jsdom tests, no real timeline |

All 7 declared requirement IDs (MEDIA-01..05, MWIRE-01, MWIRE-02) are accounted for and SATISFIED.
REQUIREMENTS.md maps exactly these 7 to Phase 13 (all marked Complete) — no orphaned requirements expected of this phase, no extra IDs. MADPT-* (Phase 14) and MSEC-03/04 (Phase 15) are correctly out of scope and confirmed absent (no hls.js, no blob: in media-src).

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| ---- | ---- | ------- | -------- | ------ |
| (none) | — | No TBD/FIXME/XXX in any phase-13 source file | — | Debt-marker gate: clean. Completion is auditable. |
| (none) | — | No stub/placeholder implementations in media code paths | — | The "placeholder" tokens found are the legitimate asset-unavailable placeholder feature + WR-03 test descriptions, not stub markers |

No blocker or warning anti-patterns. The reconciler is NaN-proof by construction + test; all driver element mutations are try/caught (never wedge); no orphaned exports (every new symbol is imported and used).

### Code Review Fix Confirmation (13-REVIEW.md: CR-01 + WR-01..04)

The REVIEW marks these resolved with commit hashes; all fixes are real in the code:

| Finding | Fix | Confirmed in code |
| ------- | --- | ----------------- |
| CR-01 (BLOCKER): poster-mode string-layer gate was mode-blind, leaking the media GET | `gateAssetUrl` step-5 poster-mode-media block + `gateOneMediaTag` distinct kinds + surgical src-strip | index.js:164-166, snapshot.js:366-373; commit edd4945; test renderer-media:520 asserts the STRING output (clip.mp4/webm stripped, poster kept) so it cannot silently reopen |
| WR-01: skipped host-UI media still tracked | skip/block/wire-drop predicates applied at collect + attach chokepoint | capture:4658-4661, 4749; commit 69d109f |
| WR-02: truncated snapshot could strand a media[] nid | `pruneMediaToNodeIds` in truncation loop + hard-reset + post-fit | capture:2832/2858/3785; commit b8cfd15 |
| WR-03: blocked `<video>` orphaned `</video>` | consume through matching `</video>` via `findMatchingCloseTag` | snapshot.js:484-486; commit fc7015d; tests renderer-media-csp:98/115/127 |
| WR-04: weak proximity-heuristic guard | strengthened to assert overlays.js has no transport/safeSend/.send token | commit f91db12; deferred IN-01..03 are tidiness-only INFO |

### Human Verification Required

The four items below are jsdom-unautomatable real-browser behaviors, documented as deferrable
in 13-VALIDATION.md (Manual-Only Verifications) and RESEARCH Open Question 1, per the
Phase 12-03 / Phase 6 UAT-deferral precedent. The corresponding driver/reconciler/guard logic
is fully unit-verified above; only the real-browser observation remains. These surface as UAT —
they do NOT block the phase goal.

#### 1. Muted programmatic autoplay starts in an allow-same-origin srcdoc (+ unmute affordance)

**Test:** Real Chrome — load the two-tab/loopback demo with a muted `<video>`; then an unmuted source.
**Expected:** Playback starts in the viewer without a gesture; an unmuted source shows the amber Unmute pill which, on click, unmutes + restores volume.
**Why human:** jsdom does not implement real `play()`/autoplay policy.

#### 2. Rejected play() shows the click-to-play affordance and resumes on a real click

**Test:** Real Chrome — block autoplay (unmuted, no gesture).
**Expected:** The media-blocked scrim + amber play button appears; a real click starts playback; the mirror keeps updating (never wedges).
**Why human:** NotAllowedError rejection + user-gesture re-play only occur in a real browser.

#### 3. Live stream seekable.end(0) no-throw + rejoin-edge

**Test:** Real Chrome — an HLS-less live `<video>` (infinite/NaN duration).
**Expected:** The live-rejoin guard never throws IndexSizeError and rejoins the edge on large drift.
**Why human:** jsdom's `seekable.end` is lenient; real browsers throw IndexSizeError when empty.

#### 4. Real-timeline drift converges under rate-nudge / hard-seek

**Test:** Real Chrome — induce drift on an advancing timeline.
**Expected:** Small drift converges via the bounded ±5% rate-nudge; large drift hard-seeks to the clamped expected position.
**Why human:** jsdom has no advancing media timeline.

### Gaps Summary

No gaps. All 7 observable truths are VERIFIED against the codebase, all 15 artifacts exist at
all four levels (exist, substantive, wired, data-flowing), all 8 key links are WIRED, all 7
requirement IDs are SATISFIED, the full suite is green (588/0, matching the documented baseline),
and the four phase invariants hold in code: (a) envelope.js + relay byte-unchanged with no media
special-casing; (b) iframe sandbox exactly `allow-same-origin`, no `allow-scripts` anywhere in
src/renderer/; (c) `reconcileMediaDrift` is pure with zero imports and touches no media element;
(d) `media[]` is omitted when no media elements exist (differential-oracle byte-identity preserved);
(e) CR-01's poster-mode string-layer media neutralization is real and guarded by a string-output
assertion. The code-review BLOCKER (CR-01) and all four warnings are genuinely fixed in the code,
not merely claimed.

Status is `human_needed` solely because four real-browser media behaviors (muted autoplay start,
real play()-rejection affordance, live `seekable.end` no-throw, real-timeline drift convergence)
cannot be exercised in jsdom and are documented as deferrable UAT. Their backing logic is
unit-verified; these are observation-only confirmations, not implementation gaps.

---

_Verified: 2026-06-21T00:00:00Z_
_Verifier: Claude (gsd-verifier)_
