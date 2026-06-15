---
phase: "08-shadow-dom-iframes-fidelity-completion"
reviewed: "2026-06-15T20:54:01Z"
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
  critical: 2
  warning: 0
  info: 0
  total: 2
status: issues_found
---

# Phase 8: Code Review Report

**Reviewed:** 2026-06-15T20:54:01Z
**Depth:** standard
**Files Reviewed:** 34
**Status:** issues_found

## Summary

Re-reviewed the Phase 8 source, docs, and tests after fixes in commits `33ae99c` and `794e57a`.

The prior issues are resolved on the covered paths: iframe `src` mutations are blocked in both capture and renderer, frame/shadow sidecars are included in snapshot budgeting and converted to requestable placeholders when pruned, frame-local shadow roots and URL bases are handled, UTF-8 byte measurement is used, subtree responses are bounded, and normal rAF mutation flushes chunk bounded add ops.

Two relay-cap blockers remain. Both were reproduced with one-off Node probes outside the existing suite. The project test suite still passes (`npm test`: 374 passed), which means these edge cases are currently untested.

## Critical Issues

### CR-01: BLOCKER - Snapshot base payload can exceed the relay cap without any sidecars

**File:** `src/capture/index.js:985`, `src/capture/index.js:1990`, `src/capture/index.js:2750`, `src/capture/index.js:2799`, `src/adapters/playwright-inject.js:1021`, `src/adapters/playwright-inject.js:2026`, `src/adapters/playwright-inject.js:2786`, `src/adapters/playwright-inject.js:2835`

**Issue:** Snapshot truncation still starts from `wireByteLength(html)` only, and `pruneSnapshotSidecarsForBudget()` only reduces payload size while `shadowRoots` or `frames` remain. Head payloads such as `inlineStyles`, `stylesheets`, shell attrs/styles, URL, and title are part of the same wire message but cannot be reduced when the body HTML is small and no sidecars exist. `collectInlineStylesFrom()` accepts every `<style>` under `INLINE_STYLE_MAX_BYTES` individually, so several individually allowed style tags can create an over-cap `STREAM.SNAPSHOT`. I reproduced a snapshot with a tiny body and four inline styles: `snapshotBytes=1642137`, `relayLimit=1048576`, `snapshotBudget=838860`.

**Fix:**

Budget the complete snapshot payload, not only `html` plus sidecars. Keep pruning until the final object sent by `serializeDOM()` is below the relay cap, including aggregate caps for head styles.

```js
function fitSnapshotPayloadForBudget(payload, clone, cloneToNid, truncatedNodeIds) {
  var next = Object.assign({}, payload);

  while (wireByteLength(next) > SNAPSHOT_BUDGET_BYTES && next.inlineStyles.length) {
    next.inlineStyles.pop();
    next.truncated = true;
  }

  while (wireByteLength(next) > SNAPSHOT_BUDGET_BYTES && next.stylesheets.length) {
    next.stylesheets.pop();
    next.truncated = true;
  }

  if (wireByteLength(next) > RELAY_PER_MESSAGE_LIMIT_BYTES) {
    next = truncateBodyAgainstFullPayload(next, clone, cloneToNid, truncatedNodeIds);
  }

  return next;
}
```

Apply the same generated/injected change to `src/adapters/playwright-inject.js`, and add a regression test with multiple sub-500KB inline styles that asserts every emitted snapshot is below `RELAY_PER_MESSAGE_LIMIT_BYTES`.

### CR-02: BLOCKER - `stop()` final mutation flush bypasses chunking and can send over-cap add batches

**File:** `src/capture/index.js:3299`, `src/capture/index.js:3445`, `src/adapters/playwright-inject.js:3335`, `src/adapters/playwright-inject.js:3481`

**Issue:** Normal mutation flushing uses `sendMutationDiffs()`, which drops over-budget single diffs and chunks batches before sending. The final flush inside `stopMutationStream()` processes pending mutations, then calls `safeSend(STREAM.MUTATIONS, { mutations: diffs, ... })` directly. That bypasses the chunking helper. If many individually valid add ops are queued and `stop()` runs before the rAF flush, the stop path emits one oversized mutation frame. I reproduced this by holding `requestAnimationFrame`, appending 700 small sections, and calling `stop()`: one `STREAM.MUTATIONS` payload was sent with `size=2201369`, `relayLimit=1048576`, `opCount=700`.

**Fix:**

Route the stop flush through the same bounded sender as the normal path. If preserving the stop-path omission of `staleFlushCount` is still required, make that an option on the helper instead of bypassing chunking.

```js
if (diffs.length > 0) {
  sendMutationDiffs(diffs, { includeStaleFlushCount: false });
}
```

Add a regression test that holds rAF, appends enough individually under-cap nodes to exceed the relay cap as a batch, calls `capture.stop()`, and asserts every `STREAM.MUTATIONS` payload is below `RELAY_PER_MESSAGE_LIMIT_BYTES`.

---

_Reviewed: 2026-06-15T20:54:01Z_
_Reviewer: the agent (gsd-code-reviewer)_
_Depth: standard_
