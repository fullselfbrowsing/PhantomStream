# Phase 3: Security Pipeline — Sanitization + Privacy Masking - Pattern Map

**Mapped:** 2026-06-11
**Files analyzed:** 20 (6 new source/docs/fixtures, 5 new tests, 9 modified)
**Analogs found:** 17 / 20 (3 capabilities have no codebase analog — see "No Analog Found")

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/capture/index.js` (MODIFY: `sanitizeForWire` chokepoint + masking) | capture core (serializer + differ) | transform → streaming | itself — `absolutifyUrl` call-site threading, `skipElementWithAncestors` seam, `serializeShellAttributes` on*-strip, canvas placeholder swap, `staleFlushCount` counters | exact |
| `src/capture/sanitize.js` (OPTIONAL NEW — planner discretion) | utility (pure helpers) | transform | `src/renderer/snapshot.js` (pure named-export module shape) | role-match |
| `src/renderer/snapshot.js` (MODIFY: CSP meta + CSS scrub + chokepoint feed) | pure builder | transform (payload → srcdoc string) | itself — `buildSnapshotHtml` assembly, `escapeAttribute` value-transform shape, WR-03 inventory comment | exact |
| `src/renderer/diff.js` (MODIFY: template parse + `sanitizeFragment` + attr scrub) | diff applier | event-driven transform | itself — ADD branch div-context parse (the code being replaced), WR-02 warn+count discipline | exact |
| `src/renderer/index.js` (MODIFY: sanitization counter lifecycle) | component factory | request-response over transport | itself — sandbox assertion L176-186, per-snapshot counter reset L337-345 | exact |
| `src/renderer/sanitize.js` (OPTIONAL NEW — planner discretion) | utility (fragment walker) | transform | `src/renderer/diff.js` (doc-parameterized pure function + counters + hooks) | role-match |
| `docs/SECURITY.md` (NEW) | docs | — | `docs/ARCHITECTURE.md` (heading style, `reference/` file pointers) | role-match |
| `README.md` (MODIFY: SECURITY.md pointer) | docs | — | itself — L40 `[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)` pointer style | exact |
| `src/capture/README.md` (MODIFY: new extension entry E3) | module docs | — | itself — entry E2 at L102 (extension-entry format) | exact |
| `src/renderer/README.md` (MODIFY: retire "queued for Phase 3+" items L242-286) | module docs | — | itself | exact |
| `tests/security-sanitize-capture.test.js` (NEW) | test (behavioral, jsdom) | request-response | `tests/capture-skip.test.js` (full env recipe + wire assertions) | exact |
| `tests/security-mask.test.js` (NEW) | test (behavioral, jsdom) | request-response | `tests/capture-skip.test.js` (predicate/selector exclusion tests) | exact |
| `tests/security-sanitize-render.test.js` (NEW) | test (fragment + string) | transform | `tests/renderer-diff.test.js` (doc-based applier tests) + `tests/renderer-snapshot.test.js` (pure string assertions) | exact |
| `tests/security-chokepoint-purity.test.js` (NEW) | test (static scan) | batch (file scan) | `tests/capture-purity.test.js` + `tests/renderer-purity.test.js` | exact |
| `tests/differential/fixtures/sanitize-corpus.html` (NEW) | fixture | — | `tests/differential/fixtures/basic.html` | exact |
| `tests/differential/scenarios/sanitize-divergence.js` (NEW) | scenario | event-driven | `tests/differential/scenarios/text-childlist.js` | exact |
| `tests/differential/divergence-ledger.js` (MODIFY: new mismatch entry) | config/registry | — | itself — D6 entry L147-195 | exact |
| `tests/differential/oracle.test.js` (MODIFY: MATRIX + scenario branch) | test (integration) | batch | itself — MATRIX L43-55, per-scenario branch L268-308, load-bearing test L360-371, stale-entry detection L395-407 | exact |
| `tests/renderer-snapshot.test.js` (MODIFY: CSP meta assertion) | test | transform | itself — charset-meta test L40-44, `minimalPayload` helper L28-38 | exact |
| `tests/renderer-diff.test.js` (MODIFY: re-pin div-context drop test to template semantics) | test | transform | itself — L85 add-op test, L133 WR-02 drop test | exact |

## Pattern Assignments

### `src/capture/index.js` — capture-side chokepoint `sanitizeForWire` + masking (MODIFY)

**Analog: the file's own established seams.** Every pattern the chokepoint needs already exists in this file. The five serialization paths to hook are exactly the existing `absolutifyUrl`/`absolutifySrcset` call sites plus the two text branches:

| Serialization path | Lines | Existing transform already threaded there |
|--------------------|-------|--------------------------------------------|
| snapshot clone walk | 684-707 | `absolutifyUrl` on URL_ATTRS, `getAttributeNS` xlink:href, `absolutifySrcset`, `captureComputedStyles` |
| `processAddedNode` (add-op subtrees) | 846-873 | `absolutifyUrl`/`absolutifySrcset` on node + `querySelectorAll('*')` descendants |
| attr-op branch | 987-1005 | `absolutifyUrl`/`absolutifySrcset` on `attrVal` before `diffs.push` |
| characterData branch | 1006-1016 | none — raw `m.target.textContent` (mask hook site) |
| E2 text-childlist branch | 974-986 | none — raw `m.target.textContent` (mask hook site) |

Side channels: dialog payloads (L447-468, `detail.message` raw) and overlay payloads (L1213-1250). Inline head styles collected at L728-735 (CSS scrub hook).

**Options-seam pattern** (lines 226-242) — masking config (`blockSelector`, `maskTextSelector`, `maskInputs`, `maskTextFn`, `maskInputFn`) joins `cfg` exactly like `skipElement`:

```js
export function createCapture(config) {
  var cfg = config || {};
  var transport = cfg.transport;
  // Factory-time validation is the one place allowed to throw (D-07);
  // everything after start() routes errors to the logger instead.
  if (!transport || typeof transport.send !== 'function') {
    throw new Error('transport-send-required');
  }
  var logger = cfg.logger || { /* console-backed default */ };
  var overlayProvider = cfg.overlayProvider || null;
  var hostSkipElement = (typeof cfg.skipElement === 'function')
    ? cfg.skipElement
    : null;
  var skipElement = hostSkipElement || function () { return false; };
```

**Host-callback containment pattern** (`safeSkipElement`, lines 286-293) — custom mask fns and compiled selectors MUST use this exact containment (RESEARCH Pitfall 6: a throwing `el.matches` inside the serializer wedges the capture):

```js
function safeSkipElement(el) {
  try {
    return skipElement(el);
  } catch (err) {
    logger.error('[DOM Stream] skipElement predicate failed', err);
    return false;
  }
}
```

**Ancestor-inclusive exclusion pattern** (`skipElementWithAncestors`, lines 257-275) — `blockSelector` reuses this seam verbatim (compile selector → predicate, OR with host `skipElement`). Its three differ consumers are L896-902 (mutation-target skip, element + text-node parent forms) and L922 (added-node skip); its serializer consumer is L636-646:

```js
function skipElementWithAncestors(el) {
  if (!hostSkipElement) return false;
  var node = el;
  while (node) {
    try {
      if (hostSkipElement(node)) return true;
    } catch (err) {
      logger.error('[DOM Stream] skipElement predicate failed', err);
      return false;
    }
    node = node.parentElement;
  }
  return false;
}
```

**Existing on*-strip to generalize** (`serializeShellAttributes`, lines 565-576) — the shells-only quirk SEC-01 extends to all paths; the name test `name.indexOf('on') === 0` is the in-repo precedent for handler-attr detection:

```js
function serializeShellAttributes(el) {
  var attrs = {};
  if (!el || !el.attributes) return attrs;
  for (var i = 0; i < el.attributes.length; i++) {
    var attr = el.attributes[i];
    if (!attr || !attr.name) continue;
    var name = String(attr.name).toLowerCase();
    if (name === 'style' || name.indexOf('on') === 0) continue;
    attrs[name] = String(attr.value || '');
  }
  return attrs;
}
```

**Placeholder-swap pattern for `blockSelector`** (canvas-to-img conversion, lines 666-682) — the only existing "replace a clone element with a substitute that keeps the nid" code; the rr_width/rr_height placeholder div follows this exact shape (create in `clone.ownerDocument`, stamp `NID_ATTR`, `replaceChild` on `cl.parentNode`):

```js
if (tag === 'canvas') {
  try {
    var dataUrl = orig.toDataURL('image/png');
    var img = clone.ownerDocument.createElement('img');
    img.src = dataUrl;
    img.setAttribute(NID_ATTR, nid);
    img.setAttribute('style', 'width:' + (orig.width || 300) + 'px;height:' + (orig.height || 150) + 'px;');
    if (cl.parentNode) {
      cl.parentNode.replaceChild(img, cl);
    }
  } catch (e) {
    cl.setAttribute(NID_ATTR, nid);
  }
  continue;
}
```

Note one divergence from this analog: rrweb `blockSelector` semantics use `getBoundingClientRect()` on the ORIGINAL element (single-pass layout-read discipline applies — the snapshot already does a batched rect pre-pass at L747-769; do not add per-element rect reads after clone mutation begins).

**Closure counter pattern** (`staleFlushCount`, lines 344, 1039, 1095) — sanitization counters (`strippedHandlers`, `blockedUrlSchemes`, `maskedTextNodes`, `maskedInputs`, `blockedSubtrees`, `cssScrubs`) live as closure state the same way; the existing counter is stamped onto an outgoing payload at L1039 and incremented-before-use at L1095.

**Pure-value-transform helper shape** (`absolutifyUrl`, lines 482-491) — `hasDangerousScheme`/`scrubInlineCss` follow this shape (string in, string out, early-return guards, try/catch to identity). Note L483: `javascript:` currently passes through by explicit Phase-3 deferral comment — that comment (and the header comment at L30-35) must be updated when the chokepoint lands.

**Inventory-comment discipline:** mirror `src/renderer/snapshot.js` lines 18-28 (WR-03 wire-value insertion-point inventory) — add the analogous five-path serialization inventory comment to `src/capture/index.js` so the purity test has a documented ground truth (RESEARCH Pitfall 1).

---

### `src/renderer/snapshot.js` — CSP meta + CSS scrub + render chokepoint feed (MODIFY)

**Analog: itself.** `buildSnapshotHtml` (lines 89-109) is the assembly to interpose. Current shape:

```js
export function buildSnapshotHtml(payload) {
  var p = payload || {};

  var stylesheetLinks = (p.stylesheets || []).map(function (url) {
    return '<link rel="stylesheet" href="' + url.replace(/"/g, '&quot;') + '">';
  }).join('\n');

  var inlineStyleTags = (p.inlineStyles || []).map(function (css) {
    return '<style>' + css + '</style>';      // <- RAW: CSS scrub hook (insertion point 1)
  }).join('\n');

  var htmlAttrs = buildShellAttributeString(p.htmlAttrs, p.htmlStyle);
  var bodyAttrs = buildShellAttributeString(p.bodyAttrs, p.bodyStyle);

  return '<!DOCTYPE html><html' + htmlAttrs + '><head><meta charset="UTF-8">' +   // <- CSP meta goes immediately after <head> open, FIRST meta
    '<meta name="viewport" content="width=' + (parseInt(p.viewportWidth, 10) || 1920) + '">' +
    stylesheetLinks +
    inlineStyleTags +
    '<style>body { margin: 0; overflow: hidden; } *::selection { background: transparent; } ::-webkit-scrollbar { display: none; }</style>' +
    '</head><body' + bodyAttrs + '>' + (p.html || '') + '</body></html>';        // <- p.html RAW (insertion point 2: render chokepoint feed)
}
```

The WR-03 inventory comment (lines 18-28) enumerates exactly which insertion points the chokepoint must cover (1. inlineStyles RAW, 2. payload.html RAW, 3. stylesheet hrefs quote-escaped, 4. shell attrs fully escaped, 5. viewportWidth coerced). Keep this comment ACCURATE — update entries 1 and 2 when sanitization interposes; the comment explicitly says Phase 3 audits against it.

**Pure value-helper shape to copy** (`escapeAttribute`, lines 40-46) — render-side `scrubCssValue`/`sanitizeAttrValue` helpers match this shape (exported pure function, JSDoc, null-tolerant):

```js
export function escapeAttribute(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
```

CSP meta is a string constant assembled like the reset-CSS literal on line 107 (locked policy from CONTEXT: `default-src 'none'; img-src http: https: data:; style-src 'unsafe-inline'; font-src http: https: data:`).

IMPORTANT constraint from the module header (lines 1-8): this file is a **pure transform — no DOM access**. The DOM-fragment chokepoint (`sanitizeFragment`) therefore CANNOT live here; string-level passes only (CSP meta injection, CSS value scrub). Fragment walking belongs in diff.js or a sibling `sanitize.js` that receives a Document/fragment from the caller.

---

### `src/renderer/diff.js` — template-context parse + `sanitizeFragment` + attr-op scrub (MODIFY)

**Analog: itself.** The code being replaced is the ADD branch (lines 94-126):

```js
case DIFF_OP.ADD: {
  var parent = selectByNid(m.parentNid);
  if (!parent) {
    recordStaleMiss(DIFF_OP.ADD, m.parentNid);
    break;
  }
  var temp = doc.createElement('div');
  temp.innerHTML = m.html;
  var newNode = temp.firstElementChild;
  if (!newNode) {
    // div-context innerHTML parsing DROPS context-dependent
    // elements (<tr>, <td>, <tbody>, <col>, ...) ... Never silent (review WR-02): warn
    // with the real cause, then count the drop through the stale-miss path ...
    logger.warn('[Renderer] add op dropped: html parsed to no element in div context', {
      parentNid: m.parentNid || ''
    });
    recordStaleMiss(DIFF_OP.ADD, m.parentNid);
    break;
  }
  if (m.beforeNid) {
    var before = selectByNid(m.beforeNid);
    parent.insertBefore(newNode, before); // null before == appendChild
  } else {
    parent.appendChild(newNode);
  }
  break;
}
```

Replace with template-context parse + chokepoint + `importNode` (RESEARCH Pattern 2, jsdom-29-verified). Keep the WR-02 discipline: warn with the REAL cause + count through `recordStaleMiss` — the warn message changes ("html parsed to no element", no longer "in div context") because the failure class changes.

**ATTR branch hook site** (lines 136-147): `target.setAttribute(m.attr, m.val)` is RESEARCH Pitfall 5's bypass — the render-side attr scrub (drop `on*`/`srcdoc`, neutralize dangerous URL schemes, scrub `style`) interposes before the `setAttribute`. TEXT branch (lines 149-157) uses `textContent =` — no HTML parse path, no scrub needed.

**Counter + hooks plumbing pattern** (lines 60-88): `applyMutations(doc, mutations, counters, hooks)` — render sanitization counters either join `DiffCounters` or ride a parallel object; the `hooks.logger` guard shape (lines 62-67) is the defaulting pattern for any new injected hook. Per-op try/catch containment (lines 159-175) means a throwing sanitize call is already contained per-op — keep the chokepoint INSIDE the per-op try.

---

### `src/renderer/index.js` — sanitization counter lifecycle (MODIFY)

**Analog: itself.** The sandbox assertion the docs/tests reference (lines 176-186) — already implemented, do not touch, cite in SECURITY.md:

```js
iframe.setAttribute('sandbox', 'allow-same-origin');
var sandboxTokens = (iframe.getAttribute('sandbox') || '').trim().split(/\s+/);
if (sandboxTokens.length !== 1 || sandboxTokens[0] !== 'allow-same-origin') {
  throw new Error('viewer-sandbox-invalid');
}
```

**Counter-reset trap** (RESEARCH Pitfall 3) — the existing per-snapshot reset in `handleSnapshot` (lines 337-345):

```js
active.streamSessionId = p.streamSessionId || '';
active.snapshotId = p.snapshotId || 0;
counters.staleMisses = 0;
counters.applyFailures = 0;
resyncPending = false; // the latch's ONLY release site
...
iframe.srcdoc = buildSnapshotHtml(p);    // line 346: the srcdoc write the CSP meta rides through
```

Sanitization counters must NOT join this reset — RESEARCH recommends per-session lifecycle (reset in `destroy()` L502-514, not in `handleSnapshot`). Document the lifecycle choice in a comment at the declaration site (closure state block, lines 221-230).

---

### `tests/security-sanitize-capture.test.js` + `tests/security-mask.test.js` (NEW)

**Analog:** `tests/capture-skip.test.js` — copy the whole local-harness recipe (the file's header comment says the duplication is deliberate: parallel-safe, no shared test harness).

**Env recipe** (lines 30-34, 53-98): `AUDITED_GLOBALS` list, `setupEnv(bodyHtml)` with `pretendToBeVisual: true` + `VirtualConsole`, prior-globals Map restore, teardown that stops capture FIRST (watchdog chain) then restores globals then `w.close()`. **Settle cadence** (lines 105-109):

```js
async function settle(win) {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => win.requestAnimationFrame(resolve));
  await new Promise((resolve) => setTimeout(resolve, 20));
}
```

**Loopback transport + wire assertions** (lines 114-120, 140-148): `createLoopbackTransport()` records `{type, payload}` pairs; snapshot assertions filter `STREAM.SNAPSHOT` and string-test `payload.html`:

```js
const snapshots = transport.sent.filter((m) => m.type === STREAM.SNAPSHOT);
assert.equal(snapshots.length, 1, 'start() emits exactly one snapshot');
const html = snapshots[0].payload.html;
assert.ok(!html.includes('host-overlay'), 'snapshot omits the skipped subtree root');
```

mXSS-corpus assertions are this exact shape with hostile fixtures (`assert.ok(!/onclick/i.test(html))` etc., per RESEARCH Code Examples). Diff-path assertions (attr-op `onclick` injection, masked text ops) follow the mutation test at lines 167-209: mutate live DOM → `await settle` → filter `STREAM.MUTATIONS` → inspect `payload.mutations` ops. blockSelector tests are structurally identical to the three existing skip tests (root-only exclusion + no-nid stamping at lines 126-165; suppressed mutations at 167-209; throwing predicate containment at 211-266 — reuse for throwing custom mask fns).

---

### `tests/security-sanitize-render.test.js` (NEW)

**Analogs:** `tests/renderer-diff.test.js` for fragment/doc-based tests (its `setupEnv()` mints a JSDOM doc, `recordingHooks()` captures warns, `freshCounters()` per test, `nidEl(tag, nid, inner)` builds addressed targets — lines 24-83); `tests/renderer-snapshot.test.js` for pure string tests of `buildSnapshotHtml` (no JSDOM, `minimalPayload(overrides)` helper at lines 28-38).

CRITICAL (RESEARCH Pitfall 2): never assert via `iframe.srcdoc` + `contentDocument` — jsdom never parses srcdoc. Test `sanitizeFragment` directly on a fragment created in the test; e2e goes through the loopback pattern in `tests/renderer-loopback.test.js` (`cd.open(); cd.write(iframe.srcdoc); cd.close();`).

Also MODIFY `tests/renderer-diff.test.js`: the test at line 85 ("'add' op inserts the html's firstElementChild under the parent via temp-div innerHTML") and the WR-02 pin at line 133 ("an 'add' whose html parses to no element in the div context warns and counts a stale miss") pin the OLD div-context behavior — the template upgrade flips line 133's `<tr>` case from drop-to-miss into a successful insert; re-pin both.

---

### `tests/security-chokepoint-purity.test.js` (NEW)

**Analogs:** `tests/capture-purity.test.js` (lines 25-56) and `tests/renderer-purity.test.js` (lines 57-90). Copy the `stripComments` helper + per-file scan loop verbatim:

```js
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

test('capture core contains zero chrome.* and window.FSB references', () => {
  for (const f of listCaptureModules()) {
    const source = readFileSync(path.join(CAPTURE_DIR, f), 'utf8');
    const stripped = stripComments(source);
    assert.ok(
      !/\bchrome\s*\./.test(stripped),
      `src/capture/${f} references chrome.* outside comments`
    );
    ...
```

The chokepoint-coverage rule: count `safeSend(` references vs `sanitizeForWire(` references in the stripped capture source (RESEARCH Pattern 1 sketch); plus assert `allow-scripts` never appears in `src/renderer/*.js`. The renderer-purity vacuous-pass guard (lines 39-55: "exists with the planned module split") is the pattern for asserting `docs/SECURITY.md` exists. NOTE: if the planner adds `src/renderer/sanitize.js` or `src/capture/sanitize.js`, the existing purity scans pick the new file up automatically (they scan all `.js` in the dir) — the new module must obey the same forbidden-pattern rules; `tests/renderer-purity.test.js` line 48's required-module pin (`['index.js', 'snapshot.js', 'diff.js', 'overlays.js']`) tolerates additions but should be extended to pin the new module if one is created.

---

### `tests/differential/fixtures/sanitize-corpus.html` (NEW)

**Analog:** `tests/differential/fixtures/basic.html` — full-document fixture with `id`-addressed elements, an inline `<style>` in head, a form with an input. The corpus fixture follows the same shape with hostile content (`on*` attrs, `javascript:` href, `<object>`, srcdoc iframe, CSS `expression()`, namespace-confusion payload) and id-addressed targets the scenario can mutate (`tgt.setAttribute('onclick', ...)` for the attr-op row, per RESEARCH Pitfall 5).

### `tests/differential/scenarios/sanitize-divergence.js` (NEW)

**Analog:** `tests/differential/scenarios/text-childlist.js` (29 lines, read in full) — exact module contract to copy: `export const name`, `export async function run(side, settle)`, header comment explaining why THIS scenario is what keeps the ledger entry real and pinned:

```js
export const name = 'text-childlist';

export async function run(side, settle) {
  const { document } = side;
  document.getElementById('intro').textContent = 'Replaced intro text.';
  await settle(side.window);
}
```

The sanitize scenario drives post-snapshot hostile mutations (e.g. `setAttribute('onclick', ...)`) so the attr-op path divergence is exercised, not just the snapshot path.

### `tests/differential/divergence-ledger.js` (MODIFY — new entry, e.g. `D7-capture-sanitization`)

**Analog:** the D6 entry (lines 147-195) — copy its full discipline: scenario guard FIRST and load-bearing, then exact-shape predicate, `kind: 'mismatch'`, prose `description` citing reference line behavior, `rationale` citing the CONTEXT decision:

```js
{
  id: 'D6-text-childlist-fidelity-fix',
  kind: 'mismatch',
  description: 'The reference childList branch ... emits NO wire signal ...',
  rationale: 'Deliberate fidelity FIX divergence (Phase 2): ... Pinned end-to-end by ... the text-childlist scenario here.',
  affectedMessages: [STREAM.MUTATIONS],
  affectedScenarios: ['text-childlist'],
  appliesTo(refMsg, extMsg, scenarioName) {
    // The scenario guard is load-bearing (same discipline as D1): a bare
    // text-node childList divergence surfacing in any OTHER scenario must
    // still hard-fail as UNDECLARED DIVERGENCE.
    if (scenarioName !== 'text-childlist') return false;

    // D6's exact shape: an EXTRACTED-ONLY trailing message ... that is a
    // MUTATIONS batch composed PURELY of text ops.
    if (refMsg !== undefined || extMsg === undefined) return false;
    if (extMsg.type !== STREAM.MUTATIONS) return false;
    const ops = (extMsg.payload && extMsg.payload.mutations) || [];
    return Array.isArray(ops)
      && ops.length > 0
      && ops.every((op) => op.op === DIFF_OP.TEXT);
  },
},
```

The new entry's shape differs (reference passes raw `onclick`/`javascript:` content where the extracted side strips → SNAPSHOT html payload mismatch and/or attr-op value/presence mismatch at the SAME index, not a trailing message) — scope the predicate to exactly those shapes within `scenarioName === 'sanitize-divergence'`.

### `tests/differential/oracle.test.js` (MODIFY)

**Analog: itself.** Four touch points, all read this session:

1. Scenario import block (lines 27-34) + MATRIX entry (lines 43-55): `{ fixture: 'sanitize-corpus.html', scenario: sanitizeDivergence, config: {} }`.
2. The flipped-loop per-scenario branch (lines 268-308): add a `sanitize-divergence` branch asserting `matched.has('D7-...')` plus belt-and-braces direction checks (the reference stream really CARRIES the hostile content; the extracted stream really LACKS it), mirroring the D6 branch at lines 268-299.
3. The else-branch zero-consultation assertion (lines 300-308) currently reads "no ledger consultation outside pause-resume/text-childlist" — the new scenario name must join that exclusion.
4. A load-bearing empty-ledger test mirroring lines 360-371 ("text-childlist with an EMPTY ledger throws UNDECLARED DIVERGENCE — D6 is load-bearing, not decorative"). Stale-entry detection (lines 395-407) then enforces the new entry matches every run — no test change needed there, but it is WHY the fixture+scenario must actually exhibit the divergence (RESEARCH Pitfall 7).

NOTE: the ref-vs-ref Mode-1 loop (lines 112-124) runs the new MATRIX entry automatically — both reference sides pass raw content identically, so it compares clean by construction.

### `tests/renderer-snapshot.test.js` (MODIFY — CSP meta assertion)

**Analog: itself** — copy the charset-meta test shape (lines 40-44):

```js
test('output starts with the doctype+html shell and contains the charset meta', () => {
  const html = buildSnapshotHtml(minimalPayload());
  assert.ok(html.startsWith('<!DOCTYPE html><html'), 'starts with <!DOCTYPE html><html');
  assert.ok(html.includes('<meta charset="UTF-8">'), 'contains the charset meta');
});
```

Also UPDATE the two raw-insertion parity pins that Phase 3 deliberately breaks: line 104 ("inlineStyles are wrapped raw — a `</style>` inside CSS passes through unmodified") and line 113 ("payload.html is inserted raw between the body tags") — both carry "Phase 3 owns sanitization" comments marking them for replacement.

### `docs/SECURITY.md` (NEW) + `README.md` + module READMEs (MODIFY)

**Style analog:** `docs/ARCHITECTURE.md` (lines 1-27 read) — H1 title, short framing paragraph with file references, numbered H2 sections. Content has no codebase analog (threat model, sandbox token contract, host must-nevers, masking guarantees, CSP rationale incl. the meta-unsupported directives note from RESEARCH Pitfall 8 — all from CONTEXT/RESEARCH).

README pointer analog: `README.md` line 40 (`see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full treatment`) and the `docs/` tree listing at line 73.

`src/capture/README.md`: new extension entry follows E2's format (heading `- **E2 (Phase 2, fidelity fix)** — ...` at line 102; E1 at line 90); also update the "Behavioral changes queued for the standalone version" section (line 121). `src/renderer/README.md`: retire the four "Behavioral changes queued for Phase 3+" items (lines 242-286: raw inline-style insertion, on* survival, div-context parsing, embed contract docs).

## Shared Patterns

### Host-callback error containment
**Source:** `src/capture/index.js:286-293` (`safeSkipElement`), `:257-275` (ancestor walk catch)
**Apply to:** custom `maskTextFn`/`maskInputFn` invocations, compiled `blockSelector`/`maskTextSelector` `el.matches` calls (compile ONCE at factory time; invalid selector → `logger.error` + `() => false` fallback, per RESEARCH Pitfall 6). Factory-time validation is the ONLY throwing site (`throw new Error('transport-send-required')` precedent, L230-232) — selector compilation failure should log-and-degrade, not throw, since masking must fail closed but capture must not wedge. If the planner prefers fail-loud for a misconfigured `blockSelector` (security-relevant), the factory-throw precedent covers that too — decide explicitly and document.

### Counted + logged observability (never silent)
**Source:** `src/renderer/diff.js:78-88` (`recordStaleMiss`: increment + structured warn + threshold), `src/capture/index.js:1090-1101` (`staleFlushCount` increment-before-flush)
**Apply to:** every strip/mask/scrub site on both sides. Logger prefixes: `'[DOM Stream]'` capture-side, `'[Renderer]'` render-side. Warn payloads are structured objects (`{ op, nid, staleMisses }` shape), error strings lowercase-hyphenated:

```js
function recordStaleMiss(op, nid) {
  tallies.staleMisses += 1;
  logger.warn('[Renderer] stale mutation: no element for nid', {
    op: op,
    nid: nid || '',
    staleMisses: tallies.staleMisses
  });
  if (tallies.staleMisses >= 3) {
    requestResync('stale-mutation-parent', { op: op, nid: nid || '' });
  }
}
```

### Static-scan purity discipline
**Source:** `tests/capture-purity.test.js:25-32` (`stripComments`), `tests/renderer-purity.test.js:57-90` (multi-pattern forbidden scan with explanatory assert messages)
**Apply to:** `tests/security-chokepoint-purity.test.js`. Comments stripped before scanning so provenance notes stay legal; string literals NOT stripped. Include a vacuous-pass guard (the "core exists" test pattern) so an empty scan can never pass silently.

### Ledger + scenario + load-bearing-test triple
**Source:** `tests/differential/divergence-ledger.js:147-195` (D6) + `tests/differential/scenarios/text-childlist.js` + `tests/differential/oracle.test.js:268-299,360-371,395-407`
**Apply to:** the sanitization divergence. The three pieces land TOGETHER or stale-entry detection fails CI (RESEARCH Pitfall 7). Predicate claims the exact divergence shape, never "any mismatch in this scenario".

### jsdom capture-test env recipe
**Source:** `tests/capture-skip.test.js:30-120` (AUDITED_GLOBALS / setupEnv / settle / loopback transport / silentLogger / try-finally teardown)
**Apply to:** `tests/security-sanitize-capture.test.js`, `tests/security-mask.test.js`. Duplicate locally per file (deliberate, parallel-safe — stated in the analog's header).

### Cross-runtime `src/` code style
**Source:** `src/capture/index.js` + `src/renderer/index.js` headers (explicit style statement at renderer index L33-35)
**Apply to:** all new/modified `src/` code: `var` declarations, `||` inline defaulting, function expressions, named exports only, explicit `.js` import extensions, JSDoc with `@param`/`@returns`, numeric literals commented with units/derivation, decision/phase references in comments.

## No Analog Found

Files/capabilities with no close match in the codebase (use RESEARCH.md patterns instead):

| Capability | Role | Data Flow | Reason / Fallback |
|------------|------|-----------|-------------------|
| CSS value scrub (`scrubInlineCss`) | utility | transform | No CSS-parsing/scrubbing code exists anywhere in `src/` (`collectComputedStyleText` only GENERATES css text). Use RESEARCH "Don't Hand-Roll" regex recipe: `url\(\s*['"]?(?!https?:|data:image)`, `expression\s*\(`, `-moz-binding`, `@import` scheme check. Shape it like `absolutifyUrl` (pure, guarded, exception-to-identity). |
| rrweb mask transforms (`defaultMaskText`, block placeholder semantics) | utility | transform | No masking code exists. Use RESEARCH Code Examples (rrweb-cited): `text.replace(/[\S]/g, '*')`; `rr_width`/`rr_height` placeholder attrs; `el.type === 'password'` always-on rule. |
| Render-side DOM-fragment walker (`sanitizeFragment` with `<template>` + TreeWalker + `importNode`) | utility | transform | No fragment-walking code exists render-side (capture's TreeWalker at `src/capture/index.js:596-615` is the nearest structural cousin — parallel-walk pattern, `NodeFilter.SHOW_ELEMENT`). Use RESEARCH Pattern 2/4 (jsdom-29-verified this session); remember the `<noscript>` explicit-drop (Pitfall 9) and never serialize-reparse (anti-pattern list). |

## Metadata

**Analog search scope:** `src/capture/`, `src/renderer/`, `src/protocol/` (via imports), `tests/`, `tests/differential/` (+ fixtures/scenarios), `docs/`, `README.md`
**Files read this session:** 13 full reads + 3 targeted greps (capture/index.js 1333L, renderer snapshot/diff/index, divergence-ledger, oracle.test, capture-skip/capture-purity/renderer-purity/renderer-snapshot tests, text-childlist scenario, basic.html fixture, ARCHITECTURE.md header)
**Pattern extraction date:** 2026-06-11
**Key planner notes:**
- The `<template>` upgrade should be taken this phase (RESEARCH Open Question 2 recommendation: adopt — it IS the render chokepoint's walker target) and it flips two pinned tests in `tests/renderer-diff.test.js` (L85, L133).
- Chokepoint placement (inner function vs sibling module) is discretionary; RESEARCH recommends single-file inner function for `sanitizeForWire` (closure access to masking cfg + counters), which the static-scan purity test supports either way.
- `src/renderer/snapshot.js` must stay DOM-free (module contract) — only string-level passes can land there.
- Sanitization counters: per-session lifecycle (NOT the per-snapshot reset at `src/renderer/index.js:339-341`) — document where they reset.
