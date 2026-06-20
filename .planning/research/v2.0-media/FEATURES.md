# Feature Research

**Domain:** Media/asset mirroring for DOM-native browser mirroring (PhantomStream v2.0 — media-by-reference)
**Researched:** 2026-06-19
**Confidence:** HIGH (rrweb behavior cited from primary source: `packages/types`, `packages/rrweb/src/record/observer.ts`, `packages/rrweb-snapshot/src/snapshot.ts`, `packages/rrweb/src/replay/media/index.ts`, `guide.md`. Co-browsing/CDP/autoplay from vendor docs + MDN, MEDIUM where vendor-only.)

> **Scope reminder.** This milestone reverses PROJECT.md's current "Out of Scope" line — `<video>`/`<audio>` content mirroring (poster/placeholder only). v2.0 mirrors **media and assets by reference (URL/CDN)**: the wire carries text + URLs + small playback-state messages; the **viewer fetches bytes from the original source/CDN**. The existing system already does the hard prerequisite work — URL absolutification for `src`/`poster`/`srcset`/`xlink:href` and CSS `url()` (`docs/ARCHITECTURE.md` §2.2), and `<canvas>` → data-URL `<img>`. So image-by-URL is *already partly shipped*; v2.0 is mostly **media playback-state sync** plus formalizing/hardening the reference model.

---

## The Central Insight: rrweb Already Validates Media-by-URL

The single most important grounding fact for the requirements author:

**rrweb's DEFAULT is media-by-reference, not inlining.** From `guide.md` (primary source), the record defaults are:

| Option | Default | Meaning |
|--------|---------|---------|
| `inlineImages` | `false` | Images are **NOT** base64-inlined by default. `<img src>` is kept as an absolutified URL; the replayer re-fetches from origin/CDN. (Deprecated since 2.0.0 in favor of `captureAssets`.) |
| `inlineStylesheet` | `true` | Stylesheets inlined (text is cheap, avoids CORS read-blocking). |
| `recordCanvas` | `false` | Canvas frames **NOT** recorded by default. |
| `collectFonts` | `false` | Fonts **NOT** collected by default. |

So the entire session-replay industry's default model for `<img>` is exactly PhantomStream's v2.0 thesis: **transport the URL, let the viewer fetch the pixels.** This is not a novel bet — it is the proven baseline. PhantomStream's job is to (a) match that baseline for images (largely done), and (b) extend the same reference model to `<video>`/`<audio>` playback, which is where rrweb stops short.

**What rrweb deliberately does NOT do for media** (primary + corroborated): it records `<video>`/`<audio>` *elements and their interaction state* but **not the decoded frames or audio samples** — playback content is never captured. It records `<canvas>` elements but **not the draw operations** unless `recordCanvas` is on (and even then it ships rasterized frames or, via a plugin, a WebRTC pixel stream). This is the line PhantomStream stays on the correct side of: **structured state + URLs, never decoded pixels/samples.**

---

## How rrweb Handles Media (Primary-Source Detail)

### Images (`<img>`, srcset, `<picture>`, background-image)
From `packages/rrweb-snapshot/src/snapshot.ts` (`transformAttribute` / `serializeNode`):
- `src` and `href` are **absolutified** to full URLs against the document (`absoluteToDoc`).
- `srcset` is absolutified per-candidate via `getAbsoluteSrcsetString()` — so `<picture>`/`<source>` responsive sets survive as URLs; the **viewer's own viewport/DPR then picks the candidate**, which can differ from the captured tab.
- CSS `url()` (including `background-image`) in inline `<style>` text is absolutified via `absolutifyURLs()`.
- When `inlineImages: true` (opt-in), an image is drawn to a canvas and `toDataURL()`'d into an `rr_dataURL` attribute; on CORS failure it retries with `crossOrigin='anonymous'`. This is the *fallback* for when re-fetch won't work — not the default.

### Video / Audio
Two complementary mechanisms (this is the model PhantomStream should mirror):

**1. Initial state — captured in the snapshot as `rr_media*` attributes** (`snapshot.ts`):
```
rr_mediaState          // 'paused' | 'played'
rr_mediaCurrentTime    // currentTime at snapshot
rr_mediaPlaybackRate
rr_mediaMuted
rr_mediaLoop
rr_mediaVolume
```
(`src` and `poster` are absolutified like any URL attribute.)

**2. Ongoing changes — `IncrementalSource.MediaInteraction` events** (`packages/rrweb/src/record/observer.ts`, `initMediaInteractionObserver`). It listens for **exactly five DOM events** and nothing else:
```
play  →  MediaInteractions.Play
pause →  MediaInteractions.Pause
seeked →  MediaInteractions.Seeked
volumechange → MediaInteractions.VolumeChange
ratechange   → MediaInteractions.RateChange
```
On each, it reads `{ currentTime, volume, muted, playbackRate, loop }` off the element, throttled by `sampling.media` (**default 500ms**). The wire type (`packages/types`):
```ts
export enum MediaInteractions { Play, Pause, Seeked, VolumeChange, RateChange }
export type mediaInteractionParam = {
  type: MediaInteractions; id: number;
  currentTime?: number; volume?: number; muted?: boolean;
  loop?: boolean; playbackRate?: number;
};
```
**Crucially: there is NO continuous time-sync source.** `IncrementalSource` has `MediaInteraction` (value 7) and no separate streaming `Media` source. `currentTime` is captured *only when one of the five events fires* — never polled. The recorder is purely reactive; it sends event-anchored snapshots of `currentTime`, not a clock.

**Replay-side drift correction (`packages/rrweb/src/replay/media/index.ts`, `MediaManager`):** because the recording is event-anchored, the replayer *interpolates*. On each sync it computes:
```
mediaPlaybackOffset = (now - timestampOfLastMediaInteraction)/1000 * playbackRate
seekToTime          = currentTimeAtLastInteraction + mediaPlaybackOffset
// looped media: seekToTime = seekToTime % duration
```
and re-applies `currentTime`, `playbackRate`, `volume`, `muted`, `loop`, accounting for replayer speed. **So "drift-corrected playback sync" is not a moonshot differentiator — rrweb does it, and it is the correct table-stakes way to turn 5 sparse events into smooth viewer playback.** PhantomStream needs the same offset-from-last-event math; getting it *wrong* (naive "set currentTime once") is the actual risk.

### Canvas
- `recordCanvas: false` default. When on, `sampling.canvas` caps FPS (recipe shows `canvas: 15`) and `dataURLOptions` picks format/quality (`image/webp`, `quality: 0.6`) — i.e. it ships **rasterized frames**, a pixel path. A separate `rrweb-plugin-canvas-webrtc-record/replay` plugin streams canvas via **WebRTC** and warns it "opts out of rrweb's sandbox protection" (`UNSAFE_replayCanvas`).
- PhantomStream already converts `<canvas>` → static data-URL `<img>` at snapshot (`docs/ARCHITECTURE.md`). **Live canvas frame streaming is explicitly an anti-feature here** (pixel path, sandbox-breaking) — same conclusion rrweb's own plugin author reaches.

### Asset Capture API (rrweb 2.0+) — the "inline by URL" generalization
`EventType.Asset` (value 7) is a top-level event. `assetParam` (`packages/types`):
```ts
type assetParam =
  | { url: string; payload: SerializedCanvasArg | SerializedCssTextArg; timestamp?: number }
  | { url: string; failed: { status?: number; message: string } };
```
rrweb captures an asset **asynchronously, keyed by URL**, then rebroadcasts its serialized bytes as a separate event (with explicit `failed` status). `inlineImages` is now an alias into this. The config gained `origins`/`objectURLs` controls (to capture `blob:`/object URLs by serializing their bytes). **This is the boundary PhantomStream must NOT cross for media:** serializing media bytes (even by URL) re-introduces the bandwidth cost the core value forbids. PhantomStream sends the *reference and lets the viewer fetch*; it does not become an asset proxy. The `{ url, failed }` shape, however, is a good pattern to copy for "viewer couldn't fetch this media" telemetry.

---

## How Co-Browsing / Live-Mirror Tools Handle Media

Two architectures, and PhantomStream is firmly in the first camp.

| Tool | Architecture | Media handling | Bandwidth |
|------|--------------|----------------|-----------|
| **Surfly** | DOM-rewriting proxy; rebuilds HTML/CSS/JS, sends DOM changes; rendered locally per participant | Media re-served through the proxy to each viewer (content, not pixels) — same reference idea, proxied | Low (DOM deltas) |
| **rrweb (live mode)** | DOM snapshot + incremental events | Media-by-URL + `MediaInteraction` (as above); no frames | Low |
| **Hyperbeam** | Server-hosted Chromium, **WebRTC pixel stream** of audio+video | True pixels — plays *anything* incl. DRM, but it's a video stream | **720p@24fps = 5 Mbps; 1080p@30fps = 14.1 Mbps; "sharp mode" triples it** |
| **CDP `Page.startScreencast`** (browserless etc.) | Chromium emits base64 JPEG/PNG frames, ack'd per-frame | Pixels; plays anything visually but not real `<video>` element state | **~50–100 KB/frame JPEG@q80 @720p**; e.g. 5 fps ≈ 0.25–0.5 MB/s (2–4 Mbps); Chromium-only |

**Why pixel approaches exist:** they are content-agnostic — DRM/EME video, WebGL, `<canvas>`, plugins, and `blob:`-sourced MSE streams all "just work" because you capture the composited output, not the DOM. The cost is bandwidth that scales with screen size × framerate × motion (a playing video pins it near the max), no semantic addressing, and no real interactivity in the stream. **PhantomStream's entire reason to exist is to avoid that bandwidth curve.** The numbers above are the justification to cite whenever someone proposes a pixel fallback for "hard" media: a *single 1080p30 video* over WebRTC (14 Mbps) is ~100–1000× a DOM-diff mirror's steady-state, and re-encoding/relaying it server-side is strictly worse.

---

## Feature Landscape

### Table Stakes (Users Expect These)

Users coming from rrweb/session-replay/co-browsing will assume these. Missing them = "the media is broken in the mirror."

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **Image-by-URL** (`<img src>` absolutified, viewer re-fetches) | rrweb's *default*; the baseline everyone ships | LOW | **Already done** — `serializeDOM` absolutifies `src` (`docs/ARCHITECTURE.md` §2.2). v2.0 only needs to *document* it as a media feature + confirm `attr` diffs on `src` flow. |
| **`srcset` / `<picture>` / `<source>` by URL** | Responsive images are ubiquitous; broken on naive capture | LOW | Already absolutified. Caveat: viewer picks candidate by *its* viewport/DPR, may differ from source tab — acceptable, document it. |
| **`background-image` / CSS `url()` by URL** | Hero images, icons via CSS are everywhere | LOW | Already absolutified in inline `<style>`. Confirm parity in CSSOM mode (`styleSources[]`). |
| **`poster` frame for video** | First thing a viewer sees before play; cheap | LOW | `poster` already absolutified. Make poster the **canonical fallback** when media can't load (see MSE/DRM below). |
| **Initial media state in snapshot** | Mirror must open showing paused/playing, current position, muted | MEDIUM | Mirror rrweb's `rr_media*` attrs: capture `currentTime/paused/muted/volume/playbackRate/loop` at snapshot. New capture work. |
| **Play / pause sync** | The defining "is this mirroring the video?" test | MEDIUM | Listen for `play`/`pause`, send small state msg by nid. Map to existing diff/side-channel transport. |
| **Seek sync (`seeked`)** | User scrubs; mirror must jump | MEDIUM | rrweb sends `currentTime` on `seeked` only (post-seek). Same here. |
| **Volume / mute / playbackRate sync** | Expected once play/pause works; trivial extra fields | LOW | Piggyback on the media-state message (`volumechange`, `ratechange`). |
| **`currentTime` / position mirroring with drift correction** | Without it, viewer playback desyncs within seconds | MEDIUM–HIGH | **This is table stakes done *right*, not a differentiator.** Must use rrweb's offset-from-last-event interpolation (`MediaManager.seekTo`), not a one-shot set. Throttle continuous updates like `sampling.media` (≈500ms) to stay low-bandwidth. |
| **Direct/progressive media URL playback** (`.mp4`/`.webm`/`.mp3`/`.ogg` via `<video src>`/`<source>`) | The "in scope" media per milestone; works because viewer fetches the real file | LOW–MEDIUM | Viewer's native element fetches from CDN. No transcode. The straightforward in-scope path. |
| **Muted/autoplay correctness in the viewer** | Browsers **block programmatic `play()` without a user gesture**; muted autoplay is always allowed | MEDIUM | **Critical viewer constraint.** Replaying a `play` state via `el.play()` rejects with `NotAllowedError` unless muted or user-gestured; the **sandboxed iframe also needs `allow="autoplay"`**. Plan: reflect `muted`, attempt `play()`, catch rejection, show a "click to play / tap to unmute" affordance. |
| **Looped media handling** | `loop` videos/GIF-likes shouldn't freeze or desync | LOW–MEDIUM | Mirror `loop`; in drift math use `currentTime % duration` (rrweb does this). |
| **Animated GIF / animated WebP / APNG** | Treated as images, must keep animating | LOW | These are `<img>` — re-fetched by URL, the *browser animates them natively*. **Free** once image-by-URL works. (Contrast: rrweb `inlineImages` would freeze a GIF to one frame — the URL path is strictly better here.) |
| **Graceful fallback when media can't load** | Cross-origin/expired/blob URLs *will* fail to fetch | MEDIUM | Show poster, then a placeholder of correct dimensions (session-replay norm: "empty/gray box of similar size"). Never break layout. |

### Differentiators (Competitive Advantage)

Where PhantomStream can exceed rrweb/session-replay norms while staying low-bandwidth.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Best-effort HLS/DASH *manifest* mirroring** | Adaptive streaming is most real-world web video; session-replay tools flatly "don't support streamed video." Mirroring the **manifest URL** (`.m3u8`/`.mpd`) lets the viewer's own player re-stream it | HIGH | The hard part: when a page uses MSE (hls.js/dash.js/video.js/Shaka), `<video>.src` is a **`blob:` URL** to an in-memory MediaSource — *not fetchable cross-context*. The real manifest was fetched separately. Best-effort = **discover the manifest URL** (capture-side hook over the player lib / network, or host-provided), send *that* to the viewer, let the viewer instantiate its own HLS/DASH player. CORS on the manifest/segments is the gating risk. Explicitly "best-effort," with poster fallback. |
| **Live-stream handling (DVR vs live edge)** | Live HLS has no fixed duration; "seek to currentTime" is meaningless at the live edge | MEDIUM | Detect live (`duration === Infinity` / live manifest); for live, sync to **live edge / play-pause/mute only**, skip absolute-position drift math. A correctness win rrweb doesn't address. |
| **Drift-corrected sync as a first-class, tunable contract** | rrweb's drift math is internal/implicit; exposing a documented, tunable resync policy (interval, max-drift threshold, "snap vs ease") is a paper-worthy, framework-grade feature | MEDIUM | Builds directly on the table-stakes interpolation. Differentiator is the *rigor and configurability*, plus measuring drift in the evaluation harness. |
| **Explicit per-media capability/fallback telemetry** | Borrow rrweb's `{url, failed}` asset pattern for media: "viewer could not fetch / CORS-blocked / blob-unresolvable / DRM" → host observable | LOW–MEDIUM | Turns silent black boxes into diagnosable states; aligns with PhantomStream's existing diagnostics culture (relay ring buffer, `staleFlushCount`). |
| **Reference-only by design = privacy/bandwidth story** | "We never transport your media bytes" is both a security posture (no decoded attacker content re-broadcast) and the core-value bandwidth claim | LOW | Mostly positioning + a sanitizer rule that media bytes never enter the wire. Strong paper framing vs Hyperbeam/CDP. |

### Anti-Features (Commonly Requested, Often Problematic)

Each justified against the core value: *low-bandwidth, semantically addressable, sandbox-safe DOM mirror.*

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| **Re-encoding / transcoding media server-side** | "Make any codec/format play in the viewer" | Destroys the bandwidth thesis (now you relay media bytes + pay CPU), adds a media pipeline dependency, and turns a pure relay into a media server. Strictly worse than Hyperbeam's already-expensive pixel path. | Reference the original URL; if the viewer's browser can't play it, show poster + capability message. |
| **WebRTC media relay / pixel streaming of `<video>`** | "Just stream the pixels so DRM/MSE/anything works" (the Hyperbeam model) | 5–14+ Mbps per stream (vendor numbers above), no semantic addressing, breaks the sandbox (canvas-WebRTC plugin literally needs `UNSAFE_replayCanvas`), and abandons the project's reason to exist. | Out of scope, by charter (PROJECT.md: "not WebRTC, not canvas pixel streaming"). Poster fallback for the unplayable minority. |
| **Capturing DRM / EME (Widevine/PlayReady) content** | "Mirror Netflix/Spotify/DRM video" | Legally and technically a non-starter: protected media path is opaque to the DOM (encrypted, decoded in a secure path), and re-broadcasting it is a DRM violation. Even pixel capture is blocked by HDCP/black-frame protection. | Detect EME/`encrypted` event → **poster + "protected content" placeholder**. Explicit out-of-scope (milestone: "DRM/EME out"). |
| **Inlining media bytes as base64/data-URL** (the `inlineImages`/`captureAssets` path for video) | "Guarantee the viewer sees exactly what the source saw, even cross-origin/expired" | A 5-minute 1080p clip is hundreds of MB; blows the **1 MiB relay per-message cap** instantly and the bandwidth budget. rrweb itself only does this for *images* and even then it's opt-in and deprecated. | Reference URL. For *images* specifically, an **opt-in** small-asset inline (mirroring rrweb's `inlineImages`, with a byte ceiling) could be a v2.x escape hatch — but never for video/audio. |
| **Live `<canvas>`/WebGL frame streaming** | "Mirror the game/chart/animation" | Pixel path again; rrweb's own canvas-WebRTC plugin warns it breaks sandboxing. High bandwidth, defeats core value. | Keep existing static `<canvas>`→data-URL snapshot; document live canvas as non-mirrored. |
| **Capturing Web Audio API output / mic/cam `getUserMedia` streams** | "Mirror the sound / the webcam" | No DOM URL exists; it's a live media stream — would require pixel/audio relay. Out of the reference model entirely. | Out of scope; note as non-captured (consistent with rrweb: "anything outside standard DOM APIs isn't captured"). |
| **Frame-accurate A/V sync guarantee** | "The mirror must be perfectly in sync to the millisecond" | Impossible by reference (viewer fetches independently, network jitter, autoplay gating, different buffering). Over-promising invites bug reports. | Promise **drift-corrected, eventually-consistent** sync (rrweb-style), with a documented max-drift target measured in the eval harness. |

---

## Feature Dependencies

```
Image-by-URL (DONE: src/srcset/poster/css-url absolutified)
    └──enables──> poster fallback ──enables──> graceful media-load failure UX
    └──enables──> animated GIF/WebP/APNG (browser animates natively, free)

Initial media state in snapshot (rr_media* equivalents)
    └──requires──> capture-side read of currentTime/paused/muted/volume/rate/loop
    └──feeds──> Play/Pause/Seek/Volume/Rate sync (the live deltas)
                     └──requires──> drift-corrected currentTime interpolation
                                       └──requires──> offset-from-last-event math (NOT one-shot set)
                                       └──conflicts──> naive "set currentTime on every tick" (bandwidth + jitter)

Direct/progressive media URL playback (in scope)
    └──requires──> viewer iframe allow="autoplay"  AND  muted/gesture handling for play()

Best-effort HLS/DASH manifest mirroring (differentiator)
    └──requires──> manifest-URL DISCOVERY (blob: src is NOT usable)
    └──requires──> viewer-side HLS/DASH player (e.g. hls.js/dash.js) OR native HLS (Safari)
    └──requires──> CORS-permissive manifest + segments on the origin/CDN
    └──degrades-to──> poster fallback when discovery/CORS fails
    └──specializes-into──> live-stream handling (no absolute seek; sync to live edge)

MSE-without-discoverable-manifest  ──>  poster fallback (OUT of scope to play)
DRM/EME content                    ──>  poster + "protected" placeholder (OUT of scope)
Re-encode / WebRTC relay / canvas-pixel / media-byte-inline  ──CONFLICTS──> Core Value (low-bandwidth)
```

### Dependency Notes

- **Live sync requires the snapshot baseline + the interpolation math, not just the events.** Five sparse `MediaInteraction`-style events are useless to the viewer without (a) the initial `currentTime` baseline and (b) `now − lastEventTimestamp` offset interpolation. Skipping either yields visibly desynced playback within seconds.
- **HLS/DASH mirroring requires solving blob-URL opacity FIRST.** Because MSE assigns a `blob:` URL to `<video>.src`, you cannot just forward the `src` attribute (the existing `attr`-diff path will faithfully send a `blob:` URL that is dead in the viewer). The feature *is* the manifest-discovery step; everything else is downstream. This is the gap most likely to be under-scoped.
- **Autoplay gating conflicts with naive play-state replay.** The viewer can't simply call `el.play()` when it sees a `play` state — it must reflect `muted`, attempt play, and on `NotAllowedError` surface a user affordance. The iframe sandbox must also delegate `allow="autoplay"`. This couples the media feature to the existing sandboxed-iframe renderer contract.
- **Animated images enhance image-by-URL for free and *beat* the inline path** — re-fetched GIF/WebP/APNG animate natively in the viewer, whereas rrweb's `inlineImages` (canvas `toDataURL`) would freeze them to one frame. Worth calling out as a correctness win of the reference model.
- **All pixel/relay/transcode anti-features conflict with the Core Value**, not with each other — they are mutually a different product (Hyperbeam/CDP), and any one of them flips PhantomStream off its bandwidth thesis.

---

## MVP Definition

### Launch With (v2.0 core)

Minimum to credibly claim "PhantomStream mirrors media."

- [ ] **Confirm + document image-by-URL** (src/srcset/`<picture>`/background-image) — mostly verification of shipped behavior; the cheap, expected baseline.
- [ ] **Poster + dimensioned placeholder fallback** — every media path degrades here; needed before any video work ships.
- [ ] **Initial media state in snapshot** (currentTime/paused/muted/volume/playbackRate/loop) — the baseline the deltas anchor to.
- [ ] **Play / pause / seek / volume / rate sync** via small per-nid state messages — the defining capability; reuse existing diff/side-channel transport.
- [ ] **Drift-corrected `currentTime` interpolation in the viewer** (offset-from-last-event, throttled ≈500ms) — without this, "sync" is a lie within seconds.
- [ ] **Direct/progressive media URL playback** (`.mp4`/`.webm`/`.mp3`/`.ogg`) with **autoplay-policy-correct viewer** (`allow="autoplay"`, muted/gesture handling) — the in-scope media that actually plays.
- [ ] **Looped + animated-image correctness** — low cost, high "it just works" value.

### Add After Validation (v2.x)

- [ ] **Best-effort HLS/DASH manifest mirroring + viewer-side player** — trigger: core sync is solid and there's demand/eval evidence for streaming sites. (High complexity; gate on manifest-discovery feasibility.)
- [ ] **Live-stream handling** (live-edge sync) — trigger: once manifest mirroring exists.
- [ ] **Per-media capability/fallback telemetry** (`{url, failed}`-style) — trigger: real-world media failures need diagnosis.
- [ ] **Opt-in small-image inline escape hatch** (byte-capped, rrweb `inlineImages`-style) — trigger: cross-origin/expired-image fidelity complaints. *Images only, never media.*

### Future Consideration (v3+ / likely never)

- [ ] Anything in the Anti-Features table — documented as out-of-scope, kept here only so the boundary is explicit and re-litigation is cheap.

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Image-by-URL (confirm/document) | HIGH | LOW (done) | P1 |
| Poster + placeholder fallback | HIGH | MEDIUM | P1 |
| Initial media state in snapshot | HIGH | MEDIUM | P1 |
| Play/pause/seek/volume/rate sync | HIGH | MEDIUM | P1 |
| Drift-corrected currentTime interpolation | HIGH | MEDIUM–HIGH | P1 |
| Direct/progressive URL playback + autoplay-correct viewer | HIGH | MEDIUM | P1 |
| Looped + animated-image correctness | MEDIUM | LOW | P1 |
| Best-effort HLS/DASH manifest mirroring | HIGH | HIGH | P2 |
| Live-stream (live-edge) handling | MEDIUM | MEDIUM | P2 |
| Per-media capability/fallback telemetry | MEDIUM | LOW–MEDIUM | P2 |
| Opt-in small-image inline (byte-capped) | LOW–MEDIUM | MEDIUM | P3 |
| Re-encode / WebRTC relay / canvas-pixel / DRM / byte-inline media | (negative) | HIGH | P3 (anti) |

## Competitor Feature Analysis

| Feature | rrweb (prior art) | Co-browse / pixel tools (Surfly / Hyperbeam / CDP) | PhantomStream v2.0 plan |
|---------|-------------------|----------------------------------------------------|--------------------------|
| `<img>` | URL by default; opt-in `inlineImages` base64 (deprecated → `captureAssets`) | Surfly: proxied content. Hyperbeam/CDP: pixels | **URL (already shipped)** + opt-in small-image inline later |
| srcset / `<picture>` | absolutified URLs | pixels/proxy | URLs (shipped); viewer picks candidate |
| background-image | absolutified `url()` | pixels/proxy | URLs (shipped), CSSOM parity |
| `<video>`/`<audio>` element + state | `rr_media*` attrs + 5 `MediaInteraction` events; **no frames** | Hyperbeam: full WebRTC A/V; CDP: JPEG frames | **State + URL by reference; no frames** (match rrweb's correct line) |
| currentTime sync | event-anchored capture; **interpolated drift-corrected replay** | implicit (it's video) | Same interpolation, **tunable + measured** (differentiator) |
| HLS/DASH streaming | not supported ("streamed video not captured") | Hyperbeam/CDP: works (pixels) | **Best-effort manifest mirroring** (differentiator; gated on discovery) |
| DRM/EME | not captured | Hyperbeam: plays (pixels) | **Out of scope** → poster placeholder |
| `<canvas>`/WebGL live | opt-in raster frames / WebRTC plugin (unsafe) | pixels | static data-URL snapshot only; live = anti-feature |
| Bandwidth posture | low (DOM) | **5–14+ Mbps/stream** | low (URLs + tiny state msgs) — the whole point |

---

## Expectation Gaps vs the Draft Requirements (flag for the requirements author)

The draft scope (image-by-URL, video/audio URL+sync, HLS/DASH best-effort, MSE/DRM poster fallback) is well-aimed. Gaps to close:

1. **"video/audio play-pause-seek sync" silently requires drift-corrected `currentTime` interpolation.** rrweb proves a one-shot `currentTime` set desyncs; the requirement must call out *offset-from-last-event* math (`MediaManager.seekTo` model), a resync cadence (≈`sampling.media` 500ms), and a max-drift target. Otherwise "sync" ships visibly broken.
2. **Initial media state must be in the snapshot, not only in diffs.** rrweb captures `rr_media*` at snapshot time. Requirements should add snapshot-time `currentTime/paused/muted/volume/rate/loop` capture as a distinct line — the deltas are meaningless without the baseline.
3. **Autoplay policy is a hard viewer constraint, currently unstated.** Programmatic `play()` → `NotAllowedError` without a gesture; **muted autoplay only**; sandboxed iframe needs `allow="autoplay"`. The requirement should mandate: reflect `muted`, attempt `play()`, catch rejection, surface a "click to play/unmute" affordance. This couples to the existing sandbox contract.
4. **HLS/DASH "best-effort" is really "manifest-URL discovery," and the existing `attr`-diff path actively works against it.** Because MSE sets `<video>.src` to a dead `blob:` URL, the current pipeline will faithfully forward an unusable src. The requirement must name *manifest discovery* (player-lib/network hook or host-provided) + *viewer-side HLS/DASH player* + *CORS dependency* as the actual deliverable, with poster fallback when any of those fail. This is the most likely under-scoped item.
5. **Live streams need separate sync semantics.** `duration === Infinity` ⇒ absolute-position drift math is meaningless; sync to live edge + play/pause/mute only. Add a live-vs-VOD branch.
6. **CORS on re-fetch is the dominant real-world failure mode and needs an explicit UX, not just a mention.** Cross-origin images/media without permissive headers will fail in the viewer just as they do for rrweb (`crossOrigin='anonymous'` retry). Requirement should specify poster → dimensioned placeholder → capability message, and never a broken layout.
7. **`srcset`/`<picture>` candidate selection differs in the viewer.** The viewer's viewport/DPR picks a different candidate than the source tab. Harmless but should be documented so it's not filed as a fidelity bug.
8. **A media-bytes-never-on-the-wire sanitizer rule should be explicit.** To keep both the bandwidth and security postures, codify that media payload bytes (not URLs) are never transported — distinguishing media from the existing image-inline escape hatch. Mirrors rrweb's `{url, failed}` boundary discipline.
9. **`blob:`/object-URL and `data:` media need a defined policy.** `blob:` media src is unfetchable cross-context (→ poster). Tiny `data:` media URLs are self-contained and *do* work (they're already in the DOM text) — worth distinguishing from large inline so they aren't accidentally stripped.

---

## Sources

Primary (rrweb — HIGH confidence):
- [rrweb `packages/types/src/index.ts`](https://raw.githubusercontent.com/rrweb-io/rrweb/master/packages/types/src/index.ts) — `MediaInteractions` enum, `mediaInteractionParam`, `EventType`/`IncrementalSource` enums (no separate `Media` source), `assetEvent`/`assetParam`, `SerializedCanvasArg`/`SerializedCssTextArg`
- [rrweb `packages/rrweb/src/record/observer.ts`](https://raw.githubusercontent.com/rrweb-io/rrweb/master/packages/rrweb/src/record/observer.ts) — media observer: 5 events, fields read, `sampling.media` throttle (default 500ms), event-driven only
- [rrweb `packages/rrweb-snapshot/src/snapshot.ts`](https://raw.githubusercontent.com/rrweb-io/rrweb/master/packages/rrweb-snapshot/src/snapshot.ts) — src/srcset/href absolutification, `inlineImages` `rr_dataURL` (+CORS retry), `rr_media*` attrs, `absolutifyURLs` for background-image
- [rrweb `packages/rrweb/src/replay/media/index.ts`](https://raw.githubusercontent.com/rrweb-io/rrweb/master/packages/rrweb/src/replay/media/index.ts) — `MediaManager` drift-corrected interpolation (`seekTo`, offset-from-last-event, `% duration` for loop)
- [rrweb `guide.md`](https://github.com/rrweb-io/rrweb/blob/main/guide.md) — config defaults: `inlineImages:false`, `inlineStylesheet:true`, `recordCanvas:false`, `collectFonts:false`; deprecation notes
- [rrweb canvas recipe](https://github.com/rrweb-io/rrweb/blob/master/docs/recipes/canvas.md) and [storage/sampling recipe](https://github.com/rrweb-io/rrweb/blob/main/docs/recipes/optimize-storage.md) — `sampling.canvas`/`media`, `dataURLOptions`
- [rrweb canvas-WebRTC plugin Readme](https://github.com/rrweb-io/rrweb/blob/master/packages/plugins/rrweb-plugin-canvas-webrtc-record/Readme.md) — WebRTC canvas path, `UNSAFE_replayCanvas` sandbox warning

Co-browsing / pixel tools (MEDIUM — vendor docs):
- [Hyperbeam FAQ — bandwidth table](https://docs.hyperbeam.com/home/faq) (720p@24fps 5 Mbps … 1080p@30fps 14.1 Mbps; sharp mode ×3) and [Hyperbeam architecture / HN launch](https://news.ycombinator.com/item?id=30433104) (server Chromium + WebRTC A/V)
- [Surfly platform](https://www.surfly.com/platform) / [co-browsing vs screen sharing](https://www.surfly.com/glossary/co-browsing-vs-sreen-sharing) — DOM-rewriting proxy, content not pixels
- [CDP `Page` domain](https://chromedevtools.github.io/devtools-protocol/tot/Page/) + [browserless screencast](https://www.browserless.io/blog/screencast) — `startScreencast` JPEG frames, per-frame ack, ~50–100 KB/frame@q80 720p, Chromium-only

Standards / behavior (MEDIUM–HIGH — MDN/Chrome):
- [MDN Autoplay guide](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay) + [Chrome autoplay policy](https://developer.chrome.com/blog/autoplay) — `NotAllowedError`, muted-autoplay-always-allowed, iframe `allow=autoplay`
- [MDN Media Source Extensions API](https://developer.mozilla.org/docs/Web/API/Media_Source_Extensions_API) + [hls.js](https://github.com/video-dev/hls.js) — MSE attaches via `blob:` URL; manifest/segments are the real sources; blob URL is tab-local
- Session-replay norms (corroborating, LOW–MEDIUM): industry "only static publicly-hosted videos captured; streamed video not supported"; blocked elements → dimensioned placeholder

Internal context:
- `/.planning/PROJECT.md` (Core Value; Out-of-Scope line being reversed), `docs/ARCHITECTURE.md` §2.2 (existing URL absolutification incl. `poster`/`srcset`, canvas→data-URL), §3.3 (1 MiB relay cap), §6 (existing video/audio non-capture boundary)

---
*Feature research for: media/asset mirroring by reference (PhantomStream v2.0)*
*Researched: 2026-06-19*
