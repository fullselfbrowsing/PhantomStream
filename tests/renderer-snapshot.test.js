// Unit tests pinning the pure snapshot HTML builder (src/renderer/snapshot.js)
// against the reference assembly (reference/dashboard/dashboard.js:2671-2694
// escaper + shell attrs, :2785-2800 document assembly inside
// handleDOMSnapshot). Pure string assertions -- buildSnapshotHtml never
// touches the DOM, so no JSDOM here (flat node:test style per
// tests/capture-lifecycle.test.js).
//
// Parity pins of note:
//   - The reset CSS string is the exact srcdoc wrapper from 02-UI-SPEC.md.
//   - Stylesheet link hrefs escape ONLY double quotes (reference behavior).
//   - Phase 3 (plan 03-02): the adopted CSP meta is the first element after
//     <head>; inlineStyles entries are CSS-scrubbed at assembly (the old
//     raw pin DELIBERATELY FLIPPED); payload.html stays raw AT THE STRING
//     LAYER by design -- string-level scrubbing is the mXSS anti-pattern,
//     and that insertion point is protected by the capture chokepoint
//     upstream + the post-parse scrub + CSP + sandbox.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  escapeAttribute,
  buildShellAttributeString,
  buildSnapshotHtml,
} from '../src/renderer/snapshot.js';

const RESET_CSS = 'body { margin: 0; overflow: hidden; } *::selection { background: transparent; } ::-webkit-scrollbar { display: none; }';

/**
 * Minimal valid SnapshotPayload for the builder; overrides merge on top.
 * @param {Object} [overrides]
 */
function minimalPayload(overrides) {
  return Object.assign({
    html: '<div data-fsb-nid="1">hello</div>',
    stylesheets: [],
    inlineStyles: [],
    htmlAttrs: {},
    bodyAttrs: {},
    htmlStyle: '',
    bodyStyle: '',
  }, overrides || {});
}

test('output starts with the doctype+html shell and contains the charset meta', () => {
  const html = buildSnapshotHtml(minimalPayload());
  assert.ok(html.startsWith('<!DOCTYPE html><html'), 'starts with <!DOCTYPE html><html');
  assert.ok(html.includes('<meta charset="UTF-8">'), 'contains the charset meta');
});

// The ADOPTED policy (03-CONTEXT baseline adjusted via its documented-
// rationale clause: style-src gains http: https: so the external stylesheet
// links the capture deliberately emits keep loading; script-blocking is
// untouched -- default-src 'none' still governs scripts).
const CSP_CONTENT = "default-src 'none'; img-src http: https: data:; "
  + "style-src http: https: 'unsafe-inline'; font-src http: https: data:";

test('the exact adopted CSP meta is the FIRST element after <head>, before the charset meta', () => {
  const html = buildSnapshotHtml(minimalPayload());
  assert.ok(
    html.includes(
      '<head><meta http-equiv="Content-Security-Policy" content="'
        + CSP_CONTENT + '"><meta charset="UTF-8">'
    ),
    'CSP meta pinned verbatim, positioned before any parser-initiated fetch'
  );
});

test('the CSP meta contains no meta-unsupported directives (Pitfall 8)', () => {
  const html = buildSnapshotHtml(minimalPayload());
  // frame-ancestors / sandbox / report-uri are silently dropped when
  // delivered via <meta http-equiv> -- their presence would be a no-op
  // masquerading as a control (the iframe-level sandbox attribute is the
  // analogous real control, asserted in renderer-viewer tests).
  assert.ok(!html.includes('frame-ancestors'), 'no frame-ancestors directive');
  assert.ok(!html.includes('sandbox'), 'no sandbox directive');
  assert.ok(!html.includes('report-uri'), 'no report-uri directive');
});

test('viewport meta defaults to width=1920 and honors payload.viewportWidth', () => {
  const def = buildSnapshotHtml(minimalPayload());
  assert.ok(
    def.includes('<meta name="viewport" content="width=1920">'),
    'defaults to width=1920 when viewportWidth is absent'
  );
  const sized = buildSnapshotHtml(minimalPayload({ viewportWidth: 1366 }));
  assert.ok(
    sized.includes('<meta name="viewport" content="width=1366">'),
    'uses the provided viewportWidth'
  );
  assert.ok(!sized.includes('width=1920'), 'no default leaks when viewportWidth provided');
});

test('viewportWidth is numerically coerced -- wire values can never break out of the meta attribute (WR-03)', () => {
  // Leading-digit breakout probe: parseInt keeps only the numeric prefix,
  // so the markup payload never reaches the srcdoc head.
  const breakout = buildSnapshotHtml(minimalPayload({
    viewportWidth: '1"><img src=x onerror=alert(1)>',
  }));
  assert.ok(
    breakout.includes('<meta name="viewport" content="width=1">'),
    'only the numeric prefix survives coercion'
  );
  assert.ok(!breakout.includes('onerror'), 'probe markup never reaches the srcdoc head');
  // Entirely non-numeric input falls back to the 1920 default.
  const garbage = buildSnapshotHtml(minimalPayload({
    viewportWidth: '"><script>x</script>',
  }));
  assert.ok(
    garbage.includes('<meta name="viewport" content="width=1920">'),
    'non-numeric input falls back to the default'
  );
  assert.ok(!garbage.includes('<script>'), 'no breakout markup in the srcdoc head');
});

test('exact parity reset CSS string is present inside a style tag', () => {
  const html = buildSnapshotHtml(minimalPayload());
  assert.ok(
    html.includes('<style>' + RESET_CSS + '</style>'),
    'reset CSS style tag present verbatim (02-UI-SPEC parity wrapper)'
  );
});

test('stylesheet URLs render as link tags with only double quotes escaped', () => {
  const html = buildSnapshotHtml(minimalPayload({
    stylesheets: ['https://x.test/a.css', 'https://x.test/weird"&<>.css'],
  }));
  assert.ok(
    html.includes('<link rel="stylesheet" href="https://x.test/a.css">'),
    'plain URL renders as a link tag'
  );
  assert.ok(
    html.includes('<link rel="stylesheet" href="https://x.test/weird&quot;&<>.css">'),
    'only " is escaped to &quot; -- & < > pass through (reference parity)'
  );
});

test('stylesheet URLs with dangerous schemes are filtered at srcdoc assembly', () => {
  const html = buildSnapshotHtml(minimalPayload({
    stylesheets: [
      'javascript:alert(1)',
      'vbscript:msgbox(1)',
      'data:text/html,<b>x</b>',
      'https://x.test/a.css',
    ],
  }));
  assert.ok(!/javascript:|vbscript:|data:text\/html/i.test(html), 'dangerous stylesheet URLs absent');
  assert.ok(
    html.includes('<link rel="stylesheet" href="https://x.test/a.css">'),
    'benign stylesheet URL still renders'
  );
});

test('inlineStyles are CSS-scrubbed at assembly -- </style> breakout and url(javascript:) neutralized, benign CSS byte-identical', () => {
  // DELIBERATE FLIP of the raw parity pin (plan 03-02 Task 3): inline CSS
  // now routes through scrubCssText before the style tag is assembled.
  const hostile = 'p { background: url(javascript:alert(1)); } /* </style> trap */';
  const html = buildSnapshotHtml(minimalPayload({ inlineStyles: [hostile] }));
  assert.ok(!html.includes('</style> trap'), 'literal </style sequence cannot break out of the style tag');
  assert.ok(html.includes('<\\/style> trap'), 'breakout sequence rewritten, comment text otherwise kept');
  assert.ok(!/url\(\s*javascript/i.test(html), 'url(javascript:) scrubbed inside the emitted CSS');
  assert.ok(html.includes('url(about:blank)'), 'dangerous url() contents replaced with about:blank');

  const benign = 'p { color: red; margin: 0 }';
  const benignHtml = buildSnapshotHtml(minimalPayload({ inlineStyles: [benign] }));
  assert.ok(
    benignHtml.includes('<style>' + benign + '</style>'),
    'benign CSS passes byte-identical through the scrub'
  );
});

test('payload.html is inserted raw between the body tags AT THE STRING LAYER', () => {
  // KEPT pin, re-rationalized (plan 03-02 Task 3): string-level scrubbing
  // of the body html is the mXSS anti-pattern (scrub-then-reparse), so
  // this insertion point is deliberately untouched here. Its protection is
  // the layered chain: capture chokepoint upstream + the viewer's
  // post-parse sanitizeFragment scrub on load + the CSP meta + the
  // allow-same-origin-only sandbox.
  const body = '<div data-fsb-nid="7"><script>1 < 2 && "x"</script></div>';
  const html = buildSnapshotHtml(minimalPayload({ html: body }));
  assert.ok(
    html.includes('<body>' + body + '</body></html>'),
    'body html raw at the string layer -- no escaping or normalizing'
  );
});

test('htmlAttrs/htmlStyle and bodyAttrs/bodyStyle flow through the shell attribute builder', () => {
  const html = buildSnapshotHtml(minimalPayload({
    htmlAttrs: { lang: 'en', onclick: 'x()' },
    htmlStyle: 'background: #fff;',
    bodyAttrs: { class: 'dark' },
    bodyStyle: 'margin: 0;',
  }));
  assert.ok(
    html.includes('<html lang="en" style="background: #fff;">'),
    'html shell keeps lang + style, drops onclick'
  );
  assert.ok(
    html.includes('<body class="dark" style="margin: 0;">'),
    'body shell keeps class + style'
  );
});

test('buildShellAttributeString filters names, drops style/on*/invalid/null, appends styleText', () => {
  const out = buildShellAttributeString({
    Class: 'Page',          // lowercased to class -- kept
    style: 'color: red',    // dropped: style key
    onclick: 'alert(1)',    // dropped: on* prefix
    ONLoad: 'x',            // lowercases to onload -- dropped: on* prefix
    '1bad': 'x',            // dropped: fails /^[a-z][a-z0-9_:.~-]*$/
    'bad name': 'x',        // dropped: space fails the name regex
    'data-x': null,         // dropped: null value
    'data-y': undefined,    // dropped: undefined value
    lang: 'en',
  }, '  margin: 0;  ');
  assert.equal(out, ' class="Page" lang="en" style="margin: 0;"');
});

test('buildShellAttributeString returns empty string when nothing survives', () => {
  assert.equal(buildShellAttributeString(null, ''), '');
  assert.equal(buildShellAttributeString({}, '   '), '');
  assert.equal(buildShellAttributeString({ onclick: 'x()', style: 'a' }, ''), '');
});

test('buildShellAttributeString escapes attribute values via escapeAttribute', () => {
  const out = buildShellAttributeString({ title: '<a> & "b"' }, '');
  assert.equal(out, ' title="&lt;a&gt; &amp; &quot;b&quot;"');
});

test('escapeAttribute maps null/undefined to empty string and escapes & " < > in order', () => {
  assert.equal(escapeAttribute(null), '');
  assert.equal(escapeAttribute(undefined), '');
  assert.equal(escapeAttribute('&"<>'), '&amp;&quot;&lt;&gt;');
  assert.equal(escapeAttribute('a&b"c<d>e'), 'a&amp;b&quot;c&lt;d&gt;e');
  // &-first ordering: a pre-existing entity gets its & re-escaped
  assert.equal(escapeAttribute('&quot;'), '&amp;quot;');
});
