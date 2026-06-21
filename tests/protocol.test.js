import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  encodeEnvelope,
  decodeEnvelope,
  isCompressedEnvelope,
  isCurrentStream,
  createStreamSessionId,
  CONTROL,
  STREAM,
  DIFF_OP,
  SNAPSHOT_BUDGET_BYTES,
  RELAY_PER_MESSAGE_LIMIT_BYTES,
  MEDIA_SYNC_THROTTLE_MS,
} from '../src/protocol/index.js';

// Minimal LZ-compatible codec for tests (reversible, not actually compressing).
const fakeLz = {
  compressToBase64: (s) => Buffer.from(s, 'utf8').toString('base64'),
  decompressFromBase64: (s) => Buffer.from(s, 'base64').toString('utf8'),
};

test('envelope round-trips a compressed message', () => {
  const msg = { type: 'ext:dom-snapshot', payload: { html: '<div>hi</div>', snapshotId: 7 } };
  const wire = encodeEnvelope(msg, fakeLz);
  assert.ok(isCompressedEnvelope(JSON.parse(wire)));
  const out = decodeEnvelope(wire, fakeLz);
  assert.equal(out.ok, true);
  assert.deepEqual(out.msg, msg);
});

test('small payloads below threshold stay plain JSON', () => {
  const msg = { type: 'ext:dom-scroll', payload: { scrollX: 0, scrollY: 10 } };
  const wire = encodeEnvelope(msg, fakeLz, 1024);
  assert.equal(isCompressedEnvelope(JSON.parse(wire)), false);
  const out = decodeEnvelope(wire, fakeLz);
  assert.equal(out.ok, true);
  assert.deepEqual(out.msg, msg);
});

test('plain messages decode without a codec (backward compat)', () => {
  const out = decodeEnvelope(JSON.stringify({ type: 'ext:dom-ready' }));
  assert.equal(out.ok, true);
  assert.equal(out.msg.type, 'ext:dom-ready');
});

test('compressed envelope without a codec fails loud, not silent', () => {
  const wire = encodeEnvelope({ type: 'x' }, fakeLz);
  const out = decodeEnvelope(wire);
  assert.equal(out.ok, false);
  assert.equal(out.error, 'decompress-unavailable');
});

test('corrupt envelopes report decompress-failed', () => {
  const out = decodeEnvelope(JSON.stringify({ _lz: true, d: '!!!' }), {
    compressToBase64: fakeLz.compressToBase64,
    decompressFromBase64: () => null,
  });
  assert.equal(out.ok, false);
  assert.equal(out.error, 'decompress-failed');
});

test('staleness guard rejects mismatched stream identity', () => {
  const active = { streamSessionId: 'stream_a_1', snapshotId: 100 };
  assert.equal(isCurrentStream({ streamSessionId: 'stream_a_1', snapshotId: 100 }, active), true);
  assert.equal(isCurrentStream({ streamSessionId: 'stream_b_2', snapshotId: 100 }, active), false);
  assert.equal(isCurrentStream({ streamSessionId: 'stream_a_1', snapshotId: 99 }, active), false);
  // No identity on the message -> accepted (pre-identity senders)
  assert.equal(isCurrentStream({}, active), true);
});

test('session ids are deterministic given entropy', () => {
  assert.equal(createStreamSessionId(1000000, 'abc123'), 'stream_lfls_abc123');
});

test('snapshot budget stays inside the relay cap with headroom', () => {
  assert.ok(SNAPSHOT_BUDGET_BYTES < RELAY_PER_MESSAGE_LIMIT_BYTES);
  assert.equal(SNAPSHOT_BUDGET_BYTES, Math.floor(RELAY_PER_MESSAGE_LIMIT_BYTES * 0.8));
});

test('Phase 8 protocol constants are exported for fidelity sidecars and recovery', () => {
  assert.equal(DIFF_OP.VALUE, 'value');
  assert.equal(DIFF_OP.SHADOW_ROOT, 'shadow-root');
  assert.equal(DIFF_OP.FRAME, 'frame');
  assert.equal(CONTROL.SUBTREE_REQUEST, 'dash:ps-subtree-request');
  assert.equal(STREAM.SUBTREE_RESPONSE, 'ext:ps-subtree-response');
});

test('Phase 9 protocol constants and typedefs are exported for CSSOM style sources', () => {
  assert.equal(DIFF_OP.STYLE_SOURCE, 'style-source');
  const source = readFileSync(
    fileURLToPath(new URL('../src/protocol/messages.js', import.meta.url)),
    'utf8'
  );
  for (const typedef of ['StyleScope', 'StyleSource', 'StyleStrategy', 'StyleSourceDiffOp']) {
    assert.match(source, new RegExp('@typedef \\{Object\\} ' + typedef));
  }
  assert.match(source, /styleSources/);
  assert.match(source, /styleStrategy/);
});

test('Phase 13 STREAM.MEDIA op is exported in the ext:dom-* namespace and collision-free', () => {
  // MWIRE-01: one new op string for the throttled media side channel.
  assert.equal(typeof STREAM.MEDIA, 'string');
  assert.match(STREAM.MEDIA, /^ext:dom-/);
  // Assumption A2: distinct from every other STREAM value (no FSB envelope collision).
  const values = Object.values(STREAM);
  const occurrences = values.filter((v) => v === STREAM.MEDIA).length;
  assert.equal(occurrences, 1, 'STREAM.MEDIA must not collide with another STREAM op');
});

test('Phase 13 MEDIA_SYNC_THROTTLE_MS is exported and is 250', () => {
  // MWIRE-01: heartbeat cadence constant, twin of SCROLL_THROTTLE_MS.
  assert.equal(MEDIA_SYNC_THROTTLE_MS, 250);
});

test('Phase 13 media typedefs are present in messages.js', () => {
  const source = readFileSync(
    fileURLToPath(new URL('../src/protocol/messages.js', import.meta.url)),
    'utf8'
  );
  assert.match(source, /@typedef \{Object\} MediaBaselineEntry/);
  assert.match(source, /@typedef \{Object\} MediaSyncPayload/);
});

test('Phase 13 STREAM.MEDIA round-trips raw through the envelope with no special-casing', () => {
  // MWIRE-01: envelope/relay byte-unchanged; the new type is just more JSON.
  const msg = {
    type: STREAM.MEDIA,
    payload: {
      nid: 'n42',
      event: 'play',
      currentTime: 12.5,
      paused: false,
      muted: true,
      volume: 1,
      playbackRate: 1,
      loop: false,
      ended: false,
      duration: 300,
      sentAt: 1700000000000,
      streamSessionId: 'stream_a_1',
      snapshotId: 100,
    },
  };
  // Plain (below threshold): decodes identically.
  const plainWire = encodeEnvelope(msg, fakeLz, 1 << 20);
  assert.equal(isCompressedEnvelope(JSON.parse(plainWire)), false);
  const plainOut = decodeEnvelope(plainWire, fakeLz);
  assert.equal(plainOut.ok, true);
  assert.deepEqual(plainOut.msg, msg);
  // Compressed (forced): decodes identically.
  const lzWire = encodeEnvelope(msg, fakeLz);
  assert.ok(isCompressedEnvelope(JSON.parse(lzWire)));
  const lzOut = decodeEnvelope(lzWire, fakeLz);
  assert.equal(lzOut.ok, true);
  assert.deepEqual(lzOut.msg, msg);
});

test('Phase 13 a near-cap STREAM.MEDIA payload survives the envelope (1 MiB-cap contract intact)', () => {
  // A payload just under RELAY_PER_MESSAGE_LIMIT_BYTES round-trips without truncation;
  // the envelope does not enforce or alter the cap (relay-side concern, untouched here).
  const big = 'x'.repeat(RELAY_PER_MESSAGE_LIMIT_BYTES - 4096);
  const msg = {
    type: STREAM.MEDIA,
    payload: { nid: 'n1', event: 'timeupdate', currentTime: 1, sentAt: 1, blob: big },
  };
  const wire = encodeEnvelope(msg, fakeLz, 1 << 20); // plain, no compression
  const out = decodeEnvelope(wire, fakeLz);
  assert.equal(out.ok, true);
  assert.equal(out.msg.payload.blob.length, RELAY_PER_MESSAGE_LIMIT_BYTES - 4096);
  assert.deepEqual(out.msg, msg);
});
