// PhantomStream renderer overlays: host-document overlay layer, kind-keyed
// registry, and the parity built-ins (action glow, progress pill, dialog card).
//
// Behavioral port of the FSB reference viewer's overlay/dialog handlers
// (reference/dashboard/dashboard.js:3374-3443, shipped as FSB milestone
// v0.9.9.1), restructured behind the Phase 2 registry seam (02-RESEARCH.md
// Pattern 5): every non-identity key of a STREAM.OVERLAY payload is an
// overlay kind dispatched through ONE Map -- glow and progress are
// pre-registered through that same Map with zero special-cased dispatch
// (D-09/D-10), proving the registerOverlay extension seam by construction.
//
// Intentional divergences from the reference (renderer divergence ledger):
//   - Class names: the reference's dashboard-prefixed preview classes are
//     renamed to ps-overlay-* (02-UI-SPEC.md contract).
//   - Icons: the reference uses Font Awesome (an FSB dashboard asset); a
//     zero-dependency framework cannot ship an icon font, so the dialog
//     icons are equivalent inline SVGs (warning-triangle for alert,
//     question-circle for confirm, keyboard for prompt) -- UI-SPEC-locked.
//   - Accessibility additions: aria-hidden="true" on glow/progress
//     (decorative), role="status" aria-live="polite" on the dialog card.
//     The layer itself is NOT aria-hidden -- an aria-hidden ancestor would
//     suppress the dialog's live region.
//   - Glow reposition transitions are wrapped in
//     @media (prefers-reduced-motion: no-preference) (additive).
//
// Overlays render in the HOST document, positioned above the sandboxed
// iframe; they are never injected into the mirror document (CONTEXT-locked).
// Overlay payloads originate on the capture side (attacker-influenced page
// context): the built-ins write all message/label text via textContent,
// NEVER innerHTML (threat T-02-04). Custom renderFns receive the raw payload
// value and own their escaping (T-02-05; see register()).

/**
 * Single injected-CSS string for the overlay built-ins. The host (or
 * createViewer, plan 02-03) appends this as one <style> element -- no
 * external stylesheet, per the zero-dependency constraint. Every value is
 * the parity contract from 02-UI-SPEC.md (exact reference CSS for the
 * dialog card; documented reconstructions for the glow rect and progress
 * pill where the FSB stylesheet is not vendored).
 */
export var OVERLAY_CSS = [
  '.ps-overlay-glow {',
  '  position: absolute;',
  '  border: 2px solid #f59e0b;',
  '  border-radius: 4px;',
  '  box-shadow: 0 0 12px rgba(245, 158, 11, 0.6);',
  '  background: transparent;',
  '  pointer-events: none;',
  '  display: none; /* shown only while glow.state === \'active\' */',
  '}',
  '@media (prefers-reduced-motion: no-preference) {',
  '  .ps-overlay-glow {',
  '    transition: top 100ms ease, left 100ms ease, width 100ms ease, height 100ms ease;',
  '  }',
  '}',
  '.ps-overlay-progress {',
  '  position: absolute;',
  '  bottom: 8px;',
  '  left: 8px;',
  '  background: rgba(0, 0, 0, 0.75);',
  '  backdrop-filter: blur(4px);',
  '  -webkit-backdrop-filter: blur(4px);',
  '  color: #e0e0e0;',
  '  font: 600 13px/1.2 system-ui, sans-serif;',
  '  padding: 4px 12px;',
  '  border-radius: 6px;',
  '  max-width: calc(100% - 16px);',
  '  white-space: nowrap;',
  '  overflow: hidden;',
  '  text-overflow: ellipsis;',
  '  pointer-events: none;',
  '  display: none;',
  '}',
  '.ps-overlay-dialog {',
  '  position: absolute; top: 0; left: 0; right: 0; bottom: 0;',
  '  background: rgba(0, 0, 0, 0.5);',
  '  display: flex; align-items: center; justify-content: center;',
  '  pointer-events: none;',
  '  /* display: flex when open, none when closed */',
  '}',
  '.ps-overlay-dialog-card {',
  '  background: #1e1e2e;',
  '  border: 1px solid #333;',
  '  border-radius: 12px;',
  '  padding: 24px;',
  '  max-width: 320px;',
  '  width: 80%;',
  '  text-align: center;',
  '  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);',
  '}',
  '.ps-overlay-dialog-icon {',
  '  font-size: 28px; /* SVG icons: width/height 28px */',
  '  color: #f59e0b;',
  '  margin-bottom: 12px;',
  '}',
  '.ps-overlay-dialog-type {',
  '  font-size: 13px; font-weight: 600;',
  '  text-transform: uppercase; letter-spacing: 1px;',
  '  color: #888;',
  '  margin-bottom: 8px;',
  '}',
  '.ps-overlay-dialog-message {',
  '  font-size: 14px; color: #e0e0e0; line-height: 1.5;',
  '  word-break: break-word; max-height: 200px; overflow-y: auto;',
  '}'
].join('\n');

// Inline SVG dialog icons (Font Awesome replacement, UI-SPEC-locked
// divergence). 28px boxes per the parity icon size; fill: currentColor so
// the .ps-overlay-dialog-icon color (#f59e0b) applies. These are the ONLY
// markup strings assigned via innerHTML -- all capture-influenced text goes
// through textContent (T-02-04).
var ICON_SVG = {
  // alert: warning triangle
  alert: '<svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">'
    + '<path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/></svg>',
  // confirm: question circle
  confirm: '<svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">'
    + '<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 17h-2v-2h2v2z'
    + 'm2.07-7.75l-.9.92C13.45 12.9 13 13.5 13 15h-2v-.5c0-1.1.45-2.1 1.17-2.83l1.24-1.26'
    + 'c.37-.36.59-.86.59-1.41 0-1.1-.9-2-2-2s-2 .9-2 2H8c0-2.21 1.79-4 4-4s4 1.79 4 4'
    + 'c0 .88-.36 1.68-.93 2.25z"/></svg>',
  // prompt: keyboard
  prompt: '<svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">'
    + '<path d="M20 5H4c-1.1 0-1.99.9-1.99 2L2 17c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V7'
    + 'c0-1.1-.9-2-2-2zm-9 3h2v2h-2V8zm0 3h2v2h-2v-2zM8 8h2v2H8V8zm0 3h2v2H8v-2zm-1 2H5v-2h2v2z'
    + 'm0-3H5V8h2v2zm9 7H8v-2h8v2zm0-4h-2v-2h2v2zm0-3h-2V8h2v2zm3 3h-2v-2h2v2zm0-3h-2V8h2v2z"/></svg>'
};

/**
 * Map a rect from capture-page viewport coordinates into host-document
 * pixel coordinates over the scaled, letterboxed iframe. Pure parity math
 * (reference dashboard.js:3381-3384):
 *
 *   top    = offsetY + y * s
 *   left   = offsetX + x * s
 *   width  = w * s
 *   height = h * s
 *
 * @param {{x: number, y: number, w: number, h: number}} rect
 *   Rect in capture-page viewport coordinates.
 * @param {{s: number, offsetX: number, offsetY: number}} scale
 *   Scale state from the viewer's scale-to-fit (s = scale factor,
 *   offsetX/offsetY = letterbox offsets in host px).
 * @returns {{top: number, left: number, width: number, height: number}}
 *   Host-document pixel numbers (callers append 'px').
 */
export function mapRectToHost(rect, scale) {
  return {
    top: scale.offsetY + rect.y * scale.s,
    left: scale.offsetX + rect.x * scale.s,
    width: rect.w * scale.s,
    height: rect.h * scale.s
  };
}

/**
 * Per-message context handed to handleOverlayMessage by the viewer.
 * @typedef {Object} OverlayContext
 * @property {{s: number, offsetX: number, offsetY: number}} scale
 *   Current scale-to-fit state for coordinate mapping.
 * @property {(nid: number|string) => ({top: number, left: number, width: number, height: number}|null)} resolveNidRect
 *   Resolve a captured node id to a host-document rect (the viewer reads
 *   the mirrored element's bounding rect and maps it). Returns null when
 *   the nid no longer resolves (stale anchor).
 */

/**
 * Overlay system handle returned by createOverlays.
 * @typedef {Object} OverlaysHandle
 * @property {Element} layer
 *   The overlay layer element. The caller (createViewer) appends it into
 *   the viewer root as a sibling ABOVE the iframe; this module never
 *   touches the host DOM outside this subtree.
 * @property {(kind: string, renderFn: (payload: *, anchorRect: ?Object, layer: Element) => void) => void} register
 *   Register a renderer for an overlay kind (registry write; overwrites
 *   silently). See register() JSDoc for the renderFn contract.
 * @property {(payload: Object, ctx: OverlayContext) => void} handleOverlayMessage
 *   Dispatch one STREAM.OVERLAY payload through the registry.
 * @property {(payload: Object) => void} handleDialogMessage
 *   STREAM.DIALOG handler (dialog card show/hide).
 * @property {() => void} resetOverlays
 *   Hide all kinds (new-snapshot reset, dashboard.js:2762-2764 parity).
 */

/**
 * Create the overlay system: layer element, kind registry, and the three
 * pre-registered parity built-ins (glow, progress, dialog card).
 *
 * @param {{document: Document, logger?: {info: Function, warn: Function, error: Function}}} opts
 *   document is required (factory-time validation is the one place this
 *   module may throw, matching the capture factory precedent D-07);
 *   logger defaults to a console-backed logger.
 * @returns {OverlaysHandle}
 */
export function createOverlays(opts) {
  var cfg = opts || {};
  var doc = cfg.document;
  if (!doc || typeof doc.createElement !== 'function') {
    throw new Error('overlays-document-required');
  }
  var logger = cfg.logger || {
    info: function () { console.info.apply(console, arguments); },
    warn: function () { console.warn.apply(console, arguments); },
    error: function () { console.error.apply(console, arguments); }
  };

  // --- Layer: absolute, inset 0, clipped, input-transparent, above the
  // iframe (iframe z 1, layer z 2 per 02-UI-SPEC layer structure). ---
  var layer = doc.createElement('div');
  layer.style.position = 'absolute';
  layer.style.top = '0px';
  layer.style.left = '0px';
  layer.style.right = '0px';
  layer.style.bottom = '0px';
  layer.style.overflow = 'hidden';
  layer.style.pointerEvents = 'none';
  layer.style.zIndex = '2'; // iframe is z 1 inside the viewer root

  // --- Built-in elements. Sub-layer order (02-UI-SPEC): glow 10 <
  // progress 20 < dialog 30 (dialog topmost, reference parity). ---
  var glowEl = doc.createElement('div');
  glowEl.className = 'ps-overlay-glow';
  glowEl.style.zIndex = '10';
  glowEl.style.display = 'none';
  glowEl.setAttribute('aria-hidden', 'true'); // decorative highlight
  layer.appendChild(glowEl);

  var progressEl = doc.createElement('div');
  progressEl.className = 'ps-overlay-progress';
  progressEl.style.zIndex = '20';
  progressEl.style.display = 'none';
  progressEl.setAttribute('aria-hidden', 'true'); // decorative status pill
  layer.appendChild(progressEl);

  var dialogEl = doc.createElement('div');
  dialogEl.className = 'ps-overlay-dialog';
  dialogEl.style.zIndex = '30';
  dialogEl.style.display = 'none'; // 'flex' when open (parity show/hide)
  var dialogCardEl = doc.createElement('div');
  dialogCardEl.className = 'ps-overlay-dialog-card';
  dialogCardEl.setAttribute('role', 'status');
  dialogCardEl.setAttribute('aria-live', 'polite');
  var dialogIconEl = doc.createElement('div');
  dialogIconEl.className = 'ps-overlay-dialog-icon';
  dialogIconEl.innerHTML = ICON_SVG.alert; // default icon (alert parity)
  var dialogTypeEl = doc.createElement('div');
  dialogTypeEl.className = 'ps-overlay-dialog-type';
  var dialogMessageEl = doc.createElement('div');
  dialogMessageEl.className = 'ps-overlay-dialog-message';
  dialogCardEl.appendChild(dialogIconEl);
  dialogCardEl.appendChild(dialogTypeEl);
  dialogCardEl.appendChild(dialogMessageEl);
  dialogEl.appendChild(dialogCardEl);
  layer.appendChild(dialogEl);

  // --- Registry: ONE Map for every kind, built-ins included (D-09/D-10:
  // glow/progress dispatch through the exact same path custom kinds do). ---
  var registry = new Map();

  /**
   * Register a renderer for an overlay kind. Overwrites silently, so hosts
   * can replace a built-in if they want different visuals.
   *
   * renderFn contract (T-02-05): renderFn(payload, anchorRect, layer)
   * receives the RAW payload value from the wire -- capture-side data is
   * attacker-influenced, so custom renderFns own their escaping (write text
   * via textContent like the built-ins do, never innerHTML). anchorRect is
   * a host-document {top, left, width, height} rect or null (see
   * handleOverlayMessage for resolution rules). On new-snapshot reset the
   * renderFn is invoked with (null, null, layer) so it can clear its DOM.
   * Errors thrown by a renderFn are contained (routed to the logger) and
   * never break the message loop (T-02-07).
   *
   * @param {string} kind
   * @param {(payload: *, anchorRect: ?Object, layer: Element) => void} renderFn
   */
  function register(kind, renderFn) {
    registry.set(kind, renderFn);
  }

  /**
   * Containment wrapper for registry dispatch -- copies the
   * safeSkipElement shape from the capture core (src/capture/index.js:
   * 277-284): a throwing renderFn is routed to the injected logger and the
   * kind loop continues; the message dispatch never throws (T-02-07).
   * @param {string} kind
   * @param {Function} renderFn
   * @param {*} value
   * @param {?Object} anchorRect
   */
  function safeRenderOverlay(kind, renderFn, value, anchorRect) {
    try {
      renderFn(value, anchorRect, layer);
    } catch (err) {
      logger.error('[Renderer] overlay renderFn failed', kind, err);
    }
  }

  /**
   * Resolve a payload value to a host-document anchor rect. Priority per
   * 02-RESEARCH.md Pattern 5:
   *   1. value.nid          -> ctx.resolveNidRect(nid) (mirrored element);
   *                            a nid that no longer resolves yields null
   *                            (stale anchor -- no coordinate fallback).
   *   2. numeric x/y/w/h    -> mapRectToHost(value, ctx.scale) (glow parity
   *                            path, capture-page viewport coords).
   *   3. neither            -> null (fixed-position overlays).
   * @param {Object} value
   * @param {OverlayContext} ctx
   * @returns {?{top: number, left: number, width: number, height: number}}
   */
  function resolveAnchorRect(value, ctx) {
    if (!value || typeof value !== 'object' || !ctx) return null;
    if (value.nid !== undefined && value.nid !== null
        && typeof ctx.resolveNidRect === 'function') {
      return ctx.resolveNidRect(value.nid) || null;
    }
    if (typeof value.x === 'number' && typeof value.y === 'number'
        && typeof value.w === 'number' && typeof value.h === 'number'
        && ctx.scale) {
      return mapRectToHost(value, ctx.scale);
    }
    return null;
  }

  // --- Built-in renderers (registered through the same Map as custom
  // kinds). Each treats a null payload as "hide", which doubles as the
  // reset contract every renderFn follows. ---

  /**
   * Action-glow rect (reference dashboard.js:3379-3387). Visible only
   * while glow.state === 'active' AND an anchor rect resolved; positioned
   * via the mapped anchor rect.
   * @param {?Object} value
   * @param {?Object} anchorRect
   */
  function renderGlow(value, anchorRect) {
    if (value && value.state === 'active' && anchorRect) {
      glowEl.style.top = anchorRect.top + 'px';
      glowEl.style.left = anchorRect.left + 'px';
      glowEl.style.width = anchorRect.width + 'px';
      glowEl.style.height = anchorRect.height + 'px';
      glowEl.style.display = 'block';
    } else {
      glowEl.style.display = 'none';
    }
  }

  /**
   * Progress pill (reference dashboard.js:3390-3402). Exact parity text:
   * determinate -> 'Math.round(percent)% - phase'; otherwise
   * '(label || phase || Working) - (phase || Working)'. textContent only.
   * @param {?Object} value
   */
  function renderProgress(value) {
    if (value) {
      var phaseText = value.phase || 'Working';
      var progressText;
      if (value.mode === 'determinate' && typeof value.percent === 'number') {
        progressText = Math.round(value.percent) + '%';
      } else {
        progressText = value.label || phaseText || 'Working';
      }
      progressEl.textContent = progressText + ' - ' + phaseText;
      progressEl.style.display = 'block';
    } else {
      progressEl.style.display = 'none';
    }
  }

  register('glow', renderGlow);
  register('progress', renderProgress);

  /**
   * Dispatch one STREAM.OVERLAY payload. Every own key except the identity
   * keys (streamSessionId / snapshotId) is an overlay kind:
   *   - registered kind  -> safeRenderOverlay(renderFn, value, anchorRect)
   *                         (null values dispatch as null -> built-ins
   *                         hide, custom kinds clear)
   *   - unregistered     -> logged and ignored, never thrown (D-12,
   *                         forward-compatible).
   * @param {Object} payload
   * @param {OverlayContext} ctx
   */
  function handleOverlayMessage(payload, ctx) {
    if (!payload || typeof payload !== 'object') return;
    var kinds = Object.keys(payload);
    for (var i = 0; i < kinds.length; i++) {
      var kind = kinds[i];
      // Identity keys stamp stream identity on the wire; they are reserved
      // and never dispatched as kinds.
      if (kind === 'streamSessionId' || kind === 'snapshotId') continue;
      var renderFn = registry.get(kind);
      if (!renderFn) {
        logger.warn('[Renderer] unknown overlay kind ignored', kind);
        continue;
      }
      var value = (payload[kind] === undefined) ? null : payload[kind];
      var anchorRect = value ? resolveAnchorRect(value, ctx) : null;
      safeRenderOverlay(kind, renderFn, value, anchorRect);
    }
  }

  /**
   * Set the dialog icon by dialog type (inline-SVG divergence from the
   * reference's icon-font classes; unknown types fall back to alert).
   * @param {string} type
   */
  function setDialogIcon(type) {
    dialogIconEl.innerHTML = ICON_SVG[type] || ICON_SVG.alert;
  }

  /**
   * STREAM.DIALOG handler (reference dashboard.js:3405-3443). Parity
   * fallback: the dialog object may BE the payload (payload.dialog ||
   * payload, dashboard.js:3407). Open -> capitalized type label (default
   * 'Alert'), message via textContent (NEVER innerHTML -- T-02-04), icon by
   * type, backdrop display 'flex'. Closed -> display 'none'. Other states
   * are ignored (parity).
   * @param {Object} payload
   */
  function handleDialogMessage(payload) {
    var dialog = (payload && payload.dialog) || payload;
    if (!dialog) return;
    if (dialog.state === 'open') {
      var type = dialog.type || 'alert';
      dialogTypeEl.textContent = type.charAt(0).toUpperCase() + type.slice(1);
      dialogMessageEl.textContent = dialog.message || '';
      setDialogIcon(type);
      dialogEl.style.display = 'flex';
    } else if (dialog.state === 'closed') {
      dialogEl.style.display = 'none';
    }
  }

  /**
   * New-snapshot reset (D-13, reference dashboard.js:2762-2764): hide every
   * overlay kind. Every registered renderFn -- built-ins and custom alike --
   * is invoked with (null, null, layer) inside the containment wrapper
   * (built-ins hide on null; custom kinds clear their DOM), then the dialog
   * card is hidden.
   */
  function resetOverlays() {
    registry.forEach(function (renderFn, kind) {
      safeRenderOverlay(kind, renderFn, null, null);
    });
    dialogEl.style.display = 'none';
  }

  return {
    layer: layer,
    register: register,
    handleOverlayMessage: handleOverlayMessage,
    handleDialogMessage: handleDialogMessage,
    resetOverlays: resetOverlays
  };
}
