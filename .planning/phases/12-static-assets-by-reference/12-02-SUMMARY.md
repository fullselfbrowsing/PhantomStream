---
phase: 12-static-assets-by-reference
plan: 02
subsystem: capture
tags: [static-assets, by-reference, currentsrc-pin, asset-degrade, placeholder, differential-oracle, divergence-ledger, jsdom]

# Dependency graph
requires:
  - phase: 12-01 (Wave 1)
    provides: capture-asset-degrade RED scaffold (the GREEN target) + static-assets.html fixture (blob:/oversized-data: seeds + small-data: byte-identical case)
  - phase: 03-renderer / relay
    provides: SNAPSHOT payload shape + byte-verbatim relay (D26 rides one snapshot, no relay change)
provides:
  - ASSET_DATA_URI_MAX_BYTES byte-cap constant (256 KiB, documented derivation)
  - classifyAssetRef + currentSrcDiffers pure capture helpers (Phase-15-reusable predicates)
  - clone-only data-ps-currentsrc variant pin (ASST-03) across all 4 serialization sites
  - blob:/oversized-data: -> dimensioned data-ps-asset-unavailable placeholder degrade (ASST-04) across all 4 sites
  - static-assets oracle scenario + firing D26 divergence-ledger entry
affects: [12-03-renderer-gate-and-mediamode, phase-13-media, phase-15-masking]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Capture degrade modeled on createBlockPlaceholder/replaceWithBlockPlaceholder: collect non-shareable clone pairs during the pair walk, read live rects in the single-pass layout block, swap clones for dimension-only <div> after the walk (single-pass layout discipline preserved)"
    - "Clone-only enrichment (Phase 7 invariant): data-ps-currentsrc / data-ps-asset-unavailable land on the detached wire clone (the added-node path's wireClone is the trap) -- never the live node; a capture test asserts the live DOM has zero data-ps-* attrs after serialize"
    - "serializeSnapshot(doc) top-level export swaps ambient globals from doc.defaultView for one serialization (mirrors the differential harness createExtractedSide), runs a no-op-transport capture, restores globals in finally -- the no-observer unit-test path"
    - "One same-index SNAPSHOT mismatch => exactly one ledger entry: the combined currentSrc-pin + blob-degrade + oversized-degrade surface as a single html-field divergence, so D26 covers all three; a second (D27) mismatch entry could never fire and would fail stale-entry detection"

key-files:
  created:
    - tests/differential/scenarios/static-assets.js
  modified:
    - src/protocol/constants.js
    - src/capture/index.js
    - tests/differential/divergence-ledger.js
    - tests/differential/oracle.test.js

key-decisions:
  - "D26 only, NO D27 -- decided by RUNNING the oracle (research Open Question 2). The static-assets fixture produces exactly ONE same-index SNAPSHOT mismatch (the html field differs by currentSrc pin AND both placeholder degrades at once). compareStreams compares the whole SNAPSHOT message, and ledgerCovers returns the FIRST matching entry, so a separate D27 degrade entry could never match a second mismatch -- it would go stale and FAIL the stale-entry detector. D26's predicate therefore recognizes the combined extracted-only divergence (currentSrc pin OR asset-unavailable marker present in ext, absent in ref)."
  - "ASSET_DATA_URI_MAX_BYTES = 262144 (256 KiB), ~1/4 of the per-message cap headroom (SNAPSHOT_BUDGET_BYTES ~= 838 KiB), with a units/derivation comment -- a data: image over the cap degrades, small inline icons/sprites pass byte-identical (Pitfall 5)."
  - "currentSrc enrichment guarded tag==='img' (Phase 12 image scope; <video>/<audio> currentSrc is Phase 13) and !hasDangerousScheme(resolvedCurrent) (fetchability pin can never reintroduce an injection-blocked scheme -- T-12-05)."
  - "Mutation attr branch degrade: a mutation setting src/poster/srcset to blob:/oversized-data: drops the dead ref from the wire (empty value) AND emits a sibling data-ps-asset-unavailable attr op, rather than shipping the dead reference (T-12-03)."

requirements-completed: [ASST-03, ASST-04]

# Metrics
duration: 38min
completed: 2026-06-20
---

# Phase 12 Plan 02: Capture Asset Degrade + currentSrc Variant Pin Summary

**Closed the two genuine capture-side gaps: a clone-only `data-ps-currentsrc` variant pin (ASST-03) and a `blob:`/oversized-`data:` -> dimensioned `data-ps-asset-unavailable` placeholder degrade (ASST-04), hooked at all four serialization sites, proven by a green capture-degrade suite and a firing D26 differential-oracle entry -- the live page is never mutated and small inline `data:` images stay byte-identical.**

## Performance

- **Duration:** ~38 min
- **Completed:** 2026-06-20
- **Tasks:** 2
- **Files modified:** 5 (1 created, 4 modified)

## Accomplishments

- **ASSET_DATA_URI_MAX_BYTES (256 KiB)** added to `src/protocol/constants.js` with a units/derivation comment tying it to `SNAPSHOT_BUDGET_BYTES` (~838 KiB). A `data:` image over the cap degrades; small inline icons/sprites (<= cap) pass byte-identical, preserving the existing `data:image/*` pass-through and the differential oracle (Pitfall 5).
- **Two pure module-level capture predicates** (`classifyAssetRef(url, capBytes)`, `currentSrcDiffers(currentSrc, src)`) -- unit-testable in isolation, exported for reuse. `classifyAssetRef` is a *fetchability* control distinct from `hasDangerousScheme` (injection): `blob:`/origin-local -> `{ok:false, reason:'blob'}`; oversized `data:` -> `{ok:false, reason:'oversized-data'}`; http(s)/small-`data:`/relative -> `{ok:true}`.
- **Clone-only `data-ps-currentsrc` variant pin (ASST-03)** and **`blob:`/oversized-`data:` -> dimensioned `<div data-ps-asset-unavailable>` placeholder degrade (ASST-04)** hooked at all FOUR serialization sites: the snapshot pair walk, the iframe-content loop, the added-node root + descendants (on the `wireClone`, never the live node -- Pitfall 4), and the mutation attr branch. The degrade is modeled on the shipped `createBlockPlaceholder`/`replaceWithBlockPlaceholder` precedent, preserving the single-pass layout-read discipline (live rects read together after the walk).
- **`serializeSnapshot(doc)` top-level export** -- a no-observer one-shot serializer (swaps ambient globals from `doc.defaultView`, runs a no-op-transport capture, restores in `finally`) that the capture-degrade unit tests drive without arming observers.
- **static-assets oracle scenario + firing D26 ledger entry.** `tests/differential/scenarios/static-assets.js` injects a divergent `currentSrc` via `Object.defineProperty` (jsdom returns `currentSrc===""`), so the clone-only enrichment fires deterministically and D26 is not stale. The fixture is registered in the oracle MATRIX; a per-scenario assertion block proves D26 fires exactly once, the pin is present in the extracted snapshot and absent in the reference, the blob/oversized imgs degrade to placeholders, a `blob:` never reaches the extracted wire, and the small inline `data:` image stays byte-identical.

## Task Commits

Each task was committed atomically:

1. **Task 1: ASSET_DATA_URI_MAX_BYTES + capture degrade/currentSrc pin** - `cc3fd6c` (feat)
2. **Task 2: static-assets oracle scenario + firing D26 ledger entry** - `2db598c` (test)

**Plan metadata:** committed with this SUMMARY (docs: complete plan)

## Files Created/Modified

- `src/protocol/constants.js` - **modified** - added `ASSET_DATA_URI_MAX_BYTES = 262144` with a units/derivation comment.
- `src/capture/index.js` - **modified** - added pure `classifyAssetRef`/`currentSrcDiffers` + a module-level `assetUtf8ByteLength`; inner `createAssetUnavailablePlaceholder`/`replaceWithAssetUnavailablePlaceholder`/`assetDegradeReason`/`assetDegradeReasonForSrcset`; degrade + clone-only currentSrc enrich at all 4 serialization sites; `serializeSnapshot(doc)` top-level export + `serializeSnapshot` on the createCapture return.
- `tests/differential/scenarios/static-assets.js` - **created** - snapshot-centric scenario; `beforeStart` injects a divergent `currentSrc` on `#asset-srcset-img`.
- `tests/differential/divergence-ledger.js` - **modified** - added `htmlContainsCurrentSrcPin`/`htmlContainsAssetUnavailable` helpers and the `D26-currentsrc-variant-pin` mismatch entry (combined ASST-03 pin + ASST-04 degrade).
- `tests/differential/oracle.test.js` - **modified** - import + MATRIX row for `static-assets.html`; per-scenario assertion block; static-assets EMPTY-ledger load-bearing test.

## D26-vs-D27 Decision (for the verifier)

**D26 only. No D27 was added.** Decided empirically by running the oracle, per research Open Question 2.

The static-assets fixture makes the extracted snapshot differ from the reference in three ways *simultaneously* -- the `data-ps-currentsrc` pin, the `blob:` -> placeholder, and the oversized-`data:` -> placeholder -- but all three live inside the single SNAPSHOT message's `html` field. `compareStreams` compares the whole SNAPSHOT message with one `assert.deepStrictEqual`, so the oracle surfaces exactly ONE same-index mismatch, and `ledgerCovers` returns the FIRST matching ledger entry. A separate `D27-asset-unfetchable-placeholder` entry could therefore never match a second divergence -- it would be flagged stale by the stale-entry detector (`every declared mismatch divergence matched at least one real divergence`) and FAIL the build. D26's `appliesTo` accordingly recognizes the combined extracted-only divergence: `(htmlContainsCurrentSrcPin || htmlContainsAssetUnavailable)` true in the extracted snapshot and false in the reference, scenario-pinned to `static-assets`, same-index SNAPSHOT-vs-SNAPSHOT only.

## Deviations from Plan

None - plan executed exactly as written. No Rule 1-4 deviations; no auth gates; no architectural changes. The plan anticipated the D26-vs-D27 fork and instructed "decide by running the oracle" -- the decision (D26 only) is recorded above, not a deviation. `reference/` was untouched; no `mediaMode`/origin-policy/CSP work (that is 12-03); no asset-URL masking (Phase 15); no packages installed (Phase 12 adds none).

## Threat Model Coverage

- **T-12-03 (DoS, blob:/oversized-data:):** mitigated -- `classifyAssetRef` detects both at capture; the degrade hooks at all 4 sites emit a dimensioned placeholder (snapshot/iframe/added-node) or drop the dead ref + emit `data-ps-asset-unavailable` (mutation attr). A `blob:` never reaches the wire; an oversized `data:` cannot blow the per-message cap.
- **T-12-04 (live-page mutation):** mitigated -- `data-ps-currentsrc` and the placeholder are written CLONE-ONLY (the added-node `wireClone` is the trap; descendants swapped, root reference rebound). A capture test asserts the live DOM has zero `data-ps-*` attributes after serialize.
- **T-12-05 (injection vs fetchability conflation):** mitigated -- the pin is set only when `!hasDangerousScheme(resolvedCurrent)`, so an enriched currentSrc can never reintroduce a `javascript:`/`data:text/html` value.
- **T-12-SC (supply chain):** N/A by construction -- no packages installed.

## Test Status (read this for the wave-merge run)

- **`node --test tests/capture-asset-degrade.test.js`: 7/7 GREEN** (classifyAssetRef blob/oversized/small-data; currentSrcDiffers true/false/empty; injected-currentSrc clone enrichment; live-DOM-no-data-ps-* invariant).
- **`node --test tests/differential/oracle.test.js`: 44/44 GREEN** -- the static-assets ref-vs-ref pair (harness self-test), the ref-vs-extracted pair with D26 matched exactly once, the static-assets EMPTY-ledger load-bearing test, and the stale-entry detector (D26 matched >= 1) all pass.
- **Full `npm test`: 449 tests = 426 pass + 23 fail.** The ONLY failures are the two still-RED 12-03 renderer scaffolds (`renderer-asset-policy.test.js` 15 + `renderer-asset-gate.test.js` 8 = 23), which Plan 12-03 fills to GREEN. Everything 12-02 owns -- the capture-degrade suite, the differential oracle incl. the new static-assets row + firing D26, and all 416 pre-existing tests -- is GREEN. Arithmetic: 449 = 446 (prior) + 3 new oracle tests; 426 = 423 (prior) + 3.
- Capture module imports cleanly in bare Node (side-effect-free invariant preserved; new exports `classifyAssetRef`/`currentSrcDiffers`/`serializeSnapshot` present).

## Next Phase Readiness

- ASST-03 and ASST-04 are capture-complete and oracle-proven. Plan 12-03 adds the renderer-side fetch gate (`classifyAssetOrigin`, `gateAssetUrl`, `mediaMode`/`assetOriginPolicy`/`allowAssetOrigins` on `createViewer`) and the renderer-side `blocked-origin` placeholder, filling the two remaining RED scaffolds to GREEN.
- The renderer must consume `data-ps-currentsrc` (pin the variant + neutralize `srcset`/`sizes`) and render the capture-side `data-ps-asset-unavailable` placeholders -- both wire surfaces are now produced.
- Real `currentSrc` resolution, real `srcset` neutralization, and real `data:`/`blob:` fetch behavior remain Playwright UAT (jsdom returns `currentSrc===""` and does not fetch), per the project's UAT-deferral precedent.

## User Setup Required

None - no external service configuration required.

## Self-Check: PASSED

- Created files all present: `tests/differential/scenarios/static-assets.js`, `.planning/phases/12-static-assets-by-reference/12-02-SUMMARY.md`.
- Task commits present in history: `cc3fd6c` (Task 1), `2db598c` (Task 2).
- `ASSET_DATA_URI_MAX_BYTES` present in `src/protocol/constants.js`; `D26-currentsrc-variant-pin` present and firing in the oracle (`grep -c` = 1; oracle.test.js GREEN).

---
*Phase: 12-static-assets-by-reference*
*Completed: 2026-06-20*
