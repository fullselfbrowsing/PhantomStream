---
phase: 12-static-assets-by-reference
reviewed: 2026-06-20T00:00:00Z
depth: standard
files_reviewed: 9
files_reviewed_list:
  - src/renderer/asset-policy.js
  - src/renderer/index.js
  - src/renderer/diff.js
  - src/renderer/snapshot.js
  - src/capture/index.js
  - src/protocol/constants.js
  - tests/differential/divergence-ledger.js
  - tests/differential/scenarios/static-assets.js
  - docs/SECURITY.md
findings:
  critical: 2
  warning: 4
  info: 4
  total: 10
status: issues_found
---

# Phase 12: Code Review Report

**Reviewed:** 2026-06-20
**Depth:** standard
**Files Reviewed:** 9
**Status:** issues_found

## Summary

Phase 12 ("Static Assets by Reference") changes the viewer's verb from render-inert to FETCH and introduces a fail-closed origin policy plus a pre-write fetch gate to prevent blind-SSRF / tracking from the viewer's (possibly privileged) network. The architecture is sound: the gate is consulted at four write sites (snapshot string layer, diff ADD over inert template content, diff ATTR pre-setAttribute, subtree response), the capture-side degrade is correctly clone-only, the `data:` byte-cap boundary is correct (cap-inclusive pass, one byte over degrades), the D26 differential ledger entry is properly scenario-pinned to `static-assets` and same-index-shaped, and no `allow-scripts` / `script-src` / `media-src` was introduced (sandbox + CSP invariants intact).

However, the central security control — the "provably public-https" classifier that the entire viewer-fetch model rests on — is **not actually fail-closed for several real internal-address representations**, and the snapshot string-layer gate has a tag-parsing bypass. Both were verified empirically against the shipped code. Because Phase 12's own threat model (SECURITY.md §6) names the AWS metadata host `169.254.169.254` as the canonical thing this control must block, and the bypasses reach exactly that host (and loopback) before any fetch is neutralized, these are BLOCKERs.

The existing `tests/renderer-asset-policy.test.js` denylist table only exercises plain dotted-quad IPs, `[::1]`, `[fc00::1]/[fd12::1]`, `localhost`, `intranet`, `host.local` — it does not cover IPv4-mapped IPv6, IPv6 link-local, NAT64, or trailing-dot loopback, so these gaps are unguarded rather than intentionally accepted.

## Critical Issues

### CR-01: SSRF — `isPrivateOrLocalHost` misses IPv4-mapped IPv6, IPv6 link-local, and NAT64; metadata + loopback reachable

**File:** `src/renderer/asset-policy.js:56-80` (consumed via `gateAssetUrl` `src/renderer/index.js:88-126` and `gateSnapshotAssets` `src/renderer/snapshot.js:123-148`)

**Issue:** The denylist in `isPrivateOrLocalHost` enumerates IPv4 RFC1918/loopback/link-local ranges via a dotted-quad regex, IPv6 loopback via the exact string `::1`, and IPv6 ULA via `/^f[cd][0-9a-f]*:/`. It has **no handling for IPv4-mapped IPv6 literals or IPv6 link-local**, so several internal hosts classify as `allowed:true`. Verified empirically against the shipped `classifyAssetOrigin` (the real exploit path — WHATWG `new URL()` normalization is applied first):

```
https://[::ffff:169.254.169.254]/x   -> ALLOW   (AWS/GCP/Azure metadata link-local, IPv4-mapped)
https://[::ffff:7f00:1]/x            -> ALLOW   (127.0.0.1 loopback, IPv4-mapped)
https://[fe80::1]/x                  -> ALLOW   (IPv6 link-local fe80::/10 — absent from denylist)
https://[64:ff9b::a9fe:a9fe]/x       -> ALLOW   (NAT64 of 169.254.169.254)
https://localhost./x                 -> ALLOW   (trailing-dot loopback; WHATWG keeps the dot on non-IP hosts,
                                                  so host==='localhost.' bypasses the host==='localhost' check
                                                  AND has a '.' so it is not "dotless")
```

The module header (lines 20-29) and SECURITY.md §6 (lines 149-164) both claim the posture is "anything not provably public-https is blocked" and explicitly list `169.254.169.254` and `::1` as denied. The IPv4-mapped form `::ffff:169.254.169.254` resolves to the **same** metadata endpoint, and `fe80::/10` is link-local exactly like `169.254.0.0/16`. A viewer running on a cloud host or behind a privileged network will issue a real GET to these endpoints, defeating the milestone's primary safety net. This is a blind-SSRF / cloud-credential-exfil surface.

**Why it matters:** This is the load-bearing control of the whole phase. `gateAssetUrl` treats `classifyAssetOrigin` as authoritative deny (index.js:106-110); if the classifier returns `allowed:true`, the URL is written into the mirror and the browser fetches it. The placeholder-degrade never happens for these hosts.

**Fix:** Normalize and block IPv4-mapped/compatible IPv6 and IPv6 link-local before the ULA check. After bracket-stripping `bare`:

```js
// IPv6 link-local fe80::/10 (the first hextet is fe80..febf).
if (/^fe[89ab][0-9a-f]*:/.test(bare)) return true;
// IPv4-mapped / IPv4-compatible IPv6: ::ffff:a.b.c.d or ::ffff:HHHH:HHHH (and ::a.b.c.d).
// Extract a trailing embedded IPv4 (dotted or last two hextets) and re-run the v4 ranges.
var mapped = /^(?:::ffff:|::)(?:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})|([0-9a-f]{1,4}):([0-9a-f]{1,4}))$/i.exec(bare);
if (mapped) {
  var v4 = mapped[1];
  if (!v4 && mapped[2] && mapped[3]) {
    var hi = parseInt(mapped[2], 16), lo = parseInt(mapped[3], 16);
    v4 = (hi >> 8) + '.' + (hi & 255) + '.' + (lo >> 8) + '.' + (lo & 255);
  }
  if (v4 && isPrivateOrLocalHost(v4)) return true; // reuse the v4 ranges on the embedded address
}
```

For trailing-dot loopback, normalize a single trailing `.` off the host (or add `host === 'localhost.'`) before the checks. The most robust long-term fix is to block ALL IP-literal hosts that are not provably public (i.e., any bracketed IPv6 literal that is not a confirmed-global address should be denied, since the milestone has no use case for fetching assets from raw IP literals); given the "fail-closed / provably public" contract, denying every IPv6 literal except a vetted allowlist is defensible. Add table rows for each vector above to `tests/renderer-asset-policy.test.js`.

### CR-02: Pre-write snapshot gate bypassed by a `>` inside an earlier `<img>` attribute value (tag-split)

**File:** `src/renderer/snapshot.js:62, 123-148`

**Issue:** `gateSnapshotAssets` rewrites blocked `<img>` assets at the string layer using `IMG_TAG_RE = /<img\b([^>]*)>/gi`. The `[^>]*` capture stops at the **first literal `>`**, but `>` is legal inside a double/single-quoted HTML attribute value and does **not** terminate the start tag for a real parser. An attacker-influenced snapshot whose `<img>` carries a `>` in an attribute that precedes `src` splits the regex match short of the `src`, so the gate emits the markup **unchanged** and the browser fetches the blocked origin during srcdoc parse — before the post-parse `gateFragmentAssets` defense can run. Verified against shipped code (block-all gate):

```
input : <img alt="a>b" src="https://169.254.169.254/x.png">
output: <img alt="a>b" src="https://169.254.169.254/x.png">   (UNCHANGED — GET fires)

input : <img data-x="a>b" src="https://10.0.0.1/x.png">
output: <img data-x="a>b" src="https://10.0.0.1/x.png">       (UNCHANGED)
```

And jsdom confirms a real parser treats `<img alt="a>b" src=...>` as a single `<img>` with the malicious `src` (one img element, `src` intact). The string-layer gate is, per SECURITY.md §6 (lines 185-194) and snapshot.js header (lines 43-59), the **authoritative** snapshot fetch gate precisely because the parser fetches during srcdoc parse; the post-parse DOM scrub is "defense-in-depth," explicitly too late for the initial GET. So this is a real pre-write-gate bypass for any blocked origin, not merely a fidelity glitch.

Note: `payload.html` is attacker-influenced and intentionally raw at this layer; the gate is the only thing standing between a blocked `src` and the parser. The capture side strips `on*`/dangerous schemes but does **not** strip a `>` from a benign-looking `alt`/`title`/`data-*` value (correctly — that is valid markup), so the malicious shape survives capture and arrives here.

**Why it matters:** The snapshot is the first and largest fetch surface; a blocked-origin `<img src>` that reaches the parser issues the tracking beacon / internal probe the gate exists to prevent.

**Fix:** Do not gate `<img>` via a `[^>]*`-bounded regex. Either:
- Parse-and-rewrite the `<img>` attribute blob with a quote-aware scan that does not stop at a `>` inside quotes (consume `"..."` / `'...'` spans atomically when locating the tag end and when reading/stripping attrs), or
- Treat any `<img` whose start tag cannot be unambiguously bounded (contains an unbalanced quote / a `>` inside quotes) as a blocked element and emit the dimensioned placeholder (fail-closed), rather than passing it through.

A regex over HTML is the wrong tool for a security boundary; at minimum the tag-end detection must be quote-aware. Add fixtures: `<img alt="a>b" src=<blocked>>`, `<img title=">" src=<blocked>>`, single-quote variants, and `data-ps-currentsrc="x>y"`.

## Warnings

### WR-01: `isPrivateOrLocalHost` is an exported public API that returns ALLOW for trailing-dot and other un-normalized IP/host forms

**File:** `src/renderer/asset-policy.js:56-80`

**Issue:** `isPrivateOrLocalHost` is a named export (and is documented as a Phase-15-reusable seam, lines 38-44). On its own — without the WHATWG `new URL()` normalization that `classifyAssetOrigin` applies first — it returns `false` (not-private) for inputs that are clearly internal:

```
isPrivateOrLocalHost("127.0.0.1.")  -> false   (trailing-dot IPv4; $-anchored regex misses it)
isPrivateOrLocalHost("10.0.0.5.")   -> false
isPrivateOrLocalHost("localhost.")  -> false
isPrivateOrLocalHost("[::ffff:7f00:1]") -> false  (see CR-01)
```

Inside `classifyAssetOrigin` the trailing-dot IPv4 cases happen to be saved because `new URL('https://127.0.0.1./')` normalizes the hostname to `127.0.0.1`. But Phase 15 (and any other future caller) is told to "reuse the very same classifier seam," and this predicate alone is unsafe on un-normalized hostnames. A reuse that passes a raw `Host:` header value, a CSS `url()` host, or a media URL host straight into `isPrivateOrLocalHost` would silently allow loopback.

**Why it matters:** A "fail-closed" predicate that depends on its single current caller having pre-normalized the input is a latent bypass the moment a second caller appears — which the comments explicitly anticipate.

**Fix:** Make the predicate self-contained: strip a single trailing `.` from `host` at entry, and fold in the CR-01 IPv6 normalization, so the function is safe regardless of how the caller obtained the hostname. Document that callers must still pass `u.hostname` (already lowercased), but do not rely on URL normalization for correctness of the deny decision.

### WR-02: `mediaMode: 'poster'` permits ALL images to fetch, not just posters — contradicts the documented posture

**File:** `src/renderer/index.js:88-126` (gate precedence step 5), `docs/SECURITY.md:176-183`

**Issue:** SECURITY.md §6 describes `poster` as "posters/placeholders only; full-asset fetch withheld." The gate, however, returns `{ allow: true }` for every origin-permitted image in `poster` mode — there is no distinction between a `<video>`/poster image and an ordinary content `<img>`. Verified: `gateAssetUrl("https://cdn.example.com/a.png", { mediaMode: "poster", kind: "image" })` -> `allow:true`. The `kind` parameter is threaded through (index.js:294-301, diff.js:344-345) but `gateAssetUrl` never branches on it for `poster`.

The code comments (index.js:64-67, 123-125) do disclose this ("poster images pass under 'poster' ... the full poster/full-asset split matures in Phase 13"), so it is a *documented* interim behavior — but SECURITY.md, the security contract, states the stricter guarantee without the "Phase 12 interim" caveat in the bullet itself (it appears only later at lines 180-183). A host operator reading the §6 `mediaMode` bullet will believe content images are withheld in `poster` mode when they are not — a privacy/bandwidth expectation gap.

**Why it matters:** `poster` is the privacy-conservative middle setting; a host choosing it to suppress content-image fetches does not get that behavior, and the security doc's headline description overstates the guarantee.

**Fix:** Either gate non-poster images in `poster` mode now (branch on `kind`: only `kind === 'poster'` passes step 5 under `poster`, everything else -> `{ allow: false, reason: 'poster-only' }`), or correct the SECURITY.md §6 `mediaMode` bullet to state that in Phase 12 `poster` behaves like `reference` for images (origin-gated) and the poster/full split is deferred to Phase 13. Align the doc and the code so the contract is not stronger than the implementation.

### WR-03: Diff ATTR gate omits `srcset` — a blocked-origin responsive image can reach the live mirror via a `srcset` mutation

**File:** `src/renderer/diff.js:344` (`attrName === 'src' || attrName === 'poster'`)

**Issue:** The ATTR-branch pre-write fetch gate only fires for `src` and `poster`:

```js
if (gateAssetUrl && (attrName === 'src' || attrName === 'poster')) { ... }
```

A mutation op that sets `srcset` (e.g. `{op:'attr', nid, attr:'srcset', val:'https://169.254.169.254/x.png 2x'}`) is NOT origin-gated on the render side; after `sanitizeAttrValue` (which checks dangerous *schemes*, not internal *origins*), it is written via `setAttribute('srcset', ...)`. On a live `<img>` already in the mirror, the browser may select and fetch a `srcset` candidate, issuing a GET to the blocked origin.

The capture side does degrade `srcset` mutations to a `data-ps-asset-unavailable` op and blanks the value (capture/index.js:4147-4161), so the **trusted** capture path will not emit a blocked `srcset`. But the renderer gate is explicitly positioned as the authoritative pre-write fetch boundary for diffs (diff.js:339-343, "blocked origin never reaches the live DOM") and must not depend on the capture side being the only producer — a different/compromised transport, or a future capture path that forgets the degrade, would slip a blocked `srcset` through. The render gate is supposed to be the backstop and here it has a hole.

**Why it matters:** Defense-in-depth for the fetch boundary is incomplete; `srcset` is a first-class fetchable URL attribute (the snapshot string gate and capture both treat it as one), so the diff gate omitting it is an inconsistency that becomes a live-DOM SSRF if any producer emits a raw blocked `srcset`.

**Fix:** Extend the ATTR gate to `srcset`. Because `srcset` is multi-candidate, gate every candidate (reuse the capture-side `assetDegradeReasonForSrcset` shape or parse candidates and gate each); if any candidate is blocked, drop the whole `srcset` attribute and rely on the placeholder/`src` path. Also gate it consistently with `gateFragmentAssets` (which currently only re-points `src` from `data-ps-currentsrc` and gates `src`, not a standalone `srcset` on an element that has no `src`).

### WR-04: `gateFragmentAssets` does not gate an `<img>` that has `srcset` but no `src`

**File:** `src/renderer/index.js:337-364`

**Issue:** In the parsed-fragment gate (the authoritative gate for diff ADD / subtree template content), the effective URL is taken from `data-ps-currentsrc` (if present) else `src`:

```js
var effective = el.getAttribute('src');
if (pinned) { effective = pinned; ... }
if (effective && !gateAsset(effective, 'image').allow) { /* placeholder */ }
```

An `<img srcset="https://10.0.0.1/x 2x">` with **no** `src` and no `data-ps-currentsrc` has `effective === null`, so the gate is skipped entirely and the element (with its blocked `srcset`) is imported into the mirror, where the browser can fetch a candidate. Same root cause as WR-03 but on the ADD/subtree path. The capture side normally degrades such elements, but the render-side fragment gate is the documented backstop for "any asset a future write path introduces" (index.js:425-429) and should not assume `src` is always present.

**Why it matters:** Closes the same `srcset` gap on the ADD/subtree/post-parse paths so the four-site gate is uniform; otherwise a `src`-less responsive image bypasses every render-side gate.

**Fix:** When `!effective`, also read and gate `srcset`; if blocked (any candidate), replace with the placeholder or strip `srcset`. Consolidate the `src`/`srcset`/`poster` gating into one helper shared by `gateFragmentAssets` and the diff ATTR branch so the attribute coverage cannot drift between sites.

## Info

### IN-01: `setTagAttr` appends rather than preserving attribute position — benign but changes wire bytes on the pin path

**File:** `src/renderer/snapshot.js:78-81, 134`

**Issue:** When the currentSrc pin fires, `setTagAttr(nextAttrs, 'src', pinned)` strips the old `src` and re-appends it at the end of the attribute list. This reorders attributes on the emitted `<img>`. Harmless to the browser, but it means the gate is a slightly lossy string transform even on the allowed path (the header at lines 53-59 implies only fetchable values are rewritten). Not a correctness or security issue.

**Fix:** Optional — replace in place to keep attribute order, or note in the header that the pin path may reorder `<img>` attributes.

### IN-02: `gateAssetUrl` step-5 comment references poster/reference behavior that the code does not implement

**File:** `src/renderer/index.js:123-125`

**Issue:** The final comment says "'poster' permits poster images (P12 scope...)" but the code unconditionally `return { allow: true, reason: 'ok' }` regardless of `kind` or `poster`/`reference` (see WR-02). The comment describes intended Phase 13 behavior as if partially present. Mildly misleading for maintainers.

**Fix:** Tighten the comment to state that in Phase 12 steps 1-4 are the only gating and `poster`/`reference` are currently equivalent for images.

### IN-03: `hasDangerousStylesheetUrl` is duplicated verbatim across modules

**File:** `src/renderer/index.js:896-902` and `src/renderer/snapshot.js:171-177`

**Issue:** Identical `hasDangerousStylesheetUrl` implementations live in both `index.js` and `snapshot.js`. The project documents a deliberate "duplicate-don't-couple" style for the placeholder builders (snapshot.js:83-92), so this may be intentional, but two copies of a security-relevant scheme check can drift (one gets a new scheme, the other does not). Not a Phase-12 regression (pre-existing), surfaced because both files are in scope.

**Fix:** If duplication is intentional, add a short cross-reference comment in each copy ("keep in sync with the twin in snapshot.js / index.js"); otherwise factor into `sanitize.js` which both already import.

### IN-04: D26 ledger `affectedMessages` lists `STREAM.MUTATIONS` but the predicate only ever matches `STREAM.SNAPSHOT`

**File:** `tests/differential/divergence-ledger.js:647-661`

**Issue:** The D26 entry declares `affectedMessages: [STREAM.SNAPSHOT, STREAM.MUTATIONS]`, but `appliesTo` returns `false` for anything that is not a same-index SNAPSHOT/SNAPSHOT pair (lines 656-660), and the `static-assets` scenario performs no DOM mutations by design (scenarios/static-assets.js:45-47, "the by-reference asset defenses are entirely snapshot-side"). So `STREAM.MUTATIONS` in `affectedMessages` is dead/aspirational metadata. The predicate itself is correctly scenario-pinned (`scenarioName !== 'static-assets'` early-returns) and same-index-shaped, so it will NOT over-match or excuse divergences in other scenarios, and it claims exactly the intended shape (extracted-only Phase-12 marker present, reference absent) — this part is good. Only the `affectedMessages` declaration is broader than reality.

`affectedMessages` is documentation metadata (the oracle drives off `appliesTo` + `affectedScenarios`), so this does not weaken stale-entry detection — but it could mislead a reader into thinking a mutation-path divergence is covered when none is.

**Fix:** Drop `STREAM.MUTATIONS` from D26's `affectedMessages` (leave `[STREAM.SNAPSHOT]`), since no mutation message diverges in this scenario. If a future Phase-12 mutation-path divergence is anticipated, add it when the predicate actually covers it.

---

## Verified Correct (adversarially checked, no finding)

These were specifically probed and found sound:

- **Capture degrade is clone-only.** `data-ps-currentsrc` and the asset-unavailable placeholder are written to the clone (`cl` / `clone`), never `orig`/`live`, across the main walk (capture/index.js:3481-3497), the frame walk (1572-1584), and the subtree path (3825-3848). The Phase-7 no-mutation invariant holds.
- **`data:` byte-cap boundary has no off-by-one.** `classifyAssetRef` uses `> cap` (capture/index.js:249): a `data:` URI of exactly `ASSET_DATA_URI_MAX_BYTES` (262144) bytes passes (`ok:true`); 262145 degrades. UTF-8 byte counting (`assetUtf8ByteLength`, 198-220) handles surrogate pairs (4 bytes) and lone surrogates (3 bytes) correctly.
- **`blob:` never reaches the wire fetchable.** `absolutifyUrl` early-returns `blob:`/`data:` unchanged (3208-3218) so `classifyAssetRef` sees the raw scheme and degrades `blob:` unconditionally; the mutation ATTR path also degrades and blanks the value (4147-4161).
- **Sandbox / CSP invariants intact.** No `allow-scripts` anywhere; the sandbox token assertion (`allow-same-origin` exactly, else throw, index.js:402-406) is untouched. CSP `default-src 'none'` with `img-src http: https: data:`; no `script-src`, no `media-src` added (snapshot.js:164-169).
- **172.16.0.0/12 boundary is correct.** `b >= 16 && b <= 31` (asset-policy.js:71); tests pin 172.16.0.1 / 172.31.255.255 blocked and 172.15/172.32 allowed.
- **Userinfo `@` trick is handled.** `https://allowed@169.254.169.254/x` -> WHATWG hostname is `169.254.169.254` -> blocked (the embedded credentials do not fool the host extraction); blocked correctly today for plain dotted-quad, though see CR-01 for the IPv4-mapped variant.
- **D26 scenario pinning.** Early-returns on `scenarioName !== 'static-assets'`; same-index SNAPSHOT/SNAPSHOT only; requires extracted-enriched AND not reference-enriched, so it cannot mask a future regression in other scenarios.
- **CLAUDE.md conventions.** Plain JS ESM, named exports, JSDoc on exported functions, `var` + inline `||` defaulting in cross-runtime files, no emojis. Consistent with the codebase.

---

_Reviewed: 2026-06-20_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
