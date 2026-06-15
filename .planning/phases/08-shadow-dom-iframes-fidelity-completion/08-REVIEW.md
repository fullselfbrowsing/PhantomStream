---
phase: "08-shadow-dom-iframes-fidelity-completion"
reviewed: "2026-06-15T21:05:40Z"
depth: standard
files_reviewed: 34
files_reviewed_list:
  - docs/ARCHITECTURE.md
  - docs/DESIGN-HISTORY.md
  - docs/SECURITY.md
  - src/adapters/playwright-inject.js
  - src/adapters/playwright.js
  - src/capture/README.md
  - src/capture/index.js
  - src/protocol/messages.js
  - src/renderer/README.md
  - src/renderer/diff.js
  - src/renderer/index.js
  - src/renderer/snapshot.js
  - tests/capture-added-styles.test.js
  - tests/capture-iframe.test.js
  - tests/capture-input-values.test.js
  - tests/capture-shadow-dom.test.js
  - tests/capture-subtree-fetch.test.js
  - tests/differential/divergence-ledger.js
  - tests/differential/fixtures/phase8-fidelity.html
  - tests/differential/harness.js
  - tests/differential/normalize.js
  - tests/differential/oracle.test.js
  - tests/differential/scenarios/phase8-protocol-extensions.js
  - tests/playwright-adapter.test.js
  - tests/playwright-fidelity-phase8.test.js
  - tests/protocol.test.js
  - tests/renderer-iframe.test.js
  - tests/renderer-loopback.test.js
  - tests/renderer-shadow-dom.test.js
  - tests/renderer-subtree-fetch.test.js
  - tests/renderer-value-diff.test.js
  - tests/renderer-viewer.test.js
  - tests/security-chokepoint-purity.test.js
  - tests/semantic-addressing.test.js
findings:
  critical: 4
  warning: 0
  info: 0
  total: 4
status: issues_found
---

# Phase 8: Code Review Report

**Reviewed:** 2026-06-15T21:05:40Z
**Depth:** standard
**Files Reviewed:** 34
**Status:** issues_found

## Summary

Final re-review after commits `33ae99c`, `794e57a`, and `94ff5c6`.

The prior iframe `src` attr mutation bypass is blocked at capture and renderer, frame/shadow sidecars are included in snapshot budgeting and become requestable placeholders when pruned, frame-local shadow roots and URL bases are handled, UTF-8 byte measurement is used, oversized add/subtree responses are bounded, aggregate inline styles are pruned, and `stop()` now routes pending mutation batches through the chunking helper.

Four blockers remain. Two are still relay-cap failures under untested payload shapes, one makes the new empty fallback snapshot unrecoverable in the renderer, and one leaves navigated same-origin iframe documents unsynchronized. The full suite currently passes (`npm test`: 376 passed), so these cases need new regression coverage.

## Critical Issues

### CR-01: BLOCKER - Snapshot fallback still leaves `url` outside the relay budget

**File:** `src/capture/index.js:2102`, `src/capture/index.js:2927`, `src/adapters/playwright-inject.js:2138`, `src/adapters/playwright-inject.js:2963`

**Issue:** `fitSnapshotPayloadForBudget()` strips html, sidecars, head styles, attrs, shell styles, and title in the hard fallback, but it never clears or truncates `next.url`. `serializeDOM()` always copies `location.href` into the same `STREAM.SNAPSHOT` payload. A long URL can therefore keep the final snapshot above `RELAY_PER_MESSAGE_LIMIT_BYTES` after the fallback has run. I reproduced `snapshotBytes=1049970` with `relayLimit=1048576`, `htmlLength=0`, and `urlLength=1049597`.

**Fix:**

```js
if (wireByteLength(next) > SNAPSHOT_BUDGET_BYTES && next.url) {
  next.url = '';
  markSnapshotPayloadTruncated(next);
}

if (wireByteLength(next) > RELAY_PER_MESSAGE_LIMIT_BYTES) {
  next.html = '';
  next.nodeIds = [];
  next.shadowRoots = [];
  next.frames = [];
  next.inlineStyles = [];
  next.stylesheets = [];
  next.htmlAttrs = {};
  next.bodyAttrs = {};
  next.htmlStyle = '';
  next.bodyStyle = '';
  next.title = '';
  next.url = '';
  next.missingDescendants = (next.missingDescendants || 0) + 1;
  markSnapshotPayloadTruncated(next);
}
```

Add a regression test with a long `location.href` that asserts the emitted snapshot payload is always `<= RELAY_PER_MESSAGE_LIMIT_BYTES`. Apply the same generated change to `src/adapters/playwright-inject.js`.

### CR-02: BLOCKER - Renderer rejects the empty snapshots produced by the new hard fallback

**File:** `src/renderer/index.js:941`, `tests/renderer-viewer.test.js:321`

**Issue:** The capture fallback can intentionally emit a valid snapshot with `html: ''` after stripping payload fields to stay under the relay cap. The renderer treats any falsy `p.html` as missing and returns before adopting the new stream identity or writing `srcdoc`. This also rejects legitimate empty-body pages. The current renderer test codifies "missing payload.html" but does not distinguish an absent field from an empty string.

**Fix:**

```js
function handleSnapshot(payload) {
  var p = payload || {};
  if (typeof p.html !== 'string') {
    logger.error('[Renderer] snapshot missing html');
    return;
  }
  active.streamSessionId = p.streamSessionId || '';
  active.snapshotId = p.snapshotId || 0;
  // existing reset + srcdoc write
}
```

Add coverage for `{ html: '', truncated: true, nodeIds: [] }` and for an ordinary empty body snapshot. Missing or non-string `html` should still be rejected.

### CR-03: BLOCKER - Event-driven value diffs bypass mutation byte budgeting

**File:** `src/capture/index.js:1323`, `src/adapters/playwright-inject.js:1359`

**Issue:** Normal mutation flushes and stop flushes use `sendMutationDiffs()`, which chunks batches and drops single over-cap diffs. `handleValueEvent()` sends `STREAM.MUTATIONS` directly, so a large textarea/input/select value can exceed the relay cap. I reproduced an `input` event on a textarea with `mutationBytes=1049697` against `relayLimit=1048576`; the payload carried one `DIFF_OP.VALUE` with a 1,049,576-character value.

**Fix:**

```js
function handleValueEvent(event) {
  if (!streaming || !event || !event.target) return;
  var diff = buildValueDiff(event.target);
  if (!diff) return;
  sendMutationDiffs(
    [scopeFrameDiff(diff, getMutationFrameRecord(event.target))],
    { includeStaleFlushCount: false }
  );
}
```

Add a regression test with an over-1 MiB textarea value that asserts no emitted `STREAM.MUTATIONS` payload exceeds `RELAY_PER_MESSAGE_LIMIT_BYTES`. Apply the same generated change to `src/adapters/playwright-inject.js`.

### CR-04: BLOCKER - Navigated same-origin iframe documents are registered but never sent to the renderer

**File:** `src/capture/index.js:1156`, `src/capture/index.js:1181`, `src/renderer/index.js:983`

**Issue:** On iframe `load`, the capture handler re-registers the new same-origin document, but `registerFrameDocument()` only calls `serializeFrameDocument()` for side effects and discards the returned frame payload. No snapshot, frame-refresh diff, add sidecar, or subtree response is sent for the new document. Later mutations inside that navigated frame are scoped with nids assigned from the new frame document, but the renderer never indexed those nids because it only installs frame payloads from snapshots, add ops, and subtree responses. Static content in the loaded frame is never mirrored, and later frame-local diffs become stale misses.

**Fix:**

Introduce an explicit frame-refresh path. Either add a `DIFF_OP.FRAME` op that carries the serialized frame payload and have the renderer call `installOneFrame()`, or trigger a bounded full snapshot when a registered same-origin frame loads.

```js
var payload = serializeFrameDocument(iframe, key, frameDoc);
if (payload) {
  sendMutationDiffs([{
    op: DIFF_OP.FRAME,
    frameNid: key,
    frame: payload
  }], { includeStaleFlushCount: false });
}
```

The renderer side should handle the new op by installing the inert `srcdoc` frame and indexing `frame.nodeIds`, `frame.shadowRoots`, and nested `frame.frames`. Add an end-to-end test that changes an existing same-origin iframe document, fires `load`, and verifies the viewer can resolve and display a node from the new frame before any additional frame mutation occurs.

---

_Reviewed: 2026-06-15T21:05:40Z_
_Reviewer: the agent (gsd-code-reviewer)_
_Depth: standard_
