// Pure reconciler table tests for reconcileMediaDrift (MWIRE-02, MEDIA-03).
//
// The reconciler is a pure function over plain objects -- no DOM, no media
// element, no clock read inside (the caller passes `now`). Every decision-tree
// branch (RESEARCH Pattern 1) and every NaN/edge-trap row (RESEARCH trap table)
// has a test here, and EVERY test additionally asserts that no returned field
// is NaN. jsdom is intentionally NOT imported -- this suite is sub-second and
// element-free by construction, which is exactly what makes MWIRE-02 ("pure,
// configurable, jsdom-unit-testable, no real media timeline") true.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  reconcileMediaDrift,
  DEFAULT_MEDIA_RECONCILE_CONFIG,
} from '../src/protocol/media-reconcile.js';

// --- helpers -------------------------------------------------------------

// Recursively assert no numeric field in a returned action is NaN.
function assertNoNaN(action, label) {
  assert.ok(action && typeof action === 'object', `${label}: action is an object`);
  for (const [k, v] of Object.entries(action)) {
    if (typeof v === 'number') {
      assert.ok(!Number.isNaN(v), `${label}: field "${k}" must not be NaN (got ${v})`);
    }
  }
}

// A finite-duration "playing" remote state at a known position.
function remoteVod(currentTime, overrides = {}) {
  return {
    nid: 'n1',
    event: 'timeupdate',
    currentTime,
    paused: false,
    muted: false,
    volume: 1,
    playbackRate: 1,
    loop: false,
    ended: false,
    duration: 300,
    sentAt: 1000,
    streamSessionId: 'stream_a_1',
    snapshotId: 100,
    ...overrides,
  };
}

const NOW = 1000; // elapsed 0 when sentAt === NOW: expected === remote.currentTime

// --- defaults ------------------------------------------------------------

test('DEFAULT_MEDIA_RECONCILE_CONFIG carries the locked thresholds', () => {
  assert.equal(DEFAULT_MEDIA_RECONCILE_CONFIG.holdBandSec, 0.25);
  assert.equal(DEFAULT_MEDIA_RECONCILE_CONFIG.hardSeekSec, 1.0);
  assert.equal(DEFAULT_MEDIA_RECONCILE_CONFIG.maxNudgeFraction, 0.05);
  assert.equal(DEFAULT_MEDIA_RECONCILE_CONFIG.liveRejoinSec, 1.0);
});

// --- hold band -----------------------------------------------------------

test('hold band: |drift| <= 0.25 while playing -> hold, carrying revertRate === remote.playbackRate', () => {
  const remote = remoteVod(10, { playbackRate: 1 });
  const local = { currentTime: 10.1, paused: false, playbackRate: 1 }; // drift 0.1
  const action = reconcileMediaDrift(local, remote, NOW, undefined);
  assert.equal(action.action, 'hold');
  assert.equal(action.revertRate, 1);
  assertNoNaN(action, 'hold-band');
});

test('hold band: exact boundary 0.25 holds (<=, not <)', () => {
  const remote = remoteVod(10);
  const local = { currentTime: 10.25, paused: false, playbackRate: 1 }; // drift exactly 0.25
  const action = reconcileMediaDrift(local, remote, NOW);
  assert.equal(action.action, 'hold');
  assertNoNaN(action, 'hold-boundary');
});

// --- rate nudge ----------------------------------------------------------

test('nudge: drift in (0.25, 1.0] behind -> speed up rate*(1+0.05), carries baseRate', () => {
  const remote = remoteVod(10, { playbackRate: 1 });
  const local = { currentTime: 9.5, paused: false, playbackRate: 1 }; // expected 10 ahead of local -> behind
  const action = reconcileMediaDrift(local, remote, NOW);
  assert.equal(action.action, 'nudge');
  assert.ok(Math.abs(action.rate - 1.05) < 1e-9, `expected 1.05, got ${action.rate}`);
  assert.equal(action.baseRate, 1);
  assertNoNaN(action, 'nudge-behind');
});

test('nudge: drift in (0.25, 1.0] ahead -> slow down rate*(1-0.05)', () => {
  const remote = remoteVod(10, { playbackRate: 1 });
  const local = { currentTime: 10.5, paused: false, playbackRate: 1 }; // local ahead of expected
  const action = reconcileMediaDrift(local, remote, NOW);
  assert.equal(action.action, 'nudge');
  assert.ok(Math.abs(action.rate - 0.95) < 1e-9, `expected 0.95, got ${action.rate}`);
  assert.equal(action.baseRate, 1);
  assertNoNaN(action, 'nudge-ahead');
});

test('nudge magnitude is capped at maxNudgeFraction (5%) regardless of base rate', () => {
  const remote = remoteVod(10, { playbackRate: 2 });
  const local = { currentTime: 9.5, paused: false, playbackRate: 2 }; // behind by 0.5
  const action = reconcileMediaDrift(local, remote, NOW);
  assert.equal(action.action, 'nudge');
  // 2 * (1 + 0.05) = 2.1 ; the ratio to base never exceeds 5%.
  assert.ok(Math.abs(action.rate - 2.1) < 1e-9, `expected 2.1, got ${action.rate}`);
  assert.ok(Math.abs(action.rate / action.baseRate - 1) <= 0.05 + 1e-9);
  assertNoNaN(action, 'nudge-cap');
});

test('nudge revert: a subsequent in-band call returns hold with revertRate = true remote.playbackRate (no internal memory)', () => {
  const remote = remoteVod(10, { playbackRate: 1 });
  // The element currently carries a nudged rate (1.05) read back from local,
  // but the reconciler keeps no memory -- it reports the true rate to revert to.
  const local = { currentTime: 10.05, paused: false, playbackRate: 1.05 }; // back in band
  const action = reconcileMediaDrift(local, remote, NOW);
  assert.equal(action.action, 'hold');
  assert.equal(action.revertRate, 1, 'revertRate is the true remote rate, not the nudged local rate');
  assertNoNaN(action, 'nudge-revert');
});

// --- hard seek -----------------------------------------------------------

test('hard-seek: |drift| > 1.0 -> seek to clamped expected position', () => {
  const remote = remoteVod(50, { playbackRate: 1 });
  const local = { currentTime: 10, paused: false, playbackRate: 1 }; // drift 40
  const action = reconcileMediaDrift(local, remote, NOW);
  assert.equal(action.action, 'seek');
  assert.equal(action.toTime, 50);
  assertNoNaN(action, 'hard-seek');
});

test('hard-seek clamps toTime into [0, duration] on overrun (expected > duration)', () => {
  const remote = remoteVod(305, { duration: 300, playbackRate: 1 }); // expected 305 > duration 300
  const local = { currentTime: 10, paused: false, playbackRate: 1 };
  const action = reconcileMediaDrift(local, remote, NOW);
  assert.equal(action.action, 'seek');
  assert.equal(action.toTime, 300, 'clamped to duration');
  assertNoNaN(action, 'hard-seek-clamp-high');
});

test('hard-seek clamps toTime to >= 0 (no negative seek target)', () => {
  // Negative remote.currentTime is hostile input; clamp keeps the seek target >= 0.
  const remote = remoteVod(-50, { playbackRate: 1 });
  const local = { currentTime: 10, paused: false, playbackRate: 1 };
  const action = reconcileMediaDrift(local, remote, NOW);
  assert.equal(action.action, 'seek');
  assert.ok(action.toTime >= 0, `toTime must be >= 0, got ${action.toTime}`);
  assertNoNaN(action, 'hard-seek-clamp-low');
});

// --- explicit seek -------------------------------------------------------

test('explicit seek: remote.event === "seeked" -> always hard-seek to clamped remote.currentTime regardless of drift', () => {
  const remote = remoteVod(10, { event: 'seeked', playbackRate: 1 });
  const local = { currentTime: 10.0, paused: false, playbackRate: 1 }; // zero drift, would otherwise hold
  const action = reconcileMediaDrift(local, remote, NOW);
  assert.equal(action.action, 'seek');
  assert.equal(action.toTime, 10);
  assertNoNaN(action, 'explicit-seek');
});

test('explicit seek clamps to duration and short-circuits before paused/rate-0 handling', () => {
  const remote = remoteVod(999, { event: 'seeked', duration: 300, paused: true, playbackRate: 0 });
  const local = { currentTime: 0, paused: true, playbackRate: 1 };
  const action = reconcileMediaDrift(local, remote, NOW);
  assert.equal(action.action, 'seek');
  assert.equal(action.toTime, 300);
  assertNoNaN(action, 'explicit-seek-clamp');
});

// --- loop wrap -----------------------------------------------------------

test('loop-wrap: remote.loop and local near end while expected near start -> seek to wrapped position, not the raw delta', () => {
  // local at 299.5 (near end of 300), expected wrapped to 0.5 (near start).
  const remote = remoteVod(0.5, { loop: true, duration: 300, playbackRate: 1 });
  const local = { currentTime: 299.5, paused: false, playbackRate: 1 };
  const action = reconcileMediaDrift(local, remote, NOW);
  assert.equal(action.action, 'seek');
  assert.equal(action.toTime, 0.5, 'seek to the wrapped position');
  assertNoNaN(action, 'loop-wrap');
});

test('loop-wrap does not fire for a small in-band drift mid-timeline', () => {
  const remote = remoteVod(150.1, { loop: true, duration: 300, playbackRate: 1 });
  const local = { currentTime: 150, paused: false, playbackRate: 1 }; // drift 0.1, mid-timeline
  const action = reconcileMediaDrift(local, remote, NOW);
  assert.equal(action.action, 'hold', 'a normal small drift mid-timeline is not a loop wrap');
  assertNoNaN(action, 'loop-wrap-negative');
});

// --- live branch ---------------------------------------------------------

test('live branch (remote.live === true): large drift -> rejoin-edge, never an absolute seek', () => {
  const remote = remoteVod(100, { live: true, playbackRate: 1 });
  delete remote.duration; // live entries omit duration
  const local = { currentTime: 10, paused: false, playbackRate: 1 }; // big drift
  const action = reconcileMediaDrift(local, remote, NOW);
  assert.equal(action.action, 'rejoin-edge');
  assert.notEqual(action.action, 'seek');
  assertNoNaN(action, 'live-rejoin');
});

// Phase 14 (MADPT-04 -- adaptive live REUSE): an adaptive live manifest drives
// the SAME reconciler live branch as a progressive live <video> -- there is NO
// new adaptive sync path. A live: true payload at large drift returns rejoin-edge
// and carries NO absolute toTime: the renderer's applyMediaAction computes the
// live edge from the element's seekable range (guarded by seekable.length > 0),
// never seeking to a payload-supplied absolute time. This pins the verbatim reuse.
test('adaptive live reuse: live:true large drift -> rejoin-edge with NO absolute toTime (MADPT-04, verbatim reuse)', () => {
  const remote = remoteVod(5000, { live: true, playbackRate: 1 }); // far-ahead live edge
  delete remote.duration; // live entries omit duration
  const local = { currentTime: 10, paused: false, playbackRate: 1 }; // huge drift
  const action = reconcileMediaDrift(local, remote, NOW);
  assert.equal(action.action, 'rejoin-edge', 'a live payload reconciles to rejoin-edge');
  assert.notEqual(action.action, 'seek', 'a live payload never produces an absolute seek');
  assert.equal(action.toTime, undefined, 'rejoin-edge carries NO absolute toTime (the edge is read from seekable)');
  assertNoNaN(action, 'adaptive-live-reuse');
});

test('live branch: small drift -> hold (no rejoin)', () => {
  const remote = remoteVod(100, { live: true, playbackRate: 1 });
  delete remote.duration;
  const local = { currentTime: 100.1, paused: false, playbackRate: 1 }; // small drift
  const action = reconcileMediaDrift(local, remote, NOW);
  assert.equal(action.action, 'hold');
  assertNoNaN(action, 'live-hold');
});

test('live branch is taken BEFORE any duration arithmetic when duration is non-finite (Infinity)', () => {
  const remote = remoteVod(100, { duration: Infinity, playbackRate: 1 }); // non-finite duration, no live flag
  const local = { currentTime: 10, paused: false, playbackRate: 1 };
  const action = reconcileMediaDrift(local, remote, NOW);
  // Must NOT produce a NaN seek; takes the live path on non-finite duration.
  assert.ok(action.action === 'rejoin-edge' || action.action === 'hold');
  assert.notEqual(action.action, 'seek');
  assertNoNaN(action, 'live-infinity-duration');
});

// --- paused / rate-0 -----------------------------------------------------

test('paused remote: local playing -> pause; never interpolate position', () => {
  const remote = remoteVod(10, { paused: true });
  const local = { currentTime: 10, paused: false, playbackRate: 1 };
  const action = reconcileMediaDrift(local, remote, NOW);
  assert.equal(action.action, 'pause');
  assertNoNaN(action, 'paused-mirror');
});

test('paused remote: local already paused -> hold (reason paused)', () => {
  const remote = remoteVod(10, { paused: true });
  const local = { currentTime: 10, paused: true, playbackRate: 1 };
  const action = reconcileMediaDrift(local, remote, NOW);
  assert.equal(action.action, 'hold');
  assertNoNaN(action, 'paused-hold');
});

test('rate-0 remote is treated like paused (no nudge math on rate 0)', () => {
  const remote = remoteVod(10, { playbackRate: 0, paused: false });
  const local = { currentTime: 10, paused: false, playbackRate: 1 };
  const action = reconcileMediaDrift(local, remote, NOW);
  assert.equal(action.action, 'pause');
  assertNoNaN(action, 'rate-0');
});

// --- latency compensation ------------------------------------------------

test('latency comp: expected = currentTime + rate*((now - sentAt)/1000) drives a forward seek while playing', () => {
  // sentAt 2s before now, rate 1 -> expected = 10 + 1*2 = 12; local at 10 -> drift 2 > 1 -> seek to 12.
  const remote = remoteVod(10, { sentAt: 0, playbackRate: 1 });
  const local = { currentTime: 10, paused: false, playbackRate: 1 };
  const action = reconcileMediaDrift(local, remote, 2000);
  assert.equal(action.action, 'seek');
  assert.equal(action.toTime, 12);
  assertNoNaN(action, 'latency-comp');
});

test('latency comp with rate 2: expected = currentTime + 2*elapsed', () => {
  // sentAt 1s before now, rate 2 -> expected = 10 + 2*1 = 12; local 10 -> drift 2 -> seek to 12.
  const remote = remoteVod(10, { sentAt: 0, playbackRate: 2 });
  const local = { currentTime: 10, paused: false, playbackRate: 2 };
  const action = reconcileMediaDrift(local, remote, 1000);
  assert.equal(action.action, 'seek');
  assert.equal(action.toTime, 12);
  assertNoNaN(action, 'latency-comp-rate2');
});

test('negative elapsed (clock skew now < sentAt) clamps to 0 -> expected === currentTime', () => {
  // sentAt is in the "future" relative to now; elapsed clamps to 0 so expected === currentTime.
  const remote = remoteVod(10, { sentAt: 5000, playbackRate: 1 });
  const local = { currentTime: 10, paused: false, playbackRate: 1 }; // zero drift after clamp
  const action = reconcileMediaDrift(local, remote, 1000); // now < sentAt
  assert.equal(action.action, 'hold', 'negative elapsed must not push expected backwards');
  assertNoNaN(action, 'negative-elapsed');
});

// --- NaN / edge-trap table (each a required test) ------------------------

test('edge trap: missing remote -> hold {reason: incomplete-remote}', () => {
  const local = { currentTime: 10, paused: false, playbackRate: 1 };
  const action = reconcileMediaDrift(local, null, NOW);
  assert.equal(action.action, 'hold');
  assert.equal(action.reason, 'incomplete-remote');
  assertNoNaN(action, 'missing-remote');
});

test('edge trap: missing remote.currentTime -> hold {reason: incomplete-remote}', () => {
  const remote = remoteVod(10);
  delete remote.currentTime;
  const local = { currentTime: 10, paused: false, playbackRate: 1 };
  const action = reconcileMediaDrift(local, remote, NOW);
  assert.equal(action.action, 'hold');
  assert.equal(action.reason, 'incomplete-remote');
  assertNoNaN(action, 'missing-currentTime');
});

test('edge trap: missing remote.sentAt -> hold {reason: incomplete-remote}', () => {
  const remote = remoteVod(10);
  delete remote.sentAt;
  const local = { currentTime: 10, paused: false, playbackRate: 1 };
  const action = reconcileMediaDrift(local, remote, NOW);
  assert.equal(action.action, 'hold');
  assert.equal(action.reason, 'incomplete-remote');
  assertNoNaN(action, 'missing-sentAt');
});

test('edge trap: NaN local.currentTime (element not ready) -> hold (wait for readiness), no NaN', () => {
  const remote = remoteVod(10, { playbackRate: 1 });
  const local = { currentTime: NaN, paused: false, playbackRate: 1 };
  const action = reconcileMediaDrift(local, remote, NOW);
  assert.equal(action.action, 'hold');
  assertNoNaN(action, 'nan-local');
});

test('edge trap: duration 0 -> never seek into a 0-length timeline (hold or pause), no NaN', () => {
  const remote = remoteVod(0, { duration: 0, playbackRate: 1 });
  const local = { currentTime: 0, paused: false, playbackRate: 1 };
  const action = reconcileMediaDrift(local, remote, NOW);
  assert.notEqual(action.action, 'seek');
  assert.ok(action.action === 'hold' || action.action === 'pause');
  assertNoNaN(action, 'duration-0');
});

test('edge trap: Infinity duration with playing remote -> live path, no NaN, no absolute seek', () => {
  const remote = remoteVod(100, { duration: Infinity, playbackRate: 1 });
  const local = { currentTime: 10, paused: false, playbackRate: 1 };
  const action = reconcileMediaDrift(local, remote, NOW);
  assert.notEqual(action.action, 'seek');
  assertNoNaN(action, 'infinity-duration');
});

test('edge trap: cfg with missing fields is merged over DEFAULT_MEDIA_RECONCILE_CONFIG (no NaN thresholds)', () => {
  const remote = remoteVod(10, { playbackRate: 1 });
  const local = { currentTime: 10.1, paused: false, playbackRate: 1 }; // drift 0.1
  // Only override hardSeekSec; the rest must fall back to defaults (holdBandSec 0.25).
  const action = reconcileMediaDrift(local, remote, NOW, { hardSeekSec: 5 });
  assert.equal(action.action, 'hold', 'holdBandSec default 0.25 still applies under partial cfg');
  assertNoNaN(action, 'partial-cfg');
});

test('edge trap: custom cfg thresholds are honored (configurability)', () => {
  const remote = remoteVod(10, { playbackRate: 1 });
  const local = { currentTime: 10.1, paused: false, playbackRate: 1 }; // drift 0.1
  // Tighten the hold band below 0.1 so the same drift now nudges instead of holding.
  const action = reconcileMediaDrift(local, remote, NOW, { holdBandSec: 0.05, hardSeekSec: 1.0 });
  assert.equal(action.action, 'nudge');
  assertNoNaN(action, 'custom-cfg');
});

test('edge trap: negative computed drift (local ahead) nudges DOWN (correct sign), no NaN', () => {
  const remote = remoteVod(10, { playbackRate: 1 });
  const local = { currentTime: 10.6, paused: false, playbackRate: 1 }; // local ahead -> slow down
  const action = reconcileMediaDrift(local, remote, NOW);
  assert.equal(action.action, 'nudge');
  assert.ok(action.rate < action.baseRate, 'ahead -> nudge slows down');
  assertNoNaN(action, 'negative-drift-sign');
});

test('every action shape is NaN-free across a sweep of hostile numeric inputs', () => {
  const hostile = [NaN, Infinity, -Infinity, 0, -0, -1, 1e308, undefined, null];
  let checked = 0;
  for (const ct of hostile) {
    for (const sa of hostile) {
      for (const pr of hostile) {
        for (const dur of hostile) {
          const remote = {
            nid: 'n1', event: 'timeupdate', currentTime: ct, paused: false,
            muted: false, volume: 1, playbackRate: pr, loop: false, ended: false,
            duration: dur, sentAt: sa, streamSessionId: 's', snapshotId: 1,
          };
          const local = { currentTime: ct, paused: false, playbackRate: 1 };
          const action = reconcileMediaDrift(local, remote, 1000);
          assertNoNaN(action, `hostile ct=${ct} sa=${sa} pr=${pr} dur=${dur}`);
          checked++;
        }
      }
    }
  }
  assert.ok(checked > 0);
});
