# PhantomStream Architecture

This document describes the system as it shipped inside FSB (milestone v0.9.9.1 "Phantom
Stream" plus the reliability hardening of phases 211 and 276). File references point at the
verbatim copies under `reference/`.

For runnable package setup paths, see [QUICKSTARTS.md](QUICKSTARTS.md).

## 1. Overview

PhantomStream mirrors a live browser tab to a remote viewer by streaming the page as
**structured DOM data** rather than pixels:

1. **Snapshot** — a one-time serialization of `document.body`, rebuilt by the
   viewer into a sandboxed iframe. Default `styleMode: 'computed'` inlines
   curated computed styles; opt-in `styleMode: 'cssom'` transports scoped
   `styleSources[]` and `styleStrategy`. Standalone Phase 8 extends the
   snapshot with `nodeIds`, `shadowRoots[]`, and `frames[]` sidecars for
   scoped identity.
2. **Diffs** — incremental MutationObserver batches (`add` / `rm` / `attr` / `text` ops)
   addressed by stable node IDs, applied surgically to the mirror. Phase 8 also
   streams `shadow-root` replacement ops and narrow `value` ops; Phase 9 adds
   CSSOM `style-source` ops.
3. **Side channels** — scroll position, automation overlays (action glow, progress), and
   native dialog mirroring.
4. **Reverse path** — remote control: clicks, typing, and scrolling performed on the mirror
   are reverse-mapped and replayed in the real browser.

```
page (content script)        extension SW           relay server          viewer (dashboard)
dom-stream.js          →     background.js     →    ws-handler.js    →    dashboard.js
snapshot + rAF-batched       LZ envelope,           fan-out,              decompress, iframe
diffs, scroll, overlay,      session stamps,        1 MiB/msg cap         srcdoc render, nid-
dialogs, watchdog #1         watchdog #2                                  addressed diff apply
```

## 2. Capture (`reference/extension/dom-stream.js`)

### 2.1 Node identity

The original FSB reference design stamped every serialized element with
`data-fsb-nid`, a monotonically increasing string ID, on **both** the live DOM
and the serialized clone (`assignNodeId`). That attribute was the original
addressing keystone: every diff op, overlay rect, and remote-control action
addressed nodes by nid, and nodes added after the snapshot got nids in
`processAddedNode`.

The standalone framework design after Phase 7 keeps the same opaque nid wire
contract but removes live-page identity mutation. Capture owns identity in an
internal `WeakMap<Element, string>` plus reverse lookup, emits `nodeIds`
sidecars on snapshots and add ops, and exposes `getNodeId(element)` for trusted
host code. The renderer rebuilds a private `Map<nid, Node>` from `nodeIds`
after sanitization, so page-owned `data-fsb-nid` attributes remain ordinary
page data rather than PhantomStream identity.

### 2.2 Full snapshot (`serializeDOM`)

- Clones `document.body`, then walks original and clone **in parallel** with two
  TreeWalkers so live state can be read while the copy is transformed.
- Strips `<script>`/`<noscript>` and the host's own overlay elements.
- Absolutifies URL attributes (`src`, `href`, `action`, `poster`, `data`, `srcset`,
  SVG `xlink:href`) against `document.baseURI`.
- Converts `<canvas>` to a data-URL `<img>` (tainted canvases degrade gracefully).
- In the FSB reference, iframes stayed live with absolutified `src` and
  `pointer-events:none`. In the standalone Phase 8 framework, same-origin
  iframes serialize as scoped `frames[]` sidecars keyed by `frameNid`, while
  cross-origin iframe content remains a content-free placeholder.
- Open shadow roots serialize as `shadowRoots[]` sidecars keyed by `hostNid`.
  Shadow slots remain slots; slotted light-DOM children are not duplicated.
- Captures **curated computed styles**: ~85 visual-fidelity CSS properties
  (`CURATED_PROPS`) inlined as a `style` attribute, with common default values elided
  (`STYLE_DEFAULTS`). Iterating all 300+ computed properties made a YouTube serialize take
  ~45 s; the curated list restored interactivity.
- Captures `<html>`/`<body>` attributes and a smaller shell style set (`SHELL_PROPS`) so
  the viewer can reproduce page-level background/typography.
- Collects stylesheet URLs (`<link rel=stylesheet>`) and inline `<style>` text (< 500 KB
  each) from `<head>` for the viewer to re-link. In opt-in CSSOM mode this expands
  to scoped `styleSources[]` for document, open shadow root, and same-origin frame
  stylesheets instead of generated computed inline declarations.

### 2.3 Snapshot size budget

The relay enforces a hard 1 MiB per-message cap. Snapshots truncate to 80% of that
(`RELAY_PER_MESSAGE_LIMIT_BYTES * 0.8`) in two passes:

1. Drop complete subtrees whose live `getBoundingClientRect().top` exceeds 3× the viewport
   height. Crucially, all rect reads happen in **one TreeWalker pre-pass over the live DOM
   into a Map before any clone mutation** — collapsing N forced layout flushes into 1.
2. If still over budget, drop remaining annotated subtrees last-to-first until under cap.

Only whole subtrees are removed, never a mid-element cut; `truncated` and
`missingDescendants` counts ship with the snapshot.

### 2.4 Incremental diffs

A `MutationObserver` on `document.body` (childList + attributes + characterData, subtree)
accumulates records; flushes are batched on `requestAnimationFrame` so diff delivery is
matched to the page's paint cadence. `processMutationBatch` converts records to wire ops:

| op | payload | meaning |
|----|---------|---------|
| `add` | `parentNid`, `html`, `beforeNid` | insert serialized subtree |
| `rm` | `nid` | remove subtree |
| `attr` | `nid`, `attr`, `val` | attribute change (URLs re-absolutified) |
| `text` | `nid`, `text` | character data change (addressed via parent nid) |
| `shadow-root` | `hostNid`, `html`, `nodeIds` | replace a mirrored open shadow root after sanitization |
| `value` | `nid`, `value` / `checked` / `selectedValues` | apply property-only form value drift |
| `style-source` | `action`, `sourceId`, `scope`, `source` | upsert, replace, or remove a scoped CSSOM source |

Mutations on untracked nodes (no nid) and on the host's own overlay are skipped.
Open shadow roots and same-origin frame documents are observed explicitly, so
their mutations do not depend on `document.body` observer reachability.
Newly added subtrees carry curated computed styles in add-op HTML, collected in
a read pass before detached clone mutation.

### 2.5 CSSOM style mode

Phase 9 adds `styleMode: 'computed' | 'cssom'`. The default remains computed
style inlining for backward-compatible visual fidelity. CSSOM mode serializes
document, open-shadow-root, and same-origin-frame stylesheets as sanitized
`styleSources[]` entries with `styleStrategy` diagnostics. `sourceId` and
`scope` make stylesheet sources addressable without CSS selectors.

Fallbacks are explicit: `cssRules-blocked`, `href-relinked`, `adapter-fetch`,
or `computed-fallback`. `fetchStylesheet({ href, scope, ownerKind })` is an
optional host hook; PhantomStream does not perform hidden network fetches.
Live stylesheet edits stream as `DIFF_OP.STYLE_SOURCE` with
`action: 'upsert' | 'replace' | 'remove'`. CSSOM hook failures report
`cssom-hook-unavailable` and fall back to a fresh snapshot; unreconciled style
owners use `cssom-style-source-stale`, and renderer misses surface as
`stale-style-scope`.

### 2.6 Subtree recovery

Standalone Phase 8 makes truncation interactive instead of purely passive.
Dropped snapshot roots are replaced by `data-phantomstream-truncated="true"`
markers whose nids stay in `nodeIds`. The viewer or host can request a single
nid with `CONTROL.SUBTREE_REQUEST`; capture answers with
`STREAM.SUBTREE_RESPONSE` carrying either content-free miss status or an `ok`
payload that reuses add-op serialization: sanitized HTML, masking, URL
absolutification, curated styles, `nodeIds`, `shadowRoots[]`, and `frames[]`.
Requests are session/snapshot checked and are bounded by renderer-side latches.

### 2.7 Watchdog #1 (content script)

A 5 s self-watchdog (a `setTimeout` chain, not `setInterval`, so cadence resets on every
drain) force-flushes a stuck mutation queue and increments `staleFlushCount`, which rides
the next flush envelope so the host can observe rescue frequency.

### 2.8 Side channels

- **Scroll** — passive listener, throttled to 1 event / 200 ms.
- **Overlay** — broadcasts the automation action-glow rect and progress card state,
  throttled to 1 / 500 ms, forced on snapshot/resume.
- **Dialogs** — a page-level injected script monkey-patches `window.alert` / `confirm` /
  `prompt` to dispatch `CustomEvent`s before/after the native call; the content script
  relays open/closed states so the viewer can show styled dialog cards.

### 2.9 Lifecycle & readiness

Control messages: `domStreamStart` (fresh session + snapshot + observers),
`domStreamStop`, `domStreamPause` (observers off, session retained),
`domStreamResume` (observers re-armed, same session/snapshot, no snapshot),
`pingDomStream` (synchronous readiness probe).

Auto-start chain: module load → `domStreamReady` ping → host issues stream start. If the
viewer's start request arrives before the module loads (slow pages), the host parks it in
`_pendingStreamStart` and re-arms on the ready ping (`reference/extension/ws-client.js`).

## 3. Transport

### 3.1 Session identity

`beginStreamSession()` mints `streamSessionId` (`stream_<ts36>_<rand>`) and a `snapshotId`
per session; **every** message type carries both. The viewer tracks the active identity,
rejects stale messages, and detects stream replacement (new session/snapshot/tab) to reset
overlays and scroll state. This is what makes late diffs from a previous page harmless.

### 3.2 Compression envelope

Payloads ≥ threshold travel as a self-identifying envelope `{_lz: true, d: <base64>}`
(LZ-string), with plain JSON fallback for small payloads and backward compatibility —
90%+ reduction on 100 KB+ snapshots. Decompression failure is recorded as a transport
error, never a crash.

### 3.3 Relay (`reference/server/ws-handler.js`)

A thin WebSocket fan-out between extension and dashboard clients. Enforces the per-message
size cap (the capture-side truncation budget is derived from it) and classifies oversized
messages by envelope type for diagnostics.

### 3.4 Watchdog #2 (service worker)

A `chrome.alarms` 1-minute alarm (`fsb-domstream-watchdog`) — armed idempotently on every
mutation dispatch — survives MV3 service-worker eviction. On fire, if streaming should be
active, it sends `ext:request-snapshot` so the viewer re-issues a stream start. The
content-script watchdog is the trip wire; this is the safety net for a wedged content
script.

## 4. Renderer (`reference/dashboard/dashboard.js`)

- **Snapshot** (`handleDOMSnapshot`): rebuilds a full HTML document — stylesheet links,
  inline styles, captured shell attributes — and writes it to a preview iframe via
  `srcdoc`. On load, scales the page to the stage and applies the captured scroll offset.
- **Diff apply**: the FSB reference resolved each op with
  `doc.querySelector('[data-fsb-nid="…"]')`. In the standalone framework after
  Phase 7, snapshots/add ops carry `nodeIds` sidecars and the viewer resolves
  nids through an internal `Map<nid, Node>` index. Misses are still recorded
  (a consequence of truncation or lost messages) and degrade to awaiting the
  next snapshot.
- **Shadow/frame reconstruction**: Phase 8 installs real open mirror shadow
  roots from sanitized sidecars and reconstructs same-origin frame payloads as
  inert nested `srcdoc` documents. Cross-origin iframe content is rendered only
  as a safe placeholder label; no origin bypass is attempted.
- **Value/subtree handling**: `DIFF_OP.VALUE` updates form-control properties
  through the identity index. `requestSubtree()` sends bounded
  `CONTROL.SUBTREE_REQUEST` frames and applies current `STREAM.SUBTREE_RESPONSE`
  payloads only after render-side sanitization.
- **Layout modes**: inline, maximized, picture-in-picture (drag-to-reposition), fullscreen
  (mouse-tracked exit overlay), with viewport-adaptive scale math per mode.
- **Overlays**: action glow rect, progress card, and dialog cards positioned in mirror
  coordinates.
- **Remote control**: pointer/keyboard/scroll events on the mirror are reverse-scaled from
  stage coordinates to page coordinates and replayed in the real tab; an active-control
  state is signaled with a visible border.

## 5. Reliability inventory

| Failure mode | Defense |
|---|---|
| Mutation queue stalls (rAF starvation, tab throttling) | content-script watchdog force-flush + `staleFlushCount` telemetry |
| Content script wedged entirely | SW alarm watchdog → `ext:request-snapshot` |
| MV3 service-worker eviction | watchdog lives in `chrome.alarms`; re-armed on every dispatch |
| Snapshot exceeds relay cap | 2-pass whole-subtree truncation at 80% of cap |
| Snapshot/diff payload too big even compressed | relay-side cap + diagnostics classification |
| Late diffs from a previous page | session/snapshot identity stamped on every message, viewer-side rejection |
| Start requested before capture module loads | readiness probe + parked pending-intent re-arm |
| Forced layout thrash during truncation | single read-pass into a Map before any write |
| Heavy pages (300+ computed props/element) | curated 85-property style list + default elision |

## 6. Resolved limitations and residual boundaries

These were weaknesses of the shipped/reference design. The standalone package
has resolved the high-value framework gaps; the remaining items below are
explicit browser/security boundaries or intentional default-mode tradeoffs:

1. **Computed mode still freezes styles by design.** In default computed mode,
   inlined styles are snapshot-time state. Class-flip diffs (`attr` ops) can
   still drift until the next full snapshot. Opt-in CSSOM mode addresses
   stylesheet-driven drift for readable, safely re-linkable, or host-fetched
   sources, with explicit fallback reasons when a source cannot be represented.
2. **Added-node computed styles resolved in standalone Phase 8.** Add ops now
   carry curated computed styles using the same default-elision discipline as
   snapshots. CSSOM mode remains opt-in rather than replacing the default.
3. **Former nid stamping limitation resolved in standalone Phase 7.** The
   reference `data-fsb-nid` live-page mutation is now replaced by WeakMap
   capture identity and `nodeIds` sidecars in the standalone framework. This
   entry remains here as design history for the FSB reference behavior, not as
   a current framework limitation.
4. **Truncation recovery resolved in standalone Phase 8 for explicit requests.**
   Diff targets inside dropped subtrees no longer have to wait for the next full
   snapshot when the host/viewer calls `requestSubtree`. Recovery is still
   bounded and explicit; PhantomStream does not automatically crawl every miss.
5. **Blocklist sanitizer coverage is intentionally conservative.** Capture and renderer
   chokepoints now strip event handlers, dangerous URL schemes, `srcdoc`,
   object/embed/script-like subtrees, and hostile CSS before mirrored content is
   transported or inserted. This is still a framework-maintained blocklist, so the
   viewer iframe remains sandboxed without `allow-scripts` as defense in depth.
6. **Open shadow DOM and same-origin iframes resolved in standalone Phase 8;
   `<video>`/`<audio>` mirrored by reference across the v2.0 milestone.** Media
   is no longer a blanket non-captured boundary: `<video>`/`<audio>` are now
   mirrored **by reference** -- playback state from the snapshot baseline,
   progressive (direct) playback, and best-effort adaptive (HLS/DASH) playback
   driven from a parent-realm surface -- and the media bytes never cross the
   relay. The residual media limits narrow to three cases: DRM/EME-protected
   content, which is unshareable by design and degrades to a poster;
   MSE/`blob:` media with no discoverable manifest, whose origin-local object
   URL is dead at the viewer and degrades to a poster; and raw media
   pixels/frames, which are out of scope because PhantomStream mirrors media
   by reference, not by pixel. Closed shadow roots and cross-origin iframe
   content remain the standing browser security boundaries; the framework
   documents them as non-captured content rather than faking or bypassing them.
