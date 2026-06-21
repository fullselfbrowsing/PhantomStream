# Phase 14: Adaptive Streaming + Adapter Discovery + Fallback - Context

**Gathered:** 2026-06-21
**Status:** Ready for planning

<domain>
## Phase Boundary

Best-effort adaptive playback. When an HLS (`.m3u8`) or DASH (`.mpd`) manifest URL is
available, the viewer plays it via an **optional, lazy player running in a renderer-owned
parent realm** that binds cross-realm to the inert in-iframe `<video>` (the no-`allow-scripts`
sandbox is unchanged). Playwright/CDP and extension adapters surface manifest URLs by
**network observation** as opt-in hints with graceful absence. Media that cannot be
referenced (MSE/`blob:` without a discoverable manifest, DRM/EME) **degrades to poster with
an observable, documented reason** — the mirror never breaks. Live streams are handled
(live-edge sync, no absolute seek). Requirements: MADPT-01..04.

Adaptive **reuses** the Phase 13 media element, the `STREAM.MEDIA` sync channel, and the
pure drift reconciler — only the source-binding mechanism differs (a parent-realm
`MediaSource` object URL instead of a progressive source URL). In scope: the parent-realm
player + cross-realm MSE/blob binding; native-HLS-first detection; the host `playerFactory`
seam (DASH + custom) + optional lazy hls.js; the `STREAM.MEDIA_HINT` discovery op + adapter
network observation (Playwright/CDP + extension); the `onMediaUnavailable(nid, reason)` +
`media-unavailable` overlay fallback; live handling; `media-src blob:` CSP add.

Out of scope (Phase 15): the **completion** of the parent-realm object-URL **threat model**
(MSEC-04) and the asset/media URL **masking vocabulary** (MSEC-03). Phase 14 makes the
binding and documents its threat surface; Phase 15 threat-models it. The relay and envelope
stay untouched. No bundled hls.js/dash.js — the published module stays zero-*runtime*-dep.

</domain>

<decisions>
## Implementation Decisions

### hls.js Delivery & Player Seam (MADPT-01)
- **Primary contract = a host-provided `playerFactory` config seam.** The published package
  adds **no bundled runtime player**; hosts inject their own (hls.js / dash.js / Shaka) via
  `playerFactory(ctx) -> PlayerAdapter`. This preserves the zero-runtime-dependency ethos.
- **Optional lazy hls.js** = an `import('hls.js')` attempt **only** when no `playerFactory` is
  provided AND hls.js is present as an installed **optional `peerDependency`** (`peerDependencies`
  + `peerDependenciesMeta.optional: true`). If the import fails, degrade gracefully (poster +
  reason) — never a hard error.
- **Native HLS first.** Feature-detect `video.canPlayType('application/vnd.apple.mpegurl')`;
  if native (Safari), bind the manifest URL **directly** to the element — no MSE, no library.
  Otherwise use the parent-realm MSE player.
- **DASH only via the host seam.** No bundled dash.js; absent a `playerFactory`, DASH degrades
  to poster with reason `no-player`.
- **Binding mechanism.** The parent realm creates `MediaSource`, sets the in-iframe
  `<video>.src = URL.createObjectURL(mediaSource)` cross-realm, and (for hls.js)
  `attachMedia(iframeVideoEl)` from the parent; the Phase 13 reconciler still drives
  play/pause/seek. The MSE player initializes from the same snapshot `media[]` baseline
  (`applyMediaBaseline`). Sandbox stays exactly `allow-same-origin`.

### Adapter Manifest Discovery (MADPT-02)
- **Mechanism = opt-in network observation, off by default.** Playwright via
  `page.on('response')` (and/or CDP `Network.responseReceived`); extension via
  `chrome.webRequest.onCompleted` (or `chrome.debugger` Network), filtering `.m3u8`/`.mpd`
  by extension + content-type.
- **manifest→element correlation = best-effort.** Use initiator/frame + timing + a
  single-active-media heuristic; when ambiguous, emit the hint as **page-level** and let the
  viewer match it to an MSE-opaque media element on play. Never block on perfect correlation.
- **Hint transport = a new opt-in `STREAM.MEDIA_HINT` op** (a structural twin of
  `STREAM.MEDIA`): nid-or-page addressed, identity-stamped (`streamSessionId`, `snapshotId`),
  within the raw-relay + 1 MiB cap, **backward-compatible** (old viewers ignore the unknown
  type; relay + envelope unchanged).
- **Graceful absence is mandatory.** Discovery is fully opt-in; with no adapter and no hints,
  the viewer plays **native-progressive-only with zero errors** (the Phase 13 path is intact).

### Fallback & Never-Break (MADPT-03, MADPT-04)
- **Reason surface = a new `onMediaUnavailable(nid, reason)` config callback** (the
  `onMediaBlocked` family, NOT the throwing `on()` allowlist) **plus a passive
  `media-unavailable` overlay** (a sibling of the poster/blocked affordances, `textContent`
  only). Reason codes: `no-manifest` (MSE/`blob:` source with no discoverable manifest),
  `drm` (EME/encrypted), `mse-opaque` (MSE bind failed), `no-player` (DASH/unsupported with
  no `playerFactory`).
- **Degradation target = the element's poster if present, else the dimensioned placeholder**
  (the Phase 12 `data-ps-asset-unavailable` mechanism) — never a broken/empty element. The
  mirror never breaks.
- **Live streams reuse the reconciler live branch** (infinite/NaN duration → rejoin-edge, no
  absolute seek). The player binds the live manifest; the reconciler does live-edge sync.
- **DRM/EME detection = immediate degrade.** Detect via the `encrypted` event / an EME key-system
  request / HLS `#EXT-X-KEY` → poster + reason `drm`; never attempt to mirror protected content.

### Security / CSP for the Parent-Realm Player (threads into Phase 15)
- **`media-src` gains `blob:` only** (for the MSE object URL). Keep `default-src 'none'`, **no
  `script-src`**, and the sandbox token unchanged. (Phase 13 deliberately excluded `blob:`;
  Phase 14 adds it for MSE.)
- **The parent realm fetches all segments** (the player runs in the parent and fetches via the
  parent's `fetch`/XHR), feeding the `SourceBuffer`; the in-iframe element only plays the blob
  → the **iframe needs no `connect-src`**. Verify empirically; parent-fetch is the default
  (keep `default-src 'none'`/no `script-src` regardless of the finding).
- **Same fail-closed origin gate.** Manifest URLs and segment URLs pass the **same**
  `assetOriginPolicy` / `classifyAssetOrigin` gate as Phase 12/13 (https-only, block
  private/internal ranges); a manifest from a blocked origin → poster.
- **Object-URL blast radius is documented here, threat-modeled in Phase 15** (MSEC-04). Phase 14
  builds the cross-realm object-URL binding and records the threat surface; Phase 15 completes
  the threat model and the media-masking vocabulary.

### Claude's Discretion
- Exact `STREAM.MEDIA_HINT` op value and `MediaHintPayload` typedef shape (follow the
  `STREAM.MEDIA`/`MediaSyncPayload` conventions from Phase 13).
- `PlayerAdapter` interface shape (e.g. `{ attach(el, manifestUrl, ctx), destroy(), onError }`)
  and `playerFactory` ctx — keep minimal and host-friendly.
- Whether the optional hls.js lazy import is wired now or left as a documented `playerFactory`
  example only (prefer whichever keeps the published module provably zero-runtime-dep and the
  test suite jsdom-runnable).
- Internal naming of the parent-realm player module/helpers and the `media-unavailable`
  overlay markup, consistent with `src/renderer/` + `overlays.js` conventions.
- Whether a differential-oracle ledger entry is needed (the extracted core does not change the
  capture wire for adaptive — `STREAM.MEDIA_HINT` originates in the ADAPTER, not capture — so
  likely none; confirm against the oracle).

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets (from the Phase 14 code scout)
- **Phase 13 driver to reuse** — `src/renderer/index.js`: `handleMedia` (~1744), `ensurePlaying`
  (~1658), `applyMediaAction` (~1688), `applyMediaBaseline` (~1805), `resolveIndexedNode` (~1005),
  `STREAM.MEDIA` dispatch (~1863). The MSE player resolves the **same nid** and the reconciler
  output drives both the element and the opt-in player.
- **Config surface** — `createViewer(cfg)` (~281-355): existing keys `mediaMode`, `assetOriginPolicy`,
  `allowAssetOrigins`, `onMediaBlocked`, `mediaReconcileConfig`. Host callbacks use the
  config-callback family (like `assetOriginPolicy`/`onMediaBlocked`), NOT the `on(event,handler)`
  allowlist that throws on unknown names. Add `playerFactory`, `onMediaUnavailable` (and optionally
  `hlsLoaderUrl`) here.
- **Overlays** — `src/renderer/overlays.js` `createOverlays()` (~351) + `register(kind, renderFn)`;
  the `media-blocked`/`media-unmute`/`media-poster` affordances (~537-687) are the siblings the new
  `media-unavailable` reason overlay copies. `textContent` only; inline-SVG glyphs are the sole
  `innerHTML` (`ICON_SVG`/`MEDIA_GLYPH` precedent).
- **Adapters** — `src/adapters/playwright.js` `createPlaywrightAdapter` (~67) with `addPageListener`
  (~217) → `page.on('response', ...)` is the manifest-observation hook. `src/adapters/extension.js`
  `createExtensionAdapter` (~137) with `ensureCDPSession` (~210) → `chrome.webRequest`/`chrome.debugger`.
- **Fallback precedent** — Phase 12 placeholder `data-ps-asset-unavailable` with a reason value
  (`src/renderer/index.js` ~372, `src/renderer/snapshot.js` `PLACEHOLDER_MARKER` ~205); Phase 13
  `onMediaBlocked(nid)` + affordance (~1630). `onMediaUnavailable(nid, reason)` mirrors this.
- **CSP** — `CSP_META` (`src/renderer/snapshot.js` ~545): `default-src 'none'; img-src ...; media-src
  http: https: data:; ...`. Add `blob:` to `media-src` for MSE. Sandbox assertion exactly
  `allow-same-origin` (`src/renderer/index.js` ~524-534) — unchanged.
- **Packaging** — `package.json`: deps `{ ws }` only (relay); ESM subpath exports, no build step.
  Add hls.js as `peerDependencies` + `peerDependenciesMeta.optional: true` (NOT a hard dep).

### Established Patterns
- New `STREAM.*` ops → `src/protocol/messages.js` with a typedef; new constants → `constants.js`.
  Old viewers ignore unknown types (renderer dispatch switch silently drops them).
- Fallible helpers return `{ok, ...}`; pure helpers return primitives. Tests: `node --test ...`;
  renderer tests jsdom + srcdoc assertions; adapters tested with mock `page`/`chrome` objects.
- **Environment limit (carried from Phase 13):** the FSB automation browser runs tabs hidden, so
  real MSE/adaptive playback can't be observed live (Chrome suspends media in hidden tabs). The
  cross-realm MSE binding is implemented with robust feature-detection + graceful fallback; live
  proof is a documented UAT (deferred), with the poster fallback as the never-break safety net.

### Integration Points
- **Protocol:** `STREAM.MEDIA_HINT` op + `MediaHintPayload` typedef; no envelope/relay change.
- **Renderer:** a parent-realm player module (MSE/blob bind + native-HLS path), `playerFactory`/
  `onMediaUnavailable` config, the `media-unavailable` overlay, `media-src blob:` CSP add, DRM/
  opaque/no-manifest → poster, live-edge via the reconciler.
- **Adapters:** opt-in manifest observation (Playwright `page.on('response')`, extension
  `webRequest`/`debugger`) emitting `STREAM.MEDIA_HINT`.
- **Packaging:** optional hls.js peerDependency; keep zero hard runtime deps.
- **Tests:** mock-page/chrome adapter discovery tests; jsdom player-bind unit tests (stub MSE/
  MediaSource); CSP `blob:` string assertion; fallback-reason tests; live-branch reconciler reuse.

</code_context>

<specifics>
## Specific Ideas

- The cross-realm MSE binding (parent `MediaSource` → in-iframe `<video>.src = blob:` →
  `attachMedia(iframeEl)` from the parent) is the milestone's only genuinely uncertain area;
  design it behind feature-detection so failure degrades to poster, never breaks the mirror.
- Verify the parent-fetches-segments model means the iframe needs no `connect-src`; keep
  `default-src 'none'`/no `script-src` regardless of the finding.
- No media/segment bytes traverse the relay — bytes load from the manifest/CDN in the viewer's
  browser (the low-bandwidth core value); only nid/page-addressed hints + playback state cross.

</specifics>

<deferred>
## Deferred Ideas

- Parent-realm object-URL **threat model** completion + asset/media URL **masking vocabulary**
  (`maskMediaSelector`, `maskAssetUrls`) + `referrerpolicy="no-referrer"` completion → Phase 15
  (MSEC-03, MSEC-04).
- Bundled DASH (dash.js) / Shaka — host-provided via `playerFactory` only; never bundled.
- Real-browser adaptive/MSE playback UAT (live-edge sync, segment fetch, DRM degrade observed in
  Chrome) → documented UAT, deferred (FSB runs tabs hidden; same precedent as Phase 13).

</deferred>
