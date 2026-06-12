// SEC-03 privacy masking tests (plan 03-03): host-configured masking
// (blockSelector, maskTextSelector, maskInputs, maskTextFn, maskInputFn)
// applied capture-side in ALL serialization paths through the sanitizeForWire
// seams plan 03-01 created. Pins:
//   - maskTextSelector masks matching elements AND descendants in snapshot,
//     characterData, E2 text-childlist, and add-op paths -- asterisk per
//     non-whitespace char, whitespace and length preserved (rrweb-compatible
//     default, 03-RESEARCH Pattern 5).
//   - A THROWING custom mask fn falls back to the DEFAULT asterisk mask
//     (fail closed -- raw text never leaks) and routes to the logger.
//   - An invalid selector fails loudly at factory time
//     (Error('invalid-mask-selector')) -- silent masking failure would be a
//     privacy leak.
//   - With no masking config the wire carries zero masking (default-off pin:
//     byte-compatible with plan 03-01's output).
//
// The setup/teardown and settle helpers are deliberately duplicated locally
// (parallel-safe: this file imports nothing from any shared test harness).
// Globals recipe per 01-RESEARCH.md Pattern 2; settle cadence per Pattern 3;
// teardown discipline per Pitfalls 3 and 8; recording-logger containment
// shape per tests/capture-skip.test.js.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM, VirtualConsole } from 'jsdom';
import { createCapture } from '../src/capture/index.js';
import { STREAM, DIFF_OP, NID_ATTR } from '../src/protocol/messages.js';

// Complete global set the capture core dereferences (audited from the
// reference source in 01-RESEARCH.md Pattern 2).
const AUDITED_GLOBALS = [
  'window', 'document', 'Node', 'NodeFilter', 'MutationObserver',
  'requestAnimationFrame', 'cancelAnimationFrame', 'CustomEvent',
  'ShadowRoot', 'location', 'getComputedStyle', 'URL',
];

// .private subtrees are the maskTextSelector targets; #pub is the sibling
// content that must stay raw; #wrap is the unmasked add-op insertion target.
const BODY_HTML = '<div id="root">'
  + '<div id="wrap">'
  + '<div class="private" id="priv"><span id="card">Card 1234 5678</span></div>'
  + '<div class="private" id="leaf">leaf secret</div>'
  + '<p id="pub">public text</p>'
  + '</div>'
  + '</div>';

/**
 * Build a fresh JSDOM instance, install its globals on globalThis (recording
 * prior state), and return an env whose teardown stops the capture, restores
 * every global exactly, and closes the window.
 * @param {string} bodyHtml
 */
function setupEnv(bodyHtml) {
  const dom = new JSDOM(
    '<!DOCTYPE html><html><head><title>mask fixture</title></head><body>'
      + bodyHtml + '</body></html>',
    {
      url: 'https://fixture.test/page',
      pretendToBeVisual: true, // enables requestAnimationFrame for the rAF flush
      virtualConsole: new VirtualConsole(), // quiet: swallows "Not implemented" noise
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
      // Stop FIRST, while the instance globals are still installed: stop()
      // clears the self-re-arming watchdog setTimeout chain (Pitfall 3).
      try {
        if (env.capture) env.capture.stop();
      } catch (e) { /* already stopped or torn down */ }
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

/**
 * Deterministic mutation-flush cadence (01-RESEARCH.md Pattern 3, verified):
 * MutationObserver microtask delivery -> rAF flush -> async send settle.
 * @param {Window} win
 */
async function settle(win) {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => win.requestAnimationFrame(resolve));
  await new Promise((resolve) => setTimeout(resolve, 20));
}

/**
 * Loopback transport: records every (type, payload) pair.
 */
function createLoopbackTransport() {
  const sent = [];
  return {
    sent,
    send(type, payload) { sent.push({ type, payload }); },
  };
}

function silentLogger() {
  return { info() {}, warn() {}, error() {} };
}

/**
 * Wire-level scan surface: every transport.sent payload JSON-stringified.
 * The masked/blocked/raw-leak assertions run over THIS string so a leak via
 * ANY message type (snapshot, mutations, scroll, overlay, dialog) is caught.
 * @param {{sent: Array}} transport
 */
function wireText(transport) {
  return transport.sent.map((m) => JSON.stringify(m)).join('\n');
}

/** rrweb-compatible default mask: non-whitespace -> '*', whitespace kept. */
function expectMask(text) {
  return text.replace(/[\S]/g, '*');
}

/** Collect every DIFF_OP.TEXT op across all mutation batches. */
function textOps(transport) {
  return transport.sent
    .filter((m) => m.type === STREAM.MUTATIONS)
    .flatMap((m) => m.payload.mutations)
    .filter((op) => op.op === DIFF_OP.TEXT);
}

/** Collect every DIFF_OP.ADD op across all mutation batches. */
function addOps(transport) {
  return transport.sent
    .filter((m) => m.type === STREAM.MUTATIONS)
    .flatMap((m) => m.payload.mutations)
    .filter((op) => op.op === DIFF_OP.ADD);
}

// =========================================================================
// Task 1: maskTextSelector / maskTextFn across all text paths
// =========================================================================

test('snapshot masks maskTextSelector-matched text (descendants included) with whitespace and length preserved; siblings untouched', async () => {
  const env = setupEnv(BODY_HTML);
  try {
    const transport = createLoopbackTransport();
    env.capture = createCapture({
      transport,
      logger: silentLogger(),
      maskTextSelector: '.private',
    });
    env.capture.start();

    const snapshots = transport.sent.filter((m) => m.type === STREAM.SNAPSHOT);
    assert.equal(snapshots.length, 1, 'start() emits exactly one snapshot');
    const html = snapshots[0].payload.html;

    // Re-parse the snapshot html to extract masked text exactly.
    const tpl = env.document.createElement('template');
    tpl.innerHTML = html;
    const cardOriginal = 'Card 1234 5678';
    const cardMasked = tpl.content.querySelector('#card').textContent;

    // Whitespace-preservation row: masked output length equals input length
    // AND space positions are identical; every non-space char is '*'.
    assert.equal(cardMasked.length, cardOriginal.length, 'masked length equals input length');
    for (let i = 0; i < cardOriginal.length; i++) {
      if (/\s/.test(cardOriginal[i])) {
        assert.equal(cardMasked[i], cardOriginal[i], `whitespace at index ${i} preserved`);
      } else {
        assert.equal(cardMasked[i], '*', `non-whitespace at index ${i} masked`);
      }
    }

    // Descendant coverage: #card is a DESCENDANT of the .private match.
    assert.equal(cardMasked, expectMask(cardOriginal), 'descendant text masked with the default asterisk mask');
    // Self-match leaf element text masked too.
    assert.equal(tpl.content.querySelector('#leaf').textContent, expectMask('leaf secret'),
      'self-matching element text masked');
    // Sibling non-matching text untouched.
    assert.equal(tpl.content.querySelector('#pub').textContent, 'public text',
      'sibling non-matching text is raw');

    // Wire-level scan: the raw masked strings appear in NO message type.
    const wire = wireText(transport);
    assert.ok(!wire.includes('Card 1234 5678'), 'raw card text never on the wire');
    assert.ok(!wire.includes('leaf secret'), 'raw leaf text never on the wire');
  } finally {
    env.teardown();
  }
});

test('a characterData edit inside a masked element emits a masked text op; the same edit outside emits raw text', async () => {
  const env = setupEnv(BODY_HTML);
  try {
    const transport = createLoopbackTransport();
    env.capture = createCapture({
      transport,
      logger: silentLogger(),
      maskTextSelector: '.private',
    });
    env.capture.start();
    await settle(env.window);

    // Edit INSIDE the masked subtree (text node under #card under .private).
    env.document.getElementById('card').firstChild.nodeValue = 'Visa 4111 1111';
    await settle(env.window);

    // Edit OUTSIDE any masked subtree.
    env.document.getElementById('pub').firstChild.nodeValue = 'updated public';
    await settle(env.window);

    const ops = textOps(transport);
    assert.ok(
      ops.some((op) => op.text === expectMask('Visa 4111 1111')),
      'masked-subtree characterData op carries the masked text'
    );
    assert.ok(
      ops.some((op) => op.text === 'updated public'),
      'unmasked characterData op carries raw text'
    );
    const wire = wireText(transport);
    assert.ok(!wire.includes('Visa 4111 1111'), 'raw masked-subtree edit never on the wire');
  } finally {
    env.teardown();
  }
});

test('el.textContent = ... (E2 childlist path) on a masked element emits a masked text op', async () => {
  const env = setupEnv(BODY_HTML);
  try {
    const transport = createLoopbackTransport();
    env.capture = createCapture({
      transport,
      logger: silentLogger(),
      maskTextSelector: '.private',
    });
    env.capture.start();
    await settle(env.window);

    // textContent= REPLACES the text child: the observer reports a childList
    // record with TEXT-node removal+addition (the E2 branch, not characterData).
    env.document.getElementById('leaf').textContent = 'rotated secret';
    await settle(env.window);

    const ops = textOps(transport);
    assert.ok(
      ops.some((op) => op.text === expectMask('rotated secret')),
      'E2 text op carries the masked text'
    );
    const wire = wireText(transport);
    assert.ok(!wire.includes('rotated secret'), 'raw E2 text never on the wire');
  } finally {
    env.teardown();
  }
});

test('an added subtree appended INSIDE a live masked container emits add-op html with masked text (live-ancestry check)', async () => {
  const env = setupEnv(BODY_HTML);
  try {
    const transport = createLoopbackTransport();
    env.capture = createCapture({
      transport,
      logger: silentLogger(),
      maskTextSelector: '.private',
    });
    env.capture.start();
    await settle(env.window);

    // The added element does NOT match .private itself; only its LIVE
    // ancestry does. The detached wire clone has no ancestors -- the mask
    // state must come from the live node's closest() walk.
    const child = env.document.createElement('div');
    child.textContent = 'inner secret';
    env.document.getElementById('priv').appendChild(child);
    await settle(env.window);

    const adds = addOps(transport);
    assert.equal(adds.length, 1, 'exactly one add op emitted');
    assert.ok(adds[0].html.includes(expectMask('inner secret')),
      'add-op html carries the masked text');
    assert.ok(!adds[0].html.includes('inner secret'), 'add-op html has no raw text');
    const wire = wireText(transport);
    assert.ok(!wire.includes('inner secret'), 'raw added text never on the wire');
  } finally {
    env.teardown();
  }
});

test('an added subtree containing a .private descendant masks only that descendant text in the add-op html', async () => {
  const env = setupEnv(BODY_HTML);
  try {
    const transport = createLoopbackTransport();
    env.capture = createCapture({
      transport,
      logger: silentLogger(),
      maskTextSelector: '.private',
    });
    env.capture.start();
    await settle(env.window);

    const cont = env.document.createElement('div');
    cont.innerHTML = '<span id="open-span">open text</span>'
      + '<span class="private" id="hid-span">hidden text</span>';
    env.document.getElementById('wrap').appendChild(cont);
    await settle(env.window);

    const adds = addOps(transport);
    assert.equal(adds.length, 1, 'exactly one add op emitted');
    assert.ok(adds[0].html.includes('open text'),
      'non-matching descendant text stays raw in the add-op html');
    assert.ok(adds[0].html.includes(expectMask('hidden text')),
      'matching descendant text is masked in the add-op html');
    assert.ok(!adds[0].html.includes('hidden text'), 'raw matching text absent from the add-op html');
    const wire = wireText(transport);
    assert.ok(!wire.includes('hidden text'), 'raw matching text never on the wire');
  } finally {
    env.teardown();
  }
});

test('maskTextFn receives (text, element) and its return value is used on the wire', async () => {
  const env = setupEnv(BODY_HTML);
  try {
    const transport = createLoopbackTransport();
    const calls = [];
    env.capture = createCapture({
      transport,
      logger: silentLogger(),
      maskTextSelector: '.private',
      maskTextFn: (text, element) => {
        calls.push({ text, id: element && element.id });
        return '#'.repeat(text.length);
      },
    });
    env.capture.start();

    const snapshots = transport.sent.filter((m) => m.type === STREAM.SNAPSHOT);
    const tpl = env.document.createElement('template');
    tpl.innerHTML = snapshots[0].payload.html;
    assert.equal(tpl.content.querySelector('#card').textContent, '#'.repeat('Card 1234 5678'.length),
      'snapshot uses the custom mask fn return value');
    assert.ok(
      calls.some((c) => c.text === 'Card 1234 5678' && c.id === 'card'),
      'maskTextFn received (text, element) with the owning element'
    );

    // Diff path uses the same fn.
    env.document.getElementById('card').firstChild.nodeValue = 'Visa 4111';
    await settle(env.window);
    assert.ok(
      textOps(transport).some((op) => op.text === '#'.repeat('Visa 4111'.length)),
      'text op uses the custom mask fn return value'
    );
    const wire = wireText(transport);
    assert.ok(!wire.includes('Card 1234 5678'), 'raw snapshot text never on the wire');
    assert.ok(!wire.includes('Visa 4111'), 'raw diff text never on the wire');
  } finally {
    env.teardown();
  }
});

test('a THROWING maskTextFn falls back to the default asterisk mask (fail closed) and routes to the logger', async () => {
  const env = setupEnv(BODY_HTML);
  try {
    const transport = createLoopbackTransport();
    const errors = [];
    const recordingLogger = {
      info() {},
      warn() {},
      error(...args) { errors.push(args); },
    };
    env.capture = createCapture({
      transport,
      logger: recordingLogger,
      maskTextSelector: '.private',
      maskTextFn: () => { throw new TypeError('mask-fn-blew-up'); },
    });

    // start() serializes through the throwing fn: must not throw.
    assert.doesNotThrow(() => env.capture.start());
    assert.ok(errors.length >= 1, 'mask fn errors were routed to the logger');

    const snapshots = transport.sent.filter((m) => m.type === STREAM.SNAPSHOT);
    const tpl = env.document.createElement('template');
    tpl.innerHTML = snapshots[0].payload.html;
    assert.equal(tpl.content.querySelector('#card').textContent, expectMask('Card 1234 5678'),
      'fallback is the DEFAULT asterisk mask, never raw');

    // Diff path: same containment.
    env.document.getElementById('card').firstChild.nodeValue = 'Visa 4111';
    await settle(env.window);
    assert.ok(
      textOps(transport).some((op) => op.text === expectMask('Visa 4111')),
      'diff-path fallback is the default mask'
    );

    // The raw text NEVER appears in ANY message type.
    const wire = wireText(transport);
    assert.ok(!wire.includes('Card 1234 5678'), 'raw snapshot text never leaked');
    assert.ok(!wire.includes('Visa 4111'), 'raw diff text never leaked');
  } finally {
    env.teardown();
  }
});

test('createCapture({ maskTextSelector: invalid }) throws Error(invalid-mask-selector) at factory time', () => {
  const env = setupEnv(BODY_HTML);
  try {
    const transport = createLoopbackTransport();
    assert.throws(
      () => createCapture({ transport, logger: silentLogger(), maskTextSelector: ':invalid(((' }),
      /invalid-mask-selector/,
      'invalid maskTextSelector fails loudly at the factory'
    );
  } finally {
    env.teardown();
  }
});

test('with no masking config, snapshot + mutations carry zero asterisk masking (default-off pin)', async () => {
  const env = setupEnv(BODY_HTML);
  try {
    const transport = createLoopbackTransport();
    env.capture = createCapture({
      transport,
      logger: silentLogger(),
    });
    env.capture.start();
    await settle(env.window);

    env.document.getElementById('leaf').firstChild.nodeValue = 'plain update';
    await settle(env.window);

    const snapshots = transport.sent.filter((m) => m.type === STREAM.SNAPSHOT);
    const html = snapshots[0].payload.html;
    assert.ok(html.includes('Card 1234 5678'), 'snapshot keeps raw text without masking config');
    assert.ok(html.includes('leaf secret'), 'snapshot keeps raw leaf text');
    assert.ok(html.includes('public text'), 'snapshot keeps raw public text');
    assert.ok(
      textOps(transport).some((op) => op.text === 'plain update'),
      'text op carries raw text without masking config'
    );
    // The fixture contains no asterisks: ANY '*' on the wire would mean
    // masking was applied with no config (default-off violation).
    const wire = wireText(transport);
    assert.ok(!wire.includes('*'), 'zero asterisk masking anywhere on the wire');
  } finally {
    env.teardown();
  }
});
