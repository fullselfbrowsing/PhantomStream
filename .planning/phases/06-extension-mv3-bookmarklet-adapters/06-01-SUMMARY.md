---
phase: 06-extension-mv3-bookmarklet-adapters
plan: 01
subsystem: adapters
tags: [adapters, package-exports, browser-inject, mv3, bookmarklet]
requires:
  - Phase 05 renderer remote-control integration
provides:
  - Public package exports for extension and bookmarklet adapters
  - Shared browser inject source helper backed by the checked-in classic script artifact
  - Minimal extension and bookmarklet adapter module surfaces for later Wave 2 implementation
affects: [adapters, package-api, mv3, bookmarklet]
tech-stack:
  added: []
  patterns: [checked-in classic browser inject source, package subpath exports, TDD adapter contract tests]
key-files:
  created:
    - src/adapters/browser-inject.js
    - src/adapters/extension.js
    - src/adapters/bookmarklet.js
    - tests/adapter-exports.test.js
  modified:
    - package.json
key-decisions:
  - "Reused the existing Playwright inject artifact through getBrowserInjectSource() instead of adding a separate browser build step."
  - "Kept extension and bookmarklet modules as side-effect-free public stubs so Wave 2 plans can replace behavior without hidden implementation."
requirements-completed: [ADPT-01, ADPT-03]
duration: 8 min
completed: 2026-06-15
---

# Phase 06 Plan 01: Adapter Export Foundation Summary

**Public adapter subpaths and the shared classic browser inject source helper are in place.**

## Performance
- **Duration:** 8 min
- **Tasks:** 2 completed
- **Files modified:** 5

## Accomplishments
- Added `./adapters/extension` and `./adapters/bookmarklet` package exports.
- Added `getBrowserInjectSource()` so browser adapter surfaces share the existing no-build classic inject artifact.
- Added side-effect-free extension and bookmarklet module stubs for the Wave 2 adapter implementations.
- Added focused export and inject artifact tests that pin bridge hooks and forbid import/export syntax in the injected script source.

## Task Commits
1. **Task 1: Add RED export and inject artifact tests** - `00e0110`
2. **Task 2: Implement adapter exports and shared browser inject helper** - `9fb3141`

## Files Created/Modified
- `package.json` - Adds public extension and bookmarklet adapter subpath exports.
- `src/adapters/browser-inject.js` - Exposes the shared browser inject source helper.
- `src/adapters/extension.js` - Provides the temporary extension adapter public factory surface.
- `src/adapters/bookmarklet.js` - Provides the temporary bookmarklet source factory surface.
- `tests/adapter-exports.test.js` - Covers package exports, adapter factories, and classic inject artifact invariants.

## Verification
- `node --test tests/adapter-exports.test.js tests/playwright-adapter.test.js` passed.
- `npm test` passed after installing declared lockfile dependencies with `npm ci`: 292 tests passing.

## Decisions & Deviations
None - plan executed as specified.

## Next Phase Readiness
Wave 2 can replace the extension and bookmarklet stubs with real MV3 and bookmarklet adapter behavior.
