# Reference: Phantom Stream as shipped in FSB

Verbatim source extracted from [FSB](https://github.com/fullselfbrowsing/FSB) at commit
`867d6f0c473d18f657390b2d04f7809c7e76e4a5` (main, 2026-06-09). Nothing in this directory
is edited except the two `*.excerpt.js` files, which are contiguous line-range excerpts
of `extension/background.js` (a 13k-line file of which only the dom-stream relay and
watchdog-alarm sections are relevant).

| Path here | Path in FSB | Role |
|---|---|---|
| `extension/dom-stream.js` | `extension/content/dom-stream.js` | Capture core (content script) |
| `extension/ws-client.js` | `extension/ws/ws-client.js` | Extension WS client: stream lifecycle, readiness probe, pending-intent re-arm, envelope decode |
| `extension/background.dom-stream-relay.excerpt.js` | `extension/background.js:6168-6268` | Content-script -> WS forwarding + watchdog arming |
| `extension/background.watchdog-alarm.excerpt.js` | `extension/background.js:13034-13064` | SW alarm watchdog (safety net) |
| `extension/lz-string.min.js` | `extension/lib/lz-string.min.js` | Compression codec (MIT, pieroxy/lz-string) |
| `dashboard/dashboard.js` | `showcase/js/dashboard.js` | Viewer: snapshot render, diff apply, overlays, remote control, layout modes |
| `server/ws-handler.js` | `showcase/server/src/ws/handler.js` | WebSocket relay with per-message cap |
| `tests/` | `tests/` | Stream-related test suites |
| `planning/` | `.planning/` (partly recovered from git history) | Original milestone/phase design docs |

The planning docs under `planning/phases/` cover milestone v0.9.9.1 (phases 122–125 with
four inserted fix phases), Phase 211 (stream reliability + watchdogs), and Phase 276
(startup-handshake hardening). They are the primary sources for `docs/DESIGN-HISTORY.md`
and the paper's production-failure narrative.
