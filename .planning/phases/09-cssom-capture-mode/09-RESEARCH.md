# Phase 09: CSSOM Capture Mode - Research

**Researched:** 2026-06-16 [VERIFIED: environment current_date]
**Domain:** Stylesheet-centric CSSOM capture, scoped style replay, and live style mutation transport for PhantomStream [VERIFIED: .planning/ROADMAP.md; .planning/phases/09-cssom-capture-mode/09-CONTEXT.md]
**Confidence:** HIGH for local architecture and project constraints; MEDIUM for exact browser hook mechanics around constructable stylesheet mutation observation [VERIFIED: local codebase grep; CITED: https://www.w3.org/TR/cssom-1/; CITED: https://developer.mozilla.org/en-US/docs/Web/API/CSSStyleSheet]

<user_constraints>
## User Constraints (from CONTEXT.md)

Source for this section: copied from `.planning/phases/09-cssom-capture-mode/09-CONTEXT.md`; these are locked inputs for planning unless later research explicitly identifies a blocker. [VERIFIED: .planning/phases/09-cssom-capture-mode/09-CONTEXT.md]

### Locked Decisions

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

### Deferred Ideas (OUT OF SCOPE)

## Deferred Ideas

- Full evaluation harness, baseline comparison, and ablation tables - Phase 12.
- npm packaging, published package quickstarts, and release polish - Phase 10.
- FSB package swap-in and API freeze feedback - Phase 11.
- Automatic retirement of truncation machinery based on CSSOM payload savings - future work after Phase 12 data.
- Cross-origin iframe content mirroring, closed shadow root introspection, and media stream mirroring - still outside v1/browser-boundary scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CAPT-10 | Stylesheet-centric (CSSOM) capture mode is available behind a config flag -- handles cross-origin `cssRules` fallback, `insertRule`-injected styles, and `adoptedStyleSheets`. | Use a config-gated CSSOM branch, scoped style-source sidecars, the locked fallback chain, and style-source mutation ops through `STREAM.MUTATIONS`. [VERIFIED: .planning/REQUIREMENTS.md; VERIFIED: .planning/phases/09-cssom-capture-mode/09-CONTEXT.md] |
</phase_requirements>

## Summary

Phase 9 should be planned as an additive capture/renderer/protocol extension, not a replacement of the current computed-style path. The default path in `src/capture/index.js` currently clones DOM and writes curated computed styles onto elements; CSSOM mode should branch before those generated inline styles for normal document, open-shadow, frame, add-node, and subtree paths while leaving page-authored inline `style` attributes subject to existing sanitization. [VERIFIED: src/capture/index.js; VERIFIED: docs/ARCHITECTURE.md; VERIFIED: docs/DESIGN-HISTORY.md]

The core implementation should introduce scoped style-source records for top document, open shadow roots keyed by `hostNid`, and same-origin frames keyed by `frameNid`. Each source should preserve cascade order and metadata, sanitize CSS before transport, and be applied in the matching renderer scope under the existing iframe sandbox and CSP. [VERIFIED: .planning/phases/09-cssom-capture-mode/09-CONTEXT.md; VERIFIED: src/renderer/index.js; VERIFIED: docs/SECURITY.md]

Dynamic CSS should use a narrow `DIFF_OP` family inside the existing `STREAM.MUTATIONS` envelope. Plan for source-level replace/upsert/remove operations, not individual rule diffs, because CSSOM methods mutate stylesheet rule lists and no project protocol currently needs rule-granular replay. [VERIFIED: src/protocol/messages.js; VERIFIED: src/renderer/diff.js; CITED: https://www.w3.org/TR/cssom-1/]

**Primary recommendation:** Implement `styleMode: "cssom"` as an opt-in capture mode that serializes scoped sanitized style sources plus style-strategy metadata, preserves computed mode as default, and streams source-level style updates through `STREAM.MUTATIONS`. [VERIFIED: .planning/phases/09-cssom-capture-mode/09-CONTEXT.md]

## Project Constraints (from AGENTS.md)

No `AGENTS.md` exists at the repository root, so there are no additional root-level agent directives to enforce. [VERIFIED: `test -f AGENTS.md` returned exit 1]

No project-local `.codex/skills` or `.agents/skills` directories were found, so this research does not import extra project skill conventions beyond the GSD phase instructions. [VERIFIED: local filesystem scan]

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|--------------|----------------|-----------|
| CSSOM source collection | Browser / Client capture | API / Backend only if adapter fetch hook is explicitly supplied | CSSOM APIs live in the page runtime, and cross-origin fetch must remain an explicit host capability rather than hidden core behavior. [VERIFIED: src/capture/index.js; VERIFIED: .planning/phases/09-cssom-capture-mode/09-CONTEXT.md; CITED: https://developer.mozilla.org/en-US/docs/Web/API/CSSStyleSheet/cssRules] |
| Scoped source metadata | Protocol | Capture / Renderer | `messages.js` owns `SnapshotPayload` and `DIFF_OP` typedefs, while capture produces records and renderer consumes them. [VERIFIED: src/protocol/messages.js; VERIFIED: src/capture/index.js; VERIFIED: src/renderer/index.js] |
| CSS sanitization | Capture and Renderer endpoints | Protocol carries only sanitized payloads | Existing security posture requires capture scrub before wire and renderer scrub before insertion. [VERIFIED: docs/SECURITY.md; VERIFIED: src/capture/index.js; VERIFIED: src/renderer/sanitize.js] |
| Live style updates | Browser / Client capture | Renderer diff applier | Mutation batching and `STREAM.MUTATIONS` already originate in capture and terminate in `applyMutations`. [VERIFIED: src/capture/index.js; VERIFIED: src/renderer/diff.js; VERIFIED: src/protocol/messages.js] |
| Shadow and frame style replay | Renderer iframe/shadow/frame scopes | Capture scope registry | Phase 8 reconstructs open shadow roots and same-origin frame documents, so styles must be installed inside those reconstructed scopes. [VERIFIED: src/renderer/index.js; VERIFIED: .planning/phases/08-shadow-dom-iframes-fidelity-completion/08-CONTEXT.md] |
| Browser-injected artifact sync | Adapters / packaged browser artifacts | Capture source module | `src/adapters/playwright-inject.js` is a checked-in classic script artifact and browser/bookmarklet paths share injected behavior. [VERIFIED: src/adapters/playwright-inject.js; VERIFIED: src/adapters/browser-inject.js; VERIFIED: src/adapters/bookmarklet.js] |
| Payload and latency smoke evidence | Tests / validation harness | Capture serializer | Phase 9 requires smoke evidence, while full ablation tables are deferred to Phase 12. [VERIFIED: .planning/phases/09-cssom-capture-mode/09-CONTEXT.md] |

## Standard Stack

### Core

| Library / API | Version | Purpose | Why Standard |
|---------------|---------|---------|--------------|
| Existing PhantomStream capture/renderer/protocol modules | local `0.1.0` package | Extend snapshot, mutation, sanitizer, and renderer scope behavior. | The phase is constrained to the existing architecture and checked-in browser artifacts. [VERIFIED: package.json; VERIFIED: src/capture/index.js; VERIFIED: src/protocol/messages.js] |
| Browser CSSOM: `document.styleSheets`, `CSSStyleSheet.cssRules`, `insertRule`, `deleteRule`, `replace`, `replaceSync` | Web platform API | Read stylesheet rules when origin-clean and observe/mark dynamic stylesheet changes. | CSSOM defines the stylesheet/rule interfaces directly; cross-origin `cssRules` access can throw `SecurityError`. [CITED: https://www.w3.org/TR/cssom-1/; CITED: https://developer.mozilla.org/en-US/docs/Web/API/CSSStyleSheet] |
| `Document.adoptedStyleSheets` and `ShadowRoot.adoptedStyleSheets` | Web platform API | Capture constructable/adopted stylesheet sources for document and shadow scopes. | Adopted stylesheets are the standard platform surface for constructable sheets in documents and shadow roots. [CITED: https://developer.mozilla.org/en-US/docs/Web/API/Document/adoptedStyleSheets; CITED: https://developer.mozilla.org/en-US/docs/Web/API/ShadowRoot/adoptedStyleSheets] |
| Existing CSS scrub/sanitize functions | local implementation | Scrub CSS before transport and before renderer insertion. | Project security docs define these chokepoints as load-bearing. [VERIFIED: docs/SECURITY.md; VERIFIED: src/capture/index.js; VERIFIED: src/renderer/sanitize.js] |
| `node:test` | Node v25.9.0 runtime | Unit, integration, and static regression tests. | The package uses `node --test`, and Node documents `node:test` as the built-in test runner. [VERIFIED: package.json; VERIFIED: `node --version`; CITED: /nodejs/node via Context7 docs] |

### Supporting

| Library / Tool | Version | Purpose | When to Use |
|----------------|---------|---------|-------------|
| `jsdom` | 29.1.1, registry modified 2026-04-30 | Fast renderer/protocol unit tests and DOM fixture construction. | Use for sanitizer, protocol, renderer insertion, and static DOM behavior; do not rely on it for real layout/fidelity. [VERIFIED: package.json; VERIFIED: `npm view jsdom version time.modified`; CITED: /jsdom/jsdom via Context7 docs] |
| Playwright | local package `^1.60.0`; CLI available `1.60.0`; registry latest `1.61.0`, modified 2026-06-15 | Real Chromium tests for CSSOM security errors, adopted stylesheets, dynamic style mutation, and payload/latency smoke. | Use for Phase 9 Nyquist samples that jsdom cannot prove. [VERIFIED: package.json; VERIFIED: `npx --yes playwright --version`; VERIFIED: `npm view playwright version time.modified`; CITED: /microsoft/playwright via Context7 docs] |
| Chromium via Playwright | 148.0.7778.96 | Real-browser CSSOM/fidelity execution. | Required for cross-origin stylesheet fallback, constructable stylesheet, and live mutation smoke tests. [VERIFIED: Playwright launch probe] |
| `ws` | 8.21.0, registry modified 2026-05-22 | Existing relay transport dependency. | No Phase 9 relay change is required because style ops stay inside `STREAM.MUTATIONS`. [VERIFIED: package.json; VERIFIED: `npm view ws version time.modified`; VERIFIED: .planning/phases/09-cssom-capture-mode/09-CONTEXT.md] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Existing CSS scrub policy | Add a new CSS parser/sanitizer package | Do not add a new sanitizer in Phase 9 unless a verified gap appears; the project already requires the capture and renderer scrub chokepoints to remain authoritative. [VERIFIED: docs/SECURITY.md; VERIFIED: tests/security-chokepoint-purity.test.js] |
| Source-level style ops | Rule-level insert/delete ops | Rule deltas are more fragile across fallback sources and async `replace()`; source replacement matches the locked Phase 9 decision. [VERIFIED: .planning/phases/09-cssom-capture-mode/09-CONTEXT.md; CITED: https://www.w3.org/TR/cssom-1/] |
| `STREAM.MUTATIONS` style op | New top-level stream type | A new top-level channel would violate the locked envelope decision and create relay/adapter churn. [VERIFIED: .planning/phases/09-cssom-capture-mode/09-CONTEXT.md; VERIFIED: src/protocol/messages.js] |
| Hidden core fetch for blocked CSS | Adapter-provided `fetchStylesheet`-style hook | Hidden fetch would bypass project security decisions; explicit host capability preserves the browser boundary. [VERIFIED: .planning/phases/09-cssom-capture-mode/09-CONTEXT.md; VERIFIED: docs/SECURITY.md] |

**Installation:**
```bash
npm ci
```

No new production dependency is required for the recommended plan. [VERIFIED: package.json; VERIFIED: local codebase architecture]

**Version verification:**
```bash
npm view jsdom version time.modified
# 29.1.1 / 2026-04-30T08:52:48.629Z
npm view playwright version time.modified
# 1.61.0 / 2026-06-15T17:04:17.067Z
npm view ws version time.modified
# 8.21.0 / 2026-05-22T17:59:59.582Z
```

Keep the existing Playwright package range unless a verified browser bug blocks Phase 9 tests, because package upgrades are not part of the Phase 9 scope. [VERIFIED: package.json; VERIFIED: .planning/phases/09-cssom-capture-mode/09-CONTEXT.md]

## Architecture Patterns

### System Architecture Diagram

```text
Capture config: styleMode="cssom"
        |
        v
Scope registry
  - document
  - shadow hostNid
  - frame frameNid
        |
        v
Collect style sources in cascade order
  readable cssRules -> safe href relink -> explicit adapter fetch hook -> curated computed fallback
        |
        v
sanitizeForWire("css") + styleStrategy counters
        |
        v
STREAM.SNAPSHOT payload
  legacy stylesheets[] / inlineStyles[]
  + cssom styleSources[] sidecar
        |
        v
Renderer srcdoc / shadow root / frame document installers
  scrubCssText before insertion
  use <style>.textContent or safe <link href>
        |
        v
Live CSS changes
  DOM observer + patched CSSStyleSheet mutators + adoptedStyleSheets scan/setter hook
        |
        v
rAF dedupe by scope/sourceId
        |
        v
STREAM.MUTATIONS [{ op: "style-source", action: "upsert|remove|replace" }]
        |
        v
renderer applyMutations -> scoped style installer
```

This flow preserves the existing relay boundary because snapshots and mutations remain endpoint-owned payloads carried through current stream types. [VERIFIED: docs/ARCHITECTURE.md; VERIFIED: .planning/phases/09-cssom-capture-mode/09-CONTEXT.md; VERIFIED: src/protocol/messages.js]

### Recommended Project Structure

```text
src/
├── capture/
│   └── index.js                 # add CSSOM mode, style source collection, style-op producer
├── protocol/
│   └── messages.js              # add StyleSource typedefs and style op constant
├── renderer/
│   ├── snapshot.js              # install top-level styleSources in srcdoc safely
│   ├── index.js                 # install shadow/frame scoped styleSources after reconstruction
│   ├── diff.js                  # apply source-level style mutations
│   └── sanitize.js              # reuse renderer CSS scrub before insertion
└── adapters/
    └── playwright-inject.js     # keep checked-in browser artifact synchronized

tests/
├── capture-cssom-mode.test.js
├── renderer-cssom-mode.test.js
├── security-cssom-sanitize.test.js
├── playwright-cssom-mode.test.js
└── differential/
    └── oracle.test.js           # ledger opt-in CSSOM divergence only
```

This structure is prescriptive for planning but does not require splitting `src/capture/index.js` unless the planner decides the CSSOM code becomes too large for maintainability. [VERIFIED: .planning/phases/09-cssom-capture-mode/09-CONTEXT.md; VERIFIED: current source tree]

### Pattern 1: Scoped Style Source Records

**What:** Represent every captured stylesheet-like source as a sanitized record with scope, owner kind, order, identity, and fallback metadata. [VERIFIED: .planning/phases/09-cssom-capture-mode/09-CONTEXT.md]

**When to use:** Use this for CSSOM snapshots and style-source mutation ops in document, open shadow, and same-origin frame scopes. [VERIFIED: .planning/phases/08-shadow-dom-iframes-fidelity-completion/08-CONTEXT.md]

**Example:**
```js
// Source: project protocol extension pattern in src/protocol/messages.js
// Source: CSSStyleSheet/cssRules behavior from https://www.w3.org/TR/cssom-1/
const source = {
  sourceId: "doc:3:style:n42",
  scope: { kind: "document" },
  ownerKind: "style", // link | style | constructable | adopted | fallback
  order: 3,
  href: null,
  media: "",
  disabled: false,
  cssText: sanitizeForWire("css", readableRulesText),
  fallback: null,
  approxBytes: readableRulesText.length,
};
```

Do not put shadow-root sources into the top document head; a shadow source belongs to the reconstructed shadow root for its `hostNid`. [VERIFIED: src/renderer/index.js; VERIFIED: .planning/phases/09-cssom-capture-mode/09-CONTEXT.md]

### Pattern 2: Locked CSSOM Fallback Chain

**What:** For each stylesheet source, first try readable same-origin CSSOM rules, then safe href relink, then explicit host/adapter fetch, then curated computed fallback for the affected scope. [VERIFIED: .planning/phases/09-cssom-capture-mode/09-CONTEXT.md]

**When to use:** Use this whenever `cssRules` access throws or a source cannot be serialized as CSS text. CSSOM specifies `SecurityError` for non-origin-clean rule access. [CITED: https://www.w3.org/TR/cssom-1/; CITED: https://developer.mozilla.org/en-US/docs/Web/API/CSSStyleSheet/cssRules]

**Example:**
```js
// Source: D-07 fallback chain and CSSOM cssRules SecurityError behavior.
function collectSheetSource(sheet, owner, scope, hooks) {
  try {
    return fromRules(sheet.cssRules, owner, scope);
  } catch (err) {
    if (isSafeRelinkableHref(owner?.href)) return fromHref(owner.href, owner, scope);
    if (hooks.fetchStylesheet) return fromFetchedCss(hooks.fetchStylesheet(owner.href, scope), owner, scope);
    return fromComputedFallback(scope, { reason: "cssRules-blocked" });
  }
}
```

Treat the adapter fetch hook as optional and explicit; the capture core must not silently proxy, bypass CORS, or weaken CSP. [VERIFIED: .planning/phases/09-cssom-capture-mode/09-CONTEXT.md; VERIFIED: docs/SECURITY.md]

### Pattern 3: CSS Text Sanitization Before Wire and Before Insertion

**What:** Route CSS text through capture-side `sanitizeForWire("css", cssText)` before transport and through renderer-side `scrubCssText` before creating/updating a `<style>` element. [VERIFIED: src/capture/index.js; VERIFIED: src/renderer/sanitize.js; VERIFIED: docs/SECURITY.md]

**When to use:** Use for inline `<style>`, readable `cssRules`, fetched CSS, constructable sheet text, dynamic replacement CSS, and fallback CSS blocks. [VERIFIED: .planning/phases/09-cssom-capture-mode/09-CONTEXT.md]

**Example:**
```js
// Source: existing renderer sanitizer contract in src/renderer/sanitize.js
function setScopedStyleText(styleEl, cssText) {
  styleEl.textContent = scrubCssText(String(cssText || ""));
}
```

Use `textContent`, not `innerHTML`, for CSS text insertion so the existing renderer innerHTML sink audit remains narrow. [VERIFIED: tests/security-chokepoint-purity.test.js; VERIFIED: src/renderer/sanitize.js]

### Pattern 4: Source-Level Live Style Ops

**What:** Mark a style source dirty when a related `<style>`, `<link>`, `CSSStyleSheet`, or adopted stylesheet set changes; emit one source-level op after rAF batching. [VERIFIED: .planning/phases/09-cssom-capture-mode/09-CONTEXT.md; VERIFIED: src/capture/index.js]

**When to use:** Use for `<style>` text changes, link `href`/`media`/`disabled`, `insertRule`, `deleteRule`, `replace`, `replaceSync`, and adopted stylesheet replacement or detected reference changes. [VERIFIED: .planning/phases/09-cssom-capture-mode/09-CONTEXT.md; CITED: https://developer.mozilla.org/en-US/docs/Web/API/CSSStyleSheet/insertRule; CITED: https://developer.mozilla.org/en-US/docs/Web/API/CSSStyleSheet/deleteRule; CITED: https://developer.mozilla.org/en-US/docs/Web/API/CSSStyleSheet/replace; CITED: https://developer.mozilla.org/en-US/docs/Web/API/CSSStyleSheet/replaceSync]

**Example:**
```js
// Source: existing STREAM.MUTATIONS batching in src/capture/index.js
queueStyleMutation({
  op: DIFF_OP.STYLE_SOURCE,
  action: "replace",
  sourceId,
  scope,
  source: collectCurrentStyleSource(sourceId),
});
```

Do not plan on a standard stylesheet-change event; use wrapper hooks plus periodic scope reconciliation for adopted stylesheet lists, and emit content-free diagnostics when a hook is unavailable. CSSOM documents stylesheet methods/properties, and the local protocol already uses diagnostic/resync behavior for unsupported runtime cases. [CITED: https://www.w3.org/TR/cssom-1/; VERIFIED: src/capture/index.js; VERIFIED: .planning/phases/09-cssom-capture-mode/09-CONTEXT.md]

### Pattern 5: Scoped Renderer Installation

**What:** Install CSSOM sources in the same scope where they were captured: iframe document head for top-level sources, reconstructed shadow root for `hostNid` sources, and reconstructed frame document for `frameNid` sources. [VERIFIED: src/renderer/index.js; VERIFIED: src/renderer/snapshot.js]

**When to use:** Use during snapshot load and during `STYLE_SOURCE` mutation apply. [VERIFIED: src/renderer/diff.js; VERIFIED: .planning/phases/09-cssom-capture-mode/09-CONTEXT.md]

**Example:**
```js
// Source: renderer scope install pattern from src/renderer/index.js
function applyStyleSource(doc, root, source) {
  if (source.href) {
    const link = doc.createElement("link");
    link.rel = "stylesheet";
    link.href = source.href;
    root.appendChild(link);
    return;
  }
  const style = doc.createElement("style");
  style.textContent = scrubCssText(source.cssText);
  root.appendChild(style);
}
```

Validate safe href schemes before link insertion, matching the current `buildSnapshotHtml` URL filtering. [VERIFIED: src/renderer/snapshot.js; VERIFIED: docs/SECURITY.md]

### Anti-Patterns to Avoid

- **Broad computed-style enumeration in CSSOM mode:** This repeats the performance bug documented in design history and defeats payload reduction. Use CSSOM source collection, with curated computed fallback only after the locked fallback chain selects it. [VERIFIED: docs/DESIGN-HISTORY.md; VERIFIED: tests/capture-added-styles.test.js; VERIFIED: .planning/phases/09-cssom-capture-mode/09-CONTEXT.md]
- **Generated inline styles for normal CSSOM clones:** Generated inline styles can overpower class and theme changes, which is the drift Phase 9 exists to fix. [VERIFIED: docs/ARCHITECTURE.md; VERIFIED: .planning/phases/09-cssom-capture-mode/09-CONTEXT.md]
- **Hidden cross-origin fetch/proxy logic:** This violates the locked security boundary. Use safe href relink or explicit adapter fetch only. [VERIFIED: .planning/phases/09-cssom-capture-mode/09-CONTEXT.md]
- **Raw CSS insertion in renderer:** This bypasses defense-in-depth. Always scrub before insertion and keep the iframe sandbox unchanged. [VERIFIED: docs/SECURITY.md; VERIFIED: src/renderer/index.js]
- **New relay channel:** Relay behavior is intentionally raw and transport-level. Style updates belong in the existing mutation envelope. [VERIFIED: .planning/STATE.md; VERIFIED: .planning/phases/09-cssom-capture-mode/09-CONTEXT.md]
- **Updating source without injected artifact sync:** The Playwright inject artifact and browser/bookmarklet paths must receive the same capture behavior. [VERIFIED: src/adapters/playwright-inject.js; VERIFIED: src/adapters/browser-inject.js; VERIFIED: .planning/phases/09-cssom-capture-mode/09-CONTEXT.md]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| CSS security policy | A new ad hoc sanitizer or CSS parser | Existing `scrubCssText` and `sanitizeForWire("css")`, extended only if tests reveal a verified gap | Project docs and tests already define sanitizer chokepoints. [VERIFIED: docs/SECURITY.md; VERIFIED: tests/security-sanitize-capture.test.js; VERIFIED: tests/security-sanitize-render.test.js] |
| Cross-origin stylesheet access | A CORS bypass, browser extension bypass, or hidden proxy | Safe href relink, then explicit adapter fetch hook, then computed fallback | `cssRules` can be blocked by origin cleanliness, and Phase 9 forbids boundary bypasses. [CITED: https://www.w3.org/TR/cssom-1/; VERIFIED: .planning/phases/09-cssom-capture-mode/09-CONTEXT.md] |
| Rule-delta replay protocol | Custom per-rule insert/delete replay with index correction | Source-level `replace`/`upsert`/`remove` style ops | The locked decision prefers source granularity, and rAF dedupe can collapse multiple dynamic rule changes. [VERIFIED: .planning/phases/09-cssom-capture-mode/09-CONTEXT.md] |
| Relay behavior | A top-level CSS stream or relay transform | Existing `STREAM.MUTATIONS` envelope | Relay must remain raw and endpoint-owned transforms stay at capture/renderer. [VERIFIED: .planning/STATE.md; VERIFIED: src/protocol/messages.js] |
| Real browser fidelity proof | jsdom-only CSSOM assertions | Playwright Chromium smoke tests | jsdom documents visual emulation without full layout/rendering; CSSOM security/fidelity needs a browser sample. [CITED: /jsdom/jsdom via Context7 docs; VERIFIED: Playwright Chromium launch probe] |

**Key insight:** CSSOM mode is primarily a source-capture and scoped-replay problem; custom cascade engines, proxy fetchers, and rule-delta protocols would add complexity while bypassing the browser and project boundaries that already exist. [VERIFIED: docs/ARCHITECTURE.md; VERIFIED: .planning/phases/09-cssom-capture-mode/09-CONTEXT.md]

## Common Pitfalls

### Pitfall 1: `cssRules` Access Throws
**What goes wrong:** Cross-origin or non-origin-clean stylesheets can throw `SecurityError` when `cssRules` is read. [CITED: https://www.w3.org/TR/cssom-1/; CITED: https://developer.mozilla.org/en-US/docs/Web/API/CSSStyleSheet/cssRules]
**Why it happens:** Browser origin rules protect stylesheet contents. [CITED: https://www.w3.org/TR/cssom-1/]
**How to avoid:** Catch per sheet, record fallback reason, and continue through href relink, explicit fetch hook, and curated computed fallback. [VERIFIED: .planning/phases/09-cssom-capture-mode/09-CONTEXT.md]
**Warning signs:** One blocked CDN stylesheet aborts the whole snapshot or produces contentful diagnostics. [VERIFIED: docs/SECURITY.md]

### Pitfall 2: Cascade Order Drift
**What goes wrong:** Replayed styles render differently because link, style, constructable, shadow, or frame sources are installed in the wrong order or scope. [VERIFIED: .planning/phases/09-cssom-capture-mode/09-CONTEXT.md]
**Why it happens:** Current snapshot only has top-level `stylesheets[]` and `inlineStyles[]`, while Phase 9 must carry richer source order and scope metadata. [VERIFIED: src/renderer/snapshot.js; VERIFIED: src/protocol/messages.js]
**How to avoid:** Persist `scope`, `order`, `ownerKind`, `media`, `disabled`, `href`, and stable source identity in every source record. [VERIFIED: .planning/phases/09-cssom-capture-mode/09-CONTEXT.md]
**Warning signs:** Class flips work in the live page but not the mirror, or shadow styles leak into the document. [VERIFIED: docs/ARCHITECTURE.md]

### Pitfall 3: Generated Inline Styles Still Win
**What goes wrong:** CSSOM mode captures stylesheets but still writes generated inline styles onto every cloned element, so class changes cannot override stale inline declarations. [VERIFIED: docs/ARCHITECTURE.md; VERIFIED: .planning/phases/09-cssom-capture-mode/09-CONTEXT.md]
**Why it happens:** Current `serializeDOM`, shadow serialization, frame serialization, and added-node processing call computed-style helpers. [VERIFIED: src/capture/index.js]
**How to avoid:** Gate generated computed inline style calls behind default computed mode or fallback cases. [VERIFIED: .planning/phases/09-cssom-capture-mode/09-CONTEXT.md]
**Warning signs:** No-broad-enumeration tests pass, but class-flip CSSOM fixture still renders stale values. [VERIFIED: tests/capture-added-styles.test.js]

### Pitfall 4: Constructable Stylesheet Changes Are Missed
**What goes wrong:** `insertRule`, `deleteRule`, `replace`, `replaceSync`, or adopted stylesheet list changes do not trigger DOM mutations. [VERIFIED: .planning/phases/09-cssom-capture-mode/09-CONTEXT.md; CITED: https://developer.mozilla.org/en-US/docs/Web/API/CSSStyleSheet]
**Why it happens:** `MutationObserver` observes DOM tree/attribute/text changes, not CSSStyleSheet method calls. [CITED: https://developer.mozilla.org/en-US/docs/Web/API/MutationObserver/observe; CITED: https://www.w3.org/TR/cssom-1/]
**How to avoid:** Patch observable CSSStyleSheet methods in CSSOM mode, reconcile adopted stylesheet arrays for known scopes, and emit content-free diagnostics plus resnapshot requests for unsupported operations. [VERIFIED: .planning/phases/09-cssom-capture-mode/09-CONTEXT.md]
**Warning signs:** Static snapshot is correct, but live `insertRule` and `adoptedStyleSheets` fixture drifts until a full reload. [VERIFIED: .planning/ROADMAP.md]

### Pitfall 5: Sanitization Split-Brain
**What goes wrong:** CSS text is scrubbed before wire but not before renderer insertion, or vice versa. [VERIFIED: docs/SECURITY.md]
**Why it happens:** Capture and renderer currently have separate sanitizer implementations. [VERIFIED: src/capture/index.js; VERIFIED: src/renderer/sanitize.js]
**How to avoid:** Add tests for both capture-side CSSOM source sanitization and renderer style-source insertion sanitization. [VERIFIED: tests/security-sanitize-capture.test.js; VERIFIED: tests/security-sanitize-render.test.js]
**Warning signs:** Dangerous `url(javascript:)`, hostile `@import`, or `</style>` survives either side of the pipeline. [VERIFIED: docs/SECURITY.md]

### Pitfall 6: Browser Artifact Drift
**What goes wrong:** Node tests pass against `src/capture/index.js`, but Playwright/extension/bookmarklet injected paths still run older capture code. [VERIFIED: src/adapters/playwright-inject.js; VERIFIED: src/adapters/browser-inject.js]
**Why it happens:** Injected browser artifacts are checked in as classic scripts and are not built at runtime. [VERIFIED: .planning/phases/09-cssom-capture-mode/09-CONTEXT.md; VERIFIED: tests/adapter-exports.test.js]
**How to avoid:** Include artifact sync as an explicit plan task and run adapter export/static tests after capture changes. [VERIFIED: tests/adapter-exports.test.js]
**Warning signs:** CSSOM unit tests pass, but `playwright-fidelity` tests still show computed-style behavior. [VERIFIED: tests/playwright-fidelity-phase8.test.js]

## Code Examples

Verified implementation patterns from project and official sources:

### Snapshot Style Strategy Metadata

```js
// Source: D-05 from 09-CONTEXT and SnapshotPayload extension pattern in messages.js.
payload.styleStrategy = {
  mode: "cssom",
  sourceCount: styleSources.length,
  fallbackCount: styleSources.filter((s) => s.fallback).length,
  approxCssBytes: styleSources.reduce((sum, s) => sum + (s.approxBytes || 0), 0),
};
payload.styleSources = styleSources;
```

The planner should keep `stylesheets[]` and `inlineStyles[]` for backward compatibility while adding richer sidecars. [VERIFIED: .planning/phases/09-cssom-capture-mode/09-CONTEXT.md; VERIFIED: src/protocol/messages.js]

### CSSOM Rule Serialization

```js
// Source: CSSStyleSheet.cssRules interface from https://www.w3.org/TR/cssom-1/
function cssRulesToText(ruleList) {
  const chunks = [];
  for (const rule of Array.from(ruleList || [])) chunks.push(rule.cssText || "");
  return chunks.join("\n");
}
```

Rule serialization must be wrapped in per-sheet error handling because `cssRules` access can throw for non-origin-clean sheets. [CITED: https://www.w3.org/TR/cssom-1/; CITED: https://developer.mozilla.org/en-US/docs/Web/API/CSSStyleSheet/cssRules]

### Style Op Payload Shape

```js
// Source: existing DiffOp family in src/protocol/messages.js and applyMutations in src/renderer/diff.js.
{
  op: DIFF_OP.STYLE_SOURCE,
  action: "replace",
  sourceId: "shadow:n17:2:constructable",
  scope: { kind: "shadow", hostNid: "n17" },
  source: sanitizedStyleSource
}
```

The op should be idempotent enough for rAF dedupe and resync behavior to tolerate missed intermediate rule edits. [VERIFIED: src/capture/index.js; VERIFIED: .planning/phases/09-cssom-capture-mode/09-CONTEXT.md]

### Renderer Style Source Replacement

```js
// Source: renderer sanitizer and mutation applier patterns in src/renderer/sanitize.js and src/renderer/diff.js.
function replaceStyleSource(root, source) {
  const id = `ps-style-${source.sourceId}`;
  root.querySelector(`[data-ps-style-id="${CSS.escape(id)}"]`)?.remove();
  const style = root.ownerDocument.createElement("style");
  style.setAttribute("data-ps-style-id", id);
  style.textContent = scrubCssText(source.cssText || "");
  root.appendChild(style);
}
```

If the implementation uses `CSS.escape`, tests should cover runtime availability or provide a tiny local fallback because injected browser artifacts must remain dependency-free. [VERIFIED: src/adapters/playwright-inject.js; VERIFIED: tests/adapter-exports.test.js]

## State of the Art

| Old Approach | Current Approach for Phase 9 | When Changed | Impact |
|--------------|------------------------------|--------------|--------|
| Snapshot clones with generated inline computed styles on most elements | Opt-in CSSOM snapshots with scoped stylesheet sources and generated computed styles only for fallback/shell cases | Phase 9 planning on 2026-06-16 | Fixes frozen-style drift and should reduce payload for stylesheet-driven pages. [VERIFIED: docs/ARCHITECTURE.md; VERIFIED: .planning/ROADMAP.md] |
| Top-level `stylesheets[]` and `inlineStyles[]` only | Keep legacy fields and add richer `styleSources[]` plus `styleStrategy` metadata | Phase 9 planning on 2026-06-16 | Preserves backward compatibility while enabling shadow/frame/constructable scope fidelity. [VERIFIED: src/protocol/messages.js; VERIFIED: .planning/phases/09-cssom-capture-mode/09-CONTEXT.md] |
| Dynamic DOM diffs only | Add source-level CSS style ops inside `STREAM.MUTATIONS` | Phase 9 planning on 2026-06-16 | Allows class flips and dynamic CSS rules to stay live without new relay behavior. [VERIFIED: src/protocol/messages.js; VERIFIED: .planning/phases/09-cssom-capture-mode/09-CONTEXT.md] |
| jsdom/static tests enough for many renderer changes | Add real-browser Playwright smoke for CSSOM security/fidelity/payload latency | Phase 9 planning on 2026-06-16 | CSSOM origin behavior and constructable stylesheets need browser validation. [CITED: /jsdom/jsdom via Context7 docs; VERIFIED: Playwright Chromium launch probe] |

**Deprecated/outdated for CSSOM mode:**
- Broad computed-property enumeration is outdated for this phase because the project already documented severe serialization latency from enumerating hundreds of computed properties. [VERIFIED: docs/DESIGN-HISTORY.md]
- Snapshot-only CSSOM behavior is out of scope because Phase 9 explicitly locks a narrow live style-op path. [VERIFIED: .planning/phases/09-cssom-capture-mode/09-CONTEXT.md]

## Assumptions Log

All claims in this research were verified from local project files, package/CLI probes, Context7 documentation, MDN, or the CSSOM specification; no unverified factual claims are intentionally used as planning facts. [VERIFIED: local research session]

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| -- | No assumed claims recorded. | -- | -- |

## Open Questions (RESOLVED)

1. **What exact config and hook names should the planner choose?**
   - RESOLVED: Plans use `styleMode: "computed" | "cssom"` as the capture config flag and `fetchStylesheet({ href, scope, ownerKind })` as the explicit adapter-permitted fetch hook. This implements the locked config-gated CSSOM mode and explicit host capability boundary. [VERIFIED: .planning/phases/09-cssom-capture-mode/09-CONTEXT.md; VERIFIED: src/capture/index.js]

2. **How should adopted stylesheet list changes be observed across browsers?**
   - RESOLVED: Plans use an adopted-sheet wrapper plus rAF reconciliation approach: patch `CSSStyleSheet.prototype` methods when configurable, reconcile known document/shadow `adoptedStyleSheets` references during the style-source flush, and emit content-free diagnostics/resnapshot signals for unsupported hooks. [VERIFIED: .planning/phases/09-cssom-capture-mode/09-CONTEXT.md; CITED: https://developer.mozilla.org/en-US/docs/Web/API/Document/adoptedStyleSheets; CITED: https://developer.mozilla.org/en-US/docs/Web/API/ShadowRoot/adoptedStyleSheets; CITED: https://www.w3.org/TR/cssom-1/]

3. **Should Playwright be upgraded from local 1.60.0 to registry 1.61.0?**
   - RESOLVED: Plans keep the existing Playwright package range and do not upgrade unless a failing Phase 9 CSSOM fixture proves the local browser path is blocked. Local tests use Playwright `^1.60.0`, CLI reports 1.60.0, and registry latest was 1.61.0 as of 2026-06-15. [VERIFIED: package.json; VERIFIED: `npx --yes playwright --version`; VERIFIED: `npm view playwright version time.modified`; VERIFIED: .planning/phases/09-cssom-capture-mode/09-CONTEXT.md]

4. **What exact source-id format should be used?**
   - RESOLVED: Plans use deterministic, content-free scope/order/owner identifiers such as `doc:3:style:n42`, `shadow:n17:2:constructable`, and `frame:n31:1:link` so later style-source updates have stable identity without leaking CSS or URL content. [VERIFIED: .planning/phases/09-cssom-capture-mode/09-CONTEXT.md; VERIFIED: src/capture/index.js; VERIFIED: docs/SECURITY.md]

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Node.js | `node:test` suite and build-free local scripts | yes | v25.9.0 | None needed. [VERIFIED: `node --version`] |
| npm | dependency/version probes and `npm ci` | yes | 11.12.1 | None needed. [VERIFIED: `npm --version`] |
| jsdom | fast DOM/unit tests | yes | 29.1.1 | Use Playwright for fidelity surfaces jsdom cannot prove. [VERIFIED: package.json; VERIFIED: `npm view jsdom version`] |
| Playwright CLI | real-browser smoke tests | yes | 1.60.0 local CLI, 1.61.0 latest registry | Keep local unless blocked; use existing package lock. [VERIFIED: `npx --yes playwright --version`; VERIFIED: `npm view playwright version`] |
| Playwright Chromium | CSSOM/adopted stylesheet/cross-origin smoke | yes | 148.0.7778.96 | No equivalent fallback for fidelity; unit tests can narrow failures only. [VERIFIED: Playwright launch probe] |
| `ws` | existing relay dependency | yes | 8.21.0 | No Phase 9 relay change planned. [VERIFIED: package.json; VERIFIED: `npm view ws version`] |

**Missing dependencies with no fallback:** None found for Phase 9 research. [VERIFIED: environment probes]

**Missing dependencies with fallback:** None found for Phase 9 research. [VERIFIED: environment probes]

## Validation Architecture

Nyquist validation is enabled because `.planning/config.json` sets `workflow.nyquist_validation` to `true`; Phase 9 should sample more than unit tests because CSSOM origin behavior, constructable stylesheets, and payload/latency smoke require a real browser. [VERIFIED: .planning/config.json; CITED: /jsdom/jsdom via Context7 docs; VERIFIED: Playwright Chromium launch probe]

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Node built-in `node:test` on Node v25.9.0. [VERIFIED: package.json; VERIFIED: `node --version`; CITED: /nodejs/node via Context7 docs] |
| Config file | none; package script is in `package.json`. [VERIFIED: package.json] |
| Quick run command | `node --test tests/capture-cssom-mode.test.js tests/renderer-cssom-mode.test.js tests/security-cssom-sanitize.test.js tests/protocol.test.js tests/adapter-exports.test.js` [VERIFIED: existing test layout] |
| Full suite command | `npm test` [VERIFIED: package.json] |
| Real-browser sample command | `node --test tests/playwright-cssom-mode.test.js tests/playwright-fidelity-phase8.test.js` [VERIFIED: existing Playwright test precedent; VERIFIED: Playwright Chromium launch probe] |

### Phase Requirements -> Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| CAPT-10 | CSSOM mode is config-gated and default computed mode remains compatible. | unit + differential | `node --test tests/capture-cssom-mode.test.js tests/differential/oracle.test.js` | no, Wave 0 for CSSOM file; yes for oracle. [VERIFIED: tests directory] |
| CAPT-10 | CSSOM source collection preserves document, open shadow, and same-origin frame scopes keyed by `hostNid`/`frameNid`. | unit + renderer integration | `node --test tests/capture-cssom-mode.test.js tests/renderer-cssom-mode.test.js` | no, Wave 0. [VERIFIED: tests directory] |
| CAPT-10 | Cross-origin `cssRules` failures follow fallback chain without bypassing browser boundaries. | Playwright + unit | `node --test tests/playwright-cssom-mode.test.js tests/capture-cssom-mode.test.js` | no, Wave 0. [VERIFIED: .planning/phases/09-cssom-capture-mode/09-CONTEXT.md] |
| CAPT-10 | `insertRule`/`deleteRule`/`replace`/`replaceSync` changes produce style-source ops through `STREAM.MUTATIONS`. | unit + Playwright | `node --test tests/capture-cssom-mode.test.js tests/playwright-cssom-mode.test.js tests/protocol.test.js` | no, Wave 0 for CSSOM file; yes for protocol. [VERIFIED: tests directory] |
| CAPT-10 | `adoptedStyleSheets` document/shadow sources capture and update safely. | Playwright | `node --test tests/playwright-cssom-mode.test.js` | no, Wave 0. [VERIFIED: Playwright Chromium launch probe] |
| CAPT-10 | CSS text is sanitized before wire and before renderer insertion. | security unit + static | `node --test tests/security-cssom-sanitize.test.js tests/security-chokepoint-purity.test.js` | no, Wave 0 for CSSOM file; yes for chokepoint. [VERIFIED: tests directory] |
| CAPT-10 | CSSOM mode avoids broad computed-property enumeration except selected fallback. | unit regression | `node --test tests/capture-cssom-mode.test.js tests/capture-added-styles.test.js` | no, Wave 0 for CSSOM file; yes for added styles. [VERIFIED: tests directory] |
| CAPT-10 | Payload-size and serialize-latency smoke evidence exists for representative CSSOM fixture. | Playwright smoke | `node --test tests/playwright-cssom-mode.test.js` | no, Wave 0. [VERIFIED: .planning/phases/09-cssom-capture-mode/09-CONTEXT.md] |

### Sampling Rate

- **Per task commit:** Run the quick command for files touched by that task, plus the nearest existing regression test such as `tests/security-chokepoint-purity.test.js` when sanitizer paths change. [VERIFIED: existing test suite]
- **Per wave merge:** Run the quick command plus `node --test tests/playwright-cssom-mode.test.js` when browser-facing capture or renderer behavior changed. [VERIFIED: Playwright Chromium launch probe]
- **Phase gate:** Run `npm test` and the Playwright CSSOM smoke before `$gsd-verify-work`. [VERIFIED: package.json; VERIFIED: .planning/config.json]

### Wave 0 Gaps

- [ ] `tests/capture-cssom-mode.test.js` -- covers CSSOM config gating, source collection, fallback chain, no broad computed enumeration, dynamic style-op producer, and styleStrategy counters. [VERIFIED: tests directory; VERIFIED: .planning/phases/09-cssom-capture-mode/09-CONTEXT.md]
- [ ] `tests/renderer-cssom-mode.test.js` -- covers document/shadow/frame source insertion and style-source mutation replacement/removal. [VERIFIED: tests directory; VERIFIED: src/renderer/index.js]
- [ ] `tests/security-cssom-sanitize.test.js` -- covers capture and renderer CSS sanitization for CSSOM text, fetched CSS, constructable CSS, and dynamic replacement CSS. [VERIFIED: docs/SECURITY.md]
- [ ] `tests/playwright-cssom-mode.test.js` -- covers CSS-in-JS class flips, cross-origin fallback fixture, constructable/adopted stylesheets, `insertRule`/`deleteRule`, shadow/frame scopes, and payload/latency smoke. [VERIFIED: .planning/phases/09-cssom-capture-mode/09-CONTEXT.md; VERIFIED: Playwright Chromium launch probe]
- [ ] Update `tests/protocol.test.js` for the new style op and payload typedef expectations. [VERIFIED: src/protocol/messages.js; VERIFIED: tests/protocol.test.js]
- [ ] Update `tests/security-chokepoint-purity.test.js` if new serialization paths or renderer insertion paths are introduced. [VERIFIED: tests/security-chokepoint-purity.test.js]
- [ ] Update differential divergence ledger only for opt-in CSSOM mode divergences; keep default computed mode oracle-compatible. [VERIFIED: tests/differential/oracle.test.js; VERIFIED: .planning/phases/09-cssom-capture-mode/09-CONTEXT.md]

## Security Domain

Security enforcement is enabled because `.planning/config.json` does not set `security_enforcement` to `false`; Phase 9 therefore must document applicable ASVS-style controls. [VERIFIED: .planning/config.json]

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|------------------|
| V2 Authentication | no | Phase 9 does not add authentication surfaces. [VERIFIED: .planning/ROADMAP.md; VERIFIED: src/capture/index.js] |
| V3 Session Management | yes, indirectly | Preserve existing `streamSessionId`, `snapshotId`, and staleness checks for style ops inside `STREAM.MUTATIONS`. [VERIFIED: src/capture/index.js; VERIFIED: src/protocol/messages.js; VERIFIED: src/renderer/diff.js] |
| V4 Access Control | yes | Do not bypass same-origin, CORS, CSP, extension, or closed-shadow/cross-origin-frame boundaries; adapter fetch must be explicit. [VERIFIED: .planning/phases/09-cssom-capture-mode/09-CONTEXT.md; VERIFIED: docs/SECURITY.md; CITED: https://www.w3.org/TR/cssom-1/] |
| V5 Input Validation | yes | Scrub CSS before wire and before renderer insertion; sanitize DOM fragments after parse. [VERIFIED: docs/SECURITY.md; VERIFIED: src/capture/index.js; VERIFIED: src/renderer/sanitize.js] |
| V6 Cryptography | no | Phase 9 introduces no cryptographic storage or primitives. [VERIFIED: .planning/ROADMAP.md] |

### Known Threat Patterns for CSSOM Capture

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Malicious CSS URL or `@import` payload | Tampering / Information Disclosure | Existing CSS scrub blocks unsafe URLs/imports; test both capture and renderer paths. [VERIFIED: docs/SECURITY.md; VERIFIED: src/capture/index.js; VERIFIED: src/renderer/sanitize.js] |
| `</style>` breakout or tag-like markup in CSS text | Tampering / XSS | Scrub CSS text and insert via `textContent`, not `innerHTML`. [VERIFIED: docs/SECURITY.md; VERIFIED: src/renderer/sanitize.js] |
| Cross-origin stylesheet content leakage | Information Disclosure | Do not read or fetch blocked sheets except through explicit host adapter capability; otherwise use safe href relink or computed fallback. [VERIFIED: .planning/phases/09-cssom-capture-mode/09-CONTEXT.md; CITED: https://www.w3.org/TR/cssom-1/] |
| Renderer sandbox weakening for style application | Elevation of Privilege | Keep iframe sandbox at `allow-same-origin` without scripts and preserve CSP posture. [VERIFIED: src/renderer/index.js; VERIFIED: src/renderer/snapshot.js; VERIFIED: docs/SECURITY.md] |
| Contentful diagnostics leaking CSS or URLs | Information Disclosure | Emit content-free diagnostic names/counters only. [VERIFIED: docs/SECURITY.md; VERIFIED: .planning/phases/09-cssom-capture-mode/09-CONTEXT.md] |
| Broad computed style enumeration as fallback default | Denial of Service | Keep curated fallback only and test no broad enumeration in normal CSSOM mode. [VERIFIED: docs/DESIGN-HISTORY.md; VERIFIED: tests/capture-added-styles.test.js] |

## Sources

### Primary (HIGH confidence)

- `.planning/phases/09-cssom-capture-mode/09-CONTEXT.md` - locked Phase 9 scope, decisions, fallback chain, style-op strategy, verification shape. [VERIFIED: local file read]
- `.planning/REQUIREMENTS.md` - CAPT-10 requirement. [VERIFIED: local file read]
- `.planning/ROADMAP.md` - Phase 9 goal, dependency on Phase 8, success criteria. [VERIFIED: local file read]
- `.planning/STATE.md` - project decisions and active Phase 9 concern. [VERIFIED: local file read]
- `.planning/phases/08-shadow-dom-iframes-fidelity-completion/08-CONTEXT.md` - Phase 8 shadow/frame/protocol dependency context. [VERIFIED: local file read]
- `docs/ARCHITECTURE.md`, `docs/DESIGN-HISTORY.md`, `docs/SECURITY.md` - current architecture, performance history, and security chokepoints. [VERIFIED: local file read]
- `src/capture/index.js`, `src/protocol/messages.js`, `src/renderer/snapshot.js`, `src/renderer/index.js`, `src/renderer/diff.js`, `src/renderer/sanitize.js`, `src/adapters/playwright-inject.js` - implementation integration points. [VERIFIED: local file read]
- `/microsoft/playwright` via Context7 - `addInitScript`, `exposeFunction`, evaluation/injection behavior. [CITED: Context7]
- `/jsdom/jsdom` via Context7 - jsdom visual limitations and `pretendToBeVisual` behavior. [CITED: Context7]
- `/nodejs/node` via Context7 - built-in `node:test` runner. [CITED: Context7]
- CSSOM specification - `CSSStyleSheet`, `cssRules`, `insertRule`, `deleteRule`, and `SecurityError` behavior. [CITED: https://www.w3.org/TR/cssom-1/]
- MDN CSSOM pages - `CSSStyleSheet`, `cssRules`, `insertRule`, `deleteRule`, `replace`, `replaceSync`, `Document.adoptedStyleSheets`, `ShadowRoot.adoptedStyleSheets`, and `MutationObserver.observe`. [CITED: https://developer.mozilla.org/en-US/docs/Web/API/CSSStyleSheet; CITED: https://developer.mozilla.org/en-US/docs/Web/API/CSSStyleSheet/cssRules; CITED: https://developer.mozilla.org/en-US/docs/Web/API/CSSStyleSheet/insertRule; CITED: https://developer.mozilla.org/en-US/docs/Web/API/CSSStyleSheet/deleteRule; CITED: https://developer.mozilla.org/en-US/docs/Web/API/CSSStyleSheet/replace; CITED: https://developer.mozilla.org/en-US/docs/Web/API/CSSStyleSheet/replaceSync; CITED: https://developer.mozilla.org/en-US/docs/Web/API/Document/adoptedStyleSheets; CITED: https://developer.mozilla.org/en-US/docs/Web/API/ShadowRoot/adoptedStyleSheets; CITED: https://developer.mozilla.org/en-US/docs/Web/API/MutationObserver/observe]

### Secondary (MEDIUM confidence)

- npm registry version probes for `jsdom`, `playwright`, and `ws`; versions are current as of the research date but package currency changes frequently. [VERIFIED: npm registry]
- Local Playwright Chromium launch probe; browser availability was verified on this machine but CI availability still needs normal execution-time validation. [VERIFIED: local command]

### Tertiary (LOW confidence)

- None used as authoritative input. [VERIFIED: research source log]

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - existing local stack and package versions were verified, and no new production package is recommended. [VERIFIED: package.json; VERIFIED: npm registry]
- Architecture: HIGH - integration points are directly visible in capture, protocol, renderer, adapters, and Phase 8/9 context. [VERIFIED: local codebase files]
- Pitfalls: HIGH for project-specific pitfalls; MEDIUM for exact cross-browser adopted stylesheet hook mechanics until Playwright fixtures are implemented. [VERIFIED: docs/DESIGN-HISTORY.md; CITED: https://developer.mozilla.org/en-US/docs/Web/API/Document/adoptedStyleSheets]
- Security: HIGH - existing sanitizer/CSP/sandbox chokepoints are explicit in docs and code; Phase 9 must extend those same paths. [VERIFIED: docs/SECURITY.md; VERIFIED: src/renderer/index.js]
- Validation: HIGH - test runner, existing tests, config, and real Chromium availability were verified. [VERIFIED: package.json; VERIFIED: .planning/config.json; VERIFIED: Playwright launch probe]

**Research date:** 2026-06-16 [VERIFIED: environment current_date]
**Valid until:** 2026-06-23 for package/API currency and 2026-07-16 for project architecture, unless Phase 8/9 source files change first. [VERIFIED: package registry freshness; VERIFIED: local phase state]
