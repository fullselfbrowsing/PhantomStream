import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM, VirtualConsole } from 'jsdom';

import {
  createPlaywrightAdapter,
  getPlaywrightInjectSource,
} from '../src/adapters/playwright.js';
import { CONTROL, REMOTE_CONTROL, REMOTE_CONTROL_STATE, STREAM } from '../src/protocol/index.js';

function tick() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function createRecordingTransport() {
  const messageHandlers = new Set();
  return {
    sent: [],
    send(type, payload) {
      this.sent.push({ type, payload });
    },
    onMessage(handler) {
      messageHandlers.add(handler);
      return () => messageHandlers.delete(handler);
    },
    emit(type, payload) {
      for (const handler of messageHandlers) handler(type, payload || {});
    },
  };
}

function createFakePage() {
  const calls = [];
  const listeners = new Map();
  const mainFrame = { name: 'main' };
  const childFrame = { name: 'child' };
  const page = {
    calls,
    bindings: new Map(),
    mainFrameValue: mainFrame,
    childFrameValue: childFrame,
    evaluateCalls: [],
    evaluateArgs: [],
    injectedWindow: null,
    injectedDocument: null,
    mouse: {
      clicks: [],
      moves: [],
      wheels: [],
      async click(x, y, options) {
        page.mouse.clicks.push({ x, y, options: options || {} });
      },
      async move(x, y) {
        page.mouse.moves.push({ x, y });
      },
      async wheel(deltaX, deltaY) {
        page.mouse.wheels.push({ deltaX, deltaY });
      },
    },
    keyboard: {
      inserted: [],
      downs: [],
      ups: [],
      async insertText(text) {
        page.keyboard.inserted.push(text);
      },
      async down(key) {
        page.keyboard.downs.push(key);
      },
      async up(key) {
        page.keyboard.ups.push(key);
      },
    },
    async exposeBinding(name, fn) {
      calls.push({ method: 'exposeBinding', name });
      page.bindings.set(name, fn);
    },
    async addInitScript(script) {
      calls.push({ method: 'addInitScript', content: script && script.content });
    },
    mainFrame() {
      return mainFrame;
    },
    on(event, handler) {
      calls.push({ method: 'on', event });
      const list = listeners.get(event) || [];
      list.push(handler);
      listeners.set(event, list);
    },
    emit(event, arg) {
      for (const handler of listeners.get(event) || []) {
        handler(arg);
      }
    },
    async evaluate(fnOrString, arg) {
      page.evaluateCalls.push(fnOrString);
      page.evaluateArgs.push(arg);
      if (typeof fnOrString !== 'function') return undefined;
      const previousWindow = globalThis.window;
      const previousDocument = globalThis.document;
      globalThis.window = page.injectedWindow || {};
      globalThis.document = page.injectedDocument || { body: {} };
      try {
        return fnOrString(arg);
      } finally {
        if (previousWindow === undefined) {
          delete globalThis.window;
        } else {
          globalThis.window = previousWindow;
        }
        if (previousDocument === undefined) {
          delete globalThis.document;
        } else {
          globalThis.document = previousDocument;
        }
      }
    },
  };
  return page;
}

function installedBridgeToken(page) {
  const init = page.calls.find((call) => call.method === 'addInitScript');
  assert.ok(init && typeof init.content === 'string', 'adapter installs tokenized init script');
  const match = init.content.match(/var PHANTOM_STREAM_BRIDGE_TOKEN = "([^"]+)";/);
  assert.ok(match, 'init script carries a closure-scoped bridge token');
  assert.notEqual(match[1], '', 'bridge token is non-empty');
  return match[1];
}

async function settleWindow(win) {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => win.requestAnimationFrame(resolve));
  await new Promise((resolve) => setTimeout(resolve, 20));
}

test('install exposes the binding before adding the init script artifact', async () => {
  const page = createFakePage();
  const transport = createRecordingTransport();
  const adapter = createPlaywrightAdapter({ page, transport });

  await adapter.install();

  assert.deepEqual(
    page.calls.slice(0, 2).map((call) => call.method),
    ['exposeBinding', 'addInitScript']
  );
  assert.equal(page.calls[0].name, '__phantomStreamBridge');
  assert.notEqual(page.calls[1].content, getPlaywrightInjectSource());
  assert.match(page.calls[1].content, /var PHANTOM_STREAM_BRIDGE_TOKEN = "[^"]+";/);
  assert.equal(page.calls[1].content.includes('window.__phantomStreamBridgeToken'), false);
  assert.ok(page.calls.some((call) => call.method === 'on' && call.event === 'framenavigated'));
});

test('inject source is a single classic script with the capture bridge hooks', () => {
  const source = getPlaywrightInjectSource();

  assert.equal(source.includes('import '), false);
  assert.equal(source.includes('export '), false);
  assert.match(source, /window\.top !== window/);
  assert.match(source, /window\.__phantomStreamBridge/);
  assert.match(source, /var PHANTOM_STREAM_BRIDGE_TOKEN = "";/);
  assert.match(source, /window\.__phantomStreamStart/);
  assert.match(source, /window\.__phantomStreamCapture/);
  assert.match(source, /window\.__phantomStreamHandleControl/);
  assert.match(source, /window\.__phantomStreamGetNodeId/);
  assert.match(source, /createCapture/);
});

test('inject source serializes only supported captureOptions', () => {
  const source = getPlaywrightInjectSource({
    captureOptions: {
      styleMode: 'cssom',
      fetchStylesheet: () => '.secret{}',
      other: 'ignored',
    },
  });

  assert.match(source, /var PHANTOM_STREAM_CAPTURE_OPTIONS = \{"styleMode":"cssom"\};/);
  assert.equal(source.includes('.secret'), false);
  assert.equal(source.includes('ignored'), false);
});

test('adapter install passes CSSOM captureOptions to the injected artifact', async () => {
  const page = createFakePage();
  const transport = createRecordingTransport();
  const adapter = createPlaywrightAdapter({
    page,
    transport,
    captureOptions: { styleMode: 'cssom' },
  });

  await adapter.install();

  const init = page.calls.find((call) => call.method === 'addInitScript');
  assert.match(init.content, /var PHANTOM_STREAM_CAPTURE_OPTIONS = \{"styleMode":"cssom"\};/);
});

test('inject source exposes capture handle and getNodeId for tracked page elements', async () => {
  const dom = new JSDOM(
    '<!doctype html><html><body><main><button id="target">Run</button></main></body></html>',
    {
      pretendToBeVisual: true,
      runScripts: 'outside-only',
      url: 'https://fixture.test/',
      virtualConsole: new VirtualConsole(),
    }
  );
  const sent = [];
  try {
    dom.window.__phantomStreamBridge = (message) => {
      sent.push(message);
      return { ok: true };
    };

    dom.window.eval(getPlaywrightInjectSource());
    await settleWindow(dom.window);

    const button = dom.window.document.getElementById('target');
    const nid = dom.window.__phantomStreamGetNodeId(button);

    assert.equal(typeof dom.window.__phantomStreamCapture, 'object');
    assert.equal(typeof dom.window.__phantomStreamGetNodeId, 'function');
    assert.equal(typeof nid, 'string');
    assert.equal(dom.window.__phantomStreamCapture.getNodeId(button), nid);
    assert.equal(dom.window.__phantomStreamGetNodeId(dom.window.document.createElement('aside')), null);
    assert.ok(sent.some((entry) => entry.type === STREAM.SNAPSHOT));
  } finally {
    dom.window.close();
  }
});

test('inject source closes over the original bridge so page wrappers cannot observe the token', async () => {
  const dom = new JSDOM(
    '<!doctype html><html><body><main><button id="target">Run</button></main></body></html>',
    {
      pretendToBeVisual: true,
      runScripts: 'outside-only',
      url: 'https://fixture.test/',
      virtualConsole: new VirtualConsole(),
    }
  );
  const originalMessages = [];
  const wrappedMessages = [];
  try {
    dom.window.__phantomStreamBridge = (message) => {
      originalMessages.push(message);
      return { ok: true };
    };

    const tokenizedSource = getPlaywrightInjectSource().replace(
      'var PHANTOM_STREAM_BRIDGE_TOKEN = "";',
      'var PHANTOM_STREAM_BRIDGE_TOKEN = "bridge-secret";'
    );
    dom.window.eval(tokenizedSource);
    await settleWindow(dom.window);

    const originalBridge = dom.window.__phantomStreamBridge;
    dom.window.__phantomStreamBridge = (message) => {
      wrappedMessages.push(message);
      return originalBridge(message);
    };

    const added = dom.window.document.createElement('section');
    added.id = 'after-wrapper';
    added.textContent = 'After wrapper';
    dom.window.document.querySelector('main').appendChild(added);
    await settleWindow(dom.window);

    assert.ok(
      originalMessages.some((entry) => entry.type === STREAM.MUTATIONS),
      'later capture sends continue through the original bridge'
    );
    assert.equal(wrappedMessages.length, 0, 'post-injection page wrapper never observes bridge calls');
    assert.equal(
      originalMessages.some((entry) => entry.token === 'bridge-secret'),
      true,
      'the original binding receives the closure-scoped token'
    );
  } finally {
    dom.window.close();
  }
});

test('binding forwards only main-frame bridge messages to transport', async () => {
  const page = createFakePage();
  const transport = createRecordingTransport();
  const adapter = createPlaywrightAdapter({ page, transport });
  await adapter.install();

  const bridge = page.bindings.get('__phantomStreamBridge');
  const token = installedBridgeToken(page);
  const child = await bridge(
    { page, frame: page.childFrameValue },
    { type: STREAM.READY, payload: { child: true } }
  );
  assert.deepEqual(child, { ok: false, error: 'frame-ignored' });
  assert.deepEqual(transport.sent, []);

  const wrongPage = await bridge(
    { page: {}, frame: page.mainFrameValue },
    { type: STREAM.READY, payload: { wrongPage: true } }
  );
  assert.deepEqual(wrongPage, { ok: false, error: 'page-ignored' });
  assert.deepEqual(transport.sent, []);

  const main = await bridge(
    { page, frame: page.mainFrameValue },
    { token, type: STREAM.SNAPSHOT, payload: { snapshotId: 7 } }
  );
  assert.deepEqual(main, { ok: true });
  assert.deepEqual(transport.sent, [
    { type: STREAM.SNAPSHOT, payload: { snapshotId: 7 } },
  ]);

  const forged = await bridge(
    { page, frame: page.mainFrameValue },
    { type: STREAM.SNAPSHOT, payload: { snapshotId: 8 } }
  );
  assert.deepEqual(forged, { ok: false, error: 'bridge-token-invalid' });

  const wrongType = await bridge(
    { page, frame: page.mainFrameValue },
    { token, type: CONTROL.START, payload: { reason: 'page-forged-control' } }
  );
  assert.deepEqual(wrongType, { ok: false, error: 'bridge-type-invalid' });
});

test('main-frame navigation calls the injected start hook for a fresh snapshot path', async () => {
  const page = createFakePage();
  const transport = createRecordingTransport();
  let startCount = 0;
  page.injectedWindow = {
    __phantomStreamStart() {
      startCount += 1;
      return 'fresh-snapshot';
    },
  };
  page.injectedDocument = { body: {} };

  const adapter = createPlaywrightAdapter({ page, transport });
  await adapter.install();

  page.emit('framenavigated', page.childFrameValue);
  await tick();
  assert.equal(startCount, 0);

  page.emit('framenavigated', page.mainFrameValue);
  await tick();

  assert.equal(startCount, 1);
  assert.equal(page.evaluateCalls.length, 1);
  assert.match(String(page.evaluateCalls[0]), /__phantomStreamStart/);
});

test('viewer stream start request restarts injected capture for a missed initial snapshot', async () => {
  const page = createFakePage();
  const transport = createRecordingTransport();
  let startCount = 0;
  page.injectedWindow = {
    __phantomStreamStart() {
      startCount += 1;
      return 'viewer-requested-snapshot';
    },
  };
  page.injectedDocument = { body: {} };

  const adapter = createPlaywrightAdapter({ page, transport });
  await adapter.install();

  transport.emit(CONTROL.START, { reason: 'viewer-attached' });
  await tick();

  assert.equal(startCount, 1);
  assert.equal(page.evaluateCalls.length, 1);
  assert.match(String(page.evaluateCalls[0]), /__phantomStreamStart/);
});

test('transport subtree requests are evaluated in the injected capture bridge and responses return through binding', async () => {
  const page = createFakePage();
  const transport = createRecordingTransport();
  let forwarded = null;
  let authCalls = 0;
  page.injectedWindow = {
    __phantomStreamHandleControl(type, payload) {
      forwarded = { type, payload };
      return { ok: true };
    },
  };
  page.injectedDocument = { body: {} };

  const adapter = createPlaywrightAdapter({
    page,
    transport,
    authorizeControl: async () => {
      authCalls += 1;
      return true;
    },
  });
  await adapter.install();

  const payload = {
    requestId: 'subtree-1',
    nid: '42',
    streamSessionId: 'stream-current',
    snapshotId: 7,
    reason: 'missing-truncated-node',
    ignoredExtra: 'not-forwarded',
  };
  transport.emit(CONTROL.SUBTREE_REQUEST, payload);
  await tick();

  assert.equal(authCalls, 0, 'subtree requests do not route through remote-control authorization');
  assert.deepEqual(forwarded, {
    type: CONTROL.SUBTREE_REQUEST,
    payload: {
      requestId: 'subtree-1',
      nid: '42',
      streamSessionId: 'stream-current',
      snapshotId: 7,
      reason: 'missing-truncated-node',
    },
  });
  assert.deepEqual(page.evaluateArgs[0], forwarded);

  const bridge = page.bindings.get('__phantomStreamBridge');
  const token = installedBridgeToken(page);
  const response = {
    requestId: 'subtree-1',
    nid: '42',
    status: 'ok',
    html: '<section>Recovered</section>',
    nodeIds: ['42'],
    shadowRoots: [],
    frames: [],
    streamSessionId: 'stream-current',
    snapshotId: 7,
  };
  const result = await bridge(
    { page, frame: page.mainFrameValue },
    { token, type: STREAM.SUBTREE_RESPONSE, payload: response }
  );

  assert.deepEqual(result, { ok: true });
  assert.ok(transport.sent.some((entry) => entry.type === STREAM.SUBTREE_RESPONSE
    && entry.payload.requestId === 'subtree-1'
    && entry.payload.status === 'ok'));
});

test('transport remote-control handler contains async driver replay failures', async () => {
  const page = createFakePage();
  const transport = createRecordingTransport();
  const errors = [];
  page.mouse.click = async function () {
    throw new Error('driver-replay-failed');
  };

  const adapter = createPlaywrightAdapter({
    page,
    transport,
    authorizeControl: async () => true,
    logger: {
      info() {},
      warn() {},
      error(message, detail) {
        errors.push({ message, detail });
      },
    },
  });
  await adapter.install();
  await adapter.requestControl({ requestId: 'ok' });

  transport.emit(REMOTE_CONTROL.CLICK, { x: 1, y: 2, button: 'left' });
  await tick();
  await tick();

  assert.equal(errors.length, 1);
  assert.equal(errors[0].detail.reason, 'control-message-failed');
  assert.equal(adapter.getControlState().state, REMOTE_CONTROL_STATE.ACTIVE);
  assert.ok(transport.sent.some((entry) => entry.type === REMOTE_CONTROL.STATE
    && entry.payload.reason === 'control-dispatch-failed'));
});

test('adapter source avoids DOM synthetic event replay APIs', async () => {
  const source = await readFile(new URL('../src/adapters/playwright.js', import.meta.url), 'utf8');
  const inject = getPlaywrightInjectSource();
  const combined = source + '\n' + inject;

  assert.doesNotMatch(combined, /\.dispatchEvent\(/);
  assert.doesNotMatch(combined, /new MouseEvent/);
  assert.doesNotMatch(combined, /new KeyboardEvent/);
  assert.doesNotMatch(combined, /element\.click/);
  assert.doesNotMatch(combined, /document\.querySelector\(.*\)\.click/);
});

// --- Opt-in manifest discovery (MADPT-02, Plan 14-04) -----------------------

// Build a synthetic Playwright Response. headers() returns a lowercased map
// (Playwright contract); request().frame() exposes the initiator frame.
function fakeResponse(url, contentType, frame) {
  const headers = {};
  if (typeof contentType === 'string') headers['content-type'] = contentType;
  return {
    url() { return url; },
    headers() { return headers; },
    request() { return { frame() { return frame || null; } }; },
  };
}

function lastHint(transport) {
  const hints = transport.sent.filter((entry) => entry.type === STREAM.MEDIA_HINT);
  return hints.length ? hints[hints.length - 1].payload : null;
}

test('discovery off by default: no response listener and no media hint', async () => {
  const page = createFakePage();
  const transport = createRecordingTransport();
  const adapter = createPlaywrightAdapter({ page, transport });
  await adapter.install();

  // The existing framenavigated/load listeners are present; 'response' is NOT.
  assert.ok(page.calls.some((call) => call.method === 'on' && call.event === 'framenavigated'));
  assert.equal(page.calls.some((call) => call.method === 'on' && call.event === 'response'), false);

  // Even if a manifest response is somehow emitted, nothing is sent.
  page.emit('response', fakeResponse('https://cdn.test/master.m3u8', 'application/vnd.apple.mpegurl'));
  await tick();
  assert.equal(transport.sent.some((entry) => entry.type === STREAM.MEDIA_HINT), false);
});

test('opt-in .m3u8 response emits a page-scope HLS media hint', async () => {
  const page = createFakePage();
  const transport = createRecordingTransport();
  const adapter = createPlaywrightAdapter({ page, transport, discoverManifests: true });
  await adapter.install();

  assert.ok(page.calls.some((call) => call.method === 'on' && call.event === 'response'),
    'opt-in registers a response listener via addPageListener');

  page.emit('response', fakeResponse('https://cdn.test/live/master.m3u8?token=abc'));
  await tick();

  const hint = lastHint(transport);
  assert.ok(hint, 'opt-in .m3u8 response emits STREAM.MEDIA_HINT');
  assert.equal(hint.kind, 'hls');
  assert.equal(hint.manifestUrl, 'https://cdn.test/live/master.m3u8?token=abc');
  assert.equal(hint.scope, 'page');
  assert.equal(Object.prototype.hasOwnProperty.call(hint, 'nid'), false);
  // Identity stamps default to the empty/zero stream identity when unseen.
  assert.equal(typeof hint.streamSessionId, 'string');
  assert.equal(typeof hint.snapshotId, 'number');
});

test('opt-in extensionless dash+xml content-type emits a DASH hint', async () => {
  const page = createFakePage();
  const transport = createRecordingTransport();
  const adapter = createPlaywrightAdapter({ page, transport, discoverManifests: true });
  await adapter.install();

  page.emit('response', fakeResponse('https://cdn.test/signed/stream', 'application/dash+xml; charset=utf-8'));
  await tick();

  const hint = lastHint(transport);
  assert.ok(hint, 'dash content-type emits a hint even without a .mpd extension');
  assert.equal(hint.kind, 'dash');
  assert.equal(hint.manifestUrl, 'https://cdn.test/signed/stream');
  assert.equal(hint.contentType, 'application/dash+xml; charset=utf-8');
});

test('opt-in non-manifest responses emit no hint', async () => {
  const page = createFakePage();
  const transport = createRecordingTransport();
  const adapter = createPlaywrightAdapter({ page, transport, discoverManifests: true });
  await adapter.install();

  page.emit('response', fakeResponse('https://cdn.test/clip.mp4', 'video/mp4'));
  page.emit('response', fakeResponse('https://cdn.test/poster.jpg', 'image/jpeg'));
  page.emit('response', fakeResponse('https://cdn.test/app.js', 'application/javascript'));
  await tick();

  assert.equal(transport.sent.some((entry) => entry.type === STREAM.MEDIA_HINT), false);
});

test('opt-in single-active correlation yields an element-scope hint with the nid', async () => {
  const page = createFakePage();
  const transport = createRecordingTransport();
  let activeNid = null;
  const adapter = createPlaywrightAdapter({
    page,
    transport,
    discoverManifests: true,
    resolveActiveMediaNid: () => activeNid,
  });
  await adapter.install();

  // Ambiguous (no single active element) -> page scope.
  page.emit('response', fakeResponse('https://cdn.test/a.m3u8'));
  await tick();
  let hint = lastHint(transport);
  assert.equal(hint.scope, 'page');
  assert.equal(Object.prototype.hasOwnProperty.call(hint, 'nid'), false);

  // A single active opaque element is signalled -> element scope with the nid.
  activeNid = '57';
  page.emit('response', fakeResponse('https://cdn.test/b.m3u8'));
  await tick();
  hint = lastHint(transport);
  assert.equal(hint.scope, 'element');
  assert.equal(hint.nid, '57');
});

test('opt-in hint carries the most recently forwarded stream identity', async () => {
  const page = createFakePage();
  const transport = createRecordingTransport();
  const adapter = createPlaywrightAdapter({ page, transport, discoverManifests: true });
  await adapter.install();

  // The adapter forwards a SNAPSHOT through the bridge, which carries identity.
  const bridge = page.bindings.get('__phantomStreamBridge');
  const token = installedBridgeToken(page);
  await bridge(
    { page, frame: page.mainFrameValue },
    { token, type: STREAM.SNAPSHOT, payload: { streamSessionId: 'stream_live_1', snapshotId: 909 } }
  );

  page.emit('response', fakeResponse('https://cdn.test/master.m3u8'));
  await tick();

  const hint = lastHint(transport);
  assert.equal(hint.streamSessionId, 'stream_live_1');
  assert.equal(hint.snapshotId, 909);
});

test('opt-in ignores a manifest response from a cross-origin sub-frame (main-frame scope, parity with bindingCallback)', async () => {
  const page = createFakePage();
  const transport = createRecordingTransport();
  const adapter = createPlaywrightAdapter({ page, transport, discoverManifests: true });
  await adapter.install();

  // A response initiated by a child frame must NOT produce a hint -- a sub-frame
  // (e.g. an ad iframe) cannot steer the top page's player.
  page.emit('response', fakeResponse('https://evil.test/sub/master.m3u8', undefined, page.childFrameValue));
  await tick();
  assert.equal(transport.sent.some((entry) => entry.type === STREAM.MEDIA_HINT), false,
    'a sub-frame manifest response is dropped');

  // The same manifest from the main frame IS observed (scope is main-frame, not
  // origin -- the viewer re-gate remains the origin defense).
  page.emit('response', fakeResponse('https://cdn.test/main/master.m3u8', undefined, page.mainFrameValue));
  await tick();
  const hint = lastHint(transport);
  assert.ok(hint, 'a main-frame manifest response is observed');
  assert.equal(hint.manifestUrl, 'https://cdn.test/main/master.m3u8');

  // Frame info absent -> degrade to accept (a minimal mock / older Playwright).
  page.emit('response', fakeResponse('https://cdn.test/nf/master.m3u8'));
  await tick();
  assert.equal(lastHint(transport).manifestUrl, 'https://cdn.test/nf/master.m3u8',
    'no frame info -> accept (degrade to the prior behavior)');
});

test('opt-in is graceful when the page cannot register listeners', async () => {
  const page = createFakePage();
  page.on = undefined; // addPageListener returns early when page.on is absent
  const transport = createRecordingTransport();
  const adapter = createPlaywrightAdapter({ page, transport, discoverManifests: true });

  // Install must not throw, and no hint can be emitted (no listener attached).
  await adapter.install();
  assert.equal(transport.sent.some((entry) => entry.type === STREAM.MEDIA_HINT), false);
});
