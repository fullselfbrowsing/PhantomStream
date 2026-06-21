---
phase: 15-media-security-masking-threat-model-docs
reviewed: 2026-06-21T19:35:13Z
depth: standard
files_reviewed: 10
files_reviewed_list:
  - src/capture/index.js
  - src/renderer/snapshot.js
  - docs/SECURITY.md
  - docs/ARCHITECTURE.md
  - tests/security-asset-url-mask.test.js
  - tests/capture-media.test.js
  - tests/renderer-media-csp.test.js
  - tests/security-media.test.js
  - tests/security-chokepoint-purity.test.js
  - tests/renderer-snapshot.test.js
findings:
  critical: 0
  warning: 4
  info: 4
  total: 8
status: issues_found
---

# Phase 15: Code Review Report

**Reviewed:** 2026-06-21T19:35:13Z
**Depth:** standard
**Files Reviewed:** 10
**Status:** issues_found

## Summary

Phase 15 completes the media-security contract: the asset/media URL masking vocabulary
(`maskAssetUrlForWire` / `stripTokenParams` / `TOKEN_PARAM_DENYLIST` / `maskMediaSelector`),
the document-level `<meta name="referrer" content="no-referrer">`, and the threat-model docs.

The security-load-bearing surfaces are, on the whole, **correct and well-defended**:

- **Byte-identity holds where it must.** `stripTokenParams` returns the original string on the
  no-token, opaque (`data:`/`blob:`/relative), and no-query paths and only ever calls
  `u.toString()` when a denied param was actually deleted (verified by direct execution). The
  off-by-default whole-snapshot byte-identity gate passes (the differential oracle is unaffected;
  no new ledger entry).
- **Fail-closed `maskAssetUrlFn` is correct.** string -> replace, `null` -> block (attr removed),
  `throw` -> block (logged, returns `null`) — verified in code and tests. It is strictly harder
  than `safeMaskText` (whose throw falls back to the asterisk mask), as documented.
- **Scheme-scrub-before-mask ordering is correct.** A hostile `javascript:`/`vbscript:`/
  `data:text/html` is neutralized by `hasDangerousScheme` in the `URL_ATTRS` loop **before** the
  asset-url dispatch runs, on both the element and mutation-attr paths (tests pin this for
  `<source src="javascript:...">`).
- **`maskMediaSelector` -> no state.** The predicate is ORed into both `collectTrackedMediaElements`
  (line 4940) and `attachMediaListeners` (line 5031), and into the snapshot/subtree placeholder
  path, so a masked `<video>`/`<audio>` emits no `media[]` baseline, no `STREAM.MEDIA`, and its
  URL is replaced by a dimension-only placeholder.
- **Referrer meta** is ordered after `CSP_META` and before charset/viewport/links/`<img>`, exactly
  once, with no `crossorigin` and an unchanged CSP shape, on both `buildSnapshotHtml` and
  `buildFramePlaceholderHtml`. Test pins are correct.
- **Backward-compat / no new deps** confirmed (`dependencies` stays `{ ws: '8.21.0' }`; envelope /
  relay / protocol untouched). All 84 tests across the six files pass.
- **No emojis** in either doc (only `×`, `§`, em-dashes — typographic).
- **Test pins loosened correctly**: `renderer-snapshot` keeps the CSP-first pin and adds the
  referrer meta to the head-prefix assertion (markers preserved + new added); `security-chokepoint-
  purity` adds the new `maskMediaSelector`/`maskAssetUrls`/`maskAssetUrlFn`/`referrer`/`no-referrer`/
  `Parent-Realm Object-URL` markers without dropping any prior marker. Not a regression mask.

The findings below are all WARNING/INFO. The two most material are **doc accuracy defects** (a
placeholder-attribute claim that contradicts the code, and a "byte-for-byte" survival claim that
the `u.toString()` re-encode contradicts) plus two **documented-scope token-survival gaps** worth
making explicit. No BLOCKER-class correctness, injection, or data-loss defect was found.

## Warnings

### WR-01: SECURITY.md falsely claims the block/mask placeholder carries `data-fsb-nid`

**File:** `docs/SECURITY.md:112` and `docs/SECURITY.md:138`
**Issue:** §4 states the `blockSelector` placeholder "emits a placeholder box with only
`data-fsb-nid`, `rr_width`, and `rr_height`" (line 112) and the `maskMediaSelector` placeholder is
"identity-only: `data-fsb-nid` + `rr_width` + `rr_height`" (line 138). The actual placeholder
builder writes **no `data-fsb-nid` attribute at all**:

```js
// src/capture/index.js:2538-2543
function createBlockPlaceholder(doc, rect) {
  var placeholder = doc.createElement('div');
  placeholder.setAttribute('rr_width', String(rect.width || 0) + 'px');
  placeholder.setAttribute('rr_height', String(rect.height || 0) + 'px');
  return placeholder;   // no data-fsb-nid
}
```

Identity travels positionally via the `nodeIds` sidecar (Phase 7 removed live-page nid stamping).
The doc claim directly contradicts both the code and the in-code comment at `src/capture/index.js:
3742-3744` ("the masked element legitimately carries no identity-leaking attribute"), and the
renderer twin `assetUnavailablePlaceholderTag` (`src/renderer/snapshot.js:239-247`) likewise emits
no nid. A reader auditing the privacy contract would conclude a page-visible identity attribute is
emitted on masked/blocked elements when it is not. This is the security contract document for an
attacker-facing surface, so an inaccurate guarantee is a real defect.
**Fix:** Drop `data-fsb-nid` from both lines, e.g. "emits a placeholder box carrying only
`rr_width` and `rr_height`; identity travels in the `nodeIds` sidecar, never as a page-visible
attribute." (Test `tests/security-media.test.js:666-669` already asserts only `rr_width`/`rr_height`
on the masked placeholder, so the doc — not the code — is wrong.)

### WR-02: "functional params survive byte-for-byte" overstated — `u.toString()` re-encodes surviving params on the strip path

**File:** `docs/SECURITY.md:156` (and §4 line 145-146 "functional params survive")
**Issue:** §4 says functional params "are never stripped" and "survive byte-for-byte". When a
denied param is actually deleted, `stripTokenParams` returns `u.toString()`, which re-serializes
**all** surviving params through `URLSearchParams` and normalizes the path/host. Verified by
execution:

```
IN : https://cdn.example.com/a.jpg?caption=a%20b&token=secret
OUT: https://cdn.example.com/a.jpg?caption=a+b          // %20 -> +, surviving param re-encoded

IN : https://CDN.Example.com:443/Path%20With%20Space/Img.JPG?w=8&sig=LEAK
OUT: https://cdn.example.com/Path%20With%20Space/Img.JPG?w=8   // host lowercased, :443 dropped
```

`%20` -> `+` decodes to the same byte server-side, so this is **not** a correctness/fetch break,
but it IS a wire-divergence for surviving params, so the "byte-for-byte" wording is false on the
strip path. (Byte-identity DOES hold on the no-strip path — that part is correct and is the
oracle-relevant one.) The code comment at `src/capture/index.js:3024-3026` is accurate about
WHY `u.toString()` is avoided on the no-strip path; the doc prose just over-promises for the
strip path.
**Fix:** Soften §4 to "functional params are preserved (not stripped); when any denied param is
removed the URL is re-serialized, so surviving params may be re-encoded equivalently (`%20`->`+`,
host-case/default-port normalized) — byte-identity is guaranteed only for URLs with no denied
param." No code change required; this is the accurate description of the shipped behavior.

### WR-03: Token survives masking when query uses `;` as a param separator (legacy but valid)

**File:** `src/capture/index.js:3030-3044` (`stripTokenParams`)
**Issue:** The denylist is keyed on `URLSearchParams` param NAMES, which split only on `&`. A URL
using the legacy `;` separator (still accepted by some server stacks and historically endorsed by
W3C for `application/x-www-form-urlencoded` query strings) hides the token inside another param's
value, so it is never matched and survives verbatim on the wire. Verified:

```
IN : https://cdn.example.com/a.jpg?w=10;token=LEAKED_SECRET&sig=x
OUT: https://cdn.example.com/a.jpg?w=10%3Btoken%3DLEAKED_SECRET   // token survives (sig stripped)
parsed param names: ['w']   // w value = "10;token=LEAKED_SECRET"
```

The masked wire still carries `LEAKED_SECRET`. This is within the *documented* "query-param-name
denylist" scope, and a host needing airtight redaction can use `maskAssetUrlFn`, so it is a WARNING
not a BLOCKER — but for the stated purpose ("a signed-CDN URL can carry credential/PII query
params") it is a genuine residual the docs do not call out, and a real-world signed URL that a
proxy rewrote with `;` would leak.
**Fix:** Either (a) document this explicitly in §4 as a known limitation of name-keyed stripping
(matrix/`;`-separated params are not parsed and may carry tokens; use `maskAssetUrlFn` for full
control), or (b) pre-split the query on `[;&]` before name-matching if `;`-separated tokens are
considered in-scope. Documenting (a) is the lower-risk choice consistent with the fidelity-first
posture.

### WR-04: Token in the URL fragment is not stripped yet reaches the cross-origin viewer

**File:** `src/capture/index.js:3030-3044` (`stripTokenParams`)
**Issue:** A token placed in the fragment (`#access_token=...`) is not part of `u.search`, so it is
never examined and the full URL — fragment included — is emitted on the wire. Verified:

```
IN : https://cdn.example.com/a.jpg?w=10#access_token=LEAK
OUT: https://cdn.example.com/a.jpg?w=10#access_token=LEAK
```

The fragment is not sent in the HTTP request, so this is not a Referer/server leak; but the URL
STRING (with fragment) crosses the relay to a possibly-cross-origin viewer, which is exactly the
disclosure surface §4 frames ("the wire carries URL strings... a signed-CDN URL can therefore carry
credential/PII"). Token-in-fragment is a real OAuth-implicit-flow shape, so it is worth either
masking or explicitly excluding. WARNING (narrow, and `maskAssetUrlFn` covers it).
**Fix:** In `stripTokenParams`, also scan `u.hash` for denied names (parse `u.hash.slice(1)` as a
`URLSearchParams`, rebuild if any matched) — or document in §4 that fragment tokens are out of
scope for the boolean strip and must be handled via `maskAssetUrlFn`.

## Info

### IN-01: `maskAssetUrls` strips token params from ALL URL-bearing attrs, including `<a href>` — broader than "asset/media"

**File:** `src/capture/index.js:3248-3265`, `assetUrlKindForTag` at `3514-3516`
**Issue:** The element-path masking loop iterates `URL_ATTRS = ['src','href','action','poster',
'data']`, so with `maskAssetUrls: true` a token in an `<a href="...?token=...">` (kind defaults to
`'image'`) is also stripped/normalized. The feature is named/documented as "asset and media URL
masking" but in practice covers every URL-bearing attribute. This is arguably a *feature* (broader
PII coverage) and §4 does say "every URL-bearing attribute (`src`, `poster`, `data`, `srcset`
candidates)" — but it omits `href`/`action` from that parenthetical while the code includes them.
**Fix:** Align the §4 parenthetical with `URL_ATTRS` (add `href`, `action`) so the documented
surface matches the implemented surface, or narrow the loop to genuine asset attrs if `<a href>`
stripping is unintended. Low priority — behavior is defensible; only the doc/name is imprecise.

### IN-02: `srcset` candidate URLs are NOT routed through asset-url token masking

**File:** `src/capture/index.js:3279-3287` (element) and `3396-3402` (attr)
**Issue:** `srcset` is scheme-scrubbed (`scrubSrcset`) and absolutified, but its candidate URLs do
**not** flow through `maskAssetUrlForWire`, so a token-bearing responsive candidate
(`<img srcset="https://cdn/x.jpg?X-Amz-Signature=... 2x">`) keeps its token on the wire even with
`maskAssetUrls: true`. §4 explicitly lists "`srcset` candidates" as covered by the masking dispatch
("every URL-bearing attribute (`src`, `poster`, `data`, `srcset` candidates)... routes through the
same testable helper"), so this is a **doc-vs-code mismatch**: the doc claims srcset coverage the
code does not implement. Demoted to INFO because the `MULTI_URL_FIXTURE` test only asserts srcset
byte-identity off-by-default (not on-strip), so no test fails — but the gap is real.
**Fix:** Either thread srcset candidates through `maskAssetUrlForWire` (parse via
`parseSrcsetCandidates`, mask each `url`, re-join — mirroring `absolutifySrcset`) when
`maskAssetUrls || maskAssetUrlFn`, or correct §4 to state srcset is scheme-scrubbed but its
candidates are not token-masked by the boolean (use `maskAssetUrlFn` per-element). Given the
prominent §4 claim, implementing coverage is the better fix.

### IN-03: Threat-model "child cannot read the blob" claim is accurate — confirmed, noted for the record

**File:** `docs/SECURITY.md:302-308` (Parent-Realm Object-URL threat model)
**Issue:** The prompt asked whether row 1's "the child can play the element but cannot read the
blob" claim is overstated given `allow-same-origin`. It is **not** overstated: the sandbox is
`allow-same-origin` WITHOUT `allow-scripts`, so no script executes inside the mirror iframe at all;
`blob:` is readable only via `fetch`/`XHR`/`FileReader`, all of which require script. The claim is
correct, and the supporting controls (no `connect-src`, `blob:` scoped to `media-src` only,
revoke-on-destroy) are accurately described. The `tests/security-media.test.js` + purity-scan
backing is real (media-player.js has zero executable `allow-scripts`).
**Fix:** None required — recorded so the doc-accuracy audit is complete and this claim is not
mistaken for a gap in a later pass.

### IN-04: `payload.orig` may be null in the element-path masking loop — handled, but worth a guard note

**File:** `src/capture/index.js:3249`
**Issue:** `var elNid = getTrackedNodeId(payload.orig) || '';` — for detached subtree descendants
`payload.orig`/`liveDesc` can be null. `getTrackedNodeId(null)` returns `null` (guards on
`nodeType`), so `elNid` falls back to `''` and the masking still runs against the clone attribute
value (ctx just carries an empty nid). No crash, no leak. This is correct, but the `ctx.nid` handed
to a host `maskAssetUrlFn` can be `''` for subtree-descendant elements, which a host keying
decisions on nid should be aware of.
**Fix:** None required for correctness. Optionally note in the `maskAssetUrlFn` JSDoc (`src/capture/
index.js:528`) that `ctx.nid` may be `''` for elements serialized via the subtree path.

---

_Reviewed: 2026-06-21T19:35:13Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
