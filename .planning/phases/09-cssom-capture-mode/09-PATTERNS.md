# Phase 09: CSSOM Capture Mode - Pattern Map

**Mapped:** 2026-06-16
**Files analyzed:** 15 new/modified files
**Analogs found:** 15 / 15

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/capture/index.js` | service | streaming, event-driven, transform | `src/capture/index.js` | exact |
| `src/protocol/messages.js` | config | streaming, transform | `src/protocol/messages.js` | exact |
| `src/renderer/snapshot.js` | utility | transform | `src/renderer/snapshot.js` | exact |
| `src/renderer/index.js` | component/provider | streaming, event-driven, request-response | `src/renderer/index.js` | exact |
| `src/renderer/diff.js` | utility | event-driven, transform | `src/renderer/diff.js` | exact |
| `src/renderer/sanitize.js` | utility | transform | `src/renderer/sanitize.js` | exact |
| `src/adapters/playwright-inject.js` | adapter | request-response, streaming | `src/adapters/playwright-inject.js` | exact |
| `tests/capture-cssom-mode.test.js` | test | streaming, event-driven, transform | `tests/capture-added-styles.test.js` | role-match |
| `tests/renderer-cssom-mode.test.js` | test | event-driven, transform | `tests/renderer-iframe.test.js` | role-match |
| `tests/security-cssom-sanitize.test.js` | test | transform, streaming | `tests/security-sanitize-capture.test.js` | role-match |
| `tests/playwright-cssom-mode.test.js` | test | event-driven, request-response | `tests/playwright-fidelity-phase8.test.js` | role-match |
| `tests/protocol.test.js` | test | transform, static | `tests/protocol.test.js` | exact |
| `tests/security-chokepoint-purity.test.js` | test | transform, static | `tests/security-chokepoint-purity.test.js` | exact |
| `tests/differential/oracle.test.js` | test | batch, transform | `tests/differential/oracle.test.js` | exact |
| `tests/differential/divergence-ledger.js` | config | transform | `tests/differential/divergence-ledger.js` | exact |

## Pattern Assignments

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
import { STREAM, CONTROL, DIFF_OP, createStreamSessionId } from '../protocol/messages.js';
```

**Config and factory boundary** (lines 452-469):
```js
export function createCapture(config) {
  var cfg = config || {};
  var transport = cfg.transport;
  // Factory-time validation is the one place allowed to throw (D-07);
  // everything after start() routes errors to the logger instead.
  if (!transport || typeof transport.send !== 'function') {
    throw new Error('transport-send-required');
  }
  var logger = cfg.logger || {
    info: function () { console.info.apply(console, arguments); },
    warn: function () { console.warn.apply(console, arguments); },
    error: function () { console.error.apply(console, arguments); }
  };
  var overlayProvider = cfg.overlayProvider || null;
  var hostSkipElement = (typeof cfg.skipElement === 'function')
    ? cfg.skipElement
    : null;
  var skipElement = hostSkipElement || function () { return false; };
```

**Existing stylesheet collection pattern** (lines 968-995):
```js
function collectStylesheetsFrom(doc) {
  var stylesheets = [];
  if (!doc || !doc.querySelectorAll) return stylesheets;
  var links = doc.querySelectorAll('head link[rel="stylesheet"]');
  for (var s = 0; s < links.length; s++) {
    var href = links[s].getAttribute('href');
    if (!href) continue;
    var sheetHref = absolutifyUrl(href, doc);
    if (hasDangerousScheme(sheetHref)) {
      sanitizeCounters.blockedUrlSchemes++;
    } else {
      stylesheets.push(sheetHref);
    }
  }
  return stylesheets;
}

function collectInlineStylesFrom(doc) {
  var inlineStyles = [];
  if (!doc || !doc.querySelectorAll) return inlineStyles;
  var styleTags = doc.querySelectorAll('head style');
  for (var st = 0; st < styleTags.length; st++) {
    var cssText = styleTags[st].textContent;
    if (cssText && cssText.length < INLINE_STYLE_MAX_BYTES) {
      inlineStyles.push(sanitizeForWire('css', { css: cssText }).css);
    }
  }
  return inlineStyles;
}
```

**Capture-side CSS sanitizer chokepoint** (lines 2478-2484):
```js
if (kind === 'css') {
  var scrubbedCss = scrubCssText(payload.css);
  if (scrubbedCss !== payload.css) {
    sanitizeCounters.cssScrubs++;
  }
  return { css: scrubbedCss };
}
```

**Computed-style fallback pattern** (lines 2540-2580):
```js
function collectComputedStyleText(original, props) {
  try {
    var view = original && original.ownerDocument && original.ownerDocument.defaultView
      ? original.ownerDocument.defaultView
      : window;
    var computed = view.getComputedStyle(original);
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
  if (styleText) {
    clone.setAttribute('style', styleText);
  }
}
```

**Snapshot sidecar assembly pattern** (lines 2796-2927):
```js
var stylesheets = collectStylesheetsFrom(document);
var inlineStyles = collectInlineStylesFrom(document);
...
var nodeIds = buildNodeIdSidecar(clone, cloneToNid, false);
var shadowRoots = collectShadowRootPayloads(document.body, nodeIds, truncatedNodeIds);
var frames = collectFramePayloads(document.body, cloneToNid, truncatedNodeIds);
var budgetedSidecars = pruneSnapshotSidecarsForBudget({
  html: html,
  nodeIds: nodeIds,
  truncated: truncated,
  missingDescendants: missingDescendants,
  stylesheets: stylesheets,
  inlineStyles: inlineStyles,
  ...
}, shadowRoots, frames, clone, cloneToNid, truncatedNodeIds);
...
var snapshotPayload = {
  html: html,
  nodeIds: nodeIds,
  shadowRoots: shadowRoots,
  frames: frames,
  truncated: truncated,
  missingDescendants: missingDescendants,
  stylesheets: stylesheets,
  inlineStyles: inlineStyles,
```

**Mutation batching and send pattern** (lines 3471-3500, 3507-3522, 3545-3558):
```js
function sendMutationDiffs(diffs, options) {
  var chunk = [];
  for (var i = 0; i < diffs.length; i++) {
    var originalDiff = diffs[i];
    var diff = boundMutationDiffForBudget(originalDiff, options);
    if (!diff) {
      if (originalDiff) {
        logger.warn('[DOM Stream] mutation diff dropped over budget', {
          op: originalDiff && originalDiff.op ? originalDiff.op : ''
        });
      }
      continue;
    }
    ...
    if (chunk.length) {
      safeSend(STREAM.MUTATIONS, mutationPayloadForBudget(chunk, options));
    }
  }
}

function flushMutations() {
  batchTimer = null;
  if (pendingMutations.length === 0) return;
  var batch = pendingMutations;
  pendingMutations = [];
  var sanBefore = sanitizeCountersSnapshot();
  var diffs = processMutationBatch(batch);
  warnIfSanitizeStrips(sanBefore);
  if (diffs.length === 0) return;
  sendMutationDiffs(diffs);
}

mutationObserver = new MutationObserver(function(mutations) {
  for (var i = 0; i < mutations.length; i++) {
    pendingMutations.push(mutations[i]);
  }
  if (batchTimer) cancelAnimationFrame(batchTimer);
  batchTimer = requestAnimationFrame(flushMutations);
});
```

**Apply to Phase 9:** add a config-gated CSSOM branch in this same closure. Keep computed mode as default. Implement CSSOM style source collection near `collectStylesheetsFrom` / `collectInlineStylesFrom`, route all CSS text through `sanitizeForWire('css', ...)`, and send dynamic stylesheet updates through `sendMutationDiffs` as a new `DIFF_OP` family inside `STREAM.MUTATIONS`. Use source-level replacement/upsert/remove diffs; do not add a new stream type.

---

### `src/protocol/messages.js` (config, streaming/transform)

**Analog:** `src/protocol/messages.js`

**Stream and op namespace pattern** (lines 17-76):
```js
export const STREAM = {
  /** Full snapshot. Payload: see SnapshotPayload below. */
  SNAPSHOT: 'ext:dom-snapshot',
  /** Batched diff ops. Payload: { mutations: DiffOp[], streamSessionId, snapshotId } */
  MUTATIONS: 'ext:dom-mutations',
  ...
};

/** Diff op codes carried in STREAM.MUTATIONS payloads. */
export const DIFF_OP = {
  /** { op:'add', parentNid, html, beforeNid|null, nodeIds:string[] } — insert serialized subtree */
  ADD: 'add',
  ...
  /** { op:'frame', frameNid, frame:FramePayload } — refresh an inert iframe mirror */
  FRAME: 'frame',
};
```

**Payload typedef sidecar pattern** (lines 107-178):
```js
/**
 * @typedef {Object} FramePayload
 * @property {string} frameNid          Iframe element nid
 * @property {string} kind              Frame policy kind, e.g. 'same-origin' or 'cross-origin'
 * @property {string} [html]            Serialized frame body HTML for accessible frames
 * @property {string[]} [nodeIds]       Preorder ids for serialized frame elements
 * @property {string[]} [stylesheets]   Absolutified stylesheet URLs
 * @property {string[]} [inlineStyles]  Sanitized inline style blocks
 * ...
 */

/**
 * @typedef {Object} SnapshotPayload
 * @property {string} html              Serialized body innerHTML (style-inlined; framework identity-clean)
 * @property {string[]} nodeIds         Preorder ids for every serialized element in html
 * @property {ShadowRootPayload[]} [shadowRoots] Open shadow roots keyed by host nid
 * @property {FramePayload[]} [frames]  Frame sidecars keyed by iframe nid
 * ...
 * @property {string[]} stylesheets     Absolutified <link rel=stylesheet> URLs
 * @property {string[]} inlineStyles    Inline <style> text blocks from <head>
```

**Staleness guard pattern** (lines 208-219):
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

**Apply to Phase 9:** add one `DIFF_OP` such as `STYLE_SOURCE: 'style-source'`. Add JSDoc typedefs for `StyleSource`, `StyleStrategy`, and `StyleSourceDiffOp`. Extend `SnapshotPayload`, `FramePayload`, and likely `ShadowRootPayload` with optional style source sidecars while preserving `stylesheets[]` and `inlineStyles[]`.

---

### `src/renderer/snapshot.js` (utility, transform)

**Analog:** `src/renderer/snapshot.js`

**Sanitizer import and CSP posture** (lines 39-62):
```js
import { scrubCssText } from './sanitize.js';

var CSP_META = '<meta http-equiv="Content-Security-Policy" content="'
  + "default-src 'none'; "
  + 'img-src http: https: data:; '
  + "style-src http: https: 'unsafe-inline'; "
  + 'font-src http: https: data:'
  + '">';
```

**Safe stylesheet and inline style insertion pattern** (lines 132-158):
```js
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
  ...
  return '<!DOCTYPE html><html' + htmlAttrs + '><head>' + CSP_META + '<meta charset="UTF-8">' +
    '<meta name="viewport" content="width=' + (parseInt(p.viewportWidth, 10) || 1920) + '">' +
    stylesheetLinks +
    inlineStyleTags +
    '<style>body { margin: 0; overflow: hidden; } *::selection { background: transparent; } ::-webkit-scrollbar { display: none; }</style>' +
    '</head><body' + bodyAttrs + '>' + (p.html || '') + '</body></html>';
}
```

**Apply to Phase 9:** top-level CSSOM sources can be assembled here the same way as `inlineStyles`, but keep CSS text insertion via `scrubCssText` and string style tags only. Do not put shadow or frame scoped CSS into the top-level srcdoc; those belong to `src/renderer/index.js`.

---

### `src/renderer/index.js` (component/provider, streaming/event-driven/request-response)

**Analog:** `src/renderer/index.js`

**Imports and public integration style** (lines 37-41):
```js
import { buildSnapshotHtml, buildFramePlaceholderHtml } from './snapshot.js';
import { applyMutations } from './diff.js';
import { sanitizeFragment } from './sanitize.js';
import { createOverlays, mapRectToHost, OVERLAY_CSS } from './overlays.js';
import { STREAM, CONTROL, isCurrentStream } from '../protocol/messages.js';
```

**Post-parse scrub and sidecar installation pattern** (lines 226-235):
```js
iframe.addEventListener('load', function () {
  try {
    var scrubDoc = iframe.contentDocument;
    if (scrubDoc && scrubDoc.body) {
      sanitizeFragment(scrubDoc.body, sanitizeCounters, logger);
      if (lastSnapshotPayload) {
        resetIdentityIndex(scrubDoc, lastSnapshotPayload.nodeIds || []);
        installShadowRoots(scrubDoc, lastSnapshotPayload.shadowRoots || []);
        installFrames(scrubDoc, lastSnapshotPayload.frames || []);
      }
    }
```

**Shadow root scoped replay pattern** (lines 686-719):
```js
function installOneShadowRoot(targetDoc, payload) {
  var p = payload || {};
  if (!targetDoc || !p.hostNid) return false;
  if (p.mode && p.mode !== 'open') return false;
  var host = resolveIndexedNode(p.hostNid);
  if (!host) {
    logger.warn('[Renderer] shadow root host missing', { hostNid: p.hostNid || '' });
    return false;
  }
  var shadowRoot = host.shadowRoot || null;
  if (!shadowRoot) {
    if (typeof host.attachShadow !== 'function') {
      logger.warn('[Renderer] shadow root unsupported', { hostNid: p.hostNid || '' });
      return false;
    }
    try {
      shadowRoot = host.attachShadow({ mode: 'open' });
    } catch (err) {
      logger.warn('[Renderer] shadow root attach failed', {
        hostNid: p.hostNid || '',
        error: err && err.message ? err.message : String(err)
      });
      return false;
    }
  }

  removeIndexedSubtree(shadowRoot);
  while (shadowRoot.firstChild) shadowRoot.removeChild(shadowRoot.firstChild);

  var tpl = targetDoc.createElement('template');
  tpl.innerHTML = p.html || '';
  sanitizeFragment(tpl.content, sanitizeCounters, logger);
  shadowRoot.appendChild(targetDoc.importNode(tpl.content, true));
```

**Frame scoped replay pattern** (lines 744-796):
```js
function indexFrameDocument(frameEl, framePayload) {
  var p = framePayload || {};
  try {
    var frameDoc = frameEl && frameEl.contentDocument;
    if (!frameDoc || !frameDoc.documentElement || !frameDoc.body) return false;
    removeIndexedSubtree(frameDoc.documentElement);
    sanitizeFragment(frameDoc.body, sanitizeCounters, logger);
    ...
    installShadowRoots(frameDoc, p.shadowRoots || []);
    installFrames(frameDoc, p.frames || []);
    return true;
  } catch (err) {
    logger.warn('[Renderer] frame document index failed', {
      frameNid: p.frameNid || ''
    });
    return false;
  }
}

function installOneFrame(targetDoc, framePayload) {
  ...
  if (p.kind === 'same-origin') {
    setFrameLoadHandler(frameEl, function() {
      indexFrameDocument(frameEl, p);
    });
    frameEl.setAttribute('srcdoc', buildSnapshotHtml(p));
    indexFrameDocument(frameEl, p);
    return true;
  }
```

**Mutation dispatch integration pattern** (lines 970-991):
```js
function handleMutations(payload) {
  if (viewerState !== 'streaming') return;
  if (!isCurrentStream(payload, active)) return;
  lastMutationAt = Date.now();
  var cd = iframe.contentDocument;
  applyMutations(cd, payload.mutations, counters, {
    logger: logger,
    requestResync: requestResync,
    sanitizeCounters: sanitizeCounters,
    identity: {
      resolve: resolveIndexedNode,
      indexSubtree: indexSubtree,
      removeSubtree: removeIndexedSubtree,
      installShadowRoot: function(hostNid, payload) {
        var opPayload = Object.assign({}, payload || {}, { hostNid: hostNid });
        installOneShadowRoot(cd, opPayload);
      },
      installFrames: function(frames) {
        installFrames(cd, frames || []);
      }
    }
  });
```

**Apply to Phase 9:** add scoped style-source installers beside `installShadowRoots` / `installFrames`, and expose an identity hook to `applyMutations` for style-source ops. Keep all style insertion inside the existing sandboxed iframe or reconstructed shadow/frame documents.

---

### `src/renderer/diff.js` (utility, event-driven/transform)

**Analog:** `src/renderer/diff.js`

**Imports and sanitizer boundary** (lines 39-40):
```js
import { DIFF_OP } from '../protocol/messages.js';
import { sanitizeFragment, sanitizeAttrValue } from './sanitize.js';
```

**Injected hooks and counters pattern** (lines 99-131):
```js
export function applyMutations(doc, mutations, counters, hooks) {
  var opts = hooks || {};
  var logger = opts.logger && typeof opts.logger.warn === 'function'
    ? opts.logger
    : { warn: function () {} };
  var requestResync = typeof opts.requestResync === 'function'
    ? opts.requestResync
    : function () {};
  var tallies = counters || { staleMisses: 0, applyFailures: 0 };
  var sanitizeCounters = opts.sanitizeCounters || {
    strippedHandlers: 0, blockedUrls: 0, droppedSubtrees: 0, cssScrubs: 0
  };

  if (!doc || !doc.body) return;
  if (!mutations) return;
  ...
  var installFrames = typeof identity.installFrames === 'function'
    ? function (frames) { identity.installFrames(frames || []); }
    : null;
```

**Per-op switch and sidecar handling pattern** (lines 161-228):
```js
try {
  mutations.forEach(function (m) {
    try {
      switch (m.op) {
        case DIFF_OP.ADD: {
          ...
          if (Array.isArray(m.shadowRoots)) {
            for (var s = 0; s < m.shadowRoots.length; s++) {
              applyShadowRoot(m.shadowRoots[s]);
            }
          }
          if (installFrames && Array.isArray(m.frames)) {
            installFrames(m.frames);
          }
          break;
        }
        case DIFF_OP.SHADOW_ROOT: {
          applyShadowRoot(m);
          break;
        }
        case DIFF_OP.FRAME: {
          if (installFrames && m.frame) {
            installFrames([m.frame]);
          }
          break;
        }
```

**Error containment pattern** (lines 325-353):
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
...
} catch (e) {
  tallies.applyFailures += 1;
  logger.warn('[Renderer] mutation batch failed', {
    error: e && e.message ? e.message : String(e),
    applyFailures: tallies.applyFailures
  });
  requestResync('dom-mutation-batch-failed', {
    error: String(e && e.message ? e.message : e)
  });
}
```

**Apply to Phase 9:** add a new `case DIFF_OP.STYLE_SOURCE` that delegates to an injected `identity.installStyleSource` / `identity.removeStyleSource` hook. Keep per-op try/catch containment, stale-miss accounting for missing scopes, and request-resync threshold behavior.

---

### `src/renderer/sanitize.js` (utility, transform)

**Analog:** `src/renderer/sanitize.js`

**CSS scrub pattern** (lines 166-192):
```js
export function scrubCssText(css) {
  var input = String(css == null ? '' : css);
  try {
    var out = input;
    out = out.replace(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)"'][^)]*))?\s*\)/gi,
      function (match, dq, sq, bare) {
        var inner = dq !== undefined ? dq : (sq !== undefined ? sq : (bare || ''));
        var probe = String(inner || '').replace(/[\u0000-\u0020]+/g, '').toLowerCase();
        var scheme = /^([a-z][a-z0-9+.-]*):/.exec(probe);
        if (!scheme) return match;
        if (scheme[1] === 'http' || scheme[1] === 'https') return match;
        if (scheme[1] === 'data' && probe.indexOf('data:image/') === 0) return match;
        return 'url(about:blank)';
      });
    out = out.replace(/expression\s*\(/gi, 'blocked(');
    out = out.replace(/-moz-binding/gi, 'blocked-binding');
    out = out.replace(/@import\b(\s*(?:url\(\s*)?['"]?\s*)([^'");\s]*)/gi, function (match, lead, target) {
      var probe = String(target || '').replace(/[\u0000-\u0020]+/g, '').toLowerCase();
      if (probe.indexOf('http:') === 0 || probe.indexOf('https:') === 0) return match;
      return '@import-blocked' + lead + 'about:blank';
    });
    out = out.replace(/<\/style/gi, '<\\/style');
    return out;
  } catch (e) {
    return input;
  }
}
```

**Style element and style attr scrub pattern** (lines 291-298, 335-341):
```js
if (tag === 'style') {
  var styleText = el.textContent || '';
  var scrubbedStyleText = scrubCssText(styleText);
  if (scrubbedStyleText !== styleText) {
    el.textContent = scrubbedStyleText;
    tallies.cssScrubs += 1;
  }
}
...
if (lower === 'style') {
  var styleVal = el.getAttribute(name);
  var scrubbed = scrubCssText(styleVal);
  if (scrubbed !== styleVal) {
    el.setAttribute(name, scrubbed);
    tallies.cssScrubs += 1;
  }
  continue;
}
```

**Apply to Phase 9:** use `scrubCssText` before renderer insertion of every CSSOM style source and every style-source mutation. Extend only if the CSSOM-specific security tests prove an actual gap.

---

### `src/adapters/playwright-inject.js` (adapter, request-response/streaming)

**Analog:** `src/adapters/playwright-inject.js`, `src/adapters/playwright.js`, `tests/adapter-exports.test.js`

**Classic script namespace pattern** (`src/adapters/playwright-inject.js` lines 1-45):
```js
(function () {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  if (window.top !== window) return;
  if (window.__phantomStreamInjected) return;
  window.__phantomStreamInjected = true;
  var PHANTOM_STREAM_BRIDGE_TOKEN = "";
  ...
  var STREAM = {
    SNAPSHOT: "ext:dom-snapshot",
    MUTATIONS: "ext:dom-mutations",
    ...
  };

  var DIFF_OP = {
    ADD: "add",
    REMOVE: "rm",
    ATTR: "attr",
    TEXT: "text",
    VALUE: "value",
    SHADOW_ROOT: "shadow-root",
    FRAME: "frame"
  };
```

**Checked-in artifact loader pattern** (`src/adapters/playwright.js` lines 24-44):
```js
/**
 * Read the checked-in classic-script inject artifact.
 *
 * @returns {string}
 */
export function getPlaywrightInjectSource() {
  return buildPlaywrightInjectSource();
}

function buildPlaywrightInjectSource(options) {
  var source = readFileSync(
    fileURLToPath(new URL('./playwright-inject.js', import.meta.url)),
    'utf8'
  );
  var opts = options || {};
  if (!Object.prototype.hasOwnProperty.call(opts, 'bridgeToken')) return source;
  return source.replace(
    INJECT_TOKEN_DECLARATION,
    'var PHANTOM_STREAM_BRIDGE_TOKEN = ' + JSON.stringify(String(opts.bridgeToken || '')) + ';'
  );
}
```

**Bridge bootstrap pattern** (`src/adapters/playwright-inject.js` lines 3889-3953):
```js
var phantomStreamCapture = null;
...
var phantomStreamTransport = {
  send: function (type, payload) {
    try {
      if (typeof phantomStreamBridge !== "function") return;
      var result = phantomStreamBridge({ token: PHANTOM_STREAM_BRIDGE_TOKEN, type: type, payload: payload || {} });
      if (result && typeof result.catch === "function") {
        result.catch(function () {});
      }
    } catch (e) { /* bridge failures must not break capture */ }
  },
  flush: function () {}
};

function phantomStreamEnsureCapture() {
  if (!phantomStreamCapture) {
    phantomStreamCapture = createCapture({
      transport: phantomStreamTransport,
      logger: phantomStreamLogger
    });
    window.__phantomStreamCapture = phantomStreamCapture;
  }
  return phantomStreamCapture;
}
...
window.__phantomStreamStart = function () {
  if (!document.body) {
    setTimeout(function () {
      if (window.__phantomStreamStart) window.__phantomStreamStart();
    }, 0);
    return false;
  }
  phantomStreamEnsureCapture().start();
  return true;
};
```

**Static artifact contract test** (`tests/adapter-exports.test.js` lines 16-25):
```js
test('browser inject source is a checked-in classic script with capture bridge hooks', () => {
  const source = getBrowserInjectSource();

  assert.equal(source.includes('import '), false);
  assert.equal(source.includes('export '), false);
  assert.match(source, /createCapture/);
  assert.match(source, /window\.__phantomStreamBridge/);
  assert.match(source, /window\.__phantomStreamStart/);
  assert.match(source, /window\.__phantomStreamStop/);
});
```

**Apply to Phase 9:** regenerate or patch the artifact after protocol/capture changes. The artifact must remain classic script, dependency-free, and synchronized with `src/capture/index.js` and `src/protocol/messages.js`. `src/adapters/browser-inject.js` and bookmarklet loader paths inherit this artifact.

---

### `tests/capture-cssom-mode.test.js` (test, streaming/event-driven/transform)

**Analog:** `tests/capture-added-styles.test.js`, `tests/capture-iframe.test.js`, `tests/capture-shadow-dom.test.js`

**JSDOM capture setup pattern** (`tests/capture-added-styles.test.js` lines 5-16, 22-60):
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM, VirtualConsole } from 'jsdom';
import { createCapture } from '../src/capture/index.js';
import { RELAY_PER_MESSAGE_LIMIT_BYTES } from '../src/protocol/constants.js';
import { STREAM, DIFF_OP } from '../src/protocol/messages.js';

const AUDITED_GLOBALS = [
  'window', 'document', 'Node', 'NodeFilter', 'MutationObserver',
  'requestAnimationFrame', 'cancelAnimationFrame', 'CustomEvent',
  'ShadowRoot', 'location', 'getComputedStyle', 'URL',
];
...
function setupEnv(bodyHtml = '<div id="host"></div>') {
  const dom = new JSDOM(..., {
    url: 'https://fixture.test/page',
    pretendToBeVisual: true,
    virtualConsole: new VirtualConsole(),
  });
```

**Mutation settle and extraction helpers** (`tests/capture-added-styles.test.js` lines 63-85):
```js
async function settle(win) {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => win.requestAnimationFrame(resolve));
  await new Promise((resolve) => setTimeout(resolve, 20));
}

function createRecordingTransport() {
  const sent = [];
  return {
    sent,
    send(type, payload) { sent.push({ type, payload }); },
  };
}

function addOps(transport) {
  return transport.sent
    .filter((m) => m.type === STREAM.MUTATIONS)
    .flatMap((m) => m.payload.mutations)
    .filter((op) => op.op === DIFF_OP.ADD);
}
```

**Scoped frame sidecar assertion pattern** (`tests/capture-iframe.test.js` lines 127-147):
```js
const payload = snapshotPayload(transport);
const frameNid = env.capture.getNodeId(frame);

assert.equal(payload.html.includes('id="same-frame"'), true, 'iframe host remains in main payload.html');
assert.equal(Array.isArray(payload.frames), true, 'snapshot carries frames sidecar');

const framePayload = payload.frames.find((entry) => entry.frameNid === frameNid);
assert.ok(framePayload, 'frames entry is keyed by frameNid');
assert.equal(framePayload.kind, 'same-origin');
assert.equal(typeof framePayload.html, 'string');
...
assert.equal(Array.isArray(framePayload.stylesheets), true, 'frame stylesheets field exists');
assert.equal(Array.isArray(framePayload.inlineStyles), true, 'frame inlineStyles field exists');
```

**Scoped shadow sidecar assertion pattern** (`tests/capture-shadow-dom.test.js` lines 121-137):
```js
const payload = snapshotPayload(transport);
const hostNid = env.capture.getNodeId(fx.host);
const shadowButtonNid = env.capture.getNodeId(fx.button);

assert.ok(payload.html.includes('id="card"'), 'host element remains in payload.html');
assert.equal(payload.html.includes('Shadow action'), false, 'shadow content is not flattened into payload.html');
assert.equal(Array.isArray(payload.shadowRoots), true, 'snapshot carries shadowRoots sidecar');

const shadow = payload.shadowRoots.find((entry) => entry.hostNid === hostNid);
assert.ok(shadow, 'shadowRoots entry is keyed by the hostNid');
assert.equal(shadow.mode, 'open');
assert.equal(Array.isArray(shadow.nodeIds), true, 'shadow descendants carry nodeIds sidecar');
assert.ok(shadow.nodeIds.includes(shadowButtonNid), 'shadow descendant nid matches getNodeId');
```

**Apply to Phase 9:** create tests for default computed mode, opt-in `styleMode: "cssom"`, CSSOM source records, fallback chain, no broad computed enumeration in normal CSSOM mode, dynamic style-source ops, document/open-shadow/same-origin-frame scopes, and class flips that should work because generated computed inline styles are absent.

---

### `tests/renderer-cssom-mode.test.js` (test, event-driven/transform)

**Analog:** `tests/renderer-iframe.test.js`, `tests/renderer-shadow-dom.test.js`, `tests/renderer-diff.test.js`

**Manual viewer transport and snapshot fixture pattern** (`tests/renderer-iframe.test.js` lines 35-79):
```js
function createManualTransport() {
  const handlers = new Set();
  const sent = [];
  return {
    sent,
    transport: {
      send(type, payload) { sent.push({ type, payload }); },
      onMessage(handler) {
        handlers.add(handler);
        return () => { handlers.delete(handler); };
      },
    },
    emit(type, payload) {
      handlers.forEach((handler) => handler(type, payload));
    },
  };
}

function baseSnapshot(overrides = {}) {
  return {
    html: '<main id="root">'
      + '<iframe id="same-frame"></iframe>'
      + '<iframe id="remote-frame" src="https://remote.example/private"></iframe>'
      + '</main>',
    nodeIds: ['root-nid', 'same-frame-nid', 'remote-frame-nid'],
    frames: [{
      frameNid: 'same-frame-nid',
      kind: 'same-origin',
      ...
      inlineStyles: ['button{color:blue}'],
```

**jsdom srcdoc glue pattern** (`tests/renderer-iframe.test.js` lines 115-122):
```js
function glueIframe(iframe) {
  const cd = iframe.contentDocument;
  cd.open();
  cd.write(iframe.getAttribute('srcdoc'));
  cd.close();
  iframe.dispatchEvent(new iframe.ownerDocument.defaultView.Event('load'));
  return cd;
}
```

**Renderer scoped install assertion pattern** (`tests/renderer-iframe.test.js` lines 134-156):
```js
wire.emit(STREAM.SNAPSHOT, baseSnapshot());
const mirrorDoc = glueIframe(viewerIframe(env));
const sameFrame = mirrorDoc.getElementById('same-frame');

assert.ok(sameFrame, 'same-origin iframe host exists in mirror');
assert.equal(sameFrame.hasAttribute('src'), false, 'same-origin mirror frame does not load a live src');
assert.equal(typeof sameFrame.getAttribute('srcdoc'), 'string', 'same-origin payload is installed as srcdoc');
assert.ok(sameFrame.getAttribute('srcdoc').includes('inside-frame'), 'srcdoc carries the frame payload');
assert.equal((sameFrame.getAttribute('sandbox') || '').includes('allow-scripts'), false, 'nested sandbox omits allow-scripts');

const frameDoc = glueIframe(sameFrame);
assert.equal(frameDoc.getElementById('inside-frame').textContent, 'Frame button');
assert.equal(frameDoc.getElementById('inside-frame').hasAttribute('onclick'), false, 'frame srcdoc is sanitized');
assert.ok(frameDoc.getElementById('frame-shadow-host').shadowRoot, 'frame-local shadow root is attached');
```

**Diff applier identity test pattern** (`tests/renderer-diff.test.js` lines 87-127):
```js
function createIdentityIndex(doc, nodeIds) {
  const nidToNode = new Map();
  const nodeToNid = new WeakMap();
  ...
  return {
    resolve(nid) { return nidToNode.get(String(nid)) || null; },
    indexSubtree,
    removeSubtree,
  };
}

function indexedHooks(doc, nodeIds) {
  const rec = recordingHooks();
  const identity = createIdentityIndex(doc, nodeIds);
  rec.identity = identity;
  rec.hooks.identity = identity;
  return rec;
}
```

**Apply to Phase 9:** assert top document style sources, shadow-scoped sources, and frame-scoped sources install in the right root. Add mutation tests for style-source replace/upsert/remove through `applyMutations` and the viewer dispatch path.

---

### `tests/security-cssom-sanitize.test.js` (test, transform/streaming)

**Analog:** `tests/security-sanitize-capture.test.js`, `tests/security-sanitize-render.test.js`

**Capture-side CSS side-channel security pattern** (`tests/security-sanitize-capture.test.js` lines 343-379):
```js
const payload = snapshotPayloadOf(transport);
const styles = payload.inlineStyles || [];
const joined = styles.join('\n');
assert.ok(!/url\(\s*javascript/i.test(joined), 'no url(javascript:) in inline styles');
assert.ok(!/@import/i.test(joined), 'the non-http @import is neutralized');
assert.ok(joined.indexOf('</style') === -1, 'no raw </style breakout sequence survives');
assert.ok(styles.indexOf(benignCss) !== -1, 'benign head css passes through byte-identical');
...
assert.deepEqual(
  snapshotPayloadOf(transport).stylesheets || [],
  ['https://cdn.test/app.css'],
  'only benign stylesheet URLs survive the capture-side side channel'
);
```

**Renderer-side style text security pattern** (`tests/security-sanitize-render.test.js` lines 200-211):
```js
test('sanitizeFragment scrubs hostile <style> element text', () => {
  const env = setupEnv();
  try {
    const frag = env.makeFragment(
      '<style>.x{background:url("javascript:alert(1)");width:expression(alert(2));}</style>'
    );
    const counters = freshCounters();
    sanitizeFragment(frag, counters, recordingLogger());
    const css = frag.querySelector('style').textContent;
    assert.ok(!/url\(\s*javascript/i.test(css), 'style element text has no url(javascript:)');
    assert.ok(!/expression\(/i.test(css), 'style element text has no expression()');
    assert.equal(counters.cssScrubs, 1, 'style element text scrub counted');
```

**Post-parse defense-in-depth pattern** (`tests/security-sanitize-render.test.js` lines 703-741):
```js
transport.emit(STREAM.SNAPSHOT, snapshotPayload({
  html: '<div ' + NID_ATTR + '="1">'
    + '<button ' + NID_ATTR + '="2" onclick="alert(1)">x</button>'
    + '<a ' + NID_ATTR + '="3" href="javascript:alert(1)">y</a>'
    + '<style>.x{background:url("javascript:alert(1)");width:expression(alert(2));}</style>'
    + '</div>',
}));
...
iframe.dispatchEvent(new env.window.Event('load'));

assert.deepEqual(
  onAttrsOf(cd.body),
  [],
  'zero on* attributes anywhere in the mirror body after the post-parse scrub'
);
assert.deepEqual(
  attrValuesMatching(cd.body, /javascript:/i),
  [],
  'no javascript: URL anywhere in the mirror body'
);
const css = cd.body.querySelector('style').textContent;
assert.ok(!/url\(\s*javascript/i.test(css), 'post-parse style text has no url(javascript:)');
assert.ok(!/expression\(/i.test(css), 'post-parse style text has no expression()');
```

**Apply to Phase 9:** test CSSOM readable rules, fetched CSS hook output, constructable/adopted CSS text, dynamic replacement CSS, and renderer insertion. Assert content-free diagnostics and no cross-origin CSS text leakage.

---

### `tests/playwright-cssom-mode.test.js` (test, event-driven/request-response)

**Analog:** `tests/playwright-fidelity-phase8.test.js`

**Real browser harness pattern** (lines 1-23, 56-67):
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createPlaywrightAdapter } from '../src/adapters/playwright.js';
import { CONTROL, STREAM } from '../src/protocol/messages.js';

const INJECT_PATH = fileURLToPath(new URL('../src/adapters/playwright-inject.js', import.meta.url));

async function withCapturePage(run) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const messages = [];
  await page.exposeFunction('__phantomStreamBridge', (message) => {
    messages.push(message);
    return { ok: true };
  });
  try {
    await run({ page, messages });
  } finally {
    await browser.close();
  }
}

async function installCheckedInInjectArtifact(page) {
  await page.addScriptTag({ path: INJECT_PATH });
}

async function waitForMessage(messages, predicate, label) {
  for (let i = 0; i < 100; i++) {
    const found = messages.find(predicate);
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('timed out waiting for ' + label);
}
```

**Shadow/browser assertion pattern** (lines 86-143):
```js
await page.setContent(`
  <!doctype html>
  <html>
    <body>
      <article id="shadow-host">
        <span id="slot-title" slot="title">Named title</span>
        <span id="default-copy">Default light text</span>
      </article>
      <script>
        const host = document.getElementById('shadow-host');
        const root = host.attachShadow({ mode: 'open' });
        root.innerHTML = '<header><slot name="title"></slot></header><main><slot></slot></main><footer><slot name="body"></slot></footer>';
      </script>
    </body>
  </html>
`, { waitUntil: 'load' });
await installCheckedInInjectArtifact(page);
...
assert.ok(Array.isArray(snapshot.payload.shadowRoots), 'snapshot carries shadowRoots sidecar');
const shadow = snapshot.payload.shadowRoots.find((entry) => entry && entry.hostNid === hostNid);
assert.ok(shadow, 'shadow root payload is keyed by host nid');
```

**Frame/browser boundary assertion pattern** (lines 146-180):
```js
await page.setContent(`
  <!doctype html>
  <html>
    <body>
      <iframe id="same-frame" srcdoc="<main><h1 id='inside'>Same origin frame</h1><button>Frame button</button></main>"></iframe>
      <iframe id="opaque-frame" sandbox srcdoc="<main><h1>Opaque frame secret</h1></main>"></iframe>
    </body>
  </html>
`, { waitUntil: 'load' });
...
assert.ok(Array.isArray(snapshot.payload.frames), 'snapshot carries frames sidecar');
const sameFrame = frameFor(snapshot.payload.frames, ids.same);
const opaqueFrame = frameFor(snapshot.payload.frames, ids.opaque);
assert.ok(sameFrame, 'same-origin frame payload is keyed by iframe nid');
assert.doesNotMatch(JSON.stringify(opaqueFrame), /Opaque frame secret/,
  'inaccessible frame payload is content-free');
```

**Apply to Phase 9:** use Chromium for `cssRules` security fallback, `adoptedStyleSheets`, `insertRule` / `deleteRule` / `replace` / `replaceSync`, class/theme flips, and payload-size/serialize-latency smoke. Keep checked-in inject artifact in the path.

---

### `tests/protocol.test.js` (test, transform/static)

**Analog:** `tests/protocol.test.js`

**Import through protocol barrel** (lines 1-14):
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  encodeEnvelope,
  decodeEnvelope,
  isCompressedEnvelope,
  isCurrentStream,
  createStreamSessionId,
  CONTROL,
  STREAM,
  DIFF_OP,
  SNAPSHOT_BUDGET_BYTES,
  RELAY_PER_MESSAGE_LIMIT_BYTES,
} from '../src/protocol/index.js';
```

**Protocol constant pin pattern** (lines 80-86):
```js
test('Phase 8 protocol constants are exported for fidelity sidecars and recovery', () => {
  assert.equal(DIFF_OP.VALUE, 'value');
  assert.equal(DIFF_OP.SHADOW_ROOT, 'shadow-root');
  assert.equal(DIFF_OP.FRAME, 'frame');
  assert.equal(CONTROL.SUBTREE_REQUEST, 'dash:ps-subtree-request');
  assert.equal(STREAM.SUBTREE_RESPONSE, 'ext:ps-subtree-response');
});
```

**Apply to Phase 9:** add assertions for the new style-source diff op and any new payload helpers. Do not add a new `STREAM` constant unless planning intentionally rejects D-12.

---

### `tests/security-chokepoint-purity.test.js` (test, transform/static)

**Analog:** `tests/security-chokepoint-purity.test.js`

**Capture chokepoint static scan pattern** (lines 60-81):
```js
test('capture sanitizeForWire chokepoint covers the five serialization paths', () => {
  const definitions = countMatches(CAPTURE_CODE, /function\s+sanitizeForWire\s*\(/g);
  const references = countMatches(CAPTURE_CODE, /sanitizeForWire\s*\(/g);
  const callSites = references - definitions;

  assert.equal(
    definitions,
    1,
    'capture must keep exactly one function sanitizeForWire definition'
  );
  assert.ok(
    callSites >= 10,
    'sanitizeForWire call-site floor is 10 for the five serialization paths: ' +
      SERIALIZATION_PATHS.join(', ')
  );

  for (const dispatch of ['element', 'subtree', 'attr', 'text', 'css']) {
    assert.ok(
      CAPTURE_CODE.includes(`sanitizeForWire('${dispatch}'`),
      `capture serialization dispatch ${dispatch} must route through sanitizeForWire`
    );
  }
});
```

**Renderer chokepoint static scan pattern** (lines 162-180):
```js
test('render chokepoint wiring remains present at every insertion layer', () => {
  const diff = strippedRendererModule('diff.js');
  const index = strippedRendererModule('index.js');
  const snapshot = strippedRendererModule('snapshot.js');

  assert.ok(diff.includes('sanitizeFragment'), 'diff.js must scrub ADD fragments');
  assert.ok(diff.includes('sanitizeAttrValue'), 'diff.js must scrub ATTR values');
  assert.ok(
    /createElement\s*\(\s*'template'\s*\)/.test(diff),
    'diff.js must parse add-op HTML in template context'
  );
  assert.ok(diff.includes('importNode'), 'diff.js must import sanitized template nodes');
  assert.ok(index.includes('sanitizeFragment'), 'index.js must keep the post-parse scrub');
  assert.ok(snapshot.includes('scrubCssText'), 'snapshot.js must scrub inline CSS values');
  assert.ok(
    snapshot.includes('Content-Security-Policy'),
    'snapshot.js must emit the srcdoc Content-Security-Policy meta'
  );
});
```

**Apply to Phase 9:** update inventory and call-site floor for CSSOM source serialization and style-source mutation serialization. Add static assertions that renderer CSSOM insertion paths call `scrubCssText` and do not use `innerHTML` for CSS text.

---

### `tests/differential/oracle.test.js` (test, batch/transform)

**Analog:** `tests/differential/oracle.test.js`

**Matrix pattern** (lines 47-61):
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
  { fixture: 'heavy-realistic.html', scenario: structuralOps, config: {} },
  { fixture: 'truncation-overflow.html', scenario: snapshotOnly, config: { patchRects: true } },
  { fixture: 'canvas.html', scenario: snapshotOnly, config: {} },
  { fixture: 'dialog.html', scenario: dialog, config: { runScripts: 'dangerously' } },
  { fixture: 'phase8-fidelity.html', scenario: phase8ProtocolExtensions, config: {} },
];
```

**Load-bearing ledger guard pattern** (lines 489-553):
```js
test('phase8-protocol-extensions with an EMPTY ledger throws UNDECLARED DIVERGENCE -- D24 entries are load-bearing', async () => {
  const entry = MATRIX.find((p) => p.scenario === phase8ProtocolExtensions);
  const { refStream, extStream } = await captureFlippedPair(entry);

  assert.throws(
    () => compareStreams(refStream, extStream, entry.fixture, entry.scenario.name, []),
    /UNDECLARED DIVERGENCE/
  );
});
...
test('every declared mismatch divergence matched at least one real divergence', () => {
  const mismatchEntries = DIVERGENCES.filter((entry) => entry.kind === 'mismatch');
  assert.ok(
    mismatchEntries.length >= 1,
    'the ledger declares at least one mismatch-kind entry (D1)'
  );
  for (const entry of mismatchEntries) {
    assert.ok(
      matchedMismatchIds.has(entry.id),
      `stale ledger entry: ${entry.id} never matched a real divergence (stale-entry detection, D-03)`
    );
  }
});
```

**Apply to Phase 9:** keep default computed mode reference-compatible. Only add CSSOM entries to the matrix if the scenario explicitly opts into CSSOM mode. Add an empty-ledger guard for any new CSSOM divergence so the ledger is proven load-bearing.

---

### `tests/differential/divergence-ledger.js` (config, transform)

**Analog:** `tests/differential/divergence-ledger.js`

**Ledger entry contract** (lines 1-42):
```js
// tests/differential/divergence-ledger.js -- machine-readable declared-
// divergence registry (locked decision D-03). The differential oracle FAILS
// on any per-message mismatch not claimed by an entry here; human-readable
// divergence docs derive from this module, never the other way around.
//
// Kind semantics:
//  - kind 'mismatch' entries claim REAL per-message comparison failures.
//    Every mismatch entry MUST match at least one divergence per full oracle
//    run -- the stale-entry detection test at the end of oracle.test.js
//    asserts the matched-id set covers all of them, so a dead entry cannot
//    silently keep excusing divergences that no longer exist.
...
 * @property {(refMsg: *, extMsg: *, scenarioName: string) => boolean} appliesTo
 *   Predicate marking an individual mismatch as covered by this entry.
 */
```

**Scoped Phase 8 divergence pattern** (lines 477-536):
```js
{
  id: 'D24-phase8-add-op-computed-styles',
  kind: 'mismatch',
  description:
    'Phase 8 add ops include curated computed style attributes on newly added '
    + 'elements so post-snapshot content matches snapshot-era siblings. The FSB '
    + 'reference add-op HTML carries the raw new subtree without computed styles.',
  rationale:
    'D-16 through D-18 and CAPT-06 require late-added nodes to carry curated '
    + 'computed styles while explicitly deferring full CSSOM capture to Phase 9. '
    + 'The predicate is pinned to existing add-op scenarios and only matches '
    + 'mutation batches that become reference-equivalent after removing style '
    + 'attributes from extracted add-op HTML.',
  affectedMessages: [STREAM.MUTATIONS],
  affectedScenarios: ['basic-mutations', 'mutation-burst', 'structural-ops'],
  appliesTo(refMsg, extMsg, scenarioName) {
    return isAddStyleOnlyMutationBatch(refMsg, extMsg, scenarioName);
  },
},
{
  id: 'D24-phase8-shadow-frame-snapshot-sidecars',
  kind: 'mismatch',
  description:
    'Phase 8 extracted snapshots carry non-empty shadowRoots[] and frames[] '
    + 'sidecars for open shadow roots and same-origin iframe documents. The FSB '
    + 'reference has no corresponding structured sidecar fields.',
  ...
  affectedMessages: [STREAM.SNAPSHOT],
  affectedScenarios: ['phase8-protocol-extensions'],
```

**Predicate failure containment pattern** (lines 635-645):
```js
export function ledgerCovers(ledger, refMsg, extMsg, scenarioName) {
  for (const entry of ledger) {
    if (entry.kind !== 'mismatch') continue;
    try {
      if (entry.appliesTo(refMsg, extMsg, scenarioName)) return entry.id;
    } catch (e) {
      // A broken predicate must never silently excuse an undeclared divergence.
    }
  }
  return null;
}
```

**Apply to Phase 9:** add a narrowly scoped CSSOM-mode divergence entry only for opt-in CSSOM scenarios. Predicate should match `styleStrategy` / `styleSources` / style-source mutation differences, not default-mode computed output.

## Shared Patterns

### No Authentication

No Phase 9 files have an auth/authorization analog. This project boundary is capture/renderer protocol security, not user auth. Apply security controls through sanitization, sandboxing, explicit adapter capabilities, and content-free diagnostics.

### Config-Gated Additive Behavior

**Source:** `src/capture/index.js` lines 452-469

Apply `styleMode: "cssom"` as a factory option with default computed behavior. Follow the existing pattern where factory-time validation can throw, while runtime misses are logged and fail soft.

### CSS Sanitization Chokepoints

**Sources:** `src/capture/index.js` lines 2478-2484; `src/renderer/sanitize.js` lines 166-192; `src/renderer/snapshot.js` lines 141-146

Apply to every CSSOM CSS text path: readable `cssRules`, inline `<style>`, fetched CSS, constructable/adopted stylesheet text, fallback CSS blocks, and style-source mutation replacements.

### Scoped Sidecars

**Sources:** `src/capture/index.js` lines 1081-1098; `src/renderer/index.js` lines 686-719 and 744-796

Document, shadow-root, and frame CSS sources must remain scoped. Shadow CSS belongs in the reconstructed `ShadowRoot`; frame CSS belongs in the nested frame document. Do not flatten all sources into the top document head.

### Mutation Envelope

**Sources:** `src/protocol/messages.js` lines 17-76; `src/capture/index.js` lines 3471-3500; `src/renderer/diff.js` lines 161-228

Style updates should be diffs inside `STREAM.MUTATIONS` with `streamSessionId` and `snapshotId`, not a new relay channel.

### Browser Artifact Sync

**Sources:** `src/adapters/playwright.js` lines 24-44; `src/adapters/browser-inject.js` lines 8-17; `tests/adapter-exports.test.js` lines 16-25

After changing capture/protocol code, keep `src/adapters/playwright-inject.js` synchronized. The browser and bookmarklet paths consume this artifact, so tests must exercise the checked-in script.

### Test Harness Discipline

**Sources:** `tests/capture-added-styles.test.js` lines 12-67; `tests/renderer-iframe.test.js` lines 115-122; `tests/playwright-fidelity-phase8.test.js` lines 10-67

Use duplicated local helpers, explicit teardown, `pretendToBeVisual` for jsdom rAF, manual srcdoc glue for renderer tests, and real Playwright Chromium for CSSOM browser behavior.

## No Analog Found

All target files have close role analogs. One behavior has no exact implementation analog:

| File/Concern | Role | Data Flow | Reason |
|--------------|------|-----------|--------|
| Constructable stylesheet mutation hooks inside `src/capture/index.js` | service | event-driven | Existing code observes DOM mutations and shadow/frame roots, but has no current `CSSStyleSheet.prototype.insertRule/deleteRule/replace/replaceSync` wrapper or `adoptedStyleSheets` reconciliation path. Use the existing rAF mutation batching and fail-soft diagnostic patterns. |

## Metadata

**Analog search scope:** `src/`, `tests/`, `docs/`, `.planning/`
**Files scanned:** 281
**Strong analogs read:** `src/capture/index.js`, `src/protocol/messages.js`, `src/renderer/snapshot.js`, `src/renderer/index.js`, `src/renderer/diff.js`, `src/renderer/sanitize.js`, `src/adapters/playwright-inject.js`, `src/adapters/playwright.js`, `src/adapters/browser-inject.js`, `src/adapters/bookmarklet.js`, `tests/capture-added-styles.test.js`, `tests/capture-iframe.test.js`, `tests/capture-shadow-dom.test.js`, `tests/renderer-iframe.test.js`, `tests/renderer-shadow-dom.test.js`, `tests/renderer-diff.test.js`, `tests/security-sanitize-capture.test.js`, `tests/security-sanitize-render.test.js`, `tests/security-chokepoint-purity.test.js`, `tests/playwright-fidelity-phase8.test.js`, `tests/protocol.test.js`, `tests/adapter-exports.test.js`, `tests/differential/oracle.test.js`, `tests/differential/divergence-ledger.js`
**Pattern extraction date:** 2026-06-16
