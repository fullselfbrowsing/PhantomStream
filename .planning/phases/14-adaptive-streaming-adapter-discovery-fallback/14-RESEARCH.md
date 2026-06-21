# Phase 14: Adaptive Streaming + Adapter Discovery + Fallback - Research

**Researched:** 2026-06-21
**Domain:** Cross-realm Media Source Extensions (MSE) binding; HLS/DASH adaptive playback in a sandboxed-mirror viewer; opt-in network-observation manifest discovery; never-break fallback taxonomy
**Confidence:** HIGH on the MSE attachment mechanism, native-HLS path, packaging, and all code anchors (verified against the W3C MSE spec, hls.js docs, npm, and the live codebase). MEDIUM on the manifest→element correlation heuristic (design is sound; real-network proof is a deferred UAT). LOW on nothing material.

## Summary

The one genuinely uncertain area — a renderer-owned **parent realm** creating a `MediaSource`, binding it to the **in-iframe** `<video>`, and feeding segments while the iframe stays `sandbox="allow-same-origin"` (no `allow-scripts`) — is **feasible, and the W3C spec ties the only hard restriction to ORIGIN, not Document identity** [CITED: w3.org/TR/media-source-2]. The mirror iframe is same-origin to its parent (the whole Phase 7/12/13 cross-realm-drive model depends on this), so a `blob:` MediaSource object URL minted in the parent is same-origin to the iframe element and resolvable by it. hls.js's `attachMedia()` takes an `HTMLMediaElement` directly with **no same-document requirement** [CITED: github.com/video-dev/hls.js/blob/master/docs/API.md], and hls.js runs entirely in the parent realm (the sandbox forbids it running anywhere else). This is exactly the Phase 13 pattern (parent calls methods on the inert child element) extended from "set `.currentTime`" to "set `.src = blob:` + feed SourceBuffers."

Because real frame-advancing playback **cannot be observed in this environment** (the FSB automation browser runs tabs hidden → Chrome suspends `<video>` byte-loading/decode; documented live in `13-HUMAN-UAT.md` and `13-VERIFICATION.md`), the entire binding must be built behind **feature detection** (`Hls.isSupported()` / `MediaSource` presence / `canPlayType`) with a **graceful fallback to poster + reason**. Failure → poster, never a break. Unit tests stub `MediaSource`/`Hls` in jsdom; live MSE playback is a documented deferred UAT (same precedent as Phase 13). The poster fallback is the never-break safety net, so the milestone is not at risk even if the spike fails in some browser — only the adaptive differentiator is.

The published package stays **zero-hard-runtime-dependency**: hls.js is an **optional `peerDependency`** (`peerDependenciesMeta["hls.js"].optional: true`), lazy-loaded via **dynamic** `import('hls.js')` *inside a function* — never a top-level import — because `scripts/package-smoke.mjs` does `await import('./renderer')` for every subpath and would fail if the renderer statically imported an uninstalled package. The primary contract is a host-provided `playerFactory(ctx) -> PlayerAdapter` seam (hls.js / dash.js / Shaka / native), so PhantomStream depends on none of them.

**Primary recommendation:** Build a new parent-realm `src/renderer/media-player.js` module exposing `createMediaPlayer({ doc, gateAsset, logger, playerFactory })` whose `attach(videoEl, manifestUrl, ctx)` runs the decision tree **native-HLS-first → host `playerFactory` → optional lazy hls.js → degrade-to-poster**, all behind feature detection, all `try/catch`-contained so any failure routes to `onMediaUnavailable(nid, reason)` + the new passive `media-unavailable` overlay. Add `STREAM.MEDIA_HINT` as a structural twin of `STREAM.MEDIA` in `src/protocol/messages.js`; emit it from the adapters' existing network hooks. Add `blob:` to `media-src` only.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Manifest URL discovery (network observation) | **Adapter** (Playwright `page.on('response')` / extension `chrome.webRequest`) | — | Only the adapter sees the network; the capture core never sniffs traffic (locked decision; `STATE.md` roadmap). `src/capture/` is untouched. |
| `STREAM.MEDIA_HINT` emission | **Adapter** | Protocol (op + typedef) | Hint originates where the network is observed, then rides the existing raw relay. Capture wire unchanged → no differential-oracle entry. |
| Adaptive player (HLS/DASH parse, segment fetch, SourceBuffer feed) | **Renderer parent realm** (`src/renderer/media-player.js`, new) | host `playerFactory` | Player code may NEVER run in the no-`allow-scripts` srcdoc iframe (catastrophic XSS regression; locked decision). Parent realm fetches segments → iframe needs no `connect-src`. |
| MSE `blob:` object URL minting | **Renderer parent realm** | — | The object URL's origin = the parent's relevant settings object at `createObjectURL()` time [CITED: w3.org/TR/media-source-2]; parent is same-origin to the iframe, so the URL resolves on the child `<video>`. |
| Native-HLS direct bind (`video.src = manifest`) | **Renderer** (sets the iframe element's `src` cross-realm) | — | Safari/native path needs no player and no MSE; the manifest URL passes the same origin gate and `media-src http: https:` (already present). |
| Playback sync (play/pause/seek/live-edge) | **Renderer** — REUSE Phase 13 `reconcileMediaDrift` + `applyMediaAction` | — | Adaptive reuses the Phase 13 driver verbatim; only the source-binding mechanism differs. |
| Fallback decision (no-manifest / drm / mse-opaque / no-player) | **Renderer** | host `onMediaUnavailable` callback | The viewer decides degradation; the reason surfaces via a config callback + passive overlay (the `onMediaBlocked` family). |
| Origin/scheme gate for manifest + segment URLs | **Renderer** — REUSE Phase 12 `gateAssetUrl` / `classifyAssetOrigin` | — | Manifest and segment URLs pass the same fail-closed https-only + private-range gate as Phase 12/13. |

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**hls.js Delivery & Player Seam (MADPT-01)**
- **Primary contract = a host-provided `playerFactory` config seam.** The published package adds **no bundled runtime player**; hosts inject their own (hls.js / dash.js / Shaka) via `playerFactory(ctx) -> PlayerAdapter`. Preserves the zero-runtime-dependency ethos.
- **Optional lazy hls.js** = an `import('hls.js')` attempt **only** when no `playerFactory` is provided AND hls.js is present as an installed **optional `peerDependency`** (`peerDependencies` + `peerDependenciesMeta.optional: true`). If the import fails, degrade gracefully (poster + reason) — never a hard error.
- **Native HLS first.** Feature-detect `video.canPlayType('application/vnd.apple.mpegurl')`; if native (Safari), bind the manifest URL **directly** to the element — no MSE, no library. Otherwise use the parent-realm MSE player.
- **DASH only via the host seam.** No bundled dash.js; absent a `playerFactory`, DASH degrades to poster with reason `no-player`.
- **Binding mechanism.** The parent realm creates `MediaSource`, sets the in-iframe `<video>.src = URL.createObjectURL(mediaSource)` cross-realm, and (for hls.js) `attachMedia(iframeVideoEl)` from the parent; the Phase 13 reconciler still drives play/pause/seek. The MSE player initializes from the same snapshot `media[]` baseline (`applyMediaBaseline`). Sandbox stays exactly `allow-same-origin`.

**Adapter Manifest Discovery (MADPT-02)**
- **Mechanism = opt-in network observation, off by default.** Playwright via `page.on('response')` (and/or CDP `Network.responseReceived`); extension via `chrome.webRequest.onCompleted` (or `chrome.debugger` Network), filtering `.m3u8`/`.mpd` by extension + content-type.
- **manifest→element correlation = best-effort.** Use initiator/frame + timing + a single-active-media heuristic; when ambiguous, emit the hint as **page-level** and let the viewer match it to an MSE-opaque media element on play. Never block on perfect correlation.
- **Hint transport = a new opt-in `STREAM.MEDIA_HINT` op** (a structural twin of `STREAM.MEDIA`): nid-or-page addressed, identity-stamped (`streamSessionId`, `snapshotId`), within the raw-relay + 1 MiB cap, **backward-compatible** (old viewers ignore the unknown type; relay + envelope unchanged).
- **Graceful absence is mandatory.** Discovery is fully opt-in; with no adapter and no hints, the viewer plays **native-progressive-only with zero errors** (the Phase 13 path is intact).

**Fallback & Never-Break (MADPT-03, MADPT-04)**
- **Reason surface = a new `onMediaUnavailable(nid, reason)` config callback** (the `onMediaBlocked` family, NOT the throwing `on()` allowlist) **plus a passive `media-unavailable` overlay** (a sibling of the poster/blocked affordances, `textContent` only). Reason codes: `no-manifest` (MSE/`blob:` source with no discoverable manifest), `drm` (EME/encrypted), `mse-opaque` (MSE bind failed), `no-player` (DASH/unsupported with no `playerFactory`).
- **Degradation target = the element's poster if present, else the dimensioned placeholder** (the Phase 12 `data-ps-asset-unavailable` mechanism) — never a broken/empty element. The mirror never breaks.
- **Live streams reuse the reconciler live branch** (infinite/NaN duration → rejoin-edge, no absolute seek). The player binds the live manifest; the reconciler does live-edge sync.
- **DRM/EME detection = immediate degrade.** Detect via the `encrypted` event / an EME key-system request / HLS `#EXT-X-KEY` → poster + reason `drm`; never attempt to mirror protected content.

**Security / CSP for the Parent-Realm Player (threads into Phase 15)**
- **`media-src` gains `blob:` only** (for the MSE object URL). Keep `default-src 'none'`, **no `script-src`**, and the sandbox token unchanged.
- **The parent realm fetches all segments** (the player runs in the parent and fetches via the parent's `fetch`/XHR), feeding the `SourceBuffer`; the in-iframe element only plays the blob → the **iframe needs no `connect-src`**. Verify empirically; parent-fetch is the default (keep `default-src 'none'`/no `script-src` regardless of the finding).
- **Same fail-closed origin gate.** Manifest URLs and segment URLs pass the **same** `assetOriginPolicy` / `classifyAssetOrigin` gate as Phase 12/13 (https-only, block private/internal ranges); a manifest from a blocked origin → poster.
- **Object-URL blast radius is documented here, threat-modeled in Phase 15** (MSEC-04).

### Claude's Discretion
- Exact `STREAM.MEDIA_HINT` op value and `MediaHintPayload` typedef shape (follow the `STREAM.MEDIA`/`MediaSyncPayload` conventions from Phase 13).
- `PlayerAdapter` interface shape (e.g. `{ attach(el, manifestUrl, ctx), destroy(), onError }`) and `playerFactory` ctx — keep minimal and host-friendly.
- Whether the optional hls.js lazy import is wired now or left as a documented `playerFactory` example only (prefer whichever keeps the published module provably zero-runtime-dep and the test suite jsdom-runnable).
- Internal naming of the parent-realm player module/helpers and the `media-unavailable` overlay markup, consistent with `src/renderer/` + `overlays.js` conventions.
- Whether a differential-oracle ledger entry is needed (likely none; confirm against the oracle).

### Deferred Ideas (OUT OF SCOPE)
- Parent-realm object-URL **threat model** completion + asset/media URL **masking vocabulary** (`maskMediaSelector`, `maskAssetUrls`) + `referrerpolicy="no-referrer"` completion → Phase 15 (MSEC-03, MSEC-04).
- Bundled DASH (dash.js) / Shaka — host-provided via `playerFactory` only; never bundled.
- Real-browser adaptive/MSE playback UAT (live-edge sync, segment fetch, DRM degrade observed in Chrome) → documented UAT, deferred (FSB runs tabs hidden; same precedent as Phase 13).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| MADPT-01 | Best-effort adaptive playback — HLS/DASH manifest URL → optional, lazy player in a renderer-owned **parent-realm** surface (never inside the mirror sandbox); only hls.js added (optional, lazy), DASH via host-provided-player seam | Cross-Realm MSE Binding section (the attachment mechanism, native-HLS-first branch, `PlayerAdapter`/`playerFactory` seam, optional lazy `import('hls.js')`); Packaging section (optional peerDependency, dynamic-import-only constraint). Anchors: new `src/renderer/media-player.js`; reuse `handleMedia`/`applyMediaAction`/`applyMediaBaseline`/`resolveIndexedNode` in `src/renderer/index.js`. |
| MADPT-02 | Adapters surface manifest URLs not present as element `src` (network observation) → opt-in hints with graceful absence | Adapter Manifest Discovery section (`.m3u8`/`.mpd` filter by extension + content-type; manifest→element correlation heuristic; `STREAM.MEDIA_HINT` op + `MediaHintPayload`; page-level fallback; graceful-absence). Anchors: `src/adapters/playwright.js` `addPageListener`~217 → `page.on('response')`; `src/adapters/extension.js` `ensureCDPSession`~210 / `chrome.webRequest`. |
| MADPT-03 | Unreferenceable media (MSE/`blob:` w/o manifest, DRM/EME) degrades to poster/placeholder with observable, documented reason — never breaks | Fallback Taxonomy section (the four reason codes + detection); DRM/EME Detection (`encrypted` event, EME key request, `#EXT-X-KEY`, `KEY_SYSTEM_ERROR`); `onMediaUnavailable` + `media-unavailable` overlay (clone of `renderMediaPoster`); degrade-to-poster path reusing Phase 12 placeholder. Anchors: `src/renderer/overlays.js` `register`~433/`show`~701; `src/renderer/index.js` config-callback family ~341. |
| MADPT-04 | Live streams (infinite/NaN duration) handled — live-edge sync, no absolute seek | Live Handling section: REUSE the Phase 13 reconciler live branch (`rejoin-edge`, `seekable.length>0` guard) verbatim — `applyMediaAction`~1701 already implements it; the adaptive player binds the live manifest, the reconciler does live-edge sync. No new sync logic. |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| hls.js | 1.6.16 | OPTIONAL, lazy parent-realm HLS player (MSE-based) when no `playerFactory` and native HLS absent | The de-facto JS HLS-over-MSE library; `attachMedia()` takes a bare `HTMLMediaElement`, MSE-based, actively maintained (published 2026-06-17, 6.37M downloads/wk) [VERIFIED: npm registry]. **Optional peerDependency — never bundled, never a hard dep.** |
| (none else) | — | Zero new hard runtime deps; `dependencies` stays `{ ws }` | Locked: published module is zero-runtime-dep. DASH/Shaka are host-provided only. |

### Supporting (host-provided via `playerFactory`, NOT installed)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| dash.js | 5.2.0 | DASH (`.mpd`) playback | Host injects via `playerFactory` only; absent → DASH degrades to poster (`no-player`) [VERIFIED: npm registry — reference only, not a dep] |
| shaka-player | 5.1.10 | HLS+DASH+DRM playback | Host injects via `playerFactory` only; documented example [VERIFIED: npm registry — reference only, not a dep] |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `video.src = URL.createObjectURL(MediaSource)` | `video.srcObject = mediaSource` (handle-based) | `srcObject` is the modern path and avoids a leaked object-URL string, but **browser support for assigning a `MediaSource`/`MediaSourceHandle` to `srcObject` is narrower** than the universally-supported object-URL path, and hls.js itself uses the object-URL/`ManagedMediaSource` route internally [CITED: hls.js docs]. RECOMMENDATION: let hls.js own attachment (call `attachMedia(el)`); for the *manual* MSE fallback path use the object-URL route (broadest support) but feature-detect `srcObject` as a documented future enhancement. |
| Bundling hls.js | Optional peerDependency + lazy import | Bundling breaks the zero-runtime-dep ethos and bloats every install; optional peerDep keeps it host-controlled. (Locked.) |
| Running the player in the iframe | Parent realm only | Would require `allow-scripts` = catastrophic XSS regression. (Locked, non-negotiable.) |

**Installation (host-side, optional — NOT added to PhantomStream's `dependencies`):**
```bash
# Host opts in to the bundled-lazy hls.js path:
npm install hls.js   # satisfies PhantomStream's OPTIONAL peerDependency
```

**PhantomStream `package.json` change (the only packaging edit):**
```jsonc
// NO change to "dependencies" (stays { "ws": "8.21.0" })
"peerDependencies": { "hls.js": ">=1.5.0" },
"peerDependenciesMeta": { "hls.js": { "optional": true } }
```

**Version verification:**
```
npm view hls.js version          -> 1.6.16  (published 2026-06-17) [VERIFIED]
npm view dashjs version          -> 5.2.0   (reference only)       [VERIFIED]
npm view shaka-player version    -> 5.1.10  (reference only)       [VERIFIED]
```

## Package Legitimacy Audit

> hls.js is the only package this phase could cause to be installed (and only on the host's opt-in). Gate run 2026-06-21.

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| hls.js | npm | created 2016-01-06 (10+ yrs) | 6,371,721/wk | github.com/video-dev/hls.js | **[OK]** | **Approved** — optional peerDependency, NOT a hard dep |
| dashjs | npm | mature | (reference) | github.com/Dash-Industry-Forum/dash.js | not run (not installed) | Reference only — host-provided, never installed by PhantomStream |
| shaka-player | npm | mature | (reference) | github.com/shaka-project/shaka-player | not run (not installed) | Reference only — host-provided, never installed by PhantomStream |

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

**hls.js provenance:** name confirmed from the locked CONTEXT/roadmap decision (host-confirmed), cross-checked against official docs (`github.com/video-dev/hls.js`), and slopcheck-verified `[OK]`. No `postinstall` script (`npm view hls.js scripts.postinstall` → empty). Tagged `[VERIFIED: npm registry]`.

**Audit hygiene note (for the planner):** slopcheck's `install` subcommand **mutated `package.json`** (added `hls.js` to `dependencies`) and installed it into `node_modules` during this research; both were reverted (`git checkout -- package.json package-lock.json`, `rm -rf node_modules/hls.js`) — the working tree is clean. When the planner schedules the real packaging task it MUST add hls.js under **`peerDependencies` + `peerDependenciesMeta.optional`**, never `dependencies`, and verify `dependencies` stays `{ ws }` after the edit. The `1 high severity` npm-audit line seen during the gate was a **transitive `undici`** advisory (a devDependency-tree issue), unrelated to hls.js.

## Cross-Realm MSE Binding (HIGHEST-VALUE — the milestone's one uncertain area)

### The decisive spec facts [CITED: w3.org/TR/media-source-2]

1. **Object-URL attachment is a Window-context mechanism.** *"Attaching a MediaSource that was constructed in a Window can be done by assigning a MediaSource object URL for that MediaSource to the media element `src` attribute or the `src` attribute of a `<source>` inside a media element."* The parent realm IS a Window. ✓
2. **The object URL's security boundary is ORIGIN, set at `createObjectURL()` time.** *"The origin of the MediaSource object URL is the relevant settings object of `this` during the call to `createObjectURL()`."* The relevant settings object during a parent-realm `URL.createObjectURL(ms)` is the **parent's** origin.
3. **The spec ties the restriction to origin/realm-of-creation, NOT to Document identity, and is silent on cross-Document use within the same origin.** The only hard prohibition is **Worker-created MediaSource** object URLs (those MUST fail; a Worker MediaSource must instead transfer a `MediaSourceHandle` to the Window and assign it to `srcObject`). Our MediaSource is created in the **parent Window**, not a Worker — so that prohibition does not apply.

**Why this works for PhantomStream specifically:** The mirror iframe is `sandbox="allow-same-origin"` (asserted exactly, `src/renderer/index.js`~530-534) and is a `srcdoc` iframe — it is **same-origin to the parent**. The entire Phase 7/12/13 architecture already relies on the parent reaching into `iframe.contentDocument` to apply diffs, read rects, and (Phase 13) call `.play()`/`.pause()`/`.currentTime=` on the child `<video>` cross-realm. A `blob:` object URL minted in the parent carries the parent's origin = the child's origin, so the child `<video>`'s resource-fetch algorithm accepts it. **No `allow-scripts` is needed** — the child element is inert data; the parent does all the work.

### The attachment decision tree (build this in `src/renderer/media-player.js`)

```
attach(videoEl, manifestUrl, ctx):                 // videoEl lives in iframe.contentDocument
  1. GATE: gateAsset(manifestUrl, 'media') -> blocked? => degrade('blocked-origin'/'no-manifest')
  2. NATIVE HLS FIRST (no MSE, no library, no parent player):
       if isHlsManifest(manifestUrl) AND
          videoEl.canPlayType('application/vnd.apple.mpegurl') in {'probably','maybe'}:
            videoEl.src = manifestUrl          // cross-realm attribute set on the child el
            ensurePlaying(videoEl, nid)        // REUSE Phase 13
            return handle({ kind: 'native' })
  3. HOST playerFactory (if provided): supports DASH + custom + HLS:
       const player = playerFactory({ doc, logger, manifestUrl, kind, videoEl });
       player.attach(videoEl, manifestUrl, ctx); // host owns MSE/attachMedia internally
       wire player.onError -> degrade(reasonFromError)
       return handle({ kind: 'factory', player })
  4. OPTIONAL LAZY hls.js (HLS only, no factory):
       if isHlsManifest(manifestUrl):
         if !(globalThis.MediaSource || globalThis.ManagedMediaSource): degrade('mse-opaque')
         const Hls = await tryLazyImportHls();     // dynamic import, see Packaging
         if !Hls || !Hls.isSupported(): degrade('no-player')
         const hls = new Hls({ /* emeEnabled stays FALSE */ });
         hls.on(Hls.Events.ERROR, (e,d) => { if (d.fatal) degrade(mapHlsError(d)); });
         hls.loadSource(manifestUrl);             // load first
         hls.attachMedia(videoEl);                // bare child element; no same-doc requirement
         return handle({ kind: 'hls', hls })
  5. DASH (.mpd) with no factory => degrade('no-player')
  6. anything unhandled => degrade('no-manifest')

degrade(reason): destroy any player; show 'media-unavailable' overlay over the rect;
                 invoke onMediaUnavailable(nid, reason); keep the element's poster if present,
                 else the Phase-12 dimensioned placeholder. NEVER throw. NEVER break the mirror.
```

### hls.js cross-realm specifics [CITED: github.com/video-dev/hls.js/blob/master/docs/API.md]

- **`hls.attachMedia(HTMLMediaElement | MediaAttachingData)`** — accepts a bare media element; *"no explicit document requirement stated"*. hls.js binds via *"create MediaSource and set it as video source"* (object-URL / `ManagedMediaSource` internally), so it owns the MSE attachment — we just hand it the child element. The element should already be in the DOM (it is — it is part of the mirrored snapshot).
- **`preferManagedMediaSource` (default `true`)** — hls.js uses `ManagedMediaSource` when present, falling back to `MediaSource`. Both are parent-realm globals; both produce an attachment the child element accepts (same-origin).
- **`Hls.isSupported()`** — *"whether your browser supports MSE with any baseline codecs"*. Gate the lazy-hls path on this.
- **`Hls.isMSESupported()`** — MSE presence alone. Useful as a coarser pre-check.
- **Order:** `loadSource()` then `attachMedia()` is the documented happy path; the alternative (`attachMedia` → `MEDIA_ATTACHED` → `loadSource` → `startLoad`) is for `autoStartLoad:false`. Use **load-then-attach**.

### Known cross-realm / cross-document MSE pitfalls (design around these)

| Pitfall | Why it bites | Mitigation in our design |
|---------|--------------|--------------------------|
| **`MediaSource instanceof` across realms** | An object created with the parent's `MediaSource` is NOT `instanceof iframe.contentWindow.MediaSource` (different constructors per realm). | We never test `instanceof` across realms. The player runs in the PARENT and uses the PARENT's `MediaSource`; the child only receives a `src` string. hls.js owns its own MSE in the parent realm. ✓ |
| **Object-URL realm ownership / revocation** | The `blob:` URL belongs to the realm that created it; revoking from the wrong realm is a no-op; GC timing differs. | Mint AND revoke in the parent. `destroy()` calls `URL.revokeObjectURL()` in the parent and `videoEl.removeAttribute('src')` + `videoEl.load()` on the child. |
| **Worker MediaSource** | A Worker-created MediaSource MUST use `srcObject`+handle, not an object URL. | We do NOT use a Worker. hls.js's optional worker is its own internal concern; from our side `attachMedia(el)` is realm-correct. If a host's `playerFactory` uses a Worker, that is the host's contract. |
| **`srcObject = MediaSource` support gaps** | Assigning a `MediaSource` to `srcObject` is not universally supported. | Prefer the object-URL route for the manual path; let hls.js choose internally. `srcObject` is a documented future enhancement, feature-detected, never required. |
| **Element document detachment** | If the child element is removed (re-snapshot replaces the mirror document), the player holds a dead element. | On `handleSnapshot` (`src/renderer/index.js`~1430, `mediaFirstBind.clear()`~1456) the player registry must `destroy()` all live players for the prior generation — a new "player teardown on new identity" step alongside the existing baseline reset. |
| **Hidden-tab media suspension** | The test/automation browser suspends `<video>` decode for hidden tabs (documented `13-HUMAN-UAT.md`), so playback never advances. | Build behind feature detection; never assert frame advance in CI. jsdom-stub unit tests cover the bind/fallback logic; live playback is a deferred UAT. The poster fallback is the never-break net. |

### Feature-detection + graceful-fallback design (the never-break contract)

```js
function canUseMse(win) {
  // Parent-realm globals; ManagedMediaSource (Safari) or MediaSource (others).
  return !!(win && (win.ManagedMediaSource || win.MediaSource));
}
function isNativeHls(videoEl, manifestUrl) {
  if (!isHlsManifest(manifestUrl)) return false;
  var v = (typeof videoEl.canPlayType === 'function')
    ? videoEl.canPlayType('application/vnd.apple.mpegurl') : '';
  return v === 'probably' || v === 'maybe';
}
// Every branch is try/catch-wrapped; ANY failure -> degrade(reason) -> poster.
// No branch throws into handleMedia. The mirror keeps updating regardless.
```

**Failure → poster, never break:** every step in `attach()` is contained; a thrown error, a missing global, an absent library, an `isSupported()===false`, or a fatal hls.js error all route to the single `degrade(reason)` sink. The Phase 13 progressive path and the rest of the mirror are unaffected.

## Native HLS vs MSE Path (the exact branch)

[CITED: videosdk.live native-hls-playback; MDN canPlayType]

- **Detect:** `videoEl.canPlayType('application/vnd.apple.mpegurl')` → `'probably'` or `'maybe'` (Safari/iOS, and increasingly Chromium 142+/Edge) means the browser plays HLS natively.
- **Native branch:** set `videoEl.src = manifestUrl` directly (cross-realm, on the child element) — **no MSE, no parent player, no hls.js**. The manifest URL must pass `gateAsset(manifestUrl, 'media')` and is fetched by the **child element** from the source origin (covered by `media-src http: https:`, already present). Segments are fetched by the native player from the manifest's origin.
  - **CSP nuance for native HLS:** unlike the MSE path, the native path means the **child element itself fetches** the manifest + segments. `media-src http: https:` already permits this (Phase 13). This does NOT require `connect-src` because `<video>`/native-HLS fetches are governed by `media-src`, not `connect-src`. (`blob:` is NOT needed for the native path; it is needed only for the MSE object URL.)
- **MSE branch (everything else):** go to the parent-realm player (host `playerFactory` → optional lazy hls.js → degrade). hls.js parses the `.m3u8`, fetches segments in the PARENT, transmuxes, and feeds SourceBuffers attached to the child element via a `blob:`/`ManagedMediaSource` URL.

**`canPlayType` caveat to document:** a non-empty return is advisory ("maybe") and some Chromium builds report native HLS support but fail on specific streams [CITED: videosdk.live]. The never-break design covers this: if native playback errors, the element surfaces the Phase 13 load-error/poster path; the mirror does not break. (A future enhancement could fall back native→MSE on a native error, but that needs real-browser observation — deferred UAT.)

## `playerFactory` / `PlayerAdapter` Interface (host-friendly, zero-dep, jsdom-testable)

Discretion area — proposed minimal shape, modeled on the existing config-callback family and the `overlays.register(kind, renderFn)` seam:

```js
/**
 * @typedef {Object} PlayerAdapterCtx
 * @property {Document} doc            iframe.contentDocument (where videoEl lives)
 * @property {string} manifestUrl      gated, absolute manifest URL
 * @property {'hls'|'dash'|'unknown'} kind   derived from extension/content-type
 * @property {HTMLMediaElement} videoEl the in-iframe child element
 * @property {ViewerLogger} logger
 * @property {(url: string, kind: string) => {allow: boolean}} gateAsset  reuse Phase 12 gate
 */

/**
 * @typedef {Object} PlayerAdapter
 * @property {(videoEl: HTMLMediaElement, manifestUrl: string, ctx: PlayerAdapterCtx) => void} attach
 *   Bind the manifest to the element (host owns MSE/attachMedia/segment fetch in the PARENT realm).
 * @property {() => void} destroy   Tear down: detach MSE, revoke object URLs, free buffers. Idempotent.
 * @property {(handler: (reason: string) => void) => void} [onError]
 *   Report a fatal/unrecoverable error with a reason code; the viewer degrades to poster.
 */

// Host usage:
createViewer({
  container, transport,
  playerFactory(ctx) {
    // e.g. dash.js: const p = dashjs.MediaPlayer().create();
    //               return { attach(el, url){ p.initialize(el, url, true); },
    //                        destroy(){ p.reset(); }, onError(cb){ p.on('error', e=>cb('factory-error')); } };
    return myPlayerAdapter(ctx);
  }
});
```

**How the optional lazy hls.js composes with the seam:** the **internal** hls.js path is just a built-in `PlayerAdapter` the viewer constructs when (a) no `playerFactory` is configured, (b) the manifest is HLS, (c) `MediaSource` exists, and (d) the dynamic import succeeds. It implements the same `attach`/`destroy`/`onError` shape. This keeps one code path (`degrade` on any failure) and means the seam and the lazy import never conflict.

**Provably zero-hard-dep + jsdom-testable:**
- The lazy import is `await import('hls.js')` **inside `tryLazyImportHls()`**, wrapped in `try/catch` → returns `null` on failure. It is NEVER a top-level `import`. (See Packaging for the smoke-test proof of why this matters.)
- jsdom tests inject a **fake `playerFactory`** (records `attach`/`destroy` calls) and a **stub `MediaSource`** on the window to exercise every branch without a real media engine. The hls.js branch is tested by stubbing `globalThis` / the import — OR by leaving hls.js uninstalled and asserting the `degrade('no-player')` path fires (proving graceful absence). Both keep the suite `node --test`-runnable with zero installed players.

## Adapter Manifest Discovery + Correlation

### Filter (extension + content-type)

A response is a manifest hint when **either**:
- **URL path** ends in `.m3u8` (HLS) or `.mpd` (DASH) (ignore query string), OR
- **`content-type` header** matches (case-insensitive, ignore `;charset`):
  - HLS: `application/vnd.apple.mpegurl`, `application/x-mpegURL`, `audio/mpegurl`, `audio/x-mpegurl`
  - DASH: `application/dash+xml`

Content-type is the more robust signal (CDNs often serve extensionless or signed manifest URLs); use URL-OR-content-type so either catches it.

### Where each adapter observes

| Adapter | Hook | Anchor |
|---------|------|--------|
| Playwright | `page.on('response', resp => …)` via the existing `addPageListener(eventName, handler)` | `src/adapters/playwright.js`~217-221 (already adds `framenavigated`/`load` listeners the same way) |
| Playwright (CDP) | `Network.responseReceived` on the CDP session | `ensureCDPSession()`~210; `cfg.cdpSessionFactory` |
| Extension | `chrome.webRequest.onCompleted` (filter `urls`, read `responseHeaders`) or `chrome.debugger` `Network.responseReceived` | `src/adapters/extension.js` `ensureCDPSession`~210 / `chrome.webRequest`; note the manifest extends `validateChrome`~38 to require `chrome.webRequest` ONLY when discovery is opted in |

Both adapters then call `transport.send(STREAM.MEDIA_HINT, payload)` — the SAME path the bridge already uses for STREAM types (`bindingCallback`~201 forwards `STREAM[...]` types; extension `handleRuntimeMessage`~248 forwards `STREAM_TYPES[bridge.type]`). Since `STREAM.MEDIA_HINT` is added to the `STREAM` namespace, both adapters' `allowedBridgeTypes`/`STREAM_TYPES` sets auto-include it (they enumerate `Object.keys(STREAM)`), so **no allowlist edit is needed** for the adapters to relay it — only the emission code is new.

### The manifest→element correlation problem (best-effort)

A manifest GET is not labeled with the `<video nid>` that will consume it. Correlation strategy, in order:

1. **Single-active-media heuristic (primary):** if exactly one `<video>`/`<audio>` is currently playing/MSE-opaque (i.e., has a `blob:`/empty source — the Phase 12 `data-ps-asset-unavailable` / no-resolvable-src case), attribute the manifest to it.
2. **Initiator/frame + timing (when available):** CDP `Network.responseReceived` carries `frameId`; `page.on('response')` carries `response.request().frame()` and timing. Prefer a manifest whose initiator frame is the main frame and whose timing is closest to a recent media element appearing.
3. **Page-level fallback (always safe):** when ambiguous (≥2 candidate elements, or no clear initiator), emit the hint **page-addressed** (`nid: null` / `scope: 'page'`) and let the **viewer** match it on play — when an MSE-opaque element starts and has no source, the viewer consumes the most recent page-level HLS/DASH hint. **Never block on perfect correlation** (locked).

### `STREAM.MEDIA_HINT` op + `MediaHintPayload` (Discretion — modeled on `STREAM.MEDIA`)

```js
// src/protocol/messages.js — add to the STREAM namespace (twin of MEDIA):
/** Adaptive-manifest discovery hint (opt-in, adapter-originated). Payload: MediaHintPayload */
MEDIA_HINT: 'ext:dom-media-hint',   // follows the ext:dom-* namespace; assert collision-free in protocol.test.js

/**
 * One adaptive-manifest hint surfaced by an adapter's network observation. nid-
 * addressed when correlation is confident, else page-addressed (nid omitted /
 * scope 'page'); the viewer matches a page hint to an MSE-opaque element on play.
 * Identity-stamped like every side channel; rides the raw relay + 1 MiB cap;
 * old viewers ignore the unknown type (dispatch default).
 *
 * @typedef {Object} MediaHintPayload
 * @property {string} [nid]              Element nid when correlation is confident; omitted for page-level
 * @property {'page'|'element'} scope    'element' (nid set) or 'page' (viewer matches on play)
 * @property {string} manifestUrl        Absolute manifest URL (https; viewer re-gates before use)
 * @property {'hls'|'dash'} kind         Derived from extension/content-type
 * @property {string} [contentType]      Observed content-type (diagnostic)
 * @property {string} streamSessionId    Identity: minted per stream session
 * @property {number} snapshotId         Identity: minted per snapshot
 */
```

**Renderer side:** add `case STREAM.MEDIA_HINT: handleMediaHint(payload)` to the dispatch switch (`src/renderer/index.js`~1844-1871, right after `case STREAM.MEDIA`). `handleMediaHint` staleness-guards (`isCurrentStream`), re-gates `manifestUrl` (`gateAsset(manifestUrl, 'media')`), and either binds immediately (element scope, element present + MSE-opaque) or stores the hint in a small per-viewer `pendingHints` map (page scope) for the player to consume when an opaque element next plays.

**Backward-compat:** old viewers hit the dispatch `default` and silently drop `MEDIA_HINT` (the exact mechanism Phase 13 used for `STREAM.MEDIA`); the relay forwards it verbatim (raw bytes), envelope unchanged. **No D-ledger entry** (the hint originates in the adapter, not `src/capture/` — see Differential Oracle below).

## Fallback Taxonomy + DRM/EME Detection

### Reason codes + detection

| Reason | When | How detected |
|--------|------|--------------|
| `no-manifest` | MSE/`blob:` element (origin-local object URL, dead at the viewer) with no discoverable manifest hint | The element's effective source is `blob:`/empty after the Phase 12 gate AND no `MEDIA_HINT` correlates. The viewer cannot reference it → degrade. |
| `no-player` | DASH (`.mpd`) or unsupported manifest with no `playerFactory`; OR `Hls.isSupported()===false`; OR lazy `import('hls.js')` failed | `kind==='dash' && !playerFactory`; or the lazy-import/`isSupported` checks in the decision tree return falsy. |
| `mse-opaque` | MSE bind attempted but failed (no `MediaSource` global, `attachMedia` threw, or fatal media error before first frame) | `!canUseMse(win)`, a thrown error in the attach path, or an hls.js fatal `MEDIA_ERROR` that recovery can't fix. |
| `drm` | EME/encrypted content — never mirror protected media | (1) `videoEl` fires the standard `'encrypted'` event; (2) an EME key-system request (`requestMediaKeySystemAccess` observed, or hls.js `ErrorTypes.KEY_SYSTEM_ERROR` / `KEY_LOADED` with a key system); (3) HLS manifest contains `#EXT-X-KEY` (when the adapter or viewer can read the manifest text). [CITED: hls.js docs — `emeEnabled`, `drmSystems`, `ErrorTypes.KEY_SYSTEM_ERROR`] |

**DRM posture (locked):** keep hls.js `emeEnabled: false` (the default is no EME) — we NEVER attempt to play protected content. The moment any DRM signal appears, `degrade('drm')`. The cheapest reliable signal is the child element's `'encrypted'` event: attach a one-shot `videoEl.addEventListener('encrypted', () => degrade('drm'))` before/at bind. `#EXT-X-KEY` detection is a bonus when manifest text is available (the adapter could include a `hasDrm` flag on the hint if it fetched the manifest — optional).

### Degrade-to-poster path (reuse, don't rebuild)

`degrade(reason)`:
1. `destroy()` any live player for the nid (revoke object URLs in the parent, remove the child `src`, `videoEl.load()`).
2. Show the new **`media-unavailable`** overlay over the element rect (passive caption, `textContent` only — a near-clone of `renderMediaPoster`, `src/renderer/overlays.js`~663-683).
3. Invoke `onMediaUnavailable(nid, reason)` — the config callback (the `onMediaBlocked` family, `src/renderer/index.js`~341), wrapped in the existing `safeInvokeMediaHook` (~contained to logger, never rethrown).
4. **Visual fallback:** keep the element's `poster` if present (already rendered); if no poster, the element is a dimensioned placeholder via the Phase 12 `data-ps-asset-unavailable` mechanism (`buildAssetPlaceholderEl`~370 / `PLACEHOLDER_MARKER`). Never a broken/empty element.

**`media-unavailable` overlay (Discretion):** register a fourth media affordance `register('media-unavailable', renderMediaUnavailable)` next to the three at `overlays.js`~685-687. Implementation = copy `renderMediaPoster` (passive, `pointer-events:none`, no accent, no activation), text e.g. `'Media unavailable'` via `textContent`; optionally append the reason in a `data-` attribute for hosts (never user-facing markup). Null hides (universal reset). Bump the `innerHTML`-sink allowlist ONLY if a static glyph is added (it need not be — keep it text-only, so no allowlist change).

## Live Handling (MADPT-04 — pure reuse)

The Phase 13 reconciler ALREADY implements the live branch end-to-end; adaptive adds nothing here:
- `reconcileMediaDrift` takes the `live` branch before any duration math and returns `rejoin-edge` on large drift (`src/protocol/media-reconcile.js`, Plan 13-01).
- `applyMediaAction` (`src/renderer/index.js`~1701-1716) handles `rejoin-edge`: it reads `seekable.end(seekable.length-1)` **only when `seekable.length > 0`** (Pitfall 4 guard) and seeks only when `readyState >= 1`. No absolute seek on live.
- The `MediaSyncPayload` already encodes `live: true` (Infinity→null trap fix) mutually exclusive with `duration` (`src/protocol/messages.js`~202).

**Adaptive's only job for live:** the player binds the **live manifest** (hls.js handles live playlists natively; native HLS handles them natively; a host `playerFactory` owns its own live logic). The reconciler then does live-edge sync exactly as for progressive live `<video>`. The adaptive player must NOT try to seek a live stream by absolute time — it lets the reconciler's `rejoin-edge` drive the edge. No new sync code; assert the reuse in tests.

## CSP / connect-src (the empirical question — answered)

### What `media-src` must allow

Current (Phase 13, `src/renderer/snapshot.js`~545-551):
```
default-src 'none'; img-src http: https: data:; media-src http: https: data:;
style-src http: https: 'unsafe-inline'; font-src http: https: data:
```
Change (Phase 14 — the ONLY CSP edit): add `blob:` to `media-src`:
```
media-src http: https: data: blob:
```
This permits the in-iframe `<video>` to play the parent-minted `blob:` MediaSource object URL. `default-src 'none'` and the **absence of `script-src` are untouched** (locked).

### Does the iframe need `connect-src`? — **No** (for the MSE path)

**Reasoning (verify empirically in the spike, but the default is parent-fetch):**
- In the **MSE path**, the **parent realm** runs the player and fetches segments via the **parent's** `fetch`/`XHR`. Those fetches are governed by the **parent document's** CSP (the host page's own policy), NOT the mirror iframe's `srcdoc` CSP. The iframe receives only a `blob:` object URL and **plays it** — it issues **no network request**. Therefore the **iframe needs no `connect-src`**: `connect-src` governs `fetch`/`XHR`/`WebSocket`/`EventSource` *from the iframe's realm*, and the iframe's realm makes none (it has no script — no `allow-scripts`).
- `blob:` in `media-src` is what lets the iframe element *play* the blob. That is sufficient.
- **Therefore keep `connect-src` OUT of the iframe CSP** (and keep `default-src 'none'`, no `script-src`). Adding `connect-src` would be both unnecessary and a needless surface widening.

**Native-HLS path caveat:** in the NATIVE path the child element fetches the manifest+segments itself, governed by `media-src` (already `http: https:`), still **not** `connect-src` (media fetches are `media-src`, not `connect-src`). So neither path needs `connect-src`. ✓

**Empirical confirmation belongs in the deferred UAT** (real Chrome, foregrounded tab) since CSP enforcement + real segment fetch can't be observed in jsdom or the hidden automation tab. Tests assert the **CSP string** (`media-src … blob:` present; no `script-src`; no `connect-src`; `default-src 'none'`) — the same string-assertion discipline Phase 13 used (`tests/renderer-media-csp.test.js`).

## Packaging (zero-hard-runtime-dep, optional peerDependency)

[CITED: docs.npmjs.com/cli/v11/configuring-npm/package-json; 8hob.io peerDependencies-npm-v7]

- **Optional peerDependency contract:** marking hls.js in `peerDependenciesMeta` with `optional: true` means **npm will NOT auto-install it and will NOT warn when it is absent** — exactly the zero-hard-dep posture. (The version constraint still applies *if* the host installs it.)
- **The dynamic-import-only constraint (load-bearing — verified against the codebase):** `scripts/package-smoke.mjs` (line 71-78) builds an import-check that does `await import(<specifier>)` for **every** subpath in `package.json` `exports` — including `./renderer`. If `src/renderer/` (or anything it statically imports) had a **top-level** `import 'hls.js'`, the smoke test would `await import('./renderer')` and **fail** because hls.js isn't installed in the package-smoke sandbox. **Therefore the hls.js import MUST be a dynamic `import('hls.js')` inside a function, wrapped in try/catch.** This is the single most important packaging rule for this phase.

```js
// src/renderer/media-player.js
async function tryLazyImportHls() {
  try {
    var mod = await import('hls.js');          // dynamic ONLY; never top-level
    return (mod && (mod.default || mod.Hls || mod)) || null;
  } catch (e) {
    return null;                                // absent / failed -> graceful (degrade 'no-player')
  }
}
```

- **`publint` / `attw` (`npm run lint:package` / `npm run attw`):** these check the package's own export map, types, and ESM-correctness; an **optional peerDependency** is not flagged (publint does not require optional peers to be present; the project already runs `--profile esm-only`). No `.d.ts` is emitted for hls.js (it is external); the new `media-player.js` gets JSDoc + a generated `.d.ts` under `dist/types/renderer/` via the existing `tsc` step.
- **`package:smoke` (`scripts/package-smoke.mjs`):** with the dynamic-import-only rule above, importing `./renderer` succeeds **without** hls.js installed, proving zero-hard-dep. ADD a smoke assertion (or a unit test) that the renderer module imports cleanly with hls.js absent and that `degrade('no-player')` is the observed outcome when the lazy import returns null.
- **`files` / exports:** no new subpath export is required — `media-player.js` is internal to `./renderer`. (If the planner wants it host-importable, add `./renderer/media-player`, but the simpler path is to keep it internal and expose behavior through `createViewer` config.)

## Architecture Patterns

### System Architecture Diagram

```text
  ┌──────────────────────────── CAPTURE SIDE (driven page) ─────────────────────────────┐
  │  Adapter (Playwright / Extension)         src/capture/  (UNCHANGED for adaptive)     │
  │  ┌───────────────────────────────┐        - emits SNAPSHOT/MUTATIONS/MEDIA as today  │
  │  │ network observation (opt-in)  │          (no manifest sniffing in capture core)   │
  │  │  page.on('response') /        │                                                   │
  │  │  chrome.webRequest.onCompleted│── filter .m3u8/.mpd by ext+content-type           │
  │  └──────────────┬────────────────┘── correlate (single-active / initiator / page)    │
  │                 │ transport.send(STREAM.MEDIA_HINT, MediaHintPayload)                 │
  └─────────────────┼───────────────────────────────────────────────────────────────────┘
                    │  (rides the existing raw relay, 1 MiB cap, envelope UNCHANGED)
                    ▼
  ┌──────────────────────────────── RELAY (UNTOUCHED) ──────────────────────────────────┐
  │  raw-bytes fan-out; old viewers ignore the unknown STREAM.MEDIA_HINT type            │
  └─────────────────┬───────────────────────────────────────────────────────────────────┘
                    ▼   VIEWER (renderer)
  ┌──────────────────────────── PARENT REALM (host document) ───────────────────────────┐
  │  createViewer dispatch:  STREAM.MEDIA -> handleMedia (Phase 13, reused)              │
  │                          STREAM.MEDIA_HINT -> handleMediaHint (new)                  │
  │                                                                                      │
  │  src/renderer/media-player.js (NEW, parent realm):                                   │
  │   attach(videoEl, manifestUrl, ctx):                                                 │
  │     gateAsset -> NATIVE-HLS? (canPlayType) -> set child videoEl.src = manifest       │
  │                -> else playerFactory? -> host PlayerAdapter.attach                   │
  │                -> else lazy import('hls.js') + Hls.isSupported -> hls.attachMedia(el) │
  │                -> else degrade(reason)                                               │
  │     [parent fetches segments] --MSE--> blob: object URL (parent origin)              │
  │     reconcileMediaDrift + applyMediaAction (Phase 13, reused) drive play/pause/seek  │
  │                                  │ cross-realm method calls + src on child element    │
  │            degrade(reason) ──────┼──> onMediaUnavailable(nid,reason) + overlay        │
  └──────────────────────────────────┼───────────────────────────────────────────────────┘
                                      ▼   CHILD REALM (sandbox="allow-same-origin", NO allow-scripts)
                          ┌────────────────────────────────────────────┐
                          │ inert <video> — plays blob: (MSE) or        │
                          │ manifest (native HLS); fetches NOTHING in    │
                          │ the MSE path -> no connect-src needed.       │
                          │ media-src: http: https: data: blob:          │
                          └────────────────────────────────────────────┘
```

### Recommended Project Structure
```
src/
├── protocol/
│   └── messages.js          # + STREAM.MEDIA_HINT op + MediaHintPayload typedef
├── renderer/
│   ├── index.js             # + handleMediaHint dispatch, playerFactory/onMediaUnavailable config,
│   │                        #   player registry + teardown-on-new-identity, media-player wiring
│   ├── media-player.js      # NEW: createMediaPlayer + attach() decision tree + tryLazyImportHls + degrade
│   ├── overlays.js          # + register('media-unavailable', renderMediaUnavailable) (clone of poster)
│   └── snapshot.js          # CSP_META: media-src gains `blob:`
└── adapters/
    ├── playwright.js        # + manifest observation via addPageListener('response', …) / CDP Network
    └── extension.js         # + manifest observation via chrome.webRequest.onCompleted / chrome.debugger
```

### Pattern 1: One degrade() sink, every branch contained
**What:** every step in `attach()` (gate, native, factory, lazy-hls, dash) is `try/catch`-wrapped and routes failure to a single `degrade(reason)`.
**When to use:** the whole adaptive surface. It is the never-break contract.
**Example:**
```js
// Source: this RESEARCH (modeled on Phase 13 ensurePlaying/applyMediaAction containment)
function attach(videoEl, manifestUrl, ctx) {
  try {
    if (!gateAsset(manifestUrl, 'media').allow) return degrade(ctx.nid, 'no-manifest');
    if (isNativeHls(videoEl, manifestUrl)) { videoEl.src = manifestUrl; ensurePlaying(videoEl, ctx.nid); return; }
    if (playerFactory) return attachViaFactory(videoEl, manifestUrl, ctx);
    if (ctx.kind === 'hls') return attachViaLazyHls(videoEl, manifestUrl, ctx); // async, self-degrades
    return degrade(ctx.nid, 'no-player'); // dash/unknown, no factory
  } catch (e) { degrade(ctx.nid, 'mse-opaque'); } // ANY throw -> poster, never break
}
```

### Pattern 2: Player teardown on new stream identity
**What:** on a re-snapshot (new `streamSessionId`/`snapshotId`), destroy all live players for the prior generation before the new mirror document replaces the old child elements.
**When to use:** in `handleSnapshot` alongside the existing `mediaFirstBind.clear()` (`src/renderer/index.js`~1456).
**Example:**
```js
// Source: this RESEARCH (mirrors mediaFirstBind reset lifecycle)
function handleSnapshot(payload) {
  // … existing reset …
  mediaFirstBind.clear();
  destroyAllPlayers();        // NEW: revoke object URLs (parent), detach MSE, free the prior-gen players
}
```

### Anti-Patterns to Avoid
- **Top-level `import 'hls.js'`** — breaks `package:smoke` (the renderer subpath import) and the zero-hard-dep guarantee. Use dynamic `import()` in a function only.
- **`instanceof` across realms** — never test `x instanceof MediaSource` against an object from another realm. Keep the player + MediaSource entirely in the parent realm.
- **Adding `allow-scripts` to run a player in the iframe** — catastrophic XSS regression (locked, non-negotiable). Player runs in the parent.
- **Adding `connect-src` to the iframe CSP** — unnecessary (parent fetches segments; child plays a blob) and widens surface. Keep `default-src 'none'`, no `script-src`, no `connect-src`.
- **Blocking on perfect manifest→element correlation** — emit page-level hints when ambiguous; the viewer matches on play.
- **Attempting EME/DRM playback** — keep `emeEnabled:false`; degrade to `drm` on any DRM signal.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| HLS `.m3u8` parse + segment fetch + transmux + SourceBuffer feed | A custom MSE pipeline | hls.js (optional, lazy) OR host `playerFactory` | MSE buffering, ABR, discontinuities, fMP4/TS transmux, live-edge — thousands of edge cases hls.js already solves. |
| Native HLS support detection | A UA-string sniff | `videoEl.canPlayType('application/vnd.apple.mpegurl')` | Feature detection is the documented, forward-compatible method [CITED: videosdk.live]. |
| Drift-corrected play/pause/seek + live-edge | New sync logic | Phase 13 `reconcileMediaDrift` + `applyMediaAction` (reuse verbatim) | Already pure, table-tested (6561-case sweep), live branch + guards proven. |
| Origin/scheme/private-range gating of manifest+segment URLs | A new validator | Phase 12 `gateAssetUrl` / `classifyAssetOrigin` (reuse) | Fail-closed https-only + private-range denylist already shipped + tested; reused for media in Phase 13. |
| DASH/Shaka playback | Bundling dash.js/Shaka | Host `playerFactory` only | Locked: zero-runtime-dep; host owns DASH/DRM. |
| The degrade overlay | A bespoke widget | Clone `renderMediaPoster` (`overlays.js`~663) | Passive caption, `textContent`-only, registry-driven — the established media-affordance pattern. |

**Key insight:** Phase 14 is mostly **wiring proven pieces together** (Phase 13 driver + Phase 12 gate + the overlay registry + the adapter network hooks) around ONE new capability — the parent-realm MSE bind — which hls.js or a host player owns internally. The net-new code is small: a decision-tree module, one protocol op, one overlay, two adapter hooks, one CSP token.

## Runtime State Inventory

> This is a greenfield capability addition (new module + new op + adapter hooks), NOT a rename/refactor/migration. No stored data, live-service config, OS-registered state, secrets, or build artifacts carry a renamed string. **None — verified:** `grep -rn "MediaSource|MEDIA_HINT|attachMedia|playerFactory|onMediaUnavailable|hls" src/` returns only Phase 13's pre-existing `attachMediaListeners*` (event-listener attachment in `src/capture/index.js`, unrelated to MSE). All Phase 14 surface is net-new. Section omitted as not applicable.

## Common Pitfalls

### Pitfall 1: Top-level hls.js import silently breaks the package smoke
**What goes wrong:** a `import Hls from 'hls.js'` at module top in `src/renderer/` makes `npm run package:smoke` fail (it `await import('./renderer')`s with hls.js absent) and reintroduces a hard dep.
**Why it happens:** static imports are resolved eagerly; the smoke test imports every export subpath.
**How to avoid:** dynamic `import('hls.js')` inside `tryLazyImportHls()`, try/catch → null.
**Warning signs:** `package:smoke` red with `ERR_MODULE_NOT_FOUND: hls.js`; `attw`/`publint` listing hls.js as required.

### Pitfall 2: Cross-realm object-URL ownership / leak
**What goes wrong:** an object URL minted in the parent but never revoked (or revoked from the child) leaks; a re-snapshot orphans players holding dead child elements.
**Why it happens:** `blob:` URLs are realm-owned; the mirror document is replaced wholesale on re-snapshot.
**How to avoid:** mint AND revoke in the parent; `destroyAllPlayers()` on new identity (Pattern 2); `destroy()` revokes + `removeAttribute('src')` + `load()`.
**Warning signs:** growing memory across re-snapshots; "media element not in document" errors.

### Pitfall 3: Hidden-tab media suspension masks real behavior
**What goes wrong:** in CI / the FSB automation browser, `<video>` never advances (`readyState 0`, `currentTime 0`) — so any test asserting playback progress hangs/fails (documented `13-HUMAN-UAT.md`, `13-VERIFICATION.md`).
**Why it happens:** Chrome suspends media decode for `visibilityState:'hidden'` tabs.
**How to avoid:** unit-test the bind/fallback/correlation logic with stubs (no real decode); defer live-playback proof to a foregrounded-browser UAT; rely on the poster fallback as the never-break net.
**Warning signs:** a test that waits for `playing`/`timeupdate` and times out.

### Pitfall 4: `canPlayType` "maybe" over-trusts native HLS
**What goes wrong:** some Chromium builds report native HLS ('maybe') but fail on specific streams [CITED: videosdk.live].
**Why it happens:** `canPlayType` is advisory.
**How to avoid:** the never-break design — a native-path error surfaces the Phase 13 load-error/poster path; the mirror does not break. (Native→MSE retry-on-error is a deferred-UAT enhancement.)
**Warning signs:** black native player in Chromium on a stream Safari plays.

### Pitfall 5: connect-src cargo-culting
**What goes wrong:** adding `connect-src` to the iframe CSP "to let it fetch segments" — but the iframe fetches nothing in the MSE path (parent fetches; child plays a blob), and it has no script to fetch anything anyway.
**Why it happens:** assuming the player runs in the iframe.
**How to avoid:** confirm parent-fetch model; add ONLY `blob:` to `media-src`; keep `default-src 'none'`, no `script-src`, no `connect-src`.
**Warning signs:** a `connect-src` directive appearing in `CSP_META`; a reviewer asking "why does an inert iframe need fetch permission?".

## Code Examples

### Native-HLS-first detection + bind (parent sets child element src)
```js
// Source: this RESEARCH; canPlayType per videosdk.live native-hls-playback + MDN
function isHlsManifest(url) { try { return /\.m3u8(\?|#|$)/i.test(new URL(url).pathname + (new URL(url).search)); } catch (e) { return /\.m3u8/i.test(String(url)); } }
function bindNativeHlsIfPossible(videoEl, manifestUrl, nid) {
  if (!isHlsManifest(manifestUrl)) return false;
  var s = (typeof videoEl.canPlayType === 'function') ? videoEl.canPlayType('application/vnd.apple.mpegurl') : '';
  if (s !== 'probably' && s !== 'maybe') return false;
  try { videoEl.src = manifestUrl; } catch (e) { return false; } // child element, cross-realm
  ensurePlaying(videoEl, nid); // REUSE Phase 13
  return true;
}
```

### Optional lazy hls.js adapter (parent realm; never a hard dep)
```js
// Source: this RESEARCH; hls.js attachMedia/isSupported/ERROR per github.com/video-dev/hls.js/blob/master/docs/API.md
async function attachViaLazyHls(videoEl, manifestUrl, ctx) {
  var win = ctx.doc.defaultView || globalThis;
  if (!(win.ManagedMediaSource || win.MediaSource)) return degrade(ctx.nid, 'mse-opaque');
  var Hls = await tryLazyImportHls();
  if (!Hls || typeof Hls.isSupported !== 'function' || !Hls.isSupported()) return degrade(ctx.nid, 'no-player');
  try {
    var hls = new Hls({ /* emeEnabled stays false: never play DRM */ });
    videoEl.addEventListener('encrypted', function () { degrade(ctx.nid, 'drm'); }, { once: true });
    hls.on(Hls.Events.ERROR, function (_e, d) {
      if (!d || !d.fatal) return;
      degrade(ctx.nid, (d.type === Hls.ErrorTypes.KEY_SYSTEM_ERROR) ? 'drm' : 'mse-opaque');
    });
    hls.loadSource(manifestUrl);   // load first
    hls.attachMedia(videoEl);      // bare in-iframe element; no same-document requirement
    return { kind: 'hls', destroy: function () { try { hls.destroy(); } catch (e) {} } };
  } catch (e) { return degrade(ctx.nid, 'mse-opaque'); }
}
```

### CSP edit (the only one)
```js
// src/renderer/snapshot.js ~545 — add blob: to media-src ONLY
'media-src http: https: data: blob:; '   // was: 'media-src http: https: data:; '
// default-src 'none' and absence of script-src/connect-src unchanged.
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `video.src = URL.createObjectURL(MediaSource)` | `video.srcObject = MediaSource` (+ Worker `MediaSourceHandle`) | MSE-in-Workers (`media-source-2`) | `srcObject` avoids the object-URL string and enables Worker MSE; but `srcObject=MediaSource` support is still narrower. Object-URL remains the broadest path; let hls.js choose internally. [CITED: w3.org/TR/media-source-2] |
| `MediaSource` only | `ManagedMediaSource` (power/memory-aware) | Recent Safari/Chromium | hls.js prefers `ManagedMediaSource` (`preferManagedMediaSource:true`). Both are parent-realm globals; both produce a child-acceptable attachment. [CITED: hls.js docs] |
| hls.js for HLS only | Chromium native HLS landing (142+) | 2025–2026 | More browsers satisfy `canPlayType('application/vnd.apple.mpegurl')`, so the native path covers more cases (no MSE). [CITED: videosdk.live] |

**Deprecated/outdated:**
- Relying on UA sniffing for native HLS: use `canPlayType`.
- Bundling a player into a library: optional peerDependency + host seam is the current zero-dep idiom.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | A parent-realm `blob:` MediaSource object URL is resolvable by an in-iframe **same-origin** `<video>` because the spec ties the restriction to origin (relevant settings object at `createObjectURL`), not Document identity. | Cross-Realm MSE Binding | LOW. Spec strongly supports it and hls.js docs state no same-document requirement; but it cannot be observed live here (hidden-tab suspension). If a specific browser refuses cross-Document object-URL attach, the `srcObject`+handle path or the native path covers HLS, and `degrade('mse-opaque')` is the never-break net. **This is the spike to run first** (foregrounded Playwright) per `STATE.md` Phase 14 blocker. |
| A2 | `STREAM.MEDIA_HINT='ext:dom-media-hint'` is collision-free in the `STREAM` namespace. | MEDIA_HINT op | LOW. Assert collision-free in `protocol.test.js` (the Phase 13 `ext:dom-media` precedent did exactly this). |
| A3 | The iframe needs no `connect-src` because the parent fetches all segments and the child only plays a blob (MSE path) / fetches via `media-src` (native path). | CSP / connect-src | LOW conceptually; **flagged for empirical confirmation in the deferred UAT** (real CSP enforcement). The locked decision keeps `default-src 'none'`/no `script-src` regardless, so a surprise can only mean "also need blob:" (already added), never a security regression. |
| A4 | No differential-oracle ledger entry is needed (the hint originates in the adapter, not `src/capture/`; the capture wire is byte-unchanged). | Differential Oracle | LOW. Confirmed by reading `tests/differential/normalize.js` (`normalizeExtracted` validates against `Object.values(STREAM)` but only sees `src/capture/` loopback records) + `harness.js` (loads `src/capture/index.js`). The planner should still run the full suite to confirm the oracle stays green (the Phase 13 stale-entry discipline). |
| A5 | hls.js `attachMedia(el)` works when hls.js runs in the parent and `el` lives in the child iframe. | hls.js cross-realm | LOW–MEDIUM. Docs say `attachMedia` takes a bare element with no same-document requirement and hls.js owns MSE in its own (parent) realm; not observable live here. The host `playerFactory` + native + degrade paths make this non-blocking. |

**If this table looks long:** every row is LOW-risk because the **poster fallback + native-HLS path + host seam** mean even a wrong assumption degrades gracefully — the milestone's never-break contract holds. A1/A5 are exactly what the early Playwright spike (`STATE.md` blocker) exists to settle.

## Open Questions

1. **Does cross-Document object-URL MSE attach work in headless/headed Chromium AND Safari?** (A1/A5)
   - What we know: spec ties it to origin not Document; hls.js docs impose no same-document requirement; same-origin iframe.
   - What's unclear: empirical behavior per browser, unobservable here (hidden-tab suspension).
   - Recommendation: **run the foregrounded Playwright spike FIRST** (the `STATE.md` Phase 14 blocker). If any browser refuses, fall to `srcObject`+handle or native-HLS; `degrade('mse-opaque')` is the net. Not a milestone risk.

2. **Should the adapter pre-fetch the manifest to detect `#EXT-X-KEY` (DRM) before emitting the hint?**
   - What we know: the cheap signal is the viewer-side `'encrypted'` event; manifest text gives an earlier `drm` verdict.
   - What's unclear: whether the extra adapter fetch is worth it vs. viewer-side `encrypted`.
   - Recommendation: ship viewer-side `'encrypted'` + `KEY_SYSTEM_ERROR` detection now; make manifest-text DRM sniffing an OPTIONAL `hasDrm` flag on the hint (Discretion). Don't block on it.

3. **Wire the internal lazy-hls adapter now, or ship `playerFactory` + a documented hls.js example only?**
   - What we know: both satisfy the locked contract; the Discretion clause prefers whatever keeps the module provably zero-dep and jsdom-runnable.
   - Recommendation: **wire the internal lazy-hls adapter** (it IS a `PlayerAdapter`, dynamic-import-guarded, and the `degrade('no-player')`-when-absent test proves graceful absence) — it gives users the "just `npm i hls.js`" path while staying zero-hard-dep. Keep a `playerFactory` dash.js example in docs.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js test runner (`node --test`) | All unit tests | ✓ | v24.x | — |
| jsdom | renderer/player/overlay/adapter unit tests | ✓ | ^29.1.1 (devDep) | — |
| playwright | adapter mock-page tests + (deferred) real-browser MSE UAT | ✓ | ^1.60.0 (devDep) | — |
| hls.js | OPTIONAL lazy player path + its unit test | ✗ (by design) | (peerOptional >=1.5) | Tests cover BOTH absent (degrade `no-player`) and stubbed-present; never required to be installed |
| **Foregrounded/headed browser with media decode** | **Live MSE/adaptive playback observation** | **✗** | — | **Deferred UAT** — FSB runs tabs hidden → Chrome suspends media (documented `13-HUMAN-UAT.md`); poster fallback is the never-break net |
| `MediaSource` / `ManagedMediaSource` | the MSE bind | ✗ in jsdom | — | Stubbed on the window in unit tests; real engine only in the deferred UAT |

**Missing dependencies with no fallback:** none that block planning — every "missing" item has a stub-based unit-test path; live playback is an explicitly deferred UAT, not a blocker.
**Missing dependencies with fallback:** hls.js (optional, both-states tested); real media engine (jsdom stubs + deferred UAT).

## Validation Architecture

> Nyquist enabled (`workflow.nyquist_validation: true`). Required.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Node.js built-in `node:test` + `node:assert/strict`; jsdom ^29 for renderer/DOM |
| Config file | none — `package.json` `scripts.test`: `node --test tests/*.test.js tests/differential/*.test.js` |
| Quick run command | `node --test tests/renderer-media.test.js tests/renderer-media-csp.test.js` (+ the new player/adapter files) |
| Full suite command | `npm test` (currently 580/580; differential oracle 48/48) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| MADPT-01 | native-HLS branch: `canPlayType` 'maybe' → child `videoEl.src = manifest`, no MSE | unit (jsdom, stub canPlayType) | `node --test tests/renderer-media-player.test.js` | ❌ Wave 0 |
| MADPT-01 | MSE branch via host `playerFactory`: `attach()` called with (el, url, ctx); `destroy()` on teardown | unit (fake playerFactory) | same | ❌ Wave 0 |
| MADPT-01 | lazy hls.js path: with hls.js ABSENT → `degrade('no-player')`; with a STUB `Hls`+`MediaSource` → `attachMedia(el)` called | unit (stub import / globals) | same | ❌ Wave 0 |
| MADPT-01 | zero-hard-dep: `import('./renderer')` succeeds with hls.js uninstalled (smoke) | smoke | `npm run package:smoke` | exists (assert add) |
| MADPT-02 | `.m3u8`/`.mpd` filter by extension AND content-type (incl. `application/vnd.apple.mpegurl`, `application/dash+xml`, `application/x-mpegURL`) | unit (pure filter fn) | `node --test tests/media-hint-filter.test.js` | ❌ Wave 0 |
| MADPT-02 | Playwright `page.on('response')` → `STREAM.MEDIA_HINT` emitted with `MediaHintPayload` (mock page) | unit (mock `page`) | `node --test tests/playwright-adapter.test.js` | exists (extend) |
| MADPT-02 | Extension `chrome.webRequest.onCompleted` → hint emitted (fake `chrome`) | unit (fake `chrome`) | `node --test tests/extension-adapter.test.js` | exists (extend) |
| MADPT-02 | correlation: single-active → element scope; ambiguous → page scope; viewer matches page hint on play | unit | `node --test tests/renderer-media-player.test.js` | ❌ Wave 0 |
| MADPT-02 | graceful absence: no adapter/hints → progressive path intact, zero errors | unit (existing media flow + no hint) | `node --test tests/renderer-media.test.js` | exists (extend) |
| MADPT-02 | `STREAM.MEDIA_HINT` round-trips raw under the 1 MiB cap; old viewers ignore it (dispatch default) | unit (protocol+renderer) | `node --test tests/protocol.test.js tests/renderer-media.test.js` | exists (extend) |
| MADPT-03 | each reason (`no-manifest`/`no-player`/`mse-opaque`/`drm`) → `onMediaUnavailable(nid,reason)` + `media-unavailable` overlay | unit | `node --test tests/renderer-media-player.test.js` | ❌ Wave 0 |
| MADPT-03 | DRM: `'encrypted'` event → `degrade('drm')`; hls.js `KEY_SYSTEM_ERROR` → `drm` | unit (dispatch fake event) | same | ❌ Wave 0 |
| MADPT-03 | degrade keeps poster if present, else Phase-12 placeholder; element never broken/empty | unit | same | ❌ Wave 0 |
| MADPT-03 | `media-unavailable` overlay: passive, `textContent` only, null hides; no payload-derived innerHTML | unit (overlay) | `node --test tests/renderer-media.test.js` | exists (extend) |
| MADPT-03 | throwing `onMediaUnavailable` hook is contained (logger), never wedges | unit | `node --test tests/renderer-media-player.test.js` | ❌ Wave 0 |
| MADPT-04 | live manifest: reconciler `rejoin-edge` + `seekable.length>0` guard drives live-edge; NO absolute seek | unit (reuse reconciler + applyMediaAction) | `node --test tests/media-reconcile.test.js tests/renderer-media.test.js` | exists (assert reuse) |
| MADPT-01/Sec | CSP: `media-src … blob:` present; `default-src 'none'`; NO `script-src`; NO `connect-src`; sandbox exactly `allow-same-origin` | unit (string assertion) | `node --test tests/renderer-media-csp.test.js` | exists (extend) |

### Sampling Rate
- **Per task commit:** `node --test tests/renderer-media-player.test.js tests/renderer-media-csp.test.js tests/media-hint-filter.test.js` (+ the touched adapter/protocol file) — sub-30s.
- **Per wave merge:** `npm test` (full suite incl. differential oracle).
- **Phase gate:** full suite green (≥580 baseline + new) before `/gsd:verify-work`; differential oracle stays green (expected 48/48 — no new entry).

### Wave 0 Gaps
- [ ] `tests/renderer-media-player.test.js` — covers MADPT-01 (native/factory/lazy-hls/degrade branches), MADPT-02 (correlation), MADPT-03 (reasons/DRM/poster/contained-hook). NEW.
- [ ] `tests/media-hint-filter.test.js` — covers MADPT-02 manifest filter (extension + content-type). NEW. (May fold into the player test file if the planner prefers fewer files.)
- [ ] Extend `tests/playwright-adapter.test.js` + `tests/extension-adapter.test.js` — manifest-observation → `STREAM.MEDIA_HINT` (mock page / fake chrome).
- [ ] Extend `tests/protocol.test.js` — `STREAM.MEDIA_HINT` collision-free + raw round-trip + 1 MiB cap + `MediaHintPayload` present.
- [ ] Extend `tests/renderer-media.test.js` — `STREAM.MEDIA_HINT` dispatch + `media-unavailable` overlay + graceful-absence + old-viewer-ignores.
- [ ] Extend `tests/renderer-media-csp.test.js` — `blob:` present in `media-src`; no `script-src`/`connect-src`; sandbox token unchanged.
- [ ] Assert in `scripts/package-smoke.mjs` (or a unit test): `./renderer` imports cleanly with hls.js absent (zero-hard-dep).
- [ ] Framework install: none — `node:test` + jsdom + playwright already devDeps; hls.js stays optional/uninstalled.

**Deferred to real-browser UAT (NOT jsdom-testable — document, do not gate the phase):** live MSE/adaptive playback (segment fetch, frame advance, ABR), real CSP `blob:` enforcement + the connect-src empirical confirmation, cross-Document object-URL attach in real Chromium/Safari (A1/A5), DRM degrade observed live. Same precedent as Phase 13's deferred UAT (hidden-tab suspension); the foregrounded Playwright spike for A1/A5 should run early in execution.

## Security Domain

> `security_enforcement` not set to false → enabled.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V1 Architecture | yes | Player in PARENT realm only; iframe stays `allow-same-origin`, no `allow-scripts` (asserted `index.js`~530). Object-URL blast radius DOCUMENTED here, threat-modeled Phase 15 (MSEC-04). |
| V5 Validation/Sanitization | yes | Manifest+segment URLs through `gateAssetUrl`/`classifyAssetOrigin` (https-only, private-range deny, fail-closed). `MediaHintPayload.manifestUrl` re-gated at the viewer before use. Overlay text via `textContent` only (no payload-derived innerHTML). |
| V12 Secure Communication / CSP | yes | `media-src … blob:` (the only add); `default-src 'none'`, no `script-src`, no `connect-src` retained. No media bytes traverse the relay (by-reference). |
| V14 Configuration | yes | hls.js optional peerDependency (not bundled); `emeEnabled:false` (never play DRM); dynamic-import-guarded so absence degrades, never errors. |
| V2/V3/V4/V6 (authn/session/access/crypto) | no | No auth, sessions, access control, or crypto introduced by adaptive playback. (DRM is explicitly NOT attempted.) |

### Known Threat Patterns for {parent-realm MSE + viewer-side fetch}

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Viewer-side SSRF via attacker manifest/segment URL | Tampering/Info-disclosure | `gateAssetUrl` fail-closed https-only + private-range deny (reuse Phase 12); re-gate the hint's `manifestUrl` at the viewer. |
| Tracking-pixel / live-viewer confirmation via segment GETs | Info-disclosure | The origin gate + `mediaMode` posture govern whether any GET issues; `mediaMode:'poster'`/`'off'` suppress media fetch (Phase 13). Referrer minimization completed Phase 15 (MSEC-04). |
| Object-URL / MediaSource blast radius (parent realm) | Elevation/Tampering | Player confined to parent realm; child gets only a `blob:` string; revoke on teardown. Full threat model = Phase 15 (MSEC-04) — DOCUMENT the surface here. |
| DRM/protected-content mirroring | Info-disclosure (license/keys) | NEVER attempt: `emeEnabled:false`; `'encrypted'`/`KEY_SYSTEM_ERROR`/`#EXT-X-KEY` → `degrade('drm')`. |
| Player code execution in the mirror sandbox | Elevation (XSS) | Sandbox stays exactly `allow-same-origin` (asserted, re-asserted in tests); no `allow-scripts`; player is parent-realm. |
| Unknown-op injection via the new hint | Tampering | `STREAM.MEDIA_HINT` rides raw relay + 1 MiB cap; identity-stamped + `isCurrentStream`-guarded; old viewers ignore it; envelope/relay unchanged. |

## Differential Oracle (confirming "no D-entry needed")

Verified by reading `tests/differential/normalize.js` + `harness.js`:
- The oracle compares the **extracted capture stream** (`src/capture/index.js`, loaded by `harness.js`) against the **FSB reference** (`reference/extension/dom-stream.js`).
- `normalizeExtracted` (`normalize.js`~71) validates extracted records against `Object.values(STREAM)` — so adding `STREAM.MEDIA_HINT` to the namespace **won't break** the validator; but **the capture core never emits `MEDIA_HINT`** (it originates in the adapter), so it never appears in the extracted loopback stream.
- Therefore the capture wire is byte-unchanged for adaptive → **no new divergence fires → no D-ledger entry** (confirms the CONTEXT discretion note + the Phase 13 stale-entry discipline). The planner should still run `npm test` to confirm the oracle stays at 48/48.

## Sources

### Primary (HIGH confidence)
- W3C Media Source Extensions™ 2 — `https://www.w3.org/TR/media-source-2/` — object-URL attachment rules, origin = relevant settings object at `createObjectURL`, Worker-only `srcObject`/handle restriction, silence on same-origin cross-Document.
- hls.js API docs — `https://github.com/video-dev/hls.js/blob/master/docs/API.md` (+ raw) — `attachMedia(HTMLMediaElement|MediaAttachingData)` no same-doc requirement, `preferManagedMediaSource`, `Hls.isSupported()`/`isMSESupported()`, `emeEnabled`/`drmSystems`/`ErrorTypes.KEY_SYSTEM_ERROR`, load-then-attach order.
- npm registry (live) — `npm view hls.js|dashjs|shaka-player version` → 1.6.16 / 5.2.0 / 5.1.10; hls.js created 2016, 6.37M dl/wk, no postinstall; slopcheck `[OK]`.
- Codebase (read this session): `src/renderer/index.js` (handleMedia~1744, ensurePlaying~1658, applyMediaAction~1688, applyMediaBaseline~1805, resolveIndexedNode~1005, dispatch~1839, sandbox~530, config~341, handleSnapshot~1430/mediaFirstBind~1456); `src/renderer/snapshot.js` (CSP_META~545); `src/renderer/overlays.js` (register~433, show~701, renderMediaPoster~663, registry~685); `src/protocol/messages.js` (STREAM~17, MediaSyncPayload~215, isCurrentStream~312); `src/adapters/playwright.js` (addPageListener~217, bindingCallback~201, ensureCDPSession~210); `src/adapters/extension.js` (chrome validate~38, handleRuntimeMessage~248); `scripts/package-smoke.mjs` (import-check~71); `tests/differential/normalize.js`+`harness.js`; `13-HUMAN-UAT.md`, `13-VERIFICATION.md`, `13-0{1,3}-SUMMARY.md`.

### Secondary (MEDIUM confidence)
- MDN HTMLMediaElement.srcObject / MediaSource — `https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/srcObject`, `.../MediaSource` — srcObject vs object-URL, ManagedMediaSource.
- VideoSDK Native HLS Playback (2026) — `https://www.videosdk.live/developer-hub/hls/native-hls-playback` — `canPlayType('application/vnd.apple.mpegurl')` detection + 'maybe' caveat + Chromium 142+ native HLS.
- npm docs / 8hob.io — `https://docs.npmjs.com/cli/v11/configuring-npm/package-json/`, `https://8hob.io/posts/difference-between-effects-of-dependencies-peerdependencies-npm-v7/` — `peerDependenciesMeta.optional` = not installed, no warning when absent; version constraint still applies if present.

### Tertiary (LOW confidence — flagged for the deferred UAT)
- Live cross-Document object-URL MSE attach behavior per browser (A1/A5) — unobservable in this environment; settle via the early foregrounded Playwright spike.

## Metadata

**Confidence breakdown:**
- Cross-realm MSE binding mechanism: HIGH (spec + hls.js docs + the same-origin Phase 7/12/13 model) for the DESIGN; the live cross-browser proof is a deferred UAT (A1/A5).
- Native-HLS path + `canPlayType` branch: HIGH (MDN + videosdk + spec).
- Packaging (optional peerDependency + dynamic-import-only): HIGH (npm docs + the verified `package-smoke.mjs` behavior).
- Adapter discovery + `STREAM.MEDIA_HINT`: HIGH on the protocol/wire shape and the adapter hooks (anchored to the codebase); MEDIUM on correlation accuracy (real-network proof deferred).
- Fallback taxonomy + DRM detection: HIGH (hls.js error types + the standard `encrypted` event + reused Phase 12/13 placeholders).
- CSP / connect-src: HIGH on `blob:`-only + no-connect-src reasoning; the empirical confirmation is a deferred UAT.
- No differential-oracle entry: HIGH (verified against `normalize.js`/`harness.js`).

**Research date:** 2026-06-21
**Valid until:** 2026-07-21 (hls.js moves fast — re-verify the version + `attachMedia`/`preferManagedMediaSource`/`isMSESupported` API before the packaging task; everything else is stable).
