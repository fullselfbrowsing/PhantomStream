# capture

Page-side capture core: DOM snapshot + MutationObserver diff streaming behind an
injected `Transport` seam. Single-file extraction of the FSB reference
implementation (`reference/extension/dom-stream.js`, shipped as FSB milestone
v0.9.9.1), proven op-stream-equivalent to the reference by the differential
oracle in `tests/differential/`.

Runs in any injection context — extension content script, Playwright/CDP
`Page.addScriptToEvaluateOnNewDocument`, bookmarklet, or an embedded SDK.
`window`/`document` and friends are ambient globals dereferenced only inside
the factory and the functions it builds, so importing this module in bare Node
is side-effect free.

## Factory

```js
import { createCapture } from '@fullselfbrowsing/phantom-stream/capture';

const capture = createCapture({
  transport,
  logger,
  overlayProvider,
  skipElement,
  styleMode: 'computed',
});
// -> { start, stop, pause, resume, getNodeId, handleControl }
```

| Option | Required | Default | Purpose |
|--------|----------|---------|---------|
| `transport` | yes | — | Message sink: `{ send(type, payload), flush?() }`. The factory throws `Error('transport-send-required')` when `transport.send` is not a function — factory-time validation is the only place the capture may throw. |
| `logger` | no | console-backed (`info`/`warn`/`error`) | Receives lifecycle logs and every contained transport error. |
| `overlayProvider` | no | `null` | `() => ({ glow, progress, ...customKinds })` — read host overlay state for the overlay side channel. **All** own enumerable provider keys are forwarded on the wire as overlay kinds (extension E1 below); `glow`/`progress` default `null` when omitted; the identity keys (`streamSessionId`/`snapshotId`) are reserved and never overwritten. With no provider, overlay messages carry `{ glow: null, progress: null }` (reference wire shape for an overlay-free page). |
| `skipElement` | no | `() => false` | `(el) => boolean` — predicate marking elements the host wants excluded from capture (its own UI). Applied **ancestor-inclusively** (like `closest()`, matching the reference's overlay handling): an element is excluded when the predicate matches it or any of its ancestors, so a root-only predicate (e.g. `el.id === 'my-overlay'`) excludes its whole subtree. Skipped subtrees receive no node-id assignment during serialization, and mutations anywhere inside them are dropped during diffing. |
| `blockSelector` | no | `null` | CSS selector for private regions that must never reach the wire. Matching elements serialize as placeholders with `rr_width` and `rr_height` only; their attrs, children, and text are omitted. Placeholder identity travels in the `nodeIds` sidecar. |
| `maskTextSelector` | no | `null` | CSS selector for text that should be masked before transport. Non-whitespace chars become `*` by default, preserving whitespace and length. |
| `maskInputs` | no | `false` | When true, masks form control values. Password inputs are always masked even when this is false. |
| `maskTextFn` / `maskInputFn` | no | asterisk mask | Custom masking functions. They are fail-closed: thrown errors are logged and the default mask is used. |
| `styleMode` | no | `'computed'` | <code>'computed' &#124; 'cssom'</code> — default mode preserves the legacy curated computed-style snapshot path. CSSOM mode omits generated computed inline styles and transports scoped `styleSources[]` plus `styleStrategy` instead. |
| `fetchStylesheet` | no | `null` | Optional synchronous hook used only by CSSOM mode when a stylesheet cannot expose readable `cssRules` and cannot be safely re-linked. Called as `fetchStylesheet({ href, scope, ownerKind })`; PhantomStream never performs hidden network fetches. |

A readiness ping (`STREAM.READY`) is emitted once, at factory creation
(divergence-ledger entry D3 — the reference pinged at script-load time).

## Transport contract (D-07)

- `send(type, payload)` — **required.** Fire-and-forget, mirroring
  `chrome.runtime.sendMessage` semantics: the capture never awaits delivery.
  `type` is a `STREAM.*` protocol string from `src/protocol/messages.js`.
- `flush()` — **optional**, defaults to a no-op. Invoked once at the end of
  `stop()`, the one deterministic drain point the core offers buffering hosts.
  Wire-invisible with the default.
- **Transport errors never propagate into the capture path.** Synchronous
  throws and rejected promises from `send`/`flush` are routed to the injected
  logger; capture continues. Enforced by test
  (`tests/capture-lifecycle.test.js`), not just convention.

## Lifecycle host contract (D-06)

- `start()` — begins a **fresh session**: mints a new `streamSessionId` and a
  new `snapshotId`, serializes and sends a full snapshot, then arms the
  mutation observer and scroll tracker. Calling `start()` while streaming
  restarts cleanly (re-injection guard).
- `stop()` — halts observers (a final mutation flush included), then invokes
  the transport's `flush()` drain point. `stop()` then `start()` = fresh
  session, matching the reference implementation.
- `pause()` — suspends observers and flushing but keeps the session alive.
- `resume()` — re-arms observers and continues the **same**
  `streamSessionId`/`snapshotId` **without re-snapshotting**. Mutations that
  occurred while paused are **missed by design**. Guidance: *pause when the
  page is quiescent, or `stop()`/`start()` to force a fresh snapshot.*

There is no `refresh()` method in this version — deliberate: the factory
surface is exactly the four methods above (D-05). Hosts needing a fresh view
call `stop()` then `start()`.

## Node identity and semantic addressing

Capture owns node identity in closure-local state, not in the observed page.
Tracked live elements are mapped with an internal `WeakMap<Element, string>`
and reverse lookup used by mutation batching. PhantomStream does not write or
read framework-owned `data-fsb-nid` attributes on the live page; page-owned
attributes with that name remain ordinary page data.

Snapshot payloads and add ops carry identity as `nodeIds` sidecars ordered by
the serialized element preorder. The renderer pairs those sidecars with the
sanitized mirror nodes to rebuild its own index while the HTML stays free of
framework identity attributes.

Trusted host code can call:

```js
const nid = capture.getNodeId(element);
// -> string | null
```

`getNodeId(element)` returns the active PhantomStream nid for a tracked, live
`Element`, or `null` for inactive sessions, skipped nodes, untracked nodes,
non-elements, and disconnected elements. It is the capture-side bridge for
semantic addressing; it exposes identity only, never mirrored content.

## Phase 8 fidelity surfaces

Open shadow roots, same-origin iframes, live form values, late-added computed
styles, and truncated subtree recovery extend the same Phase 7 identity model.
They do not reintroduce live-page `data-fsb-nid` writes or selector fallback.

### Open shadow roots

Snapshot and add-op serialization traverses every discovered open `shadowRoot`
and emits `shadowRoots[]` sidecars keyed by the light-DOM host nid. The host
stays in the main `html`; shadow content travels as sanitized shadow HTML plus
its own `nodeIds`. `<slot>` elements remain in the shadow payload, while
slotted light-DOM children remain owned by the host's normal child list, so
slot projection is not duplicated.

Capture observes open shadow roots deliberately. Existing roots are observed
when streaming starts, newly attached roots are discovered through the
`attachShadow` wrapper, and later shadow mutations emit `DIFF_OP.SHADOW_ROOT`
replacement ops keyed by `hostNid`. Closed shadow roots are not introspectable
and are not captured.

### Iframes

Same-origin iframes serialize through `frames[]` sidecars keyed by `frameNid`.
Accessible frame documents carry sanitized body HTML, frame-local `nodeIds`,
frame shell attrs/styles, nested `frames[]`, and head stylesheet metadata.
Frame document roots are observed so same-origin frame mutations and value
diffs stream with frame-scoped identity.

Cross-origin iframe content is never read. Inaccessible frames emit
content-free metadata only: kind, safe src/origin labels, and dimensions where
available. The main payload keeps the iframe host but not remote document
content.

### Live value diffs

MutationObserver cannot see property-only form value drift, so capture installs
`input` and `change` listeners on the main document, open shadow roots, and
same-origin frame documents. Listener output is a narrow `DIFF_OP.VALUE` op
with the control nid plus only the relevant state: `value`, `checked`, and/or
`selectedValues`.

All value-bearing fields pass through the existing masking chokepoint before
transport. Password values remain always masked; `maskInputs` and
`maskInputFn` apply to value diffs exactly as they do to snapshot and attr
paths. Diagnostics and health telemetry do not carry typed values.

### Added-node styles

Add ops now collect curated computed styles for each live element in the added
subtree before mutating the detached wire clone. This reuses `CURATED_PROPS`
and `STYLE_DEFAULTS`, appending declarations to existing inline styles before
`sanitizeForWire('subtree')`. The capture does not enumerate every computed
property and does not implement full CSSOM capture; stylesheet-centric CSSOM
mode remains Phase 9.

### Subtree requests

Budget truncation replaces dropped roots with
`data-phantomstream-truncated="true"` markers while preserving their nids in
`nodeIds`. Hosts/viewers can request a specific missing or truncated nid by
calling capture through:

```js
capture.handleControl(CONTROL.SUBTREE_REQUEST, {
  requestId,
  nid,
  streamSessionId,
  snapshotId,
  reason,
});
```

`handleControl` emits `STREAM.SUBTREE_RESPONSE` with `status: 'ok'`, `stale`,
`gone`, `skipped`, `blocked`, or `untracked`. Successful responses reuse the
add-op serialization policy: sanitized HTML, masking, URL absolutification,
curated styles, `nodeIds`, `shadowRoots[]`, and `frames[]`. Miss responses are
content-free and clear the request path without exposing page data.

## Phase 9 CSSOM style mode

`styleMode: 'computed' | 'cssom'` controls how visual style fidelity is
transported:

- `'computed'` is the default and preserves the Phase 8 behavior: curated
  computed declarations are written into snapshot and add-op HTML. Default
  payloads do not include `styleSources[]` or `styleStrategy`.
- `'cssom'` switches snapshots to stylesheet-centric capture. Document,
  open-shadow-root, and same-origin-frame scopes carry sanitized
  `styleSources[]` entries plus a `styleStrategy` summary. Generated computed
  inline styles are not written into cloned HTML.

A `styleSources[]` entry includes a stable `sourceId`, `scope`
(`{ kind: 'document' }`, `{ kind: 'shadow', hostNid }`, or
`{ kind: 'frame', frameNid }`), `ownerKind`, `order`, and either sanitized
`cssText` or a safe `href`. `styleStrategy` records mode, source counts, byte
counts, and fallback counts for diagnostics.

Stylesheet fallback reasons are explicit and wire-visible:

- `cssRules-blocked` — the browser denied `sheet.cssRules`.
- `href-relinked` — an inaccessible external stylesheet had a safe URL, so
  the renderer can install a link instead of inlining CSS.
- `adapter-fetch` — the host-provided `fetchStylesheet({ href, scope, ownerKind })`
  hook supplied CSS text.
- `computed-fallback` — no readable/relinkable/fetched stylesheet source was
  available for that owner.

Live stylesheet changes stream as `DIFF_OP.STYLE_SOURCE` ops with
`action: 'upsert' | 'replace' | 'remove'`. The payload is scoped the same way
as snapshots. `CSSStyleSheet.insertRule` / `deleteRule` / `replaceSync` are
patched while streaming in CSSOM mode; if a hook cannot be installed, capture
logs `cssom-hook-unavailable` and sends a fresh snapshot rather than guessing.
If a known style owner cannot be reconciled, the op carries
`cssom-style-source-stale` so the renderer can request recovery. Renderer-side
scope misses surface as `stale-style-scope`.

The boundary rules are unchanged: closed shadow roots, cross-origin iframe
content, and media pixels/streams are not captured. CSSOM mode is an opt-in
capture path only; it does not publish the npm package, swap the FSB reference
into production, or provide the Phase 12 baseline/ablation tables.

## Module layout

Single-file core (`index.js`) per the Phase 1 user override (D-10); the
serializer/differ/side-channels/session split sketched in earlier drafts is
deferred to a later phase — parity with the reference, proven by the
differential oracle, was the Phase 1 exit bar.

`tests/differential/divergence-ledger.js` is the **machine-readable record of
intentional divergences** from the reference; human-readable divergence docs
(including this file) derive from the ledger, never the reverse (D-03).
Notable entries:

- **D1** — resume semantics: the reference re-snapshots with a fresh session
  on resume; this core continues the session (see contract above).
- **D4** — the `pingDomStream` readiness probe is dropped from the core
  (hosts call the lifecycle functions directly).
- **D5** — the `domStreamRequestOverlay` on-demand overlay rebroadcast
  control path is dropped from the core.

D4 and D5 are reintroduced host-side by the Phase 6 MV3 adapter (ADPT-01).

Phase 2 extension (additive, default-off — not a Phase 1 reference
divergence, so it lives here rather than in the differential ledger):

- **E1 (Phase 2, VIEW-04)** — overlay key forwarding: `broadcastOverlayState`
  forwards **every** own enumerable key the `overlayProvider` returns as an
  overlay kind on the `STREAM.OVERLAY` wire, so custom DOM-anchored overlays
  reach the viewer's `registerOverlay` seam end-to-end. Constraints:
  `glow`/`progress` still default `null` when the provider omits them, and
  the identity keys (`streamSessionId`/`snapshotId`) are stamped **last** so
  a provider can never overwrite stream identity. Wire-compatible when no
  provider is present: with no provider (or a throwing provider) the message
  is byte-identical to the reference shape
  `{ glow: null, progress: null, streamSessionId, snapshotId }` — re-proven
  oracle-safe by the full differential suite (no fixture configures an
  overlayProvider). Pinned by `tests/capture-overlay-forward.test.js`.
- **E2 (Phase 2, fidelity fix)** — bare text-node childList mutations
  (`el.textContent = '...'` replaces the text child as a childList record,
  not characterData) now emit a `text` op for the mutation target element,
  deduplicated per batch; the reference drops them entirely (silent mirror
  text drift, found at the Phase 2 real-browser checkpoint). Declared as
  differential ledger entry D6 (pinned by the `text-childlist` oracle
  scenario) and covered end-to-end in `tests/renderer-loopback.test.js`.
  **Mixed-content guard (review CR-01):** emission is gated on the live
  target having no element children at flush time (`firstElementChild`) —
  the renderer applies the op as `textContent =`, which would otherwise
  destroy mirrored element subtrees that still exist live (text-node
  appends into mixed containers, `innerHTML` with mixed content). The
  `textContent = '...'` shape keeps emitting (its element children were
  just removed, so the live read is null). Residual gap (accepted,
  reference drop behavior): bare text changes inside mixed-content
  containers drift in the mirror until the next snapshot/resync — text
  drift, never structural flattening. Pinned by the mixed-content shapes
  in `tests/renderer-loopback.test.js`.
- **E3 (Phase 3, SEC-01/SEC-03)** — capture-side sanitization and privacy
  masking now run before transport through the named `sanitizeForWire`
  chokepoint. Snapshot walks, add-op subtrees, attr ops, characterData text
  ops, E2 text-childlist ops, and inline head CSS all route through the
  chokepoint; `on*` attrs, dangerous URL schemes, `srcdoc`, object/embed
  subtrees, hostile CSS values, and configured private text/form values are
  stripped, neutralized, dropped, or masked before they can leave the page.
  Password values are always masked, `blockSelector` placeholders use the
  rrweb vocabulary (`rr_width`/`rr_height`), and selector validation fails
  at factory time. This is the deliberate reference divergence ledgered as
  **D7** in `tests/differential/divergence-ledger.js`, backed by
  `tests/security-sanitize-capture.test.js`, `tests/security-mask.test.js`,
  and the sanitize-divergence oracle scenario.
- **E4 (Phase 7, CAPT-07/VIEW-03)** — node identity moved from live-page
  attributes to an internal `WeakMap` mirror plus `nodeIds` sidecars on
  snapshots and add ops. The observed page is no longer mutated for
  framework identity, page-owned `data-fsb-nid` remains page data, and
  `getNodeId(element) -> string|null` is the public live-element lookup.

## Environment

Running the test suite requires Node >= 20.19 (jsdom 29 engines floor); the
library itself (`src/`) remains Node 18+-compatible — the documented runtime
floor for shipped code is unchanged.
