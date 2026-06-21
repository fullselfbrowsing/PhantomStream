---
phase: 14-adaptive-streaming-adapter-discovery-fallback
reviewed: 2026-06-21T00:00:00Z
depth: standard
files_reviewed: 19
files_reviewed_list:
  - src/renderer/media-player.js
  - src/renderer/index.js
  - src/renderer/overlays.js
  - src/renderer/snapshot.js
  - src/protocol/messages.js
  - src/adapters/playwright.js
  - src/adapters/extension.js
  - package.json
  - scripts/package-smoke.mjs
  - tests/renderer-media-player.test.js
  - tests/media-hint-filter.test.js
  - tests/renderer-media.test.js
  - tests/renderer-media-csp.test.js
  - tests/playwright-adapter.test.js
  - tests/extension-adapter.test.js
  - tests/protocol.test.js
  - tests/package-publish.test.js
  - tests/renderer-snapshot.test.js
  - tests/media-reconcile.test.js
findings:
  critical: 0
  warning: 5
  info: 6
  total: 11
status: issues_found
---

# Phase 14: Code Review Report

**Reviewed:** 2026-06-21T00:00:00Z
**Depth:** standard
**Files Reviewed:** 19
**Status:** issues_found

## Summary

Phase 14 adds the parent-realm adaptive media player (`media-player.js`), the
`STREAM.MEDIA_HINT` op + `MediaHintPayload` typedef, opt-in adapter manifest
discovery (Playwright + extension), one `blob:`-to-`media-src` CSP edit, and the
`media-unavailable` degrade overlay. I verified the load-bearing security
surfaces named in the brief and they hold:

- **Sandbox stays exactly `allow-same-origin`** — asserted at creation
  (index.js:540-544) and pinned by test (renderer-media.test.js:750-759). No
  player code runs in the iframe.
- **CSP edit is correct and minimal** — `blob:` added to `media-src` ONLY; no
  `script-src`, no `connect-src`, `default-src 'none'` retained, `img-src`
  unchanged (snapshot.js:551-557). Test pins are correct contract updates, NOT
  loosened masks (renderer-snapshot.test.js:58-115, renderer-media-csp.test.js).
- **Manifest re-gating (SSRF)** — `handleMediaHint` re-gates `manifestUrl`
  through the same fail-closed `gateAsset` before any bind/fetch
  (index.js:1952-1956); blocked → `degrade('no-manifest')`, never fetched
  (covered by renderer-media.test.js:892-915).
- **Never-break contract** — `attach()` is fully try/catch-contained to a single
  `degrade()` sink that never rethrows (media-player.js:294-342); `emeEnabled`
  is never set true; `encrypted` + `KEY_SYSTEM_ERROR` route to `degrade('drm')`.
- **Zero-hard-dep** — hls.js is an optional `peerDependency`, loaded only via
  dynamic `import('hls.js')` (media-player.js:91-98); `dependencies` stays
  `{ ws }`; `package-smoke.mjs` proves the `./renderer` import works with hls.js
  absent.
- **Backward-compat** — envelope/relay untouched; old viewers ignore
  `STREAM.MEDIA_HINT` via the dispatch default; hint originates in the adapter,
  not capture (no new differential-oracle entry).
- **`media-unavailable` overlay** uses `textContent` only; reason rides a
  `setAttribute` data-attribute, never payload-derived innerHTML
  (overlays.js:712-738; hostile-input test renderer-media.test.js:241-260).

All 87 Phase-14 media/adapter/CSP tests pass. No BLOCKER-class defect found: the
security invariants are intact and the degrade sink is robust. The findings below
are robustness gaps, a cross-frame scope-confusion surface mitigated only by the
origin gate, a stale-identity bypass window, and documentation/contract drift.

## Warnings

### WR-01: Playwright manifest observer accepts responses from ANY frame (cross-frame manifest injection, mitigated only by the origin gate)

**File:** `src/adapters/playwright.js:243-260`
**Issue:** `handleManifestResponse` reads `response.url()` and
`response.headers()` but never checks the initiating frame. Every other
viewer-influencing path in this adapter gates on the main frame —
`bindingCallback` explicitly rejects sub-frame messages via
`isMainFrame(caller.frame)` (lines 202-204). A manifest response from a
cross-origin sub-frame (e.g. an ad iframe, or any third-party `<iframe>` on the
driven page) is observed here and emitted as a **page-scope** hint, which the
viewer then binds to the first MSE-opaque **main-frame** media element
(`maybeConsumePageHint`, index.js:1883-1899). An attacker who controls a
sub-frame can therefore steer which manifest the top page's player loads. The
viewer's `gateAsset` re-gate is the only thing standing between this and a
fetch/bind of an attacker-chosen origin; it blocks private/non-https origins but
permits any public-https manifest the sub-frame names. The synthetic test helper
even exposes `request().frame()` (playwright-adapter.test.js:501-509) but no test
exercises a sub-frame response, so the gap is unguarded.
**Fix:** Gate the observer on the main frame, mirroring `bindingCallback`:
```js
function handleManifestResponse(response) {
  if (disposed || !discoverManifests) return;
  try {
    if (!response || typeof response.url !== 'function') return;
    // Main-frame-only, parity with bindingCallback's isMainFrame check.
    var frame = null;
    try { frame = response.request && response.request().frame && response.request().frame(); }
    catch (e) { frame = null; }
    if (frame && !isMainFrame(frame)) return;
    var url = response.url();
    // ... unchanged ...
  } catch (err) { /* contained */ }
}
```
The CDP path (`handleCDPResponseReceived`, lines 264-278) has the same gap and
should apply the analogous `frameId`/main-frame check where the CDP event
exposes it.

### WR-02: Extension manifest observer scopes `chrome.webRequest` to `<all_urls>` with no tab/initiator restriction

**File:** `src/adapters/extension.js:386-394`
**Issue:** When discovery is opted in, the listener is registered with
`{ urls: ['<all_urls>'] }` and no `tabId`/`windowId` filter. Every completed
response across **every tab in the browser** (not just the streamed tab) is fed
to `handleManifestCompleted` → `emitMediaHint`. The session state already tracks
the streamed `tabId` (`sessionState.tabId`), so a manifest fetched by an
unrelated background tab can produce a page-scope hint stamped with the streamed
session's identity and bound to the streamed page's media element. As with WR-01,
the viewer re-gate is the only mitigation; the addressing is wrong by
construction.
**Fix:** Restrict the filter to the streamed tab when known, and drop details
whose `details.tabId` does not match:
```js
chrome.webRequest.onCompleted.addListener(
  manifestListener,
  { urls: ['<all_urls>'], tabId: (sessionState && sessionState.tabId) || undefined },
  ['responseHeaders']
);
// and in handleManifestCompleted, after the url guard:
if (sessionState && sessionState.tabId != null
    && typeof details.tabId === 'number'
    && details.tabId !== sessionState.tabId) return;
```
(The watchdog re-arms the observer per session; re-register the filter when the
streamed tab id becomes known if it was absent at install time.)

### WR-03: Empty-identity media hint bypasses the staleness guard during the pre-snapshot window

**File:** `src/adapters/playwright.js:280-305`, `src/adapters/extension.js:347-372`, `src/protocol/messages.js:338-348`
**Issue:** Both adapters initialize `currentIdentity = { streamSessionId: '',
snapshotId: 0 }` and only update it once they snoop an identity-bearing STREAM
frame (observeStreamIdentity). A network `response`/`onCompleted` event can fire
**before** any identity-stamped snapshot is relayed (manifest fetches are
independent of bridge snapshot timing). In that window the hint ships with empty
identity, and the viewer's `isCurrentStream` returns `true` for any empty-identity
message (the backward-compat clause, messages.js:339-343). `handleMediaHint`
therefore accepts it (index.js:1942). A page-scope empty-identity hint is stored
in `pendingHints` and — if no new snapshot clears it first — can be consumed by an
element in a stream generation it was never meant for. The SSRF re-gate still
applies, so this is a correlation/identity-integrity weakness, not an injection.
The comments call this out as intentional ("accepts a hint with empty identity
until a real stream identity has been observed"), but the safer posture is to not
emit a hint until an identity exists.
**Fix:** Suppress hint emission until a real identity has been observed, so a hint
can never out-race the snapshot that defines its generation:
```js
function emitMediaHint(manifestUrl, kind, contentType) {
  // Do not emit before an identity-stamped frame has been snooped: an
  // empty-identity hint bypasses the viewer staleness guard.
  if (!currentIdentity.streamSessionId) return;
  // ... unchanged ...
}
```

### WR-04: `attachViaLazyHls` registers the DRM `encrypted` listener but the per-nid `destroy` cannot remove it, so a late `encrypted` event re-degrades a torn-down element

**File:** `src/renderer/media-player.js:236-261, 177-190`
**Issue:** The lazy-hls branch attaches a `{ once: true }` `encrypted` listener to
`videoEl` (line 248). `destroy(nid)` (lines 177-190) tears down the hls instance
and resets the element (`removeAttribute('src') + load()`) but never removes that
listener (it is an anonymous closure, so it cannot). After a `degrade` for an
unrelated reason (e.g. a fatal non-DRM error → `mse-opaque`, which calls
`destroy` and `registry.delete(nid)`), the `encrypted` listener remains armed on
the still-live child element. If the browser later fires `encrypted` (e.g. the
element is re-bound by a subsequent hint, or residual decode activity emits it),
the handler calls `degrade(ctx.nid, 'drm')` against a nid that is no longer in the
registry — re-showing the `media-unavailable` overlay and re-invoking
`onMediaUnavailable('drm')` for an element the player no longer owns. The
`{ once: true }` flag bounds it to a single spurious fire, but it is a real
post-teardown side effect on a contract that promises clean per-nid teardown.
**Fix:** Capture the listener and remove it in the player's `destroy` closure, so
teardown is complete:
```js
var onEncrypted = function () { degrade(ctx.nid, 'drm'); };
videoEl.addEventListener('encrypted', onEncrypted, { once: true });
// ...
var player = { destroy: function () {
  try { videoEl.removeEventListener('encrypted', onEncrypted); } catch (e) {}
  try { hls.destroy(); } catch (e) { /* contained */ }
} };
```

### WR-05: Element-scope hint to a non-opaque or stale element is silently dropped with no degrade and no diagnostic

**File:** `src/renderer/index.js:1959-1970`
**Issue:** In `handleMediaHint`, an `element`-scope hint binds only when the
element resolves AND is MSE-opaque (line 1964). Every other element-scope
outcome — the nid does not resolve (stale/wrong generation), or the element
resolves but already has a playable source — falls through to `markLive('media')`
and returns with **no degrade overlay and no logger line**. A host that wired
`onMediaUnavailable` for observability receives nothing, and the viewer shows no
`media-unavailable` affordance even though the named element will never get its
adaptive stream. This diverges from the page-scope path (which at least retains
the hint) and from the gate-blocked path (which degrades visibly). A stale
element-scope nid is indistinguishable from "successfully handled."
**Fix:** Degrade visibly when an element-scope hint cannot bind to a resolvable
opaque element, so the failure is observable:
```js
if (scope === 'element' && nid != null) {
  var el = resolveIndexedNode(nid);
  if (el && typeof el.play === 'function' && mediaElementHasNoSource(el)) {
    hintBoundNids.add(String(nid));
    bindAdaptiveHint(el, nid, manifestUrl, kind, p.contentType);
  } else if (!el) {
    // Stale/wrong-generation nid: surface it instead of silently dropping.
    mediaPlayer.degrade(String(nid), 'no-manifest');
  }
  // (a resolved-but-sourced element is intentionally left to the progressive path)
  markLive('media');
  return;
}
```

## Info

### IN-01: `media-player.js` header claims object URLs are "revoked on destroy/destroyAll" but the module never calls `revokeObjectURL`

**File:** `src/renderer/media-player.js:34-36`
**Issue:** The module header and the phase brief state object URLs are revoked on
teardown to prevent a leak across snapshots. The module never calls
`revokeObjectURL` anywhere (confirmed: zero matches in `src/renderer/`). In
practice the leak is avoided because the **lazy-hls** path lets hls.js mint and
own the object URL, and `hls.destroy()` revokes it internally; the **native**
path sets `videoEl.src = manifestUrl` (a plain URL, not a blob); and the **host
playerFactory** path delegates revocation to the adapter's `destroy()`. So the
no-leak property depends entirely on the host adapter honoring its `destroy()`
contract — it is NOT enforced by this module. The comment overstates what the
code does.
**Fix:** Reword the header to attribute revocation to its actual owners
(hls.js `destroy()` / the host adapter's `destroy()`), or, if the player ever
mints its own object URL in a future path, track and revoke it in `destroy`.

### IN-02: `degrade('no-manifest')` reason is overloaded for both blocked-origin and stale-nid causes

**File:** `src/renderer/index.js:1953`, `src/renderer/media-player.js:206`
**Issue:** The four reason codes are documented as `no-manifest | no-player |
mse-opaque | drm`. `no-manifest` is emitted both for a gate-blocked manifest
origin (index.js:1953) and for an unclassifiable manifest (media-player.js:337),
and WR-05's suggested fix would add a third cause (stale nid). A host hook that
keys telemetry/UX off the reason cannot distinguish "blocked by policy" from
"could not classify" from "element gone." Not a bug, but the reason vocabulary is
lossy for the degrade callback's stated purpose.
**Fix:** Consider a distinct reason for the gate-blocked case (e.g.
`blocked-origin`) so hosts can tell a policy denial from a classification miss;
or document explicitly that `no-manifest` aggregates these causes.

### IN-03: `maybeConsumePageHint` deletes by `chosen.kind` which can orphan a same-kind hint after most-recent-wins selection

**File:** `src/renderer/index.js:1891-1898`
**Issue:** `pendingHints` is a `Map` keyed by kind (`'hls'`/`'dash'`), so it holds
at most one hint per kind. The consume loop picks the most-recent across kinds,
then `pendingHints.delete(chosen.kind)`. This is correct for the current keying,
but the loop iterates with `>=` (line 1893) which makes the LAST-iterated hint win
on a storedAt tie rather than a deterministic kind preference; the comment claims
it prefers `'hls'` ("the optional lazy path needs no host player") but the code
does not implement that preference — it is pure recency with a tie going to Map
iteration order. Behavior is benign (either kind is playable) but the code and
comment disagree.
**Fix:** Either implement the documented `'hls'`-first preference explicitly, or
update the comment to state it is most-recent-wins with ties broken by insertion
order.

### IN-04: `findMatchingCloseTag` recompiles two `RegExp` objects on every loop iteration

**File:** `src/renderer/snapshot.js:134-163`
**Issue:** `new RegExp(...)` for `openRe`/`closeRe` is hoisted out of the loop
(good), but `nextAssetOpener` (lines 506-522) reuses three module-level regexes by
resetting `lastIndex` per call across a cursor-driven outer loop — a correct but
subtle stateful-regex pattern that is easy to break under future edits. This is
flagged only as a maintainability note: the shared-mutable-`lastIndex` regexes
(`IMG_OPEN_RE`, `VIDEO_OPEN_RE`, `SOURCE_OPEN_RE`) are module singletons, so any
re-entrant or concurrent call would corrupt the scan. Single-threaded JS makes
this safe today.
**Fix:** No change required; if the scanner is ever called re-entrantly, switch to
locally-constructed regexes or capture `lastIndex` explicitly.

### IN-05: `bindAdaptiveHint` passes a possibly-`null` `kind` into `attach`, relying on re-classification

**File:** `src/renderer/index.js:1914-1922, 1957`
**Issue:** `handleMediaHint` computes `kind = (p.kind === 'hls' || p.kind ===
'dash') ? p.kind : null` (line 1957) and forwards it to `bindAdaptiveHint` →
`attach(el, url, { nid, kind: null, contentType })`. Inside `attach`, the player
re-derives kind via `classifyManifest({ url, contentType })` (media-player.js:302),
so the forwarded `null` is harmless — `ctx.kind` is only used to stamp the factory
registry entry. But for the page-scope store path, `pendingHints.set(kind ||
'hls', ...)` (index.js:1973) coerces a null kind to `'hls'`, which could
mis-bucket a DASH manifest whose `p.kind` was absent but whose URL/content-type is
`.mpd`. The player re-classifies correctly at attach time, so the final routing is
right; only the `pendingHints` bucket label is potentially wrong (cosmetic for a
single-hint-per-kind map).
**Fix:** Derive the storage key from `classifyManifest` rather than the raw
`p.kind` when `p.kind` is absent, so the bucket label matches the manifest:
`var storeKind = kind || classifyManifest({ url: manifestUrl, contentType: p.contentType }) || 'hls';`

### IN-06: Modified test pins (`renderer-snapshot`, `media-reconcile`) are correct — recorded for traceability

**File:** `tests/renderer-snapshot.test.js:58-115`, `tests/media-reconcile.test.js:206-221`
**Issue:** Per the brief, these two pins were sanity-checked for masking a
regression. They do NOT. `renderer-snapshot.test.js` only updated the
`CSP_CONTENT` constant to include `blob:` in `media-src` (matching the source
edit) and added assertions that `blob:` is scoped to `media-src` and absent from
`img-src`/`connect-src`/`script-src` — a tightened contract, not a loosened one.
`media-reconcile.test.js` is purely additive (+17 lines, 0 deletions): one new
MADPT-04 "verbatim reuse" test asserting a `live:true` payload returns
`rejoin-edge` with NO absolute `toTime`. Both correctly track the new contract.
**Fix:** None — informational confirmation.

---

_Reviewed: 2026-06-21T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
