---
status: partial
phase: 13-video-audio-url-playback-sync
source: [13-VERIFICATION.md]
started: 2026-06-21T00:00:00Z
updated: 2026-06-21T00:00:00Z
validation_attempt: autonomous (FSB real-Chrome, loopback mirror)
---

## Current Test

[autonomous FSB validation attempted 2026-06-21 — structural invariants confirmed live; frame-advancing playback blocked by the automation browser's hidden-tab media suspension]

## Environment Note (autonomous validation)

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

## Tests

### 1. Muted programmatic autoplay starts in an allow-same-origin srcdoc + unmute affordance
expected: Real Chrome — load the loopback demo with a muted `<video>`; playback starts in the viewer without a gesture; an unmuted source surfaces the amber Unmute pill which, on click, unmutes + restores volume.
result: PARTIAL — sandbox `allow-same-origin`, by-reference source-URL render, and a non-throwing muted `play()` all confirmed live; frame-advancing playback + the unmute pill could not be observed (hidden-tab media suspension). Core logic covered by jsdom media tests.

### 2. Rejected play() shows the click-to-play affordance and resumes on a real click
expected: Real Chrome — block autoplay (unmuted, no gesture); the media-blocked scrim + amber play button appears over the element and a real click starts playback; mirror never wedges.
result: BLOCKED (environment) — a real `NotAllowedError` requires a foregrounded tab attempting unmuted autoplay; the hidden automation tab suspends media so the rejection path could not be exercised. Affordance + `onMediaBlocked` callback covered by jsdom tests.

### 3. Live stream seekable.end(0) no-throw + rejoin-edge
expected: Real Chrome — an HLS-less live `<video>` (infinite/NaN duration); the live-rejoin guard never throws `IndexSizeError` and rejoins the edge on large drift.
result: BLOCKED (environment) — needs a live/infinite-duration source playing in a visible tab; not reproducible under hidden-tab suspension. `seekable.length > 0` guard + live branch covered by jsdom tests.

### 4. Real-timeline drift converges under rate-nudge / hard-seek
expected: Real Chrome — induce drift; small drift converges via the bounded ±5% rate-nudge and large drift hard-seeks to the clamped expected position.
result: BLOCKED (environment) — requires an advancing media timeline (hidden tab never advances `currentTime`). The reconciler decision tree is exhaustively unit-tested (33 table tests incl. a 6561-case hostile sweep).

## Summary

total: 4
passed: 0
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
