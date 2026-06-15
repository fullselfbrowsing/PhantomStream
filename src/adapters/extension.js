// PhantomStream Chromium MV3 adapter surface.
//
// This module is intentionally framework-free so it can run in a service
// worker bundle or be unit-tested with a fake Chrome API.

import { CONTROL, STREAM } from '../protocol/messages.js';

export const PHANTOMSTREAM_WATCHDOG_ALARM = 'phantomstream-watchdog';
export const PHANTOMSTREAM_SESSION_KEY = 'phantomstream:mv3-session';

var BRIDGE_MESSAGE_TYPE = 'phantomstream:bridge';
var CONTROL_MESSAGE_TYPE = 'phantomstream:control';
var WATCHDOG_RESNAPSHOT_REASON = 'mv3-watchdog-resnapshot';
var DEFAULT_WATCHDOG_PERIOD_MINUTES = 1;

var CONTROL_TYPES = Object.keys(CONTROL).reduce(function buildControlSet(out, key) {
  out[CONTROL[key]] = true;
  return out;
}, {});

var STREAM_TYPES = Object.keys(STREAM).reduce(function buildStreamSet(out, key) {
  out[STREAM[key]] = true;
  return out;
}, {});

function defaultNow() {
  return Date.now();
}

function hasAddListener(event) {
  return event && typeof event.addListener === 'function';
}

function hasRemoveListener(event) {
  return event && typeof event.removeListener === 'function';
}

function validateChrome(chrome) {
  if (!chrome || Object(chrome) !== chrome) throw new Error('extension-chrome-required');
  if (!chrome.runtime || !hasAddListener(chrome.runtime.onMessage)) {
    throw new Error('extension-runtime-required');
  }
  if (!chrome.storage || !chrome.storage.session
      || typeof chrome.storage.session.get !== 'function'
      || typeof chrome.storage.session.set !== 'function') {
    throw new Error('extension-storage-session-required');
  }
  if (!chrome.alarms || !hasAddListener(chrome.alarms.onAlarm)
      || typeof chrome.alarms.create !== 'function') {
    throw new Error('extension-alarms-required');
  }
}

function cleanString(value) {
  return typeof value === 'string' && value ? value : null;
}

function cleanTabId(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function promiseOrValue(value) {
  return value && typeof value.then === 'function' ? value : Promise.resolve(value);
}

function swallowPromise(value) {
  if (value && typeof value.catch === 'function') {
    value.catch(function ignoreBridgeError() {});
  }
  return value;
}

function cloneSessionState(state) {
  if (!state || Object(state) !== state) return null;
  return {
    roomKey: cleanString(state.roomKey),
    wsUrl: cleanString(state.wsUrl),
    tabId: cleanTabId(state.tabId),
    streamingActive: !!state.streamingActive,
    lifecycleIntent: cleanString(state.lifecycleIntent),
    pendingResnapshotReason: cleanString(state.pendingResnapshotReason),
    updatedAt: typeof state.updatedAt === 'number' ? state.updatedAt : null
  };
}

function resolveTabId(payload, sender, previous) {
  if (payload && cleanTabId(payload.tabId) !== null) return payload.tabId;
  if (sender && sender.tab && cleanTabId(sender.tab.id) !== null) return sender.tab.id;
  if (previous && cleanTabId(previous.tabId) !== null) return previous.tabId;
  return null;
}

function getStreamIntent(type, payload, sender, previous, now) {
  var source = payload && Object(payload) === payload ? payload : {};
  var prior = previous || {};
  var streamingActive = !!prior.streamingActive;
  if (type === CONTROL.START || type === CONTROL.RESUME) streamingActive = true;
  if (type === CONTROL.STOP || type === CONTROL.PAUSE) streamingActive = false;
  return {
    roomKey: cleanString(source.roomKey) || cleanString(prior.roomKey),
    wsUrl: cleanString(source.wsUrl) || cleanString(prior.wsUrl),
    tabId: resolveTabId(source, sender, prior),
    streamingActive: streamingActive,
    lifecycleIntent: type,
    pendingResnapshotReason: null,
    updatedAt: now()
  };
}

function normalizeBridgeMessage(message) {
  if (!message || Object(message) !== message) return null;
  if (message.type === BRIDGE_MESSAGE_TYPE || message.type === CONTROL_MESSAGE_TYPE) {
    return message.message && Object(message.message) === message.message ? message.message : null;
  }
  if (typeof message.type === 'string') return message;
  return null;
}

function invokeTransportSend(transport, type, payload) {
  if (!transport || typeof transport.send !== 'function') return;
  transport.send(type, payload || {});
}

/**
 * Create a Chromium MV3 extension adapter handle.
 *
 * @param {Object} options
 * @param {Object} options.chrome Chromium extension API object.
 * @param {{send?: Function, onMessage?: Function}} [options.transport]
 * @param {string} [options.alarmName]
 * @param {string} [options.storageKey]
 * @param {Object} [options.logger]
 * @param {Function} [options.now]
 * @returns {{
 *   install: () => Promise<Object>,
 *   dispose: () => void,
 *   sendControl: (type: string, payload?: Object) => Promise<void>,
 *   getSessionState: () => Object|null
 * }}
 */
export function createExtensionAdapter(options) {
  var opts = options || {};
  var chrome = opts.chrome;
  validateChrome(chrome);

  var transport = opts.transport || null;
  var alarmName = typeof opts.alarmName === 'string' && opts.alarmName
    ? opts.alarmName
    : PHANTOMSTREAM_WATCHDOG_ALARM;
  var storageKey = typeof opts.storageKey === 'string' && opts.storageKey
    ? opts.storageKey
    : PHANTOMSTREAM_SESSION_KEY;
  var now = typeof opts.now === 'function' ? opts.now : defaultNow;
  var logger = opts.logger || null;
  var watchdogPeriodInMinutes = typeof opts.watchdogPeriodInMinutes === 'number' && opts.watchdogPeriodInMinutes > 0
    ? opts.watchdogPeriodInMinutes
    : DEFAULT_WATCHDOG_PERIOD_MINUTES;

  var installed = false;
  var disposed = false;
  var sessionState = null;
  var unsubscribeTransport = null;

  function logWarn(reason, error) {
    if (!logger || typeof logger.warn !== 'function') return;
    try {
      logger.warn('[ExtensionAdapter] ' + reason, {
        error: error && error.message ? error.message : ''
      });
    } catch (e) { /* logger is advisory */ }
  }

  async function readSessionState() {
    var result = await chrome.storage.session.get(storageKey);
    sessionState = cloneSessionState(result ? result[storageKey] : null);
    return sessionState;
  }

  async function writeSessionState(next) {
    sessionState = cloneSessionState(next);
    await chrome.storage.session.set({ [storageKey]: sessionState });
    return sessionState;
  }

  function armWatchdog() {
    try {
      return swallowPromise(chrome.alarms.create(alarmName, {
        periodInMinutes: watchdogPeriodInMinutes
      }));
    } catch (error) {
      logWarn('watchdog-arm-failed', error);
      return null;
    }
  }

  function forwardControlToContent(type, payload, sender) {
    var body = payload && Object(payload) === payload ? payload : {};
    var tabId = resolveTabId(body, sender, sessionState);
    var message = {
      type: CONTROL_MESSAGE_TYPE,
      message: {
        type: type,
        payload: body
      }
    };
    try {
      if (tabId !== null && chrome.tabs && typeof chrome.tabs.sendMessage === 'function') {
        return swallowPromise(chrome.tabs.sendMessage(tabId, message));
      }
      if (typeof chrome.runtime.sendMessage === 'function') {
        return swallowPromise(chrome.runtime.sendMessage(message));
      }
    } catch (error) {
      logWarn('control-forward-failed', error);
    }
    return null;
  }

  async function handleControl(type, payload, sender) {
    var next = getStreamIntent(type, payload, sender, sessionState, now);
    await writeSessionState(next);
    if (next.streamingActive) armWatchdog();
    forwardControlToContent(type, payload || {}, sender);
  }

  async function handleWatchdog(alarm) {
    if (!alarm || alarm.name !== alarmName) return;
    var stored = await readSessionState();
    if (!stored || !stored.streamingActive) return;
    var payload = {
      roomKey: stored.roomKey,
      wsUrl: stored.wsUrl,
      tabId: stored.tabId,
      reason: WATCHDOG_RESNAPSHOT_REASON
    };
    await writeSessionState({
      roomKey: stored.roomKey,
      wsUrl: stored.wsUrl,
      tabId: stored.tabId,
      streamingActive: true,
      lifecycleIntent: CONTROL.START,
      pendingResnapshotReason: WATCHDOG_RESNAPSHOT_REASON,
      updatedAt: now()
    });
    forwardControlToContent(CONTROL.START, payload, { tab: { id: stored.tabId } });
  }

  async function handleRuntimeMessage(message, sender) {
    if (disposed) return undefined;
    var bridge = normalizeBridgeMessage(message);
    if (!bridge || typeof bridge.type !== 'string') return undefined;
    if (STREAM_TYPES[bridge.type]) {
      invokeTransportSend(transport, bridge.type, bridge.payload || {});
      return { ok: true };
    }
    if (CONTROL_TYPES[bridge.type]) {
      await handleControl(bridge.type, bridge.payload || {}, sender || null);
      return { ok: true };
    }
    return undefined;
  }

  function handleTransportMessage(message) {
    var bridge = normalizeBridgeMessage(message);
    if (!bridge || !CONTROL_TYPES[bridge.type]) return;
    handleControl(bridge.type, bridge.payload || {}, null).catch(function handleControlFailure(error) {
      logWarn('transport-control-failed', error);
    });
  }

  var runtimeListener = function runtimeListener(message, sender) {
    return handleRuntimeMessage(message, sender);
  };
  var alarmListener = function alarmListener(alarm) {
    return handleWatchdog(alarm);
  };

  var handle = {
    install: async function install() {
      if (disposed) throw new Error('extension-adapter-disposed');
      if (installed) return handle;
      installed = true;
      chrome.runtime.onMessage.addListener(runtimeListener);
      chrome.alarms.onAlarm.addListener(alarmListener);
      if (transport && typeof transport.onMessage === 'function') {
        unsubscribeTransport = transport.onMessage(handleTransportMessage);
      }
      var restored = await readSessionState();
      if (restored && restored.streamingActive) armWatchdog();
      return handle;
    },
    dispose: function dispose() {
      disposed = true;
      if (hasRemoveListener(chrome.runtime.onMessage)) {
        chrome.runtime.onMessage.removeListener(runtimeListener);
      }
      if (hasRemoveListener(chrome.alarms.onAlarm)) {
        chrome.alarms.onAlarm.removeListener(alarmListener);
      }
      if (typeof unsubscribeTransport === 'function') {
        unsubscribeTransport();
      }
    },
    sendControl: function sendControl(type, payload) {
      if (!CONTROL_TYPES[type]) return Promise.reject(new Error('extension-control-type-required'));
      return handleControl(type, payload || {}, null);
    },
    getSessionState: function getSessionState() {
      return cloneSessionState(sessionState);
    }
  };

  return handle;
}

/**
 * Return classic content-script source that bridges capture messages to the
 * MV3 service worker.
 *
 * @returns {string}
 */
export function createExtensionContentBridge() {
  return "(function(){window.__phantomStreamBridge=function(msg){try{var result=chrome.runtime.sendMessage({type:'"
    + BRIDGE_MESSAGE_TYPE
    + "',message:msg});if(result&&typeof result.catch==='function')result.catch(function(){});}catch(e){}};}());";
}
