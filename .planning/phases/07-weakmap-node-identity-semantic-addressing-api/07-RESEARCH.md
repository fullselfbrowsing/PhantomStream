# Phase 7 Research: WeakMap Node Identity + Semantic Addressing API

**Phase:** 07 - WeakMap Node Identity + Semantic Addressing API
**Status:** Complete
**Date:** 2026-06-15

## Research Goal

Plan the identity migration without weakening the core PhantomStream contract:
the live page stops receiving framework-owned identity attributes, while wire
ops, overlays, remote-control geometry, and resync behavior remain nid based.

## Current State

### Capture identity is attribute-backed

`src/capture/index.js` currently uses `assignNodeId(original, clone)` to write
`NID_ATTR` to both live elements and serialized clone elements. Later capture
paths read the live attribute for:

- snapshot truncation top lookups
- childList `parentNid` and `beforeNid`
- removed-node `nid`
- attribute mutation `nid`
- text mutation parent `nid`
- block placeholders

The migration has to replace every identity read/write at once. Partial
migration would produce untracked mutations or wire ops whose parents cannot be
resolved.

### Renderer identity is selector-backed

`src/renderer/diff.js` resolves every op with:

```js
doc.querySelector('[' + NID_ATTR + '="' + nid + '"]')
```

`src/renderer/index.js` also resolves overlay anchors through a fresh
`contentDocument.querySelector(...)`. Phase 7 should make both paths use the
same internal `Map<nid, Node>` index.

### Existing wire contract can survive

The message types and diff op field names do not need to change. The best
migration keeps:

- `op: 'add'`, `parentNid`, `beforeNid`, `nid`
- `STREAM.SNAPSHOT`
- `STREAM.MUTATIONS`
- overlay payloads with `nid`
- remote-control coordinate semantics from Phase 5

The new piece is identity sidecar metadata for snapshots and add ops so the
renderer can build an index without DOM attributes.

## Recommended Architecture

### Capture-side node mirror

Use a closure-local identity mirror inside `createCapture`:

```js
var elementToNid = new WeakMap();
var nidToElement = new Map();
var nextNodeId = 1;

function ensureNodeId(element) -> string
function getNodeId(element) -> string|null
function clearNodeMirror() -> void
function forgetNodeId(nid) -> void
```

WeakMap keeps page elements from being held alive solely by identity. The
reverse map is still needed for lifecycle/debug and host-facing resolution, but
remove handling should delete entries for removed subtrees when they are truly
not reinserted.

Move preservation requires `ensureNodeId(element)` to reuse an existing WeakMap
entry. A childList batch can still emit `rm` plus `add`, but the added subtree
must carry the original nids in its sidecar.

### Identity sidecars

Use concrete sidecar fields:

```js
SnapshotPayload.nodeIds: string[]
DiffOp add.nodeIds: string[]
```

`nodeIds` order is element preorder over the serialized `html` fragment:

- For a snapshot, walk the parsed/serialized body descendants in document order.
- For an add op, walk the added subtree root and descendants in document order.
- Skipped, dropped, and blocked-descendant nodes do not receive entries.
- Blocked roots still receive an id because their placeholder remains
  addressable.

This keeps the HTML clean and lets the renderer pair `nodeIds[i]` with the
`i`th parsed element. The exact field can evolve later, but this concrete shape
is sufficient and easy to validate.

### Renderer-side index

Maintain an internal index in `createViewer`:

```js
var nidToNode = new Map();
var nodeToNid = new WeakMap();
```

Required operations:

- `resetIdentityIndex(doc, nodeIds)` after snapshot load
- `resolveIndexedNode(nid)` for diff, overlay, and API lookup
- `indexSubtree(root, nodeIds)` after sanitized add-op import
- `removeSubtree(root)` before remove-op deletion

`applyMutations` should receive index hooks rather than own the index. That
keeps `diff.js` document-parameterized and testable while removing the
selector hot path.

### Public API

Keep the first public surface small:

Capture handle:

```js
getNodeId(element) -> string|null
```

Viewer handle:

```js
resolveNode(nid) -> { nid, exists, rect, streamSessionId, snapshotId }|null
highlightNode(nid, options) -> boolean
clearHighlight() -> void
```

These names are intentionally concrete for planning. If implementation finds a
local naming conflict, equivalent names are acceptable only if the docs and
tests expose the same behaviors.

The API should not expose mirrored text, HTML, attributes, or payloads by
default. Geometry and identity status are enough for "highlight the node an
agent is about to touch."

## Risks And Mitigations

### Risk: sidecar and HTML order drift

If sanitization drops nodes after `nodeIds` are computed, the renderer pairs
the wrong ids with nodes.

Mitigation: compute sidecars after the final sanitized/truncated clone is
known, or keep clone-element identity in a WeakMap and build `nodeIds` from
the final serialized clone tree.

### Risk: move batches delete the id before re-add

MutationObserver can report a move as removal plus insertion.

Mitigation: process the whole childList batch with `ensureNodeId` reuse. Do not
forget removed subtree ids until the batch has processed additions, or delete
only after verifying nodes are not still connected/reinserted.

### Risk: tests mistake page-owned attributes for framework identity

Pages can already contain `data-fsb-nid`.

Mitigation: negative tests should use fixtures without that attribute and
assert PhantomStream does not add one. The implementation must not treat
page-owned attributes as identity.

### Risk: injected classic artifact drifts

Phase 6 added checked-in browser inject artifacts. Capture changes must be
reflected there or extension/bookmarklet/Playwright paths will disagree.

Mitigation: final migration plan updates `src/adapters/playwright-inject.js`
and runs adapter/demo focused tests plus full `npm test`.

## Validation Architecture

Validation should sample every layer touched by identity:

- Capture unit tests prove no live-page identity attributes, no identity
  MutationObserver noise, `nodeIds` sidecars, move preservation, and
  `getNodeId(element)`.
- Renderer unit tests prove snapshot index build, add/remove index updates,
  stale-miss behavior, overlay anchor resolution through the index, and no
  identity querySelector hot path.
- Public API tests prove viewer `resolveNode`, `highlightNode`, and
  `clearHighlight` behavior without exposing content.
- Differential oracle updates prove raw diff op shapes and nid sequences remain
  equivalent except for intentional identity markup removal.
- Adapter regression tests prove the browser-injected artifact and all adapter
  surfaces still consume the changed capture/viewer contract.

Recommended command tiers:

```bash
node --test tests/capture-identity.test.js tests/renderer-diff.test.js tests/renderer-overlays.test.js tests/semantic-addressing.test.js
node --test tests/differential/oracle.test.js tests/renderer-loopback.test.js tests/adapter-exports.test.js tests/playwright-adapter.test.js tests/extension-adapter.test.js tests/bookmarklet-adapter.test.js
npm test
```

## Planning Implications

Plan order should be:

1. Capture/protocol sidecar foundation.
2. Renderer index migration.
3. Public semantic addressing/highlight API.
4. Test, docs, inject artifact, and cross-adapter regression cleanup.

The phase should not add selector engines, accessibility locators, shadow-root
identity, iframe identity, CSSOM, or subtree fetch.

## RESEARCH COMPLETE

