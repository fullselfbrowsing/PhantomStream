---
phase: 03-security-pipeline-sanitization-privacy-masking
plan: 05
subsystem: security
tags: [security-contract, chokepoint-purity, sandbox, csp, fsb-verification]

# Dependency graph
requires:
  - phase: 03-security-pipeline-sanitization-privacy-masking
    provides: 03-01 capture sanitizeForWire chokepoint
  - phase: 03-security-pipeline-sanitization-privacy-masking
    provides: 03-02 renderer sanitizeFragment chokepoint and CSP meta
  - phase: 03-security-pipeline-sanitization-privacy-masking
    provides: 03-03 privacy masking and T-03-26 disposition
  - phase: 03-security-pipeline-sanitization-privacy-masking
    provides: 03-04 D7 oracle divergence discipline
provides:
  - static security purity scan for capture and renderer chokepoints
  - docs/SECURITY.md embed contract with sandbox, CSP, sanitizer, masking, and residual-risk guidance
  - README and module README pointers to the Phase 3 security contract
  - FSB browser checkpoint proving benign loopback fidelity, live mutation tracking, and hostile injection neutralization
  - inert dangerous URL handling: capture emits null attr removals and renderer removes dangerous URL attrs
affects: [phase-4 relay demo, phase-5 remote-control demo, npm packaging, docs]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - comment-stripped static scans for security chokepoint drift
    - documentation content guards for security contracts
    - dangerous URL attr removal instead of empty href neutralization

key-files:
  created:
    - tests/security-chokepoint-purity.test.js
    - docs/SECURITY.md
  modified:
    - README.md
    - src/capture/README.md
    - src/renderer/README.md
    - src/capture/index.js
    - src/renderer/sanitize.js
    - src/renderer/diff.js
    - tests/security-sanitize-capture.test.js
    - tests/security-sanitize-render.test.js
    - tests/differential/divergence-ledger.js
    - tests/differential/oracle.test.js

key-decisions:
  - "Dangerous mirror URL attrs are removed rather than rewritten to empty href values because href=\"\" still navigates in real Chromium."
  - "The embed contract is enforced by both docs and static tests so future sink/sandbox/chokepoint drift fails in CI."
  - "FSB browser verification is the checkpoint source of truth for real iframe navigation and click behavior."

patterns-established:
  - "Security docs must carry tested markers for sandbox, CSP, masking, and host must-nevers."
  - "URL sanitization must be verified in a real browser when click/navigation behavior matters."
  - "Renderer attr sanitization may return null to request removeAttribute through the diff applier."

requirements-completed: [SEC-01, SEC-02, SEC-03]

# Metrics
duration: 18min
completed: 2026-06-14
---

# Phase 3 Plan 05: Security Contract and Demo Gate Summary

**Security purity tests, embed contract documentation, inert URL sanitization, and FSB-verified loopback dogfood for the Phase 3 security pipeline**

## Performance

- **Duration:** 18 min
- **Started:** 2026-06-14T01:09:00Z
- **Completed:** 2026-06-14T01:27:29Z
- **Tasks:** 3
- **Files modified:** 13

## Accomplishments

- Added `tests/security-chokepoint-purity.test.js` to pin capture `sanitizeForWire` coverage, renderer sink/sandbox rules, render chokepoint wiring, and `docs/SECURITY.md` content markers.
- Wrote `docs/SECURITY.md` and updated `README.md`, `src/capture/README.md`, and `src/renderer/README.md` with the Phase 3 embed/security contract.
- Ran the loopback demo through FSB browser automation and verified sandbox/CSP, live benign row mirroring, source-raw/mirror-sanitized hostile markup, and inert click behavior.
- Fixed the browser-discovered URL residual: dangerous URL attrs now remove the mirrored attr instead of emitting `href=""`, which Chromium treats as a real navigation.

## Task Commits

Each task was committed atomically:

1. **Task 1: Chokepoint-purity static-scan test** - `3d35b43` (test)
2. **Task 2: SECURITY.md + README/module docs** - `7b1d3ed` (docs)
3. **Task 3 auto-fix: inert dangerous mirror URLs** - `f32084f` (fix)

## Files Created/Modified

- `tests/security-chokepoint-purity.test.js` - Static scan for capture sanitization coverage, renderer sink allowlists, sandbox token drift, render chokepoint wiring, and security-doc markers.
- `docs/SECURITY.md` - Embed security contract covering threat model, layered defenses, exact CSP, sandbox tokens, sanitization policy, masking guarantees, host must-nevers, and residual risks.
- `README.md` - Pointer to the security contract.
- `src/capture/README.md` - E3 security/masking extension entry and Phase 3 behavior notes.
- `src/renderer/README.md` - Retired Phase 3 queued items and linked the sandbox/security contract.
- `src/capture/index.js` - Dangerous URL attrs now serialize as attr removals (`val: null`) or are removed from snapshot/add-op clones.
- `src/renderer/sanitize.js` / `src/renderer/diff.js` - Render-side sanitizer returns `null` for dangerous URL attrs and diff application removes the attr.
- `tests/security-sanitize-capture.test.js`, `tests/security-sanitize-render.test.js`, `tests/differential/divergence-ledger.js`, `tests/differential/oracle.test.js` - Updated assertions for attr-removal URL neutralization.

## Decisions Made

- Empty URL attributes are not inert enough for mirrors. FSB verified that `href=""` navigates the sandboxed iframe to the page URL in Chromium, so dangerous URL neutralization now removes the attribute.
- The existing `DIFF_OP.ATTR` null-removal protocol is reused rather than adding a new op shape.
- The human demo checkpoint was completed with FSB automation instead of manual visual inspection; results are recorded below.

## Deviations from Plan

### Auto-fixed Issues

**1. Browser checkpoint found empty-href navigation**
- **Found during:** Task 3 (FSB loopback demo verification)
- **Issue:** The mirrored hostile link had `href=""`; clicking it did not execute script, but Chromium navigated the mirror iframe away from `about:srcdoc`.
- **Fix:** Capture and render sanitizers now remove dangerous URL attributes. Capture attr ops emit `val: null`; renderer `sanitizeAttrValue` returns `null`; `applyMutations` removes the attr.
- **Files modified:** `src/capture/index.js`, `src/renderer/sanitize.js`, `src/renderer/diff.js`, capture/render/oracle tests, `docs/SECURITY.md`
- **Verification:** Focused security suites passed, `npm test` passed 197/197, and FSB re-verification showed no dialog and no iframe navigation.
- **Committed in:** `f32084f`

---

**Total deviations:** 1 auto-fixed security correctness issue.
**Impact on plan:** The fix tightens the security guarantee required by the checkpoint. No scope creep beyond making the documented hostile-link behavior true in Chromium.

## Issues Encountered

- FSB initially showed that the hostile row appeared sanitized only after a capture resync and that empty hrefs could still navigate. The final run reloaded the demo after `f32084f`, verified a stable paused benign baseline, verified live add-row mirroring, then verified hostile markup after a fresh snapshot with click behavior still inert.

## Verification

- `node --test tests/security-chokepoint-purity.test.js` - pass, 7/7.
- `node --test tests/security-sanitize-capture.test.js` - pass, 17/17.
- `node --test tests/security-sanitize-render.test.js` - pass, 18/18.
- `node --test tests/differential/oracle.test.js` - pass, 34/34.
- `npm test` - pass, 197/197.
- FSB loopback checkpoint:
  - Opened `http://localhost:8642/examples/loopback-mirror.html?phase3-verify=f32084f`.
  - Verified iframe `sandbox` is exactly `allow-same-origin`.
  - Verified iframe CSP meta is `default-src 'none'; img-src http: https: data:; style-src http: https: 'unsafe-inline'; font-src http: https: data:`.
  - Paused auto-mutate and verified source/mirror rows matched.
  - Clicked Add row and verified source and mirror both reached 6 rows with matching last-row text.
  - Injected raw source markup with `onclick="alert(1)"` and `href="javascript:alert(2)"`.
  - Verified source stayed raw while mirror contained the button/link with no `onclick` and no `href`.
  - Clicked the mirrored button and link; no dialog opened and iframe URL stayed `about:srcdoc`.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Phase 3 security pipeline is ready for code review and phase verification. Phase 4 can build the relay/two-tab demo against a security pipeline that is now documented, statically guarded, oracle-ledgered, and real-browser dogfooded.

---
*Phase: 03-security-pipeline-sanitization-privacy-masking*
*Completed: 2026-06-14*

## Self-Check: PASSED

