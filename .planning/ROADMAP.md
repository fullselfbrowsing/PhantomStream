# Roadmap: PhantomStream

## Overview

PhantomStream extracts a shipped, production-proven DOM-mirroring system out of FSB into a standalone framework, npm package, and research paper. The journey is dependency-driven: build the differential oracle before touching the serializer, prove the Transport seam with a zero-infrastructure loopback mirror, land the security pipeline before anything embeddable or publishable, then go networked (`npx phantom-stream demo`), add the Playwright/CDP and extension adapters, fix all six inherited limitations (identity rework → shadow DOM/fidelity → CSSOM mode), publish 0.x, verify the FSB swap-in to freeze the API at 1.0, and finally run the frozen-corpus evaluation that feeds the system-track paper. Every phase ends runnable.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Capture Core Extraction + Differential Oracle** - Oracle-anchored extraction of the capture core behind the Transport seam (completed 2026-06-10)
- [x] **Phase 2: Renderer Core + Embedded Loopback Mirror** - Embeddable viewer + first end-to-end mirror with zero infrastructure (completed 2026-06-11)
- [x] **Phase 3: Security Pipeline — Sanitization + Privacy Masking** - Both-ends sanitization, sandbox contract, capture-side masking (publishing gate) (completed 2026-06-14)
- [ ] **Phase 4: Relay, WS Transport & Two-Tab Demo** - Networked mirror: relay core, ws backend, CompressionStream codec, `npx phantom-stream demo`
- [x] **Phase 5: Playwright/CDP Adapter, Remote Control & Agent Demo** - Script-driven page mirrored live with consent-gated remote control (completed 2026-06-15)
- [x] **Phase 6: Extension MV3 + Bookmarklet Adapters** - Remaining injection contexts incl. the FSB swap-in surface and eviction recovery (completed 2026-06-15)
- [x] **Phase 7: WeakMap Node Identity + Semantic Addressing API** - Stop mutating the observed page; expose node identity as public API (completed 2026-06-15)
- [ ] **Phase 8: Shadow DOM, Iframes & Fidelity Completion** - Shadow roots, same-origin iframes, input mirroring, added-node styles, subtree fetch
- [ ] **Phase 9: CSSOM Capture Mode** - Flag-enabled stylesheet-centric capture (last limitation fix; the paper's ablation arm)
- [ ] **Phase 10: npm Packaging & 0.x Publish** - `@fullselfbrowsing/phantom-stream` published with clean types and quickstarts
- [ ] **Phase 11: FSB Swap-In → 1.0** - FSB runs on the published package; API freezes at 1.0
- [ ] **Phase 12: Evaluation Corpus & Harness** - Frozen corpus, fair baselines, fidelity metrics; doubles as the regression suite
- [ ] **Phase 13: Research Paper** - Submission-ready system-track draft (WWW/UIST/CHI tier)

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
**Plans**: TBD

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
**Plans**: TBD

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
**Plans**: TBD

### Phase 9: CSSOM Capture Mode
**Goal**: Stylesheet-centric capture is available behind a config flag — fixing frozen-style drift, shrinking payloads, and powering the paper's ablation arm
**Mode:** mvp
**Depends on**: Phase 8 (settled protocol, identity, and shadow-root `adoptedStyleSheets` handling)
**Requirements**: CAPT-10
**Success Criteria** (what must be TRUE):
  1. With the flag enabled, the mirror renders from captured stylesheets instead of per-element inlined styles, verified on fixtures including production-built CSS-in-JS, cross-origin CDN CSS, and constructable sheets
  2. Cross-origin `cssRules` access failures fall back per sheet through the documented fallback chain (href re-link → adapter-permitted fetch → computed-style fallback) without breaking the mirror
  3. `insertRule`-injected styles and `adoptedStyleSheets` changes are reflected in the mirror via a style-ops channel — or the snapshot-only scope is loudly documented for the paper's limitations section
**Plans**: TBD

### Phase 10: npm Packaging & 0.x Publish
**Goal**: `@fullselfbrowsing/phantom-stream` is installable from npm with clean ESM exports, generated types, and < 5-minute quickstarts
**Mode:** mvp
**Depends on**: Phase 9 (all six limitation fixes in the package; demos from Phases 4–5 already exercise the API)
**Requirements**: PKG-03, PKG-04
**Success Criteria** (what must be TRUE):
  1. `npm install @fullselfbrowsing/phantom-stream` works from the public registry: ESM-only subpath exports, JSDoc-generated `.d.ts`, provenance via trusted publishing, published as 0.x
  2. `attw --pack`, `publint`, and a tarball-install smoke test pass as permanent CI jobs
  3. Quickstart docs cover each adapter (extension, Playwright/CDP, bookmarklet, embedded) with a verified < 5-minute path to a live mirror
**Plans**: TBD

### Phase 11: FSB Swap-In → 1.0
**Goal**: FSB runs on the published package as its streaming layer — the demanding consumer that freezes the API at 1.0
**Mode:** mvp
**Depends on**: Phase 10 (FSB consumes the *published* 0.x package)
**Requirements**: FSB-01
**Success Criteria** (what must be TRUE):
  1. FSB's bundled streaming code is replaced by the published package and verified end-to-end: live dashboard preview, remote control, and watchdog/eviction recovery all work
  2. Wire backward compatibility holds — FSB's shipped envelope (`{_lz, d}` decode, session stamping) interoperates without dashboard-side changes beyond the swap
  3. 1.0 is published after the swap-in passes, with the missing-identity compatibility bypass hardened in the same protocol-version bump
**Plans**: TBD

### Phase 12: Evaluation Corpus & Harness
**Goal**: Reproducible evaluation numbers — frozen corpus, fair baselines, dual fidelity metrics — rerunnable as the framework's permanent regression suite
**Mode:** mvp
**Depends on**: Phase 9 (ablation needs CSSOM mode; harness drives via Phase 5's adapter). Corpus/baseline-protocol design may start earlier in parallel
**Requirements**: EVAL-01, EVAL-02, EVAL-03, EVAL-04, EVAL-05
**Success Criteria** (what must be TRUE):
  1. A frozen, versioned HAR-replay corpus with scripted activity levels (idle, reading, agent-driven) exists before any reported number is collected, with the experiment identity triple (corpus version + browser version + harness commit) recorded per run
  2. Bandwidth and latency are measured for PhantomStream vs WebRTC screen capture, CDP screencast, and rrweb live mode under identical corpus conditions, following a documented baseline-configuration protocol
  3. The style-capture ablation (full enumeration vs curated inlining vs stylesheet-centric) reports payload size, serialize latency, and fidelity per arm
  4. Fidelity scoring combines pixel metrics (pixelmatch/SSIM) with a DOM-level semantic-fidelity metric, plus a failure taxonomy; runs report dispersion across n repetitions
  5. The harness reruns locally and in CI as the framework's performance regression suite
**Plans**: TBD

### Phase 13: Research Paper
**Goal**: A full system-track paper draft ready for submission to a WWW/UIST/CHI-tier venue
**Mode:** mvp
**Depends on**: Phase 12 (the harness feeds the paper; numbers only from the frozen corpus)
**Requirements**: PAPR-01, PAPR-02
**Success Criteria** (what must be TRUE):
  1. Full draft spans abstract through discussion — design rationale, production reliability evidence, and evaluation results — in submission-ready form
  2. Related-work treatment is grounded in primary sources: rrweb internals, co-browsing systems, CDP screencast, and agent-observability viewers
  3. Every reported number traces to a frozen corpus version and harness commit (no live-web or training-data figures)
**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12 → 13

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Capture Core Extraction + Differential Oracle | 5/5 | Complete    | 2026-06-10 |
| 2. Renderer Core + Embedded Loopback Mirror | 6/6 | Complete    | 2026-06-11 |
| 3. Security Pipeline — Sanitization + Privacy Masking | 5/5 | Complete    | 2026-06-14 |
| 4. Relay, WS Transport & Two-Tab Demo | 0/TBD | Not started | - |
| 5. Playwright/CDP Adapter, Remote Control & Agent Demo | 6/6 | Complete    | 2026-06-15 |
| 6. Extension MV3 + Bookmarklet Adapters | 5/5 | Complete   | 2026-06-15 |
| 7. WeakMap Node Identity + Semantic Addressing API | 4/4 | Complete   | 2026-06-15 |
| 8. Shadow DOM, Iframes & Fidelity Completion | 0/TBD | Not started | - |
| 9. CSSOM Capture Mode | 0/TBD | Not started | - |
| 10. npm Packaging & 0.x Publish | 0/TBD | Not started | - |
| 11. FSB Swap-In → 1.0 | 0/TBD | Not started | - |
| 12. Evaluation Corpus & Harness | 0/TBD | Not started | - |
| 13. Research Paper | 0/TBD | Not started | - |
