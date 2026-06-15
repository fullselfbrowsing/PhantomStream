import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM, VirtualConsole } from 'jsdom';
import { createCapture } from '../src/capture/index.js';
import { RELAY_PER_MESSAGE_LIMIT_BYTES } from '../src/protocol/constants.js';
import { CONTROL, STREAM } from '../src/protocol/messages.js';

const AUDITED_GLOBALS = [
  'window', 'document', 'Node', 'NodeFilter', 'MutationObserver',
  'requestAnimationFrame', 'cancelAnimationFrame', 'CustomEvent',
  'ShadowRoot', 'location', 'getComputedStyle', 'URL',
];

function setupEnv(bodyHtml) {
  const dom = new JSDOM(
    '<!DOCTYPE html><html><head><title>subtree fixture</title></head><body>'
      + bodyHtml + '</body></html>',
    {
      url: 'https://fixture.test/root/page.html',
      pretendToBeVisual: true,
      virtualConsole: new VirtualConsole(),
    }
  );
  const w = dom.window;
  const prior = new Map();
  for (const key of AUDITED_GLOBALS) {
    prior.set(key, {
      present: Object.prototype.hasOwnProperty.call(globalThis, key),
      value: globalThis[key],
    });
    globalThis[key] = key === 'window' ? w : w[key];
  }

  const env = {
    dom,
    window: w,
    document: w.document,
    capture: null,
    teardown() {
      try {
        if (env.capture) env.capture.stop();
      } catch (e) { /* already stopped */ }
      env.capture = null;
      for (const key of AUDITED_GLOBALS) {
        const p = prior.get(key);
        if (p.present) {
          globalThis[key] = p.value;
        } else {
          delete globalThis[key];
        }
      }
      w.close();
    },
  };
  return env;
}

function createRecordingTransport() {
  return {
    sent: [],
    send(type, payload) {
      this.sent.push({ type, payload });
    },
  };
}

function silentLogger() {
  return { info() {}, warn() {}, error() {} };
}

function snapshotPayloadOf(transport) {
  const snapshots = transport.sent.filter((m) => m.type === STREAM.SNAPSHOT);
  assert.equal(snapshots.length, 1, 'start() emits one initial snapshot');
  return snapshots[0].payload;
}

function subtreeResponsesOf(transport) {
  return transport.sent.filter((m) => m.type === STREAM.SUBTREE_RESPONSE);
}

function wireByteLength(value) {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function assertPlannedSubtreeConstants() {
  assert.equal(
    CONTROL.SUBTREE_REQUEST,
    'dash:ps-subtree-request',
    'CONTROL.SUBTREE_REQUEST is the planned viewer-to-capture control type'
  );
  assert.equal(
    STREAM.SUBTREE_RESPONSE,
    'ext:ps-subtree-response',
    'STREAM.SUBTREE_RESPONSE is the planned capture-to-viewer stream type'
  );
}

function callHandleControl(capture, payload) {
  assert.equal(
    typeof capture.handleControl,
    'function',
    'createCapture exposes handleControl for CONTROL.SUBTREE_REQUEST'
  );
  capture.handleControl(CONTROL.SUBTREE_REQUEST, payload);
}

function assertContentFreeMiss(payload, expectedStatus) {
  assert.equal(payload.status, expectedStatus, 'miss status is explicit');
  assert.ok(!payload.html, 'miss response has no html');
  assert.deepEqual(payload.nodeIds || [], [], 'miss response has no nodeIds');
  assert.deepEqual(payload.shadowRoots || [], [], 'miss response has no shadowRoots');
  assert.deepEqual(payload.frames || [], [], 'miss response has no frames');
}

test('D-19 snapshot truncation leaves requestable mirror-only markers with dropped root ids', () => {
  const hugeText = 'x'.repeat(900000);
  const env = setupEnv(
    '<main id="root">'
      + '<section id="kept">above fold</section>'
      + '<section id="huge-region">' + hugeText + '</section>'
      + '</main>'
  );
  try {
    const transport = createRecordingTransport();
    env.capture = createCapture({
      transport,
      logger: silentLogger(),
    });
    env.capture.start();
    const snapshot = snapshotPayloadOf(transport);
    const hugeNid = env.capture.getNodeId(env.document.getElementById('huge-region'));

    assert.equal(snapshot.truncated, true, 'snapshot is marked truncated');
    assert.equal(snapshot.missingDescendants > 0, true, 'missing descendant count is preserved');
    assert.ok(
      snapshot.html.includes('data-phantomstream-truncated="true"'),
      'dropped root is replaced by a mirror-only truncated marker'
    );
    assert.ok(snapshot.nodeIds.includes(hugeNid), 'dropped root nid remains requestable');
  } finally {
    env.teardown();
  }
});

test('D-19/D-21 capture SUBTREE_REQUEST emits an ok sanitized subtree response with current identity', () => {
  const env = setupEnv(
    '<main id="root">'
      + '<section id="target">'
      + '<button id="bad-handler" onclick="alert(1)">open</button>'
      + '<a id="bad-url" href="javascript:alert(2)">unsafe</a>'
      + '<iframe id="bad-frame" src="data:text/html,<script>alert(1)</script>"></iframe>'
      + '<input id="secret" type="password" value="hunter2">'
      + '<img id="safe-img" src="data:image/png;base64,AAAA">'
      + '<p id="safe-child">recoverable content</p>'
      + '</section>'
      + '</main>'
  );
  try {
    const transport = createRecordingTransport();
    env.capture = createCapture({
      transport,
      logger: silentLogger(),
      maskInputs: true,
    });
    env.capture.start();
    const snapshot = snapshotPayloadOf(transport);
    const target = env.document.getElementById('target');
    const targetNid = env.capture.getNodeId(target);
    assert.equal(typeof targetNid, 'string', 'target has a live nid');

    assertPlannedSubtreeConstants();
    callHandleControl(env.capture, {
      requestId: 'req-ok',
      nid: targetNid,
      streamSessionId: snapshot.streamSessionId,
      snapshotId: snapshot.snapshotId,
      reason: 'truncated-placeholder',
    });

    const responses = subtreeResponsesOf(transport);
    assert.equal(responses.length, 1, 'one subtree response is emitted');
    const payload = responses[0].payload;
    assert.equal(payload.requestId, 'req-ok');
    assert.equal(payload.nid, targetNid);
    assert.equal(payload.status, 'ok');
    assert.equal(payload.streamSessionId, snapshot.streamSessionId);
    assert.equal(payload.snapshotId, snapshot.snapshotId);
    assert.ok(payload.html.includes('recoverable content'), 'safe content is serialized');
    assert.ok(!/onclick/i.test(payload.html), 'event handlers are stripped');
    assert.ok(!/javascript:/i.test(payload.html), 'javascript: URLs are stripped');
    assert.ok(!/hunter2/i.test(JSON.stringify(payload)), 'password values are masked before transport');
    assert.ok(!/data:text\/html/i.test(payload.html), 'data:text/html URLs are stripped');
    assert.ok(payload.html.includes('data:image/png;base64,AAAA'), 'safe data:image URLs survive');
    assert.ok(Array.isArray(payload.nodeIds), 'nodeIds sidecar exists');
    assert.ok(payload.nodeIds.includes(targetNid), 'requested root identity is included');
    assert.ok(payload.nodeIds.includes(env.capture.getNodeId(env.document.getElementById('safe-child'))),
      'descendant identity is included');
    assert.ok(Array.isArray(payload.shadowRoots), 'shadowRoots sidecar is present even when empty');
    assert.ok(Array.isArray(payload.frames), 'frames sidecar is present even when empty');
  } finally {
    env.teardown();
  }
});

test('D-21 oversized SUBTREE_REQUEST responses are bounded and explicit', () => {
  const env = setupEnv(
    '<main id="root">'
      + '<section id="target">' + '😀'.repeat(Math.floor(RELAY_PER_MESSAGE_LIMIT_BYTES / 3)) + '</section>'
      + '</main>'
  );
  try {
    const transport = createRecordingTransport();
    env.capture = createCapture({
      transport,
      logger: silentLogger(),
    });
    env.capture.start();
    const snapshot = snapshotPayloadOf(transport);
    const target = env.document.getElementById('target');
    const targetNid = env.capture.getNodeId(target);
    assert.equal(typeof targetNid, 'string', 'target has a live nid');

    callHandleControl(env.capture, {
      requestId: 'req-too-large',
      nid: targetNid,
      streamSessionId: snapshot.streamSessionId,
      snapshotId: snapshot.snapshotId,
      reason: 'truncated-placeholder',
    });

    const response = subtreeResponsesOf(transport).at(-1);
    assert.ok(response, 'one subtree response is emitted');
    assert.equal(response.payload.requestId, 'req-too-large');
    assert.equal(response.payload.nid, targetNid);
    assert.equal(response.payload.status, 'too-large');
    assert.equal(response.payload.html, undefined, 'too-large response is content-free');
    assert.deepEqual(response.payload.nodeIds || [], [], 'too-large response carries no nodeIds');
    assert.deepEqual(response.payload.shadowRoots || [], [], 'too-large response carries no shadowRoots');
    assert.deepEqual(response.payload.frames || [], [], 'too-large response carries no frames');
    assert.equal(
      wireByteLength(response.payload) <= RELAY_PER_MESSAGE_LIMIT_BYTES,
      true,
      'too-large response stays under the UTF-8 relay budget'
    );
  } finally {
    env.teardown();
  }
});

test('D-20 subtree misses for stale, gone, skipped, blocked, and untracked nids are content-free', () => {
  const env = setupEnv(
    '<main id="root">'
      + '<section id="current">current</section>'
      + '<section id="gone">gone soon</section>'
      + '<section id="skip-later">skip later</section>'
      + '<section id="block-later">block later</section>'
      + '</main>'
  );
  try {
    const transport = createRecordingTransport();
    env.capture = createCapture({
      transport,
      logger: silentLogger(),
      blockSelector: '.blocked',
      skipElement(el) {
        return !!(el && el.getAttribute && el.getAttribute('data-host-ui') === 'true');
      },
    });
    env.capture.start();
    const snapshot = snapshotPayloadOf(transport);
    const currentNid = env.capture.getNodeId(env.document.getElementById('current'));
    const goneEl = env.document.getElementById('gone');
    const goneNid = env.capture.getNodeId(goneEl);
    const skippedEl = env.document.getElementById('skip-later');
    const skippedNid = env.capture.getNodeId(skippedEl);
    const blockedEl = env.document.getElementById('block-later');
    const blockedNid = env.capture.getNodeId(blockedEl);
    assert.ok(currentNid && goneNid && skippedNid && blockedNid, 'fixture nids are tracked before drift');

    goneEl.remove();
    skippedEl.setAttribute('data-host-ui', 'true');
    blockedEl.className = 'blocked';

    assertPlannedSubtreeConstants();
    const cases = [
      {
        requestId: 'req-stale',
        nid: currentNid,
        streamSessionId: snapshot.streamSessionId + '-old',
        snapshotId: snapshot.snapshotId,
        expectedStatus: 'stale',
      },
      {
        requestId: 'req-gone',
        nid: goneNid,
        streamSessionId: snapshot.streamSessionId,
        snapshotId: snapshot.snapshotId,
        expectedStatus: 'gone',
      },
      {
        requestId: 'req-skipped',
        nid: skippedNid,
        streamSessionId: snapshot.streamSessionId,
        snapshotId: snapshot.snapshotId,
        expectedStatus: 'skipped',
      },
      {
        requestId: 'req-blocked',
        nid: blockedNid,
        streamSessionId: snapshot.streamSessionId,
        snapshotId: snapshot.snapshotId,
        expectedStatus: 'blocked',
      },
      {
        requestId: 'req-untracked',
        nid: 'never-tracked',
        streamSessionId: snapshot.streamSessionId,
        snapshotId: snapshot.snapshotId,
        expectedStatus: 'untracked',
      },
    ];

    for (const entry of cases) {
      callHandleControl(env.capture, {
        requestId: entry.requestId,
        nid: entry.nid,
        streamSessionId: entry.streamSessionId,
        snapshotId: entry.snapshotId,
        reason: 'manual-recovery',
      });
    }

    const responses = subtreeResponsesOf(transport).slice(-cases.length);
    assert.equal(responses.length, cases.length, 'one miss response per request');
    for (const entry of cases) {
      const response = responses.find((m) => m.payload.requestId === entry.requestId);
      assert.ok(response, 'response exists for ' + entry.requestId);
      assert.equal(response.payload.nid, entry.nid);
      assertContentFreeMiss(response.payload, entry.expectedStatus);
    }
  } finally {
    env.teardown();
  }
});
