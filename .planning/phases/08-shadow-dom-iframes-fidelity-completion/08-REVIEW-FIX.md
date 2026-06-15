---
phase: 08-shadow-dom-iframes-fidelity-completion
review: 08-REVIEW.md
fixed: 2026-06-15T21:02:00Z
status: fixed
fix_scope: critical_warning
findings_fixed:
  critical: 8
  warning: 1
  info: 0
  total: 9
commits:
  - 33ae99c
  - 794e57a
  - 94ff5c6
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
- Phase 8 focused gate: 51 tests, 51 pass.
- Loopback recovery regression gate: included in focused cap check and full suite.
- Full suite: 376 tests, 376 pass.
- Playwright inject static forbidden grep returned no matches.
