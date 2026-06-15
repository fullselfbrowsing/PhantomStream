// tests/differential/normalize.js -- pure transforms for the differential
// oracle: map the reference's chrome-message shapes ({ action, ...fields })
// onto canonical { type, payload } records, canonicalize nondeterministic
// identity fields, and compare streams with first-divergence reporting.
// Wire type strings come from src/protocol -- never restated here.

import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { STREAM, DIFF_OP } from '../../src/protocol/messages.js';
import { ledgerCovers } from './divergence-ledger.js';

const FRAMEWORK_IDENTITY_ATTR = 'data-fsb-nid';

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

function sameStringArray(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function extractReferenceIdentityHtml(html) {
  const dom = new JSDOM('<!DOCTYPE html><template></template>');
  const template = dom.window.document.querySelector('template');
  template.innerHTML = String(html || '');
  const nodeIds = [];
  for (const element of template.content.querySelectorAll('*')) {
    const nid = element.getAttribute(FRAMEWORK_IDENTITY_ATTR);
    if (nid !== null) {
      nodeIds.push(nid);
      element.removeAttribute(FRAMEWORK_IDENTITY_ATTR);
    }
  }
  return { html: template.innerHTML, nodeIds };
}

function normalizeIdentitySidecarPayloadPair(refPayload, otherPayload) {
  if (!refPayload || !otherPayload) return [refPayload, otherPayload];
  if (typeof refPayload.html !== 'string' || typeof otherPayload.html !== 'string') {
    return normalizeEmptyPhase8SidecarsPair(refPayload, otherPayload);
  }
  if (!Array.isArray(otherPayload.nodeIds)) return [refPayload, otherPayload];

  const refIdentity = extractReferenceIdentityHtml(refPayload.html);
  if (refIdentity.nodeIds.length === 0) {
    return normalizeEmptyPhase8SidecarsPair(refPayload, otherPayload);
  }
  if (!sameStringArray(refIdentity.nodeIds, otherPayload.nodeIds)) {
    return normalizeEmptyPhase8SidecarsPair(refPayload, otherPayload);
  }

  return normalizeEmptyPhase8SidecarsPair(
    Object.assign({}, refPayload, {
      html: refIdentity.html,
      nodeIds: refIdentity.nodeIds,
    }),
    otherPayload
  );
}

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function normalizeEmptyPhase8SidecarsPair(refPayload, otherPayload) {
  if (!refPayload || !otherPayload) return [refPayload, otherPayload];

  const nextRef = Object.assign({}, refPayload);
  let changed = false;
  for (const key of ['shadowRoots', 'frames']) {
    if (!hasOwn(nextRef, key)
      && Array.isArray(otherPayload[key])
      && otherPayload[key].length === 0) {
      nextRef[key] = [];
      changed = true;
    }
  }

  return changed ? [nextRef, otherPayload] : [refPayload, otherPayload];
}

function normalizeIdentitySidecarMutationPair(refPayload, otherPayload) {
  const refOps = refPayload && refPayload.mutations;
  const otherOps = otherPayload && otherPayload.mutations;
  if (!Array.isArray(refOps) || !Array.isArray(otherOps)) {
    return [refPayload, otherPayload];
  }

  let changed = false;
  const normalizedRefOps = refOps.map((refOp, index) => {
    const otherOp = otherOps[index];
    if (!refOp || !otherOp || refOp.op !== DIFF_OP.ADD || otherOp.op !== DIFF_OP.ADD) {
      return refOp;
    }
    const [normalizedRefOp] = normalizeIdentitySidecarPayloadPair(refOp, otherOp);
    if (normalizedRefOp !== refOp) changed = true;
    return normalizedRefOp;
  });

  if (!changed) return [refPayload, otherPayload];
  return [
    Object.assign({}, refPayload, { mutations: normalizedRefOps }),
    otherPayload,
  ];
}

function normalizeIdentitySidecarMessagePair(refMsg, otherMsg) {
  if (!refMsg || !otherMsg || refMsg.type !== otherMsg.type) {
    return [refMsg, otherMsg];
  }
  if (refMsg.type === STREAM.SNAPSHOT) {
    const [refPayload, otherPayload] = normalizeIdentitySidecarPayloadPair(
      refMsg.payload,
      otherMsg.payload
    );
    if (refPayload === refMsg.payload && otherPayload === otherMsg.payload) {
      return [refMsg, otherMsg];
    }
    return [
      Object.assign({}, refMsg, { payload: refPayload }),
      Object.assign({}, otherMsg, { payload: otherPayload }),
    ];
  }
  if (refMsg.type === STREAM.MUTATIONS) {
    const [refPayload, otherPayload] = normalizeIdentitySidecarMutationPair(
      refMsg.payload,
      otherMsg.payload
    );
    if (refPayload === refMsg.payload && otherPayload === otherMsg.payload) {
      return [refMsg, otherMsg];
    }
    return [
      Object.assign({}, refMsg, { payload: refPayload }),
      Object.assign({}, otherMsg, { payload: otherPayload }),
    ];
  }
  return [refMsg, otherMsg];
}

function streamUsesNodeIdSidecars(messages) {
  return messages.some((msg) => {
    if (!msg || !msg.payload) return false;
    if (Array.isArray(msg.payload.nodeIds)) return true;
    const ops = msg.payload.mutations;
    return Array.isArray(ops)
      && ops.some((op) => op && op.op === DIFF_OP.ADD && Array.isArray(op.nodeIds));
  });
}

function isReferenceIdentityAttrOp(op) {
  return op
    && op.op === DIFF_OP.ATTR
    && op.attr === FRAMEWORK_IDENTITY_ATTR
    && op.nid === op.val;
}

function stripReferenceIdentityAttrOps(messages, enabled) {
  if (!enabled) return messages;
  const out = [];
  for (const msg of messages) {
    if (!msg || msg.type !== STREAM.MUTATIONS) {
      out.push(msg);
      continue;
    }
    const ops = msg.payload && msg.payload.mutations;
    if (!Array.isArray(ops)) {
      out.push(msg);
      continue;
    }
    const filtered = ops.filter((op) => !isReferenceIdentityAttrOp(op));
    if (filtered.length === 0) continue;
    if (filtered.length === ops.length) {
      out.push(msg);
      continue;
    }
    out.push(Object.assign({}, msg, {
      payload: Object.assign({}, msg.payload, { mutations: filtered }),
    }));
  }
  return out;
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
  const sidecarMode = streamUsesNodeIdSidecars(otherNormalized);
  const refComparableStream = stripReferenceIdentityAttrOps(refNormalized, sidecarMode);
  const otherComparableStream = otherNormalized;
  const length = Math.max(refComparableStream.length, otherComparableStream.length);

  for (let i = 0; i < length; i++) {
    const [refComparable, otherComparable] = normalizeIdentitySidecarMessagePair(
      refComparableStream[i],
      otherComparableStream[i]
    );
    try {
      assert.deepStrictEqual(otherComparable, refComparable);
    } catch (originalError) {
      const entryId = ledgerCovers(ledger, refComparable, otherComparable, scenario);
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
