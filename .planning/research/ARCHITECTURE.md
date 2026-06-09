# Architecture Research

**Domain:** Multi-context browser SDK — DOM-native live mirroring framework (capture / relay / renderer + host adapters)
**Researched:** 2026-06-09
**Confidence:** HIGH (package-structure and API facts verified against official repos/docs; recommendations are opinionated synthesis)

## How Comparable SDKs Are Structured (Survey)

### rrweb — monorepo, three-way concern split

rrweb is a Yarn-workspaces + Turbo monorepo with ~14 packages. The load-bearing split is
**snapshot / record+replay / player UI**:

| Package | Concern | PhantomStream analogue |
|---------|---------|------------------------|
| `rrweb-snapshot` | DOM ⇄ serializable structure with stable IDs | `src/capture/serializer.js` |
| `rrweb` (v2: `record`, `replay` split into `@rrweb/record`, `@rrweb/replay`) | MutationObserver recording; replayer | `src/capture/differ.js` + `src/renderer/` |
| `rrweb-player` | Player UI wrapping the replayer | viewer chrome (layout modes, overlays) |
| `rrdom` / `rrdom-nodejs` | Virtual DOM for replay incl. headless Node | (no analogue needed in v1) |
| `types`, `utils`, `packer` | Shared types, utils, compression | `src/protocol/` |
| `plugins`, `web-extension` | Extensions/adapters | `src/adapters/*` |

Key takeaways: (a) the *serializer* is its own unit below record/replay — both sides depend
on it; (b) v2 splits record from replay so capture-only consumers don't ship replay code;
(c) compression (`packer`) is a separate injectable concern — exactly PhantomStream's
"LZ codec injected by caller" decision in `src/protocol/envelope.js`.

### PostHog — monorepo of *host* packages; recorder as a lazy/optional entry

`posthog-js` is a pnpm + Turbo monorepo whose packages are split **per host runtime**
(`browser`, `node`, `react-native`, `react`, `nuxt`, `nextjs-config`…), not per pipeline
stage. The session recorder (their rrweb wrapper) lives *inside* the browser package but is
**lazy-loaded at runtime by default**, with an opt-in bundled entry
(`import "posthog-js/dist/recorder"`) for consumers who want it in their bundle. The
recorder is therefore an *artifact* with two delivery modes (remote script vs. bundled
subpath), not a separate npm package.

### Replay.io — adapter-per-package, protocol as standalone package

Replay.io records at the browser-runtime level (forked browsers), so their npm surface is
pure adapters: `@replayio/node`, `@replayio/playwright`, `@replayio/puppeteer`,
`@replayio/cypress`, `@replayio/replay-cli`, with the **wire protocol published as its own
package/repo** (`replayio/protocol` — TypeScript + JSON definitions). Takeaway: when the
core is stable, the protocol definition is the most aggressively isolated unit, and host
adapters are the public product surface.

### Verdict for PhantomStream: single package + subpath exports, not a monorepo

The monorepos above exist to solve problems PhantomStream doesn't have: TypeScript build
orchestration across packages (rrweb), per-runtime dependency trees (PostHog has React
Native deps that browser must never see), independent release cadences. PhantomStream is
**plain ESM, dependency-free, no build step** — a monorepo would add Turbo/workspace
ceremony with zero payoff. Modern `package.json` `"exports"` subpaths give the same
"import only what you need" consumer experience, and ESM + `"sideEffects": false` makes
micro-packages-for-tree-shaking obsolete.

**Recommended exports map** for `@fullselfbrowsing/phantom-stream`:

```jsonc
{
  "name": "@fullselfbrowsing/phantom-stream",
  "type": "module",
  "sideEffects": false,
  "exports": {
    ".":                    "./src/index.js",           // re-exports, convenience
    "./protocol":           "./src/protocol/index.js",  // already shipped
    "./capture":            "./src/capture/index.js",
    "./renderer":           "./src/renderer/index.js",
    "./relay":              { "node": "./src/relay/index.js" },          // node-only guard
    "./relay/backends/ws":  { "node": "./src/relay/backends/ws.js" },
    "./adapters/extension":  "./src/adapters/extension/index.js",
    "./adapters/playwright": { "node": "./src/adapters/playwright/index.js" },
    "./adapters/cdp":        { "node": "./src/adapters/cdp/index.js" },
    "./adapters/embedded":   "./src/adapters/embedded/index.js",
    "./capture.inject.js":   "./dist/capture.inject.js"  // prebuilt injectable artifact
  },
  "bin": { "phantom-stream": "./bin/phantom-stream.js" }
}
```

Conditional (`"node"`) exports keep node-only code (relay's `ws` backend, Playwright/CDP
adapters) from ever resolving in browser bundles — this is how a single package safely
spans browser + node contexts. `ws` should be a regular dependency only if the CLI needs
it out-of-the-box (it does, for `npx phantom-stream demo`); the relay *core* must accept
any injected backend so it stays dependency-free.

**One necessary exception to "no build step": the injectable capture artifact.**
Playwright `addInitScript({ path })`, CDP `Page.addScriptToEvaluateOnNewDocument`, and
bookmarklets all need capture as a **single self-contained classic script** — multi-file
ESM with imports cannot be injected as a string. PostHog solves this with a prebuilt
`recorder.js` artifact. Recommendation: generate `dist/capture.inject.js` (capture core +
protocol inlined, IIFE, exposing `globalThis.__phantomCapture`) with esbuild **at publish
time only**. The library sources stay build-free; the artifact is a release output, same
category as the generated `.d.ts`. This is consistent with PROJECT.md's "no *runtime*
build step."

## Standard Architecture

### System Overview

```
                         ┌─────────────────────────────────────────────────┐
  CAPTURE SIDE           │              HOST ADAPTERS (own all host APIs)   │
  (page context)         │  extension-mv3   playwright    cdp    embedded  │
                         │  content script  addInitScript Runtime.  same-  │
┌──────────────────────┐ │  + SW forwarder  +exposeBinding addBinding page │
│  capture core        │ └───────┬──────────────┬──────────┬─────────┬────┘
│  serializer/differ/  │─emit──▶ │ Transport.send(type, payload)     │
│  side-channels/      │◀─ctrl── │ controller.{start,stop,pause,…}   │
│  session             │         └──────────────┬────────────────────┘
└──────────────────────┘                        │  envelope (LZ, session-stamped)
         uses ▲                                 ▼
┌──────────────────────┐         ┌─────────────────────────────────┐
│  protocol (DONE)     │◀──uses──│  relay core (runtime-agnostic)  │
│  messages/envelope/  │         │  routing + limits + staleness   │
│  constants           │         │  backends/ws.js (reference)     │
└──────────────────────┘         └──────────────┬──────────────────┘
         uses ▼                                 │  fan-out to N viewers
┌──────────────────────┐                        ▼
│  renderer core       │◀──viewer transport (ws reference impl)
│  snapshot-renderer/  │   createViewer({ container, transport })
│  diff-applier/       │   owns sandboxed iframe (no allow-scripts)
│  overlays/layout/    │──remote-control events──▶ relay ──▶ adapter ──▶ CDP/host
│  remote-control      │
└──────────────────────┘
  SUPPORTING:  bin/phantom-stream.js (CLI: demo, relay)   examples/   bench/ (private ws)
```

### Component Responsibilities

| Component | Responsibility | Typical Implementation |
|-----------|----------------|------------------------|
| `protocol` | Wire types, envelope codec, constants, session identity, staleness guard | Done — dependency-free ESM, the "replayio/protocol" of this system |
| `capture` core | Snapshot, rAF diffing, side channels, watchdog #1 — **zero host APIs** | rrweb-style: core emits through injected transport, returns controller |
| Host adapters | Everything host-specific: injection, message bridging, remote-control *execution*, watchdog #2 | One module per context; the only code allowed to touch `chrome.*`, Playwright, CDP |
| `relay` core | Room routing, per-message cap, backpressure, diagnostics, staleness rejection | Pure functions + injected backend (Sentry-transport-style) |
| `relay/backends/ws` | Reference WebSocket backend | Node `ws`, behavior ported from `reference/server/ws-handler.js` |
| `renderer` core | Sandboxed-iframe reconstruction, diff apply + miss accounting, overlays, layout modes, RC capture | Plain factory + mount element (rrweb-player convention, no web component) |
| Viewer transport | WS client for the viewer side | Small reference impl; same `Transport` contract as capture side |
| CLI (`bin/`) | `demo` (relay + static pages + URLs), `relay` (standalone server) | Hand-rolled argv switch, shebang file; minimal deps so `npx` is fast |
| `bench/` | Paper evaluation + perf regression suite | Private npm workspace, never published; heavy deps allowed |

## Recommended Project Structure

```
src/
├── protocol/            # DONE — leaf module, single source of truth for wire format
├── capture/
│   ├── serializer.js    # snapshot + style capture + truncation (no host APIs)
│   ├── differ.js        # MutationObserver batching, op generation, watchdog #1
│   ├── side-channels.js # scroll, overlay, dialog interception
│   ├── session.js       # session lifecycle, identity minting
│   └── index.js         # createCapture({ transport, ...options }) -> controller
├── relay/
│   ├── relay.js         # routing: capture host <-> N viewers (pure, backend-agnostic)
│   ├── limits.js        # size cap + oversize classification (envelope-aware)
│   ├── backends/ws.js   # reference WebSocket backend (node-only export condition)
│   └── index.js         # createRelay({ backend, limits })
├── renderer/
│   ├── snapshot-renderer.js  # doc rebuild -> iframe.srcdoc, sandbox enforcement
│   ├── diff-applier.js       # nid-addressed ops + miss accounting -> health signal
│   ├── overlays.js / layout.js / remote-control.js
│   └── index.js         # createViewer({ container, transport }) -> { attach, detach }
├── adapters/
│   ├── extension/       # MV3: content-script transport + SW forwarder + alarms watchdog
│   ├── playwright/      # addInitScript + exposeBinding wiring (node-only)
│   ├── cdp/             # addScriptToEvaluateOnNewDocument + Runtime.addBinding (node-only)
│   └── embedded/        # same-page SDK: direct transport (loopback or WebSocket)
├── transports/
│   └── ws-client.js     # browser WebSocket Transport impl (capture + viewer reuse)
└── index.js
bin/phantom-stream.js    # CLI: demo | relay subcommands
dist/capture.inject.js   # publish-time esbuild artifact (capture+protocol, IIFE)
examples/                # NOT published: two-tab walkthrough, playwright script, bookmarklet
bench/                   # private workspace: corpus, baselines (rrweb/CDP/WebRTC), runners
```

### Structure Rationale

- **`adapters/` separate from `capture/`:** the capture core must pass a grep test — zero
  occurrences of `chrome.`, `window.FSB`, or any host global. Adapters are the only
  host-API surface. This is the boundary that makes "runs in any injection context" true.
- **`transports/` separate from `adapters/`:** a transport moves bytes (`send`); an adapter
  also owns lifecycle (inject, start, watchdogs, remote-control execution). The extension
  adapter *composes* a chrome-runtime transport; the embedded adapter composes the ws-client
  transport. Keeping them apart lets the viewer reuse `ws-client.js`.
- **`bench/` as a private workspace, not a package:** mirrors ecosystem practice (rrweb
  keeps benchmark fixtures out of the published packages; highlight.io's session-replay
  benchmark is a standalone repo; react-redux-benchmarks is a separate harness). In-repo
  placement is preferable here because the harness doubles as the regression suite and must
  pin the framework via a workspace link for reproducibility. Root `package.json` gains
  `"workspaces": ["bench"]` — a two-entry workspace, not a monorepo toolchain.

## Architectural Patterns

### Pattern 1: Emit-only capture core + adapter-owned control plane (rrweb/Sentry hybrid)

**What:** Capture core never listens for inbound messages. Outbound: a single injected
`Transport` funnel. Inbound: core returns a controller object; the adapter translates host
messages into controller calls.

**When to use:** Always, for code that must run in arbitrary injection contexts.

**Trade-offs:** Adapters carry slightly more code (message routing), but the core has zero
knowledge of `chrome.runtime.onMessage` vs. CDP bindings vs. postMessage — which is the
whole point.

**Example:**
```javascript
// Contract (JSDoc-typed in src/capture/index.js)
/** @typedef {{ send(type: string, payload: object): void }} Transport */

const controller = createCapture({
  transport,                      // rrweb's emit(), Sentry's transport.send() — same idea
  logger,                         // replaces window.FSB.logger
  skipElement: (el) => false,     // replaces FSB-UI exclusion
});
controller.start(); controller.pause(); controller.snapshot(); controller.stop();

// Extension adapter routes inbound -> controller (core never sees chrome.*)
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === 'domStreamStart') controller.start(msg);
  if (msg.action === 'domStreamStop')  controller.stop();
});
```

Precedents: rrweb's `record({ emit(event) }) -> stopFn` (host owns transport entirely);
Sentry's `Transport { send(envelope): Promise, flush(timeout): Promise<boolean> }` injected
via init. Recommend adding Sentry's `flush()` to the contract — the MV3 adapter needs it to
drain before service-worker eviction.

### Pattern 2: Hub-and-spoke context bridging in the extension adapter (webext-bridge model)

**What:** In MV3, the background SW is the staging hub; page context (MAIN world) cannot
talk to it directly. The established pattern (webext-bridge): page ↔ content script via
`window.postMessage`/`CustomEvent` gated by an explicit namespace, content script ↔ SW via
`chrome.runtime` messaging, SW ↔ network via WebSocket.

**When to use:** Extension adapter only. PhantomStream's capture runs in the content-script
world (ISOLATED), so the page↔content-script hop is needed only for the dialog
monkey-patch (already a `CustomEvent` bridge in the reference) — keep that mechanism,
namespace the event names with the session ID to prevent page spoofing.

**Trade-offs:** Every hop is JSON-serialization; never bridge per-mutation traffic through
extra hops — only the dialog side channel crosses the page→content-script boundary.

### Pattern 3: Adapter injection via init-script + binding (Playwright / CDP)

**What:** The standard pair for "inject code that runs before page scripts, and give it a
callback into the driver":

- **Playwright:** `context.addInitScript({ path: 'dist/capture.inject.js' })` — runs after
  document creation, before page scripts, **re-runs on every navigation** (free
  re-snapshot-on-nav). `context.exposeBinding('__phantomSend', (source, type, payload) => …)`
  — installs `window.__phantomSend`, callback runs in Node, **survives navigations**,
  arguments must be JSON-serializable. The injected capture's `Transport.send` is literally
  `(type, payload) => window.__phantomSend(type, payload)`.
- **Raw CDP:** `Page.addScriptToEvaluateOnNewDocument` (with optional `worldName` for an
  isolated world) + `Runtime.addBinding` (exposed even to execution contexts created
  later; can be scoped to the same `worldName`). Page→Node payloads arrive as
  `Runtime.bindingCalled` events carrying a **string** — pass the already-stringified
  envelope. Node→page control via `Runtime.evaluate`.
- Playwright's `exposeBinding` is built on `Runtime.addBinding`; prefer the Playwright
  adapter for ergonomics, keep the raw-CDP adapter for non-Playwright drivers (FSB's own
  `chrome.debugger` path, Puppeteer users).

**Trade-offs:** Isolated world (`worldName`) protects capture from page globals but the
dialog monkey-patch must still reach the MAIN world; remote control in these adapters
should use driver-native input (Playwright `page.mouse/keyboard` or CDP
`Input.dispatchMouseEvent`) — never synthetic DOM events.

**Example:**
```javascript
// src/adapters/playwright/index.js
export async function attachPhantomStream(context, { relayUrl, session }) {
  const client = createRelayClient(relayUrl, session);           // node-side ws
  await context.exposeBinding('__phantomSend', (_src, type, payload) =>
    client.send(type, payload));
  await context.addInitScript({ path: phantomInjectPath });       // dist/capture.inject.js
  await context.addInitScript((cfg) =>
    globalThis.__phantomCapture.start({ ...cfg }), { session });  // auto-start per nav
  client.onControl((msg) => dispatchRemoteControl(context, msg)); // RC via page.mouse etc.
}
```

### Pattern 4: Plain factory + mount element for the viewer (NOT a web component)

**What:** Every comparable renderer embeds as a plain constructor/factory taking a mount
element: rrweb `new Replayer(events, { root, liveMode })` builds its own iframe inside
`root`; `new rrwebPlayer({ target, props })`; PostHog embeds the Replayer inside its own
React app rather than shipping a web component. None of the surveyed systems use custom
elements.

**When to use:** `createViewer({ container, transport }) -> { attach, detach }` (the
planned API) is exactly the ecosystem convention — keep it. Framework wrappers (React/Vue)
can be added later as 20-line thin layers if demand exists.

**Trade-offs:** Web components would give style encapsulation but add custom-element
registry conflicts, SSR headaches, and framework-wrapper friction — and the mirror content
is already isolated in an iframe, which is the encapsulation that matters.

**Sandbox specifics:** viewer creates `<iframe sandbox="allow-same-origin">` and writes
`srcdoc`. `allow-same-origin` is required so the parent can reach `contentDocument` for
diff apply; `allow-scripts` must never be added (rrweb's replayer is likewise
script-sandboxed by default — its `UNSAFE_replayCanvas` option exists precisely because
enabling it "opts out of the sandbox script-execution protection"). Belt-and-suspenders:
sanitize `on*`/`javascript:` at capture AND at render, so neither end trusts the other.

### Pattern 5: `npx <pkg> demo` via a single bin with subcommands

**What:** `"bin": { "phantom-stream": "./bin/phantom-stream.js" }` with a shebang
(`#!/usr/bin/env node`) and a hand-rolled `process.argv[2]` switch (`demo`, `relay`).
`npx phantom-stream demo` then: starts the bundled relay (ws backend), serves two static
pages (a demo capture page with the embedded adapter + a viewer page) over `node:http`,
prints both URLs, optionally `open`s them.

**When to use:** This is the standard npm CLI convention (npx runs the package's bin).
Precedents for tool-style subcommands: `npx playwright codegen`, `npx serve`.

**Trade-offs:** Everything the demo serves must be inside the published tarball — the
`files` whitelist must include `bin/`, `src/`, `dist/capture.inject.js`, and a small
`demo-assets/` dir, while `examples/` and `bench/` stay unpublished. Keep CLI dependencies
to `ws` only so `npx` cold-start is fast. The Playwright demo cannot live in the bin
(playwright is too heavy to be a dependency) — it lives in `examples/playwright/` with its
own `package.json`, and the CLI prints a pointer to it.

## Data Flow

### Forward Path (capture → viewer) — unchanged semantics, new boundaries

```
page DOM mutates
  → capture core: MutationObserver batch → rAF flush → ops by nid
  → Transport.send('stream:mutations', payload)            [boundary 1: DI seam]
  → adapter: envelope encode (LZ >1KB), session stamp, host hop
      (extension: cs → SW → ws | playwright: binding → node ws | embedded: direct)
  → relay core: staleness check, size cap, room fan-out      [boundary 2: bytes only]
  → viewer transport: ws.onmessage → envelope decode
  → renderer core: isCurrentStream guard → diff-applier → iframe contentDocument
```

### Reverse Path (viewer → page) — remote control is an *adapter capability*

```
pointer event on mirror
  → renderer remote-control.js: coordinate reverse-map → transport.send('ctl:remote-click')
  → relay (room route to capture host)
  → adapter executes with host-native input:
      extension: chrome.debugger Input.dispatchMouseEvent
      playwright: page.mouse.click / Input.* via CDP session
      embedded:  capability absent → advertise { remoteControl: false } in session hello
```

Remote-control execution must live in adapters, never in capture core — the core has no
authority to dispatch trusted input in any context. Adapters advertise a capability map in
the session-start message so the viewer can grey out controls honestly.

### Key Data Flows

1. **Session start:** viewer `ctl:stream-start` → relay → adapter (inject if needed, probe
   readiness, parked-intent re-arm) → `controller.start()` → snapshot → viewer renders
   `srcdoc`. The readiness-probe/parked-intent dance is *extension-adapter-specific*; in
   Playwright the init script makes readiness deterministic.
2. **Recovery:** watchdog #1 (core, host-agnostic `setTimeout` chain) stays in capture;
   watchdog #2 (`chrome.alarms`) is extension-adapter-only — Playwright/embedded adapters
   substitute a node-side or page-side interval. Watchdog placement is an adapter contract:
   "host must arm a liveness check," mechanism unspecified.
3. **Staleness:** `isCurrentStream` enforced at **both** relay (drop early, save bandwidth)
   and renderer (final authority) — protocol module already exports the guard.

## Suggested Build Order

Dependency-driven; each step ends runnable/testable:

1. **`protocol/`** — done. Leaf; everything imports it.
2. **`capture/` core** — extract with a loopback transport (array-collecting `send`);
   unit-test serializer/differ against fixture DOMs. No adapter needed to test.
3. **`renderer/` core** — consumes recorded loopback fixtures from step 2; verify
   snapshot render + diff apply in a test page. (Capture and renderer can proceed in
   parallel after 2's message shapes stabilize — but fixtures from real capture de-risk it.)
4. **`adapters/embedded` (loopback)** — capture and viewer in the same page, direct
   transport, no relay. **First end-to-end proof, zero infrastructure**, and it *is* the
   embedded-SDK deliverable.
5. **`relay/` core + ws backend + `transports/ws-client.js`** — pure node tests for
   routing/limits; then wire capture-page → relay → viewer-page.
6. **CLI + two-tab demo** (`npx phantom-stream demo`) — packages step 5 into the
   plug-and-play proof; forces the `files`/exports/bin packaging decisions early.
7. **`adapters/playwright` + `adapters/cdp`** — requires the `dist/capture.inject.js`
   publish-time artifact (introduce esbuild dev-dependency here); ship the
   Playwright-driven demo with remote control.
8. **`adapters/extension` (MV3)** — closest to the reference; port forwarder, alarms
   watchdog, readiness probe. This is the FSB swap-in surface — verify against FSB after
   the package publishes.
9. **`bench/` workspace** — last, but its corpus/baseline design can start anytime; it
   depends on all adapters (rrweb baseline, CDP screencast baseline, WebRTC baseline) and
   doubles as the regression suite thereafter.

Rationale for 4-before-5: the loopback adapter proves the Transport seam is real before any
network code exists — if capture or renderer secretly depends on relay behavior, step 4
exposes it immediately.

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| 1 capture → 1 viewer | Reference behavior; nothing to do |
| 1 capture → N viewers | Already architecturally free (rooms hold a `Set` of viewers); add per-viewer backpressure drop accounting so one slow viewer can't starve others |
| Many sessions / relay instance | Relay is stateless per-room byte-forwarding; horizontal scale = room-sharded instances. Out of scope for v1 per PROJECT.md — don't build it |

### Scaling Priorities

1. **First bottleneck:** snapshot size on heavy pages — already mitigated (truncation
   budget); the CSSOM capture mode is the structural fix and the paper ablation.
2. **Second bottleneck:** per-viewer fan-out bandwidth — `bufferedAmount` drop already
   handles it; surface per-viewer drop counts in diagnostics.

## Anti-Patterns

### Anti-Pattern 1: Premature monorepo / micro-packages

**What people do:** Split capture/relay/renderer/adapters into separately published
packages "like rrweb."
**Why it's wrong:** rrweb's split exists for TS build orchestration and genuinely separate
release cadences. For a no-build, dependency-free ESM library it buys versioning skew,
workspace tooling, and N publish pipelines, while subpath exports already deliver the
consumer-facing benefit. PostHog ships host adapters as packages because each has its own
dependency tree — PhantomStream's adapters are dependency-free files.
**Do this instead:** One package, subpath exports, conditional `"node"` exports for
node-only paths, `bench/` as the only extra workspace.

### Anti-Pattern 2: Host APIs leaking into core modules

**What people do:** "Just one `chrome.runtime` call" or a `typeof chrome !== 'undefined'`
branch inside capture/renderer core.
**Why it's wrong:** It silently re-couples the core to one host and breaks the injectable
artifact; conditional host-detection branches are untestable combinatorics.
**Do this instead:** Enforce the grep test in CI: `src/capture/`, `src/renderer/`,
`src/relay/relay.js` must contain no `chrome.`, `playwright`, `process.`, or `require`.
Adapters are the only host-API surface.

### Anti-Pattern 3: Capture core listening for inbound messages

**What people do:** Give the core an `onMessage`/transport-receive path so it can handle
start/stop itself.
**Why it's wrong:** Inbound message *shape and source* are host-specific (chrome runtime
messages vs. CDP bindings vs. postMessage); putting routing in the core drags every host's
quirks inside the seam. rrweb's record() has no inbound channel at all.
**Do this instead:** Core returns a controller; adapters translate inbound host messages
into controller calls (Pattern 1).

### Anti-Pattern 4: Web-component or framework-specific viewer

**What people do:** Ship the viewer as a custom element or a React component as the primary
API.
**Why it's wrong:** No comparable system does this (rrweb-player, Replayer, PostHog all use
constructor + mount element); custom elements add registry/SSR friction and the iframe
already provides the isolation.
**Do this instead:** `createViewer({ container, transport })`; thin framework wrappers
later if demanded.

### Anti-Pattern 5: Demo/bench leaking into the npm tarball (or out of reach of the CLI)

**What people do:** Publish `examples/` and `bench/` (bloats install, slows `npx`), or
conversely exclude the static assets the demo CLI must serve.
**Why it's wrong:** `npx phantom-stream demo` runs from the *published tarball* — it can
only serve files that shipped.
**Do this instead:** `files` whitelist: `src/`, `bin/`, `dist/`, `demo-assets/`. Keep
`examples/` (with the heavyweight Playwright demo) and `bench/` repo-only.

## Integration Points

### External Services / Hosts

| Host | Integration Pattern | Notes |
|------|---------------------|-------|
| Chrome extension MV3 | content-script transport + SW forwarder + `chrome.alarms` watchdog | Closest to reference; `flush()` on transport for SW-eviction drain |
| Playwright | `context.addInitScript({ path })` + `context.exposeBinding` | Bindings survive navigation; init script re-runs per nav (free re-snapshot); JSON-serializable args only |
| Raw CDP (Puppeteer, chrome.debugger) | `Page.addScriptToEvaluateOnNewDocument` (+`worldName`) + `Runtime.addBinding` → `Runtime.bindingCalled` | Binding payload is a string — pass the stringified envelope; binding scoped to the isolated world if used |
| Bookmarklet / embedded SDK | `dist/capture.inject.js` + direct ws-client transport from page | No SW hop; remote control capability absent (advertise it) |
| FSB | Consumes published package; extension adapter + renderer subpaths | Wire-protocol backward compatibility (`{_lz, d}`, session stamps) is the contract |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| capture core ↔ adapter | `Transport.send(type, payload)` out; controller methods in | The seam everything hinges on; add `flush()` for MV3 |
| adapter ↔ relay | Enveloped JSON over backend (ws reference) | Relay treats payloads as opaque bytes except staleness/size checks |
| relay ↔ viewer transport | Same envelope, fan-out verbatim | Multi-viewer free; per-viewer drop accounting |
| viewer transport ↔ renderer core | Same `Transport` contract, inverted direction | Renderer also *sends* (remote control, resync requests) |
| protocol ↔ everyone | Static ESM imports | Single source of truth for the 1 MiB cap shared by truncation + relay |
| page (MAIN world) ↔ capture (isolated world) | Namespaced `CustomEvent` (dialog channel only) | Keep minimal; session-ID-namespaced to resist page spoofing |

## Sources

- [rrweb monorepo (GitHub)](https://github.com/rrweb-io/rrweb) — packages layout, yarn + turbo, snapshot/record/replay/player split — HIGH
- [rrweb packages directory](https://github.com/rrweb-io/rrweb/tree/master/packages) — full package list incl. v2 `record`/`replay` split — HIGH
- [rrweb guide](https://github.com/rrweb-io/rrweb/blob/master/guide.md) — `record({ emit })` contract, `Replayer(events, { root, liveMode })`, `rrwebPlayer({ target, props })`, sandbox notes — HIGH
- [PostHog posthog-js monorepo](https://github.com/PostHog/posthog-js) — pnpm + turbo, per-host packages, examples/playground — HIGH
- [PostHog lazy-load session replay issue #2260](https://github.com/PostHog/posthog-js/issues/2260) and [bundled recorder issue #523](https://github.com/PostHog/posthog-js/issues/523) — recorder as lazy/bundled artifact — MEDIUM
- [PostHog session replay architecture handbook](https://posthog.com/handbook/engineering/session-replay/session-replay-architecture) — MEDIUM
- [@replayio/replay-cli (npm)](https://www.npmjs.com/package/@replayio/replay-cli), [@replayio/node (npm)](https://www.npmjs.com/package/@replayio/node), [replayio/protocol package.json](https://github.com/replayio/protocol/blob/master/package.json) — adapter-per-package + standalone protocol package — MEDIUM
- [Playwright Page API](https://playwright.dev/docs/api/class-page) — `addInitScript`, `exposeBinding`/`exposeFunction` semantics, navigation survival, serialization — HIGH
- [CDP Runtime domain](https://chromedevtools.github.io/devtools-protocol/tot/Runtime/) — `Runtime.addBinding`, `bindingCalled`, world scoping with `addScriptToEvaluateOnNewDocument` — HIGH
- [Sentry custom transports](https://docs.sentry.io/platforms/javascript/configuration/transports/) — `Transport { send, flush }` injected interface — HIGH
- [Node.js packages docs (exports)](https://nodejs.org/api/packages.html), [Hiroki Osame on package.json exports](https://hirok.io/posts/package-json-exports), [Jotai entry points](https://blog.axlight.com/posts/how-jotai-specifies-package-entry-points/) — subpath + conditional exports for SDK design — HIGH
- [Monorepos in JavaScript, Anti-Pattern (P. Sweeney)](https://medium.com/@PepsRyuu/monorepos-in-javascript-anti-pattern-917603da59c8) — micro-packages-for-tree-shaking obsolete with ESM — LOW (opinion piece, corroborates Node docs)
- [webext-bridge](https://github.com/serversideup/webext-bridge) + [concepts](https://serversideup.net/open-source/webext-bridge/docs/guide/concepts) — background-as-hub, `allowWindowMessaging` namespace gating for page context — MEDIUM
- [npm docs: bin](https://docs.npmjs.com/cli/v11/configuring-npm/package-json/), [npx](https://docs.npmjs.com/cli/v11/commands/npx/), [sergiodxa bin tutorial](https://sergiodxa.com/tutorials/use-package-json-bin-to-create-a-cli) — CLI/bin/shebang conventions — HIGH
- [rrweb-io/benchmark-events](https://github.com/rrweb-io/benchmark-events), [highlight.io session replay benchmark](https://www.highlight.io/blog/session-replay-performance), [react-redux-benchmarks](https://github.com/reduxjs/react-redux-benchmarks) — bench-harness placement precedents — MEDIUM

---
*Architecture research for: PhantomStream multi-context browser SDK extraction*
*Researched: 2026-06-09*
