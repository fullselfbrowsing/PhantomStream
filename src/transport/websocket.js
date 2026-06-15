// PhantomStream browser WebSocket transport codec helpers.
//
// Endpoint-owned envelopes keep the relay raw and stateless. Small frames
// remain plain JSON; larger frames can use native deflate-raw envelopes
// `{ _ps: 'deflate-raw', d: '<base64>' }`; inbound legacy FSB `{ _lz, d }`
// decode remains supported through an injected LZ-compatible codec.

import { decodeEnvelope } from '../protocol/envelope.js';

var NATIVE_DEFLATE_MARKER = 'deflate-raw';
var DEFAULT_COMPRESSION_THRESHOLD_BYTES = 1024;

function defaultNow() {
  return Date.now();
}

function byteLength(s) {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(s).byteLength;
  }
  if (typeof Buffer !== 'undefined') {
    return Buffer.byteLength(s, 'utf8');
  }
  return String(s).length;
}

function stringToBytes(s) {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(s);
  }
  var out = new Uint8Array(String(s).length);
  for (var i = 0; i < out.length; i++) out[i] = String(s).charCodeAt(i) & 0xff;
  return out;
}

function bytesToString(bytes) {
  if (typeof TextDecoder !== 'undefined') {
    return new TextDecoder().decode(bytes);
  }
  var out = '';
  for (var i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i]);
  return out;
}

function toUint8Array(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  if (typeof value === 'string') return stringToBytes(value);
  return null;
}

function bytesToBase64(bytes) {
  var data = toUint8Array(bytes);
  if (!data) return null;
  var binary = '';
  var chunkSize = 0x8000;
  for (var i = 0; i < data.length; i += chunkSize) {
    var chunk = data.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, Array.from(chunk));
  }
  if (typeof btoa === 'function') return btoa(binary);
  if (typeof Buffer !== 'undefined') return Buffer.from(binary, 'binary').toString('base64');
  return null;
}

function base64ToBytes(base64) {
  if (typeof base64 !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)
      || base64.length % 4 === 1) {
    return null;
  }
  try {
    var binary;
    if (typeof atob === 'function') {
      binary = atob(base64);
    } else if (typeof Buffer !== 'undefined') {
      return new Uint8Array(Buffer.from(base64, 'base64'));
    } else {
      return null;
    }
    var out = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  } catch (e) {
    return null;
  }
}

function getCtor(options, name) {
  if (Object.prototype.hasOwnProperty.call(options, name)) return options[name];
  return typeof globalThis !== 'undefined' ? globalThis[name] : undefined;
}

async function readAllBytes(readable) {
  var reader = readable.getReader();
  var chunks = [];
  var total = 0;
  for (;;) {
    var result = await reader.read();
    if (result.done) break;
    var chunk = toUint8Array(result.value);
    if (!chunk) continue;
    chunks.push(chunk);
    total += chunk.byteLength;
  }
  var out = new Uint8Array(total);
  var offset = 0;
  for (var i = 0; i < chunks.length; i++) {
    out.set(chunks[i], offset);
    offset += chunks[i].byteLength;
  }
  return out;
}

function emitDiagnostic(options, reason, details) {
  var now = typeof options.now === 'function' ? options.now : defaultNow;
  var status = Object.assign({
    state: 'error',
    reason: reason,
    ts: now()
  }, details || {});
  if (typeof options.onStatus === 'function') {
    try {
      options.onStatus(status);
    } catch (e) { /* status handlers are advisory */ }
  }
  var logger = options.logger || null;
  if (logger && typeof logger.warn === 'function') {
    try {
      logger.warn('[Transport] ' + reason, status);
    } catch (e) { /* logging must not affect transport */ }
  }
  return status;
}

function hasCodecCompress(codec) {
  return codec && typeof codec.compress === 'function';
}

function hasCodecDecompress(codec) {
  return codec && typeof codec.decompress === 'function';
}

async function nativeCompress(raw, options) {
  var codec = options.codec || null;
  if (hasCodecCompress(codec)) {
    return toUint8Array(await codec.compress(raw));
  }

  var CompressionStreamCtor = getCtor(options, 'CompressionStream');
  if (typeof CompressionStreamCtor !== 'function') return null;

  var stream = new CompressionStreamCtor(NATIVE_DEFLATE_MARKER);
  var readPromise = readAllBytes(stream.readable);
  var writer = stream.writable.getWriter();
  await writer.write(stringToBytes(raw));
  await writer.close();
  return await readPromise;
}

async function nativeDecompress(bytes, options) {
  var codec = options.codec || null;
  if (hasCodecDecompress(codec)) {
    return await codec.decompress(bytes);
  }

  var DecompressionStreamCtor = getCtor(options, 'DecompressionStream');
  if (typeof DecompressionStreamCtor !== 'function') return null;

  var stream = new DecompressionStreamCtor(NATIVE_DEFLATE_MARKER);
  var readPromise = readAllBytes(stream.readable);
  var writer = stream.writable.getWriter();
  await writer.write(bytes);
  await writer.close();
  return bytesToString(await readPromise);
}

async function normalizeRaw(raw) {
  if (typeof raw === 'string') return raw;
  if (raw instanceof ArrayBuffer || ArrayBuffer.isView(raw)) {
    return bytesToString(toUint8Array(raw));
  }
  if (raw && typeof raw.text === 'function') {
    return await raw.text();
  }
  return String(raw);
}

/**
 * Encode a full PhantomStream message for WebSocket transport.
 *
 * @param {Object} msg Full message object `{ type, payload, ts }`.
 * @param {Object} [options]
 * @returns {Promise<string>}
 */
export async function encodeWireMessage(msg, options) {
  var opts = options || {};
  var json = JSON.stringify(msg);
  var threshold = typeof opts.compressionThresholdBytes === 'number'
    ? opts.compressionThresholdBytes
    : DEFAULT_COMPRESSION_THRESHOLD_BYTES;
  if (byteLength(json) < threshold) return json;

  var compressed;
  try {
    compressed = await nativeCompress(json, opts);
  } catch (e) {
    emitDiagnostic(opts, 'native-deflate-failed', { error: e && e.message ? e.message : 'native deflate failed' });
    return json;
  }
  if (!compressed) {
    emitDiagnostic(opts, 'native-deflate-unavailable');
    return json;
  }
  var base64 = bytesToBase64(compressed);
  if (!base64) {
    emitDiagnostic(opts, 'base64-encode-failed');
    return json;
  }
  var envelope = JSON.stringify({ _ps: NATIVE_DEFLATE_MARKER, d: base64 });
  return byteLength(envelope) < byteLength(json) ? envelope : json;
}

/**
 * Decode a WebSocket wire frame into a PhantomStream message object.
 *
 * @param {string|ArrayBuffer|ArrayBufferView|Blob} raw
 * @param {Object} [options]
 * @returns {Promise<{ok: true, msg: Object} | {ok: false, error: string}>}
 */
export async function decodeWireMessage(raw, options) {
  var opts = options || {};
  var text;
  try {
    text = await normalizeRaw(raw);
  } catch (e) {
    return { ok: false, error: 'raw-read-failed' };
  }

  var outer;
  try {
    outer = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: 'json-parse-failed' };
  }

  if (outer && outer._lz === true) {
    return decodeEnvelope(text, opts.lz);
  }

  if (!outer || !Object.prototype.hasOwnProperty.call(outer, '_ps')) {
    return { ok: true, msg: outer };
  }

  if (outer._ps !== NATIVE_DEFLATE_MARKER) {
    return { ok: false, error: 'unsupported-envelope' };
  }
  if (typeof outer.d !== 'string') {
    return { ok: false, error: 'malformed-envelope' };
  }

  var bytes = base64ToBytes(outer.d);
  if (!bytes) return { ok: false, error: 'base64-decode-failed' };

  var inner;
  try {
    inner = await nativeDecompress(bytes, opts);
  } catch (e) {
    return { ok: false, error: 'native-deflate-failed' };
  }
  if (typeof inner !== 'string') {
    return { ok: false, error: 'native-deflate-unavailable' };
  }

  try {
    return { ok: true, msg: JSON.parse(inner) };
  } catch (e) {
    return { ok: false, error: 'inner-json-parse-failed' };
  }
}

function copyCounters(counters) {
  var out = {};
  for (var key in counters) {
    if (Object.prototype.hasOwnProperty.call(counters, key)) out[key] = counters[key];
  }
  return out;
}

function pushBounded(list, entry, limit) {
  list.push(entry);
  while (list.length > limit) list.shift();
}

function addSocketListener(ws, type, handler) {
  if (ws && typeof ws.addEventListener === 'function') {
    ws.addEventListener(type, handler);
    return function () {
      try {
        ws.removeEventListener(type, handler);
      } catch (e) { /* listener already gone */ }
    };
  }
  var key = 'on' + type;
  var previous = ws ? ws[key] : null;
  if (ws) ws[key] = handler;
  return function () {
    if (ws && ws[key] === handler) ws[key] = previous || null;
  };
}

/**
 * Create a browser-compatible WebSocket transport for capture and viewer.
 *
 * @param {Object} options
 * @returns {{
 *   send: (type: string, payload: Object) => void,
 *   flush: () => Promise<void>,
 *   onMessage: (handler: (type: string, payload: Object) => void) => (() => void),
 *   onStatus: (handler: (status: Object) => void) => (() => void),
 *   close: () => void,
 *   getHealth: () => Object
 * }}
 */
export function createWebSocketTransport(options) {
  var cfg = options || {};
  var url = cfg.url;
  if (!url || typeof url !== 'string') throw new Error('websocket-url-required');
  var WebSocketCtor = cfg.WebSocket || (typeof WebSocket !== 'undefined' ? WebSocket : null);
  if (typeof WebSocketCtor !== 'function') throw new Error('websocket-constructor-required');

  var logger = cfg.logger || {
    info: function () {},
    warn: function () {},
    error: function () {}
  };
  var now = typeof cfg.now === 'function' ? cfg.now : defaultNow;
  var openState = typeof WebSocketCtor.OPEN === 'number' ? WebSocketCtor.OPEN : 1;
  var statusState = 'connecting';
  var messageHandlers = new Set();
  var statusHandlers = new Set();
  var sentByType = {};
  var receivedByType = {};
  var errors = [];
  var drops = 0;
  var lastSendAt = 0;
  var lastReceiveAt = 0;
  var sendQueue = Promise.resolve();
  var receiveQueue = Promise.resolve();
  var unsubscribers = [];
  var ws = new WebSocketCtor(url);
  if (ws && Object.prototype.hasOwnProperty.call(ws, 'binaryType')) {
    try {
      ws.binaryType = 'arraybuffer';
    } catch (e) { /* non-browser fakes may reject binaryType */ }
  }

  function bufferedAmount() {
    return ws && typeof ws.bufferedAmount === 'number' ? ws.bufferedAmount : 0;
  }

  function healthSnapshot(extra) {
    return Object.assign({
      state: statusState,
      role: cfg.role || '',
      readyState: ws && typeof ws.readyState !== 'undefined' ? ws.readyState : null,
      bufferedAmount: bufferedAmount(),
      sentByType: copyCounters(sentByType),
      receivedByType: copyCounters(receivedByType),
      lastSendAt: lastSendAt,
      lastReceiveAt: lastReceiveAt,
      drops: drops,
      errors: errors.slice()
    }, extra || {});
  }

  function emitStatus(state, extra) {
    statusState = state || statusState;
    var status = healthSnapshot(extra);
    statusHandlers.forEach(function (handler) {
      try {
        handler(status);
      } catch (e) {
        recordError('status-handler-failed');
      }
    });
  }

  function recordError(code) {
    var entry = {
      code: code || 'transport-error',
      ts: now()
    };
    pushBounded(errors, entry, 50);
    return entry;
  }

  function increment(counter, type) {
    var key = typeof type === 'string' && type ? type : 'unknown';
    counter[key] = (counter[key] || 0) + 1;
  }

  function encodeOptions() {
    return Object.assign({}, cfg, {
      onStatus: function (status) {
        if (status && status.reason) {
          recordError(status.reason);
          emitStatus(statusState, { reason: status.reason });
        }
      }
    });
  }

  function safeLog(level, message, detail) {
    try {
      if (logger && typeof logger[level] === 'function') logger[level](message, detail);
    } catch (e) { /* logging must not affect transport */ }
  }

  function isOpen() {
    return ws && ws.readyState === openState;
  }

  function send(type, payload) {
    var msg = { type: type, payload: payload || {}, ts: now() };
    sendQueue = sendQueue.then(async function () {
      if (!isOpen()) {
        drops += 1;
        recordError('websocket-not-open');
        emitStatus('error', { reason: 'websocket-not-open' });
        return;
      }
      var raw;
      try {
        raw = await encodeWireMessage(msg, encodeOptions());
      } catch (err) {
        recordError('encode-failed');
        safeLog('error', '[Transport] encode failed', err);
        emitStatus('error', { reason: 'encode-failed' });
        return;
      }
      try {
        ws.send(raw);
        increment(sentByType, type);
        lastSendAt = now();
      } catch (err) {
        drops += 1;
        recordError('websocket-send-failed');
        safeLog('error', '[Transport] websocket send failed', err);
        emitStatus('error', { reason: 'websocket-send-failed' });
      }
    }, async function () {
      recordError('send-queue-recovered');
    });
    sendQueue = sendQueue.catch(function (err) {
      recordError('send-queue-failed');
      safeLog('error', '[Transport] send queue failed', err);
    });
    return undefined;
  }

  function flush() {
    return sendQueue.then(function () {});
  }

  function onMessage(handler) {
    if (typeof handler !== 'function') return function () {};
    messageHandlers.add(handler);
    return function () {
      messageHandlers.delete(handler);
    };
  }

  function onStatus(handler) {
    if (typeof handler !== 'function') return function () {};
    statusHandlers.add(handler);
    try {
      handler(healthSnapshot());
    } catch (e) {
      recordError('status-handler-failed');
    }
    return function () {
      statusHandlers.delete(handler);
    };
  }

  async function handleMessage(event) {
    var raw = event && Object(event) === event && 'data' in event ? event.data : event;
    var decoded = await decodeWireMessage(raw, cfg);
    if (!decoded.ok) {
      recordError(decoded.error);
      emitStatus('error', { reason: decoded.error });
      return;
    }
    var msg = decoded.msg || {};
    increment(receivedByType, msg.type);
    lastReceiveAt = now();
    messageHandlers.forEach(function (handler) {
      try {
        handler(msg.type, msg.payload || {});
      } catch (err) {
        recordError('message-handler-failed');
        safeLog('error', '[Transport] message handler failed', err);
      }
    });
  }

  unsubscribers.push(addSocketListener(ws, 'open', function () {
    emitStatus('open');
  }));
  unsubscribers.push(addSocketListener(ws, 'message', function (event) {
    receiveQueue = receiveQueue.then(function () {
      return handleMessage(event);
    }).catch(function (err) {
      recordError('message-decode-failed');
      safeLog('error', '[Transport] message decode failed', err);
      emitStatus('error', { reason: 'message-decode-failed' });
    });
  }));
  unsubscribers.push(addSocketListener(ws, 'error', function () {
    recordError('websocket-error');
    emitStatus('error', { reason: 'websocket-error' });
  }));
  unsubscribers.push(addSocketListener(ws, 'close', function (event) {
    emitStatus('closed', {
      closeCode: event && typeof event.code === 'number' ? event.code : null,
      closeReason: event && typeof event.reason === 'string' ? event.reason : ''
    });
  }));

  function close() {
    try {
      unsubscribers.forEach(function (unsubscribe) { unsubscribe(); });
      unsubscribers = [];
      if (ws && typeof ws.close === 'function') ws.close();
    } catch (err) {
      recordError('websocket-close-failed');
      safeLog('error', '[Transport] websocket close failed', err);
      emitStatus('error', { reason: 'websocket-close-failed' });
    }
  }

  return {
    send: send,
    flush: flush,
    onMessage: onMessage,
    onStatus: onStatus,
    close: close,
    getHealth: healthSnapshot
  };
}
