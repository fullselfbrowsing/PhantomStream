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
  '.ps-node-highlight {',
  '  position: absolute;',
  '  border: 2px solid #38bdf8;',
  '  border-radius: 4px;',
  '  box-shadow: 0 0 0 1px rgba(8, 47, 73, 0.55), 0 0 14px rgba(56, 189, 248, 0.45);',
  '  background: rgba(56, 189, 248, 0.12);',
  '  pointer-events: none;',
  '  display: none;',
  '}',
  '@media (prefers-reduced-motion: no-preference) {',
  '  .ps-node-highlight {',
  '    transition: top 80ms ease, left 80ms ease, width 80ms ease, height 80ms ease;',
  '  }',
  '}',
  '.ps-node-highlight-label {',
  '  position: absolute;',
  '  left: 0;',
  '  top: -24px;',
  '  max-width: 240px;',
  '  overflow: hidden;',
  '  text-overflow: ellipsis;',
  '  white-space: nowrap;',
  '  border-radius: 4px;',
  '  padding: 3px 7px;',
  '  background: rgba(8, 47, 73, 0.92);',
  '  color: #e0f2fe;',
  '  font: 600 12px/1.2 system-ui, sans-serif;',
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
  '}',
  // ---- Phase 13 (MEDIA-05): media affordance family (13-UI-SPEC States A/B/C).
  // Parity values reused verbatim from the glow/progress/dialog built-ins:
  // scrim rgba(0,0,0,0.5); pill rgba(0,0,0,0.75)+blur(4px)+radius 6px; accent
  // #f59e0b (reserved for the actionable control); text #e0e0e0; glow
  // 0 0 12px rgba(245,158,11,0.6); system-ui 13/600; play button >= 44x44.
  // State A: blocked-play scrim clipped to the element rect.
  '.ps-overlay-media-blocked {',
  '  position: absolute;',
  '  background: rgba(0, 0, 0, 0.5);',
  '  display: flex; align-items: center; justify-content: center;',
  '  pointer-events: none;', // the scrim is passive; only the button opts in
  '}',
  // State A: centered circular play button (the one actionable control).
  '.ps-overlay-media-button {',
  '  box-sizing: border-box;',
  '  min-width: 44px; min-height: 44px;',
  '  display: flex; align-items: center; justify-content: center;',
  '  border: 2px solid #f59e0b;',
  '  border-radius: 50%;',
  '  box-shadow: 0 0 12px rgba(245, 158, 11, 0.6);',
  '  background: transparent;',
  '  color: #f59e0b;', // currentColor for the inline-SVG play glyph
  '  cursor: pointer;',
  '  pointer-events: auto;',
  '}',
  '@media (prefers-reduced-motion: no-preference) {',
  '  .ps-overlay-media-button:hover, .ps-overlay-media-button:focus {',
  '    filter: brightness(1.1);',
  '  }',
  '}',
  // State B: unmute pill anchored bottom-left of the element rect.
  '.ps-overlay-media-unmute {',
  '  position: absolute;',
  '  display: inline-flex; align-items: center; gap: 4px;',
  '  background: rgba(0, 0, 0, 0.75);',
  '  backdrop-filter: blur(4px);',
  '  -webkit-backdrop-filter: blur(4px);',
  '  color: #e0e0e0;',
  '  font: 600 13px/1.2 system-ui, sans-serif;',
  '  padding: 4px 12px;',
  '  border-radius: 6px;',
  '  cursor: pointer;',
  '  pointer-events: auto;',
  '}',
  '.ps-overlay-media-unmute-icon {',
  '  display: inline-flex; color: #f59e0b;', // amber speaker glyph fill
  '}',
  '@media (prefers-reduced-motion: no-preference) {',
  '  .ps-overlay-media-unmute:hover, .ps-overlay-media-unmute:focus {',
  '    filter: brightness(1.1);',
  '  }',
  '}',
  // State C: passive poster-only caption (no accent, no pointer events).
  '.ps-overlay-media-poster {',
  '  position: absolute;',
  '  display: inline-flex; align-items: center;',
  '  background: rgba(0, 0, 0, 0.75);',
  '  backdrop-filter: blur(4px);',
  '  -webkit-backdrop-filter: blur(4px);',
  '  color: #e0e0e0;',
  '  font: 600 13px/1.2 system-ui, sans-serif;',
  '  padding: 4px 12px;',
  '  border-radius: 6px;',
  '  pointer-events: none;',
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

// Phase 13 media affordance glyphs (13-UI-SPEC: inline SVG, the zero-dependency
// Font-Awesome-replacement precedent of ICON_SVG above). fill: currentColor so
// the affordance accent (#f59e0b) applies. These are the ONLY innerHTML strings
// the media affordances assign -- every label is set via textContent.
var MEDIA_GLYPH = {
  // play triangle (centered in the blocked-play button)
  play: '<svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">'
    + '<path d="M8 5v14l11-7z"/></svg>',
  // muted speaker (line-sized for the unmute pill)
  mutedSpeaker: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">'
    + '<path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0'
    + 'c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06'
    + 'c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18'
    + 'v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/></svg>'
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
 * Map a host-document point over the scaled mirror back into captured-page
 * viewport CSS pixels. Letterbox/out-of-bounds points are classified before
 * rounding and clamping so hosts can reject non-dispatchable input.
 *
 * @param {{x: number, y: number}} point
 *   Host-stage point relative to the viewer root.
 * @param {{s?: number, offsetX?: number, offsetY?: number, pageW?: number, pageH?: number}} scale
 *   Scale state from the viewer. Missing page dimensions are treated as 0.
 * @returns {{inside: boolean, x: number|null, y: number|null}}
 *   Dispatchable viewport coordinates, or null coordinates when outside.
 */
export function mapHostPointToViewport(point, scale) {
  var p = point || {};
  var sc = scale || {};
  var s = (typeof sc.s === 'number' && isFinite(sc.s) && sc.s > 0) ? sc.s : 1;
  var offsetX = (typeof sc.offsetX === 'number' && isFinite(sc.offsetX)) ? sc.offsetX : 0;
  var offsetY = (typeof sc.offsetY === 'number' && isFinite(sc.offsetY)) ? sc.offsetY : 0;
  var pageW = (typeof sc.pageW === 'number' && isFinite(sc.pageW)) ? Math.max(0, sc.pageW) : 0;
  var pageH = (typeof sc.pageH === 'number' && isFinite(sc.pageH)) ? Math.max(0, sc.pageH) : 0;

  if (pageW <= 0 || pageH <= 0 ||
      typeof p.x !== 'number' || !isFinite(p.x) ||
      typeof p.y !== 'number' || !isFinite(p.y)) {
    return { inside: false, x: null, y: null };
  }

  var rawX = (p.x - offsetX) / s;
  var rawY = (p.y - offsetY) / s;
  if (rawX < 0 || rawY < 0 || rawX >= pageW || rawY >= pageH) {
    return { inside: false, x: null, y: null };
  }

  var maxX = Math.max(0, Math.floor(pageW) - 1);
  var maxY = Math.max(0, Math.floor(pageH) - 1);
  return {
    inside: true,
    x: Math.max(0, Math.min(maxX, Math.round(rawX))),
    y: Math.max(0, Math.min(maxY, Math.round(rawY)))
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
 * @property {(kind: string, payload: ?Object, ctx?: {anchorRect?: ?Object}) => void} show
 *   Drive a registered overlay kind directly from renderer state (the media
 *   affordances are renderer-state-driven, not wire-driven; 13-UI-SPEC). ctx
 *   carries the pre-resolved anchorRect. A null payload hides (reset contract).
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

  // --- Phase 13 media affordances (13-UI-SPEC States A/B/C). Siblings of the
  // built-ins, registered through the same Map. Elements are created lazily on
  // first show and persist across show/hide (a null payload hides -- the
  // universal reset contract). Interactive controls (blocked-play button,
  // unmute pill) set pointer-events:auto and invoke a payload.onActivate
  // callback on click + Enter/Space; the poster caption is passive. ALL text is
  // set via textContent; the ONLY innerHTML is the static MEDIA_GLYPH SVGs. ---
  var mediaBlockedEl = null;
  var mediaBlockedBtn = null;
  var mediaBlockedActivate = null; // current onActivate (re-pointed per show)
  var mediaUnmuteEl = null;
  var mediaUnmuteActivate = null;
  var mediaPosterEl = null;

  /**
   * Invoke a stored onActivate callback in containment -- a throwing host
   * handler routes to the logger and never breaks the affordance.
   * @param {?Function} fn
   */
  function safeActivate(fn) {
    if (typeof fn !== 'function') return;
    try { fn(); } catch (err) { logger.error('[Renderer] media affordance onActivate failed', err); }
  }

  /** Attach click + Enter/Space activation to an interactive control. */
  function wireActivation(el, getHandler) {
    el.addEventListener('click', function () { safeActivate(getHandler()); });
    el.addEventListener('keydown', function (ev) {
      if (ev && (ev.key === 'Enter' || ev.key === ' ' || ev.key === 'Spacebar')) {
        if (typeof ev.preventDefault === 'function') ev.preventDefault();
        safeActivate(getHandler());
      }
    });
  }

  /** Apply an anchor rect to an absolutely-positioned affordance element. */
  function anchorAffordance(el, anchorRect) {
    if (!anchorRect) return;
    el.style.top = anchorRect.top + 'px';
    el.style.left = anchorRect.left + 'px';
    el.style.width = anchorRect.width + 'px';
    el.style.height = anchorRect.height + 'px';
  }

  /**
   * State A -- blocked-play affordance. Non-null payload renders a scrim
   * clipped to the rect with a centered >=44x44 amber play button; null hides.
   * The button is the one actionable control (pointer-events:auto, role=button,
   * focusable, aria-label, inline-SVG play glyph). onActivate fires on
   * click/Enter/Space (a user gesture, so the re-issued play() is allowed).
   * @param {?Object} value
   * @param {?Object} anchorRect
   */
  function renderMediaBlocked(value, anchorRect) {
    if (!value) {
      if (mediaBlockedEl) mediaBlockedEl.style.display = 'none';
      mediaBlockedActivate = null;
      return;
    }
    if (!mediaBlockedEl) {
      mediaBlockedEl = doc.createElement('div');
      mediaBlockedEl.className = 'ps-overlay-media-blocked';
      mediaBlockedEl.style.zIndex = '25'; // above progress (20), below dialog (30)
      mediaBlockedBtn = doc.createElement('div');
      mediaBlockedBtn.className = 'ps-overlay-media-button';
      mediaBlockedBtn.setAttribute('role', 'button');
      mediaBlockedBtn.setAttribute('tabindex', '0');
      mediaBlockedBtn.setAttribute('aria-label', 'Play mirrored media');
      mediaBlockedBtn.style.pointerEvents = 'auto';
      // 44x44 hit-target floor set inline so it holds regardless of CSS
      // delivery (13-UI-SPEC; the button auto-grows to this minimum even over a
      // small <audio> rect).
      mediaBlockedBtn.style.minWidth = '44px';
      mediaBlockedBtn.style.minHeight = '44px';
      mediaBlockedBtn.innerHTML = MEDIA_GLYPH.play; // static glyph -- ONLY innerHTML
      wireActivation(mediaBlockedBtn, function () { return mediaBlockedActivate; });
      mediaBlockedEl.appendChild(mediaBlockedBtn);
      layer.appendChild(mediaBlockedEl);
    }
    mediaBlockedActivate = (typeof value.onActivate === 'function') ? value.onActivate : null;
    anchorAffordance(mediaBlockedEl, anchorRect);
    mediaBlockedEl.style.display = 'flex';
  }

  /**
   * State B -- unmute affordance. Non-null payload renders a bottom-left pill
   * (amber muted-speaker glyph + "Unmute" label via textContent); null hides.
   * The pill is actionable (pointer-events:auto, role=button, focusable,
   * aria-label). onActivate fires on click/Enter/Space.
   * @param {?Object} value
   * @param {?Object} anchorRect
   */
  function renderMediaUnmute(value, anchorRect) {
    if (!value) {
      if (mediaUnmuteEl) mediaUnmuteEl.style.display = 'none';
      mediaUnmuteActivate = null;
      return;
    }
    if (!mediaUnmuteEl) {
      mediaUnmuteEl = doc.createElement('div');
      mediaUnmuteEl.className = 'ps-overlay-media-unmute';
      mediaUnmuteEl.style.zIndex = '25';
      mediaUnmuteEl.setAttribute('role', 'button');
      mediaUnmuteEl.setAttribute('tabindex', '0');
      mediaUnmuteEl.setAttribute('aria-label', 'Unmute mirrored media');
      mediaUnmuteEl.style.pointerEvents = 'auto';
      var icon = doc.createElement('span');
      icon.className = 'ps-overlay-media-unmute-icon';
      icon.innerHTML = MEDIA_GLYPH.mutedSpeaker; // static glyph -- ONLY innerHTML
      var label = doc.createElement('span');
      label.className = 'ps-overlay-media-unmute-label';
      label.textContent = 'Unmute'; // text via textContent (security invariant)
      mediaUnmuteEl.appendChild(icon);
      mediaUnmuteEl.appendChild(label);
      wireActivation(mediaUnmuteEl, function () { return mediaUnmuteActivate; });
      layer.appendChild(mediaUnmuteEl);
    }
    mediaUnmuteActivate = (typeof value.onActivate === 'function') ? value.onActivate : null;
    // Anchor bottom-left of the rect (mirrors the progress-pill anchor).
    if (anchorRect) {
      mediaUnmuteEl.style.left = anchorRect.left + 8 + 'px';
      mediaUnmuteEl.style.top = (anchorRect.top + anchorRect.height - 8 - 24) + 'px';
    }
    mediaUnmuteEl.style.display = 'inline-flex';
  }

  /**
   * State C -- poster-only caption (no-poster fallback). Passive: pointer-events
   * none, no accent, no activation, text "Media (poster only)" via textContent.
   * Null hides.
   * @param {?Object} value
   * @param {?Object} anchorRect
   */
  function renderMediaPoster(value, anchorRect) {
    if (!value) {
      if (mediaPosterEl) mediaPosterEl.style.display = 'none';
      return;
    }
    if (!mediaPosterEl) {
      mediaPosterEl = doc.createElement('div');
      mediaPosterEl.className = 'ps-overlay-media-poster';
      mediaPosterEl.style.zIndex = '24';
      mediaPosterEl.style.pointerEvents = 'none';
      mediaPosterEl.textContent = 'Media (poster only)'; // textContent only
      layer.appendChild(mediaPosterEl);
    }
    // Centered in the rect.
    if (anchorRect) {
      mediaPosterEl.style.left = (anchorRect.left + anchorRect.width / 2) + 'px';
      mediaPosterEl.style.top = (anchorRect.top + anchorRect.height / 2) + 'px';
      mediaPosterEl.style.transform = 'translate(-50%, -50%)';
    }
    mediaPosterEl.style.display = 'inline-flex';
  }

  register('media-blocked', renderMediaBlocked);
  register('media-unmute', renderMediaUnmute);
  register('media-poster', renderMediaPoster);

  /**
   * Drive a registered overlay kind directly from renderer state (NOT a wire
   * message). The media affordances appear/disappear as a function of local
   * play() outcome / muted mismatch / mediaMode (13-UI-SPEC Motion section), so
   * the renderer calls show(kind, payload, ctx) where ctx.anchorRect is the
   * pre-resolved host rect for the element (or ctx carries { value, scale } for
   * the standard resolver). A null payload hides (the universal reset). Errors
   * in the renderFn are contained (safeRenderOverlay -> logger).
   * @param {string} kind
   * @param {?Object} payload
   * @param {{anchorRect?: ?Object}} [ctx]
   */
  function show(kind, payload, ctx) {
    var renderFn = registry.get(kind);
    if (!renderFn) {
      logger.warn('[Renderer] show() unknown overlay kind ignored', kind);
      return;
    }
    var anchorRect = (ctx && ctx.anchorRect) ? ctx.anchorRect : null;
    var value = (payload === undefined) ? null : payload;
    safeRenderOverlay(kind, renderFn, value, anchorRect);
  }

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
    show: show,
    resetOverlays: resetOverlays
  };
}
