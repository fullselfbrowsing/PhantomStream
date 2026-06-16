---
phase: 07-weakmap-node-identity-semantic-addressing-api
plan: 02
subsystem: renderer
tags: [weakmap, node-identity, renderer-index, sidecar, overlays]

requires:
  - phase: 07-weakmap-node-identity-semantic-addressing-api
    provides: capture-side WeakMap nodeIds sidecars from Plan 07-01
provides:
  - Renderer Map<nid, Node> identity index rebuilt from snapshot nodeIds
  - Diff application through injected identity hooks with add/remove index maintenance
  - Overlay nid anchoring through the same renderer index
  - Static regression gate against retired identity querySelector hot paths
affects: [renderer, overlays, renderer-loopback, renderer-health, security-tests]

tech-stack:
  added: []
  patterns:
    - Closure-local Map<nid, Node> plus WeakMap<Node, nid> viewer identity index
    - Diff applier receives identity hooks instead of owning identity lookup
    - jsdom srcdoc glue re-fires load so post-parse sanitize and identity indexing run together

key-files:
  created:
    - tests/node-identity-static.test.js
  modified:
    - src/renderer/index.js
    - src/renderer/diff.js
    - tests/renderer-diff.test.js
    - tests/renderer-overlays.test.js
    - tests/renderer-health-events.test.js
    - tests/renderer-loopback.test.js
    - tests/security-sanitize-render.test.js

key-decisions:
  - "Renderer identity is owned by createViewer and rebuilt from nodeIds after post-parse sanitization."
  - "applyMutations has no nid selector fallback; callers must inject identity hooks for nid-addressed ops."
  - "Viewer tests now inspect normal page ids or sidecar metadata instead of mirror data-fsb-nid attributes."

patterns-established:
  - "Identity hooks expose resolve, indexSubtree, and removeSubtree; diff.js remains document-parameterized."
  - "Snapshot/add sidecar mismatches warn with content-free renderer diagnostics and pair only available ids."

requirements-completed: [VIEW-03, CAPT-07]

duration: 14min
completed: 2026-06-15
---

# Phase 07 Plan 02: Renderer Identity Index Summary

**Renderer diff and overlay nid resolution now use an internal sidecar-built identity index instead of DOM identity selectors.**

## Performance

- **Duration:** 14 min
- **Started:** 2026-06-15T16:10:29Z
- **Completed:** 2026-06-15T16:24:20Z
- **Tasks:** 3
- **Files modified:** 8

## Accomplishments

- Added RED coverage for sidecar-only renderer diff fixtures, viewer overlay nid anchors, and static no-selector enforcement.
- Added `nidToNode` / `nodeToNid` lifecycle in `createViewer`, rebuilt after snapshot post-parse sanitization and maintained on add/remove ops.
- Removed the diff applier's selector fallback; `applyMutations` resolves all nid-addressed ops through injected identity hooks.
- Migrated renderer integration and sanitizer tests that still assumed mirror `data-fsb-nid` attributes.

## Task Commits

1. **Task 1: Add RED renderer index and static hot-path tests** - `89ac8bb` (test)
2. **Task 2: Implement renderer identity index lifecycle** - `2baeff5` (feat)
3. **Task 3: Refactor diff applier to indexed resolution** - `139a098` (refactor)
4. **Auto-fix: Migrate full-suite renderer tests to sidecar index** - `f41c57d` (test)

## Files Created/Modified

- `tests/node-identity-static.test.js` - Static regression gate for retired renderer identity selectors.
- `src/renderer/index.js` - Viewer-owned identity index, sidecar mismatch diagnostics, overlay resolver, and diff identity hooks.
- `src/renderer/diff.js` - Hook-based nid resolution and add/remove index maintenance.
- `tests/renderer-diff.test.js` - Sidecar-only diff fixtures and identity-hook assertions.
- `tests/renderer-overlays.test.js` - Viewer overlay nid anchor regression through `nodeIds`.
- `tests/renderer-health-events.test.js` - Health tests updated to sidecar-indexed snapshots.
- `tests/renderer-loopback.test.js` - Loopback glue and assertions migrated away from mirror identity attributes.
- `tests/security-sanitize-render.test.js` - Direct diff sanitizer tests now inject identity hooks.

## Decisions Made

- Index rebuild happens after render-side sanitization, so only nodes that actually enter the mirror document are addressable.
- Missing or extra sidecar ids log `[Renderer] identity sidecar mismatch` and index the pairs that can be safely matched.
- Direct `applyMutations` callers without identity hooks resolve no nids; tests that exercise real ops now inject identity explicitly.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Migrated full-suite renderer tests off mirror nid attributes**
- **Found during:** Plan-level `npm test` after Task 3
- **Issue:** Legacy renderer integration and sanitizer tests still expected `data-fsb-nid` in mirror DOM or direct selector fallback behavior, blocking the full-suite gate after the selector path was removed.
- **Fix:** Updated jsdom srcdoc glue to re-fire load for index rebuilds, changed loopback/health assertions to use sidecars and page ids, and injected identity hooks into direct sanitizer diff tests.
- **Files modified:** `tests/renderer-health-events.test.js`, `tests/renderer-loopback.test.js`, `tests/security-sanitize-render.test.js`
- **Verification:** `node --test tests/renderer-health-events.test.js tests/renderer-loopback.test.js tests/security-sanitize-render.test.js`; `npm test`
- **Committed in:** `f41c57d`

---

**Total deviations:** 1 auto-fixed (Rule 3).
**Impact on plan:** No scope expansion beyond required verification compatibility. The implementation remains sidecar/index based.

## Issues Encountered

- Task 3 acceptance required the literal `hooks.identity` marker; the implementation normalized `hooks` to `opts`, so a small source comment was added at the normalization site.
- Full-suite tests exposed residual assumptions from the transitional 07-01 renderer bridge; fixed as the Rule 3 deviation above.

## Authentication Gates

None.

## Known Stubs

None. Stub-pattern scan hits were intentional null resets, empty test arrays, and established placeholder wording in comments.

## Threat Flags

None. No new production network endpoint, auth path, file access path, or schema boundary was introduced.

## Verification

- `set +e; node --test tests/renderer-diff.test.js tests/renderer-overlays.test.js tests/node-identity-static.test.js; code=$?; test "$code" -ne 0` - PASS (RED failed as expected)
- `node --test tests/renderer-diff.test.js tests/renderer-overlays.test.js tests/renderer-viewer.test.js` - PASS
- `node --test tests/renderer-diff.test.js tests/node-identity-static.test.js` - PASS
- `node --test tests/renderer-diff.test.js tests/renderer-overlays.test.js tests/renderer-viewer.test.js tests/node-identity-static.test.js` - PASS
- `npm test` - PASS

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Plan 07-03 can add the public semantic addressing/highlight API on top of `resolveIndexedNode` without reintroducing DOM selector identity lookup.

## Self-Check: PASSED

- Verified created files exist: `07-02-SUMMARY.md`, `tests/node-identity-static.test.js`.
- Verified commits exist in git history: `89ac8bb`, `2baeff5`, `139a098`, `f41c57d`.

---
*Phase: 07-weakmap-node-identity-semantic-addressing-api*
*Completed: 2026-06-15*
