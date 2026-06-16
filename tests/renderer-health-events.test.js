// Viewer lifecycle/health event tests for createViewer (Phase 04 VIEW-02).
//
// The setup helper is deliberately duplicated locally, matching
// tests/renderer-viewer.test.js. This file imports nothing from a shared
// harness so parallel plan execution stays isolated.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM, VirtualConsole } from 'jsdom';
import { createViewer } from '../src/renderer/index.js';
import { STREAM, CONTROL, DIFF_OP } from '../src/protocol/messages.js';

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
      html: '<div>hello</div>',
      nodeIds: ['1'],
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

function glueMirror(iframe) {
  const cd = iframe.contentDocument;
  cd.open();
  cd.write(iframe.getAttribute('srcdoc'));
  cd.close();
  iframe.dispatchEvent(new iframe.ownerDocument.defaultView.Event('load'));
  return cd;
}

function assertNoMirroredKeys(value) {
  const blocked = new Set(['html', 'text', 'payload', 'url', 'title']);
  const seen = [];

  function walk(node) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    Object.keys(node).forEach((key) => {
      if (blocked.has(key)) seen.push(key);
      walk(node[key]);
    });
  }

  JSON.parse(JSON.stringify(value));
  walk(value);
  assert.deepEqual(seen, [], 'health object contains no mirrored content keys');
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

test("viewer.on('health') immediately reports content-free counters", () => {
  const env = setupEnv();
  try {
    const transport = createRecordingTransport();
    env.viewer = createViewer({
      container: env.container,
      transport,
      logger: silentLogger(),
    });

    const health = [];
    const unsubscribe = env.viewer.on('health', (event) => health.push(event));

    assert.equal(typeof unsubscribe, 'function');
    assert.equal(health.length, 1, 'current health delivered immediately');
    assert.equal(health[0].state, 'connecting');
    assert.deepEqual(health[0].receivedByType, {});
    assert.deepEqual(health[0].sentByType, {});
    assert.equal(health[0].staleMisses, 0);
    assert.equal(health[0].applyFailures, 0);
    assert.equal(health[0].resyncPending, false);
    assertNoMirroredKeys(health[0]);
  } finally {
    env.teardown();
  }
});

test('health updates after frames, sends, sanitizer movement, failures, and transport status', async () => {
  const env = setupEnv();
  try {
    const transport = createRecordingTransport();
    env.viewer = createViewer({
      container: env.container,
      transport,
      logger: silentLogger(),
      disconnectDelayMs: 5,
    });

    const health = [];
    env.viewer.on('health', (event) => health.push(event));
    const snapshot = snapshotPayload({
      html: '<div><span>secret text</span></div>',
      nodeIds: ['1', '2'],
      url: 'https://private.example/account',
      title: 'Private title',
    });
    transport.emitMessage(STREAM.SNAPSHOT, snapshot);
    const iframe = env.container.querySelector('iframe');
    await waitForStreaming(iframe);
    glueMirror(iframe);

    transport.emitMessage(STREAM.MUTATIONS, {
      streamSessionId: snapshot.streamSessionId,
      snapshotId: snapshot.snapshotId,
      mutations: [
        {
          op: DIFF_OP.ATTR,
          nid: 1,
          attr: 'href',
          val: 'javascript:alert(1)',
        },
      ],
    });
    transport.emitMessage(STREAM.SCROLL, {
      scrollX: 10,
      scrollY: 20,
      streamSessionId: snapshot.streamSessionId,
      snapshotId: snapshot.snapshotId,
    });
    transport.emitMessage(STREAM.OVERLAY, {
      glow: { state: 'active', nid: 1 },
      streamSessionId: snapshot.streamSessionId,
      snapshotId: snapshot.snapshotId,
    });
    transport.emitMessage(STREAM.DIALOG, {
      dialog: { state: 'open', type: 'alert', message: 'hidden dialog text' },
    });

    transport.emitMessage(STREAM.MUTATIONS, {
      streamSessionId: snapshot.streamSessionId,
      snapshotId: snapshot.snapshotId,
      mutations: [
        {
          op: DIFF_OP.ATTR,
          nid: 1,
          attr: 'bad attr',
          val: 'x',
        },
      ],
    });

    const identity = {
      streamSessionId: snapshot.streamSessionId,
      snapshotId: snapshot.snapshotId,
    };
    for (let i = 0; i < 3; i++) {
      transport.emitMessage(STREAM.MUTATIONS, bogusMutationBatch(identity));
    }

    transport.emitStatus({
      state: 'error',
      reason: 'websocket-error',
      readyState: 3,
      bufferedAmount: 321,
      drops: 2,
      errors: [{ code: 'websocket-error', ts: 999 }],
      lastCloseAt: 777,
    });

    const latest = health.at(-1);
    assert.equal(latest.state, 'stale');
    assert.equal(typeof latest.lastFrameAt, 'number');
    assert.equal(typeof latest.lastSnapshotAt, 'number');
    assert.equal(typeof latest.lastMutationAt, 'number');
    assert.ok(latest.lastFrameAt >= latest.lastSnapshotAt);
    assert.equal(latest.receivedByType[STREAM.SNAPSHOT], 1);
    assert.ok(latest.receivedByType[STREAM.MUTATIONS] >= 5);
    assert.equal(latest.receivedByType[STREAM.SCROLL], 1);
    assert.equal(latest.receivedByType[STREAM.OVERLAY], 1);
    assert.equal(latest.receivedByType[STREAM.DIALOG], 1);
    assert.equal(latest.sentByType[CONTROL.START], 1);
    assert.ok(latest.staleMisses >= 3);
    assert.ok(latest.applyFailures >= 1);
    assert.equal(latest.resyncPending, true);
    assert.ok(latest.sanitizer.blockedUrls >= 1);
    assert.equal(latest.transport.readyState, 3);
    assert.equal(latest.transport.bufferedAmount, 321);
    assert.equal(latest.transport.drops, 2);
    assert.equal(latest.transport.errors[0].code, 'websocket-error');
    assertNoMirroredKeys(latest);

    const json = JSON.stringify(latest);
    assert.equal(json.includes('secret text'), false);
    assert.equal(json.includes('https://private.example/account'), false);
    assert.equal(json.includes('Private title'), false);
    assert.equal(json.includes('hidden dialog text'), false);
    assert.equal(json.includes('javascript:alert'), false);
  } finally {
    env.teardown();
  }
});

test('health unsubscribe stops later delivery', () => {
  const env = setupEnv();
  try {
    const transport = createRecordingTransport();
    env.viewer = createViewer({
      container: env.container,
      transport,
      logger: silentLogger(),
    });

    const health = [];
    const unsubscribe = env.viewer.on('health', (event) => health.push(event));
    unsubscribe();

    transport.emitMessage(STREAM.SNAPSHOT, snapshotPayload());
    transport.emitStatus({ state: 'closed', readyState: 3, drops: 1 });

    assert.equal(health.length, 1, 'only the immediate health event was delivered');
  } finally {
    env.teardown();
  }
});
