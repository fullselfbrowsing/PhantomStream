# Design History

PhantomStream was built inside [FSB](https://github.com/fullselfbrowsing/FSB) as milestone
**v0.9.9.1 "Phantom Stream"** (shipped 2026-03-31), then hardened by two later phases. This
repository was extracted from FSB at commit `867d6f0c` (2026-06-09). The original planning
artifacts — plans, summaries, UAT scripts, verification reports — are preserved verbatim
under `reference/planning/`.

## Milestone v0.9.9.1 — Phantom Stream (Mar 2026)

**Goal:** make the FSB dashboard's DOM stream fully functional — auto-connect on WebSocket,
full-fidelity live preview, display-matched frame rate, remote browser control.

9 phases (5 planned + 4 inserted fixes), 16 plans:

| Phase | What it delivered |
|---|---|
| 122 Connection & Auto-Start | Stream starts on WS handshake, active-tab tracking, disconnect recovery, 4-state health badge |
| 122.1 Stream Overlay Fix *(inserted)* | Action glow rect mirrored into the preview during automation |
| 122.2 Stop Signal & Final Outcome *(inserted)* | Idempotent stop signals, promise resolution on stop, single task-complete delivery |
| 122.3 WS Payload Compression *(inserted)* | LZ-string envelope (`{_lz, d}`), 90%+ reduction on 100 KB+ snapshots, backward-compatible |
| 122.4 Dashboard Relay Fix *(inserted)* | End-to-end relay delivery investigation and fix |
| 123 Layout Modes | Inline / maximized / PiP (drag) / fullscreen (mouse-tracked exit), viewport-adaptive scaling |
| 123.1 Stream Fidelity Fix *(inserted)* | Broken layouts on complex sites — computed style capture overhaul |
| 124 Visual Fidelity | Dialog mirroring, rAF-synced mutation batching, curated computed-style capture |
| 125 Remote Control | Click/type/scroll through the preview with coordinate reverse-scaling |

The inserted phases are the interesting part of the history: each one is a real-world
failure mode discovered in use (payloads silently dropped by the relay, styles too heavy
for complex sites, overlays invisible in the mirror) and its root-cause fix.

## Phase 211 — Stream Reliability & Diagnostic Logging

Added the dual-watchdog design:

- **STREAM-01:** 5 s content-script self-watchdog (setTimeout chain) + SW-side
  `chrome.alarms` safety net surviving MV3 eviction.
- **STREAM-02:** `staleFlushCount` telemetry riding the mutation envelope.
- **STREAM-03/04:** snapshot truncation under the relay's 1 MiB cap with single-pass
  batched layout reads (read-then-write discipline).

## Phase 276 — Streaming Diagnostic Minimum Patch

Defensive hardening of the start-up handshake:

- **STREAM-DEFENSIVE-02:** `pingDomStream` synchronous readiness probe (200 ms polls, 5 s
  budget).
- **STREAM-DEFENSIVE-04:** pending-intent parking — a stream-start arriving before the
  capture module loads is parked and re-armed on the module's ready ping.
- **STREAM-DEFENSIVE-05:** watchdog auto-resnapshot via `ext:request-snapshot`.

## Performance lessons (encoded in the code)

1. **Curate, don't enumerate.** Iterating all 300+ computed CSS properties per element made
   a YouTube DOM serialize take ~45 s. The curated ~85-property list with default-value
   elision restored interactivity. (`CURATED_PROPS`, D-04/D-07/D-08)
2. **Batch your layout reads.** Reading `getBoundingClientRect()` interleaved with clone
   mutation forced N layout flushes; a single TreeWalker pre-pass into a Map collapsed them
   to 1. (Phase 211-02)
3. **Match the display, not a timer.** rAF-batched mutation flushes deliver diffs at paint
   cadence — no faster than useful, no slower than visible. (FIDELITY-03)
4. **Whole subtrees only.** Truncation never cuts mid-element, so the mirror is always a
   valid document — just a shorter one.
5. **Identity beats ordering.** Session/snapshot IDs on every message turned a class of
   ghost-mutation corruption bugs into silent, correct rejections.
6. **Late-added styles follow the curated path.** Phase 8 fixed post-snapshot
   added-node style drift by reusing the curated computed property list and
   batching reads before clone mutation. It deliberately did not enumerate all
   computed properties and did not become CSSOM mode; full stylesheet-centric
   capture remains Phase 9.

## Standalone Phase 8 — Fidelity Completion (Jun 2026)

Phase 8 closed the remaining high-value DOM fidelity gaps without changing the
core architecture:

- Open shadow roots are transported as `shadowRoots[]` sidecars tied to host
  nids, then reconstructed as real mirror shadow roots. Slots stay slots; light
  children are not duplicated.
- Same-origin iframes are transported as scoped `frames[]` sidecars and rendered
  as inert nested srcdoc mirrors. Cross-origin iframe content remains a
  content-free placeholder.
- Input/change events emit narrow, masked `DIFF_OP.VALUE` updates for form
  property drift instead of replacing nodes.
- Add ops use curated computed styles collected in batched reads. This preserves
  the original "curate, don't enumerate" lesson while fixing late-added visual
  drift.
- Truncated snapshot regions now keep requestable placeholder nids and can be
  recovered by bounded `requestSubtree` / `STREAM.SUBTREE_RESPONSE` flows.

## Where the standalone framework goes from here

See `docs/ARCHITECTURE.md` §6 for the inherited limitations. The extraction roadmap, in
order of research value:

1. **Stylesheet-centric capture** — replace per-element computed-style inlining with CSSOM
   capture + targeted inline overrides; expected to shrink snapshots enough to retire most
   truncation machinery and fix style drift.
2. **Decouple capture from `chrome.runtime`** — a transport interface so the capture core
   runs in any injection context (extension, Playwright/CDP, bookmarklet, embedded SDK).
3. **Sanitization as a first-class stage** — strip `on*`/`javascript:` on capture, enforce
   sandboxed rendering on the viewer.
4. **Evaluation harness** — bandwidth/latency/fidelity benchmarks vs. video streaming and
   rrweb-style record/replay, for the paper.
