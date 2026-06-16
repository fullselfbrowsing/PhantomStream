# Phase 7: WeakMap Node Identity + Semantic Addressing API - Context

**Gathered:** 2026-06-15T08:57:54-05:00
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 7 replaces PhantomStream's live-page `data-fsb-nid` mutation model with internal node identity, while preserving the existing nid-addressed wire contract for diffs, overlays, remote control, and resync behavior. It also exposes a public semantic addressing surface so hosts can resolve and highlight mirrored elements by PhantomStream node identity.

This phase does not implement shadow DOM, same-origin iframe mirroring, late-added computed styles, on-demand subtree fetch, CSSOM capture mode, npm publishing, or FSB swap-in. Those remain in later roadmap phases.

</domain>

<decisions>
## Implementation Decisions

### Discussion Mode
- **D-01 [informational]:** The interactive question UI was unavailable in this Conductor mode. The workflow fallback selected all meaningful gray areas and captured conservative planning defaults.
- **D-02 [informational]:** These decisions are defaults for downstream research and planning. If research finds a concrete blocker, the planner must call out the deviation explicitly instead of silently changing the scope.

### WeakMap Identity Lifecycle
- **D-03:** Stop writing framework-owned identity attributes to the observed page. Capture internals must not use live-page `setAttribute(NID_ATTR, ...)`, `getAttribute(NID_ATTR)`, `dataset.fsbNid`, or selector lookups as the source of identity.
- **D-04:** Preserve the existing wire-addressing contract: diff ops continue to carry opaque string `nid`, `parentNid`, and `beforeNid` fields, and existing `STREAM.*`, `DIFF_OP.*`, overlay, scroll, dialog, and remote-control message families stay relay-transparent.
- **D-05:** Implement capture identity as an internal mirror, at minimum `WeakMap<Element, string>` for live element to nid plus a reverse lookup structure sufficient for removals, moves, and host-facing resolution. The exact module split and data structure names are planner discretion.
- **D-06:** Mint IDs deterministically in snapshot traversal order to preserve oracle discipline and stable test reasoning. A fresh `start()` resets the mirror and counter; `stop()` clears active identity state; `resume()` continues the same session and mirror without a resnapshot, matching the existing capture lifecycle contract.
- **D-07:** Preserve IDs across DOM moves. If the same live element or descendant subtree is removed and reinserted, reuse its existing nid rather than minting a new one. The wire can remain `rm` plus `add` if a dedicated move op is not introduced.
- **D-08:** Snapshot and add-op identity should travel as structured metadata sidecars, not framework-owned DOM attributes. Exact field names are planner discretion, but the metadata must let the renderer rebuild `nid -> Node` indexes for the full snapshot body and every added subtree.
- **D-09:** Removing identity attributes is an intentional oracle divergence only for identity markup. Diff op ordering, op kinds, and raw nid sequences should remain equivalent where behavior is otherwise unchanged; update the differential normalizer or ledger narrowly for this removal.
- **D-10:** A page-owned `data-fsb-nid` attribute, if one already exists in source content, is ordinary page data and not PhantomStream identity. Framework identity must not depend on it or reserve it as a public API.

### Semantic Addressing API
- **D-11:** Public addressing should center on an opaque PhantomStream node reference, effectively `{ nid }` or an equivalent branded string. CSS selectors, accessibility queries, and descriptor matching are useful host concerns, but they are not the canonical identity model for this phase.
- **D-12:** Add a capture-side API for trusted host code to map a live `Element` to the current PhantomStream nid, such as `getNodeId(element)` or an equivalent. It should return `null` for untracked, skipped, blocked-descendant, stale, or inactive-session nodes rather than throwing in normal operation.
- **D-13:** Add a viewer-side API for hosts to resolve and highlight mirrored nodes by nid. The handle should support query/resolve semantics and a built-in local highlight path, for example `resolveNode(nid)` plus `highlightNode(nid, options)` / `clearHighlight()`. Exact method names are planner discretion.
- **D-14:** Viewer highlighting is host-local renderer behavior, not a capture-to-viewer `STREAM.OVERLAY` side channel. Hosts should be able to highlight "the node an agent is about to touch" without configuring `overlayProvider` or sending network frames.
- **D-15:** The semantic API should expose geometry and identity status by default, not mirrored page HTML, text, attributes, or raw payloads. If a raw mirror DOM node escape hatch is added, it must be explicit and documented as same-trust-boundary access.
- **D-16:** Stale or missing nids should fail softly: return `null` / `false`, emit content-free diagnostics where useful, and preserve the existing resync behavior. Factory-time validation may throw; runtime addressing misses should not crash the stream.

### Renderer Indexing And Diff Application
- **D-17:** Replace the renderer's per-op `querySelector('[data-fsb-nid="..."]')` hot path with an incremental `Map<nid, Node>` index. This index is internal renderer state, not a public mutable object.
- **D-18:** Build the initial renderer index after each accepted snapshot from the snapshot identity sidecar and the parsed mirror body. Rebuild on fresh snapshots and clear on destroy/detach.
- **D-19:** Update the index incrementally for add and remove ops. Add ops index the sanitized/imported subtree using the add-op identity sidecar; remove ops delete the removed subtree's entries. Preserve stale-miss counters and resync thresholds when an id cannot be resolved.
- **D-20:** The overlay anchor resolver and semantic addressing API should use the same renderer index as diff application. There should not be a separate querySelector fallback for normal nid resolution.
- **D-21:** Sanitization remains before indexing. The renderer should index only the sanitized/imported nodes that actually enter the mirror document.
- **D-22:** Remote control coordinate mapping from Phase 5 remains unchanged. Phase 7 should make node highlighting/addressing possible, but it should not expand click/type/scroll semantics or move authorization out of adapters.

### Verification And Migration
- **D-23:** Add tests that prove the observed page is not mutated by identity tracking: no framework-owned identity attributes after snapshot or add ops, no page `MutationObserver` identity-attribute noise, and no page CSS selector side effect from PhantomStream identity.
- **D-24:** Update tests that currently assert `NID_ATTR` in snapshots, block placeholders, security masking, and renderer fixtures to assert identity through the new sidecar/API instead.
- **D-25:** Add move-preservation coverage: a live element moved within the observed page keeps the same nid and remains addressable after the renderer applies the resulting ops.
- **D-26:** Add a renderer regression gate that fails if diff application or overlay rect resolution reintroduces per-op identity `querySelector` lookups.
- **D-27:** Run the existing adapter and demo-relevant test surfaces after the migration. Phase 7 changes capture/renderer/protocol internals that every adapter consumes, even though adapter behavior is not expanded here.

### the agent's Discretion
- Exact file split for the capture identity mirror and renderer index modules.
- Exact sidecar field names and JSDoc typedef names, provided the wire remains relay-transparent and downstream docs are clear.
- Exact public method names for node resolution/highlighting, provided the handle supports live-element-to-nid on capture and nid-to-highlight/rect on viewer.
- Whether to keep a deprecated `NID_ATTR` export for transition documentation. Framework internals should not depend on it after Phase 7.
- Exact diagnostic field names for stale addressing misses, provided they are content-free.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase Scope
- `.planning/ROADMAP.md` - Phase 7 goal, dependency on Phase 6, and success criteria.
- `.planning/REQUIREMENTS.md` - CAPT-07 and VIEW-03 requirement definitions and traceability.
- `.planning/PROJECT.md` - project constraints: plain JS ESM, no runtime build step, FSB compatibility where practical, security posture, and performance lessons.
- `.planning/STATE.md` - current project state and carried-forward concerns.

### Prior Phase Decisions
- `.planning/phases/04-relay-ws-transport-two-tab-demo/04-CONTEXT.md` - raw relay, endpoint-owned behavior, viewer health/state, and local demo constraints.
- `.planning/phases/05-playwright-cdp-adapter-remote-control-agent-demo/05-CONTEXT.md` - host-owned remote-control authorization, viewer geometry helpers, and adapter boundaries.
- `.planning/phases/06-extension-mv3-bookmarklet-adapters/06-CONTEXT.md` - adapter surfaces, no-build injected artifact precedent, and all-adapter verification expectations.

### Architecture And Design History
- `docs/ARCHITECTURE.md` - node identity, diff addressing, renderer querySelector hot path, and inherited limitation #3.
- `docs/DESIGN-HISTORY.md` - performance lessons, especially batched layout reads and "identity beats ordering."
- `.planning/codebase/CONCERNS.md` - node identity mutation concern and querySelector performance bottleneck.
- `.planning/codebase/ARCHITECTURE.md` - system pipeline, current identity behavior, and target framework architecture.
- `.planning/codebase/STACK.md` - plain JS ESM, package exports, and no-bundler constraints.
- `.planning/codebase/INTEGRATIONS.md` - browser runtime boundaries and adapter constraints.

### Current Framework Code
- `src/protocol/messages.js` - current `NID_ATTR`, `DIFF_OP`, `STREAM`, `CONTROL`, and `REMOTE_CONTROL` definitions.
- `src/capture/index.js` - current live-page identity stamping, snapshot traversal, added-node processing, mutation diff generation, masking/sanitization, and lifecycle.
- `src/capture/README.md` - capture factory, lifecycle, transport, masking, and pending behavioral changes.
- `src/renderer/diff.js` - current per-op selector-based diff applier and resync thresholds.
- `src/renderer/index.js` - viewer handle, snapshot handling, overlay resolver, state/health events, and existing `getViewportMapping`.
- `src/renderer/overlays.js` - overlay registry and nid-anchored rect resolution contract.
- `src/renderer/README.md` - viewer handle contract, overlay channel contract, and documented Phase 7 querySelector replacement.
- `src/adapters/playwright.js` - adapter boundary and remote-control replay precedent.
- `src/adapters/extension.js` - extension adapter surface that must keep working after identity migration.
- `src/adapters/bookmarklet.js` - bookmarklet adapter surface that must keep working after identity migration.

### Tests And Oracle
- `tests/differential/oracle.test.js` - differential oracle entry point.
- `tests/differential/normalize.js` - current nid normalization policy and likely place for narrow identity-attribute normalization.
- `tests/differential/divergence-ledger.js` - intentional divergence registry to update for identity markup removal.
- `tests/capture-skip.test.js` - skipped subtree identity assumptions.
- `tests/security-mask.test.js` - block placeholder and masking identity assumptions.
- `tests/renderer-diff.test.js` - diff applier behavior and stale-miss tests.
- `tests/renderer-overlays.test.js` - nid-anchored overlay behavior.
- `tests/renderer-remote-control.test.js` - viewer geometry and remote-control-adjacent renderer behavior.
- `tests/renderer-loopback.test.js` - end-to-end capture/viewer loopback behavior.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `createCapture` in `src/capture/index.js`: owns the capture lifecycle and is the natural home for the capture-side identity mirror and `getNodeId` API.
- `createViewer` in `src/renderer/index.js`: owns active stream identity, iframe lifecycle, overlay reset, and host-facing APIs; it should own viewer-side resolving and highlighting.
- `applyMutations` in `src/renderer/diff.js`: already centralizes stale-miss counters and resync thresholds; refactor it to accept/use a resolver or index rather than querying the document.
- `createOverlays` in `src/renderer/overlays.js`: provides the host-document overlay layer that can support a local viewer highlight without using the capture overlay side channel.
- Differential oracle in `tests/differential/`: keeps identity migration honest by proving op-stream equivalence except for the deliberate removal of framework-owned identity markup.

### Established Patterns
- Public APIs use named ESM exports, explicit `.js` imports, JSDoc typedefs, and factory-time validation as the only normal throwing path.
- Runtime stream errors are contained to logger/event surfaces and resync requests; they should not throw through capture or renderer loops.
- Relay stays raw and transport-agnostic. Identity migration belongs to capture, renderer, protocol docs/tests, and adapters only where they consume public APIs.
- Health and diagnostic data is content-free. Do not add mirrored HTML/text/attributes to telemetry.
- Browser-injected code must remain build-free and dependency-light.
- Security chokepoints stay load-bearing: capture sanitizes before transport, renderer sanitizes before mirror insertion, and the sandbox remains no-scripts.

### Integration Points
- `src/protocol/messages.js` may need new typedefs/constants for identity sidecars while preserving existing message type strings and diff field names.
- `src/capture/index.js` must replace live-attribute reads/writes in `assignNodeId`, truncation prepass, `processAddedNode`, childList removal/addition, attr ops, and text ops.
- `src/renderer/index.js` must build and reset the renderer identity index around snapshot loads and route overlay/API resolution through it.
- `src/renderer/diff.js` must update the index while applying add/remove ops and avoid direct selector resolution.
- Existing tests using `NID_ATTR` as proof of identity need migration to sidecar/API assertions.
- Adapter demos and tests consume capture/viewer surfaces; they need focused regression runs even if their public behavior does not change.

</code_context>

<specifics>
## Specific Ideas

- Treat Phase 7 as a compatibility-preserving identity migration: same opaque nid wire concept, no relay changes, no new remote-control semantics, and no visible product UI.
- The sidecar metadata approach is preferred over keeping identity in mirror DOM attributes because it satisfies the "no observed page mutation" goal and enables the renderer's `Map<nid, Node>` without a selector hot path.
- The first semantic addressing surface should be practical and small: host maps known live elements to nids, viewer resolves/highlights nids. A selector or accessibility-query engine can be layered later by hosts or future phases.
- The strongest proof is negative: a page should not be able to detect PhantomStream identity through attributes, MutationObserver records, or CSS selectors.

</specifics>

<deferred>
## Deferred Ideas

- Full selector, locator, or accessibility-tree query language for semantic addressing - future API layer, not Phase 7.
- Shadow-root, iframe, and cross-document identity semantics - Phase 8.
- Added-node computed style capture - Phase 8.
- On-demand subtree fetch and truncated-region recovery - Phase 8.
- CSSOM stylesheet-centric identity/style protocol interactions - Phase 9.
- Protocol-version hardening for FSB 1.0 compatibility bypasses - Phase 11 unless Phase 7 research proves it is required earlier.

</deferred>

---

*Phase: 07-weakmap-node-identity-semantic-addressing-api*
*Context gathered: 2026-06-15T08:57:54-05:00*
