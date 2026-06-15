# Phase 05 Discussion Log

Phase: Playwright/CDP Adapter, Remote Control & Agent Demo
Mode: Auto-selected defaults after user said "proceed"; project config has `workflow.auto_advance=true`.
Date: 2026-06-15

## Boundary

Phase 05 is bounded by ADPT-02, PKG-02, VIEW-05, and SEC-04. It must prove a Playwright/CDP-driven browser can be mirrored live and consent-controlled through the viewer. It should not pull in Phase 06 adapter packaging, Phase 07 identity APIs, or later fidelity/publication/evaluation work.

## Auto-Selected Decisions

| Area | Options Considered | Selected | Rationale |
| --- | --- | --- | --- |
| Adapter runtime | One-off demo script; first-class Playwright/CDP adapter | First-class adapter | ADPT-02 is a host-adapter requirement, and Phase 06 depends on Phase 05 inject artifact tooling. |
| Injection path | Playwright only; CDP only; both from one artifact | Both from one artifact | Roadmap explicitly requires `addInitScript` and `Page.addScriptToEvaluateOnNewDocument` from a single-file inject artifact. |
| Demo target | Public website; local deterministic fixture | Local deterministic fixture | Keeps verification repeatable, avoids network flake, and follows Phase 04 local-demo safety. |
| Relay behavior | Relay executes control; relay only routes frames | Relay only routes frames | Phase 04 locked relay as raw/stateless and transport-agnostic. |
| Authorization | Opt-in allow by default; default deny with hook | Default deny with hook | SEC-04 requires host-provided consent/authorization and observable denial. |
| Remote protocol | Reuse reference `dash:*` strings; define PhantomStream messages | Define PhantomStream messages | Keeps public API framework-owned while preserving reference names as lineage. |
| Gesture scope | Click/type/scroll only; full browser control | Click/type/scroll only | These exactly match VIEW-05 and success criterion 3. |
| Input replay | Synthetic DOM events; driver-native input | Driver-native input | Roadmap explicitly forbids synthetic DOM events for remote control. |
| UI style | Marketing page; operational local demo | Operational local demo | Phase 05 is a runnable demo phase; Phase 04 established compact host-owned demo UI. |
| Verification | Unit-only; browser proof plus tests | Browser proof plus tests | Success criteria require observing live mirrored behavior and real driven-page mutation. |

## Prior Decisions Applied

- Phase 04 relay fan-out remains raw and transport-agnostic; Phase 05 control frames should use it without adding relay-side driver logic.
- Phase 04 endpoint compression owns transformation; Phase 05 should not add relay compression or inspect mirrored/control payloads in relay.
- Phase 04 viewer lifecycle and health are library events with host-owned UI; Phase 05 remote-control state should follow the same event-first pattern.
- Phase 04 demo is local-only on `127.0.0.1`; Phase 05 demo should keep that safety posture.

## Gray Areas Resolved

### Adapter packaging

Selected: build a reusable Playwright/CDP adapter module and export path rather than putting all behavior in the demo.

### Consent behavior

Selected: default deny, hook-controlled activation, observable state events for both approval and denial, no content-bearing telemetry.

### Coordinate handling

Selected: reverse-map viewer coordinates through current stage scale/offset into captured page viewport coordinates; replay only through Playwright/CDP native input.

### Navigation handling

Selected: inject before document scripts and re-snapshot after navigation/reload, with browser verification proving recovery.

### Demo ergonomics

Selected: deterministic local fixture/demo command with compact status UI and visible controls for authorization and live action feedback.

## Deferred Ideas

- Extension MV3 remote-control packaging and service-worker routing.
- Bookmarklet adapter.
- Public semantic element targeting API.
- Drag/drop, clipboard, file upload, IME, selection, and multi-pointer remote control.
