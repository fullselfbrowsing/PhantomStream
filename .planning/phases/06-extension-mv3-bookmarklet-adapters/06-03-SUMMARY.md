---
phase: 06-extension-mv3-bookmarklet-adapters
plan: 03
subsystem: demos
tags: [mv3, extension-demo, cli, local-relay, browser-verification]
requires:
  - 06-02 MV3 extension adapter core
provides:
  - `phantom-stream extension-demo` CLI command
  - Local-only MV3 extension demo server
  - Generated unpacked Chromium MV3 extension fixture
  - Source and viewer demo pages for extension-driven mirroring
  - Extension MV3 browser verification checklist
affects: [cli, demos, mv3, extension, verification]
tech-stack:
  added: []
  patterns: [local-only demo server, generated unpacked extension fixture, no-store demo assets, human-needed browser evidence rows]
key-files:
  created:
    - examples/extension-mv3/server.js
    - examples/extension-mv3/source.html
    - examples/extension-mv3/viewer.html
    - examples/extension-mv3/demo.css
    - tests/extension-demo-cli.test.js
    - .planning/phases/06-extension-mv3-bookmarklet-adapters/06-BROWSER-VERIFICATION.md
  modified:
    - bin/phantom-stream.js
key-decisions:
  - "Generated the unpacked extension fixture into a temp directory at server startup so CLI output can point users at a real loadable directory."
  - "Kept browser-only MV3 evidence as human_needed because no Chromium extension load was performed in this session."
requirements-completed: [ADPT-01]
duration: 20 min
completed: 2026-06-15
---

# Phase 06 Plan 03: Extension MV3 Demo Summary

**The MV3 extension demo command now starts a local relay, source/viewer pages, and a generated unpacked extension fixture.**

## Performance
- **Duration:** 20 min
- **Tasks:** 3 completed
- **Files modified:** 7

## Accomplishments
- Added `startExtensionDemoServer()` with `127.0.0.1` binding, `/ws` relay, deterministic source/viewer URLs, and no-store responses.
- Generated an unpacked MV3 fixture with `manifest.json`, `service-worker.js`, and `content-script.js`.
- Added `phantom-stream extension-demo --port <number> --no-open` CLI support and exact output lines for extension directory, source page, viewer, and room prefix.
- Added local source and viewer pages plus CSS for manual extension verification.
- Recorded the Extension MV3 browser verification checklist with all browser-only evidence rows marked `human_needed` and reasons.

## Task Commits
1. **Task 1: Add RED extension demo CLI tests** - `7c3f1df`
2. **Task 2 and 3: Implement extension demo server/CLI and browser verification artifact** - `339ccb1`

## Files Created/Modified
- `bin/phantom-stream.js` - Adds `extension-demo` usage, parsing, server startup, and output.
- `examples/extension-mv3/server.js` - Local-only demo server and generated MV3 fixture.
- `examples/extension-mv3/source.html` - Deterministic source page with mutation controls.
- `examples/extension-mv3/viewer.html` - Viewer page wired to renderer and WebSocket transport.
- `examples/extension-mv3/demo.css` - Demo styling.
- `tests/extension-demo-cli.test.js` - Server, fixture, route, and CLI output coverage.
- `.planning/phases/06-extension-mv3-bookmarklet-adapters/06-BROWSER-VERIFICATION.md` - Extension verification checklist.

## Verification
- `node --test tests/extension-demo-cli.test.js tests/demo-cli.test.js tests/playwright-demo-cli.test.js` passed.
- Acceptance greps for `extension-demo`, `"alarms"`, `cache-control.*no-store`, and `mv3-watchdog-resnapshot` passed.
- `npm test` passed: 307 tests passing.

## Decisions & Deviations
None - plan executed as specified. Browser-only checks remain `human_needed` because no unpacked extension was loaded into Chromium in this session.

## Next Phase Readiness
The remaining Phase 6 work is the bookmarklet demo plan, which can reuse the CLI/server patterns established here.
