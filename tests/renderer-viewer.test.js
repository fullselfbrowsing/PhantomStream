// Viewer factory/contract tests for createViewer (plan 02-03, VIEW-01 plus
// the scroll half of VIEW-06).
//
// Pins: factory-time validation throws ('viewer-container-required',
// 'viewer-transport-required', 'viewer-sandbox-invalid' is creation-only),
// the exact sandbox token list (phase criterion 3), viewer DOM structure,
// the locked handle shape {detach, destroy, registerOverlay}, snapshot
// srcdoc write + identity adoption, staleness rejection, waiting-state
// gating (02-RESEARCH Pitfall 4 parity), the latched CONTROL.START resync
// path (one send per generation, latch released only by the next snapshot),
// scroll handling, the dialog identity-nesting quirk (Pitfall 8 parity),
// computeScale math (UI-SPEC formula + clamps), and detach/destroy
// idempotency.
//
// jsdom 29 never parses srcdoc into contentDocument (02-RESEARCH Pattern 3,
// verified) -- every mirror-content assertion goes through the srcdoc
// STRING, never contentDocument. The iframe onload DOES fire in jsdom
// (against the empty about:blank document), which is what flips the viewer
// to 'streaming'.
//
// The setup helper is deliberately duplicated locally (parallel-safe
// convention: this file imports nothing from any shared test harness) and
// omits the capture tests' AUDITED_GLOBALS swap: createViewer dereferences
// only container.ownerDocument / doc.defaultView, and its single
// ambient-global touch (typeof ResizeObserver) is typeof-guarded, so no
// global installation is needed. VirtualConsole is mandatory (Pitfall 7):
// contentWindow.scrollTo logs "Not implemented" noise otherwise.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM, VirtualConsole } from 'jsdom';
import {
  createViewer,
  computeScale,
  buildSnapshotHtml,
  OVERLAY_CSS,
} from '../src/renderer/index.js';
import { STREAM, CONTROL, DIFF_OP, NID_ATTR } from '../src/protocol/messages.js';

/**
 * Fresh JSDOM page with a host container div. No globals swap (see file-top
 * comment). teardown destroys any registered viewer FIRST (so its resize
 * listener/observer detach while the window is alive), then closes the
 * window.
 */
function setupEnv() {
  const dom = new JSDOM(
    '<!DOCTYPE html><html><head><title>viewer fixture</title></head><body>'
      + '<div id="host"></div></body></html>',
    {
      url: 'https://fixture.test/page',
      pretendToBeVisual: true, // rAF available; matches the shared recipe
      virtualConsole: new VirtualConsole(), // swallows "Not implemented" noise
    }
  );
  const w = dom.window;
  const env = {
    dom,
    window: w,
    document: w.document,
    container: w.document.getElementById('host'),
    viewer: null,
    teardown() {
      try {
        if (env.viewer) env.viewer.destroy();
      } catch (e) { /* already destroyed */ }
      env.viewer = null;
      w.close();
    },
  };
  return env;
}

/**
 * Recording ViewerTransport stub. Tests inject capture-host messages by
 * calling emit(type, payload), which invokes the handler stored by
 * onMessage; the unsubscribe spy clears the handler and counts calls.
 */
function createRecordingTransport() {
  const api = {
    sent: [],
    handler: null,
    unsubscribeCount: 0,
    send(type, payload) {
      api.sent.push({ type, payload });
    },
    onMessage(h) {
      api.handler = h;
      return function unsubscribe() {
        api.unsubscribeCount += 1;
        api.handler = null;
      };
    },
    emit(type, payload) {
      if (api.handler) api.handler(type, payload);
    },
  };
  return api;
}

function silentLogger() {
  return { info() {}, warn() {}, error() {} };
}

function recordingLogger() {
  const errors = [];
  return {
    errors,
    info() {},
    warn() {},
    error(...args) { errors.push(args); },
  };
}

/** Minimal valid SnapshotPayload for the viewer dispatch path. */
function snapshotPayload(overrides) {
  return Object.assign(
    {
      html: '<div ' + NID_ATTR + '="1">hello</div>',
      stylesheets: [],
      inlineStyles: [],
      htmlAttrs: {},
      bodyAttrs: {},
      htmlStyle: '',
      bodyStyle: '',
      scrollX: 0,
      scrollY: 0,
      viewportWidth: 1920,
      viewportHeight: 1080,
      streamSessionId: 'stream_a_b',
      snapshotId: 111,
    },
    overrides || {}
  );
}

/** One mutation batch whose single add op addresses a nid that cannot exist. */
function bogusMutationBatch(identity) {
  return Object.assign(
    {
      mutations: [
        { op: DIFF_OP.ADD, parentNid: 424242, html: '<div>orphan</div>' },
      ],
    },
    identity || {}
  );
}

/**
 * Wait for the viewer to reach 'streaming': the snapshot onload handler
 * un-hides the iframe (display '' replaces the waiting-state 'none').
 * jsdom fires the iframe load event asynchronously after srcdoc is set.
 */
async function waitForStreaming(iframe) {
  for (let i = 0; i < 200; i++) {
    if (iframe.style.display !== 'none') return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('viewer never reached streaming (iframe load never fired)');
}

function countControlStarts(transport) {
  return transport.sent.filter((m) => m.type === CONTROL.START).length;
}

// --- Factory-time validation ------------------------------------------------

test('createViewer throws viewer-container-required for missing or non-element containers', () => {
  const transport = createRecordingTransport();
  assert.throws(() => createViewer(), /viewer-container-required/);
  assert.throws(() => createViewer({ transport }), /viewer-container-required/);
  assert.throws(
    () => createViewer({ container: {}, transport }),
    /viewer-container-required/,
    'a plain object without appendChild is not a container'
  );
});

test('createViewer throws viewer-transport-required when send or onMessage is missing', () => {
  const env = setupEnv();
  try {
    assert.throws(
      () => createViewer({ container: env.container }),
      /viewer-transport-required/
    );
    assert.throws(
      () => createViewer({ container: env.container, transport: { send() {} } }),
      /viewer-transport-required/,
      'onMessage is required'
    );
    assert.throws(
      () => createViewer({ container: env.container, transport: { onMessage() {} } }),
      /viewer-transport-required/,
      'send is required'
    );
  } finally {
    env.teardown();
  }
});

// --- Viewer DOM structure ---------------------------------------------------

test('creation auto-attaches root, iframe, overlay layer, and the OVERLAY_CSS style element', () => {
  const env = setupEnv();
  try {
    const transport = createRecordingTransport();
    env.viewer = createViewer({
      container: env.container,
      transport,
      logger: silentLogger(),
    });

    assert.equal(env.container.children.length, 1, 'exactly one root attached');
    const root = env.container.firstElementChild;
    assert.equal(
      root.getAttribute('data-phantomstream-ui'),
      'viewer',
      'root carries the loopback recursion-guard marker'
    );

    const iframe = root.querySelector('iframe');
    assert.ok(iframe, 'iframe exists inside the root');
    assert.equal(iframe.getAttribute('title'), 'PhantomStream live mirror');

    const styleEl = root.querySelector('style');
    assert.ok(styleEl, 'an injected style element exists');
    assert.equal(styleEl.textContent, OVERLAY_CSS, 'style carries OVERLAY_CSS');

    // Overlay layer with the three built-ins is appended above the iframe.
    assert.ok(root.querySelector('.ps-overlay-glow'), 'glow built-in present');
    assert.ok(root.querySelector('.ps-overlay-progress'), 'progress built-in present');
    assert.ok(root.querySelector('.ps-overlay-dialog'), 'dialog built-in present');
  } finally {
    env.teardown();
  }
});

test('iframe sandbox is exactly allow-same-origin (token list length 1)', () => {
  const env = setupEnv();
  try {
    const transport = createRecordingTransport();
    env.viewer = createViewer({
      container: env.container,
      transport,
      logger: silentLogger(),
    });
    const iframe = env.container.querySelector('iframe');
    assert.equal(iframe.getAttribute('sandbox'), 'allow-same-origin');
    const tokens = iframe.getAttribute('sandbox').trim().split(/\s+/);
    assert.equal(tokens.length, 1, 'exactly one sandbox token');
    assert.equal(tokens[0], 'allow-same-origin');
  } finally {
    env.teardown();
  }
});

test('handle has exactly detach, destroy, and registerOverlay functions', () => {
  const env = setupEnv();
  try {
    const transport = createRecordingTransport();
    env.viewer = createViewer({
      container: env.container,
      transport,
      logger: silentLogger(),
    });
    assert.deepEqual(
      Object.keys(env.viewer).sort(),
      ['destroy', 'detach', 'registerOverlay'],
      'handle surface is locked to exactly three members'
    );
    assert.equal(typeof env.viewer.detach, 'function');
    assert.equal(typeof env.viewer.destroy, 'function');
    assert.equal(typeof env.viewer.registerOverlay, 'function');
  } finally {
    env.teardown();
  }
});

// --- Snapshot handling ------------------------------------------------------

test('a SNAPSHOT message writes buildSnapshotHtml output to iframe.srcdoc', () => {
  const env = setupEnv();
  try {
    const transport = createRecordingTransport();
    env.viewer = createViewer({
      container: env.container,
      transport,
      logger: silentLogger(),
    });
    const payload = snapshotPayload();
    transport.emit(STREAM.SNAPSHOT, payload);

    const iframe = env.container.querySelector('iframe');
    assert.equal(
      iframe.getAttribute('srcdoc'),
      buildSnapshotHtml(payload),
      'srcdoc is the exact builder output (asserted via the string, never contentDocument)'
    );
  } finally {
    env.teardown();
  }
});

test('a snapshot missing payload.html logs an error and keeps the last srcdoc', async () => {
  const env = setupEnv();
  try {
    const transport = createRecordingTransport();
    const logger = recordingLogger();
    env.viewer = createViewer({ container: env.container, transport, logger });

    const good = snapshotPayload();
    transport.emit(STREAM.SNAPSHOT, good);
    const iframe = env.container.querySelector('iframe');
    const before = iframe.getAttribute('srcdoc');

    transport.emit(STREAM.SNAPSHOT, { streamSessionId: 'stream_x_y', snapshotId: 999 });
    assert.ok(logger.errors.length >= 1, 'missing html routed to logger.error');
    assert.equal(
      iframe.getAttribute('srcdoc'),
      before,
      'last good frame kept: srcdoc unchanged'
    );
  } finally {
    env.teardown();
  }
});

// --- Staleness + waiting-state gating ----------------------------------------

test('MUTATIONS with a mismatched streamSessionId are rejected (no resync ever fires)', async () => {
  const env = setupEnv();
  try {
    const transport = createRecordingTransport();
    env.viewer = createViewer({
      container: env.container,
      transport,
      logger: silentLogger(),
    });
    transport.emit(STREAM.SNAPSHOT, snapshotPayload());
    const iframe = env.container.querySelector('iframe');
    await waitForStreaming(iframe);

    // Five stale batches: if identity adoption or the staleness gate were
    // broken, the bogus nids would drive staleMisses past 3 and emit
    // CONTROL.START. Rejection means counters never move.
    for (let i = 0; i < 5; i++) {
      transport.emit(
        STREAM.MUTATIONS,
        bogusMutationBatch({ streamSessionId: 'stream_WRONG', snapshotId: 111 })
      );
    }
    assert.equal(countControlStarts(transport), 0, 'stale batches never reach the applier');
  } finally {
    env.teardown();
  }
});

test('before the first snapshot load, MUTATIONS/SCROLL/OVERLAY are gated off (Pitfall 4 parity)', () => {
  const env = setupEnv();
  try {
    const transport = createRecordingTransport();
    env.viewer = createViewer({
      container: env.container,
      transport,
      logger: silentLogger(),
    });

    // No snapshot sent: viewer stays 'waiting'. Bogus batches would emit
    // CONTROL.START at >=3 misses if the gate were missing.
    for (let i = 0; i < 4; i++) {
      transport.emit(STREAM.MUTATIONS, bogusMutationBatch());
    }
    assert.equal(countControlStarts(transport), 0, 'mutations gated in waiting state');

    // Progress overlay would flip display to block if dispatched.
    transport.emit(STREAM.OVERLAY, { progress: { phase: 'Testing' } });
    const progressEl = env.container.querySelector('.ps-overlay-progress');
    assert.equal(progressEl.style.display, 'none', 'overlay gated in waiting state');

    // Scroll in waiting state must not throw.
    transport.emit(STREAM.SCROLL, { scrollX: 10, scrollY: 20 });

    const iframe = env.container.querySelector('iframe');
    assert.equal(iframe.style.display, 'none', 'iframe stays hidden until first load');
  } finally {
    env.teardown();
  }
});

// --- Latched resync path ------------------------------------------------------

test('>=3 stale misses send exactly ONE latched CONTROL.START; a new snapshot releases the latch', async () => {
  const env = setupEnv();
  try {
    const transport = createRecordingTransport();
    env.viewer = createViewer({
      container: env.container,
      transport,
      logger: silentLogger(),
    });
    const first = snapshotPayload();
    transport.emit(STREAM.SNAPSHOT, first);
    const iframe = env.container.querySelector('iframe');
    await waitForStreaming(iframe);

    const identity = { streamSessionId: first.streamSessionId, snapshotId: first.snapshotId };
    for (let i = 0; i < 3; i++) {
      transport.emit(STREAM.MUTATIONS, bogusMutationBatch(identity));
    }
    assert.equal(countControlStarts(transport), 1, 'threshold crossing sends one CONTROL.START');

    const resync = transport.sent.find((m) => m.type === CONTROL.START);
    assert.equal(resync.payload.trigger, 'preview-resync');
    assert.equal(resync.payload.reason, 'stale-mutation-parent');

    // Further threshold crossings do NOT resend while latched.
    for (let i = 0; i < 4; i++) {
      transport.emit(STREAM.MUTATIONS, bogusMutationBatch(identity));
    }
    assert.equal(countControlStarts(transport), 1, 'latch holds: still exactly one');

    // A new snapshot resets counters AND releases the latch.
    const second = snapshotPayload({ streamSessionId: 'stream_c_d', snapshotId: 222 });
    transport.emit(STREAM.SNAPSHOT, second);
    const newIdentity = { streamSessionId: 'stream_c_d', snapshotId: 222 };

    // Two misses stay under the reset threshold...
    transport.emit(STREAM.MUTATIONS, bogusMutationBatch(newIdentity));
    transport.emit(STREAM.MUTATIONS, bogusMutationBatch(newIdentity));
    assert.equal(countControlStarts(transport), 1, 'counters were reset by the snapshot');

    // ...and the third crossing fires a second CONTROL.START (latch released).
    transport.emit(STREAM.MUTATIONS, bogusMutationBatch(newIdentity));
    assert.equal(countControlStarts(transport), 2, 'latch released by the new snapshot');
  } finally {
    env.teardown();
  }
});

// --- Scroll -------------------------------------------------------------------

test('SCROLL stores the position and never throws (jsdom scrollTo is a no-op)', async () => {
  const env = setupEnv();
  try {
    const transport = createRecordingTransport();
    const logger = recordingLogger();
    env.viewer = createViewer({ container: env.container, transport, logger });
    const payload = snapshotPayload();
    transport.emit(STREAM.SNAPSHOT, payload);
    const iframe = env.container.querySelector('iframe');
    await waitForStreaming(iframe);

    transport.emit(STREAM.SCROLL, {
      scrollX: 100,
      scrollY: 200,
      streamSessionId: payload.streamSessionId,
      snapshotId: payload.snapshotId,
    });
    assert.equal(logger.errors.length, 0, 'smooth-scroll follow contained, nothing thrown');
  } finally {
    env.teardown();
  }
});

// --- Overlay + dialog dispatch --------------------------------------------------

test('OVERLAY glow with numeric coords renders through the dispatcher with the current scale', async () => {
  const env = setupEnv();
  try {
    const transport = createRecordingTransport();
    env.viewer = createViewer({
      container: env.container,
      transport,
      logger: silentLogger(),
    });
    const payload = snapshotPayload();
    transport.emit(STREAM.SNAPSHOT, payload);
    const iframe = env.container.querySelector('iframe');
    await waitForStreaming(iframe);

    // jsdom container box is 0x0 -> computeScale clamps s to 1, offsets 0.
    transport.emit(STREAM.OVERLAY, {
      glow: { state: 'active', x: 10, y: 20, w: 30, h: 40 },
      streamSessionId: payload.streamSessionId,
      snapshotId: payload.snapshotId,
    });
    const glowEl = env.container.querySelector('.ps-overlay-glow');
    assert.equal(glowEl.style.display, 'block');
    assert.equal(glowEl.style.top, '20px');
    assert.equal(glowEl.style.left, '10px');
    assert.equal(glowEl.style.width, '30px');
    assert.equal(glowEl.style.height, '40px');
  } finally {
    env.teardown();
  }
});

test('registerOverlay routes a custom kind from the wire to the host renderFn', async () => {
  const env = setupEnv();
  try {
    const transport = createRecordingTransport();
    env.viewer = createViewer({
      container: env.container,
      transport,
      logger: silentLogger(),
    });
    const calls = [];
    env.viewer.registerOverlay('badge', (value, anchorRect, layer) => {
      calls.push({ value, anchorRect, layer });
    });

    const payload = snapshotPayload();
    transport.emit(STREAM.SNAPSHOT, payload);
    const iframe = env.container.querySelector('iframe');
    await waitForStreaming(iframe);

    transport.emit(STREAM.OVERLAY, {
      badge: { text: 'hi' },
      streamSessionId: payload.streamSessionId,
      snapshotId: payload.snapshotId,
    });
    // Two calls: the snapshot's resetOverlays dispatches (null, null, layer)
    // through EVERY registered renderFn (the plan-02-02 reset contract),
    // then the wire message delivers the payload value.
    assert.equal(calls.length, 2, 'snapshot reset + wire dispatch');
    assert.equal(calls[0].value, null, 'new-snapshot reset clears the custom kind');
    assert.deepEqual(calls[1].value, { text: 'hi' });
    assert.equal(calls[1].anchorRect, null, 'no nid and no coords -> null anchor');
    assert.ok(calls[1].layer && typeof calls[1].layer.appendChild === 'function');
  } finally {
    env.teardown();
  }
});

test('DIALOG with a mismatched identity nested inside payload.dialog still renders (Pitfall 8 parity)', async () => {
  const env = setupEnv();
  try {
    const transport = createRecordingTransport();
    env.viewer = createViewer({
      container: env.container,
      transport,
      logger: silentLogger(),
    });
    const payload = snapshotPayload();
    transport.emit(STREAM.SNAPSHOT, payload);
    const iframe = env.container.querySelector('iframe');
    await waitForStreaming(iframe);

    // Identity lives INSIDE payload.dialog (capture parity), so the
    // top-level isCurrentStream check finds no identity and accepts --
    // even though the nested identity mismatches the active stream.
    transport.emit(STREAM.DIALOG, {
      dialog: {
        state: 'open',
        type: 'confirm',
        message: 'Proceed?',
        streamSessionId: 'stream_TOTALLY_other',
        snapshotId: 99999,
      },
    });
    const dialogEl = env.container.querySelector('.ps-overlay-dialog');
    assert.equal(dialogEl.style.display, 'flex', 'dialog card shown');
    assert.equal(
      env.container.querySelector('.ps-overlay-dialog-type').textContent,
      'Confirm'
    );
    assert.equal(
      env.container.querySelector('.ps-overlay-dialog-message').textContent,
      'Proceed?'
    );
  } finally {
    env.teardown();
  }
});

// --- computeScale -----------------------------------------------------------------

test('computeScale: 1920x1080 into 960x540 scales by 0.5 with zero offsets', () => {
  assert.deepEqual(computeScale(1920, 1080, 960, 540), {
    s: 0.5,
    offsetX: 0,
    offsetY: 0,
    pageW: 1920,
    pageH: 1080,
  });
});

test('computeScale: a container wider than the aspect centers via offsetX', () => {
  const out = computeScale(1920, 1080, 2000, 540);
  assert.equal(out.s, 0.5, 'height is the constraining dimension');
  assert.equal(out.offsetX, 520, '(2000 - 1920*0.5) / 2');
  assert.equal(out.offsetY, 0);
});

test('computeScale: degenerate zero/NaN containers clamp s to 1', () => {
  assert.equal(computeScale(1920, 1080, 0, 0).s, 1, 'zero box -> s clamped');
  assert.equal(computeScale(1920, 1080, NaN, 540).s, 1, 'NaN box -> s clamped');
  assert.equal(computeScale(1920, 1080, 960, -10).s, 1, 'negative box -> s clamped');
});

test('computeScale: page defaults to 1920x1080 and floors at Math.max(1, ...)', () => {
  const defaulted = computeScale(0, 0, 960, 540);
  assert.equal(defaulted.pageW, 1920, '0 -> || default 1920');
  assert.equal(defaulted.pageH, 1080, '0 -> || default 1080');
  assert.equal(defaulted.s, 0.5);

  const floored = computeScale(-5, -5, 100, 100);
  assert.equal(floored.pageW, 1, 'truthy negative floors to 1');
  assert.equal(floored.pageH, 1, 'truthy negative floors to 1');
  assert.equal(floored.s, 100, '100/1 in both dimensions');
});

// --- detach / destroy ---------------------------------------------------------------

test('detach removes the root, unsubscribes, and ignores later snapshots; destroy is idempotent', async () => {
  const env = setupEnv();
  try {
    const transport = createRecordingTransport();
    env.viewer = createViewer({
      container: env.container,
      transport,
      logger: silentLogger(),
    });
    transport.emit(STREAM.SNAPSHOT, snapshotPayload());
    const iframe = env.container.querySelector('iframe');
    const before = iframe.getAttribute('srcdoc');
    assert.ok(before, 'srcdoc written before detach');

    env.viewer.detach();
    assert.equal(
      env.container.querySelector('[data-phantomstream-ui]'),
      null,
      'root removed from the container'
    );
    assert.equal(transport.unsubscribeCount, 1, 'transport unsubscribed exactly once');

    // A post-detach snapshot must not alter the srcdoc.
    transport.emit(
      STREAM.SNAPSHOT,
      snapshotPayload({ html: '<p ' + NID_ATTR + '="2">changed</p>' })
    );
    assert.equal(iframe.getAttribute('srcdoc'), before, 'post-detach snapshot ignored');

    // destroy() after detach() must not throw -- and neither must a repeat.
    env.viewer.destroy();
    env.viewer.destroy();
    env.viewer.detach();
    assert.equal(transport.unsubscribeCount, 1, 'idempotent: no double unsubscribe');
  } finally {
    env.teardown();
  }
});
