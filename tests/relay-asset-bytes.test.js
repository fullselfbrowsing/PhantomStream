// SC#1 proof: no image bytes traverse the relay.
//
// The relay forwards frames byte-verbatim (src/relay/relay.js sendToTargets ->
// target.send(options.raw)) and classifies by type only (checkRelayFrameLimit
// never parses the payload, never fetches). A STREAM.SNAPSHOT carrying absolute
// https <img> URL *strings* must therefore arrive at the viewer byte-identical:
// the wire carries URLs, never the image bytes. This test pins that guarantee so
// any future relay change that fetches, rewrites, or re-encodes asset URLs fails
// loudly. Flat node:test style (no jsdom -- the relay is pure transport logic),
// modeled on tests/relay-core.test.js's fakeSocket harness.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRelay } from '../src/relay/index.js';
import { STREAM } from '../src/protocol/messages.js';

/**
 * Minimal relay client that records every raw frame forwarded to it, matching
 * the WebSocket-like contract the relay expects ({ readyState, bufferedAmount,
 * send }). Mirrors tests/relay-core.test.js's fakeSocket.
 * @param {string} name
 */
function fakeSocket(name) {
  return {
    name,
    readyState: 1,
    bufferedAmount: 0,
    sent: [],
    send(raw) {
      this.sent.push(raw);
    },
  };
}

// A snapshot frame whose payload references images purely by absolute https URL
// (the by-reference contract: no inline image bytes, just strings on the wire).
const ASSET_SNAPSHOT_RAW = JSON.stringify({
  type: STREAM.SNAPSHOT,
  payload: {
    html: '<main>'
      + '<img data-fsb-nid="1" src="https://cdn.fixture.test/img/logo-512.png">'
      + '<img data-fsb-nid="2" src="https://cdn.fixture.test/img/photo-800.png"'
      + ' srcset="https://cdn.fixture.test/img/photo-1600.png 1600w">'
      + '<video data-fsb-nid="3" poster="https://cdn.fixture.test/video/poster-1280.jpg"></video>'
      + '</main>',
    stylesheets: [],
    inlineStyles: [],
    streamSessionId: 'stream_assetbytes_1',
    snapshotId: 1718870000000,
  },
});

test('a snapshot carrying image URLs is forwarded receive->send byte-for-byte', () => {
  const relay = createRelay({ now: () => 1000 });
  const source = fakeSocket('source');
  const viewer = fakeSocket('viewer');

  relay.addClient({ roomId: 'room-assets', role: 'source', socket: source });
  relay.addClient({ roomId: 'room-assets', role: 'viewer', socket: viewer });

  const result = relay.receive({
    roomId: 'room-assets',
    role: 'source',
    socket: source,
    raw: ASSET_SNAPSHOT_RAW,
  });

  // Exactly one frame was forwarded to the viewer, and it === the received raw.
  assert.equal(viewer.sent.length, 1, 'viewer received exactly one frame');
  assert.equal(
    viewer.sent[0],
    ASSET_SNAPSHOT_RAW,
    'forwarded raw frame is byte-identical to the received raw frame'
  );
  // Byte-length identity is the literal SC#1 statement: no image bytes added or
  // removed at the relay (it never fetches the referenced URLs).
  assert.equal(
    Buffer.byteLength(viewer.sent[0], 'utf8'),
    Buffer.byteLength(ASSET_SNAPSHOT_RAW, 'utf8'),
    'no bytes added or removed crossing the relay'
  );
  assert.equal(result.deliveredCount, 1);
  assert.equal(result.droppedCount, 0);
  // The source side is never echoed its own frame.
  assert.deepEqual(source.sent, []);
});

test('the relay does not parse or rewrite asset URLs in the payload', () => {
  const relay = createRelay({ now: () => 1000 });
  const source = fakeSocket('source');
  const viewer = fakeSocket('viewer');

  relay.addClient({ roomId: 'room-noparse', role: 'source', socket: source });
  relay.addClient({ roomId: 'room-noparse', role: 'viewer', socket: viewer });

  relay.receive({
    roomId: 'room-noparse',
    role: 'source',
    socket: source,
    raw: ASSET_SNAPSHOT_RAW,
  });

  const forwarded = viewer.sent[0];
  // Each absolute URL the frame arrived with is present, unmodified, in the
  // forwarded frame -- the relay neither absolutifies, masks, nor proxies them.
  for (const url of [
    'https://cdn.fixture.test/img/logo-512.png',
    'https://cdn.fixture.test/img/photo-800.png',
    'https://cdn.fixture.test/img/photo-1600.png 1600w',
    'https://cdn.fixture.test/video/poster-1280.jpg',
  ]) {
    assert.ok(
      forwarded.indexOf(url) !== -1,
      'forwarded frame still contains the original URL substring: ' + url
    );
  }
  // And nothing that looks like inlined image bytes was introduced (defensive:
  // the relay must never turn a referenced URL into a data: payload).
  assert.ok(
    forwarded === ASSET_SNAPSHOT_RAW,
    'forwarded frame is verbatim -- no payload transformation occurred'
  );
});
