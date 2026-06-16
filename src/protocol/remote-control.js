// PhantomStream remote-control validation and redaction helpers.
//
// Viewer-originated control frames are untrusted until the adapter validates
// them. Telemetry helpers whitelist fields so typed text and mirrored page
// content never flow into state events or action summaries.

import { REMOTE_CONTROL, REMOTE_CONTROL_STATE } from './messages.js';

export const REMOTE_TEXT_MAX_CHARS = 4096;

var REMOTE_CONTROL_TYPES = [
  REMOTE_CONTROL.REQUEST,
  REMOTE_CONTROL.STOP,
  REMOTE_CONTROL.CLICK,
  REMOTE_CONTROL.TEXT,
  REMOTE_CONTROL.KEY,
  REMOTE_CONTROL.SCROLL,
  REMOTE_CONTROL.STATE,
];

var REMOTE_CONTROL_STATES = [
  REMOTE_CONTROL_STATE.LOCKED,
  REMOTE_CONTROL_STATE.REQUESTING,
  REMOTE_CONTROL_STATE.ACTIVE,
  REMOTE_CONTROL_STATE.DENIED,
  REMOTE_CONTROL_STATE.STOPPED,
];

/**
 * @typedef {Object} RemoteControlAction
 * @property {string} type
 * @property {string} kind
 * @property {number} [x]
 * @property {number} [y]
 * @property {number} [deltaX]
 * @property {number} [deltaY]
 * @property {'left'|'middle'|'right'} [button]
 * @property {number} [clickCount]
 * @property {string} [key]
 * @property {'down'|'up'} [event]
 * @property {string} [text]
 */

/**
 * Is this a PhantomStream remote-control protocol frame type?
 * @param {string} type
 * @returns {boolean}
 */
export function isRemoteControlType(type) {
  return REMOTE_CONTROL_TYPES.includes(type);
}

/**
 * Validate and normalize an untrusted remote-control message.
 *
 * @param {string} type
 * @param {Object} payload
 * @returns {{ok: true, action: RemoteControlAction} | {ok: false, error: string}}
 */
export function validateRemoteControlMessage(type, payload) {
  var p = asObject(payload);

  if (type === REMOTE_CONTROL.REQUEST) {
    return { ok: true, action: { type: type, kind: 'request' } };
  }
  if (type === REMOTE_CONTROL.STOP) {
    return { ok: true, action: { type: type, kind: 'stop' } };
  }
  if (type === REMOTE_CONTROL.CLICK) {
    return validateClick(type, p);
  }
  if (type === REMOTE_CONTROL.TEXT) {
    return validateText(type, p);
  }
  if (type === REMOTE_CONTROL.KEY) {
    return validateKey(type, p);
  }
  if (type === REMOTE_CONTROL.SCROLL) {
    return validateScroll(type, p);
  }

  return { ok: false, error: 'remote-type-unsupported' };
}

/**
 * Return a content-free action summary suitable for logs/state telemetry.
 *
 * @param {string} type
 * @param {Object} payload
 * @returns {Object}
 */
export function summarizeRemoteControlAction(type, payload) {
  var result = validateRemoteControlMessage(type, payload);
  if (!result.ok) {
    return {
      type: typeof type === 'string' ? type : '',
      kind: 'unsupported',
      error: result.error,
    };
  }

  var action = result.action;
  if (action.kind === 'request' || action.kind === 'stop') {
    return { type: action.type, kind: action.kind };
  }
  if (action.kind === 'click') {
    return {
      type: action.type,
      kind: action.kind,
      x: action.x,
      y: action.y,
      button: action.button,
      clickCount: action.clickCount,
    };
  }
  if (action.kind === 'text') {
    return {
      type: action.type,
      kind: action.kind,
      chars: action.text.length,
    };
  }
  if (action.kind === 'key') {
    return {
      type: action.type,
      kind: action.kind,
      key: action.key,
      event: action.event,
    };
  }
  if (action.kind === 'scroll') {
    return {
      type: action.type,
      kind: action.kind,
      x: action.x,
      y: action.y,
      deltaX: action.deltaX,
      deltaY: action.deltaY,
    };
  }

  return { type: action.type, kind: action.kind };
}

/**
 * Create a content-free remote-control state event.
 *
 * @param {string} state
 * @param {string} reason
 * @param {Object} [extra]
 * @returns {{state: string, reason: string, counts?: Object}}
 */
export function createRemoteControlStateEvent(state, reason, extra) {
  var event = {
    state: normalizeState(state),
    reason: normalizeReason(reason),
  };
  var counts = sanitizeCounts(extra && extra.counts);
  if (Object.keys(counts).length > 0) {
    event.counts = counts;
  }
  return event;
}

function validateClick(type, payload) {
  var point = readPoint(payload);
  if (!point.ok) return point;

  var button = payload.button == null ? 'left' : payload.button;
  if (button !== 'left' && button !== 'middle' && button !== 'right') {
    return { ok: false, error: 'remote-button-invalid' };
  }

  var clickCount = payload.clickCount == null ? 1 : payload.clickCount;
  if (!isFinitePositiveNumber(clickCount)) {
    return { ok: false, error: 'remote-coordinate-invalid' };
  }

  return {
    ok: true,
    action: {
      type: type,
      kind: 'click',
      x: point.x,
      y: point.y,
      button: button,
      clickCount: Math.max(1, Math.floor(clickCount)),
    },
  };
}

function validateText(type, payload) {
  if (typeof payload.text !== 'string') {
    return { ok: false, error: 'remote-type-unsupported' };
  }
  if (payload.text.length > REMOTE_TEXT_MAX_CHARS) {
    return { ok: false, error: 'remote-text-too-long' };
  }
  return {
    ok: true,
    action: {
      type: type,
      kind: 'text',
      text: payload.text,
    },
  };
}

function validateKey(type, payload) {
  var event = normalizeKeyEvent(payload.event);
  if (event === null || typeof payload.key !== 'string' || payload.key.length === 0) {
    return { ok: false, error: 'remote-key-event-invalid' };
  }

  return {
    ok: true,
    action: {
      type: type,
      kind: 'key',
      key: payload.key,
      event: event,
    },
  };
}

function validateScroll(type, payload) {
  var point = readPoint(payload);
  if (!point.ok) return point;

  var deltaX = payload.deltaX == null ? 0 : payload.deltaX;
  var deltaY = payload.deltaY == null ? 0 : payload.deltaY;
  if (!isFiniteNumber(deltaX) || !isFiniteNumber(deltaY)) {
    return { ok: false, error: 'remote-coordinate-invalid' };
  }

  return {
    ok: true,
    action: {
      type: type,
      kind: 'scroll',
      x: point.x,
      y: point.y,
      deltaX: deltaX,
      deltaY: deltaY,
    },
  };
}

function readPoint(payload) {
  if (!isFiniteNonNegativeNumber(payload.x) || !isFiniteNonNegativeNumber(payload.y)) {
    return { ok: false, error: 'remote-coordinate-invalid' };
  }
  return { ok: true, x: payload.x, y: payload.y };
}

function normalizeKeyEvent(event) {
  if (event === 'down' || event === 'keyDown') return 'down';
  if (event === 'up' || event === 'keyUp') return 'up';
  return null;
}

function normalizeState(state) {
  if (REMOTE_CONTROL_STATES.includes(state)) return state;
  return REMOTE_CONTROL_STATE.LOCKED;
}

function normalizeReason(reason) {
  if (typeof reason !== 'string') return '';
  if (!/^[a-z0-9-]+$/.test(reason)) return '';
  return reason;
}

function sanitizeCounts(counts) {
  var result = {};
  if (!counts || Object(counts) !== counts) return result;
  for (const key of Object.keys(counts)) {
    var value = counts[key];
    if (/^[A-Za-z0-9_-]+$/.test(key) && isFiniteNonNegativeNumber(value)) {
      result[key] = value;
    }
  }
  return result;
}

function asObject(value) {
  if (value && Object(value) === value && !Array.isArray(value)) return value;
  return {};
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function isFiniteNonNegativeNumber(value) {
  return isFiniteNumber(value) && value >= 0;
}

function isFinitePositiveNumber(value) {
  return isFiniteNumber(value) && value > 0;
}
