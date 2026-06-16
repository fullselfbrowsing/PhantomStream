# Phase 8: Shadow DOM, Iframes & Fidelity Completion - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md - this log preserves the alternatives considered.

**Date:** 2026-06-15T17:18:34Z
**Phase:** 08-shadow-dom-iframes-fidelity-completion
**Areas discussed:** Shadow DOM fidelity, Iframe policy, Live form values, Late-added computed styles, Truncated subtree recovery, Verification shape

---

## Shadow DOM Fidelity

| Option | Description | Selected |
|--------|-------------|----------|
| Open roots only | Mirror open shadow roots, represent closed roots honestly, preserve slots | yes |
| Flatten shadow DOM | Serialize shadow content into light DOM HTML | |
| Defer shadow identity | Render shadow content without extending node identity | |

**User's choice:** Auto-selected: Open roots only.
**Notes:** Phase 8 depends on Phase 7 identity. Flattening would duplicate slotted content and weaken semantic addressing.

---

## Iframe Policy

| Option | Description | Selected |
|--------|-------------|----------|
| Same-origin mirror plus cross-origin placeholders | Mirror accessible frames, placeholder inaccessible frames | yes |
| Placeholder all frames | Avoid nested frame serialization entirely | |
| Attempt cross-origin capture | Try to bypass browser origin policy | |

**User's choice:** Auto-selected: Same-origin mirror plus cross-origin placeholders.
**Notes:** This matches browser security boundaries and the roadmap success criterion.

---

## Live Form Values

| Option | Description | Selected |
|--------|-------------|----------|
| Explicit input/change diffs | Capture property-only value changes beyond MutationObserver | yes |
| Snapshot-only values | Wait for resync to pick up typed values | |
| Full node replacement | Replace controls wholesale on every input event | |

**User's choice:** Auto-selected: Explicit input/change diffs.
**Notes:** Value diffs must reuse existing masking and password protections.

---

## Late-Added Computed Styles

| Option | Description | Selected |
|--------|-------------|----------|
| Curated computed style capture for add ops | Reuse Phase 1 style list and default elision for late-added nodes | yes |
| Full CSSOM mode now | Implement stylesheet-centric capture in this phase | |
| Leave late nodes unstyled | Keep current drift until Phase 9 | |

**User's choice:** Auto-selected: Curated computed style capture for add ops.
**Notes:** Phase 9 owns full CSSOM mode. Phase 8 should preserve batched read discipline.

---

## Truncated Subtree Recovery

| Option | Description | Selected |
|--------|-------------|----------|
| Explicit on-demand fetch | Viewer/host requests a missing tracked subtree and capture returns sanitized sidecar payload | yes |
| Full resnapshot only | Continue current recovery behavior | |
| Automatic fetch storm | Fetch every missing node immediately | |

**User's choice:** Auto-selected: Explicit on-demand fetch.
**Notes:** Recovery must be bounded, stale-safe, and use the same serialization policy as snapshot/add.

---

## Verification Shape

| Option | Description | Selected |
|--------|-------------|----------|
| Fixture per fidelity gap | Add focused fixtures and full-suite regression | yes |
| Manual/browser-only verification | Rely mainly on browser checks | |
| Broad golden snapshots | Use large snapshots as the main proof | |

**User's choice:** Auto-selected: Fixture per fidelity gap.
**Notes:** Include oracle ledger updates for intentional reference divergences.

---

## the agent's Discretion

- Exact protocol field names and message names.
- Exact module split and helper naming.
- Whether subtree fetch uses `CONTROL.*`/`STREAM.*` or mutation-family extensions, provided relay transparency and staleness checks are preserved.

## Deferred Ideas

- CSSOM capture mode: Phase 9.
- Cross-origin iframe content capture: out of v1 scope.
- Closed shadow root introspection: only possible with page cooperation, not assumed.
- Public selector/accessibility query language: future semantic API layer.
