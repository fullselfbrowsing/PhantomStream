---
phase: 10-npm-packaging-0-x-publish
plan: 02
subsystem: package-types
tags: [npm, exports, typescript, declarations, esm]
requires:
  - phase: 10-npm-packaging-0-x-publish
    plan: 10-01
    provides: RED package publish validation tests
provides:
  - Root package export
  - Typed conditional export map for public subpaths
  - JSDoc declaration generation through TypeScript
affects: [PKG-03, package-json, types]
tech-stack:
  added:
    - typescript
  patterns:
    - Source-first ESM runtime with generated declaration-only package types
key-files:
  created: [src/index.js, tsconfig.types.json]
  modified: [package.json, package-lock.json, tests/adapter-exports.test.js, tests/websocket-transport.test.js, src/capture/index.js, src/renderer/sanitize.js]
key-decisions:
  - "Package runtime exports remain pointed at src/**/*.js; TypeScript emits declarations only."
  - "Declaration generation is scoped to importable src modules so dist/types paths match the package export map."
patterns-established:
  - "Every public package export is a condition object with types first and default last."
requirements-completed: [PKG-03]
duration: 12min
completed: 2026-06-16
---

# Phase 10 Plan 02: Typed Package Exports Summary

**The package now has a root ESM export and generated declarations for its public import surface**

## Accomplishments

- Installed TypeScript and added `npm run types` with declaration-only generation from JavaScript.
- Added `src/index.js` as the root barrel export for protocol, capture, renderer, relay, and WebSocket transport APIs.
- Converted every public export map entry to a conditional object with `types`, `import`, and `default`, preserving source-first runtime targets.
- Updated legacy export tests to assert the new typed condition objects.
- Reworded literal CSS `@import` mentions in JSDoc comments so TypeScript's JSDoc parser does not treat them as tags during declaration emit.

## Task Commits

- **Task 1-2: Declaration generation and typed exports** - `278d9b5` (build/test)

## Verification

```bash
npm run types
node -e "const p=require('./package.json'); if(!p.devDependencies.typescript) process.exit(1); if(p.scripts.types !== 'tsc -p tsconfig.types.json') process.exit(1)"
node -e "const fs=require('fs'); const c=JSON.parse(fs.readFileSync('tsconfig.types.json','utf8')); const o=c.compilerOptions; for (const k of ['allowJs','checkJs','declaration','emitDeclarationOnly','declarationMap']) if(o[k]!==true) process.exit(1); if(o.outDir!=='dist/types') process.exit(1)"
test -f src/index.js && test -f dist/types/index.d.ts && test -f dist/types/capture/index.d.ts && test -f dist/types/renderer/index.d.ts && test -f dist/types/adapters/playwright.d.ts
node --input-type=module -e "import('@fullselfbrowsing/phantom-stream').then(() => import('@fullselfbrowsing/phantom-stream/capture')).then(() => import('@fullselfbrowsing/phantom-stream/adapters/playwright'))"
node --test tests/adapter-exports.test.js tests/websocket-transport.test.js
node --test tests/package-publish.test.js
```

Results:

- Declaration generation passed.
- Export/type acceptance checks passed.
- Adapter and WebSocket export regression tests passed (`20/20`).
- `tests/package-publish.test.js` now passes the export/type assertions and fails only on future Phase 10 work: package scripts/files whitelist, CI/publish workflow, and docs.

## Deviations from Plan

- `tsconfig.types.json` is scoped to `src/**/*.js` instead of `src/**/*.js` plus `bin/**/*.js`. Including `bin` with the same `rootDir` would either fail TypeScript root containment or move generated import declarations under `dist/types/src/**`, which would break the planned export-map paths. The CLI remains executable package surface, not an import subpath.
- Added `compilerOptions.noCheck: true` while keeping `checkJs: true`. This keeps the phase focused on declaration emit for the existing JS codebase instead of turning packaging into a full JS type-check migration.

## Next Phase Readiness

10-03 can now add package validation tooling, the files whitelist, tarball smoke tests, and CI package gates against the remaining RED package validation failures.

---
*Phase: 10-npm-packaging-0-x-publish*
*Completed: 2026-06-16*
