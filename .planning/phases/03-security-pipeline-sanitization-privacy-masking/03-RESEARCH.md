# Phase 3: Security Pipeline — Sanitization + Privacy Masking - Research

**Researched:** 2026-06-11
**Domain:** capture-side HTML sanitization + render-side DOM-fragment scrubbing + capture-side privacy masking, all under a zero-runtime-dep, JS-ESM + JSDoc, jsdom-29-test constraint
**Confidence:** HIGH

## Summary

Phase 3 lands two **named chokepoints** — one capture-side, one render-side — that together with the already-asserted `sandbox="allow-same-origin"` (no `allow-scripts`) and a srcdoc `<meta http-equiv="Content-Security-Policy">` backstop make mirrored content safe to render and **never** allow masked content onto the wire. The capture-side chokepoint is the unique writer through which every serialization path emits HTML/text/attr values; the render-side chokepoint is the unique writer through which every reconstructed-DOM insertion runs. Defense-in-depth is the bar: every layer (capture sanitize → wire-shape audit → render sanitize → CSP meta → sandbox token assertion) must independently neutralize hostile content.

The phase's hardest constraint is **zero runtime dependencies** (project rule, `package.json` lists no `dependencies`). DOMPurify is off the table — we build a scoped, fidelity-first blocklist sanitizer (the CONTEXT decision) and dogfood it through the loopback example. The second hardest constraint is **fidelity-first**: every passing scenario in the differential oracle (130/130 today) must stay green after sanitization, with the deliberate sanitization divergence ledgered like D6.

Empirically verified this session against the installed jsdom 29.1.1: `<template>`-context parsing **does** preserve `<tr>/<td>/<col>/<option>` in jsdom (current div-context drop, README "queued for Phase 3+", is now safe to take); `<noscript>` children **are** walked by `NodeFilter.SHOW_ELEMENT` and **are** present in the parsed DOM (the chokepoint must explicitly drop noscript subtrees); the canonical math/mglyph namespace-confusion mXSS payload **survives** jsdom's parse-serialize round-trip; `<input type="password">` is reliably detected via the `.type` getter.

**Primary recommendation:** Land a single named capture-side function (`sanitizeForWire`) that **all five serialization paths** route through (snapshot clone walk, processAddedNode, attr-op branch, characterData text branch, E2 text-childlist branch — dialog message text and overlay payloads count as side channels and use the same helpers), and a single named render-side function (`sanitizeFragment`) that **both two render-side insertion points** route through (snapshot srcdoc CSS+HTML assembly, add-op fragment build). Pair with the locked CSP meta in the srcdoc and the (already-asserted) `allow-same-origin`-only sandbox. Take the `<template>`-context add-op parsing upgrade in this phase — it's verified safe in jsdom 29 and directly increases the render-side chokepoint's coverage.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Strip `on*`/`javascript:`/`vbscript:`/`data:text/html`/`srcdoc` from serialized HTML | Capture (`src/capture/index.js`) | Render (`src/renderer/{snapshot,diff}.js`) | Capture is the only side that touches host content; render is the defense-in-depth backstop |
| Privacy masking (`blockSelector`, `maskTextSelector`, `maskInputs`, custom fns) | Capture | — | SEC-03 explicit: masked content never leaves the captured page |
| Sandboxed-iframe enforcement (`allow-same-origin` only, no `allow-scripts`) | Render (`createViewer`) | — | Already asserted at iframe creation (`src/renderer/index.js:182-186`) |
| CSP meta in srcdoc (script blocked, restricted img/style sources) | Render (`buildSnapshotHtml`) | — | Sandbox + CSP are independent layers; CSP catches sandbox-misconfig regressions |
| CSS value scrub (url() schemes, `expression()`, `-moz-binding`, non-http(s) `@import`) | Capture (chokepoint) | Render (defense-in-depth pass during srcdoc assembly) | CSS reaches the wire via two routes: head `<style>` inline-styles list and per-element `style="..."` attributes |
| Counted + logged drops/strips (observability discipline) | Capture (counters in closure state) | Render (counters in viewer closure state, logger.warn prefix `[Renderer]`) | Parity with Phase 2 miss accounting; never silent (CONTEXT decision) |
| Embed-security contract documentation | Docs (`docs/SECURITY.md`) | Render (`src/renderer/README.md` pointer) | Locked: `docs/SECURITY.md` is the contract |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Native DOM | n/a | `<template>` element + `template.content` for context-aware HTML parsing; TreeWalker `SHOW_ELEMENT` over the fragment | Zero-dep project rule; project already imports jsdom 29 for tests; `<template>` context parsing is the documented fix for div-context drops (renderer README, queued from Phase 2) [VERIFIED: empirical jsdom 29.1.1 run, this session] |
| Native DOM | n/a | `Element.attributes` enumeration + `attr.namespaceURI` for namespaced-attr scrubbing (e.g., `xlink:href`) | The capture already uses `getAttributeNS('http://www.w3.org/1999/xlink', 'href')` (`src/capture/index.js:694`); the sanitizer must match coverage [VERIFIED: read `src/capture/index.js`] |
| `node:test` + `node:assert/strict` | Node ≥ 20 built-ins | Sanitization + masking + chokepoint-purity tests, run by the existing `npm test` script | Project convention; matches Phase 1/2 tests [VERIFIED: read `package.json` + `tests/`] |
| `jsdom` | `^29.1.1` (devDep, already installed) | Test-side DOM for both capture (`createExtractedSide` in `tests/differential/harness.js`) and render (`renderer-*.test.js`) | Already in use; CI runs Node 20/22/24 against this version [VERIFIED: read `package.json` + `node_modules/jsdom/package.json`] |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `node:vm` | built-in | Reference IIFE evaluation (unchanged from Phase 1 harness) | Differential oracle continues to work as-is; the new ledger entry covers the deliberate sanitize-side divergence [VERIFIED: read `tests/differential/harness.js`] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Hand-built blocklist sanitizer | DOMPurify (`dompurify` npm) | DOMPurify is the gold standard for HTML sanitization and ships an explicit `RETURN_DOM`/`RETURN_DOM_FRAGMENT` mode that avoids the serialize-reparse round-trip [CITED: https://github.com/cure53/DOMPurify]. **REJECTED**: zero-runtime-dep constraint is explicit ("Zero runtime deps is hard constraint — no DOMPurify; we build the (scoped) sanitizer" — additional_context); the published framework cannot pull in a 50KB runtime dep |
| Allowlist policy | DOMPurify-style strict allowlist | **REJECTED in CONTEXT**: "fidelity must survive sanitization. An allowlist was explicitly rejected — mirroring arbitrary real sites is the product." Blocklist preserves benign content unchanged |
| Full CSS parser | `csstree`, `postcss` | **REJECTED**: zero-dep constraint; CONTEXT decision is "targeted value scrub" via regex on `url()`/`expression()`/`-moz-binding`/`@import` |
| HTML Sanitizer API (`Element.setHTML`/`Sanitizer`) | TC39/W3C draft, browser-only | Not available in jsdom (any version); proposal still evolving; would only work at the renderer in real browsers anyway |

**Installation:** No new dependencies. The phase ships pure JS in `src/capture/` and `src/renderer/` plus tests.

**Version verification:**
```bash
node -e "console.log(require('./node_modules/jsdom/package.json').version)"   # → 29.1.1
```
Verified this session: `29.1.1` installed locally [VERIFIED: bash command output, this session].

## Package Legitimacy Audit

This phase **installs no packages** (zero-runtime-dep project rule + no new devDependencies needed — jsdom is already in `package.json`). Slopcheck N/A; nothing to gate.

## Architecture Patterns

### System Architecture Diagram

```
                       ┌──────────────────────────────────────────┐
                       │  HOST PAGE (attacker-influenced content)  │
                       └────────────────┬─────────────────────────┘
                                        │  DOM + mutations
                                        ▼
   ┌─────────────────────────────────────────────────────────────────────────┐
   │  CAPTURE SIDE  (src/capture/index.js)                                   │
   │                                                                         │
   │  serializeDOM ──┐                                                       │
   │  processAddedNode ─┤                                                    │
   │  attr-op branch ───┼──► sanitizeForWire(node|html|attrName,attrVal)     │
   │  characterData ────┤    + maskTextIfSelectorMatch(text, owner)          │
   │  text-childlist ───┤    + maskInputValueIfApplies(el, attrName, val)    │
   │  dialog/overlay ───┘    + neutralizeObjectEmbed(el)                     │
   │                         + scrubInlineCss(cssText)                       │
   │                              │                                          │
   │   counters: { strippedHandlers, blockedUrlSchemes, maskedTextNodes,     │
   │               maskedInputs, blockedSubtrees, cssScrubs }                │
   │                              │                                          │
   │                              ▼                                          │
   │                       transport.send(STREAM.*, payload)                 │
   └─────────────────────────────────┬───────────────────────────────────────┘
                                     │ wire (already safe per SEC-01/SEC-03)
                                     ▼
   ┌─────────────────────────────────────────────────────────────────────────┐
   │  RENDER SIDE  (src/renderer/{snapshot,diff,index}.js)                   │
   │                                                                         │
   │  buildSnapshotHtml ──► sanitizeFragment(srcdocSkeleton)  ── srcdoc ─►   │
   │                          + CSP <meta> injected                          │
   │                                                                         │
   │  applyMutations  ────► sanitizeFragment(addOpFragment via <template>)   │
   │                          + sanitizeAttrValue(attrName, val) for ATTR    │
   │                          + textContent= for TEXT (no HTML parse path)   │
   │                                                                         │
   │   counters: { renderStrips, renderUrlBlocks }                           │
   │                              │                                          │
   │                              ▼                                          │
   │   iframe[sandbox="allow-same-origin"]  ◄── asserted at createViewer     │
   │      └─ CSP meta:  default-src 'none'; img-src http: https: data:;      │
   │                    style-src 'unsafe-inline'; font-src http: https: data: │
   └─────────────────────────────────────────────────────────────────────────┘
```

### Recommended Project Structure

```
src/
├── capture/
│   ├── index.js                # existing 1,333-line factory; gains the chokepoint as a named inner function (or imports from sibling sanitize.js — see Claude's Discretion)
│   └── sanitize.js             # OPTIONAL: factored sanitizer helpers if planner picks the sibling-module shape
├── renderer/
│   ├── snapshot.js             # existing srcdoc builder; gains sanitizeFragment + CSP meta + CSS scrub
│   ├── diff.js                 # existing diff applier; replaces div-context parse with template-context, runs sanitizeFragment, scrubs attr values
│   ├── index.js                # existing createViewer (sandbox assertion is already there at L182-186)
│   └── sanitize.js             # OPTIONAL: factored render-side sanitizer (CONTEXT discretion: module layout)
docs/
└── SECURITY.md                 # NEW: embed security contract (REQUIRED by CONTEXT) — threat model, sandbox token contract, masking guarantees, host must-nevers
tests/
├── security-sanitize-capture.test.js     # mXSS + injection corpus run against the capture chokepoint
├── security-sanitize-render.test.js      # mXSS + injection corpus run against the render chokepoint
├── security-mask.test.js                 # blockSelector / maskTextSelector / maskInputs / custom fns across all serialization paths
├── security-chokepoint-purity.test.js    # static scan: serialization paths route through the named chokepoint; allow-scripts never appears in src/renderer
└── differential/
    ├── fixtures/
    │   └── sanitize-corpus.html          # NEW frozen fixture: on*/javascript:/object/embed/CSS scrubs (the load-bearing scenario for the new ledger entry)
    └── scenarios/
        └── sanitize-divergence.js        # NEW scenario tied to the new ledger entry
```

### Pattern 1: Named chokepoint + static-scan purity test (parity with Phase 1)

**What:** One named function each side; a `node:test` static scan asserts every serialization site references it; the test fails if a future PR adds a new serialization path that bypasses the chokepoint.

**When to use:** Whenever the criterion says "through one named chokepoint" (SEC-01 and SEC-02 both do).

**Example:**
```js
// tests/security-chokepoint-purity.test.js — pattern derived from
// tests/capture-purity.test.js (read this session, lines 43-56).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const CAPTURE_SRC = readFileSync(
  fileURLToPath(new URL('../src/capture/index.js', import.meta.url)),
  'utf8'
);

function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

test('every serialization site reaches the wire through sanitizeForWire', () => {
  const code = stripComments(CAPTURE_SRC);
  // Every transport.send call must be preceded (within the same function
  // body) by a sanitizeForWire reference. The simplest enforceable rule:
  // there must be exactly ONE outgoing edge per serialization branch,
  // and it must be the named chokepoint.
  const sendCount = (code.match(/safeSend\(/g) || []).length;
  const chokeCount = (code.match(/sanitizeForWire\(/g) || []).length;
  assert.ok(chokeCount >= sendCount - 1 /* READY ping is data-free */,
    `serialization sites (${sendCount}) exceed sanitizeForWire calls (${chokeCount})`);
});
```
Source: extends pattern from `tests/capture-purity.test.js` (read this session).

### Pattern 2: Template-context fragment parsing (renderer add-op fix)

**What:** Replace `div.innerHTML = m.html; newNode = div.firstElementChild` with a `<template>` element. `template.content` is a `DocumentFragment` that parses in a context that accepts any HTML — `<tr>`, `<td>`, `<col>`, `<option>` no longer drop silently.

**When to use:** In `applyMutations` `DIFF_OP.ADD` branch (renderer/diff.js:100-118), replacing the documented div-context drop counted as a stale-miss.

**Example:**
```js
// Replaces current src/renderer/diff.js:100-118 (read this session).
const tpl = doc.createElement('template');
tpl.innerHTML = m.html;
// 1) RENDER-SIDE CHOKEPOINT: walk + scrub before importing into the live doc.
sanitizeFragment(tpl.content, sanitizeCounters, logger);
const newNode = tpl.content.firstElementChild;
if (!newNode) {
  // Still possible: empty/whitespace-only m.html. Count + warn but
  // distinguish from "context-dependent element parsed away" — the latter
  // no longer happens with template parsing.
  logger.warn('[Renderer] add op dropped: html parsed to no element', {
    parentNid: m.parentNid || '',
  });
  recordStaleMiss(DIFF_OP.ADD, m.parentNid);
  break;
}
// importNode is REQUIRED to move the node from the template's parser doc
// into the live mirror doc — append/insertBefore would adopt cross-doc,
// which jsdom supports but real browsers historically vary on for some
// element types.
const imported = doc.importNode(newNode, true);
parent.insertBefore(imported, m.beforeNid ? selectByNid(m.beforeNid) : null);
```

**Empirical verification this session (jsdom 29.1.1):**
- `<tr data-fsb-nid="7"><td>cell</td></tr>` → `template.content.firstElementChild.tagName === 'TR'` ✓
- `<td>x</td>` → `TD` ✓
- `<col span="2">` → `COL` ✓
- `<option>o</option>` → `OPTION` ✓

Source: bash run inside this session against `node_modules/jsdom@29.1.1`.

### Pattern 3: Capture-side chokepoint shape (blocklist + masking)

**What:** One function, called from each of the five serialization paths, with one entry per content shape (element subtree, attribute name+value, text content, input value, css text).

**When to use:** Every place capture/index.js currently writes to `clone.setAttribute`, `cl.setAttribute`, `el.setAttribute`, `processAddedNode`'s outerHTML return, and the attr/text/childlist diff op constructors.

**Example (sketch):**
```js
// Lives inside createCapture closure (so the masking config from cfg is
// captured) — single name, multiple shapes via a dispatch tag.
function sanitizeForWire(kind, payload) {
  switch (kind) {
    case 'subtree': {
      // payload: { node: Element }   — for serializeDOM + processAddedNode
      // Walks node + descendants via TreeWalker(SHOW_ELEMENT), drops
      // <script>/<noscript>/<object>/<embed> (script already dropped by
      // serializeDOM but consolidate here), strips on*, scrubs URL attrs,
      // scrubs inline style="..." via scrubInlineCss, applies block/mask
      // selectors (see Pattern 6).
      return walkAndScrub(payload.node);
    }
    case 'attr': {
      // payload: { name, value, owner }   — for the attr-op branch
      if (isEventHandlerAttr(payload.name)) {
        counters.strippedHandlers++;
        return { drop: true };
      }
      if (isUrlAttr(payload.name) && hasDangerousScheme(payload.value)) {
        counters.blockedUrlSchemes++;
        return { value: '' };  // neutralize, don't drop the attr (mirror parity for href existence)
      }
      if (payload.name === 'srcdoc') {
        counters.strippedHandlers++;
        return { drop: true };
      }
      if (payload.name === 'style') {
        return { value: scrubInlineCss(payload.value) };
      }
      return { value: payload.value };
    }
    case 'text': {
      // payload: { text, owner }   — for characterData + E2 text-childlist
      // owner is the parent element (or the mutation target for E2).
      if (matchesMaskTextSelector(payload.owner)) {
        counters.maskedTextNodes++;
        return { text: maskTextFn(payload.text, payload.owner) };
      }
      return { text: payload.text };
    }
    case 'inputValue': {
      // payload: { el, value }   — for input value capture (Phase 8 lands
      // CAPT-05 typed-text; current attr-op branch covers value attribute changes)
      if (shouldMaskInput(payload.el)) {
        counters.maskedInputs++;
        return { value: maskInputFn(payload.value, payload.el) };
      }
      return { value: payload.value };
    }
    case 'inlineCss': {
      // payload: { css }  — for head <style> tags collected by serializeDOM
      return { css: scrubInlineCss(payload.css) };
    }
  }
}
```

### Pattern 4: Render-side fragment walker

**What:** `sanitizeFragment(fragment)` runs a TreeWalker `SHOW_ELEMENT` over a DocumentFragment, scrubs every element (drop `<script>`, `<noscript>`, `<object>`, `<embed>`; remove `on*` attrs; clear `javascript:`/`vbscript:`/`data:text/html` in URL attrs incl. `xlink:href`/`formaction`/`src`/`href`/`action`/`poster`/`data`/`srcset`/`srcdoc`; scrub inline `style`). DOM-fragment-based — never serializes back to a string before insertion (no serialize-reparse round-trip → blocks the mXSS class).

**When to use:** In `buildSnapshotHtml` (insertion points 1, 2, 3 from `src/renderer/snapshot.js`'s WR-03 inventory) and in `applyMutations` ADD branch (insertion point 5: add-op fragment).

**Empirical verification this session:** `NodeFilter.SHOW_ELEMENT` walks past `<noscript>` children — `<div><noscript><img src=x onerror=e()></noscript><p>after</p></div>` enumerates `DIV, NOSCRIPT, IMG, P`. The chokepoint must drop `<noscript>` subtrees explicitly (not rely on the walker skipping them). Source: bash run this session.

### Pattern 5: rrweb-compatible masking semantics

**What:**
- **`blockSelector` (string CSS selector):** element matching selector becomes a placeholder with `rr_width: "{Npx}"`, `rr_height: "{Npx}"` attributes preserving the element's `getBoundingClientRect()` width/height; all other attrs and the subtree are dropped [CITED: rrweb-snapshot source, this session]. Adopt the same `rr_width`/`rr_height` attribute names for genuine wire-compat with rrweb tooling and replayers.
- **`maskTextSelector` (string CSS selector):** text content of matching elements and their descendants is transformed via `textContent.replace(/[\S]/g, '*')` — non-whitespace → `*`, whitespace + length preserved [CITED: rrweb-snapshot source, this session].
- **`maskInputs: true`:** all input/textarea/select values masked. Defaults: `false` (only passwords masked).
- **`maskInputOptions: { password: true }` is **always-on** (rrweb default; CONTEXT decision locks this as non-configurable):** `<input type="password">` value never on the wire regardless of other settings.
- **`maskTextFn(text, element) → string` and `maskInputFn(text, element) → string`:** host-provided escape hatches [CITED: rrweb master `packages/rrweb/src/types.ts`].

**Differ interaction (the trap):** A `maskTextSelector`-matched element mutating its text must emit the masked text in the resulting text op (characterData branch + E2 text-childlist branch). A `blockSelector`-matched element mutating anything must emit **no op at all** (subtree dropped from snapshot ⇒ no nid stamped ⇒ no addressing target ⇒ mutations on it are silently dropped already by the existing `if (!parentNid) continue;` guard — but verify the E2 branch and the input-value branch). The `skipElementWithAncestors` predicate (`src/capture/index.js:257-275`) is the exact pattern: blocked elements should use the same ancestor-inclusive form. Verify the differ's existing skip sites already cover blocked subtrees (Pattern 6).

### Pattern 6: Reuse the existing `skipElement` ancestor-inclusive pattern for `blockSelector`

The capture core already has an ancestor-inclusive predicate seam (`skipElementWithAncestors`, `src/capture/index.js:257-275`) plumbed through:
- The serializer's clone-walk skip (`src/capture/index.js:636-646`)
- The differ's element-target skip (`src/capture/index.js:896-902`)
- The differ's added-node element skip (`src/capture/index.js:922`)

`blockSelector` should reuse this exact seam — internally compile the host selector into a predicate and OR it with the host's `skipElement`. This means: the existing host-UI exclusion pinned by `tests/capture-skip.test.js` (read this session) is structurally identical to blockSelector exclusion. Re-use the test pattern verbatim.

### Anti-Patterns to Avoid

- **String-based render-side sanitization (innerHTML scrub + re-parse).** The serialize-reparse round-trip is the canonical mXSS amplifier: parsers mutate during the second parse and the sanitized output is no longer sanitized [CITED: aszx87410.github.io/beyond-xss/en/ch2/mutation-xss/]. Use `<template>` + walker + `importNode`, never `innerHTML = sanitize(html)`.
- **Trusting `Element.attributes` lowercase only.** SVG/XML elements use case-sensitive attr names; namespaced attrs (`xlink:href`) are enumerable but require `namespaceURI` checks [VERIFIED: empirical jsdom run, this session showed `xlink:href` with `namespaceURI === 'http://www.w3.org/1999/xlink'`].
- **Allowlist-based filtering for tags.** REJECTED by CONTEXT (fidelity-first); a misclassified benign tag silently breaks the mirror with no clean health signal.
- **Putting CSP delivery in HTTP headers.** The mirror is rendered via `srcdoc`, never a fetched URL — CSP MUST be delivered via `<meta http-equiv>` inside the srcdoc head [CITED: developer.mozilla.org HTMLIFrameElement srcdoc]. Note: `sandbox`, `frame-ancestors`, and `report-uri` directives are **unsupported via meta** [CITED: content-security-policy.com] — they would be no-ops if specified.
- **Mutating the chokepoint output without re-running it.** Any code path that takes the chokepoint's return value and edits HTML/text/attrs before `transport.send` reopens the surface. The static-scan purity test (Pattern 1) is the only durable defense.
- **Render-side sanitizer running over the srcdoc STRING.** The render-side chokepoint operates on **parsed DocumentFragments**, never the assembled srcdoc string — string-based sanitization is the mXSS vector class. CSS sanitization is the only string-operation pass, and it's a value scrub (regex on `url()`/`expression()`/etc.) not a parser.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| HTML parsing for the render-side add-op chokepoint | A custom mini-parser | Native `<template>` element + `template.content` + `TreeWalker` + `importNode` | Verified context-correct in jsdom 29 this session; real browsers parity-guaranteed |
| URL scheme validation | A regex zoo | One small helper `hasDangerousScheme(s)` checking `^\s*(javascript|vbscript|data:text/html)`, case-insensitive, leading-whitespace tolerant | Centralized; one place to add new schemes |
| CSS parsing | A real CSS parser | Targeted regex scrub: `url\(\s*['"]?(?!https?:|data:image)`, `expression\s*\(`, `-moz-binding`, `@import\s+(?!url\(\s*['"]?https?:)` | CONTEXT decision; zero-dep; documented as a backstop behind the sandbox+CSP |
| The masked-input detector | A field-name heuristic library | `el.type === 'password'` for the always-on rule; `el.matches(cfg.maskInputs ? '*' : 'input[type=password]')` for the configurable rule | jsdom verified `.type` reads correctly per session probe |
| Counters/logging | A telemetry framework | Closure-scope counters object + `logger.warn('[Capture] ...')` / `'[Renderer] ...'`, parity with Phase 2's miss accounting | Project convention; no surface to break |

**Key insight:** This phase has exactly the right shape to NOT hand-roll: native DOM gives us templated parsing + walker + namespace-aware attributes; rrweb's masking is so simple it's a 4-line transform; the project's existing patterns (skipElement seam, counters, ledger entries, static-scan purity tests) cover the structure verbatim. Resist the urge to introduce abstractions — the chokepoint is a function, not a framework.

## Runtime State Inventory

> Phase 3 is greenfield capability addition (sanitization + masking) — no existing string is being renamed, no datastore embeds a sanitization config, no OS state is in play. Skipped by design (rename/refactor-only section).

## Common Pitfalls

### Pitfall 1: The chokepoint becomes the only mention of "sanitize" but not the only writer

**What goes wrong:** A future PR adds a sixth serialization path (e.g., Phase 8 shadow DOM, Phase 4 telemetry payload) that bypasses the chokepoint. Test suite stays green, oracle stays green, mirror leaks unsanitized content.

**Why it happens:** Locality of reasoning: the new branch's author copies a nearby send call that already has chokepoint coverage by construction (because it routes through `processAddedNode`), but the new branch builds its payload differently.

**How to avoid:** **Static-scan purity test (Pattern 1)** — count `safeSend` calls and require ≥ N `sanitizeForWire` references. Cross-reference WR-03's "wire-value insertion-point inventory" comment in `src/renderer/snapshot.js` — Phase 3 should add the analogous comment block to `src/capture/index.js` enumerating the five serialization paths.

**Warning signs:** PR adds a new `safeSend(STREAM.*, ...)` call site. PR adds a new payload shape (input value, shadow root content, telemetry). PR adds a new diff op kind.

### Pitfall 2: jsdom srcdoc never parses → the render-side mXSS test is fake

**What goes wrong:** Tests assert `iframe.contentDocument` after `iframe.srcdoc = sanitize(html)`. jsdom 29 never parses the srcdoc attribute (renderer README "Environment" section, read this session). The test sees an empty document and silently passes.

**Why it happens:** Direct port of a browser-only assertion pattern.

**How to avoid:** Test the chokepoint **directly** (`sanitizeFragment(fragment)` over a fragment created in the test) **separately** from the srcdoc assembly. For end-to-end render verification, use the loopback pattern: `cd.open(); cd.write(iframe.srcdoc); cd.close();` (already established in `tests/renderer-loopback.test.js`).

**Warning signs:** Test imports `JSDOM` and writes `iframe.srcdoc = ...` then immediately queries `iframe.contentDocument`. Should be a code review block.

### Pitfall 3: Sanitization counters reset by snapshot — but the divergence is per-batch

**What goes wrong:** The renderer's existing counters reset on snapshot (`src/renderer/index.js:339-341`). A sanitization counter that resets per-snapshot loses across-stream drop tracking and the loopback demo's health overlay (Phase 3+ option) sees zeros.

**Why it happens:** Copy-paste of the existing counter pattern.

**How to avoid:** Decide explicitly: do sanitization counters live on the same lifecycle as miss-counters (per-snapshot) or on a separate one (per-session)? Recommendation: **per-session** for sanitization, **per-snapshot** for misses — they measure different things. Document in code where they reset.

### Pitfall 4: The mXSS canonical payload survives jsdom round-trip

**What goes wrong:** Test fixture contains `<form><math><mtext></form><form><mglyph><style></math><img src onerror=alert(1)>`; jsdom parses it (verified this session); the sanitizer scrubs `onerror`; the renderer assembles srcdoc; a real-browser viewer re-parses the srcdoc with potentially different mutation, possibly re-introducing the `<img onerror>`.

**Why it happens:** Namespace-confusion mXSS is class-of-bug, not specific-bug — re-parsing in any context risks reordering.

**How to avoid:** **Two independent layers**: (1) capture-side sanitizer scrubs the dangerous attribute regardless of namespace (use `.attributes` enumeration on every element in the walker; `on*` matches case-insensitively across HTML/SVG/MathML namespaces); (2) render-side **DOM-fragment** sanitization (Pattern 4) so the renderer never serializes the parsed DOM back to a string. The CSP meta and sandbox are the third and fourth backstops. Verify the canonical payload reaches the viewer as inert markup, not by trying to predict all the parser permutations.

**Warning signs:** Reviewer asks "why two sanitizers when one would do?" → defense-in-depth across the serialize-reparse boundary is the answer; both layers must scrub.

### Pitfall 5: `setAttribute('on*', ...)` via the differ's attr-op branch bypasses the snapshot sanitizer

**What goes wrong:** Page runs `el.setAttribute('onclick', 'alert(1)')` post-snapshot. The MutationObserver fires `attributes` record (empirically verified this session); the differ's attr-op branch sends `{ op:'attr', nid, attr:'onclick', val:'alert(1)' }`; renderer's diff applier calls `target.setAttribute('onclick', 'alert(1)')`. The sandbox blocks execution but the mirror DOM is now adversarial.

**Why it happens:** The current attr-op branch (`src/capture/index.js:987-1005`) absolutifies URL attrs only — it doesn't filter event handlers.

**How to avoid:** The capture chokepoint MUST cover the attr-op branch (CONTEXT explicit). Drop the attr op entirely (don't send) when `attr` matches `^on/i`; replace value with `''` when URL attr scheme is dangerous; drop entirely for `srcdoc`/`style` (style goes through CSS scrub if kept).

**Warning signs:** Test only covers snapshot-shape input. Must include attr-op-shape inputs (a fixture that mutates `onclick` post-snapshot).

### Pitfall 6: Masking helper throws on a malformed selector → batch loss

**What goes wrong:** Host passes `blockSelector: ':invalid:::syntax'`. `el.matches(selector)` throws `SyntaxError`. The throwing call is inside the serializer's TreeWalker. Snapshot generation aborts; capture wedges.

**Why it happens:** No precedent in the codebase for catching `Element.matches` errors.

**How to avoid:** **Compile selectors once at factory time** with a try/test, fall back to `() => false` with logger.error on invalid selector — same containment as `safeSkipElement` (`src/capture/index.js:286-293`).

**Warning signs:** New code path calls `el.matches(hostProvided)` without a try/catch.

### Pitfall 7: Oracle fixtures stay sanitization-quiet → no ledger entry exercised

**What goes wrong:** Existing fixtures (`tests/differential/fixtures/heavy-realistic.html` etc.) contain no `on*` attrs and no `javascript:` URLs (verified this session: only one `<script>` block, already stripped by both sides). The new ledger entry never matches a divergence → stale-entry detection (oracle.test.js end) fails CI.

**Why it happens:** The deliberate divergence has no scenario to exhibit it.

**How to avoid:** Add `tests/differential/fixtures/sanitize-corpus.html` with the targeted payloads + `tests/differential/scenarios/sanitize-divergence.js`. The reference passes raw `onclick`/`href=javascript:`; the extracted strips them — the divergence is real and the ledger entry's `appliesTo` predicate scopes it to exactly this scenario (mirror D6 discipline). Pattern: `tests/differential/divergence-ledger.js` D6 entry (read this session) for the predicate-and-scenario-guard shape.

**Warning signs:** Adding a `kind: 'mismatch'` entry without simultaneously adding the fixture+scenario that exhibits it.

### Pitfall 8: CSP meta directives that are silently ignored

**What goes wrong:** Locked CSP includes `frame-ancestors` or `sandbox` directive — both are **invalid via meta** [CITED: content-security-policy.com] and will be silently dropped by the parser. Plan-author believes those directives are enforced.

**How to avoid:** The locked policy (CONTEXT) is `default-src 'none'; img-src http: https: data:; style-src 'unsafe-inline'; font-src http: https: data:` — none of these are blocked-via-meta. Document in `docs/SECURITY.md` that `frame-ancestors` and `sandbox` would be no-ops via meta; the iframe-level `sandbox` attribute is the analogous control. Plan should NOT add `report-uri` to the locked policy (also unsupported via meta).

**Warning signs:** Reviewer suggests adding `report-uri` "for telemetry". Reviewer suggests `frame-ancestors` "to prevent embedding". Both are mistakes — the controls exist elsewhere (iframe sandbox attr, embed contract).

### Pitfall 9: `<noscript>` content present in the parsed DOM

**What goes wrong:** Renderer's tree walker assumes browsers' "scripting enabled" parsing semantics, where `<noscript>` is a CDATA-style raw-text container. jsdom 29 parses noscript content as DOM (verified this session: `SHOW_ELEMENT` walker enumerates the `<img>` inside `<noscript>`). Real browsers with scripting enabled treat it as text-only — but the iframe has `sandbox="allow-same-origin"` and **no** `allow-scripts`, which means **scripting is DISABLED** in the iframe, which means real browsers re-parse noscript content as DOM too.

**Why it happens:** Mental model of "scripting on" doesn't match the sandboxed iframe's actual mode.

**How to avoid:** Drop `<noscript>` subtrees explicitly in both chokepoints (capture-side already strips `<noscript>` in `serializeDOM` at `src/capture/index.js:626-629`; the render-side chokepoint must do the same for add-op subtrees).

**Warning signs:** Plan author assumes "the browser will just treat noscript as text inside the sandbox" — wrong for no-allow-scripts sandboxes.

### Pitfall 10: `<input type="password">` value reaching the wire via attr-op

**What goes wrong:** Page calls `passwordEl.setAttribute('value', userInput)`. MutationObserver fires `attributes`. Differ emits `{op:'attr', attr:'value', val:'plaintext'}`. Snapshot path masks; attr-op path doesn't.

**How to avoid:** The attr-op branch's chokepoint call must inspect the target element when the attr is `value` and the element is `input[type=password]` (always) or any input under maskInputs (configurable). The text-childlist branch (E2) does NOT affect inputs (text content is for non-form elements), but the future CAPT-05 Phase 8 input-event capture WILL — note in code that the masking helper is the seam Phase 8 plugs into.

**Warning signs:** Mask tests only cover snapshot serialization; attr-op tests for inputs are absent.

## Code Examples

Verified patterns from official sources and existing project code:

### Template-context parsing replacing div-context drop

```js
// Source: empirical jsdom 29.1.1 run, this session.
// Replaces src/renderer/diff.js:100-118 div-context parse.
const tpl = doc.createElement('template');
tpl.innerHTML = m.html;
sanitizeFragment(tpl.content);  // RENDER CHOKEPOINT
const newNode = tpl.content.firstElementChild;
if (!newNode) {
  recordStaleMiss(DIFF_OP.ADD, m.parentNid);
  break;
}
const imported = doc.importNode(newNode, true);
parent.insertBefore(imported, m.beforeNid ? selectByNid(m.beforeNid) : null);
```

### rrweb-compatible text mask transform

```js
// Source: rrweb-snapshot snapshot.ts (read this session).
// "textContent = maskTextFn ? maskTextFn(textContent, dom.parentElement(n))
//                           : textContent.replace(/[\S]/g, '*');"
function defaultMaskText(text, _el) {
  return String(text).replace(/[\S]/g, '*');
}
```

### rrweb-compatible block placeholder

```js
// Source: rrweb-snapshot snapshot.ts (read this session).
// "const { width, height } = n.getBoundingClientRect();
//  attributes = { class: attributes.class, rr_width: `${width}px`,
//                 rr_height: `${height}px`, };"
function blockedElementSerialization(origEl, cloneEl) {
  const rect = origEl.getBoundingClientRect();
  const placeholder = cloneEl.ownerDocument.createElement('div');
  placeholder.setAttribute('rr_width', rect.width + 'px');
  placeholder.setAttribute('rr_height', rect.height + 'px');
  placeholder.setAttribute(NID_ATTR, assignNodeId(origEl, placeholder));
  // No content; preserves layout dimensions; never carries blocked text.
  return placeholder;
}
```

### CSP meta injection inside buildSnapshotHtml

```js
// Source: CONTEXT decision (locked policy) + content-security-policy.com
// (which directives are honored via meta).
// Inserted as the FIRST <meta> in head so the CSP applies before any
// resource fetch is initiated by the parser.
const CSP_META =
  '<meta http-equiv="Content-Security-Policy" content="'
  + "default-src 'none'; "
  + "img-src http: https: data:; "
  + "style-src 'unsafe-inline'; "
  + "font-src http: https: data:"
  + '">';
// Insertion: src/renderer/snapshot.js buildSnapshotHtml head assembly,
// immediately after '<head>' opening tag.
```

### mXSS test fixture row (capture-side fidelity-pinned)

```js
// Source: pattern derived from tests/capture-skip.test.js (read this session)
// + namespace-confusion vector from securitum.com (read this session).
const mXssCases = [
  {
    name: 'on* attribute on snapshot subtree',
    body: '<button onclick="alert(1)">x</button>',
    assertion: (snapshot) => assert.ok(!/onclick/i.test(snapshot.html)),
  },
  {
    name: 'javascript: in href absolutified path',
    body: '<a href="javascript:alert(1)">x</a>',
    assertion: (s) => assert.ok(!/javascript:/i.test(s.html)),
  },
  {
    name: 'namespace-confusion math/mglyph payload',
    body: '<form><math><mtext></form><form><mglyph><style></math><img src onerror=alert(1)>',
    assertion: (s) => assert.ok(!/onerror/i.test(s.html)),
  },
  {
    name: 'srcdoc attribute on nested iframe',
    body: '<iframe srcdoc="<script>alert(1)</script>"></iframe>',
    assertion: (s) => assert.ok(!/srcdoc/i.test(s.html)),
  },
  {
    name: '<object data=javascript:>',
    body: '<object data="javascript:alert(1)"></object>',
    assertion: (s) => assert.ok(!/<object/i.test(s.html) || !/javascript:/i.test(s.html)),
  },
  {
    name: 'formaction javascript:',
    body: '<form><button formaction="javascript:alert(1)">x</button></form>',
    assertion: (s) => assert.ok(!/javascript:/i.test(s.html)),
  },
  {
    name: 'svg/xlink:href javascript:',
    body: '<svg><a xlink:href="javascript:alert(1)"><text>c</text></a></svg>',
    assertion: (s) => assert.ok(!/javascript:/i.test(s.html)),
  },
  {
    name: 'inline style url() javascript:',
    body: '<div style="background:url(javascript:alert(1))">x</div>',
    assertion: (s) => assert.ok(!/url\(\s*javascript/i.test(s.html)),
  },
  {
    name: 'CSS expression()',
    body: '<div style="width:expression(alert(1))">x</div>',
    assertion: (s) => assert.ok(!/expression\(/i.test(s.html)),
  },
  {
    name: 'CSS -moz-binding',
    body: '<div style="-moz-binding:url(evil.xml#x)">x</div>',
    assertion: (s) => assert.ok(!/-moz-binding/i.test(s.html)),
  },
  {
    name: 'attr-op post-snapshot onclick injection',
    op: (doc) => doc.getElementById('tgt').setAttribute('onclick', 'alert(1)'),
    diffsAssertion: (diffs) => assert.ok(!diffs.some(d => d.op === 'attr' && /^on/i.test(d.attr))),
  },
];
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| String-based HTML sanitization (`sanitize(html) → string` then `el.innerHTML = sanitized`) | DOM-fragment sanitization (`sanitize(fragment) → mutated fragment` then `importNode`) | DOMPurify's `RETURN_DOM` / `RETURN_DOM_FRAGMENT` modes pre-2020; revisited in 2024–25 mXSS research | Closes the serialize-reparse mXSS class entirely [CITED: aszx87410.github.io] |
| `div.innerHTML = m.html` for context-dependent elements | `template.content` with `innerHTML` | HTML5 spec stable since ~2014; jsdom support solid since v16 (2020) | Verified this session in jsdom 29 — `<tr>`, `<td>`, `<col>`, `<option>` all parse correctly |
| CSP delivered only via HTTP header | CSP via `<meta http-equiv>` for srcdoc / static documents | MDN documents the meta form as the only path for srcdoc; spec-permitted since CSP 2 | Three directives remain header-only: `frame-ancestors`, `sandbox`, `report-uri` (irrelevant to our policy) [CITED: content-security-policy.com] |
| Custom-input value masking heuristics | rrweb-style `maskInputOptions: { password: true }` always-on baseline + `maskAllInputs` upgrade + `maskInputFn` escape hatch | rrweb v1.0+ (2020); semantics stable | Interop with rrweb tooling for nothing (Phase 3) and v2 rrweb-format export bridge (FID2-01) |

**Deprecated/outdated:**
- DOMPurify versions before 3.x had several namespace-confusion bypasses (CVE-2020-26870 chain) — not a recommendation against DOMPurify in general, but a reminder that even mature sanitizers have residual mXSS surface, which justifies the defense-in-depth approach for our zero-dep build.
- Older jsdom releases (≤ v19) had `is=` attribute and template parsing issues that newer versions fix; we're on 29.1.1 which is current.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | rrweb's `rr_width`/`rr_height` attribute names are the right "wire-compat" hook for blocked-element dimensions | Pattern 5 | Low: we get to pick names; rrweb compat is nice-to-have, not required by SEC-03; rename later if any consumer cares |
| A2 | CSS-attribute mutation flow (page mutating `el.style.X = Y`) emits an attr-op for `style` whose value is the full inline-style serialization (i.e., the CSS scrub on attr-op covers it) | Pattern 3 | Medium: jsdom's MutationObserver fires `attributes` for `style` writes; needs an explicit test row but the path exists — verify in plan execution by adding a fixture row |
| A3 | The Phase 8 input-event capture (CAPT-05 typed-text) will use the same `maskInputFn` seam introduced here | Pattern 3 / Pitfall 10 | Low: noted as a forward compat hook for Phase 8; Phase 3 doesn't depend on CAPT-05 landing |
| A4 | Render-side CSS sanitization (defense-in-depth) is a duplicate of capture-side CSS scrub, not a stricter pass | Pattern 4 | Low: same regex on both sides is fine and CONTEXT does not lock different policies per side |

## Open Questions

1. **Where should `sanitizeForWire` live — inner function in `createCapture` (single-file precedent like Phase 1) or sibling `src/capture/sanitize.js` (clearer naming, easier static-scan)?**
   - What we know: CONTEXT explicitly leaves "Module layout" to Claude's discretion; chokepoint NAMING is what's required.
   - What's unclear: closure-vs-module tradeoff is a planner judgment call given the static-scan purity test will work either way.
   - Recommendation: **single-file inner function** for parity with Phase 1's deliberate single-file extraction (D-10), unless the planner finds the file is now over a soft size threshold; the static-scan purity test in either case checks call-site coverage of the name.

2. **Does the planner adopt the `<template>` parsing upgrade now (CONTEXT deferred-list says "MAY take it")?**
   - What we know: jsdom 29 verified this session as parsing correctly with `<template>`. The renderer README has it queued for "Phase 3+".
   - What's unclear: scope. Adopting the template upgrade simultaneously gives the render-side sanitizer a much cleaner walker target (DocumentFragment with full element coverage), AND fixes the WR-02 stale-miss counted drop. It's an obviously synergistic pick.
   - Recommendation: **adopt now.** Pair the chokepoint and the parser upgrade in the same plan.

3. **Should counters and ledger entry be one or many?**
   - What we know: parity with D6 = single ledger entry, scenario-pinned. Phase 2 has multiple counters but ONE miss accumulator.
   - Recommendation: ONE ledger entry (sanitization-strip divergence, scoped to the new `sanitize-corpus.html` fixture); multiple counters per strip category for observability (`strippedHandlers`, `blockedUrlSchemes`, `maskedTextNodes`, `maskedInputs`, `blockedSubtrees`, `cssScrubs`).

4. **`<object>`/`<embed>` neutralization rendering — placeholder vs full removal?**
   - What we know: CONTEXT leaves "How `<object>`/`<embed>` neutralization renders viewer-side" to discretion.
   - Recommendation: **drop entirely** (consistent with `<script>`/`<noscript>` reference parity) since these elements are nearly always third-party plugin shells that won't render under sandbox anyway. Document in `docs/SECURITY.md`.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Test runner | ✓ | matches CI matrix 20/22/24 | — |
| jsdom | Capture + renderer tests | ✓ | 29.1.1 (devDep installed) | — |
| Native `<template>` parsing | Render chokepoint | ✓ | verified in jsdom 29.1.1 this session | — |
| `NodeFilter.SHOW_ELEMENT` TreeWalker | Both chokepoints | ✓ | verified in jsdom 29.1.1 this session | — |

No missing dependencies; no fallbacks needed.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | `node:test` + `node:assert/strict` (Node ≥ 20 built-ins) |
| Config file | none (per project convention) |
| Quick run command | `node --test tests/security-*.test.js` |
| Full suite command | `npm test` (= `node --test tests/*.test.js tests/differential/*.test.js`) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SEC-01 | snapshot path strips on*/javascript: across all serialization branches | unit | `node --test tests/security-sanitize-capture.test.js` | ❌ Wave 0 |
| SEC-01 | attr-op branch strips on*/javascript: | unit | same | ❌ Wave 0 |
| SEC-01 | characterData + E2 text-childlist branches pass through sanitizer | unit | same | ❌ Wave 0 |
| SEC-01 | mXSS corpus (≥ 10 vectors incl. namespace confusion) neutralized capture-side | unit | same | ❌ Wave 0 |
| SEC-01 | static-scan purity: every serialization site routes through named chokepoint | static | `node --test tests/security-chokepoint-purity.test.js` | ❌ Wave 0 |
| SEC-02 | render chokepoint scrubs add-op fragments | unit | `node --test tests/security-sanitize-render.test.js` | ❌ Wave 0 |
| SEC-02 | render chokepoint scrubs attr-op values | unit | same | ❌ Wave 0 |
| SEC-02 | mXSS corpus neutralized render-side (defense-in-depth) | unit | same | ❌ Wave 0 |
| SEC-02 | CSP meta present in srcdoc output | unit | `node --test tests/renderer-snapshot.test.js` (extend) | ✓ (extend existing) |
| SEC-02 | sandbox token assertion fires on misconfiguration | unit | `node --test tests/renderer-viewer.test.js` (verify exists) | ✓ (existing) |
| SEC-02 | docs/SECURITY.md exists and documents the contract | static | `node --test tests/security-docs.test.js` (or fold into purity) | ❌ Wave 0 |
| SEC-03 | blockSelector excludes subtree from snapshot + emits placeholder | unit | `node --test tests/security-mask.test.js` | ❌ Wave 0 |
| SEC-03 | blockSelector mutations emit nothing on wire | unit | same | ❌ Wave 0 |
| SEC-03 | maskTextSelector masks text in snapshot + text-op branches | unit | same | ❌ Wave 0 |
| SEC-03 | maskInputs masks input value in snapshot + attr-op | unit | same | ❌ Wave 0 |
| SEC-03 | password input always masked regardless of maskInputs | unit | same | ❌ Wave 0 |
| SEC-03 | custom maskTextFn / maskInputFn invoked with (text, el) signature | unit | same | ❌ Wave 0 |
| SEC-01/02/03 | sanitization-divergence ledger entry matches the new scenario fixture | integration | `node --test tests/differential/oracle.test.js` (extend) | ✓ (extend) |

### Sampling Rate

- **Per task commit:** `node --test tests/security-*.test.js` (sub-second; ~5 files, dozens of cases)
- **Per wave merge:** `npm test` (full suite — Phase 2 has 130/130 today; phase 3 should land additional dozens)
- **Phase gate:** `npm test` green across the CI Node 20/22/24 matrix before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `tests/security-sanitize-capture.test.js` — covers SEC-01 (capture chokepoint behavior + mXSS corpus)
- [ ] `tests/security-sanitize-render.test.js` — covers SEC-02 (render chokepoint behavior + mXSS corpus)
- [ ] `tests/security-mask.test.js` — covers SEC-03 (block/mask/maskInputs/custom fns across all paths)
- [ ] `tests/security-chokepoint-purity.test.js` — static scan asserting both chokepoint names are the only writers
- [ ] `tests/differential/fixtures/sanitize-corpus.html` — load-bearing fixture for the new ledger entry
- [ ] `tests/differential/scenarios/sanitize-divergence.js` — scenario exercising the deliberate divergence
- [ ] Extend `tests/renderer-snapshot.test.js` to assert CSP meta presence in `buildSnapshotHtml` output
- [ ] Extend `tests/differential/divergence-ledger.js` with a new `kind: 'mismatch'` entry scoped to `sanitize-divergence`
- [ ] `docs/SECURITY.md` — required by CONTEXT decision; static scan asserts its presence

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | n/a — phase touches no auth surface |
| V3 Session Management | no | n/a |
| V4 Access Control | partial | the embed contract (host must serve viewer from a controlled origin) is a documented host responsibility; covered in `docs/SECURITY.md` |
| V5 Input Validation | **yes** | The two named chokepoints + DOM-fragment-based render sanitization (Pattern 4) + URL scheme blocklist + CSS targeted-value scrub |
| V6 Cryptography | no | n/a — no crypto in this phase |
| V11 Business Logic | partial | masking guarantees (capture-side only, password-always-masked) are the security contract; documented in SEC-03 |
| V12 Files and Resources | partial | URL attr scheme blocklist (no `javascript:`, `vbscript:`, `data:text/html`); `<object>`/`<embed>` neutralization |
| V14 Configuration | **yes** | Sandbox token assertion (`allow-same-origin` only, never `allow-scripts`), CSP meta policy, fail-loud on misconfig |

### Known Threat Patterns for srcdoc + sandbox + capture-relay-render architecture

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Inline event handlers on captured elements executing in viewer | Tampering / EoP | Capture chokepoint strips `on*`; render chokepoint strips `on*`; sandbox has no `allow-scripts` so even residual handlers can't execute |
| `javascript:` URL navigation | EoP | Capture + render scheme blocklist; sandbox no-allow-scripts; CSP `default-src 'none'` |
| `<iframe srcdoc="...">` nested attacker iframe | Tampering / EoP | `srcdoc` attribute stripped at both chokepoints (CONTEXT) |
| `<object>` / `<embed>` plugin shell | EoP | Neutralized (drop) at both chokepoints |
| Namespace-confusion mXSS (math/mglyph, svg/style) | Tampering | DOM-fragment sanitization (no serialize-reparse round-trip); attribute scrubbing namespace-aware |
| CSS `expression()` / `-moz-binding` legacy script execution | EoP | Regex value scrub at both chokepoints |
| CSS `url(javascript:)` and `@import url(javascript:)` | EoP | URL scheme blocklist applied to CSS values |
| `</style>` raw injection in captured inline CSS breaking out into HTML | Tampering | Capture-side CSS scrub OR render-side parsed-CSS scrub; CSP `default-src 'none'` + sandbox blocks any script from broken-out markup |
| Password value leaking on wire via attr-op or snapshot | Information Disclosure | Always-on password mask (rrweb-parity, non-configurable) |
| Host-marked private regions (PII forms) leaking | Information Disclosure | `blockSelector` (placeholder only) and `maskTextSelector` (char→`*`) applied capture-side in all paths |
| Render-side counter-reset bug hiding a sustained sanitization-strip rate | Repudiation / observability gap | Counters per-session (not per-snapshot) for sanitization (Pitfall 3) |
| Future PR adds a new serialization path that bypasses the chokepoint | Tampering | Static-scan purity test (Pattern 1) — fails CI |

## Sources

### Primary (HIGH confidence)

- `src/capture/index.js` (full read, this session) — every serialization path inventoried; lines 626 (script/noscript drop), 636-646 (skipElement clone-walk), 684-708 (attr scrubbing already in place), 846-873 (processAddedNode), 896-902 (differ ancestor-inclusive skip), 987-1005 (attr-op branch), 1006-1015 (characterData), 904-986 (E2 text-childlist), 449-468 (dialog payload), 1213-1250 (overlay payload)
- `src/renderer/snapshot.js` (full read, this session) — WR-03 5-entry insertion-point inventory comment at lines 19-29; `buildSnapshotHtml` srcdoc assembly
- `src/renderer/diff.js` (full read, this session) — div-context parse drop at 100-118 with the documented `<template>` upgrade queued
- `src/renderer/index.js` (full read, this session) — sandbox token assertion at lines 182-186; iframe srcdoc write at line 346
- `src/renderer/README.md` (full read, this session) — "Behavioral changes queued for Phase 3+" enumeration; environment notes (jsdom srcdoc limitation)
- `src/capture/README.md` (E1/E2 entries grep, this session)
- `tests/differential/divergence-ledger.js` (full read, this session) — D6 entry shape for the new sanitization ledger entry
- `tests/differential/harness.js` (full read, this session) — fixture URL, AMBIENT_GLOBALS, dual-side construction
- `tests/capture-purity.test.js` (full read, this session) — static-scan purity test pattern
- `tests/capture-skip.test.js` (partial read, this session) — skipElement test pattern reusable for blockSelector tests
- `package.json` (full read) + `node_modules/jsdom/package.json` (version probe) — jsdom 29.1.1 confirmed installed
- rrweb source `packages/rrweb-snapshot/src/snapshot.ts` (WebFetch, this session) — default mask `/[\S]/g → '*'` and blocked-element `rr_width`/`rr_height` placeholder
- rrweb `guide.md` (WebFetch, this session) — masking option vocabulary and defaults
- rrweb `types.ts` (WebSearch, this session) — `maskTextFn(text, element)`, `maskInputFn(text, element)` signatures
- **Empirical jsdom 29.1.1 probes this session:** template-context parsing of `<tr>/<td>/<col>/<option>`, TreeWalker `SHOW_ELEMENT` over `<noscript>`, namespace-confusion payload survival, attribute namespace enumeration, password input `.type` detection, MutationObserver attribute records

### Secondary (MEDIUM confidence)

- developer.mozilla.org — HTMLIFrameElement srcdoc behavior, CSP general directives (via WebSearch result summaries)
- content-security-policy.com/examples/meta/ (WebFetch, this session) — meta-tag directive limitations (`frame-ancestors`, `sandbox`, `report-uri` unsupported via meta)
- securitum.com mutation-XSS-via-MathML-mutation article (WebFetch, this session) — namespace-confusion canonical payload
- aszx87410.github.io/beyond-xss/en/ch2/mutation-xss/ (WebFetch, this session) — mXSS class summary, serialize-reparse vector

### Tertiary (LOW confidence)

- Misc WebSearch result summaries on DOMPurify CVE history — used only as context, not load-bearing for the plan

## Metadata

**Confidence breakdown:**
- **Standard stack: HIGH** — every recommended path (native `<template>`, TreeWalker, jsdom devDep) verified by reading source or running probes this session. Zero new packages.
- **Architecture patterns: HIGH** — every named chokepoint, walker, and CSP shape is either a direct read of project source or empirically verified in jsdom 29.1.1 this session.
- **Pitfalls: HIGH** — 10 pitfalls each cite specific source-line reads or empirical results; nothing is hand-waving.
- **rrweb masking semantics: HIGH** — exact source code quoted from rrweb-snapshot master; signatures from types.ts.
- **CSP meta delivery details: MEDIUM-HIGH** — directive support list cited; the specific behavior in `sandbox="allow-same-origin"` srcdoc context is documented industry knowledge but not exercised in our test suite yet (the planned test asserts presence-of-meta, which is sufficient for the criterion).
- **mXSS vector taxonomy: HIGH for the named classes** (namespace confusion, on*, javascript:, srcdoc, object/embed, formaction, xlink:href, CSS expression/url/import); MEDIUM for the long-tail (e.g., new vectors discovered post-2025 are by definition unknown).

**Research date:** 2026-06-11
**Valid until:** 2026-07-11 (30 days — stable security research, jsdom and rrweb both on stable APIs; revisit if jsdom 30 ships or rrweb v3 changes mask defaults)
