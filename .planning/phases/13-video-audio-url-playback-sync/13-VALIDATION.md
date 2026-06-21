---
phase: 13
slug: video-audio-url-playback-sync
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-06-20
---

# Phase 13 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Derived from 13-RESEARCH.md `## Validation Architecture`. Task IDs are assigned by the planner; this map is requirement-level until plans exist.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Node built-in `node:test` + `node:assert/strict`; jsdom ^29.1.1 for DOM |
| **Config file** | none — `package.json` `scripts.test` |
| **Quick run command** | `node --test tests/media-reconcile.test.js` (pure reconciler — sub-second, no jsdom) |
| **Full suite command** | `node --test tests/*.test.js tests/differential/*.test.js` |
| **Estimated runtime** | ~full suite seconds (baseline 449/449 green per STATE.md) |

---

## Sampling Rate

- **After every task commit:** Run `node --test tests/media-reconcile.test.js` plus the touched module's test file.
- **After every plan wave:** Run `node --test tests/*.test.js tests/differential/*.test.js` (full suite, includes the differential oracle).
- **Before `/gsd:verify-work`:** Full suite must be green (baseline 449/449); the documented real-Chrome media UAT recorded or explicitly deferred (Phase 12-03 / Phase 6 UAT-deferral precedent).
- **Max feedback latency:** reconciler < 1s; full suite seconds.

---

## Per-Task Verification Map

> Requirement-level until the planner assigns task IDs. Every row maps a phase requirement / edge case to a concrete automated test. Threat refs from 13-RESEARCH Security Domain (V12/SSRF, V14/CSP, sandbox isolation).

| Requirement | Behavior | Threat Ref | Test Type | Automated Command | File | Status |
|-------------|----------|------------|-----------|-------------------|------|--------|
| MWIRE-02 | Hold band (drift ≤ 0.25 s → hold) | — | unit (pure) | `node --test tests/media-reconcile.test.js` | ❌ W0 | ⬜ pending |
| MWIRE-02 | Rate-nudge (0.25–1.0 s → ±≤5% rate, correct sign) | — | unit (pure) | `node --test tests/media-reconcile.test.js` | ❌ W0 | ⬜ pending |
| MWIRE-02 | Nudge revert (back in-band → true rate) | — | unit (pure) | `node --test tests/media-reconcile.test.js` | ❌ W0 | ⬜ pending |
| MEDIA-03 | Hard-seek (drift > 1.0 s → seek to clamped expected) | — | unit (pure) | `node --test tests/media-reconcile.test.js` | ❌ W0 | ⬜ pending |
| MEDIA-03 | Explicit `seeked` → always hard-seek regardless of drift | — | unit (pure) | `node --test tests/media-reconcile.test.js` | ❌ W0 | ⬜ pending |
| MEDIA-03 | Loop-wrap → seek to wrapped position, not raw delta | — | unit (pure) | `node --test tests/media-reconcile.test.js` | ❌ W0 | ⬜ pending |
| MWIRE-02 | Live branch (`live`/non-finite duration) → never absolute-seek; rejoin-edge only on large drift | — | unit (pure) | `node --test tests/media-reconcile.test.js` | ❌ W0 | ⬜ pending |
| MWIRE-02 | NaN/edge traps (Infinity dur, dur 0, neg elapsed, rate 0, paused remote, missing fields) → no NaN, safe action | — | unit (pure) | `node --test tests/media-reconcile.test.js` | ❌ W0 | ⬜ pending |
| MWIRE-02 | Latency comp: `expected = currentTime + rate*(now−sentAt)/1000` | — | unit (pure) | `node --test tests/media-reconcile.test.js` | ❌ W0 | ⬜ pending |
| MWIRE-01 | `STREAM.MEDIA` + `MediaSyncPayload` typedef exported | — | unit | `node --test tests/protocol.test.js` (extend) | ⚠️ extend | ⬜ pending |
| MWIRE-01 | Old viewer (no `STREAM.MEDIA` case) silently ignores; no throw, no state change | — | unit (jsdom) | `node --test tests/renderer-media.test.js` | ❌ W0 | ⬜ pending |
| MWIRE-01 | Envelope + relay unchanged: `STREAM.MEDIA` round-trips raw under 1 MiB cap | — | unit | `node --test tests/protocol.test.js` (extend) | ⚠️ extend | ⬜ pending |
| MWIRE-01 | Identity staleness: mismatched `streamSessionId`/`snapshotId` rejected by `isCurrentStream` | — | unit (jsdom) | `node --test tests/renderer-media.test.js` | ❌ W0 | ⬜ pending |
| MEDIA-02 | Snapshot `media[]` baseline present, correct shape, NOT in `payload.html` | — | unit (jsdom) | `node --test tests/capture-media.test.js` | ❌ W0 | ⬜ pending |
| MEDIA-02 | `live = !isFinite(duration)`; `duration` omitted when non-finite (Infinity→null trap) | — | unit (jsdom) | `node --test tests/capture-media.test.js` | ❌ W0 | ⬜ pending |
| MEDIA-02/04 | Discrete events emit immediately; `timeupdate` throttled 250 ms only while playing | — | unit (jsdom, fake timers) | `node --test tests/capture-media.test.js` | ❌ W0 | ⬜ pending |
| MEDIA-04 | Mutation-added `<video>` AND `<audio>` get listeners (added-node coverage) | — | unit (jsdom) | `node --test tests/capture-media.test.js` | ❌ W0 | ⬜ pending |
| MEDIA-01 | `handleMedia` resolves nid, runs reconciler, calls driver (stub records play/pause/currentTime=) | — | unit (jsdom stub) | `node --test tests/renderer-media.test.js` | ❌ W0 | ⬜ pending |
| MEDIA-05 | Rejected `play()` → affordance shown + `onMediaBlocked(nid)`; mirror not wedged | — | unit (jsdom) | `node --test tests/renderer-media.test.js` | ❌ W0 | ⬜ pending |
| MEDIA-05 | `play()` returning `undefined` (jsdom) does not throw (`if (p !== undefined)` guard) | — | unit (jsdom) | `node --test tests/renderer-media.test.js` | ❌ W0 | ⬜ pending |
| MEDIA-05 | Driver defaults `muted = true` before first programmatic play | — | unit (jsdom) | `node --test tests/renderer-media.test.js` | ❌ W0 | ⬜ pending |
| MEDIA-05 | `mediaMode:'poster'` → no source bound / no `.play()`; poster shown; affordances absent | — | unit (jsdom) | `node --test tests/renderer-media.test.js` | ❌ W0 | ⬜ pending |
| MEDIA-01 | `media-src http: https: data:` in CSP_META; `default-src 'none'`/no `script-src` retained; no `blob:` | V14/CSP | unit (string) | `node --test tests/renderer-media-csp.test.js` | ❌ W0 | ⬜ pending |
| MEDIA-01 | `<video src>`/`poster`/`<source src>` to BLOCKED origin neutralized at STRING layer pre-parse | V12/SSRF | unit (string) | `node --test tests/renderer-media-csp.test.js` | ❌ W0 | ⬜ pending |
| (oracle) | Differential oracle green with `media-playback-sync` fixture + D27 ledger entry | — | integration | `node --test tests/differential/oracle.test.js` | ❌ W0 (if needed) | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/media-reconcile.test.js` — pure reconciler table tests (MWIRE-02 + MEDIA-03; the bulk of the phase's automated value)
- [ ] `tests/capture-media.test.js` — baseline shape, Infinity→null encoding, throttle/heartbeat, added-node listener coverage (MEDIA-02/04)
- [ ] `tests/renderer-media.test.js` — `handleMedia` dispatch, stubbed-element driver, play()-rejection affordance + `onMediaBlocked`, play()-undefined guard, mediaMode poster, staleness gate, old-viewer-ignores backward-compat (MEDIA-01/05, MWIRE-01)
- [ ] `tests/renderer-media-csp.test.js` (or extend `tests/renderer-asset-gate.test.js`) — `media-src` in CSP_META; `<video>/<source>/poster` string-layer gating pre-parse (MEDIA-01 + MSEC)
- [ ] `tests/protocol.test.js` — EXTEND: assert `STREAM.MEDIA` + `MEDIA_SYNC_THROTTLE_MS` exported (Phase 8/9 protocol-constant assertion precedent)
- [ ] `tests/differential/fixtures/media-playback-sync.html` + `tests/differential/scenarios/media-playback-sync.js` + D27 ledger entry — ONLY if the oracle would hard-fail (land entry + firing fixture together to avoid stale-entry failure)
- [ ] Framework install: none — `node:test` + jsdom already present.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Muted programmatic autoplay actually starts in an `allow-same-origin` srcdoc iframe | MEDIA-01/05 | jsdom does not implement real `play()`/autoplay policy | Real Chrome: load the two-tab/loopback demo with a muted `<video>`; confirm playback starts in the viewer without a gesture; confirm an unmuted source shows the unmute affordance (Open Question 1 — UAT-gated) |
| Rejected `play()` shows the click-to-play affordance and resumes on click | MEDIA-05 | autoplay rejection only occurs in a real browser | Real Chrome: block autoplay (unmuted, no gesture); confirm the affordance overlay appears and a click starts playback |
| Live stream `seekable.end(0)` no-throw + rejoin-edge | MWIRE-02 | jsdom `seekable.end` is lenient; real browsers throw `IndexSizeError` when empty | Real Chrome: an HLS-less live `<video>`; confirm the live-rejoin guard never throws and rejoins the edge on large drift |
| Real timeline drift converges under rate-nudge / hard-seek | MEDIA-03 | jsdom has no advancing media timeline | Real Chrome: induce drift; confirm small drift converges via rate-nudge and large drift hard-seeks |

*Real-browser media UAT is deferrable per project precedent (STATE.md Phase 12-03 / Phase 6) — record or explicitly defer.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (6 new/extended test files)
- [ ] No watch-mode flags
- [ ] Feedback latency < full-suite seconds
- [ ] `nyquist_compliant: true` set in frontmatter (after planner maps tasks)

**Approval:** pending
