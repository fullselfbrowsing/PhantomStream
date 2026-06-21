// RED Wave-0 scaffold -- filled by Plan 12-02.
// Requirements covered: ASST-03 (clone-only data-ps-currentsrc variant pin) and
// ASST-04 (blob:/oversized-data: -> dimensioned placeholder; small data: stays
// byte-identical). These cases are the Nyquist minimum set from 12-VALIDATION.md;
// they FAIL until Plan 12-02 adds classifyAssetRef / currentSrcDiffers /
// createAssetUnavailablePlaceholder and the degrade + enrich hooks to
// src/capture/index.js.
//
// RED mechanism: src/capture/index.js exists today but does NOT export these
// symbols yet, so each test dynamically imports the module and exercises the
// (currently undefined) export -- producing a per-test FAILURE rather than a
// module-load/syntax error. The file itself parses and runs cleanly.
//
// jsdom caveat (12-RESEARCH Pitfall 2, verified): jsdom returns img.currentSrc
// === "" (no resource loading). The currentSrc-enrichment case must inject a
// divergent currentSrc via Object.defineProperty; the currentSrcDiffers predicate
// is unit-tested directly with stub strings.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const CAPTURE_MODULE = '../src/capture/index.js';

// Default oversized-data: cap Plan 12-02 introduces (ASSET_DATA_URI_MAX_BYTES,
// src/protocol/constants.js). Used here only to build a body that exceeds it.
const ASSET_DATA_URI_MAX_BYTES = 262144; // 256 KiB

/** Build a fresh jsdom window/document for a capture case. */
function makeDom(bodyHtml) {
  const dom = new JSDOM(
    '<!DOCTYPE html><html><body>' + (bodyHtml || '') + '</body></html>',
    { url: 'https://origin.fixture.test/page' }
  );
  return { dom, document: dom.window.document };
}

test('blob: <img> src -> wire clone is a dimensioned <div data-ps-asset-unavailable="blob"> (ASST-04)', async () => {
  const capture = await import(CAPTURE_MODULE);
  assert.equal(
    typeof capture.classifyAssetRef,
    'function',
    'Plan 12-02 must export classifyAssetRef(url, capBytes) from src/capture/index.js'
  );
  const result = capture.classifyAssetRef('blob:https://origin.fixture.test/9f1c-abcd', ASSET_DATA_URI_MAX_BYTES);
  assert.equal(result.ok, false, 'blob: is non-shareable -> not ok');
  assert.equal(result.reason, 'blob', 'reason is "blob" so the placeholder carries data-ps-asset-unavailable="blob"');
});

test('oversized data: <img> src (> cap) -> <div data-ps-asset-unavailable="oversized-data"> (ASST-04)', async () => {
  const capture = await import(CAPTURE_MODULE);
  assert.equal(typeof capture.classifyAssetRef, 'function', 'Plan 12-02 must export classifyAssetRef');
  const oversized = 'data:image/png;base64,' + 'A'.repeat(ASSET_DATA_URI_MAX_BYTES + 1);
  const result = capture.classifyAssetRef(oversized, ASSET_DATA_URI_MAX_BYTES);
  assert.equal(result.ok, false, 'data: URI over the byte cap is non-shareable');
  assert.equal(result.reason, 'oversized-data', 'reason is "oversized-data"');
});

test('small data:image/png (<= cap) -> classifies ok, NO placeholder, byte-identical (ASST-04, Pitfall 5)', async () => {
  const capture = await import(CAPTURE_MODULE);
  assert.equal(typeof capture.classifyAssetRef, 'function', 'Plan 12-02 must export classifyAssetRef');
  const smallDataUri = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMCAQGyJzfqAAAAAElFTkSuQmCC';
  const result = capture.classifyAssetRef(smallDataUri, ASSET_DATA_URI_MAX_BYTES);
  assert.equal(result.ok, true, 'a small inline data: image stays shareable (passes through byte-identical, no placeholder)');
});

test('currentSrcDiffers(differing absolute urls) === true (ASST-03 predicate)', async () => {
  const capture = await import(CAPTURE_MODULE);
  assert.equal(
    typeof capture.currentSrcDiffers,
    'function',
    'Plan 12-02 must export currentSrcDiffers(resolvedCurrentSrc, resolvedSrc)'
  );
  assert.equal(
    capture.currentSrcDiffers('https://cdn.fixture.test/2x.png', 'https://cdn.fixture.test/1x.png'),
    true,
    'a negotiated variant differing from src -> enrich'
  );
});

test('currentSrcDiffers(identical urls) === false and empty-input === false (ASST-03 predicate)', async () => {
  const capture = await import(CAPTURE_MODULE);
  assert.equal(typeof capture.currentSrcDiffers, 'function', 'Plan 12-02 must export currentSrcDiffers');
  assert.equal(
    capture.currentSrcDiffers('https://cdn.fixture.test/a.png', 'https://cdn.fixture.test/a.png'),
    false,
    'plain <img src> (no variant negotiated) -> no enrichment, byte-identical wire'
  );
  assert.equal(
    capture.currentSrcDiffers('', 'https://cdn.fixture.test/a.png'),
    false,
    'empty currentSrc never enriches'
  );
});

test('<img srcset> with an injected divergent currentSrc -> wire clone carries data-ps-currentsrc (ASST-03)', async () => {
  const capture = await import(CAPTURE_MODULE);
  assert.equal(
    typeof capture.serializeSnapshot,
    'function',
    'Plan 12-02 must expose a capture entry that serializes a snapshot carrying data-ps-currentsrc on the clone'
  );
  const { document } = makeDom(
    '<img id="responsive" src="https://cdn.fixture.test/1x.png"'
    + ' srcset="https://cdn.fixture.test/1x.png 1x, https://cdn.fixture.test/2x.png 2x">'
  );
  const img = document.getElementById('responsive');
  // jsdom returns currentSrc === "" -> inject the negotiated variant.
  Object.defineProperty(img, 'currentSrc', { value: 'https://cdn.fixture.test/2x.png', configurable: true });
  const wire = capture.serializeSnapshot(document);
  const html = (wire && wire.html) ? wire.html : String(wire);
  assert.ok(
    html.indexOf('data-ps-currentsrc') !== -1,
    'the serialized snapshot clone carries data-ps-currentsrc for the negotiated variant'
  );
});

test('capture does NOT mutate the live page: no data-ps-currentsrc / data-ps-asset-unavailable after serialize (Pitfall 4)', async () => {
  const capture = await import(CAPTURE_MODULE);
  assert.equal(typeof capture.serializeSnapshot, 'function', 'Plan 12-02 must expose the snapshot serializer entry');
  const { document } = makeDom(
    '<img id="responsive" src="https://cdn.fixture.test/1x.png"'
    + ' srcset="https://cdn.fixture.test/1x.png 1x, https://cdn.fixture.test/2x.png 2x">'
    + '<img id="blobby" src="blob:https://origin.fixture.test/dead-ref">'
  );
  const img = document.getElementById('responsive');
  Object.defineProperty(img, 'currentSrc', { value: 'https://cdn.fixture.test/2x.png', configurable: true });
  capture.serializeSnapshot(document);
  assert.equal(
    document.querySelectorAll('[data-ps-currentsrc]').length,
    0,
    'live DOM has NO data-ps-currentsrc after capture (clone-only enrichment)'
  );
  assert.equal(
    document.querySelectorAll('[data-ps-asset-unavailable]').length,
    0,
    'live DOM has NO data-ps-asset-unavailable after capture (placeholder is built on the wire clone)'
  );
});
