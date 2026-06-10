# Phase 1: Capture Core Extraction + Differential Oracle - Context

**Gathered:** 2026-06-09
**Status:** Ready for planning

<domain>
## Phase Boundary

The capture core (`reference/extension/dom-stream.js`, 1,117 lines) is extracted into `src/capture/` so it runs in any injection context behind an injected `Transport` seam, with output provably equivalent to the shipped reference via a differential oracle that exists **before** the first serializer refactor lands. Covers CAPT-01 (Transport seam, zero `chrome.runtime`/`window.FSB`), CAPT-02 (start/stop/pause/resume lifecycle), CAPT-03 (reliability defenses survive extraction), CAPT-04 (differential harness + divergence ledger).

Out of scope for this phase: renderer extraction (Phase 2), sanitization/masking (Phase 3), relay/transport backends (Phase 4), behavioral fixes to the six inherited limitations (Phases 3/8/9).

</domain>

<decisions>
## Implementation Decisions

### Differential Oracle Design
- **Harness environment: jsdom (Node, devDependency) — USER OVERRIDE.** The oracle runs reference and extracted capture side-by-side in the same jsdom environment. Rationale: fast, no browser dependency, runs in plain `node --test` CI. **Known limitation (record in ledger/notes):** jsdom has no real layout — `getComputedStyle` is limited and `getBoundingClientRect` is degenerate, so layout-dependent behavior (style capture values, truncation measurement) is exercised degenerately-but-identically in both implementations; divergences that only manifest with real layout are NOT caught by this oracle and are deferred to real-browser verification in later phases (2, 4, 5, 12). The harness design should not preclude swapping in a real-browser runner later.
- **Equivalence definition: normalized structural equivalence.** Canonicalize nondeterministic fields (stream session IDs, timestamp-based snapshot IDs, nid assignment ordering), then deep-equal compare snapshot HTML + diff-op streams. Report first divergence point per fixture.
- **Divergence ledger: machine-readable** (e.g., `tests/differential/divergence-ledger.js` — entries with id, description, rationale, affected fields/fixtures). The harness FAILS on any undeclared divergence. Human-readable docs derive from the ledger, not vice versa.
- **Fixtures: frozen local HTML fixtures checked into the repo.** Crafted per defense — truncation budget overflow, mutation bursts, add/rm/attr/text ops, scroll — plus one heavy realistic page. Scripted mutation scenarios drive both implementations identically. No live sites (research-integrity constraint). Note: `reference/tests/fixtures/` referenced in older docs does NOT exist — fixtures are created fresh in this phase.

### Public API & Lifecycle Semantics
- **Factory shape:** `createCapture({ transport, ...options }) → { start, stop, pause, resume }` exactly as documented in `src/capture/README.md`. Named exports, ESM, JSDoc-typed.
- **pause/resume semantics: resume does NOT re-snapshot — USER OVERRIDE.** `pause()` suspends observers/flushing but keeps the session alive; `resume()` re-arms observers and continues the same `streamSessionId`/`snapshotId` without forcing a new snapshot. Mutations occurring while paused are missed by design — document this as a host contract ("pause when the page is quiescent or trigger your own refresh"); the planner may expose an explicit re-snapshot/refresh method as a separate host-invoked call, but resume itself must not auto-snapshot. `stop()` → `start()` = fresh session (new streamSessionId + new snapshotId), matching the reference implementation.
- **Transport contract:** `{ send(type, payload), flush?() }` — `send` required and fire-and-forget (mirrors `chrome.runtime.sendMessage` semantics); `flush` optional with no-op default; transport errors go to the injected logger, never thrown into the capture path. A loopback transport ships as a test utility and proves the seam (success criterion 2).
- **Options surface:** `{ logger, overlayProvider, skipElement }` per `src/capture/README.md` — all optional with safe defaults (console-backed logger, no overlay provider, no skip predicate).

### Extraction Strategy & Parity Discipline
- **Ordering: oracle first.** The differential harness must be green running reference-vs-reference on the frozen fixtures BEFORE the first extraction commit touches serializer behavior (roadmap success criterion 1).
- **Extraction granularity: single-file extraction first — USER OVERRIDE.** Extract `dom-stream.js` into a single `src/capture/` module (with Transport/options seams applied) and prove parity via the oracle FIRST. The 5-module split from `src/capture/README.md` (`serializer.js` / `differ.js` / `side-channels.js` / `session.js` / `index.js`) is a follow-up refinement performed only after parity is proven — the planner decides whether the split lands late in Phase 1 (with the oracle re-run after) or is deferred; parity, not the split, is the phase's exit bar.
- **Parity-only phase.** No behavioral changes: defer sanitization (Phase 3), post-snapshot computed styles (Phase 8), CSSOM mode (Phase 9). The only allowed divergences are those forced by removing FSB coupling (`chrome.runtime`, `window.FSB`) — each one logged in the divergence ledger.
- **Side channels in scope.** Scroll tracker, overlay broadcaster, and dialog interceptor are extracted in this phase behind the `overlayProvider`/options seam so no FSB coupling is left dangling in the capture core.

### CI & Test Enforcement
- **Purity enforcement:** a static-scan `node:test` (e.g., `tests/capture-purity.test.js`) that reads `src/capture/` sources and fails on `chrome.` / `window.FSB` references — satisfies the "grep-enforced in CI" success criterion in a portable way.
- **CI infrastructure: add a minimal GitHub Actions workflow in this phase** running `npm test` (no CI exists yet). With the jsdom decision, no browser install is needed in CI.
- **Defense tests: one dedicated test per reliability defense** — rAF-batched diffs, self-watchdog force-flush, session/snapshot identity stamping, budgeted whole-subtree truncation with single-pass layout reads — written in `node:test` + `node:assert/strict` style per `.planning/codebase/TESTING.md` conventions (injected fakes, explicit time/entropy, flat `test()` calls).

### Claude's Discretion
- jsdom configuration details (`pretendToBeVisual` for rAF, MutationObserver availability, module loading strategy for the IIFE reference source)
- Exact fixture HTML content and mutation-scenario scripting format
- Harness directory layout (suggested: `tests/differential/`) and how reference IIFE code is loaded in Node (vm context per existing reference-test patterns is acceptable for the *reference* side only)
- Ledger entry schema details
- GitHub Actions workflow matrix (Node versions)

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/protocol/` — complete, tested protocol module (constants, messages, envelope); capture core imports `NID_ATTR`, `STREAM`/`CONTROL`/`DIFF_OP` types, `createStreamSessionId`, budget constants from here instead of redefining
- `reference/extension/dom-stream.js` — the 1,117-line source of truth being extracted; IIFE with `window.FSB` namespace + `chrome.runtime.sendMessage` coupling (the two seams to abstract per `src/capture/README.md`)
- `tests/protocol.test.js` — the canonical new-style test file (node:test, injected fakes like `fakeLz`, explicit entropy)
- `reference/tests/stream-candidate-resolution.test.js` — demonstrates `vm.runInContext` pattern for loading IIFE reference code with stubbed chrome APIs (usable for the oracle's reference side)

### Established Patterns
- ESM named exports, explicit `.js` import extensions, barrel `index.js` (see `src/protocol/`)
- Discriminated-union returns `{ok, error}` for fallible operations; lowercase-hyphenated error strings
- `var` + `||` defaulting in cross-runtime files (intentional — see `src/protocol/envelope.js`)
- JSDoc blocks on all exports; numeric literals commented with units/derivation
- Tests: flat `test()` calls, full-sentence behavior descriptions, inline fixtures, no mocking framework

### Integration Points
- `package.json` `exports` map — add `"./capture": "./src/capture/index.js"` subpath alongside `"./protocol"`
- `npm test` script (`node --test tests/*.test.js`) — differential harness and new tests must run under it (glob may need extending for subdirectories)
- No `.github/workflows/` exists — CI is created from scratch this phase
- No `dependencies`/`devDependencies` exist yet — jsdom becomes the first devDependency (library itself stays dependency-free)

</code_context>

<specifics>
## Specific Ideas

- User explicitly chose the lighter-weight path on all three consequential questions: jsdom over Playwright (oracle), no auto re-snapshot on resume, single-file extraction before any module split. Bias the plan toward simplicity and fast iteration; real-browser rigor arrives in later phases.
- Wire protocol output must stay backward-compatible with FSB's shipped envelope (`{_lz, d}`, session stamping) — the oracle effectively enforces this.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>
