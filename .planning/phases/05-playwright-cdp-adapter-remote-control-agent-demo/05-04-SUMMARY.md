---
phase: 05-playwright-cdp-adapter-remote-control-agent-demo
plan: 04
subsystem: demo-cli
tags: [playwright, cdp, cli, local-server, relay, node-test]
requires:
  - phase: 05-playwright-cdp-adapter-remote-control-agent-demo
    provides: Playwright/CDP adapter with default-deny remote-control authorization
  - phase: 04-relay-ws-transport-two-tab-demo
    provides: Local-only raw WebSocket relay backend and demo server pattern
provides:
  - Local-only Playwright demo server export
  - Separate `phantom-stream playwright-demo` CLI command
  - `npm run demo:playwright` script
  - Playwright 1.60.0 dev dependency and lockfile metadata
  - CLI/server tests for local-only output, no-store routes, and command wiring
affects: [phase-05, playwright-demo-ui, browser-verification, package-scripts]
tech-stack:
  added: [playwright@1.60.0]
  patterns:
    - Demo servers bind only to 127.0.0.1 and reject other hosts
    - Playwright demo uses role-specific relay URLs while keeping relay execution-free
    - CLI output prints local URLs and content-free control state only
key-files:
  created:
    - examples/playwright-demo/server.js
    - tests/playwright-demo-cli.test.js
  modified:
    - bin/phantom-stream.js
    - package.json
    - package-lock.json
key-decisions:
  - "The Playwright demo exposes role-specific WebSocket URLs because the Phase 04 relay backend rejects connections without role=source or role=viewer."
  - "The CLI keeps `phantom-stream demo` behavior intact and adds `phantom-stream playwright-demo` as a separate command."
  - "05-04 serves minimal no-store fallback content for `/playwright/viewer`, `/playwright/fixture`, and `/playwright/demo.css`; full UI assets remain the scope of 05-05."
patterns-established:
  - "Playwright demo server owns optional driver launch and adapter wiring; the relay remains a raw fan-out boundary."
  - "`--drive` is the explicit browser-launch path, and `--no-open` keeps automated CLI tests browser-free."
requirements-completed: [ADPT-02, PKG-02, SEC-04]
duration: 9 min
completed: 2026-06-15
---

# Phase 05 Plan 04: Playwright Demo CLI/Server Summary

**Local-only Playwright demo command with optional adapter-driven browser launch, no-store demo routes, and Playwright dependency tracking**

## Performance

- **Duration:** 9 min
- **Started:** 2026-06-15T08:57:54Z
- **Completed:** 2026-06-15T09:06:25Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments

- Added `examples/playwright-demo/server.js` with `startPlaywrightDemoServer()` and `buildPlaywrightDemoUrls()`.
- Added `phantom-stream playwright-demo` with the required five-line local output contract and explicit `--drive`/`--headed` flags.
- Added `npm run demo:playwright`, installed `playwright@1.60.0`, and updated `package-lock.json`.
- Added focused CLI/server coverage for local-only binding, no-store demo routes, help flags, package script metadata, and existing demo compatibility.

## Task Commits

Each task was committed atomically:

1. **Task 1: Wave 0 Playwright demo CLI/server tests** - `d2370cb` (test)
2. **Task 2: Implement Playwright demo server, CLI command, and package metadata** - `ff3fe5d` (feat)

_Note: This plan used the requested TDD RED/GREEN sequence._

## Files Created/Modified

- `examples/playwright-demo/server.js` - Local-only demo server, route handling, relay backend, role-specific URLs, optional Playwright driver launch, adapter wiring, and cleanup.
- `bin/phantom-stream.js` - Adds the separate `playwright-demo` command while preserving existing `demo` behavior.
- `package.json` - Adds `demo:playwright` and the Playwright dev dependency.
- `package-lock.json` - Locks `playwright@1.60.0`, `playwright-core@1.60.0`, and optional `fsevents`.
- `tests/playwright-demo-cli.test.js` - Pins server URLs, local-only host rejection, no-store demo routes, CLI output/help, and package script metadata.

## Decisions Made

- The server returns `wsUrl` for the source adapter and `viewerWsUrl` for the viewer page. The existing relay admission code requires `role=source` or `role=viewer`, so a single roleless WebSocket URL would not connect.
- `--drive` is the only CLI path that launches Playwright. `--no-open` keeps tests and non-browser runs browser-free.
- The 05-04 server includes minimal fallback responses for the `/playwright/*` routes so no-store route behavior is testable before 05-05 creates the full UI and fixture assets.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical Functionality] Added role-specific WebSocket URLs**
- **Found during:** Task 2 (server implementation)
- **Issue:** The plan described a single `wsUrl`, but the existing Phase 04 WebSocket relay backend rejects any `/ws` connection missing `role=source` or `role=viewer`.
- **Fix:** `buildPlaywrightDemoUrls()` now returns `wsUrl` for the source endpoint and `viewerWsUrl` for the viewer endpoint, and page URLs carry the matching role-specific URL.
- **Files modified:** `examples/playwright-demo/server.js`, `tests/playwright-demo-cli.test.js`
- **Verification:** `node --test tests/playwright-demo-cli.test.js tests/demo-cli.test.js`; `npm test`
- **Committed in:** `ff3fe5d`

**2. [Rule 1 - Bug] Restored existing CLI help prefix**
- **Found during:** Task 2 focused GREEN verification
- **Issue:** Expanding the usage string to a two-command block broke the existing `tests/demo-cli.test.js` assertion for `Usage: phantom-stream demo`.
- **Fix:** Kept the expanded help text but restored the original first-line prefix.
- **Files modified:** `bin/phantom-stream.js`
- **Verification:** `node --test tests/playwright-demo-cli.test.js tests/demo-cli.test.js`
- **Committed in:** `ff3fe5d`

---

**Total deviations:** 2 auto-fixed (1 missing critical functionality, 1 bug)
**Impact on plan:** Both fixes preserve the planned command/server behavior while respecting existing relay and CLI contracts. No relay-side execution or authorization logic was added.

## Issues Encountered

- The `npm install --save-dev playwright@1.60.0` command completed successfully and wrote the expected package and lockfile updates.

## Known Stubs

- `examples/playwright-demo/server.js` contains minimal embedded fallback responses for `/playwright/viewer`, `/playwright/fixture`, and `/playwright/demo.css`. These are intentional route fallbacks for 05-04; the full viewer, fixture, and CSS assets are explicitly planned for 05-05.

## Threat Flags

None. The new local HTTP routes, optional Playwright browser process, and relay endpoint wiring are covered by the plan threat model (T-05-02, T-05-03, T-05-05, T-05-08, T-05-09).

## Verification

- `set +e; node --test tests/playwright-demo-cli.test.js; code=$?; test "$code" -ne 0` - passed during RED because the server module did not exist.
- `node --test tests/playwright-demo-cli.test.js tests/demo-cli.test.js` - passed, 14 tests.
- Acceptance greps passed for `"playwright"`, `"demo:playwright"`, `playwright-demo`, and `127.0.0.1`.
- `npm test` - passed, 284 tests.
- `npm run demo:playwright -- --port 0 --no-open` - printed the required five local-only lines and shut down cleanly on SIGINT.

## User Setup Required

None for this plan. Managed browser installation is handled by the Phase 05 browser verification plan.

## Next Phase Readiness

Plan 05-05 can add the full host-owned viewer UI and deterministic fixture assets under `examples/playwright-demo/`; the server already maps `/playwright/viewer`, `/playwright/fixture`, and `/playwright/demo.css` to those files when present.

## Self-Check: PASSED

- Found `examples/playwright-demo/server.js`.
- Found `tests/playwright-demo-cli.test.js`.
- Found `.planning/phases/05-playwright-cdp-adapter-remote-control-agent-demo/05-04-SUMMARY.md`.
- Found task commits `d2370cb` and `ff3fe5d` in git history.

---
*Phase: 05-playwright-cdp-adapter-remote-control-agent-demo*
*Completed: 2026-06-15*
