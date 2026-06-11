// Wire-shape tests for the capture-side overlay key forwarding edit
// (Phase 2 plan 02-02 Task 2; 02-RESEARCH.md Open Question 2, resolved):
// broadcastOverlayState must forward EVERY own enumerable key the
// overlayProvider returns as an overlay kind on the STREAM.OVERLAY wire
// (VIEW-04 custom DOM-anchored overlays), under three hard constraints:
//
//   1. ORACLE PROTECTION -- with no provider (or a throwing provider) the
//      message stays byte-compatible with the reference wire shape:
//      exactly { glow: null, progress: null, streamSessionId, snapshotId }.
//      No differential fixture configures an overlayProvider, so this is
//      what keeps the Phase 1 differential oracle green.
//   2. Built-in defaults -- glow/progress still default null when the
//      provider omits them (the viewer's null-hides contract relies on the
//      keys always being present).
//   3. IDENTITY RESERVATION (threat T-02-06) -- streamSessionId/snapshotId
//      are assigned LAST, so provider keys can never spoof stream identity.
//
// Helpers (setupEnv globals swap, settle, recording loopback transport,
// silent logger) are deliberately duplicated locally per the parallel-safe
// convention (tests/capture-skip.test.js:17-20 -- this file imports nothing
// from any shared test harness).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM, VirtualConsole } from 'jsdom';
import { createCapture } from '../src/capture/index.js';
import { STREAM } from '../src/protocol/messages.js';

// Complete global set the capture core dereferences (audited from the
// reference source in 01-RESEARCH.md Pattern 2).
const AUDITED_GLOBALS = [
  'window', 'document', 'Node', 'NodeFilter', 'MutationObserver',
  'requestAnimationFrame', 'cancelAnimationFrame', 'CustomEvent',
  'ShadowRoot', 'location', 'getComputedStyle', 'URL',
];

const BODY_HTML = '<div id="root"><div id="content">tracked text</div></div>';

/**
 * Build a fresh JSDOM instance, install its globals on globalThis (recording
 * prior state), and return an env whose teardown stops the capture, restores
 * every global exactly, and closes the window.
 * @param {string} bodyHtml
 */
function setupEnv(bodyHtml) {
  const dom = new JSDOM(
    '<!DOCTYPE html><html><head><title>overlay-forward fixture</title></head><body>'
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
      // clears the self-re-arming watchdog setTimeout chain.
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

/** Loopback transport: records every (type, payload) pair. */
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

/** All STREAM.OVERLAY messages recorded by the transport. */
function overlayMessages(transport) {
  return transport.sent.filter((m) => m.type === STREAM.OVERLAY);
}

test('with no overlayProvider the OVERLAY wire shape is exactly the reference default', () => {
  const env = setupEnv(BODY_HTML);
  try {
    const transport = createLoopbackTransport();
    env.capture = createCapture({ transport, logger: silentLogger() });
    env.capture.start(); // start() force-broadcasts overlay state once

    const overlays = overlayMessages(transport);
    assert.ok(overlays.length >= 1, 'start() emits at least one OVERLAY message');
    for (const msg of overlays) {
      // Byte-compatible reference shape: exactly these four keys, glow and
      // progress both null. This is the differential-oracle protection.
      assert.deepEqual(
        Object.keys(msg.payload).sort(),
        ['glow', 'progress', 'snapshotId', 'streamSessionId'],
        'no-provider payload carries exactly the four reference keys'
      );
      assert.equal(Object.keys(msg.payload).length, 4, 'key count is exactly 4');
      assert.equal(msg.payload.glow, null, 'glow defaults null');
      assert.equal(msg.payload.progress, null, 'progress defaults null');
      assert.equal(typeof msg.payload.streamSessionId, 'string', 'identity string present');
      assert.equal(typeof msg.payload.snapshotId, 'number', 'identity number present');
    }
  } finally {
    env.teardown();
  }
});

test('custom provider keys are forwarded while absent built-ins still default null', () => {
  const env = setupEnv(BODY_HTML);
  try {
    const transport = createLoopbackTransport();
    env.capture = createCapture({
      transport,
      logger: silentLogger(),
      // Provider returns ONLY a custom kind: glow/progress are omitted.
      overlayProvider: () => ({ badge: { nid: 7, text: 'hi' } }),
    });
    env.capture.start();

    const overlays = overlayMessages(transport);
    assert.ok(overlays.length >= 1, 'start() emits at least one OVERLAY message');
    const payload = overlays[0].payload;
    assert.deepEqual(payload.badge, { nid: 7, text: 'hi' }, 'custom kind reaches the wire verbatim');
    assert.equal(payload.glow, null, 'omitted glow still defaults null');
    assert.equal(payload.progress, null, 'omitted progress still defaults null');
    assert.deepEqual(
      Object.keys(payload).sort(),
      ['badge', 'glow', 'progress', 'snapshotId', 'streamSessionId'],
      'payload carries the custom kind plus the four reference keys'
    );
  } finally {
    env.teardown();
  }
});

test('provider keys can never overwrite stream identity (T-02-06)', () => {
  const env = setupEnv(BODY_HTML);
  try {
    const transport = createLoopbackTransport();
    env.capture = createCapture({
      transport,
      logger: silentLogger(),
      // Hostile/buggy provider tries to spoof identity alongside real keys.
      overlayProvider: () => ({
        glow: { state: 'active', x: 1, y: 2, w: 3, h: 4 },
        custom1: 1,
        streamSessionId: 'attacker',
        snapshotId: -999,
      }),
    });
    env.capture.start();

    // The session identity minted by start() is what the snapshot carries.
    const snapshots = transport.sent.filter((m) => m.type === STREAM.SNAPSHOT);
    assert.equal(snapshots.length, 1, 'start() emits exactly one snapshot');
    const sessionId = snapshots[0].payload.streamSessionId;
    const snapshotId = snapshots[0].payload.snapshotId;
    assert.ok(sessionId && sessionId !== 'attacker', 'fixture sanity: real session id minted');

    const overlays = overlayMessages(transport);
    assert.ok(overlays.length >= 1, 'start() emits at least one OVERLAY message');
    const payload = overlays[0].payload;
    assert.equal(payload.streamSessionId, sessionId,
      'identity keys are assigned last -- the spoofed streamSessionId is overwritten');
    assert.notEqual(payload.streamSessionId, 'attacker', 'spoofed session id never reaches the wire');
    assert.equal(payload.snapshotId, snapshotId, 'spoofed snapshotId is overwritten too');
    // Non-identity provider keys still flow.
    assert.deepEqual(payload.glow, { state: 'active', x: 1, y: 2, w: 3, h: 4 }, 'provider glow forwarded');
    assert.equal(payload.custom1, 1, 'custom kind forwarded alongside built-ins');
  } finally {
    env.teardown();
  }
});

test('a throwing overlayProvider yields the default reference wire shape', () => {
  const env = setupEnv(BODY_HTML);
  try {
    const transport = createLoopbackTransport();
    env.capture = createCapture({
      transport,
      logger: silentLogger(),
      overlayProvider: () => { throw new TypeError('provider-blew-up'); },
    });

    // Provider errors are swallowed exactly like the reference: start()
    // must not throw and the broadcast still goes out with defaults.
    assert.doesNotThrow(() => env.capture.start(), 'provider errors never escape');

    const overlays = overlayMessages(transport);
    assert.ok(overlays.length >= 1, 'OVERLAY message still emitted after the provider threw');
    const payload = overlays[0].payload;
    assert.deepEqual(
      Object.keys(payload).sort(),
      ['glow', 'progress', 'snapshotId', 'streamSessionId'],
      'throwing provider degrades to the exact reference shape'
    );
    assert.equal(payload.glow, null, 'glow null after provider error');
    assert.equal(payload.progress, null, 'progress null after provider error');
  } finally {
    env.teardown();
  }
});
