# Phase 2: Renderer Core + Embedded Loopback Mirror - Pattern Map

**Mapped:** 2026-06-10
**Files analyzed:** 16 (13 new, 3 modified)
**Analogs found:** 14 / 16 (2 with no in-repo analog — both have complete research-provided code)

Two analog classes exist for this phase and the planner must use BOTH per file:

1. **Port source** — `reference/dashboard/dashboard.js` is the behavioral source of truth (parity bar). Excerpts below are what the code must DO.
2. **Style/structure analog** — `src/capture/index.js` (Phase 1 extraction) is how the code must be WRITTEN: factory closure, injected seams, `var` + `||` defaulting, error containment via `safe*` wrappers, file-top provenance comment, JSDoc on every export.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/renderer/index.js` | component factory (`createViewer`) | event-driven (transport message dispatch) + request-response (resync CONTROL.START) | `src/capture/index.js` (structure) + `dashboard.js:2723-2829, 3194-3207` (behavior) | exact |
| `src/renderer/snapshot.js` | utility (pure HTML builder) | transform (payload → string) | `dashboard.js:2671-2800` (port source); `src/protocol/messages.js` (pure-module style) | exact |
| `src/renderer/diff.js` | utility (Document-parameterized applier) | transform (ops → DOM writes) | `dashboard.js:3209-3356` (port source) | exact |
| `src/renderer/overlays.js` | component (registry + built-in renderers) | event-driven (kind-keyed dispatch) | `dashboard.js:3374-3443` (built-ins port source); registry is new per RESEARCH Pattern 5 | exact (built-ins) / designed (registry) |
| `createLoopbackTransport` (location = planner's choice; RESEARCH puts it in `examples/` + test utility) | utility (transport, both ends) | pub-sub (Set fan-out) | `tests/differential/harness.js:221-229` + `tests/capture-skip.test.js:114-120`; full design in RESEARCH Pattern 1 | role-match |
| `examples/loopback-mirror.html` | demo page | event-driven | `tests/differential/fixtures/*.html` (weak — fixture pages only); contract in `02-UI-SPEC.md` | no close analog |
| `examples/serve.js` | utility (dep-free static server) | request-response (HTTP) | none in repo — complete code in RESEARCH Pattern 7 | no analog (research-provided) |
| `tests/renderer-snapshot.test.js` | test (pure unit) | n/a | `tests/capture-lifecycle.test.js` (flat node:test style) | role-match |
| `tests/renderer-diff.test.js` | test (unit, `createHTMLDocument` target) | n/a | `tests/capture-skip.test.js` (assertion style) | role-match |
| `tests/renderer-overlays.test.js` | test (jsdom unit) | n/a | `tests/capture-skip.test.js` | role-match |
| `tests/renderer-viewer.test.js` | test (factory/handle, jsdom) | n/a | `tests/capture-lifecycle.test.js` | exact |
| `tests/renderer-loopback.test.js` | test (e2e integration) | n/a | `tests/capture-skip.test.js` (setupEnv) + `tests/differential/harness.js:282-286` (settle) | exact |
| `tests/renderer-purity.test.js` | test (static scan) | n/a | `tests/capture-purity.test.js` | exact (near-verbatim copy) |
| `package.json` (modify) | config | n/a | itself — existing `exports`/`scripts` shape | exact |
| `src/renderer/README.md` (rewrite) | docs | n/a | `src/capture/README.md` | exact |
| `src/capture/index.js` (optional modify — RESEARCH Open Question 2, overlay key forwarding) | service edit | n/a | itself, `broadcastOverlayState` lines 1139-1167 | exact |

## Pattern Assignments

### `src/renderer/index.js` (component factory, event-driven dispatch)

**Structure analog:** `src/capture/index.js` — copy the factory skeleton wholesale.

**File-top provenance comment** (`src/capture/index.js:1-35`, abbreviated — replicate this shape: what it is, where extracted from, which seams applied, which divergences are intentional):

```javascript
// PhantomStream capture core: DOM snapshot + MutationObserver diff streaming.
//
// Single-file extraction of the FSB reference implementation
// (reference/extension/dom-stream.js, shipped as FSB milestone v0.9.9.1).
// Behavior is ported verbatim (parity-only, decision D-11) with exactly two
// kinds of seams applied:
//
//   1. Transport seam (D-07): every chrome.runtime.sendMessage call becomes
//      transport.send(type, payload) on the host-injected Transport. ...
```

**Imports pattern** (`src/capture/index.js:37-47` — protocol constants imported, never redefined; explicit `.js` extensions):

```javascript
import {
  RELAY_PER_MESSAGE_LIMIT_BYTES,
  SNAPSHOT_BUDGET_BYTES,
  // ...
} from '../protocol/constants.js';
import { STREAM, NID_ATTR, createStreamSessionId } from '../protocol/messages.js';
```

The viewer's equivalent: `import { STREAM, CONTROL, NID_ATTR, isCurrentStream } from '../protocol/messages.js';`

**Factory-time validation + injected defaults** (`src/capture/index.js:216-233` — the ONE place allowed to throw; `var` + `||` defaulting):

```javascript
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
```

Viewer additions at factory time: validate `container` (e.g. `Error('viewer-container-required')`), validate `transport.send` AND `transport.onMessage`, and the sandbox assertion (RESEARCH §Sandbox assertion):

```javascript
iframe.setAttribute('sandbox', 'allow-same-origin');
var tokens = (iframe.getAttribute('sandbox') || '').trim().split(/\s+/);
if (tokens.length !== 1 || tokens[0] !== 'allow-same-origin') {
  throw new Error('viewer-sandbox-invalid');
}
```

**Error containment wrapper** (`src/capture/index.js:294-305` — every transport touch goes through a `safe*` function; errors routed to logger, never propagate):

```javascript
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

Viewer log prefix should be its own (e.g. `'[Renderer]'` — RESEARCH uses `[Renderer]` for the unknown-overlay warning).

**JSDoc typedef + options-table discipline** (`src/capture/index.js:142-203` — `@typedef` blocks for Transport/Options/Handle, design constraints inline). Viewer transport typedef is already designed (RESEARCH Pattern 1):

```javascript
/**
 * @typedef {Object} ViewerTransport
 * @property {(type: string, payload: Object) => void} send
 *   Viewer -> capture host (CONTROL.* / dash:* messages). Fire-and-forget,
 *   mirrors the capture Transport.send contract. Errors contained to logger.
 * @property {(handler: (type: string, payload: Object) => void) => (() => void)} onMessage
 *   Subscribe to capture-host -> viewer (ext:*) messages. Returns unsubscribe.
 *   destroy() calls the unsubscribe.
 */
```

**Handle return shape** (`src/capture/index.js:1244-1250` — plain object of named functions):

```javascript
return {
  detach: detach,
  destroy: destroy
};
```

**Behavior port targets (the message dispatch loop):**

*Staleness guard* — do NOT port `shouldAcceptPreviewMessage` (`dashboard.js:206-246`, carries tabId checks + `recordDashboardTransportEvent` — both FSB-droppable). Use the already-extracted equivalent `isCurrentStream` (`src/protocol/messages.js:104-115`):

```javascript
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

Note: snapshots are never staleness-checked — they DEFINE the new identity (`dashboard.js:2742-2756` adopts identity from the snapshot payload). Dialog identity is nested inside `payload.dialog`, so the top-level check always accepts dialogs (reference quirk, RESEARCH Pitfall 8 — port parity or diverge explicitly).

*Generation-state reset on new snapshot* (`dashboard.js:200-204`):

```javascript
function resetPreviewGenerationState() {
  staleMutationCount = 0;
  mutationApplyFailures = 0;
  previewResyncPending = false;
}
```

*Resync request* (`dashboard.js:248-278`, stripped of FSB) — keep the latch + CONTROL.START; DROP `dash:request-status`, `setPreviewLoadingText`, `setPreviewState`, `armPreviewRecoveryWatchdog`, `recordDashboardTransportEvent`:

```javascript
function requestPreviewResync(reason, details) {
  if (previewResyncPending) return false;     // latch: one in-flight request
  previewResyncPending = true;
  // ... FSB chrome dropped ...
  var streamStartSent = sendDashboardWSMessage('dash:dom-stream-start', {  // -> safeSend(CONTROL.START, {...})
    trigger: 'preview-resync',
    reason: reason || 'unknown'
  });
  // ...
}
```

Latch resets only in `resetPreviewGenerationState()` on the next snapshot. RESEARCH Pattern 2: the message IS `CONTROL.START` (`'dash:dom-stream-start'`) — `dash:request-snapshot` does not exist.

*Snapshot handler sequence* (`dashboard.js:2723-2829` — the exact srcdoc + onload sequence; keep the per-snapshot overlay reset at 2762-2764 and scroll store at 2758-2759):

```javascript
activePreviewStreamSessionId = identity.streamSessionId || '';
activePreviewSnapshotId = identity.snapshotId || 0;
resetPreviewGenerationState();
lastPreviewScroll.x = payload.scrollX || 0;
lastPreviewScroll.y = payload.scrollY || 0;
// Reset glow, progress, and dialog overlays on new snapshot
// ...
previewIframe.srcdoc = fullHTML;
previewIframe.onload = function() {
  updatePreviewScale();
  try {
    previewIframe.contentWindow.scrollTo(payload.scrollX || 0, payload.scrollY || 0);
  } catch (e) { /* cross-origin fallback */ }
  setPreviewState('streaming');   // viewer: minimal 'waiting' | 'streaming' gate
};
```

Missing `payload.html` → log error and keep last good frame (reference sets error state, `dashboard.js:2724-2730` — Phase 2 has no state UI; logger only).

*Scale-to-fit* (`dashboard.js:2859-2868` is the parity core; DROP the layout-mode branches at 2839-2857 — layout modes are CONTEXT-dropped):

```javascript
previewScale = Math.min(stageWidth / pageWidth, stageHeight / pageHeight);
if (!Number.isFinite(previewScale) || previewScale <= 0) previewScale = 1;
previewOffsetX = Math.max(0, (stageWidth - (pageWidth * previewScale)) / 2);
previewOffsetY = Math.max(0, (stageHeight - (pageHeight * previewScale)) / 2);

previewIframe.style.width = pageWidth + 'px';
previewIframe.style.height = pageHeight + 'px';
previewIframe.style.left = previewOffsetX + 'px';
previewIframe.style.top = previewOffsetY + 'px';
previewIframe.style.transform = 'scale(' + previewScale + ')';
```

Factor as pure `computeScale(pageW, pageH, containerW, containerH)` per RESEARCH Pattern 3 (jsdom testability). Page-size source (`dashboard.js:2834-2835`): `viewportWidth || pageWidth || 1920` and `viewportHeight || 1080`, each `Math.max(1, ...)`.

*Resize wiring with typeof guard* (`dashboard.js:3194-3207` — keep both listeners; ResizeObserver MUST be typeof-guarded, jsdom lacks it):

```javascript
window.addEventListener('resize', function() {
  if (previewState === 'streaming') {
    updatePreviewScale();
  }
});

// ResizeObserver for more accurate scaling when container resizes independently
if (typeof ResizeObserver !== 'undefined' && previewContainer) {
  new ResizeObserver(function() {
    if (previewState === 'streaming') {
      updatePreviewScale();
    }
  }).observe(previewContainer);
}
```

*Scroll handler* (`dashboard.js:3358-3372` — store first, gate second, smooth scroll in try/catch):

```javascript
function handleDOMScroll(payload) {
  if (!shouldAcceptPreviewMessage(payload, 'ext:dom-scroll')) return;   // -> isCurrentStream
  lastPreviewScroll.x = payload.scrollX || 0;
  lastPreviewScroll.y = payload.scrollY || 0;

  if (previewState !== 'streaming' || !previewIframe) return;
  try {
    previewIframe.contentWindow.scrollTo({
      left: lastPreviewScroll.x,
      top: lastPreviewScroll.y,
      behavior: 'smooth'
    });
  } catch (e) { /* ignore */ }
}
```

Critical detail: `contentDocument`/`contentWindow` are read FRESH in each handler call (`dashboard.js:3215, 3341, 3366`) — never cached at onload (RESEARCH anti-pattern; also what makes the jsdom write-glue e2e test possible).

---

### `src/renderer/snapshot.js` (pure HTML builder, transform)

**Port source:** `dashboard.js:2671-2694` (escaper + shell attrs — port VERBATIM, the name regex and style/on* drop are part of the parity contract) and `dashboard.js:2783-2800` (document assembly).

**Escaper + shell attribute string** (`dashboard.js:2671-2694`):

```javascript
function escapePreviewAttribute(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function buildShellAttributeString(attrs, styleText) {
  var parts = [];
  if (attrs && typeof attrs === 'object') {
    Object.keys(attrs).forEach(function(rawName) {
      var name = String(rawName || '').toLowerCase();
      if (!/^[a-z][a-z0-9_:.~-]*$/.test(name)) return;
      if (name === 'style' || name.indexOf('on') === 0) return;
      var value = attrs[rawName];
      if (value === undefined || value === null) return;
      parts.push(name + '="' + escapePreviewAttribute(value) + '"');
    });
  }
  var style = String(styleText || '').trim();
  if (style) parts.push('style="' + escapePreviewAttribute(style) + '"');
  return parts.length ? ' ' + parts.join(' ') : '';
}
```

**Document assembly** (`dashboard.js:2785-2800` — stylesheet links escape only `"`; inline styles are RAW, a documented Phase-3 gap per RESEARCH Pitfall 9; `payload.html` is inserted raw per parity):

```javascript
var stylesheetLinks = (payload.stylesheets || []).map(function(url) {
  return '<link rel="stylesheet" href="' + url.replace(/"/g, '&quot;') + '">';
}).join('\n');

var inlineStyleTags = (payload.inlineStyles || []).map(function(css) {
  return '<style>' + css + '</style>';
}).join('\n');

var htmlAttrs = buildShellAttributeString(payload.htmlAttrs, payload.htmlStyle);
var bodyAttrs = buildShellAttributeString(payload.bodyAttrs, payload.bodyStyle);
var fullHTML = '<!DOCTYPE html><html' + htmlAttrs + '><head><meta charset="UTF-8">' +
  '<meta name="viewport" content="width=' + (payload.viewportWidth || 1920) + '">' +
  stylesheetLinks +
  inlineStyleTags +
  '<style>body { margin: 0; overflow: hidden; } *::selection { background: transparent; } ::-webkit-scrollbar { display: none; }</style>' +
  '</head><body' + bodyAttrs + '>' + payload.html + '</body></html>';
```

**Module style analog:** `src/protocol/messages.js` — pure named exports, JSDoc with `@param`/`@returns`, no DOM access, no module-level side effects.

---

### `src/renderer/diff.js` (Document-parameterized applier, transform)

**Port source:** `dashboard.js:3209-3356`. The per-op structure (querySelector by nid → miss counting → apply; per-op try/catch so one bad op never kills the batch; whole-batch catch → immediate resync). DROP every `recordDashboardTransportEvent`/`recordDashboardTransportError` call — replace with counter increments + `logger.warn`.

**Add op** (`dashboard.js:3221-3251` — the canonical shape; `rm`/`attr`/`text` at 3253-3319 follow the same miss-then-apply pattern):

```javascript
case 'add': {
  var parent = doc.querySelector('[data-fsb-nid="' + m.parentNid + '"]');
  if (!parent) {
    staleMutationCount += 1;
    // [FSB transport-event call dropped -> counters + logger.warn]
    if (staleMutationCount >= 3) {
      requestPreviewResync('stale-mutation-parent', { /* ... */ });
    }
    break;
  }
  var temp = doc.createElement('div');
  temp.innerHTML = m.html;
  var newNode = temp.firstElementChild;
  if (!newNode) break;
  if (m.beforeNid) {
    var before = doc.querySelector('[data-fsb-nid="' + m.beforeNid + '"]');
    parent.insertBefore(newNode, before);   // null before == appendChild
  } else {
    parent.appendChild(newNode);
  }
  break;
}
```

Use `NID_ATTR` from protocol in place of the literal `data-fsb-nid`. `attr` op nuance (`dashboard.js:3292-3296`): `m.val === null` → `removeAttribute`, else `setAttribute`.

**Per-op failure containment + threshold** (`dashboard.js:3321-3336`):

```javascript
} catch (e) {
  mutationApplyFailures += 1;
  // Skip individual mutation errors -- don't break the whole batch
  if (mutationApplyFailures >= 2) {
    requestPreviewResync('dom-mutation-apply-failed', { /* op, nid */ });
  }
}
```

**Post-batch scroll re-apply** (`dashboard.js:3339-3342` — exactly once per batch, never per op; performance lesson):

```javascript
// Maintain scroll position after DOM changes
try {
  previewIframe.contentWindow.scrollTo(lastPreviewScroll.x, lastPreviewScroll.y);
} catch (e) { /* ignore */ }
```

**Whole-batch catch** (`dashboard.js:3343-3355`): increment `mutationApplyFailures`, keep showing last good content (no state change), `requestPreviewResync('dom-mutation-batch-failed', ...)` immediately.

Factor as `applyMutations(doc, mutations, counters, ...)` taking any `Document` (RESEARCH Pattern 3 — unit tests use `document.implementation.createHTMLDocument()`). Thresholds (parity): stale misses `>= 3`, apply failures `>= 2`, batch failure → immediate.

---

### `src/renderer/overlays.js` (registry + built-ins, event-driven dispatch)

**Built-in port sources:**

*Glow* (`dashboard.js:3379-3387` — `state === 'active'` gate; the coordinate-mapping formula is the shared overlay contract):

```javascript
if (payload.glow && payload.glow.state === 'active' && previewGlow) {
  previewGlow.style.display = '';
  previewGlow.style.top = (previewOffsetY + payload.glow.y * previewScale) + 'px';
  previewGlow.style.left = (previewOffsetX + payload.glow.x * previewScale) + 'px';
  previewGlow.style.width = (payload.glow.w * previewScale) + 'px';
  previewGlow.style.height = (payload.glow.h * previewScale) + 'px';
} else if (previewGlow) {
  previewGlow.style.display = 'none';
}
```

*Progress* (`dashboard.js:3390-3402` — textContent only, determinate/indeterminate branch):

```javascript
var phaseText = payload.progress.phase || 'Working';
var progressText;
if (payload.progress.mode === 'determinate' && typeof payload.progress.percent === 'number') {
  progressText = Math.round(payload.progress.percent) + '%';
} else {
  progressText = payload.progress.label || phaseText || 'Working';
}
previewProgress.textContent = progressText + ' - ' + phaseText;
```

*Dialog card* (`dashboard.js:3405-3443` — `payload.dialog || payload` fallback; capitalized type label; message via `textContent` NEVER innerHTML; icon by type; show `flex` / hide `none`):

```javascript
var dialog = payload.dialog || payload;
if (!dialog) return;
if (dialog.state === 'open') {
  var typeLabel = (dialog.type || 'alert').charAt(0).toUpperCase() + (dialog.type || 'alert').slice(1);
  previewDialogType.textContent = typeLabel;
  previewDialogMessage.textContent = dialog.message || '';
  // icon by type: confirm -> question, prompt -> keyboard, default alert -> warning triangle
  previewDialog.style.display = 'flex';
} else if (dialog.state === 'closed') {
  previewDialog.style.display = 'none';
}
```

DROP `fa-solid fa-*` icon classes (`dashboard.js:3425-3431`) — replace with 3 inline SVGs (UI-SPEC-locked divergence). Class names are `ps-overlay-*` per UI-SPEC, not `dash-preview-*`.

**Registry (new design — RESEARCH Pattern 5, no in-repo analog; the precedent for "Set/Map of handlers" is the relay room model):** every non-identity key of the OVERLAY payload is a kind; `registry.has(kind) ? renderFn(payload[kind], anchorRect, layer) : logger.warn('[Renderer] unknown overlay kind ignored', kind)`. Null-valued kinds hide the built-in. All kinds reset (hidden) on new snapshot (`dashboard.js:2762-2764`).

**Containment pattern for custom renderFns:** wrap registry dispatch in try/catch routed to logger, copying `safeSkipElement` (`src/capture/index.js:277-284`):

```javascript
function safeSkipElement(el) {
  try {
    return skipElement(el);
  } catch (err) {
    logger.error('[DOM Stream] skipElement predicate failed', err);
    return false;
  }
}
```

(Same shape: `safeRenderOverlay(kind, ...)` — a throwing custom renderFn must never break the message loop. "Unknown overlay kinds: logged and ignored (forward-compatible; never throw)" is CONTEXT-locked.)

---

### `createLoopbackTransport` (utility, pub-sub fan-out)

**Precedent 1 — recording loopback** (`tests/differential/harness.js:221-229`; same minimal shape duplicated locally in `tests/capture-skip.test.js:114-120`):

```javascript
// Loopback transport: records { type, payload } verbatim. NO flush
// property -- the typeof-guarded no-op default in the core is the path
// under test (phase success criterion 2).
const sent = [];
const loopback = {
  send(type, payload) {
    sent.push({ type, payload });
  },
};
```

**Full both-ends design:** RESEARCH Pattern 1 provides complete, copyable code (`captureTransport.send` → viewer handler Set; `viewerTransport.send` → control handler Set; `onMessage(h) → unsubscribe` via `Set.delete`; optional `queueMicrotask` hop to break re-entrancy). Style: `var` + function expressions matching capture core.

**Location:** planner's choice — RESEARCH puts it in `examples/` plus a test-local copy. Phase 1 test convention is "deliberately duplicated locally (parallel-safe: this file imports nothing from any shared test harness)" (`tests/capture-skip.test.js:17-18`) — if the demo and tests both need it, either duplicate per the convention or place one importable module; do not import from `tests/` into `examples/`.

---

### `examples/loopback-mirror.html` + `examples/serve.js` (demo page + static server)

**No close in-repo analog.** `tests/differential/fixtures/*.html` are capture fixtures, not module-importing demo pages.

- `serve.js`: complete ~40-line implementation in RESEARCH Pattern 7 (`node:http`, repo-root serving, MIME map with `text/javascript` for `.js`/`.mjs`, path-traversal guard, prints demo URL on listen). npm script `"example:loopback": "node examples/serve.js"`.
- Demo page wiring order (RESEARCH Pattern 4 — order matters, loopback has no buffering): `createLoopbackTransport()` → `createViewer(...)` (DOM exists + skip-marked) → `createCapture({ transport, skipElement })` → `transport.onControl(CONTROL.START → capture.start())` → `capture.start()`.
- Recursion guard (the #1 hazard): viewer stamps `data-phantomstream-ui="viewer"` on its root (precedent: reference's `isFsbOverlay` used `closest('[data-fsb-overlay]')`, noted at `src/capture/index.js:236-243`); demo passes an attribute-based predicate — NEVER object-identity (`safeSkipElement` runs on detached clones during serialization, live elements during diffing — `src/capture/index.js:627` vs `:880`):

```javascript
skipElement: function (el) {
  return !!(el.getAttribute && el.getAttribute('data-phantomstream-ui'));
}
```

---

### `tests/renderer-*.test.js` (six test files)

**Primary analog:** `tests/capture-skip.test.js` and `tests/capture-lifecycle.test.js` — both carry the complete, proven recipe. The four local helpers are deliberately duplicated per file (parallel-safe convention, stated at `tests/capture-skip.test.js:17-20`).

**File-top comment + imports** (`tests/capture-skip.test.js:1-26`):

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM, VirtualConsole } from 'jsdom';
import { createCapture } from '../src/capture/index.js';
import { STREAM, DIFF_OP, NID_ATTR } from '../src/protocol/messages.js';
```

**setupEnv: JSDOM + globals swap + try/finally teardown** (`tests/capture-skip.test.js:53-98` — copy whole; for viewer tests the AUDITED_GLOBALS list needs the viewer's ambient set, e.g. no `getComputedStyle`/`NodeFilter` needed but keep `window`/`document`/`Node`):

```javascript
const dom = new JSDOM(
  '<!DOCTYPE html><html><head><title>skip fixture</title></head><body>'
    + bodyHtml + '</body></html>',
  {
    url: 'https://fixture.test/page',
    pretendToBeVisual: true, // enables requestAnimationFrame for the rAF flush
    virtualConsole: new VirtualConsole(), // quiet: swallows "Not implemented" noise
  }
);
// ... record prior globals (present + value), assign from window,
// teardown(): stop capture FIRST, restore every global, w.close()
```

`VirtualConsole` is mandatory for any test touching `contentWindow.scrollTo` (RESEARCH Pitfall 7).

**settle cadence** (`tests/capture-skip.test.js:105-109`, identical in `harness.js:282-286`):

```javascript
async function settle(win) {
  await new Promise((resolve) => setTimeout(resolve, 0));             // observer delivery
  await new Promise((resolve) => win.requestAnimationFrame(resolve)); // rAF flush fires
  await new Promise((resolve) => setTimeout(resolve, 20));            // send chains settle
}
```

**Recording-logger assertion pattern** (`tests/capture-skip.test.js:214-219` — how to assert "warned but did not throw", needed for unknown-overlay-kind and miss-accounting tests):

```javascript
const errors = [];
const recordingLogger = {
  info() {},
  warn() {},
  error(...args) { errors.push(args); },
};
```

**Test-body shape** (`tests/capture-skip.test.js:126-165` — flat `test(...)`, env in try/finally, message filtering by `STREAM.*` type, descriptive assertion messages):

```javascript
test('root-only skipElement predicate excludes ...', async () => {
  const env = setupEnv(BODY_HTML);
  try {
    const transport = createLoopbackTransport();
    env.capture = createCapture({ transport, logger: silentLogger(), skipElement: ... });
    env.capture.start();
    const snapshots = transport.sent.filter((m) => m.type === STREAM.SNAPSHOT);
    assert.equal(snapshots.length, 1, 'start() emits exactly one snapshot');
    // ...
  } finally {
    env.teardown();
  }
});
```

**Per-file specifics:**
- `renderer-snapshot.test.js` — pure string assertions, no JSDOM needed (`buildSnapshotHtml` is pure). Flat style still applies.
- `renderer-diff.test.js` — target `document.implementation.createHTMLDocument()` seeded via `body.innerHTML` (verified working in jsdom, RESEARCH Pattern 3). No iframe, no srcdoc.
- `renderer-loopback.test.js` — full recipe at RESEARCH §Loopback e2e test recipe, including the mandatory srcdoc glue: `cd.open(); cd.write(iframe.srcdoc); cd.close();` (jsdom never parses srcdoc — Pitfall 1). Send `STREAM.DIALOG` through the transport rather than running the interceptor.
- `renderer-viewer.test.js` — assert sandbox token list exactly `['allow-same-origin']`, srcdoc string content (not contentDocument), overlay layer structure, `{ detach, destroy }` handle shape, factory-time throws (`assert.throws` on bad container/transport — mirror `capture-lifecycle`'s contract-pinning intent).

---

### `tests/renderer-purity.test.js` (static scan)

**Analog:** `tests/capture-purity.test.js` — copy near-verbatim (all 56 lines), retargeted:

```javascript
const CAPTURE_DIR = fileURLToPath(new URL('../src/capture/', import.meta.url));
// -> const RENDERER_DIR = fileURLToPath(new URL('../src/renderer/', import.meta.url));

function stripComments(source) {
  // Remove /* ... */ block comments first, then // line comments
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

test('capture core exists', () => { /* anti-vacuous guard: >= 1 .js module */ });

test('capture core contains zero chrome.* and window.FSB references', () => {
  // assert.ok(!/\bchrome\s*\./.test(stripped), ...);
  // assert.ok(!/window\.FSB|\bFSB\b/.test(stripped), ...);
});
```

Keep both tests (the "exists" guard prevents a vacuous pass). Extend the regex list per RESEARCH Pitfall 10: `chrome.`, `\bFSB\b`, `fa-solid`, `dash-preview`, `WebSocket`, `recordDashboard`. The comment-stripping-before-scan trick is essential — provenance comments legitimately mention FSB.

---

### `package.json` (modify — config)

Existing shape to extend (`package.json:7-13`):

```json
"exports": {
  "./protocol": "./src/protocol/index.js",
  "./capture": "./src/capture/index.js"
},
"scripts": {
  "test": "node --test tests/*.test.js tests/differential/*.test.js"
}
```

Add `"./renderer": "./src/renderer/index.js"` and `"example:loopback": "node examples/serve.js"`. Flat `tests/renderer-*.test.js` naming means the test glob needs NO change.

---

### `src/renderer/README.md` (rewrite — docs)

**Analog:** `src/capture/README.md` — mirror its sections: one-paragraph identity + provenance; Factory usage block with import-from-package path; options table (Option / Required / Default / Purpose); contract sections; divergence list with ledger-style entries; "Behavioral changes queued" (known gaps → Phase 3: raw inline styles Pitfall 9, dialog identity quirk Pitfall 8, pre-onload mutation drop Pitfall 4); Environment note. Must explicitly document: layout modes dropped (host's responsibility), `dash:request-status` dropped, tabId checks dropped, transport-event ring buffers dropped, FA icons → inline SVGs.

---

### `src/capture/index.js` (optional modify — RESEARCH Open Question 2)

If the planner takes the recommended edit (forward ALL overlayProvider keys, not just glow/progress), the exact site is `broadcastOverlayState`, `src/capture/index.js:1145-1167`:

```javascript
var glow = null;
var progress = null;
try {
  if (overlayProvider) {
    var state = overlayProvider();
    if (state) {
      glow = state.glow || null;
      progress = state.progress || null;
    }
  }
} catch (e) { /* ignore */ }

safeSend(STREAM.OVERLAY, {
  glow: glow,
  progress: progress,
  streamSessionId: streamSessionId || '',
  snapshotId: currentSnapshotId || 0
});
```

Constraint: glow/progress must still default to `null` (reference wire shape with no provider — oracle-protected); identity keys must never be overwritten by provider keys. Re-run `npm test` (oracle) to prove wire safety; document in `src/capture/README.md`.

## Shared Patterns

### 1. Injected-seam error containment (`safe*` wrappers)
**Source:** `src/capture/index.js:277-320` (`safeSkipElement`, `safeSend`, `safeFlush`)
**Apply to:** `src/renderer/index.js` (transport send + onMessage handler dispatch), `src/renderer/overlays.js` (custom renderFn dispatch)
Rule: factory-time validation is the ONLY place allowed to throw (`Error('transport-send-required')` precedent → `'viewer-container-required'`, `'viewer-sandbox-invalid'`); after creation, every host-injected callable is wrapped in try/catch routed to `logger.error`, and the operation degrades (treated as not-skipped / message dropped / overlay skipped), never crashes the loop.

### 2. Protocol imports, never redefinitions
**Source:** `src/capture/index.js:37-47`; enforced by the purity-test pattern
**Apply to:** all `src/renderer/` files and the loopback transport
`STREAM`, `CONTROL`, `DIFF_OP`, `NID_ATTR`, `isCurrentStream` come from `../protocol/messages.js`. No string literals for wire types; no new protocol constants minted (the resync message is the existing `CONTROL.START`).

### 3. Cross-runtime function style
**Source:** `src/capture/index.js` throughout (and `src/protocol/envelope.js` precedent)
**Apply to:** all `src/renderer/` files
`var` declarations, `||` inline defaulting (`payload.scrollX || 0`, `cfg.logger || {...}`), function expressions over arrows inside ported code, named exports only, explicit `.js` import extensions, `UPPER_SNAKE_CASE` module constants with unit/derivation comments, JSDoc `@typedef` for payload/option shapes, file-top provenance comment naming the reference lines ported and the divergences taken.

### 4. jsdom test environment recipe
**Source:** `tests/capture-skip.test.js:30-124` (setupEnv + settle + loopback + silentLogger, AUDITED_GLOBALS, try/finally teardown)
**Apply to:** `tests/renderer-viewer.test.js`, `tests/renderer-overlays.test.js`, `tests/renderer-loopback.test.js` (pure tests skip JSDOM entirely)
Helpers duplicated locally per file (parallel-safe convention); `VirtualConsole` always; globals restored exactly (presence-aware delete); teardown stops/destroys the component FIRST while instance globals are still installed.

### 5. Miss accounting as health signal (counters + thresholds + latched resync)
**Source:** `dashboard.js:200-204` (reset), `3224-3238` (count + threshold), `248-278` (latch + CONTROL.START)
**Apply to:** `src/renderer/diff.js` + `src/renderer/index.js`
Counters reset on every new snapshot; stale misses `>= 3` or apply failures `>= 2` → one latched resync send; whole-batch failure → immediate resync; the latch (`previewResyncPending`) releases only on the next snapshot. README hard requirement: health signal, not silent drift.

### 6. Divergence documentation discipline
**Source:** `src/capture/README.md:66-95` (ledger-derived divergence entries D1/D4/D5 + "Behavioral changes queued" section)
**Apply to:** `src/renderer/README.md`
Every intentional departure from `dashboard.js` behavior (dropped FSB chrome, FA→SVG icons, layout modes, `dash:request-status`, dialog-identity choice, optional dialog linger) gets an explicit entry — "either way it must be explicit, not accidental" (RESEARCH Pitfall 8).

## No Analog Found

Files with no close match in the codebase (planner should use RESEARCH.md patterns instead):

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `examples/serve.js` | utility (static HTTP server) | request-response | No server code in this repo outside `reference/server/ws-handler.js` (WS-only, CJS, wrong pattern). Complete implementation provided in RESEARCH Pattern 7. |
| `examples/loopback-mirror.html` | demo page | event-driven | No module-importing HTML pages exist; fixtures are capture-input-only. Layout/content contract lives in `02-UI-SPEC.md`; wiring order in RESEARCH Pattern 4. |

The overlay registry inside `src/renderer/overlays.js` is also genuinely new (no registry exists anywhere in the codebase) — its design is fully specified in RESEARCH Pattern 5; the closest structural precedent is the relay's `Set`-based fan-out room model.

## Metadata

**Analog search scope:** `src/` (all), `tests/` (all), `reference/dashboard/dashboard.js` (targeted: 185-320, 2600-2900, 3190-3460 per RESEARCH line citations), `src/capture/README.md`, `package.json`
**Files scanned:** 13 read (3 targeted ranges of dashboard.js; 10 full files)
**Pattern extraction date:** 2026-06-10
**Companion documents the planner must pair with this map:** `02-RESEARCH.md` (jsdom constraints, designed seams, pitfalls), `02-UI-SPEC.md` (exact parity values — colors, radii, class names — intentionally not duplicated here)
