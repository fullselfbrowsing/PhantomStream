// Phase 14 Plan 01, Task 3: Wave 0 scaffold for the renderer adaptive-player
// decision tree.
//
// This file is the home the Nyquist contract (14-VALIDATION "Per-Task
// Verification Map", MADPT-01/02/03 rows) names for the player tests Plans
// 02/03 deliver: native-HLS / host-playerFactory / lazy-hls / degrade branches,
// manifest->element correlation (single-active vs page-scope), the four reason
// codes (no-manifest/no-player/mse-opaque/drm) + media-unavailable overlay, DRM
// 'encrypted' degrade, degrade-keeps-poster, and the contained (never-rethrown)
// onMediaUnavailable hook.
//
// It is deliberately a Wave 0 SCAFFOLD: it establishes (and proves usable) the
// jsdom harness those waves extend -- a JSDOM env, a recording logger, a stub
// MediaSource installable on the parent window (the parent-realm global the MSE
// bind needs), and a video element stub with a controllable canPlayType (the
// native-HLS feature-detect branch). It does NOT import
// src/renderer/media-player.js -- that module does not exist until Plan 02, and
// Plan 02's tasks add that import alongside the real decision-tree assertions.
// The single placeholder below asserts ONLY harness wiring, so the file runs
// green today (satisfying the "Wave 0 file exists and runs" gate) without
// blocking on unimplemented behavior.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM, VirtualConsole } from 'jsdom';

const MEDIA_PLAYER_MODULE = '../src/renderer/media-player.js';

/** Fresh jsdom host with a mount container (mirrors tests/renderer-media.test.js). */
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

/**
 * Install a minimal parent-realm MediaSource stub on the host window. The Phase
 * 14 MSE bind feature-detects `win.ManagedMediaSource || win.MediaSource`; this
 * stub lets Plan 02/03 exercise the MSE branch without a real media engine
 * (jsdom has none). Records constructions for assertion.
 */
function installStubMediaSource(win) {
  const constructed = [];
  function StubMediaSource() {
    this.readyState = 'closed';
    this.sourceBuffers = { length: 0 };
    constructed.push(this);
  }
  StubMediaSource.prototype.addSourceBuffer = function () { return {}; };
  StubMediaSource.prototype.endOfStream = function () {};
  win.MediaSource = StubMediaSource;
  // URL.createObjectURL / revokeObjectURL are needed by the object-URL bind path;
  // jsdom may not implement them for a stub MediaSource, so provide recorders.
  const created = [];
  const revoked = [];
  win.URL = win.URL || {};
  win.URL.createObjectURL = function (obj) { const u = 'blob:stub-' + created.length; created.push(obj); return u; };
  win.URL.revokeObjectURL = function (u) { revoked.push(u); };
  return { constructed, created, revoked, StubMediaSource };
}

/**
 * A minimal in-iframe <video> stub with a controllable canPlayType (the native-
 * HLS feature-detect input) and recorders for the src attribute set the native
 * branch performs cross-realm. Plan 02/03 extend this toward the full
 * stubMediaElement in tests/renderer-media.test.js.
 */
function stubVideoEl(doc, canPlay) {
  const el = doc.createElement('video');
  const rec = { srcSets: [], removed: 0, loaded: 0 };
  el.canPlayType = function (type) {
    return (canPlay && Object.prototype.hasOwnProperty.call(canPlay, type)) ? canPlay[type] : '';
  };
  // Record the cross-realm src attribute set (native-HLS path) without a real load.
  const realSetAttr = el.setAttribute.bind(el);
  el.setAttribute = function (name, value) {
    if (name === 'src') rec.srcSets.push(value);
    return realSetAttr(name, value);
  };
  el.removeAttribute = function () { rec.removed++; };
  el.load = function () { rec.loaded++; };
  return { el, rec };
}

// ---------------------------------------------------------------------------
// Plan 02 Task 1: the decision-tree player (native-HLS / playerFactory /
// lazy-hls / degrade), built and tested in isolation with stub MediaSource,
// stub Hls, controllable canPlayType, and a fake playerFactory. Real MSE
// playback is not observable here (jsdom has no MSE; the FSB browser runs tabs
// hidden) -- the live A1/A5 bind is a documented deferred UAT. These tests pin
// the branch order, the load-then-attach order, the four reason codes routing
// to onMediaUnavailable, and the never-rethrow containment.
// ---------------------------------------------------------------------------

/**
 * A richer in-iframe <video> stub for the player tests: the native-HLS branch
 * assigns `videoEl.src = manifestUrl` (a PROPERTY set, not setAttribute), and
 * the DRM branch needs addEventListener('encrypted')/dispatchEvent. canPlay is
 * a { type: advisory } map; absent types return the empty advisory string.
 */
function playerVideoStub(doc, canPlay) {
  const el = doc.createElement('video');
  const rec = { srcProp: [], removed: 0, loaded: 0, listeners: {} };
  el.canPlayType = function (type) {
    return (canPlay && Object.prototype.hasOwnProperty.call(canPlay, type)) ? canPlay[type] : '';
  };
  // Record the cross-realm `videoEl.src = url` property assignment (native path).
  let _src = '';
  Object.defineProperty(el, 'src', {
    configurable: true,
    get() { return _src; },
    set(v) { _src = v; rec.srcProp.push(v); },
  });
  el.removeAttribute = function () { rec.removed++; };
  el.load = function () { rec.loaded++; };
  const realAdd = el.addEventListener.bind(el);
  el.addEventListener = function (name, fn, opts) {
    (rec.listeners[name] = rec.listeners[name] || []).push(fn);
    return realAdd(name, fn, opts);
  };
  return { el, rec };
}

/**
 * A fake host PlayerAdapter factory that records attach/destroy/onError calls.
 * `throwOnAttach` makes attach() throw (the containment test). `failVia` lets a
 * test drive the onError-registered handler to a reason.
 */
function fakePlayerFactory(opts) {
  const calls = { factory: [], attach: [], destroyed: 0, errorHandlers: [] };
  const o = opts || {};
  function factory(ctx) {
    calls.factory.push(ctx);
    return {
      attach(el, url, ctx2) {
        calls.attach.push({ el, url, ctx: ctx2 });
        if (o.throwOnAttach) throw new Error('factory-attach-boom');
      },
      destroy() { calls.destroyed++; },
      onError(cb) { calls.errorHandlers.push(cb); },
    };
  }
  return { factory, calls };
}

/** A stub Hls constructor (parent-realm) recording loadSource/attachMedia order. */
function stubHls() {
  const rec = { constructed: 0, ops: [], errorHandlers: [], lastConfig: null, destroyed: 0 };
  function Hls(config) {
    rec.constructed++;
    rec.lastConfig = config || null;
    this.loadSource = function (url) { rec.ops.push(['loadSource', url]); };
    this.attachMedia = function (el) { rec.ops.push(['attachMedia', el]); };
    this.on = function (evt, cb) { if (evt === Hls.Events.ERROR) rec.errorHandlers.push(cb); };
    this.destroy = function () { rec.destroyed++; };
  }
  Hls.isSupported = function () { return true; };
  Hls.Events = { ERROR: 'hlsError' };
  Hls.ErrorTypes = { KEY_SYSTEM_ERROR: 'keySystemError', MEDIA_ERROR: 'mediaError' };
  return { Hls, rec };
}

/** Recording onMediaUnavailable + showOverlay + a default deps bag. */
function playerDeps(env, over) {
  const o = over || {};
  const unavailable = [];
  const overlays = [];
  const win = o.win !== undefined ? o.win : env.window;
  const deps = {
    doc: env.document,
    win,
    // Default gate ALLOWS (the tests that need a block pass their own gate).
    gateAsset: o.gateAsset || function () { return { allow: true }; },
    logger: recordingLogger().logger,
    playerFactory: o.playerFactory, // undefined by default
    onMediaUnavailable(nid, reason) { unavailable.push({ nid, reason }); },
    showOverlay(kind, payload, ctx) { overlays.push({ kind, payload, ctx }); },
    resolveNidRect(nid) { return { top: 0, left: 0, width: 320, height: 180, nid }; },
    ensurePlaying() {},
    keepPoster() {},
  };
  if (Object.prototype.hasOwnProperty.call(o, 'tryLazyImportHls')) {
    deps.tryLazyImportHls = o.tryLazyImportHls;
  }
  return { deps, unavailable, overlays };
}

const M3U8 = 'https://cdn.example.test/master.m3u8';
const MPD = 'https://cdn.example.test/manifest.mpd';

test('native-HLS: canPlayType maybe on an .m3u8 sets videoEl.src and skips MSE/library', async () => {
  const { createMediaPlayer } = await import(MEDIA_PLAYER_MODULE);
  const env = setupEnv();
  try {
    const ms = installStubMediaSource(env.window); // present, but native must NOT mint a blob
    const { deps, unavailable, overlays } = playerDeps(env);
    const player = createMediaPlayer(deps);
    const { el, rec } = playerVideoStub(env.document, { 'application/vnd.apple.mpegurl': 'maybe' });
    const handle = player.attach(el, M3U8, { nid: '1' });
    assert.deepEqual(rec.srcProp, [M3U8], 'native branch sets videoEl.src = manifest');
    assert.equal(ms.created.length, 0, 'native branch mints NO MediaSource object URL');
    assert.equal(unavailable.length, 0, 'native branch does not degrade');
    assert.equal(overlays.length, 0, 'native branch shows no media-unavailable overlay');
    assert.ok(handle && handle.kind === 'native', 'returns a native handle');
  } finally {
    env.teardown();
  }
});

test('native-HLS: an empty canPlayType ("" unsupported) on an .m3u8 falls through to lazy/factory, not native', async () => {
  const { createMediaPlayer } = await import(MEDIA_PLAYER_MODULE);
  const env = setupEnv();
  try {
    installStubMediaSource(env.window);
    const fake = fakePlayerFactory();
    const { deps } = playerDeps(env, { playerFactory: fake.factory });
    const player = createMediaPlayer(deps);
    // canPlayType returns '' for the HLS MIME -> NOT native -> factory path.
    const { el, rec } = playerVideoStub(env.document, { 'application/vnd.apple.mpegurl': '' });
    player.attach(el, M3U8, { nid: '1' });
    assert.deepEqual(rec.srcProp, [], 'native branch did NOT fire (no src property set)');
    assert.equal(fake.calls.attach.length, 1, 'fell through to the host factory');
  } finally {
    env.teardown();
  }
});

test('factory: a provided playerFactory(ctx) is called and the handle.destroy tears it down', async () => {
  const { createMediaPlayer } = await import(MEDIA_PLAYER_MODULE);
  const env = setupEnv();
  try {
    const fake = fakePlayerFactory();
    const { deps } = playerDeps(env, { playerFactory: fake.factory });
    const player = createMediaPlayer(deps);
    // A non-native HLS element (canPlayType '') so the factory owns it.
    const { el } = playerVideoStub(env.document, {});
    const handle = player.attach(el, M3U8, { nid: '7' });
    assert.equal(fake.calls.factory.length, 1, 'playerFactory(ctx) constructed');
    assert.equal(fake.calls.attach.length, 1, 'factory.attach was called');
    assert.equal(fake.calls.attach[0].el, el, 'factory.attach received the videoEl');
    assert.equal(fake.calls.attach[0].url, M3U8, 'factory.attach received the manifestUrl');
    assert.ok(handle && handle.kind === 'factory', 'returns a factory handle');
    player.destroy('7');
    assert.equal(fake.calls.destroyed, 1, 'destroy(nid) tore down the host player');
  } finally {
    env.teardown();
  }
});

test('factory: a DASH (.mpd) manifest is routed to the host factory when provided', async () => {
  const { createMediaPlayer } = await import(MEDIA_PLAYER_MODULE);
  const env = setupEnv();
  try {
    const fake = fakePlayerFactory();
    const { deps } = playerDeps(env, { playerFactory: fake.factory });
    const player = createMediaPlayer(deps);
    const { el } = playerVideoStub(env.document, {});
    player.attach(el, MPD, { nid: '3' });
    assert.equal(fake.calls.attach.length, 1, 'DASH with a factory attaches via the host');
    assert.equal(fake.calls.attach[0].url, MPD, 'the .mpd url reached the factory');
  } finally {
    env.teardown();
  }
});

test('lazy-hls ABSENT: no factory, MSE present, import returns null -> degrade(no-player), no throw', async () => {
  const { createMediaPlayer } = await import(MEDIA_PLAYER_MODULE);
  const env = setupEnv();
  try {
    installStubMediaSource(env.window);
    const { deps, unavailable, overlays } = playerDeps(env, {
      tryLazyImportHls: async function () { return null; }, // hls.js absent
    });
    const player = createMediaPlayer(deps);
    const { el } = playerVideoStub(env.document, {}); // non-native HLS
    let threw = false;
    try {
      await player.attach(el, M3U8, { nid: '9' });
    } catch (e) { threw = true; }
    assert.equal(threw, false, 'attach() never throws when the lazy import fails');
    assert.deepEqual(unavailable, [{ nid: '9', reason: 'no-player' }], 'degrade(no-player) fired');
    assert.equal(overlays.length, 1, 'the media-unavailable overlay was shown');
    assert.equal(overlays[0].kind, 'media-unavailable', 'correct overlay kind');
  } finally {
    env.teardown();
  }
});

test('lazy-hls STUB present: loadSource(manifest) is called BEFORE attachMedia(el)', async () => {
  const { createMediaPlayer } = await import(MEDIA_PLAYER_MODULE);
  const env = setupEnv();
  try {
    installStubMediaSource(env.window);
    const { Hls, rec } = stubHls();
    const { deps, unavailable } = playerDeps(env, {
      tryLazyImportHls: async function () { return Hls; },
    });
    const player = createMediaPlayer(deps);
    const { el } = playerVideoStub(env.document, {}); // non-native HLS -> lazy path
    await player.attach(el, M3U8, { nid: '4' });
    assert.equal(rec.constructed, 1, 'the stub Hls was constructed');
    assert.deepEqual(
      rec.ops.map((o) => o[0]),
      ['loadSource', 'attachMedia'],
      'load-then-attach: loadSource precedes attachMedia'
    );
    assert.equal(rec.ops[0][1], M3U8, 'loadSource received the manifest url');
    assert.equal(rec.ops[1][1], el, 'attachMedia received the in-iframe element');
    assert.equal(unavailable.length, 0, 'a supported stub-hls path does not degrade');
  } finally {
    env.teardown();
  }
});

test('lazy-hls: emeEnabled is never set true (DRM playback is never attempted)', async () => {
  const { createMediaPlayer } = await import(MEDIA_PLAYER_MODULE);
  const env = setupEnv();
  try {
    installStubMediaSource(env.window);
    const { Hls, rec } = stubHls();
    const { deps } = playerDeps(env, { tryLazyImportHls: async function () { return Hls; } });
    const player = createMediaPlayer(deps);
    const { el } = playerVideoStub(env.document, {});
    await player.attach(el, M3U8, { nid: '4' });
    const cfg = rec.lastConfig || {};
    assert.notEqual(cfg.emeEnabled, true, 'emeEnabled must never be passed true');
  } finally {
    env.teardown();
  }
});

test('mse-opaque: kind hls, no MediaSource/ManagedMediaSource global -> degrade(mse-opaque)', async () => {
  const { createMediaPlayer } = await import(MEDIA_PLAYER_MODULE);
  const env = setupEnv();
  try {
    // A bare win with NO MediaSource and NO ManagedMediaSource.
    const bareWin = { document: env.document };
    const { deps, unavailable } = playerDeps(env, {
      win: bareWin,
      tryLazyImportHls: async function () { return stubHls().Hls; }, // would succeed if reached
    });
    const player = createMediaPlayer(deps);
    const { el } = playerVideoStub(env.document, {});
    await player.attach(el, M3U8, { nid: '5' });
    assert.deepEqual(unavailable, [{ nid: '5', reason: 'mse-opaque' }], 'no-MSE degrades mse-opaque');
  } finally {
    env.teardown();
  }
});

test('dash no-factory: classifyManifest dash with no playerFactory -> degrade(no-player)', async () => {
  const { createMediaPlayer } = await import(MEDIA_PLAYER_MODULE);
  const env = setupEnv();
  try {
    installStubMediaSource(env.window);
    const { deps, unavailable } = playerDeps(env); // no playerFactory
    const player = createMediaPlayer(deps);
    const { el } = playerVideoStub(env.document, {});
    await player.attach(el, MPD, { nid: '6' });
    assert.deepEqual(unavailable, [{ nid: '6', reason: 'no-player' }], 'DASH w/o factory degrades no-player');
  } finally {
    env.teardown();
  }
});

test('no-manifest: a gate-blocked manifest url -> degrade(no-manifest)', async () => {
  const { createMediaPlayer } = await import(MEDIA_PLAYER_MODULE);
  const env = setupEnv();
  try {
    const { deps, unavailable } = playerDeps(env, {
      gateAsset: function () { return { allow: false }; }, // blocked origin
    });
    const player = createMediaPlayer(deps);
    const { el, rec } = playerVideoStub(env.document, { 'application/vnd.apple.mpegurl': 'maybe' });
    await player.attach(el, M3U8, { nid: '2' });
    assert.deepEqual(unavailable, [{ nid: '2', reason: 'no-manifest' }], 'blocked gate degrades no-manifest');
    assert.deepEqual(rec.srcProp, [], 'a blocked manifest is never bound to the element');
  } finally {
    env.teardown();
  }
});

test('no-manifest: an unclassifiable manifest (no hls/dash) -> degrade(no-manifest)', async () => {
  const { createMediaPlayer } = await import(MEDIA_PLAYER_MODULE);
  const env = setupEnv();
  try {
    installStubMediaSource(env.window);
    const { deps, unavailable } = playerDeps(env);
    const player = createMediaPlayer(deps);
    const { el } = playerVideoStub(env.document, {});
    await player.attach(el, 'https://cdn.example.test/video.mp4', { nid: '8' });
    assert.deepEqual(unavailable, [{ nid: '8', reason: 'no-manifest' }], 'unhandled manifest degrades no-manifest');
  } finally {
    env.teardown();
  }
});

test('drm: dispatching an "encrypted" event on videoEl -> degrade(drm)', async () => {
  const { createMediaPlayer } = await import(MEDIA_PLAYER_MODULE);
  const env = setupEnv();
  try {
    installStubMediaSource(env.window);
    const { Hls } = stubHls();
    const { deps, unavailable } = playerDeps(env, { tryLazyImportHls: async function () { return Hls; } });
    const player = createMediaPlayer(deps);
    const { el } = playerVideoStub(env.document, {});
    await player.attach(el, M3U8, { nid: '4' });
    assert.equal(unavailable.length, 0, 'no degrade before the encrypted event');
    el.dispatchEvent(new env.window.Event('encrypted'));
    assert.deepEqual(unavailable, [{ nid: '4', reason: 'drm' }], 'the encrypted event degrades drm');
  } finally {
    env.teardown();
  }
});

test('drm: a fatal hls error with type KEY_SYSTEM_ERROR -> degrade(drm)', async () => {
  const { createMediaPlayer } = await import(MEDIA_PLAYER_MODULE);
  const env = setupEnv();
  try {
    installStubMediaSource(env.window);
    const { Hls, rec } = stubHls();
    const { deps, unavailable } = playerDeps(env, { tryLazyImportHls: async function () { return Hls; } });
    const player = createMediaPlayer(deps);
    const { el } = playerVideoStub(env.document, {});
    await player.attach(el, M3U8, { nid: '4' });
    assert.equal(rec.errorHandlers.length, 1, 'an ERROR handler was registered');
    rec.errorHandlers[0]({}, { fatal: true, type: Hls.ErrorTypes.KEY_SYSTEM_ERROR });
    assert.deepEqual(unavailable, [{ nid: '4', reason: 'drm' }], 'KEY_SYSTEM_ERROR degrades drm');
  } finally {
    env.teardown();
  }
});

test('hls error: a fatal non-DRM hls error -> degrade(mse-opaque); a non-fatal error is ignored', async () => {
  const { createMediaPlayer } = await import(MEDIA_PLAYER_MODULE);
  const env = setupEnv();
  try {
    installStubMediaSource(env.window);
    const { Hls, rec } = stubHls();
    const { deps, unavailable } = playerDeps(env, { tryLazyImportHls: async function () { return Hls; } });
    const player = createMediaPlayer(deps);
    const { el } = playerVideoStub(env.document, {});
    await player.attach(el, M3U8, { nid: '4' });
    rec.errorHandlers[0]({}, { fatal: false, type: Hls.ErrorTypes.MEDIA_ERROR });
    assert.equal(unavailable.length, 0, 'a non-fatal hls error does not degrade');
    rec.errorHandlers[0]({}, { fatal: true, type: Hls.ErrorTypes.MEDIA_ERROR });
    assert.deepEqual(unavailable, [{ nid: '4', reason: 'mse-opaque' }], 'a fatal non-DRM error degrades mse-opaque');
  } finally {
    env.teardown();
  }
});

test('containment: a playerFactory whose attach() throws -> degrade(mse-opaque), attach() never throws', async () => {
  const { createMediaPlayer } = await import(MEDIA_PLAYER_MODULE);
  const env = setupEnv();
  try {
    const fake = fakePlayerFactory({ throwOnAttach: true });
    const { deps, unavailable } = playerDeps(env, { playerFactory: fake.factory });
    const player = createMediaPlayer(deps);
    const { el } = playerVideoStub(env.document, {});
    let threw = false;
    try {
      player.attach(el, M3U8, { nid: '7' });
    } catch (e) { threw = true; }
    assert.equal(threw, false, 'attach() contains the factory throw (never rethrows)');
    assert.deepEqual(unavailable, [{ nid: '7', reason: 'mse-opaque' }], 'a throwing factory degrades mse-opaque');
  } finally {
    env.teardown();
  }
});

test('degrade tears down the bound element: removeAttribute(src) + load() guarded', async () => {
  const { createMediaPlayer } = await import(MEDIA_PLAYER_MODULE);
  const env = setupEnv();
  try {
    installStubMediaSource(env.window);
    const { Hls } = stubHls();
    const { deps } = playerDeps(env, { tryLazyImportHls: async function () { return Hls; } });
    const player = createMediaPlayer(deps);
    const { el, rec } = playerVideoStub(env.document, {});
    await player.attach(el, M3U8, { nid: '4' });
    el.dispatchEvent(new env.window.Event('encrypted')); // triggers degrade -> teardown
    assert.ok(rec.removed >= 1, 'degrade removed the child src attribute');
    assert.ok(rec.loaded >= 1, 'degrade called load() to reset the child element');
  } finally {
    env.teardown();
  }
});

test('destroyAll: tears down every live player (Plan 03 re-snapshot reset)', async () => {
  const { createMediaPlayer } = await import(MEDIA_PLAYER_MODULE);
  const env = setupEnv();
  try {
    const fake = fakePlayerFactory();
    const { deps } = playerDeps(env, { playerFactory: fake.factory });
    const player = createMediaPlayer(deps);
    const a = playerVideoStub(env.document, {});
    const b = playerVideoStub(env.document, {});
    player.attach(a.el, M3U8, { nid: 'A' });
    player.attach(b.el, M3U8, { nid: 'B' });
    assert.equal(fake.calls.attach.length, 2, 'two host players attached');
    player.destroyAll();
    assert.equal(fake.calls.destroyed, 2, 'destroyAll tore down both host players');
  } finally {
    env.teardown();
  }
});

test('module imports cleanly with hls.js absent (no top-level import of hls.js)', async () => {
  // The mere fact this import resolves (hls.js is NOT installed) proves there is
  // no eager top-level `import 'hls.js'` -- a top-level import would throw
  // ERR_MODULE_NOT_FOUND and break scripts/package-smoke.mjs (Plan 05).
  const mod = await import(MEDIA_PLAYER_MODULE);
  assert.equal(typeof mod.createMediaPlayer, 'function', 'createMediaPlayer is exported');
});

test('Wave 0: renderer-media-player harness boots (placeholder until Plan 02 implements media-player.js)', () => {
  const env = setupEnv();
  try {
    // The jsdom env is usable and exposes a mount container.
    assert.ok(env.window, 'jsdom window is constructed');
    assert.ok(env.document, 'jsdom document is constructed');
    assert.ok(env.mount, 'a mount container is present in the host document');

    // A recording logger is available for the contained-hook assertions Plan 03 adds.
    const rec = recordingLogger();
    assert.equal(typeof rec.logger.warn, 'function', 'recording logger exposes warn');
    assert.equal(typeof rec.logger.error, 'function', 'recording logger exposes error');

    // A stub MediaSource can be installed on the parent window (the parent-realm
    // global the MSE bind feature-detects). After install the branch guard
    // `win.ManagedMediaSource || win.MediaSource` is satisfiable.
    const ms = installStubMediaSource(env.window);
    assert.equal(typeof env.window.MediaSource, 'function', 'stub MediaSource installed on the window');
    const inst = new env.window.MediaSource();
    assert.ok(ms.constructed.indexOf(inst) !== -1, 'constructing the stub MediaSource is recorded');
    const objUrl = env.window.URL.createObjectURL(inst);
    assert.ok(/^blob:/.test(objUrl), 'the stub mints a blob: object URL for the bind path');

    // A video element stub returns a controllable canPlayType (the native-HLS
    // feature-detect input) and records the cross-realm src set.
    const { el, rec: videoRec } = stubVideoEl(env.document, { 'application/vnd.apple.mpegurl': 'maybe' });
    assert.equal(
      el.canPlayType('application/vnd.apple.mpegurl'),
      'maybe',
      'the video stub reports a controllable native-HLS canPlayType'
    );
    assert.equal(el.canPlayType('video/webm'), '', 'an unstubbed type returns the empty advisory string');
    el.setAttribute('src', 'https://cdn.example.test/master.m3u8');
    assert.deepEqual(
      videoRec.srcSets,
      ['https://cdn.example.test/master.m3u8'],
      'the harness records a cross-realm src set (native-HLS branch)'
    );
  } finally {
    env.teardown();
  }
});
