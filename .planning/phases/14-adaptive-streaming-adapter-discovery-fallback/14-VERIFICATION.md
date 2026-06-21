---
phase: 14-adaptive-streaming-adapter-discovery-fallback
verified: 2026-06-21T12:24:27Z
status: human_needed
score: 4/4 success-criteria verified (+ 7/7 phase invariants, 4/4 requirements)
overrides_applied: 0
re_verification:
  previous_status: none
  note: initial verification
human_verification:
  - test: "Cross-Document object-URL MSE attach works (parent MediaSource blob bound to in-iframe <video>; hls.js attachMedia(iframeEl) from the parent realm)"
    expected: "Foregrounded Playwright/Chrome: a parent-realm MediaSource object URL set on the inert in-iframe <video> plays; if a browser refuses cross-Document attach, the player falls through to degrade('mse-opaque') -> poster (the never-break net), mirror not broken"
    why_human: "Real MSE only runs in a foregrounded browser. jsdom has no MSE; the FSB automation browser runs tabs hidden so Chrome suspends media. Not exercisable in the automated suite (documented in 14-VALIDATION Manual-Only)."
  - test: "Live-edge sync on a real HLS live stream (no absolute seek)"
    expected: "Real Chrome: play a live .m3u8; playback rejoins the live edge; no absolute-time seek is issued on the live stream"
    why_human: "Needs a real live manifest playing in a foregrounded browser; the reconciler rejoin-edge logic is unit-proven (tests/media-reconcile.test.js) but live-edge timing is observable only in a real player."
  - test: "DRM/EME content degrades to poster with reason 'drm' (observed)"
    expected: "Real Chrome: an encrypted/EME source -> poster + reason 'drm'; the mirror keeps updating, content is never decrypted/mirrored"
    why_human: "The 'encrypted' EME event only fires in a real browser. The degrade('drm') routing is unit-proven (encrypted event + KEY_SYSTEM_ERROR) but the live EME fire is not reproducible in jsdom."
  - test: "Real CSP blob: enforcement + connect-src-not-needed confirmation"
    expected: "Real Chrome: the blob: media-src plays the MSE object URL, and the iframe issues NO segment fetches (the parent realm fetches segments) -> confirms no connect-src is needed"
    why_human: "jsdom does not enforce CSP. The CSP string contract (blob: in media-src, no connect-src/script-src) is unit-asserted, but real browser enforcement + the parent-fetch model are observable only in Chrome."
warnings:
  - id: WARN-01
    concern: "Phase mode is 'mvp' but the ROADMAP goal is NOT in User Story format ('As a ..., I want to ..., so that ...')"
    detail: "verify-mvp-mode.md instructs the verifier to surface a mode/goal-format mismatch. The 4 ROADMAP Success Criteria are well-formed and were fully verified against the codebase, so this does not block goal achievement — it is a planning-metadata discrepancy. PhantomStream Phase 14 is SDK/library work whose 'user' is a host integrator, so a user-story goal is awkward by nature."
    decision_requested: "Either (a) accept the technical Success-Criteria verification as the goal contract for this library phase, or (b) run /gsd mvp-phase 14 to reformat the goal into User Story form and re-verify. No code change is implied."
---

# Phase 14: Adaptive Streaming + Adapter Discovery + Fallback — Verification Report

**Phase Goal:** Best-effort adaptive HLS/DASH playback in the viewer via an optional, lazy player in a renderer-owned PARENT REALM (never the no-`allow-scripts` sandbox) binding cross-realm to the inert in-iframe `<video>`; Playwright/CDP + extension adapters surface manifest URLs by network observation as opt-in hints with graceful absence; MSE/blob/DRM degrade to poster with a documented reason; live streams handled — the mirror never breaks.
**Verified:** 2026-06-21T12:24:27Z
**Status:** human_needed
**Re-verification:** No — initial verification
**Mode:** mvp (see WARN-01 — goal is not in User Story format; verified against the 4 ROADMAP Success Criteria contract)

## User Flow Coverage

> Phase mode is `mvp`. The goal is not in User Story form (WARN-01), so this section maps the **integrator/viewer flow** the Success Criteria describe — a host wires an adapter + viewer, and a real browser tab with adaptive media is mirrored. Each step is verified against codebase evidence.

| Step | Expected | Evidence | Status |
|------|----------|----------|--------|
| Host opts adapter into manifest discovery | `discoverManifests === true` registers a network observer; off by default registers nothing | `src/adapters/playwright.js:96,457` (`discoverManifests`, gated `addPageListener('response',...)`); `src/adapters/extension.js:154,413-422` (opt-in `chrome.webRequest.onCompleted`) | ✓ |
| Adapter observes a `.m3u8`/`.mpd` response | `classifyManifest` filters by extension OR content-type; non-null kind emits `STREAM.MEDIA_HINT` via `transport.send` | `src/adapters/playwright.js:279-281,350`; `src/adapters/extension.js:355-357,384`; `classifyManifest` 11/11 behavior cases pass | ✓ |
| Hint reaches the viewer | `STREAM.MEDIA_HINT` dispatched to `handleMediaHint`; old viewers ignore via dispatch `default` | `src/renderer/index.js:2100-2102` (case) + `:2106` (default); test "an old viewer ignores STREAM.MEDIA_HINT via the dispatch default" passes | ✓ |
| Viewer re-gates the manifest URL (SSRF) | `gateAsset(manifestUrl,'media')` (fail-closed) runs BEFORE any bind/fetch; blocked → `degrade('no-manifest')`, never fetched | `src/renderer/index.js:1960-1964`; `gateAsset` wraps `gateAssetUrl` (`:358-365`); test "no-manifest: a gate-blocked manifest url -> degrade(no-manifest)" passes | ✓ |
| Player binds in the PARENT realm to the inert child `<video>` | `createMediaPlayer` runs decision tree native→factory→lazy-hls→degrade; sandbox stays exactly `allow-same-origin` | `src/renderer/media-player.js:311-359`; sandbox `index.js:540` + runtime assert `:542` (throws `viewer-sandbox-invalid` if not the single token); player constructed `index.js:628-642` | ✓ |
| Adaptive plays / native HLS plays | native HLS sets child `videoEl.src` (no MSE/library); MSE via host factory or lazy hls.js (loadSource then attachMedia) | `media-player.js:322-327,289-298,236-278`; tests "native-HLS sets videoEl.src and skips MSE/library", "loadSource(manifest) called BEFORE attachMedia(el)" pass | ✓ (real cross-Document MSE attach → human UAT) |
| Unmirrorable media degrades to poster | every reason (no-manifest/no-player/mse-opaque/drm) routes to the single `degrade` sink → `media-unavailable` overlay + `onMediaUnavailable`; never throws | `media-player.js:209-224`; tests for all 4 reasons + "attach() never throws" pass | ✓ (real DRM/EME fire → human UAT) |
| Live stream handled | reconciler `rejoin-edge` reused verbatim; seek only when `seekable.length>0`; no absolute seek | `index.js:1505-1515` (teardown) + reconciler reuse; tests "applyMediaAction seeks the live edge under seekable.length>0, NO absolute seek" + "empty seekable range does NOT seek" pass | ✓ (live-edge timing → human UAT) |
| Mirror never breaks (graceful absence) | no adapter/hints + no playerFactory → progressive path intact, zero errors | test "a normal STREAM.MEDIA progressive flow with NO hints and NO playerFactory is unchanged" passes; `npm test` 665/0 | ✓ |

**Outcome clause ("the mirror never breaks"):** observably true — `attach()` is fully try/catch-contained to a never-rethrowing `degrade()` sink (media-player.js:355-358), every failure path is covered by a passing test, and the differential oracle stays 48/48 (capture wire unchanged).

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria — the contract)

| # | Truth (Success Criterion) | Status | Evidence |
|---|---------------------------|--------|----------|
| 1 | When an HLS/DASH manifest URL is available, the viewer plays it via an optional, lazy player in a renderer-owned parent-realm surface binding cross-realm to the inert in-iframe element; only `hls.js` added (optional/lazy), DASH via host seam, native HLS no library; sandbox token unchanged | ✓ VERIFIED | `media-player.js` full decision tree (367 lines); native HLS sets child `src` no MSE (`:322-327`); host factory (`:289-298`); lazy hls.js dynamic-import-only (`:91-98,236-278`); DASH no-factory → `degrade('no-player')` (`:351`); sandbox `allow-same-origin` single token + runtime assert (`index.js:540-543`). 17 player tests pass. |
| 2 | Playwright/CDP + extension adapters surface manifest URLs not present as a plain `src` (network observation) as opt-in hints; absence degrades gracefully to native-progressive-only, no errors | ✓ VERIFIED | Playwright `page.on('response')`+CDP (`playwright.js:457-463`); extension `webRequest.onCompleted` (`extension.js:413-422`); both opt-in/off-by-default; emit `STREAM.MEDIA_HINT` (`:350`/`:384`). Tests: "discovery off by default: no webRequest listener and no media hint", "graceful absence" pass. |
| 3 | Media that cannot be referenced (MSE/blob: without manifest, DRM/EME) degrades to poster/placeholder with an observable, documented reason — the mirror never breaks | ✓ VERIFIED | Single `degrade(nid,reason)` sink, reasons `no-manifest\|no-player\|mse-opaque\|drm` (`media-player.js:206-224`); `media-unavailable` overlay registered (`overlays.js:743`) + `onMediaUnavailable` callback contained (`index.js:634-638`); DRM: encrypted event + KEY_SYSTEM_ERROR → `degrade('drm')`, emeEnabled never true. Tests for all reasons + containment pass. |
| 4 | Live streams (infinite/NaN duration) handled — live-edge sync, no absolute seek | ✓ VERIFIED | Phase-13 reconciler `rejoin-edge` reused verbatim; `applyMediaAction` seeks `seekable.end(len-1)` only when `seekable.length>0`, no absolute seek (tests in `renderer-media.test.js` + `media-reconcile.test.js` D27-adjacent pass); no new live-sync code. |

**Score:** 4/4 Success Criteria verified.

### Phase Invariants (from verification brief)

| # | Invariant | Status | Evidence |
|---|-----------|--------|----------|
| a | `dependencies` exactly `{ ws }`; hls.js ONLY optional peerDependency loaded via dynamic `import('hls.js')`; NO top-level hls.js import in src/ | ✓ VERIFIED | `package.json` deps `{"ws":"8.21.0"}`, peerDeps `{"hls.js":">=1.5.0"}`, `peerDependenciesMeta.hls.js.optional=true`; only `import('hls.js')` is the dynamic one at `media-player.js:93` (all other matches are comments); `node_modules/hls.js` absent. |
| b | Iframe sandbox stays exactly `allow-same-origin` (no allow-scripts); player runs ONLY in parent realm, never the iframe | ✓ VERIFIED | `index.js:540` sets single token `allow-same-origin`; `:542-543` asserts exactly one token === `allow-same-origin` else throws `viewer-sandbox-invalid`; `media-player.js` runs in parent realm (header + `win`=parent). |
| c | `media-src` adds `blob:` only — no script-src/connect-src | ✓ VERIFIED | `snapshot.js:551-557` CSP_META: `default-src 'none'; img-src ...; media-src http: https: data: blob:; style-src ...; font-src ...` — no script-src, no connect-src, blob: not in img-src. CSP test asserts all four constraints. |
| d | Manifest URL from `STREAM.MEDIA_HINT` re-gated through fail-closed `gateAssetUrl` before bind (SSRF) | ✓ VERIFIED | `handleMediaHint` calls `gateAsset(manifestUrl,'media').allow` BEFORE bind (`index.js:1960`); blocked → `degrade(...,'no-manifest')` never fetched; `gateAsset`→`gateAssetUrl` (`:358-365`). Test "blocked-origin manifestUrl -> degrade(no-manifest)" passes. |
| e | Every unmirrorable path → single never-rethrowing `degrade(reason)` sink → poster (mirror never breaks) | ✓ VERIFIED | `attach()` try/catch-contained → `degrade('mse-opaque')` on any throw, NEVER rethrows (`media-player.js:355-358`); single `degrade` sink (`:209-224`); `destroyAll` on re-snapshot (`index.js:1513`). Test "attach() never throws" passes. |
| f | Envelope/relay byte-unchanged; differential oracle unchanged (no new ledger entry — MEDIA_HINT originates in adapter, not capture) | ✓ VERIFIED | `envelope.js`/`ws-handler.js` last touched in extraction commit `ab4152e`, NOT in any Phase-14 commit; oracle **48/48 pass**; zero MEDIA_HINT references in `tests/differential/`. |
| g | Phase-13 State-C `media-poster` caption now has a call site in `index.js` (close prior UI-review gap) | ✓ VERIFIED | `index.js:1819,1821` show `media-poster` in poster mode (shown iff no surviving poster, else hidden); register at `overlays.js:742`. Tests "State C: poster-LESS element SHOWS caption" / "WITH poster keeps HIDDEN" / "off mode renders nothing" pass. |

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/protocol/messages.js` | STREAM.MEDIA_HINT op + MediaHintPayload typedef + classifyManifest pure helper | ✓ VERIFIED | `MEDIA_HINT:'ext:dom-media-hint'` (`:27`, collision-free, occurrences=1, `^ext:dom-`); MediaHintPayload identity-stamped (`:248-256`); classifyManifest (`:395`) 11/11 cases incl. no-throw. Wired via barrel + adapters' `Object.keys(STREAM)`. |
| `src/renderer/media-player.js` | createMediaPlayer + decision tree + tryLazyImportHls + degrade | ✓ VERIFIED | 367 lines, substantive; full native/factory/lazy-hls/degrade tree; dynamic-import-only; per-nid registry + destroy/destroyAll; WR-04 named encrypted-listener removal. Wired: imported `index.js:42`, constructed `:628`. |
| `src/renderer/overlays.js` | media-unavailable overlay (passive textContent, reason as data-attr) | ✓ VERIFIED | `renderMediaUnavailable` (`:712`) registered (`:743`); textContent-only; reason via setAttribute. Hostile-input test passes; innerHTML allowlist unchanged. |
| `src/renderer/snapshot.js` | CSP_META media-src + blob: | ✓ VERIFIED | `:554` `media-src http: https: data: blob:`. |
| `src/renderer/index.js` | createMediaPlayer wiring, handleMediaHint, pendingHints, destroyAll-on-snapshot, config keys, State-C wire | ✓ VERIFIED | All anchors present and substantive (`:628,648,1513,1819,1940,2100`); playerFactory/onMediaUnavailable config (`:353-354`). |
| `src/adapters/playwright.js` | opt-in page.on('response')/CDP → STREAM.MEDIA_HINT | ✓ VERIFIED | `discoverManifests` opt-in; main-frame-gated handlers; emits hint. WR-01 fix present. |
| `src/adapters/extension.js` | opt-in chrome.webRequest.onCompleted → STREAM.MEDIA_HINT | ✓ VERIFIED | opt-in; validateChrome requires webRequest only when opted in; tab-id gated. WR-02 fix present. |
| `package.json` | optional hls.js peerDependency (not a hard dep) | ✓ VERIFIED | peerDependencies + peerDependenciesMeta.optional:true; dependencies stays `{ ws }`. |
| `scripts/package-smoke.mjs` | zero-hard-dep: ./renderer imports with hls.js absent | ✓ VERIFIED | `assertHlsNotInstalled` + named `buildZeroHardDepRendererCheckSource`; `npm run package:smoke` exits 0. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| `index.js` | `media-player.js` | `createMediaPlayer(deps)` in createViewer; dispatch routes MEDIA_HINT → handleMediaHint | ✓ WIRED | import `:42`, construct `:628`, dispatch `:2100` |
| `index.js handleMediaHint` | `gateAssetUrl` | re-gate manifestUrl before bind (SSRF) | ✓ WIRED | `:1960` via `gateAsset` wrapper |
| `index.js handleSnapshot` | `destroyAllPlayers` | teardown on new identity alongside mediaFirstBind.clear() | ✓ WIRED | `:1513` `mediaPlayer.destroyAll()` |
| `media-player.js` | `hls.js` | dynamic `import('hls.js')` in tryLazyImportHls, try/catch→null | ✓ WIRED | `:91-98` |
| `media-player.js` | `degrade(reason)` | single sink invoked by every branch | ✓ WIRED | `:209-224` + all call sites |
| `playwright.js` | `transport.send(STREAM.MEDIA_HINT)` | addPageListener('response') → classifyManifest → emit | ✓ WIRED | `:457-458,279-281,350` |
| `extension.js` | `transport.send(STREAM.MEDIA_HINT)` | webRequest.onCompleted → classifyManifest → emit | ✓ WIRED | `:413-422,355-357,384` |
| `package.json` | hls.js optional | `{ "hls.js": { "optional": true } }` | ✓ WIRED | confirmed via node read |
| `index.js handleMedia` | `overlays.show('media-poster')` | State-C wire (poster mode, no surviving poster) | ✓ WIRED | `:1819,1821` |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Full test suite green | `npm test` | tests 665, pass 665, fail 0 | ✓ PASS |
| Phase-14 targeted tests | `node --test` (9 phase files) | tests 186, pass 186, fail 0 | ✓ PASS |
| Zero-hard-dep package smoke (hls.js absent) | `npm run package:smoke` | exit 0; ./renderer imports clean | ✓ PASS |
| Differential oracle unchanged | `node --test tests/differential/oracle.test.js` | tests 48, pass 48, fail 0 | ✓ PASS |
| STREAM.MEDIA_HINT collision-free + namespace | node eval | value `ext:dom-media-hint`, occurrences=1, all 11 unique, `^ext:dom-` | ✓ PASS |
| classifyManifest pure + no-throw | node eval (11 cases incl. malformed/null) | 11 pass / 0 fail | ✓ PASS |
| hls.js NOT installed | `ls node_modules/hls.js` | No such file or directory | ✓ PASS |

### Probe Execution

No conventional `scripts/*/tests/probe-*.sh` probes; phase is library/test-suite driven. The runnable verification gates (`npm test`, `npm run package:smoke`, differential oracle) were executed in this verifier process and are recorded under Behavioral Spot-Checks above. Status: N/A (no probe scripts declared).

### Requirements Coverage

| Requirement | Source Plan(s) | Description | Status | Evidence |
|-------------|----------------|-------------|--------|----------|
| MADPT-01 | 14-02, 14-05 | Best-effort adaptive playback via optional lazy parent-realm player; hls.js optional/lazy, DASH via host seam | ✓ SATISFIED | Success Criterion 1 + invariants a,b verified; player + packaging tests pass |
| MADPT-02 | 14-01, 14-03, 14-04 | Adapters surface manifest URLs by network observation as opt-in hints with graceful absence | ✓ SATISFIED | Success Criterion 2 verified; both adapters opt-in + emit MEDIA_HINT; dispatch + consumption tests pass |
| MADPT-03 | 14-02, 14-03 | Unreferenceable media (MSE/blob/DRM) degrades to poster with documented reason; mirror never breaks | ✓ SATISFIED | Success Criterion 3 + invariant e verified; degrade taxonomy + overlay + DRM tests pass |
| MADPT-04 | 14-03 | Live streams handled — live-edge sync, no absolute seek | ✓ SATISFIED | Success Criterion 4 verified; rejoin-edge reuse tests pass (real-browser live-edge → human UAT) |

All 4 phase-declared requirement IDs match REQUIREMENTS.md Phase-14 mappings. No ORPHANED requirements (REQUIREMENTS.md maps exactly MADPT-01..04 to Phase 14, all claimed by plans).

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| — | — | No debt markers (TBD/FIXME/XXX/TODO) in Phase-14 source files | ℹ Info | Clean; the 6 deferred IN-01..06 review items are tracked in 14-REVIEW.md, not as code markers |
| `media-player.js` | 34-36 | Header previously overstated object-URL revocation (IN-01) | ℹ Info | Non-blocking; header now attributes revocation to hls.js `destroy()`/host adapter (comment at `:262-265` corrected). No leak in practice. |

`return null`/`=> {}`/empty-data greps reviewed: all matches are legitimate (optional-dep guards, `?? null` correlation fallbacks, contained try/catch no-ops) — none flow to user-visible output as a stub. No stubs found.

### Human Verification Required

4 real-browser UAT items are deferred (jsdom has no MSE; the FSB automation browser runs tabs hidden → Chrome suspends media). These are documented in `14-VALIDATION.md` Manual-Only with the poster fallback as the never-break net, and are explicitly deferrable per the Phase-13 / Phase-12-03 precedent. The automated must-haves all pass, so these are `human_needed` UAT, not gaps.

1. **Cross-Document MSE attach** — Foregrounded Playwright/Chrome: bind a parent-realm `MediaSource` object URL to the inert in-iframe `<video>`; confirm playback. If a browser refuses cross-Document attach → `degrade('mse-opaque')` → poster is the net.
2. **Live-edge sync on a real HLS live stream** — Real Chrome: play a live `.m3u8`; confirm rejoin-edge with no absolute seek.
3. **DRM/EME degrade observed** — Real Chrome: an encrypted source → poster + reason `drm`; mirror not broken.
4. **Real CSP blob: enforcement + connect-src-not-needed** — Real Chrome: confirm the blob plays and the iframe issues no segment fetches (parent fetches).

### Gaps Summary

No gaps. All 4 ROADMAP Success Criteria, all 7 phase invariants, all 9 key links, and all 4 requirement IDs are verified against the codebase with passing tests and executed verification gates (full suite 665/0, package:smoke exit 0 with hls.js absent, differential oracle 48/48). The 5 code-review Warnings (WR-01..05) are confirmed fixed in real code (commits d02f851, 1a0988a, 275a50b, 8aafcaa, b338f54), each with a regression test. The 6 Info findings (IN-01..06) are non-blocking and tracked in 14-REVIEW.md.

**One WARNING (WARN-01, human decision requested):** the phase is `mode: mvp` but the ROADMAP goal is not in User Story format. This is a planning-metadata discrepancy, not a goal-achievement failure — the 4 technical Success Criteria are the verifiable contract and all pass. The verifier proceeded against the Success Criteria (a library phase whose "user" is a host integrator makes a user-story goal awkward). Resolve by either accepting the technical verification or running `/gsd mvp-phase 14` to reformat the goal; no code change is implied.

**Status rationale:** Per the Step-9 decision tree, the human-verification section is non-empty (4 deferred real-browser UAT items), so status is `human_needed` even though all automated must-haves are VERIFIED. The phase goal is achieved in code; only real-browser confirmation of MSE/live/DRM/CSP behaviors awaits human testing.

---

_Verified: 2026-06-21T12:24:27Z_
_Verifier: Claude (gsd-verifier)_
