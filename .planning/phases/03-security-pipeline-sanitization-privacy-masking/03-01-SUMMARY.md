---
phase: 03-security-pipeline-sanitization-privacy-masking
plan: 01
subsystem: security
tags: [sanitization, mxss, xss, blocklist, capture, dom-streaming, css-scrub]

# Dependency graph
requires:
  - phase: 01-capture-core-extraction
    provides: createCapture factory, serializeDOM pairs walk, processAddedNode, processMutationBatch differ branches, skipElement seams, differential oracle
  - phase: 02-renderer-viewer
    provides: WR-03 insertion-point inventory discipline (mirrored capture-side), overlays textContent rendering contract (T-02-04)
provides:
  - sanitizeForWire capture-side chokepoint (element/subtree/attr/text/css dispatch) covering all five serialization paths
  - hasDangerousScheme (control-char-stripping scheme blocklist) + scrubCssText (5-pass CSS value scrub) + scrubSrcset module-scope pure helpers
  - per-session sanitizeCounters (6 keys) + aggregate '[DOM Stream] sanitization strips' warn per pass
  - 'text' dispatch identity hook + attr-op 'value' pass-through (the plan 03-03 masking seams)
  - serialization-path inventory comment (ground truth for the 03-05 purity scan)
  - capture-side mXSS/injection test corpus (17 tests)
affects: [03-02 render chokepoint, 03-03 privacy masking, 03-04 sanitize-divergence ledger, 03-05 purity scan + SECURITY.md, phase-8 CAPT-05 typed-text]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - single named chokepoint with dispatch-tag shapes (sanitizeForWire) as the unique wire writer
    - scheme blocklist with <=0x20 control-char stripping before prefix match
    - targeted CSS value scrub (no parser) with idempotent passes + markup-breakout fixpoint strip
    - drop-decision-inside-chokepoint, loop-only-routes threading
    - per-session counter lifecycle with one aggregate warn per serialization pass

key-files:
  created:
    - tests/security-sanitize-capture.test.js
  modified:
    - src/capture/index.js

key-decisions:
  - "srcdoc strips counted under blockedSubtrees (a srcdoc is a whole nested document; the interface left the counter unassigned)"
  - "script/noscript drops return {drop:true} UNCOUNTED (reference-parity strip, not a Phase-3 strip) so benign pages with scripts never fire the strip warn"
  - "scrubCssText gained a pass-5 markup-breakout fixpoint strip; the locked '</style' -> '<\\/style' rewrite runs first and is preserved"
  - "Forbidden add-op ROOTS (script/noscript/object/embed appended post-snapshot) emit no add op at all, not an empty-html op"
  - "Element scrub runs twice in the snapshot walk: drop decision + raw-value scrub at the old script/noscript site, plus a post-absolutification re-scrub on final wire values (idempotent, counters move only on change)"

patterns-established:
  - "Chokepoint dispatch: one named function, multiple shapes via kind tag; decision logic inside, call sites only route"
  - "Strip observability: counter snapshot before pass, single aggregate logger.warn after pass when any counter moved"

requirements-completed: [SEC-01]

# Metrics
duration: 24min
completed: 2026-06-12
---

# Phase 3 Plan 01: Capture-Side Sanitization Chokepoint Summary

**sanitizeForWire blocklist chokepoint covering all five capture serialization paths (snapshot walk, add-op subtrees, attr ops, both text branches) with scheme/CSS/handler strips, per-session counters, and a 17-test mXSS corpus -- benign fidelity byte-identical, oracle untouched at 147/147**

## Performance

- **Duration:** 24 min
- **Started:** 2026-06-11T23:58:13Z
- **Completed:** 2026-06-12T00:22:32Z
- **Tasks:** 2 (both TDD: RED -> GREEN)
- **Files modified:** 2

## Accomplishments

- One named chokepoint (`sanitizeForWire`, inner function of `createCapture`) through which all five serialization paths emit: serializeDOM clone walk ('element'), processAddedNode ('subtree'), attr-op branch ('attr'), characterData + E2 text-childlist branches ('text'), plus head inline styles ('css')
- on* handlers stripped on every element regardless of namespace; javascript:/vbscript:/data:text/html neutralized to '' (including whitespace-obfuscated forms, checked post-absolutification on final wire values) across URL_ATTRS + formaction + xlink:href + srcset candidates
- srcdoc attributes dropped; object/embed subtrees dropped; script/noscript stripping preserved -- all decisions inside the chokepoint
- CSS value scrub (url() scheme gate, expression(), -moz-binding, non-http(s) @import, </style rewrite, markup-breakout strip) on head styles, style attributes, style attr-ops, and style element text
- Live page never mutated: processAddedNode serializes a scrubbed detached clone (`el.outerHTML` eliminated from non-comment code); live nodes keep handlers, pinned by tests
- Every strip counted in per-session `sanitizeCounters` and surfaced via ONE aggregate `[DOM Stream] sanitization strips` warn per pass; fully benign passes warn nothing
- Full suite green: 147/147 (130 pre-existing incl. differential oracle + 17 new) -- benign fixtures byte-identical through the chokepoint

## Task Commits

Each task was committed atomically (TDD: test commit then feat commit):

1. **Task 1: sanitizeForWire chokepoint + snapshot-path coverage** - `7e21067` (test, RED) -> `fbabc36` (feat, GREEN)
2. **Task 2: Differ-path coverage + five-path inventory comment** - `1fd1633` (test, RED) -> `8de56a7` (feat, GREEN)

## Files Created/Modified

- `src/capture/index.js` - sanitizeForWire chokepoint + hasDangerousScheme/scrubCssText/scrubSrcset/stripLowChars helpers + sanitizeCounters + aggregate strip warn + serialization-path inventory comment; header/absolutifyUrl/serializeShellAttributes stale comments updated
- `tests/security-sanitize-capture.test.js` - 17-test capture-side mXSS/injection corpus (snapshot, add-op, attr-op, text shapes) with benign-fidelity and live-page-untouched pins; env recipe duplicated locally from capture-skip.test.js (parallel-safe)

## Decisions Made

- srcdoc strips counted under `blockedSubtrees` (closest semantic: a srcdoc carries a whole nested document); the plan's interface listed the six counters but did not assign srcdoc to one
- script/noscript drops are routed through the chokepoint but NOT counted -- they are reference-parity strips, and counting them would fire the strip warn on every benign page carrying a script tag (violating the benign-no-warn behavior test)
- The stop-path final flush in `stopMutationStream` also wraps `processMutationBatch` with the aggregate warn (plan named serializeDOM + flushMutations; the stop path is a third `processMutationBatch` caller and "never silent" demands coverage)
- In `flushMutations` the warn check runs BEFORE the empty-diffs early return, so a batch whose every op was dropped by the chokepoint still surfaces its strips

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Namespace-confusion payload lives as raw TEXT inside a style element -- attribute enumeration cannot see it**
- **Found during:** Task 1 (mXSS corpus GREEN run: 9/10, namespace-confusion row failing)
- **Issue:** The plan's mitigation for T-03-03 was attribute enumeration on every element, but jsdom (verified by probe) parses the canonical math/mglyph payload so `</math><img src onerror=alert(1)>` becomes the RAW TEXT of an HTML-namespace `<style>` element. The onerror never exists as an attribute; serialized to the wire it can materialize as a real element under a context-shifted re-parse (the mXSS class).
- **Fix:** (a) `<style>` ELEMENT text now routes through scrubCssText in the element scrub (plan only routed head styles + style attributes); (b) scrubCssText gained pass 5: a markup-breakout strip removing tag-like sequences (`<` + optional `/` + letter ... `>` or EOS) iterated to a fixpoint. The locked `</style` -> `<\/style` string-escape rewrite runs first and is preserved; the CDO token `<!--` is untouched. Benign CSS passes byte-identical ('<' is invalid in CSS syntax outside quoted strings).
- **Files modified:** src/capture/index.js
- **Verification:** namespace-confusion test green; head-style benign byte-identical pin green; full suite 147/147 (oracle unaffected)
- **Committed in:** fbabc36 (Task 1 feat commit)

**2. [Rule 2 - Missing Critical] Forbidden add-op ROOTS would reach the wire wholesale**
- **Found during:** Task 1 (processAddedNode rewrite)
- **Issue:** The plan's 'subtree' dispatch specified removing forbidden DESCENDANTS only. A `<script>`/`<object>`/`<embed>` element appended post-snapshot as the add-op ROOT would serialize its entire markup onto the wire -- contradicting the must-have truth that object/embed subtrees are dropped through the chokepoint.
- **Fix:** 'subtree' returns `{ drop: true }` when the root itself is forbidden; processAddedNode returns `''` and the add-op call site skips emission (`if (!html) continue;`). Benign adds unaffected (an element's outerHTML is never empty); no differential scenario appends forbidden roots (verified by scan before implementation).
- **Files modified:** src/capture/index.js
- **Verification:** differ-arrival hostile subtree test green; full suite 147/147
- **Committed in:** fbabc36 (Task 1 feat commit)

---

**Total deviations:** 2 auto-fixed (both Rule 2 - missing critical functionality)
**Impact on plan:** Both fixes were required to satisfy the plan's own behavior tests and must-have truths. No scope creep; no wire change for benign content (oracle green).

## Issues Encountered

- **TDD fail-fast tripped on the inline-style test:** the snapshot-path style rows passed pre-implementation because jsdom's `captureComputedStyles` overwrites author style attributes with computed text (which drops invalid declarations). Investigated per the RED gate rule and re-pointed the load-bearing assertions at the add-op path, where raw attribute values reach the wire with no computed-style rewrite (the surface a real browser exposes). Snapshot rows kept as belt-and-braces pins.
- **JSDoc `on*/` sequence terminated the block comment** (`*/` inside "on*/srcdoc") causing a module SyntaxError during Task 2; rephrased to "on* and srcdoc" before commit.

## Known Stubs

Both are intentional seams the plan itself specifies; neither blocks this plan's goal (SEC-01 capture-side neutralization is complete):

| Stub | File | Reason | Resolved by |
|------|------|--------|-------------|
| 'text' dispatch returns `{ text: payload.text }` unchanged | src/capture/index.js (sanitizeForWire) | Identity hook created this plan per the interface contract; masking logic is SEC-03 scope | Plan 03-03 (maskTextSelector/maskTextFn) |
| attr-op 'value' attribute passes through unchanged | src/capture/index.js (sanitizeForWire 'attr' dispatch) | Marked seam comment per plan; password/input masking is SEC-03 scope | Plan 03-03 (maskInputs + always-on password mask) |

## Next Phase Readiness

- The 03-03 masking seams ('text' dispatch + attr-op 'value' pass-through + the six-counter object with masked* keys) are in place with seam comments naming the consuming plan
- The serialization-path inventory comment above sanitizeForWire is the ground truth for the 03-05 static purity scan (safeSend vs sanitizeForWire reference counting)
- The 03-04 sanitize-divergence ledger entry can now exhibit a real divergence: the extracted side strips on*/javascript: content the reference passes raw
- No blockers; wave-1 sibling 03-02 (render chokepoint) owns the residual serialize-reparse class render-side

---
*Phase: 03-security-pipeline-sanitization-privacy-masking*
*Completed: 2026-06-12*

## Self-Check: PASSED

- Files verified: src/capture/index.js, tests/security-sanitize-capture.test.js, 03-01-SUMMARY.md
- Commits verified: 7e21067, fbabc36, 1fd1633, 8de56a7
- TDD gate sequence verified: test (7e21067) -> feat (fbabc36); test (1fd1633) -> feat (8de56a7)
- Full suite: 147/147 green (incl. differential oracle)
