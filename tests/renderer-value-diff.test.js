// Phase 8 RED tests for renderer value diff application (CAPT-05).
// These tests intentionally fail until applyMutations handles DIFF_OP.VALUE
// through DOM properties and keeps stale-miss behavior identical to existing
// add/rm/attr/text ops.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM, VirtualConsole } from 'jsdom';
import { applyMutations } from '../src/renderer/diff.js';
import { DIFF_OP } from '../src/protocol/messages.js';

const VALUE_OP = DIFF_OP.VALUE || 'value';

function setupEnv() {
  const dom = new JSDOM(
    '<!DOCTYPE html><html><head><title>value diff fixture</title></head><body></body></html>',
    {
      url: 'https://fixture.test/page',
      virtualConsole: new VirtualConsole(),
    }
  );
  return {
    dom,
    window: dom.window,
    makeDoc(bodyHtml) {
      const doc = dom.window.document.implementation.createHTMLDocument('value target');
      doc.body.innerHTML = bodyHtml;
      return doc;
    },
    teardown() {
      dom.window.close();
    },
  };
}

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

const BODY_HTML = '<form id="form">'
  + '<input id="text" type="text" value="attribute value">'
  + '<textarea id="textarea">initial body</textarea>'
  + '<select id="select">'
  + '<option id="option-a" value="alpha">Alpha</option>'
  + '<option id="option-b" value="bravo">Bravo</option>'
  + '</select>'
  + '<input id="checkbox" type="checkbox">'
  + '<input id="radio-a" type="radio" name="choice" value="a">'
  + '<input id="radio-b" type="radio" name="choice" value="b" checked>'
  + '</form>';

const NODE_IDS = [
  'form',
  'text',
  'textarea',
  'select',
  'option-a',
  'option-b',
  'checkbox',
  'radio-a',
  'radio-b',
];

test('value ops update form-control DOM properties without writing unsafe attributes', () => {
  const env = setupEnv();
  try {
    const doc = env.makeDoc(BODY_HTML);
    const rec = indexedHooks(doc, NODE_IDS);
    const counters = freshCounters();

    applyMutations(doc, [
      { op: VALUE_OP, nid: 'text', value: 'typed text' },
      { op: VALUE_OP, nid: 'textarea', value: 'typed area' },
      { op: VALUE_OP, nid: 'select', value: 'bravo', selectedValues: ['bravo'] },
      { op: VALUE_OP, nid: 'checkbox', checked: true },
      { op: VALUE_OP, nid: 'radio-a', value: 'a', checked: true },
    ], counters, rec.hooks);

    const input = doc.getElementById('text');
    const textarea = doc.getElementById('textarea');
    const select = doc.getElementById('select');
    const optionA = doc.getElementById('option-a');
    const optionB = doc.getElementById('option-b');
    const checkbox = doc.getElementById('checkbox');
    const radioA = doc.getElementById('radio-a');

    assert.equal(input.value, 'typed text', 'input.value updated as a property');
    assert.equal(
      input.getAttribute('value'),
      'attribute value',
      'input value attribute was not rewritten'
    );
    assert.equal(textarea.value, 'typed area', 'textarea.value updated as a property');
    assert.equal(
      textarea.textContent,
      'initial body',
      'textarea text node was not rewritten'
    );
    assert.equal(select.value, 'bravo', 'select.value updated');
    assert.equal(optionA.selected, false, 'unlisted option is not selected');
    assert.equal(optionB.selected, true, 'selectedValues selects the matching option');
    assert.equal(checkbox.checked, true, 'checkbox.checked updated as a property');
    assert.equal(checkbox.hasAttribute('checked'), false, 'checked attribute was not added');
    assert.equal(radioA.checked, true, 'radio.checked updated as a property');
    assert.equal(radioA.hasAttribute('checked'), false, 'radio checked attribute was not added');
    assert.equal(counters.staleMisses, 0);
    assert.equal(counters.applyFailures, 0);
  } finally {
    env.teardown();
  }
});

test("stale value-op nids count through the existing stale-mutation-parent resync path", () => {
  const env = setupEnv();
  try {
    const doc = env.makeDoc(BODY_HTML);
    const rec = indexedHooks(doc, NODE_IDS);
    const counters = freshCounters();

    applyMutations(doc, [
      { op: VALUE_OP, nid: 'ghost-a', value: 'a' },
      { op: VALUE_OP, nid: 'ghost-b', checked: true },
    ], counters, rec.hooks);
    assert.equal(counters.staleMisses, 2, 'two value-op misses accumulated');
    assert.equal(rec.resyncs.length, 0, 'below threshold: no resync yet');

    applyMutations(doc, [
      { op: VALUE_OP, nid: 'ghost-c', selectedValues: ['x'] },
    ], counters, rec.hooks);
    assert.equal(counters.staleMisses, 3, 'third value-op miss counted');
    assert.ok(rec.warns.length >= 3, 'each stale value op warned through the logger');
    assert.ok(rec.resyncs.length >= 1, 'threshold reached: resync requested');
    assert.equal(rec.resyncs[0].reason, 'stale-mutation-parent');
    assert.equal(rec.resyncs[0].details.op, VALUE_OP);
  } finally {
    env.teardown();
  }
});
