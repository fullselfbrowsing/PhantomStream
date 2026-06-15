// PhantomStream wire protocol: message types and payload shapes.
// Extracted from FSB's dom-stream pipeline (content script -> service worker ->
// relay -> viewer). Names keep the original `ext:` (capture host -> viewer) and
// `dash:` (viewer -> capture host) direction prefixes for FSB compatibility.

/** Viewer -> capture host: stream lifecycle control. */
export const CONTROL = {
  START: 'dash:dom-stream-start',
  STOP: 'dash:dom-stream-stop',
  PAUSE: 'dash:dom-stream-pause',
  RESUME: 'dash:dom-stream-resume',
};

/** Capture host -> viewer: stream data and side channels. */
export const STREAM = {
  /** Full snapshot. Payload: see SnapshotPayload below. */
  SNAPSHOT: 'ext:dom-snapshot',
  /** Batched diff ops. Payload: { mutations: DiffOp[], streamSessionId, snapshotId } */
  MUTATIONS: 'ext:dom-mutations',
  /** Scroll position. Payload: { scrollX, scrollY, streamSessionId, snapshotId } */
  SCROLL: 'ext:dom-scroll',
  /** Automation overlay state. Payload: { glow, progress, streamSessionId, snapshotId } */
  OVERLAY: 'ext:dom-overlay',
  /** Native dialog mirroring. Payload: { dialog: DialogPayload } */
  DIALOG: 'ext:dom-dialog',
  /** Capture module loaded in a tab. Payload: { tabId } */
  READY: 'ext:dom-ready',
  /** Watchdog/viewer request for a fresh snapshot. Payload: { reason, ts } */
  REQUEST_SNAPSHOT: 'ext:request-snapshot',
  /** Stream health state. */
  STATE: 'ext:stream-state',
};

/** Viewer -> adapter remote-control frames, plus adapter -> viewer state. */
export const REMOTE_CONTROL = {
  REQUEST: 'dash:ps-control-request',
  STOP: 'dash:ps-control-stop',
  CLICK: 'dash:ps-control-click',
  TEXT: 'dash:ps-control-text',
  KEY: 'dash:ps-control-key',
  SCROLL: 'dash:ps-control-scroll',
  STATE: 'ext:ps-control-state',
};

/** Content-free remote-control authorization/replay states. */
const REMOTE_CONTROL_STATE_VALUES = {
  LOCKED: 'locked',
  REQUESTING: 'requesting',
  ACTIVE: 'active',
  DENIED: 'denied',
  STOPPED: 'stopped',
};

export { REMOTE_CONTROL_STATE_VALUES as REMOTE_CONTROL_STATE };

/** Diff op codes carried in STREAM.MUTATIONS payloads. */
export const DIFF_OP = {
  /** { op:'add', parentNid, html, beforeNid|null, nodeIds:string[] } — insert serialized subtree */
  ADD: 'add',
  /** { op:'rm', nid } — remove subtree */
  REMOVE: 'rm',
  /** { op:'attr', nid, attr, val } — attribute change */
  ATTR: 'attr',
  /** { op:'text', nid, text } — character data change, addressed via parent nid */
  TEXT: 'text',
};

/**
 * Legacy identity attribute name retained for compatibility with renderer
 * and fixture code that still consumes nid-stamped mirror DOM. Capture-side
 * framework identity now travels through SnapshotPayload.nodeIds and add-op
 * nodeIds sidecars instead of mutating observed page elements.
 */
export const NID_ATTR = 'data-fsb-nid';

/**
 * @typedef {Object} AddDiffOp
 * @property {'add'} op
 * @property {string} parentNid        Parent node id in the current mirror
 * @property {string} html             Serialized subtree HTML, without framework identity attrs
 * @property {string|null} beforeNid   Insert before this sibling nid, or append when null
 * @property {string[]} nodeIds        Preorder ids for every serialized element in html
 */

/**
 * @typedef {Object} SnapshotPayload
 * @property {string} html              Serialized body innerHTML (style-inlined; framework identity-clean)
 * @property {string[]} nodeIds         Preorder ids for every serialized element in html
 * @property {boolean} truncated        True if the size budget forced subtree drops
 * @property {number} missingDescendants Count of dropped subtrees
 * @property {string[]} stylesheets     Absolutified <link rel=stylesheet> URLs
 * @property {string[]} inlineStyles    Inline <style> text blocks from <head>
 * @property {Object} htmlAttrs         Sanitized <html> attributes
 * @property {Object} bodyAttrs         Sanitized <body> attributes
 * @property {string} htmlStyle         Shell computed style for <html>
 * @property {string} bodyStyle         Shell computed style for <body>
 * @property {number} scrollX
 * @property {number} scrollY
 * @property {number} viewportWidth
 * @property {number} viewportHeight
 * @property {number} pageWidth
 * @property {number} pageHeight
 * @property {string} url
 * @property {string} title
 * @property {string} streamSessionId   Identity: minted per stream session
 * @property {number} snapshotId        Identity: minted per snapshot
 */

/**
 * @typedef {Object} DialogPayload
 * @property {'alert'|'confirm'|'prompt'} type
 * @property {'open'|'closed'} state
 * @property {string} [message]
 * @property {string} [defaultValue]    prompt only
 * @property {*} [result]               on close: confirm boolean / prompt string|null
 */

/**
 * Mint a stream session id. Caller supplies entropy so the protocol layer
 * stays pure (and replayable in tests).
 * @param {number} nowMs   e.g. Date.now()
 * @param {string} rand    short random suffix, e.g. Math.random().toString(36).slice(2, 8)
 */
export function createStreamSessionId(nowMs, rand) {
  return 'stream_' + nowMs.toString(36) + '_' + rand;
}

/**
 * Staleness guard: should a viewer accept a message for the currently
 * active stream identity? Messages with no identity are accepted
 * (backward compatibility); messages with a mismatched identity are stale.
 *
 * @param {{streamSessionId?: string, snapshotId?: number}} msg
 * @param {{streamSessionId?: string, snapshotId?: number}} active
 * @returns {boolean}
 */
export function isCurrentStream(msg, active) {
  if (!msg) return false;
  if (msg.streamSessionId && active.streamSessionId &&
      msg.streamSessionId !== active.streamSessionId) {
    return false;
  }
  if (msg.snapshotId && active.snapshotId &&
      msg.snapshotId !== active.snapshotId) {
    return false;
  }
  return true;
}
