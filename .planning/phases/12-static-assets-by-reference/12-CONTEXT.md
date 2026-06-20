# Phase 12: Static Assets by Reference - Context

**Gathered:** 2026-06-20
**Status:** Ready for planning

<domain>
## Phase Boundary

Verify and harden the already-shipped by-reference asset pipeline as a first-class
media feature, and establish the viewer-side-fetch security model that every later
media phase rides. In scope: every static visual — `<img>`, `srcset`, `<picture>`,
`<source>`, SVG `<image>`, CSS `background-image`, and `<video>` poster — resolves to
an absolute source URL on the wire and renders in the viewer by fetching from the
original CDN/source (no image bytes on the relay); the displayed variant is pinned via
clone-only `currentSrc` enrichment; non-shareable references degrade to a dimensioned
placeholder; the viewer CSP is confirmed/scoped precisely; and a fail-closed origin/
scheme policy hook plus a `mediaMode` switch are introduced (requirements ASST-01..05,
MSEC-01, MSEC-02).

Out of scope (later phases): `<video>`/`<audio>` playback and the `STREAM.MEDIA` sync
channel (Phase 13); adaptive HLS/DASH + adapter manifest discovery (Phase 14); the
asset/media URL **masking vocabulary** (MSEC-03) and `referrerpolicy` completion +
threat model (MSEC-04) (Phase 15). Security *decisions* are made here; their masking/
threat-model *completion* is Phase 15.

</domain>

<decisions>
## Implementation Decisions

### Viewer-Fetch Security Posture (MSEC-01, MSEC-02)
- **`mediaMode` default = `reference`** — media-by-reference is on by default (the
  milestone's purpose); public-CDN images just work out of the box. The fail-closed
  origin policy is the safety net that blocks the dangerous fetches. Switch values:
  `off` (no viewer fetch at all) | `poster` (only posters/placeholders, no full asset
  fetch) | `reference` (full by-reference fetch). Default documented in SECURITY/ARCH.
- **Default origin/scheme policy = https-only + block private/internal ranges.** Allow
  all public `https:` origins; block non-`http(s)` schemes and private/internal hosts:
  `localhost`, `127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`,
  `169.254.0.0/16` (link-local), `::1`, `fc00::/7`, and `.local`/unqualified hosts.
  Fail closed: anything not provably public-https → blocked → placeholder.
- **Host override surface = a fail-closed hook** `assetOriginPolicy(url, ctx) => boolean`
  on the viewer config (throwing or returning non-`true` blocks → placeholder), plus a
  convenience `allowAssetOrigins` array for the common allowlist case. A throwing hook
  fails closed (blocks), never opens.
- **Enforcement point = the renderer**, applied before the asset URL is written into the
  mirror DOM (blocked → dimensioned placeholder so the viewer's browser never issues the
  GET). Capture-side URL *masking* (MSEC-03) is completed in Phase 15; Phase 12 owns the
  renderer-side fetch gate.

### CSP Scope & Non-Shareable Fallback (ASST-04, ASST-05)
- **Phase 12 CSP change = confirm, not widen.** Confirm the existing
  `img-src http: https: data:` covers `<img>`/`<picture>`/`<source>`/SVG `<image>`/
  `background-image`/`<video>` poster; keep `default-src 'none'` and **no `script-src`**.
  Add a srcdoc assertion test proving images fetch and `default-src 'none'` still blocks
  scripts/other fetches. The scoped `media-src` directive is **deferred to Phase 13**
  (when the real `<video>`/`<audio>` element ships and actually needs it).
- **Placeholder = a dimensioned inline placeholder** that preserves the element's
  width/height (from attributes or computed layout), neutral background, no external
  fetch, carrying a machine-readable reason attribute (e.g. `data-ps-asset-unavailable`
  with a reason value: `blob` | `oversized-data` | `blocked-origin`).
- **Degrade to placeholder when:** `blob:`/origin-local object URLs (always — detected at
  capture, never emitted as fetchable); oversized `data:` URIs (above the cap);
  URLs the origin policy blocks (at the renderer). Phase 13 adds masked/blocked media.
- **Oversized `data:` threshold = a configurable byte cap with a documented default.**
  Small inline images (≤ cap) pass through byte-identical (preserves the existing
  `data:` pass-through and the differential oracle); larger → placeholder so a giant
  inline image cannot blow the 1 MiB per-message cap.

### currentSrc Variant Pinning (ASST-03)
- **Enrichment attribute = `data-ps-currentsrc`**, set on the serialized **clone only**
  (never on the live page — preserves the Phase 7 "capture no longer mutates the page"
  invariant), carrying the resolved `currentSrc`.
- **Enrich only when `currentSrc` is present AND differs** from the plain resolved `src`
  (i.e. `srcset`/`<picture>` actually negotiated a non-default variant). Plain
  `<img src>` stays byte-identical on the wire — no enrichment, no oracle churn.
- **Viewer pins the variant:** the renderer sets the element's effective source to
  `data-ps-currentsrc` and neutralizes `srcset`/`sizes` so the cross-origin viewer
  (different DPR/viewport) cannot re-negotiate a different asset than the origin showed.
- **Differential-oracle handling = a scoped `mismatch` ledger entry** (next D-2x id) in
  `tests/differential/divergence-ledger.js`, pinned to a static-asset scenario, claiming
  the clone-only `data-ps-currentsrc` enrichment as an intentional, extracted-only
  divergence vs the FSB reference. Add/extend an asset fixture scenario to exercise it.

### Claude's Discretion
- Exact byte-cap default for oversized `data:` images (pick a value that is safely below
  the per-message budget and document it as a named constant in `src/protocol/constants.js`).
- Internal naming of the new renderer policy/placeholder helpers and the precise
  placeholder markup/styling, consistent with existing `src/renderer/` conventions.
- Whether the origin-policy private-range check is a shared pure helper reused by Phase 15;
  prefer a pure, unit-testable function so Phase 15 can complete masking against the same seam.
- Whether to introduce the `sanitizeForWire('media-url', …)` dispatch seam now (default
  off, byte-identical) as a no-op hook for Phase 15 to fill, or defer it entirely to Phase 15.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/capture/index.js` — `URL_ATTRS = ['src','href','action','poster','data']` already
  absolutifies `poster` and `src`; `absolutifyUrl()` (line ~3008) and `absolutifySrcset()`
  (line ~3025) run across all three serialization paths (snapshot ~813, iframe ~1481,
  added-node ~3516) and the mutation attr path (~3845). `<video>`/`<audio>`/`<source>` are
  NOT in `DROP_TAGS` (sanitize.js line 57), so they already survive capture.
- `absolutifyUrl()` currently **passes `data:`/`blob:`/`javascript:` through untouched**
  (line 3009) — this is the ASST-04 gap to close for `blob:`/oversized-`data:`.
- `background-image` is captured via `collectComputedStyleText()` (CURATED_PROPS); browser
  `getComputedStyle` already returns url() as absolute, so background-image is likely
  already correct — verify in the differential/loopback tests.
- `src/renderer/snapshot.js` — `CSP_META` (line 57): `default-src 'none'; img-src http:
  https: data:; …`. No `media-src` (correct for Phase 12). The `style-src` widening is the
  precedent for the (Phase 13) `media-src` add.
- `src/renderer/index.js` — hard-asserts `sandbox="allow-same-origin"` with no
  `allow-scripts` (~209-213, throws `viewer-sandbox-invalid`); cross-realm
  `iframe.contentDocument` writes and `resolveIndexedNode` are where the viewer-side pin
  and placeholder rewrite hook in.
- `src/capture/index.js` `sanitizeForWire(kind, payload)` chokepoint (~2741) is the single
  capture-side seam (scheme scrub + masking); the `media-url` dispatch (Phase 15) plugs in
  here. `scrubSrcset`/`parseSrcsetCandidates` already parse srcset safely.
- Masking config vocabulary already exists (`blockSelector`, `maskTextSelector`,
  `maskInputs`, `maskTextFn`, `maskInputFn`) — the Phase 15 asset-masking options extend it.

### Established Patterns
- Fallible helpers return `{ok, …}`/discriminated unions; pure helpers return primitives.
- New protocol constants go in `src/protocol/constants.js` with a unit/derivation comment.
- Differential oracle (`tests/differential/`) is the equivalence gate: any extracted-only
  divergence vs the FSB reference MUST be declared in `divergence-ledger.js` (`DIVERGENCES`)
  as a scenario-pinned `mismatch` entry, else `oracle.test.js` hard-fails. Stale entries
  are also detected, so the entry must actually fire in a fixture scenario.
- Tests use Node built-in `node:test` + `node:assert/strict`; renderer tests use jsdom and
  srcdoc-string assertions; run with `npm test`.

### Integration Points
- Capture: clone-only `data-ps-currentsrc` enrichment + `blob:`/oversized-`data:`
  detection-to-placeholder, added in the three serialization paths via the existing
  URL_ATTRS/absolutify loops and the `sanitizeForWire` chokepoint.
- Renderer: `assetOriginPolicy`/`allowAssetOrigins`/`mediaMode` config on `createViewer`;
  a pre-write fetch gate + placeholder rewrite; currentSrc pin + srcset neutralization on
  snapshot render and diff apply.
- Protocol: a byte-cap constant in `constants.js`; no envelope/relay change.
- Tests: new asset fixture scenario + ledger entry; srcdoc CSP assertion test; pure-helper
  unit tests for the origin policy.

</code_context>

<specifics>
## Specific Ideas

- rrweb's `inlineImages:false` (transport URL, re-fetch) is the validated baseline this
  matches; animated GIF/WebP/APNG animate natively by reference — strictly better than
  rrweb's frozen inline.
- The origin-policy private-range denylist and `mediaMode` are the security *decisions*
  this phase locks; Phase 15 completes the masking vocabulary and threat-models them.
- Verify "no image bytes traverse the relay" explicitly (the low-bandwidth core value).

</specifics>

<deferred>
## Deferred Ideas

- Asset/media URL **masking** (`maskAssetUrls`/`maskAssetUrlFn`, `maskMediaSelector`) and
  `referrerpolicy="no-referrer"` completion + secrets-on-the-wire docs + the parent-realm
  threat model → Phase 15 (MSEC-03, MSEC-04), their mapped phase.
- The `media-src` CSP directive and `<video>`/`<audio>` playback + `STREAM.MEDIA` sync →
  Phase 13.
- Adaptive HLS/DASH manifest discovery and the parent-realm player → Phase 14.

</deferred>
