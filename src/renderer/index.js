// PhantomStream renderer: createViewer -- the embeddable viewer component.
//
// Wires the pure renderer pieces (snapshot.js srcdoc builder, diff.js
// Document-parameterized applier, overlays.js registry + parity built-ins)
// into the auto-attaching viewer factory. Behavioral port of the FSB
// reference viewer's stream plumbing (reference/dashboard/dashboard.js,
// shipped as FSB milestone v0.9.9.1):
//
//   - identity guard, generation-state reset, latched resync: 185-278
//   - snapshot handler sequence (srcdoc write + onload): 2723-2829
//   - scale-to-fit math: 2831-2869 (single fill-container mode)
//   - resize wiring (window listener + guarded ResizeObserver): 3194-3207
//   - mutation dispatch + post-batch scroll re-apply: 3209-3356
//   - scroll handler (store first, gated smooth follow): 3358-3372
//
// Intentional divergences (renderer divergence ledger, plan 02-04):
//   - FSB 9-state preview machine -> minimal 'waiting' | 'streaming' gate
//     plus Phase 4's host-facing state/health event surface (VIEW-02).
//   - tabId identity checks dropped (FSB extension concern); staleness goes
//     through the protocol's isCurrentStream instead.
//   - dash:request-status send dropped from the resync path -- the resync
//     message is CONTROL.START alone (02-RESEARCH Pattern 2; a message named
//     dash:request-snapshot does not exist anywhere in the protocol).
//   - recordDashboardTransportEvent/-Error ring buffers dropped; renderer
//     diagnostics go to the injected logger with the '[Renderer]' prefix.
//   - Layout modes (inline/maximized/pip/fullscreen) dropped (D-03): the
//     viewer always fills its container; layout belongs to the host.
//   - Dialog identity-nesting quirk ported as-is (Pitfall 8): capture nests
//     stream identity INSIDE payload.dialog, so the top-level isCurrentStream
//     check finds no identity and always accepts dialogs. Explicit parity
//     choice -- revisit when Phase 4 introduces multi-stream transports.
//
// Cross-runtime style per the capture-core precedent: var declarations,
// || inline defaulting, function expressions, named exports, explicit .js
// import extensions, factory-time validation as the ONLY throwing site.

import { buildSnapshotHtml } from './snapshot.js';
import { applyMutations } from './diff.js';
import { sanitizeFragment } from './sanitize.js';
import { createOverlays, mapRectToHost, OVERLAY_CSS } from './overlays.js';
import { STREAM, CONTROL, NID_ATTR, isCurrentStream } from '../protocol/messages.js';

/**
 * The host-injected viewer transport. Mirrors the capture Transport's
 * fire-and-forget send contract and adds the receive side; Phase 4's
 * WebSocket transport implements this same interface by encoding/decoding
 * envelopes, so the viewer never changes.
 *
 * @typedef {Object} ViewerTransport
 * @property {(type: string, payload: Object) => void} send
 *   Viewer -> capture host (CONTROL.* messages). Fire-and-forget; errors
 *   are contained to the injected logger, never thrown into the viewer.
 * @property {(handler: (type: string, payload: Object) => void) => (() => void)} onMessage
 *   Subscribe to capture-host -> viewer (STREAM.*) messages. Returns an
 *   unsubscribe function; detach() invokes it.
 * @property {(handler: (status: Object) => void) => (() => void)} [onStatus]
 *   Optional Phase 4 status subscription implemented by WebSocket transports.
 *   Status objects are telemetry only; mirrored payloads never flow here.
 */

/**
 * @typedef {Object} ViewerLogger
 * @property {(...args: *) => void} info
 * @property {(...args: *) => void} warn
 * @property {(...args: *) => void} error
 */

/**
 * @typedef {Object} ViewerOptions
 * @property {Element} container
 *   Required. Host element the viewer root is appended into (auto-attach,
 *   D-01). Factory throws Error('viewer-container-required') otherwise.
 * @property {ViewerTransport} transport
 *   Required. Factory throws Error('viewer-transport-required') when send
 *   or onMessage is not a function.
 * @property {ViewerLogger} [logger]
 *   Optional. Defaults to a console-backed logger.
 * @property {number} [disconnectDelayMs]
 *   Optional stale-to-disconnected delay for closed transports. Defaults to a
 *   short demo-friendly window; tests may set a smaller value.
 */

/**
 * @typedef {Object} ViewerHandle
 * @property {() => void} detach
 *   Unsubscribe from the transport, remove the resize listeners, and remove
 *   the viewer root from the container. Idempotent.
 * @property {() => void} destroy
 *   detach() plus state/overlay reset. Idempotent.
 * @property {() => {scale: Object, viewport: Object, container: Object}} getViewportMapping
 *   Return cloned scale, viewport, and container geometry for host-owned
 *   input overlays.
 * @property {(kind: string, renderFn: (payload: *, anchorRect: ?Object, layer: Element) => void) => void} registerOverlay
 *   Register a custom overlay kind (delegates to the overlays registry --
 *   the host-facing extension seam from D-10).
 * @property {(eventName: 'state'|'health', handler: (event: Object) => void) => (() => void)} on
 *   Subscribe to host-facing lifecycle and health events. Returns unsubscribe.
 */

/**
 * Scale-to-fit math (pure). Port of dashboard.js:2859-2868 simplified to
 * the single fill-container mode per 02-UI-SPEC "Scale-to-fit": page
 * dimensions default to 1920x1080 and floor at 1; the scale factor is the
 * min of the two container/page ratios with a !isFinite/<=0 clamp to 1;
 * letterbox offsets center the scaled page and floor at 0.
 *
 * @param {number} pageW       Captured page width (0/undefined -> 1920)
 * @param {number} pageH       Captured page height (0/undefined -> 1080)
 * @param {number} containerW  Host container width in px
 * @param {number} containerH  Host container height in px
 * @returns {{s: number, offsetX: number, offsetY: number, pageW: number, pageH: number}}
 */
export function computeScale(pageW, pageH, containerW, containerH) {
  var w = Math.max(1, pageW || 1920);
  var h = Math.max(1, pageH || 1080);
  var s = Math.min(containerW / w, containerH / h);
  if (!isFinite(s) || s <= 0) s = 1;
  return {
    s: s,
    offsetX: Math.max(0, (containerW - w * s) / 2),
    offsetY: Math.max(0, (containerH - h * s) / 2),
    pageW: w,
    pageH: h
  };
}

/**
 * Create an embeddable viewer bound to a host container: sandboxed mirror
 * iframe, host-document overlay layer, transport message dispatch, scale-
 * to-fit, scroll mirroring, and the latched CONTROL.START resync path.
 * Auto-attaches on creation (D-01): calling this yields a live mirror as
 * soon as the first snapshot arrives.
 *
 * Factory-time validation is the ONLY place this module throws (capture
 * precedent); after creation every error routes to the injected logger.
 *
 * @param {ViewerOptions} options
 * @returns {ViewerHandle}
 */
export function createViewer(options) {
  var cfg = options || {};

  var container = cfg.container;
  if (!container || typeof container.appendChild !== 'function') {
    throw new Error('viewer-container-required');
  }
  var transport = cfg.transport;
  if (!transport || typeof transport.send !== 'function'
      || typeof transport.onMessage !== 'function') {
    throw new Error('viewer-transport-required');
  }
  var logger = cfg.logger || {
    info: function () { console.info.apply(console, arguments); },
    warn: function () { console.warn.apply(console, arguments); },
    error: function () { console.error.apply(console, arguments); }
  };
  var disconnectDelayMs = typeof cfg.disconnectDelayMs === 'number'
    ? Math.max(0, cfg.disconnectDelayMs)
    : 750;

  // All DOM construction happens in the container's own document so the
  // viewer works in any window (host page, jsdom test, future multi-doc).
  var doc = container.ownerDocument;
  var win = doc.defaultView;

  // --- Viewer root: fills the container, clips the scaled mirror, and
  // carries the loopback recursion-guard marker (02-RESEARCH Pattern 4) so
  // a same-page capture can skipElement the entire viewer subtree. ---
  var root = doc.createElement('div');
  root.setAttribute('data-phantomstream-ui', 'viewer');
  root.style.position = 'relative';
  root.style.width = '100%';
  root.style.height = '100%';
  root.style.overflow = 'hidden';

  // Viewer chrome styles travel as ONE injected style element (zero-dep
  // constraint: hosts never import a stylesheet).
  var styleEl = doc.createElement('style');
  styleEl.textContent = OVERLAY_CSS;
  root.appendChild(styleEl);

  // --- Mirror iframe. Hidden until the first snapshot load so the host's
  // waiting placeholder behind it stays visible (02-RESEARCH Pattern 6). ---
  var iframe = doc.createElement('iframe');
  iframe.setAttribute('title', 'PhantomStream live mirror');
  iframe.style.position = 'absolute';
  iframe.style.zIndex = '1'; // overlay layer sits above at z 2
  iframe.style.transformOrigin = 'top left';
  iframe.style.display = 'none';

  // SANDBOX ASSERTION (phase criterion 3, threat T-02-08): the mirror
  // renders attacker-influenced HTML, so the sandbox must be EXACTLY
  // allow-same-origin -- same-origin access for diff applies and rect
  // reads, zero script execution. Read back and verify so a hostile or
  // broken environment fails loudly at creation instead of weakening the
  // sandbox silently.
  iframe.setAttribute('sandbox', 'allow-same-origin');
  var sandboxTokens = (iframe.getAttribute('sandbox') || '').trim().split(/\s+/);
  if (sandboxTokens.length !== 1 || sandboxTokens[0] !== 'allow-same-origin') {
    throw new Error('viewer-sandbox-invalid');
  }

  // POST-PARSE SCRUB (plan 03-02, threat T-03-09): the srcdoc string
  // cannot be fragment-scrubbed before the browser parses it -- string
  // scrubbing is the mXSS anti-pattern (scrub-then-reparse) -- so the
  // PARSED mirror document is scrubbed on every load instead. Registered
  // FIRST so the scrub runs before the streaming flip below; reads
  // contentDocument fresh per call (re-snapshots replace the document).
  // In jsdom this listener is inert against srcdoc content (jsdom never
  // parses srcdoc; the one about:blank load sees an empty body) -- the
  // loopback glue recipe + a deliberately re-fired load event exercise it
  // under test, and real browsers fire it on every srcdoc load. The
  // sandbox assertion below stays untouched (phase criterion 3).
  iframe.addEventListener('load', function () {
    try {
      var scrubDoc = iframe.contentDocument;
      if (scrubDoc && scrubDoc.body) {
        sanitizeFragment(scrubDoc.body, sanitizeCounters, logger);
      }
    } catch (e) {
      logger.warn('[Renderer] post-parse scrub failed', e);
    }
  });

  // Snapshot-load completion handler, attached ONCE at creation (before the
  // iframe is ever connected) rather than re-assigned per snapshot like the
  // reference's iframe.onload. Divergence forced by jsdom (verified
  // empirically this session): jsdom 29 only queues the iframe's initial
  // about:blank load event when a load listener already exists at insertion
  // time, and never re-fires load on srcdoc writes -- a per-snapshot onload
  // assignment therefore never runs under test. In real browsers this
  // listener fires on every srcdoc load with identical behavior. Guarded on
  // a pending snapshot so the bare about:blank load (before any snapshot)
  // leaves the viewer waiting.
  iframe.addEventListener('load', function () {
    if (!lastSnapshotPayload) return;
    updateScale();
    try {
      iframe.contentWindow.scrollTo(
        lastSnapshotPayload.scrollX || 0,
        lastSnapshotPayload.scrollY || 0
      );
    } catch (e) { /* ignore: scroll restore is best-effort */ }
    viewerState = 'streaming';
    iframe.style.display = '';
  });
  root.appendChild(iframe);

  // --- Overlay layer (host document, above the iframe, never inside the
  // mirror). createOverlays pre-registers the glow/progress/dialog parity
  // built-ins through the same registry custom kinds use. ---
  var overlays = createOverlays({ document: doc, logger: logger });
  root.appendChild(overlays.layer);

  // Auto-attach (D-01): creation yields a live, ready-to-stream mirror.
  container.appendChild(root);

  // --- Viewer state (reference module state -> factory closure state) ---
  var viewerState = 'waiting'; // 'waiting' | 'streaming' minimal gate
  var publicState = 'connecting'; // 'connecting' | 'live' | 'stale' | 'disconnected'
  var publicStateEvent = {
    state: publicState,
    reason: 'viewer-created',
    ts: Date.now()
  };
  var stateListeners = new Set();
  var healthListeners = new Set();
  var disconnectTimer = null;
  var active = { streamSessionId: '', snapshotId: 0 };
  var lastScroll = { x: 0, y: 0 };
  var counters = { staleMisses: 0, applyFailures: 0 };
  // Sanitization strip counters -- PER-SESSION lifecycle (03-RESEARCH
  // Pitfall 3, deliberate divergence from the per-snapshot miss counters
  // above): misses measure per-generation drift and reset in
  // handleSnapshot; these measure a sustained strip rate across the whole
  // viewer session, so they reset ONLY in destroy(). Mutated in place by
  // sanitizeFragment (post-parse scrub) and the diff applier via
  // hooks.sanitizeCounters.
  var sanitizeCounters = {
    strippedHandlers: 0, blockedUrls: 0, droppedSubtrees: 0, cssScrubs: 0
  };
  var resyncPending = false; // latch: at most one resync in flight per generation
  var receivedByType = {};
  var sentByType = {};
  var lastFrameAt = 0;
  var lastSnapshotAt = 0;
  var lastMutationAt = 0;
  var lastTransportStatus = {};
  var lastSnapshotPayload = null;
  var scaleState = computeScale(1920, 1080, container.clientWidth, container.clientHeight);
  var detached = false;
  var destroyed = false;

  function incrementCounter(counter, type) {
    var key = typeof type === 'string' && type ? type : 'unknown';
    counter[key] = (counter[key] || 0) + 1;
  }

  function copyCounters(counter) {
    var out = {};
    for (var key in counter) {
      if (Object.prototype.hasOwnProperty.call(counter, key)) out[key] = counter[key];
    }
    return out;
  }

  function copyErrors(errors) {
    if (!Array.isArray(errors)) return [];
    return errors.map(function (entry) {
      var e = entry || {};
      return {
        code: typeof e.code === 'string' ? e.code : '',
        reason: typeof e.reason === 'string' ? e.reason : '',
        ts: typeof e.ts === 'number' ? e.ts : 0
      };
    });
  }

  function sanitizeTransportStatus(status) {
    var s = status || {};
    return {
      state: typeof s.state === 'string' ? s.state : (typeof s.status === 'string' ? s.status : ''),
      reason: typeof s.reason === 'string' ? s.reason : '',
      readyState: typeof s.readyState === 'number' ? s.readyState : null,
      bufferedAmount: typeof s.bufferedAmount === 'number' ? s.bufferedAmount : 0,
      drops: typeof s.drops === 'number' ? s.drops : 0,
      errors: copyErrors(s.errors),
      lastCloseAt: typeof s.lastCloseAt === 'number' ? s.lastCloseAt : 0,
      lastSendAt: typeof s.lastSendAt === 'number' ? s.lastSendAt : 0,
      lastReceiveAt: typeof s.lastReceiveAt === 'number' ? s.lastReceiveAt : 0,
      closeCode: typeof s.closeCode === 'number' ? s.closeCode : null,
      closeReason: typeof s.closeReason === 'string' ? s.closeReason : '',
      sentByType: copyCounters(s.sentByType || {}),
      receivedByType: copyCounters(s.receivedByType || {})
    };
  }

  function currentTransportHealth() {
    var live = {};
    if (transport && typeof transport.getHealth === 'function') {
      try {
        live = sanitizeTransportStatus(transport.getHealth());
      } catch (err) {
        logger.error('[Renderer] transport health failed', err);
      }
    }
    return Object.assign(sanitizeTransportStatus(lastTransportStatus), live);
  }

  function cloneStateEvent(event) {
    return {
      state: event.state,
      reason: event.reason,
      ts: event.ts
    };
  }

  function healthSnapshot() {
    return {
      state: publicState,
      ts: Date.now(),
      lastFrameAt: lastFrameAt,
      lastSnapshotAt: lastSnapshotAt,
      lastMutationAt: lastMutationAt,
      receivedByType: copyCounters(receivedByType),
      sentByType: copyCounters(sentByType),
      staleMisses: counters.staleMisses,
      applyFailures: counters.applyFailures,
      resyncPending: resyncPending,
      sanitizer: copyCounters(sanitizeCounters),
      transport: currentTransportHealth()
    };
  }

  function notifyState() {
    var event = cloneStateEvent(publicStateEvent);
    stateListeners.forEach(function (handler) {
      try {
        handler(cloneStateEvent(event));
      } catch (err) {
        logger.error('[Renderer] event handler failed', 'state', err);
      }
    });
  }

  function notifyHealth() {
    var event = healthSnapshot();
    healthListeners.forEach(function (handler) {
      try {
        handler(healthSnapshot());
      } catch (err) {
        logger.error('[Renderer] event handler failed', 'health', err);
      }
    });
    return event;
  }

  function clearDisconnectTimer() {
    if (!disconnectTimer) return;
    clearTimeout(disconnectTimer);
    disconnectTimer = null;
  }

  function setPublicState(state, reason) {
    if (state !== 'connecting' && state !== 'live' &&
        state !== 'stale' && state !== 'disconnected') {
      return;
    }
    if (state !== 'stale') clearDisconnectTimer();
    if (publicState === state) return;
    publicState = state;
    publicStateEvent = {
      state: state,
      reason: reason || '',
      ts: Date.now()
    };
    notifyState();
    notifyHealth();
  }

  function scheduleDisconnected(reason) {
    clearDisconnectTimer();
    disconnectTimer = setTimeout(function () {
      disconnectTimer = null;
      if (detached || destroyed || publicState !== 'stale') return;
      setPublicState('disconnected', reason || 'transport-closed');
    }, disconnectDelayMs);
  }

  function on(eventName, handler) {
    if ((eventName !== 'state' && eventName !== 'health') || typeof handler !== 'function') {
      throw new Error('viewer-event-unsupported');
    }
    var listeners = eventName === 'state' ? stateListeners : healthListeners;
    listeners.add(handler);
    try {
      handler(eventName === 'state' ? cloneStateEvent(publicStateEvent) : healthSnapshot());
    } catch (err) {
      logger.error('[Renderer] event handler failed', eventName, err);
    }
    return function unsubscribeViewerEvent() {
      listeners.delete(handler);
    };
  }

  /**
   * Deliver one CONTROL message through the injected transport. Capture-
   * precedent containment: synchronous try/catch plus a rejection handler
   * on any returned promise; failures route to the logger, never throw.
   * @param {string} type
   * @param {Object} payload
   */
  function safeSend(type, payload) {
    incrementCounter(sentByType, type);
    notifyHealth();
    try {
      var result = transport.send(type, payload);
      if (result && typeof result.catch === 'function') {
        result.catch(function (err) {
          logger.error('[Renderer] transport send failed', err);
        });
      }
    } catch (err) {
      logger.error('[Renderer] transport send failed', err);
    }
  }

  /**
   * Latched resync request (D-08 via 02-RESEARCH Pattern 2): the resync
   * message IS CONTROL.START -- the capture host responds by starting a
   * fresh session whose snapshot resets this generation's counters AND
   * releases the latch (the only release site). Reference parity:
   * requestPreviewResync, dashboard.js:248-278, with the FSB status
   * refresh and recovery-watchdog chrome dropped.
   * @param {string} reason   Lowercase-hyphen reason from the diff applier
   * @param {Object} [details] Miss details (logged upstream; not sent)
   */
  function requestResync(reason, details) {
    if (resyncPending) return;
    resyncPending = true;
    setPublicState('stale', reason || 'preview-resync');
    safeSend(CONTROL.START, {
      trigger: 'preview-resync',
      reason: reason || 'unknown'
    });
  }

  function markLive(reason) {
    setPublicState('live', reason || 'frame');
  }

  function handleTransportStatus(status) {
    if (detached) return;
    lastTransportStatus = sanitizeTransportStatus(status);
    var before = publicState;
    var s = status && (status.state || status.status);
    if (s === 'closed') {
      setPublicState('stale', 'transport-closed');
      scheduleDisconnected('transport-closed');
    } else if (s === 'reconnecting' || s === 'error') {
      setPublicState('stale', 'transport-' + s);
    } else if (s === 'open' || s === 'connected') {
      if (viewerState === 'streaming' || lastSnapshotPayload) {
        markLive('transport-open');
      } else {
        setPublicState('connecting', 'transport-open');
      }
    } else if (s === 'connecting') {
      if (publicState !== 'live') setPublicState('connecting', 'transport-connecting');
    }
    if (before === publicState) notifyHealth();
  }

  function handleStreamState(payload) {
    var p = payload || {};
    var state = p.state || p.status;
    if (state !== 'connecting' && state !== 'live' &&
        state !== 'stale' && state !== 'disconnected') {
      return;
    }
    setPublicState(state, p.reason || 'stream-state');
  }

  /**
   * Recompute scale-to-fit from the container box and the last snapshot's
   * page size (viewportWidth || pageWidth || 1920 and viewportHeight ||
   * 1080, per dashboard.js:2834-2835), then apply the iframe geometry:
   * unscaled page-size box, letterbox offsets, top-left scale transform.
   */
  function updateScale() {
    var p = lastSnapshotPayload || {};
    scaleState = computeScale(
      p.viewportWidth || p.pageWidth || 1920,
      p.viewportHeight || 1080,
      container.clientWidth,
      container.clientHeight
    );
    iframe.style.width = scaleState.pageW + 'px';
    iframe.style.height = scaleState.pageH + 'px';
    iframe.style.left = scaleState.offsetX + 'px';
    iframe.style.top = scaleState.offsetY + 'px';
    iframe.style.transform = 'scale(' + scaleState.s + ')';
  }

  function getViewportMapping() {
    return {
      scale: {
        s: scaleState.s,
        offsetX: scaleState.offsetX,
        offsetY: scaleState.offsetY,
        pageW: scaleState.pageW,
        pageH: scaleState.pageH
      },
      viewport: {
        width: scaleState.pageW,
        height: scaleState.pageH
      },
      container: {
        width: container.clientWidth || 0,
        height: container.clientHeight || 0
      }
    };
  }

  function stampNodeIdsOnHtml(html, nodeIds) {
    if (!Array.isArray(nodeIds) || nodeIds.length === 0) return html || '';
    var range = doc.createRange();
    var fragment = range.createContextualFragment(html || '');
    var elements = fragment.querySelectorAll('*');
    for (var i = 0; i < elements.length && i < nodeIds.length; i++) {
      elements[i].setAttribute(NID_ATTR, nodeIds[i]);
    }
    var wrapper = doc.createElement('div');
    wrapper.appendChild(fragment);
    return wrapper.innerHTML;
  }

  function payloadWithMirrorNodeIds(payload) {
    if (!payload || !Array.isArray(payload.nodeIds)) return payload;
    return Object.assign({}, payload, {
      html: stampNodeIdsOnHtml(payload.html, payload.nodeIds)
    });
  }

  /**
   * Resolve a captured node id to a host-document overlay rect. Reads the
   * mirror contentDocument FRESH per call (never cached -- re-snapshots
   * replace the document). Client rects inside the iframe are already
   * viewport-relative and unaffected by the host-side CSS transform
   * (02-RESEARCH Pattern 5), so mapRectToHost applies scale + offsets.
   * @param {number|string} nid
   * @returns {?{top: number, left: number, width: number, height: number}}
   */
  function resolveNidRect(nid) {
    try {
      var cd = iframe.contentDocument;
      if (!cd) return null;
      var el = cd.querySelector('[' + NID_ATTR + '="' + nid + '"]');
      if (!el) return null;
      var rect = el.getBoundingClientRect();
      return mapRectToHost(
        { x: rect.left, y: rect.top, w: rect.width, h: rect.height },
        scaleState
      );
    } catch (err) {
      // Containment: a malformed nid (selector syntax) or a torn-down
      // mirror must never break the overlay kind loop.
      logger.warn('[Renderer] nid rect resolution failed', nid, err);
      return null;
    }
  }

  /**
   * STREAM.SNAPSHOT handler (dashboard.js:2723-2829). Snapshots are NEVER
   * staleness-checked -- they DEFINE the new identity (2742-2756). Missing
   * html keeps the last good frame (no state change; logger only -- the
   * reference's error-state UI is FSB chrome). Sequence: adopt identity ->
   * reset generation state (counters + latch, 200-204) -> reset overlays
   * (2762-2764) -> store scroll (2758-2759) -> write srcdoc; the creation-
   * time load listener (above) then runs scale, initial scrollTo, marks
   * streaming, and un-hides the iframe.
   * @param {Object} payload
   */
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
    resyncPending = false; // the latch's ONLY release site
    lastSnapshotAt = Date.now();
    overlays.resetOverlays();
    lastScroll.x = p.scrollX || 0;
    lastScroll.y = p.scrollY || 0;
    lastSnapshotPayload = p;
    iframe.srcdoc = buildSnapshotHtml(payloadWithMirrorNodeIds(p));
    markLive('snapshot');
  }

  /**
   * STREAM.MUTATIONS handler (dashboard.js:3209-3356). Gated on streaming
   * (mutations before the first load are dropped -- Pitfall 4 parity; the
   * resync path self-heals any resulting drift) AND stream identity. The
   * contentDocument is read FRESH per call (never cached); the last known
   * scroll is re-applied exactly ONCE per batch (3340-3342), never per op.
   * @param {Object} payload
   */
  function handleMutations(payload) {
    if (viewerState !== 'streaming') return;
    if (!isCurrentStream(payload, active)) return;
    lastMutationAt = Date.now();
    var cd = iframe.contentDocument;
    applyMutations(cd, payload.mutations, counters, {
      logger: logger,
      requestResync: requestResync,
      sanitizeCounters: sanitizeCounters
    });
    if (!resyncPending) markLive('mutations');
    try {
      iframe.contentWindow.scrollTo(lastScroll.x, lastScroll.y);
    } catch (e) { /* ignore: scroll maintenance is best-effort */ }
  }

  /**
   * STREAM.SCROLL handler (dashboard.js:3358-3372). Store FIRST so the
   * post-mutation re-apply always uses the freshest captured position,
   * then follow with a smooth scroll only while streaming (read-only
   * follow this phase, D-14/D-15).
   * @param {Object} payload
   */
  function handleScroll(payload) {
    if (!isCurrentStream(payload, active)) return;
    lastScroll.x = (payload && payload.scrollX) || 0;
    lastScroll.y = (payload && payload.scrollY) || 0;
    if (viewerState !== 'streaming') return;
    markLive('scroll');
    try {
      iframe.contentWindow.scrollTo({
        left: lastScroll.x,
        top: lastScroll.y,
        behavior: 'smooth'
      });
    } catch (e) { /* ignore: smooth follow is best-effort */ }
  }

  /**
   * STREAM.OVERLAY handler: streaming + identity gate, then registry
   * dispatch with the current scale state and the nid rect resolver.
   * @param {Object} payload
   */
  function handleOverlay(payload) {
    if (viewerState !== 'streaming') return;
    if (!isCurrentStream(payload, active)) return;
    overlays.handleOverlayMessage(payload, {
      scale: scaleState,
      resolveNidRect: resolveNidRect
    });
    markLive('overlay');
  }

  /**
   * STREAM.DIALOG handler: streaming gate + TOP-LEVEL identity check only.
   * Capture nests stream identity inside payload.dialog, so this check
   * finds no top-level identity and effectively always accepts -- the
   * ported reference quirk (Pitfall 8), kept deliberately and ledgered in
   * plan 02-04. Loopback has a single stream; revisit at Phase 4.
   * @param {Object} payload
   */
  function handleDialog(payload) {
    if (viewerState !== 'streaming') return;
    if (!isCurrentStream(payload, active)) return;
    overlays.handleDialogMessage(payload);
    markLive('dialog');
  }

  /**
   * Transport message dispatch. The whole handler is containment-wrapped:
   * one malformed message routes to the logger and never kills the
   * subscription. Unknown types (STREAM.READY, STREAM.STATE, ...) are
   * ignored silently (forward-compatible).
   * @param {string} type
   * @param {Object} payload
   */
  function dispatch(type, payload) {
    if (detached) return;
    incrementCounter(receivedByType, type);
    lastFrameAt = Date.now();
    try {
      switch (type) {
        case STREAM.SNAPSHOT:
          handleSnapshot(payload);
          break;
        case STREAM.MUTATIONS:
          handleMutations(payload);
          break;
        case STREAM.SCROLL:
          handleScroll(payload);
          break;
        case STREAM.OVERLAY:
          handleOverlay(payload);
          break;
        case STREAM.DIALOG:
          handleDialog(payload);
          break;
        case STREAM.STATE:
          handleStreamState(payload);
          break;
        default:
          break;
      }
    } catch (err) {
      logger.error('[Renderer] message handler failed', type, err);
    }
    notifyHealth();
  }

  var unsubscribe = transport.onMessage(dispatch);
  var unsubscribeStatus = null;
  if (typeof transport.onStatus === 'function') {
    unsubscribeStatus = transport.onStatus(handleTransportStatus);
  }

  // --- Resize wiring (dashboard.js:3194-3207): window resize listener
  // plus a typeof-guarded ResizeObserver on the container (jsdom lacks
  // ResizeObserver -- Pitfall 5; the reference keeps both). Both gated on
  // streaming so the waiting placeholder never triggers geometry writes. ---
  function onWindowResize() {
    if (viewerState === 'streaming') updateScale();
  }
  if (win && typeof win.addEventListener === 'function') {
    win.addEventListener('resize', onWindowResize);
  }
  var resizeObserver = null;
  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(function () {
      if (viewerState === 'streaming') updateScale();
    });
    resizeObserver.observe(container);
  }

  /**
   * Unsubscribe from the transport, remove resize listeners, disconnect
   * the ResizeObserver, and remove the viewer root from the container.
   * Idempotent (02-RESEARCH Open Question 3 recommendation).
   */
  function detach() {
    if (detached) return;
    detached = true;
    try {
      if (typeof unsubscribe === 'function') unsubscribe();
    } catch (err) {
      logger.error('[Renderer] transport unsubscribe failed', err);
    }
    try {
      if (typeof unsubscribeStatus === 'function') unsubscribeStatus();
    } catch (err) {
      logger.error('[Renderer] transport status unsubscribe failed', err);
    }
    clearDisconnectTimer();
    if (win && typeof win.removeEventListener === 'function') {
      win.removeEventListener('resize', onWindowResize);
    }
    if (resizeObserver) {
      try {
        resizeObserver.disconnect();
      } catch (err) { /* observer already torn down */ }
      resizeObserver = null;
    }
    if (root.parentNode) root.parentNode.removeChild(root);
  }

  /**
   * detach() plus state/overlay reset. Idempotent; safe after detach().
   */
  function destroy() {
    detach();
    if (destroyed) return;
    destroyed = true;
    overlays.resetOverlays();
    lastSnapshotPayload = null;
    active.streamSessionId = '';
    active.snapshotId = 0;
    counters.staleMisses = 0;
    counters.applyFailures = 0;
    // The ONLY sanitize-counter reset site (per-session lifecycle --
    // see the declaration comment; handleSnapshot never resets these).
    sanitizeCounters.strippedHandlers = 0;
    sanitizeCounters.blockedUrls = 0;
    sanitizeCounters.droppedSubtrees = 0;
    sanitizeCounters.cssScrubs = 0;
    resyncPending = false;
    receivedByType = {};
    sentByType = {};
    lastFrameAt = 0;
    lastSnapshotAt = 0;
    lastMutationAt = 0;
    lastTransportStatus = {};
    stateListeners.clear();
    healthListeners.clear();
    viewerState = 'waiting';
  }

  /**
   * Register a custom overlay kind (delegates to the overlays registry --
   * the host-facing extension seam, D-10). Viewer state/health events live
   * on on(); node addressing remains a later-phase surface. See
   * overlays.register() for the
   * renderFn contract (raw payload, host rect or null, layer element).
   * @param {string} kind
   * @param {(payload: *, anchorRect: ?Object, layer: Element) => void} renderFn
   */
  function registerOverlay(kind, renderFn) {
    overlays.register(kind, renderFn);
  }

  return {
    detach: detach,
    destroy: destroy,
    getViewportMapping: getViewportMapping,
    on: on,
    registerOverlay: registerOverlay
  };
}

// Barrel re-exports: the renderer's full public surface through one module
// (package exports map "./renderer" -> this file in plan 02-05).
export { escapeAttribute, buildShellAttributeString, buildSnapshotHtml } from './snapshot.js';
export { applyMutations } from './diff.js';
export { createOverlays, mapRectToHost, mapHostPointToViewport, OVERLAY_CSS } from './overlays.js';
