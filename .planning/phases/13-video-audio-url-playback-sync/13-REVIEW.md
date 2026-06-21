---
phase: 13-video-audio-url-playback-sync
reviewed: 2026-06-20T00:00:00Z
depth: standard
files_reviewed: 20
files_reviewed_list:
  - src/protocol/constants.js
  - src/protocol/messages.js
  - src/protocol/media-reconcile.js
  - src/protocol/index.js
  - src/capture/index.js
  - src/renderer/snapshot.js
  - src/renderer/overlays.js
  - src/renderer/index.js
  - tests/media-reconcile.test.js
  - tests/protocol.test.js
  - tests/capture-media.test.js
  - tests/renderer-media.test.js
  - tests/renderer-media-csp.test.js
  - tests/differential/divergence-ledger.js
  - tests/differential/scenarios/media-playback-sync.js
  - tests/differential/fixtures/media-playback-sync.html
  - tests/renderer-snapshot.test.js
  - tests/security-chokepoint-purity.test.js
  - tests/semantic-addressing.test.js
  - tests/differential/oracle.test.js
findings:
  critical: 1
  warning: 4
  info: 3
  total: 8
status: issues_found
fix_status: in_scope_resolved
fix_iteration: 1
fixed_at: 2026-06-20T00:00:00Z
resolved_findings:
  - CR-01
  - WR-01
  - WR-02
  - WR-03
  - WR-04
deferred_findings:
  - IN-01
  - IN-02
  - IN-03
fix_commits:
  - { id: CR-01, hash: edd4945 }
  - { id: WR-01, hash: 69d109f }
  - { id: WR-02, hash: b8cfd15 }
  - { id: WR-03, hash: fc7015d }
  - { id: WR-04, hash: f91db12 }
---

# Phase 13: Code Review Report

**Reviewed:** 2026-06-20T00:00:00Z
**Depth:** standard
**Files Reviewed:** 20
**Status:** issues_found

## Summary

Phase 13 adds video/audio URL pass-through, a STRING-layer SSRF/fetch gate for
`<video src>`/`poster`/`<source src>`, a pure drift reconciler, a capture-side
media tracker, and a cross-realm renderer driver with three media affordances.
The work is high quality on most of the security-load-bearing surfaces I was
asked to scrutinize:

- The **pure reconciler** (`media-reconcile.js`) is genuinely NaN-proof across
  the hostile-input sweep, imports nothing, touches no element, and closes the
  `Infinity -> null` JSON trap via the `duration|live` split. Confirmed by both
  inspection and the exhaustive table test.
- The **string-layer media gate** correctly generalizes the quote-aware
  `<img>` scanner to `<video>`/`<source>`, fails closed on unbalanced
  quotes/backticks and unparseable srcset, and `CSP_META` gained
  `media-src http: https: data:` with NO `blob:`, retaining `default-src 'none'`
  and no `script-src`.
- The **sandbox** stays exactly `allow-same-origin` (asserted + verified at
  creation); the **capture tracker** sends only state (no media bytes), never
  mutates the page, omits `media[]` when empty (oracle byte-identity preserved),
  and tears down per-element listeners on stop/pause/removal.
- The **modified test pins** were loosened to match real new behavior, not to
  mask a regression: the CSP pin now asserts `media-src` present + `blob:`
  absent; the innerHTML allowlist 2->4 covers two static `MEDIA_GLYPH` SVG
  writes; `'click'` was de-listed from the remote-control guard because the
  affordance listeners are local-only. The oracle additions (D27 + empty-ledger
  negative test) strengthen coverage.

The one BLOCKER is a real **pre-parse timing gap in `mediaMode: 'poster'`**: the
string-layer gate is mode-blind, so an allowed-origin `<video src>`/`<source src>`
is NOT neutralized before srcdoc parse in poster mode. The browser prefetches
the media bytes during parse — exactly the GET poster mode promises to prevent —
because the only poster-mode source strip lives in the post-parse
`gateFragmentMedia`, which the module's own header documents as "too late." The
poster-mode test passes only because jsdom never prefetches.

## Critical Issues

### CR-01: `mediaMode: 'poster'` leaks the media GET it is designed to prevent (string-layer gate is mode-blind) [RESOLVED iter 1, commit edd4945]

**File:** `src/renderer/index.js:330-337` (gate closure), `src/renderer/index.js:1449-1452` (snapshot write), `src/renderer/snapshot.js:360-397` (`gateSnapshotAssets`)
**Issue:**
Poster mode's contract is stated verbatim in `src/renderer/index.js:425-428`:
"mediaMode 'poster': strip src and every child `<source src>` so NO media GET
issues while the gated poster is kept." It is enforced ONLY in
`gateFragmentMedia` (`src/renderer/index.js:432-474`), which runs on the
**post-parse** mirror body inside the iframe `load` listener.

But `src/renderer/snapshot.js:43-51` and `:269-285` are explicit that the
authoritative control MUST run at the STRING layer because "a real browser's
parser begins fetching `<video src>` DURING srcdoc parse, before the iframe's
post-parse load scrub can run." The string-layer call is
`gateSnapshotAssets(p.html, gateAsset)` (`index.js:1450`), and `gateAsset`
(`index.js:330-337`) forwards to `gateAssetUrl`, whose precedence (step 5,
`index.js:149-151`) returns `{ allow: true }` for ANY allowed-origin URL in BOTH
`poster` and `reference` mode — it never blocks media in poster mode. So in
poster mode the `<video src>`/`<source src>` survives the string layer untouched
and the browser issues the media GET during parse. The post-parse strip then
removes the attribute, but the byte fetch has already started.

Reproduced (the per-viewer poster-mode gate, wired as `createViewer` wires it):
```
input : <video src="https://cdn.example.com/clip.mp4"><source src="https://cdn.example.com/clip.webm"></video>
gateSnapshotAssets output (poster mode):
        <video src="https://cdn.example.com/clip.mp4"><source src="https://cdn.example.com/clip.webm"></video>
        -> contains clip.mp4: true   (browser prefetches)
        -> contains clip.webm: true  (browser prefetches)
```

Impact: the by-reference fetch control is partially defeated for poster mode — a
mirrored attacker page gets the viewer's (possibly privileged) browser to issue
media GETs the host opted out of, plus the bandwidth/tracking surface poster
mode exists to suppress. The renderer-media test "mediaMode poster: handleMedia
binds no source..." (`tests/renderer-media.test.js:490-509`) passes vacuously
because jsdom never prefetches; it asserts only that `handleMedia` does not
drive playback, never that the `src` was neutralized pre-parse.

**Fix:** Make the string-layer gate poster-aware so media `src`/`source src`
(and, in poster mode, the playable source generally) are neutralized BEFORE
srcdoc assembly, mirroring how `gateFragmentMedia` strips post-parse. Two
workable shapes:

1. Pass the mode into the gate and block media there in poster mode. In
   `gateAssetUrl`, before step 5:
```js
// mediaMode 'poster': no playable media source may fetch (poster image only).
if (mode === 'poster' && (c.kind === 'media' || c.kind === 'source')) {
  return { allow: false, reason: 'poster-mode-media' };
}
```
   and have `gateOneMediaTag` pass a distinct kind for `<source>` (it currently
   passes `'media'` for both, `snapshot.js:295`), and ensure `<video>` `src`
   gates as `'media'`. The existing placeholder fail-closed path then neutralizes
   the tag at the string layer.

2. Alternatively, in `handleSnapshot`, when `mediaMode === 'poster'`, run a
   string-layer strip of `<video src>`/`<source src>` in addition to
   `gateSnapshotAssets` so no playable source reaches the parser.

Add a STRING-output assertion to the poster-mode test (assert
`gateSnapshotAssets(html, posterGate)` no longer contains the media URL) so the
gap cannot silently reopen.

## Warnings

### WR-01: Skipped (host-UI) `<video>`/`<audio>` are still media-tracked and emit STREAM.MEDIA [RESOLVED iter 1, commit 69d109f]

**File:** `src/capture/index.js:4599-4605` (`collectTrackedMediaElements`), `:4677-4714` (`attachMediaListeners`), `:4742-4749` (`attachMediaListenersUnder`)
**Issue:**
`collectTrackedMediaElements` does `document.querySelectorAll('video, audio')`
with NO `skipElementWithAncestors`/`blockedWithAncestors`/`wireDroppedWithAncestors`
filtering, and neither `attachMediaListeners` nor `attachMediaListenersUnder`
consult the skip/block predicates. A `<video>`/`<audio>` inside the host's own
viewer UI (the exact thing `skipElement` exists to exclude — e.g. a same-page
loopback mirror) is therefore tracked and emits STREAM.MEDIA. `sendMediaState`
mints a fresh nid via `ensureNodeId(el)` for an element that was never
serialized, so the renderer's `resolveIndexedNode(nid)` returns null and
`handleMedia` no-ops — no crash — but the wire carries useless STREAM.MEDIA
frames, and it leaks that a deliberately-excluded media element is playing
(play/pause/seek timeline of host-UI media). This diverges from the value
tracker, which DOES gate on the skip/block predicates (`buildValueDiff`,
`:1872-1884`).
**Fix:** Filter `collectTrackedMediaElements` and `attachMediaListenersUnder`
through the same exclusion predicates the value tracker uses, e.g.:
```js
if (skipElementWithAncestors(el) || blockedWithAncestors(el) || wireDroppedWithAncestors(el)) return; // in attachMediaListeners
```
and skip excluded nodes in `collectTrackedMediaElements`.

### WR-02: Truncated snapshot can ship a `media[]` baseline whose nids are no longer in the payload [RESOLVED iter 1, commit b8cfd15]

**File:** `src/capture/index.js:2753-2844` (`fitSnapshotPayloadForBudget`), `:3733-3736` (media append)
**Issue:**
`media[]` is appended to the snapshot (`:3735`) and then passed through
`fitSnapshotPayloadForBudget`. The budget loop copies `media` by reference
(`Object.assign({}, payload, {...})`, `:2754`) but never prunes it. When the DOM
truncation loop drops a `<video>` subtree from the clone (`:2811-2824`),
`next.html`/`next.nodeIds`/`shadowRoots`/`frames` are re-derived but `next.media`
is left intact — so it can reference a nid no longer present in `nodeIds`. Worse,
the final over-cap hard reset (`:2826-2842`) empties `html`, `nodeIds`,
`shadowRoots`, `frames`, `inlineStyles`, `stylesheets`, `styleSources`, attrs,
styles, `title`, `url` — but does NOT clear `media`, so an emptied snapshot can
still carry a non-empty `media[]`. The renderer's `applyMediaBaseline` no-ops on
unresolvable nids (`index.js:1795-1796`), so this is not a crash or data loss,
but it is an internal inconsistency: a baseline that addresses nodes the snapshot
no longer contains, and dead bytes counted against the cap.
**Fix:** In `fitSnapshotPayloadForBudget`, after re-deriving `nodeIds` on
truncation and in the hard-reset block, prune `next.media` to entries whose nid
is still in `next.nodeIds` (and clear it entirely in the hard reset):
```js
if (Array.isArray(next.media)) {
  var live = new Set(next.nodeIds);
  next.media = next.media.filter(function (m) { return m && live.has(String(m.nid)); });
}
```

### WR-03: Blocked `<video>` placeholder orphans the `</video>` close tag and trailing children [RESOLVED iter 1, commit fc7015d]

**File:** `src/renderer/snapshot.js:286-311` (`gateOneMediaTag`), `:360-397` (`gateSnapshotAssets`)
**Issue:**
When a `<video src=blocked ...>` is neutralized, `gateOneMediaTag` returns
`assetUnavailablePlaceholderTag(attrs)` — a self-contained `<div ...></div>` —
and the scan resumes just past the original `<video>` start tag's `>`
(`gateSnapshotAssets:393`). The inner `<source>`/`<track>` children and the
`</video>` end tag are left in the stream, producing
`<div data-ps-asset-unavailable></div>...<source ...></video>` with an orphaned
`</video>`. This is structurally malformed markup (the `</video>` has no opener)
and leaves leftover child elements after the placeholder. It is NOT a fetch
bypass — each child `<source>` is independently gated, and the placeholder is
inert — so this is a fidelity/correctness defect, not a security hole, but the
mirror DOM diverges from intent (the comment at `:278-280` acknowledges the
placeholder sits "inside a `<video>`" but the open `<video>` is exactly what was
replaced). Under the post-parse importNode this generally normalizes, but the
orphaned close tag is sloppy and can confuse positional nid pairing.
**Fix:** When the `<video>` tag itself is neutralized, consume through the
matching `</video>` (and its children) so the placeholder fully replaces the
element, rather than only swapping the start tag. Alternatively, document that
the placeholder intentionally leaves children to be independently gated and the
orphaned `</video>` is parser-tolerated — but consuming to `</video>` is the
clean fix.

### WR-04: `semantic-addressing` wire-forwarding guard is a weak proximity heuristic [RESOLVED iter 1, commit f91db12]

**File:** `tests/semantic-addressing.test.js:264-268`
**Issue:**
After de-listing `'click'` from the forbidden-listener set (correct — the
affordance listeners are local-only), the compensating guard is
`/addEventListener\([^)]*\)[\s\S]{0,400}?(?:transport\.send|safeSend)\s*\(/`.
This is brittle: `[^)]*` terminates at the first `)`, and a fixed 400-char window
after a listener is an arbitrary lexical distance, not a real call-graph check.
A future edit that wires a DOM listener to a wire send more than 400 chars away
(or through an indirection like `function f(){ safeSend(...) }` called from the
handler) would pass this guard silently. The actual safety today rests on
`wireActivation` invoking only the local `onActivate` (`overlays.js:554-563`),
which I confirmed by inspection — so the shipped code is safe — but the guard
gives weaker assurance than its comment implies.
**Fix:** Strengthen the assertion intent — e.g. assert that `overlays.js`
contains no `transport`/`safeSend`/`.send(` token at all (the overlay module has
no transport reference by design), and keep the proximity regex only as a
secondary check. That pins the structural invariant ("the overlay module cannot
reach the wire") rather than a fragile textual distance.

## Info

### IN-01: `gateOneMediaTag` computes an identical kind for both branches of a ternary

**File:** `src/renderer/snapshot.js:295`
**Issue:** `gate(src, tagName === 'source' ? 'media' : 'media')` — both ternary
arms are the string `'media'`, so the conditional is dead. It reads as if a
`<source>` were meant to gate under a distinct kind. This is harmless today but
is exactly the seam CR-01's fix needs (a distinct `'source'` kind), so the dead
ternary is a latent confusion.
**Fix:** Either collapse to `gate(src, 'media')`, or (preferably, alongside
CR-01) make it `gate(src, tagName === 'source' ? 'source' : 'media')` and handle
the `'source'` kind in `gateAssetUrl`.

### IN-02: `mediaReconcileConfig` default aliases the exported mutable `DEFAULT_MEDIA_RECONCILE_CONFIG`

**File:** `src/renderer/index.js:324-326`; `src/protocol/media-reconcile.js:30-35`
**Issue:** When no `cfg.mediaReconcileConfig` is supplied, the viewer holds a
direct reference to the exported `var DEFAULT_MEDIA_RECONCILE_CONFIG` object
(not a copy). The reconciler's `mergeConfig` only reads fields and never mutates,
so there is no live bug. But the default config is a mutable module-level export
(`export var`), so any consumer that mutated it would affect every viewer using
the default. Defense-in-depth would freeze or clone it.
**Fix:** `export var DEFAULT_MEDIA_RECONCILE_CONFIG = Object.freeze({...})`, or
default to a shallow clone in the viewer.

### IN-03: `gateFragmentMedia` re-queries `<source>` already walked under video/audio

**File:** `src/renderer/index.js:448-473`
**Issue:** The function walks `video, audio` and for each iterates its child
`<source>` (`:448-455`), then separately walks ALL `source` in the root
(`:464-473`). Child `<source>` elements are therefore processed twice
(`removeAttribute('src')` is idempotent, so no functional bug). Minor redundant
work; the comment at `:462-463` ("Standalone `<source>` ... not under a
video/audio we already walked") describes intent but the loop does not actually
exclude the already-walked ones.
**Fix:** Track visited `<source>` nodes (a `Set`) or scope the loose-source
query to sources without a media ancestor; purely a tidiness improvement.

---

_Reviewed: 2026-06-20T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
