// tests/differential/scenarios/static-assets.js -- Phase 12 oracle exercise
// for by-reference static assets. Snapshot-centric (the defenses under test
// live entirely inside serializeDOM): the extracted core enriches the
// responsive <img> with a clone-only data-ps-currentsrc (ASST-03) and degrades
// the blob:/oversized-data: <img>s to dimensioned placeholders carrying
// data-ps-asset-unavailable (ASST-04). The FSB reference has neither surface,
// so the single SNAPSHOT message diverges -- claimed by ledger entry D26.
//
// jsdom caveat (12-RESEARCH Pitfall 2, verified): jsdom returns
// img.currentSrc === "" (it loads no resources), so the enrichment would NEVER
// fire from a real currentSrc and the D26 entry would go stale (the oracle's
// stale-entry detector would FAIL the build). beforeStart injects a divergent
// currentSrc via Object.defineProperty so the enrichment fires deterministically.

export const name = 'static-assets';

// The negotiated variant the responsive <img srcset> "resolved" to. It differs
// from the plain src (logo/photo-... vs this 2x URL) so currentSrcDiffers is
// true and the clone-only data-ps-currentsrc pin is emitted.
const INJECTED_CURRENT_SRC = 'https://cdn.fixture.test/img/photo-1600.png';

/**
 * Inject a divergent currentSrc on the responsive <img srcset> before capture
 * starts, on BOTH sides identically (the harness calls beforeStart per side).
 * Harmless on the reference side (it never reads currentSrc); load-bearing on
 * the extracted side (drives the clone-only enrichment).
 * @param {{ window: Window, document: Document }} side  harness side handle
 */
export function beforeStart(side) {
  const img = side.document.getElementById('asset-srcset-img');
  if (img) {
    Object.defineProperty(img, 'currentSrc', {
      value: INJECTED_CURRENT_SRC,
      configurable: true,
    });
  }
}

/**
 * Let the started capture settle with no DOM mutations -- the by-reference
 * asset defenses are entirely snapshot-side.
 * @param {{ window: Window, document: Document }} side
 * @param {(win: Window) => Promise<void>} settle  deterministic flush cadence
 */
export async function run(side, settle) {
  await settle(side.window);
}
