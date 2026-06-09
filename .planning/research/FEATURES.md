# Feature Research

**Domain:** DOM-native live browser mirroring / co-browsing / session-streaming SDK (npm framework)
**Researched:** 2026-06-09
**Confidence:** MEDIUM-HIGH (rrweb API surface verified against official guide.md — HIGH; commercial co-browsing from official docs + marketing — MEDIUM; CDP screencast from protocol docs + Chromium issues — HIGH; agent-observability viewers from official docs — MEDIUM-HIGH)

## Ecosystem Survey

Products analyzed, by category:

| Category | Products | What they establish |
|----------|----------|---------------------|
| Record + replay (live-capable) | rrweb v2 (used by Sentry, PostHog, Datadog, Mixpanel, OpenReplay, AWS AgentCore recordings) | The de-facto API conventions and privacy-option vocabulary for DOM serialization SDKs |
| Commercial co-browsing | Surfly (proxy-based), Upscope, Cobrowse.io | Table stakes for live viewing + remote control: redaction, consent, annotation, escalation |
| Pixel baseline | CDP `Page.startScreencast` | The baseline PhantomStream beats: ~9–24 FPS, CPU-heavy, semantically opaque JPEG frames |
| Agent observability | Browserbase Live View, AWS Bedrock AgentCore, Cloudflare Browser Run, browser-use + Laminar, vercel-labs/agent-browser | The embed pattern (iframe live-view URL + human-in-the-loop takeover + post-hoc recording) and the demand signal for agent supervision |
| Open-source live co-browsing | OpenReplay Assist | Closest OSS analog: live view + consent-gated remote control + annotation, but bundled into a platform, not an SDK |
| Dead/abandoned mirrors | mozilla/browsermirror, fooby/mirror-dom, browser-mirror (npm) | **There is no maintained standalone live-DOM-mirror SDK.** rrweb live-mode is a replay library retrofitted for liveness. This is the gap PhantomStream fills. |

Key structural observation: **every live DOM-viewing product is either a SaaS platform (Surfly, Upscope, Cobrowse.io, Browserbase) or a feature bundled inside a platform (OpenReplay Assist)**. The only embeddable library (rrweb) is recording-first: its live mode is `Replayer({liveMode: true})` + `startLive(buffer)` — a buffered replay loop, not a latency-optimized mirror, with no reliability layer, no remote control, and no host adapters beyond "page SDK". PhantomStream's positioning as a *framework* with multi-host adapters has no direct incumbent.

## Feature Landscape

### Table Stakes (Users Expect These)

Features users assume exist. Missing these = product feels incomplete or unpublishable.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Privacy masking / redaction hooks | Universal: rrweb's `blockClass`/`blockSelector`/`maskAllInputs`/`maskTextClass`/`maskInputFn`; Cobrowse.io is "private by default" (allowlist-only, redacted data never leaves the device); Surfly/Upscope advertise field masking for GDPR/PCI/HIPAA. The paper outline (§6) already commits to "redaction hooks". A DOM stream IS the page content — shipping without capture-side redaction is a compliance non-starter for adopters. | MEDIUM | Must run **capture-side** (before transport), in all three paths: snapshot serialize, `add`-op subtree serialize, and `attr`/`text` ops on masked nodes. Adopt rrweb's vocabulary (`blockSelector`, `maskTextSelector`, `maskInputs`, custom mask fns) — it's the convention adopters already know. **Gap: not currently in PROJECT.md Active requirements.** |
| Sanitization + sandboxed viewer (secure by default) | rrweb names its escape hatch `UNSAFE_replayCanvas` because it adds `allow-scripts` — the ecosystem convention is sandbox-by-default with explicit unsafe opt-ins. Already a PROJECT.md constraint (non-negotiable). | MEDIUM | Strip `on*` attrs, `javascript:` URLs in every serialization path; iframe without `allow-scripts`. Already planned (limitation #5). Gate for publishing at all. |
| Input + interaction mirroring | Viewers expect to see typed values, focus, scroll, and pointer position. rrweb records input/scroll/mousemove as first-class events with `mouseTail` rendering; Upscope renders the remote cursor; co-browsing without visible input state feels broken. | MEDIUM | PhantomStream has scroll + dialog channels; form input values often don't fire MutationObserver (property vs attribute) — needs explicit input-event capture. Cursor-position channel is expected for the co-browsing use case, optional for agent observability. |
| Same-origin iframe + shadow DOM mirroring | rrweb v2 mirrors both (shadow DOM incl. `adoptedStyleSheets`); modern sites are web-component-heavy. Cross-origin iframes are an accepted industry limitation (even rrweb requires injecting into each child frame). | HIGH | Shadow DOM is already PROJECT.md limitation #6 (v1 must-fix). Same-origin iframe content mirroring should be scoped; cross-origin stays a documented limitation — ecosystem-consistent. |
| Canvas graceful degradation | rrweb has `recordCanvas` + `dataURLOptions`; everyone at minimum shows a poster/placeholder rather than a blank box. | LOW (poster) / HIGH (live) | PhantomStream's snapshot-time canvas→data-URL is already at parity for snapshots. Periodic canvas refresh is a v1.x option; live canvas (rrweb does WebRTC plugin) is explicitly out of v1. |
| `start()`/`stop()`/`pause()`/`resume()` + `on()` event API | rrweb's `record({emit})` → stop-fn and `Replayer.on(event, cb)` set the convention; every modern SDK (Browserbase, Cobrowse) exposes lifecycle + event subscription. | LOW | PhantomStream's existing control messages (`domStreamStart/Stop/Pause/Resume`) map directly. Expose connection/stream state events (`connecting`, `live`, `stale`, `disconnected`) — Browserbase even postMessages on live-view connection loss. |
| Pluggable transport (emit-callback pattern) | rrweb's `emit` callback is the de-facto contract: the SDK serializes, the host owns the wire. PhantomStream's planned `Transport` interface matches; ship the WebSocket relay as the reference implementation, not a requirement. | MEDIUM | Already Active in PROJECT.md. The relay must be self-hostable and dependency-light — OSS adopters reject SaaS-only relays. |
| Compression hooks | rrweb exposes `packFn`/`unpackFn`; PhantomStream's LZ envelope (`{_lz, d}`) is equivalent and shipped. | LOW | Done. Keep backward-compatible per PROJECT.md constraint. |
| Snapshot recovery / re-sync | rrweb has `checkoutEveryNth/Nms` (periodic full snapshots); Browserbase live view auto-recovers; desync without recovery = dead mirror. | MEDIUM | PhantomStream's dual watchdogs + re-snapshot path already exceed rrweb live-mode (which has nothing). On-demand subtree fetch (limitation #4) is the active-recovery complement. |
| Embeddable, framework-agnostic viewer | Browserbase's pattern: a live-view URL/component you drop into an iframe with documented sandbox attrs. rrweb-player ships as a vanilla component. Adopters expect "one function/element to embed the mirror" that works in React/Vue/plain HTML. | MEDIUM | Renderer decoupling already Active. Vanilla DOM component + documented mount API; no framework wrappers needed for v1. |
| TypeScript types + ESM packaging | rrweb is TS-first; untyped npm SDKs are dead on arrival in 2026. | LOW | Already decided: JSDoc + `tsc`-generated `.d.ts`, plain ESM, no build step. Verify types ship in the package and `tsc --checkJs` runs in CI. |
| Quickstart demo + docs | Every product surveyed leads with a < 5-minute path (Cobrowse 6-digit code demo, Browserbase session inspector, `rrweb` REPL). | LOW-MEDIUM | `npx phantom-stream demo` (two-tab) + Playwright demo already Active. These ARE the adoption funnel. |

### Differentiators (Competitive Advantage)

Features that set PhantomStream apart. Aligned with Core Value: live, trustworthy, low-bandwidth, *semantically addressable*.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Live-first, low-latency mirroring | rrweb live mode is buffered replay (`startLive(bufferMs)`) designed around timestamps, not latency; CDP screencast manages ~9–24 FPS at 100% CPU. PhantomStream's rAF-matched diff delivery is paint-cadence by design. The eval harness turns this into a published, reproducible claim. | Already built (HIGH to keep under extraction) | The paper's latency numbers double as marketing. Don't regress the encoded performance lessons. |
| Semantic node addressing exposed as API | Nobody exposes element-level identity to the embedding host: agent frameworks (browser-use, WebVoyager) draw bounding boxes on *screenshots* (Set-of-Mark); Browserbase live view is pixels-in-iframe. PhantomStream's stable nids let a host say "highlight the node the agent will click" and get DOM-anchored overlays that survive scroll/resize. | MEDIUM (API design over existing nids) | The keystone differentiator and the paper's core argument ("pixels are the wrong abstraction"). WeakMap identity migration (limitation #3) must preserve wire-addressability. |
| Agent-action overlay channel | Action glow, progress cards, dialog mirroring as first-class protocol messages. Agent-observability products have live view OR action logs, never semantically-anchored live action visualization. | Already built (LOW to extract) | Genuinely unique. Generalize from FSB-specific overlays to a documented extensible overlay/annotation message type so hosts define their own. |
| Bidirectional remote control as an embeddable library | Co-browsing SaaS has it; OpenReplay Assist has it (consent-gated) — but no npm library offers click/type/scroll-through-the-mirror you can embed in your own product. For agent supervision this is human-in-the-loop takeover (Browserbase's #1 advertised live-view use case). | Already built (MEDIUM to extract) | Add a consent/authorization hook (host-provided callback gating control) — Cobrowse.io and OpenReplay both consent-gate; an SDK should expose the hook and let the host own UX. |
| Multi-host adapters (extension / Playwright-CDP / bookmarklet / embedded SDK) | rrweb runs only as an in-page SDK; co-browsing SaaS uses proxies or their SDK; Browserbase only works in their cloud. One capture core that injects into a content script, `addInitScript`, a bookmarklet, or a first-party bundle covers every "browser you control" scenario, self-hosted. | HIGH | The framework's reason to exist. Depends on Transport decoupling. CDP/Playwright adapter is what makes the agent-observability story concrete. |
| Production-grade reliability layer | Dual watchdogs, session-identity staleness rejection, budgeted truncation, oversize diagnostics. rrweb live mode has zero of this; it's what separates a demo from infrastructure, and it's paper §4. | Already built (MEDIUM to extract) | Surface `staleFlushCount`-style telemetry via the event API so hosts can observe stream health. |
| Stylesheet-centric capture mode (CSSOM) | Fixes frozen-style drift, shrinks payloads, retires most truncation machinery — and is the paper's ablation arm. rrweb captures stylesheets (and is lighter for it); PhantomStream offering *both* strategies with published trade-off data is unique. | HIGH | Already Active (limitation #1). Feature-flag it so the ablation is a config switch. |
| Evaluation harness as a public artifact | Surfly claims "DOM events beat video" with no published data. Shipping the harness (bandwidth/latency/fidelity vs WebRTC, CDP screencast, rrweb on a frozen corpus) makes PhantomStream the citable reference point and doubles as the regression suite. | HIGH | Already Active. No competitor publishes this. |

### Anti-Features (Commonly Requested, Often Problematic)

Features that seem good but should be deliberately NOT built.

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Full rrweb-style replay storage + timeline player | "Can I record sessions and seek/scrub later?" — adjacent products (LogRocket, OpenReplay, AgentCore recordings) all store-and-replay | It's rrweb's entire mature ecosystem (storage engines, timestamped event logs, players with seek/speed/skip-inactive, virtual-DOM fast-forward). Rebuilding it dilutes the live-mirror identity and loses; storage also imports retention/compliance burden | Protocol messages are serializable JSON — document "persist the stream yourself if you want crude replay"; point adopters at rrweb for real session replay; position via the paper's related-work distinction (record/replay vs live mirror) |
| Multi-writer CRDT collaboration | "True co-browsing = both sides browse simultaneously" | Single-writer mirror is the design (PROJECT.md out-of-scope; the paper argues why): the real tab is the single source of truth, so there is no merge problem to solve. CRDTs add a distributed-systems research project for zero v1 user value | The remote-control reverse path already provides intervention; the authoritative tab serializes all writes |
| Universal proxy-based co-browsing (Surfly model) | "Mirror any site without installing anything" | Requires an HTML/CSS/JS-rewriting proxy — an arms race against the web platform (service workers, CSP, anti-bot), a man-in-the-middle security/compliance liability, and a SaaS business model, not a framework | Host adapters cover every context where you legitimately control injection (extension, CDP, bookmarklet, first-party embed) — which is exactly the agent-supervision market |
| Video/WebRTC fallback for `<video>`/`<audio>`/live canvas | "The mirror should show the playing video" | Drags in a full media pipeline (WebRTC plumbing, SFU concerns); rrweb's canvas-WebRTC plugin shows the cost; destroys the bandwidth story | Poster/placeholder treatment, documented (already PROJECT.md out-of-scope); fidelity taxonomy in the paper is honest about it |
| Built-in calls / chat / drawing-annotation toolkit | OpenReplay Assist has WebRTC calls; Upscope has screen drawing — "co-browsing products have these" | Product features, not framework features; every host wants different UX; bloats an SDK that must inject as a plain script | The overlay channel is the extension point — document how a host implements annotations/pointers as custom overlay messages |
| Analytics capture (console logs, network, heatmaps) | Session-replay tools (LogRocket, OpenReplay) bundle these; "while you're observing the page anyway…" | Different product category (APM/analytics); expands capture scope, payload, and privacy surface; rrweb does this via plugins, not core | Plugin/hook seam in the capture core; explicitly out of core protocol |
| Multi-viewer scale-out (SFU-style fan-out infra) | "What about 100 viewers per session?" | Infrastructure product, not framework scope; relay already fans out to multiple clients | Keep relay simple and self-hostable; document horizontal patterns as future work (matches PROJECT.md out-of-scope) |
| Cross-origin iframe content mirroring | "Page has an embedded checkout iframe" | Browser security boundary; rrweb's "solution" (inject into every child frame + postMessage) is an adapter-level concern with known bugs (e.g. blank frames after parent snapshot) | Document the limitation (industry-standard); render cross-origin frames as labeled placeholders; same-origin frames are the v1 target |

## Feature Dependencies

```
Transport interface (capture decoupling)
    └──required-by──> Multi-host adapters (extension / CDP / bookmarklet / embed)
                          └──required-by──> Playwright demo + FSB swap-in

Semantic node addressing (stable nids / WeakMap identity)
    ├──required-by──> Remote control (reverse path targets + coordinate mapping)
    ├──required-by──> Agent-action overlays (DOM-anchored rects)
    └──required-by──> On-demand subtree fetch (addressing the missing subtree)

Sanitization (capture-side + viewer sandbox)
    └──gates──> Publishing the embeddable viewer at all

Privacy masking/redaction
    ├──must-integrate-with──> Snapshot serializer (mask at serialize time)
    ├──must-integrate-with──> Diff pipeline (attr/text ops on masked nodes stay masked)
    └──interacts-with──> Stylesheet-centric capture (block-out boxes need dimensions w/o content)

Bidirectional transport (control channel)
    ├──required-by──> Remote control
    └──required-by──> On-demand subtree fetch

Stylesheet-centric capture mode ──enhances──> truncation budget (smaller payloads)
                                ──required-by──> Paper ablation
Evaluation harness ──required-by──> Paper §5 ──doubles-as──> perf regression suite

Replay storage (anti-feature) ──conflicts──> live-first identity & bandwidth story
CRDT collab (anti-feature) ──conflicts──> single-writer authoritative-tab model
```

### Dependency Notes

- **Masking before transport:** redaction is only credible if masked content never leaves the capture context (the Cobrowse.io "never leaves the device" standard). It cannot be a viewer-side filter. This touches the serializer, `processAddedNode`-equivalent, and `attr`/`text` op generation — so it should be designed alongside the sanitization stage, not bolted on after.
- **WeakMap identity migration must not break addressing:** remote control, overlays, and subtree fetch all address by nid over the wire. The limitation-#3 fix changes how identity is stored, not the wire contract.
- **On-demand subtree fetch and remote control share the reverse channel:** building the bidirectional control path once serves both — sequence them together.
- **Consent hook rides on remote control:** trivial to add at extraction time (host callback gating control activation), expensive to retrofit after API freeze.

## MVP Definition

### Launch With (v1)

Everything below is either a publishing gate or already committed in PROJECT.md Active:

- [ ] Capture core behind `Transport` interface + WS reference relay — the framework premise
- [ ] Sanitization stage + sandboxed viewer (no `allow-scripts`) — security publishing gate
- [ ] **Privacy masking hooks (`blockSelector`, `maskTextSelector`, `maskInputs`, custom mask fns)** — ecosystem table stakes; currently missing from Active requirements; cheap to add while the serializer is being refactored, expensive after
- [ ] All six inherited limitation fixes (CSSOM mode, added-node styles, WeakMap identity, subtree fetch, sanitization, shadow DOM) — per PROJECT.md decision
- [ ] `start/stop/pause/resume` + `on()` lifecycle/state/telemetry events — API ergonomics table stakes
- [ ] Embeddable viewer component (vanilla, framework-agnostic, documented mount/scale API)
- [ ] Remote control with host consent/authorization hook
- [ ] Semantic addressing + overlay channel exposed as documented public API (not FSB-internal)
- [ ] Extension + Playwright/CDP host adapters; two-tab and Playwright demos
- [ ] npm publish with generated `.d.ts`, ESM, quickstart docs

### Add After Validation (v1.x)

- [ ] Input-value/caret/focus mirroring beyond MutationObserver coverage — trigger: fidelity gaps on form-heavy sites in the eval corpus
- [ ] Cursor-position channel + viewer cursor rendering — trigger: co-browsing (human-to-human) adopters appear
- [ ] Bookmarklet + embedded-SDK adapters — trigger: demand outside extension/CDP contexts
- [ ] Periodic canvas refresh (opt-in, budgeted) — trigger: canvas-heavy pages rank high in fidelity-failure taxonomy
- [ ] Same-origin iframe content mirroring (if not landed in v1) — trigger: corpus failure data
- [ ] Telemetry surface hardening (watchdog rescue rates, health events) — trigger: FSB production feedback

### Future Consideration (v2+)

- [ ] Multi-viewer scale-out patterns — defer: infra product, not framework
- [ ] Live canvas/media streaming — defer: destroys bandwidth story, niche demand
- [ ] Cross-origin iframe strategies (per-frame injection adapter) — defer: adapter-level, known-buggy even in rrweb
- [ ] rrweb-format export bridge (emit rrweb-compatible events for replay-storage interop) — defer: nice ecosystem play, zero v1 value

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Transport-decoupled capture core | HIGH | MEDIUM | P1 |
| Sanitization + sandboxed viewer | HIGH | MEDIUM | P1 |
| Privacy masking/redaction hooks | HIGH | MEDIUM | P1 |
| `on()`/lifecycle API + state events | HIGH | LOW | P1 |
| Embeddable viewer component | HIGH | MEDIUM | P1 |
| Remote control + consent hook | HIGH | MEDIUM (extraction) | P1 |
| Semantic addressing public API | HIGH | MEDIUM | P1 |
| Extension + CDP adapters, demos, npm packaging | HIGH | MEDIUM | P1 |
| Shadow DOM mirroring | HIGH | HIGH | P1 |
| Stylesheet-centric capture mode | HIGH (paper + payload) | HIGH | P1 |
| On-demand subtree fetch | MEDIUM | MEDIUM | P1 (committed) |
| WeakMap identity | MEDIUM | MEDIUM | P1 (committed) |
| Input/caret/cursor mirroring | MEDIUM | MEDIUM | P2 |
| Bookmarklet/embed adapters | MEDIUM | LOW-MEDIUM | P2 |
| Periodic canvas refresh | LOW-MEDIUM | MEDIUM | P2 |
| Evaluation harness | HIGH (paper, credibility) | HIGH | P1 (paper track) |
| rrweb export bridge | LOW | MEDIUM | P3 |
| Live canvas/media | LOW | HIGH | P3 / never |

**Priority key:** P1 must-have for launch · P2 should-have · P3 future/never

## Competitor Feature Analysis

| Feature | rrweb (live mode) | Surfly / Upscope / Cobrowse.io | CDP screencast | Browserbase / agent viewers | PhantomStream approach |
|---------|-------------------|--------------------------------|----------------|------------------------------|------------------------|
| Live mirroring | Buffered replay loop (`liveMode` + `startLive(buffer)`); replay-first design | Yes — DOM-event streaming over WS (Surfly proxy claims ~12–45 KB/s vs 8–12 MB/s for 1080p video) | JPEG frames, ~9–24 FPS, CPU-bound | Yes (pixels via CDP-ish viewer in iframe) | Native: rAF-matched diffs, latency-first, published numbers |
| Privacy masking | Rich: block/mask/ignore classes+selectors+fns — the vocabulary standard | Capture-side redaction, "private by default" allowlists, enterprise rule mgmt (Cobrowse) | None (pixels capture everything) | None at viewer level | Adopt rrweb vocabulary, enforce capture-side (Cobrowse standard) |
| Remote control | No | Yes, consent-gated (Cobrowse default consent dialog; OpenReplay Assist same) | Input via CDP `Input.*` (separate, coordinate-only) | Yes — click/type/scroll through live view (human-in-the-loop) | Built; add host consent hook; semantic targets not just coordinates |
| Element-level semantics exposed to host | Internal mirror IDs, not a host-facing addressing API | No (closed platforms) | No (pixels) | No (pixels; agents draw boxes on screenshots) | **Differentiator: nid addressing as public API + DOM-anchored overlays** |
| Agent-action overlays | No | Agent cursor / drawing (human-oriented) | No | Action logs beside the view, not anchored in it | **Differentiator: first-class overlay channel** |
| Host contexts | In-page SDK only | SaaS proxy or their SDK | Any CDP target, their infra patterns | Their cloud only | **Differentiator: extension / CDP / bookmarklet / embed adapters, self-hosted** |
| Shadow DOM / iframes | Shadow DOM yes; same-origin iframes yes; cross-origin = inject-per-frame (buggy) | Yes (proxy rewrites everything) | N/A (pixels) | N/A (pixels) | Shadow DOM v1; same-origin scoped; cross-origin documented limitation |
| Canvas | `recordCanvas` snapshots; WebRTC plugin for live | Rendered (proxy/pixel paths) | Captured (pixels) | Captured (pixels) | Snapshot poster (parity); live = anti-feature |
| Reliability layer | None in live mode | Closed/unpublished | Frame-ack only | Connection-loss postMessage | **Differentiator: dual watchdogs, staleness rejection, truncation budget — published** |
| Replay storage | Core competency (don't compete) | Session recordings as platform add-on | No | rrweb-based structured-JSON recordings | Anti-feature: emit-and-forget; interop note |
| Embed ergonomics | `record({emit})` + Replayer + rrweb-player | Script tag + SaaS dashboard | DIY | Debug URL in iframe w/ documented sandbox attrs | npm component + documented mount; lifecycle events incl. connection state |

## Gaps Surfaced for Requirements (not currently in PROJECT.md Active)

1. **Privacy masking/redaction hooks** — table stakes everywhere in the ecosystem; paper §6 promises it; not in Active requirements. Strong recommendation: add to v1 (designed with the sanitization stage).
2. **Remote-control consent/authorization hook** — consent gating is universal in co-browsing (Cobrowse default dialog, OpenReplay confirmation); an SDK should expose the hook. Cheap at extraction time.
3. **Connection/stream-state events on the public API** — `connecting/live/stale/disconnected` + health telemetry; the watchdog machinery already produces the signals, they just need an `on()` surface.
4. **Input-value mirroring fidelity** — form `value` properties don't fire MutationObserver; verify coverage during extraction, schedule explicit input capture for v1.x if gaps appear in the corpus.

## Sources

- rrweb official guide (record/replay options, privacy vocabulary, packages): https://github.com/rrweb-io/rrweb/blob/master/guide.md — HIGH confidence (fetched)
- rrweb live-mode recipe: https://github.com/rrweb-io/rrweb/blob/master/docs/recipes/live-mode.md — HIGH
- rrweb cross-origin iframes recipe + issues #1571, #1720 (per-frame injection, known bugs): https://github.com/rrweb-io/rrweb/blob/master/docs/recipes/cross-origin-iframes.md — HIGH
- rrweb canvas-WebRTC live plugin (PR #976; @mixpanel/rrweb-plugin-canvas-webrtc-replay): https://github.com/rrweb-io/rrweb/pull/976 — MEDIUM
- Cobrowse.io docs (redaction, private-by-default, remote-control consent, full-device, SDK platforms): https://docs.cobrowse.io/ , https://docs.cobrowse.io/sdk-features/redact-sensitive-data , https://docs.cobrowse.io/sdk-features/customize-the-interface/remote-control-consent — HIGH (official docs)
- Surfly (universal co-browsing, interaction middleware, DOM-event streaming): https://www.surfly.com/glossary/interaction-middleware , https://www.surfly.com/universal-co-browsing/ — MEDIUM (marketing; bandwidth figures LOW, third-party)
- Upscope (DOM capture, cursor, draw/click/type for customer): https://upscope.com/ , https://upscope.com/what-is-cobrowsing — MEDIUM
- CDP Page domain + screencast limitations (FPS, CPU): https://chromedevtools.github.io/devtools-protocol/tot/Page/ , https://github.com/ChromeDevTools/devtools-protocol/issues/63 , https://issues.chromium.org/issues/40934921 — HIGH
- Browserbase Live View (iframe embed, sandbox attrs, multi-tab debug URLs, human-in-the-loop, connection-loss messages): https://docs.browserbase.com/features/session-live-view , https://www.browserbase.com/observability — HIGH (official docs)
- AWS Bedrock AgentCore browser observability (live view + recording + metrics): https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/browser-tool.html — MEDIUM-HIGH
- Cloudflare Browser Run live view / HITL / recordings changelog: https://developers.cloudflare.com/changelog/post/2026-04-15-br-observability/ — MEDIUM
- browser-use observability (Laminar integration): https://docs.browser-use.com/open-source/development/monitoring/observability — MEDIUM
- WebVoyager Set-of-Mark bounding-box overlays (agent-side, screenshot-based): https://arxiv.org/pdf/2401.13919 — MEDIUM
- OpenReplay Assist (live view, consent remote control, annotation, WebRTC call, multi-tab): https://docs.openreplay.com/en/co-browsing/ , https://docs.openreplay.com/en/tutorials/assist/ — MEDIUM-HIGH
- Abandoned OSS mirrors (gap evidence): https://github.com/mozilla/browsermirror , https://github.com/fooby/mirror-dom , https://www.npmjs.com/package/browser-mirror — MEDIUM

---
*Feature research for: DOM-native live browser-mirroring framework (PhantomStream)*
*Researched: 2026-06-09*
