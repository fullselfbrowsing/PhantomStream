# Phase 12: Static Assets by Reference - Research

**Researched:** 2026-06-20
**Domain:** DOM-native browser mirroring — verifying + hardening an already-shipped by-reference static-asset pipeline and establishing the viewer-side-fetch security model
**Confidence:** HIGH (every claim grounded in the actual shipped source at exact file:line; jsdom behaviors verified empirically this session)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Viewer-Fetch Security Posture (MSEC-01, MSEC-02)**
- `mediaMode` default = `reference`. Values: `off` (no viewer fetch at all) | `poster` (only posters/placeholders, no full asset fetch) | `reference` (full by-reference fetch). Default documented in SECURITY/ARCH.
- Default origin/scheme policy = **https-only + block private/internal ranges**. Allow all public `https:` origins; block non-`http(s)` schemes and private/internal hosts: `localhost`, `127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16` (link-local), `::1`, `fc00::/7`, and `.local`/unqualified hosts. Fail closed: anything not provably public-https → blocked → placeholder.
- Host override surface = a fail-closed hook `assetOriginPolicy(url, ctx) => boolean` on the viewer config (throwing OR returning non-`true` blocks → placeholder), plus a convenience `allowAssetOrigins` array for the common allowlist case. A throwing hook fails closed (blocks), never opens.
- Enforcement point = **the renderer**, applied **before the asset URL is written into the mirror DOM** (blocked → dimensioned placeholder so the viewer's browser never issues the GET). Capture-side URL masking (MSEC-03) is Phase 15; Phase 12 owns the renderer-side fetch gate.

**CSP Scope & Non-Shareable Fallback (ASST-04, ASST-05)**
- **Phase 12 CSP change = confirm, not widen.** Confirm existing `img-src http: https: data:` covers `<img>`/`<picture>`/`<source>`/SVG `<image>`/`background-image`/`<video>` poster; keep `default-src 'none'` and **no `script-src`**. Add a srcdoc assertion test proving images fetch and `default-src 'none'` still blocks scripts/other fetches. The scoped `media-src` directive is **deferred to Phase 13**.
- Placeholder = a dimensioned inline placeholder preserving width/height (from attributes or computed layout), neutral background, no external fetch, carrying a machine-readable reason attribute (`data-ps-asset-unavailable` with reason value: `blob` | `oversized-data` | `blocked-origin`).
- Degrade to placeholder when: `blob:`/origin-local object URLs (always — detected at capture, never emitted as fetchable); oversized `data:` URIs (above the cap); URLs the origin policy blocks (at the renderer).
- Oversized `data:` threshold = a configurable byte cap with a documented default (named constant in `src/protocol/constants.js`). Small inline images (≤ cap) pass through byte-identical.

**currentSrc Variant Pinning (ASST-03)**
- Enrichment attribute = `data-ps-currentsrc`, set on the serialized **clone only** (never on the live page — preserves the Phase 7 "capture no longer mutates the page" invariant), carrying the resolved `currentSrc`.
- Enrich only when `currentSrc` is present AND differs from the plain resolved `src`. Plain `<img src>` stays byte-identical on the wire — no enrichment, no oracle churn.
- Viewer pins the variant: renderer sets the element's effective source to `data-ps-currentsrc` and neutralizes `srcset`/`sizes` so the cross-origin viewer cannot re-negotiate.
- Differential-oracle handling = a scoped `mismatch` ledger entry (next D-2x id) in `tests/differential/divergence-ledger.js`, pinned to a static-asset scenario. Add/extend an asset fixture scenario to exercise it.

### Claude's Discretion
- Exact byte-cap default for oversized `data:` images (safely below the per-message budget; documented as a named constant in `src/protocol/constants.js`).
- Internal naming of the new renderer policy/placeholder helpers and the precise placeholder markup/styling, consistent with existing `src/renderer/` conventions.
- Whether the origin-policy private-range check is a shared pure helper reused by Phase 15; **prefer a pure, unit-testable function** so Phase 15 can complete masking against the same seam.
- Whether to introduce the `sanitizeForWire('media-url', …)` dispatch seam now (default off, byte-identical) as a no-op hook for Phase 15, or defer it entirely to Phase 15.

### Deferred Ideas (OUT OF SCOPE — do NOT plan here)
- Asset/media URL **masking** (`maskAssetUrls`/`maskAssetUrlFn`, `maskMediaSelector`) and `referrerpolicy="no-referrer"` completion + secrets-on-the-wire docs + the parent-realm threat model → **Phase 15** (MSEC-03, MSEC-04).
- The `media-src` CSP directive and `<video>`/`<audio>` playback + `STREAM.MEDIA` sync → **Phase 13**.
- Adaptive HLS/DASH manifest discovery and the parent-realm player → **Phase 14**.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| ASST-01 | Image assets (`<img>`, `srcset`, `<picture>`, `<source>`, SVG `<image>`) mirrored by reference; no image bytes traverse the relay | **~95% shipped.** `URL_ATTRS` absolutify (capture/index.js:3251, 3516, 1481) + `absolutifySrcset` (:3269, :3522, :1486) + SVG xlink (:3262, :2801). Relay forwards raw bytes verbatim (relay.js:247) — wire carries URL strings only. To add: verification tests + `data-ps-currentsrc` pin (ASST-03). |
| ASST-02 | CSS `background-image` and `<video>` poster URLs resolve to absolute on the wire and render in the viewer | **~95% shipped.** `poster` is in `URL_ATTRS` (:61) — absolutified everywhere. `background-image` rides `collectComputedStyleText` (:3046) — `getComputedStyle().backgroundImage` returns absolute `url()`; `scrubCssText` preserves http(s)+`data:image/*`. To add: verification tests confirming both render under the existing `img-src` CSP. |
| ASST-03 | Displayed image variant pinned via `currentSrc` so the cross-origin viewer loads the same asset the origin showed | **0% shipped (net-new).** Add clone-only `data-ps-currentsrc` enrichment in the 4 serialization sites; renderer pins it + neutralizes `srcset`/`sizes`. Ledger a `mismatch` divergence + asset fixture scenario. ⚠️ **jsdom returns `currentSrc===""`** — scenario must inject it via `Object.defineProperty`. |
| ASST-04 | Non-shareable refs (`blob:`/origin-local object URLs; oversized `data:`) detected and degrade to a dimensioned placeholder, never a broken reference | **0% shipped (the gap).** `absolutifyUrl` (:3009) passes `data:`/`blob:` through untouched. Add capture-side detection → `createBlockPlaceholder`-style dimensioned placeholder carrying `data-ps-asset-unavailable`. Byte-cap constant in constants.js. |
| ASST-05 | Viewer CSP opened precisely enough to fetch assets while keeping `default-src 'none'` and no `script-src` | **~100% shipped — CONFIRM only.** `CSP_META` (snapshot.js:57) = `default-src 'none'; img-src http: https: data:; …` already covers all static image surfaces incl. `<video>` poster. Add a srcdoc assertion test; **defer `media-src` to Phase 13.** |
| MSEC-01 | Fail-closed host origin/scheme policy hook governs which asset URLs the viewer may fetch (https-only, block private/internal ranges) | **0% shipped (net-new).** Renderer-side pure origin-policy classifier + `assetOriginPolicy`/`allowAssetOrigins` config on `createViewer`; pre-write gate → placeholder. |
| MSEC-02 | A `mediaMode` switch (`off`\|`poster`\|`reference`) selects privacy/bandwidth posture; default documented | **0% shipped (net-new).** `mediaMode` config on `createViewer` (default `reference`); gates the renderer fetch behavior; documented in SECURITY/ARCH. |
</phase_requirements>

## Summary

Phase 12 is **verification + a small, well-bounded set of additions**, not a greenfield build. The shipped capture core already absolutifies `src`/`poster`/`data` (via `URL_ATTRS`) and `srcset` (via `absolutifySrcset`) across all four serialization sites, already preserves SVG `xlink:href`, and `background-image` already arrives absolute through `getComputedStyle`. The relay forwards raw frames byte-verbatim and never fetches anything, so SC#1 ("no image bytes traverse the relay") is architecturally true today — the wire carries URL strings only, and the 1 MiB cap would drop any frame that tried to inline bytes. ASST-01, ASST-02, and ASST-05 are therefore mostly **assertions to write**, not code to build.

The genuine new work is four narrow things: (1) **ASST-04** — `absolutifyUrl` (capture/index.js:3009) deliberately passes `data:`/`blob:` through untouched, so non-shareable refs must be detected at capture and degraded to a dimensioned placeholder modeled on the existing `createBlockPlaceholder` (capture/index.js:2341); (2) **ASST-03** — a clone-only `data-ps-currentsrc` enrichment in the serialization paths plus a renderer pin, ledgered as a `mismatch` divergence; (3) **MSEC-01** — a fail-closed renderer-side origin-policy classifier (a pure, Phase-15-reusable function) that runs **before the URL is written into the mirror DOM**; (4) **MSEC-02** — a `mediaMode` switch. The CSP work is confirm-only — `media-src` is explicitly Phase 13.

The single most important security insight, drawn directly from PITFALLS.md Pitfall 2: v2.0 changes the viewer's verb from *render-inert* to *fetch*. Static images are *already* a viewer-fetch surface, which is exactly why the origin policy and `mediaMode` land here. Enforcement must be **pre-write** (gate the URL before it reaches the mirror DOM, never after) so the viewer's browser never issues the GET to a blocked origin. The sandbox invariant (`allow-same-origin` only, no `allow-scripts`; renderer/index.js:209-213) is untouched and must stay green via the existing static scan.

**Primary recommendation:** Treat Phase 12 as "write the verification tests that prove the shipped pipeline, then add four small seams (placeholder-degrade at capture, currentSrc-pin, renderer origin gate, mediaMode) with pure-function cores so they are jsdom-unit-testable and Phase-15-reusable." Keep the CSP at confirm-only.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Absolutify asset URLs (`src`/`poster`/`data`/`srcset`/xlink) | Capture (`src/capture/index.js`) | — | Already done across all serialization sites; only verification + currentSrc enrichment added. |
| `background-image` absolutification | Capture (`collectComputedStyleText`) | — | `getComputedStyle` returns absolute url() — no capture change needed; verify only. |
| `currentSrc` variant pin (`data-ps-currentsrc`) | Capture writes clone-only attr | Renderer pins + neutralizes srcset/sizes | Capture knows the negotiated variant; renderer enforces it cross-origin. |
| `blob:`/oversized-`data:` → placeholder | Capture (detect + degrade) | — | Must never emit a dead/blob ref on the wire; capture is the only place that sees the live attribute. |
| Origin/scheme fetch policy (https-only, private-range deny) | **Renderer** (pre-write gate) | Pure classifier (shareable w/ Phase 15) | Fetch happens from the *viewer's* network; the gate must run where the URL is about to be written into the mirror, before the browser GETs it. |
| `mediaMode` posture (`off`/`poster`/`reference`) | Renderer (`createViewer` config) | — | The viewer owns the fetch decision; capture is unaware of viewer posture. |
| Byte-cap constant for oversized `data:` | Protocol (`src/protocol/constants.js`) | Capture consumes it | Shared numeric constant convention (units/derivation comment). |
| CSP scope (`img-src` confirm; no `media-src` yet) | Renderer (`CSP_META`, snapshot.js) | — | The srcdoc meta is the in-iframe fetch policy; static images already covered. |
| Relay forwarding (no bytes) | Relay (`src/relay/relay.js`) | — | **Untouched** — verbatim raw fan-out; verification only (SC#1). |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| WHATWG `URL` (platform) | built-in | Absolutify + scheme-classify + (new) host-classify asset URLs | Already load-bearing in `absolutifyUrl` (:3014); reuse for the origin classifier — do NOT add a URL library [VERIFIED: src/capture/index.js:3008-3018]. |
| `node:test` + `node:assert/strict` | Node 24 | Test runner for all new unit/oracle tests | Project standard; `npm test` runs `node --test tests/*.test.js tests/differential/*.test.js` [VERIFIED: package.json scripts]. |
| `jsdom` | ^29.1.1 (dev) | Renderer/srcdoc + capture unit tests | Already the dev dep; renderer tests use the srcdoc write-glue recipe [VERIFIED: package.json devDependencies]. |
| `playwright` | ^1.60.0 (dev) | Real-Chrome UAT for fetch reality (CORS/mixed-content/actual blocked GETs) | Already present; the only place real fetch behavior is observable [VERIFIED: package.json devDependencies]. |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| (none) | — | — | **Phase 12 adds NO new runtime or dev dependencies.** All work is plain-JS ESM + JSDoc against platform APIs, per the project's zero-dependency library constraint. |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Hand-rolled private-range classifier using `URL` + string/regex checks | An `ip-address`/`ipaddr.js` npm lib | The denylist is a small, fixed, fully-enumerable set (RFC1918 + link-local + loopback + ULA + `.local`). A pure ~40-line classifier is unit-testable, dependency-free (project constraint), and Phase-15-reusable. A lib would violate the zero-dep library constraint for marginal benefit. **Hand-roll the classifier** — this is one of the rare "build it" cases (see Don't Hand-Roll for the boundary). |
| Renderer-side fetch gate | Capture-side URL masking | CONTEXT locks enforcement at the renderer (the fetch happens from the viewer's network; masking is Phase 15). Do NOT move the gate to capture. |

**Installation:** No installation step. Phase 12 introduces no packages.

**Version verification:** N/A — no packages added. Existing deps confirmed via `package.json`: `ws@8.21.0` (runtime), `jsdom@^29.1.1` / `playwright@^1.60.0` / `typescript@^6.0.3` / `publint@^0.3.21` / `@arethetypeswrong/cli@^0.18.3` (dev). [VERIFIED: package.json]

## Package Legitimacy Audit

> Phase 12 installs **no external packages**. This section is included for completeness.

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| (none added this phase) | — | — | — | — | — | N/A |

**Packages removed due to slopcheck [SLOP] verdict:** none (no packages added)
**Packages flagged as suspicious [SUS]:** none

All Phase 12 code is plain-JS ESM authored in-repo against platform APIs and the existing `ws`/`jsdom`/`playwright` deps already vetted in v1.0. No registry interaction; no slopcheck needed.

## Shipped vs. To-Build (REQUIRED — the load-bearing table)

Legend: ✅ shipped & verified-by-reading | 🔶 shipped, needs a verification test | ➕ net-new code | ⚠️ a known gap to close.

### By success criterion

| Success Criterion | Status | Evidence (file:line) | What must be ADDED |
|-------------------|--------|----------------------|--------------------|
| **SC#1** image/poster/bg/`<video>` poster resolve to absolute URLs; no bytes on relay | 🔶 mostly shipped | `URL_ATTRS=['src','href','action','poster','data']` (:61); absolutify in snapshot (:3251), iframe-content (:1481), added-node root (:3516) + descendants (:3537), mutation-attr (:3845). Relay forwards raw verbatim (`target.send(options.raw)` relay.js:247); `checkRelayFrameLimit` classifies by type only (relay.js:112) — never parses payload, never fetches. | Verification tests asserting (a) wire payload carries absolute URLs not bytes, (b) relay receive→send is byte-identical for a snapshot containing image URLs. |
| **SC#2** displayed variant pinned via clone-only `currentSrc`; ledgered | ➕ net-new | No `data-ps-currentsrc` anywhere in repo (grep: 0 hits). nid clone-only discipline is the precedent (`getTrackedNodeId` :679; nids travel in `nodeIds` sidecar, never on live page — Phase 7). | `data-ps-currentsrc` enrichment in the 4 sites; renderer pin; D-2x `mismatch` ledger entry + asset fixture scenario. |
| **SC#3** `blob:`/oversized-`data:` → dimensioned placeholder, never broken ref or blob on wire | ⚠️ gap | `absolutifyUrl` returns `data:`/`blob:`/`javascript:` UNCHANGED (:3009). `hasDangerousScheme` only blocks `javascript:`/`vbscript:`/`data:text/html` (:181-187) — `blob:` and `data:image/*` pass both sanitizers. Placeholder precedent: `createBlockPlaceholder` builds `<div rr_width rr_height>` (:2341); `replaceWithBlockPlaceholder` (:2356). | Capture-side detect `blob:`/origin-local + oversized `data:` (> byte cap) → dimensioned placeholder with `data-ps-asset-unavailable="blob|oversized-data"`. Byte-cap constant. |
| **SC#4** CSP opened precisely; `default-src 'none'`, no `script-src`; srcdoc-asserted | 🔶 shipped — CONFIRM | `CSP_META` (snapshot.js:57-62) = `default-src 'none'; img-src http: https: data:; style-src http: https: 'unsafe-inline'; font-src http: https: data:`. No `script-src`. No `media-src` (correct for P12). | srcdoc assertion test: images load, scripts/other fetches blocked by `default-src 'none'`. **No CSP change.** Document `img-src` covers `<video>` poster. |
| **SC#5** fail-closed origin/scheme policy (https-only, block private ranges) + `mediaMode` | ➕ net-new | No `assetOriginPolicy`/`allowAssetOrigins`/`mediaMode`/private-range helper anywhere (grep: 0 hits). Fail-closed precedent: `compileMaskSelector` throws at factory time (:489-490). Sandbox assertion is the analogous loud-fail (:211-213). | Pure origin classifier; `createViewer` config (`assetOriginPolicy`, `allowAssetOrigins`, `mediaMode`); pre-write gate → placeholder. |

### By asset surface

| Asset surface | Absolutified? | Survives both sanitizers? | currentSrc pin needed? | Notes |
|---------------|---------------|---------------------------|------------------------|-------|
| `<img src>` | ✅ (`URL_ATTRS`) | ✅ (not in DROP_TAGS; `img-src` allows) | only if `currentSrc`≠`src` | The byte-identical baseline; no enrichment for plain `src`. |
| `<img srcset>` | ✅ (`absolutifySrcset` :3025) | ✅ (`scrubSrcset` per-candidate :233) | ✅ yes | Responsive — viewer DPR differs; pin `currentSrc`, neutralize `srcset`/`sizes`. |
| `<picture>` + `<source srcset>` | ✅ (srcset path) | ✅ (`<picture>`/`<source>` not in DROP_TAGS — sanitize.js:57) | ✅ yes (on the resolved `<img>`) | `<source>` is a plain element; survives verbatim. |
| `<source src>` (in `<picture>`/`<video>`) | ✅ (`src` in `URL_ATTRS`) | ✅ | n/a (image case via picture) | `<source>` kept; ASST-01 scope is the image surfaces. |
| SVG `<image xlink:href>` | ✅ (getAttributeNS :3262; scheme-checked :2801-2807) | ✅ | n/a | NS-qualified absolutify + scheme check both present. |
| CSS `background-image` | ✅ (`getComputedStyle` returns absolute; `CURATED_PROPS`/`SHELL_PROPS` include it) | ✅ (`scrubCssText` preserves http(s)+`data:image/*`) | n/a | Already absolute by browser; verify via loopback/oracle. `img-src` covers it. |
| `<video poster>` | ✅ (`poster` in `URL_ATTRS`) | ✅ (`img-src` governs poster image) | n/a | Poster is an image; fully covered by P12 CSP. **The `<video>` element itself + playback is Phase 13.** |

## Precise Change-Site List (REQUIRED)

> Every site below is a real, read-and-confirmed location. "After line N" means "in the existing loop/branch at that site."

### (a) `blob:`/oversized-`data:` placeholder degradation — CAPTURE
**Files/functions:**
- `src/capture/index.js` — add a pure classifier `function classifyAssetRef(url, capBytes)` returning e.g. `{ ok:true }` | `{ ok:false, reason:'blob'|'oversized-data' }`. Place near `hasDangerousScheme` (:181) / `absolutifyUrl` (:3008).
- Add `function createAssetUnavailablePlaceholder(doc, rect, reason)` modeled on `createBlockPlaceholder` (:2341) — a `<div>` carrying `rr_width`/`rr_height` (px, from `readBlockRect` :2321) **and** `data-ps-asset-unavailable="<reason>"`. (Discretion: reuse `readBlockRect`; keep neutral inline style.)
- Hook the degrade at the FOUR serialization sites where URL attrs are written, AFTER absolutify and BEFORE/within `sanitizeForWire('element', …)`:
  - snapshot pair walk: the `URL_ATTRS` loop at **:3251** (degrade an `<img>`/`<source>`/`<video poster>` clone whose `src`/`poster` classifies non-shareable). The blocked-placeholder swap already happens at :3298-3300 — model the asset-unavailable swap on `replaceWithBlockPlaceholder` (:2356).
  - iframe-content walk: `URL_ATTRS` loop at **:1481** (same treatment).
  - added-node root + descendants: **:3516** and **:3537** (mutation add path).
  - mutation attr branch: **:3845** — if a mutation sets `src`/`poster` to a `blob:`/oversized-`data:`, the `attr` op must degrade (emit a placeholder-equivalent or drop the URL) rather than ship the dead ref. Route through `sanitizeForWire('attr', …)` (:3855) — see (h).
- **Byte-cap consumption:** read the new constant (g) and compare `utf8ByteLength(dataUri)` (existing helper :2397) against it.

**Why this shape:** `replaceWithBlockPlaceholder` already does exactly "swap a clone for a dimension-only `<div>`, preserving nid in `cloneToNid`" (:2356-2368). The asset-unavailable placeholder is the same mechanism with one extra attribute and three reasons. Reusing it keeps the differential oracle and the truncation/block machinery consistent.

### (b) `data-ps-currentsrc` enrichment in the serialization paths — CAPTURE
**Files/functions:**
- `src/capture/index.js` — add pure predicate `function currentSrcDiffers(resolvedCurrentSrc, resolvedSrc)` (string compare after absolutify; returns false when either is empty/equal). Unit-testable in isolation.
- Enrich on the clone in the same loops, AFTER the `URL_ATTRS` absolutify and BEFORE `sanitizeForWire('element', …)` re-scrub:
  - snapshot: after **:3270** (post-srcset, pre-`sanitizeForWire` :3280). Guard `tag === 'img'` (P12 image scope; CONTEXT pins images — `<video>`/`<audio>` currentSrc is Phase 13). Read `orig.currentSrc` (the live element, via the existing `orig`/`cl` pairing), `absolutifyUrl` it, and if `currentSrcDiffers` set `cl.setAttribute('data-ps-currentsrc', resolved)`.
  - iframe-content: after **:1486** (use `live`/`clone` pairing).
  - added-node: after **:3522** (root) and **:3543** (descendants) — note this path mutates the LIVE node then clones at :3548; set the attribute on the **wireClone**, not the live node (preserve the no-mutation invariant). Confirm the enrichment lands on the detached clone only.
- ⚠️ **jsdom caveat (VERIFIED this session):** jsdom 29.1.1 returns `currentSrc === ""` for `<img>`/`<video>` (no resource loading). The enrichment will **never fire under jsdom from a real `currentSrc`**. Tests must inject it (`Object.defineProperty(el, 'currentSrc', {value, configurable:true})` — verified to work) or unit-test `currentSrcDiffers` directly.

### (c) Renderer fetch gate + `mediaMode` + placeholder rewrite — RENDERER
**Files/functions:**
- `src/renderer/index.js` — `createViewer` (:152): read new config `cfg.mediaMode` (default `'reference'`; validate to the 3-value set), `cfg.assetOriginPolicy` (fn), `cfg.allowAssetOrigins` (array). Place near the other cfg reads (:153-171).
- Implement the gate as a function `gateAssetUrl(url) -> {allow:boolean}` that: (1) if `mediaMode==='off'` → block all asset fetch; (2) `mediaMode==='poster'` → block full-asset fetch (P12: still allows poster images — design the predicate so posters pass but document the scope; the real poster/full split matures in Phase 13); (3) run the pure origin classifier (d); (4) call `assetOriginPolicy(url, ctx)` fail-closed (throw or non-`true` → block); (5) consult `allowAssetOrigins`.
- **Hook sites (pre-write, the critical timing):**
  - **Snapshot path:** the post-parse scrub `load` listener at **:226-241** runs `sanitizeFragment(scrubDoc.body, …)` then `resetIdentityIndex`. Add an asset-gate pass over `scrubDoc.body` **here, inside the same listener, ideally folded into or run immediately alongside `sanitizeFragment`**, rewriting blocked `<img>`/poster/`background-image` to the placeholder and pinning `data-ps-currentsrc`. ⚠️ **TIMING CAVEAT (see Pitfall 1 below):** in a real browser the srcdoc parser begins fetching `<img src>` during parse, BEFORE `load` fires. The post-parse scrub cannot prevent the *initial* snapshot-image GET for a blocked origin. **Mitigation options the planner must choose between (flag for discuss/UAT):** (i) gate at the **string layer** in `buildSnapshotHtml` (snapshot.js) — rewrite blocked URLs before the srcdoc string is assembled, so the parser never sees them (this is the only way to prevent the pre-parse fetch, and it does NOT reintroduce the mXSS scrub-then-reparse anti-pattern because we are rewriting *typed attribute values in the payload object / the string we are about to emit*, not re-parsing scrubbed HTML); or (ii) accept that snapshot images for blocked origins may fire one GET and rely on the gate for diffs (weaker). **Recommendation: gate snapshot asset URLs at the `buildSnapshotHtml`/payload layer (string-side, pre-srcdoc) so blocked origins never reach the parser, AND keep the post-parse pass as defense-in-depth for diffs.** This is the single most important design decision in the phase and must be explicit in the plan.
  - **Diff ADD path:** `src/renderer/diff.js` ADD branch parses into a `<template>` (:209-210) and runs `sanitizeFragment(tpl.content, …)` (:214) BEFORE `importNode` (:232). Template content is inert (not in a live document → no fetch), so gating `tpl.content` here is pre-write and safe. Add the asset-gate pass to the same `sanitizeFragment` call or immediately after it, before :232.
  - **Diff ATTR path:** `diff.js` ATTR branch (:274-322) calls `sanitizeAttrValue` (:299) before `setAttribute` (:321). For `src`/`poster` attrs, interpose the gate: blocked → rewrite to placeholder-equivalent or drop. This is the live-element mutation case — gating before `setAttribute` is pre-write.
  - **Subtree-response path:** `index.js` handleSubtreeResponse parses a template + `sanitizeFragment` (:1170-1172) before `importNode` (:1180). Same treatment.
- The renderer placeholder rewrite should produce the SAME visual as the capture placeholder (dimensioned `<div data-ps-asset-unavailable="blocked-origin">`) for consistency. (Discretion: a shared helper, or duplicated per the project's zero-shared-coupling capture/renderer style — note sanitize.js duplicates `scrubCssText` deliberately.)

### (d) Origin-policy pure helper (private-range/scheme classifier)
**Files/functions:**
- New pure function — recommend `src/renderer/asset-policy.js` (a new renderer-side module) OR a top-of-file pure function in `src/renderer/index.js`. CONTEXT discretion says **prefer a pure, unit-testable function reusable by Phase 15** → a dedicated module is the cleanest seam.
- Signature: `function classifyAssetOrigin(url) -> { allowed:boolean, reason:string }` where `reason ∈ {'ok','bad-scheme','private-host','unqualified-host','parse-error'}`.
- Logic (fail-closed): parse with `new URL(url)`; require `protocol === 'https:'` (block `http:`, `data:`/`blob:` are handled at capture but defense-in-depth block here too); extract `hostname`; block if it matches the denylist (see Security Domain for the exact list); block unqualified/`.local` hosts; any parse error → blocked.
- Export it so Phase 15 masking can reuse the same classifier. Pure (no DOM, no network) → table-driven unit tests.

### (e) Byte-cap constant for oversized `data:`
**Files/functions:**
- `src/protocol/constants.js` — add `export const ASSET_DATA_URI_MAX_BYTES = <value>; // <units/derivation comment>` following the file's convention (e.g. `INLINE_STYLE_MAX_BYTES = 500000;` :49 is the closest precedent).
- **Recommended default (discretion):** `262144` (256 KiB) — comfortably below `SNAPSHOT_BUDGET_BYTES` (= 0.8 × 1 MiB ≈ 838 KiB, :19-21) so a single inline image cannot dominate the snapshot budget, while preserving genuinely-small inline icons/sprites byte-identical. Document derivation: "≈ 1/4 of the per-message cap headroom; a `data:` image larger than this degrades to a placeholder so one inline asset cannot crowd out the rest of the snapshot." [ASSUMED — the exact value is Claude's discretion per CONTEXT; flag for confirmation.]
- Consumed in capture (a) via `utf8ByteLength` (:2397) comparison.

### (f) Divergence-ledger entry + asset fixture scenario
**Files/functions:**
- `tests/differential/divergence-ledger.js` — append a new `mismatch` entry to the `DIVERGENCES` array (after D25, :567). Model on **D24-phase8-add-op-computed-styles** (:503) / **D25-cssom-mode-style-sources** (:567) — both are extracted-only snapshot enrichments pinned to a focused scenario.
  - `id: 'D26-currentsrc-variant-pin'` (next free id), `kind: 'mismatch'`.
  - `affectedMessages: [STREAM.SNAPSHOT, STREAM.MUTATIONS]`, `affectedScenarios: ['static-assets']` (the new scenario name).
  - `appliesTo(refMsg, extMsg, scenarioName)`: guard `scenarioName === 'static-assets'`; for SNAPSHOT, return true when the extracted snapshot HTML contains `data-ps-currentsrc` and the reference does not (mirror the D7 same-index pattern :402-410 and D25 :586-588). The entry MUST fire (stale-entry detection at oracle.test.js end asserts every `mismatch` entry matches ≥1 divergence — :8-11).
- New scenario `tests/differential/scenarios/static-assets.js` — `name='static-assets'`; a `beforeStart(side)` that **injects a divergent `currentSrc`** (`Object.defineProperty(imgEl, 'currentSrc', {value:'https://fixture.test/2x.png', configurable:true})`) on an `<img srcset>` so the enrichment fires (jsdom returns `""` otherwise). Optionally exercise a `blob:`/oversized-`data:` `<img>` to assert the placeholder degrade is an extracted-only divergence too (may need a second ledger entry or a combined predicate — see Open Questions).
- New fixture `tests/differential/fixtures/static-assets.html` — focused fixture (pattern: `phase8-fidelity.html`, `cssom-mode.html`) with `<img srcset>`, `<picture><source>`, SVG `<image>`, a `background-image` element, a `<video poster>`, a `blob:`-src `<img>`, and an oversized-`data:` `<img>`. Register in the oracle matrix (`tests/differential/oracle.test.js` SCENARIOS array, after :62): `{ fixture:'static-assets.html', scenario: staticAssets, config:{} }` + add the import (after :39).
- Existing fixtures already contain `<img src>` (basic.html:25), `<img srcset>` (heavy-realistic.html:26), SVG xlink (heavy-realistic.html:29) — these prove the *absolutify* path; the new fixture proves the *enrichment + degrade* path.

### (g) srcdoc CSP assertion test
**Files/functions:**
- Extend `tests/renderer-snapshot.test.js` (the `buildSnapshotHtml` string-assertion home; `CSP_CONTENT` pinned at :54-55) OR add to `tests/security-chokepoint-purity.test.js` (the security-contract home; asserts CSP meta exists at :177-178 and SECURITY.md markers at :218-228).
- Assertions: assembled srcdoc (i) contains `img-src http: https: data:`, (ii) still contains `default-src 'none'`, (iii) contains **no** `script-src`, (iv) contains **no** `media-src` (proving the Phase-13 deferral is intentional, not forgotten). The exact-string pin at renderer-snapshot.test.js:57-66 is the template.
- **Real-fetch proof belongs in Playwright UAT** (jsdom does not enforce meta-CSP or fetch): a real-Chrome test loading a srcdoc with a cross-origin `<img>` (loads) and a `<script>`/`fetch` (blocked by `default-src 'none'`).
- If the plan updates `docs/SECURITY.md` to document the asset-fetch surface (it should, per MSEC docs requirement), note the chokepoint-purity test pins exact markers (:218-228) incl. `'style-src http: https: 'unsafe-inline''` — consider adding an `img-src` marker so the asset surface can't silently regress.

### (h) (Discretionary) `sanitizeForWire('media-url', …)` no-op seam
- CONTEXT leaves it to discretion whether to add the `media-url` dispatch kind to `sanitizeForWire` (:2741) now (default off, byte-identical) as a Phase-15 hook, or defer. **Recommendation: defer to Phase 15** unless the placeholder-degrade (a) naturally wants a dispatch kind — the degrade logic is about *fetchability* (a renderer/capture concern), not *masking* (Phase 15). Adding an empty seam now risks an unexercised code path. If added, it must be byte-identical when off and covered by a no-op test.

## Architecture Patterns

### System Architecture Diagram

```
                        PHASE 12 STATIC-ASSET BY-REFERENCE FLOW

  live <img>/<picture>/<source>/<video poster>/svg<image>/bg-image
        │
        ▼  CAPTURE  (src/capture/index.js — 4 serialization sites)
   ┌─────────────────────────────────────────────────────────────────┐
   │ URL_ATTRS absolutify (:3251/:1481/:3516/:3845)                    │
   │ absolutifySrcset (:3269/:1486/:3522/:3849)                        │
   │ SVG xlink:href absolutify (:3262) + scheme-check (:2801)          │
   │ background-image: getComputedStyle → already absolute (:3046)     │
   │ ── ➕ classifyAssetRef(url): blob:/oversized-data? ───┐           │
   │        yes → createAssetUnavailablePlaceholder         │           │
   │              <div rr_width rr_height                   │           │
   │                   data-ps-asset-unavailable="reason">  │           │
   │ ── ➕ currentSrcDiffers? → cl.setAttribute(            │           │
   │        'data-ps-currentsrc', resolved)  (CLONE ONLY)   │           │
   │ sanitizeForWire('element'|'attr')  ◄── chokepoint (:2741)         │
   └──────────────┬──────────────────────────────────────────────────┘
                  │ transport.send(STREAM.SNAPSHOT|MUTATIONS, payload)
                  ▼  PROTOCOL  (messages.js + constants.js)
        SnapshotPayload.html carries URL STRINGS only (never bytes)
        ➕ ASSET_DATA_URI_MAX_BYTES constant
                  │
                  ▼  RELAY  (src/relay/relay.js — UNCHANGED)
        receive(raw) → checkRelayFrameLimit (type only) → sendToTargets
        target.send(options.raw)  ── byte-verbatim; never fetches  ──► SC#1 PROOF
                  │
                  ▼  RENDERER  (src/renderer/)
   ┌─────────────────────────────────────────────────────────────────┐
   │ createViewer cfg: mediaMode(default 'reference'),                 │
   │                   assetOriginPolicy, allowAssetOrigins            │
   │                                                                   │
   │ ➕ classifyAssetOrigin(url) — PURE: https-only + private deny     │
   │ ➕ gateAssetUrl(url): mediaMode → classifier → host hook (fail-   │
   │     closed) → allowlist                                           │
   │                                                                   │
   │ PRE-WRITE GATE SITES (block before browser GETs):                 │
   │  • snapshot: buildSnapshotHtml/payload string-side (RECOMMENDED   │
   │      to beat the parser pre-fetch) + post-parse scrub :226-241    │
   │  • diff ADD: tpl.content before importNode (:214→:232)            │
   │  • diff ATTR: before setAttribute (:299→:321)                     │
   │  • subtree-response: tpl before importNode (:1172→:1180)          │
   │  blocked → dimensioned placeholder (data-ps-asset-unavailable     │
   │            ="blocked-origin"); viewer never issues the GET        │
   │                                                                   │
   │ ➕ currentSrc pin: set effective src = data-ps-currentsrc;        │
   │     neutralize srcset/sizes (no re-negotiation under viewer DPR)  │
   │                                                                   │
   │ srcdoc iframe sandbox="allow-same-origin" (NO allow-scripts,      │
   │   asserted :209-213 — UNTOUCHED)                                  │
   │ CSP_META default-src 'none'; img-src http: https: data;          │
   │   (CONFIRM; no media-src — Phase 13)                              │
   └───────────────┬─────────────────────────────────────────────────┘
                   ▼
   allowed <img>/poster/bg fetch bytes DIRECT from CDN/source
   (viewer-side fetch over the viewer's own network — never the relay)
```

### Recommended Project Structure (delta only)
```
src/
├── protocol/
│   └── constants.js          # + ASSET_DATA_URI_MAX_BYTES                    [MOD]
├── capture/
│   └── index.js              # + classifyAssetRef(), currentSrcDiffers(),    [MOD]
│                             #   createAssetUnavailablePlaceholder(),
│                             #   data-ps-currentsrc enrich + degrade hooks
│                             #   in the 4 serialization sites
├── renderer/
│   ├── index.js              # + mediaMode/assetOriginPolicy/allowAssetOrigins[MOD]
│   │                         #   cfg; gateAssetUrl(); pre-write gate +
│   │                         #   currentSrc pin in snapshot/diff/subtree paths
│   ├── snapshot.js           # (string-side asset gate IF chosen for snapshot) [MOD?]
│   │                         #   CSP_META UNCHANGED (confirm-only)
│   └── asset-policy.js       # NEW: pure classifyAssetOrigin() (Phase-15-     [NEW]
│                             #      reusable); private-range/scheme classifier
tests/
├── renderer-asset-policy.test.js     # pure classifier table tests           [NEW]
├── renderer-asset-gate.test.js       # jsdom srcdoc-glue: gate blocks→        [NEW]
│                                      # placeholder; currentSrc pin; CSP assert
├── capture-asset-degrade.test.js     # blob:/oversized-data→placeholder;      [NEW]
│                                      # small data: byte-identical;
│                                      # data-ps-currentsrc enrichment (injected)
└── differential/
    ├── divergence-ledger.js          # + D26 currentsrc-pin mismatch entry    [MOD]
    ├── oracle.test.js                # + static-assets matrix row + import     [MOD]
    ├── scenarios/static-assets.js    # NEW focused scenario (injects currentSrc)[NEW]
    └── fixtures/static-assets.html    # NEW focused asset fixture              [NEW]
```

### Pattern 1: Clone-only enrichment (the nid precedent)
**What:** Write framework attributes on the serialized **clone**, never the live page.
**When to use:** `data-ps-currentsrc` (ASST-03) and the asset-unavailable placeholder.
**Why:** Phase 7 locked "capture no longer mutates the observed page" — nids travel in the `nodeIds` sidecar, not as live attributes. The added-node path is the trap: it mutates the LIVE node for absolutify (:3519) then clones at :3548; the enrichment MUST go on the `wireClone`, not the live node.
```js
// Source: src/capture/index.js — snapshot pair walk, after the srcset absolutify (:3270)
// `orig` is the live element, `cl` is the detached wire clone (the existing pairing).
if (tag === 'img' && orig.currentSrc) {
  var resolvedCurrent = absolutifyUrl(orig.currentSrc, document);
  var resolvedSrc = cl.getAttribute('src') || '';
  if (resolvedCurrent && currentSrcDiffers(resolvedCurrent, resolvedSrc)
      && !hasDangerousScheme(resolvedCurrent)) {
    cl.setAttribute('data-ps-currentsrc', resolvedCurrent); // clone only
  }
}
// sanitizeForWire('element', { orig: orig, clone: cl }) re-runs after this (:3280)
```

### Pattern 2: Dimensioned placeholder degrade (the block-placeholder precedent)
**What:** Swap a non-shareable asset's clone for a dimension-only `<div>` that preserves layout and carries a machine-readable reason.
**When to use:** `blob:`/oversized-`data:` at capture (ASST-04); blocked-origin at the renderer (MSEC-01).
```js
// Source: modeled on createBlockPlaceholder (src/capture/index.js:2341) +
//         replaceWithBlockPlaceholder (:2356)
function createAssetUnavailablePlaceholder(doc, rect, reason) {
  var ph = doc.createElement('div');
  ph.setAttribute('rr_width', String(rect.width || 0) + 'px');
  ph.setAttribute('rr_height', String(rect.height || 0) + 'px');
  ph.setAttribute('data-ps-asset-unavailable', reason); // 'blob'|'oversized-data'|'blocked-origin'
  return ph;
}
```

### Pattern 3: Pure fail-closed origin classifier (the compileMaskSelector precedent)
**What:** A DOM-free, network-free function that returns allow/deny + reason; any uncertainty → deny.
**When to use:** MSEC-01 renderer gate; reused by Phase 15.
```js
// Source: NEW src/renderer/asset-policy.js — pure, table-testable
export function classifyAssetOrigin(url) {
  var u;
  try { u = new URL(String(url)); } catch (e) { return { allowed: false, reason: 'parse-error' }; }
  if (u.protocol !== 'https:') return { allowed: false, reason: 'bad-scheme' };
  var host = u.hostname.toLowerCase();
  if (isPrivateOrLocalHost(host)) return { allowed: false, reason: 'private-host' };
  if (host.indexOf('.') === -1 || host.endsWith('.local')) return { allowed: false, reason: 'unqualified-host' };
  return { allowed: true, reason: 'ok' };
}
```

### Anti-Patterns to Avoid
- **Gating asset URLs only AFTER the srcdoc parses (post-`load`).** In a real browser the parser fetches `<img src>` during parse, before `load`. For *snapshot* images, gate at the string/payload layer (pre-srcdoc) so blocked origins never reach the parser. (Diffs are safe to gate post-parse because template content is inert.) — see Pitfall 1.
- **Reintroducing the mXSS scrub-then-reparse pattern.** Do NOT serialize a sanitized DOM back to a string and re-parse it. The snapshot string-side gate operates on the typed payload / the string about to be emitted, never on re-parsed scrubbed HTML — distinct from mXSS. (snapshot.js header :14-19 documents the invariant.)
- **Putting `blob:` on the wire.** `absolutifyUrl` passes it through (:3009); it is origin-local and dead at the viewer. Detect and degrade at capture (ASST-04).
- **Adding `media-src` in Phase 12.** It is Phase 13 (when `<video>`/`<audio>` ship). The poster is an image — `img-src` covers it. Adding `media-src` early is unexercised CSP surface.
- **Mutating the live page with `data-ps-currentsrc`.** Clone-only; the added-node path is the trap (set on `wireClone`).
- **Weakening the sandbox to "make assets work."** Never needed for static images; the `allow-scripts`-forbidden scan (security-chokepoint-purity.test.js:110-118) must stay green.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Absolutify asset URLs | A new URL resolver | Existing `absolutifyUrl` (:3008) + `absolutifySrcset` (:3025) | Already handle `baseURI`, srcset descriptors, data/blob pass-through, error containment. |
| Parse srcset | A `split(',')` | Existing `parseSrcsetCandidates` (:197) / `scrubSrcset` (:233) | Keeps commas inside `data:` candidate URLs; benign srcset stays byte-identical. |
| Dimensioned placeholder | A bespoke element | Model on `createBlockPlaceholder` (:2341) + `readBlockRect` (:2321) | Same `rr_width`/`rr_height` convention the renderer + oracle already understand. |
| Detect dangerous schemes | New scheme logic | Existing `hasDangerousScheme` (:181, render dup sanitize.js:82) | Already control-char-tolerant; covers `javascript:`/`vbscript:`/`data:text/html`. (Note: it does NOT block `blob:`/`data:image/*` — that is ASST-04's job, a *fetchability* check, not an *injection* check.) |
| Wire-byte budgeting | A new size check | Existing `utf8ByteLength` (:2397) + `RELAY_PER_MESSAGE_LIMIT_BYTES`/`SNAPSHOT_BUDGET_BYTES` (constants.js:9,19) | The byte-cap derives from the existing budget; reuse the helper. |
| Differential equivalence | A new comparison | Existing oracle + `divergence-ledger.js` `mismatch` entries | D24/D25 are the exact template for an extracted-only snapshot enrichment. |
| **EXCEPTION — private-range classifier** | An npm IP library (`ipaddr.js`) | **DO hand-roll a ~40-line pure classifier** | The denylist is a small fixed enumerable set (RFC1918 + link-local + loopback + ULA + `.local`); a pure function is dependency-free (library constraint), unit-testable, and Phase-15-reusable. This is the rare "build it" case. |

**Key insight:** Phase 12 is overwhelmingly "wire the verification tests + reuse existing seams." The only genuinely new *logic* is the origin classifier (small, pure, hand-rolled) and the gate orchestration. Everything else extends a proven mechanism.

## Common Pitfalls

### Pitfall 1: Snapshot images for a blocked origin fire a GET before the post-parse gate runs
**What goes wrong:** The renderer's post-parse scrub (`sanitizeFragment` in the `load` listener, index.js:226-241) runs AFTER the srcdoc parses. But a real browser's HTML parser begins fetching `<img src=https://blocked/...>` *during parse*, before `load`. So a renderer gate that only runs post-parse cannot stop the *initial snapshot* image fetch to a blocked origin — defeating MSEC-01 for snapshots.
**Why it happens:** jsdom never parses srcdoc and never fetches, so the timing bug is invisible in unit tests (the loopback glue manually `cd.write`s and dispatches a synthetic `load`). It only manifests in a real browser.
**How to avoid:** Gate snapshot asset URLs at the **string/payload layer** before the srcdoc is assembled — rewrite blocked `<img>`/poster/`background-image` URLs to placeholders in (or just before) `buildSnapshotHtml`, so the parser never sees a blocked URL. Keep the post-parse pass as defense-in-depth and for diffs. Diffs are safe to gate post-parse because the ADD branch scrubs inert `<template>` content before `importNode` (diff.js:214→232).
**Warning signs:** A Playwright UAT shows an outbound GET to a denied origin on the first snapshot even though "the gate is in place"; the gate works for diffs but not initial load.

### Pitfall 2: `currentSrc` is empty in jsdom — the enrichment never fires under unit/oracle tests
**What goes wrong:** jsdom 29.1.1 returns `currentSrc === ""` for `<img>`/`<video>` (verified this session) because it loads no resources. A differential scenario that just sets `srcset` and starts capture will produce NO `data-ps-currentsrc`, the D26 `mismatch` ledger entry will never fire, and the stale-entry detector (oracle.test.js) will FAIL the build for a dead entry.
**Why it happens:** `currentSrc` is populated by the browser's resource-selection algorithm, which jsdom does not run.
**How to avoid:** In the scenario's `beforeStart`, inject `currentSrc` via `Object.defineProperty(imgEl, 'currentSrc', {value:'https://fixture.test/2x.png', configurable:true})` (verified to work in jsdom this session). Unit-test the `currentSrcDiffers` predicate directly with stub strings. Verify real `currentSrc`-driven enrichment in Playwright UAT against a real responsive image.
**Warning signs:** Oracle "stale ledger entry D26 matched 0 divergences" failure; the enrichment test passes vacuously (asserts nothing because the attribute is absent).

### Pitfall 3: Conflating injection-safety with fetch-safety
**What goes wrong:** "We already scheme-check URLs, so they're safe" — but `hasDangerousScheme` (:181) is *injection* safety (can this execute script?). It allows `http:`/`https:` to ANY host, including `https://169.254.169.254/...` or `https://internal-admin/...`. The viewer fetching those is SSRF/tracking from the viewer's network — a different control.
**Why it happens:** The v1 mental model ("mirror renders inert") never had a fetch surface. Static images quietly became one.
**How to avoid:** The origin classifier (MSEC-01) is a SEPARATE control from `hasDangerousScheme`. It must run at the renderer pre-write, fail-closed, https-only, private-range-deny. Document it as a new threat-model entry.
**Warning signs:** A pen-test "blind SSRF via mirrored image URL"; the viewer host makes outbound requests to internal IPs.

### Pitfall 4: The added-node path mutates the live node — enrichment must target the clone
**What goes wrong:** `processAddedNode` absolutifies on the LIVE element (:3519, :3540) and clones at :3548. Setting `data-ps-currentsrc` (or the placeholder) on the live node violates the Phase 7 no-mutation invariant and could leak the framework attribute to the page's own selectors.
**How to avoid:** Set the enrichment / build the placeholder on the `wireClone` (the detached clone serialized to the wire), exactly as `cloneToNid` placeholder swaps already do (:2356-2368). Confirm via a capture-purity-style test that the live DOM has no `data-ps-*` attributes after capture.
**Warning signs:** A page's `querySelectorAll('[data-ps-currentsrc]')` finds elements; capture-identity tests detect live-page mutation.

### Pitfall 5: `data:` byte-cap regression — small inline images must stay byte-identical
**What goes wrong:** An over-eager degrade rewrites ALL `data:` images to placeholders, breaking the existing `data:image/*` pass-through and churning the differential oracle (every fixture `data:` icon becomes a mismatch).
**How to avoid:** Degrade ONLY when `utf8ByteLength(dataUri) > ASSET_DATA_URI_MAX_BYTES`. Below the cap → untouched, byte-identical (the oracle stays green; no ledger entry needed for small `data:`). Add a test asserting a small `data:image/png` survives byte-for-byte.
**Warning signs:** Oracle mismatches on fixtures with small inline icons; a new ledger entry needed just for ordinary `data:` images (a smell that the cap is mis-applied).

## Code Examples

### Origin classifier with the exact denylist (pure, table-testable)
```js
// Source: NEW src/renderer/asset-policy.js — derived from CONTEXT denylist + RFC1918/3927/4193
function isPrivateOrLocalHost(host) {
  if (host === 'localhost' || host === '::1' || host.endsWith('.local')) return true;
  // IPv4 dotted-quad ranges
  var m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (m) {
    var a = +m[1], b = +m[2];
    if (a === 127) return true;                          // 127.0.0.0/8 loopback
    if (a === 10) return true;                           // 10.0.0.0/8
    if (a === 172 && b >= 16 && b <= 31) return true;    // 172.16.0.0/12
    if (a === 192 && b === 168) return true;             // 192.168.0.0/16
    if (a === 169 && b === 254) return true;             // 169.254.0.0/16 link-local
    return false;
  }
  // IPv6 ULA fc00::/7 (fc.. or fd..) — bracketed hostnames have brackets stripped by URL
  if (/^f[cd][0-9a-f]*:/.test(host)) return true;
  return false;
}
```

### Diff ATTR-branch gate interposition (pre-write)
```js
// Source: src/renderer/diff.js ATTR branch (:299-321) — add the gate for src/poster
var scrubbed = sanitizeAttrValue(m.attr, m.val); // existing injection scrub
if (scrubbed.drop) { /* existing */ }
// NEW fetch gate (defense-in-depth, pre-setAttribute):
var lowAttr = String(m.attr).toLowerCase();
if ((lowAttr === 'src' || lowAttr === 'poster') && scrubbed.value
    && !gateAssetUrl(scrubbed.value).allow) {
  rewriteToAssetPlaceholder(target, 'blocked-origin'); // dimensioned, never GETs
  break;
}
target.setAttribute(m.attr, scrubbed.value); // existing
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| v1: `<video>`/`<audio>` degraded to poster; mirror "renders inert" | v2.0: viewer *fetches* assets by reference from the source/CDN | This milestone (Phases 12-15) | Introduces the viewer-fetch threat surface; static images are the first instance, so the security model lands in Phase 12. |
| rrweb `inlineImages: true` (freeze image bytes into the snapshot) | rrweb default `inlineImages: false` — transport the URL, viewer re-fetches | rrweb's validated default | PhantomStream matches the proven baseline; animated GIF/WebP/APNG animate natively by reference (strictly better than frozen inline). [CITED: SUMMARY.md, PITFALLS.md] |

**Deprecated/outdated:**
- Inlining media/large images as `data:` to "make them shareable" — blows the 1 MiB cap; the byte-capped *small-image* inline is the only escape hatch (ASST-04 enforces the cap).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `ASSET_DATA_URI_MAX_BYTES = 262144` (256 KiB) is a good default | (e) byte-cap | Too low → benign medium icons degrade unnecessarily; too high → a single inline image can crowd the snapshot budget. Discretion per CONTEXT; confirm during planning. The value is *configurable* so the risk is bounded. |
| A2 | Gating snapshot asset URLs at the string/payload layer (pre-srcdoc) does NOT reintroduce mXSS | Pitfall 1, Anti-Patterns | If a reviewer reads "rewrite URLs in the snapshot string" as scrub-then-reparse, they may object. Distinction: we rewrite typed payload values / the string we are *emitting*, not re-parsed scrubbed HTML. Needs explicit callout in the plan + SECURITY.md. |
| A3 | `D26` is the next free divergence id | (f) ledger | Ids currently go to D25; confirm no parallel branch added D26. Low risk (grep-checkable at plan time). |
| A4 | `mediaMode: 'poster'` in Phase 12 still allows poster *images* to fetch (the full off/poster/reference split matures in Phase 13) | (c) renderer gate | If the intended P12 semantics of `poster` is stricter, the gate predicate differs. CONTEXT defines the values but the poster/full-asset distinction is most meaningful once `<video>` ships (Phase 13). Flag for discuss-phase. |

**If this table needs resolution:** A1 and A4 are the two worth a quick confirmation in discuss-phase; A2 is a documentation/framing item; A3 is mechanical.

## Open Questions

1. **Snapshot-image pre-fetch timing (the key design decision).**
   - What we know: post-parse gate is too late for the *initial* snapshot image GET in a real browser; diffs are fine post-parse.
   - What's unclear: whether the plan accepts a one-time snapshot GET for blocked origins (simpler) or gates at the string layer (correct, slightly more code in snapshot.js).
   - Recommendation: **gate snapshot asset URLs at the `buildSnapshotHtml`/payload layer** (pre-srcdoc) + keep post-parse as defense-in-depth. Make this explicit in the plan and SECURITY.md.

2. **One combined `static-assets` scenario vs. separate fixtures for pin vs. degrade.**
   - What we know: the D26 `mismatch` entry must fire; degrade (blob/oversized-data) is also an extracted-only divergence.
   - What's unclear: whether one `appliesTo` predicate cleanly covers both currentSrc-pin AND degrade, or whether two ledger entries are cleaner.
   - Recommendation: start with the currentSrc-pin D26 entry pinned to the scenario; if the degrade produces a separate mismatch shape (placeholder `<div>` vs reference `<img>`), add a second `mismatch` entry (e.g. `D27-asset-unfetchable-placeholder`) rather than overloading one predicate. Decide during planning by running the oracle.

3. **Where the renderer placeholder lives (shared vs duplicated helper).**
   - What we know: the project deliberately duplicates `scrubCssText` capture/renderer (zero shared coupling).
   - What's unclear: whether the asset placeholder should follow that duplication or be a shared util.
   - Recommendation: duplicate per the project shape (renderer builds its own `blocked-origin` placeholder; capture builds `blob`/`oversized-data`). Discretion.

## Environment Availability

> Phase 12 is code/test-only against the existing toolchain — no new external services.

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | test runner | ✓ | v24.x | — |
| jsdom | renderer/capture unit + oracle tests | ✓ (dev) | 29.1.1 | — |
| Playwright | real-Chrome fetch UAT (CSP, blocked GET, CORS, mixed-content) | ✓ (dev) | ^1.60.0 | UAT can be deferred per the project's UAT-deferral precedent; unit/oracle still prove logic |
| `ws` | (unused by P12 logic) | ✓ | 8.21.0 | — |

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:** Playwright UAT for *real fetch reality* (CSP enforcement, actual blocked GET, CORS/mixed-content, real `currentSrc`) — jsdom cannot exercise these; they are explicitly the real-Chrome UAT's job (see Validation Architecture). If UAT is deferred, the pure/jsdom layer still proves the gate/classifier/enrichment logic.

## Validation Architecture

> nyquist_validation is enabled (no `.planning/config.json` override found disabling it). The testable surface splits cleanly: pure functions + jsdom srcdoc-glue cover the logic; real-Chrome/Playwright covers fetch reality.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | `node:test` + `node:assert/strict` (Node 24 built-ins) |
| Config file | none — `package.json` `scripts.test` = `node --test tests/*.test.js tests/differential/*.test.js` |
| Quick run command | `node --test tests/renderer-asset-policy.test.js tests/capture-asset-degrade.test.js` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| ASST-01 | img/srcset/picture/source/svg-image absolutified; no bytes on relay | oracle + unit | `node --test tests/differential/oracle.test.js` | partial (existing fixtures) / ❌ Wave 0 (relay byte-identity assertion) |
| ASST-02 | background-image + `<video>` poster absolute & render under `img-src` | jsdom renderer + oracle | `node --test tests/renderer-asset-gate.test.js` | ❌ Wave 0 |
| ASST-03 | `data-ps-currentsrc` pin (clone-only); viewer pins + neutralizes srcset | unit (predicate) + oracle (D26) + jsdom (pin) | `node --test tests/differential/oracle.test.js tests/renderer-asset-gate.test.js` | ❌ Wave 0 |
| ASST-04 | blob:/oversized-data → dimensioned placeholder; small data: byte-identical | capture unit | `node --test tests/capture-asset-degrade.test.js` | ❌ Wave 0 |
| ASST-05 | CSP `img-src` covers assets; `default-src 'none'`, no `script-src`/`media-src` | string assertion (jsdom) + Playwright (real CSP) | `node --test tests/renderer-snapshot.test.js` | partial (extend existing) |
| MSEC-01 | origin classifier https-only + private-range deny; fail-closed hook; pre-write gate→placeholder | pure unit (classifier) + jsdom (gate) | `node --test tests/renderer-asset-policy.test.js tests/renderer-asset-gate.test.js` | ❌ Wave 0 |
| MSEC-02 | `mediaMode` off/poster/reference selects posture; default reference | jsdom (gate behavior per mode) | `node --test tests/renderer-asset-gate.test.js` | ❌ Wave 0 |

### Sampling Rate (Nyquist — fewest tests that catch a regression per criterion)
- **Per task commit:** `node --test tests/<the-file-touched>.test.js` (sub-second; e.g. the classifier table test for any asset-policy change).
- **Per wave merge:** `npm test` (full suite incl. differential oracle).
- **Phase gate:** full suite green + Playwright asset UAT (or explicit UAT-deferral note) before `/gsd:verify-work`.

**Minimum regression-catching set per criterion:**
- ASST-01/02 (absolutify + no-bytes): 1 oracle run on `static-assets.html` + 1 relay byte-identity unit test. (Catches any regression that puts bytes on the wire or fails to absolutify.)
- ASST-03 (currentSrc pin): 1 `currentSrcDiffers` table test (enrich vs no-enrich) + 1 oracle D26 fire + 1 jsdom pin/neutralize test. (3 tests prove capture-emits, oracle-ledgers, viewer-pins.)
- ASST-04 (degrade): 3 unit cases — `blob:`→placeholder, oversized-`data:`→placeholder, small-`data:`→byte-identical. (Catches both over- and under-degrade.)
- ASST-05 (CSP): 1 string assertion (has `img-src`, has `default-src 'none'`, no `script-src`, no `media-src`). (Catches accidental CSP widening/`media-src` creep.)
- MSEC-01 (origin policy): a table test over the full denylist (one allowed public-https + one of each blocked range/scheme + throwing-hook-fails-closed) + 1 jsdom "blocked URL never written, placeholder present instead" test.
- MSEC-02 (mediaMode): 3 jsdom cases — `off` (no asset write), `reference` (asset written), `poster` (poster path per chosen P12 semantics).

### What is jsdom-unit-testable vs real-Chrome/Playwright UAT
| Verifiable in jsdom/node | Must be real-Chrome/Playwright UAT |
|--------------------------|-----------------------------------|
| `classifyAssetOrigin` denylist (pure table tests) | Actual blocked GET to a denied origin not firing (real network) |
| `currentSrcDiffers` predicate (pure) | Real `currentSrc` resolution under a real responsive image + viewer DPR |
| `data-ps-currentsrc` emitted on clone (oracle, injected currentSrc) | Real `srcset`/`sizes` neutralization preventing re-negotiation |
| Placeholder degrade for blob/oversized-data; small data byte-identical | Real `data:`/`blob:` fetch behavior in the sandbox |
| CSP string assertions (has img-src, no media-src/script-src) | **Real meta-CSP enforcement** (jsdom does not enforce CSP): image loads, script/fetch blocked by `default-src 'none'` |
| Pre-write gate for diffs (template content, synthetic load) | **Snapshot pre-fetch timing** (Pitfall 1) — parser fetching `<img>` before load |
| Sandbox token unchanged (static scan) | mixed-content / CORS outcomes → placeholder |

### Wave 0 Gaps
- [ ] `tests/renderer-asset-policy.test.js` — pure classifier table (MSEC-01)
- [ ] `tests/renderer-asset-gate.test.js` — jsdom srcdoc-glue: gate→placeholder, currentSrc pin, mediaMode behavior, CSP assertion (ASST-02/03/05, MSEC-01/02)
- [ ] `tests/capture-asset-degrade.test.js` — blob/oversized-data/small-data + currentSrc enrichment (ASST-03/04)
- [ ] `tests/differential/fixtures/static-assets.html` — focused asset fixture
- [ ] `tests/differential/scenarios/static-assets.js` — scenario injecting divergent `currentSrc`
- [ ] `tests/differential/divergence-ledger.js` — D26 (and possibly D27) `mismatch` entry; register fixture row + import in `oracle.test.js`
- [ ] (extend) `tests/renderer-snapshot.test.js` or `tests/security-chokepoint-purity.test.js` — CSP `img-src`/no-`media-src` assertion
- [ ] (Playwright, may defer) real-Chrome asset UAT: CSP enforcement, blocked-origin GET suppression, snapshot pre-fetch timing
- Framework install: none — `node:test` + jsdom already present.

## Security Domain

> `security_enforcement` is enabled (no config override disabling it found). This phase establishes the viewer-side-fetch security model — it is the security-critical phase of the milestone.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | No auth surface in asset rendering. |
| V3 Session Management | no | Stream identity (`isCurrentStream`) is reused, not changed. |
| V4 Access Control | no | — |
| V5 Input Validation | yes | Asset URLs are attacker-influenced input. `hasDangerousScheme` (injection) + `classifyAssetOrigin` (fetch) + `sanitizeFragment`/`sanitizeAttrValue` (render). |
| V6 Cryptography | no | No crypto; byte-cap/origin policy are not crypto controls. |
| **V12 Files & Resources** | **yes** | **The core of this phase.** Viewer-side resource fetching = SSRF/tracking/DoS surface. Fail-closed origin policy (https-only, private-range deny), `mediaMode`, pre-write gate, dimensioned placeholder. |
| V14 Configuration | yes | CSP `default-src 'none'`; sandbox `allow-same-origin` only, no `allow-scripts` (asserted + static-scanned). |

### Known Threat Patterns for {viewer fetching attacker-influenced asset URLs}

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Viewer-side SSRF (`https://169.254.169.254/...`, `https://internal-admin/...` fetched from the viewer's privileged network) | Information Disclosure / Elevation | **Fail-closed origin classifier at the renderer, pre-write**: https-only + deny `localhost`, `127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16`, `::1`, `fc00::/7`, `.local`/unqualified. Blocked → placeholder (no GET). [grounded in PITFALLS.md Pitfall 2] |
| Tracking-pixel / live-viewer confirmation (`<img src=https://attacker/track?session=...>`) | Information Disclosure | Same origin gate; `mediaMode:'off'`/`'poster'` escape hatch for security-sensitive hosts. Pre-write gate so the beacon never fires for blocked origins. |
| DoS amplification (page references hundreds of multi-MB assets the viewer fetches) | Denial of Service | Origin gate limits *which* origins; `mediaMode` limits posture. (Concurrency caps / lazy on-screen fetching are a later optimization, not P12.) |
| Dead/blob reference on the wire (`blob:` origin-local) | (correctness → DoS via broken mirror) | Detect `blob:`/origin-local at capture; never emit as fetchable → placeholder. |
| Oversized `data:` blows the 1 MiB cap → whole snapshot dropped | Denial of Service | Byte-cap constant; degrade `data:` over cap to placeholder; small `data:` byte-identical. |
| `javascript:`/`vbscript:`/`data:text/html` URL (injection) | Tampering / Elevation | Existing `hasDangerousScheme` (capture :181 + render sanitize.js:82) — separate from the fetch gate; both must hold. |
| Weakening the sandbox to render assets | Elevation (XSS) | Sandbox `allow-same-origin` only asserted at construction (index.js:209-213); `allow-scripts`-forbidden static scan (security-chokepoint-purity.test.js:110-118) must stay green. **No sandbox change in P12.** |

### How the renderer fetch gate prevents viewer-side SSRF/tracking/DoS (grounded in PITFALLS.md)
- **SSRF/tracking:** the gate runs **before the URL is written into the mirror DOM** (Pitfall 2's "applied at the renderer before the URL is written"). For diffs this is pre-`setAttribute`/pre-`importNode`; for snapshots this is pre-srcdoc (string layer) to beat the parser pre-fetch (Pitfall 1). A blocked URL is replaced by a dimensioned placeholder, so the viewer's browser **never issues the GET** — no beacon fires, no internal host is probed.
- **Fail-closed:** `classifyAssetOrigin` returns blocked on any parse error or non-https or private host; `assetOriginPolicy(url, ctx)` blocks on throw or non-`true` (mirrors `compileMaskSelector`'s fail-closed-and-loud precedent :489-490). Default is conservative; the host *widens* via `allowAssetOrigins`/the hook.
- **DoS:** `mediaMode:'off'` removes the fetch surface entirely; the origin gate bounds which origins are reachable.
- **Why pre-write, not post-render:** a post-render gate (after the URL is in the live mirror doc) is too late — the browser has already begun the fetch. This is the single non-negotiable timing rule.

### Keeping the sandbox-token-unchanged / no-`script-src` invariant green
- The sandbox assertion (index.js:209-213) and the `allow-scripts`-forbidden static scan (security-chokepoint-purity.test.js:110-118) already exist. Phase 12 adds NO sandbox/CSP-script changes, so these stay green by construction. The new asset code in `src/renderer/` must contain no `allow-scripts` literal (the scan greps renderer modules). The CSP assertion test (g) additionally pins "no `script-src` and no `media-src`" so an accidental future widening fails loudly.
- If `docs/SECURITY.md` is updated (it should be, to document the viewer-fetch surface + `mediaMode` default), preserve the exact markers the chokepoint-purity test pins (security-chokepoint-purity.test.js:218-228): `'default-src 'none''`, `'style-src http: https: 'unsafe-inline''`, `'allow-same-origin'`, `'allow-scripts'`, `'Host must-nevers'`. Add a new "Viewer-side resource fetching" section + the asset-origin denylist; consider adding an `img-src` marker to the test so the asset CSP surface is guarded.

## Sources

### Primary (HIGH confidence)
- PhantomStream shipped source (read this session at exact lines):
  - `src/capture/index.js` — `URL_ATTRS` (:61), `hasDangerousScheme` (:181), `parseSrcsetCandidates`/`scrubSrcset` (:197/:233), `scrubCssText` (:285), `createBlockPlaceholder`/`replaceWithBlockPlaceholder` (:2341/:2356), `readBlockRect` (:2321), `utf8ByteLength` (:2397), `sanitizeForWire` (:2741, URL-attr scheme check :2789, attr branch :2933), `absolutifyUrl` (:3008 — **passes data:/blob:/javascript: through**), `absolutifySrcset` (:3025), `collectComputedStyleText` (:3046), snapshot URL loop (:3251) + currentSrc-enrich site (post :3270) + `sanitizeForWire` re-scrub (:3280) + block swap (:3298), iframe-content URL loop (:1481), `processAddedNode` URL loops (:3516/:3537) + wireClone (:3548), mutation attr branch (:3845) + `sanitizeForWire('attr')` (:3855), `getTrackedNodeId` (:679), capture config typedef + `compileMaskSelector` fail-closed (:404-490).
  - `src/renderer/snapshot.js` — `CSP_META` (:57-62, no media-src), `buildSnapshotHtml` (:156), string-layer mXSS invariant (:14-19).
  - `src/renderer/index.js` — `createViewer` (:152), sandbox assertion + `viewer-sandbox-invalid` (:209-213), post-parse scrub `load` listener (:226-241), identity index (`nidToNode` :311, `resolveIndexedNode` :669, `removeIndexedSubtree` :678), `handleSnapshot` srcdoc write (:1113), `handleMutations` (:1125), `handleSubtreeResponse` template+scrub (:1170-1180), dispatch switch silent default (:1277).
  - `src/renderer/sanitize.js` — `DROP_TAGS` (:57, media tags absent), `URL_ATTRS`/`hasDangerousScheme` (:62/:82), `sanitizeAttrValue` (:204), `sanitizeFragment` (:247).
  - `src/renderer/diff.js` — ADD template+`sanitizeFragment`+importNode (:209-232), ATTR `sanitizeAttrValue`+setAttribute (:274-322).
  - `src/relay/relay.js` — `receive` (:108), `checkRelayFrameLimit` type-only classify (:112), `sendToTargets` byte-verbatim `target.send(options.raw)` (:247) — **SC#1 proof**.
  - `src/protocol/messages.js` — STREAM/DIFF_OP, `SnapshotPayload` typedef (:203), `isCurrentStream` (:258). `src/protocol/constants.js` — cap/budget constants (:9-49).
  - `tests/differential/divergence-ledger.js` — `DIVERGENCES` (:244), D7 mismatch shape (:374-435), D24/D25 extracted-only-enrichment templates (:503/:567), `ledgerCovers` (:690). `tests/differential/harness.js` (dual-jsdom, FIXTURE_URL :33), `normalize.js` (deep-equal comparison, framework-nid strip :12), `oracle.test.js` (SCENARIOS matrix :48-62, scenario imports :29-39).
  - `tests/security-chokepoint-purity.test.js` — `allow-scripts` scan (:110-118), CSP-meta assertion (:177-178), SECURITY.md markers (:218-228). `tests/renderer-snapshot.test.js` — pinned `CSP_CONTENT` (:54), exact-string CSP assertion (:57-66). `tests/renderer-loopback.test.js` — srcdoc write-glue `glueMirror` recipe (:250-265).
  - `package.json` — test command, deps (`ws@8.21.0`; dev `jsdom@^29.1.1`, `playwright@^1.60.0`).
- Empirical jsdom checks (this session, jsdom 29.1.1): `img.currentSrc===""` and `video.currentSrc===""` (no resource loading); `Object.defineProperty(el,'currentSrc',{value,configurable})` works; `blob:` URLs preserved on `getAttribute('src')`.

### Secondary (MEDIUM confidence — milestone research synthesis)
- `.planning/research/v2.0-media/SUMMARY.md`, `ARCHITECTURE.md`, `PITFALLS.md` — phase decomposition, integration design, the viewer-fetch threat model and Pitfalls 1/2/11/12/13 mapped to Phase A (= Phase 12). rrweb `inlineImages:false` baseline cited from these (rrweb primary sources are theirs, not re-verified here).
- `.planning/REQUIREMENTS.md`, `STATE.md`, `12-CONTEXT.md` — locked decisions, requirement IDs, roadmap-level constraints.

### Tertiary (LOW confidence — flagged)
- Byte-cap default value (256 KiB) — Claude's discretion per CONTEXT; A1 in the Assumptions Log.

## Metadata

**Confidence breakdown:**
- Shipped-vs-to-build mapping: HIGH — every claim read at exact file:line in the shipped source this session.
- Standard stack: HIGH — no new packages; existing toolchain confirmed via package.json.
- Architecture/change-sites: HIGH — all four serialization sites + all four renderer gate sites read and confirmed.
- Pitfalls: HIGH — the snapshot pre-fetch timing and jsdom `currentSrc===""` are verified empirically; the security model is grounded in PITFALLS.md + shipped sandbox/CSP assertions.
- Byte-cap value: LOW (A1) — discretionary, configurable, flagged.

**Research date:** 2026-06-20
**Valid until:** ~2026-07-20 (stable — the analysis is against shipped in-repo code; only the jsdom version and the byte-cap default could drift, both low-impact).

## RESEARCH COMPLETE

**Phase:** 12 - Static Assets by Reference
**Confidence:** HIGH

### Key Findings
- The by-reference static-asset pipeline is ~95% shipped for ASST-01/02/05: `URL_ATTRS` absolutify + `absolutifySrcset` + SVG xlink across all 4 serialization sites; `background-image` arrives absolute via `getComputedStyle`; the CSP `img-src http: https: data:` already covers every static image surface incl. `<video>` poster. SC#1 is architecturally proven — the relay forwards raw frames byte-verbatim (`target.send(options.raw)`, relay.js:247) and never fetches; the wire carries URL strings only.
- The genuine new work is four small seams: ASST-04 `blob:`/oversized-`data:` placeholder degrade (the `absolutifyUrl` :3009 pass-through is the gap; `createBlockPlaceholder` :2341 is the precedent); ASST-03 clone-only `data-ps-currentsrc` pin (ledgered as a D26 `mismatch`); MSEC-01 a pure fail-closed origin classifier (hand-rolled, Phase-15-reusable); MSEC-02 a `mediaMode` switch. CSP is confirm-only — `media-src` is Phase 13.
- The single most important design decision: snapshot images for a blocked origin fetch during srcdoc *parse*, before the post-parse gate runs — so snapshot asset URLs must be gated at the string/payload layer (pre-srcdoc), with the post-parse pass + diff-path gates as defense-in-depth. This is NOT mXSS (rewriting typed values we are about to emit, not re-parsing scrubbed HTML).
- Two verified jsdom constraints shape the test plan: `currentSrc===""` (the oracle scenario must inject a divergent `currentSrc` via `Object.defineProperty`, else the D26 ledger entry never fires and the stale-entry detector fails the build); jsdom doesn't enforce meta-CSP or fetch (real CSP/blocked-GET/timing belong in Playwright UAT).

### File Created
`.planning/phases/12-static-assets-by-reference/12-RESEARCH.md`

### Confidence Assessment
| Area | Level | Reason |
|------|-------|--------|
| Standard Stack | HIGH | No new packages; existing toolchain confirmed in package.json. |
| Architecture | HIGH | All 4 serialization sites + 4 renderer gate sites read at exact file:line. |
| Pitfalls | HIGH | Snapshot pre-fetch timing + jsdom currentSrc behavior verified empirically. |

### Open Questions
- Snapshot pre-fetch gate: string-layer (recommended) vs accept one-time GET — the key plan decision.
- One combined `static-assets` scenario vs separate ledger entries for pin vs degrade (decide by running the oracle).
- Byte-cap default value (256 KiB recommended) — discretionary, flag for discuss-phase.
- `mediaMode:'poster'` P12 semantics (poster images still fetch?) — the off/poster/reference split matures in Phase 13.

### Ready for Planning
Research complete. The planner has a Shipped-vs-To-Build table, a precise change-site list (a–h), a Validation Architecture for a Nyquist VALIDATION.md, and security guidance grounded in PITFALLS.md. The four discretionary/timing decisions are flagged in the Assumptions Log and Open Questions.
