---
phase: 02-renderer-core-embedded-loopback-mirror
plan: 05
subsystem: examples
tags: [demo, loopback, embedded-sdk, adpt-04, static-server, ui-spec, first-light]

# Dependency graph
requires:
  - phase: 02-renderer-core-embedded-loopback-mirror
    provides: "02-03: createViewer({ container, transport }) auto-attaching viewer with the data-phantomstream-ui root marker"
  - phase: 01-capture-core-extraction-differential-oracle
    provides: "createCapture({ transport, skipElement }) with the ancestor-inclusive skipElement seam; CONTROL constants in src/protocol/messages.js"
provides:
  - "examples/loopback-transport.js — createLoopbackTransport(): captureTransport (send), viewerTransport (send + onMessage -> unsubscribe), onControl glue seam (02-RESEARCH Pattern 1)"
  - "examples/serve.js — zero-dependency node:http static server: repo root, strict ESM MIME (text/javascript), 127.0.0.1:8642 only, decode-before-resolve traversal guard"
  - "examples/loopback-mirror.html — the first-light demo per the locked 02-UI-SPEC contract; the canonical embedded-SDK (ADPT-04) usage example with the recursion guard"
  - "package.json: @fullselfbrowsing/phantom-stream/renderer export + npm run example:loopback"
affects: [02-06 demo verification, phase-4 WS transport demo, phase-10 publish docs]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Loopback wiring order (load-bearing, no buffering): transport -> createViewer (skip-marked DOM exists first) -> createCapture (attribute-based skipElement) -> onControl glue -> capture.start()"
    - "Static-server traversal guard: raw request path (NOT WHATWG URL-normalized), decodeURIComponent in try/catch before resolve, ROOT+sep prefix check"
    - "examples/ and tests/ never import from each other — the loopback transport is deliberately duplicated in tests (parallel-safe convention, noted in both file headers)"

key-files:
  created:
    - examples/loopback-transport.js
    - examples/serve.js
    - examples/loopback-mirror.html
  modified:
    - package.json

key-decisions:
  - "serve.js parses the raw req.url instead of new URL(req.url, ...): WHATWG URL parsing normalizes /../x to /x, which would turn above-root traversal probes into in-root 200s and violate the plan's never-200 acceptance criterion"
  - "Auto-mutate starts ON at page load so first light shows motion immediately and the badge opens in its pulsing LIVE state (UI-SPEC: the LIVE badge is the secondary attention cue)"

requirements-completed: [ADPT-04, VIEW-01]

# Metrics
duration: ~7min
completed: 2026-06-11
---

# Phase 2 Plan 05: Loopback Mirror Demo (First Light) Summary

**Zero-infrastructure first-light demo: one HTML page importing capture + viewer as native ES modules (ADPT-04), self-mirroring through a queueMicrotask loopback transport behind the data-phantomstream-ui recursion guard, served by a traversal-proof localhost-only node:http server on `npm run example:loopback`.**

## Performance

- **Duration:** ~7 min
- **Started:** 2026-06-11T17:39:19Z
- **Completed:** 2026-06-11T17:46:33Z
- **Tasks:** 2/2
- **Files modified:** 3 created, 1 modified

## Accomplishments

- `createLoopbackTransport()` ships per 02-RESEARCH Pattern 1: two handler Sets (ext:* to viewer, dash:* to host glue), queueMicrotask fan-out (one async hop breaks resync re-entrancy, FIFO preserved), `captureTransport` satisfying the capture Transport contract, `viewerTransport` satisfying the renderer ViewerTransport contract, and `onControl` returning an unsubscribe — the host-glue seam mapping CONTROL.* to capture handle methods
- `examples/serve.js` is dependency-free (node: builtins only) and curl-verified: `text/javascript; charset=utf-8` for every `.js` module the demo imports; `--path-as-is /../package.json` -> 403; `/%2e%2e/%2e%2e/etc/passwd` -> 403; malformed `%zz` -> 400; directory without index.html -> 404; binds `127.0.0.1:8642` and prints the full demo URL on listen (threats T-02-16/T-02-17 mitigated per the plan threat model)
- `examples/loopback-mirror.html` implements the LOCKED 02-UI-SPEC demo contract verbatim: exact copy strings (title, subtitle, empty state, footer), two-pane 1fr/1fr grid stacking under 900px, #1e1e2e panes with 1px #333 borders and 12px radius, pulsing LIVE badge (2000ms ease-in-out keyframes inside a prefers-reduced-motion: no-preference media query) flipping to solid #6b7280 PAUSED, amber #f59e0b on the primary CTA only, 150ms ease hover transitions, and the five exact-label controls (Add row / Remove row / Edit text / Show dialog / Auto-mutate)
- The wiring order is the documented Pattern 4 sequence and reads top-to-bottom in source: `createLoopbackTransport()` -> `createViewer` (viewer DOM exists and is skip-marked before any snapshot) -> `createCapture` with the attribute-based `data-phantomstream-ui` skipElement predicate (works on detached clones, T-02-18) -> `transport.onControl` mapping START/STOP/PAUSE/RESUME -> `capture.start()` on load
- Show dialog proves the dialog channel with the footer log line `dialog mirrored: alert open → closed` after dismissal, with the Pitfall 3 paint-blocking explanation as an HTML comment (card IS visible in two-context deployments); the page never touches the iframe sandbox attribute (T-02-19 — the `/sandbox\s*=/` check is part of the automated verify)
- `@fullselfbrowsing/phantom-stream/renderer` is now a package export and `npm run example:loopback` starts the demo server; full suite stays green at 111/111

## Task Commits

Each task was committed atomically:

1. **Task 1: Loopback transport module, static server, package wiring** - `1a0499a` (feat) — examples/loopback-transport.js, examples/serve.js, package.json
2. **Task 2: The first-light demo page (loopback-mirror.html)** - `16597f0` (feat) — examples/loopback-mirror.html (369 lines, min_lines 150 satisfied)

## Files Created/Modified

- `examples/loopback-transport.js` — createLoopbackTransport: both transport ends + onControl glue seam, var/function-expression style, unsubscribe closures
- `examples/serve.js` — node:http static server: repo-root ROOT via fileURLToPath, MIME map (.html/.js/.mjs/.css/.json/.svg/.png/.ico/.map), decode-before-resolve + prefix traversal guard, explicit-index.html-only directories, 127.0.0.1:8642
- `examples/loopback-mirror.html` — self-contained first-light demo: inline style block implementing the UI-SPEC design system + one inline module script importing ./loopback-transport.js, ../src/renderer/index.js, ../src/capture/index.js, and CONTROL from ../src/protocol/messages.js
- `package.json` — exports gains `"./renderer": "./src/renderer/index.js"`; scripts gains `"example:loopback": "node examples/serve.js"`; test glob untouched

## Decisions Made

- **Raw-path parsing in serve.js (deviation from the research snippet, mandated by the plan's acceptance criteria):** see Deviations below
- **Auto-mutate ON at load:** the UI-SPEC badge contract ties LIVE to auto-mutate being on and names the pulsing LIVE badge the secondary attention cue, so the demo opens with the interval running and the badge pulsing; toggling Auto-mutate off flips to solid-gray PAUSED
- **ROOT via fileURLToPath:** `new URL('..', import.meta.url).pathname` leaves percent-encoding in filesystem paths (breaks under any path with spaces); `fileURLToPath` decodes correctly on every platform while still deriving ROOT from `new URL('..', import.meta.url)` as the plan specifies
- **`window.__phantomstream` handle exposed:** the demo doubles as the copy-pasteable embedding example, so the viewer/capture/transport handles are reachable from the console for exploration

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] serve.js parses the raw request path instead of `new URL(req.url, 'http://localhost')`**
- **Found during:** Task 1 (implementing the acceptance criteria against the 02-RESEARCH Pattern 7 snippet)
- **Issue:** The research snippet routes req.url through the WHATWG URL parser, which normalizes dot segments — `/../package.json` becomes `/package.json`, an in-root path that would serve with 200. The plan's acceptance criterion requires 403/404 (never 200) for exactly that probe
- **Fix:** Strip the query string from raw `req.url`, decodeURIComponent inside try/catch (400 on malformed), then resolve + ROOT-prefix guard — the un-normalized `..` now resolves above ROOT and is rejected with 403. Verified by curl: `--path-as-is /../package.json` -> 403, `/%2e%2e/%2e%2e/etc/passwd` -> 403, `/%zz` -> 400
- **Files modified:** examples/serve.js
- **Commit:** `1a0499a`

## Issues Encountered

None beyond the auto-fixed deviation above.

## Known Stubs

None. The transport, server, and demo page are fully wired to the live capture and renderer modules — every control mutates real DOM that round-trips through the real loopback channel. Real-browser visual verification is plan 02-06's scope by design.

## Threat Flags

None beyond the plan's threat model. T-02-16 (traversal/listing) and T-02-17 (network exposure) are mitigated and curl-pinned in the acceptance run; T-02-18 (recursion) uses the attribute-based skipElement guard proven by the 02-04 e2e tests; T-02-19 (sandbox weakening) is enforced by the page never touching the sandbox attribute plus the viewer's creation-time assertion. The only new network surface (the demo server) is the one the threat model already registers, localhost-bound.

## Next Phase Readiness

- Plan 02-06 (demo verification) can run `npm run example:loopback` and walk the UI-SPEC checklist in a real browser — including the empirical Pitfall 3 paint check on Show dialog
- The demo page is the canonical ADPT-04 embedding example: transport -> viewer-first -> capture-with-guard -> control glue -> start, copy-pasteable for any future host
- Phase 4's WS transport replaces createLoopbackTransport behind the same two interfaces; the demo wiring order and recursion guard carry over unchanged

## Self-Check: PASSED

- `examples/loopback-transport.js` — FOUND
- `examples/serve.js` — FOUND
- `examples/loopback-mirror.html` — FOUND
- `package.json` (./renderer export + example:loopback script) — FOUND
- Commit `1a0499a` — FOUND
- Commit `16597f0` — FOUND
- `npm test` — 111/111 pass
- curl acceptance run — MIME text/javascript, traversal 403, encoded traversal 403, malformed 400, demo page 200
