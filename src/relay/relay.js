// Transport-agnostic PhantomStream room relay.
//
// Source and viewer clients join a shared room. Frames are forwarded
// byte-identically to the opposite side only; all routing safety, byte caps,
// backpressure drops, and diagnostics live here instead of in a backend.

import { RELAY_PER_MESSAGE_LIMIT_BYTES } from '../protocol/constants.js';
import { checkRelayFrameLimit } from './limits.js';

const OPEN_READY_STATE = 1;
const ROOM_DIAGNOSTIC_LIMIT = 100;

export const BACKPRESSURE_BUFFER_LIMIT_BYTES = 16 * 1024 * 1024; // 16 MiB

/**
 * @typedef {Object} RelayClient
 * @property {number} [readyState]
 * @property {number} [bufferedAmount]
 * @property {(raw: string) => void} send
 */

/**
 * @typedef {Object} RelayOptions
 * @property {number} [capBytes]
 * @property {number} [backpressureLimitBytes]
 * @property {() => number} [now]
 * @property {{warn?: Function, error?: Function}} [logger]
 */

/**
 * Create a raw room relay.
 *
 * @param {RelayOptions} [options]
 * @returns {{
 *   addClient: (entry: {roomId: string, role: 'source'|'viewer', socket: RelayClient}) => Object,
 *   removeClient: (entry: {roomId: string, role?: 'source'|'viewer', socket: RelayClient, event?: string, closeCode?: number, closeReason?: string}) => Object,
 *   receive: (entry: {roomId: string, role: 'source'|'viewer', socket?: RelayClient, raw: string}) => Object,
 *   getDiagnostics: (roomId?: string) => Object|null,
 *   getRoomSnapshot: () => {roomCount: number, rooms: Array<{roomId: string, sourceCount: number, viewerCount: number}>},
 *   clear: () => void
 * }}
 */
export function createRelay(options = {}) {
  var capBytes = Number.isFinite(options.capBytes)
    ? options.capBytes
    : RELAY_PER_MESSAGE_LIMIT_BYTES;
  var backpressureLimitBytes = Number.isFinite(options.backpressureLimitBytes)
    ? options.backpressureLimitBytes
    : BACKPRESSURE_BUFFER_LIMIT_BYTES;
  var now = typeof options.now === 'function' ? options.now : Date.now;
  var logger = options.logger || {};
  var rooms = new Map();
  var diagnostics = new Map();

  function addClient(entry) {
    var roomId = normalizeRoomId(entry?.roomId);
    var role = normalizeRole(entry?.role);
    var socket = normalizeSocket(entry?.socket);
    var room = getOrCreateRoom(roomId);

    room[role].add(socket);
    pushEvent(roomId, {
      event: 'connected',
      role,
      roomPrefix: roomPrefix(roomId),
    });

    return roomCounts(roomId, room);
  }

  function removeClient(entry) {
    var roomId = normalizeRoomId(entry?.roomId);
    var role = entry?.role ? normalizeRole(entry.role) : null;
    var socket = entry?.socket;
    var room = rooms.get(roomId);
    var removed = false;

    if (!room || !socket) {
      return { removed: false, roomRemoved: false };
    }

    if (role) {
      removed = room[role].delete(socket);
    } else {
      removed = room.source.delete(socket) || removed;
      removed = room.viewer.delete(socket) || removed;
    }

    if (removed && entry?.event) {
      pushEvent(roomId, {
        event: entry.event,
        role: role || 'unknown',
        roomPrefix: roomPrefix(roomId),
        closeCode: typeof entry.closeCode === 'number' ? entry.closeCode : null,
        closeReason: entry.closeReason ? String(entry.closeReason) : '',
      });
    }

    var roomRemoved = false;
    if (room.source.size === 0 && room.viewer.size === 0) {
      rooms.delete(roomId);
      roomRemoved = true;
    }

    return Object.assign({ removed, roomRemoved }, roomCounts(roomId, room));
  }

  function receive(entry) {
    var roomId = normalizeRoomId(entry?.roomId);
    var role = normalizeRole(entry?.role);
    var raw = normalizeRaw(entry?.raw);
    var check = checkRelayFrameLimit(raw, { roomId, role, capBytes });
    var type = check.type || 'unknown';
    var direction = role === 'source' ? 'source->viewer' : 'viewer->source';

    incrementCounter(roomId, 'receivedByType', type, 1);

    if (!check.ok) {
      incrementCounter(roomId, 'droppedByType', type, 1);
      pushEvent(roomId, Object.assign({ event: 'message-too-large' }, check));
      logWarn('[PhantomStream relay] message too large', check);
      return Object.assign({
        targetCount: 0,
        deliveredCount: 0,
        droppedCount: 0,
      }, check);
    }

    var room = rooms.get(roomId);
    if (!room) {
      return recordDroppedDelivery(roomId, direction, type);
    }

    var targetRole = role === 'source' ? 'viewer' : 'source';
    return sendToTargets({
      roomId,
      role,
      targetRole,
      direction,
      type,
      raw,
      targets: room[targetRole],
    });
  }

  function getDiagnostics(roomId) {
    if (typeof roomId === 'string') {
      var diagnostic = diagnostics.get(roomId);
      return diagnostic ? cloneDiagnostics(diagnostic) : null;
    }

    var all = {};
    for (const [id, diagnostic] of diagnostics.entries()) {
      all[id] = cloneDiagnostics(diagnostic);
    }
    return all;
  }

  function getRoomSnapshot() {
    var snapshots = [];
    for (const [roomId, room] of rooms.entries()) {
      snapshots.push(roomCounts(roomId, room));
    }
    snapshots.sort(function (a, b) {
      return a.roomId.localeCompare(b.roomId);
    });
    return { roomCount: snapshots.length, rooms: snapshots };
  }

  function clear() {
    rooms.clear();
    diagnostics.clear();
  }

  function getOrCreateRoom(roomId) {
    if (!rooms.has(roomId)) {
      rooms.set(roomId, { source: new Set(), viewer: new Set() });
    }
    return rooms.get(roomId);
  }

  function getOrCreateDiagnostics(roomId) {
    if (!diagnostics.has(roomId)) {
      diagnostics.set(roomId, {
        events: [],
        receivedByType: {},
        deliveredByType: {},
        droppedByType: {},
      });
    }
    return diagnostics.get(roomId);
  }

  function incrementCounter(roomId, bucket, type, amount) {
    if (!type || !amount) return;
    var diagnostic = getOrCreateDiagnostics(roomId);
    diagnostic[bucket][type] = (diagnostic[bucket][type] || 0) + amount;
  }

  function pushEvent(roomId, details) {
    var diagnostic = getOrCreateDiagnostics(roomId);
    var event = Object.assign({ ts: now() }, details || {});
    diagnostic.events.push(event);
    if (diagnostic.events.length > ROOM_DIAGNOSTIC_LIMIT) {
      diagnostic.events.shift();
    }
    return event;
  }

  function sendToTargets(options) {
    var targetCount = 0;
    var deliveredCount = 0;
    var droppedCount = 0;

    for (const target of options.targets) {
      targetCount += 1;

      if (typeof target.readyState === 'number' && target.readyState !== OPEN_READY_STATE) {
        droppedCount += 1;
        continue;
      }

      if (typeof target.bufferedAmount === 'number'
          && target.bufferedAmount > backpressureLimitBytes) {
        droppedCount += 1;
        incrementCounter(options.roomId, 'droppedByType', options.type, 1);
        pushEvent(options.roomId, {
          event: 'backpressure-drop',
          direction: options.direction,
          role: options.role,
          targetRole: options.targetRole,
          type: options.type,
          roomPrefix: roomPrefix(options.roomId),
          bufferedAmount: target.bufferedAmount,
          limitBytes: backpressureLimitBytes,
        });
        logWarn('[PhantomStream relay] backpressure drop', {
          roomPrefix: roomPrefix(options.roomId),
          type: options.type,
          bufferedAmount: target.bufferedAmount,
          limitBytes: backpressureLimitBytes,
        });
        continue;
      }

      try {
        target.send(options.raw);
        deliveredCount += 1;
      } catch (err) {
        droppedCount += 1;
        incrementCounter(options.roomId, 'droppedByType', options.type, 1);
        pushEvent(options.roomId, {
          event: 'send-error',
          direction: options.direction,
          role: options.role,
          targetRole: options.targetRole,
          type: options.type,
          roomPrefix: roomPrefix(options.roomId),
          error: err && err.message ? err.message : String(err),
        });
        logError('[PhantomStream relay] send failed', err);
      }
    }

    incrementCounter(options.roomId, 'deliveredByType', options.type, deliveredCount);

    pushEvent(options.roomId, {
      event: 'relay',
      direction: options.direction,
      role: options.role,
      targetRole: options.targetRole,
      type: options.type,
      roomPrefix: roomPrefix(options.roomId),
      targetCount,
      deliveredCount,
      droppedCount,
    });

    if (targetCount === 0 || droppedCount > 0) {
      pushEvent(options.roomId, {
        event: 'dropped-delivery',
        direction: options.direction,
        role: options.role,
        targetRole: options.targetRole,
        type: options.type,
        roomPrefix: roomPrefix(options.roomId),
        targetCount,
        deliveredCount,
        droppedCount,
      });
    }

    return {
      ok: true,
      targetCount,
      deliveredCount,
      droppedCount,
      type: options.type,
    };
  }

  function recordDroppedDelivery(roomId, direction, type) {
    pushEvent(roomId, {
      event: 'relay',
      direction,
      type,
      roomPrefix: roomPrefix(roomId),
      targetCount: 0,
      deliveredCount: 0,
      droppedCount: 0,
    });
    pushEvent(roomId, {
      event: 'dropped-delivery',
      direction,
      type,
      roomPrefix: roomPrefix(roomId),
      targetCount: 0,
      deliveredCount: 0,
      droppedCount: 0,
    });
    return {
      ok: true,
      targetCount: 0,
      deliveredCount: 0,
      droppedCount: 0,
      type,
    };
  }

  function logWarn(message, details) {
    if (typeof logger.warn === 'function') logger.warn(message, details);
  }

  function logError(message, err) {
    if (typeof logger.error === 'function') logger.error(message, err);
  }

  return {
    addClient,
    removeClient,
    receive,
    getDiagnostics,
    getRoomSnapshot,
    clear,
  };
}

function normalizeRoomId(roomId) {
  if (typeof roomId !== 'string' || roomId.trim() === '') {
    throw new Error('relay-room-required');
  }
  return roomId;
}

function normalizeRole(role) {
  if (role !== 'source' && role !== 'viewer') {
    throw new Error('relay-role-invalid');
  }
  return role;
}

function normalizeSocket(socket) {
  if (!socket || typeof socket.send !== 'function') {
    throw new Error('relay-socket-required');
  }
  return socket;
}

function normalizeRaw(raw) {
  if (typeof raw !== 'string') {
    throw new Error('relay-raw-string-required');
  }
  return raw;
}

function roomCounts(roomId, room) {
  return {
    roomId,
    sourceCount: room.source.size,
    viewerCount: room.viewer.size,
  };
}

function roomPrefix(roomId) {
  return roomId.slice(0, 8);
}

function cloneDiagnostics(diagnostic) {
  return {
    events: diagnostic.events.map(function (entry) {
      return Object.assign({}, entry);
    }),
    receivedByType: Object.assign({}, diagnostic.receivedByType),
    deliveredByType: Object.assign({}, diagnostic.deliveredByType),
    droppedByType: Object.assign({}, diagnostic.droppedByType),
  };
}
