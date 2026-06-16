---
phase: 10
slug: npm-packaging-0-x-publish
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-06-16
---

# Phase 10 — Validation Strategy

> Per-phase validation contract for packaging and publish-readiness.

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Node built-in `node --test`, npm package tooling |
| **Config file** | `package.json`, `tsconfig.types.json`, `.github/workflows/*.yml` |
| **Quick run command** | `npm test` |
| **Full suite command** | `npm test && npm run package:check` |
| **Estimated runtime** | ~30 seconds locally after dependencies install |

## Sampling Rate

- **After every task commit:** Run the task-specific package check or `npm test`.
- **After every plan wave:** Run `npm test && npm run package:check`.
- **Before `$gsd-verify-work`:** Full suite plus tarball install smoke must be green.
- **Max feedback latency:** 60 seconds for packaging checks.

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 10-01-01 | 01 | 0 | PKG-03 | T-10-01 | Tarball excludes private/planning/reference files | package smoke | `node --test tests/package-*.test.js` | ❌ W0 | ⬜ pending |
| 10-02-01 | 02 | 1 | PKG-03 | T-10-02 | Public exports and types align | types/package | `npm run types && npm run lint:package && npm run attw` | ❌ W1 | ⬜ pending |
| 10-03-01 | 03 | 2 | PKG-03 | T-10-03 | CI validates package shape before publish | CI static | `node --test tests/package-*.test.js` | ❌ W2 | ⬜ pending |
| 10-04-01 | 04 | 3 | PKG-04 | — | Quickstarts are command-verifiable and content-safe | docs/test | `node --test tests/package-docs*.test.js` | ❌ W3 | ⬜ pending |
| 10-05-01 | 05 | 4 | PKG-03 | T-10-04 | Publish remains auth-gated and provenance-ready | dry-run/manual | `npm publish --dry-run --access public` | ❌ W4 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

## Wave 0 Requirements

- [ ] Package validation tests/smokes for exports, types, tarball contents, and CLI.
- [ ] Temporary install smoke script or test helper.
- [ ] Package docs tests for quickstart commands, if docs are generated/updated.

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Real public npm publish | PKG-03 | Requires npm/GitHub trusted publishing setup, package write permission, and explicit user approval | After all dry-run/package checks pass, user configures trusted publisher or authenticates npm, then approves `npm publish --access public` or staged publish |

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all missing package validation references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
