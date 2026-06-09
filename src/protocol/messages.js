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

/** Diff op codes carried in STREAM.MUTATIONS payloads. */
export const DIFF_OP = {
  /** { op:'add', parentNid, html, beforeNid|null } — insert serialized subtree */
  ADD: 'add',
  /** { op:'rm', nid } — remove subtree */
  REMOVE: 'rm',
  /** { op:'attr', nid, attr, val } — attribute change */
  ATTR: 'attr',
  /** { op:'text', nid, text } — character data change, addressed via parent nid */
  TEXT: 'text',
};

/**
 * The attribute used to stamp stable node identity on captured elements.
 * Every diff op, overlay rect, and remote-control action addresses nodes
 * by this key.
 */
export const NID_ATTR = 'data-fsb-nid';

/**
 * @typedef {Object} SnapshotPayload
 * @property {string} html              Serialized body innerHTML (nid-stamped, style-inlined)
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
