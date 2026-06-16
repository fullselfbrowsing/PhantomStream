# Phase 7 Pattern Map

**Phase:** 07 - WeakMap Node Identity + Semantic Addressing API
**Date:** 2026-06-15

## Closest Existing Patterns

| New Work | Existing Analog | Reuse Pattern |
|----------|-----------------|---------------|
| Capture identity mirror | `createCapture` closure state in `src/capture/index.js` | Keep state inside factory closure; no module-top window/document reads. |
| Sidecar typedefs | `SnapshotPayload` and `DIFF_OP` in `src/protocol/messages.js` | Extend JSDoc typedefs without changing message type strings. |
| Renderer identity index | Viewer state in `src/renderer/index.js` | Own lifecycle state in `createViewer`; reset on snapshot/destroy. |
| Diff resolver hooks | `applyMutations(..., hooks)` in `src/renderer/diff.js` | Inject logger/resync/sanitizer/index hooks instead of coupling to viewer. |
| Local highlight overlay | `createOverlays` in `src/renderer/overlays.js` | Render in host-document overlay layer; use text-free/HTML-free DOM updates. |
| Public handle expansion | `getViewportMapping()` from Phase 5 | Return cloned geometry, not mutable internal objects. |
| Static safety gates | `tests/security-chokepoint-purity.test.js` | Read source files and assert forbidden patterns are absent. |
| Oracle divergence | `tests/differential/divergence-ledger.js` | Ledger intentional behavior change and keep normalizer narrow. |

## File-Level Guidance

### `src/capture/index.js`

Current identity hotspots:

- `assignNodeId(original, clone)`
- snapshot traversal and blocked placeholders
- truncation prepass
- `processAddedNode`
- childList added/removed logic
- attr and characterData branches

Use local helper functions instead of scattering WeakMap access. Required helper
behaviors:

- `ensureNodeId(element)` mints once and reuses on moves.
- `getNodeId(element)` returns `null` when the element is not tracked.
- sidecar building walks the final serialized clone tree in element preorder.

### `src/protocol/messages.js`

Do not rename `STREAM`, `CONTROL`, `REMOTE_CONTROL`, or `DIFF_OP` values. Add
JSDoc for:

- `SnapshotPayload.nodeIds`
- `DiffOp add.nodeIds`
- `NodeIdentityRef` if the implementation wants a named typedef.

Prefer removing `NID_ATTR` from framework internals. If exported for
transition, tests must prove capture/renderer internals no longer import it.

### `src/renderer/index.js`

Own the index lifecycle:

- reset after every accepted snapshot
- clear on destroy
- pass resolver/index hooks to `applyMutations`
- route overlay `resolveNidRect` through the index
- expose public resolve/highlight methods on the viewer handle

Follow `getViewportMapping()` precedent: return cloned values and do not expose
mutable maps.

### `src/renderer/diff.js`

Keep the diff applier pure and document-parameterized. Replace local
`selectByNid` with an injected resolver:

```js
var identity = opts.identity || {};
var resolve = typeof identity.resolve === 'function' ? identity.resolve : function () { return null; };
```

Add/remove paths call `identity.indexSubtree(imported, m.nodeIds)` and
`identity.removeSubtree(el)` when hooks exist.

### Tests

Add focused new tests instead of only changing existing assertions:

- `tests/capture-identity.test.js`
- `tests/semantic-addressing.test.js`
- `tests/node-identity-static.test.js`

Then migrate existing identity-dependent tests:

- `tests/capture-skip.test.js`
- `tests/security-mask.test.js`
- `tests/renderer-diff.test.js`
- `tests/renderer-overlays.test.js`
- `tests/renderer-loopback.test.js`

## Non-Patterns To Avoid

- Do not keep `data-fsb-nid` in mirror DOM as the new primary identity model.
- Do not add a selector or accessibility locator engine in Phase 7.
- Do not put identity state in relay, transport, or adapter storage.
- Do not expose `Map<nid, Node>` directly to hosts.
- Do not use querySelector as the normal renderer nid resolution path.

## PATTERN MAPPING COMPLETE

