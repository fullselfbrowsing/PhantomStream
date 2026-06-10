# Phase 1: Capture Core Extraction + Differential Oracle - Pattern Map

**Mapped:** 2026-06-09
**Files analyzed:** 13 new/modified files
**Analogs found:** 9 / 13 (4 have no in-repo analog; RESEARCH.md recipes fill the gaps)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/capture/index.js` | library module (capture core) | event-driven + transform | `src/protocol/envelope.js` (style/seams) + `reference/extension/dom-stream.js` (behavior) | exact (split across two analogs) |
| `src/capture/README.md` | docs (modify) | — | itself (`src/capture/README.md`) | exact |
| `tests/capture-purity.test.js` | test (static scan) | file-I/O | `reference/tests/dom-stream-perf.test.js` (strategy) + `tests/protocol.test.js` (style) | role-match |
| `tests/capture-defenses.test.js` | test (unit, jsdom) | event-driven | `tests/protocol.test.js` | role-match |
| `tests/capture-lifecycle.test.js` (planner may fold into defenses) | test (unit) | request-response | `tests/protocol.test.js` | role-match |
| `tests/differential/harness.js` | test utility | batch/transform | `reference/tests/stream-candidate-resolution.test.js` (vm pattern, reference side only) | partial |
| `tests/differential/normalize.js` | utility (pure transform) | transform | `src/protocol/messages.js` (pure-function style) | role-match |
| `tests/differential/divergence-ledger.js` | config/data module | — | `src/protocol/messages.js` (grouped exported consts) | role-match |
| `tests/differential/oracle.test.js` | test (integration) | batch | `tests/protocol.test.js` | role-match |
| `tests/differential/fixtures/*.html` | fixture data | — | none | no analog |
| `tests/differential/scenarios/*.js` | test data (pure drivers) | transform | none | no analog |
| `.github/workflows/ci.yml` | config (CI) | — | none (no `.github/` exists) | no analog |
| `package.json` + `package-lock.json` | config (modify) | — | itself | exact |

**Verified absences:** `.github/` does not exist (Glob empty); `reference/tests/fixtures/` does not exist; no jsdom usage anywhere in the repo yet; no `dependencies`/`devDependencies` in `package.json`.

---

## Pattern Assignments

### `src/capture/index.js` (library module, event-driven + transform)

**Behavioral analog:** `reference/extension/dom-stream.js` (1,117 lines — the spec; copy behavior verbatim, swap only the two seams).
**Style analog:** `src/protocol/envelope.js` + `src/protocol/messages.js`.

**Module header + injected-dependency rationale** — copy from `src/protocol/envelope.js` lines 1-16. This is the exact pattern the Transport seam mirrors (codec injected, not imported):

```javascript
// PhantomStream compression envelope.
//
// Large payloads travel as a self-identifying envelope { _lz: true, d: <base64> }
// ...
// The LZ-string implementation is injected rather than imported so this module
// works in any runtime (extension content script, service worker, browser,
// Node) and stays dependency-free.

/**
 * @typedef {Object} LZCodec
 * @property {(s: string) => string} compressToBase64
 * @property {(s: string) => string|null} decompressFromBase64
 */
```

Capture should define `@typedef Transport` (`{ send(type, payload), flush?() }`) and `@typedef CaptureOptions` (`{ logger, overlayProvider, skipElement }`) the same way.

**Defensive injected-dependency guard + `||` defaulting** — `src/protocol/envelope.js` lines 27-34:

```javascript
export function encodeEnvelope(msg, lz, thresholdBytes) {
  var json = JSON.stringify(msg);
  var threshold = thresholdBytes || 0;
  if (!lz || typeof lz.compressToBase64 !== 'function' || json.length <= threshold) {
    return json;
  }
  ...
}
```

Note: `var` + inline `||` defaulting is INTENTIONAL in cross-runtime `src/` files (per CLAUDE.md conventions). The capture core is the most cross-runtime file in the repo — same style applies. Optional `transport.flush` gets a no-op default via the same `typeof` guard shape.

**Constants: import, never redefine** — `src/protocol/constants.js` already holds every numeric the reference hardcodes. Import these (lines 9, 27, 30, 33, 39, 42, 49):

```javascript
export const RELAY_PER_MESSAGE_LIMIT_BYTES = 1048576; // 1 MiB
export const TRUNCATION_VIEWPORT_MULTIPLIER = 3;
export const SCROLL_THROTTLE_MS = 200;
export const OVERLAY_THROTTLE_MS = 500;
export const MUTATION_STALE_THRESHOLD_MS = 5000;
export const WATCHDOG_TICK_MS = 500;
export const INLINE_STYLE_MAX_BYTES = 500000;
```

Also import `NID_ATTR` (`src/protocol/messages.js` line 51) instead of the literal `'data-fsb-nid'` (which appears ~14 times in the reference), and `STREAM` message types (lines 15-32). CAUTION: reference line 549 computes `Math.floor(RELAY_PER_MESSAGE_LIMIT_BYTES * 0.8)` inline — `SNAPSHOT_BUDGET_BYTES` (constants.js line 19) is exactly this value; use it.

**Session identity: injected entropy** — `src/protocol/messages.js` lines 86-93 replaces reference lines 123-125:

```javascript
/**
 * Mint a stream session id. Caller supplies entropy so the protocol layer
 * stays pure (and replayable in tests).
 * @param {number} nowMs   e.g. Date.now()
 * @param {string} rand    short random suffix, e.g. Math.random().toString(36).slice(2, 8)
 */
export function createStreamSessionId(nowMs, rand) {
  return 'stream_' + nowMs.toString(36) + '_' + rand;
}
```

The capture core calls it as `createStreamSessionId(Date.now(), Math.random().toString(36).slice(2, 8))` inside `beginStreamSession()` — preserving reference line 124 byte-for-byte on the wire.

**Module state → closure state** — `reference/extension/dom-stream.js` lines 13-34. Every `var` here becomes per-`createCapture` closure state (so two captures can coexist in the oracle's process):

```javascript
  var streaming = false;
  var mutationObserver = null;
  var batchTimer = null;
  var pendingMutations = [];
  var nextNodeId = 1;
  var scrollHandler = null;
  var lastScrollSend = 0;
  var dialogRelayActive = false;
  var lastOverlayBroadcast = 0;
  var streamSessionId = '';
  var currentSnapshotId = 0;
  var lastDrainTs = 0;
  var staleFlushCount = 0;
  var watchdogTimer = null;
```

**The Transport seam (8 call sites)** — pattern at `reference/extension/dom-stream.js` lines 749-760 (mutation flush; the other 7 sites are identical in shape — lines 221, 240, 859, 897, 987, 1029, 1066, 1109):

```javascript
    try {
      chrome.runtime.sendMessage({
        action: 'domStreamMutations',
        mutations: diffs,
        streamSessionId: streamSessionId || '',
        snapshotId: currentSnapshotId || 0,
        staleFlushCount: staleFlushCount
      }).catch(function(err) {
        if (typeof rateLimitedWarn === 'function') { ... }
      });
    } catch (e) {
      // Extension context may be invalidated
    }
```

becomes `transport.send(STREAM.MUTATIONS, { mutations: diffs, streamSessionId: streamSessionId || '', snapshotId: currentSnapshotId || 0, staleFlushCount: staleFlushCount })` wrapped in try/catch routing errors to the injected `logger` (never thrown into the capture path — locked decision). Drop the `typeof rateLimitedWarn`/`redactForLog` guards entirely (typeof-guarded loose globals; removal is wire-invisible).

PARITY TRAP: the stop-path final flush (lines 858-864) sends mutations WITHOUT `staleFlushCount` while the normal flush (lines 750-755) includes it. Preserve this asymmetry exactly.

**rAF batching + watchdog chain (defense — copy verbatim)** — lines 784-828:

```javascript
    mutationObserver = new MutationObserver(function(mutations) {
      for (var i = 0; i < mutations.length; i++) {
        pendingMutations.push(mutations[i]);
      }
      if (batchTimer) cancelAnimationFrame(batchTimer);
      batchTimer = requestAnimationFrame(flushMutations);
    });

    mutationObserver.observe(document.body, {
      childList: true, attributes: true, characterData: true,
      subtree: true, attributeOldValue: true
    });

    lastDrainTs = Date.now();
    if (watchdogTimer) clearTimeout(watchdogTimer);
    var watchdogTick = function() {
      try {
        if (pendingMutations.length > 0 && (Date.now() - lastDrainTs) > 5000) {
          staleFlushCount++;                 // increment BEFORE forced flush
          if (batchTimer) {
            cancelAnimationFrame(batchTimer);
            batchTimer = null;
          }
          flushMutations();
        }
      } catch (e) { /* watchdog must not crash the content script */ }
      watchdogTimer = setTimeout(watchdogTick, 500);
    };
    watchdogTimer = setTimeout(watchdogTick, 500);
```

(`5000` → `MUTATION_STALE_THRESHOLD_MS`, `500` → `WATCHDOG_TICK_MS` via imports. setTimeout CHAIN, not setInterval — locked defense.)

**Control listener → lifecycle API** — lines 1005-1087 map to the factory return:
- `domStreamStart` (1017-1043) → `start()`: re-injection guard (`if (streaming) { stopMutationStream(); stopScrollTracker(); }`), then `beginStreamSession()` → `serializeDOM()` → send snapshot → `startMutationStream()` → `startScrollTracker()` → `streaming = true` → `broadcastOverlayState(true)`.
- `domStreamStop` (1045-1051) → `stop()`: stop both, `streaming = false`.
- `domStreamPause` (1053-1059) → `pause()`: stop both, KEEP `streaming = true` (reference comment line 1057: "Keep streaming = true (paused state, not stopped)").
- `domStreamResume` (1061-1080) → `resume()`: **DO NOT COPY the reference body.** Reference calls `beginStreamSession()` + `serializeDOM()` + snapshot send; the locked user override is resume re-arms observers/scroll WITHOUT new session/snapshot. This is divergence-ledger entry D1.
- `pingDomStream` (1007-1015): drop from core (direct function calls make it moot); ledger note.

**The `skipElement` seam** — `isFsbOverlay` (lines 266-276) is the default-able predicate. Its call sites (serializer line 416-424 clone-side, mutation filter lines 661-666, 674) route through `options.skipElement` with default `function() { return false; }`. The clone-side check at lines 416-424 reads `data-fsb-overlay` attributes directly — the planner must decide whether the clone-side filter also delegates to `skipElement` (recommended: yes, pass the clone element); either way the no-FSB-environment behavior (nothing skipped) is identical to the reference running on a page with no FSB overlay, so the oracle won't see a difference on fixtures.

**The `overlayProvider` seam** — `broadcastOverlayState` (lines 934-999) reads `FSB.actionGlowOverlay`/`FSB.highlightManager`/`FSB.overlayState` inside try/catch and sends `{glow: null, progress: null}` when absent. Replace the FSB reads with `options.overlayProvider` (returns `{glow, progress}` or null); default no provider → send `{glow: null, progress: null, ...identity}` — preserves wire parity with FSB-absent reference state (RESEARCH.md assumption A3; oracle verifies).

**Logger seam** — every `logger.info('[DOM Stream] ...')` call (lines 830, 873, 912, 923, 1018, 1046, 1054, 1062, 1116) routes to `options.logger` with console-backed default. Keep the exact log strings (cheap, aids debugging against reference traces).

**Dialog interceptor** — lines 163-254 extracted as-is; `fsb-dialog`/`fsb-dialog-dismiss` event names and the `fsb-dialog-interceptor` element id are wire-adjacent — keep identical (renaming = ledger entry). The two `chrome.runtime.sendMessage({action:'domStreamDialog', dialog: ...})` sites (221, 240) become `transport.send(STREAM.DIALOG, { dialog: attachStreamMetadata({...}) })`.

---

### `tests/capture-purity.test.js` (test, static scan / file-I/O)

**Strategy analog:** `reference/tests/dom-stream-perf.test.js` lines 32-44 (source-text invariant scan — Strategy 1 in TESTING.md):

```javascript
const dsSource = fs.readFileSync(
  path.join(__dirname, '..', 'extension', 'content', 'dom-stream.js'),
  'utf8'
);
assert(dsSource.includes('document.createTreeWalker'), 'TreeWalker pre-pass present');
assert(!dsSource.includes("document.querySelector('[data-fsb-nid=\"' + nidVal"),
  'old per-element querySelector hot path removed');
```

**Style analog (translate the strategy into this form):** `tests/protocol.test.js` lines 1-2 imports + flat `test()`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
```

Combined shape (RESEARCH.md provides the refined version — scan every `src/capture/*.js`, strip `//` comments before the FSB regex so provenance comments survive, assert no `\bchrome\s*\.` and no `window.FSB`). Full-sentence test name per convention, e.g. `test('capture core contains zero chrome.* and window.FSB references', ...)`.

---

### `tests/capture-defenses.test.js` / `tests/capture-lifecycle.test.js` (tests, unit)

**Analog:** `tests/protocol.test.js` — the canonical new-style test file.

**Imports + inline fake pattern** (lines 1-17):

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  encodeEnvelope,
  ...
} from '../src/protocol/index.js';

// Minimal LZ-compatible codec for tests (reversible, not actually compressing).
const fakeLz = {
  compressToBase64: (s) => Buffer.from(s, 'utf8').toString('base64'),
  decompressFromBase64: (s) => Buffer.from(s, 'base64').toString('utf8'),
};
```

The capture equivalent of `fakeLz` is the loopback transport (CONTEXT success criterion 2):

```javascript
function createLoopbackTransport() {
  const sent = [];
  return {
    sent,
    send(type, payload) { sent.push({ type, payload }); },
    // flush omitted — exercises the optional-flush default path
  };
}
```

**Flat test with behavior-sentence name + identity assertions** (lines 59-70):

```javascript
test('staleness guard rejects mismatched stream identity', () => {
  const active = { streamSessionId: 'stream_a_1', snapshotId: 100 };
  assert.equal(isCurrentStream({ streamSessionId: 'stream_a_1', snapshotId: 100 }, active), true);
  ...
});

test('session ids are deterministic given entropy', () => {
  assert.equal(createStreamSessionId(1000000, 'abc123'), 'stream_lfls_abc123');
});
```

No `describe` blocks; no mocking framework; explicit time/entropy. For jsdom-hosted tests there is NO in-repo analog — use RESEARCH.md Pattern 2 (globals from a second JSDOM, tracked and restored in `finally`), Pattern 3 (microtask → rAF → settle await sequence), Pattern 4 (fake-Date/real-setTimeout watchdog recipe — keep Date-faking tests in their OWN file for process isolation), Pattern 5 (`Element.prototype.getBoundingClientRect` patch reading `data-test-top`). Teardown ALWAYS calls `capture.stop()` + `dom.window.close()` in `finally` (watchdog chain leak — RESEARCH Pitfall 3).

---

### `tests/differential/harness.js` (test utility, batch/transform)

**Partial analog (reference side only):** `reference/tests/stream-candidate-resolution.test.js` lines 20-66 — the repo's existing "load IIFE into vm context with chrome stubs and recorded calls" harness factory:

```javascript
function createHarness(tabs) {
  const queryCalls = [];
  const badgeCalls = [];
  const context = {
    console, URL, Set, Date, Promise,
    WebSocket: function WebSocket() {},
    chrome: {
      tabs: { get: async function get(tabId) {...}, query: async function query(query) {...} },
      runtime: { lastError: null },
      action: { setBadgeText: (payload) => badgeCalls.push(['text', payload]), ... }
    }
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(wsClientSource + '\n' + 'globalThis.__FSBWebSocketClass = FSBWebSocket;\n', context);
  return { context, queryCalls, badgeCalls, client: new context.__FSBWebSocketClass() };
}
```

Copy the SHAPE (factory returning `{context, recordedCalls...}`, stubs that push into arrays), but the context construction is superseded by the verified jsdom recipe — RESEARCH.md Pattern 1: `dom.getInternalVMContext()` instead of `vm.createContext`, two-key chrome stub (`sendMessage` returning `Promise.resolve()` so `.catch()` chains work + `onMessage.addListener` capturing the control listener), minimal `ctx.window.FSB = { logger: {...}, _modules: {} }` stub, `new JSDOM(fixtureHtml, { url: 'https://fixture.test/page', pretendToBeVisual: true, runScripts: 'outside-only', virtualConsole: vc })`. Drive lifecycle via the captured `controlListener({ action: 'domStreamStart' }, {}, () => {})` — exactly how the extension background would.

This harness file is the ONLY code that touches either DOM (RESEARCH Pitfall 6); one shared-config factory builds both sides; reference-vs-reference mode remains a permanent self-test.

---

### `tests/differential/normalize.js` (utility, transform)

**Style analog:** `src/protocol/messages.js` — pure JSDoc'd functions + grouped const mapping table. The message-name mapping is fixed (RESEARCH.md):

| Reference `action` | Protocol type | Payload location |
|---|---|---|
| `domStreamSnapshot` | `STREAM.SNAPSHOT` | `msg.snapshot` ↔ payload |
| `domStreamMutations` | `STREAM.MUTATIONS` | `{mutations, streamSessionId, snapshotId, staleFlushCount}` |
| `domStreamScroll` | `STREAM.SCROLL` | `{scrollX, scrollY, ...identity}` |
| `domStreamOverlay` | `STREAM.OVERLAY` | `{glow, progress, ...identity}` |
| `domStreamDialog` | `STREAM.DIALOG` | `{dialog}` |
| `domStreamReady` | `STREAM.READY` | `{}` |

Import `STREAM` from `src/protocol/messages.js` (lines 15-32) — never restate the `ext:` strings. Canonicalize ONLY `streamSessionId`, `snapshotId`, and (defensively, as documented fallback) nid ordering; prefer raw nid equality first (RESEARCH anti-pattern: over-normalizing destroys signal).

---

### `tests/differential/divergence-ledger.js` (config/data module)

**Style analog:** `src/protocol/messages.js` lines 7-12 — grouped exported const object with per-entry JSDoc:

```javascript
/** Viewer -> capture host: stream lifecycle control. */
export const CONTROL = {
  START: 'dash:dom-stream-start',
  STOP: 'dash:dom-stream-stop',
  ...
};
```

Apply that shape to the ledger schema from RESEARCH.md Pattern 6 (`export const DIVERGENCES = [{ id, description, rationale, affectedMessages, affectedScenarios, appliesTo(refMsg, extMsg, scenarioName) }]`). Known entries from day one: **D1** resume-no-resnapshot (reference lines 1061-1080 re-snapshot; extracted does not — USER OVERRIDE), **D2** envelope shape (`{action, ...}` vs `(type, payload)` — handled by the normalizer mapping, declared for documentation), **D3** ready-ping timing (reference pings at script load, line 1109; extracted emits on factory/start — planner places it), **D4** `pingDomStream` dropped. Harness fails on any mismatch not claimed by an entry AND on entries that never match (stale-entry detection).

---

### `tests/differential/oracle.test.js` (test, integration)

**Analog:** `tests/protocol.test.js` (flat `test()` style) + first-divergence reporting from RESEARCH.md:

```javascript
for (let i = 0; i < n; i++) {
  try {
    assert.deepStrictEqual(b[i], a[i]);
  } catch (e) {
    if (ledgerCovers(ledger, a[i], b[i], scenario)) continue;
    throw new Error(`UNDECLARED DIVERGENCE ${fixture}/${scenario} at message ${i}:\n${e.message}`);
  }
}
```

One `test()` per fixture × scenario (full-sentence names, e.g. `test('reference and extracted captures emit identical streams for mutation-burst on basic.html', ...)`). Run the FULL scenario to completion on side A, then side B — never interleave (Pitfall 10). Each `node --test` file is its own process — keep oracle in one file, fake-Date watchdog tests in another.

---

### `tests/differential/fixtures/*.html` + `scenarios/*.js`

**No analog** (no fixture files exist anywhere; `reference/tests/fixtures/` referenced by old FSB tests does not exist in this repo). Author fresh per RESEARCH.md fixture matrix: `basic.html`, `heavy-realistic.html`, `truncation-overflow.html` (build programmatically from ASCII repetition, ~1.2-1.5 MB serialized — budget is UTF-16 code units, Pitfall 7), one canvas fixture (locks the degenerate `toDataURL → null` path, Pitfall 4), one dialog fixture (the ONLY one run with `runScripts: 'dangerously'`, Pitfall 5). Scenarios are pure functions of `(window, document)` with the fixed await cadence (mutate → `setTimeout 0` → `requestAnimationFrame` → `setTimeout 20`).

---

### `.github/workflows/ci.yml` (config, CI)

**No analog** — `.github/` does not exist. Minimal workflow per RESEARCH.md: `actions/checkout@v6` + `actions/setup-node@v6`, Node matrix `[20, 22, 24]` (jsdom 29 engine floor is 20.19/22.13/24), `npm ci` + `npm test`, no secrets, default read-only `GITHUB_TOKEN` permissions. (RESEARCH suggests filename `test.yml`; orchestrator scope says `ci.yml` — either satisfies the criterion; planner picks one.)

---

### `package.json` (config, modify)

Current state, lines 7-12:

```json
  "exports": {
    "./protocol": "./src/protocol/index.js"
  },
  "scripts": {
    "test": "node --test tests/*.test.js"
  },
```

Three changes:
1. Add `"./capture": "./src/capture/index.js"` to `exports` (mirror the existing `"./protocol"` entry shape exactly).
2. Change test script to `node --test "tests/**/*.test.js"` (quoted — Node 24 positional args are globs; bare directory args FAIL; the current `tests/*.test.js` shell glob silently skips `tests/differential/` — Pitfall 1).
3. `npm install --save-dev jsdom@^29.1.1` adds the first `devDependencies` block + creates `package-lock.json` (COMMIT the lockfile — CI reproducibility; do NOT let it land in `dependencies` — the slopcheck tool did exactly that during research and was reverted).

---

## Shared Patterns

### ESM module shape (all new `src/` code)
**Source:** `src/protocol/index.js` (lines 1-3) + `src/protocol/envelope.js`
**Apply to:** `src/capture/index.js`
```javascript
export * from './constants.js';   // barrel style; explicit .js extensions on ALL relative imports
```
Named exports only, no default exports. JSDoc on every export; numeric literals commented with units/derivation (`1048576; // 1 MiB`); provenance comments link constants to FSB phases.

### Error handling: never throw from the hot path
**Source:** `reference/extension/dom-stream.js` (try/catch around every send, lines 749-763; watchdog line 825 "watchdog must not crash the content script") + `src/protocol/envelope.js` (discriminated unions, lines 44-66)
**Apply to:** `src/capture/index.js` (transport/logger error routing), `tests/differential/harness.js`
- Capture path: try/catch → `logger.error(...)`, swallow, continue. Transport errors NEVER propagate (locked decision).
- Fallible utility functions (if any are exported): return `{ok: true, ...}` / `{ok: false, error: 'lowercase-hyphenated-id'}` — never throw.

### Injected dependencies, explicit time/entropy
**Source:** `src/protocol/envelope.js` (LZ codec param) + `src/protocol/messages.js` `createStreamSessionId(nowMs, rand)` + `tests/protocol.test.js` `fakeLz`
**Apply to:** `src/capture/index.js` (transport, logger, overlayProvider, skipElement all injected), every test file (loopback transport, fake Date via context override — never `mock.timers`).

### Test conventions (all `tests/` files)
**Source:** `tests/protocol.test.js` + `.planning/codebase/TESTING.md`
**Apply to:** all five new test files
Flat `test()` calls (no `describe`), `node:assert/strict`, full-sentence behavior descriptions, inline fakes at the top of the file, one test per logical behavior, backward-compat tests where extracted code must interoperate with FSB (the oracle IS that test for this phase).

### Teardown discipline (jsdom-hosted tests only)
**Source:** RESEARCH.md Pitfalls 3 & 8 (no in-repo analog — first jsdom tests in this repo)
**Apply to:** `tests/differential/*`, `tests/capture-defenses.test.js`, `tests/capture-lifecycle.test.js`
try/finally: `capture.stop()` (or `controlListener({action:'domStreamStop'}, ...)` on the reference side) + `dom.window.close()` + restore any `globalThis` keys that were set. Keep `globalThis.Date`-swapping tests in their own file.

---

## No Analog Found

Files with no close match in the codebase (planner should use RESEARCH.md patterns instead):

| File | Role | Data Flow | Reason | RESEARCH.md fallback |
|------|------|-----------|--------|----------------------|
| `tests/differential/fixtures/*.html` | fixture data | — | No HTML fixtures exist in repo | Fixture matrix + Pitfalls 4/5/7 |
| `tests/differential/scenarios/*.js` | test data | transform | No scenario-driver pattern exists | Pattern 3 (await cadence), Pitfall 10 |
| `.github/workflows/ci.yml` | CI config | — | No `.github/` directory | actions/checkout@v6, setup-node@v6, matrix [20,22,24] |
| dual-JSDOM oracle environment | test infra | batch | First jsdom usage in repo (vm-harness analog covers reference side only) | Patterns 1-2 (verified empirically against the actual reference source) |

## Metadata

**Analog search scope:** `src/protocol/`, `tests/`, `reference/tests/`, `reference/extension/`, `src/capture/`, `.github/`
**Files scanned:** 11 read in full (4 protocol modules, protocol test, dom-stream.js, 2 reference tests, package.json, capture README, TESTING.md); 2 globs (reference/tests listing, .github absence)
**Pattern extraction date:** 2026-06-09
