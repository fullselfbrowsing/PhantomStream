# Phase 6: Extension MV3 + Bookmarklet Adapters - Context

**Gathered:** 2026-06-15
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 6 delivers the remaining injection contexts for PhantomStream: a Chromium MV3 extension adapter that can mirror a real loaded page through the existing relay/viewer stack, plus a bookmarklet loader stub that injects capture into the current page and connects to a viewer. The phase must prove MV3 service-worker recovery through `chrome.alarms` plus `chrome.storage.session`, and it must keep the phase focused on live mirroring rather than broad extension-product UX.

</domain>

<decisions>
## Implementation Decisions

### Discussion Mode
- **D-01 [informational]:** The interactive question UI was unavailable in this Conductor mode, so the workflow fallback selected all gray areas and captured conservative defaults.
- **D-02 [informational]:** These decisions are intended as planning defaults. If research finds a concrete blocker, the planner must call out the deviation explicitly rather than silently changing the scope.

### MV3 Adapter Surface
- **D-03:** Add first-class adapter surfaces for MV3 and bookmarklet rather than treating either as one-off demo code. Expected package exports are `./adapters/extension` and `./adapters/bookmarklet`, unless research finds a stronger local naming pattern.
- **D-04:** The MV3 adapter should provide reusable service-worker and content-script primitives plus a minimal real extension fixture/demo. It should not become a polished store-ready extension with options pages, onboarding, auth, or distribution UX in this phase.
- **D-05:** The extension path is Chromium MV3 only. Firefox, MV2, mobile browsers, and cross-browser extension compatibility remain out of scope.
- **D-06:** Use a checked-in classic-script injection artifact or equivalent no-build browser script for the content-script/bookmarklet path, following the Phase 5 `src/adapters/playwright-inject.js` precedent. Do not introduce a bundler or runtime build step for browser-injected library code.
- **D-07:** The content script should run the existing `createCapture` lifecycle behind a transport bridge and preserve the capture contract: fire-and-forget `send(type, payload)`, optional `flush()`, lifecycle methods `start`, `stop`, `pause`, and `resume`, and host-side handling for `STREAM.READY`.
- **D-08:** MV3 remote control is not a required Phase 6 exit criterion. The adapter may route existing control frames if it falls out naturally, but planning must not expand the phase into a full extension remote-control implementation. Live mirror plus watchdog recovery is the bar.

### Service-Worker State And Recovery
- **D-09:** `chrome.storage.session` is the source of truth for durable MV3 stream state: room/ws URL, active tab id, streaming active flag, current lifecycle intent, and pending resnapshot intent. Service-worker module globals may be caches only and must be rebuildable after eviction.
- **D-10:** On service-worker startup, alarm wake, reconnect, or content-script ready signal, the adapter should restore from `chrome.storage.session`, reconnect the WebSocket transport when needed, and request or trigger a fresh snapshot if a stream was active.
- **D-11:** The watchdog should use a PhantomStream-named constant by default, with configurability if the FSB swap-in needs a host-specific alarm name. The reference `fsb-domstream-watchdog` name is lineage, not a public API requirement.
- **D-12:** The MV3 adapter should use the existing endpoint-owned `createWebSocketTransport` behavior where practical: raw relay frames, endpoint compression/decode, ordered async sends, `onMessage`, `onStatus`, and content-free health telemetry.
- **D-13:** Forced service-worker eviction should be tested by discarding adapter module state and re-instantiating from a fake or harnessed `chrome.storage.session` plus alarm event. Browser verification should also load a real extension and prove the live mirror path, but the automated recovery test can simulate the eviction boundary deterministically.
- **D-14:** Recovery should prefer a fresh snapshot over trying to replay missed diffs after a service-worker restart. This matches prior resync decisions and avoids inventing persistence for mirrored page contents.

### Bookmarklet Loader
- **D-15:** The bookmarklet is a convenience adapter and live-mirror proof, not a robust browser-extension replacement. It should be documented as subject to page CSP and browser bookmarklet limitations.
- **D-16:** Provide a generated bookmarklet string or loader helper that carries the relay/viewer connection config for an ephemeral local room. The two-tab demo's room-key pattern is the precedent.
- **D-17:** The bookmarklet should inject the same capture-capable browser artifact used by the adapter path where possible, then connect through the existing WebSocket transport as a source endpoint.
- **D-18:** If a page blocks external script injection, fail visibly with a small diagnostic path instead of attempting CSP bypasses, browser exploits, or alternate privileged behavior. CSP bypass is out of scope.
- **D-19:** Bookmarklet verification must execute the actual bookmarklet/loader behavior in a browser page and show the connected viewer receiving a live snapshot and at least one mutation.

### Demo And Verification Shape
- **D-20:** Do not overload the existing `demo` or `playwright-demo` commands. Add explicit local-only demo commands or routes for Phase 6, likely `extension-demo` and `bookmarklet-demo`, consistent with the Phase 5 decision to keep Playwright separate.
- **D-21:** All Phase 6 demos remain deterministic and local-only: bind to `127.0.0.1`, generate an ephemeral room key, use no-store assets, avoid public websites, and print the exact source/viewer/extension URLs or load instructions.
- **D-22:** The MV3 demo should prove a real loaded extension path: content-script injection, service-worker relay client, viewer mirror, watchdog alarm wiring, and recovery after a simulated or forced service-worker restart.
- **D-23:** The bookmarklet demo should prove a copyable or executable bookmarklet loader, not just a direct module import. A page button may help dogfood the same generated source, but it cannot replace testing the bookmarklet artifact itself.
- **D-24:** Automated tests should cover package exports, adapter factory validation, content-script bridge behavior, service-worker storage/recovery, alarm handling, WebSocket transport integration, bookmarklet generation, and CLI/demo wiring. Browser verification remains required for real loaded extension and real bookmarklet behavior.

### the agent's Discretion
- Exact file layout under `src/adapters/`, `examples/`, and `tests/`.
- Exact public function names, provided the package exports are clear and documented.
- Exact alarm name, storage key names, and diagnostic event payload fields, provided they are content-free and configurable where host compatibility matters.
- Whether `extension-demo` and `bookmarklet-demo` are separate CLI commands or one adapter-demo command with explicit submodes, as long as user-facing output stays deterministic.
- Whether the extension fixture uses a generated manifest directory, a checked-in fixture directory, or a test-time temp directory.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase Scope
- `.planning/ROADMAP.md` - Phase 6 goal, dependencies, and success criteria.
- `.planning/REQUIREMENTS.md` - ADPT-01 and ADPT-03 requirement definitions.
- `.planning/PROJECT.md` - project constraints: plain JS ESM, no runtime build step, Chromium-first scope, FSB compatibility, and security/performance posture.
- `.planning/STATE.md` - current project state and session tracking.

### Prior Phase Decisions
- `.planning/phases/04-relay-ws-transport-two-tab-demo/04-CONTEXT.md` - local-only demo, raw relay, room key, endpoint-owned compression, viewer health/state decisions.
- `.planning/phases/05-playwright-cdp-adapter-remote-control-agent-demo/05-CONTEXT.md` - first-class adapter precedent, single-file inject artifact, host-owned authorization boundary, deterministic demo shape.

### Architecture And Docs
- `docs/ARCHITECTURE.md` - MV3 service-worker constraints, watchdog design, relay/viewer architecture, and known injection contexts.
- `docs/DESIGN-HISTORY.md` - watchdog, performance, and extraction lessons that should survive the adapter work.
- `docs/SECURITY.md` - sanitization, masking, sandbox, and host security contract.
- `src/capture/README.md` - capture lifecycle, transport contract, host-side reintroduction of readiness/overlay paths, and no-build injection context constraints.
- `src/relay/README.md` - relay boundary and raw fan-out assumptions.

### Current Framework Code
- `package.json` - existing package exports and CLI command pattern.
- `bin/phantom-stream.js` - CLI command parsing and demo command precedents.
- `src/capture/index.js` - capture factory, lifecycle, sanitization/masking, and wire message emission.
- `src/protocol/messages.js` - `CONTROL`, `STREAM`, `REMOTE_CONTROL`, `STREAM.REQUEST_SNAPSHOT`, and `STREAM.STATE` message constants.
- `src/transport/websocket.js` - endpoint WebSocket transport, ordered send/receive queues, status/health events, and legacy decode support.
- `src/relay/index.js` - relay API surface used by local demos.
- `src/adapters/playwright.js` - first-class adapter shape and transport/control event wiring precedent.
- `src/adapters/playwright-inject.js` - checked-in classic-script inject artifact precedent.
- `examples/two-tab-demo/server.js` - local-only relay/demo server and room URL generation.
- `examples/playwright-demo/server.js` - explicit adapter demo command precedent and deterministic fixture routing.

### Reference Implementation
- `reference/extension/dom-stream.js` - content-script capture lineage, readiness, watchdog trip wire, and mutation flush behavior.
- `reference/extension/ws-client.js` - MV3 service-worker relay client, WebSocket reconnect, content-script injection, and reference remote-control routing.
- `reference/extension/background.dom-stream-relay.excerpt.js` - content-script to WebSocket relay forwarding and alarm arming.
- `reference/extension/background.watchdog-alarm.excerpt.js` - MV3 `chrome.alarms` watchdog lineage.
- `reference/server/ws-handler.js` - reference relay room fan-out and extension/dashboard role model.
- `reference/planning/phases/211-stream-reliability-diagnostic-logging/211-02-PLAN.md` - original two-tier watchdog and alarm persistence design.
- `reference/planning/phases/211-stream-reliability-diagnostic-logging/211-VERIFICATION.md` - watchdog and service-worker verification evidence.
- `reference/planning/phases/276-dashboard-dom-streaming-diagnostic-minimum-patch/276-SUMMARY.md` - pending-intent re-arm, watchdog resnapshot, and backpressure diagnostics provenance.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `createCapture` in `src/capture/index.js`: page-side capture runtime for extension content scripts and bookmarklets.
- `createWebSocketTransport` in `src/transport/websocket.js`: source/viewer endpoint transport with ordered sends, health snapshots, native deflate envelope, and legacy FSB decode.
- `createRelay` / `createWebSocketRelayBackend` in `src/relay/index.js`: already power local demos and should be reused for Phase 6 demo servers.
- `src/adapters/playwright.js`: adapter factory shape, event subscriptions, install/dispose handle pattern, and single injected page bridge.
- `src/adapters/playwright-inject.js`: no-build browser artifact precedent for contexts that cannot import ESM directly.
- `examples/two-tab-demo` and `examples/playwright-demo`: local-only, no-store, ephemeral-room demo patterns to copy rather than inventing a new server style.

### Established Patterns
- Public APIs use PhantomStream naming even when reference `ext:`/`dash:` wire names are preserved for compatibility.
- Relay stays raw and transport-agnostic. Adapter logic belongs at endpoints.
- Demos are usable operational tools, not landing pages, and they bind only to `127.0.0.1`.
- Transport and health telemetry must be content-free: counters, timestamps, states, and errors only.
- Browser-injected code must remain build-free and dependency-light; Node-only dependencies stay isolated to relay/demo/server code.
- Recovery favors fresh snapshot/resync over durable diff replay.

### Integration Points
- `package.json` exports need adapter subpaths for extension and bookmarklet surfaces.
- `bin/phantom-stream.js` needs explicit demo command wiring for Phase 6 local verification.
- MV3 adapter connects service-worker WebSocket transport to content-script capture via `chrome.runtime` messaging and `chrome.storage.session`.
- Bookmarklet adapter connects a generated loader to the same source WebSocket URL pattern used by the local demos.
- Viewer resync already uses `CONTROL.START`; the MV3 service worker should translate viewer/control requests into content-script lifecycle calls without adding new relay behavior.

</code_context>

<specifics>
## Specific Ideas

- The extension adapter should feel like the missing FSB swap-in surface: real MV3 mechanics, but packaged as reusable library primitives plus a minimal fixture rather than an app-like extension product.
- The bookmarklet should be honest about browser limits. A visible diagnostic on blocked injection is preferable to pretending it works everywhere.
- Forced service-worker eviction is the key proof. The planner should make this testable early rather than leaving it as a final manual checkpoint.

</specifics>

<deferred>
## Deferred Ideas

- Full extension remote-control parity through Chrome debugger APIs - future adapter or FSB swap-in work unless it is essentially free while routing existing frames.
- Browser store distribution UX, options pages, QR pairing UI, persistent account auth, and polished extension onboarding - outside Phase 6.
- Firefox/MV2/mobile extension support - out of v1 per project constraints.
- Bookmarklet CSP bypass strategies - explicitly out of scope.
- Full adapter quickstart documentation and npm publishing polish - Phase 10 / PKG-04.

</deferred>

---

*Phase: 06-extension-mv3-bookmarklet-adapters*
*Context gathered: 2026-06-15*
