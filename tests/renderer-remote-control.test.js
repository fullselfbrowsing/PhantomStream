// Renderer remote-control coordinate tests for Phase 05 Plan 03.
//
// Pins the framework/UI boundary: renderer exposes pure viewport mapping
// state for host-owned overlays, but renders no authorization controls or
// remote-control chrome itself.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM, VirtualConsole } from 'jsdom';
import {
  createViewer,
  mapHostPointToViewport,
} from '../src/renderer/index.js';
import { STREAM } from '../src/protocol/messages.js';

function setupEnv() {
  const dom = new JSDOM(
    '<!DOCTYPE html><html><head><title>remote fixture</title></head><body>'
      + '<div id="host"></div></body></html>',
    {
      url: 'https://fixture.test/remote',
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
    handler: null,
    sent: [],
    send(type, payload) {
      api.sent.push({ type, payload });
    },
    onMessage(h) {
      api.handler = h;
      return function unsubscribe() {
        api.handler = null;
      };
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

function snapshotPayload(overrides) {
  return Object.assign(
    {
      html: '<main>remote</main>',
      nodeIds: ['1'],
      stylesheets: [],
      inlineStyles: [],
      htmlAttrs: {},
      bodyAttrs: {},
      htmlStyle: '',
      bodyStyle: '',
      scrollX: 0,
      scrollY: 0,
      viewportWidth: 400,
      viewportHeight: 200,
      streamSessionId: 'stream_remote_a',
      snapshotId: 5150,
    },
    overrides || {}
  );
}

async function waitForStreaming(iframe) {
  for (let i = 0; i < 200; i++) {
    if (iframe.style.display !== 'none') return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('viewer never reached streaming');
}

function setContainerBox(container, width, height) {
  Object.defineProperty(container, 'clientWidth', {
    configurable: true,
    value: width,
  });
  Object.defineProperty(container, 'clientHeight', {
    configurable: true,
    value: height,
  });
}

test('mapHostPointToViewport maps stage coordinates into viewport CSS pixels', () => {
  assert.deepEqual(
    mapHostPointToViewport(
      { x: 60, y: 45 },
      { s: 0.5, offsetX: 10, offsetY: 20, pageW: 400, pageH: 200 }
    ),
    { inside: true, x: 100, y: 50 }
  );
});

test('mapHostPointToViewport rejects letterbox and out-of-bounds points', () => {
  const scale = { s: 0.5, offsetX: 10, offsetY: 20, pageW: 400, pageH: 200 };

  assert.deepEqual(
    mapHostPointToViewport({ x: 9, y: 45 }, scale),
    { inside: false, x: null, y: null },
    'left letterbox is not dispatchable'
  );
  assert.deepEqual(
    mapHostPointToViewport({ x: 60, y: 19 }, scale),
    { inside: false, x: null, y: null },
    'top letterbox is not dispatchable'
  );
  assert.deepEqual(
    mapHostPointToViewport({ x: 210, y: 45 }, scale),
    { inside: false, x: null, y: null },
    'right edge outside the scaled page is not dispatchable'
  );
  assert.deepEqual(
    mapHostPointToViewport({ x: 60, y: 120 }, scale),
    { inside: false, x: null, y: null },
    'bottom edge outside the scaled page is not dispatchable'
  );
});

test('mapHostPointToViewport clamps only after inside classification', () => {
  const scale = { s: 0.5, offsetX: 10, offsetY: 20, pageW: 400, pageH: 200 };

  assert.deepEqual(
    mapHostPointToViewport({ x: 10, y: 20 }, scale),
    { inside: true, x: 0, y: 0 },
    'top-left page edge maps to the first viewport pixel'
  );
  assert.deepEqual(
    mapHostPointToViewport({ x: 209.999, y: 119.999 }, scale),
    { inside: true, x: 399, y: 199 },
    'bottom-right in-page edge clamps to the last viewport pixel'
  );
  assert.deepEqual(
    mapHostPointToViewport({ x: 210, y: 119.999 }, scale),
    { inside: false, x: null, y: null },
    'x exactly past page width stays outside instead of clamping'
  );
});

test('getViewportMapping returns cloned scale viewport and container state', async () => {
  const env = setupEnv();
  try {
    setContainerBox(env.container, 500, 300);
    const transport = createRecordingTransport();
    env.viewer = createViewer({
      container: env.container,
      transport,
      logger: silentLogger(),
    });

    transport.emit(STREAM.SNAPSHOT, snapshotPayload());
    const iframe = env.container.querySelector('iframe');
    await waitForStreaming(iframe);

    const first = env.viewer.getViewportMapping();
    assert.deepEqual(first, {
      scale: { s: 1.25, offsetX: 0, offsetY: 25, pageW: 400, pageH: 200 },
      viewport: { width: 400, height: 200 },
      container: { width: 500, height: 300 },
    });

    first.scale.s = 99;
    first.viewport.width = 99;
    first.container.width = 99;

    const second = env.viewer.getViewportMapping();
    assert.deepEqual(second, {
      scale: { s: 1.25, offsetX: 0, offsetY: 25, pageW: 400, pageH: 200 },
      viewport: { width: 400, height: 200 },
      container: { width: 500, height: 300 },
    });
    assert.notEqual(first.scale, second.scale, 'scale object is cloned per call');
    assert.notEqual(first.viewport, second.viewport, 'viewport object is cloned per call');
    assert.notEqual(first.container, second.container, 'container object is cloned per call');
  } finally {
    env.teardown();
  }
});

test('renderer source contains no remote-control authorization UI chrome', () => {
  const rendererSource = [
    readFileSync(new URL('../src/renderer/index.js', import.meta.url), 'utf8'),
    readFileSync(new URL('../src/renderer/overlays.js', import.meta.url), 'utf8'),
  ].join('\n');

  assert.equal(/Request control/.test(rendererSource), false);
  assert.equal(/Authorization hook/.test(rendererSource), false);
  assert.equal(/Control active/.test(rendererSource), false);
  assert.equal(/REMOTE_CONTROL/.test(rendererSource), false);
});
