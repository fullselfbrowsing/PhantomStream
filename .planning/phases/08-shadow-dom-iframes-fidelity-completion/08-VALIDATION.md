---
phase: 08
slug: shadow-dom-iframes-fidelity-completion
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-06-15
---

# Phase 08 - Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Node built-in `node:test` with `jsdom@29.1.1`; Playwright browser smoke tests for platform fidelity |
| **Config file** | `package.json` test script; no separate test config |
| **Quick run command** | `node --test tests/capture-shadow-dom.test.js tests/renderer-shadow-dom.test.js tests/capture-iframe.test.js tests/renderer-iframe.test.js tests/capture-input-values.test.js tests/renderer-value-diff.test.js tests/capture-added-styles.test.js tests/capture-subtree-fetch.test.js tests/renderer-subtree-fetch.test.js tests/playwright-fidelity-phase8.test.js` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~15 seconds for focused Node tests; full suite runtime depends on Playwright smoke inclusion |

---

## Sampling Rate

- **After every task commit:** Run the smallest affected focused command from the map below plus any touched security/static test.
- **After every plan wave:** Run the Phase 08 quick command once the Wave 0 files exist.
- **Before `$gsd-verify-work`:** Run `npm test`; run `node --test tests/playwright-fidelity-phase8.test.js` if the Playwright smoke is not included in `npm test`.
- **Max feedback latency:** 60 seconds for focused tests.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 08-W0-01 | 01 | 0 | CAPT-08 | T-08-01 | Shadow HTML is sanitized before renderer import; slot children are not duplicated | unit | `node --test tests/capture-shadow-dom.test.js tests/renderer-shadow-dom.test.js` | missing | pending |
| 08-W0-02 | 01 | 0 | CAPT-09 | T-08-02 | Cross-origin iframe content is never read; placeholder metadata is content-free | unit | `node --test tests/capture-iframe.test.js tests/renderer-iframe.test.js` | missing | pending |
| 08-W0-03 | 02 | 0 | CAPT-05 | T-08-03 | Value diffs preserve password masking and `maskInputs`/`maskInputFn` behavior | unit | `node --test tests/capture-input-values.test.js tests/renderer-value-diff.test.js tests/security-mask.test.js` | missing | pending |
| 08-W0-04 | 03 | 0 | CAPT-06 | T-08-04 | Added-node style serialization uses curated properties and no all-property enumeration | unit/static | `node --test tests/capture-added-styles.test.js tests/security-sanitize-capture.test.js` | missing | pending |
| 08-W0-05 | 04 | 0 | CAPT-11 | T-08-05 | Subtree responses reuse sanitization, masking, identity sidecars, and staleness checks | unit/integration | `node --test tests/capture-subtree-fetch.test.js tests/renderer-subtree-fetch.test.js tests/renderer-loopback.test.js` | missing | pending |
| 08-W0-06 | 04 | 0 | CAPT-08, CAPT-09, CAPT-05 | T-08-01/T-08-02/T-08-03 | Browser smoke proves real shadow slots, iframe origin behavior, and actual input/change events | browser | `node --test tests/playwright-fidelity-phase8.test.js` | missing | pending |

*Status: pending, green, red, flaky*

---

## Wave 0 Requirements

- [ ] `tests/capture-shadow-dom.test.js` - stubs for CAPT-08 capture snapshot/add/mutation sidecars.
- [ ] `tests/renderer-shadow-dom.test.js` - stubs for CAPT-08 reconstruction, identity indexing, and slot non-duplication.
- [ ] `tests/capture-iframe.test.js` - stubs for CAPT-09 same-origin/cross-origin classification and payload sanitization.
- [ ] `tests/renderer-iframe.test.js` - stubs for CAPT-09 inert nested iframe and placeholder reconstruction.
- [ ] `tests/capture-input-values.test.js` - stubs for CAPT-05 event-driven form value capture and masking.
- [ ] `tests/renderer-value-diff.test.js` - stubs for CAPT-05 value op apply.
- [ ] `tests/capture-added-styles.test.js` - stubs for CAPT-06 curated style capture for add ops.
- [ ] `tests/capture-subtree-fetch.test.js` - stubs for CAPT-11 capture-side fetch response behavior.
- [ ] `tests/renderer-subtree-fetch.test.js` - stubs for CAPT-11 request latching, staleness, and response installation.
- [ ] `tests/playwright-fidelity-phase8.test.js` - browser-backed smoke coverage for shadow slots, iframe origin behavior, and real input/change events.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| None | N/A | All Phase 08 success criteria have automated unit, integration, or Playwright coverage. | N/A |

---

## Validation Sign-Off

- [x] All planned task areas have automated verify commands or Wave 0 dependencies.
- [x] Sampling continuity: no 3 consecutive tasks without automated verify.
- [x] Wave 0 covers all missing Phase 08 test references.
- [x] No watch-mode flags.
- [x] Feedback latency target is under 60 seconds for focused tests.
- [x] `nyquist_compliant: true` set in frontmatter.

**Approval:** approved 2026-06-15
