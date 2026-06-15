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
  var writer = stream.writable.getWriter();
  await writer.write(stringToBytes(raw));
  await writer.close();
  var compressed = await new Response(stream.readable).arrayBuffer();
  return new Uint8Array(compressed);
}

async function nativeDecompress(bytes, options) {
  var codec = options.codec || null;
  if (hasCodecDecompress(codec)) {
    return await codec.decompress(bytes);
  }

  var DecompressionStreamCtor = getCtor(options, 'DecompressionStream');
  if (typeof DecompressionStreamCtor !== 'function') return null;

  var stream = new DecompressionStreamCtor(NATIVE_DEFLATE_MARKER);
  var writer = stream.writable.getWriter();
  await writer.write(bytes);
  await writer.close();
  var decompressed = await new Response(stream.readable).arrayBuffer();
  return bytesToString(new Uint8Array(decompressed));
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
  return JSON.stringify({ _ps: NATIVE_DEFLATE_MARKER, d: base64 });
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
