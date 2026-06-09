# Codebase Concerns

**Analysis Date:** 2026-06-09

---

## Extraction Incompleteness (Structural Debt)

**Three of four core modules are README stubs with no implementation:**
- Issue: `src/capture/`, `src/relay/`, `src/renderer/` each contain only a `README.md`. The actual implementations live verbatim in `reference/` still coupled to the FSB-specific environment.
- Files: `src/capture/README.md`, `src/relay/README.md`, `src/renderer/README.md`
- Impact: The package `package.json` declares `"main": "src/protocol/index.js"` and exports only `./protocol`. No capture, relay, or renderer module can be consumed by downstream users. The repo is not yet functional as a standalone framework.
- Fix approach: Implement the planned module splits described in each README. The capture split is `serializer.js` + `differ.js` + `side-channels.js` + `session.js` + `index.js`; relay is `relay.js` + `limits.js` + `backends/ws.js` + `index.js`; renderer is `snapshot-renderer.js` + `diff-applier.js` + `overlays.js` + `remote-control.js` + `layout.js` + `index.js`.

**Reference code is hard-wired to `chrome.runtime` and `window.FSB`:**
- Issue: `reference/extension/dom-stream.js` calls `chrome.runtime.sendMessage` in every outbound path (snapshot, mutations, scroll, overlay, dialog, ready ping) and reads `window.FSB` (logger, overlay state, `FSB._modules`). These are not abstracted.
- Files: `reference/extension/dom-stream.js` lines 221–253, 749–771, 895–911, 986–998, 1029–1042, 1109–1116
- Impact: The capture core cannot run outside a Chrome extension content-script context until the transport abstraction described in `src/capture/README.md` is implemented.
- Fix approach: Replace `chrome.runtime.sendMessage` with an injected `Transport` interface; replace `window.FSB` reads with an options object `{ logger, overlayProvider, skipElement }`.

**`ws-client.js` references ~10 undeclared global functions:**
- Issue: `reference/extension/ws-client.js` calls `executeCDPToolDirect`, `keyboardEmulator`, `analytics`, `_getDashboardTaskRecoverySnapshot`, `activeSessions`, `calculateProgress`, `detectTaskPhase`, `_sendStreamState`, `_rememberStreamState`, `getPageTypeDescription`, `CONTENT_SCRIPT_FILES` without any import or declaration. These live in the parent FSB `background.js` (13k-line file not included in `reference/`).
- Files: `reference/extension/ws-client.js` lines 165–184, 335–350, 481–497, 997–1006
- Impact: The relay/capture lifecycle code cannot be read or tested in isolation; any port must reverse-engineer the implicit contracts from these call sites.
- Fix approach: Document the dependency contracts explicitly; stub out or import them when extracting `src/relay/`.

---

## Security Concerns

**`on*` attribute sanitization gap (documented §6.5, confirmed present):**
- Risk: `processAddedNode` in `reference/extension/dom-stream.js` (lines 620–647) stamps nids, absolutifies URLs, and processes `srcset`, but does NOT strip `on*` event-handler attributes or `javascript:` href values. The snapshot path `serializeDOM` similarly skips `on*` stripping for all elements except `<html>`/`<body>` shells (which use `serializeShellAttributes` that skips `name.indexOf('on') === 0`). Any element in the body can carry `onerror`, `onclick`, etc. through to the viewer's iframe.
- Files: `reference/extension/dom-stream.js` lines 350–362 (shell only), 620–647 (added nodes — no stripping), 403–486 (main serialization pass — no stripping)
- Current mitigation: The mirror iframe is rendered via `srcdoc` — but `reference/dashboard/dashboard.js` does NOT set a `sandbox` attribute on `previewIframe` (`reference/renderer/README.md` calls this a "hard requirement" that is not yet enforced).
- Recommendations: (1) Strip `on*` attributes in all three serialization paths. (2) Add `sandbox="allow-same-origin allow-forms"` (no `allow-scripts`) to `previewIframe` in the renderer.

**`add` diff op inserts raw HTML from the captured page without sanitization:**
- Risk: `handleDOMMutations` in `reference/dashboard/dashboard.js` (line 3242) does `temp.innerHTML = m.html` to parse the `add` op's `html` payload, then inserts the resulting element into the live iframe document. The `m.html` string originated from `processAddedNode`, which does not strip `on*` or `javascript:` values.
- Files: `reference/dashboard/dashboard.js` lines 3241–3251
- Current mitigation: None — no DOMParser sanitizer, no iframe sandbox.
- Recommendations: Use `DOMParser` with sanitization or a trusted-types policy; enforce `allow-scripts`-free sandbox.

**Snapshot injects full `<style>` blocks from the page without sanitization:**
- Risk: `handleDOMSnapshot` in `reference/dashboard/dashboard.js` (lines 2789–2791) inlines `payload.inlineStyles` directly into `<style>` tags inside the constructed `srcdoc` document. Malicious CSS (e.g., `expression()` in older browsers, or CSS injection to extract data via `:visited` side-channels) is not filtered.
- Files: `reference/dashboard/dashboard.js` lines 2789–2791
- Current mitigation: None.
- Recommendations: Apply a CSS sanitizer or at least check for `expression(`, `url(javascript:`, and similar patterns.

**`lz-string.min.js` is an unversioned vendored blob:**
- Risk: `reference/extension/lz-string.min.js` is a minified single-file copy of pieroxy/lz-string with no version comment, no subresource integrity hash, and no package manager entry. If the canonical library has had security or correctness fixes, this copy may be out of date.
- Files: `reference/extension/lz-string.min.js`
- Current mitigation: The library is compression-only (no network activity), limiting attack surface to DoS or decompression bomb.
- Recommendations: Pin to a specific version, add an integrity comment, and import from `node_modules` via package.json in the standalone framework rather than vendoring. The `src/protocol/envelope.js` design already addresses this by accepting an injected codec instead of a bundled one.

**WebSocket relay has no inbound message schema validation:**
- Risk: `reference/server/ws-handler.js` parses inbound JSON (`JSON.parse(data)`) and dispatches based on `msg.type`, but performs no structural validation on any message payload before relaying it verbatim to the other side. A malformed `dash:dom-stream-start` with an oversized or maliciously constructed payload passes through unchecked (beyond the 1 MiB cap).
- Files: `reference/server/ws-handler.js` lines 244–272
- Current mitigation: The relay is authenticated (hashKey check in `server.js` upgrade handler) and the per-message cap provides a size bound.
- Recommendations: Add payload shape validation (at minimum: `type` must be a string from an allowlist before relay; `payload` must be an object). The standalone `limits.js` module is the right place for this.

**`nextNodeId` counter is module-global and resets only on `serializeDOM`:**
- Risk: `nextNodeId` in `reference/extension/dom-stream.js` is a closure variable initialized to `1` at module load and reset to `1` on every `serializeDOM()` call. It is NOT reset on stream stop/resume. After a `domStreamStop` + `domStreamStart` cycle, the new snapshot mints nids starting at 1 again, but there is no guarantee that a late diff from the previous session (which was already filtered by session identity) cannot be applied if the session filter is bypassed or if the viewer applies a diff before receiving the new snapshot.
- Files: `reference/extension/dom-stream.js` lines 18, 371 (`nextNodeId = 1`)
- Current mitigation: Session and snapshot ID stamps on every message provide the primary guard.
- Recommendations: Reset `nextNodeId` on `domStreamStop` as well, or use a per-session counter.

---

## Known Inherited Limitations (from docs/ARCHITECTURE.md §6)

**1. Frozen computed styles drift:**
- Issue: Inlined snapshot-time styles cannot be overridden by class-flip `attr` diffs because the inline `style` attribute has higher specificity. Any CSS class toggle (hover state, active state, theme switch) is silently ignored until the next full snapshot.
- Files: `reference/extension/dom-stream.js` lines 343–348 (`captureComputedStyles`), `reference/dashboard/dashboard.js` line 3293 (`attr` op apply)
- Impact: Style-dynamic UIs (animated components, dark-mode toggles) drift visually until a resync.
- Fix approach: CSSOM / `adoptedStyleSheets` capture mode (planned in `src/capture/README.md`).

**2. Added nodes carry no computed styles:**
- Issue: `processAddedNode` (`reference/extension/dom-stream.js` lines 620–647) assigns nids and absolutifies URLs but does not call `captureComputedStyles`. Post-snapshot dynamically added content renders with browser defaults instead of page styles.
- Files: `reference/extension/dom-stream.js` lines 620–647
- Fix approach: Call `collectComputedStyleText` for each added element and embed in the `add` op's `html` payload, or add a companion `style` op.

**3. nid stamping mutates the observed page:**
- Issue: `assignNodeId` writes `data-fsb-nid` attributes on live DOM elements via `original.setAttribute`. This is visible to the page's own MutationObservers, CSS selectors (`[data-fsb-nid]`), and JavaScript (`document.querySelectorAll('[data-fsb-nid]')`), potentially interfering with the page's own logic.
- Files: `reference/extension/dom-stream.js` lines 143–152 (`assignNodeId`), lines 623 and 636 (`processAddedNode` direct `setAttribute` calls)
- Fix approach: WeakMap-based identity (requires a different wire-addressing strategy without the `data-` attribute).

**4. Passive truncation recovery:**
- Issue: Diff ops targeting nids inside truncated (dropped) subtrees miss silently (`staleMutationCount` increments but no on-demand fetch is issued). The mirror only recovers when the next full snapshot arrives.
- Files: `reference/extension/dom-stream.js` lines 557–585 (truncation logic), `reference/dashboard/dashboard.js` lines 3232–3238 (miss handling)
- Fix approach: Implement a `dash:request-subtree` message for on-demand subtree fetch.

**5. on* sanitization gap (see Security section above).**

**6. Shadow DOM, `<video>`/`<audio>`, cross-origin iframes not mirrored:**
- Issue: `isFsbOverlay` in `reference/extension/dom-stream.js` (lines 262–277) partially handles shadow roots for the FSB overlay itself, but neither `serializeDOM` nor `processAddedNode` traverses into shadow roots of page elements. `<video>` and `<audio>` elements survive in the clone but are static (no live stream). Cross-origin iframes keep their `src` but their content is inaccessible.
- Files: `reference/extension/dom-stream.js` lines 262–277, 427–439

---

## Performance Bottlenecks

**`querySelector` per diff op (O(N) per mutation, unbounded):**
- Issue: Each diff op in `handleDOMMutations` executes `doc.querySelector('[data-fsb-nid="..."]')` against the full mirror document. For pages with thousands of nodes and high-frequency mutation bursts, this is O(M × N) where M is mutations in a batch and N is document size.
- Files: `reference/dashboard/dashboard.js` lines 3222, 3246, 3254, 3275, 3300
- Cause: No nid-to-element cache in the viewer.
- Improvement path: Maintain a `Map<nid, Element>` in the renderer, populated at snapshot load and updated on each `add`/`rm`.

**Snapshot size check via `clone.innerHTML` string length repeated mid-truncation:**
- Issue: During truncation pass 2 (`reference/extension/dom-stream.js` line 577), the condition `clone.innerHTML.length > truncationCapBytes` is evaluated on every iteration of the backwards loop, re-serializing the full clone innerHTML each time a subtree is removed. For large pages this is O(K × N) where K is the number of dropped subtrees.
- Files: `reference/extension/dom-stream.js` lines 575–584
- Cause: `innerHTML` is a getter that re-serializes the DOM on every access.
- Improvement path: Re-measure only once per loop iteration by assigning to a local variable, or maintain a running byte estimate rather than re-serializing.

**Parallel TreeWalker pair with all-pairs collected before processing:**
- Issue: `serializeDOM` collects all element pairs from both the original and clone trees into a `pairs` array (lines 393–399) before processing. For very large DOMs this holds two full element reference arrays in memory simultaneously.
- Files: `reference/extension/dom-stream.js` lines 383–399
- Impact: Memory pressure for pages with tens of thousands of elements.
- Improvement path: Process pairs incrementally rather than collecting all upfront.

---

## Tech Debt

**`dashboard.js` is a 4,097-line monolith tightly coupled to FSB's task UI:**
- Issue: The renderer logic (snapshot render, diff apply, overlays, remote control, layout modes) is interleaved with FSB-specific task progress tracking, agent management stubs, QR authentication, WebSocket lifecycle, and deprecation tombstones. `src/renderer/README.md` estimates the relevant range as lines 2700–3960.
- Files: `reference/dashboard/dashboard.js` (4,097 lines total)
- Impact: Cannot be tested in isolation; any renderer bug requires navigating the full monolith. The extraction to `src/renderer/` is the most complex lift in the roadmap.
- Fix approach: Extract the preview module per the planned split in `src/renderer/README.md`.

**`TEMP DEBUG` console logging left in production relay code:**
- Issue: `reference/server/ws-handler.js` line 267–271 contains a `console.log` comment tagged `// TEMP DEBUG (Phase 212 diagnosis)` that logs every relayed message type and delivery count, which produces O(messages) log output in production.
- Files: `reference/server/ws-handler.js` lines 267–271
- Impact: Log volume proportional to mutation rate; potential information disclosure in log aggregators.
- Fix approach: Replace with a conditional diagnostic flag or remove before extraction into `src/relay/`.

**`rooms` and `roomDiagnostics` Maps grow without eviction:**
- Issue: `reference/server/ws-handler.js` `rooms` map removes empty rooms on disconnect (line 311–312), but `roomDiagnostics` is never pruned — it accumulates an entry per unique `hashKey` that has ever connected, with no TTL or size cap.
- Files: `reference/server/ws-handler.js` lines 23–35, 169–179
- Impact: Long-running relay processes accumulate a memory leak proportional to the total number of unique sessions ever connected.
- Fix approach: Prune `roomDiagnostics` entries when the corresponding room is removed.

**Deprecated agent/agent-management code is commented-in-place, not removed:**
- Issue: `reference/dashboard/dashboard.js` contains approximately 400 lines of commented-out code from the deprecated agent management system (`DEPRECATED v0.9.45rc1: superseded by OpenClaw / Claude Routines`), preserved as commented blocks rather than removed.
- Files: `reference/dashboard/dashboard.js` lines 20–53, 577–713, 797–890, 1741–2091 (approximate ranges)
- Impact: Increases cognitive load when reading the renderer source; the commented code references non-existent DOM IDs and will never be re-activated.
- Fix approach: Delete commented-out blocks during renderer extraction.

**`nextNodeId` is not persisted across service-worker evictions:**
- Issue: `nextNodeId` is a closure variable in `reference/extension/dom-stream.js`. If the Chrome extension service worker is evicted (MV3 behavior) and the content script is re-injected, `nextNodeId` resets to 1, potentially colliding with nids already known to the viewer for the current session.
- Files: `reference/extension/dom-stream.js` line 18
- Current mitigation: Session identity stamps cause the viewer to reject stale ops; but the watchdog triggers a fresh snapshot which re-mints all nids starting at 1 again — so a properly handled eviction results in a full resync, not silent collision.
- Fix approach: This is acceptable given the watchdog-triggered resync path; document the invariant explicitly.

---

## Test Coverage Gaps

**No tests for capture core (serializer, differ, side-channels):**
- What's not tested: `serializeDOM`, `processAddedNode`, `processMutationBatch`, scroll tracker, overlay broadcaster, dialog interceptor, watchdog logic.
- Files: `reference/extension/dom-stream.js` (1,117 lines, 0 test coverage in this repo)
- Risk: Style capture correctness, truncation behavior, `on*` stripping (once implemented), and nid assignment order are all exercised only by the reference tests in `reference/tests/`, which test the integrated FSB system — not the standalone module.
- Priority: High — the serializer is the most complex component and has the most edge cases.

**Reference tests are not executable in this repo:**
- What's not tested: `reference/tests/` contains 6 test files (`dom-stream-perf.test.js`, `stream-candidate-resolution.test.js`, `dashboard-preview-aspect-ratio.test.js`, `dashboard-preview-fit.test.js`, `dashboard-stream-pending-intent.test.js`, `dashboard-stream-readiness-ping.test.js`), but they depend on test harness infrastructure (`fsb-test-utils`, `jest`, mock DOM environments) that is not present in this repository.
- Files: `reference/tests/` (6 files)
- Risk: The only runnable tests are in `tests/protocol.test.js` — 7 tests covering the `src/protocol/` layer only.
- Priority: High — stand up the reference tests or port them to the standalone framework as each module is extracted.

**Protocol tests use a fake non-compressing codec:**
- What's not tested: `tests/protocol.test.js` uses a `fakeLz` codec that is Base64 round-trip only (not LZ compression). The actual `lz-string.min.js` behavior (compression ratio, edge cases with unicode/binary, decompression of null/empty inputs) is untested.
- Files: `tests/protocol.test.js` lines 13–17
- Risk: A real LZ-string bug (e.g., null decompression result on adversarial input) would be caught only at runtime.
- Priority: Medium — add at least one test with the real `lz-string` library.

**No relay-level tests in this repo:**
- What's not tested: `reference/server/ws-handler.js` — room fan-out, backpressure drop logic, `roomDiagnostics` accumulation, `sendToClients` error handling.
- Files: `reference/server/ws-handler.js`
- Risk: The backpressure drop path (`BACKPRESSURE_BUFFER_LIMIT_BYTES`) and the `rooms.delete` eviction logic are untested here. FSB has a `server-ws-backpressure.test.js` (referenced in a comment at line 352) but it is not present in this repository.
- Priority: High — needed before extracting `src/relay/`.

---

## Fragile Areas

**Session identity filter has a bypass for missing-identity messages:**
- Files: `src/protocol/messages.js` lines 104–115, `reference/dashboard/dashboard.js` lines 206–246
- Why fragile: `isCurrentStream` and `shouldAcceptPreviewMessage` both return `true` when either the incoming message or the active stream has no identity fields. This backward-compatibility concession means any message without a `streamSessionId` is accepted regardless of the active session. Pre-identity senders from older FSB versions are the intended case, but this also means an unauthenticated message injected without identity fields would pass through.
- Safe modification: Any change to the identity stamp logic must preserve the `no-identity = accepted` behavior for the FSB compatibility path, or the filter must be hardened simultaneously with the protocol version bump.

**`_pendingStreamStart` can only hold one parked intent:**
- Files: `reference/extension/ws-client.js` lines 202–291
- Why fragile: If the dashboard sends a second `dash:dom-stream-start` before the first pending intent is re-armed (e.g., rapid reconnect cycles), the second arrival overwrites `_pendingStreamStart` (line 1283). The first intent is silently dropped.
- Safe modification: Any change to the pending-intent re-arm path must either queue multiple intents or document that only the latest survives.

**`staleMutationCount` threshold of 3 triggers resync aggressively on fast-mutating pages:**
- Files: `reference/dashboard/dashboard.js` lines 3232–3237
- Why fragile: The resync threshold is hardcoded to 3 consecutive miss operations. On pages with genuinely high-frequency DOM activity (e.g., live stock tickers, terminal emulators), 3 misses can happen in a single rAF batch after truncation, triggering unnecessary resyncs.
- Safe modification: Make the threshold configurable or add a debounce window.

**Dual `buildShellAttributeString` escaping is incomplete:**
- Files: `reference/dashboard/dashboard.js` (search for `buildShellAttributeString`)
- Why fragile: Shell attributes from `<html>` and `<body>` are reconstructed as HTML attribute strings. If the escaping (only `"` → `&quot;`) misses edge cases (e.g., attribute names with injected `>` characters from a malicious page), the constructed `srcdoc` document could be malformed.
- Safe modification: Use `document.createElement` + `setAttribute` to build the shell element safely rather than string concatenation.

---

*Concerns audit: 2026-06-09*
