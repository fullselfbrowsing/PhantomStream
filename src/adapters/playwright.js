// PhantomStream Playwright/CDP adapter.
//
// The adapter is the authorization boundary for viewer-originated remote
// control. It installs the page bridge, forwards main-frame capture messages,
// and replays approved control frames through Playwright or CDP driver APIs.

import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import {
  CONTROL,
  REMOTE_CONTROL,
  REMOTE_CONTROL_STATE,
  STREAM,
  createRemoteControlStateEvent,
  isRemoteControlType,
  validateRemoteControlMessage,
} from '../protocol/index.js';

var DEFAULT_BINDING_NAME = '__phantomStreamBridge';
var INJECT_TOKEN_DECLARATION = 'var PHANTOM_STREAM_BRIDGE_TOKEN = "";';
var INJECT_CAPTURE_OPTIONS_DECLARATION = 'var PHANTOM_STREAM_CAPTURE_OPTIONS = {};';

/**
 * Read the checked-in classic-script inject artifact.
 *
 * @returns {string}
 */
export function getPlaywrightInjectSource(options) {
  return buildPlaywrightInjectSource(options);
}

function buildPlaywrightInjectSource(options) {
  var source = readFileSync(
    fileURLToPath(new URL('./playwright-inject.js', import.meta.url)),
    'utf8'
  );
  var opts = options || {};
  var captureOptions = normalizeCaptureOptions(opts);
  var out = source.replace(
    INJECT_CAPTURE_OPTIONS_DECLARATION,
    'var PHANTOM_STREAM_CAPTURE_OPTIONS = ' + JSON.stringify(captureOptions) + ';'
  );
  if (!Object.prototype.hasOwnProperty.call(opts, 'bridgeToken')) return out;
  return out.replace(
    INJECT_TOKEN_DECLARATION,
    'var PHANTOM_STREAM_BRIDGE_TOKEN = ' + JSON.stringify(String(opts.bridgeToken || '')) + ';'
  );
}

function normalizeCaptureOptions(options) {
  var opts = options || {};
  var captureOptions = opts.captureOptions || {};
  if (captureOptions && captureOptions.styleMode === 'cssom') {
    return { styleMode: 'cssom' };
  }
  return {};
}

/**
 * Create a Playwright/CDP adapter for one driven page.
 *
 * @param {Object} options
 * @returns {Object}
 */
export function createPlaywrightAdapter(options) {
  var cfg = options || {};
  var page = cfg.page;
  var transport = cfg.transport;
  if (!page || Object(page) !== page) throw new Error('playwright-page-required');
  if (!transport || typeof transport.send !== 'function') throw new Error('transport-send-required');

  var bindingName = typeof cfg.bindingName === 'string' && cfg.bindingName
    ? cfg.bindingName
    : DEFAULT_BINDING_NAME;
  var bridgeToken = randomBytes(32).toString('base64url');
  var allowedBridgeTypes = new Set(Object.keys(STREAM).map(function(key) {
    return STREAM[key];
  }));
  var authorizeControl = typeof cfg.authorizeControl === 'function'
    ? cfg.authorizeControl
    : function () { return false; };
  var logger = cfg.logger || {
    info: function () {},
    warn: function () {},
    error: function () {}
  };

  var installed = false;
  var disposed = false;
  var cdpSession = cfg.cdpSession || null;
  var controlState = REMOTE_CONTROL_STATE.LOCKED;
  var controlReason = 'initial';
  var counts = {
    requested: 0,
    approved: 0,
    denied: 0,
    stopped: 0,
    dispatches: 0,
    blocked: 0,
    invalid: 0,
  };
  var eventHandlers = new Map();
  var pageListeners = [];
  var unsubscribeTransport = null;
  var installPromise = null;

  function safeLog(level, message, detail) {
    try {
      if (logger && typeof logger[level] === 'function') logger[level](message, detail);
    } catch (e) { /* logging must not affect adapter behavior */ }
  }

  function emit(eventName, event) {
    var handlers = eventHandlers.get(eventName);
    if (!handlers) return;
    handlers.forEach(function (handler) {
      try {
        handler(cloneEvent(event));
      } catch (err) {
        safeLog('error', '[PlaywrightAdapter] event handler failed', { eventName: eventName });
      }
    });
  }

  function on(eventName, handler) {
    if (typeof eventName !== 'string' || typeof handler !== 'function') {
      throw new Error('adapter-event-unsupported');
    }
    var handlers = eventHandlers.get(eventName);
    if (!handlers) {
      handlers = new Set();
      eventHandlers.set(eventName, handlers);
    }
    handlers.add(handler);
    return function unsubscribeAdapterEvent() {
      handlers.delete(handler);
    };
  }

  function cloneEvent(event) {
    if (!event || Object(event) !== event) return event;
    return JSON.parse(JSON.stringify(event));
  }

  function stateEvent(state, reason) {
    return createRemoteControlStateEvent(state, reason, { counts: counts });
  }

  function setControlState(state, reason) {
    controlState = state;
    controlReason = reason || '';
    var event = stateEvent(state, controlReason);
    try {
      transport.send(REMOTE_CONTROL.STATE, event);
    } catch (err) {
      safeLog('error', '[PlaywrightAdapter] control state send failed', { reason: 'state-send-failed' });
    }
    emit('controlstate', event);
    return event;
  }

  function getControlState() {
    return stateEvent(controlState, controlReason);
  }

  function mainFrame() {
    try {
      return typeof page.mainFrame === 'function' ? page.mainFrame() : null;
    } catch (err) {
      safeLog('warn', '[PlaywrightAdapter] mainFrame lookup failed', { reason: 'main-frame-failed' });
      return null;
    }
  }

  function isMainFrame(frame) {
    if (!frame) return true;
    var main = mainFrame();
    return !main || frame === main;
  }

  async function bindingCallback(caller, msg) {
    if (disposed) return { ok: false, error: 'adapter-disposed' };
    if (caller && caller.page && caller.page !== page) {
      return { ok: false, error: 'page-ignored' };
    }
    if (caller && caller.frame && !isMainFrame(caller.frame)) {
      return { ok: false, error: 'frame-ignored' };
    }
    if (!msg || Object(msg) !== msg || typeof msg.type !== 'string') {
      return { ok: false, error: 'bridge-message-invalid' };
    }
    if (msg.token !== bridgeToken) {
      return { ok: false, error: 'bridge-token-invalid' };
    }
    if (!allowedBridgeTypes.has(msg.type)) {
      return { ok: false, error: 'bridge-type-invalid' };
    }
    try {
      transport.send(msg.type, msg.payload || {});
      emit('bridge', { type: msg.type });
      return { ok: true };
    } catch (err) {
      safeLog('error', '[PlaywrightAdapter] bridge forward failed', { reason: 'bridge-forward-failed' });
      return { ok: false, error: 'bridge-forward-failed' };
    }
  }

  async function ensureCDPSession() {
    if (cdpSession) return cdpSession;
    if (typeof cfg.cdpSessionFactory !== 'function') return null;
    cdpSession = await cfg.cdpSessionFactory(page);
    return cdpSession || null;
  }

  function addPageListener(eventName, handler) {
    if (typeof page.on !== 'function') return;
    page.on(eventName, handler);
    pageListeners.push({ eventName: eventName, handler: handler });
  }

  function removePageListeners() {
    if (typeof page.off !== 'function' && typeof page.removeListener !== 'function') {
      pageListeners = [];
      return;
    }
    pageListeners.forEach(function (entry) {
      try {
        if (typeof page.off === 'function') {
          page.off(entry.eventName, entry.handler);
        } else {
          page.removeListener(entry.eventName, entry.handler);
        }
      } catch (err) { /* best-effort cleanup */ }
    });
    pageListeners = [];
  }

  async function startInjectedCapture() {
    if (disposed) return false;
    try {
      return await page.evaluate(function () {
        if (typeof document === 'undefined' || !document.body) return false;
        return !!(window.__phantomStreamStart && window.__phantomStreamStart());
      });
    } catch (err) {
      safeLog('warn', '[PlaywrightAdapter] injected capture restart failed', { reason: 'capture-restart-failed' });
      return false;
    }
  }

  function cloneSubtreeRequestPayload(payload) {
    var request = {};
    if (!payload || Object(payload) !== payload) return request;
    ['requestId', 'nid', 'streamSessionId', 'snapshotId', 'reason'].forEach(function (key) {
      if (Object.prototype.hasOwnProperty.call(payload, key)) request[key] = payload[key];
    });
    return request;
  }

  async function forwardSubtreeRequest(payload) {
    if (disposed) return { ok: false, error: 'adapter-disposed' };
    try {
      await page.evaluate(function (controlFrame) {
        if (typeof window === 'undefined') return false;
        var handle = window.__phantomStreamHandleControl;
        if (typeof handle !== 'function') return false;
        return handle(controlFrame.type, controlFrame.payload || {});
      }, {
        type: CONTROL.SUBTREE_REQUEST,
        payload: cloneSubtreeRequestPayload(payload)
      });
      return { ok: true };
    } catch (err) {
      safeLog('warn', '[PlaywrightAdapter] subtree request forward failed', { reason: 'subtree-request-forward-failed' });
      return { ok: false, error: 'subtree-request-forward-failed' };
    }
  }

  function handleNavigation(frame) {
    if (frame && !isMainFrame(frame)) return;
    startInjectedCapture();
  }

  async function install() {
    if (installed) return installPromise || Promise.resolve(handle);
    installPromise = (async function runInstall() {
      var injectSource = buildPlaywrightInjectSource({
        bridgeToken: bridgeToken,
        captureOptions: cfg.captureOptions || {}
      });
      if (typeof page.exposeBinding !== 'function') throw new Error('page-expose-binding-required');
      if (typeof page.addInitScript !== 'function') throw new Error('page-add-init-script-required');

      await page.exposeBinding(bindingName, bindingCallback);
      await page.addInitScript({ content: injectSource });

      var session = await ensureCDPSession();
      if (session && typeof session.send === 'function') {
        await session.send('Page.addScriptToEvaluateOnNewDocument', { source: injectSource });
      }

      addPageListener('framenavigated', handleNavigation);
      addPageListener('domcontentloaded', function () { handleNavigation(null); });
      addPageListener('load', function () { handleNavigation(null); });

      if (transport && typeof transport.onMessage === 'function') {
        unsubscribeTransport = transport.onMessage(function (type, payload) {
          if (type === CONTROL.START) {
            startInjectedCapture();
            return;
          }
          if (type === CONTROL.SUBTREE_REQUEST) {
            forwardSubtreeRequest(payload).catch(function () {
              safeLog('warn', '[PlaywrightAdapter] subtree request forward failed', { reason: 'subtree-request-forward-failed' });
            });
            return;
          }
          if (isRemoteControlType(type)) {
            handleControlMessage(type, payload).catch(function () {
              safeLog('error', '[PlaywrightAdapter] control message failed', { reason: 'control-message-failed' });
              setControlState(controlState, 'control-dispatch-failed');
            });
          }
        });
      }

      installed = true;
      emit('install', { bindingName: bindingName });
      return handle;
    })();
    return installPromise;
  }

  function dispose() {
    disposed = true;
    removePageListeners();
    if (typeof unsubscribeTransport === 'function') {
      try {
        unsubscribeTransport();
      } catch (err) { /* best-effort cleanup */ }
      unsubscribeTransport = null;
    }
    eventHandlers.clear();
  }

  async function requestControl(payload) {
    var p = payload && Object(payload) === payload ? payload : {};
    counts.requested += 1;
    setControlState(REMOTE_CONTROL_STATE.REQUESTING, 'control-requested');

    var approved = false;
    try {
      approved = await authorizeControl({
        requestId: typeof p.requestId === 'string' ? p.requestId : '',
        source: 'viewer',
        authorizationMode: typeof p.authorizationMode === 'string' ? p.authorizationMode : 'host',
      });
    } catch (err) {
      approved = false;
      safeLog('warn', '[PlaywrightAdapter] control authorization failed', { reason: 'authorization-failed' });
    }

    if (!approved) {
      counts.denied += 1;
      setControlState(REMOTE_CONTROL_STATE.DENIED, 'authorization-denied');
      return false;
    }

    counts.approved += 1;
    setControlState(REMOTE_CONTROL_STATE.ACTIVE, 'authorization-approved');
    return true;
  }

  function stopControl(reason) {
    counts.stopped += 1;
    setControlState(REMOTE_CONTROL_STATE.STOPPED, sanitizeReason(reason) || 'control-stopped');
    return true;
  }

  async function handleControlMessage(type, payload) {
    var result = validateRemoteControlMessage(type, payload || {});
    if (!result.ok) {
      counts.invalid += 1;
      setControlState(controlState, result.error);
      return { ok: false, error: result.error };
    }

    var action = result.action;
    if (action.kind === 'request') {
      return { ok: await requestControl(payload || {}) };
    }
    if (action.kind === 'stop') {
      stopControl(payload && payload.reason);
      return { ok: true };
    }

    return dispatchRemoteAction(action);
  }

  async function dispatchRemoteAction(action) {
    if (controlState !== REMOTE_CONTROL_STATE.ACTIVE) {
      counts.blocked += 1;
      setControlState(controlState === REMOTE_CONTROL_STATE.DENIED
        ? REMOTE_CONTROL_STATE.DENIED
        : controlState, 'control-inactive');
      return { ok: false, error: 'control-inactive' };
    }

    var result = validateRemoteControlMessage(action.type, action);
    if (!result.ok) {
      counts.invalid += 1;
      setControlState(controlState, result.error);
      return { ok: false, error: result.error };
    }

    var normalized = result.action;
    if (normalized.kind === 'request' || normalized.kind === 'stop') {
      return handleControlMessage(normalized.type, normalized);
    }

    if (controlState !== REMOTE_CONTROL_STATE.ACTIVE) {
      counts.blocked += 1;
      setControlState(controlState, 'control-inactive');
      return { ok: false, error: 'control-inactive' };
    }

    var session = await ensureCDPSession();
    if (session && typeof session.send === 'function') {
      await dispatchWithCDP(session, normalized);
    } else {
      await dispatchWithPlaywright(normalized);
    }

    counts.dispatches += 1;
    emit('controlaction', { kind: normalized.kind });
    return { ok: true };
  }

  async function dispatchWithPlaywright(action) {
    if (action.kind === 'click') {
      await page.mouse.click(action.x, action.y, {
        button: action.button,
        clickCount: action.clickCount,
      });
      return;
    }
    if (action.kind === 'text') {
      await page.keyboard.insertText(action.text);
      return;
    }
    if (action.kind === 'key') {
      if (action.event === 'down') {
        await page.keyboard.down(action.key);
      } else {
        await page.keyboard.up(action.key);
      }
      return;
    }
    if (action.kind === 'scroll') {
      if (page.mouse && typeof page.mouse.move === 'function') {
        await page.mouse.move(action.x, action.y);
      }
      await page.mouse.wheel(action.deltaX, action.deltaY);
    }
  }

  async function dispatchWithCDP(session, action) {
    if (action.kind === 'click') {
      await session.send('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: action.x,
        y: action.y,
        button: 'none',
        buttons: 0,
      });
      await session.send('Input.dispatchMouseEvent', {
        type: 'mousePressed',
        x: action.x,
        y: action.y,
        button: action.button,
        buttons: buttonMask(action.button),
        clickCount: action.clickCount,
      });
      await session.send('Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        x: action.x,
        y: action.y,
        button: action.button,
        buttons: 0,
        clickCount: action.clickCount,
      });
      return;
    }
    if (action.kind === 'text') {
      await session.send('Input.insertText', { text: action.text });
      return;
    }
    if (action.kind === 'key') {
      await session.send('Input.dispatchKeyEvent', {
        type: action.event === 'down' ? 'keyDown' : 'keyUp',
        key: action.key,
      });
      return;
    }
    if (action.kind === 'scroll') {
      await session.send('Input.dispatchMouseEvent', {
        type: 'mouseWheel',
        x: action.x,
        y: action.y,
        deltaX: action.deltaX,
        deltaY: action.deltaY,
      });
    }
  }

  function buttonMask(button) {
    if (button === 'right') return 2;
    if (button === 'middle') return 4;
    return 1;
  }

  function sanitizeReason(reason) {
    return typeof reason === 'string' && /^[a-z0-9-]+$/.test(reason) ? reason : '';
  }

  var handle = {
    install: install,
    dispose: dispose,
    requestControl: requestControl,
    stopControl: stopControl,
    handleControlMessage: handleControlMessage,
    dispatchRemoteAction: dispatchRemoteAction,
    on: on,
    getControlState: getControlState,
  };

  return handle;
}
