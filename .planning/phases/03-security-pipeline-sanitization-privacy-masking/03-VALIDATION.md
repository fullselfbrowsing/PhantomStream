---
phase: 3
slug: security-pipeline-sanitization-privacy-masking
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-11
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | node:test + jsdom 29.x (installed; suite currently 130/130) |
| **Config file** | none — infrastructure complete from Phases 1–2 |
| **Quick run command** | `node --test tests/<new-security-test-file>.test.js` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~20–25 seconds |

---

## Sampling Rate

- **After every task commit:** Run the affected test file via `node --test`
- **After every plan wave:** Run `npm test` (incl. differential oracle)
- **Before `/gsd-verify-work`:** Full suite green
- **Max feedback latency:** 60 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| *(filled by planner)* | | | SEC-01/02/03 | mXSS suite | chokepoints + masking on all paths | unit/e2e/oracle | `npm test` | created in-task | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Existing infrastructure covers the phase. Notes:
- [ ] New `sanitize-corpus.html` fixture + `sanitize-divergence.js` scenario required to make the sanitization ledger entry load-bearing (existing fixtures are sanitization-quiet — verified by grep in RESEARCH.md)
- [ ] mXSS fixture suite curated in-repo, run against BOTH chokepoints

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Demo dogfood spot-check | SEC-01/02 | Visual confirmation that sanitization causes no visible fidelity change on benign content | `npm run example:loopback` — mirror renders identically to pre-Phase-3 |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
