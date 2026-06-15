// Phase 08 RED coverage: iframe capture must mirror same-origin frame
// documents and emit content-free placeholders for cross-origin frames.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM, VirtualConsole } from 'jsdom';
import { createCapture } from '../src/capture/index.js';
import { STREAM } from '../src/protocol/messages.js';

const AUDITED_GLOBALS = [
  'window', 'document', 'Node', 'NodeFilter', 'MutationObserver',
  'requestAnimationFrame', 'cancelAnimationFrame', 'CustomEvent',
  'ShadowRoot', 'location', 'getComputedStyle', 'URL',
];

function setupEnv(bodyHtml) {
  const dom = new JSDOM(
    '<!DOCTYPE html><html><head><title>iframe fixture</title></head><body>'
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

function populateFrame(frame, html) {
  const doc = frame.contentDocument;
  doc.open();
  doc.write(html);
  doc.close();
  return doc;
}

test('D-08 same-origin iframe.contentDocument serializes as a scoped frames payload', async () => {
  const env = setupEnv('<main id="root"><iframe id="same-frame" src="/frame.html"></iframe></main>');
  try {
    const frame = env.document.getElementById('same-frame');
    const frameDoc = populateFrame(frame,
      '<!DOCTYPE html><html lang="en" data-frame="same"><head>'
        + '<link rel="stylesheet" href="/frame.css">'
        + '<style>.frame-button{color:blue}</style>'
        + '</head><body data-frame-body="yes">'
        + '<button id="inside-frame" class="frame-button">Frame button</button>'
        + '</body></html>'
    );
    const frameButton = frameDoc.getElementById('inside-frame');

    const transport = createRecordingTransport();
    env.capture = createCapture({ transport, logger: silentLogger() });
    env.capture.start();
    await settle(env.window);

    const payload = snapshotPayload(transport);
    const frameNid = env.capture.getNodeId(frame);

    assert.equal(payload.html.includes('id="same-frame"'), true, 'iframe host remains in main payload.html');
    assert.equal(Array.isArray(payload.frames), true, 'snapshot carries frames sidecar');

    const framePayload = payload.frames.find((entry) => entry.frameNid === frameNid);
    assert.ok(framePayload, 'frames entry is keyed by frameNid');
    assert.equal(framePayload.kind, 'same-origin');
    assert.equal(typeof framePayload.html, 'string');
    assert.ok(framePayload.html.includes('id="inside-frame"'), 'same-origin frame DOM is serialized');
    assert.ok(framePayload.html.includes('Frame button'), 'same-origin frame text is serialized');
    assert.equal(Array.isArray(framePayload.nodeIds), true, 'frame descendants carry nodeIds sidecar');
    assert.ok(framePayload.nodeIds.includes(env.capture.getNodeId(frameButton)), 'frame descendant nid matches getNodeId');
    assert.equal(Array.isArray(framePayload.stylesheets), true, 'frame stylesheets field exists');
    assert.equal(Array.isArray(framePayload.inlineStyles), true, 'frame inlineStyles field exists');
    assert.equal(typeof framePayload.htmlAttrs, 'object', 'frame htmlAttrs field exists');
    assert.equal(typeof framePayload.bodyAttrs, 'object', 'frame bodyAttrs field exists');
  } finally {
    env.teardown();
  }
});

test('D-09 cross-origin iframe emits content-free placeholder and does not leak thrown content', async () => {
  const env = setupEnv('<main id="root">'
    + '<iframe id="remote-frame" src="https://remote.example/private"></iframe>'
    + '</main>');
  try {
    const frame = env.document.getElementById('remote-frame');
    let accessCount = 0;
    Object.defineProperty(frame, 'contentDocument', {
      configurable: true,
      get() {
        accessCount += 1;
        throw new Error('cross-origin remote title SECRET_REMOTE_BODY');
      },
    });

    const transport = createRecordingTransport();
    env.capture = createCapture({ transport, logger: silentLogger() });
    env.capture.start();
    await settle(env.window);

    const payload = snapshotPayload(transport);
    const frameNid = env.capture.getNodeId(frame);
    assert.equal(Array.isArray(payload.frames), true, 'snapshot carries frames sidecar');

    const framePayload = payload.frames.find((entry) => entry.frameNid === frameNid);
    assert.ok(framePayload, 'cross-origin frame has a placeholder payload');
    assert.ok(accessCount >= 1, 'contentDocument was used only as the origin gate');
    assert.equal(framePayload.kind, 'cross-origin');
    assert.equal(framePayload.label, 'Cross-origin iframe');
    assert.equal(framePayload.src, 'https://remote.example/private');
    assert.equal(framePayload.origin, 'https://remote.example');
    assert.equal(Object.prototype.hasOwnProperty.call(framePayload, 'html'), false, 'placeholder has no nested html');
    assert.equal(Object.prototype.hasOwnProperty.call(framePayload, 'nodeIds'), false, 'placeholder has no nested nodeIds');
    assert.equal(Object.prototype.hasOwnProperty.call(framePayload, 'text'), false, 'placeholder has no remote text');
    assert.equal(Object.prototype.hasOwnProperty.call(framePayload, 'title'), false, 'placeholder has no remote title');
    assert.equal(JSON.stringify(transport.sent).includes('SECRET_REMOTE_BODY'), false, 'remote body text never reaches the wire');
  } finally {
    env.teardown();
  }
});

test('D-11 frame descendant nids are opaque Phase 7 ids while capture is active', async () => {
  const env = setupEnv('<main id="root"><iframe id="same-frame"></iframe></main>');
  try {
    const frame = env.document.getElementById('same-frame');
    const frameDoc = populateFrame(frame,
      '<!DOCTYPE html><html><body><button id="inside-frame">Frame button</button></body></html>'
    );
    const button = frameDoc.getElementById('inside-frame');

    const transport = createRecordingTransport();
    env.capture = createCapture({ transport, logger: silentLogger() });
    env.capture.start();
    await settle(env.window);

    const payload = snapshotPayload(transport);
    const buttonNid = env.capture.getNodeId(button);

    assert.equal(typeof buttonNid, 'string', 'frame descendant resolves through capture identity');
    assert.equal(Array.isArray(payload.frames), true, 'snapshot carries frames sidecar');
    assert.ok(payload.frames[0].nodeIds.includes(buttonNid), 'frame nodeIds sidecar includes descendant nid');
    assert.equal(frameDoc.querySelectorAll('[data-fsb-nid]').length, 0, 'frame document carries no framework nid attrs');
    assert.equal(JSON.stringify(transport.sent).includes('data-fsb-nid'), false, 'wire identity is sidecar-only');
  } finally {
    env.teardown();
  }
});
