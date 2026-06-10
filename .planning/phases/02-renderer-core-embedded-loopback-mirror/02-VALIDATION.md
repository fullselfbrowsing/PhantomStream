---
phase: 2
slug: renderer-core-embedded-loopback-mirror
status: final
nyquist_compliant: true
wave_0_complete: false
created: 2026-06-10
updated: 2026-06-10
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

Test files are created IN the same task as the code they verify (test-first within task, `tdd="true"` + `<behavior>` blocks) — no separate Wave 0 needed; every task carries its own `<automated>` verify.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 02-01/T1 | 02-01 | 1 | VIEW-01 | T-02-02 | shell-attr on*/style drop + escaping pinned | unit (pure) | `node --test tests/renderer-snapshot.test.js` | created in-task | ⬜ pending |
| 02-01/T2 | 02-01 | 1 | VIEW-01 | T-02-03 | per-op containment; NID_ATTR addressing | unit (createHTMLDocument) | `node --test tests/renderer-diff.test.js` | created in-task | ⬜ pending |
| 02-02/T1 | 02-02 | 1 | VIEW-04, VIEW-06 | T-02-04, T-02-05, T-02-07 | dialog/progress textContent-only; renderFn containment; unknown kinds ignored | unit (jsdom, stubbed rects) | `node --test tests/renderer-overlays.test.js` | created in-task | ⬜ pending |
| 02-02/T2 | 02-02 | 1 | VIEW-04 | T-02-06 | identity keys never overwritten by provider; default wire shape unchanged (oracle) | unit + full oracle | `npm test` | created in-task | ⬜ pending |
| 02-03/T1 | 02-03 | 2 | VIEW-01, VIEW-06 | T-02-08, T-02-09, T-02-10 | sandbox token list pinned exactly; isCurrentStream gating; dispatch loop containment | unit/integration (jsdom) | `node --test tests/renderer-viewer.test.js` | created in-task | ⬜ pending |
| 02-03/T2 | 02-03 | 2 | VIEW-01 | — | zero FSB/chrome/dashboard refs in src/renderer | static scan | `node --test tests/renderer-purity.test.js` | created in-task | ⬜ pending |
| 02-04/T1 | 02-04 | 3 | ADPT-04 | T-02-13 | recursion guard (no srcdoc echo, clean snapshot); resync round-trip | integration (e2e jsdom) | `node --test tests/renderer-loopback.test.js` | created in-task | ⬜ pending |
| 02-04/T2 | 02-04 | 3 | VIEW-04, VIEW-06 | T-02-14 | dialog literal-text end-to-end; custom kind via registry | integration (e2e jsdom) | `node --test tests/renderer-loopback.test.js` | created in-task | ⬜ pending |
| 02-04/T3 | 02-04 | 3 | ADPT-04 | T-02-15 | accepted risks ledgered (raw styles, on* survival → Phase 3) | doc assertions | `grep -ciE "divergence" src/renderer/README.md` | created in-task | ⬜ pending |
| 02-05/T1 | 02-05 | 3 | ADPT-04 | T-02-16, T-02-17 | traversal guard, localhost bind, ESM MIME | syntax + curl checks | `node --check examples/serve.js` + curl criteria | created in-task | ⬜ pending |
| 02-05/T2 | 02-05 | 3 | ADPT-04, VIEW-01 | T-02-18, T-02-19 | skipElement marker present; page never sets sandbox | source assertions | contract-string node script in plan + `npm test` | created in-task | ⬜ pending |
| 02-06/T1 | 02-06 | 4 | all | — | full gate green before checkpoint | full suite | `npm test` | exists | ⬜ pending |
| 02-06/T2 | 02-06 | 4 | all | T-02-20 | human inspects live sandbox attr in DevTools | manual checkpoint | — (human-verify) | — | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements (node:test + jsdom from Phase 1). Notes:
- [x] Renderer factored into Document-parameterized pure functions (`buildSnapshotHtml`, `applyMutations`, `computeScale`) so jsdom tests work without srcdoc parsing (jsdom 29 does NOT parse srcdoc — verified in RESEARCH.md) — enforced by plans 02-01/02-03
- [x] Renderer tests use flat `tests/renderer-*.test.js` naming — the existing `package.json` test glob needs NO change (plans pin this)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Loopback demo visual check | ADPT-04, VIEW-01 | Real-browser rendering (scaling, overlays, live mutation tracking, srcdoc parsing) can't be proven in jsdom | Plan 02-06 checkpoint: `npm run example:loopback`, open the served page in Chrome, run the nine-step script (mirror tracks mutations, scaling/letterboxing, scroll follow, dialog log line, sandbox attr inspection, no mirror-of-mirror, LIVE badge pulse) |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (none — tests created in-task)
- [x] No watch-mode flags
- [x] Feedback latency < 60s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** filled by planner 2026-06-10 (plans 02-01 … 02-06)
