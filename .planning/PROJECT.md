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

### Active

<!-- Current scope. Building toward these. -->

**Framework extraction (first priority):**
- [ ] Transport-agnostic relay with pluggable backends (WebSocket reference implementation)
- [ ] All six inherited limitations fixed in the standalone v1:
  - [ ] Sanitization as a first-class stage (`on*` attrs, `javascript:` URLs stripped in all serialization paths; sandboxed rendering enforced)
  - [ ] Stylesheet-centric capture mode (CSSOM) — fixes frozen-style drift, shrinks payloads, enables the paper's ablation
  - [ ] Computed styles for nodes added after the snapshot
  - [ ] On-demand subtree fetch to close the truncation gap interactively
  - [ ] WeakMap-based node identity (stop mutating the observed page with `data-fsb-nid`)
  - [ ] Shadow DOM mirroring

**Plug-and-play surface:**
- [ ] Host adapters for every context that makes sense: extension content script, Playwright/CDP, bookmarklet, embedded SDK
- [ ] Two-tab demo (`npx phantom-stream demo`: capture one tab, mirror live in another via bundled relay)
- [ ] Playwright-driven demo (script drives a real page; viewer mirrors live with remote control)
- [ ] npm package published as `@fullselfbrowsing/phantom-stream` with JSDoc-generated `.d.ts`

**FSB integration:**
- [ ] FSB swap-in verified from this repo — FSB consumes the published package as its streaming layer

**Research paper:**
- [ ] Evaluation harness: bandwidth/latency/fidelity vs. WebRTC screen capture, CDP screencast, rrweb across a frozen site corpus
- [ ] Style-capture strategy ablation (full enumeration vs. curated inlining vs. stylesheet-centric)
- [ ] Full system-track paper draft ready for submission (WWW / UIST / CHI tier)

### Out of Scope

- Multi-viewer fan-out beyond what the relay already does — future work, not needed for v1 or the paper
- CRDT/multi-writer collaboration — single-writer mirror by design; the paper argues why this isn't needed
- Cross-origin iframe content mirroring — browser security boundary; documented limitation, not solvable in v1
- `<video>`/`<audio>` content mirroring — out of v1; poster/placeholder treatment documented instead
- Mobile browsers / non-Chromium-first support — v1 targets Chromium contexts (extension MV3, CDP); portability later
- Building FSB features in this repo — FSB only consumes the package; its dashboard/agent code stays in the FSB repo

## Context

- **Brownfield extraction.** The complete shipped implementation exists verbatim under
  `reference/` (extension capture, ws client, background excerpts, dashboard viewer, server
  relay), pinned to FSB commit `867d6f0c`. Eleven phases of original planning docs, UAT, and
  verification live under `reference/planning/`. The codebase map is at `.planning/codebase/`.
- **Extraction state:** `src/protocol/` is done (messages, envelope, constants — clean ESM,
  dependency-free, tested with `node --test`). `src/capture/`, `src/relay/`, `src/renderer/`
  are README stubs specifying the planned module splits and decoupling seams.
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
| Framework-first sequencing (extract → demo → FSB swap-in → paper) | A clean standalone framework is the prerequisite for both other deliverables | — Pending |
| Plain JS ESM + JSDoc types, generated `.d.ts` (not TypeScript migration) | Sources must inject build-free into page contexts; consumers still get full types; `tsc --checkJs` enforces in CI | — Pending |
| All six inherited limitations are v1 must-fix, not deferred | Published framework can't ship known security/fidelity gaps; CSSOM mode doubles as paper ablation | — Pending |
| FSB integration verified from this repo via published npm package | Keeps "SDK that plugs back into FSB" an observable success criterion here, while FSB code stays in its own repo | — Pending |
| Full system-track paper (WWW/UIST/CHI tier), no fixed deadline | Deep evaluation valued over fast turnaround; arXiv/workshop versions can derive from the full draft | — Pending |
| Both demos: two-tab + Playwright-driven | Two-tab proves plug-and-play; Playwright proves the agent-observability story the paper leads with | — Pending |

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
*Last updated: 2026-06-11 after Phase 2 completion (embeddable viewer + loopback mirror live; text-node fidelity fix D6)*
