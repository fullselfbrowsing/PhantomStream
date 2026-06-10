// tests/differential/scenarios/mutation-burst.js -- >= 50 synchronous DOM
// mutations with NO settle between them: all records must accumulate into
// the pending queue and batch through the same rAF-cadence flushes on both
// sides. Runs against basic.html (uses its #card-area / #main-heading /
// #intro elements).

export const name = 'mutation-burst';

/**
 * Drive a synchronous burst of 60 mixed mutations, then settle.
 * @param {{ window: Window, document: Document }} side  harness side handle
 * @param {(win: Window) => Promise<void>} settle        deterministic flush cadence
 */
export async function run(side, settle) {
  const { document } = side;
  const area = document.getElementById('card-area');
  const heading = document.getElementById('main-heading');
  const intro = document.getElementById('intro');

  // 20 iterations x 3 mutations = 60 synchronous mutations, zero awaits.
  for (let i = 0; i < 20; i++) {
    // childList add: new element appended to a tracked parent.
    const block = document.createElement('div');
    block.setAttribute('data-burst-index', String(i));
    block.textContent = 'Burst block ' + i;
    area.appendChild(block);

    // attribute change on an existing tracked element.
    heading.setAttribute('data-burst-attr', 'pass-' + i);

    // character-data change: mutate the text node's data directly (setting
    // textContent would REPLACE the text node -- a childList mutation the
    // reference skips for non-element nodes, producing no wire signal).
    intro.firstChild.data = 'Burst rewrite ' + i;
  }

  await settle(side.window);
  // Second settle: the add-op flush stamps data-fsb-nid on the 20 inserted
  // blocks, which the observer echoes as attribute mutations flushed on the
  // NEXT animation frame. Absorbing that echo deterministically here keeps
  // wall-clock jitter from splitting the echo batch differently per side
  // (same determinism fix as basic-mutations, Plan 01-01).
  await settle(side.window);
}
