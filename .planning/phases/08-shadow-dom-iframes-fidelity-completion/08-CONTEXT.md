# Phase 8: Shadow DOM, Iframes & Fidelity Completion - Context

**Gathered:** 2026-06-15T17:18:34Z
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 8 closes the remaining v1 fidelity gaps that still make modern pages drift after the Phase 7 identity migration: open shadow roots, iframe content policy, live form value changes, computed styles for late-added nodes, and on-demand recovery for truncated regions.

This phase is not CSSOM capture mode, npm publishing, FSB swap-in, or the paper evaluation harness. Phase 9 owns stylesheet-centric capture. Phase 8 may define protocol hooks that Phase 9 later reuses, but it should keep its implementation focused on the five roadmap success criteria.

</domain>

<decisions>
## Implementation Decisions

### Discussion Mode
- **D-01 [informational]:** Auto-mode selected all meaningful gray areas and chose conservative defaults without interactive questions.
- **D-02 [informational]:** These are planning defaults. If research finds a concrete blocker, the planner must surface the deviation explicitly rather than silently changing scope.

### Shadow DOM Fidelity
- **D-03:** Support open shadow roots first. Closed shadow roots are not introspectable and should be represented as content-free placeholders or left as host elements with diagnostics, not faked.
- **D-04:** Serialize shadow content as structured metadata tied to the host element's nid, not by flattening it into light DOM HTML. The viewer should reconstruct real shadow roots where the browser permits it.
- **D-05:** Preserve slot semantics. Slotted light-DOM children must remain owned by the light DOM and must not be duplicated into shadow content. Tests should cover default slots, named slots, and slot reassignment.
- **D-06:** Shadow-root addressing extends the Phase 7 nid model. Shadow descendants receive opaque nids in sidecars/indexes, and renderer resolution uses the same private identity index rather than selector fallbacks.
- **D-07:** Shadow mutations should stream as explicit shadow-aware ops or add-op metadata. Do not rely on ordinary `document.body` MutationObserver coverage to catch changes inside shadow roots; attach observers or traversal hooks deliberately.

### Iframe Policy
- **D-08:** Same-origin iframes are in scope for mirroring. Capture should serialize accessible iframe documents with their own identity/style data and enough frame metadata for the viewer to reconstruct them.
- **D-09:** Cross-origin iframes remain out of scope for content mirroring. They should render as labeled placeholders with safe dimensions/origin metadata only; no attempt to bypass browser origin policy.
- **D-10:** Iframe mirroring should preserve the no-scripts viewer sandbox boundary. Reconstructed iframe content must be inert mirrored DOM, not live remote documents.
- **D-11:** Frame identity should compose with stream/session identity and Phase 7 nids. Downstream planning should avoid a global selector-like addressing scheme; use frame-aware opaque ids or scoped sidecars.

### Live Form Values
- **D-12:** Add explicit input/change-event capture for form controls whose live value changes without attribute mutations. MutationObserver alone is insufficient.
- **D-13:** Cover at least `input`, `textarea`, and `select`; include checkbox/radio checked state and selected option state where tests show current drift.
- **D-14:** Route every value-bearing form update through existing masking/privacy chokepoints. Password values remain always masked, and `maskInputs`/`maskInputFn` semantics apply to event-driven value diffs exactly as they do for snapshot/attr paths.
- **D-15:** Prefer a narrow value diff op or well-documented attr/text extension over ad hoc full-node replacement. Preserve content-free diagnostics and avoid leaking typed text into health telemetry.

### Late-Added Computed Styles
- **D-16:** Add ops for new elements should carry computed styles consistent with snapshot-era siblings. Use the existing curated property list and default elision unless research proves a smaller sidecar is safer.
- **D-17:** Preserve the performance lesson: batch style/layout reads before clone mutation, with no per-node forced reflow loop. Tests should include a regression that style capture happens without broad all-property enumeration.
- **D-18:** Phase 8 should not implement full CSSOM stylesheet-centric capture. If late-added style support exposes a protocol seam useful to Phase 9, document it, but keep Phase 8 to computed styles for added nodes.

### Truncated Subtree Recovery
- **D-19:** Add an on-demand subtree fetch path for truncated regions instead of waiting for a full snapshot. The viewer should request a specific missing/truncated nid or placeholder, and capture should return a sanitized subtree payload with `nodeIds`.
- **D-20:** Subtree fetch must preserve streamSessionId/snapshotId staleness checks and should be ignored softly if the requested live node is gone, skipped, blocked, or no longer tracked.
- **D-21:** Fetch responses must use the same sanitization, masking, URL absolutification, style, and identity sidecar rules as snapshot/add serialization. Do not create a second serialization policy.
- **D-22:** Keep recovery bounded. Avoid automatic cascading fetch storms; a host or viewer may request a subtree, but planning should include request throttling/latching and clear stale-miss behavior.

### Verification Shape
- **D-23:** Add focused fixtures for each fidelity gap: open shadow root + slots, same-origin iframe, cross-origin iframe placeholder, input value drift, late-added styled node, and truncated-region fetch.
- **D-24:** Keep the differential oracle honest. Any intentional divergence from the FSB reference should be ledgered narrowly, especially for shadow/iframe protocol extensions and value diffs.
- **D-25:** Run full capture/renderer/security/adapter tests after the phase. Phase 8 touches capture serialization, renderer reconstruction, protocol shape, and adapter-injected artifacts.

### the agent's Discretion
- Exact wire field names for shadow roots, frame payloads, value diffs, and subtree fetch responses.
- Whether subtree fetch is modeled as a new `CONTROL.*` request plus `STREAM.*` response or as a mutation-family extension, provided staleness checks and relay transparency remain intact.
- Exact iframe placeholder copy/metadata, provided it is content-free and does not imply cross-origin content was captured.
- Exact module split, as long as existing single-file capture constraints and renderer seams stay manageable.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase Scope
- `.planning/ROADMAP.md` - Phase 8 goal, dependency on Phase 7, and five success criteria.
- `.planning/REQUIREMENTS.md` - CAPT-05, CAPT-06, CAPT-08, CAPT-09, and CAPT-11 requirement definitions.
- `.planning/PROJECT.md` - current validated requirements, active v1 limitations, and project constraints.
- `.planning/STATE.md` - current project state, Phase 8 concern, and deferred Phase 6 UAT debt.

### Prior Phase Decisions
- `.planning/phases/07-weakmap-node-identity-semantic-addressing-api/07-CONTEXT.md` - WeakMap identity, sidecar addressing, renderer Map index, and semantic API constraints.
- `.planning/phases/07-weakmap-node-identity-semantic-addressing-api/07-VERIFICATION.md` - verified Phase 7 implementation facts and review-fix closure.
- `.planning/phases/06-extension-mv3-bookmarklet-adapters/06-CONTEXT.md` - browser artifact/no-build constraints and adapter verification expectations.
- `.planning/phases/05-playwright-cdp-adapter-remote-control-agent-demo/05-CONTEXT.md` - host-owned remote-control boundary and adapter injected-artifact precedent.

### Architecture And Design History
- `docs/ARCHITECTURE.md` - current identity model, known limitations, truncation budget, iframe behavior, computed-style design, and renderer reconstruction.
- `docs/DESIGN-HISTORY.md` - performance lessons: curated styles, batched layout reads, paint-cadence diffs, whole-subtree truncation, identity over ordering.
- `docs/SECURITY.md` - capture/renderer sanitizer and sandbox contract.
- `.planning/codebase/ARCHITECTURE.md` - pipeline overview and reference implementation lineage.
- `.planning/codebase/STRUCTURE.md` - package/module layout and test organization.
- `.planning/codebase/CONCERNS.md` - historical fidelity gaps, style performance risks, truncation recovery concern, and reference limitations.

### Current Framework Code
- `src/capture/index.js` - serialization, WeakMap identity, masking/sanitization, computed style list, truncation, mutation batching, and input masking residual note.
- `src/capture/README.md` - capture lifecycle, node identity contract, masking behavior, and queued Phase 8 late-added style work.
- `src/protocol/messages.js` - message namespaces, diff op contracts, identity/session helpers, and typedefs to extend.
- `src/renderer/index.js` - snapshot handling, iframe sandbox, identity index, semantic APIs, overlay resolver, resync behavior.
- `src/renderer/diff.js` - diff applier, identity hooks, stale miss/apply failure handling, add/remove index updates.
- `src/renderer/snapshot.js` - srcdoc builder, CSP meta, shell attrs/styles, stylesheet/inline CSS handling.
- `src/renderer/README.md` - viewer handle, identity index, overlay contract, sandbox/jsdom constraints.
- `src/adapters/playwright-inject.js` - checked-in classic script that must stay synchronized with capture changes.

### Tests And Fixtures
- `tests/capture-identity.test.js` - no live identity mutation, `nodeIds`, move preservation, and `getNodeId`.
- `tests/renderer-diff.test.js` - indexed diff application and stale-miss behavior.
- `tests/renderer-loopback.test.js` - end-to-end capture/viewer behavior and resync paths.
- `tests/security-mask.test.js` - privacy masking and blocked placeholders.
- `tests/security-sanitize-capture.test.js` - capture sanitizer contract.
- `tests/security-sanitize-render.test.js` - renderer sanitizer contract.
- `tests/differential/oracle.test.js` - reference/extracted stream comparison entry point.
- `tests/differential/normalize.js` - allowed normalization rules.
- `tests/differential/divergence-ledger.js` - intentional divergence registry.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `CURATED_PROPS`, `STYLE_DEFAULTS`, `captureComputedStyles`, and snapshot traversal in `src/capture/index.js` are the starting point for late-added computed styles.
- `sanitizeForWire` in `src/capture/index.js` is the required chokepoint for shadow, iframe, input, and subtree-fetch payloads.
- Phase 7 `WeakMap<Element, string>` and `nodeIds` sidecars in `src/capture/index.js` provide the identity model to extend into shadow roots and frames.
- `createViewer` identity hooks and `nidToNode` index in `src/renderer/index.js` are the renderer-side integration point for shadow/frame/subtree identities.
- `applyMutations` in `src/renderer/diff.js` already owns stale-miss accounting and can host new diff/fetch application behavior.
- `buildSnapshotHtml` in `src/renderer/snapshot.js` centralizes srcdoc assembly, CSP, stylesheet links, inline style scrubbing, and shell attrs/styles.
- Existing security tests cover sanitizer/masking invariants that Phase 8 must reuse rather than bypass.

### Established Patterns
- Runtime misses fail softly and request resync when thresholds are hit; factory-time validation is the normal throwing boundary.
- Relay remains raw; new Phase 8 protocol messages must still be endpoint-owned and independently decodable.
- Diagnostics and health telemetry stay content-free.
- Browser-injected artifacts are checked in as classic scripts and must remain ESM-free.
- Tests use `node:test`, jsdom, focused fixtures, and exact static greps for regression gates.
- Security chokepoints run before renderer indexing; any newly inserted node must be sanitized before it becomes addressable.

### Integration Points
- `src/protocol/messages.js` likely needs new typedefs and constants for shadow metadata, frame metadata, value diffs, and subtree fetch request/response messages.
- `src/capture/index.js` needs traversal/observer extensions for open shadow roots, same-origin frames, input/change events, late-added style collection, and subtree serialization.
- `src/renderer/index.js` needs reconstruction support for shadow roots/frames, new fetch response routing, and identity index updates across those boundaries.
- `src/renderer/diff.js` needs to apply value diffs and any new structured shadow/frame/subtree ops without losing stale-miss behavior.
- `src/adapters/playwright-inject.js` must be regenerated or patched whenever capture core behavior changes.

</code_context>

<specifics>
## Specific Ideas

- Treat Phase 8 as fidelity completion over the Phase 7 identity contract, not a replacement of that contract.
- Prefer explicit structured protocol metadata over flattening complex browser constructs into ordinary HTML strings.
- Same-origin iframes and open shadow roots should be represented faithfully; cross-origin and closed-root content should be honest placeholders.
- Event-driven input value diffs are mandatory because MutationObserver cannot see property-only value changes.
- Subtree fetch should be a controlled recovery mechanism, not an automatic infinite retry loop.

</specifics>

<deferred>
## Deferred Ideas

- Full stylesheet-centric CSSOM capture and adopted stylesheet protocol - Phase 9.
- Cross-origin iframe content mirroring or browser security bypasses - out of v1 scope.
- Closed shadow root introspection - impossible without page/component cooperation; document as limitation or placeholder behavior.
- Media stream mirroring for `<video>`/`<audio>` - still outside Phase 8 unless research finds a low-risk placeholder-only update.
- Public selector/accessibility query language over semantic identity - future API layer after Phase 8 if needed.

</deferred>

---

*Phase: 08-shadow-dom-iframes-fidelity-completion*
*Context gathered: 2026-06-15T17:18:34Z*
