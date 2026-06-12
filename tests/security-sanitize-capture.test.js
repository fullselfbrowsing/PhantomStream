// Capture-side sanitization chokepoint tests (Phase 3 SEC-01, plan 03-01):
// the mXSS/injection corpus proving hostile markup never reaches the wire
// through ANY capture serialization path -- snapshot clone walk, head
// inline-style collection, processAddedNode add-op subtrees, and (Task 2)
// the differ's attr-op and text branches. Benign-fidelity pins ride along:
// sanitization must pass benign content through byte-identical, and the
// LIVE observed page must NEVER be mutated by a strip (the page keeps its
// event handlers -- only detached clones / wire values are scrubbed).
//
// The setup/teardown and settle helpers are deliberately duplicated locally
// from tests/capture-skip.test.js (parallel-safe: this file imports nothing
// from any shared test harness). Globals recipe per 01-RESEARCH.md Pattern 2;
// settle cadence per Pattern 3; teardown discipline per Pitfalls 3 and 8.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM, VirtualConsole } from 'jsdom';
import { createCapture } from '../src/capture/index.js';
import { STREAM, DIFF_OP, NID_ATTR } from '../src/protocol/messages.js';

// Complete global set the capture core dereferences (audited from the
// reference source in 01-RESEARCH.md Pattern 2).
const AUDITED_GLOBALS = [
  'window', 'document', 'Node', 'NodeFilter', 'MutationObserver',
  'requestAnimationFrame', 'cancelAnimationFrame', 'CustomEvent',
  'ShadowRoot', 'location', 'getComputedStyle', 'URL',
];

/**
 * Build a fresh JSDOM instance, install its globals on globalThis (recording
 * prior state), and return an env whose teardown stops the capture, restores
 * every global exactly, and closes the window. Every test body wraps in
 * try/finally(env.teardown) so a failing assertion can never leak globals or
 * a live watchdog timer chain into other tests.
 * @param {string} bodyHtml
 * @param {string} [headHtml] - extra markup inside <head> (after <title>)
 */
function setupEnv(bodyHtml, headHtml) {
  const dom = new JSDOM(
    '<!DOCTYPE html><html><head><title>sanitize fixture</title>'
      + (headHtml || '') + '</head><body>' + bodyHtml + '</body></html>',
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

/**
 * Recording logger for the counter-warn assertions: captures every warn
 * call's argument list while staying quiet on info/error.
 */
function recordingLogger() {
  const warns = [];
  return {
    warns,
    info() {},
    warn(...args) { warns.push(args); },
    error() {},
  };
}

/** Extract the single SNAPSHOT payload from a loopback transport. */
function snapshotPayloadOf(transport) {
  const snapshots = transport.sent.filter((m) => m.type === STREAM.SNAPSHOT);
  assert.equal(snapshots.length, 1, 'start() emits exactly one snapshot');
  return snapshots[0].payload;
}

/** All mutation ops across every MUTATIONS batch on the wire. */
function allMutationOps(transport) {
  return transport.sent
    .filter((m) => m.type === STREAM.MUTATIONS)
    .flatMap((m) => m.payload.mutations);
}

/** The serialized start tag of the element carrying the given id. */
function startTagOf(html, id) {
  const m = html.match(new RegExp('<[a-zA-Z][^>]*\\bid="' + id + '"[^>]*>'));
  return m ? m[0] : '';
}

// =========================================================================
// Task 1: snapshot path (clone walk, head styles) + add-op subtree path
// =========================================================================

test('on* handler attributes never reach the snapshot wire; the live page keeps them', async () => {
  const env = setupEnv('<button id="btn" onclick="alert(1)">x</button>');
  try {
    const transport = createLoopbackTransport();
    env.capture = createCapture({ transport, logger: silentLogger() });
    env.capture.start();

    const html = snapshotPayloadOf(transport).html;
    assert.ok(!/onclick/i.test(html), 'snapshot html carries no onclick');
    assert.ok(html.includes('id="btn"'), 'the button itself survives');
    // Sanitization never mutates the observed page: the LIVE button keeps
    // its handler attribute after start().
    assert.equal(env.document.getElementById('btn').getAttribute('onclick'), 'alert(1)',
      'the LIVE button keeps its onclick attribute');
  } finally {
    env.teardown();
  }
});

test('javascript: hrefs (raw + tab-obfuscated) neutralize to ""; benign absolute href passes through', async () => {
  const env = setupEnv(
    '<a id="a1" href="javascript:alert(1)">x</a>'
    + '<a id="a2" href="jav\tascript:alert(1)">y</a>'
    + '<a id="a3" href="https://x.test/a">z</a>'
  );
  try {
    const transport = createLoopbackTransport();
    env.capture = createCapture({ transport, logger: silentLogger() });
    env.capture.start();

    const html = snapshotPayloadOf(transport).html;
    assert.ok(!/javascript:/i.test(html), 'no javascript: scheme anywhere on the wire');
    assert.ok(!/jav\s*ascript/i.test(html), 'no whitespace-obfuscated javascript scheme either');
    assert.match(startTagOf(html, 'a1'), /href=""/, 'raw javascript: href neutralized to ""');
    assert.match(startTagOf(html, 'a2'), /href=""/, 'tab-obfuscated javascript: href neutralized to ""');
    assert.match(startTagOf(html, 'a3'), /href="https:\/\/x\.test\/a"/,
      'benign href passes through unchanged after absolutification');
  } finally {
    env.teardown();
  }
});

test('vbscript: and data:text/html URL values are neutralized; data:image values pass through', async () => {
  const env = setupEnv(
    '<a id="v1" href="vbscript:msgbox(1)">v</a>'
    + '<iframe id="d1" src="data:text/html,hello"></iframe>'
    + '<img id="d2" src="data:image/png;base64,AAAA">'
  );
  try {
    const transport = createLoopbackTransport();
    env.capture = createCapture({ transport, logger: silentLogger() });
    env.capture.start();

    const html = snapshotPayloadOf(transport).html;
    assert.ok(!/vbscript:/i.test(html), 'no vbscript: scheme on the wire');
    assert.ok(!/data:text\/html/i.test(html), 'no data:text/html URL on the wire');
    assert.ok(html.includes('data:image/png;base64,AAAA'), 'data:image src passes through unchanged');
  } finally {
    env.teardown();
  }
});

test('the namespace-confusion mXSS payload emits no onerror on the wire', async () => {
  // Canonical math/mglyph namespace-confusion vector (03-RESEARCH.md Code
  // Examples; securitum.com). The img lands wherever the parser puts it --
  // attribute enumeration on EVERY element in the walk must catch it
  // regardless of namespace (Pitfall 4).
  const env = setupEnv(
    '<form><math><mtext></form><form><mglyph><style></math><img src onerror=alert(1)>'
  );
  try {
    const transport = createLoopbackTransport();
    env.capture = createCapture({ transport, logger: silentLogger() });
    env.capture.start();

    const html = snapshotPayloadOf(transport).html;
    assert.ok(!/onerror/i.test(html), 'no onerror handler anywhere on the wire');
  } finally {
    env.teardown();
  }
});

test('srcdoc attributes are dropped; object and embed subtrees are absent from the snapshot', async () => {
  const env = setupEnv(
    '<iframe id="if1" srcdoc="&lt;b&gt;hi&lt;/b&gt;" src="https://x.test/frame"></iframe>'
    + '<object id="ob1" data="movie.swf"><param name="p" value="1"></object>'
    + '<embed id="em1" src="movie.swf">'
  );
  try {
    const transport = createLoopbackTransport();
    env.capture = createCapture({ transport, logger: silentLogger() });
    env.capture.start();

    const html = snapshotPayloadOf(transport).html;
    assert.ok(!/srcdoc/i.test(html), 'srcdoc attribute is absent');
    assert.ok(html.includes('id="if1"'), 'the iframe element itself survives (attribute-only drop)');
    assert.ok(!/<object/i.test(html), 'object subtree dropped entirely');
    assert.ok(!/<param/i.test(html), 'object children dropped with the subtree');
    assert.ok(!/<embed/i.test(html), 'embed dropped entirely');
  } finally {
    env.teardown();
  }
});

test('formaction and svg xlink:href javascript: values are neutralized', async () => {
  const env = setupEnv(
    '<form><button id="fb" formaction="javascript:alert(1)">go</button></form>'
    + '<svg><a id="xl" xlink:href="javascript:alert(2)"><text>c</text></a></svg>'
  );
  try {
    const transport = createLoopbackTransport();
    env.capture = createCapture({ transport, logger: silentLogger() });
    env.capture.start();

    const html = snapshotPayloadOf(transport).html;
    assert.ok(!/javascript:/i.test(html), 'no javascript: scheme via formaction or xlink:href');
    assert.ok(html.includes('id="fb"'), 'the button survives with its formaction neutralized');
  } finally {
    env.teardown();
  }
});

test('dangerous inline style values are scrubbed; a benign style value passes through', async () => {
  // NOTE on test mechanics: in jsdom the snapshot clone walk's
  // captureComputedStyles REPLACES author style attrs with computed text
  // (which drops invalid declarations), so the snapshot rows below are
  // belt-and-braces pins; the LOAD-BEARING rows are the post-snapshot
  // add-op subtrees, where processAddedNode serializes raw attribute
  // values with no computed-style rewrite -- exactly the surface a real
  // browser exposes when computed styles carry hostile url() values.
  const env = setupEnv(
    '<div id="host"></div>'
    + '<div id="s1" style="background:url(javascript:alert(1))">a</div>'
    + '<div id="s4" style="color:red">d</div>'
  );
  try {
    const transport = createLoopbackTransport();
    env.capture = createCapture({ transport, logger: silentLogger() });
    env.capture.start();

    const html = snapshotPayloadOf(transport).html;
    assert.ok(!/url\(\s*javascript/i.test(html), 'no url(javascript:) in any snapshot style value');
    assert.ok(!/expression\(/i.test(html), 'no expression() in any snapshot style value');
    // Fidelity pin: the benign declaration survives (jsdom may resolve the
    // keyword to its rgb() form via computed styles -- both are benign
    // pass-through, neither is a scrub artifact).
    assert.match(startTagOf(html, 's4'), /color:\s*(red|rgb\(255,\s*0,\s*0\))/,
      'benign style value passes through');

    // Load-bearing rows: raw hostile style attrs reaching the wire via the
    // add-op path must be value-scrubbed by the chokepoint.
    await settle(env.window);
    const u = env.document.createElement('div');
    u.setAttribute('style', 'background:url(javascript:alert(1))');
    const x = env.document.createElement('div');
    x.setAttribute('style', 'width:expression(alert(1))');
    const m = env.document.createElement('div');
    m.setAttribute('style', '-moz-binding:url(evil.xml#x)');
    const b = env.document.createElement('div');
    b.setAttribute('style', 'color:blue');
    const host = env.document.getElementById('host');
    host.appendChild(u);
    host.appendChild(x);
    host.appendChild(m);
    host.appendChild(b);
    await settle(env.window);

    const addHtml = allMutationOps(transport)
      .filter((op) => op.op === DIFF_OP.ADD)
      .map((op) => op.html)
      .join('\n');
    assert.ok(addHtml.length > 0, 'the appended divs produced add ops');
    assert.ok(!/url\(\s*javascript/i.test(addHtml), 'no url(javascript:) in add-op style values');
    assert.ok(!/expression\(/i.test(addHtml), 'no expression() in add-op style values');
    assert.ok(!/-moz-binding/i.test(addHtml), 'no -moz-binding in add-op style values');
    assert.ok(addHtml.includes('color:blue'), 'benign add-op style value passes through byte-identical');
  } finally {
    env.teardown();
  }
});

test('head inline styles are scrubbed (url scheme, @import, </style breakout); benign head css is byte-identical', async () => {
  const benignCss = '.x{background:url(/img/x.png)}.y{background:url(https://cdn.test/y.png)}';
  const env = setupEnv(
    '<div id="c">x</div>',
    '<style id="hostile"></style><style id="benign"></style>'
  );
  try {
    // A literal '</style>' cannot appear inside the style TEXT in HTML
    // source (it would terminate the tag during fixture parse) -- set the
    // hostile payload via the DOM before start().
    env.document.getElementById('hostile').textContent =
      '.a{background:url(javascript:alert(1))}\n'
      + '@import url(evil.css);\n'
      + '.b{content:"</style><img src=x onerror=alert(1)>"}';
    env.document.getElementById('benign').textContent = benignCss;

    const transport = createLoopbackTransport();
    env.capture = createCapture({ transport, logger: silentLogger() });
    env.capture.start();

    const payload = snapshotPayloadOf(transport);
    const styles = payload.inlineStyles || [];
    const joined = styles.join('\n');
    assert.ok(!/url\(\s*javascript/i.test(joined), 'no url(javascript:) in inline styles');
    assert.ok(!/@import/i.test(joined), 'the non-http @import is neutralized');
    assert.ok(joined.indexOf('</style') === -1, 'no raw </style breakout sequence survives');
    assert.ok(styles.indexOf(benignCss) !== -1, 'benign head css passes through byte-identical');
  } finally {
    env.teardown();
  }
});

test('a hostile subtree added post-snapshot is scrubbed in the add op; the live node keeps its handler', async () => {
  const env = setupEnv('<div id="root2"></div>');
  try {
    const transport = createLoopbackTransport();
    env.capture = createCapture({ transport, logger: silentLogger() });
    env.capture.start();
    await settle(env.window);

    const div = env.document.createElement('div');
    const a = env.document.createElement('a');
    a.setAttribute('onclick', 'alert(1)');
    a.setAttribute('href', 'javascript:alert(1)');
    a.textContent = 'hostile';
    div.appendChild(a);
    env.document.getElementById('root2').appendChild(div);
    await settle(env.window);

    const addOps = allMutationOps(transport).filter((op) => op.op === DIFF_OP.ADD);
    assert.equal(addOps.length, 1, 'exactly one add op on the wire');
    assert.ok(!/onclick/i.test(addOps[0].html), 'add-op html carries no onclick');
    assert.ok(!/javascript:/i.test(addOps[0].html), 'add-op html carries no javascript: href');
    // The LIVE added node is untouched by sanitization.
    assert.equal(a.getAttribute('onclick'), 'alert(1)', 'the LIVE added node keeps its handler');
    assert.equal(a.getAttribute('href'), 'javascript:alert(1)', 'the LIVE added node keeps its raw href');
  } finally {
    env.teardown();
  }
});

test('strips surface through one aggregate counter warn; a fully benign snapshot warns nothing', async () => {
  // Hostile run: the aggregate '[DOM Stream] sanitization strips' warn fires
  // once per serialization pass with the counter snapshot (counted + logged,
  // never silent -- CONTEXT observability decision).
  const env = setupEnv(
    '<button id="h1" onclick="alert(1)">x</button><a id="h2" href="javascript:alert(1)">y</a>'
  );
  try {
    const transport = createLoopbackTransport();
    const logger = recordingLogger();
    env.capture = createCapture({ transport, logger });
    env.capture.start();

    const stripWarns = logger.warns.filter(
      (w) => String(w[0]).includes('[DOM Stream]') && String(w[0]).includes('sanitization strips')
    );
    assert.ok(stripWarns.length >= 1, 'at least one aggregate sanitization warn fired');
    const counters = stripWarns[0][1];
    assert.ok(counters && typeof counters === 'object', 'the warn carries a counter snapshot object');
    assert.ok(counters.strippedHandlers > 0, 'strippedHandlers is nonzero');
    assert.ok(counters.blockedUrlSchemes > 0, 'blockedUrlSchemes is nonzero');
  } finally {
    env.teardown();
  }

  // Benign run: zero sanitization warns.
  const env2 = setupEnv('<div id="b1">hello</div>');
  try {
    const transport2 = createLoopbackTransport();
    const logger2 = recordingLogger();
    env2.capture = createCapture({ transport: transport2, logger: logger2 });
    env2.capture.start();
    await settle(env2.window);

    const stripWarns2 = logger2.warns.filter((w) => String(w[0]).includes('sanitization strips'));
    assert.equal(stripWarns2.length, 0, 'a fully benign snapshot logs no sanitization warn');
  } finally {
    env2.teardown();
  }
});
