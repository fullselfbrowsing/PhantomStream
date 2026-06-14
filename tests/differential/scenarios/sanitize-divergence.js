// tests/differential/scenarios/sanitize-divergence.js -- focused scenario
// for the capture-side sanitization and always-on password masking divergence
// (ledger entry D7): the frozen fixture carries hostile snapshot rows, and
// this scenario adds post-snapshot hostile attr mutations so the entry stays
// real across BOTH snapshot and mutation paths. Every other scenario avoids
// these shapes, so this scenario keeps D7 declared and pinned -- stale-entry
// detection at the end of oracle.test.js fails if D7 ever stops matching.

export const name = 'sanitize-divergence';

/**
 * Drive post-snapshot hostile attr mutations against one capture side.
 * @param {{ window: Window, document: Document }} side  harness side handle
 * @param {(win: Window) => Promise<void>} settle        deterministic flush cadence
 */
export async function run(side, settle) {
  const { document } = side;
  const target = document.getElementById('tgt');
  const benignTarget = document.getElementById('tgt2');

  target.setAttribute('onclick', 'alert(2)');
  target.setAttribute('href', 'javascript:alert(2)');
  benignTarget.setAttribute('class', 'after');

  await settle(side.window);
}
