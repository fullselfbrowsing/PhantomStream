---
phase: 08-shadow-dom-iframes-fidelity-completion
review: 08-REVIEW.md
fixed: 2026-06-16T04:20:39Z
status: fixed
fix_scope: critical_warning
findings_fixed:
  critical: 12
  warning: 1
  info: 0
  total: 13
commits:
  - 33ae99c
  - 794e57a
  - 94ff5c6
  - 907e5ed
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

## Verification

```bash
node --test tests/capture-iframe.test.js tests/renderer-iframe.test.js tests/capture-shadow-dom.test.js
node --test tests/capture-shadow-dom.test.js tests/renderer-shadow-dom.test.js tests/capture-iframe.test.js tests/renderer-iframe.test.js tests/capture-input-values.test.js tests/renderer-value-diff.test.js tests/capture-added-styles.test.js tests/capture-subtree-fetch.test.js tests/renderer-subtree-fetch.test.js tests/playwright-fidelity-phase8.test.js
node --test tests/capture-shadow-dom.test.js tests/capture-iframe.test.js tests/capture-added-styles.test.js tests/capture-subtree-fetch.test.js tests/renderer-loopback.test.js --test-name-pattern "oversized|subtree request recovers|snapshot budget includes|same-origin frame sidecars|SUBTREE_REQUEST responses"
node --test tests/capture-lifecycle.test.js --test-name-pattern "snapshot head payloads|stop flush chunks"
npm test
rg -n "import |export |require\\(|document\\.dispatchEvent" src/adapters/playwright-inject.js
```

Results:

- Focused review regression gate: 22 tests, 22 pass.
- Final lifecycle budget regression gate: 8 tests, 8 pass.
- Latest targeted blocker gate: 58 tests, 58 pass.
- Phase 8 focused gate: 83 tests, 83 pass.
- Loopback recovery regression gate: included in focused cap check and full suite.
- Full suite: 380 tests, 380 pass.
- Playwright inject static forbidden grep returned only the expected `DIFF_OP.FRAME` constant/op lines and no `import`, `export`, `require()`, or `document.dispatchEvent` matches.
