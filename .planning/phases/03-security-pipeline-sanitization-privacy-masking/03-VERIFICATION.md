---
phase: 03-security-pipeline-sanitization-privacy-masking
verified: 2026-06-14T02:34:54Z
status: passed
score: "30/30 must-haves verified"
overrides_applied: 0
deferred:
  - truth: "Typed input property-event capture beyond MutationObserver (CAPT-05) is outside Phase 3 privacy masking scope."
    addressed_in: "Phase 8"
    evidence: "REQUIREMENTS.md maps CAPT-05 to Phase 8; ROADMAP Phase 8 includes live typed form-field mirroring."
  - truth: "Remote-control consent and authorization hook (SEC-04) is outside Phase 3."
    addressed_in: "Phase 5"
    evidence: "REQUIREMENTS.md maps SEC-04 to Phase 5; ROADMAP Phase 5 requires a host-provided consent/authorization hook."
---

# Phase 3: Security Pipeline - Sanitization + Privacy Masking Verification Report

**Phase Goal:** Mirrored content is safe to render and masked content never leaves the captured page - the hard gate for anything embeddable or published.
**Verified:** 2026-06-14T02:34:54Z
**Status:** passed
**Re-verification:** No - initial verification

## Goal Achievement

Phase 3 meets the goal. Capture-side serialization routes through `sanitizeForWire`, renderer-side insertion routes through the named render sanitizers, the viewer sandbox/CSP contract is enforced and documented, and capture-side masking prevents configured sensitive content and password values from appearing on the wire. The supplied browser loopback checkpoint covers the remaining real-browser behavior: sandbox `allow-same-origin`, CSP present, benign live add mirrored, hostile row scrubbed, and clicking sanitized mirror controls stayed inert.

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | All serialization paths strip `on*` handlers and dangerous URLs through one named capture chokepoint. | VERIFIED | `src/capture/index.js` defines one `sanitizeForWire` dispatcher covering `element`, `subtree`, `attr`, `text`, and `css`; snapshot clone walking, add-op subtree serialization, attr ops, E2 text-childlist, characterData, and head CSS all call it. `tests/security-sanitize-capture.test.js` covers event handlers, `javascript:`/`vbscript:`/`data:text/html`, `srcdoc`, `object`/`embed`/`script`/`noscript`, `srcset`, CSS, counters, benign fidelity, and live-page purity. |
| 2 | Render-side sanitization runs through one named chokepoint with CSS pass and srcdoc CSP meta. | VERIFIED | `src/renderer/sanitize.js` exports `sanitizeFragment`, `sanitizeAttrValue`, and `scrubCssText`; `src/renderer/diff.js` scrubs template-parsed add fragments before `importNode` and scrubs attr ops before mutation; `src/renderer/index.js` post-parse scrubs hostile snapshots; `src/renderer/snapshot.js` injects the adopted CSP meta and scrubs shell/inline styles. |
| 3 | Viewer renders exclusively in a sandboxed iframe without `allow-scripts`, startup assertion fails on drift, and embed contract is documented. | VERIFIED | `src/renderer/index.js` writes sandbox exactly `allow-same-origin` and throws `viewer-sandbox-invalid` if the token list differs. `tests/renderer-viewer.test.js` pins the sandbox, `tests/security-chokepoint-purity.test.js` forbids renderer `allow-scripts` references outside comments, and `docs/SECURITY.md` documents the contract. |
| 4 | Host-configured privacy masking is applied capture-side on all paths, and masked text/input values never leave the captured page within Phase 3 scope. | VERIFIED | `src/capture/index.js` compiles `blockSelector`, `maskTextSelector`, `maskInputs`, `maskTextFn`, and `maskInputFn`, always masks password values, fail-closes throwing mask functions, swaps blocked subtrees for dimension placeholders, and suppresses blocked-subtree diffs. `tests/security-mask.test.js` wire-scans snapshots, add ops, attr ops, text ops, blocked subtrees, password values, textarea/select coverage, and custom mask functions. |

**Score:** 30/30 plan must-haves verified. Roadmap contract: 4/4 success criteria verified.

### Plan Must-Have Rollup

| Plan | Scope | Truths | Artifacts | Key Links | Status |
|------|-------|--------|-----------|-----------|--------|
| 03-01 | SEC-01 capture sanitization chokepoint | 7/7 | 2/2 | 3/3 manual | VERIFIED |
| 03-02 | SEC-02 render sanitization, CSP, sandbox defense-in-depth | 7/7 | 4/4 | 3/3 manual | VERIFIED |
| 03-03 | SEC-03 capture-side privacy masking | 7/7 | 2/2 | 3/3 manual | VERIFIED |
| 03-04 | D7 differential oracle declaration for intentional sanitization divergence | 5/5 | 4/4 | 2/2 manual | VERIFIED |
| 03-05 | Static purity gates, documentation, browser checkpoint | 4/4 | 2/2 | 2/2 manual | VERIFIED |

The artifact verifier reported all declared artifacts present and substantive across the five plans. The key-link verifier produced false negatives for prose `from` labels and escaped regex patterns, so link status above is based on manual source inspection against the actual code paths.

### Deferred Items

Items below are explicitly outside Phase 3 and do not block this phase.

| # | Item | Addressed In | Evidence |
|---|------|--------------|----------|
| 1 | Typed input property-event capture beyond MutationObserver (CAPT-05). | Phase 8 | `REQUIREMENTS.md` maps CAPT-05 to Phase 8; `03-CONTEXT.md` lists typed input event capture as future scope. |
| 2 | Remote-control consent/authorization hook (SEC-04). | Phase 5 | `REQUIREMENTS.md` maps SEC-04 to Phase 5; `03-CONTEXT.md` marks SEC-04 remote-control consent out of scope. |

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/capture/index.js` | Capture sanitizer, masking vocabulary, wire serialization inventory, counters | VERIFIED | One `sanitizeForWire` chokepoint exists and all capture serialization paths route through it; masking and block predicates are applied before wire emission. |
| `src/renderer/sanitize.js` | Render-side sanitizer module | VERIFIED | Exports `sanitizeFragment`, `sanitizeAttrValue`, and `scrubCssText`; strips dangerous attributes/subtrees and scrubs CSS. |
| `src/renderer/diff.js` | Mutation application through render sanitizer | VERIFIED | Add ops parse via `template`, sanitize `template.content`, then `importNode`; attr ops call `sanitizeAttrValue` and remove dangerous values. |
| `src/renderer/snapshot.js` | CSP shell and CSS scrub | VERIFIED | CSP meta is first after `<head>`; shell attrs/styles and inline/head CSS are scrubbed. |
| `src/renderer/index.js` | Sandboxed iframe and post-parse scrub wiring | VERIFIED | Sandboxed iframe is exactly `allow-same-origin`; hostile snapshot body is post-parse scrubbed on load. |
| `tests/security-sanitize-capture.test.js` | SEC-01 capture corpus | VERIFIED | Covers hostile snapshots, add ops, attr ops, CSS, srcset, counters, live-page purity, and benign fidelity. |
| `tests/security-sanitize-render.test.js` | SEC-02 renderer corpus | VERIFIED | Covers sanitizer exports, add/attr integration, CSS, post-parse hostile snapshot scrub, counters, and null tolerance. |
| `tests/security-mask.test.js` | SEC-03 masking corpus | VERIFIED | Covers block/mask selectors, password masking, maskInputs, custom functions, fail-closed behavior, and whole-wire leakage scans. |
| `tests/security-chokepoint-purity.test.js` | Static purity gate | VERIFIED | Scans capture chokepoint coverage, renderer `allow-scripts`, allowed `innerHTML` sinks, and docs markers. |
| `tests/differential/fixtures/sanitize-corpus.html` | Hostile fixture | VERIFIED | Contains hostile attrs/URLs/CSS/subtrees and password input for D7 divergence. |
| `tests/differential/scenarios/sanitize-divergence.js` | D7 mutation scenario | VERIFIED | Drives post-snapshot hostile attr and benign mutations for oracle coverage. |
| `tests/differential/divergence-ledger.js` | D7 ledger entry | VERIFIED | Scenario-pinned D7 entry accounts for intentional sanitized divergence only. |
| `tests/differential/oracle.test.js` | Differential matrix and load-bearing D7 tests | VERIFIED | Includes sanitize matrix row, direction checks, zero-consultation guard, and empty-ledger failure. |
| `docs/SECURITY.md` / `README.md` | Embed security contract and pointer | VERIFIED | Security contract documents sandbox, adopted CSP, chokepoints, masking guarantees, host must-nevers, residual risks; README links it. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `serializeDOM` | `sanitizeForWire` | Snapshot element/css scrub before wire emission | WIRED | Detached clone elements, html/body attrs/styles, iframe payload, stylesheet URLs, and inline head CSS are sanitized before `STREAM.SNAPSHOT`. |
| `processAddedNode` | `sanitizeForWire('subtree')` | Wire clone scrub before `outerHTML` serialization | WIRED | Live node is used for identity/rect reads; detached wire clone is scrubbed before add-op HTML is emitted. |
| `processMutationBatch` attr/text branches | `sanitizeForWire('attr')` and `sanitizeForWire('text')` | Attr values/text routed before `diffs.push` | WIRED | Dangerous attrs drop or emit `val: null`; masked text is emitted for masked owners; blocked/dropped subtrees produce no ops. |
| `applyMutations` add branch | `sanitizeFragment` | Template-context parse then fragment scrub before import | WIRED | Handles table-shaped fragments while preventing raw hostile markup from entering the mirror DOM. |
| `applyMutations` attr branch | `sanitizeAttrValue` | Attr op scrub before `setAttribute` | WIRED | `on*` and `srcdoc` drop; dangerous URL values remove the attr; style values are CSS-scrubbed. |
| `createViewer` snapshot load | `sanitizeFragment` | Post-parse body scrub after `srcdoc` load | WIRED | Direct hostile `STREAM.SNAPSHOT` payloads are scrubbed even if capture-side controls are bypassed. |
| `buildSnapshotHtml` | `scrubCssText` and CSP meta | Shell/style assembly | WIRED | CSP is inserted at the head start; html/body styles and inline styles are scrubbed. |
| Mask config | `sanitizeForWire` text/attr/element/subtree dispatch | Capture-side masking before wire | WIRED | Selector predicates and mask functions are consulted in snapshot, add, attr, characterData, and E2 text-childlist paths. |
| D7 oracle matrix | `sanitize-corpus.html` + `sanitize-divergence` | Matrix row and ledger guard | WIRED | The oracle proves reference carries hostile/password data while extracted capture omits it, and empty-ledger mode fails. |
| README | `docs/SECURITY.md` | Docs pointer | WIRED | README links to the embed security contract. |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `src/capture/index.js` snapshot path | `payload.html`, shell attrs/styles, stylesheets, inlineStyles | Live DOM clone and document head resources | Yes | VERIFIED |
| `src/capture/index.js` mutation path | `diffs` mutation ops | Real MutationObserver records | Yes | VERIFIED |
| `src/capture/index.js` masking path | Masked text/input values and block placeholders | Host config plus live DOM ownership/ancestry checks | Yes | VERIFIED |
| `src/renderer/diff.js` | Mirror DOM mutations | Incoming `STREAM.MUTATIONS` payloads | Yes | VERIFIED |
| `src/renderer/index.js` | Mirror snapshot body | Incoming `STREAM.SNAPSHOT` payloads via `iframe.srcdoc` | Yes | VERIFIED |
| `tests/differential/oracle.test.js` | Reference/extracted stream pairs | Fixture/scenario capture execution | Yes | VERIFIED |

No dynamic artifact is hollow: the sanitizers and maskers operate on live DOM-derived payloads or incoming wire payloads, and tests assert the resulting wire/DOM state rather than only function existence.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Full runnable suite, including SEC-01/02/03, renderer, masking, purity, and differential oracle tests | `npm test` | 205 tests passed, 0 failed | PASS |
| Renderer sandbox/innerHTML/docs purity spot-check | `rg -n "allow-scripts|innerHTML\\s*=|docs/SECURITY.md" src/renderer tests/security-chokepoint-purity.test.js README.md docs/SECURITY.md` | `allow-scripts` appears only in comments/docs/tests; known `innerHTML` sinks are covered by purity tests; README links SECURITY.md | PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| SEC-01 | 03-01, 03-04, 03-05 | Sanitization prevents script injection/mXSS in mirrored content. | SATISFIED | Capture-side `sanitizeForWire` covers snapshot/add/attr/text/css paths; tests exercise hostile attrs, dangerous URL schemes, srcdoc, object/embed/script/noscript, CSS, srcset, live-page purity, counters, and D7 oracle divergence. |
| SEC-02 | 03-02, 03-05 | Renderer sandbox and defense-in-depth sanitization make mirrored content safe to embed/render. | SATISFIED | Renderer sanitizer, CSP meta, post-parse scrub, attr/add scrub, exact sandbox assertion, docs contract, purity gate, and browser loopback checkpoint all pass. Note: `.planning/REQUIREMENTS.md` still marks SEC-02 pending, but implementation evidence and phase plans satisfy it; this is traceability metadata drift, not a code gap. |
| SEC-03 | 03-03, 03-04, 03-05 | Capture-side privacy masking ensures masked content never leaves the page. | SATISFIED | Mask selectors/functions, password always-on masking, `maskInputs`, block placeholders, fail-closed custom masks, no-op default fidelity, wire-wide leakage scans, and D7 password divergence checks are implemented and tested. |

All phase requirement IDs from the request and plan frontmatter are accounted for: SEC-01, SEC-02, and SEC-03. No additional Phase 3 requirement ID is orphaned in the implementation evidence.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| None blocking | - | TODO/FIXME/HACK/placeholder stubs, hollow returns, and hardcoded empty rendered data | None | Scans found only legitimate initializers, test fixtures, domain placeholders, and documented/allowlisted sinks. |
| `.planning/REQUIREMENTS.md` / `.planning/ROADMAP.md` | Metadata | SEC-02 checkbox pending; roadmap progress table stale | Info | Shared planning metadata lags the actual phase evidence. This does not affect goal achievement. |

### Human Verification Required

None remaining. Visual/browser behavior that cannot be fully proven by jsdom was covered by the supplied FSB checkpoint: sandbox `allow-same-origin`, CSP present, benign live add mirrored, hostile row scrubbed (`onclick` stripped and `javascript:` href removed), and sanitized mirror controls stayed inert on click.

### Gaps Summary

No actionable gaps found. Phase 3 achieves the security pipeline goal: mirrored content is safe to render, renderer defense-in-depth is present, the embed contract is documented and guarded, and masked/password content is removed or masked before leaving the captured page. Deferred scope is limited to later roadmap work for CAPT-05 typed input event capture and SEC-04 remote-control consent.

---

_Verified: 2026-06-14T02:34:54Z_
_Verifier: Claude (gsd-verifier)_
