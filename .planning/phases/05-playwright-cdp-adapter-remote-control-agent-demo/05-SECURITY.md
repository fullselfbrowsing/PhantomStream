---
phase: 05-playwright-cdp-adapter-remote-control-agent-demo
slug: playwright-cdp-adapter-remote-control-agent-demo
status: verified
threats_open: 0
asvs_level: 1
created: 2026-06-15
---

# Phase 05 — Security

Per-phase security contract: threat register, accepted risks, and audit trail.

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| viewer -> relay -> adapter | Viewer-originated control frames cross into the Playwright driver process. | Control request/action metadata; typed text only for replay. |
| driven page -> adapter binding | Captured page code calls a Node-side Playwright exposed binding. | Capture stream frames from the main frame. |
| adapter -> Playwright/CDP | Adapter invokes native browser input APIs. | Validated coordinates, deltas, keys, and text. |
| host overlay -> viewport mapping | Host DOM pointer coordinates map back into captured-page viewport coordinates. | Numeric geometry only. |
| local demo -> browser automation | Local CLI/server launches a browser and local relay for verification. | Local URLs, room key, control state, telemetry counters. |
| observation -> artifacts | Browser verification observations are written to planning artifacts. | Local URLs, states, counters, and character counts only. |

## Threat Register

| Threat ID | Category | Component | Disposition | Mitigation | Status |
|-----------|----------|-----------|-------------|------------|--------|
| T-05-01 | Tampering | Control payload validation | mitigate | `validateRemoteControlMessage()` rejects unsupported types, invalid coordinates/deltas/buttons/key events, and oversized text; covered by `tests/remote-control-protocol.test.js`. | closed |
| T-05-02 | Information Disclosure | Action summaries, state events, demo logs, verification artifact | mitigate | `summarizeRemoteControlAction()` and `createRemoteControlStateEvent()` whitelist content-free fields; demo logs show typed character counts only; `05-BROWSER-VERIFICATION.md` passed leak grep. | closed |
| T-05-03 | Elevation of Privilege | Authorization gate | mitigate | `createPlaywrightAdapter()` defaults to deny, calls `authorizeControl()` before `active`, treats hook errors as denied, and demo starts in deny mode; covered by authorization tests and browser denial checkpoint. | closed |
| T-05-04 | Elevation of Privilege | Inactive/denied replay | mitigate | `dispatchRemoteAction()` checks `controlState === active` before every replay; demo overlay only receives pointer events while active; browser checkpoint proved denied actions dispatched 0 inputs and changed no driven-page state. | closed |
| T-05-05 | Tampering | Replay implementation | mitigate | Replay uses Playwright mouse/keyboard APIs or CDP `Input.*`; static tests forbid DOM synthetic event replay strings; async replay failures from transport messages are contained and sanitized. | closed |
| T-05-06 | Information Disclosure | Injected bridge and navigation survival | mitigate | Binding filters caller page/frame to main frame, inject artifact guards `window.top !== window`, capture restarts on navigation and viewer stream-start, and browser checkpoint proved navigation re-snapshot. | closed |
| T-05-07 | Tampering | Coordinate mapping | mitigate | `mapHostPointToViewport()` rejects letterbox/out-of-bounds points before clamping; viewer sends click/scroll only for `inside:true`; renderer mapping tests and browser checkpoint cover click/scroll replay. | closed |
| T-05-08 | Spoofing | Local demo server/UI | mitigate | Demo server rejects non-`127.0.0.1` hosts, prints local URLs, generates room keys, serves no-store assets, and keeps control default-deny; tests cover local-only URL and host rejection. | closed |
| T-05-09 | Tampering | Relay boundary | mitigate | Relay remains raw fan-out and never authorizes or executes control actions; remote-control relay test verifies byte-identical forwarding, while adapter/demo own execution. | closed |

## Accepted Risks Log

No accepted risks.

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-06-15 | 9 | 9 | 0 | Codex local secure-phase fallback |

## Evidence

- Protocol validation/redaction: `tests/remote-control-protocol.test.js`, `tests/remote-control-privacy.test.js`.
- Authorization and replay: `tests/remote-control-authorization.test.js`, `tests/playwright-adapter.test.js`, `tests/playwright-adapter-cdp.test.js`.
- Mapping and renderer boundary: `tests/renderer-remote-control.test.js`, `tests/renderer-viewer.test.js`.
- Local demo safety: `tests/playwright-demo-cli.test.js`.
- Browser evidence: `.planning/phases/05-playwright-cdp-adapter-remote-control-agent-demo/05-BROWSER-VERIFICATION.md`.
- Review evidence: `.planning/phases/05-playwright-cdp-adapter-remote-control-agent-demo/05-REVIEW.md`.

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-06-15
