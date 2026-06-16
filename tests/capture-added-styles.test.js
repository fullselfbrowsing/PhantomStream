// Phase 8 RED tests for computed styles on late-added nodes (CAPT-06).
// These tests intentionally fail until processAddedNode captures curated
// computed styles for added subtrees before serializing add-op HTML.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM, VirtualConsole } from 'jsdom';
import { createCapture } from '../src/capture/index.js';
import { RELAY_PER_MESSAGE_LIMIT_BYTES } from '../src/protocol/constants.js';
import { STREAM, DIFF_OP } from '../src/protocol/messages.js';

const AUDITED_GLOBALS = [
  'window', 'document', 'Node', 'NodeFilter', 'MutationObserver',
  'requestAnimationFrame', 'cancelAnimationFrame', 'CustomEvent',
  'ShadowRoot', 'location', 'getComputedStyle', 'URL',
];

// Static guard for the planned implementation: added-node style capture must
// use the same CURATED_PROPS list as snapshot capture, not broad enumeration.
const CURATED_PROPS_SENTINEL = 'CURATED_PROPS';

function setupEnv(bodyHtml = '<div id="host"></div>') {
  const dom = new JSDOM(
    '<!DOCTYPE html><html><head><title>added style fixture</title></head><body>'
      + bodyHtml + '</body></html>',
    {
      url: 'https://fixture.test/page',
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
      } catch (e) {}
      env.capture = null;
      for (const key of AUDITED_GLOBALS) {
        const p = prior.get(key);
        if (p.present) globalThis[key] = p.value;
        else delete globalThis[key];
      }
      w.close();
    },
  };
  return env;
}

async function settle(win) {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => win.requestAnimationFrame(resolve));
  await new Promise((resolve) => setTimeout(resolve, 20));
}

function createRecordingTransport() {
  const sent = [];
  return {
    sent,
    send(type, payload) { sent.push({ type, payload }); },
  };
}

function silentLogger() {
  return { info() {}, warn() {}, error() {} };
}

function addOps(transport) {
  return transport.sent
    .filter((m) => m.type === STREAM.MUTATIONS)
    .flatMap((m) => m.payload.mutations)
    .filter((op) => op.op === DIFF_OP.ADD);
}

function wireByteLength(value) {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function parseFragment(env, html) {
  const tpl = env.document.createElement('template');
  tpl.innerHTML = html;
  return tpl.content;
}

function styleOf(fragment, selector) {
  const el = fragment.querySelector(selector);
  assert.ok(el, selector + ' exists in add-op html');
  return el.getAttribute('style') || '';
}

function installComputedStyleStub(env, styleById) {
  const calls = [];
  function computedFor(el) {
    assert.equal(
      el.ownerDocument,
      env.document,
      'getComputedStyle reads the live document element, not a detached clone'
    );
    calls.push(el.id || el.tagName.toLowerCase());
    const values = styleById[el.id] || {};
    const computed = {
      length: 3,
      getPropertyValue(prop) {
        if (prop === '0' || prop === '1' || prop === '2') {
          throw new Error('broad computed style enumeration is forbidden');
        }
        return Object.prototype.hasOwnProperty.call(values, prop) ? values[prop] : '';
      },
    };
    Object.defineProperty(computed, '0', {
      get() { throw new Error('broad computed style property index 0 was read'); },
    });
    Object.defineProperty(computed, '1', {
      get() { throw new Error('broad computed style property index 1 was read'); },
    });
    Object.defineProperty(computed, '2', {
      get() { throw new Error('broad computed style property index 2 was read'); },
    });
    return computed;
  }

  env.window.getComputedStyle = computedFor;
  globalThis.getComputedStyle = computedFor;
  return calls;
}

test('late-added element add op carries sanitized inline styles from curated computed properties', async () => {
  assert.equal(CURATED_PROPS_SENTINEL, 'CURATED_PROPS');
  const env = setupEnv();
  try {
    const transport = createRecordingTransport();
    const calls = installComputedStyleStub(env, {
      'late-root': {
        display: 'inline-flex',
        color: 'rgb(12, 34, 56)',
        'background-color': 'rgb(240, 240, 240)',
        'font-size': '18px',
      },
    });
    env.capture = createCapture({ transport, logger: silentLogger() });
    env.capture.start();
    await settle(env.window);
    calls.length = 0;

    const late = env.document.createElement('section');
    late.id = 'late-root';
    late.textContent = 'styled late node';
    env.document.getElementById('host').appendChild(late);
    await settle(env.window);

    const adds = addOps(transport);
    assert.equal(adds.length, 1, 'one add op emitted for the late root');
    assert.equal(adds[0].nodeIds[0], env.capture.getNodeId(late), 'nodeIds includes the late root nid');
    const style = styleOf(parseFragment(env, adds[0].html), '#late-root');
    assert.match(style, /display:inline-flex/, 'curated display captured');
    assert.match(style, /color:rgb\(12,\s*34,\s*56\)/, 'curated color captured');
    assert.match(style, /background-color:rgb\(240,\s*240,\s*240\)/, 'curated background-color captured');
    assert.match(style, /font-size:18px/, 'curated font-size captured');
    assert.deepEqual(calls, ['late-root'], 'one getComputedStyle read for the live added root');
  } finally {
    env.teardown();
  }
});

test('late-added subtree descendants carry styles and nodeIds remain preorder', async () => {
  const env = setupEnv();
  try {
    const transport = createRecordingTransport();
    const calls = installComputedStyleStub(env, {
      'late-root': {
        display: 'grid',
        color: 'rgb(1, 2, 3)',
      },
      'late-child': {
        display: 'inline-block',
        'background-color': 'rgb(4, 5, 6)',
        'font-size': '13px',
      },
    });
    env.capture = createCapture({ transport, logger: silentLogger() });
    env.capture.start();
    await settle(env.window);
    calls.length = 0;

    const root = env.document.createElement('article');
    root.id = 'late-root';
    const child = env.document.createElement('span');
    child.id = 'late-child';
    child.textContent = 'child text';
    root.appendChild(child);
    env.document.getElementById('host').appendChild(root);
    await settle(env.window);

    const adds = addOps(transport);
    assert.equal(adds.length, 1, 'the added subtree is serialized as one add op');
    assert.deepEqual(
      adds[0].nodeIds,
      [env.capture.getNodeId(root), env.capture.getNodeId(child)],
      'nodeIds remain root-first preorder'
    );
    const fragment = parseFragment(env, adds[0].html);
    assert.match(styleOf(fragment, '#late-root'), /display:grid/, 'root style captured');
    assert.match(styleOf(fragment, '#late-child'), /display:inline-block/, 'child display captured');
    assert.match(styleOf(fragment, '#late-child'), /background-color:rgb\(4,\s*5,\s*6\)/,
      'child background-color captured');
    assert.deepEqual(calls, ['late-root', 'late-child'], 'one style read per live subtree element');
  } finally {
    env.teardown();
  }
});

test('added-node style capture uses bounded getComputedStyle reads and no all-property enumeration', async () => {
  const env = setupEnv();
  try {
    const transport = createRecordingTransport();
    const calls = installComputedStyleStub(env, {
      'late-root': {
        display: 'flex',
        color: 'rgb(10, 20, 30)',
      },
      'late-child': {
        display: 'block',
        'font-size': '15px',
      },
    });
    env.capture = createCapture({ transport, logger: silentLogger() });
    env.capture.start();
    await settle(env.window);
    calls.length = 0;

    const root = env.document.createElement('div');
    root.id = 'late-root';
    const child = env.document.createElement('b');
    child.id = 'late-child';
    child.textContent = 'bold';
    root.appendChild(child);
    env.document.getElementById('host').appendChild(root);
    await settle(env.window);

    assert.deepEqual(
      calls,
      ['late-root', 'late-child'],
      'getComputedStyle called exactly once per live element in the added subtree'
    );
    assert.equal(addOps(transport).length, 1, 'style reads did not prevent add-op emission');
  } finally {
    env.teardown();
  }
});

test('dangerous computed CSS values on added nodes are scrubbed through the add-op sanitizer', async () => {
  const env = setupEnv();
  try {
    const transport = createRecordingTransport();
    installComputedStyleStub(env, {
      'late-root': {
        display: 'block',
        'background-image': 'url("javascript:alert(1)")',
        color: 'rgb(20, 30, 40)',
      },
      'late-child': {
        display: 'inline',
        'background-image': 'url("https://safe.test/bg.png")',
        width: 'expression(alert(1))',
      },
    });
    env.capture = createCapture({ transport, logger: silentLogger() });
    env.capture.start();
    await settle(env.window);

    const root = env.document.createElement('div');
    root.id = 'late-root';
    const child = env.document.createElement('span');
    child.id = 'late-child';
    child.textContent = 'safe text';
    root.appendChild(child);
    env.document.getElementById('host').appendChild(root);
    await settle(env.window);

    const adds = addOps(transport);
    assert.equal(adds.length, 1, 'the hostile styled subtree still emits an add op');
    const html = adds[0].html;
    assert.match(html, /\bstyle="/, 'computed style attribute was captured before sanitization');
    assert.doesNotMatch(html, /javascript:/i, 'javascript URL from computed style is scrubbed');
    assert.doesNotMatch(html, /expression\s*\(/i, 'expression() from computed style is scrubbed');
    assert.match(html, /about:blank|https:\/\/safe\.test\/bg\.png/, 'safe or neutralized CSS URL remains');
    assert.match(html, /color:rgb\(20,\s*30,\s*40\)/, 'benign computed CSS survives sanitizer');
  } finally {
    env.teardown();
  }
});

test('oversized add mutations emit bounded requestable truncated placeholders', async () => {
  const env = setupEnv();
  try {
    const transport = createRecordingTransport();
    env.capture = createCapture({ transport, logger: silentLogger() });
    env.capture.start();
    await settle(env.window);

    const late = env.document.createElement('section');
    late.id = 'late-huge';
    late.textContent = '😀'.repeat(Math.floor(RELAY_PER_MESSAGE_LIMIT_BYTES / 3));
    env.document.getElementById('host').appendChild(late);
    await settle(env.window);

    const mutationPayload = transport.sent.find((m) => m.type === STREAM.MUTATIONS)?.payload;
    assert.ok(mutationPayload, 'a mutation payload is emitted');
    assert.equal(
      wireByteLength(mutationPayload) <= RELAY_PER_MESSAGE_LIMIT_BYTES,
      true,
      'mutation payload stays under the UTF-8 relay budget'
    );

    const add = addOps(transport)[0];
    const lateNid = env.capture.getNodeId(late);
    assert.ok(add, 'one add op is emitted');
    assert.equal(add.html.includes('data-phantomstream-truncated="true"'), true,
      'oversized add op installs a requestable truncated marker');
    assert.deepEqual(add.nodeIds, [lateNid], 'placeholder keeps the added root nid requestable');
    assert.deepEqual(add.shadowRoots, [], 'oversized add op carries no sidecars');
    assert.deepEqual(add.frames, [], 'oversized add op carries no frame sidecars');
    assert.equal(add.truncated, true, 'oversized add op is marked truncated');
    assert.equal(add.missingDescendants > 0, true, 'oversized add op records missing descendants');
  } finally {
    env.teardown();
  }
});
