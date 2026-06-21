// Public semantic addressing API tests for Phase 07 Plan 03.
//
// Pins the host-facing surface: capture maps trusted live Elements to opaque
// nids, while the viewer resolves/highlights those nids through its internal
// sidecar index without exposing mirrored content or expanding remote-control
// behavior.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM, VirtualConsole } from 'jsdom';
import { createCapture } from '../src/capture/index.js';
import { createViewer } from '../src/renderer/index.js';
import { STREAM } from '../src/protocol/messages.js';

const AUDITED_GLOBALS = [
  'window', 'document', 'Node', 'NodeFilter', 'MutationObserver',
  'requestAnimationFrame', 'cancelAnimationFrame', 'CustomEvent',
  'ShadowRoot', 'location', 'getComputedStyle', 'URL',
];

function setupCaptureEnv(bodyHtml) {
  const dom = new JSDOM(
    '<!DOCTYPE html><html><head><title>semantic capture</title></head><body>'
      + bodyHtml + '</body></html>',
    {
      url: 'https://fixture.test/capture',
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

function setupViewerEnv() {
  const dom = new JSDOM(
    '<!DOCTYPE html><html><head><title>semantic viewer</title></head><body>'
      + '<div id="host"></div></body></html>',
    {
      url: 'https://fixture.test/viewer',
      pretendToBeVisual: true,
      virtualConsole: new VirtualConsole(),
    }
  );
  const w = dom.window;
  const env = {
    dom,
    window: w,
    document: w.document,
    container: w.document.getElementById('host'),
    viewer: null,
    teardown() {
      try {
        if (env.viewer) env.viewer.destroy();
      } catch (e) { /* already destroyed */ }
      env.viewer = null;
      w.close();
    },
  };
  return env;
}

function createRecordingTransport() {
  const api = {
    sent: [],
    handler: null,
    send(type, payload) {
      api.sent.push({ type, payload });
    },
    onMessage(handler) {
      api.handler = handler;
      return function unsubscribe() { api.handler = null; };
    },
    emit(type, payload) {
      if (api.handler) api.handler(type, payload);
    },
  };
  return api;
}

function silentLogger() {
  return { info() {}, warn() {}, error() {} };
}

function writeViewerSrcdoc(env, iframe) {
  const cd = iframe.contentDocument;
  cd.open();
  cd.write(iframe.getAttribute('srcdoc'));
  cd.close();
  iframe.dispatchEvent(new env.window.Event('load'));
}

function semanticSnapshotPayload(overrides) {
  return Object.assign(
    {
      html: '<main><button>Run</button></main>',
      nodeIds: ['1', '2'],
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
      streamSessionId: 'stream_semantic_a',
      snapshotId: 313,
    },
    overrides || {}
  );
}

test('capture getNodeId returns a nid for tracked live elements and null for detached elements', () => {
  const env = setupCaptureEnv('<main><button id="run">Run</button></main>');
  try {
    const transport = createRecordingTransport();
    env.capture = createCapture({ transport, logger: silentLogger() });
    env.capture.start();

    const button = env.document.getElementById('run');
    const nid = env.capture.getNodeId(button);
    assert.equal(typeof nid, 'string');
    assert.notEqual(nid, '');

    const detached = env.document.createElement('aside');
    assert.equal(env.capture.getNodeId(detached), null);
  } finally {
    env.teardown();
  }
});

test('viewer resolves and locally highlights nodes by opaque nid', () => {
  const env = setupViewerEnv();
  try {
    const transport = createRecordingTransport();
    env.viewer = createViewer({
      container: env.container,
      transport,
      logger: silentLogger(),
    });
    assert.deepEqual(
      Object.keys(env.viewer).sort(),
      [
        'clearHighlight',
        'destroy',
        'detach',
        'getViewportMapping',
        'handleSnapshot',
        'highlightNode',
        'on',
        'registerOverlay',
        'requestSubtree',
        'resolveNode',
      ],
      'viewer exposes semantic addressing methods on the public handle (plus the Phase 12 host-driven handleSnapshot)'
    );

    const payload = semanticSnapshotPayload();
    transport.emit(STREAM.SNAPSHOT, payload);
    const iframe = env.document.querySelector('iframe');
    writeViewerSrcdoc(env, iframe);
    const button = iframe.contentDocument.querySelector('button');
    button.getBoundingClientRect = function () {
      return { left: 12, top: 24, width: 48, height: 18 };
    };

    const resolved = env.viewer.resolveNode('2');
    assert.equal(resolved.nid, '2');
    assert.equal(resolved.exists, true);
    assert.equal(resolved.streamSessionId, payload.streamSessionId);
    assert.equal(resolved.snapshotId, payload.snapshotId);
    for (const key of ['top', 'left', 'width', 'height']) {
      assert.equal(typeof resolved.rect[key], 'number', 'rect.' + key + ' is numeric');
    }
    for (const forbidden of ['html', 'text', 'attrs', 'payload', 'url', 'title']) {
      assert.equal(
        Object.prototype.hasOwnProperty.call(resolved, forbidden),
        false,
        'resolveNode must not expose ' + forbidden
      );
    }

    assert.equal(env.viewer.highlightNode('2', { label: 'agent-target' }), true);
    assert.equal(
      transport.sent.some((msg) => msg.type === STREAM.OVERLAY),
      false,
      'highlightNode is local renderer behavior, not STREAM.OVERLAY'
    );
    const highlight = env.document.querySelector('.ps-node-highlight');
    assert.ok(highlight, 'highlight element exists in the host document');
    assert.notEqual(highlight.style.display, 'none', 'highlight is visible');
    assert.ok(highlight.textContent.includes('agent-target'), 'optional label is rendered as text');

    env.viewer.clearHighlight();
    const cleared = env.document.querySelector('.ps-node-highlight');
    assert.ok(!cleared || cleared.style.display === 'none' || cleared.hidden);

    assert.equal(env.viewer.resolveNode('missing'), null);
    assert.equal(env.viewer.highlightNode('missing'), false);
  } finally {
    env.teardown();
  }
});

test('semantic addressing does not expand renderer remote-control dispatch behavior', () => {
  const overlaysSource = readFileSync(new URL('../src/renderer/overlays.js', import.meta.url), 'utf8');
  const rendererSource = [
    readFileSync(new URL('../src/renderer/index.js', import.meta.url), 'utf8'),
    overlaysSource,
  ].join('\n');

  for (const forbidden of ['REMOTE_CONTROL', 'Request control', 'Authorization hook']) {
    assert.equal(rendererSource.includes(forbidden), false, 'source must not contain ' + forbidden);
  }
  // The reverse remote-control surface forwards user INPUT from the viewer to
  // the captured tab. The guard forbids new input-FORWARDING listeners. Phase
  // 13's media affordances add LOCAL-only activation listeners (click + keydown
  // on the in-host overlay play/unmute controls) that drive the in-iframe
  // element directly and NEVER call transport.send/safeSend -- they are not a
  // remote-control expansion, so 'click' is no longer blanket-banned here. The
  // input-capture event names that WOULD represent forwarding stay forbidden.
  for (const eventName of ['type', 'scroll', 'pointermove', 'pointerdown', 'mousemove']) {
    assert.equal(
      new RegExp("addEventListener\\(\\s*['\\\"]" + eventName + "['\\\"]").test(rendererSource),
      false,
      'renderer must not add a new ' + eventName + ' input-forwarding listener'
    );
  }
  // WR-04 (PRIMARY, structural): the affordance click/keydown listeners live in
  // overlays.js (wireActivation), and that module is wired to the renderer ONLY
  // through a local onActivate callback -- it holds NO transport reference by
  // design. Pin that invariant directly: overlays.js must contain no wire-send
  // token whatsoever (`transport`, `safeSend`, or a `.send(` call). This is a
  // far stronger guarantee than a textual-distance heuristic -- if any future
  // edit threads the wire into the overlay module, a DOM listener there COULD
  // forward input, and this assertion fails immediately. (index.js legitimately
  // owns transport.send/safeSend -- it is the renderer that drives the wire --
  // so the structural ban is scoped to the overlay module alone.)
  for (const wireToken of ['transport', 'safeSend', '.send(']) {
    assert.equal(
      overlaysSource.includes(wireToken),
      false,
      'overlays.js must not reach the wire (found "' + wireToken + '"): affordance listeners are local-only'
    );
  }
  // SECONDARY (kept as defense-in-depth): no addEventListener callback in the
  // combined renderer source sits within a short lexical window of a wire send.
  // The structural ban above is the authoritative check; this catches a
  // hypothetical regression where a listener and a send land in the same module.
  assert.equal(
    /addEventListener\([^)]*\)[\s\S]{0,400}?(?:transport\.send|safeSend)\s*\(/.test(rendererSource),
    false,
    'no renderer DOM listener may forward input over the wire (affordances are local-only)'
  );
});
