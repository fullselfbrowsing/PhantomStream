---
phase: 10-npm-packaging-0-x-publish
plan: 05
subsystem: release-workflow
tags: [npm, trusted-publishing, oidc, release, dry-run]
requires:
  - phase: 10-npm-packaging-0-x-publish
    plan: 10-04
    provides: Package quickstarts and release-gate docs
provides:
  - Token-free GitHub Actions publish workflow
  - Trusted-publisher release documentation
  - Public npm publishConfig
  - Final package validation and npm dry-run evidence
affects: [PKG-03, PKG-04, ci, docs, package-json]
tech-stack:
  added: []
  patterns:
    - Release workflow uses GitHub Actions OIDC trusted publishing instead of long-lived npm tokens.
key-files:
  created: [.github/workflows/publish.yml]
  modified: [docs/RELEASE.md, package.json, tests/demo-cli.test.js]
key-decisions:
  - "Real npm publish remains a user/auth gate and was not run autonomously."
  - "The package bin target was committed in npm-normalized form: bin/phantom-stream.js."
requirements-progressed: [PKG-03]
requirements-completed: []
duration: 20min
completed: 2026-06-16
---

# Phase 10 Plan 05: Release Workflow Summary

**The package is publish-ready, with the real public registry publish stopped at the explicit auth gate.**

## Accomplishments

- Added `.github/workflows/publish.yml` for release-triggered and manually triggered npm publishing.
- Configured the workflow for GitHub-hosted Actions trusted publishing with `id-token: write`, npm registry setup, `npm ci`, `npm run package:check`, and final `npm publish --access public`.
- Kept the workflow token-free: no `NPM_TOKEN` secret is referenced.
- Updated `docs/RELEASE.md` with local preflight, trusted publisher setup fields, staged release guidance, and the human/auth publish boundary.
- Added `publishConfig.access = "public"` and restored `package:check` to the full gate: tests, types, `publint`, ATTW, pack, and tarball smoke.
- Committed npm's normalized CLI bin path (`bin/phantom-stream.js`) and updated the related package assertion.

## Task Commits

- **Task 1-2: Trusted publish workflow, release docs, dry-run gate** - `ebb74b4` (ci)

## Verification

```bash
test -f .github/workflows/publish.yml && test -f docs/RELEASE.md
rg -n "id-token: write|registry-url: 'https://registry.npmjs.org'|npm run package:check|npm publish --access public|NPM_TOKEN" .github/workflows/publish.yml docs/RELEASE.md package.json
! rg -n "NPM_TOKEN" .github/workflows/publish.yml
node -e "const p=require('./package.json'); if(!p.publishConfig || p.publishConfig.access !== 'public') process.exit(1)"
npm run package:check
npm publish --dry-run --access public
npm view @fullselfbrowsing/phantom-stream version --json
```

Results:

- Static release workflow checks passed.
- `npm run package:check` passed with `405/405` tests, type generation, `publint`, ATTW, dry-run pack, and tarball install smoke.
- `npm publish --dry-run --access public` passed cleanly for `@fullselfbrowsing/phantom-stream@0.1.0`.
- `npm view @fullselfbrowsing/phantom-stream version --json` returned npm `E404` from this environment, so the package is not currently visible from the public registry here.
- Real `npm publish --access public` was not run.

## Publish Gate

- Package: `@fullselfbrowsing/phantom-stream`
- Version: `0.1.0`
- Required user action: configure npm trusted publishing for `.github/workflows/publish.yml` with the `npm-publish` environment, or authenticate npm with package publish permission, then explicitly approve the real publish command.

## Deviations from Plan

- `npm publish --dry-run` normalized the CLI bin target in `package.json`; the normalized path was committed and the package assertion was updated.
- The real registry publish is deliberately unresolved because the plan requires explicit authenticated user approval.

## Next Phase Readiness

Phase 11 must wait until `@fullselfbrowsing/phantom-stream@0.1.0` is actually published and installable from npm. The repo is ready for that gate, but the public registry mutation remains pending.

---
*Phase: 10-npm-packaging-0-x-publish*
*Completed: 2026-06-16*
