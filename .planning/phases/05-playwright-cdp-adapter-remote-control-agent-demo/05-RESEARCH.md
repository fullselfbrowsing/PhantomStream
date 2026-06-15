# Phase 05: Playwright/CDP Adapter, Remote Control & Agent Demo - Research

**Researched:** 2026-06-15 [VERIFIED: environment current_date]
**Domain:** Playwright/CDP browser adapter, single-file page injection, WebSocket remote control, consent-gated replay [VERIFIED: 05-CONTEXT.md]
**Confidence:** HIGH for API facts and codebase boundaries, MEDIUM for browser verification readiness because Playwright is not installed locally yet [CITED: https://playwright.dev/docs/api/class-page] [VERIFIED: command -v playwright]

<user_constraints>
## User Constraints (from CONTEXT.md)

Source: all bullets in this section are copied verbatim from `.planning/phases/05-playwright-cdp-adapter-remote-control-agent-demo/05-CONTEXT.md`. [VERIFIED: 05-CONTEXT.md]

### Locked Decisions
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

### Claude's Discretion

No `## Claude's Discretion` section is present in `05-CONTEXT.md`; planner discretion is limited to implementation details that do not contradict the locked decisions above. [VERIFIED: 05-CONTEXT.md]

### Deferred Ideas (OUT OF SCOPE)
- Extension MV3 adapter, service-worker relay client, Chrome alarms watchdog, and bookmarklet loader are deferred to Phase 06.
- Public semantic node identity APIs, semantic element addressing, and WeakMap mirror identity rework are deferred to Phase 07.
- Shadow DOM fidelity, CSSOM mutation tracking, package publication, FSB swap-in, and evaluation corpus work remain in their roadmap phases.
- Drag/drop, selection, file upload, clipboard, IME edge cases, browser navigation controls, and multi-pointer remote control are out of Phase 05 scope unless required by an existing success criterion.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| ADPT-02 | Playwright/CDP adapter using `addInitScript`/`Page.addScriptToEvaluateOnNewDocument` plus binding bridge and single-file inject artifact. [VERIFIED: REQUIREMENTS.md] | Use `src/adapters/playwright.js` plus a classic-script `src/adapters/playwright-inject.js`; install `page.exposeBinding` before `page.addInitScript`; support CDP `Page.addScriptToEvaluateOnNewDocument` through `CDPSession.send`. [CITED: https://playwright.dev/docs/api/class-page] [CITED: https://playwright.dev/docs/api/class-cdpsession] [CITED: https://chromedevtools.github.io/devtools-protocol/tot/Page/#method-addScriptToEvaluateOnNewDocument] |
| PKG-02 | Playwright-driven demo where a script drives a real page while the viewer mirrors it with working remote control. [VERIFIED: REQUIREMENTS.md] | Add a separate local-only `phantom-stream demo:playwright` or `phantom-stream playwright-demo` path that reuses the Phase 04 relay server shape, prints viewer/driven URLs, and drives deterministic fixture actions. [VERIFIED: examples/two-tab-demo/server.js] [VERIFIED: 05-UI-SPEC.md] |
| VIEW-05 | Remote control through the mirror: click/type/scroll reverse-mapped and replayed in the real tab. [VERIFIED: REQUIREMENTS.md] | Export inverse viewport mapping from renderer helpers and route approved action frames to Playwright `mouse`, `keyboard`, and `wheel`, with raw CDP fallback. [VERIFIED: src/renderer/index.js] [CITED: https://playwright.dev/docs/api/class-mouse] [CITED: https://playwright.dev/docs/api/class-keyboard] |
| SEC-04 | Remote control activation gated by host-provided consent/authorization hook. [VERIFIED: REQUIREMENTS.md] | Adapter must default-deny, call `authorizeControl`, emit content-free control state, and enforce active state again before every replay action. [VERIFIED: 05-CONTEXT.md] [VERIFIED: docs/SECURITY.md] |
</phase_requirements>

## Summary

Phase 05 should add a Node-side Playwright/CDP adapter as a reusable host adapter, not just example code. [VERIFIED: 05-CONTEXT.md] The adapter should accept a Playwright-like `page`, a PhantomStream transport, an optional CDP session factory, and a default-deny `authorizeControl` hook; it should expose lifecycle/state events without rendering UI. [VERIFIED: src/transport/websocket.js] [VERIFIED: src/renderer/index.js]

The single-file inject artifact should be a checked source artifact that is evaluated as a classic script by Playwright and CDP, because `page.addInitScript` and CDP new-document injection evaluate script content in the page rather than importing ESM modules. [CITED: https://playwright.dev/docs/api/class-page] [CITED: https://chromedevtools.github.io/devtools-protocol/tot/Page/#method-addScriptToEvaluateOnNewDocument] The injected runtime should guard to the top frame, create `createCapture({ transport })`, and bridge capture messages to the adapter through `page.exposeBinding`, while the adapter forwards payloads to the existing endpoint WebSocket transport without logging mirrored content. [CITED: https://playwright.dev/docs/api/class-page] [VERIFIED: src/capture/index.js] [VERIFIED: src/transport/websocket.js]

**Primary recommendation:** implement `src/adapters/playwright.js`, `src/adapters/playwright-inject.js`, `src/protocol/remote-control.js`, renderer inverse-coordinate helpers, and a separate local Playwright demo that reuses the Phase 04 relay boundaries. [VERIFIED: 05-CONTEXT.md] [VERIFIED: examples/two-tab-demo/server.js]

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|--------------|----------------|-----------|
| Capture injection and binding bridge | API / Backend adapter process | Browser / Client injected runtime | The Node adapter installs bindings and scripts, while the injected runtime only serializes DOM and calls the binding. [CITED: https://playwright.dev/docs/api/class-page] [VERIFIED: src/capture/index.js] |
| Live DOM mirroring | Browser / Client injected runtime | API / Backend adapter transport | Capture creates snapshot/diff/scroll frames in the page; the adapter only forwards them to transport. [VERIFIED: src/capture/index.js] [VERIFIED: src/transport/websocket.js] |
| Relay routing | API / Backend relay | — | Relay forwards raw frames between `source` and `viewer` roles and should not inspect control payloads. [VERIFIED: src/relay/relay.js] |
| Viewer rendering and coordinate mapping | Browser / Client viewer | API / Backend adapter for replay | Viewer owns scaled iframe rendering and inverse mapping; adapter owns replay into the driven page. [VERIFIED: src/renderer/index.js] [VERIFIED: src/renderer/overlays.js] |
| Consent-gated remote control | API / Backend adapter process | Browser / Client demo UI | The adapter must enforce authorization before active state and before dispatch; the demo UI only requests and displays state. [VERIFIED: 05-CONTEXT.md] [VERIFIED: 05-UI-SPEC.md] |
| Driver-native input replay | API / Backend adapter process | CDP / Browser automation boundary | Playwright and CDP input APIs are external browser automation APIs, not DOM code in the captured page. [CITED: https://playwright.dev/docs/api/class-mouse] [CITED: https://chromedevtools.github.io/devtools-protocol/tot/Input/] |
| Demo UI chrome | Browser / Client demo page | API / Backend demo server | UI-SPEC locks visible state, logs, and controls as demo-owned, while library APIs expose events only. [VERIFIED: 05-UI-SPEC.md] |

## Project Constraints (from CLAUDE.md)

- Use plain JavaScript ESM with JSDoc types in `src/`; package exports use named ESM exports and explicit `.js` import extensions. [VERIFIED: CLAUDE.md] [VERIFIED: package.json]
- Capture must inject as a plain script into arbitrary contexts such as content scripts, `addInitScript`, and bookmarklets; no runtime build step for the library itself. [VERIFIED: CLAUDE.md]
- Preserve FSB-compatible wire conventions where practical, including direction prefixes and session stamping. [VERIFIED: CLAUDE.md] [VERIFIED: src/protocol/messages.js]
- Do not weaken the security contract: capture/render sanitization and a sandboxed iframe without `allow-scripts` are non-negotiable. [VERIFIED: CLAUDE.md] [VERIFIED: docs/SECURITY.md]
- Do not regress performance lessons: snapshot interactivity, single-pass layout reads, and paint-cadence diff delivery must remain intact. [VERIFIED: CLAUDE.md] [VERIFIED: docs/DESIGN-HISTORY.md]
- Tests use Node's built-in test runner and current scripts run `node --test tests/*.test.js tests/differential/*.test.js`. [VERIFIED: package.json] [VERIFIED: npm test]
- No `AGENTS.md`, `.claude/skills/`, or `.agents/skills/` project skill index exists in this workspace. [VERIFIED: test -f AGENTS.md; find .claude/skills .agents/skills]

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Playwright | 1.60.0, published 2026-05-11 [VERIFIED: npm registry] | Demo browser driver and primary replay API. [CITED: https://playwright.dev/docs/api/class-mouse] | It provides `page.addInitScript`, `page.exposeBinding`, `page.mouse`, `page.keyboard`, and CDP sessions through one maintained automation API. [CITED: https://playwright.dev/docs/api/class-page] [CITED: https://playwright.dev/docs/api/class-cdpsession] |
| Chrome DevTools Protocol | tip-of-tree docs checked 2026-06-15 [CITED: https://chromedevtools.github.io/devtools-protocol/tot/Input/] | CDP fallback for new-document injection and raw input dispatch. [CITED: https://chromedevtools.github.io/devtools-protocol/tot/Page/#method-addScriptToEvaluateOnNewDocument] | It is the browser-native fallback for `Page.addScriptToEvaluateOnNewDocument`, `Input.dispatchMouseEvent`, `Input.dispatchKeyEvent`, and `Input.insertText`. [CITED: https://chromedevtools.github.io/devtools-protocol/tot/Input/] |
| PhantomStream WebSocket transport | local package source, `ws@8.21.0` dependency already installed. [VERIFIED: package.json] [VERIFIED: npm registry] | Endpoint transport for viewer-to-adapter and adapter-to-viewer frames. [VERIFIED: src/transport/websocket.js] | It already preserves async ordering and content-free health telemetry. [VERIFIED: src/transport/websocket.js] |
| PhantomStream relay | local package source. [VERIFIED: src/relay/relay.js] | Raw room fan-out between `source` and `viewer`. [VERIFIED: src/relay/relay.js] | It already routes viewer frames to source frames byte-identically without payload execution. [VERIFIED: src/relay/relay.js] |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Node.js built-in `node:test` | Node v24.14.1 local runtime. [VERIFIED: node --version] | Unit and integration tests. [VERIFIED: package.json] | Use for all Phase 05 automated tests; do not add a heavyweight test framework. [VERIFIED: 05-CONTEXT.md] |
| jsdom | 29.1.1, published 2026-04-30. [VERIFIED: npm registry] | DOM/unit fixtures for protocol, renderer, and inject artifact tests. [VERIFIED: package.json] | Use for fast fake-page tests where real browser behavior is not required. [VERIFIED: tests/*.test.js] |
| `ws` | 8.21.0, published 2026-05-22. [VERIFIED: npm registry] | WebSocket backend for local relay. [VERIFIED: package.json] | Keep using existing relay/demo server path; do not introduce a second transport stack. [VERIFIED: examples/two-tab-demo/server.js] |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `playwright` devDependency | `playwright-core` plus system Chrome | `playwright-core` avoids browser downloads but requires explicit browser provisioning; Phase 05 needs a deterministic demo, so use `playwright@1.60.0` as a dev dependency and optionally allow `channel` or `executablePath` override. [VERIFIED: npm registry] [VERIFIED: /Applications/Google Chrome.app] |
| Playwright input APIs | raw CDP-only replay | CDP-only is useful as fallback, but Playwright APIs are simpler and match the demo's driver-first goal. [CITED: https://playwright.dev/docs/api/class-mouse] [CITED: https://playwright.dev/docs/api/class-keyboard] |
| Reusing reference `dash:remote-*` names | New `REMOTE_CONTROL` protocol family | Context locks reference names as lineage only, so new PhantomStream names must be explicit while preserving direction prefixes. [VERIFIED: 05-CONTEXT.md] [VERIFIED: CLAUDE.md] |

**Installation:**
```bash
npm install --save-dev playwright@1.60.0
npx playwright install chromium
```
The install command is for demo/test execution, not for a runtime dependency in the adapter module. [VERIFIED: package.json] [VERIFIED: npm registry]

**Version verification:** `npm view playwright time --json`, `npm view ws time --json`, and `npm view jsdom time --json` were checked on 2026-06-15. [VERIFIED: npm registry]

## Architecture Patterns

### System Architecture Diagram

```text
Driven page navigation/load
        |
        v
Playwright/CDP adapter installs binding + new-document inject source
        |
        v
Injected capture runtime waits for body, starts capture, emits snapshot/diffs/scroll
        |
        v
window.__phantomStreamBridge({ type, payload })
        |
        v
Adapter binding callback validates frame/source, forwards via source WebSocket transport
        |
        v
Raw relay room fan-out, no payload inspection
        |
        v
Viewer transport -> createViewer -> sandboxed iframe mirror + host-owned control overlay
        |
        v
Control request/action frames -> raw relay -> adapter
        |
        v
Adapter authorization gate -> if approved, Playwright/CDP native replay; if denied, emit state only
```
This diagram follows existing relay directionality and keeps driver logic out of the relay. [VERIFIED: src/relay/relay.js] [VERIFIED: 05-CONTEXT.md]

### Recommended Project Structure

```text
src/
├── adapters/
│   ├── playwright.js              # Node-side adapter factory, lifecycle, consent, replay
│   └── playwright-inject.js       # classic-script single-file inject artifact, no imports
├── protocol/
│   ├── messages.js                # add REMOTE_CONTROL constants and state names
│   └── remote-control.js          # pure validators/redactors for control payloads
└── renderer/
    ├── index.js                   # expose getViewportMapping() on viewer handle
    └── overlays.js                # add/export inverse point mapping helper

examples/
└── playwright-demo/
    ├── server.js                  # local relay + fixture/viewer static server
    ├── viewer.html
    ├── viewer.js
    ├── fixture.html
    ├── fixture.js
    └── demo.css
```
The structure preserves existing `src/` ESM conventions and keeps demo UI in `examples/`, not in framework code. [VERIFIED: CLAUDE.md] [VERIFIED: examples/two-tab-demo/*]

### Pattern 1: Adapter Install Order

**What:** install the binding first, register the init script second, then start capture only after the main document has a body. [CITED: https://playwright.dev/docs/api/class-page]  
**When to use:** every Playwright adapter setup and every CDP fallback setup. [VERIFIED: 05-CONTEXT.md]  
**Example:**
```js
// Source: Playwright Page API and current capture Transport seam.
await page.exposeBinding(bindingName, async ({ page: callerPage, frame }, msg) => {
  if (callerPage !== page || frame !== page.mainFrame()) return { ok: false, error: 'frame-ignored' };
  return bridgeCaptureMessage(msg);
});
await page.addInitScript({ content: injectSource });
await startCaptureWhenBodyExists(page);
```
`page.exposeBinding` adds a function to every frame and the installed function survives navigations. [CITED: https://playwright.dev/docs/api/class-page] `page.addInitScript` runs on navigation and frame attach before page scripts, but body-dependent capture start still needs an explicit body readiness guard. [CITED: https://playwright.dev/docs/api/class-page] [VERIFIED: src/capture/index.js]

### Pattern 2: Inject Artifact Guard

**What:** the injected classic script should no-op in child frames, dedupe itself per document, and expose a tiny start/stop bridge object on `window`. [CITED: https://playwright.dev/docs/api/class-page]  
**When to use:** because Playwright and CDP new-document scripts are evaluated in frames, while Phase 05 only mirrors the main document. [CITED: https://playwright.dev/docs/api/class-page] [CITED: https://chromedevtools.github.io/devtools-protocol/tot/Page/#method-addScriptToEvaluateOnNewDocument]  
**Example:**
```js
// Source: recommended classic-script shape for src/adapters/playwright-inject.js.
(function () {
  if (window.top !== window || window.__phantomStreamInjected) return;
  window.__phantomStreamInjected = true;
  window.__phantomStreamStart = function () {
    if (!document.body || !window.__phantomStreamBridge) return false;
    if (!window.__phantomStreamCapture) {
      window.__phantomStreamCapture = createCapture({
        transport: {
          send: function (type, payload) {
            return window.__phantomStreamBridge({ type: type, payload: payload });
          }
        }
      });
    }
    window.__phantomStreamCapture.start();
    return true;
  };
})();
```
The actual artifact must include the capture implementation and protocol constants inline, with no `import` statements. [VERIFIED: src/capture/index.js] [VERIFIED: CLAUDE.md]

### Pattern 3: Remote-Control Protocol Family

**What:** add explicit `REMOTE_CONTROL` constants and validators rather than reusing FSB reference names. [VERIFIED: 05-CONTEXT.md]  
**When to use:** every viewer-to-adapter control request/action and every adapter-to-viewer control state frame. [VERIFIED: src/relay/relay.js]  
**Example:**
```js
// Source: src/protocol/messages.js convention + Phase 05 context.
export const REMOTE_CONTROL = {
  REQUEST: 'dash:ps-control-request',
  STOP: 'dash:ps-control-stop',
  CLICK: 'dash:ps-control-click',
  TEXT: 'dash:ps-control-text',
  KEY: 'dash:ps-control-key',
  SCROLL: 'dash:ps-control-scroll',
  STATE: 'ext:ps-control-state'
};
```
Keep `dash:` and `ext:` as direction prefixes because the project wire conventions use them, but do not reuse `dash:remote-click`, `dash:remote-key`, `dash:remote-scroll`, or `dash:remote-control-start/stop`. [VERIFIED: CLAUDE.md] [VERIFIED: 05-CONTEXT.md] [VERIFIED: reference/dashboard/dashboard.js]

### Pattern 4: Content-Free State and Telemetry

**What:** validators should return a redacted summary for logging and health counters, separate from the replay payload. [VERIFIED: docs/SECURITY.md]  
**When to use:** every authorization, denied action, and dispatched action event. [VERIFIED: 05-CONTEXT.md]  
**Example:**
```js
// Source: Phase 04 content-free health pattern.
function summarizeRemoteAction(type, payload) {
  if (type === REMOTE_CONTROL.TEXT) return { type: type, chars: String(payload.text || '').length };
  if (type === REMOTE_CONTROL.CLICK) return { type: type, x: payload.x, y: payload.y, button: payload.button || 'left' };
  if (type === REMOTE_CONTROL.SCROLL) return { type: type, x: payload.x, y: payload.y, deltaX: payload.deltaX || 0, deltaY: payload.deltaY || 0 };
  if (type === REMOTE_CONTROL.KEY) return { type: type, key: payload.key || '', event: payload.event || '' };
  return { type: type };
}
```
Typed text must be present in the control action payload to replay it, but it must not appear in state events, demo logs, health telemetry, or relay diagnostics. [VERIFIED: 05-CONTEXT.md] [VERIFIED: docs/SECURITY.md]

### Pattern 5: Inverse Viewport Mapping

**What:** add an inverse of `mapRectToHost` using the viewer's current `s`, `offsetX`, `offsetY`, and viewport dimensions. [VERIFIED: src/renderer/overlays.js]  
**When to use:** host-owned control overlay click and wheel events. [VERIFIED: 05-UI-SPEC.md]  
**Example:**
```js
// Source: inverse of existing mapRectToHost parity math.
export function mapHostPointToViewport(point, scale, viewport) {
  var s = scale && scale.s > 0 ? scale.s : 1;
  var x = (point.x - (scale.offsetX || 0)) / s;
  var y = (point.y - (scale.offsetY || 0)) / s;
  var inside = x >= 0 && y >= 0 && x < viewport.width && y < viewport.height;
  return {
    inside: inside,
    x: Math.max(0, Math.min(viewport.width - 1, Math.round(x))),
    y: Math.max(0, Math.min(viewport.height - 1, Math.round(y)))
  };
}
```
Reject dispatch when `inside` is false so clicks in letterboxed stage areas cannot trigger real page edge clicks. [VERIFIED: src/renderer/overlays.js] [VERIFIED: 05-UI-SPEC.md]

### Pattern 6: Playwright-First Replay With CDP Fallback

**What:** prefer Playwright high-level input APIs and fall back to CDP when only a CDP session is available. [CITED: https://playwright.dev/docs/api/class-mouse] [CITED: https://playwright.dev/docs/api/class-keyboard]  
**When to use:** adapter `dispatchRemoteAction`. [VERIFIED: 05-CONTEXT.md]  
**Example:**
```js
// Source: Playwright Mouse/Keyboard docs and CDP Input docs.
async function replayScroll(page, action) {
  await page.mouse.move(action.x, action.y);
  await page.mouse.wheel(action.deltaX || 0, action.deltaY || 0);
}
async function replayText(page, action) {
  await page.keyboard.insertText(action.text || '');
}
async function replayKey(page, action) {
  if (action.event === 'down') await page.keyboard.down(action.key);
  else if (action.event === 'up') await page.keyboard.up(action.key);
}
```
Playwright `mouse.click` and `mouse.move` use main-frame viewport CSS pixels. [CITED: https://playwright.dev/docs/api/class-mouse] Playwright `keyboard.insertText` dispatches input text without keydown/keyup/keypress, while `keyboard.down` and `keyboard.up` model non-printable keys. [CITED: https://playwright.dev/docs/api/class-keyboard]

### Anti-Patterns to Avoid

- **Synthetic DOM events in captured page:** do not call page `dispatchEvent`, `element.click()`, or injected DOM event constructors for replay; use Playwright/CDP native input. [VERIFIED: 05-CONTEXT.md] [CITED: https://playwright.dev/docs/api/class-mouse]
- **Relay-side control logic:** do not add authorization, action execution, or payload logging to `src/relay/relay.js`; relay remains raw fan-out. [VERIFIED: src/relay/relay.js] [VERIFIED: 05-CONTEXT.md]
- **Payload-shaped telemetry:** do not copy control payload objects into health/status events, because text actions can contain user-entered content. [VERIFIED: docs/SECURITY.md] [VERIFIED: 05-CONTEXT.md]
- **Global remote-control active flag in viewer only:** viewer UI state is not an authorization boundary; adapter must re-check active authorization before every dispatch. [VERIFIED: reference/extension/ws-client.js] [VERIFIED: 05-CONTEXT.md]
- **General typed-input mirroring in Phase 05:** CAPT-05 is still deferred, so the Playwright fixture must reflect typed input through a captured DOM mutation such as a visible echo node or `value` attribute reflection. [VERIFIED: REQUIREMENTS.md] [VERIFIED: 05-UI-SPEC.md]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Browser automation | Custom WebSocket-to-DOM event replay | Playwright `page.mouse`, `page.keyboard`, and CDP `Input.*` fallback. [CITED: https://playwright.dev/docs/api/class-mouse] [CITED: https://chromedevtools.github.io/devtools-protocol/tot/Input/] | Browser automation APIs already implement trusted input semantics and viewport CSS-pixel coordinates. [CITED: https://playwright.dev/docs/api/class-mouse] |
| New-document injection | Ad hoc script tag insertion after navigation | `page.addInitScript` and CDP `Page.addScriptToEvaluateOnNewDocument`. [CITED: https://playwright.dev/docs/api/class-page] [CITED: https://chromedevtools.github.io/devtools-protocol/tot/Page/#method-addScriptToEvaluateOnNewDocument] | Both APIs register scripts for future document creation before page scripts run. [CITED: https://playwright.dev/docs/api/class-page] |
| Node-page bridge | Polling `page.evaluate` for captured frames | `page.exposeBinding` callback bridge. [CITED: https://playwright.dev/docs/api/class-page] | Binding functions survive navigations and execute callbacks in the Playwright context. [CITED: https://playwright.dev/docs/api/class-page] |
| Relay and compression | A second demo-specific relay or payload transform | Existing `createRelay` and `createWebSocketTransport`. [VERIFIED: src/relay/relay.js] [VERIFIED: src/transport/websocket.js] | Phase 04 already validates raw fan-out, frame caps, async codec ordering, and content-free health. [VERIFIED: npm test] |
| Test framework | Playwright Test or Jest for unit coverage | Node `node:test` plus focused fakes; use Playwright only for browser verification. [VERIFIED: package.json] | The repo already has 252 passing `node:test` tests and no heavy test framework. [VERIFIED: npm test] |

**Key insight:** the hard parts are lifecycle boundaries and privacy, not sending a mouse event; using existing Playwright/CDP, relay, renderer, and transport primitives keeps the plan focused on authorization, validation, coordinate math, and navigation survival. [VERIFIED: 05-CONTEXT.md] [VERIFIED: src/renderer/index.js] [CITED: https://chromedevtools.github.io/devtools-protocol/tot/Input/]

## Common Pitfalls

### Pitfall 1: Starting Capture Before `document.body`
**What goes wrong:** `createCapture().start()` expects `document.body`, so immediate `addInitScript` startup can fail or snapshot too early. [VERIFIED: src/capture/index.js]  
**Why it happens:** Playwright init scripts run after document creation but before page scripts; body may not exist yet. [CITED: https://playwright.dev/docs/api/class-page]  
**How to avoid:** inject a bootstrap function early, then have the adapter call it after `domcontentloaded` or after a body polling guard succeeds. [CITED: https://playwright.dev/docs/api/class-page]  
**Warning signs:** missing snapshots after navigation, binding ready events without `STREAM.SNAPSHOT`, or thrown body/null errors in adapter logs. [VERIFIED: src/capture/index.js]

### Pitfall 2: Child Frame Double-Capture
**What goes wrong:** child frames can create extra capture sessions and corrupt the room stream. [CITED: https://playwright.dev/docs/api/class-page]  
**Why it happens:** Playwright `addInitScript` and CDP new-document injection apply to frames. [CITED: https://playwright.dev/docs/api/class-page] [CITED: https://chromedevtools.github.io/devtools-protocol/tot/Page/#method-addScriptToEvaluateOnNewDocument]  
**How to avoid:** guard the artifact with `window.top !== window` and validate `frame === page.mainFrame()` in the binding callback. [CITED: https://playwright.dev/docs/api/class-page]  
**Warning signs:** multiple `STREAM.READY` events per navigation or snapshots from iframe URLs. [VERIFIED: src/protocol/messages.js]

### Pitfall 3: Logging Bridge Payloads
**What goes wrong:** snapshot HTML, attribute values, or typed control text can leak into telemetry. [VERIFIED: docs/SECURITY.md]  
**Why it happens:** the binding callback necessarily receives mirrored payloads and text replay payloads. [VERIFIED: src/capture/index.js]  
**How to avoid:** log only type, byte length, reason codes, counts, timestamps, coordinates, and text lengths. [VERIFIED: 05-CONTEXT.md] [VERIFIED: 05-UI-SPEC.md]  
**Warning signs:** logs or state events containing `payload.html`, attribute names/values from mirrored pages, or raw text typed by the user. [VERIFIED: docs/SECURITY.md]

### Pitfall 4: Missing Modifier Handling for Playwright Mouse Clicks
**What goes wrong:** modifier-click actions silently replay without modifiers. [CITED: https://playwright.dev/docs/api/class-mouse]  
**Why it happens:** `mouse.click` options cover button/clickCount/delay, while keyboard modifiers are separate keyboard state. [CITED: https://playwright.dev/docs/api/class-mouse] [CITED: https://playwright.dev/docs/api/class-keyboard]  
**How to avoid:** for modifier actions, press modifiers with `page.keyboard.down`, perform the mouse action, then release modifiers in `finally`. [CITED: https://playwright.dev/docs/api/class-keyboard]  
**Warning signs:** control-click or shift-click fixture behaviors fail while plain clicks work. [VERIFIED: reference/dashboard/dashboard.js]

### Pitfall 5: Wheel Coordinates
**What goes wrong:** scroll happens at the wrong location or not inside the intended scrollable region. [CITED: https://playwright.dev/docs/api/class-mouse]  
**Why it happens:** Playwright `mouse.wheel(deltaX, deltaY)` does not take coordinates, so it acts at the current mouse position. [CITED: https://playwright.dev/docs/api/class-mouse]  
**How to avoid:** call `page.mouse.move(x, y)` before `page.mouse.wheel(...)`; CDP fallback can send `Input.dispatchMouseEvent` with `type: 'mouseWheel'`, `x`, `y`, `deltaX`, and `deltaY`. [CITED: https://playwright.dev/docs/api/class-mouse] [CITED: https://chromedevtools.github.io/devtools-protocol/tot/Input/]  
**Warning signs:** fixture page scrolls globally instead of scrolling the intended panel. [VERIFIED: 05-UI-SPEC.md]

### Pitfall 6: Denied Control Still Dispatches
**What goes wrong:** a forged viewer action or stale UI state dispatches into the real page after denial. [VERIFIED: 05-CONTEXT.md]  
**Why it happens:** viewer overlay state is treated as authoritative. [VERIFIED: reference/dashboard/dashboard.js]  
**How to avoid:** adapter default-denies, emits `denied`, keeps action handlers inert, and checks `controlState === 'active'` before every replay call. [VERIFIED: 05-CONTEXT.md] [VERIFIED: reference/extension/ws-client.js]  
**Warning signs:** denied counter increments and driven-page click count also changes. [VERIFIED: 05-UI-SPEC.md]

### Pitfall 7: General Input Mirroring Scope Creep
**What goes wrong:** Phase 05 grows into CAPT-05 by trying to mirror arbitrary input `value` property changes. [VERIFIED: REQUIREMENTS.md]  
**Why it happens:** remote typing into an input changes DOM properties that MutationObserver does not generally observe. [VERIFIED: REQUIREMENTS.md]  
**How to avoid:** keep general input mirroring deferred, and make the deterministic fixture reflect text through captured DOM mutation for Phase 05 proof. [VERIFIED: 05-UI-SPEC.md] [VERIFIED: REQUIREMENTS.md]  
**Warning signs:** plans modify core capture input-event tracking outside the fixture/demo path. [VERIFIED: REQUIREMENTS.md]

## Code Examples

Verified patterns from official sources and local source:

### CDP Fallback Replay
```js
// Source: Playwright CDPSession + CDP Input domain.
async function cdpClick(session, action) {
  await session.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: action.x,
    y: action.y,
    modifiers: action.modifiers || 0
  });
  await session.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: action.x,
    y: action.y,
    button: action.button || 'left',
    buttons: 1,
    clickCount: 1,
    modifiers: action.modifiers || 0
  });
  await session.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: action.x,
    y: action.y,
    button: action.button || 'left',
    buttons: 0,
    clickCount: 1,
    modifiers: action.modifiers || 0
  });
}
```
`CDPSession.send(method, params)` calls raw protocol methods, and `Input.dispatchMouseEvent` uses main-frame viewport CSS pixels for `x` and `y`. [CITED: https://playwright.dev/docs/api/class-cdpsession] [CITED: https://chromedevtools.github.io/devtools-protocol/tot/Input/]

### Default-Deny Authorization Gate
```js
// Source: Phase 05 context and reference extension active-state guard.
async function requestControl(adapter, request) {
  var authorize = adapter.authorizeControl || function () { return false; };
  adapter.setControlState('requesting', 'control-requested');
  var approved = await authorize({ requestId: request.requestId, source: 'viewer' });
  if (!approved) {
    adapter.setControlState('denied', 'authorization-denied');
    return false;
  }
  adapter.setControlState('active', 'authorization-approved');
  return true;
}
```
The adapter must enforce the same active-state check again in each action handler because relay frames can be forged by any connected viewer role in the room. [VERIFIED: src/relay/relay.js] [VERIFIED: 05-CONTEXT.md]

### Viewer Control Overlay Event Shape
```js
// Source: reference dashboard remote-control lineage + Phase 05 UI contract.
stageOverlay.addEventListener('wheel', function (event) {
  if (controlState !== 'active') return;
  event.preventDefault();
  var rect = stageOverlay.getBoundingClientRect();
  var mapped = mapHostPointToViewport({
    x: event.clientX - rect.left,
    y: event.clientY - rect.top
  }, viewer.getViewportMapping().scale, viewer.getViewportMapping().viewport);
  if (!mapped.inside) return;
  transport.send(REMOTE_CONTROL.SCROLL, {
    x: mapped.x,
    y: mapped.y,
    deltaX: Math.round(event.deltaX),
    deltaY: Math.round(event.deltaY)
  });
}, { passive: false });
```
The transparent overlay belongs to the host/demo, not to `createViewer`, and the viewer should expose only state/mapping APIs. [VERIFIED: 05-UI-SPEC.md] [VERIFIED: src/renderer/index.js]

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Inject after navigation with script tags | Register new-document scripts using `page.addInitScript` or CDP `Page.addScriptToEvaluateOnNewDocument`. [CITED: https://playwright.dev/docs/api/class-page] | Playwright docs current as of 2026-06-15; CDP tip-of-tree checked 2026-06-15. [CITED: https://chromedevtools.github.io/devtools-protocol/tot/Page/#method-addScriptToEvaluateOnNewDocument] | Capture can be present before page scripts and can survive navigations when paired with binding and re-snapshot lifecycle. [CITED: https://playwright.dev/docs/api/class-page] |
| Page-to-Node polling | `page.exposeBinding` bridge. [CITED: https://playwright.dev/docs/api/class-page] | Playwright Page API current as of 2026-06-15. [CITED: https://playwright.dev/docs/api/class-page] | Binding survives navigations and carries frame/page caller metadata. [CITED: https://playwright.dev/docs/api/class-page] |
| Synthetic DOM click/key/wheel | Driver-native Playwright/CDP input dispatch. [CITED: https://playwright.dev/docs/api/class-mouse] | Locked by Phase 05 context on 2026-06-15. [VERIFIED: 05-CONTEXT.md] | Replayed actions happen through the real browser automation boundary, not page JS. [CITED: https://chromedevtools.github.io/devtools-protocol/tot/Input/] |
| Reference `dash:remote-*` messages | PhantomStream `REMOTE_CONTROL` family with validators and redacted summaries. [VERIFIED: 05-CONTEXT.md] | Phase 05 context approved 2026-06-15. [VERIFIED: 05-UI-SPEC.md] | Public API is not tied to FSB reference route names. [VERIFIED: reference/dashboard/dashboard.js] |

**Deprecated/outdated:**
- Reusing `dash:remote-click`, `dash:remote-key`, `dash:remote-scroll`, and `dash:remote-control-start/stop` as public protocol names is out of scope for Phase 05; they remain lineage references only. [VERIFIED: 05-CONTEXT.md]
- Synthetic DOM event replay is forbidden for Phase 05 remote control. [VERIFIED: 05-CONTEXT.md]
- Relay-side execution or authorization of control actions contradicts the Phase 04 relay boundary. [VERIFIED: src/relay/relay.js] [VERIFIED: 05-CONTEXT.md]

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| — | All material claims in this research were verified against local project files, npm registry data, Context7, or official Playwright/CDP documentation. [VERIFIED: npm registry] [CITED: https://playwright.dev/docs/api/class-page] | All | No user confirmation needed for locked Phase 05 planning inputs. |

## Open Questions

1. **Should the public CLI spell the demo as `phantom-stream demo --playwright` or `phantom-stream playwright-demo`?** [VERIFIED: bin/phantom-stream.js]
   - What we know: existing CLI supports `phantom-stream demo` for the two-tab demo. [VERIFIED: bin/phantom-stream.js]
   - What's unclear: the phase context requires a separate deterministic Playwright demo but does not lock the exact command name. [VERIFIED: 05-CONTEXT.md]
   - Recommendation: prefer `phantom-stream demo --playwright` if keeping one demo command is important, or `phantom-stream playwright-demo` if planner wants low-risk separation from Phase 04 CLI tests. [VERIFIED: tests/demo-cli.test.js]

2. **Should the adapter expose the inject artifact path or only `getInjectSource()`?** [VERIFIED: package.json]
   - What we know: Node adapter code can read a sibling artifact via `import.meta.url`, and package exports can expose only `./adapters/playwright`. [VERIFIED: package.json]
   - What's unclear: Phase 10 packaging may prefer an explicit subpath for the artifact. [VERIFIED: ROADMAP.md]
   - Recommendation: expose `getPlaywrightInjectSource()` from `./adapters/playwright` now, and defer a separate artifact subpath until package-publication hardening. [VERIFIED: ROADMAP.md]

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Node.js | Tests, relay, demo CLI | yes | v24.14.1 [VERIFIED: node --version] | Node 18+ should still satisfy current `node:test` usage. [VERIFIED: CLAUDE.md] |
| npm | Dependency install and scripts | yes | 11.11.0 [VERIFIED: npm --version] | — |
| `ws` | Relay backend | yes | 8.21.0 installed. [VERIFIED: package.json] [VERIFIED: node_modules/ws] | — |
| jsdom | Existing unit tests | yes | 29.1.1 installed. [VERIFIED: package.json] [VERIFIED: node_modules/jsdom] | — |
| Playwright package | Phase 05 demo/browser verification | no | missing from workspace. [VERIFIED: require.resolve('playwright/package.json')] | Install `playwright@1.60.0` as devDependency. [VERIFIED: npm registry] |
| Chromium/Chrome CLI | Browser launch if not using managed Playwright browser | partially | `/Applications/Google Chrome.app` exists; `google-chrome` CLI is missing. [VERIFIED: ls /Applications/Google Chrome.app] [VERIFIED: command -v google-chrome] | Use Playwright-managed Chromium via `npx playwright install chromium`, or pass a macOS Chrome `executablePath`. [VERIFIED: environment audit] |

**Missing dependencies with no fallback:**
- None for planning; Playwright install is required before executing browser demo verification. [VERIFIED: environment audit]

**Missing dependencies with fallback:**
- Playwright package and managed browser are missing; install `playwright@1.60.0`, then use Playwright-managed Chromium or the installed macOS Chrome app. [VERIFIED: npm registry] [VERIFIED: /Applications/Google Chrome.app]

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Node built-in `node:test` on Node v24.14.1. [VERIFIED: package.json] [VERIFIED: node --version] |
| Config file | none. [VERIFIED: rg --files for test config] |
| Quick run command | `node --test tests/remote-control-protocol.test.js tests/playwright-adapter.test.js tests/renderer-remote-control.test.js tests/playwright-demo-cli.test.js` [VERIFIED: package.json test style] |
| Full suite command | `npm test` [VERIFIED: package.json] |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| ADPT-02 | Adapter registers binding before init script, uses one inject artifact, ignores child frames, forwards capture messages content-free, and re-snapshots after navigation. [VERIFIED: 05-CONTEXT.md] | unit + fake Playwright integration | `node --test tests/playwright-adapter.test.js -x` | no, Wave 0 |
| ADPT-02 | CDP fallback sends `Page.addScriptToEvaluateOnNewDocument` and `Input.*` calls through `CDPSession.send`. [CITED: https://playwright.dev/docs/api/class-cdpsession] | unit with fake CDPSession | `node --test tests/playwright-adapter-cdp.test.js -x` | no, Wave 0 |
| PKG-02 | Playwright demo command starts local relay, prints viewer/driven URLs, room prefix, and `Control: default-deny`. [VERIFIED: 05-UI-SPEC.md] | CLI integration | `node --test tests/playwright-demo-cli.test.js -x` | no, Wave 0 |
| VIEW-05 | Viewer inverse mapping converts host points to viewport CSS pixels and rejects outside-letterbox clicks. [VERIFIED: src/renderer/overlays.js] | unit | `node --test tests/renderer-remote-control.test.js -x` | no, Wave 0 |
| VIEW-05 | Approved click/type/scroll dispatch through driver-native APIs and update deterministic fixture state. [VERIFIED: 05-CONTEXT.md] | browser verification | `npm run demo:playwright` plus browser/Playwright checkpoint | no, Wave 0 |
| SEC-04 | Default-deny and explicit denial emit state while dispatch count remains zero. [VERIFIED: 05-CONTEXT.md] | unit + browser verification | `node --test tests/remote-control-authorization.test.js -x` | no, Wave 0 |
| SEC-04 | State/health/action logs redact typed text and mirrored payload content. [VERIFIED: docs/SECURITY.md] | unit/static scan | `node --test tests/remote-control-privacy.test.js -x` | no, Wave 0 |

### Sampling Rate
- **Per task commit:** run the focused command for files touched in that task plus `node --test tests/protocol.test.js` when protocol constants change. [VERIFIED: package.json]
- **Per wave merge:** run `npm test`. [VERIFIED: npm test]
- **Phase gate:** run full `npm test`, the Playwright demo browser checkpoint, denial checkpoint, and navigation/reload checkpoint before `/gsd-verify-work`. [VERIFIED: 05-CONTEXT.md]

### Wave 0 Gaps
- [ ] `tests/remote-control-protocol.test.js` - covers `REMOTE_CONTROL` constants, validators, redacted summaries, and invalid payload rejection. [VERIFIED: tests list]
- [ ] `tests/renderer-remote-control.test.js` - covers inverse mapping and viewer handle mapping getter. [VERIFIED: src/renderer/index.js]
- [ ] `tests/playwright-adapter.test.js` - covers fake page binding/init order, main-frame filtering, content-free bridge forwarding, and navigation restart. [VERIFIED: 05-CONTEXT.md]
- [ ] `tests/playwright-adapter-cdp.test.js` - covers CDP injection and fallback input dispatch. [CITED: https://chromedevtools.github.io/devtools-protocol/tot/Input/]
- [ ] `tests/remote-control-authorization.test.js` - covers default deny, approve, stop, stale action blocked, and dispatch count zero on denial. [VERIFIED: 05-CONTEXT.md]
- [ ] `tests/playwright-demo-cli.test.js` - covers CLI output contract and separate demo command wiring. [VERIFIED: 05-UI-SPEC.md]
- [ ] Framework install: `npm install --save-dev playwright@1.60.0` before browser-level verification. [VERIFIED: npm registry]

### Browser / FSB Verification Checkpoints
- Start the Playwright demo on `127.0.0.1` and record terminal lines for viewer URL, driven page URL, room prefix, and default-deny control. [VERIFIED: 05-UI-SPEC.md]
- Open the viewer, leave authorization hook on `Deny`, click `Request control`, verify UI state `denied`, verify action log redacts content, and verify driven page counters do not change. [VERIFIED: 05-UI-SPEC.md]
- Switch hook to `Approve`, request control, click the fixture `Click target` through the mirror, verify driven click count changes and the mirror updates. [VERIFIED: 05-CONTEXT.md]
- Type into the fixture through the mirror, verify the real page receives text, and verify demo logs show character count only. [VERIFIED: 05-UI-SPEC.md]
- Wheel over the mirror scroll region, verify real page scroll marker changes and mirror follows. [VERIFIED: 05-UI-SPEC.md]
- Trigger fixture navigation or reload, verify the adapter emits stale/requesting or nav count state, then a fresh snapshot returns lifecycle to `live`. [VERIFIED: 05-CONTEXT.md]

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|------------------|
| V2 Authentication | no for user identity, yes for control authorization semantics. [VERIFIED: 05-CONTEXT.md] | Host-provided `authorizeControl` hook; default deny. [VERIFIED: 05-CONTEXT.md] |
| V3 Session Management | yes | Control state is per adapter/session/room and resets on stop/dispose/navigation as planned. [VERIFIED: src/protocol/messages.js] [VERIFIED: 05-CONTEXT.md] |
| V4 Access Control | yes | Adapter enforces authorization before active state and before each action dispatch. [VERIFIED: 05-CONTEXT.md] |
| V5 Input Validation | yes | Pure protocol validators in `src/protocol/remote-control.js`; reject invalid action kind, coordinates, deltas, button, key event, or oversized text. [VERIFIED: src/protocol/messages.js] |
| V6 Cryptography | no new cryptography | Reuse existing random room keys from the local demo server; do not add custom crypto. [VERIFIED: examples/two-tab-demo/server.js] |

### Known Threat Patterns for Playwright/CDP Remote Control

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Forged viewer sends action without approval | Elevation of privilege | Adapter default-deny and active-state check before every replay. [VERIFIED: 05-CONTEXT.md] |
| Denied control still dispatches due stale UI | Elevation of privilege | Denial emits state and action handlers remain inert; test dispatch count zero. [VERIFIED: 05-CONTEXT.md] |
| Telemetry leaks page HTML or typed content | Information disclosure | Redacted summaries only; logs show counts/coordinates/key names, not payload HTML/text/attrs. [VERIFIED: docs/SECURITY.md] [VERIFIED: 05-UI-SPEC.md] |
| Synthetic DOM events bypass browser input semantics | Tampering | Static scan and tests forbid DOM event constructors/replay inside captured page. [VERIFIED: 05-CONTEXT.md] |
| Relay begins inspecting or executing control actions | Tampering | Keep relay raw and endpoint-owned; add relay tests that control frames fan out byte-identically. [VERIFIED: src/relay/relay.js] [VERIFIED: tests/relay-core.test.js] |
| Coordinate replay outside mirrored viewport | Tampering | Inverse mapper returns `inside:false`; adapter/demo blocks dispatch outside viewport. [VERIFIED: src/renderer/overlays.js] |
| Child frame capture leaks unexpected document content | Information disclosure | Inject artifact and binding callback restrict Phase 05 capture to main frame. [CITED: https://playwright.dev/docs/api/class-page] |

## Sources

### Primary (HIGH confidence)
- `05-CONTEXT.md` - locked Phase 05 decisions, scope, deferred items, verification gates. [VERIFIED: 05-CONTEXT.md]
- `05-UI-SPEC.md` - approved demo UI, CLI output, remote-control state names, telemetry redaction rules. [VERIFIED: 05-UI-SPEC.md]
- `REQUIREMENTS.md` - ADPT-02, PKG-02, VIEW-05, SEC-04 and CAPT-05 deferral. [VERIFIED: REQUIREMENTS.md]
- `ROADMAP.md` - Phase 05 success criteria and downstream phase ordering. [VERIFIED: ROADMAP.md]
- `docs/SECURITY.md` - content-free telemetry and no-`allow-scripts` sandbox contract. [VERIFIED: docs/SECURITY.md]
- `src/capture/index.js` - Transport seam and body-dependent capture lifecycle. [VERIFIED: src/capture/index.js]
- `src/renderer/index.js` and `src/renderer/overlays.js` - scale state, `computeScale`, `mapRectToHost`, event surfaces. [VERIFIED: src/renderer/index.js] [VERIFIED: src/renderer/overlays.js]
- `src/transport/websocket.js` and `src/relay/relay.js` - raw relay and endpoint-owned telemetry/compression boundaries. [VERIFIED: src/transport/websocket.js] [VERIFIED: src/relay/relay.js]
- Playwright Page API - `addInitScript` and `exposeBinding`. [CITED: https://playwright.dev/docs/api/class-page]
- Playwright CDPSession API - `session.send` and CDP events. [CITED: https://playwright.dev/docs/api/class-cdpsession]
- Playwright Mouse API - CSS-pixel click/move and wheel. [CITED: https://playwright.dev/docs/api/class-mouse]
- Playwright Keyboard API - `insertText`, `down`, `up`, `press`, and `type`. [CITED: https://playwright.dev/docs/api/class-keyboard]
- Chrome DevTools Protocol Page domain - `Page.addScriptToEvaluateOnNewDocument`. [CITED: https://chromedevtools.github.io/devtools-protocol/tot/Page/#method-addScriptToEvaluateOnNewDocument]
- Chrome DevTools Protocol Input domain - `dispatchMouseEvent`, `dispatchKeyEvent`, `insertText`, coordinate semantics. [CITED: https://chromedevtools.github.io/devtools-protocol/tot/Input/]
- npm registry - `playwright@1.60.0`, `playwright-core@1.60.0`, `ws@8.21.0`, `jsdom@29.1.1`. [VERIFIED: npm registry]

### Secondary (MEDIUM confidence)
- Context7 `/microsoft/playwright.dev` - confirmed Playwright docs source and binding/input API snippets, but official Playwright docs above are the primary citation. [VERIFIED: Context7 CLI]
- FSB reference `reference/dashboard/dashboard.js` and `reference/extension/ws-client.js` - behavioral lineage for remote overlay capture, active-state guard, and CDP dispatch shape. [VERIFIED: reference/dashboard/dashboard.js] [VERIFIED: reference/extension/ws-client.js]

### Tertiary (LOW confidence)
- None. [VERIFIED: source inventory]

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - package versions verified from npm registry and APIs verified from official Playwright/CDP docs. [VERIFIED: npm registry] [CITED: https://playwright.dev/docs/api/class-page]
- Architecture: HIGH - module boundaries align with local source, Phase 05 context, and Phase 04 relay/transport implementation. [VERIFIED: src/relay/relay.js] [VERIFIED: src/transport/websocket.js]
- Pitfalls: HIGH for injection/replay/privacy pitfalls; MEDIUM for browser availability because Playwright is not installed locally yet. [CITED: https://playwright.dev/docs/api/class-page] [VERIFIED: require.resolve('playwright/package.json')]
- Validation: HIGH for existing test framework and suite; MEDIUM for browser checkpoint automation until Playwright is installed. [VERIFIED: npm test] [VERIFIED: npm registry]

**Research date:** 2026-06-15 [VERIFIED: environment current_date]
**Valid until:** 2026-06-22 for package latest-version claims, 2026-07-15 for architecture and official API semantics. [VERIFIED: npm registry] [CITED: https://playwright.dev/docs/api/class-page]
