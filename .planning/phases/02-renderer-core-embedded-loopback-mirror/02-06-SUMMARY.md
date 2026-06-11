---
phase: 02-renderer-core-embedded-loopback-mirror
plan: 02-06
subsystem: phase-gate
tags: [gate, real-browser-checkpoint, verification]
requires: [02-04, 02-05]
provides:
  - Full-suite gate green (126/126)
  - Real-browser checkpoint executed and passed (Chrome via FSB browser tools)
  - Text-node childList drop bug found, fixed, and re-verified live
key-files:
  created: []
  modified: []
duration: ~45min (including live debugging cycle)
completed: 2026-06-11
---

# Plan 02-06 Summary — Phase Gate + Real-Browser Checkpoint

## Task 1 — Full-suite gate

`npm test` green: **126/126** (was 121 at wave-3 merge; +5 from the checkpoint-discovered fix below).

## Task 2 — Real-browser checkpoint (executed via FSB-driven Chrome, then settled-state assertions)

Demo served by `npm run example:loopback` (127.0.0.1:8642); page driven and inspected live in a real Chrome tab:

| Check | Result |
|-------|--------|
| Mirror renders through real `srcdoc` | ✅ 33+ nid-stamped nodes in `iframe.contentDocument` |
| Sandbox attribute | ✅ exactly `sandbox="allow-same-origin"` (live DOM inspection) |
| Live mutation tracking — structural | ✅ Add row mirrored; counts converge at settle |
| Live mutation tracking — text | ✅ **after fix** (see below); settled comparison: 15/15 rows byte-identical, 0 diffs |
| Recursion guard | ✅ zero `<iframe>` and zero `[data-phantomstream-ui]` inside the mirror |
| LIVE/PAUSED badge | ✅ toggles with auto-mutate |
| Viewport-adaptive scaling | ✅ `transform: scale(0.318…)` applied, letterboxed |
| Footer contract string | ✅ verbatim |
| Demo server guards | ✅ ESM MIME 200s; traversal probes 403/400 (curl) |

## Checkpoint finding: text-node childList drop (found → fixed → re-verified)

The checkpoint caught a real fidelity bug the jsdom e2e missed: `el.textContent = '…'` on a tracked node produces a bare TEXT-node childList record, which the differ dropped silently (ELEMENT_NODE-only gates; verbatim reference parity — oracle green because both sides dropped it; FSB masked it via its 1-minute re-snapshot alarm). 8 of 13 demo rows had stale mirror text with no self-heal.

Fix (commits `5e986a7`, `ae4d798`, `6e6642b`): differ now emits `{op:'text', nid: targetNid, text: target.textContent}` for childList records containing TEXT/CDATA nodes, deduped per batch — same wire shape as the characterData path, renderer applier unchanged. Oracle discipline kept: new `text-childlist` scenario + tightly-scoped ledger entry **D6** (extracted-only fidelity-fix divergence, load-bearing, stale-entry-checked). Capture README entry E2. Debug session archived at `.planning/debug/resolved/text-node-childlist-drop.md`.

Post-fix live verification: direct `textContent=` probe mirrored; settled comparison 15/15 identical rows, 0 diffs.

## Deviations

- Checkpoint executed by the orchestrator driving a real Chrome (FSB browser tools) rather than manual human steps — every checklist item verified against the live DOM, evidence in-transcript. Dialog-card visual and glow-overlay visual not exercised live (alert() blocks paint by design — log-line affordance present; both channels are e2e-tested in jsdom).
