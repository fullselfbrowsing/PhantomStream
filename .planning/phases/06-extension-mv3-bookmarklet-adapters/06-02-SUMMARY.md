---
phase: 06-extension-mv3-bookmarklet-adapters
plan: 02
subsystem: adapters
tags: [mv3, chrome-extension, storage-session, watchdog, service-worker]
requires:
  - 06-01 adapter export foundation
provides:
  - Chromium MV3 service-worker adapter factory
  - Content-script bridge source helper for chrome.runtime.sendMessage forwarding
  - chrome.storage.session-backed stream intent recovery
  - PhantomStream watchdog alarm resnapshot path
affects: [adapters, mv3, extension, transport]
tech-stack:
  added: []
  patterns: [content-free session persistence, fake Chrome API tests, watchdog-driven fresh snapshot recovery]
key-files:
  created:
    - tests/extension-adapter.test.js
  modified:
    - src/adapters/extension.js
key-decisions:
  - "Persisted only roomKey, wsUrl, tabId, lifecycle intent, active flag, pending resnapshot reason, and timestamps in chrome.storage.session."
  - "Used a configurable PhantomStream watchdog alarm that rehydrates storage state and forwards CONTROL.START with mv3-watchdog-resnapshot."
  - "Kept remote control out of Phase 6 scope; adapter forwards stream lifecycle and stream frames only."
requirements-completed: [ADPT-01]
duration: 18 min
completed: 2026-06-15
---

# Phase 06 Plan 02: MV3 Extension Adapter Summary

**Chromium MV3 adapter core now persists stream intent, forwards bridge messages, and recovers active streams through the watchdog alarm.**

## Performance
- **Duration:** 18 min
- **Tasks:** 2 completed
- **Files modified:** 2

## Accomplishments
- Added MV3 adapter exports: `PHANTOMSTREAM_WATCHDOG_ALARM`, `PHANTOMSTREAM_SESSION_KEY`, `createExtensionAdapter()`, and `createExtensionContentBridge()`.
- Implemented validation for required MV3 APIs: `chrome.runtime`, `chrome.storage.session`, and `chrome.alarms`.
- Implemented runtime message handling for stream frames and lifecycle control frames.
- Stored content-free stream intent in `chrome.storage.session` and excluded mirrored payload fields from durable state.
- Implemented watchdog recovery that reloads session state and requests a fresh snapshot via `CONTROL.START` with `mv3-watchdog-resnapshot`.
- Added fake Chrome API tests for listener registration, content bridge source, payload forwarding, storage safety, alarm recovery, and new-instance recovery.

## Task Commits
1. **Task 1: Add RED MV3 adapter recovery tests** - `45edd50`
2. **Task 2: Implement MV3 service-worker adapter and content bridge** - `a076ef9`

## Files Created/Modified
- `src/adapters/extension.js` - Real MV3 adapter implementation with service-worker listeners, storage-backed state, watchdog recovery, and content bridge source.
- `tests/extension-adapter.test.js` - Fake Chrome API coverage for validation, storage/session, content bridge forwarding, and recovery.

## Verification
- `node --test tests/extension-adapter.test.js tests/adapter-exports.test.js` passed.
- Acceptance greps for watchdog constants, `chrome.storage.session`, and `mv3-watchdog-resnapshot` passed.
- `npm test` passed: 299 tests passing.

## Decisions & Deviations
None - plan executed as specified.

## Next Phase Readiness
The extension demo plan can build a fixture around the MV3 adapter once Wave 2 bookmarklet core is also complete.
