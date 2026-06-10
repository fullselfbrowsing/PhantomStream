# Phase 1: Capture Core Extraction + Differential Oracle - Research

**Researched:** 2026-06-09
**Domain:** DOM capture extraction (browser-agnostic JS), differential testing in jsdom, Node-hosted IIFE execution
**Confidence:** HIGH — every load-bearing claim verified empirically against jsdom 29.1.1 and the actual reference source in this session

## Summary

This phase has two halves: (1) extract `reference/extension/dom-stream.js` (1,117 lines) into a single `src/capture/` module behind a `Transport` seam, and (2) build a differential oracle in jsdom that proves the extraction is op-stream-equivalent to the reference — with the oracle landing first.

The critical unknown — "can the reference IIFE actually run in jsdom under Node?" — was resolved empirically this session: **the unmodified reference `dom-stream.js` loads via `dom.getInternalVMContext()` + `vm.runInContext()` with a two-key chrome stub (`chrome.runtime.sendMessage` + `chrome.runtime.onMessage.addListener`) and a minimal `window.FSB` stub, produces a real nid-stamped style-inlined snapshot (jsdom 29's getComputedStyle resolves stylesheet cascade — `color:rgb(0, 128, 0)` from a `<style>` rule was inlined), and streams live mutations through the rAF flush (`pretendToBeVisual: true`) to the stubbed transport with correct op types** `[VERIFIED: empirical spike, jsdom 29.1.1, Node 24.14.1]`. MutationObserver (childList/attributes/characterData/subtree/attributeOldValue), TreeWalker with `acceptNode` filters, `dataset` camelCase mapping, `getAttributeNS` xlink, `CustomEvent`, and scroll-event dispatch all work. `getBoundingClientRect` returns zeros (no layout) but `Element.prototype` is patchable for deterministic fake layout, which makes pass-1 truncation testable.

The main planning risks are not "will jsdom work" but mechanics: the `npm test` glob must change (Node 24's `--test` no longer recurses bare directory args — verified), the watchdog defense test needs a fake-`Date`/real-`setTimeout` recipe to avoid 5-second waits, and `resume()` semantics are an intentional divergence from the reference (the reference re-snapshots on resume; the user locked no-re-snapshot) that must be the first entry in the divergence ledger.

**Primary recommendation:** Build the oracle harness as reference-vs-reference first (two JSDOM instances, same fixture, scripted mutations, normalize, deep-equal), get it green in CI, then extract a single-file `src/capture/` core and flip one side of the oracle to the extracted implementation.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| DOM snapshot serialization + style inlining | Capture core (page realm) | — | Reads live DOM/getComputedStyle; must run where the page is |
| Mutation diffing + rAF batching + watchdog | Capture core (page realm) | — | MutationObserver lives in the page; timing defenses are page-local |
| Scroll/overlay/dialog side channels | Capture core (page realm) | Host via `overlayProvider` | Overlay state is host-owned; capture only reads through the seam |
| Message delivery (`send`/`flush`) | Host adapter (injected Transport) | — | The seam: `chrome.runtime.sendMessage` becomes host concern |
| Lifecycle control (start/stop/pause/resume) | Capture public API | Host adapter invokes | Reference routed via `chrome.runtime.onMessage`; now direct function calls |
| Equivalence verification | Node test harness (jsdom) | CI | Dev-only; never ships; jsdom is a devDependency only |
| Purity enforcement (no `chrome.`/`window.FSB`) | Node static-scan test | CI | Portable grep-equivalent per CONTEXT decision |

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Differential Oracle Design**
- **Harness environment: jsdom (Node, devDependency) — USER OVERRIDE.** The oracle runs reference and extracted capture side-by-side in the same jsdom environment. Rationale: fast, no browser dependency, runs in plain `node --test` CI. **Known limitation (record in ledger/notes):** jsdom has no real layout — `getComputedStyle` is limited and `getBoundingClientRect` is degenerate, so layout-dependent behavior (style capture values, truncation measurement) is exercised degenerately-but-identically in both implementations; divergences that only manifest with real layout are NOT caught by this oracle and are deferred to real-browser verification in later phases (2, 4, 5, 12). The harness design should not preclude swapping in a real-browser runner later.
- **Equivalence definition: normalized structural equivalence.** Canonicalize nondeterministic fields (stream session IDs, timestamp-based snapshot IDs, nid assignment ordering), then deep-equal compare snapshot HTML + diff-op streams. Report first divergence point per fixture.
- **Divergence ledger: machine-readable** (e.g., `tests/differential/divergence-ledger.js` — entries with id, description, rationale, affected fields/fixtures). The harness FAILS on any undeclared divergence. Human-readable docs derive from the ledger, not vice versa.
- **Fixtures: frozen local HTML fixtures checked into the repo.** Crafted per defense — truncation budget overflow, mutation bursts, add/rm/attr/text ops, scroll — plus one heavy realistic page. Scripted mutation scenarios drive both implementations identically. No live sites (research-integrity constraint). Note: `reference/tests/fixtures/` referenced in older docs does NOT exist — fixtures are created fresh in this phase.

**Public API & Lifecycle Semantics**
- **Factory shape:** `createCapture({ transport, ...options }) → { start, stop, pause, resume }` exactly as documented in `src/capture/README.md`. Named exports, ESM, JSDoc-typed.
- **pause/resume semantics: resume does NOT re-snapshot — USER OVERRIDE.** `pause()` suspends observers/flushing but keeps the session alive; `resume()` re-arms observers and continues the same `streamSessionId`/`snapshotId` without forcing a new snapshot. Mutations occurring while paused are missed by design — document this as a host contract ("pause when the page is quiescent or trigger your own refresh"); the planner may expose an explicit re-snapshot/refresh method as a separate host-invoked call, but resume itself must not auto-snapshot. `stop()` → `start()` = fresh session (new streamSessionId + new snapshotId), matching the reference implementation.
- **Transport contract:** `{ send(type, payload), flush?() }` — `send` required and fire-and-forget (mirrors `chrome.runtime.sendMessage` semantics); `flush` optional with no-op default; transport errors go to the injected logger, never thrown into the capture path. A loopback transport ships as a test utility and proves the seam (success criterion 2).
- **Options surface:** `{ logger, overlayProvider, skipElement }` per `src/capture/README.md` — all optional with safe defaults (console-backed logger, no overlay provider, no skip predicate).

**Extraction Strategy & Parity Discipline**
- **Ordering: oracle first.** The differential harness must be green running reference-vs-reference on the frozen fixtures BEFORE the first extraction commit touches serializer behavior (roadmap success criterion 1).
- **Extraction granularity: single-file extraction first — USER OVERRIDE.** Extract `dom-stream.js` into a single `src/capture/` module (with Transport/options seams applied) and prove parity via the oracle FIRST. The 5-module split from `src/capture/README.md` (`serializer.js` / `differ.js` / `side-channels.js` / `session.js` / `index.js`) is a follow-up refinement performed only after parity is proven — the planner decides whether the split lands late in Phase 1 (with the oracle re-run after) or is deferred; parity, not the split, is the phase's exit bar.
- **Parity-only phase.** No behavioral changes: defer sanitization (Phase 3), post-snapshot computed styles (Phase 8), CSSOM mode (Phase 9). The only allowed divergences are those forced by removing FSB coupling (`chrome.runtime`, `window.FSB`) — each one logged in the divergence ledger.
- **Side channels in scope.** Scroll tracker, overlay broadcaster, and dialog interceptor are extracted in this phase behind the `overlayProvider`/options seam so no FSB coupling is left dangling in the capture core.

**CI & Test Enforcement**
- **Purity enforcement:** a static-scan `node:test` (e.g., `tests/capture-purity.test.js`) that reads `src/capture/` sources and fails on `chrome.` / `window.FSB` references — satisfies the "grep-enforced in CI" success criterion in a portable way.
- **CI infrastructure: add a minimal GitHub Actions workflow in this phase** running `npm test` (no CI exists yet). With the jsdom decision, no browser install is needed in CI.
- **Defense tests: one dedicated test per reliability defense** — rAF-batched diffs, self-watchdog force-flush, session/snapshot identity stamping, budgeted whole-subtree truncation with single-pass layout reads — written in `node:test` + `node:assert/strict` style per `.planning/codebase/TESTING.md` conventions (injected fakes, explicit time/entropy, flat `test()` calls).

### Claude's Discretion
- jsdom configuration details (`pretendToBeVisual` for rAF, MutationObserver availability, module loading strategy for the IIFE reference source)
- Exact fixture HTML content and mutation-scenario scripting format
- Harness directory layout (suggested: `tests/differential/`) and how reference IIFE code is loaded in Node (vm context per existing reference-test patterns is acceptable for the *reference* side only)
- Ledger entry schema details
- GitHub Actions workflow matrix (Node versions)

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CAPT-01 | Capture core runs in any injection context via injected `Transport` (`send`/`flush`) — zero `chrome.runtime`/`window.FSB` references | Seam inventory below maps all 8 `chrome.runtime.sendMessage` call sites + 6 `window.FSB` touch points to the Transport/options surfaces; purity static-scan pattern verified against existing reference-test style |
| CAPT-02 | Lifecycle `start`/`stop`/`pause`/`resume` with fresh-session semantics | Reference lifecycle handlers mapped (lines 1005–1087); reference resume re-snapshots — locked divergence ledger entry D1; `beginStreamSession()` mint semantics documented |
| CAPT-03 | Reliability defenses survive extraction: rAF batching, watchdog force-flush, identity stamping, budgeted truncation w/ single-pass layout reads | Each defense's mechanism mapped to line ranges; jsdom testability proven per defense (rAF via `pretendToBeVisual`, watchdog via fake-Date recipe, truncation pass-2 layout-free + pass-1 via rect-prototype patching) |
| CAPT-04 | Differential harness on frozen fixtures + intentional-divergence ledger | End-to-end reference-side loading proven empirically (getInternalVMContext + chrome stubs → snapshot + mutation stream captured); normalization targets enumerated; fixture matrix designed |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

- **GSD workflow enforcement:** file changes only through GSD commands (this phase executes via `/gsd-execute-phase`)
- **Tech stack:** plain JS ESM + JSDoc in `src/`; no runtime build step; capture core must inject as a plain script into arbitrary contexts
- **Wire compatibility:** output must stay backward-compatible with FSB's envelope (`{_lz, d}`, session stamping) — the oracle enforces this by construction
- **Performance:** must not regress encoded lessons (snapshot interactivity, single-pass layout reads, paint-cadence delivery) — defense tests lock these
- **Conventions:** ESM named exports with explicit `.js` extensions in `src/`; `var` + `||` defaulting acceptable in cross-runtime files; discriminated-union `{ok, error}` returns; lowercase-hyphenated error strings; JSDoc on all exports; numeric literals commented with units; no `describe` blocks in tests — flat `test()` calls with full-sentence descriptions; no mocking framework — injected fakes; explicit time/entropy as parameters
- **Commit rule (user global):** never add Co-Authored-By/AI attribution to commits

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| jsdom | 29.1.1 (devDependency only) | Oracle harness DOM environment | Locked by user decision; v29 (2026-03/04) overhauled CSSOM + getComputedStyle (cascade, specificity, `!important` all resolve); 74M weekly downloads `[VERIFIED: npm registry + slopcheck OK + official repo github.com/jsdom/jsdom]` |
| node:test + node:assert/strict | built-in (Node 24.x local) | Test runner | Repo convention; zero-install; already in use (`tests/protocol.test.js`, 8/8 green baseline) `[VERIFIED: ran npm test]` |
| node:vm | built-in | Load reference IIFE into jsdom's context | Existing repo pattern (`reference/tests/stream-candidate-resolution.test.js`); `dom.getInternalVMContext()` proven with the actual reference source `[VERIFIED: empirical spike]` |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `src/protocol/` (internal) | n/a | `NID_ATTR`, `STREAM`/`CONTROL`/`DIFF_OP`, `createStreamSessionId(nowMs, rand)`, budget constants | Extracted core imports these instead of redefining constants; note `createStreamSessionId` already takes injected entropy `[VERIFIED: codebase read]` |
| actions/checkout | v6 (latest v6.0.3) | CI workflow | `[VERIFIED: GitHub releases API]` |
| actions/setup-node | v6 (latest v6.4.0) | CI workflow | `[VERIFIED: GitHub releases API]` |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| jsdom | Playwright/real browser | Explicitly rejected by user override; harness design must not preclude swapping a real-browser runner later (keep the driver behind a thin "environment" abstraction: create page, run capture, collect messages) |
| Two JSDOM instances | One shared document for both captures | Rejected: both implementations stamp `data-fsb-nid` on the LIVE DOM (`assignNodeId` mutates the original) — they would corrupt each other. Two instances from identical fixture HTML + identical scripted mutations is the only correct design |
| `vm.SourceTextModule` for the extracted side | Plain ESM `import` + Node-global assignment | `vm.SourceTextModule` is experimental (`--experimental-vm-modules`); avoid. Set `globalThis.window/document/...` from the extracted side's JSDOM instance before invoking `createCapture` |

**Installation:**
```bash
npm install --save-dev jsdom@^29.1.1
```
(Installs ~39 transitive packages, 0 vulnerabilities at research time `[VERIFIED: actual install]`. Library itself stays dependency-free — jsdom is dev-only.)

**Version verification (performed this session):**
- `npm view jsdom version` → `29.1.1`, published 2026-04-30 `[VERIFIED: npm registry]`
- engines: `^20.19.0 || ^22.13.0 || >=24.0.0` `[VERIFIED: npm registry]`

## Package Legitimacy Audit

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| jsdom | npm | ~12 yrs | 74.1M/wk (2026-05-27 → 06-02) | github.com/jsdom/jsdom | [OK] | Approved |

- `npm view jsdom scripts.postinstall` → none `[VERIFIED]`
- slopcheck 0.6.1 verdict: `[OK]` `[VERIFIED: slopcheck run]`
- **Packages removed due to [SLOP]:** none
- **Packages flagged [SUS]:** none
- ⚠️ Note for planner: `slopcheck install jsdom` has the side effect of actually running `npm install` (it added jsdom to `dependencies`, not `devDependencies`). The research session reverted this. The plan's install task must use `npm install --save-dev jsdom` directly.

## Architecture Patterns

### System Architecture Diagram

```
                         DIFFERENTIAL ORACLE (tests/differential/)
                         ───────────────────────────────────────────
  fixture HTML ──┬──> JSDOM instance A (url: same, pretendToBeVisual)
                 │       └─ getInternalVMContext() + chrome/FSB stubs
                 │          vm.runInContext(reference dom-stream.js IIFE)
                 │             capture → chrome.runtime.sendMessage stub ──> recorder A
                 │
                 └──> JSDOM instance B (identical config)
                         └─ globalThis.{window,document,Node,NodeFilter,
                             MutationObserver,requestAnimationFrame,...} = B
                            import createCapture from src/capture/
                            createCapture({ transport: loopback }) ──> recorder B
                 │
   scripted mutation scenario (one function, applied to A's doc AND B's doc,
   with identical await points: microtask drain → rAF tick → settle)
                 │
                 ▼
   normalize(recorder A) vs normalize(recorder B)
     - map chrome message {action, ...} ↔ transport (type, payload) via fixed table
     - canonicalize streamSessionId / snapshotId / (defensively) nid order
     - apply divergence-ledger transforms (declared divergences only)
                 │
                 ▼
   deep-equal per message; FAIL with first divergence point + fixture name


                         EXTRACTED RUNTIME (src/capture/, ships)
                         ───────────────────────────────────────────
  page DOM ──> serializeDOM ──> snapshot payload ──┐
  MutationObserver ──> pendingMutations ──rAF──> diff ops ──┤
  watchdog setTimeout chain (force-flush if stale >5s) ─────┤──> transport.send(type, payload)
  scroll listener (200ms throttle) ─────────────────────────┤         (host-injected)
  overlayProvider reads (500ms throttle) ───────────────────┤
  dialog interceptor (page-realm monkey-patch → CustomEvent)┘
  host ──> { start, stop, pause, resume } ──> session lifecycle (mint IDs via protocol)
```

### Recommended Project Structure

```
src/capture/
├── index.js                  # single-file extraction: createCapture(...) (split deferred per user override)
└── README.md                 # exists; update factory docs if needed
tests/
├── capture-purity.test.js    # static scan: no chrome. / window.FSB in src/capture/
├── capture-defenses.test.js  # one test per defense (or one file per defense — planner choice)
└── differential/
    ├── harness.js            # env setup: makeReferenceSide(), makeExtractedSide(), runScenario()
    ├── normalize.js          # canonicalization + message-shape mapping
    ├── divergence-ledger.js  # machine-readable declared divergences
    ├── oracle.test.js        # the node:test entry that iterates fixtures × scenarios
    ├── fixtures/             # frozen HTML files
    │   ├── basic.html
    │   ├── heavy-realistic.html
    │   ├── truncation-overflow.html
    │   └── ...
    └── scenarios/            # scripted mutation drivers (pure functions of (window, document))
.github/workflows/test.yml    # CI from scratch
```

### Pattern 1: Reference-side loading (proven recipe)

**What:** Load the unmodified reference IIFE into jsdom and capture its output.
**When to use:** Oracle reference side only — never for `src/` code.
**Example (every line verified in this session):**
```js
// Source: empirical spike against jsdom 29.1.1 + reference/extension/dom-stream.js
import { JSDOM, VirtualConsole } from 'jsdom';
import vm from 'node:vm';
import fs from 'node:fs';

const src = fs.readFileSync('reference/extension/dom-stream.js', 'utf8');
const vc = new VirtualConsole(); // quiet: swallows "Not implemented" canvas noise
const dom = new JSDOM(fixtureHtml, {
  url: 'https://fixture.test/page',     // MUST be identical on both sides (absolutification)
  pretendToBeVisual: true,              // enables requestAnimationFrame/cancelAnimationFrame
  runScripts: 'outside-only',           // 'dangerously' only for dialog-interceptor fixtures
  virtualConsole: vc,
});
const ctx = dom.getInternalVMContext();
const sent = [];
let controlListener = null;
ctx.chrome = {
  runtime: {
    sendMessage: (msg) => { sent.push(msg); return Promise.resolve(); }, // .catch() chains work
    onMessage: { addListener: (fn) => { controlListener = fn; } },
  },
};
ctx.window.FSB = { logger: { info(){}, warn(){}, error(){} }, _modules: {} };
vm.runInContext(src, ctx);
// drive lifecycle exactly as the extension background would:
controlListener({ action: 'domStreamStart' }, {}, (resp) => {});
// → sent[] now contains { action:'domStreamSnapshot', snapshot:{...} } etc.
// ALWAYS stop at teardown or the watchdog setTimeout chain keeps the process alive:
controlListener({ action: 'domStreamStop' }, {}, () => {});
```
Observed in the spike: IIFE registers `FSB._modules['dom-stream']`, sends `domStreamReady`, snapshot html is nid-stamped with stylesheet-cascade styles inlined, and a scripted `setAttribute` + `appendChild` produced `mutations: [{op:'attr'...},{op:'add'...}]` after one rAF tick `[VERIFIED: empirical spike]`.

### Pattern 2: Extracted-side loading (Node globals from a second JSDOM)

**What:** The extracted core references ambient browser globals (matching the reference and matching real injection contexts). In tests, supply them from a dedicated JSDOM instance.
**When to use:** Oracle extracted side + defense tests.
```js
// Source: standard jsdom-in-Node pattern; globals list derived from reference source audit
const dom2 = new JSDOM(fixtureHtml, { url: 'https://fixture.test/page', pretendToBeVisual: true, virtualConsole: vc });
const w = dom2.window;
// Complete global set the capture core dereferences (audited from dom-stream.js):
for (const k of ['window','document','Node','NodeFilter','MutationObserver',
                 'requestAnimationFrame','cancelAnimationFrame','CustomEvent',
                 'ShadowRoot','location','getComputedStyle','URL']) {
  globalThis[k] = k === 'window' ? w : w[k] ?? w;
}
globalThis.window = w; globalThis.document = w.document; globalThis.location = w.location;
// then:
const capture = createCapture({ transport: loopback });
capture.start();
```
**Pitfall:** globals leak across tests in the same file — restore/reassign in setup per test, and prefer one fixture-scenario per `test()` (each `node --test` FILE is already a separate process, which is the stronger isolation boundary). Track which globals were set and delete them in teardown.

### Pattern 3: Deterministic mutation-flush sequencing

**What:** Make rAF-batched flushes deterministic without faking timers.
```js
// drive identical scenario against one side:
scenario(w.document, w);                                  // perform DOM mutations
await new Promise((r) => setTimeout(r, 0));               // MutationObserver microtask delivery
await new Promise((r) => w.requestAnimationFrame(r));     // rAF flush fires
await new Promise((r) => setTimeout(r, 20));              // settle async sendMessage chains
```
`[VERIFIED: empirical spike — this exact sequence produced the mutation message]`. Each JSDOM instance has its own rAF loop; await per instance.

### Pattern 4: Watchdog testing — fake Date, real setTimeout

**What:** The watchdog only fires when `pendingMutations.length > 0 && Date.now() - lastDrainTs > 5000`, checked on a real 500 ms `setTimeout` chain. Faking only `Date` makes the test run in ~600 ms instead of 5.5 s.
```js
// Reference side: override the context global BEFORE vm.runInContext(src, ctx)
let fakeNow = 1_000_000;
const RealDate = ctx.Date;
const FakeDate = function (...a) { return new RealDate(...a); };
FakeDate.now = () => fakeNow;
ctx.Date = FakeDate;                       // [VERIFIED: IIFE sees overridden Date.now()]
ctx.requestAnimationFrame = () => 0;       // suppress rAF so the queue stays stuck
ctx.cancelAnimationFrame = () => {};       // [VERIFIED: rAF callback never fires]
// load IIFE, start, mutate, then: fakeNow += 6000; wait ~600ms real time for two watchdog ticks
```
For the extracted side, the same suppression applies via the JSDOM-B window/globals (`globalThis.requestAnimationFrame = () => 0`) and `globalThis.Date` swap-and-restore inside one test (restore in `finally`). Real `setTimeout` stays untouched, so node:test internals are unaffected. The flushed mutations message carries `staleFlushCount: 1` — assert on it.

### Pattern 5: Deterministic fake layout for pass-1 truncation

**What:** jsdom rects are all zeros, so pass-1 ("drop subtrees with top > 3× viewport") never triggers naturally. Patch `Element.prototype.getBoundingClientRect` identically in BOTH environments to read a fixture-authored attribute:
```js
// applied to ctx (reference) and JSDOM-B window (extracted) BEFORE capture starts
W.Element.prototype.getBoundingClientRect = function () {
  const top = Number(this.getAttribute?.('data-test-top')) || 0;
  return { top, left: 0, width: 100, height: 50, right: 100, bottom: top + 50, x: 0, y: top };
};
```
`[VERIFIED: empirical spike — patched rect read back top=5000]`. Both implementations consult the same single-pass TreeWalker → Map; viewport cutoff is `window.innerHeight * 3 = 768 * 3 = 2304` in jsdom (innerWidth=1024, innerHeight=768 defaults `[VERIFIED]`).

### Pattern 6: Machine-readable divergence ledger

```js
// tests/differential/divergence-ledger.js — suggested schema
export const DIVERGENCES = [
  {
    id: 'D1-resume-no-resnapshot',
    description: 'resume() continues the session without re-snapshot; reference re-snapshots with a fresh session',
    rationale: 'USER OVERRIDE in 01-CONTEXT.md — missed-while-paused mutations are a documented host contract',
    affectedMessages: ['ext:dom-snapshot'],
    affectedScenarios: ['pause-resume'],
    // a transform the normalizer applies, or a predicate marking expected mismatches:
    appliesTo(refMsg, extMsg, scenarioName) { /* ... */ },
  },
];
```
The harness fails on any mismatch not claimed by a ledger entry, and (recommended) also fails on ledger entries that never matched anything (stale-entry detection).

### Anti-Patterns to Avoid

- **One shared DOM for both captures:** both sides mutate the live DOM with nid stamps — guaranteed cross-contamination. Two JSDOM instances, always.
- **Different `url` options across instances:** `absolutifyUrl` uses `document.baseURI`; mismatched URLs produce spurious divergences.
- **Default VirtualConsole in the harness:** canvas `toDataURL` emits "Not implemented" noise to the Node console; pass a fresh `VirtualConsole` (optionally captured for assertions).
- **Forgetting teardown stop():** the watchdog `setTimeout` chain re-arms every 500 ms forever; un-stopped captures keep the test process alive / leak timers across tests.
- **Faking `setTimeout`/rAF globally with node:test `mock.timers`:** jsdom's window timers are its own wrappers; whether they route through a later-mocked `globalThis.setTimeout` is unverified. The fake-Date/real-setTimeout recipe avoids the question entirely.
- **Normalizing too aggressively:** canonicalize ONLY session IDs, snapshot IDs, and (defensively) nid ordering. Both implementations assign nids 1..N in identical TreeWalker document order, so nid sequences should match exactly — if they don't, that is signal, not noise. Prefer asserting raw nid equality first and keep canonicalization as a documented fallback.
- **Putting jsdom anywhere in `src/`:** it is a devDependency for tests only; the library ships dependency-free.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| DOM environment in Node | A custom DOM stub / happy-dom swap | jsdom 29 (locked decision) | MutationObserver + TreeWalker + getComputedStyle cascade + getInternalVMContext all verified working; a stub would diverge from the reference's API usage |
| IIFE sandboxing | regex-extracting functions from source (`new Function` style of old reference tests) | `getInternalVMContext()` + `vm.runInContext` on the whole file | Whole-file execution exercises real registration, listener wiring, and module state; verified end-to-end |
| Test runner / assertions | any npm test framework | node:test + node:assert/strict | Repo convention; CI needs zero extra installs |
| Deep object diff for the oracle | custom recursive differ | `assert.deepStrictEqual` per message + try/catch to report index/fixture | Built-in produces usable diffs; "first divergence point" = first message index where deepStrictEqual throws |
| Session ID minting in extracted core | new ID scheme | `createStreamSessionId(nowMs, rand)` from `src/protocol/messages.js` | Already extracted, tested, entropy-injected; reference format-compatible (`stream_<ts36>_<rand>`) |
| Wire constants | redefining 1 MiB cap, throttles, budgets | `src/protocol/constants.js` | All reference constants already extracted with provenance comments (RELAY_PER_MESSAGE_LIMIT_BYTES, SNAPSHOT_BUDGET_BYTES, SCROLL_THROTTLE_MS=200, OVERLAY_THROTTLE_MS=500, MUTATION_STALE_THRESHOLD_MS=5000, WATCHDOG_TICK_MS=500, TRUNCATION_VIEWPORT_MULTIPLIER=3, INLINE_STYLE_MAX_BYTES=500000) |

**Key insight:** the reference is the spec. Every place the extracted core could "improve" something (sanitization, computed styles on added nodes, WeakMap identity) is explicitly deferred to a later phase — hand-rolling improvements here breaks the parity bar.

## Reference Source Map (the extraction target)

Audited structure of `reference/extension/dom-stream.js` (1,117 lines) `[VERIFIED: full read]`:

| Section | Lines | Contents | Extraction notes |
|---------|-------|----------|------------------|
| Module state | 13–34 | `streaming`, `pendingMutations`, `nextNodeId`, `streamSessionId`, `currentSnapshotId`, `lastDrainTs`, `staleFlushCount`, `watchdogTimer`, `batchTimer` | Becomes per-`createCapture` closure state |
| Constants | 31, 37–121 | `RELAY_PER_MESSAGE_LIMIT_BYTES`, `URL_ATTRS`, `STYLE_DEFAULTS` (24 entries), `CURATED_PROPS` (~85), `SHELL_PROPS` | Numeric constants → import from `src/protocol/constants.js`; style prop lists move into the capture module (not yet in protocol) |
| Session identity | 123–152 | `createStreamSessionId`, `beginStreamSession`, `attachStreamMetadata`, `assignNodeId` | Use protocol's `createStreamSessionId(nowMs, rand)`; `assignNodeId` stamps BOTH live element and clone |
| Dialog interceptor | 163–254 | page-realm `<script>` injection monkey-patching alert/confirm/prompt → CustomEvents; relay via sendMessage | `fsb-dialog` event names + `fsb-dialog-interceptor` element id are wire-adjacent: keep identical for parity (renaming = divergence ledger entry) |
| Serializer | 266–609 | `isFsbOverlay` (skipElement seam), `absolutifyUrl`/`absolutifySrcset`, `collectComputedStyleText`, `captureComputedStyles`, `serializeShellAttributes`, `serializeDOM` (clone, parallel TreeWalker pairs walk, script/noscript/overlay removal, iframe live-src + pointer-events:none, canvas→img dataURL, URL/xlink/srcset absolutification, stylesheet + inline-style collection, single-pass rect Map, 2-pass truncation) | Largest piece. `isFsbOverlay` checks `data-fsb-overlay` attr/closest + fsb-classed shadow hosts → becomes `skipElement` option default-noop; note `serializeShellAttributes` already strips `on*` attrs on html/body shells only |
| Mutation streaming | 620–874 | `processAddedNode` (nid-stamps added subtree + absolutifies), `processMutationBatch` (childList add/rm, attributes w/ URL absolutify, characterData via parent nid), `flushMutations` (sends + resets stale counter), `startMutationStream` (observer config + rAF batching + watchdog chain), `stopMutationStream` (final flush) | `flushMutations` includes `staleFlushCount` in payload; stop-path final flush does NOT include `staleFlushCount` (lines 859–864) — preserve exactly |
| Scroll tracker | 884–924 | 200 ms timestamp-throttled window scroll listener | passive listener; sends scrollX/scrollY + identity |
| Overlay broadcaster | 934–999 | 500 ms throttled; reads `FSB.actionGlowOverlay`/`FSB.highlightManager`/`FSB.overlayState` | This is the `overlayProvider` seam: provider returns `{glow, progress}`; default = no provider → sends nulls or skips (planner choice — reference sends `{glow:null, progress:null}` when FSB state absent, so sending nulls preserves parity) |
| Control listener | 1005–1087 | `pingDomStream`, `domStreamStart` (re-injection guard → beginStreamSession → snapshot → observers → overlay broadcast), `domStreamStop`, `domStreamPause` (stops observers, keeps streaming=true), `domStreamResume` (reference: NEW session + fresh snapshot — extracted: continue session per user override) | Becomes the `{start, stop, pause, resume}` API; readiness ping becomes unnecessary (host calls functions directly) — ledger entry if `ext:dom-ready` emission changes |
| Registration | 1093–1117 | `FSB.domStream` export, `_modules` stamp, `domStreamReady` ping | Replaced by ESM factory export; `domStreamReady` → `STREAM.READY` via transport on start (or documented divergence) |

### Complete FSB-coupling seam inventory (purity-scan targets)

`chrome.runtime.sendMessage` call sites (8): dialog open relay (221), dialog dismiss relay (240), mutation flush (750), stop-path final flush (859), scroll (897), overlay (987), snapshot on start (1029), snapshot on resume (1066), ready ping (1109). `chrome.runtime.onMessage.addListener` (1): control routing (1005).
`window.FSB` touch points: `FSB.logger` (10), `FSB.actionGlowOverlay`/`FSB.highlightManager` (945–951), `FSB.overlayState` (968), `FSB.domStream` registration (1093), `window.FSB._modules` (1104), `window.__FSB_SKIP_INIT__` guard (7). Loose globals referenced defensively via `typeof`: `rateLimitedWarn`, `redactForLog` — safe to drop (logger replaces them; `typeof`-guarded so removal is invisible on the wire).

### Message-name mapping for the normalizer

Reference sends `{action: 'domStream...'}` objects; extracted sends `transport.send(type, payload)` with `src/protocol` names. Fixed mapping table:

| Reference `action` | Protocol type | Payload location |
|---|---|---|
| `domStreamSnapshot` | `STREAM.SNAPSHOT` (`ext:dom-snapshot`) | `msg.snapshot` ↔ payload |
| `domStreamMutations` | `STREAM.MUTATIONS` (`ext:dom-mutations`) | `{mutations, streamSessionId, snapshotId, staleFlushCount}` |
| `domStreamScroll` | `STREAM.SCROLL` (`ext:dom-scroll`) | `{scrollX, scrollY, ...identity}` |
| `domStreamOverlay` | `STREAM.OVERLAY` (`ext:dom-overlay`) | `{glow, progress, ...identity}` |
| `domStreamDialog` | `STREAM.DIALOG` (`ext:dom-dialog`) | `{dialog}` |
| `domStreamReady` | `STREAM.READY` (`ext:dom-ready`) | `{}` |

This envelope-shape difference is itself a forced divergence (ledger entry: "message envelope is (type, payload) at the transport seam; FSB adapter re-wraps") — the oracle compares payloads after mapping.

## Runtime State Inventory

> Not a rename/refactor-of-live-systems phase in the runtime sense — this is a parallel extraction into new files with the reference kept frozen. Categories checked anyway:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — no databases/datastores in this repo (protocol layer is pure logic; no .env) | None — verified by codebase STACK.md + tree listing |
| Live service config | None — no deployed services owned by this repo; FSB relay is external and untouched | None |
| OS-registered state | None — no scheduled tasks/daemons | None |
| Secrets/env vars | None required for `src/` (verified: no .env, no config reads in protocol/capture paths) | None |
| Build artifacts | None — no build step, no node_modules at baseline (this phase ADDS package-lock.json + node_modules via jsdom devDependency — commit the lockfile) | Plan must commit `package-lock.json` for CI reproducibility |

## Common Pitfalls

### Pitfall 1: `npm test` glob silently skips `tests/differential/`
**What goes wrong:** Current script is `node --test tests/*.test.js` — shell-expanded, top-level only. And `node --test tests/` FAILS on Node 24 (`Cannot find module .../tests` — positional args are now globs, a bare directory is treated as a module path) `[VERIFIED: empirical, Node 24.14.1]`.
**How to avoid:** Change the script to `node --test "tests/**/*.test.js"` (quoted so Node's glob engine handles `**`) — verified to find both top-level and subdirectory tests. Bare `node --test` (default discovery) also works but scans the whole tree.
**Warning signs:** CI green while the oracle never ran; test count not increasing.

### Pitfall 2: Reference `resume` re-snapshots; extracted `resume` must not
**What goes wrong:** `domStreamResume` (line 1061) calls `beginStreamSession()` + `serializeDOM()` — fresh session AND fresh snapshot. The user locked the opposite for the extracted API. A naive differential run of a pause/resume scenario diverges immediately.
**How to avoid:** Divergence-ledger entry D1 from day one; the pause/resume scenario asserts the DECLARED divergence shape (reference emits snapshot+new IDs, extracted continues IDs and emits nothing on resume).
**Warning signs:** oracle failure localized to `ext:dom-snapshot` after resume.

### Pitfall 3: Watchdog timer chain leaks across tests
**What goes wrong:** `startMutationStream` arms a self-re-arming 500 ms `setTimeout` chain; without `stop()` the Node process never exits / timers fire into torn-down DOMs ("extension context invalidated" catch blocks hide it).
**How to avoid:** Every harness run wraps in try/finally calling stop on both sides; `dom.window.close()` in teardown also clears jsdom timers.
**Warning signs:** `node --test` hangs after passing; unhandled errors after tests complete.

### Pitfall 4: jsdom canvas `toDataURL` returns null (doesn't throw)
**What goes wrong:** Without the `canvas` package, `toDataURL()` emits a virtual-console "Not implemented" and **returns null** `[VERIFIED: empirical]`. The reference's try/catch does NOT trigger; it proceeds to create `<img src=null>` → serialized as a resolved bogus URL. Identical on both sides (oracle still valid) but different from real Chrome (dataURL or SecurityError).
**How to avoid:** Include one canvas fixture to LOCK the identical-handling; note in the oracle docs that canvas serialize behavior is only verified for the degenerate path; real-browser phases re-verify. Use a quiet VirtualConsole.
**Warning signs:** console noise; `src="null"`-ish output in snapshot HTML.

### Pitfall 5: Dialog interceptor script never executes under `runScripts: "outside-only"`
**What goes wrong:** The interceptor is injected as a `<script>` with textContent; outside-only does NOT execute injected scripts `[VERIFIED: empirical]` — the alert/confirm/prompt patch never installs, dialog channel silently untested.
**How to avoid:** Dialog scenario fixtures use `runScripts: "dangerously"` (verified working: injected interceptor patched `window.alert` and relayed the CustomEvent). Keep other fixtures script-free under outside-only so fixture `<script>`s can't perturb determinism. jsdom's native alert/confirm/prompt exist as functions `[VERIFIED]`, so calling `window.alert('x')` in a scenario exercises the full open/dismiss relay.
**Warning signs:** zero `ext:dom-dialog` messages in a dialog scenario on BOTH sides (identical-but-empty = false confidence).

### Pitfall 6: Cross-instance configuration drift creates phantom divergences
**What goes wrong:** Anything differing between JSDOM A and B — `url`, `pretendToBeVisual`, fixture bytes, rect patches, Date fakes, scenario await sequencing — shows up as a "divergence" that's actually harness error.
**How to avoid:** One factory function builds both environments from shared config; scenario runner takes the environment as a parameter and is the only code that touches either DOM; reference-vs-reference mode stays as a permanent self-test of the harness (run it first in CI).
**Warning signs:** divergences in fields like `url`, `viewportWidth`, or absolutified URLs.

### Pitfall 7: `html.length` truncation budget is UTF-16 code units, not bytes
**What goes wrong:** Truncation triggers on `clone.innerHTML.length > 838860` (chars). Fixture sizing aimed at "bytes" with multibyte content misses the threshold; or a fixture barely over the cap truncates a different subtree count on tiny serialization differences.
**How to avoid:** Build the truncation fixture programmatically from ASCII repetition with a comfortable margin (e.g., ~1.2–1.5 MB serialized); assert `truncated === true` and equal `missingDescendants` on both sides. Keep the reference's chars-as-bytes behavior verbatim in the extracted core (parity-only phase; it's an inherited quirk, not a bug to fix now).
**Warning signs:** `truncated` flag differing between runs or sides.

### Pitfall 8: Node-global pollution from the extracted side
**What goes wrong:** Setting `globalThis.document/window/Date/...` for the extracted side leaks into other tests in the same file; worst case, a fake `Date` poisons the test runner's own timing.
**How to avoid:** Helper that records prior values, sets globals, and restores in `finally`; keep Date-faking tests in their own test file (per-file process isolation under `node --test`); never fake `setTimeout` globally (fake-Date/real-timer recipe).
**Warning signs:** order-dependent test failures; tests passing alone but failing in suite.

### Pitfall 9: jsdom version skew between local and CI
**What goes wrong:** getComputedStyle output changed materially across 29.0.x → 29.1.x (e.g., border-radius serialization fixed in 29.1.1). Different jsdom versions on the two oracle sides is impossible (same process), but version drift over time changes snapshot HTML and can invalidate any golden files.
**How to avoid:** Commit `package-lock.json`; pin jsdom `^29.1.1`; prefer comparative assertions (A vs B) over golden snapshots so jsdom upgrades can't break the oracle's core claim.
**Warning signs:** oracle failures immediately after dependency updates with no code change.

### Pitfall 10: MutationObserver delivery is per-instance microtask — don't interleave scenario steps across sides
**What goes wrong:** Driving step 1 on A, step 1 on B, step 2 on A... interleaves microtask/rAF queues and can batch mutations differently per side.
**How to avoid:** Run the FULL scenario (with its await points) to completion against side A, then identically against side B, then compare. Scenarios must be pure functions of (window, document) with no shared state.
**Warning signs:** mutation batches split differently (e.g., A: one message with 2 ops; B: two messages with 1 op each).

## Code Examples

(Primary recipes are in Architecture Patterns above; all verified this session.)

### Loopback transport (proves the seam — success criterion 2)
```js
// tests style per TESTING.md: minimal in-file fake, no framework
function createLoopbackTransport() {
  const sent = [];
  return {
    sent,
    send(type, payload) { sent.push({ type, payload }); },
    // flush omitted — exercises the optional-flush default path
  };
}
```

### Purity static-scan test (CAPT-01 enforcement)
```js
// tests/capture-purity.test.js — mirrors reference Strategy-1 invariant style, in node:test form
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

test('capture core contains zero chrome.* and window.FSB references', () => {
  for (const f of readdirSync('src/capture').filter((f) => f.endsWith('.js'))) {
    const src = readFileSync(`src/capture/${f}`, 'utf8');
    assert.ok(!/\bchrome\s*\./.test(src), `${f} references chrome.*`);
    assert.ok(!/window\.FSB|\bFSB\b/.test(src.replace(/\/\/.*$/gm, '')), `${f} references FSB`);
  }
});
```
(Planner refines the FSB regex — comments mentioning provenance are fine to allow via comment-stripping as shown; the wire attribute value `data-fsb-nid` comes from `NID_ATTR` import, so the literal need not appear in capture source.)

### First-divergence reporting
```js
function compareStreams(refMsgs, extMsgs, fixture, scenario, ledger) {
  const a = normalize(refMsgs), b = normalize(extMsgs, { mapped: true });
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    try {
      assert.deepStrictEqual(b[i], a[i]);
    } catch (e) {
      if (ledgerCovers(ledger, a[i], b[i], scenario)) continue;
      throw new Error(`UNDECLARED DIVERGENCE ${fixture}/${scenario} at message ${i}:\n${e.message}`);
    }
  }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| jsdom CSSOM via `cssstyle`/`@acemir/cssom` | Internal CSSOM on css-tree; getComputedStyle resolves cascade, specificity, `!important`, inheritance, system colors | jsdom 29.0.0 (2026-03-15) → 29.1.1 (2026-04-30) | Style capture in the oracle is meaningfully exercised (cascade resolution), not just inline styles `[VERIFIED: release notes + empirical]` |
| jsdom selector engine `nwsapi` | `@asamuzakjp/dom-selector` | jsdom 27.0.0 | `querySelectorAll('[data-fsb-nid]')` & `closest()` more spec-correct |
| `node --test <dir>` recursed directories | Positional args are globs; bare directories error | Node 21+ behavior, confirmed on 24.14.1 | Test script must be `node --test "tests/**/*.test.js"` `[VERIFIED: empirical]` |
| reference tests: regex + `new Function` extraction | whole-file `vm.runInContext` into `getInternalVMContext()` | this phase | Real listener wiring + module state exercised |

**Deprecated/outdated:**
- jsdom ≤ 26 supports Node 18/20.0 but lacks the v27–29 CSS fixes; jsdom 29 requires Node `^20.19.0 || ^22.13.0 || >=24.0.0` — the dev/test floor rises above the repo's documented "Node 18+" (library code itself remains Node-18-compatible; only tests need newer Node).
- `reference/tests/*.test.js` reference FSB paths that don't exist in this repo (`../extension/content/dom-stream.js`, `../extension/background.js`, `fixtures/dom-stream-50k.html`) — they are non-runnable verbatim copies; do not wire them into CI.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | node:test `mock.timers` would NOT intercept jsdom's window timers (jsdom wraps Node timers internally) | Pattern 4 / Pitfall 8 | Low — the recommended fake-Date recipe sidesteps this entirely; only matters if the planner chooses mock.timers instead |
| A2 | Both implementations assign identical nid sequences (TreeWalker document order, counter from 1) given identical DOMs, making nid canonicalization a defensive no-op | Anti-patterns | Low — if wrong, the locked "canonicalize nid ordering" decision already covers it |
| A3 | Sending `{glow: null, progress: null}` overlay messages when no `overlayProvider` is configured preserves wire parity with FSB-absent reference state | Reference Source Map (overlay) | Low — oracle catches any mismatch immediately; alternative (skip send) becomes a ledger entry |
| A4 | GitHub Actions `ubuntu-latest` runners include all needed Node versions via setup-node (no browser deps needed) | CI | Very low — standard; jsdom needs no system packages without `canvas` |

## Open Questions

1. **Does the extracted core emit `ext:dom-ready` and when?**
   - What we know: reference pings `domStreamReady` at module load (script-injection time); the extracted factory has no "load" moment — hosts call `createCapture` explicitly.
   - What's unclear: whether READY belongs in `start()`, in the factory, or becomes an FSB-adapter concern (Phase 6).
   - Recommendation: emit `STREAM.READY` from the factory or on first `start()` and record the timing difference as a ledger entry; planner decides placement. The oracle should exclude or map the ready message explicitly either way.

2. **Should `pingDomStream`/readiness probing survive extraction?**
   - What we know: it exists for MV3 service-worker → content-script polling; direct function calls make it moot.
   - Recommendation: drop from core; note in ledger; the MV3 adapter (Phase 6, ADPT-01) reintroduces it host-side.

3. **Exact `Math.random` handling for session IDs.**
   - What we know: normalization canonicalizes session IDs (locked), so entropy never needs faking for the oracle. Defense tests asserting ID FORMAT can regex-match `^stream_[a-z0-9]+_[a-z0-9]{6}$`.
   - Recommendation: normalize, don't fake. Only revisit if a scenario needs cross-side ID equality (none identified).

4. **CI Node matrix.**
   - What we know: jsdom 29 floor is 20.19/22.13/24; local dev is 24.14.1; repo docs say library targets Node 18+.
   - Recommendation (Claude's discretion granted): matrix `[20, 22, 24]` with setup-node@v6 + checkout@v6; optionally add an `engines`/docs note that tests require Node ≥ 20.19 while `src/` remains 18-compatible.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | test runner, jsdom host | ✓ | v24.14.1 (satisfies jsdom engines) | — |
| npm | jsdom install | ✓ | 11.11.0 | — |
| jsdom (installable) | oracle harness | ✓ (verified by real install in /tmp, 0 vulns) | 29.1.1 | — |
| git | commits | ✓ | repo functional | — |
| gh CLI | (optional) CI inspection | ✓ | functional | — |
| GitHub Actions | CI (created this phase) | external — assumed reachable from repo `github.com/fullselfbrowsing/PhantomStream` | n/a | local `npm test` remains authoritative |

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:** none.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | node:test + node:assert/strict (built-in, Node 24.14.1 local) |
| Config file | none — invoked via package.json script |
| Quick run command | `node --test tests/protocol.test.js` (or any single file) |
| Full suite command | `npm test` — **must change to** `node --test "tests/**/*.test.js"` this phase |

Baseline: `npm test` green — 8/8 protocol tests pass `[VERIFIED: ran this session]`.

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CAPT-01 | Zero chrome./FSB refs in src/capture | static-scan unit | `node --test tests/capture-purity.test.js` | ❌ Wave 0/early |
| CAPT-01 | Emits through injected Transport (loopback) | unit | `node --test tests/capture-transport.test.js` (or folded into defenses file) | ❌ |
| CAPT-02 | start/stop fresh-session; pause/resume continuation | unit | `node --test tests/capture-lifecycle.test.js` | ❌ |
| CAPT-03 | rAF-batched diffs | unit (jsdom, pretendToBeVisual) | `node --test tests/capture-defenses.test.js` | ❌ |
| CAPT-03 | watchdog force-flush + staleFlushCount | unit (fake-Date recipe) | same file (own test) | ❌ |
| CAPT-03 | identity stamping on every message type | unit | same file (own test) | ❌ |
| CAPT-03 | budgeted truncation + single-pass rect reads | unit (rect-prototype patch) | same file (own test) | ❌ |
| CAPT-04 | reference-vs-extracted equivalence on fixtures; undeclared divergence fails | integration | `node --test tests/differential/oracle.test.js` | ❌ |
| CAPT-04 | harness self-test: reference-vs-reference green | integration | same harness, self-test mode | ❌ |

### Sampling Rate
- **Per task commit:** `node --test "tests/**/*.test.js"` (full suite is fast — jsdom unit scale, <30 s expected)
- **Per wave merge:** same full suite + CI workflow run
- **Phase gate:** full suite green incl. oracle on all fixtures before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `npm install --save-dev jsdom@^29.1.1` + commit `package-lock.json`
- [ ] package.json test script → `node --test "tests/**/*.test.js"`
- [ ] `tests/differential/` harness skeleton + fixtures (oracle MUST precede serializer extraction — locked ordering)
- [ ] `.github/workflows/test.yml` (no CI exists)
- [ ] All test files above (no capture tests exist yet)

## Security Domain

> `security_enforcement` not set in config → treated as enabled. Phase scope is dev-only tooling + extraction without behavior change; full sanitization pipeline is Phase 3 (SEC-01..03) by locked decision.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | — (no auth surface in this phase) |
| V3 Session Management | no | stream "sessions" are identity stamps, not security sessions |
| V4 Access Control | no | — |
| V5 Input Validation | partial | Fixtures are frozen, repo-controlled HTML (research-integrity constraint doubles as supply-chain control); `runScripts: "dangerously"` ONLY for the trusted dialog fixture |
| V6 Cryptography | no | — |
| V14 Config/Dependencies | yes | jsdom dev-only, lockfile committed, slopcheck [OK], no postinstall; never moves to `dependencies` |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Hallucinated/squatted npm package | Tampering | slopcheck gate run: jsdom [OK], 74M dl/wk, official repo |
| Untrusted HTML executing in test env | Elevation | fixtures frozen + checked-in; `runScripts: "outside-only"` default; "dangerously" confined to dialog fixtures |
| Known sanitization gap carried forward (`on*` attrs only stripped on html/body shells; `javascript:` URLs passed through by absolutifyUrl) | Tampering | **Intentionally preserved this phase** (parity-only, locked); Phase 3 (SEC-01) fixes in all serialization paths — plan must NOT "fix" it here |
| CI workflow exfiltration | Info disclosure | minimal workflow, no secrets needed (`npm test` only); default GITHUB_TOKEN read-only permissions block |

## Sources

### Primary (HIGH confidence)
- Empirical spikes against jsdom 29.1.1 on Node 24.14.1 (this session): full capability matrix incl. loading the actual `reference/extension/dom-stream.js` end-to-end; Date/rAF context overrides; `runScripts` behaviors; rect prototype patching; `node --test` globbing
- Codebase reads: `reference/extension/dom-stream.js` (full), `src/protocol/*` (full), `tests/protocol.test.js`, `reference/tests/stream-candidate-resolution.test.js`, `reference/tests/dom-stream-perf.test.js`, `.planning/codebase/TESTING.md`, `package.json`
- jsdom official README (github.com/jsdom/jsdom): pretendToBeVisual, runScripts, getInternalVMContext, layout/canvas limitations
- jsdom GitHub releases v27.0.0–v29.1.1: CSSOM overhaul, getComputedStyle improvements, Node engine floors
- npm registry: jsdom version/engines/postinstall; npmjs downloads API (74.1M/wk)
- GitHub releases API: actions/checkout v6.0.3, actions/setup-node v6.4.0
- slopcheck 0.6.1 run: jsdom [OK]

### Secondary (MEDIUM confidence)
- none needed — all critical claims verified primarily

### Tertiary (LOW confidence)
- A1 (mock.timers × jsdom timer interception) — untested, deliberately routed around

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — single devDependency, verified on registry + slopcheck + actual install + empirical use
- Architecture (oracle mechanics): HIGH — the load-bearing recipe (reference IIFE in jsdom via getInternalVMContext + chrome stubs → snapshot + mutation stream) executed successfully against the real source this session
- Pitfalls: HIGH for the 10 listed (each grounded in a verified behavior or a locked decision); MEDIUM only on A1–A3 edge details, all with cheap fallbacks
- jsdom fidelity limits: HIGH that they exist and are identical-per-side (zeros rects, null toDataURL, no layout); correctly scoped as "not caught by this oracle" per the locked decision

**Research date:** 2026-06-09
**Valid until:** ~2026-07-09 (jsdom releases monthly-ish; pin via lockfile makes drift a non-issue for the phase)
