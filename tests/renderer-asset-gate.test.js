// RED Wave-0 scaffold -- filled by Plan 12-03.
// Requirements covered: ASST-02 (background-image + <video> poster render under
// img-src), ASST-03 (currentSrc pin + srcset/sizes neutralization at the viewer),
// ASST-05 (CSP confirm-only -- unchanged), MSEC-01 (pre-write fetch gate ->
// dimensioned placeholder for blocked origins), MSEC-02 (mediaMode off/poster/
// reference posture). These are the Nyquist minimum jsdom cases from
// 12-VALIDATION.md; they FAIL until Plan 12-03 adds gateAssetUrl + the
// mediaMode/assetOriginPolicy/allowAssetOrigins config and the pre-write gate
// to src/renderer/index.js.
//
// RED mechanism: src/renderer/index.js exports createViewer today but does NOT
// export gateAssetUrl yet, and createViewer does not yet honor the asset config.
// Each test dynamically imports the module and exercises the (currently
// undefined) export / unimplemented behavior -- producing a per-test FAILURE
// rather than a module-load/syntax error. The file parses and runs cleanly.
//
// jsdom srcdoc write-glue (glueMirror) is the same recipe every renderer-gate
// test reuses (tests/renderer-loopback.test.js:260-267): jsdom never parses the
// srcdoc attribute into contentDocument, so the browser navigation is simulated
// manually -- cd.open(); cd.write(srcdoc); cd.close(); dispatch load.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const RENDERER_MODULE = '../src/renderer/index.js';

/**
 * SRCDOC WRITE-GLUE (mirrors glueMirror in tests/renderer-loopback.test.js):
 * jsdom 29 never parses the srcdoc attribute into contentDocument, so simulate
 * the browser's srcdoc navigation manually and dispatch the synthetic load the
 * viewer's persistent listener waits on. Re-run after every re-snapshot.
 * @param {Element} iframe
 * @returns {Document} the populated mirror contentDocument
 */
function glueMirror(iframe) {
  const cd = iframe.contentDocument;
  cd.open();
  cd.write(iframe.getAttribute('srcdoc'));
  cd.close();
  iframe.dispatchEvent(new iframe.ownerDocument.defaultView.Event('load'));
  return cd;
}

/** Fresh jsdom host with a mount container for createViewer. */
function makeHost() {
  const dom = new JSDOM('<!DOCTYPE html><html><body><div id="mirror-container"></div></body></html>', {
    url: 'https://viewer.fixture.test/',
  });
  return { dom, document: dom.window.document, mount: dom.window.document.getElementById('mirror-container') };
}

/** A snapshot payload referencing a single <img> by absolute https URL. */
function snapshotWith(html) {
  return {
    type: 'ext:dom-snapshot',
    payload: {
      html,
      stylesheets: [],
      inlineStyles: [],
      streamSessionId: 'stream_gate_1',
      snapshotId: 1718870000000,
    },
  };
}

test('gateAssetUrl is exported as a pure pre-write fetch gate (MSEC-01)', async () => {
  const renderer = await import(RENDERER_MODULE);
  assert.equal(
    typeof renderer.gateAssetUrl,
    'function',
    'Plan 12-03 must export gateAssetUrl(url, ctx) -> { allow: boolean } for the pre-write gate'
  );
});

test("mediaMode:'reference' writes an allowed public-https <img> src into the mirror (MSEC-02)", async () => {
  const renderer = await import(RENDERER_MODULE);
  const host = makeHost();
  const viewer = renderer.createViewer({ document: host.document, mount: host.mount, mediaMode: 'reference' });
  viewer.handleSnapshot(snapshotWith('<img data-fsb-nid="1" src="https://cdn.example.com/a.png">'));
  const iframe = host.mount.querySelector('iframe');
  const cd = glueMirror(iframe);
  const img = cd.querySelector('img[data-fsb-nid="1"]');
  assert.ok(img, 'the allowed <img> is present in the mirror');
  assert.equal(img.getAttribute('src'), 'https://cdn.example.com/a.png', "mediaMode 'reference' keeps the by-reference src");
});

test("mediaMode:'off' writes NO asset src -- a placeholder instead (MSEC-02)", async () => {
  const renderer = await import(RENDERER_MODULE);
  const host = makeHost();
  const viewer = renderer.createViewer({ document: host.document, mount: host.mount, mediaMode: 'off' });
  viewer.handleSnapshot(snapshotWith('<img data-fsb-nid="1" src="https://cdn.example.com/a.png">'));
  const cd = glueMirror(host.mount.querySelector('iframe'));
  assert.equal(cd.querySelector('img[src]'), null, "mediaMode 'off' never writes a fetchable asset src");
  assert.ok(
    cd.querySelector('[data-ps-asset-unavailable]'),
    "mediaMode 'off' leaves a dimensioned placeholder instead of an asset fetch"
  );
});

test("mediaMode:'poster' allows the poster path but withholds full-asset fetch (MSEC-02)", async () => {
  const renderer = await import(RENDERER_MODULE);
  const host = makeHost();
  const viewer = renderer.createViewer({ document: host.document, mount: host.mount, mediaMode: 'poster' });
  assert.equal(typeof renderer.gateAssetUrl, 'function', 'Plan 12-03 must export gateAssetUrl');
  // Poster posture: a poster image is still gated by origin, full asset withheld.
  const gate = renderer.gateAssetUrl('https://cdn.example.com/poster.jpg', { mediaMode: 'poster', kind: 'poster' });
  assert.equal(gate.allow, true, "mediaMode 'poster' still permits an allowed poster image");
});

test('a blocked-origin <img> is never written; data-ps-asset-unavailable="blocked-origin" placeholder present (MSEC-01)', async () => {
  const renderer = await import(RENDERER_MODULE);
  const host = makeHost();
  const viewer = renderer.createViewer({ document: host.document, mount: host.mount, mediaMode: 'reference' });
  viewer.handleSnapshot(snapshotWith('<img data-fsb-nid="1" src="https://169.254.169.254/a.png">'));
  const cd = glueMirror(host.mount.querySelector('iframe'));
  assert.equal(cd.querySelector('img[src*="169.254"]'), null, 'the blocked-origin URL is never written into the mirror (no GET)');
  const placeholder = cd.querySelector('[data-ps-asset-unavailable="blocked-origin"]');
  assert.ok(placeholder, 'a dimensioned blocked-origin placeholder replaces the blocked <img>');
});

test('a snapshot whose data-ps-currentsrc differs -> effective src pinned, srcset/sizes neutralized (ASST-03)', async () => {
  const renderer = await import(RENDERER_MODULE);
  const host = makeHost();
  const viewer = renderer.createViewer({ document: host.document, mount: host.mount, mediaMode: 'reference' });
  viewer.handleSnapshot(snapshotWith(
    '<img data-fsb-nid="1" src="https://cdn.example.com/1x.png"'
    + ' srcset="https://cdn.example.com/1x.png 1x, https://cdn.example.com/2x.png 2x"'
    + ' sizes="100vw" data-ps-currentsrc="https://cdn.example.com/2x.png">'
  ));
  const cd = glueMirror(host.mount.querySelector('iframe'));
  const img = cd.querySelector('img[data-fsb-nid="1"]');
  assert.ok(img, 'the pinned image is present');
  assert.equal(img.getAttribute('src'), 'https://cdn.example.com/2x.png', 'effective src is pinned to data-ps-currentsrc');
  assert.equal(img.getAttribute('srcset'), null, 'srcset is neutralized so the viewer DPR cannot re-negotiate');
  assert.equal(img.getAttribute('sizes'), null, 'sizes is neutralized too');
});

test('a throwing assetOriginPolicy hook fails CLOSED -> blocked placeholder, never opened (MSEC-01)', async () => {
  const renderer = await import(RENDERER_MODULE);
  const host = makeHost();
  const viewer = renderer.createViewer({
    document: host.document,
    mount: host.mount,
    mediaMode: 'reference',
    assetOriginPolicy: function () { throw new Error('boom'); },
  });
  viewer.handleSnapshot(snapshotWith('<img data-fsb-nid="1" src="https://cdn.example.com/a.png">'));
  const cd = glueMirror(host.mount.querySelector('iframe'));
  assert.equal(cd.querySelector('img[src]'), null, 'a throwing host hook blocks the fetch (fail-closed)');
  assert.ok(cd.querySelector('[data-ps-asset-unavailable]'), 'a placeholder replaces the asset when the hook throws');
});

test("allowAssetOrigins:['cdn.example.com'] lets that origin pass the gate (MSEC-01)", async () => {
  const renderer = await import(RENDERER_MODULE);
  assert.equal(typeof renderer.gateAssetUrl, 'function', 'Plan 12-03 must export gateAssetUrl');
  const gate = renderer.gateAssetUrl('https://cdn.example.com/a.png', {
    mediaMode: 'reference',
    allowAssetOrigins: ['cdn.example.com'],
  });
  assert.equal(gate.allow, true, 'an explicitly allowlisted origin passes the gate');
});

// ---- Review CR-02: snapshot string gate must be quote-aware (tag-split bypass) ----
// A `>` inside a quoted attribute value before `src` previously terminated the
// naive `/<img\b([^>]*)>/` match short of the src, so the blocked URL slipped
// through unchanged and the parser fetched it. These are the EXACT payloads the
// reviewer verified against the shipped code; each must now be BLOCKED.
const TAG_SPLIT_PAYLOADS = [
  { html: '<img data-fsb-nid="1" alt="a>b" src="https://169.254.169.254/x.png">', host: '169.254', note: 'alt with > before metadata src' },
  { html: '<img data-fsb-nid="1" data-x="a>b" src="https://10.0.0.1/x.png">', host: '10.0.0.1', note: 'data-* with > before private src' },
  { html: '<img data-fsb-nid="1" title=">" src="https://169.254.169.254/x.png">', host: '169.254', note: 'title=">" before metadata src' },
  { html: "<img data-fsb-nid=\"1\" alt='a>b' src='https://10.0.0.1/x.png'>", host: '10.0.0.1', note: 'single-quoted alt with > before private src' },
  { html: '<img data-fsb-nid="1" data-ps-currentsrc="x>y" src="https://169.254.169.254/x.png">', host: '169.254', note: 'data-ps-currentsrc with > then blocked src' },
];

for (const payload of TAG_SPLIT_PAYLOADS) {
  test('snapshot gate BLOCKS tag-split bypass: ' + payload.note + ' (CR-02)', async () => {
    const renderer = await import(RENDERER_MODULE);
    const host = makeHost();
    const viewer = renderer.createViewer({ document: host.document, mount: host.mount, mediaMode: 'reference' });
    viewer.handleSnapshot(snapshotWith(payload.html));
    const cd = glueMirror(host.mount.querySelector('iframe'));
    assert.equal(
      cd.querySelector('img[src*="' + payload.host + '"]'),
      null,
      'the blocked-origin src after an in-attribute ">" must never reach the mirror (no GET): ' + payload.note
    );
    assert.ok(
      cd.querySelector('[data-ps-asset-unavailable="blocked-origin"]'),
      'a dimensioned placeholder replaces the tag-split <img>: ' + payload.note
    );
  });
}

test('snapshot gate fails CLOSED on an <img> with an unbalanced quote (CR-02)', async () => {
  const renderer = await import(RENDERER_MODULE);
  const host = makeHost();
  const viewer = renderer.createViewer({ document: host.document, mount: host.mount, mediaMode: 'reference' });
  // The first quote never closes; the naive regex would have terminated at the
  // first '>' and emitted a fetchable blocked src. The quote-aware scan can't
  // bound the tag, so it fails closed -> placeholder, no fetchable blocked URL.
  viewer.handleSnapshot(snapshotWith('<img data-fsb-nid="1" alt="oops src="https://169.254.169.254/x.png">'));
  const cd = glueMirror(host.mount.querySelector('iframe'));
  assert.equal(cd.querySelector('img[src*="169.254"]'), null, 'an unparseable <img> never emits a fetchable blocked src');
  assert.ok(cd.querySelector('[data-ps-asset-unavailable]'), 'an unparseable <img> degrades to a placeholder (fail-closed)');
});

test('snapshot gate keeps an allowed src even when an earlier attribute contains ">" (CR-02 fidelity)', async () => {
  const renderer = await import(RENDERER_MODULE);
  const host = makeHost();
  const viewer = renderer.createViewer({ document: host.document, mount: host.mount, mediaMode: 'reference' });
  viewer.handleSnapshot(snapshotWith('<img data-fsb-nid="1" alt="a>b" src="https://cdn.example.com/a.png">'));
  const cd = glueMirror(host.mount.querySelector('iframe'));
  const img = cd.querySelector('img[data-fsb-nid="1"]');
  assert.ok(img, 'the allowed <img> survives the quote-aware scan');
  assert.equal(img.getAttribute('src'), 'https://cdn.example.com/a.png', 'allowed src is preserved despite the in-attribute ">"');
});

// ---- Review WR-03/WR-04: srcset must be origin-gated on every write site ----

test('snapshot gate replaces an <img srcset> (no src) whose only candidate is blocked (WR-04)', async () => {
  const renderer = await import(RENDERER_MODULE);
  const host = makeHost();
  const viewer = renderer.createViewer({ document: host.document, mount: host.mount, mediaMode: 'reference' });
  viewer.handleSnapshot(snapshotWith('<img data-fsb-nid="1" srcset="https://169.254.169.254/x.png 2x">'));
  const cd = glueMirror(host.mount.querySelector('iframe'));
  assert.equal(cd.querySelector('img[srcset*="169.254"]'), null, 'a blocked srcset candidate (no src) must never reach the mirror');
  assert.ok(cd.querySelector('[data-ps-asset-unavailable]'), 'a src-less <img> with a blocked srcset degrades to a placeholder');
});

// The diff ATTR gate is exercised through the exported applyMutations seam
// (the same seam createViewer wires into the live mirror via
// identity.gateAssetUrl) so the test does not need a wire transport. The gate
// closure mirrors createViewer's gateAsset binding exactly.
function makeDiffDoc(innerHtml) {
  const dom = new JSDOM('<!DOCTYPE html><html><body>' + innerHtml + '</body></html>');
  return dom.window.document;
}

test('diff ATTR gate BLOCKS a srcset mutation pointing at a blocked origin (WR-03)', async () => {
  const renderer = await import(RENDERER_MODULE);
  const doc = makeDiffDoc('<img id="t" data-fsb-nid="1" src="https://cdn.example.com/a.png">');
  const img = doc.getElementById('t');
  const counters = { staleMisses: 0, applyFailures: 0 };
  renderer.applyMutations(doc, [
    { op: 'attr', nid: '1', attr: 'srcset', val: 'https://169.254.169.254/x.png 2x' },
  ], counters, {
    logger: { warn: function () {} },
    identity: {
      resolve: function (nid) { return String(nid) === '1' ? img : null; },
      gateAssetUrl: function (url, kind) { return renderer.gateAssetUrl(url, { mediaMode: 'reference', kind: kind }); },
    },
  });
  assert.equal(img.getAttribute('srcset'), null, 'a blocked srcset mutation is dropped, never written to the live DOM (no GET)');
});

test('diff ATTR gate keeps an allowed srcset mutation (WR-03 fidelity)', async () => {
  const renderer = await import(RENDERER_MODULE);
  const doc = makeDiffDoc('<img id="t" data-fsb-nid="1" src="https://cdn.example.com/a.png">');
  const img = doc.getElementById('t');
  const counters = { staleMisses: 0, applyFailures: 0 };
  renderer.applyMutations(doc, [
    { op: 'attr', nid: '1', attr: 'srcset', val: 'https://cdn.example.com/2x.png 2x' },
  ], counters, {
    logger: { warn: function () {} },
    identity: {
      resolve: function (nid) { return String(nid) === '1' ? img : null; },
      gateAssetUrl: function (url, kind) { return renderer.gateAssetUrl(url, { mediaMode: 'reference', kind: kind }); },
    },
  });
  assert.equal(img.getAttribute('srcset'), 'https://cdn.example.com/2x.png 2x', 'an all-allowed srcset mutation is written through');
});

test('diff ATTR gate BLOCKS a srcset mutation where only ONE candidate is internal (WR-03)', async () => {
  const renderer = await import(RENDERER_MODULE);
  const doc = makeDiffDoc('<img id="t" data-fsb-nid="1" src="https://cdn.example.com/a.png">');
  const img = doc.getElementById('t');
  const counters = { staleMisses: 0, applyFailures: 0 };
  renderer.applyMutations(doc, [
    { op: 'attr', nid: '1', attr: 'srcset', val: 'https://cdn.example.com/1x.png 1x, https://169.254.169.254/2x.png 2x' },
  ], counters, {
    logger: { warn: function () {} },
    identity: {
      resolve: function (nid) { return String(nid) === '1' ? img : null; },
      gateAssetUrl: function (url, kind) { return renderer.gateAssetUrl(url, { mediaMode: 'reference', kind: kind }); },
    },
  });
  assert.equal(img.getAttribute('srcset'), null, 'a single blocked candidate drops the WHOLE srcset (no GET on the blocked variant)');
});

// ---- Review WR-02: an unencoded comma in an http(s) srcset query must NOT
// mis-split a benign candidate (which then fails the gate and over-blocks the
// whole <img> to a placeholder). The parser keeps in-query commas attached to a
// scheme-bearing absolute URL, mirroring the data: carve-out. Fails SAFE today
// (over-block), so this pins the fidelity fix, not a security boundary. ----

test('snapshot gate does NOT over-block a benign srcset with a comma in the http(s) query (WR-02)', async () => {
  const renderer = await import(RENDERER_MODULE);
  const host = makeHost();
  const viewer = renderer.createViewer({ document: host.document, mount: host.mount, mediaMode: 'reference' });
  viewer.handleSnapshot(snapshotWith(
    '<img data-fsb-nid="1" src="https://good.example.com/a.png"'
      + ' srcset="https://good.example.com/a.png?w=1,2 1x">'
  ));
  const cd = glueMirror(host.mount.querySelector('iframe'));
  const img = cd.querySelector('img[data-fsb-nid="1"]');
  assert.ok(img, 'a benign comma-in-query srcset must render as a real <img>, not a placeholder');
  assert.equal(cd.querySelector('[data-ps-asset-unavailable]'), null, 'no blocked-origin placeholder for an all-allowed srcset');
  assert.ok(
    (img.getAttribute('srcset') || '').includes('https://good.example.com/a.png?w=1,2'),
    'the in-query comma stays attached to the URL (candidate not split into a bogus "2")'
  );
});

test('diff ATTR gate keeps a benign comma-in-query http(s) srcset mutation (WR-02 fidelity)', async () => {
  const renderer = await import(RENDERER_MODULE);
  const doc = makeDiffDoc('<img id="t" data-fsb-nid="1" src="https://good.example.com/a.png">');
  const img = doc.getElementById('t');
  const counters = { staleMisses: 0, applyFailures: 0 };
  renderer.applyMutations(doc, [
    { op: 'attr', nid: '1', attr: 'srcset', val: 'https://good.example.com/a.png?w=1,2 1x, https://good.example.com/b.png?w=3,4 2x' },
  ], counters, {
    logger: { warn: function () {} },
    identity: {
      resolve: function (nid) { return String(nid) === '1' ? img : null; },
      gateAssetUrl: function (url, kind) { return renderer.gateAssetUrl(url, { mediaMode: 'reference', kind: kind }); },
    },
  });
  assert.equal(
    img.getAttribute('srcset'),
    'https://good.example.com/a.png?w=1,2 1x, https://good.example.com/b.png?w=3,4 2x',
    'an all-allowed srcset with in-query commas is written through unchanged (not mis-split, not dropped)'
  );
});

// ---- Codex P2: the diff ATTR gate must pick the gate KIND from the live
// element so poster mode withholds playable media on a src MUTATION the same
// way the snapshot/fragment paths do. Gating every src as 'image' let a
// poster-mode `video.src = <public-https>` mutation write playable bytes to the
// live mirror. ----

test('diff ATTR gate: poster mode drops a <video src> mutation even for an allowed origin (Codex P2)', async () => {
  const renderer = await import(RENDERER_MODULE);
  const doc = makeDiffDoc('<video id="t" data-fsb-nid="1"></video>');
  const video = doc.getElementById('t');
  const counters = { staleMisses: 0, applyFailures: 0 };
  renderer.applyMutations(doc, [
    { op: 'attr', nid: '1', attr: 'src', val: 'https://cdn.example.com/clip.mp4' },
  ], counters, {
    logger: { warn: function () {} },
    identity: {
      resolve: function (nid) { return String(nid) === '1' ? video : null; },
      gateAssetUrl: function (url, kind) { return renderer.gateAssetUrl(url, { mediaMode: 'poster', kind: kind }); },
    },
  });
  assert.equal(video.getAttribute('src'), null, 'poster mode must not let a <video src> mutation write a playable media URL to the live mirror (poster-mode-media)');
});

test('diff ATTR gate: poster mode drops a <source src> mutation (Codex P2)', async () => {
  const renderer = await import(RENDERER_MODULE);
  const doc = makeDiffDoc('<video><source id="t" data-fsb-nid="1"></source></video>');
  const source = doc.getElementById('t');
  const counters = { staleMisses: 0, applyFailures: 0 };
  renderer.applyMutations(doc, [
    { op: 'attr', nid: '1', attr: 'src', val: 'https://cdn.example.com/clip.webm' },
  ], counters, {
    logger: { warn: function () {} },
    identity: {
      resolve: function (nid) { return String(nid) === '1' ? source : null; },
      gateAssetUrl: function (url, kind) { return renderer.gateAssetUrl(url, { mediaMode: 'poster', kind: kind }); },
    },
  });
  assert.equal(source.getAttribute('src'), null, 'poster mode must not let a <source src> mutation write a playable media URL to the live mirror');
});

test('diff ATTR gate: reference mode writes an allowed <video src> mutation through (Codex P2 counterpoint)', async () => {
  const renderer = await import(RENDERER_MODULE);
  const doc = makeDiffDoc('<video id="t" data-fsb-nid="1"></video>');
  const video = doc.getElementById('t');
  const counters = { staleMisses: 0, applyFailures: 0 };
  renderer.applyMutations(doc, [
    { op: 'attr', nid: '1', attr: 'src', val: 'https://cdn.example.com/clip.mp4' },
  ], counters, {
    logger: { warn: function () {} },
    identity: {
      resolve: function (nid) { return String(nid) === '1' ? video : null; },
      gateAssetUrl: function (url, kind) { return renderer.gateAssetUrl(url, { mediaMode: 'reference', kind: kind }); },
    },
  });
  assert.equal(video.getAttribute('src'), 'https://cdn.example.com/clip.mp4', 'reference mode writes an allowed-origin <video src> mutation through (mode-scoped, not a blanket media kill)');
});

test('diff ATTR gate: poster mode still writes an allowed <img src> mutation through (Codex P2 image path intact)', async () => {
  const renderer = await import(RENDERER_MODULE);
  const doc = makeDiffDoc('<img id="t" data-fsb-nid="1">');
  const img = doc.getElementById('t');
  const counters = { staleMisses: 0, applyFailures: 0 };
  renderer.applyMutations(doc, [
    { op: 'attr', nid: '1', attr: 'src', val: 'https://cdn.example.com/a.png' },
  ], counters, {
    logger: { warn: function () {} },
    identity: {
      resolve: function (nid) { return String(nid) === '1' ? img : null; },
      gateAssetUrl: function (url, kind) { return renderer.gateAssetUrl(url, { mediaMode: 'poster', kind: kind }); },
    },
  });
  assert.equal(img.getAttribute('src'), 'https://cdn.example.com/a.png', 'poster mode keeps an allowed <img src> (images are permitted; only playable media is withheld)');
});

test('parseSrcsetCandidates keeps in-query commas on absolute URLs but still splits relative/data candidates (WR-02)', async () => {
  const { parseSrcsetCandidates } = await import('../src/renderer/sanitize.js');
  // Absolute http(s): the in-query comma stays attached (one candidate).
  assert.deepEqual(
    parseSrcsetCandidates('https://good.example.com/a.png?w=1,2 1x'),
    [{ url: 'https://good.example.com/a.png?w=1,2', descriptor: '1x' }],
    'http(s) in-query comma does not split the candidate'
  );
  // Two absolute candidates with in-query commas split only at the descriptor/comma boundary.
  assert.deepEqual(
    parseSrcsetCandidates('https://a.com/x?p=1,2 1x, https://b.com/y?q=3,4 2x'),
    [
      { url: 'https://a.com/x?p=1,2', descriptor: '1x' },
      { url: 'https://b.com/y?q=3,4', descriptor: '2x' },
    ],
    'inter-candidate comma still separates two absolute URLs'
  );
  // data: candidates remain intact (WR-03/WR-04 must not regress).
  assert.deepEqual(
    parseSrcsetCandidates('data:image/png;base64,AAAA 1x, https://b.com/y 2x'),
    [
      { url: 'data:image/png;base64,AAAA', descriptor: '1x' },
      { url: 'https://b.com/y', descriptor: '2x' },
    ],
    'data: comma stays attached; the next absolute candidate still splits'
  );
  // Scheme-less (relative) URLs still split on comma as separators.
  assert.deepEqual(
    parseSrcsetCandidates('a.png 1x, b.png 2x'),
    [
      { url: 'a.png', descriptor: '1x' },
      { url: 'b.png', descriptor: '2x' },
    ],
    'relative candidates have no scheme carve-out and split on the comma'
  );
});

// ---- Review WR-01: the quote-aware scanner must FAIL CLOSED on a backtick-
// unquoted attribute value carrying `>` (backtick is not an HTML quote char).
// The scanner is now backtick-aware (stops at the real later `>`, the SAFE
// over-block direction); a residual unbalanced backtick to EOF still fails
// closed via attrsBlobIsUnreliable. Neither variant may re-emit a fetchable
// blocked src unmodified. ----

test('snapshot gate fails CLOSED on a backtick-unquoted value with ">" before a blocked src (WR-01)', async () => {
  const renderer = await import(RENDERER_MODULE);
  const host = makeHost();
  const viewer = renderer.createViewer({ document: host.document, mount: host.mount, mediaMode: 'reference' });
  // The `>` lives inside a backtick-unquoted value; the prior scanner stopped
  // there and re-emitted the opener with the metadata src intact. The
  // backtick-aware scan now reads the real later `>`, gates the blocked src,
  // and emits a placeholder -- the metadata host never survives in the output.
  viewer.handleSnapshot(snapshotWith('<img data-fsb-nid="1" alt=`a>b` src="https://169.254.169.254/x.png">'));
  const cd = glueMirror(host.mount.querySelector('iframe'));
  assert.equal(cd.querySelector('img[src*="169.254"]'), null, 'the blocked src after a backtick ">" must never reach the mirror');
  assert.ok(cd.querySelector('[data-ps-asset-unavailable]'), 'a backtick-divergent <img> with a blocked src degrades to a placeholder (fail-closed)');
});

test('snapshot gate string output drops the metadata host for a backtick ">" passthrough shape (WR-01)', async () => {
  const { gateSnapshotAssets } = await import('../src/renderer/snapshot.js');
  const gate = function (url) { return { allow: /^https:\/\/cdn\.example\.com\//.test(url) }; };
  const out = gateSnapshotAssets('<img data-fsb-nid="1" alt=`a>b` src="https://169.254.169.254/x.png">', gate);
  assert.equal(out.indexOf('169.254'), -1, 'no `<img>` shape re-emits the blocked metadata host unmodified (was a passthrough)');
  assert.ok(out.indexOf('data-ps-asset-unavailable="blocked-origin"') !== -1, 'the backtick-divergent opener becomes a dimensioned placeholder');
});

test('snapshot gate does NOT over-block an ALLOWED src that follows a backtick ">" (WR-01 no over-correction)', async () => {
  const renderer = await import(RENDERER_MODULE);
  const host = makeHost();
  const viewer = renderer.createViewer({ document: host.document, mount: host.mount, mediaMode: 'reference' });
  // The backtick makes this markup malformed: a real (jsdom) parser ends the
  // tag at the first `>` inside the backtick, so the trailing `src` is inert
  // TEXT, never a fetch -- the gate must not manufacture a blocked placeholder
  // for an ALLOWED origin (the string passes through; the backtick-aware scan
  // reads the real tag end and gates the allowed src as allowed).
  viewer.handleSnapshot(snapshotWith('<img data-fsb-nid="1" alt=`a>b` src="https://cdn.example.com/a.png">'));
  const cd = glueMirror(host.mount.querySelector('iframe'));
  assert.equal(
    cd.querySelector('[data-ps-asset-unavailable="blocked-origin"]'),
    null,
    'an allowed-origin backtick-divergent <img> is not degraded to a blocked placeholder'
  );
  // jsdom proves a real browser never fetches the inert trailing src.
  const img = cd.querySelector('img[data-fsb-nid="1"]');
  if (img) {
    assert.equal(img.getAttribute('src'), null, 'the trailing src is inert text in a real parser, not a fetched attribute');
  }
});

test('snapshot gate fails CLOSED on an unbalanced backtick running to EOF before a blocked src (WR-01)', async () => {
  const { gateSnapshotAssets } = await import('../src/renderer/snapshot.js');
  const gate = function () { return { allow: false }; };
  // One backtick with no partner before the tag end: the bounded blob is
  // unreliable, so attrsBlobIsUnreliable forces the placeholder.
  const out = gateSnapshotAssets('<img data-fsb-nid="1" alt=`a src="https://169.254.169.254/x.png">', gate);
  assert.equal(out.indexOf('169.254'), -1, 'an unbalanced-backtick <img> never emits a fetchable blocked src');
  assert.ok(out.indexOf('data-ps-asset-unavailable="blocked-origin"') !== -1, 'an unparseable backtick shape degrades to a placeholder');
});
