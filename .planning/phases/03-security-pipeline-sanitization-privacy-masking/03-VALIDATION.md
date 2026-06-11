---
phase: 3
slug: security-pipeline-sanitization-privacy-masking
status: planned
nyquist_compliant: true
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
| 03-01-T1 | 03-01 | 1 | SEC-01 | T-03-01..06 | sanitizeForWire scrubs snapshot/add-op subtrees + head CSS; live page untouched | unit (jsdom wire) | `node --test tests/security-sanitize-capture.test.js` | created in-task | ⬜ pending |
| 03-01-T2 | 03-01 | 1 | SEC-01 | T-03-01/02/05 | attr-op on*/srcdoc dropped, schemes neutralized, style scrubbed; text branches routed (mask seam) | unit (jsdom wire) | `node --test tests/security-sanitize-capture.test.js && npm test` | created in-task | ⬜ pending |
| 03-02-T1 | 03-02 | 1 | SEC-02 | T-03-07/12 | sanitizeFragment walker + sanitizeAttrValue + scrubCssText; render mXSS corpus | unit (fragment) | `node --test tests/security-sanitize-render.test.js tests/renderer-purity.test.js` | created in-task | ⬜ pending |
| 03-02-T2 | 03-02 | 1 | SEC-02 | T-03-07/08 | template-context ADD parse + fragment scrub + attr-op scrub; pins :85/:133 re-pinned | unit (doc-based) | `node --test tests/renderer-diff.test.js tests/security-sanitize-render.test.js` | modified in-task | ⬜ pending |
| 03-02-T3 | 03-02 | 1 | SEC-02 | T-03-09/10/11 | CSP meta (exact locked policy) + inlineStyles scrub + per-session counters + post-parse scrub; pins :104/:113 re-pinned | unit (string) | `node --test tests/renderer-snapshot.test.js tests/renderer-viewer.test.js && npm test` | modified in-task | ⬜ pending |
| 03-03-T1 | 03-03 | 2 | SEC-03 | T-03-15/16/17 | maskTextSelector + maskTextFn mask all text paths; fail-closed containment; factory-throw on bad selector | unit (jsdom wire) | `node --test tests/security-mask.test.js` | created in-task | ⬜ pending |
| 03-03-T2 | 03-03 | 2 | SEC-03 | T-03-13/14 | blockSelector placeholder (rr_width/rr_height), blocked mutations emit nothing, password always masked, maskInputs | unit (jsdom wire) | `node --test tests/security-mask.test.js && npm test` | modified in-task | ⬜ pending |
| 03-04-T1 | 03-04 | 3 | SEC-01/03 | T-03-19 | hostile fixture + post-snapshot mutation scenario exist (load-bearing pair) | fixture/scenario | `node --test tests/differential/oracle.test.js` | created in-task | ⬜ pending |
| 03-04-T2 | 03-04 | 3 | SEC-01/03 | T-03-19/20/21 | D7 declared, exhibited, scoped, load-bearing; stale-entry detection green | oracle integration | `node --test tests/differential/oracle.test.js && npm test` | modified in-task | ⬜ pending |
| 03-05-T1 | 03-05 | 4 | SEC-01/02 | T-03-22/23/25 | chokepoint-coverage scan, allow-scripts/innerHTML rules, SECURITY.md content guard | static scan | `node --test tests/security-chokepoint-purity.test.js` | created in-task | ⬜ pending |
| 03-05-T2 | 03-05 | 4 | SEC-02 | T-03-24/25 | embed contract documented (sandbox, CSP, masking guarantees, must-nevers, residual risks) | static scan | `node --test tests/security-chokepoint-purity.test.js && npm test` | created in-task | ⬜ pending |
| 03-05-T3 | 03-05 | 4 | SEC-01/02/03 | all | demo dogfood: benign fidelity unchanged, hostile injections neutralized, sandbox/CSP inspected | human checkpoint | `npm test` (gate) + manual steps | n/a | ⬜ pending |

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

- [x] All tasks have `<automated>` verify or Wave 0 dependencies (every test file is created in the same task that needs it — TDD ordering inside each task)
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (security-* test files, sanitize-corpus fixture, sanitize-divergence scenario, ledger entry, SECURITY.md guard — all assigned to plans 03-01..03-05)
- [x] No watch-mode flags
- [x] Feedback latency < 60s (`npm test` ~25s; per-file runs sub-second)
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
