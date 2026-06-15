import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  encodeWireMessage,
  decodeWireMessage,
} from '../src/transport/websocket.js';

const fakeLz = {
  compressToBase64: (s) => Buffer.from(s, 'utf8').toString('base64'),
  decompressFromBase64: (s) => Buffer.from(s, 'base64').toString('utf8'),
};

function utf8Codec() {
  return {
    async compress(raw) {
      return new TextEncoder().encode(raw);
    },
    async decompress(bytes) {
      return new TextDecoder().decode(bytes);
    }
  };
}

test('package exports the WebSocket transport subpath', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.exports['./transport/websocket'], './src/transport/websocket.js');
});

test('plain JSON frames decode without any codec object', async () => {
  const msg = { type: 'ext:dom-ready', payload: { tabId: 7 }, ts: 123 };
  const out = await decodeWireMessage(JSON.stringify(msg));
  assert.equal(out.ok, true);
  assert.deepEqual(out.msg, msg);
});

test('legacy _lz frames decode with injected codec and fail loud without it', async () => {
  const msg = { type: 'ext:dom-scroll', payload: { scrollX: 1, scrollY: 2 }, ts: 124 };
  const wire = JSON.stringify({ _lz: true, d: fakeLz.compressToBase64(JSON.stringify(msg)) });

  const decoded = await decodeWireMessage(wire, { lz: fakeLz });
  assert.equal(decoded.ok, true);
  assert.deepEqual(decoded.msg, msg);

  const missing = await decodeWireMessage(wire);
  assert.deepEqual(missing, { ok: false, error: 'decompress-unavailable' });
});

test('native deflate envelope round-trips through injected codec', async () => {
  const msg = { type: 'ext:dom-snapshot', payload: { html: '<main>hello</main>' }, ts: 125 };
  const wire = await encodeWireMessage(msg, {
    codec: utf8Codec(),
    compressionThresholdBytes: 0
  });

  const envelope = JSON.parse(wire);
  assert.equal(envelope._ps, 'deflate-raw');
  assert.equal(typeof envelope.d, 'string');

  const decoded = await decodeWireMessage(wire, { codec: utf8Codec() });
  assert.equal(decoded.ok, true);
  assert.deepEqual(decoded.msg, msg);
});

test('small messages below compressionThresholdBytes stay plain JSON', async () => {
  const msg = { type: 'ext:dom-scroll', payload: { scrollX: 0, scrollY: 10 }, ts: 126 };
  const wire = await encodeWireMessage(msg, {
    codec: utf8Codec(),
    compressionThresholdBytes: 1024
  });

  assert.deepEqual(JSON.parse(wire), msg);
});

test('malformed and unsupported envelopes return structured errors', async () => {
  const malformed = await decodeWireMessage('{not-json');
  assert.deepEqual(malformed, { ok: false, error: 'json-parse-failed' });

  const unsupported = await decodeWireMessage(JSON.stringify({ _ps: 'other', d: 'abc' }));
  assert.deepEqual(unsupported, { ok: false, error: 'unsupported-envelope' });

  const badBase64 = await decodeWireMessage(JSON.stringify({ _ps: 'deflate-raw', d: '@@@' }), {
    codec: utf8Codec()
  });
  assert.deepEqual(badBase64, { ok: false, error: 'base64-decode-failed' });

  const badNative = await decodeWireMessage(JSON.stringify({
    _ps: 'deflate-raw',
    d: Buffer.from('not-json', 'utf8').toString('base64')
  }), {
    codec: {
      async decompress() {
        throw new Error('inflate failed');
      }
    }
  });
  assert.deepEqual(badNative, { ok: false, error: 'native-deflate-failed' });
});

test('ordinary JSON objects with no envelope marker decode as plain messages', async () => {
  const msg = { type: 'custom', payload: { ok: true }, ts: 127 };
  const decoded = await decodeWireMessage(JSON.stringify(msg));
  assert.equal(decoded.ok, true);
  assert.deepEqual(decoded.msg, msg);
});

test('native compression fallback records a status diagnostic', async () => {
  const statuses = [];
  const msg = { type: 'ext:dom-snapshot', payload: { html: '<p>' + 'x'.repeat(2000) + '</p>' }, ts: 128 };
  const wire = await encodeWireMessage(msg, {
    CompressionStream: null,
    compressionThresholdBytes: 0,
    onStatus(status) {
      statuses.push(status);
    }
  });

  assert.deepEqual(JSON.parse(wire), msg);
  assert.ok(statuses.some((status) => status.reason === 'native-deflate-unavailable'));
});
