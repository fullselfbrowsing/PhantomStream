# PhantomStream

**DOM-native live browser mirroring.** PhantomStream streams a real browser tab to a remote
viewer as structured DOM data — a one-time style-inlined snapshot plus incremental
MutationObserver diffs — instead of pixels. The result is a live, semantically addressable,
remotely controllable mirror of a web page at a fraction of the bandwidth of video or
screenshot streaming.

PhantomStream began life as milestone **v0.9.9.1 "Phantom Stream"** inside
[FSB (Full Self-Browsing)](https://github.com/fullselfbrowsing/FSB), where it powers the
dashboard's live preview of automated browsing sessions. This repository extracts it into a
standalone framework — pluggable back into FSB, and usable by anything that needs a live
view into a browser it controls — and is the working repository for an accompanying
research paper.

## Why DOM streaming instead of video?

| | Video / screenshot streaming | PhantomStream (DOM streaming) |
|---|---|---|
| Bandwidth | Continuous frames, content-independent | One snapshot, then tiny diffs only when the page changes |
| Latency | Encode + transmit + decode per frame | A text mutation is one small JSON op |
| Fidelity | Lossy, resolution-bound | Exact DOM, native text rendering, resolution-independent |
| Remote control | Pixel coordinates against a possibly stale frame | Real elements addressed by stable node IDs |
| Inspectability | Opaque pixels | The mirror *is* a DOM — queryable, highlightable, annotatable |

## How it works

```
  page (capture)             host (transport)            relay              viewer (render)
┌────────────────────┐    ┌──────────────────┐    ┌────────────────┐    ┌─────────────────────┐
│ snapshot:           │    │ LZ-string         │    │ WebSocket      │    │ rebuild document in │
│  clone + inline     │    │ compressed        │    │ fan-out,       │    │ sandboxed iframe,   │
│  styles + nid stamp │ →  │ envelope          │ →  │ per-message    │ →  │ apply diffs by nid, │
│ diffs:              │    │ {_lz:true, d:…}   │    │ size cap       │    │ scale + remote      │
│  rAF-batched        │    │                   │    │                │    │ control reverse-map │
│  MutationObserver   │    │                   │    │                │    │                     │
└────────────────────┘    └──────────────────┘    └────────────────┘    └─────────────────────┘
```

Core mechanisms (see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full treatment
and [docs/SECURITY.md](docs/SECURITY.md) for the embed security contract):

- **Stable node identity.** Every element is stamped with a `data-fsb-nid`; all diff ops
  (`add`/`rm`/`attr`/`text`) and remote-control actions address nodes by this key.
- **Curated computed-style capture.** ~85 visual-fidelity CSS properties inlined per element
  (not all 300+), with default-value elision — the fix that took a YouTube serialize from 45s
  to interactive.
- **Display-matched diffing.** Mutations batch and flush on `requestAnimationFrame`, so the
  mirror updates at the same cadence the page paints.
- **Budgeted snapshots.** Snapshots truncate to a relay-safe size by dropping whole subtrees
  below 3× the viewport, never mid-element, after a single batched layout read.
- **Dual watchdogs.** A content-script self-watchdog rescues stuck mutation queues; a
  service-worker alarm survives MV3 eviction and requests a fresh snapshot if the stream
  strands silently.
- **Session identity.** Every message carries a `streamSessionId` + `snapshotId`; the viewer
  rejects stale messages so late diffs from a previous page can never corrupt the mirror.
- **Side channels.** Scroll position, automation overlays (action glow, progress), and native
  `alert`/`confirm`/`prompt` dialogs mirror alongside the DOM.

## Repository layout

```
src/                  The framework (extraction in progress)
  protocol/           ✅ Message types, wire envelope, compression, shared constants
  capture/            ⬜ Page-side capture core (from extension/content/dom-stream.js)
  relay/              ⬜ Transport-agnostic relay (from server ws handler)
  renderer/           ⬜ Viewer-side reconstruction (from dashboard preview code)
reference/            Verbatim source as it shipped in FSB (provenance pinned to commit)
  extension/          Capture module, ws client, background relay excerpts
  dashboard/          Viewer implementation
  server/             Relay implementation
  planning/           Original design docs: 11 phases of plans, UAT, verification
  tests/              Stream-related test suites from FSB
docs/
  ARCHITECTURE.md     End-to-end technical description of the shipped system
  SECURITY.md         Embed security contract: sanitization, masking, CSP, sandbox
  DESIGN-HISTORY.md   How it evolved, what failed, known limitations
  paper/OUTLINE.md    Research paper outline and evaluation plan
```

## Status

- [x] Extraction of all Phantom Stream source, tests, and design docs from FSB
- [x] Protocol module (`src/protocol/`) — clean, dependency-free
- [ ] Capture core decoupled from `chrome.runtime` / FSB namespace
- [ ] Renderer decoupled from the FSB dashboard
- [ ] Transport-agnostic relay with pluggable backends
- [ ] Reference demo (capture a page, mirror it in another tab)
- [ ] Evaluation harness (bandwidth/latency/fidelity vs. video & rrweb baselines)
- [ ] Paper draft

## Research

PhantomStream is also a paper in progress on DOM-native browser mirroring for agentic
browsing — see [docs/paper/OUTLINE.md](docs/paper/OUTLINE.md). The short pitch: when an AI
agent drives a browser, the human supervising it needs a live, trustworthy, low-latency view
*with semantic handles* (what element is the agent touching?), and pixel streaming gives you
none of that.

## Provenance & license

Extracted from FSB at commit `867d6f0c` (2026-06-09) with the original milestone design
history preserved under `reference/planning/`. Released under the [MIT License](LICENSE).
