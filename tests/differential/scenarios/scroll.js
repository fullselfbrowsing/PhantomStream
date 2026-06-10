// tests/differential/scenarios/scroll.js -- exercises the 200 ms scroll
// throttle identically on both sides. jsdom scroll offsets are always 0
// (no layout), so the payload values are degenerate-but-identical; what the
// pair locks is the throttle behavior and message cadence.

export const name = 'scroll';

/**
 * Dispatch two scroll events separated by a real wait beyond the throttle.
 * @param {{ window: Window, document: Document }} side  harness side handle
 * @param {(win: Window) => Promise<void>} settle        deterministic flush cadence
 */
export async function run(side, settle) {
  // First scroll: the tracker's lastScrollSend starts at 0, so this sends.
  side.window.dispatchEvent(new side.window.Event('scroll'));
  await settle(side.window);

  // Real wait beyond SCROLL_THROTTLE_MS = 200 so the second event is past
  // the throttle window on BOTH sides (each side waits independently --
  // sides never interleave, Pitfall 10).
  await new Promise((resolve) => setTimeout(resolve, 250)); // 250 ms > 200 ms throttle

  side.window.dispatchEvent(new side.window.Event('scroll'));
  await settle(side.window);
}
