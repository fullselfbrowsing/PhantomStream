---
phase: 07-weakmap-node-identity-semantic-addressing-api
plan: 01
subsystem: capture
tags: [weakmap, node-identity, sidecar, differential-oracle, renderer-bridge]

requires:
  - phase: 06-extension-mv3-bookmarklet-adapters
    provides: adapter surfaces that consume capture/viewer identity payloads
provides:
  - WeakMap-backed capture node identity without live-page framework attributes
  - SnapshotPayload.nodeIds and add-op nodeIds sidecars
  - Capture getNodeId(element) API for live element to nid lookup
  - Differential oracle D8 normalization for identity markup removal
  - Transitional renderer sidecar-to-mirror-attribute bridge for existing diff paths
affects: [capture, protocol, renderer, differential-oracle, security-tests]

tech-stack:
  added: []
  patterns:
    - Closure-local WeakMap<Element,string> plus reverse Map<string,Element> capture identity mirror
    - Preorder nodeIds sidecars paired with serialized snapshot/add HTML
    - Narrow oracle normalization gated by matching sidecar nid sequence

key-files:
  created:
    - tests/capture-identity.test.js
  modified:
    - src/capture/index.js
    - src/protocol/messages.js
    - src/renderer/index.js
    - src/renderer/diff.js
    - tests/capture-skip.test.js
    - tests/security-mask.test.js
    - tests/security-sanitize-capture.test.js
    - tests/renderer-loopback.test.js
    - tests/differential/normalize.js
    - tests/differential/divergence-ledger.js

key-decisions:
  - "Capture identity is WeakMap-backed and page-owned data-fsb-nid remains ordinary page data."
  - "Identity sidecars use preorder nodeIds arrays for snapshots and add ops while preserving existing nid diff fields."
  - "A temporary renderer bridge stamps mirror DOM from sidecars so the existing selector-based renderer remains green until the renderer-index plan."

patterns-established:
  - "Capture getNodeId returns the active internal nid for tracked live elements and null for untracked or inactive nodes."
  - "Differential oracle removes reference identity markup only when extracted nodeIds exactly matches the reference preorder nid sequence."

requirements-completed: [CAPT-07, VIEW-03]

duration: 20min
completed: 2026-06-15
---

# Phase 07 Plan 01: WeakMap Capture Identity Sidecars Summary

**Capture identity now lives in an internal WeakMap mirror, with clean snapshot/add HTML and structured nodeIds sidecars preserving the nid-addressed wire contract.**

## Performance

- **Duration:** 20 min
- **Started:** 2026-06-15T15:47:31Z
- **Completed:** 2026-06-15T16:07:49Z
- **Tasks:** 3
- **Files modified:** 11

## Accomplishments

- Added RED coverage for no live-page identity mutation, page-owned `data-fsb-nid`, sidecars, move preservation, and `getNodeId`.
- Replaced capture-side identity stamping with WeakMap/Map mirror helpers and `nodeIds` sidecars.
- Updated oracle normalization and ledger D8 so identity markup removal is the only tolerated new divergence.
- Added a renderer compatibility bridge that stamps mirror DOM from sidecars, keeping the existing renderer selector path working until the planned Map-index migration.

## Task Commits

1. **Task 1: Add RED capture identity tests** - `0191783` (test)
2. **Task 2: Implement capture WeakMap mirror and nodeIds sidecars** - `596c888` (feat)
3. **Task 3: Preserve differential oracle discipline for identity markup removal** - `0621692` (test)
4. **Auto-fix: Renderer sidecar bridge for full-suite gate** - `6ceb11d` (fix)

## Files Created/Modified

- `tests/capture-identity.test.js` - New Phase 7 identity coverage for clean live DOM, sidecars, move preservation, and public capture lookup.
- `src/capture/index.js` - WeakMap-backed identity mirror, sidecar generation, mirror-aware diff fields, and `getNodeId`.
- `src/protocol/messages.js` - JSDoc contract for snapshot/add `nodeIds`.
- `tests/differential/normalize.js` - Narrow sidecar-aware comparison for reference identity markup removal.
- `tests/differential/divergence-ledger.js` - D8 documented mapping for WeakMap identity sidecars.
- `src/renderer/index.js` and `src/renderer/diff.js` - Transitional mirror-DOM stamping from sidecars for existing renderer diff lookup.
- Existing capture, masking, sanitize, and loopback tests - Migrated live identity assertions to `getNodeId` and sidecar checks.

## Decisions Made

- Capture no longer treats `data-fsb-nid` as framework-owned live-page identity; existing page attributes with that name are preserved as page data.
- `nodeIds` sidecars are ordered by final serialized element preorder so downstream consumers can rebuild identity indexes deterministically.
- The renderer bridge is intentionally transitional: it preserves current renderer behavior for this plan, while Plan 07-02 can replace selector lookup with an internal `Map<nid, Node>`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added renderer sidecar-to-attribute compatibility bridge**
- **Found during:** Plan-level `npm test` after Task 3
- **Issue:** Capture no longer emitted nid attributes in snapshot/add HTML, so existing renderer loopback tests and diff application could not resolve nodes by selector.
- **Fix:** Stamped mirror DOM from snapshot/add `nodeIds` inside the renderer only, and migrated affected tests to read live source ids through `capture.getNodeId`.
- **Files modified:** `src/renderer/index.js`, `src/renderer/diff.js`, `tests/renderer-loopback.test.js`, `tests/security-sanitize-capture.test.js`
- **Verification:** `node --test tests/renderer-loopback.test.js`, `node --test tests/security-sanitize-capture.test.js`, and `npm test`
- **Committed in:** `6ceb11d`

---

**Total deviations:** 1 auto-fixed (Rule 3).
**Impact on plan:** Required to satisfy the plan-level full-suite gate. The wire contract remains sidecar-based; only renderer-internal compatibility behavior was added.

## Issues Encountered

- `npm test` initially failed because the renderer had not yet consumed `nodeIds` sidecars. Fixed with the renderer bridge above.
- SDK config access normalized `.planning/config.json` by removing a duplicate root-level `branching_strategy` key; this is metadata-only and included in the final docs commit if still dirty.

## Authentication Gates

None.

## Known Stubs

None. Stub-pattern scan hits were test arrays/null resets and intentional blocked-subtree privacy placeholder terminology.

## Threat Flags

None. No new network endpoint, auth path, file access pattern, or schema boundary was introduced.

## Verification

- `node --test tests/capture-identity.test.js tests/capture-lifecycle.test.js tests/capture-skip.test.js tests/security-mask.test.js` - PASS
- `node --test tests/differential/oracle.test.js tests/capture-identity.test.js` - PASS
- `npm test` - PASS

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Plan 07-02 can build the renderer `Map<nid, Node>` index using the sidecars landed here. The temporary mirror-DOM stamping bridge keeps existing renderer behavior stable until that migration removes the selector hot path.

## Self-Check: PASSED

- Verified created/modified key files exist.
- Verified task and auto-fix commits exist in git history: `0191783`, `596c888`, `0621692`, `6ceb11d`.

---
*Phase: 07-weakmap-node-identity-semantic-addressing-api*
*Completed: 2026-06-15*
