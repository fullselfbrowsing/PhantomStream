# Project Research Summary

**Project:** PhantomStream
**Domain:** DOM-native live browser mirroring framework (brownfield extraction → npm SDK + research paper)
**Researched:** 2026-06-09
**Confidence:** HIGH

## Executive Summary

PhantomStream occupies a genuinely empty niche: every live DOM-viewing product today is either a SaaS platform (Surfly, Upscope, Cobrowse.io, Browserbase) or a feature bundled inside one (OpenReplay Assist), and the only embeddable library (rrweb) is a replay tool retrofitted for liveness — buffered, with no reliability layer, no remote control, and no host adapters. There is no maintained standalone live-DOM-mirror SDK. PhantomStream's positioning — a latency-first, semantically addressable mirror with multi-host adapters (extension, Playwright/CDP, bookmarklet, embedded), self-hostable relay, and a published reliability layer — has no direct incumbent. The keystone differentiator is semantic node addressing exposed as a public API: nobody else lets a host say "highlight the element the agent will click" and get DOM-anchored overlays, which is also the paper's core argument ("pixels are the wrong abstraction").

The recommended approach is a **single npm package with subpath exports** (not a monorepo — rrweb/PostHog's package splits solve build-orchestration problems this zero-build ESM project doesn't have), an **emit-only capture core behind an injected `Transport` seam** with host adapters owning all host APIs, and **extract-then-refactor discipline anchored by a differential oracle** against the pinned `reference/` implementation. The stack is deliberately thin: plain JS ESM + JSDoc with TypeScript 6.0.3 emitting `.d.ts`, esbuild producing publish-time-only IIFE injection artifacts, native `CompressionStream` replacing lz-string as the default wire codec, `ws` for the reference relay, and Playwright Test for everything that touches a real DOM (jsdom is disqualified — no layout engine means truncation and style capture are untestable).

The three highest risks are: (1) **behavior drift during extraction** — the reference encodes nine production-incident defenses none of which is currently enforced by a runnable test, so the differential harness must exist *before* the serializer is extracted; (2) **security** — the pipeline is intrinsically serialize→parse, so capture-side-only sanitization is defeated by mXSS, and the `allow-scripts`+`allow-same-origin` sandbox trap means full consumer-origin XSS; both-ends sanitization plus an asserted sandbox must land before any publish; (3) **evaluation invalidity** — live-web corpora, unfair baseline configs, and SSIM-only fidelity are each independently fatal in review; the frozen corpus and baseline-configuration protocol must be designed before any reported number is collected.

## Key Findings

### Recommended Stack

The library core stays zero-build plain ESM; tooling exists only at the edges. Ship `src/` as the real package entry points with `tsc`-generated `.d.ts` in `dist/types/`; esbuild (pinned exact, 0.28.0) produces per-adapter single-file IIFE artifacts at publish time only — MV3 content scripts, `addInitScript`, and bookmarklets all require classic single-file scripts, not ESM. Native `CompressionStream('deflate-raw')` replaces lz-string as the default codec (zero bytes in injection bundles, ~3–4× faster), with lz-string retained behind the existing codec seam for FSB wire compat; the swap's one real hazard is that async encode must preserve send ordering. Publish ESM-only via npm trusted publishing (OIDC) with `attw` + `publint` + tarball smoke tests gating CI. Full details: `STACK.md`.

**Core technologies:**
- **TypeScript 6.0.3 (dev-only)**: `--checkJs` CI gate + `.d.ts` emit from JSDoc — the only tool that does this; 6.0 is the bridge to native TS 7, so adopt its tightened JSDoc dialect now (avoid `@enum`/`@constructor`)
- **esbuild 0.28.0**: per-adapter IIFE injection bundles — zero config, exactly fits "4 small dependency-free artifacts"; Rollup/tsup buy nothing here
- **CompressionStream (native)**: default wire codec — zero footprint in bundles, available in every target context (browsers since 2023, Node ≥18)
- **ws 8.21.0**: reference WebSocket relay — pure JS, registry-installable (uWebSockets.js is verified absent from npm, breaking `npx` plug-and-play); keep `perMessageDeflate: false`
- **@playwright/test 1.60.0**: all browser testing AND the eval harness driver — the only framework that loads MV3 extensions and does multi-page capture-here-render-there scenarios; jsdom disqualified (no layout engine)
- **Node ≥22 engines floor**: built-in WebSocket client + CompressionStream globals; 18/20 are EOL
- **Eval harness (private workspace)**: pixelmatch + ssim.js + pngjs + sharp + rrweb 2.0.1 baseline — heavy deps isolated from the published package

### Expected Features

The ecosystem (rrweb's option vocabulary, Cobrowse.io's "private by default," Browserbase's embed pattern) sets clear table stakes; PhantomStream already has most differentiators built and needs to extract rather than invent them. Full landscape: `FEATURES.md`.

**Must have (table stakes):**
- Privacy masking/redaction hooks (`blockSelector`, `maskTextSelector`, `maskInputs`, custom fns) — universal in the ecosystem, promised in paper §6, **currently missing from PROJECT.md Active requirements**; must run capture-side in all serialization paths
- Sanitization + sandboxed viewer (no `allow-scripts`) — publishing gate, already a PROJECT.md constraint
- `start/stop/pause/resume` + `on()` lifecycle/state/telemetry events (`connecting/live/stale/disconnected`) — the watchdog machinery already produces the signals; they just need a public surface
- Pluggable transport (rrweb's `emit` callback is the de-facto contract) with a self-hostable, dependency-light reference relay
- Embeddable framework-agnostic viewer (`createViewer({ container, transport })` — plain factory + mount element, the ecosystem convention; not a web component)
- Snapshot recovery/re-sync, shadow DOM mirroring, same-origin iframes; cross-origin iframes documented as a limitation (industry-standard)
- TypeScript types, ESM packaging, < 5-minute quickstart demo

**Should have (differentiators):**
- Semantic node addressing as public API — the keystone; nobody exposes element-level identity to the embedding host
- Agent-action overlay channel, generalized from FSB-specific overlays to a documented extensible message type — genuinely unique
- Bidirectional remote control as an embeddable library, with a **host consent/authorization hook** (universal in co-browsing; cheap at extraction time, expensive to retrofit)
- Multi-host adapters — the framework's reason to exist
- Production-grade reliability layer (dual watchdogs, staleness rejection, truncation budget) — published and telemetered
- Stylesheet-centric (CSSOM) capture mode, feature-flagged so the paper ablation is a config switch
- Evaluation harness as a public artifact — no competitor publishes data

**Defer (v2+ / never):**
- rrweb-style replay storage + timeline player (rrweb's mature ecosystem; dilutes live-first identity)
- CRDT multi-writer collaboration (single-writer authoritative tab is the design)
- Universal proxy-based co-browsing, live video/canvas streaming, analytics capture, multi-viewer scale-out infra
- Input-value/cursor mirroring, bookmarklet/embedded adapters, periodic canvas refresh → v1.x on demand triggers

### Architecture Approach

One package, subpath exports, conditional `"node"` exports keeping relay/Playwright/CDP code out of browser bundles — a monorepo would add ceremony with zero payoff for a no-build dependency-free library. The load-bearing pattern is **emit-only capture core + adapter-owned control plane**: the core never listens for inbound messages; it emits through an injected `Transport` (`send`, plus `flush()` for MV3 service-worker drain) and returns a controller object that adapters drive. Adapters are the only code allowed to touch `chrome.*`, Playwright, or CDP — enforce with a grep test in CI. Remote-control *execution* lives in adapters (driver-native input, never synthetic DOM events), and adapters advertise a capability map at session start. The one exception to "no build step" is `dist/capture.inject.js`, a publish-time esbuild artifact, same category as generated `.d.ts`. Full details: `ARCHITECTURE.md`.

**Major components:**
1. `protocol/` — wire types, envelope codec seam, session identity, staleness guard (DONE; the leaf everything imports)
2. `capture/` core — serializer, rAF differ, side channels, watchdog #1; zero host APIs
3. `renderer/` core — sandboxed-iframe reconstruction (`sandbox="allow-same-origin"`, asserted), diff applier with miss accounting, overlays, remote-control capture
4. `relay/` core + `backends/ws` — pure routing/limits with injected backend; ws is reference only
5. `adapters/` — extension MV3, playwright, cdp, embedded; the only host-API surface
6. `transports/ws-client.js` — shared browser WS transport (capture + viewer reuse)
7. `bin/phantom-stream.js` CLI (`demo`, `relay`) + `bench/` private workspace (eval harness = regression suite)

### Critical Pitfalls

Top 5 of 13 documented in `PITFALLS.md` (all 13 map to phases there):

1. **No regression oracle → silent behavior drift** — build a differential harness *before* extracting the serializer: run reference and extracted code side-by-side on frozen fixtures, structurally diff op streams, keep an intentional-divergence ledger. The reference's tests don't run in this repo; without this, "matches the reference" is a vibe and the FSB swap-in becomes the (late, expensive) test.
2. **Losing production hardening in the "clean" rewrite** — first commit of each module is a near-verbatim lift with only transport/options seams changed; treat `docs/ARCHITECTURE.md` §5's nine defenses as a per-PR acceptance checklist; encode performance lessons as tests (snapshot budget, forced-reflow count).
3. **Sanitize-once thinking / mXSS + sandbox trap** — sanitize both ends through one named chokepoint per side (render-side: DOMPurify `RETURN_DOM_FRAGMENT`, never string→`innerHTML`), sandboxed iframe as backstop with a startup assertion that `allow-scripts` is absent, CSP meta in srcdoc, and a CSS sanitization pass (`@import`, `url()` policy — CSS is an exfiltration channel). All pre-publication.
4. **CSSOM mode underestimation** — cross-origin `cssRules` throws (need per-sheet fallback chain), CSS-in-JS production builds have empty `<style>` text (CSSOM is the only truth), `adoptedStyleSheets` live outside the DOM, and **MutationObserver does not see CSSOM mutations** — without a style-ops channel (monkey-patched `insertRule`/`replace`), the mode recreates the frozen-style drift it exists to fix.
5. **Identity rework halfway states + shadow DOM underscoping** — WeakMap migration changes the addressing contract, not just storage: mirror rrweb's two-sided `Mirror` (also killing the O(M×N) `querySelector` hot path), define ID lifecycle rules, and sequence **before** shadow DOM, whose protocol extension (real shadow roots in the mirror, per-root observers, slot non-duplication) should be designed jointly.

## Implications for Roadmap

Research converges on a dependency-driven order: oracle → cores → security → network/demos → adapters → fidelity fixes → publish → swap-in → paper. Each phase ends runnable.

### Phase 1: Capture Core Extraction + Differential Oracle
**Rationale:** The reference is the project's main asset; the oracle must exist before the first refactor or drift is undetectable. Capture is testable with a loopback transport — no adapter or relay needed.
**Delivers:** Differential harness in CI against frozen fixtures + divergence ledger; `src/capture/` extracted near-verbatim behind the `Transport` seam; serializer/differ tests under Playwright (real layout engine); performance-lesson tests (snapshot budget, reflow-count spy).
**Addresses:** Transport-decoupled capture core (P1).
**Avoids:** Pitfalls 1 (hardening loss) and 2 (no oracle). Flag here: the CompressionStream codec swap's async send-ordering hazard — fallback is shipping lz-string default with the new codec opt-in behind the seam.

### Phase 2: Renderer Core + Embedded Loopback Adapter
**Rationale:** Renderer consumes recorded fixtures from Phase 1; the loopback adapter (capture + viewer in one page, direct transport) is the first end-to-end proof with zero infrastructure and *is* the embedded-SDK deliverable. It exposes any hidden capture↔relay coupling immediately.
**Delivers:** `createViewer({ container, transport })` with owned, asserted sandbox (`allow-same-origin` only); Map-based diff apply; first E2E mirror.
**Implements:** Renderer core + `adapters/embedded`.
**Avoids:** Pitfall 4 (sandbox misconfiguration — enforced at creation from day one).

### Phase 3: Security Pipeline — Sanitization + Privacy Masking
**Rationale:** Both ends now exist, so both-ends sanitization is implementable; masking must be designed with the sanitization stage (it touches the same serialization chokepoints) — cheap now, expensive after API freeze. Hard publishing gate.
**Delivers:** Single named chokepoint per side; render-side DOM-fragment sanitization; CSS pass + srcdoc CSP meta; mXSS fixture suite; rrweb-vocabulary masking hooks running capture-side in all three serialization paths.
**Addresses:** Sanitization (limitation #5) + privacy masking (table stakes, **needs adding to PROJECT.md Active**).
**Avoids:** Pitfalls 3 and 5.

### Phase 4: Relay + WS Transports + CLI Two-Tab Demo
**Rationale:** Architecture research explicitly sequences this right after loopback: `npx phantom-stream demo` forces the `files`/exports/bin packaging decisions early and is the plug-and-play acceptance test.
**Delivers:** Relay core (routing, limits with schema/type allowlist, staleness, per-viewer drop accounting) + ws backend + `transports/ws-client.js`; CLI with `demo`/`relay` subcommands; first generic API consumer.
**Uses:** ws 8.21.0 (`maxPayload` = 1 MiB cap, no perMessageDeflate), Node ≥22 built-in WS client.

### Phase 5: Playwright/CDP Adapters + Inject Artifact + Playwright Demo
**Rationale:** Requires `dist/capture.inject.js` — introduce esbuild here. The Playwright demo is the agent-observability story the paper leads with, and remote control via driver-native input proves the reverse path generically.
**Delivers:** `addInitScript` + `exposeBinding` adapter (bindings survive navigation; init script re-runs per nav = free re-snapshot); raw-CDP adapter (`Runtime.addBinding`, stringified envelope); second generic consumer.
**Avoids:** Pitfall 12 setup — two generic consumers exercise the API before publication.

### Phase 6: Extension MV3 Adapter
**Rationale:** Closest to the reference, and the FSB swap-in surface. Sequenced after the generic adapters so MV3's unique lifecycle quirks don't shape the core seam.
**Delivers:** Content-script transport + SW forwarder + `chrome.alarms` watchdog; invariants written down (state in `chrome.storage.session`, never SW globals; context-invalidation wrapping); forced-eviction mid-stream recovery test (DevTools closed).
**Avoids:** Pitfall 10 (MV3 lifecycle loss in translation).

### Phase 7: Node Identity Rework (WeakMap Mirror)
**Rationale:** Must precede shadow DOM — shadow trees can't be addressed by document-level selector queries at all. Also kills the renderer's per-op `querySelector` hot path in the same stroke. Wire addressability (nids) is preserved; only storage and lookup change.
**Delivers:** Two-sided Mirror (capture: `WeakMap<Node,nid>` + reverse map; render: incremental `Map<nid,Node>`); documented ID lifecycle (minting, move preservation, reset); zero `data-fsb-nid` strings remaining; differential op-stream equivalence gate.
**Avoids:** Pitfall 8 (halfway addressing states — rrweb PR #868's exact bug class).

### Phase 8: Shadow DOM + Remaining Fidelity Fixes
**Rationale:** Shadow DOM is a protocol change (the `add` op's raw-HTML payload can't express shadow boundaries), designed jointly with Phase 7's addressing. Added-node computed styles and on-demand subtree fetch ride along — subtree fetch shares the reverse channel that remote control already proved.
**Delivers:** Open shadow roots as structured ops (real shadow roots constructed in the mirror, per-root observers + `adoptedStyleSheets`); closed-root best-effort via `attachShadow` patch; batched style reads for post-snapshot added nodes; interactive subtree fetch closing the truncation gap.
**Avoids:** Pitfall 9 (slot duplication, flattening that breaks `:host`/`::slotted`).

### Phase 9: CSSOM Capture Mode
**Rationale:** The hardest fidelity work and the paper's ablation arm — feature-flagged. Last of the limitation fixes because it depends on settled protocol, identity, and shadow-root sheet handling.
**Delivers:** Per-sheet fallback chain (`cssRules` → href re-link → adapter-permitted CORS fetch/CDP `CSS.getStyleSheetText` → computed-style fallback); `@import` flattening; style-ops channel via CSSOM monkey-patches with WeakMap sheet identity — or a loudly documented snapshot-only scope stated in the paper's limitations.
**Avoids:** Pitfalls 6 and 7. Fixtures must include production-built CSS-in-JS, cross-origin CDN CSS, and constructable sheets.

### Phase 10: npm Packaging + 0.x Publish
**Rationale:** Publish only after both demos exercise the API (Pitfall 12); 0.x explicitly signals churn until the FSB swap-in passes.
**Delivers:** Exports map with `types`-first conditions; `tsc` declaration emit to a separate types dir with CI failing on type errors before emit; `attw --pack` + `publint` + tarball-install smoke test as permanent CI jobs; trusted publishing (OIDC) with provenance from the first release.
**Avoids:** Pitfall 11 (every documented packaging failure mode).

### Phase 11: FSB Swap-in Verification → 1.0
**Rationale:** The demanding consumer gates the API freeze. FSB consumes the *published* package; wire compat (`{_lz, d}`, session stamps) is the contract.
**Delivers:** FSB running on the published 0.x; the "missing-identity = accept" compatibility bypass hardened in the same change that bumps the protocol version; 1.0 release.
**Avoids:** Pitfall 12 (breaking changes against a frozen public surface).

### Phase 12: Evaluation Harness + Paper
**Rationale:** Corpus first, numbers second — a live-web corpus invalidates everything and forces a full redo. Harness design (corpus/baselines) can start anytime, but full runs depend on all adapters and baselines.
**Delivers:** Frozen versioned HAR-replay corpus + deterministic activity scripts; one-page baseline-configuration protocol (WebRTC `getStats`, CDP screencast knobs, rrweb under identical envelope compression); raw + wire bytes for every system; latency with clock alignment; pixel fidelity (pixelmatch + SSIM, protocol written down) **plus a semantic-fidelity metric** (DOM-diff based — the metric pixel baselines can't even score on, making the paper's argument measurable); n runs with dispersion; codec micro-benchmark (lz-string vs deflate-raw vs gzip) resolving the flagged ratio question. Doubles as the permanent perf regression suite.
**Avoids:** Pitfall 13 (the reviewer-killer set).

### Phase Ordering Rationale

- **Oracle before extraction** (Pitfall 2): the differential harness is Phase 1's first task, not an afterthought — every later phase's exit criteria reference it.
- **Loopback before network** (Architecture build order): the embedded adapter proves the Transport seam is real before any relay code exists.
- **Security before any publish** (Pitfalls 3–5): sanitization + sandbox are publishing gates, and masking is designed with them because they share serialization chokepoints.
- **Demos before publish, publish before swap-in, swap-in before 1.0** (Pitfall 12): three consumers — two generic, one demanding — validate the API across the 0.x line.
- **Identity before shadow DOM before CSSOM** (Pitfalls 8, 9, 7): each later fix depends on the earlier one's addressing/protocol groundwork; shadow-root `adoptedStyleSheets` feed straight into CSSOM mode.
- **Corpus before numbers** (Pitfall 13): the experiment identity triple (corpus version + browser version + harness commit) is fixed before any reported run.

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 8 (Shadow DOM):** protocol extension design for shadow boundaries, slot semantics, declarative shadow DOM (`getHTML({serializableShadowRoots})`) availability — rrweb's multi-year issue trail shows the depth.
- **Phase 9 (CSSOM mode):** style-ops protocol design, sheet-identity scheme, fallback-chain hit rates; the most novel engineering in the project.
- **Phase 5 (Playwright/CDP adapters):** re-verify the MV3-content-scripts-can't-be-ESM constraint and current Chrome extension docs (flagged MEDIUM-HIGH in STACK.md; extension capabilities move).
- **Phase 12 (Evaluation):** baseline-fairness protocol details (WebRTC operating points, CDP screencast knobs) and the semantic-fidelity metric definition deserve a dedicated research pass before harness implementation.

Phases with standard patterns (skip research-phase):
- **Phases 1–2 (capture/renderer extraction):** the reference implementation is first-party ground truth; the work is disciplined lifting, not discovery.
- **Phase 4 (relay/CLI):** 1:1 port of `reference/server/ws-handler.js` + standard npm bin conventions.
- **Phase 6 (extension adapter):** closest to the reference; MV3 invariants are already documented in PITFALLS.md.
- **Phases 10–11 (packaging/swap-in):** well-documented checklists exist (attw/publint/trusted publishing); execution, not research.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All versions verified against npm registry 2026-06-09; claims verified against official docs; only the lz-string-vs-deflate ratio is LOW — deliberately deferred to harness measurement |
| Features | MEDIUM-HIGH | rrweb API surface and CDP limits verified against official sources (HIGH); commercial co-browsing capabilities from official docs + marketing (MEDIUM); the "no incumbent SDK" gap claim is well-evidenced |
| Architecture | HIGH | Package-structure and API facts verified against official repos/docs (rrweb, PostHog, Replay.io, Playwright, CDP); recommendations are opinionated synthesis consistent with PROJECT.md constraints |
| Pitfalls | HIGH | Security/CSSOM/MV3/npm items verified against official docs, rrweb issue history, vendor write-ups; extraction-process and evaluation items MEDIUM (practice-based); many pitfalls already inventoried as latent in this repo's CONCERNS.md |

**Overall confidence:** HIGH

### Gaps to Address

- **Codec ratio claims (lz-string vs deflate-raw vs gzip):** LOW confidence by design — must be measured by the harness on the real corpus before any paper claim; never assert from training data.
- **Privacy masking missing from PROJECT.md Active requirements:** strong recommendation to add to v1 during requirements definition — table stakes everywhere, promised in paper §6, cheap during the serializer refactor.
- **Remote-control consent hook + connection-state events:** two more API-surface gaps surfaced by feature research; both cheap at extraction time, expensive to retrofit — fold into requirements.
- **Render-side sanitizer dependency decision:** PITFALLS.md recommends DOMPurify (`RETURN_DOM_FRAGMENT`) on the render side, in tension with the dependency-free ethos; the renderer runs in the consumer's app (not an injection bundle), so a dependency is defensible — decide explicitly during Phase 3 planning. Native Sanitizer API is not a dependable baseline (limited availability).
- **CSSOM mutation tracking scope (v1 style-ops vs documented limitation):** a deliberate scope decision for Phase 9 planning; either path is acceptable, silence in the paper is not.
- **Input-value mirroring fidelity:** form `value` properties don't fire MutationObserver — verify coverage during capture extraction; schedule explicit input capture for v1.x if corpus data shows gaps.
- **MV3 content-script ESM constraint:** MEDIUM-HIGH today; re-verify against current Chrome docs during the adapter phase.

## Sources

### Primary (HIGH confidence)
- npm registry (`npm view`, 2026-06-09) — all stack versions, dist-tags, uWebSockets.js absence
- TypeScript 6.0 release notes; Playwright docs (Chrome extensions, Page API); CDP Runtime/Page domains; MDN (CompressionStream, iframe sandbox, CSSStyleSheet); npm docs (trusted publishers, provenance, files semantics); Chrome extension SW lifecycle docs
- rrweb official guide, sandbox doc, recipes (live-mode, cross-origin iframes, canvas), monorepo layout, PRs #868/#976, issues #45/#71/#933/#702
- Cobrowse.io docs (redaction, consent); Browserbase Live View docs
- This repo: `reference/` (pinned FSB `867d6f0c`), `docs/ARCHITECTURE.md` §5–6, `docs/DESIGN-HISTORY.md`, `.planning/codebase/CONCERNS.md`

### Secondary (MEDIUM confidence)
- PostHog posthog-js monorepo + session-replay architecture handbook; Replay.io npm packages + protocol repo; webext-bridge concepts
- Surfly/Upscope marketing + docs; AWS Bedrock AgentCore, Cloudflare Browser Run, OpenReplay Assist docs; WebVoyager (arXiv 2401.13919)
- Mahimahi (SIGCOMM 2014); "Understanding SSIM" (arXiv 2006.13846); DOMPurify mXSS research (PortSwigger, mizu.re)
- Chrome MV3 content-script ESM constraint (official docs + community consensus — re-verify in adapter phase)

### Tertiary (LOW confidence)
- JS compression benchmarks (lz-string vs deflate speed/ratio) — single-source numbers; flagged for harness measurement by design
- Surfly bandwidth figures (~12–45 KB/s claims) — third-party marketing, do not cite without measurement

---
*Research completed: 2026-06-09*
*Ready for roadmap: yes*
