---
phase: 12
slug: static-assets-by-reference
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-20
---

# Phase 12 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Derived from `12-RESEARCH.md` → "## Validation Architecture". Per-task IDs are
> finalized by the planner; this file fixes the test surface, sampling, and Wave 0 gaps.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `node:test` + `node:assert/strict` (Node 24 built-ins) |
| **Config file** | none — `package.json` `scripts.test` = `node --test tests/*.test.js tests/differential/*.test.js` |
| **Quick run command** | `node --test tests/renderer-asset-policy.test.js tests/capture-asset-degrade.test.js` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~5–15 seconds (full suite incl. differential oracle) |

---

## Sampling Rate

- **After every task commit:** Run the quick command for the file touched (sub-second; e.g. the classifier table test for any asset-policy change)
- **After every plan wave:** Run `npm test` (full suite incl. differential oracle)
- **Before `/gsd:verify-work`:** Full suite green + Playwright asset UAT (or an explicit UAT-deferral note)
- **Max feedback latency:** ~15 seconds

---

## Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists |
|--------|----------|-----------|-------------------|-------------|
| ASST-01 | img/srcset/picture/source/svg-image absolutified; no bytes on relay | oracle + unit | `node --test tests/differential/oracle.test.js` | partial / ❌ W0 (relay byte-identity assertion) |
| ASST-02 | background-image + `<video>` poster absolute & render under `img-src` | jsdom renderer + oracle | `node --test tests/renderer-asset-gate.test.js` | ❌ W0 |
| ASST-03 | `data-ps-currentsrc` pin (clone-only); viewer pins + neutralizes srcset | unit (predicate) + oracle (D26) + jsdom (pin) | `node --test tests/differential/oracle.test.js tests/renderer-asset-gate.test.js` | ❌ W0 |
| ASST-04 | blob:/oversized-data → dimensioned placeholder; small data: byte-identical | capture unit | `node --test tests/capture-asset-degrade.test.js` | ❌ W0 |
| ASST-05 | CSP `img-src` covers assets; `default-src 'none'`, no `script-src`/`media-src` | string assertion (jsdom) + Playwright (real CSP) | `node --test tests/renderer-snapshot.test.js` | partial (extend existing) |
| MSEC-01 | origin classifier https-only + private-range deny; fail-closed hook; pre-write gate→placeholder | pure unit (classifier) + jsdom (gate) | `node --test tests/renderer-asset-policy.test.js tests/renderer-asset-gate.test.js` | ❌ W0 |
| MSEC-02 | `mediaMode` off/poster/reference selects posture; default reference | jsdom (gate behavior per mode) | `node --test tests/renderer-asset-gate.test.js` | ❌ W0 |

**Minimum regression-catching set per criterion (Nyquist):**
- ASST-01/02: 1 oracle run on `static-assets.html` + 1 relay byte-identity unit test
- ASST-03: 1 `currentSrcDiffers` table test + 1 oracle D26 fire + 1 jsdom pin/neutralize test
- ASST-04: 3 unit cases — `blob:`→placeholder, oversized-`data:`→placeholder, small-`data:`→byte-identical
- ASST-05: 1 string assertion (has `img-src`, has `default-src 'none'`, no `script-src`, no `media-src`)
- MSEC-01: a table test over the full denylist (allowed public-https + one of each blocked range/scheme + throwing-hook-fails-closed) + 1 jsdom "blocked URL never written, placeholder present" test
- MSEC-02: 3 jsdom cases — `off` (no asset write), `reference` (asset written), `poster` (poster path)

---

## Per-Task Verification Map

> Populated by the planner. Each task maps to one or more Req-IDs above and an
> automated command from the test map. Status legend: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|--------|
| _(planner fills)_ | | | | | | | | ⬜ pending |

---

## Wave 0 Requirements

- [ ] `tests/renderer-asset-policy.test.js` — pure classifier table (MSEC-01)
- [ ] `tests/renderer-asset-gate.test.js` — jsdom srcdoc-glue: gate→placeholder, currentSrc pin, mediaMode behavior, CSP assertion (ASST-02/03/05, MSEC-01/02)
- [ ] `tests/capture-asset-degrade.test.js` — blob/oversized-data/small-data + currentSrc enrichment (ASST-03/04)
- [ ] `tests/differential/fixtures/static-assets.html` — focused asset fixture
- [ ] `tests/differential/scenarios/static-assets.js` — scenario injecting divergent `currentSrc` (jsdom `currentSrc===""`)
- [ ] `tests/differential/divergence-ledger.js` — D26 (and possibly D27) `mismatch` entry; register fixture row + import in `oracle.test.js`
- [ ] (extend) `tests/renderer-snapshot.test.js` or `tests/security-chokepoint-purity.test.js` — CSP `img-src`/no-`media-src` assertion
- [ ] Framework install: none — `node:test` + jsdom already present

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Real meta-CSP enforcement (image loads; script/fetch blocked by `default-src 'none'`) | ASST-05 | jsdom does not enforce CSP | Playwright: load srcdoc viewer, assert `<img>` paints, assert injected `<script>`/`fetch()` blocked |
| Blocked-origin GET suppression (no network request to denied origin) | MSEC-01 | Requires real network stack | Playwright: route-intercept; assert zero requests to a private/denied host; placeholder present |
| Snapshot pre-fetch timing (parser fetching `<img>` before the post-parse gate) | MSEC-01 / Pitfall 1 | jsdom doesn't fetch on parse | Playwright: serve a blocked-origin `<img>` in a snapshot; assert no GET fired (string-layer gate works) |
| Real `srcset`/`sizes` neutralization preventing re-negotiation | ASST-03 | Requires real responsive-image + DPR | Playwright at 2 DPRs: assert the pinned `currentSrc` loads, not a re-negotiated variant |
| mixed-content / CORS outcomes → placeholder | ASST-04 | Requires real fetch outcomes | Playwright: http asset under https viewer → placeholder; CORS-blocked asset → placeholder |

*Playwright asset UAT may be deferred with an explicit note per the autonomous human-verification routing.*

---

## Validation Sign-Off

- [ ] All tasks have automated verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
