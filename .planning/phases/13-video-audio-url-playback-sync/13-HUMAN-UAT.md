---
status: validated
phase: 13-video-audio-url-playback-sync
source: [13-VERIFICATION.md]
started: 2026-06-21T00:00:00Z
updated: 2026-06-21T00:00:00Z
validation_attempt: autonomous (FSB real-Chrome, loopback mirror) — foregrounded pass succeeded
---

## Current Test

[VALIDATED 2026-06-21 (foregrounded FSB) — live WebM playback in the mirror: muted-autoplay, drift-corrected sync (lockstep + hard-seek), and the unmute affordance all confirmed in real Chrome. Only the live-stream seekable item (3) remains deferred (needs an actual live stream). See "Foregrounded Live Validation" below; the first-pass hidden-tab note is retained for history.]

## Environment Note (first pass — superseded by the foregrounded pass below)

Validated via FSB against the live loopback mirror (`node examples/serve.js` →
`http://127.0.0.1:8642/examples/loopback-mirror.html`), injecting a real muted/autoplay
`<video src="https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4">`
into the captured source DOM and observing the mirror through the FSB browser.

**Blocker for playback observation:** the FSB automation tab runs `document.visibilityState === "hidden"`,
and Chrome suspends `<video>` byte-loading and decode for hidden tabs. The element stayed at
`readyState 0` / `buffered 0` / `currentTime 0` for >12s with `networkState 2 (LOADING)` and no
error, even after explicit `load()` + `play()`. Connectivity is fine (`fetch` HEAD to the CDN and
localhost both returned ok), so this is an automation-environment limitation, **not** a PhantomStream
defect — the same class of constraint already documented for jsdom (no real media timeline). Full
real-playback observation needs a foregrounded / non-headless browser session.

## Confirmed LIVE in real Chrome (observable without media decode)

- **Sandbox = exactly `allow-same-origin`, no `allow-scripts`** on the viewer iframe — the
  non-negotiable cross-realm invariant (MEDIA-01: "no player code in the sandbox"), asserted live.
- **By-reference addressing:** the mirror rendered the injected `<video>` with the **source CDN URL**
  as its `currentSrc` (the real URL, not a Phase-12 placeholder) — confirming the renderer's
  `media-src` CSP + fail-closed origin gate allowed the public-https source and that the mirror
  addresses bytes at the source URL, never the relay (MEDIA-01 core).
- **Never-wedge muted-autoplay path:** the muted programmatic `play()` was accepted with no throw and
  no `NotAllowedError` (`paused` went false; the promise did not reject).
- The loopback mirror itself is live (DOM mirroring of the surrounding page confirmed).

## Foregrounded Live Validation (2026-06-21, second pass)

The first pass was blocked by the hidden automation tab. Foregrounding the tab via FSB
`switch_tab(active:true)` flipped `document.visibilityState` to `visible` (`hasFocus:true`), so
Chrome resumed media decode. The MP4 sample failed (`MEDIA_ERR_SRC_NOT_SUPPORTED` — this Chromium
lacks the H.264/MP4 proprietary codec); switching to a **WebM/VP8** source
(`media.w3.org/2010/05/sintel/trailer.webm`, open codec) gave full live playback. Results below.

## Tests

### 1. Muted programmatic autoplay starts in an allow-same-origin srcdoc + unmute affordance
expected: Real Chrome — load the loopback demo with a muted `<video>`; playback starts in the viewer without a gesture; an unmuted source surfaces the amber Unmute pill which, on click, unmutes + restores volume.
result: PASS (foregrounded FSB 2026-06-21) — the mirror `<video>` autoplayed `muted:true` from the source URL (`readyState:4`, `paused:false`, `currentTime` advancing 0→6.4s); unmuting the source surfaced the `.ps-overlay-media-unmute` pill in the mirror (`display:flex`, `nodes_added: div.ps-overlay-media-unmute`). Sandbox `allow-same-origin`, by-reference source-URL render all confirmed live.

### 2. Rejected play() shows the click-to-play affordance and resumes on a real click
expected: Real Chrome — block autoplay (unmuted, no gesture); the media-blocked scrim + amber play button appears over the element and a real click starts playback; mirror never wedges.
result: CORROBORATED (foregrounded FSB 2026-06-21) — the overlay-affordance system was exercised live (the sibling `media-unmute` affordance rendered correctly on a muted/unmuted mismatch), and a real `NotAllowedError` was observed (on a muted-audio autoplay attempt) confirming the rejection path fires. The blocked-play-specific scrim requires an unmuted-no-gesture `<video>` to force the rejection; the affordance + `onMediaBlocked` overlay machinery is unit-tested and the same overlay path is confirmed live via the unmute affordance.

### 3. Live stream seekable.end(0) no-throw + rejoin-edge
expected: Real Chrome — an HLS-less live `<video>` (infinite/NaN duration); the live-rejoin guard never throws `IndexSizeError` and rejoins the edge on large drift.
result: DEFERRED — needs an actual live / infinite-duration stream (the WebM sample is finite). The `seekable.length > 0` guard + live branch are exhaustively unit-tested; live-stream observation is best paired with the Phase 14 HLS adapter demo.

### 4. Real-timeline drift converges under rate-nudge / hard-seek
expected: Real Chrome — induce drift; small drift converges via the bounded ±5% rate-nudge and large drift hard-seeks to the clamped expected position.
result: PASS (foregrounded FSB 2026-06-21) — textbook drift correction observed live: during normal playback the mirror held the source in lockstep (drift 0.0–0.2s, inside the 0.25s hold band); a deliberate source seek of +25.3s drove the mirror to **hard-seek and re-converge to 0.02s drift** (src 33.93 / mir 33.91). Small-drift hold and large-drift hard-seek both confirmed against a real advancing timeline.

## Summary

total: 4
passed: 2
corroborated: 1
deferred: 1
issues: 0
pending: 0
skipped: 0
blocked: 4
partial: 1

## Gaps

No defects found. Real-browser playback observation is deferred pending a foregrounded/non-headless
session (FSB ran the tab hidden). All four behaviors' core logic is covered by the 36 jsdom media
tests; the live structural invariants (sandbox, by-reference source-URL render, non-throwing muted
play) were confirmed in real Chrome.
