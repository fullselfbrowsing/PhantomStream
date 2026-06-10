---
phase: 01-capture-core-extraction-differential-oracle
plan: 01
subsystem: testing
tags: [differential-testing, jsdom, test-harness, ci, node-test, mutation-observer]

# Dependency graph
requires: []
provides:
  - Differential oracle harness green reference-vs-reference on the basic fixture (jsdom 29, dual-JSDOM, single shared factory)
  - normalizeReference / canonicalizeIdentity / compareStreams pure transforms with first-divergence UNDECLARED DIVERGENCE reporting
  - Machine-readable divergence ledger skeleton (DIVERGENCES + ledgerCovers, mismatch vs documented-mapping kinds)
  - Frozen basic.html fixture + basic-mutations scenario exercising all four diff-op types (attr, add, rm, text)
  - jsdom ^29.1.1 devDependency + committed package-lock.json; recursive quoted test glob
  - GitHub Actions CI workflow (Node 20/22/24 matrix, contents: read, npm ci + npm test)
affects: [01-02 fixtures-scenarios, 01-03 capture-extraction, 01-04 oracle-flip-ledger-entries, 01-05 defense-tests, ci]

# Tech tracking
tech-stack:
  added: [jsdom@^29.1.1 (devDependency only), actions/checkout@v6, actions/setup-node@v6]
  patterns:
    - Single shared JSDOM factory builds every oracle side (one construction site, fixed url https://fixture.test/page)
    - Reference IIFE loaded unmodified via getInternalVMContext + vm.runInContext behind a two-key chrome stub
    - settle() deterministic flush cadence (setTimeout 0 -> rAF -> setTimeout 20)
    - Rest-spread normalization (copy only keys present; no manufactured undefined fields)
    - Ordinal SESSION_n / SNAPSHOT_n identity canonicalization; nids never canonicalized
    - try/finally close() teardown clearing the watchdog setTimeout chain

key-files:
  created:
    - tests/differential/harness.js
    - tests/differential/normalize.js
    - tests/differential/divergence-ledger.js
    - tests/differential/oracle.test.js
    - tests/differential/fixtures/basic.html
    - tests/differential/scenarios/basic-mutations.js
    - .github/workflows/ci.yml
    - package-lock.json
  modified:
    - package.json

key-decisions:
  - "Scenario settles twice after the append group: the add-op flush stamps data-fsb-nid on the inserted subtree, which the observer echoes as attribute mutations flushed on the NEXT frame; a second settle absorbs that echo deterministically so wall-clock jitter can never merge it into the following group's batch on one side only"
  - "Negative control tampers a deep-copied stream from a single capture (clone-and-tamper) rather than running a second side, exactly matching the plan's behavior spec"
  - "REQUIREMENTS.md left untouched: CAPT-04 is also claimed by Plans 01-02 and 01-04 (ref-vs-extracted is what completes it); orchestrator owns shared-artifact writes post-wave"

patterns-established:
  - "Differential oracle: run side A fully to completion before constructing side B; never interleave (per-instance microtask/rAF queues)"
  - "Divergence ledger entries: { id, kind, description, rationale, affectedMessages, affectedScenarios, appliesTo() }; only kind:'mismatch' can excuse a comparison failure"
  - "Oracle failures name fixture/scenario/message-index: UNDECLARED DIVERGENCE <fixture>/<scenario> at message <i>"

requirements-completed: [CAPT-04]

# Metrics
duration: 11min
completed: 2026-06-10
---

# Phase 1 Plan 01: Walking Skeleton — Differential Oracle Summary

**Dual-JSDOM differential oracle running the unmodified FSB reference capture ref-vs-ref on a frozen fixture, green under npm test with a proven-failable negative control, plus jsdom devDependency, fixed recursive test glob, and a read-only Node 20/22/24 CI workflow**

## Performance

- **Duration:** ~11 min
- **Started:** 2026-06-10T03:21:02Z
- **Completed:** 2026-06-10T03:31:41Z
- **Tasks:** 3 (Task 2 executed as TDD: RED -> GREEN)
- **Files modified:** 9

## Accomplishments

- The locked oracle-first ordering (D-09) is satisfied: the harness is green reference-vs-reference BEFORE any extraction commit touches serializer behavior
- Two independent captures of `basic.html` under the `basic-mutations` scenario emit equivalent normalized streams of 8 messages each (ready, snapshot, overlay, then mutations batches covering attr, add, nid-echo, rm, and text ops) — verified stable across 5 consecutive runs
- The oracle provably FAILS: tampering one nested payload field throws `UNDECLARED DIVERGENCE basic.html/basic-mutations at message N` (negative control)
- Full suite is 10/10 (`8 protocol + 2 oracle`) in ~1s; the quoted recursive glob `node --test "tests/**/*.test.js"` picks up `tests/differential/` (the old shell glob silently skipped it)
- jsdom ^29.1.1 lands in devDependencies only — the published library remains dependency-free; package-lock.json committed for `npm ci` reproducibility
- CI workflow created from scratch (`.github/` did not exist): push + pull_request triggers, top-level `permissions: contents: read`, no secrets, Node 20/22/24 matrix matching the jsdom 29 engine floor

## Task Commits

Each task was committed atomically:

1. **Task 1: Install jsdom devDependency and fix the test glob** - `014c26f` (chore)
2. **Task 2: Differential harness + basic fixture (TDD RED)** - `91fad1b` (test)
3. **Task 2: Differential harness + basic fixture (TDD GREEN)** - `d0529d8` (feat)
4. **Task 3: GitHub Actions CI workflow** - `c4ca8e2` (chore)

_No REFACTOR commit: GREEN implementation needed no cleanup pass._

## TDD Gate Compliance

Task 2 (`tdd="true"`) followed the gate sequence: `test(01-01)` commit `91fad1b` (RED — oracle test failed on missing harness/normalize/ledger modules, fail 1 verified) precedes `feat(01-01)` commit `d0529d8` (GREEN — 2/2 oracle tests pass, 10/10 full suite).

## Files Created/Modified

- `tests/differential/harness.js` - Dual-JSDOM factory (`createReferenceSide`), reference IIFE loader (readFileSync + vm.runInContext into getInternalVMContext), `settle()` cadence, `runScenario()` with try/finally idempotent close
- `tests/differential/normalize.js` - `normalizeReference` (action -> STREAM mapping, rest-spread of present keys), `canonicalizeIdentity` (ordinal SESSION_n/SNAPSHOT_n, recursive, nids untouched), `compareStreams` (first-divergence reporting, returns matched ledger-entry ids)
- `tests/differential/divergence-ledger.js` - `DIVERGENCES` (empty by construction for ref-vs-ref) + `ledgerCovers` (mismatch-kind entries only) + DivergenceEntry typedef
- `tests/differential/oracle.test.js` - Ref-vs-ref equivalence test (asserts non-trivial streams, length >= 3) + clone-and-tamper negative control asserting fixture/scenario/index in the error
- `tests/differential/fixtures/basic.html` - Frozen script-free fixture: headings, paragraphs, list, form with text input, relative img src, inline style, `<style>` with class and element selectors, card-area append target
- `tests/differential/scenarios/basic-mutations.js` - Pure scenario: attr change, append-with-children, remove, character-data change, settle after each group
- `.github/workflows/ci.yml` - CI: checkout@v6, setup-node@v6 (npm cache), matrix [20, 22, 24], npm ci + npm test, contents: read
- `package.json` - jsdom ^29.1.1 in devDependencies; test script -> `node --test "tests/**/*.test.js"`
- `package-lock.json` - Pinned dependency tree (jsdom + transitive, 0 vulnerabilities)

## Decisions Made

- **Append target is `#card-area`, not `document.body`:** the serializer's TreeWalker never assigns a nid to its root (body), so an append to body is silently dropped by the reference (`parentNid` missing). Appending to a tracked in-body element produces the intended add op.
- **Character-data group mutates `firstChild.data` directly:** setting `textContent` replaces the text node (a childList mutation the reference skips for non-element nodes); direct data mutation produces the characterData record -> text op.
- **Double settle after the append group** (see Deviations) to make the data-fsb-nid echo flush deterministic.
- **REQUIREMENTS.md untouched:** CAPT-04 spans Plans 01-01/01-02/01-04; it is not complete until the extracted core is verified against the reference (01-04). Orchestrator reconciles requirement state post-wave.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Prevented a timing race that could split mutation batches differently per side**
- **Found during:** Task 2 (scenario authoring, pre-implementation analysis)
- **Issue:** When the add-op flush runs, the reference stamps `data-fsb-nid` on the inserted subtree from inside the observed tree; the observer reports these as fresh attribute mutations flushed on the NEXT animation frame (~16ms later), while the plan's single settle tail is 20ms — a ~4ms margin. Under event-loop jitter (CI runners), the echo flush could land after the next group's mutation on one side only, merging echo + rm ops into one message there but not on the other side: a phantom, flaky divergence.
- **Fix:** The `basic-mutations` scenario settles twice after the append group, deterministically absorbing the echo flush into its own message (message 5) before group 3 begins. Scenario content is explicitly Claude's discretion per 01-RESEARCH.md user constraints.
- **Files modified:** tests/differential/scenarios/basic-mutations.js
- **Verification:** 5 consecutive full oracle runs all green; observed stream shape stable at 8 messages with the echo isolated as its own batch
- **Committed in:** 91fad1b (Task 2 RED commit)

---

**Total deviations:** 1 auto-fixed (1 bug/flake prevention)
**Impact on plan:** Determinism fix inside discretionary scenario authoring. No scope creep; no behavior of the harness API deviates from the plan spec.

## Known Stubs

| Stub | File | Reason |
|------|------|--------|
| `DIVERGENCES = []` | tests/differential/divergence-ledger.js | Intentional by construction: reference-vs-reference comparison has zero divergences. Plan 01-04 populates entries (D1 resume-no-resnapshot, envelope mapping, ready-ping timing, ...) when the extracted core becomes side B. Does not block this plan's goal. |

## Issues Encountered

None — the empirically verified recipes from 01-RESEARCH.md (getInternalVMContext + two-key chrome stub, settle cadence, quoted recursive glob) worked exactly as documented.

## User Setup Required

None - no external service configuration required. (The CI workflow's first real run triggers on the next push to GitHub.)

## Next Phase Readiness

- Oracle skeleton green and provably failable: Plans 01-02 (more fixtures/scenarios) and 01-03 (capture extraction) can proceed; 01-04 flips side B to the extracted core and adds ledger entries
- `createReferenceSide(fixtureHtml, { runScripts: 'dangerously' })` config seam is ready for the trusted dialog fixture (Pitfall 5)
- `compareStreams` already returns the matched-ledger-id Set that Plan 01-04's stale-entry detection consumes
- CI runs the full suite on every push/PR with read-only permissions

## Self-Check: PASSED

- All 9 created/modified files verified present on disk
- All 4 task commits verified in git log (014c26f, 91fad1b, d0529d8, c4ca8e2)
- npm test: 10/10 green; oracle completes in ~1s, process exits cleanly

---
*Phase: 01-capture-core-extraction-differential-oracle*
*Completed: 2026-06-10*
