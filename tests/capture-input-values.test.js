// Phase 8 RED tests for live form value capture (CAPT-05).
// These tests intentionally fail until the capture core emits narrow value
// diff ops for input/change events whose live DOM property changes are not
// visible to MutationObserver attribute tracking.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM, VirtualConsole } from 'jsdom';
import { createCapture } from '../src/capture/index.js';
import { applyMutations } from '../src/renderer/diff.js';
import { RELAY_PER_MESSAGE_LIMIT_BYTES } from '../src/protocol/constants.js';
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

function wireByteLength(value) {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
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

test('same-origin iframe input events emit frame-scoped DIFF_OP.VALUE diffs', async () => {
  const env = setupEnv('<main><iframe id="same-frame"></iframe></main>');
  try {
    const frame = env.document.getElementById('same-frame');
    const frameDoc = frame.contentDocument;
    frameDoc.open();
    frameDoc.write('<!DOCTYPE html><html><body><input id="inside-frame" value="initial"></body></html>');
    frameDoc.close();

    const transport = createRecordingTransport();
    env.capture = createCapture({ transport, logger: silentLogger() });
    env.capture.start();
    await settle(env.window);

    assert.equal(typeof env.capture.getObservedFrameDocuments, 'function', 'frame root registry is exposed');
    const roots = env.capture.getObservedFrameDocuments();
    const frameNid = env.capture.getNodeId(frame);
    assert.ok(roots.some((entry) => (
      entry.frameNid === frameNid
      && entry.document === frameDoc
      && entry.root === frameDoc
    )), 'same-origin iframe document root is registered for downstream value listeners');

    const frameInput = frameDoc.getElementById('inside-frame');
    const inputNid = env.capture.getNodeId(frameInput);
    frameInput.value = 'typed inside iframe';
    const EventCtor = frame.contentWindow && frame.contentWindow.Event
      ? frame.contentWindow.Event
      : env.window.Event;
    frameInput.dispatchEvent(new EventCtor('input', { bubbles: true }));
    await settle(env.window);

    assert.ok(
      valueOps(transport).some((op) => (
        op.op === VALUE_OP
        && op.frameNid === frameNid
        && op.nid === inputNid
        && op.value === 'typed inside iframe'
        && !Object.prototype.hasOwnProperty.call(op, 'html')
      )),
      'same-origin iframe input emitted a frame-scoped narrow value op'
    );
  } finally {
    env.teardown();
  }
});

test('oversized value diffs are bounded by the relay cap', async () => {
  const env = setupEnv('<main><textarea id="huge-value"></textarea></main>');
  try {
    const transport = createRecordingTransport();
    env.capture = createCapture({ transport, logger: silentLogger() });
    env.capture.start();
    await settle(env.window);

    const textarea = env.document.getElementById('huge-value');
    textarea.value = 'v'.repeat(RELAY_PER_MESSAGE_LIMIT_BYTES + 1024);
    dispatchValueEvent(env, textarea, 'input');
    await settle(env.window);

    const mutationPayloads = transport.sent
      .filter((m) => m.type === STREAM.MUTATIONS)
      .map((m) => m.payload);
    assert.equal(
      mutationPayloads.every((payload) => wireByteLength(payload) <= RELAY_PER_MESSAGE_LIMIT_BYTES),
      true,
      'every value mutation payload stays under the UTF-8 relay cap'
    );
    assert.equal(
      mutationPayloads.some((payload) => (
        (payload.mutations || []).some((op) => op.op === VALUE_OP && op.value === textarea.value)
      )),
      false,
      'over-cap value diff is not sent raw'
    );
  } finally {
    env.teardown();
  }
});

test('masked <select> with colliding option masks selects the exact option by index, not value', async () => {
  // 'aa' and 'bb' both collapse to '**' under the default mask. A value-keyed
  // renderer would match the masked selectedValue ('**') against the masked
  // mirror option values ('**') and select the WRONG option -- or both. The
  // selectedIndexes sidecar pins the exact selected option without putting any
  // raw value on the wire (SEC-03).
  const env = setupEnv(
    '<select id="sel">'
    + '<option value="aa">First</option>'
    + '<option value="bb">Second</option>'
    + '</select>'
  );
  try {
    const transport = createRecordingTransport();
    env.capture = createCapture({
      transport,
      logger: silentLogger(),
      maskInputs: true,
    });
    env.capture.start();
    await settle(env.window);

    const select = env.document.getElementById('sel');
    const nid = env.capture.getNodeId(select);
    // Select the SECOND option (index 1, raw value 'bb').
    select.options[0].selected = false;
    select.options[1].selected = true;
    dispatchValueEvent(env, select, 'change');
    await settle(env.window);

    const selectOp = valueOps(transport).find((op) => op.nid === nid);
    assert.ok(selectOp, 'a value op for the masked select reached the wire');

    // selectedIndexes carries the unambiguous positional identity.
    assert.deepEqual(
      selectOp.selectedIndexes,
      [1],
      'selectedIndexes pins the exact selected option index'
    );
    // selectedValues are masked and now collide -- proving they cannot
    // disambiguate the selection on their own.
    assert.deepEqual(
      selectOp.selectedValues,
      [expectMask('bb')],
      'selectedValues are masked (and collide with the other option mask)'
    );
    // SEC-03: no raw option value ever leaves the page.
    assert.ok(!wireText(transport).includes('"aa"'), 'raw option value aa never on the wire');
    assert.ok(!wireText(transport).includes('"bb"'), 'raw option value bb never on the wire');

    // Build the masked MIRROR the snapshot path would produce: both option
    // values are masked to '**', so the values alone are indistinguishable.
    const mirror = env.document.implementation.createHTMLDocument('mirror');
    mirror.body.innerHTML = '<select id="sel">'
      + '<option value="' + expectMask('aa') + '">First</option>'
      + '<option value="' + expectMask('bb') + '">Second</option>'
      + '</select>';
    const mirrorSelect = mirror.getElementById('sel');
    const identity = {
      resolve(targetNid) { return String(targetNid) === String(nid) ? mirrorSelect : null; },
    };

    applyMutations(mirror, [selectOp], { staleMisses: 0, applyFailures: 0 }, { identity });

    assert.equal(mirrorSelect.options[0].selected, false, 'first option is NOT selected');
    assert.equal(mirrorSelect.options[1].selected, true, 'second option IS selected by index');
    assert.equal(mirrorSelect.selectedIndex, 1, 'renderer selected exactly the captured option');
  } finally {
    env.teardown();
  }
});

test('select with a skipElement-filtered <option> omits selectedIndexes so value matching stays correct', async () => {
  // skipElement drops <option value="beta"> from the wire, so the mirror's
  // options list is SHORTER than the live select. A live-collection index ([2]
  // for gamma) would address the wrong option (or nothing) in the 2-option
  // mirror, so capture must omit selectedIndexes and let value matching resolve
  // the selection. (Regression: previously selectedIndexes was always emitted.)
  const env = setupEnv(
    '<select id="sel">'
    + '<option value="alpha">Alpha</option>'
    + '<option value="beta" data-skip="1">Beta</option>'
    + '<option value="gamma">Gamma</option>'
    + '</select>'
  );
  try {
    const transport = createRecordingTransport();
    env.capture = createCapture({
      transport,
      logger: silentLogger(),
      skipElement: (el) => !!(el && el.getAttribute && el.getAttribute('data-skip') === '1'),
    });
    env.capture.start();
    await settle(env.window);

    const select = env.document.getElementById('sel');
    const nid = env.capture.getNodeId(select);
    // Select the third LIVE option (live index 2, value 'gamma').
    select.value = 'gamma';
    dispatchValueEvent(env, select, 'change');
    await settle(env.window);

    const selectOp = valueOps(transport).find((op) => op.nid === nid);
    assert.ok(selectOp, 'a value op for the select reached the wire');
    assert.equal(
      Object.prototype.hasOwnProperty.call(selectOp, 'selectedIndexes'),
      false,
      'selectedIndexes is omitted because an <option> is filtered from the wire'
    );
    assert.deepEqual(selectOp.selectedValues, ['gamma'], 'selectedValues remain for value matching');

    // The snapshot path produces a mirror with the skipped option REMOVED, so
    // options are [alpha(0), gamma(1)] -- the stale live index 2 does not exist.
    const mirror = env.document.implementation.createHTMLDocument('mirror');
    mirror.body.innerHTML = '<select id="sel">'
      + '<option value="alpha">Alpha</option>'
      + '<option value="gamma">Gamma</option>'
      + '</select>';
    const mirrorSelect = mirror.getElementById('sel');
    const identity = {
      resolve(targetNid) { return String(targetNid) === String(nid) ? mirrorSelect : null; },
    };

    applyMutations(mirror, [selectOp], { staleMisses: 0, applyFailures: 0 }, { identity });

    assert.equal(mirrorSelect.options[0].selected, false, 'alpha is not selected');
    assert.equal(mirrorSelect.options[1].selected, true, 'gamma IS selected by value, not a stale index');
    assert.equal(mirrorSelect.selectedIndex, 1, 'renderer selected the correct mirror option');
  } finally {
    env.teardown();
  }
});
