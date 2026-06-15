# Phase 4: Relay, WS Transport & Two-Tab Demo - Context

**Gathered:** 2026-06-14T23:10:43-05:00
**Status:** Ready for planning

<domain>
## Phase Boundary

Deliver the first networked PhantomStream path: a transport-agnostic relay core, a self-hostable WebSocket reference backend, an ordered compression/decompression transport, viewer lifecycle/health events, and a zero-config two-tab demo where one browser tab captures a live page and another tab mirrors it through the bundled local relay.

This phase does not add remote control, Playwright/CDP injection, extension/bookmarklet adapters, npm publishing, CSSOM capture, node-identity rework, or FSB package swap-in. Those are later roadmap phases.

</domain>

<decisions>
## Implementation Decisions

### Discussion Mode
- **D-01:** The interactive question UI was unavailable in this Conductor mode, so the recommended Phase 4 scope was selected under the GSD fallback: demo experience, relay pairing/state, codec compatibility, viewer health events, and verification.
- **D-02:** Treat the decisions below as conservative defaults for planning. They should be implemented unless research finds a concrete blocker, in which case the planner must call out the deviation explicitly.

### Two-Tab Demo Experience
- **D-03:** `npx phantom-stream demo` should start a local-only demo server plus bundled relay, then print two explicit URLs: a source/capture tab and a viewer tab. Browser auto-open may be added behind an option if cheap, but the deterministic default is printed URLs.
- **D-04:** The demo should reuse the loopback demo's proven wiring shape: viewer subscribes first, capture starts second, and control messages can request a fresh snapshot. The networked demo replaces the in-page loopback transport with a WebSocket transport.
- **D-05:** Bind demo services to `127.0.0.1` only. Use stable default ports with "next free port" fallback, and always print the actual URLs.
- **D-06:** Use a generated local room key in the URLs so the source and viewer join the same relay room without adding a full auth system.
- **D-07:** The demo UI should be the usable experience, not a landing page: source tab controls/mutates a small page; viewer tab shows the mirror and a compact connection/health status. It should visibly support the kill-relay checkpoint from the roadmap.

### Relay and WebSocket Transport
- **D-08:** Keep the relay core transport-agnostic. The WebSocket backend is the reference implementation, isolated behind the backend seam.
- **D-09:** Preserve the reference relay's raw fan-out behavior: source/capture clients and viewer clients join a room; frames route to the opposite side without relay-side payload transformation.
- **D-10:** Support fan-out to multiple viewers because it falls out naturally from the reference design, but the Phase 4 demo and exit criteria prove one source and one viewer.
- **D-11:** Enforce the 1 MiB per-message cap before delivery. Oversize diagnostics must include at least room id/key prefix, sender role, classified message type, byte size, cap, and whether the frame looked like a compressed envelope.
- **D-12:** Retain the reference backpressure defense: if a viewer/socket send buffer is over the configured backpressure limit, drop that frame for that client and count/log the drop instead of growing an unbounded queue.
- **D-13:** Relay diagnostics stay in-memory and testable in this phase. A public admin endpoint/dashboard is deferred unless the implementation needs a tiny local-only endpoint for the demo.

### Compression and Ordering
- **D-14:** Default outbound compression should use native `CompressionStream('deflate-raw')` / matching inflate when available, with plain JSON fallback for small or uncompressed messages.
- **D-15:** Decoding must remain backward-compatible with FSB's shipped LZ-string envelope `{ _lz: true, d: string }`. Plain JSON must continue to decode without any codec.
- **D-16:** Do not use WebSocket `permessage-deflate` or any stateful per-connection compression. PhantomStream frames remain independently decodable so relay fan-out and reconnect recovery stay robust.
- **D-17:** Async encoding must not reorder sends. The WebSocket transport should own a per-connection FIFO send queue; `transport.send(type, payload)` remains fire-and-forget for capture/viewer code, and optional `flush()` resolves after the ordered queue drains.
- **D-18:** The codec seam should make the native deflate path testable without losing the existing LZ-compatible decoder. If native compression is unavailable, fallback behavior should be explicit and logged at debug/diagnostic level rather than silent.

### Viewer Lifecycle and Health Events
- **D-19:** Extend the viewer handle with `on()` while preserving existing `detach`, `destroy`, and `registerOverlay` behavior. The existing "exact handle shape" tests should be updated intentionally.
- **D-20:** Use a compact event surface: `viewer.on('state', handler)` for lifecycle state changes and `viewer.on('health', handler)` for stream/transport telemetry. Return an unsubscribe function from `on()`.
- **D-21:** State names are exactly the roadmap names: `connecting`, `live`, `stale`, `disconnected`.
- **D-22:** State transition intent: start at `connecting`; become `live` on the first accepted snapshot/frame; become `stale` when the last frame is retained but freshness is suspect (miss threshold, resync pending, relay close/reconnect); become `disconnected` when the transport is closed beyond the short reconnect/stale window. Killing the relay mid-stream must make these transitions observable in the demo.
- **D-23:** Health telemetry should expose counters and timestamps, not payload contents: last frame/snapshot/mutation times, received/sent counts by type, stale mutation misses, apply failures, resync pending, sanitizer strip counters where already available, and transport drops/errors where available.
- **D-24:** The viewer library should expose events but not impose product chrome. The demo may display badges/status text; host applications own their own UI.

### Packaging and CLI
- **D-25:** Add a package binary named `phantom-stream` with a `demo` subcommand. Keep package publishing decisions for Phase 10; this phase only needs the local/dev command path and package metadata ready enough for `npx`-style execution.
- **D-26:** Add package exports for the relay/WebSocket transport surfaces as needed. Keep capture, renderer, and protocol import paths stable.
- **D-27:** It is acceptable for the Node WebSocket backend/demo command to depend on a proven WebSocket package such as `ws`, isolated to the relay backend/demo. Do not add dependencies to browser-injected capture code.

### Verification
- **D-28:** Automated tests must cover relay routing, cap/oversize diagnostics, backpressure drops, codec fallback/decode behavior, async send ordering, viewer `on()` state/health subscriptions, and CLI/demo server startup.
- **D-29:** Browser verification is required for the demo. Use the FSB/browser-style checkpoint established in Phase 3: launch the demo, open source and viewer tabs, prove live mutation mirroring, then kill/stop the relay and observe `live -> stale -> disconnected`.
- **D-30:** Keep the full `npm test` suite green and add focused tests rather than broad rewrites.

### the agent's Discretion
- Exact port numbers and CLI flag names beyond the default `demo` subcommand.
- Exact local room-key format and URL path/query names.
- Exact relay module split, as long as the core/backend seam is clear and testable.
- Exact event payload field names for health telemetry, provided they are documented and contain no mirrored page contents.
- Whether demo browser auto-open is offered as an optional flag.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase Scope
- `.planning/ROADMAP.md` - Phase 4 goal, success criteria, dependencies, and requirement mapping.
- `.planning/REQUIREMENTS.md` - RELY-01, RELY-02, VIEW-02, and PKG-01.
- `.planning/PROJECT.md` - project constraints: plain JS ESM + JSDoc, FSB compatibility, security posture, performance lessons.
- `.planning/STATE.md` - current Phase 4 concern about async CompressionStream send ordering.

### Architecture and Provenance
- `docs/ARCHITECTURE.md` - transport, relay, compression, watchdogs, and reliability inventory.
- `docs/DESIGN-HISTORY.md` - FSB compression, relay, diagnostic, and performance lessons.
- `docs/SECURITY.md` - embed security contract that the networked demo must continue to dogfood.
- `src/relay/README.md` - intended relay module boundary and reference extraction notes.

### Existing Framework Code
- `src/protocol/constants.js` - relay cap and shared timing constants.
- `src/protocol/messages.js` - STREAM/CONTROL message types, including existing `STREAM.STATE`.
- `src/protocol/envelope.js` - current plain/LZ-compatible envelope API to extend or wrap.
- `src/capture/index.js` - capture transport contract, optional `flush()`, lifecycle handle, sanitization/masking chokepoints.
- `src/renderer/index.js` - current viewer handle, transport contract, state gate, resync path, and dispatch behavior.
- `examples/loopback-transport.js` - FIFO async loopback transport precedent.
- `examples/loopback-mirror.html` - first-light demo wiring and UI behavior to adapt for two tabs.
- `examples/serve.js` - local-only static server pattern and path safety checks.

### Reference Implementation
- `reference/server/ws-handler.js` - WebSocket room fan-out, cap/backpressure diagnostics, `ext:status` behavior.
- `reference/extension/ws-client.js` - FSB WebSocket client, keepalive/reconnect behavior, LZ envelope contract, `ext:stream-state`.
- `reference/dashboard/dashboard.js` - dashboard decompression, preview state transitions, transport diagnostics, stale mutation handling.
- `reference/planning/phases/122.3-ws-payload-compression/122.3-01-PLAN.md` - original LZ envelope behavior and dashboard decompression expectations.
- `reference/planning/phases/211-stream-reliability-diagnostic-logging/211-CONTEXT.md` - diagnostic logging and stale counter intent.
- `reference/planning/phases/276-dashboard-dom-streaming-diagnostic-minimum-patch/276-SUMMARY.md` - relay/debug hardening, ready probe, stream-state tooltip, and backpressure counter provenance.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `createCapture({ transport, ... })` already sends `STREAM.*` messages through a fire-and-forget transport and exposes `start`/`stop`/`pause`/`resume`.
- `createViewer({ container, transport })` already consumes `transport.onMessage`, sends `CONTROL.START` for resync, and can be extended with `on()` events.
- `createLoopbackTransport()` demonstrates ordered async fan-out with `queueMicrotask`; the WebSocket transport should preserve that ordering property across async codec work.
- `src/protocol` already centralizes message types, identity checks, and the 1 MiB relay cap.
- `examples/serve.js` provides a hardened 127.0.0.1 static server pattern for demo serving.
- `reference/server/ws-handler.js` is the authoritative relay behavior for room routing, diagnostics, and backpressure drops.

### Established Patterns
- New framework code uses plain JS ESM, named exports, explicit `.js` imports, and JSDoc typedefs.
- Browser-injected code must remain dependency-free and build-free.
- Public APIs contain runtime failures after factory creation; send/transport errors go to logs/events rather than throwing into capture/render paths.
- Security protections are always-on and dogfooded by demos.
- Tests use `node:test` with focused assertions and fake transports/sockets where possible.

### Integration Points
- `package.json` needs a `bin` entry and likely new exports for relay/transport modules.
- `src/relay/` is currently only a README and is the natural location for relay core, limits, diagnostics, and WebSocket backend.
- `src/renderer/index.js` currently ignores `STREAM.STATE`; Phase 4 can consume transport/relay state there and emit host-facing state/health events.
- `tests/renderer-viewer.test.js` currently pins the exact viewer handle shape, so adding `on()` requires intentional test updates.
- The demo should live beside `examples/loopback-*` and can reuse the local static server pattern without weakening path safety.

</code_context>

<specifics>
## Specific Ideas

- Make the two-tab demo feel like the loopback demo graduated to the network: a source page mutates live, a viewer page mirrors it, and the relay can be killed to prove state transitions.
- Keep the relay visually boring and mechanically strong. The interesting user-visible proof is live mirroring plus clear health state, not relay UI.
- Preserve the Phase 3 browser verification practice: use FSB/browser automation as the real-browser source of truth for demo behavior that jsdom cannot prove.

</specifics>

<deferred>
## Deferred Ideas

- Remote control through the mirror belongs to Phase 5.
- Playwright/CDP agent demo belongs to Phase 5.
- Extension/bookmarklet adapters belong to Phase 6.
- Node identity public API belongs to Phase 7.
- Npm publishing, quickstart polish, and final package invocation details belong to Phase 10.
- FSB swap-in verification belongs to Phase 11.
- Relay admin dashboards/endpoints and multi-viewer scale-out documentation are future polish unless a minimal local diagnostic endpoint is needed for this phase's tests.

</deferred>

---

*Phase: 04-relay-ws-transport-two-tab-demo*
*Context gathered: 2026-06-14T23:10:43-05:00*
