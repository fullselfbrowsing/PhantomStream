---
phase: 06
slug: extension-mv3-bookmarklet-adapters
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-06-15
---

# Phase 06 - Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Node `node:test` + `node:assert/strict` |
| **Config file** | `package.json` |
| **Quick run command** | `node --test tests/adapter-exports.test.js tests/extension-adapter.test.js tests/bookmarklet-adapter.test.js` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~30-60 seconds |

---

## Sampling Rate

- **After every task commit:** Run the focused test file named by the task.
- **After every plan wave:** Run `npm test`.
- **Before `$gsd-verify-work`:** Full suite must be green.
- **Max feedback latency:** 60 seconds for focused tests; full suite at wave boundaries.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 06-01-01 | 01 | 1 | ADPT-01/ADPT-03 | T-06-01 | Browser artifact has no `import`/`export` and exposes bridge hooks | unit/static | `node --test tests/adapter-exports.test.js` | missing W0 | pending |
| 06-01-02 | 01 | 1 | ADPT-01/ADPT-03 | T-06-01 | Package exports include extension and bookmarklet adapters | unit/static | `node --test tests/adapter-exports.test.js` | missing W0 | pending |
| 06-02-01 | 02 | 2 | ADPT-01 | T-06-02/T-06-03 | SW state persists in `chrome.storage.session`, not module globals | unit | `node --test tests/extension-adapter.test.js` | missing W0 | pending |
| 06-02-02 | 02 | 2 | ADPT-01 | T-06-04 | Watchdog alarm wake triggers fresh snapshot/resync | unit | `node --test tests/extension-adapter.test.js` | missing W0 | pending |
| 06-03-01 | 03 | 3 | ADPT-01 | T-06-05 | Local extension demo binds only to `127.0.0.1` and prints deterministic URLs | integration | `node --test tests/extension-demo-cli.test.js` | missing W0 | pending |
| 06-03-02 | 03 | 3 | ADPT-01 | T-06-06 | Browser verification proves real loaded extension live mirror | manual/browser | `npm test` plus `06-BROWSER-VERIFICATION.md` | missing W0 | pending |
| 06-04-01 | 04 | 2 | ADPT-03 | T-06-07 | Bookmarklet generator encodes config and rejects unsafe inputs | unit | `node --test tests/bookmarklet-adapter.test.js` | missing W0 | pending |
| 06-05-01 | 05 | 3 | ADPT-03 | T-06-08 | Bookmarklet demo prints copyable loader and local viewer/source URLs | integration | `node --test tests/bookmarklet-demo-cli.test.js` | missing W0 | pending |
| 06-05-02 | 05 | 3 | ADPT-03 | T-06-09 | Browser verification executes generated bookmarklet and proves snapshot + mutation | manual/browser | `npm test` plus `06-BROWSER-VERIFICATION.md` | missing W0 | pending |

---

## Wave 0 Requirements

- [ ] `tests/adapter-exports.test.js` - RED tests for package exports and browser inject artifact invariants.
- [ ] `tests/extension-adapter.test.js` - RED tests for MV3 service-worker state/recovery and content-script bridge.
- [ ] `tests/bookmarklet-adapter.test.js` - RED tests for bookmarklet source generation and validation.
- [ ] `tests/extension-demo-cli.test.js` - RED tests for extension demo CLI/server contract.
- [ ] `tests/bookmarklet-demo-cli.test.js` - RED tests for bookmarklet demo CLI/server contract.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Real loaded MV3 extension mirrors a page | ADPT-01 | Node fakes cannot prove Chrome actually loads the extension fixture and grants APIs | Run the extension demo, load the fixture extension in Chromium, open source/viewer URLs, start capture, mutate source, confirm viewer updates. |
| Forced SW eviction recovery in real browser | ADPT-01 | Programmatic eviction is browser-dependent; deterministic unit test covers the boundary | In extension service-worker DevTools or test harness, force/recreate SW, fire or wait for watchdog, confirm fresh snapshot returns viewer to live state. |
| Generated bookmarklet executes in page | ADPT-03 | Node tests can validate source shape but not browser bookmarklet execution | Run bookmarklet demo, execute generated bookmarklet on local source page, mutate source, confirm viewer receives snapshot and mutation. |

---

## Validation Sign-Off

- [x] All tasks have automated verify or Wave 0 dependencies.
- [x] Sampling continuity: no 3 consecutive tasks without automated verify.
- [x] Wave 0 covers all missing references.
- [x] No watch-mode flags.
- [x] Feedback latency target < 60s for focused tests.
- [x] `nyquist_compliant: true` set in frontmatter.

**Approval:** approved 2026-06-15
