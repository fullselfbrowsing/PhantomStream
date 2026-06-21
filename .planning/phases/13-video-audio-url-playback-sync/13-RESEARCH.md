# Phase 13: Video/Audio URL + Playback Sync - Research

**Researched:** 2026-06-20
**Domain:** Cross-realm HTML media playback, drift-corrected sync, autoplay policy, wire side-channel design
**Confidence:** HIGH (reconciler model, autoplay, jsdom seam empirically verified; security gate anchored in shipped Phase 12 code)

## Summary

Phase 13 adds one new throttled side channel (`STREAM.MEDIA`) and a pure drift reconciler so the viewer can play `<video>`/`<audio>` from the source URL in lockstep with the captured tab. The whole design is a **structural twin of the scroll channel** that already ships (`startScrollTracker` at `src/capture/index.js:4522` -> `handleScroll` at `src/renderer/index.js:1465`), plus a property-state-by-nid baseline that mirrors the shipped `DIFF_OP.VALUE` precedent (`src/capture/index.js:1863-1924`). The relay and envelope are not touched — old viewers ignore the unknown type for free because the renderer dispatch `switch` already has a silent `default` (`src/renderer/index.js:1545-1546`).

The single highest-value research output is the **drift reconciler**. The canonical model is rrweb's `MediaManager` [CITED: github.com/rrweb-io/rrweb /packages/rrweb/src/replay/media/index.ts]: it interpolates the expected position as `currentTimeAtLastInteraction + (elapsed_ms/1000) * playbackRate` — exactly the `pos = currentTime + playbackRate·(now − sentAt)` that `13-CONTEXT.md` locks. rrweb then **always hard-seeks** to that position and **swallows the `play()` promise with `void target.play()` (no catch)**. PhantomStream deliberately improves on rrweb in two ways CONTEXT requires: (1) a tolerance band + temporary rate-nudge so small drift converges smoothly instead of snapping, and (2) explicit `play()`-rejection handling driving an observable affordance. That makes the reconciler a defensible novel contribution, not a port.

The reconciler is a **pure function over plain objects**, which the empirical jsdom probe (below) proves is the only testable design: jsdom's `HTMLMediaElement.play()` is "Not implemented" and returns `undefined` (not a promise), `currentTime` is settable but advances no timeline, `duration` is `null` on an unloaded element, and setting `currentTime` fires no `seeked`. So all sync logic must be verifiable without a real media element; capture/renderer media glue is tested by message-flow assertions and `Object.defineProperty` element stubs, with real playback / autoplay / seek-on-live deferred to a documented Playwright UAT (the established project pattern — Phase 12 deferred its asset UAT identically, STATE.md `[Phase 12-03]`).

**Primary recommendation:** Implement `STREAM.MEDIA` as a scroll-twin side channel; put `reconcileMediaDrift(localState, remoteState, now, config)` in its own pure module under `src/protocol/` (shared, zero-dep, directly jsdom-unit-testable); extend the Phase 12 **string-layer** asset gate (`gateSnapshotAssets`, `src/renderer/snapshot.js:289`) to cover `<video src>`/`poster`/`<source src>` (the browser prefetches these during srcdoc parse, exactly like `<img>`); add `media-src http: https: data:` to `CSP_META` (`src/renderer/snapshot.js:336`); default playback to muted and treat the `play()` promise (when it is a promise) with a `.catch` -> `onMediaBlocked(nid)` affordance.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Wire Protocol — `STREAM.MEDIA` op (MWIRE-01)**
- **Cadence = hybrid.** Discrete transition events (play, pause, seeked, ratechange, ended) flush immediately (coalesced); a periodic heartbeat is throttled at a new `MEDIA_SYNC_THROTTLE_MS` (default **250 ms**) and only while playing. The channel is throttled, but discrete transitions are not delayed by the throttle window. Hard-seek is decided by the reconciler, never per-message.
- **Latency compensation = include a capture timestamp.** The payload carries a capture-side `sentAt` (monotonic ms) so the reconciler can predict `pos = currentTime + playbackRate·(now − sentAt)` while playing. Kept inside `remoteState` so the reconciler stays pure.
- **Granularity = one message per media element per tick** (scroll-like simplicity). nid-addressed and identity-stamped (`streamSessionId`, `snapshotId`) exactly like scroll/overlay.
- **Backward-compat is explicitly tested.** A viewer whose dispatch has no `STREAM.MEDIA` case silently ignores the message; the envelope + relay are unchanged (raw passthrough, 1 MiB cap intact). Old FSB viewers must keep working.

**Capture Baseline & Triggers (MEDIA-02, MEDIA-04)**
- **Baseline lives in a dedicated `media[]` array in the snapshot payload** — each entry `{ nid, currentTime, paused, muted, volume, playbackRate, loop, duration|live, ended }` — NOT serialized into the HTML. Mirrors the `DIFF_OP.VALUE` precedent (live property state travels as side-channel data keyed by nid, never baked into the clone) and preserves the Phase 7 "capture does not mutate the page" invariant + the differential oracle's byte-identity for the HTML.
- **Emission triggers:** `play, pause, seeked, ratechange, ended, volumechange, loadedmetadata` sent immediately; plus a throttled `timeupdate` heartbeat while playing. `seeking`/`progress` are not sent (interim/noise).
- **Observed elements = all `<video>` and `<audio>`**, including mutation-added ones (listeners attached on stream start and on added nodes; detached on stop/removal).
- **Live/Infinity-duration encoding:** at capture, derive `live = !isFinite(duration)`; send `duration` only when finite and send `live: true` for streams. Avoids the JSON `Infinity → null` trap. (`audio` uses the identical URL + state model as video — MEDIA-04.)

**Drift Reconciler Defaults (MEDIA-03, MWIRE-02)**
- **Pure, configurable function** `reconcileMediaDrift(localState, remoteState, now, config) → action` (action ∈ hold | nudge | seek | rejoin-edge), unit-tested in jsdom with no real media timeline. All thresholds are config fields with documented defaults.
- **In-tolerance hold band = 0.25 s** (default). Within this, hold — no correction.
- **Small persistent drift → rate-nudge** (±≤5% temporary `playbackRate` adjustment) to converge in the (0.25 s, 1.0 s) band. Bounded; reverts to true rate once back in-band.
- **Hard-seek threshold:** seek when drift > 1.0 s during playback, OR on any explicit remote seek event, OR on loop wrap.
- **Live streams** (`live: true` / non-finite duration): never absolute-seek; rejoin the live edge (`seekable.end`) only on large drift ("rejoin-edge"). `Infinity` duration yields no `NaN` anywhere.

**Viewer Playback UX, Autoplay & mediaMode (MEDIA-01, MEDIA-05)**
- **Muted-autoplay default.** Viewer mirrors source playing state but starts media muted; if source is unmuted, surface an unmute affordance. Bytes load from the source URL; playback driven entirely from the parent realm (`resolveIndexedNode` → `.play()/.pause()/.currentTime=`); no player code in the no-`allow-scripts` sandbox.
- **`play()` rejection → observable affordance.** When the `play()` promise rejects, show a host-overlay "click to play" affordance and invoke `onMediaBlocked(nid)`. The mirror never wedges.
- **`media-src` CSP add.** Add `media-src http: https: data:` to `CSP_META`; media src/poster/`<source>` URLs run through the same string-layer `gateAssetUrl` / origin policy from Phase 12. **No `blob:`** this phase. Keep `default-src 'none'` and no `script-src`.
- **`mediaMode` completes the Phase 12 split:** `off` = no media element fetch; `poster` = poster image only, no playback (autoplay disabled, source not bound); `reference` = full playback.

### Claude's Discretion
- Exact op constant value (`STREAM.MEDIA`), payload field naming, and `MEDIA_SYNC_THROTTLE_MS` placement — follow existing `STREAM.SCROLL` / `SCROLL_THROTTLE_MS` conventions.
- Internal naming of the reconciler config object and helpers; whether the reconciler lives in `src/protocol/` (pure, shared) or a new `src/renderer/` module — prefer wherever keeps it pure and directly jsdom-unit-testable.
- The precise markup/styling of the "click to play" affordance, consistent with existing renderer overlay conventions. (NOTE: now locked by `13-UI-SPEC.md` — see Project Constraints below.)
- Whether media-state capture needs a differential-oracle ledger entry and the new scenario fixture name — add one if the oracle would otherwise hard-fail.

### Deferred Ideas (OUT OF SCOPE)
- Adaptive HLS (`.m3u8`) / DASH (`.mpd`) manifest discovery + the optional lazy parent-realm `hls.js` player → Phase 14 (MADPT-01..04). `blob:` in `media-src` rides there.
- Asset/media URL **masking vocabulary** (`maskMediaSelector`, `maskAssetUrls`) + `referrerpolicy="no-referrer"` completion + the parent-realm object-URL threat model → Phase 15 (MSEC-03, MSEC-04).
- MSE-without-manifest / DRM/EME degrade-to-poster paths → Phase 14 (MADPT-03).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| MEDIA-01 | Progressive `<video>` (mp4/webm) plays in the viewer from the source URL, never via relay | Cross-realm parent-driven `.play()` on the in-iframe element (`resolveIndexedNode`, `src/renderer/index.js:909`); sandbox `allow-same-origin` lets the parent call methods on in-iframe media; `media-src` CSP + string-gate let the viewer's browser fetch the bytes directly (Architecture Patterns §1, §4) |
| MEDIA-02 | Initial media state captured in snapshot as the delta baseline | `media[]` array appended to `snapshotPayload` (`src/capture/index.js:3685`), mirroring `DIFF_OP.VALUE` property-by-nid (Code Examples §2); `live = !isFinite(duration)` encoding avoids the `Infinity→null` JSON trap |
| MEDIA-03 | Play/pause/seek/ratechange stream over throttled channel + drift-corrected interpolation; hard-seek only on large drift | `reconcileMediaDrift` pure function (Architecture Patterns §1, Code Examples §1); rrweb interpolation formula + tolerance band + rate-nudge + hard-seek decision tree |
| MEDIA-04 | `<audio>` mirrored by the same URL + playback-state model as video | Identical element interface (`HTMLMediaElement` is the shared base of `<video>`/`<audio>`); the capture tracker observes both tags; one `media[]` entry shape covers both |
| MEDIA-05 | Viewer honors autoplay policy (muted default; observable affordance on `play()` rejection); never wedges | Autoplay model verified (Pitfall 1, Common Pitfalls); muted-autoplay always allowed; `play()` rejects `NotAllowedError`; `play()` returns `undefined` in jsdom (guard required); affordance State A in `13-UI-SPEC.md` |
| MWIRE-01 | `STREAM.MEDIA` throttled side-channel op, nid-addressed, envelope-backward-compatible, raw-relay + 1 MiB-cap intact | Scroll-twin design (Architecture Patterns §3); silent `default` in dispatch switch (`src/renderer/index.js:1545`); backward-compat test (Validation Architecture) |
| MWIRE-02 | Drift reconciler is a pure, configurable, jsdom-unit-testable function | Empirical jsdom probe proves pure-object testing is the only viable approach (jsdom Test Seam §5); reconciler takes plain `localState`/`remoteState`/`config` and returns a plain action object |
</phase_requirements>

## Project Constraints (from CLAUDE.md + 13-UI-SPEC.md)

These have the same authority as locked decisions. Plans must not contradict them.

| Constraint | Source | Enforcement |
|------------|--------|-------------|
| Plain JS ESM + JSDoc types; no runtime build step for the library | CLAUDE.md Tech stack | Reconciler/protocol/capture/renderer code is hand-written ESM with JSDoc typedefs; no transpile. `.d.ts` is `tsc`-generated only. |
| Zero-dependency protocol module (`src/protocol/`) | CLAUDE.md; package.json has no runtime deps beyond `ws` | If the reconciler lives in `src/protocol/`, it must import nothing. It is pure arithmetic over plain objects — trivially satisfies this. |
| No emojis in logs/docs/anywhere | CLAUDE.md (global + project) | All `logger.*` strings and code comments stay emoji-free. |
| Wire stays backward-compatible with FSB's envelope (`{_lz,d}`, session stamping) | CLAUDE.md Constraints | `STREAM.MEDIA` is one new type string + typedef + constant; envelope/relay untouched; identity stamping `{streamSessionId, snapshotId}` on every message. |
| Published framework renders attacker-influenced HTML; sanitize both ends + sandboxed iframe (no `allow-scripts`) is non-negotiable | CLAUDE.md Security | Media URLs gated through `gateAssetUrl` at the STRING layer pre-parse; affordances live in the parent realm and write text via `textContent`; sandbox token stays exactly `allow-same-origin` (asserted at `src/renderer/index.js:443-446`). |
| Capture must not mutate the observed page (Phase 7 invariant) | CLAUDE.md; STATE.md | `media[]` baseline is computed by reading live element properties; never writes attributes; never serialized into the clone. |
| Naming: `UPPER_SNAKE_CASE` constants with unit/derivation comment; `STREAM` ops as object keys with typedef; `is`-prefixed predicates; symmetric encode/decode | CLAUDE.md Conventions | `MEDIA_SYNC_THROTTLE_MS` and `STREAM.MEDIA` follow `SCROLL_THROTTLE_MS` / `STREAM.SCROLL` exactly. |
| Affordance UI contract LOCKED | 13-UI-SPEC.md | 3 states (blocked-play scrim+button, unmute pill, poster caption); accent `#f59e0b` reserved for the actionable control; `pointer-events: auto` only on the clickable control; `onMediaBlocked(nid)` delivered as a **config callback**, NOT via `on()` (which throws on non-`state`/`health` names); all text via `textContent`; 44x44px min hit target. |

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Capture media baseline + emit events | Capture (`src/capture/index.js`) | Protocol (typedef) | Capture reads live `HTMLMediaElement` props and emits; it is the only tier that sees the real source media. |
| Drift decision (hold/nudge/seek/rejoin) | Protocol (pure `reconcileMediaDrift`) | — | Must be a pure function with no DOM, so it lives where it can be unit-tested with plain objects and shared. |
| Apply playback (`play`/`pause`/`currentTime=`) | Renderer parent realm (`src/renderer/index.js`) | — | The in-iframe element is inert (no `allow-scripts`); the parent realm is the ONLY place that can drive it cross-realm. |
| Fetch the media bytes | Browser / Client (viewer's browser, from source URL) | — | The low-bandwidth core value: bytes never traverse the relay; the viewer's own network fetches from the CDN. |
| Gate which media URLs may be fetched | Renderer (`gateAssetUrl` + string-layer `gateSnapshotAssets`) | Protocol posture | Fail-closed origin policy is a viewer-side-fetch security control; must run before the parser sees the URL. |
| Affordance overlays (blocked-play/unmute/poster) | Renderer parent realm (`src/renderer/overlays.js` registry) | — | Host-document overlays over the sandbox; never injected into the mirror. |
| Relay the playback-state messages | Relay (unchanged) | — | Raw passthrough; relay never deserializes; `STREAM.MEDIA` is just more text under the 1 MiB cap. |

## Standard Stack

**No new runtime dependencies.** This phase adds protocol constants, a pure function, capture glue, and renderer glue — all plain ESM. `package.json` `dependencies` stays `{ "ws": "8.21.0" }`. [VERIFIED: package.json read this session]

The "standard stack" here is the **shipped PhantomStream pipeline itself** — the phase reuses existing seams rather than importing libraries:

### Core (existing modules extended)
| Module | File | Purpose | Why standard |
|--------|------|---------|--------------|
| Protocol constants | `src/protocol/constants.js` | Add `MEDIA_SYNC_THROTTLE_MS = 250` next to `SCROLL_THROTTLE_MS = 200` (line 30) | Established home for throttle constants with unit/derivation comments |
| Protocol messages | `src/protocol/messages.js` | Add `STREAM.MEDIA` (line 17-36 block) + a `MediaSyncPayload` typedef + a `MediaBaselineEntry` typedef | Established home for ops + typedefs |
| Reconciler (new, pure) | `src/protocol/media-reconcile.js` (recommended) | `reconcileMediaDrift(localState, remoteState, now, config)` + `DEFAULT_MEDIA_RECONCILE_CONFIG` | Pure, zero-dep, shared, directly jsdom-unit-testable (satisfies the discretion clause + MWIRE-02) |
| Capture tracker (new fn) | `src/capture/index.js` | `startMediaTracker()` twin of `startScrollTracker()` (line 4522); `media[]` baseline in `serializeDOM` (line 3685) | Scroll/value precedent |
| Renderer handler (new fn) | `src/renderer/index.js` | `handleMedia(payload)` in the dispatch switch (line 1545); a media playback driver | Scroll handler precedent (`handleScroll`, line 1465) |
| Renderer CSP + gate | `src/renderer/snapshot.js` | `media-src` add to `CSP_META` (line 336); extend `gateSnapshotAssets` (line 289) to `<video>/<source>/poster` | `img-src` / `<img>`-gate precedent |
| Affordance overlays | `src/renderer/overlays.js` | Register `media-blocked` / `media-unmute` / `media-poster` kinds via `register(kind, renderFn)` (line 348) | Overlay registry precedent (glow/progress/dialog) |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Pure reconciler in `src/protocol/` | Reconciler in `src/renderer/` | Renderer placement is also pure-testable, but `src/protocol/` keeps it shared (capture could self-check) and zero-dep by construction. **Recommendation: `src/protocol/media-reconcile.js`.** Either satisfies MWIRE-02; protocol is the cleaner home. |
| `media[]` in the snapshot payload | A separate `STREAM.MEDIA` baseline message at stream start | CONTEXT locks the snapshot-`media[]` approach (mirrors `DIFF_OP.VALUE`, preserves HTML byte-identity for the oracle). A separate message would add a wire round-trip and a new ordering dependency. Do not deviate. |
| Reusing the `DIFF_OP.VALUE` delegated listener (document-level capture) | Per-element media listeners | **Media events do NOT bubble** (`play`/`pause`/`seeked`/`timeupdate` are not composed/bubbling), so the value-tracker's delegated `document.addEventListener('input', ..., true)` pattern (`src/capture/index.js:1939`) will NOT catch them. Media listeners MUST be attached per-element (or use capture-phase listeners on the element). See Common Pitfalls §3. |

**Installation:** None. No `npm install`. [VERIFIED: package.json — no new deps; Package Legitimacy Audit below confirms zero external packages.]

## Package Legitimacy Audit

> This phase installs **zero** external packages. No registry verification, slopcheck, or postinstall audit applies.

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| (none) | — | — | — | — | — | No external packages added |

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

The only third-party reference in the entire v2.0 milestone — `hls.js` — is explicitly **Phase 14**, not this phase (STATE.md `[Roadmap v2.0]`: "hls.js is the only justified runtime add … lazy-imported viewer-side only"). It must NOT appear in any Phase 13 plan. [CITED: .planning/STATE.md]

## Architecture Patterns

### System Architecture Diagram

```text
  CAPTURE PAGE (real tab)                      RELAY (unchanged)            VIEWER PAGE (parent realm)
  ┌────────────────────────────┐               ┌──────────────┐            ┌─────────────────────────────────────┐
  │ <video>/<audio> (source)   │               │ raw byte      │            │ dispatch(type,payload)              │
  │   │ media events            │               │ fan-out,      │            │   switch:                            │
  │   ▼ (do NOT bubble)         │               │ 1 MiB cap,    │            │     STREAM.SNAPSHOT → media[] baseline│
  │ startMediaTracker()         │               │ verbatim      │            │     STREAM.MEDIA   → handleMedia()    │
  │   per-element listeners:    │               │ passthrough   │            │     default        → (ignored)        │
  │   play/pause/seeked/        │  STREAM.MEDIA │               │ STREAM.MEDIA│             │                        │
  │   ratechange/ended/         │ {nid,         │               │            │             ▼                        │
  │   volumechange/             │  currentTime, │──────────────▶│───────────▶│   isCurrentStream() staleness gate   │
  │   loadedmetadata            │  paused,rate, │               │            │             │                        │
  │   + throttled timeupdate    │  sentAt,...}  │               │            │             ▼                        │
  │   heartbeat (250ms,playing) │               │               │            │   reconcileMediaDrift(               │
  │                             │               │               │            │     localState, remoteState, now, cfg)│
  │ serializeDOM():             │  STREAM.SNAPSHOT (media[] in   │            │             │ action                 │
  │   media[] baseline appended │  payload, NOT in html clone)   │            │   ┌─────────┼─────────┬──────────┐   │
  │   {nid,currentTime,paused,  │──────────────▶│───────────────────────────▶│  hold     nudge      seek    rejoin │
  │    muted,volume,rate,loop,  │               │               │            │   (no-op) (rate±5%) (currentTime=) edge│
  │    duration|live,ended}     │               │               │            │             │                        │
  │                             │               │               │            │             ▼ resolveIndexedNode(nid)│
  │ NEVER sends media BYTES ────┼───────────────┼───────────────┼────────────┼─▶ in-iframe <video> (inert, sandbox  │
  └────────────────────────────┘               └──────────────┘             │     allow-same-origin, NO scripts):  │
                                                                             │     .play()/.pause()/.currentTime=   │
  BYTES path (low-bandwidth core value):                                     │       │ play() promise?               │
  viewer's browser ───GET───▶ source CDN/origin (gated by gateAssetUrl)      │       ▼ reject(NotAllowedError)      │
                                                                             │   onMediaBlocked(nid) → "click to play"│
                                                                             └─────────────────────────────────────┘
```

The defining property — traceable on the diagram — is that the **STREAM.MEDIA channel carries only small nid-addressed playback state**; the media **bytes** take an entirely separate path (viewer browser → source CDN) and never touch the relay. This is the milestone thesis ("mirror media by reference, not by value").

### Recommended Project Structure
```text
src/
├── protocol/
│   ├── constants.js          # + MEDIA_SYNC_THROTTLE_MS = 250
│   ├── messages.js           # + STREAM.MEDIA, MediaSyncPayload, MediaBaselineEntry typedefs
│   └── media-reconcile.js    # NEW: reconcileMediaDrift() + DEFAULT_MEDIA_RECONCILE_CONFIG (pure, zero-dep)
├── capture/
│   └── index.js              # + startMediaTracker()/stopMediaTracker(); media[] in serializeDOM(); listeners on added <video>/<audio>
└── renderer/
    ├── index.js              # + handleMedia() in dispatch; playback driver; onMediaBlocked wiring; mediaMode poster/reference gate
    ├── snapshot.js           # + media-src in CSP_META; extend gateSnapshotAssets to <video>/<source>/poster
    └── overlays.js           # + media-blocked / media-unmute / media-poster renderFns (registry)
tests/
├── media-reconcile.test.js          # NEW: pure reconciler unit tests (the bulk of MWIRE-02 coverage)
├── capture-media.test.js            # NEW: baseline + heartbeat + added-node listener message-flow
├── renderer-media.test.js           # NEW: handleMedia dispatch, stubbed-element playback, affordance, backward-compat
├── renderer-media-csp.test.js       # NEW (or extend renderer-asset-gate): media-src in srcdoc; <video src>/<source>/poster gated
└── differential/
    ├── fixtures/media-playback-sync.html   # NEW fixture (if oracle would hard-fail)
    └── scenarios/media-playback-sync.js    # NEW scenario (if oracle would hard-fail)
```

### Pattern 1: The pure drift reconciler (THE core deliverable)

**What:** A pure function that, given the local element's observed state and the latency-compensated remote state, returns one action. No DOM, no side effects, no clock read inside (caller passes `now`).

**When to use:** Called by `handleMedia` on every `STREAM.MEDIA` message AND on a renderer-side rAF/interval tick for continuous convergence.

**The rrweb-derived interpolation (the latency-compensation core):**
```js
// Source (model): github.com/rrweb-io/rrweb /packages/rrweb/src/replay/media/index.ts
// rrweb's seekTo:
//   const diff = time - mediaState.lastInteractionTimeOffset;
//   const mediaPlaybackOffset = (diff / 1000) * mediaState.playbackRate;
//   let seekToTime = mediaState.currentTimeAtLastInteraction + mediaPlaybackOffset;
// PhantomStream equivalent, with sentAt as the capture-side stamp (CONTEXT):
//   expectedPos = remote.currentTime + remote.playbackRate * ((now - remote.sentAt) / 1000)
```
[CITED: github.com/rrweb-io/rrweb /packages/rrweb/src/replay/media/index.ts]

**The decision tree PhantomStream adds on top (rrweb has none — it always hard-seeks):**

```text
reconcileMediaDrift(local, remote, now, cfg):
  # ---- 0. guard / normalize inputs (see NaN/edge traps table) ----
  if remote missing required fields            -> { action: 'hold', reason: 'incomplete-remote' }
  if remote.paused (or remote.playbackRate==0) -> if local not paused: { action: 'pause' }
                                                  else { action: 'hold', reason: 'paused' }
                                                  # do NOT predict position while paused

  # ---- 1. compute latency-compensated expected position (playing only) ----
  elapsedSec = clampNonNegative((now - remote.sentAt) / 1000)     # negative clock skew -> 0
  rate       = (remote.playbackRate > 0) ? remote.playbackRate : 1
  expected   = remote.currentTime + rate * elapsedSec

  # ---- 2. LIVE branch (remote.live === true OR duration not finite) ----
  if remote.live === true:
    drift = expected - local.currentTime          # may be meaningless for live; magnitude only
    if abs(drift) > cfg.liveRejoinSec (default 1.0):
        return { action: 'rejoin-edge' }           # renderer seeks to seekable.end (guarded), never absolute
    return { action: 'hold', reason: 'live-in-band' }

  # ---- 3. VOD branch: loop-wrap, hard-seek, nudge, hold ----
  duration = remote.duration                       # finite here by construction
  # loop wrap: local near end, expected wrapped to near start (or vice versa)
  if remote.loop && isLoopWrap(local.currentTime, expected, duration, cfg):
      return { action: 'seek', toTime: clampToDuration(expected, duration) }

  drift = expected - local.currentTime
  adrift = abs(drift)

  if adrift <= cfg.holdBandSec (0.25):
      # back in band: if a nudge was active, the action carries revertRate so the driver restores true rate
      return { action: 'hold', reason: 'in-band', revertRate: rate }

  if adrift <= cfg.hardSeekSec (1.0):
      # small persistent drift -> bounded temporary rate nudge toward convergence
      sign      = (drift > 0) ? +1 : -1            # behind (expected ahead) -> speed up
      nudgeRate = rate * (1 + sign * cfg.maxNudgeFraction (0.05))   # ±5% cap
      return { action: 'nudge', rate: nudgeRate, baseRate: rate }

  # adrift > hardSeekSec
  return { action: 'seek', toTime: clampToDuration(expected, duration) }
```

**Explicit-seek handling (always hard-seek):** A discrete `seeked` event from capture is delivered as a `STREAM.MEDIA` message; `handleMedia` should pass a flag (e.g. `remote.event === 'seeked'`) so the reconciler short-circuits to `{ action: 'seek', toTime: clampToDuration(remote.currentTime, duration) }` regardless of computed drift. CONTEXT: "explicit seeks always hard-seek."

**Nudge revert:** the nudge is temporary. The driver applies `nudgeRate` to `element.playbackRate`; on the next tick that lands in-band, the `hold` action carries `revertRate` (the true `remote.playbackRate`) and the driver restores it. The reconciler stays pure by returning the target rate in the action; the *element* state (whether a nudge is currently applied) is read back from `local.playbackRate` vs `remote.playbackRate` on the next call, so the reconciler needs no internal memory.

### Pattern 2: Capture media tracker (scroll-twin + value-precedent)

**What:** `startMediaTracker()` attaches per-element listeners to every `<video>/<audio>`; on each tracked event, builds a `MediaSyncPayload` and `safeSend(STREAM.MEDIA, payload)`. A throttled `timeupdate` heartbeat (250 ms, only while the element is playing) uses the same `now - lastSend >= MEDIA_SYNC_THROTTLE_MS` timestamp check as the scroll tracker.

**When to use:** Armed in `start()`/`resume()` next to `startScrollTracker()` (`src/capture/index.js:4642, 4684`); torn down in `stop()`/`pause()` next to `stopScrollTracker()` (lines 4654, 4667).

**Critical difference from the scroll/value tracker:** media events do not bubble, so listeners are **per-element**, attached on stream start to all current `<video>/<audio>` and on each mutation-added one (hook into the existing added-node loop at `src/capture/index.js:4030`), and removed on element removal / stop. (See Common Pitfalls §3.)

### Pattern 3: STREAM.MEDIA wire op (scroll-twin)

**What:** One new `STREAM.MEDIA` type string, identity-stamped and nid-addressed, throttled, ignored-by-default downstream.

```js
// src/protocol/messages.js — add to the STREAM object (line 17-36):
//   /** Media playback state. Payload: MediaSyncPayload */
//   MEDIA: 'ext:dom-media',
// Renderer dispatch (src/renderer/index.js:1545) gets:
//   case STREAM.MEDIA: handleMedia(payload); break;
// A viewer without that case hits `default: break;` (line 1545-1546) — silent ignore. Backward-compat for free.
```
[VERIFIED: src/protocol/messages.js:17-36 and src/renderer/index.js:1518-1547 read this session]

### Pattern 4: Renderer parent-driven cross-realm playback

**What:** `handleMedia` resolves the nid to the in-iframe element via `resolveIndexedNode(nid)` (`src/renderer/index.js:909`), runs the reconciler, and applies the action by **calling methods on the in-iframe element from the parent realm**. The sandbox is exactly `allow-same-origin` (no `allow-scripts`), which **permits** the parent to call `.play()/.pause()` and set `.currentTime`/`.muted`/`.playbackRate` on the in-iframe element — there is no script execution inside the iframe, only the parent reaching in. [VERIFIED: sandbox assertion at src/renderer/index.js:443-446; CONTEXT confirms parent-realm drive]

**readyState gating (mandatory):** before `element.currentTime = x`, the driver MUST check `element.readyState >= HAVE_METADATA (1)`. If `readyState === HAVE_NOTHING (0)`, the seek is aborted by the spec and silently lost. Best practice (Shaka) is to defer the seek until `loadedmetadata`. [CITED: html.spec.whatwg.org/multipage/media.html — "If the media element's readyState is HAVE_NOTHING … abort"; github.com/shaka-project/shaka-player — waits for readyState >= 1 before setting currentTime]

### Anti-Patterns to Avoid
- **Hard-seeking on every message (rrweb's behavior).** rrweb does `mediaEl.currentTime = seekToTime` unconditionally, which produces visible stutter. PhantomStream's tolerance band + nudge is the whole point of MEDIA-03 ("hard-seek only on large drift, never per-message"). Do not collapse the decision tree into an unconditional seek.
- **`void element.play()` with no catch (rrweb's behavior).** rrweb discards the promise; PhantomStream MUST `.catch` it (when it is a promise) to drive `onMediaBlocked`. [CITED: rrweb media/index.ts uses `void target.play()`]
- **Calling `.catch` on `play()` without checking it is a promise.** In jsdom (and very old browsers) `play()` returns `undefined`; `undefined.catch` throws `TypeError`. Use MDN's exact guard `if (p !== undefined) p.then(...).catch(...)`. [VERIFIED: jsdom probe — `play()` returns undefined; CITED: developer.mozilla.org Autoplay guide shows `if (startPlayPromise !== undefined)`]
- **Baking media state into the serialized HTML clone.** Breaks the differential oracle's HTML byte-identity and the Phase 7 no-mutation invariant. Media state travels in `media[]` / `STREAM.MEDIA`, never as attributes on the clone. (CONTEXT-locked.)
- **Injecting affordances into the mirror iframe.** Affordances are parent-realm host overlays (`src/renderer/overlays.js`), never inside the sandbox. (UI-SPEC + CLAUDE.md security.)
- **`seekable.end(0)` without a length guard.** Throws `IndexSizeError` on an empty `TimeRanges` (real browsers). Always `if (el.seekable && el.seekable.length > 0) el.seekable.end(el.seekable.length - 1)`. (Pitfall 4.)

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Expected-position interpolation | A bespoke timing model | rrweb's proven `currentTime + rate*elapsed` formula | Battle-tested in session replay at scale; CONTEXT already specifies this exact formula |
| play()/promise-rejection handling | A custom can-autoplay probe | MDN's `if (p !== undefined) p.then().catch(name==='NotAllowedError')` pattern + muted default | The canonical, spec-aligned pattern; works across jsdom (undefined) and browsers (promise) |
| Origin/scheme fetch policy for media URLs | A new media-specific allow/deny | The **shipped** `gateAssetUrl(url, ctx)` (`src/renderer/index.js:113`) + `classifyAssetOrigin` | Phase 12 already built a fail-closed https-only + private-range classifier, exported for reuse; media is just another `kind` |
| String-layer pre-parse URL neutralization | A regex over the whole srcdoc | Extend the existing quote-aware `gateSnapshotAssets` scanner (`src/renderer/snapshot.js:289`) | The `<img>` scanner already solved the "`>` inside a quoted attr" security bug (CR-02/WR-01); reuse its machinery for `<video>/<source>` |
| Overlay layer / rect mapping / reset lifecycle | A new media overlay system | The overlay **registry** (`register`/`resetOverlays`/`mapRectToHost`, `src/renderer/overlays.js`) | Glow/progress/dialog already prove the seam; UI-SPEC mandates reuse |
| Identity staleness rejection | A media-specific generation check | `isCurrentStream(payload, active)` (`src/protocol/messages.js:258`) | Every side channel already uses it; late media frames from a prior page must be rejected identically |

**Key insight:** Phase 13's novelty is the **reconciler decision tree** (tolerance band + nudge + live-edge) and the **cross-realm autoplay-correct driver** — everything else is wiring into seams that already exist and are tested. The plan should be heavy on the reconciler + its unit tests, and light/mechanical on the wire/capture/render glue.

## Common Pitfalls

### Pitfall 1: Assuming parent-driven `play()` bypasses autoplay policy
**What goes wrong:** Engineer assumes that because the *parent realm* (which had a page load) calls `.play()` on the in-iframe element, autoplay policy doesn't apply, ships unmuted autoplay, and the mirror wedges on a silent `NotAllowedError`.
**Why it happens:** Autoplay policy gates *script-initiated* playback regardless of which frame's script initiates it. A `STREAM.MEDIA`-driven `.play()` is NOT a user gesture. The srcdoc iframe carries no `allow="autoplay"` (sandbox is exactly `allow-same-origin`), so it gets no delegated autoplay permission. [CITED: developer.chrome.com/blog/autoplay — "calls to play() without a user gesture will reject the promise with a NotAllowedError"; developer.mozilla.org Autoplay guide]
**How to avoid:** Default to **muted** (`element.muted = true`) before the first programmatic `.play()` — "Muted autoplay is always allowed" [CITED: developer.chrome.com/blog/autoplay]. Treat the returned promise (when it is a promise) with `.catch` → if `err.name === 'NotAllowedError'`, show the blocked-play affordance and call `onMediaBlocked(nid)`. The affordance's click IS a user gesture, so the click handler's `.play()` (optionally unmuting) is allowed.
**Warning signs:** Video stays at frame 0 with no error logged; `play()` promise rejection unhandled in console.
**UAT caveat:** jsdom cannot exercise real autoplay policy (its `play()` is a no-op). Whether a sandboxed iframe *without* `allow="autoplay"` blocks even *muted* programmatic autoplay is the one residual ambiguity (Chrome docs say muted is always allowed; the interaction with sandbox is undocumented) — **must be confirmed in a real-Chrome Playwright UAT** (Open Question 1).

### Pitfall 2: The JSON `Infinity → null` trap for live duration
**What goes wrong:** `JSON.stringify({duration: video.duration})` where `duration` is `Infinity` (a live stream) serializes to `"duration":null`. The reconciler then reads `null`, does arithmetic, and produces `NaN` seeks.
**Why it happens:** `JSON.stringify(Infinity) === "null"` and `JSON.stringify(NaN) === "null"`. The wire silently drops the live signal.
**How to avoid:** CONTEXT-locked — at capture, derive `live = !isFinite(duration)` and send `duration` ONLY when finite, plus `live: true` for streams. The reconciler branches on `remote.live === true` before any duration arithmetic. (Empirically, jsdom returns `duration === null` even for an unloaded element, and `isFinite(null) === false`, so the `live` derivation is robust there too. [VERIFIED: jsdom probe])
**Warning signs:** `NaN` in seek targets; live streams seeking to position 0 repeatedly.

### Pitfall 3: Media events do not bubble — the delegated-listener pattern silently captures nothing
**What goes wrong:** Copying the value-tracker's delegated listener (`document.addEventListener('play', handler, true)`) and expecting it to fire for all media. With `useCapture: true` it actually *can* work for non-bubbling events on the capture phase — BUT the value tracker attaches on `document`/shadow roots, and capture-phase delegation across shadow boundaries and mutation-added elements is fragile.
**Why it happens:** `play`, `pause`, `seeked`, `timeupdate`, `ratechange`, `volumechange`, `ended`, `loadedmetadata` are **non-bubbling** media events. The value tracker uses `input`/`change` which DO bubble. [CITED: html.spec.whatwg.org/multipage/media.html — media events are not bubbling]
**How to avoid:** Attach listeners **per `<video>/<audio>` element** on stream start (walk current elements) and on each mutation-added element (hook the added-node loop, `src/capture/index.js:4030`); remove on element removal and on `stop()`. Keep a `WeakSet`/`Map` of tracked elements mirroring the `valueListenerRoots` bookkeeping (`src/capture/index.js:689`). (Capture-phase document-level delegation is a viable alternative but per-element is simpler to reason about for teardown and added-node coverage; pick one and test added-node coverage explicitly.)
**Warning signs:** Media in a mutation-added `<video>` never syncs; sync works only for elements present at snapshot time.

### Pitfall 4: `seekable.end()` on an empty TimeRanges throws (the live-rejoin trap)
**What goes wrong:** The live "rejoin-edge" action does `el.seekable.end(el.seekable.length - 1)`; when `seekable.length === 0` (stream not yet buffered), `end(-1)` or `end(0)` throws `IndexSizeError` and the handler dies.
**Why it happens:** `TimeRanges.end(i)` throws `IndexSizeError` when `i >= length`. Live streams frequently have `seekable.length === 0` transiently. [CITED: developer.mozilla.org/en-US/docs/Web/API/TimeRanges/end; multiple field reports of `Uncaught IndexSizeError: Failed to execute 'end' on 'TimeRanges'`]
**How to avoid:** Guard every access: `if (el.seekable && el.seekable.length > 0) { target = el.seekable.end(el.seekable.length - 1); }` else hold. (jsdom is lenient — `seekable.length === 0` and `end(0)` returns `0` without throwing [VERIFIED: jsdom probe] — so this bug ONLY surfaces in real browsers and is invisible to jsdom unit tests; cover it in the Playwright UAT and by a defensive guard the unit test can still assert is present.)
**Warning signs:** Handler exceptions on live streams right after play; works on VOD, dies on live.

### Pitfall 5: Browser prefetches `<video src>` / `poster` during srcdoc parse — the post-parse gate is too late
**What goes wrong:** Adding a media-src gate only in the post-parse `gateFragmentAssets` pass (`src/renderer/index.js:362`). By the time the parsed DOM is scrubbed, the browser has already issued GETs for `<video src>`, `<video poster>`, and `<source src>` during srcdoc parsing — the SSRF/tracking-pixel fetch already happened.
**Why it happens:** Exactly the timing rule Phase 12 documented for `<img>` (`src/renderer/snapshot.js:43-59`): the HTML parser begins fetching fetchable attributes DURING parse, before any post-parse `load` handler runs. `<video src>`/`poster` and `<source src>` are fetchable the same way. (`<video preload="none">` defers the *media* GET but NOT the `poster` GET, and `<source src>` is selected during parse.)
**How to avoid:** Extend the **authoritative string-layer gate** `gateSnapshotAssets` (`src/renderer/snapshot.js:289`, currently `IMG_OPEN_RE = /<img\b/gi` only) to also scan `<video ...>` (gate `src` + `poster`) and `<source ...>` (gate `src`) start tags, reusing the existing quote-aware `findImgTagEnd` machinery (rename/generalize to `findTagEnd`). Run BEFORE `buildSnapshotHtml` assembles the srcdoc. Keep the post-parse `gateFragmentAssets` extension as defense-in-depth (and as where source-binding/poster-only enforcement happens). [VERIFIED: src/renderer/snapshot.js:289-320 scans only `<img>`; src/renderer/index.js:362-405 `gateFragmentAssets` scans only `img`]
**Warning signs:** Network tab shows a GET to a blocked media origin even though the placeholder rendered; CSP `media-src` is the only thing that stopped it (CSP is a backstop, not the primary gate).

### Pitfall 6: Feedback loop fear is unfounded across realms — but reconciler self-feedback is real
**What goes wrong:** Worry that the renderer setting `element.currentTime` fires a `seeked` that loops back as a capture event.
**Why it's a non-issue:** Capture and renderer are **different pages in different realms** (the capture tab vs the viewer's iframe). The renderer's `seeked` fires only in the viewer's DOM and has no listener that re-emits onto the wire — the viewer has no capture tracker. So there is NO cross-realm echo. [VERIFIED: architecture — capture tracker lives only in `src/capture/index.js`, runs in the source tab; renderer has no media event→wire path]
**The real loop to avoid:** the reconciler tick re-reading a `currentTime` that is mid-seek (`element.seeking === true`) and computing a fresh correction before the seek lands. Guard: while `element.seeking === true`, the driver should `hold` (skip applying a new seek). This is a renderer-driver guard, not a reconciler concern (the reconciler is pure; the driver decides whether to apply its action).
**Warning signs:** Rapid repeated seeks; `seeking` never settles.

### Pitfall 7: Stale `media[]` baseline overwriting live drift on re-snapshot
**What goes wrong:** A fresh snapshot's `media[]` baseline is applied as an absolute seek even though the live `STREAM.MEDIA` heartbeat already has the element in a good position, causing a visible jump back.
**Why it happens:** The snapshot baseline and the heartbeat are two sources of truth; applying the baseline unconditionally fights the reconciler.
**How to avoid:** Treat the snapshot `media[]` as the *initial* desired state, then immediately hand control to the reconciler on the next `STREAM.MEDIA`. Apply baseline `currentTime` only on first bind (when the element has no prior tracked state), gated by `readyState`. The `isCurrentStream` identity guard already prevents cross-generation contamination.
**Warning signs:** Every re-snapshot causes a playback hiccup.

### NaN / Edge-Case Trap Table (reconciler — must each have a unit test)

| Input condition | Risk | Reconciler rule |
|-----------------|------|-----------------|
| `remote.live === true` / non-finite duration | `NaN` from duration math | Take live branch BEFORE any duration arithmetic; never absolute-seek |
| `remote.duration === 0` | divide-by / loop-wrap math meaningless | Treat as non-seekable; `hold` (or pause-mirror) — never seek into a 0-length timeline |
| `now - remote.sentAt < 0` (clock skew) | negative elapsed → position goes backwards | `clampNonNegative(elapsedSec)` → 0 |
| `remote.playbackRate === 0` | rate-0 expected freezes; nudge math `*0` | Treat rate 0 like paused: `hold`/`pause`, no nudge |
| `remote.paused === true` | predicting position while paused drifts wrongly | If remote paused: `pause` (or hold); do NOT interpolate |
| `remote.currentTime` missing/`undefined` | `undefined + x` → `NaN` | Missing required field → `hold {reason:'incomplete-remote'}` |
| `local.currentTime` `NaN` (element not ready) | drift `NaN` | If `!isFinite(local.currentTime)` → `hold` (wait for readiness) |
| negative computed drift (local ahead of expected) | wrong-direction nudge | `sign = drift>0?+1:-1`; symmetric band; nudge slows down when ahead |
| `expected > duration` (overrun) | seek past end | `clampToDuration(expected, duration)` |
| loop wrap (local≈end, expected≈start) | huge false drift → spurious hard-seek | `isLoopWrap` detect → seek to wrapped position, not the raw delta |
| `cfg` missing fields | `undefined` thresholds → `NaN` compares | Merge over `DEFAULT_MEDIA_RECONCILE_CONFIG` at entry |

## Code Examples

### Example 1: Reconciler skeleton (pure, zero-dep) — Source: derived from rrweb model + CONTEXT
```js
// src/protocol/media-reconcile.js  (plain ESM, JSDoc types, no imports)

/** @typedef {Object} MediaReconcileConfig
 * @property {number} holdBandSec       In-tolerance band; default 0.25
 * @property {number} hardSeekSec        Hard-seek threshold; default 1.0
 * @property {number} maxNudgeFraction   Max temporary rate delta; default 0.05
 * @property {number} liveRejoinSec      Live-edge rejoin threshold; default 1.0
 */
export var DEFAULT_MEDIA_RECONCILE_CONFIG = {
  holdBandSec: 0.25, hardSeekSec: 1.0, maxNudgeFraction: 0.05, liveRejoinSec: 1.0
};

/** @returns {{action:'hold'|'pause'|'nudge'|'seek'|'rejoin-edge', ...}} */
export function reconcileMediaDrift(local, remote, now, config) {
  var cfg = mergeConfig(config); // over DEFAULT_*
  if (!remote || remote.currentTime == null || typeof remote.sentAt !== 'number') {
    return { action: 'hold', reason: 'incomplete-remote' };
  }
  if (remote.event === 'seeked') {
    var dur0 = isFinite(remote.duration) ? remote.duration : null;
    return { action: 'seek', toTime: clampTo(remote.currentTime, dur0) };
  }
  if (remote.paused || remote.playbackRate === 0) {
    return (local && local.paused) ? { action: 'hold', reason: 'paused' } : { action: 'pause' };
  }
  var elapsed = Math.max(0, (now - remote.sentAt) / 1000);
  var rate = remote.playbackRate > 0 ? remote.playbackRate : 1;
  var expected = remote.currentTime + rate * elapsed;

  if (remote.live === true || !isFinite(remote.duration)) {
    var dLive = Math.abs(expected - (local ? local.currentTime : 0));
    return dLive > cfg.liveRejoinSec ? { action: 'rejoin-edge' } : { action: 'hold', reason: 'live-in-band' };
  }
  // VOD ... (loop-wrap, band, nudge, hard-seek per the decision tree above)
}
```

### Example 2: Capture media baseline entry (mirrors DIFF_OP.VALUE) — Source: src/capture/index.js:1863 pattern
```js
// In serializeDOM(), append a media[] array (NOT into the HTML clone):
function buildMediaBaselineEntry(el) {
  var nid = ensureNodeId(el);                 // existing fn, src/capture/index.js
  var d = el.duration;
  var entry = {
    nid: nid,
    currentTime: el.currentTime,
    paused: !!el.paused,
    muted: !!el.muted,
    volume: el.volume,
    playbackRate: el.playbackRate,
    loop: !!el.loop,
    ended: !!el.ended
  };
  if (isFinite(d)) entry.duration = d; else entry.live = true;   // Infinity→null trap fix
  return entry;
}
// snapshotPayload.media = allTrackedVideoAudio.map(buildMediaBaselineEntry);
```

### Example 3: Capture event emit + heartbeat (scroll-twin) — Source: src/capture/index.js:4529 pattern
```js
function sendMediaState(el, eventName) {
  var d = el.duration;
  var payload = {
    nid: getTrackedNodeId(el),
    event: eventName,                  // 'play'|'pause'|'seeked'|'ratechange'|'ended'|'volumechange'|'loadedmetadata'|'timeupdate'
    currentTime: el.currentTime,
    paused: !!el.paused,
    muted: !!el.muted,
    volume: el.volume,
    playbackRate: el.playbackRate,
    loop: !!el.loop,
    ended: !!el.ended,
    sentAt: Date.now(),                // latency-compensation stamp (CONTEXT)
    streamSessionId: streamSessionId || '',
    snapshotId: currentSnapshotId || 0
  };
  if (isFinite(d)) payload.duration = d; else payload.live = true;
  safeSend(STREAM.MEDIA, payload);
}
// Discrete events: send immediately. timeupdate: throttle, only while !el.paused:
//   if (el.paused) return;
//   var now = Date.now(); if (now - lastMediaSend < MEDIA_SYNC_THROTTLE_MS) return; lastMediaSend = now;
```

### Example 4: Renderer apply with the play()-undefined guard — Source: MDN Autoplay guide pattern
```js
// In the playback driver (parent realm), applying a reconciler action:
function applyMediaAction(el, action) {
  if (el.seeking) return;                                    // Pitfall 6 driver guard
  switch (action.action) {
    case 'pause': try { el.pause(); } catch (e) {} break;
    case 'seek':
    case 'rejoin-edge': {
      var t = action.action === 'rejoin-edge'
        ? (el.seekable && el.seekable.length > 0 ? el.seekable.end(el.seekable.length - 1) : null) // Pitfall 4 guard
        : action.toTime;
      if (t != null && el.readyState >= 1 /* HAVE_METADATA */) {                                   // readyState gate
        try { el.currentTime = t; } catch (e) {}
      }
      ensurePlaying(el);
      break;
    }
    case 'nudge': el.playbackRate = action.rate; ensurePlaying(el); break;
    case 'hold': if (action.revertRate != null && el.playbackRate !== action.revertRate) el.playbackRate = action.revertRate;
                 ensurePlaying(el); break;
  }
}
function ensurePlaying(el) {
  if (!el.paused) return;
  el.muted = true;                                  // muted-autoplay default (MEDIA-05)
  var p = el.play();
  if (p !== undefined && typeof p.catch === 'function') {   // jsdom returns undefined; browsers return a promise
    p.catch(function (err) {
      if (err && err.name === 'NotAllowedError') showBlockedPlayAffordance(el);  // → onMediaBlocked(nid)
    });
  }
}
```
[VERIFIED: jsdom probe — `play()` returns undefined; CITED: developer.mozilla.org Autoplay guide `if (startPlayPromise !== undefined)`]

## Runtime State Inventory

> Phase 13 is a **greenfield capability add**, not a rename/refactor/migration. No stored data, live-service config, OS-registered state, secrets, or build artifacts carry a string this phase renames.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — no datastore keys/IDs introduced or renamed | none |
| Live service config | None — relay/envelope untouched; no external service config changes | none |
| OS-registered state | None — no tasks/services/daemons | none |
| Secrets/env vars | None — `src/protocol/` is pure logic; no env vars added | none |
| Build artifacts | `.d.ts` regenerated via `tsc` (`npm run types`) after new exports land; this is a normal build, not stale-artifact migration | regenerate types in the package-check flow |

**Nothing found in categories 1–4:** verified — this phase adds protocol constants, a pure function, and capture/render glue; it introduces no persistent identifiers, no service registrations, and no secrets.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| rrweb media replay: unconditional `currentTime = seekToTime` every event | Tolerance band + temporary rate-nudge + hard-seek only on large drift | PhantomStream Phase 13 (this phase) | Smoother sync, fewer visible jumps; the reconciler's value-add over the rrweb baseline |
| rrweb `void target.play()` (rejection ignored) | `play()` rejection observed → muted default + click-to-play affordance | This phase (MEDIA-05) | Mirror never wedges; autoplay-policy-correct |
| Pixel media relay (WebRTC/CDP screencast) | Media by URL reference + small playback-state messages | v2.0 milestone thesis | ~100–1000× bandwidth reduction; bytes from CDN, not relay |
| `<img>`-only string-layer asset gate | `<img>` + `<video>`/`<source>`/`poster` string-layer gate | This phase (extends Phase 12) | Closes the media prefetch SSRF/tracking-pixel hole at the authoritative pre-parse layer |

**Deprecated/outdated:**
- Do NOT use `canplaythrough`/manual buffering heuristics for sync — the reconciler's `readyState >= HAVE_METADATA` gate plus the `seeking` driver guard is sufficient and testable.
- Do NOT reach for any media-sync npm package — the reconciler is ~80 lines of pure arithmetic and must stay zero-dep in `src/protocol/`.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | A sandboxed iframe with exactly `allow-same-origin` (no `allow="autoplay"`) still permits **muted** programmatic autoplay when the parent calls `.play()` | Common Pitfalls §1, Open Q1 | If muted autoplay is ALSO blocked in this sandbox config, EVERY mirrored video needs a click-to-play first interaction (the affordance already handles this gracefully — mirror never wedges — but the "starts playing automatically when muted" UX would not hold). Must confirm in Playwright UAT. The muted-default + affordance design is safe either way; only the no-click happy path is at risk. |
| A2 | `op` constant value `STREAM.MEDIA = 'ext:dom-media'` is free of collisions with FSB's shipped envelope vocabulary | Pattern 3 | A collision would break FSB swap-in. Low risk (follows the `ext:dom-*` namespace; `ext:dom-media` is unused in `messages.js`), but the planner/discuss should confirm against FSB's type registry. [VERIFIED unused in this repo: src/protocol/messages.js read this session] |
| A3 | Per-element media listeners (vs capture-phase document delegation) is the cleaner approach for added-node coverage and teardown | Pattern 2, Pitfall 3 | If a future requirement needs thousands of media elements, per-element listeners cost more than delegation; not a concern for "pages rarely have more than one actively-playing element" (CONTEXT). |
| A4 | The differential oracle WILL hard-fail without a new ledger entry once capture emits `STREAM.MEDIA` / `media[]` (the reference emits neither) | Differential Oracle Impact | If a fixture never instantiates a `<video>`, the extracted side emits no media message and the oracle would NOT diverge — making a premature ledger entry go stale and FAIL stale-detection. The entry + a `media-playback-sync` fixture that DOES instantiate media must land together. (This is exactly the D26 precedent — see that section.) |

**These four assumptions need confirmation before they become locked decisions.** A1 is the only one with real correctness weight and is UAT-gated.

## Open Questions

1. **Does the `allow-same-origin`-only sandbox block muted programmatic autoplay?**
   - What we know: Muted autoplay is "always allowed" in the top frame and same-origin iframes; `allow="autoplay"` governs *unmuted* cross-origin delegation [CITED: developer.chrome.com/blog/autoplay]. The srcdoc iframe is same-origin (about:srcdoc inherits the embedder origin) but sandboxed.
   - What's unclear: Whether the *sandbox* attribute (without an autoplay token) independently suppresses even muted programmatic autoplay. Chrome/MDN docs do not address the sandbox×autoplay interaction.
   - Recommendation: **Playwright UAT** — load a muted `<video>` in an `allow-same-origin` srcdoc iframe, call `.play()` from the parent, assert it plays (or rejects). The muted-default + affordance design is correct regardless; this only determines whether the affordance is needed on the happy path. Plan a UAT task; do not block the phase on it.

2. **Cross-browser `play()` rejection name consistency.**
   - What we know: Chrome and Firefox reject with `NotAllowedError`; the recommended check is `err.name === 'NotAllowedError'` [CITED: MDN]. Firefox has a historical bug where `play()` can stay pending forever when a tab is backgrounded [CITED: bugzilla.mozilla.org/show_bug.cgi?id=1442186].
   - What's unclear: Safari's exact rejection name/timing (project targets Chromium-first per REQUIREMENTS Out-of-Scope, so this is low priority).
   - Recommendation: Branch on `err.name === 'NotAllowedError'` and treat any other rejection as a load error (fall through to the Phase 12 placeholder path). Add a timeout fallback so a never-resolving `play()` promise still surfaces the affordance. Chromium-first scope makes Safari deferrable.

3. **Should `mediaMode: 'poster'` bind `<source>`/`src` at all?**
   - What we know: UI-SPEC State C says poster mode shows the poster only, "source not bound, autoplay disabled."
   - What's unclear: Whether the renderer should strip `src`/`<source>` from the in-iframe element (to guarantee no media GET) or merely not call `.play()`. Stripping is safer (no media byte fetch at all) and aligns with `mediaMode` as a *fetch posture*, not just a playback toggle.
   - Recommendation: In `poster` mode, the string-layer gate should neutralize `<video src>`/`<source src>` (keep `poster`), guaranteeing zero media-byte fetch — consistent with `gateAssetUrl`'s `'poster'` posture (`src/renderer/index.js:148-150`). The planner should make this explicit.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | test runner + library | ✓ | v25.9.0 (CLAUDE.md targets 18+/24.x; works) | — |
| jsdom | renderer/capture/reconciler unit tests | ✓ | ^29.1.1 (in node_modules) | — |
| Playwright | real-Chrome media UAT (autoplay, seek-on-live, real fetch) | ✓ | ^1.60.0 (devDependency) | UAT may be DEFERRED per project precedent (STATE.md Phase 12-03) |
| Real Chromium | exercising real `play()`/autoplay/`seekable` | ✓ via Playwright | — | jsdom unit tests + documented manual UAT cover the gap |
| npm packages (new) | — | n/a | — | none needed — zero new deps |

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:** Real-browser media behavior (autoplay gating, `seekable.end` throwing, true timeline advance) is not exercisable in jsdom — the fallback is the established project pattern: jsdom unit tests for everything pure/message-flow, plus a **documented Playwright/manual UAT** for the real-playback assertions (STATE.md `[Phase 12-03]`: "Playwright asset UAT DEFERRED … jsdom never parses srcdoc/enforces CSP/fetches").

## Validation Architecture

> nyquist_validation is enabled (`.planning/config.json` workflow.nyquist_validation: true). [VERIFIED: config read this session]

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Node built-in `node:test` + `node:assert/strict`; jsdom ^29.1.1 for DOM |
| Config file | none — `package.json` `scripts.test` = `node --test tests/*.test.js tests/differential/*.test.js` |
| Quick run command | `node --test tests/media-reconcile.test.js` (the pure reconciler — fast, no jsdom) |
| Full suite command | `node --test tests/*.test.js tests/differential/*.test.js` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| MWIRE-02 | Reconciler hold band (drift ≤ 0.25 s → hold) | unit (pure) | `node --test tests/media-reconcile.test.js` | ❌ Wave 0 |
| MWIRE-02 | Reconciler rate-nudge (0.25–1.0 s drift → ±≤5% rate, correct sign behind/ahead) | unit (pure) | `node --test tests/media-reconcile.test.js` | ❌ Wave 0 |
| MWIRE-02 | Reconciler nudge revert (back in-band → revertRate = true rate) | unit (pure) | `node --test tests/media-reconcile.test.js` | ❌ Wave 0 |
| MEDIA-03 | Hard-seek (drift > 1.0 s → seek to clamped expected) | unit (pure) | `node --test tests/media-reconcile.test.js` | ❌ Wave 0 |
| MEDIA-03 | Explicit `seeked` event → always hard-seek regardless of drift | unit (pure) | `node --test tests/media-reconcile.test.js` | ❌ Wave 0 |
| MEDIA-03 | Loop-wrap detected → seek to wrapped position, not raw delta | unit (pure) | `node --test tests/media-reconcile.test.js` | ❌ Wave 0 |
| MWIRE-02 | Live branch (`live:true`/non-finite duration) → never absolute-seek; rejoin-edge only on large drift | unit (pure) | `node --test tests/media-reconcile.test.js` | ❌ Wave 0 |
| MWIRE-02 | NaN/edge traps (Infinity duration, duration 0, negative elapsed, rate 0, paused remote, missing fields) → no `NaN`, safe action | unit (pure) | `node --test tests/media-reconcile.test.js` | ❌ Wave 0 |
| MWIRE-02 | Latency compensation: `expected = currentTime + rate*(now−sentAt)/1000` (table-driven) | unit (pure) | `node --test tests/media-reconcile.test.js` | ❌ Wave 0 |
| MWIRE-01 | `STREAM.MEDIA` constant + `MediaSyncPayload` typedef exported | unit | `node --test tests/protocol.test.js` (extend) | ⚠️ extend existing |
| MWIRE-01 | Old viewer (dispatch without `STREAM.MEDIA` case) silently ignores the message; no throw, no state change | unit (jsdom) | `node --test tests/renderer-media.test.js` | ❌ Wave 0 |
| MWIRE-01 | Envelope + relay unchanged: `STREAM.MEDIA` round-trips raw under 1 MiB cap (no envelope special-casing) | unit | `node --test tests/protocol.test.js` / relay test (extend) | ⚠️ extend existing |
| MEDIA-02 | Snapshot `media[]` baseline present, correct shape, NOT in `payload.html` | unit (jsdom) | `node --test tests/capture-media.test.js` | ❌ Wave 0 |
| MEDIA-02 | `live = !isFinite(duration)`; `duration` omitted when non-finite (Infinity→null trap) | unit (jsdom) | `node --test tests/capture-media.test.js` | ❌ Wave 0 |
| MEDIA-02/04 | Discrete events emit immediately; `timeupdate` throttled at 250 ms and only while playing | unit (jsdom, stubbed element + fake timers) | `node --test tests/capture-media.test.js` | ❌ Wave 0 |
| MEDIA-04 | A mutation-added `<video>` AND `<audio>` get listeners (added-node coverage) | unit (jsdom) | `node --test tests/capture-media.test.js` | ❌ Wave 0 |
| MEDIA-01 | `handleMedia` resolves nid, runs reconciler, calls driver (stubbed element records play/pause/currentTime=) | unit (jsdom, `Object.defineProperty` stub) | `node --test tests/renderer-media.test.js` | ❌ Wave 0 |
| MEDIA-05 | `play()` returning a rejected promise → affordance shown + `onMediaBlocked(nid)` called; mirror not wedged | unit (jsdom, `el.play = () => Promise.reject(new DOMException('x','NotAllowedError'))`) | `node --test tests/renderer-media.test.js` | ❌ Wave 0 |
| MEDIA-05 | `play()` returning `undefined` (jsdom) does not throw (the `if (p !== undefined)` guard) | unit (jsdom) | `node --test tests/renderer-media.test.js` | ❌ Wave 0 |
| MEDIA-05 | Driver defaults `muted = true` before first programmatic play | unit (jsdom) | `node --test tests/renderer-media.test.js` | ❌ Wave 0 |
| MEDIA-05 | `mediaMode:'poster'` → no source bound / no `.play()`; poster shown; affordances absent | unit (jsdom) | `node --test tests/renderer-media.test.js` | ❌ Wave 0 |
| MEDIA-01/MSEC | `media-src http: https: data:` present in srcdoc CSP_META; `default-src 'none'`/no `script-src` retained; no `blob:` | unit (string assertion) | `node --test tests/renderer-media-csp.test.js` (or extend renderer-asset-gate) | ❌ Wave 0 |
| MEDIA-01/MSEC | `<video src>` / `<video poster>` / `<source src>` to a BLOCKED origin neutralized at the STRING layer before srcdoc (gate runs pre-parse) | unit (string assertion) | `node --test tests/renderer-media-csp.test.js` | ❌ Wave 0 |
| MWIRE-01 | Identity staleness: a `STREAM.MEDIA` with a mismatched `streamSessionId`/`snapshotId` is rejected by `isCurrentStream` | unit (jsdom) | `node --test tests/renderer-media.test.js` | ❌ Wave 0 |
| (oracle) | Differential oracle still green with a `media-playback-sync` fixture/scenario + new ledger entry | integration | `node --test tests/differential/oracle.test.js` | ❌ Wave 0 (if needed — see Oracle Impact) |
| (driver, UAT) | Real Chrome: muted autoplay in `allow-same-origin` srcdoc; live `seekable.end` no-throw guard; real seek lands | manual/Playwright UAT | documented UAT step (deferrable per project precedent) | ❌ documented manual |

### Sampling Rate
- **Per task commit:** `node --test tests/media-reconcile.test.js` (reconciler — sub-second) plus the touched module's test file.
- **Per wave merge:** `node --test tests/*.test.js tests/differential/*.test.js` (full suite, includes the oracle).
- **Phase gate:** Full suite green (baseline today is 449/449 per STATE.md) before `/gsd:verify-work`; the documented real-Chrome media UAT recorded (or explicitly deferred by the user, matching the Phase 12-03 / Phase 6 UAT-deferral precedent).

### Wave 0 Gaps
- [ ] `tests/media-reconcile.test.js` — pure reconciler table tests (covers MWIRE-02 + MEDIA-03; the bulk of the phase's automated value)
- [ ] `tests/capture-media.test.js` — baseline shape, Infinity→null encoding, throttle/heartbeat, added-node listener coverage (MEDIA-02/04)
- [ ] `tests/renderer-media.test.js` — `handleMedia` dispatch, stubbed-element driver, play()-rejection affordance + `onMediaBlocked`, play()-undefined guard, mediaMode poster, staleness gate, **old-viewer-ignores backward-compat** (MEDIA-01/05, MWIRE-01)
- [ ] `tests/renderer-media-csp.test.js` (or extend `tests/renderer-asset-gate.test.js`) — `media-src` in CSP_META; `<video>/<source>/poster` string-layer gating pre-parse (MEDIA-01 + MSEC)
- [ ] `tests/protocol.test.js` — EXTEND: assert `STREAM.MEDIA` + `MEDIA_SYNC_THROTTLE_MS` exported (the Phase 8/9 protocol-constant assertions are the precedent at `tests/protocol.test.js`)
- [ ] `tests/differential/fixtures/media-playback-sync.html` + `tests/differential/scenarios/media-playback-sync.js` + a new ledger entry — ONLY if the oracle would hard-fail (see Oracle Impact; land entry + firing fixture together to avoid stale-entry failure)
- [ ] Framework install: none — `node:test` + jsdom already present.

## Differential Oracle Impact

**Will emitting `STREAM.MEDIA` / `media[]` require a new ledger entry?** **Yes, with a caveat.** The FSB reference capture (`reference/extension/dom-stream.js`) emits neither a `media[]` snapshot array nor any `STREAM.MEDIA` message. The oracle compares the extracted stream against the reference message-for-message and hard-fails on any undeclared divergence (`oracle.test.js` via `ledgerCovers`, `tests/differential/divergence-ledger.js:758`). [VERIFIED: divergence-ledger.js read this session]

**BUT** the divergence only materializes if a fixture actually instantiates a `<video>/<audio>` AND the scenario drives a media event — otherwise the extracted side emits no media message and there is no mismatch, which would make a premature ledger entry go **stale** and FAIL the stale-entry detector (`oracle.test.js`). This is the exact lesson of D26 (Phase 12): the entry and a fixture that deterministically triggers it must land together, and the predicate must claim the divergence's *exact* shape. [CITED: divergence-ledger.js D26, lines 622-661; STATE.md `[Phase 12-02]` D26-only rationale]

**Recommended entry shape** (model: D26, `divergence-ledger.js:622`):

```js
{
  id: 'D27-media-playback-sync',
  kind: 'mismatch',
  description:
    'Phase 13 media-by-reference: the extracted core enriches the SNAPSHOT with a '
    + 'media[] baseline array (currentTime/paused/muted/volume/playbackRate/loop/'
    + 'duration|live/ended keyed by nid) and emits STREAM.MEDIA side-channel messages '
    + 'for play/pause/seeked/ratechange/heartbeat. The FSB reference has neither the '
    + 'media[] field nor a STREAM.MEDIA op, so the media-playback-sync fixture diverges.',
  rationale:
    'MEDIA-02/MEDIA-03/MWIRE-01 (13-CONTEXT locked): media state travels as side-channel '
    + 'data keyed by nid (DIFF_OP.VALUE precedent), never baked into the HTML clone; the '
    + 'reference emits no media surface. Pinned to the media-playback-sync scenario.',
  affectedMessages: [STREAM.SNAPSHOT, STREAM.MEDIA],
  affectedScenarios: ['media-playback-sync'],
  appliesTo(refMsg, extMsg, scenarioName) {
    if (scenarioName !== 'media-playback-sync') return false;
    // Shape A: extracted-only trailing STREAM.MEDIA message (reference emits none).
    if (refMsg === undefined && extMsg !== undefined && extMsg.type === STREAM.MEDIA) return true;
    // Shape B: same-index SNAPSHOT where only the extracted payload carries media[].
    if (refMsg !== undefined && extMsg !== undefined
        && refMsg.type === STREAM.SNAPSHOT && extMsg.type === STREAM.SNAPSHOT) {
      var extHasMedia = Array.isArray(extMsg.payload && extMsg.payload.media) && extMsg.payload.media.length > 0;
      var refHasMedia = Array.isArray(refMsg.payload && refMsg.payload.media) && refMsg.payload.media.length > 0;
      return extHasMedia && !refHasMedia;
    }
    return false;
  }
}
```

**`normalize.js` caveat:** if the reference normalizer does not produce a `media` field, the SNAPSHOT comparison will already diverge on that key; confirm `normalize.js` does not strip unknown payload keys (D26 did not require a normalizer change for `data-ps-currentsrc` because it lived in `html`; `media[]` is a NEW top-level payload field, so verify the comparator includes it). If two distinct same-index SNAPSHOT divergences could fire, follow the D26 single-predicate discipline (STATE.md `[Phase 12-02]`: "compareStreams returns the first match … a second entry could never fire and would fail stale-entry detection").

**`media-playback-sync` fixture/scenario shape** (model: `scenarios/static-assets.js` + `scroll.js`):
- **Fixture** `media-playback-sync.html`: a `<video id="media-vid" src="https://cdn.fixture.test/clip.mp4"></video>` (and optionally an `<audio>`), present at snapshot time so `media[]` is non-empty.
- **Scenario** `media-playback-sync.js`: a `beforeStart` that `Object.defineProperty`-stubs the element's `currentTime`/`paused`/`duration` to deterministic values on BOTH sides (harmless on the reference, load-bearing on the extracted side — exactly the static-assets `currentSrc` injection trick), then a `run` that dispatches a `new Event('play')` and (after a >250 ms wait) a `new Event('timeupdate')` to exercise discrete + heartbeat emission. jsdom fires dispatched events to listeners even though it does not implement real playback. [VERIFIED: jsdom probe — listeners fire on dispatched events; `currentTime`/`paused` redefinable via defineProperty]

## Security Domain

> No `security_enforcement` key in config, but this phase opens a viewer-side **fetch** surface for media and is explicitly security-threaded (STATE.md `[Roadmap v2.0]`: "Security is THREADED"). Section included.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V5 Input Validation / Output Encoding | yes | All affordance text via `textContent` (never `innerHTML`); only static inline-SVG glyphs use `innerHTML` (the existing `ICON_SVG` precedent). Wire media URLs are TYPED values rewritten in-markup at the string layer, not DOM-reparse (avoids mXSS). [UI-SPEC security invariant] |
| V12 / SSRF (viewer-side fetch) | yes | `gateAssetUrl` + `classifyAssetOrigin` fail-closed https-only + private-range denylist (`src/renderer/index.js:113`, `src/renderer/asset-policy.js`) applied to `<video src>`/`poster`/`<source src>` at the STRING layer BEFORE srcdoc parse (Pitfall 5). The viewer's browser is the SSRF vector; the gate is the control. |
| V14 Config / CSP | yes | `media-src http: https: data:` added to `CSP_META`; `default-src 'none'` and absence of `script-src` retained; **no `blob:`** (Phase 14). CSP is the backstop; the string-layer gate is the primary control. |
| Sandbox isolation | yes | Iframe sandbox stays exactly `allow-same-origin` (asserted `src/renderer/index.js:443-446`); NO `allow-scripts`; no player code in the mirror. Parent-realm drive only. |
| V6 Cryptography | no | No crypto in this phase. |
| V2/V3/V4 AuthN/Session/AccessControl | no | No auth/session surface added; relay/envelope untouched. |

### Known Threat Patterns for {viewer-side media fetch}

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Viewer-side SSRF via `<video src>`/`poster`/`<source src>` to internal/private host | Information Disclosure / Elevation | `classifyAssetOrigin` fail-closed (denies localhost/127/10/172.16/12-boundary/192.168/169.254/::1/fc00::/.local/unqualified); string-layer gate pre-parse |
| Tracking-pixel / live-viewer confirmation via media GET to an attacker origin | Information Disclosure | Same origin gate + `mediaMode` posture (`off` blocks all fetch); the GET never issues for a blocked origin |
| Prefetch-before-scrub (parser fetches `<video src>`/`poster` during srcdoc parse) | Information Disclosure | Authoritative gate at the STRING layer in `gateSnapshotAssets`, not the post-parse pass (Pitfall 5) |
| Script execution inside the mirror via a media element trick | Tampering / Elevation | Sandbox `allow-same-origin` only; no `allow-scripts`; affordances in parent realm; `default-src 'none'` (no `script-src`) |
| mXSS via scrub-then-reparse of media markup | Tampering | Rewrite TYPED attribute values in the markup-about-to-emit (the existing snapshot.js discipline), never serialize-sanitized-DOM-then-reparse |
| `onMediaBlocked` host hook throwing into the renderer | Denial of Service | Hook errors contained to the logger, never thrown (the Phase 12 `assetOriginPolicy`-hook pattern) [UI-SPEC] |
| Oversized/`data:` media inline blowing the 1 MiB cap | Denial of Service | `media-src` allows `data:` for small poster data URIs only; media BYTES never inlined (reference-only); relay 1 MiB cap untouched |

## Sources

### Primary (HIGH confidence)
- Codebase (read this session): `src/protocol/constants.js`, `src/protocol/messages.js`, `src/capture/index.js` (scroll tracker 4514-4555, value diff 1830-1986, added-node loop 4020-4076, serializeDOM payload 3680-3714, lifecycle 4620-4686, safeSend 634), `src/renderer/index.js` (gateAssetUrl 104-151, dispatch+handlers 1455-1552, sandbox 443-446, post-parse load 449-504, nid resolver 880-925, gateFragmentAssets 362-405, mediaMode plumbing 303-323), `src/renderer/snapshot.js` (string-gate 43-320, CSP_META 322-341), `src/renderer/overlays.js` (registry 348-516), `tests/differential/divergence-ledger.js` (full), `tests/differential/oracle.test.js` (40-129), `tests/differential/scenarios/static-assets.js`, `scroll.js`, `package.json`, `.planning/config.json`
- Empirical jsdom probes (run this session, jsdom ^29.1.1): `play()` returns `undefined` ("Not implemented"), `currentTime` settable/no-timeline/no-`seeked`, `duration === null` unloaded, `readyState === 0`, `HAVE_*` constants on `window.HTMLMediaElement`, `seekable.length === 0`/`end(0)===0` (lenient), `Object.defineProperty` on `paused`/`currentTime`/`duration` works, stubbed `play()` rejected promise → `NotAllowedError`
- [github.com/rrweb-io/rrweb /packages/rrweb/src/replay/media/index.ts] — MediaManager interpolation formula (`currentTimeAtLastInteraction + (elapsed/1000)*playbackRate`), unconditional seek, `void target.play()`, conditional play/pause + volume/muted/loop/rate set
- [github.com/rrweb-io/rrweb /packages/rrweb/src/replay/index.ts] — MediaInteraction delegation to MediaManager
- [developer.chrome.com/blog/autoplay] — "Muted autoplay is always allowed"; `play()` without gesture → `NotAllowedError`; `allow="autoplay"` controls cross-origin/unmuted delegation
- [developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay] — autoplay success conditions; the `if (startPlayPromise !== undefined) … .catch(name==='NotAllowedError')` pattern
- [developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/play] — `play()` rejects with `NotAllowedError` when disallowed
- [html.spec.whatwg.org/multipage/media.html] — readyState HAVE_NOTHING aborts seek; seeking/seeked semantics; media events non-bubbling
- [developer.mozilla.org/en-US/docs/Web/API/TimeRanges/end] — `end(i)` throws `IndexSizeError` for `i >= length`

### Secondary (MEDIA confidence)
- [github.com/shaka-project/shaka-player] — waits for `readyState >= 1` (loadedmetadata) before setting `currentTime` (best practice for seek gating)
- [bugzilla.mozilla.org/show_bug.cgi?id=1442186] — Firefox `play()` promise can stay pending when a tab is backgrounded (motivates a timeout fallback)
- WebSearch (video sync drift): rate-nudge-vs-threshold-vs-hard-seek is the standard co-watching pattern; feedback-loop caution when monitors ignore existing rate changes

### Tertiary (LOW confidence)
- Sandbox×autoplay interaction for muted programmatic play in an `allow-same-origin`-only iframe is undocumented in primary sources — flagged as Open Question 1 / Assumption A1, UAT-gated.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new deps; all seams verified by reading the shipped code this session.
- Architecture (reconciler + cross-realm drive): HIGH — rrweb model extracted from source; autoplay model from Chrome/MDN; jsdom seam empirically probed.
- Pitfalls: HIGH — each anchored to a primary source or an empirical probe; the one residual ambiguity (muted autoplay in sandbox) is explicitly UAT-gated, not asserted.
- Differential oracle: HIGH — entry/fixture shape modeled directly on the shipped D26 + stale-entry discipline read this session.
- Security: HIGH — reuses Phase 12 controls verbatim; the new media-prefetch hole and its string-layer fix are precisely located.

**Research date:** 2026-06-20
**Valid until:** ~2026-07-20 for the autoplay/jsdom/spec facts (stable); the rrweb formula is stable (model, not a pinned version). Re-verify the rrweb `media/index.ts` path only if a plan intends to vendor rrweb code (it should not — the reconciler is original).
