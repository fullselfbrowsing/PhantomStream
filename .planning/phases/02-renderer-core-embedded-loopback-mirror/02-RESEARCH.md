# Phase 2: Renderer Core + Embedded Loopback Mirror - Research

**Researched:** 2026-06-10
**Domain:** Viewer-side DOM reconstruction (sandboxed iframe srcdoc render + nid-addressed diff apply), loopback transport design, jsdom test strategy
**Confidence:** HIGH (all five key technical questions resolved by reading the actual sources and running empirical jsdom 29.1.1 experiments in this session)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### Viewer API & Embedding Surface
- **Factory shape:** `createViewer({ container, transport })` **auto-attaches on creation** and returns a minimal handle `{ detach, destroy }` — criterion 1 says calling it yields a live mirror. No events surface yet (Phase 4), no addressing API yet (Phase 7). Keep the handle minimal; extend later phases.
- **Scaling:** reference-parity scale-to-fit — the mirror scales to the container while preserving the captured viewport aspect ratio, driven by `ResizeObserver` on the container.
- **Layout modes DROPPED from the framework:** inline/maximized/pip/fullscreen are FSB dashboard UI, not framework concerns. The viewer always fills its container; layout is the host's responsibility. Document this explicitly (the `layout.js` module from `src/renderer/README.md`'s planned split is NOT extracted).
- **Loopback demo:** `examples/loopback-mirror.html` importing capture + viewer as native ES modules, served by a dependency-free Node static-serve script (`npm run example:loopback`) since ESM imports need http. Zero external dependencies.

#### Reconstruction & Update Mechanics
- **Snapshot → iframe:** parity — write snapshot HTML into the sandboxed iframe via `srcdoc` (per reference and `src/renderer/README.md`).
- **Diff-apply misses:** internal miss accounting + logger warnings now (README hard requirement: health signal, not silent drift). The formal telemetry/event surface (VIEW-02) arrives in Phase 4 — do not build it now.
- **Staleness guard:** reuse `isCurrentStream` from `src/protocol` — viewer rejects messages with mismatched stream-session/snapshot identity (parity with reference).
- **Re-snapshot request:** wire the documented `dash:request-snapshot` control path through the loopback transport now — the protocol already defines it; recovery is proven end-to-end in one page.

#### Overlay Channel (VIEW-04)
- **Built-ins:** port the reference action-glow and progress-card overlays as pre-registered built-ins (parity visuals).
- **Extension mechanism:** renderer registry keyed by overlay `kind` — `registerOverlay(kind, renderFn(payload, anchorRect, layer))`. Built-ins use the same registry, proving the extension seam works.
- **Anchoring:** nid → mirrored element bounding rect, positioned in a host-document overlay layer ABOVE the iframe. Overlays are never injected into the sandboxed mirror document.
- **Unknown overlay kinds:** logged and ignored (forward-compatible; never throw).

#### Dialog & Scroll Mirroring (VIEW-06)
- **Dialog cards:** reference-parity cards for `alert`/`confirm`/`prompt` mirroring.
- **Scroll semantics:** parity — captured page scroll drives mirror scroll (scaled to the mirror's coordinate space).
- **Viewer-side scroll:** read-only follow in Phase 2 — user scrolling the mirror does not feed back (remote control is Phase 5); mirror re-syncs to the captured scroll position.

### Claude's Discretion
- Module split within `src/renderer/` (README suggests snapshot-renderer/diff-applier/overlays/index; `remote-control.js` is Phase 5, `layout.js` is dropped) — single-file-first like Phase 1 or split, planner's choice; parity is the bar, not structure
- Overlay layer DOM structure and CSS implementation details
- Exact miss-accounting counters and logger message formats
- Static-serve script implementation (Node built-ins only)
- How the loopback example page demonstrates mutations (e.g., a small self-mutating playground area)

### Deferred Ideas (OUT OF SCOPE)
- Layout modes (maximized/pip/fullscreen) — dropped from framework; hosts can implement; revisit only if FSB swap-in (Phase 11) reveals a need
- Viewer free-scroll with re-sync button — Phase 5 (remote control) territory if wanted
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| VIEW-01 | Host can embed the viewer as a framework-agnostic component (`createViewer({ container, transport })`) with viewport-adaptive scaling | Scale-to-fit formula verified at `dashboard.js:2831-2869` and locked in 02-UI-SPEC.md; ResizeObserver pattern at `dashboard.js:3200-3207` (typeof-guarded — jsdom lacks it, verified); viewer transport receive seam designed in Architecture Patterns §Transport |
| VIEW-04 | Overlay channel is a documented, extensible message type — glow and progress as built-ins; custom DOM-anchored overlays | Reference overlay handler verified at `dashboard.js:3374-3403`; coordinate mapping `offsetX + x*s` at 3381-3384; registry design + payload-key-as-kind dispatch in Architecture Patterns §Overlay; capture-side pass-through gap identified (broadcastOverlayState drops non-glow/progress keys — see Open Question 2) |
| VIEW-06 | Scroll position and native alert/confirm/prompt dialogs mirrored (parity) | Scroll handler verified at `dashboard.js:3358-3372` (smooth scrollTo + post-mutation re-apply at 3340-3342); dialog handler at 3405-3443 (textContent, capitalized type label, icon-by-type, flex/none); dialog identity-nesting quirk documented in Pitfall 8 |
| ADPT-04 | Embedded-SDK adapter — first-party page imports and runs capture directly | `src/capture/index.js` is already injection-context-free (Phase 1); loopback demo wiring order + skipElement recursion guard designed in Architecture Patterns §Loopback; static-serve pattern in §Demo Server |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

Actionable directives the planner must honor [VERIFIED: ./CLAUDE.md read this session]:

- **Zero runtime dependencies** for the library; plain JS ESM + JSDoc types; no build step. jsdom is the only devDependency.
- **ESM conventions in `src/`:** named exports only, explicit `.js` import extensions, barrel `index.js`, lowercase-hyphen filenames, `camelCase` functions (`is*` predicates, `create*` factories), `UPPER_SNAKE_CASE` constants, `PascalCase` typedefs.
- **Error handling:** discriminated unions `{ok, error}` for fallible ops; lowercase-hyphen error strings; no exceptions from protocol functions; try/catch + logger routing; early-return guards.
- **`var` + `||` defaulting** in cross-runtime files is intentional (envelope.js precedent); capture core follows it; renderer runs only in browser/jsdom but consistency with capture style is the established pattern.
- **Comments:** file-top provenance comment; JSDoc on all exports; numeric literals commented with units/derivation; phase references in comments.
- **Security non-negotiable:** published framework renders attacker-influenced HTML — sandboxed iframe without `allow-scripts` from day one (this phase's criterion 3); full sanitization is Phase 3.
- **Performance:** must not regress encoded lessons (single-pass layout reads, paint-cadence delivery) — viewer-side equivalent: don't add per-mutation layout reads; reference applies diffs then re-applies scroll once per batch.
- **Wire protocol backward-compatible** with FSB's shipped envelope and message shapes.
- **Commit rule:** NEVER add Co-Authored-By or AI attribution to commits.
- **GSD workflow enforcement:** file changes only through GSD commands.

## Summary

Phase 2 extracts the viewer from `reference/dashboard/dashboard.js` (stream-relevant code ≈ lines 192-265, 2607-2869, 3200-3443) into `src/renderer/`, and lands the first end-to-end proof: one HTML page importing capture + viewer over a loopback transport. The reference viewer code is cleanly separable: the snapshot renderer (`handleDOMSnapshot` → srcdoc), diff applier (`handleDOMMutations` with stale/failure counters and resync thresholds), scale-to-fit (`updatePreviewScale`), and the scroll/overlay/dialog handlers have **no structural dependency on the dashboard's task UI** — the FSB-coupled parts (layout modes, header chrome, URL bar, remote control, `previewState` sub-views, WebSocket plumbing, transport-event ring buffers, tabId checks) are all droppable per the CONTEXT decisions. The exact parity values are already extracted into 02-UI-SPEC.md; this research maps the behavioral seams and resolves the five planning questions.

Three findings change how the plan should be written. **First**, jsdom 29.1.1 does NOT parse `srcdoc` into `contentDocument` (verified empirically this session: attribute round-trips but the document stays empty), while `document.implementation.createHTMLDocument()`, about:blank-iframe `contentDocument.write()`, and the add-op `innerHTML` pattern all work — so the renderer must be factored into pure/document-parameterized functions (`buildSnapshotHtml(payload) → string`, `applyMutations(doc, ops, counters)`) with the srcdoc wiring as thin glue, and the loopback e2e test manually parses `iframe.srcdoc` into the contentDocument via `open()/write()/close()`. **Second**, the capture core observes `document.body` only (no subtree scoping exists in `src/capture/index.js`), so the loopback demo's recursion guard is the `skipElement` predicate — and it MUST be attribute/id-based, never object-identity-based, because the predicate runs against detached clone elements during serialization but live elements during diffing. Without it, the host MutationObserver sees every `srcdoc` set as an `attr` mutation carrying the full snapshot HTML (verified empirically) — a feedback amplification loop. **Third**, `dash:request-snapshot` does not exist anywhere in the protocol or reference; the reference viewer's resync path sends `dash:dom-stream-start` (CONTROL.START) — the loopback glue maps CONTROL messages to capture handle methods.

**Primary recommendation:** Port the six reference functions behaviorally verbatim with FSB chrome dropped, factor them as document-parameterized pure functions inside a small module split (`index.js` + `snapshot.js` + `diff.js` + `overlays.js`), design the viewer transport as `{ send(type, payload), onMessage(handler) → unsubscribe }`, and ship a `createLoopbackTransport()` that implements both ends.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Snapshot HTML document assembly | Renderer (`src/renderer/`) | — | Pure string building from SnapshotPayload; testable without DOM |
| srcdoc write + iframe lifecycle | Renderer (browser DOM, host document) | — | Thin glue around the pure builder; sandbox assertion lives here |
| Diff apply (add/rm/attr/text) | Renderer (mirror `contentDocument`) | — | nid-addressed querySelector ops inside the sandboxed document |
| Miss accounting + resync request | Renderer | Transport (sends CONTROL.START) | Health signal is renderer state; recovery rides the transport |
| Scale-to-fit + letterboxing | Renderer (host document CSS transform) | — | Transform applies to the iframe element in the host doc, never inside the mirror |
| Overlay layer (glow/progress/dialog/custom) | Renderer (host-document layer above iframe) | — | CONTEXT decision: overlays never injected into the mirror document |
| Overlay anchor-rect resolution (nid → rect) | Renderer (reads mirror contentDocument rects) | — | Same-origin access guaranteed by `allow-same-origin` sandbox token |
| Transport receive seam (`onMessage`) | Transport interface (consumed by renderer) | Phase 4 WS transport implements it | Designed now so WS swap is interface-compatible |
| Loopback transport (both ends) | `examples/` + test utility | — | Zero-infrastructure wiring; capture's send fans out to viewer handlers |
| Capture lifecycle control mapping (CONTROL.* → handle) | Host glue (demo page / adapter) | — | Capture handle has start/stop/pause/resume; glue subscribes to viewer's control sends |
| Demo page + self-mutating playground | `examples/loopback-mirror.html` | — | Host-owned layout per CONTEXT (layout modes dropped) |
| Static file serving for ESM imports | `examples/serve.js` (Node `node:http` built-in) | — | Module scripts require correct JS MIME; zero-dependency constraint |

## Standard Stack

### Core

No new runtime or dev dependencies. This phase is implemented entirely with existing assets [VERIFIED: package.json + node_modules read this session]:

| Asset | Version | Purpose | Status |
|-------|---------|---------|--------|
| `src/protocol/` | in-repo | STREAM/CONTROL types, NID_ATTR, `isCurrentStream`, constants | Complete (Phase 1) — viewer imports, never redefines |
| `src/capture/index.js` | in-repo | Capture core consumed by loopback demo | Complete (Phase 1) |
| jsdom | 29.1.1 (installed) | Test environment | Existing devDependency; Node ≥20.19 floor for tests |
| node:test / node:assert/strict | Node 24.14.1 (local) | Test runner | Built-in; CI runs Node 20/22/24 |
| node:http / node:fs / node:path | built-in | Demo static server | Zero-dependency constraint |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Node `node:http` hand-rolled static server (~40 lines) | `npx serve`, `http-server` | Violates zero-external-dependency decision for the demo — rejected |
| srcdoc (production path) | `contentDocument.write()` everywhere | write() works in jsdom AND browsers, but CONTEXT locks srcdoc parity; use write() only as test glue |
| ResizeObserver | window `resize` listener only | Reference uses both (3194-3207); CONTEXT locks ResizeObserver as the driver; typeof-guard for jsdom |

**Installation:** none. `npm install` of existing lockfile only.

## Package Legitimacy Audit

**This phase installs no new packages.** jsdom 29.1.1 is already present in `package-lock.json` and `node_modules` (verified this session). The library itself remains zero-dependency (CLAUDE.md constraint). slopcheck run: not applicable — nothing to audit.

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

## Architecture Patterns

### System Architecture Diagram

```
┌────────────────────────── one HTML page (loopback demo) ──────────────────────────┐
│                                                                                    │
│  SOURCE pane (captured)                       MIRROR pane (skipElement-excluded)   │
│  ┌──────────────────┐                         ┌──────────────────────────────────┐ │
│  │ self-mutating     │                        │ viewer root (createViewer)       │ │
│  │ playground rows   │                        │  ┌────────────────────────────┐  │ │
│  │ + controls        │                        │  │ iframe sandbox=            │  │ │
│  └───────┬──────────┘                         │  │  "allow-same-origin"       │  │ │
│          │ DOM mutations                      │  │  srcdoc = snapshot doc     │  │ │
│          ▼                                    │  │  transform: scale(s)       │  │ │
│  createCapture({transport: captureEnd,        │  └────────────▲───────────────┘  │ │
│        skipElement: mirror-pane predicate})   │  ┌────────────┴───────────────┐  │ │
│          │                                    │  │ overlay layer (z:2,        │  │ │
│          │ send(type, payload)                │  │  pointer-events:none)      │  │ │
│          ▼                                    │  │  glow │ progress │ dialog  │  │ │
│  ┌──────────────────────────────────────┐     │  └────────────────────────────┘  │ │
│  │     createLoopbackTransport()        │     └──────────────▲───────────────────┘ │
│  │  captureEnd.send ──► viewer handlers ───────────────────┘ ext:* messages       │
│  │  viewerEnd.send  ──► control handlers│                                          │
│  └───────────────┬──────────────────────┘                                          │
│                  │ dash:dom-stream-start (resync)                                  │
│                  ▼                                                                 │
│  host glue: CONTROL.START → capture.start()  (fresh session + snapshot)            │
└────────────────────────────────────────────────────────────────────────────────────┘

Message flow (forward): capture.start() → SNAPSHOT → viewer builds srcdoc → onload →
  scale-to-fit + initial scrollTo → MUTATIONS (rAF-batched) → applyMutations(contentDocument)
  → re-apply last scroll │ SCROLL → smooth scrollTo │ OVERLAY → registry dispatch →
  host-layer positioned rects │ DIALOG → dialog card show/hide
Recovery path: ≥3 stale-target misses OR ≥2 apply failures → viewer sends CONTROL.START
  once (resyncPending latch) → glue calls capture.start() → fresh SNAPSHOT resets counters
```

### Recommended Project Structure

```
src/renderer/
├── index.js       # createViewer factory: DOM creation, sandbox assertion, transport
│                  #   subscribe/dispatch, ResizeObserver, handle {detach, destroy}
├── snapshot.js    # buildSnapshotHtml(payload) — pure; escapeAttribute +
│                  #   buildShellAttributeString ports
├── diff.js        # applyMutations(doc, mutations, counters) — Document-parameterized
└── overlays.js    # registry (registerOverlay), built-ins glow/progress/dialog,
                   #   mapRectToHost(rect, scaleState), injected CSS string
examples/
├── loopback-mirror.html   # demo page per 02-UI-SPEC.md contract
└── serve.js               # node:http static server, repo root, MIME map
tests/
├── renderer-snapshot.test.js, renderer-diff.test.js, renderer-overlays.test.js,
├── renderer-viewer.test.js, renderer-purity.test.js, renderer-loopback.test.js
└── (flat tests/*.test.js naming — picked up by existing npm test glob unchanged)
```

Rationale for a 4-file split rather than Phase 1's single-file-first: Phase 1's single file was forced by the differential oracle's parity discipline; **no oracle exists for the viewer** (the reference viewer is interleaved with dashboard UI and cannot run standalone), and the jsdom srcdoc limitation makes document-parameterized pure functions near-mandatory for testability. The split is the planner's call per CONTEXT, but the **function seams** (pure builder, Document-parameterized applier, pure scale math, pure rect mapping) are required either way — they are the only way to test in jsdom. A single `index.js` exporting those same named functions is equally acceptable.

### Pattern 1: Viewer transport receive seam (designed for Phase 4 WS compatibility)

**What:** The capture Transport is send-only (`{send, flush?}`). The viewer needs a receive side plus a control-send side. Minimal symmetric interface:

```js
/**
 * @typedef {Object} ViewerTransport
 * @property {(type: string, payload: Object) => void} send
 *   Viewer -> capture host (CONTROL.* / dash:* messages). Fire-and-forget,
 *   mirrors the capture Transport.send contract. Errors contained to logger.
 * @property {(handler: (type: string, payload: Object) => void) => (() => void)} onMessage
 *   Subscribe to capture-host -> viewer (ext:*) messages. Returns unsubscribe.
 *   destroy() calls the unsubscribe.
 */
```

**Why this shape:** `onMessage → unsubscribe` is the smallest subscribe pattern that supports clean teardown; a `Set` of handlers gives multi-viewer fan-out for free (mirrors the relay's `dashboards: Set` room model). Phase 4's WS transport implements `onMessage` by decoding envelopes off `ws.onmessage` and `send` by encoding onto the socket — same interface, zero viewer changes. [VERIFIED: capture Transport contract read from src/capture/index.js:142-159 and README]

**Loopback transport (implements both ends):**

```js
// Source: designed against tests/differential/harness.js:224-229 loopback precedent
export function createLoopbackTransport() {
  var toViewer = new Set();   // ext:* handlers (viewer subscribes)
  var toHost = new Set();     // dash:* handlers (host glue subscribes)
  function fanOut(handlers, type, payload) {
    // queueMicrotask: one async hop breaks re-entrancy (viewer DOM writes never
    // run inside capture's rAF flush; resync CONTROL.START never re-enters
    // capture.start() mid-flush). FIFO order preserved per spec.
    queueMicrotask(function () {
      handlers.forEach(function (h) { h(type, payload); });
    });
  }
  return {
    captureTransport: {            // pass to createCapture({ transport })
      send: function (type, payload) { fanOut(toViewer, type, payload); }
    },
    viewerTransport: {             // pass to createViewer({ transport })
      send: function (type, payload) { fanOut(toHost, type, payload); },
      onMessage: function (h) { toViewer.add(h); return function () { toViewer.delete(h); }; }
    },
    onControl: function (h) { toHost.add(h); return function () { toHost.delete(h); }; }
  };
}
```

The `queueMicrotask` hop is a recommendation, not a hard requirement — synchronous delivery also works (the differential harness records synchronously), but the async hop eliminates the re-entrancy class where the viewer's resync `send(CONTROL.START)` would call `capture.start()` from inside capture's own `safeSend` call stack. Microtask FIFO ordering preserves message order [ASSUMED — HTML spec microtask queue ordering; stable, low risk].

### Pattern 2: Re-snapshot request = CONTROL.START (the "dash:request-snapshot" naming correction)

**Critical finding [VERIFIED: repo-wide grep this session]:** No message named `dash:request-snapshot` exists in `src/protocol/` or anywhere in `reference/`. The CONTEXT decision's phrase "the documented `dash:request-snapshot` control path" refers to the re-snapshot-request concept; the actual shipped mechanism is:

- Viewer resync (`requestPreviewResync`, dashboard.js:248-278): sends `dash:request-status` (FSB status refresh — drop, FSB-specific) **and `dash:dom-stream-start`** (CONTROL.START), latched by `previewResyncPending` so only one request is in flight.
- Host side (ws-client.js:1324-1327): `dash:dom-stream-start` → content script `domStreamStart` → reference `start()` → fresh session + snapshot.
- `ext:request-snapshot` (STREAM.REQUEST_SNAPSHOT) flows the OTHER direction — SW watchdog → dashboard — and the dashboard's handler routes it through `requestPreviewResync`, which again emits CONTROL.START.

**Prescription:** the viewer's resync sends `CONTROL.START`; the loopback glue maps `CONTROL.START → capture.start()` (which restarts cleanly while streaming — re-injection guard, src/capture/index.js:1178-1194). Optionally also map STOP/PAUSE/RESUME for completeness. Do NOT mint a new protocol constant; record the `dash:request-status` drop in the renderer divergence ledger/README.

### Pattern 3: Document-parameterized rendering (the jsdom-driven factoring)

Empirical results from jsdom 29.1.1, run this session [VERIFIED: executed in this repo's node_modules]:

| Behavior | jsdom 29.1.1 result |
|----------|---------------------|
| `iframe.srcdoc = html` → contentDocument populated | **NO** — attribute set, `contentDocument` exists (about:blank) but body stays empty, even after 300ms |
| `iframe.onload` fires when srcdoc set | **YES** (fires for the empty about:blank document) |
| Appended iframe has synchronous `contentDocument` | **YES** |
| `contentDocument.open()/write()/close()` | **WORKS** — content parsed, `querySelector('[data-fsb-nid]')` finds nodes |
| Add-op pattern (`temp.innerHTML` → `firstElementChild` → `appendChild`) in contentDocument | **WORKS** |
| `document.implementation.createHTMLDocument()` as diff target | **WORKS** (querySelector + add-op verified) |
| `contentWindow.scrollTo({...})` / `scrollTo(x, y)` | No-op; logs "Not implemented" to (virtual)console; does NOT throw |
| `getBoundingClientRect()` in contentDocument | Degenerate all-zeros (same as Phase 1 finding) |
| `typeof ResizeObserver` | **`undefined`** — viewer MUST typeof-guard (reference already does at dashboard.js:3201) |
| Host MutationObserver sees mutations inside iframe contentDocument | **NO** (document boundary not crossed) |
| Host MutationObserver sees `srcdoc` attribute set on the iframe element | **YES** (1 record) — this is the recursion vector |

**Prescription for the renderer:**
- `buildSnapshotHtml(payload) → string` — pure; unit tests assert the exact string per UI-SPEC (doctype, charset meta, viewport meta `width={viewportWidth|1920}`, stylesheet links, inline style tags, reset CSS string, shell attrs, body html).
- `applyMutations(doc, mutations, counters) → counters` — takes any Document; unit tests use `document.implementation.createHTMLDocument()` seeded via `body.innerHTML`.
- `computeScale(pageW, pageH, containerW, containerH) → { s, offsetX, offsetY }` — pure; direct unit tests of the UI-SPEC formula including the `!isFinite(s) || s <= 0 → 1` clamp.
- `createViewer` reads `iframe.contentDocument` **fresh in each message handler** (reference parity — `handleDOMMutations` does `var doc = previewIframe.contentDocument` per call, dashboard.js:3215). This also makes the loopback e2e test possible: test glue simulates the browser's srcdoc parse with `cd.open(); cd.write(iframe.srcdoc); cd.close();` and subsequent diff applies hit the written document (verified working).
- Viewer integration tests assert: iframe created with exactly `sandbox="allow-same-origin"`, srcdoc string content, overlay layer structure, handle shape, unknown-overlay logging — never mirror content via srcdoc.

### Pattern 4: Loopback recursion guard (the #1 demo hazard, resolved)

**Capture is body-scoped, full stop** [VERIFIED: src/capture/index.js:583 (`document.body.cloneNode`), :1008 (`mutationObserver.observe(document.body, ...)`)]. There is no subtree option. The mirror pane therefore lives inside the observed tree, and isolation comes from `skipElement` — which Phase 1 built precisely for this (ancestor-inclusive, no nid assignment in skipped subtrees, mutations inside skipped subtrees dropped; src/capture/README.md option table).

Without the predicate, two feedback paths fire (both verified this session):
1. **Snapshot path:** `cloneNode(true)` copies the iframe's `srcdoc` attribute → the snapshot embeds the full mirror document → mirror-of-mirror at level 1.
2. **Diff path:** every `iframe.srcdoc = ...` set is an `attr` mutation on a body descendant; the host MutationObserver reports it (empirically verified) → an `attr` op whose `val` is the entire snapshot HTML → re-applied into the mirror → amplification each cycle until the truncation budget chokes. Overlay-layer repositioning (glow moves, dialog show/hide) adds steady diff noise on top.

**Prescription:**
- `createViewer` stamps a documented marker attribute on its root, e.g. `data-phantomstream-ui="viewer"` (follows the reference's own precedent — `isFsbOverlay` used `closest('[data-fsb-overlay]')`, noted in src/capture/index.js:236-243).
- Demo passes `skipElement: function (el) { return !!(el.getAttribute && el.getAttribute('data-phantomstream-ui')); }` — or keys off the mirror pane's id. Either works; the marker makes it copy-pasteable for every future host.
- **The predicate MUST be attribute/id-based, NOT object-identity or `document.contains`-based** [VERIFIED: serialization calls `safeSkipElement(cl)` on detached CLONE elements (index.js:627) while diffing calls `skipElementWithAncestors(m.target)` on LIVE elements (index.js:880) — `el === mirrorEl` matches only the live side and the clone leaks into snapshots].
- Wiring order in the demo: `createLoopbackTransport()` → `createViewer(...)` (subscribes; its DOM now exists and is skip-marked) → `createCapture({ transport, skipElement })` (emits STREAM.READY — viewer ignores unhandled types) → `capture.start()`. Viewer must exist before the snapshot is sent: loopback has no buffering.
- Non-hazards, confirmed: mutations inside `contentDocument` never reach the host observer (document boundary, verified); the dialog interceptor script is appended to `document.head` (index.js:427) — outside the body-scoped observer and serializer.

### Pattern 5: Overlay registry + extensible message dispatch

Reference wire shape: `{ glow, progress, streamSessionId, snapshotId }` (capture index.js:1161-1166). The cleanest extension that stays backward-compatible: **every non-identity key of the OVERLAY payload is an overlay kind** dispatched through the registry.

```js
// kinds = Object.keys(payload) minus {streamSessionId, snapshotId}
// for each kind: registry.has(kind) ? renderFn(payload[kind], anchorRect, layer)
//              : logger.warn('[Renderer] unknown overlay kind ignored', kind)
```

Glow and progress become ordinary pre-registered kinds — zero special-casing, and the built-ins prove the seam (CONTEXT requirement). `renderFn(payload, anchorRect, layer)` signature per CONTEXT. Anchor-rect resolution, in priority order:
1. payload value has `nid` → `contentDocument.querySelector('[data-fsb-nid="..."]')` → `getBoundingClientRect()` → map to host coords (rects inside the iframe are in the iframe's own client space — already viewport-relative, accounting for mirror scroll — and the CSS transform on the iframe element does not affect them).
2. payload value has `x/y/w/h` → map directly (glow parity path, capture-page viewport coords).
3. neither → `anchorRect = null` (e.g. progress pill, dialog — fixed-position overlays).

Coordinate mapping (identical for both cases) [VERIFIED: dashboard.js:3381-3384]:
```
top    = offsetY + rect.y * s
left   = offsetX + rect.x * s
width  = rect.w * s
height = rect.h * s
```

`glow.state !== 'active'` → hidden; all overlay kinds reset (hidden) on new snapshot [VERIFIED: dashboard.js:3379-3387, 2762-2764]. Null-valued kinds (`{glow: null}`) hide the built-in rather than dispatching.

**Capture-side gap:** `broadcastOverlayState` forwards ONLY `state.glow` and `state.progress` and drops every other key the overlayProvider returns [VERIFIED: src/capture/index.js:1139-1167]. End-to-end custom overlays therefore need a small capture edit (forward all provider keys, glow/progress defaulting to null). This is oracle-safe — no differential fixture configures an overlayProvider, so wire output with no provider is unchanged — but it IS a Phase-1-module edit; see Open Question 2 for the decision the planner must make.

### Pattern 6: Snapshot render sequence (srcdoc + onload)

Exact reference sequence to port [VERIFIED: dashboard.js:2723-2829]:
1. Validate `payload.html` — missing → log error, abort (reference sets error state; Phase 2: logger error, keep last good frame).
2. Adopt identity: `active = { streamSessionId, snapshotId }` (snapshot messages are never staleness-checked — they DEFINE the new identity; `tabId` checks are FSB-specific, drop with ledger note).
3. Reset generation state: miss counters, apply-failure counter, `resyncPending = false` (dashboard.js:200-204) + hide all overlay kinds (2762-2764).
4. Store `lastScroll = { x: payload.scrollX || 0, y: payload.scrollY || 0 }` (2758-2759).
5. `iframe.srcdoc = buildSnapshotHtml(payload)`.
6. `iframe.onload`: recompute scale, `contentWindow.scrollTo(payload.scrollX || 0, payload.scrollY || 0)` in try/catch, mark streaming (2806-2814). Mutations arriving before onload are dropped (reference gates on `previewState !== 'streaming'`, 3211) — parity; the resync mechanism covers any resulting drift.
7. Setting srcdoc again on a later snapshot re-fires onload (browser behavior; in jsdom onload fires but content stays empty — tests use the write-glue).

Recommended minimal viewer state (no events surface this phase): `'waiting' | 'streaming'` — gate diff/scroll/overlay/dialog application on `'streaming'`, matching the reference's gating without porting the 9-state FSB machine. The iframe should stay `display:none` (or equivalent) until first snapshot load so the demo's "Waiting for first snapshot…" placeholder behind it stays visible with zero events surface (reference precedent: `setPreviewState` shows the iframe only in streaming-ish states, dashboard.js:2648-2650).

### Pattern 7: Demo static server (Node built-ins, repo root, strict MIME)

The demo page imports `../src/capture/index.js` and `../src/renderer/index.js` natively — so the server must serve the **repo root** (not just `examples/`), and module scripts are blocked by browsers unless served with a JavaScript MIME type (strict MIME checking for ESM) [CITED: developer.mozilla.org/en-US/docs/Web/HTTP/MIME_types — "Strict MIME type checking is enforced for module scripts"; stable, training-confirmed].

```js
// examples/serve.js — zero dependencies, Node 18+
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';

const ROOT = resolve(new URL('..', import.meta.url).pathname); // repo root
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',   // required for ESM module scripts
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.map': 'application/json',
};
createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let filePath = resolve(ROOT, '.' + url.pathname);
  if (!filePath.startsWith(ROOT + sep) && filePath !== ROOT) {       // traversal guard
    res.writeHead(403); res.end('forbidden'); return;
  }
  try {
    let s = await stat(filePath);
    if (s.isDirectory()) { filePath = resolve(filePath, 'index.html'); s = await stat(filePath); }
    res.writeHead(200, { 'content-type': MIME[extname(filePath)] || 'application/octet-stream' });
    createReadStream(filePath).pipe(res);
  } catch {
    res.writeHead(404); res.end('not found');
  }
}).listen(8642, () => console.log('loopback demo: http://localhost:8642/examples/loopback-mirror.html'));
```

npm script: `"example:loopback": "node examples/serve.js"`. Port is the planner's choice; print the full demo URL on listen.

### Anti-Patterns to Avoid

- **Asserting mirror content via srcdoc in jsdom tests** — srcdoc never parses (verified); tests would pass vacuously or fail mysteriously.
- **Caching `contentDocument` at onload** — re-snapshot replaces the document; the reference re-reads it per handler call. Stale refs apply diffs into a dead document.
- **Object-identity skipElement predicates** — match only the live side, never the clone (Pitfall 2).
- **Injecting overlays into the mirror document** — CONTEXT-prohibited; also generates no host-side mutation noise only because of the document boundary, but breaks the sandbox story.
- **Porting `dash:request-status`, tabId identity checks, transport-event ring buffers, or the 9-state previewState machine** — FSB dashboard concerns; drop with ledger notes.
- **Escaping or normalizing `payload.html`** — it is inserted raw into the srcdoc body per reference parity (dashboard.js:2800); sanitization is Phase 3's chokepoint, the sandbox is this phase's backstop.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Staleness guard | a new identity comparator | `isCurrentStream` from `src/protocol/messages.js` | CONTEXT-locked; already tested |
| Message/identity constants | string literals | `STREAM`, `CONTROL`, `NID_ATTR` imports | Single source of truth; purity test pattern enforces it |
| Shell attribute serialization | new escaper | port `escapePreviewAttribute` + `buildShellAttributeString` verbatim (dashboard.js:2671-2694) | Parity bar; the name regex + style/on* drop are part of the contract |
| HTML sanitization | any sanitizer this phase | sandbox `allow-same-origin` only + Phase 3 | SEC-01/SEC-02 are Phase 3; building it now creates divergence risk |
| Event emitter for transport | an emitter class/library | a `Set` of handlers + unsubscribe closure | Smallest thing that works; matches relay fan-out model |
| ResizeObserver polyfill | polyfill for jsdom | typeof-guard + directly-testable `computeScale` | Reference already guards (3201); polyfills violate zero-dep |
| Dev server | express/serve/vite | `node:http` pattern above | Zero-dependency decision is locked |
| Icon font | Font Awesome | 3 inline SVGs (warning-triangle, question-circle, keyboard) | UI-SPEC-locked divergence; FA is an FSB asset |

**Key insight:** Phase 2's risk is not missing libraries — it's accidental reinvention drifting from reference parity. Nearly every needed behavior already exists as reference code with line numbers in this document and exact values in 02-UI-SPEC.md; the work is disciplined porting plus the two genuinely new designs (transport receive seam, overlay registry).

## Common Pitfalls

### Pitfall 1: srcdoc is a dead end in jsdom tests
**What goes wrong:** Tests set srcdoc and assert mirror content; contentDocument is permanently empty.
**Why:** jsdom 29.1.1 does not implement srcdoc navigation [VERIFIED: empirical run this session].
**How to avoid:** Pattern 3 factoring; e2e test glue parses srcdoc manually via `open()/write()/close()`.
**Warning signs:** any test reading `iframe.contentDocument.body` after only setting srcdoc.

### Pitfall 2: Mirror-of-mirror recursion in the loopback demo
**What goes wrong:** Snapshot embeds the mirror; every srcdoc set echoes back as a megabyte `attr` op; payload sizes amplify until truncation chokes the stream.
**Why:** Capture is hard-scoped to `document.body`; the host MutationObserver sees the iframe element's `srcdoc` attribute change (both verified).
**How to avoid:** `skipElement` keyed on a viewer-stamped marker attribute (Pattern 4). Predicate must work on detached clones — attribute/id checks only.
**Warning signs:** snapshot HTML containing `<iframe` with a `srcdoc` attribute; `attr` ops with `attr: 'srcdoc'`; ballooning mutation payloads.

### Pitfall 3: Native `alert()` blocks paint — the mirrored dialog card is invisible in a one-page loopback
**What goes wrong:** Demo's "Show dialog" calls `alert()`; the dialog-open message is applied synchronously before the alert blocks, but the browser never paints it; on dismissal the dialog-closed message hides the card before the next paint. The user sees nothing.
**Why:** DOM updates in the same task as `alert()` are not painted until the alert is dismissed [CITED: macarthur.me/posts/when-dom-updates-appear-to-be-asynchronous]. Both open and closed states apply within the same blocked task window. This is loopback-specific — in any two-context deployment (Phase 4+) the remote viewer paints independently while the alert stays open, and the card shows correctly.
**How to avoid:** (a) Recommended: demo logs a mono footer/log line ("dialog mirrored: alert open → closed") so the channel is visibly proven, and jsdom tests assert the card's state transitions directly; (b) optional planner choice: a minimum-visible-duration linger on the dialog built-in as a documented ledger divergence — improves demo wow-factor, diverges from parity's instant hide. Verify the actual paint behavior empirically when building the demo (trivial in-browser check).
**Warning signs:** demo acceptance criteria that require *seeing* the dialog card during a same-page alert.

### Pitfall 4: Mutations arriving before iframe onload are dropped
**What goes wrong:** In the loopback, capture's first rAF mutation flush can land between `srcdoc` set and `onload`; the viewer (parity-gated on streaming state) drops them; the mirror silently misses early rows.
**Why:** Reference gates `handleDOMMutations` on streaming state (3211), set only in onload (2813).
**How to avoid:** Accept as parity behavior — the miss accounting + CONTROL.START resync self-heals. Note it in the renderer README. Tests should not assume zero-loss before first load.
**Warning signs:** flaky loopback e2e assertions on mutations sent immediately after `start()`.

### Pitfall 5: ResizeObserver is undefined in jsdom
**What goes wrong:** `new ResizeObserver(...)` throws in every viewer test; suite dies at createViewer.
**How to avoid:** `typeof ResizeObserver !== 'undefined'` guard (reference parity, 3201); export `computeScale` for direct testing; optionally keep the window `resize` listener fallback (reference has both, 3194-3207).

### Pitfall 6: Wrong MIME kills the demo silently
**What goes wrong:** Module script served as `text/plain`/octet-stream → browser blocks it with a console-only error; demo shows a dead page.
**How to avoid:** MIME map with `text/javascript` for `.js`/`.mjs` (Pattern 7). Serve repo root so `../src/...` imports resolve.

### Pitfall 7: `contentWindow.scrollTo` noise in tests
**What goes wrong:** jsdom logs "Not implemented: Window's scrollTo() method" on every scroll message; CI output drowns.
**How to avoid:** Phase 1 precedent — `VirtualConsole` in test JSDOM construction (harness.js:62); keep the reference's try/catch around scrollTo (3365-3371).

### Pitfall 8: Dialog identity is nested — the staleness guard is a no-op for dialogs (reference quirk)
**What goes wrong:** Capture sends `{ dialog: { ...identity } }` (index.js:440-447) — identity lives INSIDE `payload.dialog`, so the reference's top-level `shouldAcceptPreviewMessage(payload)` finds no identity and always accepts (the `!identity` early-return branch, dashboard.js:209-210). A strict viewer that checks `isCurrentStream(payload.dialog, active)` would diverge from the reference.
**How to avoid:** Port parity (check top-level → dialogs effectively always accepted) and record the quirk in the renderer README; or check the nested identity as a deliberate ledger-documented improvement. Planner's call; either way it must be explicit, not accidental.

### Pitfall 9: Inline `<style>` text is inserted raw into the srcdoc head
**What goes wrong:** `payload.inlineStyles` join as `'<style>' + css + '</style>'` with no escaping (dashboard.js:2789-2791) — a `</style>` inside captured CSS breaks out into markup inside the mirror document.
**How to avoid:** Keep parity this phase (Phase 3 owns sanitization); the `allow-same-origin`-only sandbox means broken-out markup still cannot execute script. Flag in the renderer README's known-gaps section so Phase 3 picks it up as a chokepoint.

### Pitfall 10: Renderer purity drift
**What goes wrong:** Ported code drags `recordDashboardTransportEvent`, `ws.send`, FSB class names, or Font Awesome markup into `src/renderer/`.
**How to avoid:** Mirror `tests/capture-purity.test.js` (comment-stripping static scan) for `src/renderer/`: fail on `chrome.`, `\bFSB\b`, `fa-solid`, `dash-preview`, `WebSocket`, `recordDashboard`. Class names are `ps-overlay-*` per UI-SPEC.

## Code Examples

All verified against the reference this session; line numbers cited.

### Diff apply skeleton (port target) — dashboard.js:3209-3356
```js
// counters: { staleMisses, applyFailures } — reset on every new snapshot
// thresholds (parity): staleMisses >= 3 → resync; applyFailures >= 2 → resync;
// whole-batch catch → resync immediately. resyncPending latches until next snapshot.
function applyMutations(doc, mutations, counters, onMiss, onFailure) {
  mutations.forEach(function (m) {
    try {
      switch (m.op) {
        case 'add': {
          var parent = doc.querySelector('[data-fsb-nid="' + m.parentNid + '"]');
          if (!parent) { onMiss('add', m.parentNid); break; }
          var temp = doc.createElement('div');
          temp.innerHTML = m.html;                       // raw per parity (Phase 3 sanitizes)
          var newNode = temp.firstElementChild;
          if (!newNode) break;
          if (m.beforeNid) {
            var before = doc.querySelector('[data-fsb-nid="' + m.beforeNid + '"]');
            parent.insertBefore(newNode, before);        // null before == appendChild
          } else { parent.appendChild(newNode); }
          break;
        }
        case 'rm':   { /* querySelector nid; miss → onMiss; else el.parentNode.removeChild(el) */ break; }
        case 'attr': { /* querySelector nid; m.val === null ? removeAttribute : setAttribute */ break; }
        case 'text': { /* querySelector nid; textContent = m.text */ break; }
      }
    } catch (e) { onFailure(m, e); }                     // skip one, never break the batch
  });
  // parity: re-apply last known scroll once per batch (dashboard.js:3340-3342)
}
```
Use `NID_ATTR` from protocol instead of the literal in real code.

### Scale-to-fit (port target) — dashboard.js:2831-2869, simplified per UI-SPEC to fill-container
```js
function computeScale(pageW, pageH, containerW, containerH) {
  var w = Math.max(1, pageW || 1920), h = Math.max(1, pageH || 1080);
  var s = Math.min(containerW / w, containerH / h);
  if (!isFinite(s) || s <= 0) s = 1;
  return {
    s: s,
    offsetX: Math.max(0, (containerW - w * s) / 2),
    offsetY: Math.max(0, (containerH - h * s) / 2),
    pageW: w, pageH: h
  };
}
// apply: iframe.style.width = pageW+'px'; height = pageH+'px'; left = offsetX+'px';
//        top = offsetY+'px'; transform = 'scale('+s+')'; transform-origin: top left
```

### Snapshot HTML builder (port target) — dashboard.js:2785-2800
```js
var fullHTML = '<!DOCTYPE html><html' + htmlAttrs + '><head><meta charset="UTF-8">' +
  '<meta name="viewport" content="width=' + (payload.viewportWidth || 1920) + '">' +
  stylesheetLinks +          // '<link rel="stylesheet" href="' + url.replace(/"/g,'&quot;') + '">'
  inlineStyleTags +          // '<style>' + css + '</style>'  (raw — Pitfall 9)
  '<style>body { margin: 0; overflow: hidden; } *::selection { background: transparent; } ::-webkit-scrollbar { display: none; }</style>' +
  '</head><body' + bodyAttrs + '>' + payload.html + '</body></html>';
// htmlAttrs/bodyAttrs from buildShellAttributeString(payload.htmlAttrs, payload.htmlStyle)
// — port verbatim from dashboard.js:2671-2694 (name regex, style/on* drop, escaping)
```

### Loopback e2e test recipe (jsdom, verified mechanics)
```js
// 1. JSDOM page (pretendToBeVisual, VirtualConsole) with source pane + mirror pane.
// 2. Swap ambient globals per tests/differential/harness.js:192-219 pattern.
// 3. transport = createLoopbackTransport(); viewer = createViewer({container, transport: transport.viewerTransport});
// 4. capture = createCapture({transport: transport.captureTransport,
//      skipElement: (el) => !!(el.getAttribute && el.getAttribute('data-phantomstream-ui'))});
// 5. transport.onControl((type) => { if (type === CONTROL.START) capture.start(); });
// 6. capture.start(); await settle(win);   // settle() from harness.js:282-286
// 7. SRCDOC GLUE (jsdom can't parse srcdoc): const cd = iframe.contentDocument;
//    cd.open(); cd.write(iframe.srcdoc); cd.close();
// 8. mutate source pane; await settle(win); assert cd.querySelector mirrored change.
// 9. Dialog testing: do NOT run the interceptor (needs runScripts:'dangerously');
//    instead send STREAM.DIALOG through the transport and assert card state.
```

### Sandbox assertion at creation (criterion 3)
```js
iframe.setAttribute('sandbox', 'allow-same-origin');
// assert loudly at factory time (factory-time throws follow the capture precedent):
var tokens = (iframe.getAttribute('sandbox') || '').trim().split(/\s+/);
if (tokens.length !== 1 || tokens[0] !== 'allow-same-origin') {
  throw new Error('viewer-sandbox-invalid');
}
```
`allow-same-origin` without `allow-scripts` keeps `contentDocument`/`contentWindow` parent-accessible while the mirror cannot execute script — this exact combination is FSB's shipped production configuration [VERIFIED: reference viewer reads contentDocument throughout 3215-3341; sandbox value per 02-UI-SPEC parity row].

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `document.write` into iframes | `srcdoc` attribute | long-standardized | srcdoc is the parity-locked production path; write() survives only as jsdom test glue |
| window `resize` listener | `ResizeObserver` on container | broadly supported (all evergreen) | CONTEXT-locked driver; jsdom still lacks it — typeof-guard stays |
| Font icon classes (FA) | inline SVG | n/a (dependency policy) | UI-SPEC-locked divergence |
| FSB 9-state preview machine | minimal waiting/streaming gate | this phase | VIEW-02 (Phase 4) adds the formal state/event surface |

**Deprecated/outdated:** nothing in the phase's domain has shifted recently; the riskiest "knowledge currency" item (jsdom srcdoc support) was verified empirically rather than assumed.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Browsers do not paint same-task DOM updates before a blocking `alert()` shows, so the loopback dialog card is never visible during a same-page alert | Pitfall 3 | Demo design choice misdirected; trivially checked in-browser during demo build — if Chrome does paint, the log-line affordance is simply redundant |
| A2 | `queueMicrotask` preserves FIFO ordering for loopback delivery | Pattern 1 | Out-of-order snapshot/mutation application; HTML-spec-guaranteed, very low risk; sync delivery is the fallback |
| A3 | Setting `srcdoc` again on a live iframe re-fires `onload` in real browsers (re-snapshot path) | Pattern 6 | Re-snapshot wouldn't re-trigger scale/scroll init; reference production behavior implies it works (FSB shipped resync), and the demo verifies it manually |
| A4 | Strict MIME enforcement for module scripts (text/javascript required) | Pattern 7 | Demo fails to load — immediately visible and fixable; MDN-documented |

All other load-bearing claims in this document were verified by reading the cited sources or by executing jsdom experiments in this session.

## Open Questions

1. **Dialog visibility affordance in the one-page demo (Pitfall 3)**
   - What we know: open+closed both apply inside the alert-blocked task; two-context deployments are unaffected.
   - What's unclear: whether the user wants the log-line proof (parity-clean) or a minimum-visible linger (better demo, ledger divergence).
   - Recommendation: plan the log-line; offer the linger as an explicitly-flagged optional divergence.

2. **Capture edit to forward custom overlay kinds (Pattern 5)**
   - What we know: `broadcastOverlayState` drops all provider keys except glow/progress; VIEW-04 requires custom overlays "through the documented message type"; the edit is oracle-safe (no fixture uses an overlayProvider).
   - What's unclear: whether touching the Phase-1 capture module is acceptable in this phase's scope.
   - Recommendation: make the edit (few lines, wire-compatible, oracle re-run via `npm test` proves safety) and document in the capture README; the alternative — viewer-only `registerOverlay` with no wire path for custom kinds — under-delivers VIEW-04's "hosts can send custom DOM-anchored overlays."

3. **`detach` vs `destroy` exact semantics**
   - What we know: handle is `{ detach, destroy }` (CONTEXT-locked); no events surface.
   - Recommendation (planner detail): `detach()` = unsubscribe transport + remove viewer DOM (re-attachable not required this phase); `destroy()` = detach + disconnect ResizeObserver + clear registry/state, idempotent.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | tests, demo server | ✓ | v24.14.1 (CI: 20/22/24) | — |
| jsdom | renderer tests | ✓ (installed) | 29.1.1 | — |
| package-lock.json | reproducible install | ✓ | present | — |
| `.github/workflows/ci.yml` | CI ride-along | ✓ | runs `npm test` | — |
| Chromium browser | manual demo verification | not probeable here | — | demo verification is a human checkpoint, not CI |

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:** real-browser demo verification cannot run in CI this phase — plan a human-verify checkpoint for the loopback demo (real-browser rigor formally arrives Phases 4/5/12 per the Phase 1 jsdom decision).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | node:test + node:assert/strict (built-in), jsdom 29.1.1 |
| Config file | none (no config needed; conventions per tests/ and .planning/codebase/TESTING.md) |
| Quick run command | `node --test tests/renderer-*.test.js` |
| Full suite command | `npm test` (`node --test tests/*.test.js tests/differential/*.test.js`) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| VIEW-01 | createViewer creates root/iframe/overlay-layer, sandbox asserted, handle shape, scale math + clamps | unit/integration (jsdom) | `node --test tests/renderer-viewer.test.js` | ❌ Wave 0 |
| VIEW-01 | snapshot HTML string exact per UI-SPEC (reset CSS, metas, shell attrs) | unit (pure) | `node --test tests/renderer-snapshot.test.js` | ❌ Wave 0 |
| VIEW-04 | registry dispatch, built-ins via registry, unknown kind logged+ignored, coord mapping, snapshot reset | unit (jsdom + stubbed rects) | `node --test tests/renderer-overlays.test.js` | ❌ Wave 0 |
| VIEW-06 | diff apply ops + miss counters + resync thresholds/latch; scroll store/apply/re-apply; dialog card states, textContent, type labels | unit (createHTMLDocument target) | `node --test tests/renderer-diff.test.js` | ❌ Wave 0 |
| ADPT-04 | loopback e2e: capture+viewer one jsdom page, srcdoc write-glue, mutation tracked, CONTROL.START resync round-trip | integration | `node --test tests/renderer-loopback.test.js` | ❌ Wave 0 |
| (purity) | zero FSB/chrome/dashboard refs in src/renderer | static scan | `node --test tests/renderer-purity.test.js` | ❌ Wave 0 |
| (regression) | capture/protocol/oracle stay green (incl. any capture overlay edit) | full suite | `npm test` | ✅ exists |

Visual parity values (colors, radii, glow shadow) and real-browser srcdoc rendering: manual-only via the loopback demo — jsdom has no layout/paint (Phase 1 ledger'd limitation).

### Sampling Rate
- **Per task commit:** `node --test tests/renderer-*.test.js`
- **Per wave merge:** `npm test`
- **Phase gate:** full suite green + human-verified loopback demo in a real browser before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `tests/renderer-snapshot.test.js` — VIEW-01 (builder)
- [ ] `tests/renderer-diff.test.js` — VIEW-06 (apply/miss/resync)
- [ ] `tests/renderer-overlays.test.js` — VIEW-04
- [ ] `tests/renderer-viewer.test.js` — VIEW-01 (factory/sandbox/handle)
- [ ] `tests/renderer-loopback.test.js` — ADPT-04
- [ ] `tests/renderer-purity.test.js` — purity gate
- Framework install: none needed. Keep flat `tests/renderer-*.test.js` naming so the existing npm test glob needs no change.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | loopback has no network; auth is relay-phase (4) territory |
| V3 Session Management | partial | stream-identity staleness via `isCurrentStream` (not auth sessions) |
| V4 Access Control | no | — |
| V5 Input Validation | **yes** | viewer renders attacker-influenced HTML: sandbox `allow-same-origin` ONLY (no allow-scripts), asserted at creation; dialog message via `textContent` never innerHTML (dashboard.js:3414-3417 parity); shell attrs through `buildShellAttributeString` (on*/style dropped, escaped) |
| V6 Cryptography | no | — |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Script execution from mirrored HTML (`on*` attrs survive capture — known gap #5) | Elevation | sandbox without `allow-scripts` is THIS phase's backstop; capture/viewer sanitization chokepoints are Phase 3 (SEC-01/SEC-02) — do not partially build them now |
| `</style>` breakout via inline styles (Pitfall 9) | Tampering | parity-kept this phase; sandbox prevents script execution; flag for Phase 3 |
| Overlay payloads rendering HTML | Injection | built-ins use `textContent` for all message/label text; document that custom `renderFn`s receive the raw payload and own their escaping |
| Demo server path traversal | Information disclosure | resolve + root-prefix guard (Pattern 7); bind localhost |
| Sandbox weakened later (e.g. adding allow-scripts "to fix" something) | Elevation | creation-time assertion throws; add a test pinning the exact token list |

## Sources

### Primary (HIGH confidence — read/executed this session)
- `reference/dashboard/dashboard.js` lines 185-315 (identity guard, resync), 2607-2694 (state machine, escapers), 2723-2869 (snapshot, scale), 3194-3207 (resize), 3209-3460 (diff/scroll/overlay/dialog)
- `src/capture/index.js` (full read — Transport seam, skipElement semantics, body scoping, overlay broadcaster, dialog interceptor)
- `src/protocol/messages.js`, `src/protocol/constants.js`
- `tests/differential/harness.js` (loopback precedent, globals swap, settle), `tests/capture-purity.test.js`, `tests/differential/divergence-ledger.js` (schema)
- `src/capture/README.md`, `src/renderer/README.md`, `02-UI-SPEC.md` (parity contract — values intentionally NOT re-extracted here)
- Empirical jsdom 29.1.1 experiments executed in-repo (srcdoc, write, createHTMLDocument, rects, MutationObserver boundary, ResizeObserver, scrollTo)
- Repo-wide grep proving `dash:request-snapshot` does not exist; `ws-client.js:1324-1337` control mapping

### Secondary (MEDIUM confidence)
- [When DOM Updates Appear to Be Asynchronous — macarthur.me](https://macarthur.me/posts/when-dom-updates-appear-to-be-asynchronous/) (alert paint-blocking, Pitfall 3)
- MDN MIME types / module script strict MIME checking (training-stable, Pattern 7)

### Tertiary (LOW confidence)
- none — no unverified WebSearch-only claims made it into recommendations.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new dependencies; everything verified in-repo
- Architecture: HIGH — reference behavior read line-by-line; new seams (transport receive, registry) designed against in-repo precedents
- Pitfalls: HIGH for 1/2/4/5/6/7/8/9/10 (verified); MEDIUM for 3 (single secondary source; trivially checkable during demo build)
- jsdom test strategy: HIGH — all mechanics executed, not assumed

**Research date:** 2026-06-10
**Valid until:** 2026-07-10 (stable domain; jsdom findings pinned to 29.1.1 — re-verify only on jsdom major bump)
