// Viewer lifecycle/health event tests for createViewer (Phase 04 VIEW-02).
//
// The setup helper is deliberately duplicated locally, matching
// tests/renderer-viewer.test.js. This file imports nothing from a shared
// harness so parallel plan execution stays isolated.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM, VirtualConsole } from 'jsdom';
import { createViewer } from '../src/renderer/index.js';
import { STREAM, DIFF_OP, NID_ATTR } from '../src/protocol/messages.js';

function setupEnv() {
  const dom = new JSDOM(
    '<!DOCTYPE html><html><head><title>viewer fixture</title></head><body>'
      + '<div id="host"></div></body></html>',
    {
      url: 'https://fixture.test/page',
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
  const messageHandlers = new Set();
  const statusHandlers = new Set();
  const api = {
    sent: [],
    send(type, payload) {
      api.sent.push({ type, payload });
    },
    onMessage(handler) {
      messageHandlers.add(handler);
      return function unsubscribe() {
        messageHandlers.delete(handler);
      };
    },
    emitMessage(type, payload) {
      messageHandlers.forEach((handler) => handler(type, payload));
    },
    onStatus(handler) {
      statusHandlers.add(handler);
      return function unsubscribe() {
        statusHandlers.delete(handler);
      };
    },
    emitStatus(status) {
      statusHandlers.forEach((handler) => handler(status));
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
      html: '<div ' + NID_ATTR + '="1">hello</div>',
      stylesheets: [],
      inlineStyles: [],
      htmlAttrs: {},
      bodyAttrs: {},
      htmlStyle: '',
      bodyStyle: '',
      scrollX: 0,
      scrollY: 0,
      viewportWidth: 1920,
      viewportHeight: 1080,
      streamSessionId: 'stream_a_b',
      snapshotId: 111,
    },
    overrides || {}
  );
}

function bogusMutationBatch(identity) {
  return Object.assign(
    {
      mutations: [
        { op: DIFF_OP.ADD, parentNid: 424242, html: '<div>orphan</div>' },
      ],
    },
    identity || {}
  );
}

async function waitForStreaming(iframe) {
  for (let i = 0; i < 200; i++) {
    if (iframe.style.display !== 'none') return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('viewer never reached streaming');
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("viewer.on('state') immediately reports connecting and validates event names", () => {
  const env = setupEnv();
  try {
    const transport = createRecordingTransport();
    env.viewer = createViewer({
      container: env.container,
      transport,
      logger: silentLogger(),
      disconnectDelayMs: 5,
    });

    const states = [];
    const unsubscribe = env.viewer.on('state', (event) => states.push(event));

    assert.equal(typeof unsubscribe, 'function');
    assert.equal(states.length, 1, 'current state delivered immediately');
    assert.equal(states[0].state, 'connecting');
    assert.equal(typeof states[0].ts, 'number');
    assert.throws(
      () => env.viewer.on('bogus', () => {}),
      /viewer-event-unsupported/,
      'unsupported event names fail at subscription time'
    );
  } finally {
    env.teardown();
  }
});

test('accepted snapshot transitions lifecycle state from connecting to live', () => {
  const env = setupEnv();
  try {
    const transport = createRecordingTransport();
    env.viewer = createViewer({
      container: env.container,
      transport,
      logger: silentLogger(),
    });

    const states = [];
    env.viewer.on('state', (event) => states.push(event.state));
    transport.emitMessage(STREAM.SNAPSHOT, snapshotPayload());

    assert.deepEqual(states, ['connecting', 'live']);
  } finally {
    env.teardown();
  }
});

test('stale mutation misses emit stale while retaining the last frame', async () => {
  const env = setupEnv();
  try {
    const transport = createRecordingTransport();
    env.viewer = createViewer({
      container: env.container,
      transport,
      logger: silentLogger(),
    });

    const states = [];
    env.viewer.on('state', (event) => states.push(event.state));
    const payload = snapshotPayload();
    transport.emitMessage(STREAM.SNAPSHOT, payload);
    const iframe = env.container.querySelector('iframe');
    await waitForStreaming(iframe);
    const before = iframe.getAttribute('srcdoc');

    const identity = {
      streamSessionId: payload.streamSessionId,
      snapshotId: payload.snapshotId,
    };
    for (let i = 0; i < 3; i++) {
      transport.emitMessage(STREAM.MUTATIONS, bogusMutationBatch(identity));
    }

    assert.ok(states.includes('stale'), 'requestResync transitions public state to stale');
    assert.equal(iframe.getAttribute('srcdoc'), before, 'last frame remains visible');
  } finally {
    env.teardown();
  }
});

test('transport close status transitions stale then disconnected after delay', async () => {
  const env = setupEnv();
  try {
    const transport = createRecordingTransport();
    env.viewer = createViewer({
      container: env.container,
      transport,
      logger: silentLogger(),
      disconnectDelayMs: 10,
    });

    const states = [];
    env.viewer.on('state', (event) => states.push(event.state));
    transport.emitMessage(STREAM.SNAPSHOT, snapshotPayload());
    transport.emitStatus({ state: 'closed', readyState: 3, lastCloseAt: 1234 });

    assert.equal(states.at(-1), 'stale', 'closed is immediately stale');
    await delay(25);
    assert.equal(states.at(-1), 'disconnected', 'closed beyond delay is disconnected');
  } finally {
    env.teardown();
  }
});

test('state unsubscribe stops later lifecycle delivery', async () => {
  const env = setupEnv();
  try {
    const transport = createRecordingTransport();
    env.viewer = createViewer({
      container: env.container,
      transport,
      logger: silentLogger(),
      disconnectDelayMs: 5,
    });

    const states = [];
    const unsubscribe = env.viewer.on('state', (event) => states.push(event.state));
    unsubscribe();

    transport.emitMessage(STREAM.SNAPSHOT, snapshotPayload());
    transport.emitStatus({ state: 'closed', readyState: 3 });
    await delay(15);

    assert.deepEqual(states, ['connecting']);
  } finally {
    env.teardown();
  }
});

test('STREAM.STATE valid payloads map into the public lifecycle surface', () => {
  const env = setupEnv();
  try {
    const transport = createRecordingTransport();
    env.viewer = createViewer({
      container: env.container,
      transport,
      logger: silentLogger(),
    });

    const states = [];
    env.viewer.on('state', (event) => states.push(event));
    transport.emitMessage(STREAM.STATE, { state: 'stale', reason: 'relay-watchdog' });

    assert.equal(states.at(-1).state, 'stale');
    assert.equal(states.at(-1).reason, 'relay-watchdog');
  } finally {
    env.teardown();
  }
});
