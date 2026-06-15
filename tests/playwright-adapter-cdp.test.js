import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createPlaywrightAdapter,
  getPlaywrightInjectSource,
} from '../src/adapters/playwright.js';
import { REMOTE_CONTROL } from '../src/protocol/index.js';

function createRecordingTransport() {
  return {
    sent: [],
    send(type, payload) {
      this.sent.push({ type, payload });
    },
  };
}

function createFakePage() {
  const calls = [];
  const listeners = new Map();
  const mainFrame = { name: 'main' };
  const page = {
    calls,
    bindings: new Map(),
    mouse: {
      async click() {},
      async move() {},
      async wheel() {},
    },
    keyboard: {
      async insertText() {},
      async down() {},
      async up() {},
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
    async evaluate() {},
  };
  return page;
}

function createFakeCDPSession() {
  return {
    sent: [],
    async send(method, params) {
      this.sent.push({ method, params: params || {} });
      return {};
    },
  };
}

test('CDP install registers the same new-document inject artifact', async () => {
  const page = createFakePage();
  const cdpSession = createFakeCDPSession();
  const adapter = createPlaywrightAdapter({
    page,
    transport: createRecordingTransport(),
    cdpSession,
  });

  await adapter.install();

  assert.equal(page.calls[0].method, 'exposeBinding');
  assert.equal(page.calls[1].method, 'addInitScript');
  assert.deepEqual(cdpSession.sent[0], {
    method: 'Page.addScriptToEvaluateOnNewDocument',
    params: { source: getPlaywrightInjectSource() },
  });
});

test('CDP mode replays approved input through Input domain methods', async () => {
  const page = createFakePage();
  const cdpSession = createFakeCDPSession();
  const adapter = createPlaywrightAdapter({
    page,
    transport: createRecordingTransport(),
    cdpSession,
    authorizeControl: async () => true,
  });
  await adapter.install();
  await adapter.requestControl({ requestId: 'cdp-ok' });

  await adapter.handleControlMessage(REMOTE_CONTROL.CLICK, { x: 12, y: 34, button: 'left' });
  await adapter.handleControlMessage(REMOTE_CONTROL.TEXT, { text: 'hello' });
  await adapter.handleControlMessage(REMOTE_CONTROL.KEY, { key: 'Enter', event: 'down' });
  await adapter.handleControlMessage(REMOTE_CONTROL.KEY, { key: 'Enter', event: 'up' });
  await adapter.handleControlMessage(REMOTE_CONTROL.SCROLL, { x: 12, y: 34, deltaX: 1, deltaY: 2 });

  const methods = cdpSession.sent.map((entry) => entry.method);
  assert.ok(methods.includes('Input.dispatchMouseEvent'));
  assert.ok(methods.includes('Input.insertText'));
  assert.ok(methods.includes('Input.dispatchKeyEvent'));
  assert.ok(
    cdpSession.sent.some((entry) => entry.method === 'Input.dispatchMouseEvent'
      && entry.params.type === 'mouseWheel'
      && entry.params.deltaX === 1
      && entry.params.deltaY === 2)
  );
});
