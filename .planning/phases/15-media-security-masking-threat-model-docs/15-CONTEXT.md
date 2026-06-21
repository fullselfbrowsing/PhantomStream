# Phase 15: Media Security, Masking, Threat Model & Docs - Context

**Gathered:** 2026-06-21
**Status:** Ready for planning

<domain>
## Phase Boundary

Close the v2.0 milestone by **completing** the security contract that was *threaded*
through Phases 12–14 — this phase completes, threat-models, tests, and documents
decisions made earlier; it does not begin new features. In scope (MSEC-03, MSEC-04):
the asset/media URL **masking vocabulary** (`maskMediaSelector`, `maskAssetUrls`,
`maskAssetUrlFn`) routed through the capture-side `sanitizeForWire` chokepoint;
`referrerpolicy="no-referrer"` + documented no-credentials-by-default for viewer-side
fetch; a **threat-review of the parent-realm object-URL blast radius** (the Phase 14 MSE
`blob:` binding); media-specific **security tests**; and the `docs/SECURITY.md` /
`docs/ARCHITECTURE.md` updates (limitation #6 — `<video>`/`<audio>` no longer fully out).

Out of scope: anything not completing an existing decision — no new media features, no
new origin-policy ranges (the Phase 12 denylist is already concrete in
`src/renderer/asset-policy.js`), no relay/envelope change. The evaluation harness + paper
are deferred to milestone v2.1.

</domain>

<decisions>
## Implementation Decisions

### Masking Vocabulary (MSEC-03)
- **Three new host masking options**, extending the Phase 3 family
  (`blockSelector`/`maskTextSelector`/`maskInputs`/`maskTextFn`/`maskInputFn`):
  - `maskMediaSelector` — a CSS selector; matched media/asset elements **omit their URL
    from the wire and degrade to the dimensioned placeholder** (reusing the
    `blockSelector` → placeholder path + the media-tracker skip predicates so a masked
    media element also emits **no** `STREAM.MEDIA` state).
  - `maskAssetUrls` — a boolean; when true, **strip token/PII query params** from all
    asset/media URLs before they go on the wire.
  - `maskAssetUrlFn(url, ctx) -> string | null` — a custom redactor; a returned string
    replaces the URL, `null` blocks → placeholder, and a **throw fails closed** (block).
  All validated at **factory time** via the existing `compileMaskSelector` pattern (the
  one allowed throw site).
- **Dispatch = a new `'media-url'` / `'asset-url'` kind in `sanitizeForWire`** (the clean,
  media-aware seam Phase 12 flagged at ~2741), so URL masking lives in one testable place
  rather than overloading the `'attr'` path. URL attributes flow through it across all
  three serialization paths (snapshot, iframe, added-node) + the mutation attr path.
- **Masking is OFF by default** — asset/media URLs stay **byte-identical** on the wire
  (preserves the differential oracle; no new ledger entry). When `maskAssetUrls` is on,
  strip a **documented token/PII param denylist** (`sig`, `signature`, `token`, `key`,
  `auth`, `x-amz-*`, `X-Goog-*`, `Expires`, `Policy`, `Signature`, etc. — name the list
  in code + SECURITY.md), NOT all query params (functional params survive). The custom
  `maskAssetUrlFn` gives hosts full control. Reuse the exported
  `isPrivateOrLocalHost`/`classifyAssetOrigin` classifier where a capture-side
  private-host masking decision is useful.

### referrerpolicy + Credentials (MSEC-04)
- **`referrerpolicy="no-referrer"` = a document-level `<meta name="referrer"
  content="no-referrer">`** injected into the srcdoc **immediately after the CSP meta**
  (`src/renderer/snapshot.js`) — one place covers every viewer-side fetch (`<img>`,
  `<video>`, `<source>`, `background-image`, poster), so no referrer (which can carry the
  mirrored page URL + tokens) leaks to third-party origins.
- **No credentials by default** — confirm + **document** the existing posture: the
  `allow-same-origin`-sandboxed srcdoc + no `crossorigin="use-credentials"` already yields
  omit-credentials viewer fetches. Assert it in a test; add **no** `crossorigin`
  attributes (forcing `anonymous` could break otherwise-fine assets).

### Threat Model + Docs (MSEC-04, criterion 3)
- **Parent-realm object-URL threat model = a structured subsection in `docs/SECURITY.md`**
  (asset / threat / mitigation) covering the Phase 14 MSE `blob:` binding: the object URL
  is **parent-origin**, created/owned in the parent realm; the child iframe **still cannot
  script** (sandbox is exactly `allow-same-origin`, no `allow-scripts`); `MediaSource` /
  `SourceBuffer` / segment fetches live in the parent; the object URL is **revoked on
  `destroy`/`destroyAll`**; worst case = the child plays the parent's object URL but cannot
  read or exfiltrate it (no scripts). Verify the **sandbox token is unchanged** and the
  `allow-scripts`-forbidden static scan (`tests/security-chokepoint-purity.test.js`)
  **covers the media code paths** (`src/renderer/media-player.js` + the adapters).
- **Docs scope:** update `docs/SECURITY.md` — §4 Masking Guarantees (add the media/asset
  masking vocabulary), §6 Viewer-side resource fetching (add `referrerpolicy="no-referrer"`
  + no-credentials, mark the Phase-15 masking as **completed**, not deferred), and the new
  object-URL threat subsection; update `docs/ARCHITECTURE.md` **limitation #6** to state
  `<video>`/`<audio>` are now mirrored by reference (state + progressive + adaptive), with
  the residual limits narrowed to DRM/EME, MSE-without-manifest, and raw media pixels.

### Media Security Tests (criterion 4)
- A media security test set: **hostile `<source src="javascript:...">`** neutralized at the
  capture scheme-scrub; **`media-src` CSP coverage** (`default-src 'none'` retained, NO
  `script-src`, `blob:` scoped to `media-src` only, no `connect-src`); **masked-media-emits-
  no-state** (a `maskMediaSelector`/`blockSelector`-matched `<video>` produces no
  `STREAM.MEDIA` frames — reusing the `skipElementWithAncestors`/`blockedWithAncestors`/
  `wireDroppedWithAncestors` predicates); **late-cross-session media-sync rejected by
  `isCurrentStream`**; plus the masking unit tests (selector→placeholder, `maskAssetUrls`
  param-strip, `maskAssetUrlFn` custom + `null`-block + **throw → fail-closed block**).
- **Differential oracle stays byte-identical** (masking off by default → no divergence, no
  new ledger entry); the masking tests run with masking **ON** in their own fixtures.

### Claude's Discretion
- The exact token/PII query-param denylist contents + the `maskAssetUrlFn` ctx shape
  (keep minimal, document the denylist in SECURITY.md).
- Whether the `'media-url'`/`'asset-url'` masking helper is a pure function (prefer pure +
  unit-testable) and its internal naming, consistent with `src/capture/` conventions.
- Precise SECURITY.md / ARCHITECTURE.md wording + section placement (must satisfy the
  `security-chokepoint-purity.test.js` doc-marker assertions — keep the existing required
  markers: `allow-same-origin`, `default-src 'none'`, `mediaMode`, `maskTextSelector`,
  `Host must-nevers`, etc., and add the new ones).
- Whether a `maskMediaSelector`-matched element reuses the exact Phase-12
  `data-ps-asset-unavailable` placeholder reason or a new `masked` reason value.

</decisions>

<code_context>
## Existing Code Insights (from the Phase 15 scout)

### Reusable Assets
- **Masking config family** — `src/capture/index.js` ~480-510 (typedef) + ~559-574 (init);
  `compileMaskSelector` ~2179-2190 is the factory-time validation (the one allowed throw).
  Predicate shapes `blockedWithAncestors`/`maskMatches` ~2203-2245. New options follow this
  pattern exactly.
- **`sanitizeForWire` chokepoint** — `src/capture/index.js` ~2990-3242; kinds today:
  `element`/`subtree`/`attr`/`text`/`input`/`css`. NO `'media-url'`/`'asset-url'` kind yet
  (Phase 12 flagged it ~2741) — Phase 15 adds it. `URL_ATTRS` loop ~3038-3044 + srcset
  ~3058-3066 are where media/asset URLs are reachable.
- **Asset-origin denylist (already concrete)** — `src/renderer/asset-policy.js`
  `classifyAssetOrigin` + **exported `isPrivateOrLocalHost`** (~72) enumerate https-only +
  localhost/0.0.0.0\/8/127\/8/10\/8/172.16\/12/192.168\/16/169.254\/16/::1/fc00::\/7/
  fe80::\/10/NAT64/IPv4-mapped/.local/unqualified. Phase 15 REUSES this; it does not add
  ranges. Host override: `allowAssetOrigins` + `assetOriginPolicy` (renderer config).
- **referrerpolicy insertion point** — `src/renderer/snapshot.js` ~551-557 (`CSP_META`) +
  ~673 (head assembly). Add `<meta name="referrer" content="no-referrer">` right after the
  CSP meta. No `referrerpolicy`/`crossorigin` set today (omit-credentials already).
- **allow-scripts static scan** — `tests/security-chokepoint-purity.test.js` ~100-120
  scans `src/renderer/*.js` (incl. `media-player.js` + adapters) for `allow-scripts`
  outside comments. Phase 15 confirms media-path coverage.
- **Media-tracker skip predicates** — `src/capture/index.js` `collectTrackedMediaElements`
  ~4649-4666 + `attachMediaListeners` ~4738-4782 already gate emission on
  `skipElementWithAncestors`/`blockedWithAncestors`/`wireDroppedWithAncestors` (Phase 14
  WR-01). `maskMediaSelector` plugs into the same predicate set → masked media emits no
  `STREAM.MEDIA` for free; Phase 15 adds the test.
- **Docs** — `docs/SECURITY.md` §1-7 (threat table, defense-in-depth, sanitization,
  masking guarantees, host must-nevers, viewer-side fetch, residual risks) with marker
  assertions the purity test enforces; `docs/ARCHITECTURE.md` §6 limitation #6 ~269-273.

### Established Patterns
- Masking validation throws at factory time only; runtime mask fns fail closed
  (`safeMaskText`/`safeMaskInput` ~2280-2318) — `maskAssetUrlFn` mirrors this.
- Off-by-default masking preserves the differential oracle (byte-identical wire) — same as
  Phase 12's `data-ps-currentsrc` discipline.
- Tests: `node --test ...`; renderer jsdom + srcdoc-string assertions; capture purity +
  differential oracle gates; `docs/*.md` marker assertions in the purity test.

### Integration Points
- **Capture:** 3 masking options + the `'media-url'`/`'asset-url'` `sanitizeForWire`
  dispatch + the token-param denylist helper; `maskMediaSelector` into the media-tracker
  skip predicates.
- **Renderer:** the `<meta name="referrer" content="no-referrer">` add (one line in
  snapshot.js); no credentials change.
- **Tests:** the media security test set + the masking unit tests + the doc-marker
  additions.
- **Docs:** `docs/SECURITY.md` (§4/§6 + object-URL threat subsection), `docs/ARCHITECTURE.md`
  (limitation #6). No envelope/relay/protocol change.

</code_context>

<specifics>
## Specific Ideas

- This phase **completes and documents** decisions already made (Phases 12–14); the origin
  denylist and the media-tracker skip predicates already exist — Phase 15 wires masking
  into them, adds referrerpolicy, threat-models the object URL, tests, and documents.
- Verify the milestone's security invariants end-to-end one last time: sandbox token
  unchanged, `default-src 'none'`/no `script-src`, no media/segment bytes on the relay,
  masked media emits no state, hostile schemes neutralized.
- The threat model must state the worst case for the parent-realm object URL plainly: the
  child plays it but cannot script/read/exfiltrate it (no `allow-scripts`).

</specifics>

<deferred>
## Deferred Ideas

- Evaluation corpus/harness (EVAL-01..06) + the system-track paper (PAPR-01,02) → milestone
  v2.1 (provisional Phases 16–17).
- Any new origin-policy ranges or a new viewer-fetch capability — out of scope; this phase
  only completes/documents the shipped model.
- Real-browser security UAT (live CSP enforcement, real referrer suppression observed) →
  documented UAT, deferred (same hidden-tab/jsdom limit as Phases 13–14).

</deferred>
