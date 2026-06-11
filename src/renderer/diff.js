// PhantomStream renderer: Document-parameterized diff applier.
//
// Port of the FSB reference viewer's mutation handler
// (reference/dashboard/dashboard.js:3209-3356, handleDOMMutations) with the
// iframe chrome factored out so the op loop runs against ANY injected
// Document -- jsdom 29 never parses srcdoc (02-RESEARCH.md Pattern 3,
// verified), so this seam is what makes the applier unit-testable.
//
// Division of responsibility (plan 02-01 contract):
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
// Dropped from the reference: every recordDashboardTransportEvent /
// recordDashboardTransportError call (FSB dashboard diagnostics ring
// buffers) -- replaced with counter increments plus hooks.logger.warn lines
// prefixed '[Renderer]'. The reference's two stale-miss event labels (a
// parent variant for add, a target variant for rm/attr/text) feed ONE
// counter there and one here; the resync reason collapses to the parent
// variant per the plan contract. Node addressing goes through the NID_ATTR
// protocol constant, never a string literal.

import { DIFF_OP, NID_ATTR } from '../protocol/messages.js';

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
            var temp = doc.createElement('div');
            temp.innerHTML = m.html;
            var newNode = temp.firstElementChild;
            if (!newNode) {
              // div-context innerHTML parsing DROPS context-dependent
              // elements (<tr>, <td>, <tbody>, <col>, ...): the html parses
              // to no element and the op cannot apply (reference parity,
              // dashboard.js:3241-3244). Never silent (review WR-02): warn
              // with the real cause, then count the drop through the
              // stale-miss path so the >= 3 resync threshold self-heals the
              // missing subtree via a fresh snapshot. Queued proper fix
              // (template-context parsing) in src/renderer/README.md
              // "Behavioral changes queued for Phase 3+".
              logger.warn('[Renderer] add op dropped: html parsed to no element in div context', {
                parentNid: m.parentNid || ''
              });
              recordStaleMiss(DIFF_OP.ADD, m.parentNid);
              break;
            }
            if (m.beforeNid) {
              var before = selectByNid(m.beforeNid);
              parent.insertBefore(newNode, before); // null before == appendChild
            } else {
              parent.appendChild(newNode);
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
              target.removeAttribute(m.attr);
            } else {
              target.setAttribute(m.attr, m.val);
            }
            break;
          }
          case DIFF_OP.TEXT: {
            var textTarget = selectByNid(m.nid);
            if (!textTarget) {
              recordStaleMiss(DIFF_OP.TEXT, m.nid);
              break;
            }
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
