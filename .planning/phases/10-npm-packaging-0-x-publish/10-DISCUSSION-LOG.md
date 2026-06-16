# Phase 10 Discussion Log

**Date:** 2026-06-16
**Mode:** Auto (`gsd-autonomous` / `gsd-discuss-phase --auto`)

## Auto-Selected Gray Areas

- **Package surface:** Keep source-first ESM and preserve existing subpath exports.
- **Types:** Generate `.d.ts` from JSDoc with TypeScript tooling; do not migrate sources.
- **Publication:** Prepare trusted publishing and provenance, but gate real `npm publish` on authentication and explicit user approval.
- **Validation:** Add permanent `attw --pack`, `publint`, tarball-install, declaration-generation, and public import/CLI smoke checks.
- **Quickstarts:** Cover embedded loopback, Playwright/CDP, extension MV3, and bookmarklet paths using existing demos where possible.

## Notes

Phase 10 must research current official npm/GitHub trusted-publishing requirements before implementing release CI. Phase 12 evaluation claims remain out of scope for package docs.
