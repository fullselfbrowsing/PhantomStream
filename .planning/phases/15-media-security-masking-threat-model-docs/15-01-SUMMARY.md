---
phase: 15-media-security-masking-threat-model-docs
plan: 01
subsystem: testing
tags: [capture, masking, url-redaction, sanitizeForWire, media-tracker, sigv4, sas, privacy, security]

# Dependency graph
requires:
  - phase: 03-security-masking
    provides: "compileMaskSelector factory-time throw, blockSelector/maskTextSelector predicate shape, safeMaskText fail-closed wrapper, replaceWithBlockPlaceholder, sanitizeForWire chokepoint + sanitizeCounters"
  - phase: 12-static-assets-by-reference
    provides: "URL_ATTRS scheme-scrub + hasDangerousScheme in sanitizeForWire('element'), absolutifyUrl, asset-unavailable placeholder, the flagged 'asset-url'/'media-url' dispatch seam"
  - phase: 13-video-audio-url-playback-sync
    provides: "collectTrackedMediaElements + attachMediaListeners media-tracker skip guards (the STREAM.MEDIA emission gate), media[] snapshot baseline"
provides:
  - "Three host masking options: maskMediaSelector (factory-validated), maskAssetUrls (boolean token/PII strip), maskAssetUrlFn (custom redactor, fail-closed to block)"
  - "Pure maskAssetUrlForWire(url, ctx) helper + documented TOKEN_PARAM_DENYLIST/TOKEN_PARAM_PREFIXES/isTokenParamName/stripTokenParams (no DOM access)"
  - "New 'asset-url'/'media-url' sanitizeForWire dispatch (the single URL-masking seam) + maskedAssetUrls counter; URL-attr routing in the 'element' and mutation 'attr' paths after the scheme scrub"
  - "maskMediaWithAncestors/maskMediaMatches predicates ORed into BOTH media-tracker skip guards + the serializeDOM/'subtree' block-placeholder path -> a masked <video>/<audio> emits no STREAM.MEDIA and degrades to the dimension-only placeholder"
affects: [15-02-referrerpolicy, 15-03-media-security-tests, 15-04-security-docs, threat-model]

# Tech tracking
tech-stack:
  added: []  # zero new dependencies — pure JS over platform URL/URLSearchParams; jsdom already a devDependency
  patterns:
    - "Off-by-default capture-side masking preserves wire byte-identity (the differential oracle stays 48/48 with no new ledger entry)"
    - "Pure URL-masking helper wrapped by a single sanitizeForWire dispatch kind (one testable place; not scattered into the 'attr' overload)"
    - "Fail-closed-to-BLOCK runtime redactor (mirrors safeMaskText try/catch but the catch returns null, never the asterisk default — a half-redacted URL the viewer fetches is worse than none)"
    - "Reuse the shipped blockSelector placeholder path + media-tracker skip predicates for a new selector (maskMediaSelector) — a one-line OR at each chokepoint, not a new mechanism"

key-files:
  created:
    - "tests/security-asset-url-mask.test.js — 20-test capture jsdom suite: denylist strip per provider family + generic, no-token/data:/blob: byte-identity, off-by-default whole-wire byte-identity gate, maskAssetUrlFn string/null/throw->block, ctx.kind image|media, factory-time invalid-mask-selector, hostile <source src=javascript:> neutralization"
  modified:
    - "src/capture/index.js — 3 config options (JSDoc'd for .d.ts), TOKEN_PARAM_DENYLIST + helpers, pure maskAssetUrlForWire, 'asset-url'/'media-url' dispatch + URL-attr routing, maskMediaMatches/maskMediaWithAncestors wired into both media-tracker guards + the placeholder swap path, maskedAssetUrls counter"
    - "tests/capture-media.test.js — extended with maskMediaSelector + blockSelector media-suppression cases (twins of the WR-01 skipElement tests): 0 STREAM.MEDIA + 0 media[] baseline entry + dimension-only placeholder; control <video> unaffected"

key-decisions:
  - "maskMediaSelector reuses the plain blockSelector placeholder (A3: identity-only, no distinct 'masked' reason attr) — 'masked' and 'blocked' are visually identical dimensioned gaps and a masked element legitimately carries no identity-leaking attribute"
  - "'asset-url' and 'media-url' are ONE dispatch branch; the asset-vs-media distinction travels in ctx.kind ('image'|'media') derived from the tag (video/audio/source -> media), keeping both literals reachable"
  - "maskAssetUrlForWire reads closure config (maskAssetUrlFn/maskAssetUrls/logger) but never touches the DOM/clone — pure per the acceptance grep; the caller owns the clone mutation / placeholder swap / attribute removal"
  - "URL-attr routing is gated on (maskAssetUrls || maskAssetUrlFn) so the off-by-default path does zero per-attr work and stays wire-identical"

patterns-established:
  - "Byte-identity tests compare masked-ON vs masked-OFF of the SAME fixture (the serializer's absolutifyUrl normalizes host/port upstream identically on both paths) rather than against a hand-written literal"
  - "stripTokenParams returns the ORIGINAL url string when nothing is deleted (Pitfall 1: never new URL().toString(), which would normalize and diverge the wire)"

requirements-completed: [MSEC-03]

# Metrics
duration: 33min
completed: 2026-06-21
---

# Phase 15 Plan 01: Capture Asset/Media URL Masking Spine Summary

**The capture-side MSEC-03 masking vocabulary: `maskMediaSelector`/`maskAssetUrls`/`maskAssetUrlFn` routed through a single new `'asset-url'`/`'media-url'` `sanitizeForWire` dispatch backed by one pure `maskAssetUrlForWire` helper + a documented token/PII denylist — a masked `<video>` emits no `STREAM.MEDIA` and degrades to the dimension-only placeholder, and off-by-default keeps the wire byte-identical (oracle 48/48, no new ledger entry).**

## Performance

- **Duration:** ~33 min
- **Started:** 2026-06-21T18:48:51Z (Phase 15 execution start)
- **Completed:** 2026-06-21
- **Tasks:** 3 (Tasks 1 and 2 TDD: RED -> GREEN)
- **Files modified:** 3 (1 created, 2 modified)

## Accomplishments
- **Pure `maskAssetUrlForWire(url, ctx)` helper** + `TOKEN_PARAM_DENYLIST`/`TOKEN_PARAM_PREFIXES`/`isTokenParamName`/`stripTokenParams`: redactor-first (string replaces, `null` blocks, **THROW -> fail-closed block**, never the raw URL), then the boolean token/PII strip (AWS SigV4/SigV2, GCP signed-URL, Azure SAS, generic set — case-insensitive, exact-name OR denied-prefix), else the URL unchanged. Functional params (`w`/`h`/`q`/`format`/`v`/`id`/`t`) survive; a no-token URL returns the **original string** (Pitfall 1 — no `URL.toString()` normalization). No DOM access (pure).
- **Single `'asset-url'`/`'media-url'` `sanitizeForWire` dispatch** wrapping the helper (one branch, `ctx.kind` image|media) + a `maskedAssetUrls` counter; the `'element'` snapshot path and the mutation `'attr'` path route surviving URL-attr values through it **after** the `hasDangerousScheme` scrub (a hostile scheme never reaches the masking).
- **`maskMediaSelector` wired into the shipped media-tracker skip guards** (both `collectTrackedMediaElements` and `attachMediaListeners`) and the `blockSelector` placeholder path (serializeDOM pairs-walk + the `'subtree'` per-descendant path), so a masked `<video>`/`<audio>` emits **no** `media[]` baseline entry, **no** `STREAM.MEDIA` events, and degrades to the dimension-only block placeholder (URL never on the wire).
- **Off-by-default byte-identity gate**: with no masking config the entire snapshot html is byte-identical and token params survive verbatim; the differential oracle stays **48/48** with **no new divergence-ledger entry**; full suite **689/689**; `dependencies`/`peerDependencies` byte-unchanged.

## Task Commits

Each task was committed atomically (TDD tasks have a RED test commit then a GREEN implementation commit):

1. **Task 1 (RED): failing asset/media URL masking suite** - `819ed6a` (test)
2. **Task 1 (GREEN): masking vocabulary + pure helper + dispatch** - `781c5e1` (feat)
3. **Task 2 (RED): failing maskMediaSelector media-suppression cases** - `1032897` (test)
4. **Task 2 (GREEN): maskMediaSelector -> placeholder + no STREAM.MEDIA** - `70a7046` (feat)
5. **Task 3: off-by-default byte-identity gate (oracle 48/48, no ledger entry)** - `7c3d5a3` (test)

**Plan metadata:** committed separately with this SUMMARY.

## Files Created/Modified
- `tests/security-asset-url-mask.test.js` (created) — 20 capture jsdom tests covering every `<behavior>` bullet: per-provider-family + generic strip, functional-param survival, no-token + `data:`/`blob:` + off-by-default byte-identity, `maskAssetUrlFn` string/null/throw->block + ctx shape, factory-time `invalid-mask-selector`, hostile `<source src="javascript:...">` neutralization.
- `src/capture/index.js` (modified) — config options + JSDoc, `TOKEN_PARAM_DENYLIST` + predicate/strip helpers, pure `maskAssetUrlForWire`, `'asset-url'`/`'media-url'` dispatch + `assetUrlKindForTag`, URL-attr routing in `'element'` + mutation `'attr'`, `maskMediaMatches`/`maskMediaWithAncestors` ORed into both media-tracker guards + the serializeDOM/`'subtree'` placeholder path, `maskedAssetUrls` counter (declaration + reset + snapshot).
- `tests/capture-media.test.js` (modified) — 4 added tests (twins of WR-01): `maskMediaSelector`/`blockSelector` -> 0 `STREAM.MEDIA` + 0 `media[]` entry + dimension-only placeholder; control `<video>` still emits.

## Decisions Made
- **`maskMediaSelector` reuses the plain block placeholder** (no distinct `masked` reason attr) — A3 from RESEARCH; "masked" and "blocked" are visually identical dimensioned gaps, and the identity-only placeholder leaks nothing.
- **One dispatch branch for both `'asset-url'`/`'media-url'`** with `ctx.kind` carrying the asset-vs-media distinction (both literals reachable for any future per-literal purity markers).
- **`maskAssetUrlForWire` stays pure** (closure-config reads only, no DOM) so it is unit-testable in isolation and the caller owns all clone mutation.
- **Byte-identity tested as masked-ON === masked-OFF of the same fixture** rather than against a hand-written literal — see Deviations.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] No-token byte-identity test asserted against the wrong baseline**
- **Found during:** Task 1 (GREEN run)
- **Issue:** The initial `maskAssetUrls` no-token byte-identity test compared the masked-on `src` against the raw pre-absolutification URL literal (`https://CDN.Example.COM:443/...`). The serializer's existing `absolutifyUrl` normalizes the host case and drops the default port **upstream of `sanitizeForWire`** (pre-existing, unrelated to masking), so the literal could never match — a false-failing test, not a masking bug. Confirmed masked-ON output (`https://cdn.example.com/path/Image.JPG?...`) is **identical** to masked-OFF output.
- **Fix:** Rewrote the assertion to compare masked-ON vs masked-OFF serializations of the **same** fixture (the true byte-identity property the differential oracle enforces) plus a functional-param-survival check. The fixture retains normalization-bait so any masking-introduced re-encoding would still surface as a divergence.
- **Files modified:** tests/security-asset-url-mask.test.js
- **Verification:** Test passes; `maskAssetUrlForWire` proven to return the original string when nothing is stripped (Pitfall 1); differential oracle stays 48/48.
- **Committed in:** `781c5e1` (Task 1 GREEN commit)

---

**Total deviations:** 1 auto-fixed (1 test-correctness bug)
**Impact on plan:** The fix tightened the byte-identity assertion to the property that actually matters (masking adds zero divergence vs. the unmasked wire). No scope creep; no production-code change resulted from it.

## Issues Encountered
None beyond the deviation above. The `absolutifyUrl`-runs-before-`sanitizeForWire` ordering meant the byte-identity guarantee is correctly scoped as "masking does not further change a no-token URL beyond what serialization already does" — which is exactly what the differential oracle gate verifies.

## Threat Model Coverage (this plan's slice)
- **T-15-01 (signed-CDN token/PII on the wire):** mitigated — `maskAssetUrls` strips the documented `TOKEN_PARAM_DENYLIST` (tested per-family + generic); `maskAssetUrlFn` gives full host control.
- **T-15-02 (sensitive media URL + timeline):** mitigated — `maskMediaSelector` -> dimension-only placeholder + no `STREAM.MEDIA` via both shipped media-tracker skip guards.
- **T-15-03 (hostile `<source src="javascript:...">`):** mitigated — existing `hasDangerousScheme` scrub fires before masking; explicit media test pins it (also proven the masking fn never sees the hostile scheme).
- **T-15-04 (throwing `maskAssetUrlFn`):** mitigated — try/catch-contained, logged, returns `null` -> BLOCK; capture never wedges and the raw URL never reaches the wire (tested).
- **T-15-06 (off-by-default normalization regression):** mitigated — `maskAssetUrlForWire` returns the original string when nothing is stripped; Task 3 gates the oracle at 48/48 with no new ledger entry.
- **T-15-SC (supply chain):** mitigated — zero packages installed; `dependencies`/`peerDependencies` byte-unchanged (package-publish deps-shape guard green).

No new threat surface introduced beyond the plan's `<threat_model>`.

## Next Phase Readiness
- The capture masking spine is complete; **Plan 15-02** (renderer `<meta name="referrer" content="no-referrer">` + no-credentials confirmation) and **Plan 15-03** (media security tests) build on the now-shipped `'asset-url'`/`'media-url'` dispatch and the masked-media guarantee.
- **Plan 15-04** (docs) must document the exact `TOKEN_PARAM_DENYLIST` in `docs/SECURITY.md` §4 (the param table from 15-RESEARCH) and reference the new `maskedAssetUrls` counter alongside the existing strip counters.
- No blockers. The Phase-15 STATE blocker ("conservative default origin policy needs a concrete denylist") remains already-resolved in `src/renderer/asset-policy.js` (reused, not re-derived) and is unaffected by this plan.

## Self-Check: PASSED

- Created files verified present: `tests/security-asset-url-mask.test.js`, `.planning/phases/15-media-security-masking-threat-model-docs/15-01-SUMMARY.md`.
- All task commits verified in git history: `819ed6a` (Task 1 RED), `781c5e1` (Task 1 GREEN), `1032897` (Task 2 RED), `70a7046` (Task 2 GREEN), `7c3d5a3` (Task 3).
- Verification gates green: `tests/security-asset-url-mask.test.js` 20/20, `tests/capture-media.test.js` (incl. 4 new) green, differential oracle 48/48 unchanged, `tests/differential/divergence-ledger.js` byte-unchanged, full suite 689/689, `dependencies`/`peerDependencies` byte-unchanged.

---
*Phase: 15-media-security-masking-threat-model-docs*
*Completed: 2026-06-21*
