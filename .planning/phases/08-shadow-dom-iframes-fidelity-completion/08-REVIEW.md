---
phase: 08-shadow-dom-iframes-fidelity-completion
reviewed: 2026-06-15T20:21:37Z
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
  warning: 1
  info: 0
  total: 4
status: issues_found
---

# Phase 08: Code Review Report

**Reviewed:** 2026-06-15T20:21:37Z
**Depth:** standard
**Files Reviewed:** 34
**Status:** issues_found

## Summary

Reviewed the Phase 8 runtime implementation, generated Playwright injection artifact, protocol/docs, and test coverage. The main defects are in the new shadow/frame sidecar paths: iframe `src` mutations bypass the inert frame policy, sidecar payloads are outside the relay budget, and frame snapshots do not carry shadow-root sidecars. These are correctness/security blockers for the fidelity completion phase.

## Critical Issues

### CR-01: BLOCKER - iframe `src` mutations reintroduce live remote frames

**File:** `src/capture/index.js:3022`, `src/renderer/diff.js:271`, `src/adapters/playwright-inject.js:3058`
**Issue:** Snapshot/add serialization removes iframe `src` and routes frame content through `frames[]`, but later attribute mutations use the generic attr path. A post-snapshot `iframe.setAttribute('src', 'https://remote.example/private')` emits `{ op: 'attr', attr: 'src', val: 'https://remote.example/private' }`, and the renderer applies it with `target.setAttribute`. That violates the documented Phase 8 contract that same-origin frames are inert `srcdoc` mirrors and cross-origin frames are content-free placeholders, and it can cause the viewer to fetch/render live remote iframe URLs.
**Fix:**
```js
var attrName = String(m.attributeName || '').toLowerCase();
var tag = m.target && m.target.tagName ? String(m.target.tagName).toLowerCase() : '';
if (tag === 'iframe' && attrName === 'src') {
  registerFrameLoadListener(m.target, targetNid);
  // Emit a sanitized frame refresh/full snapshot, but never a generic ATTR src op.
  continue;
}
```
Also add a render-side defense in `applyMutations`: if the resolved target is an iframe and `m.attr` is `src`, remove/ignore it unless it is handled by an explicit frame-refresh operation.

### CR-02: BLOCKER - frame and shadow sidecars bypass the snapshot size budget

**File:** `src/capture/index.js:2594`, `src/capture/index.js:2634`, `src/adapters/playwright-inject.js:2630`, `src/adapters/playwright-inject.js:2670`
**Issue:** The truncation budget still checks only `html.length`, then appends unbounded `shadowRoots[]` and `frames[]` afterward. A small top-level body with a huge same-origin iframe or shadow root can exceed the relay's hard per-message limit, causing dropped snapshots/data loss. It can also serialize sidecar content for nids whose cloned elements were replaced with truncation placeholders.
**Fix:** Budget the complete serialized payload, including nested frame/shadow sidecars, before sending. When over budget, omit or placeholder oversized sidecars, increment `missingDescendants`, and make those regions recoverable through `CONTROL.SUBTREE_REQUEST`. Do not collect sidecars for live hosts whose clone mapping now points at a `data-phantomstream-truncated` placeholder.

### CR-03: BLOCKER - same-origin iframe snapshots omit shadow roots

**File:** `src/capture/index.js:1073`, `src/renderer/index.js:744`, `src/adapters/playwright-inject.js:1109`
**Issue:** `serializeFrameDocument()` returns frame HTML, node ids, and nested frames, but never includes `shadowRoots`. The renderer's `indexFrameDocument()` indexes frame nodes and installs nested frames, but never installs frame-local shadow roots. Static open shadow DOM inside a same-origin iframe is therefore missing from the initial mirror until a later mutation happens to trigger a `shadow-root` op.
**Fix:**
```js
var frameShadowRoots = collectShadowRootPayloads(frameDoc.body, nodeIds);
return {
  frameNid: String(frameNid),
  kind: 'same-origin',
  html: bodyClone.innerHTML || '',
  nodeIds: nodeIds,
  shadowRoots: frameShadowRoots,
  frames: nestedFrames,
  // ...
};
```
Then, after indexing the frame document in the renderer, call `installShadowRoots(frameDoc, p.shadowRoots || [])` before installing nested frames. Update `FramePayload` docs/tests and keep `playwright-inject.js` in sync.

## Warnings

### WR-01: WARNING - frame-local added subtrees resolve relative URLs against the top document

**File:** `src/capture/index.js:2709`, `src/capture/index.js:2731`, `src/adapters/playwright-inject.js:2745`
**Issue:** `processAddedNode()` is now used for mutations and subtree responses inside same-origin frame documents, but its URL/srcset absolutification calls omit the `baseDoc` argument. Relative URLs in frame-local added content are resolved against the top-level `document.baseURI`, and the live frame DOM is mutated to those wrong absolute URLs.
**Fix:**
```js
var baseDoc = el.ownerDocument || document;
if (val) el.setAttribute(URL_ATTRS[a], absolutifyUrl(val, baseDoc));
if (srcset) el.setAttribute('srcset', absolutifySrcset(srcset, baseDoc));

var descDoc = desc.ownerDocument || baseDoc;
if (dv) desc.setAttribute(URL_ATTRS[b], absolutifyUrl(dv, descDoc));
if (ds) desc.setAttribute('srcset', absolutifySrcset(ds, descDoc));
```
Apply the same base-document discipline to frame metadata helpers such as `safeFrameSrc` / `safeFrameOrigin` when handling nested iframes.

---

_Reviewed: 2026-06-15T20:21:37Z_
_Reviewer: the agent (gsd-code-reviewer)_
_Depth: standard_
