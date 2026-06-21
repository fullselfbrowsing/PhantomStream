// Shared numeric constants of the PhantomStream pipeline.
// Extracted from FSB extension/content/dom-stream.js (Phase 211-02) and the
// relay's per-message enforcement (server ws handler).

/**
 * Hard per-message size cap enforced by the relay (bytes).
 * Capture-side snapshot truncation budgets derive from this value.
 */
export const RELAY_PER_MESSAGE_LIMIT_BYTES = 1048576; // 1 MiB

/**
 * Fraction of the relay cap a serialized snapshot may occupy. The remaining
 * headroom absorbs envelope overhead and compression-resistant payloads
 * where LZ does not reduce size.
 */
export const SNAPSHOT_BUDGET_FRACTION = 0.8;

/** Snapshot truncation byte budget. */
export const SNAPSHOT_BUDGET_BYTES = Math.floor(
  RELAY_PER_MESSAGE_LIMIT_BYTES * SNAPSHOT_BUDGET_FRACTION
);

/**
 * During truncation, subtrees whose live top exceeds this many viewport
 * heights are dropped first (content far below the fold).
 */
export const TRUNCATION_VIEWPORT_MULTIPLIER = 3;

/** Scroll side-channel throttle: at most one event per this many ms. */
export const SCROLL_THROTTLE_MS = 200;

/**
 * Media side-channel heartbeat throttle: while a tracked <video>/<audio> is
 * playing, a `timeupdate` heartbeat (STREAM.MEDIA) is emitted at most once per
 * this many ms for drift correction. 250 ms is a practice-based co-watching
 * cadence (~4 Hz) -- frequent enough for the reconciler to converge sub-second
 * drift, sparse enough to stay well under the relay cap. Discrete transitions
 * (play/pause/seeked/ratechange/ended/volumechange/loadedmetadata) bypass this
 * throttle and flush immediately; the value is tunable against the v2.1
 * evaluation harness (Phase 13 concern).
 */
export const MEDIA_SYNC_THROTTLE_MS = 250;

/** Overlay side-channel throttle: at most one broadcast per this many ms. */
export const OVERLAY_THROTTLE_MS = 500;

/**
 * Capture-side watchdog: if mutations are pending and nothing has drained
 * for this long, force a flush and count a stale rescue.
 */
export const MUTATION_STALE_THRESHOLD_MS = 5000;

/** Capture-side watchdog tick cadence. */
export const WATCHDOG_TICK_MS = 500;

/** Readiness probe: poll interval and total budget. */
export const READY_PROBE_INTERVAL_MS = 200;
export const READY_PROBE_BUDGET_MS = 5000;

/** Inline <style> tags larger than this are skipped during snapshot capture. */
export const INLINE_STYLE_MAX_BYTES = 500000;

/**
 * Maximum UTF-8 byte length of an inline `data:` image URI that capture will
 * emit verbatim on the wire. 262144 = 256 KiB -- roughly a quarter of the
 * per-message cap headroom (SNAPSHOT_BUDGET_BYTES is ~838 KiB, the 80%
 * truncation budget of the 1 MiB relay cap), so a single inline asset cannot
 * crowd out the rest of the snapshot. A `data:` image larger than this degrades
 * to a dimensioned placeholder; small inline icons/sprites (<= cap) pass through
 * byte-identical, preserving the existing `data:image/*` pass-through and the
 * differential oracle. (Phase 12 ASST-04.)
 */
export const ASSET_DATA_URI_MAX_BYTES = 262144; // 256 KiB
