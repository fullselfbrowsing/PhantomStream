import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM, VirtualConsole } from 'jsdom';
import { createCapture } from '../src/capture/index.js';
import { STREAM, DIFF_OP } from '../src/protocol/messages.js';

const AUDITED_GLOBALS = [
  'window', 'document', 'Node', 'NodeFilter', 'MutationObserver',
  'requestAnimationFrame', 'cancelAnimationFrame', 'CustomEvent',
  'ShadowRoot', 'location', 'getComputedStyle', 'URL',
];

function setupEnv(html) {
  const dom = new JSDOM(html, {
    url: 'https://fixture.test/page',
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
    dom,
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

function logger() {
  return { info() {}, warn() {}, error() {} };
}

async function settle(win) {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => win.requestAnimationFrame(resolve));
  await new Promise((resolve) => setTimeout(resolve, 20));
}

function snapshot(t) {
  const msg = t.sent.find((entry) => entry.type === STREAM.SNAPSHOT);
  assert.ok(msg, 'snapshot emitted');
  return msg.payload;
}

function mutations(t) {
  return t.sent
    .filter((entry) => entry.type === STREAM.MUTATIONS)
    .flatMap((entry) => entry.payload.mutations || []);
}

test('styleMode cssom is opt-in and preserves default computed mode', async () => {
  const env = setupEnv('<!doctype html><html><head><style>.card{color:rgb(1, 2, 3)}</style></head><body><div id="card" class="card">Card</div></body></html>');
  try {
    const defaultTransport = transport();
    env.capture = createCapture({ transport: defaultTransport, logger: logger() });
    env.capture.start();
    await settle(env.window);
    const defaultPayload = snapshot(defaultTransport);
    assert.notEqual(defaultPayload.styleStrategy && defaultPayload.styleStrategy.mode, 'cssom');
    env.capture.stop();

    const cssomTransport = transport();
    env.capture = createCapture({ transport: cssomTransport, logger: logger(), styleMode: 'cssom' });
    env.capture.start();
    await settle(env.window);
    const payload = snapshot(cssomTransport);

    assert.equal(payload.styleStrategy.mode, 'cssom');
    assert.equal(Array.isArray(payload.styleSources), true);
    assert.ok(payload.styleSources.some((source) => source.scope.kind === 'document'));
    assert.ok(payload.styleSources.some((source) => String(source.cssText || '').includes('.card')));
    assert.equal(payload.html.includes('color:rgb(1, 2, 3)'), false, 'generated computed inline styles are absent');
  } finally {
    env.teardown();
  }
});

test('CSSOM snapshots include document, shadow, and frame scoped style sources', async () => {
  const env = setupEnv('<!doctype html><html><head><style>.doc{color:red}</style></head><body><x-card id="host"></x-card><iframe id="frame"></iframe></body></html>');
  try {
    const shadow = env.document.getElementById('host').attachShadow({ mode: 'open' });
    shadow.innerHTML = '<style>.shadow{color:blue}</style><span class="shadow">Shadow</span>';
    const frame = env.document.getElementById('frame');
    const frameDoc = frame.contentDocument;
    frameDoc.open();
    frameDoc.write('<!doctype html><html><head><style>.frame{color:green}</style></head><body><p class="frame">Frame</p></body></html>');
    frameDoc.close();

    const t = transport();
    env.capture = createCapture({ transport: t, logger: logger(), styleMode: 'cssom' });
    env.capture.start();
    await settle(env.window);
    const payload = snapshot(t);
    const hostNid = env.capture.getNodeId(env.document.getElementById('host'));
    const frameNid = env.capture.getNodeId(frame);

    assert.ok(payload.styleSources.some((source) => source.scope.kind === 'document' && source.cssText.includes('.doc')));
    const shadowPayload = payload.shadowRoots.find((entry) => entry.hostNid === hostNid);
    assert.ok(shadowPayload.styleSources.some((source) => source.scope.kind === 'shadow' && source.scope.hostNid === hostNid));
    const framePayload = payload.frames.find((entry) => entry.frameNid === frameNid);
    assert.ok(framePayload.styleSources.some((source) => source.scope.kind === 'frame' && source.scope.frameNid === frameNid));
  } finally {
    env.teardown();
  }
});

test('CSSOM mode does not call hidden fetch and emits dynamic style-source ops', async () => {
  const env = setupEnv('<!doctype html><html><head><style id="theme">.theme{color:red}</style></head><body><main class="theme">Theme</main></body></html>');
  try {
    const t = transport();
    let fetchCalls = 0;
    env.capture = createCapture({
      transport: t,
      logger: logger(),
      styleMode: 'cssom',
      fetchStylesheet() {
        fetchCalls += 1;
        return '.remote{color:purple}';
      },
    });
    env.capture.start();
    await settle(env.window);
    assert.equal(fetchCalls, 0, 'fetchStylesheet is explicit and not called for readable inline CSS');

    env.document.getElementById('theme').textContent = '.theme{color:blue}';
    await settle(env.window);
    const styleOps = mutations(t).filter((op) => op.op === DIFF_OP.STYLE_SOURCE);
    assert.ok(styleOps.length >= 1, 'style-source mutation emitted');
    assert.ok(styleOps.some((op) => op.action === 'replace' && /color:\s*blue/.test(op.source.cssText)));
    assert.equal(styleOps.every((op) => op.scope.kind === 'document'), true);
  } finally {
    env.teardown();
  }
});
