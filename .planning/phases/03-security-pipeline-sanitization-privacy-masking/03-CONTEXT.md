# Phase 3: Security Pipeline — Sanitization + Privacy Masking - Context

**Gathered:** 2026-06-11
**Status:** Ready for planning

<domain>
## Phase Boundary

Mirrored content becomes safe to render and masked content never leaves the captured page — the hard gate for anything embeddable or published. Covers SEC-01 (capture-side sanitization in ALL serialization paths through one named chokepoint), SEC-02 (render-side sanitization chokepoint + sandboxed iframe contract documented), SEC-03 (rrweb-compatible capture-side privacy masking in all serialization paths).

Out of scope: remote-control consent gating (SEC-04 → Phase 5), relay/transport (Phase 4), WeakMap identity (Phase 7).

</domain>

<decisions>
## Implementation Decisions

### Sanitization Policy Strictness
- **Blocklist policy (fidelity-first):** strip `on*` event-handler attributes, `javascript:`/`vbscript:`/`data:text/html` schemes in URL attributes, the `srcdoc` attribute; neutralize `<object>`/`<embed>` (and keep existing `<script>` stripping). An allowlist was explicitly rejected — mirroring arbitrary real sites is the product; fidelity must survive sanitization.
- **CSS sanitization: targeted value scrub** at the chokepoint — `url()` schemes restricted to http/https/data:image*, strip `expression()` and `-moz-binding`, neutralize non-http(s) `@import`. No full CSS parser (zero-dependency constraint).
- **mXSS test corpus: curated in-repo fixture suite** — namespace-confusion (svg/math), noscript tricks, mutation-XSS classics — run against BOTH chokepoints (capture-side and render-side).
- **Strips are counted + logged** (same observability discipline as the renderer's miss accounting) — never silent.

### Masking Semantics (SEC-03)
- **rrweb-compatible defaults:** password inputs ALWAYS masked (non-configurable); other inputs unmasked by default; `maskInputs: true` masks all input values. Vocabulary: `blockSelector`, `maskTextSelector`, `maskInputs`, custom mask functions (per REQUIREMENTS SEC-03).
- **`blockSelector` renders a placeholder box preserving the blocked element's dimensions** (rrweb semantics) — blocked content never appears on the wire in any form.
- **Mask representation: `*` per non-whitespace character, whitespace and length preserved** (rrweb-compatible).
- **All serialization paths:** the same masking helpers run in snapshot serialization, the differ (text ops, attr ops, input value changes), and side channels. Masked content never leaves the captured page — capture-side only, by requirement.

### Viewer Enforcement + Embed Contract
- **CSP meta in srcdoc (backstop behind the sanitizer):** `default-src 'none'; img-src http: https: data:; style-src 'unsafe-inline'; font-src http: https: data:` — exact policy documented; adjust only with documented rationale if mirror fidelity requires (e.g., media-src), never weaker than script-blocking.
- **Embed security contract lives in `docs/SECURITY.md`** — sandbox token contract (`allow-same-origin` only, never `allow-scripts`), host must-nevers, threat model, masking guarantees — with a README pointer.
- **Sanitizers are always-on with NO opt-out config on either side** (project constraint: non-negotiable). The loopback demo dogfoods the full pipeline.
- **Oracle discipline:** capture-side sanitization is a deliberate divergence from the reference (reference passes raw content; extracted strips). Ledger it like D6 — tightly scoped, scenario-pinned (a fixture with `on*`/`javascript:` content), load-bearing.

### Claude's Discretion
- Module layout (e.g., `src/capture/sanitize.js` / shared `src/security/` helpers vs in-file sections) — chokepoint NAMING is the requirement, placement is discretion
- Exact mXSS vector list and fixture format
- Sanitization counter names and logger message formats
- How `<object>/<embed>` neutralization renders viewer-side (placeholder vs removal)
- DOM-fragment sanitization implementation on the render side (template parsing + tree walk)

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/capture/index.js` — serialization paths to hook: `serializeDOM`/`processAddedNode` (snapshot + add-op subtrees), attr-op branch, text-op branches (characterData + E2 text-childlist), input handling; shell-attr `on*` drop already exists for html/body (the gap is everywhere else — documented as Pitfall-9 parity pin in `src/renderer/snapshot.js`)
- `src/renderer/snapshot.js` — 5-entry wire-value insertion inventory comment (WR-03 fix) marks exactly where render-side sanitization must interpose; `buildSnapshotHtml` is the natural render chokepoint feed
- `src/renderer/diff.js` — add-op innerHTML parsing is the second render-side insertion point (div-context parsing; `<template>` upgrade already queued in README Phase-3+ notes — this phase may take it)
- `tests/differential/` — D1–D6 ledger patterns for the new sanitization divergence entry; scenario format for a sanitization fixture
- `tests/capture-skip.test.js` — pattern for predicate-based capture tests (blockSelector tests will look similar)
- Phase 1/2 purity tests — pattern for asserting the chokepoint is the ONLY path (e.g., static scan that serialization call sites route through the named sanitizer)

### Established Patterns
- Injected options seam on `createCapture` (masking config joins `{ logger, overlayProvider, skipElement }`)
- Contained helpers (`safeSkipElement` style) — masking/sanitizer host callbacks must be error-contained the same way
- Counted + logged observability (miss accounting, parse-drop counting)
- Ledgered intentional divergences with load-bearing oracle scenarios

### Integration Points
- `createCapture` options object gains masking config; `createViewer` needs no masking API (capture-side only)
- `docs/` directory exists (ARCHITECTURE.md, DESIGN-HISTORY.md) — SECURITY.md joins it
- Suite at 130/130; CI Node 20/22/24; test glob covers `tests/*.test.js tests/differential/*.test.js`

</code_context>

<specifics>
## Specific Ideas

- This phase is the "hard gate for anything embeddable or published" — bias toward defense-in-depth (sanitize both ends + sandbox + CSP), but never at the cost of mirror fidelity on benign content; the mXSS suite plus the existing 130-test suite must both stay green.
- Continue the loopback demo as the dogfood: after this phase the demo runs the full security pipeline by default with no visible fidelity change.

</specifics>

<deferred>
## Deferred Ideas

- Remote-control consent hook (SEC-04) — Phase 5 by traceability
- `<template>`-based add-op parsing upgrade — queued in renderer README; this phase MAY take it as part of the render chokepoint work (planner's call), otherwise stays queued

</deferred>
