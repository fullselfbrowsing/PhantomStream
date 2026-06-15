// Phase 8 RED tests for live form value capture (CAPT-05).
// These tests intentionally fail until the capture core emits narrow value
// diff ops for input/change events whose live DOM property changes are not
// visible to MutationObserver attribute tracking.

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

const VALUE_OP = DIFF_OP.VALUE || 'value';

const BODY_HTML = '<div id="root">'
  + '<input id="text" type="text" value="initial">'
  + '<textarea id="textarea">initial area</textarea>'
  + '<select id="select" multiple>'
  + '<option value="alpha">Alpha</option>'
  + '<option value="beta">Beta</option>'
  + '<option value="gamma">Gamma</option>'
  + '</select>'
  + '<input id="checkbox" type="checkbox">'
  + '<input id="radio-a" type="radio" name="choice" value="a">'
  + '<input id="radio-b" type="radio" name="choice" value="b">'
  + '<input id="password" type="password" value="">'
  + '</div>';

function setupEnv(bodyHtml = BODY_HTML) {
  const dom = new JSDOM(
    '<!DOCTYPE html><html><head><title>value fixture</title></head><body>'
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

function wireText(transport) {
  return transport.sent.map((m) => JSON.stringify(m)).join('\n');
}

function expectMask(text) {
  return text.replace(/[\S]/g, '*');
}

function mutationOps(transport) {
  return transport.sent
    .filter((m) => m.type === STREAM.MUTATIONS)
    .flatMap((m) => m.payload.mutations);
}

function valueOps(transport) {
  return mutationOps(transport)
    .filter((op) => op.op === DIFF_OP.VALUE || op.op === VALUE_OP);
}

function dispatchValueEvent(env, el, type) {
  el.dispatchEvent(new env.window.Event(type, { bubbles: true }));
}

test('input event emits a DIFF_OP.VALUE op for property-only input.value drift', async () => {
  const env = setupEnv();
  try {
    const transport = createRecordingTransport();
    env.capture = createCapture({ transport, logger: silentLogger() });
    env.capture.start();
    await settle(env.window);

    const input = env.document.getElementById('text');
    const nid = env.capture.getNodeId(input);
    input.value = 'typed text';
    dispatchValueEvent(env, input, 'input');
    await settle(env.window);

    assert.ok(
      valueOps(transport).some((op) => (
        op.op === VALUE_OP
        && op.nid === nid
        && op.value === 'typed text'
        && !Object.prototype.hasOwnProperty.call(op, 'html')
      )),
      'input property drift emitted a narrow value op without replacing the node'
    );
  } finally {
    env.teardown();
  }
});

test('textarea, select, checkbox, and radio controls emit typed value-state diffs', async () => {
  const env = setupEnv();
  try {
    const transport = createRecordingTransport();
    env.capture = createCapture({ transport, logger: silentLogger() });
    env.capture.start();
    await settle(env.window);

    const textarea = env.document.getElementById('textarea');
    const select = env.document.getElementById('select');
    const checkbox = env.document.getElementById('checkbox');
    const radio = env.document.getElementById('radio-b');
    const ids = {
      textarea: env.capture.getNodeId(textarea),
      select: env.capture.getNodeId(select),
      checkbox: env.capture.getNodeId(checkbox),
      radio: env.capture.getNodeId(radio),
    };

    textarea.value = 'typed area';
    dispatchValueEvent(env, textarea, 'input');
    select.options[0].selected = true;
    select.options[2].selected = true;
    dispatchValueEvent(env, select, 'change');
    checkbox.checked = true;
    dispatchValueEvent(env, checkbox, 'change');
    radio.checked = true;
    dispatchValueEvent(env, radio, 'change');
    await settle(env.window);

    const ops = valueOps(transport);
    assert.ok(
      ops.some((op) => op.nid === ids.textarea && op.value === 'typed area'),
      'textarea emits value'
    );
    assert.ok(
      ops.some((op) => (
        op.nid === ids.select
        && Array.isArray(op.selectedValues)
        && op.selectedValues.join(',') === 'alpha,gamma'
      )),
      'select emits selectedValues in selected option order'
    );
    assert.ok(
      ops.some((op) => op.nid === ids.checkbox && op.checked === true),
      'checkbox emits checked state'
    );
    assert.ok(
      ops.some((op) => op.nid === ids.radio && op.checked === true && op.value === 'b'),
      'radio emits checked state and current value'
    );
  } finally {
    env.teardown();
  }
});

test('password value diffs are always masked and raw typed text is absent from the whole wire', async () => {
  const env = setupEnv();
  try {
    const transport = createRecordingTransport();
    env.capture = createCapture({ transport, logger: silentLogger() });
    env.capture.start();
    await settle(env.window);

    const password = env.document.getElementById('password');
    const nid = env.capture.getNodeId(password);
    password.value = 'password typed secret';
    dispatchValueEvent(env, password, 'input');
    await settle(env.window);

    assert.ok(
      valueOps(transport).some((op) => (
        op.nid === nid && op.value === expectMask('password typed secret')
      )),
      'password input emits only masked event-driven value'
    );
    assert.ok(
      !wireText(transport).includes('password typed secret'),
      'raw password typed text never appears in any transport message'
    );
  } finally {
    env.teardown();
  }
});

test('maskInputs true masks event-driven value diffs for non-password controls', async () => {
  const env = setupEnv();
  try {
    const transport = createRecordingTransport();
    env.capture = createCapture({
      transport,
      logger: silentLogger(),
      maskInputs: true,
    });
    env.capture.start();
    await settle(env.window);

    const input = env.document.getElementById('text');
    const nid = env.capture.getNodeId(input);
    input.value = 'maskInputs live value';
    dispatchValueEvent(env, input, 'input');
    await settle(env.window);

    assert.ok(
      valueOps(transport).some((op) => (
        op.nid === nid && op.value === expectMask('maskInputs live value')
      )),
      'maskInputs applies to event-driven value diffs'
    );
    assert.ok(
      !wireText(transport).includes('maskInputs live value'),
      'raw maskInputs value never appears in any transport message'
    );
  } finally {
    env.teardown();
  }
});

test('maskInputFn return value is used for event-driven value diffs', async () => {
  const env = setupEnv();
  try {
    const transport = createRecordingTransport();
    const calls = [];
    env.capture = createCapture({
      transport,
      logger: silentLogger(),
      maskInputs: true,
      maskInputFn: (text, element) => {
        calls.push({ text, id: element && element.id });
        return '#'.repeat(text.length);
      },
    });
    env.capture.start();
    await settle(env.window);

    const input = env.document.getElementById('text');
    const nid = env.capture.getNodeId(input);
    input.value = 'custom mask input';
    dispatchValueEvent(env, input, 'input');
    await settle(env.window);

    assert.ok(
      calls.some((call) => call.text === 'custom mask input' && call.id === 'text'),
      'maskInputFn received the live value and owning element'
    );
    assert.ok(
      valueOps(transport).some((op) => (
        op.nid === nid && op.value === '#'.repeat('custom mask input'.length)
      )),
      'event-driven value op uses maskInputFn return value'
    );
    assert.ok(
      !wireText(transport).includes('custom mask input'),
      'raw custom-masked value never appears in any transport message'
    );
  } finally {
    env.teardown();
  }
});
