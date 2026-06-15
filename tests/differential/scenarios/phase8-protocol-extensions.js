// tests/differential/scenarios/phase8-protocol-extensions.js -- focused
// Phase 8 oracle exercise for shadow/frame snapshot sidecars plus live
// shadow-root and form-value mutation extensions. The reference has no
// protocol fields for these shapes; the extracted side must declare them
// narrowly through D24 ledger entries.

export const name = 'phase8-protocol-extensions';

/**
 * Install Phase 8-only tree scopes before capture starts so the snapshot
 * path has to declare its shadowRoots[] and frames[] sidecars.
 * @param {{ document: Document }} side
 */
export async function beforeStart(side) {
  const { document } = side;

  const host = document.getElementById('phase8-card');
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = '<section id="phase8-shadow-shell">'
    + '<slot name="title"></slot>'
    + '<button id="phase8-shadow-action" type="button">Shadow action</button>'
    + '<slot></slot>'
    + '</section>';

  const frame = document.getElementById('phase8-frame');
  const doc = frame.contentDocument;
  doc.open();
  doc.write('<!DOCTYPE html><html lang="en"><head><title>Phase 8 frame</title></head>'
    + '<body><button id="phase8-frame-button" type="button">Frame action</button></body></html>');
  doc.close();
}

/**
 * Drive Phase 8-only live updates against one capture side after start().
 * @param {{ window: Window, document: Document }} side
 * @param {(win: Window) => Promise<void>} settle
 */
export async function run(side, settle) {
  const { document, window } = side;

  const host = document.getElementById('phase8-card');
  const shadow = host && host.shadowRoot;
  if (shadow) {
    const badge = document.createElement('strong');
    badge.setAttribute('id', 'phase8-shadow-live');
    badge.textContent = 'Shadow live update';
    shadow.getElementById('phase8-shadow-shell').appendChild(badge);
  }

  const input = document.getElementById('phase8-input');
  input.value = 'after value drift';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));

  await settle(window);
}
