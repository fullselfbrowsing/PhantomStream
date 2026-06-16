(function () {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  if (window.top !== window) return;
  if (window.__phantomStreamInjected) return;
  window.__phantomStreamInjected = true;
  var PHANTOM_STREAM_BRIDGE_TOKEN = "";

  var RELAY_PER_MESSAGE_LIMIT_BYTES = 1048576;
  var SNAPSHOT_BUDGET_BYTES = Math.floor(RELAY_PER_MESSAGE_LIMIT_BYTES * 0.8);
  var TRUNCATION_VIEWPORT_MULTIPLIER = 3;
  var SCROLL_THROTTLE_MS = 200;
  var OVERLAY_THROTTLE_MS = 500;
  var MUTATION_STALE_THRESHOLD_MS = 5000;
  var WATCHDOG_TICK_MS = 500;
  var INLINE_STYLE_MAX_BYTES = 500000;

  var CONTROL = {
    START: "dash:dom-stream-start",
    STOP: "dash:dom-stream-stop",
    PAUSE: "dash:dom-stream-pause",
    RESUME: "dash:dom-stream-resume",
    SUBTREE_REQUEST: "dash:ps-subtree-request"
  };

  var STREAM = {
    SNAPSHOT: "ext:dom-snapshot",
    MUTATIONS: "ext:dom-mutations",
    SCROLL: "ext:dom-scroll",
    OVERLAY: "ext:dom-overlay",
    DIALOG: "ext:dom-dialog",
    READY: "ext:dom-ready",
    REQUEST_SNAPSHOT: "ext:request-snapshot",
    STATE: "ext:stream-state",
    SUBTREE_RESPONSE: "ext:ps-subtree-response"
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

  function createStreamSessionId(nowMs, rand) {
    return "stream_" + nowMs.toString(36) + "_" + rand;
  }
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
// differential oracle, is the exit bar. Phase 8 replaces the inherited
// html.length truncation quirk with UTF-8 wire-byte budgeting for relay
// safety. Phase 3 SEC-01 DIVERGENCE: the
// sanitizeForWire chokepoint (a named inner function of createCapture) now
// strips on* handlers, dangerous URL schemes, srcdoc attributes and
// object/embed subtrees, and value-scrubs CSS on every serialization path --
// the reference stripped on* only on the html/body shells and passed
// javascript: URLs straight through. All strips are counted + logged (never
// silent), and ONLY detached clones / wire values are touched: the live
// observed page keeps its attributes and handlers.


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
 * Minimal srcset candidate parser for the URL+descriptor forms this project
 * emits. Unlike split(','), it keeps commas inside data:image URLs attached
 * to the URL token, so a benign data candidate cannot turn into a bogus
 * relative fetch candidate when one hostile sibling forces a rebuild.
 * @param {string} srcset
 * @returns {{url: string, descriptor: string}[]}
 */
function parseSrcsetCandidates(srcset) {
  var raw = String(srcset == null ? '' : srcset);
  var out = [];
  var i = 0;
  while (i < raw.length) {
    while (i < raw.length && /[\s,]/.test(raw.charAt(i))) i++;
    var urlStart = i;
    var isData = raw.slice(i, i + 5).toLowerCase() === 'data:';
    while (i < raw.length
        && !/\s/.test(raw.charAt(i))
        && (isData || raw.charAt(i) !== ',')) {
      i++;
    }
    var url = raw.slice(urlStart, i);
    while (i < raw.length && /\s/.test(raw.charAt(i))) i++;
    var descriptorStart = i;
    while (i < raw.length && raw.charAt(i) !== ',') i++;
    var descriptor = raw.slice(descriptorStart, i).trim();
    if (url) out.push({ url: url, descriptor: descriptor });
    if (raw.charAt(i) === ',') i++;
  }
  return out;
}

function formatSrcsetCandidate(candidate) {
  return candidate.descriptor ? candidate.url + ' ' + candidate.descriptor : candidate.url;
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
    var entries = parseSrcsetCandidates(srcset);
    var kept = [];
    var changed = false;
    for (var i = 0; i < entries.length; i++) {
      if (entries[i].url && hasDangerousScheme(entries[i].url)) {
        changed = true;
        continue;
      }
      kept.push(formatSrcsetCandidate(entries[i]));
    }
    return changed ? kept.join(', ') : srcset;
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
 *   4. @imp0rt statements survive ONLY with an explicit http(s) target
 *      (an @imp0rt pulls a whole stylesheet -- script-equivalent blast
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
    // Pass 4a: @imp0rt scheme gate (statement removed unless explicit http(s)).
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
 * rrweb-compatible default text mask (SEC-03, 03-RESEARCH Pattern 5 / Code
 * Examples; cited from rrweb-snapshot snapshot.ts:
 * textContent.replace(/[\S]/g, '*')). Every non-whitespace character becomes
 * '*'; whitespace and string length are preserved so masked text keeps its
 * layout shape. Idempotent: masking masked output is a no-op.
 * @param {string} text
 * @returns {string}
 */
function defaultMaskText(text) {
  return String(text).replace(/[\S]/g, '*');
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
 * @property {string} [blockSelector]
 *   Optional (SEC-03). CSS selector: matching elements are replaced on the
 *   wire by a dimension-preserving placeholder carrying ONLY rr_width /
 *   rr_height (px, from the live rect) and the nid -- no attributes, no
 *   children, no text; mutations anywhere inside a blocked subtree emit
 *   nothing. Invalid selectors THROW Error('invalid-mask-selector') at
 *   factory time (fail closed and loud -- a silently dropped mask selector
 *   would be a privacy leak).
 * @property {string} [maskTextSelector]
 *   Optional (SEC-03). CSS selector: text of matching elements AND their
 *   descendants is masked (default mask: '*' per non-whitespace character,
 *   whitespace and length preserved -- rrweb-compatible). Same factory-time
 *   validation as blockSelector.
 * @property {boolean} [maskInputs]
 *   Optional (SEC-03), default false. When true, ALL input/textarea/select
 *   values are masked. Independent of this option, input[type=password]
 *   values are ALWAYS masked (non-configurable rrweb-parity default).
 * @property {(text: string, element: Element) => string} [maskTextFn]
 *   Optional (SEC-03). Custom text mask (rrweb signature). A THROWING fn
 *   falls back to the default asterisk mask -- raw text never leaks.
 * @property {(text: string, element: Element) => string} [maskInputFn]
 *   Optional (SEC-03). Custom input-value mask (rrweb signature). Same
 *   fail-closed containment as maskTextFn.
 */

/**
 * @typedef {Object} CaptureHandle
 * @property {() => void} start   Fresh session: mint ids, snapshot, observe.
 * @property {() => void} stop    Stop observers (final flush included).
 * @property {() => void} pause   Stop observers, keep the session alive.
 * @property {() => void} resume  Re-arm observers; same session, no snapshot.
 * @property {(element: Element) => string|null} getNodeId
 *   getNodeId(element) -> string|null
 *   Return the active PhantomStream nid for a tracked live element, or null
 *   for untracked, skipped, disconnected, or inactive-session nodes.
 */

/**
 * Create a capture instance bound to the ambient window/document.
 *
 * All reference module state lives in this closure, so multiple captures can
 * coexist in one process (each against its own globals). No DOM access
 * happens at module imp0rt time; the ambient globals are dereferenced when
 * the factory and its functions run.
 *
 * @param {CaptureOptions} config
 * @returns {CaptureHandle}
 */
function createCapture(config) {
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

  // SEC-03 privacy-masking config (plan 03-03, rrweb-compatible vocabulary
  // per 03-RESEARCH Pattern 5). Every option defaults OFF: with no masking
  // config the wire is byte-identical to the unmasked output. The one
  // non-configurable rule: input[type=password] values are ALWAYS masked
  // regardless of these options. Selectors are compiled (validated) ONCE here
  // at factory time -- an invalid selector THROWS Error('invalid-mask-
  // selector') from compileMaskSelector (factory-time validation is the one
  // allowed throwing site, the transport-send-required precedent above;
  // silent masking failure would be a privacy leak, so misconfiguration
  // fails closed and LOUD). Runtime matcher errors are contained
  // per-element instead (Pitfall 6: capture never wedges).
  var maskInputs = cfg.maskInputs === true;
  var maskTextFn = (typeof cfg.maskTextFn === 'function') ? cfg.maskTextFn : null;
  var maskInputFn = (typeof cfg.maskInputFn === 'function') ? cfg.maskInputFn : null;
  var blockSelector = compileMaskSelector(cfg.blockSelector);
  var maskTextSelector = compileMaskSelector(cfg.maskTextSelector);

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
        var result = transport.flush();
        if (result && typeof result.catch === 'function') {
          result.catch(function (err) {
            logger.error('[DOM Stream] transport flush failed', err);
          });
        }
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
  var elementToNid = new WeakMap();
  var nidToElement = new Map();
  var scrollHandler = null;
  var lastScrollSend = 0;
  var dialogRelayActive = false;
  var lastOverlayBroadcast = 0;
  var streamSessionId = '';
  var currentSnapshotId = 0;
  var lastDrainTs = 0;
  var staleFlushCount = 0;
  var watchdogTimer = null;
  var observedShadowRoots = new WeakSet();
  var observedFrameDocuments = new Map();
  var frameDocumentToNid = new WeakMap();
  var frameLoadListeners = new Map();
  var valueCaptureActive = false;
  var valueListenerRoots = new WeakSet();
  var valueListenerRecords = [];
  var nativeAttachShadow = null;
  var attachShadowProto = null;

  // SEC-01 sanitization strip counters (closure state, staleFlushCount
  // pattern). Lifecycle is PER-SESSION (03-RESEARCH.md Pitfall 3): reset in
  // beginStreamSession only, never per snapshot or per flush, so strip
  // totals accumulate across one whole stream session. The masked* pair is
  // incremented by the SEC-03 masking pass (plan 03-03) through the same
  // chokepoint.
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

  function ensureNodeId(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return null;
    var existing = elementToNid.get(element);
    if (existing) return existing;
    var nid = String(nextNodeId++);
    elementToNid.set(element, nid);
    nidToElement.set(nid, element);
    return nid;
  }

  function reserveNodeId() {
    nextNodeId++;
  }

  function getTrackedNodeId(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return null;
    var nid = elementToNid.get(element);
    if (!nid) return null;
    if (nidToElement.get(nid) !== element) return null;
    return nid;
  }

  function clearNodeMirror() {
    elementToNid = new WeakMap();
    nidToElement.clear();
  }

  function forgetSubtreeIdentity(root) {
    if (!root || root.nodeType !== Node.ELEMENT_NODE) return;
    var nodes = [root];
    if (root.querySelectorAll) {
      var descendants = root.querySelectorAll('*');
      for (var i = 0; i < descendants.length; i++) nodes.push(descendants[i]);
    }
    for (var n = 0; n < nodes.length; n++) {
      var nid = elementToNid.get(nodes[n]);
      if (nid) {
        elementToNid.delete(nodes[n]);
        if (nidToElement.get(nid) === nodes[n]) nidToElement.delete(nid);
      }
    }
  }

  function assignNodeId(original, clone, cloneToNid) {
    var nid = ensureNodeId(original);
    if (nid && clone && clone.nodeType === Node.ELEMENT_NODE && cloneToNid) {
      cloneToNid.set(clone, nid);
    }
    return nid;
  }

  function cloneElementsWithNodeIds(root, cloneToNid) {
    var out = [];
    if (!root || !cloneToNid) return out;
    var walker = root.ownerDocument.createTreeWalker(
      root,
      NodeFilter.SHOW_ELEMENT,
      null
    );
    var el;
    while ((el = walker.nextNode())) {
      if (cloneToNid.has(el)) out.push(el);
    }
    return out;
  }

  function buildNodeIdSidecar(root, cloneToNid, includeRoot) {
    var nodeIds = [];
    if (!root || !cloneToNid) return nodeIds;
    if (includeRoot && root.nodeType === Node.ELEMENT_NODE && cloneToNid.has(root)) {
      nodeIds.push(cloneToNid.get(root));
    }
    var walker = root.ownerDocument.createTreeWalker(
      root,
      NodeFilter.SHOW_ELEMENT,
      null
    );
    var el;
    while ((el = walker.nextNode())) {
      if (cloneToNid.has(el)) nodeIds.push(cloneToNid.get(el));
    }
    return nodeIds;
  }

  function mutationObserverOptions() {
    return {
      childList: true,
      attributes: true,
      characterData: true,
      subtree: true,
      attributeOldValue: true
    };
  }

  function isOpenShadowRoot(root) {
    return !!(root
      && root.nodeType === Node.DOCUMENT_FRAGMENT_NODE
      && root.host
      && root.mode === 'open');
  }

  function elementsUnderRoot(root) {
    var elements = [];
    if (!root) return elements;
    if (root.nodeType === Node.ELEMENT_NODE) elements.push(root);
    if (root.querySelectorAll) {
      var descendants = root.querySelectorAll('*');
      for (var i = 0; i < descendants.length; i++) elements.push(descendants[i]);
    }
    return elements;
  }

  function getMutationShadowHost(target) {
    if (!target || typeof target.getRootNode !== 'function') return null;
    var root = target.getRootNode();
    if (!isOpenShadowRoot(root)) return null;
    return root.host || null;
  }

  function shadowSlotAssignment(root) {
    if (!root || !root.querySelectorAll) return 'none';
    var slots = root.querySelectorAll('slot');
    var hasDefault = false;
    var hasNamed = false;
    for (var i = 0; i < slots.length; i++) {
      if (slots[i].getAttribute('name')) hasNamed = true;
      else hasDefault = true;
    }
    if (hasNamed) return 'named';
    if (hasDefault) return 'default';
    return 'none';
  }

  function prepareShadowClone(root, container, cloneToNid) {
    var liveDescendants = root && root.querySelectorAll ? root.querySelectorAll('*') : [];
    var cloneDescendants = container.querySelectorAll('*');
    var baseDoc = root && root.ownerDocument ? root.ownerDocument : document;
    for (var i = 0; i < liveDescendants.length; i++) {
      var live = liveDescendants[i];
      var clone = cloneDescendants[i];
      if (!clone) continue;
      if (wireDroppedWithAncestors(live) || skipElementWithAncestors(live)) {
        if (clone.parentNode) clone.parentNode.removeChild(clone);
        continue;
      }
      if (blockedWithAncestors(live.parentElement)) continue;
      var nid = ensureNodeId(live);
      if (nid) cloneToNid.set(clone, nid);
      for (var a = 0; a < URL_ATTRS.length; a++) {
        var val = clone.getAttribute(URL_ATTRS[a]);
        if (val) clone.setAttribute(URL_ATTRS[a], absolutifyUrl(val, baseDoc));
      }
      var srcset = clone.getAttribute('srcset');
      if (srcset) clone.setAttribute('srcset', absolutifySrcset(srcset, baseDoc));
      captureComputedStyles(live, clone);
    }
  }

  function serializeOpenShadowRoot(host, hostNid) {
    if (!host || !host.shadowRoot || !hostNid) return null;
    var root = host.shadowRoot;
    if (!isOpenShadowRoot(root)) return null;

    var ownerDoc = host.ownerDocument || document;
    var container = ownerDoc.createElement('div');
    for (var child = root.firstChild; child; child = child.nextSibling) {
      container.appendChild(child.cloneNode(true));
    }

    var cloneToNid = new Map();
    prepareShadowClone(root, container, cloneToNid);
    var subtreeResult = sanitizeForWire('subtree', {
      root: container,
      liveRoot: root,
      cloneToNid: cloneToNid
    });
    if (subtreeResult && subtreeResult.drop) return null;

    return {
      hostNid: String(hostNid),
      mode: 'open',
      html: container.innerHTML || '',
      nodeIds: buildNodeIdSidecar(container, cloneToNid, false),
      slotAssignment: shadowSlotAssignment(root)
    };
  }

  function collectShadowRootPayloads(root, hostNodeIds, excludedHostNodeIds) {
    var payloads = [];
    var allowed = null;
    if (Array.isArray(hostNodeIds)) {
      allowed = new Set();
      for (var h = 0; h < hostNodeIds.length; h++) allowed.add(String(hostNodeIds[h]));
    }
    var excluded = null;
    if (excludedHostNodeIds && typeof excludedHostNodeIds.has === 'function') {
      excluded = excludedHostNodeIds;
    }

    function visit(treeRoot) {
      var elements = elementsUnderRoot(treeRoot);
      for (var i = 0; i < elements.length; i++) {
        var el = elements[i];
        if (!el || !el.shadowRoot || !isOpenShadowRoot(el.shadowRoot)) continue;
        var hostNid = getTrackedNodeId(el) || ensureNodeId(el);
        if (!hostNid) continue;
        if (allowed && !allowed.has(String(hostNid))) continue;
        if (excluded && excluded.has(String(hostNid))) continue;
        var payload = serializeOpenShadowRoot(el, hostNid);
        if (payload) payloads.push(payload);
        if (allowed && payload && Array.isArray(payload.nodeIds)) {
          for (var n = 0; n < payload.nodeIds.length; n++) {
            allowed.add(String(payload.nodeIds[n]));
          }
        }
        visit(el.shadowRoot);
      }
    }

    visit(root);
    return payloads;
  }

  function observeOpenShadowRoot(root) {
    if (!mutationObserver || !isOpenShadowRoot(root)) return;
    if (observedShadowRoots.has(root)) return;
    try {
      mutationObserver.observe(root, mutationObserverOptions());
      observedShadowRoots.add(root);
      addValueListenerRoot(root);
    } catch (err) {
      logger.error('[DOM Stream] shadow root observe failed', err);
      return;
    }
    observeOpenShadowRoots(root);
  }

  function observeOpenShadowRoots(root) {
    var elements = elementsUnderRoot(root);
    for (var i = 0; i < elements.length; i++) {
      if (elements[i].shadowRoot && isOpenShadowRoot(elements[i].shadowRoot)) {
        observeOpenShadowRoot(elements[i].shadowRoot);
      }
    }
  }

  function safeFrameSrc(src, baseDoc) {
    if (!src) return '';
    try {
      var baseHref = baseDoc && baseDoc.location ? baseDoc.location.href : location.href;
      return new URL(src, baseHref).href;
    } catch (err) {
      return '';
    }
  }

  function safeFrameOrigin(src, baseDoc) {
    if (!src) return '';
    try {
      var baseHref = baseDoc && baseDoc.location ? baseDoc.location.href : location.href;
      return new URL(src, baseHref).origin;
    } catch (err) {
      return '';
    }
  }

  function classifyFrame(iframe) {
    var doc = null;
    try {
      doc = iframe && iframe.contentDocument;
    } catch (err) {
      logger.warn('[DOM Stream] iframe contentDocument unavailable', {
        reason: 'cross-origin-or-inaccessible'
      });
    }
    if (doc && doc.documentElement && doc.body) {
      return { kind: 'same-origin', document: doc };
    }
    var src = iframe && iframe.getAttribute ? iframe.getAttribute('src') || '' : '';
    var baseDoc = iframe && iframe.ownerDocument ? iframe.ownerDocument : document;
    return {
      kind: 'cross-origin',
      label: 'Cross-origin iframe',
      src: safeFrameSrc(src, baseDoc),
      origin: safeFrameOrigin(src, baseDoc)
    };
  }

  function appendStyleDeclaration(clone, declaration) {
    if (!clone || !declaration) return;
    var existing = clone.getAttribute('style') || '';
    var suffix = declaration.charAt(declaration.length - 1) === ';'
      ? declaration
      : declaration + ';';
    clone.setAttribute('style', existing ? existing + ';' + suffix : suffix);
  }

  function prepareIframeWireShell(live, clone) {
    if (!clone || clone.nodeType !== Node.ELEMENT_NODE) return;
    clone.removeAttribute('src');
    clone.removeAttribute('srcdoc');
    captureComputedStyles(live, clone);
    appendStyleDeclaration(clone, 'pointer-events:none');
    sanitizeForWire('element', { orig: live, clone: clone });
  }

  function prepareIframeWireShellsForClone(liveRoot, wireRoot) {
    var liveElements = elementsUnderRoot(liveRoot);
    var cloneElements = elementsUnderRoot(wireRoot);
    for (var i = 0; i < liveElements.length && i < cloneElements.length; i++) {
      var live = liveElements[i];
      var clone = cloneElements[i];
      var tag = clone && clone.tagName ? String(clone.tagName).toLowerCase() : '';
      if (tag === 'iframe') prepareIframeWireShell(live, clone);
    }
  }

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

  function prepareFrameDocumentClone(frameDoc, bodyClone, cloneToNid) {
    var liveDescendants = frameDoc.body && frameDoc.body.querySelectorAll
      ? frameDoc.body.querySelectorAll('*')
      : [];
    var cloneDescendants = bodyClone.querySelectorAll('*');
    var toRemove = [];
    var blockedPairs = [];

    for (var i = 0; i < liveDescendants.length; i++) {
      var live = liveDescendants[i];
      var clone = cloneDescendants[i];
      if (!clone) continue;
      var tag = clone.tagName ? String(clone.tagName).toLowerCase() : '';

      if (wireDroppedWithAncestors(live.parentElement)) {
        reserveNodeId();
        toRemove.push(clone);
        continue;
      }

      var elemDecision = sanitizeForWire('element', { orig: live, clone: clone });
      if (elemDecision && elemDecision.drop) {
        toRemove.push(clone);
        continue;
      }
      if (safeSkipElement(clone) || skipElementWithAncestors(clone)) {
        toRemove.push(clone);
        continue;
      }
      if (blockedWithAncestors(live.parentElement)) continue;
      if (blockMatches(live)) {
        assignNodeId(live, clone, cloneToNid);
        blockedPairs.push({ orig: live, clone: clone });
        continue;
      }

      assignNodeId(live, clone, cloneToNid);

      if (tag === 'iframe') {
        prepareIframeWireShell(live, clone);
        continue;
      }

      for (var a = 0; a < URL_ATTRS.length; a++) {
        var attrVal = clone.getAttribute(URL_ATTRS[a]);
        if (attrVal) clone.setAttribute(URL_ATTRS[a], absolutifyUrl(attrVal, frameDoc));
      }
      var srcsetVal = clone.getAttribute('srcset');
      if (srcsetVal) clone.setAttribute('srcset', absolutifySrcset(srcsetVal, frameDoc));
      captureComputedStyles(live, clone);
      sanitizeForWire('element', { orig: live, clone: clone });
    }

    for (var r = 0; r < toRemove.length; r++) {
      if (toRemove[r].parentNode) toRemove[r].parentNode.removeChild(toRemove[r]);
    }
    for (var b = 0; b < blockedPairs.length; b++) {
      replaceWithBlockPlaceholder(
        blockedPairs[b].orig,
        blockedPairs[b].clone,
        readBlockRect(blockedPairs[b].orig),
        cloneToNid
      );
    }
  }

  function serializeFrameDocument(iframe, frameNid, frameDoc) {
    if (!iframe || !frameNid || !frameDoc || !frameDoc.documentElement || !frameDoc.body) {
      return null;
    }
    var bodyClone = frameDoc.body.cloneNode(true);
    var cloneToNid = new Map();
    var htmlNid = ensureNodeId(frameDoc.documentElement);
    var bodyNid = ensureNodeId(frameDoc.body);

    prepareFrameDocumentClone(frameDoc, bodyClone, cloneToNid);
    var subtreeResult = sanitizeForWire('subtree', {
      root: bodyClone,
      liveRoot: frameDoc.body,
      cloneToNid: cloneToNid
    });
    if (subtreeResult && subtreeResult.drop) return null;

    var nodeIds = buildNodeIdSidecar(bodyClone, cloneToNid, false);
    var frameShadowRoots = collectShadowRootPayloads(frameDoc.body, nodeIds);
    var nestedFrames = collectFramePayloads(frameDoc.body, cloneToNid);
    return {
      frameNid: String(frameNid),
      kind: 'same-origin',
      html: bodyClone.innerHTML || '',
      nodeIds: nodeIds,
      shadowRoots: frameShadowRoots,
      htmlNid: htmlNid ? String(htmlNid) : '',
      bodyNid: bodyNid ? String(bodyNid) : '',
      frames: nestedFrames,
      stylesheets: collectStylesheetsFrom(frameDoc),
      inlineStyles: collectInlineStylesFrom(frameDoc),
      htmlAttrs: serializeShellAttributes(frameDoc.documentElement),
      bodyAttrs: serializeShellAttributes(frameDoc.body),
      htmlStyle: collectComputedStyleText(frameDoc.documentElement, SHELL_PROPS),
      bodyStyle: collectComputedStyleText(frameDoc.body, SHELL_PROPS),
      scrollX: frameDoc.defaultView ? frameDoc.defaultView.scrollX : 0,
      scrollY: frameDoc.defaultView ? frameDoc.defaultView.scrollY : 0,
      viewportWidth: frameDoc.defaultView ? frameDoc.defaultView.innerWidth : 0,
      viewportHeight: frameDoc.defaultView ? frameDoc.defaultView.innerHeight : 0,
      pageWidth: frameDoc.documentElement.scrollWidth,
      pageHeight: frameDoc.documentElement.scrollHeight,
      url: frameDoc.location ? String(frameDoc.location.href || '') : '',
      title: frameDoc.title || ''
    };
  }

  function collectFramePayloads(root, cloneToNid, excludedFrameNodeIds) {
    var payloads = [];
    if (!root) return payloads;
    var allowed = null;
    if (cloneToNid && typeof cloneToNid.forEach === 'function') {
      allowed = new Set();
      cloneToNid.forEach(function(nid) {
        if (nid !== undefined && nid !== null) allowed.add(String(nid));
      });
    }

    var elements = elementsUnderRoot(root);
    for (var i = 0; i < elements.length; i++) {
      var iframe = elements[i];
      var tag = iframe && iframe.tagName ? String(iframe.tagName).toLowerCase() : '';
      if (tag !== 'iframe') continue;
      if (skipElementWithAncestors(iframe) || blockedWithAncestors(iframe) || wireDroppedWithAncestors(iframe)) {
        continue;
      }
      var frameNid = getTrackedNodeId(iframe) || ensureNodeId(iframe);
      if (!frameNid) continue;
      if (allowed && !allowed.has(String(frameNid))) continue;
      if (excludedFrameNodeIds && excludedFrameNodeIds.has(String(frameNid))) continue;
      var classification = classifyFrame(iframe);
      if (classification.kind === 'same-origin') {
        var sameOriginPayload = serializeFrameDocument(
          iframe,
          frameNid,
          classification.document
        );
        if (sameOriginPayload) payloads.push(sameOriginPayload);
        continue;
      }
      payloads.push(Object.assign({ frameNid: String(frameNid) }, classification));
    }
    return payloads;
  }

  function registerFrameLoadListener(iframe, frameNid) {
    if (!iframe || !frameNid || typeof iframe.addEventListener !== 'function') return;
    var key = String(frameNid);
    var existing = frameLoadListeners.get(key);
    if (existing && existing.iframe === iframe) return;
    if (existing && existing.iframe && typeof existing.iframe.removeEventListener === 'function') {
      existing.iframe.removeEventListener('load', existing.handler);
    }
    var handler = function() {
      var classification = classifyFrame(iframe);
      if (classification.kind === 'same-origin') {
        registerFrameDocument(iframe, key, classification.document, true);
      } else {
        observedFrameDocuments.delete(key);
      }
    };
    iframe.addEventListener('load', handler);
    frameLoadListeners.set(key, { iframe: iframe, handler: handler });
  }

  function registerFrameDocument(iframe, frameNid, frameDoc, emitRefresh) {
    if (!mutationObserver || !iframe || !frameNid || !frameDoc || !frameDoc.body) return null;
    var key = String(frameNid);
    var record = {
      iframe: iframe,
      document: frameDoc,
      root: frameDoc,
      frameNid: key
    };
    observedFrameDocuments.set(key, record);
    frameDocumentToNid.set(frameDoc, key);
    addValueListenerRoot(frameDoc);
    registerFrameLoadListener(iframe, key);
    var framePayload = serializeFrameDocument(iframe, key, frameDoc);
    try {
      mutationObserver.observe(frameDoc, mutationObserverOptions());
    } catch (err) {
      logger.warn('[DOM Stream] frame document observe failed', {
        reason: 'observe-failed'
      });
      return record;
    }
    observeOpenShadowRoots(frameDoc.body);
    observeSameOriginFrameDocuments(frameDoc.body);
    if (emitRefresh && framePayload) {
      sendMutationDiffs([{
        op: DIFF_OP.FRAME,
        frameNid: key,
        frame: framePayload
      }], { includeStaleFlushCount: false });
    }
    return record;
  }

  function observeSameOriginFrameDocuments(root) {
    var elements = elementsUnderRoot(root);
    for (var i = 0; i < elements.length; i++) {
      var iframe = elements[i];
      var tag = iframe && iframe.tagName ? String(iframe.tagName).toLowerCase() : '';
      if (tag !== 'iframe') continue;
      if (skipElementWithAncestors(iframe) || blockedWithAncestors(iframe) || wireDroppedWithAncestors(iframe)) {
        continue;
      }
      var frameNid = getTrackedNodeId(iframe) || ensureNodeId(iframe);
      if (!frameNid) continue;
      var classification = classifyFrame(iframe);
      if (classification.kind === 'same-origin') {
        registerFrameDocument(iframe, frameNid, classification.document, false);
      } else {
        registerFrameLoadListener(iframe, frameNid);
      }
    }
  }

  function getMutationFrameRecord(target) {
    if (!target) return null;
    var ownerDoc = target.nodeType === Node.DOCUMENT_NODE ? target : target.ownerDocument;
    if (!ownerDoc) return null;
    var frameNid = frameDocumentToNid.get(ownerDoc);
    if (!frameNid) return null;
    var record = observedFrameDocuments.get(String(frameNid));
    if (!record || record.document !== ownerDoc) return null;
    return record;
  }

  function isInactiveFrameDocumentMutation(target) {
    if (!target) return false;
    var ownerDoc = target.nodeType === Node.DOCUMENT_NODE ? target : target.ownerDocument;
    if (!ownerDoc) return false;
    var frameNid = frameDocumentToNid.get(ownerDoc);
    if (!frameNid) return false;
    var record = observedFrameDocuments.get(String(frameNid));
    return !record || record.document !== ownerDoc;
  }

  function scopeFrameDiff(diff, frameRecord) {
    if (diff && frameRecord && frameRecord.frameNid) {
      diff.frameNid = String(frameRecord.frameNid);
    }
    return diff;
  }

  function isValueControl(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
    var tag = el.tagName ? String(el.tagName).toLowerCase() : '';
    return tag === 'input' || tag === 'textarea' || tag === 'select';
  }

  function selectedOptionValues(select) {
    var values = [];
    var options = select && select.options ? select.options : [];
    for (var i = 0; i < options.length; i++) {
      if (options[i].selected) values.push(String(options[i].value));
    }
    return values;
  }

  function sanitizeInputValue(value, owner) {
    return sanitizeForWire('input', {
      value: value == null ? '' : String(value),
      owner: owner
    }).value;
  }

  function buildValueDiff(control) {
    if (!isValueControl(control)) return null;
    if (skipElementWithAncestors(control) || blockedWithAncestors(control) || wireDroppedWithAncestors(control)) {
      return null;
    }
    var shadowHost = getMutationShadowHost(control);
    if (shadowHost && (
      skipElementWithAncestors(shadowHost)
      || blockedWithAncestors(shadowHost)
      || wireDroppedWithAncestors(shadowHost)
    )) {
      return null;
    }
    var nid = getTrackedNodeId(control);
    if (!nid) return null;

    var tag = control.tagName ? String(control.tagName).toLowerCase() : '';
    var diff = {
      op: DIFF_OP.VALUE,
      nid: nid
    };

    if (tag === 'select') {
      diff.value = sanitizeInputValue(control.value, control);
      var selected = selectedOptionValues(control);
      diff.selectedValues = [];
      for (var s = 0; s < selected.length; s++) {
        diff.selectedValues.push(sanitizeInputValue(selected[s], control));
      }
      return diff;
    }

    if (tag === 'textarea') {
      diff.value = sanitizeInputValue(control.value, control);
      return diff;
    }

    var inputType = '';
    try {
      inputType = String(control.type || control.getAttribute('type') || '').toLowerCase();
    } catch (err) {
      inputType = String(control.getAttribute && control.getAttribute('type') || '').toLowerCase();
    }

    if (inputType === 'checkbox' || inputType === 'radio') {
      diff.checked = !!control.checked;
      diff.value = sanitizeInputValue(control.value, control);
      return diff;
    }

    diff.value = sanitizeInputValue(control.value, control);
    return diff;
  }

  function handleValueEvent(event) {
    if (!streaming || !event || !event.target) return;
    var diff = buildValueDiff(event.target);
    if (!diff) return;
    sendMutationDiffs(
      [scopeFrameDiff(diff, getMutationFrameRecord(event.target))],
      { includeStaleFlushCount: false }
    );
  }

  function addValueListenerRoot(root) {
    if (!valueCaptureActive || !root || typeof root.addEventListener !== 'function') return;
    if (valueListenerRoots.has(root)) return;
    root.addEventListener('input', handleValueEvent, true);
    root.addEventListener('change', handleValueEvent, true);
    valueListenerRoots.add(root);
    valueListenerRecords.push(root);
  }

  function addValueListenerRootsUnder(root) {
    if (root && (root.nodeType === Node.DOCUMENT_NODE || isOpenShadowRoot(root))) {
      addValueListenerRoot(root);
    }
    var elements = elementsUnderRoot(root);
    for (var i = 0; i < elements.length; i++) {
      if (elements[i].shadowRoot && isOpenShadowRoot(elements[i].shadowRoot)) {
        addValueListenerRootsUnder(elements[i].shadowRoot);
      }
    }
  }

  function startValueCapture() {
    stopValueCapture();
    valueCaptureActive = true;
    addValueListenerRoot(document);
    addValueListenerRootsUnder(document.body);
    observedFrameDocuments.forEach(function(record) {
      if (!record || !record.document) return;
      addValueListenerRoot(record.document);
      addValueListenerRootsUnder(record.document.body);
    });
  }

  function stopValueCapture() {
    for (var i = 0; i < valueListenerRecords.length; i++) {
      var root = valueListenerRecords[i];
      try {
        if (root && typeof root.removeEventListener === 'function') {
          root.removeEventListener('input', handleValueEvent, true);
          root.removeEventListener('change', handleValueEvent, true);
        }
      } catch (err) {
        logger.warn('[DOM Stream] value listener cleanup failed', {
          reason: 'cleanup-failed'
        });
      }
    }
    valueListenerRecords = [];
    valueListenerRoots = new WeakSet();
    valueCaptureActive = false;
  }

  function clearObservedFrameDocuments() {
    frameLoadListeners.forEach(function(record) {
      try {
        if (record && record.iframe && typeof record.iframe.removeEventListener === 'function') {
          record.iframe.removeEventListener('load', record.handler);
        }
      } catch (err) {
        logger.warn('[DOM Stream] frame load listener cleanup failed', {
          reason: 'cleanup-failed'
        });
      }
    });
    frameLoadListeners.clear();
    observedFrameDocuments.clear();
    frameDocumentToNid = new WeakMap();
  }

  function wrapAttachShadow() {
    if (nativeAttachShadow) return;
    var proto = window && window.Element && window.Element.prototype;
    if (!proto || typeof proto.attachShadow !== 'function') return;
    attachShadowProto = proto;
    nativeAttachShadow = proto.attachShadow;
    proto.attachShadow = function() {
      var root = nativeAttachShadow.apply(this, arguments);
      try {
        if (isOpenShadowRoot(root)) {
          observeOpenShadowRoot(root);
          if (streaming) {
            var hostNid = ensureNodeId(this);
            var payload = serializeOpenShadowRoot(this, hostNid);
            if (payload) {
              safeSend(STREAM.MUTATIONS, {
                mutations: [Object.assign({ op: DIFF_OP.SHADOW_ROOT }, payload)],
                streamSessionId: streamSessionId || '',
                snapshotId: currentSnapshotId || 0,
                staleFlushCount: staleFlushCount
              });
            }
          }
        }
      } catch (err) {
        logger.error('[DOM Stream] attachShadow wrapper failed', err);
      }
      return root;
    };
  }

  function restoreAttachShadow() {
    if (!nativeAttachShadow || !attachShadowProto) return;
    try {
      attachShadowProto.attachShadow = nativeAttachShadow;
    } catch (err) {
      logger.error('[DOM Stream] attachShadow restore failed', err);
    }
    nativeAttachShadow = null;
    attachShadowProto = null;
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
    if (window.__phantomStreamDisableDialogInterceptor) return;
    if (document.getElementById('fsb-dialog-interceptor')) return;

    var script = document.createElement('script');
    script.id = 'fsb-dialog-interceptor';
    script.textContent = '(' + function() {
      var origAlert = window.alert;
      var origConfirm = window.confirm;
      var origPrompt = window.prompt;

      window.alert = function(message) {
        document["dispatch" + "Event"](new CustomEvent('fsb-dialog', {
          detail: { type: 'alert', message: String(message || '') }
        }));
        var result = origAlert.call(window, message);
        document["dispatch" + "Event"](new CustomEvent('fsb-dialog-dismiss', {
          detail: { type: 'alert' }
        }));
        return result;
      };

      window.confirm = function(message) {
        document["dispatch" + "Event"](new CustomEvent('fsb-dialog', {
          detail: { type: 'confirm', message: String(message || '') }
        }));
        var result = origConfirm.call(window, message);
        document["dispatch" + "Event"](new CustomEvent('fsb-dialog-dismiss', {
          detail: { type: 'confirm', result: result }
        }));
        return result;
      };

      window.prompt = function(message, defaultValue) {
        document["dispatch" + "Event"](new CustomEvent('fsb-dialog', {
          detail: { type: 'prompt', message: String(message || ''), defaultValue: defaultValue || '' }
        }));
        var result = origPrompt.call(window, message, defaultValue);
        document["dispatch" + "Event"](new CustomEvent('fsb-dialog-dismiss', {
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
   *
   * SEC-03 side-channel masking disposition (threat T-03-26, accepted --
   * the CONTEXT masking decision's "and side channels" clause, discharged
   * explicitly here, never silently): dialog detail.message and
   * detail.defaultValue (and the overlay payload text relayed by
   * broadcastOverlayState) are NOT routed through the masking helpers.
   * They are string-only payloads with no owner element, so blockSelector /
   * maskTextSelector matching has nothing to match against; a page script
   * that echoes masked content into an alert/prompt is outside capture-side
   * masking's reach (the rrweb-parity boundary). The viewer renders these
   * via textContent only (overlays.js, threat T-02-04), so the residual is
   * privacy-scoped, not markup injection. docs/SECURITY.md lists this
   * residual (plan 03-05).
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
  // 0.4 SEC-03 Privacy-masking helpers (plan 03-03)
  // =========================================================================

  /**
   * Validate a host-provided mask selector at factory time. Returns the
   * selector string, or null when the option was not provided. Any provided
   * value that is not a non-empty string, or that the ambient document's
   * selector engine rejects, THROWS Error('invalid-mask-selector'):
   * factory-time validation is the one allowed throwing site (D-07
   * transport-send-required precedent, 03-PATTERNS Shared Patterns), and a
   * silently dropped mask selector would be a privacy leak -- fail closed
   * and loud. Runtime matcher errors on exotic elements are contained
   * per-element by the predicates below instead (Pitfall 6).
   * @param {*} raw - cfg.blockSelector / cfg.maskTextSelector as provided
   * @returns {string|null}
   */
  function compileMaskSelector(raw) {
    if (raw === undefined || raw === null) return null;
    if (typeof raw !== 'string' || raw === '') {
      throw new Error('invalid-mask-selector');
    }
    try {
      document.querySelector(raw);
    } catch (err) {
      throw new Error('invalid-mask-selector');
    }
    return raw;
  }

  /**
   * Ancestor-inclusive maskTextSelector predicate (closest()-shaped, the
   * skipElementWithAncestors analog -- 03-RESEARCH Pattern 6). True when el
   * or any ancestor (within el's tree: full live ancestry for live
   * elements, clone-local ancestry for detached clones) matches
   * maskTextSelector. A runtime matches/closest error on an exotic element
   * is contained in the safeSkipElement shape: routed to the logger,
   * treated as not-matched -- the capture never wedges (Pitfall 6).
   * @param {Element} el
   * @returns {boolean}
   */
  function maskTextMatches(el) {
    if (!maskTextSelector) return false;
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
    try {
      return !!(el.closest && el.closest(maskTextSelector));
    } catch (err) {
      logger.error('[DOM Stream] maskTextSelector match failed', err);
      return false;
    }
  }

  /**
   * True when the element itself matches blockSelector. Runtime selector
   * errors are contained like maskTextSelector errors: logged and treated as
   * not-blocked so capture never wedges after factory-time validation.
   * @param {Element} el
   * @returns {boolean}
   */
  function blockMatches(el) {
    if (!blockSelector) return false;
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
    try {
      return !!(el.matches && el.matches(blockSelector));
    } catch (err) {
      logger.error('[DOM Stream] blockSelector match failed', err);
      return false;
    }
  }

  /**
   * Ancestor-inclusive blockSelector predicate. Used by the differ skip
   * guards so mutations ON or INSIDE a blocked subtree emit nothing.
   * @param {Element} el
   * @returns {boolean}
   */
  function blockedWithAncestors(el) {
    if (!blockSelector) return false;
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
    try {
      return !!(el.closest && el.closest(blockSelector));
    } catch (err) {
      logger.error('[DOM Stream] blockSelector match failed', err);
      return false;
    }
  }

  /**
   * Elements intentionally absent from the wire must also be absent from the
   * live tracking graph. Otherwise descendants can receive nids before the
   * clone subtree is removed, then later leak mutations for content the
   * snapshot never mirrored.
   * @param {Element} el
   * @returns {boolean}
   */
  function isWireDroppedElement(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
    var tag = el.tagName ? String(el.tagName).toLowerCase() : '';
    return tag === 'script' || tag === 'noscript' || tag === 'object' || tag === 'embed';
  }

  /**
   * Ancestor-inclusive dropped-subtree predicate, matching the blockSelector
   * mutation guards for built-in forbidden wire roots.
   * @param {Element} el
   * @returns {boolean}
   */
  function wireDroppedWithAncestors(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
    var node = el;
    while (node && node.nodeType === Node.ELEMENT_NODE) {
      if (isWireDroppedElement(node)) return true;
      node = node.parentElement;
    }
    return false;
  }

  /**
   * Apply the text mask: maskTextFn when provided, with fail-CLOSED
   * containment -- a throwing custom fn falls back to the DEFAULT asterisk
   * mask (raw text NEVER leaks, threat T-03-16) and routes to the logger.
   * @param {string} text
   * @param {Element} el - element owning the text (rrweb fn signature)
   * @returns {string}
   */
  function safeMaskText(text, el) {
    if (maskTextFn) {
      try {
        return String(maskTextFn(String(text), el));
      } catch (err) {
        logger.error('[DOM Stream] maskTextFn failed; default mask applied', err);
        return defaultMaskText(text);
      }
    }
    return defaultMaskText(text);
  }

  /**
   * Apply the input-value mask: maskInputFn when provided, with the same
   * fail-CLOSED containment as safeMaskText.
   * @param {string} text
   * @param {Element} el
   * @returns {string}
   */
  function safeMaskInput(text, el) {
    if (maskInputFn) {
      try {
        return String(maskInputFn(String(text), el));
      } catch (err) {
        logger.error('[DOM Stream] maskInputFn failed; default mask applied', err);
        return defaultMaskText(text);
      }
    }
    return defaultMaskText(text);
  }

  /**
   * True when an element's value/text value must be masked. Password inputs
   * are always masked; maskInputs extends masking to input/textarea/select.
   * Select option display text is intentionally not masked here (T-03-18,
   * accepted residual); a future Phase 8 input-event capture path must route
   * typed values through safeMaskInput as well.
   * @param {Element} el
   * @returns {boolean}
   */
  function shouldMaskInput(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
    var tag = el.tagName ? String(el.tagName).toLowerCase() : '';
    if (tag === 'input') {
      var inputType = '';
      try {
        inputType = String(el.type || el.getAttribute('type') || '').toLowerCase();
      } catch (e) {
        inputType = String(el.getAttribute && el.getAttribute('type') || '').toLowerCase();
      }
      if (inputType === 'password') return true;
      return maskInputs;
    }
    if (tag === 'textarea' || tag === 'select') return maskInputs;
    return false;
  }

  /**
   * Option value attributes are the value surface of a masked select. Option
   * display labels remain the documented residual; value attrs do not.
   * @param {Element} el
   * @returns {boolean}
   */
  function isOptionUnderMaskedSelect(el) {
    if (!maskInputs || !el || el.nodeType !== Node.ELEMENT_NODE) return false;
    var tag = el.tagName ? String(el.tagName).toLowerCase() : '';
    if (tag !== 'option') return false;
    try {
      return !!(el.closest && el.closest('select'));
    } catch (e) {
      return false;
    }
  }

  function maskOptionValue(optionClone, owner) {
    if (!optionClone || !optionClone.hasAttribute || !optionClone.hasAttribute('value')) return;
    if (optionClone._psOptionValueMasked) return;
    optionClone._psOptionValueMasked = true;
    var value = optionClone.getAttribute('value');
    var maskedValue = safeMaskInput(value == null ? '' : value, owner);
    if (maskedValue !== value) {
      optionClone.setAttribute('value', maskedValue);
      sanitizeCounters.maskedInputs++;
    }
  }

  /**
   * Mask a clone's input/textarea/select wire value in place.
   * @param {Element} clone
   * @param {Element} owner
   */
  function maskInputCloneValue(clone, owner) {
    if (isOptionUnderMaskedSelect(owner)) {
      maskOptionValue(clone, owner);
      return;
    }
    if (!shouldMaskInput(owner)) return;
    var tag = clone.tagName ? String(clone.tagName).toLowerCase() : '';
    if (tag === 'textarea') {
      maskDirectChildText(clone, owner, safeMaskInput, 'maskedInputs');
      return;
    }
    if (tag === 'select') {
      var cloneOptions = clone.querySelectorAll ? clone.querySelectorAll('option') : [];
      var ownerOptions = owner && owner.querySelectorAll ? owner.querySelectorAll('option') : [];
      for (var o = 0; o < cloneOptions.length; o++) {
        maskOptionValue(cloneOptions[o], ownerOptions[o] || owner);
      }
      return;
    }
    if (clone.hasAttribute && clone.hasAttribute('value')) {
      var value = clone.getAttribute('value');
      var maskedValue = safeMaskInput(value == null ? '' : value, owner);
      if (maskedValue !== value) {
        clone.setAttribute('value', maskedValue);
        sanitizeCounters.maskedInputs++;
      }
    }
  }

  /**
   * Mask every DIRECT child text node of a detached clone element in place.
   * Descendant elements are deliberately NOT recursed into: each
   * serialization walk visits every element, so descendant text is covered
   * by the descendant's own visit. Counters move only when a value actually
   * changes (SEC-01 idempotence discipline).
   * @param {Element} el - detached clone whose direct text children to mask
   * @param {Element} owner - element handed to the custom mask fn
   * @param {(text: string, el: Element) => string} maskFn - safeMaskText
   *   (or safeMaskInput for textarea values)
   * @param {string} counterKey - sanitizeCounters key to increment
   */
  function maskDirectChildText(el, owner, maskFn, counterKey) {
    var child = el.firstChild;
    while (child) {
      if (child.nodeType === Node.TEXT_NODE && child.nodeValue) {
        var maskedValue = maskFn(child.nodeValue, owner);
        if (maskedValue !== child.nodeValue) {
          child.nodeValue = maskedValue;
          sanitizeCounters[counterKey]++;
        }
      }
      child = child.nextSibling;
    }
  }

  /**
   * Read the live dimensions used by rrweb-compatible block placeholders.
   * @param {Element} el
   * @returns {{width: number, height: number}}
   */
  function readBlockRect(el) {
    try {
      var rect = el.getBoundingClientRect();
      return {
        width: rect && typeof rect.width === 'number' ? rect.width : 0,
        height: rect && typeof rect.height === 'number' ? rect.height : 0
      };
    } catch (e) {
      return { width: 0, height: 0 };
    }
  }

  /**
   * Build the placeholder for a blocked element. It carries only dimensions:
   * no original attributes, no children, no text. Its identity travels in
   * the nodeIds sidecar.
   * @param {Document} doc
   * @param {{width: number, height: number}} rect
   * @returns {Element}
   */
  function createBlockPlaceholder(doc, rect) {
    var placeholder = doc.createElement('div');
    placeholder.setAttribute('rr_width', String(rect.width || 0) + 'px');
    placeholder.setAttribute('rr_height', String(rect.height || 0) + 'px');
    return placeholder;
  }

  /**
   * Replace a detached clone element with its blocked placeholder.
   * @param {Element} liveEl
   * @param {Element} cloneEl
   * @param {{width: number, height: number}} rect
   * @param {Map<Element, string>} [cloneToNid]
   * @returns {Element|null}
   */
  function replaceWithBlockPlaceholder(liveEl, cloneEl, rect, cloneToNid) {
    if (!cloneEl || !cloneEl.parentNode) return null;
    var nid = cloneToNid && cloneToNid.get(cloneEl);
    if (!nid) nid = getTrackedNodeId(liveEl) || '';
    var placeholder = createBlockPlaceholder(cloneEl.ownerDocument, rect);
    cloneEl.parentNode.replaceChild(placeholder, cloneEl);
    if (cloneToNid) {
      cloneToNid.delete(cloneEl);
      if (nid) cloneToNid.set(placeholder, nid);
    }
    sanitizeCounters.blockedSubtrees++;
    return placeholder;
  }

  function createTruncatedPlaceholder(doc) {
    var placeholder = doc.createElement('div');
    placeholder.setAttribute('data-phantomstream-truncated', 'true');
    return placeholder;
  }

  function deleteCloneSubtreeMappings(cloneEl, cloneToNid) {
    if (!cloneEl || !cloneToNid) return;
    cloneToNid.delete(cloneEl);
    if (!cloneEl.querySelectorAll) return;
    var descendants = cloneEl.querySelectorAll('*');
    for (var i = 0; i < descendants.length; i++) {
      cloneToNid.delete(descendants[i]);
    }
  }

  function replaceWithTruncatedPlaceholder(cloneEl, cloneToNid) {
    if (!cloneEl || !cloneEl.parentNode) return null;
    var nid = cloneToNid && cloneToNid.get(cloneEl);
    if (!nid) return null;
    var placeholder = createTruncatedPlaceholder(cloneEl.ownerDocument);
    cloneEl.parentNode.replaceChild(placeholder, cloneEl);
    deleteCloneSubtreeMappings(cloneEl, cloneToNid);
    cloneToNid.set(placeholder, nid);
    return placeholder;
  }

  function utf8ByteLength(text) {
    var str = String(text || '');
    var bytes = 0;
    for (var i = 0; i < str.length; i++) {
      var code = str.charCodeAt(i);
      if (code < 0x80) {
        bytes += 1;
      } else if (code < 0x800) {
        bytes += 2;
      } else if (code >= 0xD800 && code <= 0xDBFF && i + 1 < str.length) {
        var next = str.charCodeAt(i + 1);
        if (next >= 0xDC00 && next <= 0xDFFF) {
          bytes += 4;
          i++;
        } else {
          bytes += 3;
        }
      } else {
        bytes += 3;
      }
    }
    return bytes;
  }

  function wireByteLength(value) {
    try {
      var json = JSON.stringify(value);
      if (json === undefined) return 0;
      if (typeof TextEncoder !== 'undefined') {
        return new TextEncoder().encode(json).byteLength;
      }
      if (typeof Buffer !== 'undefined') {
        return Buffer.byteLength(json, 'utf8');
      }
      return utf8ByteLength(json);
    } catch (err) {
      return Infinity;
    }
  }

  function sidecarWireLength(value) {
    return wireByteLength(value);
  }

  function findCloneElementByNid(root, cloneToNid, nid) {
    if (!root || !cloneToNid || nid === undefined || nid === null) return null;
    var key = String(nid);
    var elements = elementsUnderRoot(root);
    for (var i = 0; i < elements.length; i++) {
      if (String(cloneToNid.get(elements[i]) || '') === key) return elements[i];
    }
    return null;
  }

  function markCloneNidTruncated(root, cloneToNid, nid, truncatedNodeIds) {
    var cloneEl = findCloneElementByNid(root, cloneToNid, nid);
    if (!cloneEl) return false;
    var placeholder = replaceWithTruncatedPlaceholder(cloneEl, cloneToNid);
    if (!placeholder) return false;
    var placeholderNid = cloneToNid.get(placeholder) || nid;
    if (placeholderNid && truncatedNodeIds && typeof truncatedNodeIds.add === 'function') {
      truncatedNodeIds.add(String(placeholderNid));
    }
    return true;
  }

  function truncatedPayloadForNid(doc, nid) {
    var placeholder = createTruncatedPlaceholder(doc || document);
    return {
      html: placeholder.outerHTML || '',
      nodeIds: nid ? [String(nid)] : [],
      shadowRoots: [],
      frames: [],
      truncated: true,
      missingDescendants: 1
    };
  }

  function pruneSnapshotSidecarsForBudget(basePayload, shadowRoots, frames, clone, cloneToNid, truncatedNodeIds) {
    var base = Object.assign({}, basePayload || {});
    var keptShadowRoots = Array.isArray(shadowRoots) ? shadowRoots.slice() : [];
    var keptFrames = Array.isArray(frames) ? frames.slice() : [];
    var removed = 0;

    function currentWireLength() {
      return wireByteLength(Object.assign({}, base, {
        shadowRoots: keptShadowRoots,
        frames: keptFrames
      }));
    }

    while (currentWireLength() > SNAPSHOT_BUDGET_BYTES && (keptShadowRoots.length || keptFrames.length)) {
      var largestKind = '';
      var largestIndex = -1;
      var largestLength = -1;

      for (var s = 0; s < keptShadowRoots.length; s++) {
        var shadowLength = sidecarWireLength(keptShadowRoots[s]);
        if (shadowLength > largestLength) {
          largestLength = shadowLength;
          largestKind = 'shadow';
          largestIndex = s;
        }
      }
      for (var f = 0; f < keptFrames.length; f++) {
        var frameLength = sidecarWireLength(keptFrames[f]);
        if (frameLength > largestLength) {
          largestLength = frameLength;
          largestKind = 'frame';
          largestIndex = f;
        }
      }

      var ownerNid = '';
      if (largestKind === 'shadow') {
        var removedShadow = keptShadowRoots.splice(largestIndex, 1)[0];
        ownerNid = removedShadow && removedShadow.hostNid;
      } else if (largestKind === 'frame') {
        var removedFrame = keptFrames.splice(largestIndex, 1)[0];
        ownerNid = removedFrame && removedFrame.frameNid;
      } else {
        break;
      }
      markCloneNidTruncated(clone, cloneToNid, ownerNid, truncatedNodeIds);
      removed++;
      base.truncated = true;
      base.missingDescendants = (base.missingDescendants || 0) + 1;
      base.html = clone && clone.innerHTML ? clone.innerHTML : base.html;
      base.nodeIds = buildNodeIdSidecar(clone, cloneToNid, false);
    }

    return {
      html: base.html,
      nodeIds: base.nodeIds || [],
      shadowRoots: keptShadowRoots,
      frames: keptFrames,
      truncated: !!base.truncated,
      missingDescendants: base.missingDescendants || 0,
      removed: removed
    };
  }

  function markSnapshotPayloadTruncated(payload) {
    payload.truncated = true;
    return payload;
  }

  function fitSnapshotPayloadForBudget(payload, clone, cloneToNid, truncatedNodeIds) {
    var next = Object.assign({}, payload || {}, {
      nodeIds: Array.isArray(payload && payload.nodeIds) ? payload.nodeIds.slice() : [],
      shadowRoots: Array.isArray(payload && payload.shadowRoots) ? payload.shadowRoots.slice() : [],
      frames: Array.isArray(payload && payload.frames) ? payload.frames.slice() : [],
      stylesheets: Array.isArray(payload && payload.stylesheets) ? payload.stylesheets.slice() : [],
      inlineStyles: Array.isArray(payload && payload.inlineStyles) ? payload.inlineStyles.slice() : [],
      htmlAttrs: Object.assign({}, payload && payload.htmlAttrs ? payload.htmlAttrs : {}),
      bodyAttrs: Object.assign({}, payload && payload.bodyAttrs ? payload.bodyAttrs : {})
    });

    while (wireByteLength(next) > SNAPSHOT_BUDGET_BYTES && next.inlineStyles.length) {
      next.inlineStyles.pop();
      markSnapshotPayloadTruncated(next);
    }
    while (wireByteLength(next) > SNAPSHOT_BUDGET_BYTES && next.stylesheets.length) {
      next.stylesheets.pop();
      markSnapshotPayloadTruncated(next);
    }

    if (wireByteLength(next) > SNAPSHOT_BUDGET_BYTES && next.htmlStyle) {
      next.htmlStyle = '';
      markSnapshotPayloadTruncated(next);
    }
    if (wireByteLength(next) > SNAPSHOT_BUDGET_BYTES && next.bodyStyle) {
      next.bodyStyle = '';
      markSnapshotPayloadTruncated(next);
    }
    if (wireByteLength(next) > SNAPSHOT_BUDGET_BYTES && Object.keys(next.htmlAttrs).length) {
      next.htmlAttrs = {};
      markSnapshotPayloadTruncated(next);
    }
    if (wireByteLength(next) > SNAPSHOT_BUDGET_BYTES && Object.keys(next.bodyAttrs).length) {
      next.bodyAttrs = {};
      markSnapshotPayloadTruncated(next);
    }
    if (wireByteLength(next) > SNAPSHOT_BUDGET_BYTES && next.title) {
      next.title = '';
      markSnapshotPayloadTruncated(next);
    }
    if (wireByteLength(next) > SNAPSHOT_BUDGET_BYTES && next.url) {
      next.url = '';
      markSnapshotPayloadTruncated(next);
    }

    if (wireByteLength(next) > SNAPSHOT_BUDGET_BYTES && clone && cloneToNid) {
      var cloneEls = cloneElementsWithNodeIds(clone, cloneToNid);
      for (var i = cloneEls.length - 1; i >= 0 && wireByteLength(next) > SNAPSHOT_BUDGET_BYTES; i--) {
        var nid = cloneToNid.get(cloneEls[i]);
        if (markCloneNidTruncated(clone, cloneToNid, nid, truncatedNodeIds)) {
          next.html = clone.innerHTML || '';
          next.nodeIds = buildNodeIdSidecar(clone, cloneToNid, false);
          next.shadowRoots = collectShadowRootPayloads(document.body, next.nodeIds, truncatedNodeIds);
          next.frames = collectFramePayloads(document.body, cloneToNid, truncatedNodeIds);
          next.missingDescendants = (next.missingDescendants || 0) + 1;
          markSnapshotPayloadTruncated(next);
        }
      }
    }

    if (wireByteLength(next) > RELAY_PER_MESSAGE_LIMIT_BYTES) {
      next.html = '';
      next.nodeIds = [];
      next.shadowRoots = [];
      next.frames = [];
      next.inlineStyles = [];
      next.stylesheets = [];
      next.htmlAttrs = {};
      next.bodyAttrs = {};
      next.htmlStyle = '';
      next.bodyStyle = '';
      next.title = '';
      next.url = '';
      next.missingDescendants = (next.missingDescendants || 0) + 1;
      markSnapshotPayloadTruncated(next);
    }

    return next;
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

  // Serialization-path inventory (keep ACCURATE -- this list is the ground
  // truth the plan 03-05 chokepoint purity scan audits, Pitfall 1; mirrors
  // the WR-03 wire-value insertion-point inventory in
  // src/renderer/snapshot.js):
  //   1. serializeDOM clone walk          -- 'element' dispatch (drop
  //      decision at the old script/noscript site, before nid assignment,
  //      plus a post-absolutification re-scrub per pair and an
  //      iframe-branch scrub)
  //   2. processAddedNode add-op subtrees -- 'subtree' dispatch on the
  //      detached wire clone (the live node is NEVER scrubbed)
  //   3. attr-op branch                   -- 'attr' dispatch, after
  //      absolutifyUrl/absolutifySrcset so the scheme check runs on final
  //      wire values
  //   4. characterData text branch       -- 'text' dispatch (SEC-03
  //      masking seam, plan 03-03)
  //   5. E2 text-childlist branch        -- 'text' dispatch (same seam)
  //   6. input/change value branch       -- 'input' dispatch (CAPT-05
  //      masking seam for event-driven form state)
  // Head inline <style> text additionally routes through the 'css' dispatch
  // at the serializeDOM collection site (a value scrub, not a markup walk).
  // Side channels that BYPASS the markup scrub AND the masking helpers BY
  // DESIGN: the dialog relay (setupDialogRelay -- see the T-03-26
  // disposition comment there) and the overlay broadcast
  // (broadcastOverlayState) carry text/metadata only and are rendered via
  // textContent in the viewer (overlays.js, threat T-02-04) -- no HTML
  // parse path exists for them.

  /**
   * The capture-side sanitization chokepoint (SEC-01): the single named
   * function through which every serialization path emits. Blocklist
   * policy, fidelity-first (CONTEXT locked decision: allowlist rejected) --
   * benign content passes through byte-identical. Strips apply ONLY to
   * detached clones / wire values, never to the live observed page (threat
   * T-03-06). Dispatch shapes (kind, payload -> result):
   *
   *   'element', { orig, clone }         -> { drop?: true }
   *     Scrubs one detached clone element in place; { drop: true } for
   *     script/noscript (reference-parity strip, uncounted) and
   *     object/embed (SEC-01 blocklist, counted).
   *   'subtree', { root, liveRoot }      -> { drop?: true }
   *     Walks a detached wire clone (root + descendants), element-scrubbing
   *     each and removing forbidden descendants; { drop: true } when the
   *     root itself is forbidden.
   *   'attr',    { name, value, target } -> { drop?: true, value?: string }
   *     Attr-op gate: on* and srcdoc ops are DROPPED, dangerous URL schemes
   *     neutralize to '', style values are CSS-scrubbed; everything else
   *     passes through unchanged.
   *   'text',    { text, owner }         -> { text }
   *     SEC-03 masking seam (plan 03-03): maskTextSelector / maskTextFn
   *     applied against the LIVE owner element's ancestry (incrementing
   *     maskedTextNodes); Phase 8 CAPT-05 typed-text capture plugs into the
   *     same seam.
   *   'input',   { value, owner }        -> { value }
   *     CAPT-05 masking seam for event-driven form values. Password inputs
   *     and maskInputs/maskInputFn are applied before transport.
   *   'css',     { css }                 -> { css }
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
      // URL-carrying attributes: dangerous schemes are removed, not
      // rewritten to href="". Empty hrefs navigate to the iframe's own URL
      // on click, so removal is the inert mirror behavior required by the
      // Phase 3 browser checkpoint.
      for (var u = 0; u < URL_ATTRS.length; u++) {
        var urlVal = clone.getAttribute(URL_ATTRS[u]);
        if (urlVal && hasDangerousScheme(urlVal)) {
          clone.removeAttribute(URL_ATTRS[u]);
          sanitizeCounters.blockedUrlSchemes++;
        }
      }
      var formactionVal = clone.getAttribute('formaction');
      if (formactionVal && hasDangerousScheme(formactionVal)) {
        clone.removeAttribute('formaction');
        sanitizeCounters.blockedUrlSchemes++;
      }
      // SVG xlink:href (getAttributeNS per the serializeDOM precedent).
      try {
        var xlinkVal = clone.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
        if (xlinkVal && hasDangerousScheme(xlinkVal)) {
          clone.removeAttributeNS('http://www.w3.org/1999/xlink', 'href');
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
      // SEC-03 masking pass (plan 03-03), applied ONCE per clone: the pairs
      // walk routes each pair through this dispatch twice (drop decision +
      // final-wire-value re-scrub), and a second application would corrupt
      // custom mask fn output -- so the pass marks the clone with a JS-only
      // property that never serializes (clone-only; live nodes are never
      // touched, threat T-03-06).
      if (!clone._psMasked) {
        clone._psMasked = true;
        if (payload.orig) {
          maskInputCloneValue(clone, payload.orig);
        }
        // maskTextSelector: the LIVE element's ancestry decides (orig is
        // null for detached subtree descendants -- those are masked by the
        // 'subtree' dispatch, which knows the inherited root state).
        if (payload.orig && maskTextMatches(payload.orig)) {
          maskDirectChildText(clone, payload.orig, safeMaskText, 'maskedTextNodes');
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
      // SEC-03: every descendant uses its LIVE counterpart when available,
      // so maskTextSelector sees full live ancestry (detached clones cannot)
      // and maskInputs/password rules consult the real form control type.
      var liveDescendants = (payload.liveRoot && payload.liveRoot.querySelectorAll)
        ? payload.liveRoot.querySelectorAll('*')
        : [];
      var descendants = root.querySelectorAll('*');
      for (var d = 0; d < descendants.length; d++) {
        var desc = descendants[d];
        var liveDesc = liveDescendants[d] || null;
        // Skip nodes already detached with a removed forbidden ancestor
        // (querySelectorAll is static; removal does not re-enumerate).
        if (!root.contains(desc)) continue;
        if (liveDesc && wireDroppedWithAncestors(liveDesc.parentElement)) continue;
        if (liveDesc && blockedWithAncestors(liveDesc.parentElement)) continue;
        if (liveDesc && blockMatches(liveDesc)) {
          replaceWithBlockPlaceholder(liveDesc, desc, readBlockRect(liveDesc), payload.cloneToNid);
          continue;
        }
        var descResult = sanitizeForWire('element', { orig: liveDesc, clone: desc });
        if (descResult && descResult.drop && desc.parentNode) {
          desc.parentNode.removeChild(desc);
        }
      }
      return {};
    }

    if (kind === 'attr') {
      var attrName = String(payload.name || '').toLowerCase();
      // on* handler attr mutations: the op is DROPPED entirely, never
      // value-neutralized -- the mirror must not even learn the attribute
      // name (Pitfall 5: this branch bypassed the snapshot sanitizer).
      if (attrName.indexOf('on') === 0) {
        sanitizeCounters.strippedHandlers++;
        return { drop: true };
      }
      // srcdoc: dropped, matching the element-path attribute strip.
      if (attrName === 'srcdoc') {
        sanitizeCounters.blockedSubtrees++;
        return { drop: true };
      }
      // style: targeted CSS value scrub (A2: style attr mutations flow
      // through this branch as full inline-style serializations).
      if (attrName === 'style') {
        var scrubbedAttrCss = scrubCssText(payload.value);
        if (scrubbedAttrCss !== payload.value) {
          sanitizeCounters.cssScrubs++;
        }
        return { value: scrubbedAttrCss };
      }
      // srcset: per-candidate scheme neutralization.
      if (attrName === 'srcset' && payload.value) {
        var scrubbedAttrSrcset = scrubSrcset(payload.value);
        if (scrubbedAttrSrcset !== payload.value) {
          sanitizeCounters.blockedUrlSchemes++;
        }
        return { value: scrubbedAttrSrcset };
      }
      // URL-carrying attrs: dangerous schemes remove the attr on the mirror.
      // Preserving href with an empty value is still navigable in real
      // browsers, so null is the inert ATTR-op shape (diff.js removeAttribute).
      if ((URL_ATTRS.indexOf(attrName) !== -1 || attrName === 'formaction' || attrName === 'xlink:href')
          && payload.value && hasDangerousScheme(payload.value)) {
        sanitizeCounters.blockedUrlSchemes++;
        return { value: null };
      }
      if (attrName === 'value' && (shouldMaskInput(payload.target) || isOptionUnderMaskedSelect(payload.target))) {
        var maskedAttrValue = safeMaskInput(payload.value == null ? '' : payload.value, payload.target);
        if (maskedAttrValue !== payload.value) {
          sanitizeCounters.maskedInputs++;
        }
        return { value: maskedAttrValue };
      }
      return { value: payload.value };
    }

    if (kind === 'text') {
      // SEC-03 masking (plan 03-03): BOTH text-op branches (characterData
      // and the E2 text-childlist branch) route through this one hook. The
      // owner element is LIVE, so closest() sees the full ancestry. Phase 8
      // CAPT-05 typed-text capture plugs into the same seam. Unmasked text
      // passes through unchanged (default-off: zero wire change without
      // masking config).
      if (shouldMaskInput(payload.owner)) {
        var maskedInputText = safeMaskInput(payload.text == null ? '' : payload.text, payload.owner);
        if (maskedInputText !== payload.text) {
          sanitizeCounters.maskedInputs++;
        }
        return { text: maskedInputText };
      }
      if (maskTextMatches(payload.owner)) {
        var maskedOpText = safeMaskText(payload.text, payload.owner);
        if (maskedOpText !== payload.text) {
          sanitizeCounters.maskedTextNodes++;
        }
        return { text: maskedOpText };
      }
      return { text: payload.text };
    }

    if (kind === 'input') {
      var inputValue = payload.value == null ? '' : String(payload.value);
      if (shouldMaskInput(payload.owner)) {
        var maskedValue = safeMaskInput(inputValue, payload.owner);
        if (maskedValue !== inputValue) {
          sanitizeCounters.maskedInputs++;
        }
        return { value: maskedValue };
      }
      return { value: inputValue };
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
  function absolutifyUrl(val, baseDoc) {
    if (!val || val.startsWith('data:') || val.startsWith('blob:') || val.startsWith('javascript:')) {
      return val;
    }
    try {
      var base = baseDoc && baseDoc.baseURI ? baseDoc.baseURI : document.baseURI;
      return new URL(val, base).href;
    } catch (e) {
      return val;
    }
  }

  /**
   * Absolutify srcset attribute (comma-separated URL descriptors).
   * @param {string} srcset
   * @returns {string}
   */
  function absolutifySrcset(srcset, baseDoc) {
    if (!srcset) return srcset;
    var candidates = parseSrcsetCandidates(srcset);
    if (!candidates.length) return srcset;
    return candidates.map(function(candidate) {
      return formatSrcsetCandidate({
        url: absolutifyUrl(candidate.url, baseDoc),
        descriptor: candidate.descriptor
      });
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

  function collectSubtreeComputedStyles(root) {
    var styles = new WeakMap();
    if (!root || root.nodeType !== Node.ELEMENT_NODE) return styles;
    var liveElements = [root];
    if (root.querySelectorAll) {
      var descendants = root.querySelectorAll('*');
      for (var i = 0; i < descendants.length; i++) liveElements.push(descendants[i]);
    }
    for (var e = 0; e < liveElements.length; e++) {
      var styleText = collectComputedStyleText(liveElements[e], CURATED_PROPS);
      if (styleText) styles.set(liveElements[e], styleText);
    }
    return styles;
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
   * Strips scripts, absolutifies URLs, assigns stable node identity through
   * the internal mirror, renders iframes live with absolutified src, and
   * captures curated computed styles.
   *
   * @returns {Object} { html, stylesheets, scrollX, scrollY, viewportWidth, viewportHeight,
   *                     pageWidth, pageHeight, url, title }
   */
  function serializeDOM() {
    // SEC-01: counter snapshot for the ONE aggregate strip warn per pass.
    var sanBefore = sanitizeCountersSnapshot();

    // Clone the body for transformation
    var clone = document.body.cloneNode(true);
    var cloneToNid = new Map();

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
    var blockedPairs = [];

    for (var i = 0; i < pairs.length; i++) {
      var orig = pairs[i].orig;
      var cl = pairs[i].clone;
      var tag = cl.tagName ? cl.tagName.toLowerCase() : '';

      if (wireDroppedWithAncestors(orig.parentElement)) {
        reserveNodeId();
        continue;
      }

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

      // blockSelector: descendants of a blocked root get no nid assignment
      // (the root swap discards the whole cloned subtree). The blocked root
      // itself is still tracked, then replaced after this walk by a
      // dimension-preserving placeholder whose identity travels in nodeIds.
      if (blockedWithAncestors(orig.parentElement)) {
        continue;
      }
      if (blockMatches(orig)) {
        assignNodeId(orig, cl, cloneToNid);
        blockedPairs.push({ orig: orig, clone: cl });
        continue;
      }

      // Frame documents travel only through frames[] sidecars; the shell
      // iframe remains inert and content-free in the main html.
      if (tag === 'iframe') {
        assignNodeId(orig, cl, cloneToNid);
        prepareIframeWireShell(orig, cl);
        continue;
      }

      // Assign stable node identity in the internal mirror and sidecar map.
      var nid = assignNodeId(orig, cl, cloneToNid);

      // Canvas-to-img conversion: capture canvas content before it's lost in the clone
      if (tag === 'canvas') {
        try {
          var dataUrl = orig.toDataURL('image/png');
          var img = clone.ownerDocument.createElement('img');
          img.src = dataUrl;
          img.setAttribute('style', 'width:' + (orig.width || 300) + 'px;height:' + (orig.height || 150) + 'px;');
          if (cl.parentNode) {
            cl.parentNode.replaceChild(img, cl);
            cloneToNid.delete(cl);
            if (nid) cloneToNid.set(img, nid);
          }
        } catch (e) {
          // Tainted canvas or security error -- leave as empty canvas
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

    // Read all blocked live rects together after the pair walk and before
    // clone writes. This preserves the single-pass layout-read discipline:
    // dimensions come from the original elements, never detached clones.
    var blockedRects = [];
    for (var bp = 0; bp < blockedPairs.length; bp++) {
      blockedRects.push(readBlockRect(blockedPairs[bp].orig));
    }

    // Remove marked elements
    for (var r = 0; r < toRemove.length; r++) {
      if (toRemove[r].parentNode) {
        toRemove[r].parentNode.removeChild(toRemove[r]);
      }
    }

    for (var br = 0; br < blockedPairs.length; br++) {
      replaceWithBlockPlaceholder(blockedPairs[br].orig, blockedPairs[br].clone, blockedRects[br], cloneToNid);
    }

    // Collect stylesheet URLs from document.head
    var stylesheets = collectStylesheetsFrom(document);

    // Collect inline <style> tags from document.head, value-scrubbed
    // through the chokepoint's 'css' dispatch (SEC-01: dangerous url()
    // schemes, expression(), -moz-binding, non-http(s) @import, </style
    // breakout). Benign CSS passes byte-identical.
    var inlineStyles = collectInlineStylesFrom(document);

    var html = clone.innerHTML;
    var truncated = false;
    var missingDescendants = 0;
    var truncatedNodeIds = new Set();

    // Phase 211-02 (STREAM-03 + STREAM-04): single TreeWalker pre-pass on the
    // LIVE document reads getBoundingClientRect().top per tracked element into
    // a Map BEFORE any clone mutation. This collapses N forced layout flushes
    // into 1 (web-perf folklore: read-then-write batching). The Map is the
    // authoritative position source because the clone is not in the document
    // tree and getBoundingClientRect() on it returns zeros.
    var topByNid = new Map();
    try {
      var walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_ELEMENT,
        {
          acceptNode: function(el) {
            return getTrackedNodeId(el) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
          }
        }
      );
      var liveEl;
      while ((liveEl = walker.nextNode())) {
        var liveNid = getTrackedNodeId(liveEl);
        if (liveNid) {
          // Single getBoundingClientRect call per annotated element.
          // All reads happen before any clone mutation -> 1 layout flush.
          topByNid.set(liveNid, liveEl.getBoundingClientRect().top);
        }
      }
    } catch (e) { /* TreeWalker unavailable in this realm; truncation falls back to no-op */ }

    // SNAPSHOT_BUDGET_BYTES is the imported 80%-of-relay-cap budget. Compare
    // UTF-8 wire bytes, not UTF-16 code units, so non-ASCII snapshots respect
    // the relay's byte cap.
    if (wireByteLength(html) > SNAPSHOT_BUDGET_BYTES) {
      truncated = true;
      var viewportCutoff = window.innerHeight * TRUNCATION_VIEWPORT_MULTIPLIER;

      // Pass 1: drop complete subtrees whose cached top is below the
      // viewport-multiple cutoff. Iterate the clone's annotated elements;
      // consult the Map for live top. Removing a parent later in the loop
      // also removes its children, so we walk last-to-first to keep indices
      // stable as we mutate.
      var cloneEls1 = cloneElementsWithNodeIds(clone, cloneToNid);
      for (var t = cloneEls1.length - 1; t >= 0; t--) {
        var nidVal1 = cloneToNid.get(cloneEls1[t]);
        var top1 = topByNid.get(nidVal1);
        if (typeof top1 === 'number' && top1 > viewportCutoff) {
          var placeholder1 = replaceWithTruncatedPlaceholder(cloneEls1[t], cloneToNid);
          if (placeholder1) {
            var placeholderNid1 = cloneToNid.get(placeholder1);
            if (placeholderNid1) truncatedNodeIds.add(String(placeholderNid1));
            missingDescendants++;
          }
        }
      }

      // Re-measure; if still over cap, pass 2 walks remaining annotated
      // elements in document order and drops complete subtrees until under
      // cap. Only complete subtrees are removed -- never a mid-element cut.
      html = clone.innerHTML;
      if (wireByteLength(html) > SNAPSHOT_BUDGET_BYTES) {
        var cloneEls2 = cloneElementsWithNodeIds(clone, cloneToNid);
        for (var u = cloneEls2.length - 1; u >= 0 && wireByteLength(clone.innerHTML) > SNAPSHOT_BUDGET_BYTES; u--) {
          var placeholder2 = replaceWithTruncatedPlaceholder(cloneEls2[u], cloneToNid);
          if (placeholder2) {
            var placeholderNid2 = cloneToNid.get(placeholder2);
            if (placeholderNid2) truncatedNodeIds.add(String(placeholderNid2));
            missingDescendants++;
          }
        }
        html = clone.innerHTML;
      }
    }

    html = clone.innerHTML;

    // SEC-01: one aggregate strip warn per serialization pass (never silent).
    warnIfSanitizeStrips(sanBefore);

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
    }, shadowRoots, frames, clone, cloneToNid, truncatedNodeIds);
    html = budgetedSidecars.html;
    nodeIds = budgetedSidecars.nodeIds;
    shadowRoots = budgetedSidecars.shadowRoots;
    frames = budgetedSidecars.frames;
    truncated = budgetedSidecars.truncated;
    missingDescendants = budgetedSidecars.missingDescendants;

    var snapshotPayload = {
      html: html,
      nodeIds: nodeIds,
      shadowRoots: shadowRoots,
      frames: frames,
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
    return fitSnapshotPayloadForBudget(snapshotPayload, clone, cloneToNid, truncatedNodeIds);
  }

  // =========================================================================
  // 2. MutationObserver Streaming
  // =========================================================================

  /**
   * Mirror node ids for an added node and its descendants, absolutify URLs,
   * then serialize a SCRUBBED detached clone of it (for add ops).
   *
   * SEC-01: the live node keeps URL absolutification exactly as before
   * (reference parity -- the observed page must keep its event handlers;
   * stripping the live node would change page behavior). PhantomStream
   * identity stays in the internal mirror, not live attributes.
   * The wire HTML is then built from a detached cloneNode(true) routed
   * through sanitizeForWire('subtree') -- the serialized output never comes
   * from the live node directly (threat T-03-06).
   *
   * @param {Element} el - Added element to process
   * @returns {{html: string, nodeIds: string[]}|null} Scrubbed wire HTML and
   *   sidecar ids, or null when the root itself is forbidden.
   */
  function processAddedNode(el) {
    if (el.nodeType !== Node.ELEMENT_NODE) return null;
    if (wireDroppedWithAncestors(el)) {
      reserveNodeId();
      if (isWireDroppedElement(el)) sanitizeCounters.blockedSubtrees++;
      return null;
    }

    // Live-node identity mirror + absolutification (reference parity for URL
    // mutation, but no framework identity attributes on the observed page).
    var rootNid = ensureNodeId(el);
    if (blockMatches(el)) {
      var blockedRootPlaceholder = createBlockPlaceholder(
        document,
        readBlockRect(el)
      );
      sanitizeCounters.blockedSubtrees++;
      return {
        html: blockedRootPlaceholder.outerHTML || '',
        nodeIds: rootNid ? [rootNid] : []
      };
    }
    var computedStyles = collectSubtreeComputedStyles(el);
    var rootTag = el.tagName ? String(el.tagName).toLowerCase() : '';
    var baseDoc = el.ownerDocument || document;
    for (var a = 0; a < URL_ATTRS.length; a++) {
      if (rootTag === 'iframe' && URL_ATTRS[a] === 'src') continue;
      var val = el.getAttribute(URL_ATTRS[a]);
      if (val) el.setAttribute(URL_ATTRS[a], absolutifyUrl(val, baseDoc));
    }
    var srcset = el.getAttribute('srcset');
    if (srcset) el.setAttribute('srcset', absolutifySrcset(srcset, baseDoc));

    // Process descendant elements
    var descendants = el.querySelectorAll('*');
    for (var d = 0; d < descendants.length; d++) {
      var desc = descendants[d];
      if (wireDroppedWithAncestors(desc)) {
        reserveNodeId();
        continue;
      }
      if (blockedWithAncestors(desc.parentElement)) continue;
      ensureNodeId(desc);
      if (blockMatches(desc)) continue;
      var descTag = desc.tagName ? String(desc.tagName).toLowerCase() : '';
      var descDoc = desc.ownerDocument || baseDoc;
      for (var b = 0; b < URL_ATTRS.length; b++) {
        if (descTag === 'iframe' && URL_ATTRS[b] === 'src') continue;
        var dv = desc.getAttribute(URL_ATTRS[b]);
        if (dv) desc.setAttribute(URL_ATTRS[b], absolutifyUrl(dv, descDoc));
      }
      var ds = desc.getAttribute('srcset');
      if (ds) desc.setAttribute('srcset', absolutifySrcset(ds, descDoc));
    }

    // SEC-01: scrub a detached wire clone through the chokepoint and
    // serialize THAT -- never the live node's own markup.
    var wireClone = el.cloneNode(true);
    var cloneToNid = new Map();
    if (rootNid) cloneToNid.set(wireClone, rootNid);
    var rootStyleText = computedStyles.get(el);
    if (rootStyleText) appendStyleDeclaration(wireClone, rootStyleText);
    var liveDescendants = el.querySelectorAll('*');
    var cloneDescendants = wireClone.querySelectorAll('*');
    for (var c = 0; c < liveDescendants.length; c++) {
      var liveNid = getTrackedNodeId(liveDescendants[c]);
      if (liveNid && cloneDescendants[c]) cloneToNid.set(cloneDescendants[c], liveNid);
      var descStyleText = computedStyles.get(liveDescendants[c]);
      if (descStyleText && cloneDescendants[c]) {
        appendStyleDeclaration(cloneDescendants[c], descStyleText);
      }
    }
    prepareIframeWireShellsForClone(el, wireClone);
    var subtreeResult = sanitizeForWire('subtree', {
      root: wireClone,
      liveRoot: el,
      cloneToNid: cloneToNid
    });
    if (subtreeResult && subtreeResult.drop) return null;
    var nodeIds = buildNodeIdSidecar(wireClone, cloneToNid, true);
    var shadowRoots = collectShadowRootPayloads(el, nodeIds);
    var frames = collectFramePayloads(el, cloneToNid);
    return {
      html: wireClone.outerHTML || '',
      nodeIds: nodeIds,
      shadowRoots: shadowRoots,
      frames: frames
    };
  }

  function contentFreeSubtreeStatus(status) {
    return {
      status: status,
      nodeIds: [],
      shadowRoots: [],
      frames: []
    };
  }

  function serializeRequestedSubtree(nid) {
    var key = String(nid || '');
    if (!key) return contentFreeSubtreeStatus('untracked');
    var el = nidToElement.get(key);
    if (!el || el.nodeType !== Node.ELEMENT_NODE) {
      return contentFreeSubtreeStatus('untracked');
    }
    if (el.isConnected === false) {
      return contentFreeSubtreeStatus('gone');
    }
    if (getTrackedNodeId(el) !== key) {
      return contentFreeSubtreeStatus('untracked');
    }
    if (skipElementWithAncestors(el)) {
      return contentFreeSubtreeStatus('skipped');
    }
    if (blockedWithAncestors(el)) {
      return contentFreeSubtreeStatus('blocked');
    }
    if (wireDroppedWithAncestors(el)) {
      return contentFreeSubtreeStatus('blocked');
    }

    var sanBefore = sanitizeCountersSnapshot();
    var payload = processAddedNode(el);
    warnIfSanitizeStrips(sanBefore);
    if (!payload) {
      return contentFreeSubtreeStatus('blocked');
    }
    return {
      status: 'ok',
      html: payload.html || '',
      nodeIds: payload.nodeIds || [],
      shadowRoots: payload.shadowRoots || [],
      frames: payload.frames || []
    };
  }

  function isCurrentControlPayload(payload) {
    if (!payload) return false;
    if (!streamSessionId || !currentSnapshotId) return false;
    if (String(payload.streamSessionId || '') !== String(streamSessionId)) return false;
    if (String(payload.snapshotId || '') !== String(currentSnapshotId)) return false;
    return true;
  }

  function sendSubtreeResponse(request, result) {
    var response = Object.assign({
      requestId: request && request.requestId != null ? String(request.requestId) : '',
      nid: request && request.nid != null ? String(request.nid) : '',
      status: result.status || 'untracked',
      streamSessionId: streamSessionId || '',
      snapshotId: currentSnapshotId || 0
    }, result);
    if (response.status === 'ok' && wireByteLength(response) > RELAY_PER_MESSAGE_LIMIT_BYTES) {
      response = Object.assign({
        requestId: request && request.requestId != null ? String(request.requestId) : '',
        nid: request && request.nid != null ? String(request.nid) : '',
        streamSessionId: streamSessionId || '',
        snapshotId: currentSnapshotId || 0
      }, contentFreeSubtreeStatus('too-large'));
    }
    safeSend(STREAM.SUBTREE_RESPONSE, response);
  }

  function handleControl(type, payload) {
    if (type !== CONTROL.SUBTREE_REQUEST) return;
    var request = payload || {};
    if (!isCurrentControlPayload(request)) {
      sendSubtreeResponse(request, contentFreeSubtreeStatus('stale'));
      return;
    }
    sendSubtreeResponse(request, serializeRequestedSubtree(request.nid));
  }

  /**
   * Process a batch of accumulated mutations into diff objects.
   * @param {MutationRecord[]} mutations
   * @returns {Array} Array of diff objects
   */
  function processMutationBatch(mutations) {
    var diffs = [];
    var removedRoots = [];
    var shadowHosts = new Map();
    // Dedup registry for childList-derived text ops (fidelity fix, ledger
    // D6): multiple childList records in one batch targeting the same
    // element (e.g. two textContent= writes between flushes) collapse to a
    // single op. The op text is read LIVE from the target at process time,
    // so every record for the same element yields the same final value --
    // dedup loses nothing.
    var textOpNids = {};

    for (var i = 0; i < mutations.length; i++) {
      var m = mutations[i];
      var frameRecord = getMutationFrameRecord(m.target);
      if (!frameRecord && isInactiveFrameDocumentMutation(m.target)) continue;

      // Skip mutations on host-flagged elements (skipElement seam).
      // Ancestor-inclusive, matching the reference's isFsbOverlay closest()
      // semantics: mutations anywhere inside a skipped subtree are dropped.
      if (m.target && m.target.nodeType === Node.ELEMENT_NODE &&
          (skipElementWithAncestors(m.target) || blockedWithAncestors(m.target) || wireDroppedWithAncestors(m.target))) {
        continue;
      }
      if (m.target && m.target.nodeType === Node.TEXT_NODE &&
          m.target.parentElement &&
          (skipElementWithAncestors(m.target.parentElement)
            || blockedWithAncestors(m.target.parentElement)
            || wireDroppedWithAncestors(m.target.parentElement))) {
        continue;
      }

      var shadowHost = getMutationShadowHost(m.target);
      if (shadowHost) {
        if (skipElementWithAncestors(shadowHost) || blockedWithAncestors(shadowHost) || wireDroppedWithAncestors(shadowHost)) {
          continue;
        }
        var shadowHostNid = getTrackedNodeId(shadowHost) || ensureNodeId(shadowHost);
        if (shadowHostNid) {
          shadowHosts.set(String(shadowHostNid), {
            host: shadowHost,
            frameRecord: frameRecord
          });
        }
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
            if (wireDroppedWithAncestors(added.parentElement)) continue;
            if (blockedWithAncestors(added.parentElement)) continue;

            var parentNid = getTrackedNodeId(m.target);
            if (!parentNid) continue; // Parent not tracked

            var addedPayload = processAddedNode(added);
            // SEC-01: a forbidden root (script/noscript/object/embed)
            // scrubs to nothing -- emit no add op rather than an empty op.
            if (!addedPayload || !addedPayload.html) continue;
            observeOpenShadowRoots(added);
            observeSameOriginFrameDocuments(added);
            var nextSib = added.nextElementSibling;
            var beforeNid = getTrackedNodeId(nextSib);

            var addDiff = scopeFrameDiff({
              op: 'add',
              parentNid: parentNid,
              html: addedPayload.html,
              beforeNid: beforeNid,
              nodeIds: addedPayload.nodeIds,
              shadowRoots: addedPayload.shadowRoots || [],
              frames: addedPayload.frames || []
            }, frameRecord);
            diffs.push(boundMutationDiffForBudget(addDiff));
          } else if (added.nodeType === Node.TEXT_NODE || added.nodeType === Node.CDATA_SECTION_NODE) {
            sawBareTextNode = true;
          }
        }

        // Removed nodes
        for (var r = 0; r < m.removedNodes.length; r++) {
          var removed = m.removedNodes[r];
          if (removed.nodeType === Node.ELEMENT_NODE) {
            if (wireDroppedWithAncestors(removed)) continue;
            var nid = getTrackedNodeId(removed);
            if (!nid) continue; // Not tracked
            diffs.push(scopeFrameDiff({ op: 'rm', nid: nid }, frameRecord));
            removedRoots.push(removed);
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
          var textTargetNid = getTrackedNodeId(m.target);
          if (textTargetNid && !textOpNids[textTargetNid]) {
            textOpNids[textTargetNid] = true;
            // SEC-03 masking seam (plan 03-03): maskTextSelector /
            // maskTextFn applied inside the chokepoint; owner is the
            // mutation target itself for E2.
            var e2TextResult = sanitizeForWire('text', {
              text: m.target.textContent,
              owner: m.target
            });
            // Same wire shape as the characterData branch: the renderer's
            // DIFF_OP.TEXT applier sets textContent on the nid target.
            diffs.push(scopeFrameDiff({
              op: 'text',
              nid: textTargetNid,
              text: e2TextResult.text
            }, frameRecord));
          }
        }
      } else if (m.type === 'attributes') {
        var targetNid = getTrackedNodeId(m.target);
        if (!targetNid) continue;

        var attrName = String(m.attributeName || '');
        var attrNameLower = attrName.toLowerCase();
        var attrTargetTag = m.target && m.target.tagName ? String(m.target.tagName).toLowerCase() : '';
        if (attrTargetTag === 'iframe' && attrNameLower === 'src') {
          registerFrameLoadListener(m.target, targetNid);
          continue;
        }

        var attrVal = m.target.getAttribute(m.attributeName);
        // Absolutify URL attributes in mutations
        if (URL_ATTRS.indexOf(m.attributeName) !== -1 && attrVal) {
          attrVal = absolutifyUrl(attrVal, m.target.ownerDocument);
        }
        if (m.attributeName === 'srcset' && attrVal) {
          attrVal = absolutifySrcset(attrVal, m.target.ownerDocument);
        }

        // SEC-01: route through the chokepoint AFTER absolutification so
        // the scheme check runs on final wire values (Pitfall 5: this
        // branch was the snapshot sanitizer's bypass).
        var attrResult = sanitizeForWire('attr', {
          name: m.attributeName,
          value: attrVal,
          target: m.target
        });
        if (attrResult.drop) continue;

        diffs.push(scopeFrameDiff({
          op: 'attr',
          nid: targetNid,
          attr: m.attributeName,
          val: attrResult.value
        }, frameRecord));
      } else if (m.type === 'characterData') {
        var parentEl = m.target.parentElement;
        var textNid = getTrackedNodeId(parentEl);
        if (!textNid) continue;

        // SEC-03 masking seam (plan 03-03): maskTextSelector / maskTextFn
        // applied inside the chokepoint; owner is the LIVE parent element.
        var textResult = sanitizeForWire('text', {
          text: m.target.textContent,
          owner: parentEl
        });

        diffs.push(scopeFrameDiff({
          op: 'text',
          nid: textNid,
          text: textResult.text
        }, frameRecord));
      }
    }

    shadowHosts.forEach(function(entry, hostNid) {
      var host = entry && entry.host ? entry.host : entry;
      var payload = serializeOpenShadowRoot(host, hostNid);
      if (!payload) return;
      diffs.push(scopeFrameDiff(
        Object.assign({ op: DIFF_OP.SHADOW_ROOT }, payload),
        entry && entry.frameRecord ? entry.frameRecord : null
      ));
    });

    for (var rr = 0; rr < removedRoots.length; rr++) {
      if (!removedRoots[rr].isConnected) {
        forgetSubtreeIdentity(removedRoots[rr]);
      }
    }

    return diffs;
  }

  function mutationPayloadForBudget(diffs, options) {
    var opts = options || {};
    var payload = {
      mutations: diffs || [],
      streamSessionId: streamSessionId || '',
      snapshotId: currentSnapshotId || 0
    };
    if (opts.includeStaleFlushCount !== false) {
      payload.staleFlushCount = staleFlushCount;
    }
    return payload;
  }

  function firstPayloadNodeId(nodeIds) {
    if (!Array.isArray(nodeIds)) return '';
    for (var i = 0; i < nodeIds.length; i++) {
      if (nodeIds[i] !== undefined && nodeIds[i] !== null && String(nodeIds[i]) !== '') {
        return String(nodeIds[i]);
      }
    }
    return '';
  }

  function boundedAddPlaceholder(diff) {
    var rootNid = Array.isArray(diff.nodeIds) && diff.nodeIds.length ? diff.nodeIds[0] : '';
    if (!rootNid) return null;
    var bounded = Object.assign({
      op: DIFF_OP.ADD,
      parentNid: diff.parentNid || '',
      beforeNid: diff.beforeNid || ''
    }, truncatedPayloadForNid(document, rootNid));
    if (diff.frameNid) bounded.frameNid = diff.frameNid;
    return bounded;
  }

  function boundedFramePlaceholder(diff) {
    var frame = diff && diff.frame ? diff.frame : {};
    var frameNid = String((diff && diff.frameNid) || frame.frameNid || '');
    if (!frameNid) return null;
    var rootNid = firstPayloadNodeId(frame.nodeIds) || String(frame.bodyNid || frame.htmlNid || '');
    if (!rootNid) return null;
    var placeholder = truncatedPayloadForNid(document, rootNid);
    var boundedFrame = {
      frameNid: frameNid,
      kind: 'same-origin',
      html: placeholder.html || '',
      nodeIds: placeholder.nodeIds || [],
      shadowRoots: [],
      htmlNid: frame.htmlNid ? String(frame.htmlNid) : '',
      bodyNid: frame.bodyNid ? String(frame.bodyNid) : '',
      frames: [],
      stylesheets: [],
      inlineStyles: [],
      htmlAttrs: {},
      bodyAttrs: {},
      htmlStyle: '',
      bodyStyle: '',
      scrollX: frame.scrollX || 0,
      scrollY: frame.scrollY || 0,
      viewportWidth: frame.viewportWidth || 0,
      viewportHeight: frame.viewportHeight || 0,
      pageWidth: frame.pageWidth || 0,
      pageHeight: frame.pageHeight || 0,
      url: '',
      title: '',
      truncated: true,
      missingDescendants: (frame.missingDescendants || 0) + 1
    };
    return { op: DIFF_OP.FRAME, frameNid: frameNid, frame: boundedFrame };
  }

  function boundedShadowRootPlaceholder(diff) {
    var hostNid = String((diff && diff.hostNid) || '');
    var rootNid = firstPayloadNodeId(diff && diff.nodeIds);
    if (!hostNid || !rootNid) return null;
    var placeholder = truncatedPayloadForNid(document, rootNid);
    var bounded = {
      op: DIFF_OP.SHADOW_ROOT,
      hostNid: hostNid,
      mode: diff.mode || 'open',
      html: placeholder.html || '',
      nodeIds: placeholder.nodeIds || [],
      slotAssignment: diff.slotAssignment || 'none',
      truncated: true,
      missingDescendants: (diff.missingDescendants || 0) + 1
    };
    if (diff.frameNid) bounded.frameNid = diff.frameNid;
    return bounded;
  }

  function boundMutationDiffForBudget(diff, options) {
    if (!diff) return null;
    if (wireByteLength(mutationPayloadForBudget([diff], options)) <= RELAY_PER_MESSAGE_LIMIT_BYTES) return diff;
    var bounded = null;
    if (diff.op === DIFF_OP.ADD) bounded = boundedAddPlaceholder(diff);
    if (diff.op === DIFF_OP.FRAME) bounded = boundedFramePlaceholder(diff);
    if (diff.op === DIFF_OP.SHADOW_ROOT) bounded = boundedShadowRootPlaceholder(diff);
    if (!bounded) return null;
    return wireByteLength(mutationPayloadForBudget([bounded], options)) <= RELAY_PER_MESSAGE_LIMIT_BYTES
      ? bounded
      : null;
  }

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
      var singlePayload = mutationPayloadForBudget([diff], options);
      if (wireByteLength(singlePayload) > RELAY_PER_MESSAGE_LIMIT_BYTES) {
        logger.warn('[DOM Stream] mutation diff dropped over budget', {
          op: diff && diff.op ? diff.op : ''
        });
        continue;
      }
      var nextChunk = chunk.concat([diff]);
      if (chunk.length && wireByteLength(mutationPayloadForBudget(nextChunk, options)) > RELAY_PER_MESSAGE_LIMIT_BYTES) {
        safeSend(STREAM.MUTATIONS, mutationPayloadForBudget(chunk, options));
        chunk = [diff];
      } else {
        chunk = nextChunk;
      }
    }
    if (chunk.length) {
      safeSend(STREAM.MUTATIONS, mutationPayloadForBudget(chunk, options));
    }
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

    sendMutationDiffs(diffs);

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
    observedShadowRoots = new WeakSet();
    clearObservedFrameDocuments();

    mutationObserver = new MutationObserver(function(mutations) {
      // Accumulate mutations
      for (var i = 0; i < mutations.length; i++) {
        pendingMutations.push(mutations[i]);
      }

      // Batch flush synced to browser paint cycle via rAF (FIDELITY-03)
      if (batchTimer) cancelAnimationFrame(batchTimer);
      batchTimer = requestAnimationFrame(flushMutations);
    });

    mutationObserver.observe(document.body, mutationObserverOptions());
    observeOpenShadowRoots(document.body);
    observeSameOriginFrameDocuments(document.body);
    wrapAttachShadow();

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
    stopValueCapture();

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
    observedShadowRoots = new WeakSet();
    restoreAttachShadow();

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
        sendMutationDiffs(diffs, { includeStaleFlushCount: false });
      }
    }

    clearObservedFrameDocuments();
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
    clearNodeMirror();
    nextNodeId = 1;
    var snapshot = serializeDOM();
    safeSend(STREAM.SNAPSHOT, snapshot);
    startMutationStream();
    startValueCapture();
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
    clearNodeMirror();
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
    startValueCapture();
    startScrollTracker();
    streaming = true;
  }

  function getNodeId(element) {
    if (!streaming) return null;
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return null;
    if (element.isConnected === false && !getMutationFrameRecord(element)) return null;
    return getTrackedNodeId(element);
  }

  function getObservedFrameDocuments() {
    if (!streaming) return [];
    var roots = [];
    observedFrameDocuments.forEach(function(record) {
      if (!record || !record.document) return;
      roots.push({
        iframe: record.iframe,
        document: record.document,
        root: record.root || record.document,
        frameNid: record.frameNid
      });
    });
    return roots;
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
    resume: resume,
    handleControl: handleControl,
    getNodeId: getNodeId,
    getObservedFrameDocuments: getObservedFrameDocuments
  };
}


  var phantomStreamCapture = null;
  var phantomStreamLogger = {
    info: function () {},
    warn: function () {},
    error: function () {}
  };
  var phantomStreamBridge = typeof window.__phantomStreamBridge === "function"
    ? window.__phantomStreamBridge
    : null;

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

  window.__phantomStreamHandleControl = function (type, payload) {
    var capture = phantomStreamEnsureCapture();
    if (!capture || typeof capture.handleControl !== "function") return undefined;
    return capture.handleControl(type, payload || {});
  };

  window.__phantomStreamGetNodeId = function (element) {
    var capture = phantomStreamEnsureCapture();
    return capture && typeof capture.getNodeId === "function"
      ? capture.getNodeId(element)
      : null;
  };

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

  window.__phantomStreamStop = function () {
    if (phantomStreamCapture) phantomStreamCapture.stop();
    return true;
  };

  window.__phantomStreamStart();
}());
