---
phase: 1
slug: capture-core-extraction-differential-oracle
status: planned
nyquist_compliant: true
wave_0_complete: false
created: 2026-06-09
updated: 2026-06-09
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | node:test (built-in, Node ≥ 20.19 for dev/test; jsdom 29.x as devDependency) |
| **Config file** | none — Wave 0 (Plan 01-01 Task 1) installs jsdom + fixes test glob |
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
| 01-01-T1 | 01-01 | 1 | CAPT-04 (infra) | T-01-SC | jsdom devDeps only + lockfile | config check | `npm test` + package.json assertions | ✅ (npm test exists) | ⬜ pending |
| 01-01-T2 | 01-01 | 1 | CAPT-04 | T-01-01 | runScripts outside-only default | integration | `node --test tests/differential/oracle.test.js` | ❌ created by task | ⬜ pending |
| 01-01-T3 | 01-01 | 1 | CAPT-04 (CI) | T-01-02 | permissions contents: read | grep gate | workflow grep + `npm test` | ❌ created by task | ⬜ pending |
| 01-02-T1 | 01-02 | 2 | CAPT-04 | T-01-01 | fixtures frozen in repo | data check | generator byte-identical + fixture probes | ❌ created by task | ⬜ pending |
| 01-02-T2 | 01-02 | 2 | CAPT-04 | T-01-01 | 'dangerously' confined to dialog fixture | integration | `npm test` | ❌ created by task | ⬜ pending |
| 01-03-T1 | 01-03 | 3 | CAPT-01 | — | purity gate (red first) | static scan | `node --test tests/capture-purity.test.js` (red) | ❌ created by task | ⬜ pending |
| 01-03-T2 | 01-03 | 3 | CAPT-01, CAPT-02 | T-01-03 accept, T-01-04 | transport errors never thrown | static + smoke | purity green + bare-Node import + `npm test` | ❌ depends on T1 | ⬜ pending |
| 01-04-T1 | 01-04 | 4 | CAPT-04, CAPT-01 | — | globals restored in finally | integration | `node --test tests/differential/oracle.test.js` + `npm test` | ✅ after 01-01 | ⬜ pending |
| 01-04-T2 | 01-04 | 4 | CAPT-04 | T-01-03 accept | undeclared divergence fails suite | integration | `npm test` | ✅ after 01-01 | ⬜ pending |
| 01-05-T1 | 01-05 | 4 | CAPT-02 | T-01-04 | throwing transport contained | unit | `node --test tests/capture-lifecycle.test.js` | ❌ created by task | ⬜ pending |
| 01-05-T2 | 01-05 | 4 | CAPT-03 | — | N/A | unit | `node --test tests/capture-defenses.test.js` | ❌ created by task | ⬜ pending |
| 01-05-T3 | 01-05 | 4 | CAPT-03 | T-01-05 | Date fake isolated per file | unit + doc check | `node --test tests/capture-watchdog.test.js` + README grep + `npm test` | ❌ created by task | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Covered by Plan 01-01 (Wave 1):

- [ ] jsdom installed as devDependency (`npm install --save-dev jsdom@^29.1.1`) + lockfile committed — Plan 01-01 Task 1
- [ ] `package.json` test script fixed to `node --test "tests/**/*.test.js"` (Node 24 glob semantics) — Plan 01-01 Task 1
- [ ] `tests/differential/` harness skeleton (dual-jsdom loader, normalizer, ledger) — Plan 01-01 Task 2
- [ ] `.github/workflows/ci.yml` — CI running `npm test` — Plan 01-01 Task 3

---

## Manual-Only Verifications

*None — jsdom oracle decision makes the full phase automatable. Real-browser behaviors are explicitly deferred to later phases per CONTEXT.md. (CI's first cloud run is observed on push, but `npm test` locally is the authoritative gate.)*

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (all in Plan 01-01, Wave 1)
- [x] No watch-mode flags
- [x] Feedback latency < 60s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** planner sign-off 2026-06-09 (pending checker)
