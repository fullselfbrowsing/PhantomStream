// Phase 08 RED coverage: renderer must install same-origin frame payloads as
// inert nested iframe srcdoc documents and label cross-origin placeholders.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM, VirtualConsole } from 'jsdom';
import { createViewer } from '../src/renderer/index.js';
import { STREAM, DIFF_OP } from '../src/protocol/messages.js';

function setupEnv(bodyHtml) {
  const dom = new JSDOM(
    '<!DOCTYPE html><html><head><title>iframe renderer fixture</title></head><body>'
      + bodyHtml + '</body></html>',
    {
      url: 'https://viewer.test/page',
      pretendToBeVisual: true,
      virtualConsole: new VirtualConsole(),
    }
  );
  return {
    dom,
    window: dom.window,
    document: dom.window.document,
    viewer: null,
    teardown() {
      try {
        if (this.viewer) this.viewer.destroy();
      } catch (e) { /* already destroyed */ }
      this.viewer = null;
      dom.window.close();
    },
  };
}

function createManualTransport() {
  const handlers = new Set();
  const sent = [];
  return {
    sent,
    transport: {
      send(type, payload) { sent.push({ type, payload }); },
      onMessage(handler) {
        handlers.add(handler);
        return () => { handlers.delete(handler); };
      },
    },
    emit(type, payload) {
      handlers.forEach((handler) => handler(type, payload));
    },
  };
}

function silentLogger() {
  return { info() {}, warn() {}, error() {} };
}

function baseSnapshot(overrides = {}) {
  return {
    html: '<main id="root">'
      + '<iframe id="same-frame"></iframe>'
      + '<iframe id="remote-frame" src="https://remote.example/private"></iframe>'
      + '</main>',
    nodeIds: ['root-nid', 'same-frame-nid', 'remote-frame-nid'],
    frames: [{
      frameNid: 'same-frame-nid',
      kind: 'same-origin',
      html: '<button id="inside-frame" onclick="alert(1)">Frame button</button>'
        + '<fs-frame-card id="frame-shadow-host"></fs-frame-card>',
      nodeIds: ['frame-button-nid', 'frame-shadow-host-nid'],
      shadowRoots: [{
        hostNid: 'frame-shadow-host-nid',
        mode: 'open',
        html: '<span id="frame-shadow-child">Frame shadow child</span>',
        nodeIds: ['frame-shadow-child-nid'],
        slotAssignment: 'none',
      }],
      stylesheets: [],
      inlineStyles: ['button{color:blue}'],
      htmlAttrs: { lang: 'en' },
      bodyAttrs: { 'data-frame-body': 'yes' },
      sandbox: 'allow-same-origin',
    }, {
      frameNid: 'remote-frame-nid',
      kind: 'cross-origin',
      label: 'Cross-origin iframe',
      src: 'https://remote.example/private',
      origin: 'https://remote.example',
    }],
    truncated: false,
    missingDescendants: 0,
    stylesheets: [],
    inlineStyles: [],
    htmlAttrs: {},
    bodyAttrs: {},
    htmlStyle: '',
    bodyStyle: '',
    scrollX: 0,
    scrollY: 0,
    viewportWidth: 900,
    viewportHeight: 700,
    pageWidth: 900,
    pageHeight: 700,
    url: 'https://fixture.test/page',
    title: 'iframe fixture',
    streamSessionId: 'stream-frames',
    snapshotId: 1,
    ...overrides,
  };
}

function viewerIframe(env) {
  return env.document.querySelector('#viewer iframe');
}

function glueIframe(iframe) {
  const cd = iframe.contentDocument;
  cd.open();
  cd.write(iframe.getAttribute('srcdoc'));
  cd.close();
  iframe.dispatchEvent(new iframe.ownerDocument.defaultView.Event('load'));
  return cd;
}

test('D-08/D-10 same-origin frame payload installs as inert nested iframe srcdoc', () => {
  const env = setupEnv('<div id="viewer" style="width:900px;height:700px"></div>');
  try {
    const wire = createManualTransport();
    env.viewer = createViewer({
      container: env.document.getElementById('viewer'),
      transport: wire.transport,
      logger: silentLogger(),
    });

    wire.emit(STREAM.SNAPSHOT, baseSnapshot());
    const mirrorDoc = glueIframe(viewerIframe(env));
    const sameFrame = mirrorDoc.getElementById('same-frame');

    assert.ok(sameFrame, 'same-origin iframe host exists in mirror');
    assert.equal(sameFrame.hasAttribute('src'), false, 'same-origin mirror frame does not load a live src');
    assert.equal(typeof sameFrame.getAttribute('srcdoc'), 'string', 'same-origin payload is installed as srcdoc');
    assert.ok(sameFrame.getAttribute('srcdoc').includes('inside-frame'), 'srcdoc carries the frame payload');
    assert.equal((sameFrame.getAttribute('sandbox') || '').includes('allow-scripts'), false, 'nested sandbox omits allow-scripts');

    const frameDoc = glueIframe(sameFrame);
    assert.equal(frameDoc.getElementById('inside-frame').textContent, 'Frame button');
    assert.equal(frameDoc.getElementById('inside-frame').hasAttribute('onclick'), false, 'frame srcdoc is sanitized');
    assert.ok(frameDoc.getElementById('frame-shadow-host').shadowRoot, 'frame-local shadow root is attached');
    assert.equal(
      frameDoc.getElementById('frame-shadow-host').shadowRoot.getElementById('frame-shadow-child').textContent,
      'Frame shadow child'
    );

    const resolved = env.viewer.resolveNode('frame-button-nid');
    assert.ok(resolved, 'frame descendant nid resolves after frame installation');
    assert.ok(env.viewer.resolveNode('frame-shadow-child-nid'), 'frame shadow descendant nid resolves after frame installation');
    assert.deepEqual(Object.keys(resolved).sort(), ['exists', 'nid', 'rect', 'snapshotId', 'streamSessionId'].sort());
    assert.equal(resolved.nid, 'frame-button-nid');
    assert.equal(resolved.exists, true);
    assert.equal(resolved.streamSessionId, 'stream-frames');
    assert.equal(resolved.snapshotId, 1);
    assert.equal(Object.prototype.hasOwnProperty.call(resolved, 'html'), false, 'resolveNode exposes no HTML');
    assert.equal(Object.prototype.hasOwnProperty.call(resolved, 'text'), false, 'resolveNode exposes no text');
    assert.equal(Object.prototype.hasOwnProperty.call(resolved, 'attrs'), false, 'resolveNode exposes no attrs');
  } finally {
    env.teardown();
  }
});

test('D-11 frame refresh mutations replace navigated same-origin frame content', () => {
  const env = setupEnv('<div id="viewer" style="width:900px;height:700px"></div>');
  try {
    const wire = createManualTransport();
    env.viewer = createViewer({
      container: env.document.getElementById('viewer'),
      transport: wire.transport,
      logger: silentLogger(),
    });

    wire.emit(STREAM.SNAPSHOT, baseSnapshot());
    const mirrorDoc = glueIframe(viewerIframe(env));
    const sameFrame = mirrorDoc.getElementById('same-frame');
    const initialDoc = glueIframe(sameFrame);
    assert.equal(initialDoc.getElementById('inside-frame').textContent, 'Frame button');

    wire.emit(STREAM.MUTATIONS, {
      streamSessionId: 'stream-frames',
      snapshotId: 1,
      mutations: [{
        op: DIFF_OP.FRAME,
        frameNid: 'same-frame-nid',
        frame: {
          frameNid: 'same-frame-nid',
          kind: 'same-origin',
          html: '<section id="after-load-static">'
            + '<button id="after-load-button" onclick="alert(1)">After load button</button>'
            + '</section>',
          nodeIds: ['after-load-static-nid', 'after-load-button-nid'],
          shadowRoots: [],
          frames: [],
          stylesheets: [],
          inlineStyles: [],
          htmlAttrs: { lang: 'en' },
          bodyAttrs: { 'data-frame-body': 'after-load' },
        },
      }],
    });

    const refreshedDoc = glueIframe(sameFrame);
    assert.equal(refreshedDoc.getElementById('inside-frame'), null, 'old frame document content is replaced');
    assert.equal(
      refreshedDoc.getElementById('after-load-button').textContent,
      'After load button',
      'new static frame content is visible before later frame mutations'
    );
    assert.equal(
      refreshedDoc.getElementById('after-load-button').hasAttribute('onclick'),
      false,
      'refreshed frame srcdoc is sanitized'
    );
    assert.ok(env.viewer.resolveNode('after-load-button-nid'), 'refreshed frame descendant nid resolves');
    assert.equal(env.viewer.resolveNode('frame-button-nid'), null, 'old frame descendant nid is removed from the index');
  } finally {
    env.teardown();
  }
});

test('D-09 iframe src attr mutations are ignored by the renderer defense layer', () => {
  const env = setupEnv('<div id="viewer" style="width:900px;height:700px"></div>');
  try {
    const wire = createManualTransport();
    env.viewer = createViewer({
      container: env.document.getElementById('viewer'),
      transport: wire.transport,
      logger: silentLogger(),
    });

    wire.emit(STREAM.SNAPSHOT, baseSnapshot());
    const mirrorDoc = glueIframe(viewerIframe(env));
    const sameFrame = mirrorDoc.getElementById('same-frame');
    assert.equal(sameFrame.hasAttribute('src'), false, 'same-origin frame starts inert');

    wire.emit(STREAM.MUTATIONS, {
      streamSessionId: 'stream-frames',
      snapshotId: 1,
      mutations: [{
        op: DIFF_OP.ATTR,
        nid: 'same-frame-nid',
        attr: 'src',
        val: 'https://remote.example/private',
      }],
    });

    assert.equal(sameFrame.hasAttribute('src'), false, 'generic iframe src attr op cannot install a live src');
    assert.equal(typeof sameFrame.getAttribute('srcdoc'), 'string', 'inert srcdoc mirror is preserved');
  } finally {
    env.teardown();
  }
});

test('D-09 cross-origin frames render as content-free labeled regions', () => {
  const env = setupEnv('<div id="viewer" style="width:900px;height:700px"></div>');
  try {
    const wire = createManualTransport();
    env.viewer = createViewer({
      container: env.document.getElementById('viewer'),
      transport: wire.transport,
      logger: silentLogger(),
    });

    wire.emit(STREAM.SNAPSHOT, baseSnapshot());
    const mirrorDoc = glueIframe(viewerIframe(env));

    assert.equal(mirrorDoc.body.textContent.includes('SECRET_REMOTE_BODY'), false, 'remote frame content is absent');
    const remoteFrame = mirrorDoc.getElementById('remote-frame');
    assert.ok(remoteFrame, 'cross-origin iframe host exists in mirror');
    assert.equal(remoteFrame.hasAttribute('src'), false, 'cross-origin placeholder does not load the live remote URL');
    assert.equal(typeof remoteFrame.getAttribute('srcdoc'), 'string', 'cross-origin placeholder is inert srcdoc');
    assert.ok(remoteFrame.getAttribute('srcdoc').includes('Cross-origin iframe'), 'srcdoc contains the content-free label');
    assert.ok(remoteFrame.getAttribute('srcdoc').includes('https://remote.example'), 'srcdoc contains safe origin metadata');
    assert.equal(remoteFrame.getAttribute('srcdoc').includes('SECRET_REMOTE_BODY'), false, 'placeholder srcdoc has no remote text');
    const remoteDoc = glueIframe(remoteFrame);
    assert.ok(remoteDoc.body.textContent.includes('Cross-origin iframe'), 'placeholder label is visible');
    assert.equal(remoteDoc.body.textContent.includes('SECRET_REMOTE_BODY'), false, 'placeholder document has no remote text');
    for (const nested of Array.from(mirrorDoc.querySelectorAll('iframe'))) {
      assert.equal((nested.getAttribute('sandbox') || '').includes('allow-scripts'), false, 'no nested iframe has allow-scripts');
    }
  } finally {
    env.teardown();
  }
});

test('D-08 add-op frame payloads install without a full snapshot', () => {
  const env = setupEnv('<div id="viewer" style="width:900px;height:700px"></div>');
  try {
    const wire = createManualTransport();
    env.viewer = createViewer({
      container: env.document.getElementById('viewer'),
      transport: wire.transport,
      logger: silentLogger(),
    });

    wire.emit(STREAM.SNAPSHOT, baseSnapshot());
    const mirrorDoc = glueIframe(viewerIframe(env));

    wire.emit(STREAM.MUTATIONS, {
      streamSessionId: 'stream-frames',
      snapshotId: 1,
      mutations: [{
        op: DIFF_OP.ADD,
        parentNid: 'root-nid',
        html: '<iframe id="late-same-frame"></iframe>',
        nodeIds: ['late-frame-nid'],
        frames: [{
          frameNid: 'late-frame-nid',
          kind: 'same-origin',
          html: '<input id="late-frame-input" value="ready" onfocus="alert(1)">',
          nodeIds: ['late-frame-input-nid'],
          stylesheets: [],
          inlineStyles: [],
          htmlAttrs: {},
          bodyAttrs: {},
        }],
      }],
    });

    const lateFrame = mirrorDoc.getElementById('late-same-frame');
    assert.ok(lateFrame, 'late iframe host was inserted');
    assert.equal(typeof lateFrame.getAttribute('srcdoc'), 'string', 'late same-origin frame payload installs as srcdoc');
    const lateDoc = glueIframe(lateFrame);
    assert.equal(lateDoc.getElementById('late-frame-input').value, 'ready');
    assert.equal(lateDoc.getElementById('late-frame-input').hasAttribute('onfocus'), false, 'late frame srcdoc is sanitized');
    assert.ok(env.viewer.resolveNode('late-frame-input-nid'), 'late frame descendant nid resolves after add-op installation');
  } finally {
    env.teardown();
  }
});
