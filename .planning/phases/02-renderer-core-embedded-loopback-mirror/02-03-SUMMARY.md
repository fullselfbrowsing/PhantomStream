---
phase: 02-renderer-core-embedded-loopback-mirror
plan: 03
subsystem: renderer
tags: [renderer, viewer, factory, sandbox, scale-to-fit, resync, purity-gate, view-01, view-06]

# Dependency graph
requires:
  - phase: 02-renderer-core-embedded-loopback-mirror
    provides: "02-01: buildSnapshotHtml (pure srcdoc builder) and applyMutations (Document-parameterized applier with counters/thresholds)"
  - phase: 02-renderer-core-embedded-loopback-mirror
    provides: "02-02: createOverlays (layer + kind registry + parity built-ins), mapRectToHost, OVERLAY_CSS"
  - phase: 01-capture-core-extraction-differential-oracle
    provides: "src/protocol/messages.js (STREAM, CONTROL, NID_ATTR, isCurrentStream)"
provides:
  - "createViewer({ container, transport, logger? }) — auto-attaching embeddable viewer returning { detach, destroy, registerOverlay }"
  - "Creation-time sandbox assertion: iframe sandbox is exactly allow-same-origin or the factory throws 'viewer-sandbox-invalid' (phase criterion 3)"
  - "Transport dispatch for SNAPSHOT/MUTATIONS/SCROLL/OVERLAY/DIALOG with isCurrentStream gating and the waiting|streaming state gate"
  - "Latched CONTROL.START resync path (trigger 'preview-resync'); latch released only by the next snapshot"
  - "Pure computeScale(pageW, pageH, containerW, containerH) + iframe geometry application (UI-SPEC formula)"
  - "Renderer purity gate (tests/renderer-purity.test.js) — six forbidden patterns, comment-stripped scan, module-split pin"
  - "Barrel re-exports: snapshot.js, diff.js, overlays.js surfaces through src/renderer/index.js"
affects: [02-04 renderer README divergence ledger, 02-05 loopback demo, 02-06 demo verification, phase-4 WS transport]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "ViewerTransport seam: { send(type, payload), onMessage(handler) -> unsubscribe } — Phase 4's WS transport implements the same interface"
    - "Creation-time persistent iframe load listener keyed off the pending snapshot payload (jsdom-compatible replacement for per-snapshot onload reassignment)"
    - "contentDocument read FRESH per handler call (never cached) — re-snapshots replace the document"

key-files:
  created:
    - src/renderer/index.js
    - tests/renderer-viewer.test.js
    - tests/renderer-purity.test.js
  modified: []

key-decisions:
  - "Snapshot-load completion runs through ONE persistent load listener attached before iframe insertion, not per-snapshot iframe.onload — jsdom 29 (verified empirically) only queues the iframe's initial about:blank load when a listener exists at insertion time and never re-fires load on srcdoc writes; browsers behave identically through the persistent listener"
  - "Dialog identity-nesting quirk ported as-is (Pitfall 8): top-level isCurrentStream check passes because capture nests identity inside payload.dialog — explicit parity choice, commented in code, ledger entry lands in plan 02-04"
  - "viewerState stays 'streaming' across re-snapshots (reference parity): mutations carrying the new identity apply immediately after a second srcdoc write without waiting for onload"
  - "resolveNidRect contains selector/teardown errors to logger.warn + null so a malformed nid can never break the overlay kind loop (resolveAnchorRect runs outside safeRenderOverlay)"

patterns-established:
  - "Factory-time validation is the only throwing site ('viewer-container-required', 'viewer-transport-required', 'viewer-sandbox-invalid'); everything after creation routes to the injected logger"
  - "Purity gates pin the module split (anti-vacuous guard asserts index/snapshot/diff/overlays all present)"

requirements-completed: [VIEW-01, VIEW-06]

# Metrics
duration: ~16min
completed: 2026-06-11
---

# Phase 2 Plan 03: createViewer Factory + Renderer Purity Gate Summary

**Auto-attaching embeddable viewer factory wiring snapshot/diff/overlays into a sandbox-asserted (allow-same-origin only), scale-to-fit, self-healing mirror with the locked { detach, destroy, registerOverlay } handle, pinned by 19 viewer tests plus a six-pattern purity gate.**

## Performance

- **Duration:** ~16 min
- **Started:** 2026-06-11T17:18:39Z
- **Completed:** 2026-06-11T17:34:36Z
- **Tasks:** 2/2
- **Files modified:** 3 created

## Accomplishments

- `createViewer({ container, transport })` auto-attaches the viewer root (stamped `data-phantomstream-ui="viewer"` — the loopback recursion-guard marker), the OVERLAY_CSS style element, the sandboxed mirror iframe (title "PhantomStream live mirror", hidden until first snapshot load), and the plan-02-02 overlay layer; returns exactly `{ detach, destroy, registerOverlay }`
- **Phase criterion 3 satisfied and test-pinned:** the iframe sandbox is set to `allow-same-origin`, read back, tokenized, and asserted — anything else throws `viewer-sandbox-invalid` at creation; the test pins the token list at exactly length 1 (threat T-02-08 mitigation)
- Transport dispatch ports the reference handler chain with FSB chrome dropped: snapshots define identity (never staleness-checked), reset counters/latch/overlays/scroll, write `buildSnapshotHtml` output to srcdoc; MUTATIONS/SCROLL/OVERLAY gate on `streaming` + `isCurrentStream`; DIALOG ports the Pitfall 8 top-level-check quirk explicitly (threat T-02-11, accepted + commented)
- **Self-healing pinned end-to-end:** >=3 stale misses fire exactly ONE `CONTROL.START` with `{ trigger: 'preview-resync', reason: 'stale-mutation-parent' }` through a recording transport; further crossings stay latched; the next snapshot releases the latch and a fresh threshold crossing fires the second resync (the test walks the full cycle)
- Scroll mirroring (the VIEW-06 scroll half): captured scroll stored first then smooth-followed while streaming; last scroll re-applied exactly once per mutation batch (dashboard.js:3340-3342 parity)
- Pure `computeScale` exported and unit-tested: 0.5-scale exact case, centered offsetX, !isFinite/<=0 clamp to 1, `|| 1920/1080` defaults with the `Math.max(1, ...)` floor; geometry applied as unscaled page-size box + letterbox offsets + top-left scale transform; window resize listener + typeof-guarded ResizeObserver (jsdom-safe)
- Renderer purity gate green: comment-stripped static scan of `src/renderer/` for `chrome.*`, `\bFSB\b`, `fa-solid`, `dash-preview`, `WebSocket`, `recordDashboard`, with the anti-vacuous module-split pin; spot-checked that an injected `chrome.runtime` reference fails the gate (probe reverted, not committed)
- Full suite green: 111/111 (90 pre-existing + 19 viewer + 2 purity), differential oracle included — zero regressions

## Task Commits

Each task was committed atomically (Task 1 TDD: RED test commit, then GREEN feat commit):

1. **Task 1: createViewer factory (RED)** - `c07f547` (test) — 19 failing tests for factory/sandbox/dispatch/scale/resync/handle
2. **Task 1: createViewer factory (GREEN)** - `4dc6cdf` (feat) — src/renderer/index.js, all 19 tests green
3. **Task 2: Renderer purity gate** - `3f9a4c9` (test) — tests/renderer-purity.test.js

No refactor commit — the GREEN implementation needed no post-pass cleanup.

## Files Created/Modified

- `src/renderer/index.js` — createViewer factory (540 lines): sandbox assertion, ViewerTransport dispatch, latched resync, computeScale + geometry, resize wiring, idempotent detach/destroy, registerOverlay seam, barrel re-exports of snapshot/diff/overlays
- `tests/renderer-viewer.test.js` — 19 jsdom tests pinning every must-have truth: factory throws, DOM structure, sandbox token list, handle shape, srcdoc-string assertions (never contentDocument), stale rejection, waiting-state gating, the full resync latch cycle, scroll, dialog quirk, computeScale math, detach/destroy idempotency
- `tests/renderer-purity.test.js` — comment-stripped static scan with six forbidden patterns and the module-split anti-vacuous guard

## Decisions Made

- **Persistent load listener over per-snapshot onload (forced divergence, documented in code):** jsdom 29 (probed empirically this session) only queues the iframe's initial about:blank load event when a load listener already exists at insertion time, and never re-fires load on srcdoc writes — the reference's per-snapshot `iframe.onload =` assignment therefore never executes under test. One creation-time `addEventListener('load', ...)` guarded on a pending snapshot payload behaves identically in real browsers (fires on every srcdoc load) and makes the streaming transition jsdom-testable. Ledger entry for plan 02-04.
- **State stays 'streaming' across re-snapshots (reference parity):** the second snapshot's mutations apply without waiting for a new load event, which also keeps the latch-release test deterministic in jsdom (where only one load ever fires)
- **resolveNidRect error containment:** wraps the fresh contentDocument read + querySelector in try/catch returning null, because overlays.js resolves anchors outside its safeRenderOverlay wrapper — a malformed nid must not kill the kind loop

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Per-snapshot iframe.onload never fires in jsdom — replaced with a creation-time persistent load listener**
- **Found during:** Task 1 (GREEN run: every streaming-dependent test timed out waiting for the load event)
- **Issue:** The plan's literal mechanism (`iframe.srcdoc = ...; iframe.onload = function () {...}`) relies on load events that jsdom 29 never delivers: the initial about:blank load is only queued if a listener exists at insertion time, and srcdoc writes never re-fire load (verified with three isolation probes)
- **Fix:** One `iframe.addEventListener('load', ...)` attached at construction (before insertion), guarded on `lastSnapshotPayload` so a bare about:blank load leaves the viewer waiting; handleSnapshot now only writes srcdoc. Browser behavior is unchanged — the listener fires on every srcdoc load with the exact onload body the plan specified (updateScale, initial scrollTo, mark streaming, un-hide)
- **Files modified:** src/renderer/index.js
- **Commit:** `4dc6cdf`

**2. [Rule 1 - Bug] RED test expectation contradicted the plan-02-02 reset contract**
- **Found during:** Task 1 (GREEN run: 18/19, custom-kind test expected 1 renderFn call but got 2)
- **Issue:** The RED test asserted a registered custom overlay renderFn is invoked exactly once per wire message, but `resetOverlays()` on each new snapshot deliberately dispatches `(null, null, layer)` through EVERY registered renderFn — the documented plan-02-02 reset contract
- **Fix:** Test now pins both calls: the snapshot reset (null value) followed by the wire dispatch (payload value) — strengthening the test to cover the reset contract
- **Files modified:** tests/renderer-viewer.test.js
- **Commit:** `4dc6cdf`

## Issues Encountered

None beyond the two auto-fixed deviations above. The empirical jsdom probes that isolated the load-event behavior (listener-at-insertion requirement, no srcdoc re-fire) were run as throwaway `node -e` scripts, not committed.

## Known Stubs

None. All dispatch paths are wired to real data: srcdoc from the live builder, diffs through the live applier, overlays through the live registry, resync through the live transport. The raw-HTML srcdoc insertion is the parity-locked Phase 3 chokepoint (T-02-12, accepted per the plan threat model), not a stub.

## Threat Flags

None beyond the plan's threat model. T-02-08 (sandbox assertion + token-list test), T-02-09 (isCurrentStream gates on MUTATIONS/SCROLL/OVERLAY), and T-02-10 (containment-wrapped dispatch, per-op containment in diff.js, missing-html keeps last good frame) are implemented and test-pinned; T-02-11 (dialog quirk) is the accepted, commented parity port. No new network endpoints, auth paths, file access, or schema changes.

## Next Phase Readiness

- Plan 02-04 (README + divergence ledger) should record: the persistent-load-listener divergence, the dialog identity quirk, the dropped FSB chrome (9-state machine, tabId checks, dash:request-status, ring buffers, layout modes), and the iframe title naming divergence
- Plan 02-05 (loopback demo) consumes `createViewer` as-is: the root's `data-phantomstream-ui` marker is ready for the capture `skipElement` predicate; package.json `"./renderer"` export entry still needs adding (02-05 scope)
- The ViewerTransport seam (`send` + `onMessage` -> unsubscribe) is the interface Phase 4's WS transport must implement

## Self-Check: PASSED

- `src/renderer/index.js` — FOUND
- `tests/renderer-viewer.test.js` — FOUND
- `tests/renderer-purity.test.js` — FOUND
- Commit `c07f547` — FOUND
- Commit `4dc6cdf` — FOUND
- Commit `3f9a4c9` — FOUND
- `node --test tests/renderer-viewer.test.js tests/renderer-purity.test.js` — 21/21 pass
- `npm test` — 111/111 pass
