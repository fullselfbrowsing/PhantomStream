import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM, VirtualConsole } from 'jsdom';
import { createViewer } from '../src/renderer/index.js';
import { CONTROL, STREAM } from '../src/protocol/messages.js';

function setupViewerEnv() {
  const dom = new JSDOM(
    '<!DOCTYPE html><html><body><div id="container" style="width:800px;height:600px"></div></body></html>',
    {
      url: 'https://viewer.test/',
      pretendToBeVisual: true,
      virtualConsole: new VirtualConsole(),
    }
  );
  return {
    dom,
    window: dom.window,
    document: dom.window.document,
    container: dom.window.document.getElementById('container'),
    viewer: null,
    teardown() {
      try {
        if (this.viewer) this.viewer.destroy();
      } catch (e) { /* already destroyed */ }
      dom.window.close();
    },
  };
}

function createRecordingTransport() {
  const handlers = new Set();
  return {
    sent: [],
    send(type, payload) {
      this.sent.push({ type, payload });
    },
    onMessage(handler) {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    emit(type, payload) {
      for (const handler of handlers) handler(type, payload || {});
    },
  };
}

function silentLogger() {
  return { info() {}, warn() {}, error() {} };
}

function snapshotPayload(overrides) {
  return Object.assign(
    {
      html: '<main id="root">'
        + '<div id="truncated" data-phantomstream-truncated="true"></div>'
        + '<div id="other-truncated" data-phantomstream-truncated="true"></div>'
        + '</main>',
      nodeIds: ['root-nid', 'truncated-nid', 'other-nid'],
      stylesheets: [],
      inlineStyles: [],
      htmlAttrs: {},
      bodyAttrs: {},
      htmlStyle: '',
      bodyStyle: '',
      scrollX: 0,
      scrollY: 0,
      viewportWidth: 1024,
      viewportHeight: 768,
      pageWidth: 1024,
      pageHeight: 768,
      streamSessionId: 'stream-current',
      snapshotId: 41,
    },
    overrides || {}
  );
}

function glueMirror(env) {
  const iframe = env.container.querySelector('iframe');
  const cd = iframe.contentDocument;
  cd.open();
  cd.write(iframe.getAttribute('srcdoc'));
  cd.close();
  iframe.dispatchEvent(new env.window.Event('load'));
  return cd;
}

function subtreeRequestsOf(transport) {
  return transport.sent.filter((m) => m.type === CONTROL.SUBTREE_REQUEST);
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

function assertRequestId(value, message) {
  assert.match(value, /^subtree_[a-z0-9]+_\d+$/, message);
}

function createStartedViewer(env, transport) {
  env.viewer = createViewer({
    container: env.container,
    transport,
    logger: silentLogger(),
  });
  transport.emit(STREAM.SNAPSHOT, snapshotPayload());
  glueMirror(env);
  return env.viewer;
}

test('D-22 viewer.requestSubtree latches one in-flight request per nid with current identity', () => {
  const env = setupViewerEnv();
  try {
    const transport = createRecordingTransport();
    const viewer = createStartedViewer(env, transport);

    assertPlannedSubtreeConstants();
    assert.equal(
      typeof viewer.requestSubtree,
      'function',
      'createViewer exposes requestSubtree(nid)'
    );
    const first = viewer.requestSubtree('truncated-nid', { reason: 'visible-placeholder' });
    const duplicate = viewer.requestSubtree('truncated-nid', { reason: 'scroll-repeat' });
    const other = viewer.requestSubtree('other-nid', { reason: 'explicit-host-request' });

    assertRequestId(first, 'first request returns a requestId');
    assert.equal(duplicate, null, 'duplicate request while in flight is latched');
    assertRequestId(other, 'a different existing nid can be requested independently');
    assert.equal(viewer.requestSubtree('missing-nid'), null, 'missing nids are rejected');
    const requests = subtreeRequestsOf(transport);
    assert.equal(requests.length, 2, 'one request per nid while in flight');
    assert.notEqual(requests[0].payload.requestId, requests[1].payload.requestId, 'requestIds are unique');
    assert.equal(requests[0].payload.nid, 'truncated-nid');
    assert.equal(requests[0].payload.streamSessionId, 'stream-current');
    assert.equal(requests[0].payload.snapshotId, 41);
    assert.equal(requests[0].payload.reason, 'visible-placeholder');
  } finally {
    env.teardown();
  }
});

test('D-19/D-21 current SUBTREE_RESPONSE replaces a truncated placeholder after sanitization and indexes nodeIds', () => {
  const env = setupViewerEnv();
  try {
    const transport = createRecordingTransport();
    const viewer = createStartedViewer(env, transport);
    const cd = env.container.querySelector('iframe').contentDocument;
    assert.ok(cd.querySelector('[data-phantomstream-truncated="true"]'), 'fixture starts with a truncated placeholder');
    const markerCountBefore = cd.querySelectorAll('[data-phantomstream-truncated="true"]').length;

    assertPlannedSubtreeConstants();
    assert.equal(typeof viewer.requestSubtree, 'function');
    assertRequestId(viewer.requestSubtree('truncated-nid'), 'request returns an id');
    const request = subtreeRequestsOf(transport)[0].payload;
    transport.emit(STREAM.SUBTREE_RESPONSE, {
      requestId: request.requestId,
      nid: 'truncated-nid',
      status: 'ok',
      html: '<section id="recovered">'
        + '<button id="unsafe" onclick="alert(1)">bad</button>'
        + '<a id="bad-link" href="javascript:alert(1)">bad url</a>'
        + '<p id="safe-child">recovered content</p>'
        + '</section>',
      nodeIds: ['truncated-nid', 'safe-child-nid'],
      shadowRoots: [],
      frames: [],
      streamSessionId: 'stream-current',
      snapshotId: 41,
    });

    const recovered = cd.getElementById('recovered');
    assert.ok(recovered, 'replacement subtree was installed');
    assert.equal(cd.getElementById('truncated'), null, 'requested placeholder was removed');
    assert.equal(
      cd.querySelectorAll('[data-phantomstream-truncated="true"]').length,
      markerCountBefore - 1,
      'only the requested placeholder was removed'
    );
    assert.equal(recovered.querySelector('#unsafe').hasAttribute('onclick'), false,
      'subtree html is sanitized before import');
    assert.equal(recovered.querySelector('#bad-link').hasAttribute('href'), false,
      'dangerous href is stripped before import');
    assert.equal(recovered.querySelector('#safe-child').textContent, 'recovered content');
    assert.ok(viewer.resolveNode('safe-child-nid'), 'response nodeIds are indexed');
    assert.ok(viewer.resolveNode('truncated-nid'), 'requested root nid is re-indexed');
  } finally {
    env.teardown();
  }
});

test('D-20 stale and miss SUBTREE_RESPONSE frames are ignored but clear matching latches', () => {
  const env = setupViewerEnv();
  try {
    const transport = createRecordingTransport();
    const viewer = createStartedViewer(env, transport);
    const cd = env.container.querySelector('iframe').contentDocument;

    assertPlannedSubtreeConstants();
    assert.equal(typeof viewer.requestSubtree, 'function');
    assertRequestId(viewer.requestSubtree('truncated-nid'), 'request returns an id');
    const request = subtreeRequestsOf(transport)[0].payload;

    transport.emit(STREAM.SUBTREE_RESPONSE, {
      requestId: request.requestId,
      nid: 'truncated-nid',
      status: 'ok',
      html: '<section id="stale-replacement">stale content</section>',
      nodeIds: ['stale-nid'],
      shadowRoots: [],
      frames: [],
      streamSessionId: 'stream-old',
      snapshotId: 40,
    });

    assert.equal(cd.getElementById('stale-replacement'), null, 'stale response was ignored');
    assert.ok(cd.querySelector('[data-phantomstream-truncated="true"]'),
      'current placeholder remains after stale response');
    assertRequestId(
      viewer.requestSubtree('truncated-nid'),
      'stale response clears the matching latch so a fresh request can be sent'
    );
    const missRequest = subtreeRequestsOf(transport)[1].payload;
    transport.emit(STREAM.SUBTREE_RESPONSE, {
      requestId: missRequest.requestId,
      nid: 'truncated-nid',
      status: 'gone',
      streamSessionId: 'stream-current',
      snapshotId: 41,
    });

    assert.ok(cd.querySelector('[data-phantomstream-truncated="true"]'),
      'miss response does not mutate the placeholder');
    assertRequestId(
      viewer.requestSubtree('truncated-nid'),
      'miss response also clears the matching latch'
    );
    assert.equal(subtreeRequestsOf(transport).length, 3, 'fresh retries were sent after stale and miss responses');
  } finally {
    env.teardown();
  }
});
