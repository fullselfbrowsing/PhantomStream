// tests/differential/scenarios/text-childlist.js -- focused scenario for the
// bare text-node childList mutation class (ledger entry D6, capture README
// entry E2): el.textContent = '...' REPLACES the element's text child, which
// the observer reports as a childList record with a TEXT-node
// removal+addition -- NOT characterData. The reference drops the record
// entirely (element-only added/removed loops -> no wire signal, silent
// mirror drift); the extracted core emits a per-batch-deduplicated text op
// for the mutation target (the Phase 2 fidelity fix). Every other scenario
// deliberately AVOIDS this shape (their comments say so), so this scenario
// is what keeps D6 real, declared, and pinned -- stale-entry detection at
// the end of oracle.test.js fails if D6 ever stops matching.

export const name = 'text-childlist';

/**
 * Drive one bare text-node childList replacement against one capture side.
 * @param {{ window: Window, document: Document }} side  harness side handle
 * @param {(win: Window) => Promise<void>} settle        deterministic flush cadence
 */
export async function run(side, settle) {
  const { document } = side;

  // One textContent assignment on a tracked, text-only element: the
  // examples/loopback-mirror.html "Edit text" shape. Reference: zero ops
  // (the batch processes empty, so no MUTATIONS message is sent at all).
  // Extracted: exactly one MUTATIONS message of exactly one text op.
  document.getElementById('intro').textContent = 'Replaced intro text.';
  await settle(side.window);
}
