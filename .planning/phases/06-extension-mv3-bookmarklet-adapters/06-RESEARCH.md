# Phase 06 Research: Extension MV3 + Bookmarklet Adapters

## Research Complete

Phase 6 should plan two adapter tracks on top of the existing capture, relay, transport, and viewer stack:

- **ADPT-01:** Chromium MV3 adapter with content-script injection, service-worker relay client, `chrome.alarms` watchdog, and `chrome.storage.session` recovery.
- **ADPT-03:** Bookmarklet loader that injects capture into the current page and connects to a live viewer.

The important planning risk is not the relay/viewer pipeline, which already exists. The risk is preserving browser-runtime invariants: MV3 service workers are ephemeral, extension content scripts are isolated from page globals, bookmarklets are constrained by page policy, and injected code must remain no-build and dependency-light.

## Official Platform Findings

### MV3 service worker lifecycle

Chrome's MV3 migration docs state that extension service workers terminate when unused; code must persist application state rather than rely on global variables, and timers should be replaced with alarms. Event listeners must be registered synchronously at top level so wake events are not missed.

Planning consequence:

- Store active stream intent in `chrome.storage.session`, not SW globals.
- Register `chrome.runtime.onMessage`, `chrome.alarms.onAlarm`, `chrome.runtime.onInstalled`, and any action/scripting listeners at module load.
- Treat WebSocket liveness as helpful, not a correctness guarantee.

Source: https://developer.chrome.com/docs/extensions/develop/migrate/to-service-workers

### `chrome.storage.session`

Chrome storage docs define `storage.session` as in-memory storage kept while the extension is loaded and cleared when the extension is disabled, reloaded, updated, or the browser restarts. It is recommended for service workers and stores JSON-serializable values.

Planning consequence:

- Persist only content-free state: room key, ws URL, active tab id, streaming active flag, current intent, timestamps, counters, and pending resnapshot reason.
- Do not persist mirrored HTML, text, attributes, snapshots, diffs, or typed input.
- Do not expose `storage.session` to content scripts unless a task has a concrete reason; the SW can own the state.

Source: https://developer.chrome.com/docs/extensions/reference/api/storage

### `chrome.alarms`

Chrome alarms require the `"alarms"` manifest permission. Current Chrome docs say alarms can run periodically, device sleep may coalesce missed alarms, and important alarms should be recreated when the service worker starts. Chrome service-worker lifecycle docs note Chrome 120 reduced the minimum alarm period to 30 seconds.

Planning consequence:

- The adapter should check and recreate the PhantomStream watchdog alarm on startup when stream state says the stream is active.
- Tests should assert the alarm is armed idempotently and that alarm wake reads `chrome.storage.session` before deciding whether to request a fresh snapshot.
- Use 30 seconds only if the implementation sets a minimum Chrome version that supports it. Otherwise choose a conservative 1 minute default or make the period configurable with a safe floor.

Sources:
- https://developer.chrome.com/docs/extensions/reference/api/alarms
- https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle

### `chrome.scripting` and content scripts

The `chrome.scripting` API is MV3+ and requires `"scripting"` plus host permissions or `"activeTab"`. `executeScript` injects files or self-contained function bodies into a target tab. Chrome content scripts run in isolated worlds, can use `runtime.sendMessage`, and can be declared statically, dynamically, or programmatically.

Planning consequence:

- Prefer file-based injection of a checked-in classic script artifact over runtime strings.
- Use activeTab/host permissions in the fixture, but keep host permission policy configurable for consumers.
- The content script bridge should communicate with the SW through `chrome.runtime.sendMessage` / `onMessage`, not direct access to SW state.

Sources:
- https://developer.chrome.com/docs/extensions/reference/api/scripting
- https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts

### Bookmarklet constraints

MDN defines CSP as a browser-enforced policy that controls which resources, especially JavaScript, a document can load or execute. Bookmarklets run in the page context and should be treated as convenience loaders; restrictive CSPs and browser policies can block inline or external script loading.

Planning consequence:

- The bookmarklet adapter should fail visibly when injection is blocked.
- Do not promise universal page support and do not plan CSP-bypass behavior.
- The demo can prove the artifact on a known local page where policy permits script execution.

Source: https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CSP

## Existing Codebase Findings

### Reusable surfaces

- `src/capture/index.js` already provides `createCapture({ transport, ... })` with the required lifecycle.
- `src/transport/websocket.js` already provides `createWebSocketTransport({ url, WebSocket, role, ... })`, `send`, `flush`, `onMessage`, `onStatus`, and content-free health snapshots.
- `src/relay/index.js` and `examples/two-tab-demo/server.js` already provide the local relay/demo shape.
- `src/adapters/playwright.js` gives the adapter factory pattern: validate inputs, install bridge, wire transport messages, expose events, and cleanup.
- `src/adapters/playwright-inject.js` proves the checked-in classic script artifact approach.

### Established test patterns

- Adapter tests use local fakes and `node:test` with `node:assert/strict`.
- CLI demo tests spawn `bin/phantom-stream.js`, wait for deterministic stdout lines, then send SIGINT.
- Browser/demo static contract tests assert exact HTML/JS/CSS strings and local-only URLs.
- Watchdog tests isolate fragile timer/global fakes in their own test file.

## Recommended Plan Architecture

1. **Foundation:** Add shared browser-inject helpers and package exports for `./adapters/extension` and `./adapters/bookmarklet`.
2. **MV3 core:** Implement service-worker adapter state/recovery, content-script bridge, alarm handling, and fake Chrome API tests.
3. **MV3 demo:** Add local extension fixture/demo command and browser verification artifact.
4. **Bookmarklet core:** Implement bookmarklet source generation/validation and loader tests.
5. **Bookmarklet demo:** Add local bookmarklet demo command and browser verification artifact.

This plan shape keeps ADPT-01 and ADPT-03 separable after the shared artifact foundation, enabling parallel implementation in Wave 2 and parallel demo verification in Wave 3.

## Validation Architecture

The validation strategy should sample every adapter boundary:

- **Export/shape tests:** `tests/adapter-exports.test.js`
- **MV3 unit tests:** `tests/extension-adapter.test.js`
- **MV3 CLI/demo tests:** `tests/extension-demo-cli.test.js`
- **Bookmarklet unit tests:** `tests/bookmarklet-adapter.test.js`
- **Bookmarklet CLI/demo tests:** `tests/bookmarklet-demo-cli.test.js`
- **Full regression:** `npm test`

Manual/browser verification remains required for the two actual browser claims:

- Load a real MV3 fixture extension in Chromium and prove a live mirror reaches the viewer.
- Execute the generated bookmarklet source in a browser page and prove the viewer receives a snapshot plus a mutation.

## Risks And Mitigations

| Risk | Mitigation |
|------|------------|
| SW restart silently loses active stream | Persist content-free stream intent in `chrome.storage.session`; recreate alarm and trigger fresh snapshot on wake. |
| Tests overfit to impossible real SW eviction automation | Unit-test the exact restart boundary by rebuilding adapter state from fake `chrome.storage.session`; browser verification proves real extension loading separately. |
| Bookmarklet fails on restrictive pages | Document and test visible failure; demo on local page with permissive policy. |
| Browser-injected artifact drifts from capture core | Add static tests that artifact contains `createCapture`, has no `import`/`export`, and exposes expected bridge hooks. |
| Phase expands into full extension product | Keep fixture/demo minimal and local-only; defer options/onboarding/store UX. |

## Research Sources

- Chrome storage API: https://developer.chrome.com/docs/extensions/reference/api/storage
- Chrome alarms API: https://developer.chrome.com/docs/extensions/reference/api/alarms
- Chrome service-worker lifecycle: https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle
- Chrome MV3 migration: https://developer.chrome.com/docs/extensions/develop/migrate/to-service-workers
- Chrome scripting API: https://developer.chrome.com/docs/extensions/reference/api/scripting
- Chrome content scripts: https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts
- MDN CSP guide: https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CSP

## RESEARCH COMPLETE
