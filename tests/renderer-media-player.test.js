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
