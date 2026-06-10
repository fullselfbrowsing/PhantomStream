// tests/differential/divergence-ledger.js -- machine-readable declared-
// divergence registry (locked decision D-03). The differential oracle FAILS
// on any per-message mismatch not claimed by an entry here; human-readable
// divergence docs derive from this module, never the other way around.
//
// Kind semantics:
//  - kind 'mismatch' entries claim REAL per-message comparison failures.
//    Every mismatch entry MUST match at least one divergence per full oracle
//    run -- the stale-entry detection test at the end of oracle.test.js
//    asserts the matched-id set covers all of them, so a dead entry cannot
//    silently keep excusing divergences that no longer exist.
//  - kind 'documented-mapping' entries document divergences that produce NO
//    runtime mismatch by construction: they are either absorbed structurally
//    by normalize.js before comparison (D2, D3) or never exercised by any
//    fixture scenario (D4, D5). They are exempt from stale-entry detection
//    and ledgerCovers never consults them.

import { STREAM } from '../../src/protocol/messages.js';

/**
 * @typedef {Object} DivergenceEntry
 * @property {string} id
 *   Stable identifier, e.g. 'D1-resume-no-resnapshot'.
 * @property {'mismatch'|'documented-mapping'} kind
 *   'mismatch' entries claim real per-message comparison failures and must
 *   match at least one divergence per oracle run (stale-entry detection,
 *   Plan 01-04). 'documented-mapping' entries document divergences absorbed
 *   structurally by normalize.js (e.g. envelope re-shaping) and are exempt
 *   from stale-entry detection -- ledgerCovers never consults them.
 * @property {string} description
 *   What differs between the reference and the other side.
 * @property {string} rationale
 *   Why the divergence is intentional (decision/CONTEXT reference).
 * @property {string[]} affectedMessages
 *   Protocol type strings (values from STREAM in src/protocol/messages.js).
 * @property {string[]} affectedScenarios
 *   Scenario names the divergence is expected to appear in.
 * @property {(refMsg: *, extMsg: *, scenarioName: string) => boolean} appliesTo
 *   Predicate marking an individual mismatch as covered by this entry.
 */

/**
 * Parse the numeric ordinal out of a canonicalized identity placeholder
 * ('SESSION_2' -> 2, 'SNAPSHOT_1' -> 1); null for anything else. Ledger
 * predicates only ever see canonicalized streams (compareStreams runs after
 * canonicalizeIdentity), so raw session ids / epoch snapshot ids never reach
 * this function.
 *
 * @param {*} value
 * @param {'SESSION'|'SNAPSHOT'} prefix
 * @returns {number|null}
 */
function placeholderOrdinal(value, prefix) {
  if (typeof value !== 'string' || !value.startsWith(prefix + '_')) return null;
  const ordinal = Number(value.slice(prefix.length + 1));
  return Number.isInteger(ordinal) && ordinal > 0 ? ordinal : null;
}

/**
 * Declared divergences between the reference capture and the extracted core.
 * Exactly ONE mismatch-kind entry exists (D1); everything else the oracle
 * compares is required to be byte-equivalent after normalization.
 * @type {DivergenceEntry[]}
 */
export const DIVERGENCES = [
  {
    id: 'D1-resume-no-resnapshot',
    kind: 'mismatch',
    description:
      'Reference resume() (reference/extension/dom-stream.js 1061-1080) mints a new '
      + 'session (beginStreamSession), re-serializes and sends a fresh SNAPSHOT, and '
      + 'force-broadcasts overlay state (broadcastOverlayState(true) at line 1078 -- '
      + 'force=true bypasses the 500 ms throttle guard at line 937, so the post-resume '
      + 'OVERLAY message ALWAYS emits). The extracted resume() re-arms observers and '
      + 'continues the same streamSessionId/snapshotId with NO snapshot and NO overlay '
      + 'broadcast; mutations missed while paused stay missed.',
    rationale:
      'USER OVERRIDE (01-CONTEXT.md, D-06): resume must not auto-snapshot; '
      + 'missed-while-paused mutations are a documented host contract -- hosts that '
      + 'need a fresh view call stop() then start().',
    affectedMessages: [STREAM.SNAPSHOT, STREAM.OVERLAY, STREAM.MUTATIONS],
    affectedScenarios: ['pause-resume'],
    appliesTo(refMsg, extMsg, scenarioName) {
      // The scenario guard is load-bearing: the same mismatch shapes below
      // MUST still hard-fail as UNDECLARED DIVERGENCE in every other
      // scenario.
      if (scenarioName !== 'pause-resume') return false;

      // (a) Ref-only trailing message: the reference stream is longer once
      // its two extra post-resume messages (SNAPSHOT + forced OVERLAY) shift
      // every later index past the extracted stream's end.
      if (refMsg !== undefined && extMsg === undefined) return true;
      if (refMsg === undefined || extMsg === undefined) return false;

      // (b) Shifted-index TYPE mismatch: e.g. the reference's post-resume
      // SNAPSHOT or OVERLAY aligned against the extracted side's post-resume
      // MUTATIONS.
      if (refMsg.type !== extMsg.type) return true;

      // (c) Identity-placeholder mismatch: same type, but the reference
      // payload carries the FRESH post-resume identity (SESSION_2 /
      // SNAPSHOT_2) where the extracted payload continues SESSION_1 /
      // SNAPSHOT_1 -- exactly the same-vs-fresh structure that ordinal
      // canonicalization deliberately preserves (D-02 signal).
      const refPayload = refMsg.payload || {};
      const extPayload = extMsg.payload || {};
      const refSession = placeholderOrdinal(refPayload.streamSessionId, 'SESSION');
      const extSession = placeholderOrdinal(extPayload.streamSessionId, 'SESSION');
      if (refSession !== null && extSession !== null && refSession > extSession) return true;
      const refSnapshot = placeholderOrdinal(refPayload.snapshotId, 'SNAPSHOT');
      const extSnapshot = placeholderOrdinal(extPayload.snapshotId, 'SNAPSHOT');
      if (refSnapshot !== null && extSnapshot !== null && refSnapshot > extSnapshot) return true;

      return false;
    },
  },
  {
    id: 'D2-envelope-shape',
    kind: 'documented-mapping',
    description:
      'The reference wraps every wire message as a chrome runtime message '
      + '({ action: "domStream...", ...fields }); the extracted core emits '
      + 'transport.send(type, payload) with protocol STREAM type strings. Absorbed '
      + 'structurally by normalize.js: normalizeReference maps the fixed '
      + 'action -> STREAM table onto canonical { type, payload } records, '
      + 'normalizeExtracted passes loopback records through.',
    rationale:
      'Transport seam design (CAPT-01): hosts inject delivery; chrome.runtime '
      + 'messaging is reference-deployment plumbing, not protocol.',
    affectedMessages: [
      STREAM.READY, STREAM.SNAPSHOT, STREAM.MUTATIONS,
      STREAM.SCROLL, STREAM.OVERLAY, STREAM.DIALOG,
    ],
    affectedScenarios: [
      'basic-mutations', 'mutation-burst', 'structural-ops', 'scroll',
      'pause-resume', 'snapshot-only', 'dialog',
    ],
    // Never consulted: documented-mapping divergences are absorbed by
    // normalize.js BEFORE comparison, so no mismatch can reach the ledger.
    appliesTo() { return false; },
  },
  {
    id: 'D3-ready-at-factory-creation',
    kind: 'documented-mapping',
    description:
      'The reference pings domStreamReady once at script-injection time (content '
      + 'script load); the extracted core emits STREAM.READY once at createCapture() '
      + 'factory creation. In harness ordering both precede start(), so the normalized '
      + 'streams align position-for-position; the host-VISIBLE timing contract differs '
      + '(script load vs factory call).',
    rationale:
      'An explicitly imported module has no script-load moment a host can observe; '
      + 'factory creation is the closest analog (Plan 01-03).',
    affectedMessages: [STREAM.READY],
    affectedScenarios: [
      'basic-mutations', 'mutation-burst', 'structural-ops', 'scroll',
      'pause-resume', 'snapshot-only', 'dialog',
    ],
    appliesTo() { return false; },
  },
  {
    id: 'D4-ping-probe-dropped',
    kind: 'documented-mapping',
    description:
      'The reference answers a pingDomStream readiness probe (the host polls the '
      + 'content script at 200 ms intervals until { ready: true }); the extracted core '
      + 'drops the probe entirely -- hosts hold a direct reference to the factory '
      + 'handle, which makes a readiness poll moot. Produces no wire messages on '
      + 'either side in any harness scenario.',
    rationale:
      'MV3-deployment plumbing, not capture semantics; the MV3 adapter reintroduces '
      + 'it host-side in Phase 6 (ADPT-01).',
    affectedMessages: [],
    affectedScenarios: [],
    appliesTo() { return false; },
  },
  {
    id: 'D5-request-overlay-dropped',
    kind: 'documented-mapping',
    description:
      'The reference handles a domStreamRequestOverlay control message '
      + '(reference/extension/dom-stream.js 1082-1085: background-triggered forced '
      + 'broadcastOverlayState(true), used by the MV3 watchdog alarm to demand an '
      + 'overlay rebroadcast); the extracted core drops the control path. The factory '
      + 'surface is exactly { start, stop, pause, resume } per D-05, so no host-facing '
      + 'on-demand overlay rebroadcast exists in this version. Produces no runtime '
      + 'mismatch by construction: no fixture scenario sends the control message, so '
      + 'neither side ever emits the on-demand rebroadcast.',
    rationale:
      'Mirrors D4: host-control plumbing reintroduced host-side by the MV3 adapter '
      + 'in Phase 6 (ADPT-01).',
    affectedMessages: [STREAM.OVERLAY],
    affectedScenarios: [],
    appliesTo() { return false; },
  },
];

/**
 * Return the id of the first 'mismatch' ledger entry whose predicate covers
 * this divergence, or null when the divergence is undeclared.
 * Only 'mismatch' entries are consulted: 'documented-mapping' entries are
 * absorbed by normalize.js before comparison and never excuse a mismatch.
 *
 * @param {DivergenceEntry[]} ledger
 * @param {*} refMsg     normalized reference-side message (may be undefined)
 * @param {*} extMsg     normalized other-side message (may be undefined)
 * @param {string} scenarioName
 * @returns {string|null}
 */
export function ledgerCovers(ledger, refMsg, extMsg, scenarioName) {
  for (const entry of ledger) {
    if (entry.kind !== 'mismatch') continue;
    try {
      if (entry.appliesTo(refMsg, extMsg, scenarioName)) return entry.id;
    } catch (e) {
      // A broken predicate must never silently excuse an undeclared divergence.
    }
  }
  return null;
}
