# Phase 13: Video/Audio URL + Playback Sync - Context

**Gathered:** 2026-06-20
**Status:** Ready for planning

<domain>
## Phase Boundary

Deliver the defining v2.0 capability: progressive/direct `<video>` (mp4/webm) and
`<audio>` (mp3/ogg) play **in the viewer**, loading bytes from the source URL (never
through the relay), driven **cross-realm from the parent realm** (no player code in the
no-`allow-scripts` sandbox). Initial media state is captured as a snapshot baseline;
play/pause/seek/ratechange stream over a **new throttled `STREAM.MEDIA` side channel**
(a structural twin of the scroll channel) and apply with drift-corrected interpolation.
The drift reconciler is a pure, configurable, jsdom-unit-testable function. The viewer
honors autoplay policy so the mirror never wedges. Requirements: MEDIA-01..05,
MWIRE-01, MWIRE-02.

In scope: the `STREAM.MEDIA` op + payload; capture-side media-state baseline + event/
heartbeat emission; the pure drift reconciler; renderer-side parent-driven playback
(`.play()/.pause()/.currentTime=`); `media-src` CSP add (gated by the existing Phase 12
origin policy); autoplay-policy handling + a "blocked play" affordance; the
`mediaMode` poster/reference playback split.

Out of scope (later phases): adaptive HLS/DASH manifest discovery + the parent-realm
MSE player (Phase 14); asset/media URL **masking vocabulary** (MSEC-03) and
`referrerpolicy` completion + the parent-realm threat model (MSEC-04) (Phase 15). The
relay and envelope are **untouched** this phase. `media-src` does **not** include
`blob:` here — that is Phase 14's MSE concern.

</domain>

<decisions>
## Implementation Decisions

### Wire Protocol — `STREAM.MEDIA` op (MWIRE-01)
- **Cadence = hybrid.** Discrete transition events (play, pause, seeked, ratechange,
  ended) **flush immediately** (coalesced); a periodic heartbeat is throttled at a new
  `MEDIA_SYNC_THROTTLE_MS` (default **250 ms**) and only while playing. The channel is
  throttled (honors "throttled media-sync channel"), but discrete transitions are not
  delayed by the throttle window. Hard-seek is decided by the reconciler, never
  per-message.
- **Latency compensation = include a capture timestamp.** The payload carries a
  capture-side `sentAt` (monotonic ms) so the reconciler can predict the expected
  position `pos = currentTime + playbackRate·(now − sentAt)` while playing. This is the
  reconciler's latency-compensation input (kept inside `remoteState`, so the reconciler
  stays pure).
- **Granularity = one message per media element per tick** (scroll-like simplicity;
  pages rarely have more than one actively-playing element). nid-addressed and
  identity-stamped (`streamSessionId`, `snapshotId`) exactly like scroll/overlay.
- **Backward-compat is explicitly tested.** Add a test asserting a viewer whose dispatch
  has no `STREAM.MEDIA` case **silently ignores** the message (forward-compat default),
  and that the envelope + relay are unchanged (raw passthrough, 1 MiB cap intact). Old
  FSB viewers must keep working.

### Capture Baseline & Triggers (MEDIA-02, MEDIA-04)
- **Baseline lives in a dedicated `media[]` array in the snapshot payload** — each entry
  `{ nid, currentTime, paused, muted, volume, playbackRate, loop, duration|live, ended }`
  — **not** serialized into the HTML. This mirrors the existing `DIFF_OP.VALUE`
  precedent (live property state travels as side-channel data keyed by nid, never baked
  into the serialized clone), and preserves the Phase 7 "capture does not mutate the
  page" invariant + the differential oracle's byte-identity for the HTML.
- **Emission triggers:** `play, pause, seeked, ratechange, ended, volumechange,
  loadedmetadata` sent immediately; plus a **throttled `timeupdate` heartbeat while
  playing** for drift correction. `seeking`/`progress` are not sent (interim/noise).
- **Observed elements = all `<video>` and `<audio>`**, including mutation-added ones
  (listeners attached on stream start and on added nodes; detached on stop/removal),
  consistent with how the capture core already tracks added nodes.
- **Live/Infinity-duration encoding:** at capture, derive `live = !isFinite(duration)`;
  send `duration` only when finite and send `live: true` for streams. This avoids the
  JSON `Infinity → null` trap and lets the reconciler take its live branch with no
  `NaN`. (`audio` uses the identical URL + state model as video — MEDIA-04.)

### Drift Reconciler Defaults (MEDIA-03, MWIRE-02)
- **Pure, configurable function** `reconcileMediaDrift(localState, remoteState, now, config)
  → action` (action ∈ hold | nudge | seek | rejoin-edge), unit-tested in jsdom with no
  real media timeline. All thresholds are config fields with documented defaults so they
  can be tuned against the v2.1 evaluation harness (per STATE.md Phase 13 concern).
- **In-tolerance hold band = 0.25 s** (default). Within this, hold — no correction.
- **Small persistent drift → rate-nudge** (±≤5% temporary `playbackRate` adjustment) to
  converge smoothly when drift is in the (0.25 s, 1.0 s) band. Nudge is bounded and
  reverts to the true rate once back in-band.
- **Hard-seek threshold:** seek when drift > 1.0 s during playback, OR on any explicit
  remote seek event, OR on loop wrap. (Rate-nudge gets first chance below 1.0 s; explicit
  seeks always hard-seek.)
- **Live streams** (`live: true` / non-finite duration): **never absolute-seek**; rejoin
  the live edge (`seekable.end`) only on large drift ("rejoin-edge"). `Infinity` duration
  yields no `NaN` anywhere in the reconciler.

### Viewer Playback UX, Autoplay & mediaMode (MEDIA-01, MEDIA-05)
- **Muted-autoplay default.** The viewer mirrors the source's playing state but starts
  media **muted** to satisfy browser autoplay policy; if the source is unmuted, surface
  an unmute affordance. Bytes load from the source URL; playback is **driven entirely
  from the parent realm** calling methods on the in-iframe element (`resolveIndexedNode`
  → `.play()/.pause()/.currentTime=`), so no player code runs in the no-`allow-scripts`
  sandbox.
- **`play()` rejection → observable affordance.** When the `play()` promise rejects
  (autoplay blocked), show an observable host-overlay "click to play" affordance over the
  element and invoke an `onMediaBlocked(nid)` host callback. The mirror never wedges on a
  blocked play.
- **`media-src` CSP add.** Add `media-src http: https: data:` to `CSP_META` in
  `src/renderer/snapshot.js` (twin of the existing `img-src`), with media src/poster/
  `<source>` URLs run through the **same string-layer `gateAssetUrl` / origin policy**
  established in Phase 12. **No `blob:`** in `media-src` this phase (that is Phase 14's
  MSE concern). Keep `default-src 'none'` and no `script-src`.
- **`mediaMode` completes the Phase 12 split:** `off` = no media element fetch at all;
  `poster` = poster image only, **no playback** (autoplay disabled, source not bound);
  `reference` = full playback. This matures the "poster/full-asset split" the Phase 12
  CONTEXT explicitly deferred to Phase 13.

### Claude's Discretion
- Exact op constant value (`STREAM.MEDIA`), payload field naming, and the
  `MEDIA_SYNC_THROTTLE_MS` constant placement — follow existing `STREAM.SCROLL` /
  `SCROLL_THROTTLE_MS` conventions in `src/protocol/messages.js` and `constants.js`.
- Internal naming of the reconciler config object and helpers; whether the reconciler
  lives in `src/protocol/` (pure, shared) or a new `src/renderer/` module — prefer
  wherever keeps it pure and directly jsdom-unit-testable.
- The precise markup/styling of the "click to play" affordance, consistent with the
  existing renderer overlay conventions.
- Whether media-state capture needs a differential-oracle ledger entry (extracted-only
  media ops vs the FSB reference) and the new scenario fixture name — add one if the
  oracle would otherwise hard-fail.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- **Scroll channel (the twin)** — `src/capture/index.js` `startScrollTracker()` (~4515)
  throttles via `now - lastScrollSend >= SCROLL_THROTTLE_MS` and sends
  `STREAM.SCROLL, { scrollX, scrollY, streamSessionId, snapshotId }`. Constant
  `SCROLL_THROTTLE_MS = 200` (`src/protocol/constants.js:30`). Renderer
  `handleScroll(payload)` (`src/renderer/index.js:~1459`) staleness-guards with
  `isCurrentStream(payload, active)` then drives `iframe.contentWindow.scrollTo(...)`.
  The new `STREAM.MEDIA` op + `handleMedia` follow this exact shape.
- **STREAM namespace** — `src/protocol/messages.js:16-36` (`STREAM = { SNAPSHOT,
  MUTATIONS, SCROLL, OVERLAY, DIALOG, READY, REQUEST_SNAPSHOT, STATE, SUBTREE_RESPONSE }`).
  Add `MEDIA: 'ext:dom-media'` (or `ext:ps-media`) here. Renderer dispatch switch
  (`src/renderer/index.js:~1510-1540`) silently ignores unknown types — old viewers
  ignore `STREAM.MEDIA` for free.
- **VALUE-op precedent for side-channel property state** — `src/capture/index.js:~1837-1930`
  captures live `value`/`checked`/`selectedIndexes` as `DIFF_OP.VALUE` ops keyed by nid
  (typedef `ValueDiffOp`, messages.js:~169). Media baseline + heartbeat mirror this
  property-state-by-nid pattern.
- **nid identity** — `ensureNodeId`/`assignNodeId` (`src/capture/index.js:~748-797`),
  WeakMap `elementToNid` + Map `nidToElement`. Renderer side: `resolveIndexedNode(nid)`
  (`src/renderer/index.js:~909`) over `nidToNode`, populated by `pairIdentityElements`
  preorder-walking `iframe.contentDocument.body.querySelectorAll('*')` against the
  snapshot `nodeIds`. The parent realm CAN call methods/set props on in-iframe media
  elements (sandbox is `allow-same-origin`, no cross-origin barrier).
- **Phase 12 fetch gate to reuse** — `gateAssetUrl(url, ctx)`
  (`src/renderer/index.js:~113-151`): mediaMode `off`→deny, `allowAssetOrigins` widen,
  `classifyAssetOrigin` fail-closed, `assetOriginPolicy` hook, posture. `VALID_MEDIA_MODES
  = { off, poster, reference }` (~44). Media src/poster/source URLs run through the same
  gate. The Phase 12 comment (~64-67) explicitly says the poster/full-asset split
  "matures in Phase 13."
- **CSP** — `CSP_META` (`src/renderer/snapshot.js:~336`): `default-src 'none'; img-src
  http: https: data:; style-src ... 'unsafe-inline'; font-src ...`. **No `media-src`** —
  add it here (the `style-src` widening is the precedent). String-layer snapshot asset
  gate (`src/renderer/snapshot.js:~43-59`) is where media URLs must be gated before
  srcdoc parse (the same browser-prefetch timing rule as `<img>`).
- `poster` already in `URL_ATTRS` (`src/capture/index.js:62`) — absolutified already.
  `<video>/<audio>/<source>` are not in `DROP_TAGS` — they survive capture today.

### Established Patterns
- New protocol constants → `src/protocol/constants.js` with a unit/derivation comment;
  new ops → `STREAM` object in `messages.js` with a typedef.
- Pure/fallible helper split: pure helpers return primitives (the reconciler returns an
  action object); fallible ops return `{ok, ...}`.
- Tests: `node --test tests/*.test.js tests/differential/*.test.js` (package.json:71);
  renderer tests use jsdom + srcdoc-string assertions; pure-function unit tests import
  modules directly. Settlement helpers drain event loop + rAF + timers.
- **Differential oracle** (`tests/differential/divergence-ledger.js`): any extracted-only
  divergence vs the FSB reference must be declared as a scenario-pinned `mismatch` entry
  (else `oracle.test.js` hard-fails; stale entries also detected). A media-state op the
  reference doesn't emit likely needs a new entry + a `media-playback-sync` fixture.

### Integration Points
- **Protocol:** `STREAM.MEDIA` op + `MediaSyncPayload` typedef in `messages.js`;
  `MEDIA_SYNC_THROTTLE_MS` in `constants.js`. No envelope/relay change.
- **Capture:** a `startMediaTracker()` twin of `startScrollTracker()`; media `media[]`
  baseline injected into the snapshot payload assembly; listeners on `<video>/<audio>`
  (start + added nodes).
- **Reconciler:** a pure `reconcileMediaDrift(...)` module (jsdom-unit-tested).
- **Renderer:** `handleMedia(payload)` in the dispatch switch → reconciler → parent-driven
  `.play()/.pause()/.currentTime=`; muted-autoplay + `play()`-rejection affordance +
  `onMediaBlocked` callback; `media-src` CSP add; `mediaMode` poster-vs-reference playback
  gate.
- **Tests:** reconciler unit tests (in-tolerance/nudge/seek/live/Infinity); a backward-compat
  "old viewer ignores STREAM.MEDIA" test; capture baseline/heartbeat test; differential
  ledger entry + `media-playback-sync` scenario if needed.

</code_context>

<specifics>
## Specific Ideas

- The `STREAM.MEDIA` channel is a documented **structural twin of the scroll/overlay side
  channels** — same throttle/identity-stamp/nid-addressing shape, same raw-relay + 1 MiB
  contract.
- rrweb provides the proven reconciler model (record play/pause/seek + interpolate); the
  reconciler here is a pure function unit-testable in jsdom (no real media timeline).
- Verify explicitly that **no media bytes traverse the relay** — bytes load from the
  source URL in the viewer's browser (the low-bandwidth core value), only nid-addressed
  playback state crosses the wire.
- Drift thresholds (0.25 s hold, ≤5% nudge, 1.0 s hard-seek) are practice-based starting
  points — keep them configurable so v2.1's evaluation harness can tune them.

</specifics>

<deferred>
## Deferred Ideas

- Adaptive HLS (`.m3u8`) / DASH (`.mpd`) manifest discovery + the optional lazy
  parent-realm `hls.js` player → Phase 14 (MADPT-01..04). `blob:` in `media-src` rides
  there.
- Asset/media URL **masking vocabulary** (`maskMediaSelector`, `maskAssetUrls`) +
  `referrerpolicy="no-referrer"` completion + the parent-realm object-URL threat model →
  Phase 15 (MSEC-03, MSEC-04).
- MSE-without-manifest / DRM/EME degrade-to-poster paths → Phase 14 (MADPT-03).

</deferred>
