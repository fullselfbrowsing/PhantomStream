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
//   - inlineStyles and payload.html are inserted RAW (Pitfall 9 parity pin;
//     Phase 3 owns the sanitization chokepoint).

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

test('inlineStyles are wrapped raw -- a </style> inside CSS passes through unmodified', () => {
  const css = 'p { color: red; } /* </style> trap */';
  const html = buildSnapshotHtml(minimalPayload({ inlineStyles: [css] }));
  assert.ok(
    html.includes('<style>' + css + '</style>'),
    'CSS inserted raw (Pitfall 9 parity pin; Phase 3 owns sanitization)'
  );
});

test('payload.html is inserted raw between the body tags', () => {
  const body = '<div data-fsb-nid="7"><script>1 < 2 && "x"</script></div>';
  const html = buildSnapshotHtml(minimalPayload({ html: body }));
  assert.ok(
    html.includes('<body>' + body + '</body></html>'),
    'body html raw -- no escaping or normalizing (parity)'
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
