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
  /** Viewer request for a bounded fresh subtree payload. Payload: SubtreeRequestPayload */
  SUBTREE_REQUEST: 'dash:ps-subtree-request',
};

/** Capture host -> viewer: stream data and side channels. */
export const STREAM = {
  /** Full snapshot. Payload: see SnapshotPayload below. */
  SNAPSHOT: 'ext:dom-snapshot',
  /** Batched diff ops. Payload: { mutations: DiffOp[], streamSessionId, snapshotId } */
  MUTATIONS: 'ext:dom-mutations',
  /** Scroll position. Payload: { scrollX, scrollY, streamSessionId, snapshotId } */
  SCROLL: 'ext:dom-scroll',
  /** Media playback state. Payload: MediaSyncPayload */
  MEDIA: 'ext:dom-media',
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
  /** Capture response to a bounded subtree request. Payload: SubtreeResponsePayload */
  SUBTREE_RESPONSE: 'ext:ps-subtree-response',
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
  /** { op:'value', nid, value?, checked?, selectedValues?, selectedIndexes? } — live form state change */
  VALUE: 'value',
  /** ShadowRootPayload plus op:'shadow-root' — replace/open an observed shadow root */
  SHADOW_ROOT: 'shadow-root',
  /** { op:'frame', frameNid, frame:FramePayload } — refresh an inert iframe mirror */
  FRAME: 'frame',
  /** StyleSourceDiffOp — upsert/replace/remove one scoped CSSOM source */
  STYLE_SOURCE: 'style-source',
};

/**
 * Legacy identity attribute name retained for compatibility with renderer
 * and fixture code that still consumes nid-stamped mirror DOM. Capture-side
 * framework identity now travels through SnapshotPayload.nodeIds and add-op
 * nodeIds sidecars instead of mutating observed page elements.
 */
export const NID_ATTR = 'data-fsb-nid';

/**
 * @typedef {Object} StyleScope
 * @property {'document'|'shadow'|'frame'} kind
 * @property {string} [hostNid]           Shadow host nid when kind is 'shadow'
 * @property {string} [frameNid]          Iframe nid when kind is 'frame'
 */

/**
 * @typedef {Object} StyleSource
 * @property {string} sourceId
 * @property {StyleScope} scope
 * @property {'link'|'style'|'constructable'|'adopted'|'fallback'} ownerKind
 * @property {number} order
 * @property {string|null} [href]
 * @property {string} [media]
 * @property {boolean} [disabled]
 * @property {string} [cssText]
 * @property {{reason: string}|null} [fallback]
 * @property {number} [approxBytes]
 */

/**
 * @typedef {Object} StyleStrategy
 * @property {'computed'|'cssom'} mode
 * @property {number} sourceCount
 * @property {number} fallbackCount
 * @property {number} computedFallbackCount
 * @property {number} approxCssBytes
 */

/**
 * @typedef {Object} StyleSourceDiffOp
 * @property {'style-source'} op
 * @property {'upsert'|'replace'|'remove'} action
 * @property {string} sourceId
 * @property {StyleScope} scope
 * @property {StyleSource} [source]
 */

/**
 * @typedef {Object} AddDiffOp
 * @property {'add'} op
 * @property {string} parentNid        Parent node id in the current mirror
 * @property {string} html             Serialized subtree HTML, without framework identity attrs
 * @property {string|null} beforeNid   Insert before this sibling nid, or append when null
 * @property {string[]} nodeIds        Preorder ids for every serialized element in html
 * @property {ShadowRootPayload[]} [shadowRoots] Open shadow root sidecars inside this added subtree
 * @property {FramePayload[]} [frames] Same-origin/cross-origin frame sidecars inside this added subtree
 */

/**
 * @typedef {Object} ShadowRootPayload
 * @property {string} hostNid           Host element nid that owns this shadow root
 * @property {'open'} mode              Mirrored roots are open; closed roots are not introspected
 * @property {string} html              Serialized shadow root child HTML
 * @property {string[]} nodeIds         Preorder ids for shadow descendant elements
 * @property {string} slotAssignment    Content-free slot assignment hint/diagnostic
 * @property {StyleSource[]} [styleSources] Scoped CSSOM sources for this shadow root
 * @property {StyleStrategy} [styleStrategy] CSSOM strategy counters for this scope
 */

/**
 * @typedef {Object} FramePayload
 * @property {string} frameNid          Iframe element nid
 * @property {string} kind              Frame policy kind, e.g. 'same-origin' or 'cross-origin'
 * @property {string} [html]            Serialized frame body HTML for accessible frames
 * @property {string[]} [nodeIds]       Preorder ids for serialized frame elements
 * @property {string[]} [stylesheets]   Absolutified stylesheet URLs
 * @property {string[]} [inlineStyles]  Sanitized inline style blocks
 * @property {StyleSource[]} [styleSources] Scoped CSSOM sources for this frame document
 * @property {StyleStrategy} [styleStrategy] CSSOM strategy counters for this scope
 * @property {Object} [htmlAttrs]       Sanitized frame <html> attributes
 * @property {Object} [bodyAttrs]       Sanitized frame <body> attributes
 * @property {string} [htmlStyle]       Computed shell style for frame <html>
 * @property {string} [bodyStyle]       Computed shell style for frame <body>
 * @property {string} [label]           Content-free placeholder label
 * @property {string} [src]             Frame src URL when safe to disclose
 * @property {string} [origin]          Frame origin metadata when safe to disclose
 */

/**
 * @typedef {Object} ValueDiffOp
 * @property {'value'} op
 * @property {string} nid
 * @property {string} [value]           Textual value for input/textarea/select-like controls
 * @property {boolean} [checked]        Checked state for checkbox/radio controls
 * @property {string[]} [selectedValues] Selected option values for select controls (masked when maskInputs is on, so renderers must not treat these as a selection key)
 * @property {number[]} [selectedIndexes] Authoritative positional identity of selected options; preferred over selectedValues because option indexes never carry page content and stay unambiguous under masking
 */

/**
 * Captured live playback state of a single <video>/<audio> element, keyed by
 * nid. Models the DIFF_OP.VALUE side-channel-property-state precedent: live
 * media properties travel as side-channel data, never serialized into the HTML
 * clone (preserves the Phase 7 no-mutation invariant + HTML byte-identity).
 *
 * Live/Infinity-duration encoding: `duration` is present ONLY when finite;
 * non-finite (streaming) durations are encoded as `live: true` instead, never
 * both. This sidesteps the JSON Infinity -> null trap (JSON.stringify(Infinity)
 * === "null") so the reconciler can branch on `live` before any duration math
 * and never compute NaN.
 *
 * @typedef {Object} MediaBaselineEntry
 * @property {string} nid                 Element nid the playback state addresses
 * @property {number} currentTime         Playback position in seconds
 * @property {boolean} paused             Whether the element is paused
 * @property {boolean} muted              Whether audio output is muted
 * @property {number} volume              Audio volume in [0, 1]
 * @property {number} playbackRate        Effective playback rate (1 = normal)
 * @property {boolean} loop               Whether the element loops
 * @property {boolean} ended              Whether playback reached the end
 * @property {number} [duration]          Media duration in seconds; present ONLY when finite
 * @property {boolean} [live]             true when duration is non-finite (stream); mutually exclusive with duration
 */

/**
 * One STREAM.MEDIA wire message: a MediaBaselineEntry enriched with the event
 * that triggered emission, a capture-side monotonic timestamp for latency
 * compensation, and the stream identity stamps every side channel carries.
 *
 * The reconciler predicts the expected position from `currentTime`,
 * `playbackRate`, and `(now - sentAt)`; `streamSessionId`/`snapshotId` let the
 * renderer reject stale cross-generation frames via isCurrentStream (Plan 03).
 * One message is emitted per media element per tick (scroll-like granularity).
 *
 * @typedef {Object} MediaSyncPayload
 * @property {string} nid                 Element nid the playback state addresses
 * @property {'play'|'pause'|'seeked'|'ratechange'|'ended'|'volumechange'|'loadedmetadata'|'timeupdate'} event Triggering media event
 * @property {number} currentTime         Playback position in seconds at capture
 * @property {boolean} paused             Whether the element is paused
 * @property {boolean} muted              Whether audio output is muted
 * @property {number} volume              Audio volume in [0, 1]
 * @property {number} playbackRate        Effective playback rate (1 = normal)
 * @property {boolean} loop               Whether the element loops
 * @property {boolean} ended              Whether playback reached the end
 * @property {number} [duration]          Media duration in seconds; present ONLY when finite
 * @property {boolean} [live]             true when duration is non-finite (stream); mutually exclusive with duration
 * @property {number} sentAt              Capture-side monotonic ms stamp for latency compensation
 * @property {string} streamSessionId     Identity: minted per stream session
 * @property {number} snapshotId          Identity: minted per snapshot
 */

/**
 * @typedef {Object} SubtreeRequestPayload
 * @property {string} requestId
 * @property {string} nid
 * @property {string} streamSessionId
 * @property {number} snapshotId
 * @property {string} [reason]
 */

/**
 * @typedef {Object} SubtreeResponsePayload
 * @property {string} requestId
 * @property {string} nid
 * @property {string} status            'ok' or a content-free miss status
 * @property {string} [html]            Serialized subtree HTML when status is 'ok'
 * @property {string[]} [nodeIds]       Preorder ids for serialized subtree elements
 * @property {ShadowRootPayload[]} [shadowRoots] Open shadow roots inside the subtree
 * @property {FramePayload[]} [frames]  Frame sidecars inside the subtree
 * @property {StyleSource[]} [styleSources] Scoped CSSOM sources inside the subtree
 * @property {StyleStrategy} [styleStrategy] CSSOM strategy counters for subtree sources
 * @property {string} streamSessionId
 * @property {number} snapshotId
 */

/**
 * @typedef {Object} SnapshotPayload
 * @property {string} html              Serialized body innerHTML (style-inlined; framework identity-clean)
 * @property {string[]} nodeIds         Preorder ids for every serialized element in html
 * @property {ShadowRootPayload[]} [shadowRoots] Open shadow roots keyed by host nid
 * @property {FramePayload[]} [frames]  Frame sidecars keyed by iframe nid
 * @property {boolean} truncated        True if the size budget forced subtree drops
 * @property {number} missingDescendants Count of dropped subtrees
 * @property {string[]} stylesheets     Absolutified <link rel=stylesheet> URLs
 * @property {string[]} inlineStyles    Inline <style> text blocks from <head>
 * @property {StyleSource[]} [styleSources] Scoped CSSOM sources for document/shadow/frame scopes
 * @property {StyleStrategy} [styleStrategy] CSSOM strategy counters for document-level sources
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
