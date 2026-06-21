# Project Research Summary

**Project:** PhantomStream — v2.0 "Asset & Media Streaming" (media-by-reference)
**Domain:** DOM-native live browser mirroring — adding by-reference media/asset replay + playback-sync to a shipped, sandboxed, low-bandwidth mirror
**Researched:** 2026-06-19
**Confidence:** HIGH

## Executive Summary

v2.0 is **not a new asset pipeline — it is playback-sync, adaptive playback, and a new security contract bolted onto a pipeline that already streams assets by reference.** All four research streams converge on the same load-bearing fact: capture already absolutifies `src`/`poster`/`data` (via `URL_ATTRS`) and `srcset` (via `absolutifySrcset`) across all three serialization paths, already passes `blob:`/`data:` through untouched, and does **not** drop `<video>`/`<audio>`/`<source>` (they are absent from `DROP_TAGS`). A `<video src="https://…mp4">` already lands in the mirror and — because progressive media needs no JavaScript — already plays natively inside the existing `allow-same-origin`, no-`allow-scripts` sandbox. The reference model is the proven industry default (rrweb's `inlineImages` is `false`; it transports the URL and re-fetches), so v2.0 is matching a validated baseline for images (~80–90% done) and extending it to `<video>`/`<audio>` playback, which is where rrweb stops short. The work is therefore concentrated in four narrow places: a media-sync side channel, the renderer's player placement, the viewer CSP, and — most importantly — a brand-new viewer-side-fetch threat model.

The single most consequential architectural constraint is the sandbox: `createViewer` hard-asserts `sandbox="allow-same-origin"` with **no `allow-scripts`** and throws `viewer-sandbox-invalid` if anyone weakens it. This decides the entire viewer design. Native/progressive media plays in-sandbox with zero scripts, driven cross-realm by the parent writing `currentTime`/`paused`/`playbackRate` onto `iframe.contentDocument` (exactly how the diff applier already manipulates the mirror). Adaptive players (hls.js/dash.js) need JavaScript **and** MediaSource and therefore **cannot run in the mirror iframe** — they must run in a parent-realm, script-enabled media surface (a new `src/renderer/media.js`) that binds an MSE object to the inert in-iframe element from outside. Weakening the sandbox to "make video work" is a catastrophic XSS regression and is the most dangerous wrong turn the roadmap can take. Exactly **one** optional dependency is justified: `hls.js`, declared as an optional `peerDependency` and lazy-imported viewer-side only. Native HLS (Safari/iOS) needs zero library; DASH is covered only through a host-provided-player seam — do **not** bundle dash.js or shaka.

The highest-severity risks are not in the player — they are in **what the viewer is now allowed to fetch and what leaks while doing it.** v2.0 changes the verb from *render* (v1 rendered attacker-influenced DOM inert) to **fetch**: the viewer's browser now issues GETs to attacker-influenced URLs from its own network position, opening SSRF-from-viewer, tracking-pixel/live-viewer confirmation, and DoS-amplification surfaces that v1 never had — plus signed-URL/PII leakage onto the wire and via the `Referer` header. Two security-contract decisions must land *with* the feature, not after it: (1) the viewer `CSP_META` has **no `media-src`** and falls back to `default-src 'none'`, so real media is silently blocked until the directive is opened; (2) a fail-closed origin/scheme policy hook, URL/query masking through `sanitizeForWire`, `referrerpolicy="no-referrer"`, and a `mediaMode: 'off'|'poster'|'reference'` escape hatch are required. Security must gate and run alongside the visible media phases, never be a final cleanup pass. The convergent build order is: **A** static-asset verification + `currentSrc` enrichment + CSP → **B** video/audio URL + the throttled sync channel → **C** adaptive HLS/DASH + adapter manifest discovery + fallback → **D** security/masking/threat-model/docs/eval, with the security *decisions* (CSP scope, policy hook, `mediaMode`) threaded into A/B rather than deferred.

## Key Findings

### Recommended Stack

The deliberate stance is **platform APIs over libraries**. The entire media-sync feature is built from `HTMLMediaElement` properties (`currentTime`, `duration`, `playbackRate`, `paused`, `seeking`, `currentSrc`) and events (`timeupdate`, `seeked`, `play`, `pause`, `ratechange`, `loadedmetadata`) — zero library. URL handling reuses the existing `absolutifyUrl`/`absolutifySrcset` and the WHATWG `URL` (do **not** add a URL-parsing library). The one justified runtime add is `hls.js@1.6.16` (Apache-2.0, ships ESM `dist/hls.mjs`), made **optional + lazy** because its ~157 KB gzip is larger than many whole snapshots and would contradict the low-bandwidth core value; it is viewer-only and situational. Capability is gated viewer-side with `video.canPlayType('application/vnd.apple.mpegurl')` (native HLS → no lib) falling to `Hls.isSupported()`. Testing splits cleanly: jsdom has **no real media stack**, so the protocol + the drift/reconcile logic are unit-tested as pure functions, and true playback / native-HLS / CDP manifest discovery are exercised in the existing Playwright UAT.

**Core technologies:**
- **`URL` (WHATWG) + existing `absolutifyUrl`/`absolutifySrcset`**: absolutize + scheme-classify + origin-classify media URLs at capture — already load-bearing; reuse, do not add a library.
- **`HTMLMediaElement` DOM API (properties + events)**: capture playback state on the origin and reproduce it on the viewer — the whole sync feature, 100% platform, zero library.
- **`canPlayType()` / `MediaSource.isTypeSupported()`**: viewer capability gate (native HLS vs hls.js vs placeholder) — prefer native HLS, skip the lib entirely on Safari/iOS.
- **`hls.js@1.6.16` (optional `peerDependency`, lazy `import()`, viewer-side only)**: play HLS where the browser lacks native support — the only library whose value justifies its weight, kept off the default download.
- **Do NOT use**: `dash.js`/`shaka-player` as bundled deps (host-provided-player seam only), a URL library, media-byte relay/inlining, MSE/`blob:` rehydration, or running any player inside the mirror iframe.

### Expected Features

rrweb is the proven prior art and validates the entire thesis: media-by-URL is the default, not a novel bet. rrweb captures initial media state as `rr_media*` snapshot attributes and ongoing changes as exactly five `MediaInteraction` events (`play`/`pause`/`seeked`/`volumechange`/`ratechange`) throttled to ~500ms, then **interpolates on the replay side** with offset-from-last-event math — proving that drift-corrected sync is *table stakes done right*, not a differentiator, and that a naive one-shot `currentTime` set desyncs within seconds. The bandwidth contrast is the justification to cite against any pixel-fallback proposal: a single 1080p30 WebRTC stream is 14 Mbps (Hyperbeam) — ~100–1000× a DOM-diff mirror.

**Must have (table stakes):**
- Image/`srcset`/`<picture>`/`background-image` by URL — **already shipped**; v2.0 verifies + documents it as a media feature.
- Poster + dimensioned placeholder fallback — every media path degrades here; needed before any video ships.
- Initial media state in the snapshot (currentTime/paused/muted/volume/rate/loop) — the baseline the deltas anchor to.
- Play/pause/seek/volume/rate sync via small per-nid state messages — the defining "is this mirroring the video?" capability.
- Drift-corrected `currentTime` interpolation in the viewer (offset-from-last-event, throttled ~250–500ms) — without it, "sync" is a lie within seconds.
- Direct/progressive URL playback (`.mp4`/`.webm`/`.mp3`/`.ogg`) with an autoplay-policy-correct viewer (muted default, `play()`-rejection affordance).
- Looped + animated-image correctness (GIF/WebP/APNG animate natively by reference — strictly better than rrweb's `inlineImages`, which freezes them).

**Should have (competitive):**
- Best-effort HLS/DASH **manifest-URL** mirroring (the real deliverable behind "best-effort"; session-replay tools flatly don't support streamed video) — gated on manifest discovery.
- Live-stream handling (live-edge sync, no absolute seek when `duration === Infinity`) — a correctness win rrweb doesn't address.
- Drift-corrected sync as a documented, tunable contract; per-media capability/fallback telemetry (`{url, failed}`-style).

**Defer / exclude (anti-features):** re-encode/transcode, WebRTC/pixel relay, DRM/EME capture, media-byte inlining (data:), live `<canvas>`/WebGL frame streaming, Web Audio/`getUserMedia` capture, frame-accurate sync guarantees. Each conflicts with the low-bandwidth core value or the sandbox/security posture. An opt-in **byte-capped small-image** inline (images only, never media) is the only v2.x escape hatch worth keeping.

### Architecture Approach

This is an **integration design for a shipped framework, not a redesign** — the four-stage pipeline (capture → protocol/envelope → raw byte-verbatim relay → sandboxed renderer) and its invariants (1 MiB per-message cap, `allow-same-origin`-only iframe, dual capture/render sanitize chokepoints, identity stamping) are fixed constraints media must ride, not bend. The relay and envelope are **never touched**: `STREAM.MEDIA` is just another type string the relay classifies in diagnostics, and old viewers ignore an unknown type via the renderer dispatch's silent `default` — so the change is forward/backward compatible by construction. There is **no new top-level module**; media is an aspect of capture (a read-pass + a throttled side channel) and the renderer (an element controller), with the only genuinely new file being `src/renderer/media.js` for the lazily-loaded adaptive-player host.

**Major components:**
1. **Capture media-state reader + sync tracker** (`collectMediaState()`, `startMediaSyncTracker()` in `src/capture/index.js`) — a throttled, nid-addressed, identity-stamped side channel that is a structural twin of `startScrollTracker`; `currentTime` is "the scroll-position of media."
2. **Protocol op** (`STREAM.MEDIA` + `MediaStatePayload` typedef in `messages.js`, `MEDIA_SYNC_THROTTLE_MS` in `constants.js`) — the entire wire-surface change is one type + one typedef + one constant.
3. **Renderer media controller** (`handleMedia()`/`installMedia()` + `src/renderer/media.js`) — native playback drives the inert in-iframe element cross-realm; adaptive playback runs hls.js/dash.js in the **parent realm** and binds MSE to the in-iframe element; applies sync with drift tolerance, never a hard per-frame seek.
4. **Renderer CSP** (`CSP_META` in `snapshot.js`) — add `media-src http: https: blob:` (the `blob:` covers the parent-created `MediaSource` object URL); keep `default-src 'none'`, never add `script-src`.
5. **Adapter manifest discovery** (`src/adapters/playwright.js` CDP `Network.responseReceived`, `extension.js` `webRequest`) — out-of-band, opt-in, graceful-absence-mandatory hints fed in via the `fetchStylesheet`-precedent seam; the core never sniffs the network.

### Critical Pitfalls

1. **Viewer fetching attacker-controlled URLs is a new SSRF/tracking/beaconing surface (the defining v2.0 pitfall)** — v1 rendered inert; v2.0 fetches from the viewer's network with its IP/reachability. Mitigate with a **fail-closed host origin/scheme/private-IP policy hook applied at the renderer before the URL is written**, a conservative default (https-only, block internal ranges), and a `mediaMode: 'off'|'poster'|'reference'` escape hatch. URL-scheme sanitization (`hasDangerousScheme`) is *injection* safety and is a different control from *fetch* safety. **Owned by P4, must land before/with P1.**
2. **Mirrored `<video>` is silently blocked by the existing CSP (no `media-src`)** — `media-src` falls back to `default-src 'none'`, so real media fetches nothing and looks like a URL bug. Add a scoped `media-src`, keep `default-src 'none'` with no `script-src`, update `docs/SECURITY.md`, and add a srcdoc-assertion test. **Directive in P2; the scope decision is a P4 contract.**
3. **Putting the player inside the no-`allow-scripts` sandbox** — it cannot run, and the tempting "fix" (`allow-scripts`) is a total XSS regression. Drive playback from the **parent** realm; keep the single-token sandbox assertion and extend the `allow-scripts`-forbidden scan to media code paths.
4. **Naive `currentTime`-on-every-message seek-storm + driving sync off `timeupdate` (only ~4Hz) + ignoring the state machine** — setting `currentTime` triggers a real seek/re-buffer; doing it continuously stutters and thrashes the decoder. Use **drift tolerance** (hold within ~0.25–0.5s, rate-nudge for small persistent drift, hard-seek only on large drift or explicit `seeked`), model playback as a small state machine (seek/stall/rate/pause/ended/loop), and extrapolate between throttled samples.
5. **`blob:`/MSE references and signed/expiring CDN URLs are dead at the viewer** — `blob:`/MSE is origin-local (blank mirror on YouTube/Twitch); signed URLs expire/single-use/credential-bind by the time the viewer loads. **Detect `blob:` at capture and never emit it as fetchable** → try manifest (P3) else poster; treat signed URLs as best-effort with fetch-time re-resolve and `error`→poster fallback. Plus: **signed-URL/PII leakage** onto the wire and via `Referer` needs URL/query masking through `sanitizeForWire` and `referrerpolicy="no-referrer"` (P4).

## Implications for Roadmap

Based on research, the suggested phase structure is a **strict capability chain A → B → C → D**, with security decisions front-loaded into A/B rather than deferred. The protocol/constant additions land in B; the relay and envelope are never touched. Each phase is independently runnable and demoable and ends green against `node --test` + the differential oracle.

### Phase A: Static Assets by Reference (foundation, lowest risk)
**Rationale:** ~80–90% already shipped (URL_ATTRS absolutify, absolutifySrcset, media tags not dropped). Lowest-risk integration because the machinery exists; elements + URLs must be indexed before sync can address them.
**Delivers:** verified `<img>`/`<picture>`/`<source>`/`<video poster>`/`<audio>`/svg `<image>` by reference; clone-only `data-ps-currentsrc` enrichment in the three serialization paths (ledgered for the oracle); `media-src` added to `CSP_META` so posters/images fetch in-sandbox; optional `maskAssetUrls`/`maskAssetUrlFn` via a `sanitizeForWire('media-url')` dispatch (default off, byte-identical).
**Addresses:** image/srcset/picture/background-image by URL; poster+placeholder fallback.
**Avoids:** Pitfall 2 (the policy-hook/`mediaMode` decision must be present here since static images are already part of the fetch surface), Pitfall 1 (CSP scope decision), Pitfall 11 (no `data:` media bloat), Pitfall 12 (`crossorigin`/`referrerpolicy` preservation, mixed-content/CORS → poster).

### Phase B: Video/Audio URL + Playback Sync (the core new capability)
**Rationale:** the defining v2.0 feature; depends on A (the element + URL must be on the wire and indexed first).
**Delivers:** `STREAM.MEDIA` + `MediaStatePayload` + `MEDIA_SYNC_THROTTLE_MS`; capture `trackedMediaElements` registry + `collectMediaState()` + `startMediaSyncTracker()`/`stopMediaSyncTracker()` wired into lifecycle next to the scroll tracker (masked/blocked media emit no state); renderer `handleMedia` driving native progressive playback in the inert in-iframe element + drift-tolerant `syncMedia`; muted-autoplay default with a parent-realm `play()`-rejection affordance.
**Uses:** `HTMLMediaElement` properties/events (zero library); the scroll/overlay throttle + identity discipline.
**Implements:** the media-sync side channel (Architecture Pattern 2) and the parent-realm cross-realm media controller (Pattern 3/4 native path).
**Avoids:** Pitfall 3 (seek-storm — drift tolerance + rate-nudge), Pitfall 4 (`timeupdate` 4Hz + state machine), Pitfall 5 (player must be parent-driven; sandbox-invariant test extension), Pitfall 7 (autoplay), Pitfall 9 (wire-spam — throttle + extrapolate + coalesce; this protects the core value), Pitfall 15 (stamp + `isCurrentStream`-guard + nid-index resolve).

### Phase C: Adaptive (HLS/DASH) + Adapter Discovery + Fallback
**Rationale:** the differentiator; reuses B's media element + sync channel — only the source-binding mechanism differs. Highest complexity and explicitly best-effort.
**Delivers:** `src/renderer/media.js` — `isAdaptive` detection, lazy host-supplied `mediaPlayers` (hls.js/dash.js) running in the **parent realm** and binding cross-realm to the in-iframe element; poster fallback when no player is supplied or for MSE-only/DRM (out of scope by design); capture `mediaSourceHints` registry + `window.__phantomStreamMediaHint` hook; Playwright/CDP `Network` manifest discovery and extension `webRequest` discovery (both opt-in, graceful absence proven).
**Uses:** `hls.js` (optional, lazy, native-HLS-first via `canPlayType`); CDP `Network`/`page.on('response')` (already the adapter's surface — no new dep); host-provided-player seam for DASH.
**Avoids:** Pitfall 8 (`blob:`/MSE → manifest-else-poster, never blob on wire), Pitfall 6 (signed/expiring URLs → fetch-time re-resolve + poster), Pitfall 14 (live streams → `isFinite(duration)` branch, rejoin live-edge), Anti-Pattern 5 (no hidden network fetch in the core).

### Phase D: Security Hardening, Masking Completeness, Docs, Eval
**Rationale:** closes the milestone; threat-reviews the parent-realm MSE cross-realm binding and codifies the contract. **Security *decisions* are front-loaded into A/B; D is where they are completed, threat-modeled, and tested — not where they begin.**
**Delivers:** threat-review of the object-URL blast radius (confirm the child still cannot script); URL/query masking + `referrerpolicy="no-referrer"` + secrets-on-wire documentation; `maskMediaSelector`/`blockSelector` for private media (omit URL from the wire); media-specific security tests (hostile `<source src=javascript:>`, `media-src` CSP coverage, masked-media-no-state, sandbox-token unchanged); `docs/SECURITY.md`/`docs/ARCHITECTURE.md` updates (limitation #6 — `<video>`/`<audio>` no longer fully out); evaluation-harness arm (media-by-reference bandwidth/latency vs CDP screencast/WebRTC for the paper).
**Avoids:** Pitfall 2 (completes the policy hook + `mediaMode`), Pitfall 10 (signed-URL/PII leakage), Pitfall 13 (media masking + `currentSrc` pin).

### Phase Ordering Rationale

- **Strict capability dependency:** A unblocks B (elements/URLs must be indexed before sync can address them by nid); B unblocks C (adaptive reuses the media element + sync channel, differing only in source binding); D depends on A–C. Inside C, the renderer adaptive player and the two adapter discovery integrations (Playwright vs extension) are mutually independent and can parallelize.
- **Architecture-driven grouping:** media is an aspect of capture + renderer, so phases align to those seams; the relay/envelope are deliberately untouched across all phases (one type string + back-compat by construction).
- **Security threaded, not trailing:** the four streams converge on treating the viewer-fetch threat model, CSP scope, policy hook, and `mediaMode` as **decisions made in A/B and completed in D** — because every earlier phase emits content the viewer fetches. Treating D as a cleanup pass is the documented HIGH-recovery-cost failure (post-ship SSRF/tracking, leaked tokens).

### Research Flags

Phases likely needing deeper research (`/gsd:plan-phase --research-phase <N>`) during planning:
- **Phase C (Adaptive + discovery):** the only genuinely uncertain area. Cross-realm MSE binding (creating `MediaSource` in the parent and assigning its object URL to the in-iframe `<video>`) has browser-quirk risk and needs empirical Playwright validation; manifest→element correlation from CDP/`webRequest` initiator chains is heuristic; whether the child needs `connect-src` (vs the parent doing all segment fetches) must be verified empirically. hls.js cross-realm `attachMedia(iframeEl)` behavior should be spiked.
- **Phase D (Security):** the threat-model is well-articulated in research, but the parent-realm object-URL blast-radius review and the precise default origin/private-IP denylist warrant a focused security pass during planning.

Phases with standard patterns (skip research-phase):
- **Phase A:** mostly verification of shipped behavior + a small clone-only enrichment + one CSP directive; well-understood, established in the existing pipeline.
- **Phase B:** the media-sync channel is a documented twin of the existing scroll/overlay side channels; rrweb provides the proven reconciler model; the reconciler is a pure function unit-testable in jsdom.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Library versions, media-element APIs, native-HLS detection, CDP/Playwright manifest signals all verified against current primary sources (Context7, npm/Snyk, Bundlephobia, MDN, CDP docs). The one MEDIUM item (hls.light ~50KB) is flagged inline and non-load-bearing. |
| Features | HIGH | rrweb behavior cited from primary source (`packages/types`, `record/observer.ts`, `rrweb-snapshot/snapshot.ts`, `replay/media/index.ts`, `guide.md`). Co-browsing/pixel-tool bandwidth numbers are vendor-doc MEDIUM but corroborated and directional. |
| Architecture | HIGH | Every integration point is a named real file/function in the shipped source (`src/capture/index.js`, `src/renderer/`, `src/protocol/`, `src/relay/`, `src/transport/`, `src/adapters/`); the sandbox assertion, CSP, identity index, and side-channel patterns are read directly, not inferred. |
| Pitfalls | HIGH | Security/CSP/sandbox/browser-policy items verified against shipped source + MDN/WHATWG. MEDIUM only on specific drift-tolerance numbers (tuning targets to validate empirically) and the jsdom testing tactics (single-runtime-verified). |

**Overall confidence:** HIGH

### Gaps to Address

- **Cross-realm MSE binding feasibility (Phase C):** creating `MediaSource` in the parent and binding its object URL to an in-iframe `<video>`, with hls.js/dash.js running in the parent and `attachMedia`-ing the iframe element, is sound in principle but unproven across browsers here. Spike in Playwright early in C; if a browser blocks it, the fallback is poster + "media not mirrorable" (already the graceful-absence path), so the milestone is not at risk — only the adaptive differentiator is.
- **Whether the child iframe needs `connect-src` (Phase C):** in the recommended design the parent fetches all segments, so `media-src ... blob:` should suffice; confirm empirically and add `connect-src` only if a `blob:` MSE source triggers a child-side check. Keep `default-src 'none'`/no `script-src` regardless.
- **Drift-tolerance thresholds (Phase B):** ~0.25–0.5s hold / rate-nudge band / large-drift hard-seek are practice-based starting points; tune against the evaluation harness and real network latency. Design the reconciler as a pure function so the numbers are configurable and table-tested, not baked in.
- **Manifest→element correlation precision (Phase C):** initiator-chain correlation is heuristic; when it fails, offering the most-recent main-frame manifest to any unmatched adaptive element is an accepted best-effort imprecision — document it, don't try to make it exact.
- **Default origin/private-IP policy (Phase D):** the conservative default (https-only, block `localhost`/link-local/private ranges) needs a concrete denylist and host-override surface settled during D planning.

## Sources

### Primary (HIGH confidence)
- PhantomStream shipped source — `src/capture/index.js` (`URL_ATTRS`, `absolutifyUrl`/`absolutifySrcset`, three serialization paths, `startScrollTracker`/`broadcastOverlayState(force)`, lifecycle, masking/block helpers, `fetchStylesheet` seam), `src/renderer/index.js` (sandbox `allow-same-origin`-only assertion 209–213, `dispatch` silent default, `handleScroll`, cross-realm `iframe.contentDocument` write, `resolveIndexedNode`, parent-realm overlays), `src/renderer/snapshot.js` (`CSP_META`, no `media-src`, `style-src` widening precedent), `src/renderer/sanitize.js`/`diff.js` (`DROP_TAGS`, `hasDangerousScheme`), `src/protocol/messages.js`/`constants.js` (STREAM/DIFF_OP, identity stamping, throttle constants), `src/relay/relay.js` (raw byte-verbatim fan-out + cap), `src/transport/websocket.js` (envelope + per-message `ts`), `src/adapters/playwright.js` (CDP session, binding bridge).
- rrweb primary source — `packages/types` (`MediaInteractions`, `mediaInteractionParam`, `EventType`/`IncrementalSource`, `assetParam`), `record/observer.ts` (5 events, `sampling.media` 500ms, event-driven only), `rrweb-snapshot/snapshot.ts` (src/srcset/href absolutify, `rr_media*`, `inlineImages`), `replay/media/index.ts` (`MediaManager` drift-corrected interpolation), `guide.md` (defaults: `inlineImages:false`, etc.).
- MDN/WHATWG — `HTMLMediaElement` properties + events; `timeupdate` ~4Hz throttling; CSP `media-src`/`connect-src` (falls back to `default-src`); autoplay policy (`NotAllowedError`, muted-autoplay allowed, iframe `allow=autoplay`); MSE/`blob:` origin-locality; `crossorigin`/`referrerpolicy`; mixed-content blocking. Chrome DevTools Protocol Network domain (manifest MIME + resource type). Playwright `Request.resourceType()` `manifest`.
- npm/Snyk/Bundlephobia — `hls.js@1.6.16` (Apache-2.0, ESM `dist/hls.mjs`/`hls.light.mjs`, min 511,956B / gzip 156,903B); `dash.js@5.2.0` (BSD-3); `shaka-player@5.1.10` (Apache-2.0). Context7 `/video-dev/hls.js` (scope/identity).
- `docs/SECURITY.md` (threat model "input rendered inert"; host must-nevers incl. "never add `allow-scripts`"; masking guarantees), `docs/ARCHITECTURE.md` (CSP/sandbox; limitations #5/#6), `docs/DESIGN-HISTORY.md` ("identity beats ordering"; throttled side channels), `.planning/PROJECT.md` (Core Value low-bandwidth; v1 `<video>`/`<audio>` scoped out with poster).

### Secondary (MEDIUM confidence)
- Hyperbeam FAQ bandwidth table (720p@24fps 5 Mbps … 1080p@30fps 14.1 Mbps; sharp mode ×3) + HN launch (server Chromium + WebRTC A/V); Surfly platform (DOM-rewriting proxy); browserless screencast (CDP JPEG frames ~50–100 KB/frame). hls.js `hls.light.mjs` ~50KB community discussion. Session-replay norms ("only static publicly-hosted videos captured").

### Tertiary (LOW confidence)
- Specific drift-tolerance numbers (~0.25–0.5s hold band, large-drift hard-seek threshold) — practice-based tuning targets to validate empirically in the evaluation harness; jsdom testing tactics single-runtime-verified.

---
*Research completed: 2026-06-19*
*Ready for roadmap: yes*
