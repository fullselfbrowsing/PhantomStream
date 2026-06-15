import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createPlaywrightAdapter } from '../src/adapters/playwright.js';
import { REMOTE_CONTROL, REMOTE_CONTROL_STATE } from '../src/protocol/index.js';

function createRecordingTransport() {
  return {
    sent: [],
    send(type, payload) {
      this.sent.push({ type, payload });
    },
  };
}

function createFakePage() {
  const mainFrame = { name: 'main' };
  const page = {
    bindings: new Map(),
    events: new Map(),
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
      page.bindings.set(name, fn);
    },
    async addInitScript() {},
    mainFrame() {
      return mainFrame;
    },
    on(event, handler) {
      const list = page.events.get(event) || [];
      list.push(handler);
      page.events.set(event, list);
    },
    async evaluate() {},
  };
  return page;
}

function dispatchCount(page) {
  return page.mouse.clicks.length
    + page.mouse.moves.length
    + page.mouse.wheels.length
    + page.keyboard.inserted.length
    + page.keyboard.downs.length
    + page.keyboard.ups.length;
}

function stateEvents(transport) {
  return transport.sent.filter((entry) => entry.type === REMOTE_CONTROL.STATE);
}

test('control requests are default-deny and denied actions dispatch zero driver input', async () => {
  const page = createFakePage();
  const transport = createRecordingTransport();
  const adapter = createPlaywrightAdapter({ page, transport });

  await adapter.requestControl({ requestId: 'default-deny' });
  await adapter.handleControlMessage(REMOTE_CONTROL.CLICK, { x: 10, y: 20 });

  const states = stateEvents(transport).map((entry) => entry.payload);
  assert.ok(states.some((state) => state.state === REMOTE_CONTROL_STATE.DENIED
    && state.reason === 'authorization-denied'));
  assert.equal(adapter.getControlState().state, REMOTE_CONTROL_STATE.DENIED);
  assert.equal(dispatchCount(page), 0);
});

test('approved click text key and scroll actions use Playwright native APIs', async () => {
  const page = createFakePage();
  const transport = createRecordingTransport();
  const adapter = createPlaywrightAdapter({
    page,
    transport,
    authorizeControl: async ({ requestId, source, authorizationMode }) => {
      assert.equal(requestId, 'approve-me');
      assert.equal(source, 'viewer');
      assert.equal(authorizationMode, 'host');
      return true;
    },
  });

  await adapter.requestControl({ requestId: 'approve-me', authorizationMode: 'host' });
  assert.equal(adapter.getControlState().state, REMOTE_CONTROL_STATE.ACTIVE);

  await adapter.handleControlMessage(REMOTE_CONTROL.CLICK, { x: 15, y: 25, button: 'right', clickCount: 2 });
  await adapter.handleControlMessage(REMOTE_CONTROL.TEXT, { text: 'typed words' });
  await adapter.handleControlMessage(REMOTE_CONTROL.KEY, { key: 'Enter', event: 'down' });
  await adapter.handleControlMessage(REMOTE_CONTROL.KEY, { key: 'Enter', event: 'up' });
  await adapter.handleControlMessage(REMOTE_CONTROL.SCROLL, { x: 15, y: 25, deltaX: 3, deltaY: 4 });

  assert.deepEqual(page.mouse.clicks, [
    { x: 15, y: 25, options: { button: 'right', clickCount: 2 } },
  ]);
  assert.deepEqual(page.keyboard.inserted, ['typed words']);
  assert.deepEqual(page.keyboard.downs, ['Enter']);
  assert.deepEqual(page.keyboard.ups, ['Enter']);
  assert.deepEqual(page.mouse.wheels, [{ deltaX: 3, deltaY: 4 }]);
  assert.ok(stateEvents(transport).some((entry) => entry.payload.state === REMOTE_CONTROL_STATE.ACTIVE));
});

test('stop locks the adapter and later actions remain inert', async () => {
  const page = createFakePage();
  const transport = createRecordingTransport();
  const adapter = createPlaywrightAdapter({
    page,
    transport,
    authorizeControl: async () => true,
  });

  await adapter.handleControlMessage(REMOTE_CONTROL.REQUEST, { requestId: 'start' });
  await adapter.handleControlMessage(REMOTE_CONTROL.CLICK, { x: 1, y: 2 });
  assert.equal(dispatchCount(page), 1);

  await adapter.handleControlMessage(REMOTE_CONTROL.STOP, { reason: 'viewer-stop' });
  assert.equal(adapter.getControlState().state, REMOTE_CONTROL_STATE.STOPPED);

  await adapter.handleControlMessage(REMOTE_CONTROL.TEXT, { text: 'blocked' });
  assert.equal(dispatchCount(page), 1);
  assert.ok(stateEvents(transport).some((entry) => entry.payload.state === REMOTE_CONTROL_STATE.STOPPED));
  assert.ok(stateEvents(transport).some((entry) => entry.payload.reason === 'control-inactive'));
});
