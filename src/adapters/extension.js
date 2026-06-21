// PhantomStream Chromium MV3 adapter surface.
//
// This module is intentionally framework-free so it can run in a service
// worker bundle or be unit-tested with a fake Chrome API.

import { CONTROL, STREAM, classifyManifest } from '../protocol/messages.js';

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

function hasWebRequestOnCompleted(chrome) {
  return !!(chrome && chrome.webRequest && hasAddListener(chrome.webRequest.onCompleted));
}

// The core MV3 surface is always hard-required. The powerful chrome.webRequest
// permission is required ONLY when manifest discovery is opted in, and even then
// its absence DEGRADES GRACEFULLY (no throw, no listener, emit nothing) rather
// than failing the adapter — the discovery returns a capability flag instead.
function validateChrome(chrome, discoverManifests) {
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
  // When opted in, report whether the discovery permission is available; never
  // throw on its absence (graceful degradation is the contract).
  return { manifestDiscoveryAvailable: discoverManifests ? hasWebRequestOnCompleted(chrome) : false };
}

function cleanString(value) {
  return typeof value === 'string' && value ? value : null;
}

function cleanTabId(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
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

  // Opt-in, off-by-default adaptive-manifest discovery (MADPT-02). chrome.webRequest
  // is required ONLY when opted in, and its absence degrades gracefully.
  var discoverManifests = opts.discoverManifests === true;
  var validation = validateChrome(chrome, discoverManifests);
  var manifestDiscoveryAvailable = !!(validation && validation.manifestDiscoveryAvailable);
  var resolveActiveMediaNid = typeof opts.resolveActiveMediaNid === 'function'
    ? opts.resolveActiveMediaNid
    : function () { return null; };
  // The hint is stamped with the same stream identity the adapter already
  // forwards on the STREAM frames it relays, snooped from those payloads.
  var currentIdentity = { streamSessionId: '', snapshotId: 0 };

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
    // Narrow the manifest observer to the streamed tab once its id is known (or
    // re-scope if it changed). No-op when discovery is off or the scope already
    // matches; the in-handler tabId check covers the window before this fires.
    rearmManifestObserverForTab();
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
      observeStreamIdentity(bridge.payload);
      invokeTransportSend(transport, bridge.type, bridge.payload || {});
      return { ok: true };
    }
    if (CONTROL_TYPES[bridge.type]) {
      await handleControl(bridge.type, bridge.payload || {}, sender || null);
      return { ok: true };
    }
    return undefined;
  }

  function dispatchTransportControl(type, payload) {
    if (typeof type !== 'string' || !CONTROL_TYPES[type]) return null;
    return handleControl(type, payload || {}, null).catch(function handleControlFailure(error) {
      logWarn('transport-control-failed', error);
    });
  }

  // The transport may dispatch as (type, payload) — the createWebSocketTransport
  // onMessage contract — or hand us a single { type, payload } message object.
  // Support both. Returns the in-flight control promise so callers can await the
  // persist + forward; the transport itself discards the return value.
  function handleTransportMessage(messageOrType, maybePayload) {
    if (typeof messageOrType === 'string') {
      return dispatchTransportControl(messageOrType, maybePayload);
    }
    var bridge = normalizeBridgeMessage(messageOrType);
    if (!bridge) return null;
    return dispatchTransportControl(bridge.type, bridge.payload || {});
  }

  // Snoop the stream identity off the side-channel STREAM payloads the adapter
  // relays so an emitted hint carries the same identity. Missing fields are
  // ignored (the viewer's isCurrentStream accepts an empty-identity hint until a
  // real identity has been observed).
  function observeStreamIdentity(payload) {
    if (!payload || Object(payload) !== payload) return;
    if (typeof payload.streamSessionId === 'string' && payload.streamSessionId) {
      currentIdentity.streamSessionId = payload.streamSessionId;
    }
    if (typeof payload.snapshotId === 'number' && Number.isFinite(payload.snapshotId)) {
      currentIdentity.snapshotId = payload.snapshotId;
    }
  }

  // Read the content-type from the Chromium responseHeaders array (an array of
  // { name, value }; the header name may be any casing).
  function contentTypeOf(responseHeaders) {
    if (!Array.isArray(responseHeaders)) return '';
    for (var i = 0; i < responseHeaders.length; i += 1) {
      var header = responseHeaders[i];
      if (header && typeof header.name === 'string'
          && header.name.toLowerCase() === 'content-type') {
        return typeof header.value === 'string' ? header.value : '';
      }
    }
    return '';
  }

  // Best-effort manifest observation. Classifies a completed response via the
  // pure classifyManifest filter and, on a non-null kind, emits STREAM.MEDIA_HINT
  // through the same transport.send path. Fully contained so a hostile details
  // object can never wedge the observer.
  function handleManifestCompleted(details) {
    if (disposed || !discoverManifests) return;
    try {
      if (!details || typeof details.url !== 'string') return;
      // Streamed-tab scope: drop a response from an UNRELATED tab so a manifest
      // fetched elsewhere can never bind the streamed page's media element. The
      // filter below also narrows at the API level once the tab id is known;
      // this in-handler check is the robust guarantee (works even if the filter
      // could not be scoped at arm time, or the browser ignored it). When the
      // streamed tab id is unknown, or the details carry no tabId, accept
      // (graceful: the prior <all_urls> behavior).
      if (sessionState && sessionState.tabId != null
          && typeof details.tabId === 'number'
          && details.tabId !== sessionState.tabId) {
        return;
      }
      var contentType = contentTypeOf(details.responseHeaders);
      var kind = classifyManifest({ url: details.url, contentType: contentType });
      if (!kind) return;
      emitMediaHint(details.url, kind, contentType);
    } catch (error) {
      logWarn('manifest-observe-failed', error);
    }
  }

  function emitMediaHint(manifestUrl, kind, contentType) {
    if (!transport || typeof transport.send !== 'function') return;
    var payload = {
      scope: 'page',
      manifestUrl: manifestUrl,
      kind: kind,
      streamSessionId: currentIdentity.streamSessionId,
      snapshotId: currentIdentity.snapshotId
    };
    if (contentType) payload.contentType = contentType;
    var nid = null;
    try {
      nid = resolveActiveMediaNid();
    } catch (error) {
      nid = null; // correlation is best-effort; failure -> page scope
    }
    if (typeof nid === 'string' && nid) {
      payload.scope = 'element';
      payload.nid = nid;
    }
    try {
      transport.send(STREAM.MEDIA_HINT, payload);
    } catch (error) {
      logWarn('media-hint-send-failed', error);
    }
  }

  var manifestListener = function manifestListener(details) {
    return handleManifestCompleted(details);
  };

  // Whether the manifest listener is currently registered, and the tab id its
  // filter was scoped to (null = the broad <all_urls> filter). Tracked so the
  // observer can re-register a narrower per-tab filter once the streamed tab id
  // becomes known (it is absent at install time -- armManifestObserver runs
  // before readSessionState rehydrates sessionState).
  var manifestObserverArmed = false;
  var manifestObserverTabId = null;

  function manifestFilter() {
    var tabId = (sessionState && sessionState.tabId != null) ? sessionState.tabId : null;
    // Restrict to the streamed tab at the API level when known; the in-handler
    // check is the belt-and-suspenders guarantee regardless. Omit tabId (broad
    // filter) until the streamed tab id is observed.
    return tabId != null
      ? { urls: ['<all_urls>'], tabId: tabId }
      : { urls: ['<all_urls>'] };
  }

  function armManifestObserver() {
    if (!discoverManifests) return;
    if (!manifestDiscoveryAvailable) {
      // Opted in but the permission/API is absent: graceful no-op (no listener,
      // no hint, no throw). The progressive path is unaffected.
      logWarn('manifest-discovery-unavailable');
      return;
    }
    if (manifestObserverArmed) return;
    try {
      chrome.webRequest.onCompleted.addListener(
        manifestListener,
        manifestFilter(),
        ['responseHeaders']
      );
      manifestObserverArmed = true;
      manifestObserverTabId = (sessionState && sessionState.tabId != null) ? sessionState.tabId : null;
    } catch (error) {
      logWarn('manifest-observer-arm-failed', error);
    }
  }

  // Re-register the observer with a tab-scoped filter when the streamed tab id
  // first becomes known (or changes). A no-op when discovery is off/unavailable,
  // when no listener is armed, or when the scope is already correct.
  function rearmManifestObserverForTab() {
    if (!discoverManifests || !manifestDiscoveryAvailable) return;
    if (!manifestObserverArmed) return;
    var tabId = (sessionState && sessionState.tabId != null) ? sessionState.tabId : null;
    if (tabId === manifestObserverTabId) return;
    disarmManifestObserver();
    armManifestObserver();
  }

  function disarmManifestObserver() {
    if (!manifestDiscoveryAvailable) return;
    try {
      if (chrome.webRequest && hasRemoveListener(chrome.webRequest.onCompleted)) {
        chrome.webRequest.onCompleted.removeListener(manifestListener);
      }
    } catch (error) { /* best-effort cleanup */ }
    manifestObserverArmed = false;
    manifestObserverTabId = null;
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
      armManifestObserver();
      if (transport && typeof transport.onMessage === 'function') {
        unsubscribeTransport = transport.onMessage(handleTransportMessage);
      }
      var restored = await readSessionState();
      // armManifestObserver ran before sessionState was rehydrated; if the
      // restored session names the streamed tab, re-scope the filter to it now.
      rearmManifestObserverForTab();
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
      disarmManifestObserver();
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
