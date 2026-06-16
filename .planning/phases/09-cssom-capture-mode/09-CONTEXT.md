# Phase 9: CSSOM Capture Mode - Context

**Gathered:** 2026-06-16
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 9 delivers an optional stylesheet-centric capture mode behind a capture
configuration flag. With that flag enabled, PhantomStream should mirror from
captured stylesheet/CSSOM sources instead of per-element computed-style
inlining, while preserving the existing computed-style mode as the default
compatibility path.

This phase owns CAPT-10: CSSOM capture, cross-origin `cssRules` fallback,
`insertRule`-style dynamic CSS, and `adoptedStyleSheets`. It does not own npm
publishing, FSB swap-in, the full evaluation harness, paper writing, or new
browser-boundary bypasses.

</domain>

<decisions>
## Implementation Decisions

### Discussion Mode
- **D-01 [informational]:** The interactive question UI was unavailable in this Conductor mode, so the workflow fallback selected all meaningful Phase 9 gray areas and captured conservative planning defaults.
- **D-02 [informational]:** These decisions are defaults for downstream research and planning. If research finds a concrete blocker, the planner must surface the deviation explicitly instead of silently changing scope.

### Capture Mode Boundary
- **D-03:** CSSOM mode is opt-in and additive. The current curated computed-style mode remains the default behavior and should continue to satisfy existing oracle/security/demo tests.
- **D-04:** In CSSOM mode, capture should stop overwriting every serialized element with computed inline styles. Page-authored inline `style` attributes may remain after sanitization, but generated computed inline styles should be limited to shell/placeholder/fallback cases that are necessary for a working mirror.
- **D-05:** CSSOM snapshots should carry explicit style-strategy metadata, such as mode, source counts, fallback counts, and approximate CSS bytes. Exact field names are planner discretion. This is enough for Phase 9 fixtures and the later Phase 12 ablation; full benchmark reporting remains Phase 12.
- **D-06:** CSSOM mode must compose with Phase 8 scopes: top document, open shadow roots keyed by host nid, and same-origin frame documents keyed by frame nid. Closed shadow roots and cross-origin iframe content remain non-captured browser boundaries.

### Stylesheet Collection And Fallback Chain
- **D-07:** The fallback chain is locked: read same-origin/readable `cssRules` first; for blocked cross-origin sheets, preserve a safe href relink; then use an explicitly host/adapter-permitted fetch hook when supplied; finally fall back to the existing curated computed-style path for the affected scope if the stylesheet cannot be represented.
- **D-08:** No CORS, CSP, extension, or browser security bypass is in scope. Adapter-permitted stylesheet fetch must be explicit host capability, not a hidden behavior of the core capture module.
- **D-09:** Preserve stylesheet source order and enough source metadata for correct cascade behavior: scope, owner kind, href vs inline vs constructable, media/disabled state where observable, and stable source identity for later updates.
- **D-10:** All CSS text introduced by CSSOM mode, including inline style blocks, readable rules, fetched CSS, constructable sheet text, and dynamic replacements, must route through the existing CSS sanitization/scrub policy before reaching the wire or renderer.

### Live CSS Mutation Handling
- **D-11:** Phase 9 should implement a narrow live style-op path rather than documenting CSSOM mode as snapshot-only. The goal is to make class flips and dynamically inserted rules behave like live DOM diffs in normal cases.
- **D-12:** Prefer carrying style updates through the existing `STREAM.MUTATIONS` identity/staleness envelope with a new style op family, instead of adding relay behavior or a separate top-level transport channel. Exact op name and fields are planner discretion.
- **D-13:** Style ops should operate at stylesheet/source granularity, not individual CSS rule deltas. A changed source can be replaced/upserted/removed for a scope; rAF batching should dedupe multiple rule changes before send.
- **D-14:** Dynamic coverage should include `<style>` text changes, stylesheet link `href`/`media`/`disabled` changes, `CSSStyleSheet.insertRule`/`deleteRule`/`replace`/`replaceSync` when observable, and `document`/shadow-root `adoptedStyleSheets` replacement.
- **D-15:** If a runtime cannot observe a dynamic CSS operation safely, emit content-free diagnostics and request or allow a fresh snapshot rather than silently letting the mirror drift.

### Renderer And Compatibility
- **D-16:** Existing `stylesheets[]` and `inlineStyles[]` remain backward-compatible snapshot fields. CSSOM mode may add richer sidecars, but old viewers should fail soft or render best-effort rather than crash.
- **D-17:** The renderer must apply CSSOM snapshot/style-op data inside the existing sandboxed iframe and reconstructed shadow/frame scopes. Do not weaken the no-scripts sandbox or CSP posture to support styles.
- **D-18:** Renderer insertion of CSSOM text must use the same defense-in-depth model as current inline styles: CSS scrub before insertion, post-parse sanitization for DOM content, and content-free diagnostics.
- **D-19:** DOM attr/class diffs should work with CSSOM mode naturally because stylesheet rules, not stale computed inline styles, control cascade. Tests should explicitly cover class flips that are currently defeated by generated inline styles.
- **D-20:** Browser-injected artifacts must stay synchronized: `src/adapters/playwright-inject.js`, extension content-script artifacts, and bookmarklet paths must receive the same CSSOM behavior without introducing a runtime build step.

### Verification Shape
- **D-21:** Required fixtures include production-style CSS-in-JS class names, a cross-origin CDN stylesheet fallback, constructable/adopted stylesheets, `insertRule`/`deleteRule`, open shadow-root scoped styles, and same-origin frame scoped styles.
- **D-22:** Include regression tests proving CSSOM mode avoids broad computed-property enumeration in the normal path. Curated computed style fallback remains allowed only when fallback policy selects it.
- **D-23:** Add payload-size and serialize-latency smoke evidence for representative fixtures, but keep the full ablation harness and baseline comparisons in Phase 12.
- **D-24:** Keep the differential oracle honest: CSSOM mode is an opt-in divergence from the reference and should be ledgered narrowly; default computed mode should remain reference-compatible except for already-declared divergences.

### the agent's Discretion
- Exact option names for enabling CSSOM mode.
- Exact payload field names, JSDoc typedef names, and source-id format.
- Whether the style-op constant is named `style`, `style-source`, `stylesheet`, or similar.
- Exact hook mechanics for observing constructable stylesheet mutations, provided unsupported hooks degrade loudly and safely.
- Exact module split/refactor scope inside `src/capture/index.js` and renderer files, provided the no-build injected artifact remains maintainable.
- Exact diagnostic counter names, fixture pages, and test file organization.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase Scope
- `.planning/ROADMAP.md` - Phase 9 goal, dependency on Phase 8, CAPT-10 mapping, and success criteria.
- `.planning/REQUIREMENTS.md` - CAPT-10 requirement definition and traceability.
- `.planning/PROJECT.md` - active v1 requirement for stylesheet-centric capture and project constraints.
- `.planning/STATE.md` - current Phase 9 concern: style-op channel vs snapshot-only limitation.

### Prior Phase Decisions
- `.planning/phases/08-shadow-dom-iframes-fidelity-completion/08-CONTEXT.md` - shadow/frame/value/subtree sidecar patterns, sanitizer reuse, and explicit CSSOM deferral to Phase 9.
- `.planning/phases/07-weakmap-node-identity-semantic-addressing-api/07-CONTEXT.md` - WeakMap identity, `nodeIds` sidecars, renderer identity index, and no live-page identity mutation.
- `.planning/phases/06-extension-mv3-bookmarklet-adapters/06-CONTEXT.md` - no-build injected artifact precedent and adapter verification expectations.
- `.planning/phases/04-relay-ws-transport-two-tab-demo/04-CONTEXT.md` - raw relay, endpoint-owned transforms, and content-free telemetry decisions.

### Architecture And Security
- `docs/ARCHITECTURE.md` - current capture/renderer architecture, Phase 8 sidecars, known limitation #1, and style pipeline description.
- `docs/DESIGN-HISTORY.md` - performance lessons: curate not enumerate, batched reads, paint-cadence diffs, and Phase 8 style deferral.
- `docs/SECURITY.md` - sanitizer, CSP, sandbox, and Phase 9 warning that CSSOM mode must keep Phase 8 security constraints.
- `.planning/codebase/ARCHITECTURE.md` - pipeline overview and reference lineage.
- `.planning/codebase/STRUCTURE.md` - package/module/test organization.
- `.planning/codebase/CONCERNS.md` - frozen computed-style drift and CSSOM limitation.

### Current Framework Code
- `src/capture/index.js` - current computed-style collection, stylesheet/link collection, inline style collection, frame/shadow serialization, sanitizer paths, mutation batching, and snapshot budget pruning.
- `src/capture/README.md` - capture factory, lifecycle, identity sidecars, Phase 8 fidelity surfaces, and CSSOM mode queued for Phase 9.
- `src/protocol/messages.js` - `STREAM`, `DIFF_OP`, snapshot typedefs, frame/shadow payloads, and staleness helpers to extend.
- `src/renderer/snapshot.js` - srcdoc builder, stylesheet links, inline style insertion, CSP meta, and shell style handling.
- `src/renderer/index.js` - viewer snapshot routing, iframe sandbox, identity index, shadow/frame installation, and subtree request handling.
- `src/renderer/diff.js` - mutation applier and likely integration point for a style-op family.
- `src/adapters/playwright-inject.js` - checked-in classic script artifact that must stay synchronized with capture changes.

### Tests And Oracle
- `tests/capture-added-styles.test.js` - Phase 8 late-added computed style tests and no-broad-enumeration precedent.
- `tests/security-sanitize-capture.test.js` - capture-side CSS/url sanitizer contract.
- `tests/security-sanitize-render.test.js` - renderer-side sanitizer contract.
- `tests/capture-iframe.test.js` - frame stylesheet and frame sidecar expectations.
- `tests/renderer-iframe.test.js` - reconstructed frame rendering expectations.
- `tests/differential/oracle.test.js` - default-mode reference comparison entry point.
- `tests/differential/divergence-ledger.js` - intentional divergence registry.
- `tests/differential/normalize.js` - normalization policy for new opt-in CSSOM divergences.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `collectStylesheetsFrom(doc)` and `collectInlineStylesFrom(doc)` in `src/capture/index.js` already collect safe `<link rel=stylesheet>` hrefs and sanitized `<style>` text.
- `collectComputedStyleText`, `captureComputedStyles`, and `collectSubtreeComputedStyles` in `src/capture/index.js` are the fallback path and the no-broad-enumeration test precedent.
- Phase 8 frame/shadow serialization already passes `stylesheets`, `inlineStyles`, shell attrs/styles, `shadowRoots[]`, and `frames[]` through scoped sidecars.
- `buildSnapshotHtml` in `src/renderer/snapshot.js` already turns `stylesheets[]` and `inlineStyles[]` into iframe document head content under CSP.
- `applyMutations` in `src/renderer/diff.js` already centralizes staleness, per-op containment, shadow/frame extensions, and resync thresholds.
- `src/protocol/messages.js` already has extension points for new `DIFF_OP` constants and payload typedefs.

### Established Patterns
- New behavior should be additive and config-gated when it changes reference/default semantics.
- Relay stays raw; compression, style transforms, and compatibility behavior belong at endpoints.
- Runtime misses and unsupported browser behavior fail softly through diagnostics/resync, while factory-time validation is the normal throwing boundary.
- Security chokepoints are load-bearing: capture scrubs before transport, renderer scrubs before insertion, and the mirror iframe remains sandboxed without scripts.
- Browser-injected artifacts are checked in as classic scripts and must remain dependency-light.
- Tests use `node:test`, jsdom fixtures, static regression checks, and the differential oracle/divergence ledger.

### Integration Points
- `src/capture/index.js` needs CSSOM source collection, scoped style-source identity, fallback selection, dynamic style observation, and CSSOM-mode serialization branches.
- `src/protocol/messages.js` needs style-source payload typedefs and a style op constant or equivalent mutation-family extension.
- `src/renderer/snapshot.js` and `src/renderer/index.js` need to install CSSOM snapshot data into the main iframe document, shadow roots, and same-origin frame mirrors.
- `src/renderer/diff.js` needs to apply style source upsert/replace/remove ops without breaking existing DOM diff staleness behavior.
- `src/adapters/playwright-inject.js` and other injected artifacts must be regenerated or patched after capture changes.

</code_context>

<specifics>
## Specific Ideas

- Treat CSSOM mode as the paper-ablation arm and the v1 style-drift fix, not as a replacement of the proven default mode.
- The most important visible proof is a class/theme flip that updates in the mirror because CSS rules, not stale generated inline styles, control cascade.
- For dynamic styles, replacing a scoped stylesheet source is acceptable for Phase 9; exact CSS rule deltas are unnecessary complexity unless research proves otherwise.
- CSSOM capture should make payloads smaller in normal cases, but correctness and safe fallback matter more than optimizing every edge case in this phase.

</specifics>

<deferred>
## Deferred Ideas

- Full evaluation harness, baseline comparison, and ablation tables - Phase 12.
- npm packaging, published package quickstarts, and release polish - Phase 10.
- FSB package swap-in and API freeze feedback - Phase 11.
- Automatic retirement of truncation machinery based on CSSOM payload savings - future work after Phase 12 data.
- Cross-origin iframe content mirroring, closed shadow root introspection, and media stream mirroring - still outside v1/browser-boundary scope.

</deferred>

---

*Phase: 09-cssom-capture-mode*
*Context gathered: 2026-06-16*
