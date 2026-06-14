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

import { STREAM, DIFF_OP } from '../../src/protocol/messages.js';

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

const D7_HOSTILE_SNAPSHOT_MARKER = /on\w+\s*=|javascript:|<object\b|<embed\b|srcdoc=|expression\(/i;
const D7_PASSWORD_PLAINTEXT = /hunter2/i;

/**
 * @param {*} msg
 * @returns {string}
 */
function snapshotSanitizationText(msg) {
  const payload = (msg && msg.payload) || {};
  const html = typeof payload.html === 'string' ? payload.html : '';
  const inlineStyles = Array.isArray(payload.inlineStyles)
    ? payload.inlineStyles.join('\n')
    : '';
  return html + '\n' + inlineStyles;
}

/**
 * @param {*} msg
 * @returns {Array<*>}
 */
function mutationOps(msg) {
  const ops = msg && msg.payload && msg.payload.mutations;
  return Array.isArray(ops) ? ops : [];
}

/**
 * @param {*} op
 * @returns {boolean}
 */
function isAttrOp(op) {
  return op && op.op === DIFF_OP.ATTR;
}

/**
 * @param {*} value
 * @returns {boolean}
 */
function hasDangerousAttrValue(value) {
  return /(?:javascript|vbscript):|data:text\/html/i.test(String(value || ''));
}

/**
 * @param {*} op
 * @returns {boolean}
 */
function isHostileAttrOp(op) {
  if (!isAttrOp(op)) return false;
  const attr = String(op.attr || '');
  return /^on/i.test(attr) || hasDangerousAttrValue(op.val);
}

/**
 * @param {*[]} ops
 * @returns {boolean}
 */
function hasBenignD7Anchor(ops) {
  return ops.some((op) => isAttrOp(op) && op.attr === 'class' && op.val === 'after');
}

/**
 * Declared divergences between the reference capture and the extracted core.
 * Exactly THREE mismatch-kind entries exist (D1: resume semantics, scoped to
 * pause-resume; D6: text-node childList fidelity fix, scoped to
 * text-childlist; D7: capture-side sanitization and masking, scoped to
 * sanitize-divergence); everything else the oracle compares is required to
 * be byte-equivalent after normalization.
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

      // Every shape D1 excuses traces back to the reference's post-resume
      // re-snapshot, whose messages by construction carry the FRESH minted
      // identity (ordinal >= 2). A reference message still on the original
      // SESSION_1/SNAPSHOT_1 identity can never be a D1 artifact, so it is
      // never excused (WR-02 tightening: the predicate claims D1's exact
      // shape, not "any mismatch inside pause-resume").
      const refPayload = (refMsg && refMsg.payload) || {};
      const refSession = placeholderOrdinal(refPayload.streamSessionId, 'SESSION');
      const refSnapshot = placeholderOrdinal(refPayload.snapshotId, 'SNAPSHOT');
      const refHasFreshIdentity = (refSession !== null && refSession >= 2)
        || (refSnapshot !== null && refSnapshot >= 2);

      // (a) Ref-only trailing message: the reference's two extra post-resume
      // messages shift every later index past the extracted stream's end.
      // In the healthy alignment the trailing region is exactly the forced
      // OVERLAY plus the re-stamped post-resume MUTATIONS (the post-resume
      // SNAPSHOT aligns against the extracted MUTATIONS as the type mismatch
      // in clause b). A trailing SNAPSHOT therefore means the extracted side
      // FAILED to emit its post-resume MUTATIONS (e.g. resume() never
      // re-armed the observer) -- that regression must hard-fail, so
      // SNAPSHOT is deliberately NOT excusable here.
      if (refMsg !== undefined && extMsg === undefined) {
        return refHasFreshIdentity
          && (refMsg.type === STREAM.OVERLAY || refMsg.type === STREAM.MUTATIONS);
      }
      if (refMsg === undefined || extMsg === undefined) return false;

      const extPayload = extMsg.payload || {};
      const extSession = placeholderOrdinal(extPayload.streamSessionId, 'SESSION');
      const extSnapshot = placeholderOrdinal(extPayload.snapshotId, 'SNAPSHOT');

      // (b) Shifted-index TYPE mismatch: the reference's post-resume
      // SNAPSHOT or forced OVERLAY (fresh identity) aligned against the
      // extracted side's post-resume MUTATIONS, which must continue the
      // ORIGINAL session (SESSION_1/SNAPSHOT_1 -- the thing D1 says still
      // happens). Any other type pairing (e.g. the extracted side emitting
      // the wrong message type after resume) stays an undeclared divergence.
      if (refMsg.type !== extMsg.type) {
        return refHasFreshIdentity
          && (refMsg.type === STREAM.SNAPSHOT || refMsg.type === STREAM.OVERLAY)
          && extMsg.type === STREAM.MUTATIONS
          && extSession === 1
          && extSnapshot === 1;
      }

      // (c) Identity-placeholder mismatch: same type, but the reference
      // payload carries the FRESH post-resume identity (SESSION_2 /
      // SNAPSHOT_2) where the extracted payload continues SESSION_1 /
      // SNAPSHOT_1 -- exactly the same-vs-fresh structure that ordinal
      // canonicalization deliberately preserves (D-02 signal).
      if (refSession !== null && extSession !== null && refSession > extSession) return true;
      if (refSnapshot !== null && extSnapshot !== null && refSnapshot > extSnapshot) return true;

      return false;
    },
  },
  {
    id: 'D6-text-childlist-fidelity-fix',
    kind: 'mismatch',
    description:
      'The reference childList branch (reference/extension/dom-stream.js, element-only '
      + 'added/removed loops) drops childList records whose added/removed nodes are bare '
      + 'TEXT/CDATA nodes. el.textContent = "..." replaces the text child as exactly that '
      + 'record shape -- NOT characterData -- so the reference emits NO wire signal and '
      + 'the mirror silently drifts (Phase 2 real-browser checkpoint finding: 8 of 13 '
      + 'rows stale in examples/loopback-mirror.html, no stale-miss, no self-heal). The '
      + 'extracted core emits a per-batch-deduplicated { op: "text", nid: <target nid>, '
      + 'text: target.textContent } op for the mutation TARGET (the parent element), '
      + 'producing an extracted-only trailing MUTATIONS message the reference stream '
      + 'lacks.',
    rationale:
      'Deliberate fidelity FIX divergence (Phase 2): the extracted core must mirror '
      + 'textContent= edits; reference parity here would preserve a data-loss bug. '
      + 'Capture-side change documented as src/capture/README.md entry E2; the renderer '
      + 'is unchanged (the DIFF_OP.TEXT applier already handles the op shape). '
      + 'Mixed-content guard (review CR-01): emission is gated on the live target '
      + 'having no element children at flush time (firstElementChild) -- the renderer '
      + 'applies the op as textContent=, which would destroy mirrored element subtrees '
      + 'that still exist live. Mixed-content text changes therefore keep the '
      + 'reference\'s drop behavior (text drift, structure intact) and produce NO '
      + 'extracted-only message; the text-childlist scenario\'s text-only target keeps '
      + 'this entry matching. Pinned end-to-end by tests/renderer-loopback.test.js and '
      + 'by the text-childlist scenario here.',
    affectedMessages: [STREAM.MUTATIONS],
    affectedScenarios: ['text-childlist'],
    appliesTo(refMsg, extMsg, scenarioName) {
      // The scenario guard is load-bearing (same discipline as D1): a bare
      // text-node childList divergence surfacing in any OTHER scenario must
      // still hard-fail as UNDECLARED DIVERGENCE.
      if (scenarioName !== 'text-childlist') return false;

      // D6's exact shape: an EXTRACTED-ONLY trailing message (the reference
      // emits nothing for the dropped mutation class, so the extracted
      // stream is one message longer) that is a MUTATIONS batch composed
      // PURELY of text ops. Any reference-side counterpart, any other
      // message type, or any element op mixed into the batch stays
      // undeclared.
      if (refMsg !== undefined || extMsg === undefined) return false;
      if (extMsg.type !== STREAM.MUTATIONS) return false;
      const ops = (extMsg.payload && extMsg.payload.mutations) || [];
      return Array.isArray(ops)
        && ops.length > 0
        && ops.every((op) => op.op === DIFF_OP.TEXT);
    },
  },
  {
    id: 'D7-capture-sanitization',
    kind: 'mismatch',
    description:
      'The reference serializes raw hostile content -- on* handlers, javascript: '
      + 'URLs, srcdoc, object/embed surfaces, hostile CSS, and password plaintext -- '
      + 'through both SNAPSHOT and MUTATIONS messages. The extracted core routes wire '
      + 'values through src/capture/index.js sanitizeForWire, which strips handlers, '
      + 'drops object/embed surfaces, neutralizes dangerous URL attrs, scrubs hostile '
      + 'CSS, and masks password values before transport.',
    rationale:
      'Deliberate security divergence (Phase 3): CONTEXT locks sanitizers and '
      + 'password masking as always-on with no opt-out, and requires capture-side '
      + 'sanitization to be ledgered like D6 -- tightly scoped, scenario-pinned, '
      + 'and load-bearing. Pinned end-to-end by sanitize-corpus.html plus the '
      + 'sanitize-divergence scenario.',
    affectedMessages: [STREAM.SNAPSHOT, STREAM.MUTATIONS],
    affectedScenarios: ['sanitize-divergence'],
    appliesTo(refMsg, extMsg, scenarioName) {
      if (scenarioName !== 'sanitize-divergence') return false;

      // The scenario guard is load-bearing (same discipline as D1/D6): a
      // sanitization-shaped mismatch surfacing in any OTHER scenario must
      // still hard-fail as UNDECLARED DIVERGENCE.
      // D7's exact shape is a SAME-INDEX mismatch. A trailing message,
      // missing counterpart, or type mismatch is not a sanitization strip.
      if (refMsg === undefined || extMsg === undefined) return false;
      if (refMsg.type !== extMsg.type) return false;

      if (refMsg.type === STREAM.SNAPSHOT) {
        const refText = snapshotSanitizationText(refMsg);
        const extText = snapshotSanitizationText(extMsg);
        const refCarriesSanitizable =
          D7_HOSTILE_SNAPSHOT_MARKER.test(refText) || D7_PASSWORD_PLAINTEXT.test(refText);
        const extCarriesSanitizable =
          D7_HOSTILE_SNAPSHOT_MARKER.test(extText) || D7_PASSWORD_PLAINTEXT.test(extText);
        return refCarriesSanitizable && !extCarriesSanitizable;
      }

      if (refMsg.type === STREAM.MUTATIONS) {
        const refOps = mutationOps(refMsg);
        const extOps = mutationOps(extMsg);
        const refHostileOps = refOps.filter(isHostileAttrOp);
        if (refHostileOps.length === 0) return false;
        if (!hasBenignD7Anchor(refOps) || !hasBenignD7Anchor(extOps)) return false;

        const extHasHostileOps = extOps.some(isHostileAttrOp);
        if (extHasHostileOps) return false;

        return refHostileOps.every((refOp) => {
          const attr = String(refOp.attr || '').toLowerCase();
          if (/^on/i.test(attr)) {
            return !extOps.some((extOp) => isAttrOp(extOp)
              && String(extOp.attr || '').toLowerCase() === attr);
          }
          return extOps.some((extOp) => isAttrOp(extOp)
            && String(extOp.attr || '').toLowerCase() === attr
            && extOp.val === null);
        });
      }

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
      'pause-resume', 'snapshot-only', 'dialog', 'text-childlist',
      'sanitize-divergence',
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
      'pause-resume', 'snapshot-only', 'dialog', 'text-childlist',
      'sanitize-divergence',
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
