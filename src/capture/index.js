// PhantomStream capture core: DOM snapshot + MutationObserver diff streaming.
//
// Single-file extraction of the FSB reference implementation
// (reference/extension/dom-stream.js, shipped as FSB milestone v0.9.9.1).
// Behavior is ported verbatim (parity-only, decision D-11) with exactly two
// kinds of seams applied:
//
//   1. Transport seam (D-07): every chrome.runtime.sendMessage call becomes
//      transport.send(type, payload) on the host-injected Transport. Transport
//      errors are routed to the injected logger and NEVER propagate into the
//      capture path.
//   2. Options seams (D-08): the window.FSB namespace reads become injected
//      options — logger (console-backed default), overlayProvider (overlay
//      side-channel state, replaces FSB.actionGlowOverlay / FSB.highlightManager /
//      FSB.overlayState reads), skipElement (the "skip our own UI" predicate,
//      replaces isFsbOverlay).
//
// Lifecycle divergence (D-06, USER OVERRIDE — divergence-ledger entry D1):
// resume() re-arms observers and continues the SAME streamSessionId /
// snapshotId without re-serializing; the reference re-snapshots on resume.
// Mutations occurring while paused are missed by design (host contract).
//
// This module runs in any injection context (extension content script,
// addInitScript, bookmarklet, embedded SDK): window/document and friends are
// ambient globals dereferenced only inside createCapture and the functions it
// builds — never at module top level — so importing this file in bare Node is
// side-effect free.
//
// The 5-module split (serializer/differ/side-channels/session) is deliberately
// deferred beyond Phase 1 (D-10); parity against the reference, proven by the
// differential oracle, is the exit bar. One reference quirk remains preserved
// on purpose: the truncation budget compares html.length (UTF-16 code units)
// against a byte constant (inherited quirk). Phase 3 SEC-01 DIVERGENCE: the
// sanitizeForWire chokepoint (a named inner function of createCapture) now
// strips on* handlers, dangerous URL schemes, srcdoc attributes and
// object/embed subtrees, and value-scrubs CSS on every serialization path --
// the reference stripped on* only on the html/body shells and passed
// javascript: URLs straight through. All strips are counted + logged (never
// silent), and ONLY detached clones / wire values are touched: the live
// observed page keeps its attributes and handlers.

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
import { STREAM, NID_ATTR, createStreamSessionId } from '../protocol/messages.js';

// RELAY_PER_MESSAGE_LIMIT_BYTES is the relay's hard per-message cap;
// SNAPSHOT_BUDGET_BYTES is the 80% truncation budget derived from it
// (replaces the reference's inline Math.floor(limit * 0.8) computation).
// Both are imported, never redefined, so capture and relay stay in sync.
void RELAY_PER_MESSAGE_LIMIT_BYTES;

// Attributes that need URL absolutification
var URL_ATTRS = ['src', 'href', 'action', 'poster', 'data'];

// Default computed style values to skip (reduces payload size)
// Keys are kebab-case to match getComputedStyle property iteration
var STYLE_DEFAULTS = {
  'display': 'block',
  'position': 'static',
  'opacity': '1',
  'visibility': 'visible',
  'overflow': 'visible',
  'transform': 'none',
  'box-shadow': 'none',
  'z-index': 'auto',
  'float': 'none',
  'clear': 'none',
  'cursor': 'auto',
  'pointer-events': 'auto',
  'text-decoration': 'none solid rgb(0, 0, 0)',
  'text-align': 'start',
  'vertical-align': 'baseline',
  'font-style': 'normal',
  'font-variant': 'normal',
  'text-transform': 'none',
  'white-space': 'normal',
  'word-break': 'normal',
  'overflow-wrap': 'normal',
  'list-style-type': 'disc',
  'border-collapse': 'separate',
  'resize': 'none'
};

// Curated list of ~85 CSS properties that matter for visual fidelity.
// Replaces iterating all 300+ computed properties which crushed performance
// on heavy pages (YouTube DOM fetch took 45s). Per D-04.
var CURATED_PROPS = [
  // Layout & Box Model
  'display', 'position', 'top', 'right', 'bottom', 'left',
  'float', 'clear', 'box-sizing',
  'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height',
  'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  // Flexbox
  'flex-direction', 'flex-wrap', 'justify-content', 'align-items', 'align-self',
  'align-content', 'flex-grow', 'flex-shrink', 'flex-basis', 'order', 'gap',
  // Grid
  'grid-template-columns', 'grid-template-rows', 'grid-column', 'grid-row',
  'grid-auto-flow', 'grid-gap', 'column-gap', 'row-gap',
  // Visual
  'background-color', 'background-image', 'background-position', 'background-size',
  'background-repeat', 'color', 'opacity', 'visibility',
  'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
  'border-top-style', 'border-right-style', 'border-bottom-style', 'border-left-style',
  'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color',
  'border-radius',
  'border-top-left-radius', 'border-top-right-radius',
  'border-bottom-left-radius', 'border-bottom-right-radius',
  'box-shadow', 'outline', 'outline-color', 'outline-style', 'outline-width',
  // Typography
  'font-family', 'font-size', 'font-weight', 'font-style', 'font-variant',
  'line-height', 'letter-spacing', 'word-spacing', 'text-align', 'text-decoration',
  'text-transform', 'text-indent', 'text-overflow', 'white-space', 'word-break',
  'overflow-wrap',
  // Overflow & Clipping
  'overflow', 'overflow-x', 'overflow-y', 'clip', 'clip-path',
  // Transform & Transition
  'transform', 'transform-origin', 'transition', 'animation',
  // Table
  'border-collapse', 'border-spacing', 'table-layout',
  // List
  'list-style-type', 'list-style-position',
  // Misc
  'z-index', 'cursor', 'pointer-events', 'user-select',
  'vertical-align', 'resize', 'object-fit', 'object-position',
  'content', 'direction', 'unicode-bidi'
];

var SHELL_PROPS = [
  'background-color', 'background-image', 'background-position', 'background-size',
  'background-repeat', 'color', 'font-family', 'font-size', 'font-weight',
  'font-style', 'font-variant', 'line-height', 'letter-spacing', 'word-spacing',
  'text-align', 'text-transform', 'direction', 'unicode-bidi',
  'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'overflow', 'overflow-x', 'overflow-y', 'box-sizing'
];

// =========================================================================
// SEC-01 sanitization pure helpers (module scope; absolutifyUrl shape:
// string in, string out, early-return guards, exception-to-identity).
// Blocklist policy per the Phase 3 CONTEXT locked decision: fidelity-first,
// allowlist explicitly rejected -- benign content passes byte-identical.
// =========================================================================

/**
 * Remove every character with code <= 0x20 (C0 controls + space) from a
 * string. Browsers' URL parsers strip tab/LF/CR anywhere in a URL and trim
 * leading/trailing C0-or-space, so an obfuscated "jav\tascript:" normalizes
 * to a live javascript: URL at navigation time; stripping the FULL <= 0x20
 * range before scheme-matching is strictly more aggressive than the parser,
 * closing the whitespace-obfuscation class (threat T-03-02).
 * @param {string} value
 * @returns {string}
 */
function stripLowChars(value) {
  var out = '';
  for (var i = 0; i < value.length; i++) {
    if (value.charCodeAt(i) > 0x20) out += value.charAt(i);
  }
  return out;
}

/**
 * True when a URL-ish attribute value carries a script-capable scheme:
 * javascript:, vbscript:, or data:text/html. The check runs AFTER stripping
 * chars <= 0x20 (see stripLowChars) and is case-insensitive. data:image/*
 * values are allowed (canvas swaps and inline images depend on them); the
 * scheme list is centralized HERE -- one place to add schemes.
 * @param {string} value
 * @returns {boolean}
 */
function hasDangerousScheme(value) {
  if (!value || typeof value !== 'string') return false;
  var compact = stripLowChars(value).toLowerCase();
  return compact.indexOf('javascript:') === 0
    || compact.indexOf('vbscript:') === 0
    || compact.indexOf('data:text/html') === 0;
}

/**
 * Neutralize dangerous-scheme candidate URLs inside a srcset value
 * (comma-separated URL + descriptor entries). Returns the ORIGINAL string
 * untouched when no candidate is dangerous, so benign srcset values stay
 * byte-identical (separator re-joining only happens on the hostile path).
 * @param {string} srcset
 * @returns {string}
 */
function scrubSrcset(srcset) {
  if (!srcset) return srcset;
  try {
    var entries = srcset.split(',');
    var changed = false;
    for (var i = 0; i < entries.length; i++) {
      var parts = entries[i].trim().split(/\s+/);
      if (parts[0] && hasDangerousScheme(parts[0])) {
        parts[0] = '';
        entries[i] = parts.join(' ');
        changed = true;
      }
    }
    return changed ? entries.join(', ') : srcset;
  } catch (e) {
    return srcset;
  }
}

/**
 * Targeted CSS value scrub (CONTEXT decision: value scrub, not a CSS
 * parser). Applied to head <style> text, style attribute values, and (plan
 * 03-01 Task 2) style attr-op values. Four passes, each leaving benign CSS
 * byte-identical and each idempotent (re-scrubbing scrubbed output is a
 * no-op):
 *   1. url() whose EXPLICIT scheme is not http/https/data:image* has its
 *      contents replaced with about:blank. NO-scheme url() values
 *      (relative paths, fragments, query-only) are ALLOWED: they resolve
 *      against the document base -- which is never a dangerous scheme --
 *      and rewriting them would break relative-asset fidelity (CONTEXT
 *      fidelity-first decision).
 *   2. expression( occurrences are removed (legacy IE script-in-CSS).
 *   3. -moz-binding declarations are removed (legacy XBL script binding).
 *   4. @import statements survive ONLY with an explicit http(s) target
 *      (an @import pulls a whole stylesheet -- script-equivalent blast
 *      radius -- so the conservative rule wins over relative fidelity);
 *      and the literal sequence "</style" is rewritten to "<\/style"
 *      (CSS string-escape, preserving evaluated string values) so captured
 *      CSS can never break out of the viewer's style tag.
 *   5. Markup-breakout strip: any remaining tag-like sequence
 *      (< + optional / + letter ... up to > or end) is REMOVED, iterated to
 *      a fixpoint. This closes the namespace-confusion mXSS class (threat
 *      T-03-03, Pitfall 4): a MathML/SVG-confused parse can leave hostile
 *      markup (e.g. "</math><img onerror=...>") as RAW TEXT inside a style
 *      element, where a context-shifted re-parse materializes it as real
 *      elements. '<' is not valid anywhere in CSS syntax outside quoted
 *      strings and the legacy CDO token "<!--" (preserved -- '!' is not a
 *      tag start), so benign CSS passes byte-identical; content strings
 *      that embed literal markup are a deliberately accepted fidelity loss.
 * @param {string} css
 * @returns {string}
 */
function scrubCssText(css) {
  if (!css || typeof css !== 'string') return css;
  try {
    var out = css;
    // Pass 1: url() scheme scrub (quoted forms may contain parens; the
    // unquoted form ends at the first close-paren like the CSS tokenizer).
    out = out.replace(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)"'][^)]*))?\s*\)/gi,
      function (match, dq, sq, bare) {
        var inner = dq !== undefined ? dq : (sq !== undefined ? sq : (bare || ''));
        var compact = stripLowChars(inner);
        var schemeMatch = /^([a-zA-Z][a-zA-Z0-9+.\-]*):/.exec(compact);
        if (!schemeMatch) return match; // no explicit scheme: allowed (base-relative)
        var scheme = schemeMatch[1].toLowerCase();
        if (scheme === 'http' || scheme === 'https') return match;
        if (scheme === 'data' && /^data:image\//i.test(compact)) return match;
        return 'url(about:blank)';
      });
    // Pass 2: expression( removal.
    out = out.replace(/expression\s*\(/gi, '');
    // Pass 3: -moz-binding declaration removal (up to the next ; or }).
    out = out.replace(/-moz-binding[^;}]*/gi, '');
    // Pass 4a: @import scheme gate (statement removed unless explicit http(s)).
    out = out.replace(/@import\b[^;]*(;|$)/gi, function (stmt) {
      return /^@import\s+(?:url\(\s*)?['"]?\s*https?:/i.test(stmt) ? stmt : '';
    });
    // Pass 4b: </style breakout neutralization (string-escape rewrite runs
    // BEFORE the markup strip so evaluated string values are preserved for
    // the canonical breakout; the escaped "<\/style" no longer matches the
    // tag-like pattern below).
    out = out.replace(/<\/style/gi, '<\\/style');
    // Pass 5: markup-breakout strip, iterated to a fixpoint so adversarial
    // nesting ("<i<img x>mg ...") cannot reassemble a tag across passes.
    var tagLike = /<\/?[a-zA-Z][^>]*(?:>|$)/g;
    for (;;) {
      var next = out.replace(tagLike, '');
      if (next === out) break;
      out = next;
    }
    return out;
  } catch (e) {
    return css;
  }
}

/**
 * The host-injected message sink. `send` mirrors the fire-and-forget
 * semantics of the reference's messaging call: the capture core never awaits
 * delivery and never lets a transport failure propagate into the capture
 * path (errors are routed to the injected logger instead — D-07).
 *
 * The implementation is injected rather than imported so this module works
 * in any runtime and injection context (same pattern as the LZCodec seam in
 * src/protocol/envelope.js).
 *
 * @typedef {Object} Transport
 * @property {(type: string, payload: Object) => void} send
 *   Deliver one wire message. `type` is a STREAM.* protocol type; `payload`
 *   is the message payload (snapshot object, mutation batch, etc.).
 * @property {() => void} [flush]
 *   Optional: drain any host-side buffering. Defaults to a no-op; invoked
 *   once at the end of stop().
 */

/**
 * @typedef {Object} CaptureLogger
 * @property {(...args: *) => void} info
 * @property {(...args: *) => void} warn
 * @property {(...args: *) => void} error
 */

/**
 * Overlay side-channel state returned by an overlayProvider. `glow` and
 * `progress` are the reference built-ins; every OTHER own enumerable key is
 * forwarded on the wire as a custom overlay kind (Phase 2 VIEW-04 pass-
 * through -- see broadcastOverlayState and README entry E1). The identity
 * keys `streamSessionId` / `snapshotId` are reserved: the capture core
 * stamps them after the provider keys, so a provider can never overwrite
 * stream identity.
 * @typedef {Object} OverlayState
 * @property {Object|null} [glow]      Action-highlight rect/state, or null
 * @property {Object|null} [progress]  Progress-card state, or null
 */

/**
 * @typedef {Object} CaptureOptions
 * @property {Transport} transport
 *   Required. Factory throws Error('transport-send-required') when
 *   transport.send is not a function (factory-time validation may throw;
 *   the capture path after start never does).
 * @property {CaptureLogger} [logger]
 *   Optional. Defaults to a console-backed logger.
 * @property {(() => OverlayState|null)} [overlayProvider]
 *   Optional. Called by the overlay broadcaster to read host overlay state.
 *   ALL own enumerable provider keys are forwarded as overlay kinds (custom
 *   kinds included); glow/progress default null when omitted; the identity
 *   keys (streamSessionId / snapshotId) are reserved and never overwritten.
 *   Default null: overlay messages carry { glow: null, progress: null },
 *   preserving the reference's wire shape when no overlay system is present.
 * @property {(el: Element) => boolean} [skipElement]
 *   Optional. Predicate marking elements the host wants excluded from
 *   capture (its own UI). Default returns false (nothing skipped).
 *   Applied ancestor-inclusively (closest()-like, reference parity): an
 *   element is excluded when the predicate matches it OR any of its
 *   ancestors, and skipped subtrees receive NO node-id assignment during
 *   serialization -- a root-only predicate (e.g. el.id === 'my-overlay')
 *   therefore excludes its whole subtree from both snapshots and diffs.
 */

/**
 * @typedef {Object} CaptureHandle
 * @property {() => void} start   Fresh session: mint ids, snapshot, observe.
 * @property {() => void} stop    Stop observers (final flush included).
 * @property {() => void} pause   Stop observers, keep the session alive.
 * @property {() => void} resume  Re-arm observers; same session, no snapshot.
 */

/**
 * Create a capture instance bound to the ambient window/document.
 *
 * All reference module state lives in this closure, so multiple captures can
 * coexist in one process (each against its own globals). No DOM access
 * happens at module import time; the ambient globals are dereferenced when
 * the factory and its functions run.
 *
 * @param {CaptureOptions} config
 * @returns {CaptureHandle}
 */
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

  /**
   * Ancestor-inclusive form of the skipElement seam (reference parity:
   * isFsbOverlay in reference/extension/dom-stream.js 266-276 used
   * closest('[data-fsb-overlay]'), so descendants of a skipped element were
   * excluded WITHOUT node-id assignment). Returns true when the host
   * predicate matches el or any of its ancestor elements, so a root-only
   * host predicate (e.g. el.id === 'my-overlay') excludes the whole subtree
   * exactly like the reference. With no host predicate this returns false
   * without walking -- wire-identical to the default seam.
   *
   * @param {Element} el
   * @returns {boolean}
   */
  function skipElementWithAncestors(el) {
    if (!hostSkipElement) return false;
    var node = el;
    while (node) {
      try {
        if (hostSkipElement(node)) return true;
      } catch (err) {
        // Host predicate errors are contained like the transport and
        // overlayProvider seams (D-07): route to the logger and treat the
        // element as not-skipped. The capture path never throws after the
        // factory, and one bad predicate call must never lose a whole
        // mutation batch.
        logger.error('[DOM Stream] skipElement predicate failed', err);
        return false;
      }
      node = node.parentElement;
    }
    return false;
  }

  /**
   * Exception-contained direct (non-ancestor) form of the skipElement seam,
   * used where the serializer mirrors the reference's own-element check.
   * Same containment contract as skipElementWithAncestors: predicate errors
   * go to the injected logger and the element is treated as not-skipped.
   *
   * @param {Element} el
   * @returns {boolean}
   */
  function safeSkipElement(el) {
    try {
      return skipElement(el);
    } catch (err) {
      logger.error('[DOM Stream] skipElement predicate failed', err);
      return false;
    }
  }

  /**
   * Deliver one message through the injected transport. Mirrors the
   * reference's send pattern (synchronous try/catch plus a rejection
   * handler on any returned promise) with errors routed to the logger;
   * transport failures never propagate into the capture path (D-07).
   * @param {string} type
   * @param {Object} payload
   */
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

  /**
   * Optional host flush hook (typeof-guarded no-op default). Invoked once at
   * the end of stop() so buffering hosts get a deterministic drain point;
   * with the default no-op this is wire-invisible.
   */
  function safeFlush() {
    try {
      if (typeof transport.flush === 'function') {
        transport.flush();
      }
    } catch (err) {
      logger.error('[DOM Stream] transport flush failed', err);
    }
  }

  // --- Module state (reference lines 13-34, now per-factory closure state) ---
  var streaming = false;
  var mutationObserver = null;
  var batchTimer = null;
  var pendingMutations = [];
  var nextNodeId = 1;
  var scrollHandler = null;
  var lastScrollSend = 0;
  var dialogRelayActive = false;
  var lastOverlayBroadcast = 0;
  var streamSessionId = '';
  var currentSnapshotId = 0;
  var lastDrainTs = 0;
  var staleFlushCount = 0;
  var watchdogTimer = null;

  // SEC-01 sanitization strip counters (closure state, staleFlushCount
  // pattern). Lifecycle is PER-SESSION (03-RESEARCH.md Pitfall 3): reset in
  // beginStreamSession only, never per snapshot or per flush, so strip
  // totals accumulate across one whole stream session. The masked* pair is
  // declared here but incremented by the SEC-03 masking pass (plan 03-03)
  // through the same chokepoint.
  var sanitizeCounters = {
    strippedHandlers: 0,  // on* handler attributes removed
    blockedUrlSchemes: 0, // javascript:/vbscript:/data:text/html values neutralized
    blockedSubtrees: 0,   // object/embed subtrees dropped + srcdoc attrs dropped
    cssScrubs: 0,         // CSS values rewritten by scrubCssText
    maskedTextNodes: 0,   // (plan 03-03) maskTextSelector-matched text masked
    maskedInputs: 0       // (plan 03-03) masked input values
  };

  function beginStreamSession() {
    // Entropy is supplied here so the protocol helper stays pure; the wire
    // format ('stream_<ts36>_<rand>') matches the reference byte-for-byte.
    streamSessionId = createStreamSessionId(
      Date.now(),
      Math.random().toString(36).slice(2, 8)
    );
    currentSnapshotId = Date.now();
    // SEC-01: per-session counter reset (the ONLY reset site -- see the
    // declaration comment for the lifecycle rationale).
    sanitizeCounters.strippedHandlers = 0;
    sanitizeCounters.blockedUrlSchemes = 0;
    sanitizeCounters.blockedSubtrees = 0;
    sanitizeCounters.cssScrubs = 0;
    sanitizeCounters.maskedTextNodes = 0;
    sanitizeCounters.maskedInputs = 0;
  }

  function getCurrentStreamMetadata() {
    return {
      streamSessionId: streamSessionId || '',
      snapshotId: currentSnapshotId || 0
    };
  }

  function attachStreamMetadata(payload) {
    return Object.assign({}, payload || {}, getCurrentStreamMetadata());
  }

  function assignNodeId(original, clone) {
    var nid = String(nextNodeId++);
    if (original && original.nodeType === Node.ELEMENT_NODE) {
      original.setAttribute(NID_ATTR, nid);
    }
    if (clone && clone.nodeType === Node.ELEMENT_NODE) {
      clone.setAttribute(NID_ATTR, nid);
    }
    return nid;
  }

  // =========================================================================
  // 0. Dialog Interception (D-01/D-03)
  // =========================================================================

  /**
   * Inject a page-level script that monkey-patches window.alert,
   * window.confirm, and window.prompt to fire CustomEvents the capture
   * context can listen for. Per D-01/D-03: intercept native dialogs and
   * relay to the viewer. The 'fsb-dialog' / 'fsb-dialog-dismiss' event names
   * and the 'fsb-dialog-interceptor' element id are wire-adjacent and kept
   * byte-identical to the reference.
   */
  function injectDialogInterceptor() {
    // Only inject once
    if (document.getElementById('fsb-dialog-interceptor')) return;

    var script = document.createElement('script');
    script.id = 'fsb-dialog-interceptor';
    script.textContent = '(' + function() {
      var origAlert = window.alert;
      var origConfirm = window.confirm;
      var origPrompt = window.prompt;

      window.alert = function(message) {
        document.dispatchEvent(new CustomEvent('fsb-dialog', {
          detail: { type: 'alert', message: String(message || '') }
        }));
        var result = origAlert.call(window, message);
        document.dispatchEvent(new CustomEvent('fsb-dialog-dismiss', {
          detail: { type: 'alert' }
        }));
        return result;
      };

      window.confirm = function(message) {
        document.dispatchEvent(new CustomEvent('fsb-dialog', {
          detail: { type: 'confirm', message: String(message || '') }
        }));
        var result = origConfirm.call(window, message);
        document.dispatchEvent(new CustomEvent('fsb-dialog-dismiss', {
          detail: { type: 'confirm', result: result }
        }));
        return result;
      };

      window.prompt = function(message, defaultValue) {
        document.dispatchEvent(new CustomEvent('fsb-dialog', {
          detail: { type: 'prompt', message: String(message || ''), defaultValue: defaultValue || '' }
        }));
        var result = origPrompt.call(window, message, defaultValue);
        document.dispatchEvent(new CustomEvent('fsb-dialog-dismiss', {
          detail: { type: 'prompt', result: result }
        }));
        return result;
      };
    } + ')();';

    (document.head || document.documentElement).appendChild(script);
  }

  /**
   * Listen for dialog events from the page-level interceptor and relay them
   * through the transport.
   */
  function setupDialogRelay() {
    if (dialogRelayActive) return;
    dialogRelayActive = true;

    document.addEventListener('fsb-dialog', function(e) {
      var detail = e.detail || {};
      safeSend(STREAM.DIALOG, {
        dialog: attachStreamMetadata({
          type: detail.type,
          message: detail.message,
          defaultValue: detail.defaultValue,
          state: 'open'
        })
      });
    });

    document.addEventListener('fsb-dialog-dismiss', function(e) {
      var detail = e.detail || {};
      safeSend(STREAM.DIALOG, {
        dialog: attachStreamMetadata({
          type: detail.type,
          result: detail.result,
          state: 'closed'
        })
      });
    });
  }

  // =========================================================================
  // 0.5 SEC-01 Sanitization chokepoint
  // =========================================================================

  /**
   * Snapshot the sanitization counters (plain copy, for the aggregate strip
   * warn's before/after comparison and as the warn payload).
   * @returns {Object} counter snapshot
   */
  function sanitizeCountersSnapshot() {
    return {
      strippedHandlers: sanitizeCounters.strippedHandlers,
      blockedUrlSchemes: sanitizeCounters.blockedUrlSchemes,
      blockedSubtrees: sanitizeCounters.blockedSubtrees,
      cssScrubs: sanitizeCounters.cssScrubs,
      maskedTextNodes: sanitizeCounters.maskedTextNodes,
      maskedInputs: sanitizeCounters.maskedInputs
    };
  }

  /**
   * Emit ONE aggregate strip warn per serialization pass when any
   * sanitization counter moved during that pass (counted + logged, never
   * silent -- CONTEXT observability decision; aggregate, not per-strip
   * spam). Called once per serializeDOM pass and once per mutation flush.
   * @param {Object} before - counter snapshot taken before the pass
   */
  function warnIfSanitizeStrips(before) {
    var after = sanitizeCountersSnapshot();
    var moved = false;
    for (var key in after) {
      if (Object.prototype.hasOwnProperty.call(after, key) && after[key] !== before[key]) {
        moved = true;
        break;
      }
    }
    if (moved) {
      logger.warn('[DOM Stream] sanitization strips', after);
    }
  }

  /**
   * The capture-side sanitization chokepoint (SEC-01): the single named
   * function through which every serialization path emits. Blocklist
   * policy, fidelity-first (CONTEXT locked decision: allowlist rejected) --
   * benign content passes through byte-identical. Strips apply ONLY to
   * detached clones / wire values, never to the live observed page (threat
   * T-03-06). Dispatch shapes:
   *
   *   sanitizeForWire('element', { orig, clone })    -> { drop?: true }
   *     Scrubs one detached clone element in place; { drop: true } for
   *     script/noscript (reference-parity strip, uncounted) and
   *     object/embed (SEC-01 blocklist, counted).
   *   sanitizeForWire('subtree', { root, liveRoot }) -> { drop?: true }
   *     Walks a detached wire clone (root + descendants), element-scrubbing
   *     each and removing forbidden descendants; { drop: true } when the
   *     root itself is forbidden.
   *   sanitizeForWire('text',    { text, owner })    -> { text }
   *     IDENTITY HOOK this plan: the SEC-03 masking seam -- plan 03-03
   *     fills maskTextSelector/maskTextFn here (incrementing
   *     maskedTextNodes); Phase 8 CAPT-05 typed-text capture plugs into the
   *     same seam.
   *   sanitizeForWire('css',     { css })            -> { css }
   *     Targeted CSS value scrub (scrubCssText) for head inline styles.
   *
   * @param {string} kind - dispatch tag
   * @param {Object} payload - shape per dispatch tag (above)
   * @returns {Object} per-dispatch result object
   */
  function sanitizeForWire(kind, payload) {
    if (kind === 'element') {
      var clone = payload.clone;
      if (!clone || clone.nodeType !== Node.ELEMENT_NODE) return {};
      var tag = clone.tagName ? String(clone.tagName).toLowerCase() : '';
      // script/noscript: reference-parity strip -- NOT counted (the
      // reference already dropped these from snapshots; counting them
      // would fire the strip warn on every benign page with a <script>).
      if (tag === 'script' || tag === 'noscript') {
        return { drop: true };
      }
      // object/embed: SEC-01 blocklist drop (CONTEXT decision: drop the
      // whole subtree, no placeholder -- threat T-03-04).
      if (tag === 'object' || tag === 'embed') {
        sanitizeCounters.blockedSubtrees++;
        return { drop: true };
      }
      // Collect attribute names FIRST: clone.attributes is a LIVE
      // NamedNodeMap, so removing while iterating skips entries.
      var attrNames = [];
      var attrList = clone.attributes;
      if (attrList) {
        for (var i = 0; i < attrList.length; i++) {
          if (attrList[i] && attrList[i].name) attrNames.push(attrList[i].name);
        }
      }
      for (var n = 0; n < attrNames.length; n++) {
        var rawName = attrNames[n];
        var lowName = String(rawName).toLowerCase();
        // on* handler attrs: stripped on EVERY element regardless of
        // namespace (serializeShellAttributes precedent generalized to all
        // paths -- threats T-03-01/T-03-03, Pitfall 4).
        if (lowName.indexOf('on') === 0) {
          clone.removeAttribute(rawName);
          sanitizeCounters.strippedHandlers++;
          continue;
        }
        // srcdoc: a whole nested attacker document in one attribute --
        // dropped outright, counted as a blocked subtree (T-03-04).
        if (lowName === 'srcdoc') {
          clone.removeAttribute(rawName);
          sanitizeCounters.blockedSubtrees++;
        }
      }
      // URL-carrying attributes: dangerous schemes neutralize to '' --
      // attribute EXISTENCE is preserved for mirror parity (T-03-02).
      for (var u = 0; u < URL_ATTRS.length; u++) {
        var urlVal = clone.getAttribute(URL_ATTRS[u]);
        if (urlVal && hasDangerousScheme(urlVal)) {
          clone.setAttribute(URL_ATTRS[u], '');
          sanitizeCounters.blockedUrlSchemes++;
        }
      }
      var formactionVal = clone.getAttribute('formaction');
      if (formactionVal && hasDangerousScheme(formactionVal)) {
        clone.setAttribute('formaction', '');
        sanitizeCounters.blockedUrlSchemes++;
      }
      // SVG xlink:href (getAttributeNS per the serializeDOM precedent).
      try {
        var xlinkVal = clone.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
        if (xlinkVal && hasDangerousScheme(xlinkVal)) {
          clone.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', '');
          sanitizeCounters.blockedUrlSchemes++;
        }
      } catch (e) { /* not an SVG element or no xlink support */ }
      // srcset: per-candidate scheme check (benign values byte-identical).
      var srcsetVal = clone.getAttribute('srcset');
      if (srcsetVal) {
        var scrubbedSrcset = scrubSrcset(srcsetVal);
        if (scrubbedSrcset !== srcsetVal) {
          clone.setAttribute('srcset', scrubbedSrcset);
          sanitizeCounters.blockedUrlSchemes++;
        }
      }
      // style attribute: targeted CSS value scrub.
      var styleVal = clone.getAttribute('style');
      if (styleVal) {
        var scrubbedStyle = scrubCssText(styleVal);
        if (scrubbedStyle !== styleVal) {
          clone.setAttribute('style', scrubbedStyle);
          sanitizeCounters.cssScrubs++;
        }
      }
      // <style> ELEMENT text: same CSS value scrub as head styles. This is
      // the namespace-confusion mXSS surface (threat T-03-03): a confused
      // parse can leave hostile markup as the style element's RAW TEXT,
      // invisible to attribute enumeration -- scrubCssText pass 5 removes
      // it. Detached clone only; the live element's text is untouched.
      if (tag === 'style') {
        var styleElText = clone.textContent;
        if (styleElText) {
          var scrubbedElText = scrubCssText(styleElText);
          if (scrubbedElText !== styleElText) {
            clone.textContent = scrubbedElText;
            sanitizeCounters.cssScrubs++;
          }
        }
      }
      return {};
    }

    if (kind === 'subtree') {
      var root = payload.root;
      if (!root || root.nodeType !== Node.ELEMENT_NODE) return {};
      // Root itself forbidden (script/noscript/object/embed): signal the
      // caller to emit nothing rather than an empty-html op.
      var rootResult = sanitizeForWire('element', { orig: payload.liveRoot, clone: root });
      if (rootResult && rootResult.drop) {
        return { drop: true };
      }
      var descendants = root.querySelectorAll('*');
      for (var d = 0; d < descendants.length; d++) {
        var desc = descendants[d];
        // Skip nodes already detached with a removed forbidden ancestor
        // (querySelectorAll is static; removal does not re-enumerate).
        if (!root.contains(desc)) continue;
        var descResult = sanitizeForWire('element', { orig: null, clone: desc });
        if (descResult && descResult.drop && desc.parentNode) {
          desc.parentNode.removeChild(desc);
        }
      }
      return {};
    }

    if (kind === 'text') {
      // IDENTITY HOOK (this plan): the SEC-03 masking seam. Plan 03-03
      // consults payload.owner against maskTextSelector / maskTextFn here
      // and increments maskedTextNodes; Phase 8 CAPT-05 typed-text capture
      // plugs into the same seam. Until then text passes through unchanged.
      return { text: payload.text };
    }

    if (kind === 'css') {
      var scrubbedCss = scrubCssText(payload.css);
      if (scrubbedCss !== payload.css) {
        sanitizeCounters.cssScrubs++;
      }
      return { css: scrubbedCss };
    }

    return {};
  }

  // =========================================================================
  // 1. DOM Serializer
  // =========================================================================

  /**
   * Absolutify a URL attribute value relative to the current document.
   * Note: javascript: URLs pass through unchanged HERE (reference parity --
   * this helper stays a pure URL resolver); the SEC-01 chokepoint
   * (sanitizeForWire) neutralizes dangerous schemes AFTER absolutification,
   * so the scheme check always runs on final wire values.
   * @param {string} val - The attribute value
   * @returns {string} Absolute URL or original value if invalid
   */
  function absolutifyUrl(val) {
    if (!val || val.startsWith('data:') || val.startsWith('blob:') || val.startsWith('javascript:')) {
      return val;
    }
    try {
      return new URL(val, document.baseURI).href;
    } catch (e) {
      return val;
    }
  }

  /**
   * Absolutify srcset attribute (comma-separated URL descriptors).
   * @param {string} srcset
   * @returns {string}
   */
  function absolutifySrcset(srcset) {
    if (!srcset) return srcset;
    return srcset.split(',').map(function(entry) {
      var parts = entry.trim().split(/\s+/);
      if (parts.length > 0) {
        parts[0] = absolutifyUrl(parts[0]);
      }
      return parts.join(' ');
    }).join(', ');
  }

  /**
   * Collect computed styles for an element as inline style text.
   * Iterates CURATED_PROPS (~85 visual-fidelity properties) instead of all
   * 300+ computed properties. Skips common defaults to reduce payload size
   * (D-04, D-07, D-08).
   * @param {Element} original - The original DOM element (for getComputedStyle)
   * @param {string[]} [props] - Property list; defaults to CURATED_PROPS
   * @returns {string} 'prop:value;...' style text
   */
  function collectComputedStyleText(original, props) {
    try {
      var computed = window.getComputedStyle(original);
      var styles = [];
      var styleProps = props || CURATED_PROPS;

      for (var i = 0; i < styleProps.length; i++) {
        var prop = styleProps[i];
        var val = computed.getPropertyValue(prop);
        if (!val || val === '') continue;
        // Skip common defaults to reduce payload (per D-08)
        if (STYLE_DEFAULTS[prop] === val) continue;
        // Skip values that are just browser defaults for most elements
        if (val === '0px' || val === 'normal' || val === 'none' || val === 'auto' || val === '0s' || val === '0px 0px') {
          if (!STYLE_DEFAULTS[prop]) continue;
        }
        styles.push(prop + ':' + val);
      }

      return styles.join(';');
    } catch (e) {
      // getComputedStyle can fail for detached elements
      return '';
    }
  }

  /**
   * Capture curated computed styles from the original element onto the clone
   * as an inline style attribute.
   * @param {Element} original
   * @param {Element} clone
   */
  function captureComputedStyles(original, clone) {
    var styleText = collectComputedStyleText(original, CURATED_PROPS);
    if (styleText) {
      clone.setAttribute('style', styleText);
    }
  }

  /**
   * Serialize the attributes of a shell element (html/body), dropping style
   * and on* handler attributes. This was the reference's ONLY on*-strip
   * site; Phase 3 SEC-01 generalized the same name test to every
   * serialization path via the sanitizeForWire chokepoint (threat T-03-01).
   * @param {Element} el
   * @returns {Object} name -> value attribute map
   */
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

  /**
   * Serialize the full DOM body into a clean HTML string.
   * Strips scripts, absolutifies URLs, assigns stable node-id attributes
   * (NID_ATTR), renders iframes live with absolutified src, and captures
   * curated computed styles.
   *
   * @returns {Object} { html, stylesheets, scrollX, scrollY, viewportWidth, viewportHeight,
   *                     pageWidth, pageHeight, url, title }
   */
  function serializeDOM() {
    // SEC-01: counter snapshot for the ONE aggregate strip warn per pass.
    var sanBefore = sanitizeCountersSnapshot();

    // Reset node ID counter for each full snapshot
    nextNodeId = 1;

    // Clone the body for transformation
    var clone = document.body.cloneNode(true);

    // Build a map from original elements to cloned elements for computed style capture.
    // Walk original body and clone in parallel using TreeWalker.
    var origWalker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_ELEMENT,
      null
    );
    var cloneWalker = document.createTreeWalker(
      clone,
      NodeFilter.SHOW_ELEMENT,
      null
    );

    // Collect elements to process (TreeWalker is live, so modifying during walk is risky)
    var pairs = [];
    var origEl = origWalker.nextNode();
    var cloneEl = cloneWalker.nextNode();
    while (origEl && cloneEl) {
      pairs.push({ orig: origEl, clone: cloneEl });
      origEl = origWalker.nextNode();
      cloneEl = cloneWalker.nextNode();
    }

    // Elements to remove from clone (scripts, noscript, host-flagged elements)
    var toRemove = [];

    for (var i = 0; i < pairs.length; i++) {
      var orig = pairs[i].orig;
      var cl = pairs[i].clone;
      var tag = cl.tagName ? cl.tagName.toLowerCase() : '';

      // SEC-01 drop decision routed through the chokepoint: script/noscript
      // (reference parity) plus object/embed (blocklist) -- the decision
      // logic lives INSIDE sanitizeForWire; this loop only routes. The same
      // call scrubs the surviving clone's RAW attribute values (the
      // post-absolutification re-scrub below covers final wire values).
      // Dropped elements exit BEFORE node-id assignment, exactly like the
      // reference's script/noscript handling.
      var elemDecision = sanitizeForWire('element', { orig: orig, clone: cl });
      if (elemDecision && elemDecision.drop) {
        toRemove.push(cl);
        continue;
      }

      // skipElement seam: elements the host flags (its own UI) are dropped
      // from the clone before any node-id assignment. The default predicate
      // returns false, which matches the reference running on a page with no
      // host overlay present. Exception-contained: a throwing host predicate
      // is logged and treated as not-skipped (never escapes start()).
      if (safeSkipElement(cl)) {
        toRemove.push(cl);
        continue;
      }
      // Reference parity (dom-stream.js 420-424): descendants of a
      // host-skipped element are skipped too, with NO node-id assignment --
      // removing the skipped root above already drops the whole subtree
      // from the clone.
      if (skipElementWithAncestors(cl)) {
        continue;
      }

      // Keep iframes live with absolutified src (D-04)
      if (tag === 'iframe') {
        assignNodeId(orig, cl);
        var iframeSrc = cl.getAttribute('src');
        if (iframeSrc) {
          cl.setAttribute('src', absolutifyUrl(iframeSrc));
        }
        // Security: prevent interaction with embedded content (D-05)
        var existingStyle = cl.getAttribute('style') || '';
        cl.setAttribute('style', existingStyle + ';pointer-events:none');
        // Capture computed styles for sizing/positioning
        captureComputedStyles(orig, cl);
        // SEC-01: iframe exits the loop early, so it gets its own
        // final-wire-value scrub (srcdoc drop + post-absolutification
        // scheme check on src).
        sanitizeForWire('element', { orig: orig, clone: cl });
        continue;
      }

      // Assign stable node IDs on both the live DOM and the serialized clone.
      var nid = assignNodeId(orig, cl);

      // Canvas-to-img conversion: capture canvas content before it's lost in the clone
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
          // Tainted canvas or security error -- leave as empty canvas
          cl.setAttribute(NID_ATTR, nid);
        }
        continue;
      }

      // Absolutify URL attributes
      for (var a = 0; a < URL_ATTRS.length; a++) {
        var attrVal = cl.getAttribute(URL_ATTRS[a]);
        if (attrVal) {
          cl.setAttribute(URL_ATTRS[a], absolutifyUrl(attrVal));
        }
      }

      // SVG xlink:href absolutification
      try {
        var xlinkHref = cl.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
        if (xlinkHref) {
          cl.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', absolutifyUrl(xlinkHref));
        }
      } catch (e) { /* not an SVG element or no xlink support */ }

      // Absolutify srcset
      var srcsetVal = cl.getAttribute('srcset');
      if (srcsetVal) {
        cl.setAttribute('srcset', absolutifySrcset(srcsetVal));
      }

      // Capture computed styles from original element
      captureComputedStyles(orig, cl);

      // SEC-01 re-scrub on FINAL wire values: absolutifyUrl normalizes
      // whitespace-obfuscated schemes (the URL parser strips tab/LF/CR), and
      // captureComputedStyles rewrites the style attribute -- so the scheme
      // check and CSS scrub must run again after both. Idempotent: counters
      // only move when an attribute value actually changes.
      sanitizeForWire('element', { orig: orig, clone: cl });
    }

    // Remove marked elements
    for (var r = 0; r < toRemove.length; r++) {
      if (toRemove[r].parentNode) {
        toRemove[r].parentNode.removeChild(toRemove[r]);
      }
    }

    // Collect stylesheet URLs from document.head
    var stylesheets = [];
    var links = document.querySelectorAll('head link[rel="stylesheet"]');
    for (var s = 0; s < links.length; s++) {
      var href = links[s].getAttribute('href');
      if (href) {
        stylesheets.push(absolutifyUrl(href));
      }
    }

    // Collect inline <style> tags from document.head, value-scrubbed
    // through the chokepoint's 'css' dispatch (SEC-01: dangerous url()
    // schemes, expression(), -moz-binding, non-http(s) @import, </style
    // breakout). Benign CSS passes byte-identical.
    var inlineStyles = [];
    var styleTags = document.querySelectorAll('head style');
    for (var st = 0; st < styleTags.length; st++) {
      var cssText = styleTags[st].textContent;
      if (cssText && cssText.length < INLINE_STYLE_MAX_BYTES) {
        inlineStyles.push(sanitizeForWire('css', { css: cssText }).css);
      }
    }

    var html = clone.innerHTML;
    var truncated = false;
    var missingDescendants = 0;

    // Phase 211-02 (STREAM-03 + STREAM-04): single TreeWalker pre-pass on the
    // LIVE document reads getBoundingClientRect().top per nid-annotated
    // element into a Map BEFORE any clone mutation. This collapses N forced
    // layout flushes into 1 (web-perf folklore: read-then-write batching).
    // The Map is the authoritative position source because the clone is not
    // in the document tree and getBoundingClientRect() on it returns zeros.
    var topByNid = new Map();
    try {
      var walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_ELEMENT,
        {
          acceptNode: function(el) {
            return (el.hasAttribute && el.hasAttribute(NID_ATTR))
              ? NodeFilter.FILTER_ACCEPT
              : NodeFilter.FILTER_SKIP;
          }
        }
      );
      var liveEl;
      while ((liveEl = walker.nextNode())) {
        var liveNid = liveEl.getAttribute(NID_ATTR);
        if (liveNid) {
          // Single getBoundingClientRect call per annotated element.
          // All reads happen before any clone mutation -> 1 layout flush.
          topByNid.set(liveNid, liveEl.getBoundingClientRect().top);
        }
      }
    } catch (e) { /* TreeWalker unavailable in this realm; truncation falls back to no-op */ }

    // SNAPSHOT_BUDGET_BYTES is the imported 80%-of-relay-cap budget. The
    // comparison against html.length (UTF-16 code units, not bytes) is an
    // inherited reference quirk preserved for parity.
    if (html.length > SNAPSHOT_BUDGET_BYTES) {
      truncated = true;
      var viewportCutoff = window.innerHeight * TRUNCATION_VIEWPORT_MULTIPLIER;

      // Pass 1: drop complete subtrees whose cached top is below the
      // viewport-multiple cutoff. Iterate the clone's annotated elements;
      // consult the Map for live top. Removing a parent later in the loop
      // also removes its children, so we walk last-to-first to keep indices
      // stable as we mutate.
      var cloneEls1 = clone.querySelectorAll('[' + NID_ATTR + ']');
      for (var t = cloneEls1.length - 1; t >= 0; t--) {
        var nidVal1 = cloneEls1[t].getAttribute(NID_ATTR);
        var top1 = topByNid.get(nidVal1);
        if (typeof top1 === 'number' && top1 > viewportCutoff) {
          var parent1 = cloneEls1[t].parentNode;
          if (parent1) {
            parent1.removeChild(cloneEls1[t]);
            missingDescendants++;
          }
        }
      }

      // Re-measure; if still over cap, pass 2 walks remaining annotated
      // elements in document order and drops complete subtrees until under
      // cap. Only complete subtrees are removed -- never a mid-element cut.
      html = clone.innerHTML;
      if (html.length > SNAPSHOT_BUDGET_BYTES) {
        var cloneEls2 = clone.querySelectorAll('[' + NID_ATTR + ']');
        for (var u = cloneEls2.length - 1; u >= 0 && clone.innerHTML.length > SNAPSHOT_BUDGET_BYTES; u--) {
          var parent2 = cloneEls2[u].parentNode;
          if (parent2 && cloneEls2[u].parentNode) {
            parent2.removeChild(cloneEls2[u]);
            missingDescendants++;
          }
        }
        html = clone.innerHTML;
      }
    }

    // SEC-01: one aggregate strip warn per serialization pass (never silent).
    warnIfSanitizeStrips(sanBefore);

    return {
      html: html,
      truncated: truncated,
      missingDescendants: missingDescendants,
      stylesheets: stylesheets,
      inlineStyles: inlineStyles,
      htmlAttrs: serializeShellAttributes(document.documentElement),
      bodyAttrs: serializeShellAttributes(document.body),
      htmlStyle: collectComputedStyleText(document.documentElement, SHELL_PROPS),
      bodyStyle: collectComputedStyleText(document.body, SHELL_PROPS),
      scrollX: window.scrollX,
      scrollY: window.scrollY,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      pageWidth: document.documentElement.scrollWidth,
      pageHeight: document.documentElement.scrollHeight,
      url: location.href,
      title: document.title,
      streamSessionId: streamSessionId || '',
      snapshotId: currentSnapshotId || 0
    };
  }

  // =========================================================================
  // 2. MutationObserver Streaming
  // =========================================================================

  /**
   * Stamp node ids on an added node and its descendants and absolutify URLs,
   * then serialize a SCRUBBED detached clone of it (for add ops).
   *
   * SEC-01: the live node keeps its nid stamping and URL absolutification
   * exactly as before (reference parity -- the observed page must keep its
   * event handlers; stripping the live node would change page behavior).
   * The wire HTML is then built from a detached cloneNode(true) routed
   * through sanitizeForWire('subtree') -- the serialized output never comes
   * from the live node directly (threat T-03-06).
   *
   * @param {Element} el - Added element to process
   * @returns {string} Scrubbed wire HTML ('' when the root itself is a
   *   forbidden element -- the caller emits no add op for it)
   */
  function processAddedNode(el) {
    if (el.nodeType !== Node.ELEMENT_NODE) return '';

    // Live-node stamping + absolutification (reference parity, unchanged).
    el.setAttribute(NID_ATTR, String(nextNodeId++));
    for (var a = 0; a < URL_ATTRS.length; a++) {
      var val = el.getAttribute(URL_ATTRS[a]);
      if (val) el.setAttribute(URL_ATTRS[a], absolutifyUrl(val));
    }
    var srcset = el.getAttribute('srcset');
    if (srcset) el.setAttribute('srcset', absolutifySrcset(srcset));

    // Process descendant elements
    var descendants = el.querySelectorAll('*');
    for (var d = 0; d < descendants.length; d++) {
      var desc = descendants[d];
      desc.setAttribute(NID_ATTR, String(nextNodeId++));
      for (var b = 0; b < URL_ATTRS.length; b++) {
        var dv = desc.getAttribute(URL_ATTRS[b]);
        if (dv) desc.setAttribute(URL_ATTRS[b], absolutifyUrl(dv));
      }
      var ds = desc.getAttribute('srcset');
      if (ds) desc.setAttribute('srcset', absolutifySrcset(ds));
    }

    // SEC-01: scrub a detached wire clone through the chokepoint and
    // serialize THAT -- never the live node's own markup.
    var wireClone = el.cloneNode(true);
    var subtreeResult = sanitizeForWire('subtree', { root: wireClone, liveRoot: el });
    if (subtreeResult && subtreeResult.drop) return '';
    return wireClone.outerHTML || '';
  }

  /**
   * Process a batch of accumulated mutations into diff objects.
   * @param {MutationRecord[]} mutations
   * @returns {Array} Array of diff objects
   */
  function processMutationBatch(mutations) {
    var diffs = [];
    // Dedup registry for childList-derived text ops (fidelity fix, ledger
    // D6): multiple childList records in one batch targeting the same
    // element (e.g. two textContent= writes between flushes) collapse to a
    // single op. The op text is read LIVE from the target at process time,
    // so every record for the same element yields the same final value --
    // dedup loses nothing.
    var textOpNids = {};

    for (var i = 0; i < mutations.length; i++) {
      var m = mutations[i];

      // Skip mutations on host-flagged elements (skipElement seam).
      // Ancestor-inclusive, matching the reference's isFsbOverlay closest()
      // semantics: mutations anywhere inside a skipped subtree are dropped.
      if (m.target && m.target.nodeType === Node.ELEMENT_NODE && skipElementWithAncestors(m.target)) {
        continue;
      }
      if (m.target && m.target.nodeType === Node.TEXT_NODE &&
          m.target.parentElement && skipElementWithAncestors(m.target.parentElement)) {
        continue;
      }

      if (m.type === 'childList') {
        // Bare text-node add/remove detection (fidelity fix, differential
        // ledger D6): el.textContent = '...' REPLACES the text child, which
        // the observer reports as a childList record with a TEXT-node
        // removal+addition. The reference's element-only loops drop it --
        // silent mirror drift with no stale-miss and no self-heal (Phase 2
        // real-browser checkpoint finding). When any added/removed node is
        // a TEXT or CDATA node, a text op for the mutation TARGET (the
        // parent element) is emitted below, mirroring the characterData
        // branch's shape -- unless the mixed-content guard at the emission
        // site suppresses it. Comment nodes stay excluded: they never
        // render.
        var sawBareTextNode = false;

        // Added nodes
        for (var a = 0; a < m.addedNodes.length; a++) {
          var added = m.addedNodes[a];
          if (added.nodeType === Node.ELEMENT_NODE) {
            if (skipElementWithAncestors(added)) continue;

            // Node identity is read through the NID_ATTR protocol constant
            // (single source of truth, src/protocol/messages.js) -- never a
            // hardcoded dataset-key mirror that could silently desync.
            var parentNid = m.target.getAttribute ? m.target.getAttribute(NID_ATTR) : null;
            if (!parentNid) continue; // Parent not tracked

            var html = processAddedNode(added);
            // SEC-01: a forbidden root (script/noscript/object/embed)
            // scrubs to nothing -- emit no add op rather than an empty op.
            if (!html) continue;
            var nextSib = added.nextElementSibling;
            var beforeNid = (nextSib && nextSib.getAttribute) ? nextSib.getAttribute(NID_ATTR) || null : null;

            diffs.push({
              op: 'add',
              parentNid: parentNid,
              html: html,
              beforeNid: beforeNid
            });
          } else if (added.nodeType === Node.TEXT_NODE || added.nodeType === Node.CDATA_SECTION_NODE) {
            sawBareTextNode = true;
          }
        }

        // Removed nodes
        for (var r = 0; r < m.removedNodes.length; r++) {
          var removed = m.removedNodes[r];
          if (removed.nodeType === Node.ELEMENT_NODE) {
            var nid = removed.getAttribute ? removed.getAttribute(NID_ATTR) : null;
            if (!nid) continue; // Not tracked
            diffs.push({ op: 'rm', nid: nid });
          } else if (removed.nodeType === Node.TEXT_NODE || removed.nodeType === Node.CDATA_SECTION_NODE) {
            sawBareTextNode = true;
          }
        }

        // Emit AFTER both loops so a textContent= that also removed element
        // children orders its rm ops before the text op -- the renderer then
        // removes the elements and sets the final flat text, matching the
        // live DOM end state.
        //
        // MIXED-CONTENT GUARD (review CR-01): the renderer applies this op
        // as textContent = text, which REPLACES every child of the mirrored
        // target. Emitting it while the live target still has element
        // children (a text-node append into a mixed container, innerHTML
        // with mixed content) would destroy mirrored element subtrees that
        // still exist in the live DOM -- structural corruption with no
        // stale-miss signal. Gating on firstElementChild keeps the
        // textContent= shape working (its element children were just
        // removed, so the live read is null) and reverts mixed-content text
        // changes to the reference's drop behavior: text drift, structure
        // intact. Residual gap documented in the E2 README entry and the D6
        // ledger rationale.
        if (sawBareTextNode && !m.target.firstElementChild) {
          var textTargetNid = m.target.getAttribute ? m.target.getAttribute(NID_ATTR) : null;
          if (textTargetNid && !textOpNids[textTargetNid]) {
            textOpNids[textTargetNid] = true;
            // Same wire shape as the characterData branch: the renderer's
            // DIFF_OP.TEXT applier sets textContent on the nid target.
            diffs.push({
              op: 'text',
              nid: textTargetNid,
              text: m.target.textContent
            });
          }
        }
      } else if (m.type === 'attributes') {
        var targetNid = m.target.getAttribute ? m.target.getAttribute(NID_ATTR) : null;
        if (!targetNid) continue;

        var attrVal = m.target.getAttribute(m.attributeName);
        // Absolutify URL attributes in mutations
        if (URL_ATTRS.indexOf(m.attributeName) !== -1 && attrVal) {
          attrVal = absolutifyUrl(attrVal);
        }
        if (m.attributeName === 'srcset' && attrVal) {
          attrVal = absolutifySrcset(attrVal);
        }

        diffs.push({
          op: 'attr',
          nid: targetNid,
          attr: m.attributeName,
          val: attrVal
        });
      } else if (m.type === 'characterData') {
        var parentEl = m.target.parentElement;
        var textNid = (parentEl && parentEl.getAttribute) ? parentEl.getAttribute(NID_ATTR) : null;
        if (!textNid) continue;

        diffs.push({
          op: 'text',
          nid: textNid,
          text: m.target.textContent
        });
      }
    }

    return diffs;
  }

  /**
   * Flush pending mutations: process into diffs and send via the transport.
   */
  function flushMutations() {
    batchTimer = null;
    if (pendingMutations.length === 0) return;

    var batch = pendingMutations;
    pendingMutations = [];

    // SEC-01: the aggregate strip warn fires even when every diff in the
    // batch was dropped by the chokepoint (counted + logged, never silent),
    // so the snapshot/compare wraps the empty-diffs early return.
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

    // Phase 211-02 STREAM-02: stale counter resets on successful drain.
    // Reset is flush-based (not ack-based) per D-14 / STREAM-FUTURE-01 deferral.
    // The peak count is captured in the payload above BEFORE this reset, so
    // the host sees the watchdog-rescue count at drain time.
    lastDrainTs = Date.now();
    staleFlushCount = 0;
  }

  /**
   * Start the MutationObserver stream on document.body.
   * Batches mutations via requestAnimationFrame for display-matched delivery (D-06).
   */
  function startMutationStream() {
    if (mutationObserver) {
      mutationObserver.disconnect();
    }

    pendingMutations = [];

    mutationObserver = new MutationObserver(function(mutations) {
      // Accumulate mutations
      for (var i = 0; i < mutations.length; i++) {
        pendingMutations.push(mutations[i]);
      }

      // Batch flush synced to browser paint cycle via rAF (FIDELITY-03)
      if (batchTimer) cancelAnimationFrame(batchTimer);
      batchTimer = requestAnimationFrame(flushMutations);
    });

    mutationObserver.observe(document.body, {
      childList: true,
      attributes: true,
      characterData: true,
      subtree: true,
      attributeOldValue: true
    });

    // Phase 211-02 STREAM-01: 5s capture-side self-watchdog (trip wire).
    // Detects stuck mutation queues without involving the host. Uses a
    // self-re-arming setTimeout chain (never a fixed-interval timer) so
    // cadence resets on every tick and on every successful drain. Host-side
    // safety nets (e.g. the MV3 service-worker alarm in the reference
    // deployment) cover the case where this context itself is wedged.
    lastDrainTs = Date.now();
    if (watchdogTimer) clearTimeout(watchdogTimer);
    var watchdogTick = function() {
      try {
        if (pendingMutations.length > 0 && (Date.now() - lastDrainTs) > MUTATION_STALE_THRESHOLD_MS) {
          // Increment BEFORE forced flush so the new value is observable
          // post-flush (per D-04). flushMutations resets staleFlushCount
          // back to 0, so this counter only grows when the watchdog is
          // actively rescuing a stuck queue.
          staleFlushCount++;
          if (batchTimer) {
            cancelAnimationFrame(batchTimer);
            batchTimer = null;
          }
          flushMutations();
        }
      } catch (e) { /* watchdog must not crash the capture context */ }
      watchdogTimer = setTimeout(watchdogTick, WATCHDOG_TICK_MS);
    };
    watchdogTimer = setTimeout(watchdogTick, WATCHDOG_TICK_MS);

    logger.info('[DOM Stream] MutationObserver started');
  }

  /**
   * Stop the MutationObserver stream and flush any pending mutations.
   */
  function stopMutationStream() {
    if (batchTimer) {
      cancelAnimationFrame(batchTimer);
      batchTimer = null;
    }

    if (watchdogTimer) {
      clearTimeout(watchdogTimer);
      watchdogTimer = null;
    }

    if (mutationObserver) {
      mutationObserver.disconnect();
      mutationObserver = null;
    }

    // Flush any remaining mutations.
    // PARITY: the stop-path payload intentionally omits staleFlushCount,
    // matching the reference's asymmetry between the normal flush and the
    // final stop-path flush.
    if (pendingMutations.length > 0) {
      var batch = pendingMutations;
      pendingMutations = [];
      // SEC-01: same aggregate strip-warn discipline as flushMutations.
      var sanBefore = sanitizeCountersSnapshot();
      var diffs = processMutationBatch(batch);
      warnIfSanitizeStrips(sanBefore);
      if (diffs.length > 0) {
        safeSend(STREAM.MUTATIONS, {
          mutations: diffs,
          streamSessionId: streamSessionId || '',
          snapshotId: currentSnapshotId || 0
        });
      }
    }

    logger.info('[DOM Stream] MutationObserver stopped');
  }

  // =========================================================================
  // 3. Scroll Tracker
  // =========================================================================

  /**
   * Start tracking scroll position changes.
   * Throttled to max 1 event per SCROLL_THROTTLE_MS using timestamp check.
   */
  function startScrollTracker() {
    if (scrollHandler) {
      window.removeEventListener('scroll', scrollHandler);
    }

    lastScrollSend = 0;

    scrollHandler = function() {
      var now = Date.now();
      if (now - lastScrollSend < SCROLL_THROTTLE_MS) return;
      lastScrollSend = now;

      safeSend(STREAM.SCROLL, {
        scrollX: window.scrollX,
        scrollY: window.scrollY,
        streamSessionId: streamSessionId || '',
        snapshotId: currentSnapshotId || 0
      });
    };

    window.addEventListener('scroll', scrollHandler, { passive: true });
    logger.info('[DOM Stream] Scroll tracker started');
  }

  /**
   * Stop tracking scroll position changes.
   */
  function stopScrollTracker() {
    if (scrollHandler) {
      window.removeEventListener('scroll', scrollHandler);
      scrollHandler = null;
    }
    logger.info('[DOM Stream] Scroll tracker stopped');
  }

  // =========================================================================
  // 4. Overlay Event Broadcaster
  // =========================================================================

  /**
   * Read current host overlay state through the overlayProvider seam and
   * broadcast it. Pass-through contract (Phase 2 VIEW-04 extension, README
   * entry E1): EVERY own enumerable key of the provider's returned state is
   * forwarded on the wire as an overlay kind, so custom DOM-anchored
   * overlays reach the viewer end-to-end. The built-ins `glow` and
   * `progress` still default to null when the provider omits them, and the
   * identity keys (streamSessionId / snapshotId) are reserved: they are
   * assigned LAST, after the provider copy, so a provider can never
   * overwrite stream identity (threat T-02-06).
   *
   * With no provider configured -- or a throwing provider -- the message
   * carries exactly { glow: null, progress: null, streamSessionId,
   * snapshotId }, byte-compatible with the reference's wire shape
   * (differential-oracle protection: no fixture configures a provider).
   * @param {boolean} [force] - Bypass the throttle (lifecycle broadcasts)
   */
  function broadcastOverlayState(force) {
    // Throttle to max 1 broadcast per OVERLAY_THROTTLE_MS (per D-05)
    var now = Date.now();
    if (!force && (now - lastOverlayBroadcast < OVERLAY_THROTTLE_MS)) return;
    lastOverlayBroadcast = now;

    var payload = {};

    // overlayProvider seam: replaces the reference's host-namespace overlay
    // reads. Provider errors are swallowed exactly like the reference's
    // try/catch around its overlay reads; on error the payload resets to
    // the defaults-only shape.
    try {
      if (overlayProvider) {
        var state = overlayProvider();
        if (state) {
          for (var key in state) {
            if (Object.prototype.hasOwnProperty.call(state, key)) {
              payload[key] = state[key];
            }
          }
        }
      }
    } catch (e) { payload = {}; /* swallowed like the reference */ }

    // Built-in kinds default null even when the provider omits them
    // (reference wire shape; the viewer's null-hides contract relies on
    // these keys always being present).
    payload.glow = payload.glow || null;
    payload.progress = payload.progress || null;

    // Identity keys assigned LAST: provider keys can never overwrite the
    // stream identity (T-02-06).
    payload.streamSessionId = streamSessionId || '';
    payload.snapshotId = currentSnapshotId || 0;

    safeSend(STREAM.OVERLAY, payload);
  }

  // =========================================================================
  // 5. Lifecycle API (replaces the reference's control-message listener)
  // =========================================================================

  /**
   * Begin a fresh capture session: mint new identity, serialize a full
   * snapshot, then arm the mutation observer and scroll tracker.
   * Calling start() while streaming restarts cleanly (re-injection guard).
   */
  function start() {
    logger.info('[DOM Stream] Start requested');
    injectDialogInterceptor();
    setupDialogRelay();
    // Re-injection guard: stop existing stream before restarting
    if (streaming) {
      stopMutationStream();
      stopScrollTracker();
    }
    beginStreamSession();
    var snapshot = serializeDOM();
    safeSend(STREAM.SNAPSHOT, snapshot);
    startMutationStream();
    startScrollTracker();
    streaming = true;
    broadcastOverlayState(true);
  }

  /**
   * Stop the capture: halt observers (final mutation flush included), then
   * give the host transport one deterministic flush() drain point.
   */
  function stop() {
    logger.info('[DOM Stream] Stop requested');
    stopMutationStream();
    stopScrollTracker();
    streaming = false;
    safeFlush();
  }

  /**
   * Pause the capture: halt observers but keep the session alive
   * (streaming stays true — paused state, not stopped).
   */
  function pause() {
    logger.info('[DOM Stream] Pause requested');
    stopMutationStream();
    stopScrollTracker();
    // Keep streaming = true (paused state, not stopped)
  }

  /**
   * Resume the capture: re-arm the mutation observer and scroll tracker ONLY.
   *
   * D-06 USER OVERRIDE (divergence-ledger entry D1): unlike the reference,
   * resume does NOT mint a new session, does NOT re-serialize, and does NOT
   * send a snapshot — the same streamSessionId/snapshotId continue. Mutations
   * that occurred while paused are missed by design; hosts that need a fresh
   * view call stop() then start().
   */
  function resume() {
    logger.info('[DOM Stream] Resume requested');
    startMutationStream();
    startScrollTracker();
    streaming = true;
  }

  // Readiness signal. The reference pinged its host once at script-load
  // time; the factory's creation moment is the closest analog for an
  // explicitly imported module (any residual timing difference is
  // divergence-ledger entry D3). The reference's host-polled readiness
  // probe is dropped entirely — hosts call these functions directly
  // (ledger entry D4).
  safeSend(STREAM.READY, {});
  logger.info('[DOM Stream] Module loaded');

  return {
    start: start,
    stop: stop,
    pause: pause,
    resume: resume
  };
}
