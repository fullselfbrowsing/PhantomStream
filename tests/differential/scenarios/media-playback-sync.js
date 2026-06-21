// tests/differential/scenarios/media-playback-sync.js -- Phase 13 oracle
// exercise for media-by-reference playback sync. The extracted core enriches
// the SNAPSHOT with a nid-keyed media[] baseline (MEDIA-02/MEDIA-04) and emits
// STREAM.MEDIA side-channel messages on play/timeupdate (MWIRE-01). The FSB
// reference (reference/extension/dom-stream.js) has neither a media[] field nor
// a STREAM.MEDIA op -- it never tracks media at all -- so this fixture diverges
// exactly twice (a media[]-only SNAPSHOT and trailing STREAM.MEDIA messages),
// both claimed by the single scenario-pinned ledger entry D27.
//
// jsdom caveat (13-RESEARCH Differential Oracle Impact / Pitfall 2, verified):
// jsdom implements no media timeline -- play() is a no-op, currentTime advances
// nothing, an unloaded element reports duration === null and paused === true.
// So the heartbeat (which is playing-only: the capture tracker returns early
// while el.paused) would never fire from real playback, and the baseline would
// carry live:true (Infinity->null) instead of a finite duration. beforeStart
// therefore Object.defineProperty-stubs paused=false (load-bearing: lets the
// throttled timeupdate heartbeat actually emit on the extracted side),
// currentTime and a finite duration on BOTH media elements, on BOTH sides
// identically -- exactly the static-assets currentSrc-injection trick. The
// stubs are harmless on the reference (it has no media tracker reading them)
// and deterministic on the extracted side.

export const name = 'media-playback-sync';

// Deterministic playback state injected before capture starts. paused=false is
// the load-bearing one: the extracted tracker's timeupdate heartbeat returns
// early while el.paused, so without this stub no STREAM.MEDIA heartbeat (and no
// trailing-message divergence) would fire. The finite duration makes the
// baseline carry duration (not live:true) so the media[] divergence shape is
// the VOD baseline the D27 predicate claims.
const INJECTED_CURRENT_TIME = 5;   // seconds into the clip
const INJECTED_DURATION = 30;      // finite -> baseline carries duration, not live:true

const MEDIA_ELEMENT_IDS = ['media-vid', 'media-aud'];

/**
 * Stub deterministic, finite playback state on both media elements before
 * capture starts, on BOTH sides identically (the harness calls beforeStart per
 * side). Harmless on the reference (no media tracker); load-bearing on the
 * extracted side (paused=false unlocks the playing-only heartbeat; the finite
 * duration drives the VOD baseline shape).
 * @param {{ window: Window, document: Document }} side  harness side handle
 */
export function beforeStart(side) {
  for (const id of MEDIA_ELEMENT_IDS) {
    const el = side.document.getElementById(id);
    if (!el) continue;
    Object.defineProperty(el, 'paused', { value: false, configurable: true });
    Object.defineProperty(el, 'currentTime', { value: INJECTED_CURRENT_TIME, configurable: true });
    Object.defineProperty(el, 'duration', { value: INJECTED_DURATION, configurable: true });
  }
}

/**
 * Drive a discrete transition (play) then, past the heartbeat throttle window, a
 * timeupdate heartbeat on the video element -- exercising the immediate-emit and
 * throttled-emit paths the extracted STREAM.MEDIA tracker provides. The
 * reference dispatches the same events but has no media listeners, so it emits
 * nothing for them; that asymmetry is the divergence D27 declares.
 * @param {{ window: Window, document: Document }} side  harness side handle
 * @param {(win: Window) => Promise<void>} settle        deterministic flush cadence
 */
export async function run(side, settle) {
  const vid = side.document.getElementById('media-vid');

  // Discrete play: the extracted tracker emits a STREAM.MEDIA immediately. The
  // tracker's per-element lastMediaSend starts at 0, so a subsequent heartbeat
  // is gated only by the real wait below, never by this discrete emit.
  if (vid) vid.dispatchEvent(new side.window.Event('play'));
  await settle(side.window);

  // Real wait beyond MEDIA_SYNC_THROTTLE_MS = 250 so the timeupdate heartbeat
  // is past the per-element throttle window on BOTH sides (each side waits
  // independently -- sides never interleave). 300 ms > 250 ms throttle.
  await new Promise((resolve) => setTimeout(resolve, 300));

  // timeupdate heartbeat: the extracted tracker emits because the element is
  // (stubbed) not paused and the throttle window has elapsed.
  if (vid) vid.dispatchEvent(new side.window.Event('timeupdate'));
  await settle(side.window);
}
