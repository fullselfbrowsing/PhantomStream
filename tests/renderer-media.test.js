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

// ---------------------------------------------------------------------------
// Phase 14 Plan 02 Task 2: the media-unavailable overlay (a passive clone of
// renderMediaPoster -- the fourth media affordance, the degrade-reason caption).
// ---------------------------------------------------------------------------

test('media-unavailable renders a passive textContent caption (pointer-events none, not a button)', async () => {
  const { createOverlays } = await import(OVERLAYS_MODULE);
  const env = setupEnv();
  try {
    const o = createOverlays({ document: env.document, logger: recordingLogger().logger });
    o.show('media-unavailable', { nid: '1', reason: 'no-player' }, { anchorRect: ANCHOR });
    const cap = o.layer.querySelector('.ps-overlay-media-unavailable');
    assert.ok(cap, 'a media-unavailable caption is rendered');
    assert.equal(cap.style.pointerEvents, 'none', 'caption is passive (no pointer events)');
    assert.equal(cap.getAttribute('role'), null, 'caption is not a button (no activation)');
    assert.equal(cap.textContent, 'Media unavailable', 'the locked caption copy via textContent');
  } finally {
    env.teardown();
  }
});

test('media-unavailable exposes the reason via a data- attribute (setAttribute, NOT markup)', async () => {
  const { createOverlays } = await import(OVERLAYS_MODULE);
  const env = setupEnv();
  try {
    const o = createOverlays({ document: env.document, logger: recordingLogger().logger });
    o.show('media-unavailable', { nid: '1', reason: 'drm' }, { anchorRect: ANCHOR });
    const cap = o.layer.querySelector('.ps-overlay-media-unavailable');
    assert.equal(cap.getAttribute('data-ps-reason'), 'drm', 'reason rides a data- attribute');
    // textContent stays the static label -- the reason is diagnostic only, never user-facing markup.
    assert.equal(cap.textContent, 'Media unavailable', 'reason is NOT interpolated into the visible caption');
  } finally {
    env.teardown();
  }
});

test('media-unavailable hides on a null payload (the universal reset contract)', async () => {
  const { createOverlays } = await import(OVERLAYS_MODULE);
  const env = setupEnv();
  try {
    const o = createOverlays({ document: env.document, logger: recordingLogger().logger });
    o.show('media-unavailable', { nid: '1', reason: 'mse-opaque' }, { anchorRect: ANCHOR });
    const cap = o.layer.querySelector('.ps-overlay-media-unavailable');
    assert.notEqual(cap.style.display, 'none', 'caption is visible while shown');
    o.show('media-unavailable', null);
    assert.equal(cap.style.display, 'none', 'null payload hides the caption');
  } finally {
    env.teardown();
  }
});

test('media-unavailable: a hostile reason/nid sets only a data- attribute, writes NO payload-derived innerHTML', async () => {
  const { createOverlays } = await import(OVERLAYS_MODULE);
  const env = setupEnv();
  try {
    const o = createOverlays({ document: env.document, logger: recordingLogger().logger });
    const hostile = '"><img src=x onerror=alert(1)><script>bad()</script>';
    o.show('media-unavailable', { nid: hostile, reason: hostile }, { anchorRect: ANCHOR });
    // No payload-derived markup is injected anywhere in the layer.
    assert.equal(o.layer.querySelector('img'), null, 'no payload-derived <img> injected');
    assert.equal(o.layer.querySelector('script'), null, 'no payload-derived <script> injected');
    const cap = o.layer.querySelector('.ps-overlay-media-unavailable');
    // The hostile string survives ONLY as the (inert) data- attribute value, set
    // via setAttribute -- it is never parsed as markup.
    assert.equal(cap.getAttribute('data-ps-reason'), hostile, 'hostile reason is an inert attribute value');
    assert.equal(cap.innerHTML.indexOf('onerror'), -1, 'no hostile string reaches the caption innerHTML');
    assert.equal(cap.innerHTML.indexOf('<img'), -1, 'no <img> marker in the caption innerHTML');
  } finally {
    env.teardown();
  }
});

test('OVERLAY_CSS carries the ps-overlay-media-unavailable parity rule (no accent)', async () => {
  const { OVERLAY_CSS } = await import(OVERLAYS_MODULE);
  assert.ok(OVERLAY_CSS.indexOf('ps-overlay-media-unavailable') !== -1, 'media-unavailable caption CSS present');
  // It reuses the poster caption parity values: scrim pill rgba(0,0,0,0.75),
  // #e0e0e0 text, system-ui 600 13/1.2 -- and carries NO amber accent of its own.
  const block = OVERLAY_CSS.slice(OVERLAY_CSS.indexOf('.ps-overlay-media-unavailable'));
  const rule = block.slice(0, block.indexOf('}') + 1);
  assert.ok(rule.indexOf('rgba(0, 0, 0, 0.75)') !== -1, 'reuses the poster-caption scrim color');
  assert.ok(rule.indexOf('#e0e0e0') !== -1, 'reuses the #e0e0e0 caption text color');
  assert.ok(rule.indexOf('#f59e0b') === -1, 'no amber accent in the passive media-unavailable rule');
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

// ---------------------------------------------------------------------------
// Task 3: handleMedia dispatch + parent-realm driver + autoplay/affordance +
// onMediaBlocked + unmute trigger + mediaMode poster gate + backward-compat
// ---------------------------------------------------------------------------

const IDENTITY = { streamSessionId: 's1', snapshotId: 1 };

/** Glue the srcdoc into jsdom's contentDocument and fire the load event. */
function glue(env, iframe) {
  const cd = iframe.contentDocument;
  cd.open();
  cd.write(iframe.getAttribute('srcdoc'));
  cd.close();
  iframe.dispatchEvent(new env.window.Event('load'));
  return cd;
}

/** A snapshot payload carrying a single <video> at nid '1'. */
function videoSnapshot(extra) {
  return Object.assign({
    html: '<video></video>',
    nodeIds: ['1'],
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
  }, extra || {});
}

/**
 * Build a recording stub over a jsdom media element: records play/pause calls,
 * currentTime / playbackRate / muted / volume assignments, and lets each test
 * control play()'s return (undefined for the jsdom guard, a rejected promise
 * for the NotAllowedError path). Property reads (paused/readyState/seeking/
 * seekable/duration/currentTime) are defined via Object.defineProperty.
 */
function stubMediaElement(env, el, opts) {
  const o = opts || {};
  const rec = {
    plays: 0,
    pauses: 0,
    currentTimeSets: [],
    playbackRateSets: [],
    mutedSets: [],
    volumeSets: [],
    el,
  };
  let _currentTime = (o.currentTime != null) ? o.currentTime : 0;
  let _playbackRate = (o.playbackRate != null) ? o.playbackRate : 1;
  let _muted = (o.muted != null) ? o.muted : false;
  let _volume = (o.volume != null) ? o.volume : 1;
  const _paused = (o.paused != null) ? o.paused : true;
  const _seeking = (o.seeking != null) ? o.seeking : false;
  const _readyState = (o.readyState != null) ? o.readyState : 4;
  const _seekable = (o.seekable != null) ? o.seekable : { length: 1, end() { return 100; } };
  const _duration = (o.duration != null) ? o.duration : 120;

  Object.defineProperty(el, 'paused', { configurable: true, get() { return _paused; } });
  Object.defineProperty(el, 'seeking', { configurable: true, get() { return _seeking; } });
  Object.defineProperty(el, 'readyState', { configurable: true, get() { return _readyState; } });
  Object.defineProperty(el, 'seekable', { configurable: true, get() { return _seekable; } });
  Object.defineProperty(el, 'duration', { configurable: true, get() { return _duration; } });
  Object.defineProperty(el, 'currentTime', {
    configurable: true,
    get() { return _currentTime; },
    set(v) { _currentTime = v; rec.currentTimeSets.push(v); },
  });
  Object.defineProperty(el, 'playbackRate', {
    configurable: true,
    get() { return _playbackRate; },
    set(v) { _playbackRate = v; rec.playbackRateSets.push(v); },
  });
  Object.defineProperty(el, 'muted', {
    configurable: true,
    get() { return _muted; },
    set(v) { _muted = v; rec.mutedSets.push(v); },
  });
  Object.defineProperty(el, 'volume', {
    configurable: true,
    get() { return _volume; },
    set(v) { _volume = v; rec.volumeSets.push(v); },
  });
  el.play = function () {
    rec.plays++;
    if (o.playReturns === 'undefined') return undefined;
    if (o.playReturns === 'reject-notallowed') {
      return Promise.reject(new env.window.DOMException('blocked', 'NotAllowedError'));
    }
    return Promise.resolve();
  };
  el.pause = function () { rec.pauses++; };
  return rec;
}

test('an unknown wire type hits default and is silently ignored (backward-compat)', async () => {
  const { createViewer } = await import(RENDERER_MODULE);
  const env = setupEnv();
  try {
    const rec = recordingLogger();
    const ctx = streamingMediaViewerFactory(createViewer, env, { logger: rec.logger });
    // A viewer/dispatch WITHOUT a STREAM.MEDIA case is simulated by an unknown
    // type: it must not throw and must not change state.
    assert.doesNotThrow(() => ctx.transport.emit('ext:totally-unknown-type', { foo: 1, ...IDENTITY }));
    assert.equal(rec.errors.length, 0, 'no error logged for an unknown type (silent ignore)');
  } finally {
    env.teardown();
  }
});

test('handleMedia rejects a payload with mismatched stream identity (no driver call)', async () => {
  const { createViewer } = await import(RENDERER_MODULE);
  const env = setupEnv();
  try {
    const ctx = streamingMediaViewerFactory(createViewer, env, { mediaMode: 'reference' });
    const rec = stubMediaElement(env, ctx.video, { paused: false });
    ctx.transport.emit('ext:dom-media', {
      nid: '1', currentTime: 5, paused: false, playbackRate: 1, duration: 120,
      sentAt: Date.now(), streamSessionId: 'STALE', snapshotId: 999,
    });
    assert.equal(rec.plays, 0, 'a stale-identity media payload never drives the element');
    assert.equal(rec.currentTimeSets.length, 0, 'no seek applied for a stale payload');
  } finally {
    env.teardown();
  }
});

test('handleMedia drives the element: a paused source pauses the playing element', async () => {
  const { createViewer } = await import(RENDERER_MODULE);
  const env = setupEnv();
  try {
    const ctx = streamingMediaViewerFactory(createViewer, env, { mediaMode: 'reference' });
    const rec = stubMediaElement(env, ctx.video, { paused: false }); // element is playing
    ctx.transport.emit('ext:dom-media', {
      nid: '1', currentTime: 5, paused: true, playbackRate: 1, duration: 120,
      sentAt: Date.now(), ...IDENTITY,
    });
    assert.equal(rec.pauses, 1, 'a paused source pauses the element (reconciler -> pause)');
  } finally {
    env.teardown();
  }
});

test('handleMedia hard-seeks on an explicit seeked event via the reconciler', async () => {
  const { createViewer } = await import(RENDERER_MODULE);
  const env = setupEnv();
  try {
    const ctx = streamingMediaViewerFactory(createViewer, env, { mediaMode: 'reference' });
    const rec = stubMediaElement(env, ctx.video, { paused: false, currentTime: 5, readyState: 4 });
    ctx.transport.emit('ext:dom-media', {
      nid: '1', event: 'seeked', currentTime: 42, paused: false, playbackRate: 1, duration: 120,
      sentAt: Date.now(), ...IDENTITY,
    });
    assert.ok(rec.currentTimeSets.indexOf(42) !== -1, 'an explicit seeked event hard-seeks to the target');
  } finally {
    env.teardown();
  }
});

test('driver defaults muted=true before the first programmatic play; play() returning undefined does NOT throw', async () => {
  const { createViewer } = await import(RENDERER_MODULE);
  const env = setupEnv();
  try {
    const ctx = streamingMediaViewerFactory(createViewer, env, { mediaMode: 'reference' });
    // paused element + playing source -> ensurePlaying; play() returns undefined (jsdom).
    const rec = stubMediaElement(env, ctx.video, { paused: true, playReturns: 'undefined' });
    assert.doesNotThrow(() => ctx.transport.emit('ext:dom-media', {
      nid: '1', currentTime: 0, paused: false, playbackRate: 1, duration: 120,
      sentAt: Date.now(), ...IDENTITY,
    }));
    assert.equal(rec.plays, 1, 'play() was called');
    assert.ok(rec.mutedSets.indexOf(true) !== -1, 'muted=true set before the first programmatic play');
  } finally {
    env.teardown();
  }
});

test('play() rejecting NotAllowedError shows media-blocked + invokes onMediaBlocked(nid) without wedging', async () => {
  const { createViewer } = await import(RENDERER_MODULE);
  const env = setupEnv();
  try {
    const blockedNids = [];
    const ctx = streamingMediaViewerFactory(createViewer, env, {
      mediaMode: 'reference',
      onMediaBlocked(nid) { blockedNids.push(nid); },
    });
    const rec = stubMediaElement(env, ctx.video, { paused: true, playReturns: 'reject-notallowed' });
    ctx.transport.emit('ext:dom-media', {
      nid: '1', currentTime: 0, paused: false, playbackRate: 1, duration: 120,
      sentAt: Date.now(), ...IDENTITY,
    });
    // The rejection settles on a microtask.
    await Promise.resolve(); await Promise.resolve();
    const scrim = env.document.querySelector('.ps-overlay-media-blocked');
    assert.ok(scrim && scrim.style.display !== 'none', 'the blocked-play affordance is shown on NotAllowedError');
    assert.deepEqual(blockedNids, ['1'], 'onMediaBlocked(nid) invoked with the element nid');

    // The mirror is not wedged: a subsequent pause still drives the element.
    const rec2 = stubMediaElement(env, ctx.video, { paused: false });
    ctx.transport.emit('ext:dom-media', {
      nid: '1', currentTime: 5, paused: true, playbackRate: 1, duration: 120,
      sentAt: Date.now(), ...IDENTITY,
    });
    assert.equal(rec2.pauses, 1, 'the mirror keeps updating after a blocked play (never wedges)');
  } finally {
    env.teardown();
  }
});

test('a throwing onMediaBlocked is caught and logged, never rethrown', async () => {
  const { createViewer } = await import(RENDERER_MODULE);
  const env = setupEnv();
  try {
    const rec = recordingLogger();
    const ctx = streamingMediaViewerFactory(createViewer, env, {
      mediaMode: 'reference',
      logger: rec.logger,
      onMediaBlocked() { throw new Error('host boom'); },
    });
    stubMediaElement(env, ctx.video, { paused: true, playReturns: 'reject-notallowed' });
    assert.doesNotThrow(() => ctx.transport.emit('ext:dom-media', {
      nid: '1', currentTime: 0, paused: false, playbackRate: 1, duration: 120,
      sentAt: Date.now(), ...IDENTITY,
    }));
    await Promise.resolve(); await Promise.resolve();
    assert.ok(rec.errors.length >= 1, 'a throwing onMediaBlocked is routed to the logger');
  } finally {
    env.teardown();
  }
});

test('unmute trigger: muted element + unmuted source in reference shows media-unmute; onActivate unmutes + restores volume', async () => {
  const { createViewer } = await import(RENDERER_MODULE);
  const env = setupEnv();
  try {
    const ctx = streamingMediaViewerFactory(createViewer, env, { mediaMode: 'reference' });
    // Element is playing AND muted (the muted-autoplay default already applied);
    // the source reports unmuted via payload.muted === false.
    const rec = stubMediaElement(env, ctx.video, { paused: false, muted: true, currentTime: 5 });
    ctx.transport.emit('ext:dom-media', {
      nid: '1', currentTime: 5, paused: false, muted: false, volume: 0.8, playbackRate: 1, duration: 120,
      sentAt: Date.now(), ...IDENTITY,
    });
    const pill = env.document.querySelector('.ps-overlay-media-unmute');
    assert.ok(pill && pill.style.display !== 'none', 'media-unmute shown when element muted but source unmuted (reference)');

    // Activate the affordance -> muted=false, volume restored, pill hidden.
    pill.dispatchEvent(new env.window.Event('click'));
    assert.ok(rec.mutedSets.indexOf(false) !== -1, 'onActivate sets muted=false');
    assert.ok(rec.volumeSets.indexOf(0.8) !== -1, 'onActivate restores the source volume');
    assert.equal(pill.style.display, 'none', 'the media-unmute affordance hides after activation');
  } finally {
    env.teardown();
  }
});

test('unmute trigger does NOT show when the source is still muted (or no muted field)', async () => {
  const { createViewer } = await import(RENDERER_MODULE);
  const env = setupEnv();
  try {
    const ctx = streamingMediaViewerFactory(createViewer, env, { mediaMode: 'reference' });
    stubMediaElement(env, ctx.video, { paused: false, muted: true, currentTime: 5 });
    ctx.transport.emit('ext:dom-media', {
      nid: '1', currentTime: 5, paused: false, muted: true, playbackRate: 1, duration: 120,
      sentAt: Date.now(), ...IDENTITY,
    });
    const pill = env.document.querySelector('.ps-overlay-media-unmute');
    assert.ok(!pill || pill.style.display === 'none', 'media-unmute not shown when source is muted');
  } finally {
    env.teardown();
  }
});

test('mediaMode poster: handleMedia binds no source, calls no play(), shows no affordance', async () => {
  const { createViewer } = await import(RENDERER_MODULE);
  const env = setupEnv();
  try {
    const ctx = streamingMediaViewerFactory(createViewer, env, { mediaMode: 'poster' });
    const rec = stubMediaElement(env, ctx.video, { paused: true, muted: true });
    ctx.transport.emit('ext:dom-media', {
      nid: '1', currentTime: 5, paused: false, muted: false, volume: 0.9, playbackRate: 1, duration: 120,
      sentAt: Date.now(), ...IDENTITY,
    });
    assert.equal(rec.plays, 0, 'poster mode never calls play()');
    assert.equal(rec.pauses, 0, 'poster mode never drives the element');
    const blocked = env.document.querySelector('.ps-overlay-media-blocked');
    const pill = env.document.querySelector('.ps-overlay-media-unmute');
    assert.ok(!blocked || blocked.style.display === 'none', 'no blocked-play affordance in poster mode');
    assert.ok(!pill || pill.style.display === 'none', 'no unmute affordance in poster mode');
  } finally {
    env.teardown();
  }
});

// CR-01 (BLOCKER): poster mode must NOT let the browser issue a media GET. The
// authoritative control is the STRING-layer gate (the parser prefetches
// <video src>/<source src> DURING srcdoc parse, before any post-parse scrub can
// run), so this asserts on the EMITTED srcdoc string -- not merely that the
// playback driver no-ops (jsdom never prefetches, so the driver-only assertion
// above is vacuous w.r.t. the fetch). The allowed origin (cdn.example.test) is
// widened so this is NOT an origin block: it proves poster mode strips the
// playable source even for an origin reference mode would happily fetch, while
// the poster image (the one fetch poster mode permits) is KEPT.
test('mediaMode poster: string layer neutralizes <video src>/<source src> pre-parse, keeps poster (CR-01)', async () => {
  const { createViewer } = await import(RENDERER_MODULE);
  const env = setupEnv();
  try {
    const ctx = streamingMediaViewerFactory(
      createViewer,
      env,
      { mediaMode: 'poster', allowAssetOrigins: ['cdn.example.test'] },
      {
        html: '<video src="https://cdn.example.test/clip.mp4" poster="https://cdn.example.test/poster.jpg">'
          + '<source src="https://cdn.example.test/clip.webm"></video>',
      }
    );
    const srcdoc = ctx.iframe.getAttribute('srcdoc');
    // The playable media bytes must NOT survive into the parsed markup -- a real
    // browser would prefetch either URL during parse.
    assert.equal(srcdoc.includes('clip.mp4'), false, 'poster mode must strip the <video src> media URL pre-parse');
    assert.equal(srcdoc.includes('clip.webm'), false, 'poster mode must strip the <source src> media URL pre-parse');
    // The poster image is the only thing poster mode fetches -- it is kept.
    assert.equal(srcdoc.includes('poster.jpg'), true, 'poster mode keeps the gated poster image');
    // The <video> tag itself survives (poster strip is surgical, not a
    // wholesale placeholder swap) and is well-formed: exactly one opener, one
    // closer, no orphaned </video> (WR-03 parity for the poster path).
    assert.equal((srcdoc.match(/<video\b/gi) || []).length, 1, 'exactly one <video> opener');
    assert.equal((srcdoc.match(/<\/video>/gi) || []).length, 1, 'exactly one </video> close tag');
  } finally {
    env.teardown();
  }
});

// Reference mode is the by-reference fetch model: an allowed-origin media src is
// preserved (the counterpoint that proves the poster strip above is mode-scoped,
// not a blanket media kill).
test('mediaMode reference: string layer preserves allowed-origin <video src>/<source src> (CR-01 counterpoint)', async () => {
  const { createViewer } = await import(RENDERER_MODULE);
  const env = setupEnv();
  try {
    const ctx = streamingMediaViewerFactory(
      createViewer,
      env,
      { mediaMode: 'reference', allowAssetOrigins: ['cdn.example.test'] },
      {
        html: '<video src="https://cdn.example.test/clip.mp4">'
          + '<source src="https://cdn.example.test/clip.webm"></video>',
      }
    );
    const srcdoc = ctx.iframe.getAttribute('srcdoc');
    assert.equal(srcdoc.includes('clip.mp4'), true, 'reference mode keeps the allowed-origin <video src>');
    assert.equal(srcdoc.includes('clip.webm'), true, 'reference mode keeps the allowed-origin <source src>');
  } finally {
    env.teardown();
  }
});

test('driver holds while element.seeking is true (skips a new seek -- Pitfall 6)', async () => {
  const { createViewer } = await import(RENDERER_MODULE);
  const env = setupEnv();
  try {
    const ctx = streamingMediaViewerFactory(createViewer, env, { mediaMode: 'reference' });
    const rec = stubMediaElement(env, ctx.video, { paused: false, seeking: true, currentTime: 5, readyState: 4 });
    ctx.transport.emit('ext:dom-media', {
      nid: '1', event: 'seeked', currentTime: 90, paused: false, playbackRate: 1, duration: 120,
      sentAt: Date.now(), ...IDENTITY,
    });
    assert.equal(rec.currentTimeSets.length, 0, 'no new seek is applied while the element is seeking');
  } finally {
    env.teardown();
  }
});

test('seek with readyState < HAVE_METADATA is not applied (readyState gate)', async () => {
  const { createViewer } = await import(RENDERER_MODULE);
  const env = setupEnv();
  try {
    const ctx = streamingMediaViewerFactory(createViewer, env, { mediaMode: 'reference' });
    const rec = stubMediaElement(env, ctx.video, { paused: false, currentTime: 5, readyState: 0 });
    ctx.transport.emit('ext:dom-media', {
      nid: '1', event: 'seeked', currentTime: 88, paused: false, playbackRate: 1, duration: 120,
      sentAt: Date.now(), ...IDENTITY,
    });
    assert.equal(rec.currentTimeSets.length, 0, 'a seek is withheld until readyState >= HAVE_METADATA');
  } finally {
    env.teardown();
  }
});

test('rejoin-edge with seekable.length === 0 holds instead of throwing (Pitfall 4 guard)', async () => {
  const { createViewer } = await import(RENDERER_MODULE);
  const env = setupEnv();
  try {
    const ctx = streamingMediaViewerFactory(createViewer, env, { mediaMode: 'reference' });
    // Live source (no duration), big drift -> reconciler returns rejoin-edge;
    // element seekable is empty so the driver must hold (no throw, no seek).
    const rec = stubMediaElement(env, ctx.video, {
      paused: false, currentTime: 0, readyState: 4,
      seekable: { length: 0, end() { throw new Error('IndexSizeError'); } },
    });
    assert.doesNotThrow(() => ctx.transport.emit('ext:dom-media', {
      nid: '1', currentTime: 1000, paused: false, playbackRate: 1, live: true,
      sentAt: Date.now() - 5000, ...IDENTITY,
    }));
    assert.equal(rec.currentTimeSets.length, 0, 'no seek applied when seekable is empty (guarded hold)');
  } finally {
    env.teardown();
  }
});

test('snapshot media[] baseline applies on first bind (readyState-gated), then reconciler owns it', async () => {
  const { createViewer } = await import(RENDERER_MODULE);
  const env = setupEnv();
  try {
    const transport = {
      handler: null,
      send() {},
      onMessage(h) { transport.handler = h; return function () { transport.handler = null; }; },
      emit(type, payload) { if (transport.handler) transport.handler(type, payload); },
    };
    createViewer({
      container: env.document.body,
      transport,
      logger: recordingLogger().logger,
      mediaMode: 'reference',
    });
    // Snapshot carrying a media[] baseline: playing source at t=30.
    transport.emit('ext:dom-snapshot', videoSnapshot({
      media: [{ nid: '1', currentTime: 30, paused: false, playbackRate: 1, duration: 120 }],
    }));
    const iframe = env.document.querySelector('iframe');
    // Glue: write the srcdoc, stub the freshly-parsed <video>, THEN fire load so
    // the baseline applies against the stub.
    const cd = iframe.contentDocument;
    cd.open();
    cd.write(iframe.getAttribute('srcdoc'));
    cd.close();
    const video = cd.querySelector('video');
    const rec = stubMediaElement(env, video, { paused: true, readyState: 4, playReturns: 'undefined' });
    iframe.dispatchEvent(new env.window.Event('load'));

    assert.ok(rec.currentTimeSets.indexOf(30) !== -1, 'baseline currentTime applied on first bind (readyState-gated)');
    assert.equal(rec.plays, 1, 'a playing baseline starts the element (muted-default ensurePlaying)');
    assert.ok(rec.mutedSets.indexOf(true) !== -1, 'baseline play is muted-default');
  } finally {
    env.teardown();
  }
});

test('the sandbox token stays exactly allow-same-origin (no allow-scripts/autoplay added)', async () => {
  const { createViewer } = await import(RENDERER_MODULE);
  const env = setupEnv();
  try {
    const ctx = streamingMediaViewerFactory(createViewer, env, { mediaMode: 'reference' });
    assert.equal(ctx.iframe.getAttribute('sandbox'), 'allow-same-origin', 'sandbox is exactly allow-same-origin');
  } finally {
    env.teardown();
  }
});

/** Wrap streamingMediaViewer with the already-imported createViewer. */
function streamingMediaViewerFactory(createViewer, env, cfg, snapshotExtra) {
  const transport = {
    handler: null,
    send() {},
    onMessage(h) { transport.handler = h; return function () { transport.handler = null; }; },
    emit(type, payload) { if (transport.handler) transport.handler(type, payload); },
  };
  const viewer = createViewer(Object.assign({
    container: env.document.body,
    transport,
    logger: (cfg && cfg.logger) || recordingLogger().logger,
  }, cfg || {}));
  transport.emit('ext:dom-snapshot', videoSnapshot(snapshotExtra));
  const iframe = env.document.querySelector('iframe');
  const cd = glue(env, iframe);
  const video = cd.querySelector('video');
  return { transport, viewer, iframe, cd, video };
}
