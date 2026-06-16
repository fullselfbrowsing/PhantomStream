// tests/differential/scenarios/cssom-capture-mode.js -- Phase 9 oracle
// exercise for opt-in CSSOM style source capture. The reference has no
// structured styleSources[] or DIFF_OP.STYLE_SOURCE protocol surface.

export const name = 'cssom-capture-mode';

/**
 * Drive a live stylesheet text change after capture starts. The style lives
 * in document.head so the legacy reference's body observer stays quiet while
 * the extracted CSSOM mode emits a style-source mutation.
 * @param {{ window: Window, document: Document }} side
 * @param {(win: Window) => Promise<void>} settle
 */
export async function run(side, settle) {
  const { document, window } = side;
  const style = document.getElementById('cssom-oracle-style');
  style.textContent = '.cssom-card { color: rgb(40, 50, 60); }';
  await settle(window);
}
