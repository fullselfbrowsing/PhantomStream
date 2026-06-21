# Pitfalls Research

**Domain:** DOM-native browser mirroring — adding media-and-assets-by-reference + playback sync to an existing sandboxed, sanitized, low-bandwidth mirror (PhantomStream v2.0)
**Researched:** 2026-06-19
**Confidence:** HIGH for the security/CSP/sandbox and browser-policy items (verified against shipped `src/capture/index.js`, `src/renderer/sanitize.js`, `src/renderer/snapshot.js`, `src/renderer/index.js`, `docs/SECURITY.md`, and MDN/WHATWG); HIGH for `timeupdate` cadence and `media-src`/`connect-src` semantics (MDN/WHATWG verified); MEDIUM for drift-tolerance numbers and the jsdom testing tactics (practice-based, single-runtime-verified).

> **Phase vocabulary** used in the `Phase to address` fields, per the milestone brief:
> **P1 = static assets** (images/srcset/poster-by-reference, URL absolutification + scope);
> **P2 = video/audio sync** (`<video>`/`<audio>`/`<source>` by reference + playback-state channel);
> **P3 = adaptive + fallback** (HLS/DASH manifest URLs best-effort, MSE/DRM/blob poster fallback);
> **P4 = security + masking** (viewer-side-fetch threat model, signed-URL/PII leakage, media masking, CSP/sandbox contract).
> Several pitfalls below are **cross-cutting**: the protocol/CSP/threat-model decisions in P4 must be made *before or alongside* P1/P2 even though P4 is listed last, because every earlier phase emits content the viewer fetches. This is called out per-pitfall.

---

## The one-paragraph version (for the roadmapper)

PhantomStream's entire value rests on a contract that v2.0 quietly breaks: **the viewer is a sandboxed iframe with no `allow-scripts` and a CSP of `default-src 'none'` (only `img-src`/`style-src`/`font-src` opened).** Media-by-reference changes three invariants at once — (1) the viewer now *fetches bytes from third-party origins on its own network* (a brand-new SSRF/tracking/exfil surface that v1 never had, because v1 only ever rendered inert DOM); (2) the CSP must grow a `media-src` (and possibly `connect-src`) or every mirrored `<video>` is silently blocked; (3) playback state is *time-varying data* that, done naively, spams the wire 4–60×/s and erodes the low-bandwidth core value. The highest-severity pitfalls are therefore not in the player — they are in **what URLs the viewer is allowed to fetch, what leaks in those URLs, and how the CSP/sandbox contract is widened.** Treat the security/CSP/threat-model work (P4) as a *gate that precedes* the visible media features, not a cleanup pass after them.

---

## Critical Pitfalls

### Pitfall 1: Mirrored `<video>`/`<audio>` is silently blocked by the existing CSP (no `media-src`)

**What goes wrong:**
The shipped srcdoc CSP (`src/renderer/snapshot.js`, `CSP_META`) is exactly:
`default-src 'none'; img-src http: https: data:; style-src http: https: 'unsafe-inline'; font-src http: https: data:`.
There is **no `media-src` and no `connect-src`.** Media loaded by `<audio>`/`<video>`/`<source>`/`<track>` is governed by `media-src`, which **falls back to `default-src` when absent** — and `default-src` here is `'none'`. So the moment capture starts emitting real `<video src>`/`<source>` instead of a poster `<img>`, the mirror fetches *nothing*: the element renders as a broken/empty player with a CSP violation in the console, and it looks like "the URL is wrong" when it is actually "the policy forbids all media." Teams burn days debugging the URL plumbing while the real fix is one CSP directive.

**Why it happens:**
v1 deliberately degraded `<video>` to a poster image (an `<img>`, allowed by `img-src`), so nobody ever needed `media-src`. The CSP is also delivered by `<meta>` (the mirror is `srcdoc`, not a fetched URL), and meta-CSP failures are easy to miss because they don't break the page chrome — only the media subresource.

**How to avoid:**
- In the phase that first emits media, **extend `CSP_META` to add a `media-src`** scoped as tightly as the threat model allows (start `media-src https:` — and explicitly decide whether `data:`/`blob:` are allowed; see Pitfalls 8 and 11). Keep `default-src 'none'`; only widen the one directive media needs.
- If the viewer (parent frame) will fetch manifests/segments itself for HLS/DASH or validity probing, you also need **`connect-src`** for those origins (and `worker-src`/`script-src` are still forbidden — the parent does the fetch, never the sandbox; see Pitfall 5).
- Add a test that asserts the assembled srcdoc contains the expected `media-src` and **still contains `default-src 'none'` with no `script-src`** — the v1 chokepoint-purity test (`tests/security-chokepoint-purity.test.js`) is the natural home, extended to media.
- Update `docs/SECURITY.md` §2.4 (the CSP block) in the same change; the SECURITY.md marker guard in the purity test will otherwise fail, which is the intended forcing function.

**Warning signs:**
Console "Refused to load media because it violates the following Content Security Policy directive: default-src 'none'"; mirror shows a play button that does nothing; video element has `networkState === NETWORK_NO_SOURCE`.

**Phase to address:** P2 for the directive itself (first real media), but the **decision** (which origins, `data:`/`blob:` yes/no, `connect-src` or not) is a **P4 contract** that must be settled before P2 ships. Cross-cutting.

---

### Pitfall 2: The viewer fetching attacker-controlled media URLs is a new SSRF / tracking / beaconing surface (the defining v2.0 security pitfall)

**What goes wrong:**
v1's threat model (`docs/SECURITY.md` §1) is "the page is attacker-influenced *input*, but the mirror renders it **inert**." v2.0 changes the verb from *render* to **fetch**: the viewer's browser now issues GET requests to URLs chosen by the captured (attacker-influenced) page, **from the viewer's network position, with the viewer's IP, cookies-to-third-parties policy, and reachability.** That turns the viewer into:
- a **tracking-pixel firing range** — every `<img src=https://attacker/track?session=…>` or media URL is a confirmed-open beacon that tells the attacker "a human is watching this mirror, here is their IP/UA/timing";
- an **SSRF pivot** — if the viewer runs anywhere with privileged network reach (a corporate dashboard, a CI box, an internal admin console embedding the SDK), a captured `src=http://169.254.169.254/…` or `http://internal-host/…` is fetched *by the viewer*, not the capture box, exfiltrating internal responses' side effects (timing, load success/failure) even though the sandbox prevents reading the bytes;
- a **DoS amplifier** — a page can reference hundreds of multi-MB media URLs the viewer dutifully fetches.

This risk did not exist in v1 *at all*. It is the single most important thing the roadmap must internalize: **media-by-reference is the first feature where the viewer talks to the network on behalf of untrusted content.**

**Why it happens:**
The mental model "we already sanitize URLs, so URLs are safe" conflates *injection* safety (can this URL execute script? — handled by `hasDangerousScheme`) with *fetch* safety (should the viewer's browser be made to retrieve this resource at all?). The existing scheme blocklist allows `http:`/`https:` to **any host** because for inert images that was fine. For an opt-in remote-control-grade product embedded in privileged dashboards, "fetch any http(s) host the page names" is a meaningfully larger blast radius.

**How to avoid:**
- Make this an explicit, documented **threat-model addition in `docs/SECURITY.md`** ("Viewer-side resource fetching"), not an implicit consequence. Name SSRF, tracking, and beaconing as in-scope risks.
- **Lean on `referrerpolicy` and `crossorigin` defaults that minimize leakage** (Pitfalls 6, 12) and keep the iframe `sandbox` exactly `allow-same-origin` (no `allow-scripts`) so fetched media can never *execute* even if a content-type is confused.
- Provide a **host-owned URL policy hook** (allow/deny by origin, scheme-https-only, optional same-origin-only, optional private-IP/`localhost`/link-local denylist) applied **at the renderer before the URL is written into the mirror** — fail-closed (deny on hook throw), mirroring the capture-side `compileMaskSelector` "fail closed and loud" precedent. Default should be conservative (https-only; block obvious internal ranges) with the host able to widen.
- Document that **media-by-reference shifts the fetch to the viewer's network**, so hosts embedding the viewer in privileged contexts must set the policy hook. This is the analogue of v1's "Host must-nevers" list.
- Consider an **opt-in `mediaMode`** (e.g. `'off' | 'poster' | 'reference'`) so a security-sensitive host can keep v1's inert-poster behavior; reference fetching should be a choice, not a forced default for everyone who upgrades.

**Warning signs:**
Unexpected outbound requests from the viewer host to third-party/internal hosts; mirror "works" but the captured page is exfiltrating viewer telemetry; pen-test finding "blind SSRF via mirrored media URL."

**Phase to address:** **P4 owns the threat model, the policy hook, and the `mediaMode` switch — and these must land before or with P1**, because even static images (Pitfall 1's `img-src` already allows arbitrary hosts in v1) are part of this surface the moment v2.0 leans into asset-by-reference as a feature. Highest priority in the milestone.

---

### Pitfall 3: Naive `currentTime`-setting on every sync message causes a seek-storm (stutter, audio glitches, decoder thrash)

**What goes wrong:**
The obvious sync implementation is "on each sync message, set `mirrorVideo.currentTime = sourceTime`." Setting `currentTime` is **not** a cheap assignment — it triggers a `seeking` event, a seek/`flush` in the decoder pipeline, a re-buffer at the new position, and a `seeked` event. Do that 4–60×/s (or even once a second against a value that's always slightly off) and the mirror video **stutters, drops frames, clicks audibly, and may spin in permanent re-buffering** because each seek interrupts the buffering started by the previous one. The mirror ends up *less* watchable than if you never synced at all.

**Why it happens:**
`currentTime` *reads* like a property, so it's assumed to be idempotent and cheap. Developers also over-correct: they treat any drift between source and mirror as an error to be hard-corrected immediately, instead of letting the mirror's own clock run and only intervening when drift exceeds a tolerance.

**How to avoid:**
- **Drift-tolerance, not continuous correction.** Let the mirror element play on its own decode clock. On each (throttled) sync sample, compute `drift = mirror.currentTime - expectedSourceTime`. If `|drift|` is **within tolerance** (start ~0.25–0.5s for VOD; tune), do nothing. If drift is **small but persistent**, nudge with `playbackRate` (e.g. 0.95–1.05) to converge smoothly without a seek. **Hard-seek (`currentTime =`) only when drift is large** (e.g. > ~1–2s, or on an explicit seek event from source — Pitfall 4).
- Debounce/guard hard-seeks behind the `seeking`/`seeked` cycle: never issue a new `currentTime` write while `mirror.seeking === true`.
- Account for transport latency in `expectedSourceTime`: the source time in a message is stale by the relay one-way delay; extrapolate `expectedSourceTime = messageSourceTime + (now - messageRecvTime)` while the source was playing.

**Warning signs:**
Mirror video micro-stutters in lockstep with sync message arrival; `seeking`/`seeked` events firing continuously; audio crackle; mirror never reaches `readyState >= HAVE_FUTURE_DATA`.

**Phase to address:** **P2** (the playback-state channel and the drift-tolerance reconciler are its core deliverable).

---

### Pitfall 4: Driving sync off `timeupdate` (it only fires ~4Hz) — and mishandling seek / buffering / ratechange / ended / loop as if they were `timeupdate`

**What goes wrong:**
Two linked mistakes:
1. **Using `timeupdate` as the sync clock.** Per WHATWG/MDN, `timeupdate` is deliberately throttled — typically **~4 times per second (~250ms)**, varying 4–66Hz by load. Sampling source time only on `timeupdate` gives a jittery, coarse signal; building a tight reconciler on top of a 250ms-granular source is fighting the spec.
2. **Modeling playback as just "a current time."** Real playback has *state transitions* the mirror must mirror or it desyncs: the user **seeks** (jump, not drift — must hard-seek the mirror), the source **stalls/buffers** (`waiting`/`stalled` — the mirror should pause/hold, not keep playing into a gap), **rate changes** (`ratechange` — 1.5×/2× must propagate or drift compounds), **pause/play**, and **`ended`** with optional **loop** (a looping source jumps `currentTime` back to ~0; a mirror that only does drift-correction will see a huge negative drift and seek-storm at every loop boundary).

**Why it happens:**
`timeupdate` is the first event everyone finds, and the "currentTime number" mental model omits the state machine. Loop especially is a silent trap: `loop` causes a discontinuity that looks identical to "massive drift."

**How to avoid:**
- **Sample source time on a controlled cadence** (e.g. a capture-side throttle aligned to the existing side-channel cadence, ~200–500ms; see Pitfall 9) rather than blindly forwarding every `timeupdate`. Carry an explicit `paused`/`playing`/`buffering` state plus `playbackRate` and the source's wall-clock timestamp so the viewer can extrapolate between samples.
- **Model playback as a small state machine** and send discrete events for transitions: `seeking`→`seeked` (mirror hard-seeks), `waiting`/`stalled`→`playing` (mirror holds/resumes), `ratechange` (mirror sets `playbackRate`), `pause`/`play`, `ended`. Capture from the source element's events; apply to the mirror element.
- **Handle loop/`ended` explicitly:** treat a backward time discontinuity at/near `duration` as a loop boundary, not drift — hard-seek the mirror to the new position instead of rate-nudging. Carry the source's `loop` flag in the playback state.
- Prefer `requestVideoFrameCallback` (where available) over `timeupdate` for sampling on the **capture** side when frame-accurate source time matters; feature-detect.

**Warning signs:**
Mirror lags ~0.25s behind in a sawtooth pattern (the `timeupdate` granularity); mirror keeps playing while source spinner is up; 1.5× source plays at 1× in mirror and drifts; mirror seek-storms exactly at video loop points.

**Phase to address:** **P2** (state-machine sync). The buffering/stall handling overlaps **P3** (adaptive streams stall more often).

---

### Pitfall 5: Putting the player logic *inside* the sandboxed iframe — but the sandbox has no `allow-scripts`, so it can't run

**What goes wrong:**
A natural design is "inject a small JS player/sync shim into the mirror document so it can drive its own `video.currentTime`." **It cannot run.** The mirror iframe's sandbox is asserted to be **exactly `allow-same-origin`** (`src/renderer/index.js` reads the token back and throws `viewer-sandbox-invalid` if it isn't a single token), and `docs/SECURITY.md` §5 makes "never add `allow-scripts`" a host must-never. Any script in the mirror is inert by design — that inertness is *the* XSS defense. So a team that builds the sync controller as in-mirror script discovers late that the whole approach is incompatible with the security contract, and the tempting "fix" (add `allow-scripts`) would reintroduce full script execution of attacker-influenced DOM. That is a catastrophic regression.

**Why it happens:**
Media playback control feels like it belongs "next to the media," i.e. in the document that holds the `<video>`. The sandbox constraint is easy to forget because v1 never needed to *script* the mirror — it only read geometry and applied diffs from the parent.

**How to avoid:**
- **Drive playback from the parent (host) frame, never from inside the sandbox.** The parent already has `allow-same-origin` reach into the mirror document (that's how diffs are applied via the identity `Map<nid, Node>`). The parent resolves the media element by nid and sets `currentTime`/`playbackRate`/calls `play()`/`pause()` on it. This keeps the controller in trusted code and the mirror script-free.
- Treat the playback reconciler as a **renderer module that operates on resolved mirror nodes** (same shape as `diff.js` applying ops), not as injected content.
- Keep the sandbox-token assertion exactly as-is and **add a test that media support did not weaken it** (extend the `allow-scripts`-forbidden scan to the media code paths).
- Remember `play()` from the parent is still subject to the *viewer's* autoplay policy (Pitfall 7) — parent-driven control does not bypass browser gesture requirements.

**Warning signs:**
PRs that add a `<script>` to the mirror srcdoc or sync shim; any diff that touches the `sandbox` attribute; `viewer-sandbox-invalid` thrown in tests after the media change; design docs that say "the mirror plays itself."

**Phase to address:** **P2** (architecture of the sync controller), with the sandbox-invariant test extension as a **P4** gate.

---

### Pitfall 6: Signed / expiring CDN URLs are valid at capture but dead by the time the viewer loads them

**What goes wrong:**
Modern media is served from CDNs behind **signed URLs** with short TTLs (tokens in query strings, `?Expires=…&Signature=…`, `X-Amz-…`, `token=…`, cookie- or header-bound signatures). PhantomStream captures the URL at time T and the viewer fetches it at T+latency+watch-delay. By then the token may be expired (403/410), single-use (already consumed by the source page's own player), or bound to the *source's* cookies/headers that the viewer doesn't have. Result: the mirror shows broken media even though "the URL is right" — it was right for the source, at that instant, with those credentials. This is *the* most common real-world breakage for media-by-reference and it's intermittent (works in dev against unsigned test assets, fails on real CDNs).

**Why it happens:**
Dev/test uses static unsigned files; signed-URL behavior only shows up against production CDNs. The capture↔view time gap and the credential gap are invisible until you test cross-network with real assets.

**How to avoid:**
- **Set expectations in the design + docs:** media-by-reference is **best-effort**, and signed/single-use/credential-bound URLs are a documented limitation (sibling to v1's cross-origin-iframe limitation in `docs/SECURITY.md` §6).
- **Re-resolve at fetch time, not capture time, where possible:** prefer capturing the element's *current* `currentSrc`/`src` lazily and, for live/long media, refresh the URL on a cadence or on a viewer-side fetch failure (re-request from capture) rather than freezing one URL for the whole session.
- **Detect and surface failure** instead of showing a dead element: listen for the mirror element's `error`/`stalled`, and fall back to **poster** (Pitfall 11) with a "media unavailable in mirror" affordance.
- **Never assume single-use tokens can be shared** — if the source page consumed the token, the viewer's fetch 403s; treat that as expected, fall back gracefully.
- Be aware re-sending fresh signed URLs has a **leakage cost** (Pitfall 10): the token is a credential on the wire.

**Warning signs:**
Mirror media 403/410s only against production CDNs; works for the first viewer to load and fails for a second; media that played fine in a same-network demo dies cross-network.

**Phase to address:** **P3** (validity/fallback is its theme) for the resolution/refresh logic; the leakage angle is **P4** (Pitfall 10).

---

### Pitfall 7: Viewer autoplay policy blocks `play()` — the mirror sits frozen on frame 0 with no gesture

**What goes wrong:**
Browsers block programmatic `play()` of media **with audio** unless there's been a user gesture in the *viewer* (or the media is `muted`). The capture side may be happily playing (the source page had a gesture); the viewer never did. So parent-driven `play()` rejects with `NotAllowedError`, the promise is often unhandled, and the mirror freezes on the first frame while the source plays on — a desync that looks like "sync is broken" but is really "autoplay denied."

**Why it happens:**
Autoplay policy is viewer-local and gesture-gated; it's invisible in dev where you click the page. The `play()` promise rejection is easy to drop on the floor.

**How to avoid:**
- **Mirror with `muted` autoplay by default** (muted autoplay is allowed without a gesture) so motion stays in sync; offer an **unmute affordance** that, because it's a user gesture in the viewer, unlocks audio.
- **Always handle the `play()` promise rejection** — on `NotAllowedError`, show a "click to play in mirror" overlay (a viewer gesture), don't silently freeze.
- Distinguish "source is playing but mirror is gesture-blocked" in the reconciler so it shows the right affordance instead of seek-storming trying to catch up to a video that can't start.
- Document that **audio in the mirror requires a viewer gesture** — a product expectation, not a bug.

**Warning signs:**
`Uncaught (in promise) DOMException: play() failed because the user didn't interact`; mirror stuck on frame 0; audio never plays in the mirror though video does once muted.

**Phase to address:** **P2** (it's core to making sync visibly work). The muted-by-default + unmute UX is a P2 deliverable.

---

### Pitfall 8: `blob:`/`object` URLs and MSE/`MediaSource` are origin-local and unshareable — capturing them sends dead references

**What goes wrong:**
A large fraction of real video (YouTube, most adaptive players, anything using Media Source Extensions) does **not** have a fetchable file in `video.src`. Instead `src` (or `currentSrc`) is a **`blob:` URL** that points at an in-memory `MediaSource` object created by the source page's JS. `blob:`/`object` URLs are **scoped to the origin and document that created them** — they are meaningless anywhere else. Capture `video.src`, send `blob:https://youtube.com/…`, and the viewer's fetch fails instantly (it's not a real network URL; it references memory the viewer doesn't have). The mirror is permanently blank for exactly the most common modern players, and naive implementations don't even detect *why*.

**Why it happens:**
`video.src` "is a URL string," so it's treated like any other. MSE/blob is invisible until you test against a real adaptive player; static `<video src=foo.mp4>` test fixtures never exercise it. The milestone brief already scopes "MSE-without-manifest" out — this pitfall is about *detecting and degrading* rather than failing blankly.

**How to avoid:**
- **Detect `blob:`/`object` scheme on media `src`/`currentSrc` at capture** and do **not** put it on the wire as a fetchable reference. Per the milestone scope: try the **HLS/DASH manifest URL** if discoverable (P3, best-effort); otherwise **fall back to poster** (Pitfall 11) and a documented "live-rendered media not mirrored" state.
- Don't attempt to serialize the `MediaSource`/buffered segments — that's the v1 "media pixels are a browser boundary" line; keep it out of scope explicitly (it's already in `docs/SECURITY.md` §6 as non-captured content) and make the *capture* side enforce it rather than emitting a broken URL.
- Detect MSE by feature (`video.src.startsWith('blob:')` and/or absence of a real `currentSrc`) and label the wire payload as `kind: 'unfetchable-media'` so the renderer shows the right fallback rather than a broken player.

**Warning signs:**
Mirror blank on YouTube/Twitch/most streaming sites while static-MP4 test pages work; `blob:` URLs on the wire; viewer fetch errors "Failed to load because no supported source was found" on exactly the adaptive players.

**Phase to address:** **P3** (fallback/adaptive is its theme); the capture-side *detection* (don't emit `blob:` as fetchable) is also touched in **P2** so video work doesn't ship blob references.

---

### Pitfall 9: The media-sync channel spams the wire and erodes the low-bandwidth core value (the product's whole reason to exist)

**What goes wrong:**
PhantomStream's identity is **low bandwidth** — that's the entire pitch vs. WebRTC/screencast (`PROJECT.md` Core Value; it's the paper's headline comparison). A naive playback-state channel sends a message **per `timeupdate` (4–60×/s) per media element**, plus rate/buffer/seek chatter. On a page with several `<video>`s (ad + content + autoplaying previews) this can dwarf the DOM diff traffic and **turn the low-bandwidth mirror into a chatty one** — quietly destroying the differentiator the project is built to demonstrate, and contaminating the evaluation numbers.

**Why it happens:**
"It's just a tiny number" reasoning ignores frequency × element-count × session-length. The side channels in v1 are *already* throttled (scroll 200ms, overlay 500ms) precisely for this reason, but a new contributor adding media may not apply the same discipline.

**How to avoid:**
- **Throttle the sync channel like the existing side channels** — reuse the established cadence (`SCROLL_THROTTLE_MS`/`OVERLAY_THROTTLE_MS` ~200–500ms) and define a `MEDIA_SYNC_THROTTLE_MS` constant in `src/protocol/constants.js` with the same "numeric literal + rationale comment" convention.
- **Send state on transitions + a low-rate heartbeat**, not a continuous stream: the viewer *extrapolates* `currentTime` between samples from `(timestamp, currentTime, playbackRate, playing)` (this is also why Pitfall 4's extrapolation matters). One sample every ~500ms + immediate events on seek/pause/rate is plenty for a drift reconciler.
- **Coalesce per element and drop duplicates** — if `playbackRate`/`paused` didn't change and time is within extrapolation tolerance, send nothing.
- **Measure it:** add media-sync bytes to the relay diagnostics (`receivedByType`) and to the evaluation harness so the bandwidth cost is visible and regression-tested, not assumed.

**Warning signs:**
Relay `receivedByType` shows `media-sync` rivaling `mutations`; bandwidth benchmarks regress after media lands; multi-video pages flood the channel.

**Phase to address:** **P2** (define the throttle + extrapolation as part of the channel design); verified in the evaluation harness (paper phase). This directly protects the **core value**, so it's high priority within P2.

---

### Pitfall 10: Signed URLs and PII-in-URLs leak across the wire and into viewer logs/referrers

**What goes wrong:**
Two leakage paths open at once:
1. **The wire now carries credentials.** Signed media/asset URLs embed tokens (`Signature`, `X-Amz-Security-Token`, session JWTs in query strings). Putting them on the relay wire means the **token is now visible to the relay operator and any viewer**, and re-sending fresh tokens (Pitfall 6's mitigation) multiplies the exposure. v1 never transported credentials of this sensitivity.
2. **PII in URLs.** Real apps stuff identifiers into asset/media URLs (`/u/12345/avatar.jpg?email=…`, `?user=…`, analytics params). Those flow straight to the viewer and then **leak again via the `Referer` header** to the third-party CDN when the viewer fetches them, and into any viewer-side request logging.

**Why it happens:**
URLs are treated as opaque "just a string to fetch," so nobody asks "is there a secret or a person's identity in this query string?" v1's masking vocabulary (`maskTextSelector`, `maskInputs`, password-always) targets *text and form values*, not *URL query parameters* — so the existing privacy controls don't cover this surface at all.

**How to avoid:**
- **Extend masking to URLs:** allow the host to redact/strip query parameters by name (denylist of token/PII param names) or by selector (mask media owned by matching elements entirely — Pitfall 13), routed through the **same capture-side chokepoint** (`sanitizeForWire`) so masked URLs never hit the wire raw (mirrors the v1 guarantee in `docs/SECURITY.md` §4).
- **Set `referrerpolicy="no-referrer"`** (or `origin`) on mirrored media/img elements so the viewer's fetch doesn't leak the (possibly PII-bearing) mirror URL to third-party CDNs (this also limits the v1 image case). Decide the default in P4.
- **Treat signed URLs as secrets on the wire:** document that enabling media-by-reference can place short-lived credentials on the relay, and that hosts handling sensitive media should use `mediaMode: 'poster'` or a strict masking policy. This is a `docs/SECURITY.md` residual-risk entry.
- Keep diagnostics **content-free** — never log full media URLs in relay/viewer telemetry (v1 already keeps health events content-free; preserve that for media).

**Warning signs:**
Signing tokens visible in relay logs or captured wire dumps; CDN access logs show the viewer's `Referer` carrying internal/PII URLs; security review flags "credentials in transit / PII in query string."

**Phase to address:** **P4** (URL masking + referrer policy + secrets-on-wire documentation). The roadmapper should treat this as **a first-class P4 deliverable alongside Pitfall 2**, because the brief explicitly emphasizes signed-URL/PII leakage.

---

## Moderate Pitfalls

### Pitfall 11: `data:` URI bloat and missing poster-fallback discipline

**What goes wrong:**
Two related sizing/fallback mistakes. (a) Inlining media or large posters as `data:` URIs to "make them shareable" blows the **1 MiB per-message relay cap** (`RELAY_PER_MESSAGE_LIMIT_BYTES`) — a single 4K poster or a short audio clip as base64 is hundreds of KB to MBs, getting the whole snapshot/diff dropped by the relay (v1 already drops oversized messages). The `img-src … data:` allowance in the CSP *invites* this mistake. (b) When media can't be referenced (signed-dead, blob/MSE, CORS-blocked, policy-denied), there's **no consistent poster fallback**, so the mirror shows a broken element instead of the v1-style graceful poster.

**How to avoid:**
- **Never inline media bytes as `data:`** — media-by-reference means *reference*. Keep `data:` for the small inline-image cases v1 already supports; consider whether `media-src` should even allow `data:`/`blob:` (lean no — Pitfall 1).
- **Standardize the poster fallback**: capture the element's `poster` (already absolutified via `URL_ATTRS`) and emit it as the degraded representation whenever the media URL is unfetchable/blocked; the renderer shows poster + optional label. This is the v1 behavior to *preserve*, not regress.
- Keep the **whole-subtree / wire-byte budgeting** discipline (`SNAPSHOT_BUDGET_BYTES`, UTF-8 byte budgeting from Phase 8) aware of media payload size.

**Phase to address:** **P1** (poster-by-reference + the no-`data:`-bloat rule for static assets), reinforced in **P3** (poster as the universal fallback target).

---

### Pitfall 12: Cross-origin media without `crossorigin` / CORS failures / mixed content on viewer-side fetch

**What goes wrong:**
Three browser-fetch realities the mirror inherits: (a) Cross-origin media used in ways that need CORS (or that the viewer later wants to read/composite) fails or taints without a correct `crossorigin` attribute — and capture currently does **not** preserve `crossorigin` (`URL_ATTRS` is `src/href/action/poster/data` only). (b) The CDN may simply not send permissive CORS headers for the viewer's origin → the fetch is blocked. (c) **Mixed content:** an `https:` viewer loading an `http:` media URL is **blocked by the browser** (active mixed content); plenty of captured pages reference `http:` assets that worked on an `http:` (or upgrading) source but die in the `https:` mirror.

**How to avoid:**
- **Preserve `crossorigin` and `referrerpolicy`** on mirrored media/img (add to the captured/absolutified attribute set, with `referrerpolicy` defaulted per Pitfall 10), so CORS-dependent media behaves and leakage is minimized.
- **Expect and handle CORS-blocked / mixed-content failures** as a fallback-to-poster path (Pitfall 11), not a hard break; surface a reason code (`cors-blocked`, `mixed-content`) in diagnostics the way CSSOM surfaces `cssRules-blocked`.
- Consider **upgrading `http:`→`https:`** for media URLs where safe, or documenting that `http:` assets won't load in an `https:` mirror (a `docs/SECURITY.md`/limitations note).

**Phase to address:** **P1** for attribute preservation (static images hit CORS/mixed-content too) and **P3** for the failure-classification/fallback wiring.

---

### Pitfall 13: `srcset`/DPR mismatch and masking media that should be private

**What goes wrong:**
(a) **`srcset`/DPR:** the right image in a `srcset` depends on the *rendering device's* `devicePixelRatio` and the element's layout width. The **viewer's DPR/viewport differs from the source's**, so the browser may pick a different (wrong-resolution, or differently-watermarked, or differently-access-controlled) candidate than the source showed — subtle visual divergence, or a candidate that 403s when the one the source used wouldn't. Capture already absolutifies `srcset` and scrubs dangerous candidates, but doesn't pin the *chosen* candidate. (b) **Private media not masked:** v1 masking covers text/inputs; a private avatar, a medical image, a chart rendered as `<img>`, or a video the user expects to be private will now be **fetched and shown in the mirror** unless masking is extended to media elements.

**How to avoid:**
- For `srcset`/`sizes`, consider **pinning the source's actually-chosen candidate** (`currentSrc` at capture) as the mirror's `src` so the viewer renders what the source rendered, rather than re-running selection under the viewer's DPR; keep `srcset` only where re-selection is acceptable.
- **Extend `blockSelector`/`maskTextSelector`-style vocabulary to media** — a `maskMediaSelector` (or reuse `blockSelector`) that replaces matched media with a dimension-preserving placeholder and **omits the URL from the wire entirely** (same guarantee as v1's `blockSelector`). This is the media analogue of the existing privacy controls and pairs with Pitfall 10's URL masking.
- Default sensitive cases conservatively; document that media masking, like text masking, is capture-side and fail-closed.

**Phase to address:** **P1** for `srcset`/DPR (static assets); **P4** for media masking (it's a privacy control and belongs with the masking vocabulary work).

---

### Pitfall 14: LIVE streams break duration math (`Infinity`/`NaN` duration, no fixed timeline)

**What goes wrong:**
Live media reports `duration === Infinity` (or `NaN` before metadata). Sync/seek logic that assumes a finite timeline (progress %, "seek to fraction", loop-at-duration detection from Pitfall 4, drift math relative to `duration`) produces `NaN`, divides by Infinity, or hard-seeks to garbage. Live also has a moving `seekable` window: the playable range slides forward, so "set `currentTime` to source time" can land **outside** the buffer and stall.

**How to avoid:**
- **Branch on `isFinite(duration)`.** For live, sync to the **live edge / `seekable.end`** semantics (and the source's "is at live edge" state) rather than an absolute timeline; don't compute fractions against `Infinity`.
- Treat live drift correction conservatively — prefer rejoining the live edge over chasing an exact `currentTime` that may already be out of the seekable window.
- Carry a `live: boolean` (and `seekableStart/seekableEnd`) in the playback state so the viewer reconciler picks the right strategy.

**Phase to address:** **P2** (the reconciler must handle finite vs. live), deepened in **P3** (HLS/DASH live manifests).

---

### Pitfall 15: Sync ordering vs. DOM diffs, and sync for off-screen / removed / replaced media

**What goes wrong:**
Playback-state messages and DOM diff ops travel the same wire but address different lifecycles. Failure modes: (a) a **sync message arrives before the `add` op** that creates the media element (or after the `rm` that removed it) → the renderer resolves the nid to nothing and either errors or, worse, mis-applies; (b) sync keeps streaming for **off-screen, paused-by-the-page, or removed** media, wasting the budget (Pitfall 9) and possibly driving a stale element; (c) a **new stream session/snapshot** (Pitfall: v1's identity stamping) arrives but late media-sync from the *previous* page gets applied to a same-nid element on the new page.

**How to avoid:**
- **Stamp media-sync messages with the same `streamSessionId`/`snapshotId`** and run them through the existing `isCurrentStream` staleness guard — this is the v1 "identity beats ordering" lesson (`docs/DESIGN-HISTORY.md`) applied to the new channel; late/cross-session sync becomes a silent correct rejection, exactly as for diffs.
- **Resolve media-sync through the same `Map<nid, Node>` identity index** as diffs; on a miss, **drop the sync** (treat like a stale miss), don't error and don't resync-storm.
- **Stop sending sync for removed/off-screen media:** tie the sync sampler to element presence and (optionally) visibility; when the page removes/pauses a media element, send a terminal state and stop.
- Define ordering as **idempotent/last-writer-wins** per element so a reordered sample can't corrupt state.

**Phase to address:** **P2** (channel/identity integration); the session-staleness reuse is essentially free if designed in from the start.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Ship media-by-reference with the v1 CSP unchanged ("images already work") | No CSP/SECURITY.md edit | All `<video>`/`<audio>` silently blocked by `default-src 'none'`; days lost debugging URLs (Pitfall 1) | Never — `media-src` is mandatory for any real media |
| Forward every `timeupdate` as a sync message | Trivial to implement | Wire spam erodes the low-bandwidth core value + contaminates paper benchmarks (Pitfall 9) | Never for reported numbers; OK only in a throwaway spike |
| Hard-seek `currentTime` on every sample | "Always in sync" on paper | Seek-storm, stutter, permanent re-buffer (Pitfall 3) | Never; use drift tolerance + rate-nudge |
| Allow the viewer to fetch any `http(s)` host the page names | Simplest, matches v1 image behavior | SSRF/tracking/beacon surface, esp. in privileged embeds (Pitfall 2) | OK as a *documented opt-in* with a host policy hook defaulting conservative |
| Put a sync shim inside the mirror iframe | Player logic "next to the media" | Can't run (no `allow-scripts`); tempts `allow-scripts` = catastrophic XSS regression (Pitfall 5) | Never — parent drives the mirror |
| Inline posters/short media as `data:` to "share" them | Self-contained payload | Blows the 1 MiB relay cap; whole frame dropped (Pitfall 11) | Only tiny inline images (the v1 case), never media |
| Freeze one signed URL for the whole session | One capture, simple | URL dead by viewer load; intermittent prod-only breakage (Pitfall 6) | Only for unsigned/long-lived assets |
| Ship `<video src>` reference for MSE/blob players | "Handles all video" | Blank mirror on YouTube/Twitch/most adaptive players (Pitfall 8) | Never — detect blob/MSE and fall back to poster/manifest |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Srcdoc CSP (`<meta>`) | Forgetting `media-src` (falls back to `default-src 'none'`) and silently blocking all media | Add scoped `media-src`; keep `default-src 'none'`, no `script-src`; test the assembled srcdoc |
| Viewer-side fetch | Assuming URL-scheme sanitization == fetch safety | Add an origin/scheme/private-IP **policy hook**, fail-closed; this is a *different* control from `hasDangerousScheme` |
| CDN signed URLs | Capturing once, sharing the token | Best-effort + re-resolve at fetch time + poster fallback; treat token as a secret on the wire |
| Adaptive players (HLS/DASH/MSE) | Sending `blob:`/`object` `src` as fetchable | Detect blob/MSE; try manifest URL (best-effort, P3) else poster; never emit `blob:` to the wire |
| Browser autoplay | Calling `play()` without a viewer gesture | Muted-autoplay default + unmute affordance; always handle `play()` rejection |
| `Referer`/credentials to third-party CDNs | Default referrer leaks PII URLs; cookies sent cross-site | `referrerpolicy="no-referrer"`/`origin`; explicit `crossorigin`; don't forward credentials |
| Mixed content | `https:` viewer loading `http:` media | Expect block; upgrade-or-poster-fallback; classify `mixed-content` in diagnostics |
| Relay 1 MiB cap | `data:`-inlined media or fat sync batches | Keep media by-reference; throttle/coalesce sync; count media bytes in diagnostics |
| Session identity | New channel ignores `streamSessionId`/`snapshotId` | Stamp + `isCurrentStream`-guard media-sync, resolve via the nid index (reuse v1 "identity beats ordering") |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Per-`timeupdate` per-element sync messages | Relay `media-sync` rivals `mutations`; bandwidth benchmark regresses | Throttle (~250–500ms) + transition-events + viewer extrapolation | Multi-video pages; long sessions |
| Hard-seek on every sample | Continuous `seeking`/`seeked`; stutter; re-buffer loop | Drift tolerance; rate-nudge in band; hard-seek only on big drift/explicit seek | Any real network latency |
| Viewer fetching hundreds of referenced media URLs | Viewer network saturates; DoS-like load | Lazy-load only on-screen media; cap concurrent fetches; off-screen = no fetch | Asset-heavy / feed pages |
| Sync sampling on the capture side via `setInterval` per video | Capture CPU climbs; jank on heavy pages | Single throttled sampler aligned to existing side-channel cadence; `rVFC` where available | Pages with several media elements |
| Re-sending fresh signed URLs frequently | Wire grows; token exposure grows | Refresh on failure/cadence, not continuously; coalesce | Live/long media on signed CDNs |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Viewer fetches attacker-named URLs with no origin policy | **SSRF** pivot from viewer network; **tracking-pixel/beacon** confirmation of a live viewer | Host origin/scheme/private-IP policy hook at the renderer, fail-closed; conservative default (https-only, block internal ranges) |
| Adding `allow-scripts` to drive the player | Full script execution of attacker-influenced DOM — total XSS regression | Parent-frame-driven playback; keep sandbox exactly `allow-same-origin`; test the invariant |
| Widening CSP too far (`media-src *`, re-adding `script-src`) | Re-opens fetch/exec surface | Minimal `media-src` only; never reintroduce `script-src`; assert `default-src 'none'` survives |
| Signed tokens / session JWTs in media URLs on the wire | Credential exposure to relay operator + every viewer | URL/query masking through `sanitizeForWire`; treat as secret-on-wire in docs; `mediaMode:'poster'` escape hatch |
| PII in URLs leaked via `Referer` to CDNs and viewer logs | Privacy breach to third parties | `referrerpolicy="no-referrer"`; query-param redaction; content-free diagnostics |
| Private media (avatars, medical, charts) fetched + shown | Private content exposed to viewer | `maskMediaSelector`/`blockSelector` for media — omit URL from wire, dimension-preserving placeholder |
| Trusting media `Content-Type` from a confused fetch | Type confusion if combined with any exec path | No `allow-scripts` means fetched media can't execute; keep it that way; don't composite untrusted bytes |

## "Looks Done But Isn't" Checklist

- [ ] **Mirrored `<video>` plays:** verify against a **real adaptive player (YouTube/Twitch)**, not just a static `.mp4` — blob/MSE is the common case and fails blank (Pitfall 8).
- [ ] **CSP actually allows the media:** assembled srcdoc contains a scoped `media-src` **and** still has `default-src 'none'` with no `script-src` (Pitfall 1).
- [ ] **Signed URLs:** tested **cross-network against a production CDN**, not a same-network unsigned fixture — verify the expired-token fallback path (Pitfall 6).
- [ ] **Autoplay:** mirror starts muted without a gesture; `play()` rejection shows an affordance, not a frozen frame (Pitfall 7).
- [ ] **Sync cost:** media-sync bytes measured in relay diagnostics and in the benchmark; not regressing the low-bandwidth differentiator (Pitfall 9).
- [ ] **Seek/stall/rate/loop:** mirror handles a user seek, a buffering stall, a 2× rate change, and a looping video without seek-storming (Pitfalls 3, 4, 14).
- [ ] **Live:** `Infinity`/`NaN` duration doesn't produce `NaN` math or out-of-`seekable` seeks (Pitfall 14).
- [ ] **Origin policy:** viewer refuses to fetch internal/`localhost`/link-local and non-allowed origins by default (Pitfall 2).
- [ ] **Leakage:** no signing tokens or PII URLs in wire dumps or viewer/relay logs; `referrerpolicy` set (Pitfall 10).
- [ ] **Masking:** `blockSelector`/media-mask hides private media and **omits its URL from the wire** (Pitfall 13).
- [ ] **Identity:** late media-sync from a previous page/session is rejected by `isCurrentStream`, not applied to a same-nid element (Pitfall 15).
- [ ] **Sandbox unchanged:** sandbox is still exactly `allow-same-origin`; the `allow-scripts`-forbidden scan covers media code (Pitfall 5).
- [ ] **jsdom tests are deterministic:** sync logic tested against a fake media-element timeline, not a real one (see Testability).

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| CSP blocks all media (Pitfall 1) | LOW | Add scoped `media-src` to `CSP_META`; update SECURITY.md; add srcdoc assertion test |
| Viewer-fetch SSRF/tracking discovered post-ship (Pitfall 2) | HIGH | Ship origin policy hook + conservative default; possibly hotfix `mediaMode:'poster'`; security advisory; this is why P4 must precede P1/P2 |
| Seek-storm in the field (Pitfall 3) | MEDIUM | Replace hard-seek loop with drift-tolerance + rate-nudge reconciler |
| `allow-scripts` was added to run a shim (Pitfall 5) | HIGH | Rip out in-mirror script; move control to parent; restore single-token sandbox assertion; audit for any executed content during the window |
| Signed-URL breakage (Pitfall 6) | LOW–MEDIUM | Add fetch-time re-resolve + error→poster fallback; document limitation |
| Token/PII leaked on wire (Pitfall 10) | HIGH | Rotate exposed credentials; add URL masking + referrer policy; purge logs; document secret-on-wire |
| Bandwidth regression (Pitfall 9) | MEDIUM | Add throttle + extrapolation + coalescing; re-run benchmarks; add a bandwidth regression test |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| 1. No `media-src` → media blocked | P2 (directive); **P4 contract first** | Srcdoc-assertion test: has `media-src`, keeps `default-src 'none'`, no `script-src` |
| 2. Viewer-fetch SSRF/tracking/beacon | **P4** (gate before P1/P2) | Policy hook denies internal/non-allowed origins by default; threat-model entry in SECURITY.md; pen-test |
| 3. `currentTime` seek-storm | P2 | No `seeking` churn under steady sync; drift stays in tolerance without continuous seeks |
| 4. `timeupdate` 4Hz + state machine | P2 (deepened P3) | Seek/stall/rate/loop scenarios pass; sync not driven by `timeupdate` alone |
| 5. Player inside no-`allow-scripts` sandbox | P2 (arch); **P4** invariant | Parent-driven control; sandbox still exactly `allow-same-origin`; `allow-scripts` scan covers media |
| 6. Signed/expiring URLs dead at view | P3 | Cross-network prod-CDN test; expired-token → poster fallback |
| 7. Autoplay blocked | P2 | Muted autoplay works gesture-free; `play()` rejection shows affordance |
| 8. blob:/MSE unshareable | P3 (detect in P2) | YouTube/Twitch → poster/manifest fallback, never blob on wire |
| 9. Sync wire spam vs. core value | P2 (verify in paper harness) | Media-sync bytes bounded in relay diagnostics + benchmark |
| 10. Signed-URL/PII leakage | **P4** | No tokens/PII in wire dumps/logs; referrer policy set; URL masking works |
| 11. `data:` bloat + poster fallback | P1 (reinforced P3) | No media `data:` inlining; oversized-frame test; poster shown on failure |
| 12. CORS / mixed content / `crossorigin` | P1 (attrs) + P3 (fallback) | `crossorigin`/`referrerpolicy` preserved; mixed-content/CORS → poster + reason code |
| 13. srcset/DPR + media masking | P1 (srcset) + **P4** (mask) | `currentSrc` pin option; `maskMediaSelector` omits URL from wire |
| 14. LIVE duration `Infinity`/`NaN` | P2 (deepened P3) | Live streams: no `NaN` math, rejoin live-edge instead of bad seeks |
| 15. Sync ordering / removed media / session | P2 | `isCurrentStream`-guarded sync; nid-index resolve; off-screen/removed = no sync |

## Testability — jsdom has no real media timeline

**The problem:** the project's test runner is `node --test` against **jsdom**, which (like its lack of a real srcdoc parse and load semantics, already documented in `src/renderer/index.js`) has **no real media element**: `HTMLMediaElement` in jsdom does not decode, does not advance `currentTime`, does not fire `timeupdate`/`seeking`/`seeked`/`waiting`/`ended`, and reports stub `duration`/`readyState`/`buffered`. You cannot test sync against a real timeline there. Naive tests will either no-op (events never fire) or pass vacuously.

**How to test sync logic deterministically:**
- **Separate the reconciler from the DOM.** Make the drift/seek decision a **pure function**: `decide({sourceTime, sourceRate, paused, live, duration}, {mirrorTime, mirrorSeeking}, {now, lastMsgTime}) -> {action: 'hold'|'rate'|'seek', value}`. Unit-test it with table-driven cases (in-tolerance → hold; small persistent → rate-nudge; large → seek; loop boundary → seek; live → rejoin-edge; `Infinity` duration → no `NaN`). This needs **no media element at all** and is the bulk of the coverage. (Mirrors the project's existing "pure transform" testing style for `buildSnapshotHtml`/`scrubCssText`.)
- **Drive a fake clock.** Inject `now`/time source so extrapolation and throttling are deterministic (no real timers); assert the throttle emits at the configured cadence and coalesces unchanged state (Pitfall 9).
- **Fake media element for the applier.** Test the parent-driven applier against a stub object capturing `currentTime` writes, `playbackRate`, `play()`/`pause()` calls, and a settable `seeking` flag — assert it issues the actions `decide()` returned and never writes `currentTime` while `seeking === true` (Pitfall 3). This is the same shape as testing `diff.js` against a resolved-node stub.
- **Protocol-level tests** (the `src/protocol/` style): assert media-sync messages are stamped with `streamSessionId`/`snapshotId` and rejected by `isCurrentStream` when stale (Pitfall 15); assert throttle constants exist with rationale comments.
- **CSP/sandbox as static assertions** (the `tests/security-chokepoint-purity.test.js` style): assert the assembled srcdoc string contains `media-src`, retains `default-src 'none'`, introduces no `script-src`, and that the sandbox token stays exactly `allow-same-origin` (Pitfalls 1, 5).
- **Real-browser/Playwright for the genuinely un-jsdom-able parts.** Actual autoplay-policy behavior, real seek/buffer/stall, blob/MSE detection, signed-URL/CORS/mixed-content fetch outcomes, and bandwidth measurement belong in the **real-Chrome/Playwright UAT** the project already uses for live-mirror paths — not in jsdom. Keep jsdom for the pure reconciler + protocol + static-contract layers; push timeline/fetch reality to Playwright.

## Sources

- PhantomStream shipped source (authoritative for the contract media must respect): `src/renderer/snapshot.js` (`CSP_META` = `default-src 'none'; img-src http: https: data:; style-src http: https: 'unsafe-inline'; font-src http: https: data:` — **no `media-src`/`connect-src`**), `src/renderer/index.js` (sandbox asserted exactly `allow-same-origin`, throws `viewer-sandbox-invalid`; parent-frame diff application), `src/renderer/sanitize.js` / `src/renderer/diff.js` (URL scheme blocklist `hasDangerousScheme`, render-side `sanitizeAttrValue`, iframe `src` op ignored), `src/capture/index.js` (`URL_ATTRS = ['src','href','action','poster','data']` absolutified; `srcset` absolutified/scrubbed; no `crossorigin`/`referrerpolicy`/`<source>` handling; `compileMaskSelector` fail-closed; masking is text/input/password only).
- `docs/SECURITY.md` (threat model "page is attacker-influenced *input*, mirror renders inert"; defense-in-depth chain; masking guarantees; host must-nevers incl. "never add `allow-scripts`"; media pixels listed as non-captured browser boundary). `docs/ARCHITECTURE.md` (CSP/sandbox section; `<video>`/`<audio>` previously degraded to poster). `docs/DESIGN-HISTORY.md` ("identity beats ordering"; throttled side channels; low-bandwidth as the differentiator). `PROJECT.md` (Core Value = low-bandwidth; v1 explicitly scoped `<video>`/`<audio>` content out with poster fallback).
- [MDN: HTMLMediaElement `timeupdate` event](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/timeupdate_event) and [WHATWG HTML spec, media events] — `timeupdate` throttled to ~4Hz (≈250ms), 4–66Hz by load; UA varies frequency by system load. (HIGH)
- [MDN: CSP `media-src` directive](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/media-src) — governs `<audio>`/`<video>`/`<track>`; **falls back to `default-src` when absent** (so current `default-src 'none'` blocks all media). [CSP `connect-src`] governs script-initiated fetch/XHR/WebSocket. (HIGH)
- MDN (autoplay policy: muted-autoplay allowed, audio needs a user gesture, `play()` rejects `NotAllowedError`), MSE/`MediaSource` + `blob:` object-URL origin-locality, mixed-content blocking, `referrerpolicy`/`crossorigin` semantics — general web-platform behavior corroborated across MDN. (HIGH for the mechanisms; MEDIUM where applied to specific drift-tolerance numbers, which are tuning targets to validate empirically.)

---
*Pitfalls research for: media-and-assets-by-reference + playback sync added to a sandboxed, sanitized, low-bandwidth DOM mirror (PhantomStream v2.0)*
*Researched: 2026-06-19*
