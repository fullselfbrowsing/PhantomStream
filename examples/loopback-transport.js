// examples/loopback-transport.js -- both ends of an in-page message channel.
//
// Design source: 02-RESEARCH.md Pattern 1 (designed against the loopback
// precedent in tests/differential/harness.js). The renderer-loopback e2e
// tests deliberately duplicate this implementation locally rather than
// importing it: examples/ and tests/ never import from each other
// (parallel-safe convention), so each can change without breaking the other.
//
// Shape: capture sends ext:* (STREAM.*) messages to viewer handlers; the
// viewer sends dash:* (CONTROL.*) messages to host-glue handlers. Delivery
// hops through queueMicrotask: one async hop breaks re-entrancy (viewer DOM
// writes never run inside capture's rAF flush, and a resync CONTROL.START
// never re-enters capture.start() mid-flush) while microtask FIFO ordering
// preserves message order.
//
// Cross-runtime style per the capture-core convention: var declarations and
// function expressions.

/**
 * Create a loopback transport pair for one-page capture -> viewer mirroring.
 *
 * @returns {{
 *   captureTransport: { send: (type: string, payload: Object) => void },
 *   viewerTransport: {
 *     send: (type: string, payload: Object) => void,
 *     onMessage: (handler: (type: string, payload: Object) => void) => (() => void)
 *   },
 *   onControl: (handler: (type: string, payload: Object) => void) => (() => void)
 * }}
 *   `captureTransport` satisfies the capture core's Transport contract
 *   (src/capture/index.js -- send-only, fire-and-forget); `viewerTransport`
 *   satisfies the renderer's ViewerTransport contract (src/renderer/index.js
 *   -- send + onMessage returning an unsubscribe); `onControl` is the host
 *   glue seam for mapping CONTROL.* messages onto capture handle methods,
 *   also returning an unsubscribe.
 */
export function createLoopbackTransport() {
  var toViewer = new Set(); // ext:* handlers (viewer subscribes)
  var toHost = new Set();   // dash:* handlers (host glue subscribes)

  function fanOut(handlers, type, payload) {
    // queueMicrotask: one async hop breaks re-entrancy; FIFO preserved
    // (HTML spec microtask queue ordering).
    queueMicrotask(function () {
      handlers.forEach(function (h) { h(type, payload); });
    });
  }

  return {
    captureTransport: {
      send: function (type, payload) { fanOut(toViewer, type, payload); }
    },
    viewerTransport: {
      send: function (type, payload) { fanOut(toHost, type, payload); },
      onMessage: function (h) {
        toViewer.add(h);
        return function () { toViewer.delete(h); };
      }
    },
    onControl: function (h) {
      toHost.add(h);
      return function () { toHost.delete(h); };
    }
  };
}
