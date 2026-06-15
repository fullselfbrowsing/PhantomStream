import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  createWebSocketTransport,
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

function tick() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function createFakeWebSocketClass() {
  return class FakeWebSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;
    static instances = [];

    constructor(url) {
      this.url = url;
      this.readyState = FakeWebSocket.CONNECTING;
      this.bufferedAmount = 0;
      this.sent = [];
      this.closed = false;
      this.listeners = {
        open: new Set(),
        message: new Set(),
        error: new Set(),
        close: new Set(),
      };
      FakeWebSocket.instances.push(this);
    }

    addEventListener(type, handler) {
      this.listeners[type].add(handler);
    }

    removeEventListener(type, handler) {
      this.listeners[type].delete(handler);
    }

    send(raw) {
      this.sent.push(raw);
    }

    close(code, reason) {
      this.closed = true;
      this.readyState = FakeWebSocket.CLOSED;
      this.emit('close', { code: code || 1000, reason: reason || '' });
    }

    emit(type, event) {
      this.listeners[type].forEach((handler) => handler(event || {}));
    }

    open() {
      this.readyState = FakeWebSocket.OPEN;
      this.emit('open', {});
    }

    message(data) {
      this.emit('message', { data });
    }

    error(error) {
      this.emit('error', { error });
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

test('native CompressionStream deflate-raw path drains without deadlocking', async () => {
  if (typeof CompressionStream !== 'function' || typeof DecompressionStream !== 'function') return;

  const msg = {
    type: 'ext:dom-snapshot',
    payload: { html: '<main>' + 'native-stream '.repeat(2000) + '</main>' },
    ts: 125
  };
  const timed = (promise) => Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('native-stream-timeout')), 1000))
  ]);

  const wire = await timed(encodeWireMessage(msg, { compressionThresholdBytes: 0 }));
  const envelope = JSON.parse(wire);
  assert.equal(envelope._ps, 'deflate-raw');

  const decoded = await timed(decodeWireMessage(wire));
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

test('send is fire-and-forget and returns undefined', () => {
  const FakeWebSocket = createFakeWebSocketClass();
  const transport = createWebSocketTransport({
    url: 'ws://example.test/ws',
    WebSocket: FakeWebSocket,
    codec: utf8Codec(),
    compressionThresholdBytes: 0
  });
  FakeWebSocket.instances[0].open();

  assert.equal(transport.send('ext:a', { html: '<secret>' }), undefined);
});

test('async encoding preserves FIFO send order', async () => {
  const FakeWebSocket = createFakeWebSocketClass();
  const codec = {
    async compress(raw) {
      if (JSON.parse(raw).type === 'ext:b') {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      return new TextEncoder().encode(raw);
    },
    async decompress(bytes) {
      return new TextDecoder().decode(bytes);
    }
  };
  const transport = createWebSocketTransport({
    url: 'ws://example.test/ws',
    WebSocket: FakeWebSocket,
    codec,
    compressionThresholdBytes: 0
  });
  const ws = FakeWebSocket.instances[0];
  ws.open();

  transport.send('ext:a', { n: 1 });
  transport.send('ext:b', { n: 2 });
  transport.send('ext:c', { n: 3 });
  await transport.flush();

  const decoded = await Promise.all(ws.sent.map((raw) => decodeWireMessage(raw, { codec })));
  assert.deepEqual(decoded.map((result) => result.msg.type), ['ext:a', 'ext:b', 'ext:c']);
});

test('flush resolves only after queued sends are on the socket', async () => {
  const FakeWebSocket = createFakeWebSocketClass();
  let release;
  const codec = {
    async compress(raw) {
      await new Promise((resolve) => { release = resolve; });
      return new TextEncoder().encode(raw);
    },
    async decompress(bytes) {
      return new TextDecoder().decode(bytes);
    }
  };
  const transport = createWebSocketTransport({
    url: 'ws://example.test/ws',
    WebSocket: FakeWebSocket,
    codec,
    compressionThresholdBytes: 0
  });
  const ws = FakeWebSocket.instances[0];
  ws.open();

  transport.send('ext:slow', { n: 1 });
  let flushed = false;
  const flushPromise = transport.flush().then(() => { flushed = true; });
  await tick();
  assert.equal(flushed, false);
  assert.equal(ws.sent.length, 0);

  release();
  await flushPromise;
  assert.equal(flushed, true);
  assert.equal(ws.sent.length, 1);
});

test('inbound plain native and legacy frames fan out to subscribers', async () => {
  const FakeWebSocket = createFakeWebSocketClass();
  const transport = createWebSocketTransport({
    url: 'ws://example.test/ws',
    WebSocket: FakeWebSocket,
    codec: utf8Codec(),
    lz: fakeLz,
    compressionThresholdBytes: 0
  });
  const ws = FakeWebSocket.instances[0];
  const first = [];
  const second = [];
  const unsubscribe = transport.onMessage((type, payload) => first.push({ type, payload }));
  transport.onMessage((type, payload) => second.push({ type, payload }));

  ws.message(JSON.stringify({ type: 'ext:plain', payload: { a: 1 }, ts: 1 }));
  await tick();
  unsubscribe();
  ws.message(await encodeWireMessage({ type: 'ext:native', payload: { b: 2 }, ts: 2 }, {
    codec: utf8Codec(),
    compressionThresholdBytes: 0
  }));
  ws.message(JSON.stringify({
    _lz: true,
    d: fakeLz.compressToBase64(JSON.stringify({ type: 'ext:legacy', payload: { c: 3 }, ts: 3 }))
  }));
  await tick();

  assert.deepEqual(first, [{ type: 'ext:plain', payload: { a: 1 } }]);
  assert.deepEqual(second.map((entry) => entry.type), ['ext:plain', 'ext:native', 'ext:legacy']);
  assert.deepEqual(second.map((entry) => entry.payload), [{ a: 1 }, { b: 2 }, { c: 3 }]);
});

test('browser MessageEvent data getters are decoded', async () => {
  const FakeWebSocket = createFakeWebSocketClass();
  const transport = createWebSocketTransport({
    url: 'ws://example.test/ws',
    WebSocket: FakeWebSocket
  });
  const ws = FakeWebSocket.instances[0];
  const received = [];
  transport.onMessage((type, payload) => received.push({ type, payload }));

  const event = Object.create({
    get data() {
      return JSON.stringify({ type: 'ext:dom-mutations', payload: { ok: true }, ts: 10 });
    }
  });
  ws.emit('message', event);
  await tick();

  assert.deepEqual(received, [{ type: 'ext:dom-mutations', payload: { ok: true } }]);
  assert.equal(transport.getHealth().errors.length, 0);
});

test('status subscribers receive lifecycle states and unsubscribe', () => {
  const FakeWebSocket = createFakeWebSocketClass();
  const transport = createWebSocketTransport({
    url: 'ws://example.test/ws',
    WebSocket: FakeWebSocket
  });
  const ws = FakeWebSocket.instances[0];
  const states = [];
  const unsubscribe = transport.onStatus((status) => states.push(status.state));

  ws.open();
  ws.error(new Error('boom'));
  ws.close(1006, 'down');
  unsubscribe();
  ws.open();

  assert.deepEqual(states, ['connecting', 'open', 'error', 'closed']);
});

test('health counters omit mirrored content fields', async () => {
  const FakeWebSocket = createFakeWebSocketClass();
  let now = 1000;
  const transport = createWebSocketTransport({
    url: 'ws://example.test/ws',
    WebSocket: FakeWebSocket,
    codec: utf8Codec(),
    compressionThresholdBytes: 0,
    now() {
      now += 1;
      return now;
    }
  });
  const ws = FakeWebSocket.instances[0];
  ws.bufferedAmount = 42;
  ws.open();

  transport.send('ext:dom-snapshot', {
    html: '<main>secret</main>',
    text: 'secret',
    payload: 'secret',
    url: 'https://secret.test',
    title: 'secret'
  });
  await transport.flush();
  ws.message(JSON.stringify({ type: 'ext:dom-mutations', payload: { html: '<p>secret</p>' }, ts: 9 }));
  await tick();

  const health = transport.getHealth();
  assert.equal(health.sentByType['ext:dom-snapshot'], 1);
  assert.equal(health.receivedByType['ext:dom-mutations'], 1);
  assert.equal(health.lastSendAt > 0, true);
  assert.equal(health.lastReceiveAt > 0, true);
  assert.equal(health.bufferedAmount, 42);
  assert.equal(typeof health.drops, 'number');
  assert.ok(Array.isArray(health.errors));

  const serialized = JSON.stringify(health);
  for (const key of ['html', 'text', 'payload', 'url', 'title']) {
    assert.equal(serialized.includes(key), false);
  }
});
