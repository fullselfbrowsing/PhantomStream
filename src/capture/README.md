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
| `overlayProvider` | no | `null` | `() => ({ glow, progress })` — read host overlay state for the overlay side channel. With no provider, overlay messages carry `{ glow: null, progress: null }` (reference wire shape for an overlay-free page). |
| `skipElement` | no | `() => false` | `(el) => boolean` — predicate marking elements the host wants excluded from capture (its own UI). Applied to clone elements during serialization and to mutation targets during diffing. |

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

## Behavioral changes queued for the standalone version

- Capture computed styles for nodes added after the snapshot (Phase 8;
  reference gap #2 in ARCHITECTURE.md §6).
- Sanitize `on*` attributes and `javascript:` URLs in all serialization paths,
  not just the html/body shell (Phase 3 SEC-01; accepted threat T-01-03 until
  then — gap #5).
- Optional stylesheet-centric capture mode (CSSOM) for the paper's ablation
  study (Phase 9).

## Environment

Running the test suite requires Node >= 20.19 (jsdom 29 engines floor); the
library itself (`src/`) remains Node 18+-compatible — the documented runtime
floor for shipped code is unchanged.
