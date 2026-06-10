// tests/differential/oracle.test.js -- differential oracle matrix (CAPT-04).
// Runs every frozen fixture x scripted scenario pair reference-vs-reference
// and proves zero divergences, so each reliability defense (truncation budget
// overflow, mutation bursts, add/rm/attr/text ops, scroll throttle, dialog
// interception, pause/resume lifecycle) has an oracle pair guarding it before
// the extraction lands (D-09 gate). Two explicit guards prevent
// identical-but-empty false confidence: the truncation pair must actually
// truncate, and the dialog pair must actually carry dialog messages. A
// negative control proves the oracle can FAIL loudly with fixture, scenario,
// and message index in the error.

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
  { fixture: 'heavy-realistic.html', scenario: snapshotOnly, config: {} },
  { fixture: 'heavy-realistic.html', scenario: structuralOps, config: {} },
  { fixture: 'truncation-overflow.html', scenario: snapshotOnly, config: { patchRects: true } },
  { fixture: 'canvas.html', scenario: snapshotOnly, config: {} },
  { fixture: 'dialog.html', scenario: dialog, config: { runScripts: 'dangerously' } },
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

test('reference and extracted captures emit equivalent streams for basic-mutations on basic.html', async () => {
  const refStream = await captureNormalizedStream('basic.html', basicMutations, {});
  const extStream = await captureExtractedStream('basic.html', basicMutations, {});

  assert.ok(refStream.length >= 3, `reference stream is non-trivial (got ${refStream.length} messages)`);
  assert.ok(extStream.length >= 3, `extracted stream is non-trivial (got ${extStream.length} messages)`);

  // Plain mutation scenarios have NO intentional divergences: the comparison
  // must pass without consulting a single ledger entry.
  const matched = compareStreams(refStream, extStream, 'basic.html', 'basic-mutations', DIVERGENCES);
  assert.equal(matched.size, 0, 'plain mutation scenarios consult zero ledger entries');
});
