import { createCapture } from '../../src/capture/index.js';
import { createWebSocketTransport } from '../../src/transport/websocket.js';
import { CONTROL } from '../../src/protocol/messages.js';

var params = new URLSearchParams(window.location.search);
var room = params.get('room') || '';
var wsUrl = params.get('ws') || '';
var roomPrefix = room ? room.slice(0, 8) : 'unknown';

var rowsList = document.getElementById('rows');
var captureBadge = document.getElementById('capture-badge');
var captureLabel = document.getElementById('capture-label');
var autoButton = document.getElementById('btn-auto');
var sourceRoom = document.getElementById('source-room');
var sourceRelay = document.getElementById('source-relay');
var sourceSent = document.getElementById('source-sent');
var sourceLastSend = document.getElementById('source-last-send');
var log = document.getElementById('source-log');

sourceRoom.textContent = roomPrefix;

var WORDS = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot',
  'golf', 'hotel', 'india', 'juliett', 'kilo', 'lima'];
var rowCount = 0;
var autoTimer = null;
var capture = null;
var captureActive = false;
var latestRelayState = 'connecting';
var statusFrame = 0;

function logLine(text) {
  var line = document.createElement('div');
  line.textContent = new Date().toLocaleTimeString() + ' ' + text;
  log.appendChild(line);
  while (log.children.length > 8) log.removeChild(log.firstElementChild);
}

var logger = {
  info: function () {},
  warn: function () {},
  error: function () {}
};

var transport = createWebSocketTransport({
  url: wsUrl,
  role: 'source',
  logger: logger
});

var captureTransport = {
  send: function (type, payload) {
    transport.send(type, payload);
    scheduleStatusUpdate();
  },
  flush: function () {
    return transport.flush();
  }
};

function randomWord() {
  return WORDS[Math.floor(Math.random() * WORDS.length)];
}

function addRow() {
  rowCount += 1;
  var li = document.createElement('li');
  li.textContent = 'Row ' + rowCount + ' - ' + randomWord();
  rowsList.appendChild(li);
  scheduleStatusUpdate();
}

function removeRow() {
  if (rowsList.lastElementChild) rowsList.removeChild(rowsList.lastElementChild);
  scheduleStatusUpdate();
}

function editRow() {
  var rows = rowsList.children;
  if (!rows.length) return;
  var target = rows[Math.floor(Math.random() * rows.length)];
  var label = target.textContent.split(' - ')[0];
  target.textContent = label + ' - ' + randomWord();
  scheduleStatusUpdate();
}

function randomMutation() {
  var roll = Math.random();
  if (roll < 0.45 || !rowsList.children.length) addRow();
  else if (roll < 0.65 && rowsList.children.length > 2) removeRow();
  else editRow();
}

function setAutoMutate(on) {
  if (on && autoTimer === null) {
    autoTimer = setInterval(randomMutation, 1000);
  } else if (!on && autoTimer !== null) {
    clearInterval(autoTimer);
    autoTimer = null;
  }
  autoButton.setAttribute('aria-pressed', String(on));
  captureBadge.classList.toggle('paused', !on || !captureActive);
  captureLabel.textContent = on && captureActive ? 'CAPTURING' : 'PAUSED';
}

function getCapture() {
  if (!capture) {
    capture = createCapture({
      transport: captureTransport,
      skipElement: function (el) {
        return !!(el.getAttribute && el.getAttribute('data-phantomstream-ui'));
      }
    });
  }
  return capture;
}

function startCapture(reason) {
  capture = getCapture();
  capture.start();
  captureActive = true;
  setAutoMutate(autoTimer !== null);
  logLine('capture start: ' + reason);
}

function stopCapture(reason) {
  if (!capture) return;
  capture.stop();
  captureActive = false;
  setAutoMutate(autoTimer !== null);
  logLine('capture stop: ' + reason);
}

function pauseCapture(reason) {
  if (!capture) return;
  capture.pause();
  captureActive = false;
  setAutoMutate(autoTimer !== null);
  logLine('capture pause: ' + reason);
}

function resumeCapture(reason) {
  if (!capture) startCapture(reason);
  else capture.resume();
  captureActive = true;
  setAutoMutate(autoTimer !== null);
  logLine('capture resume: ' + reason);
}

function formatTime(ts) {
  return ts ? new Date(ts).toLocaleTimeString() : 'never';
}

function sumCounts(counts) {
  var total = 0;
  counts = counts || {};
  Object.keys(counts).forEach(function (key) {
    total += counts[key] || 0;
  });
  return total;
}

function updateStatus() {
  statusFrame = 0;
  var health = transport.getHealth();
  sourceRelay.textContent = latestRelayState || health.state || 'unknown';
  sourceSent.textContent = String(sumCounts(health.sentByType));
  sourceLastSend.textContent = formatTime(health.lastSendAt);
}

function scheduleStatusUpdate() {
  if (statusFrame) return;
  statusFrame = requestAnimationFrame(function () {
    updateStatus();
    setTimeout(updateStatus, 50);
  });
}

transport.onStatus(function (status) {
  latestRelayState = status.state || 'unknown';
  updateStatus();
  if (status.state === 'open') {
    startCapture('transport-open');
  } else if (status.state === 'closed') {
    captureBadge.classList.add('paused');
    captureLabel.textContent = 'PAUSED';
  }
});

transport.onMessage(function (type) {
  if (type === CONTROL.START) startCapture('control-start');
  else if (type === CONTROL.STOP) stopCapture('control-stop');
  else if (type === CONTROL.PAUSE) pauseCapture('control-pause');
  else if (type === CONTROL.RESUME) resumeCapture('control-resume');
});

document.getElementById('btn-add').addEventListener('click', addRow);
document.getElementById('btn-remove').addEventListener('click', removeRow);
document.getElementById('btn-edit').addEventListener('click', editRow);
document.getElementById('btn-dialog').addEventListener('click', function () {
  alert('PhantomStream mirrored this dialog.');
  logLine('dialog mirrored: alert open -> closed');
});
autoButton.addEventListener('click', function () {
  setAutoMutate(autoTimer === null);
});

addRow();
addRow();
addRow();
setAutoMutate(true);
updateStatus();

window.__phantomstreamSource = { transport: transport, getCapture: getCapture };
