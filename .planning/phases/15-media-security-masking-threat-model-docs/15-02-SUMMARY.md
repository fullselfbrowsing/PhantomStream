---
phase: 15-media-security-masking-threat-model-docs
plan: 02
subsystem: testing
tags: [renderer, csp, referrer-policy, no-referrer, srcdoc, sandbox, security, jsdom, msec-04]

# Dependency graph
requires:
  - phase: 12-static-assets-by-reference
    provides: "buildSnapshotHtml srcdoc assembly with CSP_META-first head ordering + the viewer-side fetch security model (asset-policy.js gate, mediaMode)"
  - phase: 13-video-audio-url-playback-sync
    provides: "CSP_META media-src http: https: data: (the second policy directive the referrer meta now sits beside)"
  - phase: 14-adaptive-streaming-adapter-discovery-fallback
    provides: "CSP_META media-src blob: (parent-realm MSE object URL) — the byte-unchanged CSP shape this plan must not touch"
provides:
  - "A single document-level <meta name=\"referrer\" content=\"no-referrer\"> in the renderer srcdoc head, immediately after CSP_META at BOTH buildSnapshotHtml-family return sites (buildSnapshotHtml + buildFramePlaceholderHtml)"
  - "An asserted omit-credentials posture: NO crossorigin attribute anywhere in the srcdoc (confirm-and-pin the already-shipped allow-same-origin + no-crossorigin no-CORS GET behaviour)"
  - "tests/renderer-media-csp.test.js extended with 6 MSEC-04 pins (meta present, exactly-one, ordered after CSP_META and before charset/first stylesheet link/first <img>, no crossorigin, container-less variant)"
affects: [15-03, 15-04, security-docs, docs/SECURITY.md, docs/ARCHITECTURE.md]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Policy-first head block: CSP_META FIRST, the no-referrer meta SECOND, both before charset/viewport/stylesheets/payload — so every policy is parsed before any parser- or CSS-initiated subresource fetch (Pitfall 4)"
    - "Confirm-and-assert security posture: the omit-credentials behaviour already holds (allow-same-origin sandbox + no crossorigin); Phase 15 pins its absence rather than changing behaviour"

key-files:
  created: []
  modified:
    - "src/renderer/snapshot.js (no-referrer meta after CSP_META at both return sites; CSP_META byte-unchanged)"
    - "tests/renderer-media-csp.test.js (+6 MSEC-04 referrer/ordering/no-crossorigin pins, CSP-shape assertions kept)"
    - "tests/renderer-snapshot.test.js (CSP-first verbatim pin updated to <head>+CSP+referrer+charset prefix — sibling adjacency assertion my edit displaced)"

key-decisions:
  - "Document-level <meta name=\"referrer\"> beats per-element referrerpolicy — one control covers <img>/<video>/<source>/poster AND CSS background-image/url()/font fetches that no per-element attribute could reach"
  - "Add NO crossorigin attribute — the allow-same-origin sandbox + no crossorigin already yields no-credential no-CORS GETs; forcing crossorigin=\"anonymous\" would break otherwise-fine non-CORS assets (locked decision); the test asserts absence"
  - "CSP_META left byte-unchanged — only the referrer meta is ADDED; default-src 'none', media-src ... blob:, img-src no-blob, no script-src, no connect-src all retained"
  - "Both buildSnapshotHtml-family return sites carry the meta (the container path AND the container-less buildFramePlaceholderHtml) — every viewer-rendered srcdoc gets the policy"

patterns-established:
  - "Pattern: a viewer-fetch leakage control belongs in the renderer srcdoc head, ordered with the other policy metas before the first subresource — the capture side never fetches, so the renderer is the authoritative place"
  - "Pattern: live CSP/referrer/credential effects are the deferred real-browser UAT (jsdom never parses srcdoc or issues fetches); the string contract is unit-pinned (A2)"

requirements-completed: [MSEC-04]

# Metrics
duration: 6min
completed: 2026-06-21
---

# Phase 15 Plan 02: MSEC-04 Viewer-Fetch Leakage Control (no-referrer meta) Summary

**A single document-level `<meta name="referrer" content="no-referrer">` injected immediately after `CSP_META` at both renderer srcdoc return sites, with the omit-credentials (no-`crossorigin`) posture asserted — so the mirrored page URL (which can carry signed tokens) never leaks in a `Referer` header to third-party CDNs on any viewer-side subresource fetch.**

## Performance

- **Duration:** ~6 min
- **Started:** 2026-06-21T19:05Z
- **Completed:** 2026-06-21T19:11:33Z
- **Tasks:** 1 (TDD)
- **Files modified:** 3

## Accomplishments
- Added exactly one document-level `<meta name="referrer" content="no-referrer">` in `buildSnapshotHtml`, ordered immediately after `CSP_META` and before `<meta charset="UTF-8">` — so the referrer policy is parsed before any parser- or CSS-initiated subresource fetch (`<img>`/`<video>`/`<source>`/poster/`background-image`/fonts).
- Added the same meta to the container-less `buildFramePlaceholderHtml` return site (the cross-origin iframe placeholder is also a viewer-rendered srcdoc).
- Confirmed-and-pinned the omit-credentials posture: the srcdoc carries NO `crossorigin` attribute (the `allow-same-origin` sandbox + no `crossorigin` already yields no-credential no-CORS GETs; forcing `anonymous` would break non-CORS assets).
- Kept `CSP_META` byte-unchanged (`default-src 'none'`, `media-src http: https: data: blob:`, `img-src` no-blob, no `script-src`, no `connect-src`) — only the referrer meta is added.
- Full suite green at 696/696 (was 689 after 15-01; +6 new MSEC-04 pins, +1 updated sibling assertion); differential oracle 48/48 unchanged (renderer-only edit, no wire impact, no new ledger entry).

## Task Commits

Each task was committed atomically (TDD: test → feat):

1. **Task 1 (RED): add failing MSEC-04 no-referrer meta + omit-credentials pins** - `f2f2e99` (test)
2. **Task 1 (GREEN): inject document-level no-referrer meta after CSP_META** - `d84fee6` (feat)

**Plan metadata:** (this SUMMARY + STATE/ROADMAP/REQUIREMENTS) committed separately as `docs(15-02)`.

_TDD: RED pinned 6 new assertions failing (referrer meta absent / ordering / container-less variant) with all existing CSP/gate assertions still green; GREEN added the one production line at both return sites and restored full green. No REFACTOR needed (single literal string addition)._

## Files Created/Modified
- `src/renderer/snapshot.js` - Added `'<meta name="referrer" content="no-referrer">'` between `CSP_META` and `'<meta charset="UTF-8">'` at both `buildSnapshotHtml` (~:673) and `buildFramePlaceholderHtml` (~:690) return sites, with a comment citing MSEC-04 + the deferred real-browser referrer/credentials UAT (A2). `CSP_META` byte-unchanged.
- `tests/renderer-media-csp.test.js` - Added 6 MSEC-04 assertions (meta present via regex; exactly one via `countMatches(/name="referrer"/g) === 1`; ordered after CSP_META and before charset; before the first `<link rel="stylesheet">` for a stylesheet payload; before the first `<img>` for an img payload; no `crossorigin` anywhere; container-less variant carries it too). Existing CSP-shape assertions kept.
- `tests/renderer-snapshot.test.js` - Updated the verbatim CSP-first pin (`<head>` + CSP + charset) to `<head>` + CSP + referrer + charset (the sibling adjacency assertion my meta legitimately displaced; CSP stays FIRST, referrer SECOND, both before any fetch).

## Decisions Made
- **Document-level meta over per-element `referrerpolicy`:** one control covers every viewer-side fetch including CSS `background-image`/`url()` and fonts (which no per-element attribute can carry), and avoids threading an attribute onto every `<img>`/`<source>`/`<video>` at capture/render time. (Locked in 15-CONTEXT / 15-RESEARCH Pattern 4.)
- **No `crossorigin` added:** the omit-credentials posture already holds via `allow-same-origin` + absence of `crossorigin`; the test asserts absence rather than adding an attribute (forcing `anonymous` would force CORS and break non-CORS assets — locked decision).
- **CSP_META byte-unchanged:** only the referrer meta is ADDED; the full CSP shape (no `script-src`, no `connect-src`, `img-src` no-blob, `media-src` keeps `blob:`) is preserved and the existing assertions stay green.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Updated a sibling CSP-first assertion my meta insertion displaced**
- **Found during:** Task 1 (GREEN — full-suite regression check)
- **Issue:** `tests/renderer-snapshot.test.js:62` pinned the head prefix verbatim as `'<head>' + CSP + '<meta charset="UTF-8">'` (no gap). Inserting the no-referrer meta between CSP and charset — which the plan explicitly requires ("ordered IMMEDIATELY AFTER CSP_META and BEFORE the first subresource link") — broke that exact-adjacency `includes()` check. This was a direct consequence of the in-scope edit, not a pre-existing or unrelated failure, so it is in scope to fix (the assertion's intent — "policy metas precede any parser-initiated fetch" — is preserved).
- **Fix:** Updated the verbatim pin to `'<head>' + CSP + '<meta name="referrer" content="no-referrer">' + '<meta charset="UTF-8">'` and renamed the test + added a comment noting CSP stays FIRST, the referrer meta SECOND, both before any fetch. The dedicated ordering/no-crossorigin pins live in `renderer-media-csp.test.js`.
- **Files modified:** `tests/renderer-snapshot.test.js`
- **Verification:** Full suite `node --test tests/*.test.js tests/differential/*.test.js` → 696/696 green; differential oracle 48/48.
- **Committed in:** `d84fee6` (Task 1 GREEN commit, alongside the production change)

---

**Total deviations:** 1 auto-fixed (1 bug — a sibling test assertion the required edit displaced).
**Impact on plan:** The fix was necessary to keep the suite green and preserves the displaced assertion's intent. No scope creep — no production behaviour beyond the one planned line; CSP_META byte-unchanged; no new dependency (`{ws: 8.21.0}` + `{hls.js: >=1.5.0}` unchanged).

## Issues Encountered
- The initial full-suite run used the glob `tests/*.test.js` (648 tests) which omitted `tests/differential/`. The package.json `test` script is `node --test tests/*.test.js tests/differential/*.test.js`; re-running with the exact glob reported the correct 696 total. No behaviour issue — a runner-invocation discrepancy only.

## Authentication Gates
None — no auth required for this plan.

## Known Stubs
None — the production change is a single complete literal string at both return sites; no placeholder, mock, or empty-value path was introduced.

## TDD Gate Compliance
- RED gate: `test(15-02)` commit `f2f2e99` (6 MSEC-04 assertions failing, existing CSP/gate assertions green).
- GREEN gate: `feat(15-02)` commit `d84fee6` (production line added at both return sites; 19/19 in renderer-media-csp, 696/696 full suite).
- REFACTOR: not needed (single literal string addition; no cleanup applicable).
- Fail-fast note: of the 6 new assertions, the `no crossorigin` pin passed at RED (no crossorigin exists today — that is the confirm-and-assert posture, not a feature to add); the 5 referrer-meta assertions failed as expected. No assertion passed unexpectedly in a way that masked missing behaviour.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- MSEC-04's renderer-side referrer + no-credentials control is complete and pinned. Plans 15-03 / 15-04 (capture-side masking vocabulary, media security tests, threat-model + SECURITY/ARCHITECTURE docs) can proceed.
- The SECURITY.md §6 "Viewer-side resource fetching" update (mark `referrerpolicy="no-referrer"` + no-credentials as completed) is documentation work owned by a later Phase-15 plan; this plan shipped the code + string contract it documents.
- Phase 15 has plans 03–04 remaining; phase status stays EXECUTING.

## Self-Check: PASSED

- FOUND: `.planning/phases/15-media-security-masking-threat-model-docs/15-02-SUMMARY.md`
- FOUND commit: `f2f2e99` (test/RED)
- FOUND commit: `d84fee6` (feat/GREEN)
- Verified: `CSP_META` byte-unchanged; `grep -c crossorigin src/renderer/snapshot.js` → 3 (all comment-only; emitted srcdoc has zero, asserted by the passing `indexOf('crossorigin') === -1` test).

---
*Phase: 15-media-security-masking-threat-model-docs*
*Completed: 2026-06-21*
