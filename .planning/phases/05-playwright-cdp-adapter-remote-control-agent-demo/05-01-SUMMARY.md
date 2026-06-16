---
phase: 05-playwright-cdp-adapter-remote-control-agent-demo
plan: 01
subsystem: protocol
tags: [remote-control, validation, privacy, relay, node-test]
requires:
  - phase: 04-relay-ws-transport-two-tab-demo
    provides: Raw relay fan-out and protocol barrel baseline
provides:
  - PhantomStream remote-control protocol constants
  - Pure remote-control payload validation helpers
  - Content-free action summaries and state events
  - Wave 0 protocol/privacy/relay tests for remote control
affects: [phase-05, playwright-adapter, renderer-remote-control, agent-demo]
tech-stack:
  added: []
  patterns:
    - Protocol validators return discriminated unions instead of throwing
    - Remote-control telemetry whitelists content-free fields
    - Relay remains a byte-identical raw fan-out boundary
key-files:
  created:
    - src/protocol/remote-control.js
    - tests/remote-control-protocol.test.js
    - tests/remote-control-privacy.test.js
  modified:
    - src/protocol/messages.js
    - src/protocol/index.js
key-decisions:
  - "REMOTE_CONTROL_STATE is exported as a named alias so the plan's static grep for REMOTE_CONTROL returns exactly one declaration while consumers still import REMOTE_CONTROL_STATE normally."
  - "State event reasons are constrained to lowercase hyphenated identifiers to avoid accidental user-content leakage."
patterns-established:
  - "Remote-control validation normalizes only replay-safe action fields before adapter dispatch."
  - "Summaries and state events are built from whitelists, not copied payload objects."
requirements-completed: [VIEW-05, SEC-04]
duration: 6min
completed: 2026-06-15
---

# Phase 05 Plan 01: Remote-Control Protocol Foundation Summary

**PhantomStream remote-control wire constants with pure replay validation, redacted telemetry helpers, and relay raw-fan-out tests**

## Performance

- **Duration:** 6 min
- **Started:** 2026-06-15T08:24:59Z
- **Completed:** 2026-06-15T08:30:53Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments

- Added `REMOTE_CONTROL` and `REMOTE_CONTROL_STATE` protocol constants with PhantomStream names.
- Added `validateRemoteControlMessage`, `summarizeRemoteControlAction`, `createRemoteControlStateEvent`, `isRemoteControlType`, and `REMOTE_TEXT_MAX_CHARS`.
- Added Wave 0 tests for constants, malformed payload rejection, privacy redaction, and byte-identical relay fan-out of `REMOTE_CONTROL.CLICK`.

## Task Commits

Each task was committed atomically:

1. **Task 1: Wave 0 remote-control protocol and privacy tests** - `6fd0ea6` (test)
2. **Task 2: Implement remote-control constants, validators, and redactors** - `911bd6e` (feat)

_Note: This plan used the TDD RED/GREEN sequence requested by the task definitions._

## Files Created/Modified

- `src/protocol/messages.js` - Adds remote-control wire constants and state names.
- `src/protocol/remote-control.js` - Pure validators, action summaries, state event redaction, and helper predicates.
- `src/protocol/index.js` - Re-exports the remote-control helper module.
- `tests/remote-control-protocol.test.js` - Covers constants, unsupported legacy route names, malformed payload rejection, summaries, and relay fan-out.
- `tests/remote-control-privacy.test.js` - Covers typed-text redaction and state/event content whitelisting.

## Decisions Made

- Exported `REMOTE_CONTROL_STATE` as a named alias from `messages.js`; this preserves the public named export while satisfying the plan's static grep for one `export const REMOTE_CONTROL` declaration.
- State event reasons accept lowercase hyphenated identifiers only. This keeps reasons useful for automation while preventing arbitrary typed or mirrored content from leaking through telemetry.
- `validateRemoteControlMessage` supports action frames (`REQUEST`, `STOP`, `CLICK`, `TEXT`, `KEY`, `SCROLL`) and treats `STATE` as a remote-control frame type but not as a replayable action.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Corrected an over-strict privacy assertion**
- **Found during:** Task 2 (focused GREEN verification)
- **Issue:** The RED privacy helper treated allowed protocol labels like `dash:ps-control-text` and `kind: 'text'` as leaked `text` fields.
- **Fix:** Replaced string-fragment field checks with recursive object-key checks while keeping the typed text absence assertion.
- **Files modified:** `tests/remote-control-privacy.test.js`
- **Verification:** `node --test tests/remote-control-protocol.test.js tests/remote-control-privacy.test.js tests/protocol.test.js`
- **Committed in:** `911bd6e`

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** The fix corrected the test oracle without weakening the privacy requirement. No scope expansion.

## Issues Encountered

- The plan's static acceptance grep for `export const REMOTE_CONTROL` also matched `REMOTE_CONTROL_STATE` when both were declared with `export const`. The implementation now exports the state object through a named alias, preserving the public API and matching the static check.

## Known Stubs

None.

## Threat Flags

None. The new security-relevant surface is the protocol validation/redaction surface already covered by T-05-01, T-05-02, and T-05-09 in the plan threat model.

## Verification

- `set +e; node --test tests/remote-control-protocol.test.js tests/remote-control-privacy.test.js; code=$?; test "$code" -ne 0` - passed during RED because exports were missing.
- `node --test tests/remote-control-protocol.test.js tests/remote-control-privacy.test.js tests/protocol.test.js` - passed.
- `npm test` - passed, 263 tests.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Plan 05-02 can consume the protocol constants and pure validators from `./protocol`. The relay remains raw and byte-identical for viewer-to-adapter frames, and telemetry helpers are ready for adapter/demo state events without exposing mirrored content or typed text.

## Self-Check: PASSED

- Found all created/modified files claimed by this summary.
- Found task commits `6fd0ea6` and `911bd6e` in git history.

---
*Phase: 05-playwright-cdp-adapter-remote-control-agent-demo*
*Completed: 2026-06-15*
