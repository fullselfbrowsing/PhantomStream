---
status: partial
phase: 13-video-audio-url-playback-sync
source: [13-VERIFICATION.md]
started: 2026-06-21T00:00:00Z
updated: 2026-06-21T00:00:00Z
---

## Current Test

[awaiting human testing — real Chrome required; jsdom cannot exercise real media playback]

## Tests

### 1. Muted programmatic autoplay starts in an allow-same-origin srcdoc + unmute affordance
expected: Real Chrome — load the two-tab/loopback demo with a muted `<video>`; playback starts in the viewer without a gesture; an unmuted source surfaces the amber Unmute pill which, on click, unmutes + restores volume.
result: [pending]

### 2. Rejected play() shows the click-to-play affordance and resumes on a real click
expected: Real Chrome — block autoplay (unmuted, no gesture); the media-blocked scrim + amber play button appears over the element and a real click starts playback; mirror never wedges.
result: [pending]

### 3. Live stream seekable.end(0) no-throw + rejoin-edge
expected: Real Chrome — an HLS-less live `<video>` (infinite/NaN duration); the live-rejoin guard never throws `IndexSizeError` and rejoins the edge on large drift.
result: [pending]

### 4. Real-timeline drift converges under rate-nudge / hard-seek
expected: Real Chrome — induce drift; small drift converges via the bounded ±5% rate-nudge and large drift hard-seeks to the clamped expected position.
result: [pending]

## Summary

total: 4
passed: 0
issues: 0
pending: 4
skipped: 0
blocked: 0

## Gaps
