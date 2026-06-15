// tests/differential/harness.js -- dual-JSDOM environment factory, reference
// IIFE loader, extracted-core loader, and scenario runner for the
// differential oracle.
//
// This file is the ONLY code allowed to touch either DOM (01-RESEARCH.md
// Pitfall 6): a single shared factory builds every side from identical
// config so cross-instance drift cannot create phantom divergences.
// The reference capture (reference/extension/dom-stream.js) is executed
// UNMODIFIED inside the jsdom window's vm context with a two-key chrome
// stub and a minimal window.FSB stub -- exactly the surface it touches.
// The extracted capture (src/capture/index.js) runs as a normal ESM import
// against ambient globals supplied from its own JSDOM window (Pattern 2),
// emitting through a loopback Transport with no flush property.

import { JSDOM, VirtualConsole } from 'jsdom';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
// Side-effect-free import (verified by the bare-Node smoke in Plan 01-03):
// the module dereferences NO ambient globals at load time, so this static
// import is safe even though the extracted side's globals are swapped in
// later, per-instance, inside createExtractedSide.
import { createCapture } from '../../src/capture/index.js';

// Loaded once; resolved relative to this file so the harness is cwd-independent.
const referenceSource = readFileSync(
  new URL('../../reference/extension/dom-stream.js', import.meta.url),
  'utf8'
);

// Every side MUST be constructed with this exact URL: absolutifyUrl reads
// document.baseURI, so any cross-side URL drift surfaces as phantom
// divergences in absolutified src/href/action attributes (Pitfall 6).
const FIXTURE_URL = 'https://fixture.test/page';

// Complete ambient-global set the extracted core dereferences, audited from
// the reference source (01-RESEARCH.md Pattern 2). createExtractedSide swaps
// every one of these onto globalThis from its own JSDOM window for the
// lifetime of that side, then restores them unconditionally at close()
// (Pitfall 8 -- pollution would poison later tests in the same process).
const AMBIENT_GLOBALS = [
  'window', 'document', 'Node', 'NodeFilter', 'MutationObserver',
  'requestAnimationFrame', 'cancelAnimationFrame', 'CustomEvent',
  'ShadowRoot', 'location', 'getComputedStyle', 'URL',
];

/**
 * Build one fixture JSDOM instance. This is the SINGLE construction site for
 * BOTH oracle sides (reference and extracted): identical url,
 * pretendToBeVisual, runScripts, virtualConsole, and rect patch, so
 * cross-instance configuration drift can never create phantom divergences
 * (Pitfall 6).
 *
 * @param {string} fixtureHtml
 * @param {{ runScripts?: 'outside-only'|'dangerously', patchRects?: boolean }} [config]
 * @returns {JSDOM}
 */
function buildFixtureDom(fixtureHtml, config) {
  const dom = new JSDOM(fixtureHtml, {
    url: FIXTURE_URL,
    pretendToBeVisual: true, // enables requestAnimationFrame for the rAF flush
    runScripts: (config && config.runScripts) || 'outside-only',
    virtualConsole: new VirtualConsole(), // quiet: swallows "Not implemented" noise
  });

  // Deterministic fake layout (Pattern 5, verified recipe): rect.top comes
  // from the fixture's data-test-top attribute; elements without the
  // attribute sit at the viewport origin. Applied before the capture code
  // runs so its single-pass TreeWalker rect reads see the fake consistently.
  if (config && config.patchRects) {
    dom.window.Element.prototype.getBoundingClientRect = function () {
      const top = Number(this.getAttribute && this.getAttribute('data-test-top')) || 0;
      return { top, left: 0, width: 100, height: 50, right: 100, bottom: top + 50, x: 0, y: top };
    };
  }

  return dom;
}

/**
 * Build one reference capture side: a fresh JSDOM instance with the
 * unmodified reference IIFE loaded into its vm context behind chrome/FSB
 * stubs. Lifecycle methods drive the captured chrome.runtime.onMessage
 * control listener exactly as the extension background would.
 *
 * @param {string} fixtureHtml  frozen fixture HTML (byte-identical per side)
 * @param {{ runScripts?: 'outside-only'|'dangerously', patchRects?: boolean }} [config]
 *   'dangerously' is reserved for the trusted dialog fixture (Pitfall 5);
 *   everything else runs script-free under 'outside-only'. When patchRects
 *   is true, this instance's Element.prototype.getBoundingClientRect is
 *   replaced BEFORE the capture code loads with a deterministic fake that
 *   reads the fixture-authored data-test-top attribute (01-RESEARCH.md
 *   Pattern 5) -- jsdom rects are otherwise all zeros, so pass-1 truncation
 *   ("drop subtrees below 3x viewport") could never trigger. Because every
 *   side is built through this one factory from the same config, the patch
 *   can never drift across instances (Pitfall 6).
 * @returns {{
 *   dom: JSDOM, window: Window, document: Document,
 *   sent: object[],
 *   start: () => void, stop: () => void, pause: () => void, resume: () => void,
 *   close: () => void,
 * }}
 */
export function createReferenceSide(fixtureHtml, config) {
  const dom = buildFixtureDom(fixtureHtml, config);
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
 * Build one EXTRACTED capture side: a fresh JSDOM instance (through the SAME
 * shared factory as the reference side -- Pitfall 6) whose window supplies
 * the ambient globals the extracted core dereferences, with createCapture
 * from src/capture/index.js emitting through a loopback Transport. The
 * loopback deliberately has NO flush property, so the optional-flush no-op
 * default is what the oracle exercises end-to-end (phase success
 * criterion 2).
 *
 * Returns the IDENTICAL surface shape as createReferenceSide so runScenario
 * and every scenario module drive both sides interchangeably.
 *
 * Globals discipline (Pitfall 8): prior values (and presence) of the audited
 * global set are recorded BEFORE assignment; close() restores every one of
 * them UNCONDITIONALLY in a finally, so a thrown scenario can never poison
 * later tests. Scenarios run to FULL completion on one side before the other
 * side is even constructed (Pitfall 10), so the swap window never overlaps
 * another live side.
 *
 * @param {string} fixtureHtml  frozen fixture HTML (byte-identical per side)
 * @param {{ runScripts?: 'outside-only'|'dangerously', patchRects?: boolean }} [config]
 * @returns {{
 *   dom: JSDOM, window: Window, document: Document,
 *   sent: { type: string, payload: object }[],
 *   start: () => void, stop: () => void, pause: () => void, resume: () => void,
 *   close: () => void,
 * }}
 */
export function createExtractedSide(fixtureHtml, config) {
  const dom = buildFixtureDom(fixtureHtml, config);
  const win = dom.window;

  // Record prior globalThis state (value AND presence) before swapping, so
  // restoration reproduces the exact pre-side process state: names that did
  // not exist are deleted rather than left as `undefined` residue.
  const savedGlobals = AMBIENT_GLOBALS.map((name) => ({
    name,
    had: Object.prototype.hasOwnProperty.call(globalThis, name),
    value: globalThis[name],
  }));
  let globalsRestored = false;
  function restoreGlobals() {
    if (globalsRestored) return;
    globalsRestored = true;
    for (const saved of savedGlobals) {
      if (saved.had) {
        globalThis[saved.name] = saved.value;
      } else {
        delete globalThis[saved.name];
      }
    }
  }

  for (const name of AMBIENT_GLOBALS) {
    globalThis[name] = name === 'window' ? win : win[name];
  }

  // Loopback transport: records { type, payload } verbatim. NO flush
  // property -- the typeof-guarded no-op default in the core is the path
  // under test (phase success criterion 2).
  const sent = [];
  const loopback = {
    send(type, payload) {
      sent.push({ type, payload });
    },
  };

  let capture;
  try {
    capture = createCapture({
      transport: loopback,
      // No-op logger mirrors the reference side's FSB logger stub: identical
      // quiet test conditions on both sides. Wire-invisible -- only
      // transport.send output is compared.
      logger: { info() {}, warn() {}, error() {} },
    });
  } catch (err) {
    // Factory failure happens AFTER the swap but BEFORE a close() handle
    // exists -- restore here or the globals leak (Pitfall 8).
    restoreGlobals();
    dom.window.close();
    throw err;
  }

  let closed = false;

  return {
    dom,
    window: win,
    document: win.document,
    sent,
    start() { capture.start(); },
    stop() { capture.stop(); },
    pause() { capture.pause(); },
    resume() { capture.resume(); },
    // Idempotent teardown mirroring the reference side: stop the capture
    // (clears the self-re-arming watchdog setTimeout chain -- Pitfall 3),
    // then restore the swapped globals in a finally (unconditional even if
    // stop misbehaves) and close the jsdom window.
    close() {
      if (closed) return;
      closed = true;
      try {
        capture.stop();
      } finally {
        restoreGlobals();
        dom.window.close();
      }
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
 * @param {ReturnType<typeof createReferenceSide>|ReturnType<typeof createExtractedSide>} side
 * @param {{ name: string, run: (side: object, settle: typeof settle) => Promise<void> }} scenario
 * @returns {Promise<object[]>} the recorded raw messages
 */
export async function runScenario(side, scenario) {
  try {
    if (typeof scenario.beforeStart === 'function') {
      await scenario.beforeStart(side, settle);
    }
    side.start();
    await scenario.run(side, settle);
    side.stop();
    return side.sent;
  } finally {
    side.close();
  }
}
