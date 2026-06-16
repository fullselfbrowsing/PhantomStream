---
phase: "08-shadow-dom-iframes-fidelity-completion"
reviewed: "2026-06-16T04:29:18Z"
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
  warning: 2
  info: 0
  total: 4
status: issues_found
---

# Phase 8: Code Review Report

**Reviewed:** 2026-06-16T04:29:18Z
**Depth:** standard
**Files Reviewed:** 34
**Status:** issues_found

## Summary

Re-reviewed Phase 08 after the final review-fix commit, focusing on relay byte budgeting, empty snapshots, event-driven value diffs, and same-origin iframe load refreshes.

The four previously reported fixes are present: oversized URLs are cleared from fallback snapshots, empty-string snapshots are accepted by the renderer, event-driven value diffs route through the mutation chunker, and same-origin iframe load emits a `DIFF_OP.FRAME` refresh. Two blockers remain: the Playwright page bridge is forgeable by page JavaScript, and over-cap frame/shadow refresh diffs are still silently dropped. Two warnings cover stale docs and a test that can pass while indexing the wrong subtree node.

## Critical Issues

### CR-01: BLOCKER - Playwright page scripts can forge bridge messages around the capture sanitizer

**File:** `src/adapters/playwright.js:151`, `src/adapters/playwright.js:163`, `src/adapters/playwright-inject.js:3813`

**Issue:** `page.exposeBinding()` exposes `__phantomStreamBridge` to the page realm, and `bindingCallback()` forwards any main-frame `{ type, payload }` object directly to `transport.send()`. A page script can call `window.__phantomStreamBridge({ type: 'ext:dom-snapshot', payload: ... })` or another stream type itself, bypassing `sanitizeForWire`, password/value masking, byte budgeting, and the capture-owned protocol shape. The injected capture is not the only caller of the binding.

**Fix:**

Add an unguessable adapter-owned capability to bridge calls and reject messages without it; also allowlist capture-to-viewer stream types before forwarding.

```js
var bridgeToken = randomBytes(32).toString('base64url');
var allowedBridgeTypes = new Set(Object.values(STREAM));

async function bindingCallback(caller, msg) {
  if (!msg || msg.token !== bridgeToken) {
    return { ok: false, error: 'bridge-token-invalid' };
  }
  if (!allowedBridgeTypes.has(msg.type)) {
    return { ok: false, error: 'bridge-type-invalid' };
  }
  transport.send(msg.type, msg.payload || {});
  return { ok: true };
}
```

Generate/wrap `playwright-inject.js` so only the injected transport closure can add `token: bridgeToken`; do not place the token on `window`.

### CR-02: BLOCKER - Over-cap iframe and shadow refresh diffs are still dropped instead of bounded

**File:** `src/capture/index.js:1193`, `src/capture/index.js:3353`, `src/capture/index.js:3381`, `src/capture/index.js:3400`, `src/adapters/playwright-inject.js:1230`, `src/adapters/playwright-inject.js:3440`

**Issue:** `sendMutationDiffs()` drops any single diff whose payload exceeds `RELAY_PER_MESSAGE_LIMIT_BYTES`, but `boundMutationDiffForBudget()` only creates a placeholder for `DIFF_OP.ADD`. The new same-origin iframe `load` refresh uses `DIFF_OP.FRAME`, and live shadow updates use `DIFF_OP.SHADOW_ROOT`; both are non-ADD ops and are still dropped when their serialized content is large. I reproduced `frameOps: 0` with a warning for `op: "frame"` after loading a >1 MiB same-origin iframe, and `shadowOps: 0` with a warning for `op: "shadow-root"` after a >1 MiB shadow-root update. The renderer keeps stale old frame/shadow content with no requestable marker.

**Fix:**

Extend the budgeter to bound all large replacement-style diffs before the drop check, or fall back to a bounded full snapshot for those cases. Do not let `DIFF_OP.FRAME` or `DIFF_OP.SHADOW_ROOT` reach the generic drop path silently.

```js
function boundMutationDiffForBudget(diff, options) {
  if (!diff) return null;
  if (wireByteLength(mutationPayloadForBudget([diff], options)) <= RELAY_PER_MESSAGE_LIMIT_BYTES) {
    return diff;
  }
  if (diff.op === DIFF_OP.ADD) return boundedAddPlaceholder(diff);
  if (diff.op === DIFF_OP.FRAME) return boundedFramePlaceholder(diff);
  if (diff.op === DIFF_OP.SHADOW_ROOT) return boundedShadowPlaceholder(diff);
  return null;
}
```

Apply the same generated change to `src/adapters/playwright-inject.js`, and add regression tests for oversized iframe load refreshes and oversized live shadow-root replacements.

## Warnings

### WR-01: WARNING - Architecture docs still describe obsolete resume semantics

**File:** `docs/ARCHITECTURE.md:135`

**Issue:** The architecture document says `domStreamResume` creates a fresh session and snapshot. The implementation and capture README now explicitly keep the same `streamSessionId`/`snapshotId` and do not send a snapshot on `resume()`. This stale contract can cause host integrations to rely on a refresh that will never happen.

**Fix:**

Replace the lifecycle bullet with the current contract:

```markdown
Control messages: `domStreamStart` (fresh session + snapshot + observers),
`domStreamStop`, `domStreamPause` (observers off, session retained),
`domStreamResume` (observers re-armed, same session/snapshot, no snapshot).
```

### WR-02: WARNING - Subtree response test can pass while indexing the wrong node

**File:** `tests/renderer-subtree-fetch.test.js:166`, `tests/renderer-subtree-fetch.test.js:195`

**Issue:** The test installs HTML with four elements (`section`, `button`, `a`, `p`) but supplies only two `nodeIds`. The renderer pairs ids by element preorder, so `safe-child-nid` is assigned to the button, not the `<p id="safe-child">`. The assertion only checks that `viewer.resolveNode('safe-child-nid')` is truthy, so this test passes even when the indexed nid points at the wrong element.

**Fix:**

Keep the sidecar length aligned and assert the resolved nid maps to the intended element, for example by giving the safe child a distinctive mocked rect before calling `resolveNode()`.

```js
nodeIds: ['truncated-nid', 'unsafe-nid', 'bad-link-nid', 'safe-child-nid'];

const safeChild = recovered.querySelector('#safe-child');
safeChild.getBoundingClientRect = () => ({ left: 7, top: 11, width: 13, height: 17 });
assert.deepEqual(viewer.resolveNode('safe-child-nid').rect, {
  left: 7, top: 11, width: 13, height: 17
});
```

---

_Reviewed: 2026-06-16T04:29:18Z_
_Reviewer: the agent (gsd-code-reviewer)_
_Depth: standard_
