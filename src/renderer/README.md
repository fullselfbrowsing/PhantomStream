# renderer

Viewer-side reconstruction: sandboxed-iframe snapshot render + nid-addressed
diff apply behind an injected `ViewerTransport` seam. Extraction of the FSB
reference viewer's stream plumbing (`reference/dashboard/dashboard.js`,
shipped as FSB milestone v0.9.9.1 — identity guard and resync at lines
185-278, snapshot/scale at 2723-2869, resize wiring at 3194-3207,
mutation/scroll/overlay/dialog handlers at 3209-3443), with the FSB
dashboard chrome dropped and every intentional departure recorded in the
divergence ledger below (Phase 2; the parity bar is behavioral equivalence
of the stream path, not the dashboard UI around it).

Module split (the seams jsdom forces — see Environment):

```
snapshot.js   buildSnapshotHtml(payload) -> string   pure srcdoc builder
diff.js       applyMutations(doc, ops, counters)     Document-parameterized applier
overlays.js   createOverlays / mapRectToHost / OVERLAY_CSS
index.js      createViewer factory + barrel re-exports of all of the above
```

## Factory

```js
import { createViewer } from '@fullselfbrowsing/phantom-stream/renderer';

const viewer = createViewer({ container, transport, logger });
// -> { detach, destroy, registerOverlay }
```

Calling the factory auto-attaches a live mirror: the viewer root (stamped
`data-phantomstream-ui="viewer"`), one injected `<style>` element carrying
`OVERLAY_CSS`, the sandboxed mirror iframe (hidden until the first snapshot
loads), and the host-document overlay layer. The first `STREAM.SNAPSHOT`
that arrives renders; everything after streams.

| Option | Required | Default | Purpose |
|--------|----------|---------|---------|
| `container` | yes | — | Host element the viewer root is appended into. The viewer always fills its container (layout is the host's job — ledger entry R1). The factory throws `Error('viewer-container-required')` otherwise. |
| `transport` | yes | — | `ViewerTransport` (below). The factory throws `Error('viewer-transport-required')` when `send` or `onMessage` is not a function. |
| `logger` | no | console-backed (`info`/`warn`/`error`) | Receives every contained error and health warning (`'[Renderer]'` prefix): diff-apply misses, transport send failures, unknown overlay kinds, nid-rect resolution failures. |

Factory-time validation is the **only** place this module throws
(`viewer-container-required`, `viewer-transport-required`,
`viewer-sandbox-invalid`); after creation every error routes to the injected
logger.

## Transport contract

```js
/**
 * @typedef {Object} ViewerTransport
 * @property {(type: string, payload: Object) => void} send
 *   Viewer -> capture host (CONTROL.* messages). Fire-and-forget; errors
 *   are contained to the logger.
 * @property {(handler: (type: string, payload: Object) => void) => (() => void)} onMessage
 *   Subscribe to capture-host -> viewer (STREAM.*) messages. Returns an
 *   unsubscribe function; detach() invokes it.
 */
```

This mirrors the capture `Transport`'s fire-and-forget `send` and adds the
receive side. Phase 4's WebSocket transport implements the same interface by
encoding/decoding envelopes — the viewer never changes. For a zero-
infrastructure same-page wiring, a loopback transport implements both ends
(this is the pattern `tests/renderer-loopback.test.js` and the
`examples/loopback-mirror.html` demo use):

```js
function createLoopbackTransport() {
  const toViewer = new Set(); // STREAM.* handlers (viewer subscribes)
  const toHost = new Set();   // CONTROL.* handlers (host glue subscribes)
  const fanOut = (handlers, type, payload) =>
    queueMicrotask(() => handlers.forEach((h) => h(type, payload)));
  return {
    captureTransport: { send: (t, p) => fanOut(toViewer, t, p) },
    viewerTransport: {
      send: (t, p) => fanOut(toHost, t, p),
      onMessage: (h) => { toViewer.add(h); return () => toViewer.delete(h); },
    },
    onControl: (h) => { toHost.add(h); return () => toHost.delete(h); },
  };
}

const transport = createLoopbackTransport();
const viewer = createViewer({ container, transport: transport.viewerTransport });
const capture = createCapture({ transport: transport.captureTransport, skipElement });
transport.onControl((type) => { if (type === CONTROL.START) capture.start(); });
capture.start();
```

Wiring order matters: the loopback has no buffering, so the viewer must
exist (subscribed and skip-marked) **before** the first snapshot is sent.
The viewer's re-snapshot request is `CONTROL.START` (ledger entry R2) — the
host glue maps it to `capture.start()`, which restarts cleanly while
streaming.

## Handle contract

- `detach()` — unsubscribe from the transport, remove the resize listeners,
  disconnect the ResizeObserver, and remove the viewer root from the
  container. Idempotent.
- `destroy()` — `detach()` plus state/overlay reset (counters, identity,
  resync latch, overlay registry dispatch of the null reset). Idempotent;
  safe after `detach()`.
- `registerOverlay(kind, renderFn)` — register a custom overlay kind (the
  host-facing extension seam, below). The handle surface is locked to
  exactly these three members this phase; events (VIEW-02) arrive in
  Phase 4, addressing in Phase 7.

## Overlay channel contract (VIEW-04)

`STREAM.OVERLAY` payloads dispatch through one kind-keyed registry: **every
own payload key except the reserved identity keys
(`streamSessionId`/`snapshotId`) is an overlay kind.** The built-ins (`glow`,
`progress`) are pre-registered through the exact same registry custom kinds
use — there is no special-cased dispatch path.

```js
viewer.registerOverlay('badge', (payload, anchorRect, layer) => {
  // payload: the RAW wire value for this kind (null = hide/clear)
  // anchorRect: {top, left, width, height} in host px, or null
  // layer: the overlay layer element (write your DOM here)
});
```

- **Anchor-rect priority:** payload value carries a `nid` → the mirrored
  element's bounding rect, mapped to host coordinates (a stale nid yields
  `null`, no coordinate fallback) → otherwise numeric `x/y/w/h` →
  `mapRectToHost` with the current scale state → otherwise `null`
  (fixed-position overlays like the progress pill).
- **Null contract:** every renderFn (built-in or custom) receives `null` to
  hide/clear; each new snapshot dispatches `(null, null, layer)` through
  every registered kind (the reset contract).
- **Escaping:** the renderFn receives the **raw** payload value —
  capture-side data is attacker-influenced, so custom renderFns own their
  escaping (write text via `textContent` like the built-ins, never
  `innerHTML`).
- **Unknown kinds** are logged (`[Renderer] unknown overlay kind ignored`)
  and skipped — never thrown (forward-compatible).
- **Throwing renderFns** are contained: routed to the logger, the kind loop
  continues.

On the capture side, every own enumerable key returned by the
`overlayProvider` is forwarded on the wire as an overlay kind (capture
README entry E1), so custom DOM-anchored overlays flow end-to-end:
provider → wire → `registerOverlay` renderFn. The dialog card
(`STREAM.DIALOG`) renders alert/confirm/prompt mirroring with the message
through `textContent`, never `innerHTML`.

## Recursion guard for same-page hosts

When the capture and the viewer share one page (the loopback demo, any
embedded-SDK host that mirrors its own tab), the viewer lives inside the
capture's body-scoped observer. Without exclusion, two feedback paths fire:
the snapshot embeds the mirror (`cloneNode` copies the iframe's `srcdoc`),
and every srcdoc write echoes back as a megabyte `attr` mutation —
amplification until the truncation budget chokes.

The viewer root therefore stamps `data-phantomstream-ui="viewer"`, and the
host passes the capture this predicate:

```js
skipElement: function (el) {
  return !!(el.getAttribute && el.getAttribute('data-phantomstream-ui'));
}
```

**Predicates MUST be attribute- or id-based, never object identity and never
`document.contains`:** during serialization the predicate runs against
detached **clone** elements, during diffing against **live** elements — an
`el === viewerRoot` check matches only the live side and the clone leaks
into snapshots. Both guard paths (snapshot cleanliness, zero mutation echo)
are pinned end-to-end by `tests/renderer-loopback.test.js`.

## Divergence ledger

Phase 1 discipline: every intentional departure from the reference viewer is
explicit, never accidental. Entries R1-R12; "drop" means FSB dashboard
chrome removed, "divergence" means changed behavior, "reconstruction" means
parity values rebuilt from documentation because the source asset is not
vendored.

- **R1 — Layout modes dropped.** `inline`/`maximized`/`pip`/`fullscreen` are
  FSB dashboard UI, not framework concerns (CONTEXT decision D-03). The
  viewer always fills its container; layout belongs to the host. The
  `layout.js` module sketched in earlier drafts is not extracted.
- **R2 — The resync message is `CONTROL.START`.** A message named
  `dash:request-snapshot` does not exist anywhere in the protocol or the
  reference; the reference's resync path sends `dash:dom-stream-start`
  (= `CONTROL.START`), latched until the next snapshot. No new protocol
  constant was minted.
- **R3 — `dash:request-status` dropped from the resync path.** The reference
  paired its re-snapshot request with an FSB status refresh; the framework
  viewer sends `CONTROL.START` alone.
- **R4 — tabId identity checks dropped.** Tab identity is an FSB extension
  concern; staleness goes through the protocol's `isCurrentStream`
  (streamSessionId/snapshotId) instead.
- **R5 — Transport-event ring buffers dropped.**
  `recordDashboardTransportEvent`/`-Error` diagnostics are FSB dashboard
  state; renderer diagnostics route to the injected logger with the
  `'[Renderer]'` prefix (plus the miss/failure counters that feed resync).
- **R6 — FSB 9-state preview machine → minimal `waiting`/`streaming` gate.**
  The reference's `previewState` sub-views (loading, disconnected, error,
  ...) are dashboard UI. The viewer gates mutation/scroll/overlay/dialog
  application on `streaming` exactly like the reference did; the formal
  state/event surface (VIEW-02) arrives in Phase 4.
- **R7 — Font Awesome → inline SVG icons.** A zero-dependency framework
  cannot ship an icon font; the dialog icons (warning-triangle,
  question-circle, keyboard) are equivalent inline SVGs.
- **R8 — iframe title renamed.** `"PhantomStream live mirror"` replaces the
  FSB dashboard's preview title.
- **R9 — Accessibility additions (additive).** `role="status"` +
  `aria-live="polite"` on the dialog card; `aria-hidden="true"` on the
  decorative glow/progress elements; glow reposition transitions wrapped in
  `@media (prefers-reduced-motion: no-preference)`.
- **R10 — Glow and progress visuals are documented reconstructions.** The
  glow's 2px `#f59e0b` border / 4px radius / `0 0 12px rgba(245,158,11,0.6)`
  shadow and the progress pill's position/scrim are rebuilt from the
  02-UI-SPEC parity contract — the reference stylesheet lines are not
  vendored in this repo. The dialog card CSS, scale formula, scroll
  smoothing, and overlay coordinate math are exact parity.
- **R11 — Dialog identity-nesting quirk ported as parity.** Capture nests
  stream identity **inside** `payload.dialog`, so the viewer's top-level
  `isCurrentStream` check finds no identity and always accepts dialogs —
  exactly like the reference's `shouldAcceptPreviewMessage` no-identity
  early return. Deliberate parity choice, commented in code; revisit when
  Phase 4 introduces multi-stream transports.
- **R12 — Creation-time persistent load listener replaces per-snapshot
  `iframe.onload` (forced divergence).** jsdom 29 (verified empirically)
  only queues the iframe's initial about:blank load event when a load
  listener already exists at insertion time, and never re-fires load on
  srcdoc writes — the reference's per-snapshot `iframe.onload =` assignment
  therefore never executes under test. One `addEventListener('load', ...)`
  attached before insertion, guarded on the pending snapshot payload,
  behaves identically in real browsers (fires on every srcdoc load with the
  reference's onload body: scale, initial scrollTo, mark streaming,
  un-hide). Relatedly, the viewer stays `streaming` across re-snapshots
  (reference parity): mutations carrying the new identity apply without
  waiting for a new load event.

## Phase 3 security behavior

The Phase 3 security pipeline is always on and documented in
`docs/SECURITY.md`:

- **Inline CSS is scrubbed and backed by CSP.** `payload.inlineStyles` route
  through `scrubCssText` before srcdoc assembly, and the srcdoc head carries
  the adopted Content-Security-Policy meta. `payload.html` intentionally
  remains raw at the string layer because string-scrub-then-reparse is the
  mutation-XSS anti-pattern; the capture chokepoint, post-parse
  `sanitizeFragment` scrub, CSP, and sandbox form the defense chain.
- **`on*` attributes and dangerous URLs are scrubbed at both chokepoints.**
  Capture strips or neutralizes before transport, and render applies
  `sanitizeFragment` / `sanitizeAttrValue` before reconstructed content
  reaches the mirror document.
- **Template-context add-op parsing is live.** The add op parses `m.html`
  through `<template>`, then runs `sanitizeFragment` before `importNode`.
  Context-dependent elements (`<tr>`, `<td>`, `<tbody>`, `<col>`, and
  friends) no longer disappear through a div-context parser.
- **Embed contract is explicit.** The mirror iframe sandbox is exactly
  `allow-same-origin`; hosts must never add `allow-scripts` or render wire
  payloads outside `createViewer`.

## Known remaining behaviors

- **Pre-onload mutation drop (parity, self-healing).** Mutations arriving
  between the srcdoc write and the load event are dropped (the reference
  gates on streaming state). The miss accounting + `CONTROL.START` resync
  self-heals any resulting drift; do not write tests that assume zero loss
  before the first load.
- **Per-op `querySelector` nid lookups (Phase 7).** Every diff op resolves
  its target via `doc.querySelector('[data-fsb-nid="..."]')` (reference
  parity). The planned `Map<nid, Node>` index replaces the hot path when the
  addressing API lands.

## Environment

- **Sandbox contract:** the mirror iframe's sandbox is **exactly**
  `allow-same-origin` — no `allow-scripts`, ever. The factory writes the
  attribute, reads it back, and asserts the token list at creation
  (`viewer-sandbox-invalid` otherwise), so a hostile or broken environment
  fails loudly instead of weakening the sandbox silently. `allow-same-origin`
  keeps `contentDocument` parent-accessible for diff applies and overlay
  rect reads while the mirror cannot execute script. The full embed security
  contract (CSP guidance, sanitization guarantees, and host must-nevers) is
  documented in `docs/SECURITY.md`.
- **jsdom srcdoc limitation:** jsdom 29 never parses the `srcdoc` attribute
  into `contentDocument` (the attribute round-trips; the document stays
  empty). Tests must never assert mirror content through `contentDocument`
  after only setting srcdoc. The e2e pattern is the manual write-glue —
  `cd.open(); cd.write(iframe.srcdoc); cd.close();` — after which diff
  applies hit the written document because the viewer reads
  `contentDocument` fresh per message (see
  `tests/renderer-loopback.test.js`). Real browsers parse srcdoc natively;
  visual parity and real-browser srcdoc rendering are verified manually via
  the loopback demo.
- Running the test suite requires Node >= 20.19 (jsdom 29 engines floor);
  the library itself (`src/`) remains Node 18+-compatible.
