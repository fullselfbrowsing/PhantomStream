# Requirements: PhantomStream — Milestone v2.0 (Asset & Media Streaming)

**Defined:** 2026-06-19
**Core Value:** A live, trustworthy, low-bandwidth, *semantically addressable* mirror of a real browser tab — capture → relay → render → remote-control must work end-to-end as a standalone framework.

> Milestone v1.0 (Phases 1–11: standalone framework, npm publish `@full-self-browsing/phantom-stream@0.1.0`, FSB swap-in) is shipped. Its requirements are recorded in `MILESTONES.md` and `PROJECT.md` → Validated. This file scopes **milestone v2.0 — Asset & Media Streaming**.

## Milestone Thesis

Mirror media **by reference, not by value**: stream asset and media **URLs** (plus small playback-state messages), and let the viewer fetch the bytes from the original CDN/source over its own network. The relay still carries only text + URLs — the low-bandwidth core value is preserved. Research (`.planning/research/v2.0-media/`) confirmed the by-reference asset pipeline is already ~80–90% shipped, so v2.0 concentrates on **playback sync**, **adaptive playback**, and a **new viewer-side-fetch security surface**.

## v2.0 Requirements

Each maps to exactly one roadmap phase.

### Static Assets by Reference (ASST)

- [x] **ASST-01**: Image assets (`<img>`, `srcset`, `<picture>`, `<source>`, SVG `<image>`) are mirrored by reference and render in the viewer by loading the original absolute source URL — no image bytes traverse the relay
- [x] **ASST-02**: CSS `background-image` and `<video>` poster URLs resolve to absolute source URLs on the wire and render in the viewer
- [x] **ASST-03**: The displayed image variant is pinned via `currentSrc` so the cross-origin viewer (different DPR/viewport) loads the same asset the origin showed, not a re-negotiated one
- [x] **ASST-04**: Non-shareable references (`blob:`/origin-local object URLs; oversized `data:` URIs) are detected and degrade to a dimensioned placeholder, never a broken reference
- [x] **ASST-05**: The viewer CSP is opened precisely enough to fetch referenced assets (scoped `media-src`/`img-src`) while keeping `default-src 'none'` and no `script-src`

### Time-Based Media + Playback Sync (MEDIA)

- [x] **MEDIA-01**: Progressive/direct `<video>` (mp4/webm) plays in the viewer, loading bytes from the source URL — never through the relay
- [x] **MEDIA-02**: Initial media state (currentTime, paused, muted, volume, playbackRate, loop, duration) is captured in the snapshot as the baseline for deltas
- [x] **MEDIA-03**: Playback changes (play/pause, seek, ratechange) stream over the throttled media-sync channel and are applied in the viewer with drift-corrected interpolation — hard-seek only on large drift, never per-message
- [x] **MEDIA-04**: `<audio>` elements are mirrored by the same URL + playback-state model as video
- [x] **MEDIA-05**: The viewer honors autoplay policy (muted-autoplay default; observable affordance when `play()` is rejected) — the mirror never wedges on a blocked play

### Media Protocol & Sync Contract (MWIRE)

- [x] **MWIRE-01**: A `STREAM.MEDIA` throttled side-channel op carries nid-addressed playback state, envelope-backward-compatible (old viewers ignore the unknown type), within the raw-relay + 1 MiB-cap contract — relay and envelope are untouched
- [x] **MWIRE-02**: The drift reconciler is a pure, configurable, jsdom-unit-testable function (sync logic verified without a real media timeline)

### Adaptive Streaming + Fallback (MADPT)

- [ ] **MADPT-01**: Best-effort adaptive playback — when an HLS (`.m3u8`) or DASH (`.mpd`) manifest URL is available, the viewer plays it via an optional, lazy player running in a renderer-owned, **parent-realm** surface (never inside the mirror sandbox); only `hls.js` is added (optional, lazy), DASH via a host-provided-player seam
- [ ] **MADPT-02**: The Playwright/CDP and extension adapters can surface manifest URLs not present as a plain element `src` (network observation), fed to the viewer as opt-in hints with graceful absence
- [ ] **MADPT-03**: Media that cannot be referenced (MSE/`blob:` without a discoverable manifest, DRM/EME) degrades to poster/placeholder with an observable, documented reason — the mirror never breaks
- [ ] **MADPT-04**: Live streams (infinite/NaN duration) are handled — live-edge sync, no absolute seek

### Media Security & Privacy (MSEC)

- [x] **MSEC-01**: A fail-closed host origin/scheme policy hook governs which asset/media URLs the viewer may fetch (conservative default: https-only, block private/internal ranges) — mitigates viewer-side SSRF, tracking-pixel/live-viewer confirmation, and DoS amplification
- [x] **MSEC-02**: A `mediaMode` switch (`off` | `poster` | `reference`) lets hosts choose the privacy/bandwidth posture; the default is documented
- [ ] **MSEC-03**: Asset/media URL masking — the host masking vocabulary redacts/blocks asset+media URLs (signed CDN URLs carry tokens/PII) and `maskMediaSelector`/`blockSelector` omit private media URLs from the wire; masked media degrades to placeholder
- [ ] **MSEC-04**: Viewer-side fetch minimizes leakage (`referrerpolicy="no-referrer"`, no credentials by default); secrets-on-the-wire implications are documented; the sandbox token is unchanged (the `allow-scripts`-forbidden static scan covers media code paths)

## Future Requirements

Deferred to later milestones. Tracked but not in the v2.0 roadmap.

### Milestone v2.1 — Evaluation & Research Paper

- **EVAL-01**: Frozen, replayable site corpus (HAR record/replay) with scripted activity levels (idle, reading, agent-driven automation)
- **EVAL-02**: Bandwidth and latency measured for PhantomStream vs WebRTC screen capture, CDP screencast, and rrweb live mode under identical corpus conditions with a documented baseline-config protocol
- **EVAL-03**: Style-capture strategy ablation: full enumeration vs curated inlining vs stylesheet-centric, on payload size, serialize latency, and fidelity
- **EVAL-04**: Fidelity scoring combines pixel metrics (pixelmatch/SSIM) with a DOM-level semantic-fidelity metric, plus a failure taxonomy
- **EVAL-05**: The harness runs as the framework's performance regression suite (repeatable locally/CI)
- **EVAL-06** (new): A media-by-reference evaluation arm — bandwidth/latency/fidelity of URL-reference media vs CDP screencast/WebRTC pixel capture (feeds the v2.0 story into the paper)
- **PAPR-01**: Full system-track paper draft (abstract through discussion: design rationale, production reliability, evaluation results) ready for submission to a WWW/UIST/CHI-tier venue
- **PAPR-02**: Related-work treatment grounded in primary sources (rrweb internals, co-browsing systems, CDP screencast, agent-observability viewers)

### Fidelity & Channels

- **FID2-01**: Cursor-position channel + viewer cursor rendering (co-browsing UX)
- **FID2-02**: Periodic budgeted canvas refresh (opt-in)
- **FID2-03**: Caret/selection mirroring in form fields

### Ecosystem

- **ECO2-01**: rrweb-format export bridge (emit rrweb-compatible events for replay-storage interop)
- **ECO2-02**: Telemetry surface hardening from FSB production feedback (watchdog rescue rates, health dashboards)
- **ECO2-03**: Multi-viewer scale-out patterns documentation

## Out of Scope

Explicitly excluded for v2.0. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| WebRTC / pixel media relay; re-encoding/transcoding media | Destroys the low-bandwidth core value (1080p30 WebRTC ≈ 14 Mbps, ~100–1000× a DOM-diff mirror); v2.0 mirrors media by URL reference instead |
| `<canvas>`/WebGL pixel-frame streaming; Web Audio / `getUserMedia` capture | Drags in a media/raster pipeline and expands the privacy surface; conflicts with the bandwidth and sandbox posture |
| DRM/EME content mirroring | Encrypted media is unshareable by design; degrade to poster |
| MSE/`blob:` media with no discoverable manifest | Origin-local object URLs are dead at the viewer; best-effort manifest discovery else poster |
| Media-byte inlining (`data:` for video/audio) | Reintroduces byte transport and blows the size budget; reference-only (a byte-capped *image* inline is the only v2.x escape hatch worth considering) |
| Frame-accurate sync guarantees | Drift-corrected best-effort sync is the contract; exact frame lockstep is not achievable or needed by reference |
| Running any media player inside the mirror iframe | Would require `allow-scripts` — a catastrophic XSS regression; adaptive players run in the parent realm |
| Replay storage + timeline player | rrweb's home turf; protocol JSON is persistable by hosts if needed |
| Multi-writer CRDT collaboration | Single-writer authoritative tab = no merge problem |
| Cross-origin iframe content mirroring | Browser security boundary; labeled placeholders instead |
| Mobile / non-Chromium-first support | Targets Chromium contexts (MV3, CDP); portability later |
| FSB feature work in this repo | FSB only consumes the package; its code stays in the FSB repo |

## Traceability

Which phases cover which requirements. Finalized during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| ASST-01 | Phase 12 | Complete |
| ASST-02 | Phase 12 | Complete |
| ASST-03 | Phase 12 | Complete |
| ASST-04 | Phase 12 | Complete |
| ASST-05 | Phase 12 | Complete |
| MSEC-01 | Phase 12 | Complete |
| MSEC-02 | Phase 12 | Complete |
| MEDIA-01 | Phase 13 | Complete |
| MEDIA-02 | Phase 13 | Complete |
| MEDIA-03 | Phase 13 | Complete |
| MEDIA-04 | Phase 13 | Complete |
| MEDIA-05 | Phase 13 | Complete |
| MWIRE-01 | Phase 13 | Complete |
| MWIRE-02 | Phase 13 | Complete |
| MADPT-01 | Phase 14 | Pending |
| MADPT-02 | Phase 14 | Pending |
| MADPT-03 | Phase 14 | Pending |
| MADPT-04 | Phase 14 | Pending |
| MSEC-03 | Phase 15 | Pending |
| MSEC-04 | Phase 15 | Pending |

**Coverage:**
- v2.0 requirements: 20 total
- Mapped to phases: 20 (validated by roadmapper — each requirement maps to exactly one phase, no orphans, no duplicates)
- Unmapped: 0

---
*Requirements defined: 2026-06-19 (milestone v2.0 — Asset & Media Streaming)*
*v1.0 requirements archived in MILESTONES.md and PROJECT.md → Validated*
