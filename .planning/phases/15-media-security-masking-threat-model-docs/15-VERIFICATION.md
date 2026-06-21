---
phase: 15-media-security-masking-threat-model-docs
verified: 2026-06-21T00:00:00Z
status: human_needed
score: 13/13 must-haves verified
overrides_applied: 0
mode: mvp
re_verification:
human_verification:
  - test: "Real-browser no-referrer header suppression on viewer-side asset/media GETs"
    expected: "Loading the mirror with a cross-origin CDN asset issues subresource GETs that carry NO Referer header (Chrome devtools Network tab)"
    why_human: "jsdom does not parse the srcdoc or issue real subresource requests/headers — only the string-layer contract (meta present, ordered after CSP, no crossorigin) is unit-assertable. Same documented deferred UAT as Phases 13-14 (15-VALIDATION Manual-Only)."
  - test: "Real CSP enforcement on live mirrored content"
    expected: "In real Chrome: scripts in the mirror iframe are blocked (no script-src), media/blob: plays (media-src blob:), no connect-src needed; default-src 'none' enforced"
    why_human: "jsdom does not enforce CSP. The CSP string shape is unit-pinned (default-src 'none', media-src blob:, img-src no-blob, no script-src/connect-src) but live enforcement requires a real browser. Same documented deferred UAT as Phases 13-14 (15-VALIDATION Manual-Only)."
---

# Phase 15: Media Security, Masking, Threat Model & Docs — Verification Report

**Phase Goal:** Close the v2.0 milestone by completing the security contract threaded through Phases 12–14 — asset/media URL masking (`maskMediaSelector`/`maskAssetUrls`/`maskAssetUrlFn`) via the capture `sanitizeForWire` chokepoint; `referrerpolicy="no-referrer"` + no-credentials; a threat-review of the parent-realm object-URL blast radius; media security tests; and `docs/SECURITY.md`/`docs/ARCHITECTURE.md` updates (limitation #6). Completes/threat-models/tests/documents earlier decisions — begins no features.
**Verified:** 2026-06-21
**Status:** human_needed
**Re-verification:** No — initial verification
**Mode:** mvp (phase flag `mode: mvp`)

## Goal Achievement

This is a **completion phase** (CONTEXT.md: "it does not begin new features"). The ROADMAP goal is outcome-shaped milestone-closure prose (not a single-flow User Story — `user-story.validate` → false), but the ROADMAP defines **4 explicit Success Criteria** (the non-negotiable roadmap contract, Step 2a) and the 4 PLANs each carry a valid derived User Story (`user-story.validate` → true) grounded in the locked CONTEXT decisions + REQUIREMENTS. Verification proceeds against the ROADMAP Success Criteria merged with PLAN must_haves (the goal-format mismatch is noted as INFO below, not a blocker — the success condition is fully expressed by the SCs and is observably true in code/docs).

### Observable Truths

| #  | Truth (ROADMAP SC + merged PLAN must_haves) | Status | Evidence |
| -- | ------------------------------------------- | ------ | -------- |
| 1  | 3 masking options exist on the capture config (`maskMediaSelector`/`maskAssetUrls`/`maskAssetUrlFn`) | ✓ VERIFIED | `src/capture/index.js:607-609` (init), JSDoc `:511-535`; `tsc` regenerates `dist/types/capture/index.d.ts:301,312,322` with all three typed props (tsc exit 0) |
| 2  | Pure `maskAssetUrlForWire` returns the ORIGINAL url string on the no-strip path (byte-identity → oracle 48/48, no new ledger entry) | ✓ VERIFIED | `index.js:3116` default-OFF `return url`; `stripTokenParams:3081` `changed ? u.toString() : url`; `:3066` data:/blob:/relative returns `url`. Helper PURE (grep: no DOM access in body `:3098-3117`). Direct-executed: no-token/data:/blob: → `===` input (byte-identical) |
| 3  | `maskAssetUrlFn` is fail-closed (null→block, throw→block; never raw URL, never raised) | ✓ VERIFIED | `index.js:3104` null→null; `:3106-3109` throw→logged→null. Test asserts `!img.hasAttribute('src')` + `payload.html.indexOf('X-Amz-Signature')===-1` for both null and throw (`security-asset-url-mask.test.js`) |
| 4  | A `maskMediaSelector`/`blockSelector`-matched `<video>` emits NO STREAM.MEDIA and NO media[] baseline; degrades to placeholder | ✓ VERIFIED | `maskMediaWithAncestors` ORed into BOTH guards: `collectTrackedMediaElements:4978` + `attachMediaListeners:5069`. Tests assert `media.length===1` (masked excluded) + 0 STREAM.MEDIA on masked, control +1 (`capture-media.test.js:556,579,611,643`) |
| 5  | Hostile `<source src="javascript:...">` neutralized at the capture scheme-scrub BEFORE masking | ✓ VERIFIED | `index.js:3271-3277` `hasDangerousScheme` scrub precedes the `:3286-3303` mask routing; explicit media tests green (`security-asset-url-mask.test.js`) |
| 6  | Invalid `maskMediaSelector` throws `Error('invalid-mask-selector')` at factory time (one allowed throw site) | ✓ VERIFIED | `compileMaskSelector(cfg.maskMediaSelector)` at `:607`. Direct-executed: invalid `((((` → throws `invalid-mask-selector` at `createCapture` |
| 7  | srcdoc carries exactly one `<meta name="referrer" content="no-referrer">` immediately after CSP_META, before charset/links/img (both return sites) | ✓ VERIFIED | `snapshot.js:683-684` + `:704-705` (buildSnapshotHtml + buildFramePlaceholderHtml). Test asserts present + countMatches===1 + cspIdx<refIdx<charsetIdx (`renderer-media-csp.test.js:87-114`) |
| 8  | No `crossorigin` attribute anywhere in the srcdoc (omit-credentials posture) | ✓ VERIFIED | No crossorigin emitted; test asserts `indexOf('crossorigin')===-1`; 3 crossorigin mentions in snapshot.js are comment-only |
| 9  | CSP shape unchanged: `default-src 'none'`, `media-src ... blob:`, `img-src` no-blob, no `script-src`, no `connect-src` | ✓ VERIFIED | `snapshot.js:551-557` CSP_META byte-unchanged; test asserts each directive (`renderer-media-csp.test.js:59-76`) |
| 10 | Sandbox token stays exactly `allow-same-origin`; allow-scripts static scan covers `media-player.js` | ✓ VERIFIED | `index.js:540` setAttribute + `:542-543` runtime guard `viewer-sandbox-invalid`. `rendererModules()` globs all `src/renderer/*.js` incl. media-player.js (17KB, only allow-scripts at `:9` in a comment). Named test green (`security-media.test.js`) |
| 11 | `dependencies` byte-unchanged `{ ws: '8.21.0' }`; hls.js stays optional peerDependency | ✓ VERIFIED | `package.json:112-114` deps `{ ws: 8.21.0 }`; `:104-110` peerDeps hls.js `>=1.5.0` + meta.optional true; absent from devDependencies. `package-publish.test.js` green |
| 12 | `docs/SECURITY.md` carries masking vocabulary + denylist table + referrer + Parent-Realm Object-URL threat model + ALL purity markers; line-214 ref past-tense | ✓ VERIFIED | §4 masking (`SECURITY.md:126-214`), denylist table (`:181-187`), §6 referrer/no-credentials completed (`:311-333`), Object-URL threat model 5 rows + worst case (`:335-365`), line-306-309 past-tense. Purity test 8/8 (12 original + 6 new markers, glob unchanged) |
| 13 | `docs/ARCHITECTURE.md` limitation #6 rewritten: media by reference (state+progressive+adaptive); residual DRM/EME, MSE-without-manifest, raw pixels | ✓ VERIFIED | `ARCHITECTURE.md:269-282` — "mirrored by reference", residual narrowed to 3 cases, closed shadow roots + cross-origin iframes kept |

**Score:** 13/13 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
| -------- | -------- | ------ | ------- |
| `src/capture/index.js` | 3 config options, pure `maskAssetUrlForWire` + TOKEN_PARAM_DENYLIST, `asset-url`/`media-url` dispatch, `maskMediaWithAncestors` in both media guards | ✓ VERIFIED | All present + wired (`:607-609,:2979-3117,:3286-3303,:3454-3466,:4978,:5069`); helper pure; `.d.ts` regenerates clean |
| `src/renderer/snapshot.js` | one `<meta name="referrer">` after CSP_META at both return sites; CSP_META unchanged | ✓ VERIFIED | `:683-684,:704-705`; CSP_META `:551-557` byte-unchanged |
| `tests/security-asset-url-mask.test.js` | NEW capture suite (denylist strip, byte-identity, fn string/null/throw, invalid-selector, hostile javascript:) | ✓ VERIFIED | Present, all behavior bullets covered, green (substantive assertions, not vacuous) |
| `tests/capture-media.test.js` | EXTEND: maskMediaSelector/blockSelector → 0 STREAM.MEDIA + 0 media[] | ✓ VERIFIED | 4 added MSEC-03 tests `:556,579,611,643`, green |
| `tests/renderer-media-csp.test.js` | EXTEND: referrer present/ordered/exactly-one/no-crossorigin (CSP kept) | ✓ VERIFIED | 6 MSEC-04 pins `:87-114`, green |
| `tests/security-media.test.js` | NEW media-security traceability (allow-scripts media-path, deps gate, late-cross-session, object-URL revoke) | ✓ VERIFIED | 4 named tests green |
| `tests/security-chokepoint-purity.test.js` | requiredMarkers: 12 existing verbatim + 6 new; glob unchanged | ✓ VERIFIED | `:223-250` (12 + 6), glob `rendererModules():42-45` untouched, dispatch markers `:76` unchanged |
| `docs/SECURITY.md` | §4 vocab+denylist, §6 referrer/no-cred completed, Object-URL threat model | ✓ VERIFIED | All sections present + accurate (WR-01..04 corrections applied) |
| `docs/ARCHITECTURE.md` | limitation #6 rewrite | ✓ VERIFIED | `:269-282` rewritten |

### Key Link Verification

| From | To | Via | Status | Details |
| ---- | -- | --- | ------ | ------- |
| `sanitizeForWire('asset-url'/'media-url')` | `maskAssetUrlForWire(url, ctx)` | dispatch branch wrapping the pure helper | ✓ WIRED | `index.js:3524-3537` dispatch; consumed by element path `:3293` + mutation attr path `:3459` |
| `maskMediaWithAncestors(el)` | collectTrackedMediaElements + attachMediaListeners skip guards | ORed into both emit gates | ✓ WIRED | `:4978` (media[] baseline gate) + `:5069` (STREAM.MEDIA event gate) |
| `maskAssetUrlForWire` (strip path) | `URLSearchParams.delete` on TOKEN_PARAM_DENYLIST | new URL try/catch; original string when nothing stripped | ✓ WIRED | `stripTokenParams:3063-3082`; byte-identity confirmed by direct execution |
| element URL_ATTRS routing | `maskAssetUrlForWire` AFTER hasDangerousScheme scrub | per-attr loop gated on masking config | ✓ WIRED | scrub `:3271-3277` → mask `:3286-3303`; null→removeAttribute |
| purity requiredMarkers | docs/SECURITY.md substrings | 12 verbatim + 6 new in same change | ✓ WIRED | All 18 markers assert true (purity test 8/8) |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
| -------- | ------------- | ------ | ------------------ | ------ |
| `maskAssetUrlForWire` wire value | masked URL string | closure config (maskAssetUrlFn/maskAssetUrls) → stripTokenParams over platform URL | ✓ FLOWING | Direct-executed: strip removes sig keeps w; null/throw → block (attr removed); no-token → byte-identical original |
| masked `<video>` media[] | snapshot media baseline | collectTrackedMediaElements gated by maskMediaWithAncestors | ✓ FLOWING (gated) | Masked element produces NO entry (media.length===1 for control-only); control emits real currentTime=4 |
| referrer meta | static srcdoc string literal | snapshot.js head assembly (no dynamic data) | n/a (static) | Document-level policy literal — not dynamic-data-bearing |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| -------- | ------- | ------ | ------ |
| capture module exports createCapture | `node -e import capture` | `createCapture exported: true` | ✓ PASS |
| invalid maskMediaSelector throws at factory time | `createCapture({maskMediaSelector:'(((('})` | throws `invalid-mask-selector` | ✓ PASS |
| stripTokenParams byte-identity (no-token/data:/blob:) | direct-exec replicated logic | `===` input (byte-identical) on all 3 | ✓ PASS |
| WR-04 fragment-token strip | direct-exec `?w=10#access_token=LEAK` | OUT `…?w=10` (token fragment dropped) | ✓ PASS |
| tsc regenerates .d.ts with new options | `npm run types` | exit 0; 3 typed props in capture/index.d.ts | ✓ PASS |

### Probe Execution

No `scripts/*/tests/probe-*.sh` probes declared or conventional for this phase. The phase declares automated `<automated>` verify commands (run below). Not applicable.

| Probe | Command | Result | Status |
| ----- | ------- | ------ | ------ |
| (full suite — phase regression gate) | `npm test` | 704 pass / 0 fail | ✓ PASS |
| (doc-marker purity) | `node --test tests/security-chokepoint-purity.test.js` | 8/8 | ✓ PASS |
| (differential oracle) | `node --test tests/differential/oracle.test.js` | 48/48; ledger byte-unchanged (no phase-15 commit touched it) | ✓ PASS |
| (deps shape) | `node --test tests/package-publish.test.js` | green | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
| ----------- | ----------- | ----------- | ------ | -------- |
| MSEC-03 | 15-01 | Asset/media URL masking vocabulary redacts/blocks asset+media URLs; maskMediaSelector/blockSelector omit private media; masked degrades to placeholder | ✓ SATISFIED | Truths 1-6, 4; capture masking spine + media-tracker wiring + tests all green |
| MSEC-04 | 15-02, 15-03, 15-04 | Viewer-fetch leakage minimized (referrerpolicy=no-referrer, no credentials); secrets-on-wire documented; sandbox token unchanged; allow-scripts scan covers media | ✓ SATISFIED (automated); live referrer/CSP = deferred UAT | Truths 7-13; renderer meta + threat model + docs + media-security suite green |

**Orphan check:** REQUIREMENTS.md maps exactly MSEC-03 and MSEC-04 to Phase 15 (lines 121-122); both are claimed by plans. No orphaned requirement. Every plan-declared ID is in REQUIREMENTS.md.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| ---- | ---- | ------- | -------- | ------ |
| (none) | — | No TBD/FIXME/XXX in any phase-15 modified source/test/doc file | — | Clean — completion auditable |
| `src/capture/index.js`, `src/renderer/snapshot.js` | various | "placeholder" vocabulary (createBlockPlaceholder, asset-unavailable, truncated, frame placeholder) | ℹ️ Info | Legitimate shipped domain features (real functions with bodies), NOT stub markers — confirmed substantive |

### Code-Review Fix Confirmation (WR-01..04, IN-02)

The pre-fix `15-REVIEW.md` (status: issues_found, 4 WARNINGs + 4 INFO) was followed by 5 fix commits (`01384a5`..`b466514`). Confirmed REAL in code/docs (not just commit messages):

| Fix | Confirmation |
| --- | ------------ |
| WR-01 (false data-fsb-nid placeholder claim) | `createBlockPlaceholder:2538-2543` writes only rr_width/rr_height (no nid); `SECURITY.md:112-114,150-151` corrected to "no `data-fsb-nid`… identity in nodeIds sidecar" |
| WR-02 (byte-for-byte overstated on strip path) | `SECURITY.md:159-166` now states re-encode on strip path; byte-identity scoped to no-strip path only |
| WR-03 (semicolon/matrix param residual) | `SECURITY.md:195-205` documents the `;`-separator residual + maskAssetUrlFn escape hatch |
| WR-04 (fragment token not stripped) | `fragmentHasTokenParam:3031-3041` + `dropFragment` wiring `:3067,3080` — direct-executed: `#access_token=LEAK` dropped. Documented `SECURITY.md:206-211` |
| IN-02 (srcset coverage doc-vs-code mismatch) | Resolved via doc correction: `SECURITY.md:138-146` states srcset is scheme-scrubbed but NOT token-masked by the boolean (srcset not routed through maskAssetUrlForWire — confirmed) |

### Human Verification Required

Two live-browser security UAT items remain — KNOWN DEFERRABLE per the phase contract (15-VALIDATION Manual-Only; same jsdom/hidden-tab limit as Phases 13–14). All automated must-haves pass, so these are routed to human UAT, NOT counted as gaps.

#### 1. Real-browser no-referrer header suppression

**Test:** Load the mirror with a cross-origin CDN asset; inspect the subresource GETs in Chrome devtools Network tab.
**Expected:** The asset/media GETs carry NO `Referer` header (the document-level `<meta name="referrer" content="no-referrer">` suppresses it).
**Why human:** jsdom does not parse the srcdoc or issue real subresource requests/headers — only the string-layer contract (meta present, ordered after CSP, no crossorigin) is unit-assertable.

#### 2. Real CSP enforcement on live mirrored content

**Test:** In real Chrome, load mirrored content containing a script and a blob:/media source.
**Expected:** Scripts are blocked (no script-src), media/blob: plays (media-src blob:), no connect-src needed; default-src 'none' enforced.
**Why human:** jsdom does not enforce CSP. The CSP string shape is unit-pinned; live enforcement requires a real browser.

### Gaps Summary

No gaps. All 13 observable truths (4 ROADMAP Success Criteria + merged PLAN must_haves) are VERIFIED against the actual codebase and docs:

- The capture masking spine (3 config options + pure `maskAssetUrlForWire` + TOKEN_PARAM_DENYLIST + `asset-url`/`media-url` dispatch) exists, is wired into both the element and mutation-attr serialization paths, is byte-identical off-by-default (oracle 48/48, ledger untouched — confirmed by direct execution AND by no phase-15 commit touching the ledger), and is fail-closed (null/throw → block).
- A `maskMediaSelector`/`blockSelector`-matched `<video>` emits no STREAM.MEDIA and no media[] baseline (`maskMediaWithAncestors` ORed into both media-tracker guards).
- The renderer srcdoc carries exactly one `<meta name="referrer" content="no-referrer">` after CSP_META at both return sites, no crossorigin, CSP shape unchanged; the sandbox token stays exactly `allow-same-origin` with a runtime `viewer-sandbox-invalid` guard.
- `dependencies` is byte-unchanged `{ ws: '8.21.0' }`; hls.js remains an optional peerDependency.
- `docs/SECURITY.md` documents the masking vocabulary + the full denylist table + the referrer/no-credentials completion + the 5-row Parent-Realm Object-URL threat model, and preserves all 12 purity markers + adds 6 new ones in the same change; `docs/ARCHITECTURE.md` limitation #6 reflects media-by-reference.
- All 5 code-review fixes (WR-01..04 + IN-02) are real in code/docs, independently confirmed.

Full suite green (704 pass / 0 fail), doc-marker purity 8/8, oracle 48/48, deps gate green. The only outstanding work is the documented live-browser security UAT (referrer header + CSP enforcement), which is not exercisable in jsdom and is routed to human verification — consistent with Phases 13–14.

### INFO (non-blocking observations)

- **Goal format vs MVP mode:** The phase carries `mode: mvp` but the ROADMAP goal is outcome-shaped milestone-closure prose, not a single-flow User Story (`user-story.validate` → false). This is appropriate for a completion/threat-model/test/docs phase that "begins no features." The 4 ROADMAP Success Criteria (the non-negotiable contract) and the 4 PLAN-level derived User Stories (each `valid`) fully express the success condition, which is observably true. Recorded as INFO, not a blocker — refusing to verify would have been wrong given the SCs are present and verifiable. If a future pass wants a User-Story goal at the ROADMAP level, `/gsd mvp-phase 15` could set one, but it is not required for goal achievement here.
- **Documented residuals (intentional scope boundaries, NOT gaps):** the boolean `maskAssetUrls` is name-keyed and single-URL-attribute scoped — `srcset` candidate tokens (IN-02), `;`-separated/matrix params (WR-03), and non-denylisted fragment tokens (WR-04 partial) survive the boolean strip. All are explicitly documented in `SECURITY.md:138-214` with `maskAssetUrlFn`/`maskMediaSelector` as the full-control escape hatch. SC1 is satisfied by the vocabulary as a whole.

---

_Verified: 2026-06-21_
_Verifier: Claude (gsd-verifier)_
