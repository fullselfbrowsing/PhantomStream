# Phase 4: Relay, WS Transport & Two-Tab Demo - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md - this log preserves the alternatives considered.

**Date:** 2026-06-14T23:10:43-05:00
**Phase:** 04-relay-ws-transport-two-tab-demo
**Areas discussed:** Discussion scope, demo operating model, relay pairing/routing, compression ordering, viewer lifecycle/health, verification

---

## Discussion Scope

The Codex `request_user_input` prompt was unavailable in Default mode. Per the GSD adapter fallback, the recommended scope was selected and the resulting decisions were marked as conservative defaults / agent discretion.

| Option | Description | Selected |
|--------|-------------|----------|
| Recommended set | Cover demo experience, relay pairing/state, codec compatibility, and observable health; best coverage for planning. | yes |
| Demo only | Focus on what `npx phantom-stream demo` should feel like and let planning decide relay internals. | |
| Relay deep dive | Focus on transport pairing, connection states, diagnostics, and codec behavior before demo polish. | |

**User's choice:** Fallback-selected recommended set.
**Notes:** This is not recorded as a manual user selection.

---

## Demo Operating Model

| Option | Description | Selected |
|--------|-------------|----------|
| Printed local URLs | `demo` starts local server/relay and prints source/viewer URLs; deterministic and easy to test. | yes |
| Auto-open tabs by default | More magical, but less deterministic across terminals, CI, and remote sessions. | |
| Single combined page | Easier to build but does not prove the roadmap's two-tab networked mirror. | |

**User's choice:** Fallback-selected printed local URLs.
**Notes:** Optional `--open` remains the agent's discretion.

---

## Relay Pairing and Routing

| Option | Description | Selected |
|--------|-------------|----------|
| Room-key raw fan-out | Source and viewer join a local room; relay forwards frames without transforming payloads. Matches reference behavior. | yes |
| Typed relay protocol | Relay decodes and understands every message. More visibility, more coupling. | |
| One-off demo pipe | Hard-code source to viewer only. Fast, but fails RELY-01's pluggable relay goal. | |

**User's choice:** Fallback-selected room-key raw fan-out.
**Notes:** Multi-viewer fan-out is supported if natural, but one source/one viewer is the Phase 4 proof.

---

## Compression and Send Ordering

| Option | Description | Selected |
|--------|-------------|----------|
| Native deflate with FIFO queue | Use `CompressionStream('deflate-raw')` by default and serialize async sends through a per-connection queue. | yes |
| Keep LZ default | Lower risk for ordering, but does not satisfy RELY-02's default native codec requirement. | |
| WebSocket permessage-deflate | Convenient but stateful per connection and conflicts with the reference fan-out/reconnect lessons. | |

**User's choice:** Fallback-selected native deflate with FIFO queue.
**Notes:** LZ-string decode compatibility remains mandatory for FSB envelope interoperability.

---

## Viewer Lifecycle and Health

| Option | Description | Selected |
|--------|-------------|----------|
| `on('state')` and `on('health')` | Small event surface with exact roadmap states and separate telemetry. | yes |
| One callback option | Simpler factory options, but less extensible for hosts. | |
| Built-in viewer status UI | Useful for demo, but framework chrome belongs to hosts. | |

**User's choice:** Fallback-selected small `on()` event surface.
**Notes:** The demo displays state, but the library only emits events.

---

## Verification

| Option | Description | Selected |
|--------|-------------|----------|
| Node tests plus FSB/browser checkpoint | Unit/integration coverage for relay/codec/events, plus real-browser proof for two-tab demo and relay-kill transitions. | yes |
| Node tests only | Fast but cannot prove the actual browser tabs mirror through the relay. | |
| Manual-only demo check | Proves UX but leaves relay/codec regressions uncovered. | |

**User's choice:** Fallback-selected Node tests plus FSB/browser checkpoint.
**Notes:** Mirrors Phase 3's successful browser checkpoint practice.

---

## the agent's Discretion

- Exact ports and CLI flags beyond `demo`.
- Exact room key format and URL naming.
- Exact relay module split and diagnostic payload field names.
- Optional browser auto-open behavior.

## Deferred Ideas

- Remote control and Playwright/CDP demos.
- Extension/bookmarklet adapters.
- Npm publishing and package-name finalization.
- FSB swap-in verification.
- Relay admin dashboard or public diagnostics endpoint.
