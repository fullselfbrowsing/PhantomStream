---
phase: 08-shadow-dom-iframes-fidelity-completion
reviewed: "2026-06-16T04:47:26Z"
depth: standard
files_reviewed: 35
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
  - tests/playwright-adapter-cdp.test.js
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
  critical: 1
  warning: 0
  info: 0
  total: 1
status: issues_found
---

# Phase 8: Code Review Report

**Reviewed:** 2026-06-16T04:47:26Z
**Depth:** standard
**Files Reviewed:** 35
**Status:** issues_found

## Summary

Re-reviewed Phase 08 after commit 7022b15 and the updated review-fix report, with emphasis on Playwright bridge hardening, tokenized init/CDP source, frame and shadow-root relay bounding, requestable placeholder semantics, and the corrected subtree id test.

The frame/shadow over-budget paths now route through bounded placeholders, oversized subtree responses are content-free, and the subtree id assertion covers the recovered safe child. One bridge security issue remains: the injected script still sends the bridge token through a mutable page-global binding lookup, so page script can steal the token from any later legitimate capture send and forge allowlisted STREAM messages.

## Critical Issues

### CR-01: BLOCKER - Page scripts can steal the Playwright bridge token by wrapping the exposed binding

**File:** `src/adapters/playwright-inject.js:3899`, `src/adapters/playwright-inject.js:3901`, `src/adapters/playwright.js:179`

**Issue:** `bindingCallback()` rejects missing tokens and disallowed message types, but the injected transport undermines that check by reading `window.__phantomStreamBridge` every time it sends and passing `{ token: PHANTOM_STREAM_BRIDGE_TOKEN, ... }` through that mutable page-global function. After the init script starts, hostile page code can wrap the exposed binding, observe the next legitimate mutation/scroll/subtree response, recover the token, and then call the original binding with forged allowlisted `STREAM` messages. The allowlist does not contain this because forged `ext:dom-snapshot`, `ext:dom-mutations`, or `ext:ps-subtree-response` messages are valid stream types; this bypasses capture-side sanitization, masking, and relay-budget chokepoints before the host transport sees the payload.

**Fix:**
```javascript
var phantomStreamBridge = typeof window.__phantomStreamBridge === "function"
  ? window.__phantomStreamBridge
  : null;

var phantomStreamTransport = {
  send: function (type, payload) {
    try {
      if (typeof phantomStreamBridge !== "function") return;
      var result = phantomStreamBridge({
        token: PHANTOM_STREAM_BRIDGE_TOKEN,
        type: type,
        payload: payload || {}
      });
      if (result && typeof result.catch === "function") {
        result.catch(function () {});
      }
    } catch (e) { /* bridge failures must not break capture */ }
  },
  flush: function () {}
};
```

Capture the original binding in the injected closure before page scripts can replace it, and never read `window.__phantomStreamBridge` at send time. Add a regression test that replaces/wraps `window.__phantomStreamBridge` after injection, triggers a capture send, and asserts the wrapper never observes a token; keep the existing adapter tests that reject missing-token and wrong-type direct binding calls.

---

_Reviewed: 2026-06-16T04:47:26Z_
_Reviewer: the agent (gsd-code-reviewer)_
_Depth: standard_
