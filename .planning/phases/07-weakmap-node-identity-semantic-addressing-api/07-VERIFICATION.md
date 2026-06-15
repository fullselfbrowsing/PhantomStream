---
phase: 07-weakmap-node-identity-semantic-addressing-api
verified: 2026-06-15T17:14:19Z
status: passed
score: "31/31 must-haves verified"
overrides_applied: 0
---

# Phase 7: WeakMap Node Identity + Semantic Addressing API Verification Report

**Phase Goal:** The observed page is no longer mutated by capture, and hosts can address mirrored elements semantically through a public API.
**Verified:** 2026-06-15T17:14:19Z
**Status:** passed
**Re-verification:** No - initial verification; no prior `*-VERIFICATION.md` existed.

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Roadmap SC1: zero `data-fsb-nid` attributes are written to the observed page; capture uses WeakMap identity with documented lifecycle and a grep gate | VERIFIED | `src/capture/index.js:586-587` uses `WeakMap`/`Map`; `start()` resets mirror and `nextNodeId` at `src/capture/index.js:2463-2466`; static gate `tests/node-identity-static.test.js:11-35` scans capture/renderer/adapter runtime files; `rg` gate returned no matches. |
| 2 | Roadmap SC2: wire-addressing contract is preserved and overlays/remote control still address by nid | VERIFIED | Diff ops keep `nid`, `parentNid`, `beforeNid` fields at `src/capture/index.js:2076-2091`, `2103-2105`, `2150-2177`, `2180-2190`; overlay nid anchors route through `resolveNidRect` in `src/renderer/overlays.js:383-388`; exact review gate passed 158 tests. |
| 3 | Roadmap SC3: host can query and highlight mirrored elements through public node-identity API | VERIFIED | Capture handle returns `getNodeId` at `src/capture/index.js:2530-2535`; viewer handle returns `resolveNode`, `highlightNode`, and `clearHighlight` at `src/renderer/index.js:994-1002`; semantic API tests cover lookup/highlight at `tests/semantic-addressing.test.js:145-229`. |
| 4 | Roadmap SC4: renderer resolves diff ops via incremental `Map<nid, Node>` and no per-op querySelector hot path remains | VERIFIED | Renderer owns `nidToNode = new Map()` and `nodeToNid = new WeakMap()` at `src/renderer/index.js:304-305`; diff receives identity hooks at `src/renderer/index.js:783-791` and `src/renderer/diff.js:91-101`; static gate forbids retired selector strings. |
| 5 | D-03: capture internals stop using framework-owned live-page identity attributes | VERIFIED | No `data-fsb-nid`/`NID_ATTR` matches in `src/capture/index.js`; identity assignment goes through `ensureNodeId()` at `src/capture/index.js:642-650`. |
| 6 | D-04: diff ops continue to carry opaque string `nid`, `parentNid`, and `beforeNid` fields | VERIFIED | `getTrackedNodeId()` returns mirror ids from string `nextNodeId`; add/rm/attr/text ops carry these fields at `src/capture/index.js:2076-2091`, `2103-2105`, `2150-2177`, `2180-2190`; protocol JSDoc documents `parentNid`, `beforeNid`, and `nodeIds` at `src/protocol/messages.js:56-88`. |
| 7 | D-05: capture identity is an internal WeakMap-based mirror with reverse lookup | VERIFIED | `elementToNid = new WeakMap()` and `nidToElement = new Map()` are closure-local at `src/capture/index.js:585-587`; reverse validation occurs in `getTrackedNodeId()` at `src/capture/index.js:656-662`. |
| 8 | D-06: fresh start resets identity mirror; resume continues same session | VERIFIED | `start()` calls `beginStreamSession()`, `clearNodeMirror()`, and `nextNodeId = 1` at `src/capture/index.js:2463-2466`; `resume()` only restarts observers/scroll tracker at `src/capture/index.js:2507-2512`. |
| 9 | D-07: moved live elements reuse existing nids | VERIFIED | `ensureNodeId()` returns existing WeakMap id before minting at `src/capture/index.js:642-649`; move coverage asserts original nid is reused at `tests/capture-identity.test.js:231-257`. |
| 10 | D-08: snapshot and add-op identity travels through structured `nodeIds` sidecars | VERIFIED | Snapshot returns `nodeIds` at `src/capture/index.js:1905-1908`; add payload returns `nodeIds` at `src/capture/index.js:2014-2017`; tests assert preorder sidecars at `tests/capture-identity.test.js:186-225`. |
| 11 | D-09: oracle divergence is limited to identity markup removal | VERIFIED | `normalizeIdentitySidecarPayloadPair()` removes reference identity attrs only when extracted `nodeIds` exactly match at `tests/differential/normalize.js:156-175`; ledger D8 documents the constrained mapping at `tests/differential/divergence-ledger.js:321-335`. |
| 12 | D-10: page-owned `data-fsb-nid` attributes are ordinary page data, not PhantomStream identity | VERIFIED | Test fixture preserves `data-fsb-nid="page-owned"` while `getNodeId()` returns a distinct internal string at `tests/capture-identity.test.js:122-135`. |
| 13 | D-11: public addressing centers on an opaque nid reference | VERIFIED | Viewer API takes `nid` as string/number and stringifies it without selector interpretation at `src/renderer/index.js:670-678`; capture API returns opaque strings only. |
| 14 | D-12: capture exposes trusted live Element to nid lookup | VERIFIED | `getNodeId(element)` validates active stream, live Element, and connection before returning tracked nid at `src/capture/index.js:2514-2519`. |
| 15 | D-13: viewer exposes resolve and highlight by nid | VERIFIED | `resolveNode()` implemented at `src/renderer/index.js:670-693`; `highlightNode()` at `src/renderer/index.js:715-735`; exposed on handle at `src/renderer/index.js:994-1002`. |
| 16 | D-14: viewer highlighting is local renderer behavior, not `STREAM.OVERLAY` | VERIFIED | `highlightNode()` writes host DOM only; test asserts no `STREAM.OVERLAY` send at `tests/semantic-addressing.test.js:213-218`. |
| 17 | D-15: semantic API exposes geometry and identity status by default, not page content | VERIFIED | `resolveNode()` returns only `nid`, `exists`, `rect`, `streamSessionId`, `snapshotId` at `src/renderer/index.js:677-688`; tests assert no html/text/attrs/payload/url/title at `tests/semantic-addressing.test.js:197-210`. |
| 18 | D-16: stale or missing nids fail softly | VERIFIED | `resolveNode()` returns `null` on missing ids or errors at `src/renderer/index.js:670-692`; `highlightNode()` returns `false` for unresolved ids at `src/renderer/index.js:715-718`; tests cover missing ids at `tests/semantic-addressing.test.js:228-229`. |
| 19 | D-17: renderer diff application uses an internal `Map<nid, Node>` index | VERIFIED | Renderer identity map is created at `src/renderer/index.js:304`; `resolveIndexedNode()` resolves via `nidToNode.get(String(nid))` at `src/renderer/index.js:622-625`; diff uses injected `identity.resolve`. |
| 20 | D-18: renderer index rebuilds on accepted snapshots | VERIFIED | Snapshot handler stores payload and clears old index at `src/renderer/index.js:748-766`; iframe load listener sanitizes then calls `resetIdentityIndex(scrubDoc, lastSnapshotPayload.nodeIds || [])` at `src/renderer/index.js:222-229`. |
| 21 | D-19: add/remove ops update the renderer index incrementally | VERIFIED | Diff add calls `indexSubtree(imported, m.nodeIds || [])` at `src/renderer/diff.js:154-162`; remove calls `removeSubtree(el)` before removal at `src/renderer/diff.js:164-171`; renderer cleanup is implemented at `src/renderer/index.js:627-637`. |
| 22 | D-20: overlay anchor resolution uses the same renderer index | VERIFIED | Overlay context receives `resolveNidRect` from viewer and `resolveAnchorRect()` calls `ctx.resolveNidRect(value.nid)` at `src/renderer/overlays.js:383-388`; `resolveNidRect()` calls `resolveIndexedNode()` at `src/renderer/index.js:657-661`. |
| 23 | D-21: sanitization happens before indexing imported nodes | VERIFIED | Snapshot load listener calls `sanitizeFragment(scrubDoc.body, ...)` before `resetIdentityIndex()` at `src/renderer/index.js:222-229`; diff add parses, sanitizes `tpl.content`, imports, inserts, then indexes at `src/renderer/diff.js:131-162`. |
| 24 | D-22: Phase 5 remote-control coordinate mapping and authorization boundaries remain unchanged | VERIFIED | Semantic tests assert renderer semantic code does not introduce remote-control UI/authorization strings at `tests/semantic-addressing.test.js:235-245`; existing remote-control mapping tests pass in the 158-test gate. |
| 25 | D-23: tests prove the observed page is not mutated by identity tracking | VERIFIED | MutationObserver test verifies no observed `data-fsb-nid` attribute writes at `tests/capture-identity.test.js:96-116`; static source gate covers runtime files. |
| 26 | D-24: existing `NID_ATTR` assertions migrate to sidecar/API assertions | VERIFIED | Runtime static gate forbids `NID_ATTR` in capture/renderer/adapter files at `tests/node-identity-static.test.js:19-35`; renderer/capture tests use `nodeIds` and `getNodeId` fixtures. |
| 27 | D-25: moved live elements keep their nid and remain renderer-addressable after ops apply | VERIFIED | Capture move preservation covered at `tests/capture-identity.test.js:231-257`; renderer diff indexed add/rm behavior covered at `tests/renderer-diff.test.js:141-160` and `259-272`. |
| 28 | D-26: regression gate fails if identity querySelector hot paths return | VERIFIED | `tests/node-identity-static.test.js:19-35` forbids `data-fsb-nid`, `NID_ATTR`, and `"querySelector('[' + NID_ATTR"` across runtime identity files; direct `rg` check produced no matches. |
| 29 | D-27: adapter and demo-relevant test surfaces run after migration | VERIFIED | Adapter-focused command passed 22 tests across Playwright, extension, bookmarklet, and exports; exact review gate passed 158 tests. |
| 30 | Phase 7 grep gate enforces no nid-attribute identity strings in `src/capture` or `src/renderer` | VERIFIED | `rg -n "data-fsb-nid|NID_ATTR|querySelector\\('\\[' \\+ NID_ATTR" src/capture/index.js src/renderer/index.js src/renderer/diff.js src/renderer/overlays.js` returned no matches. |
| 31 | Code-review fixes are present and re-reviewed clean | VERIFIED | Fix commit `e638d3f` updates Playwright injection API, docs, and static gate; `07-REVIEW.md` reports CR-01/WR-01/WR-02 resolved and clean status after re-review. |

**Score:** 31/31 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/capture/index.js` | WeakMap-backed capture identity mirror and sidecars | VERIFIED | Exists, substantive; WeakMap/Map mirror, sidecar generation, lifecycle reset, and public `getNodeId` are implemented and wired. |
| `src/protocol/messages.js` | JSDoc wire contract for `nodeIds` and opaque nid diff fields | VERIFIED | `SnapshotPayload.nodeIds` and add-op `nodeIds` documented at lines 56-88; legacy `NID_ATTR` retained only in protocol compatibility docs, not runtime identity files. |
| `tests/capture-identity.test.js` | No live identity mutation, sidecars, move preservation, `getNodeId` | VERIFIED | 261-line substantive test file; focused run passed all capture identity tests. |
| `src/renderer/index.js` | Renderer identity index lifecycle and public semantic APIs | VERIFIED | Map/WeakMap index, snapshot rebuild, diff identity hooks, overlay resolver, `resolveNode`, `highlightNode`, `clearHighlight` all implemented and exposed. |
| `src/renderer/diff.js` | Diff applier resolves through injected identity hooks | VERIFIED | Uses `identity.resolve/indexSubtree/removeSubtree`; no selector fallback found. |
| `src/renderer/overlays.js` | Indexed overlay anchor resolution and highlight CSS | VERIFIED | Overlay anchor routes through `resolveNidRect`; `.ps-node-highlight` CSS is present. |
| `tests/node-identity-static.test.js` | Static regression gate against retired identity attributes/selectors | VERIFIED | Scans capture, adapter, renderer diff/index/overlays for forbidden identity strings. |
| `tests/renderer-diff.test.js` | Sidecar-only diff/index coverage | VERIFIED | Direct diff tests inject identity hooks and assert add/remove index updates. |
| `tests/semantic-addressing.test.js` | Public capture/viewer node identity API tests | VERIFIED | Covers capture lookup, viewer resolve/highlight/clear, content minimization, and no remote-control expansion. |
| `src/adapters/playwright-inject.js` | Classic checked-in inject artifact with capture-side semantic API | VERIFIED | Contains WeakMap/nodeIds capture code and exposes `window.__phantomStreamCapture` plus `window.__phantomStreamGetNodeId`; no ESM `import`/`export` syntax found by tests. |
| `tests/playwright-adapter.test.js` | Adapter semantic API and classic-script safety coverage | VERIFIED | Tests assert bridge globals, classic-script source, and `__phantomStreamGetNodeId()` behavior. |
| `src/capture/README.md`, `src/renderer/README.md`, `docs/ARCHITECTURE.md` | Public docs for identity model and APIs | VERIFIED | Docs describe WeakMap identity, `nodeIds`, `getNodeId`, renderer Map index, `resolveNode`, and `highlightNode`. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| Capture serialization | Wire snapshot sidecar | `serializeDOM()` -> `buildNodeIdSidecar()` | WIRED | `src/capture/index.js:1905-1908` attaches `nodeIds` to snapshots. |
| Capture added-node mutation | Wire add-op sidecar and opaque ids | `processAddedNode()` -> add diff object | WIRED | `src/capture/index.js:1959-2017` builds sidecars; `2076-2091` emits `parentNid`, `beforeNid`, and `nodeIds`. |
| Capture handle | Public live Element lookup | return object includes `getNodeId` | WIRED | `src/capture/index.js:2514-2535`. |
| Viewer snapshot handler | Renderer identity index | iframe load listener -> `resetIdentityIndex()` | WIRED | Sanitizes first, then indexes `lastSnapshotPayload.nodeIds` at `src/renderer/index.js:222-229`. |
| Viewer mutation handler | Diff applier identity hooks | `applyMutations(..., { identity })` | WIRED | `src/renderer/index.js:783-791` passes resolve/index/remove hooks. |
| Diff add/remove ops | Renderer index maintenance | `indexSubtree()` / `removeSubtree()` | WIRED | `src/renderer/diff.js:154-171`. |
| Overlays and semantic API | Shared renderer index | `resolveNidRect()` / `resolveIndexedNode()` | WIRED | Overlay anchors, `resolveNode`, and `highlightNode` all route through indexed resolution. |
| Playwright inject artifact | Capture-side semantic API | globals call `capture.getNodeId()` | WIRED | `src/adapters/playwright-inject.js:2578-2594`. |
| Review fix | Static gate and adapter tests | `e638d3f` + re-review | WIRED | Fix commit modified adapter, static gate, and tests; re-review is clean. |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `src/capture/index.js` | `nodeIds` | `ensureNodeId()` stores live Elements in `WeakMap`; `buildNodeIdSidecar()` reads clone-to-nid map | Yes | FLOWING |
| `src/capture/index.js` | diff `nid`/`parentNid`/`beforeNid` | `getTrackedNodeId()` from WeakMap/Map mirror | Yes | FLOWING |
| `src/renderer/index.js` | `nidToNode` / `nodeToNid` | Snapshot/add `nodeIds` sidecars paired with sanitized mirror elements | Yes | FLOWING |
| `src/renderer/diff.js` | node resolution for ops | Injected `identity.resolve()` from viewer | Yes | FLOWING |
| `src/renderer/overlays.js` | overlay anchor rect | `ctx.resolveNidRect()` from viewer index | Yes | FLOWING |
| `src/adapters/playwright-inject.js` | page-side `__phantomStreamGetNodeId()` result | Checked-in capture instance `getNodeId(element)` | Yes | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Focused Phase 7 identity/API behavior | `node --test tests/capture-identity.test.js tests/renderer-diff.test.js tests/node-identity-static.test.js tests/semantic-addressing.test.js tests/playwright-adapter.test.js` | 32 passed, 0 failed | PASS |
| Exact code-review regression gate | `node --test tests/adapter-exports.test.js tests/capture-identity.test.js tests/capture-skip.test.js tests/node-identity-static.test.js tests/playwright-adapter.test.js tests/renderer-diff.test.js tests/renderer-health-events.test.js tests/renderer-loopback.test.js tests/renderer-overlays.test.js tests/renderer-remote-control.test.js tests/renderer-viewer.test.js tests/security-mask.test.js tests/security-sanitize-capture.test.js tests/security-sanitize-render.test.js tests/semantic-addressing.test.js` | 158 passed, 0 failed | PASS |
| Adapter migration surfaces | `node --test tests/extension-adapter.test.js tests/bookmarklet-adapter.test.js tests/adapter-exports.test.js tests/playwright-adapter.test.js` | 22 passed, 0 failed | PASS |
| Retired runtime identity strings absent | `rg -n "data-fsb-nid|NID_ATTR|querySelector\\('\\[' \\+ NID_ATTR" src/capture/index.js src/renderer/index.js src/renderer/diff.js src/renderer/overlays.js` | no matches (`rg_exit=1`, expected for no matches) | PASS |
| Adapter classic-script safety and API | `tests/playwright-adapter.test.js` and `tests/adapter-exports.test.js` within the commands above | no `import`/`export`; bridge globals and `__phantomStreamGetNodeId` covered | PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| CAPT-07 | 07-01, 07-02, 07-03, 07-04 | Node identity is WeakMap-based; observed page is no longer mutated with `data-fsb-nid`; wire-addressing contract is preserved | SATISFIED | WeakMap/Map mirror, no runtime identity strings, sidecar snapshot/add payloads, opaque diff nid fields, oracle normalization, and adapter artifact all verified. |
| VIEW-03 | 07-01, 07-02, 07-03, 07-04 | Host can address mirrored elements semantically through public node-identity API | SATISFIED | `getNodeId`, `resolveNode`, `highlightNode`, and `clearHighlight` exist, are wired to live/indexed identity, and expose content-minimizing data. |

No orphaned Phase 7 requirements were found in `.planning/REQUIREMENTS.md`; Phase 7 maps only `CAPT-07` and `VIEW-03`.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/capture/index.js` / `src/adapters/playwright-inject.js` | selector-validation helper | `document.querySelector(raw)` | INFO | Not an identity hot path; used to validate host CSS selectors. |
| capture/renderer runtime files | multiple | `return null` | INFO | Expected soft-failure behavior for stale/missing ids and invalid inputs, covered by tests. |
| `src/protocol/messages.js` | 68-74 | `NID_ATTR` compatibility export | INFO | Protocol compatibility constant only; static runtime gate excludes protocol and forbids runtime use in capture/renderer/adapter files. |

No blocker anti-patterns, TODO/FIXME implementation stubs, placeholder features, or orphaned artifacts were found.

### Code Review Fix Assessment

`07-REVIEW-FIX.md` records fix commit `e638d3f`, addressing:

- CR-01: Playwright inject runtime now exposes `window.__phantomStreamCapture` and `window.__phantomStreamGetNodeId(element)`.
- WR-01: architecture docs updated to avoid stale sanitizer limitation claims.
- WR-02: static identity gate expanded to include `src/adapters/playwright-inject.js`.

`07-REVIEW.md` then re-reviewed 26 files and reports `status: clean` with CR-01/WR-01/WR-02 resolved. I verified the fix commit exists and the changed files match those claims.

### Human Verification Required

None for this phase's coded contract. The phase goal is API and wire-identity behavior; the public highlight behavior is programmatically verified by DOM/style assertions and content-minimizing API tests.

### Gaps Summary

No blocking gaps found. `CAPT-07` and `VIEW-03` are satisfied by code, tests, static gates, documentation, adapter artifact updates, and clean post-fix review.

---

_Verified: 2026-06-15T17:14:19Z_
_Verifier: the agent (gsd-verifier)_
