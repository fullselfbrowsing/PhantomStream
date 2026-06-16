import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM, VirtualConsole } from 'jsdom';
import { createCapture } from '../src/capture/index.js';
import { buildSnapshotHtml } from '../src/renderer/snapshot.js';
import { STREAM, DIFF_OP } from '../src/protocol/messages.js';

const AUDITED_GLOBALS = [
  'window', 'document', 'Node', 'NodeFilter', 'MutationObserver',
  'requestAnimationFrame', 'cancelAnimationFrame', 'CustomEvent',
  'ShadowRoot', 'location', 'getComputedStyle', 'URL',
];

const HOSTILE_CSS = [
  '.x{background:url("javascript:alert(1)")}',
  '@import "javascript:alert(2)";',
  '.x{width:expression(alert(3));-moz-binding:url("javascript:alert(4)")}',
  '.x{content:"</style><img src=x onerror=alert(5)>"}',
].join('\n');

function setupEnv(headHtml) {
  const dom = new JSDOM('<!doctype html><html><head>' + headHtml + '</head><body><main>ok</main></body></html>', {
    url: 'https://fixture.test/',
    pretendToBeVisual: true,
    virtualConsole: new VirtualConsole(),
  });
  const prior = new Map();
  for (const key of AUDITED_GLOBALS) {
    prior.set(key, {
      present: Object.prototype.hasOwnProperty.call(globalThis, key),
      value: globalThis[key],
    });
    globalThis[key] = key === 'window' ? dom.window : dom.window[key];
  }
  return {
    window: dom.window,
    document: dom.window.document,
    capture: null,
    teardown() {
      try {
        if (this.capture) this.capture.stop();
      } catch (e) {}
      for (const key of AUDITED_GLOBALS) {
        const p = prior.get(key);
        if (p.present) globalThis[key] = p.value;
        else delete globalThis[key];
      }
      dom.window.close();
    },
  };
}

function transport() {
  const sent = [];
  return {
    sent,
    send(type, payload) { sent.push({ type, payload }); },
  };
}

function logger(warns = []) {
  return { info() {}, warn(...args) { warns.push(args); }, error() {} };
}

async function settle(win) {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => win.requestAnimationFrame(resolve));
  await new Promise((resolve) => setTimeout(resolve, 20));
}

function snapshot(t) {
  return t.sent.find((entry) => entry.type === STREAM.SNAPSHOT).payload;
}

function assertSanitized(css) {
  assert.equal(css.includes('javascript:alert'), false);
  assert.equal(css.includes('expression('), false);
  assert.equal(css.includes('-moz-binding'), false);
  assert.equal(css.includes('</style><img'), false);
}

test('capture scrubs readable CSSOM sources before the wire', async () => {
  const env = setupEnv('');
  try {
    const style = env.document.createElement('style');
    style.textContent = HOSTILE_CSS + '.ok{color:rgb(1, 2, 3)}';
    env.document.head.appendChild(style);
    const t = transport();
    env.capture = createCapture({ transport: t, logger: logger(), styleMode: 'cssom' });
    env.capture.start();
    await settle(env.window);
    const source = snapshot(t).styleSources[0];
    assertSanitized(source.cssText);
    assert.ok(source.cssText.includes('.ok'));
  } finally {
    env.teardown();
  }
});

test('dynamic style-source replacement CSS is scrubbed before renderer insertion', async () => {
  const payload = {
    html: '<main></main>',
    nodeIds: ['main-nid'],
    styleSources: [{
      sourceId: 'document:0:style',
      scope: { kind: 'document' },
      ownerKind: 'style',
      order: 0,
      cssText: HOSTILE_CSS + '.ok{color:rgb(1, 2, 3)}',
    }],
    stylesheets: [],
    inlineStyles: [],
    htmlAttrs: {},
    bodyAttrs: {},
    htmlStyle: '',
    bodyStyle: '',
    viewportWidth: 800,
  };
  const html = buildSnapshotHtml(payload);
  assertSanitized(html);
  assert.ok(html.includes('.ok'));
});

test('dynamic capture style-source ops carry scrubbed CSS only', async () => {
  const env = setupEnv('<style id="theme">.theme{color:red}</style>');
  try {
    const t = transport();
    env.capture = createCapture({ transport: t, logger: logger(), styleMode: 'cssom' });
    env.capture.start();
    await settle(env.window);
    env.document.getElementById('theme').textContent = HOSTILE_CSS + '.ok{color:rgb(1, 2, 3)}';
    await settle(env.window);
    const op = t.sent
      .filter((entry) => entry.type === STREAM.MUTATIONS)
      .flatMap((entry) => entry.payload.mutations || [])
      .find((entry) => entry.op === DIFF_OP.STYLE_SOURCE);
    assert.ok(op, 'style-source op emitted');
    assertSanitized(op.source.cssText);
    assert.ok(op.source.cssText.includes('.ok'));
  } finally {
    env.teardown();
  }
});
