# PhantomStream Security

This document is the embed security contract for PhantomStream's capture -> wire -> render
pipeline. It describes the always-on protections implemented in `src/capture/index.js`,
`src/renderer/sanitize.js`, `src/renderer/diff.js`, `src/renderer/snapshot.js`, and
`src/renderer/index.js`, plus the responsibilities a host must preserve when embedding the
viewer.

## 1. Threat Model

The page being mirrored is attacker-influenced input. Its DOM, attributes, CSS, text, links,
forms, dialogs, and overlays can all reach the capture side. PhantomStream's job is to preserve
benign visual fidelity while making mirrored content safe to render in an embedded viewer and
while ensuring configured private content never leaves the captured page.

| Pattern | Primary risk | Mitigation layers |
|---|---|---|
| Inline event handlers (`onclick`, `onload`, namespaced handler attrs) | Script execution in the mirror | Capture `sanitizeForWire`, render `sanitizeFragment` / `sanitizeAttrValue`, no `allow-scripts` sandbox |
| `javascript:`, `vbscript:`, `data:text/html` URLs | Script or HTML navigation | Capture and render URL scheme blocklist; CSP `default-src 'none'` |
| Nested `srcdoc` attacker iframes | Reintroduced document execution surface | `srcdoc` attributes dropped at both chokepoints |
| `<object>` / `<embed>` plugin shells | Plugin or nested resource execution | Dropped entirely at both chokepoints |
| Namespace-confusion mXSS (`svg`, `math`, `xlink:href`, style breakouts) | Parser mutation turns inert-looking markup active | DOM-fragment render sanitization, namespace-aware attr scrubs, CSS breakout scrub |
| CSS vectors (`expression()`, `-moz-binding`, `url(javascript:)`, hostile `@import`) | Legacy script or unwanted fetch path | Targeted CSS value scrub at capture and render |
| CSSOM `styleSources[]` and `DIFF_OP.STYLE_SOURCE` ops | Stylesheet text becomes a new insertion surface | Capture-side CSS scrub, render-side `scrubCssText`, CSP, and no `allow-scripts` sandbox |
| Password and PII leakage | Private text leaves the page | Capture-side masking before transport; password masking is non-configurable |
| Shadow root, same-origin frame, or subtree recovery HTML | New HTML insertion surface in the mirror | Same `sanitizeForWire` capture chokepoint, render-side `sanitizeFragment`, CSP meta, and no-`allow-scripts` sandbox |
| Cross-origin iframe content | Browser-origin data leakage | Capture never reads cross-origin iframe content; renderer shows content-free placeholders only |
| Live value diffs | Typed values bypass snapshot masking | `DIFF_OP.VALUE` payloads route through capture-side value masking before transport |
| Future serialization path bypass | A new writer skips sanitization or masking | Static scan in `tests/security-chokepoint-purity.test.js` |
| New renderer `innerHTML` sink or sandbox weakening | Render-side defense bypass | InnerHTML allowlist and `allow-scripts` forbidden scan |
| Security contract rot | Docs stop matching shipped controls | `docs/SECURITY.md` marker guard in the purity test |

## 2. Defense-In-Depth Pipeline

PhantomStream uses five layers in order. No layer is optional, and there is no opt-out config
on either the capture or renderer side.

1. **Capture chokepoint: `sanitizeForWire` (`src/capture/index.js`)** - every snapshot,
   add-op subtree, shadow root sidecar, same-origin frame payload, subtree response,
   attr op, text op, value diff, head inline style value, CSSOM `styleSources[]` entry,
   and `DIFF_OP.STYLE_SOURCE` op routes through this named function before
   `transport.send`. It strips, neutralizes, masks, or drops content only on detached
   clones and wire values; the live page is not mutated.
2. **Wire** - protocol messages carry already-sanitized and already-masked values. The D7
   differential ledger entry documents the intentional divergence from the raw reference stream.
3. **Render chokepoints: `sanitizeFragment` and `sanitizeAttrValue`
   (`src/renderer/sanitize.js`)** - add-op HTML is parsed in a `<template>`, scrubbed as a
   DOM fragment, and then imported. Shadow root replacements, same-origin frame srcdoc
   payloads, and `STREAM.SUBTREE_RESPONSE` installs follow the same parse-then-sanitize
   rule before becoming addressable. Attr ops are scrubbed before `setAttribute`, and
   CSSOM `styleSources[]` / `DIFF_OP.STYLE_SOURCE` text routes through `scrubCssText`
   before a mirror `<style>` node is written. The viewer also runs a post-parse
   `sanitizeFragment` scrub on the mirror document after srcdoc loads.
4. **Srcdoc CSP meta** - every snapshot srcdoc includes this adopted policy:

   ```text
   default-src 'none'; img-src http: https: data:; style-src http: https: 'unsafe-inline'; font-src http: https: data:
   ```

   The `style-src http: https: 'unsafe-inline'` adjustment is intentional. The original baseline
   allowed inline styles only, but capture deliberately emits external stylesheet links via
   `stylesheets[]` in `src/capture/index.js`; blocking those links would break ordinary mirror
   fidelity. Script blocking remains unchanged because `default-src 'none'` is still present and
   no `script-src` is introduced.
5. **Iframe Sandbox token contract** - the viewer iframe's sandbox attribute is exactly
   `allow-same-origin`. It is never `allow-scripts`, and no other token is added. `createViewer`
   writes the attribute, reads it back, and throws `viewer-sandbox-invalid` if the token list is
   not exactly one token. `allow-same-origin` keeps the mirror document parent-accessible for diff
   applies; omitting `allow-scripts` is what makes mirrored script inert.

Nested same-origin frame mirrors are also inert `srcdoc` documents and must not
gain `allow-scripts`. Cross-origin iframe content is never captured; placeholder
metadata must not imply remote document access.

The CSP is delivered by meta because the mirror is `srcdoc`, not a fetched URL. Meta delivery
does not enforce `frame-ancestors`, `sandbox`, or `report-uri`; adding those directives to the
meta policy would be a silent no-op. The iframe-level sandbox attribute is the sandbox control,
and host embedding constraints belong to the host application.

## 3. Sanitization Policy

The policy is blocklist-based and fidelity-first. An allowlist was rejected because PhantomStream
must mirror arbitrary real pages without breaking benign markup.

- Event-handler attributes (`on*`) are removed in capture and render paths.
- Dangerous URL schemes are removed for URL-bearing attrs, including `href`, `src`, `action`,
  `poster`, `data`, `formaction`, `xlink:href`, and `srcset` candidates.
- `srcdoc` attributes are dropped.
- `script`, `noscript`, `object`, and `embed` subtrees are dropped. `object` / `embed` are
  removed rather than replaced because they are plugin or nested-resource shells and do not carry
  useful mirror fidelity under the sandbox.
- CSS is value-scrubbed for unsafe `url()`, `expression()`, `-moz-binding`, hostile `@import`,
  and `</style>` breakout shapes. Relative URLs remain allowed so captured same-page assets and
  ordinary author CSS keep rendering.
- CSSOM mode (`styleMode: 'cssom'`) uses the same CSS scrub for snapshot `styleSources[]`
  and live `DIFF_OP.STYLE_SOURCE` ops. The optional
  `fetchStylesheet({ href, scope, ownerKind })` hook is host code, is never invoked by
  default, and must return CSS text for PhantomStream to sanitize before transport.
- Render-side sanitization operates on parsed DOM fragments, never on a sanitized string that is
  serialized and reparsed. String scrub/reparse is the mXSS anti-pattern this pipeline avoids.
- Strips and scrubs are counted and logged. They are never silent health events.

## 4. Masking Guarantees

Masking is capture-side only. Masked content is transformed before transport and never appears
on the wire in raw form.

- Password input values are always masked, independent of `maskInputs`.
- `maskInputs: true` masks input, textarea, and related form value surfaces.
- `maskTextSelector` masks text owned by matching elements and descendants. The default transform
  replaces each non-whitespace character with `*`, preserving whitespace and length.
- `blockSelector` emits a placeholder box with only `data-fsb-nid`, `rr_width`, and `rr_height`.
  Attributes, children, and text from the blocked subtree are not serialized.
- Invalid selectors fail at factory time with `invalid-mask-selector` instead of silently falling
  back to an unsafe state.
- Custom mask functions are fail-closed: thrown errors are logged and the default asterisk mask is
  used so raw values do not leak.
- Event-driven `DIFF_OP.VALUE` payloads use the same masking policy as snapshots and attrs.
  Password, `maskInputs`, and `maskInputFn` behavior is enforced before the value diff leaves
  the page. Health and diagnostics stay content-free and do not include typed values.
- `select` / `option` display text remains a known privacy boundary: value masking does not make
  option labels private unless they are also covered by `maskTextSelector` or `blockSelector`.

## 5. Host must-nevers

Hosts embedding PhantomStream must preserve these rules:

- Never add iframe sandbox tokens, especially `allow-scripts`.
- Never render wire payloads outside `createViewer`.
- Never re-serialize the mirror document into another `innerHTML` sink.
- Never treat dialog, prompt, overlay, or custom overlay text as HTML. Built-in overlays use
  `textContent`; custom renderers should do the same.
- Never add an opt-out switch for the capture or render sanitizers.
- Never weaken the adopted CSP policy below script-blocking.
- Never relax the fail-closed asset-origin policy into an allow-by-default posture, and
  never move the asset fetch gate after the URL is written into the mirror (a post-write
  gate is too late -- the browser has already issued the GET). Widen reachable origins
  only through `allowAssetOrigins` / the `assetOriginPolicy` hook.

## 6. Viewer-side resource fetching

v2.0 changes the viewer's verb from **render-inert to fetch**. In v1 the mirror only rendered
attacker-influenced markup inertly; from Phase 12 on, a mirrored `<img>` / `<source>` / `<video>`
poster / CSS `background-image` causes the **viewer's own browser** to issue a GET from the
viewer's (possibly privileged) network. Static images are the first instance of this fetch
surface, so the viewer-fetch security model lands here. Mirrored asset bytes never traverse the
relay -- the wire carries URL strings only; the viewer fetches directly from the source/CDN.

**Fail-closed origin policy (MSEC-01).** A pure, fail-closed origin classifier
(`classifyAssetOrigin` in `src/renderer/asset-policy.js`) decides which asset URLs the viewer may
fetch. It is a *fetch* control, distinct from the *injection* control `hasDangerousScheme`: an
`https://` URL to an internal host passes the injection check yet is a blind-SSRF / tracking
surface, which this classifier blocks. The default posture is **https-only plus a private /
internal denylist**; anything not provably public-https is blocked:

- scheme must be `https:` (non-`http(s)` and plain `http:` are blocked);
- hosts denied: `localhost`, `127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`,
  `192.168.0.0/16`, `169.254.0.0/16` (link-local), `::1`, `fc00::/7` (`fc..`/`fd..` ULA), and
  `.local` / unqualified (dotless) hosts;
- any parse error fails closed (blocked).

A blocked origin is replaced by a dimensioned `data-ps-asset-unavailable="blocked-origin"`
placeholder, so the viewer's browser **never issues the GET** -- no tracking beacon fires and no
internal host is probed.

**Host override surface.** Two seams widen the conservative default, never relax it below
fail-closed:

- `assetOriginPolicy(url, ctx) => boolean` -- a host hook that **fails closed**: it blocks on a
  thrown error or any non-`true` return (it can never open a URL the classifier would allow only
  by throwing). This mirrors the capture-side `compileMaskSelector` fail-closed-and-loud
  precedent.
- `allowAssetOrigins` -- a convenience host allowlist; a listed host passes the gate even if the
  classifier would otherwise deny it.

**`mediaMode` switch (MSEC-02).** A `createViewer` config option selects the privacy / bandwidth
posture: `off` (no viewer asset fetch at all -- every asset becomes a placeholder), `poster`
(*target* posture: posters/placeholders only, full-asset fetch withheld -- see the Phase-12
interim note below), and `reference` (full by-reference fetch). The **default is `reference`** --
media-by-reference is on by default (the milestone's purpose) and the fail-closed origin policy is
the safety net. An invalid `mediaMode` throws at viewer-factory time (the sanctioned throw site).

> **Phase 12 interim semantics for `poster` (review WR-02 -- read before relying on `poster`).**
> The poster / full-asset split is a Phase 13 deliverable, gated on the `<video>` / `<audio>`
> element actually shipping. In Phase 12 `poster` therefore behaves **identically to `reference`
> for images**: every origin-permitted image (content image OR `<video>` poster) is allowed to
> fetch, gated only by the fail-closed origin policy -- there is no content-image-vs-poster
> distinction yet (the gate's `kind` parameter is threaded through but does not yet narrow
> `poster`). A host that needs *all* content-image fetches suppressed today must use `off`, not
> `poster`. The stricter "posters only, full-asset withheld" guarantee lands in Phase 13.

**Pre-write timing (the non-negotiable rule).** The gate runs **before** the asset URL is written
into the mirror DOM, so a blocked origin never reaches a fetch. For diffs this is pre-`setAttribute`
(ATTR) and pre-`importNode` (ADD / subtree, over inert template content). For the **snapshot** it
is gated at the **string / payload layer**, before the srcdoc is assembled (`gateSnapshotAssets`
in `src/renderer/snapshot.js`): a real browser's HTML parser begins fetching `<img src>` *during*
srcdoc parse, before the post-parse scrub can run, so a post-parse-only gate would let the initial
snapshot image GET fire for a blocked origin. This string-layer rewrite operates on the typed
asset values being emitted -- it is **not** the scrub-then-reparse mutation-XSS anti-pattern
(`payload.html` stays raw for everything else); the post-parse DOM gate remains as
defense-in-depth.

**Variant pinning (ASST-03).** When a mirrored element carries the clone-only `data-ps-currentsrc`
enrichment, the renderer sets the element's effective `src` to that value and neutralizes
`srcset` / `sizes`, so the cross-origin viewer (different DPR/viewport) loads the same asset the
origin displayed rather than re-negotiating a different variant.

**Unchanged sandbox / CSP (no widening).** Phase 12 adds **no** sandbox or CSP-script change. The
iframe sandbox remains exactly `allow-same-origin` (never `allow-scripts`; the asset code contains
no `allow-scripts` literal and the static scan stays green), and the srcdoc CSP is unchanged:
`default-src 'none'`, the existing `img-src http: https: data:` already covers every static image
surface (including `<video>` poster), there is **no `script-src`**, and there is **no `media-src`**
-- the scoped `media-src` directive is deferred to Phase 13 (when `<video>`/`<audio>` actually
needs it). Capture-side asset/media URL **masking** and `referrerpolicy` completion are Phase 15
(MSEC-03/MSEC-04); Phase 12 makes the fetch-gate decisions, not the masking.

## 7. Residual Risks

Snapshot `payload.html` remains string-raw at the srcdoc assembly layer by design. Scrubbing an
HTML string and then asking the browser to parse it again is the mutation-XSS failure mode. The
protection chain is instead capture `sanitizeForWire`, render post-parse `sanitizeFragment`, the
CSP meta, and the no-`allow-scripts` sandbox.

Novel CSS or markup parser vectors can still appear after this release. They are backstopped by
the CSP and sandbox, and strip counters/logs are the observability signal for sanitizer activity.

The dialog/overlay side-channel boundary is privacy-scoped. Dialog `detail.message`, prompt
`defaultValue`, overlay labels, and custom overlay payload text do not have a stable owner element
for selector-based masking. If page script copies sensitive content into a dialog or overlay string,
selector-based capture masking cannot identify it as belonging to a masked element. The viewer
renders these strings through `textContent`, so this residual is not markup injection; it is the
rrweb-parity privacy boundary tracked as T-03-26.

Closed shadow roots, cross-origin iframe content, and media stream pixels remain
non-captured content. PhantomStream does not bypass those browser boundaries.
CSSOM mode is stylesheet capture only; it does not capture protected browser
content or weaken the sanitizer, CSP, or sandbox constraints.
