---
phase: 10-npm-packaging-0-x-publish
plan: 01
subsystem: package-testing
tags: [npm, package-validation, red-tests, node-test]
requires:
  - phase: 10-npm-packaging-0-x-publish
    provides: Phase 10 packaging context, research, validation, and patterns
provides:
  - RED package publish validation tests for scripts, files whitelist, exports, types, docs, and release workflow
affects: [PKG-03, PKG-04, package-json, ci, docs]
tech-stack:
  added: []
  patterns:
    - Package tests inspect metadata and release files before implementation
key-files:
  created: [tests/package-publish.test.js]
  modified: []
key-decisions:
  - "Package validation tests intentionally fail until package metadata, declaration config, docs, and release workflow are implemented."
patterns-established:
  - "Package acceptance tests live in node:test alongside existing framework tests."
requirements-completed: [PKG-03, PKG-04]
duration: 8min
completed: 2026-06-16
---

# Phase 10 Plan 01: Package Publish RED Tests Summary

**Package publish acceptance is now pinned by failing tests before implementation**

## Accomplishments

- Added `tests/package-publish.test.js` covering package scripts, files whitelist, typed export-map shape, declaration config, CI/release workflow gates, and docs quickstart/status requirements.
- Verified the tests fail RED against the current package, with failures on the intended missing package features rather than syntax/harness errors.

## Task Commits

- **Task 1: RED package publish validation tests** - `93be016` (test)

## Verification

```bash
set +e; node --test tests/package-publish.test.js; code=$?; echo TEST_EXIT=$code; test "$code" -ne 0
test -f tests/package-publish.test.js
rg -n "package:check|tsconfig.types.json|docs/QUICKSTARTS.md|publish.yml|id-token: write|dist/types|reference" tests/package-publish.test.js
```

Results:

- RED test run exited with `TEST_EXIT=1`.
- Static acceptance checks passed.

## Deviations from Plan

None.

## Next Phase Readiness

10-02 can now implement declaration generation and typed exports against the RED package tests.

---
*Phase: 10-npm-packaging-0-x-publish*
*Completed: 2026-06-16*
