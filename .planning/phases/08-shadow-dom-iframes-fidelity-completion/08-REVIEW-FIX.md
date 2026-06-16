---
phase: 08-shadow-dom-iframes-fidelity-completion
review: 08-REVIEW.md
fixed: 2026-06-16T04:50:17Z
status: fixed
fix_scope: critical_warning
findings_fixed:
  critical: 15
  warning: 3
  info: 0
  total: 18
commits:
  - 33ae99c
  - 794e57a
  - 94ff5c6
  - 907e5ed
  - 7df67a2
  - 7022b15
  - 17a7cde
  - fe83c0c
---

# Phase 08: Code Review Fix Report

## Summary

Fixed all Critical and Warning findings from all `08-REVIEW.md` passes.

## Fixes Applied

- **CR-01:** Iframe `src` mutations are suppressed in capture and ignored defensively in the renderer, so generic attr diffs cannot reintroduce live remote frame URLs.
- **CR-02:** Snapshot budgeting now accounts for `shadowRoots[]` and `frames[]`; oversized sidecars are pruned, snapshots are marked truncated, and missing descendants are counted while requestable node ids remain available.
- **CR-03:** Same-origin frame payloads now include frame-local `shadowRoots[]`, and the renderer installs them before nested frame payloads.
- **WR-01:** Added subtree URL and `srcset` absolutification now uses each element's owner document, including same-origin iframe documents; frame metadata URL helpers use the iframe owner document too.
- **Post-fix CR-01:** Snapshot sidecar pruning now replaces omitted shadow/frame owners in the cloned HTML with requestable `data-phantomstream-truncated` placeholders.
- **Post-fix CR-02:** Snapshot size checks now use UTF-8 wire-byte length instead of UTF-16 string length, including non-ASCII fixtures.
- **Post-fix CR-03:** Late add mutation batches and subtree responses are bounded against the relay hard cap; oversized add ops become requestable placeholders and oversized subtree responses return content-free `too-large`.
- **Final CR-01:** Final snapshot fitting now includes aggregate head payloads, shell metadata, and inline styles before sending; oversized head styles are pruned under the relay cap.
- **Final CR-02:** `stop()` final mutation flush now routes through the same bounded chunk sender used by normal rAF mutation flushes.
- **Final re-review CR-01:** Snapshot hard fallback now clears oversized `url` payloads so final snapshots cannot exceed the relay cap through long document URLs.
- **Final re-review CR-02:** The renderer accepts valid empty-string snapshot HTML while still rejecting missing or non-string `html`.
- **Final re-review CR-03:** Event-driven value diffs now use the bounded mutation sender instead of direct `safeSend`, keeping oversized form values under the relay cap.
- **Final re-review CR-04:** Same-origin iframe `load` now emits a bounded `DIFF_OP.FRAME` refresh, and the renderer installs that frame payload so navigated frame content and nids are available before later frame-local mutations.
- **Post-final CR-01:** The Playwright bridge now uses an adapter-owned per-install capability token and allowlists capture-to-viewer stream types before forwarding page binding messages.
- **Post-final CR-02:** Oversized `DIFF_OP.FRAME` and `DIFF_OP.SHADOW_ROOT` replacements now degrade to bounded, requestable truncated placeholders instead of falling through to the generic over-budget drop path.
- **Post-final WR-01:** Architecture lifecycle docs now state that `domStreamResume` re-arms observers with the same stream identity and sends no snapshot.
- **Post-final WR-02:** The subtree response recovery test now supplies complete preorder node ids and verifies `safe-child-nid` resolves to the intended recovered element.
- **Bridge closure CR-01:** The Playwright inject transport now closes over the original exposed binding during init and never re-reads `window.__phantomStreamBridge` at send time, so later page wrappers cannot observe or steal the bridge token.

## Verification

```bash
node --test tests/capture-iframe.test.js tests/renderer-iframe.test.js tests/capture-shadow-dom.test.js
node --test tests/capture-shadow-dom.test.js tests/renderer-shadow-dom.test.js tests/capture-iframe.test.js tests/renderer-iframe.test.js tests/capture-input-values.test.js tests/renderer-value-diff.test.js tests/capture-added-styles.test.js tests/capture-subtree-fetch.test.js tests/renderer-subtree-fetch.test.js tests/playwright-fidelity-phase8.test.js
node --test tests/capture-shadow-dom.test.js tests/capture-iframe.test.js tests/capture-added-styles.test.js tests/capture-subtree-fetch.test.js tests/renderer-loopback.test.js --test-name-pattern "oversized|subtree request recovers|snapshot budget includes|same-origin frame sidecars|SUBTREE_REQUEST responses"
node --test tests/capture-lifecycle.test.js --test-name-pattern "snapshot head payloads|stop flush chunks"
node --test tests/playwright-adapter.test.js tests/capture-iframe.test.js tests/capture-shadow-dom.test.js tests/renderer-subtree-fetch.test.js
node --test tests/playwright-adapter.test.js tests/playwright-adapter-cdp.test.js
node --test tests/capture-shadow-dom.test.js tests/renderer-shadow-dom.test.js tests/capture-iframe.test.js tests/renderer-iframe.test.js tests/capture-input-values.test.js tests/renderer-value-diff.test.js tests/capture-added-styles.test.js tests/capture-subtree-fetch.test.js tests/renderer-subtree-fetch.test.js tests/playwright-fidelity-phase8.test.js tests/playwright-adapter.test.js tests/playwright-adapter-cdp.test.js tests/capture-lifecycle.test.js tests/renderer-viewer.test.js tests/protocol.test.js
npm test
rg -n "import |export |require\\(|document\\.dispatchEvent" src/adapters/playwright-inject.js
```

Results:

- Focused review regression gate: 22 tests, 22 pass.
- Final lifecycle budget regression gate: 8 tests, 8 pass.
- Latest targeted blocker gate: 58 tests, 58 pass.
- Post-final targeted gate: 27 tests, 27 pass.
- Adapter/CDP gate: 12 tests, 12 pass.
- Phase 8 focused gate: 97 tests, 97 pass.
- Loopback recovery regression gate: included in focused cap check and full suite.
- Full suite: 383 tests, 383 pass.
- Playwright inject static forbidden grep returned no `import`, `export`, `require()`, or `document.dispatchEvent` matches.
