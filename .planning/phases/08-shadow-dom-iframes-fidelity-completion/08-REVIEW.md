---
phase: 08-shadow-dom-iframes-fidelity-completion
reviewed: 2026-06-15T20:36:46Z
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
  critical: 3
  warning: 0
  info: 0
  total: 3
status: issues_found
---

# Phase 8: Code Review Report

**Reviewed:** 2026-06-15T20:36:46Z
**Depth:** standard
**Files Reviewed:** 34
**Status:** issues_found

## Summary

Re-reviewed the listed source, documentation, and tests after commit `33ae99c`. The prior iframe `src` mutation, frame-local URL resolution, and same-origin frame shadow-root fixes are present. Remaining issues are in the capture/renderer budgeting and recovery paths: the snapshot sidecar pruner can create unrecoverable missing regions, byte limits are still checked with JavaScript string length, and non-snapshot messages can exceed the relay cap.

## Critical Issues

### CR-01: BLOCKER - Pruned frame and shadow sidecars are not recoverable

**File:** `src/capture/index.js:1911`, `src/capture/index.js:2722`, `src/renderer/index.js:1007`, `src/adapters/playwright-inject.js:1947`

**Issue:** `pruneSnapshotSidecarsForBudget` removes the largest `shadowRoots` or `frames` entries from the snapshot sidecars, but the corresponding host or iframe remains in the serialized HTML as a normal element. The renderer only applies a `STREAM.SUBTREE_RESPONSE` when the target has `data-phantomstream-truncated="true"`, so a sidecar omitted for budget cannot be rehydrated through the existing subtree recovery path. The capture tests assert the sidecar was dropped and the host nid still exists, but they do not verify renderer recovery. This leaves over-budget shadow roots and same-origin frames permanently blank or missing while the payload only reports `truncated`/`missingDescendants`.

**Fix:**

```js
function pruneSnapshotSidecarsForBudget(base, budgetBytes) {
  const omitted = { shadowHostNids: new Set(), frameNids: new Set() };

  // When removing a sidecar, record the owning nid instead of silently
  // splicing it out with no renderable placeholder.
  const removed = base.shadowRoots.splice(largestIndex, 1)[0];
  omitted.shadowHostNids.add(removed.hostNid);

  return omitted;
}

// Before final html/nodeIds are emitted, replace each omitted host/frame in the
// cloned document with a data-phantomstream-truncated placeholder using the
// same nid, or add an explicit renderer response path that installs a requested
// shadow/frame sidecar onto a non-placeholder target.
```

Add end-to-end tests that force a shadow-root sidecar and a same-origin frame sidecar to be pruned, request each omitted nid, and verify the renderer installs the returned content instead of discarding the response.

### CR-02: BLOCKER - Snapshot budget checks use UTF-16 string length instead of UTF-8 relay bytes

**File:** `src/capture/index.js:1899`, `src/capture/index.js:1917`, `src/adapters/playwright-inject.js:1935`, `tests/capture-shadow-dom.test.js:239`

**Issue:** `jsonWireLength` returns `JSON.stringify(value).length`, and the sidecar budget loop compares that character count to `SNAPSHOT_BUDGET_BYTES`. The relay limit is byte-based, so non-ASCII content can pass the capture budget while serializing to more than the allowed byte count on the wire. The current test repeats ASCII text and also checks `.length`, so it cannot catch a snapshot that is under the character count but over the actual UTF-8 message limit.

**Fix:**

```js
function wireByteLength(value) {
  var json = JSON.stringify(value);
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(json).byteLength;
  }
  if (typeof Buffer !== 'undefined') {
    return Buffer.byteLength(json, 'utf8');
  }
  return utf8ByteLength(json);
}
```

Use the byte-length helper for snapshot, sidecar, mutation, and subtree-response budget checks, keep the generated Playwright injection bundle synchronized, and add a non-ASCII fixture that asserts `TextEncoder().encode(JSON.stringify(payload)).byteLength <= SNAPSHOT_BUDGET_BYTES`.

### CR-03: BLOCKER - Mutation add and subtree response payloads are unbounded

**File:** `src/capture/index.js:2877`, `src/capture/index.js:2926`, `src/capture/index.js:3050`, `src/adapters/playwright-inject.js:2913`, `src/adapters/playwright-inject.js:2962`, `src/adapters/playwright-inject.js:3086`

**Issue:** The snapshot path has a sidecar budget pass, but later `childList` add mutations and `CONTROL.SUBTREE_REQUEST` responses serialize full HTML, `nodeIds`, `shadowRoots`, and `frames` without any byte-budget enforcement. A large node appended after the snapshot, or a request for a previously truncated large subtree, can produce a `STREAM.MUTATIONS` or `STREAM.SUBTREE_RESPONSE` message larger than the relay hard cap. That loses the exact content path that is supposed to recover truncation.

**Fix:**

```js
function boundCapturePayload(payload, rootNid) {
  if (wireByteLength(payload) <= SNAPSHOT_BUDGET_BYTES) return payload;

  return {
    html: '<div data-phantomstream-nid="' + escapeAttr(rootNid) + '" data-phantomstream-truncated="true"></div>',
    nodeIds: [{ nid: rootNid, path: payload.nodeIds && payload.nodeIds[0] && payload.nodeIds[0].path }],
    shadowRoots: [],
    frames: [],
    truncated: true,
    missingDescendants: 1
  };
}
```

Apply the same byte-budget guard before emitting add mutation payloads and before sending `STREAM.SUBTREE_RESPONSE`. If a requested subtree cannot fit, return a bounded recoverable placeholder, a `too-large` status, or a chunked response protocol; do not send an over-cap `ok` response. Add tests for late-added large shadow/frame content and for requesting a huge truncated subtree.

---

_Reviewed: 2026-06-15T20:36:46Z_
_Reviewer: the agent (gsd-code-reviewer)_
_Depth: standard_
