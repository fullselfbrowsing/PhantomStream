// tests/differential/harness.js -- dual-JSDOM environment factory, reference
// IIFE loader, and scenario runner for the differential oracle.
//
// This file is the ONLY code allowed to touch either DOM (01-RESEARCH.md
// Pitfall 6): a single shared factory builds every side from identical
// config so cross-instance drift cannot create phantom divergences.
// The reference capture (reference/extension/dom-stream.js) is executed
// UNMODIFIED inside the jsdom window's vm context with a two-key chrome
// stub and a minimal window.FSB stub -- exactly the surface it touches.

import { JSDOM, VirtualConsole } from 'jsdom';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

// Loaded once; resolved relative to this file so the harness is cwd-independent.
const referenceSource = readFileSync(
  new URL('../../reference/extension/dom-stream.js', import.meta.url),
  'utf8'
);

// Every side MUST be constructed with this exact URL: absolutifyUrl reads
// document.baseURI, so any cross-side URL drift surfaces as phantom
// divergences in absolutified src/href/action attributes (Pitfall 6).
const FIXTURE_URL = 'https://fixture.test/page';

/**
 * Build one reference capture side: a fresh JSDOM instance with the
 * unmodified reference IIFE loaded into its vm context behind chrome/FSB
 * stubs. Lifecycle methods drive the captured chrome.runtime.onMessage
 * control listener exactly as the extension background would.
 *
 * @param {string} fixtureHtml  frozen fixture HTML (byte-identical per side)
 * @param {{ runScripts?: 'outside-only'|'dangerously' }} [config]
 *   'dangerously' is reserved for the trusted dialog fixture (Pitfall 5);
 *   everything else runs script-free under 'outside-only'.
 * @returns {{
 *   dom: JSDOM, window: Window, document: Document,
 *   sent: object[],
 *   start: () => void, stop: () => void, pause: () => void, resume: () => void,
 *   close: () => void,
 * }}
 */
export function createReferenceSide(fixtureHtml, config) {
  const dom = new JSDOM(fixtureHtml, {
    url: FIXTURE_URL,
    pretendToBeVisual: true, // enables requestAnimationFrame for the rAF flush
    runScripts: (config && config.runScripts) || 'outside-only',
    virtualConsole: new VirtualConsole(), // quiet: swallows "Not implemented" noise
  });
  const ctx = dom.getInternalVMContext();

  const sent = [];
  let controlListener = null;

  // Two-key chrome stub -- the complete chrome.* surface the reference uses.
  // sendMessage returns a resolved promise so the reference's .catch() chains
  // keep working; the message object is recorded verbatim.
  ctx.chrome = {
    runtime: {
      sendMessage(msg) {
        sent.push(msg);
        return Promise.resolve();
      },
      onMessage: {
        addListener(fn) { controlListener = fn; },
      },
    },
  };

  // Minimal FSB namespace: no-op logger, no overlay providers -- the
  // reference then sends { glow: null, progress: null } overlay state,
  // matching an FSB-absent page.
  ctx.window.FSB = {
    logger: { info() {}, warn() {}, error() {} },
    _modules: {},
  };

  vm.runInContext(referenceSource, ctx);

  function dispatch(action) {
    if (!controlListener) {
      throw new Error('reference control listener was never registered');
    }
    controlListener({ action }, {}, function noopSendResponse() {});
  }

  let closed = false;

  return {
    dom,
    window: dom.window,
    document: dom.window.document,
    sent,
    start() { dispatch('domStreamStart'); },
    stop() { dispatch('domStreamStop'); },
    pause() { dispatch('domStreamPause'); },
    resume() { dispatch('domStreamResume'); },
    // Idempotent teardown: stop the stream (clears the self-re-arming 500ms
    // watchdog setTimeout chain -- Pitfall 3) then close the jsdom window.
    close() {
      if (closed) return;
      closed = true;
      try { dispatch('domStreamStop'); } catch (e) { /* already torn down */ }
      dom.window.close();
    },
  };
}

/**
 * Deterministic mutation-flush cadence (01-RESEARCH.md Pattern 3, verified):
 * MutationObserver microtask delivery -> rAF flush -> async send settle.
 * Each JSDOM instance has its own rAF loop, so the window is a parameter.
 * @param {Window} win
 */
export async function settle(win) {
  await new Promise((resolve) => setTimeout(resolve, 0));             // observer delivery
  await new Promise((resolve) => win.requestAnimationFrame(resolve)); // rAF flush fires
  await new Promise((resolve) => setTimeout(resolve, 20));            // send chains settle
}

/**
 * Run one scenario against one side to FULL completion. Callers run side A
 * to completion before constructing/running side B -- interleaving batches
 * mutations differently per side (Pitfall 10). The side is always closed,
 * even when the scenario throws.
 *
 * @param {ReturnType<typeof createReferenceSide>} side
 * @param {{ name: string, run: (side: object, settle: typeof settle) => Promise<void> }} scenario
 * @returns {Promise<object[]>} the recorded raw messages
 */
export async function runScenario(side, scenario) {
  try {
    side.start();
    await scenario.run(side, settle);
    side.stop();
    return side.sent;
  } finally {
    side.close();
  }
}
