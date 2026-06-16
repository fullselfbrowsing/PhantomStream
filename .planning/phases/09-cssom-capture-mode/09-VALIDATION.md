---
phase: 09
slug: cssom-capture-mode
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-06-16
---

# Phase 09 - Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Node built-in `node:test` with `jsdom@29.1.1`; Playwright Chromium smoke tests for CSSOM platform behavior |
| **Config file** | `package.json` test script; no separate test config |
| **Quick run command** | `node --test tests/capture-cssom-mode.test.js tests/renderer-cssom-mode.test.js tests/security-cssom-sanitize.test.js tests/protocol.test.js tests/adapter-exports.test.js` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~30-90 seconds for focused Node tests; Playwright smoke runtime depends on browser startup |

---

## Sampling Rate

- **After every task commit:** Run the smallest affected focused command from the map below, plus any touched sanitizer/static regression test.
- **After every plan wave:** Run the Phase 09 quick command once Wave 0 files exist; run the Playwright CSSOM smoke after browser-facing capture or renderer changes.
- **Before `$gsd-verify-work`:** Run `npm test`; run `node --test tests/playwright-cssom-mode.test.js` if it is not included in `npm test`.
- **Max feedback latency:** 90 seconds for focused Node feedback; Playwright smoke may exceed this and should run at wave/phase gates.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 09-W0-01 | 01 | 0 | CAPT-10 | T-09-01 | CSSOM mode is opt-in; default computed mode remains compatible | unit/differential | `node --test tests/capture-cssom-mode.test.js tests/differential/oracle.test.js` | missing for CSSOM file; existing for oracle | pending |
| 09-W0-02 | 01 | 0 | CAPT-10 | T-09-02 | Scoped style sources preserve document, open shadow, and same-origin frame boundaries | unit/integration | `node --test tests/capture-cssom-mode.test.js tests/renderer-cssom-mode.test.js` | missing | pending |
| 09-W0-03 | 02 | 0 | CAPT-10 | T-09-03 | Cross-origin CSS is not read without browser permission or explicit host fetch capability | unit/browser | `node --test tests/capture-cssom-mode.test.js tests/playwright-cssom-mode.test.js` | missing | pending |
| 09-W0-04 | 03 | 0 | CAPT-10 | T-09-04 | `insertRule`, `deleteRule`, `replace`, `replaceSync`, and `adoptedStyleSheets` changes flow as content-scrubbed style-source ops | unit/browser | `node --test tests/capture-cssom-mode.test.js tests/playwright-cssom-mode.test.js tests/protocol.test.js` | missing for CSSOM file; existing for protocol | pending |
| 09-W0-05 | 04 | 0 | CAPT-10 | T-09-05 | Renderer inserts CSSOM text only through the existing CSS scrub and sandbox/CSP posture | security/unit | `node --test tests/security-cssom-sanitize.test.js tests/security-chokepoint-purity.test.js tests/renderer-cssom-mode.test.js` | missing for CSSOM files; existing for chokepoint | pending |
| 09-W0-06 | 05 | 0 | CAPT-10 | T-09-06 | CSSOM mode avoids broad computed-property enumeration except selected fallback scopes | unit/static | `node --test tests/capture-cssom-mode.test.js tests/capture-added-styles.test.js` | missing for CSSOM file; existing for added styles | pending |
| 09-W0-07 | 05 | 0 | CAPT-10 | T-09-07 | Payload-size and serialize-latency smoke evidence is recorded for representative CSSOM fixtures | browser/smoke | `node --test tests/playwright-cssom-mode.test.js` | missing | pending |

*Status: pending, green, red, flaky*

---

## Wave 0 Requirements

- [ ] `tests/capture-cssom-mode.test.js` - stubs for CSSOM config gating, style-source collection, fallback chain, no broad computed enumeration, dynamic style-op producer, and styleStrategy counters.
- [ ] `tests/renderer-cssom-mode.test.js` - stubs for document, shadow, and frame style-source insertion plus style-source mutation replacement/removal.
- [ ] `tests/security-cssom-sanitize.test.js` - stubs for capture and renderer CSS sanitization of readable rules, fetched CSS, constructable CSS, and dynamic replacement CSS.
- [ ] `tests/playwright-cssom-mode.test.js` - browser-backed smoke coverage for CSS-in-JS class flips, cross-origin fallback, constructable/adopted stylesheets, `insertRule`/`deleteRule`, shadow/frame scopes, and payload/latency smoke.
- [ ] `tests/protocol.test.js` updated for the new style op and CSSOM payload typedef expectations.
- [ ] `tests/security-chokepoint-purity.test.js` updated if Phase 9 introduces new serialization or renderer insertion chokepoints.
- [ ] `tests/differential/divergence-ledger.js` updated only for opt-in CSSOM divergences; default computed mode remains oracle-compatible.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| None | N/A | Phase 09 success criteria have planned unit, integration, security, differential, and Playwright coverage. | N/A |

---

## Validation Sign-Off

- [x] All planned task areas have automated verify commands or Wave 0 dependencies.
- [x] Sampling continuity: no 3 consecutive tasks without automated verify.
- [x] Wave 0 covers all missing Phase 09 test references.
- [x] No watch-mode flags.
- [x] Feedback latency target is under 90 seconds for focused Node tests.
- [x] `nyquist_compliant: true` set in frontmatter.

**Approval:** approved 2026-06-16
