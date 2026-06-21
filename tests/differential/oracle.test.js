// tests/differential/oracle.test.js -- dual-mode differential oracle
// (CAPT-04, CAPT-01).
//
// Mode 1 (ref-vs-ref, permanent harness self-test, FIRST in the file): every
// frozen fixture x scripted scenario pair runs as two independent reference
// captures and proves zero divergences -- if the harness itself drifts,
// these fail before any flipped test can misattribute the drift to the
// extraction. Two explicit guards prevent identical-but-empty false
// confidence (the truncation pair must actually truncate; the dialog pair
// must actually carry dialog messages), and a negative control proves the
// oracle can FAIL loudly with fixture, scenario, and message index.
//
// Mode 2 (ref-vs-EXTRACTED, the phase exit bar): the same matrix with side B
// flipped to src/capture/index.js behind a flush-less loopback transport.
// Every intentional divergence must be a declared ledger entry (D1 in
// pause-resume, D6 in text-childlist, D7 in sanitize-divergence, and
// D24-scoped Phase 8 protocol extensions); any
// undeclared divergence fails the suite, and stale-entry detection (LAST test
// in the file) proves every mismatch-kind ledger entry actually matched a real
// divergence.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createReferenceSide, createExtractedSide, runScenario } from './harness.js';
import { normalizeReference, normalizeExtracted, canonicalizeIdentity, compareStreams } from './normalize.js';
import { DIVERGENCES } from './divergence-ledger.js';
import { STREAM, DIFF_OP } from '../../src/protocol/messages.js';
import * as basicMutations from './scenarios/basic-mutations.js';
import * as snapshotOnly from './scenarios/snapshot-only.js';
import * as mutationBurst from './scenarios/mutation-burst.js';
import * as structuralOps from './scenarios/structural-ops.js';
import * as scroll from './scenarios/scroll.js';
import * as dialog from './scenarios/dialog.js';
import * as pauseResume from './scenarios/pause-resume.js';
import * as textChildlist from './scenarios/text-childlist.js';
import * as sanitizeDivergence from './scenarios/sanitize-divergence.js';
import * as phase8ProtocolExtensions from './scenarios/phase8-protocol-extensions.js';
import * as cssomCaptureMode from './scenarios/cssom-capture-mode.js';
import * as staticAssets from './scenarios/static-assets.js';
import * as mediaPlaybackSync from './scenarios/media-playback-sync.js';

/**
 * The full fixture x scenario matrix. Every reliability defense from the
 * phase success criteria maps to at least one pair here. Config is defined
 * ONCE per pair -- guard tests look their pair up in this table so harness
 * configuration can never drift between the matrix test and its guard
 * (Pitfall 6).
 */
const MATRIX = [
  { fixture: 'basic.html', scenario: basicMutations, config: {} },
  { fixture: 'basic.html', scenario: mutationBurst, config: {} },
  { fixture: 'basic.html', scenario: structuralOps, config: {} },
  { fixture: 'basic.html', scenario: scroll, config: {} },
  { fixture: 'basic.html', scenario: pauseResume, config: {} },
  { fixture: 'basic.html', scenario: textChildlist, config: {} },
  { fixture: 'sanitize-corpus.html', scenario: sanitizeDivergence, config: {} },
  { fixture: 'heavy-realistic.html', scenario: snapshotOnly, config: {} },
  { fixture: 'heavy-realistic.html', scenario: structuralOps, config: {} },
  { fixture: 'truncation-overflow.html', scenario: snapshotOnly, config: { patchRects: true } },
  { fixture: 'canvas.html', scenario: snapshotOnly, config: {} },
  { fixture: 'dialog.html', scenario: dialog, config: { runScripts: 'dangerously' } },
  { fixture: 'phase8-fidelity.html', scenario: phase8ProtocolExtensions, config: {} },
  { fixture: 'cssom-mode.html', scenario: cssomCaptureMode, config: { styleMode: 'cssom' } },
  { fixture: 'static-assets.html', scenario: staticAssets, config: {} },
  { fixture: 'media-playback-sync.html', scenario: mediaPlaybackSync, config: {} },
];

function loadFixture(fixtureFile) {
  return readFileSync(new URL('./fixtures/' + fixtureFile, import.meta.url), 'utf8');
}

/**
 * Run one full reference-side capture of a fixture under a scenario and
 * return its normalized, identity-canonicalized stream. The side is ALWAYS
 * closed (watchdog setTimeout chain leak -- Pitfall 3).
 */
async function captureNormalizedStream(fixtureFile, scenario, config) {
  const side = createReferenceSide(loadFixture(fixtureFile), config);
  try {
    const sent = await runScenario(side, scenario);
    return canonicalizeIdentity(normalizeReference(sent));
  } finally {
    side.close();
  }
}

/**
 * Run one EXTRACTED-side capture (src/capture/index.js behind the loopback
 * transport) of a fixture under a scenario and return its normalized,
 * identity-canonicalized stream. The side is ALWAYS closed -- close()
 * restores the swapped Node globals as well as clearing the watchdog chain
 * (Pitfalls 3 and 8).
 */
async function captureExtractedStream(fixtureFile, scenario, config) {
  const side = createExtractedSide(loadFixture(fixtureFile), config);
  try {
    const sent = await runScenario(side, scenario);
    return canonicalizeIdentity(normalizeExtracted(sent));
  } finally {
    side.close();
  }
}

/**
 * Capture the (A, B) stream pair for one matrix entry, memoized per pair so
 * guard tests reuse the matrix run instead of re-serializing the expensive
 * fixtures. Side A runs to FULL completion before side B is constructed --
 * interleaving batches mutations differently per side (Pitfall 10).
 */
const pairCache = new Map();
function capturePair(entry) {
  const key = entry.fixture + '::' + entry.scenario.name;
  if (!pairCache.has(key)) {
    pairCache.set(key, (async () => {
      const streamA = await captureNormalizedStream(entry.fixture, entry.scenario, entry.config);
      const streamB = await captureNormalizedStream(entry.fixture, entry.scenario, entry.config);
      return { streamA, streamB };
    })());
  }
  return pairCache.get(key);
}

for (const entry of MATRIX) {
  test(`two independent reference captures emit equivalent normalized streams for ${entry.scenario.name} on ${entry.fixture}`, async () => {
    const { streamA, streamB } = await capturePair(entry);

    // A silently-empty harness must not pass: at minimum ready, snapshot,
    // and one overlay message.
    assert.ok(streamA.length >= 3, `stream A is non-trivial (got ${streamA.length} messages)`);
    assert.ok(streamB.length >= 3, `stream B is non-trivial (got ${streamB.length} messages)`);

    // Ref-vs-ref has zero divergences by construction: must not throw.
    compareStreams(streamA, streamB, entry.fixture, entry.scenario.name, DIVERGENCES);
  });
}

test('truncation provably triggers: both sides report truncated === true with equal missingDescendants on the overflow fixture', async () => {
  const entry = MATRIX.find((p) => p.fixture === 'truncation-overflow.html');
  const { streamA, streamB } = await capturePair(entry);

  const snapA = streamA.find((msg) => msg.type === STREAM.SNAPSHOT);
  const snapB = streamB.find((msg) => msg.type === STREAM.SNAPSHOT);
  assert.ok(snapA, 'stream A contains a snapshot message');
  assert.ok(snapB, 'stream B contains a snapshot message');

  // Explicit, not just deep-equal: identical-but-untruncated snapshots would
  // deep-equal while silently never exercising the truncation defense.
  assert.equal(snapA.payload.truncated, true, 'side A snapshot is truncated');
  assert.equal(snapB.payload.truncated, true, 'side B snapshot is truncated');
  assert.ok(snapA.payload.missingDescendants > 0, 'side A dropped at least one subtree');
  assert.equal(
    snapA.payload.missingDescendants,
    snapB.payload.missingDescendants,
    'both sides dropped the same number of subtrees'
  );
});

test('dialog channel provably carries messages: both sides record at least one dialog message on the dialog fixture', async () => {
  const entry = MATRIX.find((p) => p.fixture === 'dialog.html');
  const { streamA, streamB } = await capturePair(entry);

  // Guards against identical-but-empty false confidence (Pitfall 5): if the
  // injected interceptor never installed, BOTH sides would emit zero dialog
  // messages and the matrix pair would still deep-equal green.
  const dialogsA = streamA.filter((msg) => msg.type === STREAM.DIALOG);
  const dialogsB = streamB.filter((msg) => msg.type === STREAM.DIALOG);
  assert.ok(dialogsA.length >= 1, `side A recorded dialog messages (got ${dialogsA.length})`);
  assert.ok(dialogsB.length >= 1, `side B recorded dialog messages (got ${dialogsB.length})`);
});

test('tampering one payload field reports UNDECLARED DIVERGENCE with fixture, scenario, and index', async () => {
  const entry = MATRIX.find((p) => p.fixture === 'basic.html' && p.scenario === basicMutations);
  const { streamA } = await capturePair(entry);
  const tampered = structuredClone(streamA);

  // Flip one mutation op's attr value deep inside a payload.
  const mutationIndex = tampered.findIndex(
    (msg) => msg.type === STREAM.MUTATIONS
      && Array.isArray(msg.payload.mutations)
      && msg.payload.mutations.some((op) => op.op === DIFF_OP.ATTR)
  );
  assert.ok(mutationIndex >= 0, 'captured stream contains an attr mutation op to tamper with');
  const attrOp = tampered[mutationIndex].payload.mutations.find((op) => op.op === DIFF_OP.ATTR);
  attrOp.val = String(attrOp.val) + '-tampered';

  assert.throws(
    () => compareStreams(streamA, tampered, 'basic.html', 'basic-mutations', DIVERGENCES),
    (error) => {
      assert.match(error.message, /UNDECLARED DIVERGENCE/);
      assert.ok(error.message.includes('basic.html'), 'error names the fixture');
      assert.ok(error.message.includes('basic-mutations'), 'error names the scenario');
      assert.match(error.message, /at message \d+/);
      return true;
    }
  );
});

// ===========================================================================
// Flipped mode: reference vs EXTRACTED (src/capture/ behind the Transport
// seam). The ref-vs-ref tests above stay FIRST as the permanent harness
// self-test -- if the harness itself drifts, they fail before any flipped
// test can misattribute the drift to the extraction.
// ===========================================================================

/**
 * Capture the flipped (reference, extracted) stream pair for one matrix
 * entry, memoized like capturePair so the flipped guards reuse the matrix
 * run. Side A (reference) runs to FULL completion before side B (extracted)
 * is even constructed (Pitfall 10) -- which also means the extracted side's
 * globalThis swap window never overlaps a live reference side.
 */
const flippedCache = new Map();
function captureFlippedPair(entry) {
  const key = entry.fixture + '::' + entry.scenario.name;
  if (!flippedCache.has(key)) {
    flippedCache.set(key, (async () => {
      const refStream = await captureNormalizedStream(entry.fixture, entry.scenario, entry.config);
      const extStream = await captureExtractedStream(entry.fixture, entry.scenario, entry.config);
      return { refStream, extStream };
    })());
  }
  return flippedCache.get(key);
}

// Ledger-entry ids matched across ALL flipped matrix runs. node:test runs
// the tests in this file sequentially in definition order, so the
// stale-entry detection test at the END of the file sees the fully
// accumulated set.
const matchedMismatchIds = new Set();

for (const entry of MATRIX) {
  test(`reference and extracted captures emit equivalent streams for ${entry.scenario.name} on ${entry.fixture}`, async () => {
    const { refStream, extStream } = await captureFlippedPair(entry);

    assert.ok(refStream.length >= 3, `reference stream is non-trivial (got ${refStream.length} messages)`);
    assert.ok(extStream.length >= 3, `extracted stream is non-trivial (got ${extStream.length} messages)`);

    const matched = compareStreams(refStream, extStream, entry.fixture, entry.scenario.name, DIVERGENCES);
    for (const id of matched) matchedMismatchIds.add(id);

    if (entry.scenario.name === 'pause-resume') {
      // D1 territory: the reference's post-resume fresh-session SNAPSHOT and
      // forced OVERLAY broadcast diverge from the extracted core's
      // continue-same-session resume (USER OVERRIDE, 01-CONTEXT.md).
      assert.ok(
        matched.has('D1-resume-no-resnapshot'),
        'pause-resume exercises ledger entry D1'
      );

      // Belt-and-braces (WR-02): D1 excuses the REFERENCE's post-resume
      // re-snapshot, never a silent extracted-side resume failure. Assert
      // directly that the thing D1 says must still happen, happened: the
      // extracted core streamed the post-resume mutation in the CONTINUED
      // session (the after-resume attr op from the scenario, stamped
      // SESSION_1 -- not a fresh identity, not missing).
      const postResume = extStream.filter((msg) => msg.type === STREAM.MUTATIONS
        && msg.payload.streamSessionId === 'SESSION_1'
        && Array.isArray(msg.payload.mutations)
        && msg.payload.mutations.some((op) => op.op === DIFF_OP.ATTR && op.val === 'after-resume'));
      assert.equal(
        postResume.length, 1,
        'extracted stream carries the post-resume mutation in the continued session'
      );

      // Pause containment (iteration-2 WR-03): the during-pause mutation
      // must never reach the wire ("missed by design", pause-resume.js).
      // Proven blind spot: a pause() that fails to disconnect the observer
      // leaks the during-pause op as an extra MUTATIONS(SESSION_1) message
      // that D1's clauses (a)/(b) would excuse AND that still satisfies the
      // postResume assertion above -- only this direct absence check
      // hard-fails the broken-pause regression.
      const leaked = extStream.filter((msg) => msg.type === STREAM.MUTATIONS
        && Array.isArray(msg.payload.mutations)
        && msg.payload.mutations.some((op) => op.op === DIFF_OP.ATTR && op.val === 'during-pause'));
      assert.equal(
        leaked.length, 0,
        'paused mutations never appear on the extracted wire'
      );
    } else if (entry.scenario.name === 'text-childlist') {
      // D6 territory: the extracted core's text-node childList fidelity fix
      // (capture README E2) emits a text op where the reference emits
      // NOTHING -- el.textContent = '...' is a childList record with a bare
      // text-node removal+addition that the reference's element-only loops
      // drop on the floor.
      assert.ok(
        matched.has('D6-text-childlist-fidelity-fix'),
        'text-childlist exercises ledger entry D6'
      );
      assert.equal(
        matched.size, 1,
        `only D6 consulted in text-childlist (matched: ${[...matched].join(', ')})`
      );

      // Belt-and-braces, both directions. The reference really DROPS the
      // mutation class (zero MUTATIONS messages on its wire) -- proving the
      // divergence direction is a fidelity FIX, not a reference behavior
      // change the predicate happens to excuse...
      assert.equal(
        refStream.filter((msg) => msg.type === STREAM.MUTATIONS).length, 0,
        'reference emits no wire signal for the textContent= edit'
      );
      // ...and the extracted side emits exactly ONE batch of exactly ONE
      // deduplicated text op carrying the replaced text.
      const extBatches = extStream.filter((msg) => msg.type === STREAM.MUTATIONS);
      assert.equal(extBatches.length, 1, 'extracted emits exactly one MUTATIONS batch');
      assert.deepEqual(
        extBatches[0].payload.mutations.map(({ op, text }) => ({ op, text })),
        [{ op: DIFF_OP.TEXT, text: 'Replaced intro text.' }],
        'one deduplicated text op carrying the replaced live text'
      );
    } else if (entry.scenario.name === 'sanitize-divergence') {
      // D7 territory: capture-side sanitization deliberately diverges from
      // the raw reference stream by stripping on* handlers, neutralizing
      // dangerous URL attrs, dropping embed surfaces, and masking password
      // values before transport.
      assert.ok(
        matched.has('D7-capture-sanitization'),
        'sanitize-divergence exercises ledger entry D7'
      );
      assert.equal(
        matched.size,
        1,
        `only D7 consulted in sanitize-divergence (matched: ${[...matched].join(', ')})`
      );

      const refHtml = refStream
        .filter((msg) => msg.type === STREAM.SNAPSHOT)
        .map((msg) => (msg.payload && msg.payload.html) || '')
        .join('\n');
      const extHtml = extStream
        .filter((msg) => msg.type === STREAM.SNAPSHOT)
        .map((msg) => (msg.payload && msg.payload.html) || '')
        .join('\n');
      const hostileSnapshot = /on\w+\s*=|javascript:|<object|<embed|srcdoc=|expression\(|hunter2/i;
      assert.match(
        refHtml,
        hostileSnapshot,
        'reference snapshot carries hostile content and password plaintext'
      );
      assert.doesNotMatch(
        extHtml,
        hostileSnapshot,
        'extracted snapshot strips hostile content and password plaintext'
      );

      const refOps = refStream
        .filter((msg) => msg.type === STREAM.MUTATIONS)
        .flatMap((msg) => (msg.payload && msg.payload.mutations) || []);
      const extOps = extStream
        .filter((msg) => msg.type === STREAM.MUTATIONS)
        .flatMap((msg) => (msg.payload && msg.payload.mutations) || []);
      assert.ok(
        refOps.some((op) => op.op === DIFF_OP.ATTR && /^on/i.test(String(op.attr || ''))),
        'reference mutation batch carries the hostile on* attr op'
      );
      assert.ok(
        refOps.some((op) => op.op === DIFF_OP.ATTR && op.attr === 'href' && /javascript:/i.test(String(op.val || ''))),
        'reference mutation batch carries the hostile javascript: href value'
      );
      assert.equal(
        extOps.filter((op) => op.op === DIFF_OP.ATTR && /^on/i.test(String(op.attr || ''))).length,
        0,
        'extracted mutation batch drops on* attr ops'
      );
      assert.equal(
        extOps.filter((op) => op.op === DIFF_OP.ATTR && /javascript:/i.test(String(op.val || ''))).length,
        0,
        'extracted mutation batch never carries javascript: attr values'
      );
      assert.ok(
        extOps.some((op) => op.op === DIFF_OP.ATTR && op.attr === 'href' && op.val === null),
        'extracted mutation batch carries the href removal attr op'
      );
    } else if (entry.fixture === 'truncation-overflow.html' && entry.scenario.name === 'snapshot-only') {
      assert.ok(
        matched.has('D24-phase8-truncated-subtree-markers'),
        'truncation-overflow snapshot-only exercises the Phase 8 subtree marker ledger entry'
      );
      assert.equal(
        matched.size,
        1,
        `only D24 subtree marker entry consulted for truncation-overflow (matched: ${[...matched].join(', ')})`
      );
    } else if (['basic-mutations', 'mutation-burst', 'structural-ops'].includes(entry.scenario.name)) {
      assert.ok(
        matched.has('D24-phase8-add-op-computed-styles'),
        `${entry.scenario.name} exercises the Phase 8 add-op computed style ledger entry`
      );
      assert.equal(
        matched.size,
        1,
        `only D24 add-op computed style entry consulted (matched: ${[...matched].join(', ')})`
      );
    } else if (entry.scenario.name === 'phase8-protocol-extensions') {
      assert.ok(
        matched.has('D24-phase8-shadow-frame-snapshot-sidecars'),
        'Phase 8 fixture exercises shadow/frame snapshot sidecar divergence'
      );
      assert.ok(
        matched.has('D24-phase8-shadow-value-mutations'),
        'Phase 8 fixture exercises shadow-root and value mutation divergence'
      );
      assert.equal(
        matched.size,
        2,
        `only D24 Phase 8 protocol entries consulted (matched: ${[...matched].join(', ')})`
      );
    } else if (entry.scenario.name === 'cssom-capture-mode') {
      assert.ok(
        matched.has('D25-cssom-mode-style-sources'),
        'CSSOM fixture exercises the Phase 9 style-source ledger entry'
      );
      assert.equal(
        matched.size,
        1,
        `only D25 CSSOM style-source entry consulted (matched: ${[...matched].join(', ')})`
      );

      const extSnapshot = extStream.find((msg) => msg.type === STREAM.SNAPSHOT);
      assert.equal(
        extSnapshot.payload.styleStrategy.mode,
        'cssom',
        'extracted CSSOM snapshot declares cssom style strategy'
      );
      assert.ok(
        extSnapshot.payload.styleSources.some((source) => source.cssText.includes('.cssom-card')),
        'extracted CSSOM snapshot carries document stylesheet text'
      );
      assert.equal(
        /\sstyle=/.test(extSnapshot.payload.html),
        false,
        'CSSOM snapshot omits generated computed inline styles'
      );
      const styleOps = extStream
        .filter((msg) => msg.type === STREAM.MUTATIONS)
        .flatMap((msg) => msg.payload.mutations || [])
        .filter((op) => op.op === DIFF_OP.STYLE_SOURCE);
      assert.ok(
        styleOps.some((op) => op.action === 'replace' && /40,\s*50,\s*60/.test(op.source.cssText)),
        'extracted CSSOM stream carries live stylesheet replacement'
      );
    } else if (entry.scenario.name === 'static-assets') {
      // D26 territory (Phase 12): the extracted snapshot carries the clone-only
      // data-ps-currentsrc variant pin (ASST-03) and degrades blob:/oversized-
      // data: <img>s to dimensioned data-ps-asset-unavailable placeholders
      // (ASST-04). The reference has neither, so the single SNAPSHOT diverges.
      assert.ok(
        matched.has('D26-currentsrc-variant-pin'),
        'static-assets exercises ledger entry D26'
      );
      assert.equal(
        matched.size,
        1,
        `only D26 consulted in static-assets (matched: ${[...matched].join(', ')})`
      );

      const refSnap = refStream.find((msg) => msg.type === STREAM.SNAPSHOT);
      const extSnap = extStream.find((msg) => msg.type === STREAM.SNAPSHOT);
      assert.ok(refSnap && extSnap, 'both sides emit a snapshot');

      // ASST-03: clone-only currentSrc pin present in extracted, absent in
      // reference (the injected divergent currentSrc drove the enrichment).
      assert.match(
        extSnap.payload.html,
        /data-ps-currentsrc="https:\/\/cdn\.fixture\.test\/img\/photo-1600\.png"/,
        'extracted snapshot pins the negotiated currentSrc variant on the clone'
      );
      assert.doesNotMatch(
        refSnap.payload.html,
        /data-ps-currentsrc/,
        'reference snapshot carries no currentSrc pin'
      );

      // ASST-04: blob:/oversized-data: degrade to a placeholder in extracted;
      // the reference ships the raw (dead) reference instead.
      assert.match(
        extSnap.payload.html,
        /data-ps-asset-unavailable="blob"/,
        'extracted snapshot degrades the blob: <img> to a placeholder'
      );
      assert.match(
        extSnap.payload.html,
        /data-ps-asset-unavailable="oversized-data"/,
        'extracted snapshot degrades the oversized data: <img> to a placeholder'
      );
      assert.doesNotMatch(
        extSnap.payload.html,
        /blob:https:\/\/fixture\.test/,
        'a blob: reference never reaches the extracted wire'
      );
      assert.match(
        refSnap.payload.html,
        /blob:https:\/\/fixture\.test/,
        'the reference ships the dead blob: reference (the gap this closes)'
      );

      // Pitfall 5: the SMALL inline data: image stays byte-identical (NOT
      // degraded) on BOTH sides -- no over-degrade churn.
      assert.match(
        extSnap.payload.html,
        /src="data:image\/png;base64,iVBORw0KGgo/,
        'extracted snapshot keeps the small inline data: image byte-identical'
      );
    } else if (entry.scenario.name === 'media-playback-sync') {
      // D27 territory (Phase 13): the extracted core enriches the SNAPSHOT with
      // a nid-keyed media[] baseline (MEDIA-02) and emits STREAM.MEDIA side-
      // channel messages on play/timeupdate (MWIRE-01). The reference tracks no
      // media, so the SNAPSHOT diverges on media[] and the extracted stream
      // carries extra trailing STREAM.MEDIA messages -- one scenario-pinned
      // entry covers both shapes.
      assert.ok(
        matched.has('D27-media-playback-sync'),
        'media-playback-sync exercises ledger entry D27'
      );
      assert.equal(
        matched.size,
        1,
        `only D27 consulted in media-playback-sync (matched: ${[...matched].join(', ')})`
      );

      // Belt-and-braces, Shape B (media[]-only SNAPSHOT): the extracted snapshot
      // carries a non-empty media[] baseline; the reference carries none -- the
      // divergence direction is an extracted-only enrichment, not a reference
      // behavior change the predicate happens to excuse.
      const refSnap = refStream.find((msg) => msg.type === STREAM.SNAPSHOT);
      const extSnap = extStream.find((msg) => msg.type === STREAM.SNAPSHOT);
      assert.ok(refSnap && extSnap, 'both sides emit a snapshot');
      assert.ok(
        Array.isArray(extSnap.payload.media) && extSnap.payload.media.length >= 2,
        'extracted snapshot carries a media[] baseline for the <video> and <audio>'
      );
      assert.ok(
        !Array.isArray(refSnap.payload.media),
        'reference snapshot carries no media[] field'
      );
      // The injected finite duration drives the VOD baseline shape (not live:true).
      assert.ok(
        extSnap.payload.media.every((m) => m.duration === 30 && m.paused === false && m.currentTime === 5),
        'media[] entries carry the injected deterministic VOD playback state'
      );

      // Belt-and-braces, Shape A (extracted-only trailing STREAM.MEDIA): the
      // reference emits zero media messages; the extracted side emits at least
      // the discrete play plus the throttled timeupdate heartbeat.
      assert.equal(
        refStream.filter((msg) => msg.type === STREAM.MEDIA).length,
        0,
        'reference emits no STREAM.MEDIA messages'
      );
      const extMedia = extStream.filter((msg) => msg.type === STREAM.MEDIA);
      assert.ok(
        extMedia.length >= 2,
        `extracted stream carries STREAM.MEDIA messages (got ${extMedia.length})`
      );
      assert.ok(
        extMedia.some((msg) => msg.payload.event === 'play'),
        'extracted stream carries the discrete play event'
      );
      assert.ok(
        extMedia.some((msg) => msg.payload.event === 'timeupdate'),
        'extracted stream carries the throttled timeupdate heartbeat'
      );
    } else {
      // D1/D6/D7/D24 (and any future mismatch entry) must stay scoped:
      // every scenario other than the named divergence scenarios compares
      // clean with ZERO ledger consultations.
      assert.equal(
        matched.size, 0,
        `no ledger consultation outside pinned divergence scenarios (matched: ${[...matched].join(', ') || 'none'})`
      );
    }
  });
}

test('flipped truncation guard: reference AND extracted snapshots report truncated === true with equal missingDescendants', async () => {
  const entry = MATRIX.find((p) => p.fixture === 'truncation-overflow.html');
  const { refStream, extStream } = await captureFlippedPair(entry);

  const snapRef = refStream.find((msg) => msg.type === STREAM.SNAPSHOT);
  const snapExt = extStream.find((msg) => msg.type === STREAM.SNAPSHOT);
  assert.ok(snapRef, 'reference stream contains a snapshot message');
  assert.ok(snapExt, 'extracted stream contains a snapshot message');

  // Explicit, not just deep-equal (same rationale as the ref-vs-ref guard):
  // identical-but-untruncated snapshots would deep-equal while silently
  // never exercising the truncation defense in the EXTRACTED core.
  assert.equal(snapRef.payload.truncated, true, 'reference snapshot is truncated');
  assert.equal(snapExt.payload.truncated, true, 'extracted snapshot is truncated');
  assert.ok(snapRef.payload.missingDescendants > 0, 'reference dropped at least one subtree');
  assert.equal(
    snapExt.payload.missingDescendants,
    snapRef.payload.missingDescendants,
    'both implementations dropped the same number of subtrees'
  );
});

test('flipped dialog guard: reference AND extracted record at least one dialog message on the dialog fixture', async () => {
  const entry = MATRIX.find((p) => p.fixture === 'dialog.html');
  const { refStream, extStream } = await captureFlippedPair(entry);

  // Identical-but-empty false confidence (Pitfall 5), flipped edition: if
  // the EXTRACTED core's injected interceptor never installed, both sides
  // could still deep-equal green with zero dialog traffic.
  const dialogsRef = refStream.filter((msg) => msg.type === STREAM.DIALOG);
  const dialogsExt = extStream.filter((msg) => msg.type === STREAM.DIALOG);
  assert.ok(dialogsRef.length >= 1, `reference recorded dialog messages (got ${dialogsRef.length})`);
  assert.ok(dialogsExt.length >= 1, `extracted recorded dialog messages (got ${dialogsExt.length})`);
});

test('pause-resume with an EMPTY ledger throws UNDECLARED DIVERGENCE -- D1 is load-bearing, not decorative', async () => {
  const entry = MATRIX.find((p) => p.scenario === pauseResume);
  const { refStream, extStream } = await captureFlippedPair(entry);

  // The divergence is REAL: without the ledger, the exact same stream pair
  // that passes above must fail loudly. This proves D1 is the thing
  // permitting it, not a comparison blind spot.
  assert.throws(
    () => compareStreams(refStream, extStream, entry.fixture, entry.scenario.name, []),
    /UNDECLARED DIVERGENCE/
  );
});

test('text-childlist with an EMPTY ledger throws UNDECLARED DIVERGENCE -- D6 is load-bearing, not decorative', async () => {
  const entry = MATRIX.find((p) => p.scenario === textChildlist);
  const { refStream, extStream } = await captureFlippedPair(entry);

  // The divergence is REAL: without the ledger, the exact same stream pair
  // that passes above must fail loudly. This proves D6 is the thing
  // permitting it, not a comparison blind spot.
  assert.throws(
    () => compareStreams(refStream, extStream, entry.fixture, entry.scenario.name, []),
    /UNDECLARED DIVERGENCE/
  );
});

test('sanitize-divergence with an EMPTY ledger throws UNDECLARED DIVERGENCE -- D7 is load-bearing, not decorative', async () => {
  const entry = MATRIX.find((p) => p.scenario === sanitizeDivergence);
  const { refStream, extStream } = await captureFlippedPair(entry);

  // The divergence is REAL: without the ledger, the exact same stream pair
  // that passes above must fail loudly. This proves D7 is the thing
  // permitting it, not a comparison blind spot.
  assert.throws(
    () => compareStreams(refStream, extStream, entry.fixture, entry.scenario.name, []),
    /UNDECLARED DIVERGENCE/
  );
});

test('phase8-protocol-extensions with an EMPTY ledger throws UNDECLARED DIVERGENCE -- D24 entries are load-bearing', async () => {
  const entry = MATRIX.find((p) => p.scenario === phase8ProtocolExtensions);
  const { refStream, extStream } = await captureFlippedPair(entry);

  assert.throws(
    () => compareStreams(refStream, extStream, entry.fixture, entry.scenario.name, []),
    /UNDECLARED DIVERGENCE/
  );
});

test('cssom-capture-mode with an EMPTY ledger throws UNDECLARED DIVERGENCE -- D25 is load-bearing', async () => {
  const entry = MATRIX.find((p) => p.scenario === cssomCaptureMode);
  const { refStream, extStream } = await captureFlippedPair(entry);

  assert.throws(
    () => compareStreams(refStream, extStream, entry.fixture, entry.scenario.name, []),
    /UNDECLARED DIVERGENCE/
  );
});

test('truncation-overflow snapshot-only with an EMPTY ledger throws UNDECLARED DIVERGENCE -- subtree markers are load-bearing', async () => {
  const entry = MATRIX.find((p) => p.fixture === 'truncation-overflow.html');
  const { refStream, extStream } = await captureFlippedPair(entry);

  assert.throws(
    () => compareStreams(refStream, extStream, entry.fixture, entry.scenario.name, []),
    /UNDECLARED DIVERGENCE/
  );
});

test('basic-mutations with an EMPTY ledger throws UNDECLARED DIVERGENCE -- add-op computed styles are load-bearing', async () => {
  const entry = MATRIX.find((p) => p.scenario === basicMutations);
  const { refStream, extStream } = await captureFlippedPair(entry);

  assert.throws(
    () => compareStreams(refStream, extStream, entry.fixture, entry.scenario.name, []),
    /UNDECLARED DIVERGENCE/
  );
});

test('static-assets with an EMPTY ledger throws UNDECLARED DIVERGENCE -- D26 currentSrc pin / asset degrade is load-bearing', async () => {
  const entry = MATRIX.find((p) => p.scenario === staticAssets);
  const { refStream, extStream } = await captureFlippedPair(entry);

  // The divergence is REAL: without D26, the same stream pair that passes
  // above must fail loudly -- proving the clone-only data-ps-currentsrc pin and
  // the blob:/oversized-data: placeholder degrade are the thing permitting it,
  // not a comparison blind spot.
  assert.throws(
    () => compareStreams(refStream, extStream, entry.fixture, entry.scenario.name, []),
    /UNDECLARED DIVERGENCE/
  );
});

test('media-playback-sync with an EMPTY ledger throws UNDECLARED DIVERGENCE -- D27 media[]/STREAM.MEDIA is load-bearing', async () => {
  const entry = MATRIX.find((p) => p.scenario === mediaPlaybackSync);
  const { refStream, extStream } = await captureFlippedPair(entry);

  // The divergence is REAL: without D27, the same stream pair that passes above
  // must fail loudly -- proving the extracted-only media[] baseline and the
  // STREAM.MEDIA side channel are the thing permitting it, not a comparison
  // blind spot.
  assert.throws(
    () => compareStreams(refStream, extStream, entry.fixture, entry.scenario.name, []),
    /UNDECLARED DIVERGENCE/
  );
});

test('a broken resume (post-resume MUTATIONS missing) is NOT excused by D1 -- the tightened ledger fails loudly', async () => {
  const entry = MATRIX.find((p) => p.scenario === pauseResume);
  const { refStream, extStream } = await captureFlippedPair(entry);

  // Synthesize the regression WR-02 warned about: resume() silently failing
  // to re-arm the observer would drop the extracted side's post-resume
  // MUTATIONS message. Before the predicate was tightened, clause (a)
  // excused EVERY ref-only trailing message -- including the now-trailing
  // post-resume SNAPSHOT -- so this exact stream pair compared green.
  const lastMutationsIndex = extStream.map((msg) => msg.type).lastIndexOf(STREAM.MUTATIONS);
  assert.ok(lastMutationsIndex >= 0, 'extracted stream contains a MUTATIONS message to drop');
  const broken = extStream.slice(0, lastMutationsIndex)
    .concat(extStream.slice(lastMutationsIndex + 1));

  assert.throws(
    () => compareStreams(refStream, broken, entry.fixture, entry.scenario.name, DIVERGENCES),
    /UNDECLARED DIVERGENCE/
  );
});

// MUST run last in the file (node:test preserves in-file definition order):
// consumes the matched-id set accumulated by every flipped matrix test.
test('every declared mismatch divergence matched at least one real divergence', () => {
  const mismatchEntries = DIVERGENCES.filter((entry) => entry.kind === 'mismatch');
  assert.ok(
    mismatchEntries.length >= 1,
    'the ledger declares at least one mismatch-kind entry (D1)'
  );
  for (const entry of mismatchEntries) {
    assert.ok(
      matchedMismatchIds.has(entry.id),
      `stale ledger entry: ${entry.id} never matched a real divergence (stale-entry detection, D-03)`
    );
  }
});
