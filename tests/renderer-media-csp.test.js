// Phase 13 Plan 03 Task 1 (Phase 14 Plan 02 Task 3: media-src gains blob:).
//
// Two security contracts:
//   1. CSP: the assembled srcdoc head must carry `media-src http: https: data:
//      blob:` (Phase 14 adds `blob:` for the parent-minted MSE object URL),
//      while retaining `default-src 'none'`, NO `script-src`, NO `connect-src`
//      (Pitfall 5: the iframe fetches nothing in the MSE path -- the parent
//      fetches segments; the child plays the blob), and no `img-src` regression.
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

test('CSP_META (via buildSnapshotHtml) media-src gains blob: (Phase 14 MSE object URL)', async () => {
  const snap = await import(SNAPSHOT_MODULE);
  const srcdoc = snap.buildSnapshotHtml({ html: '<p>x</p>' });
  // Phase 14 FLIP: media-src now carries `blob:` (was http: https: data: only).
  assert.ok(
    /media-src\s+http:\s+https:\s+data:\s+blob:/.test(srcdoc),
    'srcdoc CSP must contain `media-src http: https: data: blob:`'
  );
  assert.ok(srcdoc.indexOf('blob:') !== -1, 'blob: must be present (the parent-minted MSE object URL)');
  // blob: must live INSIDE the media-src directive (not leaked into another one).
  const mediaDirective = srcdoc.slice(srcdoc.indexOf('media-src'), srcdoc.indexOf(';', srcdoc.indexOf('media-src')));
  assert.ok(mediaDirective.indexOf('blob:') !== -1, 'blob: is scoped to the media-src directive');
});

test('media-src add does not regress default-src, leak a script-src, or widen connect-src', async () => {
  const snap = await import(SNAPSHOT_MODULE);
  const srcdoc = snap.buildSnapshotHtml({ html: '<p>x</p>' });
  assert.ok(srcdoc.indexOf("default-src 'none'") !== -1, "default-src 'none' must be retained");
  assert.ok(srcdoc.indexOf('script-src') === -1, 'no script-src directive may be introduced');
  // Pitfall 5: the iframe fetches nothing in the MSE path (parent fetches
  // segments; child plays the blob), so NO connect-src may be added.
  assert.ok(srcdoc.indexOf('connect-src') === -1, 'no connect-src directive may be introduced (Pitfall 5)');
  // img-src must not regress -- blob: is added to media-src ONLY, not img-src.
  assert.ok(/img-src\s+http:\s+https:\s+data:/.test(srcdoc), 'img-src must be retained unchanged');
  const imgDirective = srcdoc.slice(srcdoc.indexOf('img-src'), srcdoc.indexOf(';', srcdoc.indexOf('img-src')));
  assert.ok(imgDirective.indexOf('blob:') === -1, 'blob: is NOT added to img-src (media-src only)');
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

// WR-03: a neutralized <video> placeholder must FULLY replace the element --
// consuming its child <source>/<track> and the matching </video> -- not just
// swap the start tag (which would orphan the </video> close tag and leave the
// children dangling, producing structurally malformed markup).
test('WR-03: a blocked <video> placeholder consumes its children and </video> (no orphaned close tag)', async () => {
  const snap = await import(SNAPSHOT_MODULE);
  const gate = await referenceGate();
  const html =
    '<video data-fsb-nid="1" src="https://10.0.0.5/x.mp4">'
    + '<source data-fsb-nid="2" src="http://localhost/y.webm">'
    + '<track kind="subtitles" src="https://10.0.0.5/c.vtt"></video>';
  const out = snap.gateSnapshotAssets(html, gate);
  // The element collapses to exactly one inert placeholder.
  assert.ok(out.indexOf('data-ps-asset-unavailable') !== -1, 'a placeholder replaces the blocked <video>');
  assert.equal((out.match(/<\/video>/gi) || []).length, 0, 'no orphaned </video> close tag survives');
  assert.equal((out.match(/<source\b/gi) || []).length, 0, 'no leftover <source> child survives');
  assert.equal((out.match(/<track\b/gi) || []).length, 0, 'no leftover <track> child survives');
  // No blocked URL anywhere (children are discarded, not re-emitted).
  assert.ok(out.indexOf('10.0.0.5') === -1 && out.indexOf('localhost/y.webm') === -1, 'no blocked media URL survives');
});

test('WR-03: content after a neutralized <video> is preserved (cursor resumes past </video>)', async () => {
  const snap = await import(SNAPSHOT_MODULE);
  const gate = await referenceGate();
  const html =
    'BEFORE<video data-fsb-nid="1" src="http://10.0.0.5/x.mp4"><source src="http://10.0.0.5/y.webm"></video>'
    + 'AFTER<p data-fsb-nid="9">tail</p>';
  const out = snap.gateSnapshotAssets(html, gate);
  assert.equal((out.match(/<\/video>/gi) || []).length, 0, 'no orphaned </video>');
  assert.ok(out.indexOf('BEFORE') === 0, 'leading content preserved');
  assert.ok(out.indexOf('AFTER<p data-fsb-nid="9">tail</p>') !== -1, 'trailing content after </video> preserved intact');
});

test('WR-03: an allowed <video> keeps its body and close tag intact (no over-consume regression)', async () => {
  const snap = await import(SNAPSHOT_MODULE);
  const gate = await referenceGate();
  const html =
    '<video data-fsb-nid="1" src="https://cdn.example.com/clip.mp4">'
    + '<source data-fsb-nid="2" src="https://cdn.example.com/clip.webm"></video>NEXT';
  const out = snap.gateSnapshotAssets(html, gate);
  // referenceGate widens nothing, so cdn.example.com (public https) is allowed.
  assert.equal((out.match(/<\/video>/gi) || []).length, 1, 'the allowed <video> keeps exactly one </video>');
  assert.ok(out.indexOf('https://cdn.example.com/clip.webm') !== -1, 'the allowed child <source> is preserved');
  assert.ok(out.indexOf('NEXT') !== -1, 'content after the allowed element is preserved');
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
