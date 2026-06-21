---
phase: 12-static-assets-by-reference
verified: 2026-06-20T00:00:00Z
status: human_needed
score: 5/5 must-haves verified
overrides_applied: 0
human_verification:
  - test: "Real meta-CSP enforcement in a live browser"
    expected: "Referenced <img> assets paint; an injected <script> and a fetch() are blocked by default-src 'none' (no script-src). Confirms the srcdoc CSP that the string assertion only pins textually."
    why_human: "jsdom does not enforce meta-CSP. Requires Real-Chrome/Playwright. (ASST-05)"
  - test: "Blocked-origin GET suppression (no network request to a denied origin)"
    expected: "Route-intercept shows ZERO outbound requests to a private/internal/denied host; the dimensioned blocked-origin placeholder is present instead."
    why_human: "Requires a real network stack; jsdom never issues the GET. Proves the pre-write gate actually suppresses the fetch, not just rewrites the string. (MSEC-01)"
  - test: "Snapshot pre-fetch timing (parser fetches <img src> during parse, before any post-parse gate)"
    expected: "A blocked-origin <img> served inside a snapshot fires NO GET — proving the string-layer gate (Pitfall 1) runs before the parser, not the post-parse defense-in-depth scrub."
    why_human: "jsdom does not fetch on parse and never parses srcdoc; only a real browser exercises the parse-time fetch race. (MSEC-01 / Pitfall 1)"
  - test: "Real srcset/sizes neutralization preventing cross-origin DPR re-negotiation"
    expected: "At 2 device-pixel-ratios the viewer loads the pinned data-ps-currentsrc variant, NOT a re-negotiated srcset candidate."
    why_human: "Requires a real responsive-image pipeline + DPR; jsdom returns currentSrc==='' and does not negotiate. (ASST-03)"
  - test: "Mixed-content / CORS outcomes degrade to the placeholder"
    expected: "An http asset under an https viewer → placeholder; a CORS-blocked asset → placeholder (no broken image)."
    why_human: "Requires real fetch outcomes (mixed-content + CORS), which jsdom cannot reproduce. (ASST-04)"
---

# Phase 12: Static Assets by Reference — Verification Report

**Phase Goal:** The already-shipped by-reference asset pipeline is verified and hardened as a first-class media feature — every static visual (`<img>`/`srcset`/`<picture>`/`<source>`/SVG `<image>`/`background-image`/`<video>` poster) renders in the viewer by loading the original absolute source URL, the displayed variant is pinned, non-shareable refs degrade to placeholders, and the viewer-fetch security model (precise CSP, fail-closed origin policy, `mediaMode`) is established because static images are *already* a viewer-fetch surface.
**Verified:** 2026-06-20T00:00:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (the 5 ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Image/srcset/picture/source/SVG-image/background-image/video-poster URLs resolve to absolute source URLs on the wire and render by viewer-fetch — NO image bytes traverse the relay | ✓ VERIFIED | `src/relay/relay.js:247` forwards `target.send(options.raw)` verbatim; `receive()`→`checkRelayFrameLimit` classifies by type only, never parses/fetches the payload. `tests/relay-asset-bytes.test.js` (123 lines) asserts `viewer.sent[0] === ASSET_SNAPSHOT_RAW` (byte-identity) + byte-length parity + URL-substring preservation. Fixture `tests/differential/fixtures/static-assets.html` carries all surfaces: `<img>`×10, `srcset`×7, `<picture>`×2, `<source>`×3, SVG `<image xlink:href>` (line 45), `background-image`×3, `<video poster>`×3. |
| 2 | Displayed variant pinned via clone-only `data-ps-currentsrc` enrichment, ledgered in the differential oracle (D26 exists AND fires) | ✓ VERIFIED | Capture sets `data-ps-currentsrc` on the CLONE only (`src/capture/index.js:3496`), guarded `tag==='img'` + `currentSrcDiffers` + `!hasDangerousScheme` (3484-3495). `D26-currentsrc-variant-pin` exists at `tests/differential/divergence-ledger.js:622` (`affectedScenarios:['static-assets']`, predicate at 649-659). `tests/differential/oracle.test.js:446-454` asserts D26 matched AND is the ONLY entry consulted; 462-494 assert the pin present in extracted/absent in reference. Oracle suite ran GREEN (143 isolated, 498 full). No D27 (the combined divergence is one SNAPSHOT-field mismatch — documented in 12-02-SUMMARY). |
| 3 | Non-shareable refs (blob:/origin-local; oversized data: > ASSET_DATA_URI_MAX_BYTES) degrade to a dimensioned placeholder at capture; small data: stays byte-identical | ✓ VERIFIED | `classifyAssetRef` (`src/capture/index.js:238`) executed directly: `blob:`→`{ok:false,reason:'blob'}`, oversized `data:`→`{ok:false,reason:'oversized-data'}`, small `data:`→`{ok:true}`, https→`{ok:true}` (8/8 pass). `createAssetUnavailablePlaceholder`/`replaceWithAssetUnavailablePlaceholder` (2488/2508) build dimensioned `<div data-ps-asset-unavailable=reason>` CLONE-only. Fixture's oversized `data:` is 280022 B > 262144 cap. Live-DOM-no-mutation invariant tested (`tests/capture-asset-degrade.test.js:118`). |
| 4 | Viewer CSP: `img-src http: https: data:`; `default-src 'none'`; NO script-src; NO media-src — asserted by string test | ✓ VERIFIED | `CSP_META` (`src/renderer/snapshot.js:336-341`) byte-unchanged = `default-src 'none'; img-src http: https: data:; style-src http: https: 'unsafe-inline'; font-src http: https: data:`. Executed `buildSnapshotHtml`: has img-src ✓, has default-src 'none' ✓, NO script-src ✓, NO media-src ✓ (4/4). Pinned by `tests/renderer-snapshot.test.js` (143 tests green). |
| 5 | Fail-closed origin/scheme policy (https-only, blocks private/internal incl. 0.0.0.0/8 + IPv4-mapped-IPv6/link-local/NAT64) governs viewer fetch PRE-WRITE; mediaMode off\|poster\|reference (default reference) selects posture | ✓ VERIFIED | `classifyAssetOrigin`/`isPrivateOrLocalHost` (`src/renderer/asset-policy.js`, 172 lines) executed against 18 SSRF payloads — all correct, incl. `0.0.0.0/8` (line 95), `::ffff:0:0`/`::ffff:0.0.0.0` (121-131), `169.254.169.254` in every form, `fe80::/10` link-local (110), `64:ff9b::/96` NAT64 (116), `::` unspecified (108), and the 172.16/12 boundary. `gateAssetUrl` (`src/renderer/index.js:113`) 5-step precedence executed (8/8): off blocks all, reference allows public/blocks private/blocks http, throwing hook + non-true fail closed, allowlist widens, default=reference. PRE-WRITE at all 4 sites: snapshot string layer (`index.js:1371` before `buildSnapshotHtml` 1373), diff ADD/ATTR (`diff.js:257`/`369-396` before importNode/setAttribute), subtree (`index.js:1440` before importNode). mediaMode validated at factory (`index.js:307-309`, throws `viewer-mediamode-invalid`). |

**Score:** 5/5 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/renderer/asset-policy.js` | Pure fail-closed classifyAssetOrigin + isPrivateOrLocalHost | ✓ VERIFIED | 172 lines, exports both, DOM-free, executed 18/18 SSRF cases correct |
| `src/renderer/index.js` | gateAssetUrl + mediaMode/hook/allowlist config + pre-write gate + currentSrc pin | ✓ VERIFIED | gateAssetUrl exported (113), config (303-326), gateFragmentAssets (362), wired at 1371/1410-1411/1440 |
| `src/renderer/snapshot.js` | String-layer gateSnapshotAssets (pre-srcdoc); CSP_META unchanged | ✓ VERIFIED | gateSnapshotAssets exported (289), quote-aware scan, fail-closed; CSP_META byte-unchanged |
| `src/renderer/diff.js` | gate injected at ADD (pre-importNode) + ATTR (pre-setAttribute) | ✓ VERIFIED | hooks consumed (170-174, 257, 369-396); blocked→removeAttribute/placeholder; no-op default preserves signature |
| `src/capture/index.js` | classifyAssetRef, currentSrcDiffers, placeholder helpers + 4-site hooks | ✓ VERIFIED | helpers (238/266), placeholders (2488/2508), hooks at 1574/3481/3819/4144 clone-only |
| `src/protocol/constants.js` | ASSET_DATA_URI_MAX_BYTES with units/derivation comment | ✓ VERIFIED | line 61 = 262144 (256 KiB) with full derivation comment |
| `tests/relay-asset-bytes.test.js` | Relay byte-identity proof (SC#1) | ✓ VERIFIED | 123 lines, byte-identity + byte-length + URL-substring assertions; tests real createRelay |
| `tests/differential/divergence-ledger.js` | D26 entry that fires | ✓ VERIFIED | D26 at line 622; htmlContainsCurrentSrcPin/htmlContainsAssetUnavailable helpers (180/193) |
| `tests/differential/scenarios/static-assets.js` | Oracle scenario injecting divergent currentSrc | ✓ VERIFIED | Registered in MATRIX (oracle.test.js:64); D26-fires asserted (446-454) |
| `tests/differential/fixtures/static-assets.html` | Focused asset-surface fixture | ✓ VERIFIED | All surfaces present incl. SVG image; oversized data: = 280022 B; small data: byte-identical |
| `tests/renderer-asset-policy.test.js` | classifyAssetOrigin table (MSEC-01) | ✓ VERIFIED | GREEN in isolation; private-range + boundary + parse-error coverage |
| `tests/renderer-asset-gate.test.js` | gateAssetUrl/mediaMode/pin (ASST-02/03/05, MSEC-01/02) | ✓ VERIFIED | GREEN in isolation |
| `tests/renderer-snapshot.test.js` | CSP confirm-only assertion | ✓ VERIFIED | GREEN (img-src present; no script-src; no media-src) |
| `tests/capture-asset-degrade.test.js` | Capture degrade + currentSrc + no-mutation | ✓ VERIFIED | GREEN; no-live-mutation invariant (line 118) |
| `docs/SECURITY.md` | Viewer-side fetching section + denylist + mediaMode default | ✓ VERIFIED | §6 (line 140); denylist (157-158); mediaMode default reference (176-181); string-layer timing (198) |

All 14 PLAN-frontmatter artifacts pass `gsd-sdk verify.artifacts` (6+4+4 = 14/14, zero issues).

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| relay-asset-bytes.test.js | src/relay/relay.js | receive→sendToTargets byte-verbatim | ✓ WIRED | Pattern found; relay forwards options.raw |
| static-assets.html | oracle.test.js | MATRIX row registration | ✓ WIRED | MATRIX row at oracle.test.js:64 |
| src/capture/index.js | src/protocol/constants.js | import ASSET_DATA_URI_MAX_BYTES | ✓ WIRED | import at capture/index.js:51 |
| divergence-ledger.js | scenarios/static-assets.js | affectedScenarios guard in appliesTo | ✓ WIRED | D26 affectedScenarios:['static-assets'] |
| oracle.test.js | fixtures/static-assets.html | MATRIX row + scenario import | ✓ WIRED | import staticAssets (40) + row (64) |
| src/renderer/index.js | src/renderer/asset-policy.js | import classifyAssetOrigin into gateAssetUrl | ✓ WIRED | import at index.js:41; used in gateAssetUrl:133 |
| src/renderer/snapshot.js | src/renderer/asset-policy.js | string-layer gate consults classifier | ✓ WIRED | gateSnapshotAssets calls injected gate; gate=classifyAssetOrigin |
| src/renderer/diff.js | src/renderer/index.js | gateAssetUrl injected into ADD + ATTR | ✓ WIRED | hooks injected via applyMutations identity (1410-1411) |

All 8 PLAN-frontmatter key-links verified by `gsd-sdk verify.key-links` (2+3+3 = 8/8).

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| gateSnapshotAssets (snapshot.js) | rewritten `<img>` markup | injected `gateAsset`→classifyAssetOrigin verdict | Yes — executed: blocked→placeholder, allowed→src kept, pin→effective src | ✓ FLOWING |
| classifyAssetOrigin (asset-policy.js) | `{allowed, reason}` | `new URL()` parse + regex denylist | Yes — 18/18 SSRF payloads classify correctly | ✓ FLOWING |
| classifyAssetRef (capture/index.js) | `{ok, reason}` | string scheme + assetUtf8ByteLength vs cap | Yes — 8/8 capture cases correct | ✓ FLOWING |
| D26 appliesTo (divergence-ledger.js) | match boolean | payloadHtml(extMsg/refMsg) substring | Yes — oracle asserts matched.size===1 for static-assets | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| classifyAssetOrigin SSRF sweep (18 payloads incl. 0.0.0.0/8, IPv4-mapped-IPv6, NAT64, link-local, 172/12 boundary) | `node -e classifyAssetOrigin(...)` | 18 pass / 0 fail | ✓ PASS |
| gateAssetUrl 5-step precedence (off/reference/poster, hook fail-closed, allowlist, default) | `node -e gateAssetUrl(...)` | 11 pass / 0 fail | ✓ PASS |
| gateSnapshotAssets string-layer (blocked→placeholder no-leak, allowed→kept, currentSrc pin neutralizes srcset/sizes) | `node -e gateSnapshotAssets(...)` | 6 pass / 0 fail | ✓ PASS |
| CSP_META via buildSnapshotHtml (img-src/default-src-none/no-script-src/no-media-src) | `node -e buildSnapshotHtml(...)` | 4 pass / 0 fail | ✓ PASS |
| classifyAssetRef + currentSrcDiffers capture-side | `node -e classifyAssetRef/currentSrcDiffers(...)` | 8 pass / 0 fail | ✓ PASS |
| 6 Phase-12 test files in isolation | `node --test relay-asset-bytes renderer-snapshot renderer-asset-policy renderer-asset-gate capture-asset-degrade oracle` | 143 pass / 0 fail | ✓ PASS |
| security-chokepoint-purity (no allow-scripts, sandbox intact) | `node --test tests/security-chokepoint-purity.test.js` | 8 pass / 0 fail | ✓ PASS |
| Full suite | `npm test` | **498 pass / 0 fail** | ✓ PASS |

### Probe Execution

No conventional `scripts/*/tests/probe-*.sh` probes exist in this repo and no PLAN declares any. The phase's runnable-verification surface is the `node --test` suite, executed above (498/498 green). Probe execution: N/A (no probes declared or conventional).

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| ASST-01 | 12-01 | Image assets mirrored by reference; no image bytes traverse relay | ✓ SATISFIED | SC#1 verified — relay byte-identity test + verbatim forward (relay.js:247) |
| ASST-02 | 12-01, 12-03 | background-image + `<video>` poster resolve to absolute URLs and render | ✓ SATISFIED | SC#1/SC#4 — surfaces in fixture; img-src CSP covers them; gate handles poster kind |
| ASST-03 | 12-02, 12-03 | Displayed variant pinned via currentSrc; viewer neutralizes srcset/sizes | ✓ SATISFIED | SC#2/SC#5 — capture clone-only pin (capture:3496) + renderer pin/neutralize (snapshot.js:235-243, index.js:372-377); D26 fires |
| ASST-04 | 12-02 | blob:/oversized-data: degrade to dimensioned placeholder, never a broken ref | ✓ SATISFIED | SC#3 — classifyAssetRef executed correct; placeholder helpers clone-only; oracle asserts blob never reaches wire |
| ASST-05 | 12-01 | CSP precise: img-src present, default-src 'none', no script-src | ✓ SATISFIED | SC#4 — CSP_META byte-unchanged; executed buildSnapshotHtml confirms |
| MSEC-01 | 12-03 | Fail-closed https-only + private-range origin policy hook | ✓ SATISFIED | SC#5 — classifyAssetOrigin 18/18 incl. 0.0.0.0/8 + mapped-IPv6; pre-write gate at 4 sites |
| MSEC-02 | 12-03 | mediaMode off\|poster\|reference; documented default | ✓ SATISFIED | SC#5 — gateAssetUrl posture executed; default reference; SECURITY.md §6 documents default |

All 7 Req-IDs accounted for. Union of plan-declared requirements == REQUIREMENTS.md Phase-12 set. No orphaned requirements.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| (none) | — | No TBD/FIXME/XXX/TODO/HACK/PLACEHOLDER in any Phase-12-modified `src/` file | — | Clean — completion is auditable |

Debt-marker gate: PASSED (zero unreferenced markers). Stub scan: no hardcoded-empty rendering paths — every gate return value flows from a real classifier/parse. The one Info item from 12-REVIEW (IN-01: cosmetic trailing comma on a blocked srcset candidate token in sanitize.js) is informational only — the candidate is still classified by host and the gate verdict is unchanged; no security or fetch-behavior impact. Not a blocker.

### Human Verification Required

The pure-logic + jsdom-srcdoc + differential-oracle layers are the complete AUTOMATED contract and are fully green (498/498). The following behaviors are jsdom-untestable by construction (jsdom does not enforce meta-CSP, does not fetch on parse, never parses srcdoc, and returns `currentSrc===''`) and require a Real-Chrome/Playwright asset UAT. They are enumerated in 12-VALIDATION.md "Manual-Only Verifications" (lines 95-105) and were deferred per the project's UAT-deferral precedent.

1. **Real meta-CSP enforcement** (ASST-05) — Playwright: load the srcdoc viewer; assert referenced `<img>` paints; assert an injected `<script>` and a `fetch()` are blocked by `default-src 'none'` (no script-src). The string assertion only pins the CSP text; this confirms the browser enforces it.

2. **Blocked-origin GET suppression** (MSEC-01) — Playwright with route-intercept: assert ZERO outbound requests to a private/denied host; assert the dimensioned blocked-origin placeholder is present. Confirms the pre-write gate suppresses the fetch, not merely rewrites the string.

3. **Snapshot pre-fetch timing / Pitfall 1** (MSEC-01) — Playwright: serve a blocked-origin `<img>` inside a snapshot; assert no GET fires — proving the string-layer gate runs before the parser's parse-time fetch, ahead of the post-parse defense-in-depth scrub.

4. **Real srcset/sizes neutralization** (ASST-03) — Playwright at two DPRs: assert the pinned `data-ps-currentsrc` variant loads, not a re-negotiated srcset candidate.

5. **Mixed-content / CORS → placeholder** (ASST-04) — Playwright: an http asset under an https viewer → placeholder; a CORS-blocked asset → placeholder.

### Gaps Summary

No gaps. All 5 ROADMAP success criteria are observably true in the codebase, verified by reading the source AND by executing the exported functions directly against the canonical payloads (not trusting test names or SUMMARY claims): the relay forwards frames byte-verbatim (no image bytes on the wire); the displayed variant is pinned clone-only and the D26 oracle entry fires; non-shareable refs degrade to dimensioned placeholders while small `data:` stays byte-identical; the CSP keeps `img-src` with `default-src 'none'` and no script-src/media-src; and the fail-closed origin policy (https-only + the full private/internal denylist including 0.0.0.0/8, IPv4-mapped-IPv6, link-local, and NAT64) gates the viewer fetch PRE-WRITE at all four renderer sites under a mediaMode posture switch defaulting to `reference`. All 14 artifacts pass three-level checks, all 8 key-links are wired, all 7 Req-IDs are satisfied, no debt markers exist, the security invariants (no allow-scripts, sandbox `allow-same-origin` only, CSP byte-unchanged) hold, and the full `npm test` suite is green at 498/498 — consistent with the 12-REVIEW-FIX final count after the 2-iteration SSRF fix loop.

Status is **human_needed** (not passed) solely because five real-browser behaviors are jsdom-untestable and require a Playwright asset UAT. These are confirmation of already-implemented behavior, not missing implementation — the automated contract is complete.

---

_Verified: 2026-06-20T00:00:00Z_
_Verifier: Claude (gsd-verifier)_
