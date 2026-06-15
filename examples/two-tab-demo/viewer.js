import { createViewer } from '../../src/renderer/index.js';
import { createWebSocketTransport } from '../../src/transport/websocket.js';
import { CONTROL, STREAM } from '../../src/protocol/messages.js';

var params = new URLSearchParams(window.location.search);
var room = params.get('room') || '';
var wsUrl = params.get('ws') || '';
var roomPrefix = room ? room.slice(0, 8) : 'unknown';

var lifecycleBadge = document.getElementById('lifecycle-badge');
var lifecycleLabel = document.getElementById('lifecycle-label');
var viewerLifecycle = document.getElementById('viewer-lifecycle');
var viewerRoom = document.getElementById('viewer-room');
var viewerLastFrame = document.getElementById('viewer-last-frame');
var viewerRelay = document.getElementById('viewer-relay');
var stage = document.getElementById('mirror-stage');
var log = document.getElementById('viewer-log');

var healthFrames = document.getElementById('health-frames');
var healthSnapshots = document.getElementById('health-snapshots');
var healthMutations = document.getElementById('health-mutations');
var healthMisses = document.getElementById('health-misses');
var healthApplyFailures = document.getElementById('health-apply-failures');
var healthDrops = document.getElementById('health-drops');
var healthErrors = document.getElementById('health-errors');

viewerRoom.textContent = roomPrefix;

var logger = {
  info: function () {},
  warn: function () {},
  error: function () {
    logLine('Mirror could not render - open the browser console for details.');
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
  disconnectDelayMs: 3000
});

function logLine(text) {
  var line = document.createElement('div');
  line.textContent = new Date().toLocaleTimeString() + ' ' + text;
  log.appendChild(line);
  while (log.children.length > 8) log.removeChild(log.firstElementChild);
}

function labelForState(state) {
  if (state === 'live') return 'Live';
  if (state === 'stale') return 'Stale';
  if (state === 'disconnected') return 'Disconnected';
  return 'Connecting';
}

function setLifecycle(state) {
  var label = labelForState(state);
  lifecycleBadge.classList.remove('state-connecting', 'state-live', 'state-stale', 'state-disconnected');
  lifecycleBadge.classList.add('state-' + (state || 'connecting'));
  lifecycleLabel.textContent = label;
  viewerLifecycle.textContent = label;
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

viewer.on('state', function (event) {
  setLifecycle(event.state);
  if (event.state === 'disconnected') {
    logLine('Relay disconnected - restart npx phantom-stream demo and refresh both tabs.');
  }
});

viewer.on('health', function (health) {
  var received = health.receivedByType || {};
  var transportHealth = health.transport || {};
  if (health.lastFrameAt) stage.classList.add('has-frame');
  viewerLastFrame.textContent = formatTime(health.lastFrameAt);
  healthFrames.textContent = String(sumCounts(received));
  healthSnapshots.textContent = String(count(received, STREAM.SNAPSHOT));
  healthMutations.textContent = String(count(received, STREAM.MUTATIONS));
  healthMisses.textContent = String(health.staleMisses || 0);
  healthApplyFailures.textContent = String(health.applyFailures || 0);
  healthDrops.textContent = String(transportHealth.drops || 0);
  healthErrors.textContent = String((transportHealth.errors || []).length);
  if (transportHealth.state) viewerRelay.textContent = transportHealth.state;
});

transport.onStatus(function (status) {
  viewerRelay.textContent = status.state || 'unknown';
  if (status.state === 'open') {
    transport.send(CONTROL.START, {
      trigger: 'viewer-open',
      roomPrefix: roomPrefix
    });
    logLine('control: ' + CONTROL.START);
  }
});

window.__phantomstreamViewer = { viewer: viewer, transport: transport };
