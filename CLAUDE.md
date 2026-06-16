<!-- GSD:project-start source:PROJECT.md -->
## Project

**PhantomStream**

PhantomStream is DOM-native live browser mirroring: it streams a real browser tab to a remote
viewer as structured DOM data — a one-time style-inlined snapshot plus incremental
MutationObserver diffs addressed by stable node IDs — instead of pixels, with bidirectional
remote control. It was built and shipped inside FSB (Full Self-Browsing) as milestone v0.9.9.1
to power the dashboard's live preview of automated browsing sessions; this repository turns it
into three things at once: **(1)** the SDK FSB plugs back in, **(2)** a published standalone
plug-and-play framework for anything that needs a live, semantically addressable view into a
browser it controls, and **(3)** a full system-track research paper with deep evaluation.

**Core Value:** A live, trustworthy, low-bandwidth, *semantically addressable* mirror of a real browser tab —
if everything else fails, capture → relay → render → remote-control must work end-to-end as a
standalone framework.

### Constraints

- **Tech stack**: Plain JS ESM + JSDoc types, `.d.ts` generated via `tsc` — capture core must
  inject as a plain script into arbitrary contexts (content script, `addInitScript`,
  bookmarklet); no runtime build step for the library itself
- **Compatibility**: Wire protocol should remain backward-compatible with FSB's shipped
  envelope (`{_lz, d}`, session stamping) where practical, so FSB swap-in is low-risk
- **Security**: Published framework renders attacker-influenced HTML in the viewer —
  sanitization on both ends + sandboxed iframe (no `allow-scripts`) is non-negotiable
- **Performance**: Must not regress the encoded lessons (snapshot interactivity on heavy
  pages, single-pass layout reads, paint-cadence diff delivery)
- **Research integrity**: Evaluation must be reproducible — frozen site corpus, scripted
  activity levels, baselines (WebRTC, CDP screencast, rrweb) run under identical conditions
<!-- GSD:project-end -->

<!-- GSD:stack-start source:codebase/STACK.md -->
## Technology Stack

## Languages
- JavaScript (ES2020+) — All source code: `src/protocol/`, `reference/extension/`, `reference/dashboard/`, `reference/server/`, `tests/`, `reference/tests/`
- ES modules (`type: "module"` in `package.json`) — `src/` and `tests/`
- CommonJS (`require`) — `reference/tests/*.test.js` and `reference/server/ws-handler.js`
- Browser IIFE (IIFE `(function(){...})()`) — `reference/extension/dom-stream.js`, `reference/dashboard/dashboard.js`
- Chrome MV3 Service Worker script (concatenated global scope) — `reference/extension/ws-client.js`
## Runtime
- Node.js v24.x — test runner and relay server
- npm (inferred; no lockfile present — `package.json` has no `dependencies` or `devDependencies` entries)
- Lockfile: missing (`node_modules/` absent; no `package-lock.json` or `yarn.lock`)
## Frameworks
- None — `src/protocol/` is a zero-dependency pure-JS module. No framework.
- Node.js built-in test runner (`node:test`) — `tests/protocol.test.js`
- Node.js built-in assertions (`node:assert/strict`) — `tests/protocol.test.js`
- Run command: `node --test tests/*.test.js` (from `package.json` `scripts.test`)
- Node.js built-in `assert` (`require('assert')`) — all six test files
- `require('fs')`, `require('path')`, `require('vm')` — static-analysis style tests that read source files and inspect them with regex
- No build step. Pure source delivery — the `src/protocol/index.js` exports are consumed directly.
- No transpiler (Babel, TypeScript, etc.)
- No bundler (Webpack, Rollup, esbuild, etc.)
- `ws` npm package — WebSocket server in `reference/server/ws-handler.js` (`const WebSocket = require('ws')`)
## Key Dependencies
- None. `package.json` lists no `dependencies`.
- `lz-string` — LZ-string compression library, vendored as `reference/extension/lz-string.min.js` (4.8 KB minified). Used for wire-transport compression. NOT imported via npm — loaded via browser script tag or `importScripts()` in the extension Service Worker (background.js). The `src/protocol/envelope.js` accepts an injected codec rather than importing lz-string directly, keeping the protocol module dependency-free.
- `ws` — WebSocket server library used in `reference/server/ws-handler.js`. This is a dependency of the parent FSB project, not listed in this repo's `package.json`.
## Configuration
- `package.json` — name `@full-self-browsing/phantom-stream`, version `0.1.0`, `"type": "module"`
- Entry point: `src/protocol/index.js` (via `"main"` and `"exports": { "./protocol": ... }`)
- No `.env` files present
- No environment variables required for `src/` — protocol layer is pure logic
- Reference extension requires `serverHashKey` and `serverUrl` stored in `chrome.storage.local` (auto-registered against the FSB relay on first connect)
- No build config files (no `tsconfig.json`, `babel.config.js`, `vite.config.js`, etc.)
- `.gitignore` excludes `node_modules/`, `dist/`, `*.log`, `.DS_Store`
## Platform Requirements
- Node.js 18+ (uses `node:test` and `node:assert/strict` — available since Node 18)
- Tested on Node.js v24.x (confirmed in environment)
- No npm install required to run `tests/protocol.test.js` — zero external dependencies
- Chrome or Chromium — Manifest V3 extension
- APIs used: `chrome.runtime`, `chrome.tabs`, `chrome.storage.local`, `chrome.alarms`, `chrome.scripting`, `chrome.debugger`
- MV3 Service Worker context for `reference/extension/ws-client.js`
- Content script context for `reference/extension/dom-stream.js`
- Node.js — `reference/server/ws-handler.js` runs server-side
- Depends on `ws` package (not in this repo's `package.json`)
- `src/protocol/` — universal: works in any JS runtime (extension content script, service worker, browser, Node) by design (noted in `src/protocol/envelope.js` line 9)
- Planned extraction targets: Chrome extension content script, Playwright/CDP `Page.addScriptToEvaluateOnNewDocument`, bookmarklet, embedded SDK (see `src/capture/README.md`)
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

## Two-Style Codebase
| Zone | Path | Style | Module System |
|------|------|-------|---------------|
| New framework | `src/` | ES modules, named exports, JSDoc | ESM (`export`/`import`) |
| FSB reference | `reference/extension/`, `reference/server/` | IIFE / CommonJS globals, `var` | CJS (`require`) or IIFE |
## Naming Patterns
- Lowercase, hyphen-separated: `constants.js`, `envelope.js`, `messages.js`
- Index barrel files named exactly `index.js`
- Test files: `<module>.test.js` (e.g., `protocol.test.js`)
- `camelCase` for all functions: `encodeEnvelope`, `decodeEnvelope`, `createStreamSessionId`, `isCurrentStream`, `isCompressedEnvelope`
- Boolean predicate functions prefixed `is`: `isCurrentStream`, `isCompressedEnvelope`
- Factory functions prefixed `create`: `createStreamSessionId`
- Encode/decode pairs named symmetrically: `encodeEnvelope` / `decodeEnvelope`
- `camelCase` for local variables and parameters
- `UPPER_SNAKE_CASE` for module-level constants: `RELAY_PER_MESSAGE_LIMIT_BYTES`, `SNAPSHOT_BUDGET_BYTES`, `SCROLL_THROTTLE_MS`, `NID_ATTR`
- Plain `const` for computed derivations: `SNAPSHOT_BUDGET_BYTES = Math.floor(RELAY_PER_MESSAGE_LIMIT_BYTES * SNAPSHOT_BUDGET_FRACTION)`
- Object literals for grouped enum-like constants: `export const CONTROL = { START: '...', STOP: '...' }`, `export const STREAM = { SNAPSHOT: '...', ... }`, `export const DIFF_OP = { ADD: '...', ... }`
- `PascalCase` for typedef names: `LZCodec`, `SnapshotPayload`, `DialogPayload`
## Code Style
- No formatter config file detected (no `.prettierrc`, `biome.json`, `.eslintrc`)
- Observed style: 2-space indentation, single quotes, no trailing commas in function signatures
- `var` is used in `envelope.js` (new framework) for cross-runtime compatibility — intentional, not a mistake
- `const`/`let` used in `reference/server/ws-handler.js` (Node.js target)
- No linting config detected
## Module System
- Pure ES modules: `export const`, `export function`, `export *`
- Explicit `.js` extensions on all relative imports (required for native ESM): `import { ... } from './constants.js'`
- Barrel `index.js` re-exports everything: `export * from './constants.js'; export * from './messages.js'; export * from './envelope.js'`
- Package `exports` field maps subpath to module: `"./protocol": "./src/protocol/index.js"`
- Extension content scripts: IIFEs with `window.FSB` namespace attachment
- Service worker: `var` globals (no `import`/`export`) loaded by Chrome MV3
- Server: CommonJS `require`/`module.exports`
## Import Organization
## Dependency Philosophy
## Error Handling
- Functions that can fail return discriminated union objects: `{ok: true, msg}` or `{ok: false, error: string}`
- Error strings are lowercase, hyphen-separated identifiers: `'json-parse-failed'`, `'decompress-unavailable'`, `'decompress-failed'`, `'inner-json-parse-failed'`
- No exceptions thrown from protocol functions — callers always check `.ok`
- `try/catch` blocks with console logging (`logger.error(...)`)
- Early-return guards: `if (!url || typeof url !== 'string') return true`
## Comments
- Plain `//` comment at top of file stating what the file is, where it was extracted from, and any compatibility notes
- All exported functions have JSDoc blocks with `@param`, `@returns`, and inline commentary on design constraints
- `@typedef` blocks describe payload shapes rather than separate type files
- Numeric literals always have a comment explaining units and derivation: `1048576; // 1 MiB`
- Phase references in comments link constants to the FSB phase that introduced them: `// Phase 211-02`, `// FSB Phase 122.3 backward-compatibility requirement`
- Thematically related constants grouped with a blank line and a short prose comment above the group
## Function Design
- Optional parameters use `||` defaulting inline, not destructuring defaults (for cross-runtime compat): `var threshold = thresholdBytes || 0`
- Return discriminated unions for fallible operations
- Return plain primitives/objects for infallible operations
## Module Design
- Named exports only, no default exports in `src/`
- Constants exported as `const` objects (not frozen, but treated as immutable by convention)
- Barrel `index.js` re-exports all named exports from sub-modules
## Wire Protocol String Conventions
- `'ext:...'` — capture host → viewer messages
- `'dash:...'` — viewer → capture host messages
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

## System Overview
```text
```
## Four-Stage Pipeline
### Stage 1: Capture (`reference/extension/dom-stream.js`)
- **Snapshot** (`serializeDOM`) — clones `document.body`, walks original + clone in
- **Truncation** — performs a single read-pass over the live DOM to build a `Map` of
- **Incremental diffs** (`MutationObserver` on `document.body`) — batches mutations and
- **Watchdog #1** — a 500 ms `setTimeout` chain (not `setInterval`) that force-flushes a
- **Side channels** — scroll (throttled 200 ms), overlay state (throttled 500 ms), native
- **Lifecycle messages** received from background: `domStreamStart`, `domStreamStop`,
- **Module registration** — on load, sends `domStreamReady` to background; registers
- `streaming: boolean` — whether observers are active
- `streamSessionId: string` — minted by `beginStreamSession()` as `stream_<ts36>_<rand>`
- `currentSnapshotId: number` — `Date.now()` at session start
- `nextNodeId: number` — monotonically increasing counter reset per snapshot
- `pendingMutations: MutationRecord[]` — accumulated since last rAF flush
- `watchdogTimer: TimeoutId` — content-script self-watchdog
### Stage 2: Transport / Host (`reference/extension/ws-client.js` + `reference/extension/background.dom-stream-relay.excerpt.js`)
- Receives `chrome.runtime.sendMessage` calls from the content script.
- Arms the `chrome.alarms` watchdog on every mutation dispatch.
- Forwards snapshot, mutations, scroll, overlay, dialog payloads to the relay server via
- On `domStreamReady`, calls `_onDomStreamReady` to re-arm any parked pending intent.
- Maintains a persistent WebSocket to the relay server with 20 s keepalive pings and
- **Compression** — payloads > 1 KB are LZ-string compressed; only if compressed < raw.
- **Inbound message routing** (`_handleMessage`) — switches on `msg.type`:
- `chrome.alarms` alarm named `fsb-domstream-watchdog` at 1-minute period.
- On fire, sends `ext:request-snapshot` to the dashboard if `_streamingActive` is true.
- Survives MV3 service-worker eviction.
### Stage 3: Relay (`reference/server/ws-handler.js`)
- **Room model** — `rooms: Map<hashKey, { extensions: Set<ws>, dashboards: Set<ws> }>`.
- **Fan-out** (`relayToRoom`) — raw message bytes are forwarded verbatim from extension to
- **Per-message cap** — 1 MiB (`RELAY_PER_MESSAGE_LIMIT_BYTES`). Oversized messages are
- **Backpressure drop** — if `client.bufferedAmount > 16 MiB`, the frame is dropped and
- **Connection lifecycle** — on extension connect, broadcasts `ext:status { online: true }`
- **Diagnostics** — per-room ring buffer of 100 events (`receivedByType`, `deliveredByType`,
### Stage 4: Renderer (`reference/dashboard/dashboard.js`)
- **Snapshot render** (`handleDOMSnapshot`):
- **Diff apply** (`handleDOMMutations`):
- **Layout modes**: `inline`, `maximized`, `pip` (drag-to-reposition), `fullscreen`
- **Overlays**: glow rect (action highlight), progress card, dialog cards — positioned in
- **Remote control**: pointer/keyboard/scroll events on the preview iframe are captured,
- **State machine** (`previewState`): `hidden | loading | streaming | disconnected |
## Reverse Remote-Control Path
```text
```
## Target Framework Architecture (`src/`)
### Implemented: `src/protocol/`
| File | Exports |
|------|---------|
| `src/protocol/constants.js` | Numeric constants: `RELAY_PER_MESSAGE_LIMIT_BYTES`, `SNAPSHOT_BUDGET_BYTES`, throttle values, watchdog intervals |
| `src/protocol/messages.js` | Message type namespaces (`CONTROL`, `STREAM`, `DIFF_OP`), `NID_ATTR`, `SnapshotPayload` typedef, `createStreamSessionId()`, `isCurrentStream()` |
| `src/protocol/envelope.js` | `encodeEnvelope()`, `decodeEnvelope()`, `isCompressedEnvelope()` — LZ codec injected by caller |
| `src/protocol/index.js` | Re-exports all of the above |
### Planned: `src/capture/`
- `Transport` interface (`send(type, payload)`) to replace `chrome.runtime.sendMessage`
- Options object `{ logger, overlayProvider, skipElement(el) }` to replace `window.FSB`
### Planned: `src/relay/`
### Planned: `src/renderer/`
## Component Responsibilities
| Component | Responsibility | File |
|-----------|----------------|------|
| Capture | Snapshot + diffs + side channels | `reference/extension/dom-stream.js` |
| Transport host | SW relay, compression, remote-control CDP | `reference/extension/ws-client.js` |
| Background relay | content-script → WS forwarding, watchdog #2 arm | `reference/extension/background.dom-stream-relay.excerpt.js` |
| SW watchdog alarm | Safety net for wedged content script | `reference/extension/background.watchdog-alarm.excerpt.js` |
| LZ-string codec | Compression library (vendored) | `reference/extension/lz-string.min.js` |
| Relay server | WS fan-out, size cap, backpressure drop | `reference/server/ws-handler.js` |
| Renderer/viewer | Snapshot render, diff apply, overlays, RC | `reference/dashboard/dashboard.js` |
| Protocol constants | Shared numeric constants | `src/protocol/constants.js` |
| Protocol messages | Wire types, nid attr, session ID, staleness guard | `src/protocol/messages.js` |
| Protocol envelope | LZ encode/decode | `src/protocol/envelope.js` |
## Data Flow
### Forward Path (Capture → Viewer)
### Session Start Path
### Recovery Path (Watchdog)
## Key Abstractions
- Attribute stamped on every captured element by `assignNodeId()` in the content script
- Applied to both the live DOM element and the serialized clone in parallel
- Every diff op, overlay rect coordinate, and remote-control action addresses nodes by nid
- `NID_ATTR = 'data-fsb-nid'` in `src/protocol/messages.js`
- Known limitation: visible to the page's own selectors/observers (WeakMap scheme deferred)
- Self-identifying: `{ _lz: true, d: "<base64>" }` — receivers detect by shape
- Stateless per-frame (no sliding window) — bad frame cannot corrupt subsequent frames
- Threshold: > 1 KB in the extension SW; threshold configurable in `encodeEnvelope()`
- ~90%+ reduction on 100 KB+ snapshots
- `src/protocol/envelope.js` is the canonical implementation
- `streamSessionId = 'stream_<ts36>_<rand>'` minted per session by `beginStreamSession()`
- `snapshotId = Date.now()` minted per snapshot
- Both stamped on every message type
- `isCurrentStream(msg, active)` in `src/protocol/messages.js` is the staleness guard
- Viewer rejects messages with mismatched identity — prevents late diffs from prior page
- Each `hashKey` (QR-pair secret) identifies a room with one `extensions` Set and one
- Messages relay verbatim (raw bytes forwarded, no deserialization at relay layer)
- Multi-viewer fan-out is architecturally free — dashboards is a Set, not a single ref
## Entry Points
- Invoked by `_handleDashboardStreamStart` → `_forwardToContentScript('domStreamStart')`
- Triggers: `beginStreamSession`, `serializeDOM`, `startMutationStream`, `startScrollTracker`
- On load, sends `domStreamReady` to background
- Background re-arms any `_pendingStreamStart` payload parked during the readiness probe
- Triggered by background.js initialization
- Auto-registers with server if no `serverHashKey` in `chrome.storage.local`
- Called after upgrade authentication in server.js
- Parameters `{ hashKey, role }` set by server-side auth before connection reaches handler
- ESM entry point for the standalone framework
- Exported at `package.json` `"./protocol"` path
## Architectural Constraints
- **Threading:** Single-threaded event loop at each stage. Content script runs in the tab
- **MV3 constraints:** Service worker can be evicted at any time; all persistent state is
- **Compression:** LZ-string is stateless per-frame by design. Do NOT replace with
- **Size cap:** `RELAY_PER_MESSAGE_LIMIT_BYTES = 1048576` (1 MiB) is a protocol constant
- **Global state in reference:** `dom-stream.js` uses IIFE module scope; `ws-client.js`
- **nid stamping mutates the observed page:** `data-fsb-nid` is visible to page selectors;
## Anti-Patterns
### Computed styles on added nodes
### `on*` attribute sanitization gap
## Error Handling
- Content script: catch blocks around all `chrome.*` APIs; extension context invalidation
- WS client: `recordFSBTransportFailure` accumulates a bounded ring buffer of failures
- Relay server: per-room diagnostic ring buffer (100 events) at `roomDiagnostics`; errors
- Dashboard: `recordDashboardTransportEvent` / `recordDashboardTransportError` ring buffer;
## Cross-Cutting Concerns
<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->
## Project Skills

No project skills found. Add skills to any of: `.claude/skills/`, `.agents/skills/`, `.cursor/skills/`, `.github/skills/`, or `.codex/skills/` with a `SKILL.md` index file.
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->



<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
