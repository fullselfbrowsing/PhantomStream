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
// variant per the plan contract. Node addressing goes through the NID_ATTR
// protocol constant, never a string literal.

import { DIFF_OP, NID_ATTR } from '../protocol/messages.js';
import { sanitizeFragment, sanitizeAttrValue } from './sanitize.js';

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
 * by nid selector; a lookup miss is counted and warned, never thrown; a
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

  function selectByNid(nid) {
    return doc.querySelector('[' + NID_ATTR + '="' + nid + '"]');
  }

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

  try {
    mutations.forEach(function (m) {
      try {
        switch (m.op) {
          case DIFF_OP.ADD: {
            var parent = selectByNid(m.parentNid);
            if (!parent) {
              recordStaleMiss(DIFF_OP.ADD, m.parentNid);
              break;
            }
            // TEMPLATE-context parse (03-RESEARCH Pattern 2, jsdom-29-
            // verified): template content accepts any HTML, so context-
            // dependent elements (<tr>, <td>, <col>, <option>, ...) no
            // longer drop. This is the renderer's ONLY innerHTML sink for
            // wire content (plan 03-05's purity scan pins it).
            var tpl = doc.createElement('template');
            tpl.innerHTML = m.html;
            // RENDER-SIDE CHOKEPOINT (SEC-02): scrub the PARSED fragment
            // before it gets anywhere near the mirror document -- DOM-
            // fragment based, never string-scrub-then-reparse (mXSS).
            sanitizeFragment(tpl.content, sanitizeCounters, logger);
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
              var before = selectByNid(m.beforeNid);
              parent.insertBefore(imported, before); // null before == appendChild
            } else {
              parent.appendChild(imported);
            }
            break;
          }
          case DIFF_OP.REMOVE: {
            var el = selectByNid(m.nid);
            if (!el) {
              recordStaleMiss(DIFF_OP.REMOVE, m.nid);
              break;
            }
            if (el.parentNode) el.parentNode.removeChild(el);
            break;
          }
          case DIFF_OP.ATTR: {
            var target = selectByNid(m.nid);
            if (!target) {
              recordStaleMiss(DIFF_OP.ATTR, m.nid);
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
            target.setAttribute(m.attr, scrubbed.value);
            break;
          }
          case DIFF_OP.TEXT: {
            var textTarget = selectByNid(m.nid);
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
