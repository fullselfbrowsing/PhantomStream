// Render-side sanitization chokepoint tests (plan 03-02, SEC-02).
//
// Sections:
//   1. Corpus: sanitizeFragment / sanitizeAttrValue / scrubCssText run
//      directly against the mXSS corpus rows from 03-RESEARCH.md "Code
//      Examples" -- namespace confusion, on* handlers, dangerous URL
//      schemes, srcdoc, object/embed, noscript (Pitfall 9: noscript
//      content IS DOM in no-allow-scripts sandboxes), CSS
//      expression()/-moz-binding/url()/@import and the style-tag breakout.
//   2. Chokepoint integration: hostile add/attr ops through applyMutations
//      (the diff applier's template-context parse + attr scrub).
//   3. Post-parse snapshot scrub, behavioral: a hostile STREAM.SNAPSHOT fed
//      directly to a createViewer instance, glued via the loopback
//      cd.open()/write()/close() recipe, with a deliberately re-fired load
//      event exercising the creation-time scrub listener.
//
// Pitfall 2 discipline (03-RESEARCH): jsdom 29 never parses the srcdoc
// attribute into contentDocument, so NO test here assigns srcdoc on an
// iframe and asserts contentDocument. Fragments are built directly via
// doc.createElement('template'); the end-to-end snapshot path writes the
// srcdoc STRING through the document-write glue instead.
//
// Helpers are duplicated locally (parallel-safe convention from
// tests/renderer-diff.test.js: this file imports nothing from any shared
// test harness).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';
import {
  sanitizeFragment,
  sanitizeAttrValue,
  scrubCssText,
} from '../src/renderer/sanitize.js';

/**
 * Fresh JSDOM instance. makeFragment parses arbitrary HTML in TEMPLATE
 * context (03-RESEARCH Pattern 2 -- context-dependent elements like tr/td
 * survive); serialize is comparison-only (clones first so the fragment
 * under test is never consumed). Every test wraps in try/finally(teardown).
 */
function setupEnv() {
  const dom = new JSDOM(
    '<!DOCTYPE html><html><head><title>sanitize fixture</title></head><body></body></html>',
    {
      url: 'https://fixture.test/page',
      virtualConsole: new VirtualConsole(), // quiet: swallows "Not implemented" noise
    }
  );
  return {
    dom,
    window: dom.window,
    document: dom.window.document,
    makeFragment(html) {
      // Pitfall 2: fragments are built via template-context parsing,
      // never via an iframe srcdoc round-trip.
      const tpl = dom.window.document.createElement('template');
      tpl.innerHTML = html;
      return tpl.content;
    },
    serialize(fragment) {
      // Comparison-only serialization (the chokepoint itself never
      // serializes): a detached container receives a CLONE.
      const div = dom.window.document.createElement('div');
      div.appendChild(fragment.cloneNode(true));
      return div.innerHTML;
    },
    teardown() {
      dom.window.close();
    },
  };
}

/** Counter object matching the SanitizeCounters shape (caller-owned). */
function freshCounters() {
  return { strippedHandlers: 0, blockedUrls: 0, droppedSubtrees: 0, cssScrubs: 0 };
}

/** Recording logger: captures every warn call for aggregated-warn pins. */
function recordingLogger() {
  const warns = [];
  return {
    warns,
    info() {},
    warn(...args) { warns.push(args); },
    error() {},
  };
}

/** Every element under root (DocumentFragment or Element), in order. */
function allElements(root) {
  return Array.from(root.querySelectorAll('*'));
}

/** Every on*-named attribute anywhere under root, tagged for diagnostics. */
function onAttrsOf(root) {
  const found = [];
  for (const el of allElements(root)) {
    for (const attr of Array.from(el.attributes)) {
      if (/^on/i.test(attr.name)) found.push(el.tagName + '@' + attr.name);
    }
  }
  return found;
}

/** Every attribute value under root matching a probe regex. */
function attrValuesMatching(root, re) {
  const found = [];
  for (const el of allElements(root)) {
    for (const attr of Array.from(el.attributes)) {
      if (re.test(attr.value)) found.push(el.tagName + '@' + attr.name + '=' + attr.value);
    }
  }
  return found;
}

// --- Section 1: sanitizeFragment corpus -------------------------------------

test('sanitizeFragment strips the hostile corpus: on* attrs, srcdoc, script/noscript/object/embed subtrees', () => {
  const env = setupEnv();
  try {
    const frag = env.makeFragment(
      '<div class="wrap">'
        + '<button onclick="alert(1)">x</button>'
        + '<a href="javascript:alert(1)">link</a>'
        // string split keeps the Pitfall-2 grep clean: fixture markup,
        // never an srcdoc assignment on a live iframe
        + '<iframe ' + 'srcdoc="<p>nested</p>"></iframe>'
        + '<object data="javascript:alert(1)"></object>'
        + '<embed src="evil.swf">'
        + '<noscript><img src="x" onerror="alert(1)"></noscript>'
        + '<script>alert(1)</script>'
        + '</div>'
    );
    sanitizeFragment(frag, freshCounters(), recordingLogger());
    assert.deepEqual(onAttrsOf(frag), [], 'zero on* attributes anywhere in the fragment');
    assert.equal(
      frag.querySelectorAll('script, noscript, object, embed').length, 0,
      'script/noscript/object/embed subtrees all dropped (noscript explicitly -- Pitfall 9)'
    );
    const iframeEl = frag.querySelector('iframe');
    assert.ok(iframeEl, 'the iframe element itself survives (only its srcdoc attr is stripped)');
    assert.equal(iframeEl.hasAttribute('srcdoc'), false, 'srcdoc attribute removed');
    assert.equal(frag.querySelector('a').getAttribute('href'), '', 'javascript: href neutralized to empty');
    assert.ok(frag.querySelector('button'), 'the button itself survives (only its handler is stripped)');
  } finally {
    env.teardown();
  }
});

test('namespace-confusion math/mglyph payload yields a fragment with no onerror on any element', () => {
  const env = setupEnv();
  try {
    // Canonical mXSS vector (03-RESEARCH "Code Examples" / securitum.com):
    // the parser relocates the <img> across namespace boundaries -- the
    // walker must enumerate attributes on EVERY element regardless of
    // namespace, never rely on tag position.
    const frag = env.makeFragment(
      '<form><math><mtext></form><form><mglyph><style></math><img src onerror=alert(1)>'
    );
    sanitizeFragment(frag, freshCounters(), recordingLogger());
    assert.deepEqual(onAttrsOf(frag), [], 'onerror stripped wherever the parser relocated the img');
  } finally {
    env.teardown();
  }
});

test('xlink:href javascript: inside an svg subtree is neutralized; srcset is neutralized per-candidate', () => {
  const env = setupEnv();
  try {
    const frag = env.makeFragment(
      '<svg><a xlink:href="javascript:alert(1)"><text>c</text></a></svg>'
        + '<img srcset="javascript:alert(1) 1x, https://x.test/img.png 2x">'
    );
    sanitizeFragment(frag, freshCounters(), recordingLogger());
    assert.deepEqual(
      attrValuesMatching(frag, /javascript:/i), [],
      'no attribute value anywhere still carries a javascript: scheme'
    );
    const img = frag.querySelector('img');
    assert.ok(
      img.getAttribute('srcset').includes('https://x.test/img.png 2x'),
      'benign srcset candidate preserved (neutralization is per-candidate)'
    );
  } finally {
    env.teardown();
  }
});

test('style="width:expression(alert(1))" is scrubbed; benign style values pass through unchanged', () => {
  const env = setupEnv();
  try {
    const frag = env.makeFragment(
      '<div style="width:expression(alert(1))">x</div>'
        + '<p style="color: red">y</p>'
    );
    sanitizeFragment(frag, freshCounters(), recordingLogger());
    assert.ok(
      !/expression\(/i.test(frag.querySelector('div').getAttribute('style')),
      'expression() neutralized in the style value'
    );
    assert.equal(
      frag.querySelector('p').getAttribute('style'), 'color: red',
      'benign style value byte-identical (no rewrite when nothing scrubbed)'
    );
  } finally {
    env.teardown();
  }
});

test('a benign fragment is byte-identical before/after (fidelity pin), zero counters, zero warns', () => {
  const env = setupEnv();
  try {
    const frag = env.makeFragment(
      '<div class="card"><a href="https://x.test/page">go</a>'
        + '<img src="img/rel.png" alt="pic" srcset="img/a.png 1x, img/b.png 2x">'
        + '<span>text &amp; more</span>'
        + '<div class="nested"><p style="color: blue">deep</p></div></div>'
    );
    const before = env.serialize(frag);
    const counters = freshCounters();
    const log = recordingLogger();
    sanitizeFragment(frag, counters, log);
    assert.equal(env.serialize(frag), before, 'benign content renders identically');
    assert.deepEqual(counters, freshCounters(), 'no counter moved on benign content');
    assert.equal(log.warns.length, 0, 'zero warns on a benign fragment');
  } finally {
    env.teardown();
  }
});

test('counters increment per category and ONE aggregated [Renderer]-prefixed warn fires when strips occur', () => {
  const env = setupEnv();
  try {
    const frag = env.makeFragment(
      '<button onclick="alert(1)">x</button>'          // strippedHandlers +1
        + '<iframe ' + 'srcdoc="<p>n</p>"></iframe>'   // strippedHandlers +1
        + '<a href="javascript:alert(1)">y</a>'        // blockedUrls +1
        + '<script>alert(1)</script>'                  // droppedSubtrees +1
        + '<div style="width:expression(alert(1))">z</div>' // cssScrubs +1
    );
    const counters = freshCounters();
    const log = recordingLogger();
    sanitizeFragment(frag, counters, log);
    assert.equal(counters.strippedHandlers, 2, 'onclick + srcdoc counted as stripped handlers');
    assert.equal(counters.blockedUrls, 1, 'javascript: href counted as blocked URL');
    assert.equal(counters.droppedSubtrees, 1, 'script subtree counted as dropped');
    assert.equal(counters.cssScrubs, 1, 'expression() style counted as CSS scrub');
    assert.equal(log.warns.length, 1, 'exactly ONE aggregated warn per sanitizeFragment call');
    assert.ok(
      String(log.warns[0][0]).startsWith('[Renderer] sanitization strips'),
      'warn carries the [Renderer] sanitization strips prefix'
    );
  } finally {
    env.teardown();
  }
});

test('counters accumulate across calls (caller-owned lifecycle, never reset by the chokepoint)', () => {
  const env = setupEnv();
  try {
    const counters = freshCounters();
    const log = recordingLogger();
    sanitizeFragment(env.makeFragment('<b onclick="a()">1</b>'), counters, log);
    sanitizeFragment(env.makeFragment('<i onmouseover="b()">2</i>'), counters, log);
    assert.equal(counters.strippedHandlers, 2, 'second call accumulates onto the first');
    assert.equal(log.warns.length, 2, 'one aggregated warn per stripping call');
  } finally {
    env.teardown();
  }
});

// --- Section 1: sanitizeAttrValue rows ---------------------------------------

test('sanitizeAttrValue: on* and srcdoc drop; dangerous URL schemes neutralize; benign values pass', () => {
  assert.equal(sanitizeAttrValue('onclick', 'alert(1)').drop, true, 'onclick dropped');
  assert.equal(sanitizeAttrValue('ONLoad', 'x').drop, true, 'on* match is case-insensitive');
  assert.equal(sanitizeAttrValue('srcdoc', '<p>x</p>').drop, true, 'srcdoc dropped');

  const neutralized = sanitizeAttrValue('href', 'javascript:alert(1)');
  assert.equal(neutralized.drop, false, 'dangerous URL is neutralized, not dropped (href existence parity)');
  assert.equal(neutralized.value, '', 'javascript: href value cleared');
  assert.equal(sanitizeAttrValue('src', 'vbscript:msgbox(1)').value, '', 'vbscript: cleared');
  assert.equal(
    sanitizeAttrValue('href', 'data:text/html,<b>x</b>').value, '',
    'data:text/html cleared'
  );
  assert.equal(
    sanitizeAttrValue('href', ' java\tscript:alert(1)').value, '',
    'control-char/whitespace obfuscated scheme still detected'
  );

  const benign = sanitizeAttrValue('href', 'https://x.test');
  assert.equal(benign.drop, false);
  assert.equal(benign.value, 'https://x.test', 'benign https href unchanged');
  assert.equal(
    sanitizeAttrValue('src', 'data:image/png;base64,AAA').value,
    'data:image/png;base64,AAA',
    'data:image/* stays allowed'
  );

  const styled = sanitizeAttrValue('style', 'width:expression(alert(1))');
  assert.equal(styled.drop, false);
  assert.ok(!/expression\(/i.test(styled.value), 'style value goes through scrubCssText');

  const plain = sanitizeAttrValue('title', 'hello');
  assert.equal(plain.drop, false);
  assert.equal(plain.value, 'hello', 'non-special attribute passes through');
});

// --- Section 1: scrubCssText rows --------------------------------------------

test('scrubCssText neutralizes url(javascript:), expression(), -moz-binding, non-http @import, and the </style breakout', () => {
  const urlScrubbed = scrubCssText('background:url(javascript:alert(1))');
  assert.ok(!/url\(\s*javascript/i.test(urlScrubbed), 'url(javascript:) contents replaced');
  assert.ok(urlScrubbed.includes('about:blank'), 'replacement target is about:blank');

  assert.ok(!/expression\(/i.test(scrubCssText('width:expression(alert(1))')), 'expression() neutralized');
  assert.ok(!/-moz-binding/i.test(scrubCssText('-moz-binding:url(evil.xml#x)')), '-moz-binding neutralized');

  const importScrubbed = scrubCssText('@import "evil.css";');
  assert.ok(!/@import\s/i.test(importScrubbed), 'non-http @import neutralized');
  assert.ok(!importScrubbed.includes('evil.css'), 'non-http @import target removed');

  const breakout = scrubCssText('p { color: red } /* </style><img src=x onerror=a()> */');
  assert.ok(!breakout.includes('</style'), 'literal </style sequence rewritten');
});

test('scrubCssText passes relative url(), url(https://...), and url(data:image/...) byte-identical', () => {
  const rows = [
    'background:url(img/rel.png)',
    "background:url('img/rel.png')",
    'background:url(https://x.test/a.png)',
    'background:url("https://x.test/a.png")',
    'background:url(data:image/png;base64,AAAA)',
    'p { color: red; margin: 0 }',
    '@import url("https://x.test/a.css");',
  ];
  for (const css of rows) {
    assert.equal(scrubCssText(css), css, 'benign CSS byte-identical: ' + css);
  }
});

// --- Section 1: containment --------------------------------------------------

test('null tolerance: every export contains null/undefined input without throwing', () => {
  assert.doesNotThrow(() => sanitizeFragment(null));
  assert.doesNotThrow(() => sanitizeFragment(undefined, null, null));
  assert.equal(scrubCssText(null), '', 'scrubCssText maps null to empty string');
  assert.equal(scrubCssText(undefined), '', 'scrubCssText maps undefined to empty string');
  const shape = sanitizeAttrValue(null, null);
  assert.equal(typeof shape.drop, 'boolean', 'sanitizeAttrValue returns the {drop, value} shape');
  assert.equal(typeof shape.value, 'string');
});

test('Pitfall 2 discipline: this file never assigns srcdoc on an iframe', () => {
  // jsdom never parses srcdoc into contentDocument -- a test that assigned
  // it and asserted contentDocument would silently pass against an empty
  // document. Self-scan keeps the discipline durable.
  const self = readFileSync(fileURLToPath(import.meta.url), 'utf8');
  assert.ok(
    !/iframe\.srcdoc\s*=/.test(self),
    'no test in this file assigns iframe srcdoc (Pitfall 2)'
  );
});
