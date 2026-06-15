---
phase: 04
slug: relay-ws-transport-two-tab-demo
status: approved
nyquist_compliant: true
wave_0_complete: false
created: 2026-06-14
---

# Phase 04 - Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Node built-in `node:test` on Node v24.14.1 |
| **Config file** | none; scripts live in `package.json` |
| **Quick run command** | `node --test tests/relay-core.test.js tests/websocket-transport.test.js tests/renderer-health-events.test.js tests/demo-cli.test.js` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~10-30 seconds for focused tests, full-suite runtime to be measured after new tests land |

---

## Sampling Rate

- **After every task commit:** Run the focused `node --test` command for the touched module.
- **After every plan wave:** Run `npm test`.
- **Before `$gsd-verify-work`:** Full suite must be green and the browser kill-relay checkpoint must be recorded.
- **Max feedback latency:** One task commit; no more than one implementation task may land without a focused automated check.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 04-01-01 | 01 | 1 | RELY-01 | T-04-01 | Relay routes source-to-viewer and viewer-to-source by room/role without same-side echo. | unit | `node --test tests/relay-core.test.js` | no | pending |
| 04-01-02 | 01 | 1 | RELY-01 | T-04-02 | Oversize frames are rejected before delivery and diagnostics include room prefix, role, type, size, cap, and compressed flag. | unit | `node --test tests/relay-core.test.js` | no | pending |
| 04-01-03 | 01 | 1 | RELY-01 | T-04-03 | Wedged clients over the backpressure limit drop frames and increment diagnostics without blocking other clients. | unit | `node --test tests/relay-core.test.js` | no | pending |
| 04-02-01 | 02 | 1 | RELY-02 | T-04-04 | Native deflate, plain JSON, and legacy `_lz` frames decode correctly without leaking exceptions. | unit | `node --test tests/websocket-transport.test.js tests/protocol.test.js` | no / yes | pending |
| 04-02-02 | 02 | 1 | RELY-02 | T-04-05 | Async compression preserves FIFO send order and `flush()` resolves after queued sends drain. | unit | `node --test tests/websocket-transport.test.js` | no | pending |
| 04-03-01 | 03 | 2 | VIEW-02 | T-04-06 | `viewer.on('state')` emits `connecting`, `live`, `stale`, `disconnected`; unsubscribe works; existing handle methods remain. | unit | `node --test tests/renderer-health-events.test.js tests/renderer-viewer.test.js` | no / yes | pending |
| 04-03-02 | 03 | 2 | VIEW-02 | T-04-07 | `viewer.on('health')` exposes counters and timestamps only, never mirrored HTML/text payload content. | unit | `node --test tests/renderer-health-events.test.js` | no | pending |
| 04-04-01 | 04 | 3 | PKG-01 | T-04-08 | CLI demo server binds `127.0.0.1`, prints source/viewer URLs and room prefix, and serves ESM with safe path handling. | integration | `node --test tests/demo-cli.test.js` | no | pending |
| 04-04-02 | 04 | 3 | PKG-01 | T-04-09 | Browser demo mirrors a live mutation and relay shutdown produces `live -> stale -> disconnected`. | browser/manual | `node bin/phantom-stream.js demo`, open printed URLs, mutate source, stop relay process | no | pending |

---

## Wave 0 Requirements

- [ ] `tests/relay-core.test.js` - covers RELY-01 routing, cap diagnostics, backpressure, and room cleanup.
- [ ] `tests/relay-ws-backend.test.js` - covers WebSocket backend admission/path/role validation and disabled `perMessageDeflate`.
- [ ] `tests/websocket-transport.test.js` - covers native codec fallback, legacy `_lz` decode, FIFO ordering, `flush()`, and close/status events.
- [ ] `tests/renderer-health-events.test.js` - covers VIEW-02 event payloads and lifecycle transitions.
- [ ] `tests/demo-cli.test.js` - covers package bin route, local bind, URL printing, static path safety, startup, and shutdown.
- [ ] Browser checkpoint notes must be recorded in the phase verification artifact after implementation.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Two-tab browser demo mirrors live mutations through the bundled relay | PKG-01 | jsdom cannot prove real browser WebSocket tabs, iframe rendering, and visual mutation mirroring end-to-end | Run `node bin/phantom-stream.js demo`, open the printed viewer URL, open the printed source URL, click `Add row`, confirm the viewer updates, then stop the relay process and confirm the viewer status reports `live -> stale -> disconnected`. |
| Relay kill transition remains visible while preserving last frame | VIEW-02 / PKG-01 | Requires real browser timers and WebSocket close behavior | With both tabs open and live, terminate the demo process, observe the last frame remains visible while the status strip moves through `stale` to `disconnected`. |

---

## Threat References

| Threat | Category | Mitigation to Verify |
|--------|----------|----------------------|
| T-04-01 invalid room or role can receive traffic | Access control | Require room key and role; route only opposite-side frames. |
| T-04-02 oversize frame exhausts relay or bypasses cap | Denial of service | Enforce `RELAY_PER_MESSAGE_LIMIT_BYTES` before delivery. |
| T-04-03 wedged client grows unbounded queue | Denial of service | Drop frames when `bufferedAmount` exceeds backpressure limit and record diagnostics. |
| T-04-04 malformed/unknown envelope crashes receiver | Reliability / DoS | Decode returns structured errors and logs health event; no uncaught exceptions in message loop. |
| T-04-05 async compression reorders capture frames | Integrity | Per-connection FIFO queue and `flush()` ordering tests. |
| T-04-06 viewer state is unobservable to hosts | Availability / observability | `on('state')` emits lifecycle states and returns unsubscribe. |
| T-04-07 telemetry leaks mirrored page content | Information disclosure | Health payload tests assert no HTML/text payload fields are emitted. |
| T-04-08 demo server exposes filesystem or LAN service | Information disclosure | Bind `127.0.0.1`; reuse decode-before-resolve root-prefix guard. |
| T-04-09 local page can spoof source/viewer without room key | Spoofing | Generated room key required in URL and WebSocket upgrade. |

---

## Validation Sign-Off

- [x] All requirements have automated or manual verification coverage.
- [x] Wave 0 lists all missing test files.
- [x] Security-relevant behaviors map to explicit threat references.
- [x] No watch-mode commands are required.
- [x] Full suite command is `npm test`.
- [x] Browser-only behavior is isolated to a manual checkpoint.

**Approval:** approved 2026-06-14
