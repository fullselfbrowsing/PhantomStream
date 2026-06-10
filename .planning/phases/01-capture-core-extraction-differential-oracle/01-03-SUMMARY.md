---
phase: 01-capture-core-extraction-differential-oracle
plan: 03
subsystem: capture
tags: [capture-core, extraction, transport-seam, purity, parity]

# Dependency graph
requires:
  - phase: 01-capture-core-extraction-differential-oracle
    plan: 02
    provides: Frozen fixture corpus + 10-pair ref-vs-ref oracle matrix green (D-09 gate satisfied before extraction)
provides:
  - Single-file capture core src/capture/index.js -- createCapture({transport, logger, overlayProvider, skipElement}) -> {start, stop, pause, resume}
  - All 8 reference send sites routed through the injected Transport seam; transport errors never propagate into the capture path (D-07)
  - resume() continues the same session without re-snapshot (D-06 user override -- ledger entry D1 lands in Plan 01-04)
  - Purity static-scan gate (tests/capture-purity.test.js) green and running under npm test / CI
  - "./capture package subpath export alongside ./protocol"
affects: [01-04 oracle-flip-ledger-entries, 01-05 defense-tests, phase-6 fsb-adapter]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Injected Transport seam (send required + validated at factory time; flush optional with typeof-guarded no-op default) mirroring the LZCodec injection pattern in src/protocol/envelope.js
    - safeSend wrapper -- synchronous try/catch plus rejection handler on any returned promise, errors to injected logger, capture path never throws after start
    - Reference module-level vars become per-createCapture closure state so two captures coexist in the oracle process
    - Zero DOM access at module top level -- ambient window/document dereferenced only inside createCapture and the functions it builds (bare-Node import is side-effect free)
    - Purity gate strips line AND block comments before the chrome./FSB regexes so provenance comments stay legal, with a file-count >= 1 assertion preventing vacuous pass

key-files:
  created:
    - src/capture/index.js
    - tests/capture-purity.test.js
  modified:
    - package.json

key-decisions:
  - "transport.flush (no-op default) is invoked once at the end of stop() -- the only deterministic drain point the core can offer buffering hosts; wire-invisible with the default no-op"
  - "resume() re-arms observers + scroll tracker ONLY (no overlay broadcast, no snapshot, no new session) per the plan's literal 'ONLY' wording -- keeps the D1 ledger entry minimal for the 01-04 oracle flip"
  - "Serializer clone-side overlay filtering collapsed into a single skipElement(cl) -> toRemove branch (reference had separate hasAttribute/closest branches); end state identical, and byte-identical behavior with the default false predicate"
  - "dataset.fsbNid camelCase accessors kept verbatim (parity); only the ~14 'data-fsb-nid' string literals were replaced by the NID_ATTR import"

patterns-established:
  - "Capture options surface: { transport (required), logger, overlayProvider, skipElement } all defaulted via var + || / typeof guards (cross-runtime convention)"
  - "Factory-time validation may throw plain Error with lowercase-hyphenated message ('transport-send-required'); the capture path after start never throws"

requirements-completed: [CAPT-01, CAPT-02]

# Metrics
duration: 15min
completed: 2026-06-10
---

# Phase 1 Plan 03: Capture Core Extraction Summary

**Single-file extraction of the 1,117-line FSB reference capture into src/capture/index.js behind injected transport/logger/overlayProvider/skipElement seams, with a comment-stripping purity gate green under npm test and the ./capture subpath exported -- full suite 23/23 with reference and oracle harness byte-untouched**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-06-10T04:13:06Z
- **Completed:** 2026-06-10T04:27:44Z
- **Tasks:** 2 (Task 1 = RED purity gate, Task 2 = GREEN extraction)
- **Files modified:** 3

## Accomplishments

- `createCapture({transport, logger, overlayProvider, skipElement})` returns exactly `{start, stop, pause, resume}` (D-05); all reference module state is per-factory closure state so two captures can coexist in the oracle process
- The purity gate (CAPT-01 enforcement half, D-13) is green and structurally non-vacuous: comment-stripped scan of every `src/capture/*.js` for `\bchrome\s*\.` and `window\.FSB|\bFSB\b`, plus a file-count assertion that failed RED before the extraction existed
- Every reliability defense ported verbatim (CAPT-03 mechanics): rAF-batched mutation flushing, the self-re-arming setTimeout-chain watchdog (stale threshold/tick from imported constants, staleFlushCount incremented BEFORE the forced flush, tick body in try/catch), single-pass TreeWalker rect Map, 2-pass budgeted truncation against imported SNAPSHOT_BUDGET_BYTES with the chars-as-bytes quirk preserved, dialog interceptor with byte-identical `fsb-dialog`/`fsb-dialog-dismiss`/`fsb-dialog-interceptor` wire-adjacent names
- Parity traps preserved exactly: stop-path final mutation flush omits `staleFlushCount` while the normal flush includes it; on* stripping stays confined to html/body shells (threat T-01-03 accepted per D-11); javascript: URLs still pass through absolutifyUrl
- Functional smoke in jsdom (uncommitted sanity run): factory throws `transport-send-required`, READY emitted at factory creation, snapshot html nid-stamped and style-inlined, attr/add diff ops flow with `staleFlushCount: 0`, resume emits no snapshot and continues the same `streamSessionId`, dialog relay stamps identity, a throwing transport never breaks the capture path, process exits cleanly after stop()
- Bare-Node import smoke passes: no DOM access at module top level; `./capture` subpath resolves in the exports map
- Full suite 23/23 (8 protocol + 13 oracle + 2 purity); `git diff` on `reference/` and `tests/differential/` is empty -- the extraction landed without touching the spec or the harness

## Task Commits

Each task was committed atomically:

1. **Task 1: Purity gate first (RED)** - `498e219` (test)
2. **Task 2: Single-file extraction behind the Transport seam (GREEN)** - `0a95bab` (feat)

_No REFACTOR commit: the GREEN extraction needed no cleanup pass._

## TDD Gate Compliance

Task 1 (`tdd="true"`) followed the gate sequence: `test(01-03)` commit `498e219` (RED -- "capture core exists" failed with a message naming src/capture, exit non-zero, the purity scan itself guarded against vacuous pass) precedes `feat(01-03)` commit `0a95bab` (GREEN -- purity gate passes against the extracted core, 23/23 full suite).

## Files Created/Modified

- `src/capture/index.js` - Single-file capture core (1,181 lines): module-level imports + URL_ATTRS/STYLE_DEFAULTS/CURATED_PROPS/SHELL_PROPS verbatim copies + Transport/CaptureOptions/CaptureHandle JSDoc typedefs; createCapture factory holding all state and functions (dialog interceptor, serializer, mutation streaming, scroll tracker, overlay broadcaster, lifecycle API); READY ping once at factory creation (ledger D3); readiness probe and host-requested overlay rebroadcast dropped (ledger D4/D5 territory, reintroduced host-side in Phase 6)
- `tests/capture-purity.test.js` - Static-scan purity gate: cwd-independent path resolution via import.meta.url, comment stripping before both regexes, per-file failure messages, file-count >= 1 non-vacuity assertion
- `package.json` - `"./capture": "./src/capture/index.js"` added to exports, mirroring the `./protocol` entry shape

## Decisions Made

- **flush() call point = end of stop():** the plan defined the optional flush contract but no call site; stop() is the only deterministic drain moment the core owns. Wire-invisible with the no-op default and with every loopback/oracle transport (none define flush)
- **resume() does NOT broadcast overlay state:** the plan's "re-arm observers + scroll tracker ONLY" was followed literally; emitting an overlay message on resume would add a third wire difference for the D1 ledger entry to cover in 01-04. resume() also re-asserts `streaming = true` (state-consistent, wire-invisible)
- **Resume log string drops the reference's "-- sending fresh snapshot" suffix** since the extracted resume intentionally does not send one; all other '[DOM Stream] ...' log strings are byte-identical for trace-diffing
- **Clone-side skip filtering = single skipElement(cl) -> toRemove branch:** the reference's separate hasAttribute (remove) / closest (skip, parent removed) branches collapse into one predicate call per the plan's "pass the clone element to skipElement"; a faithful host predicate handles containment itself (as the reference's isFsbOverlay did via closest), and with the default false predicate the serializer output is byte-identical to the reference on overlay-free pages
- **RELAY_PER_MESSAGE_LIMIT_BYTES imported per the plan's never-redefine list** though only SNAPSHOT_BUDGET_BYTES is consumed; a `void` reference plus provenance comment marks the import as intentional (keeps the capture/relay cap relationship documented at the use site)

## Deviations from Plan

None - plan executed exactly as written. (The four implementation choices above fall inside the plan's explicit task spec or its discretionary gaps; no scope, behavior, or file-set changes.)

## Known Stubs

None. The overlayProvider default (null -> `{glow: null, progress: null}` on the wire) is reference parity for an overlay-free host, not a stub -- the oracle verifies it in Plan 01-04 (RESEARCH assumption A3).

## Issues Encountered

None -- the seam map in 01-PATTERNS.md and the verified recipes from 01-RESEARCH.md were sufficient; the functional smoke passed on the first run.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Plan 01-04 can flip the oracle's side B to `createCapture` and add ledger entries: D1 (resume-no-resnapshot, carried by pause-resume.js), D2 (envelope mapping -- already handled by the normalizer's fixed table), D3 (READY at factory creation vs script load), D4/D5 (readiness probe + host-requested overlay rebroadcast dropped)
- Plan 01-05 has the lifecycle/defense surface ready: loopback transport exercises the optional-flush default path; the watchdog fake-Date recipe applies to the extracted side via globalThis swap
- CAPT-01/CAPT-02 enforcement and lifecycle semantics are in place; the equivalence proof that completes them lands with the 01-04 oracle flip (REQUIREMENTS.md untouched -- orchestrator owns shared-artifact writes post-wave)

## Self-Check: PASSED

- All 3 created/modified files verified present on disk
- Both task commits verified in git log (498e219, 0a95bab)
- npm test: 23/23 green; purity gate green; bare-Node import smoke OK; exports-map check OK
- Acceptance greps: protocol imports present; zero `data-fsb-nid` literals; `fsb-dialog`/`fsb-dialog-interceptor` literals present; zero setInterval; zero chrome./FSB after comment strip; reference/ and tests/differential/ diffs empty

---
*Phase: 01-capture-core-extraction-differential-oracle*
*Completed: 2026-06-10*
