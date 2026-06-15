import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BACKPRESSURE_BUFFER_LIMIT_BYTES,
  checkRelayFrameLimit,
  classifyRelayFrame,
  createRelay,
} from '../src/relay/index.js';
import { RELAY_PER_MESSAGE_LIMIT_BYTES } from '../src/protocol/index.js';

function fakeSocket(name, opts = {}) {
  return {
    name,
    readyState: opts.readyState ?? 1,
    bufferedAmount: opts.bufferedAmount ?? 0,
    sent: [],
    send(raw) {
      this.sent.push(raw);
    },
  };
}

function eventOf(diagnostics, eventName) {
  return diagnostics.events.find((entry) => entry.event === eventName);
}

test('source frames fan out byte-identically to viewers in the same room only', () => {
  const relay = createRelay({ now: () => 1000 });
  const source = fakeSocket('source');
  const sourcePeer = fakeSocket('source-peer');
  const viewerA = fakeSocket('viewer-a');
  const viewerB = fakeSocket('viewer-b');
  const otherViewer = fakeSocket('other-viewer');
  const raw = JSON.stringify({
    type: 'ext:dom-snapshot',
    payload: { html: '<main>same bytes</main>' },
  });

  relay.addClient({ roomId: 'room-a', role: 'source', socket: source });
  relay.addClient({ roomId: 'room-a', role: 'source', socket: sourcePeer });
  relay.addClient({ roomId: 'room-a', role: 'viewer', socket: viewerA });
  relay.addClient({ roomId: 'room-a', role: 'viewer', socket: viewerB });
  relay.addClient({ roomId: 'room-b', role: 'viewer', socket: otherViewer });

  const result = relay.receive({ roomId: 'room-a', role: 'source', socket: source, raw });

  assert.deepEqual(viewerA.sent, [raw]);
  assert.deepEqual(viewerB.sent, [raw]);
  assert.deepEqual(source.sent, []);
  assert.deepEqual(sourcePeer.sent, []);
  assert.deepEqual(otherViewer.sent, []);
  assert.equal(result.deliveredCount, 2);
  assert.equal(result.droppedCount, 0);
});

test('viewer control frames fan out byte-identically to sources in the same room only', () => {
  const relay = createRelay({ now: () => 1000 });
  const viewer = fakeSocket('viewer');
  const viewerPeer = fakeSocket('viewer-peer');
  const sourceA = fakeSocket('source-a');
  const sourceB = fakeSocket('source-b');
  const otherSource = fakeSocket('other-source');
  const raw = JSON.stringify({ type: 'dash:dom-stream-start', payload: { reason: 'test' } });

  relay.addClient({ roomId: 'room-a', role: 'viewer', socket: viewer });
  relay.addClient({ roomId: 'room-a', role: 'viewer', socket: viewerPeer });
  relay.addClient({ roomId: 'room-a', role: 'source', socket: sourceA });
  relay.addClient({ roomId: 'room-a', role: 'source', socket: sourceB });
  relay.addClient({ roomId: 'room-b', role: 'source', socket: otherSource });

  const result = relay.receive({ roomId: 'room-a', role: 'viewer', socket: viewer, raw });

  assert.deepEqual(sourceA.sent, [raw]);
  assert.deepEqual(sourceB.sent, [raw]);
  assert.deepEqual(viewer.sent, []);
  assert.deepEqual(viewerPeer.sent, []);
  assert.deepEqual(otherSource.sent, []);
  assert.equal(result.deliveredCount, 2);
  assert.equal(result.droppedCount, 0);
});

test('malformed JSON classifies as unknown and relays when inside the cap', () => {
  const relay = createRelay({ now: () => 1000 });
  const source = fakeSocket('source');
  const viewer = fakeSocket('viewer');
  const raw = '{"type":';

  relay.addClient({ roomId: 'room-json', role: 'source', socket: source });
  relay.addClient({ roomId: 'room-json', role: 'viewer', socket: viewer });

  assert.deepEqual(classifyRelayFrame(raw), {
    type: 'unknown',
    compressed: false,
    parseError: 'json-parse-failed',
  });

  const result = relay.receive({ roomId: 'room-json', role: 'source', socket: source, raw });

  assert.deepEqual(viewer.sent, [raw]);
  assert.equal(result.deliveredCount, 1);
  assert.equal(relay.getDiagnostics('room-json').receivedByType.unknown, 1);
});

test('compressed envelope markers classify without relay-side decompression', () => {
  assert.deepEqual(classifyRelayFrame(JSON.stringify({ _lz: true, d: 'abc' })), {
    type: 'compressed-envelope',
    compressed: true,
    parseError: null,
  });
  assert.deepEqual(classifyRelayFrame(JSON.stringify({ _ps: 'deflate-raw', d: 'abc' })), {
    type: 'compressed-envelope',
    compressed: true,
    parseError: null,
  });
});

test('oversize frames are rejected before delivery with structured diagnostics', () => {
  const relay = createRelay({ now: () => 1000 });
  const source = fakeSocket('source');
  const viewer = fakeSocket('viewer');
  const raw = 'x'.repeat(RELAY_PER_MESSAGE_LIMIT_BYTES + 1);

  relay.addClient({ roomId: 'room-limit', role: 'source', socket: source });
  relay.addClient({ roomId: 'room-limit', role: 'viewer', socket: viewer });

  const limit = checkRelayFrameLimit(raw, { roomId: 'room-limit', role: 'source' });
  assert.equal(limit.ok, false);
  assert.equal(limit.error, 'message-too-large');
  assert.equal(limit.byteSize, RELAY_PER_MESSAGE_LIMIT_BYTES + 1);

  const result = relay.receive({ roomId: 'room-limit', role: 'source', socket: source, raw });
  const diagnostics = relay.getDiagnostics('room-limit');
  const event = eventOf(diagnostics, 'message-too-large');

  assert.deepEqual(viewer.sent, []);
  assert.equal(result.ok, false);
  assert.equal(result.error, 'message-too-large');
  assert.equal(event.roomPrefix, 'room-lim');
  assert.equal(event.role, 'source');
  assert.equal(event.type, 'unknown');
  assert.equal(event.byteSize, RELAY_PER_MESSAGE_LIMIT_BYTES + 1);
  assert.equal(event.capBytes, RELAY_PER_MESSAGE_LIMIT_BYTES);
  assert.equal(event.compressed, false);
});

test('backpressure drops only wedged targets and records diagnostics', () => {
  const relay = createRelay({ now: () => 1000 });
  const source = fakeSocket('source');
  const healthyViewer = fakeSocket('healthy-viewer');
  const wedgedViewer = fakeSocket('wedged-viewer', {
    bufferedAmount: BACKPRESSURE_BUFFER_LIMIT_BYTES + 1,
  });
  const raw = JSON.stringify({ type: 'ext:dom-mutations', payload: { ops: [] } });

  relay.addClient({ roomId: 'room-pressure', role: 'source', socket: source });
  relay.addClient({ roomId: 'room-pressure', role: 'viewer', socket: healthyViewer });
  relay.addClient({ roomId: 'room-pressure', role: 'viewer', socket: wedgedViewer });

  const result = relay.receive({ roomId: 'room-pressure', role: 'source', socket: source, raw });
  const diagnostics = relay.getDiagnostics('room-pressure');
  const event = eventOf(diagnostics, 'backpressure-drop');

  assert.deepEqual(healthyViewer.sent, [raw]);
  assert.deepEqual(wedgedViewer.sent, []);
  assert.equal(result.deliveredCount, 1);
  assert.equal(result.droppedCount, 1);
  assert.equal(event.type, 'ext:dom-mutations');
  assert.equal(event.bufferedAmount, BACKPRESSURE_BUFFER_LIMIT_BYTES + 1);
  assert.equal(event.limitBytes, BACKPRESSURE_BUFFER_LIMIT_BYTES);
  assert.equal(diagnostics.droppedByType['ext:dom-mutations'], 1);
});

test('removing the final source or viewer removes the empty room', () => {
  const relay = createRelay({ now: () => 1000 });
  const source = fakeSocket('source');
  const viewer = fakeSocket('viewer');

  relay.addClient({ roomId: 'room-cleanup', role: 'source', socket: source });
  relay.addClient({ roomId: 'room-cleanup', role: 'viewer', socket: viewer });
  assert.equal(relay.getRoomSnapshot().rooms.length, 1);

  relay.removeClient({ roomId: 'room-cleanup', socket: source });
  assert.deepEqual(relay.getRoomSnapshot().rooms, [
    { roomId: 'room-cleanup', sourceCount: 0, viewerCount: 1 },
  ]);

  relay.removeClient({ roomId: 'room-cleanup', socket: viewer });
  assert.equal(relay.getRoomSnapshot().rooms.length, 0);
});
