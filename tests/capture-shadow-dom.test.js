// Phase 08 RED coverage: open shadow DOM capture must extend the Phase 7
// sidecar identity model instead of flattening shadow content into light DOM.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM, VirtualConsole } from 'jsdom';
import { createCapture } from '../src/capture/index.js';
import { RELAY_PER_MESSAGE_LIMIT_BYTES, SNAPSHOT_BUDGET_BYTES } from '../src/protocol/constants.js';
import { STREAM, DIFF_OP } from '../src/protocol/messages.js';

const AUDITED_GLOBALS = [
  'window', 'document', 'Node', 'NodeFilter', 'MutationObserver',
  'requestAnimationFrame', 'cancelAnimationFrame', 'CustomEvent',
  'ShadowRoot', 'location', 'getComputedStyle', 'URL',
];

function setupEnv(bodyHtml) {
  const dom = new JSDOM(
    '<!DOCTYPE html><html><head><title>shadow fixture</title></head><body>'
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

function createRecordingTransport() {
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

function wireByteLength(value) {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function shadowFixture(env) {
  const host = env.document.getElementById('card');
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = '<section class="shell">'
    + '<slot name="label"></slot>'
    + '<button id="shadow-action" aria-label="Shadow action">Shadow action</button>'
    + '<slot></slot>'
    + '</section>';
  return {
    host,
    root,
    button: root.getElementById('shadow-action'),
  };
}

test('D-04/D-06 snapshot emits structured shadowRoots metadata tied to hostNid', async () => {
  const env = setupEnv('<main id="root">'
    + '<fs-card id="card"><span id="label" slot="label">Light label</span><p id="body">Light body</p></fs-card>'
    + '</main>');
  try {
    const fx = shadowFixture(env);
    const transport = createRecordingTransport();
    env.capture = createCapture({ transport, logger: silentLogger() });
    env.capture.start();
    await settle(env.window);

    const payload = snapshotPayload(transport);
    const hostNid = env.capture.getNodeId(fx.host);
    const shadowButtonNid = env.capture.getNodeId(fx.button);

    assert.ok(payload.html.includes('id="card"'), 'host element remains in payload.html');
    assert.equal(payload.html.includes('Shadow action'), false, 'shadow content is not flattened into payload.html');
    assert.equal(Array.isArray(payload.shadowRoots), true, 'snapshot carries shadowRoots sidecar');

    const shadow = payload.shadowRoots.find((entry) => entry.hostNid === hostNid);
    assert.ok(shadow, 'shadowRoots entry is keyed by the hostNid');
    assert.equal(shadow.mode, 'open');
    assert.equal(typeof shadow.html, 'string');
    assert.ok(shadow.html.includes('<slot name="label"'), 'named slot is serialized inside shadow HTML');
    assert.ok(shadow.html.includes('<slot'), 'default slot is serialized inside shadow HTML');
    assert.equal(Array.isArray(shadow.nodeIds), true, 'shadow descendants carry nodeIds sidecar');
    assert.ok(shadow.nodeIds.includes(shadowButtonNid), 'shadow descendant nid matches getNodeId');
    assert.ok(Object.prototype.hasOwnProperty.call(shadow, 'slotAssignment'), 'slotAssignment field is present');
  } finally {
    env.teardown();
  }
});

test('D-05 slotted light-DOM children are not duplicated into shadow HTML', async () => {
  const env = setupEnv('<main id="root">'
    + '<fs-card id="card">'
    + '<span id="label" slot="label">Projected label</span>'
    + '<span id="default-child">Projected default</span>'
    + '</fs-card>'
    + '</main>');
  try {
    shadowFixture(env);
    const transport = createRecordingTransport();
    env.capture = createCapture({ transport, logger: silentLogger() });
    env.capture.start();
    await settle(env.window);

    const payload = snapshotPayload(transport);
    assert.ok(payload.html.includes('Projected label'), 'named slotted child remains in light DOM html');
    assert.ok(payload.html.includes('Projected default'), 'default slotted child remains in light DOM html');

    assert.equal(Array.isArray(payload.shadowRoots), true, 'snapshot carries shadowRoots sidecar');
    const shadow = payload.shadowRoots.find((entry) => entry.hostNid === env.capture.getNodeId(env.document.getElementById('card')));
    assert.ok(shadow, 'shadowRoots entry exists for the host');
    assert.ok(shadow.html.includes('<slot name="label"'), 'named slot stays in shadow HTML');
    assert.ok(shadow.html.includes('<slot'), 'default slot stays in shadow HTML');
    assert.equal(shadow.html.includes('Projected label'), false, 'named slotted text is not duplicated');
    assert.equal(shadow.html.includes('Projected default'), false, 'default slotted text is not duplicated');
  } finally {
    env.teardown();
  }
});

test('D-06 shadow descendant getNodeId returns the opaque nid emitted in shadowRoots.nodeIds', async () => {
  const env = setupEnv('<main id="root"><fs-card id="card"><span slot="label">Label</span></fs-card></main>');
  try {
    const fx = shadowFixture(env);
    const transport = createRecordingTransport();
    env.capture = createCapture({ transport, logger: silentLogger() });
    env.capture.start();
    await settle(env.window);

    const payload = snapshotPayload(transport);
    const shadowButtonNid = env.capture.getNodeId(fx.button);

    assert.equal(typeof shadowButtonNid, 'string', 'shadow descendant resolves while capture is active');
    assert.ok(payload.shadowRoots[0].nodeIds.includes(shadowButtonNid));
    assert.equal(env.document.querySelectorAll('[data-fsb-nid]').length, 0, 'live page carries no framework nids');
    assert.equal(fx.root.querySelectorAll('[data-fsb-nid]').length, 0, 'shadow tree carries no framework nids');
  } finally {
    env.teardown();
  }
});

test('D-07 mutation inside mirrored open shadow root emits shadow-aware sidecar op', async () => {
  const env = setupEnv('<main id="root"><fs-card id="card"><span slot="label">Label</span></fs-card></main>');
  try {
    const fx = shadowFixture(env);
    const transport = createRecordingTransport();
    env.capture = createCapture({ transport, logger: silentLogger() });
    env.capture.start();
    await settle(env.window);

    const added = env.document.createElement('strong');
    added.id = 'shadow-late';
    added.textContent = 'Late shadow content';
    fx.root.querySelector('.shell').appendChild(added);
    await settle(env.window);

    const shadowOps = mutationOps(transport).filter((op) => op.op === DIFF_OP.SHADOW_ROOT);
    assert.equal(shadowOps.length, 1, 'one DIFF_OP.SHADOW_ROOT mutation emitted');
    assert.equal(shadowOps[0].hostNid, env.capture.getNodeId(fx.host), 'op is scoped to the host nid');
    assert.equal(Array.isArray(shadowOps[0].nodeIds), true, 'shadow mutation carries nodeIds');
    assert.ok(shadowOps[0].nodeIds.includes(env.capture.getNodeId(added)), 'added shadow node is indexed');
    assert.equal(JSON.stringify(transport.sent).includes('data-fsb-nid'), false, 'wire identity is sidecar-only');
  } finally {
    env.teardown();
  }
});

test('D-19 oversized live shadow root replacements emit bounded requestable placeholders', async () => {
  const env = setupEnv('<main id="root"><fs-card id="card"></fs-card></main>');
  try {
    const host = env.document.getElementById('card');
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = '<section id="shadow-before">Before</section>';

    const transport = createRecordingTransport();
    env.capture = createCapture({ transport, logger: silentLogger() });
    env.capture.start();
    await settle(env.window);

    root.innerHTML = '<section id="oversized-shadow-live">'
      + 'x'.repeat(RELAY_PER_MESSAGE_LIMIT_BYTES + 1024)
      + '</section>';
    const oversizedRoot = root.getElementById('oversized-shadow-live');
    await settle(env.window);

    const shadowMessage = transport.sent.find((message) => (
      message.type === STREAM.MUTATIONS
      && (message.payload.mutations || []).some((op) => op.op === DIFF_OP.SHADOW_ROOT)
    ));
    assert.ok(shadowMessage, 'oversized shadow replacement still emits a shadow-root mutation');
    assert.equal(wireByteLength(shadowMessage.payload) <= RELAY_PER_MESSAGE_LIMIT_BYTES, true,
      'bounded shadow-root mutation payload stays under the relay cap');

    const shadowOp = shadowMessage.payload.mutations.find((op) => op.op === DIFF_OP.SHADOW_ROOT);
    assert.equal(shadowOp.hostNid, env.capture.getNodeId(host), 'shadow replacement remains scoped to the host nid');
    assert.equal(shadowOp.truncated, true, 'oversized shadow replacement is explicit about truncation');
    assert.ok(shadowOp.html.includes('data-phantomstream-truncated="true"'),
      'oversized shadow replacement carries a requestable placeholder');
    assert.equal(shadowOp.html.includes('oversized-shadow-live'), false,
      'oversized shadow HTML is not sent after bounding');
    assert.ok(shadowOp.nodeIds.includes(env.capture.getNodeId(oversizedRoot)),
      'placeholder is keyed by the oversized shadow content nid');
  } finally {
    env.teardown();
  }
});

test('D-19 snapshot budget includes shadow sidecars before sending', async () => {
  const env = setupEnv('<main id="root"><fs-card id="card"></fs-card></main>');
  try {
    const host = env.document.getElementById('card');
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = '<section id="oversized-shadow">'
      + '😀'.repeat(Math.floor(SNAPSHOT_BUDGET_BYTES / 3))
      + '</section>';

    const transport = createRecordingTransport();
    env.capture = createCapture({ transport, logger: silentLogger() });
    env.capture.start();
    await settle(env.window);

    const payload = snapshotPayload(transport);
    const hostNid = env.capture.getNodeId(host);

    assert.equal(payload.truncated, true, 'sidecar overflow marks the snapshot truncated');
    assert.equal(payload.missingDescendants > 0, true, 'sidecar overflow increments missing descendants');
    assert.ok(payload.nodeIds.includes(hostNid), 'oversized sidecar host remains requestable by nid');
    assert.ok(
      payload.html.includes('data-phantomstream-truncated="true"'),
      'omitted sidecar host is replaced by a requestable truncated marker'
    );
    assert.equal(
      (payload.shadowRoots || []).some((entry) => entry.hostNid === hostNid),
      false,
      'oversized shadow sidecar is omitted from the bounded snapshot'
    );
    assert.equal(
      wireByteLength(payload) <= SNAPSHOT_BUDGET_BYTES,
      true,
      'complete snapshot payload stays under the UTF-8 relay budget'
    );
  } finally {
    env.teardown();
  }
});
