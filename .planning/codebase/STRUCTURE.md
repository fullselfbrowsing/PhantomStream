<!-- refreshed: 2026-06-09 -->
# Codebase Structure

**Analysis Date:** 2026-06-09

## Directory Layout

```
managua/                          # Repo root
├── src/                          # Target standalone framework (extraction in progress)
│   ├── protocol/                 # COMPLETE — wire protocol, constants, envelope
│   │   ├── constants.js          # Shared numeric constants
│   │   ├── messages.js           # Message types, typedefs, session utilities
│   │   ├── envelope.js           # LZ compression encode/decode
│   │   └── index.js              # Re-exports all protocol symbols
│   ├── capture/                  # STUB — page-side capture (README only)
│   │   └── README.md
│   ├── relay/                    # STUB — transport relay (README only)
│   │   └── README.md
│   └── renderer/                 # STUB — viewer-side reconstruction (README only)
│       └── README.md
├── reference/                    # Verbatim FSB source (provenance: commit 867d6f0c)
│   ├── extension/                # Chrome MV3 extension source
│   │   ├── dom-stream.js         # Content script: capture (1117 lines)
│   │   ├── ws-client.js          # Service worker: WS client, remote control (1712 lines)
│   │   ├── background.dom-stream-relay.excerpt.js   # SW: content→WS forwarding
│   │   ├── background.watchdog-alarm.excerpt.js     # SW: alarm watchdog handler
│   │   └── lz-string.min.js      # LZ-string codec (vendored, minified)
│   ├── dashboard/
│   │   └── dashboard.js          # Viewer: full dashboard (4096 lines)
│   ├── server/
│   │   └── ws-handler.js         # Relay: WebSocket fan-out (367 lines)
│   ├── tests/                    # FSB stream-related test suites
│   │   ├── dashboard-preview-aspect-ratio.test.js
│   │   ├── dashboard-preview-fit.test.js
│   │   ├── dashboard-stream-pending-intent.test.js
│   │   ├── dashboard-stream-readiness-ping.test.js
│   │   ├── dom-stream-perf.test.js
│   │   └── stream-candidate-resolution.test.js
│   ├── planning/                 # Original FSB design docs (11 phases)
│   │   ├── MILESTONE-ROADMAP-v0.9.9.1.md
│   │   ├── MILESTONE-SUMMARY-v0.9.9.1.md
│   │   └── phases/               # Per-phase PLAN, SUMMARY, CONTEXT, UAT, VERIFICATION
│   │       ├── 122-connection-auto-start/
│   │       ├── 122.1-stream-overlay-fix/
│   │       ├── 122.2-stop-signal-fix/
│   │       ├── 122.3-ws-payload-compression/
│   │       ├── 122.4-dashboard-relay-fix/
│   │       ├── 123-layout-modes/
│   │       ├── 123.1-stream-fidelity-fix/
│   │       ├── 124-visual-fidelity/
│   │       ├── 125-remote-control/
│   │       ├── 211-stream-reliability-diagnostic-logging/
│   │       └── 276-dashboard-dom-streaming-diagnostic-minimum-patch/
│   └── README.md                 # Reference provenance note
├── tests/                        # Framework tests (protocol module)
│   └── protocol.test.js          # Node built-in test runner; 7 tests
├── docs/                         # Project documentation
│   ├── ARCHITECTURE.md           # End-to-end shipped-system architecture
│   ├── DESIGN-HISTORY.md         # Evolution, failures, known limitations
│   └── paper/
│       └── OUTLINE.md            # Research paper outline + evaluation plan
├── .context/
│   └── todos.md                  # Working task list
├── .planning/
│   └── codebase/                 # GSD codebase map documents
├── package.json                  # ESM package: @fullselfbrowsing/phantom-stream v0.1.0
├── README.md                     # Project overview
├── LICENSE                       # MIT
└── .gitignore
```

## Directory Purposes

**`src/protocol/`:**
- Purpose: Canonical protocol definitions shared by all four pipeline stages
- Contains: Message type constants, payload type definitions, LZ envelope codec, numeric
  constants (size caps, throttle timers, watchdog intervals)
- Key files: `src/protocol/constants.js`, `src/protocol/messages.js`, `src/protocol/envelope.js`
- Status: Complete and tested

**`src/capture/`:**
- Purpose: Placeholder for extraction of `reference/extension/dom-stream.js`
- Contains: `README.md` describing the planned module split and FSB-specific dependencies
  that must be abstracted (`chrome.runtime.sendMessage`, `window.FSB` namespace)
- Status: Stub only — no implementation yet

**`src/relay/`:**
- Purpose: Placeholder for extraction of `reference/server/ws-handler.js`
- Contains: `README.md` describing the transport-agnostic relay design with pluggable
  backends
- Status: Stub only — no implementation yet

**`src/renderer/`:**
- Purpose: Placeholder for extraction of the viewer code from `reference/dashboard/dashboard.js`
  (lines 2700–3960)
- Contains: `README.md` with planned module split and hard sandbox requirements
- Status: Stub only — no implementation yet

**`reference/extension/`:**
- Purpose: Verbatim Chrome extension source as shipped in FSB (provenance: commit 867d6f0c)
- Contains: Content script capture module, service worker WS client, background excerpts,
  vendored LZ-string
- Key files: `reference/extension/dom-stream.js` (1117 lines, authoritative capture
  reference), `reference/extension/ws-client.js` (1712 lines, authoritative transport
  reference)
- Generated: No
- Committed: Yes

**`reference/dashboard/`:**
- Purpose: Verbatim FSB dashboard source
- Contains: `dashboard.js` (4096 lines) — the full viewer implementation; stream-relevant
  code is roughly lines 2700–3960

**`reference/server/`:**
- Purpose: Verbatim FSB relay server source
- Contains: `ws-handler.js` (367 lines, CommonJS) — the authoritative relay reference

**`reference/tests/`:**
- Purpose: FSB stream-related test suites extracted alongside source
- Contains: 6 test files covering preview rendering, stream readiness, and stream candidate
  resolution

**`reference/planning/`:**
- Purpose: Original FSB design history preserved as provenance
- Contains: 11 phase directories, each with PLAN, SUMMARY, CONTEXT, and verification docs
- Key milestone: phases 122–125 (core Phantom Stream), 211 (reliability/diagnostic
  logging), 276 (dashboard DOM streaming diagnostic minimum patch)

**`tests/`:**
- Purpose: Framework-level tests for `src/`
- Contains: `protocol.test.js` — 7 tests using Node built-in `node:test` runner, covering
  envelope round-trip, staleness guard, session ID, and budget constants

**`docs/`:**
- Purpose: Project documentation read by humans and referenced by development agents
- Key files: `docs/ARCHITECTURE.md` (ground-truth shipped-system description),
  `docs/DESIGN-HISTORY.md` (evolution and known limitations), `docs/paper/OUTLINE.md`
  (research paper scope)

## Key File Locations

**Protocol entry point:**
- `src/protocol/index.js` — single import target for all protocol symbols

**Wire constants (must stay in sync between capture and relay):**
- `src/protocol/constants.js` — `RELAY_PER_MESSAGE_LIMIT_BYTES`, `SNAPSHOT_BUDGET_BYTES`,
  throttle and watchdog intervals

**Capture reference (authoritative for `src/capture/` extraction):**
- `reference/extension/dom-stream.js` — full 1117-line content script

**Transport reference (authoritative for `src/relay/` and remote-control extraction):**
- `reference/extension/ws-client.js` — full 1712-line service worker WS client

**Relay reference (authoritative for `src/relay/` extraction):**
- `reference/server/ws-handler.js` — full 367-line Node.js WebSocket handler

**Renderer reference (authoritative for `src/renderer/` extraction):**
- `reference/dashboard/dashboard.js` lines 2700–3960 — snapshot render, diff apply,
  overlays, remote control, layout modes

**Background relay excerpts (for context on the content → SW forwarding path):**
- `reference/extension/background.dom-stream-relay.excerpt.js`
- `reference/extension/background.watchdog-alarm.excerpt.js`

**Framework tests:**
- `tests/protocol.test.js`

**Reference tests:**
- `reference/tests/` — 6 test files

**Package manifest:**
- `package.json` — `"type": "module"`, `"main": "src/protocol/index.js"`,
  `"exports": { "./protocol": "./src/protocol/index.js" }`,
  test command: `node --test tests/*.test.js`

## Naming Conventions

**Files:**
- Protocol module files: `kebab-case.js` (`constants.js`, `messages.js`, `envelope.js`)
- Reference files: preserve original FSB names (`dom-stream.js`, `ws-client.js`,
  `ws-handler.js`, `dashboard.js`)
- Background excerpts: `background.<feature>.excerpt.js` pattern
- Test files: `<subject>.test.js`

**Directories:**
- Stub source modules: lowercase single-word (`capture/`, `relay/`, `renderer/`)
- Reference phases: `<number>-<kebab-description>/`
- Planning phase docs: `<number>-NN-PLAN.md`, `<number>-NN-SUMMARY.md`, `<number>-CONTEXT.md`,
  `<number>-HUMAN-UAT.md`, `<number>-VERIFICATION.md`

**Message types (wire protocol):**
- Viewer → capture host: `dash:<verb>` (e.g., `dash:dom-stream-start`)
- Capture host → viewer: `ext:<noun>` (e.g., `ext:dom-snapshot`, `ext:dom-mutations`)
- Internal content-script → background actions: `domStream<Action>` camelCase
  (e.g., `domStreamStart`, `domStreamReady`)

**Node identity attribute:**
- `data-fsb-nid` — set via `NID_ATTR` constant in `src/protocol/messages.js`

## Where to Add New Code

**New protocol message type:**
- Add to `src/protocol/messages.js` under the appropriate namespace (`CONTROL` or `STREAM`)
- Add corresponding `DIFF_OP` entry if it's a new diff operation type
- Update `tests/protocol.test.js` with a staleness/identity test if the message carries
  session identity

**New protocol constant:**
- Add to `src/protocol/constants.js` with a JSDoc comment explaining the unit and why
  the value was chosen
- Keep in sync with reference: if the constant has a hardcoded equivalent in
  `reference/extension/dom-stream.js` or `reference/server/ws-handler.js`, add a sync
  comment

**New `src/capture/` module file (when extraction begins):**
- Place in `src/capture/<name>.js` following the planned split:
  `serializer.js`, `differ.js`, `side-channels.js`, `session.js`
- Entry point: `src/capture/index.js` → `createCapture({ transport, options })`

**New `src/relay/` module file:**
- Place in `src/relay/<name>.js`; backend implementations in `src/relay/backends/<name>.js`
- Entry point: `src/relay/index.js` → `createRelay({ backend, limits })`

**New `src/renderer/` module file:**
- Place in `src/renderer/<name>.js`
- Entry point: `src/renderer/index.js` → `createViewer({ container, transport })`

**New framework test:**
- Add to `tests/<subject>.test.js` using Node built-in `node:test` and `node:assert/strict`
- Import from `../src/protocol/index.js` or the appropriate module path
- Run with: `npm test` (= `node --test tests/*.test.js`)

**New reference test (for FSB behavior verification):**
- Add to `reference/tests/<subject>.test.js` — this mirrors the FSB test location

## Special Directories

**`.context/`:**
- Purpose: Working notes and task tracking for the ongoing extraction
- Contains: `todos.md`
- Generated: No
- Committed: Yes

**`.planning/codebase/`:**
- Purpose: GSD codebase map documents consumed by planning and execution agents
- Contains: `ARCHITECTURE.md`, `STRUCTURE.md` (this file)
- Generated: Yes (by `/gsd-map-codebase`)
- Committed: Yes

**`reference/`:**
- Purpose: Immutable provenance snapshot of the shipped FSB system
- Generated: No (verbatim extraction)
- Committed: Yes — treat as read-only; do not modify reference files

---

*Structure analysis: 2026-06-09*
