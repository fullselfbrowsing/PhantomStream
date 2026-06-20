---
phase: 12-static-assets-by-reference
plan: 03
subsystem: renderer
tags: [viewer-fetch-gate, asset-origin-policy, ssrf, mediaMode, currentsrc-pin, fail-closed, csp, sandbox, jsdom]

# Dependency graph
requires:
  - phase: 12-01 (Wave 1)
    provides: renderer-asset-policy + renderer-asset-gate RED scaffolds (the GREEN targets); confirm-only CSP assertion (img-src present, no script-src/media-src)
  - phase: 12-02 (Wave 2 capture)
    provides: capture now emits clone-only data-ps-currentsrc + data-ps-asset-unavailable (blob/oversized-data) placeholders -- the wire surfaces this viewer side consumes
  - phase: 03-renderer
    provides: createViewer + buildSnapshotHtml string layer + diff applier + post-parse scrub + sandbox/CSP invariants
provides:
  - classifyAssetOrigin + isPrivateOrLocalHost pure fail-closed origin classifier (src/renderer/asset-policy.js; Phase-15-reusable)
  - gateAssetUrl(url, ctx) pure renderer fetch gate + mediaMode/assetOriginPolicy/allowAssetOrigins config on createViewer
  - pre-write fetch gate at all 4 renderer write sites (string-layer snapshot, diff ADD, diff ATTR, subtree-response) + post-parse defense-in-depth
  - renderer-side data-ps-asset-unavailable="blocked-origin" placeholder + ASST-03 currentSrc pin (effective src = data-ps-currentsrc, srcset/sizes neutralized)
  - host-driven createViewer API (mount alias + optional transport + handleSnapshot on the handle)
  - docs/SECURITY.md "Viewer-side resource fetching" section + img-src/mediaMode/section purity markers
affects: [phase-13-media, phase-15-masking]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pure fail-closed origin classifier (compileMaskSelector precedent): classifyAssetOrigin returns { allowed, reason }; any non-public-https (parse-error / bad-scheme / private-host / unqualified-host) blocks. DOM-free, network-free, table-testable, Phase-15-reusable."
    - "Pre-write fetch gate at the STRING layer for snapshots (Pitfall 1): gateSnapshotAssets rewrites blocked <img>/currentSrc-pinned values in payload.html BEFORE buildSnapshotHtml assembles the srcdoc, so a real browser's parser never fetches a blocked origin. Rewrites typed emitted values -- NOT scrub-then-reparse (mXSS-distinct); no innerHTML sink added; CSP_META byte-unchanged."
    - "Injected gate hooks into the diff applier (mirrors the identity injection): createViewer passes gateFragmentAssets (inert ADD/subtree template content) + gateAssetUrl (ATTR src/poster pre-setAttribute); omitted hooks default to no-ops so applyMutations' public signature is unchanged."
    - "Renderer-owned placeholder, duplicated not coupled (sanitize.js scrubCssText precedent): a string twin in snapshot.js + a DOM twin in index.js; neither imports from capture. Placeholders carry NO live identity attr -- the renderer pairs elements with the nodeIds sidecar positionally (Phase 7), and an <img>->/<div> 1:1 swap preserves that pairing."
    - "API-style-gated optional transport: cfg.container (wire API) keeps transport REQUIRED (original contract); cfg.mount (host-driven API) makes transport optional with a no-op default + exposes handleSnapshot, so the asset path renders snapshots with no socket."

key-files:
  created:
    - src/renderer/asset-policy.js
  modified:
    - src/renderer/index.js
    - src/renderer/snapshot.js
    - src/renderer/diff.js
    - docs/SECURITY.md
    - tests/security-chokepoint-purity.test.js
    - tests/renderer-viewer.test.js
    - tests/semantic-addressing.test.js

key-decisions:
  - "gateAssetUrl precedence (documented + asserted): (1) mediaMode 'off' blocks all; (2) allowAssetOrigins host-match WIDENS (the only way a private/non-https host is reachable); (3) classifyAssetOrigin deny is AUTHORITATIVE unless (2) widened it; (4) assetOriginPolicy hook fail-closed (throw OR non-true blocks, never opens); (5) 'poster' permits poster images, 'reference' permits all by-reference assets. Classifier-first-then-hook matches the must_haves order."
  - "IPv6 brackets are NOT stripped by Node's WHATWG URL (verified: new URL('https://[::1]/').hostname === '[::1]'). isPrivateOrLocalHost strips the brackets before its IPv6 ::1 / fc00::/7 checks -- the RESEARCH reference body assumed brackets stripped; reality required the explicit strip."
  - ".local routes to 'unqualified-host', not 'private-host' (the table scaffold pins this): the .local suffix check lives ONLY in classifyAssetOrigin's unqualified branch, not in isPrivateOrLocalHost; 'localhost' (dotless) still classifies private-host via the explicit equality check."
  - "Snapshot gate is the AUTHORITATIVE site at the string layer; the post-parse DOM gate + diff-path gates are defense-in-depth. This is the single most important timing decision (Pitfall 1) and is documented in SECURITY.md; real pre-fetch suppression is Playwright UAT only (jsdom never parses srcdoc nor fetches)."
  - "Public handle extended by exactly ONE member (handleSnapshot), not three -- the gate scaffold only drives handleSnapshot; keeping the surface minimal limited the locked-surface-test churn to a one-line list extension in two tests."

patterns-established:
  - "Fetch control vs injection control are SEPARATE: classifyAssetOrigin (is this origin safe to FETCH? https-only + private deny) is distinct from hasDangerousScheme (can this URL execute script?). An https URL to an internal host passes injection yet is blind-SSRF -- blocked here."
  - "mediaMode posture switch on createViewer (default 'reference'); 'off' removes the fetch surface entirely; 'poster' is the P12 escape hatch (poster images still fetch; full off/poster/reference split matures Phase 13)."

requirements-completed: [ASST-02, ASST-03, MSEC-01, MSEC-02]

# Metrics
duration: 42min
completed: 2026-06-20
---

# Phase 12 Plan 03: Renderer Fetch Gate + mediaMode + currentSrc Pin Summary

**Established the viewer-side-fetch security model: a pure fail-closed https-only + private-range origin classifier and a `gateAssetUrl` orchestrator wired PRE-WRITE at all four renderer write sites (string-layer snapshot, diff ADD/ATTR, subtree) so a blocked origin is replaced by a dimensioned `blocked-origin` placeholder and the viewer's browser never issues the GET, with `mediaMode` posture (default `reference`), the ASST-03 currentSrc pin + srcset/sizes neutralization, and the sandbox/CSP invariants held byte-for-byte -- both RED scaffolds (15 + 8) GREEN and the full suite 449/449.**

## Performance

- **Duration:** ~42 min
- **Completed:** 2026-06-20
- **Tasks:** 3
- **Files modified:** 8 (1 created, 7 modified)

## Accomplishments

- **MSEC-01 pure origin classifier.** `src/renderer/asset-policy.js` exports `classifyAssetOrigin(url) -> { allowed, reason }` and `isPrivateOrLocalHost(host)` -- DOM-free, network-free, fail-closed (https-only; denies localhost/127.0.0.0-8/10.0.0.0-8/172.16.0.0-12 incl. the /12 boundary/192.168.0.0-16/169.254.0.0-16/::1/fc00::-7/`.local`/unqualified; any parse error blocks). Reasons in {ok, bad-scheme, private-host, unqualified-host, parse-error}. Exported as a pure, table-tested, Phase-15-reusable seam. Fills `tests/renderer-asset-policy.test.js` (15) to GREEN.
- **MSEC-01/MSEC-02 gate + config.** Module-level `gateAssetUrl(url, ctx)` (pure, fail-closed, the documented 5-step precedence) plus `createViewer` config: `mediaMode` (default `reference`, invalid value throws at factory time -- the one sanctioned throw site), `assetOriginPolicy` (fail-closed hook: throw OR non-`true` blocks), `allowAssetOrigins` (host allowlist widen).
- **Pre-write gate at all four write sites.** Snapshot is gated at the STRING/payload layer (`gateSnapshotAssets` in `snapshot.js`) BEFORE `buildSnapshotHtml` assembles the srcdoc (Pitfall 1 -- the parser fetches `<img src>` during parse, before any post-parse scrub). Diff ADD + subtree-response gate inert `<template>` content before `importNode`; diff ATTR gates `src`/`poster` before `setAttribute`. The post-parse mirror-body scrub re-gates as defense-in-depth. Blocked -> dimensioned `<div data-ps-asset-unavailable="blocked-origin">`; the viewer never GETs the blocked origin.
- **ASST-03 currentSrc pin.** When a mirrored `<img>` carries `data-ps-currentsrc`, the renderer sets its effective `src` to that value and removes `srcset`/`sizes` (string layer + DOM fragment path) so the cross-origin viewer's DPR cannot re-negotiate a different variant. Fills `tests/renderer-asset-gate.test.js` (8) to GREEN.
- **Sandbox/CSP invariants held.** `git diff` confirms the sandbox assertion block and `CSP_META` are byte-unchanged; no `allow-scripts` literal in any renderer module; the snapshot string gate added no `innerHTML` sink (snapshot.js stays 0; index.js stays 2; diff.js stays 2). `media-src` deferred to Phase 13; no `script-src` added.
- **SECURITY.md (MSEC docs).** New "Viewer-side resource fetching" section documents the render-inert->fetch verb change, the fail-closed denylist, the hook + allowlist, the `mediaMode` default `reference` + P12 poster scope, the pre-write string-layer timing rule, the currentSrc pin, and the unchanged sandbox/CSP. All pinned chokepoint-purity markers preserved; `img-src http: https: data:` / `Viewer-side resource fetching` / `mediaMode` added as new guard markers so the asset CSP surface cannot silently regress.

## Task Commits

Each task was committed atomically:

1. **Task 1: Pure classifyAssetOrigin module (https-only + private-range deny, fail-closed)** - `efbd8c1` (feat)
2. **Task 2: gateAssetUrl + mediaMode/hook/allowlist + pre-write gate at all four sites + currentSrc pin** - `bc8e03e` (feat)
3. **Task 3: Document the viewer-side-fetch surface in docs/SECURITY.md** - `e26bcde` (docs)

**Plan metadata:** committed with this SUMMARY (docs: complete plan)

_Note: both TDD tasks filled pre-existing Wave-0 RED scaffolds; the RED state was confirmed (23/23 failing) before each GREEN implementation. The scaffolds needed no edit -- they were filled purely by the implementation._

## Files Created/Modified

- `src/renderer/asset-policy.js` - **created** - pure `classifyAssetOrigin` + `isPrivateOrLocalHost`; https-only + private/internal/ULA/.local/unqualified deny; fail-closed on parse error; no `allow-scripts` literal.
- `src/renderer/index.js` - **modified** - module-level `gateAssetUrl(url, ctx)`; `createViewer` reads `mediaMode`/`assetOriginPolicy`/`allowAssetOrigins` (mediaMode validated at factory time); `mount` alias + optional-transport (host-driven API); `gateAsset` closure; `buildAssetPlaceholderEl` + `gateFragmentAssets` DOM-fragment gate; snapshot string-layer gate in `handleSnapshot`; gate wired into the post-parse scrub + subtree-response + the diff hooks; `handleSnapshot` exposed on the handle (envelope-or-bare-payload tolerant).
- `src/renderer/snapshot.js` - **modified** - `gateSnapshotAssets(html, gate)` string-layer pre-srcdoc gate + `assetUnavailablePlaceholderTag` (renderer-owned string placeholder) + tag-attr read/strip/set helpers. `CSP_META` byte-unchanged.
- `src/renderer/diff.js` - **modified** - injected `gateFragmentAssets` (ADD/subtree inert template) + `gateAssetUrl` (ATTR src/poster pre-setAttribute) hooks; blocked ATTR drops the attribute and counts a blockedUrl. Existing innerHTML sinks unchanged.
- `docs/SECURITY.md` - **modified** - new section 6 "Viewer-side resource fetching" + an asset must-never; Residual Risks renumbered to 7; all pinned markers preserved.
- `tests/security-chokepoint-purity.test.js` - **modified** - added `img-src http: https: data:` / `Viewer-side resource fetching` / `mediaMode` to the SECURITY.md required-markers list (guards the new asset CSP surface).
- `tests/renderer-viewer.test.js` - **modified** - extended the handle-surface lock test to include the new host-driven `handleSnapshot` (10 members).
- `tests/semantic-addressing.test.js` - **modified** - same one-line handle-surface lock extension.

## Decisions Made

- **gateAssetUrl precedence** documented and asserted: mediaMode 'off' -> allowAssetOrigins widen -> classifier (authoritative deny) -> assetOriginPolicy fail-closed hook -> posture allow. Classifier-first-then-hook matches the plan must_haves.
- **Snapshot gated at the string layer (authoritative); post-parse + diff paths defense-in-depth** -- the single most important timing decision (Pitfall 1), documented in SECURITY.md.
- **Public handle extended by exactly one member** (`handleSnapshot`) to minimize locked-surface-test churn.
- **Playwright asset UAT: DEFERRED** (recorded per the project's UAT-deferral precedent). jsdom never parses srcdoc, never enforces meta-CSP, and never fetches, so real pre-fetch suppression, real CSP enforcement, real blocked-origin GET suppression, and real `srcset` re-negotiation are Playwright-only; the jsdom + pure layers prove the gate LOGIC (which URL is written vs replaced), which is what this plan's 23 tests assert.

## Deviations from Plan

The three task-shaped deviations below were all necessary to reconcile the Plan 12-03 RED scaffold's expected `createViewer` API with the shipped viewer, and to keep my just-written code correct against the verified jsdom/URL behavior. No architectural (Rule 4) changes; no auth gates; `reference/` untouched; no packages installed.

### Auto-fixed Issues

**1. [Rule 1 - Bug] IPv6 bracket-strip + `.local` precedence in classifyAssetOrigin**
- **Found during:** Task 1 (filling the asset-policy table to GREEN)
- **Issue:** The RESEARCH reference body assumed `new URL('https://[::1]/').hostname` strips brackets; verified empirically it returns `'[::1]'` (brackets retained), so `::1`/`fc00::/7` rows failed. Separately, `.local` was matching `isPrivateOrLocalHost` first (-> `private-host`) but the table pins `host.local` -> `unqualified-host`.
- **Fix:** Strip surrounding brackets inside `isPrivateOrLocalHost` before the IPv6 checks; move the `.local` suffix check out of `isPrivateOrLocalHost` into the `unqualified-host` branch (keeping `localhost` -> `private-host`); exempt bracketed IPv6 from the dotless `unqualified` check.
- **Files modified:** src/renderer/asset-policy.js
- **Verification:** `node --test tests/renderer-asset-policy.test.js` 15/15 GREEN.
- **Committed in:** efbd8c1 (Task 1 commit)

**2. [Rule 3 - Blocking] createViewer host-driven API: mount alias + optional transport + handleSnapshot + envelope unwrap**
- **Found during:** Task 2 (filling the asset-gate suite to GREEN)
- **Issue:** The gate scaffold calls `createViewer({ document, mount, mediaMode })` (no `container`, no `transport`) and `viewer.handleSnapshot({ type, payload })`, but the shipped `createViewer` required `cfg.container` + a complete `cfg.transport` and kept `handleSnapshot` internal expecting a bare payload -- so every gate test failed to even construct/render.
- **Fix:** Accept `cfg.mount` as a `container` alias and treat it as the host-driven API; make transport optional (no-op default) ONLY for the host-driven path while the wire-driven `cfg.container` path keeps transport REQUIRED (original contract preserved); fall back to `cfg.document` for the construction document; expose `handleSnapshot` on the handle; make `handleSnapshot` tolerant of both a bare payload and a `{ type, payload }` envelope.
- **Files modified:** src/renderer/index.js
- **Verification:** `node --test tests/renderer-asset-gate.test.js` 8/8 GREEN; the `viewer-transport-required` contract test still passes (it uses `container`).
- **Committed in:** bc8e03e (Task 2 commit)

**3. [Rule 1 - Bug] Placeholder carried `data-fsb-nid`, tripping the Phase-7 identity static gate**
- **Found during:** Task 2 (full-suite regression check)
- **Issue:** My placeholder helpers copied `data-fsb-nid` onto the placeholder; `tests/node-identity-static.test.js` forbids the literal `data-fsb-nid` in `src/renderer/index.js`/`diff.js` (Phase 7 moved nid addressing to the positional `nodeIds` sidecar). It also broke the two "exactly N handle keys" lock tests once `handleSnapshot` was exposed.
- **Fix:** Removed `data-fsb-nid` from both placeholder helpers (the renderer pairs elements positionally; an `<img>`->/<div> 1:1 swap preserves the pairing, so the attr was unnecessary); extended the two handle-surface lock tests to include the new `handleSnapshot` member.
- **Files modified:** src/renderer/index.js, src/renderer/snapshot.js, tests/renderer-viewer.test.js, tests/semantic-addressing.test.js
- **Verification:** `node --test tests/node-identity-static.test.js` GREEN; full `npm test` 449/449.
- **Committed in:** bc8e03e (Task 2 commit)

---

**Total deviations:** 3 auto-fixed (2 Rule 1 bugs, 1 Rule 3 blocking)
**Impact on plan:** All three were necessary to make the Plan-authored RED scaffolds pass against the shipped viewer + verified jsdom/URL reality. No scope creep -- no new surface beyond what the scaffolds require (one handle member, two reconciled API styles). `reference/` untouched; no `media-src`; no masking (Phase 15); no packages.

## Threat Model Coverage

- **T-12-06 (SSRF, renderer asset write):** mitigated -- fail-closed `classifyAssetOrigin` runs PRE-write at all four sites; snapshot gated at the STRING layer so a real browser's parser never fetches a blocked origin; blocked -> dimensioned placeholder, no GET issued.
- **T-12-07 (tracking-pixel / live-viewer confirmation):** mitigated -- the same pre-write origin gate stops `<img src=https://attacker/track?...>` beacons for blocked origins; `mediaMode:'off'`/`'poster'` is the escape hatch.
- **T-12-08 (DoS / fetch amplification):** mitigated -- `mediaMode:'off'` removes the fetch surface; the origin gate bounds reachable origins.
- **T-12-09 (XSS via sandbox/CSP weakening):** mitigated -- no `allow-scripts` literal (purity scan green); sandbox assertion + `CSP_META` byte-unchanged; no `script-src`/`media-src`.
- **T-12-10 (variant re-negotiation cross-origin):** mitigated -- effective src pinned to `data-ps-currentsrc`; `srcset`/`sizes` neutralized.
- **T-12-SC (supply chain):** N/A by construction -- no packages installed.

## Test Status (read this for the wave-merge run)

- **`node --test tests/renderer-asset-policy.test.js`: 15/15 GREEN** (allowed public-https; one of each blocked range/scheme/unqualified; the 172.16.0.0/12 boundary 172.15/172.32 allowed + 172.16/172.31 blocked; parse-error).
- **`node --test tests/renderer-asset-gate.test.js`: 8/8 GREEN** (gateAssetUrl export; mediaMode off/reference/poster; blocked-origin -> placeholder with no fetchable src; currentSrc pin + srcset/sizes neutralized; throwing hook fails closed; allowAssetOrigins widen).
- **`node --test tests/security-chokepoint-purity.test.js`: GREEN** -- no `allow-scripts` literal in any renderer module (incl. the new asset-policy.js); sandbox assertion intact; all SECURITY.md pinned markers present + the new img-src/mediaMode/section markers.
- **`node --test tests/renderer-snapshot.test.js`: GREEN** -- CSP_META byte-unchanged (img-src present, no script-src, no media-src).
- **Full `npm test`: 449 tests = 449 pass + 0 fail.** The 23 previously-RED 12-03 scaffolds are now GREEN; the 4 transient regressions from the createViewer API change (transport-required, two handle-surface locks, the identity static gate) were all fixed in the same task commit. Differential oracle (incl. the 12-02 D26) still GREEN -- renderer-only changes leave the capture wire output untouched.

## Next Phase Readiness

- The viewer-side-fetch security model is complete and the four MSEC/ASST requirements for this plan are GREEN. The renderer now consumes both capture-side wire surfaces from 12-02 (`data-ps-currentsrc` pin + neutralize; `data-ps-asset-unavailable` placeholders) and adds its own `blocked-origin` placeholder.
- **Phase 13** (video/audio + STREAM.MEDIA): the `gateAssetUrl`/`classifyAssetOrigin`/`mediaMode` seams are the hooks the poster/full-asset split and the eventual `media-src` CSP add will extend; the `poster` mediaMode predicate is already in place (poster images pass; full split is Phase 13).
- **Phase 15** (masking): `classifyAssetOrigin` is exported as the pure, Phase-15-reusable origin seam against which the masking vocabulary completes; the renderer placeholder + the `assetOriginPolicy`/`allowAssetOrigins` config are the override surfaces to threat-model.
- **Playwright asset UAT is the deferred manual layer** (real CSP enforcement, real blocked-origin GET suppression, snapshot pre-fetch timing, real `srcset` neutralization) -- run before `/gsd:verify-work` or record the UAT-deferral per the 12-VALIDATION.md Manual-Only table precedent.

## User Setup Required

None - no external service configuration required.

## Self-Check: PASSED

- Created file present: `src/renderer/asset-policy.js`; this SUMMARY present.
- Task commits present in history: `efbd8c1` (Task 1), `bc8e03e` (Task 2), `e26bcde` (Task 3).
- `classifyAssetOrigin`/`gateAssetUrl` exported and pure; both RED scaffolds GREEN (15 + 8); full `npm test` 449/449; sandbox token + CSP_META byte-unchanged; no `allow-scripts` literal in any renderer module.

---
*Phase: 12-static-assets-by-reference*
*Completed: 2026-06-20*
