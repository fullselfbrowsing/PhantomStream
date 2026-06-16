var params = new URLSearchParams(window.location.search);
var clickCount = document.getElementById('click-count');
var driverCount = document.getElementById('driver-count');
var driverLast = document.getElementById('driver-last');
var remoteText = document.getElementById('remote-text');
var remoteTextEcho = document.getElementById('remote-text-echo');
var navigationCount = document.getElementById('fixture-navigation-count');
var scrollRows = document.getElementById('scroll-rows');

function numberText(el) {
  return Number(el.textContent || '0') || 0;
}

function formatTime() {
  return new Date().toLocaleTimeString();
}

function setNavigationCount() {
  var value = Number(params.get('nav') || '0') || 0;
  navigationCount.textContent = String(value);
}

function updateRemoteTextEcho() {
  remoteTextEcho.textContent = remoteText.value
    ? 'Remote text echo: ' + remoteText.value
    : 'Remote text echo: empty';
}

function fillScrollRows() {
  for (var i = 1; i <= 36; i++) {
    var row = document.createElement('li');
    row.textContent = 'Scroll row ' + i;
    scrollRows.appendChild(row);
  }
}

document.getElementById('click-target').addEventListener('click', function () {
  clickCount.textContent = String(numberText(clickCount) + 1);
});

document.getElementById('driver-tick').addEventListener('click', function () {
  driverCount.textContent = String(numberText(driverCount) + 1);
  driverLast.textContent = formatTime();
});

remoteText.addEventListener('input', updateRemoteTextEcho);

document.getElementById('navigate-fixture').addEventListener('click', function () {
  var next = new URL(window.location.href);
  var current = Number(next.searchParams.get('nav') || '0') || 0;
  next.searchParams.set('nav', String(current + 1));
  window.location.href = next.toString();
});

setNavigationCount();
updateRemoteTextEcho();
fillScrollRows();
