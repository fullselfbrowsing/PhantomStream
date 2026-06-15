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
import { STREAM, DIFF_OP } from '../src/protocol/messages.js';

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

function nodeIdForSerializedElement(payload, element) {
  const elements = Array.from(element.getRootNode().querySelectorAll('*'));
  const index = elements.indexOf(element);
  assert.ok(index >= 0, 'serialized element belongs to the parsed payload');
  assert.ok(Array.isArray(payload.nodeIds), 'payload carries nodeIds sidecar');
  return payload.nodeIds[index];
}

// .blocked subtrees are the blockSelector targets; the inputs cover the
// always-on password mask plus the configurable maskInputs rule.
const BLOCK_BODY_HTML = '<div id="root">'
  + '<div id="wrap">'
  + '<div class="blocked" id="blk" data-secret="s3cr3t-attr"><span id="blk-child">blocked content text</span></div>'
  + '<input id="pw" type="password" value="hunter2">'
  + '<input id="txt" type="text" value="visible-value">'
  + '<textarea id="ta">textarea secret body</textarea>'
  + '<select id="sel"><option id="sel-opt" value="option-secret-value">Visible option label</option></select>'
  + '<p id="pub2">tracked public</p>'
  + '</div>'
  + '</div>';

/** Collect every DIFF_OP.ATTR op across all mutation batches. */
function attrOps(transport) {
  return transport.sent
    .filter((m) => m.type === STREAM.MUTATIONS)
    .flatMap((m) => m.payload.mutations)
    .filter((op) => op.op === DIFF_OP.ATTR);
}

/** Stub a fixed live rect on an element (jsdom returns zeros otherwise). */
function stubRect(el, width, height) {
  el.getBoundingClientRect = () => ({
    width, height, top: 0, left: 0, right: width, bottom: height, x: 0, y: 0,
  });
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
    const snapshot = snapshots[0].payload;
    const html = snapshot.html;

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

// =========================================================================
// Task 2: blockSelector placeholder + maskInputs / password value masking
// =========================================================================

test('a blockSelector-matched element emits ONLY a rr_width/rr_height placeholder with the nid -- no attrs, children, or text', async () => {
  const env = setupEnv(BLOCK_BODY_HTML);
  try {
    const transport = createLoopbackTransport();
    stubRect(env.document.getElementById('blk'), 320, 240);
    env.capture = createCapture({
      transport,
      logger: silentLogger(),
      blockSelector: '.blocked',
    });
    env.capture.start();

    const snapshots = transport.sent.filter((m) => m.type === STREAM.SNAPSHOT);
    assert.equal(snapshots.length, 1, 'start() emits exactly one snapshot');
    const snapshot = snapshots[0].payload;
    const html = snapshot.html;

    // Nothing of the blocked element's content reaches the snapshot.
    assert.ok(!html.includes('blocked content text'), 'blocked text absent');
    assert.ok(!html.includes('s3cr3t-attr'), 'blocked attribute value absent');
    assert.ok(!html.includes('data-secret'), 'blocked attribute name absent');
    assert.ok(!html.includes('blk-child'), 'blocked descendant absent');

    // The placeholder carries rr_width/rr_height (px from the live rect)
    // and NOTHING else. Identity travels in the nodeIds sidecar.
    const tpl = env.document.createElement('template');
    tpl.innerHTML = html;
    const placeholder = tpl.content.querySelector('[rr_width]');
    assert.ok(placeholder, 'placeholder present in the snapshot');
    assert.equal(placeholder.getAttribute('rr_width'), '320px', 'rr_width carries the live px width');
    assert.equal(placeholder.getAttribute('rr_height'), '240px', 'rr_height carries the live px height');
    assert.equal(placeholder.attributes.length, 2, 'placeholder has EXACTLY rr_width + rr_height');
    assert.equal(placeholder.childNodes.length, 0, 'placeholder has no children and no text');

    // The live blocked element is tracked (placeholder addressable for
    // later rm ops) and the sidecar nid matches.
    assert.equal(
      nodeIdForSerializedElement(snapshot, placeholder),
      env.capture.getNodeId(env.document.getElementById('blk')),
      'placeholder sidecar nid matches the live blocked element nid'
    );
  } finally {
    env.teardown();
  }
});

test('attribute, text, and childList mutations anywhere inside a blocked subtree (including ON it) emit zero ops', async () => {
  const env = setupEnv(BLOCK_BODY_HTML);
  try {
    const transport = createLoopbackTransport();
    env.capture = createCapture({
      transport,
      logger: silentLogger(),
      blockSelector: '.blocked',
    });
    env.capture.start();
    await settle(env.window);

    const mutationCount = () => transport.sent.filter((m) => m.type === STREAM.MUTATIONS).length;
    assert.equal(mutationCount(), 0, 'no mutation traffic before any edit');

    // ON the blocked element itself (attr op on the blocked root).
    env.document.getElementById('blk').setAttribute('data-blocked-edit', '1');
    // Attribute on a descendant.
    env.document.getElementById('blk-child').setAttribute('data-deep-edit', '1');
    // characterData on a descendant text node.
    env.document.getElementById('blk-child').firstChild.nodeValue = 'changed blocked text';
    // childList inside the blocked subtree.
    env.document.getElementById('blk').appendChild(env.document.createElement('div'));
    await settle(env.window);
    assert.equal(mutationCount(), 0, 'mutations on/inside the blocked subtree emit no ops');

    // The pipeline is still alive: tracked content streams.
    env.document.getElementById('pub2').setAttribute('data-tracked', 'yes');
    await settle(env.window);
    const batches = transport.sent.filter((m) => m.type === STREAM.MUTATIONS);
    assert.equal(batches.length, 1, 'tracked content still streams');
    const ops = batches[0].payload.mutations;
    assert.ok(ops.some((op) => op.op === DIFF_OP.ATTR && op.attr === 'data-tracked'), 'tracked op on the wire');
    assert.ok(!ops.some((op) => op.attr === 'data-blocked-edit' || op.attr === 'data-deep-edit'),
      'no blocked-subtree op leaked');
    const wire = wireText(transport);
    assert.ok(!wire.includes('changed blocked text'), 'blocked text edit never on the wire');
  } finally {
    env.teardown();
  }
});

test('a blockSelector-matched element ADDED post-snapshot emits an add op whose html is the placeholder shape', async () => {
  const env = setupEnv(BLOCK_BODY_HTML);
  try {
    const transport = createLoopbackTransport();
    env.capture = createCapture({
      transport,
      logger: silentLogger(),
      blockSelector: '.blocked',
    });
    env.capture.start();
    await settle(env.window);

    const late = env.document.createElement('div');
    late.className = 'blocked';
    late.setAttribute('data-late-secret', 'late-attr-secret');
    late.textContent = 'late blocked secret';
    stubRect(late, 111, 222);
    env.document.getElementById('wrap').appendChild(late);
    await settle(env.window);

    const adds = addOps(transport);
    assert.equal(adds.length, 1, 'exactly one add op emitted');
    assert.ok(adds[0].html.includes('rr_width="111px"'), 'add-op html is the placeholder (rr_width)');
    assert.ok(adds[0].html.includes('rr_height="222px"'), 'add-op html is the placeholder (rr_height)');
    assert.deepEqual(adds[0].nodeIds, [env.capture.getNodeId(late)], 'placeholder identity travels in nodeIds');
    assert.ok(!adds[0].html.includes('late blocked secret'), 'blocked content absent from the add op');
    assert.ok(!adds[0].html.includes('late-attr-secret'), 'blocked attribute absent from the add op');
    const wire = wireText(transport);
    assert.ok(!wire.includes('late blocked secret'), 'blocked content never on the wire');
  } finally {
    env.teardown();
  }
});

test('an added subtree CONTAINING a blocked descendant swaps that descendant for the placeholder in the add-op html', async () => {
  const env = setupEnv(BLOCK_BODY_HTML);
  try {
    const transport = createLoopbackTransport();
    env.capture = createCapture({
      transport,
      logger: silentLogger(),
      blockSelector: '.blocked',
    });
    env.capture.start();
    await settle(env.window);

    const cont = env.document.createElement('div');
    cont.innerHTML = '<span id="fine-span">fine text</span>'
      + '<div class="blocked" id="late-blk">deep blocked secret</div>';
    stubRect(cont.querySelector('#late-blk'), 50, 60);
    env.document.getElementById('wrap').appendChild(cont);
    await settle(env.window);

    const adds = addOps(transport);
    assert.equal(adds.length, 1, 'exactly one add op emitted');
    assert.ok(adds[0].html.includes('fine text'), 'unblocked sibling text stays raw');
    assert.ok(adds[0].html.includes('rr_width="50px"'), 'blocked descendant became a placeholder');
    assert.ok(adds[0].html.includes('rr_height="60px"'), 'placeholder carries the live rect height');
    assert.ok(!adds[0].html.includes('deep blocked secret'), 'blocked descendant content absent');
    const wire = wireText(transport);
    assert.ok(!wire.includes('deep blocked secret'), 'blocked descendant content never on the wire');
  } finally {
    env.teardown();
  }
});

test('input[type=password] value is masked in the snapshot even with NO masking config (always-on, non-configurable)', async () => {
  const env = setupEnv(BLOCK_BODY_HTML);
  try {
    const transport = createLoopbackTransport();
    env.capture = createCapture({
      transport,
      logger: silentLogger(),
    });
    env.capture.start();

    const snapshots = transport.sent.filter((m) => m.type === STREAM.SNAPSHOT);
    const snapshot = snapshots[0].payload;
    const html = snapshot.html;
    assert.ok(!html.includes('hunter2'), 'password plaintext absent from the snapshot');

    const tpl = env.document.createElement('template');
    tpl.innerHTML = html;
    const pw = tpl.content.querySelector('#pw');
    assert.ok(pw, 'password input still mirrored');
    assert.equal(
      nodeIdForSerializedElement(snapshot, pw),
      env.capture.getNodeId(env.document.getElementById('pw')),
      'password input sidecar nid still present (element mirrored, value masked)'
    );
    assert.equal(pw.getAttribute('value'), expectMask('hunter2'), 'password value masked with the default mask');

    // Non-password values pass through raw with maskInputs off (default).
    assert.ok(html.includes('visible-value'), 'text input value stays raw without maskInputs');
    assert.ok(html.includes('textarea secret body'), 'textarea text stays raw without maskInputs');

    const wire = wireText(transport);
    assert.ok(!/hunter2/.test(wire), 'password plaintext appears in ZERO transport.sent payloads');
  } finally {
    env.teardown();
  }
});

test('post-snapshot setAttribute(value) on a password input emits an attr op with the masked value, never the plaintext', async () => {
  const env = setupEnv(BLOCK_BODY_HTML);
  try {
    const transport = createLoopbackTransport();
    env.capture = createCapture({
      transport,
      logger: silentLogger(),
    });
    env.capture.start();
    await settle(env.window);

    env.document.getElementById('pw').setAttribute('value', 'hunter2-rotated');
    await settle(env.window);

    const ops = attrOps(transport).filter((op) => op.attr === 'value');
    assert.equal(ops.length, 1, 'exactly one value attr op emitted');
    assert.equal(ops[0].val, expectMask('hunter2-rotated'), 'attr op carries the masked value (Pitfall 10)');
    const wire = wireText(transport);
    assert.ok(!/hunter2/.test(wire), 'password plaintext appears in ZERO transport.sent payloads');
  } finally {
    env.teardown();
  }
});

test('with maskInputs true, a text input value is masked in snapshot AND attr-op mutations; textarea text is masked too', async () => {
  const env = setupEnv(BLOCK_BODY_HTML);
  try {
    const transport = createLoopbackTransport();
    env.capture = createCapture({
      transport,
      logger: silentLogger(),
      maskInputs: true,
    });
    env.capture.start();
    await settle(env.window);

    const snapshots = transport.sent.filter((m) => m.type === STREAM.SNAPSHOT);
    const html = snapshots[0].payload.html;
    assert.ok(!html.includes('visible-value'), 'text input value absent from snapshot');
    assert.ok(!html.includes('textarea secret body'), 'textarea text absent from snapshot');
    assert.ok(!html.includes('option-secret-value'), 'select option value absent from snapshot');

    const tpl = env.document.createElement('template');
    tpl.innerHTML = html;
    assert.equal(tpl.content.querySelector('#txt').getAttribute('value'), expectMask('visible-value'),
      'text input value masked in snapshot');
    assert.equal(tpl.content.querySelector('#ta').textContent, expectMask('textarea secret body'),
      'textarea text masked in snapshot');
    assert.equal(tpl.content.querySelector('#sel-opt').getAttribute('value'), expectMask('option-secret-value'),
      'select option value masked in snapshot');
    assert.equal(tpl.content.querySelector('#sel-opt').textContent, 'Visible option label',
      'select option label remains the documented residual');

    env.document.getElementById('txt').setAttribute('value', 'updated-input');
    await settle(env.window);
    const ops = attrOps(transport).filter((op) => op.attr === 'value');
    assert.equal(ops.length, 1, 'exactly one value attr op emitted');
    assert.equal(ops[0].val, expectMask('updated-input'), 'attr op carries the masked value');
    const wire = wireText(transport);
    assert.ok(!wire.includes('visible-value'), 'snapshot input value never on the wire');
    assert.ok(!wire.includes('updated-input'), 'mutated input value never on the wire');

    const ta = env.document.getElementById('ta');
    const taNid = env.capture.getNodeId(ta);
    ta.firstChild.nodeValue = 'textarea edited secret';
    await settle(env.window);
    assert.ok(
      textOps(transport).some((op) => op.nid === taNid && op.text === expectMask('textarea edited secret')),
      'textarea characterData text op is masked with maskInputs true'
    );

    ta.textContent = 'textarea replaced secret';
    await settle(env.window);
    assert.ok(
      textOps(transport).some((op) => op.nid === taNid && op.text === expectMask('textarea replaced secret')),
      'textarea textContent childList text op is masked with maskInputs true'
    );

    const option = env.document.getElementById('sel-opt');
    option.setAttribute('value', 'option-updated-secret');
    await settle(env.window);
    assert.ok(
      attrOps(transport).some((op) => op.attr === 'value' && op.val === expectMask('option-updated-secret')),
      'select option value attr op is masked with maskInputs true'
    );

    const lateSelect = env.document.createElement('select');
    lateSelect.id = 'late-sel';
    const lateOption = env.document.createElement('option');
    lateOption.id = 'late-opt';
    lateOption.setAttribute('value', 'late-option-secret');
    lateOption.textContent = 'Late option label';
    lateSelect.appendChild(lateOption);
    env.document.getElementById('wrap').appendChild(lateSelect);
    await settle(env.window);
    const lateAdd = addOps(transport).find((op) => op.html.includes('late-sel'));
    assert.ok(lateAdd, 'late select subtree emitted as an add op');
    assert.ok(!lateAdd.html.includes('late-option-secret'), 'late select option value absent from add-op html');
    assert.ok(lateAdd.html.includes('value="' + expectMask('late-option-secret') + '"'),
      'late select option value masked in add-op html');
    assert.ok(!wireText(transport).includes('textarea edited secret'), 'textarea characterData raw value never on the wire');
    assert.ok(!wireText(transport).includes('textarea replaced secret'), 'textarea textContent raw value never on the wire');
    assert.ok(!wireText(transport).includes('option-updated-secret'), 'option attr raw value never on the wire');
    assert.ok(!wireText(transport).includes('late-option-secret'), 'late option raw value never on the wire');
  } finally {
    env.teardown();
  }
});

test('with maskInputs false (default), non-password values pass through raw in snapshot and attr ops', async () => {
  const env = setupEnv(BLOCK_BODY_HTML);
  try {
    const transport = createLoopbackTransport();
    env.capture = createCapture({
      transport,
      logger: silentLogger(),
    });
    env.capture.start();
    await settle(env.window);

    const snapshots = transport.sent.filter((m) => m.type === STREAM.SNAPSHOT);
    assert.ok(snapshots[0].payload.html.includes('visible-value'), 'text input value raw in snapshot');

    env.document.getElementById('txt').setAttribute('value', 'plain-new-value');
    await settle(env.window);
    const ops = attrOps(transport).filter((op) => op.attr === 'value');
    assert.equal(ops.length, 1, 'exactly one value attr op emitted');
    assert.equal(ops[0].val, 'plain-new-value', 'non-password attr op passes through raw');
  } finally {
    env.teardown();
  }
});

test('maskInputFn receives (text, element) and is used; a THROWING maskInputFn falls back to the default mask', async () => {
  // Custom fn used.
  let env = setupEnv(BLOCK_BODY_HTML);
  try {
    const transport = createLoopbackTransport();
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

    const tpl = env.document.createElement('template');
    tpl.innerHTML = transport.sent.filter((m) => m.type === STREAM.SNAPSHOT)[0].payload.html;
    assert.equal(tpl.content.querySelector('#txt').getAttribute('value'), '#'.repeat('visible-value'.length),
      'snapshot uses the custom input mask fn return value');
    assert.ok(calls.some((c) => c.text === 'visible-value' && c.id === 'txt'),
      'maskInputFn received (text, element)');

    env.document.getElementById('txt').setAttribute('value', 'next-value');
    await settle(env.window);
    assert.ok(
      attrOps(transport).some((op) => op.attr === 'value' && op.val === '#'.repeat('next-value'.length)),
      'attr op uses the custom input mask fn return value'
    );
  } finally {
    env.teardown();
  }

  // Throwing fn: fail closed to the default asterisk mask + logger.error.
  env = setupEnv(BLOCK_BODY_HTML);
  try {
    const transport = createLoopbackTransport();
    const errors = [];
    const recordingLogger = { info() {}, warn() {}, error(...args) { errors.push(args); } };
    env.capture = createCapture({
      transport,
      logger: recordingLogger,
      maskInputs: true,
      maskInputFn: () => { throw new TypeError('input-mask-fn-blew-up'); },
    });
    assert.doesNotThrow(() => env.capture.start());
    assert.ok(errors.length >= 1, 'input mask fn errors were routed to the logger');

    const tpl = env.document.createElement('template');
    tpl.innerHTML = transport.sent.filter((m) => m.type === STREAM.SNAPSHOT)[0].payload.html;
    assert.equal(tpl.content.querySelector('#txt').getAttribute('value'), expectMask('visible-value'),
      'fallback is the DEFAULT asterisk mask, never raw');
    const wire = wireText(transport);
    assert.ok(!wire.includes('visible-value'), 'raw input value never leaked');
    assert.ok(!/hunter2/.test(wire), 'password plaintext never leaked');
  } finally {
    env.teardown();
  }
});

test('wire-wide scan: blocked content and password plaintext appear in NO message of any type', async () => {
  const env = setupEnv(BLOCK_BODY_HTML);
  try {
    const transport = createLoopbackTransport();
    env.capture = createCapture({
      transport,
      logger: silentLogger(),
      blockSelector: '.blocked',
    });
    env.capture.start();
    await settle(env.window);

    // Exercise multiple paths in one stream: blocked-subtree edits, a
    // password attr op, an added blocked element, a tracked edit.
    env.document.getElementById('blk-child').firstChild.nodeValue = 'blocked rewrite';
    env.document.getElementById('pw').setAttribute('value', 'hunter2-again');
    const late = env.document.createElement('div');
    late.className = 'blocked';
    late.textContent = 'late blocked secret';
    env.document.getElementById('wrap').appendChild(late);
    env.document.getElementById('pub2').setAttribute('data-alive', '1');
    await settle(env.window);
    env.capture.stop();

    const wire = wireText(transport);
    assert.ok(!wire.includes('blocked content text'), 'snapshot-blocked text in zero messages');
    assert.ok(!wire.includes('blocked rewrite'), 'blocked text edit in zero messages');
    assert.ok(!wire.includes('late blocked secret'), 'late blocked content in zero messages');
    assert.ok(!wire.includes('s3cr3t-attr'), 'blocked attr value in zero messages');
    assert.ok(!/hunter2/.test(wire), 'password plaintext in zero messages');
    assert.ok(wire.includes('data-alive'), 'tracked traffic still flows (scan surface is non-empty)');
  } finally {
    env.teardown();
  }
});
