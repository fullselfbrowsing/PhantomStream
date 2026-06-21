---
status: partial
phase: 14-adaptive-streaming-adapter-discovery-fallback
source: [14-VERIFICATION.md]
started: 2026-06-21T00:00:00Z
updated: 2026-06-21T00:00:00Z
validation_note: deferred — environment cannot exercise MSE/adaptive (jsdom has no MSE; FSB automation runs tabs hidden, Chrome suspends media). Established in Phase 13.
---

## Current Test

[deferred — real-browser adaptive/MSE UAT requires a foregrounded/non-headless Chrome; not exercisable in jsdom or the hidden-tab FSB automation browser. Poster fallback is the never-break net.]

## Environment Note

All automated must-haves pass (4/4 ROADMAP success criteria + 7/7 invariants + 9/9 key links; suite 665/665; `package:smoke` exit 0 with hls.js absent; oracle 48/48). The four items below need a foregrounded real browser running MSE. This is the same class of limit documented in Phase 13: jsdom has no `MediaSource`, and the FSB automation browser runs its tab `visibilityState: "hidden"` so Chrome suspends `<video>` media — adaptive/MSE playback cannot be observed here. The cross-realm bind is implemented behind feature-detection with a single never-rethrowing `degrade()`→poster sink, so the mirror never breaks even if a browser refuses the cross-Document attach.

## Tests

### 1. Cross-Document object-URL MSE attach
expected: Foregrounded Chrome — a parent-realm `MediaSource` object URL set on the inert in-iframe `<video>` plays; if a browser refuses cross-Document attach, the player falls through to `degrade('mse-opaque')` → poster (never breaks).
result: DEFERRED (environment) — design is W3C-spec-feasible (origin-based, parent realm not Worker); `attach()` is try/catch-contained to the degrade sink. Run the foregrounded Playwright spike (STATE.md Phase 14 blocker) when a real browser is available.

### 2. Live-edge HLS sync (no absolute seek)
expected: Real Chrome — play a live `.m3u8`; playback rejoins the live edge; no absolute-time seek issued.
result: DEFERRED (environment) — reconciler `rejoin-edge` + `seekable.length>0` guard is unit-proven (tests/media-reconcile.test.js); live-edge timing observable only in a real player.

### 3. DRM/EME degrades to poster with reason 'drm'
expected: Real Chrome — an encrypted/EME source → poster + reason `drm`; content never decrypted/mirrored; mirror keeps updating.
result: DEFERRED (environment) — `degrade('drm')` routing (encrypted event + hls.js `KEY_SYSTEM_ERROR`) unit-proven; the live EME fire only occurs in a real browser.

### 4. Real CSP blob: enforcement + connect-src-not-needed
expected: Real Chrome — the `media-src blob:` plays the MSE object URL and the iframe issues NO segment fetches (parent fetches) → confirms no `connect-src` needed.
result: DEFERRED (environment) — CSP string contract (`blob:` in media-src, no `connect-src`/`script-src`) is unit-asserted; real enforcement + parent-fetch model observable only in Chrome.

## Summary

total: 4
passed: 0
issues: 0
pending: 0
skipped: 0
blocked: 4

## Gaps

No defects found. Real-browser adaptive/MSE UAT is deferred pending a foregrounded/non-headless session (jsdom has no MSE; FSB runs tabs hidden). All four behaviors' core logic is unit-proven; the poster fallback is the never-break net. WARN-01 (mvp goal not in User-Story format) accepted as-is — the 4 technical success criteria are the verified goal contract for this library phase (no code change).
