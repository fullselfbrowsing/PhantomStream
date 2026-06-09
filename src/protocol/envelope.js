// PhantomStream compression envelope.
//
// Large payloads travel as a self-identifying envelope { _lz: true, d: <base64> }
// (LZ-string compressToBase64); small payloads travel as plain JSON. Receivers
// detect the envelope by shape, so compressed and plain senders interoperate
// (FSB Phase 122.3 backward-compatibility requirement).
//
// The LZ-string implementation is injected rather than imported so this module
// works in any runtime (extension content script, service worker, browser,
// Node) and stays dependency-free.

/**
 * @typedef {Object} LZCodec
 * @property {(s: string) => string} compressToBase64
 * @property {(s: string) => string|null} decompressFromBase64
 */

/**
 * Encode a message object for the wire.
 *
 * @param {Object} msg                 The full message ({ type, payload, ... })
 * @param {LZCodec} lz                 LZ-string (or compatible) codec
 * @param {number} [thresholdBytes=0]  Compress only when the JSON exceeds this size;
 *                                     0 compresses everything
 * @returns {string} JSON string ready to send
 */
export function encodeEnvelope(msg, lz, thresholdBytes) {
  var json = JSON.stringify(msg);
  var threshold = thresholdBytes || 0;
  if (!lz || typeof lz.compressToBase64 !== 'function' || json.length <= threshold) {
    return json;
  }
  return JSON.stringify({ _lz: true, d: lz.compressToBase64(json) });
}

/**
 * Decode a wire string into a message object. Detects the compressed
 * envelope by shape; falls through to plain JSON otherwise.
 *
 * @param {string} raw
 * @param {LZCodec} [lz]
 * @returns {{ok: true, msg: Object} | {ok: false, error: string}}
 */
export function decodeEnvelope(raw, lz) {
  var outer;
  try {
    outer = JSON.parse(raw);
  } catch (e) {
    return { ok: false, error: 'json-parse-failed' };
  }
  if (!outer || outer._lz !== true || typeof outer.d !== 'string') {
    return { ok: true, msg: outer };
  }
  if (!lz || typeof lz.decompressFromBase64 !== 'function') {
    return { ok: false, error: 'decompress-unavailable' };
  }
  var inner = lz.decompressFromBase64(outer.d);
  if (!inner) {
    return { ok: false, error: 'decompress-failed' };
  }
  try {
    return { ok: true, msg: JSON.parse(inner) };
  } catch (e) {
    return { ok: false, error: 'inner-json-parse-failed' };
  }
}

/**
 * Is this decoded wire object a compressed envelope (vs. a plain message)?
 * Useful for relay-side diagnostics that classify traffic without decoding.
 * @param {Object} obj
 */
export function isCompressedEnvelope(obj) {
  return !!obj && obj._lz === true && typeof obj.d === 'string';
}
