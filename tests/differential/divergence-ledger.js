// tests/differential/divergence-ledger.js -- machine-readable declared-
// divergence registry (locked decision D-03). The differential oracle FAILS
// on any per-message mismatch not claimed by an entry here; human-readable
// divergence docs derive from this file, never the other way around.

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
 * Declared divergences. Empty at this point by construction: the oracle
 * currently runs reference-vs-reference, which has zero divergences. Entries
 * (D1 resume-no-resnapshot, envelope mapping, ready-ping timing, ...) land
 * in Plan 01-04 when the extracted core becomes side B.
 * @type {DivergenceEntry[]}
 */
export const DIVERGENCES = [];

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
