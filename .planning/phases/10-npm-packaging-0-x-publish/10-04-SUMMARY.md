---
phase: 10-npm-packaging-0-x-publish
plan: 04
subsystem: package-docs
tags: [docs, quickstarts, cssom, npm, release]
requires:
  - phase: 10-npm-packaging-0-x-publish
    plan: 10-03
    provides: Package validation and tarball smoke tooling
provides:
  - Adapter quickstarts
  - Release gate documentation
  - README package status refresh
affects: [PKG-04, docs, package-json]
tech-stack:
  added: []
  patterns:
    - Quickstarts reuse shipped demos and existing APIs instead of inventing new flows
key-files:
  created: [docs/QUICKSTARTS.md, docs/RELEASE.md]
  modified: [README.md, docs/ARCHITECTURE.md, docs/DESIGN-HISTORY.md, package.json]
key-decisions:
  - "Package docs describe shipped CSSOM mode and current WeakMap/nodeIds identity instead of reference-era live data-fsb-nid stamping."
  - "Release docs document gates but do not authorize a real npm publish."
patterns-established:
  - "Quickstarts include prerequisites, command/code, expected success signal, and fastest troubleshooting check."
requirements-completed: [PKG-04]
duration: 18min
completed: 2026-06-16
---

# Phase 10 Plan 04: Package Quickstarts Summary

**User-facing package docs now match the shipped API and adapter surface**

## Accomplishments

- Added `docs/QUICKSTARTS.md` covering install, embedded loopback, WebSocket two-tab demo, Playwright/CDP, extension MV3, bookmarklet, CSSOM mode, security checklist, and troubleshooting.
- Added `docs/RELEASE.md` with local release gates, dry-run guidance, and the explicit human/auth boundary for real publish.
- Updated README links, package getting-started text, current WeakMap/`nodeIds` identity model, shipped CSSOM mode, documentation table, and roadmap status.
- Updated architecture/design-history docs to point at quickstarts and replace stale "future limitation" wording with current resolved/residual status.
- Narrowed `package:check` so the docs package-publish assertion now runs; only the publish-workflow assertion remains skipped until 10-05.

## Task Commits

- **Task 1-2: Quickstarts and README/docs refresh** - `6b3917f` (docs)

## Verification

```bash
rg -n "Embedded Loopback|WebSocket Two-Tab Demo|Playwright/CDP|Extension MV3|Bookmarklet|styleMode: 'cssom'|Security Checklist" docs/QUICKSTARTS.md
rg -n "npm install @fullselfbrowsing/phantom-stream|phantom-stream demo|phantom-stream playwright-demo|createPlaywrightAdapter|createExtensionAdapter|createBookmarklet" docs/QUICKSTARTS.md
rg -n "allow-scripts|SECURITY.md|styleMode: 'cssom'" docs/QUICKSTARTS.md
rg -n "docs/QUICKSTARTS.md|styleMode: 'cssom'|WeakMap|nodeIds" README.md
! rg -n "Every captured element carries a data-fsb-nid|CSSOM capture mode.*Planned|v1 capture enhancements.*Planned" README.md
node --test tests/package-publish.test.js
npm run package:check
```

Results:

- Quickstart and README acceptance greps passed.
- `tests/package-publish.test.js` now passes `4/5` and fails only because `.github/workflows/publish.yml` is not created yet.
- `npm run package:check` passed with package docs assertions active (`404/404` stable tests plus types, publint, ATTW, pack, and tarball smoke).

## Deviations from Plan

- Added `docs/RELEASE.md` in 10-04 because `tests/package-publish.test.js` treats release-gate docs as part of the docs assertion. The trusted-publishing workflow itself remains 10-05 scope.
- Touched `package.json` only to narrow the temporary `package:check` skip pattern now that docs assertions pass.

## Next Phase Readiness

10-05 can add the trusted-publishing workflow, final dry-run, remove the remaining package-check skip, and stop before any real npm publish unless the user explicitly approves it.

---
*Phase: 10-npm-packaging-0-x-publish*
*Completed: 2026-06-16*
