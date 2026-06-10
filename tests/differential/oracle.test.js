// tests/differential/oracle.test.js -- differential oracle self-test (CAPT-04).
// Proves (1) the harness yields equivalent normalized streams for two
// independent reference-side captures of the same frozen fixture under the
// same scripted scenario (ref-vs-ref), and (2) the oracle can FAIL loudly:
// tampering a single payload field reports an UNDECLARED DIVERGENCE with
// fixture name, scenario name, and message index (negative control).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createReferenceSide, runScenario } from './harness.js';
import { normalizeReference, canonicalizeIdentity, compareStreams } from './normalize.js';
import { DIVERGENCES } from './divergence-ledger.js';
import { STREAM, DIFF_OP } from '../../src/protocol/messages.js';
import * as basicMutations from './scenarios/basic-mutations.js';

const fixtureHtml = readFileSync(
  new URL('./fixtures/basic.html', import.meta.url),
  'utf8'
);

/**
 * Run one full reference-side capture of basic.html under basic-mutations
 * and return its normalized, identity-canonicalized stream.
 * The side is ALWAYS closed (watchdog setTimeout chain leak -- Pitfall 3).
 */
async function captureNormalizedStream() {
  const side = createReferenceSide(fixtureHtml);
  try {
    const sent = await runScenario(side, basicMutations);
    return canonicalizeIdentity(normalizeReference(sent));
  } finally {
    side.close();
  }
}

test('two independent reference captures of basic.html emit equivalent normalized streams', async () => {
  // Run side A fully to completion BEFORE constructing side B -- interleaving
  // would batch mutations differently per side (Pitfall 10).
  const streamA = await captureNormalizedStream();
  const streamB = await captureNormalizedStream();

  // A silently-empty harness must not pass: at minimum ready, snapshot, and
  // one mutations message.
  assert.ok(streamA.length >= 3, `stream A is non-trivial (got ${streamA.length} messages)`);
  assert.ok(streamB.length >= 3, `stream B is non-trivial (got ${streamB.length} messages)`);

  // Ref-vs-ref has zero divergences by construction: must not throw.
  compareStreams(streamA, streamB, 'basic.html', 'basic-mutations', DIVERGENCES);
});

test('tampering one payload field reports UNDECLARED DIVERGENCE with fixture, scenario, and index', async () => {
  const stream = await captureNormalizedStream();
  const tampered = structuredClone(stream);

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
    () => compareStreams(stream, tampered, 'basic.html', 'basic-mutations', DIVERGENCES),
    (error) => {
      assert.match(error.message, /UNDECLARED DIVERGENCE/);
      assert.ok(error.message.includes('basic.html'), 'error names the fixture');
      assert.ok(error.message.includes('basic-mutations'), 'error names the scenario');
      assert.match(error.message, /at message \d+/);
      return true;
    }
  );
});
