# Architecture Research

**Domain:** DOM-native live browser mirroring — v2.0 "Asset & Media Streaming" (media-by-URL + playback-sync) integrated into the shipped PhantomStream pipeline
**Researched:** 2026-06-19
**Confidence:** HIGH (grounded in the actual source: `src/capture/index.js`, `src/renderer/`, `src/protocol/`, `src/relay/`, `src/transport/websocket.js`, `src/adapters/playwright.js` — every integration point below is a named real file/function)

> This is an **integration design for an existing, shipped framework**, not a redesign. The four-stage pipeline (capture -> protocol/envelope -> raw relay -> sandboxed renderer) and its invariants (1 MiB per-message cap, raw byte-verbatim relay, `{_lz,d}`/`{_ps:'deflate-raw'}` envelope back-compat, `allow-same-origin`-only iframe with no `allow-scripts`, dual capture/render sanitization chokepoints, WeakMap identity + `nodeIds` sidecars) are **fixed constraints**. Media-by-URL must ride them, not bend them.

---

## Standard Architecture

### System Overview — where media integrates into the existing four stages

```
┌──────────────────────────────────────────────────────────────────────────┐
│ STAGE 1: CAPTURE  (src/capture/index.js — createCapture closure)           │
│                                                                            │
│  serializeDOM()         processAddedNode()        processMutationBatch()   │
│   ├─ URL_ATTRS loop  ──►  ├─ URL_ATTRS loop  ──►   └─ attr branch          │
│   │  (src/poster/data)    │  (src/poster/data)        (src/poster/srcset)  │
│   ├─ absolutifySrcset     ├─ absolutifySrcset                              │
│   ├─ captureComputedStyles (background-image already absolute, curated)    │
│   └─ sanitizeForWire('element'|'subtree'|'attr')  ◄── single chokepoint    │
│         strips on*, dangerous schemes; KEEPS <video>/<audio>/<source>      │
│                                                                            │
│  [NEW] collectMediaState() — read-pass over <video>/<audio>               │
│  [NEW] startMediaSyncTracker() — throttled side channel (scroll twin)      │
└───────────────┬────────────────────────────────────────────────────────────┘
                │ transport.send(type, payload)  (fire-and-forget seam, D-07)
                ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ STAGE 2: PROTOCOL + ENVELOPE                                               │
│  src/protocol/messages.js   STREAM.* + DIFF_OP.* (+ [NEW] STREAM.MEDIA)    │
│  src/transport/websocket.js encodeWireMessage -> {_ps:'deflate-raw',d}     │
│         identity stamping (streamSessionId/snapshotId) on every payload    │
└───────────────┬────────────────────────────────────────────────────────────┘
                │ raw string frame (compressed at endpoint, NEVER at relay)
                ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ STAGE 3: RELAY  (src/relay/relay.js)  — UNCHANGED                          │
│  receive() -> checkRelayFrameLimit (1 MiB cap, classify by type) ->        │
│  sendToTargets() forwards `raw` byte-verbatim. No payload awareness.       │
│  [NEW] = ZERO relay code; STREAM.MEDIA is just another type string it      │
│         counts in receivedByType/deliveredByType diagnostics.              │
└───────────────┬────────────────────────────────────────────────────────────┘
                │
                ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ STAGE 4: RENDERER  (src/renderer/)                                         │
│                                                                            │
│  ┌────────────────────────────────┐   ┌──────────────────────────────┐    │
│  │ srcdoc iframe                  │   │ PARENT viewer context        │    │
│  │ sandbox="allow-same-origin"    │   │ (createViewer closure,       │    │
│  │ NO allow-scripts (asserted)    │   │  host page JS realm)         │    │
│  │                                │   │                              │    │
│  │ <video>/<audio> ELEMENTS       │◄──┤ [NEW] media controller:      │    │
│  │ (rendered from wire HTML;      │   │  - native src -> set in      │    │
│  │  inert: no JS runs here)       │   │    iframe element directly   │    │
│  │ CSP meta [NEW media-src]       │   │  - adaptive (HLS/DASH) ->    │    │
│  └────────────────────────────────┘   │    hls.js/dash.js drives the │    │
│                                        │    SAME element cross-realm  │    │
│  buildSnapshotHtml() [+media-src CSP]  │  - applies STREAM.MEDIA      │    │
│  diff.js applyMutations (ADD/ATTR)     │    (currentTime/paused/rate) │    │
│  sanitize.js (KEEPS media tags)        │    with drift tolerance      │    │
│                                        └──────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────────────┘

ADAPTER SIDE-BAND (out-of-band manifest discovery, src/adapters/*):
  Playwright/CDP: Network.responseReceived + Fetch hooks -> mediaManifest hint
  Extension MV3 : chrome.webRequest / PerformanceObserver -> mediaManifest hint
  -> fed to capture as an asset reference keyed by nid (graceful absence: none = native only)
```

### Component Responsibilities

| Component | Responsibility (v2.0 delta) | File / function | New or Modified |
|-----------|------------------------------|-----------------|-----------------|
| Asset URL capture | Absolutify + emit `img/source/video/svg image` URLs; already mostly present | `serializeDOM`, `processAddedNode`, `processMutationBatch` attr branch (`src/capture/index.js`) | **Modified** (extend `URL_ATTRS` handling; `currentSrc` enrichment) |
| Capture sanitize chokepoint | Keep media elements; scheme-check media URLs (already happens) | `sanitizeForWire('element'\|'subtree'\|'attr')` (`src/capture/index.js:2741`) | **Modified** (add `media-state` dispatch kind for masking; tiny) |
| Media-state reader | Read `currentTime/duration/paused/playbackRate/seeking/currentSrc` from live `<video>/<audio>` in a batched pass | `collectMediaState()` | **New** (in `src/capture/index.js`) |
| Media-sync side channel | Throttled, nid-addressed playback-state broadcaster | `startMediaSyncTracker()` / `stopMediaSyncTracker()` | **New** (scroll-channel twin in `src/capture/index.js`) |
| Protocol op | `STREAM.MEDIA` type + `MediaStatePayload` typedef | `src/protocol/messages.js` | **New** (one type + one typedef) |
| Throttle constant | `MEDIA_SYNC_THROTTLE_MS` | `src/protocol/constants.js` | **New** (one constant) |
| Relay | Fan-out + cap + classify (media is just a type string) | `src/relay/relay.js` | **Unchanged** |
| Envelope/transport | Compress/decompress media frames like any frame | `src/transport/websocket.js` | **Unchanged** |
| Renderer CSP | Permit media element fetches in the sandbox | `CSP_META` (`src/renderer/snapshot.js`) | **Modified** (add `media-src`) |
| Render sanitize | Keep media tags (already not in `DROP_TAGS`) | `src/renderer/sanitize.js` | **Unchanged** (verify-only) |
| Media controller (viewer) | Mount/drive `<video>/<audio>`; reconcile autoplay; apply sync; own adaptive player | `handleMedia()` + `installMedia()` in `createViewer` | **New** (in `src/renderer/index.js`, + small `src/renderer/media.js`) |
| Adaptive player host | Run hls.js/dash.js in the **parent** realm against the iframe's media element | `src/renderer/media.js` (optional, lazy) | **New** |
| Manifest discovery | Surface HLS/DASH URLs not present as element src | `src/adapters/playwright.js` (CDP Network hooks), `src/adapters/extension.js` (webRequest) | **Modified** (additive, optional) |

---

## The single load-bearing constraint: `allow-same-origin` WITHOUT `allow-scripts`

This one fact decides the entire viewer-playback design and must be called out before anything else.

`createViewer` hard-asserts the sandbox at construction (`src/renderer/index.js:209-213`):

```js
iframe.setAttribute('sandbox', 'allow-same-origin');
var sandboxTokens = (iframe.getAttribute('sandbox') || '').trim().split(/\s+/);
if (sandboxTokens.length !== 1 || sandboxTokens[0] !== 'allow-same-origin') {
  throw new Error('viewer-sandbox-invalid');  // fails loud if anyone weakens it
}
```

The mirror renders attacker-influenced HTML, so this is **non-negotiable** (PROJECT.md Constraints; docs/ARCHITECTURE.md limitation #5). Consequences for media:

- **Native progressive playback works in-sandbox with zero scripts.** `<video src="https://cdn/movie.mp4" controls>` plays via the browser's built-in media element. No `allow-scripts` needed. **This is the happy path and the v2.0 backbone.** Because the iframe is `allow-same-origin` and lives in the host document, the **parent realm can reach into `iframe.contentDocument`** and set `videoEl.currentTime`, `videoEl.play()`, etc. directly (this is exactly how the existing diff applier and `resolveNidRect` already manipulate the mirror document cross-realm — see `handleMutations` reading `iframe.contentDocument` at `src/renderer/index.js:1129`).
- **Adaptive streaming (HLS/DASH via MSE) CANNOT run inside the iframe.** hls.js/dash.js need to execute JavaScript and call `MediaSource`/`SourceBuffer` APIs *in the document that owns the `<video>`*. There is no script execution in the srcdoc iframe. **Therefore the adaptive player must run in the parent viewer realm and drive the iframe's `<video>` element cross-realm**, attaching a `MediaSource` object (or a blob: object URL) to the in-iframe element from outside. MSE objects are realm-bound, so the player creates the `MediaSource` in the parent and assigns `mediaEl.src = URL.createObjectURL(mediaSource)` onto the iframe element — feasible only because `allow-same-origin` keeps the documents same-origin and mutually scriptable from the parent.

> **Design rule (call this out to the roadmapper):** Player *code* never lives in the srcdoc iframe. Native playback uses the inert in-iframe element directly; adaptive playback runs hls.js/dash.js in the parent `createViewer` realm and reaches into `iframe.contentDocument` to bind the source. This keeps the published-framework threat model intact (no `allow-scripts`, ever) while still mirroring video.

A secondary load-bearing fact: the **CSP meta** in the srcdoc (`src/renderer/snapshot.js:57-62`) is `default-src 'none'` with only `img-src`/`style-src`/`font-src` opened. There is **no `media-src`**, so even a correct `<video src>` element would have its fetch blocked by CSP today. v2.0 must add `media-src` (and likely `connect-src` for adaptive segment XHR/fetch issued by the parent player) — see Pattern 4.

---

## Recommended Project Structure (delta only)

```
src/
├── protocol/
│   ├── messages.js          # + STREAM.MEDIA, + MediaStatePayload typedef        [MOD]
│   └── constants.js         # + MEDIA_SYNC_THROTTLE_MS                           [MOD]
├── capture/
│   └── index.js             # + collectMediaState(), startMediaSyncTracker(),    [MOD]
│                            #   + sanitizeForWire('media-state') kind,
│                            #   + mediaSourceHints registry (adapter-fed)
├── renderer/
│   ├── index.js             # + handleMedia() dispatch case, + installMedia()    [MOD]
│   ├── snapshot.js          # CSP_META += media-src/connect-src                  [MOD]
│   ├── sanitize.js          # verify media tags survive (no change expected)     [VERIFY]
│   └── media.js             # NEW: parent-realm media controller + lazy          [NEW]
│                            #      hls.js/dash.js host + drift reconciliation
└── adapters/
    ├── playwright.js        # + optional CDP Network manifest discovery          [MOD]
    └── extension.js         # + optional webRequest manifest discovery           [MOD]
```

### Structure Rationale

- **No new top-level module.** Media is an *aspect* of capture (a read-pass + a side channel) and the renderer (an element controller). Forcing a `src/media/` package would fight the codebase's stage-oriented split and duplicate the transport/identity seams. The only genuinely new file is `src/renderer/media.js`, justified because the adaptive-player host is a self-contained, lazily-loaded concern that must stay out of the always-loaded `createViewer` path (hls.js/dash.js are heavy; load only when an adaptive source appears).
- **Protocol stays the contract.** A new `STREAM.MEDIA` type + one typedef is the entire wire surface change. This mirrors how Phase 8/9 added `VALUE`, `SHADOW_ROOT`, `FRAME`, `STYLE_SOURCE` without disturbing the relay.
- **Adapters own discovery, never the core.** Exactly like `fetchStylesheet({href,scope,ownerKind})` (`src/capture/index.js:1191-1207`): the core never performs hidden network observation; adapters that *can* see the network (CDP, webRequest) push hints in.

---

## Architectural Patterns

### Pattern 1: Static asset URLs ride the EXISTING serialization paths (mostly already done)

**What:** Image/poster/source/SVG-image URLs are absolutified and emitted by the *same* code that already handles `src`/`href`/`poster`/`data`/`srcset`. No new serialization path is needed for static assets — only verification and small extensions.

**When to use:** Phase 1 of v2.0 (static assets). This is the lowest-risk integration because the machinery exists.

**What is ALREADY handled (verify, don't rebuild):**
- `URL_ATTRS = ['src','href','action','poster','data']` (`src/capture/index.js:61`) is absolutified in **all three** serialization paths: `serializeDOM` (line 3251), `processAddedNode` (line 3516), and the mutation `attr` branch (line 3845). So `<img src>`, `<video poster>`, `<source src>`, `<audio src>`, `<video src>` already get absolutified + dangerous-scheme-checked.
- `srcset` is absolutified via `absolutifySrcset` in the same three paths (lines 3267, 3521, 3848) — covers `<img srcset>` and `<source srcset>` inside `<picture>`.
- SVG `<image xlink:href>` is absolutified via `getAttributeNS`/`setAttributeNS` (`serializeDOM` line 3258, `sanitizeForWire` line 2801).
- `<picture>`/`<source>` elements are plain elements: **not** in `DROP_TAGS` (`src/renderer/sanitize.js:57`) and not stripped by `sanitizeForWire`, so they serialize into snapshot/add HTML verbatim and survive render sanitization.
- CSS `background-image` rides curated computed-style inlining (`CURATED_PROPS`/`SHELL_PROPS` both include `background-image`, lines 109/138) and CSSOM `styleSources`. **`getComputedStyle().backgroundImage` already returns an absolute `url(...)`**, and `scrubCssText` (capture + render) preserves http(s) and `data:image/*` url() — so background images already work by reference once the renderer CSP permits `img-src` (it does: `img-src http: https: data:`).

**The small gaps to close in Phase 1:**
1. **`currentSrc` divergence.** For responsive `<img srcset>`/`<picture>` and `<video>`/`<source>`, the element's *resolved* asset is `element.currentSrc`, which the serialized `src`/`srcset` attributes do not capture (the browser picked one candidate). For fidelity, capture should additionally emit the resolved `currentSrc` as an attribute the viewer can prefer. Recommended: emit a framework data attribute on the wire clone, e.g. `data-ps-currentsrc`, set in the `serializeDOM`/`processAddedNode` URL loops when `el.currentSrc` is present and differs. This is a clone-only attribute (never written to the live page — same discipline as nid). The renderer prefers `data-ps-currentsrc` when present.
2. **`media-src`/`img-src` CSP for media posters is fine, but video element *loading* needs `media-src`** — see Pattern 4.
3. **Masking interaction (privacy).** Asset URLs can themselves be sensitive (signed CDN URLs, per-user media). The existing `blockSelector` already replaces matched subtrees with dimension-only placeholders (`replaceWithBlockPlaceholder`, `src/capture/index.js:2356`) — a `<video>` under a `blockSelector` already becomes an empty sized `<div>` carrying only `rr_width`/`rr_height`. **No new masking primitive is required for "hide this media entirely."** What IS new: a host that wants to mirror the *element* but suppress the *URL*. Recommend a capture option `maskAssetUrls` / `maskAssetUrlFn(url, el)` routed through a new `sanitizeForWire('media-url', {url, el})` dispatch so URL suppression uses the same fail-closed chokepoint as text/input masking (`src/capture/index.js:2741`). Default off = byte-identical wire.

**Trade-offs:** Pro — minimal new code, reuses the proven absolutify + scheme-check + truncation budget machinery, no new relay/envelope risk. Con — `currentSrc` enrichment touches three serialization sites (must stay parity-clean for the differential oracle, `tests/differential/`); the divergence must be ledgered.

**Example (the `currentSrc` enrichment, clone-only, in the `serializeDOM` URL loop):**
```js
// after the existing URL_ATTRS absolutify loop in serializeDOM (line ~3256)
if ((tag === 'img' || tag === 'video' || tag === 'audio' || tag === 'source')
    && orig.currentSrc) {
  var resolved = absolutifyUrl(orig.currentSrc, document);  // reuse existing helper
  if (resolved && !hasDangerousScheme(resolved)) {
    cl.setAttribute('data-ps-currentsrc', resolved);        // clone-only; live page untouched
  }
}
// sanitizeForWire('element', ...) re-runs after this and scheme-checks final values (line ~3280)
```

---

### Pattern 2: The media-sync channel is a throttled side channel — a twin of the scroll tracker

**What:** A new `STREAM.MEDIA` side channel that periodically broadcasts the playback state of tracked `<video>/<audio>` elements, addressed by nid, identity-stamped, throttled — structurally identical to `startScrollTracker` (`src/capture/index.js:4211`).

**When to use:** Phase 2 (video/audio URL + sync). Depends on Phase 1 (the element + its URL must already be on the wire and indexed by the renderer before sync can address it).

**Why a side channel and not a DIFF_OP:** Playback state is *high-frequency, lossy-tolerant, and not structural*. Carrying it as `attr`/`value` diff ops would (a) pollute the rAF mutation batch, (b) require the MutationObserver to observe properties it can't see (`currentTime` is a *property*, not an attribute — MutationObserver never fires on it), and (c) make stale playback frames look like structural drift. The scroll channel already proves the pattern: a property/viewport fact that the observer cannot see, broadcast on its own throttled cadence, applied best-effort by the viewer. `currentTime` is the scroll-position of media.

**State it carries (`MediaStatePayload`):** per tracked media element —
- `nid` (string) — addresses the `<video>/<audio>` via the renderer's identity index
- `currentTime` (number, seconds)
- `duration` (number, seconds; may be `Infinity` for live — send `null` then)
- `paused` (boolean)
- `ended` (boolean)
- `playbackRate` (number)
- `seeking` (boolean)
- `readyState` (number, 0-4 — lets the viewer avoid seeking before metadata)
- `currentSrc` (string, optional) — so a mid-stream source switch (quality change) is observable without a full snapshot
- batch wrapper: `{ media: MediaStatePayload[], streamSessionId, snapshotId }` (identity stamped exactly like every other payload via `attachStreamMetadata` / the scroll channel's inline stamping)

**Cadence / throttle:** A timestamp throttle like scroll (`MEDIA_SYNC_THROTTLE_MS`). Recommend **250 ms (4 Hz)** as the steady-state default — fast enough that drift correction is invisible, slow enough to stay far under the cap and not flood the relay. *Plus* immediate (throttle-bypassing) emits on discrete transitions: `play`, `pause`, `seeked`, `ratechange`, `ended`, `loadedmetadata` (these are user-perceptible state flips; the scroll channel has no analog, but the overlay channel's `force` parameter is the precedent — `broadcastOverlayState(force)` at `src/capture/index.js:4267`). Continuous `timeupdate` (the browser fires it ~4 Hz anyway) drives the throttled steady-state emit.

**Implementation seam:** Listeners attach in `startMediaSyncTracker()`, called from `start()`/`resume()` next to `startScrollTracker()` (`src/capture/index.js:4331,4373`) and torn down in `stop()`/`pause()` next to `stopScrollTracker()`. Because media elements come and go, the tracker must attach to *current* media elements at start and to *newly added* media elements discovered in `processAddedNode` (it already walks the added subtree — add a hook to register media listeners there). Use the existing `getTrackedNodeId(el)` to stamp `nid`; skip elements under `skipElement`/`blockSelector`/`wireDropped` using the existing ancestor-inclusive predicates so masked media never leaks playback state.

**1 MiB cap / raw-relay compliance:** A media batch is tiny (a handful of numbers per element). Even hundreds of media elements stay far under cap. No truncation logic needed, but for safety the send should reuse the `wireByteLength` guard pattern (`src/capture/index.js:2421`) and, if ever over cap, drop the batch with a `logger.warn` (the relay would drop it anyway via `checkRelayFrameLimit`). The frame compresses through `encodeWireMessage` like any other and is forwarded byte-verbatim by the relay (`src/relay/relay.js:108` `receive` -> `sendToTargets`). **Envelope back-compat is automatic**: a new `type` string needs no envelope change; old FSB viewers simply ignore an unknown `STREAM.MEDIA` type (the renderer `dispatch` switch has a silent `default` — `src/renderer/index.js:1277`), so this is forward/backward compatible by construction.

**Trade-offs:** Pro — isolates lossy high-frequency data from the structural diff stream; reuses scroll/overlay throttle+identity discipline; zero relay/envelope change; gracefully ignored by old viewers. Con — playback state is point-in-time and the network adds latency, so the viewer MUST apply with drift tolerance (Pattern 3), never hard-seek on every frame.

**Example (the tracker, scroll-channel twin):**
```js
function startMediaSyncTracker() {
  stopMediaSyncTracker();
  lastMediaSyncSend = 0;
  function emit(force) {
    var now = Date.now();
    if (!force && now - lastMediaSyncSend < MEDIA_SYNC_THROTTLE_MS) return;
    lastMediaSyncSend = now;
    var media = [];
    trackedMediaElements.forEach(function (el) {          // WeakSet/Set populated at start + processAddedNode
      var nid = getTrackedNodeId(el);
      if (!nid) return;
      if (skipElementWithAncestors(el) || blockedWithAncestors(el)) return;  // masked media: no state
      media.push({
        nid: nid, currentTime: el.currentTime || 0,
        duration: isFinite(el.duration) ? el.duration : null,
        paused: !!el.paused, ended: !!el.ended,
        playbackRate: el.playbackRate || 1, seeking: !!el.seeking,
        readyState: el.readyState || 0, currentSrc: el.currentSrc || ''
      });
    });
    if (!media.length) return;
    safeSend(STREAM.MEDIA, {
      media: media, streamSessionId: streamSessionId || '', snapshotId: currentSnapshotId || 0
    });
  }
  // throttled steady-state via timeupdate; forced emit on discrete transitions
  // (play/pause/seeked/ratechange/ended/loadedmetadata) -> emit(true)
}
```

---

### Pattern 3: Viewer applies sync with drift tolerance, never a hard per-frame seek

**What:** The viewer treats `STREAM.MEDIA` as a *target* and nudges the local media element toward it: correct `paused`/`playbackRate` immediately (cheap, imperceptible), but only `seek` when the |local − remote| time gap exceeds a tolerance, and prefer rate-trim over seeking for small drift.

**When to use:** Phase 2, viewer side. This is the counterpart to `handleScroll` (`src/renderer/index.js:1197`) which already does best-effort smooth follow.

**The reconciliation algorithm (in `handleMedia` -> per-element `installMedia`/`syncMedia`):**
1. Resolve `nid` via the renderer identity index (`resolveIndexedNode`, `src/renderer/index.js:669`) to the in-iframe `<video>/<audio>`. Miss -> count + ignore (no resync churn; media state is not structural).
2. `paused`/`ended`: if remote paused and local playing -> `pause()`; if remote playing and local paused -> attempt `play()` (autoplay-policy aware, Pattern 4). Immediate.
3. `playbackRate`: set directly if different. Immediate.
4. `currentTime`: compute `drift = local.currentTime - remote.currentTime` (account for one-way latency if the payload carries a capture timestamp — the envelope already stamps `ts` per message at `src/transport/websocket.js:447`; the viewer can estimate latency from `lastReceiveAt`). Then:
   - `|drift|` ≤ **0.5 s** (recommended `MEDIA_DRIFT_SEEK_THRESHOLD`): do nothing, or trim `playbackRate` by a few percent for one interval (soft correction).
   - `|drift|` > threshold: `currentTime = remote + estimatedLatency` (hard seek). Guard on `readyState >= HAVE_METADATA` so seeks before metadata don't throw.
   - `seeking === true` on the remote: hold local position (the user is scrubbing on the source); apply the landing position on the next non-seeking frame.
5. `currentSrc` changed vs. what the viewer mounted: re-mount the source (a quality switch or source change) — for native, set `mediaEl.src`; for adaptive, hand the new manifest to the parent player.

**Drift tolerance rationale:** Hard-seeking on every 250 ms frame would cause audible/visible stutter and fight the element's own playback clock. The threshold + rate-trim approach is the standard "media clock follower" technique and matches the scroll channel's "smooth follow, store-latest" philosophy.

**Trade-offs:** Pro — smooth, latency-robust, cheap in the common case. Con — perfect frame-accurate sync is impossible by reference (bytes arrive from the CDN independently); v2.0's contract is *plausible* sync (within tolerance), which is correct for an observability mirror, not a frame-locked broadcast.

---

### Pattern 4: Player placement straddles the sandbox boundary — native in-iframe, adaptive in-parent

**What:** Decide *where the player runs* by source type, governed entirely by the no-`allow-scripts` constraint.

**Native / progressive (`.mp4`, `.webm`, `.ogg`, direct `<video src>`/`<source src>`):**
- The `<video>/<audio>` element is already in the srcdoc from the snapshot/add HTML. The browser's built-in media element plays it with **no script** — fully inside the sandbox. The parent realm only needs to (a) ensure the element has a usable `src`/`currentSrc` (prefer `data-ps-currentsrc`), and (b) drive sync by writing `currentTime/paused/playbackRate` directly onto `iframe.contentDocument`'s element (same cross-realm write the diff applier already does). **Player code: none.**

**Adaptive (HLS `.m3u8`, DASH `.mpd`) where the browser lacks native support:**
- Safari plays HLS natively (native path applies). Chrome/Firefox do not play HLS/DASH natively and need hls.js/dash.js + MSE.
- **MSE requires JS in the element's document.** Since the iframe has no scripts, the player runs in the **parent `createViewer` realm** (`src/renderer/media.js`) and binds to the in-iframe element cross-realm. Concretely: create `MediaSource` in the parent, `iframe.contentDocument`'s `videoEl.src = URL.createObjectURL(mediaSource)`, and let hls.js/dash.js (instantiated in the parent, pointed at the iframe element) append segments. This works **only** because `allow-same-origin` keeps the documents mutually scriptable from the parent. The hls.js `attachMedia(videoEl)` call receives the iframe's element reference.
- **Lazy-load the player.** hls.js/dash.js are large; load them only when an adaptive `currentSrc`/manifest hint appears, keeping the zero-dependency default path intact (the framework must not ship a mandatory heavy dep — PROJECT.md tech-stack constraint). Make the adaptive player a **host-injected option** (`createViewer({ mediaPlayers: { hls, dash } })`) so the *host* supplies hls.js/dash.js if it wants adaptive, mirroring the injected-codec/`fetchStylesheet` seam philosophy. Default absent = adaptive sources fall back to poster + a "media not mirrorable" affordance.

**Autoplay-policy reconciliation:**
- Browsers block autoplay with sound. The viewer's `play()` attempts (from sync) will reject. Handle exactly like the existing best-effort try/catch sites (e.g. `scrollTo` is wrapped at `src/renderer/index.js:1151`): catch the rejected `play()` promise, and on failure (a) start muted (muted autoplay is allowed) if the host opted into autoplay, or (b) leave paused and show a play overlay in the **host overlay layer** (not in the iframe — overlays already live in the parent, `overlays.layer` at `src/renderer/index.js:271`). A user gesture on the host overlay then calls `play()` on the iframe element. This keeps interaction in the trusted parent realm.

**CSP changes required (`CSP_META`, `src/renderer/snapshot.js:57`):**
- Add `media-src http: https: blob:` (blob: for the parent-created `MediaSource` object URL bound to the iframe element).
- Add `connect-src http: https:` **only if** adaptive segment fetches are issued *from the iframe context* — but in this design the parent fetches segments (hls.js runs in parent), so the iframe likely needs only `media-src ... blob:`. Verify empirically: if a `blob:` MSE source still triggers a `media-src` check in the child, `blob:` in `media-src` covers it. **Do not** broaden `default-src`; keep script-blocking untouched (the doc comment at `snapshot.js:50-55` already established the precedent for narrow, documented CSP widening for fidelity — `style-src` was widened for stylesheet links with a rationale; `media-src` follows the same pattern).

**Trade-offs:** Pro — native playback is free and safe; adaptive is possible without ever weakening the sandbox; heavy deps stay opt-in. Con — adaptive playback is the most complex piece and is explicitly *best-effort* in scope; cross-realm MSE binding has browser-quirk risk and must be threat-reviewed (the parent now creates object URLs that the child consumes — but the child still can't run scripts, so the blast radius is bounded to "what a `<video>` element can do").

**Example (player placement decision, `src/renderer/media.js`):**
```js
function installMedia(iframeDoc, mediaPayload, parentRealm) {
  var el = resolveIndexedNode(mediaPayload.nid);            // in-iframe <video>/<audio>
  if (!el) return;
  var src = mediaPayload.currentSrc || el.getAttribute('data-ps-currentsrc') || el.currentSrc;
  if (isAdaptive(src) && !canPlayNatively(el, src)) {
    if (!parentRealm.mediaPlayers || !parentRealm.mediaPlayers.hls) {
      showPosterFallback(el);                                // graceful: no adaptive player supplied
      return;
    }
    var hls = new parentRealm.mediaPlayers.hls();            // runs in PARENT realm
    hls.loadSource(src);
    hls.attachMedia(el);                                     // binds to the in-iframe element cross-realm
  }
  // native: nothing to do; the element plays itself in-sandbox
}
```

---

### Pattern 5: Adapter-fed out-of-band manifest discovery (the `fetchStylesheet` precedent)

**What:** HLS/DASH manifests are frequently fetched by the page's own JS and never appear as an element `src` (the page passes the URL straight to hls.js). The DOM capture cannot see them. Adapters that *can* observe the network surface these URLs as out-of-band asset references keyed by nid, fed into capture as hints.

**When to use:** Phase 3 (adaptive/fallback/adapter discovery). Strictly additive and optional — graceful absence is mandatory.

**The seam:** Mirror `fetchStylesheet({href,scope,ownerKind})` (`src/capture/index.js:1191`). Add a capture option `mediaSourceHints` — either a host-pushed registry or a pull hook — that maps a media element (by nid or by matching the element to an observed request) to a discovered manifest URL. The `collectMediaState` reader and the snapshot's media enrichment consult it: if a `<video>` has no usable element `src`/`currentSrc` but a hint exists, emit the hint as `currentSrc` (so the viewer's adaptive path can pick it up).

**Playwright/CDP discovery (`src/adapters/playwright.js`):** The adapter already owns a CDP session (`ensureCDPSession`, `cfg.cdpSessionFactory`, line 210) and a binding bridge that forwards `STREAM.*` types from the page (line 183 `bindingCallback`). Add (opt-in) CDP `Network.enable` + listen for `Network.responseReceived` where `mimeType` is `application/vnd.apple.mpegurl`, `application/x-mpegURL`, or `application/dash+xml` (or URL ends in `.m3u8`/`.mpd`). Correlate the request's initiator/frame to a media element when possible; push the URL into the injected capture via the existing `page.evaluate(window.__phantomStreamHandleControl...)` channel (line 265) or a new `window.__phantomStreamMediaHint(url, hint)` exposed function. This is the natural home because the Playwright adapter is already the privileged, network-capable boundary.

**Extension MV3 discovery (`src/adapters/extension.js`):** Use `chrome.webRequest.onResponseStarted` (manifest MIME/extension match) or a page-world `PerformanceObserver` for `resource` entries, posting hints to the content script. Same hint shape.

**Graceful absence:** If no adapter provides hints (bookmarklet, embedded SDK, extension without the permission), media-by-reference degrades to *exactly today's behavior plus native progressive playback*: elements with a direct `src`/`currentSrc` play; MSE-only/manifest-only videos show the poster (already captured via `poster` in `URL_ATTRS`) and a non-mirrorable affordance. **No errors, no broken mirror.** This satisfies the scope statement ("best-effort HLS/DASH manifest URLs; MSE-without-manifest + DRM/EME out (poster fallback)").

**Trade-offs:** Pro — keeps the core free of hidden network observation (privacy + zero-dep purity, enforced by `tests/capture-purity.test.js`); puts discovery where the privilege already lives. Con — correlation of a network request to a specific media element is heuristic (initiator chains are imperfect); when correlation fails, the hint can still be offered to *any* unmatched adaptive element on the page, accepting some imprecision for best-effort.

---

## Data Flow

### Static asset flow (Phase 1) — rides existing snapshot/diff

```
live <img>/<video poster>/<source>     serializeDOM / processAddedNode
   ├─ URL_ATTRS absolutify ───────────►  cl.setAttribute(src|poster, absolute)
   ├─ absolutifySrcset ───────────────►  cl.setAttribute(srcset, absolute)
   ├─ [NEW] data-ps-currentsrc ───────►  resolved currentSrc (clone-only)
   └─ sanitizeForWire('element') ─────►  scheme-checked, on*-stripped, KEPT
        │
        ▼ snapshot.html / add-op.html  (identity in nodeIds sidecar)
   relay (verbatim) ──► renderer buildSnapshotHtml / diff applyMutations ADD
        │
        ▼ srcdoc iframe (sandbox, [NEW media-src/img-src CSP])
   <img>/<video poster> fetch bytes from CDN  (viewer-side fetch, never the wire)
```

### Media sync flow (Phase 2) — new side channel, scroll-channel-shaped

```
live <video> timeupdate/play/pause/seeked   startMediaSyncTracker
        │ throttle 250ms (force on transitions)
        ▼ STREAM.MEDIA { media:[{nid,currentTime,paused,rate,...}], identity }
   encodeWireMessage (deflate-raw if >1KB) ──► relay (verbatim, classify type) ──►
   renderer dispatch -> handleMedia (identity + streaming gate)
        │ resolveIndexedNode(nid) -> in-iframe <video>
        ▼ syncMedia: drift-tolerant reconcile (paused/rate immediate; seek if |drift|>0.5s)
   parent realm writes iframe.contentDocument videoEl.{currentTime,paused,playbackRate}
```

### Adaptive flow (Phase 3) — discovery + parent-realm player

```
page JS fetches manifest (not in DOM)        adapter CDP/webRequest observes
        │                                          │ .m3u8/.mpd MIME match
        │                                          ▼ window.__phantomStreamMediaHint(url)
        ▼ capture mediaSourceHints registry ── enriches <video> currentSrc on wire
   STREAM.SNAPSHOT/MEDIA carries adaptive currentSrc
        ▼ renderer handleMedia -> isAdaptive && !native
   PARENT realm: new hls.js(); hls.loadSource(url); hls.attachMedia(iframeVideoEl)
        │ (MediaSource created in parent, object URL bound to in-iframe element)
        ▼ segments fetched BY PARENT from CDN; appended to SourceBuffer; element plays in-sandbox
```

### State management

```
Capture closure state (src/capture/index.js):
  trackedMediaElements (Set, [NEW])  lastMediaSyncSend (number, [NEW])
   ↑ populated at start() and in processAddedNode; cleared in stop()/clearNodeMirror
  mediaSourceHints (Map nid->url, [NEW], adapter-fed)

Renderer closure state (src/renderer/index.js):
  nidToNode (Map, EXISTING) — resolves media nid to in-iframe element
  [NEW] mediaControllers (Map nid->{player?, lastTarget}) — per-element adaptive player + last sync target
   ↑ cleared in handleSnapshot/clearIdentityIndex (new generation) and destroy()
```

---

## Scaling Considerations

| Scale | Architecture adjustments |
|-------|--------------------------|
| 1 media element, progressive | Native in-iframe playback + 4 Hz sync. No player code. Trivial. |
| Many media elements (gallery, autoplaying feed) | Media batch stays tiny (numbers only); cap is a non-issue. Throttle the *aggregate* batch, not per-element. Consider only emitting state for elements that are actually playing (skip `paused && currentTime===0`) to cut noise. |
| Adaptive (HLS/DASH) | One hls.js/dash.js instance per *playing* adaptive element in the parent realm; dispose on `rm`/snapshot-replacement (`removeIndexedSubtree` already fires — hook player teardown there). Lazy-load the player lib once, reuse the class. |
| Live streams (`duration===Infinity`) | Sync `currentTime` is meaningless against a live edge; switch to "follow live edge" mode (seek to `seekable.end`) and suppress drift seeks. Carry `duration:null` as the live signal. |

### Scaling priorities

1. **First bottleneck: redundant seeks.** Naive per-frame seeking stutters even a single video. Fix = drift threshold + rate-trim (Pattern 3) before anything else.
2. **Second bottleneck: adaptive player lifecycle leaks.** A `<video>` removed by a diff while hls.js is attached leaks the player + buffers. Fix = tie player teardown to the existing `removeIndexedSubtree`/snapshot-replacement path so player disposal is automatic with identity eviction.

---

## Anti-Patterns

### Anti-Pattern 1: Routing playback state through DIFF_OP / MutationObserver

**What people do:** Try to capture `currentTime` as an `attr` diff or expect the MutationObserver to report playback changes.
**Why it's wrong:** `currentTime`/`paused`/`playbackRate` are **properties, not attributes** — MutationObserver never fires for them (the existing `value` channel exists precisely because the observer can't see form-control *properties* either, `src/capture/index.js` value capture). Forcing them into the diff stream pollutes the rAF structural batch and makes lossy point-in-time data look like structural drift, tripping the stale-miss resync threshold.
**Do this instead:** A dedicated throttled side channel (`STREAM.MEDIA`), the scroll/overlay/value pattern.

### Anti-Pattern 2: Running hls.js/dash.js inside the srcdoc iframe

**What people do:** Inject the adaptive player into the mirror document to "make video just work."
**Why it's wrong:** It requires `allow-scripts`, which **breaks the entire published-framework threat model** (the iframe renders attacker-influenced HTML; `createViewer` hard-asserts no `allow-scripts` and throws otherwise, `src/renderer/index.js:209-213`). Any design that needs scripts in the mirror is dead on arrival.
**Do this instead:** Run the player in the parent viewer realm and drive the in-iframe element cross-realm (`allow-same-origin` makes it scriptable from the parent). Native progressive playback needs no scripts at all.

### Anti-Pattern 3: Streaming media bytes over the wire

**What people do:** Proxy video bytes through the capture -> relay -> viewer path "for completeness."
**Why it's wrong:** It detonates the 1 MiB per-message cap, the raw-relay byte-verbatim contract, and the entire low-bandwidth value proposition (PROJECT.md Core Value). It also re-introduces exactly the pixel-streaming the framework exists to avoid.
**Do this instead:** Media by *reference* only — wire carries URLs + small playback state; the viewer fetches bytes from the source/CDN. This is the v2.0 thesis; never violate it.

### Anti-Pattern 4: Broadening `default-src` or adding `script-src` to the mirror CSP

**What people do:** Loosen the srcdoc CSP wholesale to get media working quickly.
**Why it's wrong:** It weakens the script-blocking backstop that, together with the sandbox, contains hostile captured HTML.
**Do this instead:** Add *only* `media-src http: https: blob:` (and `connect-src` only if proven necessary), with a documented rationale comment exactly like the existing `style-src` widening (`src/renderer/snapshot.js:50-62`). `default-src 'none'` and the absence of `script-src` stay untouched.

### Anti-Pattern 5: Hidden network fetches in the capture core for manifest discovery

**What people do:** Make the capture core sniff/fetch the network to find manifests.
**Why it's wrong:** Violates the zero-dependency, no-hidden-fetch purity contract (grep-enforced by `tests/capture-purity.test.js`; the CSSOM `fetchStylesheet` design explicitly avoids this — docs/ARCHITECTURE.md 2.5).
**Do this instead:** Adapters that already hold network privilege (CDP, webRequest) push hints in via an optional injected hook; the core stays observation-free and degrades gracefully when no adapter supplies hints.

---

## Integration Points

### Internal boundaries (named, against real files)

| Boundary | Communication | Notes / exact site |
|----------|---------------|--------------------|
| capture serialize ↔ asset URLs | in-process | `serializeDOM` (`src/capture/index.js:3133`), `processAddedNode` (:3491), mutation `attr` branch (:3826) — extend `URL_ATTRS` handling + `data-ps-currentsrc` |
| capture ↔ sanitize chokepoint | in-process function call | `sanitizeForWire` (:2741): add `'media-url'`/`'media-state'` dispatch kinds for URL masking; media tags already pass (not in drop set) |
| capture ↔ media side channel | `transport.send(STREAM.MEDIA, payload)` | new `startMediaSyncTracker`/`stopMediaSyncTracker`, wired in `start`/`stop`/`pause`/`resume` (:4315-4375) next to scroll tracker |
| protocol contract | type + typedef | `STREAM.MEDIA` (`src/protocol/messages.js:17`), `MediaStatePayload` typedef; `MEDIA_SYNC_THROTTLE_MS` (`src/protocol/constants.js`) |
| envelope/transport | unchanged | `encodeWireMessage`/`decodeWireMessage` (`src/transport/websocket.js`) compress/forward media frames like any frame |
| relay | unchanged | `receive`/`sendToTargets` (`src/relay/relay.js:108,210`) — `STREAM.MEDIA` is just a classified type string in diagnostics |
| renderer dispatch ↔ media | message dispatch | add `case STREAM.MEDIA: handleMedia(payload)` to `dispatch` switch (`src/renderer/index.js:1250`); identity + `viewerState==='streaming'` gate like `handleScroll` |
| renderer ↔ in-iframe media element | cross-realm DOM write | `resolveIndexedNode(nid)` (`src/renderer/index.js:669`) -> write `iframe.contentDocument` element props (same cross-realm access `handleMutations` uses at :1129) |
| renderer ↔ adaptive player | host-injected lib | `createViewer({ mediaPlayers })` option -> `src/renderer/media.js` runs hls.js/dash.js in parent realm, `attachMedia(iframeEl)` |
| renderer CSP | string assembly | `CSP_META` (`src/renderer/snapshot.js:57`) += `media-src http: https: blob:` |

### External services / adapter discovery

| Service | Integration pattern | Notes / exact site |
|---------|---------------------|--------------------|
| Chrome DevTools Protocol | `Network.enable` + `Network.responseReceived` MIME match -> hint | already have CDP session: `ensureCDPSession`/`cfg.cdpSessionFactory` (`src/adapters/playwright.js:210`); push via `page.evaluate(window.__phantomStreamMediaHint)` (precedent: `forwardSubtreeRequest` :265) |
| Chrome extension webRequest | `chrome.webRequest.onResponseStarted` MIME/ext match -> hint to content script | `src/adapters/extension.js` (additive, permission-gated) |
| CDN / media origin | viewer-side `fetch`/element load | the viewer (or parent-realm player) fetches bytes; never the wire — this is the whole point |
| hls.js / dash.js | host-supplied via `mediaPlayers` option | keep the framework zero-mandatory-dep; adaptive is opt-in (PROJECT.md tech-stack constraint) |

---

## Build Order (phase decomposition with dependencies)

Sequenced so every phase is independently runnable and demoable, dependencies flow forward, and the sandbox/security boundary is respected at each step. Each phase ends green against `node --test` + the differential oracle (`tests/differential/`).

**Phase A — Static assets by reference (foundation, lowest risk).**
- Verify `<img>/<picture>/<source>/<video poster>/<audio>/svg <image>` already serialize + absolutify + survive both sanitizers (they do — this phase is mostly tests + the small gaps).
- Add `data-ps-currentsrc` clone-only enrichment in the three serialization paths; ledger the divergence for the oracle.
- Add `media-src`/confirm `img-src` in `CSP_META` so video posters and image assets fetch in-sandbox.
- Add optional `maskAssetUrls`/`maskAssetUrlFn` via a `sanitizeForWire('media-url')` dispatch (default off, byte-identical).
- **Runnable demo:** loopback page with images + a `<video poster>` mirrors with assets loading from source. No playback yet.
- **Depends on:** nothing (rides existing pipeline). **Unblocks:** B (elements + URLs must be indexed before sync can address them).

**Phase B — Video/audio URL + playback sync (the core new capability).**
- Protocol: `STREAM.MEDIA` + `MediaStatePayload` + `MEDIA_SYNC_THROTTLE_MS`.
- Capture: `trackedMediaElements` registry (populate at `start()` + `processAddedNode`), `collectMediaState()`, `startMediaSyncTracker()`/`stopMediaSyncTracker()` wired into lifecycle next to scroll; masked/ blocked media emit no state.
- Renderer: `handleMedia` dispatch case; native progressive playback drives the in-iframe element directly; drift-tolerant `syncMedia` (Pattern 3); autoplay-policy handling via host overlay play affordance.
- **Runnable demo:** loopback page with a progressive `.mp4` — viewer plays it from the CDN and follows play/pause/seek within tolerance. Old-viewer compatibility verified (unknown type ignored).
- **Depends on:** A. **Unblocks:** C (adaptive reuses the media element + sync channel; only the source-binding mechanism differs).

**Phase C — Adaptive (HLS/DASH) + adapter discovery + fallback.**
- Renderer: `src/renderer/media.js` — `isAdaptive` detection, lazy host-supplied `mediaPlayers` (hls.js/dash.js) running in the **parent realm** binding cross-realm to the in-iframe element; poster fallback when no player supplied or MSE-only/DRM (out of scope by design).
- Capture: `mediaSourceHints` registry + `window.__phantomStreamMediaHint` hook.
- Adapters: Playwright/CDP `Network` manifest discovery; extension `webRequest` discovery. Both opt-in; graceful absence proven.
- **Runnable demo:** Playwright-driven page playing an HLS stream; adapter discovers the `.m3u8`, viewer plays it via parent-realm hls.js. Bookmarklet/embedded path proven to degrade to poster gracefully.
- **Depends on:** B (media element + sync channel). **Unblocks:** D.

**Phase D — Security hardening, masking completeness, docs, eval.**
- Threat-review the parent-realm MSE cross-realm binding (object-URL blast radius; confirm the child still cannot script). Re-run the security chokepoint purity + sanitize tests; add media-specific cases (hostile `<source src=javascript:>`, `media-src` CSP coverage, masked-media-no-state).
- Document the no-`allow-scripts` player-placement rule and the `media-src` CSP widening rationale in `docs/SECURITY.md`/`docs/ARCHITECTURE.md` (update limitation #6 — `<video>`/`<audio>` is no longer fully out).
- Evaluation harness arm: media-by-reference bandwidth/latency vs. CDP screencast/WebRTC (PROJECT.md paper).
- **Depends on:** A-C. Closes the milestone.

**Dependency summary:** A → B → C → D (strict chain on capability), with the protocol/constant additions front-loaded into B and the relay/envelope **never touched**. The two genuinely independent-of-each-other pieces inside C are the renderer adaptive player and the two adapter discovery integrations (Playwright vs. extension) — those can parallelize.

---

## Sources

- `src/capture/index.js` — `URL_ATTRS` (line 61), `CURATED_PROPS`/`SHELL_PROPS` `background-image` (109/138), `sanitizeForWire` chokepoint (2741), `absolutifyUrl`/`absolutifySrcset` (3008/3025), `serializeDOM` (3133), `processAddedNode` (3491), `processMutationBatch` attr branch (3826), `startScrollTracker` (4211), `broadcastOverlayState(force)` (4267), lifecycle `start/stop/pause/resume` (4315-4375), masking/block helpers (2086-2395), `fetchStylesheet` CSSOM adapter hook (1191), `scopeFrameDiff`/`frameNid` (1693)
- `src/protocol/messages.js` — `STREAM`/`DIFF_OP` namespaces, identity stamping, `isCurrentStream`
- `src/protocol/constants.js` — `RELAY_PER_MESSAGE_LIMIT_BYTES` (1 MiB), `SCROLL_THROTTLE_MS`/`OVERLAY_THROTTLE_MS` (sync-cadence precedent)
- `src/transport/websocket.js` — `encodeWireMessage`/`decodeWireMessage` (`{_ps:'deflate-raw'}` + legacy `{_lz}`), per-message `ts` stamp (447)
- `src/relay/relay.js` — `receive`/`checkRelayFrameLimit`/`sendToTargets` (raw byte-verbatim fan-out, cap, type classification)
- `src/renderer/index.js` — sandbox assertion `allow-same-origin` only (209-213), post-parse `sanitizeFragment` scrub on load (226), `dispatch` switch + silent default (1250-1279), `handleScroll` best-effort follow (1197), `handleMutations` cross-realm `iframe.contentDocument` write (1129), `resolveIndexedNode` identity index (669), `overlays.layer` parent-realm overlays (271)
- `src/renderer/snapshot.js` — `CSP_META` (57-62, no `media-src` today; documented `style-src` widening precedent 50-55)
- `src/renderer/sanitize.js` — `DROP_TAGS` (57, media tags absent → kept), `URL_ATTRS` incl. `poster`/`src`/`data` (62), `sanitizeAttrValue`/`sanitizeFragment`
- `src/renderer/diff.js` — `applyMutations` ADD (template parse + `sanitizeFragment`) / ATTR (`sanitizeAttrValue`) branches
- `src/adapters/playwright.js` — CDP session `ensureCDPSession`/`cfg.cdpSessionFactory` (210), binding bridge `bindingCallback` forwarding `STREAM.*` (183), `forwardSubtreeRequest` via `page.evaluate` (265)
- `docs/ARCHITECTURE.md` — limitations #5 (sandbox/blocklist) and #6 (`<video>`/`<audio>` out of v1); `.planning/PROJECT.md` — Core Value, Constraints (no `allow-scripts`, zero-dep), Out of Scope (`<video>`/`<audio>` v1)

---
*Architecture research for: PhantomStream v2.0 media-by-URL + playback-sync integration*
*Researched: 2026-06-19*
