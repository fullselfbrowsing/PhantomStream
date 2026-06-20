# PhantomStream

## What This Is

PhantomStream is DOM-native live browser mirroring: it streams a real browser tab to a remote
viewer as structured DOM data — a one-time style-inlined snapshot plus incremental
MutationObserver diffs addressed by stable node IDs — instead of pixels, with bidirectional
remote control. It was built and shipped inside FSB (Full Self-Browsing) as milestone v0.9.9.1
to power the dashboard's live preview of automated browsing sessions; this repository turns it
into three things at once: **(1)** the SDK FSB plugs back in, **(2)** a published standalone
plug-and-play framework for anything that needs a live, semantically addressable view into a
browser it controls, and **(3)** a full system-track research paper with deep evaluation.

## Core Value

A live, trustworthy, low-bandwidth, *semantically addressable* mirror of a real browser tab —
if everything else fails, capture → relay → render → remote-control must work end-to-end as a
standalone framework.

## Current Milestone: v2.0 Asset & Media Streaming

**Goal:** Extend PhantomStream beyond DOM/text to mirror media **by reference** — stream asset
and media **URLs** (plus small playback-state messages), and let the viewer fetch the bytes from
the original CDN/source over its own network. The relay still carries only text + URLs, so the
low-bandwidth core value is preserved. This reverses v1's "`<video>`/`<audio>` out of scope"
decision via URL-reference (not a WebRTC media pipeline).

**Target features:**
- Static assets (images/`srcset`/`<picture>`/`background-image`/poster) mirrored by absolute URL
- Progressive `<video>`/`<audio>` playback with drift-corrected sync over a throttled `STREAM.MEDIA` channel
- Best-effort adaptive HLS/DASH via an optional, lazy, parent-realm player + adapter manifest discovery
- A governed viewer-fetch security model: fail-closed origin policy, `mediaMode`, URL masking, no-referrer

**Key context:** Research (`.planning/research/v2.0-media/`) found the by-reference asset pipeline
is already ~80–90% shipped (capture absolutifies `src`/`poster`/`srcset`; media tags survive both
sanitizers), so v2.0 concentrates on playback sync, adaptive playback, and a **new viewer-side-fetch
security surface** (the first feature where the viewer fetches third-party bytes — SSRF/tracking/leak
risk). The no-`allow-scripts` sandbox forces adaptive players into a parent realm, never the mirror.
The evaluation harness and research paper are deferred to milestone v2.1.

## Requirements

### Validated

<!-- Shipped inside FSB and proven in production; preserved verbatim under reference/. -->

- ✓ DOM snapshot capture with curated computed-style inlining (~85 props, default elision) — existing (`reference/extension/dom-stream.js`)
- ✓ rAF-batched MutationObserver diff streaming (`add`/`rm`/`attr`/`text` ops by stable nid) — existing
- ✓ Budgeted snapshot truncation (2-pass, whole-subtree, single batched layout read) — existing
- ✓ LZ-string compression envelope (`{_lz, d}`) with plain-JSON fallback — existing
- ✓ Session/snapshot identity stamping + viewer-side staleness rejection — existing
- ✓ Dual watchdogs (content-script self-watchdog + MV3-surviving `chrome.alarms` safety net) — existing
- ✓ WebSocket relay fan-out with 1 MiB per-message cap + diagnostics — existing (`reference/server/ws-handler.js`)
- ✓ Viewer reconstruction in sandboxed iframe with scaling, layout modes, overlays, dialog mirroring — existing (`reference/dashboard/dashboard.js`)
- ✓ Remote control reverse path (click/type/scroll with coordinate reverse-mapping) — existing
- ✓ Clean dependency-free protocol module — existing (`src/protocol/`)
- ✓ Capture core decoupled from `chrome.runtime`/`window.FSB` behind an injected `Transport` interface — runs in any injection context, with lifecycle (`start`/`stop`/`pause`/`resume`), purity grep-enforced in CI, and reliability defenses test-pinned — Validated in Phase 1 (CAPT-01, CAPT-02, CAPT-03)
- ✓ Extracted capture verified against `reference/` via a dual-jsdom differential oracle on frozen fixtures, with machine-enforced divergence ledger (D1 mismatch + D2–D5 mappings) — Validated in Phase 1 (CAPT-04)
- ✓ Renderer decoupled from the FSB dashboard into an embeddable viewer (`createViewer({ container, transport })`, sandboxed iframe, scale-to-fit, extensible overlay registry, scroll/dialog parity) — Validated in Phase 2 (VIEW-01, VIEW-04, VIEW-06)
- ✓ Embedded-SDK adapter + first-light loopback demo (`npm run example:loopback`) — a page mirrors itself live with zero infrastructure, verified in real Chrome — Validated in Phase 2 (ADPT-04)
- ✓ Security pipeline for embeddable/publishable mirroring — capture-side sanitization in all serialization paths, renderer defense-in-depth with sandbox/CSP contract, and capture-side privacy masking vocabulary (`blockSelector`, `maskTextSelector`, `maskInputs`, custom mask fns) — Validated in Phase 3 (SEC-01, SEC-02, SEC-03)
- ✓ Networked mirror foundation — transport-agnostic raw relay, self-hostable WebSocket backend, endpoint-owned native deflate transport with legacy `_lz` decode, viewer lifecycle/health events, and local two-tab demo verified in real Chrome/FSB — Validated in Phase 4 (RELY-01, RELY-02, VIEW-02, PKG-01)
- ✓ Playwright/CDP adapter + agent-observability demo — single-file inject artifact, binding bridge, consent-gated native input replay, reverse-mapped mirror control, local Playwright-driven demo, browser verification, and threat verification — Validated in Phase 5 (ADPT-02, PKG-02, VIEW-05, SEC-04)
- ✓ Extension MV3 + bookmarklet adapters — generated browser inject artifact, page-world bridge, service-worker watchdog state, bookmarklet loader diagnostics, and browser UAT for live mirror paths — Validated in Phase 6 (ADPT-01, ADPT-03)
- ✓ WeakMap node identity + semantic addressing API — capture no longer writes framework identity attributes into the observed page, identity travels through `nodeIds` sidecars, renderer resolves through a private Map index, and hosts can use `getNodeId`, `resolveNode`, `highlightNode`, and `clearHighlight` — Validated in Phase 7 (CAPT-07, VIEW-03)
- ✓ Modern web fidelity completion — open shadow DOM sidecars/reconstruction, same-origin iframe mirroring with cross-origin placeholders, live form value diffs, computed styles for late-added nodes, bounded on-demand subtree recovery, relay-cap hardening, and Playwright inject parity — Validated in Phase 8 (CAPT-05, CAPT-06, CAPT-08, CAPT-09, CAPT-11)
- ✓ Stylesheet-centric capture mode (CSSOM) — opt-in `styleMode: 'cssom'`, scoped `styleSources[]` / `styleStrategy`, live `DIFF_OP.STYLE_SOURCE` ops, fallback diagnostics, Playwright inject support, and D25 oracle coverage — Validated in Phase 9 (CAPT-10)
- ✓ npm package published — `@full-self-browsing/phantom-stream@0.1.0` live on the public registry with ESM-only subpath exports, JSDoc-generated `.d.ts`, `publint`/`attw` clean, tarball-install smoke as CI gates, trusted-publishing workflow, and < 5-minute quickstarts — Validated in Phase 10 (PKG-03, PKG-04)
- ✓ FSB swap-in → 1.0 — FSB runs on the published package as its streaming layer, verified end-to-end (live preview, remote control, watchdog/eviction recovery) with wire backward compatibility preserved; verification lives in the FSB repo — Validated in Phase 11 (FSB-01)

### Active

<!-- Current scope (milestone v2.0 — Asset & Media Streaming). Building toward these. -->

**Static assets by reference:**
- [ ] Images/`srcset`/`<picture>`/`background-image`/poster mirror by absolute URL and render in the viewer from source; `currentSrc`-pinned; non-shareable refs (`blob:`/oversized `data:`) degrade to placeholder; viewer CSP opened precisely

**Time-based media + sync:**
- [ ] Progressive `<video>`/`<audio>` play in the viewer from the source URL with drift-corrected playback sync (play/pause/seek/rate) over a throttled `STREAM.MEDIA` side channel; autoplay-policy-correct

**Adaptive + fallback:**
- [ ] Best-effort HLS/DASH manifest mirroring via an optional, lazy, parent-realm player; adapter network-discovery of manifest URLs; MSE-without-manifest / DRM degrade to poster

**Media security & privacy:**
- [ ] Fail-closed viewer-fetch origin policy, `mediaMode: 'off'|'poster'|'reference'`, asset/media URL masking, `referrerpolicy="no-referrer"` — the viewer now fetches third-party bytes, so the fetch surface is governed and leak-minimized

<!-- Deferred to milestone v2.1 (Evaluation & Research Paper): EVAL-* evaluation corpus/harness, PAPR-* system-track paper. -->

### Out of Scope

- Multi-viewer fan-out beyond what the relay already does — future work, not needed for the framework or the paper
- CRDT/multi-writer collaboration — single-writer mirror by design; the paper argues why this isn't needed
- Cross-origin iframe content mirroring — browser security boundary; documented limitation
- WebRTC/pixel media relay and re-encoding/transcoding — destroys the low-bandwidth core value; v2.0 mirrors media by URL reference instead
- `<canvas>`/WebGL pixel-frame streaming and Web Audio / `getUserMedia` capture — out of scope; conflicts with the bandwidth and security posture
- DRM/EME content and MSE/`blob:` media with no discoverable manifest — unshareable by design; degrade to poster/placeholder with a documented reason
- Mobile browsers / non-Chromium-first support — targets Chromium contexts (extension MV3, CDP); portability later
- Building FSB features in this repo — FSB only consumes the package; its dashboard/agent code stays in the FSB repo

## Context

- **Brownfield extraction.** The complete shipped implementation exists verbatim under
  `reference/` (extension capture, ws client, background excerpts, dashboard viewer, server
  relay), pinned to FSB commit `867d6f0c`. Eleven phases of original planning docs, UAT, and
  verification live under `reference/planning/`. The codebase map is at `.planning/codebase/`.
- **Extraction state:** `src/protocol/` is done (messages, envelope, constants — clean ESM,
  dependency-free, tested with `node --test`). `src/capture/`, `src/renderer/`, `src/relay/`,
  `src/transport/websocket.js`, and `src/adapters/playwright.js` now hold the extracted
  capture/viewer cores, Phase 3 sanitization and masking gates, the raw relay/ws backend,
  endpoint WebSocket transport, Playwright/CDP adapter, extension/bookmarklet adapters,
  the Phase 7 WeakMap/nodeIds identity contract with semantic addressing APIs, and the
  Phase 8 shadow DOM/iframe/value/subtree fidelity extensions, and Phase 9 opt-in CSSOM
  stylesheet capture.
- **Docs are strong:** `docs/ARCHITECTURE.md` (full system description + 6 known limitations),
  `docs/DESIGN-HISTORY.md` (what failed and why — e.g. the 45 s YouTube serialize that forced
  curated style capture), `docs/paper/OUTLINE.md` (paper structure + evaluation plan).
- **The paper and the framework feed each other:** the stylesheet-centric capture variant is
  both a v1 framework feature and the paper's key ablation arm; the evaluation harness doubles
  as the framework's performance regression suite.
- **Known performance lessons are encoded** in DESIGN-HISTORY.md (curate don't enumerate,
  batch layout reads, rAF-matched flushing, whole-subtree truncation, identity beats ordering)
  and must survive the extraction.

## Constraints

- **Tech stack**: Plain JS ESM + JSDoc types, `.d.ts` generated via `tsc` — capture core must
  inject as a plain script into arbitrary contexts (content script, `addInitScript`,
  bookmarklet); no runtime build step for the library itself
- **Compatibility**: Wire protocol should remain backward-compatible with FSB's shipped
  envelope (`{_lz, d}`, session stamping) where practical, so FSB swap-in is low-risk
- **Security**: Published framework renders attacker-influenced HTML in the viewer —
  sanitization on both ends + sandboxed iframe (no `allow-scripts`) is non-negotiable
- **Performance**: Must not regress the encoded lessons (snapshot interactivity on heavy
  pages, single-pass layout reads, paint-cadence diff delivery)
- **Research integrity**: Evaluation must be reproducible — frozen site corpus, scripted
  activity levels, baselines (WebRTC, CDP screencast, rrweb) run under identical conditions

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Framework-first sequencing (extract → demo → FSB swap-in → paper) | A clean standalone framework is the prerequisite for both other deliverables | Framework + FSB swap-in shipped (v1.0, Phases 1–11); paper deferred to v2.1 |
| Plain JS ESM + JSDoc types, generated `.d.ts` (not TypeScript migration) | Sources must inject build-free into page contexts; consumers still get full types; `tsc --checkJs` enforces in CI | Validated in Phase 10 |
| All six inherited limitations are v1 must-fix, not deferred | Published framework can't ship known security/fidelity gaps; CSSOM mode doubles as paper ablation | Validated in Phase 9 |
| FSB integration verified from this repo via published npm package | Keeps "SDK that plugs back into FSB" an observable success criterion here, while FSB code stays in its own repo | Validated in Phase 11 |
| Full system-track paper (WWW/UIST/CHI tier), no fixed deadline | Deep evaluation valued over fast turnaround; arXiv/workshop versions can derive from the full draft | Deferred to milestone v2.1 |
| Both demos: two-tab + Playwright-driven | Two-tab proves plug-and-play; Playwright proves the agent-observability story the paper leads with | Validated in Phases 4–5 |
| Media is mirrored by URL reference, not by value | Streaming pixels/bytes destroys the low-bandwidth core value; rrweb proves URL-reference is the industry default; reverses v1's video/audio exclusion | — Pending (v2.0) |
| Adaptive players (hls.js/dash.js) run in a parent-realm script surface, never inside the no-`allow-scripts` mirror sandbox | Weakening the sandbox to "make video work" is a catastrophic XSS regression; native progressive media plays in-sandbox driven cross-realm, MSE players bind from the parent; only hls.js added (optional, lazy) | — Pending (v2.0) |
| Viewer-side asset/media fetch is governed (fail-closed origin policy + `mediaMode` + URL masking + no-referrer) | v2.0 is the first feature where the viewer fetches third-party bytes on its own network — a new SSRF/tracking/leakage surface that scheme-sanitization doesn't cover | — Pending (v2.0) |
| Evaluation harness + research paper deferred to milestone v2.1 | Media streaming prioritized as the immediate next chapter; the paper should evaluate it, so it follows media rather than preceding it | — Pending (v2.1) |
| Security pipeline is enforced before relay/publishing work | Anything embeddable or published must be safe to render and must not leak masked content | Validated in Phase 3 |
| Relay stays raw; compression and decode are endpoint-owned | Keeps routing transport-agnostic, preserves byte-cap diagnostics, and maintains FSB `_lz` compatibility without a relay-side payload dependency | Validated in Phase 4 |
| Consent-gated remote control belongs in host/adapter boundaries, not renderer/relay | Renderer exposes geometry only and relay stays raw; the adapter owns authorization and driver-native replay | Validated in Phase 5 |
| Capture and renderer identity is private state, not live-page markup | Prevents framework identity from mutating or colliding with the observed page while preserving opaque nid addressing through `nodeIds` sidecars | Validated in Phase 7 |
| Phase 8 fidelity extensions use sidecars and bounded refreshes instead of live frame loads or unbounded payloads | Keeps the viewer inert/sandboxed and preserves relay-cap guarantees while adding shadow DOM, iframe, value, late-style, and subtree recovery fidelity | Validated in Phase 8 |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-06-19 — milestone v1.0 closed (Phases 1–11: framework + npm publish + FSB swap-in); milestone v2.0 Asset & Media Streaming started; eval harness + paper deferred to v2.1*
