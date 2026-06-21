---
phase: 14-adaptive-streaming-adapter-discovery-fallback
plan: 05
subsystem: packaging
tags: [packaging, peer-dependency, optional-dependency, hls, zero-runtime-dep, supply-chain, smoke-test, publint, attw]

# Dependency graph
requires:
  - phase: 14-adaptive-streaming-adapter-discovery-fallback
    provides: "src/renderer/media-player.js with the dynamic `import('hls.js')` inside tryLazyImportHls (Plan 02) — the renderer references hls.js ONLY via that guarded dynamic import, never a top-level import, which is the precondition that makes ./renderer importable with hls.js absent"
provides:
  - "package.json peerDependencies { hls.js: >=1.5.0 } + peerDependenciesMeta { hls.js: { optional: true } } — hls.js is a host-controlled OPTIONAL peer; npm does not auto-install it and does not warn when absent; dependencies stays exactly { ws: 8.21.0 }"
  - "tests/package-publish.test.js deps-shape guard — asserts dependencies deep-equals { ws }, peerDependenciesMeta['hls.js'].optional===true, and hls.js is absent from both dependencies and devDependencies (catches any future hard-dep/dev-dep leak: T-14-17/T-14-18)"
  - "scripts/package-smoke.mjs named zero-hard-dep renderer assertion — a focused `await import('.../renderer')` in the hls.js-absent sandbox (run BEFORE the broad subpath loop) that fails with an attributable `zero-hard-dep-violation` message on a top-level-import regression; plus assertHlsNotInstalled() guarding the sandbox stays hls.js-free"
affects: [15-media-security]

# Tech tracking
tech-stack:
  added: []  # zero new HARD runtime deps; dependencies stays { ws: 8.21.0 }. hls.js is an OPTIONAL peerDependency only — declared, NOT installed by this repo (node_modules/hls.js stays absent).
  patterns:
    - "Optional peerDependency contract: a runtime player (hls.js) is declared under peerDependencies + peerDependenciesMeta.optional:true so npm neither auto-installs nor warns when absent — the host opts in with `npm i hls.js`; PhantomStream depends on nothing new"
    - "Zero-hard-dep proof via package:smoke: pack -> install into a fresh temp dir with hls.js ABSENT -> import the ./renderer subpath; success is the proof that the optional dep is dynamic-import-only. The ABSENCE of hls.js IS the test."
    - "Named, ordered guard assertion: the focused renderer import runs BEFORE the broad subpath loop so a regression is attributed by a clear domain message (zero-hard-dep-violation) instead of a generic ERR_MODULE_NOT_FOUND buried among subpaths"
    - "Deps-shape unit guard mirroring the manifest: a readJson('package.json') test pins the exact dependencies object + the optional-peer flag, so a hard-dep/dev-dep leak fails CI deterministically (no install needed to catch it)"

key-files:
  created: []
  modified:
    - package.json
    - tests/package-publish.test.js
    - scripts/package-smoke.mjs

key-decisions:
  - "Kept the `>=1.5.0` floor (14-RESEARCH documented floor) rather than pinning the current latest (1.6.16, confirmed via `npm view hls.js version`) — an OPTIONAL peer should accept the widest compatible host-installed range; the floor is the documented minimum, latest is forward-compatible."
  - "Placed peerDependencies + peerDependenciesMeta immediately before `dependencies` (after `devDependencies`) — standard npm field grouping; `dependencies` itself was left byte-identical ({ ws: 8.21.0 }) so the zero-hard-dep invariant is visually and programmatically obvious."
  - "Ran the focused zero-hard-dep renderer check BEFORE the existing broad subpath import-loop (reordered Task 2 after the regression probe) so a renderer regression is attributed by the named `zero-hard-dep-violation` message — the plan's Task-2 <behavior> explicitly wanted a clear, attributable failure 'rather than a generic import failure buried in the subpath loop'. The broad loop alone DID catch the regression (ERR_MODULE_NOT_FOUND) but only generically."
  - "Added assertHlsNotInstalled(tempDir) as a sandbox precondition — if hls.js ever got installed into the smoke sandbox it would let a regressed top-level import pass silently, defeating the proof; this hard-fails the smoke if the sandbox is misconfigured. Did NOT install hls.js (the absence is load-bearing)."
  - "Did NOT run `npm install hls.js` at any point (per the plan + the 14-RESEARCH audit-hygiene warning that slopcheck's install subcommand had previously mutated package.json/installed hls.js). Verified node_modules/hls.js stays absent after every edit."

patterns-established:
  - "Optional-peer + dynamic-import + smoke-proof triad: declare the runtime player as an optional peerDependency, reference it via a guarded dynamic import only (Plan 02), and prove the zero-hard-dep guarantee with a pack/install/import smoke where the dep is ABSENT. Reusable for any future optional host-provided player (dash.js/Shaka are seam-only, never declared)."
  - "Regression-attribution ordering: when a broad check would catch a failure generically, add a focused named check for the high-value path and run it FIRST so the failure carries a domain-specific, attributable message."

requirements-completed: [MADPT-01]

# Metrics
duration: 4min
completed: 2026-06-21
---

# Phase 14 Plan 05: hls.js Optional peerDependency + Zero-Hard-Dep Proof Summary

**Closed MADPT-01's zero-runtime-dependency half: declared hls.js ONLY as an OPTIONAL `peerDependency` (`{ hls.js: >=1.5.0 }` + `peerDependenciesMeta { hls.js: { optional: true } }`) so npm neither auto-installs it nor warns when absent — `dependencies` stays exactly `{ ws: 8.21.0 }` — and PROVED the zero-hard-dep guarantee with a named `scripts/package-smoke.mjs` assertion that imports the `./renderer` subpath in a sandbox where hls.js is NOT installed (it resolves only because Plan 02 made the hls.js import a dynamic `import('hls.js')`, never a top-level import). A `tests/package-publish.test.js` guard pins the deps shape so any future hard-dep/dev-dep leak fails CI. hls.js was never installed (`node_modules/hls.js` stays absent); full suite 660/660, differential oracle 48/48 unchanged, publint + attw green.**

## Performance

- **Duration:** ~4 min
- **Tasks:** 2 (both `type="auto"`)
- **Files:** 3 modified (0 created)
- **Tests:** 659 -> 660 (+1: the new hls.js optional-peer deps-shape guard); differential oracle 48/48 unchanged

## Accomplishments

- **`package.json` — optional hls.js peerDependency (the only packaging edit, T-14-17 mitigation).** Added `"peerDependencies": { "hls.js": ">=1.5.0" }` and `"peerDependenciesMeta": { "hls.js": { "optional": true } }`. `dependencies` is byte-unchanged at `{ "ws": "8.21.0" }` — hls.js is NOT a hard runtime dep and NOT a devDependency. `optional: true` means npm will not auto-install hls.js and will not warn when it is absent (the host-controlled, zero-hard-dep posture). Confirmed the current published version via `npm view hls.js version` -> `1.6.16`; kept the documented `>=1.5.0` floor (an optional peer should accept the widest compatible host range).
- **`tests/package-publish.test.js` — deps-shape guard.** New test `hls.js is an OPTIONAL peerDependency only, never a hard or dev dependency` asserts: `pkg.dependencies` deep-equals `{ ws: '8.21.0' }`; `typeof pkg.peerDependencies['hls.js'] === 'string'`; `pkg.peerDependenciesMeta['hls.js'].optional === true`; and `pkg.dependencies['hls.js']` / `pkg.devDependencies?.['hls.js']` are both `undefined`. This fails deterministically (no install needed) if hls.js ever leaks into `dependencies`/`devDependencies` (T-14-17/T-14-18).
- **`scripts/package-smoke.mjs` — named, ordered zero-hard-dep proof (T-14-18 mitigation).** Added `buildZeroHardDepRendererCheckSource()` (a focused `await import('@full-self-browsing/phantom-stream/renderer')` wrapped to translate any failure into a `zero-hard-dep-violation: ...renderer requires hls.js to import — hls.js must be referenced via a dynamic import('hls.js') only, never a top-level import` error) and `assertHlsNotInstalled(tempDir)` (hard-fails if hls.js somehow got installed into the smoke sandbox — the absence is the proof). The focused check runs BEFORE the existing broad subpath import-loop so a renderer regression is attributed by the named message rather than surfacing as a generic `ERR_MODULE_NOT_FOUND` buried among the other subpaths. The existing subpath import-check is intact; hls.js is NOT installed in the sandbox.

## Verification Results

- `node --test tests/package-publish.test.js` -> **6/6 pass** (was 5; +1 new deps guard).
- `npm run package:smoke` -> **exit 0** with hls.js absent (`./renderer` imports cleanly; the named zero-hard-dep renderer check passes).
- **Regression probe (proof of the guard):** temporarily injected a top-level `import 'hls.js'` into `src/renderer/media-player.js`; `npm run package:smoke` exited **1** with the named `zero-hard-dep-violation: @full-self-browsing/phantom-stream/renderer requires hls.js to import — ...` message firing FIRST. Reverted immediately; `media-player.js` is byte-clean (git status confirmed). This empirically proves a future top-level hls.js import is caught with a clear, attributable failure.
- `npm test` (full suite) -> **660/660 pass, 0 fail** (baseline 659 + 1 new test).
- `tests/differential/oracle.test.js` -> **48/48 pass** — differential oracle unchanged (no capture-wire change; packaging-only slice).
- `npm run lint:package` (publint v0.3.21) -> **"All good!"** exit 0 — the optional peerDependency is not flagged.
- `npm run attw` (arethetypeswrong, `--profile esm-only`) -> **exit 0** — all subpaths resolve green for ESM; the optional peer does not break type resolution.
- **Manual invariant confirmation:** `dependencies` is exactly `{ "ws": "8.21.0" }`; `node_modules/hls.js` does not exist; hls.js appears ONLY under `peerDependencies` (`>=1.5.0`) + `peerDependenciesMeta` (`optional: true`); no top-level `import 'hls.js'`/`from 'hls.js'` anywhere in `src/` (only the dynamic `import('hls.js')` in `media-player.js`).

## Task Commits

1. **Task 1: hls.js optional peerDependency + deps-shape publish guard** — `7565b54` (feat) — `package.json`, `tests/package-publish.test.js`
2. **Task 2: named zero-hard-dep renderer assertion in package:smoke** — `db53b95` (feat) — `scripts/package-smoke.mjs`

**Plan metadata:** (final commit) `docs(14-05): complete hls.js optional-peerDependency packaging plan`

## Files Modified

- `package.json` — added `peerDependencies` (`{ "hls.js": ">=1.5.0" }`) + `peerDependenciesMeta` (`{ "hls.js": { "optional": true } }`) immediately before `dependencies`; `dependencies` left byte-identical (`{ "ws": "8.21.0" }`).
- `tests/package-publish.test.js` — new deps-shape test (the optional-peer guard) inserted before the exports test, mirroring the existing `readJson('package.json')` assertion style.
- `scripts/package-smoke.mjs` — added `assertHlsNotInstalled()` + `buildZeroHardDepRendererCheckSource()` helpers and wired them as a named step that runs before the existing broad subpath import-check; the subpath loop and the CLI `--help` check are unchanged.

## Decisions Made

- **Kept the `>=1.5.0` floor, not a pin to 1.6.16.** Confirmed latest via `npm view hls.js version` (1.6.16) but an optional peer should accept the widest compatible host-installed range; the floor is the documented minimum.
- **Reordered the focused renderer check BEFORE the broad subpath loop.** The regression probe initially surfaced a generic `ERR_MODULE_NOT_FOUND` from the broad loop (which runs first). The plan's Task-2 `<behavior>` explicitly wants the regression to fail with a clear, attributable message "rather than a generic import failure buried in the subpath loop," so the named check now runs first.
- **Added `assertHlsNotInstalled(tempDir)` as a sandbox precondition.** If hls.js were ever installed into the smoke sandbox it would let a regressed top-level import pass silently; this hard-fails on a misconfigured sandbox. hls.js was NOT installed (its absence is the load-bearing proof).
- **Never ran `npm install hls.js`** (per the plan and the 14-RESEARCH audit-hygiene warning). Verified `node_modules/hls.js` stays absent after every edit.

## Deviations from Plan

None — the plan executed as written. The only judgment call was ordering the focused zero-hard-dep check before the existing broad subpath loop (Task 2), which realizes the plan's stated `<behavior>` intent of an attributable failure rather than a generic one; it is not a scope or design deviation. Rules 1-4 did not fire. No packages were installed (`dependencies` stays `{ ws: 8.21.0 }`; hls.js is declared optional and remains uninstalled).

## Issues Encountered

None blocking. The intermediate regression probe showed the broad subpath loop catching the regression generically before reaching the named step; the fix was a one-line reorder (focused check first). Both the happy path (exit 0) and the regression path (exit 1 with the named message) were verified empirically.

## Known Stubs

None. The packaging edit, the deps-shape guard, and the smoke assertion are all real, verified logic. The optional peerDependency is a host-controlled opt-in (the host runs `npm i hls.js`); PhantomStream itself installs nothing.

The live cross-realm MSE playback proof (real `MediaSource` blob bound to an in-iframe `<video>` with hls.js `attachMedia`) remains the documented deferred UAT carried from Plan 02 (the FSB browser runs tabs hidden -> Chrome suspends media decode; jsdom has no MSE). That is the milestone's tracked deferral, not a stub introduced by this packaging plan — and it is orthogonal to the zero-hard-dep guarantee, which this plan proves without any media engine.

## Threat Flags

None. This plan's `<threat_model>` items are all mitigated and proven:
- **T-14-17** (hls.js leaks into `dependencies` -> breaks zero-runtime-dep + package:smoke): hls.js is declared ONLY under `peerDependencies` + `peerDependenciesMeta.optional:true`; the Task-1 publish test asserts `dependencies` deep-equals `{ ws }` and hls.js is in neither deps nor devDeps; the Task-2 smoke run proves the renderer imports with hls.js absent.
- **T-14-18** (a future top-level `import 'hls.js'` reintroduces a hard dep silently): caught by the explicit named zero-hard-dep smoke assertion — empirically proven by the regression probe (exit 1 with the named message).
- **T-14-SC** (supply-chain / npm installs in this plan): hls.js is `[OK]` (slopcheck-verified, created 2016, 6.37M dl/wk, no postinstall — 14-RESEARCH) but is NEVER installed by this repo; it is an optional peerDependency only. No package was added to `dependencies`/`devDependencies`; `node_modules/hls.js` confirmed absent after the edit. No `[ASSUMED]`/`[SUS]`/`[SLOP]` package introduced -> no blocking legitimacy checkpoint required.

No NEW security surface: no new network endpoint, auth path, file access pattern, or schema change at a trust boundary. The capture wire is byte-unchanged (packaging-only slice) -> differential oracle 48/48.

## Next Phase Readiness

- **MADPT-01 is now fully closed** — both halves complete: Plan 02 built the parent-realm adaptive player with the dynamic-import-only hls.js path + graceful degrade; this plan formalized hls.js as the OPTIONAL peerDependency and proved the zero-hard-dep guarantee end-to-end (manifest declaration + smoke proof + deps-shape guard).
- **Phase 14 is complete** (14-01 protocol, 14-02 parent-realm player + fallback + CSP blob:, 14-03 renderer wiring + handleMediaHint + correlation + teardown, 14-04 adapter discovery -> STREAM.MEDIA_HINT, 14-05 packaging). Requirements MADPT-01..04 satisfied.
- **Phase 15 (Media Security, Masking, Threat Model & Docs — MSEC-03, MSEC-04)** inherits a published-package posture with hls.js as an optional, host-controlled peer and a CI-enforced zero-hard-dep guarantee. The parent-realm object-URL threat model (MSEC-04) and the asset/media URL masking vocabulary (MSEC-03) remain scoped to Phase 15.
- Full suite **660/660** green; differential oracle **48/48**; `package:smoke` exit 0 with hls.js absent; publint "All good!"; attw exit 0; `dependencies` = `{ ws: 8.21.0 }`; `node_modules/hls.js` absent.

## Self-Check: PASSED

- FOUND: `package.json` peerDependencies `{ "hls.js": ">=1.5.0" }` + peerDependenciesMeta `{ "hls.js": { "optional": true } }`; dependencies exactly `{ "ws": "8.21.0" }`
- FOUND: `tests/package-publish.test.js` new test `hls.js is an OPTIONAL peerDependency only, never a hard or dev dependency` (6/6 pass)
- FOUND: `scripts/package-smoke.mjs` `buildZeroHardDepRendererCheckSource()` + `assertHlsNotInstalled()` (package:smoke exit 0 with hls.js absent; regression probe exit 1 with named message)
- FOUND commit `7565b54` (Task 1, feat); FOUND commit `db53b95` (Task 2, feat)
- Verified: full suite 660/660; differential oracle 48/48; publint "All good!"; attw exit 0; `node_modules/hls.js` absent; no top-level hls.js import in `src/`

---
*Phase: 14-adaptive-streaming-adapter-discovery-fallback*
*Completed: 2026-06-21*
