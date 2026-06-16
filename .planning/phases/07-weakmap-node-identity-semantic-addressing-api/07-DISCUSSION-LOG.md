# Phase 7: WeakMap Node Identity + Semantic Addressing API - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md - this log preserves the alternatives considered.

**Date:** 2026-06-15T08:57:54-05:00
**Phase:** 07-weakmap-node-identity-semantic-addressing-api
**Areas discussed:** WeakMap identity lifecycle, Semantic addressing API, Renderer indexing and diff application, Verification and migration

---

## WeakMap Identity Lifecycle

| Option | Description | Selected |
|--------|-------------|----------|
| Keep identity attrs in mirrored HTML only | Stop mutating the live page, but continue using `data-fsb-nid` in serialized clone/mirror markup for compatibility. | |
| Metadata sidecar | Carry nids through structured snapshot/add-op metadata and keep framework identity out of DOM attributes. | yes |
| Rename protocol identity | Replace `nid` fields with a new protocol shape and migrate all consumers at once. | |

**User's choice:** Fallback default selected because `request_user_input` is unavailable in this Conductor mode.
**Notes:** Metadata sidecar is the conservative default because it best satisfies the Phase 7 success criteria: no live-page mutation, preserved nid-addressed wire ops, and renderer `Map<nid, Node>` resolution without querySelector.

---

## Semantic Addressing API

| Option | Description | Selected |
|--------|-------------|----------|
| Opaque nid reference | Public API centers on `{ nid }` / string nid, with capture-side live-element lookup and viewer-side resolve/highlight. | yes |
| Selector query API | Build a public selector or descriptor query language as the main semantic API. | |
| Raw DOM exposure first | Expose mirrored DOM nodes directly and let hosts build their own highlighting/querying around them. | |

**User's choice:** Fallback default selected because `request_user_input` is unavailable in this Conductor mode.
**Notes:** Opaque nids keep the API small and aligned with existing wire semantics. Selectors and accessibility descriptors are deferred because they can become a separate capability.

---

## Renderer Indexing And Diff Application

| Option | Description | Selected |
|--------|-------------|----------|
| Keep querySelector temporarily | Remove live-page mutation first, then replace renderer selector lookup in a later phase. | |
| Internal index | Build and maintain an internal `Map<nid, Node>` for diff application, overlays, and public resolve/highlight. | yes |
| Public mutable index | Expose the full nid map to hosts for direct manipulation. | |

**User's choice:** Fallback default selected because `request_user_input` is unavailable in this Conductor mode.
**Notes:** Internal index is required by the roadmap success criterion and avoids making renderer internals part of the public API.

---

## Verification And Migration

| Option | Description | Selected |
|--------|-------------|----------|
| Minimal test migration | Update failing tests only and rely on existing loopback coverage. | |
| Full identity gate | Add negative live-page mutation tests, move-preservation coverage, oracle updates, and static guards against selector hot paths. | yes |
| Browser-only proof | Focus on demo verification and leave most identity behavior to manual browser checks. | |

**User's choice:** Fallback default selected because `request_user_input` is unavailable in this Conductor mode.
**Notes:** The identity change affects capture, renderer, oracle, masking, overlays, remote-control-adjacent geometry, and adapters. Focused automated gates should be part of the plan.

---

## the agent's Discretion

- Exact identity sidecar field names and typedef names.
- Exact public method names for capture-side live-element lookup and viewer-side resolving/highlighting.
- Exact module split for capture identity and renderer indexing.
- Whether a deprecated `NID_ATTR` export remains for transition documentation, provided internals no longer depend on it.

## Deferred Ideas

- Full selector, locator, or accessibility-tree query language for semantic addressing.
- Shadow-root, iframe, and cross-document identity semantics.
- Added-node computed style capture.
- On-demand subtree fetch.
- CSSOM stylesheet-centric protocol interactions.
