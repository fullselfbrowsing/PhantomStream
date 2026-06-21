---
phase: 15-media-security-masking-threat-model-docs
plan: 03
subsystem: testing
tags: [security, media, traceability, object-url, allow-scripts, isCurrentStream, differential-oracle, deps-guard]

# Dependency graph
requires:
  - phase: 15-01
    provides: capture masking spine (maskMediaSelector/maskAssetUrls/maskAssetUrlFn) off-by-default, byte-identical wire
  - phase: 15-02
    provides: renderer document-level no-referrer meta + no-credentials string contract
  - phase: 14-05
    provides: hls.js as an optional peerDependency, dependencies stays { ws } -- the deps-shape guard this re-asserts
  - phase: 14-03
    provides: parent-realm media player destroy/destroyAll object-URL revocation (the threat-model row 3 behavior)
  - phase: 13-03
    provides: handleMedia isCurrentStream staleness guard on STREAM.MEDIA (the late-cross-session reject)
provides:
  - "tests/security-media.test.js -- a named media-security traceability suite (4 invariants) backing the Plan-04 object-URL threat model"
  - "Test-backed proof that media-player.js carries zero allow-scripts (sandbox-token-over-media-code invariant)"
  - "Re-asserted Phase-15 deps-byte-unchanged gate (dependencies === { ws } + hls.js optional peer)"
  - "Phase-15 Wave-2 regression gate run: full suite 700/700, differential oracle 48/48 with no new ledger entry"
affects: [15-04, security-docs, SECURITY.md object-url-threat-model]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Named traceability suite that CITES shipped behavior (file:line in comments) + adds a focused independent assertion -- kept separate from the purity test so the threat-model docs have a green test to point at without coupling to the doc-marker scan"
    - "Re-inlined stripComments+countMatches in the new suite (purity helper is not exported) so the media-path allow-scripts assertion stays self-contained and never edits the purity glob (Pitfall 6)"

key-files:
  created:
    - tests/security-media.test.js
  modified: []

key-decisions:
  - "Object-URL revoke: the shipped integration coverage (renderer-media-player.test.js revoke recorder :75, destroy 'object URL revoked' :521, destroyAll :533) is CITED; this suite adds a focused, self-contained revoke-on-teardown assertion (mint blob: via stubbed createObjectURL -> revokeObjectURL on destroy) so threat-model row 3 is independently test-backed without duplicating the player fixture (plan permitted: 'add a focused case')"
  - "Late-cross-session reject is pinned as a DIRECT unit on isCurrentStream (messages.js:338) -- stale streamSessionId -> false, mismatched snapshotId -> false, matching identity -> true -- citing the integration proof at renderer-media.test.js:411 (plan permitted: a direct isCurrentStream assertion is cleaner than duplicating the whole fixture)"
  - "Media-path allow-scripts assertion reads src/renderer/media-player.js directly and reuses the purity stripComments+countMatches pattern; it does NOT edit tests/security-chokepoint-purity.test.js or the rendererModules glob (Pitfall 6 -- the glob already covers media-player.js)"

patterns-established:
  - "Independent named security-invariant suite (4 tests) that backs a docs threat model -- decoupled from the marker-scan purity test by design (Plan 04 owns the purity-test marker edits)"

requirements-completed: [MSEC-04]

# Metrics
duration: 5min
completed: 2026-06-21
---

# Phase 15 Plan 03: Named Media-Security Traceability Suite Summary

**A new `tests/security-media.test.js` pins the four media-security invariants that back the Plan-04 object-URL threat model -- zero `allow-scripts` in `media-player.js`, deps byte-unchanged (`{ ws }` + `hls.js` optional peer), late cross-session `STREAM.MEDIA` rejected by `isCurrentStream`, and parent-realm object-URL revoke-on-destroy -- then re-runs the Phase-15 Wave-2 regression gate (full suite 700/700, oracle 48/48, no new ledger entry).**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-06-21T19:13:08Z (after 15-02)
- **Completed:** 2026-06-21
- **Tasks:** 2
- **Files modified:** 1 (created)

## Accomplishments
- Created the named media-security traceability suite (`tests/security-media.test.js`, 4 named tests, all green) that gives the Plan-04 `docs/SECURITY.md` "Parent-Realm Object-URL Threat Model" subsection a green test to cite for every row.
- Pinned the sandbox-token-over-media-code invariant explicitly: `src/renderer/media-player.js` carries zero `allow-scripts` outside comments (reusing the purity `stripComments`+`countMatches` pattern, glob untouched -- Pitfall 6).
- Re-asserted the Phase-15 no-new-deps gate: `dependencies === { ws: '8.21.0' }`, `peerDependencies['hls.js']` is a version-range string, `peerDependenciesMeta['hls.js'].optional === true`, `hls.js` absent from devDependencies.
- Ran the Phase-15 Wave-2 regression gate clean: `npm test` 700/700 (696 baseline + 4 new), differential oracle 48/48 with the divergence-ledger byte-unchanged (off-by-default masking holds byte-identity), `package-publish.test.js` 6/6.

## Task Commits

Each task was committed atomically:

1. **Task 1: Named media-security traceability suite (allow-scripts media-path + deps gate + late-cross-session + object-URL revoke)** - `709f5ea` (test)
2. **Task 2: Phase regression gate (full suite + differential oracle 48/48 + deps-shape guard)** - no code commit (the gate is the work; it adds no new assertion beyond Task 1's suite -- gate result recorded here, per the plan's "record the gate result in the SUMMARY")

**Plan metadata:** committed with this SUMMARY + STATE.md + ROADMAP.md + REQUIREMENTS.md.

## Files Created/Modified
- `tests/security-media.test.js` - NEW. Four named media-security invariants: (1) media-player.js zero allow-scripts outside comments; (2) deps byte-unchanged (`{ ws }` + optional `hls.js` peer); (3) late cross-session `STREAM.MEDIA` rejected by `isCurrentStream` (no driver); (4) parent-realm object URL revoked on destroy/destroyAll. Each cites the shipped behavior/file:line in comments and maps to a STRIDE threat (T-15-10..13).

## Phase Regression Gate Result (Task 2)

| Gate | Command | Result |
|------|---------|--------|
| New traceability suite | `node --test tests/security-media.test.js` | 4/4 green |
| Full suite | `npm test` | **700/700** green (696 baseline after 15-02 + 4 new) |
| Differential oracle | `node --test tests/differential/oracle.test.js` | **48/48** green |
| Divergence ledger | `git diff --quiet HEAD -- tests/differential/divergence-ledger.js` | **byte-unchanged** (no new entry -- masking off-by-default -> byte-identical wire) |
| Deps-shape guard | `node --test tests/package-publish.test.js` | 6/6 green (dependencies/peerDependencies byte-unchanged) |

No byte-identity regression from Plan 01/02: the oracle stayed at 48/48 with no new divergence-ledger entry, confirming the Pitfall-1 URL-normalization trap was avoided upstream and the off-by-default masking + renderer-only referrer meta did not perturb the wire.

## Decisions Made
- **Object-URL revoke** -- cited the shipped integration coverage and ADDED a focused, self-contained revoke-on-teardown assertion (the plan explicitly permitted "or add a focused case"). The focused case mints a `blob:` via a stubbed `URL.createObjectURL` and asserts `URL.revokeObjectURL` is called with exactly that URL on teardown, so threat-model row 3 is independently test-backed without re-importing the full player fixture.
- **Late-cross-session reject** -- pinned as a DIRECT `isCurrentStream` unit (the plan permitted "a direct isCurrentStream unit assertion if cleaner"): stale `streamSessionId` -> `false`, mismatched `snapshotId` -> `false`, matching identity -> `true`, citing the integration proof at `renderer-media.test.js:411`.
- **allow-scripts media-path** -- read `media-player.js` directly and reused the purity `stripComments`/`countMatches` approach; did NOT edit the purity test or its `rendererModules` glob (the glob already globs `src/renderer/*.js`, which includes `media-player.js` -- Pitfall 6).

## Deviations from Plan

None - plan executed exactly as written. No production code touched, no dependencies added, no envelope/relay changes, and the purity test + its glob were left unedited (Plan 04 owns the purity-test marker additions).

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- The four media-security invariants are now green and named, so Plan 04 can author the `docs/SECURITY.md` Parent-Realm Object-URL Threat Model subsection (and the ARCHITECTURE.md limitation #6 rewrite) with each threat-model row backed by a citable test.
- Phase regression gate passes (full suite 700/700, oracle 48/48, deps byte-unchanged), so Phase 15 is green going into its final docs plan.
- Phase 15 remains EXECUTING -- Plan 04 (docs) is the last plan in the phase.

## Self-Check: PASSED

- FOUND: `tests/security-media.test.js`
- FOUND: `.planning/phases/15-media-security-masking-threat-model-docs/15-03-SUMMARY.md`
- FOUND: commit `709f5ea` (Task 1)

---
*Phase: 15-media-security-masking-threat-model-docs*
*Completed: 2026-06-21*
