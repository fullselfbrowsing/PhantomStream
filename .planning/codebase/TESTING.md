# Testing Patterns

**Analysis Date:** 2026-06-09

## Two Test Styles

This repository has two test zones with fundamentally different approaches:

| Zone | Path | Runner | Module system | Target |
|------|------|--------|---------------|--------|
| New framework tests | `tests/` | `node:test` | ESM `import` | `src/` modules |
| FSB reference tests | `reference/tests/` | bare `node script.js` | CJS `require` | `reference/` source |

New code in `src/` must use the **new-style** (`node:test`) patterns. The reference tests in `reference/tests/` are verbatim FSB source — study them for understanding; do not replicate their style in `tests/`.

---

## Test Framework (New Style)

**Runner:**
- `node:test` (built into Node.js ≥ 18) — no extra install
- Config: none — runner is invoked directly via the `test` script in `package.json`

**Assertion Library:**
- `node:assert/strict` — strict equality mode by default

**Run Commands:**
```bash
node --test tests/*.test.js   # Run all tests (from package.json "test" script)
npm test                      # Same via npm
```

No watch mode or coverage command is currently configured.

---

## Test File Organization (New Style)

**Location:** Co-located in `tests/` directory alongside `src/`

**Naming:** `<module-name>.test.js` — e.g., `tests/protocol.test.js` for `src/protocol/`

**Structure:**
```
managua/
├── src/
│   └── protocol/
│       ├── constants.js
│       ├── envelope.js
│       ├── messages.js
│       └── index.js
└── tests/
    └── protocol.test.js     ← tests for the entire protocol module
```

---

## Test Structure (New Style)

**Suite organization — flat `test()` calls, no nesting:**
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeEnvelope, decodeEnvelope, ... } from '../src/protocol/index.js';

test('envelope round-trips a compressed message', () => { ... });
test('small payloads below threshold stay plain JSON', () => { ... });
test('plain messages decode without a codec (backward compat)', () => { ... });
```

**No `describe` blocks** in existing tests — all tests at the top level. Use this flat style for new tests.

**Test description format:**
- Full-sentence descriptions written as observable behavior: `'envelope round-trips a compressed message'`, `'small payloads below threshold stay plain JSON'`
- Error cases stated as outcome: `'compressed envelope without a codec fails loud, not silent'`
- Property/invariant tests: `'snapshot budget stays inside the relay cap with headroom'`

---

## Mocking (New Style)

**No mocking framework** — manual in-file stubs only.

**Pattern: minimal fake implementation at the top of the test file:**
```js
// Minimal LZ-compatible codec for tests (reversible, not actually compressing).
const fakeLz = {
  compressToBase64: (s) => Buffer.from(s, 'utf8').toString('base64'),
  decompressFromBase64: (s) => Buffer.from(s, 'base64').toString('utf8'),
};
```

This works because `src/protocol/envelope.js` uses **injected dependencies** — codecs are passed as parameters, not imported. Tests inject the minimal fake instead of a real LZ codec.

**What to mock:**
- External I/O (codecs, transports) — use injected minimal fakes
- Time/entropy — pass explicit values: `createStreamSessionId(1000000, 'abc123')`

**What NOT to mock:**
- Protocol logic itself — test the real implementation

---

## Fixtures and Test Data (New Style)

**Inline literals** — test data is declared inline in each test:
```js
test('envelope round-trips a compressed message', () => {
  const msg = { type: 'ext:dom-snapshot', payload: { html: '<div>hi</div>', snapshotId: 7 } };
  ...
});
```

No separate fixture files exist yet for `tests/`. The reference tests use file-based fixtures (e.g., `reference/tests/fixtures/dom-stream-50k.html`), but the new style keeps data inline.

---

## Test Patterns (New Style)

**Happy path with round-trip verification:**
```js
test('envelope round-trips a compressed message', () => {
  const msg = { type: 'ext:dom-snapshot', payload: { html: '<div>hi</div>', snapshotId: 7 } };
  const wire = encodeEnvelope(msg, fakeLz);
  assert.ok(isCompressedEnvelope(JSON.parse(wire)));
  const out = decodeEnvelope(wire, fakeLz);
  assert.equal(out.ok, true);
  assert.deepEqual(out.msg, msg);
});
```

**Threshold/boundary test:**
```js
test('small payloads below threshold stay plain JSON', () => {
  const msg = { type: 'ext:dom-scroll', payload: { scrollX: 0, scrollY: 10 } };
  const wire = encodeEnvelope(msg, fakeLz, 1024);  // threshold larger than payload
  assert.equal(isCompressedEnvelope(JSON.parse(wire)), false);
  ...
});
```

**Backward-compatibility test (no codec needed):**
```js
test('plain messages decode without a codec (backward compat)', () => {
  const out = decodeEnvelope(JSON.stringify({ type: 'ext:dom-ready' }));
  assert.equal(out.ok, true);
});
```

**Explicit failure test — error identity checked:**
```js
test('compressed envelope without a codec fails loud, not silent', () => {
  const wire = encodeEnvelope({ type: 'x' }, fakeLz);
  const out = decodeEnvelope(wire);        // no codec passed
  assert.equal(out.ok, false);
  assert.equal(out.error, 'decompress-unavailable');
});
```

**Multi-case assertion in one test:**
```js
test('staleness guard rejects mismatched stream identity', () => {
  const active = { streamSessionId: 'stream_a_1', snapshotId: 100 };
  assert.equal(isCurrentStream({ streamSessionId: 'stream_a_1', snapshotId: 100 }, active), true);
  assert.equal(isCurrentStream({ streamSessionId: 'stream_b_2', snapshotId: 100 }, active), false);
  assert.equal(isCurrentStream({ streamSessionId: 'stream_a_1', snapshotId: 99 }, active), false);
  // No identity on the message -> accepted (pre-identity senders)
  assert.equal(isCurrentStream({}, active), true);
});
```

**Determinism test — entropy passed in, not mocked:**
```js
test('session ids are deterministic given entropy', () => {
  assert.equal(createStreamSessionId(1000000, 'abc123'), 'stream_lfls_abc123');
});
```

**Invariant / derived-constant test:**
```js
test('snapshot budget stays inside the relay cap with headroom', () => {
  assert.ok(SNAPSHOT_BUDGET_BYTES < RELAY_PER_MESSAGE_LIMIT_BYTES);
  assert.equal(SNAPSHOT_BUDGET_BYTES, Math.floor(RELAY_PER_MESSAGE_LIMIT_BYTES * 0.8));
});
```

---

## Reference Test Patterns (FSB Style — For Understanding Only)

The reference tests in `reference/tests/` use three distinct strategies. Do not use these in `tests/`, but understand them when reading reference code and when extracting behavior into new tests.

### Strategy 1: Source-text invariant checks (`dom-stream-perf.test.js`, `dashboard-stream-readiness-ping.test.js`, `dashboard-stream-pending-intent.test.js`)

Read the source file as text and assert that specific code patterns are present via `.includes()` or regex:
```js
const dsSource = fs.readFileSync(path.join(__dirname, '..', 'extension', 'content', 'dom-stream.js'), 'utf8');
assert(dsSource.includes('document.createTreeWalker'), 'TreeWalker pre-pass present');
assert(dsSource.includes('RELAY_PER_MESSAGE_LIMIT_BYTES = 1048576'), 'RELAY_PER_MESSAGE_LIMIT_BYTES constant present');
assert(!dsSource.includes("document.querySelector('[data-fsb-nid=\"' + nidVal"), 'old per-element querySelector hot path removed');
```

Used to lock in refactoring invariants without a real browser environment. **Not appropriate for new `src/` modules** — those are pure ESM functions testable directly.

### Strategy 2: `vm.runInContext` sandbox execution (`stream-candidate-resolution.test.js`)

Load an IIFE-based script into a `vm` context with stubbed Chrome extension APIs:
```js
const context = {
  console, URL, Set, Date, Promise,
  WebSocket: function WebSocket() {},
  chrome: { tabs: { get: ..., query: ... }, runtime: { lastError: null }, action: { ... } }
};
vm.createContext(context);
vm.runInContext(wsClientSource + '\nglobalThis.__FSBWebSocketClass = FSBWebSocket;', context);
const client = new context.__FSBWebSocketClass();
const candidate = await client._resolveStreamCandidate();
```

Used for Chrome extension service-worker code that cannot `import` cleanly. **Not needed for new `src/` modules**.

### Strategy 3: `new Function()` behavioral simulation (`dashboard-stream-readiness-ping.test.js`, `dashboard-stream-pending-intent.test.js`)

Extract a function's text from source with regex, wrap it in `new Function()` with stubbed dependencies, and exercise it with async simulations:
```js
const fnSrc = wsSource.match(/function _waitForContentScriptReady\([\s\S]*?\n\}\n/)[0];
const factory = new Function('setTimeout', 'Date', 'Promise', 'FSB_CONTENT_READY_POLL_INTERVAL_MS', 'FSB_CONTENT_READY_TIMEOUT_MS', 'chrome', fnSrc + '; return _waitForContentScriptReady;');
const helper = factory(ctx.setTimeout, ctx.Date, ctx.Promise, ctx.FSB_CONTENT_READY_POLL_INTERVAL_MS, ctx.FSB_CONTENT_READY_TIMEOUT_MS, ctx.chrome);
const result = await helper(99, 500);
```

**Not appropriate for new `src/` modules** — they are directly importable pure functions.

### Reference test reporting style

Bare `console.log`/`console.error` pass/fail reporting with a manual counter:
```js
let passed = 0; let failed = 0;
function check(label, cond, detail) {
  if (cond) { passed += 1; console.log('  PASS:', label); }
  else { failed += 1; console.log('  FAIL:', label, '--', detail || ''); }
}
process.exit(failed > 0 ? 1 : 0);
```

**Do not use this in `tests/`.** Use `node:test` + `node:assert/strict` instead.

---

## Coverage

**Requirements:** None enforced currently

**View Coverage:**
```bash
node --test --experimental-test-coverage tests/*.test.js
```

---

## Test Types

**Unit Tests (`tests/`):**
- All existing tests are pure unit tests against `src/protocol/` functions
- No I/O, no network, no DOM
- Scope: one module boundary per test file

**Integration Tests:**
- Not present yet

**E2E Tests:**
- Not present; real-browser UAT is documented as manual steps in comments in `reference/tests/dom-stream-perf.test.js`

---

## Adding New Tests

When extracting a new module from `reference/` into `src/`:

1. Create `tests/<module-name>.test.js`
2. Import from `../src/<module>/index.js` using the named exports
3. Use `node:test` + `node:assert/strict` — no external test libraries
4. Use injected fakes for any external dependencies (same pattern as `fakeLz` in `tests/protocol.test.js`)
5. Pass explicit entropy/time values rather than mocking `Date.now()` or `Math.random()`
6. Write one test per logical behavior, not one test per function
7. Include a backward-compat test if the extracted code must interoperate with unextracted FSB code

---

*Testing analysis: 2026-06-09*
