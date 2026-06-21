// Reliability-defense tests for the extracted capture core (CAPT-03).
// One dedicated test per defense (locked decision D-15):
//   1. rAF-batched diffs -- a synchronous mutation burst flushes as ONE message
//   2. session/snapshot identity stamping on every emitted message type
//   3. budgeted whole-subtree truncation with MEASURED single-pass layout reads
// (The fourth defense -- the self-watchdog force-flush -- lives in its own
// file, tests/capture-watchdog.test.js, because it fakes Date and relies on
// per-file process isolation under node --test.)
//
// The setup/teardown and settle helpers are deliberately duplicated locally
// (parallel-safe: this file imports nothing from any shared test harness).
// Globals recipe per 01-RESEARCH.md Pattern 2; settle cadence per Pattern 3;
// fake-rect recipe per Pattern 5; ASCII fixture sizing per Pitfall 7.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM, VirtualConsole } from 'jsdom';
import { createCapture } from '../src/capture/index.js';
import { STREAM } from '../src/protocol/messages.js';
import {
  SNAPSHOT_BUDGET_BYTES,
  TRUNCATION_VIEWPORT_MULTIPLIER,
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
    '<!DOCTYPE html><html><head><title>defenses fixture</title></head><body>'
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

test('mutations within one frame batch into a single rAF flush', async () => {
  const env = setupEnv(BODY_HTML);
  try {
    const transport = createLoopbackTransport();
    env.capture = createCapture({ transport, logger: silentLogger() });
    env.capture.start();
    await settle(env.window);

    const baseline = transport.sent.filter((m) => m.type === STREAM.MUTATIONS).length;

    // 12 synchronous mutations with NO settle between them: 10 attribute
    // writes plus 2 character-data writes, all landing inside one frame.
    // (Attr/text mutations are used instead of subtree adds because add-op
    // processing stamps node ids onto the LIVE added elements -- reference-
    // parity behavior that echoes as a follow-on attr flush in the NEXT
    // frame, which would obscure the one-burst-one-flush invariant.)
    const a = env.document.getElementById('a');
    const b = env.document.getElementById('b');
    for (let i = 0; i < 10; i++) {
      a.setAttribute('data-burst-' + i, String(i));
    }
    a.firstChild.nodeValue = 'hello-updated';
    b.firstChild.nodeValue = 'world-updated';

    await settle(env.window);

    // rAF-batched diffs defense: the whole burst drains as EXACTLY one
    // STREAM.MUTATIONS message carrying all the resulting ops.
    const mutationMessages = transport.sent.filter((m) => m.type === STREAM.MUTATIONS);
    assert.equal(mutationMessages.length, baseline + 1, 'exactly one flush for the burst');
    const ops = mutationMessages[mutationMessages.length - 1].payload.mutations;
    assert.equal(ops.length, 12, 'every mutation in the burst is represented');
    assert.equal(ops.filter((op) => op.op === 'attr').length, 10);
    assert.equal(ops.filter((op) => op.op === 'text').length, 2);
  } finally {
    env.teardown();
  }
});

test('every emitted message type carries stream session and snapshot identity', async () => {
  const env = setupEnv(BODY_HTML);
  try {
    const transport = createLoopbackTransport();
    env.capture = createCapture({ transport, logger: silentLogger() });

    // Drive all four steady-state channels: SNAPSHOT + OVERLAY come from
    // start() (overlay via the forced lifecycle broadcast), MUTATIONS from a
    // settled DOM edit, SCROLL from a window scroll event. Dialog identity is
    // covered by the oracle's dialog scenario (Plan 01-04).
    env.capture.start();
    env.document.getElementById('a').setAttribute('data-edit', 'yes');
    await settle(env.window);
    env.window.dispatchEvent(new env.window.Event('scroll'));
    await settle(env.window);

    const snap = transport.sent.filter((m) => m.type === STREAM.SNAPSHOT)[0].payload;
    assert.match(snap.streamSessionId, /^stream_[a-z0-9]+_[a-z0-9]+$/);
    assert.ok(snap.snapshotId > 0);

    // Identity-stamping defense: every message of every driven type carries
    // the session's streamSessionId AND snapshotId.
    const stampedTypes = [STREAM.SNAPSHOT, STREAM.MUTATIONS, STREAM.SCROLL, STREAM.OVERLAY];
    for (const type of stampedTypes) {
      const messages = transport.sent.filter((m) => m.type === type);
      assert.ok(messages.length >= 1, `at least one ${type} message was emitted`);
      for (const message of messages) {
        assert.equal(message.payload.streamSessionId, snap.streamSessionId,
          `${type} carries the session id`);
        assert.equal(message.payload.snapshotId, snap.snapshotId,
          `${type} carries the snapshot id`);
      }
    }
  } finally {
    env.teardown();
  }
});

/**
 * Programmatic oversized fixture (Pitfall 7): the truncation budget compares
 * html.length in UTF-16 code units, so the content is pure ASCII sized from
 * the imported budget constant with ~50% margin. Three below-fold sections
 * (data-test-top 3000/6000/9000, all past the jsdom cutoff of
 * innerHeight 768 x TRUNCATION_VIEWPORT_MULTIPLIER) carry the bulk; the
 * above-fold div stays tiny so pass-1 subtree drops land under budget.
 * @returns {string}
 */
function buildOversizedBodyHtml() {
  const phrase = 'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod ';
  const perSectionChars = Math.ceil(SNAPSHOT_BUDGET_BYTES * 0.5);
  const perParagraphChars = Math.ceil(perSectionChars / 2);
  const paragraphText = phrase.repeat(Math.ceil(perParagraphChars / phrase.length));
  const belowFoldTops = [3000, 6000, 9000];
  const sections = belowFoldTops.map((top) =>
    '<section data-test-top="' + top + '">'
      + '<p>' + paragraphText + '</p>'
      + '<p>' + paragraphText + '</p>'
      + '</section>'
  ).join('');
  return '<div id="above-fold">visible content</div>' + sections;
}

test('oversized pages truncate whole subtrees within budget using one layout read per element', async () => {
  const env = setupEnv(buildOversizedBodyHtml());
  try {
    // Counting fake-rect patch (Pattern 5): rect.top comes from the
    // fixture-authored data-test-top attribute, and every call is counted
    // per element so the single-pass defense is MEASURED, not source-grepped.
    const rectReads = new Map();
    env.window.Element.prototype.getBoundingClientRect = function () {
      rectReads.set(this, (rectReads.get(this) || 0) + 1);
      const top = Number(this.getAttribute && this.getAttribute('data-test-top')) || 0;
      return { top, left: 0, width: 100, height: 50, right: 100, bottom: top + 50, x: 0, y: top };
    };

    const cutoff = env.window.innerHeight * TRUNCATION_VIEWPORT_MULTIPLIER;
    assert.ok(cutoff < 3000, 'every below-fold section sits past the viewport cutoff');

    const transport = createLoopbackTransport();
    env.capture = createCapture({ transport, logger: silentLogger() });
    env.capture.start();

    const snap = transport.sent.filter((m) => m.type === STREAM.SNAPSHOT)[0].payload;

    // Budgeted whole-subtree truncation defense: the serialized html came in
    // over budget, so complete below-fold subtrees were dropped.
    assert.equal(snap.truncated, true);
    assert.ok(snap.missingDescendants > 0, 'dropped subtrees are counted');
    assert.ok(snap.html.length <= SNAPSHOT_BUDGET_BYTES, 'emitted html fits the budget');

    // Single-pass layout-read defense, measured: serialization performed at
    // most ONE getBoundingClientRect call per element (the one TreeWalker
    // pre-pass over the live document -- no per-element re-reads).
    assert.ok(rectReads.size > 0, 'serialization read element rects');
    const maxReadsPerElement = Math.max(...rectReads.values());
    assert.equal(maxReadsPerElement, 1, 'no element rect was read more than once');
  } finally {
    env.teardown();
  }
});

/** Define the playback-state props capture reads (jsdom leaves them undefined). */
function stubMedia(el, state) {
  for (const p of Object.keys(state)) {
    let v = state[p];
    Object.defineProperty(el, p, { configurable: true, get() { return v; }, set(n) { v = n; } });
  }
}

/**
 * Oversized fixture whose below-fold sections each wrap a <video>, so a dropped
 * subtree removes a media-baselined nid from nodeIds. The above-fold content
 * stays tiny so the truncation lands on the below-fold sections.
 */
function buildOversizedBodyHtmlWithMedia() {
  const phrase = 'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod ';
  const perSectionChars = Math.ceil(SNAPSHOT_BUDGET_BYTES * 0.5);
  const paragraphText = phrase.repeat(Math.ceil(perSectionChars / phrase.length));
  const belowFoldTops = [3000, 6000, 9000];
  const sections = belowFoldTops.map((top, i) =>
    '<section data-test-top="' + top + '">'
      + '<video id="v' + i + '"></video>'
      + '<p>' + paragraphText + '</p>'
      + '</section>'
  ).join('');
  return '<div id="above-fold">visible content</div>' + sections;
}

test('WR-02: a truncated snapshot never ships a media[] entry whose nid left nodeIds', async () => {
  const env = setupEnv(buildOversizedBodyHtmlWithMedia());
  try {
    env.window.Element.prototype.getBoundingClientRect = function () {
      const top = Number(this.getAttribute && this.getAttribute('data-test-top')) || 0;
      return { top, left: 0, width: 100, height: 50, right: 100, bottom: top + 50, x: 0, y: top };
    };
    const cutoff = env.window.innerHeight * TRUNCATION_VIEWPORT_MULTIPLIER;
    assert.ok(cutoff < 3000, 'every below-fold <video> section sits past the viewport cutoff');

    // Each below-fold <video> reports a finite duration so it builds a clean
    // baseline entry (the LIVE element is read regardless of clone truncation).
    for (const v of env.document.querySelectorAll('video')) {
      stubMedia(v, { currentTime: 1, paused: true, muted: false, volume: 1, playbackRate: 1, loop: false, ended: false, duration: 60 });
    }

    const transport = createLoopbackTransport();
    env.capture = createCapture({ transport, logger: silentLogger() });
    env.capture.start();

    const snap = transport.sent.filter((m) => m.type === STREAM.SNAPSHOT)[0].payload;

    // The page came in over budget: below-fold subtrees (which carry the
    // <video> elements) were dropped.
    assert.equal(snap.truncated, true, 'oversized page truncated');
    assert.ok(snap.missingDescendants > 0, 'at least one below-fold subtree was dropped');

    // THE invariant (WR-02): every media[] baseline nid must still be addressable
    // in the emitted nodeIds sidecar -- a dropped <video> nid must not survive
    // in media[]. Without the prune, the dropped sections' video nids would
    // remain here while absent from nodeIds.
    if (Array.isArray(snap.media)) {
      const live = new Set(snap.nodeIds.map(String));
      for (const m of snap.media) {
        assert.ok(live.has(String(m.nid)), 'media baseline nid ' + m.nid + ' must be present in nodeIds');
      }
      // The fixture is engineered so at least one <video> subtree is dropped,
      // so media[] must be strictly smaller than the three live elements.
      assert.ok(snap.media.length < 3, 'at least one truncated <video> was pruned from media[]');
    }
  } finally {
    env.teardown();
  }
});
