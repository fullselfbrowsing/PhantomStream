---
phase: 08-shadow-dom-iframes-fidelity-completion
review: 08-REVIEW.md
fixed: 2026-06-15T20:33:00Z
status: fixed
fix_scope: critical_warning
findings_fixed:
  critical: 3
  warning: 1
  info: 0
  total: 4
commits:
  - 33ae99c
---

# Phase 08: Code Review Fix Report

## Summary

Fixed all Critical and Warning findings from `08-REVIEW.md`.

## Fixes Applied

- **CR-01:** Iframe `src` mutations are suppressed in capture and ignored defensively in the renderer, so generic attr diffs cannot reintroduce live remote frame URLs.
- **CR-02:** Snapshot budgeting now accounts for `shadowRoots[]` and `frames[]`; oversized sidecars are pruned, snapshots are marked truncated, and missing descendants are counted while requestable node ids remain available.
- **CR-03:** Same-origin frame payloads now include frame-local `shadowRoots[]`, and the renderer installs them before nested frame payloads.
- **WR-01:** Added subtree URL and `srcset` absolutification now uses each element's owner document, including same-origin iframe documents; frame metadata URL helpers use the iframe owner document too.

## Verification

```bash
node --test tests/capture-iframe.test.js tests/renderer-iframe.test.js tests/capture-shadow-dom.test.js
node --test tests/capture-shadow-dom.test.js tests/renderer-shadow-dom.test.js tests/capture-iframe.test.js tests/renderer-iframe.test.js tests/capture-input-values.test.js tests/renderer-value-diff.test.js tests/capture-added-styles.test.js tests/capture-subtree-fetch.test.js tests/renderer-subtree-fetch.test.js tests/playwright-fidelity-phase8.test.js
npm test
rg -n "import |export |require\\(|document\\.dispatchEvent" src/adapters/playwright-inject.js
```

Results:

- Focused review regression gate: 16 tests, 16 pass.
- Phase 8 focused gate: 40 tests, 40 pass.
- Full suite: 371 tests, 371 pass.
- Playwright inject static forbidden grep returned no matches.

