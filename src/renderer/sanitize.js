// PhantomStream renderer: render-side sanitization chokepoint (SEC-02,
// plan 03-02).
//
// sanitizeFragment is the named chokepoint every reconstructed-DOM
// insertion runs through: the diff applier's add-op fragment (template-
// context parse, src/renderer/diff.js) and the post-parse scrub of the
// loaded mirror document (src/renderer/index.js). It is DOM-FRAGMENT
// based by design: it walks PARSED nodes and mutates them in place --
// it never serializes back to a string and never re-parses. The
// serialize-reparse round-trip is the canonical mXSS amplifier
// (03-RESEARCH.md "Anti-Patterns"), which is why string-scrub-then-parse
// is structurally absent from this module.
//
// Policy (blocklist, fidelity-first -- 03-CONTEXT decision; defense-in-
// depth behind the capture-side chokepoint, threat T-03-07/T-03-08):
//   - drop <script>/<noscript>/<object>/<embed> subtrees entirely
//     (noscript content IS DOM in no-allow-scripts sandboxes --
//     03-RESEARCH Pitfall 9; the mirror iframe never has allow-scripts)
//   - strip on* event-handler attributes, namespace-aware: attributes are
//     enumerated on every element regardless of namespace (Pitfall 4:
//     namespace-confusion mXSS relocates elements across HTML/SVG/MathML)
//   - remove the srcdoc attribute (nested attacker iframe)
//   - neutralize dangerous URL schemes (javascript:, vbscript:,
//     data:text/html -- data:image/* stays allowed) in
//     href/src/action/formaction/poster/data/xlink:href, and
//     per-candidate in srcset
//   - scrub style attribute values via scrubCssText
//
// The CSS policy in scrubCssText deliberately DUPLICATES the capture-side
// scrub (src/capture/index.js, 03-RESEARCH.md assumption A4): zero
// shared-module coupling between capture and renderer is the project
// shape, and the same regex policy on both sides is the documented
// defense-in-depth recipe.
//
// Strips are counted + logged, never silent (03-CONTEXT observability
// decision): one aggregated logger.warn('[Renderer] sanitization strips',
// ...) per sanitizeFragment call that strips anything. The counters object
// is caller-owned and mutated in place -- createViewer keeps it on a
// PER-SESSION lifecycle (03-RESEARCH Pitfall 3).
//
// Cross-runtime style per the renderer precedent: var declarations,
// || inline defaulting, named exports, no module-level side effects;
// DOM access only through the nodes passed in (the walker is created via
// root.ownerDocument, never an ambient document).

/**
 * @typedef {Object} SanitizeCounters
 * @property {number} strippedHandlers  on* attributes + srcdoc attributes removed
 * @property {number} blockedUrls       dangerous URL scheme values neutralized
 * @property {number} droppedSubtrees   script/noscript/object/embed subtrees removed
 * @property {number} cssScrubs         style values changed by scrubCssText
 */

// Tags whose whole subtree is dropped (03-CONTEXT discretion resolved:
// object/embed neutralization renders as full removal -- script/noscript
// parity; plugin shells would not render under the sandbox anyway).
var DROP_TAGS = { script: true, noscript: true, object: true, embed: true };

// URL-carrying attributes whose values get the dangerous-scheme test.
// xlink:href is matched by qualified name -- that is how the attribute
// enumerates (verified against jsdom 29, 03-RESEARCH).
var URL_ATTRS = {
  href: true,
  src: true,
  action: true,
  formaction: true,
  poster: true,
  data: true,
  'xlink:href': true
};

/**
 * Dangerous-scheme prefix test, control-char tolerant: HTML parsers strip
 * control characters and whitespace inside scheme names, so the probe does
 * too before the prefix check. Only the probe is transformed -- the
 * original value is never rewritten here. data:image/* stays allowed;
 * data:text/html is blocked (03-CONTEXT policy). Module-internal duplicate
 * of the capture-side helper by design (zero shared-module coupling).
 * @param {*} value
 * @returns {boolean}
 */
function hasDangerousScheme(value) {
  var probe;
  try {
    probe = String(value == null ? '' : value)
      .replace(/[\u0000-\u0020]+/g, '')
      .toLowerCase();
  } catch (e) {
    return true; // unstringifiable input: treat as dangerous
  }
  return probe.indexOf('javascript:') === 0
    || probe.indexOf('vbscript:') === 0
    || probe.indexOf('data:text/html') === 0;
}

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
 * Neutralize dangerous srcset candidates per-candidate; benign candidates
 * pass through. Returns the rebuilt value plus the blocked count so the
 * caller only rewrites the attribute when something was actually blocked
 * (fidelity: benign srcset values stay byte-identical -- a naive split on
 * commas would otherwise mangle data: URLs in legitimate candidates).
 * @param {*} value
 * @returns {{value: string, blocked: number}}
 */
function neutralizeSrcset(value) {
  var raw = String(value == null ? '' : value);
  var kept = [];
  var blocked = 0;
  var candidates = parseSrcsetCandidates(raw);
  for (var i = 0; i < candidates.length; i++) {
    if (hasDangerousScheme(candidates[i].url)) {
      blocked += 1;
      continue;
    }
    kept.push(formatSrcsetCandidate(candidates[i]));
  }
  return { value: kept.join(', '), blocked: blocked };
}

/**
 * Targeted CSS value scrub -- the only string-operation pass in the render
 * pipeline, and it is a VALUE scrub (regex), never a parser. Same policy
 * as the capture-side scrub (03-RESEARCH.md A4, src/capture/index.js):
 *   - url() with an explicit non-http(s)/non-data:image scheme has its
 *     contents replaced with about:blank; scheme-less (relative) url()
 *     values pass unchanged
 *   - expression() and -moz-binding (legacy script-execution vectors) are
 *     neutralized
 *   - non-http(s) CSS import targets are neutralized (string and url() forms)
 *   - a literal </style sequence is rewritten so captured CSS can never
 *     break out of the style tag it is emitted into at the string-assembly
 *     layer (src/renderer/snapshot.js)
 * Containment: a scrub failure returns the input unchanged (absolutifyUrl
 * discipline) -- the sandbox + CSP layers backstop CSS regardless.
 * @param {*} css
 * @returns {string}
 */
export function scrubCssText(css) {
  var input = String(css == null ? '' : css);
  try {
    var out = input;
    out = out.replace(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)"'][^)]*))?\s*\)/gi,
      function (match, dq, sq, bare) {
        var inner = dq !== undefined ? dq : (sq !== undefined ? sq : (bare || ''));
        var probe = String(inner || '').replace(/[\u0000-\u0020]+/g, '').toLowerCase();
        var scheme = /^([a-z][a-z0-9+.-]*):/.exec(probe);
        if (!scheme) return match; // relative URL: allowed
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

/**
 * Attr-op-shaped scrub dispatch for the diff applier's ATTR branch
 * (defense-in-depth render side of 03-RESEARCH Pitfall 5): the caller
 * applies the returned value via setAttribute, or skips the op entirely
 * when drop is true. Pure value transform -- no counters, no DOM; the
 * caller owns counting (its counters, its lifecycle).
 * @param {*} name   Attribute name from the wire (untrusted)
 * @param {*} value  Attribute value from the wire (untrusted)
 * @returns {{drop: boolean, value: string|null}}
 */
export function sanitizeAttrValue(name, value) {
  var n;
  var v;
  try {
    n = String(name == null ? '' : name).toLowerCase();
    v = String(value == null ? '' : value); // identity for wire strings
  } catch (e) {
    return { drop: true, value: '' };
  }
  if (n.indexOf('on') === 0) return { drop: true, value: '' };
  if (n === 'srcdoc') return { drop: true, value: '' };
  if (URL_ATTRS[n] === true) {
    if (hasDangerousScheme(v)) return { drop: false, value: null };
    return { drop: false, value: v };
  }
  if (n === 'srcset') {
    var rebuilt = neutralizeSrcset(v);
    return { drop: false, value: rebuilt.blocked > 0 ? rebuilt.value : v };
  }
  if (n === 'style') {
    return { drop: false, value: scrubCssText(v) };
  }
  return { drop: false, value: v };
}

/**
 * The render-side chokepoint: walk root (DocumentFragment | Element) plus
 * every descendant element and scrub in place per the module-top policy.
 * Collect-then-mutate (the capture serializer's TreeWalker precedent,
 * src/capture/index.js:596-615): the walker is live, so every element is
 * gathered into an array BEFORE any removal. Elements detached by an
 * earlier subtree drop are skipped (never double-counted). Mutates in
 * place -- never serializes.
 *
 * Containment: never throws. A failed walk warns and returns; a single
 * hostile element's scrub failure warns and the walk continues.
 *
 * @param {DocumentFragment|Element|null} root
 * @param {SanitizeCounters} [counters]  Mutated in place; caller-owned
 *   lifecycle (per-session in createViewer -- 03-RESEARCH Pitfall 3)
 * @param {{warn: function(...*): void}} [logger]
 * @returns {void}
 */
export function sanitizeFragment(root, counters, logger) {
  if (!root || !root.ownerDocument) return;
  var tallies = counters || {
    strippedHandlers: 0, blockedUrls: 0, droppedSubtrees: 0, cssScrubs: 0
  };
  var log = logger && typeof logger.warn === 'function'
    ? logger
    : { warn: function () {} };
  var before = {
    strippedHandlers: tallies.strippedHandlers,
    blockedUrls: tallies.blockedUrls,
    droppedSubtrees: tallies.droppedSubtrees,
    cssScrubs: tallies.cssScrubs
  };

  var elements = [];
  try {
    if (root.nodeType === 1) elements.push(root); // Element roots scrub themselves too
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

  for (var i = 0; i < elements.length; i++) {
    var el = elements[i];
    try {
      // Skip elements detached by an earlier subtree drop: their dropped
      // ancestor already left the tree, so they are unreachable from root.
      if (el !== root && !root.contains(el)) continue;

      var tag = el.tagName ? String(el.tagName).toLowerCase() : '';
      if (DROP_TAGS[tag] === true) {
        if (el.parentNode) el.parentNode.removeChild(el);
        tallies.droppedSubtrees += 1;
        continue;
      }
      if (tag === 'style') {
        var styleText = el.textContent || '';
        var scrubbedStyleText = scrubCssText(styleText);
        if (scrubbedStyleText !== styleText) {
          el.textContent = scrubbedStyleText;
          tallies.cssScrubs += 1;
        }
      }

      // Enumerate attribute names FIRST (removal mutates the live
      // NamedNodeMap), on every element regardless of namespace.
      var names = [];
      var attrs = el.attributes;
      for (var a = 0; a < attrs.length; a++) names.push(attrs[a].name);

      for (var x = 0; x < names.length; x++) {
        var name = names[x];
        var lower = String(name).toLowerCase();
        if (lower.indexOf('on') === 0) {
          el.removeAttribute(name);
          tallies.strippedHandlers += 1;
          continue;
        }
        if (lower === 'srcdoc') {
          el.removeAttribute(name);
          tallies.strippedHandlers += 1;
          continue;
        }
        if (URL_ATTRS[lower] === true) {
          var attrNode = el.getAttributeNode(name);
          if (attrNode && hasDangerousScheme(attrNode.value)) {
            el.removeAttributeNode(attrNode);
            tallies.blockedUrls += 1;
          }
          continue;
        }
        if (lower === 'srcset') {
          var rebuilt = neutralizeSrcset(el.getAttribute(name));
          if (rebuilt.blocked > 0) {
            el.setAttribute(name, rebuilt.value);
            tallies.blockedUrls += rebuilt.blocked;
          }
          continue;
        }
        if (lower === 'style') {
          var styleVal = el.getAttribute(name);
          var scrubbed = scrubCssText(styleVal);
          if (scrubbed !== styleVal) {
            el.setAttribute(name, scrubbed);
            tallies.cssScrubs += 1;
          }
          continue;
        }
      }
    } catch (e) {
      // Per-element containment: one hostile element never aborts the walk.
      log.warn('[Renderer] sanitization element scrub failed', {
        error: e && e.message ? e.message : String(e)
      });
    }
  }

  var strippedHandlers = tallies.strippedHandlers - before.strippedHandlers;
  var blockedUrls = tallies.blockedUrls - before.blockedUrls;
  var droppedSubtrees = tallies.droppedSubtrees - before.droppedSubtrees;
  var cssScrubs = tallies.cssScrubs - before.cssScrubs;
  if (strippedHandlers || blockedUrls || droppedSubtrees || cssScrubs) {
    // ONE aggregated warn per call -- counted + logged, never silent.
    log.warn('[Renderer] sanitization strips', {
      strippedHandlers: strippedHandlers,
      blockedUrls: blockedUrls,
      droppedSubtrees: droppedSubtrees,
      cssScrubs: cssScrubs
    });
  }
}
