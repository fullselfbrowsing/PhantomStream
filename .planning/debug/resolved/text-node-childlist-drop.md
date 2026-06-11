---
status: resolved
trigger: "Live-mirror fidelity bug: textContent= edits on tracked rows never reach the mirror (8/13 rows stale in loopback demo); structural adds/removes mirror fine. Confirmed root cause: childList branch in src/capture/index.js only processes ELEMENT_NODE added/removed nodes, so bare text-node replacement (li.textContent = ...) emits zero ops."
created: 2026-06-11T00:00:00Z
updated: 2026-06-11T00:00:00Z
symptoms_prefilled: true
goal: find_and_fix
tdd_mode: true
---

## Current Focus

reasoning_checkpoint:
  hypothesis: "src/capture/index.js processMutationBatch childList branch gates BOTH added/removed loops on nodeType === ELEMENT_NODE, so el.textContent = '...' (bare text-node removal+addition record) emits zero ops -> silent mirror text drift"
  confirming_evidence:
    - "Source read: lines 901 and 926 gate on Node.ELEMENT_NODE; no else path exists for text nodes"
    - "Working contrast: characterData branch (951-960) emits {op:'text', nid: parentNid, text} and renderer diff.js DIFF_OP.TEXT applies it (line 140 textContent=)"
    - "All existing oracle scenarios + loopback tests deliberately avoid textContent= on attached nodes (explicit comments in basic-mutations.js:47, mutation-burst.js:32, structural-ops.js:51) -- the gap is unexercised, explaining green suites + real-Chrome drift"
  falsification_test: "If a loopback test doing row.textContent='new' on a tracked row PASSES before any fix, the hypothesis is wrong. RED run must show zero MUTATIONS batches / stale mirror."
  fix_rationale: "Emit {op:'text', nid: target nid, text: m.target.textContent} when added/removed include TEXT/CDATA nodes -- addresses the root cause (dropped mutation class) using the existing renderer-supported op shape; not a symptom patch"
  blind_spots: "Mixed-content targets (element children + appended text node) get flattened by the renderer's textContent= -- accepted minimal-fix scope per requirements; comment nodes deliberately excluded; oracle divergence vs reference must be declared (D6) and pinned by a new focused scenario"

hypothesis: "confirmed -- see reasoning_checkpoint"
test: "tests/renderer-loopback.test.js: (A) textContent= on tracked row mirrors e2e; (B) two synchronous textContent= writes on same element -> exactly one deduplicated text op carrying final text"
expecting: "RED before fix on both; GREEN after childList non-element fallback"
next_action: "Write tests A+B in tests/renderer-loopback.test.js, run node --test tests/renderer-loopback.test.js, confirm RED, commit test(02) with RED evidence, then apply capture fix"

tdd_checkpoint:
  test_file: "tests/renderer-loopback.test.js"
  test_name: "a textContent replacement (bare text-node childList) on a tracked element mirrors + dedup op test"
  status: "green"
  failure_output: |
    RED run (pre-fix): test A mirror stayed 'row two'; test B 0 MUTATIONS batches (0 !== 1).
    GREEN run (post-fix): 12/12 loopback tests pass; full suite 126/126.

## Symptoms

expected: "Text edits on tracked (pre-snapshot) elements mirror to the viewer like attribute and characterData changes do"
actual: "li.textContent = label + ' — ' + word produces a childList record with bare TEXT-node removal+addition; capture emits zero ops; mirror shows stale text; no stale-miss recorded, no self-heal resync"
errors: "None — silent drift. No console errors, no missing-nid warnings (the parent element exists and is addressable in the mirror)."
reproduction: "examples/loopback-mirror.html 'Edit text' button (lines ~283-284) in real Chrome; 8 of 13 rows stale after settling"
started: "Always broken — verbatim parity with reference/extension/dom-stream.js (same gap). Phase 1 differential oracle green because BOTH sides drop the mutation."

## Eliminated

- hypothesis: "Renderer fails to apply text ops"
  evidence: "characterData mutations DO emit {op:'text'} and the renderer DIFF_OP.TEXT branch applies them (sets textTarget.textContent). Working path confirmed by orchestrator source reading."
  timestamp: 2026-06-11T00:00:00Z
- hypothesis: "Mirror element missing / nid desync"
  evidence: "Mirror element with same data-fsb-nid exists and is addressable; structural ops on the same rows work."
  timestamp: 2026-06-11T00:00:00Z

## Evidence

- timestamp: 2026-06-11T00:00:00Z
  checked: "src/capture/index.js processMutationBatch childList branch (lines 897-931)"
  found: "addedNodes loop gates on added.nodeType === Node.ELEMENT_NODE (line 901); removedNodes loop gates on removed.nodeType === Node.ELEMENT_NODE (line 926). Bare text-node add/remove falls through both loops -> zero diffs."
  implication: "Root cause confirmed in source. textContent= on an element with element-free children produces childList records with only text nodes -> dropped."
- timestamp: 2026-06-11T00:00:00Z
  checked: "src/capture/index.js characterData branch (lines 951-961)"
  found: "Emits {op:'text', nid: parentElement nid, text: m.target.textContent} — the exact op shape needed; renderer already applies it."
  implication: "Fix = emit same-shaped op from childList branch when non-element nodes are added/removed, keyed on m.target (the parent element), deduped per batch."

## Resolution

root_cause: "src/capture/index.js processMutationBatch childList branch only handles ELEMENT_NODE added/removed nodes. Setting el.textContent replaces a text child (childList record with bare TEXT-node removal+addition), which emits zero ops -> silent text drift in the mirror. Verbatim parity with reference dom-stream.js, so the differential oracle stayed green."
fix: "childList branch now detects TEXT/CDATA nodes in addedNodes/removedNodes and emits {op:'text', nid: <target element nid>, text: target.textContent} for the mutation target -- the same wire shape as the characterData branch, which the renderer's DIFF_OP.TEXT applier already handles. Deduplicated per batch via a nid registry; skipped when the target has no nid; emitted after the rm loop so mixed removals order correctly; comment nodes excluded. Divergence from reference declared as ledger entry D6, pinned by the new text-childlist oracle scenario; documented as capture README entry E2."
verification: "TDD red->green: RED run showed stale mirror + zero MUTATIONS batches; post-fix both tests pass. Full suite 126/126 (was 121): +2 loopback tests (e2e mirror + dedup op shape), +3 oracle tests (ref-vs-ref matrix, flipped matrix with D6 belt-and-braces both-direction assertions, empty-ledger load-bearing). Stale-entry detection covers D1 AND D6. Real-Chrome verification of examples/loopback-mirror.html pending human confirmation."
files_changed:
  - src/capture/index.js
  - src/capture/README.md
  - tests/renderer-loopback.test.js
  - tests/differential/scenarios/text-childlist.js
  - tests/differential/divergence-ledger.js
  - tests/differential/oracle.test.js
