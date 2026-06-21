// Pure drift reconciler for media-playback sync (Phase 13: MWIRE-02, MEDIA-03).
//
// reconcileMediaDrift(local, remote, now, config) is a PURE function over plain
// objects: no DOM, no media element, no clock read inside (the caller passes
// `now`), and ZERO imports (the zero-dependency protocol invariant). That purity
// is what makes it jsdom-unit-testable with no real media timeline -- the whole
// MWIRE-02 contract.
//
// It is the phase's novel contribution over rrweb's MediaManager: rrweb
// interpolates the expected position with `currentTime + rate*elapsed` and then
// ALWAYS hard-seeks. PhantomStream keeps that interpolation but adds a tolerance
// band + a bounded temporary rate-nudge (so small drift converges smoothly
// instead of snapping) and a live-edge rejoin (so streams never absolute-seek).
//
// The returned action is a plain object { action, ... } where action is one of
// hold | pause | nudge | seek | rejoin-edge. The DRIVER (renderer, Plan 03)
// decides whether to apply it; the reconciler itself is side-effect-free and
// keeps NO internal memory -- whether a nudge is currently applied is read back
// from local.playbackRate vs remote.playbackRate on the next call.

/**
 * @typedef {Object} MediaReconcileConfig
 * @property {number} holdBandSec       In-tolerance band (s); within this, hold. Default 0.25
 * @property {number} hardSeekSec       Hard-seek threshold (s); above this, seek. Default 1.0
 * @property {number} maxNudgeFraction  Max temporary rate delta (fraction). Default 0.05
 * @property {number} liveRejoinSec     Live-edge rejoin threshold (s). Default 1.0
 */

/** Locked defaults (13-CONTEXT); tunable against the v2.1 evaluation harness. */
export var DEFAULT_MEDIA_RECONCILE_CONFIG = {
  holdBandSec: 0.25,   // |drift| <= this -> hold (no correction)
  hardSeekSec: 1.0,    // |drift| >  this -> hard-seek to the clamped expected position
  maxNudgeFraction: 0.05, // (0.25, 1.0] band nudges playbackRate by at most +/- this
  liveRejoinSec: 1.0   // live streams rejoin the edge only when drift exceeds this
};

/** Is v a usable finite number? Rejects NaN, +/-Infinity, null, undefined, non-numbers. */
function isFiniteNum(v) {
  return typeof v === 'number' && isFinite(v);
}

/**
 * Merge a partial config over the locked defaults so a missing field can never
 * leave a threshold `undefined` (which would make every comparison NaN). Only
 * finite overrides are accepted; anything else falls back to the default.
 * @param {Partial<MediaReconcileConfig>} [config]
 * @returns {MediaReconcileConfig}
 */
function mergeConfig(config) {
  var d = DEFAULT_MEDIA_RECONCILE_CONFIG;
  var c = config || {};
  return {
    holdBandSec: isFiniteNum(c.holdBandSec) ? c.holdBandSec : d.holdBandSec,
    hardSeekSec: isFiniteNum(c.hardSeekSec) ? c.hardSeekSec : d.hardSeekSec,
    maxNudgeFraction: isFiniteNum(c.maxNudgeFraction) ? c.maxNudgeFraction : d.maxNudgeFraction,
    liveRejoinSec: isFiniteNum(c.liveRejoinSec) ? c.liveRejoinSec : d.liveRejoinSec
  };
}

/**
 * Clamp a seek target into [0, duration]. When duration is non-finite or absent,
 * only the lower bound applies (the live branch handles streams before this is
 * ever called for an absolute seek). Always returns a finite number.
 * @param {number} t
 * @param {number} duration
 * @returns {number}
 */
function clampToDuration(t, duration) {
  var lo = isFiniteNum(t) ? t : 0;
  if (lo < 0) lo = 0;
  if (isFiniteNum(duration) && lo > duration) lo = duration;
  return lo;
}

/**
 * Loop-wrap detector: a looping element where the local position is near the end
 * of the timeline while the expected position has wrapped to near the start (or
 * vice versa). This produces a huge raw |drift| that must NOT trigger a spurious
 * hard-seek across the whole timeline; instead the driver seeks to the wrapped
 * position. The wrap window is a fraction of duration, floored at the hard-seek
 * threshold so tiny clips still register a wrap.
 * @param {number} localTime
 * @param {number} expected
 * @param {number} duration
 * @param {MediaReconcileConfig} cfg
 * @returns {boolean}
 */
function isLoopWrap(localTime, expected, duration, cfg) {
  if (!isFiniteNum(duration) || duration <= 0) return false;
  if (!isFiniteNum(localTime) || !isFiniteNum(expected)) return false;
  // Window near each edge of the timeline.
  var window = Math.max(cfg.hardSeekSec, duration * 0.1);
  if (window >= duration / 2) return false; // timeline too short to distinguish ends
  var localNearEnd = localTime >= duration - window;
  var localNearStart = localTime <= window;
  var expectedNearEnd = expected >= duration - window;
  var expectedNearStart = expected <= window;
  return (localNearEnd && expectedNearStart) || (localNearStart && expectedNearEnd);
}

/**
 * Decide the single drift-correction action for one media element.
 *
 * Decision order (RESEARCH Pattern 1, exact):
 *   merge cfg -> incomplete-remote guard -> explicit `seeked` short-circuit ->
 *   paused/rate-0 -> NaN local guard -> latency-compensated `expected` (elapsed
 *   clamped >= 0) -> LIVE branch (before any duration math) -> VOD: loop-wrap ->
 *   hold band (carries revertRate) -> bounded sign-correct nudge (carries
 *   baseRate) -> hard-seek (clamp toTime into [0, duration]).
 *
 * @param {{currentTime?: number, paused?: boolean, playbackRate?: number}} local  Observed element state
 * @param {import('./messages.js').MediaSyncPayload|null} remote                    Latency-uncompensated captured state
 * @param {number} now                                                             Caller clock (ms), e.g. performance.now()-equivalent
 * @param {Partial<MediaReconcileConfig>} [config]                                  Overrides merged over DEFAULT_MEDIA_RECONCILE_CONFIG
 * @returns {{action:'hold'|'pause'|'nudge'|'seek'|'rejoin-edge', toTime?:number, rate?:number, baseRate?:number, revertRate?:number, reason?:string}}
 */
export function reconcileMediaDrift(local, remote, now, config) {
  var cfg = mergeConfig(config);

  // ---- 0. guard incomplete / non-finite remote (no NaN propagation) ----
  if (!remote || remote.currentTime == null ||
      !isFiniteNum(remote.currentTime) || !isFiniteNum(remote.sentAt)) {
    return { action: 'hold', reason: 'incomplete-remote' };
  }

  // ---- 1. explicit seek short-circuits everything (CONTEXT: always hard-seek) ----
  if (remote.event === 'seeked') {
    return { action: 'seek', toTime: clampToDuration(remote.currentTime, remote.duration) };
  }

  // ---- 2. paused / rate-0: mirror pause, never interpolate position ----
  if (remote.paused === true || remote.playbackRate === 0) {
    return (local && local.paused)
      ? { action: 'hold', reason: 'paused' }
      : { action: 'pause' };
  }

  // ---- 3. NaN local (element not ready): wait for readiness ----
  var localTime = (local && isFiniteNum(local.currentTime)) ? local.currentTime : null;
  if (localTime === null) {
    return { action: 'hold', reason: 'local-not-ready' };
  }

  // ---- 4. latency-compensated expected position (playing only) ----
  var elapsedSec = Math.max(0, (now - remote.sentAt) / 1000); // negative clock skew -> 0
  if (!isFiniteNum(elapsedSec)) elapsedSec = 0;
  var rate = isFiniteNum(remote.playbackRate) && remote.playbackRate > 0 ? remote.playbackRate : 1;
  var expected = remote.currentTime + rate * elapsedSec;

  // ---- 5. LIVE branch: before ANY duration arithmetic; never absolute-seek ----
  if (remote.live === true || !isFiniteNum(remote.duration)) {
    var liveDrift = Math.abs(expected - localTime);
    return liveDrift > cfg.liveRejoinSec
      ? { action: 'rejoin-edge' }
      : { action: 'hold', reason: 'live-in-band' };
  }

  // ---- 6. VOD branch (duration is finite here by construction) ----
  var duration = remote.duration;

  // duration 0 is a non-seekable timeline: never seek into it.
  if (duration <= 0) {
    return { action: 'hold', reason: 'zero-duration' };
  }

  // loop wrap: seek to the wrapped position, not the raw (huge) delta.
  if (remote.loop === true && isLoopWrap(localTime, expected, duration, cfg)) {
    return { action: 'seek', toTime: clampToDuration(expected, duration) };
  }

  var drift = expected - localTime;
  var adrift = Math.abs(drift);

  // hold band: carry revertRate so the driver restores the true rate if a nudge was active.
  if (adrift <= cfg.holdBandSec) {
    return { action: 'hold', reason: 'in-band', revertRate: rate };
  }

  // (holdBandSec, hardSeekSec]: bounded, sign-correct temporary rate nudge.
  if (adrift <= cfg.hardSeekSec) {
    var sign = drift > 0 ? 1 : -1; // behind (expected ahead) -> speed up; ahead -> slow down
    var nudgeRate = rate * (1 + sign * cfg.maxNudgeFraction);
    return { action: 'nudge', rate: nudgeRate, baseRate: rate };
  }

  // adrift > hardSeekSec: hard-seek to the clamped expected position.
  return { action: 'seek', toTime: clampToDuration(expected, duration) };
}
