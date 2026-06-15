// ws-backed relay backend.
//
// This adapter owns WebSocket admission and socket lifecycle only. The relay
// core owns routing, byte-cap enforcement, diagnostics, and backpressure.

import { Buffer } from 'node:buffer';
import { WebSocketServer } from 'ws';
import { RELAY_PER_MESSAGE_LIMIT_BYTES } from '../../protocol/constants.js';

const POLICY_VIOLATION_CLOSE_CODE = 1008;

/**
 * @typedef {Object} WebSocketRelayBackendOptions
 * @property {import('node:http').Server} server
 * @property {{
 *   addClient: Function,
 *   removeClient: Function,
 *   receive: Function
 * }} relay
 * @property {string} [path]
 * @property {number} [capBytes]
 * @property {{info?: Function, warn?: Function, error?: Function}} [logger]
 */

/**
 * Bind a ws WebSocketServer to an existing Node HTTP server.
 *
 * @param {WebSocketRelayBackendOptions} options
 * @returns {{wss: WebSocketServer, close: () => Promise<void>, options: Object}}
 */
export function createWebSocketRelayBackend(options) {
  var cfg = options || {};
  var server = cfg.server;
  var relay = cfg.relay;
  var path = cfg.path || '/ws';
  var capBytes = Number.isFinite(cfg.capBytes)
    ? cfg.capBytes
    : RELAY_PER_MESSAGE_LIMIT_BYTES;
  var logger = cfg.logger || {};

  if (!server || typeof server.on !== 'function') {
    throw new Error('relay-ws-server-required');
  }
  if (!relay || typeof relay.addClient !== 'function'
      || typeof relay.removeClient !== 'function'
      || typeof relay.receive !== 'function') {
    throw new Error('relay-ws-relay-required');
  }

  var wssOptions = {
    server,
    path,
    perMessageDeflate: false,
    maxPayload: capBytes + 1024,
  };
  var wss = new WebSocketServer(wssOptions);

  wss.on('connection', function (socket, request) {
    socket.on('error', function (err) {
      logError(logger, '[PhantomStream relay ws] socket error', err);
      if (socket._phantomRelayClient) {
        relay.removeClient({
          roomId: socket._phantomRelayClient.roomId,
          role: socket._phantomRelayClient.role,
          socket,
          event: 'error',
          closeReason: err && err.message ? err.message : String(err),
        });
        socket._phantomRelayClient = null;
      }
    });

    var admission = parseAdmission(request.url || '', path);
    if (!admission.ok) {
      logWarn(logger, '[PhantomStream relay ws] rejected client', admission);
      socket.close(POLICY_VIOLATION_CLOSE_CODE, admission.error);
      return;
    }

    var roomId = admission.roomId;
    var role = admission.role;
    socket._phantomRelayClient = { roomId, role };
    relay.addClient({ roomId, role, socket });

    socket.on('message', function (data) {
      var raw = rawMessageToString(data);
      if (isPingFrame(raw)) {
        sendLocalPong(socket);
        return;
      }
      relay.receive({ roomId, role, socket, raw });
    });

    socket.on('close', function (closeCode, closeReason) {
      relay.removeClient({
        roomId,
        role,
        socket,
        event: 'closed',
        closeCode,
        closeReason: normalizeCloseReason(closeReason),
      });
      socket._phantomRelayClient = null;
    });
  });

  return {
    wss,
    options: Object.assign({}, wssOptions),
    close: function close() {
      for (const client of wss.clients) {
        client.close();
      }
      return new Promise(function (resolve, reject) {
        wss.close(function (err) {
          if (err) reject(err);
          else resolve();
        });
      });
    },
  };
}

function parseAdmission(url, expectedPath) {
  var parsed;
  try {
    parsed = new URL(url, 'http://phantomstream.local');
  } catch {
    return { ok: false, error: 'invalid-url' };
  }

  if (parsed.pathname !== expectedPath) {
    return { ok: false, error: 'invalid-path' };
  }

  var roomId = parsed.searchParams.get('room') || '';
  var role = parsed.searchParams.get('role') || '';

  if (roomId.trim() === '') {
    return { ok: false, error: 'room-required' };
  }
  if (role !== 'source' && role !== 'viewer') {
    return { ok: false, error: 'role-invalid' };
  }

  return { ok: true, roomId, role };
}

function rawMessageToString(data) {
  if (typeof data === 'string') return data;
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  if (ArrayBuffer.isView(data)) {
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString('utf8');
  }
  return String(data);
}

function isPingFrame(raw) {
  try {
    var msg = JSON.parse(raw);
    return !!msg && msg.type === 'ping';
  } catch {
    return false;
  }
}

function sendLocalPong(socket) {
  if (socket.readyState !== 1) return;
  socket.send(JSON.stringify({ type: 'pong', ts: Date.now() }));
}

function normalizeCloseReason(reason) {
  if (!reason) return '';
  if (Buffer.isBuffer(reason)) return reason.toString('utf8');
  return String(reason);
}

function logWarn(logger, message, details) {
  if (typeof logger.warn === 'function') logger.warn(message, details);
}

function logError(logger, message, err) {
  if (typeof logger.error === 'function') logger.error(message, err);
}
