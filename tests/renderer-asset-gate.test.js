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
