---
phase: 01-capture-core-extraction-differential-oracle
verified: 2026-06-10T09:35:57Z
status: human_needed
score: 26/26 must-haves verified
overrides_applied: 0
human_verification:
  - test: "Push the branch and confirm the GitHub Actions CI workflow goes green on the full Node 20/22/24 matrix"
    expected: "All three matrix jobs (Node 20, 22, 24) run npm ci + npm test and pass 50/50, including the purity gate and the differential oracle"
    why_human: "The workflow has never executed remotely (branch phantomstream-remote-control has no upstream; gh run list is empty). Local verification covers Node 24 only; the review-fix CR-01 test-script change (9db86b2) specifically targets Node 20/22 glob portability, which only a real matrix run can confirm"
deferred:
  - truth: "Capture equivalence verified under real browser layout (getComputedStyle / getBoundingClientRect non-degenerate)"
    addressed_in: "Phases 2, 4, 5, 12"
    evidence: "01-CONTEXT.md user-locked decision D-01: jsdom oracle limitation explicitly recorded — 'divergences that only manifest with real layout are NOT caught by this oracle and are deferred to real-browser verification in later phases (2, 4, 5, 12)'"
  - truth: "All serialization paths strip on* attributes and javascript: URLs"
    addressed_in: "Phase 3"
    evidence: "REQUIREMENTS.md maps SEC-01 to Phase 3; parity-only override D-11 intentionally preserves the reference gap (threat T-01-03 accepted in all five plan threat models)"
  - truth: "5-module split of src/capture/ (serializer/differ/side-channels/session/index)"
    addressed_in: "Later phase (deferred beyond Phase 1)"
    evidence: "01-CONTEXT.md user-locked override D-10: single-file extraction first; 'parity, not the split, is the phase's exit bar' — documented in src/capture/README.md deferred-split note"
---

# Phase 1: Capture Core Extraction + Differential Oracle — Verification Report

**Phase Goal (ROADMAP):** The capture core runs in any injection context behind an injected Transport seam, with output provably equivalent to the shipped reference
**Phase Mode:** mvp
**User Story (from all 5 PLANs, validates against user-story format):** As a host developer embedding PhantomStream, I want to run the capture core in any injection context through an injected Transport, so that I get a capture stream provably equivalent to the shipped FSB reference.
**Verified:** 2026-06-10T09:35:57Z
**Status:** human_needed (all automated must-haves verified; one external-service item remains)
**Re-verification:** No — initial verification

> Format note: the ROADMAP `Goal:` line itself is not in User Story format (`user-story.validate` → false), but the identical, valid User Story appears as the Phase Goal in all five PLANs. Verification proceeded against that story; consider reformatting the ROADMAP Goal line via `/gsd mvp-phase 1` for consistency.

## User Flow Coverage

User story: «As a host developer embedding PhantomStream, I want to run the capture core in any injection context through an injected Transport, so that I get a capture stream provably equivalent to the shipped FSB reference.»

| Step | Expected | Evidence | Status |
|------|----------|----------|--------|
| Import the capture core | `createCapture` importable from the `./capture` subpath and from bare Node with no DOM side effects | `package.json` exports `"./capture": "./src/capture/index.js"`; executed: `import('@fullselfbrowsing/phantom-stream/capture')` → `createCapture: function`; bare-Node import succeeds | ✓ |
| Inject a Transport | Factory accepts `{ transport: { send, flush? } }`, validates send, flush optional | `src/capture/index.js:216-233` (factory + `transport-send-required` throw, reproduced live); flush-less loopback at `tests/differential/harness.js:225-229`; send-only transport test `tests/capture-lifecycle.test.js:254` | ✓ |
| Control the lifecycle | `start`/`stop`/`pause`/`resume` with fresh-session and continue-session semantics | `src/capture/index.js:1178-1249`; pinned by 5 green lifecycle tests (`tests/capture-lifecycle.test.js`) | ✓ |
| Observe the stream | READY/SNAPSHOT/MUTATIONS/SCROLL/OVERLAY/DIALOG arrive on the injected transport with identity stamping | loopback `sent` arrays consumed by 13 capture tests + 27 oracle tests; identity stamping test `tests/capture-defenses.test.js:151` | ✓ |
| Outcome: stream provably equivalent to shipped reference | Differential oracle proves ref-vs-extracted equivalence on frozen fixtures with declared divergences only | `tests/differential/oracle.test.js`: 10 flipped matrix pairs green with non-triviality assertions (lines 222-223), zero ledger consultations outside pause-resume (line 270), D1 scope + stale-entry meta-tests; full suite 50/50 executed during verification | ✓ |

## Goal Achievement

### Observable Truths — ROADMAP Success Criteria

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Differential harness runs reference and extracted side-by-side on frozen fixtures, reports structural op-stream equivalence, records every intentional divergence in a ledger — and existed before the first serializer refactor | ✓ VERIFIED | Dual-mode oracle (`tests/differential/oracle.test.js`, 27 tests green): ref-vs-ref self-test first, 10 flipped pairs, negative control, D1 scope test, stale-entry detection last. Ledger: exactly 1 `kind:'mismatch'` entry (`D1-resume-no-resnapshot`) + 4 `documented-mapping` (D2-D5). Git ordering proven: `git merge-base --is-ancestor` confirms oracle GREEN commits d0529d8 (wave 1) and 8945d08 (wave 2) precede extraction commit 0a95bab (wave 3) |
| 2 | Extracted core contains zero `chrome.runtime`/`window.FSB` references (grep-enforced in CI) and emits through any injected Transport, proven with a loopback transport | ✓ VERIFIED | `tests/capture-purity.test.js` (comment-stripped scan of `\bchrome\s*\.` and `window\.FSB|\bFSB\b` + file-count non-vacuity guard) green; runs under `npm test`, which `.github/workflows/ci.yml` executes. Only chrome./FSB matches in `src/capture/index.js` are in header comments. Loopback transport with NO flush property (`tests/differential/harness.js:225-229`) drives all 10 flipped pairs; send-only transport lifecycle test green |
| 3 | Host can start/stop/pause/resume with fresh-session semantics (new session ID + snapshot ID per session) matching the reference | ✓ VERIFIED | `src/capture/index.js:1178-1249` returns exactly `{start, stop, pause, resume}`. `tests/capture-lifecycle.test.js:149` asserts `notEqual` on BOTH streamSessionId and snapshotId across stop()/start(). Pause/resume continue-same-session (user-locked D-06 override) pinned at lines 177-223: zero messages while paused, no SNAPSHOT after resume, post-resume MUTATIONS carry original streamSessionId AND snapshotId |
| 4 | Reliability defenses survive extraction and are enforced by tests: rAF-batched diffs, self-watchdog force-flush, identity stamping, budgeted whole-subtree truncation with single-pass layout reads | ✓ VERIFIED | Mechanics in `src/capture/index.js` (rAF batch 1004-1005; setTimeout-chain watchdog 1023-1041 with staleFlushCount++ before flush, zero `setInterval`; truncation 765-797 against imported SNAPSHOT_BUDGET_BYTES; single rect read per element 755-757). Enforced by: `capture-defenses.test.js` (exactly-one-flush burst; identity on 4 STREAM types; truncated===true + missingDescendants>0 + MEASURED max-one-rect-read-per-element) and `capture-watchdog.test.js` (staleFlushCount===1, 1.68s wall time — fake-Date recipe, no timer mocks). All green in the 50/50 run |

### Observable Truths — PLAN Frontmatter (merged, deduplicated)

| # | Truth (plan) | Status | Evidence |
|---|--------------|--------|----------|
| 5 | npm test executes the oracle, green ref-vs-ref on basic fixture (01-01) | ✓ VERIFIED | 50/50 suite run during verification includes all ref-vs-ref pairs |
| 6 | Oracle fails loudly with UNDECLARED DIVERGENCE (negative control) (01-01) | ✓ VERIFIED | `oracle.test.js:158-176` clone-and-tamper test asserts `/UNDECLARED DIVERGENCE/` + fixture/scenario/index; green |
| 7 | jsdom devDependency only; library dependency-free (01-01) | ✓ VERIFIED | package.json: `dependencies` absent, `devDependencies: {jsdom: ^29.1.1}`, lockfile committed |
| 8 | CI workflow runs npm test on push/PR with read-only permissions (01-01) | ✓ VERIFIED (definition) | `.github/workflows/ci.yml`: push+pull_request triggers, `permissions: contents: read`, no `secrets.` references, Node [20,22,24] matrix, npm ci + npm test. Actual remote run → human item |
| 9 | Oracle green ref-vs-ref across full fixture x scenario matrix (01-02) | ✓ VERIFIED | 10 MATRIX pairs (`oracle.test.js:42-52,110-122`) green |
| 10 | Truncation actually triggers, identical missingDescendants both sides (01-02) | ✓ VERIFIED | Explicit guards `oracle.test.js:124-143` (ref-vs-ref) and 278-298 (flipped); green |
| 11 | Dialog channel actually exercised, >=1 dialog message both sides (01-02) | ✓ VERIFIED | Guards at `oracle.test.js:145-156` and 300-311; exactly one `runScripts: 'dangerously'` site; green |
| 12 | truncation-overflow.html regeneration byte-identical (01-02) | ✓ VERIFIED | Executed twice during verification: identical sha-256 `f5acb875...` both runs |
| 13 | createCapture importable from subpath and src path (01-03) | ✓ VERIFIED | Both imports executed live; `typeof createCapture === 'function'` |
| 14 | Zero chrome.*/window.FSB, static-scan enforced in CI (01-03) | ✓ VERIFIED | Same as SC2 |
| 15 | Bare-Node import succeeds, no top-level DOM access (01-03) | ✓ VERIFIED | Executed: import succeeds, factory validation throws `transport-send-required` |
| 16 | Full suite stays green; reference + harness untouched by extraction (01-03) | ✓ VERIFIED | `git diff --exit-code -- reference/extension/dom-stream.js` exits 0 (frozen spec byte-identical) |
| 17 | Oracle proves ref-vs-EXTRACTED equivalence on full matrix (01-04) | ✓ VERIFIED | Same as SC1; flipped loop `oracle.test.js:218-276` with non-triviality + scoped-ledger assertions |
| 18 | Ref-vs-ref self-test permanent, ordered before flip tests (01-04) | ✓ VERIFIED | Ref-vs-ref matrix at lines 110-122 precedes flipped section (line 185+) in file order |
| 19 | Every intentional divergence declared; undeclared fails suite (01-04) | ✓ VERIFIED | D1 scope test (`oracle.test.js:313-323`: empty ledger throws) + tightened-D1 test (326-342: broken resume NOT excused, added by review-fix WR-02 `4f283f9`/`4625553`) |
| 20 | Every mismatch-kind entry matched at least once; D1 only in pause-resume (01-04) | ✓ VERIFIED | Stale-entry test last in file (348-358); `matched.size === 0` asserted for all non-pause-resume scenarios (270-273) |
| 21 | Extracted side emits through loopback transport — seam proven end-to-end (01-04) | ✓ VERIFIED | Same as SC2 loopback evidence |
| 22 | stop()/start() mints fresh session: new streamSessionId AND snapshotId (01-05) | ✓ VERIFIED | Same as SC3 |
| 23 | resume() continues SAME identity, no snapshot; paused mutations missed (01-05) | ✓ VERIFIED | Same as SC3; plus flipped pause-resume leak check (`oracle.test.js:259-265`, WR-03 `5210957`) proves during-pause ops never reach the extracted wire |
| 24 | Throwing transport routes to logger, never breaks capture path (01-05) | ✓ VERIFIED | `capture-lifecycle.test.js:225` green; `safeSend` (`src/capture/index.js:294-305`) wraps sync throw + promise rejection |
| 25 | Dedicated green test per reliability defense (01-05) | ✓ VERIFIED | Same as SC4 |
| 26 | Watchdog test completes in seconds via fake-Date/real-setTimeout (01-05) | ✓ VERIFIED | Measured: 1.68s wall; zero `mock.timers` references |

**Score:** 26/26 automated must-haves verified

### Deferred Items

Items not yet met but explicitly addressed in later milestone phases (user-locked decisions, not gaps):

| # | Item | Addressed In | Evidence |
|---|------|--------------|----------|
| 1 | Real-browser layout equivalence (jsdom oracle has degenerate getComputedStyle/getBoundingClientRect) | Phases 2, 4, 5, 12 | 01-CONTEXT.md D-01 USER OVERRIDE records the limitation and defers real-browser verification |
| 2 | on*/javascript: sanitization across all serialization paths | Phase 3 (SEC-01) | REQUIREMENTS.md traceability; threat T-01-03 accepted in all plan threat models; documented in src/capture/README.md behavioral-changes queue |
| 3 | 5-module split of src/capture/ | Post-Phase-1 refinement | 01-CONTEXT.md D-10 USER OVERRIDE; README deferred-split note present |

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/capture/index.js` | Single-file capture core, createCapture factory, >=600 lines | ✓ VERIFIED | 1,250 lines; exports `createCapture`; imports protocol constants/messages (never redefines); all 4 seams present; wired into harness, 4 capture test files, package exports |
| `tests/capture-purity.test.js` | Static-scan purity gate | ✓ VERIFIED | Comment-strips before regex; non-vacuity file-count assertion; runs in suite/CI |
| `tests/differential/harness.js` | Dual-side factory + createExtractedSide + loopback | ✓ VERIFIED | Single shared `buildFixtureDom` construction site; 12-global swap with presence-aware finally restore; flush-less loopback |
| `tests/differential/normalize.js` | normalizeReference/normalizeExtracted/canonicalizeIdentity/compareStreams | ✓ VERIFIED | STREAM imported from protocol (zero restated `ext:` literals); present-keys-only mapping; ordinal SESSION_n/SNAPSHOT_n |
| `tests/differential/divergence-ledger.js` | D1 mismatch + D2-D5 documented-mapping | ✓ VERIFIED | Exactly 1 `kind:'mismatch'` (`D1-resume-no-resnapshot`, scenario-guarded, tightened by WR-02); 4 documented-mapping entries |
| `tests/differential/oracle.test.js` | Dual-mode oracle + guards + meta-tests | ✓ VERIFIED | 27 oracle tests; ref-vs-ref first; flipped matrix; guards; D1 scope; stale-entry last |
| `tests/differential/fixtures/*` (5 fixtures + generator) | Frozen corpus per defense | ✓ VERIFIED | basic/heavy-realistic (srcset, xlink, script/noscript, !important, data-*)/truncation-overflow (1,267,520 ASCII chars, deterministic)/canvas/dialog all present |
| `tests/differential/scenarios/*` (7 modules) | Scripted scenarios per defense | ✓ VERIFIED | basic-mutations, snapshot-only, mutation-burst, structural-ops, scroll, dialog, pause-resume |
| `tests/capture-lifecycle.test.js` | CAPT-02 semantics + transport containment | ✓ VERIFIED | 5 green tests; no differential imports; finally teardown |
| `tests/capture-defenses.test.js` | rAF/identity/truncation defenses | ✓ VERIFIED | 3 green tests; SNAPSHOT_BUDGET_BYTES imported, no literal 838860; measured rect-read invariant |
| `tests/capture-watchdog.test.js` | Watchdog force-flush, own file | ✓ VERIFIED | 1 green test, 1.68s wall; constants imported; no timer mocks |
| `tests/capture-skip.test.js` | skipElement contract coverage (review-fix addition) | ✓ VERIFIED | 3 green tests pinning ancestor-inclusive skip + predicate-error containment (WR-01/WR-02 fixes) |
| `src/capture/README.md` | Shipped factory contract docs | ✓ VERIFIED | Contains createCapture/transport/resume/divergence-ledger/flush/20.19; "extraction pending" gone |
| `.github/workflows/ci.yml` | CI on Node 20/22/24, read-only | ✓ VERIFIED | checkout@v6, setup-node@v6, contents: read, npm ci + npm test, matrix [20,22,24], zero secrets |
| `package.json` / `package-lock.json` | ./capture export, jsdom devDep, lockfile | ✓ VERIFIED | Exports map correct; no `dependencies` key; lockfile committed |

SDK `verify.artifacts`: 24/24 passed across all five plans.

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| oracle.test.js | harness.js | ESM import | ✓ WIRED | `from './harness.js'` (line 23) |
| harness.js | reference/extension/dom-stream.js | readFileSync + vm.runInContext | ✓ WIRED | harness.js:26 (URL resolve) — SDK pattern-escape false negative, verified by grep |
| harness.js | src/capture/index.js | createCapture import | ✓ WIRED | harness.js:22 + invoked at 233 |
| normalize.js | src/protocol/messages.js | STREAM import | ✓ WIRED | normalize.js:8; zero `'ext:` literals in file |
| src/capture/index.js | src/protocol/constants.js | imported constants | ✓ WIRED | index.js:46 (8 constants, never redefined) |
| src/capture/index.js | src/protocol/messages.js | STREAM/NID_ATTR/createStreamSessionId | ✓ WIRED | index.js:47; zero `data-fsb-nid` literals (NID_ATTR used); `fsb-dialog` wire-adjacent literals preserved |
| package.json | src/capture/index.js | exports map | ✓ WIRED | `"./capture"` entry; self-reference import executed successfully |
| package.json | tests/differential/oracle.test.js | test glob | ✓ WIRED (intentional deviation) | Plan pattern `tests/**/*.test.js` superseded by review-fix CR-01 (`9db86b2`): `node --test tests/*.test.js tests/differential/*.test.js` for Node 20/22/24 portability. Intent (oracle runs under npm test) proven by the 50-test run |
| oracle.test.js | divergence-ledger.js | DIVERGENCES + stale-entry assertion | ✓ WIRED | Imported and consulted per flipped pair; matched-id Set accumulated |
| capture test files | src/capture/index.js | createCapture import | ✓ WIRED | All four files import and exercise the factory |
| harness.js | Element.prototype.getBoundingClientRect | patchRects config | ✓ WIRED | data-test-top rect patch through the shared factory |
| generate-truncation-overflow.js | src/protocol/constants.js | SNAPSHOT_BUDGET_BYTES | ✓ WIRED | Import present; sizing derived from it |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| Oracle flipped pairs | refStream/extStream | Real capture executions (vm-hosted reference / globalThis-hosted extracted core) on frozen fixtures | Yes — non-triviality asserted (length >= 3 both sides); guards prove truncation/dialog payloads are real, not identical-but-empty | ✓ FLOWING |
| Loopback transport `sent` | {type, payload} records | `safeSend` → `transport.send` in extracted core | Yes — 50/50 assertions consume actual payload fields (html, mutations, identity) | ✓ FLOWING |
| Watchdog rescue message | staleFlushCount | Real watchdog tick under fake clock | Yes — asserted === 1 with the stuck op present | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Full suite green | `npm test` | 50 tests, 50 pass, 0 fail, 12.2s | ✓ PASS |
| Bare-Node import + factory validation | `node -e "import('./src/capture/index.js')..."` | createCapture: function; throws `transport-send-required` on missing transport | ✓ PASS |
| Package subpath resolution | `import('@fullselfbrowsing/phantom-stream/capture')` | createCapture: function | ✓ PASS |
| Generator determinism | Run twice + sha-256 compare | Identical hash `f5acb875...` both runs | ✓ PASS |
| Reference frozen | `git diff --exit-code -- reference/extension/dom-stream.js` | exit 0 — byte-identical | ✓ PASS |
| Oracle-first git ordering | `git merge-base --is-ancestor d0529d8 0a95bab` (and 8945d08) | Both oracle commits are ancestors of the extraction commit | ✓ PASS |
| Watchdog wall time | `time node --test tests/capture-watchdog.test.js` | 1.68s (< 5s bar) | ✓ PASS |
| CI matrix run on GitHub | `gh run list` | Empty — branch never pushed | ? SKIP → human item |

### Probe Execution

No `scripts/*/tests/probe-*.sh` probes exist in this repository and no plan declares probe-based verification. Step 7c: SKIPPED (no probes declared or discovered).

### Requirements Coverage

| Requirement | Source Plan(s) | Description | Status | Evidence |
|-------------|----------------|-------------|--------|----------|
| CAPT-01 | 01-03, 01-04 | Injected Transport, zero chrome.runtime/window.FSB | ✓ SATISFIED | Purity gate green in suite/CI; Transport seam at all 8 send sites; loopback proof across full flipped matrix |
| CAPT-02 | 01-03, 01-05 | start/stop/pause/resume with fresh-session semantics | ✓ SATISFIED | Lifecycle API in index.js; 5 pinning tests green (fresh-session + D-06 resume override) |
| CAPT-03 | 01-05 | Reliability defenses preserved | ✓ SATISFIED | Defense mechanics ported verbatim; 4 dedicated enforcement tests green (rAF, watchdog, identity, single-pass truncation) |
| CAPT-04 | 01-01, 01-02, 01-04 | Differential harness on frozen fixtures + divergence ledger | ✓ SATISFIED | Dual-mode oracle, 5-fixture corpus, 7 scenarios, 10-pair matrix, D1-D5 ledger, stale-entry detection |

No orphaned requirements: REQUIREMENTS.md maps exactly CAPT-01..04 to Phase 1, and all four are claimed across plan frontmatter. (REQUIREMENTS.md checkboxes/traceability still read "Pending" — orchestrator bookkeeping deferred per SUMMARYs' "orchestrator owns shared-artifact writes" notes; informational, not a gap.)

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| — | — | No TBD/FIXME/XXX/TODO/HACK/PLACEHOLDER markers in any phase-modified file | — | "placeholder" matches in normalize.js/divergence-ledger.js are the SESSION_n/SNAPSHOT_n identity-canonicalization domain term, not stubs |

`DIVERGENCES = []` stub noted in 01-01/01-02 SUMMARYs was populated in 01-04 (D1-D5) — resolved.

### Human Verification Required

### 1. GitHub Actions CI matrix run

**Test:** Push the branch (or merge to main) and watch the `CI` workflow run on GitHub Actions.
**Expected:** All three matrix jobs (Node 20, 22, 24) pass: `npm ci` succeeds from the committed lockfile, `npm test` reports 50/50 including the purity gate and differential oracle.
**Why human:** The workflow has never executed remotely — `gh run list` is empty and the branch has no upstream. Local verification covers Node 24 only. The review-fix CR-01 commit (`9db86b2`) changed the test script specifically for Node 20/22 portability, and only a real matrix run confirms it. SC2's "grep-enforced in CI" is structurally complete (purity test runs under `npm test`, which the workflow executes), so this item is confirmation of the external service, not a missing artifact.

### Gaps Summary

No gaps. All four ROADMAP success criteria and all 22 plan-level must-have truths are verified against the actual codebase with executed evidence (not SUMMARY claims): the 50/50 suite was run during verification, the generator determinism and git-ordering checks were re-executed, and the purity/lifecycle/defense/oracle assertions were read in source. The three user-locked overrides in 01-CONTEXT.md (jsdom oracle D-01, resume-no-resnapshot D-06, single-file extraction D-10) are honored exactly — D-06 is machine-recorded as ledger entry D1 and pinned by both the oracle and lifecycle tests. The post-execution review loop (CR-01, WR-01..03 across 2 fix iterations) closed `all_fixed` and its additions (skipElement containment + capture-skip.test.js, tightened D1 predicate, during-pause leak check) strengthen rather than alter the phase contract. The single remaining item is external: a first real GitHub Actions run on the Node 20/22/24 matrix.

---

_Verified: 2026-06-10T09:35:57Z_
_Verifier: Claude (gsd-verifier)_
