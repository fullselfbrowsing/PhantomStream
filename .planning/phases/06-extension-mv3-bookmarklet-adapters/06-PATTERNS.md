# Phase 06 Pattern Map

## Purpose

Map Phase 6 planned files to existing analogs so executors can reuse local patterns instead of inventing a new adapter style.

## Planned File Analogs

| Planned file | Role | Closest analog | Pattern to reuse |
|--------------|------|----------------|------------------|
| `src/adapters/extension.js` | MV3 adapter API | `src/adapters/playwright.js` | Validate options at factory time, expose install/dispose-style handle, wire transport `onMessage`, keep telemetry content-free. |
| `src/adapters/bookmarklet.js` | Bookmarklet generator API | `src/adapters/playwright.js` + `src/transport/websocket.js` | Pure exported helpers, no DOM side effects at import time, strict input validation. |
| `src/adapters/browser-inject.js` | Shared inject artifact helper | `src/adapters/playwright-inject.js` | Checked-in classic script with no `import` or `export`, exposes global start/bridge hooks. |
| `examples/extension-mv3/server.js` | Local demo server | `examples/two-tab-demo/server.js` and `examples/playwright-demo/server.js` | Bind `127.0.0.1`, no-store static assets, generated room key, strict MIME/path handling. |
| `examples/bookmarklet-demo/server.js` | Local demo server | `examples/two-tab-demo/server.js` | Build paired source/viewer URLs with role-specific WS URLs. |
| `bin/phantom-stream.js` | CLI command wiring | Existing `demo` and `playwright-demo` branches | Parse command-specific flags, print deterministic URL lines, close on SIGINT/SIGTERM. |
| `tests/extension-adapter.test.js` | MV3 fake API tests | `tests/playwright-adapter.test.js` | Local fake APIs, recording transport, focused assertions for bridge messages and lifecycle. |
| `tests/bookmarklet-adapter.test.js` | Pure helper tests | `tests/websocket-transport.test.js` | Validate structured outputs and failure codes without browser globals. |
| `tests/extension-demo-cli.test.js` | CLI/server tests | `tests/demo-cli.test.js` and `tests/playwright-demo-cli.test.js` | Spawn CLI, wait for stdout marker, kill with SIGINT, assert local URLs and no-store assets. |
| `tests/bookmarklet-demo-cli.test.js` | CLI/server tests | `tests/demo-cli.test.js` | Assert printed bookmarklet, room prefix, source/viewer URLs, and static route contents. |

## Concrete Patterns To Preserve

### Adapter API shape

Use this local pattern from `src/adapters/playwright.js`:

```js
export function createPlaywrightAdapter(options) {
  var cfg = options || {};
  var transport = cfg.transport;
  if (!transport || typeof transport.send !== 'function') throw new Error('transport-send-required');
  // return handle with install/dispose/on/getState style methods
}
```

Phase 6 adapters should validate missing `chrome`, `transport`, `storage.session`, `alarms`, `runtime`, and URL config with exact error strings so tests can pin behavior.

### Demo server shape

Use this local pattern from `examples/two-tab-demo/server.js`:

```js
const HOST = '127.0.0.1';
if (host !== HOST) throw new Error('demo-host-local-only');
res.writeHead(200, {
  'content-type': MIME[extname(filePath)] || 'application/octet-stream',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff'
});
```

### Transport shape

Use `createWebSocketTransport` as the endpoint transport. Do not add relay-side decode or transformation. Source endpoints send `STREAM.*`; viewer/control requests arrive through `onMessage`.

### Test style

All Phase 6 tests should use:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
```

No Jest/Vitest/Cypress. Browser verification can produce markdown evidence, but automated gates should stay in Node where possible.

## Pitfalls

- Do not persist mirrored payloads in `chrome.storage.session`.
- Do not rely on SW module globals for active stream recovery.
- Do not introduce Rollup/Vite/esbuild for the injected browser artifact.
- Do not hide bookmarklet CSP failures.
- Do not make the existing `demo` command ambiguous; add explicit adapter demo command(s).

## PATTERN MAPPING COMPLETE
