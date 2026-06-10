---
phase: 1
slug: capture-core-extraction-differential-oracle
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-09
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | node:test (built-in, Node ≥ 20.19 for dev/test; jsdom 29.x as devDependency) |
| **Config file** | none — Wave 0 installs jsdom + fixes test glob |
| **Quick run command** | `node --test "tests/**/*.test.js"` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run `node --test "tests/**/*.test.js"`
- **After every plan wave:** Run `npm test`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 60 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| *(filled by planner)* | | | CAPT-01..04 | — | N/A | unit/differential | `npm test` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] jsdom installed as devDependency (`npm install --save-dev jsdom`) + lockfile committed
- [ ] `package.json` test script fixed to `node --test "tests/**/*.test.js"` (Node 24 glob semantics)
- [ ] `tests/differential/` harness skeleton (dual-jsdom loader, normalizer, ledger)
- [ ] `.github/workflows/ci.yml` — CI running `npm test`

---

## Manual-Only Verifications

*None expected — jsdom oracle decision makes the full phase automatable. Real-browser behaviors are explicitly deferred to later phases per CONTEXT.md.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
