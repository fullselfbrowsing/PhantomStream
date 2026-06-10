# Walking Skeleton — PhantomStream

**Phase:** 1
**Generated:** 2026-06-09

> Library/framework adaptation: PhantomStream is not a web app. The "thinnest end-to-end working slice" is: jsdom loads a frozen fixture → the shipped reference capture runs and streams snapshot + diffs → the differential oracle compares reference-vs-reference → green. No DB, no UI, no deployment; dev "deployment" = `npm test` green locally + a GitHub Actions workflow running the same command.

## Capability Proven End-to-End

A developer runs `npm test` and the differential oracle executes the real shipped capture pipeline (snapshot serialization, rAF-batched mutation diffs, side channels) inside jsdom against a frozen fixture and proves stream equivalence — locally and in CI on Node 20/22/24.

## Architectural Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Language/runtime | Plain JS ESM + JSDoc types, no build step | Locked project constraint: capture core must inject as a plain script into arbitrary contexts (content script, addInitScript, bookmarklet) |
| Test runner | node:test + node:assert/strict (built-in) | Repo convention; zero-install CI; flat test() style per TESTING.md |
| DOM environment for the oracle | jsdom ^29.1.1, devDependency ONLY (D-01, USER OVERRIDE) | Fast, browser-free CI; jsdom 29 resolves stylesheet cascade in getComputedStyle. Known limitation recorded: no real layout — layout-dependent divergences deferred to real-browser phases (2/4/5/12). Library itself stays dependency-free |
| Oracle design | Two JSDOM instances (never shared DOM — nid stamping cross-contaminates), reference side via getInternalVMContext + vm.runInContext with chrome/FSB stubs, extracted side via globalThis assignment + loopback transport; normalized structural equivalence (ordinal SESSION_n/SNAPSHOT_n placeholders); machine-readable divergence ledger that FAILS on undeclared divergences (D-02, D-03) | Empirically verified recipe (01-RESEARCH.md); ref-vs-ref mode stays as a permanent harness self-test; harness keeps an environment-abstraction seam so a real-browser runner can swap in later |
| Capture core shape | Single-file `src/capture/index.js` exporting `createCapture({transport, logger, overlayProvider, skipElement}) → {start, stop, pause, resume}` (D-05, D-10 USER OVERRIDE) | Parity, not modularity, is the Phase 1 exit bar; the 5-module split (serializer/differ/side-channels/session/index) is DEFERRED to a later phase — re-run the oracle when it lands |
| Transport seam | `{ send(type, payload), flush?() }`, fire-and-forget, errors → logger never thrown (D-07) | Mirrors chrome.runtime.sendMessage semantics so every adapter (MV3, CDP, bookmarklet, embedded) maps cleanly |
| Lifecycle semantics | stop→start = fresh session (new IDs); resume = same session, NO re-snapshot (D-06, USER OVERRIDE — divergence ledger entry D1) | Missed-while-paused mutations are a documented host contract; reference behavior intentionally diverged here only |
| CI | GitHub Actions: checkout@v6 + setup-node@v6, Node matrix [20, 22, 24], `npm ci && npm test`, `permissions: contents: read` | jsdom 29 engine floor; no secrets, no browsers needed |
| Wire identifiers | Imported from `src/protocol/` (STREAM types, NID_ATTR, constants, createStreamSessionId) — never redefined | Protocol module is the single source of wire truth; FSB envelope compatibility preserved by construction |
| Directory layout | `src/capture/` (ships), `tests/differential/` (harness + fixtures/ + scenarios/ + ledger), `tests/capture-*.test.js` (purity/lifecycle/defenses/watchdog), `.github/workflows/ci.yml` | Mirrors src/protocol precedent; test glob `node --test "tests/**/*.test.js"` |

## Stack Touched in Phase 1

- [ ] Project scaffold — jsdom devDependency + package-lock.json committed; recursive test glob; `./capture` subpath export (Plans 01-01, 01-03)
- [ ] "Data layer" equivalent — recorded message streams: real capture write (reference + extracted both emit through recorders/loopback transport) and real read (normalizer + comparator consume them) (Plans 01-01, 01-04)
- [ ] "Interaction" equivalent — host-invoked lifecycle: start/stop/pause/resume drive the capture through the public factory API (Plans 01-03, 01-05)
- [ ] Deployment equivalent — `.github/workflows/ci.yml` running `npm test` on Node 20/22/24 (Plan 01-01); local full-stack command: `npm test`

## Out of Scope (Deferred to Later Slices)

- Renderer/viewer extraction and the loopback mirror demo (Phase 2)
- Sanitization chokepoints + privacy masking — the reference's `on*`-on-shells-only gap and `javascript:` URL pass-through are intentionally PRESERVED for parity (Phase 3; accepted threat T-01-03)
- Relay core, ws backend, CompressionStream codec, networked demo (Phase 4)
- Playwright/CDP, MV3 extension, bookmarklet adapters (Phases 5–6); pingDomStream readiness probe returns host-side in the MV3 adapter (ledger D4)
- WeakMap node identity — `data-fsb-nid` page mutation persists until Phase 7
- Shadow DOM, iframes, input mirroring, added-node styles (Phase 8); CSSOM mode (Phase 9)
- The 5-module split of src/capture (deferred beyond Phase 1 per D-10 — planner decision within granted discretion)
- Real-browser verification of layout-dependent behavior (jsdom oracle limitation — Phases 2/4/5/12)

## Subsequent Slice Plan

Each later phase adds one vertical slice on top of this skeleton without altering its architectural decisions:

- Phase 2: page mirrors itself — capture + embeddable viewer, zero infrastructure
- Phase 3: security pipeline (sanitization both ends + masking) — the publishing gate
- Phase 4: networked mirror (`npx phantom-stream demo`)
- Phase 5: Playwright/CDP adapter + consent-gated remote control
- Phase 6: MV3 + bookmarklet adapters (FSB swap-in surface)
- Phase 7–9: identity rework → fidelity completion → CSSOM mode
- Phase 10–11: npm publish 0.x → FSB swap-in → 1.0
- Phase 12–13: evaluation harness → research paper
