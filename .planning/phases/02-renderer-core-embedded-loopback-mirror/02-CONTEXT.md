# Phase 2: Renderer Core + Embedded Loopback Mirror - Context

**Gathered:** 2026-06-10
**Status:** Ready for planning

<domain>
## Phase Boundary

The viewer-side reconstruction is extracted from `reference/dashboard/dashboard.js` (4,096 lines; stream-relevant parts ≈ lines 2700–3960) into an embeddable, framework-agnostic component, and the first end-to-end proof lands: a single plain HTML page importing capture (`src/capture`, shipped in Phase 1) + viewer directly via a loopback transport shows a live self-mirror with zero infrastructure. Covers VIEW-01 (`createViewer({ container, transport })` with viewport-adaptive scaling), VIEW-04 (documented, extensible overlay channel with glow/progress built-ins), VIEW-06 (scroll + native dialog mirroring parity), ADPT-04 (embedded-SDK adapter — first-party page imports and runs capture directly).

Sandbox backstop from day one: viewer iframe created with `sandbox="allow-same-origin"` only, asserted at creation. Full security contract (sanitization, masking) is Phase 3 — NOT this phase. Remote control is Phase 5. Connection-state/telemetry events (VIEW-02) are Phase 4. Semantic addressing API (VIEW-03) is Phase 7.

</domain>

<decisions>
## Implementation Decisions

### Viewer API & Embedding Surface
- **Factory shape:** `createViewer({ container, transport })` **auto-attaches on creation** and returns a minimal handle `{ detach, destroy, registerOverlay }` — criterion 1 says calling it yields a live mirror. No events surface yet (Phase 4), no addressing API yet (Phase 7). Keep the handle minimal; extend later phases. *(Ratified during planning: `registerOverlay` lives on the handle because the overlay registry is per-viewer-instance — this reconciles the minimal-handle decision with the locked `registerOverlay(kind, renderFn)` extension mechanism below.)*
- **Scaling:** reference-parity scale-to-fit — the mirror scales to the container while preserving the captured viewport aspect ratio, driven by `ResizeObserver` on the container.
- **Layout modes DROPPED from the framework:** inline/maximized/pip/fullscreen are FSB dashboard UI, not framework concerns. The viewer always fills its container; layout is the host's responsibility. Document this explicitly (the `layout.js` module from `src/renderer/README.md`'s planned split is NOT extracted).
- **Loopback demo:** `examples/loopback-mirror.html` importing capture + viewer as native ES modules, served by a dependency-free Node static-serve script (`npm run example:loopback`) since ESM imports need http. Zero external dependencies.

### Reconstruction & Update Mechanics
- **Snapshot → iframe:** parity — write snapshot HTML into the sandboxed iframe via `srcdoc` (per reference and `src/renderer/README.md`).
- **Diff-apply misses:** internal miss accounting + logger warnings now (README hard requirement: health signal, not silent drift). The formal telemetry/event surface (VIEW-02) arrives in Phase 4 — do not build it now.
- **Staleness guard:** reuse `isCurrentStream` from `src/protocol` — viewer rejects messages with mismatched stream-session/snapshot identity (parity with reference).
- **Re-snapshot request:** wire the documented `dash:request-snapshot` control path through the loopback transport now — the protocol already defines it; recovery is proven end-to-end in one page.

### Overlay Channel (VIEW-04)
- **Built-ins:** port the reference action-glow and progress-card overlays as pre-registered built-ins (parity visuals).
- **Extension mechanism:** renderer registry keyed by overlay `kind` — `registerOverlay(kind, renderFn(payload, anchorRect, layer))`. Built-ins use the same registry, proving the extension seam works.
- **Anchoring:** nid → mirrored element bounding rect, positioned in a host-document overlay layer ABOVE the iframe. Overlays are never injected into the sandboxed mirror document.
- **Unknown overlay kinds:** logged and ignored (forward-compatible; never throw).

### Dialog & Scroll Mirroring (VIEW-06)
- **Dialog cards:** reference-parity cards for `alert`/`confirm`/`prompt` mirroring.
- **Scroll semantics:** parity — captured page scroll drives mirror scroll (scaled to the mirror's coordinate space).
- **Viewer-side scroll:** read-only follow in Phase 2 — user scrolling the mirror does not feed back (remote control is Phase 5); mirror re-syncs to the captured scroll position.

### Claude's Discretion
- Module split within `src/renderer/` (README suggests snapshot-renderer/diff-applier/overlays/index; `remote-control.js` is Phase 5, `layout.js` is dropped) — single-file-first like Phase 1 or split, planner's choice; parity is the bar, not structure
- Overlay layer DOM structure and CSS implementation details
- Exact miss-accounting counters and logger message formats
- Static-serve script implementation (Node built-ins only)
- How the loopback example page demonstrates mutations (e.g., a small self-mutating playground area)

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/capture/index.js` — Phase 1 extracted capture core; the loopback example consumes it directly (`createCapture({ transport, ... })`); its loopback-transport pattern from `tests/differential/harness.js:225` shows the transport seam shape
- `src/protocol/` — `STREAM`/`CONTROL` message types, `NID_ATTR`, `isCurrentStream` staleness guard, constants — viewer imports from here, never redefines
- `reference/dashboard/dashboard.js` lines ≈2700–3960 — source of truth for snapshot render, diff apply, scroll/overlay/dialog handlers, scaling (parity bar)
- `src/renderer/README.md` — planned module split + two hard requirements (sandbox without `allow-scripts`; miss accounting as health signal)
- `tests/` conventions from Phase 1 — node:test flat style, jsdom 29 available as devDependency, dual-jsdom differential harness patterns reusable for viewer tests

### Established Patterns
- Injected-dependency seams (transport/logger) with `var` + `||` defaulting, errors contained and routed to logger (Phase 1 `safeSkipElement` pattern)
- Parity-first extraction with intentional divergences documented (Phase 1 divergence-ledger discipline — viewer divergences from the dashboard should be listed in the renderer README)
- ESM named exports, explicit `.js` extensions, JSDoc types
- Purity discipline: `src/renderer/` must have zero FSB dashboard references (mirror Phase 1's static-scan purity test pattern)

### Integration Points
- `package.json` `exports` — add `"./renderer": "./src/renderer/index.js"` alongside `./protocol` and `./capture`
- Test glob `tests/*.test.js tests/differential/*.test.js` — new renderer tests under `tests/` are picked up automatically; if a new subdirectory is added, the test script must be extended
- CI workflow already runs `npm test` on Node 20/22/24 — new tests ride along
- jsdom notes: `srcdoc` support in jsdom is limited/async — viewer tests may need to render via direct document writes into a jsdom window or assert the srcdoc string; researcher should verify jsdom's iframe/srcdoc behavior before planning test strategy

</code_context>

<specifics>
## Specific Ideas

- Continue the Phase 1 bias: minimal API surface, lighter-weight choices, parity-first with the reference; drop FSB-dashboard-specific UI (layout modes) rather than port it
- The loopback page is the project's "first light" demo — it should be impressive but dependency-free: one HTML file, one tiny server script

</specifics>

<deferred>
## Deferred Ideas

- Layout modes (maximized/pip/fullscreen) — dropped from framework; hosts can implement; revisit only if FSB swap-in (Phase 11) reveals a need
- Viewer free-scroll with re-sync button — Phase 5 (remote control) territory if wanted

</deferred>
