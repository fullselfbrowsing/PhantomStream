# Requirements: PhantomStream

**Defined:** 2026-06-09
**Core Value:** A live, trustworthy, low-bandwidth, *semantically addressable* mirror of a real browser tab — capture → relay → render → remote-control must work end-to-end as a standalone framework.

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### Capture Core (CAPT)

- [x] **CAPT-01**: Host can run the capture core in any injection context via an injected `Transport` interface (`send`/`flush`) — zero `chrome.runtime` / `window.FSB` references in core
- [x] **CAPT-02**: Host can control capture lifecycle (`start`/`stop`/`pause`/`resume`) with fresh-session semantics matching the reference implementation
- [x] **CAPT-03**: Extracted capture preserves the reference reliability defenses: rAF-batched diffs, self-watchdog force-flush, session/snapshot identity stamping, budgeted whole-subtree truncation with single-pass layout reads
- [x] **CAPT-04**: Extracted capture output is verified against `reference/` via a differential test harness on frozen fixtures, with an intentional-divergence ledger
- [ ] **CAPT-05**: Typed text in form fields is mirrored — explicit input-event capture beyond MutationObserver (`value` property changes)
- [ ] **CAPT-06**: Nodes added after the snapshot carry computed styles consistent with snapshot-era siblings
- [ ] **CAPT-07**: Node identity is WeakMap-based — the observed page is no longer mutated with `data-fsb-nid` attributes, while the wire-addressing contract (diff ops, overlays, remote control) is preserved
- [ ] **CAPT-08**: Open shadow DOM content is mirrored (serialization, diffs, and addressing extend into shadow roots)
- [ ] **CAPT-09**: Same-origin iframe content is mirrored; cross-origin iframes render as labeled placeholders
- [ ] **CAPT-10**: Stylesheet-centric (CSSOM) capture mode is available behind a config flag — handles cross-origin `cssRules` fallback, `insertRule`-injected styles, and `adoptedStyleSheets`
- [ ] **CAPT-11**: Viewer can request on-demand subtree fetch to recover truncated regions without waiting for the next snapshot

### Security & Privacy (SEC)

- [x] **SEC-01**: All serialization paths (snapshot, `add`-op subtrees, `attr` ops) strip `on*` event-handler attributes and `javascript:` URLs
- [x] **SEC-02**: Viewer renders exclusively in a sandboxed iframe without `allow-scripts`; the embed security contract is documented
- [x] **SEC-03**: Capture-side privacy masking with rrweb-compatible vocabulary (`blockSelector`, `maskTextSelector`, `maskInputs`, custom mask fns) applied in all serialization paths — masked content never leaves the captured page
- [x] **SEC-04**: Remote control activation is gated by a host-provided consent/authorization hook

### Viewer (VIEW)

- [x] **VIEW-01**: Host can embed the viewer as a framework-agnostic component (`createViewer({ container, transport })`) with viewport-adaptive scaling
- [x] **VIEW-02**: Host can subscribe to lifecycle/connection-state events (`connecting`/`live`/`stale`/`disconnected`) and stream-health telemetry via `on()`
- [ ] **VIEW-03**: Host can address mirrored elements semantically through a public node-identity API (e.g. highlight/query the node an agent is about to touch)
- [x] **VIEW-04**: Overlay channel is a documented, extensible message type — action glow and progress ship as built-ins; hosts can define custom DOM-anchored overlays
- [x] **VIEW-05**: Remote control works through the mirror: click/type/scroll reverse-mapped from viewer coordinates and replayed in the real tab
- [x] **VIEW-06**: Scroll position and native `alert`/`confirm`/`prompt` dialogs are mirrored (parity with reference)

### Transport & Relay (RELY)

- [x] **RELY-01**: Relay is transport-agnostic with pluggable backends; a self-hostable WebSocket reference implementation ships with per-message size cap and oversize diagnostics
- [x] **RELY-02**: Compression envelope uses native `CompressionStream('deflate-raw')` by default with lz-string-compatible decode for FSB backward compatibility; async codec preserves message ordering

### Host Adapters (ADPT)

- [ ] **ADPT-01**: Extension MV3 adapter — content-script injection + service-worker relay client including the `chrome.alarms` watchdog
- [x] **ADPT-02**: Playwright/CDP adapter — `addInitScript`/`Page.addScriptToEvaluateOnNewDocument` injection + binding bridge, shipped as a single-file inject artifact
- [ ] **ADPT-03**: Bookmarklet adapter — loader stub that injects the capture bundle into the current page
- [x] **ADPT-04**: Embedded-SDK adapter — first-party pages can import and run capture directly (script tag / module import)

### Demos & Packaging (PKG)

- [x] **PKG-01**: `npx phantom-stream demo` works end-to-end: capture a page in one tab, mirror it live in another through the bundled relay
- [x] **PKG-02**: Playwright-driven demo: a script drives a real page while the viewer mirrors it live with working remote control
- [ ] **PKG-03**: npm package published as `@fullselfbrowsing/phantom-stream` — ESM-only subpath exports, JSDoc-generated `.d.ts`, `attw`/`publint` clean, provenance via trusted publishing
- [ ] **PKG-04**: Quickstart docs cover each adapter with a < 5-minute path to a live mirror

### FSB Integration (FSB)

- [ ] **FSB-01**: FSB can swap its bundled streaming code for the published package — verified end-to-end (live preview, remote control, watchdog/eviction recovery)

### Evaluation (EVAL)

- [ ] **EVAL-01**: Frozen, replayable site corpus (HAR record/replay) with scripted activity levels (idle, reading, agent-driven automation)
- [ ] **EVAL-02**: Bandwidth and latency measured for PhantomStream vs WebRTC screen capture, CDP screencast, and rrweb live mode under identical corpus conditions with a documented baseline-config protocol
- [ ] **EVAL-03**: Style-capture strategy ablation: full enumeration vs curated inlining vs stylesheet-centric, on payload size, serialize latency, and fidelity
- [ ] **EVAL-04**: Fidelity scoring combines pixel metrics (pixelmatch/SSIM) with a DOM-level semantic-fidelity metric, plus a failure taxonomy
- [ ] **EVAL-05**: The harness runs as the framework's performance regression suite (repeatable locally/CI)

### Research Paper (PAPR)

- [ ] **PAPR-01**: Full system-track paper draft (abstract through discussion: design rationale, production reliability, evaluation results) ready for submission to a WWW/UIST/CHI-tier venue
- [ ] **PAPR-02**: Related-work treatment grounded in primary sources (rrweb internals, co-browsing systems, CDP screencast, agent-observability viewers)

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Fidelity & Channels

- **FID2-01**: Cursor-position channel + viewer cursor rendering (co-browsing UX)
- **FID2-02**: Periodic budgeted canvas refresh (opt-in)
- **FID2-03**: Caret/selection mirroring in form fields

### Ecosystem

- **ECO2-01**: rrweb-format export bridge (emit rrweb-compatible events for replay-storage interop)
- **ECO2-02**: Telemetry surface hardening from FSB production feedback (watchdog rescue rates, health dashboards)
- **ECO2-03**: Multi-viewer scale-out patterns documentation

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Replay storage + timeline player | rrweb's mature home turf; dilutes live-mirror identity; protocol JSON is persistable by hosts if needed |
| Multi-writer CRDT collaboration | Single-writer authoritative tab = no merge problem; the paper argues this explicitly |
| Universal proxy-based co-browsing (Surfly model) | HTML-rewriting arms race + MITM liability; adapters cover every legitimately-controlled injection context |
| Live `<video>`/`<audio>`/canvas streaming (WebRTC fallback) | Drags in a media pipeline; destroys the bandwidth story; poster/placeholder documented instead |
| Built-in calls/chat/drawing-annotation toolkits | Product features, not framework features; the overlay channel is the extension point |
| Analytics capture (console, network, heatmaps) | Different product category; expands privacy surface; plugin seam suffices |
| Cross-origin iframe content mirroring | Browser security boundary; industry-standard limitation; labeled placeholders instead |
| Mobile / non-Chromium-first support | v1 targets Chromium contexts (MV3, CDP); portability later |
| FSB feature work in this repo | FSB only consumes the package; its code stays in the FSB repo |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| CAPT-01 | Phase 1 | Complete |
| CAPT-02 | Phase 1 | Complete |
| CAPT-03 | Phase 1 | Complete |
| CAPT-04 | Phase 1 | Complete |
| CAPT-05 | Phase 8 | Pending |
| CAPT-06 | Phase 8 | Pending |
| CAPT-07 | Phase 7 | Pending |
| CAPT-08 | Phase 8 | Pending |
| CAPT-09 | Phase 8 | Pending |
| CAPT-10 | Phase 9 | Pending |
| CAPT-11 | Phase 8 | Pending |
| SEC-01 | Phase 3 | Complete |
| SEC-02 | Phase 3 | Complete |
| SEC-03 | Phase 3 | Complete |
| SEC-04 | Phase 5 | Complete |
| VIEW-01 | Phase 2 | Complete |
| VIEW-02 | Phase 4 | Complete |
| VIEW-03 | Phase 7 | Pending |
| VIEW-04 | Phase 2 | Complete |
| VIEW-05 | Phase 5 | Complete |
| VIEW-06 | Phase 2 | Complete |
| RELY-01 | Phase 4 | Complete |
| RELY-02 | Phase 4 | Complete |
| ADPT-01 | Phase 6 | Pending |
| ADPT-02 | Phase 5 | Complete |
| ADPT-03 | Phase 6 | Pending |
| ADPT-04 | Phase 2 | Complete |
| PKG-01 | Phase 4 | Complete |
| PKG-02 | Phase 5 | Complete |
| PKG-03 | Phase 10 | Pending |
| PKG-04 | Phase 10 | Pending |
| FSB-01 | Phase 11 | Pending |
| EVAL-01 | Phase 12 | Pending |
| EVAL-02 | Phase 12 | Pending |
| EVAL-03 | Phase 12 | Pending |
| EVAL-04 | Phase 12 | Pending |
| EVAL-05 | Phase 12 | Pending |
| PAPR-01 | Phase 13 | Pending |
| PAPR-02 | Phase 13 | Pending |

**Coverage:**
- v1 requirements: 39 total (earlier "32" was a miscount; corrected during roadmap creation)
- Mapped to phases: 39
- Unmapped: 0 ✓

---
*Requirements defined: 2026-06-09*
*Last updated: 2026-06-09 after roadmap creation (traceability populated)*
