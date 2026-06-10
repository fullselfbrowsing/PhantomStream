// tests/differential/normalize.js -- pure transforms for the differential
// oracle: map the reference's chrome-message shapes ({ action, ...fields })
// onto canonical { type, payload } records, canonicalize nondeterministic
// identity fields, and compare streams with first-divergence reporting.
// Wire type strings come from src/protocol -- never restated here.

import assert from 'node:assert/strict';
import { STREAM } from '../../src/protocol/messages.js';
import { ledgerCovers } from './divergence-ledger.js';

/**
 * Map raw reference-side messages to canonical { type, payload } records
 * using the fixed action -> protocol-type table.
 *
 * Copies ONLY keys actually present on the source message (rest-spread of
 * existing keys, no fixed field list): the reference's stop-path final
 * mutations flush carries NO staleFlushCount, and unconditionally mapping a
 * fixed field set would manufacture `staleFlushCount: undefined`, which
 * assert.deepStrictEqual distinguishes from a missing key -- a phantom
 * divergence waiting to fire when side B becomes the extracted core.
 *
 * @param {object[]} msgs  raw messages recorded by the harness sendMessage stub
 * @returns {{ type: string, payload: object }[]}
 */
export function normalizeReference(msgs) {
  return msgs.map((msg) => {
    const { action, ...rest } = msg;
    switch (action) {
      case 'domStreamSnapshot':
        return { type: STREAM.SNAPSHOT, payload: msg.snapshot };
      case 'domStreamMutations':
        return { type: STREAM.MUTATIONS, payload: rest };
      case 'domStreamScroll':
        return { type: STREAM.SCROLL, payload: rest };
      case 'domStreamOverlay':
        return { type: STREAM.OVERLAY, payload: rest };
      case 'domStreamDialog':
        return { type: STREAM.DIALOG, payload: { dialog: msg.dialog } };
      case 'domStreamReady':
        return { type: STREAM.READY, payload: {} };
      default:
        throw new Error('unknown-reference-action: ' + String(action));
    }
  });
}

// Valid protocol type strings the extracted core may emit through the
// Transport seam -- anything else is a corrupted loopback record, not a
// divergence, and must fail loudly here rather than slide into comparison.
const STREAM_TYPES = new Set(Object.values(STREAM));

/**
 * Map raw extracted-side loopback records ({ type, payload } as pushed by
 * the harness loopback transport) into the same canonical { type, payload }
 * shape normalizeReference produces. Types are already protocol STREAM
 * values, so they pass through (after a sanity check); payloads pass through
 * untouched. READY normalizes to an empty payload on BOTH sides, so the
 * reference's script-load ping (an { action }-only message) and the extracted
 * core's factory-creation ping compare equal (the residual timing-contract
 * difference is ledger entry D3).
 *
 * @param {{ type: string, payload: object }[]} msgs  loopback transport records
 * @returns {{ type: string, payload: object }[]}
 */
export function normalizeExtracted(msgs) {
  return msgs.map((msg) => {
    if (!STREAM_TYPES.has(msg.type)) {
      throw new Error('unknown-extracted-type: ' + String(msg.type));
    }
    if (msg.type === STREAM.READY) {
      return { type: STREAM.READY, payload: {} };
    }
    return { type: msg.type, payload: msg.payload };
  });
}

/**
 * Replace nondeterministic identity values with ordinal placeholders by
 * first occurrence: streamSessionId strings become SESSION_1, SESSION_2, ...
 * and snapshotId numbers become SNAPSHOT_1, SNAPSHOT_2, ... Ordinal (NOT
 * constant) placeholders preserve same-vs-fresh identity structure, which
 * the normalized-structural-equivalence definition (D-02) requires and the
 * pause/resume divergence (D1, Plan 01-04) depends on.
 *
 * Applied recursively wherever the fields appear (top-level payloads and
 * nested ones, e.g. dialog payloads carry identity via attachStreamMetadata).
 * nids are deliberately NOT canonicalized: both sides assign nids in
 * identical TreeWalker document order, so raw nid equality is signal.
 *
 * Pure: returns a deep copy, never mutates the input.
 *
 * @param {{ type: string, payload: object }[]} normalizedMsgs
 * @returns {{ type: string, payload: object }[]}
 */
export function canonicalizeIdentity(normalizedMsgs) {
  const cloned = structuredClone(normalizedMsgs);
  const sessionOrdinals = new Map();
  const snapshotOrdinals = new Map();

  function placeholderFor(ordinals, prefix, value) {
    if (!ordinals.has(value)) {
      ordinals.set(value, prefix + '_' + (ordinals.size + 1));
    }
    return ordinals.get(value);
  }

  function walk(node) {
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    if (!node || typeof node !== 'object') return;
    for (const key of Object.keys(node)) {
      const value = node[key];
      if (key === 'streamSessionId' && typeof value === 'string' && value !== '') {
        node[key] = placeholderFor(sessionOrdinals, 'SESSION', value);
      } else if (key === 'snapshotId' && typeof value === 'number' && value !== 0) {
        node[key] = placeholderFor(snapshotOrdinals, 'SNAPSHOT', value);
      } else {
        walk(value);
      }
    }
  }

  walk(cloned);
  return cloned;
}

/**
 * Compare two normalized streams message-by-message with first-divergence
 * reporting. Iterates to the longer length so a missing trailing message
 * (undefined side) is itself a divergence. On mismatch, the ledger is
 * consulted; uncovered mismatches throw UNDECLARED DIVERGENCE naming the
 * fixture, scenario, and message index.
 *
 * @param {{ type: string, payload: object }[]} refNormalized
 * @param {{ type: string, payload: object }[]} otherNormalized
 * @param {string} fixture    fixture file name, e.g. 'basic.html'
 * @param {string} scenario   scenario name, e.g. 'basic-mutations'
 * @param {import('./divergence-ledger.js').DivergenceEntry[]} ledger
 * @returns {Set<string>} ids of ledger entries that matched at least one
 *   mismatch (consumed by stale-entry detection in Plan 01-04)
 */
export function compareStreams(refNormalized, otherNormalized, fixture, scenario, ledger) {
  const matchedEntryIds = new Set();
  const length = Math.max(refNormalized.length, otherNormalized.length);

  for (let i = 0; i < length; i++) {
    try {
      assert.deepStrictEqual(otherNormalized[i], refNormalized[i]);
    } catch (originalError) {
      const entryId = ledgerCovers(ledger, refNormalized[i], otherNormalized[i], scenario);
      if (entryId) {
        matchedEntryIds.add(entryId);
        continue;
      }
      throw new Error(
        'UNDECLARED DIVERGENCE ' + fixture + '/' + scenario +
        ' at message ' + i + ':\n' + originalError.message
      );
    }
  }

  return matchedEntryIds;
}
