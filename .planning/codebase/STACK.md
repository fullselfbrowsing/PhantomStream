# Technology Stack

**Analysis Date:** 2026-06-09

## Languages

**Primary:**
- JavaScript (ES2020+) — All source code: `src/protocol/`, `reference/extension/`, `reference/dashboard/`, `reference/server/`, `tests/`, `reference/tests/`

**Dialects/contexts:**
- ES modules (`type: "module"` in `package.json`) — `src/` and `tests/`
- CommonJS (`require`) — `reference/tests/*.test.js` and `reference/server/ws-handler.js`
- Browser IIFE (IIFE `(function(){...})()`) — `reference/extension/dom-stream.js`, `reference/dashboard/dashboard.js`
- Chrome MV3 Service Worker script (concatenated global scope) — `reference/extension/ws-client.js`

## Runtime

**Environment:**
- Node.js v24.x — test runner and relay server

**Package Manager:**
- npm (inferred; no lockfile present — `package.json` has no `dependencies` or `devDependencies` entries)
- Lockfile: missing (`node_modules/` absent; no `package-lock.json` or `yarn.lock`)

## Frameworks

**Core:**
- None — `src/protocol/` is a zero-dependency pure-JS module. No framework.

**Testing (standalone `src/`):**
- Node.js built-in test runner (`node:test`) — `tests/protocol.test.js`
- Node.js built-in assertions (`node:assert/strict`) — `tests/protocol.test.js`
- Run command: `node --test tests/*.test.js` (from `package.json` `scripts.test`)

**Testing (reference `reference/tests/`):**
- Node.js built-in `assert` (`require('assert')`) — all six test files
- `require('fs')`, `require('path')`, `require('vm')` — static-analysis style tests that read source files and inspect them with regex

**Build/Dev:**
- No build step. Pure source delivery — the `src/protocol/index.js` exports are consumed directly.
- No transpiler (Babel, TypeScript, etc.)
- No bundler (Webpack, Rollup, esbuild, etc.)

**Server-side (reference only):**
- `ws` npm package — WebSocket server in `reference/server/ws-handler.js` (`const WebSocket = require('ws')`)

## Key Dependencies

**Runtime (src/ standalone framework):**
- None. `package.json` lists no `dependencies`.

**LZ-string (reference, vendored):**
- `lz-string` — LZ-string compression library, vendored as `reference/extension/lz-string.min.js` (4.8 KB minified). Used for wire-transport compression. NOT imported via npm — loaded via browser script tag or `importScripts()` in the extension Service Worker (background.js). The `src/protocol/envelope.js` accepts an injected codec rather than importing lz-string directly, keeping the protocol module dependency-free.

**Server (reference only):**
- `ws` — WebSocket server library used in `reference/server/ws-handler.js`. This is a dependency of the parent FSB project, not listed in this repo's `package.json`.

## Configuration

**Package:**
- `package.json` — name `@fullselfbrowsing/phantom-stream`, version `0.1.0`, `"type": "module"`
- Entry point: `src/protocol/index.js` (via `"main"` and `"exports": { "./protocol": ... }`)

**Environment:**
- No `.env` files present
- No environment variables required for `src/` — protocol layer is pure logic
- Reference extension requires `serverHashKey` and `serverUrl` stored in `chrome.storage.local` (auto-registered against the FSB relay on first connect)

**Build:**
- No build config files (no `tsconfig.json`, `babel.config.js`, `vite.config.js`, etc.)
- `.gitignore` excludes `node_modules/`, `dist/`, `*.log`, `.DS_Store`

## Platform Requirements

**Development:**
- Node.js 18+ (uses `node:test` and `node:assert/strict` — available since Node 18)
- Tested on Node.js v24.x (confirmed in environment)
- No npm install required to run `tests/protocol.test.js` — zero external dependencies

**Reference extension (capture/transport):**
- Chrome or Chromium — Manifest V3 extension
- APIs used: `chrome.runtime`, `chrome.tabs`, `chrome.storage.local`, `chrome.alarms`, `chrome.scripting`, `chrome.debugger`
- MV3 Service Worker context for `reference/extension/ws-client.js`
- Content script context for `reference/extension/dom-stream.js`

**Reference server (relay):**
- Node.js — `reference/server/ws-handler.js` runs server-side
- Depends on `ws` package (not in this repo's `package.json`)

**Production (future framework):**
- `src/protocol/` — universal: works in any JS runtime (extension content script, service worker, browser, Node) by design (noted in `src/protocol/envelope.js` line 9)
- Planned extraction targets: Chrome extension content script, Playwright/CDP `Page.addScriptToEvaluateOnNewDocument`, bookmarklet, embedded SDK (see `src/capture/README.md`)

---

*Stack analysis: 2026-06-09*
