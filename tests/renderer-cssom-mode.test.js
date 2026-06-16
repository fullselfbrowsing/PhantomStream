import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM, VirtualConsole } from 'jsdom';
import { createViewer } from '../src/renderer/index.js';
import { buildSnapshotHtml } from '../src/renderer/snapshot.js';
import { STREAM, DIFF_OP } from '../src/protocol/messages.js';

function setupEnv() {
  const dom = new JSDOM('<!doctype html><html><body><div id="viewer" style="width:800px;height:600px"></div></body></html>', {
    url: 'https://viewer.test/',
    pretendToBeVisual: true,
    virtualConsole: new VirtualConsole(),
  });
  return {
    dom,
    window: dom.window,
    document: dom.window.document,
    viewer: null,
    teardown() {
      try {
        if (this.viewer) this.viewer.destroy();
      } catch (e) {}
      dom.window.close();
    },
  };
}

function manualTransport() {
  const handlers = new Set();
  return {
    sent: [],
    transport: {
      send(type, payload) { this.sent?.push?.({ type, payload }); },
      onMessage(handler) {
        handlers.add(handler);
        return () => handlers.delete(handler);
      },
    },
    emit(type, payload) {
      for (const handler of handlers) handler(type, payload || {});
    },
  };
}

function logger() {
  return { info() {}, warn() {}, error() {} };
}

function iframe(env) {
  return env.document.querySelector('#viewer iframe');
}

function glue(frame) {
  const doc = frame.contentDocument;
  doc.open();
  doc.write(frame.getAttribute('srcdoc'));
  doc.close();
  frame.dispatchEvent(new frame.ownerDocument.defaultView.Event('load'));
  return doc;
}

function baseSnapshot(overrides = {}) {
  return {
    html: '<main id="root"><x-card id="host"></x-card><iframe id="same-frame"></iframe></main>',
    nodeIds: ['root-nid', 'host-nid', 'frame-nid'],
    shadowRoots: [{
      hostNid: 'host-nid',
      mode: 'open',
      html: '<span class="shadow-target">Shadow</span>',
      nodeIds: ['shadow-target-nid'],
      slotAssignment: 'none',
      styleSources: [{
        sourceId: 'shadow:host-nid:0:style',
        scope: { kind: 'shadow', hostNid: 'host-nid' },
        ownerKind: 'style',
        order: 0,
        href: null,
        media: '',
        disabled: false,
        cssText: '.shadow-target{color:blue}',
        fallback: null,
        approxBytes: 26,
      }],
    }],
    frames: [{
      frameNid: 'frame-nid',
      kind: 'same-origin',
      html: '<p class="frame-target">Frame</p>',
      nodeIds: ['frame-target-nid'],
      shadowRoots: [],
      frames: [],
      stylesheets: [],
      inlineStyles: [],
      styleSources: [{
        sourceId: 'frame:frame-nid:0:style',
        scope: { kind: 'frame', frameNid: 'frame-nid' },
        ownerKind: 'style',
        order: 0,
        href: null,
        media: '',
        disabled: false,
        cssText: '.frame-target{color:green}',
        fallback: null,
        approxBytes: 27,
      }],
    }],
    styleSources: [{
      sourceId: 'document:0:style',
      scope: { kind: 'document' },
      ownerKind: 'style',
      order: 0,
      href: null,
      media: '',
      disabled: false,
      cssText: '.root{color:red}',
      fallback: null,
      approxBytes: 16,
    }],
    styleStrategy: { mode: 'cssom', sourceCount: 1, fallbackCount: 0, computedFallbackCount: 0, approxCssBytes: 16 },
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
    viewportWidth: 800,
    viewportHeight: 600,
    pageWidth: 800,
    pageHeight: 600,
    url: 'https://fixture.test/',
    title: 'cssom',
    streamSessionId: 'stream-cssom',
    snapshotId: 1,
    ...overrides,
  };
}

test('buildSnapshotHtml installs document CSSOM sources with sanitizer', () => {
  const html = buildSnapshotHtml(baseSnapshot({
    styleSources: [{
      sourceId: 'document:0:style',
      scope: { kind: 'document' },
      ownerKind: 'style',
      order: 0,
      cssText: '.x{background:url("javascript:alert(1)")}</style><b>',
    }],
  }));
  assert.match(html, /data-ps-style-source-id="document:0:style"/);
  assert.equal(html.includes('javascript:alert'), false);
  assert.equal(html.includes('</style><b>'), false);
});

test('viewer installs document, shadow, and frame scoped CSSOM sources', () => {
  const env = setupEnv();
  try {
    const wire = manualTransport();
    env.viewer = createViewer({
      container: env.document.getElementById('viewer'),
      transport: wire.transport,
      logger: logger(),
    });
    wire.emit(STREAM.SNAPSHOT, baseSnapshot());
    const doc = glue(iframe(env));
    assert.ok(doc.querySelector('[data-ps-style-source-id="document:0:style"]'));
    const host = doc.getElementById('host');
    assert.ok(host.shadowRoot.querySelector('[data-ps-style-source-id="shadow:host-nid:0:style"]'));
    const frame = doc.getElementById('same-frame');
    const frameDoc = glue(frame);
    assert.ok(frameDoc.querySelector('[data-ps-style-source-id="frame:frame-nid:0:style"]'));
  } finally {
    env.teardown();
  }
});

test('viewer applies dynamic style-source replace and remove ops', () => {
  const env = setupEnv();
  try {
    const wire = manualTransport();
    env.viewer = createViewer({
      container: env.document.getElementById('viewer'),
      transport: wire.transport,
      logger: logger(),
    });
    wire.emit(STREAM.SNAPSHOT, baseSnapshot());
    const doc = glue(iframe(env));

    wire.emit(STREAM.MUTATIONS, {
      streamSessionId: 'stream-cssom',
      snapshotId: 1,
      mutations: [{
        op: DIFF_OP.STYLE_SOURCE,
        action: 'replace',
        sourceId: 'document:0:style',
        scope: { kind: 'document' },
        source: {
          sourceId: 'document:0:style',
          scope: { kind: 'document' },
          ownerKind: 'style',
          order: 0,
          cssText: '.root{color:purple}',
        },
      }],
    });
    assert.equal(
      doc.querySelector('[data-ps-style-source-id="document:0:style"]').textContent,
      '.root{color:purple}'
    );

    wire.emit(STREAM.MUTATIONS, {
      streamSessionId: 'stream-cssom',
      snapshotId: 1,
      mutations: [{
        op: DIFF_OP.STYLE_SOURCE,
        action: 'remove',
        sourceId: 'document:0:style',
        scope: { kind: 'document' },
      }],
    });
    assert.equal(doc.querySelector('[data-ps-style-source-id="document:0:style"]'), null);
  } finally {
    env.teardown();
  }
});
