// tests/differential/scenarios/basic-mutations.js -- scripted mutation scenario
// for the differential oracle. Pure function of the side's (window, document):
// no shared state across runs, fixed await cadence after every mutation group
// (01-RESEARCH.md Pattern 3 / Pitfall 10 -- never interleave sides).

export const name = 'basic-mutations';

/**
 * Drive the basic mutation scenario against one capture side.
 * @param {{ window: Window, document: Document }} side  harness side handle
 * @param {(win: Window) => Promise<void>} settle        deterministic flush cadence
 */
export async function run(side, settle) {
  const { document } = side;

  // Group 1: attribute change on an existing tracked element -> one attr op.
  document.getElementById('intro').setAttribute('data-state', 'updated');
  await settle(side.window);

  // Group 2: append a new element with children to a tracked parent -> one add op.
  // (document.body itself carries no nid -- the serializer's TreeWalker starts
  // below the root -- so the append target must be an element inside body.)
  const card = document.createElement('section');
  card.setAttribute('id', 'appended-card');
  const heading = document.createElement('h2');
  heading.textContent = 'Appended card';
  const body = document.createElement('p');
  body.textContent = 'Card body text';
  card.appendChild(heading);
  card.appendChild(body);
  document.getElementById('card-area').appendChild(card);
  await settle(side.window);
  // Second settle: the add-op flush stamps data-fsb-nid on the inserted
  // subtree, which the observer reports as fresh attribute mutations and
  // flushes on the NEXT animation frame. Settling twice absorbs that echo
  // flush deterministically inside this group, so wall-clock jitter can
  // never merge the echo ops into group 3's batch on one side only.
  await settle(side.window);

  // Group 3: remove an existing tracked node -> one rm op.
  const itemTwo = document.getElementById('item-two');
  itemTwo.parentNode.removeChild(itemTwo);
  await settle(side.window);

  // Group 4: character-data change. Mutate the text node directly so the
  // observer reports characterData (a text op via the parent nid) -- setting
  // textContent would instead replace the text node as a childList mutation,
  // which the reference skips for non-element nodes.
  document.getElementById('detail').firstChild.data = 'Rewritten detail text.';
  await settle(side.window);
}
