# Roadmap: PhantomStream

## Overview

PhantomStream extracts a shipped, production-proven DOM-mirroring system out of FSB into a standalone framework, npm package, and research paper. **Milestone v1.0 (Phases 1–11)** is shipped: the journey was dependency-driven — build the differential oracle before touching the serializer, prove the Transport seam with a zero-infrastructure loopback mirror, land the security pipeline before anything embeddable or publishable, go networked (`npx phantom-stream demo`), add the Playwright/CDP and extension adapters, fix all six inherited limitations (identity rework → shadow DOM/fidelity → CSSOM mode), publish 0.x, and verify the FSB swap-in to freeze the API at 1.0.

**Milestone v2.0 (Phases 12–15) — Asset & Media Streaming** extends the mirror beyond DOM/text to media **by reference**: stream asset and media **URLs** (plus small playback-state messages), and let the viewer fetch the bytes from the original CDN/source over its own network. The relay still carries only text + URLs, so the low-bandwidth core value is preserved. Research found the by-reference asset pipeline is already ~80–90% shipped, so v2.0 concentrates on a strict capability chain — static assets → video/audio playback sync → adaptive HLS/DASH → media security completion — with the **new viewer-side-fetch security surface** threaded through the visible phases and completed at the end. Every phase ends runnable and green against `node --test` + the differential oracle.

The evaluation harness and the system-track research paper are deferred to **milestone v2.1** (see Future Milestones).

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

**Milestone v1.0 — Standalone Framework, npm Package & FSB Swap-In (Phases 1–11, shipped 2026-06-16):**

- [x] **Phase 1: Capture Core Extraction + Differential Oracle** - Oracle-anchored extraction of the capture core behind the Transport seam (completed 2026-06-10)
- [x] **Phase 2: Renderer Core + Embedded Loopback Mirror** - Embeddable viewer + first end-to-end mirror with zero infrastructure (completed 2026-06-11)
- [x] **Phase 3: Security Pipeline — Sanitization + Privacy Masking** - Both-ends sanitization, sandbox contract, capture-side masking (publishing gate) (completed 2026-06-14)
- [x] **Phase 4: Relay, WS Transport & Two-Tab Demo** - Networked mirror: relay core, ws backend, CompressionStream codec, `npx phantom-stream demo` (completed 2026-06-15)
- [x] **Phase 5: Playwright/CDP Adapter, Remote Control & Agent Demo** - Script-driven page mirrored live with consent-gated remote control (completed 2026-06-15)
- [x] **Phase 6: Extension MV3 + Bookmarklet Adapters** - Remaining injection contexts incl. the FSB swap-in surface and eviction recovery (completed 2026-06-15)
- [x] **Phase 7: WeakMap Node Identity + Semantic Addressing API** - Stop mutating the observed page; expose node identity as public API (completed 2026-06-15)
- [x] **Phase 8: Shadow DOM, Iframes & Fidelity Completion** - Shadow roots, same-origin iframes, input mirroring, added-node styles, subtree fetch (completed 2026-06-15)
- [x] **Phase 9: CSSOM Capture Mode** - Flag-enabled stylesheet-centric capture (last limitation fix; the paper's ablation arm) (completed 2026-06-16)
- [x] **Phase 10: npm Packaging & 0.x Publish** - `@full-self-browsing/phantom-stream` published to npm (public, 0.1.0) with clean types and quickstarts (completed 2026-06-16)
- [x] **Phase 11: FSB Swap-In → 1.0** - FSB runs on the published package; API frozen at 1.0 (verified in FSB repo; no in-repo plans)

**Milestone v2.0 — Asset & Media Streaming (Phases 12–15):**

- [x] **Phase 12: Static Assets by Reference** - Verify/harden the already-shipped by-reference asset pipeline; `currentSrc` pinning; placeholder fallback; precise viewer CSP; front-loaded fail-closed origin policy + `mediaMode` (completed 2026-06-20)
- [ ] **Phase 13: Video/Audio URL + Playback Sync** - Progressive `<video>`/`<audio>` from source URL; throttled `STREAM.MEDIA` side channel; drift-corrected pure-function reconciler; autoplay-policy-correct viewer
- [ ] **Phase 14: Adaptive Streaming + Adapter Discovery + Fallback** - Best-effort HLS/DASH via an optional, lazy, parent-realm player; opt-in adapter manifest discovery; MSE-no-manifest/DRM → poster; live-stream handling
- [ ] **Phase 15: Media Security, Masking, Threat Model & Docs** - Complete URL/media masking + `referrerpolicy="no-referrer"`; threat-review the parent-realm object-URL blast radius; media security tests; SECURITY/ARCHITECTURE docs

## Phase Details

### Phase 1: Capture Core Extraction + Differential Oracle
**Goal**: The capture core runs in any injection context behind an injected Transport seam, with output provably equivalent to the shipped reference
**Mode:** mvp
**Depends on**: Nothing (first phase)
**Requirements**: CAPT-01, CAPT-02, CAPT-03, CAPT-04
**Success Criteria** (what must be TRUE):
  1. A differential harness runs reference and extracted capture side-by-side on frozen fixtures, reports structural op-stream equivalence, and records every intentional divergence in a ledger — and it exists before the first serializer refactor lands
  2. The extracted capture core contains zero `chrome.runtime`/`window.FSB` references (grep-enforced in CI) and emits through any injected `Transport` (`send`/`flush`), proven with a loopback transport
  3. Host can `start`/`stop`/`pause`/`resume` capture with fresh-session semantics (new session ID + snapshot ID per session) matching the reference implementation
  4. The reference reliability defenses survive extraction and are enforced by tests: rAF-batched diffs, self-watchdog force-flush, session/snapshot identity stamping, and budgeted whole-subtree truncation with single-pass layout reads
**Plans**: 5 plans (4 waves)

Plans:
**Wave 1**
- [x] 01-01-PLAN.md — Walking skeleton: jsdom infra + differential harness self-test (ref-vs-ref) + CI workflow

**Wave 2** *(blocked on Wave 1 completion)*
- [x] 01-02-PLAN.md — Frozen fixture matrix + scripted scenarios covering every defense, ref-vs-ref green

**Wave 3** *(blocked on Wave 2 completion)*
- [x] 01-03-PLAN.md — Single-file capture core extraction behind the Transport seam + purity gate

**Wave 4** *(blocked on Wave 3 completion)*
- [x] 01-04-PLAN.md — Oracle flip: reference-vs-extracted equivalence + divergence ledger finalization
- [x] 01-05-PLAN.md — Lifecycle + reliability defense test suite (rAF, watchdog, identity, truncation)

### Phase 2: Renderer Core + Embedded Loopback Mirror
**Goal**: A page can mirror itself live — capture core plus embeddable viewer running end-to-end in one page with zero infrastructure
**Mode:** mvp
**Depends on**: Phase 1
**Requirements**: VIEW-01, VIEW-04, VIEW-06, ADPT-04
**Success Criteria** (what must be TRUE):
  1. Host can call `createViewer({ container, transport })` in any plain HTML page and get a live, viewport-adaptively scaled mirror
  2. A first-party page importing capture + viewer directly (embedded-SDK adapter, direct loopback transport) shows a live mirror that tracks DOM mutations in real time — the first end-to-end proof
  3. The viewer iframe is created with `sandbox="allow-same-origin"` only, asserted at creation (sandbox backstop from day one; full security contract lands in Phase 3)
  4. Scroll position and native `alert`/`confirm`/`prompt` dialogs are mirrored with reference parity
  5. Action-glow and progress overlays render anchored to mirrored nodes, and hosts can send custom DOM-anchored overlays through the documented, extensible overlay message type
**Plans**: 6 plans (4 waves)
**UI hint**: yes

Plans:
**Wave 1**
- [x] 02-01-PLAN.md — Pure renderer core: snapshot HTML builder + Document-parameterized diff applier (jsdom-mandated seams)
- [x] 02-02-PLAN.md — Overlay registry + glow/progress/dialog built-ins + oracle-safe capture overlay-key forwarding

**Wave 2** *(blocked on Wave 1)*
- [x] 02-03-PLAN.md — createViewer factory: sandbox assertion, dispatch, scale-to-fit, latched CONTROL.START resync + purity gate

**Wave 3** *(blocked on Wave 2)*
- [x] 02-04-PLAN.md — Loopback e2e proof (recursion guard, resync round-trip, dialog/custom-overlay channels) + renderer README/divergence ledger
- [x] 02-05-PLAN.md — First-light demo: loopback transport module, dep-free static server, loopback-mirror.html, package exports

**Wave 4** *(blocked on Wave 3)*
- [x] 02-06-PLAN.md — Full-suite gate + real-browser human verification checkpoint

### Phase 3: Security Pipeline — Sanitization + Privacy Masking
**Goal**: Mirrored content is safe to render and masked content never leaves the captured page — the hard gate for anything embeddable or published
**Mode:** mvp
**Depends on**: Phase 2
**Requirements**: SEC-01, SEC-02, SEC-03
**Success Criteria** (what must be TRUE):
  1. All serialization paths (snapshot, `add`-op subtrees, `attr` ops) strip `on*` event-handler attributes and `javascript:` URLs through one named capture-side chokepoint — verified by an mXSS/injection fixture suite
  2. Render-side sanitization runs through one named chokepoint (DOM-fragment based, never string→`innerHTML`), with a CSS sanitization pass and srcdoc CSP meta as backstops
  3. The viewer renders exclusively in a sandboxed iframe without `allow-scripts`; a startup assertion fails loudly on misconfiguration; the embed security contract is documented
  4. Host-configured privacy masking (`blockSelector`, `maskTextSelector`, `maskInputs`, custom mask fns) is applied capture-side in all serialization paths — masked text and input values never appear on the wire
**Plans**: 5 plans (4 waves)

Plans:
**Wave 1**
- [x] 03-01-PLAN.md — Capture-side chokepoint `sanitizeForWire`: on*/scheme/srcdoc/object-embed strips + CSS scrub across all five serialization paths (SEC-01)
- [x] 03-02-PLAN.md — Render-side chokepoint `sanitizeFragment` + template-context add-op parsing + srcdoc CSP meta + per-session strip counters (SEC-02)

**Wave 2** *(blocked on 03-01)*
- [x] 03-03-PLAN.md — Privacy masking: blockSelector placeholder, maskTextSelector, maskInputs, always-on password mask, custom mask fns (SEC-03)

**Wave 3** *(blocked on 03-01 + 03-03)*
- [x] 03-04-PLAN.md — Differential-oracle discipline: sanitize-corpus fixture + sanitize-divergence scenario + load-bearing D7 ledger entry

**Wave 4** *(blocked on all)*
- [x] 03-05-PLAN.md — Chokepoint-purity static scan + docs/SECURITY.md embed contract + full-suite gate + demo dogfood checkpoint

### Phase 4: Relay, WS Transport & Two-Tab Demo
**Goal**: The mirror works across the network — `npx phantom-stream demo` captures a page in one tab and mirrors it live in another through the bundled relay
**Mode:** mvp
**Depends on**: Phase 3
**Requirements**: RELY-01, RELY-02, PKG-01, VIEW-02
**Success Criteria** (what must be TRUE):
  1. `npx phantom-stream demo` works end-to-end: bundled relay starts, one tab captures, another tab mirrors live
  2. Relay core is transport-agnostic with pluggable backends; the self-hostable ws reference backend enforces the 1 MiB per-message cap and emits oversize diagnostics
  3. Wire compression defaults to native `CompressionStream('deflate-raw')` with lz-string-compatible decode retained for FSB backward compatibility, and async encoding provably preserves message ordering
  4. Viewer host receives `connecting`/`live`/`stale`/`disconnected` lifecycle events and stream-health telemetry via `on()` — observable by killing the relay mid-stream and watching states transition
**Plans**: 4 plans (4 waves)
**UI hint**: yes

Plans:
**Wave 1**
- [x] 04-01-PLAN.md — Relay core, ws backend, package dependency, and relay safety tests

**Wave 2** *(blocked on 04-01)*
- [x] 04-02-PLAN.md — Endpoint WebSocket transport, native deflate/legacy decode, FIFO ordering tests

**Wave 3** *(blocked on 04-02)*
- [x] 04-03-PLAN.md — Viewer `on('state'|'health')` events, health telemetry, and renderer tests

**Wave 4** *(blocked on 04-01, 04-02, 04-03)*
- [x] 04-04-PLAN.md — `phantom-stream demo`, two-tab UI, automated demo tests, and browser kill-relay checkpoint

### Phase 5: Playwright/CDP Adapter, Remote Control & Agent Demo
**Goal**: A script-driven browser is mirrored live with working, consent-gated remote control — the agent-observability story the paper leads with
**Mode:** mvp
**Depends on**: Phase 4
**Requirements**: ADPT-02, PKG-02, VIEW-05, SEC-04
**Success Criteria** (what must be TRUE):
  1. Playwright/CDP adapter injects capture via `addInitScript`/`Page.addScriptToEvaluateOnNewDocument` + binding bridge from a single-file inject artifact, and the mirror survives page navigations (re-snapshot per nav)
  2. Playwright-driven demo runs: a script drives a real page while the viewer mirrors it live
  3. User can click, type, and scroll in the mirror and see the action happen in the real driven page — reverse-mapped from viewer coordinates and replayed via driver-native input, never synthetic DOM events
  4. Remote control cannot activate unless the host-provided consent/authorization hook approves; denial is observable (control stays inert, state event emitted)
**Plans**: 6 plans (5 waves)
**UI hint**: yes

Plans:
**Wave 0**
- [x] 05-01-PLAN.md — Remote-control protocol constants, validators, privacy redaction, and relay non-execution tests

**Wave 1** *(blocked on 05-01)*
- [x] 05-02-PLAN.md — Playwright/CDP adapter, single-file inject artifact, authorization gate, and driver-native replay
- [x] 05-03-PLAN.md — Renderer inverse coordinate mapping and viewer mapping getter for host-owned control overlays

**Wave 2** *(blocked on 05-02)*
- [x] 05-04-PLAN.md — Local-only Playwright demo server, `playwright-demo` CLI command, package wiring, and Playwright dependency

**Wave 3** *(blocked on 05-03 and 05-04)*
- [x] 05-05-PLAN.md — Approved Playwright demo viewer UI, transparent control overlay, and deterministic fixture

**Wave 4** *(blocked on 05-05)*
- [x] 05-06-PLAN.md — Full automated gate, browser verification checkpoint, and verification evidence artifact

### Phase 6: Extension MV3 + Bookmarklet Adapters
**Goal**: The remaining injection contexts work — the extension content-script path FSB will swap onto, plus the bookmarklet loader
**Mode:** mvp
**Depends on**: Phase 5 (relay/transports from Phase 4; inject artifact tooling from Phase 5)
**Requirements**: ADPT-01, ADPT-03
**Success Criteria** (what must be TRUE):
  1. MV3 adapter delivers a live mirror from a real loaded extension: content-script injection + service-worker relay client with the `chrome.alarms` watchdog, state in `chrome.storage.session` (never SW globals)
  2. A mid-stream forced service-worker eviction recovers automatically (watchdog-triggered re-snapshot) — covered by a test
  3. Bookmarklet loader stub injects the capture bundle into the current page and a live mirror appears in a connected viewer
**Plans**: 5 plans (5 waves)

Plans:
**Wave 0**
- [x] 06-01-PLAN.md — Extension/bookmarklet adapter exports, inject-artifact wiring, and adapter tests

**Wave 1**
- [x] 06-02-PLAN.md — MV3 content-script injection + service-worker relay client

**Wave 2**
- [x] 06-03-PLAN.md — `chrome.alarms` watchdog + `chrome.storage.session` state + eviction recovery

**Wave 3**
- [x] 06-04-PLAN.md — Bookmarklet loader stub + diagnostics

**Wave 4**
- [x] 06-05-PLAN.md — Browser UAT for live mirror paths + verification evidence

### Phase 7: WeakMap Node Identity + Semantic Addressing API
**Goal**: The observed page is no longer mutated by capture, and hosts can address mirrored elements semantically through a public API
**Mode:** mvp
**Depends on**: Phase 6 (all adapter surfaces exist, so the addressing rework is verified across every consumer; must precede shadow DOM)
**Requirements**: CAPT-07, VIEW-03
**Success Criteria** (what must be TRUE):
  1. Zero `data-fsb-nid` attributes are written to the observed page — capture uses a WeakMap-based two-sided Mirror with documented ID lifecycle rules (minting, move preservation, reset); a grep gate enforces no nid-attribute strings remain
  2. The wire-addressing contract is preserved: the differential oracle confirms op-stream equivalence, and overlays + remote control still address nodes by nid
  3. Host can query and highlight a mirrored element through the public node-identity API (e.g. highlight the node an agent is about to touch)
  4. Renderer resolves diff ops via an incremental `Map<nid, Node>` — the per-op `querySelector` hot path is gone, enforced by a regression test
**Plans**: 4 plans

Plans:
- [x] 07-01-PLAN.md — WeakMap two-sided Mirror + nodeIds sidecars (stop writing data-fsb-nid)
- [x] 07-02-PLAN.md — Renderer Map<nid,Node> index replacing per-op querySelector
- [x] 07-03-PLAN.md — Public node-identity/highlight API (getNodeId, resolveNode, highlightNode, clearHighlight)
- [x] 07-04-PLAN.md — Inject artifact identity parity + docs + oracle gate

### Phase 8: Shadow DOM, Iframes & Fidelity Completion
**Goal**: The mirror is faithful on the modern web — shadow roots, iframes, typed input, late-added styles, and truncated regions all render correctly
**Mode:** mvp
**Depends on**: Phase 7 (shadow-root addressing requires the WeakMap Mirror; protocol extension designed jointly)
**Requirements**: CAPT-05, CAPT-06, CAPT-08, CAPT-09, CAPT-11
**Success Criteria** (what must be TRUE):
  1. Open shadow DOM content is mirrored — serialization, diffs, and addressing extend into shadow roots as structured ops with real shadow roots constructed in the mirror; slotted content is not duplicated
  2. Same-origin iframe content is mirrored; cross-origin iframes render as labeled placeholders
  3. Text typed into form fields appears live in the mirror (explicit input-event capture beyond MutationObserver `value` blindness)
  4. Nodes added after the snapshot render with computed styles consistent with snapshot-era siblings (batched style reads, no per-node reflow)
  5. Viewer can request an on-demand subtree fetch to recover a truncated region without waiting for a new snapshot
**Plans**: 9 plans (7 waves)

Plans:
**Wave 0**
- [x] 08-01-PLAN.md — RED shadow DOM and iframe fidelity tests
- [x] 08-02-PLAN.md — RED form value and late-added style tests
- [x] 08-03-PLAN.md — RED subtree fetch and Playwright fidelity tests

**Wave 1** *(blocked on Wave 0)*
- [x] 08-04-PLAN.md — Protocol contracts and open shadow DOM implementation

**Wave 2** *(blocked on 08-04)*
- [x] 08-05-PLAN.md — Same-origin iframe mirroring and cross-origin placeholders

**Wave 3** *(blocked on 08-05)*
- [x] 08-06-PLAN.md — Live value diffs and late-added computed styles

**Wave 4** *(blocked on 08-06)*
- [x] 08-07-PLAN.md — Bounded on-demand subtree fetch

**Wave 5** *(blocked on 08-07)*
- [x] 08-08-PLAN.md — Playwright inject artifact sync and adapter verification

**Wave 6** *(blocked on 08-08)*
- [x] 08-09-PLAN.md — Docs, differential oracle, and final automated gate

### Phase 9: CSSOM Capture Mode
**Goal**: Stylesheet-centric capture is available behind a config flag — fixing frozen-style drift, shrinking payloads, and powering the paper's ablation arm
**Mode:** mvp
**Depends on**: Phase 8 (settled protocol, identity, and shadow-root `adoptedStyleSheets` handling)
**Requirements**: CAPT-10
**Success Criteria** (what must be TRUE):
  1. With the flag enabled, the mirror renders from captured stylesheets instead of per-element inlined styles, verified on fixtures including production-built CSS-in-JS, cross-origin CDN CSS, and constructable sheets
  2. Cross-origin `cssRules` access failures fall back per sheet through the documented fallback chain (href re-link → adapter-permitted fetch → computed-style fallback) without breaking the mirror
  3. `insertRule`-injected styles and `adoptedStyleSheets` changes are reflected in the mirror via a style-ops channel — or the snapshot-only scope is loudly documented for the paper's limitations section
**Plans**: 8 plans (6 waves)

Plans:
**Wave 0**
- [x] 09-01-PLAN.md — RED capture/protocol/security CSSOM tests
- [x] 09-02-PLAN.md — RED renderer/browser/oracle CSSOM tests

**Wave 1** *(blocked on Wave 0 capture/security tests)*
- [x] 09-03-PLAN.md — Protocol contract and CSSOM snapshot/fallback capture

**Wave 2** *(blocked on 09-03; 09-04 also requires 09-02)*
- [x] 09-04-PLAN.md — Renderer CSSOM snapshot replay for document, shadow, and frame scopes
- [x] 09-05-PLAN.md — Capture dynamic style-source op producer

**Wave 3** *(blocked on 09-04 and 09-05)*
- [x] 09-06-PLAN.md — Renderer style-source op application

**Wave 4** *(blocked on 09-05 and 09-06)*
- [x] 09-07-PLAN.md — Playwright/browser inject artifact CSSOM sync

**Wave 5** *(blocked on 09-07)*
- [x] 09-08-PLAN.md — CSSOM oracle, docs, and final automated gate

### Phase 10: npm Packaging & 0.x Publish
**Goal**: `@full-self-browsing/phantom-stream` is installable from npm with clean ESM exports, generated types, and < 5-minute quickstarts
**Mode:** mvp
**Depends on**: Phase 9 (all six limitation fixes in the package; demos from Phases 4–5 already exercise the API)
**Requirements**: PKG-03, PKG-04
**Success Criteria** (what must be TRUE):
  1. `npm install @full-self-browsing/phantom-stream` works from the public registry: ESM-only subpath exports, JSDoc-generated `.d.ts`, provenance via trusted publishing, published as 0.x
  2. `attw --pack`, `publint`, and a tarball-install smoke test pass as permanent CI jobs
  3. Quickstart docs cover each adapter (extension, Playwright/CDP, bookmarklet, embedded) with a verified < 5-minute path to a live mirror
**Plans**: 5 plans (5 waves)
**Publish gate**: Workflow, validation, and dry-run are complete; the public npm registry publish was approved and `@full-self-browsing/phantom-stream@0.1.0` is live.

Plans:
**Wave 0**
- [x] 10-01-PLAN.md — RED package validation tests for exports, types, tarball contents, docs, and release workflow

**Wave 1** *(blocked on 10-01)*
- [x] 10-02-PLAN.md — JSDoc declaration generation, root export, and typed export map

**Wave 2** *(blocked on 10-02)*
- [x] 10-03-PLAN.md — Package validation tooling, tarball smoke, and CI package gate

**Wave 3** *(blocked on 10-03)*
- [x] 10-04-PLAN.md — Quickstarts and README/package docs refresh

**Wave 4** *(blocked on 10-04)*
- [x] 10-05-PLAN.md — Trusted-publishing release workflow, release docs, dry-run, and real publish auth gate

### Phase 11: FSB Swap-In → 1.0
**Goal**: FSB runs on the published package as its streaming layer — the demanding consumer that froze the API at 1.0
**Mode:** mvp
**Depends on**: Phase 10 (FSB consumes the *published* 0.x package)
**Requirements**: FSB-01
**Success Criteria** (what must be TRUE):
  1. FSB's bundled streaming code is replaced by the published package and verified end-to-end: live dashboard preview, remote control, and watchdog/eviction recovery all work
  2. Wire backward compatibility holds — FSB's shipped envelope (`{_lz, d}` decode, session stamping) interoperates without dashboard-side changes beyond the swap
  3. 1.0 is published after the swap-in passes, with the missing-identity compatibility bypass hardened in the same protocol-version bump
**Plans**: None in this repo — verification lives in the FSB repo (FSB consumes the published npm package; FSB dashboard/agent code stays in the FSB repo).

### Phase 12: Static Assets by Reference
**Goal**: The already-shipped by-reference asset pipeline is verified and hardened as a first-class media feature — every static visual (`<img>`/`srcset`/`<picture>`/`<source>`/SVG `<image>`/`background-image`/`<video>` poster) renders in the viewer by loading the original absolute source URL, the displayed variant is pinned, non-shareable refs degrade to placeholders, and the viewer-fetch security model (precise CSP, fail-closed origin policy, `mediaMode`) is established because static images are *already* a viewer-fetch surface
**Mode:** mvp
**Depends on**: Phase 11 (rides the shipped v1.0 pipeline; lowest-risk integration — elements + URLs must be indexed before any media sync can address them)
**Requirements**: ASST-01, ASST-02, ASST-03, ASST-04, ASST-05, MSEC-01, MSEC-02
**Success Criteria** (what must be TRUE):
  1. Image assets (`<img>`, `srcset`, `<picture>`, `<source>`, SVG `<image>`), CSS `background-image`, and `<video>` poster URLs resolve to absolute source URLs on the wire and render in the viewer by fetching from the original CDN/source — verified that no image bytes traverse the relay
  2. The displayed image variant is pinned via clone-only `currentSrc` enrichment so the cross-origin viewer (different DPR/viewport) loads the same asset the origin showed, not a re-negotiated one; the enrichment is ledgered in the differential oracle
  3. Non-shareable references (`blob:`/origin-local object URLs; oversized `data:` URIs) are detected at capture and degrade to a dimensioned placeholder, never a broken reference or a `blob:` on the wire
  4. The viewer CSP is opened precisely enough to fetch referenced assets (scoped `media-src`/confirmed `img-src`) while keeping `default-src 'none'` and no `script-src` — asserted by a srcdoc test
  5. A fail-closed host origin/scheme policy hook (conservative default: https-only, block private/internal ranges) governs which asset URLs the viewer may fetch, and a `mediaMode` switch (`off` | `poster` | `reference`) selects the privacy/bandwidth posture with a documented default
**Plans**: 3 plans (2 waves)
**UI hint**: yes
**Research**: Standard patterns — verification of shipped behavior + a small clone-only enrichment + one CSP directive + the policy-hook/`mediaMode` seam. Skip `--research-phase`.

Plans:
**Wave 1**
- [x] 12-01-PLAN.md — Verify shipped by-reference pipeline (relay byte-identity, confirm-only CSP) + RED Wave-0 test scaffolds (ASST-01, ASST-02, ASST-05)

**Wave 2** *(blocked on 12-01)*
- [x] 12-02-PLAN.md — Capture: ASSET_DATA_URI_MAX_BYTES + blob:/oversized-data placeholder degrade + clone-only data-ps-currentsrc + D26 oracle (ASST-03, ASST-04)
- [x] 12-03-PLAN.md — Renderer: pure fail-closed origin classifier + mediaMode + pre-write fetch gate (string-layer snapshot + diff/subtree) + currentSrc pin + SECURITY.md (ASST-02, ASST-03, MSEC-01, MSEC-02)

### Phase 13: Video/Audio URL + Playback Sync
**Goal**: The defining v2.0 capability — progressive `<video>`/`<audio>` play in the viewer from the source URL with drift-corrected playback sync (play/pause/seek/rate) over a new throttled `STREAM.MEDIA` side channel, autoplay-policy-correct, with the relay and envelope untouched and old viewers safely ignoring the new type
**Mode:** mvp
**Depends on**: Phase 12 (the media element + its URL must be on the wire and indexed by nid before sync can address it)
**Requirements**: MEDIA-01, MEDIA-02, MEDIA-03, MEDIA-04, MEDIA-05, MWIRE-01, MWIRE-02
**Success Criteria** (what must be TRUE):
  1. Progressive/direct `<video>` (mp4/webm) and `<audio>` (mp3/ogg) play in the viewer, loading bytes from the source URL never through the relay, driven cross-realm from the parent (no player code in the no-`allow-scripts` sandbox)
  2. Initial media state (currentTime, paused, muted, volume, playbackRate, loop, duration) is captured in the snapshot as the baseline, and play/pause/seek/ratechange stream over the throttled media-sync channel and apply with drift-corrected interpolation — hard-seek only on large drift or explicit seek, never per-message
  3. A `STREAM.MEDIA` throttled side-channel op (a structural twin of the scroll channel) carries nid-addressed, identity-stamped playback state within the raw-relay + 1 MiB-cap contract; it is envelope-backward-compatible (old FSB viewers ignore the unknown type) and the relay and envelope are unchanged
  4. The drift reconciler is a pure, configurable function unit-tested in jsdom (in-tolerance → hold; small persistent → rate-nudge; large/loop → seek; live → rejoin-edge; `Infinity` duration → no `NaN`) with no real media timeline
  5. The viewer honors autoplay policy — muted-autoplay default, an observable host-overlay affordance when `play()` is rejected — so the mirror never wedges on a blocked play
**Plans**: TBD
**UI hint**: yes
**Research**: Standard patterns — the media-sync channel is a documented twin of the existing scroll/overlay side channels; rrweb provides the proven reconciler model; the reconciler is a pure function unit-testable in jsdom. Skip `--research-phase`.

### Phase 14: Adaptive Streaming + Adapter Discovery + Fallback
**Goal**: Best-effort adaptive playback — when an HLS (`.m3u8`) or DASH (`.mpd`) manifest is available, the viewer plays it via an optional, lazy player running in a renderer-owned **parent realm** (never inside the mirror sandbox); Playwright/CDP and extension adapters surface manifest URLs by network observation as opt-in hints with graceful absence; MSE-without-manifest/DRM degrade to poster with a documented reason; live streams are handled — the mirror never breaks
**Mode:** mvp
**Depends on**: Phase 13 (adaptive reuses the media element + sync channel; only the source-binding mechanism differs)
**Requirements**: MADPT-01, MADPT-02, MADPT-03, MADPT-04
**Success Criteria** (what must be TRUE):
  1. When an HLS/DASH manifest URL is available, the viewer plays it via an optional, lazy player running in a renderer-owned parent-realm surface that binds cross-realm to the inert in-iframe element (only `hls.js` is added — optional, lazy; DASH via a host-provided-player seam; native HLS uses no library); the no-`allow-scripts` sandbox token is unchanged
  2. The Playwright/CDP and extension adapters can surface manifest URLs not present as a plain element `src` (network observation), fed to the viewer as opt-in hints; absence of an adapter degrades gracefully to native-progressive-only with no errors
  3. Media that cannot be referenced (MSE/`blob:` without a discoverable manifest, DRM/EME) degrades to poster/placeholder with an observable, documented reason — the mirror never breaks
  4. Live streams (infinite/NaN duration) are handled — live-edge sync, no absolute seek
**Plans**: TBD
**UI hint**: yes
**Research**: Likely needs `--research-phase 14` during planning — the only genuinely uncertain area. Cross-realm MSE binding (creating `MediaSource` in the parent and assigning its object URL to the in-iframe `<video>`), hls.js cross-realm `attachMedia(iframeEl)`, whether the child needs `connect-src`, and manifest→element correlation from CDP/`webRequest` initiator chains all warrant empirical Playwright validation.

### Phase 15: Media Security, Masking, Threat Model & Docs
**Goal**: Close the milestone by completing the security contract that was *threaded* through Phases 12–13 — full asset/media URL masking + `referrerpolicy="no-referrer"`, a threat-review of the parent-realm object-URL blast radius, media-specific security tests, and the SECURITY/ARCHITECTURE documentation updates (limitation #6 — `<video>`/`<audio>` no longer fully out). Security *decisions* were made earlier; this phase completes, threat-models, and tests them — it does not begin them
**Mode:** mvp
**Depends on**: Phase 14 (the parent-realm MSE cross-realm binding must exist to threat-review its blast radius; masking must cover every media path A–C)
**Requirements**: MSEC-03, MSEC-04
**Success Criteria** (what must be TRUE):
  1. Asset/media URL masking is complete: the host masking vocabulary redacts/strips token/PII-bearing query params and `maskMediaSelector`/`blockSelector` omit private media URLs from the wire (masked media degrades to placeholder) — routed through the same fail-closed capture-side `sanitizeForWire` chokepoint
  2. Viewer-side fetch minimizes leakage — `referrerpolicy="no-referrer"` and no credentials by default on mirrored media/img; secrets-on-the-wire implications are documented
  3. The parent-realm object-URL blast radius is threat-reviewed and documented (the child still cannot script), the sandbox token is verified unchanged, and the `allow-scripts`-forbidden static scan covers media code paths
  4. Media-specific security tests pass (hostile `<source src=javascript:>`, `media-src` CSP coverage with `default-src 'none'` retained and no `script-src`, masked-media-emits-no-state, late-cross-session media-sync rejected by `isCurrentStream`) and `docs/SECURITY.md`/`docs/ARCHITECTURE.md` are updated (limitation #6)
**Plans**: TBD
**Research**: Likely needs `--research-phase 15` during planning — the threat model is well-articulated, but the parent-realm object-URL blast-radius review and the precise default origin/private-IP denylist (concrete denylist + host-override surface) warrant a focused security pass.

## Future Milestones

Recorded for continuity. Not in the active phase list; phase numbers are assigned when the milestone is opened.

### Milestone v2.1 — Evaluation & Research Paper (provisional Phases 16–17)

Deferred from v1.0 and re-sequenced to *follow* media so the paper can evaluate the v2.0 media-by-reference story. Supersedes the old "Phase 12: Evaluation" / "Phase 13: Research Paper" entries that existed during v1.0 — those are relocated here.

- **Provisional Phase 16 — Evaluation Corpus & Harness** (EVAL-01..06): a frozen, replayable HAR-record/replay site corpus with scripted activity levels; bandwidth/latency vs WebRTC screen capture, CDP screencast, and rrweb live mode under identical conditions; the style-capture ablation (full enumeration vs curated inlining vs stylesheet-centric); fidelity scoring combining pixel metrics (pixelmatch/SSIM) with a DOM-level semantic-fidelity metric plus a failure taxonomy; the harness doubling as the framework's performance regression suite; and a new media-by-reference evaluation arm (EVAL-06: URL-reference media vs CDP screencast/WebRTC pixel capture).
- **Provisional Phase 17 — Research Paper** (PAPR-01, PAPR-02): a submission-ready full system-track paper draft (abstract through discussion: design rationale, production reliability, evaluation results) for a WWW/UIST/CHI-tier venue, with a related-work treatment grounded in primary sources (rrweb internals, co-browsing systems, CDP screencast, agent-observability viewers).

**Note:** A dedicated research pass is flagged for the eval harness — the baseline-fairness protocol details and the semantic-fidelity metric definition need settling before harness implementation (carried from v1.0 STATE concerns).

### Other deferred work (no milestone assigned yet)

- **Fidelity & Channels** — cursor-position channel + viewer cursor rendering (FID2-01); periodic budgeted canvas refresh, opt-in (FID2-02); caret/selection mirroring in form fields (FID2-03).
- **Ecosystem** — rrweb-format export bridge (ECO2-01); telemetry surface hardening from FSB production feedback (ECO2-02); multi-viewer scale-out patterns documentation (ECO2-03).

## Progress

**Execution Order:**
Phases execute in numeric order. v1.0 (1–11) is complete. v2.0 active order: 12 → 13 → 14 → 15.

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Capture Core Extraction + Differential Oracle | 5/5 | Complete | 2026-06-10 |
| 2. Renderer Core + Embedded Loopback Mirror | 6/6 | Complete | 2026-06-11 |
| 3. Security Pipeline — Sanitization + Privacy Masking | 5/5 | Complete | 2026-06-14 |
| 4. Relay, WS Transport & Two-Tab Demo | 4/4 | Complete | 2026-06-15 |
| 5. Playwright/CDP Adapter, Remote Control & Agent Demo | 6/6 | Complete | 2026-06-15 |
| 6. Extension MV3 + Bookmarklet Adapters | 5/5 | Complete | 2026-06-15 |
| 7. WeakMap Node Identity + Semantic Addressing API | 4/4 | Complete | 2026-06-15 |
| 8. Shadow DOM, Iframes & Fidelity Completion | 9/9 | Complete | 2026-06-15 |
| 9. CSSOM Capture Mode | 8/8 | Complete | 2026-06-16 |
| 10. npm Packaging & 0.x Publish | 5/5 | Complete | 2026-06-16 |
| 11. FSB Swap-In → 1.0 | — | Complete (verified in FSB repo) | 2026-06-16 |
| 12. Static Assets by Reference | 3/3 | Complete   | 2026-06-20 |
| 13. Video/Audio URL + Playback Sync | 0/TBD | Not started | - |
| 14. Adaptive Streaming + Adapter Discovery + Fallback | 0/TBD | Not started | - |
| 15. Media Security, Masking, Threat Model & Docs | 0/TBD | Not started | - |
