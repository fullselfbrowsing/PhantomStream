// Overlay layer + registry tests for the renderer core (Phase 2, VIEW-04 +
// the dialog half of VIEW-06). Pins the contracts from 02-02-PLAN.md Task 1:
//   - createOverlays builds the host-document layer (absolute, inset 0,
//     pointer-events none) with the three parity built-ins as ps-overlay-*
//     classed elements (glow / progress / dialog card structure).
//   - Glow positioning uses the dashboard.js:3381-3384 coordinate mapping
//     through mapRectToHost; non-active or null glow hides.
//   - Progress pill text format is exact reference parity
//     (dashboard.js:3390-3402): determinate "62% - Navigating",
//     indeterminate "(label||phase||'Working') - (phase||'Working')".
//   - Dialog card mirrors alert/confirm/prompt with capitalized type label,
//     textContent-only message (NEVER innerHTML -- threat T-02-04), icon by
//     type, flex/none show-hide (dashboard.js:3405-3443).
//   - Registry dispatch: every non-identity payload key is a kind; unknown
//     kinds are logged + ignored, never thrown (T-02-07); throwing custom
//     renderFns are contained (safeRenderOverlay); registered custom kinds
//     receive (payloadValue, mappedAnchorRect, layer).
//   - resetOverlays hides every built-in and clears custom kinds with a
//     null payload (D-13 reset parity, dashboard.js:2762-2764).
//
// Helpers are deliberately duplicated locally (parallel-safe convention per
// tests/capture-skip.test.js:17-20 -- this file imports nothing from any
// shared test harness). createOverlays takes an explicit { document, logger }
// so no globalThis swap is needed; a fresh JSDOM per test is enough.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM, VirtualConsole } from 'jsdom';
import { createOverlays, mapRectToHost, OVERLAY_CSS } from '../src/renderer/overlays.js';
import { createViewer } from '../src/renderer/index.js';
import { STREAM } from '../src/protocol/messages.js';

/**
 * Fresh JSDOM per test; teardown closes the window. No globals are swapped:
 * createOverlays dereferences only the injected document.
 */
function setupEnv() {
  const dom = new JSDOM(
    '<!DOCTYPE html><html><head><title>overlay fixture</title></head><body></body></html>',
    {
      url: 'https://fixture.test/page',
      virtualConsole: new VirtualConsole(), // quiet: swallows jsdom noise
    }
  );
  return {
    dom,
    window: dom.window,
    document: dom.window.document,
    teardown() { dom.window.close(); },
  };
}

/** Recording logger: captures warn/error args for containment assertions. */
function recordingLogger() {
  const warns = [];
  const errors = [];
  return {
    warns,
    errors,
    logger: {
      info() {},
      warn(...args) { warns.push(args); },
      error(...args) { errors.push(args); },
    },
  };
}

function createRecordingTransport() {
  const api = {
    handler: null,
    sent: [],
    send(type, payload) { api.sent.push({ type, payload }); },
    onMessage(handler) {
      api.handler = handler;
      return function unsubscribe() { api.handler = null; };
    },
    emit(type, payload) {
      if (api.handler) api.handler(type, payload);
    },
  };
  return api;
}

function writeViewerSrcdoc(env, iframe) {
  const cd = iframe.contentDocument;
  cd.open();
  cd.write(iframe.getAttribute('srcdoc'));
  cd.close();
  iframe.dispatchEvent(new env.window.Event('load'));
}

/**
 * Stub overlay context: fixed scale plus a resolveNidRect returning canned
 * host rects by nid (or null for unknown nids).
 */
function makeCtx(scale, nidRects) {
  return {
    scale: scale || { s: 1, offsetX: 0, offsetY: 0 },
    resolveNidRect(nid) {
      return (nidRects && nidRects[nid]) || null;
    },
  };
}

const IDENTITY = { streamSessionId: 's1', snapshotId: 1 };

test('createOverlays builds the layer with the three parity built-ins', () => {
  const env = setupEnv();
  try {
    const rec = recordingLogger();
    const o = createOverlays({ document: env.document, logger: rec.logger });

    // Layer: absolute, inset 0, overflow hidden, pointer-events none, z 2.
    assert.equal(o.layer.tagName, 'DIV', 'layer is a div');
    assert.equal(o.layer.style.position, 'absolute', 'layer is absolute');
    assert.equal(o.layer.style.top, '0px', 'layer top 0');
    assert.equal(o.layer.style.left, '0px', 'layer left 0');
    assert.equal(o.layer.style.right, '0px', 'layer right 0');
    assert.equal(o.layer.style.bottom, '0px', 'layer bottom 0');
    assert.equal(o.layer.style.overflow, 'hidden', 'layer clips overflow');
    assert.equal(o.layer.style.pointerEvents, 'none', 'layer never intercepts input');
    assert.equal(o.layer.style.zIndex, '2', 'layer sits above the iframe (z 1)');

    // Built-in elements with the ps-overlay-* contract classes.
    const glow = o.layer.querySelector('.ps-overlay-glow');
    const progress = o.layer.querySelector('.ps-overlay-progress');
    const dialog = o.layer.querySelector('.ps-overlay-dialog');
    assert.ok(glow, 'glow element exists');
    assert.ok(progress, 'progress element exists');
    assert.ok(dialog, 'dialog backdrop exists');

    // Sub-layer z order: glow 10 < progress 20 < dialog 30.
    assert.equal(glow.style.zIndex, '10', 'glow z-index 10');
    assert.equal(progress.style.zIndex, '20', 'progress z-index 20');
    assert.equal(dialog.style.zIndex, '30', 'dialog z-index 30');

    // Accessibility: aria-hidden on glow/progress only (NOT the layer --
    // an aria-hidden ancestor would suppress the dialog's live region).
    assert.equal(o.layer.getAttribute('aria-hidden'), null, 'layer is not aria-hidden');
    assert.equal(glow.getAttribute('aria-hidden'), 'true', 'glow is aria-hidden');
    assert.equal(progress.getAttribute('aria-hidden'), 'true', 'progress is aria-hidden');

    // Dialog card structure + live region.
    const card = dialog.querySelector('.ps-overlay-dialog-card');
    assert.ok(card, 'dialog card exists');
    assert.equal(card.getAttribute('role'), 'status', 'card has role status');
    assert.equal(card.getAttribute('aria-live'), 'polite', 'card is a polite live region');
    assert.ok(card.querySelector('.ps-overlay-dialog-icon'), 'dialog icon exists');
    assert.ok(card.querySelector('.ps-overlay-dialog-type'), 'dialog type label exists');
    assert.ok(card.querySelector('.ps-overlay-dialog-message'), 'dialog message exists');
    assert.ok(
      card.querySelector('.ps-overlay-dialog-icon svg'),
      'icon holds an inline SVG (Font Awesome divergence)'
    );

    // All three built-ins start hidden.
    assert.equal(glow.style.display, 'none', 'glow starts hidden');
    assert.equal(progress.style.display, 'none', 'progress starts hidden');
    assert.equal(dialog.style.display, 'none', 'dialog starts hidden');
  } finally {
    env.teardown();
  }
});

test('OVERLAY_CSS carries the parity-locked values from 02-UI-SPEC', () => {
  assert.equal(typeof OVERLAY_CSS, 'string', 'OVERLAY_CSS is a single string');
  for (const color of ['#f59e0b', '#1e1e2e', '#333', '#888', '#e0e0e0']) {
    assert.ok(OVERLAY_CSS.includes(color), 'OVERLAY_CSS contains parity color ' + color);
  }
  for (const cls of [
    '.ps-overlay-glow', '.ps-overlay-progress', '.ps-overlay-dialog',
    '.ps-overlay-dialog-card', '.ps-overlay-dialog-icon',
    '.ps-overlay-dialog-type', '.ps-overlay-dialog-message',
  ]) {
    assert.ok(OVERLAY_CSS.includes(cls), 'OVERLAY_CSS contains rule for ' + cls);
  }
  assert.ok(
    OVERLAY_CSS.includes('prefers-reduced-motion: no-preference'),
    'glow transitions are wrapped in the reduced-motion media query'
  );
  assert.ok(
    OVERLAY_CSS.includes('0 0 12px rgba(245, 158, 11, 0.6)'),
    'glow box-shadow matches the reconstruction contract'
  );
});

test('handleOverlayMessage positions the glow through the coordinate mapping', () => {
  const env = setupEnv();
  try {
    const rec = recordingLogger();
    const o = createOverlays({ document: env.document, logger: rec.logger });
    const ctx = makeCtx({ s: 0.5, offsetX: 10, offsetY: 20 });

    o.handleOverlayMessage(
      { glow: { state: 'active', x: 100, y: 50, w: 200, h: 40 }, progress: null, ...IDENTITY },
      ctx
    );

    const glow = o.layer.querySelector('.ps-overlay-glow');
    // top = 20 + 50*0.5 = 45; left = 10 + 100*0.5 = 60; w = 200*0.5; h = 40*0.5
    assert.equal(glow.style.top, '45px', 'glow top mapped per dashboard.js:3381');
    assert.equal(glow.style.left, '60px', 'glow left mapped per dashboard.js:3382');
    assert.equal(glow.style.width, '100px', 'glow width scaled');
    assert.equal(glow.style.height, '20px', 'glow height scaled');
    assert.notEqual(glow.style.display, 'none', 'active glow is visible');
  } finally {
    env.teardown();
  }
});

test('viewer overlay nid anchors resolve through the nodeIds identity index', () => {
  const env = setupEnv();
  let viewer = null;
  try {
    const transport = createRecordingTransport();
    viewer = createViewer({
      container: env.document.body,
      transport,
      logger: recordingLogger().logger,
    });
    const payload = {
      html: '<main><button>Click</button></main>',
      nodeIds: ['1', '2'],
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
      streamSessionId: 's1',
      snapshotId: 1,
    };
    transport.emit(STREAM.SNAPSHOT, payload);
    const iframe = env.document.querySelector('iframe');
    assert.equal(
      iframe.getAttribute('srcdoc').includes('data-fsb-nid'),
      false,
      'snapshot srcdoc remains sidecar-only'
    );

    writeViewerSrcdoc(env, iframe);
    const button = iframe.contentDocument.querySelector('button');
    button.getBoundingClientRect = function () {
      return { left: 11, top: 22, width: 33, height: 44 };
    };

    transport.emit(STREAM.OVERLAY, {
      glow: { state: 'active', nid: '2' },
      streamSessionId: 's1',
      snapshotId: 1,
    });

    const glow = env.document.querySelector('.ps-overlay-glow');
    assert.equal(glow.style.display, 'block', 'nid-anchored glow rendered');
    assert.equal(glow.style.top, '22px');
    assert.equal(glow.style.left, '11px');
    assert.equal(glow.style.width, '33px');
    assert.equal(glow.style.height, '44px');
  } finally {
    if (viewer) viewer.destroy();
    env.teardown();
  }
});

test('glow hides when state is not active and when the kind is null', () => {
  const env = setupEnv();
  try {
    const rec = recordingLogger();
    const o = createOverlays({ document: env.document, logger: rec.logger });
    const ctx = makeCtx();
    const glow = o.layer.querySelector('.ps-overlay-glow');

    // Activate first so the hide transitions are real, not vacuous.
    o.handleOverlayMessage({ glow: { state: 'active', x: 0, y: 0, w: 10, h: 10 }, ...IDENTITY }, ctx);
    assert.notEqual(glow.style.display, 'none', 'precondition: glow visible');

    // state !== 'active' -> hidden (dashboard.js:3379 gate).
    o.handleOverlayMessage({ glow: { state: 'done', x: 0, y: 0, w: 10, h: 10 }, ...IDENTITY }, ctx);
    assert.equal(glow.style.display, 'none', 'non-active glow state hides the rect');

    // Null kind value -> built-in hidden.
    o.handleOverlayMessage({ glow: { state: 'active', x: 0, y: 0, w: 10, h: 10 }, ...IDENTITY }, ctx);
    assert.notEqual(glow.style.display, 'none', 'precondition: glow visible again');
    o.handleOverlayMessage({ glow: null, ...IDENTITY }, ctx);
    assert.equal(glow.style.display, 'none', 'null glow hides the rect');
  } finally {
    env.teardown();
  }
});

test('progress pill formats determinate and indeterminate text per parity', () => {
  const env = setupEnv();
  try {
    const rec = recordingLogger();
    const o = createOverlays({ document: env.document, logger: rec.logger });
    const ctx = makeCtx();
    const progress = o.layer.querySelector('.ps-overlay-progress');

    // Determinate: Math.round(62.4)% - phase (dashboard.js:3394-3395).
    o.handleOverlayMessage(
      { progress: { mode: 'determinate', percent: 62.4, phase: 'Navigating' }, ...IDENTITY },
      ctx
    );
    assert.equal(progress.textContent, '62% - Navigating', 'determinate format');
    assert.notEqual(progress.style.display, 'none', 'pill visible with progress state');

    // Indeterminate: (label || phase || Working) - (phase || Working).
    o.handleOverlayMessage({ progress: { label: 'Working' }, ...IDENTITY }, ctx);
    assert.equal(progress.textContent, 'Working - Working', 'indeterminate format');

    // Null progress hides the pill again.
    o.handleOverlayMessage({ progress: null, ...IDENTITY }, ctx);
    assert.equal(progress.style.display, 'none', 'null progress hides the pill');
  } finally {
    env.teardown();
  }
});

test('a payload without a progress key leaves the pill hidden', () => {
  const env = setupEnv();
  try {
    const rec = recordingLogger();
    const o = createOverlays({ document: env.document, logger: rec.logger });

    o.handleOverlayMessage({ glow: null, ...IDENTITY }, makeCtx());

    const progress = o.layer.querySelector('.ps-overlay-progress');
    assert.equal(progress.style.display, 'none', 'absent kind is never dispatched');
    assert.equal(progress.textContent, '', 'pill text untouched');
    assert.equal(rec.warns.length, 0, 'no unknown-kind warning for built-in keys');
  } finally {
    env.teardown();
  }
});

test('dialog open mirrors type label, literal-text message, icon, and flex display', () => {
  const env = setupEnv();
  try {
    const rec = recordingLogger();
    const o = createOverlays({ document: env.document, logger: rec.logger });
    const dialog = o.layer.querySelector('.ps-overlay-dialog');
    const type = o.layer.querySelector('.ps-overlay-dialog-type');
    const message = o.layer.querySelector('.ps-overlay-dialog-message');
    const icon = o.layer.querySelector('.ps-overlay-dialog-icon');
    const alertIconMarkup = icon.innerHTML;

    o.handleDialogMessage({ dialog: { type: 'confirm', state: 'open', message: '<b>hi</b>' } });

    assert.equal(dialog.style.display, 'flex', 'open dialog shows as flex');
    assert.equal(type.textContent, 'Confirm', 'type label is capitalized');
    // T-02-04: message must be literal text via textContent, never markup.
    assert.equal(message.textContent, '<b>hi</b>', 'message rendered as literal text');
    assert.equal(message.children.length, 0, 'no element children parsed from the message');
    assert.notEqual(icon.innerHTML, alertIconMarkup, 'icon swapped for the confirm type');
    assert.ok(icon.querySelector('svg'), 'confirm icon is an inline SVG');

    // Parity fallback (dashboard.js:3407): payload IS the dialog when the
    // dialog key is absent; missing type defaults to Alert.
    o.handleDialogMessage({ state: 'open', message: 'plain' });
    assert.equal(type.textContent, 'Alert', 'missing type defaults to Alert');
    assert.equal(message.textContent, 'plain', 'top-level payload accepted as dialog');
    assert.equal(icon.innerHTML, alertIconMarkup, 'default type restores the alert icon');
  } finally {
    env.teardown();
  }
});

test('dialog closed hides the backdrop', () => {
  const env = setupEnv();
  try {
    const rec = recordingLogger();
    const o = createOverlays({ document: env.document, logger: rec.logger });
    const dialog = o.layer.querySelector('.ps-overlay-dialog');

    o.handleDialogMessage({ dialog: { type: 'alert', state: 'open', message: 'x' } });
    assert.equal(dialog.style.display, 'flex', 'precondition: dialog open');

    o.handleDialogMessage({ dialog: { type: 'alert', state: 'closed' } });
    assert.equal(dialog.style.display, 'none', 'closed state hides the dialog');
  } finally {
    env.teardown();
  }
});

test('unknown overlay kinds are warned once and the kind loop continues', () => {
  const env = setupEnv();
  try {
    const rec = recordingLogger();
    const o = createOverlays({ document: env.document, logger: rec.logger });
    const ctx = makeCtx();

    assert.doesNotThrow(() => {
      o.handleOverlayMessage(
        // 'mystery' precedes glow in key order: the loop must keep going.
        { mystery: { x: 1 }, glow: { state: 'active', x: 0, y: 0, w: 10, h: 10 }, ...IDENTITY },
        ctx
      );
    }, 'unknown kinds never throw (T-02-07)');

    assert.equal(rec.warns.length, 1, 'exactly one warning for the unknown kind');
    const joined = rec.warns[0].join(' ');
    assert.ok(joined.includes('unknown overlay kind'), 'warning names the contract');
    assert.ok(joined.includes('mystery'), 'warning carries the offending kind');

    const glow = o.layer.querySelector('.ps-overlay-glow');
    assert.notEqual(glow.style.display, 'none', 'glow after the unknown kind still rendered');
  } finally {
    env.teardown();
  }
});

test('a throwing custom renderFn is contained and never breaks the loop', () => {
  const env = setupEnv();
  try {
    const rec = recordingLogger();
    const o = createOverlays({ document: env.document, logger: rec.logger });
    const ctx = makeCtx();

    o.register('boom', () => { throw new TypeError('renderFn-blew-up'); });

    assert.doesNotThrow(() => {
      o.handleOverlayMessage(
        { boom: { broken: true }, glow: { state: 'active', x: 0, y: 0, w: 10, h: 10 }, ...IDENTITY },
        ctx
      );
    }, 'renderFn errors are contained (safeRenderOverlay)');

    assert.ok(rec.errors.length >= 1, 'the contained error was routed to the logger');
    const glow = o.layer.querySelector('.ps-overlay-glow');
    assert.notEqual(glow.style.display, 'none', 'the kind after the throwing renderFn still rendered');
  } finally {
    env.teardown();
  }
});

test('a registered custom kind receives (payloadValue, mappedAnchorRect, layer)', () => {
  const env = setupEnv();
  try {
    const rec = recordingLogger();
    const o = createOverlays({ document: env.document, logger: rec.logger });
    const calls = [];
    o.register('badge', (value, anchorRect, layer) => { calls.push({ value, anchorRect, layer }); });

    // Numeric x/y/w/h -> mapped through mapRectToHost with the ctx scale.
    o.handleOverlayMessage(
      { badge: { x: 1, y: 2, w: 3, h: 4 }, ...IDENTITY },
      makeCtx({ s: 2, offsetX: 5, offsetY: 7 })
    );
    assert.equal(calls.length, 1, 'custom renderFn dispatched once');
    assert.deepEqual(calls[0].value, { x: 1, y: 2, w: 3, h: 4 }, 'raw payload value passed through');
    assert.deepEqual(
      calls[0].anchorRect,
      { top: 7 + 2 * 2, left: 5 + 1 * 2, width: 3 * 2, height: 4 * 2 },
      'anchor rect mapped via the scale'
    );
    assert.equal(calls[0].layer, o.layer, 'layer handed to the renderFn');

    // nid takes priority over x/y/w/h: resolveNidRect rect is used verbatim.
    const nidRect = { top: 1, left: 2, width: 3, height: 4 };
    o.handleOverlayMessage(
      { badge: { nid: 7, x: 100, y: 100, w: 100, h: 100 }, ...IDENTITY },
      makeCtx({ s: 2, offsetX: 5, offsetY: 7 }, { 7: nidRect })
    );
    assert.equal(calls.length, 2, 'second dispatch landed');
    assert.equal(calls[1].anchorRect, nidRect, 'nid resolution wins over numeric coords');

    // Neither nid nor numeric rect -> null anchor.
    o.handleOverlayMessage({ badge: { text: 'hi' }, ...IDENTITY }, makeCtx());
    assert.equal(calls[2].anchorRect, null, 'anchorless payloads pass null');
  } finally {
    env.teardown();
  }
});

test('resetOverlays hides every built-in and clears custom kinds with null', () => {
  const env = setupEnv();
  try {
    const rec = recordingLogger();
    const o = createOverlays({ document: env.document, logger: rec.logger });
    const ctx = makeCtx();
    const resetCalls = [];
    o.register('badge', (value, anchorRect, layer) => {
      resetCalls.push({ value, anchorRect, layer });
    });

    // Light everything up first.
    o.handleOverlayMessage(
      {
        glow: { state: 'active', x: 0, y: 0, w: 10, h: 10 },
        progress: { label: 'Busy', phase: 'Phase' },
        badge: { x: 1, y: 1, w: 1, h: 1 },
        ...IDENTITY,
      },
      ctx
    );
    o.handleDialogMessage({ dialog: { type: 'alert', state: 'open', message: 'x' } });

    o.resetOverlays();

    assert.equal(o.layer.querySelector('.ps-overlay-glow').style.display, 'none', 'glow reset');
    assert.equal(o.layer.querySelector('.ps-overlay-progress').style.display, 'none', 'progress reset');
    assert.equal(o.layer.querySelector('.ps-overlay-dialog').style.display, 'none', 'dialog reset');

    // Custom renderFns get (null, null, layer) so they can clear (D-13).
    const last = resetCalls[resetCalls.length - 1];
    assert.equal(last.value, null, 'custom kind cleared with null payload');
    assert.equal(last.anchorRect, null, 'no anchor on reset');
    assert.equal(last.layer, o.layer, 'layer still provided on reset');
  } finally {
    env.teardown();
  }
});

test('mapRectToHost is pure parity math', () => {
  // Identity: s=1, offsets 0 -> rect passes through.
  assert.deepEqual(
    mapRectToHost({ x: 10, y: 20, w: 30, h: 40 }, { s: 1, offsetX: 0, offsetY: 0 }),
    { top: 20, left: 10, width: 30, height: 40 },
    'identity scale maps 1:1'
  );
  // Scaled + offset (dashboard.js:3381-3384 formula).
  assert.deepEqual(
    mapRectToHost({ x: 100, y: 50, w: 200, h: 40 }, { s: 0.5, offsetX: 10, offsetY: 20 }),
    { top: 45, left: 60, width: 100, height: 20 },
    'scale and letterbox offsets applied'
  );
  // Zero-size rect stays zero-size.
  assert.deepEqual(
    mapRectToHost({ x: 0, y: 0, w: 0, h: 0 }, { s: 2, offsetX: 3, offsetY: 4 }),
    { top: 4, left: 3, width: 0, height: 0 },
    'degenerate rects map without distortion'
  );
});
