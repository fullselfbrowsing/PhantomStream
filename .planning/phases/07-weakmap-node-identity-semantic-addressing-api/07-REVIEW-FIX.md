---
phase: 07-weakmap-node-identity-semantic-addressing-api
source_review: 07-REVIEW.md
fixed: 2026-06-15T17:08:00Z
status: fixed
findings_addressed:
  critical: 1
  warning: 2
commit: e638d3f
---

# Phase 07 Code Review Fix Summary

## Fixed Findings

- **CR-01:** Exposed the injected capture handle as `window.__phantomStreamCapture` and added `window.__phantomStreamGetNodeId(element)` so trusted page-side adapter contexts can use the Phase 7 capture semantic addressing contract.
- **WR-01:** Updated the architecture known-limitations section to remove the stale sanitization-gap claim and describe the current blocklist sanitizer plus sandbox defense-in-depth boundary.
- **WR-02:** Added `src/adapters/playwright-inject.js` to the runtime identity static regression gate so the checked-in browser artifact cannot reintroduce retired identity attributes or selector paths unnoticed.

## Verification

- `node --test tests/playwright-adapter.test.js tests/adapter-exports.test.js tests/node-identity-static.test.js` - PASS
- `grep -n "nodeIds" src/capture/README.md src/renderer/README.md docs/ARCHITECTURE.md` - PASS
- `grep -n "WeakMap" src/capture/README.md docs/ARCHITECTURE.md` - PASS
- `grep -n "resolveNode" src/renderer/README.md` - PASS
- `grep -n "highlightNode" src/renderer/README.md` - PASS
- `rg -n "data-fsb-nid|NID_ATTR|querySelector\\('\\[' \\+ NID_ATTR" src/capture/index.js src/adapters/playwright-inject.js src/renderer/diff.js src/renderer/index.js src/renderer/overlays.js` - PASS, no matches

