// Phase 13 Plan 03 Task 1: media-src CSP add + the STRING-layer media URL gate.
//
// Two security contracts:
//   1. CSP: the assembled srcdoc head must carry `media-src http: https: data:`
//      (no `blob:` -- Phase 14), while retaining `default-src 'none'` and NO
//      `script-src` / `img-src` regression.
//   2. Pre-parse gate: <video src>, <video poster>, and <source src> pointing
//      at a BLOCKED origin (the shipped classifyAssetOrigin denylist) must be
//      neutralized to the dimensioned blocked-origin placeholder form at the
//      STRING layer (gateSnapshotAssets) BEFORE the srcdoc is assembled -- the
//      browser prefetches these during parse, so a post-parse scrub is too late
//      (13-RESEARCH Pitfall 5). Allowed origins pass unchanged; a `>` inside a
//      quoted media attribute must not truncate the quote-aware tag scan.
//
// Assertions run on the STRING output of gateSnapshotAssets / buildSnapshotHtml
// (no DOM parse), so they pin the pre-parse timing directly.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const SNAPSHOT_MODULE = '../src/renderer/snapshot.js';
const RENDERER_MODULE = '../src/renderer/index.js';

/**
 * The renderer's shipped fail-closed gate, wired exactly as createViewer wires
 * it (mediaMode 'reference' so only the classifier denylist blocks). Returns
 * { allow } so it plugs straight into gateSnapshotAssets.
 */
async function referenceGate() {
  const renderer = await import(RENDERER_MODULE);
  return function gate(url, kind) {
    return renderer.gateAssetUrl(url, { mediaMode: 'reference', kind: kind || 'image' });
  };
}

test('CSP_META (via buildSnapshotHtml) adds media-src http: https: data: with no blob:', async () => {
  const snap = await import(SNAPSHOT_MODULE);
  const srcdoc = snap.buildSnapshotHtml({ html: '<p>x</p>' });
  assert.ok(
    /media-src\s+http:\s+https:\s+data:/.test(srcdoc),
    'srcdoc CSP must contain exactly `media-src http: https: data:`'
  );
  assert.ok(srcdoc.indexOf('blob:') === -1, 'media-src must NOT contain blob: this phase (Phase 14)');
});

test('media-src add does not regress default-src or leak a script-src', async () => {
  const snap = await import(SNAPSHOT_MODULE);
  const srcdoc = snap.buildSnapshotHtml({ html: '<p>x</p>' });
  assert.ok(srcdoc.indexOf("default-src 'none'") !== -1, "default-src 'none' must be retained");
  assert.ok(srcdoc.indexOf('script-src') === -1, 'no script-src directive may be introduced');
  // img-src must not regress.
  assert.ok(/img-src\s+http:\s+https:\s+data:/.test(srcdoc), 'img-src must be retained unchanged');
});

test('<video src> to a blocked origin is neutralized at the STRING layer pre-parse', async () => {
  const snap = await import(SNAPSHOT_MODULE);
  const gate = await referenceGate();
  const html = '<video data-fsb-nid="1" src="https://10.0.0.5/x.mp4"></video>';
  const out = snap.gateSnapshotAssets(html, gate);
  assert.ok(out.indexOf('10.0.0.5') === -1, 'the blocked <video src> URL must not survive in the string');
  assert.ok(out.indexOf('data-ps-asset-unavailable') !== -1, 'a blocked-origin placeholder replaces the <video>');
});

test('<video poster> to a blocked origin is neutralized at the STRING layer pre-parse', async () => {
  const snap = await import(SNAPSHOT_MODULE);
  const gate = await referenceGate();
  const html = '<video data-fsb-nid="1" poster="https://127.0.0.1/p.jpg"></video>';
  const out = snap.gateSnapshotAssets(html, gate);
  assert.ok(out.indexOf('127.0.0.1') === -1, 'the blocked <video poster> URL must not survive in the string');
  assert.ok(out.indexOf('data-ps-asset-unavailable') !== -1, 'a blocked-origin placeholder replaces the <video>');
});

test('<source src> to a blocked origin is neutralized at the STRING layer pre-parse', async () => {
  const snap = await import(SNAPSHOT_MODULE);
  const gate = await referenceGate();
  const html = '<video data-fsb-nid="1"><source data-fsb-nid="2" src="http://localhost/y.webm"></video>';
  const out = snap.gateSnapshotAssets(html, gate);
  assert.ok(out.indexOf('localhost/y.webm') === -1, 'the blocked <source src> URL must not survive in the string');
  assert.ok(out.indexOf('data-ps-asset-unavailable') !== -1, 'a blocked-origin placeholder replaces the <source>');
});

test('all three blocked media URLs in one snapshot are neutralized together', async () => {
  const snap = await import(SNAPSHOT_MODULE);
  const gate = await referenceGate();
  const html =
    '<video data-fsb-nid="1" src="https://10.0.0.5/x.mp4" poster="https://127.0.0.1/p.jpg">'
    + '<source data-fsb-nid="2" src="http://localhost/y.webm"></video>';
  const out = snap.gateSnapshotAssets(html, gate);
  assert.ok(out.indexOf('10.0.0.5') === -1, 'blocked video src gone');
  assert.ok(out.indexOf('127.0.0.1') === -1, 'blocked poster gone');
  assert.ok(out.indexOf('localhost/y.webm') === -1, 'blocked source src gone');
});

test('an allowed https media origin passes through unchanged', async () => {
  const snap = await import(SNAPSHOT_MODULE);
  const gate = await referenceGate();
  const html =
    '<video data-fsb-nid="1" src="https://cdn.example.com/clip.mp4" poster="https://cdn.example.com/p.jpg">'
    + '<source data-fsb-nid="2" src="https://cdn.example.com/clip.webm"></video>';
  const out = snap.gateSnapshotAssets(html, gate);
  assert.ok(out.indexOf('https://cdn.example.com/clip.mp4') !== -1, 'allowed video src is kept by reference');
  assert.ok(out.indexOf('https://cdn.example.com/p.jpg') !== -1, 'allowed poster is kept by reference');
  assert.ok(out.indexOf('https://cdn.example.com/clip.webm') !== -1, 'allowed source src is kept by reference');
  assert.ok(out.indexOf('data-ps-asset-unavailable') === -1, 'no placeholder for an all-allowed media element');
});

test('a `>` inside a quoted media attribute does not truncate the tag scan (blocked src still caught)', async () => {
  const snap = await import(SNAPSHOT_MODULE);
  const gate = await referenceGate();
  // The poster value contains a literal `>`; a naive [^>]* scan would stop
  // there and leave the trailing blocked src unmodified. The quote-aware
  // findTagEnd must read past it and still gate the blocked src.
  const html = '<video data-fsb-nid="1" data-x="a>b" src="https://169.254.169.254/x.mp4"></video>';
  const out = snap.gateSnapshotAssets(html, gate);
  assert.ok(out.indexOf('169.254.169.254') === -1, 'blocked src after an in-attribute `>` must be neutralized');
  assert.ok(out.indexOf('data-ps-asset-unavailable') !== -1, 'placeholder replaces the tag-split <video>');
});

test('the <img> gate is unchanged by the media generalization (no regression)', async () => {
  const snap = await import(SNAPSHOT_MODULE);
  const gate = await referenceGate();
  const blocked = snap.gateSnapshotAssets('<img data-fsb-nid="1" src="https://10.0.0.5/a.png">', gate);
  assert.ok(blocked.indexOf('10.0.0.5') === -1, 'blocked <img> src still neutralized');
  assert.ok(blocked.indexOf('data-ps-asset-unavailable') !== -1, 'blocked <img> placeholder present');
  const allowed = snap.gateSnapshotAssets('<img data-fsb-nid="1" src="https://cdn.example.com/a.png">', gate);
  assert.ok(allowed.indexOf('https://cdn.example.com/a.png') !== -1, 'allowed <img> src kept');
});
