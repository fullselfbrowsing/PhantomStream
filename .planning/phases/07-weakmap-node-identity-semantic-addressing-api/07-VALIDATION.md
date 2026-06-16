---
phase: 07
slug: weakmap-node-identity-semantic-addressing-api
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-06-15
---

# Phase 07 - Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Node.js `node:test` |
| **Config file** | `package.json` |
| **Quick run command** | `node --test tests/capture-identity.test.js tests/renderer-diff.test.js tests/semantic-addressing.test.js tests/node-identity-static.test.js` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~30-90 seconds |

---

## Sampling Rate

- **After every task commit:** Run the plan-specific focused `node --test ...` command.
- **After every plan wave:** Run `npm test`.
- **Before `$gsd-verify-work`:** `npm test` must be green.
- **Max feedback latency:** 90 seconds for the full suite on this repo.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 07-01-01 | 01 | 1 | CAPT-07 | T-07-01 | Live page receives no framework identity attrs | unit/static | `node --test tests/capture-identity.test.js` | W0 | pending |
| 07-01-02 | 01 | 1 | CAPT-07 | T-07-02 | Sidecars preserve raw nid sequence | unit/oracle | `node --test tests/capture-identity.test.js tests/differential/oracle.test.js` | W0 | pending |
| 07-02-01 | 02 | 2 | VIEW-03 | T-07-03 | Renderer resolves through Map index | unit/static | `node --test tests/renderer-diff.test.js tests/renderer-overlays.test.js tests/node-identity-static.test.js` | W0 | pending |
| 07-03-01 | 03 | 3 | VIEW-03 | T-07-04 | Public API exposes geometry/highlight without content | unit | `node --test tests/semantic-addressing.test.js tests/renderer-viewer.test.js` | W0 | pending |
| 07-04-01 | 04 | 4 | CAPT-07, VIEW-03 | T-07-05 | Adapter/demo surfaces consume new identity contract | integration | `node --test tests/renderer-loopback.test.js tests/adapter-exports.test.js tests/playwright-adapter.test.js tests/extension-adapter.test.js tests/bookmarklet-adapter.test.js` | W0 | pending |

---

## Wave 0 Requirements

- [ ] `tests/capture-identity.test.js` - no live-page mutation, sidecar, move-preservation, and `getNodeId` coverage.
- [ ] `tests/semantic-addressing.test.js` - viewer resolve/highlight API coverage.
- [ ] `tests/node-identity-static.test.js` - forbidden identity attribute/querySelector source checks.

---

## Manual-Only Verifications

All Phase 7 behaviors have automated verification. Existing browser/demo dogfood remains useful but is not the primary proof for this identity migration.

---

## Validation Sign-Off

- [x] All tasks have automated verify commands or Wave 0 dependencies.
- [x] Sampling continuity: no 3 consecutive tasks without automated verify.
- [x] Wave 0 covers all missing references.
- [x] No watch-mode flags.
- [x] Feedback latency target is under 90 seconds.
- [x] `nyquist_compliant: true` set in frontmatter.

**Approval:** approved 2026-06-15

