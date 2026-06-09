# PhantomStream Architecture

This document describes the system as it shipped inside FSB (milestone v0.9.9.1 "Phantom
Stream" plus the reliability hardening of phases 211 and 276). File references point at the
verbatim copies under `reference/`.

## 1. Overview

PhantomStream mirrors a live browser tab to a remote viewer by streaming the page as
**structured DOM data** rather than pixels:

1. **Snapshot** — a one-time, style-inlined serialization of `document.body`, rebuilt by the
   viewer into a sandboxed iframe.
2. **Diffs** — incremental MutationObserver batches (`add` / `rm` / `attr` / `text` ops)
   addressed by stable node IDs, applied surgically to the mirror.
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

Every serialized element is stamped with `data-fsb-nid`, a monotonically increasing string
ID, applied to **both** the live DOM and the serialized clone (`assignNodeId`). This is the
keystone of the whole system: every diff op, overlay rect, and remote-control action
addresses nodes by nid. Nodes added after the snapshot get nids in `processAddedNode`.

### 2.2 Full snapshot (`serializeDOM`)

- Clones `document.body`, then walks original and clone **in parallel** with two
  TreeWalkers so live state can be read while the copy is transformed.
- Strips `<script>`/`<noscript>` and the host's own overlay elements.
- Absolutifies URL attributes (`src`, `href`, `action`, `poster`, `data`, `srcset`,
  SVG `xlink:href`) against `document.baseURI`.
- Converts `<canvas>` to a data-URL `<img>` (tainted canvases degrade gracefully).
- Keeps iframes live with absolutified `src` but neuters them with `pointer-events:none`.
- Captures **curated computed styles**: ~85 visual-fidelity CSS properties
  (`CURATED_PROPS`) inlined as a `style` attribute, with common default values elided
  (`STYLE_DEFAULTS`). Iterating all 300+ computed properties made a YouTube serialize take
  ~45 s; the curated list restored interactivity.
- Captures `<html>`/`<body>` attributes and a smaller shell style set (`SHELL_PROPS`) so
  the viewer can reproduce page-level background/typography.
- Collects stylesheet URLs (`<link rel=stylesheet>`) and inline `<style>` text (< 500 KB
  each) from `<head>` for the viewer to re-link.

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

Mutations on untracked nodes (no nid) and on the host's own overlay are skipped.

### 2.5 Watchdog #1 (content script)

A 5 s self-watchdog (a `setTimeout` chain, not `setInterval`, so cadence resets on every
drain) force-flushes a stuck mutation queue and increments `staleFlushCount`, which rides
the next flush envelope so the host can observe rescue frequency.

### 2.6 Side channels

- **Scroll** — passive listener, throttled to 1 event / 200 ms.
- **Overlay** — broadcasts the automation action-glow rect and progress card state,
  throttled to 1 / 500 ms, forced on snapshot/resume.
- **Dialogs** — a page-level injected script monkey-patches `window.alert` / `confirm` /
  `prompt` to dispatch `CustomEvent`s before/after the native call; the content script
  relays open/closed states so the viewer can show styled dialog cards.

### 2.7 Lifecycle & readiness

Control messages: `domStreamStart` (fresh session + snapshot + observers),
`domStreamStop`, `domStreamPause` (observers off, session retained), `domStreamResume`
(fresh session + snapshot), `pingDomStream` (synchronous readiness probe).

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
- **Diff apply**: each op resolves its target via
  `doc.querySelector('[data-fsb-nid="…"]')`; misses are recorded (a consequence of
  truncation or lost messages) and degrade to awaiting the next snapshot.
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

## 6. Known limitations (inherited; targets for the standalone framework)

These are honest weaknesses of the shipped design, documented here because fixing them is
part of this repository's roadmap (and the paper's discussion section):

1. **Frozen computed styles.** Inlined styles are snapshot-time state. Class-flip diffs
   (`attr` ops) cannot override stale inline styles in the mirror, so style-dynamic UI
   drifts until the next full snapshot. A stylesheet-centric capture (CSSOM /
   `adoptedStyleSheets`) would fix this and shrink payloads enough to retire most of the
   truncation machinery.
2. **Added nodes carry no computed styles.** `processAddedNode` assigns nids and fixes URLs
   but does not capture styles, so post-snapshot content renders inconsistently with
   snapshot-era siblings.
3. **nid stamping mutates the observed page.** `data-fsb-nid` is visible to the page's own
   observers/selectors; a WeakMap-based identity scheme would be invisible but requires a
   different wire-addressing strategy.
4. **Truncation recovery is passive.** Diff targets inside dropped subtrees miss until the
   next snapshot; an on-demand subtree fetch would close the gap.
5. **Sanitization gap.** `on*` event-handler attributes are only stripped for `<html>`/
   `<body>` shells, not in the main element pass or `processAddedNode` — the viewer iframe
   must be sandboxed without `allow-scripts`, and the framework should sanitize on both
   ends.
6. **Shadow DOM, `<video>`/`<audio>`, and cross-origin iframe content are not mirrored.**
