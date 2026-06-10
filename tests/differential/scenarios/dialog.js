// tests/differential/scenarios/dialog.js -- exercises the injected dialog
// interceptor end to end. jsdom implements window.alert/confirm as real (if
// inert) functions, so calling them runs the interceptor's monkey-patched
// wrappers, which relay open/dismiss CustomEvents to the capture's dialog
// channel. Only meaningful when the harness runs the fixture with page
// scripts enabled (01-RESEARCH.md Pitfall 5) -- the oracle's dialog guard
// asserts the channel actually carried messages.

export const name = 'dialog';

/**
 * Raise an alert and a confirm dialog against one capture side.
 * @param {{ window: Window, document: Document }} side  harness side handle
 * @param {(win: Window) => Promise<void>} settle        deterministic flush cadence
 */
export async function run(side, settle) {
  side.window.alert('oracle-alert');
  await settle(side.window);

  side.window.confirm('oracle-confirm');
  await settle(side.window);
}
