// Lifecycle semantics tests for the extracted capture core (CAPT-02) plus
// transport-error containment (D-07).
//
// Pins the behavioral contracts of createCapture's {start, stop, pause,
// resume} surface so future refactors (the deferred module split, the Phase 7
// identity rework) cannot silently change lifecycle semantics:
//   - stop() -> start() mints a FRESH session (new streamSessionId AND new
//     snapshotId), matching the reference implementation.
//   - resume() continues the SAME streamSessionId/snapshotId and emits NO
//     snapshot (D-06 USER OVERRIDE, divergence-ledger entry D1); mutations
//     occurring while paused are missed by design (host contract).
//   - Transport errors route to the injected logger and never propagate into
//     the capture path; transport.flush is optional with a no-op default.
//
// The setup/teardown and settle helpers are deliberately duplicated locally
// (parallel-safe: this file imports nothing from any shared test harness).
// Globals recipe per 01-RESEARCH.md Pattern 2; settle cadence per Pattern 3;
// teardown discipline per Pitfalls 3 and 8.

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

const BODY_HTML = '<div id="root"><div id="a">hello</div><p id="b">world</p></div>';

/**
 * Build a fresh JSDOM instance, install its globals on globalThis (recording
 * prior state), and return an env whose teardown stops the capture, restores
 * every global exactly, and closes the window. Every test body wraps in
 * try/finally(env.teardown) so a failing assertion can never leak globals or
 * a live watchdog timer chain into other tests (Pitfalls 3 and 8).
 * @param {string} bodyHtml
 */
function setupEnv(bodyHtml) {
  const dom = new JSDOM(
    '<!DOCTYPE html><html><head><title>lifecycle fixture</title></head><body>'
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
      // clears the self-re-arming watchdog setTimeout chain (Pitfall 3).
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
 * @param {Window} win
 */
async function settle(win) {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => win.requestAnimationFrame(resolve));
  await new Promise((resolve) => setTimeout(resolve, 20));
}

/**
 * Loopback transport proving the seam (success criterion 2): records every
 * (type, payload) pair. flush is deliberately omitted so the lifecycle tests
 * exercise the optional-flush no-op default path.
 */
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

test('factory emits ready and start emits a snapshot stamped with fresh identity', async () => {
  const env = setupEnv(BODY_HTML);
  try {
    const transport = createLoopbackTransport();
    env.capture = createCapture({ transport, logger: silentLogger() });

    // READY is emitted exactly once, at factory creation (ledger entry D3).
    assert.equal(transport.sent.length, 1);
    assert.equal(transport.sent[0].type, STREAM.READY);

    env.capture.start();

    const snapshots = transport.sent.filter((m) => m.type === STREAM.SNAPSHOT);
    assert.equal(snapshots.length, 1);
    const snap = snapshots[0].payload;
    assert.match(snap.streamSessionId, /^stream_[a-z0-9]+_[a-z0-9]+$/);
    assert.equal(typeof snap.snapshotId, 'number');
    assert.ok(snap.snapshotId > 0, 'snapshotId is a positive Date.now()-based number');

    // READY precedes the snapshot in send order.
    assert.ok(
      transport.sent.findIndex((m) => m.type === STREAM.READY)
        < transport.sent.findIndex((m) => m.type === STREAM.SNAPSHOT),
      'READY is sent before the first SNAPSHOT'
    );
  } finally {
    env.teardown();
  }
});

test('stop then start mints a new stream session and snapshot identity', async () => {
  const env = setupEnv(BODY_HTML);
  try {
    const transport = createLoopbackTransport();
    env.capture = createCapture({ transport, logger: silentLogger() });

    env.capture.start();
    const first = transport.sent.filter((m) => m.type === STREAM.SNAPSHOT)[0].payload;
    env.capture.stop();

    // snapshotId is minted from Date.now(): hold for >1ms so the second
    // session cannot collide with the first in the same millisecond.
    await new Promise((resolve) => setTimeout(resolve, 10));

    env.capture.start();
    const snapshots = transport.sent.filter((m) => m.type === STREAM.SNAPSHOT);
    assert.equal(snapshots.length, 2, 'each start() emits exactly one snapshot');
    const second = snapshots[1].payload;

    // Fresh-session semantics (CAPT-02, phase success criterion 3): BOTH
    // identity fields change across stop() -> start().
    assert.notEqual(second.streamSessionId, first.streamSessionId);
    assert.notEqual(second.snapshotId, first.snapshotId);
  } finally {
    env.teardown();
  }
});

test('pause suspends emission and resume continues the same session without re-snapshot', async () => {
  const env = setupEnv(BODY_HTML);
  try {
    const transport = createLoopbackTransport();
    env.capture = createCapture({ transport, logger: silentLogger() });
    env.capture.start();
    await settle(env.window);

    const snap = transport.sent.filter((m) => m.type === STREAM.SNAPSHOT)[0].payload;
    const originalSession = snap.streamSessionId;
    const originalSnapshotId = snap.snapshotId;

    env.capture.pause();
    const sentAtPause = transport.sent.length;

    // Mutations while paused are missed by design (D-06 host contract):
    // a paused capture emits ZERO new messages.
    env.document.getElementById('a').setAttribute('data-paused-edit', 'yes');
    await settle(env.window);
    assert.equal(transport.sent.length, sentAtPause, 'no messages while paused');

    env.capture.resume();
    await settle(env.window);

    // resume() must NOT re-snapshot (D-06 USER OVERRIDE, ledger entry D1).
    const afterResume = transport.sent.slice(sentAtPause);
    assert.equal(
      afterResume.filter((m) => m.type === STREAM.SNAPSHOT).length,
      0,
      'resume emits no snapshot message'
    );

    env.document.getElementById('b').setAttribute('data-resumed-edit', 'yes');
    await settle(env.window);

    const mutationsAfterResume = transport.sent
      .slice(sentAtPause)
      .filter((m) => m.type === STREAM.MUTATIONS);
    assert.equal(mutationsAfterResume.length, 1);
    // Post-resume mutations carry the ORIGINAL pre-pause identity: the same
    // streamSessionId AND the same snapshotId continue across pause/resume.
    assert.equal(mutationsAfterResume[0].payload.streamSessionId, originalSession);
    assert.equal(mutationsAfterResume[0].payload.snapshotId, originalSnapshotId);
  } finally {
    env.teardown();
  }
});

test('transport errors route to the injected logger and never throw into the capture path', async () => {
  const env = setupEnv(BODY_HTML);
  try {
    const errors = [];
    const recordingLogger = {
      info() {},
      warn() {},
      error(...args) { errors.push(args); },
    };
    const throwingTransport = {
      send() { throw new Error('transport-down'); },
    };

    // Factory creation emits READY through the throwing transport; start()
    // sends the snapshot; the settled mutation sends a diff batch; stop()
    // final-flushes. Every send throws -- none of these calls may propagate
    // the error (this test failing with 'transport-down' IS the regression).
    env.capture = createCapture({ transport: throwingTransport, logger: recordingLogger });
    env.capture.start();
    env.document.getElementById('a').setAttribute('data-x', '1');
    await settle(env.window);
    env.capture.stop();

    assert.ok(errors.length >= 1, 'transport failures were routed to the injected logger');
  } finally {
    env.teardown();
  }
});

test('a transport without flush works through the no-op default', async () => {
  const env = setupEnv(BODY_HTML);
  try {
    const transport = createLoopbackTransport(); // only send is defined
    env.capture = createCapture({ transport, logger: silentLogger() });

    env.capture.start();
    env.document.getElementById('a').setAttribute('data-y', '2');
    await settle(env.window);
    env.capture.stop(); // stop() invokes the optional flush hook: silent no-op

    assert.ok(transport.sent.some((m) => m.type === STREAM.SNAPSHOT));
    assert.ok(transport.sent.some((m) => m.type === STREAM.MUTATIONS));
  } finally {
    env.teardown();
  }
});
