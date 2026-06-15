// PhantomStream Chromium MV3 adapter surface.
//
// Plan 06-01 establishes the public subpath. The service-worker and content
// bridge behavior is implemented by the MV3 adapter plan.

/**
 * Create a Chromium MV3 extension adapter handle.
 *
 * @param {Object} options
 * @returns {{install: () => Promise<Object>|Object, dispose: () => void}}
 */
export function createExtensionAdapter(options) {
  if (!options || Object(options) !== options) throw new Error('extension-options-required');
  var disposed = false;
  var handle = {
    install: function install() {
      if (disposed) throw new Error('extension-adapter-disposed');
      return handle;
    },
    dispose: function dispose() {
      disposed = true;
    }
  };
  return handle;
}
