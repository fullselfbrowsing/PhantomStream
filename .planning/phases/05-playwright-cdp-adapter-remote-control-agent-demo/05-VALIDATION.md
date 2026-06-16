---
phase: 05
slug: playwright-cdp-adapter-remote-control-agent-demo
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-06-15
---

# Phase 05 - Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Node `node:test` with focused fake Playwright/CDP fixtures; Playwright used for browser demo verification |
| **Config file** | `package.json` scripts; no separate test runner config |
| **Quick run command** | `node --test tests/remote-control-protocol.test.js tests/playwright-adapter.test.js tests/playwright-adapter-cdp.test.js tests/renderer-remote-control.test.js tests/playwright-demo-cli.test.js` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~15-45 seconds for quick tests after files exist; full suite currently passed at 252 tests before planning |

---

## Sampling Rate

- **After every task commit:** Run the focused test file touched by the task; when a task spans modules, run the quick run command above.
- **After every plan wave:** Run `npm test`.
- **Before `$gsd-verify-work`:** Full `npm test` plus Playwright demo browser checkpoint must be green.
- **Max feedback latency:** 60 seconds for automated quick checks, excluding first-time Playwright browser installation.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 05-00-01 | 00 | 0 | VIEW-05 / SEC-04 | T-05-01 / T-05-02 | Remote payload validators reject malformed coordinates/actions and redact typed text from summaries | unit | `node --test tests/remote-control-protocol.test.js` | W0 | pending |
| 05-00-02 | 00 | 0 | ADPT-02 / SEC-04 | T-05-03 / T-05-04 | Adapter installs binding before init script, ignores child frames, default-denies control, and emits denial state | fake Playwright unit | `node --test tests/playwright-adapter.test.js` | W0 | pending |
| 05-00-03 | 00 | 0 | ADPT-02 / VIEW-05 | T-05-05 / T-05-06 | CDP fallback uses `Page.addScriptToEvaluateOnNewDocument` and `Input.dispatch*` without DOM synthetic events | fake CDP unit | `node --test tests/playwright-adapter-cdp.test.js` | W0 | pending |
| 05-00-04 | 00 | 0 | VIEW-05 | T-05-07 | Viewer inverse mapping rejects letterbox clicks and maps stage coordinates to viewport CSS pixels | jsdom unit | `node --test tests/renderer-remote-control.test.js` | W0 | pending |
| 05-00-05 | 00 | 0 | PKG-02 / SEC-04 | T-05-08 | Demo command prints local viewer/driven URLs and `Control: default-deny` without opening browsers by default | CLI integration | `node --test tests/playwright-demo-cli.test.js` | W0 | pending |
| 05-01-01 | 01 | 1 | ADPT-02 | T-05-03 / T-05-04 | Single-file inject artifact contains no `import` and bridges capture frames through the exposed binding | unit | `node --test tests/playwright-adapter.test.js tests/playwright-adapter-cdp.test.js` | depends on W0 | pending |
| 05-02-01 | 02 | 1 | VIEW-05 / SEC-04 | T-05-01 / T-05-02 / T-05-07 | Viewer control overlay sends only approved click/text/key/scroll frames and emits content-free state | unit | `node --test tests/remote-control-protocol.test.js tests/renderer-remote-control.test.js` | depends on W0 | pending |
| 05-03-01 | 03 | 2 | PKG-02 | T-05-08 / T-05-09 | Playwright demo uses 127.0.0.1, deterministic fixture, approved remote actions, denied control, and navigation re-snapshot | CLI + browser | `node --test tests/playwright-demo-cli.test.js && npm test` | depends on W0 | pending |

---

## Wave 0 Requirements

- [ ] `tests/remote-control-protocol.test.js` - validator and telemetry redaction stubs for SEC-04/VIEW-05.
- [ ] `tests/playwright-adapter.test.js` - fake Playwright page/session stubs for binding/init order, default deny, child-frame filtering, bridge forwarding, and navigation restart.
- [ ] `tests/playwright-adapter-cdp.test.js` - fake `CDPSession` stubs for CDP injection and `Input.dispatch*` replay.
- [ ] `tests/renderer-remote-control.test.js` - jsdom renderer/control overlay and inverse coordinate mapping stubs.
- [ ] `tests/playwright-demo-cli.test.js` - CLI/server output contract stubs for the Playwright demo command.
- [ ] `npm install --save-dev playwright@1.60.0` before browser-level verification.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Remote click/type/scroll visibly change the real driven page and mirror updates | PKG-02 / VIEW-05 | Requires a real browser surface and visual inspection of both viewer and driven page behavior | Run the Playwright demo, open the viewer with FSB/Browser, set authorization to approve, click `Click target`, type into `Remote text`, and wheel in the scroll region; verify the driven page changes and the mirror follows. |
| Denied control remains inert | SEC-04 | Must prove no native input dispatch occurs from a denied UI state | Run the Playwright demo with authorization set to deny, click `Request control`, attempt click/type/scroll in the mirror, and verify denial state/log/counter update while driven page counts/text/scroll do not change. |
| Navigation re-snapshot survives page change | ADPT-02 / PKG-02 | Browser navigation and re-injection must be observed end-to-end | In the demo, activate the fixture navigation/reload target and verify the viewer returns to `Live`, navigation count increments, and the new snapshot renders. |

---

## Threat References

| Ref | Threat | Required Mitigation |
|-----|--------|---------------------|
| T-05-01 | Malformed or out-of-range control payload triggers unintended input | Pure validators reject non-finite coordinates, unknown action types, bad deltas, and letterbox coordinates before replay. |
| T-05-02 | Typed content leaks into logs, health, denial, or state telemetry | Summaries expose character counts only; no mirrored HTML, attributes, captured text, or user-entered text in telemetry. |
| T-05-03 | Control activates without consent | Adapter default-denies and calls the host authorization hook before active state. |
| T-05-04 | Denied/inactive control still dispatches driver input | Adapter checks active authorization before every replay action and emits denial/inert state instead. |
| T-05-05 | Adapter uses synthetic DOM events in captured page | Replay code uses Playwright mouse/keyboard/wheel or CDP `Input.dispatch*` only; tests assert no `dispatchEvent`/`element.click()` path. |
| T-05-06 | New-document injection misses navigation or child frames corrupt the stream | Adapter registers `addInitScript`/CDP new-document script and filters bridge messages to the main frame. |
| T-05-07 | Viewer letterbox/stale scale mapping replays clicks to wrong page coordinates | Inverse mapping clamps/rejects outside page bounds and uses current scale/offset/viewport dimensions. |
| T-05-08 | Demo weakens local-only safety posture | Demo binds to `127.0.0.1`, prints local URLs, and keeps control default-deny. |
| T-05-09 | Relay becomes an execution boundary for remote control | Relay remains raw fan-out; driver logic stays in adapter/demo process. |

---

## Validation Sign-Off

- [x] All phase requirements have Wave 0 automated coverage.
- [x] Browser-only behavior is isolated to explicit manual checkpoints.
- [x] Sampling continuity: no 3 consecutive implementation tasks should proceed without a focused automated verify.
- [x] No watch-mode flags.
- [x] Feedback latency target documented.
- [x] `nyquist_compliant: true` set in frontmatter.

**Approval:** approved 2026-06-15 for planning; Wave 0 test files still pending execution implementation.
