# Phase 05 Context: Playwright/CDP Adapter, Remote Control & Agent Demo

<domain>
Phase 05 delivers the agent-observability demo path: a script-driven browser is mirrored live, and a user can control the real driven page through the mirror after an explicit host authorization gate approves control.

This phase is scoped to:
- Playwright/CDP adapter support for capture injection and message bridging.
- A single-file inject artifact usable by the adapter.
- A local Playwright-driven demo where a script drives a real page while the viewer mirrors it.
- Consent-gated remote control for click, type, and scroll through the mirror.
- Navigation survival with re-snapshot after page changes.

This phase does not deliver:
- Extension MV3, bookmarklet, or full adapter matrix work. That starts in Phase 06.
- Public semantic node identity APIs or WeakMap identity rework. That starts in Phase 07.
- Shadow DOM, CSSOM tracking, publication hardening, FSB swap-in, or evaluation corpus work.
</domain>

<decisions>
## Discussion Mode

- The user said "proceed" after Phase 04 completion and project config has `workflow.auto_advance=true`, so Phase 05 context uses conservative auto-selected defaults.
- All auto selections are written here and in `05-DISCUSSION-LOG.md` so downstream planning can review them without re-asking the user.

## Adapter Runtime

- Add a first-class Playwright/CDP adapter surface rather than treating the demo as one-off example code.
- The adapter must support Playwright `page.addInitScript` and CDP `Page.addScriptToEvaluateOnNewDocument` injection from the same single-file inject artifact.
- The adapter owns the binding bridge between the driven page capture runtime and PhantomStream transport.
- The relay remains raw and transport-agnostic. Driver logic stays in the Playwright/CDP adapter or demo process, not in the relay.

## Demo Shape

- Add a deterministic local Playwright-driven demo command instead of overloading the Phase 04 two-tab source/viewer demo behavior.
- The demo should use local pages and fixtures, not public websites, to keep verification deterministic and offline-friendly.
- The demo must visibly prove both directions:
  - Driver to viewer: a Playwright script changes the real page and the viewer mirrors it live.
  - Viewer to driver: click, type, and scroll from the mirror are replayed into the real page through driver-native input.

## Remote Control Authorization

- Remote control is default-deny.
- Activation requires a host-provided consent/authorization hook to approve.
- Denial must be observable as a state event and in the demo UI, while controls remain inert and no driver input is dispatched.
- Authorization events and telemetry must not include mirrored page HTML, text, attributes, or user-entered content.

## Remote Control Protocol

- Define explicit PhantomStream remote-control protocol messages instead of reusing reference `dash:*` names directly.
- The reference `dash:remote-click`, `dash:remote-key`, `dash:remote-scroll`, and `dash:remote-control-start/stop` routes are lineage references only.
- Viewer/control frames should traverse the existing Phase 04 relay as opposite-side frames; the relay should not inspect or execute remote-control actions.
- Control state should be observable through viewer and adapter events.

## Coordinate And Action Model

- Implement only click, type/text, and scroll for this phase.
- Gesture capture happens through a host-owned transparent overlay above the sandboxed viewer iframe.
- Coordinates are reverse-mapped from viewer/stage coordinates into the captured page viewport using the current viewer scale, offset, and viewport dimensions.
- Replayed actions must use driver-native input, such as Playwright mouse/keyboard/wheel or CDP `Input.dispatch*` calls where needed.
- Do not use synthetic DOM events inside the captured page for remote control.
- For text input, prefer text insertion for printable text and keyDown/keyUp style replay for non-printable keys where supported.

## Navigation Lifecycle

- Injection must happen before page scripts via `addInitScript` or CDP new-document script registration.
- The adapter must survive page navigation and trigger a fresh snapshot after navigation so the viewer returns to live state.
- Verification must include a real navigation or page reload checkpoint.

## UI Direction

- Keep the demo operational and compact, consistent with the Phase 04 local demo.
- The first screen should be the usable Playwright remote-control demo, not a landing page.
- Demo UI may show remote-control state, authorization status, last action, and health counters.
- Visible UI chrome remains demo/host-owned; framework APIs should expose state and events without imposing product UI.

## Verification Gates

- Automated tests should cover adapter injection shape, binding bridge behavior, protocol validation, authorization approve/deny, coordinate reverse mapping, driver-native action dispatch, navigation re-snapshot, package exports, and demo command wiring.
- Browser/FSB verification must run the Playwright demo and exercise mirror click, type, and scroll against the real driven page, including authorization denial.
- Full `npm test`, focused Phase 05 tests, code review, and verification artifacts are required before phase completion.
</decisions>

<canonical_refs>
## Phase Scope

- `.planning/ROADMAP.md`
- `.planning/REQUIREMENTS.md`
- `.planning/PROJECT.md`
- `.planning/STATE.md`

## Phase 04 Foundation

- `.planning/phases/04-relay-ws-transport-two-tab-demo/04-CONTEXT.md`
- `.planning/phases/04-relay-ws-transport-two-tab-demo/04-VERIFICATION.md`
- `.planning/phases/04-relay-ws-transport-two-tab-demo/04-04-SUMMARY.md`

## Architecture And Provenance

- `docs/ARCHITECTURE.md`
- `docs/DESIGN-HISTORY.md`
- `docs/SECURITY.md`
- `docs/paper/OUTLINE.md`
- `reference/planning/MILESTONE-ROADMAP-v0.9.9.1.md`
- `reference/planning/phases/125-remote-control/125-VERIFICATION.md`

## Reference Source

- `reference/dashboard/dashboard.js`
- `reference/extension/ws-client.js`
- `reference/extension/dom-stream.js`

## Current Framework Code

- `src/capture/index.js`
- `src/renderer/index.js`
- `src/renderer/overlays.js`
- `src/protocol/messages.js`
- `src/transport/websocket.js`
- `src/relay/index.js`
- `src/relay/relay.js`
- `examples/two-tab-demo/server.js`
- `examples/two-tab-demo/viewer.js`
- `bin/phantom-stream.js`
- `package.json`

## Codebase Maps

- `.planning/codebase/INTEGRATIONS.md`
- `.planning/codebase/TESTING.md`
- `.planning/codebase/STRUCTURE.md`
</canonical_refs>

<code_context>
- Phase 04 established a raw, stateless WebSocket relay with endpoint-owned compression and diagnostics. Phase 05 should reuse that path for viewer-to-driver control frames.
- `src/protocol/messages.js` currently defines stream/control primitives and the `data-fsb-nid` constant, but it does not yet define a remote-control protocol family.
- `src/renderer/index.js` exposes viewer lifecycle/events and overlay registration, but it does not yet expose remote-control activation or coordinate-replay APIs.
- `src/renderer/overlays.js` already contains viewport mapping and overlay positioning patterns that should inform remote-control coordinate transforms.
- `src/capture/index.js` provides the current embedded capture runtime; Phase 05 needs a dependency-free inject artifact that can start the runtime from Playwright/CDP injection contexts.
- `src/transport/websocket.js` already handles ordered async compression/decompression and health telemetry. Remote-control frames should not weaken those ordering and privacy boundaries.
- `examples/two-tab-demo` proves local relay/viewer operation. The Playwright demo should be a separate deterministic example path, while sharing relay and viewer primitives where practical.
- Reference `dashboard.js` has the proven remote-control UX pattern: active overlay, remote-control start/stop messages, mousedown, keydown/keyup, and wheel capture. Treat it as behavioral lineage, not code to copy wholesale.
- Reference extension code should be read during planning for CDP input dispatch lineage, but Phase 05 should keep extension packaging out of scope.
</code_context>

<specifics>
- Remote control success is user-visible: after approval, click/type/scroll in the mirror must change the real driven page and the mirror must update.
- Denied control must be just as visible: a denial state event is emitted, the demo reflects that state, and real page input is not dispatched.
- The demo should remain local-only and deterministic like Phase 04: bind to `127.0.0.1`, avoid public network pages, and keep assets no-store if served through a local dev/demo server.
- Tests should follow the current `node:test` style with focused fixtures/fakes rather than introducing a heavyweight test framework.
- Documentation can mention FSB/reference route names as provenance, but public APIs should use PhantomStream naming.
</specifics>

<deferred>
- Extension MV3 adapter, service-worker relay client, Chrome alarms watchdog, and bookmarklet loader are deferred to Phase 06.
- Public semantic node identity APIs, semantic element addressing, and WeakMap mirror identity rework are deferred to Phase 07.
- Shadow DOM fidelity, CSSOM mutation tracking, package publication, FSB replacement, and evaluation corpus work remain in their roadmap phases.
- Drag/drop, selection, file upload, clipboard, IME edge cases, browser navigation controls, and multi-pointer remote control are out of Phase 05 scope unless required by an existing success criterion.
</deferred>
