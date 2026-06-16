---
phase: 10-npm-packaging-0-x-publish
plan: 03
subsystem: package-validation
tags: [npm, publint, attw, tarball, ci]
requires:
  - phase: 10-npm-packaging-0-x-publish
    plan: 10-02
    provides: Typed package export map and declaration generation
provides:
  - Package validation scripts
  - Files whitelist for npm tarball contents
  - Tarball install smoke test
  - CI package validation job
affects: [PKG-03, package-json, ci]
tech-stack:
  added:
    - publint
    - "@arethetypeswrong/cli"
  patterns:
    - Package checks validate packed tarball contents and a fresh temp-project install
key-files:
  created: [scripts/package-smoke.mjs]
  modified: [package.json, package-lock.json, .github/workflows/ci.yml]
key-decisions:
  - "ATTW runs with the esm-only profile because PhantomStream is an ESM-only package."
  - "package:check runs the stable suite plus package validators while docs/release RED assertions remain pending for 10-04 and 10-05."
patterns-established:
  - "Tarball smokes use npm pack --json --pack-destination in an isolated temp directory to avoid pack filename races."
requirements-completed: [PKG-03]
duration: 20min
completed: 2026-06-16
---

# Phase 10 Plan 03: Package Validation Tooling Summary

**The package now validates the actual tarball, not just local source imports**

## Accomplishments

- Added `publint` and `@arethetypeswrong/cli` dev dependencies.
- Added package scripts for `lint:package`, `attw`, `package:pack`, `package:smoke`, and `package:check`.
- Added a `files` whitelist covering `src`, generated `dist/types`, `bin`, examples, docs, README, and LICENSE while excluding private project artifacts by default.
- Added `scripts/package-smoke.mjs`, which packs the package, verifies required/forbidden tarball paths, installs the `.tgz` into a fresh temp project, imports every public subpath, and runs installed CLI help.
- Added a CI `package` job on Node 24 that runs `npm run package:check` with read-only repository permissions.

## Task Commits

- **Task 1-2: Package validators, tarball smoke, and CI** - `5e7b473` (build/ci)

## Verification

```bash
npm run lint:package
npm run attw
npm run package:pack
npm run package:smoke
npm run package:check
node -e "const p=require('./package.json'); for (const s of ['lint:package','attw','package:pack','package:smoke','package:check']) if(!p.scripts[s]) process.exit(1); for (const d of ['publint','@arethetypeswrong/cli']) if(!p.devDependencies[d]) process.exit(1)"
test -f scripts/package-smoke.mjs
rg -n "npm run package:check|contents: read|node-version" .github/workflows/ci.yml
node --test tests/package-publish.test.js
```

Results:

- `npm run package:check` passed, including stable test suite (`403/403`), declaration generation, publint, ATTW, dry-run pack, and tarball install smoke.
- `publint` passed with `All good!`.
- ATTW passed under the `esm-only` profile; Node 10 and CJS findings are intentionally ignored because the package contract is ESM-only.
- `tests/package-publish.test.js` now passes scripts/files, exports, and type-config assertions and fails only on future docs/release workflow assertions.

## Deviations from Plan

- `package:check` runs the stable test suite with Node's `--test-skip-pattern` for the two remaining docs/release acceptance tests. The full package-publish test remains runnable separately and stays RED only for 10-04/10-05 scope.
- ATTW uses `--profile esm-only` instead of default strict mode. Default strict mode fails expected Node 10/CJS resolution checks for an ESM-only package.

## Next Phase Readiness

10-04 can now add quickstarts and README/package docs refresh against the remaining docs RED assertion.

---
*Phase: 10-npm-packaging-0-x-publish*
*Completed: 2026-06-16*
