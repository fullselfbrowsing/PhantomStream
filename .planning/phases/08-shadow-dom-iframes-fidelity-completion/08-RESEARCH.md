# Phase 08: Shadow DOM, Iframes & Fidelity Completion - Research

**Researched:** 2026-06-15 [VERIFIED: `date -Iseconds`]
**Domain:** DOM mirroring fidelity across shadow roots, iframes, form state, late-added styles, and truncation recovery [VERIFIED: `.planning/ROADMAP.md` + `.planning/phases/08-shadow-dom-iframes-fidelity-completion/08-CONTEXT.md`]
**Confidence:** HIGH for project integration points and browser API constraints; MEDIUM for final wire-field names because Phase 08 context leaves those to implementation discretion [VERIFIED: codebase grep + npm registry + MDN/WHATWG/Playwright docs]

<user_constraints>
## User Constraints (from CONTEXT.md)

Source for every item in this section: copied from `.planning/phases/08-shadow-dom-iframes-fidelity-completion/08-CONTEXT.md` [VERIFIED: `.planning/phases/08-shadow-dom-iframes-fidelity-completion/08-CONTEXT.md`]

### Locked Decisions

## Implementation Decisions

### Discussion Mode
- **D-01 [informational]:** Auto-mode selected all meaningful gray areas and chose conservative defaults without interactive questions.
- **D-02 [informational]:** These are planning defaults. If research finds a concrete blocker, the planner must surface the deviation explicitly rather than silently changing scope.

### Shadow DOM Fidelity
- **D-03:** Support open shadow roots first. Closed shadow roots are not introspectable and should be represented as content-free placeholders or left as host elements with diagnostics, not faked.
- **D-04:** Serialize shadow content as structured metadata tied to the host element's nid, not by flattening it into light DOM HTML. The viewer should reconstruct real shadow roots where the browser permits it.
- **D-05:** Preserve slot semantics. Slotted light-DOM children must remain owned by the light DOM and must not be duplicated into shadow content. Tests should cover default slots, named slots, and slot reassignment.
- **D-06:** Shadow-root addressing extends the Phase 7 nid model. Shadow descendants receive opaque nids in sidecars/indexes, and renderer resolution uses the same private identity index rather than selector fallbacks.
- **D-07:** Shadow mutations should stream as explicit shadow-aware ops or add-op metadata. Do not rely on ordinary `document.body` MutationObserver coverage to catch changes inside shadow roots; attach observers or traversal hooks deliberately.

### Iframe Policy
- **D-08:** Same-origin iframes are in scope for mirroring. Capture should serialize accessible iframe documents with their own identity/style data and enough frame metadata for the viewer to reconstruct them.
- **D-09:** Cross-origin iframes remain out of scope for content mirroring. They should render as labeled placeholders with safe dimensions/origin metadata only; no attempt to bypass browser origin policy.
- **D-10:** Iframe mirroring should preserve the no-scripts viewer sandbox boundary. Reconstructed iframe content must be inert mirrored DOM, not live remote documents.
- **D-11:** Frame identity should compose with stream/session identity and Phase 7 nids. Downstream planning should avoid a global selector-like addressing scheme; use frame-aware opaque ids or scoped sidecars.

### Live Form Values
- **D-12:** Add explicit input/change-event capture for form controls whose live value changes without attribute mutations. MutationObserver alone is insufficient.
- **D-13:** Cover at least `input`, `textarea`, and `select`; include checkbox/radio checked state and selected option state where tests show current drift.
- **D-14:** Route every value-bearing form update through existing masking/privacy chokepoints. Password values remain always masked, and `maskInputs`/`maskInputFn` semantics apply to event-driven value diffs exactly as they do for snapshot/attr paths.
- **D-15:** Prefer a narrow value diff op or well-documented attr/text extension over ad hoc full-node replacement. Preserve content-free diagnostics and avoid leaking typed text into health telemetry.

### Late-Added Computed Styles
- **D-16:** Add ops for new elements should carry computed styles consistent with snapshot-era siblings. Use the existing curated property list and default elision unless research proves a smaller sidecar is safer.
- **D-17:** Preserve the performance lesson: batch style/layout reads before clone mutation, with no per-node forced reflow loop. Tests should include a regression that style capture happens without broad all-property enumeration.
- **D-18:** Phase 8 should not implement full CSSOM stylesheet-centric capture. If late-added style support exposes a protocol seam useful to Phase 9, document it, but keep Phase 8 to computed styles for added nodes.

### Truncated Subtree Recovery
- **D-19:** Add an on-demand subtree fetch path for truncated regions instead of waiting for a full snapshot. The viewer should request a specific missing/truncated nid or placeholder, and capture should return a sanitized subtree payload with `nodeIds`.
- **D-20:** Subtree fetch must preserve streamSessionId/snapshotId staleness checks and should be ignored softly if the requested live node is gone, skipped, blocked, or no longer tracked.
- **D-21:** Fetch responses must use the same sanitization, masking, URL absolutification, style, and identity sidecar rules as snapshot/add serialization. Do not create a second serialization policy.
- **D-22:** Keep recovery bounded. Avoid automatic cascading fetch storms; a host or viewer may request a subtree, but planning should include request throttling/latching and clear stale-miss behavior.

### Verification Shape
- **D-23:** Add focused fixtures for each fidelity gap: open shadow root + slots, same-origin iframe, cross-origin iframe placeholder, input value drift, late-added styled node, and truncated-region fetch.
- **D-24:** Keep the differential oracle honest. Any intentional divergence from the FSB reference should be ledgered narrowly, especially for shadow/iframe protocol extensions and value diffs.
- **D-25:** Run full capture/renderer/security/adapter tests after the phase. Phase 8 touches capture serialization, renderer reconstruction, protocol shape, and adapter-injected artifacts.

### the agent's Discretion
- Exact wire field names for shadow roots, frame payloads, value diffs, and subtree fetch responses.
- Whether subtree fetch is modeled as a new `CONTROL.*` request plus `STREAM.*` response or as a mutation-family extension, provided staleness checks and relay transparency remain intact.
- Exact iframe placeholder copy/metadata, provided it is content-free and does not imply cross-origin content was captured.
- Exact module split, as long as existing single-file capture constraints and renderer seams stay manageable.

### Deferred Ideas (OUT OF SCOPE)

## Deferred Ideas

- Full stylesheet-centric CSSOM capture and adopted stylesheet protocol - Phase 9.
- Cross-origin iframe content mirroring or browser security bypasses - out of v1 scope.
- Closed shadow root introspection - impossible without page/component cooperation; document as limitation or placeholder behavior.
- Media stream mirroring for `<video>`/`<audio>` - still outside Phase 8 unless research finds a low-risk placeholder-only update.
- Public selector/accessibility query language over semantic identity - future API layer after Phase 8 if needed.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CAPT-05 | Typed text in form fields is mirrored beyond MutationObserver attribute observation. [VERIFIED: `.planning/REQUIREMENTS.md`] | Use bubbling `input` plus `change` listeners for `input`, `textarea`, and `select`; emit a narrow value-state op routed through `sanitizeForWire('text'/'attr')` masking helpers. [CITED: MDN input event; VERIFIED: `src/capture/index.js`] |
| CAPT-06 | Nodes added after the snapshot carry computed styles consistent with snapshot-era siblings. [VERIFIED: `.planning/REQUIREMENTS.md`] | Reuse `collectComputedStyleText`, `CURATED_PROPS`, and `STYLE_DEFAULTS` inside add/subtree serialization; batch reads before clone writes. [VERIFIED: `src/capture/index.js` + `docs/DESIGN-HISTORY.md`] |
| CAPT-08 | Open shadow DOM content is mirrored with serialization, diffs, and addressing. [VERIFIED: `.planning/REQUIREMENTS.md`] | Traverse `Element.shadowRoot` only when open, serialize shadow trees as host-tied payloads, observe each open `ShadowRoot`, and extend renderer identity indexing into shadow roots. [CITED: MDN attachShadow; VERIFIED: local jsdom probe + Phase 7 summaries] |
| CAPT-09 | Same-origin iframe content is mirrored; cross-origin iframe content is placeholdered. [VERIFIED: `.planning/REQUIREMENTS.md`] | Use `iframe.contentDocument` access as the same-origin gate, serialize accessible frame documents with scoped identity/style data, and render inaccessible frames as safe placeholders. [CITED: MDN HTMLIFrameElement.contentDocument + same-origin policy] |
| CAPT-11 | Viewer can request on-demand subtree fetch for truncated regions. [VERIFIED: `.planning/REQUIREMENTS.md`] | Add viewer request and capture response messages that preserve session/snapshot staleness and reuse snapshot/add serialization policy. [VERIFIED: `src/protocol/messages.js`, `src/renderer/index.js`, `src/capture/index.js`] |
</phase_requirements>

## Summary

Phase 08 should be planned as an extension of the completed Phase 07 identity system, not as a new mirror architecture. Capture already owns node identity in `WeakMap<Element,string>` plus `nodeIds` sidecars, and the renderer already owns a private `Map<nid, Node>` rebuilt after sanitization; shadow roots and same-origin frames should extend those scoped sidecars rather than reintroducing DOM identity attributes or selector lookup. [VERIFIED: `src/capture/index.js`, `src/renderer/index.js`, Phase 07 summaries]

The browser platform facts force explicit handling: open shadow roots are accessible through `element.shadowRoot`, closed roots are not exposed through that property, `MutationObserver.observe()` watches the selected root/subtree rather than magically crossing into every shadow tree, and same-origin iframe content is available through `contentDocument` while cross-origin access is restricted. [CITED: MDN attachShadow, MDN MutationObserver.observe, MDN HTMLIFrameElement.contentDocument, MDN same-origin policy; VERIFIED: local jsdom probe]

**Primary recommendation:** add no production dependency; extend protocol constants/JSDoc, `src/capture/index.js`, `src/renderer/index.js`, `src/renderer/diff.js`, tests, docs, and the checked-in Playwright inject artifact with scoped shadow/frame payloads, a narrow value-state op, batched add-style capture, and a latched subtree fetch request/response. [VERIFIED: `.planning/phases/08-shadow-dom-iframes-fidelity-completion/08-CONTEXT.md` + codebase grep]

## Project Constraints (from AGENTS.md)

No root `AGENTS.md` exists in this workspace, so there are no project-specific AGENTS directives to apply. [VERIFIED: shell test `if [ -f AGENTS.md ] ...`]

No `.codex/skills/` or `.agents/skills/` project-local skill directory was found, so research has no local project skill rules to account for beyond the GSD workflow instructions. [VERIFIED: `find . -path './.codex/skills/*/SKILL.md' -o -path './.agents/skills/*/SKILL.md'`]

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|--------------|----------------|-----------|
| Open shadow root snapshot serialization | Browser / Client capture | Protocol | Only page-side capture can read `element.shadowRoot` for open roots and can assign live nids before transport. [CITED: MDN attachShadow; VERIFIED: `src/capture/index.js`] |
| Shadow mutation streaming | Browser / Client capture | Viewer diff applier | Shadow trees need deliberate observers/traversal and renderer ops that resolve through the same private identity index. [CITED: WHATWG DOM issue #1287; VERIFIED: local jsdom probe + `src/renderer/index.js`] |
| Slot fidelity | Browser / Client capture | Viewer reconstruction | Slot elements belong in the shadow tree while assigned children remain light-DOM children of the host; duplicating assigned nodes would violate slot ownership. [CITED: MDN HTMLSlotElement.assignedNodes + DOM Standard slot assignment] |
| Same-origin iframe mirroring | Browser / Client capture | Viewer reconstruction | Parent capture can inspect only accessible frame documents; viewer must reconstruct inert frame DOM through srcdoc/sandbox rather than linking live remote content. [CITED: MDN contentDocument + HTML sandbox spec; VERIFIED: `src/renderer/snapshot.js`] |
| Cross-origin iframe placeholder | Browser / Client capture | Renderer snapshot/diff | Browser same-origin policy blocks content reads, so capture should emit only safe placeholder metadata and renderer should never imply content was mirrored. [CITED: MDN same-origin policy + MDN contentDocument] |
| Live form values | Browser / Client capture | Renderer diff applier | User-driven value changes fire input/change events and can update the `value` property without changing the `value` attribute. [CITED: MDN input event + MDN value/defaultValue; VERIFIED: local jsdom probe] |
| Late-added computed styles | Browser / Client capture | Renderer diff applier | Computed styles are read from live elements before add-op serialization; renderer only applies sanitized HTML/sidecars. [VERIFIED: `collectComputedStyleText`, `processAddedNode`, `applyMutations`] |
| On-demand subtree fetch | Viewer | Browser / Client capture | The viewer detects missing/truncated nids and sends a control request; capture owns live-node lookup and sanitized subtree serialization. [VERIFIED: `requestResync` pattern in `src/renderer/index.js` + `getTrackedNodeId`/`processAddedNode` in `src/capture/index.js`] |
| Relay behavior for new messages | Relay | Transport endpoints | The relay forwards raw frames by role and should not deserialize or enforce feature semantics. [VERIFIED: `src/relay/relay.js`] |

## Standard Stack

### Core

| Library / API | Version | Purpose | Why Standard |
|---------------|---------|---------|--------------|
| Existing PhantomStream protocol/capture/renderer modules | Local `0.1.0` package state | Extend message constants, capture serialization, renderer reconstruction, and identity indexing. | The project already exposes `./protocol`, `./capture`, and `./renderer` and Phase 07 completed the identity contract these features depend on. [VERIFIED: `package.json` + Phase 07 summaries] |
| Web Platform Shadow DOM APIs | Browser platform; `attachShadow()` baseline since Jan 2020 per MDN | Attach mirror shadow roots and read open source shadow roots. | Open roots are accessible via `Element.shadowRoot`; closed roots return `null`, matching Phase 08 scope. [CITED: MDN attachShadow] |
| Web Platform MutationObserver | Browser platform; baseline since Jul 2015 per MDN | Observe main document, each open shadow root, and accessible frame documents. | `observe()` can watch a node and its subtree and the same observer can observe multiple roots. [CITED: MDN MutationObserver.observe] |
| Web Platform iframe APIs | Browser platform; `contentDocument` baseline since Jul 2015 per MDN | Distinguish accessible same-origin frames from inaccessible cross-origin frames. | `contentDocument` returns a document only when parent and frame are same-origin. [CITED: MDN HTMLIFrameElement.contentDocument] |
| Web Platform form events/properties | Browser platform; `input` event baseline since Jan 2020 per MDN | Capture live value/checked/selected state. | The `input` event covers user-driven value changes, while programmatic value changes do not necessarily fire `input`. [CITED: MDN input event] |
| Existing `node:test` suite | Node built-in; CI matrix Node 20/22/24 | Focused unit/integration tests. | Current `npm test` uses `node --test tests/*.test.js tests/differential/*.test.js`. [VERIFIED: `package.json` + `.github/workflows/ci.yml`] |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `jsdom` | Locked `29.1.1`; current npm version `29.1.1`; published 2026-04-30; engines `^20.19.0 || ^22.13.0 || >=24.0.0`. | DOM unit tests for sanitizer, renderer diff, shadow-root parsing mechanics, and value-property probes. | Use for fast unit coverage, but keep iframe `srcdoc` and real browser rendering assertions out of jsdom-only checks. [VERIFIED: `package-lock.json`, `npm view jsdom`, Context7 `/jsdom/jsdom`] |
| `playwright` | Locked `1.60.0`; current npm version `1.61.0`; `1.60.0` published 2026-05-11 and `1.61.0` published 2026-06-15. | Real Chromium coverage for shadow DOM, frame origin behavior, and actual form events. | Use for at least one browser-backed Phase 08 fixture because jsdom does not fully model iframe `srcdoc` loading and layout. [VERIFIED: `package-lock.json`, `npm view playwright`, Playwright docs] |
| `ws` | Locked/current `8.21.0`; published 2026-05-22. | Existing relay/backend tests and demos. | No Phase 08 feature should require relay changes beyond allowing new raw message types through existing transport. [VERIFIED: `package-lock.json`, `npm view ws`, `src/relay/relay.js`] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Explicit structured shadow payloads | `ShadowRoot.getHTML()` / serializable shadow roots | `getHTML()` is newly available and serializes only selected/serializable roots by option; it also returns strings with browser-specific escaping caveats, while PhantomStream already has DOM-fragment sanitization and sidecar identity rules. Use explicit serializer paths instead. [CITED: MDN ShadowRoot.getHTML + ShadowRoot.serializable; VERIFIED: `sanitizeForWire`/`sanitizeFragment`] |
| Observing open shadow roots directly | Monkey-patch `HTMLElement.prototype.attachShadow()` | Monkey patching can catch future roots but is obtrusive; Phase 08 can start with traversal on snapshot/add and deliberately observe discovered open roots, then only patch if tests prove missed roots created after capture start. [CITED: WHATWG DOM issue #1287; VERIFIED: current code has no attachShadow patch] |
| Same-origin iframe DOM serialization | Live iframe `src` in the mirror | Live `src` would fetch remote content and violate the inert mirror/no-scripts boundary; use sanitized `srcdoc` frame payloads instead. [VERIFIED: `docs/SECURITY.md` + `src/renderer/snapshot.js`; CITED: HTML sandbox spec] |
| Full CSSOM capture | Stylesheet-centric style ops | Phase 09 owns stylesheet-centric CSSOM and adopted stylesheet protocol; Phase 08 should only add computed styles to new nodes/subtrees. [VERIFIED: `08-CONTEXT.md` + `.planning/ROADMAP.md`] |

**Installation:**

```bash
# No new production package is recommended for Phase 08.
npm ci
```

**Version verification:**

```bash
npm view jsdom version time.modified
npm view playwright version time.modified
npm view ws version time.modified
```

Verified package state: `jsdom@29.1.1`, `playwright@1.61.0` current upstream while lockfile installs `1.60.0`, and `ws@8.21.0`. [VERIFIED: npm registry + `package-lock.json`]

## Architecture Patterns

### System Architecture Diagram

```text
Captured page document
  |
  | snapshot traversal + WeakMap nids + sanitizeForWire
  v
Main DOM payload: html + nodeIds
  |        \
  |         \-- shadowRoots[] keyed by hostNid: html + nodeIds + slot mode + diagnostics
  |          \-- frames[] keyed by frameNid: same-origin document payload OR cross-origin placeholder
  |
  v
Transport/relay
  |
  | raw fan-out; no semantic relay behavior
  v
Viewer outer sandbox iframe (allow-same-origin, no allow-scripts)
  |
  | buildSnapshotHtml + post-parse sanitizeFragment + resetIdentityIndex
  v
Mirror document
  |-- attachShadow({ mode:'open' }) on mirrored hosts, then index shadow nodeIds
  |-- nested inert iframe srcdoc for same-origin frame payloads, then index frame nodeIds
  |-- labeled placeholder element for cross-origin frame payloads
  |
  | mutations/value/subtree responses gated by streamSessionId/snapshotId
  v
applyMutations / value-op applier / subtree installer
```

This diagram reflects current transport and renderer boundaries: relay frames are raw, viewer owns reconstruction, and capture owns sanitization/masking before transport. [VERIFIED: `src/relay/relay.js`, `src/renderer/index.js`, `src/capture/index.js`, `docs/SECURITY.md`]

### Recommended Project Structure

```text
src/
├── protocol/messages.js      # add CONTROL.SUBTREE_REQUEST, STREAM.SUBTREE, DIFF_OP.VALUE, shadow/frame typedefs
├── capture/index.js          # extend single-file serializer/observer/value/fetch logic per existing Phase 1 constraint
├── renderer/index.js         # route new stream/control messages and own scoped identity indexes
├── renderer/diff.js          # apply shadow-aware add/remove/value ops while preserving stale-miss behavior
├── renderer/snapshot.js      # helper for inert nested frame srcdoc assembly if needed
└── adapters/playwright-inject.js # regenerate/patch classic artifact after capture core changes

tests/
├── capture-shadow-dom.test.js
├── renderer-shadow-dom.test.js
├── capture-iframe.test.js
├── renderer-iframe.test.js
├── capture-input-values.test.js
├── renderer-value-diff.test.js
├── capture-added-styles.test.js
├── renderer-subtree-fetch.test.js
└── playwright-fidelity-phase8.test.js
```

The module layout keeps Phase 08 within existing single-file capture constraints while adding focused test files for each roadmap requirement. [VERIFIED: `src/capture/README.md`, `08-CONTEXT.md`, current `tests/` layout]

### Pattern 1: Scoped Identity Descriptors

**What:** Represent every non-light-DOM tree as a scoped descriptor tied to the owning light-DOM nid, e.g. `shadowRoots: [{ hostNid, html, nodeIds, mode, slotAssignment }]` and `frames: [{ frameNid, kind:'same-origin', html, nodeIds, ... }]`. [VERIFIED: Phase 07 `nodeIds` model; CITED: MDN attachShadow + iframe contentDocument]

**When to use:** Use this for snapshot payloads, add-op payloads, subtree fetch responses, and any frame/shadow mutation target that needs address resolution beyond the main document. [VERIFIED: `src/protocol/messages.js`, `src/renderer/index.js`]

**Example:**

```js
// Source: Phase 07 sidecar pattern + Phase 08 context.
{
  html: '<custom-card><span slot="title">A</span></custom-card>',
  nodeIds: ['1', '2'],
  shadowRoots: [{
    hostNid: '1',
    mode: 'open',
    slotAssignment: 'named',
    html: '<h2><slot name="title"></slot></h2>',
    nodeIds: ['3', '4']
  }]
}
```

### Pattern 2: Observe Every Accessible Tree Root

**What:** Keep the main document observer, add observers for discovered open `ShadowRoot` instances, and add observers for same-origin iframe documents. [CITED: MDN MutationObserver.observe; VERIFIED: local jsdom probe]

**When to use:** Attach at snapshot time for existing trees and during add/iframe load handling for newly discovered trees; disconnect all observers on `stop()` and avoid observing closed/cross-origin roots. [VERIFIED: `startMutationStream`/`stopMutationStream` patterns]

**Example:**

```js
// Source: MDN MutationObserver.observe + current startMutationStream shape.
function observeTreeRoot(root, scope) {
  mutationObserver.observe(root, {
    childList: true,
    attributes: true,
    characterData: true,
    subtree: true,
    attributeOldValue: true
  });
  observedScopes.set(root, scope);
}
```

### Pattern 3: Render Real Shadow Roots, Never Flatten Slots

**What:** After the mirror document is sanitized and indexed, find each mirrored host by `hostNid`, call `attachShadow({ mode:'open', slotAssignment })`, parse/sanitize the shadow HTML in a template, append it into the shadow root, and index `nodeIds` against shadow descendants. [CITED: MDN attachShadow + HTMLSlotElement.assignedNodes; VERIFIED: `sanitizeFragment` + renderer identity hooks]

**When to use:** Use on snapshot load, add-op import, subtree fetch install, and explicit shadow-root replacement ops. [VERIFIED: `handleSnapshot`, `applyMutations`]

**Example:**

```js
// Source: MDN attachShadow + src/renderer/sanitize.js.
function installShadowPayload(host, payload, doc, identity) {
  if (!host || host.shadowRoot) return false;
  var root = host.attachShadow({
    mode: 'open',
    slotAssignment: payload.slotAssignment || 'named'
  });
  var tpl = doc.createElement('template');
  tpl.innerHTML = payload.html || '';
  sanitizeFragment(tpl.content, sanitizeCounters, logger);
  root.appendChild(doc.importNode(tpl.content, true));
  identity.indexSubtree(root, payload.nodeIds || []);
  return true;
}
```

### Pattern 4: Value-State Ops

**What:** Emit a narrow `DIFF_OP.VALUE` or equivalent documented extension with `{ nid, value?, checked?, selectedIndex?, selectedValues? }` rather than replacing nodes. [VERIFIED: `DIFF_OP` contract + `08-CONTEXT.md`]

**When to use:** Use for `input`, `textarea`, `select`, checkbox, radio, and option selection changes caused by `input`/`change` events. [CITED: MDN input event]

**Example:**

```js
// Source: MDN input event + existing sanitizeForWire masking chokepoint.
function handleFormValueEvent(event) {
  var el = event.target;
  var nid = getTrackedNodeId(el);
  if (!nid || shouldSkipValueTarget(el)) return;
  var state = serializeFormValueState(el);
  diffs.push({
    op: 'value',
    nid: nid,
    value: sanitizeForWire('text', { text: state.value, owner: el }).text,
    checked: state.checked,
    selectedValues: state.selectedValues
  });
}
```

### Pattern 5: Subtree Fetch as Latched Control/Response

**What:** Add a viewer-originated control request with `{ nid, streamSessionId, snapshotId, requestId }` and a capture-originated response with `{ requestId, nid, status, subtree }`. [VERIFIED: existing `CONTROL.START` resync and `STREAM.*` direction conventions]

**When to use:** Use only for known truncated/missing placeholders or user-triggered recovery, not for automatic per-miss storms. [VERIFIED: `08-CONTEXT.md`]

**Example:**

```js
// Source: existing requestResync latch pattern in src/renderer/index.js.
function requestSubtree(nid) {
  if (subtreeFetchPending.has(String(nid))) return false;
  subtreeFetchPending.add(String(nid));
  safeSend(CONTROL.SUBTREE_REQUEST, {
    nid: String(nid),
    requestId: 'subtree_' + Date.now(),
    streamSessionId: active.streamSessionId,
    snapshotId: active.snapshotId
  });
  return true;
}
```

### Anti-Patterns to Avoid

- **Flattening shadow DOM into light DOM:** It duplicates slotted content and loses browser slot assignment behavior. [VERIFIED: `08-CONTEXT.md`; CITED: MDN HTMLSlotElement.assignedNodes]
- **Selector fallback for shadow/frame ops:** It contradicts Phase 07's private identity index and reopens the retired querySelector hot path. [VERIFIED: Phase 07 summaries + `tests/node-identity-static.test.js`]
- **Cross-origin iframe scraping attempts:** Browser same-origin policy restricts cross-origin frame DOM reads; placeholders are the scope. [CITED: MDN same-origin policy + MDN contentDocument]
- **Raw `innerHTML` insertion in renderer roots without `sanitizeFragment`:** Existing security policy requires parsed-fragment sanitization before import/insert. [VERIFIED: `docs/SECURITY.md`, `src/renderer/diff.js`]
- **Per-node style/layout interleaving:** The project already documents expensive full-property enumeration and forced layout read/write loops as performance hazards. [VERIFIED: `docs/DESIGN-HISTORY.md`, `src/capture/index.js`]
- **Telemetry carrying typed values or frame URLs beyond safe metadata:** Existing health events are content-free and Phase 08 decisions require typed text to stay out of diagnostics. [VERIFIED: `src/renderer/README.md`, `08-CONTEXT.md`]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Shadow root construction | A fake `<template shadowrootmode>` string inside light DOM | `host.attachShadow({ mode:'open' })` plus sanitized fragment append | Real shadow roots preserve slot rendering and encapsulation semantics. [CITED: MDN attachShadow + MDN assignedNodes] |
| Slot distribution | Manual duplication of assigned light children into shadow HTML | Browser slot assignment with actual `<slot>` elements | Assigned nodes remain light-DOM children; duplication would create two mirrored nodes for one live node. [CITED: DOM Standard slot assignment + MDN assignedNodes] |
| Cross-origin frame access | Proxy, CORS bypass, or `postMessage` scraping | Labeled placeholder with safe dimensions/origin metadata | Same-origin policy limits cross-origin DOM access. [CITED: MDN same-origin policy + MDN contentDocument] |
| Form value privacy | Separate masking code for event-driven values | Existing `sanitizeForWire('text')`, `shouldMaskInput`, and `safeMaskInput` helpers | Password and `maskInputs` semantics already live there. [VERIFIED: `src/capture/index.js`, `docs/SECURITY.md`] |
| HTML sanitization | Regex/string sanitizer or unsanitized renderer `innerHTML` | Existing `sanitizeForWire` and `sanitizeFragment` chokepoints | The project already pins mXSS-safe parsed-fragment rendering and capture-side scrubbing. [VERIFIED: `docs/SECURITY.md`, `tests/security-chokepoint-purity.test.js`] |
| Late-added styles | Enumerating every computed CSS property | Existing `CURATED_PROPS` + `STYLE_DEFAULTS` | Full enumeration was documented as causing unacceptable serialization latency on heavy pages. [VERIFIED: `docs/DESIGN-HISTORY.md`] |
| Scoped identity | New selectors, XPath, or accessibility lookup for protocol ops | Phase 07 WeakMap + `nodeIds` sidecars + renderer `Map<nid, Node>` | Existing tests forbid retired identity selector paths. [VERIFIED: Phase 07 summaries + `src/renderer/index.js`] |

**Key insight:** Phase 08 complexity is mostly tree scoping and policy reuse; custom serializers, sanitizer forks, selector engines, or iframe bypasses would increase risk while contradicting already-verified architecture. [VERIFIED: `08-CONTEXT.md` + codebase]

## Common Pitfalls

### Pitfall 1: Body Observer Blindness To Shadow Trees

**What goes wrong:** Mutations inside open shadow roots do not reach the main `document.body` observer, so the initial snapshot looks correct but live shadow updates drift. [VERIFIED: local jsdom probe; CITED: WHATWG DOM issue #1287]

**Why it happens:** `MutationObserver.observe()` watches a selected target and its subtree, and current standards discussion treats shadow-tree observation as needing explicit additional handling. [CITED: MDN MutationObserver.observe + WHATWG DOM issue #1287]

**How to avoid:** Observe each discovered open `ShadowRoot` and any same-origin frame document; include scope metadata with mutation records. [CITED: MDN MutationObserver.observe; VERIFIED: `startMutationStream` pattern]

**Warning signs:** Shadow fixture passes snapshot assertions but fails after appending/changing a shadow child post-start. [VERIFIED: CAPT-08 fixture requirement in `08-CONTEXT.md`]

### Pitfall 2: Slot Duplication

**What goes wrong:** Serializing assigned nodes into shadow HTML duplicates light-DOM children and breaks identity/overlay/remote-control mapping. [CITED: MDN assignedNodes; VERIFIED: Phase 07 identity model]

**Why it happens:** Flattened tree rendering is tempting to serialize visually, but browser slot assignment already projects light-DOM children without moving ownership. [CITED: DOM Standard slot assignment]

**How to avoid:** Serialize `<slot>` elements as shadow nodes, keep assigned light-DOM children in the host's normal child list, and test default slots, named slots, and slot attribute reassignment. [VERIFIED: `08-CONTEXT.md`; CITED: MDN slotchange]

**Warning signs:** `nodeIds` contains the same live light child in both the main payload and a shadow payload. [VERIFIED: Phase 07 `nodeIds` sidecar invariant]

### Pitfall 3: Same-Origin Frame Payloads Becoming Live Remote Frames

**What goes wrong:** The mirror iframe loads `src` and becomes a second live page instead of inert mirrored DOM. [VERIFIED: `08-CONTEXT.md`; CITED: HTML sandbox spec]

**Why it happens:** Existing snapshot code preserves iframe `src` for placeholder/live shell behavior, but Phase 08 requires same-origin document content to be mirrored. [VERIFIED: `src/capture/index.js` iframe branch]

**How to avoid:** Replace accessible frame mirrors with nested iframe `srcdoc` payloads carrying CSP and sandbox without `allow-scripts`; keep cross-origin frames as placeholders. [VERIFIED: `docs/SECURITY.md`; CITED: MDN srcdoc + HTML sandbox spec]

**Warning signs:** A renderer test sees nested frame `src` loading a real URL or any nested sandbox token includes `allow-scripts`. [VERIFIED: `tests/security-chokepoint-purity.test.js` sandbox precedent]

### Pitfall 4: Typed Values Bypassing Masking

**What goes wrong:** Event-driven value diffs leak passwords or masked form values because they bypass snapshot/attr/text sanitization. [VERIFIED: `08-CONTEXT.md`, `docs/SECURITY.md`]

**Why it happens:** `input.value` is current property state while `defaultValue` reflects the `value` attribute; property changes can be invisible to attribute MutationObserver records. [CITED: MDN value/defaultValue; VERIFIED: local jsdom probe]

**How to avoid:** Route every value op through the same masking helpers as snapshot and text paths, and assert password values never appear in sent frames. [VERIFIED: `sanitizeForWire`/`shouldMaskInput` in `src/capture/index.js`]

**Warning signs:** `tests/security-mask.test.js` passes for snapshots but a new input-event test finds raw typed text in `STREAM.MUTATIONS`. [VERIFIED: current tests + CAPT-05]

### Pitfall 5: Add-Style Reads Causing Layout Thrash

**What goes wrong:** A childList burst forces layout repeatedly because computed style or rect reads are interleaved with clone mutation and serialization. [VERIFIED: `docs/DESIGN-HISTORY.md`]

**Why it happens:** `getComputedStyle` and layout reads can be expensive when mixed with DOM writes; the project already fixed a similar truncation issue with a read-then-write pass. [VERIFIED: `docs/DESIGN-HISTORY.md`, `src/capture/index.js`]

**How to avoid:** Collect computed style text for added subtree elements before mutating the wire clone, reuse `CURATED_PROPS`, and avoid broad enumeration. [VERIFIED: `collectComputedStyleText`, `processAddedNode`]

**Warning signs:** Tests or static scans show `for (let i = 0; i < computed.length; i++)` or style reads inside a clone-writing loop. [VERIFIED: `CURATED_PROPS` pattern]

### Pitfall 6: Subtree Fetch Storms

**What goes wrong:** Stale misses trigger repeated subtree requests for the same missing nid and create traffic loops under fast mutation. [VERIFIED: `08-CONTEXT.md`; VERIFIED: existing `requestResync` latch pattern]

**Why it happens:** Existing stale-miss handling escalates after thresholds; a new fetch path without latching can fire per op. [VERIFIED: `src/renderer/diff.js`, `src/renderer/index.js`]

**How to avoid:** Latch by `nid`/`requestId`, clear on response or snapshot generation change, and softly ignore gone/skipped/blocked nodes. [VERIFIED: `08-CONTEXT.md`]

**Warning signs:** A single truncated placeholder causes multiple identical `CONTROL.SUBTREE_REQUEST` frames before any response. [VERIFIED: `08-CONTEXT.md`]

## Code Examples

### Same-Origin Iframe Gate

```js
// Source: MDN HTMLIFrameElement.contentDocument + current capture iframe branch.
function classifyIframe(iframe) {
  try {
    var doc = iframe.contentDocument;
    if (doc && doc.documentElement) {
      return { kind: 'same-origin', document: doc };
    }
  } catch (err) {
    // Cross-origin access may throw through contentWindow/document paths.
  }
  return {
    kind: 'cross-origin',
    label: 'Cross-origin iframe',
    src: iframe.getAttribute('src') || ''
  };
}
```

### Shadow Root Traversal Without Flattening

```js
// Source: MDN attachShadow + Phase 07 sidecar preorder pattern.
function serializeOpenShadow(host, hostNid) {
  var shadow = host.shadowRoot;
  if (!shadow) return null;
  var clone = document.createElement('template');
  clone.content.appendChild(shadow.cloneNode(true));
  var cloneToNid = new Map();
  pairShadowElementsWithNids(shadow, clone.content, cloneToNid);
  sanitizeForWire('subtree', { root: clone.content.firstElementChild, liveRoot: shadow });
  return {
    hostNid: hostNid,
    mode: 'open',
    slotAssignment: shadow.slotAssignment || 'named',
    html: serializeFragmentChildren(clone.content),
    nodeIds: buildNodeIdSidecarForFragment(clone.content, cloneToNid)
  };
}
```

### Value Diff Apply

```js
// Source: MDN input event + existing renderer diff containment pattern.
case DIFF_OP.VALUE: {
  var control = resolve(m.nid);
  if (!control) {
    recordStaleMiss(DIFF_OP.VALUE, m.nid);
    break;
  }
  if ('value' in m) control.value = String(m.value == null ? '' : m.value);
  if ('checked' in m) control.checked = !!m.checked;
  if (Array.isArray(m.selectedValues) && control.options) {
    Array.prototype.forEach.call(control.options, function (option) {
      option.selected = m.selectedValues.indexOf(option.value) !== -1;
    });
  }
  break;
}
```

### Batched Added-Node Style Reads

```js
// Source: docs/DESIGN-HISTORY.md read-then-write lesson + collectComputedStyleText.
function collectAddedSubtreeStyles(root) {
  var liveElements = [root].concat(Array.prototype.slice.call(root.querySelectorAll('*')));
  var styleByElement = new WeakMap();
  for (var i = 0; i < liveElements.length; i++) {
    styleByElement.set(liveElements[i], collectComputedStyleText(liveElements[i], CURATED_PROPS));
  }
  return styleByElement;
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Live-page `data-fsb-nid` attributes | WeakMap identity plus `nodeIds` sidecars and renderer `Map<nid, Node>` | Phase 07, completed 2026-06-15 | Phase 08 must scope sidecars through shadow roots/frames, not selectors. [VERIFIED: Phase 07 summaries] |
| Main-document-only MutationObserver | Explicit observation of accessible tree roots | Existing platform reality; WHATWG issue opened 2024 proposes a future shadow option | Phase 08 must deliberately observe open shadow roots and same-origin frames. [CITED: MDN MutationObserver.observe + WHATWG DOM issue #1287] |
| `innerHTML` as the only DOM serialization primitive | `ShadowRoot.getHTML()` exists but is newly available and option-driven | MDN marks Baseline 2024 | Do not rely on it for Phase 08 because project policy needs sidecar identity and sanitizer control. [CITED: MDN ShadowRoot.getHTML; VERIFIED: `sanitizeForWire`] |
| Live iframe `src` preserved as shell | Same-origin frame document payloads and cross-origin placeholders | Phase 08 requirement | Viewer must render inert nested frame content, not live remote documents. [VERIFIED: CAPT-09 + `08-CONTEXT.md`] |
| Passive truncation recovery through future snapshot | On-demand subtree request/response | Phase 08 requirement | Viewer can recover missing regions without full snapshot wait, bounded by request latching. [VERIFIED: CAPT-11 + `08-CONTEXT.md`] |

**Deprecated/outdated:**

- Treating closed shadow roots as capturable from outside is out of scope because `element.shadowRoot` returns `null` for closed roots. [CITED: MDN attachShadow]
- Using `document.body` MutationObserver coverage as proof of shadow mutation coverage is outdated for this project; explicit root observation is required. [CITED: WHATWG DOM issue #1287; VERIFIED: local jsdom probe]
- Loading same-origin iframes in the mirror via original `src` is insufficient for Phase 08 because the mirror must be inert DOM. [VERIFIED: `08-CONTEXT.md`; CITED: HTML sandbox spec]

## Assumptions Log

No `[ASSUMED]` claims are used in this research; recommendations are sourced to project files, local probes, npm registry results, Context7, or official documentation. [VERIFIED: review of this artifact]

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| — | None | — | — |

## Open Questions (RESOLVED)

1. **Should manual `slotAssignment: "manual"` be first-class in Phase 08 tests?** [CITED: MDN attachShadow + MDN HTMLSlotElement.assign]
   - What we know: Phase context explicitly requires default slots, named slots, and slot reassignment, and MDN documents manual slot assignment as a separate mode. [VERIFIED: `08-CONTEXT.md`; CITED: MDN attachShadow]
   - What's unclear: The phase does not explicitly require manual `HTMLSlotElement.assign()` parity. [VERIFIED: `08-CONTEXT.md`]
   - Recommendation: Plan default/named/reassignment as required coverage and add one manual-slot smoke test only if it is cheap after the core design supports `slotAssignment`. [CITED: MDN HTMLSlotElement.assign]
   - RESOLVED: Default slots, named slots, and slot reassignment are required Phase 08 coverage. Manual `slotAssignment: "manual"` / `HTMLSlotElement.assign()` coverage is deferred unless the core implementation makes a cheap smoke test trivial; it is not a Phase 08 blocker.

2. **Should Playwright be bumped from locked `1.60.0` to current `1.61.0`?** [VERIFIED: npm registry + package-lock]
   - What we know: npm shows `1.61.0` current as of 2026-06-15, while the lockfile installs `1.60.0`. [VERIFIED: `npm view playwright version` + `package-lock.json`]
   - What's unclear: Phase 08 does not need a documented Playwright feature newer than `1.60.0`. [VERIFIED: Playwright frames docs + local package]
   - Recommendation: Do not add a package-bump task unless a real-browser test fails because of a Playwright bug fixed in `1.61.0`. [VERIFIED: no current evidence requiring bump]
   - RESOLVED: Do not bump Playwright from locked `1.60.0` unless an actual Phase 08 browser test proves a Playwright bug. No package bump is planned.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Node.js | `node:test`, package scripts, jsdom | Yes | `v25.9.0` local; CI matrix Node 20/22/24 | CI covers supported floors. [VERIFIED: `node --version` + `.github/workflows/ci.yml`] |
| npm/npx | package install and Context7 fallback | Yes | `11.12.1` | None needed. [VERIFIED: `npm --version`, `npx --version`] |
| `gsd-sdk` | GSD init/commit helpers | Yes | command present | Manual git commit if SDK fails. [VERIFIED: `command -v gsd-sdk`] |
| `rg` | code/test discovery | Yes | command present | `grep` if unavailable. [VERIFIED: `command -v rg`] |
| Playwright Chromium binary | real-browser shadow/frame/input validation | Yes | executable path under `~/Library/Caches/ms-playwright/chromium-1223/...` | Use jsdom for non-layout unit coverage, but keep at least one browser-backed fidelity test. [VERIFIED: local Playwright require probe] |
| `jsdom` | fast DOM unit tests | Yes | lockfile `29.1.1` | Playwright for iframe/srcdoc/layout gaps. [VERIFIED: `package-lock.json`, local jsdom probe] |
| System Chrome/Chromium command | optional manual browser checks | Not found in PATH | — | Playwright Chromium binary is available. [VERIFIED: `command -v google-chrome/chromium`] |

**Missing dependencies with no fallback:** None for research/planning. [VERIFIED: environment audit]

**Missing dependencies with fallback:** System `google-chrome`/`chromium` commands are absent, but Playwright-managed Chromium is available. [VERIFIED: environment audit]

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Node built-in `node:test` with `jsdom@29.1.1`; Playwright browser smoke tests where platform fidelity matters. [VERIFIED: `package.json`, `package-lock.json`] |
| Config file | No separate test config; npm script is in `package.json`. [VERIFIED: `package.json`] |
| Quick run command | `node --test tests/capture-shadow-dom.test.js tests/renderer-shadow-dom.test.js tests/capture-iframe.test.js tests/renderer-iframe.test.js tests/capture-input-values.test.js tests/renderer-value-diff.test.js tests/capture-added-styles.test.js tests/renderer-subtree-fetch.test.js` [VERIFIED: current test runner pattern] |
| Full suite command | `npm test` [VERIFIED: `package.json`] |

### Phase Requirements -> Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| CAPT-05 | `input`/`textarea` typed values, `select`, checkbox/radio checked/selected state stream live and remain masked when configured. [VERIFIED: `.planning/REQUIREMENTS.md`, `08-CONTEXT.md`] | unit + loopback | `node --test tests/capture-input-values.test.js tests/renderer-value-diff.test.js tests/security-mask.test.js` | No, Wave 0. [VERIFIED: `rg --files tests`] |
| CAPT-06 | Add ops carry curated computed styles for dynamically added nodes/subtrees without all-property enumeration. [VERIFIED: `.planning/REQUIREMENTS.md`, `docs/DESIGN-HISTORY.md`] | unit/static | `node --test tests/capture-added-styles.test.js tests/security-sanitize-capture.test.js` | No, Wave 0. [VERIFIED: `rg --files tests`] |
| CAPT-08 | Snapshot/add/diff/addressing extend into open shadow roots; slots do not duplicate light-DOM children. [VERIFIED: `.planning/REQUIREMENTS.md`, `08-CONTEXT.md`] | unit + Playwright smoke | `node --test tests/capture-shadow-dom.test.js tests/renderer-shadow-dom.test.js tests/playwright-fidelity-phase8.test.js` | No, Wave 0. [VERIFIED: `rg --files tests`] |
| CAPT-09 | Same-origin frames mirror as inert content; cross-origin frames become labeled placeholders. [VERIFIED: `.planning/REQUIREMENTS.md`] | unit + Playwright smoke | `node --test tests/capture-iframe.test.js tests/renderer-iframe.test.js tests/playwright-fidelity-phase8.test.js` | No, Wave 0. [VERIFIED: `rg --files tests`] |
| CAPT-11 | Viewer sends bounded subtree fetch requests and applies sanitized, identity-indexed responses only when current. [VERIFIED: `.planning/REQUIREMENTS.md`, `08-CONTEXT.md`] | unit/integration | `node --test tests/renderer-subtree-fetch.test.js tests/capture-subtree-fetch.test.js tests/renderer-loopback.test.js` | No, Wave 0. [VERIFIED: `rg --files tests`] |

### Sampling Rate

- **Per task commit:** Run the smallest affected focused command from the map above plus any touched security/static test. [VERIFIED: existing GSD verification pattern in Phase 07 summaries]
- **Per wave merge:** Run the Phase 08 quick command once the Wave 0 files exist. [VERIFIED: current `node --test` pattern]
- **Phase gate:** Run `npm test`, then a browser-backed Playwright fidelity smoke if not already included in `npm test`. [VERIFIED: `08-CONTEXT.md` D-25 + local Playwright availability]

### Wave 0 Gaps

- [ ] `tests/capture-shadow-dom.test.js` - covers CAPT-08 snapshot/add/mutation sidecars. [VERIFIED: absent from `rg --files tests`]
- [ ] `tests/renderer-shadow-dom.test.js` - covers CAPT-08 reconstruction/indexing/slot non-duplication. [VERIFIED: absent from `rg --files tests`]
- [ ] `tests/capture-iframe.test.js` - covers CAPT-09 same-origin/cross-origin classification and payload sanitization. [VERIFIED: absent from `rg --files tests`]
- [ ] `tests/renderer-iframe.test.js` - covers CAPT-09 inert nested iframe/placeholder reconstruction. [VERIFIED: absent from `rg --files tests`]
- [ ] `tests/capture-input-values.test.js` - covers CAPT-05 event-driven form value capture and masking. [VERIFIED: absent from `rg --files tests`]
- [ ] `tests/renderer-value-diff.test.js` - covers CAPT-05 value op apply. [VERIFIED: absent from `rg --files tests`]
- [ ] `tests/capture-added-styles.test.js` - covers CAPT-06 curated style capture for add ops. [VERIFIED: absent from `rg --files tests`]
- [ ] `tests/capture-subtree-fetch.test.js` and `tests/renderer-subtree-fetch.test.js` - cover CAPT-11 request/response/staleness/latching. [VERIFIED: absent from `rg --files tests`]
- [ ] `tests/playwright-fidelity-phase8.test.js` - covers real browser shadow slot rendering, iframe origin behavior, and actual input/change events. [VERIFIED: absent from `rg --files tests`; CITED: Playwright frames docs]

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|------------------|
| V2 Authentication | No | Phase 08 does not add authn flows; remote-control consent remains adapter-owned from Phase 05. [VERIFIED: `.planning/REQUIREMENTS.md`, `src/adapters/playwright.js`] |
| V3 Session Management | Yes | Every new Phase 08 request/response/op must preserve `streamSessionId` and `snapshotId` staleness checks. [VERIFIED: `src/protocol/messages.js`, `src/renderer/index.js`] |
| V4 Access Control | Yes | Cross-origin iframe content must not be accessed or bypassed; same-origin gate is browser-enforced through `contentDocument`. [CITED: MDN same-origin policy + MDN contentDocument] |
| V5 Input Validation / V1 Encoding & Sanitization in ASVS 5 nomenclature | Yes | Reuse `sanitizeForWire`, `sanitizeFragment`, `sanitizeAttrValue`, and CSS scrubbers for all new shadow/frame/value/subtree payloads. [VERIFIED: `docs/SECURITY.md`, `src/capture/index.js`, `src/renderer/sanitize.js`; CITED: OWASP ASVS project] |
| V6 Cryptography | No | Phase 08 does not add cryptographic storage, signing, or encryption. [VERIFIED: phase scope in `08-CONTEXT.md`] |

### Known Threat Patterns for PhantomStream Phase 08

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Script execution through shadow/frame/subtree HTML | Elevation of Privilege | Capture `sanitizeForWire`, render `sanitizeFragment`, CSP meta, and iframe sandbox without `allow-scripts`. [VERIFIED: `docs/SECURITY.md`, `src/renderer/snapshot.js`, `src/renderer/index.js`] |
| Cross-origin iframe data leakage | Information Disclosure | Do not read cross-origin frame DOM; emit only content-free placeholder metadata. [CITED: MDN same-origin policy + MDN contentDocument; VERIFIED: `08-CONTEXT.md`] |
| Typed password or masked input leakage | Information Disclosure | Route value ops through existing mask helpers and keep health telemetry content-free. [VERIFIED: `src/capture/index.js`, `src/renderer/README.md`] |
| Identity confusion across shadow/frame scopes | Tampering | Use scoped descriptors and renderer private index; no selector fallback or duplicate slot ownership. [VERIFIED: Phase 07 summaries + `08-CONTEXT.md`] |
| Fetch storm from missing/truncated nids | Denial of Service | Latch requests by nid/requestId and softly ignore stale/gone/skipped/blocked targets. [VERIFIED: `08-CONTEXT.md`, `requestResync` latch in `src/renderer/index.js`] |
| mXSS through string serialize/parse cycles | Elevation of Privilege | Parse to DOM fragment, sanitize before import, avoid string-scrub-then-reparse as a new policy. [VERIFIED: `docs/SECURITY.md`, `src/renderer/diff.js`; CITED: MDN ShadowRoot.getHTML mXSS note] |

## Sources

### Primary (HIGH confidence)

- `.planning/phases/08-shadow-dom-iframes-fidelity-completion/08-CONTEXT.md` - locked decisions, discretion, deferred ideas, verification shape. [VERIFIED]
- `.planning/REQUIREMENTS.md` - CAPT-05, CAPT-06, CAPT-08, CAPT-09, CAPT-11 definitions. [VERIFIED]
- `.planning/ROADMAP.md` - Phase 08 goal, dependency, success criteria. [VERIFIED]
- `.planning/STATE.md` - current position and Phase 08 concern. [VERIFIED]
- Phase 07 summaries and research - WeakMap identity, `nodeIds`, renderer index, artifact update facts. [VERIFIED]
- `src/capture/index.js` - sanitizer/masking, WeakMap identity, serialization, truncation, mutation batching, add-op behavior. [VERIFIED]
- `src/protocol/messages.js` - current message constants, diff ops, session guard. [VERIFIED]
- `src/renderer/index.js`, `src/renderer/diff.js`, `src/renderer/sanitize.js`, `src/renderer/snapshot.js` - identity index, diff apply, sanitization, sandbox/srcdoc behavior. [VERIFIED]
- `docs/SECURITY.md`, `docs/DESIGN-HISTORY.md`, `docs/ARCHITECTURE.md` - security contract and performance lessons. [VERIFIED]
- MDN `Element.attachShadow()` - open/closed roots, options, slotAssignment. https://developer.mozilla.org/en-US/docs/Web/API/Element/attachShadow [CITED]
- MDN `MutationObserver.observe()` - observe targets/options. https://developer.mozilla.org/en-US/docs/Web/API/MutationObserver/observe [CITED]
- MDN `HTMLIFrameElement.contentDocument` and `contentWindow` - same-origin access behavior. https://developer.mozilla.org/en-US/docs/Web/API/HTMLIFrameElement/contentDocument and https://developer.mozilla.org/en-US/docs/Web/API/HTMLIFrameElement/contentWindow [CITED]
- MDN Same-origin policy. https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Same-origin_policy [CITED]
- HTML Standard iframe sandbox section. https://html.spec.whatwg.org/multipage/iframe-embed-object.html [CITED]
- MDN `input` event, `HTMLInputElement.value`, and `defaultValue`. https://developer.mozilla.org/en-US/docs/Web/API/Element/input_event, https://developer.mozilla.org/en-US/docs/Web/API/HTMLInputElement/value, https://developer.mozilla.org/en-US/docs/Web/API/HTMLInputElement/defaultValue [CITED]
- MDN `HTMLSlotElement.assignedNodes()`, `slotchange`, and `assign()`. https://developer.mozilla.org/en-US/docs/Web/API/HTMLSlotElement/assignedNodes, https://developer.mozilla.org/en-US/docs/Web/API/HTMLSlotElement/slotchange_event, https://developer.mozilla.org/en-US/docs/Web/API/HTMLSlotElement/assign [CITED]
- DOM Standard slot assignment and shadow-including algorithms. https://dom.spec.whatwg.org/ [CITED]
- MDN `ShadowRoot.getHTML()` and `ShadowRoot.serializable`. https://developer.mozilla.org/en-US/docs/Web/API/ShadowRoot/getHTML and https://developer.mozilla.org/en-US/docs/Web/API/ShadowRoot/serializable [CITED]
- Playwright Frames docs. https://playwright.dev/docs/frames [CITED]
- Context7 `/jsdom/jsdom` and `/microsoft/playwright.dev` docs lookups. [VERIFIED: `npx --yes ctx7@latest ...`]
- npm registry for `jsdom`, `playwright`, and `ws` versions/publish times. [VERIFIED: `npm view ...`]

### Secondary (MEDIUM confidence)

- WHATWG DOM issue #1287 for current ecosystem discussion about adding shadow-tree observation support to MutationObserver. https://github.com/whatwg/dom/issues/1287 [CITED]

### Tertiary (LOW confidence)

- None used. [VERIFIED: source list review]

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH - no new production dependency is recommended, and package versions were verified against npm/lockfile. [VERIFIED: npm registry + `package-lock.json`]
- Architecture: HIGH - integration points are directly visible in source and constrained by Phase 07/08 decisions. [VERIFIED: codebase + phase artifacts]
- Pitfalls: HIGH for security/identity/style risks already documented in project code; MEDIUM for future MutationObserver shadow-option state because the source is an open standards issue rather than shipped API. [VERIFIED: project docs; CITED: WHATWG issue #1287]

**Research date:** 2026-06-15 [VERIFIED: `date -Iseconds`]
**Valid until:** 2026-07-15 for project architecture and npm versions; re-check browser API docs before changing shadow serialization strategy or package versions. [VERIFIED: current-source-sensitive recommendation]
