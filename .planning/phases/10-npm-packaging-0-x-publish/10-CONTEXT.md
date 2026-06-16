# Phase 10: npm Packaging & 0.x Publish - Context

**Gathered:** 2026-06-16T07:22:02Z
**Status:** Ready for planning
**Mode:** Auto-generated via `gsd-autonomous` / `gsd-discuss-phase --auto`

<domain>
## Phase Boundary

Phase 10 turns the now-complete PhantomStream framework into a publishable npm
package. It must produce an installable `@fullselfbrowsing/phantom-stream`
0.x package with clean ESM subpath exports, JSDoc-generated `.d.ts` files,
`attw` / `publint` / tarball-install validation, trusted-publishing/provenance
setup, and quickstart docs for the supported adapter paths.

Publishing to the public npm registry is in scope, but it is an authentication
gate: implementation agents may prepare and dry-run everything autonomously,
but must stop before a real `npm publish` unless authenticated trusted
publishing is already configured and the user has explicitly allowed the
publish action in this workspace.

</domain>

<decisions>
## Implementation Decisions

### Package Surface

- **D-01:** Keep the runtime package source-first ESM. Do not introduce a
  bundling/build step for library JavaScript; browser injection continues to
  use the checked-in classic script artifacts already present in `src/adapters/`.
- **D-02:** Preserve existing public subpath names from `package.json`:
  `./protocol`, `./capture`, `./renderer`, `./relay`,
  `./transport/websocket`, `./adapters/playwright`,
  `./adapters/extension`, and `./adapters/bookmarklet`.
- **D-03:** Add generated type declarations without migrating sources to
  TypeScript. Use a JSDoc/`tsc` declaration pipeline that emits `.d.ts` for
  every public subpath and keeps source imports build-free.
- **D-04:** Prefer a package `files` whitelist over broad `.npmignore`
  behavior. Include runtime `src/`, `bin/`, selected examples/quickstarts,
  generated declarations, README/license/security docs, and package metadata.
  Exclude `.planning/`, `reference/`, tests, local context, and agent artifacts
  from the published tarball.

### Publication Gate

- **D-05:** Treat `npm publish` as a human/auth gate. Automated Phase 10 work
  may run `npm pack`, `npm publish --dry-run`, `attw --pack`, `publint`, and
  tarball-install smoke tests. A real publish requires npm/GitHub trusted
  publishing credentials and explicit user approval at execution time.
- **D-06:** Trusted publishing/provenance is the preferred release path.
  Planning should research current official npm/GitHub trusted-publishing
  docs and add CI configuration only after confirming the current required
  workflow permissions and package settings.

### Validation And Docs

- **D-07:** Permanent validation should include `npm test`, declaration
  generation, `attw --pack`, `publint`, `npm pack`, and a fresh temp-project
  install/import smoke that exercises the public subpaths and CLI binary.
- **D-08:** Quickstarts must cover the four supported user paths:
  embedded loopback, Playwright/CDP, extension MV3, and bookmarklet. Each path
  should be runnable in under five minutes from a clean install and should
  point to the existing demos where possible.
- **D-09:** Do not claim Phase 12 evaluation results, baseline comparisons, or
  ablation tables in package docs. Phase 10 docs can explain CSSOM mode and
  demos, but measured research claims remain Phase 12/13.

### the agent's Discretion

The agent may choose exact declaration output paths, CI job names, and docs
layout as long as public subpaths remain stable and the validation commands
are reproducible from a clean checkout.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Roadmap And Requirements

- `.planning/ROADMAP.md` — Phase 10 goal, success criteria, and dependencies.
- `.planning/REQUIREMENTS.md` — PKG-03 and PKG-04 requirements.
- `.planning/PROJECT.md` — package constraints, source-first ESM decision, and current validated surface.
- `.planning/STATE.md` — Phase 9 completion decisions and next-phase status.

### Phase Dependencies

- `.planning/phases/09-cssom-capture-mode/09-08-SUMMARY.md` — CSSOM mode final gate, docs, and package-readiness notes.
- `.planning/phases/06-extension-mv3-bookmarklet-adapters/06-05-SUMMARY.md` — extension/bookmarklet adapter surfaces and verification.
- `.planning/phases/05-playwright-cdp-adapter-remote-control-agent-demo/05-06-SUMMARY.md` — Playwright/CDP adapter and demo surface.
- `.planning/phases/04-relay-ws-transport-two-tab-demo/04-04-SUMMARY.md` — two-tab CLI demo and WebSocket transport surface.

### Package Surface

- `package.json` — current package name, version, exports, bin, scripts, and dependency set.
- `README.md` — current project-level user-facing entrypoint.
- `src/capture/README.md` — capture API and `styleMode` docs.
- `src/renderer/README.md` — renderer API, sandbox, and CSSOM reconstruction docs.
- `src/relay/README.md` — relay package surface.
- `docs/ARCHITECTURE.md` — system overview and remaining limitations.
- `docs/SECURITY.md` — embed security contract that package docs must preserve.

### Tooling Docs To Research During Planning

- Official npm trusted publishing and provenance docs.
- Official TypeScript `allowJs` / `checkJs` / declaration emit docs.
- Official Are The Types Wrong CLI/package docs.
- Official publint docs.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- `package.json` already has the package name, ESM mode, bin entry, and public subpath exports.
- `bin/phantom-stream.js` already exposes demo commands that quickstarts can reuse.
- `examples/` contains loopback, two-tab, extension, bookmarklet, and Playwright demo assets suitable for docs and tarball smoke tests.
- `src/adapters/playwright-inject.js` is a checked-in artifact; Phase 10 should validate it is included only where needed and does not require a build step.

### Established Patterns

- Tests use Node's built-in `node --test`.
- Package code is plain JS ESM with JSDoc types; runtime JS is not compiled.
- Security docs and static scans enforce sandbox/CSP/sanitizer posture.
- Previous phases commit planning artifacts separately from implementation commits.

### Integration Points

- Public package exports and generated type declarations must align exactly.
- CI should extend the existing test posture rather than replacing it.
- Tarball install smoke should use a temporary project so it catches missing files and bad exports.

</code_context>

<specifics>
## Specific Ideas

Auto-selected defaults:

- Use a generated declaration pipeline instead of source migration.
- Keep publish as a checkpoint/auth gate, not an implicit background action.
- Prefer docs that lead users to existing demos rather than duplicating long setup flows.

</specifics>

<deferred>
## Deferred Ideas

- Phase 11 owns FSB swap-in and 1.0 freeze.
- Phase 12 owns baseline fairness, ablation tables, and performance/fidelity numbers.
- Phase 13 owns paper claims and submission packaging.

</deferred>

---

*Phase: 10-npm-packaging-0-x-publish*
*Context gathered: 2026-06-16*
