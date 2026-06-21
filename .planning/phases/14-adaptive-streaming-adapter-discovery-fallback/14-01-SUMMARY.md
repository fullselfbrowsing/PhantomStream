---
phase: 14-adaptive-streaming-adapter-discovery-fallback
plan: 01
subsystem: api
tags: [protocol, hls, dash, manifest, media, wire-protocol, jsdom, testing]

# Dependency graph
requires:
  - phase: 13-video-audio-url-playback-sync
    provides: "STREAM.MEDIA op + MediaSyncPayload typedef (the structural twin MEDIA_HINT is modeled on); the renderer media driver (handleMedia/ensurePlaying/applyMediaAction) Plans 02/03 reuse; the renderer-media.test.js jsdom harness ported into the Wave 0 player scaffold"
provides:
  - "STREAM.MEDIA_HINT = 'ext:dom-media-hint' op (opt-in, adapter-originated, collision-free, raw-round-trips under the 1 MiB cap, backward-compatible: old viewers ignore the unknown type)"
  - "MediaHintPayload typedef (nid?/scope/manifestUrl/kind/contentType?/identity-stamped) — the fixed wire contract every adapter emits and the renderer consumes"
  - "classifyManifest({url, contentType}) pure helper — URL-OR-content-type HLS/DASH/null classifier, never throws on a malformed url"
  - "tests/media-hint-filter.test.js — the pure manifest-filter unit suite (Wave 0, green)"
  - "tests/renderer-media-player.test.js — the Wave 0 player decision-tree harness scaffold (green) Plans 02/03 extend"
affects: [14-02-adapter-discovery, 14-03-renderer-player, 14-04-fallback, 15-media-security]

# Tech tracking
tech-stack:
  added: []  # zero new runtime deps; dependencies stays { ws: 8.21.0 }
  patterns:
    - "New STREAM.* op as a structural twin of an existing op (MEDIA_HINT mirrors MEDIA): JSDoc-commented value + identity-stamped typedef; relayability is automatic via the adapters' Object.keys(STREAM) allow-sets"
    - "Pure classifier helper returns a primitive ('hls'|'dash'|null), try/catch + regex-fallback guarded so a hostile url never throws (T-14-03)"
    - "Wave 0 test scaffold: a single placeholder test that boots and proves the jsdom harness without importing the not-yet-existing module under test"

key-files:
  created:
    - tests/media-hint-filter.test.js
    - tests/renderer-media-player.test.js
  modified:
    - src/protocol/messages.js
    - tests/protocol.test.js

key-decisions:
  - "STREAM.MEDIA_HINT value = 'ext:dom-media-hint' (Claude's discretion; follows the ext:dom-* / STREAM.MEDIA convention; collision-free asserted in protocol.test.js — Assumption A2)"
  - "classifyManifest is content-type-first (the more robust signal for extensionless/signed CDN manifest URLs), then path-extension; either signal independently sufficient (URL-OR-content-type)"
  - "No new constant added to constants.js (the op needs none); the differential oracle stays 48/48 with no D-ledger entry (the hint originates in the adapter, not src/capture/ — Assumption A4, confirmed by the full-suite run)"

patterns-established:
  - "Pattern 1: STREAM op twin — add a new ext:dom-* value next to its sibling with a one-line JSDoc + an identity-stamped typedef modeled on the sibling's payload"
  - "Pattern 2: defensive pure classifier — manifestPathOf wraps new URL() in try/catch with a regex query/hash strip so a malformed url is a guarded result, never a throw"
  - "Pattern 3: Wave 0 scaffold — port the jsdom harness + the stubs the later waves inject (installStubMediaSource, stubVideoEl), one harness-only placeholder test, no import of the module under test"

requirements-completed: [MADPT-02]

# Metrics
duration: 18min
completed: 2026-06-21
---

# Phase 14 Plan 01: Adaptive-Streaming Protocol + Filter Spine Summary

**Added the opt-in STREAM.MEDIA_HINT wire op + MediaHintPayload typedef + a pure URL-OR-content-type classifyManifest HLS/DASH classifier to the zero-dep protocol module, proved collision-free + raw-round-trip under the 1 MiB cap, and stood up the two Wave 0 test scaffolds the rest of Phase 14 implements against — full suite 601/601, differential oracle 48/48 unchanged.**

## Performance

- **Duration:** 18 min
- **Started:** 2026-06-21T14:50:00Z
- **Completed:** 2026-06-21T15:08:00Z
- **Tasks:** 3
- **Files modified:** 4 (2 created, 2 modified)

## Accomplishments

- `STREAM.MEDIA_HINT = 'ext:dom-media-hint'` added to the `STREAM` namespace as a structural twin of `MEDIA`, with the `MediaHintPayload` typedef (nid?/scope/manifestUrl/kind/contentType? + `streamSessionId`/`snapshotId` identity stamps). Collision-free in `Object.values(STREAM)` and raw-round-trips through `encodeEnvelope`/`decodeEnvelope` under `RELAY_PER_MESSAGE_LIMIT_BYTES` — envelope and relay byte-unchanged; old viewers ignore the unknown type via the renderer dispatch default.
- `classifyManifest({url, contentType})` exported as a pure `'hls'|'dash'|null` classifier: content-type-first (HLS token set incl. `application/vnd.apple.mpegurl` / `x-mpegURL` / `audio[-x]/mpegurl`, plus `application/dash+xml`), then `.m3u8`/`.mpd` path extension; case-insensitive and `;charset`-tolerant; `try/catch` + regex-fallback so a malformed/hostile url never throws (T-14-03 mitigated).
- Both adapters (`src/adapters/playwright.js:78`, `src/adapters/extension.js:21`) auto-include `MEDIA_HINT` in their `Object.keys(STREAM)` allow-sets, so the op is relayable with **no adapter edit** — only future emission code (Plan 02) is new.
- Two new Wave 0 test files created and green: `tests/media-hint-filter.test.js` (the pure filter suite) and `tests/renderer-media-player.test.js` (the jsdom player-decision-tree harness scaffold with `installStubMediaSource` + `stubVideoEl` stubs Plans 02/03 inject).

## Task Commits

Each task was committed atomically (TDD tasks: RED test + GREEN impl folded into one task commit each, since the new behavior lives in already-tracked test files):

1. **Task 1: STREAM.MEDIA_HINT op + MediaHintPayload typedef + protocol tests** — `f8e3ad2` (feat)
2. **Task 2: pure classifyManifest helper + tests/media-hint-filter.test.js** — `eaaae81` (feat)
3. **Task 3: tests/renderer-media-player.test.js Wave 0 scaffold** — `1dd9a90` (test)

**Plan metadata:** (this commit) `docs(14-01): complete adaptive-streaming protocol spine plan`

## Files Created/Modified

- `src/protocol/messages.js` — added `STREAM.MEDIA_HINT` value, the `MediaHintPayload` typedef (modeled on `MediaSyncPayload`), and the exported pure `classifyManifest()` helper (+ private `manifestPathOf` + the HLS/DASH content-type token tables). `constants.js` and `index.js` untouched (the barrel already re-exports `messages.js`).
- `tests/protocol.test.js` — appended 3 tests: MEDIA_HINT collision-free + `^ext:dom-` namespace + exact value; raw round-trip (plain + compressed) with the encoded frame asserted `< RELAY_PER_MESSAGE_LIMIT_BYTES`; `MediaHintPayload` typedef-presence (15 → 18 green).
- `tests/media-hint-filter.test.js` — NEW. 9 tests covering hls-by-ext, hls-by-content-type (all four HLS tokens, case/charset tolerated), hls-by-ext-with-query/hash, dash-by-ext, dash-by-content-type, null-for-mp4/ts/image, null-for-empty, never-throws-on-malformed (+ regex-fallback classification), and URL-OR independence.
- `tests/renderer-media-player.test.js` — NEW. Ports the jsdom harness (`setupEnv`/`recordingLogger`) and adds the player-specific stubs (`installStubMediaSource` minting a recorded `blob:` object URL, `stubVideoEl` with a controllable `canPlayType` + cross-realm src-set recorder); one placeholder test asserts harness wiring only and is green. No import of `src/renderer/media-player.js` (does not exist until Plan 02).

## Decisions Made

- **MEDIA_HINT op value** `'ext:dom-media-hint'` (discretion; the `STREAM.MEDIA = 'ext:dom-media'` convention from Phase 13). Asserted collision-free + namespace-conformant.
- **classifyManifest ordering: content-type first, then extension.** Content-type is the more robust signal for extensionless/signed CDN manifest URLs (14-RESEARCH "Filter"); either signal is independently sufficient (URL-OR-content-type).
- **No constant in `constants.js`** — the op needs none (the plan explicitly forbids one). The barrel re-export was already present, so the op/helper are available at the `./protocol` subpath with no `index.js` change.
- **No differential-oracle ledger entry** — the hint originates in the adapter, not `src/capture/`, so the capture wire is byte-unchanged; the oracle stayed at 48/48 (Assumption A4, confirmed empirically by the full-suite run).

## Deviations from Plan

None - plan executed exactly as written.

The plan's tasks, file set, op value, typedef field list, classifier spec, and test coverage were followed verbatim. No bugs, missing-critical-functionality, or blocking issues were encountered (Rules 1–3 did not fire); no architectural decisions arose (Rule 4 did not fire). No packages were installed — `dependencies` remains `{ ws: 8.21.0 }`.

## Issues Encountered

None. The TDD RED phases for Tasks 1 and 2 failed as expected (undefined `STREAM.MEDIA_HINT` / undefined `classifyManifest` import), and the GREEN implementations passed first try. Node v25.9.0 is the live runtime (the CLAUDE.md notes v24.x; no behavioral difference for `node:test`/`node:assert`).

## Known Stubs

The Wave 0 player scaffold (`tests/renderer-media-player.test.js`) contains ONE intentional placeholder test asserting only harness wiring — this is the plan's explicit deliverable (a Wave 0 scaffold the later waves implement against), not a masking stub. It does not reference `src/renderer/media-player.js`; Plan 02 adds that import alongside the real native/factory/lazy-hls/degrade decision-tree assertions. No production-path stubs were introduced (the protocol op + classifier are fully implemented and tested).

## Threat Flags

None. The plan's `<threat_model>` (T-14-01 collision, T-14-02 cap, T-14-03 malformed-url throw, T-14-SC no-install) was satisfied by Tasks 1–2; no new security surface beyond the declared register was introduced. V12/SSRF re-gating of `manifestUrl` is enforced at the viewer in Plan 03 (out of scope here — this plan defines only the wire shape and the pure classifier; no URL is fetched).

## Next Phase Readiness

- **Plan 02 (adapter discovery)** can emit `STREAM.MEDIA_HINT` immediately: the op, typedef, and `classifyManifest` filter are exported and relayable (the `Object.keys(STREAM)` allow-sets already include it). `tests/media-hint-filter.test.js` is the home for any further filter cases; the Playwright/extension adapter tests extend the existing adapter test files.
- **Plan 02 (renderer player)** has its test home: `tests/renderer-media-player.test.js` boots the jsdom harness with the stub `MediaSource` (parent-realm global) and the controllable-`canPlayType` video stub. Plan 02 adds the `src/renderer/media-player.js` import + the decision-tree assertions there.
- Full suite **601/601** green (baseline 588 + 13 new); differential oracle **48/48** unchanged; `dependencies` unchanged.
- No blockers. The Phase 14 cross-realm MSE-binding spike (STATE.md blocker, A1/A5) is unaffected by this plan — it lands with the renderer player in Plan 02.

## Self-Check: PASSED

- FOUND: `src/protocol/messages.js` (STREAM.MEDIA_HINT @ line 27, MediaHintPayload typedef @ line 248, classifyManifest @ line 395)
- FOUND: `tests/protocol.test.js` (18 green, +3 MEDIA_HINT)
- FOUND: `tests/media-hint-filter.test.js` (9 green)
- FOUND: `tests/renderer-media-player.test.js` (1 green Wave 0 scaffold)
- FOUND commit `f8e3ad2` (Task 1), `eaaae81` (Task 2), `1dd9a90` (Task 3)
- Full suite 601/601; differential oracle 48/48; `dependencies` = `{ ws: 8.21.0 }` (unchanged)

---
*Phase: 14-adaptive-streaming-adapter-discovery-fallback*
*Completed: 2026-06-21*
