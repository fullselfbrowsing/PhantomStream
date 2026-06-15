# Phase 08: Shadow DOM, Iframes & Fidelity Completion - Pattern Map

**Mapped:** 2026-06-15
**Files analyzed:** 30 new/modified files
**Analogs found:** 30 / 30

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/protocol/messages.js` | config | streaming, request-response | `src/protocol/messages.js` | exact |
| `src/capture/index.js` | service | streaming, event-driven, transform | `src/capture/index.js` | exact |
| `src/renderer/index.js` | component/provider | streaming, event-driven, request-response | `src/renderer/index.js` | exact |
| `src/renderer/diff.js` | utility | event-driven, transform | `src/renderer/diff.js` | exact |
| `src/renderer/snapshot.js` | utility | transform | `src/renderer/snapshot.js` | exact |
| `src/renderer/sanitize.js` | utility | transform | `src/renderer/sanitize.js` | exact |
| `src/adapters/playwright-inject.js` | adapter | batch, request-response | `tests/playwright-adapter.test.js` | role-match |
| `src/capture/README.md` | docs | transform | `src/capture/README.md` | exact |
| `src/renderer/README.md` | docs | transform | `src/renderer/README.md` | exact |
| `docs/ARCHITECTURE.md` | docs | transform | `docs/ARCHITECTURE.md` | exact |
| `docs/SECURITY.md` | docs | transform | `docs/SECURITY.md` | exact |
| `docs/DESIGN-HISTORY.md` | docs | transform | `docs/DESIGN-HISTORY.md` | exact |
| `tests/capture-shadow-dom.test.js` | test | streaming, event-driven, transform | `tests/capture-identity.test.js` | role-match |
| `tests/renderer-shadow-dom.test.js` | test | event-driven, transform | `tests/renderer-diff.test.js` | role-match |
| `tests/capture-iframe.test.js` | test | transform, request-response | `tests/security-sanitize-capture.test.js` | role-match |
| `tests/renderer-iframe.test.js` | test | transform, request-response | `tests/security-sanitize-render.test.js` | role-match |
| `tests/capture-input-values.test.js` | test | event-driven, streaming | `tests/security-mask.test.js` | role-match |
| `tests/renderer-value-diff.test.js` | test | event-driven, transform | `tests/renderer-diff.test.js` | role-match |
| `tests/capture-added-styles.test.js` | test | event-driven, transform | `tests/security-sanitize-capture.test.js` | role-match |
| `tests/capture-subtree-fetch.test.js` | test | request-response, transform | `tests/capture-identity.test.js` | role-match |
| `tests/renderer-subtree-fetch.test.js` | test | request-response, event-driven | `tests/renderer-loopback.test.js` | role-match |
| `tests/playwright-fidelity-phase8.test.js` | test | event-driven, request-response | `tests/playwright-adapter.test.js` | role-match |
| `tests/security-mask.test.js` | test | event-driven, streaming | `tests/security-mask.test.js` | exact |
| `tests/security-sanitize-capture.test.js` | test | transform, streaming | `tests/security-sanitize-capture.test.js` | exact |
| `tests/security-sanitize-render.test.js` | test | transform, event-driven | `tests/security-sanitize-render.test.js` | exact |
| `tests/security-chokepoint-purity.test.js` | test | transform, static | `tests/security-chokepoint-purity.test.js` | exact |
| `tests/node-identity-static.test.js` | test | static | `tests/node-identity-static.test.js` | exact |
| `tests/differential/normalize.js` | utility | transform | `tests/differential/normalize.js` | exact |
| `tests/differential/divergence-ledger.js` | config | transform | `tests/differential/divergence-ledger.js` | exact |
| `tests/differential/oracle.test.js` | test | batch, transform | `tests/differential/oracle.test.js` | exact |

## Pattern Assignments

### `src/protocol/messages.js` (config, streaming/request-response)

**Analog:** `src/protocol/messages.js`

**Copy namespace and op-code style** (lines 6-66):

```js
/** Viewer -> capture host: stream lifecycle control. */
export const CONTROL = {
  START: 'dash:dom-stream-start',
  STOP: 'dash:dom-stream-stop',
  PAUSE: 'dash:dom-stream-pause',
  RESUME: 'dash:dom-stream-resume',
};

/** Capture host -> viewer: stream data and side channels. */
export const STREAM = {
  SNAPSHOT: 'ext:dom-snapshot',
  MUTATIONS: 'ext:dom-mutations',
  SCROLL: 'ext:dom-scroll',
  OVERLAY: 'ext:dom-overlay',
  DIALOG: 'ext:dom-dialog',
  READY: 'ext:dom-ready',
  REQUEST_SNAPSHOT: 'ext:request-snapshot',
  STATE: 'ext:stream-state',
};

/** Diff op codes carried in STREAM.MUTATIONS payloads. */
export const DIFF_OP = {
  ADD: 'add',
  REMOVE: 'rm',
  ATTR: 'attr',
  TEXT: 'text',
};
```

**Copy staleness guard pattern** (lines 128-148):

```js
export function isCurrentStream(msg, active) {
  if (!msg) return false;
  if (msg.streamSessionId && active.streamSessionId &&
      msg.streamSessionId !== active.streamSessionId) {
    return false;
  }
  if (msg.snapshotId && active.snapshotId &&
      msg.snapshotId !== active.snapshotId) {
    return false;
  }
  return true;
}
```

**Apply to Phase 8:** add shadow/frame/value/subtree typedefs next to existing JSDoc. If subtree recovery uses a viewer request, add a `CONTROL.*` constant and a `STREAM.*` response constant without changing relay semantics.

---

### `src/capture/index.js` (service, streaming/event-driven/transform)

**Analog:** `src/capture/index.js`

**Imports pattern** (lines 42-52):

```js
import {
  RELAY_PER_MESSAGE_LIMIT_BYTES,
  SNAPSHOT_BUDGET_BYTES,
  TRUNCATION_VIEWPORT_MULTIPLIER,
  SCROLL_THROTTLE_MS,
  OVERLAY_THROTTLE_MS,
  MUTATION_STALE_THRESHOLD_MS,
  WATCHDOG_TICK_MS,
  INLINE_STYLE_MAX_BYTES,
} from '../protocol/constants.js';
import { STREAM, createStreamSessionId } from '../protocol/messages.js';
```

**Factory validation and contained transport send** (lines 452-558):

```js
export function createCapture(config) {
  var cfg = config || {};
  var transport = cfg.transport;
  if (!transport || typeof transport.send !== 'function') {
    throw new Error('transport-send-required');
  }
  var logger = cfg.logger || {
    info: function () { console.info.apply(console, arguments); },
    warn: function () { console.warn.apply(console, arguments); },
    error: function () { console.error.apply(console, arguments); }
  };

  function safeSend(type, payload) {
    try {
      var result = transport.send(type, payload);
      if (result && typeof result.catch === 'function') {
        result.catch(function (err) {
          logger.error('[DOM Stream] transport send failed', err);
        });
      }
    } catch (err) {
      logger.error('[DOM Stream] transport send failed', err);
    }
  }
```

**Identity sidecar pattern** (lines 580-724):

```js
var nextNodeId = 1;
var elementToNid = new WeakMap();
var nidToElement = new Map();
var streamSessionId = '';
var currentSnapshotId = 0;

function ensureNodeId(element) {
  if (!element || element.nodeType !== Node.ELEMENT_NODE) return null;
  var existing = elementToNid.get(element);
  if (existing) return existing;
  var nid = String(nextNodeId++);
  elementToNid.set(element, nid);
  nidToElement.set(nid, element);
  return nid;
}

function getTrackedNodeId(element) {
  if (!element || element.nodeType !== Node.ELEMENT_NODE) return null;
  var nid = elementToNid.get(element);
  if (!nid) return null;
  if (nidToElement.get(nid) !== element) return null;
  return nid;
}

function buildNodeIdSidecar(root, cloneToNid, includeRoot) {
  var nodeIds = [];
  if (!root || !cloneToNid) return nodeIds;
  if (includeRoot && root.nodeType === Node.ELEMENT_NODE && cloneToNid.has(root)) {
    nodeIds.push(cloneToNid.get(root));
  }
  var walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, null);
  var el;
  while ((el = walker.nextNode())) {
    if (cloneToNid.has(el)) nodeIds.push(cloneToNid.get(el));
  }
  return nodeIds;
}
```

**Sanitization chokepoint pattern** (lines 1198-1255):

```js
// Serialization-path inventory:
//   1. serializeDOM clone walk          -- 'element' dispatch
//   2. processAddedNode add-op subtrees -- 'subtree' dispatch
//   3. attr-op branch                   -- 'attr' dispatch
//   4. characterData text branch        -- 'text' dispatch
//   5. E2 text-childlist branch         -- 'text' dispatch
// Head inline <style> text additionally routes through the 'css' dispatch.
function sanitizeForWire(kind, payload) {
  if (kind === 'element') {
    var clone = payload.clone;
    if (!clone || clone.nodeType !== Node.ELEMENT_NODE) return {};
    var tag = clone.tagName ? String(clone.tagName).toLowerCase() : '';
    if (tag === 'script' || tag === 'noscript') {
      return { drop: true };
    }
```

**Computed style pattern** (lines 1538-1584):

```js
function collectComputedStyleText(original, props) {
  try {
    var computed = window.getComputedStyle(original);
    var styles = [];
    var styleProps = props || CURATED_PROPS;
    for (var i = 0; i < styleProps.length; i++) {
      var prop = styleProps[i];
      var val = computed.getPropertyValue(prop);
      if (!val || val === '') continue;
      if (STYLE_DEFAULTS[prop] === val) continue;
      if (val === '0px' || val === 'normal' || val === 'none' || val === 'auto' || val === '0s' || val === '0px 0px') {
        if (!STYLE_DEFAULTS[prop]) continue;
      }
      styles.push(prop + ':' + val);
    }
    return styles.join(';');
  } catch (e) {
    return '';
  }
}

function captureComputedStyles(original, clone) {
  var styleText = collectComputedStyleText(original, CURATED_PROPS);
  if (styleText) clone.setAttribute('style', styleText);
}
```

**Add-op serialization pattern** (lines 1933-2017):

```js
function processAddedNode(el) {
  if (el.nodeType !== Node.ELEMENT_NODE) return null;
  if (wireDroppedWithAncestors(el)) {
    reserveNodeId();
    if (isWireDroppedElement(el)) sanitizeCounters.blockedSubtrees++;
    return null;
  }
  var rootNid = ensureNodeId(el);
  // ... absolutify live URL attributes ...
  var wireClone = el.cloneNode(true);
  var cloneToNid = new Map();
  if (rootNid) cloneToNid.set(wireClone, rootNid);
  // ... pair descendants ...
  var subtreeResult = sanitizeForWire('subtree', {
    root: wireClone,
    liveRoot: el,
    cloneToNid: cloneToNid
  });
  if (subtreeResult && subtreeResult.drop) return null;
  return {
    html: wireClone.outerHTML || '',
    nodeIds: buildNodeIdSidecar(wireClone, cloneToNid, true)
  };
}
```

**Mutation stream pattern** (lines 2210-2268):

```js
function flushMutations() {
  batchTimer = null;
  if (pendingMutations.length === 0) return;
  var batch = pendingMutations;
  pendingMutations = [];
  var sanBefore = sanitizeCountersSnapshot();
  var diffs = processMutationBatch(batch);
  warnIfSanitizeStrips(sanBefore);
  if (diffs.length === 0) return;
  safeSend(STREAM.MUTATIONS, {
    mutations: diffs,
    streamSessionId: streamSessionId || '',
    snapshotId: currentSnapshotId || 0,
    staleFlushCount: staleFlushCount
  });
}

mutationObserver.observe(document.body, {
  childList: true,
  attributes: true,
  characterData: true,
  subtree: true,
  attributeOldValue: true
});
```

**Apply to Phase 8:** shadow roots and same-origin iframe documents need their own deliberate traversal/observer hooks; do not rely on `document.body` observation. Subtree fetch responses must reuse `processAddedNode`/snapshot sanitization rules, not a second serializer. Live form value events must feed the existing `sanitizeForWire('text'/'attr')` masking seam before `safeSend`.

---

### `src/renderer/index.js` (component/provider, streaming/event-driven/request-response)

**Analog:** `src/renderer/index.js`

**Imports pattern** (lines 37-41):

```js
import { buildSnapshotHtml } from './snapshot.js';
import { applyMutations } from './diff.js';
import { sanitizeFragment } from './sanitize.js';
import { createOverlays, mapRectToHost, OVERLAY_CSS } from './overlays.js';
import { STREAM, CONTROL, isCurrentStream } from '../protocol/messages.js';
```

**Sandbox and post-parse scrub pattern** (lines 192-229):

```js
var iframe = doc.createElement('iframe');
iframe.setAttribute('title', 'PhantomStream live mirror');
iframe.setAttribute('sandbox', 'allow-same-origin');
var sandboxTokens = (iframe.getAttribute('sandbox') || '').trim().split(/\s+/);
if (sandboxTokens.length !== 1 || sandboxTokens[0] !== 'allow-same-origin') {
  throw new Error('viewer-sandbox-invalid');
}

iframe.addEventListener('load', function () {
  try {
    var scrubDoc = iframe.contentDocument;
    if (scrubDoc && scrubDoc.body) {
      sanitizeFragment(scrubDoc.body, sanitizeCounters, logger);
      if (lastSnapshotPayload) {
        resetIdentityIndex(scrubDoc, lastSnapshotPayload.nodeIds || []);
      }
    }
  } catch (e) {
    logger.warn('[Renderer] post-parse scrub failed', e);
  }
});
```

**Identity index pattern** (lines 579-629):

```js
function clearIdentityIndex() {
  nidToNode.clear();
  nodeToNid = new WeakMap();
}

function pairIdentityElements(elements, nodeIds, scope) {
  var ids = Array.isArray(nodeIds) ? nodeIds : [];
  if (elements.length !== ids.length) {
    logger.warn('[Renderer] identity sidecar mismatch', {
      scope: scope || '',
      elements: elements.length,
      nodeIds: ids.length
    });
  }
  for (var i = 0; i < elements.length && i < ids.length; i++) {
    var nid = String(ids[i]);
    nidToNode.set(nid, elements[i]);
    nodeToNid.set(elements[i], nid);
  }
}

function resetIdentityIndex(targetDoc, nodeIds) {
  clearIdentityIndex();
  if (!targetDoc || !targetDoc.body) return;
  pairIdentityElements(Array.prototype.slice.call(targetDoc.body.querySelectorAll('*')), nodeIds, 'snapshot');
}

function indexSubtree(root, nodeIds) {
  pairIdentityElements(elementsInSubtree(root), nodeIds, 'add');
}
```

**Snapshot and mutations routing pattern** (lines 748-792):

```js
function handleSnapshot(payload) {
  var p = payload || {};
  if (!p.html) {
    logger.error('[Renderer] snapshot missing html');
    return;
  }
  active.streamSessionId = p.streamSessionId || '';
  active.snapshotId = p.snapshotId || 0;
  counters.staleMisses = 0;
  counters.applyFailures = 0;
  resyncPending = false;
  lastSnapshotPayload = p;
  clearIdentityIndex();
  iframe.srcdoc = buildSnapshotHtml(p);
  markLive('snapshot');
}

function handleMutations(payload) {
  if (viewerState !== 'streaming') return;
  if (!isCurrentStream(payload, active)) return;
  var cd = iframe.contentDocument;
  applyMutations(cd, payload.mutations, counters, {
    logger: logger,
    requestResync: requestResync,
    sanitizeCounters: sanitizeCounters,
    identity: {
      resolve: resolveIndexedNode,
      indexSubtree: indexSubtree,
      removeSubtree: removeIndexedSubtree
    }
  });
}
```

**Apply to Phase 8:** shadow roots and nested frame documents must be indexed through this same private `Map<nid, Node>` concept. Subtree fetch response routing should mirror `handleMutations`: staleness-check, sanitize before indexing, and softly ignore stale/gone payloads.

---

### `src/renderer/diff.js` (utility, event-driven/transform)

**Analog:** `src/renderer/diff.js`

**Imports and hooks pattern** (lines 39-104):

```js
import { DIFF_OP } from '../protocol/messages.js';
import { sanitizeFragment, sanitizeAttrValue } from './sanitize.js';

export function applyMutations(doc, mutations, counters, hooks) {
  var opts = hooks || {};
  var logger = opts.logger && typeof opts.logger.warn === 'function'
    ? opts.logger
    : { warn: function () {} };
  var requestResync = typeof opts.requestResync === 'function'
    ? opts.requestResync
    : function () {};
  var identity = opts.identity || {};
  var resolve = typeof identity.resolve === 'function'
    ? function (nid) { return identity.resolve(nid); }
    : function () { return null; };
```

**Add and attr/text branch pattern** (lines 120-224):

```js
case DIFF_OP.ADD: {
  var parent = resolve(m.parentNid);
  if (!parent) {
    recordStaleMiss(DIFF_OP.ADD, m.parentNid);
    break;
  }
  var tpl = doc.createElement('template');
  tpl.innerHTML = m.html;
  sanitizeFragment(tpl.content, sanitizeCounters, logger);
  var newNode = tpl.content.firstElementChild;
  if (!newNode) {
    recordStaleMiss(DIFF_OP.ADD, m.parentNid);
    break;
  }
  var imported = doc.importNode(newNode, true);
  parent.appendChild(imported);
  indexSubtree(imported, m.nodeIds || []);
  break;
}
case DIFF_OP.ATTR: {
  var target = resolve(m.nid);
  if (!target) {
    recordStaleMiss(DIFF_OP.ATTR, m.nid);
    break;
  }
  var scrubbed = sanitizeAttrValue(m.attr, m.val);
  if (scrubbed.drop) break;
  if (scrubbed.value === null) {
    target.removeAttribute(m.attr);
    break;
  }
  target.setAttribute(m.attr, scrubbed.value);
  break;
}
case DIFF_OP.TEXT: {
  var textTarget = resolve(m.nid);
  if (!textTarget) {
    recordStaleMiss(DIFF_OP.TEXT, m.nid);
    break;
  }
  textTarget.textContent = m.text;
  break;
}
```

**Per-op containment pattern** (lines 227-256):

```js
} catch (e) {
  tallies.applyFailures += 1;
  logger.warn('[Renderer] mutation apply failed', {
    op: m && m.op ? m.op : '',
    nid: m && (m.nid || m.parentNid || m.beforeNid || '') ? (m.nid || m.parentNid || m.beforeNid || '') : '',
    error: e && e.message ? e.message : String(e),
    applyFailures: tallies.applyFailures
  });
  if (tallies.applyFailures >= 2) {
    requestResync('dom-mutation-apply-failed', {
      op: m && m.op ? m.op : '',
      nid: m && (m.nid || m.parentNid || m.beforeNid || '') ? (m.nid || m.parentNid || m.beforeNid || '') : ''
    });
  }
}
```

**Apply to Phase 8:** add `DIFF_OP.VALUE` and any shadow/frame structured op in the same switch. Missing nids must call `recordStaleMiss`; bad ops must be contained per op. Do not add selector fallback.

---

### `src/renderer/snapshot.js` (utility, transform)

**Analog:** `src/renderer/snapshot.js`

**CSP and srcdoc builder pattern** (lines 43-62, 132-158):

```js
var CSP_META = '<meta http-equiv="Content-Security-Policy" content="'
  + "default-src 'none'; "
  + 'img-src http: https: data:; '
  + "style-src http: https: 'unsafe-inline'; "
  + 'font-src http: https: data:'
  + '">';

export function buildSnapshotHtml(payload) {
  var p = payload || {};
  var stylesheetLinks = (p.stylesheets || [])
    .filter(function (url) { return !hasDangerousStylesheetUrl(url); })
    .map(function (url) {
      return '<link rel="stylesheet" href="' + url.replace(/"/g, '&quot;') + '">';
    }).join('\n');
  var inlineStyleTags = (p.inlineStyles || []).map(function (css) {
    return '<style>' + scrubCssText(css) + '</style>';
  }).join('\n');
  return '<!DOCTYPE html><html' + htmlAttrs + '><head>' + CSP_META + '<meta charset="UTF-8">' +
    '<meta name="viewport" content="width=' + (parseInt(p.viewportWidth, 10) || 1920) + '">' +
    stylesheetLinks + inlineStyleTags +
    '<style>body { margin: 0; overflow: hidden; } *::selection { background: transparent; } ::-webkit-scrollbar { display: none; }</style>' +
    '</head><body' + bodyAttrs + '>' + (p.html || '') + '</body></html>';
}
```

**Apply to Phase 8:** use this as the nested same-origin frame `srcdoc` precedent. Nested mirrors must remain inert and must not add `allow-scripts`.

---

### `src/renderer/sanitize.js` (utility, security transform)

**Analog:** `src/renderer/sanitize.js`

**Policy and export style** (lines 1-44):

```js
// sanitizeFragment is the named chokepoint every reconstructed-DOM
// insertion runs through: the diff applier's add-op fragment and the
// post-parse scrub of the loaded mirror document.
// It is DOM-FRAGMENT based by design: it walks PARSED nodes and mutates
// them in place. It never serializes back to a string and never re-parses.
```

**Attribute scrub pattern** (lines 204-227):

```js
export function sanitizeAttrValue(name, value) {
  var n;
  var v;
  try {
    n = String(name == null ? '' : name).toLowerCase();
    v = String(value == null ? '' : value);
  } catch (e) {
    return { drop: true, value: '' };
  }
  if (n.indexOf('on') === 0) return { drop: true, value: '' };
  if (n === 'srcdoc') return { drop: true, value: '' };
  if (URL_ATTRS[n] === true) {
    if (hasDangerousScheme(v)) return { drop: false, value: null };
    return { drop: false, value: v };
  }
  if (n === 'style') return { drop: false, value: scrubCssText(v) };
  return { drop: false, value: v };
}
```

**Fragment scrub pattern** (lines 247-366):

```js
export function sanitizeFragment(root, counters, logger) {
  if (!root || !root.ownerDocument) return;
  var elements = [];
  try {
    if (root.nodeType === 1) elements.push(root);
    var walker = root.ownerDocument.createTreeWalker(root, 1 /* NodeFilter.SHOW_ELEMENT */, null);
    var node = walker.nextNode();
    while (node) {
      elements.push(node);
      node = walker.nextNode();
    }
  } catch (e) {
    log.warn('[Renderer] sanitization walk failed', {
      error: e && e.message ? e.message : String(e)
    });
    return;
  }
  // collect then mutate; warn once if strips happened
}
```

**Apply to Phase 8:** shadow/frame/subtree response install paths must call this before any imported nodes are indexed. Do not string-scrub then reparse.

---

### `src/adapters/playwright-inject.js` (adapter, batch/request-response)

**Analog:** `tests/playwright-adapter.test.js`

**Classic-script artifact contract** (lines 143-154):

```js
test('inject source is a single classic script with the capture bridge hooks', () => {
  const source = getPlaywrightInjectSource();

  assert.equal(source.includes('import '), false);
  assert.equal(source.includes('export '), false);
  assert.match(source, /window\.top !== window/);
  assert.match(source, /window\.__phantomStreamBridge/);
  assert.match(source, /window\.__phantomStreamStart/);
  assert.match(source, /window\.__phantomStreamCapture/);
  assert.match(source, /window\.__phantomStreamGetNodeId/);
  assert.match(source, /createCapture/);
});
```

**Injected handle smoke pattern** (lines 156-184):

```js
dom.window.eval(getPlaywrightInjectSource());
await settleWindow(dom.window);

const button = dom.window.document.getElementById('target');
const nid = dom.window.__phantomStreamGetNodeId(button);

assert.equal(typeof dom.window.__phantomStreamCapture, 'object');
assert.equal(typeof dom.window.__phantomStreamGetNodeId, 'function');
assert.equal(typeof nid, 'string');
assert.equal(dom.window.__phantomStreamCapture.getNodeId(button), nid);
assert.equal(dom.window.__phantomStreamGetNodeId(dom.window.document.createElement('aside')), null);
assert.ok(sent.some((entry) => entry.type === STREAM.SNAPSHOT));
```

**Apply to Phase 8:** after capture-core changes, keep this file ESM-free and synchronized with `createCapture`. Add static checks for new Phase 8 bridge hooks only if the injected public surface changes.

---

## Test Pattern Assignments

### Capture-side tests

**Applies to:** `tests/capture-shadow-dom.test.js`, `tests/capture-iframe.test.js`, `tests/capture-input-values.test.js`, `tests/capture-added-styles.test.js`, `tests/capture-subtree-fetch.test.js`, and capture-side additions to `tests/security-mask.test.js` / `tests/security-sanitize-capture.test.js`.

**Analog:** `tests/security-mask.test.js`, `tests/security-sanitize-capture.test.js`, `tests/capture-identity.test.js`

**Imports and audited globals pattern** (`tests/security-mask.test.js` lines 23-35):

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM, VirtualConsole } from 'jsdom';
import { createCapture } from '../src/capture/index.js';
import { STREAM, DIFF_OP } from '../src/protocol/messages.js';

const AUDITED_GLOBALS = [
  'window', 'document', 'Node', 'NodeFilter', 'MutationObserver',
  'requestAnimationFrame', 'cancelAnimationFrame', 'CustomEvent',
  'ShadowRoot', 'location', 'getComputedStyle', 'URL',
];
```

**Setup/teardown and settle pattern** (`tests/security-mask.test.js` lines 53-120):

```js
function setupEnv(bodyHtml) {
  const dom = new JSDOM(
    '<!DOCTYPE html><html><head><title>mask fixture</title></head><body>'
      + bodyHtml + '</body></html>',
    {
      url: 'https://fixture.test/page',
      pretendToBeVisual: true,
      virtualConsole: new VirtualConsole(),
    }
  );
  const w = dom.window;
  const prior = new Map();
  for (const key of AUDITED_GLOBALS) {
    prior.set(key, {
      present: Object.prototype.hasOwnProperty.call(globalThis, key),
      value: globalThis[key],
    });
    globalThis[key] = key === 'window' ? w : w[key];
  }
  return { dom, window: w, document: w.document, capture: null, teardown() { /* restore globals */ } };
}

async function settle(win) {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => win.requestAnimationFrame(resolve));
  await new Promise((resolve) => setTimeout(resolve, 20));
}

function createLoopbackTransport() {
  const sent = [];
  return { sent, send(type, payload) { sent.push({ type, payload }); } };
}
```

**Sidecar assertions pattern** (`tests/capture-identity.test.js` lines 186-225):

```js
test('snapshot payload includes preorder nodeIds sidecar matching serialized elements', async () => {
  const payload = snapshotPayload(transport);
  assert.equal(Array.isArray(payload.nodeIds), true);
  const elements = serializedElements(env.document, payload.html);
  assert.equal(payload.nodeIds.length, elements.length);
  assert.equal(elements.filter((el) => el.hasAttribute('data-fsb-nid')).length, 0);
  assert.equal(payload.nodeIds[0], env.capture.getNodeId(env.document.getElementById('root')));
});

test('add ops include preorder nodeIds sidecar for added root and descendants', async () => {
  const addOps = mutationOps(transport).filter((op) => op.op === DIFF_OP.ADD);
  const op = addOps[0];
  assert.equal(Array.isArray(op.nodeIds), true);
  assert.equal(op.nodeIds.length, serializedElements(env.document, op.html).length);
  assert.equal(op.nodeIds[0], env.capture.getNodeId(section));
});
```

**Masking/leak scan pattern** (`tests/security-mask.test.js` lines 666-721):

```js
assert.ok(!html.includes('hunter2'), 'password plaintext absent from the snapshot');
assert.equal(pw.getAttribute('value'), expectMask('hunter2'), 'password value masked with the default mask');
const wire = wireText(transport);
assert.ok(!/hunter2/.test(wire), 'password plaintext appears in ZERO transport.sent payloads');

env.document.getElementById('pw').setAttribute('value', 'hunter2-rotated');
await settle(env.window);
const ops = attrOps(transport).filter((op) => op.attr === 'value');
assert.equal(ops[0].val, expectMask('hunter2-rotated'), 'attr op carries the masked value');
assert.ok(!/hunter2/.test(wireText(transport)), 'password plaintext appears in ZERO transport.sent payloads');
```

**Capture sanitizer test pattern** (`tests/security-sanitize-capture.test.js` lines 231-320):

```js
const html = snapshotPayloadOf(transport).html;
assert.ok(!/srcdoc/i.test(html), 'srcdoc attribute is absent');
assert.ok(html.includes('id="if1"'), 'the iframe element itself survives (attribute-only drop)');
assert.ok(!/<object/i.test(html), 'object subtree dropped entirely');

const addHtml = allMutationOps(transport)
  .filter((op) => op.op === DIFF_OP.ADD)
  .map((op) => op.html)
  .join('\n');
assert.ok(addHtml.length > 0, 'the appended divs produced add ops');
```

**Apply to Phase 8:** for shadow roots, same-origin frames, live input values, added-node styles, and subtree responses, reuse this local setup style. Keep leak assertions wire-wide, not just snapshot-only.

---

### Renderer-side tests

**Applies to:** `tests/renderer-shadow-dom.test.js`, `tests/renderer-iframe.test.js`, `tests/renderer-value-diff.test.js`, `tests/renderer-subtree-fetch.test.js`, and render-side additions to `tests/security-sanitize-render.test.js`.

**Analog:** `tests/renderer-diff.test.js`, `tests/security-sanitize-render.test.js`, `tests/renderer-loopback.test.js`

**Document-parameterized diff helper pattern** (`tests/renderer-diff.test.js` lines 25-130):

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM, VirtualConsole } from 'jsdom';
import { applyMutations } from '../src/renderer/diff.js';
import { DIFF_OP } from '../src/protocol/messages.js';

function setupEnv() {
  const dom = new JSDOM(
    '<!DOCTYPE html><html><head><title>diff fixture</title></head><body></body></html>',
    { url: 'https://fixture.test/page', virtualConsole: new VirtualConsole() }
  );
  return {
    window: dom.window,
    makeDoc(bodyHtml) {
      const doc = dom.window.document.implementation.createHTMLDocument('diff target');
      doc.body.innerHTML = bodyHtml;
      return doc;
    },
    teardown() { dom.window.close(); },
  };
}

function freshCounters() {
  return { staleMisses: 0, applyFailures: 0 };
}
```

**Injected identity index pattern** (`tests/renderer-diff.test.js` lines 87-127):

```js
function createIdentityIndex(doc, nodeIds) {
  const nidToNode = new Map();
  const nodeToNid = new WeakMap();
  function pair(elements, ids) {
    const safeIds = Array.isArray(ids) ? ids : [];
    for (let i = 0; i < elements.length && i < safeIds.length; i++) {
      const nid = String(safeIds[i]);
      nidToNode.set(nid, elements[i]);
      nodeToNid.set(elements[i], nid);
    }
  }
  pair(Array.from(doc.body.querySelectorAll('*')), nodeIds);
  return {
    resolve(nid) { return nidToNode.get(String(nid)) || null; },
    indexSubtree,
    removeSubtree,
  };
}
```

**Diff branch assertion pattern** (`tests/renderer-diff.test.js` lines 141-164, 316-354):

```js
const add = { op: DIFF_OP.ADD, parentNid: '1', html: '<p>new</p>', nodeIds: ['9'] };
assert.equal(add.html.includes('data-fsb-nid'), false, 'add html is sidecar-only');
applyMutations(doc, [add], counters, rec.hooks);
const added = rec.identity.resolve('9');
assert.ok(added, 'new node is present in the target Document');
assert.equal(added.ownerDocument, doc, 'importNode adopted the node into the target Document');

applyMutations(doc, [
  { op: DIFF_OP.ADD, parentNid: 'ghost-a', html: '<p>x</p>' },
  { op: DIFF_OP.REMOVE, nid: 'ghost-b' },
], counters, rec.hooks);
applyMutations(doc, [
  { op: DIFF_OP.ATTR, nid: 'ghost-c', attr: 'x', val: '1' },
], counters, rec.hooks);
assert.equal(counters.staleMisses, 3, 'third miss counted');
assert.equal(rec.resyncs[0].reason, 'stale-mutation-parent');
```

**Render sanitizer integration pattern** (`tests/security-sanitize-render.test.js` lines 579-590):

```js
const doc = makeDoc(env, '<iframe ' + NID_ATTR + '="1"></iframe>');
const sc = freshCounters();
const rec = diffHooks(sc, doc);
applyMutations(doc, [
  { op: DIFF_OP.ATTR, nid: '1', attr: 'srcdoc', val: '<p>nested</p>' },
], freshDiffCounters(), rec.hooks);
const target = doc.querySelector('[' + NID_ATTR + '="1"]');
assert.equal(target.hasAttribute('srcdoc'), false, 'srcdoc attr op never applied');
assert.equal(sc.strippedHandlers, 1, 'srcdoc drop counted');
```

**Post-parse snapshot scrub and jsdom glue pattern** (`tests/security-sanitize-render.test.js` lines 696-755):

```js
transport.emit(STREAM.SNAPSHOT, snapshotPayload({
  html: '<div ' + NID_ATTR + '="1">'
    + '<button ' + NID_ATTR + '="2" onclick="alert(1)">x</button>'
    + '<a ' + NID_ATTR + '="3" href="javascript:alert(1)">y</a>'
    + '</div>',
}));

const cd = iframe.contentDocument;
cd.open();
cd.write(iframe.getAttribute('srcdoc'));
cd.close();
iframe.dispatchEvent(new env.window.Event('load'));

assert.deepEqual(onAttrsOf(cd.body), [], 'zero on* attributes anywhere in the mirror body after the post-parse scrub');
```

**Apply to Phase 8:** value diffs should be unit-tested in `applyMutations` like other op codes. Shadow/frame/subtree renderer tests should use the injected identity hook style and manual `srcdoc` write-glue when asserting iframe content under jsdom.

---

### Loopback and subtree recovery tests

**Applies to:** `tests/capture-subtree-fetch.test.js`, `tests/renderer-subtree-fetch.test.js`, `tests/renderer-loopback.test.js`.

**Analog:** `tests/renderer-loopback.test.js`

**Loopback transport and wiring order pattern** (lines 124-232):

```js
function createLoopbackTransport() {
  const toViewer = new Set();
  const toHost = new Set();
  function fanOut(handlers, type, payload) {
    queueMicrotask(() => {
      handlers.forEach((h) => h(type, payload));
    });
  }
  return {
    captureTransport: { send(type, payload) { fanOut(toViewer, type, payload); } },
    viewerTransport: {
      send(type, payload) { fanOut(toHost, type, payload); },
      onMessage(h) { toViewer.add(h); return () => { toViewer.delete(h); }; },
    },
    onControl(h) { toHost.add(h); return () => { toHost.delete(h); }; },
  };
}

const viewer = createViewer({ container, transport: transport.viewerTransport, logger });
const capture = createCapture({ transport: transport.captureTransport, logger, skipElement });
transport.onControl((type) => {
  if (type === CONTROL.START) capture.start();
});
```

**Latched request/recovery pattern** (lines 625-708):

```js
for (let i = 0; i < 3; i++) {
  ctx.transport.captureTransport.send(STREAM.MUTATIONS, {
    mutations: [
      { op: DIFF_OP.ADD, parentNid: 424242 + i, html: '<div>orphan</div>' },
    ],
    streamSessionId: firstSnapshot.streamSessionId,
    snapshotId: firstSnapshot.snapshotId,
  });
}
await settle(env.window);

const starts = controlStartsOf(ctx.controls);
assert.equal(starts.length, 1, 'exactly one latched CONTROL.START');
assert.equal(starts[0].payload.trigger, 'preview-resync');
assert.equal(starts[0].payload.reason, 'stale-mutation-parent');
```

**Apply to Phase 8:** subtree fetch should copy the latch shape but be scoped by requested nid/requestId instead of firing fetch storms. Preserve `streamSessionId` and `snapshotId` in both request and response assertions.

---

### Playwright/browser fidelity test

**Applies to:** `tests/playwright-fidelity-phase8.test.js`.

**Analog:** `tests/playwright-adapter.test.js`

**Fake page/event test style** (lines 1-30, 33-80):

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM, VirtualConsole } from 'jsdom';
import { CONTROL, REMOTE_CONTROL, REMOTE_CONTROL_STATE, STREAM } from '../src/protocol/index.js';

function createRecordingTransport() {
  const messageHandlers = new Set();
  return {
    sent: [],
    send(type, payload) { this.sent.push({ type, payload }); },
    onMessage(handler) {
      messageHandlers.add(handler);
      return () => messageHandlers.delete(handler);
    },
    emit(type, payload) {
      for (const handler of messageHandlers) handler(type, payload || {});
    },
  };
}
```

**Apply to Phase 8:** use real Playwright Chromium for at least one smoke covering actual shadow slot behavior, iframe same-origin/cross-origin behavior, and real `input`/`change` events. Keep helper style local to the file.

---

### Differential oracle updates

**Applies to:** `tests/differential/normalize.js`, `tests/differential/divergence-ledger.js`, `tests/differential/oracle.test.js`.

**Analog:** existing differential files

**Normalize shape pattern** (`tests/differential/normalize.js` lines 28-78):

```js
export function normalizeReference(msgs) {
  return msgs.map((msg) => {
    const { action, ...rest } = msg;
    switch (action) {
      case 'domStreamSnapshot':
        return { type: STREAM.SNAPSHOT, payload: msg.snapshot };
      case 'domStreamMutations':
        return { type: STREAM.MUTATIONS, payload: rest };
      default:
        throw new Error('unknown-reference-action: ' + String(action));
    }
  });
}

export function normalizeExtracted(msgs) {
  return msgs.map((msg) => {
    if (!STREAM_TYPES.has(msg.type)) {
      throw new Error('unknown-extracted-type: ' + String(msg.type));
    }
    return { type: msg.type, payload: msg.payload };
  });
}
```

**Ledger entry pattern** (`tests/differential/divergence-ledger.js` lines 118-127, 257-319):

```js
/**
 * Declared divergences between the reference capture and the extracted core.
 * Exactly THREE mismatch-kind entries exist ...
 * @type {DivergenceEntry[]}
 */
export const DIVERGENCES = [
  {
    id: 'D7-capture-sanitization',
    kind: 'mismatch',
    description: 'The reference serializes raw hostile content ...',
    rationale: 'Deliberate security divergence ...',
    affectedMessages: [STREAM.SNAPSHOT, STREAM.MUTATIONS],
    affectedScenarios: ['sanitize-divergence'],
    appliesTo(refMsg, extMsg, scenarioName) {
      if (scenarioName !== 'sanitize-divergence') return false;
      if (refMsg === undefined || extMsg === undefined) return false;
      if (refMsg.type !== extMsg.type) return false;
      // exact-shape predicate
    },
  },
];
```

**Oracle matrix pattern** (`tests/differential/oracle.test.js` lines 45-58):

```js
const MATRIX = [
  { fixture: 'basic.html', scenario: basicMutations, config: {} },
  { fixture: 'basic.html', scenario: mutationBurst, config: {} },
  { fixture: 'basic.html', scenario: structuralOps, config: {} },
  { fixture: 'basic.html', scenario: scroll, config: {} },
  { fixture: 'basic.html', scenario: pauseResume, config: {} },
  { fixture: 'basic.html', scenario: textChildlist, config: {} },
  { fixture: 'sanitize-corpus.html', scenario: sanitizeDivergence, config: {} },
  { fixture: 'heavy-realistic.html', scenario: snapshotOnly, config: {} },
  { fixture: 'truncation-overflow.html', scenario: snapshotOnly, config: { patchRects: true } },
];
```

**Apply to Phase 8:** if shadow/frame/value/subtree protocol extensions intentionally diverge from FSB, add scenario-pinned ledger entries. Do not create broad predicates that excuse unrelated mismatches.

---

### Documentation updates

**Applies to:** `src/capture/README.md`, `src/renderer/README.md`, `docs/ARCHITECTURE.md`, `docs/SECURITY.md`, `docs/DESIGN-HISTORY.md`.

**Analog:** existing docs

**Architecture limitation/update pattern** (`docs/ARCHITECTURE.md` lines 40-64, 187-207):

```md
The standalone framework design after Phase 7 keeps the same opaque nid wire
contract but removes live-page identity mutation. Capture owns identity in an
internal `WeakMap<Element, string>` plus reverse lookup, emits `nodeIds`
sidecars on snapshots and add ops, and exposes `getNodeId(element)` for trusted
host code.

2. **Added nodes carry no computed styles.** Add ops carry `nodeIds` sidecars
   and fixed URLs, but do not capture computed styles, so post-snapshot content
   renders inconsistently with snapshot-era siblings.
4. **Truncation recovery is passive.** Diff targets inside dropped subtrees miss until the
   next snapshot; an on-demand subtree fetch would close the gap.
6. **Shadow DOM, `<video>`/`<audio>`, and cross-origin iframe content are not mirrored.**
```

**Security contract pattern** (`docs/SECURITY.md` lines 34-59, 85-101):

```md
1. **Capture chokepoint: `sanitizeForWire` (`src/capture/index.js`)** - every snapshot,
   add-op subtree, attr op, text op, and head inline style value routes through this named
   function before `transport.send`.
3. **Render chokepoints: `sanitizeFragment` and `sanitizeAttrValue`
   (`src/renderer/sanitize.js`)** - add-op HTML is parsed in a `<template>`, scrubbed as a
   DOM fragment, and then imported.
5. **Iframe Sandbox token contract** - the viewer iframe's sandbox attribute is exactly
   `allow-same-origin`. It is never `allow-scripts`, and no other token is added.

- Password input values are always masked, independent of `maskInputs`.
- `maskInputs: true` masks input, textarea, and related form value surfaces.
```

**Design-history performance lesson pattern** (`docs/DESIGN-HISTORY.md` lines 52-65):

```md
1. **Curate, don't enumerate.** Iterating all 300+ computed CSS properties per element made
   a YouTube DOM serialize take ~45 s. The curated ~85-property list with default-value
   elision restored interactivity.
2. **Batch your layout reads.** Reading `getBoundingClientRect()` interleaved with clone
   mutation forced N layout flushes; a single TreeWalker pre-pass into a Map collapsed them
   to 1.
5. **Identity beats ordering.** Session/snapshot IDs on every message turned a class of
   ghost-mutation corruption bugs into silent, correct rejections.
```

**Apply to Phase 8:** replace limitations that Phase 8 fixes with current behavior. Add new limitations only for closed shadow roots, cross-origin frame content, and any intentionally deferred manual-slot or CSSOM behavior.

## Shared Patterns

### Identity and Addressing

**Source:** `src/capture/index.js` lines 642-724; `src/renderer/index.js` lines 579-629  
**Apply to:** capture serialization, shadow roots, same-origin frames, add ops, subtree fetch responses, renderer indexing.

Rules:
- Assign live identity in `WeakMap<Element, string>`.
- Emit `nodeIds` sidecars in serialized preorder.
- Renderer pairs sidecars after sanitization.
- No selector fallback and no framework-owned live `data-fsb-nid` mutation.

### Sanitization and Masking

**Source:** `src/capture/index.js` lines 1198-1255; `src/renderer/sanitize.js` lines 204-366; `tests/security-mask.test.js` lines 666-892.  
**Apply to:** shadow HTML, frame HTML, value diffs, subtree fetch responses, add ops, attr/text ops.

Rules:
- Capture routes every new writer through `sanitizeForWire`.
- Renderer parses to a fragment, calls `sanitizeFragment`, imports only after scrub.
- Password values are always masked.
- `maskInputs` and `maskInputFn` apply to event-driven value diffs just like snapshot/attr paths.
- Health and diagnostics stay content-free.

### Stream Identity and Staleness

**Source:** `src/protocol/messages.js` lines 128-148; `src/capture/index.js` lines 631-640, 2225-2230; `src/renderer/index.js` lines 748-792.  
**Apply to:** all new `CONTROL.*`, `STREAM.*`, and mutation-family payloads.

Rules:
- Stamp `streamSessionId` and `snapshotId` on stream messages.
- Viewer ignores stale stream payloads softly.
- Subtree fetch responses must be ignored if the requested live node is gone, skipped, blocked, stale, or no longer tracked.

### Error Handling

**Source:** `src/capture/index.js` lines 452-558; `src/renderer/diff.js` lines 103-114 and 227-256; `src/renderer/index.js` lines 859-887.  
**Apply to:** runtime capture hooks, renderer handlers, subtree fetch, shadow/frame apply.

Rules:
- Factory-time validation is the throwing boundary.
- Runtime errors route to injected logger and continue.
- One bad mutation op must not abort the batch.
- Miss thresholds/latches request recovery instead of throwing.

### Computed-Style Performance

**Source:** `src/capture/index.js` lines 92-130, 1538-1584; `docs/DESIGN-HISTORY.md` lines 52-65.  
**Apply to:** late-added nodes, shadow roots, same-origin iframe snapshots/subtrees, subtree fetch.

Rules:
- Use `CURATED_PROPS` plus `STYLE_DEFAULTS`; never enumerate all computed properties.
- Batch style/layout reads before detached-clone mutation.
- Add tests that statically or behaviorally reject all-property enumeration regressions.

### jsdom and Iframe Test Discipline

**Source:** `tests/renderer-loopback.test.js` lines 248-265; `tests/security-sanitize-render.test.js` lines 713-755.  
**Apply to:** renderer iframe tests and nested frame reconstruction tests.

Rules:
- jsdom does not parse `iframe.srcdoc` into `contentDocument`.
- Tests must manually `cd.open(); cd.write(iframe.getAttribute('srcdoc')); cd.close();`.
- Re-fire `load` when the test needs to exercise the viewer's post-parse scrub listener.

## No Exact Analog Found

These files have role-match analogs but no exact existing feature analog. Planner should use the assigned role-match excerpts above plus `08-RESEARCH.md` implementation guidance.

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `tests/capture-shadow-dom.test.js` | test | streaming, event-driven, transform | No existing open shadow root serialization or slot fixture tests. |
| `tests/renderer-shadow-dom.test.js` | test | event-driven, transform | No existing shadow root reconstruction/indexing tests. |
| `tests/capture-iframe.test.js` | test | transform, request-response | Existing iframe behavior is security placeholder/live-shell only, not same-origin frame document mirroring. |
| `tests/renderer-iframe.test.js` | test | transform, request-response | No nested inert iframe reconstruction test exists. |
| `tests/capture-input-values.test.js` | test | event-driven, streaming | Existing tests cover attr/text masking, not property-only `input`/`change` events. |
| `tests/renderer-value-diff.test.js` | test | event-driven, transform | Existing `DIFF_OP.TEXT/ATTR` tests are closest; no `VALUE` op exists. |
| `tests/capture-added-styles.test.js` | test | event-driven, transform | Existing curated style and sanitizer tests are closest; no added-node computed-style regression test exists. |
| `tests/capture-subtree-fetch.test.js` | test | request-response, transform | No on-demand subtree fetch path exists yet. |
| `tests/renderer-subtree-fetch.test.js` | test | request-response, event-driven | Existing resync latch is closest; no targeted fetch response installer exists. |
| `tests/playwright-fidelity-phase8.test.js` | test | event-driven, request-response | Existing Playwright tests focus adapter injection, not real browser shadow/frame/value fidelity. |
| `src/adapters/playwright-inject.js` | adapter | batch, request-response | Existing artifact must be synchronized, but the copyable behavioral analog is the Playwright adapter test contract. |

## Metadata

**Analog search scope:** `src/`, `tests/`, `docs/`, `.planning/codebase/`  
**Files scanned:** 92 tracked files  
**Pattern extraction date:** 2026-06-15  
**Phase artifacts read:** `08-CONTEXT.md`, `08-RESEARCH.md`, `08-VALIDATION.md`  
**Project instructions:** no root `AGENTS.md`; no project-local `.codex/skills/` or `.agents/skills/` directory found.
