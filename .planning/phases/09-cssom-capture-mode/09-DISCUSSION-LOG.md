# Phase 9: CSSOM Capture Mode - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md - this log preserves the alternatives considered.

**Date:** 2026-06-16
**Phase:** 09-cssom-capture-mode
**Areas discussed:** Capture mode boundary, Stylesheet fallback policy, Live CSS mutation handling, Renderer/protocol compatibility

---

## Capture Mode Boundary

| Option | Description | Selected |
|--------|-------------|----------|
| Replace computed mode | Make CSSOM the new default and remove generated computed inline styles globally. | |
| Add opt-in CSSOM mode | Keep current computed mode as default; add stylesheet-centric mode behind configuration. | yes |
| Defer to evaluation | Do not add a user-facing mode until Phase 12 benchmarking. | |

**User's choice:** Workflow fallback selected "Add opt-in CSSOM mode."
**Notes:** The current computed-style path is validated by prior phases and should remain the compatibility/oracle baseline. CSSOM mode is the new opt-in behavior for CAPT-10 and the paper ablation arm.

---

## Stylesheet Fallback Policy

| Option | Description | Selected |
|--------|-------------|----------|
| Strict CSSOM only | Use readable `cssRules`; fail or omit blocked sheets. | |
| Documented fallback chain | Readable rules, safe href relink, explicit adapter fetch, then curated computed fallback. | yes |
| Always computed on blocked sheets | Any inaccessible sheet forces whole-document computed-style mode. | |

**User's choice:** Workflow fallback selected "Documented fallback chain."
**Notes:** This matches the roadmap success criterion and avoids browser security bypasses. Adapter fetch must be explicit host capability, not implicit core behavior.

---

## Live CSS Mutation Handling

| Option | Description | Selected |
|--------|-------------|----------|
| Snapshot-only | CSSOM capture affects full snapshots; dynamic rule changes wait for resnapshot and are documented as a limitation. | |
| Narrow style-op path | rAF-batched scoped stylesheet source updates cover common dynamic CSS APIs. | yes |
| Full CSS rule diffing | Track and transmit exact per-rule insert/delete/replace deltas. | |

**User's choice:** Workflow fallback selected "Narrow style-op path."
**Notes:** This is the pragmatic CAPT-10 interpretation: class flips and common CSS-in-JS rule insertion should mirror live, but Phase 9 does not need a complete CSS rule diff engine.

---

## Renderer/protocol Compatibility

| Option | Description | Selected |
|--------|-------------|----------|
| New top-level style channel | Add a separate `STREAM.STYLES` message family. | |
| Mutation-family style op | Carry style updates through existing mutation/staleness plumbing. | yes |
| Snapshot-only compatibility | Avoid renderer diff changes and rely only on new snapshot payload fields. | |

**User's choice:** Workflow fallback selected "Mutation-family style op."
**Notes:** This keeps relay behavior raw and unchanged, reuses session/snapshot gating, and lets old viewers degrade softly if they ignore unknown style ops.

---

## the agent's Discretion

- Exact config option names and default values.
- Exact style-source payload field names and source-id shape.
- Exact implementation mechanics for constructable stylesheet observation.
- Exact fixture organization and diagnostic counter names.

## Deferred Ideas

- Full evaluation harness and ablation tables - Phase 12.
- npm publish/quickstarts - Phase 10.
- FSB swap-in/API freeze - Phase 11.
- Removing truncation machinery based on CSSOM payload savings - future work after evaluation data.
