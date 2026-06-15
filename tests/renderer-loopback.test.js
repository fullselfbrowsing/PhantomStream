// Loopback end-to-end test (plan 02-04, ADPT-04 + phase success criterion 2):
// capture core + viewer running in ONE jsdom page over a local loopback
// transport with zero infrastructure -- snapshot renders, live DOM mutations
// in the source pane appear in the mirror document, the attribute-based
// skipElement recursion guard keeps the viewer subtree out of the stream,
// and the stale-miss threshold drives the full CONTROL.START recovery
// round-trip (viewer -> glue -> capture.start() -> fresh snapshot).
//
// jsdom 29 never parses iframe.srcdoc into contentDocument (02-RESEARCH.md
// Pattern 3, verified empirically): the srcdoc attribute round-trips but the
// document stays empty forever. Browsers parse it natively; under test the
// browser's parse step is simulated manually with the srcdoc write-glue
// (cd.open(); cd.write(iframe.srcdoc); cd.close();) -- see glueMirror().
// After the glue, diff applies hit the written document because the viewer
// reads contentDocument FRESH per handler call (never cached).
//
// All helpers are deliberately duplicated locally (parallel-safe convention
// per tests/capture-skip.test.js: this file imports nothing from any shared
// test harness). Globals recipe per 01-RESEARCH.md Pattern 2; settle cadence
// per Pattern 3 (its 20ms tail also covers the loopback's queueMicrotask
// hop); teardown discipline per Pitfalls 3 and 8.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM, VirtualConsole } from 'jsdom';
import { createCapture } from '../src/capture/index.js';
import { createViewer } from '../src/renderer/index.js';
import { STREAM, CONTROL, DIFF_OP } from '../src/protocol/messages.js';

// Complete global set the capture core dereferences (audited from the
// reference source in 01-RESEARCH.md Pattern 2). The viewer needs no swap
// (it works off container.ownerDocument), but the capture side does.
const AUDITED_GLOBALS = [
  'window', 'document', 'Node', 'NodeFilter', 'MutationObserver',
  'requestAnimationFrame', 'cancelAnimationFrame', 'CustomEvent',
  'ShadowRoot', 'location', 'getComputedStyle', 'URL',
];

// One page, two panes: #source-pane is the captured content (a few
// nid-target rows); #mirror-container hosts the viewer. The viewer root
// stamps data-phantomstream-ui="viewer" on itself, which the capture-side
// skipElement predicate keys on (02-RESEARCH Pattern 4 recursion guard).
const BODY_HTML = '<div id="source-pane">'
  + '<div id="row-1">row one</div>'
  + '<div id="row-2">row two</div>'
  + '<div id="row-3">row three</div>'
  + '</div>'
  + '<div id="mirror-container"></div>';

/**
 * Build a fresh JSDOM page, install its globals on globalThis (recording
 * prior state including presence), and return an env whose teardown
 * destroys the viewer and stops the capture FIRST (while the instance
 * globals are still installed -- stop() clears the self-re-arming watchdog
 * setTimeout chain), then restores every global exactly and closes the
 * window. Every test body wraps in try/finally(env.teardown).
 * @param {string} bodyHtml
 */
function setupEnv(bodyHtml) {
  const dom = new JSDOM(
    '<!DOCTYPE html><html><head><title>loopback fixture</title></head><body>'
      + bodyHtml + '</body></html>',
    {
      url: 'https://fixture.test/page',
      pretendToBeVisual: true, // rAF for the capture flush + iframe load delivery
      virtualConsole: new VirtualConsole(), // swallows "Not implemented" scrollTo noise
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
    viewer: null,
    teardown() {
      // Viewer first (detaches its DOM + transport subscription), then the
      // capture (clears the watchdog chain) -- both while the globals are
      // still installed.
      try {
        if (env.viewer) env.viewer.destroy();
      } catch (e) { /* already destroyed */ }
      env.viewer = null;
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
 * The 20ms tail also drains the loopback transport's queueMicrotask hops.
 * @param {Window} win
 */
async function settle(win) {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => win.requestAnimationFrame(resolve));
  await new Promise((resolve) => setTimeout(resolve, 20));
}

/**
 * Local loopback transport implementing BOTH ends of the wire
 * (02-RESEARCH.md Pattern 1, verbatim design): Set-based fan-out plus one
 * queueMicrotask hop. The async hop breaks the resync re-entrancy class --
 * the viewer's CONTROL.START send never re-enters capture.start() from
 * inside capture's own safeSend call stack -- while microtask FIFO ordering
 * preserves message order.
 */
function createLoopbackTransport() {
  const toViewer = new Set(); // STREAM.* handlers (viewer + recorder subscribe)
  const toHost = new Set();   // CONTROL.* handlers (glue + recorder subscribe)
  function fanOut(handlers, type, payload) {
    queueMicrotask(() => {
      handlers.forEach((h) => h(type, payload));
    });
  }
  return {
    captureTransport: { // pass to createCapture({ transport })
      send(type, payload) { fanOut(toViewer, type, payload); },
    },
    viewerTransport: { // pass to createViewer({ transport })
      send(type, payload) { fanOut(toHost, type, payload); },
      onMessage(h) { toViewer.add(h); return () => { toViewer.delete(h); }; },
    },
    onControl(h) { toHost.add(h); return () => { toHost.delete(h); }; },
  };
}

function silentLogger() {
  return { info() {}, warn() {}, error() {} };
}

function recordingWarnLogger() {
  const warns = [];
  return {
    warns,
    info() {},
    warn(...args) { warns.push(args); },
    error() {},
  };
}

/**
 * Full loopback wiring in the Pattern 4 ORDER (the loopback has no
 * buffering, so the viewer must exist -- subscribed and skip-marked --
 * before the first snapshot is sent):
 *   transport -> recorders -> createViewer -> createCapture(skipElement)
 *   -> onControl glue (CONTROL.START -> capture.start(): the resync
 *   round-trip).
 *
 * The capture-side skipElement predicate is ATTRIBUTE-based, never object
 * identity: during serialization it runs against detached CLONE elements,
 * during diffing against LIVE elements -- only an attribute/id check
 * matches both sides (02-RESEARCH Pattern 4).
 *
 * Tests call ctx.capture.start() themselves (synchronously -- see the
 * jsdom load note below) so they can register custom overlay kinds first.
 *
 * IMPORTANT (jsdom 29 load semantics, plan 02-03 ledger): the iframe load
 * event fires exactly ONCE -- the queued about:blank load -- and only
 * because createViewer attaches its persistent listener before insertion.
 * The first snapshot must therefore arrive (via microtask) BEFORE that
 * load task runs: never `await` between wireLoopback() and
 * ctx.capture.start(), or the viewer stays 'waiting' forever.
 *
 * @param {ReturnType<typeof setupEnv>} env
 * @param {{viewerLogger?: Object, overlayProvider?: Function}} [opts]
 */
function wireLoopback(env, opts = {}) {
  const transport = createLoopbackTransport();

  const received = []; // every viewer-bound STREAM.* message, recorded
  transport.viewerTransport.onMessage((type, payload) => {
    received.push({ type, payload });
  });
  const controls = []; // every viewer -> host CONTROL.* send, recorded
  transport.onControl((type, payload) => {
    controls.push({ type, payload });
  });

  const viewer = createViewer({
    container: env.document.getElementById('mirror-container'),
    transport: transport.viewerTransport,
    logger: opts.viewerLogger || silentLogger(),
  });
  env.viewer = viewer;

  const capture = createCapture({
    transport: transport.captureTransport,
    logger: silentLogger(),
    overlayProvider: opts.overlayProvider,
    // Attribute-based recursion guard (NEVER identity comparisons): the
    // viewer root stamps data-phantomstream-ui="viewer"; ancestor-inclusive
    // application excludes the whole viewer subtree from snapshots AND
    // diffs, on clones and live elements alike.
    skipElement: function (el) {
      return !!(el.getAttribute && el.getAttribute('data-phantomstream-ui'));
    },
  });
  env.capture = capture;

  // The resync round-trip glue: the viewer's re-snapshot request IS
  // CONTROL.START (02-RESEARCH Pattern 2 -- dash:request-snapshot does not
  // exist in the protocol); the host maps it to a clean capture restart.
  transport.onControl((type, payload) => {
    if (type === CONTROL.START) capture.start();
    if (type === CONTROL.SUBTREE_REQUEST) capture.handleControl(type, payload);
  });

  return { transport, received, controls, viewer, capture };
}

/**
 * Wait for the viewer to reach 'streaming': the persistent load listener
 * un-hides the iframe (display '' replaces the waiting-state 'none').
 * @param {Element} iframe
 */
async function waitForStreaming(iframe) {
  for (let i = 0; i < 200; i++) {
    if (iframe.style.display !== 'none') return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('viewer never reached streaming (iframe load never fired)');
}

/**
 * SRCDOC WRITE-GLUE: jsdom 29 never parses the srcdoc attribute into
 * contentDocument (02-RESEARCH Pitfall 1, verified empirically -- the
 * attribute round-trips but the document body stays empty), so the test
 * simulates the browser's srcdoc navigation manually:
 *   cd.open(); cd.write(iframe.srcdoc); cd.close();
 * Subsequent diff applies hit this written document because the viewer
 * reads contentDocument fresh per message. Re-run after every re-snapshot.
 * @param {Element} iframe
 * @returns {Document} the populated mirror contentDocument
 */
function glueMirror(iframe) {
  const cd = iframe.contentDocument;
  cd.open();
  cd.write(iframe.getAttribute('srcdoc'));
  cd.close();
  iframe.dispatchEvent(new iframe.ownerDocument.defaultView.Event('load'));
  return cd;
}

function viewerIframe(env) {
  return env.document
    .getElementById('mirror-container')
    .querySelector('iframe');
}

function snapshotsOf(received) {
  return received.filter((m) => m.type === STREAM.SNAPSHOT);
}

function mutationBatchesOf(received) {
  return received.filter((m) => m.type === STREAM.MUTATIONS);
}

function controlStartsOf(controls) {
  return controls.filter((c) => c.type === CONTROL.START);
}

// === Task 1: core mirror path + recursion guard + resync round-trip ========

test('full wiring produces exactly one snapshot and a non-empty sidecar-indexed srcdoc', async () => {
  const env = setupEnv(BODY_HTML);
  try {
    const ctx = wireLoopback(env);
    ctx.capture.start();
    await settle(env.window);

    const snapshots = snapshotsOf(ctx.received);
    assert.equal(snapshots.length, 1, 'start() emits exactly one STREAM.SNAPSHOT');

    const srcdoc = viewerIframe(env).getAttribute('srcdoc');
    assert.ok(srcdoc && srcdoc.length > 0, 'srcdoc is non-empty');
    assert.equal(srcdoc.includes('data-fsb-nid'), false, 'srcdoc carries no framework nid attrs');
    assert.ok(
      Array.isArray(snapshots[0].payload.nodeIds) && snapshots[0].payload.nodeIds.length > 0,
      'snapshot carries nodeIds sidecar for the renderer index'
    );
    assert.ok(srcdoc.includes('row one'), 'srcdoc contains the source pane rows');
    assert.ok(srcdoc.includes('row three'), 'srcdoc contains all tracked rows');
  } finally {
    env.teardown();
  }
});

test('recursion guard, snapshot path: srcdoc contains no viewer DOM and no nested srcdoc iframe', async () => {
  const env = setupEnv(BODY_HTML);
  try {
    const ctx = wireLoopback(env);
    ctx.capture.start();
    await settle(env.window);

    const srcdoc = viewerIframe(env).getAttribute('srcdoc');
    assert.ok(srcdoc.includes('row one'), 'sanity: tracked content present');
    // The viewer root (data-phantomstream-ui), its style element, the
    // sandboxed iframe, and the overlay layer are all inside the skipped
    // subtree -- none may leak into the snapshot.
    assert.ok(
      !srcdoc.includes('data-phantomstream-ui'),
      'snapshot contains no viewer DOM'
    );
    assert.ok(
      !srcdoc.includes('<iframe'),
      'snapshot contains no nested iframe (mirror-of-mirror level 1 prevented)'
    );
    assert.ok(
      !srcdoc.includes('ps-overlay-'),
      'snapshot contains no overlay chrome'
    );
  } finally {
    env.teardown();
  }
});

test('a live DOM add in the source pane appears in the mirror document (the first end-to-end proof)', async () => {
  const env = setupEnv(BODY_HTML);
  try {
    const ctx = wireLoopback(env);
    ctx.capture.start();
    await settle(env.window);
    const iframe = viewerIframe(env);
    await waitForStreaming(iframe);
    const cd = glueMirror(iframe);
    assert.ok(
      cd.getElementById('row-1'),
      'glued mirror document contains source nodes'
    );

    const added = env.document.createElement('div');
    added.id = 'added-row';
    added.textContent = 'added row';
    env.document.getElementById('source-pane').appendChild(added);
    await settle(env.window);

    const nid = ctx.capture.getNodeId(added);
    assert.ok(nid, 'the differ tracked a nid for the live added element');
    const mirrored = cd.getElementById('added-row');
    assert.ok(mirrored, 'the added element was applied into the mirror document');
    assert.equal(mirrored.textContent, 'added row', 'mirrored content matches');
  } finally {
    env.teardown();
  }
});

test('a text edit in the source pane updates the mirrored node textContent', async () => {
  const env = setupEnv(BODY_HTML);
  try {
    const ctx = wireLoopback(env);
    ctx.capture.start();
    await settle(env.window);
    const iframe = viewerIframe(env);
    await waitForStreaming(iframe);
    const cd = glueMirror(iframe);

    const row = env.document.getElementById('row-1');
    const nid = ctx.capture.getNodeId(row);
    assert.ok(nid, 'row-1 was tracked at serialization');
    const mirroredBefore = cd.getElementById('row-1');
    assert.equal(mirroredBefore.textContent, 'row one', 'mirror starts in sync');

    // characterData mutation (nodeValue edit -- setting textContent would be
    // a childList replace instead).
    row.firstChild.nodeValue = 'row one edited';
    await settle(env.window);

    const mirrored = cd.getElementById('row-1');
    assert.equal(mirrored.textContent, 'row one edited', 'text edit mirrored');
  } finally {
    env.teardown();
  }
});

test('a textContent replacement (bare text-node childList) on a tracked element mirrors', async () => {
  const env = setupEnv(BODY_HTML);
  try {
    const ctx = wireLoopback(env);
    ctx.capture.start();
    await settle(env.window);
    const iframe = viewerIframe(env);
    await waitForStreaming(iframe);
    const cd = glueMirror(iframe);

    const row = env.document.getElementById('row-2');
    const nid = ctx.capture.getNodeId(row);
    assert.ok(nid, 'row-2 was tracked at serialization');
    assert.equal(
      cd.getElementById('row-2').textContent,
      'row two',
      'mirror starts in sync'
    );

    // textContent assignment REPLACES the text node: the observer reports a
    // childList record with a bare TEXT-node removal+addition (the
    // examples/loopback-mirror.html "Edit text" shape) -- NOT characterData.
    // The element-only reference differ drops this class of mutation
    // entirely, silently drifting the mirror (Phase 2 real-browser
    // checkpoint finding).
    row.textContent = 'row two replaced';
    await settle(env.window);

    const mirrored = cd.getElementById('row-2');
    assert.equal(
      mirrored.textContent, 'row two replaced',
      'textContent replacement reached the mirror'
    );
  } finally {
    env.teardown();
  }
});

test('bare text-node childList mutations emit exactly one deduplicated text op per target element', async () => {
  const env = setupEnv(BODY_HTML);
  try {
    const ctx = wireLoopback(env);
    ctx.capture.start();
    await settle(env.window);
    const iframe = viewerIframe(env);
    await waitForStreaming(iframe);

    const row = env.document.getElementById('row-3');
    const nid = ctx.capture.getNodeId(row);
    assert.ok(nid, 'row-3 was tracked at serialization');

    // Two synchronous replacements on the SAME element accumulate two
    // childList records into one rAF batch -- the differ must emit exactly
    // ONE text op carrying the element's FINAL live textContent (the live
    // read makes every record for the same target yield the same value, so
    // dedup loses nothing).
    row.textContent = 'row three intermediate';
    row.textContent = 'row three final';
    await settle(env.window);

    const batches = mutationBatchesOf(ctx.received);
    assert.equal(batches.length, 1, 'one flush carried the batch');
    assert.equal(
      batches[0].payload.mutations.length, 1,
      'no spurious ops alongside the text op'
    );
    const op = batches[0].payload.mutations[0];
    assert.equal(op.op, DIFF_OP.TEXT, 'the op is a text op');
    assert.equal(op.nid, nid, 'addressed to the mutation target element');
    assert.equal(op.text, 'row three final', 'carries the final live text');
  } finally {
    env.teardown();
  }
});

test('a bare text-node append into a mixed-content element never flattens mirrored element children (CR-01 shape A)', async () => {
  const env = setupEnv(
    '<div id="source-pane">'
      + '<div id="mixed"><span id="kept">a</span></div>'
      + '</div>'
      + '<div id="mirror-container"></div>'
  );
  try {
    const ctx = wireLoopback(env);
    ctx.capture.start();
    await settle(env.window);
    const iframe = viewerIframe(env);
    await waitForStreaming(iframe);
    const cd = glueMirror(iframe);

    const mixed = env.document.getElementById('mixed');
    const kept = env.document.getElementById('kept');
    const mixedNid = ctx.capture.getNodeId(mixed);
    const keptNid = ctx.capture.getNodeId(kept);
    assert.ok(mixedNid && keptNid, 'both elements tracked at serialization');
    assert.ok(
      cd.getElementById('kept'),
      'mirror starts with the span present'
    );

    // Bare text-node append into a container that still has a live element
    // child. Without the mixed-content guard the differ emits a flattening
    // text op for the target, and the renderer's textContent= apply
    // destroys the mirrored span while it still exists live -- silent
    // structural corruption with no stale miss and no resync (review CR-01,
    // probe shape A). The guarded differ suppresses the op entirely, so the
    // batch processes empty and NO mutation message is sent (the
    // reference's drop behavior: text drift, structure intact).
    mixed.appendChild(env.document.createTextNode('!'));
    await settle(env.window);

    assert.equal(
      mutationBatchesOf(ctx.received).length, 0,
      'mixed-content bare-text record emits no wire signal (reference drop behavior)'
    );
    const mirroredSpan = cd.getElementById('kept');
    assert.ok(mirroredSpan, 'the mirrored span survived (structure intact)');
    assert.equal(mirroredSpan.tagName, 'SPAN', 'still an element, not flattened text');
    assert.equal(mirroredSpan.textContent, 'a', 'span content untouched');
    // Accepted residual (documented in the E2 README entry and the D6
    // ledger rationale): the appended bare text drifts -- live shows "a!",
    // the mirror keeps "a" until the next snapshot/resync. Drift is
    // recoverable; structural destruction is not.
  } finally {
    env.teardown();
  }
});

test('innerHTML with mixed content keeps the mirrored element child intact (CR-01 shape B)', async () => {
  const env = setupEnv(
    '<div id="source-pane">'
      + '<div id="rich">old text</div>'
      + '</div>'
      + '<div id="mirror-container"></div>'
  );
  try {
    const ctx = wireLoopback(env);
    ctx.capture.start();
    await settle(env.window);
    const iframe = viewerIframe(env);
    await waitForStreaming(iframe);
    const cd = glueMirror(iframe);

    const rich = env.document.getElementById('rich');
    const richNid = ctx.capture.getNodeId(rich);
    assert.ok(richNid, 'rich was tracked at serialization');

    // Mixed-content innerHTML: one childList record carrying an element
    // addition (<b>) AND a bare text-node addition. Without the
    // mixed-content guard the trailing flattening text op destroys the <b>
    // the add op just inserted (review CR-01, probe shape B).
    rich.innerHTML = 'hello <b>world</b>';
    await settle(env.window);

    const bNid = ctx.capture.getNodeId(rich.querySelector('b'));
    assert.ok(bNid, 'the differ tracked a nid for the live added <b>');

    const mirroredRich = cd.getElementById('rich');
    const mirroredB = cd.querySelector('#rich b');
    assert.ok(mirroredB, 'the added <b> reached the mirror and was NOT destroyed');
    assert.equal(mirroredB.tagName, 'B', 'mirrored element kept its tag');
    assert.equal(mirroredB.textContent, 'world', '<b> content intact in the mirror');
    assert.ok(mirroredRich.contains(mirroredB), '<b> mirrored under its parent');

    // The wire never carried a flattening text op for the mixed target.
    for (const batch of mutationBatchesOf(ctx.received)) {
      for (const op of batch.payload.mutations) {
        assert.ok(
          !(op.op === DIFF_OP.TEXT && op.nid === richNid),
          'no flattening text op was emitted for the mixed-content target'
        );
      }
    }
  } finally {
    env.teardown();
  }
});

test('recursion guard, diff path: setting iframe.srcdoc never echoes back as capture mutations', async () => {
  const env = setupEnv(BODY_HTML);
  try {
    const ctx = wireLoopback(env);
    ctx.capture.start();
    await settle(env.window); // snapshot delivery already set srcdoc once

    // Explicit echo probe: another srcdoc attribute write on the (skipped)
    // viewer iframe. Without the guard, the host MutationObserver reports
    // this as an attr op whose val is the ENTIRE snapshot HTML -- the
    // feedback amplification vector (02-RESEARCH Pitfall 2).
    const iframe = viewerIframe(env);
    iframe.setAttribute('srcdoc', iframe.getAttribute('srcdoc') + '<!-- echo-probe -->');
    await settle(env.window);

    assert.equal(
      mutationBatchesOf(ctx.received).length, 0,
      'no mutation traffic from viewer-subtree writes'
    );

    // Prove the pipe is still live: one tracked mutation flows...
    env.document.getElementById('row-2').setAttribute('data-tracked', 'yes');
    await settle(env.window);

    const batches = mutationBatchesOf(ctx.received);
    assert.equal(batches.length, 1, 'exactly the tracked batch is on the wire');
    for (const batch of batches) {
      for (const op of batch.payload.mutations) {
        assert.notEqual(op.attr, 'srcdoc', 'no srcdoc attr op leaked');
        if (op.html) {
          assert.ok(
            !op.html.includes('data-phantomstream-ui'),
            'no viewer DOM leaked into add-op html'
          );
        }
      }
    }
    assert.ok(
      batches[0].payload.mutations.some(
        (op) => op.op === DIFF_OP.ATTR && op.attr === 'data-tracked' && op.val === 'yes'
      ),
      'the tracked attr op is on the wire'
    );
  } finally {
    env.teardown();
  }
});

test('stale-miss threshold drives the CONTROL.START resync round-trip end-to-end', async () => {
  const env = setupEnv(BODY_HTML);
  try {
    const ctx = wireLoopback(env);
    ctx.capture.start();
    await settle(env.window);
    const iframe = viewerIframe(env);
    await waitForStreaming(iframe);
    let cd = glueMirror(iframe);

    // Make the live DOM diverge from the generation-1 snapshot so the
    // recovery snapshot is string-distinguishable from the first srcdoc.
    const marker = env.document.createElement('div');
    marker.id = 'pre-resync-marker';
    marker.textContent = 'pre-resync marker';
    env.document.getElementById('source-pane').appendChild(marker);
    await settle(env.window);

    const firstSnapshot = snapshotsOf(ctx.received)[0].payload;
    const srcdocBefore = iframe.getAttribute('srcdoc');
    assert.ok(
      !srcdocBefore.includes('pre-resync marker'),
      'gen-1 srcdoc predates the marker (it arrived as a diff, not a snapshot)'
    );
    assert.equal(controlStartsOf(ctx.controls).length, 0, 'no resync yet');

    // Three MUTATIONS batches stamped with the CURRENT identity (so they
    // pass isCurrentStream) whose parentNids cannot resolve: each one is a
    // stale miss; the third crosses the >= 3 parity threshold.
    for (let i = 0; i < 3; i++) {
      ctx.transport.captureTransport.send(STREAM.MUTATIONS, {
        mutations: [
          { op: DIFF_OP.ADD, parentNid: 424242 + i, html: '<div>orphan</div>' },
        ],
        streamSessionId: firstSnapshot.streamSessionId,
        snapshotId: firstSnapshot.snapshotId,
      });
    }
    await settle(env.window);

    // Latch: exactly ONE CONTROL.START for the first generation -- the
    // threshold crossing fires once and stays latched until the next
    // snapshot releases it.
    const starts = controlStartsOf(ctx.controls);
    assert.equal(starts.length, 1, 'exactly one latched CONTROL.START');
    assert.equal(starts[0].payload.trigger, 'preview-resync');
    assert.equal(starts[0].payload.reason, 'stale-mutation-parent');

    // The glue restarted the capture: a SECOND snapshot with a DIFFERENT
    // stream session arrived and reset the viewer (srcdoc replaced -- it
    // now contains the marker the first snapshot predated).
    const snapshots = snapshotsOf(ctx.received);
    assert.equal(snapshots.length, 2, 'recovery snapshot arrived through the loopback');
    assert.notEqual(
      snapshots[1].payload.streamSessionId,
      firstSnapshot.streamSessionId,
      'fresh session: new streamSessionId'
    );
    const srcdocAfter = iframe.getAttribute('srcdoc');
    assert.ok(
      srcdocAfter.includes('pre-resync marker'),
      'viewer reset: the recovery snapshot replaced the srcdoc'
    );

    // Recovery proven end-to-end: after re-running the srcdoc glue, a
    // subsequent valid mutation applies into the fresh mirror document.
    cd = glueMirror(iframe);
    const recovered = env.document.createElement('div');
    recovered.id = 'post-resync-row';
    recovered.textContent = 'post-resync row';
    env.document.getElementById('source-pane').appendChild(recovered);
    await settle(env.window);

    const recoveredNid = ctx.capture.getNodeId(recovered);
    assert.ok(recoveredNid, 'gen-2 differ tracked the new element');
    const mirrored = cd.getElementById('post-resync-row');
    assert.ok(mirrored, 'post-resync mutation applied into the recovered mirror');
    assert.equal(mirrored.textContent, 'post-resync row');

    assert.equal(
      controlStartsOf(ctx.controls).length, 1,
      'still exactly one CONTROL.START -- recovery did not re-trigger resync'
    );
  } finally {
    env.teardown();
  }
});

test('on-demand subtree request recovers a truncated loopback region without full resnapshot', async () => {
  const hugeText = 'x'.repeat(900000);
  const env = setupEnv(
    '<div id="source-pane">'
      + '<section id="huge-region">' + hugeText + '</section>'
      + '</div>'
      + '<div id="mirror-container"></div>'
  );
  try {
    const ctx = wireLoopback(env);
    ctx.capture.start();
    await settle(env.window);
    const iframe = viewerIframe(env);
    await waitForStreaming(iframe);
    const cd = glueMirror(iframe);

    const huge = env.document.getElementById('huge-region');
    const hugeNid = ctx.capture.getNodeId(huge);
    assert.ok(hugeNid, 'truncated live region remains tracked by nid');
    assert.ok(
      cd.querySelector('[data-phantomstream-truncated="true"]'),
      'initial mirror contains a requestable truncated marker'
    );
    const markerCountBefore = cd.querySelectorAll('[data-phantomstream-truncated="true"]').length;

    const requestId = ctx.viewer.requestSubtree(hugeNid, { reason: 'loopback-truncated-region' });
    assert.match(requestId, /^subtree_[a-z0-9]+_\d+$/, 'viewer returned a concrete subtree requestId');
    await settle(env.window);

    assert.ok(
      ctx.controls.some((c) => c.type === CONTROL.SUBTREE_REQUEST && c.payload.requestId === requestId),
      'request traveled over the viewer-to-capture control path'
    );
    assert.equal(
      snapshotsOf(ctx.received).length,
      1,
      'recovery did not request a full replacement snapshot'
    );
    assert.equal(
      cd.querySelectorAll('[data-phantomstream-truncated="true"]').length,
      markerCountBefore - 1,
      'requested truncated marker was replaced'
    );
    const recovered = cd.getElementById('huge-region');
    assert.ok(recovered, 'recovered source region was installed in the mirror');
    assert.equal(recovered.textContent.length, hugeText.length, 'recovered subtree content matches');
    assert.ok(ctx.viewer.resolveNode(hugeNid), 'original truncated nid now resolves to recovered content');
  } finally {
    env.teardown();
  }
});

// === Task 2: dialog + custom overlay side channels ==========================
//
// Dialog messages are injected through the CAPTURE end of the transport --
// never by running capture's dialog interceptor, which requires jsdom's
// runScripts:'dangerously' (02-RESEARCH recipe step 9). Injection still
// exercises the full viewer-side path: transport dispatch ->
// overlays.handleDialogMessage -> card DOM.
//
// Overlay broadcasts: broadcastOverlayState has exactly ONE call site in the
// capture core -- start(force=true). The first start's OVERLAY message is
// always delivered while the viewer is still 'waiting' (loopback microtasks
// run before the iframe's about:blank load task), so it is gated off
// (Pitfall 4 parity). The deterministic streaming-state trigger is a second
// capture.start() once streaming is reached: the viewer stays 'streaming'
// across re-snapshots (plan 02-03 parity decision), so the second broadcast
// dispatches through the registry.

test('dialog open/close mirrors through STREAM.DIALOG end-to-end', async () => {
  const env = setupEnv(BODY_HTML);
  try {
    const ctx = wireLoopback(env);
    ctx.capture.start();
    await settle(env.window);
    await waitForStreaming(viewerIframe(env));

    ctx.transport.captureTransport.send(STREAM.DIALOG, {
      dialog: { type: 'alert', state: 'open', message: 'saved!' },
    });
    await settle(env.window);

    const mirrorContainer = env.document.getElementById('mirror-container');
    const dialogEl = mirrorContainer.querySelector('.ps-overlay-dialog');
    assert.equal(dialogEl.style.display, 'flex', 'open dialog shows the backdrop');
    assert.equal(
      mirrorContainer.querySelector('.ps-overlay-dialog-type').textContent,
      'Alert',
      'capitalized type label'
    );
    assert.equal(
      mirrorContainer.querySelector('.ps-overlay-dialog-message').textContent,
      'saved!',
      'message rendered (textContent path)'
    );

    ctx.transport.captureTransport.send(STREAM.DIALOG, {
      dialog: { type: 'alert', state: 'closed' },
    });
    await settle(env.window);
    assert.equal(dialogEl.style.display, 'none', 'closed dialog hides the backdrop');
  } finally {
    env.teardown();
  }
});

test('a custom overlay kind flows capture overlayProvider -> wire -> registered renderFn', async () => {
  const env = setupEnv(BODY_HTML);
  try {
    const ctx = wireLoopback(env, {
      overlayProvider: () => ({
        glow: null,
        progress: null,
        badge: { x: 5, y: 6, w: 10, h: 8, text: 'agent' },
      }),
    });
    // Register the custom kind on the viewer handle BEFORE capture.start()
    // (wiring-order requirement: the loopback has no buffering).
    const calls = [];
    ctx.viewer.registerOverlay('badge', (value, anchorRect, layer) => {
      calls.push({ value, anchorRect, layer });
    });

    ctx.capture.start();
    await settle(env.window);
    await waitForStreaming(viewerIframe(env));
    // Second start = the deterministic streaming-state broadcast trigger
    // (see the section comment above).
    ctx.capture.start();
    await settle(env.window);

    const payloadCalls = calls.filter((c) => c.value !== null);
    assert.equal(payloadCalls.length, 1, 'exactly one wire dispatch carried the payload');
    const call = payloadCalls[0];
    assert.equal(call.value.text, 'agent', 'provider payload arrived end-to-end');

    // Anchor rect: numeric x/y/w/h mapped through the viewer's scaleState.
    // The jsdom container box is 0x0, so computeScale clamps s to 1 with
    // zero letterbox offsets -- the mapped rect equals the raw coords.
    assert.deepEqual(
      call.anchorRect,
      { top: 6, left: 5, width: 10, height: 8 },
      'anchorRect mapped through mapRectToHost with the current scale state'
    );
    assert.ok(
      call.layer && typeof call.layer.appendChild === 'function',
      'renderFn receives the overlay layer element for DOM writes'
    );

    // The reset contract also reached the custom kind: each snapshot's
    // resetOverlays dispatched (null, null, layer) through the registry.
    assert.ok(
      calls.some((c) => c.value === null && c.anchorRect === null),
      'new-snapshot reset dispatched null through the registered renderFn'
    );
  } finally {
    env.teardown();
  }
});

test('an unregistered overlay kind from the provider is warn-logged and ignored, never thrown', async () => {
  const env = setupEnv(BODY_HTML);
  try {
    const viewerLogger = recordingWarnLogger();
    const ctx = wireLoopback(env, {
      viewerLogger,
      overlayProvider: () => ({ sparkles: { note: 'shiny' } }),
    });
    ctx.capture.start();
    await settle(env.window);
    await waitForStreaming(viewerIframe(env));
    ctx.capture.start(); // streaming-state broadcast trigger
    await settle(env.window);

    assert.ok(
      viewerLogger.warns.some(
        (args) => String(args[0]).includes('unknown overlay kind') && args.includes('sparkles')
      ),
      'unknown kind routed to logger.warn with the kind name'
    );
    // Nothing threw: the kind loop continued and the viewer is still live
    // (the glow/progress null keys dispatched normally after sparkles).
    const glowEl = env.document
      .getElementById('mirror-container')
      .querySelector('.ps-overlay-glow');
    assert.equal(glowEl.style.display, 'none', 'built-ins still dispatched (null -> hidden)');
  } finally {
    env.teardown();
  }
});

test('a new snapshot resets overlays: the dialog hides after a resync even if previously open', async () => {
  const env = setupEnv(BODY_HTML);
  try {
    const ctx = wireLoopback(env);
    ctx.capture.start();
    await settle(env.window);
    await waitForStreaming(viewerIframe(env));

    ctx.transport.captureTransport.send(STREAM.DIALOG, {
      dialog: { type: 'confirm', state: 'open', message: 'still open?' },
    });
    await settle(env.window);
    const dialogEl = env.document
      .getElementById('mirror-container')
      .querySelector('.ps-overlay-dialog');
    assert.equal(dialogEl.style.display, 'flex', 'dialog open before the resync');

    // Drive the REAL recovery path (not a bare restart): three stale misses
    // with the current identity force CONTROL.START; the glue restarts the
    // capture; the fresh snapshot's resetOverlays hides every kind.
    const firstSnapshot = snapshotsOf(ctx.received)[0].payload;
    for (let i = 0; i < 3; i++) {
      ctx.transport.captureTransport.send(STREAM.MUTATIONS, {
        mutations: [
          { op: DIFF_OP.ADD, parentNid: 525252 + i, html: '<div>orphan</div>' },
        ],
        streamSessionId: firstSnapshot.streamSessionId,
        snapshotId: firstSnapshot.snapshotId,
      });
    }
    await settle(env.window);

    assert.equal(controlStartsOf(ctx.controls).length, 1, 'one latched resync fired');
    assert.equal(snapshotsOf(ctx.received).length, 2, 'recovery snapshot arrived');
    assert.equal(
      dialogEl.style.display, 'none',
      'the new snapshot reset the overlays: dialog hidden'
    );
  } finally {
    env.teardown();
  }
});
