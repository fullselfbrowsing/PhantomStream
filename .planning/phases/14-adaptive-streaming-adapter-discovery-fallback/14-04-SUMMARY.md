---
phase: 14-adaptive-streaming-adapter-discovery-fallback
plan: 04
subsystem: adapters
tags: [adapters, playwright, extension, webRequest, manifest, hls, dash, media-hint, opt-in, discovery]

# Dependency graph
requires:
  - phase: 14-adaptive-streaming-adapter-discovery-fallback (plan 01)
    provides: "STREAM.MEDIA_HINT op + MediaHintPayload typedef + the pure classifyManifest('hls'|'dash'|null) filter the adapter hooks call; the Object.keys(STREAM) allow-sets that already auto-include MEDIA_HINT (no allowlist edit)"
provides:
  - "Playwright adapter: opt-in (cfg.discoverManifests) page.on('response') + optional CDP Network.responseReceived manifest observation -> classifyManifest -> transport.send(STREAM.MEDIA_HINT, payload), off by default"
  - "Extension adapter: opt-in (opts.discoverManifests) chrome.webRequest.onCompleted manifest observation -> classifyManifest -> transport.send(STREAM.MEDIA_HINT, payload), off by default, graceful when the webRequest permission is absent"
  - "Best-effort manifest->element correlation via an injectable resolveActiveMediaNid hook: single-active -> element scope (+nid); ambiguous/absent -> page scope (nid omitted)"
  - "Identity stamping by snooping streamSessionId/snapshotId off the STREAM frames each adapter already forwards"
affects: [14-03-renderer-player, 15-media-security]

# Tech tracking
tech-stack:
  added: []  # zero new runtime deps; dependencies stays { ws: 8.21.0 }; no peerDependencies added
  patterns:
    - "Opt-in network-observation side channel on an adapter: an explicit off-by-default flag gates listener registration; no flag -> no listener, no permission, no emission (graceful absence)"
    - "Adapter-side identity snoop: capture streamSessionId/snapshotId off the side-channel payloads the adapter already relays, then stamp them on a newly-originated hint (no new identity source)"
    - "Best-effort correlation via an injectable host hook returning a nid-or-null; defaulting to page scope is always safe (never block on perfect correlation)"
    - "Emission via the existing transport.send path with NO allowlist edit (the op auto-includes from Object.keys(STREAM))"

key-files:
  created: []
  modified:
    - src/adapters/playwright.js
    - src/adapters/extension.js
    - tests/playwright-adapter.test.js
    - tests/extension-adapter.test.js

key-decisions:
  - "Opt-in flag named discoverManifests (explicit, off by default) on both adapters; correlation hook named resolveActiveMediaNid (returns a nid or null)"
  - "Identity stamps are SNOOPED off the forwarded STREAM payloads (the same identity the adapter already relays), defaulting to { streamSessionId: '', snapshotId: 0 } until a real identity is observed (the viewer's isCurrentStream accepts an empty-identity hint)"
  - "validateChrome gains a discoverManifests arg and RETURNS a { manifestDiscoveryAvailable } capability flag; it NEVER throws on missing chrome.webRequest (graceful degradation is the contract) — non-opted-in callers see unchanged behavior"
  - "Both the page.on('response') and CDP Network.responseReceived paths (Playwright) sit behind the same opt-in; the CDP path is secondary and only arms when the session exposes .on"
  - "No differential-oracle ledger entry and no STREAM allow-set edit — the hint originates in the adapter, not src/capture/, so the capture wire is byte-unchanged (oracle stays 48/48)"

requirements-completed: [MADPT-02]

# Metrics
duration: 11min
completed: 2026-06-21
---

# Phase 14 Plan 04: Adapter Manifest Discovery Summary

**Both adapters now surface adaptive-streaming manifest URLs that never appear as a plain element `src`: the Playwright adapter via an opt-in `page.on('response')` (+ optional CDP `Network.responseReceived`) listener and the extension adapter via an opt-in `chrome.webRequest.onCompleted` listener, each filtering `.m3u8`/`.mpd` (by URL OR content-type) through the pure `classifyManifest` helper, correlating best-effort, and emitting `STREAM.MEDIA_HINT` through the existing `transport.send` path — off by default with zero allowlist edits, graceful when no opt-in or no permission, capture wire byte-unchanged (oracle 48/48), full suite 640/640.**

## Performance

- **Duration:** 11 min
- **Tasks:** 2 (both TDD: RED test -> GREEN impl)
- **Files modified:** 4 (0 created, 4 modified)

## Accomplishments

- **Playwright adapter (`src/adapters/playwright.js`):** added an opt-in (`cfg.discoverManifests === true`) `page.on('response', handler)` listener registered through the existing `addPageListener` seam (alongside `framenavigated`/`load`), plus a secondary CDP `Network.responseReceived` path behind the same flag. The handler reads `response.url()` + `response.headers()['content-type']`, calls `classifyManifest({url, contentType})`, and on a non-null kind builds a `MediaHintPayload` and calls `transport.send(STREAM.MEDIA_HINT, payload)` — mirroring the `bindingCallback` emission style. Imported `classifyManifest` (STREAM was already imported); no `allowedBridgeTypes` edit.
- **Extension adapter (`src/adapters/extension.js`):** added an opt-in (`opts.discoverManifests === true`) `chrome.webRequest.onCompleted.addListener(handler, { urls: ['<all_urls>'] }, ['responseHeaders'])` registration. `validateChrome` was extended to take the flag and **return** a `{ manifestDiscoveryAvailable }` capability flag (checking `chrome.webRequest.onCompleted`) — it never throws on the API's absence, so an opted-in adapter on a permission-less Chrome degrades to a logged no-op. The handler reads `details.url` + the content-type from the `responseHeaders` `{name,value}` array (case-insensitive), classifies, and emits via `transport.send`. `dispose()` removes the listener. No `STREAM_TYPES` edit.
- **Graceful absence (both):** with the flag falsy/absent, neither adapter registers a network listener and no hint is ever emitted — the progressive path is byte-for-byte unchanged. A missing `page.on` (Playwright) returns early via `addPageListener`; a missing `chrome.webRequest` (extension) is reported by the capability flag and skipped. Every observation path is `try/catch`-contained so a hostile/odd response or details object can never wedge the observer.
- **Best-effort correlation (both):** an injectable `resolveActiveMediaNid` hook returns the nid of a single active opaque media element → `scope: 'element'` with that nid; when it returns null/undefined (ambiguous), the hint is `scope: 'page'` with `nid` omitted (always-safe default). A throw in the hook is contained and falls back to page scope.
- **Identity stamping (both):** each adapter snoops `streamSessionId`/`snapshotId` off the STREAM payloads it already forwards (`bindingCallback` for Playwright; `handleRuntimeMessage` for the extension) into a `currentIdentity`, and stamps the hint with it — the same identity the surrounding STREAM frames carry. Defaults to `{ streamSessionId: '', snapshotId: 0 }` until a real identity is seen.

## Task Commits

1. **Task 1: opt-in `page.on('response')` manifest discovery in the Playwright adapter** — `ebed337` (feat) — `src/adapters/playwright.js`, `tests/playwright-adapter.test.js`
2. **Task 2: opt-in `chrome.webRequest.onCompleted` manifest discovery in the extension adapter** — `07cf61d` (feat) — `src/adapters/extension.js`, `tests/extension-adapter.test.js`

**Plan metadata:** (this commit) `docs(14-04): complete adapter manifest discovery plan`

## Files Created/Modified

- `src/adapters/playwright.js` — imported `classifyManifest`; added `discoverManifests`/`resolveActiveMediaNid` config + `currentIdentity`; added `observeStreamIdentity` (snoop in `bindingCallback`), `handleManifestResponse` (page hook), `handleCDPResponseReceived` (CDP secondary), `emitMediaHint`; registered the `response` listener (and CDP subscription) in `install` behind the opt-in. (+108 lines)
- `src/adapters/extension.js` — imported `classifyManifest`; added `hasWebRequestOnCompleted` + extended `validateChrome(chrome, discoverManifests)` to return a capability flag; added `discoverManifests`/`resolveActiveMediaNid`/`currentIdentity`; added `observeStreamIdentity` (snoop in `handleRuntimeMessage`), `contentTypeOf`, `handleManifestCompleted`, `emitMediaHint`, `armManifestObserver`/`disarmManifestObserver`; armed in `install`, disarmed in `dispose`. (+133 lines)
- `tests/playwright-adapter.test.js` — +7 discovery tests (off-by-default, hls-by-ext page scope, dash-by-content-type, non-manifest no-hint, element/page correlation, identity snoop, graceful-when-`page.on`-absent) + a synthetic Playwright `Response` factory.
- `tests/extension-adapter.test.js` — +9 discovery tests (off-by-default, validateChrome-unchanged-when-off, hls-by-ext page scope, dash-by-header, non-manifest no-hint, element/page correlation, identity snoop, graceful-when-`webRequest`-absent, dispose-removes-listener) + a `webRequest.onCompleted` fake and a synthetic `details` factory. `createFakeChrome` gained a `{ webRequest }` toggle.

## Decisions Made

- **`discoverManifests` opt-in + `resolveActiveMediaNid` correlation hook** (discretion on key names; kept explicit and off by default per the locked decision). The correlation hook keeps the adapter from needing to track DOM elements precisely (it lives in the driver realm), while letting a host (or test) signal "exactly one opaque element is active."
- **Identity by snoop, not a new source.** The plan calls for "identity stamps from the adapter's current stream identity (the same identity the adapter already stamps on STREAM messages it forwards)." Since the adapters relay bridge payloads verbatim and never minted identity locally, the lightest faithful implementation is to observe `streamSessionId`/`snapshotId` off those forwarded payloads. Empty/zero defaults are safe because `isCurrentStream` accepts a hint with no identity.
- **`validateChrome` returns a capability flag instead of throwing.** "Degrades gracefully (no throw)" for a missing `chrome.webRequest` means `validateChrome` cannot throw on its absence; it reports `manifestDiscoveryAvailable` and the registration step no-ops (with a `logWarn`) when false. Non-opted-in callers are byte-identical to before (the flag defaults false and the return value is ignored).
- **No allowlist edit, no oracle entry.** `STREAM.MEDIA_HINT` is already in both `Object.keys(STREAM)` allow-sets (14-01), so the op is relayable with only emission code added; the hint originates in the adapter (not `src/capture/`), so the capture wire is byte-unchanged and the differential oracle stays 48/48.

## Deviations from Plan

None - plan executed exactly as written.

The plan's two tasks, file set, opt-in spec, classifier call, payload shape, best-effort correlation contract, and test coverage were followed verbatim. No bugs, missing-critical-functionality, or blocking issues arose (Rules 1-3 did not fire); no architectural decisions arose (Rule 4 did not fire). No authentication gates. No packages were installed — `dependencies` remains `{ ws: 8.21.0 }` and no `peerDependencies` were added (hls.js packaging is a renderer-side concern owned by other Phase-14 plans, not this discovery slice).

## Issues Encountered

None. Both TDD RED phases failed as expected (the emission/listener/dispose assertions failed pre-implementation while the off-by-default / graceful-absence / non-manifest assertions passed pre-implementation, confirming the default behavior was already correct), and both GREEN implementations passed on the first run. The CDP test file stayed green throughout (the opt-in CDP `session.on` subscription is skipped when discovery is not enabled and the fake session has no `.on`).

## Known Stubs

None. Both adapters fully import `classifyManifest` and emit `STREAM.MEDIA_HINT`; there are no placeholder values, no hardcoded empty data flowing to a consumer, and no `TODO`/`FIXME` markers. The renderer-side consumption of `STREAM.MEDIA_HINT` (the `pendingHints` page-hint match-on-play) is owned by the renderer plan (14-03), not this discovery slice — that is a plan boundary, not a stub.

## Threat Flags

None. The implementation matches the plan's `<threat_model>` register exactly:
- **T-14-14 (always-on observation / permission widening):** mitigated — discovery is opt-in and off by default; no `response`/`webRequest` listener is registered and no `chrome.webRequest` is required unless `discoverManifests === true` (asserted by the off-by-default tests in both files); `validateChrome` requires `chrome.webRequest` only when opted in.
- **T-14-15 (hostile/oversized manifest URL):** mitigated — `manifestUrl` is re-gated at the VIEWER (Plan 14-03) before any fetch; the hint rides the 1 MiB-capped raw relay; `classifyManifest` is `try/catch`-guarded (14-01) and the observers are fully contained.
- **T-14-16 (mis-attributed page hint):** mitigated (best-effort by contract) — correlation defaults to page scope when ambiguous and never asserts a wrong element; identity stamps bound the hint to the current stream.
- **T-14-SC (installs):** mitigated — this plan installed nothing; `dependencies` stays `{ ws }`.

No new security surface beyond the declared register was introduced.

## Next Phase Readiness

- **Plan 14-03 (renderer player)** can consume `STREAM.MEDIA_HINT` from a real adapter source now: both adapters emit it (page- or element-scoped, identity-stamped) through the existing relay. The viewer's `handleMediaHint` (re-gate + element-scope immediate bind / page-scope `pendingHints` match-on-play) is the remaining renderer wiring.
- **Hosts** opt in by passing `discoverManifests: true` (and optionally `resolveActiveMediaNid`) to `createPlaywrightAdapter` / `createExtensionAdapter`; the extension host must additionally hold the `webRequest` permission (absence degrades to a logged no-op).
- Full suite **640/640** green (baseline 624 + 16 new); differential oracle **48/48** unchanged; CDP adapter tests **2/2**; `dependencies` unchanged.
- No blockers introduced. The cross-realm MSE-binding spike (STATE.md blocker) is unaffected by this plan — it lives in the renderer plans.

## Self-Check: PASSED

- FOUND: `src/adapters/playwright.js` (classifyManifest import @ line 16; STREAM.MEDIA_HINT emission @ line 300; `discoverManifests` gate)
- FOUND: `src/adapters/extension.js` (classifyManifest import @ line 6; STREAM.MEDIA_HINT emission @ line 368; `discoverManifests` gate + `validateChrome` capability flag)
- FOUND: `tests/playwright-adapter.test.js` (19/19, +7 discovery)
- FOUND: `tests/extension-adapter.test.js` (17/17, +9 discovery)
- FOUND commit `ebed337` (Task 1), `07cf61d` (Task 2)
- Full suite 640/640; differential oracle 48/48; plan tests 36/36; CDP 2/2; `dependencies` = `{ ws: 8.21.0 }` (unchanged); no `allowedBridgeTypes`/`STREAM_TYPES` edits

---
*Phase: 14-adaptive-streaming-adapter-discovery-fallback*
*Completed: 2026-06-21*
