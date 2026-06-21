---
phase: 14
slug: adaptive-streaming-adapter-discovery-fallback
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-06-21
---

# Phase 14 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Derived from 14-RESEARCH.md `## Validation Architecture`. Task IDs assigned by the planner.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Node built-in `node:test` + `node:assert/strict`; jsdom ^29 for renderer/DOM |
| **Config file** | none — `package.json` `scripts.test` |
| **Quick run command** | `node --test tests/renderer-media-player.test.js tests/renderer-media-csp.test.js tests/media-hint-filter.test.js` |
| **Full suite command** | `npm test` (baseline 588/588; differential oracle 48/48 — no new entry expected) |
| **Estimated runtime** | quick sub-30s; full suite seconds |

---

## Sampling Rate

- **After every task commit:** quick run (player/csp/hint-filter + the touched adapter/protocol file).
- **After every plan wave:** `npm test` (full suite incl. differential oracle).
- **Before `/gsd:verify-work`:** full suite green (≥588 baseline + new); oracle stays 48/48; `npm run package:smoke` green with hls.js absent.
- **Max feedback latency:** quick < 30s; full suite seconds.

---

## Per-Task Verification Map

> Requirement-level until the planner assigns task IDs. Threat refs from 14-RESEARCH Security Domain (parent-realm object-URL / SSRF via manifest+segment / CSP `blob:`).

| Requirement | Behavior | Test Type | Automated Command | File | Status |
|-------------|----------|-----------|-------------------|------|--------|
| MADPT-01 | native-HLS branch: `canPlayType`'maybe' → child `videoEl.src=manifest`, no MSE | unit (jsdom stub) | `node --test tests/renderer-media-player.test.js` | ❌ W0 | ⬜ pending |
| MADPT-01 | MSE via host `playerFactory`: `attach(el,url,ctx)` called; `destroy()` on teardown | unit (fake factory) | same | ❌ W0 | ⬜ pending |
| MADPT-01 | lazy hls.js: ABSENT → `degrade('no-player')`; STUB Hls+MediaSource → `attachMedia(el)` called | unit (stub import/globals) | same | ❌ W0 | ⬜ pending |
| MADPT-01 | zero-hard-dep: `import('./renderer')` succeeds with hls.js uninstalled | smoke | `npm run package:smoke` | ⚠️ assert | ⬜ pending |
| MADPT-02 | `.m3u8`/`.mpd` filter by extension AND content-type (apple.mpegurl/dash+xml/x-mpegURL) | unit (pure fn) | `node --test tests/media-hint-filter.test.js` | ❌ W0 | ⬜ pending |
| MADPT-02 | Playwright `page.on('response')` → `STREAM.MEDIA_HINT` emitted (mock page) | unit (mock page) | `node --test tests/playwright-adapter.test.js` | ⚠️ extend | ⬜ pending |
| MADPT-02 | Extension `chrome.webRequest.onCompleted` → hint emitted (fake chrome) | unit (fake chrome) | `node --test tests/extension-adapter.test.js` | ⚠️ extend | ⬜ pending |
| MADPT-02 | correlation: single-active → element scope; ambiguous → page scope; viewer matches on play | unit | `node --test tests/renderer-media-player.test.js` | ❌ W0 | ⬜ pending |
| MADPT-02 | graceful absence: no adapter/hints → progressive path intact, zero errors | unit | `node --test tests/renderer-media.test.js` | ⚠️ extend | ⬜ pending |
| MADPT-02 | `STREAM.MEDIA_HINT` round-trips raw under 1 MiB cap; old viewers ignore (dispatch default) | unit | `node --test tests/protocol.test.js tests/renderer-media.test.js` | ⚠️ extend | ⬜ pending |
| MADPT-03 | each reason (no-manifest/no-player/mse-opaque/drm) → `onMediaUnavailable(nid,reason)` + overlay | unit | `node --test tests/renderer-media-player.test.js` | ❌ W0 | ⬜ pending |
| MADPT-03 | DRM: `encrypted` event → `degrade('drm')`; hls.js `KEY_SYSTEM_ERROR` → `drm` | unit (fake event) | same | ❌ W0 | ⬜ pending |
| MADPT-03 | degrade keeps poster if present, else Phase-12 placeholder; element never broken/empty | unit | same | ❌ W0 | ⬜ pending |
| MADPT-03 | `media-unavailable` overlay: passive, `textContent` only, null hides; no payload innerHTML | unit (overlay) | `node --test tests/renderer-media.test.js` | ⚠️ extend | ⬜ pending |
| MADPT-03 | throwing `onMediaUnavailable` hook contained (logger), never wedges | unit | `node --test tests/renderer-media-player.test.js` | ❌ W0 | ⬜ pending |
| MADPT-04 | live manifest: reconciler `rejoin-edge` + `seekable.length>0` → live-edge; NO absolute seek | unit (reuse reconciler) | `node --test tests/media-reconcile.test.js tests/renderer-media.test.js` | ⚠️ assert reuse | ⬜ pending |
| MADPT-01/Sec | CSP `media-src … blob:` present; `default-src 'none'`; NO `script-src`/`connect-src`; sandbox exactly `allow-same-origin` | unit (string) | `node --test tests/renderer-media-csp.test.js` | ⚠️ extend | ⬜ pending |
| (also wire) | Phase-13 State-C `media-poster` caption is SHOWN in poster mode with no surviving poster (close UI-review dead-code gap) | unit (jsdom) | `node --test tests/renderer-media.test.js` | ⚠️ extend | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/renderer-media-player.test.js` — MADPT-01 (native/factory/lazy-hls/degrade), MADPT-02 (correlation), MADPT-03 (reasons/DRM/poster/contained-hook). NEW.
- [ ] `tests/media-hint-filter.test.js` — MADPT-02 manifest filter (extension + content-type). NEW (may fold into the player test file).
- [ ] Extend `tests/playwright-adapter.test.js` + `tests/extension-adapter.test.js` — manifest observation → `STREAM.MEDIA_HINT` (mock page / fake chrome).
- [ ] Extend `tests/protocol.test.js` — `STREAM.MEDIA_HINT` collision-free + raw round-trip + 1 MiB cap + `MediaHintPayload` present.
- [ ] Extend `tests/renderer-media.test.js` — `STREAM.MEDIA_HINT` dispatch + `media-unavailable` overlay + graceful-absence + old-viewer-ignores + State-C poster caption wire.
- [ ] Extend `tests/renderer-media-csp.test.js` — `blob:` in `media-src`; no `script-src`/`connect-src`; sandbox token unchanged.
- [ ] Assert in `scripts/package-smoke.mjs` (or a unit test): `./renderer` imports cleanly with hls.js absent (zero-hard-dep).
- [ ] Framework install: none — `node:test` + jsdom + playwright already present; hls.js stays optional/uninstalled.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Cross-Document object-URL MSE attach works (parent `MediaSource` blob bound to in-iframe `<video>`, hls.js `attachMedia(iframeEl)` from parent) | MADPT-01 | Real MSE only runs in a foregrounded browser (jsdom has no MSE; FSB runs tabs hidden → media suspended) | Foregrounded Playwright spike (run FIRST per STATE.md blocker): bind a parent MediaSource to an in-iframe video; confirm playback. If any browser refuses → `srcObject`+handle or native path; `degrade('mse-opaque')` is the net |
| Live-edge sync on a real HLS live stream (no absolute seek) | MADPT-04 | needs a real live manifest playing | Real Chrome: play a live `.m3u8`; confirm rejoin-edge, no absolute seek |
| DRM/EME content degrades to poster with reason `drm` (observed) | MADPT-03 | EME only fires in a real browser | Real Chrome: an encrypted source → poster + `drm` reason, mirror not broken |
| Real CSP `blob:` enforcement + connect-src-not-needed confirmation | MADPT-01/Sec | jsdom does not enforce CSP | Real Chrome: confirm the blob plays and the iframe issues no segment fetches (parent fetches) |

*Real-browser adaptive UAT is deferrable per the Phase 13 / Phase 12-03 precedent (hidden-tab media suspension). Run the foregrounded A1/A5 MSE spike early in execution; record or explicitly defer.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] `npm run package:smoke` green with hls.js absent (zero-hard-dep)
- [ ] `nyquist_compliant: true` set in frontmatter (after planner maps tasks)

**Approval:** pending
