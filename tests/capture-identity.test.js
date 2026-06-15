// Phase 07 capture identity tests: PhantomStream identity must be internal
// to capture, while wire payloads carry ordered nodeIds sidecars.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM, VirtualConsole } from 'jsdom';
import { createCapture } from '../src/capture/index.js';
import { STREAM, DIFF_OP } from '../src/protocol/messages.js';

const AUDITED_GLOBALS = [
  'window', 'document', 'Node', 'NodeFilter', 'MutationObserver',
  'requestAnimationFrame', 'cancelAnimationFrame', 'CustomEvent',
  'ShadowRoot', 'location', 'getComputedStyle', 'URL',
];

function setupEnv(bodyHtml) {
  const dom = new JSDOM(
    '<!DOCTYPE html><html><head><title>identity fixture</title></head><body>'
      + bodyHtml + '</body></html>',
    {
      url: 'https://fixture.test/page',
      pretendToBeVisual: true,
      virtualConsole: new VirtualConsole(),
    }
  );
  const w = dom.window;
  const prior = new Map();
  for (const key of AUDITED_GLOBALS) {
    prior.set(key, {
      present: Object.prototype.hasOwnProperty.call(globalThis, key),
      value: globalThis[key],
    });
    globalThis[key] = key === 'window' ? w : w[key];
  }

  const env = {
    dom,
    window: w,
    document: w.document,
    capture: null,
    teardown() {
      try {
        if (env.capture) env.capture.stop();
      } catch (e) { /* already stopped */ }
      env.capture = null;
      for (const key of AUDITED_GLOBALS) {
        const p = prior.get(key);
        if (p.present) {
          globalThis[key] = p.value;
        } else {
          delete globalThis[key];
        }
      }
      w.close();
    },
  };
  return env;
}

async function settle(win) {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => win.requestAnimationFrame(resolve));
  await new Promise((resolve) => setTimeout(resolve, 20));
}

function createLoopbackTransport() {
  const sent = [];
  return {
    sent,
    send(type, payload) { sent.push({ type, payload }); },
  };
}

function silentLogger() {
  return { info() {}, warn() {}, error() {} };
}

function snapshotPayload(transport) {
  const snapshots = transport.sent.filter((m) => m.type === STREAM.SNAPSHOT);
  assert.equal(snapshots.length, 1, 'start() emits exactly one snapshot');
  return snapshots[0].payload;
}

function mutationOps(transport) {
  return transport.sent
    .filter((m) => m.type === STREAM.MUTATIONS)
    .flatMap((m) => m.payload.mutations);
}

function serializedElements(doc, html) {
  const tpl = doc.createElement('template');
  tpl.innerHTML = html;
  return Array.from(tpl.content.querySelectorAll('*'));
}

test('start does not write framework identity attributes or notify page observers', async () => {
  const env = setupEnv('<main id="root"><section id="one"><p>hello</p></section><section id="two">world</section></main>');
  try {
    const transport = createLoopbackTransport();
    const attributeRecords = [];
    const observer = new env.window.MutationObserver((records) => {
      attributeRecords.push(...records);
    });
    observer.observe(env.document.body, { attributes: true, subtree: true });

    env.capture = createCapture({ transport, logger: silentLogger() });
    env.capture.start();
    await settle(env.window);

    assert.equal(document.querySelectorAll('[data-fsb-nid]').length, 0);
    assert.deepEqual(
      attributeRecords.filter(({ attributeName }) => attributeName === 'data-fsb-nid'),
      [],
      'page observers saw no PhantomStream identity attribute writes'
    );
    observer.disconnect();
  } finally {
    env.teardown();
  }
});

test('page-owned data-fsb-nid remains ordinary page data and getNodeId returns internal identity', async () => {
  const env = setupEnv('<main id="root"><article id="owned" data-fsb-nid="page-owned"><span>owned</span></article></main>');
  try {
    const transport = createLoopbackTransport();
    env.capture = createCapture({ transport, logger: silentLogger() });
    env.capture.start();

    const owned = env.document.getElementById('owned');
    assert.equal(owned.getAttribute('data-fsb-nid'), 'page-owned');

    const nid = env.capture.getNodeId(owned);
    assert.equal(typeof nid, 'string');
    assert.notEqual(nid, 'page-owned');
    assert.equal(env.capture.getNodeId(env.document.createElement('aside')), null);
  } finally {
    env.teardown();
  }
});

test('snapshot payload includes preorder nodeIds sidecar matching serialized elements', async () => {
  const env = setupEnv('<main id="root"><section id="one"><p>hello</p></section><section id="two">world</section></main>');
  try {
    const transport = createLoopbackTransport();
    env.capture = createCapture({ transport, logger: silentLogger() });
    env.capture.start();

    const payload = snapshotPayload(transport);
    assert.equal(Array.isArray(payload.nodeIds), true);
    const elements = serializedElements(env.document, payload.html);
    assert.equal(payload.nodeIds.length, elements.length);
    assert.equal(elements.filter((el) => el.hasAttribute('data-fsb-nid')).length, 0);
    assert.equal(payload.nodeIds[0], env.capture.getNodeId(env.document.getElementById('root')));
  } finally {
    env.teardown();
  }
});

test('add ops include preorder nodeIds sidecar for added root and descendants', async () => {
  const env = setupEnv('<main id="root"><p id="existing">hello</p></main>');
  try {
    const transport = createLoopbackTransport();
    env.capture = createCapture({ transport, logger: silentLogger() });
    env.capture.start();
    await settle(env.window);

    const section = env.document.createElement('section');
    section.id = 'late';
    section.innerHTML = '<span>late</span>';
    env.document.getElementById('root').appendChild(section);
    await settle(env.window);

    const addOps = mutationOps(transport).filter((op) => op.op === DIFF_OP.ADD);
    assert.equal(addOps.length, 1, 'one add op emitted for the appended section subtree');
    const op = addOps[0];
    assert.equal(Array.isArray(op.nodeIds), true);
    assert.equal(op.nodeIds.length, 2);
    assert.equal(op.nodeIds.length, serializedElements(env.document, op.html).length);
    assert.equal(op.nodeIds[0], env.capture.getNodeId(section));
    assert.equal(op.nodeIds[1], env.capture.getNodeId(section.querySelector('span')));
  } finally {
    env.teardown();
  }
});

test('moving a tracked element preserves its nid across rm/add-compatible ops', async () => {
  const env = setupEnv('<main id="root"><section id="first">first</section><section id="moving"><span>move me</span></section><section id="last">last</section></main>');
  try {
    const transport = createLoopbackTransport();
    env.capture = createCapture({ transport, logger: silentLogger() });
    env.capture.start();
    await settle(env.window);

    const moving = env.document.getElementById('moving');
    const originalNid = env.capture.getNodeId(moving);
    assert.equal(typeof originalNid, 'string');

    env.document.getElementById('root').insertBefore(moving, env.document.getElementById('first'));
    await settle(env.window);

    assert.equal(env.capture.getNodeId(moving), originalNid);
    const ops = mutationOps(transport);
    assert.ok(
      ops.some((op) => op.op === DIFF_OP.REMOVE && op.nid === originalNid),
      'move emits a remove-compatible op for the original nid'
    );
    assert.ok(
      ops.some((op) => op.op === DIFF_OP.ADD
        && Array.isArray(op.nodeIds)
        && op.nodeIds[0] === originalNid),
      'move emits an add-compatible op whose sidecar reuses the original nid'
    );
  } finally {
    env.teardown();
  }
});
