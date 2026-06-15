---
phase: 07-weakmap-node-identity-semantic-addressing-api
reviewed: 2026-06-15T17:00:58Z
depth: standard
files_reviewed: 24
files_reviewed_list:
  - docs/ARCHITECTURE.md
  - src/adapters/playwright-inject.js
  - src/capture/README.md
  - src/capture/index.js
  - src/protocol/messages.js
  - src/renderer/README.md
  - src/renderer/diff.js
  - src/renderer/index.js
  - src/renderer/overlays.js
  - tests/capture-identity.test.js
  - tests/capture-skip.test.js
  - tests/differential/divergence-ledger.js
  - tests/differential/normalize.js
  - tests/node-identity-static.test.js
  - tests/renderer-diff.test.js
  - tests/renderer-health-events.test.js
  - tests/renderer-loopback.test.js
  - tests/renderer-overlays.test.js
  - tests/renderer-remote-control.test.js
  - tests/renderer-viewer.test.js
  - tests/security-mask.test.js
  - tests/security-sanitize-capture.test.js
  - tests/security-sanitize-render.test.js
  - tests/semantic-addressing.test.js
findings:
  critical: 1
  warning: 2
  info: 0
  total: 3
status: issues_found
---

# Phase 07: Code Review Report

**Reviewed:** 2026-06-15T17:00:58Z
**Depth:** standard
**Files Reviewed:** 24
**Status:** issues_found

## Summary

Reviewed the Phase 07 capture identity, renderer sidecar index, semantic addressing API, adapter bundle, tests, and docs. The core `createCapture` and `createViewer` handles expose the new APIs, but the checked-in browser/Playwright injection artifact hides the capture handle, making capture-side semantic addressing unreachable through that adapter. I also found stale security documentation and a regression test that omits the inlined runtime artifact.

## Critical Issues

### CR-01: Playwright Injection Hides The New Capture-Side Semantic Addressing API

**Classification:** BLOCKER
**File:** `src/adapters/playwright-inject.js:2578`
**Issue:** The bundled injection artifact creates the capture handle in closure-local `phantomStreamCapture` and exposes only `window.__phantomStreamStart` / `window.__phantomStreamStop`. Although the inlined `createCapture` returns `getNodeId` at line 2552, adapter users have no public way to call `getNodeId(element)` from trusted page-side host code. This breaks the Phase 07 semantic-addressing contract for browser/Playwright injection contexts.
**Fix:**
```js
function phantomStreamEnsureCapture() {
  if (!phantomStreamCapture) {
    phantomStreamCapture = createCapture({
      transport: phantomStreamTransport,
      logger: phantomStreamLogger
    });
    window.__phantomStreamCapture = phantomStreamCapture;
  }
  return phantomStreamCapture;
}

window.__phantomStreamGetNodeId = function (element) {
  var capture = phantomStreamEnsureCapture();
  return capture && capture.getNodeId ? capture.getNodeId(element) : null;
};
```
Add adapter coverage that evaluates the injected function against a tracked element after `__phantomStreamStart()`.

## Warnings

### WR-01: Architecture Doc Still Claims The Old Sanitization Gap Exists

**Classification:** WARNING
**File:** `docs/ARCHITECTURE.md:202`
**Issue:** The known-limitations section says `on*` attributes are only stripped on shell elements and that the framework "should sanitize on both ends." That is now false: `src/capture/index.js` strips handlers, dangerous URLs, `srcdoc`, object/embed, CSS, and masking paths, and the renderer applies a defense-in-depth sanitizer. This stale security note can mislead integrators and reviewers about the current threat model.
**Fix:** Replace item 5 with a current limitation, or mark it as resolved design history like item 3.

### WR-02: Static Identity Regression Gate Omits The Inlined Adapter Runtime

**Classification:** WARNING
**File:** `tests/node-identity-static.test.js:11`
**Issue:** The static test forbids retired identity selectors/attributes in `src/capture/index.js` and renderer files, but excludes `src/adapters/playwright-inject.js`, which contains an inlined copy of the capture runtime shipped to browsers. A stale generated artifact could reintroduce `data-fsb-nid` stamping or selector lookup while this gate still passes.
**Fix:**
```js
const FILES = [
  'src/capture/index.js',
  'src/adapters/playwright-inject.js',
  'src/renderer/diff.js',
  'src/renderer/index.js',
  'src/renderer/overlays.js',
];
```
Keep the adapter bundle in the same regression scan as the source modules.

---

_Reviewed: 2026-06-15T17:00:58Z_
_Reviewer: the agent (gsd-code-reviewer)_
_Depth: standard_
