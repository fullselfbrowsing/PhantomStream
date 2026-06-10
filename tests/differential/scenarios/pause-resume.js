// tests/differential/scenarios/pause-resume.js -- lifecycle scenario:
// mutate / pause / mutate-while-paused (missed by design) / resume / mutate.
// Reference-vs-reference this is symmetric and green: the reference
// re-snapshots with a fresh session on resume on BOTH sides. After the Plan
// 01-04 flip (extracted core as side B), this scenario carries divergence D1
// (resume-no-resnapshot, the locked USER OVERRIDE) via the divergence ledger.
// Runs against basic.html (uses its #intro element).

export const name = 'pause-resume';

/**
 * Drive the pause/resume lifecycle with mutations in each phase.
 * @param {{ window: Window, document: Document, pause: () => void, resume: () => void }} side
 * @param {(win: Window) => Promise<void>} settle  deterministic flush cadence
 */
export async function run(side, settle) {
  const { document } = side;
  const intro = document.getElementById('intro');

  // Phase 1: streaming -- this attr op must appear on the wire.
  intro.setAttribute('data-phase', 'before-pause');
  await settle(side.window);

  side.pause();

  // Phase 2: paused -- observers are disconnected; this mutation is missed
  // by design and must NOT appear on the wire.
  intro.setAttribute('data-phase', 'during-pause');
  await settle(side.window);

  side.resume();
  await settle(side.window);

  // Phase 3: resumed -- the reference re-snapshotted (fresh session, re-
  // stamped nids), so this attr op addresses a post-resume nid.
  intro.setAttribute('data-phase', 'after-resume');
  await settle(side.window);
}
