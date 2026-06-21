// src/renderer/media-player.js
//
// Phase 14 (MADPT-01/MADPT-03): the renderer-owned PARENT-REALM adaptive media
// player. Extracted as the one genuinely net-new capability of the milestone --
// every other adaptive piece is wiring proven parts (the Phase 13 driver, the
// Phase 12 origin gate, the overlay registry, the adapter network hooks).
//
// The player runs ENTIRELY in the parent realm; the mirror iframe stays exactly
// sandbox="allow-same-origin" (NO allow-scripts -- T-14-04). The in-iframe
// <video> is inert data: the native path sets its `src` cross-realm; the MSE
// path hands hls.js (running in the parent) the bare child element via
// attachMedia(), and hls.js mints/owns the parent-realm MediaSource object URL
// (the spec ties the object-URL boundary to ORIGIN, not Document identity, and
// the srcdoc iframe is same-origin to its parent -- 14-RESEARCH A1/A5).
//
// attach(videoEl, manifestUrl, ctx) runs the decision tree EXACTLY in this order
// (14-RESEARCH "The attachment decision tree"):
//   1. GATE          -> blocked manifest origin => degrade('no-manifest')
//   2. NATIVE HLS     (canPlayType('application/vnd.apple.mpegurl') in
//                      {'probably','maybe'} on an HLS manifest) => set child
//                      videoEl.src directly; NO MSE, NO library.
//   3. HOST factory   (a configured playerFactory) => factory(ctx).attach(...)
//   4. OPTIONAL lazy   hls.js (HLS only, no factory) => feature-detect MSE,
//                      dynamic import('hls.js'), loadSource THEN attachMedia.
//   5. DASH no-factory => degrade('no-player')
//   6. anything else  => degrade('no-manifest')
// The whole body is try/catch-contained -> degrade('mse-opaque') on ANY throw;
// attach() NEVER rethrows into the caller (T-14-07 -- the never-break contract).
//
// Every unmirrorable path funnels through the SINGLE degrade(nid, reason) sink
// (reason in {no-manifest|no-player|mse-opaque|drm}) which tears down the live
// player for nid (revoke parent object URLs, removeAttribute('src') + load() on
// the inert child, both guarded), shows the passive `media-unavailable` overlay,
// and invokes the contained onMediaUnavailable(nid, reason) host callback (the
// onMediaBlocked family -- logger-trapped, NEVER rethrown). The mirror never
// breaks; the rest of the snapshot/diff stream keeps updating.
//
// DRM (T-14-05): emeEnabled is NEVER set true; the child element's 'encrypted'
// event AND an hls.js KEY_SYSTEM_ERROR both route to degrade('drm'). Protected
// content is never mirrored.
//
// Plain JS ESM (no runtime build step -- the renderer must stay importable with
// hls.js ABSENT, so hls.js is referenced ONLY via the dynamic import inside
// tryLazyImportHls; a top-level `import 'hls.js'` would break package:smoke and
// the zero-hard-runtime-dependency guarantee -- 14-RESEARCH Pitfall 1).

import { classifyManifest } from '../protocol/messages.js';

/**
 * @typedef {Object} PlayerAdapterCtx
 * @property {Document} doc            iframe.contentDocument (where videoEl lives)
 * @property {string} manifestUrl      gated, absolute manifest URL
 * @property {'hls'|'dash'} kind       derived from the manifest classifier
 * @property {HTMLMediaElement} videoEl the in-iframe child element
 * @property {Object} logger
 * @property {(url: string, kind: string) => {allow: boolean}} gateAsset reuse Phase 12 gate
 * @property {?string} nid             element nid for overlay anchoring + the reason callback
 */

/**
 * @typedef {Object} PlayerAdapter
 * @property {(videoEl: HTMLMediaElement, manifestUrl: string, ctx: PlayerAdapterCtx) => void} attach
 *   Bind the manifest to the element (host owns MSE/attachMedia/segment fetch in the PARENT realm).
 * @property {() => void} destroy   Tear down: detach MSE, revoke object URLs, free buffers. Idempotent.
 * @property {(handler: (reason: string) => void) => void} [onError]
 *   Report a fatal/unrecoverable error with a reason code; the viewer degrades to poster.
 */

/**
 * @typedef {Object} MediaPlayerDeps
 * @property {Document} doc              iframe.contentDocument the child <video> lives in
 * @property {Window} win                the PARENT realm window (MSE feature-detect surface)
 * @property {(url: string, kind: string) => {allow: boolean}} gateAsset Phase 12 fail-closed gate
 * @property {Object} logger             viewer logger (info/warn/error)
 * @property {(ctx: PlayerAdapterCtx) => PlayerAdapter} [playerFactory] host-provided player seam
 * @property {(nid: ?string, reason: string) => void} onMediaUnavailable degrade reason callback
 * @property {(kind: string, payload: ?Object, ctx: ?Object) => void} showOverlay overlay driver
 * @property {(nid: ?string) => ?Object} resolveNidRect anchor-rect resolver for the overlay
 * @property {(videoEl: HTMLMediaElement, nid: ?string) => void} ensurePlaying Phase 13 play kickoff
 * @property {(nid: ?string) => void} [keepPoster] keep/restore the element poster on degrade
 * @property {() => Promise<*>} [tryLazyImportHls] TEST SEAM: override the dynamic hls.js import
 */

/**
 * Dynamic, try/catch-guarded hls.js loader. DYNAMIC import INSIDE this function
 * ONLY -- never a top-level import (breaks package:smoke / zero-hard-dep --
 * 14-RESEARCH Pitfall 1). Returns the Hls constructor or null on absence/failure
 * (the graceful-absence path: degrade('no-player')).
 * @returns {Promise<*>} the Hls constructor, or null when hls.js is unavailable
 */
async function tryLazyImportHls() {
  try {
    var mod = await import('hls.js');
    return (mod && (mod.default || mod.Hls || mod)) || null;
  } catch (e) {
    return null;
  }
}

/**
 * Is the MSE attachment surface present in the parent realm? hls.js prefers
 * ManagedMediaSource (Safari/power-aware) and falls back to MediaSource; both
 * are parent-realm globals and both produce a child-acceptable attachment.
 * @param {?Window} win
 * @returns {boolean}
 */
function canUseMse(win) {
  return !!(win && (win.ManagedMediaSource || win.MediaSource));
}

/**
 * Native-HLS feature-detect: an HLS manifest the child element can play directly
 * (Safari, and increasingly Chromium 142+). 'probably'/'maybe' are the advisory
 * positives; '' means no native support -> fall through to the MSE path.
 * @param {HTMLMediaElement} videoEl
 * @param {'hls'|'dash'|null} kind
 * @returns {boolean}
 */
function isNativeHls(videoEl, kind) {
  if (kind !== 'hls') return false;
  var v = (videoEl && typeof videoEl.canPlayType === 'function')
    ? videoEl.canPlayType('application/vnd.apple.mpegurl')
    : '';
  return v === 'probably' || v === 'maybe';
}

/**
 * Create the parent-realm adaptive media player. The renderer injects the live
 * deps in Plan 03; the Plan 02 tests inject stubs/fakes (a stub `win` carrying
 * MediaSource, a controllable-canPlayType video stub, a fake playerFactory, and
 * a `tryLazyImportHls` override). Maintains a per-nid registry so a re-snapshot
 * (Plan 03) can destroyAll() before the new mirror document replaces the child
 * elements (Pattern 2 -- player teardown on new identity).
 *
 * @param {MediaPlayerDeps} deps
 * @returns {{
 *   attach: (videoEl: HTMLMediaElement, manifestUrl: string, ctx?: Object) => (Object|Promise<Object|undefined>|undefined),
 *   degrade: (nid: ?string, reason: string) => undefined,
 *   destroy: (nid: ?string) => undefined,
 *   destroyAll: () => undefined
 * }}
 */
export function createMediaPlayer(deps) {
  var d = deps || {};
  var logger = d.logger || { info: function () {}, warn: function () {}, error: function () {} };
  // TEST SEAM: allow the lazy-import to be overridden by a dep; default to the
  // dynamic-import helper. The override keeps the suite jsdom-runnable with
  // hls.js uninstalled (both the absent path and a stub-Hls path).
  var lazyImportHls = (typeof d.tryLazyImportHls === 'function') ? d.tryLazyImportHls : tryLazyImportHls;

  // Per-nid live-player registry. Each entry: { nid, kind, videoEl, player? }
  // where `player` is the host/lazy adapter (has destroy()). The native handle
  // has no player object (the child element owns the source).
  var registry = new Map();

  /**
   * Contained host-callback invoker (mirrors safeInvokeMediaHook): a throwing
   * onMediaUnavailable is routed to the logger and never rethrown.
   * @param {?string} nid
   * @param {string} reason
   */
  function safeInvokeMediaHook(nid, reason) {
    if (typeof d.onMediaUnavailable !== 'function') return;
    try {
      d.onMediaUnavailable(nid, reason);
    } catch (err) {
      logger.error('[Renderer] onMediaUnavailable callback failed', nid, reason, err);
    }
  }

  /**
   * Tear down the live player for nid: destroy any host/lazy adapter, and reset
   * the inert child element (removeAttribute('src') + load()). All steps are
   * individually guarded -- teardown never throws. Idempotent.
   * @param {?string} nid
   */
  function destroy(nid) {
    var entry = registry.get(nid);
    if (entry) {
      if (entry.player && typeof entry.player.destroy === 'function') {
        try { entry.player.destroy(); } catch (e) { /* contained */ }
      }
      var el = entry.videoEl;
      if (el) {
        try { if (typeof el.removeAttribute === 'function') el.removeAttribute('src'); } catch (e) { /* contained */ }
        try { if (typeof el.load === 'function') el.load(); } catch (e) { /* contained */ }
      }
      registry.delete(nid);
    }
  }

  /** Destroy every live player (Plan 03 calls this on a re-snapshot). */
  function destroyAll() {
    var nids = [];
    registry.forEach(function (_entry, nid) { nids.push(nid); });
    nids.forEach(destroy);
  }

  /**
   * The single degrade sink -- every unmirrorable path routes here. Tears down
   * the live player for nid, shows the passive media-unavailable overlay over
   * the element rect, and invokes the contained onMediaUnavailable host hook.
   * The element keeps its poster (if present) else the Phase-12 placeholder.
   * NEVER throws.
   * @param {?string} nid
   * @param {string} reason  no-manifest | no-player | mse-opaque | drm
   * @returns {undefined}
   */
  function degrade(nid, reason) {
    destroy(nid);
    if (typeof d.showOverlay === 'function') {
      var anchorRect = (typeof d.resolveNidRect === 'function') ? d.resolveNidRect(nid) : null;
      try {
        d.showOverlay('media-unavailable', { nid: nid, reason: reason }, { anchorRect: anchorRect });
      } catch (e) {
        logger.error('[Renderer] media-unavailable overlay failed', nid, reason, e);
      }
    }
    if (typeof d.keepPoster === 'function') {
      try { d.keepPoster(nid); } catch (e) { /* contained */ }
    }
    safeInvokeMediaHook(nid, reason);
    return undefined;
  }

  /**
   * The optional lazy hls.js branch (HLS only, no playerFactory). Feature-detects
   * MSE, dynamic-imports hls.js, wires the DRM + fatal-error degrade paths, then
   * loadSource() BEFORE attachMedia() (the documented happy path). Self-degrades
   * on every failure; never rethrows.
   * @param {HTMLMediaElement} videoEl
   * @param {string} manifestUrl
   * @param {PlayerAdapterCtx} ctx
   * @returns {Promise<Object|undefined>} a hls handle, or undefined after degrade
   */
  async function attachViaLazyHls(videoEl, manifestUrl, ctx) {
    var win = d.win || (ctx.doc && ctx.doc.defaultView) || null;
    if (!canUseMse(win)) return degrade(ctx.nid, 'mse-opaque');
    var Hls = await lazyImportHls();
    if (!Hls || typeof Hls.isSupported !== 'function' || !Hls.isSupported()) {
      return degrade(ctx.nid, 'no-player');
    }
    try {
      // emeEnabled stays FALSE (DRM is never attempted -- T-14-05). We pass an
      // explicit config WITHOUT emeEnabled so it can never be true.
      var hls = new Hls({});
      // The cheapest reliable DRM signal: the child element's 'encrypted' event.
      videoEl.addEventListener('encrypted', function () { degrade(ctx.nid, 'drm'); }, { once: true });
      hls.on(Hls.Events.ERROR, function (_e, info) {
        if (!info || !info.fatal) return;
        degrade(ctx.nid, (info.type === Hls.ErrorTypes.KEY_SYSTEM_ERROR) ? 'drm' : 'mse-opaque');
      });
      hls.loadSource(manifestUrl); // LOAD first
      hls.attachMedia(videoEl);    // THEN attach the bare in-iframe element
      var player = { destroy: function () { try { hls.destroy(); } catch (e) { /* contained */ } } };
      registry.set(ctx.nid, { nid: ctx.nid, kind: 'hls', videoEl: videoEl, player: player });
      return { kind: 'hls', hls: hls, player: player };
    } catch (e) {
      return degrade(ctx.nid, 'mse-opaque');
    }
  }

  /**
   * The host playerFactory branch -- the host owns MSE/attachMedia/segment fetch
   * internally. Wires the adapter's optional onError to the degrade sink and
   * records the live player for teardown.
   * @param {HTMLMediaElement} videoEl
   * @param {string} manifestUrl
   * @param {PlayerAdapterCtx} ctx
   * @returns {Object} a factory handle
   */
  function attachViaFactory(videoEl, manifestUrl, ctx) {
    var player = d.playerFactory(ctx);
    registry.set(ctx.nid, { nid: ctx.nid, kind: ctx.kind, videoEl: videoEl, player: player });
    if (player && typeof player.onError === 'function') {
      player.onError(function (reason) { degrade(ctx.nid, reason || 'mse-opaque'); });
    }
    // attach() may throw -- the caller's try/catch contains it to mse-opaque.
    player.attach(videoEl, manifestUrl, ctx);
    return { kind: 'factory', player: player };
  }

  /**
   * Run the attachment decision tree for one media element. SYNCHRONOUS for the
   * native / factory / no-MSE / dash-no-factory / no-manifest branches (so a
   * caller that does not await still observes the degrade); the lazy-hls branch
   * returns a Promise. The whole body is try/catch-contained -> degrade(
   * 'mse-opaque') on ANY throw; NEVER rethrows.
   * @param {HTMLMediaElement} videoEl  the in-iframe child element
   * @param {string} manifestUrl
   * @param {Object} [ctx]              { nid?, contentType? }
   * @returns {Object|Promise<Object|undefined>|undefined} a handle, a promise, or undefined after degrade
   */
  function attach(videoEl, manifestUrl, ctx) {
    var c = ctx || {};
    var nid = (c.nid !== undefined) ? c.nid : null;
    try {
      // 1. GATE -- blocked manifest origin is unmirrorable.
      var gate = (typeof d.gateAsset === 'function') ? d.gateAsset(manifestUrl, 'media') : { allow: true };
      if (!gate || !gate.allow) return degrade(nid, 'no-manifest');

      var kind = classifyManifest({ url: manifestUrl, contentType: c.contentType });

      // 2. NATIVE HLS FIRST -- no MSE, no library, no parent player.
      if (isNativeHls(videoEl, kind)) {
        videoEl.src = manifestUrl; // cross-realm attribute set on the child el
        registry.set(nid, { nid: nid, kind: 'native', videoEl: videoEl });
        if (typeof d.ensurePlaying === 'function') d.ensurePlaying(videoEl, nid); // REUSE Phase 13
        return { kind: 'native' };
      }

      // The full PlayerAdapterCtx the factory / lazy path receive.
      var playerCtx = {
        doc: d.doc,
        manifestUrl: manifestUrl,
        kind: kind,
        videoEl: videoEl,
        logger: logger,
        gateAsset: d.gateAsset,
        nid: nid
      };

      // 3. HOST playerFactory (DASH + custom + HLS) when provided.
      if (typeof d.playerFactory === 'function') {
        return attachViaFactory(videoEl, manifestUrl, playerCtx);
      }

      // 4. OPTIONAL LAZY hls.js (HLS only, no factory). Async; self-degrades.
      if (kind === 'hls') {
        return attachViaLazyHls(videoEl, manifestUrl, playerCtx);
      }

      // 5. DASH (.mpd) with no factory.
      if (kind === 'dash') return degrade(nid, 'no-player');

      // 6. anything unhandled (no classifiable manifest).
      return degrade(nid, 'no-manifest');
    } catch (e) {
      // ANY throw -> poster, never break (T-14-07).
      return degrade(nid, 'mse-opaque');
    }
  }

  return {
    attach: attach,
    degrade: degrade,
    destroy: destroy,
    destroyAll: destroyAll
  };
}
