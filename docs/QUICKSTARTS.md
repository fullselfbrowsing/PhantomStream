# PhantomStream Quickstarts

Use these paths when you want a live mirror quickly. They reuse the shipped
examples and package APIs instead of introducing a build step.

## Install

Prerequisites:

- Node.js 20 or newer for local demos and package validation.
- A browser with WebSocket support for viewer/source pages.
- Playwright installed only when using the Playwright/CDP path.

```bash
npm install @fullselfbrowsing/phantom-stream
```

Expected success signal: your project can import
`@fullselfbrowsing/phantom-stream/capture`,
`@fullselfbrowsing/phantom-stream/renderer`, and the other public subpaths.

Fast check:

```bash
node --input-type=module -e "await import('@fullselfbrowsing/phantom-stream/capture')"
```

## Embedded Loopback

Use this when the source page and mirror live in the same first-party app.
There is no relay and no network transport.

Prerequisites:

- A page that can run first-party JavaScript modules.
- A container element for the mirror.

Minimal wiring:

```js
import { CONTROL } from '@fullselfbrowsing/phantom-stream/protocol';
import { createCapture } from '@fullselfbrowsing/phantom-stream/capture';
import { createViewer } from '@fullselfbrowsing/phantom-stream/renderer';

function createLoopbackTransport() {
  const toViewer = new Set();
  const toCapture = new Set();
  const fanOut = (handlers, type, payload) => {
    queueMicrotask(() => handlers.forEach((handler) => handler(type, payload)));
  };
  return {
    captureTransport: { send: (type, payload) => fanOut(toViewer, type, payload) },
    viewerTransport: {
      send: (type, payload) => fanOut(toCapture, type, payload),
      onMessage: (handler) => {
        toViewer.add(handler);
        return () => toViewer.delete(handler);
      }
    },
    onControl: (handler) => {
      toCapture.add(handler);
      return () => toCapture.delete(handler);
    }
  };
}

const transport = createLoopbackTransport();
const viewer = createViewer({
  container: document.getElementById('mirror'),
  transport: transport.viewerTransport
});
const capture = createCapture({
  transport: transport.captureTransport,
  skipElement: (el) => !!el.closest('[data-phantomstream-host]')
});

transport.onControl((type) => {
  if (type === CONTROL.START) capture.start();
});
capture.start();
```

Expected success signal: the mirror iframe appears in the container and tracks
text or element changes in the same page.

Fast check: mark your host UI with `data-phantomstream-host` and verify it does
not recursively appear inside the mirror.

## WebSocket Two-Tab Demo

Use this when you want one browser tab mirrored into another through the
bundled relay.

Prerequisites:

- The package installed locally or available through `npx`.
- Two tabs in the same browser.

Command:

```bash
npx @fullselfbrowsing/phantom-stream demo --no-open
# or, after local install:
phantom-stream demo --no-open
```

Expected success signal: the command prints a source URL and a viewer URL. Open
both; DOM edits in the source tab appear in the viewer tab.

Fast check: the URLs must include the same `room` value and opposite
`role=source` / `role=viewer` values.

## Playwright/CDP

Use this when a script drives a real browser and you want a live viewer, with
optional consent-gated remote control.

Prerequisites:

- Playwright available in the host project.
- A relay URL with `role=source` for the driven page and `role=viewer` for the
  viewer.

Demo command:

```bash
phantom-stream playwright-demo --no-open
```

Minimal adapter wiring:

```js
import { chromium } from 'playwright';
import { createPlaywrightAdapter } from '@fullselfbrowsing/phantom-stream/adapters/playwright';
import { createWebSocketTransport } from '@fullselfbrowsing/phantom-stream/transport/websocket';

const browser = await chromium.launch();
const page = await browser.newPage();
const transport = createWebSocketTransport({
  url: 'ws://127.0.0.1:8787/ws?room=demo&role=source',
  role: 'source'
});

const adapter = createPlaywrightAdapter({
  page,
  transport,
  authorizeControl: async () => false
});

await adapter.install();
await page.goto('https://example.com');
```

Expected success signal: the viewer receives a fresh snapshot after
navigation, and adapter state events remain locked unless your
`authorizeControl` hook approves a control action.

Fast check: run the demo first. If it works but your integration does not,
verify the page adapter is using the source relay URL and the viewer uses the
viewer relay URL.

## Extension MV3

Use this when capture runs from a Chromium MV3 extension service worker plus
content-script bridge.

Prerequisites:

- Chromium extension APIs: `runtime.onMessage`, `storage.session`, and
  `alarms`.
- A content script that forwards page bridge messages to the service worker.

Demo command:

```bash
phantom-stream extension-demo --no-open
```

Service-worker sketch:

```js
import { CONTROL } from '@fullselfbrowsing/phantom-stream/protocol';
import { createExtensionAdapter } from '@fullselfbrowsing/phantom-stream/adapters/extension';
import { createWebSocketTransport } from '@fullselfbrowsing/phantom-stream/transport/websocket';

const transport = createWebSocketTransport({
  url: 'ws://127.0.0.1:8787/ws?room=demo&role=source',
  role: 'source'
});
const adapter = createExtensionAdapter({ chrome, transport });

await adapter.install();
await adapter.sendControl(CONTROL.START, {
  wsUrl: 'ws://127.0.0.1:8787/ws?room=demo&role=source',
  roomKey: 'demo',
  tabId
});
```

Expected success signal: after the extension starts capture, service-worker
eviction recovery requests a fresh snapshot instead of depending on module
globals.

Fast check: confirm `chrome.storage.session` contains only stream intent
metadata, not mirrored page content.

## Bookmarklet

Use this when you want a no-extension loader for pages that permit bookmarklet
script injection. It does not bypass page CSP.

Prerequisites:

- A reachable HTTP(S) loader script URL.
- A relay source WebSocket URL.

Demo command:

```bash
phantom-stream bookmarklet-demo --no-open
```

Generate a bookmarklet string:

```js
import { createBookmarkletSource } from '@fullselfbrowsing/phantom-stream/adapters/bookmarklet';

const source = createBookmarkletSource({
  scriptUrl: 'http://127.0.0.1:8787/bookmarklet/loader.js',
  wsUrl: 'ws://127.0.0.1:8787/ws?room=demo&role=source',
  roomKey: 'demo'
});
```

Expected success signal: activating the bookmarklet injects the loader and the
connected viewer receives a snapshot.

Fast check: listen for `phantomstream:bookmarklet-error` on the page. A
`script-load-failed` reason usually means page policy blocked the loader.

## CSSOM Mode

Use CSSOM mode when stylesheet drift matters more than computed-inline
backward compatibility.

```js
import { createCapture } from '@fullselfbrowsing/phantom-stream/capture';

const capture = createCapture({
  transport,
  styleMode: 'cssom',
  fetchStylesheet: ({ href }) => stylesheetCache.get(href) || null
});
```

Expected success signal: snapshots carry `styleSources[]` and `styleStrategy`,
and live stylesheet edits stream as `style-source` ops.

Fast check: if a stylesheet is blocked, inspect fallback reasons such as
`cssRules-blocked`, `href-relinked`, `adapter-fetch`, or `computed-fallback`.
PhantomStream never performs hidden network fetches.

## Security Checklist

Read [SECURITY.md](SECURITY.md) before embedding a viewer in a product.

- Do not add `allow-scripts` to the mirror iframe sandbox.
- Do not render wire payloads outside `createViewer`.
- Keep capture-side masking for private text and form values.
- Treat custom overlay and dialog text as text, not HTML.
- Keep relay logs and diagnostics content-free.

Expected success signal: mirrored content renders inside the PhantomStream
viewer iframe, sanitizer counters stay visible, and private content is masked
before transport.

Fast check: search your integration for `allow-scripts`; there should be no
match on a PhantomStream mirror iframe.

## Troubleshooting

| Symptom | Fastest check |
|---|---|
| No viewer update | Confirm source and viewer use the same room with opposite roles. |
| WebSocket connects but no snapshot | Confirm capture called `start()` or the adapter installed before navigation. |
| Remote control does nothing | Confirm the Playwright/CDP `authorizeControl` hook approves the action. |
| Styles drift after class changes | Try `styleMode: 'cssom'` and inspect `styleStrategy.fallbacks`. |
| Bookmarklet fails silently | Listen for `phantomstream:bookmarklet-error` and check page CSP. |
| Private text appears in the mirror | Add `blockSelector`, `maskTextSelector`, or `maskInputs`; masking must happen capture-side. |
