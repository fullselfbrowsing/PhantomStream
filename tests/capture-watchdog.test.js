// Watchdog force-flush defense test for the extracted capture core (CAPT-03).
//
// This defense lives in its OWN file on purpose: the recipe fakes the global
// Date (01-RESEARCH.md Pattern 4 -- fake Date, suppressed rAF, REAL
// setTimeout), and node --test runs each file in its own process, so the
// Date fake cannot poison other suites (Pitfall 8). Real setTimeout stays
// untouched throughout -- the node:test timer-mocking facility is never used
// (Assumption A1: whether it would intercept jsdom's window timers is
// unverified; the fake-Date recipe sidesteps the question entirely).
//
// With rAF suppressed the batch flush never fires, so the mutation queue
// stays stuck. Advancing the fake clock past MUTATION_STALE_THRESHOLD_MS and
// waiting a couple of REAL watchdog ticks proves the self-watchdog rescues
// the queue and reports staleFlushCount -- in well under a second of fake-
// free wall time instead of a real 5-second stale wait.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM, VirtualConsole } from 'jsdom';
import { createCapture } from '../src/capture/index.js';
import { STREAM } from '../src/protocol/messages.js';
import {
  MUTATION_STALE_THRESHOLD_MS,
  WATCHDOG_TICK_MS,
} from '../src/protocol/constants.js';

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
 * every global exactly, and closes the window (Pitfalls 3 and 8).
 * @param {string} bodyHtml
 */
function setupEnv(bodyHtml) {
  const dom = new JSDOM(
    '<!DOCTYPE html><html><head><title>watchdog fixture</title></head><body>'
      + bodyHtml + '</body></html>',
    {
      url: 'https://fixture.test/page',
      pretendToBeVisual: true,
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
      // clears the self-re-arming watchdog chain (real clearTimeout).
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

/** Loopback transport: records every (type, payload) pair; no flush. */
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

test('watchdog force-flushes stuck mutations and reports the stale rescue', async () => {
  const env = setupEnv(BODY_HTML);
  const RealDate = globalThis.Date;
  try {
    // Fake Date (Pattern 4): the constructor delegates to the real Date;
    // static now() returns a mutable fakeNow. Installed BEFORE createCapture
    // so the capture's lastDrainTs baseline is minted on the fake clock.
    let fakeNow = 1000000;
    const FakeDate = function (...args) { return new RealDate(...args); };
    FakeDate.now = () => fakeNow;
    globalThis.Date = FakeDate;

    // Suppress rAF so the batch flush never fires and the queue stays stuck.
    // (Overrides the jsdom-provided globals installed by setupEnv; teardown
    // restores the audited set either way.)
    globalThis.requestAnimationFrame = () => 0;
    globalThis.cancelAnimationFrame = () => {};

    const transport = createLoopbackTransport();
    env.capture = createCapture({ transport, logger: silentLogger() });
    env.capture.start();

    // Mutate, then let the MutationObserver microtask deliver the records
    // into the pending queue. The suppressed rAF never drains it.
    env.document.getElementById('a').setAttribute('data-stuck', 'yes');
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(
      transport.sent.filter((m) => m.type === STREAM.MUTATIONS).length,
      0,
      'the stuck queue has not drained before the watchdog acts'
    );

    // Advance the fake clock past the stale threshold, then wait ~2.5
    // watchdog ticks of REAL time so the force-flush tick definitely fires.
    fakeNow += MUTATION_STALE_THRESHOLD_MS + 1000;
    await new Promise((resolve) => setTimeout(resolve, Math.ceil(WATCHDOG_TICK_MS * 2.5)));

    const rescued = transport.sent.filter((m) => m.type === STREAM.MUTATIONS);
    assert.equal(rescued.length, 1, 'the watchdog force-flushed exactly once');
    // staleFlushCount is incremented BEFORE the forced flush, so the rescued
    // message reports the rescue; the counter then resets on drain.
    assert.equal(rescued[0].payload.staleFlushCount, 1, 'the stale rescue is reported');
    const ops = rescued[0].payload.mutations;
    assert.ok(ops.length >= 1, 'the flushed message carries the stuck ops');
    assert.equal(ops[0].op, 'attr');
    assert.equal(ops[0].attr, 'data-stuck');
  } finally {
    // Restore the real Date FIRST so teardown (stop + window close) runs on
    // the real clock; then restore the audited globals and close the window.
    globalThis.Date = RealDate;
    env.teardown();
  }
});
