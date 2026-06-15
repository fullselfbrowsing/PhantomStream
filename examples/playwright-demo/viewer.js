import { createViewer, mapHostPointToViewport } from '../../src/renderer/index.js';
import { createWebSocketTransport } from '../../src/transport/websocket.js';
import { CONTROL, STREAM, REMOTE_CONTROL, REMOTE_CONTROL_STATE } from '../../src/protocol/index.js';

var params = new URLSearchParams(window.location.search);
var room = params.get('room') || '';
var roomPrefix = room ? room.slice(0, 8) : 'unknown';
var wsUrl = buildViewerWsUrl(params);

var lifecycleBadge = document.getElementById('lifecycle-badge');
var lifecycleLabel = document.getElementById('lifecycle-label');
var viewerLifecycle = document.getElementById('viewer-lifecycle');
var viewerRoom = document.getElementById('viewer-room');
var viewerRelay = document.getElementById('viewer-relay');
var adapterState = document.getElementById('adapter-state');
var viewerLastFrame = document.getElementById('viewer-last-frame');
var navigationCount = document.getElementById('navigation-count');
var stage = document.getElementById('mirror-stage');
var overlay = document.getElementById('control-overlay');
var requestButton = document.getElementById('request-control');
var stopButton = document.getElementById('stop-control');
var controlBadge = document.getElementById('control-badge');
var controlLabel = document.getElementById('control-label');
var controlLastAction = document.getElementById('control-last-action');
var denialMessage = document.getElementById('denial-message');
var actionLog = document.getElementById('action-log');

var healthFrames = document.getElementById('health-frames');
var healthSnapshots = document.getElementById('health-snapshots');
var healthMutations = document.getElementById('health-mutations');
var healthMisses = document.getElementById('health-misses');
var healthApplyFailures = document.getElementById('health-apply-failures');
var healthDrops = document.getElementById('health-drops');
var healthErrors = document.getElementById('health-errors');
var healthControlRequests = document.getElementById('health-control-requests');
var healthDenied = document.getElementById('health-denied');
var healthDispatched = document.getElementById('health-dispatched');
var healthNavs = document.getElementById('health-navs');

var lifecycleState = 'connecting';
var controlState = REMOTE_CONTROL_STATE.LOCKED;
var requestSequence = 0;
var controlCounters = {
  requests: 0,
  denied: 0,
  dispatched: 0
};

viewerRoom.textContent = roomPrefix;

var logger = {
  info: function () {},
  warn: function () {},
  error: function () {
    logLine('Mirror could not render — open the browser console for details.');
  }
};

var transport = createWebSocketTransport({
  url: wsUrl,
  role: 'viewer',
  logger: logger
});

var viewer = createViewer({
  container: stage,
  transport: transport,
  disconnectDelayMs: 4000,
  logger: logger
});

function buildViewerWsUrl(query) {
  var raw = query.get('ws') || '';
  var url;
  if (raw) {
    url = new URL(raw, window.location.href);
  } else {
    url = new URL('/ws', window.location.href);
    url.protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  }
  if (room) url.searchParams.set('room', room);
  url.searchParams.set('role', 'viewer');
  return url.toString();
}

function logLine(text) {
  var line = document.createElement('div');
  line.textContent = new Date().toLocaleTimeString() + ' ' + text;
  actionLog.appendChild(line);
  while (actionLog.children.length > 8) {
    actionLog.removeChild(actionLog.firstElementChild);
  }
}

function labelForLifecycle(state) {
  if (state === 'live') return 'Live';
  if (state === 'stale') return 'Stale';
  if (state === 'disconnected') return 'Disconnected';
  return 'Connecting';
}

function setLifecycle(state) {
  lifecycleState = normalizeLifecycle(state);
  var label = labelForLifecycle(lifecycleState);
  lifecycleBadge.classList.remove('state-connecting', 'state-live', 'state-stale', 'state-disconnected');
  lifecycleBadge.classList.add('state-' + lifecycleState);
  lifecycleLabel.textContent = label;
  viewerLifecycle.textContent = label;
  if (lifecycleState === 'disconnected') {
    logLine('Relay disconnected — restart the Playwright demo and refresh this page.');
  }
  updateControlButtons();
}

function normalizeLifecycle(state) {
  if (state === 'live' || state === 'stale' || state === 'disconnected') return state;
  return 'connecting';
}

function normalizeControlState(state) {
  if (state === REMOTE_CONTROL_STATE.REQUESTING ||
      state === REMOTE_CONTROL_STATE.ACTIVE ||
      state === REMOTE_CONTROL_STATE.DENIED ||
      state === REMOTE_CONTROL_STATE.STOPPED) {
    return state;
  }
  return REMOTE_CONTROL_STATE.LOCKED;
}

function setControlState(state, source) {
  controlState = normalizeControlState(state);
  adapterState.textContent = controlState;
  controlBadge.classList.remove(
    'state-locked',
    'state-requesting',
    'state-active',
    'state-denied',
    'state-stopped'
  );
  controlBadge.classList.add('state-' + controlState);
  controlLabel.textContent = controlState;
  stage.classList.toggle('control-active', controlState === REMOTE_CONTROL_STATE.ACTIVE);
  overlay.style.pointerEvents = controlState === REMOTE_CONTROL_STATE.ACTIVE ? 'auto' : 'none';
  denialMessage.hidden = controlState !== REMOTE_CONTROL_STATE.DENIED;

  if (controlState === REMOTE_CONTROL_STATE.ACTIVE) {
    controlLastAction.textContent = 'Control active';
    stage.focus({ preventScroll: true });
  } else if (controlState === REMOTE_CONTROL_STATE.DENIED) {
    controlLastAction.textContent = 'Action blocked: control locked';
    if (source !== 'local') logLine('Remote control denied');
  } else if (controlState === REMOTE_CONTROL_STATE.STOPPED) {
    controlLastAction.textContent = 'Action blocked: control locked';
  }

  updateControlButtons();
}

function updateControlButtons() {
  var disabled = lifecycleState !== 'live' || controlState === REMOTE_CONTROL_STATE.REQUESTING;
  requestButton.disabled = disabled;
  requestButton.setAttribute('aria-disabled', String(disabled));
  requestButton.textContent = controlState === REMOTE_CONTROL_STATE.REQUESTING
    ? 'Requesting control'
    : 'Request control';
  stopButton.hidden = controlState !== REMOTE_CONTROL_STATE.ACTIVE;
}

function formatTime(ts) {
  return ts ? new Date(ts).toLocaleTimeString() : 'never';
}

function count(map, type) {
  return map && map[type] ? map[type] : 0;
}

function sumCounts(map) {
  var total = 0;
  map = map || {};
  Object.keys(map).forEach(function (key) {
    total += map[key] || 0;
  });
  return total;
}

function syncControlCounts(counts) {
  if (!counts || Object(counts) !== counts) return;
  if (Number.isFinite(counts.requested)) controlCounters.requests = counts.requested;
  if (Number.isFinite(counts.denied)) controlCounters.denied = counts.denied;
  if (Number.isFinite(counts.dispatches)) controlCounters.dispatched = counts.dispatches;
  renderControlCounts();
}

function renderControlCounts() {
  healthControlRequests.textContent = String(controlCounters.requests);
  healthDenied.textContent = String(controlCounters.denied);
  healthDispatched.textContent = String(controlCounters.dispatched);
}

function getAuthorizationMode() {
  var selected = document.querySelector('input[name="authorization-mode"]:checked');
  return selected && selected.value === 'approve' ? 'approve' : 'deny';
}

function sendControlFrame(type, payload) {
  transport.send(type, payload || {});
}

function requestControl() {
  if (lifecycleState !== 'live' || controlState === REMOTE_CONTROL_STATE.REQUESTING) {
    blockAction('Action blocked: control locked');
    return;
  }
  requestSequence += 1;
  controlCounters.requests += 1;
  renderControlCounts();
  setControlState(REMOTE_CONTROL_STATE.REQUESTING, 'local');
  sendControlFrame(REMOTE_CONTROL.REQUEST, {
    requestId: 'viewer-' + Date.now().toString(36) + '-' + requestSequence,
    authorizationMode: getAuthorizationMode()
  });
  logLine('Control requested');
}

function stopControl(reason) {
  sendControlFrame(REMOTE_CONTROL.STOP, { reason: reason || 'viewer-stop' });
  setControlState(REMOTE_CONTROL_STATE.STOPPED, 'local');
  logLine('Control stopped');
}

function blockAction(message) {
  controlLastAction.textContent = message;
  logLine(message);
}

function mapEventToViewport(event) {
  var rect = stage.getBoundingClientRect();
  var mapping = viewer.getViewportMapping();
  return mapHostPointToViewport({
    x: event.clientX - rect.left,
    y: event.clientY - rect.top
  }, mapping.scale);
}

function sendMappedAction(event, type, payloadForPoint, feedback) {
  if (controlState !== REMOTE_CONTROL_STATE.ACTIVE) {
    blockAction('Action blocked: control locked');
    return;
  }
  var mapped = mapEventToViewport(event);
  if (!mapped.inside) {
    blockAction('Action blocked: outside mirror');
    return;
  }
  var payload = payloadForPoint(mapped);
  sendControlFrame(type, payload);
  controlCounters.dispatched += 1;
  renderControlCounts();
  feedback(mapped, event);
}

function showClickFeedback(event) {
  var rect = stage.getBoundingClientRect();
  var ring = document.createElement('div');
  ring.className = 'feedback-ring';
  ring.style.left = Math.round(event.clientX - rect.left) + 'px';
  ring.style.top = Math.round(event.clientY - rect.top) + 'px';
  stage.appendChild(ring);
  setTimeout(function () {
    if (ring.parentNode) ring.parentNode.removeChild(ring);
  }, 450);
}

function showTypeFeedback() {
  var chip = document.createElement('div');
  chip.className = 'feedback-chip';
  chip.textContent = 'Type sent';
  stage.appendChild(chip);
  setTimeout(function () {
    if (chip.parentNode) chip.parentNode.removeChild(chip);
  }, 900);
}

function showScrollFeedback(deltaY) {
  var tick = document.createElement('div');
  tick.className = deltaY < 0 ? 'feedback-scroll is-up' : 'feedback-scroll';
  stage.appendChild(tick);
  setTimeout(function () {
    if (tick.parentNode) tick.parentNode.removeChild(tick);
  }, 450);
}

function isPrintableKey(event) {
  return event.key && event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey;
}

overlay.addEventListener('click', function (event) {
  event.preventDefault();
  sendMappedAction(event, REMOTE_CONTROL.CLICK, function (point) {
    return { x: point.x, y: point.y, button: 'left' };
  }, function (point, clickEvent) {
    controlLastAction.textContent = 'Click sent: x ' + point.x + ', y ' + point.y;
    logLine('Click sent: x ' + point.x + ', y ' + point.y);
    showClickFeedback(clickEvent);
  });
});

overlay.addEventListener('wheel', function (event) {
  event.preventDefault();
  sendMappedAction(event, REMOTE_CONTROL.SCROLL, function (point) {
    return {
      x: point.x,
      y: point.y,
      deltaX: Math.round(event.deltaX),
      deltaY: Math.round(event.deltaY)
    };
  }, function (point) {
    var dx = Math.round(event.deltaX);
    var dy = Math.round(event.deltaY);
    controlLastAction.textContent = 'Scroll sent: dx ' + dx + ', dy ' + dy;
    logLine('Scroll sent: dx ' + dx + ', dy ' + dy);
    showScrollFeedback(dy);
  });
});

stage.addEventListener('keydown', function (event) {
  if (controlState !== REMOTE_CONTROL_STATE.ACTIVE) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    stopControl('viewer-escape');
    return;
  }
  if (isPrintableKey(event)) {
    event.preventDefault();
    var text = event.key;
    sendControlFrame(REMOTE_CONTROL.TEXT, { text: text });
    controlCounters.dispatched += 1;
    renderControlCounts();
    controlLastAction.textContent = 'Type sent: ' + text.length + ' chars';
    logLine('Type sent: ' + text.length + ' chars');
    showTypeFeedback();
    return;
  }
  event.preventDefault();
  sendControlFrame(REMOTE_CONTROL.KEY, { key: event.key, event: 'down' });
  controlCounters.dispatched += 1;
  renderControlCounts();
  controlLastAction.textContent = 'Key sent: ' + event.key;
  logLine('Key sent: ' + event.key);
});

stage.addEventListener('keyup', function (event) {
  if (controlState !== REMOTE_CONTROL_STATE.ACTIVE || isPrintableKey(event)) return;
  if (event.key === 'Escape') return;
  event.preventDefault();
  sendControlFrame(REMOTE_CONTROL.KEY, { key: event.key, event: 'up' });
  controlCounters.dispatched += 1;
  renderControlCounts();
});

requestButton.addEventListener('click', requestControl);
stopButton.addEventListener('click', function () {
  stopControl('viewer-stop');
});

viewer.on('state', function (event) {
  setLifecycle(event.state);
});

viewer.on('health', function (health) {
  var received = health.receivedByType || {};
  var transportHealth = health.transport || {};
  var snapshots = count(received, STREAM.SNAPSHOT);
  var mutations = count(received, STREAM.MUTATIONS);
  var navs = Math.max(0, snapshots - 1);

  if (health.lastFrameAt) stage.classList.add('has-frame');
  viewerLastFrame.textContent = formatTime(health.lastFrameAt);
  healthFrames.textContent = String(sumCounts(received));
  healthSnapshots.textContent = String(snapshots);
  healthMutations.textContent = String(mutations);
  healthMisses.textContent = String(health.staleMisses || 0);
  healthApplyFailures.textContent = String(health.applyFailures || 0);
  healthDrops.textContent = String(transportHealth.drops || 0);
  healthErrors.textContent = String((transportHealth.errors || []).length);
  navigationCount.textContent = String(navs);
  healthNavs.textContent = String(navs);
});

transport.onStatus(function (status) {
  viewerRelay.textContent = status.state || 'unknown';
  if (status.state === 'open') {
    sendControlFrame(CONTROL.START, {
      trigger: 'viewer-open',
      roomPrefix: roomPrefix
    });
    logLine('control: ' + CONTROL.START);
  }
});

transport.onMessage(function (type, payload) {
  if (type !== REMOTE_CONTROL.STATE) return;
  var p = payload || {};
  setControlState(p.state, 'adapter');
  syncControlCounts(p.counts);
});

setControlState(REMOTE_CONTROL_STATE.LOCKED, 'local');
renderControlCounts();

window.__phantomstreamPlaywrightViewer = {
  viewer: viewer,
  transport: transport
};
