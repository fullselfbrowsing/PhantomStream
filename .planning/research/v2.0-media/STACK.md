# Stack Research — v2.0 Asset & Media Streaming (media-by-URL)

**Domain:** DOM-native browser mirroring — adding by-reference media/asset replay to an existing, shipped, dependency-light framework
**Researched:** 2026-06-19
**Confidence:** HIGH (library versions, media-element APIs, native-HLS detection, and CDP/Playwright signals all verified against current sources; the one MEDIUM item is flagged inline)

---

## TL;DR for the roadmapper

- **By-reference is already 90% wired.** Capture already absolutifies `src`/`poster`/`srcset` (`URL_ATTRS` + `absolutifyUrl`/`absolutifySrcset` in `src/capture/index.js`), already passes `blob:`/`data:` through untouched, and does **not** drop `<video>`/`<audio>` (only `script`/`noscript`/`object`/`embed` are wire-dropped, line 2143). A `<video src="https://…mp4">` already lands in the mirror and **plays natively with no JavaScript** because progressive media needs no script. v2.0 mostly adds *playback-state sync*, *adaptive-manifest handling*, and *placeholder fallback* — not a new asset pipeline.
- **Add ONE runtime dependency, and make it optional+lazy: `hls.js`.** It is the only library whose value (recover an HLS stream the viewer's browser can't play natively) justifies its weight, and HLS is the dominant adaptive format on the open web.
- **Do NOT bundle `dash.js` or `shaka-player`.** DASH-by-manifest is a long-tail case; cover it only via the host-provided optional-player seam (same seam hls.js uses). Native HLS (Safari/iOS) needs **zero** library.
- **The hard constraint that shapes everything:** the mirror iframe is `sandbox="allow-same-origin"` with **NO `allow-scripts`** (`src/renderer/index.js:209`, asserted at construction). hls.js/dash.js need JS **and** MediaSource, so **they cannot run inside the mirror iframe.** Any adaptive player must run in a **separate, script-enabled media surface** the renderer owns (a sibling `<video>` overlay, or a separate sandboxed-with-`allow-scripts` player frame), positioned over the inert `<video>` placeholder by nid — never by weakening the mirror sandbox.

---

## Recommended Stack

### Core "technologies" (mostly platform APIs — keep it that way)

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| **`URL` (WHATWG)** | platform (built-in) | Absolutize relative/protocol-relative media URLs at capture; classify scheme (`blob:`/`data:`/`http(s):`) and same- vs cross-origin | Already in use (`new URL(val, base)` at capture). Zero-dep, universal across content-script / `addInitScript` / Node. Reuse `absolutifyUrl`; do **not** add a URL library. |
| **`HTMLMediaElement` DOM API** | platform (built-in) | Capture playback state on the origin tab and reproduce it on the viewer's `<video>`/`<audio>` | The entire media-sync feature is built from element properties + events (table below). No library needed for play/pause/seek/rate mirroring. |
| **`HTMLMediaElement.canPlayType()` / `MediaSource.isTypeSupported()`** | platform (built-in) | Viewer-side capability gate: native HLS vs hls.js vs placeholder | `video.canPlayType('application/vnd.apple.mpegurl')` returning non-empty (Safari/iOS) ⇒ set `src` directly, **no library**. Otherwise fall to `Hls.isSupported()` (which checks MSE). |
| **`<video>` / `<audio>` native progressive playback** | platform (built-in) | Direct/progressive media (`.mp4`, `.webm`, `.mp3`, `.ogg`, `<img>`, `<picture>`) | Needs no script at all — already plays in the current no-`allow-scripts` mirror once the src is absolutified. This is the in-scope happy path and the bandwidth story: **wire carries the URL, the viewer's browser fetches the bytes.** |

### Supporting library — the ONE add

| Library | Version | License | Module | Purpose | When to Use |
|---------|---------|---------|--------|---------|-------------|
| **`hls.js`** | **1.6.16** (latest; published ~Apr 2026) | **Apache-2.0** | Ships ESM at `dist/hls.mjs` (resolved via the package `module`/`exports` field) and a smaller `dist/hls.light.mjs` (drops subtitles/alt-audio/EME) | Play an HLS `.m3u8` in browsers **without** native HLS (desktop Chrome/Firefox/Edge) by transmuxing TS→fMP4 into MSE | **Optional + lazy-loaded**, on the **viewer/renderer** side only, inside the renderer-owned script-enabled media surface — never inside the mirror iframe, never on the capture/relay path. |

**Sizing (verified Bundlephobia, hls.js@1.6.16):** full build **≈157 KB gzipped** (≈512 KB minified). The `hls.light.mjs` build is materially smaller (community-reported ≈50 KB class). For PhantomStream this is **never** in the default download: it is `import()`-ed only when a viewer actually encounters an HLS manifest it can't play natively.

**Why optional + peer-style + lazy, not a hard dependency:**
- **Bandwidth/footprint story is the product.** PhantomStream ships with one runtime dep (`ws`) and a zero-dep protocol core. Bolting 157 KB gzip onto every consumer — most of whom mirror pages with no adaptive video — contradicts the core value ("low-bandwidth … if everything else fails capture→relay→render must work"). 157 KB is larger than many entire mirror snapshots.
- **It is viewer-only and situational.** Capture and relay never touch it; only a viewer rendering an HLS-bearing page needs it, and only when native HLS is absent.
- **Lazy `import('hls.js')` keeps it off the critical path** and lets bundlers tree-shake/code-split it. Pair with a host hook so consumers can supply their own already-bundled instance (see "Integration seam").

**Recommended packaging shape:** declare hls.js as an **optional `peerDependency`** (`peerDependenciesMeta.[hls.js].optional = true`) so consumers who want adaptive HLS install it explicitly and control the version, while default installs and the bandwidth budget stay untouched. The renderer feature-detects it (`typeof Hls !== 'undefined'` / dynamic import in try/catch) and degrades to poster/placeholder when absent.

### Development tools (no change required)

| Tool | Purpose | Notes |
|------|---------|-------|
| `node --test` + `jsdom@^29` | Existing test runner | jsdom has **no** real media stack — `HTMLMediaElement` play/seek are no-ops and MSE/`canPlayType` are absent. **Test the protocol + state-capture/replay logic in jsdom; gate true playback in the Playwright UAT** (Playwright is already a devDependency). |
| `playwright@^1.60` | Adapter + UAT harness | Already present; the only place real `<video>` playback, native-HLS, and CDP `Network` manifest discovery can be exercised end-to-end. |
| `tsc` (JSDoc `.d.ts`) | Types | New media message typedefs live in `src/protocol/messages.js` JSDoc, same as existing payloads — no TS migration. |

---

## The media-element API surface (capture → replay)

This is the heart of v2.0 and is **100% platform API, zero library.** Mirror these by nid through a new small protocol op (sized like `STREAM.SCROLL` — see "Protocol integration").

### Properties to read at capture / write at replay

| Property | Read at capture | Write/use at replay | Notes |
|----------|-----------------|---------------------|-------|
| `currentTime` (seconds, float) | yes | **yes** (setting it seeks) | The seek primitive on both ends. Replay tolerance band (e.g. re-seek only if drift > ~0.5–1 s) avoids fighting the viewer's own buffering. |
| `duration` (seconds; may be `NaN`/`Infinity`) | yes | display/clamp only | `NaN` until `loadedmetadata`; `Infinity` for live. Send once known; clamp seeks to it. |
| `playbackRate` (float, 1.0 = normal) | yes | **yes** | Mirror fast-forward/slow-mo. |
| `paused` (bool, read-only) | yes | drives `play()`/`pause()` | Not settable — call `.play()`/`.pause()` on the replay element to match. `.play()` returns a Promise; swallow rejection (autoplay policy). |
| `seeking` (bool, read-only) | yes (suppress noisy sync mid-seek) | informational | Lets capture debounce `timeupdate` spam during an active seek. |
| `muted` / `volume` | optional | optional | Mirror if desired; **default the replay element muted** so autoplay is allowed and the viewer isn't blasted with audio. |
| `currentSrc` (resolved absolute URL, read-only) | **yes — prefer over `src`** | n/a | The browser's **chosen** source after `srcset`/`<source>`/`<picture>` resolution. This is the URL the viewer should fetch. |
| `src` | fallback when `currentSrc` empty | n/a | May be relative or empty (when `<source>` children are used). |
| `HTMLImageElement.currentSrc` | **yes for `<img>`/`<picture>`** | n/a | Resolves `srcset` + `<picture>` art-direction to the actually-selected URL at the origin's DPR/viewport. Capturing this (in addition to keeping `srcset`/`sizes`) makes the viewer fetch the same asset the origin showed, instead of re-resolving against the viewer's own DPR. **Caveat:** empty until the image has begun loading; fall back to `src`/`srcset`. |

### Events to listen for (capture side)

| Event | Fires when | Use |
|-------|-----------|-----|
| `loadedmetadata` | duration/dimensions known | Emit the first authoritative `{duration}` + initial state. |
| `play` | playback starts | Flip mirrored `paused=false`. |
| `pause` | playback pauses | Flip mirrored `paused=true`. |
| `seeked` | a seek completes | Emit authoritative `currentTime` (the *reliable* position signal — prefer over `seeking`). |
| `ratechange` | `playbackRate` changes | Emit new rate. |
| `timeupdate` | currentTime advances (browser-throttled, ~4–66 Hz; commonly ~4/s) | **Throttle hard before sending** — this is the firehose. Reuse the existing throttle discipline (a `MEDIA_SYNC_THROTTLE_MS` sibling to `SCROLL_THROTTLE_MS`/`OVERLAY_THROTTLE_MS`). Position can be *interpolated* on the viewer between syncs, so 1–2 Hz on the wire is plenty. |

**Capture design note (fits the existing side-channel pattern):** treat media-state exactly like scroll/overlay — a **throttled side channel**, not a per-frame mutation. The viewer extrapolates `currentTime` from the last `{currentTime, playbackRate, paused, atWallClock}` tuple, so the wire stays near-silent during steady playback. This preserves the "paint-cadence diff delivery / don't regress bandwidth" constraint.

---

## URL handling (capture side) — reuse, do not add

All of this already exists in `src/capture/index.js`; v2.0 extends it rather than introducing new machinery:

- **Absolutize:** `absolutifyUrl(val, baseDoc)` → `new URL(val, base).href`; `absolutifySrcset` for `srcset`. `URL_ATTRS = ['src','href','action','poster','data']` already covers `<video src>`, `<audio src>`, `<source src>` (via the generic `src`), and `poster`. **Confirm `<source>` children are walked** (they are ordinary elements with `src`/`srcset`/`type`) so `<video><source></video>` resolves.
- **Scheme classification (already present, line ~3009):** `absolutifyUrl` short-circuits `data:`, `blob:`, `javascript:`. Use the same predicate to drive the v2.0 fork:
  - `http(s):` (or already-absolute) → **stream by reference** (viewer fetches).
  - `blob:` / MSE-backed → **not fetchable cross-context** → poster/placeholder, *unless* a manifest URL was recovered adapter-side (below).
  - `data:` → already inlined in the URL itself (carries its own bytes); leave as-is (counts against payload budget — large data URIs were already a truncation concern).
- **Same-origin vs cross-origin classification:** compare `new URL(resolved).origin` against the captured page origin (capture already computes frame origins via `new URL(src, baseHref).origin`, line ~935). This classification feeds the `crossorigin` decision below and lets the roadmap reason about which assets the *viewer's* network can actually reach (public CDN vs origin-private/authenticated).

**Do NOT add** a URL-parsing/normalization library (no `whatwg-url`, no `url-parse`, no `normalize-url`). The platform `URL` is sufficient and already load-bearing.

---

## Adapter-side manifest discovery (recover an HLS/DASH URL behind a `blob:`)

When a site uses MSE (e.g. hls.js/Shaka/native player feeding MediaSource), the `<video src>` is a `blob:` and is **useless to the viewer** — the bytes live only in the origin tab's MSE buffer. The only way to give the viewer something playable is to recover the **manifest URL** the origin player fetched. This is an **adapter/host concern** (Playwright/CDP/extension), never the relay's, and is explicitly **best-effort** per the milestone scope.

### Minimal reliable signal

**Watch the network for manifest responses by MIME type and by URL shape, then associate the most recent manifest with the `blob:`-backed `<video>`.**

**Playwright path (preferred where available):**
- Subscribe to `page.on('response', …)` (and/or `page.on('request', …)`).
- A response is a manifest if **any** of:
  - `response.request().resourceType() === 'manifest'`, **or**
  - the response `content-type` header matches HLS (`application/vnd.apple.mpegurl`, `application/x-mpegurl`) or DASH (`application/dash+xml`), **or**
  - the URL path ends in `.m3u8` (HLS) or `.mpd` (DASH) (fallback — many CDNs serve manifests as `application/octet-stream` or `text/plain`, so URL-suffix sniffing is a necessary backstop).
- Keep the **most-recent** manifest URL (and kind) seen on the main frame; emit it alongside the placeholder for the inert `<video>` so the viewer can load it into hls.js (HLS) or the host-provided DASH player (DASH).

**CDP path (when the adapter holds a `cdpSession` — the adapter already does, `src/adapters/playwright.js`):**
- `Network.enable`, then listen to `Network.responseReceived`: inspect `params.response.mimeType` (HLS/DASH MIME above) and `params.type === 'Manifest'`. `Network.requestWillBeSent` gives the request URL early if you prefer to sniff the suffix before the response.
- Same association rule: latest manifest URL on the page → the `blob:` video's nid.
- This is the same surface the adapter already speaks (`session.send('Input.…')`); add a `Network` listener, do **not** add a new dependency.

**Reliability caveats (state these as "best-effort" in requirements):**
- A manifest seen on the wire is not guaranteed to be the one feeding *that* `<video>` (multiple players, ads, preload). Heuristic: most-recent main-frame manifest, optionally time-correlated with the video's first `timeupdate`/`loadedmetadata`.
- DRM/EME and pure MSE-with-no-manifest (segments appended from script with no playlist) are **out of scope** → poster/placeholder, by milestone decision.
- The recovered manifest must be **publicly fetchable by the viewer** (CDN token/cookie/Referer constraints can still block it). When it 403s viewer-side, the player should fall back to placeholder — design the renderer for graceful failure.

---

## `crossorigin` / `referrerpolicy` and viewer-side asset loading

The viewer fetches assets from the **original origin/CDN over its own network**, so these attributes — captured from the origin element — materially affect whether the fetch succeeds and what it can be used for.

- **`crossorigin`** (`<img>`, `<video>`, `<audio>`, `<link>`):
  - Absent (default) → no-CORS fetch. The asset **displays/plays fine**, but is "opaque" (can't be read into canvas, and for media certain APIs are tainted). For pure mirroring (just show it), absent is usually fine and is what most sites use.
  - `anonymous` → CORS request, credentials only if same-origin. Needed if the viewer ever needs CORS-clean media (rarely, for by-reference replay).
  - `use-credentials` → CORS request **with** cookies/credentials. **Almost always wrong on the viewer**, because the viewer's browser does not hold the origin's auth cookies — it would either fail CORS or fetch an unauthenticated/wrong asset.
  - **Recommendation:** **carry `crossorigin` through as captured** (it's already eligible — it's an ordinary attribute, not URL-bearing), but the renderer should be prepared to **drop/normalize `use-credentials`** on the viewer because cross-user credentialed fetches won't carry the right cookies and just cause failures. Document this as a fidelity caveat: assets gated behind the origin's login are **not** mirrorable by reference (expected — that's the cross-origin/auth boundary, consistent with PhantomStream's existing cross-origin-iframe limitation).
- **`referrerpolicy`** (`<img>`, `<video>`, `<audio>`, `<link>`, etc.):
  - Controls the `Referer` header on the viewer's asset fetch. Many CDNs **hotlink-protect** by `Referer`, so the viewer (different origin) may get 403 where the origin tab succeeded.
  - **Recommendation:** carry `referrerpolicy` through as captured; additionally consider the renderer defaulting media/image loads to **`no-referrer`** or `origin` only when a fetch fails, as a best-effort retry. Treat Referer-gated assets as a known best-effort failure → placeholder.

**Security note (stays consistent with the existing sanitizer):** `crossorigin`/`referrerpolicy` are **not** in the renderer's `URL_ATTRS` dangerous-scheme set and carry no script, so they pass the existing sanitizer untouched. No new sanitizer surface is opened by allowing them. The dangerous-scheme scrub on `src`/`poster`/`srcset` (capture + renderer) already protects the actual URLs.

---

## Integration seam (named against the existing code)

| Where | Existing anchor | v2.0 addition |
|-------|-----------------|---------------|
| **Protocol** | `src/protocol/messages.js` `STREAM` namespace; `SnapshotPayload`/side-channel payloads | Add `STREAM.MEDIA` (or `ext:dom-media-state`) carrying `{ nid, currentTime, duration, playbackRate, paused, kind:'progressive'\|'hls'\|'dash'\|'placeholder', src?, manifestUrl?, atWallClock, streamSessionId, snapshotId }`. Identity-stamp it so `isCurrentStream()` gates it like every other message. Keep payload tiny (side-channel, not mutation). |
| **Constants** | `src/protocol/constants.js` `SCROLL_THROTTLE_MS=200`, `OVERLAY_THROTTLE_MS=500` | Add `MEDIA_SYNC_THROTTLE_MS` (≈250–500 ms) so `timeupdate` is throttled at the source, matching the side-channel cadence discipline. |
| **Capture** | `URL_ATTRS`, `absolutifyUrl`, `absolutifySrcset`; `<video>`/`<audio>` already pass through; `isWireDroppedElement` (line 2143) | Attach throttled media-state listeners to captured `<video>`/`<audio>`; emit `currentSrc`/`HTMLImageElement.currentSrc`; fork to placeholder for `blob:`/MSE. Reuse `createBlockPlaceholder` (line 2341) for the inert poster/placeholder when unplayable. |
| **Renderer** | `src/renderer/index.js` — `dispatch()` switch; mirror iframe is `sandbox="allow-same-origin"` **no allow-scripts** (line 209); `handleScroll` as the side-channel template | Add a `STREAM.MEDIA` case. For `progressive`/native-HLS: drive the mirror's own `<video>` element by nid (set `src`, `currentTime`, `playbackRate`, `play/pause`) — **works inside the existing no-script mirror.** For `hls`/`dash`: mount a **renderer-owned, script-enabled media surface** over the placeholder by nid and feed it the manifest with **lazily-imported** hls.js (or host-provided player) — **do not** add `allow-scripts` to the mirror iframe. |
| **Adapter** | `src/adapters/playwright.js` — already holds `page` + optional `cdpSession`, already sends `Input.*` over CDP | Add a `Network` listener (CDP `Network.responseReceived` or Playwright `page.on('response')`) for manifest discovery; pass recovered `manifestUrl` into the capture/placeholder for `blob:` videos. |

**Sandbox seam, stated explicitly for the roadmap:** the renderer must gain a *second* media surface concept. Option A (recommended): a sibling `<video>` in the renderer's host DOM, absolutely positioned over the mirror by the existing `resolveNidRect`/overlay geometry (the renderer **already** maps nid → host rect for overlays/highlights — reuse it). Option B: a dedicated `<iframe sandbox="allow-scripts allow-same-origin">` player frame that runs hls.js, again positioned by nid. Both keep the **mirror** iframe script-free and the attacker-HTML-rendering surface unchanged.

---

## Installation

```bash
# NO new default dependency. The framework's runtime deps stay: ws (relay) only.

# hls.js is an OPTIONAL peer — consumers who want adaptive-HLS replay install it:
npm install hls.js   # 1.6.16, Apache-2.0; viewer/renderer side, lazy-loaded

# package.json (framework) adds it as an optional peer, NOT a dependency:
#   "peerDependencies":      { "hls.js": "^1.6.0" }
#   "peerDependenciesMeta":  { "hls.js": { "optional": true } }
```

```bash
# Dev/test: nothing new — Playwright (already present) is where real playback,
# native-HLS, and CDP Network manifest discovery are exercised.
```

---

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| **hls.js (optional, lazy)** for HLS | **shaka-player 5.1.10** (Apache-2.0, ESM+CJS, ~110 KB class min, plays **both** HLS+DASH via one `player.load()`) | If a consumer needs DASH **and** HLS through one player, offline, or Chromecast/smart-TV reach. Expose it through the **same host-provided-player seam** rather than bundling. Heavier and broader than PhantomStream needs by default. |
| **hls.js (optional)** | **dash.js 5.2.0** (BSD-3, ESM at `dist/modern/esm/dash.all.min.js`) | DASH-specific (`.mpd`) sites. DASH on the open web is far rarer than HLS; cover via host-provided-player seam only. Don't bundle. |
| **Native `<video>`/`canPlayType`** for Safari/iOS HLS | (none — it's free) | Always prefer native HLS when `video.canPlayType('application/vnd.apple.mpegurl')` is non-empty; skip hls.js entirely on that path. |
| **Throttled side-channel media-state op** | rrweb-style media plugin events | rrweb is a *replay* library, not a live by-reference streamer; its media event shape is informative but PhantomStream has its own protocol — model the op on the existing scroll/overlay side channels, don't take a dependency. |

---

## What NOT to Use (keep the bandwidth + dependency story intact)

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| **Bundling hls.js as a hard `dependency`** | ~157 KB gzip on every consumer — larger than many whole snapshots; most mirrors have no adaptive video. Breaks the low-bandwidth/dependency-light core value. | **Optional `peerDependency` + lazy `import()`**, viewer-side only, with host-provided-player fallback. |
| **Bundling `dash.js` or `shaka-player` at all** | DASH-by-manifest is long-tail; Shaka/dash add 80–110 KB+ for a rare case; doubles the "which player?" complexity. | Native HLS first; hls.js (optional) for HLS; **host-provided-player seam** for DASH/Shaka if a consumer needs it. |
| **Running hls.js/dash.js inside the mirror iframe** | The mirror is `sandbox="allow-same-origin"` with **no `allow-scripts`** (non-negotiable per project constraints) — adaptive players need JS + MSE and simply cannot run there. Adding `allow-scripts` would execute attacker-influenced HTML. | A **renderer-owned, script-enabled** sibling `<video>`/player frame positioned over the placeholder by nid. Mirror sandbox stays untouched. |
| **Streaming media *bytes* over the relay** (proxying/segment relay) | Defeats the entire by-reference premise; would blow the 1 MiB per-message cap (`RELAY_PER_MESSAGE_LIMIT_BYTES`) and the bandwidth budget; relay is deliberately raw/transport-agnostic. | Carry **URLs + small playback-state messages** only; viewer fetches bytes from origin/CDN over its own network. |
| **`MediaSource`/MSE reconstruction or `blob:` rehydration on the viewer** | `blob:` URLs and MSE buffers are bound to the origin tab's context; not transferable. EME/DRM explicitly out of scope. | Recover the **manifest URL** adapter-side when possible; otherwise **poster/placeholder** (milestone decision). |
| **WebRTC / canvas pixel streaming for media** | Explicitly out of scope; reintroduces the pixel-bandwidth cost PhantomStream exists to avoid; it's a paper *baseline*, not the implementation. | DOM-native by-reference media. |
| **A URL-parsing library** (`whatwg-url`, `url-parse`, `normalize-url`) | Platform `URL` already does absolutize + scheme + origin and is already load-bearing in capture. | Reuse `absolutifyUrl` / `new URL(...)`. |
| **Mirroring `crossorigin="use-credentials"` verbatim to the viewer** | The viewer holds no origin auth cookies; credentialed cross-user fetch fails CORS or returns the wrong asset. | Carry `crossorigin` through but **normalize/drop `use-credentials`** on the viewer; treat auth-gated assets as a documented best-effort miss → placeholder. |

---

## Stack Patterns by Variant

**If the captured media has a direct/progressive `http(s)` URL (`<img>`, `<video src>`, `<audio src>`, resolved `currentSrc`):**
- Stream by reference. Viewer's native `<video>`/`<img>` fetches it. **No library.** Already works in the no-script mirror.
- Because this is the in-scope happy path and the bandwidth proof point.

**If the captured `<video>` has a `blob:`/MSE src but the adapter recovered an HLS `.m3u8`:**
- Viewer-side: `canPlayType('application/vnd.apple.mpegurl')` non-empty → native (no lib); else lazy `import('hls.js')` into the renderer-owned media surface.
- Because HLS is the dominant adaptive format and hls.js is the smallest competent recovery path.

**If the recovered manifest is DASH `.mpd`:**
- Best-effort via the **host-provided-player seam** (consumer supplies dash.js/shaka). PhantomStream itself ships nothing for DASH.
- Because DASH-by-manifest is long-tail and not worth a default dependency.

**If no fetchable URL/manifest is recoverable (pure MSE, DRM/EME, or Referer/credential-gated CDN):**
- Poster/placeholder (`createBlockPlaceholder`), carrying dimensions only.
- Because these are out-of-scope by milestone decision and the cross-origin/auth boundary.

---

## Version Compatibility

| Package | Version | Compatible With | Notes |
|---------|---------|-----------------|-------|
| `hls.js` | 1.6.16 | ESM consumers / modern bundlers; PhantomStream ESM (`"type":"module"`) | `dist/hls.mjs` (full) and `dist/hls.light.mjs` (no subs/alt-audio/EME). Apache-2.0. Lazy-import so no build-step coupling to the zero-build library core. |
| `dash.js` | 5.2.0 | ESM via `dist/modern/esm/dash.all.min.js` | BSD-3. **Host-provided only** — not a PhantomStream dependency. |
| `shaka-player` | 5.1.10 | ESM + CJS | Apache-2.0. Plays HLS **and** DASH. **Host-provided only.** |
| Platform `URL` / `HTMLMediaElement` / `canPlayType` / `MediaSource` | n/a | All target runtimes (extension content script, `addInitScript`, bookmarklet, embedded SDK; Node has `URL` but **no** media DOM) | jsdom has no media stack → unit-test logic, UAT real playback in Playwright. |
| `playwright` | ^1.60 (devDep, present) | CDP `Network` domain + `page.on('response')` | Manifest discovery surface; already the adapter's CDP transport. |

---

## Sources

- **Context7** `/video-dev/hls.js` (resolved) — confirmed hls.js identity/scope (HLS via HTML5 video + MSE, TS→fMP4 transmux). HIGH.
- npmjs.com / Snyk / npmx — hls.js **1.6.16**, Apache-2.0, ships ESM `dist/hls.mjs`; `hls.light.mjs` variant. HIGH. <https://www.npmjs.com/package/hls.js> · <https://github.com/video-dev/hls.js/blob/master/MIGRATING.md>
- **Bundlephobia API** (`/api/size?package=hls.js`) — hls.js@1.6.16: **min 511,956 B, gzip 156,903 B**. HIGH. <https://bundlephobia.com/package/hls.js>
- hls.js bundle-size discussions — `hls.light.mjs` ≈50 KB class (drops subs/alt-audio/EME). MEDIUM (community-reported, not an official table). <https://github.com/video-dev/hls.js/issues/4936>
- GitHub Releases / DASH-IF docs — **dash.js 5.2.0**, BSD-3, ESM `dist/modern/esm/dash.all.min.js`. HIGH. <https://github.com/Dash-Industry-Forum/dash.js/releases> · <http://dashif.org/dash.js/pages/quickstart/installation.html>
- npmjs.com / shaka GitHub — **shaka-player 5.1.10**, Apache-2.0, ESM+CJS, plays HLS+DASH via one `load()`. HIGH. <https://www.npmjs.com/package/shaka-player> · <https://github.com/shaka-project/shaka-player>
- MDN — `HTMLMediaElement` (`currentTime`, `duration`, `playbackRate`, `paused`, `seeking`, `currentSrc`) and events (`timeupdate`, `seeked`, `play`, `pause`, `ratechange`, `loadedmetadata`). HIGH. <https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement>
- MDN — `HTMLImageElement.currentSrc` (resolves `srcset`/`<picture>`). HIGH. <https://developer.mozilla.org/en-US/docs/Web/API/HTMLImageElement/crossOrigin>
- VideoSDK / hls.js README — native-HLS detection via `video.canPlayType('application/vnd.apple.mpegurl')`; prefer native (Safari/iOS), else `Hls.isSupported()` (checks MSE). HIGH (multi-source). <https://www.videosdk.live/developer-hub/hls/native-hls-playback>
- Chrome DevTools Protocol — **Network domain**: `Network.responseReceived` `mimeType` + resource type `"Manifest"`; HLS `application/vnd.apple.mpegurl` / `application/x-mpegurl`, DASH `application/dash+xml`. HIGH. <https://chromedevtools.github.io/devtools-protocol/tot/Network/>
- Playwright — `Request.resourceType()` includes `manifest`; `page.on('request')`/`page.on('response')` filtering. HIGH. <https://playwright.dev/docs/api/class-request>
- MDN — `crossorigin` (`anonymous` vs `use-credentials`) and `referrerpolicy` (incl. `no-referrer`) effect on resource fetch/credentials/Referer. HIGH. <https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/crossorigin> · <https://developer.mozilla.org/en-US/docs/Web/API/HTMLImageElement/referrerPolicy>
- Codebase (read this session): `src/capture/index.js` (`URL_ATTRS`, `absolutifyUrl`/`absolutifySrcset` ~3008–3035, `blob:`/`data:` passthrough ~3009, `isWireDroppedElement` 2143, `createBlockPlaceholder` 2341, canvas→dataURL 3235), `src/renderer/index.js` (mirror `sandbox="allow-same-origin"` assertion 209–213, `dispatch`/`handleScroll` side-channel pattern, nid→host-rect resolution), `src/protocol/messages.js` (`STREAM`/`DIFF_OP`, identity stamping, `isCurrentStream`), `src/protocol/constants.js` (`RELAY_PER_MESSAGE_LIMIT_BYTES`, `SCROLL_THROTTLE_MS`/`OVERLAY_THROTTLE_MS`), `src/adapters/playwright.js` (existing `cdpSession`/`page.on` surface). HIGH.

---
*Stack research for: PhantomStream v2.0 — Asset & Media Streaming (media-by-URL)*
*Researched: 2026-06-19*
