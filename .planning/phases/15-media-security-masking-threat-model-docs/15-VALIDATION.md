---
phase: 15
slug: media-security-masking-threat-model-docs
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-21
---

# Phase 15 — Validation Strategy

> Per-phase validation contract. Derived from 15-RESEARCH.md `## Validation Architecture`.
> Note: this is a COMPLETION phase — several "new" tests are pins on already-shipped behavior.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `node:test` + `node:assert/strict`; jsdom for capture/renderer |
| **Config file** | none — `package.json` `scripts.test` |
| **Quick run command** | `node --test tests/security-asset-url-mask.test.js tests/capture-media.test.js tests/renderer-media-csp.test.js tests/security-chokepoint-purity.test.js` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | quick sub-second; full suite seconds (baseline 665/665; oracle 48/48) |

---

## Sampling Rate

- **After every task commit:** the four touched/added files (quick run) — sub-second.
- **After every plan wave:** `npm test` (full suite incl. differential oracle) — confirms byte-identity (oracle 48/48) and ≥665 + new.
- **Before `/gsd:verify-work`:** full suite green; oracle count unchanged (masking off-by-default); `dependencies`/`peerDependencies` byte-unchanged (`package-publish.test.js`).
- **Max feedback latency:** quick sub-second; full suite seconds.

---

## Per-Task Verification Map

| Requirement | Behavior | Test Type | Automated Command | File | Status |
|-------------|----------|-----------|-------------------|------|--------|
| MSEC-03 | `maskAssetUrls` strips token/PII params; functional + no-token URLs survive byte-identical | unit (jsdom) | `node --test tests/security-asset-url-mask.test.js` | ❌ W0 new | ⬜ pending |
| MSEC-03 | `maskAssetUrlFn` string→replace; `null`→placeholder/block; **throw→fail-closed block** | unit (jsdom) | `node --test tests/security-asset-url-mask.test.js` | ❌ W0 | ⬜ pending |
| MSEC-03 | Invalid `maskMediaSelector` throws `invalid-mask-selector` at factory time | unit (jsdom) | `node --test tests/security-asset-url-mask.test.js` | ❌ W0 | ⬜ pending |
| MSEC-03 | `maskMediaSelector`/`blockSelector` `<video>` → placeholder AND emits NO `STREAM.MEDIA` (baseline + events) | unit (jsdom) | `node --test tests/capture-media.test.js` | ⚠️ extend (twin of WR-01 :518) | ⬜ pending |
| MSEC-03 | Masking OFF by default → wire byte-identical (oracle unchanged, no new ledger entry) | oracle | `node --test tests/differential/oracle.test.js` | ✅ keep 48/48 | ⬜ pending |
| MSEC-03 | Hostile `<source src="javascript:...">` neutralized at capture scheme-scrub | unit (jsdom) | `node --test tests/security-asset-url-mask.test.js` | ⚠️ shipped; add explicit media test | ⬜ pending |
| MSEC-04 | srcdoc carries `<meta name="referrer" content="no-referrer">` ordered immediately after `CSP_META` | unit (renderer string) | `node --test tests/renderer-media-csp.test.js` | ⚠️ extend | ⬜ pending |
| MSEC-04 | No `crossorigin` attribute anywhere in srcdoc (omit-credentials posture) | unit (renderer string) | `node --test tests/renderer-media-csp.test.js` | ⚠️ extend | ⬜ pending |
| MSEC-04 | `media-src ... blob:` retained; no `script-src`, no `connect-src`, `default-src 'none'`; `img-src` no-blob | unit (renderer string) | `node --test tests/renderer-media-csp.test.js` | ✅ present (cite/keep) | ⬜ pending |
| MSEC-04 | Late cross-session `STREAM.MEDIA` rejected by `isCurrentStream` (no driver call) | unit (renderer) | `node --test tests/renderer-media.test.js` | ✅ present :411 (cite) | ⬜ pending |
| MSEC-04 | `allow-scripts` absent from every `src/renderer/*.js` incl. `media-player.js` | static scan | `node --test tests/security-chokepoint-purity.test.js` | ✅ covers media-player.js | ⬜ pending |
| MSEC-04 | `docs/SECURITY.md` keeps all 12 existing markers + new object-URL/referrer/masking markers; `docs/ARCHITECTURE.md` limitation #6 updated | static scan | `node --test tests/security-chokepoint-purity.test.js` | ⚠️ extend marker list | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/security-asset-url-mask.test.js` — NEW: `maskAssetUrls` denylist strip (each provider family + generic), no-token URL byte-identity, `data:`/`blob:` passthrough, `maskAssetUrlFn` string/`null`/**throw→block**, factory-time `invalid-mask-selector`, hostile `<source src=javascript:>` neutralization. Use the jsdom + recording-transport + settle harness (AUDITED_GLOBALS recipe from `security-mask.test.js`/`capture-media.test.js`).
- [ ] `tests/capture-media.test.js` — EXTEND: `maskMediaSelector` (and `blockSelector`) → 0 `STREAM.MEDIA` + no `media[]` baseline entry (mirror WR-01 skipElement test :489/:518, swapping the predicate).
- [ ] `tests/renderer-media-csp.test.js` — EXTEND: `no-referrer` meta present + ordered before the first subresource link + no `crossorigin` attr. (CSP shape assertions already present — keep.)
- [ ] `tests/security-chokepoint-purity.test.js` — EXTEND: add the new `docs/SECURITY.md` markers to `requiredMarkers`. Do NOT change the `rendererModules()` glob (already includes `media-player.js`).
- [ ] Framework install: none — `node:test` + jsdom already present.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Real-browser `no-referrer` suppression (no Referer header on viewer-side asset/media GETs) | MSEC-04 | jsdom does not issue real subresource requests / headers | Real Chrome: load the mirror with a CDN asset; confirm the asset GET carries no `Referer` header (devtools network) |
| Real CSP enforcement (`default-src 'none'`, `media-src blob:`, no `script-src`) on live content | MSEC-04 | jsdom does not enforce CSP | Real Chrome: confirm scripts blocked, media/blob plays, no connect-src needed |

*String-layer contracts (meta present/ordered, no crossorigin, CSP shape) are unit-asserted; live header/enforcement is a documented deferred UAT (same jsdom/hidden-tab limit as Phases 13–14).*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (1 new file + 3 extensions)
- [ ] No watch-mode flags
- [ ] Differential oracle stays 48/48 (masking off-by-default → byte-identical); no new ledger entry
- [ ] `dependencies`/`peerDependencies` byte-unchanged (no new deps)
- [ ] `nyquist_compliant: true` set in frontmatter (after planner maps tasks)

**Approval:** pending
