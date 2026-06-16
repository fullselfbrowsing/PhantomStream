import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import WebSocket from 'ws';
import { createRelay } from '../src/relay/relay.js';
import { RELAY_PER_MESSAGE_LIMIT_BYTES } from '../src/protocol/index.js';
import { createWebSocketRelayBackend } from '../src/relay/backends/ws.js';

function silentLogger() {
  return { info() {}, warn() {}, error() {} };
}

async function startHarness() {
  const server = createServer((req, res) => {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('not found');
  });
  const relay = createRelay({ now: () => 1000, logger: silentLogger() });
  const backend = createWebSocketRelayBackend({ server, relay, logger: silentLogger() });

  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address();
  return {
    server,
    relay,
    backend,
    baseUrl: 'ws://127.0.0.1:' + address.port,
    async close() {
      await backend.close();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

async function openWebSocket(url) {
  const socket = new WebSocket(url, { perMessageDeflate: false });
  await new Promise((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
  return socket;
}

async function closeWebSocket(socket) {
  if (!socket || socket.readyState === WebSocket.CLOSED) return;
  await new Promise((resolve) => {
    socket.once('close', resolve);
    socket.close();
  });
}

async function observeRejected(url) {
  const socket = new WebSocket(url, { perMessageDeflate: false });
  return await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.terminate();
      reject(new Error('websocket-rejection-timeout'));
    }, 500);
    let opened = false;

    socket.once('open', () => {
      opened = true;
    });
    socket.once('error', (err) => {
      clearTimeout(timer);
      resolve({ opened, error: err });
    });
    socket.once('close', (code, reason) => {
      clearTimeout(timer);
      resolve({ opened, code, reason: reason.toString() });
    });
  });
}

function nextMessage(socket) {
  return new Promise((resolve) => {
    socket.once('message', (data) => {
      resolve(data.toString());
    });
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test('backend rejects non-/ws paths, missing room, and invalid roles', async () => {
  const harness = await startHarness();
  try {
    const badPath = await observeRejected(
      harness.baseUrl + '/bad?room=room-a&role=source'
    );
    const missingRoom = await observeRejected(
      harness.baseUrl + '/ws?role=source'
    );
    const invalidRole = await observeRejected(
      harness.baseUrl + '/ws?room=room-a&role=admin'
    );

    assert.equal(badPath.opened, false);
    assert.equal(missingRoom.opened, true);
    assert.equal(missingRoom.code, 1008);
    assert.equal(invalidRole.opened, true);
    assert.equal(invalidRole.code, 1008);
    assert.equal(harness.relay.getRoomSnapshot().roomCount, 0);
  } finally {
    await harness.close();
  }
});

test('source and viewer clients exchange raw JSON through the relay', async () => {
  const harness = await startHarness();
  const room = 'room-exchange';
  let source;
  let viewer;
  try {
    source = await openWebSocket(harness.baseUrl + '/ws?room=' + room + '&role=source');
    viewer = await openWebSocket(harness.baseUrl + '/ws?room=' + room + '&role=viewer');
    const raw = JSON.stringify({ type: 'ext:dom-snapshot', payload: { html: '<div>live</div>' } });
    const received = nextMessage(viewer);

    source.send(raw);

    assert.equal(await received, raw);
  } finally {
    await closeWebSocket(source);
    await closeWebSocket(viewer);
    await harness.close();
  }
});

test('same-role clients do not receive each other frames', async () => {
  const harness = await startHarness();
  const room = 'room-same-role';
  let sourceA;
  let sourceB;
  try {
    sourceA = await openWebSocket(harness.baseUrl + '/ws?room=' + room + '&role=source');
    sourceB = await openWebSocket(harness.baseUrl + '/ws?room=' + room + '&role=source');
    const receivedByPeer = [];
    sourceB.on('message', (data) => receivedByPeer.push(data.toString()));

    sourceA.send(JSON.stringify({ type: 'ext:dom-mutations', payload: { ops: [] } }));
    await delay(50);

    assert.deepEqual(receivedByPeer, []);
  } finally {
    await closeWebSocket(sourceA);
    await closeWebSocket(sourceB);
    await harness.close();
  }
});

test('ping receives a local pong and is not relayed', async () => {
  const harness = await startHarness();
  const room = 'room-ping';
  let source;
  let viewer;
  try {
    source = await openWebSocket(harness.baseUrl + '/ws?room=' + room + '&role=source');
    viewer = await openWebSocket(harness.baseUrl + '/ws?room=' + room + '&role=viewer');
    const viewerMessages = [];
    viewer.on('message', (data) => viewerMessages.push(data.toString()));
    const pong = nextMessage(source);

    source.send(JSON.stringify({ type: 'ping', ts: 1 }));

    const response = JSON.parse(await pong);
    assert.equal(response.type, 'pong');
    assert.equal(typeof response.ts, 'number');
    await delay(50);
    assert.deepEqual(viewerMessages, []);
  } finally {
    await closeWebSocket(source);
    await closeWebSocket(viewer);
    await harness.close();
  }
});

test('oversize backend frames are not delivered and record relay diagnostics', async () => {
  const harness = await startHarness();
  const room = 'room-ws-limit';
  let source;
  let viewer;
  try {
    source = await openWebSocket(harness.baseUrl + '/ws?room=' + room + '&role=source');
    viewer = await openWebSocket(harness.baseUrl + '/ws?room=' + room + '&role=viewer');
    const viewerMessages = [];
    viewer.on('message', (data) => viewerMessages.push(data.toString()));

    source.send('x'.repeat(RELAY_PER_MESSAGE_LIMIT_BYTES + 1));
    await delay(50);

    const diagnostics = harness.relay.getDiagnostics(room);
    assert.deepEqual(viewerMessages, []);
    assert.ok(diagnostics.events.some((event) => event.event === 'message-too-large'));
  } finally {
    await closeWebSocket(source);
    await closeWebSocket(viewer);
    await harness.close();
  }
});

test('backend disables permessage-deflate and caps ws payloads near relay limit', async () => {
  const harness = await startHarness();
  try {
    assert.equal(harness.backend.wss.options.perMessageDeflate, false);
    assert.equal(harness.backend.options.perMessageDeflate, false);
    assert.ok(harness.backend.wss.options.maxPayload >= RELAY_PER_MESSAGE_LIMIT_BYTES);
    assert.ok(harness.backend.wss.options.maxPayload <= RELAY_PER_MESSAGE_LIMIT_BYTES + 1024);
  } finally {
    await harness.close();
  }
});
