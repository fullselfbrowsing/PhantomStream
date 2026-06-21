// Capture-side media tracking tests (Phase 13 Plan 02): the media[] snapshot
// baseline (MEDIA-02) and the STREAM.MEDIA event/heartbeat side channel
// (MWIRE-01), proving <audio> is tracked by the identical model as <video>
// (MEDIA-04).
//
// Two slices, both jsdom:
//   Task 1 -- serializeDOM appends a media[] baseline keyed by nid, with the
//     Infinity->null-safe duration|live encoding, WITHOUT writing media state
//     into the serialized HTML clone or onto the live page (Phase 7 no-mutation
//     invariant + differential-oracle HTML byte-identity).
//   Task 2 -- startMediaTracker attaches PER-ELEMENT listeners (media events do
//     NOT bubble): discrete events emit one STREAM.MEDIA immediately; timeupdate
//     is throttled at MEDIA_SYNC_THROTTLE_MS and suppressed while paused;
//     mutation-added <video> AND <audio> are tracked; stop()/pause()/removal
//     tears listeners down. Every payload is nid-addressed + identity-stamped
//     + sentAt-stamped.
//
// jsdom realities baked in (13-RESEARCH probe): play()/load() are no-ops and
// the timeline never advances, currentTime/paused/duration are not driven by a
// real resource -- so we stub them with Object.defineProperty and dispatch
// synthetic media Events. The throttle window is exercised with a manual clock
// over Date.now (node:test mock.timers does NOT advance Date.now()).
//
// Globals recipe + setup/teardown/settle are duplicated locally (parallel-safe;
// this file imports nothing from any shared harness) -- mirrors
// tests/capture-lifecycle.test.js Pattern 2/3.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM, VirtualConsole } from 'jsdom';
import { createCapture, serializeSnapshot } from '../src/capture/index.js';
import { STREAM } from '../src/protocol/messages.js';
import { MEDIA_SYNC_THROTTLE_MS } from '../src/protocol/constants.js';

// Complete global set the capture core dereferences (audited from the reference
// source in 01-RESEARCH.md Pattern 2; identical list to capture-lifecycle).
const AUDITED_GLOBALS = [
  'window', 'document', 'Node', 'NodeFilter', 'MutationObserver',
  'requestAnimationFrame', 'cancelAnimationFrame', 'CustomEvent',
  'ShadowRoot', 'location', 'getComputedStyle', 'URL',
];

/**
 * Stub the playback-state properties capture reads off a media element. jsdom
 * leaves these undefined/non-advancing, so every test that asserts a concrete
 * baseline/payload value must define them. Each is configurable so a later
 * defineProperty in the same test can re-stub (e.g. flip paused).
 * @param {HTMLMediaElement} el
 * @param {Object} state
 */
function stubMedia(el, state) {
  const props = ['currentTime', 'paused', 'muted', 'volume', 'playbackRate', 'loop', 'ended', 'duration'];
  for (const p of props) {
    if (!(p in state)) continue;
    let v = state[p];
    Object.defineProperty(el, p, {
      configurable: true,
      get() { return v; },
      set(next) { v = next; },
    });
  }
}

/**
 * Build a fresh JSDOM, install its globals on globalThis (recording prior
 * state), and return an env whose teardown stops capture, restores every
 * global exactly, and closes the window. Mirrors capture-lifecycle setupEnv.
 * @param {string} bodyHtml
 */
function setupEnv(bodyHtml, pageUrl = 'https://fixture.test/page') {
  const dom = new JSDOM(
    '<!DOCTYPE html><html><head><title>media fixture</title></head><body>'
      + (bodyHtml || '') + '</body></html>',
    {
      url: pageUrl,
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
      } catch (e) { /* already stopped */ }
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

/** Settle MutationObserver microtask -> rAF flush -> async send. */
async function settle(win) {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => win.requestAnimationFrame(resolve));
  await new Promise((resolve) => setTimeout(resolve, 20));
}

/** Loopback transport recording every (type, payload). */
function createLoopbackTransport() {
  const sent = [];
  return { sent, send(type, payload) { sent.push({ type, payload }); } };
}

function silentLogger() {
  return { info() {}, warn() {}, error() {} };
}

// ===========================================================================
// Task 1: media[] snapshot baseline in serializeDOM
// ===========================================================================

test('Task 1: serializeDOM appends a media[] entry per <video>/<audio>, nid-keyed with full state (MEDIA-02, MEDIA-04)', () => {
  const dom = new JSDOM(
    '<!DOCTYPE html><html><body>'
      + '<video id="v"></video><audio id="a"></audio>'
      + '</body></html>',
    { url: 'https://fixture.test/page' }
  );
  const doc = dom.window.document;
  const v = doc.getElementById('v');
  const a = doc.getElementById('a');
  stubMedia(v, { currentTime: 12.5, paused: false, muted: true, volume: 0.5, playbackRate: 1.5, loop: false, ended: false, duration: 120 });
  stubMedia(a, { currentTime: 3, paused: true, muted: false, volume: 1, playbackRate: 1, loop: true, ended: false, duration: 200 });

  const payload = serializeSnapshot(doc);

  assert.ok(Array.isArray(payload.media), 'snapshot payload carries a media[] array');
  assert.equal(payload.media.length, 2, 'one entry per tracked <video>/<audio>');

  // Entries are nid-keyed; the nids must be the same ones the snapshot assigned
  // to those elements (present in payload.nodeIds).
  const byNidPresentInSidecar = payload.media.every((m) => payload.nodeIds.includes(m.nid));
  assert.ok(byNidPresentInSidecar, 'each media nid matches a tracked snapshot nid');

  const ve = payload.media.find((m) => m.currentTime === 12.5);
  const ae = payload.media.find((m) => m.currentTime === 3);
  assert.ok(ve && ae, 'both the video and audio entries are present');

  // Full per-element shape (video).
  assert.equal(ve.paused, false);
  assert.equal(ve.muted, true);
  assert.equal(ve.volume, 0.5);
  assert.equal(ve.playbackRate, 1.5);
  assert.equal(ve.loop, false);
  assert.equal(ve.ended, false);
  assert.equal(ve.duration, 120, 'finite duration carried through');

  // <audio> uses the identical entry shape as <video> (MEDIA-04).
  assert.equal(ae.paused, true);
  assert.equal(ae.loop, true);
  assert.equal(ae.duration, 200);

  dom.window.close();
});

test('Task 1: payload.html and the live DOM are byte-unchanged by serializeDOM -- no media state in markup, no page mutation (T-13-04, Phase 7 invariant)', () => {
  const dom = new JSDOM(
    '<!DOCTYPE html><html><body>'
      + '<video id="v"></video><audio id="a"></audio>'
      + '</body></html>',
    { url: 'https://fixture.test/page' }
  );
  const doc = dom.window.document;
  const v = doc.getElementById('v');
  const a = doc.getElementById('a');
  stubMedia(v, { currentTime: 42.25, paused: false, muted: false, volume: 1, playbackRate: 2, loop: false, ended: true, duration: 90 });
  stubMedia(a, { currentTime: 1.5, paused: true, muted: true, volume: 0.2, playbackRate: 1, loop: false, ended: false, duration: 60 });

  const vBefore = v.outerHTML;
  const aBefore = a.outerHTML;

  const payload = serializeSnapshot(doc);

  // The live elements gained NO new attribute (no currentTime/paused/etc baked on).
  assert.equal(v.outerHTML, vBefore, 'live <video> outerHTML unchanged by serializeDOM');
  assert.equal(a.outerHTML, aBefore, 'live <audio> outerHTML unchanged by serializeDOM');

  // The serialized clone HTML carries NO media-state attribute.
  for (const banned of ['currenttime', 'playbackrate', 'data-ps-media', 'paused=', 'ended=']) {
    assert.ok(
      payload.html.toLowerCase().indexOf(banned) === -1,
      'serialized html must not bake media state attribute: ' + banned
    );
  }

  dom.window.close();
});

test('Task 1: finite duration -> entry.duration set + NO live; non-finite (Infinity) duration -> entry.live === true + NO duration (Infinity->null trap closed, T-13 Pitfall 2)', () => {
  const dom = new JSDOM(
    '<!DOCTYPE html><html><body>'
      + '<video id="vod"></video><video id="livestream"></video>'
      + '</body></html>',
    { url: 'https://fixture.test/page' }
  );
  const doc = dom.window.document;
  const vod = doc.getElementById('vod');
  const live = doc.getElementById('livestream');
  stubMedia(vod, { currentTime: 0, paused: true, muted: false, volume: 1, playbackRate: 1, loop: false, ended: false, duration: 300 });
  stubMedia(live, { currentTime: 0, paused: false, muted: true, volume: 1, playbackRate: 1, loop: false, ended: false, duration: Infinity });

  const payload = serializeSnapshot(doc);
  assert.equal(payload.media.length, 2);

  const vodEntry = payload.media.find((m) => m.duration === 300);
  assert.ok(vodEntry, 'VOD entry carries finite duration');
  assert.equal('live' in vodEntry, false, 'finite-duration entry has NO live field');

  const liveEntry = payload.media.find((m) => m.live === true);
  assert.ok(liveEntry, 'live entry carries live:true');
  assert.equal('duration' in liveEntry, false, 'live entry has NO duration field (would JSON->null)');

  dom.window.close();
});
