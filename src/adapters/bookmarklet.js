// PhantomStream bookmarklet adapter surface.
//
// Plan 06-01 establishes the public subpath. The full bookmarklet source
// generator is implemented by the bookmarklet adapter plan.

/**
 * Create bookmarklet JavaScript source.
 *
 * @param {Object} options
 * @returns {string}
 */
export function createBookmarkletSource(options) {
  if (!options || Object(options) !== options) throw new Error('bookmarklet-options-required');
  throw new Error('bookmarklet-script-url-required');
}
