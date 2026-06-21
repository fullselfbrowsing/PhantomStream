// Phase 13 Plan 03: renderer media slice.
//
// Task 2 (this file, part 1): the three media affordance renderFns registered
// through the existing overlay registry seam -- blocked-play scrim+button,
// unmute pill, poster caption -- matching the LOCKED 13-UI-SPEC States A/B/C
// (textContent-only text, inline-SVG glyphs the sole innerHTML, pointer-events
// auto only on the clickable control, 44x44 hit target, amber #f59e0b reserved
// for the actionable control, null payload === hide).
//
// Task 3 (appended below): handleMedia dispatch + the parent-realm playback
// driver (muted default, play()-undefined guard, NotAllowedError affordance +
// onMediaBlocked config callback, unmute show-then-activate, mediaMode poster,
// staleness, old-viewer-ignores).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM, VirtualConsole } from 'jsdom';

const OVERLAYS_MODULE = '../src/renderer/overlays.js';
const RENDERER_MODULE = '../src/renderer/index.js';

/** Fresh jsdom host with a mount container. */
function setupEnv() {
  const dom = new JSDOM(
    '<!DOCTYPE html><html><body><div id="mirror-container"></div></body></html>',
    { url: 'https://viewer.fixture.test/', virtualConsole: new VirtualConsole() }
  );
  return {
    dom,
    window: dom.window,
    document: dom.window.document,
    mount: dom.window.document.getElementById('mirror-container'),
    teardown() { dom.window.close(); },
  };
}

function recordingLogger() {
  const warns = [];
  const errors = [];
  return {
    warns, errors,
    logger: { info() {}, warn(...a) { warns.push(a); }, error(...a) { errors.push(a); } },
  };
}

const ANCHOR = { top: 40, left: 60, width: 320, height: 180 };

// ---------------------------------------------------------------------------
// Task 2: media affordance renderFns through the registry seam
// ---------------------------------------------------------------------------

test('register accepts the three media affordance kinds through the existing seam', async () => {
  const { createOverlays } = await import(OVERLAYS_MODULE);
  const env = setupEnv();
  try {
    const o = createOverlays({ document: env.document, logger: recordingLogger().logger });
    // The three media renderFns are pre-registered by createOverlays (siblings
    // of glow/progress/dialog) and reachable through the same show() seam.
    assert.equal(typeof o.show, 'function', 'overlays handle exposes show(kind, payload, ctx)');
    // show with a null payload is the universal hide -- must not throw for any
    // of the three kinds even before a non-null show.
    assert.doesNotThrow(() => o.show('media-blocked', null));
    assert.doesNotThrow(() => o.show('media-unmute', null));
    assert.doesNotThrow(() => o.show('media-poster', null));
  } finally {
    env.teardown();
  }
});

test('media-blocked renders a scrim + >=44x44 amber play button anchored to the rect', async () => {
  const { createOverlays } = await import(OVERLAYS_MODULE);
  const env = setupEnv();
  try {
    const o = createOverlays({ document: env.document, logger: recordingLogger().logger });
    let activated = 0;
    o.show('media-blocked', { nid: '1', onActivate() { activated++; } }, { anchorRect: ANCHOR });

    const scrim = o.layer.querySelector('.ps-overlay-media-blocked');
    assert.ok(scrim, 'a media-blocked scrim element is rendered into the host layer');
    assert.equal(scrim.style.display !== 'none', true, 'the scrim is shown for a non-null payload');
    // Clipped to the element rect.
    assert.equal(scrim.style.top, ANCHOR.top + 'px', 'scrim top anchored to rect');
    assert.equal(scrim.style.left, ANCHOR.left + 'px', 'scrim left anchored to rect');
    assert.equal(scrim.style.width, ANCHOR.width + 'px', 'scrim width matches rect');
    assert.equal(scrim.style.height, ANCHOR.height + 'px', 'scrim height matches rect');

    const btn = scrim.querySelector('.ps-overlay-media-button');
    assert.ok(btn, 'a centered play button is present');
    assert.equal(btn.getAttribute('role'), 'button', 'button has role=button');
    assert.equal(btn.getAttribute('tabindex'), '0', 'button is focusable');
    assert.equal(btn.getAttribute('aria-label'), 'Play mirrored media', 'button has the locked aria-label');
    assert.equal(btn.style.pointerEvents, 'auto', 'the button opts into pointer events');
    // 44x44 minimum hit target.
    assert.ok(parseInt(btn.style.minWidth, 10) >= 44, 'button min-width >= 44px');
    assert.ok(parseInt(btn.style.minHeight, 10) >= 44, 'button min-height >= 44px');
    // Inline-SVG glyph is the only innerHTML.
    assert.ok(btn.querySelector('svg'), 'the play glyph is an inline SVG');

    // Activation (click) invokes the payload onActivate.
    btn.dispatchEvent(new env.window.Event('click'));
    assert.equal(activated, 1, 'clicking the play button invokes onActivate');

    // Keyboard: Enter activates.
    const enter = new env.window.KeyboardEvent('keydown', { key: 'Enter' });
    btn.dispatchEvent(enter);
    assert.equal(activated, 2, 'Enter activates the play button');
  } finally {
    env.teardown();
  }
});

test('media-blocked hides on a null payload (universal reset contract)', async () => {
  const { createOverlays } = await import(OVERLAYS_MODULE);
  const env = setupEnv();
  try {
    const o = createOverlays({ document: env.document, logger: recordingLogger().logger });
    o.show('media-blocked', { nid: '1', onActivate() {} }, { anchorRect: ANCHOR });
    const scrim = o.layer.querySelector('.ps-overlay-media-blocked');
    assert.ok(scrim.style.display !== 'none', 'shown first');
    o.show('media-blocked', null);
    assert.equal(scrim.style.display, 'none', 'null payload hides the blocked-play scrim');
  } finally {
    env.teardown();
  }
});

test('media-unmute renders a bottom-left amber pill with the Unmute label via textContent', async () => {
  const { createOverlays } = await import(OVERLAYS_MODULE);
  const env = setupEnv();
  try {
    const o = createOverlays({ document: env.document, logger: recordingLogger().logger });
    let activated = 0;
    o.show('media-unmute', { nid: '1', onActivate() { activated++; } }, { anchorRect: ANCHOR });

    const pill = o.layer.querySelector('.ps-overlay-media-unmute');
    assert.ok(pill, 'a media-unmute pill is rendered');
    assert.equal(pill.style.display !== 'none', true, 'pill shown for a non-null payload');
    assert.equal(pill.getAttribute('role'), 'button', 'pill is a button');
    assert.equal(pill.getAttribute('tabindex'), '0', 'pill is focusable');
    assert.equal(pill.getAttribute('aria-label'), 'Unmute mirrored media', 'pill has the locked aria-label');
    assert.equal(pill.style.pointerEvents, 'auto', 'pill opts into pointer events');
    // The visible label is set via textContent (security invariant).
    assert.ok(pill.textContent.indexOf('Unmute') !== -1, 'pill label "Unmute" present via textContent');
    // Inline SVG speaker glyph is the only innerHTML.
    assert.ok(pill.querySelector('svg'), 'muted-speaker glyph is an inline SVG');

    pill.dispatchEvent(new env.window.Event('click'));
    assert.equal(activated, 1, 'clicking the pill invokes onActivate');
    const space = new env.window.KeyboardEvent('keydown', { key: ' ' });
    pill.dispatchEvent(space);
    assert.equal(activated, 2, 'Space activates the unmute pill');

    o.show('media-unmute', null);
    assert.equal(pill.style.display, 'none', 'null payload hides the unmute pill');
  } finally {
    env.teardown();
  }
});

test('media-poster renders a passive caption (pointer-events none, no activation)', async () => {
  const { createOverlays } = await import(OVERLAYS_MODULE);
  const env = setupEnv();
  try {
    const o = createOverlays({ document: env.document, logger: recordingLogger().logger });
    o.show('media-poster', { nid: '1' }, { anchorRect: ANCHOR });
    const cap = o.layer.querySelector('.ps-overlay-media-poster');
    assert.ok(cap, 'a media-poster caption is rendered');
    assert.equal(cap.style.pointerEvents, 'none', 'poster caption is passive (no pointer events)');
    assert.equal(cap.getAttribute('role'), null, 'poster caption is not a button');
    assert.equal(cap.textContent, 'Media (poster only)', 'the locked caption copy via textContent');
    o.show('media-poster', null);
    assert.equal(cap.style.display, 'none', 'null payload hides the poster caption');
  } finally {
    env.teardown();
  }
});

test('OVERLAY_CSS carries the ps-overlay-media-* parity values', async () => {
  const { OVERLAY_CSS } = await import(OVERLAYS_MODULE);
  assert.ok(OVERLAY_CSS.indexOf('ps-overlay-media-blocked') !== -1, 'blocked scrim CSS present');
  assert.ok(OVERLAY_CSS.indexOf('ps-overlay-media-button') !== -1, 'play button CSS present');
  assert.ok(OVERLAY_CSS.indexOf('ps-overlay-media-unmute') !== -1, 'unmute pill CSS present');
  assert.ok(OVERLAY_CSS.indexOf('ps-overlay-media-poster') !== -1, 'poster caption CSS present');
  // Parity colors/values from 13-UI-SPEC.
  assert.ok(OVERLAY_CSS.indexOf('rgba(0, 0, 0, 0.5)') !== -1, 'scrim parity color');
  assert.ok(OVERLAY_CSS.indexOf('#f59e0b') !== -1, 'amber accent parity color');
  assert.ok(OVERLAY_CSS.indexOf('rgba(245, 158, 11, 0.6)') !== -1, 'glow parity shadow');
});

test('media affordances interpolate NO payload-derived string into markup (only static SVG innerHTML)', async () => {
  const { createOverlays } = await import(OVERLAYS_MODULE);
  const env = setupEnv();
  try {
    const o = createOverlays({ document: env.document, logger: recordingLogger().logger });
    // A hostile nid value must never reach innerHTML; the renderFns use it only
    // for bookkeeping (not interpolated). Render and assert no injected marker.
    const hostileNid = '"><img src=x onerror=alert(1)>';
    o.show('media-blocked', { nid: hostileNid, onActivate() {} }, { anchorRect: ANCHOR });
    o.show('media-unmute', { nid: hostileNid, onActivate() {} }, { anchorRect: ANCHOR });
    o.show('media-poster', { nid: hostileNid }, { anchorRect: ANCHOR });
    assert.equal(o.layer.querySelector('img'), null, 'no payload-derived <img> ever injected into the layer');
    // The only SVGs are the static glyph constants.
    const svgs = o.layer.querySelectorAll('svg');
    assert.ok(svgs.length >= 2, 'static play + speaker glyphs present');
  } finally {
    env.teardown();
  }
});
