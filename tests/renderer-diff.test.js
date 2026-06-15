// Unit tests for the Document-parameterized diff applier
// (src/renderer/diff.js), ported from the reference mutation handler
// (reference/dashboard/dashboard.js:3209-3356). Pins:
//   - All four op types (add/rm/attr/text) applied against an injected
//     Document created via createHTMLDocument -- jsdom 29 never parses
//     srcdoc (02-RESEARCH.md Pattern 3, verified), so the Document seam is
//     the only unit-testable target. No iframe here.
//   - Renderer identity is sidecar-driven: fixtures intentionally contain
//     no framework data-fsb-nid attributes, and tests pass an injected
//     identity resolver/index built from nodeIds sidecars.
//   - Miss accounting: a nid lookup miss increments counters.staleMisses,
//     warns through hooks.logger, never throws; >= 3 misses fire the
//     injected resync callback with reason 'stale-mutation-parent'.
//   - Per-op containment: one throwing op increments counters.applyFailures
//     and the NEXT op in the same batch still applies; >= 2 failures fire
//     resync with reason 'dom-mutation-apply-failed'.
//   - Whole-batch failure fires 'dom-mutation-batch-failed' immediately.
//
// The setup/teardown helpers are deliberately duplicated locally
// (parallel-safe convention from tests/capture-skip.test.js: this file
// imports nothing from any shared test harness). No globals swap is needed:
// applyMutations dereferences ONLY the injected Document -- that seam is
// exactly what these tests exist to prove.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM, VirtualConsole } from 'jsdom';
import { applyMutations } from '../src/renderer/diff.js';
import { DIFF_OP } from '../src/protocol/messages.js';

/**
 * Build a fresh JSDOM instance and return an env whose makeDoc() mints
 * detached target Documents via createHTMLDocument seeded through
 * body.innerHTML, and whose teardown closes the window. Every test body
 * wraps in try/finally(env.teardown).
 */
function setupEnv() {
  const dom = new JSDOM(
    '<!DOCTYPE html><html><head><title>diff fixture</title></head><body></body></html>',
    {
      url: 'https://fixture.test/page',
      virtualConsole: new VirtualConsole(), // quiet: swallows "Not implemented" noise
    }
  );
  return {
    dom,
    window: dom.window,
    makeDoc(bodyHtml) {
      const doc = dom.window.document.implementation.createHTMLDocument('diff target');
      doc.body.innerHTML = bodyHtml;
      return doc;
    },
    teardown() {
      dom.window.close();
    },
  };
}

/** Recording hooks: capture every logger.warn call and resync request. */
function recordingHooks() {
  const warns = [];
  const resyncs = [];
  return {
    warns,
    resyncs,
    hooks: {
      logger: {
        info() {},
        warn(...args) { warns.push(args); },
        error() {},
      },
      requestResync(reason, details) { resyncs.push({ reason, details }); },
    },
  };
}

function elementsInSubtree(root) {
  const elements = [];
  if (!root) return elements;
  if (root.nodeType === 1) elements.push(root);
  if (root.querySelectorAll) {
    for (const el of root.querySelectorAll('*')) elements.push(el);
  }
  return elements;
}

function createIdentityIndex(doc, nodeIds) {
  const nidToNode = new Map();
  const nodeToNid = new WeakMap();

  function pair(elements, ids) {
    const safeIds = Array.isArray(ids) ? ids : [];
    for (let i = 0; i < elements.length && i < safeIds.length; i++) {
      const nid = String(safeIds[i]);
      nidToNode.set(nid, elements[i]);
      nodeToNid.set(elements[i], nid);
    }
  }

  function indexSubtree(root, ids) {
    pair(elementsInSubtree(root), ids);
  }

  function removeSubtree(root) {
    for (const el of elementsInSubtree(root)) {
      const nid = nodeToNid.get(el);
      if (nid) nidToNode.delete(nid);
      nodeToNid.delete(el);
    }
  }

  pair(Array.from(doc.body.querySelectorAll('*')), nodeIds);

  return {
    resolve(nid) { return nidToNode.get(String(nid)) || null; },
    indexSubtree,
    removeSubtree,
  };
}

function indexedHooks(doc, nodeIds) {
  const rec = recordingHooks();
  const identity = createIdentityIndex(doc, nodeIds);
  rec.identity = identity;
  rec.hooks.identity = identity;
  return rec;
}

function freshCounters() {
  return { staleMisses: 0, applyFailures: 0 };
}

/** Fixture element with no framework identity attributes. */
function el(tag, inner) {
  return '<' + tag + '>' + (inner || '') + '</' + tag + '>';
}

const BODY_HTML = el('div', el('span', 'hello') + el('span', 'world'));
const BODY_NODE_IDS = ['1', '2', '3'];

test("'add' op inserts the html's first element via TEMPLATE-context parsing + importNode", () => {
  const env = setupEnv();
  try {
    const doc = env.makeDoc(BODY_HTML);
    const rec = indexedHooks(doc, BODY_NODE_IDS);
    const counters = freshCounters();
    const add = { op: DIFF_OP.ADD, parentNid: '1', html: '<p>new</p>', nodeIds: ['9'] };
    assert.equal(add.html.includes('data-fsb-nid'), false, 'add html is sidecar-only');
    applyMutations(doc, [
      add,
    ], counters, rec.hooks);
    const added = rec.identity.resolve('9');
    assert.ok(added, 'new node is present in the target Document');
    assert.equal(added.tagName, 'P', 'first element of the template-parsed html was inserted');
    assert.equal(added.ownerDocument, doc, 'importNode adopted the node into the target Document');
    assert.equal(added.parentElement, rec.identity.resolve('1'), 'appended under parentNid');
    assert.equal(added.parentElement.lastElementChild, added, 'appendChild when no beforeNid');
    assert.equal(counters.staleMisses, 0);
    assert.equal(counters.applyFailures, 0);
    assert.equal(rec.resyncs.length, 0);
  } finally {
    env.teardown();
  }
});

test("'add' with beforeNid uses insertBefore; a missing beforeNid lookup behaves as appendChild", () => {
  const env = setupEnv();
  try {
    const doc = env.makeDoc(BODY_HTML);
    const rec = indexedHooks(doc, BODY_NODE_IDS);
    const counters = freshCounters();
    applyMutations(doc, [
      { op: DIFF_OP.ADD, parentNid: '1', html: '<p>first</p>', beforeNid: '2', nodeIds: ['9'] },
      { op: DIFF_OP.ADD, parentNid: '1', html: '<p>last</p>', beforeNid: 'nope', nodeIds: ['10'] },
    ], counters, rec.hooks);
    const parent = rec.identity.resolve('1');
    assert.equal(
      parent.firstElementChild, rec.identity.resolve('9'),
      'beforeNid hit: inserted before the addressed sibling'
    );
    assert.equal(
      parent.lastElementChild, rec.identity.resolve('10'),
      'beforeNid miss: insertBefore(node, null) appends (reference parity)'
    );
    assert.equal(counters.staleMisses, 0, 'a missing beforeNid is NOT a stale miss');
    assert.equal(counters.applyFailures, 0);
  } finally {
    env.teardown();
  }
});

test("an 'add' op with a bare <tr> row INSERTS under a table-shaped parent (template context preserves it)", () => {
  const env = setupEnv();
  try {
    // DELIBERATE FLIP of the WR-02 drop-and-count pin (plan 03-02 Task 2):
    // div-context parsing discarded context-dependent elements; template-
    // context parsing preserves them (03-RESEARCH Pattern 2, verified
    // against jsdom 29) -- the queued Phase-3+ upgrade is now taken.
    const doc = env.makeDoc('<table><tbody></tbody></table>');
    const rec = indexedHooks(doc, ['t1', 'tb1']);
    const counters = freshCounters();
    applyMutations(doc, [
      {
        op: DIFF_OP.ADD,
        parentNid: 'tb1',
        html: '<tr><td>row</td></tr>',
        nodeIds: ['r1', 'c1'],
      },
    ], counters, rec.hooks);
    const row = rec.identity.resolve('r1');
    assert.ok(row, 'tr inserted (no longer dropped by the parse context)');
    assert.equal(row.tagName, 'TR');
    assert.equal(row.parentElement, rec.identity.resolve('tb1'), 'inserted under the tbody parent');
    assert.equal(row.querySelector('td').textContent, 'row', 'td child preserved');
    assert.equal(counters.staleMisses, 0, 'zero stale misses: the parse-drop class is gone');
    assert.equal(counters.applyFailures, 0);
    assert.equal(rec.warns.length, 0, 'no warns on a successful context-dependent insert');
    assert.equal(rec.resyncs.length, 0);
  } finally {
    env.teardown();
  }
});

test("an 'add' whose html parses to no element (empty/whitespace/text-only) still warns with the real cause and counts (WR-02)", () => {
  const env = setupEnv();
  try {
    const doc = env.makeDoc(BODY_HTML);
    const rec = indexedHooks(doc, BODY_NODE_IDS);
    const counters = freshCounters();
    applyMutations(doc, [
      { op: DIFF_OP.ADD, parentNid: '1', html: '' },
    ], counters, rec.hooks);
    assert.equal(counters.staleMisses, 1, 'parse-to-nothing counted toward the resync threshold');
    assert.equal(counters.applyFailures, 0, 'a parse-to-nothing drop is not an apply failure');
    assert.ok(
      rec.warns.some((args) => String(args[0]).includes('parsed to no element')),
      'dedicated warn names the real cause (not a nid miss)'
    );
    assert.ok(
      !rec.warns.some((args) => String(args[0]).includes('div context')),
      'the warn no longer blames the retired div context'
    );
    assert.equal(rec.resyncs.length, 0, 'one drop stays below the threshold of 3');

    // Parse-to-nothing drops and nid misses share the accounting: the
    // third accumulated miss fires the standard self-heal resync.
    applyMutations(doc, [
      { op: DIFF_OP.ADD, parentNid: '1', html: '   ' },
      { op: DIFF_OP.ADD, parentNid: '1', html: 'text only, no element' },
    ], counters, rec.hooks);
    assert.equal(counters.staleMisses, 3, 'every parse-to-nothing drop accumulates');
    assert.ok(rec.resyncs.length >= 1, 'threshold reached: self-heal resync requested');
    assert.equal(rec.resyncs[0].reason, 'stale-mutation-parent', 'shared miss-path reason string');
  } finally {
    env.teardown();
  }
});

test("'rm' removes the nid-addressed element", () => {
  const env = setupEnv();
  try {
    const doc = env.makeDoc(BODY_HTML);
    const rec = indexedHooks(doc, BODY_NODE_IDS);
    const counters = freshCounters();
    applyMutations(doc, [
      { op: DIFF_OP.REMOVE, nid: '2' },
      { op: DIFF_OP.TEXT, nid: '2', text: 'stale' },
    ], counters, rec.hooks);
    assert.equal(rec.identity.resolve('2'), null, 'removed element is also removed from the index');
    assert.ok(rec.identity.resolve('3'), 'sibling untouched');
    assert.equal(counters.staleMisses, 1, 'later resolution of the removed nid is stale');
    assert.equal(counters.applyFailures, 0);
  } finally {
    env.teardown();
  }
});

test("'attr' with val null removes the attribute; otherwise sets it", () => {
  const env = setupEnv();
  try {
    const doc = env.makeDoc(BODY_HTML);
    const rec = indexedHooks(doc, BODY_NODE_IDS);
    const counters = freshCounters();
    applyMutations(doc, [
      { op: DIFF_OP.ATTR, nid: '2', attr: 'title', val: 'tip' },
    ], counters, rec.hooks);
    const el = rec.identity.resolve('2');
    assert.equal(el.getAttribute('title'), 'tip', 'non-null val -> setAttribute');
    applyMutations(doc, [
      { op: DIFF_OP.ATTR, nid: '2', attr: 'title', val: null },
    ], counters, rec.hooks);
    assert.equal(el.hasAttribute('title'), false, 'val === null -> removeAttribute');
    assert.equal(counters.applyFailures, 0);
  } finally {
    env.teardown();
  }
});

test("'text' sets textContent on the nid-addressed element", () => {
  const env = setupEnv();
  try {
    const doc = env.makeDoc(BODY_HTML);
    const rec = indexedHooks(doc, BODY_NODE_IDS);
    const counters = freshCounters();
    applyMutations(doc, [
      { op: DIFF_OP.TEXT, nid: '3', text: 'updated' },
    ], counters, rec.hooks);
    const el = rec.identity.resolve('3');
    assert.equal(el.textContent, 'updated', 'textContent replaced');
    assert.equal(counters.staleMisses, 0);
  } finally {
    env.teardown();
  }
});

test('a stale miss increments counters.staleMisses, warns through the logger, and does not throw', () => {
  const env = setupEnv();
  try {
    const doc = env.makeDoc(BODY_HTML);
    const rec = indexedHooks(doc, BODY_NODE_IDS);
    const counters = freshCounters();
    assert.doesNotThrow(() => {
      applyMutations(doc, [
        { op: DIFF_OP.TEXT, nid: 'ghost', text: 'x' },
      ], counters, rec.hooks);
    }, 'a miss never throws');
    assert.equal(counters.staleMisses, 1, 'miss counted');
    assert.equal(counters.applyFailures, 0, 'a miss is not an apply failure');
    assert.ok(rec.warns.length >= 1, 'miss logged through hooks.logger.warn');
    assert.equal(rec.resyncs.length, 0, 'below threshold: no resync yet');
  } finally {
    env.teardown();
  }
});

test("the third stale miss fires requestResync with reason 'stale-mutation-parent'", () => {
  const env = setupEnv();
  try {
    const doc = env.makeDoc(BODY_HTML);
    const rec = indexedHooks(doc, BODY_NODE_IDS);
    const counters = freshCounters();
    applyMutations(doc, [
      { op: DIFF_OP.ADD, parentNid: 'ghost-a', html: '<p>x</p>' },
      { op: DIFF_OP.REMOVE, nid: 'ghost-b' },
    ], counters, rec.hooks);
    assert.equal(counters.staleMisses, 2, 'two misses accumulated');
    assert.equal(rec.resyncs.length, 0, 'still below the parity threshold of 3');
    applyMutations(doc, [
      { op: DIFF_OP.ATTR, nid: 'ghost-c', attr: 'x', val: '1' },
    ], counters, rec.hooks);
    assert.equal(counters.staleMisses, 3, 'third miss counted');
    assert.ok(rec.resyncs.length >= 1, 'threshold reached: resync requested');
    assert.equal(rec.resyncs[0].reason, 'stale-mutation-parent', 'parity reason string');
  } finally {
    env.teardown();
  }
});

test('an op whose apply throws increments applyFailures and the NEXT op in the batch still applies', () => {
  const env = setupEnv();
  try {
    const doc = env.makeDoc(BODY_HTML);
    const rec = indexedHooks(doc, BODY_NODE_IDS);
    const counters = freshCounters();
    applyMutations(doc, [
      // 'bad name' is an invalid attribute name -> setAttribute throws
      { op: DIFF_OP.ATTR, nid: '2', attr: 'bad name', val: 'x' },
      { op: DIFF_OP.TEXT, nid: '3', text: 'after-failure' },
    ], counters, rec.hooks);
    assert.equal(counters.applyFailures, 1, 'throwing op counted as apply failure');
    const survivor = rec.identity.resolve('3');
    assert.equal(survivor.textContent, 'after-failure', 'next op in the same batch applied');
    assert.equal(rec.resyncs.length, 0, 'one failure is below the threshold of 2');
    assert.ok(rec.warns.length >= 1, 'failure logged through hooks.logger.warn');
  } finally {
    env.teardown();
  }
});

test("the second apply failure fires requestResync with reason 'dom-mutation-apply-failed'", () => {
  const env = setupEnv();
  try {
    const doc = env.makeDoc(BODY_HTML);
    const rec = indexedHooks(doc, BODY_NODE_IDS);
    const counters = freshCounters();
    applyMutations(doc, [
      { op: DIFF_OP.ATTR, nid: '2', attr: 'bad name', val: 'x' },
      { op: DIFF_OP.ATTR, nid: '3', attr: 'also bad', val: 'y' },
    ], counters, rec.hooks);
    assert.equal(counters.applyFailures, 2, 'both failures counted');
    assert.ok(rec.resyncs.length >= 1, 'threshold reached: resync requested');
    assert.equal(rec.resyncs[0].reason, 'dom-mutation-apply-failed', 'parity reason string');
  } finally {
    env.teardown();
  }
});

test("a whole-batch failure counts one apply failure and fires 'dom-mutation-batch-failed' immediately", () => {
  const env = setupEnv();
  try {
    const doc = env.makeDoc(BODY_HTML);
    const rec = recordingHooks();
    const counters = freshCounters();
    assert.doesNotThrow(() => {
      // Truthy non-iterable: .forEach blows up inside the guarded region
      applyMutations(doc, /** @type {*} */ (42), counters, rec.hooks);
    }, 'batch failure is contained');
    assert.equal(counters.applyFailures, 1, 'batch failure increments applyFailures once');
    assert.equal(rec.resyncs.length, 1, 'resync fired immediately (no threshold)');
    assert.equal(rec.resyncs[0].reason, 'dom-mutation-batch-failed', 'parity reason string');
  } finally {
    env.teardown();
  }
});

test('missing or empty mutations return without error, counters untouched', () => {
  const env = setupEnv();
  try {
    const doc = env.makeDoc(BODY_HTML);
    const rec = recordingHooks();
    const counters = freshCounters();
    assert.doesNotThrow(() => {
      applyMutations(doc, null, counters, rec.hooks);
      applyMutations(doc, undefined, counters, rec.hooks);
      applyMutations(doc, [], counters, rec.hooks);
    });
    assert.equal(counters.staleMisses, 0);
    assert.equal(counters.applyFailures, 0);
    assert.equal(rec.resyncs.length, 0);
    assert.equal(rec.warns.length, 0);
  } finally {
    env.teardown();
  }
});

test('ops address nodes through the injected identity resolver', () => {
  const env = setupEnv();
  try {
    const doc = env.makeDoc('');
    const el = doc.createElement('section');
    doc.body.appendChild(el);
    const rec = indexedHooks(doc, ['42']);
    const counters = freshCounters();
    applyMutations(doc, [
      { op: DIFF_OP.TEXT, nid: '42', text: 'found by resolver' },
    ], counters, rec.hooks);
    assert.equal(el.textContent, 'found by resolver', 'node resolved without mirror attributes');
    assert.equal(counters.staleMisses, 0, 'no miss: resolver-addressed lookup succeeded');
  } finally {
    env.teardown();
  }
});
