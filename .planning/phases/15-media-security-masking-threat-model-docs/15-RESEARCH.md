# Phase 15: Media Security, Masking, Threat Model & Docs - Research

**Researched:** 2026-06-21
**Domain:** Capture-side privacy masking, viewer-fetch leakage hardening, cross-realm object-URL threat modeling, security documentation
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Masking Vocabulary (MSEC-03)**
- Three new host masking options extend the Phase 3 family (`blockSelector`/`maskTextSelector`/`maskInputs`/`maskTextFn`/`maskInputFn`):
  - `maskMediaSelector` — a CSS selector; matched media/asset elements **omit their URL from the wire and degrade to the dimensioned placeholder** (reusing the `blockSelector` → placeholder path + the media-tracker skip predicates so a masked media element also emits **no** `STREAM.MEDIA` state).
  - `maskAssetUrls` — a boolean; when true, **strip token/PII query params** from all asset/media URLs before they go on the wire.
  - `maskAssetUrlFn(url, ctx) -> string | null` — a custom redactor; returned string replaces the URL, `null` blocks → placeholder, and a **throw fails closed** (block).
  - All validated at **factory time** via the existing `compileMaskSelector` pattern (the one allowed throw site).
- **Dispatch = a new `'media-url'` / `'asset-url'` kind in `sanitizeForWire`** (the seam Phase 12 flagged at ~2741), so URL masking lives in one testable place rather than overloading the `'attr'` path. URL attributes flow through it across all three serialization paths (snapshot, iframe, added-node) + the mutation attr path.
- **Masking is OFF by default** — asset/media URLs stay **byte-identical** on the wire (preserves the differential oracle; no new ledger entry). When `maskAssetUrls` is on, strip a **documented token/PII param denylist** (name the list in code + SECURITY.md), NOT all query params (functional params survive). The custom `maskAssetUrlFn` gives hosts full control. Reuse the exported `isPrivateOrLocalHost`/`classifyAssetOrigin` classifier where a capture-side private-host masking decision is useful.

**referrerpolicy + Credentials (MSEC-04)**
- **`referrerpolicy="no-referrer"` = a document-level `<meta name="referrer" content="no-referrer">`** injected into the srcdoc **immediately after the CSP meta** (`src/renderer/snapshot.js`) — one place covers every viewer-side fetch (`<img>`, `<video>`, `<source>`, `background-image`, poster), so no referrer (which can carry the mirrored page URL + tokens) leaks to third-party origins.
- **No credentials by default** — confirm + **document** the existing posture: the `allow-same-origin`-sandboxed srcdoc + no `crossorigin="use-credentials"` already yields omit-credentials viewer fetches. Assert it in a test; add **no** `crossorigin` attributes (forcing `anonymous` could break otherwise-fine assets).

**Threat Model + Docs (MSEC-04, criterion 3)**
- **Parent-realm object-URL threat model = a structured subsection in `docs/SECURITY.md`** (asset / threat / mitigation) covering the Phase 14 MSE `blob:` binding: the object URL is **parent-origin**, created/owned in the parent realm; the child iframe **still cannot script** (sandbox is exactly `allow-same-origin`, no `allow-scripts`); `MediaSource` / `SourceBuffer` / segment fetches live in the parent; the object URL is **revoked on `destroy`/`destroyAll`**; worst case = the child plays the parent's object URL but cannot read or exfiltrate it (no scripts). Verify the **sandbox token is unchanged** and the `allow-scripts`-forbidden static scan (`tests/security-chokepoint-purity.test.js`) **covers the media code paths** (`src/renderer/media-player.js`).
- **Docs scope:** update `docs/SECURITY.md` — §4 Masking Guarantees, §6 Viewer-side resource fetching (add `referrerpolicy="no-referrer"` + no-credentials, mark the Phase-15 masking as **completed**, not deferred), and the new object-URL threat subsection; update `docs/ARCHITECTURE.md` **limitation #6** to state `<video>`/`<audio>` are now mirrored by reference (state + progressive + adaptive), residual limits narrowed to DRM/EME, MSE-without-manifest, and raw media pixels.

**Media Security Tests (criterion 4)**
- A media security test set: hostile `<source src="javascript:...">` neutralized at the capture scheme-scrub; `media-src` CSP coverage; masked-media-emits-no-state; late-cross-session media-sync rejected by `isCurrentStream`; plus masking unit tests (selector→placeholder, `maskAssetUrls` param-strip, `maskAssetUrlFn` custom + `null`-block + **throw → fail-closed block**).
- **Differential oracle stays byte-identical** (masking off by default → no divergence, no new ledger entry); the masking tests run with masking **ON** in their own fixtures.

### Claude's Discretion
- The exact token/PII query-param denylist contents + the `maskAssetUrlFn` ctx shape (keep minimal, document the denylist in SECURITY.md).
- Whether the `'media-url'`/`'asset-url'` masking helper is a pure function (prefer pure + unit-testable) and its internal naming, consistent with `src/capture/` conventions.
- Precise SECURITY.md / ARCHITECTURE.md wording + section placement (must satisfy the `security-chokepoint-purity.test.js` doc-marker assertions — keep the existing required markers, and add the new ones).
- Whether a `maskMediaSelector`-matched element reuses the exact Phase-12 `data-ps-asset-unavailable` placeholder reason or a new `masked` reason value.

### Deferred Ideas (OUT OF SCOPE)
- Evaluation corpus/harness (EVAL-01..06) + the system-track paper (PAPR-01,02) → milestone v2.1 (provisional Phases 16–17).
- Any new origin-policy ranges or a new viewer-fetch capability — out of scope; this phase only completes/documents the shipped model.
- Real-browser security UAT (live CSP enforcement, real referrer suppression observed) → documented UAT, deferred (same hidden-tab/jsdom limit as Phases 13–14).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| MSEC-03 | Asset/media URL masking — the host masking vocabulary redacts/blocks asset+media URLs (signed CDN URLs carry tokens/PII) and `maskMediaSelector`/`blockSelector` omit private media URLs from the wire; masked media degrades to placeholder | New `'asset-url'`/`'media-url'` `sanitizeForWire` dispatch (§ Architecture Patterns Pattern 1–3); token/PII denylist (§ Don't Hand-Roll + Pattern 2); `maskMediaSelector` reuses the already-shipped media-tracker skip predicates at `src/capture/index.js:4658,4749` so masked media emits no `STREAM.MEDIA` for free (verified — § Code Examples). Off-by-default preserves the differential oracle. |
| MSEC-04 | Viewer-side fetch minimizes leakage (`referrerpolicy="no-referrer"`, no credentials by default); secrets-on-the-wire implications documented; the sandbox token is unchanged (the `allow-scripts`-forbidden static scan covers media code paths) | One-line `<meta name="referrer" content="no-referrer">` after `CSP_META` in `buildSnapshotHtml` (`src/renderer/snapshot.js:673`, verified insertion point — § Pattern 4); no-credentials posture already holds via `allow-same-origin` + no `crossorigin` (confirm-and-document, assert in test); parent-realm object-URL threat model (§ "Parent-Realm Object-URL Threat Model"); the `allow-scripts` scan already globs `src/renderer/*.js` which includes `media-player.js` (verified — § Validation Architecture). |
</phase_requirements>

## Summary

Phase 15 is a **completion + hardening + documentation** phase, not a feature phase. Every capability it touches is already 80–95% built; the work is to (1) add a small, off-by-default capture-side URL-masking vocabulary through the *existing* `sanitizeForWire` chokepoint, (2) add a single document-level `<meta name="referrer" content="no-referrer">` line in the renderer's srcdoc assembly, (3) write a structured object-URL threat model into `docs/SECURITY.md`, and (4) add media-security tests that mostly *pin already-shipped behavior* (the masked-media-emits-no-state guarantee, for example, is already enforced for `skipElement`/`blockSelector` by the Phase-14 media-tracker skip predicates — Phase 15 plugs `maskMediaSelector` into the same predicate set and adds the test).

The architecture is fully mapped and verified against source. The masking config family lives at `src/capture/index.js:559-574` (factory init) with `compileMaskSelector` (the one allowed throw site) at `:2179`, the fail-closed runtime mask fns `safeMaskText`/`safeMaskInput` at `:2287/:2306`, and the `sanitizeForWire` dispatch at `:2990` (kinds today: `element`/`subtree`/`attr`/`text`/`input`/`css` — **no** `'asset-url'`/`'media-url'` kind yet). The renderer's CSP and credential posture are already shipped: `CSP_META` (`src/renderer/snapshot.js:551`) carries `default-src 'none'; media-src http: https: data: blob:` with **no** `script-src`/`connect-src`, the sandbox is exactly `allow-same-origin`, and the asset-origin denylist (`src/renderer/asset-policy.js`, with exported `isPrivateOrLocalHost`) is concrete and table-tested. The Phase-15 **STATE.md blocker** ("the conservative default origin policy needs a concrete denylist + host-override surface") is **already resolved in code** — verified below; Phase 15 reuses it, does not re-derive it.

**Primary recommendation:** Add the masking vocabulary as a pure `'asset-url'`/`'media-url'` `sanitizeForWire` dispatch that wraps a single pure helper (`maskAssetUrlForWire(url, ctx)`); wire `maskMediaSelector` into the existing media-tracker skip-predicate chokepoints (`collectTrackedMediaElements` + `attachMediaListeners`) and the snapshot/subtree element placeholder path; add the `<meta name="referrer">` line; extend (do not recreate) the existing `renderer-media-csp.test.js` CSP assertions and `capture-media.test.js` skip-predicate tests; and update the three doc sections while **preserving all 12 existing purity-test doc markers** and adding new ones. **Zero new runtime dependencies** (no URL library — locked).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Asset/media URL masking (token strip, custom redactor, selector block) | Capture (`src/capture/index.js`) | — | Masking is **capture-side only** by contract (SECURITY.md §4: "Masked content is transformed before transport and never appears on the wire in raw form"). The wire must already be clean; the renderer never un-masks. |
| `maskMediaSelector` → no `STREAM.MEDIA` state | Capture (media-tracker) | — | The media tracker (`attachMediaListeners`, `collectTrackedMediaElements`) is the only place that *emits* media state; gating emission there is the only correct place to suppress it. |
| `referrerpolicy="no-referrer"` on viewer fetches | Renderer (srcdoc assembly, `snapshot.js`) | — | A document-level `<meta name="referrer">` in the srcdoc is the single control covering every parser-initiated and CSS-initiated fetch the *viewer's browser* issues. The capture side never fetches. |
| No-credentials viewer fetch | Renderer (sandbox + absence of `crossorigin`) | — | Already holds: `allow-same-origin` srcdoc with no `crossorigin="use-credentials"` issues no-credential cross-origin GETs. Phase 15 documents + asserts; it does not change behavior. |
| Asset-origin fetch denylist (SSRF gate) | Renderer (`asset-policy.js`) | Capture (optional reuse of exported `isPrivateOrLocalHost`) | Already shipped in Phase 12. The *fetch* happens in the viewer's browser, so the authoritative gate is renderer-side; capture may reuse the exported classifier for a capture-side private-host masking decision. |
| Object-URL blast-radius threat model | Documentation (`docs/SECURITY.md`) | — | The MSE object URL is a parent-realm renderer construct (Phase 14); the threat model documents an existing design, asserts the sandbox token is unchanged, and pins the `allow-scripts` scan over `media-player.js`. |
| Sandbox-token / `allow-scripts` invariant over media code | Renderer + Test (`security-chokepoint-purity.test.js`) | — | The static scan already globs `src/renderer/*.js` (includes `media-player.js`); Phase 15 verifies coverage and adds the docs marker. |

## Standard Stack

### Core

This phase adds **no libraries**. It uses only platform APIs already load-bearing in the codebase plus the existing internal modules.

| Library / API | Version | Purpose | Why Standard |
|---------------|---------|---------|--------------|
| WHATWG `URL` (platform) | built-in (Node v24.x / browser) | Parse + reassemble asset URLs to strip query params in the masking helper | Already the only platform dependency in `absolutifyUrl` (`src/capture/index.js`) and `classifyAssetOrigin` (`src/renderer/asset-policy.js`); zero-dep, present in every target runtime. `URLSearchParams` (a property of `URL`) is the correct param editor. `[VERIFIED: codebase grep + MDN]` |
| `node:test` + `node:assert/strict` | built-in (Node 18+) | Test runner for all new media-security + masking tests | The repo's sole test framework (`package.json` `scripts.test`); 665 tests currently green. `[VERIFIED: package.json + test run]` |
| `jsdom` | `^29.1.1` (devDependency, already present) | DOM environment for capture-side masking tests + renderer srcdoc-string assertions | Already the test DOM for `security-mask.test.js`, `capture-media.test.js`, `renderer-media*.test.js`. No new install. `[VERIFIED: package.json]` |

### Supporting

| Internal module | Path | Purpose | When to Use |
|-----------------|------|---------|-------------|
| `compileMaskSelector` | `src/capture/index.js:2179` | Factory-time selector validation (throws `invalid-mask-selector`) | Validate `maskMediaSelector` at factory time — the *one allowed throw site*. |
| `blockMatches` / `blockedWithAncestors` | `src/capture/index.js:2221 / :2238` | Per-element + ancestor-inclusive block predicates | Reuse for `maskMediaSelector` matching (or add `maskMediaMatches`/`maskMediaWithAncestors` twins). |
| `replaceWithBlockPlaceholder` / `createBlockPlaceholder` | `src/capture/index.js:2473 / :2458` | Swap a clone element for a dimension-only placeholder, transfer nid | The masked-media → placeholder path (reuse exactly, per the `blockSelector` precedent). |
| `safeMaskText` / `safeMaskInput` | `src/capture/index.js:2287 / :2306` | Fail-closed runtime mask-fn wrapper (throw → default mask) | The exact pattern `maskAssetUrlFn` must mirror (throw → block, not raise). |
| `isPrivateOrLocalHost` / `classifyAssetOrigin` | `src/renderer/asset-policy.js:72 / :154` | Exported pure fail-closed origin classifier | Optional capture-side reuse for a private-host masking decision (the module was *built exported for Phase-15 reuse* — see its header comment). |
| `hasDangerousScheme` | `src/capture/index.js:183` | `javascript:`/`vbscript:`/`data:text/html` scheme detector | Already neutralizes hostile `<source src=javascript:>` via the `URL_ATTRS` loop in `sanitizeForWire('element')` — the hostile-source test pins existing behavior. |
| `isCurrentStream` | `src/protocol/messages.js:338` | Stream-identity staleness guard | The late-cross-session media reject (already enforced by the renderer media handler) is tested against this. |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Pure `maskAssetUrlForWire` helper + `URLSearchParams` | A query-string regex strip | Rejected: regex param editing mishandles encoding, repeated keys, and fragments; `URLSearchParams` is correct and zero-dep. Keep the regex only as a fail-soft fallback if `new URL()` throws (return the URL unchanged or, fail-closed, block — see Pitfall 3). |
| New `'asset-url'`/`'media-url'` dispatch kind | Overload the existing `'attr'` path | Rejected by locked decision — masking in the `'attr'` branch would scatter URL logic and break the "one testable place" contract Phase 12 flagged. |
| `isPrivateOrLocalHost` reuse (capture-side) | A second capture-side denylist | Rejected — the classifier was deliberately exported for reuse; duplicating ranges risks drift. Use it only *if* a capture-side private-host masking decision is actually needed (it may not be — `maskAssetUrls`/`maskMediaSelector` cover the locked requirements without it). |

**Installation:** None. `dependencies` stays `{ "ws": "8.21.0" }`; `peerDependencies` stays `{ "hls.js": ">=1.5.0" }`. Verified via `package.json` and a clean 665/665 test run.

## Package Legitimacy Audit

> Phase 15 installs **no external packages**. The masking vocabulary is pure JS over the platform `URL`/`URLSearchParams`; the tests reuse the already-present `jsdom` devDependency.

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| (none added) | — | — | — | — | — | N/A — no install step |

**Packages removed due to slopcheck [SLOP] verdict:** none (no packages evaluated).
**Packages flagged as suspicious [SUS]:** none.

*No package-legitimacy gate is required because this phase adds zero dependencies. The planner should include a guard task asserting `dependencies` / `peerDependencies` are byte-unchanged (the Phase-14 `package-publish.test.js` deps-shape guard already enforces this; extend its expectation set only if a key is intentionally touched — it should not be).*

## Architecture Patterns

### System Architecture Diagram

```text
                          CAPTURE  (src/capture/index.js)  —  masking is capture-side only
  ┌──────────────────────────────────────────────────────────────────────────────────────┐
  │  live DOM element (with src/poster/srcset/background-image, possibly a signed CDN URL) │
  │        │                                                                               │
  │        ▼  (serialize → detached clone; live page never mutated)                        │
  │  ┌─────────────────────────────────────────────────────────────────────────────────┐  │
  │  │  sanitizeForWire(kind, payload)            [:2990]                                │  │
  │  │   ├─ 'element'  → on*/srcdoc strip, URL_ATTRS scheme-scrub [:3038],               │  │
  │  │   │                 srcset scrub [:3059], CSS scrub, mask-text pass               │  │
  │  │   │                 NEW: after scheme-scrub, route each URL attr value through →──┼──┐
  │  │   ├─ 'attr'     → scheme-scrub; NEW: asset-url mask before returning value  ──────┼──┤
  │  │   ├─ 'subtree'  → per-descendant 'element'; blockMatches → placeholder            │  │ │
  │  │   │                 NEW: maskMediaMatches(liveDesc) → placeholder                 │  │ │
  │  │   └─ NEW 'asset-url'/'media-url'  → maskAssetUrlForWire(url, ctx)  ◄──────────────┼──┘ │
  │  │            (PURE helper):                                                         │  │  │
  │  │              1. maskAssetUrlFn(url, ctx)  → string replaces | null blocks |       │  │  │
  │  │                 throw FAILS CLOSED (block)         [mirror safeMaskText :2287]    │  │  │
  │  │              2. else if maskAssetUrls → strip TOKEN/PII denylist params           │  │  │
  │  │                 (URLSearchParams, case-insensitive key match)                     │  │  │
  │  │              3. else → return url UNCHANGED  (off-by-default → byte-identical)     │  │  │
  │  └─────────────────────────────────────────────────────────────────────────────────┘  │  │
  │        │ masked/stripped/blocked URL (or unchanged)                                     │  │
  │        ▼                                                                                │  │
  │  ┌─────────────────────────────────────────────────────────────────────────────────┐  │  │
  │  │  MEDIA TRACKER  collectTrackedMediaElements [:4648] / attachMediaListeners [:4749]│  │  │
  │  │   skip if  skipElementWithAncestors || blockedWithAncestors                       │  │  │
  │  │            || wireDroppedWithAncestors                                            │  │  │
  │  │   NEW: ALSO skip if maskMediaWithAncestors(el)  → masked <video>/<audio>          │  │  │
  │  │        emits NO STREAM.MEDIA baseline + NO STREAM.MEDIA events                    │  │  │
  │  └─────────────────────────────────────────────────────────────────────────────────┘  │  │
  └──────────────────────────────────────────────────────────────────────────────────────┘  │
        │ wire: URL strings + small playback state (already masked)  — relay carries no bytes │
        ▼                                                                                     │
                          RENDERER (src/renderer/) — the viewer's browser FETCHES             │
  ┌──────────────────────────────────────────────────────────────────────────────────────┐  │
  │  buildSnapshotHtml(payload)  [snapshot.js:651]                                         │  │
  │   <head>  CSP_META [:551]  ─┐                                                          │  │
  │          default-src 'none'; img-src http: https: data:;                              │  │
  │          media-src http: https: data: blob:;  (NO script-src, NO connect-src)         │  │
  │     NEW  <meta name="referrer" content="no-referrer">  ◄── IMMEDIATELY after CSP_META  │  │
  │          (one place covers <img>/<video>/<source>/poster/background-image fetches)     │  │
  │   ...                                                                                  │  │
  │   gateSnapshotAssets(html, gate)  → fail-closed origin denylist (classifyAssetOrigin) │  │
  │          blocked origin → data-ps-asset-unavailable placeholder PRE-PARSE             │  │
  │   srcdoc → iframe  sandbox="allow-same-origin"  (NEVER allow-scripts)                  │  │
  │          no crossorigin attr anywhere → cross-origin GETs omit credentials            │  │
  └──────────────────────────────────────────────────────────────────────────────────────┘  │
                                                                                              │
   PARENT REALM (renderer-owned, OUTSIDE the sandbox): MediaSource/hls.js for adaptive  ◄─────┘
   playback. URL.createObjectURL(ms) is PARENT-ORIGIN blob:; bound to the inert in-iframe
   <video>.src; revoked on destroy/destroyAll. See "Parent-Realm Object-URL Threat Model".
```

### Recommended Project Structure

No new files required. Edits land in existing modules; new tests are new files following the existing naming convention.

```text
src/capture/index.js          # + 3 config options, + maskMediaMatches/maskMediaWithAncestors
                              #   predicates, + 'asset-url'/'media-url' sanitizeForWire dispatch,
                              #   + pure maskAssetUrlForWire helper + TOKEN_PARAM_DENYLIST,
                              #   + media-tracker skip-predicate wiring
src/renderer/snapshot.js      # + 1 line: <meta name="referrer" content="no-referrer"> after CSP_META
docs/SECURITY.md              # §4 masking vocabulary, §6 referrerpolicy/no-credentials,
                              #   + Parent-Realm Object-URL Threat Model subsection
docs/ARCHITECTURE.md          # limitation #6 rewrite
tests/security-asset-url-mask.test.js   # NEW: maskAssetUrls/maskAssetUrlFn/denylist units (capture, jsdom)
tests/capture-media.test.js             # EXTEND: maskMediaSelector → no STREAM.MEDIA (twin of WR-01 skipElement test)
tests/renderer-media-csp.test.js        # EXTEND: assert <meta name="referrer" content="no-referrer">
tests/renderer-snapshot.test.js         # EXTEND (or above): referrer meta ordering after CSP
tests/security-chokepoint-purity.test.js# EXTEND: new doc markers; (allow-scripts media scan already covers media-player.js)
```

### Pattern 1: New `'asset-url'`/`'media-url'` `sanitizeForWire` dispatch wrapping a pure helper

**What:** Add a dispatch kind that takes a URL string + context and returns a masked/stripped/blocked/unchanged URL. The kind is a thin wrapper around a **pure, top-level (or closure) helper** so it is unit-testable in isolation.

**When to use:** Every place a URL attribute value (`src`, `poster`, `data`, `srcset` candidates) is about to be written to a clone or returned as an `'attr'` op value — *after* `absolutifyUrl` and *after* the `hasDangerousScheme` scrub.

**Dispatch shape (consistent with the existing discriminated-result convention at `:2990`):**

```javascript
// Source: pattern derived from sanitizeForWire kinds at src/capture/index.js:2990-3242
// NEW kind. Returns the SAME { value } discriminated shape as the 'attr' kind so
// callers stay uniform. null → caller emits a placeholder / drops the URL.
if (kind === 'asset-url' || kind === 'media-url') {
  // ctx carries { attr, tag, nid, element } so maskAssetUrlFn can make decisions.
  var masked = maskAssetUrlForWire(payload.value, payload.ctx);
  if (masked !== payload.value) {
    sanitizeCounters.maskedAssetUrls = (sanitizeCounters.maskedAssetUrls || 0) + 1;
  }
  return { value: masked };   // masked === null signals "block → placeholder"
}
```

**Note on kind unification:** `'asset-url'` and `'media-url'` can be a single branch (the *behavior* is identical — strip/redact/block a URL). Keep BOTH string literals reachable so the planner can satisfy the purity test's per-dispatch `sanitizeForWire('<kind>'` marker assertions if it chooses to require them (currently the test pins `element/subtree/attr/text/css` — see Pitfall 5). `ctx.kind` (`'image'`|`'media'`) is the better place to carry the media-vs-asset distinction than two dispatch strings.

**Anti-pattern avoided:** Do **not** make the helper mutate the clone or read the DOM — keep it pure (`url, ctx → string|null`). The caller owns the clone mutation / placeholder swap.

### Pattern 2: The token/PII param strip (the `maskAssetUrls` path)

**What:** When `maskAssetUrls` is true and no `maskAssetUrlFn` is provided, parse the URL with `new URL()`, drop every query param whose name (case-insensitively) matches the **token/PII denylist**, and reassemble. Functional params survive.

**When to use:** Inside `maskAssetUrlForWire`, step 2 (after the custom-fn check, before the unchanged fallthrough).

```javascript
// Source: pure helper; URLSearchParams is the correct param editor (MDN).
// Off-by-default: when maskAssetUrls is false AND no maskAssetUrlFn, this whole
// helper returns url UNCHANGED → wire byte-identical → differential oracle intact.
function maskAssetUrlForWire(url, ctx) {
  if (!url || typeof url !== 'string') return url;
  // 1. custom redactor first — full host control, FAIL CLOSED on throw (mirror safeMaskText :2287)
  if (maskAssetUrlFn) {
    try {
      var out = maskAssetUrlFn(url, ctx || {});
      if (out === null) return null;            // explicit block → placeholder
      return String(out);                       // redacted replacement
    } catch (err) {
      logger.error('[DOM Stream] maskAssetUrlFn failed; URL blocked (fail-closed)', err);
      return null;                              // THROW → block (NOT raise, NOT pass raw)
    }
  }
  // 2. boolean token/PII strip
  if (maskAssetUrls) {
    return stripTokenParams(url);               // see below
  }
  // 3. default OFF → unchanged (byte-identical wire)
  return url;
}

function stripTokenParams(url) {
  var u;
  try { u = new URL(url); }
  catch (e) { return url; }                     // non-absolute/opaque (data:/blob:): leave as-is
  if (!u.search) return url;                     // no query → unchanged (preserve byte-identity)
  var changed = false;
  // URLSearchParams preserves order & repeats; iterate a snapshot of keys.
  var keys = [];
  u.searchParams.forEach(function (_v, k) { keys.push(k); });
  for (var i = 0; i < keys.length; i++) {
    if (isTokenParamName(keys[i])) { u.searchParams.delete(keys[i]); changed = true; }
  }
  return changed ? u.toString() : url;          // unchanged string identity when nothing stripped
}
```

**The denylist** (see § Don't Hand-Roll for the full table) is matched **case-insensitively** and **exact-name** (with a documented `x-amz-`/`x-goog-` prefix family). Document the exact list in `docs/SECURITY.md` §4.

**Critical byte-identity rule:** when nothing is stripped, return the **original string** (`url`), not `u.toString()` — `new URL().toString()` can normalize (lowercase host, add a trailing `/`, re-encode), which would diverge the wire even with masking off-for-this-URL. This matters because `maskAssetUrls` is a global boolean; a URL that *happens* to have no token params must still round-trip byte-identically.

### Pattern 3: `maskMediaSelector` → placeholder + no `STREAM.MEDIA` (reuse the shipped predicates)

**What:** `maskMediaSelector` is a selector that (a) degrades the matched element to the dimension-only placeholder on the wire (the `blockSelector` path) AND (b) suppresses all `STREAM.MEDIA` state for that element. (b) is **already implemented** for `blockSelector` — the media tracker skips any element matching `blockedWithAncestors`. Phase 15 adds a parallel `maskMediaWithAncestors` predicate and ORs it into the same two chokepoints.

**When to use:** `maskMediaSelector` is the privacy control for "this `<video>`/`<audio>` is sensitive — mirror nothing about it, not its URL and not its playback timeline."

```javascript
// Source: VERIFIED at src/capture/index.js:4658 and :4749 — the skip set already
// gates media emission. Phase 15 adds maskMediaWithAncestors to BOTH sites.

// collectTrackedMediaElements (:4658) — controls the snapshot media[] baseline:
if (skipElementWithAncestors(nodes[i])
  || blockedWithAncestors(nodes[i])
  || wireDroppedWithAncestors(nodes[i])
  || maskMediaWithAncestors(nodes[i])) {        // NEW
  continue;
}

// attachMediaListeners (:4749) — controls STREAM.MEDIA event/heartbeat emission:
if (skipElementWithAncestors(el) || blockedWithAncestors(el)
  || wireDroppedWithAncestors(el)
  || maskMediaWithAncestors(el)) return;        // NEW
```

**Design choice (Claude's discretion, recommended):** Have `maskMediaSelector` reuse the `blockSelector` element-placeholder path verbatim (so a masked `<video>` becomes the same dimension-only `<div>` placeholder), and give it a **distinct placeholder reason** only if the viewer needs to *show* "masked" differently from "blocked-origin"/"asset-unavailable". The CONTEXT leaves this open; the simplest correct choice is: masked media → the existing block placeholder (no reason attr, identity-only) since "blocked" and "masked" are visually identical (a neutral dimensioned gap). If a distinguishable reason is wanted, add `data-ps-asset-unavailable="masked"` via the `createAssetUnavailablePlaceholder` path (`:2497`). **Recommend: reuse the plain block placeholder** — fewer moving parts, and the masked element legitimately carries *no* identity-leaking attribute.

### Pattern 4: Document-level `<meta name="referrer" content="no-referrer">`

**What:** A single `<meta name="referrer" content="no-referrer">` in the srcdoc `<head>`, immediately after `CSP_META`. The document referrer policy applies to **every** subresource fetch the viewer's browser issues from that document — `<img>`, `<video>`/`<source>`, `<video poster>`, CSS `background-image`/`url()`, fonts — so it is strictly broader and simpler than per-element `referrerpolicy` attributes.

**When to use:** This is the MSEC-04 referrer control. One line, one place.

```javascript
// Source: insertion point VERIFIED at src/renderer/snapshot.js:673 (buildSnapshotHtml).
// CSP meta is FIRST after <head>; the referrer meta goes IMMEDIATELY after it so
// the policy is parsed before any subresource fetch (parsers begin fetching <img>
// during parse — same timing rationale as gateSnapshotAssets / CSP-first).
return '<!DOCTYPE html><html' + htmlAttrs + '><head>' + CSP_META
  + '<meta name="referrer" content="no-referrer">'                  // NEW (MSEC-04)
  + '<meta charset="UTF-8">'
  + '<meta name="viewport" content="width=' + (parseInt(p.viewportWidth, 10) || 1920) + '">'
  + ...
```

**Why document-level beats per-element:** per-element `referrerpolicy` would have to be threaded onto every `<img>`/`<source>`/`<video>` at capture or render time (and `background-image` can't carry one at all). The `<meta>` is the one control that covers CSS-initiated fetches too. `[CITED: MDN Referrer-Policy / <meta name="referrer">]`

**Why no `crossorigin` change (no-credentials confirmation):** A cross-origin subresource GET from a sandboxed `allow-same-origin` srcdoc, with **no** `crossorigin` attribute, is a no-CORS request that does **not** send credentials to a third-party origin by default for the asset types in scope; adding `crossorigin="anonymous"` would force a CORS request that can *break* otherwise-fine assets served without `Access-Control-Allow-Origin`. The locked decision is therefore: **add no `crossorigin` attributes**; document the omit-credentials posture and assert the absence of `crossorigin` in a test. `[CITED: MDN crossorigin / CORS settings attributes]` `[ASSUMED — see Assumptions A2]` for the precise no-referrer + no-credentials *runtime* effect, which jsdom cannot exercise (string-level assertion only; live behavior is the documented deferred UAT).

### Anti-Patterns to Avoid

- **`u.toString()` on an unchanged URL:** normalizes the URL (host case, trailing slash, percent-encoding) and silently diverges the wire even when masking strips nothing. Return the original string when no param was deleted (Pattern 2).
- **Masking in the `'attr'` branch:** scatters URL logic; violates the "one testable place" contract. Use the dedicated dispatch (locked decision).
- **`maskAssetUrlFn` throw → raise (or pass raw):** would either wedge the capture or leak the raw signed URL. It must mirror `safeMaskText`: throw → **block** (fail closed). (Note this is *stricter* than `safeMaskText`, which falls back to the default asterisk mask; for a URL the safe fallback is to block, not to pass a mangled URL.)
- **Per-element `referrerpolicy` attributes:** miss CSS-initiated fetches and add capture-side complexity. Use the document `<meta>`.
- **Adding `crossorigin` to force anonymous:** breaks non-CORS assets; the omit-credentials posture already holds without it.
- **Re-deriving the origin denylist:** it is concrete and exported in `asset-policy.js`; reuse, never re-author (the STATE.md blocker is already resolved — see below).
- **Touching the relay/envelope/protocol:** out of scope; no `STREAM.*` type, no constant, no envelope change. Masking is entirely within `sanitizeForWire` + the media tracker; the referrer meta is entirely within `buildSnapshotHtml`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Query-param editing for the token strip | A regex `?...&...` splitter | `new URL()` + `URLSearchParams.delete()` | Regex mishandles encoding, repeated keys, fragments, and `;`-delimited legacy params; `URLSearchParams` is correct, zero-dep, and already in every target runtime. |
| Private/internal host detection (if needed capture-side) | A new range table | exported `isPrivateOrLocalHost` (`asset-policy.js:72`) | Already enumerates RFC1918/loopback/link-local/ULA/NAT64/IPv4-mapped + `.local`/unqualified, table-tested, and *built exported for Phase-15 reuse*. Duplicating risks drift. |
| Hostile-scheme neutralization for `<source src=javascript:>` | A new media-specific scrub | existing `hasDangerousScheme` + `URL_ATTRS` loop in `sanitizeForWire('element')` (`:3038`) | `<source>` carries `src`, which is in `URL_ATTRS`; the scheme scrub already fires. Phase 15 only adds the *test* pinning this. |
| Suppressing `STREAM.MEDIA` for masked media | A new emission-gate | the shipped media-tracker skip predicates (`:4658`, `:4749`) | Already gate on `skipElement`/`block`/`wire-dropped`; ORing in `maskMediaWithAncestors` is a one-line reuse, not a new mechanism. |
| Fail-closed runtime mask containment | A new try/catch shape | mirror `safeMaskText`/`safeMaskInput` (`:2287`/`:2306`) | The established pattern; consistency keeps the security review surface uniform. |
| CSP/referrer enforcement assertion in jsdom | A fake browser fetch harness | string assertions on `buildSnapshotHtml` output (as `renderer-media-csp.test.js` does) + documented deferred real-browser UAT | jsdom never parses srcdoc, enforces CSP, or honors referrer policy; the repo's established discipline is string-layer pins + Playwright UAT deferral. |

**Key insight:** Almost every "build" in this phase is actually a "reuse + test + document." The single genuinely new artifact is the pure `maskAssetUrlForWire` helper (+ its denylist); everything else plugs into a seam that already exists and is already green.

### Token/PII Query-Param Denylist (concrete — Claude's discretion, documented here for the planner)

Strip these param **names** (case-insensitive, exact match unless marked *prefix*). Document this exact table in `docs/SECURITY.md` §4. **This list strips only credential/signature/expiry params; functional params (`w`, `h`, `q`, `format`, `v`, `id`, `t` as a timestamp seek, etc.) survive.**

| Source | Param names |
|--------|-------------|
| **AWS S3 / CloudFront presigned (SigV4)** | `X-Amz-Signature`, `X-Amz-Credential`, `X-Amz-Security-Token`, `X-Amz-Algorithm`, `X-Amz-Date`, `X-Amz-Expires`, `X-Amz-SignedHeaders`, plus the `x-amz-` *prefix* family |
| **AWS S3 / CloudFront presigned (SigV2 / canned policy)** | `AWSAccessKeyId`, `Signature`, `Expires`, `Policy`, `Key-Pair-Id` |
| **Google Cloud Storage signed URL** | `X-Goog-Signature`, `X-Goog-Credential`, `X-Goog-Algorithm`, `X-Goog-Date`, `X-Goog-Expires`, `X-Goog-SignedHeaders`, `GoogleAccessId`, plus the `x-goog-` *prefix* family |
| **Azure Blob SAS** | `sig`, `se` (expiry), `sp` (permissions), `sv` (version), `sr`, `st`, `skoid`, `sktid`, `skt`, `ske`, `sks`, `skv`, `spr`, `sip`, `ss`, `srt` |
| **Generic token/secret/auth** | `token`, `access_token`, `auth`, `authorization`, `apikey`, `api_key`, `key`, `signature`, `sign`, `hash`, `hmac`, `jwt`, `password`, `passwd`, `pwd`, `secret`, `session`, `sessionid`, `sid`, `expires`, `expiry`, `policy` |

Notes for the planner:
- Match **case-insensitively** (`X-Amz-Signature` and `x-amz-signature` both strip).
- The `x-amz-` / `x-goog-` **prefix** rules subsume the explicit AWS/GCP rows but keep both for documentation clarity; implement as "exact-set membership OR starts-with a denied prefix."
- `Expires`/`expires`/`se`/`X-Amz-Expires`/`X-Goog-Expires` are stripped because an expiry timestamp is a privacy/replay signal tied to a signed URL; a plain content `?t=42` seek timestamp is **not** in the list (different name).
- This is **opt-in** (`maskAssetUrls`). Off-by-default → byte-identical wire → no oracle change. `[ASSUMED — see Assumptions A1: the exact membership is a reasoned default, not an authoritative spec; the param *names* themselves are CITED from each provider's signing scheme.]`

## Common Pitfalls

### Pitfall 1: URL normalization breaks byte-identity when masking strips nothing
**What goes wrong:** Using `new URL(url).toString()` as the return value even when no param was deleted reorders/normalizes the URL (host lowercased, default port dropped, trailing `/` added, characters re-percent-encoded), diverging the wire from the raw reference and tripping the differential oracle — even though the user asked for "strip token params," not "rewrite every URL."
**Why it happens:** `maskAssetUrls` is a global boolean applied to *all* asset URLs; most have no token params, so most pass through the strip path but must remain byte-identical.
**How to avoid:** Return the **original `url` string** whenever `searchParams.delete` removed nothing (Pattern 2). Only emit `u.toString()` when a param was actually stripped.
**Warning signs:** Differential-oracle tests fail with masking *off*; or a masking-on test sees a URL change that has no token params.

### Pitfall 2: `data:`/`blob:` URLs thrown into `new URL()` masking
**What goes wrong:** `data:`/`blob:` (and other opaque) URLs either don't have a meaningful query string or are already degraded to placeholders upstream (ASST-04). Running the strip on them is wasteful and `new URL('blob:...').search` semantics are surprising.
**Why it happens:** The masking helper sees every URL attr value.
**How to avoid:** `new URL()` wrapped in try/catch returns the value unchanged on throw; additionally short-circuit `data:`/`blob:` early (they're already handled by `classifyAssetRef`/`absolutifyUrl`). The helper is defense-in-depth, not the degrade path.
**Warning signs:** A `data:` URI appears truncated or re-encoded on the wire.

### Pitfall 3: `maskAssetUrlFn` containment direction (block, not asterisk-fallback)
**What goes wrong:** Copying `safeMaskText`'s "throw → default asterisk mask" literally would, for a URL, produce a mangled/asterisked string that the viewer then tries to *fetch* — worse than blocking.
**Why it happens:** The fail-closed pattern is borrowed from text masking, where the safe fallback is the default mask.
**How to avoid:** For a URL, fail-closed means **block → placeholder** (return `null`), because a redactor's whole job is to decide a URL is unsafe; a thrown redactor is an undecided-unsafe URL, which must not be fetched. Document this distinction.
**Warning signs:** A throwing `maskAssetUrlFn` still results in a fetch attempt or a visibly corrupted URL on the wire.

### Pitfall 4: Referrer meta placed after a subresource-bearing tag
**What goes wrong:** Putting `<meta name="referrer">` after the stylesheet `<link>`s or after `payload.html` (which contains `<img>`) means the parser may have already begun fetches under the default referrer policy.
**Why it happens:** Misreading the head-assembly order.
**How to avoid:** Place it **immediately after `CSP_META`**, before charset/viewport/stylesheets/inline-styles/body (Pattern 4). Same "policy-first" rationale as CSP-first and the pre-parse `gateSnapshotAssets`.
**Warning signs:** The referrer-ordering test (assert the `name="referrer"` meta index < the first `<link rel="stylesheet">` / `<img` index) fails.

### Pitfall 5: Breaking the purity-test doc markers or dispatch markers
**What goes wrong:** Editing `docs/SECURITY.md` and accidentally removing or rewording one of the 12 pinned markers (e.g. dropping the literal `mediaMode` or `Host must-nevers` or `frame-ancestors`), failing `security-chokepoint-purity.test.js`.
**Why it happens:** The markers are substring assertions on the *current* doc text; restructuring sections can drop a literal.
**How to avoid:** Treat the existing marker list (below) as immutable substrings — keep every one verbatim somewhere in the doc, and *add* the new markers. Run the purity test after every doc edit.
**Warning signs:** `docs/SECURITY.md must contain marker: <X>` assertion failure.

### Pitfall 6: Assuming the `allow-scripts` scan must be *added* for media-player.js
**What goes wrong:** Spending plan budget "adding media-path coverage" to the static scan when the scan already globs `src/renderer/*.js` (which includes `media-player.js`).
**Why it happens:** The CONTEXT says "confirm the static scan covers the media code paths" — which is a *verification + docs* task, not a code change.
**How to avoid:** **Verified:** `rendererModules()` reads every `*.js` in `src/renderer/`; `media-player.js` is there. The scan already asserts zero `allow-scripts` in it. Phase 15 only needs the *threat-model docs marker* + a comment noting media-path coverage. (The capture-side `src/adapters/*.js` are NOT in this scan's scope, but they are not renderer sandbox code and need no `allow-scripts` assertion — they run in Node/CDP, not the iframe.)
**Warning signs:** A plan task proposes editing the glob or adding a media-specific scan loop (unnecessary).

## Code Examples

Verified patterns from the actual source (not training data).

### Media-tracker skip predicates already gate emission (the `maskMediaSelector` plug-in point)
```javascript
// Source: src/capture/index.js:4648-4666 (collectTrackedMediaElements) — VERIFIED
function collectTrackedMediaElements() {
  var out = [];
  if (!document || typeof document.querySelectorAll !== 'function') return out;
  var nodes = document.querySelectorAll('video, audio');
  for (var i = 0; i < nodes.length; i++) {
    if (skipElementWithAncestors(nodes[i])
      || blockedWithAncestors(nodes[i])
      || wireDroppedWithAncestors(nodes[i])) {   // ← Phase 15 ORs maskMediaWithAncestors here
      continue;
    }
    out.push(nodes[i]);
  }
  return out;
}
// Source: src/capture/index.js:4749 (attachMediaListeners) — VERIFIED
if (skipElementWithAncestors(el) || blockedWithAncestors(el) || wireDroppedWithAncestors(el)) return;
// ← Phase 15 ORs maskMediaWithAncestors here too
```

### Fail-closed runtime mask wrapper to mirror (the `maskAssetUrlFn` template)
```javascript
// Source: src/capture/index.js:2287-2297 (safeMaskText) — VERIFIED
function safeMaskText(text, el) {
  if (maskTextFn) {
    try {
      return String(maskTextFn(String(text), el));
    } catch (err) {
      logger.error('[DOM Stream] maskTextFn failed; default mask applied', err);
      return defaultMaskText(text);   // text fallback = default mask; URL fallback = BLOCK (Pitfall 3)
    }
  }
  return defaultMaskText(text);
}
```

### Factory-time selector validation (the one allowed throw site — for `maskMediaSelector`)
```javascript
// Source: src/capture/index.js:2179-2190 (compileMaskSelector) — VERIFIED
function compileMaskSelector(raw) {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'string' || raw === '') {
    throw new Error('invalid-mask-selector');
  }
  try { document.querySelector(raw); }
  catch (err) { throw new Error('invalid-mask-selector'); }
  return raw;
}
// Phase 15: var maskMediaSelector = compileMaskSelector(cfg.maskMediaSelector);  (next to :573-574)
```

### Existing CSP assertions to EXTEND (not recreate)
```javascript
// Source: tests/renderer-media-csp.test.js:52-64 — VERIFIED (already green)
const srcdoc = snap.buildSnapshotHtml({ html: '<p>x</p>' });
assert.ok(srcdoc.indexOf("default-src 'none'") !== -1, "default-src 'none' must be retained");
assert.ok(srcdoc.indexOf('script-src') === -1, 'no script-src directive may be introduced');
assert.ok(srcdoc.indexOf('connect-src') === -1, 'no connect-src directive may be introduced (Pitfall 5)');
// Phase 15 ADDS to this file (or renderer-snapshot.test.js):
//   assert.ok(/<meta name="referrer" content="no-referrer">/.test(srcdoc), 'no-referrer meta present');
//   assert.ok(srcdoc.indexOf('<meta name="referrer"') < srcdoc.indexOf('<link rel="stylesheet"'),
//             'referrer meta precedes the first subresource link');  // ordering pin (Pitfall 4)
//   assert.ok(srcdoc.indexOf('crossorigin') === -1, 'no crossorigin attribute (omit-credentials posture)');
```

### Existing masked-media-emits-no-state harness to mirror (twin of the WR-01 skipElement test)
```javascript
// Source: tests/capture-media.test.js:518 (WR-01 skipElement) — VERIFIED shape
// Phase 15 ADDS the maskMediaSelector twin:
//   createCapture({ transport, maskMediaSelector: '#secret-clip' });  // or blockSelector
//   ... settle ...
//   assert.equal(mediaMsgs(transport).length, 0,
//     'a maskMediaSelector-matched <video> emits NO STREAM.MEDIA frames');
const mediaMsgs = (transport) => transport.sent.filter((m) => m.type === STREAM.MEDIA);
```

### Existing late-cross-session reject test (already present — Phase 15 may keep/cite, not add)
```javascript
// Source: tests/renderer-media.test.js:411-421 — VERIFIED (already green)
test('handleMedia rejects a payload with mismatched stream identity (no driver call)', async () => {
  // ... payload with streamSessionId:'STALE', snapshotId:999 against active {s1,1} ...
  assert.equal(rec.plays, 0, 'a stale-identity media payload never drives the element');
});
// isCurrentStream itself: src/protocol/messages.js:338 — VERIFIED.
// Phase 15: this requirement is ALREADY covered; the plan should CITE this test, not duplicate it,
// unless it wants an explicit "media-sync" named case for the security suite traceability.
```

## State of the Art

| Old (pre-Phase-15) | Current (Phase 15 target) | When | Impact |
|--------------------|---------------------------|------|--------|
| Asset/media URLs always byte-identical on the wire (no masking) | Opt-in capture-side URL masking (`maskMediaSelector`/`maskAssetUrls`/`maskAssetUrlFn`); off-by-default keeps byte-identity | Phase 15 | Hosts can redact signed-CDN tokens / block private media without breaking the differential oracle. |
| Viewer subresource fetches send the default referrer | `<meta name="referrer" content="no-referrer">` suppresses referrer on every viewer fetch | Phase 15 | The mirrored page URL (which can itself carry tokens) never leaks to third-party CDNs in the `Referer` header. |
| Object-URL blast radius undocumented | Structured STRIDE/asset-threat-mitigation subsection in SECURITY.md | Phase 15 | The parent-realm MSE `blob:` binding's safety is explicit and the sandbox-token invariant is pinned. |
| `<video>`/`<audio>` listed as residual non-captured pixels (limitation #6) | Mirrored by reference (state + progressive + adaptive); residual narrowed to DRM/EME, MSE-without-manifest, raw pixels | Phase 15 | ARCHITECTURE.md reflects the v2.0 reality. |

**Deprecated/outdated:** SECURITY.md line 214 currently forward-references "`referrerpolicy` completion are Phase 15 (MSEC-03/MSEC-04)" — Phase 15 must update this to past-tense/completed and mark the §6 masking deferral as done.

## Runtime State Inventory

> Phase 15 is **pure code + docs + tests**. No rename/refactor/migration, no stored data, no live-service reconfiguration. This section is included only to discharge each category explicitly.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — no datastore stores any masking config or media URL as a key/ID. Masking is computed per-frame at capture; nothing persists. | None |
| Live service config | None — no external service (n8n, Datadog, etc.) holds any Phase-15 string. The relay carries only ephemeral wire messages. | None |
| OS-registered state | None — no OS task/daemon references masking or referrer config. | None |
| Secrets/env vars | None — masking adds no secret key or env var. The token/PII denylist is a code constant, not a secret. | None |
| Build artifacts / installed packages | `dependencies` and `peerDependencies` are byte-unchanged (`{ws:8.21.0}` / `{hls.js:>=1.5.0}`). No egg-info/compiled artifact. The `.d.ts` generated via `tsc` will regenerate from new JSDoc on the next type build (the new config options should carry JSDoc so the emitted types include them). | Regenerate `.d.ts` if the build step runs (no action needed for the library itself — no runtime build). |

**Nothing found in any category** — verified: no datastore, no live service, no OS registration, no secret, no stale artifact references Phase-15 work.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The exact membership of the token/PII denylist (which generic names to include beyond the provider-documented signing params) is a reasoned default. The provider param *names* (AWS SigV4/SigV2, GCP, Azure SAS) are CITED from each signing scheme; the generic set (`token`, `apikey`, `secret`, …) is a sensible-default judgment. | Don't Hand-Roll → Denylist | Low. Off-by-default → no oracle impact. A missing name means a token survives only when a host opts into `maskAssetUrls` AND uses that param name AND doesn't use `maskAssetUrlFn`. User can confirm/extend the list during discuss/plan; it's documented in SECURITY.md so it's auditable. |
| A2 | A no-`crossorigin`, sandboxed `allow-same-origin` srcdoc with `<meta name="referrer" content="no-referrer">` yields no-credential, no-referrer cross-origin subresource fetches *at runtime*. | Pattern 4 / referrerpolicy | Medium. jsdom cannot verify runtime fetch behavior — this is the documented deferred real-browser UAT (consistent with Phases 13–14). The string-level assertions (meta present, ordering, no `crossorigin`) are what Phase 15 *can* pin; the live behavior claim is standard browser semantics but unverified in-session. Mark in SECURITY.md as the contract + flag the live-CSP/referrer UAT as deferred. |
| A3 | `maskMediaSelector` reusing the plain `blockSelector` placeholder (no distinct `masked` reason) is acceptable to the user. | Pattern 3 | Low. CONTEXT explicitly leaves this to Claude's discretion ("reuse the exact Phase-12 placeholder reason OR a new `masked` reason"). Either is correct; the plan can pick. Recommended: plain block placeholder (identity-only, no reason attr). |

**These three assumptions are the only items needing confirmation. Everything else is verified against source or cited.** Discuss-phase already settled the four grey areas; A1–A3 are within the explicitly-granted discretion, so the planner may proceed and the user can adjust the denylist/placeholder-reason at review without rework.

## Open Questions

1. **Should `'asset-url'` and `'media-url'` be two literal dispatch strings or one branch keyed by `ctx.kind`?**
   - What we know: behavior is identical (strip/redact/block a URL); the CONTEXT names both kinds.
   - What's unclear: whether the purity test should be extended to *require* both literals (it currently pins `element/subtree/attr/text/css`).
   - Recommendation: implement **one branch** matching both literals (`kind === 'asset-url' || kind === 'media-url'`) and carry the asset-vs-media distinction in `ctx.kind`. Keep both literals reachable so the planner *can* add per-literal purity markers if it wants traceability, but do not require it.

2. **Does any capture-side flow actually need `isPrivateOrLocalHost` reuse, or do `maskAssetUrls`/`maskMediaSelector` fully cover MSEC-03?**
   - What we know: the classifier is exported and available; the locked requirements (token strip, custom redactor, selector block) don't obviously require a capture-side private-host check.
   - What's unclear: whether the user wants `maskAssetUrls` to *also* auto-block private-host asset URLs at capture (defense-in-depth before the renderer's own gate).
   - Recommendation: keep MSEC-03 to the three documented controls; treat capture-side `isPrivateOrLocalHost` reuse as **optional/deferred** (the renderer gate is the authoritative SSRF control and already blocks private hosts). If the user wants belt-and-suspenders, it's a one-line addition to `stripTokenParams` — note it as a possible enhancement, not a requirement.

## Environment Availability

> Phase 15 is pure code/docs/tests with no external runtime dependencies beyond the already-present toolchain.

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Test runner + library runtime | ✓ | v24.x (≥18 required for `node:test`) | — |
| `jsdom` | Capture/renderer DOM tests | ✓ | `^29.1.1` (devDependency) | — |
| WHATWG `URL` / `URLSearchParams` | Token-param strip helper | ✓ | platform built-in | — |
| Playwright | Deferred real-browser UAT (CSP/referrer/credentials live) | ✓ (`^1.60.0`) | — | UAT documented + deferred (jsdom limit, per Phases 13–14 precedent) |

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:** Live CSP/referrer/no-credential enforcement is not observable in jsdom → string-layer assertions now, real-browser UAT documented and deferred (consistent with the established UAT-deferral precedent).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | `node:test` + `node:assert/strict` (Node v24.x built-in) |
| Config file | none — invoked via `package.json` `scripts.test` |
| Quick run command | `node --test tests/security-asset-url-mask.test.js tests/capture-media.test.js tests/renderer-media-csp.test.js` |
| Full suite command | `npm test` (= `node --test tests/*.test.js tests/differential/*.test.js`) |
| Current baseline | **665 pass / 0 fail** (verified 2026-06-21) — Phase 15 must keep this green and *grow* it. |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| MSEC-03 | `maskAssetUrls` strips token/PII params; functional params + no-token URLs survive byte-identical | unit (jsdom capture) | `node --test tests/security-asset-url-mask.test.js` | ❌ Wave 0 (new file) |
| MSEC-03 | `maskAssetUrlFn` returns string → replaces; returns `null` → placeholder/block; **throws → fail-closed block** | unit (jsdom capture) | `node --test tests/security-asset-url-mask.test.js` | ❌ Wave 0 |
| MSEC-03 | Invalid `maskMediaSelector` throws `invalid-mask-selector` at factory time | unit (jsdom capture) | `node --test tests/security-asset-url-mask.test.js` | ❌ Wave 0 |
| MSEC-03 | `maskMediaSelector`/`blockSelector`-matched `<video>` degrades to placeholder **and emits NO `STREAM.MEDIA`** (baseline + events) | unit (jsdom capture) | `node --test tests/capture-media.test.js` | ✅ extend (twin of WR-01 skipElement test at :518) |
| MSEC-03 | Masking **off by default** → wire byte-identical (differential oracle unchanged, no new ledger entry) | oracle | `node --test tests/differential/oracle.test.js` | ✅ (must stay 48/48; assert no new D-entry) |
| MSEC-03 | Hostile `<source src="javascript:...">` neutralized at capture scheme-scrub | unit (jsdom capture) | `node --test tests/security-asset-url-mask.test.js` (or `capture-defenses.test.js`) | ✅ behavior shipped; ❌ explicit media test Wave 0 |
| MSEC-04 | srcdoc carries `<meta name="referrer" content="no-referrer">`, ordered immediately after `CSP_META` (before subresource links) | unit (renderer string) | `node --test tests/renderer-media-csp.test.js` | ✅ extend |
| MSEC-04 | No `crossorigin` attribute anywhere in srcdoc (omit-credentials posture) | unit (renderer string) | `node --test tests/renderer-media-csp.test.js` | ✅ extend |
| MSEC-04 | `media-src ... blob:` retained; **no** `script-src`, **no** `connect-src`, `default-src 'none'` retained, `img-src` no-blob | unit (renderer string) | `node --test tests/renderer-media-csp.test.js` | ✅ already present (cite/keep) |
| MSEC-04 | Late cross-session `STREAM.MEDIA` rejected by `isCurrentStream` (no driver call) | unit (renderer) | `node --test tests/renderer-media.test.js` | ✅ already present at :411 (cite; add named "media-sync security" case only if traceability wants it) |
| MSEC-04 | `allow-scripts` absent from every `src/renderer/*.js` **including `media-player.js`** | static scan | `node --test tests/security-chokepoint-purity.test.js` | ✅ already covers media-player.js (verified) — add docs marker only |
| MSEC-04 | `docs/SECURITY.md` carries all existing 12 markers **plus** new object-URL/referrer markers | static scan | `node --test tests/security-chokepoint-purity.test.js` | ✅ extend marker list |

### Sampling Rate
- **Per task commit:** `node --test tests/security-asset-url-mask.test.js tests/capture-media.test.js tests/renderer-media-csp.test.js tests/security-chokepoint-purity.test.js` (the four files Phase 15 touches/adds) — sub-second, runs on every task.
- **Per wave merge:** `node --test tests/*.test.js tests/differential/*.test.js` (full suite incl. the differential oracle) — confirms byte-identity (oracle 48/48) and no regression (≥665 + new tests).
- **Phase gate:** Full suite green before `/gsd:verify-work`; specifically assert oracle count unchanged (masking off-by-default) and `dependencies`/`peerDependencies` byte-unchanged (`package-publish.test.js`).

### Wave 0 Gaps
- [ ] `tests/security-asset-url-mask.test.js` — NEW file: `maskAssetUrls` denylist strip (each provider family + generic), no-token URL byte-identity, `data:`/`blob:` passthrough, `maskAssetUrlFn` string/`null`/**throw→block**, factory-time `invalid-mask-selector` throw, hostile `<source src=javascript:>` neutralization. Use the `security-mask.test.js` / `capture-media.test.js` jsdom + recording-transport + settle harness (AUDITED_GLOBALS recipe).
- [ ] `tests/capture-media.test.js` — EXTEND: `maskMediaSelector` (and `blockSelector`) → 0 `STREAM.MEDIA` (mirror the WR-01 `skipElement` test at :489/:518, swapping the predicate). Also assert no `media[]` baseline entry for the masked element.
- [ ] `tests/renderer-media-csp.test.js` — EXTEND: `no-referrer` meta present + ordered before first subresource link + no `crossorigin` attr. (CSP shape assertions already exist — keep.)
- [ ] `tests/security-chokepoint-purity.test.js` — EXTEND: add the new doc markers (below) to `requiredMarkers`; optionally a comment pinning media-path `allow-scripts` coverage. **Do not** change the `rendererModules()` glob — it already includes `media-player.js`.
- [ ] Framework install: none — `node:test` + `jsdom` already present.

*Wave 0 is small: one new test file + three extensions. The masked-media-no-state, late-cross-session-reject, and hostile-source behaviors are largely already shipped, so several "new" tests are pins on existing behavior rather than RED-then-green feature tests.*

## Security Domain

> `security_enforcement` is the entire point of this phase. The full ASVS + STRIDE treatment below feeds both the implementation and the `docs/SECURITY.md` threat subsection.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control (this phase) |
|---------------|---------|-------------------------------|
| V2 Authentication | no | No auth surface in capture/render; the relay's hashKey room auth is out of scope. |
| V3 Session Management | partial | Stream-identity staleness (`isCurrentStream`) rejects late cross-session media frames — a session-scoping control already shipped; Phase 15 pins it. |
| V4 Access Control | yes | Fail-closed asset-origin denylist (`classifyAssetOrigin`) governs which origins the viewer may fetch (SSRF/access control) — shipped, reused. `maskMediaSelector` is host-controlled content access scoping. |
| V5 Input Validation / Sanitization | yes | The mirrored page is attacker input; `sanitizeForWire` (incl. the new `'asset-url'` dispatch) + scheme scrub + CSP + sandbox. Masking validates selectors at factory time (fail-closed-and-loud). |
| V6 Cryptography | no | No crypto introduced. Signed-URL tokens are *stripped*, never verified/minted — PhantomStream is not a signing party. |
| V7 Error Handling / Logging | yes | Fail-closed runtime mask containment (`maskAssetUrlFn` throw → block + log); strip counters are non-silent (SECURITY.md §3). |
| V12 File / Resource | yes | Viewer-side resource fetch is the core new surface (referrer suppression, no-credentials, origin gate). The object-URL threat model addresses the `blob:` resource. |
| V14 Configuration | yes | CSP (`default-src 'none'`, no `script-src`/`connect-src`, scoped `media-src blob:`), sandbox token (`allow-same-origin` only) — pinned by the purity test + CSP test. |

### Known Threat Patterns for {PhantomStream capture → wire → viewer-fetch}

| Pattern | STRIDE | Standard Mitigation (verified shipped, or Phase-15 add) |
|---------|--------|---------------------------------------------------------|
| Signed-CDN URL leaks token/PII onto the wire | Information Disclosure | `maskAssetUrls` token-param strip + `maskAssetUrlFn` (Phase 15, opt-in); off-by-default keeps byte-identity. |
| Sensitive `<video>`/`<audio>` URL + playback timeline mirrored | Information Disclosure | `maskMediaSelector` → placeholder + no `STREAM.MEDIA` via the shipped media-tracker skip predicates (Phase 15 wiring). |
| `Referer` header carries the mirrored page URL (itself token-bearing) to third-party CDNs | Information Disclosure | `<meta name="referrer" content="no-referrer">` document-level (Phase 15). |
| Credentialed cross-origin viewer fetch (cookies/auth to a CDN) | Information Disclosure / Elevation | No `crossorigin` attr + `allow-same-origin` sandbox → omit-credentials (shipped; Phase 15 documents + asserts). |
| Viewer-side SSRF / internal-host probe / tracking beacon via asset URL | Information Disclosure / DoS | Fail-closed `classifyAssetOrigin` https-only + private-range denylist (shipped Phase 12; reused) → blocked-origin placeholder pre-parse. |
| Hostile `<source src="javascript:...">` executes in the mirror | Tampering / Elevation | `hasDangerousScheme` scrub in `sanitizeForWire('element')` URL_ATTRS loop (shipped) + `default-src 'none'`/no `script-src` + no `allow-scripts` (Phase 15 adds the test). |
| Parent-realm MSE `blob:` object URL read/exfiltrated by mirrored content | Information Disclosure / Elevation | See the dedicated threat model below — child has no `allow-scripts`, cannot read the blob; `media-src blob:` scopes it; revoked on destroy. |
| A future serialization writer skips the new `'asset-url'` masking | Tampering (bypass) | The `sanitizeForWire` chokepoint discipline + the purity-test call-site floor; the masking lives in the one chokepoint, not scattered. |
| Sandbox weakened to `allow-scripts` on media code | Elevation of Privilege | `createViewer` reads back the token (`viewer-sandbox-invalid`); the static scan forbids `allow-scripts` in all `src/renderer/*.js` incl. `media-player.js` (verified). |
| Security docs rot away from shipped controls | Repudiation | `docs/SECURITY.md` marker guard in the purity test (Phase 15 extends the marker set). |

### Parent-Realm Object-URL Threat Model (the SECURITY.md subsection — asset / threat / mitigation)

This is the highest-value deliverable. Write it into `docs/SECURITY.md` as a structured subsection. The substance, verified against the Phase-14 design (CONTEXT + STATE decisions + `media-player.js` in the `allow-scripts` scan):

**Asset under consideration:** the `blob:` object URL minted in the **parent (renderer-owning) realm** by `URL.createObjectURL(mediaSource)` for adaptive playback (hls.js / MSE). It is assigned to the **inert in-iframe** `<video>.src`; hls.js runs in the parent and `attachMedia`s the iframe element; the **parent** fetches all media segments and appends to the `SourceBuffer`.

| # | Threat | STRIDE | Why it is mitigated |
|---|--------|--------|---------------------|
| 1 | Mirrored (attacker-influenced) content in the iframe scripts the page to read the object URL's bytes and exfiltrate them | Information Disclosure | The iframe sandbox is **exactly `allow-same-origin`, never `allow-scripts`** — no script runs inside the mirror at all. A `blob:` URL is only readable by `fetch`/`XHR`/`FileReader`, all of which require script. With no script, the child can *play* the element but cannot *read* the blob. (`createViewer` reads back the token and throws `viewer-sandbox-invalid` on any deviation; the static scan forbids `allow-scripts` in `media-player.js`.) |
| 2 | The object URL is parent-origin; can the child reach parent-origin `blob:` resources it shouldn't? | Information Disclosure / Elevation | The object URL's origin is the **parent document's origin**, not the mirrored page's. The child has no script to dereference it, and CSP `media-src blob:` permits only *media loading* of `blob:` — not `fetch`/`connect` (there is **no `connect-src`**). The blob is usable solely as a media source by the inert element. |
| 3 | A leaked/long-lived object URL persists after the player is gone (UAF / leak / cross-session bleed) | Information Disclosure / DoS | The object URL is **revoked on `destroy`/`destroyAll`** (`URL.revokeObjectURL`), and `destroyAll()` runs before any new-identity snapshot document swap (verified Phase-14 decision: "mediaPlayer.destroyAll() on a new-identity snapshot tears down every parent-realm player before the document swap — no orphaned players / object-URL leak"). A revoked `blob:` URL is dead; a subsequent session cannot resolve it. |
| 4 | `blob:` widens the CSP enough to load arbitrary local resources | Tampering | `blob:` is scoped to **`media-src` only** (not `img-src`, not `default-src`), and `default-src 'none'` plus the absence of `script-src`/`connect-src` means `blob:` cannot be used for script, XHR, or any non-media fetch. The CSP test pins `blob:` inside `media-src` and its absence from `img-src`. |
| 5 | The parent realm itself is the privileged attacker target (segment fetches, MSE in parent) | Elevation of Privilege | The parent realm is **renderer/host code**, not mirrored content — it was never sandboxed and is trusted by construction (the host embeds the viewer). The threat boundary is *mirrored content → host*, and that boundary is the sandbox; moving the player to the parent is precisely what *avoids* granting the sandbox `allow-scripts`. |

**Plain-language worst case (state this verbatim-style in the docs):** *The child iframe plays the parent's media object URL but cannot script, read, copy, or exfiltrate it — there is no `allow-scripts`, no `connect-src`, and the `blob:` is dead the moment the player is destroyed. The only thing the mirror can do with the object URL is what a `<video>` does with a source it was handed: render frames. An attacker who fully controls the mirrored page gains the ability to display media the host already chose to mirror, and nothing more.*

**Verification tasks the docs subsection must be backed by (already green or Phase-15-added):**
- Sandbox token unchanged → `createViewer` `viewer-sandbox-invalid` test + purity scan (shipped).
- `allow-scripts` absent from `media-player.js` → `security-chokepoint-purity.test.js` renderer glob (verified covers it).
- `blob:` scoped to `media-src`, no `script-src`/`connect-src` → `renderer-media-csp.test.js` (shipped).
- Object-URL revocation on destroy/destroyAll → covered by the Phase-14 media-player tests (cite; add an explicit revoke assertion only if not already pinned).

## Sources

### Primary (HIGH confidence — verified against this codebase this session)
- `src/capture/index.js` — masking config init (`:559-574`), `compileMaskSelector` (`:2179`), block predicates (`:2221`/`:2238`), `safeMaskText`/`safeMaskInput` (`:2287`/`:2306`), `sanitizeForWire` dispatch + kinds (`:2990-3242`), `URL_ATTRS` (`:63`), `hasDangerousScheme` (`:183`), placeholder helpers (`:2458`/`:2473`/`:2497`), media tracker skip predicates (`:4648-4666`, `:4738-4749`), mutation attr asset path (`:4215-4252`).
- `src/renderer/asset-policy.js` — `isPrivateOrLocalHost` (`:72`, exported, "built for Phase-15 reuse"), `classifyAssetOrigin` (`:154`); concrete https-only + private-range denylist (resolves the STATE.md Phase-15 blocker).
- `src/renderer/snapshot.js` — `CSP_META` (`:551`, `media-src ... blob:`, no `script-src`/`connect-src`), `buildSnapshotHtml` head assembly + CSP-first ordering (`:651-680`, referrer-meta insertion point at `:673`).
- `src/protocol/messages.js` — `isCurrentStream` (`:338`).
- `tests/security-chokepoint-purity.test.js` — the 12 required `docs/SECURITY.md` markers (`:223-239`), renderer `allow-scripts` glob over `src/renderer/*.js` incl. `media-player.js` (`:42-46`, `:110-120`), `sanitizeForWire` dispatch markers (`:76-81`).
- `tests/renderer-media-csp.test.js` — shipped CSP assertions to EXTEND (`:38-64`).
- `tests/capture-media.test.js` — WR-01 `skipElement`-no-STREAM.MEDIA harness to mirror (`:486-535`).
- `tests/renderer-media.test.js` — shipped late-cross-session reject test (`:411`).
- `tests/security-mask.test.js` — capture-side masking jsdom harness pattern (`:1-70`).
- `docs/SECURITY.md` (§1–§7) + `docs/ARCHITECTURE.md` (§6 limitation #6) — the docs to extend; line 214 forward-reference to fix.
- `package.json` + clean `npm test` run — 665/665 baseline, `dependencies {ws:8.21.0}`, `peerDependencies {hls.js:>=1.5.0}`, no new install needed.
- `.planning/STATE.md` — Phase-15 blocker (denylist) confirmed already-resolved in `asset-policy.js`; Phase-14 destroyAll/object-URL-revocation decisions.

### Secondary (MEDIA-confidence — cited standards)
- MDN `Referrer-Policy` / `<meta name="referrer">` — document-level `no-referrer` semantics and scope over all subresource fetches. `[CITED]`
- MDN `crossorigin` / CORS settings attributes — absence of `crossorigin` → no-CORS request → no credentials sent to third-party origins for media/image subresources. `[CITED]`
- MDN `URL` / `URLSearchParams` — correct query-param editing (order/repeat-preserving `delete`). `[CITED]`
- AWS SigV4/SigV2 query auth, GCP signed-URL V4, Azure SAS — the provider-documented signed-URL param names in the denylist. `[CITED]`

### Tertiary (LOW confidence — flagged)
- The *generic* token/PII param-name set (beyond provider-documented signing params) — reasoned default, not a single authoritative spec. `[ASSUMED A1]`
- Runtime no-referrer + no-credentials *fetch behavior* — standard browser semantics, but unverifiable in jsdom; deferred to real-browser UAT. `[ASSUMED A2]`

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new libraries; every API/module verified against source and a green test run.
- Architecture / integration points: HIGH — every file:line anchor read and confirmed; the media-tracker skip-predicate reuse and the CSP/referrer insertion point are verified, not assumed.
- Masking helper design: HIGH for the pattern (mirrors shipped `safeMaskText`/`compileMaskSelector`); MEDIUM for the denylist *membership* (A1, within granted discretion).
- referrerpolicy/credentials runtime effect: MEDIUM — string-layer behavior HIGH (verified insertion point), live browser behavior ASSUMED (A2, deferred UAT, consistent with project precedent).
- Threat model: HIGH — derived from verified Phase-14 decisions (sandbox token, no `connect-src`, `blob:` scoping, destroyAll revocation) and the verified `allow-scripts` scan coverage of `media-player.js`.
- Pitfalls: HIGH — each is grounded in a specific verified mechanism (URL normalization, marker assertions, media-tracker predicates).

**Research date:** 2026-06-21
**Valid until:** 2026-07-21 (stable — internal codebase + settled browser semantics; the only fast-moving input is the denylist membership, which is documented and user-adjustable).
