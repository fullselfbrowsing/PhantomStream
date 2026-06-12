---
phase: 03-security-pipeline-sanitization-privacy-masking
plan: 02
subsystem: security
tags: [sanitization, mxss, csp, renderer, defense-in-depth, treewalker, template-parsing]

# Dependency graph
requires:
  - phase: 02-renderer-extraction
    provides: createViewer + Document-parameterized diff applier + pure srcdoc builder (the render pipeline the chokepoint wires into)
provides:
  - src/renderer/sanitize.js render-side chokepoint (sanitizeFragment fragment walker + sanitizeAttrValue + scrubCssText)
  - Template-context ADD parsing (tr/td/col/option now render -- queued WR-02 fix taken) with fragment scrub before importNode
  - Adopted CSP meta as the first element of every srcdoc head + inline CSS scrub at assembly
  - Post-parse mirror-document scrub on iframe load, per-session sanitize counters in createViewer
affects: [03-05 purity scan + docs/SECURITY.md, 04-transport, loopback demo]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - DOM-fragment sanitization (template parse -> walk -> importNode; never string-scrub-then-reparse)
    - collect-then-mutate TreeWalker over live fragments
    - caller-owned counter lifecycle injected via hooks (per-session vs per-snapshot)

key-files:
  created:
    - src/renderer/sanitize.js
    - tests/security-sanitize-render.test.js
  modified:
    - src/renderer/diff.js
    - src/renderer/snapshot.js
    - src/renderer/index.js
    - tests/renderer-diff.test.js
    - tests/renderer-snapshot.test.js
    - tests/renderer-purity.test.js

key-decisions:
  - "CSP style-src adopted as http: https: 'unsafe-inline' under the 03-CONTEXT documented-rationale clause: capture deliberately emits external stylesheet links and 'unsafe-inline' alone would block every link-rel-stylesheet load; script-blocking untouched (default-src 'none', no script-src introduced)"
  - "sanitizeAttrValue stays a pure {drop, value} transform; diff.js owns counting (drop -> strippedHandlers, value change -> blockedUrls, style change -> cssScrubs)"
  - "object/embed neutralization renders as full removal (script/noscript parity per 03-RESEARCH resolved question 4)"
  - "srcset rewritten only when a dangerous candidate was actually blocked, so benign srcset values (incl. data: URLs that a naive comma-split would mangle) stay byte-identical"

patterns-established:
  - "Render chokepoint: sanitizeFragment over PARSED fragments, importNode after scrub -- the renderer's only innerHTML sink for wire content is the template parse in diff.js (03-05 purity scan pins it)"
  - "Per-session sanitize counters (reset only in destroy) injected via hooks.sanitizeCounters; per-snapshot miss counters unchanged (Pitfall 3)"

requirements-completed: [SEC-02]

# Metrics
duration: 21min
completed: 2026-06-12
---

# Phase 3 Plan 02: Render-Side Sanitization Chokepoint Summary

**DOM-fragment render chokepoint (sanitizeFragment/sanitizeAttrValue/scrubCssText) wired into template-context diff parsing, srcdoc CSP+CSS assembly, and a post-parse mirror scrub -- mXSS corpus green on the render side with benign fidelity byte-identical.**

## Performance

- **Duration:** 21 min
- **Started:** 2026-06-11T23:58:26Z
- **Completed:** 2026-06-12T00:18:54Z
- **Tasks:** 3 (all TDD: RED + GREEN commits each)
- **Files modified:** 8 (2 created, 6 modified)

## Accomplishments

- `src/renderer/sanitize.js`: the named render-side chokepoint -- collect-then-mutate TreeWalker that drops script/noscript/object/embed subtrees (noscript explicitly, Pitfall 9), strips on* attrs namespace-aware (the math/mglyph namespace-confusion payload comes out inert), removes srcdoc, neutralizes dangerous URL schemes including xlink:href (in-place attr-node mutation) and per-candidate srcset, and scrubs style values; one aggregated `[Renderer] sanitization strips` warn per stripping call.
- Diff ADD branch upgraded from div-context to template-context parsing (jsdom-29-verified): bare `<tr>`/`<td>` rows now insert instead of counting stale misses; `sanitizeFragment` runs on `template.content` before `importNode`; the WR-02 parse-to-nothing warn+count path survives with the real cause.
- ATTR branch scrubbed render-side via `sanitizeAttrValue` before every `setAttribute` (Pitfall 5 defense-in-depth); drops/neutralizations counted in caller-owned `hooks.sanitizeCounters`, never stale misses. TEXT branch untouched (textContent has no parse path -- commented).
- `buildSnapshotHtml` carries the exact adopted CSP meta as the first element after `<head>` (script-blocking via `default-src 'none'`; style-src adjustment documented on the constant) and routes inlineStyles through `scrubCssText` -- the `</style>` breakout and `url(javascript:)` class is closed while the module stays DOM-free.
- Post-parse defense-in-depth: a creation-time iframe load listener scrubs the PARSED mirror body via `sanitizeFragment`, proven behaviorally by feeding a hostile STREAM.SNAPSHOT directly to the viewer, gluing srcdoc via `cd.open/write/close`, and deliberately re-firing the load event -- mirror body comes out with zero on* attrs and no javascript: href.
- Sanitize counters live per-session (declared with the lifecycle rationale, reset ONLY in `destroy()`, never in `handleSnapshot`).
- Full suite 151/151 green (was 130 pre-phase); loopback e2e and differential oracle unaffected on benign content.

## Task Commits

Each task was committed atomically (TDD: RED test commit, then GREEN feat commit):

1. **Task 1: sanitize.js chokepoint module + render-side mXSS corpus** - `3bd40ec` (test, RED) + `1c33fbe` (feat, GREEN)
2. **Task 2: diff.js template-context parse + chokepoint integration + deliberate re-pins** - `71e17e4` (test, RED) + `301c4d9` (feat, GREEN)
3. **Task 3: snapshot.js CSP meta + CSS scrub, index.js counter lifecycle + post-parse scrub, snapshot re-pins** - `740ada7` (test, RED) + `48fe8b1` (feat, GREEN)

## TDD Gate Compliance

All three tasks followed the RED -> GREEN sequence with a failing test commit preceding each implementation commit (verified in git log above). No REFACTOR commits were needed.

## Files Created/Modified

- `src/renderer/sanitize.js` - Render-side chokepoint: `sanitizeFragment`, `sanitizeAttrValue`, `scrubCssText` (CSS policy deliberately duplicates the capture side per 03-RESEARCH A4 -- zero shared-module coupling)
- `src/renderer/diff.js` - Template-context ADD parse + importNode; fragment scrub before import; attr-op scrub; optional `hooks.sanitizeCounters` (public 4-arg signature unchanged)
- `src/renderer/snapshot.js` - CSP meta constant first after `<head>`; inlineStyles CSS-scrubbed; WR-03 inventory entries 1-2 updated; module stays DOM-free
- `src/renderer/index.js` - Per-session `sanitizeCounters` closure state; post-parse scrub load listener (registered before the streaming-flip listener; sandbox assertion untouched); counters plumbed to `applyMutations`; reset only in `destroy()`
- `tests/security-sanitize-render.test.js` - 20 tests: mXSS corpus, value-helper rows, counter/warn discipline, applyMutations integration, hostile-snapshot behavioral row, Pitfall-2 self-scan
- `tests/renderer-diff.test.js` - Two pins deliberately re-pinned: template semantics + tr-insert FLIP; new empty/whitespace/text-only WR-02 case keeps the warn+count path covered
- `tests/renderer-snapshot.test.js` - Exact adopted CSP policy pinned (position + content + Pitfall-8 absence); inlineStyles raw pin FLIPPED to scrubbed; payload.html raw pin KEPT and re-rationalized at the string layer
- `tests/renderer-purity.test.js` - Required-module pin extended to `sanitize.js` (forbidden-pattern scans pick the new file up automatically)

## Decisions Made

- **CSP style-src adjustment:** baseline `style-src 'unsafe-inline'` adjusted to `style-src http: https: 'unsafe-inline'` under the CONTEXT decision's own adjustment clause -- the capture deliberately emits external stylesheet links (`stylesheets[]` collection) and the baseline would block every link-rel-stylesheet load in the mirror. Script-blocking is untouched. Rationale documented on the `CSP_META` constant, cross-referencing docs/SECURITY.md (plan 03-05).
- **Counter ownership split:** `sanitizeAttrValue` is pure; the diff applier classifies and counts (drop -> `strippedHandlers`, URL neutralization -> `blockedUrls`, style change -> `cssScrubs`) and warns per scrubbed op -- counted + logged, never silent.
- **srcdoc strips counted under `strippedHandlers`** (matches the 03-RESEARCH Pattern 3 capture-side sketch).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Test fixture strings tripped the Pitfall-2 acceptance grep**
- **Found during:** Task 1 (chokepoint module + corpus)
- **Issue:** macOS grep honors `\s`, so the acceptance check `grep -c "iframe.srcdoc\s*=" tests/security-sanitize-render.test.js` matched the HTML fixture markup `<iframe srcdoc="..."` (attribute-name fixture, not an assignment) and returned 2 instead of 0.
- **Fix:** Fixture strings split (`'<iframe ' + 'srcdoc="..."'`) so the literal sequence never appears; the in-file self-scan test independently pins that no real `iframe.srcdoc =` assignment exists.
- **Files modified:** tests/security-sanitize-render.test.js
- **Verification:** grep returns 0; all tests green.
- **Committed in:** `1c33fbe` (part of Task 1 GREEN commit)

No other deviations -- plan executed as written.

## Known Stubs

None. No placeholder values, no TODO/FIXME markers, no unwired data paths in any file touched by this plan.

## Threat Flags

None -- every surface touched maps to the plan's threat register (T-03-07 through T-03-12); no new network endpoints, auth paths, or schema changes introduced.

## Verification Results

- `node --test tests/security-sanitize-render.test.js tests/renderer-diff.test.js tests/renderer-snapshot.test.js tests/renderer-purity.test.js tests/renderer-viewer.test.js` -- green
- `npm test` -- 151/151 green (loopback e2e + differential oracle unaffected on benign content)
- Acceptance greps: `export function` x3 in sanitize.js; zero `iframe.srcdoc =` in the corpus file; `'sanitize.js'` pinned once in purity test; zero non-comment `innerHTML` in sanitize.js; `createElement('template')` x1 / `createElement('div')` x0 / `importNode` present in diff.js; `Content-Security-Policy` present and `frame-ancestors`/`report-uri` absent in snapshot.js; snapshot.js DOM-free; `sanitizeCounters` x8 in index.js with the handleSnapshot reset block untouched

## Self-Check: PASSED

- All created files exist on disk (sanitize.js, security-sanitize-render.test.js, this SUMMARY)
- All six task commits present in git history (3bd40ec, 1c33fbe, 71e17e4, 301c4d9, 740ada7, 48fe8b1)
