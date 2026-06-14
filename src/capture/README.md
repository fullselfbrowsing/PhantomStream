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

const capture = createCapture({ transport, logger, overlayProvider, skipElement });
// -> { start, stop, pause, resume }
```

| Option | Required | Default | Purpose |
|--------|----------|---------|---------|
| `transport` | yes | — | Message sink: `{ send(type, payload), flush?() }`. The factory throws `Error('transport-send-required')` when `transport.send` is not a function — factory-time validation is the only place the capture may throw. |
| `logger` | no | console-backed (`info`/`warn`/`error`) | Receives lifecycle logs and every contained transport error. |
| `overlayProvider` | no | `null` | `() => ({ glow, progress, ...customKinds })` — read host overlay state for the overlay side channel. **All** own enumerable provider keys are forwarded on the wire as overlay kinds (extension E1 below); `glow`/`progress` default `null` when omitted; the identity keys (`streamSessionId`/`snapshotId`) are reserved and never overwritten. With no provider, overlay messages carry `{ glow: null, progress: null }` (reference wire shape for an overlay-free page). |
| `skipElement` | no | `() => false` | `(el) => boolean` — predicate marking elements the host wants excluded from capture (its own UI). Applied **ancestor-inclusively** (like `closest()`, matching the reference's overlay handling): an element is excluded when the predicate matches it or any of its ancestors, so a root-only predicate (e.g. `el.id === 'my-overlay'`) excludes its whole subtree. Skipped subtrees receive no node-id assignment during serialization, and mutations anywhere inside them are dropped during diffing. |
| `blockSelector` | no | `null` | CSS selector for private regions that must never reach the wire. Matching elements serialize as placeholders with `data-fsb-nid`, `rr_width`, and `rr_height` only; their attrs, children, and text are omitted. |
| `maskTextSelector` | no | `null` | CSS selector for text that should be masked before transport. Non-whitespace chars become `*` by default, preserving whitespace and length. |
| `maskInputs` | no | `false` | When true, masks form control values. Password inputs are always masked even when this is false. |
| `maskTextFn` / `maskInputFn` | no | asterisk mask | Custom masking functions. They are fail-closed: thrown errors are logged and the default mask is used. |

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

## Behavioral changes queued for the standalone version

- Capture computed styles for nodes added after the snapshot (Phase 8;
  reference gap #2 in ARCHITECTURE.md §6).
- Optional stylesheet-centric capture mode (CSSOM) for the paper's ablation
  study (Phase 9).

## Environment

Running the test suite requires Node >= 20.19 (jsdom 29 engines floor); the
library itself (`src/`) remains Node 18+-compatible — the documented runtime
floor for shipped code is unchanged.
