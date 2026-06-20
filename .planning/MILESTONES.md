# Milestones: PhantomStream

History of shipped milestones. Newest first.

## v1.0 — Standalone Framework, npm Package & FSB Swap-In

**Shipped:** 2026-06-16
**Phases:** 1–11
**Outcome:** PhantomStream extracted out of FSB into a standalone, dependency-light, plug-and-play framework, published to npm and proven by the FSB swap-in.

**What shipped:**
- **Phase 1** — Capture core extracted behind an injected `Transport` seam; differential oracle (reference-vs-extracted equivalence on frozen fixtures) with a machine-enforced divergence ledger.
- **Phase 2** — Embeddable renderer (`createViewer`) + first end-to-end loopback mirror with zero infrastructure.
- **Phase 3** — Security pipeline: both-ends sanitization chokepoints, sandbox/CSP contract, capture-side privacy masking (the publishing gate).
- **Phase 4** — Networked mirror: transport-agnostic raw relay, self-hostable WebSocket backend, native `deflate-raw` codec with legacy `_lz` decode, viewer lifecycle/health events, `npx phantom-stream demo`.
- **Phase 5** — Playwright/CDP adapter, consent-gated remote control, agent-observability demo.
- **Phase 6** — Extension MV3 + bookmarklet adapters (incl. the FSB swap-in injection surface and eviction recovery).
- **Phase 7** — WeakMap node identity + semantic addressing API (the observed page is no longer mutated).
- **Phase 8** — Modern-web fidelity: open shadow DOM, same-origin iframes, live form values, late-added computed styles, bounded subtree recovery.
- **Phase 9** — Opt-in CSSOM (stylesheet-centric) capture mode — last inherited limitation fixed; the paper's ablation arm.
- **Phase 10** — npm packaging & 0.x publish: **`@full-self-browsing/phantom-stream@0.1.0`** published to the public registry (ESM-only subpath exports, JSDoc-generated `.d.ts`, `publint`/`attw` clean, trusted-publishing workflow), with < 5-minute quickstarts.
- **Phase 11** — FSB swap-in → 1.0: FSB runs on the published package as its streaming layer (verified end-to-end in the FSB repo; wire backward-compat preserved).

**Headline result:** `@full-self-browsing/phantom-stream@0.1.0` is installable from npm and consumed by FSB.

**Deferred out of v1.0** (carried into a later research milestone, v2.1): the evaluation corpus/harness (`EVAL-*`) and the system-track research paper (`PAPR-*`).

---
*This file is updated at each milestone boundary (`/gsd-complete-milestone`, `/gsd-new-milestone`).*
