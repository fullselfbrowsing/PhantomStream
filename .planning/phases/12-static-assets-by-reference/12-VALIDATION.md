---
phase: 12
slug: static-assets-by-reference
status: planned
nyquist_compliant: true
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
| ASST-01 | img/srcset/picture/source/svg-image absolutified; no bytes on relay | oracle + unit | `node --test tests/differential/oracle.test.js tests/relay-asset-bytes.test.js` | ✅ (12-01) |
| ASST-02 | background-image + `<video>` poster absolute & render under `img-src` | jsdom renderer + oracle | `node --test tests/renderer-asset-gate.test.js` | ✅ scaffold (12-01) → fill (12-03) |
| ASST-03 | `data-ps-currentsrc` pin (clone-only); viewer pins + neutralizes srcset | unit (predicate) + oracle (D26) + jsdom (pin) | `node --test tests/differential/oracle.test.js tests/renderer-asset-gate.test.js` | ✅ scaffold (12-01) → fill (12-02/12-03) |
| ASST-04 | blob:/oversized-data → dimensioned placeholder; small data: byte-identical | capture unit | `node --test tests/capture-asset-degrade.test.js` | ✅ scaffold (12-01) → fill (12-02) |
| ASST-05 | CSP `img-src` covers assets; `default-src 'none'`, no `script-src`/`media-src` | string assertion (jsdom) + Playwright (real CSP) | `node --test tests/renderer-snapshot.test.js` | ✅ (12-01) |
| MSEC-01 | origin classifier https-only + private-range deny; fail-closed hook; pre-write gate→placeholder | pure unit (classifier) + jsdom (gate) | `node --test tests/renderer-asset-policy.test.js tests/renderer-asset-gate.test.js` | ✅ scaffold (12-01) → fill (12-03) |
| MSEC-02 | `mediaMode` off/poster/reference selects posture; default reference | jsdom (gate behavior per mode) | `node --test tests/renderer-asset-gate.test.js` | ✅ scaffold (12-01) → fill (12-03) |

**Minimum regression-catching set per criterion (Nyquist):**
- ASST-01/02: 1 oracle run on `static-assets.html` + 1 relay byte-identity unit test
- ASST-03: 1 `currentSrcDiffers` table test + 1 oracle D26 fire + 1 jsdom pin/neutralize test
- ASST-04: 3 unit cases — `blob:`→placeholder, oversized-`data:`→placeholder, small-`data:`→byte-identical
- ASST-05: 1 string assertion (has `img-src`, has `default-src 'none'`, no `script-src`, no `media-src`)
- MSEC-01: a table test over the full denylist (allowed public-https + one of each blocked range/scheme + 172.16/12 boundary + throwing-hook-fails-closed) + 1 jsdom "blocked URL never written, placeholder present" test
- MSEC-02: 3 jsdom cases — `off` (no asset write), `reference` (asset written), `poster` (poster path)

---

## Per-Task Verification Map

> Each task maps to one or more Req-IDs above and an automated command from the test map.
> Status legend: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|--------|
| 12-01-T1 | 12-01 | 1 | ASST-01, ASST-02, ASST-05 | T-12-01, T-12-02 | Relay forwards raw bytes byte-verbatim (no image bytes); CSP confirm-only (img-src, default-src 'none', no script-src/media-src) | oracle/unit + string assertion | `node --test tests/relay-asset-bytes.test.js tests/renderer-snapshot.test.js` | ⬜ pending |
| 12-01-T2 | 12-01 | 1 | ASST-03, ASST-04, MSEC-01, MSEC-02 | T-12-06, T-12-09 | RED Wave-0 scaffolds enumerate the fail-closed/degrade/pin Nyquist cases | scaffold parse-check | `node -e "<parse all three scaffolds>"` | ⬜ pending |
| 12-02-T1 | 12-02 | 2 | ASST-04 | T-12-03 | blob:/oversized-data → dimensioned placeholder; small data: byte-identical; byte-cap constant | capture unit | `node --test tests/capture-asset-degrade.test.js` | ⬜ pending |
| 12-02-T2 | 12-02 | 2 | ASST-03 | T-12-04, T-12-05 | clone-only data-ps-currentsrc; live DOM unmutated; D26 mismatch fires (oracle green) | unit + oracle | `node --test tests/differential/oracle.test.js tests/capture-asset-degrade.test.js` | ⬜ pending |
| 12-03-T1 | 12-03 | 2 | MSEC-01 | T-12-06 | pure fail-closed classifyAssetOrigin: https-only + private-range deny + 172.16/12 boundary + parse-error | pure unit (table) | `node --test tests/renderer-asset-policy.test.js tests/security-chokepoint-purity.test.js` | ⬜ pending |
| 12-03-T2 | 12-03 | 2 | ASST-02, ASST-03, MSEC-01, MSEC-02 | T-12-06, T-12-07, T-12-08, T-12-09, T-12-10 | pre-write gate (string-layer snapshot + diff ADD/ATTR + subtree) → placeholder; mediaMode posture; currentSrc pin; sandbox/CSP unchanged | jsdom (gate) + purity scan | `node --test tests/renderer-asset-gate.test.js tests/renderer-snapshot.test.js tests/security-chokepoint-purity.test.js` | ⬜ pending |
| 12-03-T3 | 12-03 | 2 | MSEC-01, MSEC-02 | T-12-09 | SECURITY.md documents the viewer-fetch surface without breaking pinned markers | doc-marker scan | `node --test tests/security-chokepoint-purity.test.js` | ⬜ pending |

---

## Wave 0 Requirements

- [ ] `tests/renderer-asset-policy.test.js` — pure classifier table (MSEC-01) — **scaffold by 12-01-T2, fill by 12-03-T1**
- [ ] `tests/renderer-asset-gate.test.js` — jsdom srcdoc-glue: gate→placeholder, currentSrc pin, mediaMode behavior, CSP assertion (ASST-02/03/05, MSEC-01/02) — **scaffold by 12-01-T2, fill by 12-03-T2**
- [ ] `tests/capture-asset-degrade.test.js` — blob/oversized-data/small-data + currentSrc enrichment (ASST-03/04) — **scaffold by 12-01-T2, fill by 12-02-T1/T2**
- [ ] `tests/differential/fixtures/static-assets.html` — focused asset fixture — **12-01-T1**
- [ ] `tests/differential/scenarios/static-assets.js` — scenario injecting divergent `currentSrc` (jsdom `currentSrc===""`) — **12-02-T2**
- [ ] `tests/differential/divergence-ledger.js` — D26 (and possibly D27) `mismatch` entry; register fixture row + import in `oracle.test.js` — **12-02-T2**
- [ ] (extend) `tests/renderer-snapshot.test.js` — CSP `img-src`/no-`media-src`/no-`script-src` assertion — **12-01-T1**
- [ ] `tests/relay-asset-bytes.test.js` — relay byte-identity proof (SC#1) — **12-01-T1**
- [ ] Framework install: none — `node:test` + jsdom already present

> Note: the Wave-0 test FILES are created (RED scaffolds) in Plan 12-01 (Wave 1); they are
> filled to GREEN in Plans 12-02/12-03 (Wave 2). `wave_0_complete` flips true once 12-01 lands.

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

- [x] All tasks have automated verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 15s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** planner-approved 2026-06-20 (wave_0_complete flips true after Plan 12-01 lands)
