// tests/differential/scenarios/structural-ops.js -- one mutation group per
// DIFF_OP type (add, rm, attr, text) with settles between groups. Fixture-
// agnostic by design: elements are addressed through generic selectors
// (first <ul>, first <img>, first <p>) so the same scenario runs against
// both basic.html and heavy-realistic.html.

export const name = 'structural-ops';

/**
 * Drive one mutation group per diff-op type against one capture side.
 * @param {{ window: Window, document: Document }} side  harness side handle
 * @param {(win: Window) => Promise<void>} settle        deterministic flush cadence
 */
export async function run(side, settle) {
  const { document } = side;

  // Group 1 (op 'add'): append a multi-element subtree -- including a
  // relative href that processAddedNode must absolutify -- to a tracked
  // parent (the document's first list).
  const list = document.querySelector('ul');
  const item = document.createElement('li');
  item.setAttribute('id', 'structural-added-item');
  const label = document.createElement('span');
  label.textContent = 'Added structural item';
  const link = document.createElement('a');
  link.setAttribute('href', 'added/structural-link');
  link.textContent = 'added link';
  item.appendChild(label);
  item.appendChild(link);
  list.appendChild(item);
  await settle(side.window);
  // Absorb the data-fsb-nid echo flush from stamping the added subtree
  // (same determinism fix as basic-mutations, Plan 01-01).
  await settle(side.window);

  // Group 2 (op 'rm'): remove an existing tracked node.
  const items = document.querySelectorAll('li');
  const removed = items[1];
  removed.parentNode.removeChild(removed);
  await settle(side.window);

  // Group 3 (op 'attr'): setAttribute including a relative-URL attribute --
  // src is in URL_ATTRS, so the attr op's value must be absolutified against
  // the shared fixture base URL.
  const img = document.querySelector('img');
  img.setAttribute('src', 'assets/structural-rewrite.png');
  img.setAttribute('data-structural', 'attr-group');
  await settle(side.window);

  // Group 4 (op 'text'): character-data change addressed via the parent nid.
  // Mutating .data directly produces the characterData record; textContent
  // would replace the text node as a childList mutation instead.
  const para = document.querySelector('p');
  para.firstChild.data = 'Structural text rewrite.';
  await settle(side.window);
}
