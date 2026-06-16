// Relay frame classification and byte-limit enforcement.
//
// The relay does not decode/decompress PhantomStream payloads. It only parses
// enough JSON to classify frame type and envelope shape for diagnostics before
// enforcing the shared protocol cap.

import { Buffer } from 'node:buffer';
import { RELAY_PER_MESSAGE_LIMIT_BYTES } from '../protocol/constants.js';

const UNKNOWN_TYPE = 'unknown';
const COMPRESSED_ENVELOPE_TYPE = 'compressed-envelope';

/**
 * Classify a raw relay frame without transforming the application payload.
 *
 * @param {string} raw
 * @returns {{type: string, compressed: boolean, parseError: string|null}}
 */
export function classifyRelayFrame(raw) {
  var parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      type: UNKNOWN_TYPE,
      compressed: false,
      parseError: 'json-parse-failed',
    };
  }

  var compressed = isRelayCompressedEnvelope(parsed);
  var type = typeof parsed?.type === 'string'
    ? parsed.type
    : (compressed ? COMPRESSED_ENVELOPE_TYPE : UNKNOWN_TYPE);

  return {
    type,
    compressed,
    parseError: null,
  };
}

/**
 * Check whether a raw relay frame fits under the relay cap.
 *
 * @param {string} raw
 * @param {{roomId?: string, role?: string, capBytes?: number}} [options]
 * @returns {{
 *   ok: true,
 *   byteSize: number,
 *   capBytes: number,
 *   type: string,
 *   compressed: boolean
 * } | {
 *   ok: false,
 *   error: 'message-too-large',
 *   byteSize: number,
 *   capBytes: number,
 *   type: string,
 *   compressed: boolean,
 *   roomPrefix: string,
 *   role: string|undefined
 * }}
 */
export function checkRelayFrameLimit(raw, options = {}) {
  var capBytes = Number.isFinite(options.capBytes)
    ? options.capBytes
    : RELAY_PER_MESSAGE_LIMIT_BYTES;
  var byteSize = Buffer.byteLength(raw, 'utf8');
  var classification = classifyRelayFrame(raw);

  if (byteSize <= capBytes) {
    return {
      ok: true,
      byteSize,
      capBytes,
      type: classification.type,
      compressed: classification.compressed,
    };
  }

  return {
    ok: false,
    error: 'message-too-large',
    byteSize,
    capBytes,
    type: classification.type,
    compressed: classification.compressed,
    roomPrefix: roomPrefix(options.roomId),
    role: options.role,
  };
}

function isRelayCompressedEnvelope(parsed) {
  return !!parsed
    && typeof parsed === 'object'
    && (
      (parsed._lz === true && typeof parsed.d === 'string')
      || (parsed._ps === 'deflate-raw' && typeof parsed.d === 'string')
    );
}

function roomPrefix(roomId) {
  return typeof roomId === 'string' ? roomId.slice(0, 8) : '';
}
