// PhantomStream renderer: Document-parameterized diff applier.
//
// Port of the FSB reference viewer's mutation handler
// (reference/dashboard/dashboard.js:3209-3356, handleDOMMutations) with the
// iframe chrome factored out so the op loop runs against ANY injected
// Document -- jsdom 29 never parses srcdoc (02-RESEARCH.md Pattern 3,
// verified), so this seam is what makes the applier unit-testable.
//
// Division of responsibility (plan 02-01 contract, extended by 03-02):
//   - This module owns: the per-op switch (add/rm/attr/text), per-op
//     try/catch containment (one bad op never aborts the rest of the batch),
//     miss/failure counter increments, the parity thresholds (>= 3 stale
//     misses or >= 2 apply failures fire the injected resync callback; a
//     whole-batch failure fires it immediately), and the whole-batch catch.
//   - createViewer (plan 02-03) owns: the resync latch (requestResync here
//     is a plain injected callback -- dedup is the caller's job), staleness
//     gating, the post-batch scroll re-apply (needs contentWindow), and all
//     iframe state reads.
//
// Phase 3 upgrade (plan 03-02, SEC-02): the ADD branch parses wire html in
// TEMPLATE context (the queued Phase-3+ fix -- context-dependent elements
// like tr/td/col/option no longer drop; 03-RESEARCH Pattern 2, verified
// against jsdom 29) and every reconstructed-DOM insertion runs through the
// render-side chokepoint: sanitizeFragment scrubs the parsed template
// content before importNode, and sanitizeAttrValue interposes before every
// setAttribute in the ATTR branch (Pitfall 5, render side). Strip counts
// land in the caller-owned hooks.sanitizeCounters (per-session lifecycle
// in createViewer -- Pitfall 3).
//
// Dropped from the reference: every recordDashboardTransportEvent /
// recordDashboardTransportError call (FSB dashboard diagnostics ring
// buffers) -- replaced with counter increments plus hooks.logger.warn lines
// prefixed '[Renderer]'. The reference's two stale-miss event labels (a
// parent variant for add, a target variant for rm/attr/text) feed ONE
// counter there and one here; the resync reason collapses to the parent
// variant per the plan contract. Phase 7 routes node addressing through
// injected identity hooks owned by createViewer.

import { DIFF_OP } from '../protocol/messages.js';
import { sanitizeFragment, sanitizeAttrValue } from './sanitize.js';

function installShadowRootDirect(doc, host, payload, sanitizeCounters, logger, indexSubtree, removeSubtree) {
  var p = payload || {};
  if (!doc || !host) return false;
  if (p.mode && p.mode !== 'open') return false;
  var shadowRoot = host.shadowRoot || null;
  if (!shadowRoot) {
    if (typeof host.attachShadow !== 'function') {
      logger.warn('[Renderer] shadow root unsupported', { hostNid: p.hostNid || '' });
      return false;
    }
    shadowRoot = host.attachShadow({ mode: 'open' });
  }

  removeSubtree(shadowRoot);
  while (shadowRoot.firstChild) shadowRoot.removeChild(shadowRoot.firstChild);

  var tpl = doc.createElement('template');
  tpl.innerHTML = p.html || '';
  sanitizeFragment(tpl.content, sanitizeCounters, logger);
  shadowRoot.appendChild(doc.importNode(tpl.content, true));
  indexSubtree(shadowRoot, p.nodeIds || []);
  return true;
}

/**
 * @typedef {Object} DiffCounters
 * @property {number} staleMisses   Nid lookups that found no element (stale ops)
 * @property {number} applyFailures Ops (or whole batches) whose apply threw
 */

/**
 * @typedef {Object} DiffHooks
 * @property {{warn: function(...*): void}} logger
 *   Diagnostics sink for misses and failures (console-shaped).
 * @property {function(string, Object): void} requestResync
 *   Resync escalation callback. Fired at the parity thresholds; latching
 *   and the CONTROL.START send live in createViewer, not here.
 * @property {import('./sanitize.js').SanitizeCounters} [sanitizeCounters]
 *   OPTIONAL caller-owned sanitization strip counters (plan 03-02).
 *   Defaults to a local throwaway object so the public 4-arg signature is
 *   unchanged; createViewer injects its per-session object (Pitfall 3).
 */

/**
 * Apply a batch of capture diff ops against an injected Document.
 * Behavioral port of dashboard.js:3209-3356: each op addresses its target
 * by the injected identity resolver; a lookup miss is counted and warned, never thrown; a
 * throwing op is contained per-op so the rest of the batch still applies;
 * a failure of the batch machinery itself is caught once and escalated
 * immediately. Missing or empty batches return without side effects.
 *
 * @param {Document} doc            Target mirror Document (any Document works)
 * @param {Array<Object>} mutations Diff ops ({op, nid|parentNid, ...})
 * @param {DiffCounters} counters   Mutated in place; caller resets per snapshot
 * @param {DiffHooks} hooks         Injected logger + resync callback
 * @returns {void}
 */
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
  if (!mutations) return; // missing batch: not an error (reference defaults to [])

  // hooks.identity is normalized through opts so omitted hooks stay safe.
  var identity = opts.identity || {};
  var resolve = typeof identity.resolve === 'function'
    ? function (nid) { return identity.resolve(nid); }
    : function () { return null; };
  var indexSubtree = typeof identity.indexSubtree === 'function'
    ? function (root, nodeIds) { identity.indexSubtree(root, nodeIds || []); }
    : function () {};
  var removeSubtree = typeof identity.removeSubtree === 'function'
    ? function (root) { identity.removeSubtree(root); }
    : function () {};
  var installShadowRoot = typeof identity.installShadowRoot === 'function'
    ? function (hostNid, payload) { identity.installShadowRoot(hostNid, payload); }
    : null;
  var installFrames = typeof identity.installFrames === 'function'
    ? function (frames) { identity.installFrames(frames || []); }
    : null;
  var applyStyleSource = typeof identity.applyStyleSource === 'function'
    ? function (action, sourceId, scope, source) { return identity.applyStyleSource(action, sourceId, scope, source); }
    : null;
  var removeStyleSource = typeof identity.removeStyleSource === 'function'
    ? function (sourceId, scope) { return identity.removeStyleSource(sourceId, scope); }
    : null;
  // Phase 12 (MSEC-01) injected pre-write asset gate. createViewer injects the
  // posture-bound closures; omitted hooks default to no-ops so the public
  // applyMutations signature and every existing caller stay unchanged.
  //   gateFragmentAssets(node): pre-write gate over inert ADD template content
  //     (currentSrc pin + blocked-origin -> placeholder), run before importNode.
  //   gateAssetUrl(url, kind): per-URL verdict for the ATTR branch's src/poster,
  //     run before setAttribute (live-element mutation -> must gate pre-write).
  var gateFragmentAssets = typeof identity.gateFragmentAssets === 'function'
    ? function (node) { identity.gateFragmentAssets(node); }
    : function () {};
  var gateAssetUrl = typeof identity.gateAssetUrl === 'function'
    ? function (url, kind) { return identity.gateAssetUrl(url, kind); }
    : null;

  // Shared miss path: count, warn, and escalate at the parity threshold.
  function recordStaleMiss(op, nid) {
    tallies.staleMisses += 1;
    logger.warn('[Renderer] stale mutation: no element for nid', {
      op: op,
      nid: nid || '',
      staleMisses: tallies.staleMisses
    });
    if (tallies.staleMisses >= 3) {
      requestResync('stale-mutation-parent', { op: op, nid: nid || '' });
    }
  }

  function applyShadowRoot(payload) {
    var p = payload || {};
    var hostNid = p.hostNid;
    var host = resolve(hostNid);
    if (!host) {
      recordStaleMiss(DIFF_OP.SHADOW_ROOT, hostNid);
      return;
    }
    if (installShadowRoot) {
      installShadowRoot(hostNid, p);
      return;
    }
    installShadowRootDirect(doc, host, p, sanitizeCounters, logger, indexSubtree, removeSubtree);
  }

  function applyStyleSourceOp(m) {
    var sourceId = m && m.sourceId ? String(m.sourceId) : '';
    var scope = m && m.scope ? m.scope : null;
    var scopeKind = scope && scope.kind ? String(scope.kind) : '';
    if (!sourceId || !scopeKind) {
      requestResync('stale-style-scope', { sourceId: sourceId, scopeKind: scopeKind });
      return;
    }
    var ok = false;
    if (m.action === 'remove') {
      ok = removeStyleSource ? removeStyleSource(sourceId, scope) : false;
    } else if (m.action === 'upsert' || m.action === 'replace') {
      ok = applyStyleSource ? applyStyleSource(m.action, sourceId, scope, m.source || null) : false;
    }
    if (!ok) {
      tallies.staleMisses += 1;
      logger.warn('[Renderer] stale style source scope', {
        sourceId: sourceId,
        scopeKind: scopeKind,
        staleMisses: tallies.staleMisses
      });
      requestResync('stale-style-scope', { sourceId: sourceId, scopeKind: scopeKind });
    }
  }

  try {
    mutations.forEach(function (m) {
      try {
        switch (m.op) {
          case DIFF_OP.ADD: {
            var parent = resolve(m.parentNid);
            if (!parent) {
              recordStaleMiss(DIFF_OP.ADD, m.parentNid);
              break;
            }
            // TEMPLATE-context parse (03-RESEARCH Pattern 2, jsdom-29-
            // verified): template content accepts any HTML, so context-
            // dependent elements (<tr>, <td>, <col>, <option>, ...) no
            // longer drop. This is one of the renderer's two sanctioned
            // innerHTML sinks for wire content; the other is the Phase 8
            // shadow-root replacement parser above. Both are followed by
            // sanitizeFragment and pinned by the purity scan.
            var tpl = doc.createElement('template');
            tpl.innerHTML = m.html;
            // RENDER-SIDE CHOKEPOINT (SEC-02): scrub the PARSED fragment
            // before it gets anywhere near the mirror document -- DOM-
            // fragment based, never string-scrub-then-reparse (mXSS).
            sanitizeFragment(tpl.content, sanitizeCounters, logger);
            // PRE-WRITE FETCH GATE (MSEC-01): the parsed template content is
            // inert (fires no fetch), so gating it here -- before importNode --
            // is pre-write. Applies the currentSrc pin and replaces blocked
            // origins with the dimensioned placeholder.
            gateFragmentAssets(tpl.content);
            var newNode = tpl.content.firstElementChild;
            if (!newNode) {
              // Still possible: empty/whitespace-only m.html, or html whose
              // only element was a dropped hostile subtree. Never silent
              // (review WR-02): warn with the real cause, then count the
              // drop through the stale-miss path so the >= 3 resync
              // threshold self-heals via a fresh snapshot.
              logger.warn('[Renderer] add op dropped: html parsed to no element', {
                parentNid: m.parentNid || ''
              });
              recordStaleMiss(DIFF_OP.ADD, m.parentNid);
              break;
            }
            // importNode is REQUIRED: the parsed node lives in the
            // template's parser document; importNode adopts a deep clone
            // into the mirror doc (cross-doc insertBefore historically
            // varies across real browsers for some element types).
            var imported = doc.importNode(newNode, true);
            if (m.beforeNid) {
              var before = resolve(m.beforeNid);
              parent.insertBefore(imported, before); // null before == appendChild
            } else {
              parent.appendChild(imported);
            }
            indexSubtree(imported, m.nodeIds || []);
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
          case DIFF_OP.STYLE_SOURCE: {
            applyStyleSourceOp(m);
            break;
          }
          case DIFF_OP.REMOVE: {
            var el = resolve(m.nid);
            if (!el) {
              recordStaleMiss(DIFF_OP.REMOVE, m.nid);
              break;
            }
            removeSubtree(el);
            if (el.parentNode) el.parentNode.removeChild(el);
            break;
          }
          case DIFF_OP.ATTR: {
            var target = resolve(m.nid);
            if (!target) {
              recordStaleMiss(DIFF_OP.ATTR, m.nid);
              break;
            }
            var attrName = String(m.attr || '').toLowerCase();
            var targetTag = target.tagName ? String(target.tagName).toLowerCase() : '';
            if (targetTag === 'iframe' && attrName === 'src') {
              target.removeAttribute('src');
              logger.warn('[Renderer] iframe src attr op ignored', {
                nid: m.nid || ''
              });
              break;
            }
            if (m.val === null) {
              // null is a removal, not a value -- it precedes the scrub
              // by design (removing an attribute is always safe).
              target.removeAttribute(m.attr);
              break;
            }
            // RENDER-SIDE CHOKEPOINT (SEC-02, Pitfall 5): scrub before
            // every setAttribute -- defense-in-depth behind the capture
            // chokepoint. Drops and neutralizations are counted, never
            // silent; they are NOT stale misses (no resync churn).
            var scrubbed = sanitizeAttrValue(m.attr, m.val);
            if (scrubbed.drop) {
              sanitizeCounters.strippedHandlers += 1;
              logger.warn('[Renderer] attr op dropped by sanitizer', {
                nid: m.nid || '', attr: m.attr || ''
              });
              break;
            }
            if (scrubbed.value !== m.val) {
              if (String(m.attr).toLowerCase() === 'style') {
                sanitizeCounters.cssScrubs += 1;
              } else {
                sanitizeCounters.blockedUrls += 1;
              }
              logger.warn('[Renderer] attr op value scrubbed by sanitizer', {
                nid: m.nid || '', attr: m.attr || ''
              });
            }
            if (scrubbed.value === null) {
              target.removeAttribute(m.attr);
              break;
            }
            // PRE-WRITE FETCH GATE (MSEC-01): for fetchable attrs (src/poster)
            // on a LIVE mirror element, gate before setAttribute so a blocked
            // origin never reaches the live DOM (the browser would GET it
            // immediately). Blocked -> drop the attribute (no fetchable src);
            // the dimensioned placeholder is the snapshot/ADD path's job.
            if (gateAssetUrl && (attrName === 'src' || attrName === 'poster')) {
              var assetVerdict = gateAssetUrl(scrubbed.value, attrName === 'poster' ? 'poster' : 'image');
              if (!assetVerdict || !assetVerdict.allow) {
                sanitizeCounters.blockedUrls += 1;
                logger.warn('[Renderer] attr op asset blocked by origin gate', {
                  nid: m.nid || '', attr: m.attr || ''
                });
                target.removeAttribute(m.attr);
                break;
              }
            }
            target.setAttribute(m.attr, scrubbed.value);
            break;
          }
          case DIFF_OP.VALUE: {
            var valueTarget = resolve(m.nid);
            if (!valueTarget) {
              recordStaleMiss(DIFF_OP.VALUE, m.nid);
              break;
            }
            if (Object.prototype.hasOwnProperty.call(m, 'value')) {
              valueTarget.value = String(m.value ?? '');
            }
            if (Object.prototype.hasOwnProperty.call(m, 'checked')) {
              valueTarget.checked = !!m.checked;
            }
            if (Array.isArray(m.selectedIndexes) && valueTarget.options) {
              // Index-addressed selection is unambiguous even when masking
              // collapses distinct option values to the same masked string
              // (capture omits the raw values from the wire), so it wins over
              // selectedValues whenever the capture side provides it.
              var selectedIndexes = new Set();
              for (var si = 0; si < m.selectedIndexes.length; si++) {
                selectedIndexes.add(Number(m.selectedIndexes[si]));
              }
              for (var ix = 0; ix < valueTarget.options.length; ix++) {
                valueTarget.options[ix].selected = selectedIndexes.has(ix);
              }
            } else if (Array.isArray(m.selectedValues) && valueTarget.options) {
              var selectedValues = new Set();
              for (var sv = 0; sv < m.selectedValues.length; sv++) {
                selectedValues.add(String(m.selectedValues[sv]));
              }
              for (var opt = 0; opt < valueTarget.options.length; opt++) {
                var option = valueTarget.options[opt];
                option.selected = selectedValues.has(String(option.value));
              }
            }
            break;
          }
          case DIFF_OP.TEXT: {
            var textTarget = resolve(m.nid);
            if (!textTarget) {
              recordStaleMiss(DIFF_OP.TEXT, m.nid);
              break;
            }
            // No scrub here by design: textContent assignment has no HTML
            // parse path, so markup in m.text stays literal text.
            textTarget.textContent = m.text;
            break;
          }
        }
      } catch (e) {
        tallies.applyFailures += 1;
        logger.warn('[Renderer] mutation apply failed', {
          op: m && m.op ? m.op : '',
          nid: m && (m.nid || m.parentNid || m.beforeNid || '') ? (m.nid || m.parentNid || m.beforeNid || '') : '',
          error: e && e.message ? e.message : String(e),
          applyFailures: tallies.applyFailures
        });
        // Skip individual mutation errors -- don't break the whole batch
        if (tallies.applyFailures >= 2) {
          requestResync('dom-mutation-apply-failed', {
            op: m && m.op ? m.op : '',
            nid: m && (m.nid || m.parentNid || m.beforeNid || '') ? (m.nid || m.parentNid || m.beforeNid || '') : ''
          });
        }
      }
    });
  } catch (e) {
    tallies.applyFailures += 1;
    logger.warn('[Renderer] mutation batch failed', {
      error: e && e.message ? e.message : String(e),
      applyFailures: tallies.applyFailures
    });
    // Whole-batch failure escalates immediately; the caller keeps showing
    // the last good frame (no state change here -- reference parity).
    requestResync('dom-mutation-batch-failed', {
      error: String(e && e.message ? e.message : e)
    });
  }
}
