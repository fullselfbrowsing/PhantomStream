---
phase: 15-media-security-masking-threat-model-docs
plan: 04
subsystem: testing
tags: [security-docs, masking, referrer-policy, object-url, threat-model, csp, sandbox, purity-test]

# Dependency graph
requires:
  - phase: 15-01
    provides: "MSEC-03 capture masking spine (maskMediaSelector/maskAssetUrls/maskAssetUrlFn + TOKEN_PARAM_DENYLIST) — the vocabulary §4 now documents"
  - phase: 15-02
    provides: "MSEC-04 viewer-fetch leakage control (document-level <meta name=referrer content=no-referrer> + no-crossorigin posture) — what §6 now documents as completed"
  - phase: 15-03
    provides: "tests/security-media.test.js media-security traceability suite (allow-scripts-absent, object-URL revoke, late-cross-session reject) — the backing tests the object-URL threat model cites"
provides:
  - "docs/SECURITY.md §4 asset/media URL masking vocabulary + the exact token/PII query-param denylist table"
  - "docs/SECURITY.md §6 Referrer and credentials subsection (referrerpolicy=no-referrer + no-credentials) marked COMPLETED; line-214 forward-reference now past tense"
  - "docs/SECURITY.md Parent-Realm Object-URL Threat Model subsection (5 STRIDE rows + plain-language worst case + backing-test cites)"
  - "docs/ARCHITECTURE.md limitation #6 rewritten — <video>/<audio> mirrored by reference; residual narrowed to DRM/EME, MSE-without-manifest, raw pixels"
  - "tests/security-chokepoint-purity.test.js requiredMarkers extended (12 existing kept verbatim + 6 new) so the docs cannot rot away from the shipped masking/referrer/object-URL controls"
affects: [milestone-v2.1, evaluation-harness, research-paper, security-review, docs]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Doc-marker discipline: docs/SECURITY.md substrings are pinned by tests/security-chokepoint-purity.test.js requiredMarkers; doc edit + marker edit land in the SAME change so the security contract cannot silently rot"
    - "Structured asset/threat/mitigation (STRIDE) subsection for a cross-realm construct, ending in a plain-language worst case + a backing-test cite list"

key-files:
  created:
    - .planning/phases/15-media-security-masking-threat-model-docs/15-04-SUMMARY.md
  modified:
    - docs/SECURITY.md
    - docs/ARCHITECTURE.md
    - tests/security-chokepoint-purity.test.js

key-decisions:
  - "One branch keyed by ctx.kind, not two dispatch literals: did NOT add 'asset-url'/'media-url' to the purity dispatch marker list (:76 stays element/subtree/attr/text/css) per Open Question 1 — the docs pin the vocabulary nouns (maskMediaSelector/maskAssetUrls/maskAssetUrlFn) instead"
  - "Both 'referrer' and 'no-referrer' added as required markers (referrer is a substring of no-referrer, but includes() asserts each independently and both whole strings appear verbatim in §6)"
  - "Object-URL threat model written as a §6 subsection (under Viewer-side resource fetching) since it is a viewer-fetch/blob: surface, keeping the referrer/credentials/object-URL controls co-located"

patterns-established:
  - "Pattern: doc edit + purity-marker edit in one commit — the marker guard is extended in the same change as the prose so a future restructuring that drops a marker fails the test loudly"
  - "Pattern: documented-completed not documented-deferred — a forward-reference (line-214) is flipped to past tense and pointed at the now-shipped sections when a threaded control lands"

requirements-completed: [MSEC-04]

# Metrics
duration: 4min
completed: 2026-06-21
---

# Phase 15 Plan 04: Media Security Contract Docs Summary

**docs/SECURITY.md now documents the asset/media URL masking vocabulary + token/PII denylist (§4), the referrerpolicy=no-referrer / no-credentials completion (§6, line-214 past-tense), and a structured Parent-Realm Object-URL Threat Model (5 STRIDE rows + worst case); docs/ARCHITECTURE.md limitation #6 states media is mirrored by reference — with the 12 existing purity markers preserved verbatim and 6 new ones added in the same change (suite 700/700).**

## Performance

- **Duration:** 4 min
- **Started:** 2026-06-21T19:23:50Z
- **Completed:** 2026-06-21T19:27:14Z
- **Tasks:** 2
- **Files modified:** 3 (docs/SECURITY.md, docs/ARCHITECTURE.md, tests/security-chokepoint-purity.test.js)

## Accomplishments
- **§4 Masking Guarantees** gained the three host masking options (`maskMediaSelector` -> omit URL + no `STREAM.MEDIA` + dimensioned placeholder; `maskAssetUrls` -> off-by-default token/PII strip, byte-identical when nothing is removed; `maskAssetUrlFn` -> string replaces / `null` blocks / throw fails closed to BLOCK) plus the exact token/PII query-param denylist table (AWS SigV4 + `x-amz-` prefix, AWS SigV2, GCP + `x-goog-` prefix, Azure SAS, generic; case-insensitive, exact-name-OR-prefix, functional params survive).
- **§6 Viewer-side resource fetching** gained a **Referrer and credentials** subsection: the document-level `<meta name="referrer" content="no-referrer">` injected immediately after the CSP meta (covering every viewer subresource fetch incl. CSS-initiated ones) and the no-`crossorigin` omit-credentials posture, with the live referrer/CSP enforcement marked as the deferred real-browser UAT. The line-214 forward-reference ("...are Phase 15 (MSEC-03/MSEC-04); Phase 12 makes the fetch-gate decisions") now reads as **completed** and points at §4 + the new subsection.
- **Parent-Realm Object-URL Threat Model** subsection added: the parent-origin `blob:` MSE binding as the asset, 5 STRIDE rows (no `allow-scripts` -> child cannot read the blob; `media-src blob:` only, no `connect-src`; revoke on `destroy`/`destroyAll`; `blob:` not in `default-src`/`img-src`; parent realm is trusted host code), the plain-language worst case (the child plays but cannot script/read/copy/exfiltrate it), and a backing-test cite list.
- **docs/ARCHITECTURE.md limitation #6** rewritten: `<video>`/`<audio>` are now mirrored **by reference** (state baseline + progressive + best-effort adaptive HLS/DASH from a parent-realm surface, bytes never cross the relay); residual narrowed to DRM/EME (poster), MSE/`blob:` without a discoverable manifest (poster), and raw media pixels/frames (out of scope); closed shadow roots + cross-origin iframe content kept as the standing browser-boundary limits.
- **Purity-test marker guard extended in the same change:** all 12 existing `docs/SECURITY.md` markers kept verbatim + 6 new (`maskMediaSelector`, `maskAssetUrls`, `maskAssetUrlFn`, `referrer`, `no-referrer`, `Parent-Realm Object-URL`); the `rendererModules()` glob and the `element/subtree/attr/text/css` dispatch marker list are untouched.

## Task Commits

Each task was committed atomically:

1. **Task 1: SECURITY.md (§4 masking vocab + denylist, §6 referrer/no-credentials completed, Parent-Realm Object-URL Threat Model) + purity-test markers in the SAME change** - `ef5c417` (docs)
2. **Task 2: ARCHITECTURE.md limitation #6 rewrite (media mirrored by reference)** - `8d4f998` (docs)

**Plan metadata:** _final docs commit below_ (docs: complete plan)

## Files Created/Modified
- `docs/SECURITY.md` - +§4 masking vocabulary + token/PII denylist table; +§6 Referrer and credentials subsection (no-referrer meta + no-crossorigin) marked completed; line-214 forward-reference flipped to past tense; +Parent-Realm Object-URL Threat Model subsection (5 rows + worst case + cites)
- `docs/ARCHITECTURE.md` - limitation #6 rewritten: media mirrored by reference; residual narrowed to DRM/EME, MSE-without-manifest, raw pixels
- `tests/security-chokepoint-purity.test.js` - `requiredMarkers` extended (12 existing verbatim + 6 new); glob + dispatch marker list unchanged

## Decisions Made
- **One masking-dispatch branch, no new dispatch markers** — followed Open Question 1: did not add `'asset-url'`/`'media-url'` to the `:76` dispatch list (it still pins exactly `element/subtree/attr/text/css`). The docs pin the masking vocabulary nouns (`maskMediaSelector`/`maskAssetUrls`/`maskAssetUrlFn`) as markers instead, giving traceability without over-pinning an internal dispatch shape.
- **Both `referrer` and `no-referrer` as markers** — `referrer` is a substring of `no-referrer`, but `String.includes()` asserts each independently and both whole strings appear verbatim in the new §6 prose, so both assert true and both are meaningful pins.
- **Object-URL threat model placed as a §6 subsection** — it is a viewer-fetch / `blob:` surface, so it lives under "Viewer-side resource fetching" beside the referrer/credentials controls rather than as a new top-level section.

## Deviations from Plan

None - plan executed exactly as written.

No Rule 1-4 deviations occurred. This was a pure docs + test-marker-array change with no production-code, envelope/relay, or dependency edits; no bugs, missing critical functionality, or blocking issues were encountered. No packages installed (no package-legitimacy gate).

## Issues Encountered
- Emoji scan flagged `→` (U+2192) in `docs/ARCHITECTURE.md`. Verified the 3 arrows are **pre-existing** prose untouched by this edit (`git diff` shows zero arrows on any `+`/`-` line); the limitation #6 rewrite uses `--` and `;` only and is emoji-free. Out of scope (SCOPE BOUNDARY) — not modified.

## Known Stubs
None - documentation reflects shipped controls only (the masking vocabulary, referrer meta, and object-URL binding all landed in Plans 15-01/15-02 and Phases 13-14; this plan documents them).

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- **v2.0 milestone is functionally complete.** This is the final plan of the final v2.0 phase (Phase 15, plan 4 of 4). The full security contract threaded through Phases 12-14 is now completed, threat-modeled, tested, and documented; the purity-test marker guard keeps the docs from rotting away from the code.
- Full suite **700/700**, differential oracle unchanged (no new ledger entry — docs-only), no new dependencies (`{ws}` + optional `hls.js` peer).
- Deferred to milestone v2.1 (provisional Phases 16-17): evaluation corpus/harness (EVAL-01..06) + the system-track research paper (PAPR-01,02). Live `no-referrer` / CSP / no-credentials enforcement remains the documented deferred real-browser UAT (jsdom limit, consistent with Phases 13-14).

## Self-Check: PASSED

- Files verified present: `docs/SECURITY.md`, `docs/ARCHITECTURE.md`, `tests/security-chokepoint-purity.test.js`, `.planning/phases/15-media-security-masking-threat-model-docs/15-04-SUMMARY.md`.
- Commits verified in git log: `ef5c417` (Task 1), `8d4f998` (Task 2).
- `node --test tests/security-chokepoint-purity.test.js` green (8/8, marker assertion passes with 12 existing + 6 new markers); full suite `npm test` 700/700.

---
*Phase: 15-media-security-masking-threat-model-docs*
*Completed: 2026-06-21*
