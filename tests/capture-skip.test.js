// skipElement seam tests for the extracted capture core (iteration-2 review
// WR-02): the ancestor-inclusive host-UI exclusion contract promised by
// src/capture/README.md ("Applied **ancestor-inclusively**... excludes its
// whole subtree") had zero committed coverage -- the differential oracle's
// harness never passes a skipElement predicate, so the ancestor walk, the
// serializer's descendant-skip continue, and the differ's three skip sites
// were dead code in the committed suite. These tests pin:
//   - A ROOT-ONLY predicate (el.id match) excludes the whole host-UI subtree
//     from the snapshot html, with NO node-id stamped on any live element of
//     the skipped subtree.
//   - Attribute / characterData / childList mutations anywhere inside the
//     skipped subtree emit no diff ops, while tracked content still streams.
//   - A THROWING predicate is contained (iteration-2 WR-01): routed to the
//     injected logger, treated as not-skipped, never escaping start() or the
//     rAF flush -- and the batch containing the innocent op still flows.
//
// The setup/teardown and settle helpers are deliberately duplicated locally
// (parallel-safe: this file imports nothing from any shared test harness).
// Globals recipe per 01-RESEARCH.md Pattern 2; settle cadence per Pattern 3;
// teardown discipline per Pitfalls 3 and 8.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM, VirtualConsole } from 'jsdom';
import { createCapture } from '../src/capture/index.js';
import { STREAM, DIFF_OP } from '../src/protocol/messages.js';

// Complete global set the capture core dereferences (audited from the
// reference source in 01-RESEARCH.md Pattern 2).
const AUDITED_GLOBALS = [
  'window', 'document', 'Node', 'NodeFilter', 'MutationObserver',
  'requestAnimationFrame', 'cancelAnimationFrame', 'CustomEvent',
  'ShadowRoot', 'location', 'getComputedStyle', 'URL',
];

// #host-overlay is the host-UI subtree a root-only predicate must exclude
// ancestor-inclusively; #content is tracked page content that must keep
// streaming; #poison exists for the throwing-predicate containment test.
const BODY_HTML = '<div id="root">'
  + '<div id="content">tracked text</div>'
  + '<div id="host-overlay"><span id="host-child">host ui</span><p id="host-deep">deep text</p></div>'
  + '<div id="poison"><em id="poison-child">poison text</em></div>'
  + '</div>';

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
    '<!DOCTYPE html><html><head><title>skip fixture</title></head><body>'
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
 * Loopback transport: records every (type, payload) pair.
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

test('root-only skipElement predicate excludes the whole host subtree from the snapshot with no identity tracking', async () => {
  const env = setupEnv(BODY_HTML);
  try {
    const transport = createLoopbackTransport();
    env.capture = createCapture({
      transport,
      logger: silentLogger(),
      // ROOT-ONLY predicate: matches the subtree root and nothing else. The
      // ancestor-inclusive contract (README "like closest()") is what must
      // extend the exclusion to every descendant.
      skipElement: (el) => el.id === 'host-overlay',
    });
    env.capture.start();

    const snapshots = transport.sent.filter((m) => m.type === STREAM.SNAPSHOT);
    assert.equal(snapshots.length, 1, 'start() emits exactly one snapshot');
    const html = snapshots[0].payload.html;

    // The skipped root AND its descendants are absent from the snapshot.
    assert.ok(!html.includes('host-overlay'), 'snapshot omits the skipped subtree root');
    assert.ok(!html.includes('host-child'), 'snapshot omits the skipped subtree child');
    assert.ok(!html.includes('host ui'), 'snapshot omits skipped subtree text');
    assert.ok(!html.includes('deep text'), 'snapshot omits deep skipped subtree text');
    // Tracked content is still captured.
    assert.ok(html.includes('tracked text'), 'snapshot keeps tracked page content');

    // Reference parity (dom-stream.js closest() semantics): skipped subtrees
    // receive NO node-id assignment in the internal mirror either.
    assert.equal(env.capture.getNodeId(env.document.getElementById('host-overlay')), null,
      'skipped root has no tracked nid');
    assert.equal(env.capture.getNodeId(env.document.getElementById('host-child')), null,
      'skipped descendant has no tracked nid');
    assert.equal(env.capture.getNodeId(env.document.getElementById('host-deep')), null,
      'deep skipped descendant has no tracked nid');
    assert.equal(typeof env.capture.getNodeId(env.document.getElementById('content')), 'string',
      'tracked content has an internal nid');
  } finally {
    env.teardown();
  }
});

test('mutations inside a skipped subtree emit no diff ops while tracked content still streams', async () => {
  const env = setupEnv(BODY_HTML);
  try {
    const transport = createLoopbackTransport();
    env.capture = createCapture({
      transport,
      logger: silentLogger(),
      skipElement: (el) => el.id === 'host-overlay',
    });
    env.capture.start();
    await settle(env.window);

    const mutationCount = () => transport.sent.filter((m) => m.type === STREAM.MUTATIONS).length;
    assert.equal(mutationCount(), 0, 'no mutation traffic before any edit');

    // All three observed mutation types, each inside the skipped subtree:
    // attribute on a descendant, characterData on a deep text node, and
    // childList on the skipped root. Every one must be suppressed by the
    // differ's ancestor-inclusive skip sites.
    env.document.getElementById('host-child').setAttribute('data-host-edit', '1');
    env.document.getElementById('host-deep').firstChild.nodeValue = 'changed deep text';
    env.document.getElementById('host-overlay').appendChild(env.document.createElement('div'));
    await settle(env.window);
    assert.equal(mutationCount(), 0, 'mutations inside the skipped subtree emit no diff ops');

    // Tracked content still streams after the suppressed batch.
    env.document.getElementById('content').setAttribute('data-tracked', 'yes');
    await settle(env.window);
    const batches = transport.sent.filter((m) => m.type === STREAM.MUTATIONS);
    assert.equal(batches.length, 1, 'tracked content still streams exactly one batch');
    const ops = batches[0].payload.mutations;
    assert.ok(
      ops.some((op) => op.op === DIFF_OP.ATTR && op.attr === 'data-tracked' && op.val === 'yes'),
      'the tracked attr op is on the wire'
    );
    assert.ok(
      !ops.some((op) => op.attr === 'data-host-edit'),
      'no skipped-subtree op leaked into the tracked batch'
    );
  } finally {
    env.teardown();
  }
});

test('a throwing skipElement predicate is contained: logged, never thrown, and the batch still flows', async () => {
  const env = setupEnv(BODY_HTML);
  try {
    const errors = [];
    const recordingLogger = {
      info() {},
      warn() {},
      error(...args) { errors.push(args); },
    };
    const transport = createLoopbackTransport();
    env.capture = createCapture({
      transport,
      logger: recordingLogger,
      // Realistic predicate bug (iteration-2 WR-01): throws once the
      // ancestor walk reaches a particular element. Containment must treat
      // the element as NOT skipped and route the error to the logger --
      // "factory-time validation is the only place the capture may throw".
      skipElement: (el) => {
        if (el.id === 'poison') throw new TypeError('predicate-blew-up');
        return el.id === 'host-overlay';
      },
    });

    // start() serializes through the throwing predicate: must not throw.
    assert.doesNotThrow(() => env.capture.start());
    const errorsAfterStart = errors.length;
    assert.ok(errorsAfterStart >= 1, 'serialization-path predicate errors were routed to the logger');

    // The poison subtree is treated as not-skipped (containment fallback),
    // so it stays captured and tracked.
    assert.equal(typeof env.capture.getNodeId(env.document.getElementById('poison-child')), 'string',
      'contained-error elements remain tracked');

    // One batch carrying a poison-walk op AND an innocent op: before the
    // containment fix, processMutationBatch threw mid-batch after
    // pendingMutations was swapped out, losing the WHOLE batch silently.
    env.document.getElementById('poison-child').setAttribute('data-poison-edit', '1');
    env.document.getElementById('content').setAttribute('data-innocent', '1');
    await settle(env.window);

    const batches = transport.sent.filter((m) => m.type === STREAM.MUTATIONS);
    assert.equal(batches.length, 1, 'the mutation batch was emitted, not lost');
    const ops = batches[0].payload.mutations;
    assert.ok(
      ops.some((op) => op.op === DIFF_OP.ATTR && op.attr === 'data-innocent' && op.val === '1'),
      'the innocent op survived the throwing predicate'
    );
    assert.ok(
      ops.some((op) => op.op === DIFF_OP.ATTR && op.attr === 'data-poison-edit' && op.val === '1'),
      'the contained-error element streams as not-skipped'
    );
    assert.ok(errors.length > errorsAfterStart, 'diff-path predicate errors were routed to the logger');
  } finally {
    env.teardown();
  }
});
