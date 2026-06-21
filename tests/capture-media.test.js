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

// ===========================================================================
// Task 2: startMediaTracker/stopMediaTracker -- per-element listeners,
// immediate discrete events + throttled heartbeat, added-node + teardown
// ===========================================================================

/** STREAM.MEDIA messages recorded on a loopback transport. */
function mediaMsgs(transport) {
  return transport.sent.filter((m) => m.type === STREAM.MEDIA);
}

/**
 * Install a controllable Date.now on the jsdom window AND globalThis (capture
 * reads the ambient Date). Returns { advance, restore }. node:test mock.timers
 * does NOT move Date.now, so the throttle window needs a manual clock.
 */
function installClock(win, startMs) {
  let nowMs = startMs;
  const realGlobal = globalThis.Date;
  const realWin = win.Date;
  function FakeDate(...args) {
    if (args.length === 0) return new realGlobal(nowMs);
    return new realGlobal(...args);
  }
  FakeDate.now = () => nowMs;
  FakeDate.prototype = realGlobal.prototype;
  globalThis.Date = FakeDate;
  win.Date = FakeDate;
  return {
    advance(ms) { nowMs += ms; },
    set(ms) { nowMs = ms; },
    restore() { globalThis.Date = realGlobal; win.Date = realWin; },
  };
}

const DISCRETE_EVENTS = ['play', 'pause', 'seeked', 'ratechange', 'ended', 'volumechange', 'loadedmetadata'];

test('Task 2: each discrete media event emits exactly one STREAM.MEDIA immediately, nid-addressed + identity-stamped + sentAt-stamped (MWIRE-01)', async () => {
  const env = setupEnv('<video id="v"></video>');
  try {
    const v = env.document.getElementById('v');
    stubMedia(v, { currentTime: 7.5, paused: false, muted: false, volume: 1, playbackRate: 1.25, loop: false, ended: false, duration: 100 });

    const transport = createLoopbackTransport();
    env.capture = createCapture({ transport, logger: silentLogger() });
    env.capture.start();
    await settle(env.window);

    const before = mediaMsgs(transport).length;

    for (const evName of DISCRETE_EVENTS) {
      const countBefore = mediaMsgs(transport).length;
      v.dispatchEvent(new env.window.Event(evName));
      const after = mediaMsgs(transport);
      assert.equal(after.length, countBefore + 1, 'exactly one STREAM.MEDIA per "' + evName + '" event');
      const p = after[after.length - 1].payload;
      assert.equal(p.event, evName, 'payload carries the triggering event name');
      assert.ok(typeof p.nid === 'string' && p.nid.length > 0, 'payload is nid-addressed');
      assert.ok(env.capture.getNodeId(v) === p.nid, 'nid matches the tracked element');
      assert.equal(p.currentTime, 7.5, 'full state: currentTime');
      assert.equal(p.playbackRate, 1.25, 'full state: playbackRate');
      assert.equal(p.duration, 100, 'finite duration carried');
      assert.equal('live' in p, false, 'finite duration -> no live');
      assert.equal(typeof p.sentAt, 'number', 'sentAt monotonic stamp present');
      assert.match(p.streamSessionId, /^stream_[a-z0-9]+_[a-z0-9]+$/, 'identity: streamSessionId');
      assert.equal(typeof p.snapshotId, 'number', 'identity: snapshotId');
      assert.ok(p.snapshotId > 0);
    }

    assert.ok(mediaMsgs(transport).length === before + DISCRETE_EVENTS.length, 'one message per discrete event, no extras');
  } finally {
    env.teardown();
  }
});

test('Task 2: a live (non-finite duration) element encodes live:true and omits duration on the wire (Infinity->null trap, MWIRE-01)', async () => {
  const env = setupEnv('<audio id="a"></audio>');
  try {
    const a = env.document.getElementById('a');
    stubMedia(a, { currentTime: 0, paused: false, muted: true, volume: 1, playbackRate: 1, loop: false, ended: false, duration: Infinity });

    const transport = createLoopbackTransport();
    env.capture = createCapture({ transport, logger: silentLogger() });
    env.capture.start();
    await settle(env.window);

    a.dispatchEvent(new env.window.Event('play'));
    const msgs = mediaMsgs(transport);
    assert.ok(msgs.length >= 1, '<audio> emits STREAM.MEDIA (MEDIA-04 identical model)');
    const p = msgs[msgs.length - 1].payload;
    assert.equal(p.live, true, 'live stream -> live:true');
    assert.equal('duration' in p, false, 'live stream -> no duration field on the wire');
  } finally {
    env.teardown();
  }
});

test('Task 2: timeupdate is throttled at MEDIA_SYNC_THROTTLE_MS while playing -- two within the window send one, a third past it sends another (T-13-06 DoS mitigation)', async () => {
  const env = setupEnv('<video id="v"></video>');
  let clock;
  try {
    const v = env.document.getElementById('v');
    stubMedia(v, { currentTime: 1, paused: false, muted: false, volume: 1, playbackRate: 1, loop: false, ended: false, duration: 500 });

    const transport = createLoopbackTransport();
    env.capture = createCapture({ transport, logger: silentLogger() });
    env.capture.start();
    await settle(env.window);

    // Install the clock AFTER start() so the snapshot/lifecycle sends keep real time.
    clock = installClock(env.window, 1000000);
    const base = mediaMsgs(transport).length;

    // First timeupdate primes lastMediaSend at t0.
    v.dispatchEvent(new env.window.Event('timeupdate'));
    assert.equal(mediaMsgs(transport).length, base + 1, 'first timeupdate sends');

    // Second timeupdate within the throttle window: suppressed.
    clock.advance(MEDIA_SYNC_THROTTLE_MS - 1);
    v.dispatchEvent(new env.window.Event('timeupdate'));
    assert.equal(mediaMsgs(transport).length, base + 1, 'second timeupdate inside the window is throttled (no send)');

    // Third timeupdate after advancing past the window: sends again.
    clock.advance(2);
    v.dispatchEvent(new env.window.Event('timeupdate'));
    assert.equal(mediaMsgs(transport).length, base + 2, 'timeupdate past the throttle window sends');
  } finally {
    if (clock) clock.restore();
    env.teardown();
  }
});

test('Task 2: timeupdate sends NOTHING while the element is paused (heartbeat is playing-only)', async () => {
  const env = setupEnv('<video id="v"></video>');
  try {
    const v = env.document.getElementById('v');
    stubMedia(v, { currentTime: 5, paused: true, muted: false, volume: 1, playbackRate: 1, loop: false, ended: false, duration: 500 });

    const transport = createLoopbackTransport();
    env.capture = createCapture({ transport, logger: silentLogger() });
    env.capture.start();
    await settle(env.window);

    const base = mediaMsgs(transport).length;
    v.dispatchEvent(new env.window.Event('timeupdate'));
    v.dispatchEvent(new env.window.Event('timeupdate'));
    assert.equal(mediaMsgs(transport).length, base, 'no STREAM.MEDIA from timeupdate while paused');
  } finally {
    env.teardown();
  }
});

test('Task 2: a mutation-added <video> AND a mutation-added <audio> both receive listeners (added-node coverage, MEDIA-04)', async () => {
  const env = setupEnv('<div id="root"></div>');
  try {
    const transport = createLoopbackTransport();
    env.capture = createCapture({ transport, logger: silentLogger() });
    env.capture.start();
    await settle(env.window);

    const root = env.document.getElementById('root');
    const addedVideo = env.document.createElement('video');
    const addedAudio = env.document.createElement('audio');
    root.appendChild(addedVideo);
    root.appendChild(addedAudio);
    await settle(env.window); // MutationObserver delivers the addedNodes

    stubMedia(addedVideo, { currentTime: 2, paused: false, muted: true, volume: 1, playbackRate: 1, loop: false, ended: false, duration: 50 });
    stubMedia(addedAudio, { currentTime: 4, paused: false, muted: true, volume: 1, playbackRate: 1, loop: false, ended: false, duration: 70 });

    const beforeV = mediaMsgs(transport).length;
    addedVideo.dispatchEvent(new env.window.Event('play'));
    assert.equal(mediaMsgs(transport).length, beforeV + 1, 'mutation-added <video> is tracked');
    const pv = mediaMsgs(transport).pop().payload;
    assert.ok(env.capture.getNodeId(addedVideo) === pv.nid, 'added <video> payload nid matches');

    const beforeA = mediaMsgs(transport).length;
    addedAudio.dispatchEvent(new env.window.Event('play'));
    assert.equal(mediaMsgs(transport).length, beforeA + 1, 'mutation-added <audio> is tracked');
    const pa = mediaMsgs(transport).pop().payload;
    assert.ok(env.capture.getNodeId(addedAudio) === pa.nid, 'added <audio> payload nid matches');
  } finally {
    env.teardown();
  }
});

test('Task 2: after stop() and after pause(), dispatching events on a previously-tracked element emits NOTHING (listeners torn down)', async () => {
  const env = setupEnv('<video id="v"></video>');
  try {
    const v = env.document.getElementById('v');
    stubMedia(v, { currentTime: 9, paused: false, muted: false, volume: 1, playbackRate: 1, loop: false, ended: false, duration: 80 });

    const transport = createLoopbackTransport();
    env.capture = createCapture({ transport, logger: silentLogger() });
    env.capture.start();
    await settle(env.window);

    // Sanity: tracked while streaming.
    const live = mediaMsgs(transport).length;
    v.dispatchEvent(new env.window.Event('play'));
    assert.equal(mediaMsgs(transport).length, live + 1, 'tracked while streaming');

    // After pause(): listeners removed.
    env.capture.pause();
    const afterPauseBase = mediaMsgs(transport).length;
    v.dispatchEvent(new env.window.Event('play'));
    v.dispatchEvent(new env.window.Event('seeked'));
    assert.equal(mediaMsgs(transport).length, afterPauseBase, 'no STREAM.MEDIA after pause() (listeners detached)');

    // Resume re-arms, then stop() tears down again.
    env.capture.resume();
    await settle(env.window);
    env.capture.stop();
    const afterStopBase = mediaMsgs(transport).length;
    v.dispatchEvent(new env.window.Event('play'));
    assert.equal(mediaMsgs(transport).length, afterStopBase, 'no STREAM.MEDIA after stop() (listeners detached)');
  } finally {
    env.teardown();
  }
});

test('Task 2: a removed element\'s listeners are detached -- events on it after removal emit nothing', async () => {
  const env = setupEnv('<div id="root"><video id="v"></video></div>');
  try {
    const v = env.document.getElementById('v');
    stubMedia(v, { currentTime: 3, paused: false, muted: false, volume: 1, playbackRate: 1, loop: false, ended: false, duration: 40 });

    const transport = createLoopbackTransport();
    env.capture = createCapture({ transport, logger: silentLogger() });
    env.capture.start();
    await settle(env.window);

    const live = mediaMsgs(transport).length;
    v.dispatchEvent(new env.window.Event('play'));
    assert.equal(mediaMsgs(transport).length, live + 1, 'tracked while present');

    // Remove the element from the live DOM; the MutationObserver removal path
    // must detach its media listeners.
    v.parentNode.removeChild(v);
    await settle(env.window);

    const afterRemoval = mediaMsgs(transport).length;
    v.dispatchEvent(new env.window.Event('play'));
    assert.equal(mediaMsgs(transport).length, afterRemoval, 'no STREAM.MEDIA after element removal (listeners detached)');
  } finally {
    env.teardown();
  }
});

// ===========================================================================
// WR-01: host-excluded (skipElement) media is neither baselined nor tracked
// ===========================================================================

test('WR-01: a skipElement-excluded <video> emits NO media[] baseline entry (parity with the value tracker)', () => {
  // Use createCapture directly so a skipElement predicate can be supplied (the
  // bare serializeSnapshot(doc) helper builds a default-options capture). The
  // ambient globals are installed via setupEnv so capture.serializeSnapshot()
  // sees the jsdom realm.
  const env = setupEnv('<div id="host-ui"><video id="skipped"></video></div><video id="tracked"></video>');
  try {
    const skipped = env.document.getElementById('skipped');
    const tracked = env.document.getElementById('tracked');
    stubMedia(skipped, { currentTime: 9, paused: false, muted: false, volume: 1, playbackRate: 1, loop: false, ended: false, duration: 50 });
    stubMedia(tracked, { currentTime: 4, paused: true, muted: false, volume: 1, playbackRate: 1, loop: false, ended: false, duration: 80 });

    // skipElement excludes the host-UI subtree (the same predicate that excludes
    // a same-page loopback viewer mirror).
    env.capture = createCapture({
      transport: { send() {} },
      logger: silentLogger(),
      skipElement(el) { return el && el.id === 'host-ui'; },
    });
    const payload = env.capture.serializeSnapshot();

    assert.ok(Array.isArray(payload.media), 'snapshot still carries a media[] array for the non-excluded element');
    assert.equal(payload.media.length, 1, 'only the non-excluded <video> is baselined');
    assert.equal(payload.media[0].currentTime, 4, 'the surviving baseline entry is the tracked (non-skipped) element');
  } finally {
    env.teardown();
  }
});

test('WR-01: a skipElement-excluded <video> emits NO STREAM.MEDIA frames (wire never leaks excluded host-UI playback)', async () => {
  const env = setupEnv('<div id="host-ui"><video id="skipped"></video></div><video id="tracked"></video>');
  try {
    const skipped = env.document.getElementById('skipped');
    const tracked = env.document.getElementById('tracked');
    stubMedia(skipped, { currentTime: 9, paused: false, muted: false, volume: 1, playbackRate: 1, loop: false, ended: false, duration: 50 });
    stubMedia(tracked, { currentTime: 4, paused: false, muted: false, volume: 1, playbackRate: 1, loop: false, ended: false, duration: 80 });

    const transport = createLoopbackTransport();
    env.capture = createCapture({
      transport,
      logger: silentLogger(),
      skipElement(el) { return el && el.id === 'host-ui'; },
    });
    env.capture.start();
    await settle(env.window);

    // Discrete events on the EXCLUDED element must produce no STREAM.MEDIA.
    const beforeSkipped = mediaMsgs(transport).length;
    for (const evName of DISCRETE_EVENTS) skipped.dispatchEvent(new env.window.Event(evName));
    assert.equal(mediaMsgs(transport).length, beforeSkipped, 'no STREAM.MEDIA from a skipElement-excluded <video>');

    // The non-excluded element is still tracked (the gate is targeted, not a
    // blanket media kill).
    const beforeTracked = mediaMsgs(transport).length;
    tracked.dispatchEvent(new env.window.Event('play'));
    assert.equal(mediaMsgs(transport).length, beforeTracked + 1, 'the non-excluded <video> still emits STREAM.MEDIA');
  } finally {
    env.teardown();
  }
});

// ===========================================================================
// MSEC-03: maskMediaSelector-/blockSelector-matched media emits NO state
// (twin of the WR-01 skipElement tests above -- swap the predicate; the masked
// media also degrades to the dimension-only block placeholder on the wire).
// ===========================================================================

test('MSEC-03: a maskMediaSelector-matched <video> emits NO media[] baseline entry (control <video> unaffected)', () => {
  const env = setupEnv('<video id="secret-clip"></video><video id="tracked"></video>');
  try {
    const secret = env.document.getElementById('secret-clip');
    const tracked = env.document.getElementById('tracked');
    stubMedia(secret, { currentTime: 9, paused: false, muted: false, volume: 1, playbackRate: 1, loop: false, ended: false, duration: 50 });
    stubMedia(tracked, { currentTime: 4, paused: true, muted: false, volume: 1, playbackRate: 1, loop: false, ended: false, duration: 80 });

    env.capture = createCapture({
      transport: { send() {} },
      logger: silentLogger(),
      maskMediaSelector: '#secret-clip',
    });
    const payload = env.capture.serializeSnapshot();

    assert.ok(Array.isArray(payload.media), 'snapshot still carries a media[] array for the non-masked element');
    assert.equal(payload.media.length, 1, 'only the non-masked <video> is baselined');
    assert.equal(payload.media[0].currentTime, 4, 'the surviving baseline entry is the tracked (non-masked) element');
  } finally {
    env.teardown();
  }
});

test('MSEC-03: a maskMediaSelector-matched <video> emits NO STREAM.MEDIA frames; the control <video> still emits', async () => {
  const env = setupEnv('<video id="secret-clip"></video><video id="tracked"></video>');
  try {
    const secret = env.document.getElementById('secret-clip');
    const tracked = env.document.getElementById('tracked');
    stubMedia(secret, { currentTime: 9, paused: false, muted: false, volume: 1, playbackRate: 1, loop: false, ended: false, duration: 50 });
    stubMedia(tracked, { currentTime: 4, paused: false, muted: false, volume: 1, playbackRate: 1, loop: false, ended: false, duration: 80 });

    const transport = createLoopbackTransport();
    env.capture = createCapture({
      transport,
      logger: silentLogger(),
      maskMediaSelector: '#secret-clip',
    });
    env.capture.start();
    await settle(env.window);

    // Discrete + timeupdate events on the MASKED element must produce nothing.
    const beforeMasked = mediaMsgs(transport).length;
    for (const evName of DISCRETE_EVENTS) secret.dispatchEvent(new env.window.Event(evName));
    secret.dispatchEvent(new env.window.Event('timeupdate'));
    assert.equal(mediaMsgs(transport).length, beforeMasked, 'no STREAM.MEDIA from a maskMediaSelector-matched <video>');

    // The non-masked element is still tracked (targeted gate, not a media kill).
    const beforeTracked = mediaMsgs(transport).length;
    tracked.dispatchEvent(new env.window.Event('play'));
    assert.equal(mediaMsgs(transport).length, beforeTracked + 1, 'the non-masked <video> still emits STREAM.MEDIA');
  } finally {
    env.teardown();
  }
});

test('MSEC-03: a blockSelector-matched <video> emits NO STREAM.MEDIA and NO media[] entry (pins the shipped block path for media)', async () => {
  const env = setupEnv('<video id="blocked-clip"></video><video id="tracked"></video>');
  try {
    const blocked = env.document.getElementById('blocked-clip');
    const tracked = env.document.getElementById('tracked');
    stubMedia(blocked, { currentTime: 9, paused: false, muted: false, volume: 1, playbackRate: 1, loop: false, ended: false, duration: 50 });
    stubMedia(tracked, { currentTime: 4, paused: false, muted: false, volume: 1, playbackRate: 1, loop: false, ended: false, duration: 80 });

    const transport = createLoopbackTransport();
    env.capture = createCapture({
      transport,
      logger: silentLogger(),
      blockSelector: '#blocked-clip',
    });
    env.capture.start();
    await settle(env.window);

    // No media[] baseline entry for the blocked element.
    const snap = transport.sent.find((m) => m.type === STREAM.SNAPSHOT).payload;
    assert.ok(Array.isArray(snap.media), 'snapshot carries a media[] array');
    assert.equal(snap.media.length, 1, 'only the non-blocked <video> is baselined');
    assert.equal(snap.media[0].currentTime, 4, 'the surviving baseline entry is the non-blocked element');

    // No STREAM.MEDIA from the blocked element.
    const beforeBlocked = mediaMsgs(transport).length;
    for (const evName of DISCRETE_EVENTS) blocked.dispatchEvent(new env.window.Event(evName));
    assert.equal(mediaMsgs(transport).length, beforeBlocked, 'no STREAM.MEDIA from a blockSelector-matched <video>');
  } finally {
    env.teardown();
  }
});

test('MSEC-03: a maskMediaSelector-matched <video> degrades to the dimension-only block placeholder on the wire (no src, no media identity)', () => {
  const env = setupEnv('<video id="secret-clip" src="https://cdn.example.com/secret.mp4"></video><video id="tracked"></video>');
  try {
    const secret = env.document.getElementById('secret-clip');
    // Give the masked element a concrete live rect so the placeholder carries
    // dimensions (jsdom returns zeros otherwise).
    secret.getBoundingClientRect = () => ({ width: 320, height: 240, top: 0, left: 0, right: 320, bottom: 240, x: 0, y: 0 });

    env.capture = createCapture({
      transport: { send() {} },
      logger: silentLogger(),
      maskMediaSelector: '#secret-clip',
    });
    const payload = env.capture.serializeSnapshot();

    assert.ok(payload.html.indexOf('https://cdn.example.com/secret.mp4') === -1,
      'the masked media URL never appears on the wire');
    // The placeholder is a dimension-only <div> (createBlockPlaceholder): the
    // masked <video> is replaced, so no <video id="secret-clip"> survives.
    const tpl = env.document.createElement('template');
    tpl.innerHTML = payload.html;
    assert.equal(tpl.content.querySelector('#secret-clip'), null,
      'the masked <video> is replaced by the placeholder (no surviving media element / identity attr)');
    assert.ok(tpl.content.querySelector('[rr_width="320px"]'),
      'the placeholder carries the live dimensions (rr_width)');
    assert.ok(tpl.content.querySelector('[rr_height="240px"]'),
      'the placeholder carries the live dimensions (rr_height)');
  } finally {
    env.teardown();
  }
});
