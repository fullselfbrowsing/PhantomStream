// Shared browser-injection source helper.
//
// The current checked-in classic script artifact was introduced by the
// Playwright adapter, but its capture bridge contract is browser-generic:
// callers provide window.__phantomStreamBridge and then start capture through
// window.__phantomStreamStart.

import { getPlaywrightInjectSource } from './playwright.js';

/**
 * Read the checked-in classic-script capture artifact.
 *
 * @returns {string}
 */
export function getBrowserInjectSource() {
  return getPlaywrightInjectSource();
}
