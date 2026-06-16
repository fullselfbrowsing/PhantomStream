// Phase 08 RED coverage: renderer must reconstruct real shadow roots and
// index shadow descendants through the private Phase 7 identity map.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM, VirtualConsole } from 'jsdom';
import { createViewer } from '../src/renderer/index.js';
import { applyMutations } from '../src/renderer/diff.js';
import { STREAM, DIFF_OP } from '../src/protocol/messages.js';

function setupEnv(bodyHtml) {
  const dom = new JSDOM(
    '<!DOCTYPE html><html><head><title>shadow renderer fixture</title></head><body>'
      + bodyHtml + '</body></html>',
    {
      url: 'https://viewer.test/page',
      pretendToBeVisual: true,
      virtualConsole: new VirtualConsole(),
    }
  );
  return {
    dom,
    window: dom.window,
    document: dom.window.document,
    viewer: null,
    teardown() {
      try {
        if (this.viewer) this.viewer.destroy();
      } catch (e) { /* already destroyed */ }
      this.viewer = null;
      dom.window.close();
    },
  };
}

function createManualTransport() {
  const handlers = new Set();
  const sent = [];
  return {
    sent,
    transport: {
      send(type, payload) { sent.push({ type, payload }); },
      onMessage(handler) {
        handlers.add(handler);
        return () => { handlers.delete(handler); };
      },
    },
    emit(type, payload) {
      handlers.forEach((handler) => handler(type, payload));
    },
  };
}

function silentLogger() {
  return { info() {}, warn() {}, error() {} };
}

function baseSnapshot(overrides = {}) {
  return {
    html: '<section id="host"><span id="light-label" slot="label">Light label</span><span id="light-default">Light default</span></section>',
    nodeIds: ['host-nid', 'light-label-nid', 'light-default-nid'],
    shadowRoots: [{
      hostNid: 'host-nid',
      mode: 'open',
      slotAssignment: 'named',
      html: '<slot name="label"></slot><button id="shadow-button" onclick="alert(1)">Shadow action</button><slot></slot>',
      nodeIds: ['shadow-label-slot-nid', 'shadow-button-nid', 'shadow-default-slot-nid'],
    }],
    truncated: false,
    missingDescendants: 0,
    stylesheets: [],
    inlineStyles: [],
    htmlAttrs: {},
    bodyAttrs: {},
    htmlStyle: '',
    bodyStyle: '',
    scrollX: 0,
    scrollY: 0,
    viewportWidth: 800,
    viewportHeight: 600,
    pageWidth: 800,
    pageHeight: 600,
    url: 'https://fixture.test/page',
    title: 'shadow fixture',
    streamSessionId: 'stream-shadow',
    snapshotId: 1,
    ...overrides,
  };
}

function viewerIframe(env) {
  return env.document.querySelector('#viewer iframe');
}

function glueMirror(iframe) {
  const cd = iframe.contentDocument;
  cd.open();
  cd.write(iframe.getAttribute('srcdoc'));
  cd.close();
  iframe.dispatchEvent(new iframe.ownerDocument.defaultView.Event('load'));
  return cd;
}

function freshCounters() {
  return { staleMisses: 0, applyFailures: 0 };
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

test('D-04/D-05/D-06 snapshot handling attaches sanitized real shadow root and indexes shadow nids', () => {
  const env = setupEnv('<div id="viewer" style="width:800px;height:600px"></div>');
  try {
    const wire = createManualTransport();
    env.viewer = createViewer({
      container: env.document.getElementById('viewer'),
      transport: wire.transport,
      logger: silentLogger(),
    });

    wire.emit(STREAM.SNAPSHOT, baseSnapshot());
    const doc = glueMirror(viewerIframe(env));
    const host = doc.getElementById('host');

    assert.ok(host.shadowRoot, 'mirror host has a real open shadowRoot');
    assert.ok(host.shadowRoot.querySelector('slot[name="label"]'), 'named slot reconstructed');
    assert.ok(host.shadowRoot.querySelector('slot:not([name])'), 'default slot reconstructed');
    assert.equal(host.shadowRoot.textContent.includes('Light label'), false, 'named light DOM child not duplicated');
    assert.equal(host.shadowRoot.textContent.includes('Light default'), false, 'default light DOM child not duplicated');
    assert.equal(host.shadowRoot.getElementById('shadow-button').hasAttribute('onclick'), false, 'shadow fragment sanitized');

    const resolved = env.viewer.resolveNode('shadow-button-nid');
    assert.ok(resolved, 'shadow descendant nid resolves through private index');
    assert.deepEqual(Object.keys(resolved).sort(), ['exists', 'nid', 'rect', 'snapshotId', 'streamSessionId'].sort());
    assert.equal(resolved.nid, 'shadow-button-nid');
    assert.equal(resolved.exists, true);
    assert.equal(resolved.streamSessionId, 'stream-shadow');
    assert.equal(resolved.snapshotId, 1);
    assert.equal(Object.prototype.hasOwnProperty.call(resolved, 'html'), false, 'resolveNode exposes no HTML');
    assert.equal(Object.prototype.hasOwnProperty.call(resolved, 'text'), false, 'resolveNode exposes no text');
    assert.equal(Object.prototype.hasOwnProperty.call(resolved, 'attrs'), false, 'resolveNode exposes no attrs');
  } finally {
    env.teardown();
  }
});

test('D-07 applyMutations handles DIFF_OP.SHADOW_ROOT without selector fallback', () => {
  const env = setupEnv('');
  try {
    const doc = env.document.implementation.createHTMLDocument('shadow mutation target');
    doc.body.innerHTML = '<section id="host"></section>';
    const identity = createIdentityIndex(doc, ['host-nid']);
    const rec = recordingHooks();
    rec.hooks.identity = identity;

    applyMutations(doc, [{
      op: DIFF_OP.SHADOW_ROOT,
      hostNid: 'host-nid',
      mode: 'open',
      html: '<button id="late-shadow">Late shadow</button>',
      nodeIds: ['late-shadow-nid'],
      slotAssignment: 'default',
    }], freshCounters(), rec.hooks);

    const host = identity.resolve('host-nid');
    assert.ok(host.shadowRoot, 'shadow mutation attached a real shadow root');
    assert.equal(host.shadowRoot.getElementById('late-shadow').textContent, 'Late shadow');
    assert.equal(identity.resolve('late-shadow-nid'), host.shadowRoot.getElementById('late-shadow'));
    assert.equal(doc.querySelectorAll('[data-fsb-nid]').length, 0, 'identity stays out of mirror attributes');
  } finally {
    env.teardown();
  }
});
