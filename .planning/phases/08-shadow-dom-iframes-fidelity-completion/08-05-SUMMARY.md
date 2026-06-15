---
phase: 08-shadow-dom-iframes-fidelity-completion
plan: 05
subsystem: capture-renderer
tags: [iframes, same-origin, cross-origin, srcdoc, node-test, jsdom, sanitizer, weakmap-identity]

requires:
  - phase: 07-weakmap-node-identity-semantic-addressing-api
    provides: WeakMap capture identity, nodeIds sidecars, and renderer private nid index
  - phase: 08-shadow-dom-iframes-fidelity-completion
    provides: Phase 8 shadow-root sidecar and observed-root patterns from Plan 08-04
provides:
  - Same-origin iframe serialization as scoped frames[] sidecars keyed by frameNid
  - Same-origin iframe document observation for live frame mutations and Plan 08-06 value-listener roots
  - Cross-origin iframe content-free capture metadata and renderer labels
  - Renderer reconstruction of same-origin iframe payloads as inert nested srcdoc documents
  - Add-op frame payload installation through the renderer identity hook
affects: [CAPT-09, 08-06-value-listeners, 08-07-subtree-recovery, renderer-identity]

tech-stack:
  added: []
  patterns:
    - Frame-nid-tied frames[] sidecars
    - Same-origin frame document observation through existing MutationObserver batching
    - Renderer nested iframe srcdoc reconstruction with sandbox allow-same-origin only

key-files:
  created:
    - .planning/phases/08-shadow-dom-iframes-fidelity-completion/08-05-SUMMARY.md
  modified:
    - src/capture/index.js
    - src/renderer/index.js
    - src/renderer/snapshot.js
    - src/renderer/diff.js
    - tests/capture-iframe.test.js
    - tests/renderer-iframe.test.js
    - tests/capture-input-values.test.js

key-decisions:
  - "Cross-origin iframe payloads remain content-free: only label, safe src, and parsed origin are transported."
  - "Same-origin iframe documents are observed roots whose live mutations carry frameNid rather than selector scope."
  - "Renderer frame installation uses the private nid index and add-op identity hook, not selector lookup."

patterns-established:
  - "collectFramePayloads mirrors the shadowRoots sidecar pattern for iframe hosts and nested frame payloads."
  - "installFrames resolves iframe hosts by frameNid and installs same-origin content through buildSnapshotHtml srcdoc."
  - "getObservedFrameDocuments exposes registered frame document roots for Plan 08-06 value listeners."

requirements-completed: [CAPT-09]

duration: 14min
completed: 2026-06-15
---

# Phase 08 Plan 05: Iframe Fidelity Summary

**Same-origin iframe mirroring with frameNid-scoped sidecars, observed frame roots, and inert renderer srcdoc reconstruction**

## Performance

- **Duration:** 14 min
- **Started:** 2026-06-15T19:03:16Z
- **Completed:** 2026-06-15T19:17:38Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments

- Added capture-side `frames[]` payloads for same-origin iframe documents, including frame descendant `nodeIds`, styles, shell attributes, and frame identity.
- Added cross-origin iframe capture classification that uses `contentDocument` as the only origin gate and emits content-free label/src/origin metadata.
- Registered same-origin iframe documents as observed roots at stream start, iframe add, and iframe load so live frame mutations emit `frameNid`.
- Added renderer-side `installFrames` support for snapshot and add-op payloads, reconstructing same-origin frames as sandboxed `srcdoc` mirrors and cross-origin frames as inert labels.

## Task Commits

Each task was committed atomically:

1. **Task 1 RED: Capture same-origin frames and safe cross-origin labels** - `47c8dd8` (test)
2. **Task 1 GREEN: Capture same-origin frames and safe cross-origin labels** - `6213b4d` (feat)
3. **Task 2 RED: Reconstruct inert frame payloads in the renderer** - `100faf5` (test)
4. **Task 2 GREEN: Reconstruct inert frame payloads in the renderer** - `0eb3797` (feat)

Plan metadata is committed separately with this summary.

## Files Created/Modified

- `src/capture/index.js` - Frame classification, same-origin frame serialization, frame document observation/load lifecycle, and frameNid-scoped mutation emission.
- `src/renderer/index.js` - Frame payload installation, nested frame load indexing, and add-op frame hook wiring.
- `src/renderer/snapshot.js` - `buildFramePlaceholderHtml` for cross-origin content-free labels using existing CSP discipline.
- `src/renderer/diff.js` - Existing identity hook extended to install add-op frame sidecars after imported subtree indexing.
- `tests/capture-iframe.test.js` - CAPT-09 capture tests for frame payloads, cross-origin non-leakage, add-op sidecars, live frame mutations, and load re-registration.
- `tests/renderer-iframe.test.js` - Renderer tests for inert same-origin srcdoc, cross-origin labels, and add-op frame installation.
- `tests/capture-input-values.test.js` - TODO contract documenting the Plan 08-06 frame-root value listener handoff.

## Decisions Made

- Kept same-origin iframe content out of the main `html` shell. The iframe host remains in the shell, but content travels only through `frames[]`.
- Used `sandbox="allow-same-origin"` for nested frame mirrors and did not add `allow-scripts`.
- Exposed frame roots through `getObservedFrameDocuments()` rather than pre-implementing Plan 08-06 value diff behavior.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Avoided live iframe `src` mutation before frame classification**
- **Found during:** Task 1 verification
- **Issue:** The add-op serializer inherited live URL absolutification, which could reset a newly added same-origin iframe document before `classifyFrame()` read `contentDocument`.
- **Fix:** Skipped live `src` mutation for iframe elements and kept `src` only as safe frame metadata or detached wire output.
- **Files modified:** `src/capture/index.js`
- **Verification:** `node --test tests/capture-iframe.test.js`
- **Committed in:** `6213b4d`

**2. [Rule 1 - Bug] Assigned frame document identity during load registration**
- **Found during:** Task 1 verification
- **Issue:** A same-origin iframe document observed after `load` had no Phase 7 ids for existing parent elements, so subsequent child mutations could lack a `parentNid`.
- **Fix:** `registerFrameDocument()` now serializes the accessible frame document for identity assignment before observing it.
- **Files modified:** `src/capture/index.js`
- **Verification:** `node --test tests/capture-iframe.test.js`
- **Committed in:** `6213b4d`

**3. [Rule 1 - Bug] Prevented skipped host UI iframes from becoming observed frame roots**
- **Found during:** Task 2 verification
- **Issue:** Loopback tests showed the capture side observing the viewer iframe inside skipped host UI, which reintroduced recursion noise.
- **Fix:** `collectFramePayloads()` and `observeSameOriginFrameDocuments()` now honor `skipElement`, `blockSelector`, and wire-drop ancestry before frame classification/observation.
- **Files modified:** `src/capture/index.js`
- **Verification:** `node --test --test-name-pattern "mixed-content|stale-miss" tests/renderer-loopback.test.js`
- **Committed in:** `6213b4d`

**Total deviations:** 3 auto-fixed (3 Rule 1 bugs).
**Impact on plan:** All fixes were required for the planned CAPT-09 behavior and did not add feature scope.

## Issues Encountered

- The renderer add-op path needed a small extension to the existing `diff.js` identity hook so frame sidecars install after a newly inserted iframe host is indexed. This followed the plan instruction to extend the existing hook object rather than adding selector lookup.

## Verification

```bash
node --test tests/capture-iframe.test.js tests/security-sanitize-capture.test.js
node --test tests/renderer-iframe.test.js tests/security-sanitize-render.test.js tests/renderer-loopback.test.js
node --test tests/capture-iframe.test.js tests/renderer-iframe.test.js tests/security-sanitize-capture.test.js tests/security-sanitize-render.test.js tests/renderer-loopback.test.js
rg -n "classifyFrame|serializeFrameDocument|collectFramePayloads|registerFrameDocument|observeSameOriginFrameDocuments|observedFrameDocuments|contentDocument|cross-origin" src/capture/index.js
rg -n "frameNid|same-origin iframe.*mutation|iframe.*load|frame document" tests/capture-iframe.test.js tests/capture-input-values.test.js
rg -n "installFrames|buildSnapshotHtml|Cross-origin iframe|allow-scripts|frameNid" src/renderer/index.js src/renderer/snapshot.js
rg -n "allow-scripts" src/renderer/index.js src/renderer/snapshot.js || true
```

Results:

- Task 1 focused gate passed: 26 tests, 26 pass.
- Task 2 focused gate passed: 37 tests, 37 pass.
- Plan-level verification passed: 63 tests, 63 pass.
- Required implementation greps returned matches.
- Renderer `allow-scripts` grep returned no matches.

## Known Stubs

None. Stub scan hits were intentional empty/default test fixtures, existing null lifecycle state, and explicit cross-origin placeholder wording.

## Threat Flags

None. New frame capture, observation, metadata labeling, srcdoc reconstruction, and renderer identity-indexing surfaces are covered by `T-08-17` through `T-08-20`.

## Auth Gates

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Plan 08-06 can attach input/change listeners to `getObservedFrameDocuments()` roots and can rely on same-origin iframe mutations already carrying `frameNid`. Plan 08-07 can reuse the frame sidecar identity pattern for subtree recovery.

## Orchestrator-Owned State

Per execution prompt, `.planning/STATE.md` and `.planning/ROADMAP.md` were not modified.

## Self-Check: PASSED

- Found `.planning/phases/08-shadow-dom-iframes-fidelity-completion/08-05-SUMMARY.md`.
- Found task commits `47c8dd8`, `6213b4d`, `100faf5`, and `0eb3797` in git history.
- Confirmed `.planning/STATE.md` and `.planning/ROADMAP.md` have no working-tree diffs.

---
*Phase: 08-shadow-dom-iframes-fidelity-completion*
*Completed: 2026-06-15*
