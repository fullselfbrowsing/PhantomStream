// tests/differential/scenarios/snapshot-only.js -- zero-mutation scenario:
// the stream is just the snapshot plus the initial side-channel messages.
// Used for the truncation-overflow, canvas, and heavy-realistic pairs, where
// the defense under test lives entirely inside serializeDOM.

export const name = 'snapshot-only';

/**
 * Let the started capture settle without performing any DOM mutations.
 * @param {{ window: Window, document: Document }} side  harness side handle
 * @param {(win: Window) => Promise<void>} settle        deterministic flush cadence
 */
export async function run(side, settle) {
  await settle(side.window);
}
