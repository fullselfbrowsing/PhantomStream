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
