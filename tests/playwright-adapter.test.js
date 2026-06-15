import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

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
    async evaluate(fnOrString) {
      page.evaluateCalls.push(fnOrString);
      if (typeof fnOrString !== 'function') return undefined;
      const previousWindow = globalThis.window;
      const previousDocument = globalThis.document;
      globalThis.window = page.injectedWindow || {};
      globalThis.document = page.injectedDocument || { body: {} };
      try {
        return fnOrString();
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
  assert.equal(page.calls[1].content, getPlaywrightInjectSource());
  assert.ok(page.calls.some((call) => call.method === 'on' && call.event === 'framenavigated'));
});

test('inject source is a single classic script with the capture bridge hooks', () => {
  const source = getPlaywrightInjectSource();

  assert.equal(source.includes('import '), false);
  assert.equal(source.includes('export '), false);
  assert.match(source, /window\.top !== window/);
  assert.match(source, /window\.__phantomStreamBridge/);
  assert.match(source, /window\.__phantomStreamStart/);
  assert.match(source, /createCapture/);
});

test('binding forwards only main-frame bridge messages to transport', async () => {
  const page = createFakePage();
  const transport = createRecordingTransport();
  const adapter = createPlaywrightAdapter({ page, transport });
  await adapter.install();

  const bridge = page.bindings.get('__phantomStreamBridge');
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
    { type: STREAM.SNAPSHOT, payload: { snapshotId: 7 } }
  );
  assert.deepEqual(main, { ok: true });
  assert.deepEqual(transport.sent, [
    { type: STREAM.SNAPSHOT, payload: { snapshotId: 7 } },
  ]);
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
