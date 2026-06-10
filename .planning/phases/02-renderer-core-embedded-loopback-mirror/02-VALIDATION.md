---
phase: 2
slug: renderer-core-embedded-loopback-mirror
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-10
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | node:test (built-in; jsdom 29.x devDependency already installed in Phase 1) |
| **Config file** | none — infrastructure exists from Phase 1 (test script globs `tests/*.test.js tests/differential/*.test.js`) |
| **Quick run command** | `node --test tests/renderer*.test.js` (or the specific new test file) |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~15–20 seconds (50 existing tests + new renderer tests) |

---

## Sampling Rate

- **After every task commit:** Run the new/affected renderer test file via `node --test`
- **After every plan wave:** Run `npm test`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 60 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| *(filled by planner)* | | | VIEW-01/04/06, ADPT-04 | sandbox assertion | iframe `sandbox="allow-same-origin"` only, asserted at creation | unit/integration | `npm test` | ❌ created by tasks | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements (node:test + jsdom from Phase 1). Notes:
- [ ] Renderer must be factored into Document-parameterized pure functions (`buildSnapshotHtml`, `applyMutations`, `computeScale`) so jsdom tests work without srcdoc parsing (jsdom 29 does NOT parse srcdoc — verified in RESEARCH.md)
- [ ] If renderer tests land in a new subdirectory, extend the `package.json` test glob (current: `tests/*.test.js tests/differential/*.test.js`)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Loopback demo visual check | ADPT-04, VIEW-01 | Real-browser rendering (scaling, overlays, live mutation tracking) can't be proven in jsdom | `npm run example:loopback`, open the served page in Chrome, verify live mirror tracks mutations, glow/progress/dialog overlays render, LIVE badge pulses |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
