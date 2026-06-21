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

import { isDeepStrictEqual } from 'node:util';
import { JSDOM } from 'jsdom';
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

function nonEmptyArray(value) {
  return Array.isArray(value) && value.length > 0;
}

function payloadHtml(msg) {
  return String((msg && msg.payload && msg.payload.html) || '');
}

function phase8SnapshotPayload(msg) {
  const payload = msg && msg.payload;
  if (!payload || msg.type !== STREAM.SNAPSHOT) return null;
  return payload;
}

function hasPhase8ShadowFrameSnapshot(payload) {
  if (!payload) return false;
  if (!nonEmptyArray(payload.shadowRoots) || !nonEmptyArray(payload.frames)) return false;
  const shadow = payload.shadowRoots.find((entry) => entry
    && typeof entry.hostNid === 'string'
    && entry.mode === 'open'
    && typeof entry.html === 'string'
    && entry.html.includes('phase8-shadow-action')
    && entry.html.includes('slot name="title"')
    && Array.isArray(entry.nodeIds)
    && entry.nodeIds.length > 0);
  const frame = payload.frames.find((entry) => entry
    && typeof entry.frameNid === 'string'
    && entry.kind === 'same-origin'
    && typeof entry.html === 'string'
    && entry.html.includes('phase8-frame-button')
    && Array.isArray(entry.nodeIds)
    && entry.nodeIds.length > 0);
  return Boolean(shadow && frame);
}

function isPhase8ShadowValueMutationBatch(msg) {
  if (!msg || msg.type !== STREAM.MUTATIONS) return false;
  const ops = mutationOps(msg);
  if (ops.length === 0) return false;
  const hasShadowRoot = ops.some((op) => op.op === DIFF_OP.SHADOW_ROOT
    && typeof op.hostNid === 'string'
    && typeof op.html === 'string'
    && op.html.includes('phase8-shadow-live')
    && Array.isArray(op.nodeIds));
  const hasValue = ops.some((op) => op.op === DIFF_OP.VALUE
    && typeof op.nid === 'string'
    && op.value === 'after value drift'
    && !Object.prototype.hasOwnProperty.call(op, 'html'));
  return (hasShadowRoot || hasValue)
    && ops.every((op) => op.op === DIFF_OP.SHADOW_ROOT || op.op === DIFF_OP.VALUE);
}

/**
 * True when a SNAPSHOT message's serialized HTML carries the clone-only
 * data-ps-currentsrc variant pin (Phase 12 ASST-03). The extracted core emits
 * it for a responsive <img> whose currentSrc differs from src; the FSB
 * reference never does.
 * @param {*} msg
 * @returns {boolean}
 */
function htmlContainsCurrentSrcPin(msg) {
  if (!msg || msg.type !== STREAM.SNAPSHOT) return false;
  return payloadHtml(msg).includes('data-ps-currentsrc');
}

/**
 * True when a SNAPSHOT message's serialized HTML carries an asset-unavailable
 * placeholder marker (Phase 12 ASST-04). The extracted core degrades
 * blob:/oversized-data: refs to a dimensioned <div data-ps-asset-unavailable>;
 * the FSB reference ships the raw (dead) reference instead.
 * @param {*} msg
 * @returns {boolean}
 */
function htmlContainsAssetUnavailable(msg) {
  if (!msg || msg.type !== STREAM.SNAPSHOT) return false;
  return payloadHtml(msg).includes('data-ps-asset-unavailable');
}

function hasCssomDocumentStyleSource(msg) {
  if (!msg || msg.type !== STREAM.SNAPSHOT) return false;
  const payload = msg.payload || {};
  const strategy = payload.styleStrategy || {};
  const sources = payload.styleSources || [];
  return strategy.mode === 'cssom'
    && Array.isArray(sources)
    && sources.some((source) => source
      && source.scope
      && source.scope.kind === 'document'
      && typeof source.cssText === 'string'
      && source.cssText.includes('.cssom-card'));
}

function isCssomStyleSourceMutationBatch(msg) {
  if (!msg || msg.type !== STREAM.MUTATIONS) return false;
  const ops = mutationOps(msg);
  return ops.length > 0
    && ops.every((op) => op
      && op.op === DIFF_OP.STYLE_SOURCE
      && op.scope
      && op.scope.kind === 'document'
      && ['upsert', 'replace', 'remove'].includes(op.action));
}

function stripStyleAttributesFromHtml(html) {
  const dom = new JSDOM('<!DOCTYPE html><template></template>');
  const template = dom.window.document.querySelector('template');
  template.innerHTML = String(html || '');
  for (const el of template.content.querySelectorAll('[style]')) {
    el.removeAttribute('style');
  }
  return template.innerHTML;
}

function normalizeAddStyleOp(op) {
  if (!op || op.op !== DIFF_OP.ADD || typeof op.html !== 'string') return op;
  return Object.assign({}, op, {
    html: stripStyleAttributesFromHtml(op.html),
  });
}

function isAddStyleOnlyMutationBatch(refMsg, extMsg, scenarioName) {
  if (!['basic-mutations', 'mutation-burst', 'structural-ops'].includes(scenarioName)) {
    return false;
  }
  if (!refMsg || !extMsg || refMsg.type !== STREAM.MUTATIONS || extMsg.type !== STREAM.MUTATIONS) {
    return false;
  }
  const refOps = mutationOps(refMsg);
  const extOps = mutationOps(extMsg);
  if (refOps.length !== extOps.length || refOps.length === 0) return false;

  let hasStyledAdd = false;
  const normalizedExtOps = extOps.map((op) => {
    if (op && op.op === DIFF_OP.ADD && typeof op.html === 'string' && /\sstyle=/.test(op.html)) {
      hasStyledAdd = true;
    }
    return normalizeAddStyleOp(op);
  });

  return hasStyledAdd && isDeepStrictEqual(refOps, normalizedExtOps);
}

/**
 * Declared divergences between the reference capture and the extracted core.
 * Mismatch-kind entries are scenario-pinned: D1 (resume semantics), D6
 * (text-node childList fidelity fix), D7 (capture-side sanitization and
 * masking), and D24 Phase 8 protocol extensions. Everything else the oracle
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
    id: 'D8-weakmap-node-identity-sidecar',
    kind: 'documented-mapping',
    description:
      'Phase 7 removes PhantomStream-owned data-fsb-nid attributes from extracted '
      + 'snapshot/add HTML and carries the same raw nid sequence in structured '
      + 'nodeIds sidecars. The reference still serializes framework identity as '
      + 'data-fsb-nid attributes. normalize.js removes only those reference identity '
      + 'attrs for comparison when the extracted nodeIds sidecar exactly matches the '
      + 'reference preorder nid sequence.',
    rationale:
      'Intentional identity transport migration (07-CONTEXT.md D-03/D-08/D-09): '
      + 'capture must stop mutating the observed page while preserving opaque nid '
      + 'diff fields, add-op parent/before ids, and preorder identity order. This '
      + 'normalization does not cover unrelated attrs, text, styles, sanitization, '
      + 'or mutation ordering.',
    affectedMessages: [STREAM.SNAPSHOT, STREAM.MUTATIONS],
    affectedScenarios: [
      'basic-mutations',
      'mutation-burst',
      'structural-ops',
      'scroll',
      'pause-resume',
      'text-childlist',
      'sanitize-divergence',
      'phase8-protocol-extensions',
      'cssom-capture-mode',
      'snapshot-only',
      'dialog',
    ],
    appliesTo() {
      return false;
    },
  },
  {
    id: 'D24-phase8-truncated-subtree-markers',
    kind: 'mismatch',
    description:
      'Phase 8 preserves dropped subtree root identity by replacing truncated '
      + 'snapshot regions with data-phantomstream-truncated markers and carrying '
      + 'requestable marker nids in nodeIds. The FSB reference drops those subtrees '
      + 'to whitespace only, so the extracted truncation snapshot intentionally has '
      + 'marker elements and additional nodeIds for on-demand subtree recovery.',
    rationale:
      'D-19 through D-22 and CAPT-11 require targeted recovery for truncated '
      + 'regions without waiting for a full replacement snapshot. The predicate is '
      + 'pinned to the existing snapshot-only truncation scenario and only matches '
      + 'actual truncated marker payloads.',
    affectedMessages: [STREAM.SNAPSHOT],
    affectedScenarios: ['snapshot-only'],
    appliesTo(refMsg, extMsg, scenarioName) {
      if (scenarioName !== 'snapshot-only') return false;
      if (refMsg === undefined || extMsg === undefined) return false;
      if (refMsg.type !== STREAM.SNAPSHOT || extMsg.type !== STREAM.SNAPSHOT) return false;
      const refPayload = refMsg.payload || {};
      const extPayload = extMsg.payload || {};
      if (refPayload.truncated !== true || extPayload.truncated !== true) return false;
      if (refPayload.missingDescendants !== extPayload.missingDescendants) return false;
      if (!payloadHtml(extMsg).includes('data-phantomstream-truncated="true"')) return false;
      if (payloadHtml(refMsg).includes('data-phantomstream-truncated="true"')) return false;
      return Array.isArray(extPayload.nodeIds)
        && extPayload.nodeIds.length > 0
        && extPayload.nodeIds.length > (Array.isArray(refPayload.nodeIds) ? refPayload.nodeIds.length : 0);
    },
  },
  {
    id: 'D24-phase8-add-op-computed-styles',
    kind: 'mismatch',
    description:
      'Phase 8 add ops include curated computed style attributes on newly added '
      + 'elements so post-snapshot content matches snapshot-era siblings. The FSB '
      + 'reference add-op HTML carries the raw new subtree without computed styles.',
    rationale:
      'D-16 through D-18 and CAPT-06 require late-added nodes to carry curated '
      + 'computed styles while explicitly deferring full CSSOM capture to Phase 9. '
      + 'The predicate is pinned to existing add-op scenarios and only matches '
      + 'mutation batches that become reference-equivalent after removing style '
      + 'attributes from extracted add-op HTML.',
    affectedMessages: [STREAM.MUTATIONS],
    affectedScenarios: ['basic-mutations', 'mutation-burst', 'structural-ops'],
    appliesTo(refMsg, extMsg, scenarioName) {
      return isAddStyleOnlyMutationBatch(refMsg, extMsg, scenarioName);
    },
  },
  {
    id: 'D24-phase8-shadow-frame-snapshot-sidecars',
    kind: 'mismatch',
    description:
      'Phase 8 extracted snapshots carry non-empty shadowRoots[] and frames[] '
      + 'sidecars for open shadow roots and same-origin iframe documents. The FSB '
      + 'reference has no corresponding structured sidecar fields.',
    rationale:
      'D-04 through D-10 require structured host-nid/frame-nid sidecars rather '
      + 'than flattening shadow DOM or loading live iframe content. The predicate '
      + 'is pinned to the focused phase8-protocol-extensions fixture and checks '
      + 'the exact fixture-specific sidecar content.',
    affectedMessages: [STREAM.SNAPSHOT],
    affectedScenarios: ['phase8-protocol-extensions'],
    appliesTo(refMsg, extMsg, scenarioName) {
      if (scenarioName !== 'phase8-protocol-extensions') return false;
      if (refMsg === undefined || extMsg === undefined) return false;
      if (refMsg.type !== STREAM.SNAPSHOT || extMsg.type !== STREAM.SNAPSHOT) return false;
      const refPayload = phase8SnapshotPayload(refMsg);
      const extPayload = phase8SnapshotPayload(extMsg);
      if (!hasPhase8ShadowFrameSnapshot(extPayload)) return false;
      return !hasPhase8ShadowFrameSnapshot(refPayload);
    },
  },
  {
    id: 'D24-phase8-shadow-value-mutations',
    kind: 'mismatch',
    description:
      'Phase 8 extracted streams emit a shadow-root replacement op for live open '
      + 'shadow root changes and a narrow DIFF_OP.VALUE op for property-only form '
      + 'value drift. The FSB reference observes neither shadow-root internals nor '
      + 'input/change value property changes.',
    rationale:
      'D-07 and D-12 through D-15 require live shadow and value drift to stream '
      + 'as explicit narrow ops. The predicate is pinned to the focused '
      + 'phase8-protocol-extensions scenario and accepts only an extracted-only '
      + 'MUTATIONS batch composed of the expected shadow-root and value ops.',
    affectedMessages: [STREAM.MUTATIONS],
    affectedScenarios: ['phase8-protocol-extensions'],
    appliesTo(refMsg, extMsg, scenarioName) {
      if (scenarioName !== 'phase8-protocol-extensions') return false;
      if (refMsg !== undefined || extMsg === undefined) return false;
      return isPhase8ShadowValueMutationBatch(extMsg);
    },
  },
  {
    id: 'D25-cssom-mode-style-sources',
    kind: 'mismatch',
    description:
      'Phase 9 CSSOM mode replaces generated computed inline style capture with '
      + 'structured styleSources[] and styleStrategy metadata in snapshots, then '
      + 'streams stylesheet changes as DIFF_OP.STYLE_SOURCE mutation ops. The FSB '
      + 'reference has no structured style-source protocol surface and does not '
      + 'observe document.head stylesheet text changes in the oracle fixture.',
    rationale:
      'CSSOM mode is an explicit opt-in (`styleMode: "cssom"`) so the legacy '
      + 'computed-mode oracle matrix remains unchanged. This entry is pinned to '
      + 'the focused cssom-capture-mode scenario and only covers snapshots with '
      + 'document-scoped CSSOM sources plus extracted-only style-source mutation '
      + 'batches.',
    affectedMessages: [STREAM.SNAPSHOT, STREAM.MUTATIONS],
    affectedScenarios: ['cssom-capture-mode'],
    appliesTo(refMsg, extMsg, scenarioName) {
      if (scenarioName !== 'cssom-capture-mode') return false;

      if (refMsg !== undefined && extMsg !== undefined) {
        if (refMsg.type !== STREAM.SNAPSHOT || extMsg.type !== STREAM.SNAPSHOT) return false;
        return hasCssomDocumentStyleSource(extMsg) && !hasCssomDocumentStyleSource(refMsg);
      }

      if (refMsg !== undefined || extMsg === undefined) return false;
      return isCssomStyleSourceMutationBatch(extMsg);
    },
  },
  {
    id: 'D26-currentsrc-variant-pin',
    kind: 'mismatch',
    description:
      'Phase 12 by-reference static assets: the extracted core enriches the '
      + 'serialized snapshot with two clone-only, extracted-only surfaces the '
      + 'FSB reference lacks. (1) ASST-03 currentSrc variant pin: a responsive '
      + '<img> whose currentSrc differs from its resolved src carries a '
      + 'data-ps-currentsrc attribute on the wire clone (never the live page), '
      + 'so the cross-origin viewer pins the same variant the origin showed. '
      + '(2) ASST-04 non-shareable degrade: a blob:/origin-local or oversized '
      + 'data: <img> becomes a dimensioned <div data-ps-asset-unavailable> '
      + 'placeholder, never a dead reference on the wire. The reference '
      + 'serializes the raw src/srcset (and the dead blob:/oversized data: ref) '
      + 'with no enrichment, so the single SNAPSHOT message diverges.',
    rationale:
      'ASST-03/ASST-04 (12-CONTEXT locked decisions): the variant pin and the '
      + 'placeholder degrade are intentional capture-side enrichments written '
      + 'CLONE-ONLY (Phase 7 no-mutation invariant). Both ride one snapshot, so '
      + 'this single scenario-pinned mismatch entry covers the combined '
      + 'extracted-only divergence (research Open Question 2: one predicate, not '
      + 'two overlapping entries -- the oracle surfaces exactly one SNAPSHOT '
      + 'mismatch for the static-assets fixture). jsdom returns currentSrc==="" '
      + 'so the scenario injects a divergent currentSrc; the entry only fires '
      + 'when the extracted snapshot carries a Phase 12 marker the reference '
      + 'does not.',
    affectedMessages: [STREAM.SNAPSHOT, STREAM.MUTATIONS],
    affectedScenarios: ['static-assets'],
    appliesTo(refMsg, extMsg, scenarioName) {
      if (scenarioName !== 'static-assets') return false;
      // The static-assets divergence is a SAME-INDEX SNAPSHOT mismatch: both
      // sides emit a snapshot, but only the extracted HTML carries the Phase 12
      // clone-only markers (currentSrc pin and/or asset-unavailable
      // placeholder). A trailing/missing message or a non-snapshot type is not
      // this divergence and stays undeclared.
      if (refMsg === undefined || extMsg === undefined) return false;
      if (refMsg.type !== STREAM.SNAPSHOT || extMsg.type !== STREAM.SNAPSHOT) return false;
      const extEnriched = htmlContainsCurrentSrcPin(extMsg) || htmlContainsAssetUnavailable(extMsg);
      const refEnriched = htmlContainsCurrentSrcPin(refMsg) || htmlContainsAssetUnavailable(refMsg);
      return extEnriched && !refEnriched;
    },
  },
  {
    id: 'D27-media-playback-sync',
    kind: 'mismatch',
    description:
      'Phase 13 media-by-reference playback sync: the extracted core enriches the '
      + 'SNAPSHOT with a media[] baseline array (one entry per live <video>/<audio>, '
      + 'each carrying currentTime/paused/muted/volume/playbackRate/loop/'
      + 'duration|live/ended keyed by nid) and emits STREAM.MEDIA side-channel '
      + 'messages for play/pause/seeked/ratechange/ended/volumechange/loadedmetadata '
      + 'plus a throttled playing-only timeupdate heartbeat. The FSB reference '
      + '(reference/extension/dom-stream.js) tracks no media at all -- it has neither '
      + 'a media[] snapshot field nor a STREAM.MEDIA op -- so the media-playback-sync '
      + 'fixture diverges as a media[]-only SNAPSHOT plus extracted-only trailing '
      + 'STREAM.MEDIA messages.',
    rationale:
      'MEDIA-02/MWIRE-01 (13-CONTEXT locked): media playback state travels as '
      + 'side-channel data keyed by nid (the DIFF_OP.VALUE precedent), never baked '
      + 'into the serialized HTML clone -- preserving the differential-oracle HTML '
      + 'byte-identity and the Phase 7 capture-no-mutation invariant. The reference '
      + 'emits no media surface, so both the media[] baseline (MEDIA-02) and the '
      + 'STREAM.MEDIA channel (MWIRE-01) are intentional extracted-only divergences. '
      + '(MEDIA-03, the pure drift reconciler, is exercised by Plan 01\'s reconciler '
      + 'unit tests, NOT this oracle divergence -- the reconciler runs renderer-side '
      + 'and produces no wire message.) Both shapes ride the one media-playback-sync '
      + 'fixture, so this single scenario-pinned predicate covers the combined '
      + 'divergence (D26 single-predicate discipline: compareStreams returns the '
      + 'first ledger match, so a second same-index entry could never fire and would '
      + 'fail stale-entry detection). jsdom has no media timeline, so the scenario '
      + 'injects deterministic paused=false/currentTime/finite-duration; the entry '
      + 'only fires when the extracted stream carries the media surface the '
      + 'reference does not.',
    affectedMessages: [STREAM.SNAPSHOT, STREAM.MEDIA],
    affectedScenarios: ['media-playback-sync'],
    appliesTo(refMsg, extMsg, scenarioName) {
      // The scenario guard is load-bearing (same discipline as D1/D6/D7/D26): a
      // media-shaped divergence surfacing in any OTHER scenario must still
      // hard-fail as UNDECLARED DIVERGENCE.
      if (scenarioName !== 'media-playback-sync') return false;

      // Shape A: extracted-only trailing STREAM.MEDIA message. The reference
      // emits none, so the extracted stream is longer and these align against
      // no reference counterpart (refMsg === undefined).
      if (refMsg === undefined && extMsg !== undefined && extMsg.type === STREAM.MEDIA) {
        return true;
      }

      // Shape B: same-index SNAPSHOT where only the extracted payload carries a
      // non-empty media[] baseline. Both sides emit a snapshot; the extracted
      // one is enriched with the media[] field the reference lacks. A trailing/
      // missing message or a non-snapshot type is not this divergence.
      if (refMsg !== undefined && extMsg !== undefined
        && refMsg.type === STREAM.SNAPSHOT && extMsg.type === STREAM.SNAPSHOT) {
        const extHasMedia = Array.isArray(extMsg.payload && extMsg.payload.media)
          && extMsg.payload.media.length > 0;
        const refHasMedia = Array.isArray(refMsg.payload && refMsg.payload.media)
          && refMsg.payload.media.length > 0;
        return extHasMedia && !refHasMedia;
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
      'sanitize-divergence', 'phase8-protocol-extensions', 'cssom-capture-mode',
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
      'sanitize-divergence', 'phase8-protocol-extensions', 'cssom-capture-mode',
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
