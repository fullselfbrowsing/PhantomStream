---
phase: 10
slug: npm-packaging-0-x-publish
status: complete
created: 2026-06-16
sources:
  - https://docs.npmjs.com/trusted-publishers/
  - https://docs.npmjs.com/generating-provenance-statements/
  - https://docs.npmjs.com/creating-and-publishing-scoped-public-packages/
  - https://docs.npmjs.com/cli/v11/commands/npm-trust/
  - https://www.typescriptlang.org/docs/handbook/declaration-files/dts-from-js.html
  - https://publint.dev/docs/
  - https://publint.dev/rules
  - https://github.com/arethetypeswrong/arethetypeswrong.github.io
---

# Phase 10 Research — npm Packaging & 0.x Publish

## Research Complete

Phase 10 is packaging/release infrastructure, not runtime feature work. The
main planning risks are package metadata shape, generated declaration layout,
release/auth gates, tarball contents, and quickstart accuracy.

## Live Registry Check

`npm view @fullselfbrowsing/phantom-stream version --json` returned `E404`
on 2026-06-16. Treat the name as not currently visible on the public npm
registry from this environment, while preserving the normal caveat that a
private package or permission issue can also produce not-found output.

## Current Codebase State

- `package.json` already has:
  - `"name": "@fullselfbrowsing/phantom-stream"`
  - `"version": "0.1.0"`
  - `"type": "module"`
  - `"bin": { "phantom-stream": "./bin/phantom-stream.js" }`
  - public subpath exports for protocol, capture, renderer, relay,
    websocket transport, and adapters.
- There is no `types`, `files`, `publishConfig`, declaration build script,
  package validation script, or release workflow yet.
- CI currently runs `npm ci` and `npm test` on Node 20/22/24.
- README user-facing examples already assume npm installation; Phase 10 must
  make those examples true and update stale feature/status wording.

## Official Tooling Findings

### npm trusted publishing and provenance

npm trusted publishing uses OIDC from supported CI/CD providers. GitHub Actions
is supported only on GitHub-hosted runners; npm explicitly says self-hosted
runners are not supported for trusted publishing at this time. For GitHub
Actions, npm trusted publisher setup requires the npm package settings to name
the GitHub owner, repository, workflow filename under `.github/workflows/`, and
optionally an environment name. The workflow must have `id-token: write` so
GitHub can mint the OIDC token. npm also requires the `repository.url` in
`package.json` to match the GitHub repository for publishing from GitHub.

Trusted publishing automatically generates provenance attestations for public
packages published from public repositories through GitHub Actions/GitLab, so
`--provenance` is not required on the publish command when trusted publishing
is active. Direct first-time scoped public publish still requires
`npm publish --access public`, and direct publishing requires 2FA or a granular
access token with bypass 2FA. npm's current `npm trust` CLI can configure trust
relationships, but it requires npm 11.10.0+, package write access, account-level
2FA, and an existing package; that makes first publish/package creation a
likely user/auth gate.

Planning implication:

- Add a release workflow skeleton with `permissions: contents: read,
  id-token: write`, `actions/setup-node` registry URL, `npm ci`, build/test/
  package validation, and a guarded publish/stage step.
- Treat real publish and trusted-publisher setup as manual/auth gates unless
  credentials and explicit user approval are present.
- Prefer staged publishing or protected environments for safety if the user
  wants CI-controlled release approval.

### TypeScript declarations from JS

TypeScript officially supports generating `.d.ts` from JavaScript with
`allowJs`, `declaration`, and `emitDeclarationOnly`, optionally `outDir` and
`declarationMap`. This matches the project decision to keep plain JS ESM plus
JSDoc types.

Planning implication:

- Add `typescript` as a dev dependency.
- Add a `tsconfig.types.json` (or equivalent) that includes public `src/**/*`
  and any needed bin/demo entry types, uses `allowJs`, `checkJs`, `declaration`,
  `emitDeclarationOnly`, `declarationMap`, `outDir`, and ESM-appropriate
  module/moduleResolution settings.
- Add `npm run types` and make package validation depend on generated types.
- Export-map entries should include `"types"` conditions before JS conditions
  so TypeScript and publint resolve declarations first.

### publint

publint lints npm package metadata and published file layout for compatibility
across environments. Its docs state that if a package has a build step, the
build must run before publint so it can inspect the files that will be
published. publint rules include order-sensitive export-map guidance such as
putting `"types"` first and `"default"` last, and it reports missing/unpublished
files.

Planning implication:

- Add `publint` as a dev dependency and `npm run lint:package`.
- Run declaration generation before publint.
- Expect package `exports` to change from string targets to condition objects
  with `"types"` first and `"default"` last.

### Are The Types Wrong

Are The Types Wrong analyzes package contents for TypeScript type resolution
issues, especially ESM-related package/export-map problems across node and
bundler resolution modes. Its project README points local package checks to
`@arethetypeswrong/cli`.

Planning implication:

- Add `@arethetypeswrong/cli` as a dev dependency.
- Prefer running ATTW against the actual packed tarball or `npm pack` output,
  not just source files, so missing files and export-map errors are caught.

## Recommended Package Shape

Use a source-first package with generated declarations:

- Runtime JS remains under `src/`.
- Declarations emit under a generated directory such as `dist/types/`.
- Package `exports` become condition objects:
  - `"types": "./dist/types/<subpath>.d.ts"` first
  - `"default": "./src/<subpath>.js"` last
- Root export should be explicitly handled. Either:
  - add `src/index.js` that re-exports stable public surfaces and a matching
    `dist/types/index.d.ts`, or
  - remove/avoid misleading root `main` if the package is intentionally
    subpath-only.

Because `main` currently points at `src/protocol/index.js`, the planner must
choose a non-misleading root strategy. Preferred: create `src/index.js` as a
safe aggregate public root and keep `main`/root export aligned with it.

Use a `files` whitelist to keep the tarball small and safe:

- include `src/`, `dist/types/`, `bin/`, selected `examples/`, `README.md`,
  `LICENSE`, and security/architecture docs needed by quickstarts;
- exclude `.planning/`, `reference/`, `tests/`, `.context/`, local logs, and
  agent artifacts.

## Quickstart Strategy

Do not invent new demo flows. Quickstarts should reuse already-tested paths:

1. Embedded loopback: `npm run example:loopback` in repo; package docs show
   direct `createCapture` + `createViewer` loopback wiring for consumers.
2. WebSocket/two-tab: `npx phantom-stream demo` / `phantom-stream demo`.
3. Playwright/CDP: `phantom-stream playwright-demo` plus a short adapter code
   sample using `createPlaywrightAdapter`.
4. Extension and bookmarklet: document adapter factories, required local
   relay URL, and existing demo commands/assets.

Each quickstart should specify prerequisites, command, expected success signal,
and the fastest troubleshooting check. Avoid measured bandwidth/latency claims;
those remain Phase 12.

## Validation Architecture

Phase 10 validation must sample the actual published shape, not only source:

- `npm test`
- `npm run types`
- `npm run lint:package` (`publint`)
- `npm run attw` (ATTW on packed output)
- `npm pack --dry-run`
- `npm pack --json`
- tarball install smoke:
  - create a temp directory;
  - `npm init -y`;
  - `npm install <packed .tgz>`;
  - import every public subpath in Node ESM;
  - run `phantom-stream --help` or an equivalent content-free CLI check;
  - verify `.planning`, `reference`, and `tests` are absent from package contents.
- release workflow static checks:
  - `.github/workflows/publish.yml` has `id-token: write`;
  - uses GitHub-hosted `ubuntu-latest`;
  - sets `registry-url: https://registry.npmjs.org`;
  - runs package validation before publish;
  - publish command is gated by tag/release and does not run in normal CI.

Manual/auth gates:

- npm trusted-publisher setup on npmjs.com or `npm trust` cannot be completed
  unless the package exists, the user has package write access, and account
  2FA/auth is available.
- Real `npm publish --access public` must stop for explicit user approval.

## Threat Model Notes For Plans

- **Credential leakage:** do not add `NPM_TOKEN` secrets or long-lived tokens
  unless the user explicitly chooses token publishing. Default to OIDC trusted
  publishing.
- **Accidental public payload:** package whitelist must keep `reference/`,
  `.planning/`, tests, local logs, and context files out of the tarball.
- **Broken type exports:** publint/ATTW and temp install smoke are mandatory.
- **Unreviewed publish:** real publish is a checkpoint/auth gate, not an
  autonomous background task.

## Recommended Plan Waves

1. RED package validation tests/smokes for tarball contents, exports, types,
   and scripts.
2. Type declaration generation and package export map.
3. Package validation tooling (`publint`, ATTW, pack/tarball smoke) and CI.
4. Quickstart docs and README/package docs refresh.
5. Publish workflow/auth-gated release prep and final verification.

