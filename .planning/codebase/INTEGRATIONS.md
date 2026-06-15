# External Integrations

**Analysis Date:** 2026-06-09

## Overview

PhantomStream has no traditional cloud service integrations (no database, no auth provider, no third-party SaaS APIs). Its integrations are browser-runtime APIs, a self-hosted WebSocket relay, and a vendored compression library. The table below lists everything external the system touches.

---

## Browser Extension APIs (Chrome MV3)

These APIs are used in the reference implementation under `reference/extension/`. The planned `src/capture/` extraction explicitly decouples from them.

**`chrome.runtime`**
- Used in: `reference/extension/dom-stream.js`, `reference/extension/ws-client.js`
- `chrome.runtime.sendMessage` — content script sends snapshot, mutations, scroll, overlay, dialog, and ready messages to the background service worker
- `chrome.runtime.onMessage.addListener` — content script receives stream control commands (`start`, `stop`, `pause`, `resume`, `requestSnapshot`)
- `chrome.runtime.lastError` — checked after every async message send to suppress "receiving end does not exist" noise
- `chrome.runtime.getManifest()` — version read for diagnostics payload in `reference/extension/ws-client.js` line 983

**`chrome.tabs`**
- Used in: `reference/extension/ws-client.js`
- `chrome.tabs.sendMessage` — background pings content script with `pingDomStream` to probe readiness before starting a stream
- `chrome.tabs.get` — fetches tab URL to classify it as streamable, restricted, or dashboard
- `chrome.tabs.query` — resolves the active tab as the streaming candidate
- `chrome.tabs.update` — navigation (remote control: go to URL)
- `chrome.tabs.goBack`, `chrome.tabs.goForward`, `chrome.tabs.reload` — navigation commands
- `chrome.tabs.create` — opens new tab (remote control)

**`chrome.storage.local`**
- Used in: `reference/extension/ws-client.js`
- Stores `serverHashKey` (the QR-pair shared secret) and `serverUrl` (configurable relay endpoint)
- Read on every WebSocket connect attempt; written on first auto-registration

**`chrome.alarms`**
- Used in: `reference/extension/background.dom-stream-relay.excerpt.js`, `reference/extension/background.watchdog-alarm.excerpt.js`
- Alarm name: `fsb-domstream-watchdog`, period: 1 minute
- Purpose: survive MV3 service worker idle eviction. If the SW wakes to this alarm and streaming is active, it sends `ext:request-snapshot` to the relay, requesting a fresh snapshot from the dashboard
- Created via `chrome.alarms.create` on every mutation dispatch (idempotent — recreating the same name replaces the schedule)

**`chrome.scripting`**
- Used in: `reference/extension/ws-client.js` line 1266
- `chrome.scripting.executeScript` — injects content scripts into a tab on demand (stream start)

**`chrome.debugger`**
- Used in: `reference/extension/ws-client.js` lines 535–560
- Protocol: Chrome DevTools Protocol v1.3
- `chrome.debugger.attach` / `chrome.debugger.detach` / `chrome.debugger.sendCommand`
- Command used: `Input.dispatchKeyEvent` — keyboard injection for remote control
- Note: CDP-based keyboard injection is the only path that bypasses `isTrusted: false` event filtering on some sites

---

## WebSocket Relay

**Protocol:**
- Native browser `WebSocket` API (in extension service worker and dashboard browser page)
- `ws` npm package (`const WebSocket = require('ws')`) on the server side — `reference/server/ws-handler.js` line 1

**Connection:**
- Extension connects as `role=extension`: `wss://<serverUrl>/ws?key=<hashKey>&role=extension`
- Dashboard connects as `role=dashboard`: `wss://<serverUrl>/ws?key=<hashKey>&role=dashboard`
- `hashKey` is the room identity shared secret — authenticated server-side before the WS upgrade completes

**Room model:**
- The relay in `reference/server/ws-handler.js` maintains a `rooms` Map: `hashKey → { extensions: Set<ws>, dashboards: Set<ws> }`
- Messages from `extensions` fan out to all `dashboards` in the room and vice versa
- No message transformation at the relay — raw bytes forwarded verbatim

**Per-message size cap:**
- 1 MiB hard cap enforced relay-side (constant `RELAY_PER_MESSAGE_LIMIT_BYTES = 1048576` in `src/protocol/constants.js`)
- Oversize frames dropped; capture-side truncation budgets to 80% of this cap

**Backpressure:**
- Relay drops frames to clients whose `ws.bufferedAmount` exceeds 16 MiB (`BACKPRESSURE_BUFFER_LIMIT_BYTES` in `reference/server/ws-handler.js` line 12)

**Keepalive:**
- Extension side (`reference/extension/ws-client.js`): ping/pong with exponential backoff reconnection (max delay 30 s)
- Dashboard side (`reference/dashboard/dashboard.js`): same pattern, max reconnect delay 30 s

**Auto-registration:**
- On first connect, the extension calls `POST <serverUrl>/api/auth/register` (plain `fetch`) to obtain a `hashKey`, stores it in `chrome.storage.local`
- Relay server URL default: `https://full-selfbrowsing.com` (FSB parent project's server — will be replaced in standalone)

---

## LZ-String Compression

**Library:** lz-string (open source, MIT)
- Vendored copy: `reference/extension/lz-string.min.js` (4,814 bytes minified)
- Loaded via `importScripts()` in the extension background service worker (reference comment at `reference/extension/ws-client.js` line 821: `"LZString not loaded (importScripts may have failed at background.js:37)"`)
- Also loaded via `<script>` tag in the dashboard HTML page

**Codec used:** `LZString.compressToBase64` / `LZString.decompressFromBase64`

**Wire envelope format:**
- Compressed: `{ _lz: true, d: "<base64-encoded-lz-string>" }` — JSON-stringified
- Plain: the message object JSON-stringified directly
- Compression is applied only when `JSON.stringify(msg).length > 1024 bytes` AND the compressed result is shorter than the raw (adaptive — never inflates)
- Receivers auto-detect by shape: `obj._lz === true && typeof obj.d === 'string'`

**Protocol abstraction (`src/protocol/envelope.js`):**
- `encodeEnvelope(msg, lz, thresholdBytes)` — encoder accepts an injected `lz` codec object
- `decodeEnvelope(raw, lz)` — decoder accepts optional codec; plain messages decoded without codec (backward compat)
- `isCompressedEnvelope(obj)` — relay-side classifier, does not require codec
- Design intent: protocol layer stays dependency-free; caller injects lz-string (or any compatible codec) at runtime

**Interoperability:**
- Compressed and plain senders interoperate — required for FSB backward compatibility (noted in `src/protocol/envelope.js` line 8)
- Do NOT replace with stateful per-connection compression (e.g., RFC 7692 `permessage-deflate`) — per-connection state corrupts the multi-viewer fan-out (noted in `reference/extension/ws-client.js` lines 905–906)

---

## Playwright / Chrome DevTools Protocol

**Package surface:**
- `src/adapters/playwright.js` exported at `./adapters/playwright`
- Uses Playwright-like `page.exposeBinding`, `page.addInitScript`, `page.mainFrame`,
  `page.on`, `page.evaluate`, `page.mouse`, and `page.keyboard`
- Optional CDP integration uses `CDPSession.send` for `Page.addScriptToEvaluateOnNewDocument`
  and `Input.dispatchMouseEvent` / `Input.insertText` / `Input.dispatchKeyEvent`

**Security boundary:**
- The adapter is the remote-control authorization boundary, not the relay or viewer UI
- Control starts default-deny and approved replay uses driver-native Playwright/CDP APIs only
- Binding messages are accepted only from the driven page's main frame

---

## Web Platform APIs (Capture, reference only)

Used in `reference/extension/dom-stream.js` (content script context). Not external services, but platform integration points the `src/capture/` extraction must either preserve or abstract.

**DOM / Layout:**
- `document.body.cloneNode(true)` — full snapshot clone
- `document.createTreeWalker` — parallel walk of live and clone trees
- `window.getComputedStyle(el)` — curated computed style capture (~85 properties)
- `el.getBoundingClientRect()` — single pre-pass for viewport-distance truncation
- `document.baseURI` — URL absolutification base

**Observer APIs:**
- `MutationObserver` (childList + attributes + characterData, subtree) — incremental diff source
- `requestAnimationFrame` — diff batch flush cadence (display-matched delivery)

**Dialog interception:**
- Monkey-patches `window.alert`, `window.confirm`, `window.prompt` via injected `<script>` tag
- Fires `CustomEvent('fsb-dialog', ...)` and `CustomEvent('fsb-dialog-dismiss', ...)` on `document`
- Content script listens with `document.addEventListener`

**Canvas capture:**
- `canvas.toDataURL()` — converts `<canvas>` to data-URL `<img>` in snapshot

**Sandbox (renderer, reference only):**
- Dashboard renders snapshot into a sandboxed `<iframe srcdoc="...">` — `reference/dashboard/dashboard.js`
- Remote control: pointer events captured on the iframe overlay, coordinates reverse-mapped to nid-addressed actions

---

## FSB Parent Server REST API (reference only)

Used exclusively by `reference/extension/ws-client.js`. Not relevant to the standalone framework.

- `POST <serverUrl>/api/auth/register` — returns `{ hashKey }` for first-time extension setup
- `GET <serverUrl>/api/session/exchange` (inferred from `dashboard.js` line 1695 `exchangeUrl`) — session token exchange in dashboard

---

## No Cloud Integrations

The following are explicitly absent:
- No database (SQL, NoSQL, or otherwise)
- No object storage (S3, GCS, etc.)
- No auth provider (Auth0, Supabase, Clerk, etc.)
- No error tracking (Sentry, Bugsnag, etc.)
- No analytics
- No CDN
- No message queue

---

*Integration audit: 2026-06-09*
